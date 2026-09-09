// MONO-016 -- Unified letter spacing across monogram layouts.
//
// One shared "Letter spacing" control, two implementations, an asymmetric range:
//
//   |                | script                              | slot layouts                       |
//   |----------------|-------------------------------------|------------------------------------|
//   | what it does   | glyph tracking inside one interlocked string | additive term on the inter-slot gap |
//   | where it lands | emitted layer's `letterSpacing`     | layoutHorizontalGroup's `gapMm`     |
//   | range          | [-pitchMm, 4 x pitchMm]             | [0, 4 x pitchMm]                    |
//
// `pitchMm` is the monogram's OWN stone pitch (stoneSizeMm + gapMm). Slot layouts cannot go negative
// -- below the production stone-to-stone clearance (MONO-006E) adjacent letters' stones collide, so
// a negative slot request is rejected as INVALID_INPUT rather than silently clamped.
//
// MONO-013 shipped this as `interlockMm` (script-only, negative-only); MONO-016 renamed it outright
// (nothing shipped outside this repo) and widened the range.
//
// Real repository fonts + frames, same bootstrap as tools/test-mono-013-interlock.mjs.

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FontManager } from '../src/fonts/index.js';
import { createDefaultFontProviderRegistry } from '../src/text/index.js';
import { GeometryEngine, TRACKING_XPITCH_LADDER } from '../src/geometry/index.js';
import { computeMonogramLayout, MONOGRAM_LAYOUT_FAILURE_REASONS } from '../src/monogram/MonogramLayouts.js';
import { MonogramGenerator, MONOGRAM_GENERATOR_FAILURE_REASONS, singleChainHeightMm } from '../src/monogram/index.js';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const appJs = await readFile(path.join(repoRoot, 'app.js'), 'utf8');
const manifest = JSON.parse(await readFile(path.join(repoRoot, 'assets/fonts/manifest.json'), 'utf8'));
const fontManager = new FontManager(manifest);

async function loadFontBufferFromRepoRoot(relativePath) {
  const buffer = await readFile(path.join(repoRoot, relativePath));
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
}

function createRealGenerator() {
  const fontProviderRegistry = createDefaultFontProviderRegistry(fontManager, { loadFontBuffer: loadFontBufferFromRepoRoot });
  const geometryEngine = new GeometryEngine({ fontProviderRegistry });
  return { geometryEngine, generator: new MonogramGenerator({ geometryEngine }) };
}

const CANVAS_MM = { widthMm: 220, heightMm: 220 };
const TOP_RUNG = TRACKING_XPITCH_LADDER[TRACKING_XPITCH_LADDER.length - 1];

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

// The five layouts, each a reachable case (frame <= 150 mm; rs-block for the slot layouts, Great
// Vibes for script -- the only combinations app.js's monogram picker offers).
function layoutCase(layoutId, over = {}) {
  const slot = {
    single: { frameId: 'circle', letters: ['A'], frameRect: { xMm: 0, yMm: 0, widthMm: 90, heightMm: 90 } },
    'two-letter': { frameId: 'rounded-square', letters: ['A', 'B'], frameRect: { xMm: 0, yMm: 0, widthMm: 110, heightMm: 110 } },
    'traditional-three': { frameId: 'rounded-square', letters: ['A', 'B', 'C'], frameRect: { xMm: 0, yMm: 0, widthMm: 100, heightMm: 100 } },
    'equal-three': { frameId: 'rounded-square', letters: ['A', 'B', 'C'], frameRect: { xMm: 0, yMm: 0, widthMm: 110, heightMm: 110 } }
  }[layoutId];
  if (slot) {
    return { frameId: slot.frameId, layoutId, letters: slot.letters, fontId: 'rs-block', providerId: 'rhinestone',
      stoneSizeMm: 2.8, color: 'gold', canvasMm: CANVAS_MM, frameRect: slot.frameRect, ...over };
  }
  return { frameId: 'none', layoutId: 'script', letters: ['A', 'K', 'L'], fontId: 'great-vibes-regular', providerId: 'opentype',
    stemWidthRatio: 0.0357, stoneSizeMm: 2.0, gapMm: 0.3, color: 'gold', canvasMm: CANVAS_MM,
    frameRect: { xMm: 0, yMm: 0, widthMm: 150, heightMm: 150 }, ...over };
}

const GOLDEN_TOTAL = { single: 202, 'two-letter': 361, 'traditional-three': 300, 'equal-three': 374, script: 372 };

// ---------------------------------------------------------------------------
// 1. Default is byte-identical for all five layouts. Named negative control on a multi-letter
//    layout proves the byte-identity assertion discriminates.
// ---------------------------------------------------------------------------

await test('1. letterSpacingMm omitted == letterSpacingMm: 0, byte-identical layers, for all five layouts; golden total stone counts pinned', async () => {
  const { generator } = createRealGenerator();
  for (const layoutId of ['single', 'two-letter', 'traditional-three', 'equal-three', 'script']) {
    const omitted = await generator.generate(layoutCase(layoutId));
    const zero = await generator.generate(layoutCase(layoutId, { letterSpacingMm: 0 }));
    assert.equal(omitted.ok, true, `${layoutId}: ${omitted.message}`);
    assert.equal(zero.ok, true, `${layoutId}: ${zero.message}`);
    assert.equal(JSON.stringify(omitted.layers), JSON.stringify(zero.layers), `${layoutId}: omitted must be byte-identical to letterSpacingMm 0`);
    assert.equal(omitted.measurements.totalStoneCount, GOLDEN_TOTAL[layoutId], `${layoutId}: golden total stone count`);
    console.log(`    ${layoutId.padEnd(18)} omitted == 0 (byte-identical), total ${omitted.measurements.totalStoneCount} stones`);
  }
});

await test('1b. negative control: a non-zero letterSpacingMm DOES change the layers (traditional-three), so test 1 is not passing vacuously', async () => {
  const { generator } = createRealGenerator();
  const zero = await generator.generate(layoutCase('traditional-three', { letterSpacingMm: 0 }));
  const wide = await generator.generate(layoutCase('traditional-three', { letterSpacingMm: 6 }));
  assert.equal(zero.ok, true, zero.message);
  assert.equal(wide.ok, true, wide.message);
  assert.notEqual(JSON.stringify(zero.layers), JSON.stringify(wide.layers), 'a non-zero value must change the emitted layers');
  console.log(`    traditional-three: ls 0 -> ${zero.measurements.totalStoneCount} stones, ls 6 -> ${wide.measurements.totalStoneCount} stones (layers differ)`);
});

// ---------------------------------------------------------------------------
// 2. The rename is behaviour-neutral for script -- the engine's own letterSpacingMm param is
//    unchanged, so MONO-013's goldens reproduce exactly.
// ---------------------------------------------------------------------------

await test('2. script goldens exact through the engine: letterSpacingMm 0 -> 372 / 136.501458 mm, -2.3 -> 369 / 131.901458 mm (all four printed)', async () => {
  const { geometryEngine } = createRealGenerator();
  const heightMm = singleChainHeightMm({ stoneSizeMm: 2.0, stemWidthRatio: 0.0357 });
  const out = [];
  for (const letterSpacingMm of [0, -2.3]) {
    const layout = await geometryEngine.generateTextLayout({
      text: 'AKL', fontId: 'great-vibes-regular', providerId: 'opentype', layerId: 'probe',
      heightMm, stoneSizeMm: 2.0, gapMm: 0.3, mode: 'outline', color: 'gold', curveEnabled: false, letterSpacingMm
    });
    const box = layout.getBoundingBox();
    out.push({ letterSpacingMm, stones: layout.stones.length, bboxW: box.widthMm });
    console.log(`    letterSpacingMm ${String(letterSpacingMm).padStart(5)} -> ${layout.stones.length} stones, bboxW ${box.widthMm.toFixed(6)} mm`);
  }
  assert.deepEqual(out.map((o) => o.stones), [372, 369], 'MONO-013 golden stone counts -- if these move, the rename leaked into geometry; report it, do not re-pin');
  assert.ok(Math.abs(out[0].bboxW - 136.50145836140092) < 1e-6, 'MONO-013 golden bbox width (letterSpacingMm 0)');
  assert.ok(Math.abs(out[1].bboxW - 131.90145836140093) < 1e-6, 'MONO-013 golden bbox width (letterSpacingMm -2.3)');
});

// ---------------------------------------------------------------------------
// 3. Script spreads: positive values -> strictly wider bbox, monotone across three increasing
//    values.
// ---------------------------------------------------------------------------

await test('3. script: positive letterSpacingMm gives a strictly wider string bbox, monotone across 0 < 2 < 4 < 6 (widths printed)', async () => {
  const { geometryEngine } = createRealGenerator();
  const heightMm = singleChainHeightMm({ stoneSizeMm: 2.0, stemWidthRatio: 0.0357 });
  const widths = [];
  for (const letterSpacingMm of [0, 2, 4, 6]) {
    const layout = await geometryEngine.generateTextLayout({
      text: 'AKL', fontId: 'great-vibes-regular', providerId: 'opentype', layerId: 'probe',
      heightMm, stoneSizeMm: 2.0, gapMm: 0.3, mode: 'outline', color: 'gold', curveEnabled: false, letterSpacingMm
    });
    widths.push(layout.getBoundingBox().widthMm);
  }
  console.log(`    bbox widths (ls 0,2,4,6): ${widths.map((w) => w.toFixed(4)).join('  ')} mm`);
  for (let i = 1; i < widths.length; i++) {
    assert.ok(widths[i] > widths[i - 1], `width must strictly increase with spacing: ${widths[i - 1]} -> ${widths[i]}`);
  }
});

// ---------------------------------------------------------------------------
// 4. Slot layouts space: on traditional-three, increasing letterSpacingMm gives a strictly larger
//    inter-slot gap AND strictly smaller slot widths, monotone across three values.
// ---------------------------------------------------------------------------

await test('4. traditional-three: inter-slot gap strictly grows and slot widths strictly shrink across letterSpacingMm 3 < 6 < 9 (both series printed)', async () => {
  const { generator } = createRealGenerator();
  const req = { frameId: 'none', layoutId: 'traditional-three', letters: ['A', 'B', 'C'], fontId: 'rs-block', providerId: 'rhinestone',
    stoneSizeMm: 2.8, color: 'gold', canvasMm: { widthMm: 260, heightMm: 260 }, frameRect: { xMm: 0, yMm: 0, widthMm: 90, heightMm: 110 } };
  const gaps = [];
  const centerWidths = [];
  for (const letterSpacingMm of [3, 6, 9]) {
    const r = await generator.generate({ ...req, letterSpacingMm });
    assert.equal(r.ok, true, r.message);
    const s = r.measurements.slots;
    gaps.push(s[1].targetRect.xMm - (s[0].targetRect.xMm + s[0].targetRect.widthMm));
    centerWidths.push(s[1].targetRect.widthMm);
  }
  console.log(`    inter-slot gap (ls 3,6,9): ${gaps.map((g) => g.toFixed(4)).join('  ')} mm`);
  console.log(`    center slot width       : ${centerWidths.map((w) => w.toFixed(4)).join('  ')} mm`);
  for (let i = 1; i < gaps.length; i++) assert.ok(gaps[i] > gaps[i - 1], `gap must strictly grow: ${gaps[i - 1]} -> ${gaps[i]}`);
  for (let i = 1; i < centerWidths.length; i++) assert.ok(centerWidths[i] < centerWidths[i - 1], `slot width must strictly shrink: ${centerWidths[i - 1]} -> ${centerWidths[i]}`);
});

// ---------------------------------------------------------------------------
// 5. Slot negative is rejected (INVALID_INPUT naming the production clearance); script negative at
//    the same magnitude still succeeds. Asymmetry visible in one test.
// ---------------------------------------------------------------------------

await test('5. letterSpacingMm -1: rejected for traditional-three (INVALID_INPUT, names the clearance) but OK for script', async () => {
  const { generator } = createRealGenerator();
  const slot = await generator.generate(layoutCase('traditional-three', { frameId: 'none', frameRect: { xMm: 0, yMm: 0, widthMm: 100, heightMm: 100 }, letterSpacingMm: -1 }));
  assert.equal(slot.ok, false);
  assert.equal(slot.reason, MONOGRAM_GENERATOR_FAILURE_REASONS.INVALID_INPUT);
  assert.match(slot.message, /clearance|collid/i, 'slot rejection must name the production stone-to-stone clearance');
  const script = await generator.generate(layoutCase('script', { letterSpacingMm: -1 }));
  assert.equal(script.ok, true, script.message);
  assert.equal(script.measurements.letterSpacingMm, -1);
  console.log(`    slot -1 -> ${slot.reason}: ${slot.message.slice(0, 100)}`);
  console.log(`    script -1 -> ok, measurements.letterSpacingMm ${script.measurements.letterSpacingMm}`);
});

// ---------------------------------------------------------------------------
// 6. Over-wide spacing fails cleanly -- INSUFFICIENT_SPACE from the layout engine (mapped to
//    FITTING_FAILED by the generator), never a crash or a degenerate layout.
// ---------------------------------------------------------------------------

await test('6. over-wide letterSpacingMm: computeMonogramLayout returns INSUFFICIENT_SPACE; the generator surfaces it as FITTING_FAILED naming the spacing', async () => {
  const direct = computeMonogramLayout({
    layoutId: 'traditional-three', frameInteriorRect: { xMm: 0, yMm: 0, widthMm: 40, heightMm: 60 },
    letterCount: 3, minGapMm: 6.7, extraGapMm: 26
  });
  assert.equal(direct.ok, false);
  assert.equal(direct.reason, MONOGRAM_LAYOUT_FAILURE_REASONS.INSUFFICIENT_SPACE);

  const { generator } = createRealGenerator();
  const gen = await generator.generate({
    frameId: 'none', layoutId: 'traditional-three', letters: ['A', 'B', 'C'], fontId: 'rs-block', providerId: 'rhinestone',
    stoneSizeMm: 6.4, color: 'gold', canvasMm: { widthMm: 260, heightMm: 260 },
    frameRect: { xMm: 0, yMm: 0, widthMm: 40, heightMm: 60 }, letterSpacingMm: 26
  });
  assert.equal(gen.ok, false);
  assert.equal(gen.reason, MONOGRAM_GENERATOR_FAILURE_REASONS.FITTING_FAILED);
  assert.match(gen.message, /spacing between letters/);
  console.log(`    direct -> ${direct.reason}`);
  console.log(`    generator -> ${gen.reason}: ${gen.message.slice(0, 110)}`);
});

// ---------------------------------------------------------------------------
// 7. Both CHAIN_TOO_THIN paths name letter spacing as a remedy.
// ---------------------------------------------------------------------------

// The only OpenType slot combination that is ever legal is `two-letter` (traditional-three /
// equal-three are CHAIN_TOO_THIN for a script font at every frame size within the 150 mm `none`
// cap -- that is why MONO-013's `script` layout exists; see the deviation note in the spec). Within
// `two-letter`, the spacing -> CHAIN_TOO_THIN transition is width-driven and needs a frame around
// 100 mm wide: `COMMON_SCALING_LIMITS_MM` allows `none` to be 20-150 mm, so a 100 mm frame is
// reachable. At the largest reachable frame (150) the mark never crosses the boundary at any legal
// spacing -- probed and printed below, not asserted-around.
await test('7. slot CHAIN_TOO_THIN (per-letter, MonogramGenerator.js ~L788): Great Vibes / two-letter / none / SS6 -- reachable spacing turns a passing mark into CHAIN_TOO_THIN, message names "less letter spacing"', async () => {
  const { generator } = createRealGenerator();
  const base = {
    frameId: 'none', layoutId: 'two-letter', letters: ['A', 'B'], fontId: 'great-vibes-regular',
    providerId: 'opentype', stemWidthRatio: 0.0357, stoneSizeMm: 2.0, gapMm: 0.3, color: 'gold',
    canvasMm: { widthMm: 260, heightMm: 260 }, frameRect: { xMm: 0, yMm: 0, widthMm: 100, heightMm: 100 }
  };
  const stem = (r) => r.ok ? r.measurements.letters.map((l) => l.stemStones.toFixed(3)).join('/') : r.diagnostics.achievedStemStones.toFixed(3);

  const pass = await generator.generate({ ...base, letterSpacingMm: 0 });
  const fail = await generator.generate({ ...base, letterSpacingMm: 9 });

  // Print the ACTUAL request the assertions ran against, read back from an echo object.
  console.log(`    request: frameId=${base.frameId} layout=${base.layoutId} letters=${JSON.stringify(base.letters)} font=${base.fontId} stemWidthRatio=${base.stemWidthRatio} stoneSizeMm=${base.stoneSizeMm} frameRect=${JSON.stringify(base.frameRect)}`);
  console.log(`    letterSpacingMm 0 -> ok=${pass.ok} reason=${pass.reason ?? '-'} stemStones=${stem(pass)}`);
  console.log(`    letterSpacingMm 9 -> ok=${fail.ok} reason=${fail.reason ?? '-'} stemStones=${stem(fail)}`);

  assert.equal(pass.ok, true, `expected letterSpacingMm 0 to pass: ${pass.message}`);
  assert.equal(fail.ok, false);
  assert.equal(fail.reason, MONOGRAM_GENERATOR_FAILURE_REASONS.CHAIN_TOO_THIN);
  assert.match(fail.message, /\(slot \d\)/, 'the per-letter slot message names a slot index');
  assert.match(fail.message, /less letter spacing/, 'remedy sentence must include reducing letter spacing');
  console.log(`    message: ${fail.message}`);

  // The reviewer's suggested frame -- none 150x150 -- does NOT straddle: report the numbers rather
  // than move the frame to manufacture a transition there.
  const big = { ...base, frameRect: { xMm: 0, yMm: 0, widthMm: 150, heightMm: 150 } };
  const big0 = await generator.generate({ ...big, letterSpacingMm: 0 });
  const bigMax = await generator.generate({ ...big, letterSpacingMm: 9.2 });
  console.log(`    none 150x150 (largest reachable): letterSpacingMm 0 -> ok=${big0.ok} stemStones=${stem(big0)}; letterSpacingMm 9.2 -> ok=${bigMax.ok} stemStones=${stem(bigMax)} (never crosses the boundary at any legal spacing)`);
  assert.equal(big0.ok, true);
  assert.equal(bigMax.ok, true, 'two-letter Great Vibes at none 150x150 stays legal across the whole spacing range');
});

await test('7b. script CHAIN_TOO_THIN (interlocked-string, line ~1321): Great Vibes / script / none 150 / SS10 message also names "less letter spacing"', async () => {
  const { generator } = createRealGenerator();
  const r = await generator.generate(layoutCase('script', { stoneSizeMm: 2.8, letterSpacingMm: 0 }));
  assert.equal(r.ok, false);
  assert.equal(r.reason, MONOGRAM_GENERATOR_FAILURE_REASONS.CHAIN_TOO_THIN);
  assert.match(r.message, /interlocked string/);
  assert.match(r.message, /less letter spacing/);
  console.log(`    ${r.message}`);
});

// ---------------------------------------------------------------------------
// 8. Bounds and visibility -- the app.js control helpers, sliced and executed against a fake DOM
//    (the established app.js-source-slicing pattern).
// ---------------------------------------------------------------------------

function sliceBetween(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  assert.ok(start >= 0, `slice start not found: ${startMarker}`);
  const end = source.indexOf(endMarker, start);
  assert.ok(end >= 0, `slice end not found: ${endMarker}`);
  return source.slice(start, end + endMarker.length);
}

function makeControlSandbox() {
  const els = new Map();
  const el = (id) => {
    if (!els.has(id)) els.set(id, { value: '', style: {}, textContent: '', min: '', max: '' });
    return els.get(id);
  };
  const controlSrc = sliceBetween(
    appJs,
    'const MONOGRAM_INTERLOCK_GAP_MM=0.3;',
    'function updateMonogramLetterSpacingVisibility(){\n  const show=monogramResolvedLetterCount()>=2;\n  el(\'monogramLetterSpacingField\').style.display=show?\'\':\'none\';\n  if(show)refreshMonogramLetterSpacingBounds();\n}'
  );
  const factory = new Function(
    'el', 'TRACKING_XPITCH_LADDER', 'MONOGRAM_LAYOUTS', 'MONOGRAM_LAYOUT_LETTER_COUNTS',
    'formatLengthDisplay', 'unitSuffix', 'project',
    `${controlSrc}
     return { monogramLayoutIsScript, monogramResolvedLetterCount, monogramLetterSpacingPitchMm,
       monogramLetterSpacingBoundsMm, monogramLetterSpacingMm, refreshMonogramLetterSpacingBounds,
       updateMonogramLetterSpacingVisibility };`
  );
  const api = factory(
    el, TRACKING_XPITCH_LADDER,
    { SINGLE: 'single', TWO_LETTER: 'two-letter', TRADITIONAL_THREE: 'traditional-three', EQUAL_THREE: 'equal-three', SCRIPT: 'script' },
    { single: 1, 'two-letter': 2, 'traditional-three': 3, 'equal-three': 3 },
    (mm) => String(mm), () => 'mm', { units: 'mm' }
  );
  return { el, api };
}

await test('8. control bounds: script min is -pitchMm, slot min is 0, both max = TOP_RUNG x monogramLetterSpacingPitchMm()', () => {
  const { el, api } = makeControlSandbox();
  el('monogramStoneSize').value = '2';               // SS6 -> pitch 2.3
  const pitchMm = api.monogramLetterSpacingPitchMm();
  assert.ok(Math.abs(pitchMm - 2.3) < 1e-9, `pitchMm ${pitchMm}`);

  el('monogramLayout').value = 'script';
  const scriptBounds = api.monogramLetterSpacingBoundsMm();
  assert.equal(scriptBounds.minMm, -pitchMm, 'script min is -pitchMm');
  assert.equal(scriptBounds.maxMm, TOP_RUNG * pitchMm, 'script max is TOP_RUNG x pitchMm');

  el('monogramLayout').value = 'traditional-three';
  const slotBounds = api.monogramLetterSpacingBoundsMm();
  assert.equal(slotBounds.minMm, 0, 'slot min is 0');
  assert.equal(slotBounds.maxMm, TOP_RUNG * pitchMm, 'slot max is TOP_RUNG x pitchMm');
  console.log(`    pitch ${pitchMm} mm; script [${scriptBounds.minMm}, ${scriptBounds.maxMm}]; slot [${slotBounds.minMm}, ${slotBounds.maxMm}]`);
});

await test('8b. control visibility: hidden for single and one-letter script, shown once the resolved letter count reaches 2', () => {
  const { el, api } = makeControlSandbox();
  el('monogramStoneSize').value = '2';

  el('monogramLayout').value = 'single';
  api.updateMonogramLetterSpacingVisibility();
  assert.equal(el('monogramLetterSpacingField').style.display, 'none', 'hidden for single');

  el('monogramLayout').value = 'script';
  el('monogramLetters').value = 'A';
  api.updateMonogramLetterSpacingVisibility();
  assert.equal(el('monogramLetterSpacingField').style.display, 'none', 'hidden for a one-letter script mark');

  el('monogramLetters').value = 'AK';
  api.updateMonogramLetterSpacingVisibility();
  assert.equal(el('monogramLetterSpacingField').style.display, '', 'shown for a two-letter script mark');

  el('monogramLayout').value = 'two-letter';
  el('monogramLetters').value = '';
  api.updateMonogramLetterSpacingVisibility();
  assert.equal(el('monogramLetterSpacingField').style.display, '', 'shown for two-letter regardless of typed letters');
});

await test('8c. control clamp: refreshMonogramLetterSpacingBounds re-clamps a now-illegal negative value to 0 when the layout switches script -> slot', () => {
  const { el, api } = makeControlSandbox();
  el('monogramStoneSize').value = '2';
  el('monogramLayout').value = 'script';
  el('monogramLetterSpacing').value = '-2';
  api.refreshMonogramLetterSpacingBounds();
  assert.equal(api.monogramLetterSpacingMm(), -2, 'script keeps the negative value');

  el('monogramLayout').value = 'equal-three';
  api.refreshMonogramLetterSpacingBounds();
  assert.equal(el('monogramLetterSpacing').value, '0', 'slot layout re-clamps the slider value up to 0');
  assert.equal(api.monogramLetterSpacingMm(), 0);
});

if (process.exitCode) {
  console.error('\nMONO-016 letter-spacing tests FAILED.');
} else {
  console.log('\nAll MONO-016 letter-spacing tests passed.');
}
