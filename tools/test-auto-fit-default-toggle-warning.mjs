// Auto Fit default flip + Off->On warning.
//
// Two changes to text-layer Auto Fit:
//
//   1. New text layers now default to Auto Fit Off (previously On) -- both places a text layer is
//      created (defaultProject()'s initial layer, addText()'s "+ Add Text" layer). Existing saved
//      layers are untouched: validateProject() never coerces a missing/stored autoFit value (see the
//      "permissive style for other boolean-ish fields" comment above its image-layer checks), and
//      syncSelectedControlsFromLayer() always reads l.autoFit as-is (`l.autoFit?'on':'off'`).
//   2. Every deliberate Off->On flip of #autoFit shows a brief inline hint (#autoFitOnHint) explaining
//      that Auto Fit can shrink text below the height needed for reliable readability. Never shown for
//      On->Off, and never shown just because a saved layer with autoFit:true was selected (that path
//      only ever touches el('autoFit').value, not the 'input' event this is gated on).
//
// app.js is a browser entry point (not import()-able under plain Node -- it runs
// document.getElementById() at module scope), so the real functions/listener are extracted from its
// source and executed against stub el()/layer/project, the established convention
// (tools/test-font-decision-001-stone-size-ux.mjs, tools/test-txt-103-text-sizing-consistency.mjs).

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getVesselDefaults, computeCanvasFromVessel, getPlateDefaults } from '../src/products/index.js';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const appJs = await readFile(path.join(repoRoot, 'app.js'), 'utf8');
const indexHtml = await readFile(path.join(repoRoot, 'index.html'), 'utf8');

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

// ---------- Slice the real app.js source (same convention as FONT-DECISION-001/TXT-103) ----------

function sliceBalanced(source, startMarker, label) {
  const start = source.indexOf(startMarker);
  assert.ok(start !== -1, `expected to find "${startMarker}" (${label}) in app.js`);
  const braceStart = source.indexOf('{', start);
  assert.ok(braceStart !== -1, `expected an opening brace after "${startMarker}" (${label})`);
  let depth = 0;
  for (let i = braceStart; i < source.length; i += 1) {
    if (source[i] === '{') depth += 1;
    else if (source[i] === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(start, i + 1);
    }
  }
  throw new Error(`unbalanced braces slicing "${startMarker}" (${label})`);
}

// Same brace-balanced technique, but for an inline arrow-function body rather than a named
// `function name(){...}` declaration -- startMarker must itself end at the arrow's opening brace.
function extractArrowBody(source, startMarker, label) {
  const start = source.indexOf(startMarker);
  assert.ok(start !== -1, `expected to find "${startMarker}" (${label}) in app.js`);
  const braceStart = start + startMarker.length - 1;
  assert.equal(source[braceStart], '{', `marker must end at the arrow function's opening brace (${label})`);
  let depth = 0;
  for (let i = braceStart; i < source.length; i += 1) {
    if (source[i] === '{') depth += 1;
    else if (source[i] === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(braceStart + 1, i);
    }
  }
  throw new Error(`unbalanced braces extracting "${startMarker}" (${label})`);
}

const defaultProjectSrc = sliceBalanced(appJs, 'function defaultProject(){', 'defaultProject()');
const addTextSrc = sliceBalanced(appJs, 'async function addText(){', 'addText()');
const autoFitListenerBody = extractArrowBody(appJs, "el('autoFit').addEventListener('input',()=>{", "#autoFit toggle listener");

// ---------- (a) defaultProject()'s initial text layer defaults to Auto Fit Off ----------

await test('(a) defaultProject() creates its initial text layer with autoFit:false', () => {
  const factory = new Function(
    'getVesselDefaults', 'computeCanvasFromVessel', 'getPlateDefaults', 'DEFAULT_PROJECT_NAME', 'DEFAULT_TEXT_FONT_ID',
    `${defaultProjectSrc}\nreturn defaultProject();`
  );
  const project = factory(getVesselDefaults, computeCanvasFromVessel, getPlateDefaults, 'Untitled Project', 'rs-block');
  const textLayer = project.layers.find((l) => l.type === 'text');
  assert.ok(textLayer, 'defaultProject() must still seed an initial text layer');
  assert.equal(textLayer.autoFit, false, 'a brand-new project\'s text layer must default to Auto Fit Off');
});

// ---------- (b) addText()'s "+ Add Text" layer also defaults to Auto Fit Off ----------

await test('(b) addText() ("+ Add Text") builds its new layer literal with autoFit:false, not autoFit:true', () => {
  assert.match(addTextSrc, /autoFit:false/, 'addText()\'s new-layer literal must set autoFit:false');
  assert.doesNotMatch(addTextSrc, /autoFit:true/, 'addText() must no longer default a new layer to Auto Fit On');
});

// ---------- (c) the Off->On toggle listener ----------

function makeToggleEnv(initialAutoFitValue) {
  const dom = {
    autoFit: { value: initialAutoFitValue },
    autoFitOnHint: { style: { display: 'none' } },
  };
  const el = (id) => dom[id];
  let layer = { type: 'text', autoFit: initialAutoFitValue === 'on' };
  const run = new Function('el', 'selectedLayer', autoFitListenerBody);
  return {
    dom,
    fireToggle: (nextValue) => { dom.autoFit.value = nextValue; run(el, () => layer); },
    setLayer: (l) => { layer = l; },
    getLayer: () => layer,
  };
}

await test('(c) switching Auto Fit Off->On shows the inline hint', () => {
  const env = makeToggleEnv('off');
  env.fireToggle('on');
  assert.equal(env.dom.autoFitOnHint.style.display, 'block');
});

await test('(c) switching Auto Fit On->Off does not show the hint', () => {
  const env = makeToggleEnv('on');
  env.fireToggle('off');
  assert.equal(env.dom.autoFitOnHint.style.display, 'none');
});

await test('(c) a layer already On (loaded from a saved project) firing an on->on no-op event does not show the hint', () => {
  const env = makeToggleEnv('on');
  env.fireToggle('on');
  assert.equal(env.dom.autoFitOnHint.style.display, 'none', 'not a genuine Off->On flip -- the layer was already On before this event');
});

await test('(c) a non-text layer selection never shows the hint, regardless of the control\'s value', () => {
  const env = makeToggleEnv('off');
  env.setLayer({ type: 'circle', autoFit: false });
  env.fireToggle('on');
  assert.equal(env.dom.autoFitOnHint.style.display, 'none');
});

await test('(c) toggling Off->On repeatedly within the same session shows the hint every time (no "seen this before" state)', () => {
  const env = makeToggleEnv('off');
  for (let i = 0; i < 3; i += 1) {
    // Off->On: listener fires first (pre-toggle l.autoFit still false), matching this listener's
    // real registration order ahead of HISTORY_TRACKED_CONTROL_IDS' generic listener, which is what
    // actually writes l.autoFit=true afterward -- simulated here by mutating the layer post-fire.
    env.fireToggle('on');
    assert.equal(env.dom.autoFitOnHint.style.display, 'block', `iteration ${i}: Off->On must show the hint every time`);
    env.getLayer().autoFit = true; // simulates writeSelectedControlsToLayer()'s subsequent write
    env.fireToggle('off');
    assert.equal(env.dom.autoFitOnHint.style.display, 'none', `iteration ${i}: On->Off must not show the hint`);
    env.getLayer().autoFit = false; // simulates writeSelectedControlsToLayer()'s subsequent write
  }
});

// ---------- Wiring sanity: registration order + markup ----------

await test('registration order: #autoFit\'s toggle listener is registered before HISTORY_TRACKED_CONTROL_IDS\' own generic listener on the same element/event', () => {
  const historyLoopIndex = appJs.indexOf('const HISTORY_TRACKED_CONTROL_IDS=');
  const autoFitListenerIndex = appJs.indexOf("el('autoFit').addEventListener('input',()=>{");
  assert.ok(autoFitListenerIndex !== -1 && autoFitListenerIndex < historyLoopIndex, 'the #autoFit toggle listener must run before the generic HISTORY_TRACKED_CONTROL_IDS loop overwrites l.autoFit');
});

await test('index.html declares #autoFitOnHint next to #autoFit, matching the #heightAutoAdjustedHint inline-note convention', () => {
  assert.match(indexHtml, /<p class="hint" id="autoFitOnHint" style="display:none">[^<]+<\/p>/);
});

await test('syncSelectedControlsFromLayer() hides #autoFitOnHint on every selection sync (so an already-On saved layer never shows it merely by being selected)', () => {
  const syncSrc = sliceBalanced(appJs, 'function syncSelectedControlsFromLayer(){', 'syncSelectedControlsFromLayer()');
  assert.match(syncSrc, /el\('autoFit'\)\.value=l\.autoFit\?'on':'off';el\('autoFitOnHint'\)\.style\.display='none';/, 'the hint must be hidden in the same statement that syncs #autoFit\'s value from the layer');
});

console.log('Auto Fit default + toggle-warning tests passed.');
