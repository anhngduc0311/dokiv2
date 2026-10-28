import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(new URL('../frontend-next/package.json', import.meta.url));
const ts = require('typescript');
function load(path, dependencies) {
  const code = ts.transpileModule(fs.readFileSync(new URL(path, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  }).outputText;
  const module = { exports: {} };
  new Function('require', 'module', 'exports', code)(name => {
    assert.ok(name in dependencies, `Unexpected dependency: ${name}`);
    return dependencies[name];
  }, module, module.exports);
  return module.exports;
}
const reader = load('../frontend-next/src/lib/mangadex-reader.ts', {});
const manga = { id: 'story', title: 'Kubaru-chan', chapters: [] };
const chapter = { id: 'chapter-1', mangaId: 'story', number: 1, title: 'Chương 1', language: 'vi', publishedAt: '2026-10-01T00:00:00Z' };
const navigation = [chapter, { ...chapter, id: 'chapter-2', number: 2 }];
let sourceType = 'crawl';
let storedPages = [];
let access = {};
let sourcePages = Array.from({ length: 41 }, (_, i) => `${i + 1}.jpg`);
const requests = [];
const dependencies = {
  './db': {
    ensureDbInitialized: async () => {},
    sql: async strings => {
      const query = strings.join('?');
      if (query.includes('SELECT c."IsLocked"')) return [access];
      if (query.includes('SELECT c.*')) return [{
        Id: chapter.id, MangaId: manga.id, Number: 1, Language: 'vi', Pages: storedPages,
        manga_source_type: sourceType, manga_title: manga.title
      }];
      if (query.includes('SELECT "Id", "Number", "Title"')) return [{ Id: chapter.id, Number: 1 }];
      throw new Error('Unexpected query');
    }
  },
  './redis': { cacheGet: async key => key.startsWith('manga:detail:') ? manga
    : key.startsWith('catalog:merged-chapters:') ? navigation : null },
  './mangadex-catalog': { mangaDexGet: async path => {
    requests.push(path);
    if (path.startsWith('/chapter/')) return { data: { id: chapter.id,
      attributes: { chapter: '1', translatedLanguage: 'vi', pages: 41 },
      relationships: [{ type: 'manga', id: manga.id }]
    } };
    if (path.startsWith('/at-home/server/')) return {
      baseUrl: 'https://images.example.com', chapter: { hash: 'chapter-hash', data: sourcePages, dataSaver: sourcePages }
    };
    throw new Error('Unexpected source request');
  } },
  './truyengg-catalog': { getGgReader: async () => null },
  './source-references': { findGgReference: async () => null },
  './mangadex-reader': reader, './catalog-pagination': {}, './chapter-source-sync': {},
  './chapter-source-links': {}, './truyengg-parser': {}
};
const { getChapterReader } = load('../frontend-next/src/lib/catalog-service.ts', dependencies);
const result = await getChapterReader(chapter.id);
assert.equal(result.pages.length, 41, 'The empty database placeholder must not hide the 41 source images');
assert.equal(result.chapter.id, chapter.id, 'Existing chapter URLs remain valid');
assert.equal(result.manga.id, manga.id);
assert.equal(result.navigation[1].id, 'chapter-2');
assert.match(result.pages[0], /^https:\/\/images.example.com\/data\/chapter-hash\//);
assert.equal(result.dataSaverPages.length, 41);

sourceType = 'manual';
storedPages = ['https://local.example.com/page.jpg'];
requests.length = 0;
assert.deepEqual((await getChapterReader(chapter.id)).pages, storedPages);
assert.equal(requests.length, 0, 'Local chapters retain their uploaded images');
storedPages = [];
await assert.rejects(() => getChapterReader(chapter.id), reader.ReaderSourceError);

sourceType = 'crawl';
sourcePages = [];
await assert.rejects(() => getChapterReader(chapter.id), reader.ReaderSourceError);
for (const guard of [{ IsLocked: true }, { IsHidden: true }, { IsDraft: true },
  { ScheduledPublishAt: '2099-01-01T00:00:00Z' }, { PublishedAt: '2099-01-01T00:00:00Z' }]) {
  access = guard;
  requests.length = 0;
  assert.equal(await getChapterReader(chapter.id), null);
  assert.equal(requests.length, 0, 'Source fallback must not bypass publication restrictions');
}
console.log('Reader loads 41 source images over empty crawl rows; local images, empty-source errors and publication restrictions passed');
