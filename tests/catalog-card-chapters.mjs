import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createRequire} from 'node:module';
const require=createRequire(new URL('../frontend-next/package.json',import.meta.url));
const ts=require('typescript');
function load(file,deps){const code=ts.transpileModule(fs.readFileSync(new URL('../frontend-next/src/lib/'+file,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;const module={exports:{}};new Function('require','module','exports',code)(name=>{assert.ok(name in deps,name);return deps[name]},module,module.exports);return module.exports}
const chapter=number=>({id:'chapter-'+number,mangaId:'story',number,title:'Chapter '+number,language:'vi',publishedAt:'2026-10-'+String(number).padStart(2,'0')+'T00:00:00Z'});
const story={id:'story',source:'mangadex',chapters:[chapter(1)]};
const gg={id:'other-source',source:'truyengg',chapters:[chapter(4)]};
const cachedPage={items:[story,gg],total:2,page:1,pageSize:30};
let lookups=0,available=true;
const service=load('catalog-service.ts',{
 './db':{},'./cache':{cacheReadMany:async keys=>{lookups++;assert.deepEqual(keys,['catalog:merged-chapters:v2:story']);return new Map(available?[[keys[0],{value:[chapter(1),chapter(2),chapter(3)],fresh:false}]]:[])}},
 './catalog-cache':{cachedCatalog:async()=>cachedPage},
 './mangadex-catalog':{catalogPagination:(page=1,pageSize=24)=>({page,pageSize,offset:0})},
 './mangadex-reader':load('mangadex-reader.ts',{}),
 './truyengg-catalog':{},'./catalog-pagination':{},'./chapter-source-sync':{},'./chapter-source-links':{},'./source-references':{},'./truyengg-parser':{}
});
const result=await service.getHomeCatalog();
assert.deepEqual(result.items[1].chapters.map(c=>c.number),[3,2,1],'Cached cards must show the same supplemented chapters as the detail page');
assert.deepEqual(story.chapters.map(c=>c.number),[1],'Updating cards must not mutate the shared cached page');
assert.equal(result.items[0],gg,'The newest chapter across sources must appear first');
await service.searchCatalog({language:'en'});
assert.equal(lookups,1,'Vietnamese supplemental chapters must not leak into English cards');
available=false;
assert.deepEqual((await service.getHomeCatalog()).items[1].chapters.map(c=>c.number),[1],'Missing merged feeds must preserve the source card');

const originalNow=Date.now;let now=originalNow(),queries=0,fail=false;
Date.now=()=>now;
try {
 const cache=load('cache.ts',{'./cache-schema':{ensureCacheSchema:async()=>{}},'./db-client':{sql:{query:async(_sql,params)=>{
  queries++;if(fail)throw Error('database unavailable');assert.ok(Array.isArray(params[0]));
  return [{Key:'story',Value:{chapter:queries===1?2:3},ExpiresAt:new Date(now+300000).toISOString(),StaleUntil:new Date(now+86400000).toISOString()}];
 }}}});
 const first=await cache.cacheReadMany(['story','missing']);
 assert.equal(queries,1,'Card cache reads must be batched into one query');
 first.get('story').value.chapter=99;
 assert.equal((await cache.cacheReadMany(['story'])).get('story').value.chapter,2,'Callers must not mutate the shared memory cache');
 now+=16000;
 assert.equal((await cache.cacheReadMany(['story'])).get('story').value.chapter,3,'Cards must observe chapter lists updated by another process');
 fail=true;
 assert.equal((await cache.cacheReadMany(['story','another'])).get('story').value.chapter,3,'A database outage must preserve available chapter snapshots');
} finally {Date.now=originalNow}
console.log('Catalog card chapter synchronization, language isolation and batched cache recovery checks passed');
