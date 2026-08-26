// fix/mono-outline-frame-stone-spacing: MONO-010's independent frame stone size
// (frameOptions.stoneSizeMm) was introduced *after* MonogramGenerator.generate() already called
// FrameLibrary's resolveFrameForStoneWidth() to trace the outline's two rows -- that call was still
// passing the letters' own requiredSpacingMm as the row-offset distance, not the frame's own
// frameRequiredSpacingMm. When the frame's stone size is larger than the letters', the two outline
// rows ended up offset by too small a pitch, and StoneSampler's cross-contour dedup silently deleted
// the entire second row -- a silent, wrong production result, not a thrown error or a structured
// failure. The fix moves the MONO-010 frameStoneSizeMm/frameRequiredSpacingMm computation above the
// resolveFrameForStoneWidth() call and passes frameRequiredSpacingMm instead.
//
// This file exercises the real GeometryEngine/FrameLibrary/MonogramGenerator pipeline end to end
// (same createRealGenerator() pattern as tools/test-mono-005-headless-monogram-generator.mjs) --
// no synthetic fakes, since the bug is entirely about real geometry spacing.

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FontManager } from '../src/fonts/index.js';
import { createDefaultFontProviderRegistry } from '../src/text/index.js';
import { GeometryEngine } from '../src/geometry/index.js';
import { getFrameDefinition } from '../src/geometry/FrameLibrary.js';
import { MonogramGenerator } from '../src/monogram/MonogramGenerator.js';

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

const CANVAS_MM = { widthMm: 100, heightMm: 100 };
const FRAME_RECT = { xMm: 10, yMm: 10, widthMm: 80, heightMm: 80 };

function baseRequest(frameOptions) {
  return {
    frameId: 'circle', layoutId: 'single', letters: ['A'],
    fontId: 'rs-block', providerId: 'rhinestone',
    stoneSizeMm: 2.4, gapMm: 0.3,
    frameRect: FRAME_RECT, canvasMm: CANVAS_MM,
    frameOptions
  };
}

function minPairwiseDistanceMm(stones) {
  let min = Infinity;
  for (let i = 0; i < stones.length; i++) {
    for (let j = i + 1; j < stones.length; j++) {
      const dx = stones[i].xMm - stones[j].xMm;
      const dy = stones[i].yMm - stones[j].yMm;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d < min) min = d;
    }
  }
  return min;
}

await test('a frame stone size larger than the letters\' preserves both outline rows instead of deduping the second row away', async () => {
  const { generator } = createRealGenerator();

  const twoRowResult = await generator.generate(baseRequest({ mode: 'outline', stoneWidth: 2, stoneSizeMm: 4.6 }));
  const oneRowResult = await generator.generate(baseRequest({ mode: 'outline', stoneWidth: 1, stoneSizeMm: 4.6 }));

  assert.equal(twoRowResult.ok, true, twoRowResult.message);
  assert.equal(oneRowResult.ok, true, oneRowResult.message);

  // Before the fix, the mis-offset second row was entirely deduped away, so the two-row request
  // produced the *same* frame stone count as the one-row request (both 51). A correctly-spaced
  // second row must add a substantial number of additional stones -- 1.6x is comfortably above the
  // ~1.0x a collapsed second row would produce, and comfortably below the ~2x a perfectly doubled
  // row would produce (the two rows have different circumferences, so it's never exactly 2x).
  assert.ok(
    twoRowResult.measurements.frameStoneCount >= oneRowResult.measurements.frameStoneCount * 1.6,
    `expected two-row frameStoneCount (${twoRowResult.measurements.frameStoneCount}) to be at least `
    + `1.6x the one-row frameStoneCount (${oneRowResult.measurements.frameStoneCount})`
  );

  // The frame layer's own generation must reproduce independently through a direct
  // GeometryEngine.generatePathLayout() call, the same "no GeometryEngine regression" contract
  // test-mono-005-headless-monogram-generator.mjs already checks for the default (same-size) case.
  const frameLayer = twoRowResult.layers.find((l) => l.type === 'path');
  const frame = getFrameDefinition('circle');
  const { resolveFrameForStoneWidth } = await import('../src/geometry/FrameLibrary.js');
  const stoneWidthResult = resolveFrameForStoneWidth(frame, 2, 4.6 + 0.3, FRAME_RECT.widthMm, FRAME_RECT.heightMm);
  assert.equal(stoneWidthResult.ok, true);
  const { geometryEngine } = createRealGenerator();
  const directFrameLayout = geometryEngine.generatePathLayout({
    contours: stoneWidthResult.frame.generationNaturalContours,
    layerId: 'independent-check',
    xMm: FRAME_RECT.xMm, yMm: FRAME_RECT.yMm, widthMm: FRAME_RECT.widthMm, heightMm: FRAME_RECT.heightMm,
    stoneSizeMm: 4.6, gapMm: 0.3, mode: 'outline', color: frameLayer.color
  });
  assert.equal(twoRowResult.measurements.frameStoneCount, directFrameLayout.stones.length);

  // No overlap: every pair of frame stones must be at least frameStoneSizeMm apart center-to-center.
  const frameStones = directFrameLayout.stones;
  const minDistanceMm = minPairwiseDistanceMm(frameStones);
  assert.ok(
    minDistanceMm >= 4.6 - 1e-6,
    `expected minimum pairwise frame stone distance >= 4.6mm, got ${minDistanceMm}`
  );
});

await test('the same-size (frame stone size == letter stone size) two-row case is unchanged by the fix', async () => {
  const { generator } = createRealGenerator();
  const result = await generator.generate(baseRequest({ mode: 'outline', stoneWidth: 2, stoneSizeMm: 2.4 }));
  assert.equal(result.ok, true, result.message);
  // Measured once against this exact request (frameId:'circle', layoutId:'single', letters:['A'],
  // rs-block/rhinestone, stoneSizeMm:2.4, gapMm:0.3, frameRect 80x80 at (10,10), canvasMm 100x100)
  // both before and after this fix -- the same-size case was never affected by the bug (letters' and
  // frame's requiredSpacingMm/frameRequiredSpacingMm are identical when the sizes match), so this
  // pins that the fix introduces no regression for the pre-existing behavior.
  assert.equal(result.measurements.frameStoneCount, 180);
});

if (process.exitCode === 1) {
  console.error('\nSome MONO-010 frame-stone-width-spacing tests failed.');
} else {
  console.log('\nAll MONO-010 frame-stone-width-spacing tests passed.');
}
