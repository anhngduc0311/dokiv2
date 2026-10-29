import { sql } from './lib/db-client';
import { cacheRead } from './lib/cache';
import { acquireWorker, releaseWorker, enqueueJob, claimJob, finishJob, cleanupCacheAndJobs } from './lib/job-queue';
import { catalogPageKey, searchCatalog } from './lib/catalog-service';
import type { CatalogFilters } from './lib/mangadex-catalog';

const warm: CatalogFilters[] = [
  { page: 1, pageSize: 30, excludeManhuaManhwa: true, language: 'vi', sort: 'latest' },
  { page: 2, pageSize: 30, excludeManhuaManhwa: true, language: 'vi', sort: 'latest' },
  { page: 1, pageSize: 20, country: 'ko,zh', language: 'vi', sort: 'hot' },
  // Match the search route's explicit empty filters so the homepage's trending request shares this cache.
  { source: '', q: '', author: '', genre: '', status: '', country: '', demographic: '', language: 'vi', sort: 'hot', page: 1, pageSize: 28 }
];
async function main() {
  const token = await acquireWorker();
  if (!token) { console.log('Another catalog worker is active.'); return; }
  try {
    await cleanupCacheAndJobs();
    for (const params of warm) {
      const key = catalogPageKey(params);
      if (!(await cacheRead(key))?.fresh) await enqueueJob(key, 'catalog.refresh', params);
    }
    const deadline = Date.now() + (process.argv.includes('--warm') ? 12 * 60000 : 45000);
    while (Date.now() < deadline) {
      const job = await claimJob();
      if (!job) break;
      try {
        if (job.Type !== 'catalog.refresh') throw new Error('Unsupported job type');
        const params = job.Payload as CatalogFilters;
        const result = await searchCatalog(params, true);
        if (!result.items.length) throw new Error('Empty catalog; preserve previous cache');
        await finishJob(job);
        console.log('Catalog refreshed:', params.page || 1, params.sort || 'latest', result.items.length);
      } catch (error) {
        await finishJob(job, error);
        console.error('Catalog refresh failed; retry scheduled.');
      }
    }
    const rows = await sql`SELECT "Status", count(*)::int AS count FROM "BackgroundJobs" GROUP BY "Status"`;
    console.log('Queue:', JSON.stringify(rows));
  } finally { await releaseWorker(token); }
}
main().catch(() => { console.error('Worker could not reach PostgreSQL.'); process.exitCode = 1; });
