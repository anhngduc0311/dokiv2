import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import zlib from 'node:zlib';
import {
  isRotatingProxyEnabled,
  parseProxyHttp,
  parseProxyTtlSeconds,
  parseProxyCooldownSeconds,
  getRotatingProxy,
  fetchViaRotatingProxy,
  requestThroughHttpProxy,
  resetRotatingProxyState,
} from '../frontend-next/src/lib/rotating-proxy.ts';

// 1. Parsing tests
assert.deepEqual(parseProxyHttp('160.250.166.36:10168::'), { host: '160.250.166.36', port: 10168 });
assert.deepEqual(parseProxyHttp('160.250.166.36:10168:alice:s3cr3t'), {
  host: '160.250.166.36',
  port: 10168,
  username: 'alice',
  password: 's3cr3t',
});
assert.deepEqual(parseProxyHttp('10.0.0.1:8080'), { host: '10.0.0.1', port: 8080 });
assert.equal(parseProxyHttp('bad-value'), null);
assert.equal(parseProxyHttp('10.0.0.1:99999'), null);
assert.equal(parseProxyHttp(''), null);

assert.equal(parseProxyTtlSeconds('proxy nay se die sau 1746s'), 1701);
assert.equal(parseProxyTtlSeconds('proxy nay se die sau 40s'), 30);
assert.equal(parseProxyTtlSeconds('unknown message'), 555);

assert.equal(parseProxyCooldownSeconds('Con 38s moi co the doi proxy'), 38);
assert.equal(parseProxyCooldownSeconds('no number'), 30);

// 2. Mock upstream + local HTTP proxy + mock proxy.vn API
const upstream = http.createServer((req, res) => {
  if (req.url === '/gzip') {
    const body = zlib.gzipSync(Buffer.from(JSON.stringify({ ok: true, path: req.url })));
    res.writeHead(200, { 'Content-Type': 'application/json', 'Content-Encoding': 'gzip' });
    res.end(body);
    return;
  }
  if (req.url === '/blocked') {
    res.writeHead(403, { 'Content-Type': 'text/html' });
    res.end('<title>Attention Required! | Cloudflare</title>');
    return;
  }
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('ok:' + req.method + ':' + req.url);
});

await new Promise(resolve => upstream.listen(0, '127.0.0.1', resolve));
const upstreamPort = upstream.address().port;

let proxyRequests = 0;
let lastProxyAuth = '';
const mockProxy = http.createServer((req, res) => {
  proxyRequests++;
  lastProxyAuth = req.headers['proxy-authorization'] || '';
  const target = new URL(req.url);
  const fwd = http.request(
    {
      hostname: target.hostname,
      port: target.port,
      path: target.pathname + target.search,
      method: req.method,
      headers: { ...req.headers, host: target.host },
    },
    upRes => {
      res.writeHead(upRes.statusCode || 502, upRes.headers);
      upRes.pipe(res);
    }
  );
  req.pipe(fwd);
});

mockProxy.on('connect', (req, clientSocket, head) => {
  proxyRequests++;
  const [host, port] = req.url.split(':');
  const serverSocket = net.connect(Number(port), host, () => {
    clientSocket.write('HTTP/1.0 200 Connection established\r\n\r\n');
    if (head.length) serverSocket.write(head);
    serverSocket.pipe(clientSocket);
    clientSocket.pipe(serverSocket);
  });
  serverSocket.on('error', () => clientSocket.destroy());
});

await new Promise(resolve => mockProxy.listen(0, '127.0.0.1', resolve));
const proxyPort = mockProxy.address().port;

const originalFetch = globalThis.fetch;
const savedEnv = {
  PROXY_VN_API_KEY: process.env.PROXY_VN_API_KEY,
  PROXY_VN_API_URL: process.env.PROXY_VN_API_URL,
};

try {
  delete process.env.PROXY_VN_API_KEY;
  resetRotatingProxyState();
  assert.equal(isRotatingProxyEnabled(), false);
  assert.equal(await getRotatingProxy(), null);

  process.env.PROXY_VN_API_KEY = 'test-key-123';
  process.env.PROXY_VN_API_URL = 'https://proxyxoay.shop/api/get.php';
  resetRotatingProxyState();
  assert.equal(isRotatingProxyEnabled(), true);

  let apiCalls = 0;
  globalThis.fetch = async (url) => {
    apiCalls++;
    assert.ok(String(url).includes('key=test-key-123'));
    if (apiCalls === 1) {
      return Response.json({
        status: 100,
        message: 'proxy nay se die sau 1200s',
        proxyhttp: `127.0.0.1:${proxyPort}:user1:pass1`,
        ip: '14.179.45.65',
        'Nha Mang': 'vnpt',
        'Vi Tri': 'DongNai1',
      });
    }
    return Response.json({
      status: 101,
      message: 'Con 45s moi co the doi proxy',
    });
  };

  // Single-flight deduplication: concurrent calls only hit API once
  const [l1, l2] = await Promise.all([getRotatingProxy(), getRotatingProxy()]);
  assert.equal(apiCalls, 1, 'Concurrent lease requests must deduplicate');
  assert.equal(l1.endpoint.port, proxyPort);
  assert.equal(l2.endpoint.port, proxyPort);
  assert.equal(l1.ip, '14.179.45.65');

  // Cached reuse does not call API again
  const l3 = await getRotatingProxy();
  assert.equal(apiCalls, 1);
  assert.equal(l3.endpoint.port, proxyPort);

  // HTTP request through proxy with Basic auth + gzip decompression
  const gzipRes = await fetchViaRotatingProxy(`http://127.0.0.1:${upstreamPort}/gzip`);
  assert.equal(gzipRes.status, 200);
  assert.deepEqual(gzipRes.json(), { ok: true, path: '/gzip' });
  assert.equal(lastProxyAuth, 'Basic ' + Buffer.from('user1:pass1').toString('base64'));

  // Plain request through proxy
  const plainRes = await requestThroughHttpProxy(`http://127.0.0.1:${upstreamPort}/hello`, {
    host: '127.0.0.1',
    port: proxyPort,
  });
  assert.equal(plainRes.status, 200);
  assert.equal(plainRes.text(), 'ok:GET:/hello');

  // Blocked response respects cooldown and does not hammer proxy.vn
  const blockedRes = await fetchViaRotatingProxy(`http://127.0.0.1:${upstreamPort}/blocked`);
  assert.equal(blockedRes.status, 403);
  assert.equal(apiCalls, 1, 'Cooldown must prevent immediate proxy.vn API spam');
  assert.ok(proxyRequests >= 3);

  console.log('Rotating proxy parsing, leasing, cooldown, auth, and HTTP proxy checks passed');
} finally {
  globalThis.fetch = originalFetch;
  if (savedEnv.PROXY_VN_API_KEY === undefined) delete process.env.PROXY_VN_API_KEY;
  else process.env.PROXY_VN_API_KEY = savedEnv.PROXY_VN_API_KEY;
  if (savedEnv.PROXY_VN_API_URL === undefined) delete process.env.PROXY_VN_API_URL;
  else process.env.PROXY_VN_API_URL = savedEnv.PROXY_VN_API_URL;
  resetRotatingProxyState();
  upstream.close();
  mockProxy.close();
}
