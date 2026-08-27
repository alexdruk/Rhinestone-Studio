import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Lightbox } from '../src/ui/Lightbox.js';
import { el } from '../src/ui/index.js';

// RS-topmenu-active-persist — the original RS-topmenu-active-state wired each top-menu button's
// aria-pressed to its own Lightbox's open()/close(), so closing a lightbox (X, Escape, backdrop, or
// a programmatic close after a successful action) cleared the underline/highlight even though the
// user was still conceptually "in" that section. The highlight is now a navigation-level concept
// owned by app.js (TOP_MENU_BUTTON_IDS/activeTopMenuButtonId/setActiveTopMenuButton()) — Lightbox.js
// itself has no involvement in top-menu highlighting at all, see src/ui/Lightbox.js. This suite
// covers:
//
//   (a) clicking #menuText then #menuShapes, via their real onclick handlers extracted from app.js
//   and REALLY EXECUTED via `new Function` against a minimal fake DOM (same "real collaborator"
//   precedent as tools/test-mono-006-monogram-ui.mjs / tools/test-ui-import-autoswitch-regression.mjs
//   — no jsdom dependency), moves aria-pressed from one top-menu button to the other.
//
//   (b) once #menuText is active, calling lightboxes.text.close() directly (bypassing the top-menu
//   click) does NOT clear #menuText's aria-pressed -- this is the actual bug RS-topmenu-active-persist
//   fixes.
//
//   (c) app.js's updateDrawToolButtons() -- same extract-and-eval convention -- still syncs
//   #menuDesign on entering/exiting Design mode, and additionally clears a previously-set lightbox
//   top-menu highlight the moment Design mode is entered.

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
// tools/test-ui-import-autoswitch-regression.mjs) ----------

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

// ---------- Slice the real app.js source ----------

function sliceBetween(source, startMarker, endMarker, label) {
  const start = source.indexOf(startMarker);
  assert.ok(start !== -1, `expected to find "${startMarker}" (${label}) in app.js`);
  const endIdx = source.indexOf(endMarker, start + startMarker.length);
  assert.ok(endIdx !== -1, `expected to find the end of ${label} in app.js`);
  return source.slice(start, endIdx + endMarker.length);
}

// TOP_MENU_BUTTON_IDS/activeTopMenuButtonId/setActiveTopMenuButton() -- the navigation-level
// highlight concept itself.
const topMenuHelperSrc = sliceBetween(
  appJs, 'const TOP_MENU_BUTTON_IDS=', '\n}',
  'the TOP_MENU_BUTTON_IDS/activeTopMenuButtonId/setActiveTopMenuButton() block'
);

// #menuText/#menuShapes' real onclick handlers -- exactly two lines.
const menuTextShapesHandlersSrc = sliceBetween(
  appJs, "el('menuText').onclick=", "\nel('menuMonogram')",
  'the #menuText/#menuShapes onclick handlers'
).replace(/\nel\('menuMonogram'\)$/, '');

const updateDrawToolButtonsSrc = sliceBetween(appJs, 'function updateDrawToolButtons(){', '\n}', 'updateDrawToolButtons()');
assert.match(updateDrawToolButtonsSrc, /el\('menuDesign'\)\.setAttribute\('aria-pressed',String\(active\)\)/, 'expected updateDrawToolButtons() to sync #menuDesign the same way the rail buttons already are');
assert.match(updateDrawToolButtonsSrc, /if\(active\)setActiveTopMenuButton\(null\)/, 'expected updateDrawToolButtons() to clear any lingering lightbox-section highlight on entering Design mode');

const sandboxFactory = new Function(
  'el', 'lightboxes', 'revealDualWorkspaceForLightbox', 'drawingTool', 'project', 'unitSuffix', 'setLengthField',
  'eraserSettings', 'stampSettings', 'traceSettings', 'paintSettings',
  `
  ${topMenuHelperSrc}
  ${menuTextShapesHandlersSrc}
  ${updateDrawToolButtonsSrc}
  return { updateDrawToolButtons };
  `
);

function buildScenario(drawingTool = { isActive: false, mode: 'select' }) {
  installFakeDom();
  const lightboxes = {
    text: new Lightbox('lightboxText', { primary: true }),
    shapes: new Lightbox('lightboxShapes', { primary: true })
  };
  const project = { units: 'mm' };
  const eraserSettings = { radiusMm: 1, mode: 'stones' };
  const stampSettings = { sizeMm: 2, color: 'gold' };
  const traceSettings = { sizeMm: 2, gapMm: 0.3, color: 'gold' };
  const paintSettings = { sizeMm: 2, gapMm: 0.3, color: 'gold' };
  const sandbox = sandboxFactory(
    el, lightboxes, () => {}, drawingTool, project, () => 'mm', () => {},
    eraserSettings, stampSettings, traceSettings, paintSettings
  );
  return { lightboxes, ...sandbox };
}

// ---------- (a) clicking moves the highlight between top-menu buttons ----------

await test('(a) clicking #menuText then #menuShapes moves aria-pressed from one top-menu button to the other', () => {
  buildScenario();
  assert.equal(el('menuText').getAttribute('aria-pressed'), null, 'sanity check: aria-pressed unset before any click');
  el('menuText').onclick();
  assert.equal(el('menuText').getAttribute('aria-pressed'), 'true');
  el('menuShapes').onclick();
  assert.equal(el('menuText').getAttribute('aria-pressed'), 'false', 'moving to a different top-menu section must clear the previous one');
  assert.equal(el('menuShapes').getAttribute('aria-pressed'), 'true');
});

// ---------- (b) the actual bug: closing the Lightbox must not clear the highlight ----------

await test("(b) after #menuText is active, calling lightboxes.text.close() directly does NOT clear #menuText's aria-pressed", () => {
  const { lightboxes } = buildScenario();
  el('menuText').onclick();
  assert.equal(el('menuText').getAttribute('aria-pressed'), 'true');
  lightboxes.text.close();
  assert.equal(lightboxes.text.isOpen, false, 'sanity check: the Lightbox itself did close');
  assert.equal(el('menuText').getAttribute('aria-pressed'), 'true', 'the top-menu highlight must persist through a Lightbox close (X, Escape, backdrop, or a programmatic close), same as any other close');
});

// ---------- (c) updateDrawToolButtons() syncs #menuDesign and clears a lingering highlight ----------

await test('(c) entering Design mode (drawingTool.isActive=true) sets #menuDesign aria-pressed=true', () => {
  const { updateDrawToolButtons } = buildScenario({ isActive: true, mode: 'select' });
  updateDrawToolButtons();
  assert.equal(el('menuDesign').getAttribute('aria-pressed'), 'true');
});

await test('(c) exiting Design mode (drawingTool.isActive=false) sets #menuDesign aria-pressed=false', () => {
  const { updateDrawToolButtons } = buildScenario({ isActive: false, mode: 'select' });
  updateDrawToolButtons();
  assert.equal(el('menuDesign').getAttribute('aria-pressed'), 'false');
});

await test('(c) entering Design mode clears a previously-set lightbox top-menu highlight', () => {
  const { updateDrawToolButtons } = buildScenario({ isActive: true, mode: 'select' });
  el('menuText').onclick();
  assert.equal(el('menuText').getAttribute('aria-pressed'), 'true', 'sanity check: #menuText highlighted before entering Design');
  updateDrawToolButtons();
  assert.equal(el('menuText').getAttribute('aria-pressed'), 'false', 'entering Design mode must clear any lingering lightbox-section highlight');
  assert.equal(el('menuDesign').getAttribute('aria-pressed'), 'true');
});

console.log('Top-menu active-state tests passed.');
