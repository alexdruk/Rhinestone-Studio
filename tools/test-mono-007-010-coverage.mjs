// MONO-007/008/009/010 coverage gap-fill.
//
// tools/test-mono-010-frame-stone-width-spacing.mjs (M2) exercises resolveFrameForStoneWidth()'s
// success path (both stoneWidth:1/2, real geometry, row-offset spacing correctness) and
// tools/test-mono-011-frame-stone-autoshrink.mjs (M4) exercises app.js's UI-layer auto-shrink retry
// loop built on top of a STONE_WIDTH_UNAVAILABLE/FRAME_COLLISION failure -- but neither ever drives
// resolveFrameForStoneWidth() itself into its 'frame-too-small' failure branch, nor asserts that
// MonogramGenerator.generate() surfaces STONE_WIDTH_UNAVAILABLE for it directly (M4 only reaches
// FRAME_COLLISION in its own fixtures). This file fills exactly that gap, plus:
//   - MONO-010's frameOptions.stoneSizeMm/color fallback-vs-override semantics (four cases) and its
//     frameOptions.stoneSizeMm input validation (a fifth), none of which test-mono-010's own file
//     (scoped narrowly to outline row-offset spacing) asserts on.
//   - MONO-007/008's Octagon/Pentagon/Shield frames, which test-frame-library.mjs's own
//     GEOMETRIC_FRAME_IDS loops already cover geometrically, but which no generate()-level happy-path
//     test exercises yet (test-mono-005's real-frame success fixtures use only square/rounded-square/
//     oval).
//
// MONO-009's computeMonogramDefaultSizeMm() (app.js) is DOM/global-state-bound (currentObjectTemplate(),
// project.canvas, el()) -- deliberately NOT covered here. Building a fake DOM harness for it would
// duplicate app.js's own global wiring rather than testing real behavior; see this file's own doc
// comment as the recorded gap until a real integration-test harness exists for app.js's DOM-bound
// helpers.

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FontManager } from '../src/fonts/index.js';
import { createDefaultFontProviderRegistry } from '../src/text/index.js';
import { GeometryEngine, StoneLayout, DEFAULT_STONE_COLOR } from '../src/geometry/index.js';
import { getFrameDefinition, listFrames, resolveFrameForStoneWidth } from '../src/geometry/FrameLibrary.js';
import { MonogramGenerator, MONOGRAM_GENERATOR_FAILURE_REASONS } from '../src/monogram/index.js';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const manifest = JSON.parse(await readFile(path.join(repoRoot, 'assets/fonts/manifest.json'), 'utf8'));
const fontManager = new FontManager(manifest);

async function loadFontBufferFromRepoRoot(relativePath) {
  const buffer = await readFile(path.join(repoRoot, relativePath));
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
}

function createRealGenerator() {
  const fontProviderRegistry = createDefaultFontProviderRegistry(fontManager, {
    loadFontBuffer: loadFontBufferFromRepoRoot
  });
  const geometryEngine = new GeometryEngine({ fontProviderRegistry });
  return { geometryEngine, generator: new MonogramGenerator({ geometryEngine }) };
}

// A minimal, never-actually-invoked fake, only to satisfy MonogramGenerator's constructor type
// check -- used for the STONE_WIDTH_UNAVAILABLE surfacing test below, which fails inside generate()
// before any letter is generated (see MonogramGenerator.generate()'s own step ordering: frameOptions.
// stoneWidth resolution happens before letter generation), so a real font engine would be needless
// weight.
function createUnusedFakeGenerator() {
  const geometryEngine = {
    async generateTextLayout() { throw new Error('should not be called'); },
    scaleAuthoredTextLayout() { throw new Error('should not be called'); },
    generatePathLayout() { throw new Error('should not be called'); }
  };
  return new MonogramGenerator({ geometryEngine });
}

const RS_BLOCK = { fontId: 'rs-block', providerId: 'rhinestone' };
const CANVAS_MM = { widthMm: 200, heightMm: 200 };

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

// --- 1. resolveFrameForStoneWidth()'s 'frame-too-small' path -------------------------------------
//
// avgScaleMmPerUnit (== outerRadiusMm) for a boxWidthMm x boxHeightMm box is
// (boxWidthMm/2 + boxHeightMm/2) / 2 -- for a 20x20 box that's exactly 10mm (see
// FrameLibrary.js's own resolveFrameForStoneWidth() doc comment). MIN_STONE_WIDTH_RATIO is 0.1.
//   stoneWidth 2: innerRatio = (outerRadiusMm - spacingMm) / outerRadiusMm; crosses below 0.1 once
//     spacingMm > 0.9 * outerRadiusMm (9mm here) -- 9.5mm spacing gives innerRatio 0.05.
//   stoneWidth 1: midRatio = (outerRadiusMm - spacingMm/2) / outerRadiusMm; crosses below 0.1 once
//     spacingMm > 1.8 * outerRadiusMm (18mm here) -- 19mm spacing gives midRatio 0.05.
const TOO_SMALL_BOX = { widthMm: 20, heightMm: 20 };

await test('resolveFrameForStoneWidth(): stoneWidth 2 returns frame-too-small once innerRatio drops below MIN_STONE_WIDTH_RATIO', () => {
  const frame = getFrameDefinition('circle');
  const result = resolveFrameForStoneWidth(frame, 2, 9.5, TOO_SMALL_BOX.widthMm, TOO_SMALL_BOX.heightMm);
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'frame-too-small');
  assert.equal(typeof result.message, 'string');
  assert.ok(result.message.includes(frame.label), 'message should name the frame');
  assert.ok(result.message.includes('2-stone-wide'), 'message should name the requested stone width');
});

await test('resolveFrameForStoneWidth(): stoneWidth 1 returns frame-too-small once midRatio drops below MIN_STONE_WIDTH_RATIO', () => {
  const frame = getFrameDefinition('circle');
  const result = resolveFrameForStoneWidth(frame, 1, 19, TOO_SMALL_BOX.widthMm, TOO_SMALL_BOX.heightMm);
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'frame-too-small');
  assert.ok(result.message.includes(frame.label), 'message should name the frame');
  assert.ok(result.message.includes('1-stone-wide'), 'message should name the requested stone width');
});

await test('resolveFrameForStoneWidth(): the same box/frame just below the too-small spacing threshold still succeeds (proves the boundary, not a permanently-broken box)', () => {
  const frame = getFrameDefinition('circle');
  // 8mm spacing on the same 20x20 box -> innerRatio = (10-8)/10 = 0.2, comfortably above 0.1.
  const twoRow = resolveFrameForStoneWidth(frame, 2, 8, TOO_SMALL_BOX.widthMm, TOO_SMALL_BOX.heightMm);
  assert.equal(twoRow.ok, true, twoRow.message);
  // 16mm spacing -> midRatio = (10-8)/10 = 0.2, comfortably above 0.1.
  const oneRow = resolveFrameForStoneWidth(frame, 1, 16, TOO_SMALL_BOX.widthMm, TOO_SMALL_BOX.heightMm);
  assert.equal(oneRow.ok, true, oneRow.message);
});

await test('resolveFrameForStoneWidth(): frame-too-small is reachable for a non-circular hollow frame too (square)', () => {
  const frame = getFrameDefinition('square');
  const result = resolveFrameForStoneWidth(frame, 2, 9.5, TOO_SMALL_BOX.widthMm, TOO_SMALL_BOX.heightMm);
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'frame-too-small');
  assert.ok(result.message.includes('Square'));
});

// --- 2. MonogramGenerator.generate() surfaces STONE_WIDTH_UNAVAILABLE verbatim ------------------

await test('generate() surfaces STONE_WIDTH_UNAVAILABLE with the exact resolveFrameForStoneWidth() message when the frame cannot trace the requested stoneWidth', async () => {
  const generator = createUnusedFakeGenerator();
  const frameRect = { xMm: 40, yMm: 40, widthMm: TOO_SMALL_BOX.widthMm, heightMm: TOO_SMALL_BOX.heightMm };
  // stoneSizeMm + gapMm = 9.5, matching the direct frame-too-small case above for stoneWidth 2.
  const result = await generator.generate({
    frameId: 'circle', layoutId: 'single', letters: ['A'], ...RS_BLOCK,
    stoneSizeMm: 9.2, gapMm: 0.3, color: 'gold',
    frameRect, canvasMm: CANVAS_MM,
    frameOptions: { stoneWidth: 2 }
  });

  assert.equal(result.ok, false);
  assert.equal(result.reason, MONOGRAM_GENERATOR_FAILURE_REASONS.STONE_WIDTH_UNAVAILABLE);
  assert.equal(result.layers, null);

  const frame = getFrameDefinition('circle');
  const direct = resolveFrameForStoneWidth(frame, 2, 9.5, frameRect.widthMm, frameRect.heightMm);
  assert.equal(direct.ok, false);
  assert.equal(result.message, direct.message, 'generate() must forward resolveFrameForStoneWidth()\'s own message verbatim, not reword it');
});

await test('generate() surfaces STONE_WIDTH_UNAVAILABLE using the frame\'s own stoneSizeMm (frameOptions.stoneSizeMm), not the letters\' stoneSizeMm, when they differ', async () => {
  const generator = createUnusedFakeGenerator();
  const frameRect = { xMm: 40, yMm: 40, widthMm: TOO_SMALL_BOX.widthMm, heightMm: TOO_SMALL_BOX.heightMm };
  // Letters' own stoneSizeMm (1.0) would NOT trigger frame-too-small at stoneWidth 1 (spacing 1.3
  // is far below the 18mm threshold) -- only the frame's own, larger frameOptions.stoneSizeMm
  // (18.7) does, at spacing 18.7+0.3=19, matching the direct too-small case above for stoneWidth 1.
  const result = await generator.generate({
    frameId: 'circle', layoutId: 'single', letters: ['A'], ...RS_BLOCK,
    stoneSizeMm: 1.0, gapMm: 0.3, color: 'gold',
    frameRect, canvasMm: CANVAS_MM,
    frameOptions: { stoneWidth: 1, stoneSizeMm: 18.7 }
  });

  assert.equal(result.ok, false);
  assert.equal(result.reason, MONOGRAM_GENERATOR_FAILURE_REASONS.STONE_WIDTH_UNAVAILABLE);
});

// --- 3. frameOptions.stoneSizeMm / frameOptions.color fallback-vs-override semantics -------------

await test('frameOptions.stoneSizeMm omitted falls back to the shared stoneSizeMm exactly', async () => {
  const { generator } = createRealGenerator();
  const result = await generator.generate({
    frameId: 'square', layoutId: 'single', letters: ['A'], ...RS_BLOCK,
    stoneSizeMm: 2.8, color: 'gold', canvasMm: CANVAS_MM,
    frameRect: { xMm: 0, yMm: 0, widthMm: 80, heightMm: 80 }
    // frameOptions omitted entirely.
  });
  assert.equal(result.ok, true, result.message);
  const frameLayer = result.layers.find((l) => l.type === 'path');
  assert.equal(frameLayer.stoneSize, 2.8);
});

await test('frameOptions.stoneSizeMm, when provided, overrides the shared stoneSizeMm for the frame only', async () => {
  const { generator } = createRealGenerator();
  const result = await generator.generate({
    frameId: 'square', layoutId: 'single', letters: ['A'], ...RS_BLOCK,
    stoneSizeMm: 2.8, color: 'gold', canvasMm: CANVAS_MM,
    frameRect: { xMm: 0, yMm: 0, widthMm: 80, heightMm: 80 },
    frameOptions: { stoneSizeMm: 4.7 }
  });
  assert.equal(result.ok, true, result.message);
  const frameLayer = result.layers.find((l) => l.type === 'path');
  const letterLayer = result.layers.find((l) => l.type === 'text');
  assert.equal(frameLayer.stoneSize, 4.7);
  assert.equal(letterLayer.stoneSize, 2.8, 'the letters\' own stone size must be unaffected by frameOptions.stoneSizeMm');
});

await test('frameOptions.color omitted falls back to the resolved (top-level) color', async () => {
  const { generator } = createRealGenerator();
  const result = await generator.generate({
    frameId: 'square', layoutId: 'single', letters: ['A'], ...RS_BLOCK,
    stoneSizeMm: 2.8, color: 'gold', canvasMm: CANVAS_MM,
    frameRect: { xMm: 0, yMm: 0, widthMm: 80, heightMm: 80 },
    frameOptions: {}
  });
  assert.equal(result.ok, true, result.message);
  const frameLayer = result.layers.find((l) => l.type === 'path');
  assert.equal(frameLayer.color, 'gold');
});

await test('color entirely omitted (top-level) falls back to DEFAULT_STONE_COLOR, which the frame then also inherits', async () => {
  const { generator } = createRealGenerator();
  const result = await generator.generate({
    frameId: 'square', layoutId: 'single', letters: ['A'], ...RS_BLOCK,
    stoneSizeMm: 2.8, canvasMm: CANVAS_MM,
    frameRect: { xMm: 0, yMm: 0, widthMm: 80, heightMm: 80 }
    // color and frameOptions both omitted.
  });
  assert.equal(result.ok, true, result.message);
  const frameLayer = result.layers.find((l) => l.type === 'path');
  const letterLayer = result.layers.find((l) => l.type === 'text');
  assert.equal(letterLayer.color, DEFAULT_STONE_COLOR);
  assert.equal(frameLayer.color, DEFAULT_STONE_COLOR);
});

await test('frameOptions.color, when provided, overrides the resolved color for the frame only', async () => {
  const { generator } = createRealGenerator();
  const result = await generator.generate({
    frameId: 'square', layoutId: 'single', letters: ['A'], ...RS_BLOCK,
    stoneSizeMm: 2.8, color: 'gold', canvasMm: CANVAS_MM,
    frameRect: { xMm: 0, yMm: 0, widthMm: 80, heightMm: 80 },
    frameOptions: { color: 'jet' }
  });
  assert.equal(result.ok, true, result.message);
  const frameLayer = result.layers.find((l) => l.type === 'path');
  const letterLayer = result.layers.find((l) => l.type === 'text');
  assert.equal(frameLayer.color, 'jet');
  assert.equal(letterLayer.color, 'gold', 'the letters\' own color must be unaffected by frameOptions.color');
});

await test('an invalid frameOptions.stoneSizeMm returns INVALID_INPUT with the exact existing validation message', async () => {
  const { generator } = createRealGenerator();
  const base = {
    frameId: 'square', layoutId: 'single', letters: ['A'], ...RS_BLOCK,
    stoneSizeMm: 2.8, color: 'gold', canvasMm: CANVAS_MM,
    frameRect: { xMm: 0, yMm: 0, widthMm: 80, heightMm: 80 }
  };
  const EXPECTED_MESSAGE = 'frameOptions.stoneSizeMm must be a positive finite number when provided.';
  const invalidValues = [-1, 0, NaN, Infinity, '2.8'];

  for (const stoneSizeMm of invalidValues) {
    const result = await generator.generate({ ...base, frameOptions: { stoneSizeMm } });
    assert.equal(result.ok, false, `expected failure for frameOptions.stoneSizeMm=${stoneSizeMm}`);
    assert.equal(result.reason, MONOGRAM_GENERATOR_FAILURE_REASONS.INVALID_INPUT);
    assert.equal(result.message, EXPECTED_MESSAGE);
  }
});

// --- 4. MONO-007/008 Octagon/Pentagon/Shield: at least one generate() happy path per new frame id -

for (const frameId of ['octagon', 'pentagon', 'shield']) {
  await test(`${frameId}: is registered in FrameLibrary and generate() succeeds with stones and no collisions at a reasonable default size`, async () => {
    assert.ok(listFrames().some((f) => f.id === frameId), `${frameId} must be listed by listFrames()`);
    const frame = getFrameDefinition(frameId);
    assert.equal(frame.id, frameId);
    assert.equal(frame.hollow, true);

    const { generator } = createRealGenerator();
    const result = await generator.generate({
      frameId, layoutId: 'single', letters: ['A'], ...RS_BLOCK,
      stoneSizeMm: 2.8, color: 'gold', canvasMm: CANVAS_MM,
      frameRect: { xMm: 0, yMm: 0, widthMm: 90, heightMm: 90 }
    });

    // ok:true already implies no letter/frame collision was detected (both are structured failures
    // that would set ok:false -- see MONOGRAM_GENERATOR_FAILURE_REASONS.LETTER_COLLISION/
    // FRAME_COLLISION), so a bare success assertion here is sufficient proof of "no collisions".
    assert.equal(result.ok, true, result.message);
    assert.ok(result.measurements.frameStoneCount > 0, `${frameId}: expected the frame's own border to produce stones`);
    assert.ok(result.measurements.totalStoneCount > result.measurements.frameStoneCount, `${frameId}: expected the letter to also produce stones`);
  });
}

if (process.exitCode === 1) {
  console.error('\nSome MONO-007/008/010 coverage tests failed.');
} else {
  console.log('\nAll MONO-007/008/010 coverage tests passed.');
}
