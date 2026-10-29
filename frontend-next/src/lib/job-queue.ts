import { randomUUID } from 'node:crypto';
import { sql } from './db-client';
import { ensureCacheSchema } from './cache-schema';

export interface BackgroundJob { Id: string; Type: string; Payload: unknown; Attempts: number; LeaseToken: string }
export async function enqueueJob(key: string, type: string, payload: unknown): Promise<void> {
  await ensureCacheSchema();
  await sql`INSERT INTO "BackgroundJobs" ("Id", "JobKey", "Type", "Payload")
    VALUES (${randomUUID()}, ${key}, ${type}, ${JSON.stringify(payload)}::jsonb)
    ON CONFLICT ("JobKey") DO UPDATE SET "Status" = 'pending', "Attempts" = 0,
      "Payload" = EXCLUDED."Payload", "AvailableAt" = now(), "LastError" = NULL, "UpdatedAt" = now()
    WHERE "BackgroundJobs"."Status" IN ('done', 'failed')`;
}

export async function claimJob(): Promise<BackgroundJob | null> {
  await ensureCacheSchema();
  const token = randomUUID();
  const rows = await sql`WITH candidate AS (
    SELECT "Id" FROM "BackgroundJobs"
    WHERE ("Status" = 'pending' AND "AvailableAt" <= now()
      OR "Status" = 'running' AND "LeaseUntil" < now()) AND "Attempts" < 5
    ORDER BY "AvailableAt" FOR UPDATE SKIP LOCKED LIMIT 1
  ) UPDATE "BackgroundJobs" j SET "Status" = 'running', "Attempts" = j."Attempts" + 1,
    "LeaseUntil" = now() + interval '10 minutes', "LeaseToken" = ${token}, "UpdatedAt" = now()
    FROM candidate c WHERE j."Id" = c."Id" RETURNING j.*`;
  return (rows[0] as BackgroundJob | undefined) || null;
}

export async function finishJob(job: BackgroundJob, error?: unknown): Promise<void> {
  const failed = error !== undefined;
  const status = failed ? job.Attempts >= 5 ? 'failed' : 'pending' : 'done';
  // Keep queue diagnostics free of URLs, credentials and upstream response bodies.
  const message = failed ? 'Job failed; automatic retry scheduled when attempts remain.' : null;
  const delay = failed ? Math.min(900, 15 * 2 ** job.Attempts) : 0;
  await sql`UPDATE "BackgroundJobs" SET "Status" = ${status}, "LastError" = ${message},
    "AvailableAt" = now() + ${delay} * interval '1 second', "LeaseUntil" = NULL,
    "LeaseToken" = NULL, "UpdatedAt" = now()
    WHERE "Id" = ${job.Id} AND "LeaseToken" = ${job.LeaseToken} AND "Status" = 'running'`;
}

export async function acquireWorker(): Promise<string | null> {
  await ensureCacheSchema();
  const token = randomUUID();
  const rows = await sql`INSERT INTO "WorkerLeases" ("Name", "Token", "ExpiresAt")
    VALUES ('catalog', ${token}, now() + interval '15 minutes')
    ON CONFLICT ("Name") DO UPDATE SET "Token" = EXCLUDED."Token", "ExpiresAt" = EXCLUDED."ExpiresAt"
    WHERE "WorkerLeases"."ExpiresAt" < now() RETURNING "Token"`;
  return rows.length ? token : null;
}
export async function releaseWorker(token: string) {
  await sql`DELETE FROM "WorkerLeases" WHERE "Name" = 'catalog' AND "Token" = ${token}`;
}
export async function cleanupCacheAndJobs() {
  await ensureCacheSchema();
  await sql.transaction([
    sql`DELETE FROM "AppCache" WHERE "Key" IN (SELECT "Key" FROM "AppCache" WHERE "StaleUntil" < now() LIMIT 500)`,
    sql`UPDATE "BackgroundJobs" SET "Status" = 'failed', "UpdatedAt" = now()
      WHERE "Status" = 'running' AND "LeaseUntil" < now() AND "Attempts" >= 5`,
    sql`DELETE FROM "BackgroundJobs" WHERE "Id" IN (SELECT "Id" FROM "BackgroundJobs"
      WHERE "Status" IN ('done', 'failed') AND "UpdatedAt" < now() - interval '1 day' LIMIT 500)`
  ]);
}
