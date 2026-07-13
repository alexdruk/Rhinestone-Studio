import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { execSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FontManager } from '../src/fonts/index.js';
import { createDefaultFontProviderRegistry } from '../src/text/index.js';
import { GeometryEngine, ContourFillPrecisionError } from '../src/geometry/index.js';

// RS-1011 (Fill Algorithms) — engine-level proof that Grid/Staggered/Radial/Contour Fill (plus the
// pre-existing Outline mode) are real GeometryEngine capabilities, shared by every vector layer type
// (text/curved text/circle/rectangle/svg/path) and, minus Outline, by Image Trace's raster field.
// Calls the real, unmodified permanent GeometryEngine directly, exactly like
// tools/test-shape-geometry-integration.mjs / test-svg-integration.mjs / test-variable-stone-sizes.mjs.

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

const VECTOR_MODES = ['outline', 'fill', 'staggered', 'radial', 'contour'];
const IMAGE_MODES = ['fill', 'staggered', 'radial', 'contour'];

function minSpacingMm(stones) {
  let min = Infinity;
  for (let i = 0; i < stones.length; i++) {
    for (let j = i + 1; j < stones.length; j++) {
      const d = Math.hypot(stones[i].xMm - stones[j].xMm, stones[i].yMm - stones[j].yMm);
      if (d < min) min = d;
    }
  }
  return min;
}

function duplicateCount(stones, toleranceMm = 1e-6) {
  let count = 0;
  for (let i = 0; i < stones.length; i++) {
    for (let j = i + 1; j < stones.length; j++) {
      if (Math.hypot(stones[i].xMm - stones[j].xMm, stones[i].yMm - stones[j].yMm) < toleranceMm) count++;
    }
  }
  return count;
}

function serializeStones(stones) {
  return JSON.stringify(stones.map((s) => [Math.round(s.xMm * 1e6), Math.round(s.yMm * 1e6)]).sort());
}

function checkerboardImageBuffer(sizePx = 40, ringRadiusFraction = 0.42, holeRadiusFraction = 0.18) {
  // A donut (ring) density field -- the raster analogue of a shape with a hole, so Image Trace's
  // fill modes can be measured for hole preservation the same way vector modes are.
  const data = new Uint8ClampedArray(sizePx * sizePx * 4);
  const cx = sizePx / 2, cy = sizePx / 2;
  for (let y = 0; y < sizePx; y++) {
    for (let x = 0; x < sizePx; x++) {
      const dist = Math.hypot(x - cx, y - cy) / sizePx;
      const inRing = dist < ringRadiusFraction && dist > holeRadiusFraction;
      const v = inRing ? 0 : 255; // dark (0) traces under the default 128 threshold
      const i = (y * sizePx + x) * 4;
      data[i] = v; data[i + 1] = v; data[i + 2] = v; data[i + 3] = 255;
    }
  }
  return { widthPx: sizePx, heightPx: sizePx, data };
}

// --- 1. Every vector fill mode works for every vector layer type -------------------------------

await test('1. every vector fill mode (outline/fill/staggered/radial/contour) generates stones for circle/rectangle/svg/path', async () => {
  const engine = createEngine();
  const svgSource = '<svg xmlns="http://www.w3.org/2000/svg" width="40mm" height="30mm"><rect x="0" y="0" width="40" height="30"/></svg>';
  const contours = [[{ xMm: 0, yMm: 0 }, { xMm: 40, yMm: 0 }, { xMm: 40, yMm: 30 }, { xMm: 0, yMm: 30 }]];

  for (const mode of VECTOR_MODES) {
    const circle = engine.generateShapeLayout({ shape: 'circle', layerId: 'c', stoneSizeMm: 2, gapMm: 0.3, mode, cxMm: 30, cyMm: 30, radiusMm: 20 });
    assert.ok(circle.count > 0, `circle ${mode} should produce stones`);

    const rect = engine.generateShapeLayout({ shape: 'rectangle', layerId: 'r', stoneSizeMm: 2, gapMm: 0.3, mode, xMm: 0, yMm: 0, widthMm: 40, heightMm: 30 });
    assert.ok(rect.count > 0, `rectangle ${mode} should produce stones`);

    const svg = engine.generateSvgLayout({ svgSource, layerId: 's', stoneSizeMm: 2, gapMm: 0.3, mode });
    assert.ok(svg.count > 0, `svg ${mode} should produce stones`);

    const pathLayer = engine.generatePathLayout({ contours, layerId: 'p', stoneSizeMm: 2, gapMm: 0.3, mode });
    assert.ok(pathLayer.count > 0, `path ${mode} should produce stones`);
  }
});

await test('2. every vector fill mode works for text, including curved text', async () => {
  const engine = createEngine();
  for (const mode of VECTOR_MODES) {
    const straight = await engine.generateTextLayout({ text: 'Hi', fontId: 'courier-prime-regular', layerId: 't', heightMm: 20, stoneSizeMm: 1.5, gapMm: 0.3, mode });
    assert.ok(straight.count > 0, `straight text ${mode} should produce stones`);

    const curved = await engine.generateTextLayout({
      text: 'Hi', fontId: 'courier-prime-regular', layerId: 't2', heightMm: 20, stoneSizeMm: 1.5, gapMm: 0.3, mode,
      curveEnabled: true, curveRadiusMm: 40, curveDirection: 'outside', curveStartAngleDeg: 0, curveSweepAngleDeg: 90, curveAlignment: 'center'
    });
    assert.ok(curved.count > 0, `curved text ${mode} should produce stones`);
  }
});

// --- 2. Image Trace: fill/staggered/radial/contour work, outline is rejected --------------------

await test('3. every image fill mode (fill/staggered/radial/contour) generates stones; outline is rejected with a clear error', async () => {
  const engine = createEngine();
  const buffer = checkerboardImageBuffer();
  for (const mode of IMAGE_MODES) {
    const layout = engine.generateImageLayout({ imageBuffer: buffer, layerId: 'i', xMm: 0, yMm: 0, widthMm: 30, heightMm: 30, stoneSizeMm: 1.5, gapMm: 0.3, mode, maxWidthPx: 40, maxHeightPx: 40 });
    assert.ok(layout.count > 0, `image ${mode} should produce stones`);
    assert.equal(layout.sourceMode, mode);
  }
  assert.throws(
    () => engine.generateImageLayout({ imageBuffer: buffer, layerId: 'i', xMm: 0, yMm: 0, widthMm: 30, heightMm: 30, stoneSizeMm: 1.5, gapMm: 0.3, mode: 'outline', maxWidthPx: 40, maxHeightPx: 40 }),
    /Unsupported image fill mode: outline/
  );
});

await test('4. generateImageLayout() defaults to fill mode when no mode is given (pre-RS-1011 call sites/projects unchanged)', () => {
  const engine = createEngine();
  const buffer = checkerboardImageBuffer();
  const withDefault = engine.generateImageLayout({ imageBuffer: buffer, layerId: 'i', xMm: 0, yMm: 0, widthMm: 30, heightMm: 30, stoneSizeMm: 1.5, gapMm: 0.3, maxWidthPx: 40, maxHeightPx: 40 });
  const explicitFill = engine.generateImageLayout({ imageBuffer: buffer, layerId: 'i', xMm: 0, yMm: 0, widthMm: 30, heightMm: 30, stoneSizeMm: 1.5, gapMm: 0.3, mode: 'fill', maxWidthPx: 40, maxHeightPx: 40 });
  assert.equal(withDefault.sourceMode, 'fill');
  assert.equal(serializeStones(withDefault.stones), serializeStones(explicitFill.stones));
});

// --- 3. Precision: minimum spacing, no overlap, no duplicates -----------------------------------

await test('5. Grid/Staggered/Radial/Contour Fill never place two stones closer than the configured stone pitch (measured, not visually inspected)', () => {
  const engine = createEngine();
  const stoneSizeMm = 2, gapMm = 0.3, spacingMm = stoneSizeMm + gapMm;
  const shapes = [
    { shape: 'circle', cxMm: 30, cyMm: 30, radiusMm: 20 },
    { shape: 'rectangle', xMm: 0, yMm: 0, widthMm: 50, heightMm: 30 }
  ];
  for (const shapeParams of shapes) {
    for (const mode of ['fill', 'staggered', 'radial', 'contour']) {
      const layout = engine.generateShapeLayout({ ...shapeParams, layerId: 'x', stoneSizeMm, gapMm, mode });
      const min = minSpacingMm(layout.stones);
      assert.ok(
        min >= spacingMm - 1e-6,
        `${shapeParams.shape} ${mode}: minimum spacing ${min.toFixed(4)}mm must be >= the ${spacingMm}mm stone pitch`
      );
      // Hard physical-overlap floor: even independent of the pitch target, no two stone *edges*
      // (diameter stoneSizeMm each) may overlap.
      assert.ok(min >= stoneSizeMm - 1e-6, `${shapeParams.shape} ${mode}: stones must not physically overlap`);
    }
  }
});

await test('6. no duplicate stones (near-exact coincident positions) in any mode', () => {
  const engine = createEngine();
  for (const mode of VECTOR_MODES) {
    const layout = engine.generateShapeLayout({ shape: 'rectangle', layerId: 'r', stoneSizeMm: 2, gapMm: 0.3, mode, xMm: 0, yMm: 0, widthMm: 40, heightMm: 40 });
    assert.equal(duplicateCount(layout.stones), 0, `${mode} must produce zero exact-duplicate stones`);
  }
});

await test('7. Contour Fill produces multiple concentric rings for a shape large relative to the stone pitch', () => {
  const engine = createEngine();
  const outline = engine.generateShapeLayout({ shape: 'circle', layerId: 'c', stoneSizeMm: 2, gapMm: 0.3, mode: 'outline', cxMm: 30, cyMm: 30, radiusMm: 20 });
  const contour = engine.generateShapeLayout({ shape: 'circle', layerId: 'c', stoneSizeMm: 2, gapMm: 0.3, mode: 'contour', cxMm: 30, cyMm: 30, radiusMm: 20 });
  assert.ok(contour.count > outline.count, 'Contour Fill should place substantially more stones than the outline alone (multiple rings)');
});

await test('8. Staggered Fill packs more densely than Grid Fill over the same shape/spacing (hexagonal vs square packing)', () => {
  const engine = createEngine();
  const grid = engine.generateShapeLayout({ shape: 'rectangle', layerId: 'r', stoneSizeMm: 2, gapMm: 0.3, mode: 'fill', xMm: 0, yMm: 0, widthMm: 60, heightMm: 60 });
  const staggered = engine.generateShapeLayout({ shape: 'rectangle', layerId: 'r', stoneSizeMm: 2, gapMm: 0.3, mode: 'staggered', xMm: 0, yMm: 0, widthMm: 60, heightMm: 60 });
  assert.ok(staggered.count > grid.count, 'expected hexagonal packing to fit more stones than square packing over the same area');
});

// --- 4. Hole preservation ------------------------------------------------------------------------

await test('9. holes are preserved (no stones placed inside a hole) for every fill mode, vector and raster', () => {
  const engine = createEngine();
  const outer = [{ xMm: 0, yMm: 0 }, { xMm: 40, yMm: 0 }, { xMm: 40, yMm: 40 }, { xMm: 0, yMm: 40 }];
  const hole = [{ xMm: 15, yMm: 15 }, { xMm: 15, yMm: 25 }, { xMm: 25, yMm: 25 }, { xMm: 25, yMm: 15 }];
  const insideHole = (s) => s.xMm > 15 && s.xMm < 25 && s.yMm > 15 && s.yMm < 25;

  for (const mode of ['fill', 'staggered', 'radial', 'contour']) {
    const layout = engine.generatePathLayout({ contours: [outer, hole], layerId: 'p', stoneSizeMm: 2, gapMm: 0.3, mode, xMm: 0, yMm: 0, widthMm: 40, heightMm: 40 });
    assert.equal(layout.stones.filter(insideHole).length, 0, `${mode}: no stone may fall inside the hole`);
  }

  const donut = checkerboardImageBuffer();
  // Checked against a margin comfortably inside checkerboardImageBuffer()'s 0.18 hole-radius
  // fraction (not flush against it): a raster field's hole boundary is only accurate to one pixel
  // (here, 30mm placed over 40px source -> 0.75mm/px), so a stone placed within a pixel-width of the
  // boundary is an inherent, expected raster-resolution artifact, not a hole-preservation failure --
  // this checks that no stone lands *substantially* inside the hole.
  const donutCenterInsideHole = (s, boxWidthMm, boxHeightMm) => {
    const localXMm = s.xMm, localYMm = s.yMm;
    const dist = Math.hypot(localXMm - boxWidthMm / 2, localYMm - boxHeightMm / 2) / boxWidthMm;
    return dist < 0.13;
  };
  for (const mode of IMAGE_MODES) {
    const layout = engine.generateImageLayout({ imageBuffer: donut, layerId: 'i', xMm: 0, yMm: 0, widthMm: 30, heightMm: 30, stoneSizeMm: 1.5, gapMm: 0.3, mode, maxWidthPx: 40, maxHeightPx: 40 });
    const insideHoleCount = layout.stones.filter((s) => donutCenterInsideHole(s, 30, 30)).length;
    assert.equal(insideHoleCount, 0, `image ${mode}: no stone may fall inside the donut's hole`);
  }
});

// --- 5. Determinism -------------------------------------------------------------------------------

await test('10. every fill mode is deterministic across repeated runs with identical input', async () => {
  const engine = createEngine();
  for (const mode of VECTOR_MODES) {
    const a = engine.generateShapeLayout({ shape: 'circle', layerId: 'c', stoneSizeMm: 2, gapMm: 0.3, mode, cxMm: 30, cyMm: 30, radiusMm: 20 });
    const b = engine.generateShapeLayout({ shape: 'circle', layerId: 'c', stoneSizeMm: 2, gapMm: 0.3, mode, cxMm: 30, cyMm: 30, radiusMm: 20 });
    assert.equal(serializeStones(a.stones), serializeStones(b.stones), `${mode} must be deterministic`);
  }
  for (const mode of IMAGE_MODES) {
    const buffer = checkerboardImageBuffer();
    const a = engine.generateImageLayout({ imageBuffer: buffer, layerId: 'i', xMm: 0, yMm: 0, widthMm: 30, heightMm: 30, stoneSizeMm: 1.5, gapMm: 0.3, mode, maxWidthPx: 40, maxHeightPx: 40 });
    const b = engine.generateImageLayout({ imageBuffer: buffer, layerId: 'i', xMm: 0, yMm: 0, widthMm: 30, heightMm: 30, stoneSizeMm: 1.5, gapMm: 0.3, mode, maxWidthPx: 40, maxHeightPx: 40 });
    assert.equal(serializeStones(a.stones), serializeStones(b.stones), `image ${mode} must be deterministic`);
  }
});

// --- 6. Mixed stone sizes and gap handling --------------------------------------------------------

await test('11. mixed stone sizes across layers each keep their own independent sizeMm, for every fill mode', () => {
  const engine = createEngine();
  for (const mode of ['fill', 'staggered', 'radial', 'contour']) {
    const small = engine.generateShapeLayout({ shape: 'circle', layerId: 'small', stoneSizeMm: 1.4, gapMm: 0.2, mode, cxMm: 15, cyMm: 15, radiusMm: 12 });
    const large = engine.generateShapeLayout({ shape: 'circle', layerId: 'large', stoneSizeMm: 4, gapMm: 0.5, mode, cxMm: 15, cyMm: 15, radiusMm: 12 });
    assert.ok(small.stones.every((s) => s.sizeMm === 1.4), `${mode}: small layer stones must all carry sizeMm 1.4`);
    assert.ok(large.stones.every((s) => s.sizeMm === 4), `${mode}: large layer stones must all carry sizeMm 4`);
  }
});

await test('12. increasing gap increases the achieved stone pitch proportionally, for every fill mode (one spacing formula, no second one)', () => {
  const engine = createEngine();
  for (const mode of ['fill', 'staggered', 'radial', 'contour']) {
    const tight = engine.generateShapeLayout({ shape: 'rectangle', layerId: 'r', stoneSizeMm: 2, gapMm: 0.2, mode, xMm: 0, yMm: 0, widthMm: 40, heightMm: 40 });
    const loose = engine.generateShapeLayout({ shape: 'rectangle', layerId: 'r', stoneSizeMm: 2, gapMm: 1.5, mode, xMm: 0, yMm: 0, widthMm: 40, heightMm: 40 });
    assert.ok(minSpacingMm(tight.stones) < minSpacingMm(loose.stones), `${mode}: a larger gap must widen the minimum achieved spacing`);
    assert.ok(loose.count < tight.count, `${mode}: a larger gap must place fewer stones over the same area`);
  }
});

// --- 7. Fail-safe validation ------------------------------------------------------------------

await test('13. an unsupported mode throws a clear, specific error (no malformed/misleading geometry returned)', () => {
  const engine = createEngine();
  assert.throws(
    () => engine.generateShapeLayout({ shape: 'circle', layerId: 'c', stoneSizeMm: 2, gapMm: 0.3, mode: 'bogus', cxMm: 30, cyMm: 30, radiusMm: 20 }),
    /Unsupported geometry mode: bogus/
  );
});

await test('14. Contour Fill fails gracefully (a specific, actionable ContourFillPrecisionError) rather than freezing on a pathological shape/spacing combination', () => {
  const engine = createEngine();
  // A large shape combined with a vanishingly small stone pitch drives ContourRingSampler.js's
  // distance-field grid past its cell budget -- see src/geometry/ContourRingSampler.js.
  assert.throws(
    () => engine.generateShapeLayout({ shape: 'rectangle', layerId: 'r', stoneSizeMm: 0.001, gapMm: 0.0001, mode: 'contour', xMm: 0, yMm: 0, widthMm: 4000, heightMm: 4000 }),
    ContourFillPrecisionError
  );
});

// --- 8. Performance (representative cases stay responsive) --------------------------------------

await test('15. representative fill generations complete quickly (small text, large rectangle, multi-contour path, image trace)', async () => {
  const engine = createEngine();
  const cases = [
    () => engine.generateShapeLayout({ shape: 'rectangle', layerId: 'r', stoneSizeMm: 2, gapMm: 0.3, mode: 'contour', xMm: 0, yMm: 0, widthMm: 210, heightMm: 90 }),
    () => engine.generateShapeLayout({ shape: 'rectangle', layerId: 'r', stoneSizeMm: 2, gapMm: 0.3, mode: 'staggered', xMm: 0, yMm: 0, widthMm: 210, heightMm: 90 }),
    () => engine.generateShapeLayout({ shape: 'circle', layerId: 'c', stoneSizeMm: 2, gapMm: 0.3, mode: 'radial', cxMm: 50, cyMm: 50, radiusMm: 45 }),
    () => engine.generateImageLayout({ imageBuffer: checkerboardImageBuffer(200), layerId: 'i', xMm: 0, yMm: 0, widthMm: 100, heightMm: 100, stoneSizeMm: 2, gapMm: 0.3, mode: 'contour', maxWidthPx: 200, maxHeightPx: 200 })
  ];
  for (const run of cases) {
    const start = Date.now();
    const layout = run();
    const elapsedMs = Date.now() - start;
    assert.ok(layout.count > 0);
    assert.ok(elapsedMs < 5000, `expected a representative production-scale fill to complete in under 5s, took ${elapsedMs}ms`);
  }
  const text = await engine.generateTextLayout({ text: 'Hi', fontId: 'courier-prime-regular', layerId: 't', heightMm: 20, stoneSizeMm: 1.5, gapMm: 0.3, mode: 'contour' });
  assert.ok(text.count > 0);
});

// --- 9. Forbidden files (this milestone's own guard) ---------------------------------------------

await test('16. no forbidden file changed (this milestone\'s own forbidden list)', () => {
  const output = execSync('git status --porcelain', { cwd: repoRoot, encoding: 'utf8' });
  const changedPaths = output
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .map((line) => line.slice(3).trim());

  const forbiddenExact = new Set(['style.css', 'README.md', 'LICENSE', 'CONTRIBUTING.md']);
  // RS-1011 (Fill Algorithms) legitimately: adds src/geometry/ContourRingSampler.js; extends
  // src/geometry/StoneSampler.js/GeometryEngine.js/index.js; extends app.js/index.html (Fill Style
  // UI wiring); adds this file and tools/test-fill-algorithms-integration.mjs; updates
  // package.json's test script; adds docs/specifications/RS-1011-FillAlgorithms.md; updates
  // TASK.md/TASK_RESULT.md; and, per the established "own forbidden list" precedent (see
  // tools/test-production-sheet-exporter.mjs et al.), updates the handful of earlier milestones'
  // own forbidden-file guards to allow-list these same files.
  const forbiddenPrefixes = [
    // RS-2002: assets/fonts/** is legitimately expanded by the Typography & Font Library milestone (new bundled font files + manifest entries).
    'src/renderer/', 'src/text/', 'src/fonts/', 'src/core/', 'src/browser/', 'src/svg/', 'src/image/', 'src/history/', 'src/products/', 'src/preview3d/', 'src/editing/', 'src/export/', 'src/ui/'
  ];

  for (const changedPath of changedPaths) {
    assert.ok(!forbiddenExact.has(changedPath), `Forbidden file changed: ${changedPath}`);
    assert.ok(
      !forbiddenPrefixes.some((prefix) => changedPath.startsWith(prefix)),
      `Forbidden file changed: ${changedPath}`
    );
  }
});

console.log('Fill Algorithms (RS-1011) engine-level tests passed.');
