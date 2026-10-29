import { sql } from './db-client';

let schema: Promise<unknown> | undefined;
export function ensureCacheSchema(): Promise<unknown> {
  return schema ??= sql.transaction([
    sql`CREATE TABLE IF NOT EXISTS "AppCache" (
      "Key" text PRIMARY KEY, "Value" jsonb NOT NULL,
      "ExpiresAt" timestamptz NOT NULL, "StaleUntil" timestamptz NOT NULL,
      "UpdatedAt" timestamptz NOT NULL DEFAULT now()
    )`,
    sql`CREATE INDEX IF NOT EXISTS "AppCache_StaleUntil" ON "AppCache" ("StaleUntil")`,
    sql`CREATE TABLE IF NOT EXISTS "BackgroundJobs" (
      "Id" uuid PRIMARY KEY, "JobKey" text NOT NULL UNIQUE,
      "Type" text NOT NULL, "Payload" jsonb NOT NULL,
      "Status" text NOT NULL DEFAULT 'pending', "Attempts" integer NOT NULL DEFAULT 0,
      "AvailableAt" timestamptz NOT NULL DEFAULT now(), "LeaseUntil" timestamptz,
      "LeaseToken" uuid, "LastError" text, "UpdatedAt" timestamptz NOT NULL DEFAULT now()
    )`,
    sql`CREATE INDEX IF NOT EXISTS "BackgroundJobs_Ready" ON "BackgroundJobs" ("AvailableAt")
      WHERE "Status" IN ('pending', 'running')`,
    sql`CREATE TABLE IF NOT EXISTS "WorkerLeases" (
      "Name" text PRIMARY KEY, "Token" uuid NOT NULL, "ExpiresAt" timestamptz NOT NULL
    )`
  ]).catch(error => { schema = undefined; throw error; });
}
