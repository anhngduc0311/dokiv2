import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(new URL('../frontend-next/package.json', import.meta.url));
const ts = require('typescript');
const code = ts.transpileModule(fs.readFileSync(new URL('../frontend-next/src/lib/postgres-http-client.ts', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
}).outputText;
const module = { exports: {} };
const requests = [];
let status = 200;
const fakeFetch = async (url, options) => {
  options.signal.throwIfAborted();
  requests.push({ url, ...options, body: JSON.parse(options.body) });
  return { ok: status === 200, status, json: async () => ({ results: JSON.parse(options.body).queries.map(q => [{ value: q.values[0] }]) }) };
};
new Function('module', 'exports', 'fetch', code)(module, module.exports, fakeFetch);
assert.throws(() => module.exports.createPostgresHttpSql('http://example.test', 'secret'), /HTTPS/);
const sql = module.exports.createPostgresHttpSql('https://example.test/private/query', 'private-token');
const value = "'; DROP TABLE Users; --";
const query = sql`SELECT ${value}`;
assert.equal(requests.length, 0, 'Queries stay lazy');
assert.deepEqual(await query, [{ value }]);
assert.equal(requests[0].body.queries[0].text, 'SELECT $1');
assert.deepEqual(requests[0].body.queries[0].values, [value]);
assert.equal(requests[0].redirect, 'error');
assert.equal(requests[0].cache, 'no-store');
requests.length = 0;
assert.deepEqual(await sql.transaction([sql`SELECT ${1}`, sql`SELECT ${2}`]), [[{ value: 1 }], [{ value: 2 }]]);
assert.equal(requests.length, 1, 'Transaction is a single atomic gateway request');
assert.equal(requests[0].body.transaction, true);
requests.length = 0;
await assert.rejects(Promise.resolve(sql.query('SELECT 1', [], { fetchOptions: { signal: AbortSignal.abort() } })));
assert.equal(requests.length, 0);
status = 502;
await assert.rejects(Promise.resolve(sql`SELECT ${1}`), /502/);
assert.equal(requests.length, 1, 'Failed writes must never automatically retry');
console.log('Private HTTPS parameterization, atomic batch request, cancellation and no-retry checks passed');
