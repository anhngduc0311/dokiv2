// Run before enabling the worker, against a database with no queued production jobs.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
const require = createRequire(new URL('../frontend-next/package.json', import.meta.url));
const { build } = require('esbuild');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve('frontend-next');
const outfile = path.join(root, '.next/cache-queue-test.cjs');
await build({ stdin: { contents: `export * from './src/lib/cache'; export * from './src/lib/job-queue'; export * from './src/lib/db-client'; export * from './src/lib/catalog-cache';`, resolveDir: root },
  outfile, bundle: true, platform: 'node', format: 'cjs', packages: 'external', logLevel: 'silent' });
const { cacheGet, cacheRead, cacheSet, cacheDelete, sql, cachedCatalog,
  enqueueJob, claimJob, finishJob, acquireWorker, releaseWorker } = require(outfile);
const { neonConfig } = require('@neondatabase/serverless');
let calls = 0;
neonConfig.fetchFunction = (...args) => { calls++; return fetch(...args); };
const prefix = 'test:' + randomUUID();
const key = prefix + ':cache';
const originalNow = Date.now;
try {
  await cacheSet(key, { marker: 'original' }, 1, 60, true);
  const before = calls;
  assert.deepEqual(await cacheGet(key), { marker: 'original' });
  assert.equal(calls, before, 'Warm memory reads make no database requests');
  Date.now = () => originalNow() + 2000;
  assert.equal(await cacheGet(key), null, 'Strict cache reads reject expired entries');
  assert.equal((await cacheRead(key)).fresh, false, 'Expired entries remain available as stale');
  await sql`UPDATE "AppCache" SET "Value" = '{"marker":"worker-updated"}'::jsonb,
    "ExpiresAt" = now() + interval '1 hour', "StaleUntil" = now() + interval '2 hours' WHERE "Key" = ${key}`;
  Date.now = () => originalNow() + 18000;
  assert.equal((await cacheRead(key)).value.marker, 'worker-updated', 'App observes a refresh from another process');
  Date.now = originalNow;

  const staleKey = prefix + ':page';
  await cacheSet(staleKey, { items: ['previous'] }, 1, 60, true);
  Date.now = () => originalNow() + 2000;
  let loads = 0;
  const load = async () => { loads++; return { items: ['new'] }; };
  assert.deepEqual(await cachedCatalog(staleKey, {}, load), { items: ['previous'] });
  assert.equal(loads, 0, 'Stale requests enqueue a refresh without loading upstream data');
  await sql`DELETE FROM "BackgroundJobs" WHERE "JobKey" = ${staleKey}`;
  await assert.rejects(cachedCatalog(staleKey, {}, async () => { throw new Error('Upstream offline'); }, true));
  assert.deepEqual((await cacheRead(staleKey)).value, { items: ['previous'] }, 'Failed refresh preserves stale data');
  Date.now = originalNow;

  await Promise.all(Array.from({ length: 6 }, () => enqueueJob(prefix + ':job', 'test', {})));
  const claims = (await Promise.all(Array.from({ length: 6 }, () => claimJob()))).filter(Boolean);
  assert.equal(claims.length, 1, 'Concurrent consumers claim a queued job only once');
  const first = claims[0];
  await sql`UPDATE "BackgroundJobs" SET "LeaseUntil" = now() - interval '1 second' WHERE "Id" = ${first.Id}`;
  const recovered = await claimJob();
  assert.equal(recovered.Id, first.Id, 'Expired leases can be recovered');
  assert.notEqual(recovered.LeaseToken, first.LeaseToken);
  await finishJob(first);
  assert.equal((await sql`SELECT "Status" FROM "BackgroundJobs" WHERE "Id" = ${first.Id}`)[0].Status, 'running', 'Old workers cannot acknowledge a recovered job');
  await finishJob(recovered, new Error('temporary'));
  assert.equal(await claimJob(), null, 'Failed jobs respect retry backoff');
  await sql`UPDATE "BackgroundJobs" SET "AvailableAt" = now(), "Attempts" = 4 WHERE "Id" = ${first.Id}`;
  const last = await claimJob();
  await finishJob(last, new Error('permanent'));
  assert.equal((await sql`SELECT "Status" FROM "BackgroundJobs" WHERE "Id" = ${first.Id}`)[0].Status, 'failed', 'Attempts are bounded');

  const lease = await acquireWorker();
  assert.ok(lease);
  assert.equal(await acquireWorker(), null, 'Overlapping cron workers are excluded');
  await releaseWorker(lease);
  console.log('PostgreSQL integration passed: memory fast path, stale refresh, cross-process updates, duplicate claims, lease recovery, retry backoff and worker exclusion.');
} finally {
  Date.now = originalNow;
  await cacheDelete(key);
  await cacheDelete(prefix + ':page');
  await sql`DELETE FROM "BackgroundJobs" WHERE "JobKey" LIKE ${prefix + '%'}`;
  fs.rmSync(outfile, { force: true });
}
