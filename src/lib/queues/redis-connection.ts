/**
 * Redis Connection for BullMQ
 * Provides a shared Redis connection for queue operations
 */

import Redis from 'ioredis';

let connection: Redis | null = null;

/**
 * Get or create Redis connection for BullMQ
 * Uses a dedicated connection separate from cache operations
 */
export function getQueueConnection(): Redis {
  if (!connection) {
    const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';

    connection = new Redis(redisUrl, {
      maxRetriesPerRequest: null, // Required for BullMQ
      enableReadyCheck: false, // Required for BullMQ
      retryStrategy: (times: number) => {
        const delay = Math.min(times * 50, 2000);
        return delay;
      },
    });

    connection.on('error', (err) => {
      console.error('[BullMQ Redis] Connection Error:', err);
    });

    connection.on('connect', () => {
      console.log('[BullMQ Redis] Connected');
    });
  }

  return connection;
}

/**
 * Close the queue Redis connection
 */
export async function closeQueueConnection(): Promise<void> {
  if (connection) {
    await connection.quit();
    connection = null;
    console.log('[BullMQ Redis] Connection closed');
  }
}


