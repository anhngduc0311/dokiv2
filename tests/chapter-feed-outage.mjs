import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(new URL('../frontend-next/package.json', import.meta.url));
const ts = require('typescript');
function load(file, dependencies) {
  const code = ts.transpileModule(fs.readFileSync(new URL('../frontend-next/src/lib/' + file, import.meta.url), 'utf8'), {
    compilerOptions: {module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}
  }).outputText;
  const module = {exports:{}};
  new Function('require','module','exports',code)(name => {
    assert.ok(name in dependencies, 'Unexpected dependency: ' + name);
    return dependencies[name];
  },module,module.exports);
  return module.exports;
}
const reader = load('mangadex-reader.ts', {});
const chapterSync = load('chapter-source-sync.ts', {});
const completeFeed = [1,2,3].map(number=>({id:'chapter-'+number,mangaId:'story',number,title:'Chapter '+number,language:'vi',publishedAt:'2026-10-30T00:00:00Z',pagesCount:10}));
const outage = new TypeError('fetch failed');
let entry = null, failing = true, feedRequests = 0, saved = null;
let syncStory = null, matchedSource = null, linked = null;
const references = new Map();
const {getMangaChapters} = load('catalog-service.ts', {
  './db': {ensureDbInitialized:async()=>{},sql:async()=>[]},
  './cache': {
    cacheGet:async key=>key.startsWith('manga:detail:source:') ? syncStory : null,
    cacheRead:async()=>entry,
    cacheSet:async(...args)=>{saved=args}
  },
  './catalog-cache':{},
  './mangadex-catalog':{mangaDexGet:async path=>{
    if (!path.includes('/feed?')) throw outage;
    feedRequests++;
    if(failing) throw outage;
    return {total:1,data:[{id:'new-chapter',attributes:{chapter:'4',translatedLanguage:'vi',pages:10,publishAt:'2026-10-30T00:00:00Z'},relationships:[{type:'manga',id:'story'}]}]};
  }},
  './truyengg-catalog':{
    getGgChapters:async()=>null,
    getGgDetail:async id=>id===matchedSource?.manga.id ? matchedSource : null,
    searchGgTitles:async()=>{throw outage}
  },
  './mangadex-reader':reader,
  './catalog-pagination':{}, './chapter-source-sync':chapterSync,
  './chapter-source-links':{
    findChapterSourceLink:async()=>linked,
    saveChapterSourceLink:async (_mangaId,id)=>{linked=id}
  },
  './source-references':{
    findGgMangaIdsBySlug:async slugs=>slugs.includes('mot-truyen-khac') ? ['other-gg'] : [],
    saveGgReferences:async refs=>refs.forEach(ref=>references.set(ref.id,ref))
  },
  './truyengg-parser':{ggId:key=>key}
});
entry={value:completeFeed,fresh:false};
const stale=await getMangaChapters('story');
assert.equal(stale.total,3,'A source outage must retain the full previous chapter feed');
assert.equal(stale.items[0].id,'chapter-3');
assert.equal(saved,null,'Failed refreshes must not replace cached chapters');
entry=null;
await assert.rejects(getMangaChapters('story'),error=>error===outage,'A cold source outage must remain an error, not an empty successful feed');
entry={value:completeFeed,fresh:true};
feedRequests=0;
assert.equal((await getMangaChapters('story')).total,3);
assert.equal(feedRequests,0,'Fresh feeds must not require the unavailable upstream');
entry={value:completeFeed,fresh:false};
failing=false;
const refreshed=await getMangaChapters('story');
assert.equal(refreshed.items[0].id,'new-chapter');
assert.equal(saved[3],86400,'A complete refreshed feed must remain available through the next day of source interruptions');
console.log('Chapter feed outage, cold failure, fresh-cache and refresh retention checks passed');

for (const [id,title,sourceId] of [
  ['e3e2c204-ccc4-4061-b9e0-526a8b47d652','Tân Trang Nhà Cùng Gyaru','truyengg:manga:tan-trang-nha-cung-gyaru-23976'],
  ['other-md','Một Truyện Khác','other-gg']
]) {
  linked=null;
  syncStory={id,title,alternativeTitle:'',author:'Known Author',country:'ja'};
  const chapters=Array.from({length:5},(_,i)=>({...completeFeed[0],id:'gg-'+(i+1),mangaId:sourceId,number:i+1}));
  matchedSource={manga:{...syncStory,id:sourceId,author:'Đang Cập Nhật'},chapters,
    refs:chapters.map(chapter=>({id:chapter.id,kind:'chapter',mangaId:sourceId,path:'/chapter-'+chapter.number}))};
  entry={value:[{...completeFeed[0],mangaId:id}],fresh:true};
  const initial=await getMangaChapters(id);
  assert.deepEqual(initial.items.map(chapter=>chapter.number),[5,4,3,2,1]);
  assert.equal(initial.items.at(-1).id,completeFeed[0].id);
  assert.equal(linked,sourceId);
  references.clear();
  const existing=await getMangaChapters(id,1,true);
  assert.deepEqual(existing.items.map(chapter=>chapter.number),[1,2,3,4,5]);
  assert.equal(references.get(existing.items.at(-1).id)?.mangaId,id,'Existing links must also register reader references');
}
console.log('Verified source and indexed-title fallback both fill gaps during search outages');

let pageFailure = true;
const manga = {id:'story',title:'A readable story',description:'Description',genres:[],author:'Chưa rõ'};
const page = load('../app/truyen-tranh/[id]/page.tsx', {
  'react/jsx-runtime':require('react/jsx-runtime'),
  'next/navigation':{notFound:()=>{throw new Error('Unexpected 404')}},
  './client':{default:'manga-client'},
  '@/lib/seo-data':{loadManga:async()=>manga,toManga:value=>value},
  '@/lib/catalog-service':{getMangaChapters:async()=>{
    if(pageFailure) throw outage;
    return {items:completeFeed,total:3,page:1,pageSize:3};
  }},
  '@/lib/seo':{absoluteUrl:path=>'https://dokitruyen.com'+path,plainText:text=>text,breadcrumbSchema:()=>({})},
  '@/components/seo/json-ld':{JsonLd:'json-ld'}
});
const originalError=console.error;
let unavailable;
try {
  console.error=()=>{};
  unavailable=await page.default({params:Promise.resolve({id:'story'})});
} finally {console.error=originalError}
const failedProps=unavailable.props.children.at(-1).props;
assert.equal(failedProps.initialManga.title,manga.title,'Source failure must preserve the story detail page');
assert.match(failedProps.initialChapterError,/Vui lòng thử lại/,'A cold outage must show a retry state instead of claiming no chapters exist');
pageFailure=false;
const available=await page.default({params:Promise.resolve({id:'story'})});
const successfulProps=available.props.children.at(-1).props;
assert.equal(successfulProps.initialChapters.total,3);
assert.equal(successfulProps.initialChapterError,'');
console.log('Story SSR survives a chapter source outage and preserves normal chapter rendering');
