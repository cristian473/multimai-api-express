
export interface RevalidateCacheRequest {
  tag?: string;
  tags?: string[];
  apiKey: string;
}

export interface RevalidateCacheResponse {
  success?: boolean;
  error?: string;
  revalidatedTags?: string[];
  deletedEntries?: number;
  message?: string;
}

export interface CacheStatsRequest {
  apiKey: string;
  tag?: string;
}

export interface CacheStatsResponse {
  success?: boolean;
  error?: string;
  stats?: any;
  tags?: any[];
  totalTags?: number;
  totalCacheEntries?: number;
}
