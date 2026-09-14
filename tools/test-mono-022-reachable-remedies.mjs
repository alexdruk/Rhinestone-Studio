// MONO-022 -- Reachable remedies in the CHAIN_TOO_THIN message.
//
// Both CHAIN_TOO_THIN sites (MonogramGenerator.js's per-letter branch and _generateScriptMonogram())
// used to close with the same fixed sentence regardless of whether a given remedy could actually
// help in the failing request: "a larger frame" when the frame was already at its own
// scalingLimitsMm cap, "a smaller stone size" when SS6 (2.0 mm, the smallest StoneSizes.js rung) was
// already in use, "less letter spacing" when it was already 0. Worse, the one remedy that reliably
// does work -- removing the frame -- was never offered at all, even though for the reproduction case
// below it is the largest single gain of the five (0 -> 365 stones, per docs/specifications, MONO-022
// task brief).
//
// buildChainTooThinRemedies()/formatChainTooThinRemedyClause() (MonogramGenerator.js, both private)
// are exercised here only through generate()'s public surface, same convention as every other
// CHAIN_TOO_THIN test in this repo (test-mono-012/013/016/018) -- there is no exported hook to call
// them directly, and the message text IS the product surface.
//
// MONO-022 correction round: `diagnostics.remedies` -- the kebab-case remedy codes
// (`docs/specifications/MONO-022-ReachableRemedies.md`'s "remedies diagnostics contract") -- was
// added so callers (and tests) can assert the reachable set directly instead of regex-matching
// prose. It is generated from the same list `formatChainTooThinRemedyClause()` renders, so the
// codes and the sentence can never drift apart. Every other diagnostics field is unchanged from the
// original MONO-022 landing (`ca1525e`) -- see test 4's BASELINE_* comparison.
//
// Real repository fonts + frames, same bootstrap as tools/test-mono-013-interlock.mjs.
// Baseline (pre-MONO-022, develop @ d0e4bfb) reason/diagnostics captured via `git stash` for both
// call sites -- see BASELINE_* below.

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
  return { geometryEngine, generator: new MonogramGenerator({ geometryEngine }) };
}

const CANVAS_MM = { widthMm: 200, heightMm: 200 };
const R = MONOGRAM_GENERATOR_FAILURE_REASONS;
const GV = { fontId: 'great-vibes-regular', providerId: 'opentype', stemWidthRatio: 0.0357 };

function scriptReq(over = {}) {
  return {
    frameId: 'circle', layoutId: 'script', letters: ['Q', 'W', 'E'],
    fontId: GV.fontId, providerId: GV.providerId, stemWidthRatio: GV.stemWidthRatio,
    stoneSizeMm: 2.0, gapMm: 0.3, letterSpacingMm: 0, color: 'gold', canvasMm: CANVAS_MM,
    frameRect: { xMm: 0, yMm: 0, widthMm: 150, heightMm: 150 },
    ...over
  };
}

function perLetterReq(over = {}) {
  return {
    frameId: 'circle', layoutId: 'equal-three', letters: ['A', 'K', 'L'],
    fontId: GV.fontId, providerId: GV.providerId, stemWidthRatio: GV.stemWidthRatio,
    stoneSizeMm: 2.0, gapMm: 0.3, letterSpacingMm: 0, color: 'gold', canvasMm: CANVAS_MM,
    frameRect: { xMm: 0, yMm: 0, widthMm: 150, heightMm: 150 },
    ...over
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

// ---------------------------------------------------------------------------
// 1. "Remove the frame" appears when there is a frame, and is absent when there isn't.
// ---------------------------------------------------------------------------

await test('1. script branch: "remove the frame" appears for frameId "circle", absent for frameId "none" (same letters/size/spacing, both a real CHAIN_TOO_THIN)', async () => {
  const { generator: g1 } = createRealGenerator();
  const withFrame = await g1.generate(scriptReq());
  assert.equal(withFrame.reason, R.CHAIN_TOO_THIN);
  console.log(`    circle: ${withFrame.message}`);
  assert.match(withFrame.message, /Remove the frame/, 'a frame is present -- "remove the frame" must be offered');

  const { generator: g2 } = createRealGenerator();
  const withoutFrame = await g2.generate(scriptReq({ frameId: 'none', frameRect: { xMm: 0, yMm: 0, widthMm: 40, heightMm: 40 } }));
  assert.equal(withoutFrame.reason, R.CHAIN_TOO_THIN, 'control must still be a real CHAIN_TOO_THIN, not some other failure');
  console.log(`    none:   ${withoutFrame.message}`);
  assert.doesNotMatch(withoutFrame.message, /[Rr]emove the frame/, 'frameId "none" has no frame to remove -- must be absent');
});

await test('1b. per-letter branch: same control, "remove the frame" present for "circle" and absent for "none"', async () => {
  const { generator: g1 } = createRealGenerator();
  const withFrame = await g1.generate(perLetterReq());
  assert.equal(withFrame.reason, R.CHAIN_TOO_THIN);
  console.log(`    circle: ${withFrame.message}`);
  assert.match(withFrame.message, /Remove the frame/);

  const { generator: g2 } = createRealGenerator();
  const withoutFrame = await g2.generate(perLetterReq({ frameId: 'none', frameRect: { xMm: 0, yMm: 0, widthMm: 100, heightMm: 100 } }));
  assert.equal(withoutFrame.reason, R.CHAIN_TOO_THIN);
  console.log(`    none:   ${withoutFrame.message}`);
  assert.doesNotMatch(withoutFrame.message, /[Rr]emove the frame/);
});

// ---------------------------------------------------------------------------
// 2. Unreachable remedies are dropped.
// ---------------------------------------------------------------------------

await test('2. at SS6 with the circle at its 150 mm cap and letter spacing 0: "smaller stone size", "larger frame" and "less letter spacing" are all absent; control at SS16/120 mm/spacing 1 mm: all three present', async () => {
  const { generator: g1 } = createRealGenerator();
  const atCap = await g1.generate(scriptReq()); // SS6 (2.0mm), circle @ 150x150 (its own cap), letterSpacingMm 0
  assert.equal(atCap.reason, R.CHAIN_TOO_THIN);
  console.log(`    at cap:  ${atCap.message}`);
  assert.doesNotMatch(atCap.message, /smaller stone size/, 'SS6 is already the smallest catalog rung');
  assert.doesNotMatch(atCap.message, /larger frame/, 'the circle is already at its own 150 mm scalingLimitsMm cap');
  assert.doesNotMatch(atCap.message, /less letter spacing/, 'letter spacing is already 0');
  // still reachable here: removing the frame, and fewer letters (3 > 1) -- sanity that the message
  // isn't just empty/degenerate.
  assert.match(atCap.message, /Remove the frame/);
  assert.match(atCap.message, /fewer letters/);

  const { generator: g2 } = createRealGenerator();
  const control = await g2.generate(scriptReq({
    stoneSizeMm: 4.0, // SS16 -- SS6/SS10 are both smaller rungs
    letterSpacingMm: 1, // > 0
    frameRect: { xMm: 0, yMm: 0, widthMm: 120, heightMm: 120 } // < the circle's 150 mm cap
  }));
  assert.equal(control.reason, R.CHAIN_TOO_THIN, 'control must still be a real CHAIN_TOO_THIN');
  console.log(`    control: ${control.message}`);
  assert.match(control.message, /smaller stone size/, 'SS16 has smaller rungs (SS6, SS10) below it');
  assert.match(control.message, /larger frame/, '120 mm < the circle\'s 150 mm cap');
  assert.match(control.message, /less letter spacing/, 'letter spacing is 1 mm here, > 0');
});

// ---------------------------------------------------------------------------
// 3. The per-frame cap is read, not assumed.
// ---------------------------------------------------------------------------

await test('3. the oval (FrameLibrary.js:173, maxWidthMm 180) sized to 150 mm width offers "a larger frame" (150 < 180); the circle (COMMON_SCALING_LIMITS_MM, maxWidthMm 150) at the same 150 mm width does not (150 is not < 150) -- proves the cap comes from the selected frame, not a hardcoded 150', async () => {
  const { generator: g1 } = createRealGenerator();
  const oval = await g1.generate(scriptReq({ frameId: 'oval', frameRect: { xMm: 0, yMm: 0, widthMm: 150, heightMm: 120 } }));
  assert.equal(oval.reason, R.CHAIN_TOO_THIN);
  console.log(`    oval (cap 180):   ${oval.message}`);
  assert.match(oval.message, /larger frame/, 'the oval\'s own cap is 180 mm; 150 mm is still below it');

  const { generator: g2 } = createRealGenerator();
  const circle = await g2.generate(scriptReq()); // circle @ 150x150, its own cap
  assert.equal(circle.reason, R.CHAIN_TOO_THIN);
  console.log(`    circle (cap 150): ${circle.message}`);
  assert.doesNotMatch(circle.message, /larger frame/, 'the circle\'s own cap is 150 mm; already there');
});

// ---------------------------------------------------------------------------
// 4. `reason` and every pre-existing diagnostics field are byte-identical to develop; the only
//    structured addition is `diagnostics.remedies` (added in the MONO-022 correction round below --
//    see docs/specifications/MONO-022-ReachableRemedies.md), asserted separately.
// ---------------------------------------------------------------------------

// Captured via `git stash` against develop @ d0e4bfb (pre-MONO-022 MonogramGenerator.js) for both
// call sites, using the exact requests scriptReq()/perLetterReq() build above. These are every field
// MonogramGenerator.js emitted before MONO-022; `remedies` did not exist yet.
const BASELINE_SCRIPT_REASON = 'chain-too-thin';
const BASELINE_SCRIPT_DIAGNOSTICS = {
  string: 'QWE', achievedStemStones: 0.679105894192281, minChainStones: 0.7,
  fittedHeightMm: 38.04514813402134, stoneSizeMm: 2, stemWidthRatio: 0.0357,
  boundThatBound: 'single-chain-minimum'
};
const BASELINE_PERLETTER_REASON = 'chain-too-thin';
const BASELINE_PERLETTER_DIAGNOSTICS = {
  letter: 'K', slotIndex: 1, achievedStemStones: 0.36441511942414223, minChainStones: 0.7,
  fittedHeightMm: 20.41541285289312, stoneSizeMm: 2, stemWidthRatio: 0.0357,
  boundThatBound: 'single-chain-minimum',
  allLetterStemStones: [
    { letter: 'A', slotIndex: 0, achievedStemStones: 0.6370703819763289, belowFloor: true },
    { letter: 'K', slotIndex: 1, achievedStemStones: 0.36441511942414223, belowFloor: true },
    { letter: 'L', slotIndex: 2, achievedStemStones: 0.4859978761666227, belowFloor: true }
  ]
};
// Both scriptReq() and perLetterReq() are circle / SS6 / spacing-0 / 3-letter requests: 'remove-frame'
// (a frame is present) and 'fewer-letters' (3 > 1) reachable; 'smaller-stone-size' (SS6 is already
// smallest), 'larger-frame' (the circle is already at its 150 mm cap) and 'less-letter-spacing'
// (spacing is already 0) are not.
const EXPECTED_REMEDIES = ['remove-frame', 'fewer-letters'];

await test('4a. script branch: every pre-MONO-022 diagnostics field is byte-identical to develop; `remedies` is the one addition', async () => {
  const { generator } = createRealGenerator();
  const result = await generator.generate(scriptReq());
  console.log(`    baseline reason: ${BASELINE_SCRIPT_REASON}`);
  console.log(`    now      reason: ${result.reason}`);
  assert.equal(result.reason, BASELINE_SCRIPT_REASON);
  const { remedies, ...withoutRemedies } = result.diagnostics;
  console.log(`    baseline diagnostics: ${JSON.stringify(BASELINE_SCRIPT_DIAGNOSTICS)}`);
  console.log(`    now (minus remedies): ${JSON.stringify(withoutRemedies)}`);
  assert.deepEqual(withoutRemedies, BASELINE_SCRIPT_DIAGNOSTICS);
  console.log(`    expected remedies: ${JSON.stringify(EXPECTED_REMEDIES)}`);
  console.log(`    actual   remedies: ${JSON.stringify(remedies)}`);
  assert.deepEqual(remedies, EXPECTED_REMEDIES);
});

await test('4b. per-letter branch: every pre-MONO-022 diagnostics field is byte-identical to develop; `remedies` is the one addition', async () => {
  const { generator } = createRealGenerator();
  const result = await generator.generate(perLetterReq());
  console.log(`    baseline reason: ${BASELINE_PERLETTER_REASON}`);
  console.log(`    now      reason: ${result.reason}`);
  assert.equal(result.reason, BASELINE_PERLETTER_REASON);
  const { remedies, ...withoutRemedies } = result.diagnostics;
  console.log(`    baseline diagnostics: ${JSON.stringify(BASELINE_PERLETTER_DIAGNOSTICS)}`);
  console.log(`    now (minus remedies): ${JSON.stringify(withoutRemedies)}`);
  assert.deepEqual(withoutRemedies, BASELINE_PERLETTER_DIAGNOSTICS);
  console.log(`    expected remedies: ${JSON.stringify(EXPECTED_REMEDIES)}`);
  console.log(`    actual   remedies: ${JSON.stringify(remedies)}`);
  assert.deepEqual(remedies, EXPECTED_REMEDIES);
});

// ---------------------------------------------------------------------------
// 5. The exact three-initial message a customer reads (the task's own reproduction case).
// ---------------------------------------------------------------------------

await test('5. the "QWE" / Great Vibes / circle / SS6 / 150 mm reproduction case reads the final message', async () => {
  const { generator } = createRealGenerator();
  const result = await generator.generate(scriptReq());
  assert.equal(result.reason, R.CHAIN_TOO_THIN);
  console.log(`    ${result.message}`);
});

if (process.exitCode) {
  console.error('\nMONO-022 reachable-remedies tests FAILED.');
} else {
  console.log('\nAll MONO-022 reachable-remedies tests passed.');
}
