/**
 * Flexible cache with fuzzy matching for search parameters
 * Allows similar searches to hit the same cache entry
 */

import { getRedisClient } from './redis-client';
import {
  normalizeSearchParams,
  generateParamsHash,
  areSimilarSearchParams,
  generateSearchCacheKey,
} from './cache-key-helpers';
import { CacheOptions, CachedResult } from './types';

/**
 * Store tags mapping in Redis (same as regular cache)
 */
async function storeTagMapping(
  cacheKey: string,
  tags: string[],
  ttl: number
): Promise<void> {
  const redis = getRedisClient();
  const pipeline = redis.pipeline();

  for (const tag of tags) {
    const tagKey = `tag:${tag}`;
    pipeline.sadd(tagKey, cacheKey);
    pipeline.expire(tagKey, ttl + 300);
  }

  await pipeline.exec();
}

/**
 * Cache a search result with normalized parameters for flexible matching
 */
export async function cacheSearchResult<T>(
  functionName: string,
  params: Record<string, any>,
  value: T,
  options: CacheOptions = {}
): Promise<void> {
  const redis = getRedisClient();
  const ttl = options.ttl || 3600;
  const tags = options.tags || [];
  const prefix = options.prefix || 'search';

  // Generate cache key from normalized parameters
  const cacheKey = generateSearchCacheKey(functionName, params, prefix);

  const cachedResult: CachedResult<T> = {
    data: value,
    cachedAt: Date.now(),
    tags,
  };

  // Store the parameters used for this cache entry for fuzzy matching
  const metadataKey = `${cacheKey}:params`;
  const normalizedParams = normalizeSearchParams(params);

  const serialized = JSON.stringify(cachedResult);
  const paramsSerialied = JSON.stringify(normalizedParams);

  // Store both the result and the parameters
  const pipeline = redis.pipeline();
  pipeline.setex(cacheKey, ttl, serialized);
  pipeline.setex(metadataKey, ttl, paramsSerialied);
  await pipeline.exec();

  // Store tag mappings
  if (tags.length > 0) {
    await storeTagMapping(cacheKey, tags, ttl);
  }

  console.log(`[FlexibleCache] Cached result for ${functionName} with key ${cacheKey}`);
}

/**
 * Get a cached search result with flexible parameter matching
 * If exact match not found, tries to find similar cache entries
 */
export async function getCachedSearchResult<T>(
  functionName: string,
  params: Record<string, any>,
  options: {
    prefix?: string;
    fuzzyMatch?: boolean;
    similarityThreshold?: number;
  } = {}
): Promise<T | null> {
  const redis = getRedisClient();
  const prefix = options.prefix || 'search';
  const fuzzyMatch = options.fuzzyMatch !== false; // Default true
  const similarityThreshold = options.similarityThreshold || 0.85;

  // Try exact match first
  const cacheKey = generateSearchCacheKey(functionName, params, prefix);
  const cached = await redis.get(cacheKey);

  if (cached) {
    console.log(`[FlexibleCache] Exact cache hit for ${functionName}`);
    try {
      const result = JSON.parse(cached) as CachedResult<T>;
      console.log(`[FlexibleCache] Exact cache hit for ${functionName} with key ${cacheKey}`, result.data);
      return result.data;
    } catch (error) {
      console.error('[FlexibleCache] Error parsing cached value:', error);
      return null;
    }
  }

  // If fuzzy matching is disabled, return null
  if (!fuzzyMatch) {
    console.log(`[FlexibleCache] Cache miss for ${functionName} (fuzzy disabled)`);
    return null;
  }

  // Try fuzzy matching: find similar cache entries
  console.log(`[FlexibleCache] No exact match, trying fuzzy matching...`);

  // Get all cache keys for this function
  const pattern = `${prefix}:${functionName}:*`;
  const keys = await redis.keys(pattern);

  console.log(`[FlexibleCache] Found ${keys.length} potential cache entries to check`);

  // Filter out metadata keys
  const resultKeys = keys.filter((key) => !key.endsWith(':params'));

  // Check each cache entry for similarity
  for (const resultKey of resultKeys) {
    const metadataKey = `${resultKey}:params`;

    // Get the parameters used for this cache entry
    const storedParamsStr = await redis.get(metadataKey);
    if (!storedParamsStr) continue;

    try {
      const storedParams = JSON.parse(storedParamsStr);

      // Check if parameters are similar
      if (areSimilarSearchParams(params, storedParams, similarityThreshold)) {
        console.log(`[FlexibleCache] Fuzzy match found! Key: ${resultKey}`);

        // Get the cached result
        const resultStr = await redis.get(resultKey);
        if (resultStr) {
          const result = JSON.parse(resultStr) as CachedResult<T>;
          return result.data;
        }
      }
    } catch (error) {
      console.error('[FlexibleCache] Error checking cache entry:', error);
      continue;
    }
  }

  console.log(`[FlexibleCache] No fuzzy match found for ${functionName}`);
  return null;
}

/**
 * Wrapper function to cache search results with flexible matching
 */
export async function cacheSearchFn<TArgs extends unknown[], TResult>(
  fn: (...args: TArgs) => Promise<TResult>,
  args: TArgs,
  options: CacheOptions & {
    functionName: string;
    paramsExtractor?: (args: TArgs) => Record<string, any>;
    fuzzyMatch?: boolean;
    similarityThreshold?: number;
  }
): Promise<TResult> {
  const functionName = options.functionName;
  const prefix = options.prefix || 'search';

  // Extract params from arguments
  // By default, assume the second argument is the params object
  const params =
    options.paramsExtractor?.(args) || (args[1] as Record<string, any>);

  // Try to get from cache with flexible matching
  const cached = await getCachedSearchResult<TResult>(functionName, params, {
    prefix,
    fuzzyMatch: options.fuzzyMatch,
    similarityThreshold: options.similarityThreshold,
  });

  if (cached !== null) {
    return cached;
  }

  console.log(`[FlexibleCache] Executing function ${functionName}`);

  // Execute function
  const result = await fn(...args);

  // Store in cache with normalized parameters
  await cacheSearchResult(functionName, params, result, {
    ttl: options.ttl,
    tags: options.tags,
    prefix,
  });

  return result;
}
