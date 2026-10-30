import assert from 'node:assert/strict';
import fs from 'node:fs';
import {EventEmitter} from 'node:events';
import {createRequire} from 'node:module';
const require=createRequire(new URL('../frontend-next/package.json',import.meta.url));
const ts=require('typescript');
const code=ts.transpileModule(fs.readFileSync(new URL('../frontend-next/src/lib/mangadex-catalog.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const module={exports:{}};
let calls=[],fallbacks=[],failures=0,status=200,fallbackFails=false;
const data={data:[{id:'chapter'}]};
const https={get(url,options,callback){
  fallbacks.push({url,options});
  const request=new EventEmitter();
  queueMicrotask(()=>{
    if(fallbackFails){request.emit('error',new TypeError('fetch failed: source unavailable'));return}
    const response=new EventEmitter();response.statusCode=200;
    callback(response);response.emit('data',Buffer.from(JSON.stringify(data)));response.emit('end');
  });
  return request;
}};
new Function('require','fetch','module','exports',code)(name=>{assert.equal(name,'node:https');return https},async(url,options)=>{
  calls.push({url,options});
  if(failures-->0) throw new TypeError('fetch failed: closed socket');
  return {ok:status===200,status,json:async()=>data};
},module,module.exports);
const {mangaDexGet}=module.exports;
assert.deepEqual(await mangaDexGet('/chapter/example'),data);
assert.equal(calls.length,1);assert.equal(fallbacks.length,0,'Successful requests must not be retried');
calls=[];failures=1;
assert.deepEqual(await mangaDexGet('/chapter/example'),data);
assert.equal(calls.length,1);assert.equal(fallbacks.length,1);
assert.equal(fallbacks[0].options.agent,false,'Recovery must use a new connection');
assert.equal(fallbacks[0].options.headers.Connection,'close');
assert.equal(fallbacks[0].url,'https://api.mangadex.org/chapter/example');
assert.ok(calls.every(call=>call.options.cache==='no-store'),'Retries must not recreate the disk fetch cache');
calls=[];fallbacks=[];failures=1;fallbackFails=true;
await assert.rejects(mangaDexGet('/chapter/example'),/source unavailable/);
assert.equal(calls.length+fallbacks.length,2,'Source outages must have bounded retries');
calls=[];fallbacks=[];failures=0;status=429;
await assert.rejects(mangaDexGet('/chapter/example'),/Nguồn truyện/);
assert.equal(calls.length,1);assert.equal(fallbacks.length,0,'Rate-limit responses must not trigger immediate additional requests');
console.log('MangaDex transient socket recovery and bounded retry checks passed');
