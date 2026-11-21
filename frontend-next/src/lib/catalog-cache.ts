import { cacheRead, cacheSet } from './cache';
import { enqueueJob } from './job-queue';
import { readRedisCache, writeRedisCache } from './redis-cache';

const FRESH_SECONDS = 300;
const loading = new Map<string, Promise<unknown>>();
const queued = new Map<string, number>();
export async function cachedCatalog<T>(key: string, payload: unknown, load: () => Promise<T>, force = false): Promise<T> {
  if (!force) {
    const shared = await readRedisCache(key);
    if (shared !== null && shared !== undefined) return JSON.parse(shared) as T;
    const hit = await cacheRead<T>(key);
    if (hit) {
      if (!hit.fresh && (queued.get(key) || 0) < Date.now()) {
        // Await only the short enqueue, never the upstream refresh. A rejected enqueue is retried later.
        try {
          await enqueueJob(key, 'catalog.refresh', payload);
          queued.set(key, Date.now() + 60000);
          if (queued.size > 500) queued.delete(queued.keys().next().value!);
        } catch { /* Stale catalog remains usable during database outages. */ }
      }
      return hit.value;
    }
  }
  const pending = loading.get(key);
  if (pending) return pending as Promise<T>;
  const request = (async () => {
    const result = await load();
    // Retain yesterday's catalog while a worker refreshes expired data.
    await cacheSet(key, result, FRESH_SECONDS, 86400, force);
    await writeRedisCache(key, result, FRESH_SECONDS);
    queued.delete(key);
    return result;
  })();
  loading.set(key, request);
  try { return await request; } finally { loading.delete(key); }
}
