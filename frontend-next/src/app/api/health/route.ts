import { NextResponse } from 'next/server';
import { sql, ensureDbInitialized } from '@/lib/db';
import { ensureCacheSchema } from '@/lib/cache-schema';
import { redisCacheStatus } from '@/lib/redis-cache';

export async function GET() {
  let dbOk = false;
  try {
    await ensureDbInitialized();
    const res = await sql`SELECT 1 as val`;
    dbOk = res && res.length > 0;
  } catch {}

  let cacheOk = false;
  try { await ensureCacheSchema(); cacheOk = true; } catch {}

  const redis = await redisCacheStatus();
  return NextResponse.json({
    status: dbOk && cacheOk && redis !== 'unavailable' ? 'healthy' : 'degraded',
    database: dbOk ? 'connected' : 'disconnected',
    cache: cacheOk ? 'postgresql+memory' : 'unavailable',
    redis,
    queue: cacheOk ? 'postgresql' : 'unavailable',
    platform: 'Next.js',
    timestamp: new Date().toISOString()
  });
}
