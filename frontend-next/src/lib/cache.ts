import { sql } from './db-client';
import { ensureCacheSchema } from './cache-schema';

type Entry = { json: string; expires: number; staleUntil: number; checkedAt: number };
const memory = new Map<string, Entry>();
const reads = new Map<string, Promise<CacheEntry<unknown> | null>>();
let memoryBytes = 0;
let retryAfter = 0;
const MAX_BYTES = 24 * 1024 * 1024;
const MAX_ENTRY_BYTES = 2 * 1024 * 1024;

export type CacheEntry<T> = { value: T; fresh: boolean };
function remember(key: string, entry: Entry) {
  forget(key);
  if (Buffer.byteLength(entry.json) > MAX_ENTRY_BYTES) return;
  memory.set(key, entry);
  memoryBytes += Buffer.byteLength(entry.json);
  while (memoryBytes > MAX_BYTES || memory.size > 500) forget(memory.keys().next().value!);
}
function forget(key: string) {
  const entry = memory.get(key);
  if (entry) memoryBytes -= Buffer.byteLength(entry.json);
  memory.delete(key);
}

export async function cacheRead<T>(key: string): Promise<CacheEntry<T> | null> {
  const local = memory.get(key);
  if (local && local.staleUntil > Date.now() && (local.expires > Date.now() || local.checkedAt > Date.now() - 15000 || retryAfter > Date.now())) {
    return { value: JSON.parse(local.json), fresh: local.expires > Date.now() };
  }
  if (local && local.staleUntil <= Date.now()) forget(key);
  if (retryAfter > Date.now()) return null;
  const pending = reads.get(key);
  if (pending) return pending as Promise<CacheEntry<T> | null>;
  const request = (async () => {
    try {
      await ensureCacheSchema();
      const rows = await sql.query('SELECT "Value", "ExpiresAt", "StaleUntil" FROM "AppCache" WHERE "Key" = $1 AND "StaleUntil" > now()', [key], {
        fetchOptions: { signal: AbortSignal.timeout(2000) }
      });
      if (!rows[0]) { forget(key); return null; }
      const entry = { json: JSON.stringify(rows[0].Value), expires: Date.parse(rows[0].ExpiresAt), staleUntil: Date.parse(rows[0].StaleUntil), checkedAt: Date.now() };
      remember(key, entry);
      return { value: JSON.parse(entry.json), fresh: entry.expires > Date.now() };
    } catch {
      retryAfter = Date.now() + 15000;
      return local && local.staleUntil > Date.now() ? { value: JSON.parse(local.json), fresh: false } : null;
    } finally { reads.delete(key); }
  })();
  reads.set(key, request);
  return request as Promise<CacheEntry<T> | null>;
}

export async function cacheGet<T = unknown>(key: string): Promise<T | null> {
  const hit = await cacheRead<T>(key);
  return hit?.fresh ? hit.value : null;
}

export async function cacheReadMany<T>(keys: string[]): Promise<Map<string, CacheEntry<T>>> {
  const result = new Map<string, CacheEntry<T>>();
  const missing: string[] = [];
  for (const key of new Set(keys)) {
    const local = memory.get(key);
    if (local && local.staleUntil > Date.now()) {
      result.set(key, { value: JSON.parse(local.json), fresh: local.expires > Date.now() });
      if (local.checkedAt > Date.now() - 15000) continue;
    }
    missing.push(key);
  }
  if (!missing.length || retryAfter > Date.now()) return result;
  try {
    await ensureCacheSchema();
    const rows = await sql.query('SELECT "Key", "Value", "ExpiresAt", "StaleUntil" FROM "AppCache" WHERE "Key" = ANY($1::text[]) AND "StaleUntil" > now()', [missing], {
      fetchOptions: { signal: AbortSignal.timeout(2000) },
    });
    for (const key of missing) result.delete(key);
    for (const row of rows) {
      const entry = { json: JSON.stringify(row.Value), expires: Date.parse(row.ExpiresAt), staleUntil: Date.parse(row.StaleUntil), checkedAt: Date.now() };
      remember(row.Key, entry);
      result.set(row.Key, { value: JSON.parse(entry.json), fresh: entry.expires > Date.now() });
    }
  } catch {
    retryAfter = Date.now() + 15000;
  }
  return result;
}

export async function cacheSet(key: string, value: unknown, ttlSeconds = 300, staleSeconds = 0, requirePersistence = false): Promise<void> {
  const json = JSON.stringify(value);
  if (json === undefined || Buffer.byteLength(json) > MAX_ENTRY_BYTES) {
    if (requirePersistence) throw new Error('Cache entry exceeds the persistence limit');
    return;
  }
  const expires = Date.now() + Math.max(1, ttlSeconds) * 1000;
  const staleUntil = expires + Math.max(0, staleSeconds) * 1000;
  remember(key, { json, expires, staleUntil, checkedAt: Date.now() });
  if (retryAfter > Date.now()) {
    if (requirePersistence) throw new Error('PostgreSQL cache is temporarily unavailable');
    return;
  }
  try {
    await ensureCacheSchema();
    await sql.query(`INSERT INTO "AppCache" ("Key", "Value", "ExpiresAt", "StaleUntil") VALUES ($1, $2::jsonb, $3, $4)
      ON CONFLICT ("Key") DO UPDATE SET "Value" = EXCLUDED."Value", "ExpiresAt" = EXCLUDED."ExpiresAt",
      "StaleUntil" = EXCLUDED."StaleUntil", "UpdatedAt" = now()`, [key, json, new Date(expires).toISOString(), new Date(staleUntil).toISOString()], {
      fetchOptions: { signal: AbortSignal.timeout(2000) }
    });
  } catch (error) {
    retryAfter = Date.now() + 15000;
    if (requirePersistence) throw error;
  }
}

export async function cacheDelete(key: string): Promise<void> {
  forget(key);
  await ensureCacheSchema();
  await sql`DELETE FROM "AppCache" WHERE "Key" = ${key}`;
}
