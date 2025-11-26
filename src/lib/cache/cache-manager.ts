/**
 * Cache Manager with Tag Support
 * Allows caching function results with tags for selective revalidation
 */

import { getRedisClient } from './redis-client';
import crypto from 'crypto';

export interface CacheOptions {
  /**
   * Time to live in seconds
   */
  ttl?: number;
  /**
   * Tags to associate with this cache entry
   * Useful for grouping and invalidating related cache entries
   */
  tags?: string[];
  /**
   * Custom key prefix
   */
  prefix?: string;
}

export interface CachedResult<T> {
  data: T;
  cachedAt: number;
  tags: string[];
}

/**
 * Generate a cache key from function name and arguments
 */
function generateCacheKey(
  functionName: string,
  args: unknown[],
  prefix?: string
): string {
  const argsHash = crypto
    .createHash('sha256')
    .update(JSON.stringify(args))
    .digest('hex')
    .substring(0, 16);

  const basePrefix = prefix || 'cache';
  return `${basePrefix}:${functionName}:${argsHash}`;
}

/**
 * Store tags mapping in Redis
 * Creates a set for each tag containing all cache keys associated with it
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
    // Add the cache key to the tag's set
    pipeline.sadd(tagKey, cacheKey);
    // Set expiration for the tag set (slightly longer than cache TTL)
    pipeline.expire(tagKey, ttl + 300);
  }

  await pipeline.exec();
}

/**
 * Cache a function result with tags
 */
export async function cacheSet<T>(
  key: string,
  value: T,
  options: CacheOptions = {}
): Promise<void> {
  const redis = getRedisClient();
  const ttl = options.ttl || 3600; // Default 1 hour
  const tags = options.tags || [];

  const cachedResult: CachedResult<T> = {
    data: value,
    cachedAt: Date.now(),
    tags,
  };

  const serialized = JSON.stringify(cachedResult);

  // Store the cached value
  await redis.setex(key, ttl, serialized);

  // Store tag mappings
  if (tags.length > 0) {
    await storeTagMapping(key, tags, ttl);
  }
}

/**
 * Get a cached value
 */
export async function cacheGet<T>(key: string): Promise<T | null> {
  const redis = getRedisClient();
  const cached = await redis.get(key);

  if (!cached) {
    return null;
  }

  try {
    const result = JSON.parse(cached) as CachedResult<T>;
    return result.data;
  } catch (error) {
    console.error('Error parsing cached value:', error);
    return null;
  }
}

/**
 * Delete a specific cache entry
 */
export async function cacheDelete(key: string): Promise<void> {
  const redis = getRedisClient();
  await redis.del(key);
}

/**
 * Revalidate (delete) all cache entries associated with a tag
 */
export async function revalidateTag(tag: string): Promise<number> {
  const redis = getRedisClient();
  const tagKey = `tag:${tag}`;

  // Get all cache keys associated with this tag
  const cacheKeys = await redis.smembers(tagKey);

  if (cacheKeys.length === 0) {
    return 0;
  }

  // Delete all cache entries
  const pipeline = redis.pipeline();
  for (const cacheKey of cacheKeys) {
    pipeline.del(cacheKey);
  }

  // Delete the tag set itself
  pipeline.del(tagKey);

  await pipeline.exec();

  console.log(`Revalidated tag "${tag}": ${cacheKeys.length} entries deleted`);
  return cacheKeys.length;
}

/**
 * Revalidate multiple tags at once
 */
export async function revalidateTags(tags: string[]): Promise<number> {
  let totalDeleted = 0;

  for (const tag of tags) {
    const deleted = await revalidateTag(tag);
    totalDeleted += deleted;
  }

  return totalDeleted;
}

/**
 * Wrapper function to cache function results
 */
export async function cacheFn<TArgs extends unknown[], TResult>(
  fn: (...args: TArgs) => Promise<TResult>,
  args: TArgs,
  options: CacheOptions & { functionName: string }
): Promise<TResult> {
  const cacheKey = generateCacheKey(
    options.functionName,
    args,
    options.prefix
  );

  // Try to get from cache
  const cached = await cacheGet<TResult>(cacheKey);
  if (cached !== null) {
    console.log(`Cache hit for ${options.functionName}`);
    return cached;
  }

  console.log(`Cache miss for ${options.functionName}, executing function`);

  // Execute function
  const result = await fn(...args);

  // Store in cache
  await cacheSet(cacheKey, result, options);

  return result;
}

/**
 * Create a cached version of a function
 */
export function createCachedFunction<TArgs extends unknown[], TResult>(
  fn: (...args: TArgs) => Promise<TResult>,
  options: Omit<CacheOptions, 'prefix'> & { functionName: string; prefix?: string }
) {
  return async (...args: TArgs): Promise<TResult> => {
    return cacheFn(fn, args, options);
  };
}

/**
 * Decorator to cache function results
 * Usage with async functions:
 *
 * const cachedFunction = withCache(
 *   async (id: string) => fetchUserData(id),
 *   { functionName: 'fetchUserData', tags: ['users'], ttl: 600 }
 * );
 */
export function withCache<TArgs extends unknown[], TResult>(
  fn: (...args: TArgs) => Promise<TResult>,
  options: CacheOptions & { functionName: string }
) {
  return createCachedFunction(fn, options);
}

/**
 * Get cache statistics for a tag
 */
export async function getTagStats(tag: string): Promise<{
  tag: string;
  cacheKeys: string[];
  count: number;
}> {
  const redis = getRedisClient();
  const tagKey = `tag:${tag}`;
  const cacheKeys = await redis.smembers(tagKey);

  return {
    tag,
    cacheKeys,
    count: cacheKeys.length,
  };
}

/**
 * Get all tags currently in use
 */
export async function getAllTags(): Promise<string[]> {
  const redis = getRedisClient();
  const tagKeys = await redis.keys('tag:*');
  return tagKeys.map((key) => key.replace('tag:', ''));
}
