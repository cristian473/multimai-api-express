
import { revalidateTag, revalidateTags, getAllTags, getTagStats } from '../../lib/cache/cache-manager';

// Simple API key authentication
const CACHE_REVALIDATE_API_KEY = process.env.CACHE_REVALIDATE_API_KEY || 'development-key';

function validateApiKey(apiKey: string | undefined): boolean {
  if (!apiKey) {
    return false;
  }
  return apiKey === CACHE_REVALIDATE_API_KEY;
}

async function revalidateCacheTag(tag: string): Promise<number> {
  return await revalidateTag(tag);
}

async function revalidateCacheTags(tags: string[]): Promise<number> {
  return await revalidateTags(tags);
}

async function getAllCacheTags(): Promise<string[]> {
  return await getAllTags();
}

async function getCacheStats(tag?: string): Promise<any> {
  if (tag) {
    return await getTagStats(tag);
  }
  
  const allTags = await getAllTags();
  const allStats = await Promise.all(
    allTags.map((t) => getTagStats(t))
  );
  
  return {
    tags: allStats,
    totalTags: allStats.length,
    totalCacheEntries: allStats.reduce((sum, stat) => sum + stat.count, 0),
  };
}

export default {
  validateApiKey,
  revalidateCacheTag,
  revalidateCacheTags,
  getAllCacheTags,
  getCacheStats,
};
