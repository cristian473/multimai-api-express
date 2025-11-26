
import { Request, Response } from 'express';
import HttpStatusCodes from '../../constants/HttpStatusCodes';
import cacheService from './cache.service';
import { RouteError } from '@/other/errorHandler';
import { RevalidateCacheRequest } from './cache.dto';

export async function revalidateCache(req: Request, res: Response) {
  try {
    const body: RevalidateCacheRequest = req.body;
    const { tag, tags, apiKey } = body;

    // Validate API key
    if (!cacheService.validateApiKey(apiKey)) {
      throw new RouteError(HttpStatusCodes.UNAUTHORIZED, 'Unauthorized: Invalid API key');
    }

    // Validate input
    if (!tag && !tags) {
      throw new RouteError(HttpStatusCodes.BAD_REQUEST, 'Bad Request: Must provide either "tag" or "tags"');
    }

    let deletedCount = 0;
    let revalidatedTags: string[] = [];

    // Revalidate single tag
    if (tag) {
      if (typeof tag !== 'string') {
        throw new RouteError(HttpStatusCodes.BAD_REQUEST, 'Bad Request: "tag" must be a string');
      }
      deletedCount = await cacheService.revalidateCacheTag(tag);
      revalidatedTags = [tag];
    }
    // Revalidate multiple tags
    else if (tags) {
      if (!Array.isArray(tags)) {
        throw new RouteError(HttpStatusCodes.BAD_REQUEST, 'Bad Request: "tags" must be an array');
      }
      deletedCount = await cacheService.revalidateCacheTags(tags);
      revalidatedTags = tags;
    }

    res.status(HttpStatusCodes.OK).json({
      success: true,
      revalidatedTags,
      deletedEntries: deletedCount,
      message: `Successfully revalidated ${revalidatedTags.length} tag(s), deleted ${deletedCount} cache entries`,
    });
  } catch (error: any) {
    console.error('Cache revalidation error:', error);
    if (error instanceof RouteError) {
      throw error;
    }
    throw new RouteError(HttpStatusCodes.INTERNAL_SERVER_ERROR, error.message || 'Internal Server Error');
  }
}

export async function getCacheStats(req: Request, res: Response) {
  try {
    const apiKey = req.headers['x-api-key'] as string || req.query.apiKey as string;
    const tag = req.query.tag as string;

    // Validate API key
    if (!cacheService.validateApiKey(apiKey)) {
      throw new RouteError(HttpStatusCodes.UNAUTHORIZED, 'Unauthorized: Invalid API key');
    }

    const stats = await cacheService.getCacheStats(tag);

    res.status(HttpStatusCodes.OK).json({
      success: true,
      ...stats
    });
  } catch (error: any) {
    console.error('Error fetching cache stats:', error);
    if (error instanceof RouteError) {
      throw error;
    }
    throw new RouteError(HttpStatusCodes.INTERNAL_SERVER_ERROR, error.message || 'Internal Server Error');
  }
}

export async function getAllTags(req: Request, res: Response) {
  try {
    const apiKey = req.headers['x-api-key'] as string || req.query.apiKey as string;

    // Validate API key
    if (!cacheService.validateApiKey(apiKey)) {
      throw new RouteError(HttpStatusCodes.UNAUTHORIZED, 'Unauthorized: Invalid API key');
    }

    const allTags = await cacheService.getAllCacheTags();

    res.status(HttpStatusCodes.OK).json({
      success: true,
      tags: allTags,
      count: allTags.length,
    });
  } catch (error: any) {
    console.error('Error fetching tags:', error);
    if (error instanceof RouteError) {
      throw error;
    }
    throw new RouteError(HttpStatusCodes.INTERNAL_SERVER_ERROR, error.message || 'Internal Server Error');
  }
}
