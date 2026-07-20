import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Lightbox } from '../src/ui/Lightbox.js';
import { SHAPE_LIBRARY_KINDS } from '../src/geometry/index.js';

// RC-003 — regression coverage for the Project Import Lightbox auto-open Release Candidate
// blocker.
//
// Root cause: #importProjectFile's success handler replaces `project`/`selectedLayerId` and then
// calls syncSelectedControlsFromLayer() *before* it closes the Import Lightbox
// (`lightboxes.importBox.close()` is the handler's last statement). syncSelectedControlsFromLayer()
// carries the S-105-follow-up auto-switch block (app.js, inside syncSelectedControlsFromLayer):
// whenever a type-specific Lightbox is open (activeFieldLightbox truthy) and a single layer is
// selected, it opens whichever Lightbox matches the *newly selected* layer's type
// (lightboxForLayerType()) so that Lightbox never sits empty across an ordinary selection change.
// That auto-switch has no way to distinguish "the operator clicked a different layer while Text
// was intentionally open" from "the whole project was just replaced by an import" -- at the moment
// it runs, activeFieldLightbox is still 'import' (the Import Lightbox has not been closed yet), so
// for a Text-first or Shape-first (or Image-first) imported project it dutifully opens the Text /
// Shapes / Image Trace Lightbox to match the freshly-imported first layer. Lightbox.js's
// `primary:true` exclusivity (src/ui/Lightbox.js open()) then closes the still-open Import Lightbox
// as a side effect of that open() call, so the handler's own trailing
// `lightboxes.importBox.close()` becomes a no-op (Import is already closed) -- the net visible
// effect is exactly the reported defect: Import closes, but Text/Shapes/Image Trace pops open
// unasked. SVG-first imports are unaffected: lightboxForLayerType() maps type 'svg' back to
// lightboxes.importBox itself (already open), so the auto-switch's `!target.isOpen` guard is
// already false and no reopen fires.
//
// Fix: close the Import Lightbox *before* calling syncSelectedControlsFromLayer(), so
// activeFieldLightbox is already null (Lightbox's onClose callback clears it) by the time the
// auto-switch check runs -- its `if(activeFieldLightbox&&...)` guard is then false and no
// Lightbox opens. This only reorders two statements already in the success handler; it does not
// change syncSelectedControlsFromLayer()'s auto-switch logic itself, so ordinary editing (a type-
// specific Lightbox left open while the operator changes the selection) is untouched.
//
// This suite extracts and REALLY EXECUTES app.js's own `lightboxes` construction, its
// `lightboxForLayerType()`, and the exact auto-switch fragment inside
// syncSelectedControlsFromLayer() (via `new Function`, using the real src/ui/Lightbox.js class
// against a minimal fake DOM), matching this repo's established app.js-testing convention (see
// e.g. tools/test-s110a-smart-shape-to-text-creation.mjs). The two statements under test --
// `lightboxes.importBox.close()` and `syncSelectedControlsFromLayer()` -- are replayed in whichever
// order app.js's real #importProjectFile handler source actually contains them, so this test
// exercises the live call sequence rather than an assumed one: it fails on unmodified `develop`
// (sync-then-close) and passes once the fix reorders them (close-then-sync).

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

// ---------- Extract the real #importProjectFile success-handler source ----------

const importHandlerStartMarker = "el('importProjectFile').addEventListener('change',async e=>{";
const importHandlerEndMarker = "\nel('importSvg').onclick=";
const importHandlerStart = appJs.indexOf(importHandlerStartMarker);
assert.ok(importHandlerStart !== -1, 'expected to find the #importProjectFile change handler in app.js');
const importHandlerEnd = appJs.indexOf(importHandlerEndMarker, importHandlerStart);
assert.ok(importHandlerEnd !== -1, 'expected to find the next handler (#importSvg) immediately after it, to bound the extraction');
const importHandlerSrc = appJs.slice(importHandlerStart, importHandlerEnd);

// Strip `//` comments first so an explanatory comment that happens to mention either function
// name (documenting *why* the statements are ordered the way they are, for instance) can never be
// mistaken for the real call site.
const importHandlerCodeOnly = importHandlerSrc.replace(/\/\/[^\n]*/g, '');
const closeIdx = importHandlerCodeOnly.indexOf('lightboxes.importBox.close()');
const syncIdx = importHandlerCodeOnly.indexOf('syncSelectedControlsFromLayer()');
assert.ok(closeIdx !== -1, 'expected the success handler to close the Import Lightbox');
assert.ok(syncIdx !== -1, 'expected the success handler to call syncSelectedControlsFromLayer()');

// ---------- Extract the real lightboxes/auto-switch source (unchanged by the fix) ----------

function sliceBetween(source, startMarker, endMarker, label) {
  const start = source.indexOf(startMarker);
  assert.ok(start !== -1, `expected to find "${startMarker}" (${label}) in app.js`);
  const endMarkerIdx = source.indexOf(endMarker, start);
  assert.ok(endMarkerIdx !== -1, `expected to find the end of ${label} in app.js`);
  return source.slice(start, endMarkerIdx + endMarker.length);
}

const activeFieldLightboxDeclSrc = (() => {
  const marker = 'let activeFieldLightbox=null;';
  assert.ok(appJs.includes(marker), 'expected the activeFieldLightbox declaration in app.js');
  return marker;
})();

const shapeLayerTypesSrc = sliceBetween(
  appJs, "const SHAPE_LAYER_TYPES=new Set(['circle','rectangle',...SHAPE_LIBRARY_KINDS]", ');',
  'SHAPE_LAYER_TYPES'
);

const lightboxesSrc = sliceBetween(appJs, 'const lightboxes={', "\nel('menuText')", 'the lightboxes construction').replace(/\nel\('menuText'\)$/, '');

const lightboxForLayerTypeSrc = sliceBetween(appJs, 'function lightboxForLayerType(t){', '\n}', 'lightboxForLayerType()');

const autoSwitchSrc = sliceBetween(
  appJs,
  "if(activeFieldLightbox&&activeFieldLightbox!=='shapes'&&selectedLayerIds.size<=1){",
  'if(target&&!target.isOpen)target.open();\n  }',
  "syncSelectedControlsFromLayer()'s auto-switch block"
);

// ---------- Minimal fake DOM: just enough for the real src/ui/Lightbox.js to run ----------

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
    setPointerCapture() {}, releasePointerCapture() {}
  };
}

// Re-installed before every scenario (fresh elements Map each time) so each buildScenario() call
// gets its own isolated set of fake overlay nodes -- otherwise document.getElementById('lightboxText')
// would resolve to the same fake overlay across scenarios and leak open/closed state between tests.
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
}

// ---------- Build a fresh { lightboxes, runAutoSwitch, getActiveFieldLightbox } sandbox ----------

const sandboxFactory = new Function(
  'Lightbox', 'SHAPE_LIBRARY_KINDS',
  'relocateFieldGroups', 'updateAll', 'updateObjectTemplateDetail', 'updateImageTraceSections',
  'syncShippingFieldsFromState', 'syncSettingsFieldsFromState', 'onLibraryOpen', 'onGalleryOpen',
  `
  ${activeFieldLightboxDeclSrc}
  ${shapeLayerTypesSrc}
  ${lightboxesSrc}
  ${lightboxForLayerTypeSrc}
  function runAutoSwitch(l, selectedLayerIds) {
    ${autoSwitchSrc}
  }
  return { lightboxes, runAutoSwitch, getActiveFieldLightbox: () => activeFieldLightbox };
  `
);

function buildScenario() {
  installFakeDom();
  return sandboxFactory(
    Lightbox, SHAPE_LIBRARY_KINDS,
    () => {}, () => {}, () => {}, () => {}, () => {}, () => {}, () => {}, () => {}
  );
}

/**
 * Replays "operator has the Import Lightbox open, picks a valid file whose first/selected layer
 * is `layerType`" by driving the real close()/runAutoSwitch() calls in whichever order app.js's
 * actual #importProjectFile handler source contains them (derived above, not assumed).
 */
function simulateImportCompletion(layerType) {
  const { lightboxes, runAutoSwitch, getActiveFieldLightbox } = buildScenario();
  const selectedLayerIds = new Set(['imported-layer-1']); // import always selects exactly one layer
  const l = { type: layerType };

  lightboxes.importBox.open();
  assert.equal(getActiveFieldLightbox(), 'import', 'sanity check: opening Import should set activeFieldLightbox');

  const closeStep = () => lightboxes.importBox.close();
  const syncStep = () => runAutoSwitch(l, selectedLayerIds);

  if (syncIdx < closeIdx) {
    syncStep(); closeStep();
  } else {
    closeStep(); syncStep();
  }

  return lightboxes;
}

// ---------- 1. The reported defect, per imported first-layer type ----------

for (const layerType of ['text', 'circle', 'image']) {
  await test(`1. importing a project whose selected layer is "${layerType}" closes Import and opens no other Lightbox (fails on unmodified develop)`, () => {
    const lightboxes = simulateImportCompletion(layerType);
    assert.equal(lightboxes.importBox.isOpen, false, 'Import Lightbox must be closed after a successful import');
    assert.equal(lightboxes.text.isOpen, false, 'Text Lightbox must not auto-open after import');
    assert.equal(lightboxes.shapes.isOpen, false, 'Shapes Lightbox must not auto-open after import');
    assert.equal(lightboxes.imagetrace.isOpen, false, 'Image Trace Lightbox must not auto-open after import');
  });
}

await test('2. importing an SVG-first project also ends with every field Lightbox closed (lightboxForLayerType maps svg back to Import itself, so this case never manifested the bug either way)', () => {
  const lightboxes = simulateImportCompletion('svg');
  assert.equal(lightboxes.importBox.isOpen, false);
  assert.equal(lightboxes.text.isOpen, false);
  assert.equal(lightboxes.shapes.isOpen, false);
  assert.equal(lightboxes.imagetrace.isOpen, false);
});

// ---------- 2. Normal editing regression: the auto-switch logic itself is untouched ----------

await test('3. regression: an intentionally-open Text Lightbox stays open when the operator selects another text layer', () => {
  const { lightboxes, runAutoSwitch } = buildScenario();
  lightboxes.text.open();
  runAutoSwitch({ type: 'text' }, new Set(['another-text-layer']));
  assert.equal(lightboxes.text.isOpen, true, 'Text should remain open for a same-type selection change');
});

await test('4. regression: an intentionally-open Text Lightbox auto-switches to Shapes when the operator selects an incompatible (shape) layer', () => {
  const { lightboxes, runAutoSwitch } = buildScenario();
  lightboxes.text.open();
  runAutoSwitch({ type: 'circle' }, new Set(['some-shape-layer']));
  assert.equal(lightboxes.shapes.isOpen, true, 'expected the existing S-105 follow-up auto-switch to still fire on an ordinary incompatible-type selection change');
  assert.equal(lightboxes.text.isOpen, false);
});

console.log('RC-003 (Project Import Lightbox auto-open) tests passed.');
