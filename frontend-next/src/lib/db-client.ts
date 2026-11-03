import { neon, type NeonQueryFunction } from '@neondatabase/serverless';
import { createPostgresSql } from './postgres-client';
import { createPostgresHttpSql } from './postgres-http-client';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL is required');

export const sql = process.env.DATABASE_DRIVER === 'postgres-http'
  ? createPostgresHttpSql(process.env.DATABASE_HTTP_URL || '', process.env.DATABASE_HTTP_TOKEN || '')
  : process.env.DATABASE_DRIVER === 'postgres'
    ? createPostgresSql(databaseUrl) as unknown as NeonQueryFunction<false, false>
    : neon(databaseUrl);
