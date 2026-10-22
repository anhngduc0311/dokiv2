import assert from 'node:assert/strict';
import { mapReaderChapter, readerNavigation, loadMangaDexChapterFeed, readMangaDexChapter, ReaderSourceError } from '../frontend-next/src/lib/mangadex-reader.ts';

const rawChapter = (id, chapter, group = 'Nhóm A', language = 'vi') => ({
  id, attributes: { chapter: String(chapter), translatedLanguage: language, pages: 8, publishAt: '2026-08-04T18:35:01Z' },
  relationships: [{type:'manga', id:'manga', attributes:{title:{en:'English title'},altTitles:[{vi:'Tên truyện tiếng Việt'}]}}, {type:'scanlation_group', attributes:{name:group}}]
});
const currentRaw = rawChapter('current', 1);
const current = mapReaderChapter(currentRaw);
const alternate = mapReaderChapter(rawChapter('alternate', 1, 'Nhóm B'));
const nextA = mapReaderChapter(rawChapter('next-a', 2));
const nextB = mapReaderChapter(rawChapter('next-b', 2, 'Nhóm B'));
assert.deepEqual(readerNavigation([alternate,nextB,nextA],current).map(c=>c.id), ['current','next-a']);
assert.deepEqual(readerNavigation([],current).map(c=>c.id), ['current']);
assert.equal(current.publishedAt, '2026-08-04T18:35:01Z');

const requests = [];
const chapters = await loadMangaDexChapterFeed('manga', 'en', async path => {
  const url = new URL(path, 'https://api.mangadex.org'); requests.push(url);
  return url.searchParams.get('offset') === '0'
    ? {total:3,data:[rawChapter('one',1),rawChapter('two',2)]}
    : {total:3,data:[rawChapter('three',3)]};
});
assert.equal(chapters.length,3,'Load chapters after the first upstream page');
assert.equal(requests[1].searchParams.get('offset'),'2');
assert.equal(requests[0].searchParams.get('translatedLanguage[]'),'en');
assert.equal(requests[0].searchParams.has('includeExternalUrl'),false,'Do not filter an image chapter feed down to external-only chapters');

const calls = [];
const dependencies = {
  get: async path => { calls.push(path); return path.startsWith('/chapter/') ? {data:currentRaw} : {baseUrl:'https://images.mangadex.network',chapter:{hash:'hash',data:['page.jpg'],dataSaver:['small.jpg']}}; },
  manga: async () => ({id:'manga',title:'Tên đầy đủ',alternativeTitle:'',author:'Tác giả',cover:'/cover',description:'',genres:[],status:'ongoing',country:'ja',demographic:'',updatedAt:'',chapters:[]}),
  chapters: async () => [alternate,nextA,nextB]
};
const result = await readMangaDexChapter('current',dependencies);
assert.equal(result.manga.title,'Tên đầy đủ','Return actual manga details instead of the placeholder Truyện');
assert.equal(result.chapter.language,'vi');
assert.equal(result.navigation[0].id,'current');
assert.equal(result.navigation[1].id,'next-a');
assert.match(result.pages[0],/\/data\/hash\/page.jpg$/);
assert.match(result.dataSaverPages[0],/\/data-saver\/hash\/small.jpg$/);

const fallback = await readMangaDexChapter('current',{...dependencies,manga:async()=>null,chapters:async()=>{throw new Error('Feed unavailable');}});
assert.equal(fallback.manga.title,'Tên truyện tiếng Việt');
assert.equal(fallback.navigation[0].id,'current');
const fullOnly = await readMangaDexChapter('current',{...dependencies,get:async path=>path.startsWith('/chapter/')?{data:currentRaw}:{baseUrl:'https://images.mangadex.network',chapter:{hash:'hash',data:['full.jpg']}}});
assert.deepEqual(fullOnly.dataSaverPages,fullOnly.pages,'Missing compressed images must reuse the full-image folder, not invent data-saver URLs');
const externalCalls=[];
const external = await readMangaDexChapter('current',{...dependencies,get:async path=>{externalCalls.push(path);return {data:{...currentRaw,attributes:{...currentRaw.attributes,externalUrl:'https://publisher.example/chapter'}}};}});
assert.equal(external.externalUrl,'https://publisher.example/chapter');
assert.equal(externalCalls.length,1,'External chapters do not need an At-Home image request');
await assert.rejects(readMangaDexChapter('current',{...dependencies,get:async path=>path.startsWith('/chapter/')?{data:currentRaw}:{baseUrl:'https://images.mangadex.network',chapter:{hash:'hash',data:[]}}}),ReaderSourceError,'Empty image responses must show an error instead of a blank reader');
console.log('MangaDex reader metadata, navigation, language and image fallback checks passed');
