import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Lightbox } from '../src/ui/Lightbox.js';
import { el } from '../src/ui/index.js';

// RS-topmenu-active-state — top-menu buttons (#menuDesign, #menuText, #menuShapes, ...) previously
// never received aria-pressed or .active, so the existing CSS rule
// `.topmenu-btn[aria-pressed="true"]` in index.html never fired. This suite covers the two halves
// of the fix:
//
//   (a)/(b) src/ui/Lightbox.js's new `options.menuButtonId` -- open()/close() now keep the owning
//   top-menu button's aria-pressed in sync, including S-105 primary-exclusivity closing a
//   still-open sibling's button when a second primary Lightbox opens. Exercised against the real
//   Lightbox class (imported directly, not sliced), matching the "real collaborator" precedent
//   already used for Lightbox itself in tools/test-mono-006-monogram-ui.mjs and
//   tools/test-ui-import-autoswitch-regression.mjs -- only a minimal fake DOM stands in for
//   index.html (no jsdom dependency is pulled in beyond what those files already establish as this
//   repo's app.js/Lightbox.js DOM-testing convention; jsdom itself is reserved elsewhere in tools/
//   for Paper.js's Node shim, see tools/lib/paper-node-env.mjs).
//
//   (c) app.js's updateDrawToolButtons() -- extracted and REALLY EXECUTED via `new Function`
//   against the same fake-DOM convention (see e.g. tools/test-typography-font-library.mjs), since
//   app.js itself has no standalone entry point (no DOM available outside a browser). Confirms the
//   new `el('menuDesign').setAttribute('aria-pressed', String(active))` line added alongside the
//   existing Design tool-rail aria-pressed-sync block.

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const appJs = await readFile(path.join(repoRoot, 'app.js'), 'utf8');

async function test(name, fn) {
  try {
    await fn();
    console.log(`✓ ${name}`);
  } catch (error) {
    console.error(`✗ ${name}`);
    console.error(error);
    process.exitCode = 1;
  }
}

// ---------- Minimal fake DOM (same shape as tools/test-mono-006-monogram-ui.mjs /
// tools/test-ui-import-autoswitch-regression.mjs, plus setAttribute/getAttribute via the `_attrs`
// convention tools/test-typography-font-library.mjs already uses for aria-* assertions) ----------

function makeFakeElement() {
  const classSet = new Set();
  const attrs = {};
  return {
    style: {},
    classList: { add: (c) => classSet.add(c), remove: (c) => classSet.delete(c), contains: (c) => classSet.has(c) },
    setAttribute(k, v) { attrs[k] = String(v); },
    getAttribute(k) { return Object.prototype.hasOwnProperty.call(attrs, k) ? attrs[k] : null; },
    addEventListener() {}, removeEventListener() {},
    querySelector() { return makeFakeElement(); },
    querySelectorAll() { return []; },
    focus() {},
    getBoundingClientRect() { return { left: 0, top: 0, width: 0, height: 0 }; },
    offsetWidth: 0, offsetHeight: 0,
    setPointerCapture() {}, releasePointerCapture() {},
    value: '', innerHTML: '', textContent: '', title: '', disabled: false
  };
}

function installFakeDom() {
  const elements = new Map();
  globalThis.document = {
    getElementById(id) {
      if (!elements.has(id)) elements.set(id, makeFakeElement());
      return elements.get(id);
    },
    activeElement: null,
    addEventListener() {}, removeEventListener() {}
  };
  globalThis.window = { addEventListener() {}, innerWidth: 1024, innerHeight: 768 };
  return elements;
}

function buildLightboxes() {
  installFakeDom();
  return {
    text: new Lightbox('lightboxText', { primary: true, menuButtonId: 'menuText' }),
    shapes: new Lightbox('lightboxShapes', { primary: true, menuButtonId: 'menuShapes' })
  };
}

// ---------- (a)/(b): Lightbox <-> top-menu button aria-pressed sync ----------

await test('(a) opening lightboxes.text sets #menuText aria-pressed=true, and closing it sets aria-pressed=false', () => {
  const { text } = buildLightboxes();
  assert.equal(el('menuText').getAttribute('aria-pressed'), null, 'sanity check: aria-pressed unset before open');
  text.open();
  assert.equal(el('menuText').getAttribute('aria-pressed'), 'true');
  text.close();
  assert.equal(el('menuText').getAttribute('aria-pressed'), 'false');
});

await test('(b) opening a second primary Lightbox (shapes) while text is open clears #menuText\'s aria-pressed via the existing S-105 exclusivity close(), and sets #menuShapes\'s', () => {
  const { text, shapes } = buildLightboxes();
  text.open();
  assert.equal(el('menuText').getAttribute('aria-pressed'), 'true');
  shapes.open();
  assert.equal(text.isOpen, false, 'sanity check: S-105 exclusivity should have closed text');
  assert.equal(el('menuText').getAttribute('aria-pressed'), 'false');
  assert.equal(el('menuShapes').getAttribute('aria-pressed'), 'true');
});

// ---------- (c): app.js's updateDrawToolButtons() syncs #menuDesign ----------

function sliceBetween(source, startMarker, endMarker, label) {
  const start = source.indexOf(startMarker);
  assert.ok(start !== -1, `expected to find "${startMarker}" (${label}) in app.js`);
  const endIdx = source.indexOf(endMarker, start + startMarker.length);
  assert.ok(endIdx !== -1, `expected to find the end of ${label} in app.js`);
  return source.slice(start, endIdx + endMarker.length);
}

const updateDrawToolButtonsSrc = sliceBetween(appJs, 'function updateDrawToolButtons(){', '\n}', 'updateDrawToolButtons()');
assert.match(updateDrawToolButtonsSrc, /el\('menuDesign'\)\.setAttribute\('aria-pressed',String\(active\)\)/, 'expected updateDrawToolButtons() to sync #menuDesign the same way the rail buttons already are');

const updateDrawToolButtonsFactory = new Function(
  'el', 'drawingTool', 'project', 'unitSuffix', 'setLengthField', 'eraserSettings', 'stampSettings', 'traceSettings', 'paintSettings',
  `${updateDrawToolButtonsSrc}\nreturn updateDrawToolButtons;`
);

function buildUpdateDrawToolButtons(drawingTool) {
  installFakeDom();
  const project = { units: 'mm' };
  const eraserSettings = { radiusMm: 1, mode: 'stones' };
  const stampSettings = { sizeMm: 2, color: 'gold' };
  const traceSettings = { sizeMm: 2, gapMm: 0.3, color: 'gold' };
  const paintSettings = { sizeMm: 2, gapMm: 0.3, color: 'gold' };
  return updateDrawToolButtonsFactory(el, drawingTool, project, () => 'mm', () => {}, eraserSettings, stampSettings, traceSettings, paintSettings);
}

await test('(c) entering Design mode (drawingTool.isActive=true) sets #menuDesign aria-pressed=true', () => {
  const updateDrawToolButtons = buildUpdateDrawToolButtons({ isActive: true, mode: 'select' });
  updateDrawToolButtons();
  assert.equal(el('menuDesign').getAttribute('aria-pressed'), 'true');
});

await test('(c) exiting Design mode (drawingTool.isActive=false) sets #menuDesign aria-pressed=false', () => {
  const updateDrawToolButtons = buildUpdateDrawToolButtons({ isActive: false, mode: 'select' });
  updateDrawToolButtons();
  assert.equal(el('menuDesign').getAttribute('aria-pressed'), 'false');
});

console.log('Top-menu active-state tests passed.');
