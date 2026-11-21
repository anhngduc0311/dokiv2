import Redis from 'ioredis';

const url = process.env.REDIS_URL;
const redis = url ? new Redis(url, {
  connectTimeout: 500,
  commandTimeout: 300,
  enableOfflineQueue: false,
  maxRetriesPerRequest: 0,
}) : null;

// PostgreSQL remains available when the shared cache is restarting.
redis?.on('error', () => {});

export function readRedisCache(key: string) {
  return redis?.get(key).catch(() => null);
}

export async function writeRedisCache(key: string, value: unknown, ttlSeconds: number) {
  if (!redis) return;
  const json = JSON.stringify(value);
  if (json !== undefined && Buffer.byteLength(json) <= 2 * 1024 * 1024) {
    await redis.set(key, json, 'EX', ttlSeconds).catch(() => {});
  }
}

export async function redisCacheStatus() {
  if (!redis) return 'disabled';
  return await redis.ping().catch(() => null) === 'PONG' ? 'connected' : 'unavailable';
}

export function closeRedisCache() {
  redis?.disconnect();
}
