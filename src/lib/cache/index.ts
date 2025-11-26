/**
 * Cache System Entry Point
 *
 * Sistema de caché con Redis y soporte para tags
 */

// Client
export { getRedisClient, closeRedisClient } from './redis-client';

// Cache Manager
export {
  cacheSet,
  cacheGet,
  cacheDelete,
  cacheFn,
  createCachedFunction,
  withCache,
  revalidateTag,
  revalidateTags,
  getTagStats,
  getAllTags,
} from './cache-manager';

// Flexible Cache with Fuzzy Matching
export {
  cacheSearchResult,
  getCachedSearchResult,
  cacheSearchFn,
} from './flexible-cache';

// Cache Key Helpers
export {
  normalizeSearchParams,
  generateParamsHash,
  areSimilarSearchParams,
  generateSearchCacheKey,
  calculateSimilarity,
  normalizeString,
} from './cache-key-helpers';

// Types
export type {
  CacheOptions,
  CachedResult,
  TagStats,
  RevalidateResponse,
  CacheStatsResponse,
  GetTagsResponse,
  CachedFunctionOptions,
  CacheableFunction,
  CachedFunction,
} from './types';

// Examples (solo para referencia, no exportar en producción)
// export * from './examples';
