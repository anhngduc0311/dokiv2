import { NextResponse } from 'next/server';
import { sql, ensureDbInitialized } from '@/lib/db';
import { ensureCacheSchema } from '@/lib/cache-schema';

export async function GET() {
  let dbOk = false;
  try {
    await ensureDbInitialized();
    const res = await sql`SELECT 1 as val`;
    dbOk = res && res.length > 0;
  } catch {}

  let cacheOk = false;
  try { await ensureCacheSchema(); cacheOk = true; } catch {}

  return NextResponse.json({
    status: dbOk && cacheOk ? 'healthy' : 'degraded',
    database: dbOk ? 'connected' : 'disconnected',
    cache: cacheOk ? 'postgresql+memory' : 'unavailable',
    queue: cacheOk ? 'postgresql' : 'unavailable',
    platform: 'Next.js on cPanel',
    timestamp: new Date().toISOString()
  });
}
