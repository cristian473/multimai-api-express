/**
 * Helper functions for generating flexible cache keys with fuzzy matching
 */

import crypto from 'crypto';

/**
 * Calculate Levenshtein distance between two strings
 * Used for fuzzy matching of cache keys
 */
function levenshteinDistance(str1: string, str2: string): number {
  const len1 = str1.length;
  const len2 = str2.length;
  const matrix: number[][] = [];

  for (let i = 0; i <= len1; i++) {
    matrix[i] = [i];
  }

  for (let j = 0; j <= len2; j++) {
    matrix[0][j] = j;
  }

  for (let i = 1; i <= len1; i++) {
    for (let j = 1; j <= len2; j++) {
      const cost = str1[i - 1] === str2[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1, // deletion
        matrix[i][j - 1] + 1, // insertion
        matrix[i - 1][j - 1] + cost // substitution
      );
    }
  }

  return matrix[len1][len2];
}

/**
 * Calculate similarity score between two strings (0 to 1)
 * 1 = identical, 0 = completely different
 */
export function calculateSimilarity(str1: string, str2: string): number {
  const maxLength = Math.max(str1.length, str2.length);
  if (maxLength === 0) return 1;

  const distance = levenshteinDistance(str1, str2);
  return 1 - distance / maxLength;
}

/**
 * Normalize a string for comparison:
 * - Lowercase
 * - Remove accents
 * - Trim whitespace
 * - Remove extra spaces
 */
export function normalizeString(str: string): string {
  return str
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // Remove accents
    .trim()
    .replace(/\s+/g, ' '); // Normalize spaces
}

/**
 * Normalize search parameters for cache key generation:
 * - Remove null/undefined values
 * - Convert to lowercase
 * - Sort keys alphabetically
 * - Normalize string values
 */
export function normalizeSearchParams(params: Record<string, any>): Record<string, any> {
  const normalized: Record<string, any> = {};

  // Get only non-null values
  const keys = Object.keys(params)
    .filter((key) => params[key] !== null && params[key] !== undefined)
    .sort(); // Sort alphabetically for consistent ordering

  for (const key of keys) {
    const value = params[key];

    if (typeof value === 'string') {
      normalized[key] = normalizeString(value);
    } else if (Array.isArray(value)) {
      // Normalize array values and sort them
      normalized[key] = value
        .map((v) => (typeof v === 'string' ? normalizeString(v) : v))
        .sort();
    } else {
      normalized[key] = value;
    }
  }

  return normalized;
}

/**
 * Generate a stable hash from normalized parameters
 */
export function generateParamsHash(params: Record<string, any>): string {
  const normalized = normalizeSearchParams(params);
  const serialized = JSON.stringify(normalized);

  return crypto
    .createHash('sha256')
    .update(serialized)
    .digest('hex')
    .substring(0, 16);
}

/**
 * Check if two parameter sets are similar enough to be considered a cache hit
 * Returns true if similarity is above threshold
 */
export function areSimilarSearchParams(
  params1: Record<string, any>,
  params2: Record<string, any>,
  threshold: number = 0.85
): boolean {
  const norm1 = normalizeSearchParams(params1);
  const norm2 = normalizeSearchParams(params2);

  const keys1 = Object.keys(norm1).sort();
  const keys2 = Object.keys(norm2).sort();

  // If different number of parameters, check if all keys are similar
  if (keys1.length !== keys2.length) {
    return false;
  }

  // Check if all keys match
  for (let i = 0; i < keys1.length; i++) {
    if (keys1[i] !== keys2[i]) {
      return false;
    }
  }

  // Compare values for each key
  let totalSimilarity = 0;
  let comparisonCount = 0;

  for (const key of keys1) {
    const val1 = norm1[key];
    const val2 = norm2[key];

    if (typeof val1 === 'string' && typeof val2 === 'string') {
      totalSimilarity += calculateSimilarity(val1, val2);
      comparisonCount++;
    } else if (Array.isArray(val1) && Array.isArray(val2)) {
      // For arrays, check if they're identical after normalization
      if (JSON.stringify(val1) === JSON.stringify(val2)) {
        totalSimilarity += 1;
      } else {
        totalSimilarity += 0.5; // Partial match for different arrays
      }
      comparisonCount++;
    } else {
      // For other types, exact match required
      if (val1 === val2) {
        totalSimilarity += 1;
      }
      comparisonCount++;
    }
  }

  const averageSimilarity = comparisonCount > 0 ? totalSimilarity / comparisonCount : 0;
  return averageSimilarity >= threshold;
}

/**
 * Generate a flexible cache key for search parameters
 * Uses normalized parameters to ensure similar searches hit the same cache
 */
export function generateSearchCacheKey(
  functionName: string,
  params: Record<string, any>,
  prefix: string = 'search'
): string {
  const hash = generateParamsHash(params);
  return `${prefix}:${functionName}:${hash}`;
}

/**
 * Example usage and tests
 */
export const examples = {
  // These should generate the same cache key:
  similar1: {
    ubicacion: 'Buenos Aires',
    tipo_operacion: 'Alquiler',
    ambientes: 2,
  },
  similar2: {
    tipo_operacion: 'alquiler', // Different order and case
    ubicacion: 'buenos aires',
    ambientes: 2,
    otro: null, // Null values are ignored
  },

  // These should be considered similar (85%+ match):
  fuzzy1: {
    ubicacion: 'Palermo',
    tipo_propiedad: 'Departamento',
  },
  fuzzy2: {
    ubicacion: 'palermo', // Different case
    tipo_propiedad: 'departamento',
  },
};
