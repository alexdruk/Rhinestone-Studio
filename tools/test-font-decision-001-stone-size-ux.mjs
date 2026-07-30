// FONT-DECISION-001 (Studio Integration follow-up) — Stone Size UX.
//
// Two Studio product improvements built on FONT-DECISION-001's validated per-size text-height
// ranges (StoneSizes.js's supportedHeightRangeMm, mirrored from tools/font-generator/config/SS*.json):
//
//   1. Auto-set Text height to a stone size's own validated midpoint the moment it's selected for a
//      text layer -- unless the operator already manually chose a height for that layer AND it's
//      still valid for the newly-selected size (app.js's applyStoneSizeHeightAutoSet(), wired from
//      #stoneSize's 'input' listener).
//   2. Disable (+ dim + explain via title) any #stoneSize <option> whose entire validated height
//      range can never fit the currently-selected object shape's real, live printable height
//      (app.js's updateStoneSizePrintableCapabilityUI(), reusing getSafeAreaRectMm() -- the same
//      safe-area rectangle isTextOutsidePrintableArea()'s "outside printable area" warning already
///     checks text against).
//
// app.js is a browser entry point (not import()-able directly under plain Node -- it runs
// document.getElementById() at module scope), so these are extracted and really executed against
// stub el()/layer/project, the established convention (tools/test-txt-103-text-sizing-consistency.mjs,
// tools/test-mono-006b-stale-authored-scale-initial-load-recovery.mjs).

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  listStoneSizes,
  getStoneSize,
  findStoneSizeByDiameterMm,
  isHeightWithinStoneSizeRange,
  stoneSizeHeightMidpointMm,
  stoneSizeEntirelyExceedsPrintableHeight
} from '../src/renderer/StoneSizes.js';
import { getObjectTemplate, getSafeAreaRectMm, getVesselDefaults, computeCanvasFromVessel } from '../src/products/index.js';

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

// ---------- Slice the real app.js source (same convention as TXT-103/MONO-006B) ----------

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

const applyStoneSizeHeightAutoSetSrc = sliceBalanced(appJs, 'function applyStoneSizeHeightAutoSet(l,size){', 'applyStoneSizeHeightAutoSet()');
const updateStoneSizePrintableCapabilityUISrc = sliceBalanced(appJs, 'function updateStoneSizePrintableCapabilityUI(){', 'updateStoneSizePrintableCapabilityUI()');

// ---------- Minimal DOM/state stubs ----------

function makeStoneSizeSelectStub() {
  const options = listStoneSizes().map((s) => ({ value: String(s.diameterMm), disabled: false, title: '' }));
  return {
    options,
    querySelector(selector) {
      const m = selector.match(/option\[value="([^"]+)"\]/);
      return m ? options.find((o) => o.value === m[1]) || null : null;
    }
  };
}

function makeEnv() {
  const dom = {
    height: { value: '25', style: { display: 'none' }, textContent: '' },
    heightAutoAdjustedHint: { style: { display: 'none' }, textContent: '' },
    stoneSize: makeStoneSizeSelectStub()
  };
  const el = (id) => dom[id];
  let layer = { type: 'text' };
  let template = getObjectTemplate('mug');
  const project = { canvas: computeCanvasFromVessel(getVesselDefaults('mug')) };
  const factory = new Function(
    'el', 'selectedLayer', 'currentObjectTemplate', 'project',
    'listStoneSizes', 'getSafeAreaRectMm', 'stoneSizeEntirelyExceedsPrintableHeight',
    'isHeightWithinStoneSizeRange', 'stoneSizeHeightMidpointMm',
    `
    ${applyStoneSizeHeightAutoSetSrc}
    ${updateStoneSizePrintableCapabilityUISrc}
    return { applyStoneSizeHeightAutoSet, updateStoneSizePrintableCapabilityUI };
    `
  );
  const { applyStoneSizeHeightAutoSet, updateStoneSizePrintableCapabilityUI } = factory(
    el, () => layer, () => template, project,
    listStoneSizes, getSafeAreaRectMm, stoneSizeEntirelyExceedsPrintableHeight,
    isHeightWithinStoneSizeRange, stoneSizeHeightMidpointMm
  );
  return {
    dom,
    el,
    applyStoneSizeHeightAutoSet,
    updateStoneSizePrintableCapabilityUI,
    setLayer: (l) => { layer = l; },
    setTemplate: (id) => { template = getObjectTemplate(id); project.canvas = computeCanvasFromVessel(getVesselDefaults(id)); },
    project
  };
}

// ---------- (a) auto-set height on stone-size change for a fresh layer ----------

await test('(a) a fresh text layer (never manually edited) gets its height auto-set to the newly-selected stone size\'s validated midpoint', () => {
  const env = makeEnv();
  const layer = { type: 'text' }; // heightManuallyEdited never set
  env.setLayer(layer);
  env.dom.height.value = '25';
  env.applyStoneSizeHeightAutoSet(layer, getStoneSize('ss16'));
  assert.equal(env.dom.height.value, 77.5, 'SS16 midpoint is (65+90)/2 = 77.5');
  assert.equal(env.dom.heightAutoAdjustedHint.style.display, 'none', 'first auto-set on a fresh layer is expected, unannounced behavior -- no hint');
  assert.notEqual(layer.heightManuallyEdited, true, 'applyStoneSizeHeightAutoSet() must never itself mark a layer as manually edited');
});

await test('(a) every catalog size auto-sets to its own documented midpoint', () => {
  const env = makeEnv();
  const layer = { type: 'text' };
  env.setLayer(layer);
  const expected = { ss6: 42.5, ss10: 52.5, ss16: 77.5, ss20: 95, ss30: 108.5 };
  for (const [id, midpoint] of Object.entries(expected)) {
    env.applyStoneSizeHeightAutoSet(layer, getStoneSize(id));
    assert.equal(env.dom.height.value, midpoint, `${id} should auto-set height to ${midpoint}`);
  }
});

// ---------- (b) auto-set does NOT override a manually-edited height unless out of range ----------

await test('(b) a manually-edited height within the newly-selected size\'s range is left untouched', () => {
  const env = makeEnv();
  const layer = { type: 'text', heightManuallyEdited: true };
  env.setLayer(layer);
  env.dom.height.value = '70'; // within SS16's [65,90]
  env.applyStoneSizeHeightAutoSet(layer, getStoneSize('ss16'));
  assert.equal(env.dom.height.value, '70', 'a manually-edited, still-valid height must not be silently overridden');
  assert.equal(env.dom.heightAutoAdjustedHint.style.display, 'none');
});

await test('(b) a manually-edited height that falls outside the newly-selected size\'s range is snapped to the midpoint, with an explanatory hint', () => {
  const env = makeEnv();
  const layer = { type: 'text', heightManuallyEdited: true };
  env.setLayer(layer);
  env.dom.height.value = '70'; // valid for SS16, but SS6's range is [35,50]
  env.applyStoneSizeHeightAutoSet(layer, getStoneSize('ss6'));
  assert.equal(env.dom.height.value, 42.5, 'out-of-range manual height must be corrected to the new size\'s midpoint');
  assert.equal(env.dom.heightAutoAdjustedHint.style.display, 'block', 'an out-of-range correction must be explained, unlike a first-selection auto-set');
  assert.match(env.dom.heightAutoAdjustedHint.textContent, /SS6/);
  assert.equal(layer.heightManuallyEdited, true, 'the manual-edit flag itself is not touched by this function (only #height\'s own listener sets/clears it)');
});

// ---------- (c) stone-size options correctly disabled per shape ----------

await test('(c) Mug: SS20 and SS30 are disabled (their entire validated range exceeds the Mug\'s real printable height), SS6/SS10/SS16 stay enabled', () => {
  const env = makeEnv();
  env.setLayer({ type: 'text' });
  env.setTemplate('mug');
  env.updateStoneSizePrintableCapabilityUI();
  const safe = getSafeAreaRectMm(getObjectTemplate('mug'), env.project.canvas.width, env.project.canvas.height);
  for (const id of ['ss6', 'ss10', 'ss16']) {
    const size = getStoneSize(id);
    const option = env.dom.stoneSize.querySelector(`option[value="${size.diameterMm}"]`);
    assert.equal(option.disabled, false, `${size.name} (range ${size.supportedHeightRangeMm}) should stay enabled against a ${safe.heightMm}mm printable height`);
  }
  for (const id of ['ss20', 'ss30']) {
    const size = getStoneSize(id);
    const option = env.dom.stoneSize.querySelector(`option[value="${size.diameterMm}"]`);
    assert.equal(option.disabled, true, `${size.name} (range ${size.supportedHeightRangeMm}) should be disabled against a ${safe.heightMm}mm printable height`);
    assert.match(option.title, new RegExp(size.name));
    assert.match(option.title, /Mug/);
  }
});

await test('(c) a non-text layer selection leaves every #stoneSize option enabled, regardless of shape (supportedHeightRangeMm is a text-legibility concept, not a general geometry constraint)', () => {
  const env = makeEnv();
  env.setLayer({ type: 'circle' });
  env.setTemplate('mug');
  env.updateStoneSizePrintableCapabilityUI();
  for (const size of listStoneSizes()) {
    const option = env.dom.stoneSize.querySelector(`option[value="${size.diameterMm}"]`);
    assert.equal(option.disabled, false, `${size.name} must stay enabled for a non-text layer`);
    assert.equal(option.title, '');
  }
});

// ---------- (d) switching shapes correctly re-evaluates disabled options ----------

await test('(d) switching from Mug to Tumbler re-evaluates and re-enables options that now fit the new shape\'s own printable height', () => {
  const env = makeEnv();
  env.setLayer({ type: 'text' });
  env.setTemplate('mug');
  env.updateStoneSizePrintableCapabilityUI();
  const ss20OptionMug = env.dom.stoneSize.querySelector('option[value="4.7"]');
  assert.equal(ss20OptionMug.disabled, true, 'sanity check: SS20 starts disabled for Mug');

  env.setTemplate('tumbler');
  env.updateStoneSizePrintableCapabilityUI();
  const tumblerSafe = getSafeAreaRectMm(getObjectTemplate('tumbler'), env.project.canvas.width, env.project.canvas.height);
  const ss20OptionTumbler = env.dom.stoneSize.querySelector('option[value="4.7"]');
  assert.equal(
    ss20OptionTumbler.disabled,
    stoneSizeEntirelyExceedsPrintableHeight(getStoneSize('ss20'), tumblerSafe.heightMm),
    'the disabled state after switching shape must reflect the Tumbler\'s own real printable height, not the stale Mug value'
  );
  // Same option object mutated in place -- proves this is live re-evaluation, not a one-time computation.
  assert.equal(ss20OptionTumbler, ss20OptionMug);
});

// ---------- Wiring sanity: registration order + markup ----------

await test('registration order: #stoneSize\'s auto-set listener and #height\'s manual-edit listener are both registered before HISTORY_TRACKED_CONTROL_IDS\' own generic listeners on the same elements', () => {
  const historyLoopIndex = appJs.indexOf("const HISTORY_TRACKED_CONTROL_IDS=");
  const stoneSizeListenerIndex = appJs.indexOf("el('stoneSize').addEventListener('input',()=>{\n  const l=selectedLayer();");
  const heightListenerIndex = appJs.indexOf("el('height').addEventListener('input',()=>{\n  const l=selectedLayer();");
  assert.ok(stoneSizeListenerIndex !== -1 && stoneSizeListenerIndex < historyLoopIndex, 'the #stoneSize auto-set listener must be registered before the generic HISTORY_TRACKED_CONTROL_IDS loop');
  assert.ok(heightListenerIndex !== -1 && heightListenerIndex < historyLoopIndex, 'the #height manual-edit listener must be registered before the generic HISTORY_TRACKED_CONTROL_IDS loop');
});

await test('index.html declares #heightAutoAdjustedHint next to #height, matching the #textSizeFixedHint inline-note convention', () => {
  assert.match(indexHtml, /<p class="hint" id="heightAutoAdjustedHint" style="display:none"><\/p>/);
});

console.log('FONT-DECISION-001 Stone Size UX tests passed.');
