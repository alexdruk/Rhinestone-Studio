// MONO-006: Monogram Generator UI.
//
// Focused tests for the Monogram Lightbox added to app.js/index.html. The UI is strictly a
// front-end -- it never computes layout, fitting, or collisions itself, only builds a request and
// calls MonogramGenerator.generate() (MONO-005/MONO-005A), then inserts the returned ordinary
// layers through the exact same commitHistory()+project.layers.push() pattern
// insertLibraryItem() already uses (RS-1015), so undo/redo treats a generated monogram as one
// step, same as inserting a Design Library item.
//
// PART A slices and REALLY EXECUTES the actual app.js source (lightboxes construction, menu
// wiring, lightboxForLayerType(), and the whole "Monogram Lightbox (MONO-006)" section) via
// `new Function`, against a minimal fake DOM and the real src/ui/Lightbox.js / src/history/
// HistoryManager.js / src/editing/selectMany() -- matching this repo's established app.js-testing
// convention (see tools/test-ui-import-autoswitch-regression.mjs). MonogramGenerator itself is
// stubbed here (a controllable fake collaborator, same "fake collaborator" precedent
// test-mono-002/005 already use) so PART A can isolate UI wiring/validation/insertion/undo
// behavior from the generator's own (already-tested) geometry.
//
// PART B is a real, non-sliced integration check: a genuine MonogramGenerator + real
// GeometryEngine (the exact construction recipe tools/test-mono-005-headless-monogram-generator.mjs
// uses) confirms the layers this UI inserts really do match app.js's own layer schema, really do
// export through the unmodified SvgExporter, and really do survive a Save/Open (JSON stringify/
// parse) round trip unchanged -- the three things MONO-006's own browser-verification checklist
// asks for that PART A's stub can't demonstrate.

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Lightbox } from '../src/ui/Lightbox.js';
import { el } from '../src/ui/index.js';
import { HistoryManager } from '../src/history/index.js';
import { selectMany } from '../src/editing/index.js';
import { GeometryEngine, SHAPE_LIBRARY_KINDS, StoneLayout, listFrames } from '../src/geometry/index.js';
import { listStoneSizes, findStoneSizeByDiameterMm } from '../src/renderer/StoneSizes.js';
import { STONE_COLORS } from '../src/renderer/StoneColors.js';
import { stoneLayoutToSvg } from '../src/export/SvgExporter.js';
import { FontManager } from '../src/fonts/index.js';
import { createDefaultFontProviderRegistry } from '../src/text/index.js';
import { MonogramGenerator, MONOGRAM_LAYOUTS, MONOGRAM_LAYOUT_LETTER_COUNTS, MONOGRAM_GENERATOR_FAILURE_REASONS } from '../src/monogram/index.js';

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

// ---------- Slice the real app.js source ----------

function sliceBetween(source, startMarker, endMarker, label, { inclusive = false } = {}) {
  const start = source.indexOf(startMarker);
  assert.ok(start !== -1, `expected to find "${startMarker}" (${label}) in app.js`);
  const endIdx = source.indexOf(endMarker, start);
  assert.ok(endIdx !== -1, `expected to find the end of ${label} in app.js`);
  return source.slice(start, inclusive ? endIdx + endMarker.length : endIdx);
}

function sliceLine(source, startMarker, label) {
  const start = source.indexOf(startMarker);
  assert.ok(start !== -1, `expected to find "${startMarker}" (${label}) in app.js`);
  const end = source.indexOf('\n', start);
  assert.ok(end !== -1, `expected a line ending after "${startMarker}" (${label}) in app.js`);
  return source.slice(start, end);
}

const shapeLayerTypesSrc = sliceLine(appJs, "const SHAPE_LAYER_TYPES=new Set(['circle','rectangle',...SHAPE_LIBRARY_KINDS]);", 'SHAPE_LAYER_TYPES');
const resolveFontProviderIdSrc = sliceLine(appJs, 'function resolveFontProviderId(fontId){', 'resolveFontProviderId()');
const fontCategoryLabelsSrc = sliceLine(appJs, 'const FONT_CATEGORY_LABELS=', 'FONT_CATEGORY_LABELS');
const fontCategoryLabelFnSrc = sliceLine(appJs, 'function fontCategoryLabel(role){', 'fontCategoryLabel()');
const groupFontsByCategorySrc = sliceLine(appJs, 'function groupFontsByCategory(fonts){', 'groupFontsByCategory()');
const productionFontsSrc = sliceLine(appJs, 'function productionFonts(){', 'productionFonts()');
const escapeHtmlSrc = sliceLine(appJs, 'function escapeHtml(s){', 'escapeHtml()');
const currentSnapshotSrc = sliceLine(appJs, 'function currentSnapshot(){', 'currentSnapshot()');
const commitHistorySrc = sliceLine(appJs, 'function commitHistory(){', 'commitHistory()');
const closeHistorySessionSrc = sliceLine(appJs, 'function closeHistorySession(){', 'closeHistorySession()');
const applyHistorySnapshotSrc = sliceLine(appJs, 'function applyHistorySnapshot(snap){', 'applyHistorySnapshot()');
const performUndoSrc = sliceLine(appJs, 'function performUndo(){', 'performUndo()');
const performRedoSrc = sliceLine(appJs, 'function performRedo(){', 'performRedo()');

const lightboxesSrc = sliceBetween(appJs, 'const lightboxes={', "\nel('menuText')", 'the lightboxes construction')
  .replace(/\nel\('menuText'\)$/, '');
const menuMonogramWiringSrc = (() => {
  // RS-3011 nav-toggle fix: #menuMonogram now also reveals Dual Workspace before opening (see
  // tools/test-ui-shell-structure.mjs's own coverage of revealDualWorkspaceForLightbox()). The
  // sandbox below stubs revealDualWorkspaceForLightbox as a no-op -- this test exercises Monogram
  // generation/validation/insertion, not the workspace-view switch, and none of the scenarios here
  // click #menuMonogram itself (they call s.lightboxes.monogram.open() directly).
  const line = "el('menuMonogram').onclick=()=>{revealDualWorkspaceForLightbox();lightboxes.monogram.open()};";
  assert.ok(appJs.includes(line), 'expected #menuMonogram to be wired to lightboxes.monogram.open(), revealing Dual Workspace first');
  return line;
})();
const lightboxForLayerTypeSrc = sliceBetween(appJs, 'function lightboxForLayerType(t){', '\n}', 'lightboxForLayerType()', { inclusive: true });
const monogramSectionSrc = sliceBetween(
  appJs,
  '// ---- Monogram Lightbox (MONO-006) ----',
  "el('monogramGenerate').onclick=()=>generateMonogram();",
  'the Monogram Lightbox section',
  { inclusive: true }
);

// ---------- Minimal fake DOM (same shape as tools/test-ui-import-autoswitch-regression.mjs) ----------

function makeFakeElement() {
  const classSet = new Set();
  return {
    style: {},
    classList: { add: (c) => classSet.add(c), remove: (c) => classSet.delete(c), contains: (c) => classSet.has(c) },
    addEventListener() {}, removeEventListener() {},
    querySelector() { return makeFakeElement(); },
    querySelectorAll() { return []; },
    focus() {},
    getBoundingClientRect() { return { left: 0, top: 0, width: 0, height: 0 }; },
    offsetWidth: 0, offsetHeight: 0,
    setPointerCapture() {}, releasePointerCapture() {},
    value: '', innerHTML: '', textContent: '', disabled: false
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

// ---------- Build a fresh sandbox ----------

const sandboxFactory = new Function(
  'Lightbox', 'HistoryManager', 'SHAPE_LIBRARY_KINDS', 'el', 'listFrames', 'listStoneSizes', 'findStoneSizeByDiameterMm', 'STONE_COLORS',
  'MONOGRAM_LAYOUTS', 'MONOGRAM_LAYOUT_LETTER_COUNTS', 'MONOGRAM_GENERATOR_FAILURE_REASONS',
  'fontManager', 'initialProject', 'selectMany', 'syncSelectedControlsFromLayer', 'updateAll', 'updateHistoryUI',
  'monogramGenerator',
  // Every one of these is referenced only inside OTHER Lightboxes' onOpen/onClose callbacks
  // (text/shapes/import/imagetrace/shipping/settings/library/gallery) -- unrelated to Monogram, but
  // the real `const lightboxes={...}` construction is sliced verbatim (see lightboxesSrc below), so
  // they must be supplied for the module-level S-105 exclusivity logic in src/ui/Lightbox.js to be
  // able to close a stale open Lightbox from an earlier scenario without throwing (same precedent as
  // tools/test-ui-import-autoswitch-regression.mjs's own stub list).
  'relocateFieldGroups', 'updateObjectTemplateDetail', 'updateImageTraceSections',
  'syncShippingFieldsFromState', 'syncSettingsFieldsFromState', 'onLibraryOpen', 'onGalleryOpen',
  `
  ${shapeLayerTypesSrc}
  ${resolveFontProviderIdSrc}
  ${fontCategoryLabelsSrc}
  ${fontCategoryLabelFnSrc}
  ${groupFontsByCategorySrc}
  ${productionFontsSrc}
  ${escapeHtmlSrc}
  const history=new HistoryManager({maxSize:100});
  let project=initialProject;
  let selectedLayerId='initial-layer';
  let selectedLayerIds=new Set(['initial-layer']);
  ${currentSnapshotSrc}
  ${commitHistorySrc}
  ${closeHistorySessionSrc}
  ${applyHistorySnapshotSrc}
  ${performUndoSrc}
  ${performRedoSrc}
  ${lightboxesSrc}
  ${menuMonogramWiringSrc}
  ${lightboxForLayerTypeSrc}
  ${monogramSectionSrc}
  return {
    lightboxes, lightboxForLayerType, generateMonogram, validateMonogramControls,
    updateMonogramGenerateButtonState, monogramFailureMessage,
    populateMonogramFrameOptions, populateMonogramLayoutOptions, populateMonogramFontOptions,
    populateMonogramStoneSizeOptions, populateMonogramColorOptions, updateMonogramFrameSizeBounds,
    updateMonogramLetterCountHint,
    performUndo, performRedo,
    getProject: () => project,
    getSelectedLayerId: () => selectedLayerId,
    getSelectedLayerIds: () => selectedLayerIds,
    getHistory: () => history
  };
  `
);

function makeFakeFontManager() {
  const fonts = [
    { id: 'rs-block', family: 'RS Block', role: 'block', providerId: 'rhinestone' },
    { id: 'rs-modern', family: 'RS Modern', role: 'sans-serif', providerId: 'rhinestone' },
    { id: 'courier-prime-regular', family: 'Courier Prime', role: 'monospace', providerId: 'opentype' }
  ];
  const byId = new Map(fonts.map((f) => [f.id, f]));
  return {
    listFonts: () => fonts,
    hasFont: (id) => byId.has(id),
    getFont: (id) => byId.get(id)
  };
}

function makeStubMonogramGenerator(nextResult) {
  return {
    calls: [],
    async generate(request) {
      this.calls.push(request);
      return typeof nextResult === 'function' ? nextResult(request) : nextResult;
    }
  };
}

function buildScenario({ project, monogramGenerator, fontManager = makeFakeFontManager() } = {}) {
  installFakeDom();
  const sandbox = sandboxFactory(
    Lightbox, HistoryManager, SHAPE_LIBRARY_KINDS, el, listFrames, listStoneSizes, findStoneSizeByDiameterMm, STONE_COLORS,
    MONOGRAM_LAYOUTS, MONOGRAM_LAYOUT_LETTER_COUNTS, MONOGRAM_GENERATOR_FAILURE_REASONS,
    fontManager, project || { canvas: { width: 200, height: 200 }, layers: [{ id: 'initial-layer', type: 'text' }] },
    selectMany, () => {}, () => {}, () => {},
    monogramGenerator,
    () => {}, () => {}, () => {}, () => {}, () => {}, () => {}, () => {}
  );
  return sandbox;
}

function fakeSuccessResult(layers) {
  return { ok: true, layers, measurements: {}, diagnostics: {} };
}

function fakeFailureResult(reason) {
  return { ok: false, reason, message: `stub failure: ${reason}`, layers: null, measurements: null, diagnostics: null };
}

function fakeGeneratedLayers() {
  return [
    { id: 'monogram-circle-single-frame', type: 'path', visible: true, pathName: 'Circle Frame', contours: [], x: 60, y: 60, w: 80, h: 80, stoneSize: 2.8, gap: 0.3, color: 'gold', fillMode: 'fill' },
    { id: 'monogram-circle-single-letter-0', type: 'text', visible: true, text: 'A', font: 'rs-block', height: 25, textMode: 'stroke', stoneSize: 2.8, gap: 0.3, color: 'gold', authoredScale: 1.2, autoFit: false, curveEnabled: false, curveRadiusMm: 40, curveDirection: 'outside', curveStartAngleDeg: 0, curveSweepAngleDeg: 180, curveAlignment: 'center', align: 'left', lineSpacing: 1, rotationDeg: 0, x: 0, y: 0 }
  ];
}

// =========================================================================================
// PART A -- real app.js wiring, stubbed generator
// =========================================================================================

// ---------- 1. Lightbox opens ----------

await test('1. #menuMonogram opens the Monogram Lightbox (and no other primary Lightbox)', () => {
  const s = buildScenario({ monogramGenerator: makeStubMonogramGenerator(fakeSuccessResult([])) });
  assert.equal(s.lightboxes.monogram.isOpen, false);
  s.lightboxes.text.open();
  assert.equal(s.lightboxes.text.isOpen, true);
  s.lightboxes.monogram.open();
  assert.equal(s.lightboxes.monogram.isOpen, true, 'Monogram Lightbox should open');
  assert.equal(s.lightboxes.text.isOpen, false, 'opening Monogram should close the other open primary Lightbox (S-105)');
});

await test('1b. Monogram is not part of lightboxForLayerType() -- generated layers behave as ordinary text/path layers, no special selection routing', () => {
  const s = buildScenario({ monogramGenerator: makeStubMonogramGenerator(fakeSuccessResult([])) });
  assert.equal(s.lightboxForLayerType('text'), s.lightboxes.text, 'existing text-layer routing must be unaffected');
  assert.equal(s.lightboxForLayerType('path'), s.lightboxes.shapes, 'a monogram-generated path (frame) layer routes to Shapes, like any other path layer');
});

// ---------- 2. Controls populate correctly ----------

await test('2a. Frame options are populated from the real FrameLibrary.listFrames() catalog', () => {
  const s = buildScenario({ monogramGenerator: makeStubMonogramGenerator(fakeSuccessResult([])) });
  s.populateMonogramFrameOptions();
  const html = el('monogramFrame').innerHTML;
  for (const frame of listFrames()) {
    assert.ok(html.includes(`value="${frame.id}"`), `expected a <option> for frame "${frame.id}"`);
    assert.ok(html.includes(frame.label), `expected frame "${frame.id}"'s label "${frame.label}" in the option text`);
  }
});

await test('2b. Layout options cover exactly the four MONOGRAM_LAYOUTS ids', () => {
  const s = buildScenario({ monogramGenerator: makeStubMonogramGenerator(fakeSuccessResult([])) });
  s.populateMonogramLayoutOptions();
  const html = el('monogramLayout').innerHTML;
  for (const id of Object.values(MONOGRAM_LAYOUTS)) {
    assert.ok(html.includes(`value="${id}"`), `expected a <option> for layout "${id}"`);
  }
});

await test('2c. Font options are the authored (production) fonts only -- OpenType fonts are excluded', () => {
  const s = buildScenario({ monogramGenerator: makeStubMonogramGenerator(fakeSuccessResult([])) });
  s.populateMonogramFontOptions();
  const html = el('monogramFont').innerHTML;
  assert.ok(html.includes('value="rs-block"'), 'expected the authored rs-block font to be offered');
  assert.ok(html.includes('value="rs-modern"'), 'expected the authored rs-modern font to be offered');
  assert.ok(!html.includes('courier-prime-regular'), 'an OpenType/sampled font must never be offered in the Monogram font picker');
});

await test('2d. Stone size options match the real Stone Library (listStoneSizes())', () => {
  const s = buildScenario({ monogramGenerator: makeStubMonogramGenerator(fakeSuccessResult([])) });
  s.populateMonogramStoneSizeOptions();
  const html = el('monogramStoneSize').innerHTML;
  for (const size of listStoneSizes()) {
    assert.ok(html.includes(`value="${size.diameterMm}"`), `expected a <option> for stone size ${size.diameterMm}mm`);
  }
});

await test('2e. Color options match the real crystal color catalog (STONE_COLORS)', () => {
  const s = buildScenario({ monogramGenerator: makeStubMonogramGenerator(fakeSuccessResult([])) });
  s.populateMonogramColorOptions();
  const html = el('monogramColor').innerHTML;
  for (const c of Object.values(STONE_COLORS)) {
    assert.ok(html.includes(`value="${c.id}"`), `expected a <option> for color "${c.id}"`);
  }
});

// ---------- 3. Letter-count validation ----------

await test('3a. validateMonogramControls() rejects a letter count that does not match the selected layout', () => {
  const s = buildScenario({ monogramGenerator: makeStubMonogramGenerator(fakeSuccessResult([])) });
  el('monogramFrame').value = 'circle';
  el('monogramLayout').value = MONOGRAM_LAYOUTS.TWO_LETTER;
  el('monogramFont').value = 'rs-block';
  el('monogramLetters').value = 'ABC'; // 3 letters, but Two Letter needs exactly 2
  el('monogramWidth').value = '80';
  el('monogramHeight').value = '80';
  const result = s.validateMonogramControls();
  assert.equal(result.ok, false);
  assert.match(result.message, /exactly 2 letter/);
});

await test('3b. validateMonogramControls() rejects empty letters, and accepts a matching count', () => {
  const s = buildScenario({ monogramGenerator: makeStubMonogramGenerator(fakeSuccessResult([])) });
  el('monogramFrame').value = 'square';
  el('monogramLayout').value = MONOGRAM_LAYOUTS.TRADITIONAL_THREE;
  el('monogramFont').value = 'rs-block';
  el('monogramWidth').value = '80';
  el('monogramHeight').value = '80';
  el('monogramLetters').value = '';
  assert.equal(s.validateMonogramControls().ok, false, 'empty letters must fail validation');
  el('monogramLetters').value = 'ABC';
  const ok3 = s.validateMonogramControls();
  assert.equal(ok3.ok, true);
  assert.deepEqual(ok3.letters, ['A', 'B', 'C']);
});

await test('3c. validateMonogramControls() rejects a zero/blank frame size', () => {
  const s = buildScenario({ monogramGenerator: makeStubMonogramGenerator(fakeSuccessResult([])) });
  el('monogramFrame').value = 'circle';
  el('monogramLayout').value = MONOGRAM_LAYOUTS.SINGLE;
  el('monogramFont').value = 'rs-block';
  el('monogramLetters').value = 'A';
  el('monogramWidth').value = '0';
  el('monogramHeight').value = '80';
  assert.equal(s.validateMonogramControls().ok, false, 'a zero frame width must fail validation');
});

await test('3d. updateMonogramGenerateButtonState() disables Generate for invalid input and enables it once valid', () => {
  const s = buildScenario({ monogramGenerator: makeStubMonogramGenerator(fakeSuccessResult([])) });
  el('monogramFrame').value = 'circle';
  el('monogramLayout').value = MONOGRAM_LAYOUTS.SINGLE;
  el('monogramFont').value = 'rs-block';
  el('monogramWidth').value = '80';
  el('monogramHeight').value = '80';
  el('monogramLetters').value = '';
  s.updateMonogramGenerateButtonState();
  assert.equal(el('monogramGenerate').disabled, true);
  el('monogramLetters').value = 'A';
  s.updateMonogramGenerateButtonState();
  assert.equal(el('monogramGenerate').disabled, false);
});

// ---------- 4. Generate button: request shape ----------

await test('4. Generate builds a request with letters split per-character, a canvas-centered frameRect, and project.canvas as canvasMm', async () => {
  const project = { canvas: { width: 200, height: 150 }, layers: [{ id: 'initial-layer', type: 'text' }] };
  const stub = makeStubMonogramGenerator(fakeSuccessResult(fakeGeneratedLayers()));
  const s = buildScenario({ project, monogramGenerator: stub });
  el('monogramFrame').value = 'circle';
  el('monogramLayout').value = MONOGRAM_LAYOUTS.SINGLE;
  el('monogramFont').value = 'rs-block';
  el('monogramStoneSize').value = '2.8';
  el('monogramColor').value = 'gold';
  el('monogramLetters').value = 'A';
  el('monogramWidth').value = '80';
  el('monogramHeight').value = '60';
  await s.generateMonogram();
  assert.equal(stub.calls.length, 1);
  const req = stub.calls[0];
  assert.equal(req.frameId, 'circle');
  assert.equal(req.layoutId, MONOGRAM_LAYOUTS.SINGLE);
  assert.deepEqual(req.letters, ['A']);
  assert.equal(req.fontId, 'rs-block');
  assert.equal(req.providerId, 'rhinestone', 'providerId must be resolved for the real engine to use the Rhinestone font provider, not OpenType');
  assert.equal(req.stoneSizeMm, 2.8);
  assert.equal(req.color, 'gold');
  assert.deepEqual(req.canvasMm, { widthMm: 200, heightMm: 150 });
  assert.deepEqual(req.frameRect, { xMm: 60, yMm: 45, widthMm: 80, heightMm: 60 });
});

// ---------- 5/6. Successful generation inserts layers as one undo step ----------

await test('5/6. Successful generation inserts every returned layer, selects them, commits exactly one undo step, and a single undo/redo removes/restores all of them together', async () => {
  const project = { canvas: { width: 200, height: 200 }, layers: [{ id: 'initial-layer', type: 'text' }] };
  const layers = fakeGeneratedLayers();
  const s = buildScenario({ project, monogramGenerator: makeStubMonogramGenerator(fakeSuccessResult(layers)) });
  el('monogramFrame').value = 'circle';
  el('monogramLayout').value = MONOGRAM_LAYOUTS.SINGLE;
  el('monogramFont').value = 'rs-block';
  el('monogramStoneSize').value = '2.8';
  el('monogramColor').value = 'gold';
  el('monogramLetters').value = 'A';
  el('monogramWidth').value = '80';
  el('monogramHeight').value = '80';

  assert.equal(s.getProject().layers.length, 1, 'sanity: one pre-existing layer before generation');
  await s.generateMonogram();
  assert.equal(s.getProject().layers.length, 1 + layers.length, 'both generated layers should be inserted');
  assert.deepEqual(new Set(s.getSelectedLayerIds()), new Set(layers.map((l) => l.id)), 'the generated layers should become the new selection');
  assert.equal(s.getHistory().pastSize, 1, 'generation must commit exactly ONE undo step, never one per layer');
  assert.equal(s.lightboxes.monogram.isOpen, false, 'the Lightbox should close after a successful generation');

  s.performUndo();
  assert.equal(s.getProject().layers.length, 1, 'a single undo must remove every generated layer together');
  assert.equal(s.getProject().layers[0].id, 'initial-layer');

  s.performRedo();
  assert.equal(s.getProject().layers.length, 1 + layers.length, 'a single redo must restore every generated layer together');
  assert.deepEqual(s.getProject().layers.slice(1).map((l) => l.id), layers.map((l) => l.id));
});

// ---------- 7. Generator failures ----------

for (const reason of Object.values(MONOGRAM_GENERATOR_FAILURE_REASONS)) {
  await test(`7. A "${reason}" generator failure shows a structured, non-internal message and leaves the project untouched`, async () => {
    const project = { canvas: { width: 200, height: 200 }, layers: [{ id: 'initial-layer', type: 'text' }] };
    const s = buildScenario({ project, monogramGenerator: makeStubMonogramGenerator(fakeFailureResult(reason)) });
    s.lightboxes.monogram.open();
    el('monogramFrame').value = 'circle';
    el('monogramLayout').value = MONOGRAM_LAYOUTS.SINGLE;
    el('monogramFont').value = 'rs-block';
    el('monogramStoneSize').value = '2.8';
    el('monogramColor').value = 'gold';
    el('monogramLetters').value = 'A';
    el('monogramWidth').value = '80';
    el('monogramHeight').value = '80';
    await s.generateMonogram();
    // MONO-006C/MONO-006E: monogramFailureMessage() now takes the full {reason,...} result plus the
    // request that was sent to the generator, so it can name the actual layout/frame size/stone
    // size in the message (see app.js's own doc comment on monogramFailureMessage()) -- mirroring
    // exactly what generateMonogram() itself passes (including layoutId), built from the same
    // control values set above.
    const message = s.monogramFailureMessage(
      { reason },
      { frameId: 'circle', layoutId: MONOGRAM_LAYOUTS.SINGLE, stoneSizeMm: 2.8, frameRect: { widthMm: 80, heightMm: 80 } }
    );
    assert.ok(message.length > 0);
    assert.ok(!message.includes('Error'), 'the displayed message must never be a raw exception string');
    assert.equal(el('monogramValidation').textContent, message);
    assert.equal(el('monogramValidation').style.display, 'block');
    assert.equal(s.getProject().layers.length, 1, 'a failed generation must never mutate project.layers');
    assert.equal(s.getHistory().pastSize, 0, 'a failed generation must never commit a history step');
    assert.equal(s.lightboxes.monogram.isOpen, true, 'the Lightbox must stay open on failure so the user can adjust settings');
  });
}

await test('7b. A thrown (unexpected) generator error is never shown to the user verbatim', async () => {
  const project = { canvas: { width: 200, height: 200 }, layers: [{ id: 'initial-layer', type: 'text' }] };
  const throwingGenerator = { async generate() { throw new Error('some internal stack trace detail'); } };
  const s = buildScenario({ project, monogramGenerator: throwingGenerator });
  s.lightboxes.monogram.open();
  el('monogramFrame').value = 'circle';
  el('monogramLayout').value = MONOGRAM_LAYOUTS.SINGLE;
  el('monogramFont').value = 'rs-block';
  el('monogramStoneSize').value = '2.8';
  el('monogramColor').value = 'gold';
  el('monogramLetters').value = 'A';
  el('monogramWidth').value = '80';
  el('monogramHeight').value = '80';
  await s.generateMonogram();
  assert.ok(!el('monogramValidation').textContent.includes('internal stack trace'), 'a raw exception message must never reach the user');
  assert.equal(s.getProject().layers.length, 1);
});

// =========================================================================================
// PART B -- real MonogramGenerator + real GeometryEngine (no slicing, no stub)
// =========================================================================================

const manifest = JSON.parse(await readFile(path.join(repoRoot, 'assets/fonts/manifest.json'), 'utf8'));
const realFontManager = new FontManager(manifest);
async function loadFontBufferFromRepoRoot(relativePath) {
  const buffer = await readFile(path.join(repoRoot, relativePath));
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
}
const fontProviderRegistry = createDefaultFontProviderRegistry(realFontManager, { loadFontBuffer: loadFontBufferFromRepoRoot });
const realEngine = new GeometryEngine({ fontProviderRegistry });
const realGenerator = new MonogramGenerator({ geometryEngine: realEngine });

const REAL_CANVAS_MM = { widthMm: 200, heightMm: 200 };
const REAL_REQUEST = {
  frameId: 'square', layoutId: MONOGRAM_LAYOUTS.SINGLE, letters: ['A'], fontId: 'rs-block', providerId: 'rhinestone',
  stoneSizeMm: 2.8, color: 'gold',
  frameRect: { xMm: 60, yMm: 60, widthMm: 80, heightMm: 80 },
  canvasMm: REAL_CANVAS_MM
};

await test('8. A real generated layer set matches app.js\'s own text/path layer schema field-for-field', async () => {
  const result = await realGenerator.generate(REAL_REQUEST);
  assert.equal(result.ok, true, result.message);
  const frameLayer = result.layers.find((l) => l.type === 'path');
  const letterLayer = result.layers.find((l) => l.type === 'text');
  assert.ok(frameLayer, 'expected one path (frame) layer');
  assert.ok(letterLayer, 'expected one text (letter) layer');
  for (const field of ['id', 'type', 'visible', 'pathName', 'contours', 'x', 'y', 'w', 'h', 'stoneSize', 'gap', 'color', 'fillMode']) {
    assert.ok(field in frameLayer, `frame layer missing field "${field}"`);
  }
  for (const field of ['id', 'type', 'visible', 'text', 'font', 'height', 'textMode', 'stoneSize', 'gap', 'color', 'authoredScale', 'align', 'lineSpacing', 'rotationDeg', 'x', 'y']) {
    assert.ok(field in letterLayer, `letter layer missing field "${field}"`);
  }
});

await test('9. Real generated layers export cleanly through the unmodified SvgExporter (no new export code needed)', async () => {
  const result = await realGenerator.generate(REAL_REQUEST);
  assert.equal(result.ok, true, result.message);
  const frameLayer = result.layers.find((l) => l.type === 'path');
  const letterLayer = result.layers.find((l) => l.type === 'text');

  const frameLayout = realEngine.generatePathLayout({
    contours: frameLayer.contours.map((poly) => poly.map((p) => ({ xMm: p.x, yMm: p.y }))),
    layerId: frameLayer.id, xMm: frameLayer.x, yMm: frameLayer.y, widthMm: frameLayer.w, heightMm: frameLayer.h,
    stoneSizeMm: frameLayer.stoneSize, gapMm: frameLayer.gap, mode: frameLayer.fillMode, color: frameLayer.color
  });
  const { offsetXMm, offsetYMm } = { offsetXMm: REAL_CANVAS_MM.widthMm / 2 + letterLayer.x, offsetYMm: REAL_CANVAS_MM.heightMm / 2 + letterLayer.y };
  const letterLayout = await realEngine.generateTextLayout({
    text: letterLayer.text, fontId: letterLayer.font, providerId: 'rhinestone', layerId: letterLayer.id, heightMm: letterLayer.height,
    stoneSizeMm: letterLayer.stoneSize, gapMm: 0, mode: 'outline', color: letterLayer.color, curveEnabled: false,
    authoredScale: letterLayer.authoredScale
  });
  // Translate onto the real placement contract's target the same way the merged live layout would.
  const box = letterLayout.getBoundingBox();
  const dx = offsetXMm - box.center.xMm, dy = offsetYMm - box.center.yMm;
  const translatedStones = letterLayout.stones.map((st) => new (st.constructor)({ xMm: st.xMm + dx, yMm: st.yMm + dy, sizeMm: st.sizeMm, color: st.color, layerId: st.layerId, index: st.index }));

  const merged = new StoneLayout({ layerId: 'merged', stones: [...frameLayout.stones, ...translatedStones] });
  assert.equal(merged.count, frameLayout.stones.length + translatedStones.length);
  const svg = stoneLayoutToSvg(merged, { widthMm: REAL_CANVAS_MM.widthMm, heightMm: REAL_CANVAS_MM.heightMm });
  assert.ok(svg.startsWith('<svg'));
  assert.ok(svg.includes('</svg>'));
  const circleCount = (svg.match(/<circle/g) || []).length;
  assert.equal(circleCount, merged.count, 'every stone should render as one <circle> in the exported SVG');
});

await test('10. Real generated layers survive an ordinary Save/Open (JSON stringify/parse) round trip unchanged', async () => {
  const result = await realGenerator.generate(REAL_REQUEST);
  assert.equal(result.ok, true, result.message);
  const project = { version: 2, units: 'mm', name: 'Monogram round-trip test', canvas: REAL_CANVAS_MM_AS_CANVAS(), layers: result.layers };
  const roundTripped = JSON.parse(JSON.stringify(project));
  assert.deepEqual(roundTripped.layers, result.layers, 'Save/Open (plain JSON) must preserve every generated layer field unchanged -- no special-casing needed since these are ordinary layers');
});
function REAL_CANVAS_MM_AS_CANVAS() { return { width: REAL_CANVAS_MM.widthMm, height: REAL_CANVAS_MM.heightMm }; }

console.log('MONO-006 (Monogram Generator UI) tests passed.');
