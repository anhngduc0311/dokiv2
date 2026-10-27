import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import * as seo from '../frontend-next/src/lib/seo.ts';

const require = createRequire(new URL('../frontend-next/package.json', import.meta.url));
const ts = require('typescript');
function load(path, dependencies) {
  const code = ts.transpileModule(fs.readFileSync(new URL(path, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
  }).outputText;
  const module = { exports: {} };
  new Function('require', 'module', 'exports', code)(name => {
    assert.ok(name in dependencies, `Unexpected dependency: ${name}`);
    return dependencies[name];
  }, module, module.exports);
  return module.exports;
}

assert.equal(seo.pageNumber('-2'), 1);
assert.equal(seo.pageNumber('Infinity'), 10000);
assert.equal(seo.pageNumber('2.9'), 2);
const metadata = seo.pageMetadata('Truyện A', '<p>Mô tả</p>', '/truyen-tranh/test', '/cover.png');
assert.equal(metadata.alternates.canonical, seo.SITE_URL + '/truyen-tranh/test');
assert.equal(metadata.openGraph.url, metadata.alternates.canonical);
assert.equal(metadata.openGraph.images[0].url, seo.SITE_URL + '/cover.png');
assert.equal(metadata.twitter.title, metadata.title.absolute);
assert.equal(metadata.description, 'Mô tả');
assert.equal(seo.pageMetadata('Search', 'Search', '/', undefined, false).robots.index, false);
const attack = { title: '</script><script>alert(1)</script>', other: '\u2028\u2029' };
const safe = seo.serializeJsonLd(attack);
assert.ok(!safe.includes('<'));
assert.deepEqual(JSON.parse(safe), attack);
const breadcrumbs = seo.breadcrumbSchema([{ name: 'Trang chủ', path: '/' }, { name: 'Truyện A', path: '/truyen-tranh/a' }]);
assert.equal(breadcrumbs.itemListElement[1].position, 2);

let queries = 0;
const sitemap = load('../frontend-next/src/lib/sitemap.ts', {
  './seo': seo,
  './db': { sql: async () => {
    queries++;
    if (queries === 1) return [{ path: '/truyen-tranh/a', modified: '2026-10-20T12:00:00Z' }, { path: '/tac-gia/Tên & Họ', modified: null }];
    if (queries === 2) return [{ name: 'CatalogSourceRefs' }];
    return [{ path: '/chuong/b', modified: null }, { path: '/chuong/b', modified: null }];
  } },
});
const [rows, sameRows] = await Promise.all([sitemap.sitemapRows(), sitemap.sitemapRows()]);
assert.equal(rows, sameRows);
assert.equal(queries, 3, 'Concurrent sitemap requests share a single database snapshot');
assert.equal(rows.length, 3, 'Duplicate source references are removed');
assert.ok(rows.some(row => row.path === '/tac-gia/' + encodeURIComponent('Tên & Họ')));
await sitemap.sitemapRows();
assert.equal(queries, 3, 'Shard requests reuse the snapshot');
const xml = sitemap.urlset([{ path: '/?a=1&b=2', modified: '2026-10-20' }, { path: '/invalid-date', modified: 'bad' }]);
assert.ok(xml.includes('?a=1&amp;b=2'));
assert.ok(xml.includes('<lastmod>2026-10-20T00:00:00.000Z</lastmod>'));
assert.ok(!xml.includes('Invalid Date'));
assert.equal(sitemap.xmlEscape('<&"\''), '&lt;&amp;&quot;&apos;');
const shardRows = Array.from({ length: 5001 }, (_, i) => ({ path: `/chuong/${i}`, modified: null }));
const dependencies = { '@/lib/sitemap': { ...sitemap, sitemapRows: async () => shardRows }, '@/lib/seo': seo };
const index = load('../frontend-next/src/app/sitemap.xml/route.ts', dependencies);
const indexXml = await (await index.GET(new Request('https://attacker.invalid', { headers: { host: 'attacker.invalid' } }))).text();
assert.ok(!indexXml.includes('attacker.invalid'));
assert.equal((indexXml.match(/<sitemap>/g) || []).length, 3);
const shards = load('../frontend-next/src/app/sitemaps/[file]/route.ts', dependencies);
const getShard = file => shards.GET(new Request('https://example.test'), { params: Promise.resolve({ file }) });
assert.equal(((await (await getShard('0.xml')).text()).match(/<url>/g) || []).length, 5000);
assert.equal(((await (await getShard('1.xml')).text()).match(/<url>/g) || []).length, 1);
for (const file of ['2.xml', '-1.xml', '01.xml', 'NaN.xml']) assert.equal((await getShard(file)).status, 404);
const failed = load('../frontend-next/src/app/sitemap.xml/route.ts', { ...dependencies,
  '@/lib/sitemap': { ...sitemap, sitemapRows: async () => { throw new Error('offline'); } },
});
const failure = await failed.GET();
assert.equal(failure.status, 503);
assert.equal(failure.headers.get('Cache-Control'), 'no-store');
const robots = load('../frontend-next/src/app/robots.ts', { '@/lib/seo': seo }).default();
assert.equal(robots.rules.userAgent, '*');
assert.ok(robots.rules.disallow.includes('/admin'));
assert.ok(robots.rules.allow.includes('/api/catalog/image-proxy'));
assert.equal(robots.sitemap, seo.SITE_URL + '/sitemap.xml');
// Render the real interactive components on the server with isolated fixtures.
// No browser, live database or source API is involved in these checks.
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const utils = load('../frontend-next/src/lib/utils.ts', {});
const manga = { id: 'manga-id', title: 'Tên truyện SEO', description: 'Mô tả truyện render từ server', cover: '/cover-placeholder.svg',
  alternativeTitle: '', author: 'Tác giả A', genres: ['Action'], status: 'ongoing', country: 'ja', demographic: '', contentRating: 'safe',
  year: 2026, rating: 0, follows: 0, updatedAt: '2026-10-20', chapters: [] };
const chapter = { id: 'chapter-id', mangaId: manga.id, title: 'Chương 1', number: 1, language: 'vi', publishedAt: '2026-10-20', group: '' };
const Link = ({ href, children }) => React.createElement('a', { href }, children);
const common = {
  react: React, 'react/jsx-runtime': require('react/jsx-runtime'), 'next/link': Link,
  'next/navigation': { useParams: () => ({ id: manga.id }), useRouter: () => ({}), useSearchParams: () => new URLSearchParams() },
  '../../../lib/api': { api: { query: () => '' } }, '../../../lib/utils': utils,
  '../../../contexts/store-context': { useStore: () => ({ settings: { language: 'vi', width: 900, dataSaver: false }, history: [], follows: [], isFollowed: () => false }) },
  '../../../components/ui/icon': { Icon: () => null },
  '../../../components/ui/pagination': { Pagination: () => null },
  '../../../components/layout/sidebar': { Sidebar: () => null },
  '../../../lib/reader-banners': { readerBannerBounds: () => { throw new Error('Should not process image pixels during SSR'); } },
};
const MangaClient = load('../frontend-next/src/app/truyen-tranh/[id]/client.tsx', common).default;
const mangaHtml = renderToStaticMarkup(React.createElement(MangaClient, { initialManga: manga, initialChapters: { items: [chapter], total: 1, page: 1, pageSize: 30 } }));
assert.ok(mangaHtml.includes('<h1 class="detail-title">Tên truyện SEO</h1>'));
assert.ok(mangaHtml.includes(manga.description));
assert.ok(mangaHtml.includes('href="/chuong/chapter-id"'));
assert.ok(mangaHtml.includes('<nav class="breadcrumb"'));
const ReaderClient = load('../frontend-next/src/app/chuong/[id]/client.tsx', common).default;
const readerHtml = renderToStaticMarkup(React.createElement(ReaderClient, { initialData: {
  manga, chapter, navigation: [chapter], pages: ['/page-1.jpg', '/page-2.jpg'], dataSaverPages: [], externalUrl: null,
} }));
assert.ok(readerHtml.includes('src="/page-1.jpg"'));
assert.ok(readerHtml.includes('href="/truyen-tranh/manga-id"'));
assert.ok(!readerHtml.includes('visibility:hidden'));
console.log('SEO tests passed: metadata, safe JSON-LD, sitemap XML/cache/shards/503, robots, server-rendered story and chapter content.');
