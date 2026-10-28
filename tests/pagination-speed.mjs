import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(new URL('../frontend-next/package.json', import.meta.url));
const ts = require('typescript');
function load(path, dependencies) {
  const code = ts.transpileModule(fs.readFileSync(new URL(path, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true }
  }).outputText;
  const module = { exports: {} };
  new Function('require', 'module', 'exports', code)(name => {
    assert.ok(name in dependencies, `Unexpected dependency: ${name}`);
    return dependencies[name];
  }, module, module.exports);
  return module.exports;
}
const { ApiClient } = load('../frontend-next/src/lib/api.ts', { './utils': { getStoredToken: () => null } });
const originalFetch = globalThis.fetch;
const response = data => ({ ok: true, status: 200, json: async () => data });
let release;
let fetches = 0;
globalThis.fetch = () => { fetches++; return new Promise(resolve => { release = resolve; }); };
const api = new ApiClient();
api.prefetch('/catalog/home?page=2');
api.prefetch('/catalog/home?page=2');
const click = api.request('/catalog/home?page=2');
assert.equal(fetches, 1, 'Prefetch, hover and click share one pending HTTP request');
release(response({ items: [], total: 60 }));
await click;
await api.request('/catalog/home?page=2');
assert.equal(fetches, 1, 'A prefetched page is served from memory');
globalThis.fetch = async () => { fetches++; return { ok: false, status: 401, json: async () => ({}) }; };
await assert.rejects(api.request('/catalog/home?page=3'));
globalThis.fetch = async () => { fetches++; return response({ items: [], total: 60 }); };
await api.request('/catalog/home?page=3');
assert.equal(fetches, 3, 'A failed pending request is removed so the next click can retry');
globalThis.fetch = originalFetch;

// Exercise the actual home handlers/effects with controlled hook state and slow API data.
const slots = [];
let cursor = 0;
let dirty = false;
let effects = [];
const sameDeps = (a, b) => a && b && a.length === b.length && a.every((v, i) => Object.is(v, b[i]));
const hooks = {
  useState(initial) {
    const i = cursor++;
    if (!(i in slots)) slots[i] = typeof initial === 'function' ? initial() : initial;
    return [slots[i], value => {
      const next = typeof value === 'function' ? value(slots[i]) : value;
      if (!Object.is(next, slots[i])) { slots[i] = next; dirty = true; }
    }];
  },
  useRef(initial) { const i = cursor++; return slots[i] ||= { current: initial }; },
  useMemo(fn, deps) {
    const i = cursor++;
    if (!sameDeps(slots[i]?.deps, deps)) slots[i] = { deps, value: fn() };
    return slots[i].value;
  },
  useEffect(fn, deps) {
    const i = cursor++;
    if (!sameDeps(slots[i]?.deps, deps)) {
      const previous = slots[i];
      slots[i] = { deps };
      effects.push(() => { previous?.cleanup?.(); slots[i].cleanup = fn(); });
    }
  },
  Suspense: 'suspense'
};
let query = new URLSearchParams();
let url = '/';
globalThis.window = { scrollY: 0, scrollTo() {}, history: { pushState(_state, _unused, target) {
  url = target; query = new URLSearchParams(target.split('?')[1]);
} } };
globalThis.document = { querySelector: () => null };
globalThis.sessionStorage = { getItem: () => null };
const empty = () => null;
const Pagination = () => null;
const homeRequests = [];
const prefetched = [];
const pendingPages = new Map();
const cache = new Map();
const clientApi = {
  getCached: path => cache.get(path),
  prefetch: path => prefetched.push(path),
  request(path) {
    homeRequests.push(path);
    return new Promise(resolve => { if (path.startsWith('/catalog/home')) pendingPages.set(path, resolve); });
  }
};
const home = load('../frontend-next/src/app/client.tsx', {
  react: hooks, 'react/jsx-runtime': require('react/jsx-runtime'), 'next/link': empty,
  'next/navigation': { useRouter: () => ({ push: () => assert.fail('Pagination must not await a server route render') }), useSearchParams: () => query },
  '../lib/api': { api: clientApi }, '../contexts/store-context': { useStore: () => ({}) },
  '../lib/utils': { message: String, cleanDescription: String, statuses: {} },
  '../lib/spotlight': load('../frontend-next/src/lib/spotlight.ts', {}),
  '../components/ui/icon': { Icon: empty }, '../components/ui/manga-card': { MangaCard: empty },
  '../components/ui/pagination': { Pagination }, '../components/layout/sidebar': { Sidebar: empty }
}).default;
const initialData = { items: [], total: 90, page: 1, pageSize: 30 };
const props = { initialData, initialSpotlights: [] };
const Content = home(props).props.children.type;
let tree;
function render() {
  let passes = 0;
  do {
    dirty = false; cursor = 0; effects = [];
    tree = Content(props);
    effects.forEach(effect => effect());
    assert.ok(++passes < 20, 'Hooks must settle');
  } while (dirty);
}
function find(node, predicate) {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) return node.map(child => find(child, predicate)).find(Boolean);
  if (predicate(node)) return node;
  return find(node.props?.children, predicate);
}
const pagination = () => find(tree, node => node.type === Pagination);
const busy = () => find(tree, node => node.props?.className === 'manga-grid').props['aria-busy'];
render();
assert.ok(prefetched.some(path => path.includes('page=2')), 'Initial server data must still trigger next-page prefetch');
assert.equal(homeRequests.filter(path => path.startsWith('/catalog/home')).length, 0);
pagination().props.change(2);
render();
assert.equal(url, '/?page=2');
assert.equal(pagination().props.page, 2, 'The selected page updates while its API is still pending');
assert.equal(busy(), true);
const page2 = [...pendingPages.keys()].find(path => path.includes('page=2'));
assert.ok(page2);
pagination().props.change(1);
render();
assert.equal(url, '/');
assert.equal(busy(), false);
pendingPages.get(page2)({ items: [], total: 999, page: 2 });
await new Promise(resolve => setImmediate(resolve));
render();
assert.equal(pagination().props.page, 1);
assert.equal(pagination().props.total, 90, 'A late page-2 response cannot overwrite restored page 1');
cache.set(page2, { items: [], total: 90, page: 2 });
pagination().props.change(2);
render();
assert.equal(busy(), false, 'A cached page needs no loading wait');
assert.equal(homeRequests.filter(path => path === page2).length, 1);
// Next's history integration delivers Back/Forward via useSearchParams.
query = new URLSearchParams();
render();
assert.equal(pagination().props.page, 1);
console.log('Pagination: initial prefetch, shared HTTP requests, immediate selection, cached pages, stale-response protection and browser Back passed');
