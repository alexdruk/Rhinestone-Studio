// READ-010 — project-wide readability warning at Production Sheet export, plus a fix-to-floor
// affordance on the existing per-layer height warning.
//
// textHeightBelowReadableMinimum() (app.js) has exactly two call sites, both selection-scoped:
// updateTextHeightReadabilityUI() reads selectedLayer(), updateStoneSizeOverlapCapabilityUI() reads
// target.layer. Neither ever asks whether the PROJECT (as opposed to the current selection) holds a
// below-floor text layer, so a project with several such layers, none selected, exported no signal
// at all. This milestone adds textLayersBelowReadableMinimum() (project-wide, reusing the existing
// per-layer predicate verbatim) and wires it into a new Production Sheet validation message, plus a
// fix-to-floor button on the existing per-layer warning. See
// docs/specifications/READ-010-WarnOnlyFloor.md.
//
// Real app.js source is sliced verbatim and executed against stub el()/project, the same
// source-extraction convention tools/test-font-lib-004-height-readability.mjs already uses.

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { listStoneSizes } from '../src/renderer/StoneSizes.js';
import { formatLengthDisplay, unitSuffix, mmToDisplayValue, displayValueToMm } from '../src/units/index.js';
import { FontManager } from '../src/fonts/index.js';
import { strokeNarrowerThanOneStone, INTERIOR_FILL_MODES } from '../src/text/index.js';
import { MIN_HEIGHT_TO_STONE_RATIO } from '../src/geometry/TextAutoFit.js';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const appJs = await readFile(path.join(repoRoot, 'app.js'), 'utf8');
const indexHtml = await readFile(path.join(repoRoot, 'index.html'), 'utf8');
const manifest = JSON.parse(await readFile(path.join(repoRoot, 'assets/fonts/manifest.json'), 'utf8'));
const fontManager = new FontManager(manifest);

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

function matchOne(source, regex, label) {
  const m = source.match(regex);
  if (!m) throw new Error(`app.js no longer contains ${label} (pattern: ${regex})`);
  return m[0];
}

function sliceBalanced(source, startMarker, label) {
  const start = source.indexOf(startMarker);
  assert.ok(start !== -1, `expected to find "${startMarker}" (${label}) in app.js`);
  const braceStart = source.indexOf('{', start);
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

const heightPredicateSrc = sliceBalanced(appJs, 'function textHeightBelowReadableMinimum(layer){', 'textHeightBelowReadableMinimum()');
const projectPredicateSrc = sliceBalanced(appJs, 'function textLayersBelowReadableMinimum(){', 'textLayersBelowReadableMinimum()');
const prodSheetValidationSrc = sliceBalanced(appJs, 'function updateProdSheetReadabilityValidation(){', 'updateProdSheetReadabilityValidation()');
const layerLabelSrc = sliceBalanced(appJs, 'function layerLabel(l){', 'layerLabel()');
const ceilFnSrc = sliceBalanced(appJs, 'function ceilToDisplayPrecisionMm(mm,units,decimals=2){', 'ceilToDisplayPrecisionMm()');
const setLengthFieldSrc = matchOne(appJs, /function setLengthField\(id,mm\)\{[^}]*\}/, 'setLengthField()');
const readLengthFieldSrc = matchOne(appJs, /function readLengthField\(id\)\{[^}]*\}/, 'readLengthField()');

const floorFor = (stoneDiameterMm) => stoneDiameterMm * MIN_HEIGHT_TO_STONE_RATIO;

function makeClassList() {
  const set = new Set();
  return { add: (c) => set.add(c), remove: (c) => set.delete(c), toggle: (c, on) => (on ? set.add(c) : set.delete(c)), contains: (c) => set.has(c) };
}

// --- textLayersBelowReadableMinimum() harness ---

function runProjectSweep(layers, { authoredFontIds = ['rs-block', 'rs-modern'] } = {}) {
  const project = { layers };
  const factory = new Function(
    'project', 'isAuthoredStoneFontId', 'MIN_HEIGHT_TO_STONE_RATIO',
    `${heightPredicateSrc}\n${projectPredicateSrc}\nreturn textLayersBelowReadableMinimum;`
  );
  const fn = factory(project, (id) => authoredFontIds.includes(id), MIN_HEIGHT_TO_STONE_RATIO);
  return fn();
}

const SS6 = listStoneSizes().find((s) => s.id === 'ss6');
const SS16 = listStoneSizes().find((s) => s.id === 'ss16');
const HEIGHT_FONT = 'anton-regular';

await test('1. textLayersBelowReadableMinimum() finds every below-floor visible text layer in a multi-layer project', () => {
  const layers = [
    { id: 'a', type: 'text', text: 'Header', visible: true, font: HEIGHT_FONT, stoneSize: SS16.diameterMm, height: 30 },
    { id: 'b', type: 'text', text: 'Subtitle', visible: true, font: HEIGHT_FONT, stoneSize: SS16.diameterMm, height: floorFor(SS16.diameterMm) + 10 },
    { id: 'c', type: 'text', text: 'Footer', visible: true, font: HEIGHT_FONT, stoneSize: SS6.diameterMm, height: 20 },
    { id: 'd', type: 'circle', visible: true, r: 10 }
  ];
  const hits = runProjectSweep(layers);
  assert.equal(hits.length, 2, 'expected exactly the two below-floor text layers');
  const ids = hits.map((h) => h.layer.id).sort();
  assert.deepEqual(ids, ['a', 'c']);
  for (const hit of hits) {
    assert.ok(Number.isFinite(hit.heightMm) && Number.isFinite(hit.minHeightMm) && Number.isFinite(hit.stoneSizeMm), 'each hit carries the predicate fields');
  }
});

await test('2. finds none when every visible text layer is at or above floor', () => {
  const layers = [
    { id: 'a', type: 'text', text: 'Header', visible: true, font: HEIGHT_FONT, stoneSize: SS16.diameterMm, height: floorFor(SS16.diameterMm) },
    { id: 'b', type: 'text', text: 'Subtitle', visible: true, font: HEIGHT_FONT, stoneSize: SS6.diameterMm, height: floorFor(SS6.diameterMm) + 20 }
  ];
  assert.deepEqual(runProjectSweep(layers), []);
});

await test('3. hidden below-floor layers are excluded', () => {
  const layers = [
    { id: 'a', type: 'text', text: 'Hidden', visible: false, font: HEIGHT_FONT, stoneSize: SS16.diameterMm, height: 20 },
    { id: 'b', type: 'text', text: 'Visible', visible: true, font: HEIGHT_FONT, stoneSize: SS16.diameterMm, height: floorFor(SS16.diameterMm) + 5 }
  ];
  assert.deepEqual(runProjectSweep(layers), [], 'a hidden below-floor layer must not surface, and no visible layer here is below floor');

  const layersMixed = [
    { id: 'a', type: 'text', text: 'Hidden', visible: false, font: HEIGHT_FONT, stoneSize: SS16.diameterMm, height: 20 },
    { id: 'b', type: 'text', text: 'AlsoBelow', visible: true, font: HEIGHT_FONT, stoneSize: SS16.diameterMm, height: 20 }
  ];
  const hits = runProjectSweep(layersMixed);
  assert.equal(hits.length, 1, 'only the visible below-floor layer should surface');
  assert.equal(hits[0].layer.id, 'b');
});

await test('4. authored Production Font layers are excluded (inherited from the per-layer predicate)', () => {
  const layers = [
    { id: 'a', type: 'text', text: 'RS Block', visible: true, font: 'rs-block', stoneSize: SS6.diameterMm, height: 15 },
    { id: 'b', type: 'text', text: 'OpenType', visible: true, font: HEIGHT_FONT, stoneSize: SS6.diameterMm, height: 15 }
  ];
  const hits = runProjectSweep(layers);
  assert.equal(hits.length, 1, 'only the non-authored below-floor layer should surface');
  assert.equal(hits[0].layer.id, 'b');
});

// --- updateProdSheetReadabilityValidation() harness ---

function runProdSheetValidation(layers, { units = 'mm', authoredFontIds = ['rs-block', 'rs-modern'] } = {}) {
  const validation = { textContent: '', classList: makeClassList() };
  const el = (id) => (id === 'prodSheetValidation' ? validation : { textContent: '', classList: makeClassList() });
  const project = { layers, units };
  const factory = new Function(
    'el', 'project', 'isAuthoredStoneFontId', 'MIN_HEIGHT_TO_STONE_RATIO', 'formatLengthDisplay', 'unitSuffix',
    `${heightPredicateSrc}\n${projectPredicateSrc}\n${layerLabelSrc}\n${prodSheetValidationSrc}\nreturn updateProdSheetReadabilityValidation;`
  );
  const fn = factory(el, project, (id) => authoredFontIds.includes(id), MIN_HEIGHT_TO_STONE_RATIO, formatLengthDisplay, unitSuffix);
  fn();
  return validation;
}

await test('5. Production Sheet validation itemizes every below-floor visible text layer by name', () => {
  const layers = [
    { id: 'a', type: 'text', text: 'Header', visible: true, font: HEIGHT_FONT, stoneSize: SS16.diameterMm, height: 30 },
    { id: 'b', type: 'text', text: 'Footer', visible: true, font: HEIGHT_FONT, stoneSize: SS6.diameterMm, height: 20 }
  ];
  const v = runProdSheetValidation(layers);
  assert.ok(v.classList.contains('visible'));
  assert.match(v.textContent, /Header/);
  assert.match(v.textContent, /Footer/);
  assert.match(v.textContent, /2 text layers/);
});

await test('6. Production Sheet validation is silent when no visible layer is below floor', () => {
  const layers = [{ id: 'a', type: 'text', text: 'Header', visible: true, font: HEIGHT_FONT, stoneSize: SS16.diameterMm, height: floorFor(SS16.diameterMm) }];
  const v = runProdSheetValidation(layers);
  assert.equal(v.classList.contains('visible'), false);
  assert.equal(v.textContent, '');
});

// --- ceilToDisplayPrecisionMm() round-trip harness ---

function makeLengthFieldHarness(unitsInitial) {
  const project = { units: unitsInitial };
  const elements = {};
  const el = (id) => (elements[id] ??= { value: '', dataset: {} });
  const factory = new Function(
    'el', 'project', 'formatLengthDisplay', 'displayValueToMm', 'mmToDisplayValue',
    `${setLengthFieldSrc}\n${readLengthFieldSrc}\n${ceilFnSrc}\nreturn{setLengthField,readLengthField,ceilToDisplayPrecisionMm};`
  );
  const { setLengthField, readLengthField, ceilToDisplayPrecisionMm } = factory(el, project, formatLengthDisplay, displayValueToMm, mmToDisplayValue);
  return { project, setLengthField, readLengthField, ceilToDisplayPrecisionMm };
}

await test('7. the fix-to-floor value round-trips through setLengthField -> readLengthField at or above the floor (mm units)', () => {
  const { project, setLengthField, readLengthField, ceilToDisplayPrecisionMm } = makeLengthFieldHarness('mm');
  // A floor value with more precision than the 2-decimal display can represent exactly, chosen so a
  // naive write-then-round-trip would round DOWN and land back below the floor.
  for (const minHeightMm of [44.803, 32.001, 102.4, 2.8 * MIN_HEIGHT_TO_STONE_RATIO]) {
    setLengthField('height', ceilToDisplayPrecisionMm(minHeightMm, project.units));
    const roundTripped = readLengthField('height');
    assert.ok(roundTripped >= minHeightMm, `expected round-tripped ${roundTripped} >= floor ${minHeightMm} (mm)`);
  }
});

await test('8. the fix-to-floor value round-trips at or above the floor in inch units too', () => {
  const { project, setLengthField, readLengthField, ceilToDisplayPrecisionMm } = makeLengthFieldHarness('in');
  for (const minHeightMm of [44.803, 32.001, 102.4, 2.8 * MIN_HEIGHT_TO_STONE_RATIO, 6.4 * MIN_HEIGHT_TO_STONE_RATIO]) {
    setLengthField('height', ceilToDisplayPrecisionMm(minHeightMm, project.units));
    const roundTripped = readLengthField('height');
    assert.ok(roundTripped >= minHeightMm, `expected round-tripped ${roundTripped} >= floor ${minHeightMm} (in), got ${roundTripped}`);
  }
});

await test('9. a naive (non-ceiled) write can round-trip BELOW the floor -- proving ceilToDisplayPrecisionMm is load-bearing, not redundant', () => {
  const { project, setLengthField, readLengthField } = makeLengthFieldHarness('mm');
  const minHeightMm = 44.803; // toFixed(2) rounds this DOWN to "44.80"
  setLengthField('height', minHeightMm); // naive write, no ceiling
  const roundTripped = readLengthField('height');
  assert.ok(roundTripped < minHeightMm, `test setup: expected the naive round trip (${roundTripped}) to land below the floor (${minHeightMm})`);
});

// --- fix-to-floor hint visibility vs. READ-003 precedence ---

const textModeMapSrc = matchOne(appJs, /const TEXT_MODE_TO_ENGINE_MODE=\{[^}]*\};/, 'TEXT_MODE_TO_ENGINE_MODE');
const resolveTextFillModeSrc = matchOne(appJs, /function resolveTextFillMode\(textMode\)\{[^}]*\}/, 'resolveTextFillMode()');
const strokePredicateSrc = sliceBalanced(appJs, 'function textStrokeNarrowerThanOneStone(layer){', 'textStrokeNarrowerThanOneStone()');
const updateWarningFnSrc = sliceBalanced(appJs, 'function updateTextHeightReadabilityUI(){', 'updateTextHeightReadabilityUI()');

assert.deepEqual([...INTERIOR_FILL_MODES].sort(), ['contour', 'fill', 'radial', 'staggered'],
  'INTERIOR_FILL_MODES must be exactly {fill, staggered, radial, contour}');

function runHeightWarning(layer, { units = 'mm', authoredFontIds = ['rs-block', 'rs-modern'] } = {}) {
  const warning = { textContent: '', classList: makeClassList() };
  const fixHint = { style: { display: '' } };
  const fixBtn = { textContent: '' };
  const el = (id) => {
    if (id === 'heightBelowReadableWarning') return warning;
    if (id === 'heightFixToFloorHint') return fixHint;
    if (id === 'heightFixToFloorBtn') return fixBtn;
    return { textContent: '', classList: makeClassList(), style: {} };
  };
  const factory = new Function(
    'el', 'selectedLayer', 'isAuthoredStoneFontId', 'isFontKnown', 'fontManager', 'MIN_HEIGHT_TO_STONE_RATIO',
    'formatLengthDisplay', 'unitSuffix', 'project', 'strokeNarrowerThanOneStone',
    `${textModeMapSrc}\n${resolveTextFillModeSrc}\n${strokePredicateSrc}\n${heightPredicateSrc}\n${updateWarningFnSrc}\nreturn updateTextHeightReadabilityUI;`
  );
  const fn = factory(
    el, () => layer, (id) => authoredFontIds.includes(id), (id) => fontManager.hasFont(id), fontManager, MIN_HEIGHT_TO_STONE_RATIO,
    formatLengthDisplay, unitSuffix, { units }, strokeNarrowerThanOneStone
  );
  fn();
  return { warning, fixHint, fixBtn };
}

await test('10. the fix-to-floor hint shows, labeled with the target height, when the FONT-LIB-004 height message is the one on screen', () => {
  const layer = { type: 'text', font: HEIGHT_FONT, stoneSize: SS16.diameterMm, height: 50 };
  const ratio = fontManager.getFont(layer.font).stemWidthRatio;
  assert.ok(ratio * layer.height >= layer.stoneSize, 'test setup: stroke must stay wider than one stone so only the height gate fires');
  assert.ok(layer.height < floorFor(SS16.diameterMm), 'test setup: height must still be below the ratio floor');
  const { warning, fixHint, fixBtn } = runHeightWarning(layer);
  assert.ok(warning.classList.contains('visible'));
  assert.equal(fixHint.style.display, 'block');
  assert.match(fixBtn.textContent, new RegExp(String(floorFor(SS16.diameterMm))), 'the button label states the target floor height');
});

await test('11. the fix-to-floor hint is hidden when READ-003\'s stroke message takes precedence', () => {
  // Great Vibes fill @ 50mm on SS16: stem narrower than one stone AND below the height floor --
  // READ-003 must win the shared element, and the fix-to-floor hint (height-only) must stay hidden.
  const layer = { type: 'text', font: 'great-vibes-regular', textMode: 'fill', stoneSize: SS16.diameterMm, height: 50 };
  const ratio = fontManager.getFont(layer.font).stemWidthRatio;
  assert.ok(ratio * layer.height < layer.stoneSize, 'test setup: stroke must be narrower than the stone');
  assert.ok(layer.height < floorFor(SS16.diameterMm), 'test setup: height must also be below the ratio floor');
  const { warning, fixHint } = runHeightWarning(layer);
  assert.ok(warning.classList.contains('visible'));
  assert.match(warning.textContent, /narrower than one|overhang/);
  assert.equal(fixHint.style.display, 'none', 'the fix-to-floor hint must not show for the stroke message');
});

await test('12. the fix-to-floor hint is hidden when neither message shows', () => {
  const layer = { type: 'text', font: HEIGHT_FONT, stoneSize: SS16.diameterMm, height: floorFor(SS16.diameterMm) + 20 };
  const { warning, fixHint } = runHeightWarning(layer);
  assert.equal(warning.classList.contains('visible'), false);
  assert.equal(fixHint.style.display, 'none');
});

await test('13. index.html declares the fix-to-floor hint/button and #prodSheetValidation exists for the Production Sheet lightbox', () => {
  assert.match(indexHtml, /id="heightFixToFloorHint"/);
  assert.match(indexHtml, /id="heightFixToFloorBtn"/);
  assert.match(indexHtml, /id="prodSheetValidation"/);
});

await test('14. the three Production Sheet export handlers and the lightbox onOpen all call updateProdSheetReadabilityValidation()', () => {
  assert.match(appJs, /el\('exportProdSheetSVG'\)\.onclick=\(\)=>\{updateProdSheetReadabilityValidation\(\);/);
  assert.match(appJs, /el\('exportProdSheetPDF'\)\.onclick=\(\)=>\{updateProdSheetReadabilityValidation\(\);/);
  assert.match(appJs, /el\('exportProdSheetPNG'\)\.onclick=async\(\)=>\{updateProdSheetReadabilityValidation\(\);/);
  assert.match(appJs, /prodSheet:new Lightbox\('lightboxProdSheet',\{primary:true,onOpen\(\)\{updateProdSheetReadabilityValidation\(\)\}\}\)/);
});

console.log('READ-010 project-wide readability warning + fix-to-floor tests passed.');
