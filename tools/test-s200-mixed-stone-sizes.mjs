import assert from 'node:assert/strict';
import { GeometryEngine } from '../src/geometry/index.js';
import { normalizeMixedSizeParams, selectNonOverlappingSizedStones, DEFAULT_CONSERVATIVE_DETAIL } from '../src/geometry/MixedSizeGenerator.js';

// S-200 — Mixed Stone-Size Layouts. Geometry-level proof that Mixed mode's additive infill pass
// (a) actually produces more than one distinct stone size within a single layer, (b) never
// physically overlaps or violates the layer's own manufacturing gap, (c) never places a stone
// smaller than the configured minimum, (d) is deterministic, and (e) leaves Uniform mode (the
// default, and every project saved before this milestone) byte-identical. Calls the real,
// unmodified GeometryEngine directly, mirroring tools/test-variable-stone-sizes.mjs's own
// "geometry-level checks call the real engine" convention. No fontProviderRegistry is constructed
// here — text-layer coverage lives in a dedicated test below using a minimal fake registry, since
// this file's focus is the infill algorithm itself, shared identically across every layer type.

function createEngine() {
  return new GeometryEngine();
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

// Every accepted pair of stones (any origin — primary or infill) must clear the true physical
// touching distance; when `enforceGap` is set, the layer's own configured gapMm too.
function assertNoOverlaps(stones, gapMm = 0) {
  for (let i = 0; i < stones.length; i++) {
    for (let j = i + 1; j < stones.length; j++) {
      const a = stones[i], b = stones[j];
      const distance = Math.hypot(a.xMm - b.xMm, a.yMm - b.yMm);
      const minSeparationMm = (a.sizeMm + b.sizeMm) / 2 + gapMm;
      assert.ok(
        distance >= minSeparationMm - 1e-6,
        `stones overlap/violate spacing: (${a.xMm.toFixed(2)},${a.yMm.toFixed(2)},d=${a.sizeMm}) vs ` +
          `(${b.xMm.toFixed(2)},${b.yMm.toFixed(2)},d=${b.sizeMm}) — distance ${distance.toFixed(3)} < required ${minSeparationMm.toFixed(3)}`
      );
    }
  }
}

const MIXED_CIRCLE = { shape: 'circle', cxMm: 30, cyMm: 30, radiusMm: 25.3, stoneSizeMm: 4, gapMm: 0.5, mode: 'fill' };
const MIXED_OPTIONS = { sizeMode: 'mixed', allowedSizesMm: [2.0, 2.8, 4.0], minSizeMm: 2.0, maxSizeMm: 4.0, conservativeDetail: 1.0 };

await test('normalizeMixedSizeParams: uniform (default, and every field omitted) short-circuits to a null mixedOptions', () => {
  assert.deepEqual(normalizeMixedSizeParams({}, 4), { sizeMode: 'uniform', mixedOptions: null });
  assert.deepEqual(normalizeMixedSizeParams({ sizeMode: 'uniform', allowedSizesMm: [2] }, 4), { sizeMode: 'uniform', mixedOptions: null });
});

await test('normalizeMixedSizeParams: eligible sizes are only those smaller than primary, within [min,max], sorted descending', () => {
  const { mixedOptions } = normalizeMixedSizeParams({ sizeMode: 'mixed', allowedSizesMm: [2.0, 2.8, 4.0, 6.4], minSizeMm: 2.5 }, 4.0);
  // 4.0 and 6.4 excluded (not < primary 4.0); 2.0 excluded (< minSizeMm 2.5); only 2.8 remains.
  assert.deepEqual(mixedOptions.eligibleSizesMm, [2.8]);
});

await test('normalizeMixedSizeParams: conservativeDetail defaults and range-validates', () => {
  const { mixedOptions } = normalizeMixedSizeParams({ sizeMode: 'mixed', allowedSizesMm: [2.0] }, 4.0);
  assert.equal(mixedOptions.conservativeDetail, DEFAULT_CONSERVATIVE_DETAIL);
  assert.throws(() => normalizeMixedSizeParams({ sizeMode: 'mixed', allowedSizesMm: [2.0], conservativeDetail: 1.5 }, 4.0), RangeError);
  assert.throws(() => normalizeMixedSizeParams({ sizeMode: 'mixed', minSizeMm: 5, maxSizeMm: 2 }, 4.0), RangeError);
});

await test('normalizeMixedSizeParams: rejects an unknown sizeMode', () => {
  assert.throws(() => normalizeMixedSizeParams({ sizeMode: 'exotic' }, 4), TypeError);
});

await test('selectNonOverlappingSizedStones: prefers the size closest to primary (first in the descending list) at each candidate', () => {
  const accepted = selectNonOverlappingSizedStones(
    [{ xMm: 0, yMm: 0 }],
    [],
    [2.8, 2.0],
    0.3
  );
  assert.equal(accepted.length, 1);
  assert.equal(accepted[0].sizeMm, 2.8, 'expected the largest eligible size to win when it fits');
});

await test('selectNonOverlappingSizedStones: skips a candidate entirely when no eligible size fits', () => {
  const accepted = selectNonOverlappingSizedStones(
    [{ xMm: 0, yMm: 0 }],
    [{ xMm: 0.5, yMm: 0, sizeMm: 4 }], // occupies everything within reach of any eligible size
    [2.8, 2.0],
    0.5
  );
  assert.equal(accepted.length, 0);
});

await test('mixed-size shape generation produces more than one distinct stone size within one layer', () => {
  const engine = createEngine();
  const uniform = engine.generateShapeLayout({ ...MIXED_CIRCLE, layerId: 'c-uniform' });
  const mixed = engine.generateShapeLayout({ ...MIXED_CIRCLE, layerId: 'c-mixed', ...MIXED_OPTIONS });

  assert.ok(mixed.count >= uniform.count, 'mixed mode must never remove primary stones');
  const distinctSizes = new Set(mixed.stones.map((s) => s.sizeMm));
  assert.ok(distinctSizes.size > 1, `expected more than one distinct stone size, got ${[...distinctSizes]}`);
  assert.ok(distinctSizes.has(4), 'primary stones (size 4) must still be present');
});

await test('mixed mode is strictly additive: every primary stone is preserved unchanged as a prefix', () => {
  const engine = createEngine();
  const uniform = engine.generateShapeLayout({ ...MIXED_CIRCLE, layerId: 'c-uniform' });
  const mixed = engine.generateShapeLayout({ ...MIXED_CIRCLE, layerId: 'c-mixed', ...MIXED_OPTIONS });

  const uniformKey = uniform.stones.map((s) => `${s.xMm.toFixed(6)},${s.yMm.toFixed(6)},${s.sizeMm}`);
  const mixedPrefixKey = mixed.stones.slice(0, uniform.count).map((s) => `${s.xMm.toFixed(6)},${s.yMm.toFixed(6)},${s.sizeMm}`);
  assert.deepEqual(mixedPrefixKey, uniformKey);
});

await test('overlap prevention: no two stones (primary or infill) in a mixed-size layer ever physically overlap', () => {
  const engine = createEngine();
  for (const mode of ['fill', 'staggered', 'radial', 'contour', 'outline']) {
    const layout = engine.generateShapeLayout({ ...MIXED_CIRCLE, layerId: `c-${mode}`, mode, ...MIXED_OPTIONS });
    assertNoOverlaps(layout.stones);
  }
});

await test('minimum manufacturing spacing: every accepted pair clears sum-of-radii plus the layer\'s own gap', () => {
  const engine = createEngine();
  const layout = engine.generateShapeLayout({ ...MIXED_CIRCLE, layerId: 'c-spacing', ...MIXED_OPTIONS });
  assertNoOverlaps(layout.stones, MIXED_CIRCLE.gapMm);
});

await test('never below the user-selected minimum size', () => {
  const engine = createEngine();
  const layout = engine.generateShapeLayout({
    ...MIXED_CIRCLE, layerId: 'c-min', ...MIXED_OPTIONS,
    allowedSizesMm: [2.0, 2.8, 4.0], minSizeMm: 2.8
  });
  for (const stone of layout.stones) assert.ok(stone.sizeMm >= 2.8, `stone sizeMm ${stone.sizeMm} below configured minimum 2.8`);
});

await test('deterministic output: two independent calls with identical Mixed params produce byte-identical StoneLayout JSON', () => {
  const engine = createEngine();
  const a = engine.generateShapeLayout({ ...MIXED_CIRCLE, layerId: 'c-det', ...MIXED_OPTIONS });
  const b = engine.generateShapeLayout({ ...MIXED_CIRCLE, layerId: 'c-det', ...MIXED_OPTIONS });
  assert.deepEqual(a.toJSON(), b.toJSON());
});

await test('empty/ineligible Allowed Sizes is a safe no-op, byte-identical to Uniform mode', () => {
  const engine = createEngine();
  const uniform = engine.generateShapeLayout({ ...MIXED_CIRCLE, layerId: 'c-noop' });
  const emptyAllowed = engine.generateShapeLayout({ ...MIXED_CIRCLE, layerId: 'c-noop', sizeMode: 'mixed', allowedSizesMm: [] });
  const allTooLarge = engine.generateShapeLayout({ ...MIXED_CIRCLE, layerId: 'c-noop', sizeMode: 'mixed', allowedSizesMm: [4.0, 6.4] });
  assert.deepEqual(emptyAllowed.toJSON(), uniform.toJSON());
  assert.deepEqual(allTooLarge.toJSON(), uniform.toJSON());
});

await test('Uniform-mode backward compatibility: sizeMode omitted, and sizeMode:"uniform" explicitly, both match pre-S-200 output exactly', () => {
  const engine = createEngine();
  const noField = engine.generateShapeLayout({ ...MIXED_CIRCLE, layerId: 'c-compat' });
  const explicitUniform = engine.generateShapeLayout({ ...MIXED_CIRCLE, layerId: 'c-compat', sizeMode: 'uniform' });
  assert.deepEqual(noField.toJSON(), explicitUniform.toJSON());
  for (const stone of noField.stones) assert.equal(stone.sizeMm, MIXED_CIRCLE.stoneSizeMm);
});

await test('mixed mode works identically across every vector layer type: rectangle, svg, path', () => {
  const engine = createEngine();

  const rect = engine.generateShapeLayout({
    shape: 'rectangle', layerId: 'r', xMm: 0, yMm: 0, widthMm: 41.3, heightMm: 27.7,
    stoneSizeMm: 4, gapMm: 0.4, mode: 'fill', ...MIXED_OPTIONS
  });
  assert.ok(rect.count > 0);

  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="30mm" height="30mm">' +
    '<circle cx="15" cy="15" r="14"/></svg>';
  const svgLayout = engine.generateSvgLayout({
    svgSource: svg, layerId: 's', widthMm: 30, heightMm: 30,
    stoneSizeMm: 4, gapMm: 0.4, mode: 'fill', ...MIXED_OPTIONS
  });
  assert.ok(svgLayout.count > 0);
  const svgSizes = new Set(svgLayout.stones.map((s) => s.sizeMm));
  assert.ok(svgSizes.size >= 1);

  const naturalContour = [];
  for (let i = 0; i < 24; i++) {
    const angle = (i / 24) * Math.PI * 2;
    naturalContour.push({ xMm: 15 + 14 * Math.cos(angle), yMm: 15 + 14 * Math.sin(angle) });
  }
  const path = engine.generatePathLayout({
    contours: [naturalContour], layerId: 'p', widthMm: 30, heightMm: 30,
    stoneSizeMm: 4, gapMm: 0.4, mode: 'fill', ...MIXED_OPTIONS
  });
  assert.ok(path.count > 0);
});

await test('mixed mode: Image Trace (raster field) infill also stays overlap-free and additive', async () => {
  const { createImageBuffer } = await import('../src/image/index.js');
  const sizePx = 40;
  const data = new Uint8ClampedArray(sizePx * sizePx * 4);
  for (let y = 0; y < sizePx; y++) {
    for (let x = 0; x < sizePx; x++) {
      const dx = x - sizePx / 2, dy = y - sizePx / 2;
      const inside = Math.hypot(dx, dy) < sizePx / 2 - 2;
      const i = (y * sizePx + x) * 4;
      const v = inside ? 0 : 255; // dark pixels trace under the default threshold
      data[i] = v; data[i + 1] = v; data[i + 2] = v; data[i + 3] = 255;
    }
  }
  const imageBuffer = createImageBuffer({ widthPx: sizePx, heightPx: sizePx, data });

  const engine = createEngine();
  const uniform = engine.generateImageLayout({
    imageBuffer, layerId: 'img-u', widthMm: 30, heightMm: 30, stoneSizeMm: 4, gapMm: 0.4, mode: 'fill',
    maxWidthPx: sizePx, maxHeightPx: sizePx
  });
  const mixed = engine.generateImageLayout({
    imageBuffer, layerId: 'img-m', widthMm: 30, heightMm: 30, stoneSizeMm: 4, gapMm: 0.4, mode: 'fill',
    maxWidthPx: sizePx, maxHeightPx: sizePx, ...MIXED_OPTIONS
  });
  assert.ok(mixed.count >= uniform.count);
  assertNoOverlaps(mixed.stones, 0.4);
});

await test('mixed mode: text layers with a vector (non-authored) font gain infill and stay rotation-consistent', async () => {
  const { FontManager } = await import('../src/fonts/index.js');
  const { createDefaultFontProviderRegistry } = await import('../src/text/index.js');
  const { readFile } = await import('node:fs/promises');
  const path = await import('node:path');
  const { fileURLToPath } = await import('node:url');

  const repoRoot = fileURLToPath(new URL('..', import.meta.url));
  const manifest = JSON.parse(await readFile(path.join(repoRoot, 'assets/fonts/manifest.json'), 'utf8'));
  const fontManager = new FontManager(manifest);
  const fontProviderRegistry = createDefaultFontProviderRegistry(fontManager, {
    loadFontBuffer: async (relativePath) => {
      const buffer = await readFile(path.join(repoRoot, relativePath));
      return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
    }
  });
  const engine = new GeometryEngine({ fontProviderRegistry });

  const base = { text: 'OB', fontId: 'courier-prime-regular', layerId: 't', heightMm: 30, stoneSizeMm: 4, gapMm: 0.3, mode: 'fill' };
  const uniform = await engine.generateTextLayout(base);
  const mixed = await engine.generateTextLayout({ ...base, ...MIXED_OPTIONS });
  assert.ok(mixed.count >= uniform.count);
  assertNoOverlaps(mixed.stones, base.gapMm);

  // Rotation must not misalign infill from primary stones (they must rotate around one shared pivot).
  const rotatedUniform = await engine.generateTextLayout({ ...base, rotationDeg: 25 });
  const rotatedMixed = await engine.generateTextLayout({ ...base, ...MIXED_OPTIONS, rotationDeg: 25 });
  assert.ok(rotatedMixed.count >= rotatedUniform.count);
  assertNoOverlaps(rotatedMixed.stones, base.gapMm);
  const rotatedPrefix = rotatedMixed.stones.slice(0, rotatedUniform.count).map((s) => `${s.xMm.toFixed(6)},${s.yMm.toFixed(6)}`);
  const rotatedUniformKeys = rotatedUniform.stones.map((s) => `${s.xMm.toFixed(6)},${s.yMm.toFixed(6)}`);
  assert.deepEqual(rotatedPrefix, rotatedUniformKeys, 'primary stones must rotate identically with and without infill present');
});

await test('mixed mode is a documented no-op for authored-stone-center fonts (no throw)', async () => {
  const { FontManager } = await import('../src/fonts/index.js');
  const { createDefaultFontProviderRegistry, createDefaultRhinestoneFontRegistry } = await import('../src/text/index.js');
  const { readFile } = await import('node:fs/promises');
  const path = await import('node:path');
  const { fileURLToPath } = await import('node:url');

  const repoRoot = fileURLToPath(new URL('..', import.meta.url));
  const manifest = JSON.parse(await readFile(path.join(repoRoot, 'assets/fonts/manifest.json'), 'utf8'));
  const fontManager = new FontManager(manifest);
  const rhinestoneFontRegistry = createDefaultRhinestoneFontRegistry();
  const fontProviderRegistry = createDefaultFontProviderRegistry(fontManager, { rhinestoneFontRegistry });
  const engine = new GeometryEngine({ fontProviderRegistry });

  const base = { text: 'AB', fontId: 'rs-block', providerId: 'rhinestone', layerId: 't-authored', heightMm: 20, stoneSizeMm: 4, gapMm: 0.3 };
  const uniform = await engine.generateTextLayout(base);
  const mixed = await engine.generateTextLayout({ ...base, ...MIXED_OPTIONS });
  assert.deepEqual(mixed.toJSON(), uniform.toJSON(), 'authored-stone fonts must be unaffected by Mixed mode');
});

await test('large-layout performance: a big canvas at a fine eligible size completes within a sane wall-clock bound', () => {
  const engine = createEngine();
  const start = Date.now();
  const layout = engine.generateShapeLayout({
    shape: 'circle', layerId: 'perf', cxMm: 100, cyMm: 100, radiusMm: 95,
    stoneSizeMm: 4, gapMm: 0.3, mode: 'fill',
    sizeMode: 'mixed', allowedSizesMm: [2.0, 2.8, 4.0], conservativeDetail: 1
  });
  const elapsedMs = Date.now() - start;
  assert.ok(layout.count > 0);
  assert.ok(elapsedMs < 5000, `expected large mixed-size generation to finish quickly, took ${elapsedMs}ms`);
});

console.log('S-200 mixed stone size tests complete.');
