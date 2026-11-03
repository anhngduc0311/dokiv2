/** Private SQL gateway. Nginx additionally restricts this endpoint to the cPanel IP. */
const http = require('node:http');
const { timingSafeEqual } = require('node:crypto');
const { Pool } = require('pg');
const TOKEN = process.env.DATABASE_HTTP_TOKEN;
if (!TOKEN || TOKEN.length < 48 || !process.env.DATABASE_PASSWORD) throw new Error('Private database service configuration missing');
const pool = new Pool({
  host: '127.0.0.1', port: 5432, database: 'dokitruyen', user: 'dokitruyen_app',
  password: process.env.DATABASE_PASSWORD,
  ssl: { rejectUnauthorized: true, servername: 'source.dokitruyen.com' },
  max: 4, idleTimeoutMillis: 10000, connectionTimeoutMillis: 5000,
  statement_timeout: 15000, idle_in_transaction_session_timeout: 15000,
});
pool.on('error', () => console.error('Idle database connection failed'));
const PATH = '/_dokitruyen_database/v1/query';
const MAX_BYTES = 4 * 1024 * 1024;
let active = 0;
function authorized(value) {
  const actual = Buffer.from(value || '');
  const expected = Buffer.from('Bearer ' + TOKEN);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
function reply(response, status, body) {
  response.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  response.end(JSON.stringify(body));
}
async function handler(request, response) {
  if (request.url !== PATH || request.method !== 'POST') return reply(response, 404, { error: 'Not found' });
  if (!authorized(request.headers.authorization)) return reply(response, 403, { error: 'Forbidden' });
  if (active >= 8) return reply(response, 503, { error: 'Busy' });
  active++;
  let client;
  let transaction = false;
  try {
    let size = 0;
    const chunks = [];
    for await (const chunk of request) {
      size += chunk.length;
      if (size > MAX_BYTES) return reply(response, 413, { error: 'Too large' });
      chunks.push(chunk);
    }
    let body;
    try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
    catch { return reply(response, 400, { error: 'Invalid request' }); }
    const queries = body?.queries;
    if (!Array.isArray(queries) || !queries.length || queries.length > 32 || typeof body.transaction !== 'boolean'
      || (!body.transaction && queries.length !== 1)
      || queries.some(q => typeof q?.text !== 'string' || q.text.length > 200000 || !Array.isArray(q.values))) {
      return reply(response, 400, { error: 'Invalid request' });
    }
    client = await pool.connect();
    transaction = body.transaction;
    if (transaction) await client.query('BEGIN');
    const results = [];
    for (const statement of queries) {
      const result = await client.query({ text: statement.text, values: statement.values });
      results.push(Array.isArray(result) ? result.flatMap(item => item.rows) : result.rows);
    }
    if (transaction) { await client.query('COMMIT'); transaction = false; }
    reply(response, 200, { results });
  } catch (error) {
    if (client && transaction) await client.query('ROLLBACK').catch(() => {});
    // Never log SQL, parameters, response bodies or credentials.
    console.error('Database request failed', /^[A-Z0-9]{5}$/.test(error.code || '') ? error.code : 'transport');
    if (!response.headersSent) reply(response, 502, { error: 'Database request failed' });
  } finally { if (client) client.release(); active--; }
}
const server = http.createServer(handler);
server.requestTimeout = 25000;
server.headersTimeout = 10000;
server.listen(8790, '127.0.0.1');
async function stop() { server.close(); await pool.end(); }
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
