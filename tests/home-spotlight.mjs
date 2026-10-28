import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(new URL('../frontend-next/package.json', import.meta.url));
const ts = require('typescript');
const React = require('react');
const { renderToString } = require('react-dom/server');
function load(path, dependencies) {
  const code = ts.transpileModule(fs.readFileSync(new URL(path, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true }
  }).outputText;
  const module = { exports: {} };
  new Function('require', 'module', 'exports', code)(name => {
    assert.ok(name in dependencies, `Unexpected dependency: ${name}`);
    return dependencies[name];
  }, module, module.exports);
  return module.exports;
}
const spotlight = load('../frontend-next/src/lib/spotlight.ts', {});
const empty = () => null;
let apiCalls = 0;
const client = load('../frontend-next/src/app/client.tsx', {
  react: React, 'react/jsx-runtime': require('react/jsx-runtime'),
  'next/link': ({ children, ...props }) => React.createElement('a', props, children),
  'next/navigation': { useRouter: () => ({}), useSearchParams: () => new URLSearchParams() },
  '../lib/api': { api: { request: () => { apiCalls++; return new Promise(() => {}); } } },
  '../contexts/store-context': { useStore: () => ({ isFollowed: () => false }) },
  '../lib/utils': { cleanDescription: text => text, statuses: {}, message: String },
  '../lib/spotlight': spotlight,
  '../components/ui/icon': { Icon: empty }, '../components/ui/manga-card': { MangaCard: empty },
  '../components/ui/pagination': { Pagination: empty }, '../components/layout/sidebar': { Sidebar: empty }
}).default;
const story = {
  id: 'romance', title: 'Banner hiện ngay', genres: ['Romance'], rating: 8,
  description: 'Nội dung có sẵn từ máy chủ.', status: 'ongoing', country: 'ja',
  cover: 'https://example.com/romance.jpg', contentRating: 'safe', follows: 100,
  chapters: [{ id: 'chapter-40', number: 40, language: 'vi', publishedAt: '2026-10-28T00:00:00Z' }]
};
const data = { items: [story], total: 1, page: 1, pageSize: 30 };
const page = load('../frontend-next/src/app/page.tsx', {
  'react/jsx-runtime': require('react/jsx-runtime'), './client': client,
  '@/lib/catalog-service': { getHomeCatalog: async () => data },
  '@/lib/seo-data': { toPage: value => value },
  '@/lib/seo': { pageNumber: () => 1, collectionSchema: () => ({}) },
  '@/components/seo/json-ld': { JsonLd: empty }, '@/lib/spotlight': spotlight
}).default;
const html = renderToString(await page({ searchParams: Promise.resolve({}) }));
assert.match(html, /<h1>Banner hiện ngay<\/h1>/, 'The first server HTML must already contain the spotlight');
assert.match(html, /class="spotlight-backdrop"[^>]*src="https:\/\/example.com\/romance.jpg"[^>]*fetchPriority="high"/);
assert.match(html, /href="\/chuong\/chapter-40"/);
assert.doesNotMatch(html, /Mỗi trang truyện/);
assert.equal(apiCalls, 0, 'The initial banner must not depend on any client API request');

// Continue adding verified banners while a slower image is still pending.
let releaseSlow;
const slow = new Promise(resolve => { releaseSlow = resolve; });
const updates = [];
const pending = spotlight.loadSpotlightImages([
  story, { ...story, id: 'slow', title: 'Slow', cover: '/slow.jpg' }
], url => url === '/slow.jpg' ? slow : Promise.resolve({ url, width: 1200, height: 800 }),
  selected => updates.push(selected.map(m => m.id)), () => true);
await new Promise(resolve => setImmediate(resolve));
assert.deepEqual(updates, [['romance']]);
releaseSlow({ url: '/slow.jpg', width: 1200, height: 800 });
await pending;
assert.equal(updates.at(-1).length, 2);

data.items = [];
data.total = 0;
const fallback = renderToString(await page({ searchParams: Promise.resolve({}) }));
assert.match(fallback, /Mỗi trang truyện/);
assert.doesNotMatch(fallback, /class="spotlight-backdrop"/);
assert.deepEqual(spotlight.rankSpotlightCandidates([{ ...story, genres: ['Action'] }].filter(spotlight.hasRomanceGenre)), []);
console.log('Home banner renders in initial HTML without client requests; progressive image loading and Romance selection passed');
