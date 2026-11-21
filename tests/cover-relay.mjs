import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(new URL('../frontend-next/package.json', import.meta.url));
const ts = require('typescript');
function load(file, dependencies = {}) {
  const code = ts.transpileModule(fs.readFileSync(new URL('../frontend-next/src/' + file, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  }).outputText;
  const module = { exports: {} };
  new Function('require', 'module', 'exports', code)(name => {
    assert.ok(name in dependencies, 'Unexpected dependency: ' + name);
    return dependencies[name];
  }, module, module.exports);
  return module.exports;
}
const helper = load('lib/cover-image.ts');
const original = 'https://mangadex.org/covers/6033535e-ea6a-4f52-9d81-17101a739c33/95230e9d-1676-428c-879c-3dd03fb1fd36.jpg';
const source = original.replace('mangadex.org', 'uploads.mangadex.org');
const legacy = 'https://services.f-ck.me/v1/image/' + Buffer.from(original + '.256.jpg').toString('base64url');
const expected = '/api/catalog/image-proxy?url=' + encodeURIComponent(source + '.256.jpg');
assert.equal(helper.coverImage(legacy), expected, 'Stored old cover URLs must use the working relay');
assert.equal(helper.coverImage(original + '.256.jpg'), expected);
assert.equal(helper.coverImage(expected), expected, 'Do not nest proxy URLs');
assert.equal(helper.coverImage(''), '/cover-placeholder.svg');
for (const unsafe of ['https://mangadex.org.evil.test/a', 'https://user:password@uploads.mangadex.org/a', 'http://uploads.mangadex.org/a']) {
  assert.equal(helper.mangaDexImageSource(unsafe), null);
}
assert.equal(helper.coverImage('https://example.com/cover.jpg'), 'https://example.com/cover.jpg');
assert.equal(helper.coverImage('https://services.f-ck.me/v1/image/invalid!'), 'https://services.f-ck.me/v1/image/invalid!');
const spotlight = load('lib/spotlight.ts', { './cover-image': helper });
assert.equal(spotlight.originalBannerCover(legacy), '/api/catalog/image-proxy?url=' + encodeURIComponent(source));
assert.equal(spotlight.originalBannerCover(expected), '/api/catalog/image-proxy?url=' + encodeURIComponent(source));
const route = load('app/api/catalog/image-proxy/route.ts', {
  '../../../../lib/cover-image': helper,
  'next/server': { NextResponse: class extends Response { static json(data, options) { return Response.json(data, options); } } }
});
const fetchBefore = globalThis.fetch;
const proxyBefore = process.env.MANGADEX_PROXY_URL;
try {
  process.env.MANGADEX_PROXY_URL = 'https://relay.test/private';
  let fetched;
  globalThis.fetch = async url => { fetched = url; return new Response('test-image', { headers: { 'Content-Type': 'image/jpeg' } }); };
  const response = await route.GET(new Request('https://site.test/api/catalog/image-proxy?url=' + encodeURIComponent(legacy)));
  assert.equal(response.status, 200);
  assert.equal(fetched, 'https://relay.test/private/image?url=' + encodeURIComponent(source + '.256.jpg'));
  assert.equal(await response.text(), 'test-image');

  delete process.env.MANGADEX_PROXY_URL;
  globalThis.fetch = async (url, options) => {
    assert.equal(url, source + '.256.jpg');
    assert.equal(options.headers['User-Agent'], 'DokiTruyen/1.0 (+https://dokitruyen.com)');
    return new Response('test-image', { headers: { 'Content-Type': 'image/jpeg' } });
  };
  const direct = await route.GET(new Request('https://site.test' + expected));
  assert.equal(direct.status, 200);
  assert.equal(await direct.text(), 'test-image');
} finally {
  globalThis.fetch = fetchBefore;
  if (proxyBefore === undefined) delete process.env.MANGADEX_PROXY_URL;
  else process.env.MANGADEX_PROXY_URL = proxyBefore;
}
console.log('Legacy cover recovery, canonical upload host, proxy idempotence, banner size and VPS forwarding passed');
