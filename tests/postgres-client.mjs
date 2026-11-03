import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(new URL('../frontend-next/package.json', import.meta.url));
const ts = require('typescript');
const calls = [];
let fail = false;
let options;
const client = {
  async query(statement) {
    calls.push(statement);
    if (fail && statement.text === 'fail') throw new Error('test failure');
    return { rows: [{ ok: 1 }] };
  },
  release(destroy) { calls.push({ release: destroy }); }
};
class Pool {
  constructor(value) { options = value; }
  on() {}
  async connect() { calls.push('CONNECT'); return client; }
  async end() {}
}
const code = ts.transpileModule(fs.readFileSync(new URL('../frontend-next/src/lib/postgres-client.ts', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
}).outputText;
const module = { exports: {} };
new Function('require', 'module', 'exports', code)(name => { assert.equal(name, 'pg'); return { Pool }; }, module, module.exports);
const sql = module.exports.createPostgresSql('postgresql://example.test/db');
const name = "'; DROP TABLE Users; --";
const query = sql`SELECT ${name}::text AS name`;
assert.equal(calls.length, 0, 'Constructing a tagged query must not execute it');
assert.deepEqual(await query, [{ ok: 1 }]);
assert.equal(calls[1].text, 'SELECT $1::text AS name');
assert.deepEqual(calls[1].values, [name], 'Values must stay parameterized');
calls.length = 0;
const batch = [sql`SELECT ${1}`, sql`SELECT ${2}`];
assert.equal(calls.length, 0);
assert.equal((await sql.transaction(batch)).length, 2);
assert.equal(calls.filter(item => item === 'CONNECT').length, 1);
assert.equal(calls[1], 'BEGIN');
assert.equal(calls.at(-2), 'COMMIT');
calls.length = 0; fail = true;
await assert.rejects(sql.transaction([sql.query('fail')]), /test failure/);
assert.equal(calls.at(-2), 'ROLLBACK');
assert.deepEqual(calls.at(-1), { release: true });
calls.length = 0;
const aborted = AbortSignal.abort();
await assert.rejects(Promise.resolve(sql.query('SELECT 1', [], { fetchOptions: { signal: aborted } })));
assert.equal(calls.length, 0);
assert.equal(options.max, 4);
console.log('Native PostgreSQL parameterization, lazy atomic transactions, rollback and connection release passed');
