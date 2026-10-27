import assert from 'node:assert/strict';
import { catalogPagination, mangaDexQuery, mapMangaDexManga, searchMangaDex, enrichMangaDexCards } from '../frontend-next/src/lib/mangadex-catalog.ts';

assert.deepEqual(catalogPagination(NaN, NaN), { page: 1, pageSize: 24, offset: 0 });
assert.deepEqual(catalogPagination(-3, 500), { page: 1, pageSize: 50, offset: 0 });
assert.deepEqual(catalogPagination(100, 28), { page: 100, pageSize: 28, offset: 2772 });
const query = mangaDexQuery({ q: '  Frieren  ', country: 'ko,zh', genre: 'tag-id', status: 'completed', demographic: 'seinen', year: 2020, sort: 'hot' }, 56, 28);
assert.equal(query.get('offset'), '56');
assert.equal(query.get('limit'), '28');
assert.equal(query.get('title'), 'Frieren');
assert.equal(query.get('availableTranslatedLanguage[]'), 'vi');
assert.deepEqual(query.getAll('originalLanguage[]'), ['ko', 'zh']);
assert.equal(query.get('includedTags[]'), 'tag-id');
assert.equal(query.get('status[]'), 'completed');
assert.equal(query.get('publicationDemographic[]'), 'seinen');
assert.equal(query.get('year'), '2020');
assert.equal(query.get('order[followedCount]'), 'desc');
assert.equal(mangaDexQuery({ language: 'en', sort: 'title' }, 0, 24).get('order[title]'), 'asc');
const homeQuery = mangaDexQuery({ excludeManhuaManhwa: true, sort: 'latest' }, 30, 30);
assert.deepEqual(homeQuery.getAll('excludedOriginalLanguage[]'), ['ko', 'zh', 'zh-hk'], 'Home excludes Manhwa/Manhua across MangaDex origins');
assert.deepEqual(homeQuery.getAll('originalLanguage[]'), [], 'Home keeps other origins without restricting everything to Japan');
assert.equal(homeQuery.get('offset'), '30');
assert.deepEqual(mangaDexQuery({}, 0, 30).getAll('excludedOriginalLanguage[]'), [], 'Other catalog sections remain unrestricted');
const story = { id: 'story-id', attributes: { title: { en: 'English' }, altTitles: [{vi: 'Tên tiếng Việt'}], originalLanguage: 'ja', lastChapter: '12.5', tags: [] }, relationships: [{type: 'cover_art', attributes: {fileName: 'cover.jpg'}}] };
assert.equal(mapMangaDexManga(story).title, 'Tên tiếng Việt');
assert.equal(mapMangaDexManga(story).rating, 0);
assert.equal(mapMangaDexManga(story).follows, 0);
const calls = [];
const originalFetch = globalThis.fetch;
globalThis.fetch = async url => {
  const parsed = new URL(url); calls.push(parsed);
  if (parsed.pathname === '/manga') return Response.json({data: [story], total: 6185});
  if (parsed.pathname === '/statistics/manga') return Response.json({statistics: {'story-id': {rating: {bayesian: 8.2}, follows: 12345}}});
  if (parsed.pathname === '/manga/story-id/feed') return Response.json({data: [
    {id: 'chapter-id', attributes: {chapter: '12.5', translatedLanguage: 'vi', publishAt: '2026-10-22T00:00:00Z'}, relationships: [{type: 'manga', id: 'story-id'}]},
    {id: 'duplicate', attributes: {chapter: '12.5'}},
    {id: 'chapter-12', attributes: {chapter: '12'}},
    {id: 'chapter-11', attributes: {chapter: '11'}},
    {id: 'chapter-10', attributes: {chapter: '10'}}
  ]});
  if (parsed.pathname === '/manga/older-story/feed') return Response.json({data: [
    {id: 'older-chapter', attributes: {chapter: '8', translatedLanguage: 'en', readableAt: '2026-09-01T00:00:00Z', pages: 20}}
  ]});
  if (parsed.pathname === '/manga/unavailable-story/feed') return new Response('', {status: 503});
  if (parsed.pathname === '/author') return Response.json({data: []});
  throw new Error('Unexpected request: ' + url);
};
try {
  const page = await searchMangaDex({language: 'vi'}, 2772, 28);
  assert.equal(page.total, 6185);
  assert.equal(page.items[0].rating, 8.2);
  assert.equal(page.items[0].follows, 12345);
  assert.equal(page.items[0].chapters[0].id, 'chapter-id');
  const feedQuery = calls.find(u => u.pathname === '/manga/story-id/feed').searchParams;
  assert.equal(feedQuery.get('limit'), '20');
  assert.deepEqual(page.items[0].chapters.map(c => c.number), [12.5, 12, 11], 'Show three distinct latest chapters, skipping duplicate releases');
  assert.equal(feedQuery.get('translatedLanguage[]'), 'vi');
  assert.equal(feedQuery.get('order[readableAt]'), 'desc');
  assert.equal(feedQuery.get('includeEmptyPages'), '0');
  const older = mapMangaDexManga({...story, id: 'older-story'});
  const unavailable = mapMangaDexManga({...story, id: 'unavailable-story'});
  await enrichMangaDexCards([unavailable, older], 'en');
  assert.equal(older.chapters[0].number, 8, 'Older stories get their own latest chapter even if another feed fails');
  assert.equal(older.chapters[0].publishedAt, '2026-09-01T00:00:00Z');
  assert.equal(calls.find(u => u.pathname === '/manga/older-story/feed').searchParams.get('translatedLanguage[]'), 'en');
  assert.equal(calls.find(u => u.pathname === '/manga').searchParams.get('offset'), '2772');
  const emptyAuthor = await searchMangaDex({author: 'Nobody'}, 0, 28);
  assert.equal(emptyAuthor.total, 0);
  assert.equal(calls.filter(u => u.pathname === '/manga').length, 1, 'An unknown author must not return unfiltered stories');
  const beyondWindow = await searchMangaDex({}, 10000, 28);
  assert.equal(beyondWindow.items.length, 0);
  globalThis.fetch = async () => new Response('', {status: 503});
  await assert.rejects(searchMangaDex({}, 0, 28), /Nguồn truyện/);
} finally { globalThis.fetch = originalFetch; }
console.log('Next catalog regression checks passed');
