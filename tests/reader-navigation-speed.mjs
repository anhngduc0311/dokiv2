import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(new URL('../frontend-next/package.json', import.meta.url));
const ts = require('typescript');
const source = fs.readFileSync(new URL('../frontend-next/src/app/chuong/[id]/client.tsx', import.meta.url), 'utf8');
const ast = ts.createSourceFile('reader.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const reader = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'ReaderContent');
const names = new Set(['position', 'next', 'preloadNextChapter', 'loadChapter', 'go']);
const functions = reader.body.statements.filter(node => ts.isVariableStatement(node)
  && node.declarationList.declarations.some(declaration => names.has(declaration.name.getText(ast))));
assert.equal(functions.length, names.size);
const prefetchEffect = reader.body.statements.find(node => ts.isExpressionStatement(node)
  && ts.isCallExpression(node.expression) && node.expression.expression.getText(ast) === 'useEffect'
  && node.getText(ast).includes('preloadNextChapter(data)'));
assert.ok(prefetchEffect, 'The reader must start prefetching independently of the last image loading');
const code = ts.transpile(functions.map(node => node.getText(ast)).join('\n') + '\n' + prefetchEffect.getText(ast), {
  target: ts.ScriptTarget.ES2022
});
const chapter = number => ({ id: `chapter-${number}`, number, title: `Chương ${number}` });
const navigation = [1, 2, 3, 4].map(chapter);
const content = number => ({ chapter: chapter(number), manga: { id: 'story', title: 'Truyện' }, navigation,
  pages: [`/chapter-${number}.jpg`], dataSaverPages: [] });
const initialData = content(1);
const cache = new Map();
const pending = new Map();
const requests = [];
const images = [];
const timers = [];
let loading = false;
let error = '';
let url = '/chuong/chapter-1';
const canonical = {};
const document = { querySelector: () => canonical };
const env = {
  initialData, epochRef: { current: 0 }, preloadedNextIdRef: { current: '' },
  preloadedUrlsRef: { current: new Set() }, cleanedPagesRef: { current: new Map() },
  setLoading: value => { loading = value; }, setError: value => { error = value; },
  setFailed() {}, setLoaded() {}, setFallbackUrls() {}, scrollToTopInstant() {},
  rawPages: data => data.pages, preloadUpcoming() {}, proxyImage: value => value, message: String,
  store: { settings: { dataSaver: false }, record: async () => {} },
  api: {
    getCached: path => cache.get(path),
    request(path) {
      requests.push(path);
      if (cache.has(path)) return Promise.resolve(cache.get(path));
      if (!pending.has(path)) {
        let resolve;
        const promise = new Promise(done => { resolve = data => { cache.set(path, data); done(data); }; });
        pending.set(path, { promise, resolve });
      }
      return pending.get(path).promise;
    }
  },
  Image: class { set src(value) { images.push(value); } }, document,
  window: { location: { origin: 'https://www.dokitruyen.com' }, history: { pushState(_state, _unused, path) { url = path; } } },
  setTimeout: (fn, delay) => { timers.push({ fn, delay }); return timers.length; }, clearTimeout() {},
  useEffect: fn => fn()
};
const controls = new Function('env', `
  const {${Object.keys(env).join(',')}} = env;
  let id = initialData.chapter.id;
  let data = initialData;
  const setData = value => { data = value; };
  ${code}
  return { loadChapter, go, next, preloadNextChapter, setId: value => { id = value; }, getData: () => data };
`)(env);
assert.equal(requests.length, 0, 'Give the current chapter a head start before prefetch');
assert.equal(timers[0].delay, 400);
timers[0].fn();
assert.deepEqual(requests, ['/chapters/chapter-2']);
pending.get('/chapters/chapter-2').resolve(content(2));
await new Promise(resolve => setImmediate(resolve));
assert.deepEqual(images, ['/chapter-2.jpg'], 'Prefetch the next chapter images as well as its JSON');
controls.go('chapter-2');
assert.equal(url, '/chuong/chapter-2', 'Navigation updates history without a server route render');
controls.setId('chapter-2');
await controls.loadChapter();
assert.equal(controls.getData().chapter.id, 'chapter-2');
assert.equal(loading, false);
assert.equal(requests.length, 1, 'A prefetched chapter needs no second request');
controls.setId('chapter-3');
const slow = controls.loadChapter();
assert.equal(loading, true);
controls.setId('chapter-1');
await controls.loadChapter();
assert.equal(controls.getData(), initialData, 'Browser Back reuses the initial server chapter');
pending.get('/chapters/chapter-3').resolve(content(3));
await slow;
assert.equal(controls.getData(), initialData, 'An old chapter response cannot overwrite the chapter selected later');
assert.equal(loading, false);
assert.equal(error, '');
assert.equal(controls.next(content(2)).id, 'chapter-3', 'Navigation is based on the displayed chapter rather than a stale route');
assert.match(document.title, /Chương 1/);
assert.equal(canonical.href, 'https://www.dokitruyen.com/chuong/chapter-1');
console.log('Reader navigation: early chapter/image prefetch, cache reuse, history navigation and stale-response protection passed');
