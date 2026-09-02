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
import { FontManager } from '../src/fonts/index.js';
// READ-004 Part B moved the stroke-narrower-than-one-stone arithmetic and its fill-mode gate out of
// app.js into this shared module. The sliced textStrokeNarrowerThanOneStone() calls the real
// predicate, so it is injected into the factory like every other app.js dependency.
import { strokeNarrowerThanOneStone, INTERIOR_FILL_MODES } from '../src/text/index.js';

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

// A future app.js refactor that removes one of these patterns should fail with a named error
// ("app.js no longer contains X"), not a null dereference on `.match(...)[0]`.
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

// updateTextHeightReadabilityUI() now composes TWO predicates behind the one #heightBelowReadableWarning
// element, strongest first: READ-003 textStrokeNarrowerThanOneStone() then FONT-LIB-004
// textHeightBelowReadableMinimum(). Slice all three so the harness runs the real precedence, not a
// stand-in. The stroke predicate reads the module-level fontManager + isFontKnown() (injected below)
// and, since READ-003 was scoped to interior-filling modes, resolveTextFillMode() +
// TEXT_MODE_TO_ENGINE_MODE + the READ_003_INTERIOR_FILL_MODES set -- sliced verbatim so the harness
// exercises the real fill-style gate, not a stub.
const textModeMapSrc = matchOne(appJs, /const TEXT_MODE_TO_ENGINE_MODE=\{[^}]*\};/, 'TEXT_MODE_TO_ENGINE_MODE');
const resolveTextFillModeSrc = matchOne(appJs, /function resolveTextFillMode\(textMode\)\{[^}]*\}/, 'resolveTextFillMode()');
const strokePredicateSrc = sliceBalanced(appJs, 'function textStrokeNarrowerThanOneStone(layer){', 'textStrokeNarrowerThanOneStone()');

// READ-004 Part B: the fill-mode gate that used to live in app.js as READ_003_INTERIOR_FILL_MODES
// now lives in src/text/StrokeWidthGate.js. Pin the policy where it moved to -- this is what the
// deleted `interiorFillModesSrc` slice was implicitly guarding.
assert.deepEqual([...INTERIOR_FILL_MODES].sort(), ['contour', 'fill', 'radial', 'staggered'],
  'INTERIOR_FILL_MODES must be exactly {fill, staggered, radial, contour}');
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
    'el', 'selectedLayer', 'isAuthoredStoneFontId', 'isFontKnown', 'fontManager', 'findStoneSizeByDiameterMm',
    'formatLengthDisplay', 'unitSuffix', 'project', 'strokeNarrowerThanOneStone',
    `${textModeMapSrc}\n${resolveTextFillModeSrc}\n${strokePredicateSrc}\n${heightPredicateSrc}\n${updateFnSrc}\nreturn updateTextHeightReadabilityUI;`
  );
  const fn = factory(
    el, () => layer, (id) => authoredFontIds.includes(id), (id) => fontManager.hasFont(id), fontManager, findStoneSizeByDiameterMm,
    formatLengthDisplay, unitSuffix, { units }, strokeNarrowerThanOneStone
  );
  fn();
  return warning;
}

const SS6 = listStoneSizes().find((s) => s.id === 'ss6');
const SS16 = listStoneSizes().find((s) => s.id === 'ss16');
const SS20 = listStoneSizes().find((s) => s.id === 'ss20');
const SS30 = listStoneSizes().find((s) => s.id === 'ss30');

// FONT-LIB-004's own tests need the READ-003 stroke check to stay INACTIVE so they isolate the
// height dimension. anton-regular is the thickest-stemmed bundled font (stemWidthRatio ~0.12), so at
// SS16/SS20 and the heights used below its stroke is comfortably wider than one stone -- only the
// height gate can fire. `assertStrokeInactive()` makes that a checked precondition, not an assumption.
const HEIGHT_FONT = 'anton-regular';
function assertStrokeInactive(layer) {
  const ratio = fontManager.getFont(layer.font).stemWidthRatio;
  assert.ok(
    ratio * layer.height >= layer.stoneSize,
    `test setup: ${layer.font} stroke ${(ratio * layer.height).toFixed(2)}mm must be >= stone ${layer.stoneSize}mm for a pure height-gate test`
  );
}

// Tests 1-9 isolate the FONT-LIB-004 height gate. They use anton-regular (thickest stem) at
// SS16/SS20 so the READ-003 stroke gate (tested separately, 11-13) stays inactive -- verified by
// assertStrokeInactive() on every fixture.

await test('1. a text layer whose height is below its stone size\'s validated minimum gets a warning naming both the stone size and the tested minimum', () => {
  const layer = { type: 'text', font: HEIGHT_FONT, stoneSize: SS16.diameterMm, height: 50 };
  assertStrokeInactive(layer);
  const w = run(layer);
  assert.ok(w.classList.contains('visible'), 'expected the warning to be visible');
  assert.match(w.textContent, new RegExp(SS16.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), 'expected the stone size name');
  assert.match(w.textContent, new RegExp(String(SS16.supportedHeightRangeMm[0])), 'expected the validated minimum height');
});

await test('2. a text layer at or above the validated minimum shows no warning (boundary is inclusive)', () => {
  const atMin = run({ type: 'text', font: HEIGHT_FONT, stoneSize: SS16.diameterMm, height: SS16.supportedHeightRangeMm[0] });
  assert.equal(atMin.classList.contains('visible'), false, 'exactly at the minimum must NOT warn');
  assert.equal(atMin.textContent, '');
  const above = run({ type: 'text', font: HEIGHT_FONT, stoneSize: SS16.diameterMm, height: 78 });
  assert.equal(above.classList.contains('visible'), false, 'the app default height must never warn');
});

await test('3. one mm below the minimum does warn -- the threshold is the validated minimum itself, not an approximation of it', () => {
  const layer = { type: 'text', font: HEIGHT_FONT, stoneSize: SS16.diameterMm, height: SS16.supportedHeightRangeMm[0] - 1 };
  assertStrokeInactive(layer);
  assert.ok(run(layer).classList.contains('visible'));
});

await test('4. the threshold is per stone size, not global: a height that is fine at SS16 still warns at SS20', () => {
  const height = SS16.supportedHeightRangeMm[0] + 1; // fine for SS16
  const okAtSs16 = run({ type: 'text', font: HEIGHT_FONT, stoneSize: SS16.diameterMm, height });
  assert.equal(okAtSs16.classList.contains('visible'), false);
  const layerSs20 = { type: 'text', font: HEIGHT_FONT, stoneSize: SS20.diameterMm, height };
  assertStrokeInactive(layerSs20);
  const warnsAtSs20 = run(layerSs20);
  assert.ok(warnsAtSs20.classList.contains('visible'), `expected ${height}mm to warn at ${SS20.name} (min ${SS20.supportedHeightRangeMm[0]}mm)`);
});

await test('5. the height warning is font-INDEPENDENT -- readability there is governed by height-to-stone ratio, so two different fonts warn with an identical message at the same height/size', () => {
  const a = { type: 'text', font: 'anton-regular', stoneSize: SS16.diameterMm, height: 50 };
  const b = { type: 'text', font: 'poppins-bold', stoneSize: SS16.diameterMm, height: 50 };
  assertStrokeInactive(a);
  assertStrokeInactive(b);
  const wa = run(a);
  const wb = run(b);
  assert.equal(wa.classList.contains('visible'), wb.classList.contains('visible'));
  assert.equal(wa.textContent, wb.textContent, 'the height message must not vary by font');
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
  // height 40 keeps anton's stroke wider than the 3.33mm custom stone too, so neither gate fires.
  const w = run({ type: 'text', font: HEIGHT_FONT, stoneSize: 3.33, height: 40 });
  assert.equal(w.classList.contains('visible'), false);
});

await test('9. the height message respects the project\'s unit setting (inches, not raw mm, when units are imperial)', () => {
  const layer = { type: 'text', font: HEIGHT_FONT, stoneSize: SS16.diameterMm, height: 50 };
  assertStrokeInactive(layer);
  const w = run(layer, { units: 'in' });
  assert.match(w.textContent, /in\b/, 'expected an inch suffix when the project is in imperial units');
  assert.ok(!new RegExp(`\\b${SS16.supportedHeightRangeMm[0]} mm\\b`).test(w.textContent), 'must not print the raw mm figure when units are imperial');
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

// --- READ-003 precedence: one shared #heightBelowReadableWarning element, strongest signal wins ---
//   1. READ-003 stroke-narrower-than-one-stone   2. FONT-LIB-004 height-below-validated-minimum

const READ003_MARKERS = [/narrower than one/, /overhang/];
const FONTLIB004_MARKER = /tested minimum for this stone size/;

// The READ-003 stroke gate only applies to the interior-filling fill styles (Grid/Staggered/Radial/
// Contour), never Outline -- tracing a hairline letterform as one bead line is the canonical
// rhinestone result, not a defect. Fixtures that mean to exercise the gate set an interior
// `textMode`; fixtures that mean to prove Outline is exempt set `textMode: 'stroke'`.

await test('11. a fill-mode layer that is BOTH stroke-impossible and below the height minimum shows only the READ-003 message', () => {
  // Great Vibes fill @ 50mm on an SS16 (4mm) stone: stem ~1.8mm < 4mm (stroke-impossible) AND 50 < 65mm.
  const layer = { type: 'text', font: 'great-vibes-regular', textMode: 'fill', stoneSize: SS16.diameterMm, height: 50 };
  const ratio = fontManager.getFont(layer.font).stemWidthRatio;
  assert.ok(ratio * layer.height < layer.stoneSize, 'test setup: stroke must be narrower than the stone');
  assert.ok(layer.height < SS16.supportedHeightRangeMm[0], 'test setup: height must also be below the validated minimum');
  const w = run(layer);
  assert.ok(w.classList.contains('visible'));
  assert.match(w.textContent, /Great Vibes/, 'the READ-003 message names the font');
  for (const marker of READ003_MARKERS) assert.match(w.textContent, marker);
  assert.doesNotMatch(w.textContent, FONTLIB004_MARKER, 'the weaker FONT-LIB-004 height message must not show when the stroke is impossible');
});

await test('12. a fill-mode layer that is ONLY below the height minimum (stroke wider than one stone) still shows the FONT-LIB-004 message', () => {
  const layer = { type: 'text', font: HEIGHT_FONT, textMode: 'fill', stoneSize: SS16.diameterMm, height: 50 };
  assertStrokeInactive(layer);
  const w = run(layer);
  assert.ok(w.classList.contains('visible'));
  assert.match(w.textContent, FONTLIB004_MARKER);
  for (const marker of READ003_MARKERS) assert.doesNotMatch(w.textContent, marker);
});

await test('13. a radial-fill layer that is stroke-impossible at an OTHERWISE-fine height still shows the READ-003 message', () => {
  // Great Vibes radial @ 70mm on SS16: 70 >= 65mm (height gate satisfied) but stem ~2.5mm < 4mm stone.
  const layer = { type: 'text', font: 'great-vibes-regular', textMode: 'radial', stoneSize: SS16.diameterMm, height: 70 };
  assert.ok(layer.height >= SS16.supportedHeightRangeMm[0], 'test setup: height must be inside the validated range');
  const w = run(layer);
  assert.ok(w.classList.contains('visible'));
  for (const marker of READ003_MARKERS) assert.match(w.textContent, marker);
  assert.match(w.textContent, new RegExp(String(SS16.diameterMm)), 'the READ-003 message names the offending stone diameter');
});

await test('14. authored Production Fonts are exempt from the READ-003 stroke gate too (no stemWidthRatio, no vector outline)', () => {
  for (const fontId of ['rs-block', 'rs-modern']) {
    const w = run({ type: 'text', font: fontId, textMode: 'fill', stoneSize: SS16.diameterMm, height: 12 });
    assert.equal(w.classList.contains('visible'), false, `${fontId} must never trigger the stroke warning`);
  }
});

await test('15. a text layer on a font with no stemWidthRatio (legacy/unknown id) never triggers the READ-003 gate', () => {
  const w = run({ type: 'text', font: 'some-unknown-legacy-font', textMode: 'fill', stoneSize: SS16.diameterMm, height: 50 });
  // unknown id -> no stemWidthRatio -> stroke gate null. FONT-LIB-004 does not read the font, so it
  // can still fire; what must NOT happen is a throw or a READ-003 message.
  for (const marker of READ003_MARKERS) assert.doesNotMatch(w.textContent, marker);
});

// --- READ-003 fill-mode scoping (the follow-up fix) ---

await test('16. Outline mode never triggers the READ-003 gate, even with a stem well under one stone', () => {
  // Great Vibes outline @ 70mm on SS16: stem ~2.5mm < 4mm, height 70 >= 65mm -> element fully silent.
  const layer = { type: 'text', font: 'great-vibes-regular', textMode: 'stroke', stoneSize: SS16.diameterMm, height: 70 };
  const ratio = fontManager.getFont(layer.font).stemWidthRatio;
  assert.ok(ratio * layer.height < layer.stoneSize, 'test setup: stem must be narrower than the stone');
  assert.ok(layer.height >= SS16.supportedHeightRangeMm[0], 'test setup: height must be inside the validated range');
  const w = run(layer);
  assert.equal(w.classList.contains('visible'), false, 'Outline mode traces the letterform as a bead line -- not an impossibility');
  assert.equal(w.textContent, '');
  // absent textMode resolves to Outline via resolveTextFillMode()'s fallback -> also silent
  const noMode = run({ type: 'text', font: 'great-vibes-regular', stoneSize: SS16.diameterMm, height: 70 });
  assert.equal(noMode.classList.contains('visible'), false, 'an absent/unrecognised textMode is treated as Outline and stays silent');
});

await test('17. false-positive regression guard: Great Vibes Outline @ 42.5mm / SS6 is silent (product-owner-confirmed good)', () => {
  const layer = { type: 'text', font: 'great-vibes-regular', textMode: 'stroke', stoneSize: SS6.diameterMm, height: 42.5 };
  const stemMm = fontManager.getFont(layer.font).stemWidthRatio * layer.height;
  assert.ok(stemMm < SS6.diameterMm, `test setup: stem ${stemMm.toFixed(2)}mm must be under the ${SS6.diameterMm}mm stone`);
  assert.ok(layer.height >= SS6.supportedHeightRangeMm[0], 'test setup: height is at/above SS6 min, so FONT-LIB-004 is not in play either');
  const w = run(layer);
  assert.equal(w.classList.contains('visible'), false, 'this case was rated good in Outline mode -- no warning at all');
  assert.equal(w.textContent, '');
});

await test('18. false-positive regression guard + precedence: Dancing Script Outline @ 34.3mm / SS6 shows the FONT-LIB-004 height message, never the READ-003 one', () => {
  const layer = { type: 'text', font: 'dancing-script-regular', textMode: 'stroke', stoneSize: SS6.diameterMm, height: 34.3 };
  const stemMm = fontManager.getFont(layer.font).stemWidthRatio * layer.height;
  assert.ok(stemMm < SS6.diameterMm, `test setup: stem ${stemMm.toFixed(2)}mm must be under the ${SS6.diameterMm}mm stone (would fire pre-fix)`);
  assert.ok(layer.height < SS6.supportedHeightRangeMm[0], 'test setup: 34.3mm is below SS6\'s 35mm validated minimum');
  const w = run(layer);
  assert.ok(w.classList.contains('visible'), 'FONT-LIB-004 still owns the element for a below-minimum height');
  assert.match(w.textContent, FONTLIB004_MARKER, 'the weaker height signal is NOT suppressed just because the stroke gate went silent');
  for (const marker of READ003_MARKERS) assert.doesNotMatch(w.textContent, marker, 'the READ-003 stroke message must not appear for an Outline layer');
});

await test('19. true-positive cases still fire: Cinzel Radial @ 56mm / SS16 and Caveat Grid Fill @ 55mm / SS16', () => {
  for (const [font, textMode, height, family] of [
    ['cinzel-regular', 'radial', 56, /Cinzel/],
    ['caveat-regular', 'fill', 55, /Caveat/]
  ]) {
    const layer = { type: 'text', font, textMode, stoneSize: SS16.diameterMm, height };
    const stemMm = fontManager.getFont(font).stemWidthRatio * height;
    assert.ok(stemMm < SS16.diameterMm, `${font}: test setup stem ${stemMm.toFixed(2)}mm must be under the ${SS16.diameterMm}mm stone`);
    const w = run(layer);
    assert.ok(w.classList.contains('visible'), `${font} in ${textMode} mode must still warn`);
    assert.match(w.textContent, family, 'the READ-003 message names the font');
    for (const marker of READ003_MARKERS) assert.match(w.textContent, marker);
  }
});

console.log('FONT-LIB-004 text-height readability warning tests passed.');
