import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(new URL('../frontend-next/package.json', import.meta.url));
const ts = require('typescript');
const source = fs.readFileSync(new URL('../frontend-next/src/app/chuong/[id]/client.tsx', import.meta.url), 'utf8');
const ast = ts.createSourceFile('client.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const content = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'ReaderContent');
const names = new Set(['stopAutoScroll', 'startAutoScroll', 'toggleAutoScroll']);
const functions = content.body.statements.filter(node => ts.isVariableStatement(node)
  && node.declarationList.declarations.some(declaration => names.has(declaration.name.getText(ast))));
assert.equal(functions.length, 3);
const code = ts.transpile(functions.map(node => node.getText(ast)).join('\n'), { target: ts.ScriptTarget.ES2022 });
let now = 0;
let nextId = 0;
let buttonState = false;
const frames = new Map();
const notifications = [];
const scrolls = [];
const scrollRoot = { scrollHeight: 4000 };
const window = {
  scrollY: 0, innerHeight: 600,
  scrollBy(options) {
    // Under CSS scroll-behavior:smooth, each frame would restart the animation.
    assert.equal(options.behavior, 'instant');
    scrolls.push(options.top);
    this.scrollY += options.top;
  }
};
const bindings = {
  isAutoScrolling: false, // Deliberately keep the render state stale until after the first frame.
  isAutoScrollingRef: { current: false },
  setIsAutoScrolling: value => { buttonState = value; },
  autoScrollAnimFrameRef: { current: null }, scrollSubpixelRef: { current: 0 },
  lastFrameTimeRef: { current: 0 }, autoScrollSpeedRef: { current: 1 },
  SPEED_PPS: { 1: 45, 2: 85, 3: 140, 4: 220 },
  requestAnimationFrame: fn => { frames.set(++nextId, fn); return nextId; },
  cancelAnimationFrame: id => frames.delete(id), performance: { now: () => now },
  window, document: { scrollingElement: scrollRoot, documentElement: { scrollHeight: 600 } },
  store: { notify: text => notifications.push(text) }
};
const { startAutoScroll, stopAutoScroll, toggleAutoScroll } = new Function(...Object.keys(bindings),
  code + '\nreturn {startAutoScroll, stopAutoScroll, toggleAutoScroll};')(...Object.values(bindings));
function frame(ms = 16) {
  now += ms;
  const [id, callback] = frames.entries().next().value;
  frames.delete(id);
  callback(now);
}
toggleAutoScroll();
assert.equal(buttonState, true);
frame(); frame();
assert.ok(window.scrollY > 0, 'Scrolling must start even before the button state has rendered');
assert.equal(notifications.length, 0, 'Use the actual scrolling element to determine the end of the page');
startAutoScroll();
assert.equal(frames.size, 1, 'A second start must not create another animation loop');
const beforePause = window.scrollY;
const delayedFrame = frames.values().next().value;
toggleAutoScroll();
assert.equal(buttonState, false, 'A rapid second tap must pause even before a rerender');
assert.equal(frames.size, 0);
delayedFrame(now + 16);
assert.equal(window.scrollY, beforePause, 'A cancelled late frame cannot keep scrolling');
startAutoScroll();
frame(100);
const slowStep = scrolls.at(-1);
bindings.autoScrollSpeedRef.current = 4;
frame(100);
assert.ok(scrolls.at(-1) > slowStep, 'Changing speed takes effect in the running loop');
const beforeSuspension = window.scrollY;
frame(300);
assert.equal(window.scrollY, beforeSuspension, 'Returning from a suspended mobile tab must not jump ahead');
window.scrollY = scrollRoot.scrollHeight - window.innerHeight;
frame();
assert.equal(buttonState, false);
assert.equal(frames.size, 0);
assert.equal(notifications.length, 1, 'Stop and notify once at the end of the chapter');
stopAutoScroll();
assert.equal(frames.size, 0);
console.log('Auto-scroll: first-frame race, smooth-scroll override, rapid pause, speed changes, tab suspension and end-of-chapter passed');
