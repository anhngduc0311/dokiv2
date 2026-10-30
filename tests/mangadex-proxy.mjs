import assert from 'node:assert/strict';
import worker,{allowedImage} from '../frontend-next/cloudflare/mangadex-proxy.mjs';
const original=globalThis.fetch;let calls=[];
try {
 globalThis.fetch=async(url,options)=>{calls.push({url:String(url),options});return Response.json({data:{id:'chapter'}})};
 assert.equal((await worker.fetch(new Request('https://proxy.test/api/chapter/3e038949-73f3-4b66-9b97-eda2c9d0657a',{headers:{Authorization:'must-not-forward',Cookie:'must-not-forward'}}))).status,200);
 assert.equal(calls[0].url,'https://api.mangadex.org/chapter/3e038949-73f3-4b66-9b97-eda2c9d0657a');
 assert.equal(calls[0].options.headers.Authorization,undefined);assert.equal(calls[0].options.headers.Cookie,undefined);
 for(const target of ['http://127.0.0.1/','https://example.com/','https://uploads.mangadex.org.evil.test/x','https://uploads.mangadex.org:8443/x','https://user:pass@uploads.mangadex.org/x'])assert.equal((await worker.fetch(new Request('https://proxy.test/image?url='+encodeURIComponent(target)))).status,400);
 assert.equal(calls.length,1,'Rejected image sources must not make network requests');
 assert.equal((await worker.fetch(new Request('https://proxy.test/api/auth/login'))).status,404);
 assert.equal((await worker.fetch(new Request('https://proxy.test/api/manga',{method:'POST'}))).status,405);
 assert.equal(allowedImage(new URL('https://uploads.mangadex.org/data/hash/page.jpg')),true);
 globalThis.fetch=async()=>new Response(null,{status:302,headers:{Location:'http://127.0.0.1/'}});
 assert.equal((await worker.fetch(new Request('https://proxy.test/image?url=https%3A%2F%2Fuploads.mangadex.org%2Fpage.jpg'))).status,502,'Redirects must not escape the source allowlist');
} finally {globalThis.fetch=original}
console.log('Public MangaDex relay routes, source allowlist, credential isolation and redirect restrictions passed');
