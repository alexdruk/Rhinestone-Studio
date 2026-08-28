// FONT-LIB-004 — text-height readability warning.
//
// An audit of every enabled OpenType font through FONT-CERT-001/002's real analysis pipeline
// (tools/font-certification/audit-manifest-readability.mjs) found zero font/stone-size combinations
// that fail at each size's own validated default height, but a broad, font-INDEPENDENT collapse as
// soon as height drops below that size's supportedHeightRangeMm minimum. So the readability gate
// this milestone adds is a height check, not per-font `unsupportedStoneSizes` entries -- see
// docs/specifications/FONT-LIB-004-ReadabilityGating.md.
//
// updateTextHeightReadabilityUI() is sliced verbatim from app.js and executed against stub el()/
// selectedLayer() plus the REAL StoneSizes catalog and units module -- the same source-extraction
// convention tools/test-font-decision-001-stone-size-ux.mjs and
// tools/test-typography-font-library.mjs already use for app.js's browser-entry-point functions.

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { listStoneSizes, findStoneSizeByDiameterMm } from '../src/renderer/StoneSizes.js';
import { formatLengthDisplay, unitSuffix } from '../src/units/index.js';

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

// The warning function delegates its actual test to this shared predicate (shared with the
// crowding hint's FONT-LIB-004 precedence rule) -- slice both so the harness runs the real code.
const heightPredicateSrc = sliceBalanced(appJs, 'function textHeightBelowReadableMinimum(layer){', 'textHeightBelowReadableMinimum()');
const updateFnSrc = sliceBalanced(appJs, 'function updateTextHeightReadabilityUI(){', 'updateTextHeightReadabilityUI()');

function makeClassList() {
  const set = new Set();
  return { add: (c) => set.add(c), remove: (c) => set.delete(c), toggle: (c, on) => (on ? set.add(c) : set.delete(c)), contains: (c) => set.has(c) };
}

function run(layer, { units = 'mm', authoredFontIds = ['rs-block', 'rs-modern'] } = {}) {
  const warning = { textContent: '', classList: makeClassList() };
  const el = (id) => (id === 'heightBelowReadableWarning' ? warning : { textContent: '', classList: makeClassList(), style: {} });
  const factory = new Function(
    'el', 'selectedLayer', 'isAuthoredStoneFontId', 'findStoneSizeByDiameterMm',
    'formatLengthDisplay', 'unitSuffix', 'project',
    `${heightPredicateSrc}\n${updateFnSrc}\nreturn updateTextHeightReadabilityUI;`
  );
  const fn = factory(
    el, () => layer, (id) => authoredFontIds.includes(id), findStoneSizeByDiameterMm,
    formatLengthDisplay, unitSuffix, { units }
  );
  fn();
  return warning;
}

const SS6 = listStoneSizes().find((s) => s.id === 'ss6');
const SS30 = listStoneSizes().find((s) => s.id === 'ss30');

await test('1. a text layer whose height is below its stone size\'s validated minimum gets a warning naming both the stone size and the tested minimum', () => {
  const w = run({ type: 'text', font: 'great-vibes-regular', stoneSize: SS6.diameterMm, height: 15 });
  assert.ok(w.classList.contains('visible'), 'expected the warning to be visible');
  assert.match(w.textContent, new RegExp(SS6.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), 'expected the stone size name');
  assert.match(w.textContent, new RegExp(String(SS6.supportedHeightRangeMm[0])), 'expected the validated minimum height');
});

await test('2. a text layer at or above the validated minimum shows no warning (boundary is inclusive)', () => {
  const atMin = run({ type: 'text', font: 'great-vibes-regular', stoneSize: SS6.diameterMm, height: SS6.supportedHeightRangeMm[0] });
  assert.equal(atMin.classList.contains('visible'), false, 'exactly at the minimum must NOT warn');
  assert.equal(atMin.textContent, '');
  const above = run({ type: 'text', font: 'great-vibes-regular', stoneSize: SS6.diameterMm, height: 43 });
  assert.equal(above.classList.contains('visible'), false, 'the app default height must never warn');
});

await test('3. one mm below the minimum does warn -- the threshold is the validated minimum itself, not an approximation of it', () => {
  const w = run({ type: 'text', font: 'great-vibes-regular', stoneSize: SS6.diameterMm, height: SS6.supportedHeightRangeMm[0] - 1 });
  assert.ok(w.classList.contains('visible'));
});

await test('4. the threshold is per stone size, not global: a height that is fine at SS6 still warns at SS30', () => {
  const height = SS6.supportedHeightRangeMm[0]; // fine for SS6
  const okAtSs6 = run({ type: 'text', font: 'great-vibes-regular', stoneSize: SS6.diameterMm, height });
  assert.equal(okAtSs6.classList.contains('visible'), false);
  const warnsAtSs30 = run({ type: 'text', font: 'great-vibes-regular', stoneSize: SS30.diameterMm, height });
  assert.ok(warnsAtSs30.classList.contains('visible'), `expected ${height}mm to warn at ${SS30.name} (min ${SS30.supportedHeightRangeMm[0]}mm)`);
});

await test('5. the warning is font-INDEPENDENT -- the audit found readability is governed by height-to-stone ratio, so a bold sans warns exactly like a thin script at the same height/size', () => {
  const thin = run({ type: 'text', font: 'great-vibes-regular', stoneSize: SS6.diameterMm, height: 15 });
  const bold = run({ type: 'text', font: 'poppins-bold', stoneSize: SS6.diameterMm, height: 15 });
  assert.equal(thin.classList.contains('visible'), bold.classList.contains('visible'));
  assert.equal(thin.textContent, bold.textContent, 'the message must not vary by font');
});

await test('6. authored Production Fonts (RS Block / RS Modern) are exempt -- supportedHeightRangeMm is an OpenType-sampling concept and they carry their own baked-in stone pitch', () => {
  for (const fontId of ['rs-block', 'rs-modern']) {
    const w = run({ type: 'text', font: fontId, stoneSize: SS6.diameterMm, height: 15 });
    assert.equal(w.classList.contains('visible'), false, `${fontId} must never trigger the height warning`);
  }
});

await test('7. non-text layers and no selection never warn', () => {
  for (const type of ['circle', 'rect', 'path', 'svg', 'image']) {
    const w = run({ type, stoneSize: SS6.diameterMm, height: 15 });
    assert.equal(w.classList.contains('visible'), false, `${type} must not warn`);
  }
  assert.equal(run(null).classList.contains('visible'), false, 'no selection must not warn');
});

await test('8. a non-catalog (custom/legacy) stoneSize resolves to no size record and is left alone rather than throwing', () => {
  const w = run({ type: 'text', font: 'great-vibes-regular', stoneSize: 3.33, height: 5 });
  assert.equal(w.classList.contains('visible'), false);
});

await test('9. the message respects the project\'s unit setting (inches, not raw mm, when units are imperial)', () => {
  const w = run({ type: 'text', font: 'great-vibes-regular', stoneSize: SS6.diameterMm, height: 15 }, { units: 'in' });
  assert.match(w.textContent, /in\b/, 'expected an inch suffix when the project is in imperial units');
  assert.ok(!/\b35 mm\b/.test(w.textContent), 'must not print the raw mm figure when units are imperial');
});

await test('10. index.html declares #heightBelowReadableWarning next to #height, and app.js calls updateTextHeightReadabilityUI() from updateEditingUI() so it stays live', () => {
  assert.match(indexHtml, /id="heightBelowReadableWarning"/);
  // Deliberately NOT asserted as adjacent to updateTextFontCapabilityUI(): RS-2012's own test 8
  // requires updateTextFontCapabilityUI()/updateMixedSizeCapabilityUI() to stay adjacent, so this
  // call sits at the end of updateEditingUI() instead. Assert membership, not position.
  const updateEditingUiSrc = sliceBalanced(appJs, 'function updateEditingUI(){', 'updateEditingUI()');
  assert.match(updateEditingUiSrc, /updateTextHeightReadabilityUI\(\);/,
    'expected updateEditingUI() to call updateTextHeightReadabilityUI() so the warning tracks every live edit');
  assert.match(appJs, /updateTextFontCapabilityUI\(\);\s*\n\s*updateMixedSizeCapabilityUI\(\);/,
    'RS-2012 test 8 invariant: this milestone must not have split that adjacent pair');
});

console.log('FONT-LIB-004 text-height readability warning tests passed.');
