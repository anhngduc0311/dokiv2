import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import crypto from 'node:crypto';
import { Readable } from 'node:stream';
let handler, options;
const calls = [];
const client = {
  async query(statement) {
    calls.push(statement);
    if (statement.text === 'fail') throw Object.assign(new Error('private SQL and credential'), { code: '23505' });
    return { rows: [{ ok: true }] };
  },
  release() { calls.push('release'); }
};
class Pool {
  constructor(config) { options = config; }
  on() {}
  async connect() { calls.push('connect'); return client; }
  async end() {}
}
const token = 'test-token-'.repeat(8);
vm.runInNewContext(fs.readFileSync(new URL('../frontend-next/vps/database-http.cjs', import.meta.url), 'utf8'), {
  require: name => ({
    'node:http': { createServer(fn) { handler = fn; return { listen() {}, close() {} }; } },
    'node:crypto': crypto,
    pg: { Pool },
  })[name],
  process: { env: { DATABASE_HTTP_TOKEN: token, DATABASE_PASSWORD: 'fake-test-password' }, on() {} },
  Buffer,
  console: { error() {} },
});
async function request(body, authorization = `Bearer ${token}`, url = '/_dokitruyen_database/v1/query') {
  const input = Readable.from([Buffer.from(JSON.stringify(body))]);
  Object.assign(input, { url, method: 'POST', headers: { authorization } });
  const response = {
    headersSent: false,
    writeHead(status, headers) { this.status = status; this.headers = headers; this.headersSent = true; },
    end(value) { this.body = JSON.parse(value); }
  };
  await handler(input, response);
  return response;
}
assert.equal((await request({}, 'wrong')).status, 403);
assert.equal(calls.length, 0);
assert.equal((await request({}, `Bearer ${token}`, '/other')).status, 404);
assert.equal((await request({ queries: [], transaction: true })).status, 400);
assert.equal(calls.length, 0);
const value = "'; DROP TABLE Users; --";
let response = await request({ queries: [{ text: 'SELECT $1', values: [value] }], transaction: false });
assert.equal(response.status, 200);
assert.equal(response.headers['Cache-Control'], 'no-store');
assert.equal(calls[1].text, 'SELECT $1');
assert.equal(calls[1].values[0], value);
assert.equal(calls.at(-1), 'release');
calls.length = 0;
response = await request({ queries: [{ text: 'SELECT 1', values: [] }, { text: 'fail', values: [] }], transaction: true });
assert.equal(response.status, 502);
assert.equal(calls.filter(x => x === 'connect').length, 1);
assert.equal(calls[1], 'BEGIN');
assert.equal(calls.at(-2), 'ROLLBACK');
assert.equal(calls.includes('COMMIT'), false);
assert.deepEqual(response.body, { error: 'Database request failed' });
assert.equal(options.ssl.rejectUnauthorized, true);
assert.equal(options.ssl.servername, 'source.dokitruyen.com');
assert.equal(options.max, 4);
console.log('Gateway authentication, validation, bound parameters, atomic rollback and private errors passed');
