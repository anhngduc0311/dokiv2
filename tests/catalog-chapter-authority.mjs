import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(new URL('../frontend-next/package.json', import.meta.url));
const ts = require('typescript');
const code = ts.transpileModule(fs.readFileSync(new URL('../frontend-next/src/lib/catalog-service.ts', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
}).outputText;
const sourceChapters = Array.from({ length: 40 }, (_, i) => ({
  id: `source-${i + 1}`, mangaId: 'story', number: i + 1,
  title: `Chương ${i + 1}`, language: 'vi', publishedAt: '2026-10-28T00:00:00Z', pagesCount: 15
}));
const storedRows = Array.from({ length: 4 }, (_, i) => ({
  Id: `stored-${i + 1}`, MangaId: 'story', Number: 4 - i, Language: 'vi', pages_count: null
}));
let sourceType = 'crawl';
const dependencies = {
  './db': {
    ensureDbInitialized: async () => {},
    sql: async (strings) => {
      const query = strings.join('?');
      assert.match(query, /FROM "Chapters"/);
      // Model the stored rows in the report and the story ownership predicate.
      return sourceType === 'crawl' && query.includes('m."SourceType" <> \'crawl\'') ? [] : storedRows;
    }
  },
  './catalog-cache': { cachedCatalog: (_key, _payload, load) => load() },
  './cache': { cacheGet: async key => key.startsWith('catalog:merged-chapters:') ? sourceChapters : null },
  './truyengg-catalog': { getGgChapters: async () => null },
  './mangadex-reader': { readerNavigation: chapters => chapters },
  './mangadex-catalog': {}, './catalog-pagination': {}, './chapter-source-sync': {},
  './chapter-source-links': {}, './source-references': {}, './truyengg-parser': {}
};
const module = { exports: {} };
new Function('require', 'module', 'exports', code)(name => {
  assert.ok(name in dependencies, `Unexpected dependency: ${name}`);
  return dependencies[name];
}, module, module.exports);
const { getMangaChapters } = module.exports;
const crawled = await getMangaChapters('story');
assert.equal(crawled.total, 40, 'Four stored placeholders must not hide the source chapters');
assert.equal(crawled.items[0].id, 'source-40');
assert.equal(crawled.items.at(-1).id, 'source-1');
const ascending = await getMangaChapters('story', 1, true);
assert.equal(ascending.items[0].id, 'source-1');
sourceType = 'manual';
const local = await getMangaChapters('story');
assert.equal(local.total, 4, 'Locally managed stories must retain their own chapter list');
assert.ok(local.items.every(chapter => chapter.id.startsWith('stored-')));
console.log('Crawled chapter authority and local chapter preservation checks passed');
