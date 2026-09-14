// MONO-018 -- Report the binding letter in CHAIN_TOO_THIN.
//
// MONO-017 (docs/specifications/MONO-017-StemReportDiagnosis.md) established that
// MonogramGenerator.generate()'s per-letter OpenType branch quoted the stem figure of the FIRST
// letter below the single-chain minimum in slot order, not the thinnest one. Because letters shrink
// by different amounts to fill an identical slot, the first sub-floor letter's identity changes with
// frame size, so the quoted figure was non-monotone: for Great Vibes A,K,L / equal-three / none /
// SS6 it read K 0.470 at 150x150, K 0.376 at 120x120, then A 0.591 at 100x100 -- rising as the user
// shrank the frame, even though the true worst letter (K) ran 0.470 / 0.376 / 0.309.
//
// MONO-018 hoists the gate out of the letter loop: every letter is fitted, and on failure the
// BINDING (minimum achievedStemStones) letter is reported, ties broken on the lower slot index.
// CHAIN_TOO_THIN emits no geometry (layers: null), so no committed baseline moves -- the "no baseline
// moved" re-runs live in the MONO-012/013/014/015/016 suites; this file owns the reporting change.
//
// Real repository fonts + frames, same bootstrap as tools/test-mono-016-letter-spacing.mjs.
// Develop reference values were captured on feature/mono-018-binding-letter's base, develop @ 573c4e5.

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FontManager } from '../src/fonts/index.js';
import { createDefaultFontProviderRegistry } from '../src/text/index.js';
import { GeometryEngine } from '../src/geometry/index.js';
import { MonogramGenerator, MONOGRAM_GENERATOR_FAILURE_REASONS } from '../src/monogram/index.js';

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
  let engineCalls = 0;
  const originalGenerateTextLayout = geometryEngine.generateTextLayout.bind(geometryEngine);
  geometryEngine.generateTextLayout = async (params) => {
    engineCalls += 1;
    return originalGenerateTextLayout(params);
  };
  return {
    geometryEngine,
    generator: new MonogramGenerator({ geometryEngine }),
    get engineCalls() { return engineCalls; }
  };
}

const CANVAS_MM = { widthMm: 200, heightMm: 200 };
const R = MONOGRAM_GENERATOR_FAILURE_REASONS;
const GV = { fontId: 'great-vibes-regular', providerId: 'opentype', stemWidthRatio: 0.0357 };

// A Great Vibes / none-frame / SS6 slot-layout request. The 'none' frame's COMMON_SCALING_LIMITS_MM
// is 20-150 mm, so every frame size used below is UI-reachable (MONO-017 sec 1a).
function gvReq(layoutId, letters, frameMm, overrides = {}) {
  return {
    frameId: 'none', layoutId, letters,
    fontId: GV.fontId, providerId: GV.providerId, stemWidthRatio: GV.stemWidthRatio,
    stoneSizeMm: 2.0, gapMm: 0.3, letterSpacingMm: 0, color: 'gold', canvasMm: CANVAS_MM,
    frameRect: { xMm: 0, yMm: 0, widthMm: frameMm, heightMm: frameMm },
    ...overrides
  };
}

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

const reported = (r) => Number(r.diagnostics.achievedStemStones.toFixed(3));

// ---------------------------------------------------------------------------
// 1. The MONO-017 non-monotone case is now monotone.
// ---------------------------------------------------------------------------

await test('1. equal-three A,K,L / Great Vibes / none / SS6 reports a strictly decreasing stem across 150 > 120 > 100 (0.470 / 0.376 / 0.309); the 0.591 uptick is gone', async () => {
  const series = [];
  for (const frameMm of [150, 120, 100]) {
    const { generator } = createRealGenerator();
    const result = await generator.generate(gvReq('equal-three', ['A', 'K', 'L'], frameMm));
    assert.equal(result.ok, false);
    assert.equal(result.reason, R.CHAIN_TOO_THIN);
    series.push({ frameMm, value: reported(result), letter: result.diagnostics.letter, msg: result.message });
  }
  for (const row of series) console.log(`    ${row.frameMm}x${row.frameMm}: letter "${row.letter}" at ${row.value}`);

  assert.deepEqual(series.map((r) => r.value), [0.470, 0.376, 0.309],
    'the reported stem figure at 150/120/100 -- MONO-017 sec 1a lists K as 0.470 / 0.376 / 0.310; toFixed(3) of the real 0.30946 is 0.309');
  for (let i = 1; i < series.length; i++) {
    assert.ok(series[i].value < series[i - 1].value, `must strictly decrease: ${series[i - 1].value} -> ${series[i].value}`);
  }
  assert.ok(series.every((r) => r.letter === 'K'), 'every size now reports the same binding letter K');
  assert.ok(!series.some((r) => /0\.591/.test(r.msg)), 'the develop 0.591 figure (letter A at 100x100) must no longer appear');
});

// ---------------------------------------------------------------------------
// 2. The reported letter is the minimum, not the first in slot order.
// ---------------------------------------------------------------------------

await test('2. equal-three A,K,L at 100x100: the message and diagnostics name K (slot 1), not the first sub-floor letter A (slot 0)', async () => {
  const { generator } = createRealGenerator();
  const result = await generator.generate(gvReq('equal-three', ['A', 'K', 'L'], 100));
  assert.equal(result.ok, false);
  assert.equal(result.reason, R.CHAIN_TOO_THIN);
  console.log(`    ${result.message}`);
  assert.equal(result.diagnostics.letter, 'K', 'diagnostics.letter is the binding letter');
  assert.equal(result.diagnostics.slotIndex, 1, 'diagnostics.slotIndex is the binding letter\'s slot');
  assert.match(result.message, /Letter "K" \(slot 1\)/, 'the message names the binding letter and its slot');
  assert.doesNotMatch(result.message, /Letter "A"/, 'develop named A (slot 0) here -- it must not anymore');
});

// ---------------------------------------------------------------------------
// 3. Negative control: when the first sub-floor letter IS the thinnest, the reported letter is
//    unchanged from develop. Without this, test 2 cannot tell "reports the minimum" apart from
//    "reports the last letter".
// ---------------------------------------------------------------------------

await test('3. negative control: equal-three K,A,L at 100x100 -- K (slot 0) is BOTH the first sub-floor letter and the thinnest; develop and MONO-018 both report K, and the last sub-floor letter L is not reported', async () => {
  const { generator } = createRealGenerator();
  const result = await generator.generate(gvReq('equal-three', ['K', 'A', 'L'], 100));
  assert.equal(result.ok, false);
  assert.equal(result.reason, R.CHAIN_TOO_THIN);
  const stems = result.diagnostics.allLetterStemStones;
  console.log(`    reported "${result.diagnostics.letter}" (slot ${result.diagnostics.slotIndex}); per-letter ${stems.map((s) => `${s.letter}:${s.achievedStemStones.toFixed(3)}`).join(' ')}`);
  // develop captured (develop @ 573c4e5): reports "K" slot 0 at 0.309 -- the first sub-floor letter.
  assert.equal(result.diagnostics.letter, 'K', 'MONO-018 reports K here, same as develop');
  assert.equal(result.diagnostics.slotIndex, 0);
  assert.equal(reported(result), 0.309);
  // All three letters are sub-floor here (K 0.309, A 0.591, L 0.539), and L is last in slot order.
  assert.ok(stems.every((s) => s.belowFloor), 'sanity: all three letters are sub-floor, so "reports the last letter" would name L');
  assert.notEqual(result.diagnostics.letter, 'L', 'so reporting K rather than L proves it is not "the last sub-floor letter"');
});

// ---------------------------------------------------------------------------
// 4. The all-letters diagnostics array.
// ---------------------------------------------------------------------------

await test('4. diagnostics.allLetterStemStones has one entry per letter in slot order, and its minimum equals the reported achievedStemStones', async () => {
  const { generator } = createRealGenerator();
  const result = await generator.generate(gvReq('equal-three', ['A', 'K', 'L'], 120));
  assert.equal(result.ok, false);
  const stems = result.diagnostics.allLetterStemStones;
  console.log(`    ${stems.map((s) => `${s.letter}(slot ${s.slotIndex}):${s.achievedStemStones.toFixed(3)} below=${s.belowFloor}`).join('  ')}`);
  assert.equal(stems.length, 3, 'one entry per letter');
  assert.deepEqual(stems.map((s) => s.letter), ['A', 'K', 'L'], 'in slot order');
  assert.deepEqual(stems.map((s) => s.slotIndex), [0, 1, 2], 'slotIndex ascending');
  const min = Math.min(...stems.map((s) => s.achievedStemStones));
  assert.equal(min, result.diagnostics.achievedStemStones, 'the array minimum is the reported figure');
});

// ---------------------------------------------------------------------------
// 5. The sub-floor count in the message.
// ---------------------------------------------------------------------------

await test('5. the message states the sub-floor count -- "1 of 2" for one sub-floor letter, "2 of 3" for two', async () => {
  const { generator: g1 } = createRealGenerator();
  const one = await g1.generate(gvReq('two-letter', ['A', 'K'], 120));
  assert.equal(one.reason, R.CHAIN_TOO_THIN);
  console.log(`    two-letter A,K @ 120: ${one.message}`);
  assert.match(one.message, /\b1 of 2 letters fall below\b/);
  assert.equal(one.diagnostics.allLetterStemStones.filter((s) => s.belowFloor).length, 1);

  const { generator: g2 } = createRealGenerator();
  const two = await g2.generate(gvReq('equal-three', ['A', 'K', 'L'], 120));
  assert.equal(two.reason, R.CHAIN_TOO_THIN);
  console.log(`    equal-three A,K,L @ 120: ${two.message}`);
  assert.match(two.message, /\b2 of 3 letters fall below\b/);
  assert.equal(two.diagnostics.allLetterStemStones.filter((s) => s.belowFloor).length, 2);
});

// ---------------------------------------------------------------------------
// 6. Other in-loop failures still fail fast -- only CHAIN_TOO_THIN defers.
// ---------------------------------------------------------------------------

await test('6. a FITTING_FAILED letter (slot 1) returns immediately -- later letters are never fitted, unlike the deferred CHAIN_TOO_THIN gate', async () => {
  // A space produces no stones -> FITTING_FAILED inside the loop at slot 1.
  const failFactory = createRealGenerator();
  const result = await failFactory.generator.generate(gvReq('equal-three', ['A', ' ', 'L'], 120));
  assert.equal(result.ok, false);
  assert.equal(result.reason, R.FITTING_FAILED, 'the space fails fast; it does not defer like CHAIN_TOO_THIN');
  assert.equal(result.diagnostics, null, 'a fail-fast failure carries no allLetterStemStones array');

  // detect probe (1) + slot-0 "A" fit (1) + slot-1 space (1) ~= 3. A full three-letter equal-three
  // fit makes many more engine calls, so slot 2 "L" was demonstrably never reached.
  console.log(`    engine calls to FITTING_FAILED: ${failFactory.engineCalls}`);
  assert.ok(failFactory.engineCalls <= 4, `fail-fast: expected <=4 engine calls, got ${failFactory.engineCalls}`);

  const fullFactory = createRealGenerator();
  await fullFactory.generator.generate(gvReq('equal-three', ['A', 'K', 'L'], 120));
  console.log(`    engine calls for the full three-letter fit: ${fullFactory.engineCalls}`);
  assert.ok(fullFactory.engineCalls > failFactory.engineCalls + 3,
    'the full fit makes many more calls than the fail-fast path -- slot 2 was skipped');
});

// ---------------------------------------------------------------------------
// 7. Success path unchanged -- byte-identical layers to develop @ 573c4e5.
// ---------------------------------------------------------------------------

const DEVELOP_SUCCESS_LAYERS_JSON = "[{\"id\":\"monogram-none-two-letter-letter-0\",\"type\":\"text\",\"visible\":true,\"text\":\"A\",\"font\":\"dancing-script-regular\",\"height\":61.15107913669064,\"heightMode\":\"raw\",\"textMode\":\"stroke\",\"stoneSize\":3,\"gap\":0.3,\"color\":\"gold\",\"autoFit\":false,\"curveEnabled\":false,\"curveRadiusMm\":40,\"curveDirection\":\"outside\",\"curveStartAngleDeg\":0,\"curveSweepAngleDeg\":180,\"curveAlignment\":\"center\",\"align\":\"left\",\"lineSpacing\":1,\"rotationDeg\":0,\"x\":-70,\"y\":-55},{\"id\":\"monogram-none-two-letter-letter-1\",\"type\":\"text\",\"visible\":true,\"text\":\"V\",\"font\":\"dancing-script-regular\",\"height\":61.15107913669064,\"heightMode\":\"raw\",\"textMode\":\"stroke\",\"stoneSize\":3,\"gap\":0.3,\"color\":\"gold\",\"autoFit\":false,\"curveEnabled\":false,\"curveRadiusMm\":40,\"curveDirection\":\"outside\",\"curveStartAngleDeg\":0,\"curveSweepAngleDeg\":180,\"curveAlignment\":\"center\",\"align\":\"left\",\"lineSpacing\":1,\"rotationDeg\":0,\"x\":-10,\"y\":-55}]";
// develop @ 573c4e5: totalStoneCount 123; A -> 60 stones, V -> 63 stones, both stemStones 0.85.
const DEVELOP_SUCCESS_FIRST3 = {
  'monogram-none-two-letter-letter-0': [
    { xMm: 1.039568, yMm: 5.320144, sizeMm: 3 },
    { xMm: -0.949515, yMm: 2.813389, sizeMm: 3 },
    { xMm: -0.562387, yMm: -0.436776, sizeMm: 3 }
  ],
  'monogram-none-two-letter-letter-1': [
    { xMm: 12.841727, yMm: 5.320144, sizeMm: 3 },
    { xMm: 9.682613, yMm: 4.445028, sizeMm: 3 },
    { xMm: 7.735495, yMm: 1.885898, sizeMm: 3 }
  ]
};

await test('7. a passing monogram (Dancing Script / two-letter / none) emits byte-identical layers to develop; counts and first three re-rendered stone records printed for both sides', async () => {
  const { generator, geometryEngine } = createRealGenerator();
  const request = {
    frameId: 'none', layoutId: 'two-letter', letters: ['A', 'V'],
    fontId: 'dancing-script-regular', providerId: 'opentype', stemWidthRatio: 0.0417,
    stoneSizeMm: 3.0, gapMm: 0.3, letterSpacingMm: 0, color: 'gold',
    canvasMm: { widthMm: 200, heightMm: 200 }, frameRect: { xMm: 0, yMm: 0, widthMm: 120, heightMm: 90 }
  };
  const result = await generator.generate(request);
  assert.equal(result.ok, true, `expected success: ${result.message}`);

  console.log(`    develop: totalStoneCount 123; letters A:60 V:63`);
  console.log(`    now    : totalStoneCount ${result.measurements.totalStoneCount}; letters ${result.measurements.letters.map((l) => `${l.letter}:${l.stoneCount}`).join(' ')}`);
  assert.equal(JSON.stringify(result.layers), DEVELOP_SUCCESS_LAYERS_JSON, 'emitted layer objects are byte-identical to develop');
  assert.equal(result.measurements.totalStoneCount, 123);

  for (const layer of result.layers) {
    const rerender = await geometryEngine.generateTextLayout({
      text: layer.text, fontId: layer.font, providerId: 'opentype', layerId: layer.id,
      heightMm: layer.height, stoneSizeMm: layer.stoneSize, gapMm: layer.gap, mode: 'outline',
      color: layer.color, curveEnabled: false
    });
    const first3 = rerender.stones.slice(0, 3).map((s) => ({
      xMm: Number(s.xMm.toFixed(6)), yMm: Number(s.yMm.toFixed(6)), sizeMm: s.sizeMm
    }));
    console.log(`    develop ${layer.id}: ${JSON.stringify(DEVELOP_SUCCESS_FIRST3[layer.id])}`);
    console.log(`    now     ${layer.id}: ${JSON.stringify(first3)}`);
    assert.deepEqual(first3, DEVELOP_SUCCESS_FIRST3[layer.id], `${layer.id} first three stone records match develop`);
  }
});

if (process.exitCode) {
  console.error('\nMONO-018 binding-letter tests FAILED.');
} else {
  console.log('\nAll MONO-018 binding-letter tests passed.');
}
