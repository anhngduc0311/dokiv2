// Run with --env-file=<private file containing SOURCE_DATABASE_URL and TARGET_DATABASE_URL>.
// The target must be empty. The source is never modified. Stop writers before running.
import { neon } from '@neondatabase/serverless';
import fs from 'node:fs';

const source = neon(process.env.SOURCE_DATABASE_URL);
const target = neon(process.env.TARGET_DATABASE_URL);
const quote = value => '"' + value.replaceAll('"', '""') + '"';
if (process.env.SOURCE_DATABASE_URL === process.env.TARGET_DATABASE_URL) throw new Error('Source and target must differ');
const existing = await target`SELECT tablename FROM pg_tables WHERE schemaname = 'public'`;
if (existing.length) throw new Error('Target is not empty; refusing to overwrite existing data');

const tables = await source`SELECT c.relname AS name FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relkind = 'r' ORDER BY c.relname`;
const manifest = [];
const constraints = [];
const indexes = [];
for (const { name } of tables) {
  const columns = await source`SELECT a.attname AS name, format_type(a.atttypid, a.atttypmod) AS type,
    a.attnotnull AS required, pg_get_expr(d.adbin, d.adrelid) AS "default"
    FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid JOIN pg_namespace n ON n.oid = c.relnamespace
    LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
    WHERE n.nspname = 'public' AND c.relname = ${name} AND a.attnum > 0 AND NOT a.attisdropped ORDER BY a.attnum`;
  await target.query('CREATE TABLE ' + quote(name) + ' (' + columns.map(c => quote(c.name) + ' ' + c.type
    + (c.default ? ' DEFAULT ' + c.default : '') + (c.required ? ' NOT NULL' : '')).join(', ') + ')');
  const cons = await source`SELECT con.conname AS name, con.contype AS type, pg_get_constraintdef(con.oid) AS definition
    FROM pg_constraint con JOIN pg_class c ON c.oid = con.conrelid JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname = ${name}`;
  constraints.push(...cons.map(c => ({ ...c, table: name })));
  const idx = await source`SELECT indexdef FROM pg_indexes i WHERE i.schemaname = 'public' AND i.tablename = ${name}
    AND NOT EXISTS (SELECT 1 FROM pg_constraint con JOIN pg_class c ON c.oid = con.conindid WHERE c.relname = i.indexname)`;
  indexes.push(...idx.map(i => i.indexdef));
}
// Copy each table in deterministic order while retaining all IDs and password hashes.
for (const { name } of tables) {
  const primary = constraints.find(c => c.table === name && c.type === 'p');
  const order = primary ? primary.definition.match(/PRIMARY KEY \((.+)\)/)[1] : 'ctid';
  let copied = 0;
  while (true) {
    const rows = await source.query('SELECT row_to_json(t)::text AS json FROM (SELECT * FROM ' + quote(name) + ' ORDER BY ' + order + ' LIMIT 2000 OFFSET $1) t', [copied]);
    if (!rows.length) break;
    await target.query('INSERT INTO ' + quote(name) + ' SELECT * FROM jsonb_populate_recordset(NULL::' + quote(name) + ', $1::jsonb)', ['[' + rows.map(r => r.json).join(',') + ']']);
    copied += rows.length;
    if (copied % 20000 === 0) console.log(name, copied);
  }
  // Verify content as well as row counts without printing private records.
  const fingerprint = 'SELECT count(*)::int AS count, coalesce(sum((\'x\' || substr(md5(row_to_json(t)::text), 1, 15))::bit(60)::bigint), 0)::text AS checksum FROM ' + quote(name) + ' t';
  const [before, after] = await Promise.all([source.query(fingerprint), target.query(fingerprint)]);
  if (JSON.stringify(before) !== JSON.stringify(after)) throw new Error('Verification failed: ' + name);
  manifest.push({ table: name, ...after[0] });
  console.log('Verified', name, copied);
}
for (const c of constraints.sort((a, b) => Number(a.type === 'f') - Number(b.type === 'f'))) {
  await target.query('ALTER TABLE ' + quote(c.table) + ' ADD CONSTRAINT ' + quote(c.name) + ' ' + c.definition);
}
for (const ddl of indexes) await target.query(ddl);
fs.writeFileSync('.next/database-migration-verification.json', JSON.stringify(manifest, null, 2));
console.log('Migration complete; every table count and content checksum matched.');
