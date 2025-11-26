/**
 * Type definitions for the cache system
 */

export interface CacheOptions {
  /**
   * Time to live in seconds
   * @default 3600 (1 hour)
   */
  ttl?: number;

  /**
   * Tags to associate with this cache entry
   * Useful for grouping and invalidating related cache entries
   * @example ['users', 'user-123']
   */
  tags?: string[];

  /**
   * Custom key prefix
   * Useful for versioning or namespacing cache entries
   * @example 'app-v2'
   */
  prefix?: string;
}

export interface CachedResult<T> {
  /**
   * The cached data
   */
  data: T;

  /**
   * Timestamp when the data was cached
   */
  cachedAt: number;

  /**
   * Tags associated with this cache entry
   */
  tags: string[];
}

export interface TagStats {
  /**
   * The tag name
   */
  tag: string;

  /**
   * Array of cache keys associated with this tag
   */
  cacheKeys: string[];

  /**
   * Number of cache entries with this tag
   */
  count: number;
}

export interface RevalidateResponse {
  /**
   * Whether the revalidation was successful
   */
  success: boolean;

  /**
   * Tags that were revalidated
   */
  revalidatedTags: string[];

  /**
   * Number of cache entries that were deleted
   */
  deletedEntries: number;

  /**
   * Human-readable message
   */
  message: string;
}

export interface CacheStatsResponse {
  /**
   * Whether the request was successful
   */
  success: boolean;

  /**
   * Statistics for a specific tag (if tag parameter was provided)
   */
  stats?: TagStats;

  /**
   * Statistics for all tags (if no specific tag was requested)
   */
  tags?: TagStats[];

  /**
   * Total number of tags
   */
  totalTags?: number;

  /**
   * Total number of cache entries across all tags
   */
  totalCacheEntries?: number;
}

export interface GetTagsResponse {
  /**
   * Whether the request was successful
   */
  success: boolean;

  /**
   * Array of all tag names
   */
  tags: string[];

  /**
   * Number of tags
   */
  count: number;
}

/**
 * Options for creating a cached function
 */
export interface CachedFunctionOptions extends CacheOptions {
  /**
   * Unique name for the function
   * Used to generate cache keys
   */
  functionName: string;
}

/**
 * Type for a function that can be cached
 */
export type CacheableFunction<TArgs extends unknown[], TResult> = (
  ...args: TArgs
) => Promise<TResult>;

/**
 * Type for a cached version of a function
 */
export type CachedFunction<TArgs extends unknown[], TResult> = CacheableFunction<
  TArgs,
  TResult
>;
