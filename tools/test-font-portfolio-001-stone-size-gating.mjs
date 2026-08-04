// FONT-PORTFOLIO-001 — Stone Size dropdown gating by font.
//
// Extends FONT-DECISION-001's shape-aware updateStoneSizePrintableCapabilityUI() (see
// tools/test-font-decision-001-stone-size-ux.mjs, tests (c)/(d)) with a second, independent gate:
// a font's own manifest.json `unsupportedStoneSizes` (FontManager.js). Human rating found
// Anton/Sacramento/Dancing Script all collapse at SS30 specifically, for reasons no shape's
// printable-area math would ever catch (SS30's own height range comfortably fits plenty of
// shapes) -- so this needs its own gate, data-driven from the manifest, not hardcoded per font.
//
// Same "slice the real app.js source and really execute it" convention as
// test-font-decision-001-stone-size-ux.mjs (itself following TXT-103/MONO-006B).

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { listStoneSizes, getStoneSize, stoneSizeEntirelyExceedsPrintableHeight } from '../src/renderer/StoneSizes.js';
import { getObjectTemplate, getSafeAreaRectMm, getVesselDefaults, computeCanvasFromVessel, getPlateDefaults } from '../src/products/index.js';
import { FontManager } from '../src/fonts/index.js';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const appJs = await readFile(path.join(repoRoot, 'app.js'), 'utf8');
const manifest = JSON.parse(await readFile(path.join(repoRoot, 'assets/fonts/manifest.json'), 'utf8'));

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

const updateStoneSizePrintableCapabilityUISrc = sliceBalanced(appJs, 'function updateStoneSizePrintableCapabilityUI(){', 'updateStoneSizePrintableCapabilityUI()');

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
  const fontManager = new FontManager(manifest);
  const dom = { stoneSize: makeStoneSizeSelectStub() };
  const el = (id) => dom[id];
  let layer = { type: 'text', font: 'baloo2-variable-regular' };
  let template = getObjectTemplate('mug');
  const project = { canvas: computeCanvasFromVessel(getVesselDefaults('mug')) };
  const isFontKnown = (fontId) => Boolean(fontManager && fontManager.hasFont(fontId));
  // Mirrors app.js's own project.canvas convention for each product kind (see app.js's plate
  // params-change handler, project.canvas={width:outerDiameterMm,height:outerDiameterMm}) --
  // a plate's canvas is a flat top-down square bounding the outer diameter, not a vessel's
  // unwrapped-cylinder-wall canvas.
  const canvasForTemplate = (id) => id === 'plate'
    ? { width: getPlateDefaults().outerDiameterMm, height: getPlateDefaults().outerDiameterMm }
    : computeCanvasFromVessel(getVesselDefaults(id));
  const factory = new Function(
    'el', 'selectedLayer', 'currentObjectTemplate', 'project',
    'listStoneSizes', 'getSafeAreaRectMm', 'stoneSizeEntirelyExceedsPrintableHeight',
    'isFontKnown', 'fontManager',
    `
    ${updateStoneSizePrintableCapabilityUISrc}
    return { updateStoneSizePrintableCapabilityUI };
    `
  );
  const { updateStoneSizePrintableCapabilityUI } = factory(
    el, () => layer, () => template, project,
    listStoneSizes, getSafeAreaRectMm, stoneSizeEntirelyExceedsPrintableHeight,
    isFontKnown, fontManager
  );
  return {
    dom,
    updateStoneSizePrintableCapabilityUI,
    setLayer: (l) => { layer = l; },
    setTemplate: (id) => { template = getObjectTemplate(id); project.canvas = canvasForTemplate(id); },
    fontManager,
    project
  };
}

// A shape with plenty of printable height so every assertion below isolates the font gate --
// SS30's own supportedHeightRangeMm ([106,111]) must fit easily, so any SS30 disabling seen here
// can only be the font gate, never FONT-DECISION-001's shape gate. Every vessel template (Mug,
// Tumbler, Bottle) already has a printable height under 111mm (see
// test-font-decision-001-stone-size-ux.mjs's own Mug fixture, where SS30 is disabled by the shape
// gate) -- only the Plate's flat, top-down full-diameter safe area is roomy enough to isolate the
// font gate.
const ROOMY_TEMPLATE_ID = 'plate';

function ss30Option(env) {
  return env.dom.stoneSize.querySelector(`option[value="${getStoneSize('ss30').diameterMm}"]`);
}

// ---------- (a) each of the 4 portfolio fonts at SS30: 3 disabled with tooltip, 1 enabled ----------

for (const fontId of ['anton-regular', 'sacramento-regular', 'dancing-script-regular']) {
  await test(`(a) ${fontId}: SS30 is disabled with an explanatory tooltip naming the font`, () => {
    const env = makeEnv();
    env.setTemplate(ROOMY_TEMPLATE_ID);
    env.setLayer({ type: 'text', font: fontId });
    env.updateStoneSizePrintableCapabilityUI();
    const option = ss30Option(env);
    const family = env.fontManager.getFont(fontId).family;
    assert.equal(option.disabled, true, `${fontId} should have SS30 disabled`);
    assert.match(option.title, /SS30/);
    assert.match(option.title, new RegExp(family));
    assert.match(option.title, /pending a height-calibration fix/);
  });
}

await test('(a) Baloo2Variable: SS30 stays enabled (no unsupportedStoneSizes entry), for direct comparison against the 3 disabled fonts above', () => {
  const env = makeEnv();
  env.setTemplate(ROOMY_TEMPLATE_ID);
  env.setLayer({ type: 'text', font: 'baloo2-variable-regular' });
  env.updateStoneSizePrintableCapabilityUI();
  const option = ss30Option(env);
  assert.equal(option.disabled, false, 'Baloo2Variable cleared SS30 human rating -- must not be disabled by the font gate');
  assert.equal(option.title, '');
});

// ---------- (b) every other size stays unaffected by the font gate ----------

await test('(b) a font-gated font (Anton) leaves SS6/SS10/SS16/SS20 enabled -- only its own unsupportedStoneSizes entries are affected', () => {
  const env = makeEnv();
  env.setTemplate(ROOMY_TEMPLATE_ID);
  env.setLayer({ type: 'text', font: 'anton-regular' });
  env.updateStoneSizePrintableCapabilityUI();
  for (const id of ['ss6', 'ss10', 'ss16', 'ss20']) {
    const size = getStoneSize(id);
    const option = env.dom.stoneSize.querySelector(`option[value="${size.diameterMm}"]`);
    assert.equal(option.disabled, false, `${size.name} must stay enabled for Anton`);
    assert.equal(option.title, '');
  }
});

// ---------- (c) switching fonts re-evaluates the gate correctly ----------

await test('(c) switching from Anton to Baloo2Variable re-enables SS30, and back re-disables it -- live re-evaluation, not a one-time computation', () => {
  const env = makeEnv();
  env.setTemplate(ROOMY_TEMPLATE_ID);
  env.setLayer({ type: 'text', font: 'anton-regular' });
  env.updateStoneSizePrintableCapabilityUI();
  const optionAnton = ss30Option(env);
  assert.equal(optionAnton.disabled, true, 'sanity check: SS30 starts disabled for Anton');

  env.setLayer({ type: 'text', font: 'baloo2-variable-regular' });
  env.updateStoneSizePrintableCapabilityUI();
  const optionBaloo = ss30Option(env);
  assert.equal(optionBaloo.disabled, false, 'switching to Baloo2Variable must re-enable SS30');
  assert.equal(optionBaloo.title, '');
  assert.equal(optionBaloo, optionAnton, 'same option object mutated in place, proving live re-evaluation');

  env.setLayer({ type: 'text', font: 'sacramento-regular' });
  env.updateStoneSizePrintableCapabilityUI();
  assert.equal(ss30Option(env).disabled, true, 'switching to another font with unsupportedStoneSizes must re-disable SS30');
});

// ---------- (d) the font gate and the shape gate combine (either one disables) ----------

await test('(d) a shape whose printable height rules out SS30 keeps it disabled even for Baloo2Variable (shape gate), and the tooltip explains the shape reason', () => {
  const env = makeEnv();
  env.setTemplate('mug'); // FONT-DECISION-001's own fixture: Mug's printable height already rules out SS30
  env.setLayer({ type: 'text', font: 'baloo2-variable-regular' });
  env.updateStoneSizePrintableCapabilityUI();
  const option = ss30Option(env);
  const safe = getSafeAreaRectMm(getObjectTemplate('mug'), env.project.canvas.width, env.project.canvas.height);
  assert.equal(option.disabled, stoneSizeEntirelyExceedsPrintableHeight(getStoneSize('ss30'), safe.heightMm), 'Mug should still disable SS30 for Baloo2Variable via the shape gate alone');
  if (option.disabled) assert.match(option.title, /Mug/, 'shape reason should win the tooltip when the shape itself rules the size out');
});

// ---------- (e) a non-text layer is unaffected by the font gate (mirrors the shape-gate precedent) ----------

await test('(e) a non-text layer leaves every #stoneSize option enabled regardless of the last-selected text layer\'s font', () => {
  const env = makeEnv();
  env.setTemplate(ROOMY_TEMPLATE_ID);
  env.setLayer({ type: 'circle' });
  env.updateStoneSizePrintableCapabilityUI();
  for (const size of listStoneSizes()) {
    const option = env.dom.stoneSize.querySelector(`option[value="${size.diameterMm}"]`);
    assert.equal(option.disabled, false, `${size.name} must stay enabled for a non-text layer`);
    assert.equal(option.title, '');
  }
});

console.log('FONT-PORTFOLIO-001 Stone Size font-gating tests passed.');
