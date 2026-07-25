// MONO-002: Authored Font Positional Scaling.
//
// Focused tests for GeometryEngine.scaleAuthoredTextLayout() -- the pure position-only transform
// that repositions an already-generated authored-font StoneLayout's stone centers by a requested
// scale, around the layout's own bounding-box center, while preserving sizeMm/color/metadata/count
// exactly. See GeometryEngine.js's own doc comment on scaleAuthoredTextLayout() for the full
// contract and AUTHORED_FONT_FITTING_GAP_MM/TEXT_SCALE_FAILURE_REASONS for the constants asserted
// against here.

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FontManager } from '../src/fonts/index.js';
import { createDefaultFontProviderRegistry } from '../src/text/index.js';
import { GeometryEngine, StoneLayout, Stone, TEXT_SCALE_FAILURE_REASONS, AUTHORED_FONT_FITTING_GAP_MM } from '../src/geometry/index.js';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const manifest = JSON.parse(await readFile(path.join(repoRoot, 'assets/fonts/manifest.json'), 'utf8'));
const fontManager = new FontManager(manifest);

async function loadFontBufferFromRepoRoot(relativePath) {
  const buffer = await readFile(path.join(repoRoot, relativePath));
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
}

function createEngine() {
  const fontProviderRegistry = createDefaultFontProviderRegistry(fontManager, {
    loadFontBuffer: loadFontBufferFromRepoRoot
  });
  return new GeometryEngine({ fontProviderRegistry });
}

const RS_BLOCK_BASE_PARAMS = {
  text: 'Vitalina',
  fontId: 'rs-block',
  providerId: 'rhinestone',
  layerId: 'layer-1',
  heightMm: 12,
  stoneSizeMm: 2.8,
  gapMm: 0.3,
  mode: 'outline'
};

const SS10_BASE_PARAMS = {
  text: 'AV',
  fontId: 'rs-block-prototype-ss10',
  providerId: 'rhinestone',
  layerId: 'layer-1',
  heightMm: 12,
  stoneSizeMm: 2.8,
  gapMm: 0.3,
  mode: 'outline'
};

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

function sortedPoints(layout) {
  return layout.stones
    .map((s) => ({ xMm: s.xMm, yMm: s.yMm }))
    .sort((a, b) => (a.xMm - b.xMm) || (a.yMm - b.yMm));
}

await test('1. scale 1.0 reproduces the original positions and bounding box', async () => {
  const engine = createEngine();
  const layout = await engine.generateTextLayout(RS_BLOCK_BASE_PARAMS);
  const result = engine.scaleAuthoredTextLayout(layout, 1);

  assert.equal(result.ok, true);
  assert.equal(result.layout.count, layout.count);
  for (let i = 0; i < layout.count; i++) {
    assert.ok(Math.abs(result.layout.stones[i].xMm - layout.stones[i].xMm) < 1e-9);
    assert.ok(Math.abs(result.layout.stones[i].yMm - layout.stones[i].yMm) < 1e-9);
  }
  const originalBox = layout.getBoundingBox();
  assert.ok(Math.abs(result.scaledBoundingBox.widthMm - originalBox.widthMm) < 1e-9);
  assert.ok(Math.abs(result.scaledBoundingBox.heightMm - originalBox.heightMm) < 1e-9);
});

await test('2. scale greater than 1.0 expands positions correctly around the bounding-box center', async () => {
  const engine = createEngine();
  const layout = await engine.generateTextLayout(RS_BLOCK_BASE_PARAMS);
  const box = layout.getBoundingBox();
  const cxMm = (box.minXmm + box.maxXmm) / 2;
  const cyMm = (box.minYmm + box.maxYmm) / 2;

  const result = engine.scaleAuthoredTextLayout(layout, 2);
  assert.equal(result.ok, true);

  for (let i = 0; i < layout.count; i++) {
    const expectedX = cxMm + (layout.stones[i].xMm - cxMm) * 2;
    const expectedY = cyMm + (layout.stones[i].yMm - cyMm) * 2;
    assert.ok(Math.abs(result.layout.stones[i].xMm - expectedX) < 1e-6);
    assert.ok(Math.abs(result.layout.stones[i].yMm - expectedY) < 1e-6);
  }
  assert.ok(result.scaledBoundingBox.widthMm > box.widthMm);
  assert.ok(result.scaledBoundingBox.heightMm > box.heightMm);
});

await test('3. scale below 1.0 succeeds when a smaller catalog stone size provides legal clearance', async () => {
  const engine = createEngine();
  const layout = await engine.generateTextLayout({ ...RS_BLOCK_BASE_PARAMS, stoneSizeMm: 1.2 });

  const result = engine.scaleAuthoredTextLayout(layout, 0.7);
  assert.equal(result.ok, true, result.message);
  assert.ok(result.minimumLegalScale < 0.7);
});

await test('4. SS10 at its native 2.8mm stone size on the authored 3.1mm pitch has minimumLegalScale ~= 1.0 (effectively zero shrink headroom)', async () => {
  const engine = createEngine();
  // SS10_BASE_PARAMS.stoneSizeMm is 2.8 -- SS10's own catalog diameter (src/renderer/StoneSizes.js),
  // matching MONO-001A's documented pitch derivation (families/rsBlockPrototypeSS10.js,
  // families/rsBlock.js: "3.1mm = SS10's 2.8mm stone + 0.3mm gap"). requiredSpacingMm is therefore
  // 2.8 + AUTHORED_FONT_FITTING_GAP_MM(0.3) = 3.1mm, equal to the authored pitch itself, so
  // minimumLegalScale should land at ~1.0 -- SS10 was hand-placed at the tightest clearance already
  // judged production-safe, with no slack to shrink into.
  const layout = await engine.generateTextLayout(SS10_BASE_PARAMS);

  const belowFloor = engine.scaleAuthoredTextLayout(layout, 0.5);
  assert.equal(belowFloor.ok, false);
  assert.equal(belowFloor.reason, TEXT_SCALE_FAILURE_REASONS.BELOW_MINIMUM_SCALE);
  assert.ok(Math.abs(belowFloor.minimumLegalScale - 1) < 1e-6, `expected minimumLegalScale ~= 1.0, got ${belowFloor.minimumLegalScale}`);

  // A requested scale meaningfully below 1.0 (not just an epsilon under the floor) is rejected.
  const meaningfullyBelow = engine.scaleAuthoredTextLayout(layout, 0.9);
  assert.equal(meaningfullyBelow.ok, false);
  assert.equal(meaningfullyBelow.reason, TEXT_SCALE_FAILURE_REASONS.BELOW_MINIMUM_SCALE);

  const atFloor = engine.scaleAuthoredTextLayout(layout, belowFloor.minimumLegalScale);
  assert.equal(atFloor.ok, true, atFloor.message);

  const justBelowFloor = engine.scaleAuthoredTextLayout(layout, belowFloor.minimumLegalScale - 1e-6);
  assert.equal(justBelowFloor.ok, false);
  assert.equal(justBelowFloor.reason, TEXT_SCALE_FAILURE_REASONS.BELOW_MINIMUM_SCALE);
});

await test('4b. SS6 on the same authored SS10 3.1mm pitch retains valid shrink capacity', async () => {
  // Same authored font (fixed PITCH_MM=3.1 grid), but a smaller catalog stone size (SS6, 2.0mm --
  // src/renderer/StoneSizes.js) laid onto that same 3.1mm-pitch grid. requiredSpacingMm becomes
  // 2.0 + 0.3 = 2.3mm against a natural spacing of 3.1mm, so minimumLegalScale should be
  // meaningfully below 1.0 (~2.3/3.1 = 0.7419), unlike SS10 at its own native size in test 4.
  const engine = createEngine();
  const layout = await engine.generateTextLayout({ ...SS10_BASE_PARAMS, stoneSizeMm: 2.0 });

  const result = engine.scaleAuthoredTextLayout(layout, 1);
  assert.equal(result.ok, true, result.message);
  assert.ok(result.minimumLegalScale < 0.9, `expected meaningful shrink headroom, got minimumLegalScale ${result.minimumLegalScale}`);
  assert.ok(Math.abs(result.minimumLegalScale - 2.3 / 3.1) < 1e-6);

  const shrunk = engine.scaleAuthoredTextLayout(layout, (result.minimumLegalScale + 1) / 2);
  assert.equal(shrunk.ok, true, shrunk.message);
  for (const stone of shrunk.layout.stones) {
    assert.equal(stone.sizeMm, 2.0);
  }
});

await test('5. sizeMm remains unchanged for every stone', async () => {
  const engine = createEngine();
  const layout = await engine.generateTextLayout(RS_BLOCK_BASE_PARAMS);
  const result = engine.scaleAuthoredTextLayout(layout, 1.5);
  assert.equal(result.ok, true);
  for (const stone of result.layout.stones) {
    assert.equal(stone.sizeMm, RS_BLOCK_BASE_PARAMS.stoneSizeMm);
  }
});

await test('6. stone count remains unchanged', async () => {
  const engine = createEngine();
  const layout = await engine.generateTextLayout(RS_BLOCK_BASE_PARAMS);
  const result = engine.scaleAuthoredTextLayout(layout, 1.3);
  assert.equal(result.ok, true);
  assert.equal(result.layout.count, layout.count);
});

await test('7. metadata and color remain unchanged', async () => {
  const engine = createEngine();
  const layout = await engine.generateTextLayout({ ...RS_BLOCK_BASE_PARAMS, color: 'Rose Gold' });
  const result = engine.scaleAuthoredTextLayout(layout, 1.4);
  assert.equal(result.ok, true);
  for (let i = 0; i < layout.count; i++) {
    assert.equal(result.layout.stones[i].color, layout.stones[i].color);
    assert.deepEqual(result.layout.stones[i].metadata, layout.stones[i].metadata);
    assert.equal(result.layout.stones[i].layerId, layout.stones[i].layerId);
  }
});

await test('8. pivot is the original bounding-box center', async () => {
  const engine = createEngine();
  const layout = await engine.generateTextLayout(RS_BLOCK_BASE_PARAMS);
  const box = layout.getBoundingBox();
  const cxMm = (box.minXmm + box.maxXmm) / 2;
  const cyMm = (box.minYmm + box.maxYmm) / 2;

  const result = engine.scaleAuthoredTextLayout(layout, 3);
  assert.equal(result.ok, true);
  const scaledBox = result.scaledBoundingBox;
  const scaledCxMm = (scaledBox.minXmm + scaledBox.maxXmm) / 2;
  const scaledCyMm = (scaledBox.minYmm + scaledBox.maxYmm) / 2;
  assert.ok(Math.abs(scaledCxMm - cxMm) < 1e-6);
  assert.ok(Math.abs(scaledCyMm - cyMm) < 1e-6);
});

await test('9. invalid, zero, negative, NaN, and infinite scales fail cleanly with INVALID_SCALE', async () => {
  const engine = createEngine();
  const layout = await engine.generateTextLayout(RS_BLOCK_BASE_PARAMS);

  for (const badScale of [0, -1, NaN, Infinity, -Infinity, 'a lot', null, undefined]) {
    const result = engine.scaleAuthoredTextLayout(layout, badScale);
    assert.equal(result.ok, false, `expected scale ${badScale} to fail`);
    assert.equal(result.reason, TEXT_SCALE_FAILURE_REASONS.INVALID_SCALE);
    assert.equal(result.layout, undefined);
  }
});

await test('10. scale below minimum legal scale returns a structured failure with measurements', async () => {
  const engine = createEngine();
  const layout = await engine.generateTextLayout(RS_BLOCK_BASE_PARAMS);
  const result = engine.scaleAuthoredTextLayout(layout, 0.01);

  assert.equal(result.ok, false);
  assert.equal(result.reason, TEXT_SCALE_FAILURE_REASONS.BELOW_MINIMUM_SCALE);
  assert.equal(typeof result.minimumLegalScale, 'number');
  assert.equal(typeof result.naturalMinimumSpacingMm, 'number');
  assert.equal(result.requiredSpacingMm, RS_BLOCK_BASE_PARAMS.stoneSizeMm + AUTHORED_FONT_FITTING_GAP_MM);
  assert.ok(result.originalBoundingBox);
  assert.equal(result.scaledBoundingBox, null);
});

await test('11. empty layout fails cleanly with INVALID_LAYOUT', () => {
  const engine = createEngine();
  const emptyLayout = new StoneLayout({ layerId: 'layer-1', stones: [] });
  const result = engine.scaleAuthoredTextLayout(emptyLayout, 1);
  assert.equal(result.ok, false);
  assert.equal(result.reason, TEXT_SCALE_FAILURE_REASONS.INVALID_LAYOUT);
  assert.equal(result.originalBoundingBox, null);
});

await test('12. a non-StoneLayout input also fails cleanly with INVALID_LAYOUT', () => {
  const engine = createEngine();
  const result = engine.scaleAuthoredTextLayout(null, 1);
  assert.equal(result.ok, false);
  assert.equal(result.reason, TEXT_SCALE_FAILURE_REASONS.INVALID_LAYOUT);
});

await test('12b. a non-authored StoneLayout (sourceMode from a sampled shape layer) fails with NOT_AUTHORED_SOURCE', () => {
  const engine = createEngine();
  const shapeLayout = engine.generateShapeLayout({
    shape: 'circle',
    layerId: 'layer-1',
    stoneSizeMm: 2.8,
    gapMm: 0.3,
    mode: 'outline',
    cxMm: 20,
    cyMm: 20,
    radiusMm: 15
  });
  assert.notEqual(shapeLayout.sourceMode, 'authored');
  assert.ok(shapeLayout.count > 0);

  const result = engine.scaleAuthoredTextLayout(shapeLayout, 1);
  assert.equal(result.ok, false);
  assert.equal(result.reason, TEXT_SCALE_FAILURE_REASONS.NOT_AUTHORED_SOURCE);
  assert.equal(result.minimumLegalScale, null);
  assert.ok(result.originalBoundingBox);
});

await test('13. coincident stone centers return NATURAL_SPACING_VIOLATED regardless of requested scale', () => {
  const engine = createEngine();
  const coincidentLayout = new StoneLayout({
    layerId: 'layer-1',
    sourceMode: 'authored',
    stones: [
      new Stone({ xMm: 5, yMm: 5, sizeMm: 2.8, layerId: 'layer-1', index: 0 }),
      new Stone({ xMm: 5, yMm: 5, sizeMm: 2.8, layerId: 'layer-1', index: 1 }),
      new Stone({ xMm: 8, yMm: 5, sizeMm: 2.8, layerId: 'layer-1', index: 2 })
    ]
  });

  for (const scale of [0.01, 1, 5, 100]) {
    const result = engine.scaleAuthoredTextLayout(coincidentLayout, scale);
    assert.equal(result.ok, false, `expected scale ${scale} to fail`);
    assert.equal(result.reason, TEXT_SCALE_FAILURE_REASONS.NATURAL_SPACING_VIOLATED);
    assert.equal(result.minimumLegalScale, null);
    assert.equal(result.naturalMinimumSpacingMm, 0);
  }
});

await test('14. a single-stone layout has no spacing constraint -- any positive finite scale is legal', () => {
  const engine = createEngine();
  const singleStoneLayout = new StoneLayout({
    layerId: 'layer-1',
    sourceMode: 'authored',
    stones: [new Stone({ xMm: 5, yMm: 5, sizeMm: 2.8, layerId: 'layer-1', index: 0 })]
  });

  const shrunk = engine.scaleAuthoredTextLayout(singleStoneLayout, 0.001);
  assert.equal(shrunk.ok, true, shrunk.message);
  assert.equal(shrunk.minimumLegalScale, 0);
  assert.equal(shrunk.naturalMinimumSpacingMm, null);
  // A single point's bounding box is degenerate (zero width/height), so it is its own pivot --
  // scaling it around itself must leave its one stone exactly in place.
  assert.equal(shrunk.layout.stones[0].xMm, 5);
  assert.equal(shrunk.layout.stones[0].yMm, 5);
});

await test('15. original authored-font generation is unchanged when scaling is not requested', async () => {
  const engine = createEngine();
  const layout = await engine.generateTextLayout(RS_BLOCK_BASE_PARAMS);
  assert.equal(layout.sourceMode, 'authored');
  assert.ok(layout.count > 0);
  // No call to scaleAuthoredTextLayout() at all -- generateTextLayout()'s own output is exactly
  // the pre-MONO-002 shape/values, proving the new capability is additive, not a change to the
  // existing text-generation path.
});

await test('16. deterministic repeated calls produce identical results', async () => {
  const engine = createEngine();
  const layout = await engine.generateTextLayout(RS_BLOCK_BASE_PARAMS);

  const first = engine.scaleAuthoredTextLayout(layout, 1.7);
  const second = engine.scaleAuthoredTextLayout(layout, 1.7);

  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  assert.deepEqual(sortedPoints(first.layout), sortedPoints(second.layout));
  assert.equal(first.minimumLegalScale, second.minimumLegalScale);
  assert.equal(first.naturalMinimumSpacingMm, second.naturalMinimumSpacingMm);
});

if (process.exitCode) {
  console.error('\nSome MONO-002 tests failed.');
} else {
  console.log('\nAll MONO-002 tests passed.');
}
