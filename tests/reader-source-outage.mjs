import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createRequire} from 'node:module';
const require=createRequire(new URL('../frontend-next/package.json',import.meta.url));const ts=require('typescript');
function load(file,deps){const code=ts.transpileModule(fs.readFileSync(new URL('../frontend-next/src/'+file,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;const module={exports:{}};new Function('require','module','exports',code)(name=>{assert.ok(name in deps,name);return deps[name]},module,module.exports);return module.exports}
const chapter={id:'chapter',mangaId:'manga',number:3,title:'Chapter 3',language:'vi',publishedAt:'2026-10-30T00:00:00Z'};
const manga={id:'manga',title:'Story',chapters:[],genres:[],author:'Chưa rõ'};
let now=Date.now(),locked=false,metadataFailure=false,imageFailure=false,requests=0;
const entries=new Map();
const api=load('lib/catalog-service.ts',{
 './db':{ensureDbInitialized:async()=>{},sql:async strings=>strings.join('').includes('IsLocked')&&locked?[{IsLocked:true}]:[]},
 './cache':{cacheGet:async key=>key.startsWith('manga:detail:')?manga:key.startsWith('catalog:merged-chapters:')?[chapter]:null,
 cacheRead:async key=>{const e=entries.get(key);return e&&e.stale>now?{value:e.value,fresh:e.expires>now}:null},
 cacheSet:async(key,value,ttl,stale)=>entries.set(key,{value,expires:now+ttl*1000,stale:now+(ttl+stale)*1000})},
 './mangadex-catalog':{mangaDexGet:async path=>{requests++;if(path.startsWith('/chapter/')){if(metadataFailure)throw Error('source reset');return{data:{id:chapter.id,attributes:{chapter:'3',translatedLanguage:'vi',pages:1},relationships:[{type:'manga',id:'manga'}]}}}if(imageFailure)throw Error('image server unavailable');return{baseUrl:'https://images.example.com',chapter:{hash:'hash',data:['page.jpg']}}}},
 './mangadex-reader':load('lib/mangadex-reader.ts',{}),
 './truyengg-catalog':{getGgReader:async()=>null},'./source-references':{findGgReference:async()=>null},
 './catalog-cache':{},'./catalog-pagination':{},'./chapter-source-sync':{},'./chapter-source-links':{},'./truyengg-parser':{}
});
const concurrent = await Promise.all(Array.from({ length: 5 }, () => api.getChapterReader('chapter')));
for (const reader of concurrent) assert.equal(reader.pages.length, 1);
assert.equal(requests, 2, 'Concurrent readers share one metadata request and one image-server request');
assert.equal((await api.getChapterReader('chapter')).pages.length,1);assert.equal(requests,2,'Repeated reads must reuse source metadata and a still-valid image server');
locked=true;assert.equal(await api.getChapterReader('chapter'),null);assert.equal(requests,2,'Cached responses must not bypass chapter publication restrictions');locked=false;
now+=61000;imageFailure=true;await assert.rejects(api.getChapterReader('chapter'),/image server unavailable/,'Expired image server addresses must never be served as stale');
imageFailure=false;metadataFailure=true;now+=300000;
assert.equal((await api.getChapterReader('chapter')).pages.length,1,'Cached chapter metadata may survive a source outage while the image server refreshes normally');

let sourceFailure=true,missing=false;
const ready={chapter,manga,pages:['https://images.example.com/page.jpg'],navigation:[chapter]};
const page=load('app/chuong/[id]/page.tsx',{
 'react/jsx-runtime':require('react/jsx-runtime'),'react':{cache:fn=>fn},'next/link':{default:'link'},'next/navigation':{notFound:()=>{throw Error('not-found')}},
 './client':{default:'reader-client'},'@/lib/seo-data':{loadReader:async()=>{if(sourceFailure)throw Error('socket hang up');return missing?null:ready}},
 '@/lib/seo':{pageMetadata:title=>({title}),absoluteUrl:path=>'https://dokitruyen.com'+path,breadcrumbSchema:()=>({})},'@/components/seo/json-ld':{JsonLd:'json-ld'}
});
const log=console.error;let failed,metadata;
try{console.error=()=>{};failed=await page.default({params:Promise.resolve({id:'chapter'})});metadata=await page.generateMetadata({params:Promise.resolve({id:'chapter'})})}finally{console.error=log}
assert.equal(failed.props.initialData,null);assert.equal(failed.props.chapterId,'chapter');assert.match(failed.props.initialError,/Vui lòng thử lại/);assert.equal(metadata.robots.index,false,'Transient reader failures must not be indexed as chapter content');
sourceFailure=false;const successful=await page.default({params:Promise.resolve({id:'chapter'})});assert.equal(successful.props.children.at(-1).props.initialData,ready);
missing=true;await assert.rejects(page.default({params:Promise.resolve({id:'chapter'})}),/not-found/,'A missing chapter must retain its 404 behavior');
console.log('Reader source caching, image-address expiry, publication guards and SSR retry recovery passed');
