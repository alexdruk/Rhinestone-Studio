// MONO-013 -- Interlocked script: one interlocked mark, not per-letter slots.
//
// Covers the 'script' layout in src/monogram/MonogramLayouts.js and the _generateScriptMonogram()
// branch of src/monogram/MonogramGenerator.generate(). Real repository fonts + frames, same
// bootstrap as tools/test-mono-012-single-chain.mjs.
//
// All pipeline cases: Great Vibes (great-vibes-regular, manifest stemWidthRatio 0.0357), 'script'
// layout, frame 'none', SS6 (2.0 mm), gap 0.3 mm, letters "AKL". Case 1 uses an 80 mm frame (where
// an interlocked "AKL" mark cannot clear the single-chain minimum -- MONO-013 review decision);
// the cases that need `ok` use a 150 mm frame -- the LARGEST the product can actually produce for
// the 'none' frame (COMMON_SCALING_LIMITS_MM in FrameLibrary.js:142, applied to the Frame Size
// fields at app.js:5041-5050). At SS6 the natural "AKL" mark is 136.5 mm padded, so no shrink is
// required and the stem sits at its natural 0.85. The SS10 ceiling case shows three-letter script
// is an SS6-only configuration today -- see docs/specifications/MONO-013-Interlock.md "Reachable
// configurations".
//
// Numbers re-derived on develop @ b2f07b0 (tools/scratch/mono-013-*.mjs):
//   singleChainHeightMm({ stoneSizeMm: 2.0, stemWidthRatio: 0.0357 }) = 47.61904761904761
//   "AKL" at that height, getBoundingBox().widthMm (padded +stoneSizeMm; the spec's raw
//   point-spread numbers are exactly 2.0 mm less -- MONO-013 review decision: assert the padded
//   bounding box the rest of MonogramGenerator uses):
//     letterSpacingMm +2.3 -> 380 stones, bboxW 141.1014583614009
//     letterSpacingMm  0   -> 372 stones, bboxW 136.50145836140092
//     letterSpacingMm -2.3 -> 369 stones, bboxW 131.90145836140093
//   minimum pairwise stone distance at all three spacings -> 2.002187 mm (6 dp)

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FontManager } from '../src/fonts/index.js';
import { createDefaultFontProviderRegistry } from '../src/text/index.js';
import { GeometryEngine } from '../src/geometry/index.js';
import {
  MonogramGenerator,
  MONOGRAM_GENERATOR_FAILURE_REASONS,
  SINGLE_CHAIN_MIN_RATIO,
  SINGLE_CHAIN_MAX_RATIO,
  singleChainHeightMm
} from '../src/monogram/index.js';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
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

const CANVAS_MM = { widthMm: 200, heightMm: 200 };
const STONE_SIZE_MM = 2.0;
const GAP_MM = 0.3;
const STEM_WIDTH_RATIO = 0.0357;
const EPS = 1e-9;

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

function baseRequest(over = {}) {
  return {
    frameId: 'none', layoutId: 'script', letters: ['A', 'K', 'L'],
    fontId: 'great-vibes-regular', providerId: 'opentype', stemWidthRatio: STEM_WIDTH_RATIO,
    stoneSizeMm: STONE_SIZE_MM, gapMm: GAP_MM, color: 'gold', canvasMm: CANVAS_MM,
    frameRect: { xMm: 0, yMm: 0, widthMm: 80, heightMm: 80 },
    ...over
  };
}
const FRAME_150 = { xMm: 0, yMm: 0, widthMm: 150, heightMm: 150 };

function minPairwiseStoneDistanceMm(stones) {
  let min = Infinity;
  for (let i = 0; i < stones.length; i++) {
    for (let j = i + 1; j < stones.length; j++) {
      const d = Math.hypot(stones[i].xMm - stones[j].xMm, stones[i].yMm - stones[j].yMm);
      if (d < min) min = d;
    }
  }
  return min;
}

// ---------------------------------------------------------------------------
// Negative control (MONO-013 spec, "required, and asked for by name").
//
// Case 3's pair of assertions (fewer stones AND narrower bbox at the floor) is the control: the two
// sides can differ and do. Before asserting anything, probe and print the raw stone count and bbox
// width of the joined string at three spacings (+2.3, 0, -2.3) and show the counts are strictly
// monotone decreasing -- that demonstrates the measured quantity actually responds to the knob.
//
// minStoneDistanceMm is NOT used as evidence about interlock: it is byte-identical at all three
// spacings (the closest pair is inside a single glyph and simply translates), asserted below.
// ---------------------------------------------------------------------------

await test('negative control: raw "AKL" stone count is strictly monotone decreasing as overlap increases (+2.3 -> 0 -> -2.3); minStoneDistanceMm is invariant', async () => {
  const { geometryEngine } = createRealGenerator();
  const heightMm = singleChainHeightMm({ stoneSizeMm: STONE_SIZE_MM, stemWidthRatio: STEM_WIDTH_RATIO });
  assert.equal(heightMm, 47.61904761904761, 're-derived singleChainHeightMm literal');

  const probes = [];
  for (const letterSpacingMm of [2.3, 0, -2.3]) {
    const layout = await geometryEngine.generateTextLayout({
      text: 'AKL', fontId: 'great-vibes-regular', providerId: 'opentype', layerId: 'probe',
      heightMm, stoneSizeMm: STONE_SIZE_MM, gapMm: GAP_MM, mode: 'outline', color: 'gold',
      curveEnabled: false, letterSpacingMm
    });
    const box = layout.getBoundingBox();
    probes.push({ letterSpacingMm, stones: layout.stones.length, bboxW: box.widthMm, minDist: minPairwiseStoneDistanceMm(layout.stones) });
    console.log(`    letterSpacingMm ${String(letterSpacingMm).padStart(5)} -> ${layout.stones.length} stones, bboxW ${box.widthMm.toFixed(6)} mm, minDist ${minPairwiseStoneDistanceMm(layout.stones).toFixed(6)} mm`);
  }

  // Strictly monotone decreasing stone count.
  assert.ok(probes[0].stones > probes[1].stones && probes[1].stones > probes[2].stones,
    `stone counts ${probes.map((p) => p.stones).join(' > ')} must be strictly decreasing`);
  assert.deepEqual(probes.map((p) => p.stones), [380, 372, 369], 're-derived stone-count literals');

  // Strictly monotone decreasing bbox width too (same direction, offset by a constant halo).
  assert.ok(probes[0].bboxW > probes[1].bboxW && probes[1].bboxW > probes[2].bboxW,
    'bbox widths must be strictly decreasing');
  assert.ok(Math.abs(probes[1].bboxW - 136.50145836140092) < 1e-6, 're-derived bboxW literal at spacing 0');

  // minStoneDistanceMm is a within-glyph translate -- invariant, so it is not interlock evidence.
  assert.ok(Math.abs(probes[0].minDist - probes[1].minDist) < 1e-6 && Math.abs(probes[1].minDist - probes[2].minDist) < 1e-6,
    'minStoneDistanceMm must be invariant across the three spacings (documented: not interlock evidence)');
  assert.ok(Math.abs(probes[1].minDist - 2.002187) < 1e-6, 're-derived minStoneDistanceMm literal (6 dp)');
});

// ---------------------------------------------------------------------------
// 1. letterSpacingMm 0, 80 mm frame -> CHAIN_TOO_THIN (the interlocked "AKL" mark shrinks below the
//    single-chain minimum). The message names the string, not a letter/slot.
// ---------------------------------------------------------------------------

await test('Great Vibes / script / none / 80 mm / SS6, interlock 0 -> CHAIN_TOO_THIN naming the string', async () => {
  const { generator } = createRealGenerator();
  const result = await generator.generate(baseRequest({ letterSpacingMm: 0 }));
  assert.equal(result.ok, false);
  assert.equal(result.reason, MONOGRAM_GENERATOR_FAILURE_REASONS.CHAIN_TOO_THIN);
  assert.match(result.message, /interlocked string "AKL"/);
  assert.doesNotMatch(result.message, /slot/);
  assert.equal(result.diagnostics.string, 'AKL');
  assert.equal(result.diagnostics.boundThatBound, 'single-chain-minimum');
  assert.ok(result.diagnostics.achievedStemStones < SINGLE_CHAIN_MIN_RATIO);
});

// ---------------------------------------------------------------------------
// 1b. The stone-size ceiling. Single-chain height scales with stone size but the 'none' frame is
//     capped at 150 mm, so above SS6 a three-letter script mark cannot fit at a legible stem. At
//     SS10 (2.8 mm) the minimum fitting region for "AKL" is 157.87 mm (see
//     docs/specifications/MONO-013-Interlock.md "Reachable configurations") > the 150 mm cap.
//     Pinned with a test so a customer who picks SS10 gets this behaviour deliberately, not by
//     surprise. Re-derived: at 150 mm the SS10 mark shrinks to ~0.664 stones across the stem.
// ---------------------------------------------------------------------------

await test('Great Vibes / script / none / 150 mm / SS10 (2.8 mm), interlock 0 -> CHAIN_TOO_THIN (three-letter script is SS6-only today)', async () => {
  const { generator } = createRealGenerator();
  const result = await generator.generate(baseRequest({ frameRect: FRAME_150, stoneSizeMm: 2.8, letterSpacingMm: 0 }));
  assert.equal(result.ok, false);
  assert.equal(result.reason, MONOGRAM_GENERATOR_FAILURE_REASONS.CHAIN_TOO_THIN);
  assert.match(result.message, /interlocked string "AKL"/);
  assert.equal(result.diagnostics.boundThatBound, 'single-chain-minimum');
  assert.ok(result.diagnostics.achievedStemStones < SINGLE_CHAIN_MIN_RATIO,
    `achievedStemStones ${result.diagnostics.achievedStemStones} < ${SINGLE_CHAIN_MIN_RATIO}`);
});

// ---------------------------------------------------------------------------
// 2. letterSpacingMm 0, 150 mm frame (the product max for 'none') -> ok, exactly one text layer,
//    single-chain stem at its NATURAL 0.85 (150 mm > the 136.5 mm natural mark, so no shrink),
//    floor clearance.
// ---------------------------------------------------------------------------

await test('Great Vibes / script / none / 150 mm / SS6, interlock 0 -> ok, one text layer, stem at natural 0.85 (no shrink), clearance >= stoneSizeMm', async () => {
  const { generator } = createRealGenerator();
  const result = await generator.generate(baseRequest({ frameRect: FRAME_150, letterSpacingMm: 0 }));
  assert.equal(result.ok, true, result.message);

  const textLayers = result.layers.filter((l) => l.type === 'text');
  assert.equal(textLayers.length, 1, 'exactly one text layer');
  assert.equal(result.layers.length, 1, 'frame none -> no frame layer');

  const layer = textLayers[0];
  assert.equal(layer.text, 'AKL');
  assert.equal(layer.id, 'monogram-none-script-letter-0');
  assert.equal(layer.letterSpacing, 0);
  assert.equal(layer.heightMode, 'raw');
  assert.equal(layer.authoredScale, undefined);
  assert.equal(layer.textMode, 'stroke');

  const m = result.measurements.letters[0];
  assert.equal(layer.height, m.fittedHeightMm);
  // 150 mm frame does not shrink the 136.5 mm natural mark: fitted height == the ideal single-chain
  // height and the stem sits at its natural 0.85 (mid-band of [0.70, 1.10]).
  assert.equal(m.fittedHeightMm, singleChainHeightMm({ stoneSizeMm: STONE_SIZE_MM, stemWidthRatio: STEM_WIDTH_RATIO }),
    'no shrink -> fitted height is exactly the ideal single-chain height');
  assert.ok(Math.abs(m.stemStones - 0.85) < 1e-9, `stemStones ${m.stemStones} == natural 0.85`);
  assert.ok(m.stemStones >= SINGLE_CHAIN_MIN_RATIO && m.stemStones <= SINGLE_CHAIN_MAX_RATIO,
    `stemStones ${m.stemStones} within [${SINGLE_CHAIN_MIN_RATIO}, ${SINGLE_CHAIN_MAX_RATIO}]`);
  assert.equal(m.stoneCount, 372, 're-derived fitted stone-count literal');
  assert.equal(result.measurements.letterSpacingMm, 0);
  assert.ok(result.measurements.minStoneDistanceMm >= STONE_SIZE_MM - 1e-6,
    `minStoneDistanceMm ${result.measurements.minStoneDistanceMm} >= stoneSizeMm - 1e-6`);
});

// ---------------------------------------------------------------------------
// 3. letterSpacingMm -2.3 (the floor), 150 mm frame -> ok, AND both: strictly fewer stones than case 2,
//    strictly narrower string bbox than case 2. (The negative control above already showed the
//    measured quantity responds to the knob.)
// ---------------------------------------------------------------------------

await test('Great Vibes / script / none / 150 mm / SS6, interlock -2.3 (floor) -> ok, strictly fewer stones AND narrower bbox than interlock 0', async () => {
  const { generator } = createRealGenerator();
  const at0 = await generator.generate(baseRequest({ frameRect: FRAME_150, letterSpacingMm: 0 }));
  const atFloor = await generator.generate(baseRequest({ frameRect: FRAME_150, letterSpacingMm: -2.3 }));
  assert.equal(at0.ok, true, at0.message);
  assert.equal(atFloor.ok, true, atFloor.message);

  const m0 = at0.measurements.letters[0];
  const mF = atFloor.measurements.letters[0];
  assert.ok(mF.stoneCount < m0.stoneCount, `floor stoneCount ${mF.stoneCount} < interlock-0 stoneCount ${m0.stoneCount}`);
  assert.ok(mF.scaledBoundingBox.widthMm < m0.scaledBoundingBox.widthMm,
    `floor bboxW ${mF.scaledBoundingBox.widthMm} < interlock-0 bboxW ${m0.scaledBoundingBox.widthMm}`);

  assert.equal(mF.stoneCount, 369, 're-derived floor stone-count literal');
  assert.equal(atFloor.measurements.letterSpacingMm, -2.3);
  assert.equal(atFloor.layers.find((l) => l.type === 'text').letterSpacing, -2.3);
  assert.ok(atFloor.measurements.minStoneDistanceMm >= STONE_SIZE_MM - 1e-6);
});

// ---------------------------------------------------------------------------
// 4. Out-of-range letterSpacingMm -> INVALID_INPUT. MONO-016: the script range is now
//    [-pitchMm, 4 x pitchMm] -- negative tightens, positive spreads. Only values outside that band
//    are rejected (a positive value inside it is legal, unlike MONO-013's negative-only rule).
// ---------------------------------------------------------------------------

await test('letterSpacingMm -2.4 (below the -pitchMm floor) -> INVALID_INPUT', async () => {
  const { generator } = createRealGenerator();
  const result = await generator.generate(baseRequest({ frameRect: FRAME_150, letterSpacingMm: -2.4 }));
  assert.equal(result.ok, false);
  assert.equal(result.reason, MONOGRAM_GENERATOR_FAILURE_REASONS.INVALID_INPUT);
  assert.match(result.message, /letterSpacingMm/);
});

await test('letterSpacingMm 100 (above 4 x pitchMm) -> INVALID_INPUT', async () => {
  const { generator } = createRealGenerator();
  const result = await generator.generate(baseRequest({ frameRect: FRAME_150, letterSpacingMm: 100 }));
  assert.equal(result.ok, false);
  assert.equal(result.reason, MONOGRAM_GENERATOR_FAILURE_REASONS.INVALID_INPUT);
  assert.match(result.message, /letterSpacingMm/);
});

await test('letterSpacingMm 0.5 (positive, inside the script range) -> ok (MONO-016 widened the range; spreading is legal)', async () => {
  const { generator } = createRealGenerator();
  const result = await generator.generate(baseRequest({ frameRect: FRAME_150, letterSpacingMm: 0.5 }));
  assert.equal(result.ok, true, result.message);
  assert.equal(result.measurements.letterSpacingMm, 0.5);
});

await test('letterSpacingMm omitted -> defaults to 0 (ok at 150 mm)', async () => {
  const { generator } = createRealGenerator();
  const result = await generator.generate(baseRequest({ frameRect: FRAME_150 }));
  assert.equal(result.ok, true, result.message);
  assert.equal(result.measurements.letterSpacingMm, 0);
});

// ---------------------------------------------------------------------------
// 5. Authored font + script -> INVALID_FONT.
// ---------------------------------------------------------------------------

await test('rs-block (authored) / script -> INVALID_FONT', async () => {
  const { generator } = createRealGenerator();
  const result = await generator.generate(baseRequest({
    frameRect: FRAME_150, fontId: 'rs-block', providerId: 'rhinestone', stemWidthRatio: undefined
  }));
  assert.equal(result.ok, false);
  assert.equal(result.reason, MONOGRAM_GENERATOR_FAILURE_REASONS.INVALID_FONT);
  assert.match(result.message, /outline \(OpenType\) font/);
});

// ---------------------------------------------------------------------------
// 6. Four letters + script -> UNSUPPORTED_LETTER_COUNT.
// ---------------------------------------------------------------------------

await test('four letters / script -> UNSUPPORTED_LETTER_COUNT', async () => {
  const { generator } = createRealGenerator();
  const result = await generator.generate(baseRequest({
    frameRect: FRAME_150, letters: ['A', 'K', 'L', 'M']
  }));
  assert.equal(result.ok, false);
  assert.equal(result.reason, MONOGRAM_GENERATOR_FAILURE_REASONS.UNSUPPORTED_LETTER_COUNT);
  assert.match(result.message, /1.3 letter/);
});

await test('one letter and two letters / script -> ok (range is 1-3)', async () => {
  const { generator } = createRealGenerator();
  for (const letters of [['A'], ['A', 'K']]) {
    const result = await generator.generate(baseRequest({ frameRect: FRAME_150, letters }));
    assert.equal(result.ok, true, `${letters.join('')}: ${result.message}`);
    assert.equal(result.layers.filter((l) => l.type === 'text').length, 1);
    assert.equal(result.layers.find((l) => l.type === 'text').text, letters.join(''));
  }
});

// ---------------------------------------------------------------------------
// 7. Persisted-field round trip -- THIS TEST is the owner of the check (there is no internal
//    round-trip in _generateScriptMonogram(); see MonogramGenerator.js:696-702 / the MONO-012
//    precedent it points at). A live render of the emitted layer must reproduce the generator's
//    fitted geometry (stone count + bbox + centre) -- built ONLY from the fields on the persisted
//    layer object, mapped the way app.js:793 maps them. letterSpacing is the field that can
//    actually be wrong: the OpenType path never persisted it before MONO-013.
// ---------------------------------------------------------------------------

const TEXT_MODE_TO_ENGINE_MODE = { stroke: 'outline', fill: 'fill', staggered: 'staggered', radial: 'radial', contour: 'contour' };
function engineParamsFromEmittedLayer(layer) {
  // Mirrors app.js:793's layer -> engine mapping exactly:
  //   letterSpacingMm: authored ? 0 : (layer.letterSpacing ?? 0)
  // The script layout only ever emits OpenType (non-authored) layers, so `authored` is false and
  // the persisted layer.letterSpacing is what reaches the engine.
  const authored = false;
  return {
    text: layer.text, fontId: layer.font, providerId: 'opentype', layerId: layer.id,
    heightMm: layer.height, stoneSizeMm: layer.stoneSize, gapMm: layer.gap,
    letterSpacingMm: authored ? 0 : (layer.letterSpacing ?? 0),
    mode: TEXT_MODE_TO_ENGINE_MODE[layer.textMode] || 'outline',
    color: layer.color, curveEnabled: false
  };
}

await test('persisted-field round trip: a live render built from the emitted layer object reproduces the generator\'s fitted geometry, with a named negative control on layer.letterSpacing', async () => {
  const { geometryEngine, generator } = createRealGenerator();
  const result = await generator.generate(baseRequest({ frameRect: FRAME_150, letterSpacingMm: -2.3 }));
  assert.equal(result.ok, true, result.message);

  const layer = result.layers.find((l) => l.type === 'text');
  const m = result.measurements.letters[0];

  // Every generateTextLayout() argument comes from the persisted layer object, not a generator local.
  assert.equal(layer.letterSpacing, -2.3, 'the emitted layer persists the interlock as layer.letterSpacing');
  const params = engineParamsFromEmittedLayer(layer);
  assert.equal(params.mode, 'outline', 'stroke textMode maps to outline (mapping, not literal)');
  assert.equal(params.letterSpacingMm, -2.3, 'app.js:793 mapping forwards layer.letterSpacing to the engine');

  const regen = await geometryEngine.generateTextLayout(params);
  const box = regen.getBoundingBox();
  const JSON_EPS = 1e-6;
  assert.equal(regen.stones.length, m.stoneCount, 'stone count matches measurements.letters[0]');
  assert.ok(Math.abs(box.widthMm - m.scaledBoundingBox.widthMm) < JSON_EPS, 'bbox width matches measurements');
  assert.ok(Math.abs(box.heightMm - m.scaledBoundingBox.heightMm) < JSON_EPS, 'bbox height matches measurements');
  assert.ok(Math.abs(box.minXmm - m.scaledBoundingBox.minXmm) < JSON_EPS, 'bbox minX (=> centre) matches measurements');
  assert.ok(Math.abs(box.minYmm - m.scaledBoundingBox.minYmm) < JSON_EPS, 'bbox minY (=> centre) matches measurements');

  // Negative control: perturb ONE persisted field -- layer.letterSpacing set to 0 while the real
  // interlock is -2.3 -- and require the comparison to FAIL. Two sides that can differ, and do.
  const perturbed = engineParamsFromEmittedLayer({ ...layer, letterSpacing: 0 });
  assert.equal(perturbed.letterSpacingMm, 0, 'control: the perturbed params carry letterSpacingMm 0');
  const wrong = await geometryEngine.generateTextLayout(perturbed);
  const wrongBox = wrong.getBoundingBox();
  console.log(`    round trip:  stones ${regen.stones.length}, bboxW ${box.widthMm.toFixed(6)} mm  (letterSpacing -2.3)`);
  console.log(`    control:     stones ${wrong.stones.length}, bboxW ${wrongBox.widthMm.toFixed(6)} mm  (letterSpacing 0)`);
  const diverges = wrong.stones.length !== regen.stones.length || Math.abs(wrongBox.widthMm - box.widthMm) > JSON_EPS;
  assert.ok(diverges, 'control: regenerating with layer.letterSpacing perturbed to 0 must NOT reproduce the fitted geometry');
  assert.notEqual(wrong.stones.length, m.stoneCount, 'control: the perturbed stone count must not match measurements either');
});

// ---------------------------------------------------------------------------
// 8. The four pre-existing layouts are untouched -- a spot regression check.
// ---------------------------------------------------------------------------

await test('RS Block / traditional-three still generates unchanged (script branch does not touch it)', async () => {
  const { generator } = createRealGenerator();
  const result = await generator.generate({
    frameId: 'rounded-square', layoutId: 'traditional-three', letters: ['A', 'B', 'C'],
    fontId: 'rs-block', providerId: 'rhinestone',
    stoneSizeMm: 2.8, color: 'gold', canvasMm: CANVAS_MM,
    frameRect: { xMm: 0, yMm: 0, widthMm: 100, heightMm: 100 }
  });
  assert.equal(result.ok, true, result.message);
  assert.equal(result.measurements.totalStoneCount, 300);
  assert.equal(result.measurements.letterSpacingMm, 0, 'slot layouts carry the applied letter spacing; 0 when none requested');
});

if (process.exitCode) {
  console.error('\nMONO-013 interlock tests FAILED.');
} else {
  console.log('\nAll MONO-013 interlock tests passed.');
}
