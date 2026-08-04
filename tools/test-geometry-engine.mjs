import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FontManager } from '../src/fonts/index.js';
import { createDefaultFontProviderRegistry } from '../src/text/index.js';
import { GeometryEngine } from '../src/geometry/index.js';
import { createImageBuffer } from '../src/image/index.js';

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

const BASE_PARAMS = {
  text: 'Vitalina',
  fontId: 'courier-prime-regular',
  layerId: 'layer-1',
  heightMm: 12,
  stoneSizeMm: 2,
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

await test('1. geometry generation succeeds for Courier Prime', async () => {
  const engine = createEngine();
  const layout = await engine.generateTextLayout({ ...BASE_PARAMS, fontId: 'courier-prime-regular' });

  assert.ok(layout.count > 0, 'expected at least one stone');
});

await test('2. geometry generation succeeds for Great Vibes', async () => {
  const engine = createEngine();
  const layout = await engine.generateTextLayout({ ...BASE_PARAMS, fontId: 'great-vibes-regular' });

  assert.ok(layout.count > 0, 'expected at least one stone');
});

await test('3. different fonts produce different layouts', async () => {
  const engine = createEngine();
  const courier = await engine.generateTextLayout({ ...BASE_PARAMS, fontId: 'courier-prime-regular' });
  const greatVibes = await engine.generateTextLayout({ ...BASE_PARAMS, fontId: 'great-vibes-regular' });

  assert.notDeepEqual(courier.toJSON().stones, greatVibes.toJSON().stones);
});

await test('4. font size changes bounding box', async () => {
  const engine = createEngine();
  const small = await engine.generateTextLayout({ ...BASE_PARAMS, heightMm: 10 });
  const large = await engine.generateTextLayout({ ...BASE_PARAMS, heightMm: 20 });

  assert.ok(large.widthMm > small.widthMm, 'expected a taller layout to also be wider');
  assert.ok(large.heightMm > small.heightMm, 'expected a taller layout to have a larger bounding box height');
});

await test('5. letter spacing changes layout width', async () => {
  const engine = createEngine();
  const tight = await engine.generateTextLayout({ ...BASE_PARAMS, letterSpacingMm: 0 });
  const wide = await engine.generateTextLayout({ ...BASE_PARAMS, letterSpacingMm: 4 });

  assert.ok(wide.widthMm > tight.widthMm, 'expected extra letter spacing to widen the layout');
});

await test('6. stone size changes geometry', async () => {
  const engine = createEngine();
  const small = await engine.generateTextLayout({ ...BASE_PARAMS, stoneSizeMm: 2 });
  const large = await engine.generateTextLayout({ ...BASE_PARAMS, stoneSizeMm: 4 });

  assert.notEqual(small.count, large.count, 'expected stone size to change the total stone count');
});

await test('7. gap changes geometry', async () => {
  const engine = createEngine();
  const tight = await engine.generateTextLayout({ ...BASE_PARAMS, gapMm: 0.2 });
  const loose = await engine.generateTextLayout({ ...BASE_PARAMS, gapMm: 1.5 });

  assert.notEqual(tight.count, loose.count, 'expected gap to change the total stone count');
});

await test('8. outline mode is deterministic', async () => {
  const engine = createEngine();
  const first = await engine.generateTextLayout({ ...BASE_PARAMS, mode: 'outline' });
  const second = await engine.generateTextLayout({ ...BASE_PARAMS, mode: 'outline' });

  assert.deepEqual(first.toJSON(), second.toJSON());
});

await test('9. fill mode is deterministic', async () => {
  const engine = createEngine();
  const first = await engine.generateTextLayout({ ...BASE_PARAMS, mode: 'fill' });
  const second = await engine.generateTextLayout({ ...BASE_PARAMS, mode: 'fill' });

  assert.deepEqual(first.toJSON(), second.toJSON());
  assert.ok(first.count > 0, 'expected fill mode to place at least one stone');
});

await test('10. generated coordinates are finite', async () => {
  const engine = createEngine();
  const layout = await engine.generateTextLayout(BASE_PARAMS);

  assert.ok(layout.count > 0);
  for (const stone of layout.stones) {
    assert.ok(Number.isFinite(stone.xMm));
    assert.ok(Number.isFinite(stone.yMm));
    assert.ok(Number.isFinite(stone.sizeMm));
  }
});

await test('11. generated coordinates use millimeters', async () => {
  const engine = createEngine();
  const small = await engine.generateTextLayout({ ...BASE_PARAMS, heightMm: 10 });
  const large = await engine.generateTextLayout({ ...BASE_PARAMS, heightMm: 20 });

  // Doubling the requested text height in millimeters should roughly double
  // the resulting bounding box height, confirming coordinates scale linearly
  // with the millimeter input rather than being fixed pixel-like units.
  const ratio = large.heightMm / small.heightMm;
  assert.ok(ratio > 1.5 && ratio < 2.5, `expected bounding box height to scale with heightMm, got ratio ${ratio}`);
});

await test('12. GeometryEngine has no dependency on DOM, Canvas, WebGL, renderer, or exporter', async () => {
  const geometrySourceFiles = [
    'src/geometry/GeometryEngine.js',
    'src/geometry/ContourGeometry.js',
    'src/geometry/StoneSampler.js',
    'src/geometry/Stone.js',
    'src/geometry/StoneLayout.js',
    'src/geometry/index.js'
  ];

  const forbiddenTokens = ['document.', 'window.', 'getContext', 'WebGLRenderingContext', 'src/renderer', 'src/export'];

  for (const relativePath of geometrySourceFiles) {
    const source = await readFile(path.join(repoRoot, relativePath), 'utf8');
    for (const token of forbiddenTokens) {
      assert.ok(!source.includes(token), `${relativePath} must not reference "${token}"`);
    }
  }
});

await test('outline mode works', async () => {
  const engine = createEngine();
  const layout = await engine.generateTextLayout({ ...BASE_PARAMS, mode: 'outline' });

  assert.equal(layout.sourceMode, 'outline');
  assert.ok(layout.count > 0);
});

await test('fill mode works', async () => {
  const engine = createEngine();
  const layout = await engine.generateTextLayout({ ...BASE_PARAMS, mode: 'fill' });

  assert.equal(layout.sourceMode, 'fill');
  assert.ok(layout.count > 0);
});

await test('every stone carries the requested layerId', async () => {
  const engine = createEngine();
  const layout = await engine.generateTextLayout({ ...BASE_PARAMS, layerId: 'layer-42' });

  assert.equal(layout.layerId, 'layer-42');
  for (const stone of layout.stones) {
    assert.equal(stone.layerId, 'layer-42');
  }
});

// RS-0003.5C1 — generateShapeLayout() (circle/rectangle), sharing the same contour-flattening
// and outline/fill sampling primitives as generateTextLayout() above.

const BASE_CIRCLE_PARAMS = {
  shape: 'circle',
  layerId: 'circle-1',
  cxMm: 105,
  cyMm: 45,
  radiusMm: 18,
  stoneSizeMm: 2,
  gapMm: 0.3,
  mode: 'outline',
  color: 'gold'
};

const BASE_RECT_PARAMS = {
  shape: 'rectangle',
  layerId: 'rect-1',
  xMm: 65,
  yMm: 30,
  widthMm: 80,
  heightMm: 30,
  stoneSizeMm: 2,
  gapMm: 0.3,
  mode: 'outline',
  color: 'gold'
};

await test('13. circle shape generation succeeds', () => {
  const engine = createEngine();
  const layout = engine.generateShapeLayout(BASE_CIRCLE_PARAMS);

  assert.ok(layout.count > 0, 'expected at least one stone');
});

await test('14. rectangle shape generation succeeds', () => {
  const engine = createEngine();
  const layout = engine.generateShapeLayout(BASE_RECT_PARAMS);

  assert.ok(layout.count > 0, 'expected at least one stone');
});

await test('15. stone size changes circle/rectangle stone count', () => {
  const engine = createEngine();
  const smallCircle = engine.generateShapeLayout({ ...BASE_CIRCLE_PARAMS, stoneSizeMm: 2 });
  const largeCircle = engine.generateShapeLayout({ ...BASE_CIRCLE_PARAMS, stoneSizeMm: 4 });
  assert.notEqual(smallCircle.count, largeCircle.count);

  const smallRect = engine.generateShapeLayout({ ...BASE_RECT_PARAMS, stoneSizeMm: 2 });
  const largeRect = engine.generateShapeLayout({ ...BASE_RECT_PARAMS, stoneSizeMm: 4 });
  assert.notEqual(smallRect.count, largeRect.count);
});

await test('16. gap changes circle/rectangle stone count', () => {
  const engine = createEngine();
  const tightCircle = engine.generateShapeLayout({ ...BASE_CIRCLE_PARAMS, gapMm: 0.2 });
  const looseCircle = engine.generateShapeLayout({ ...BASE_CIRCLE_PARAMS, gapMm: 2 });
  assert.notEqual(tightCircle.count, looseCircle.count);

  const tightRect = engine.generateShapeLayout({ ...BASE_RECT_PARAMS, gapMm: 0.2 });
  const looseRect = engine.generateShapeLayout({ ...BASE_RECT_PARAMS, gapMm: 2 });
  assert.notEqual(tightRect.count, looseRect.count);
});

await test('17. circle and rectangle outline generation is deterministic', () => {
  const engine = createEngine();

  const circleFirst = engine.generateShapeLayout(BASE_CIRCLE_PARAMS);
  const circleSecond = engine.generateShapeLayout(BASE_CIRCLE_PARAMS);
  assert.deepEqual(circleFirst.toJSON(), circleSecond.toJSON());

  const rectFirst = engine.generateShapeLayout(BASE_RECT_PARAMS);
  const rectSecond = engine.generateShapeLayout(BASE_RECT_PARAMS);
  assert.deepEqual(rectFirst.toJSON(), rectSecond.toJSON());
});

await test('18. circle generated coordinates are finite, in millimeters, and scale with radius', () => {
  const engine = createEngine();
  const small = engine.generateShapeLayout({ ...BASE_CIRCLE_PARAMS, radiusMm: 10 });
  const large = engine.generateShapeLayout({ ...BASE_CIRCLE_PARAMS, radiusMm: 20 });

  assert.ok(small.count > 0 && large.count > 0);
  for (const stone of [...small.stones, ...large.stones]) {
    assert.ok(Number.isFinite(stone.xMm));
    assert.ok(Number.isFinite(stone.yMm));
    assert.ok(Number.isFinite(stone.sizeMm));
  }

  const ratio = large.widthMm / small.widthMm;
  assert.ok(ratio > 1.5 && ratio < 2.5, `expected bounding box width to scale with radiusMm, got ratio ${ratio}`);
});

await test('19. every circle/rectangle stone carries the requested layerId and color', () => {
  const engine = createEngine();

  const circle = engine.generateShapeLayout({ ...BASE_CIRCLE_PARAMS, layerId: 'circle-42', color: 'sapphire' });
  assert.equal(circle.layerId, 'circle-42');
  for (const stone of circle.stones) {
    assert.equal(stone.layerId, 'circle-42');
    assert.equal(stone.color, 'sapphire');
  }

  const rect = engine.generateShapeLayout({ ...BASE_RECT_PARAMS, layerId: 'rect-42', color: 'jet' });
  assert.equal(rect.layerId, 'rect-42');
  for (const stone of rect.stones) {
    assert.equal(stone.layerId, 'rect-42');
    assert.equal(stone.color, 'jet');
  }
});

await test('20. an invalid shape value throws a clear error', () => {
  const engine = createEngine();
  assert.throws(
    () => engine.generateShapeLayout({ ...BASE_CIRCLE_PARAMS, shape: 'triangle' }),
    /shape to be one of/
  );
});

await test('21. generateShapeLayout works with no fontProviderRegistry; generateTextLayout throws in that case', async () => {
  const engine = new GeometryEngine();

  assert.equal(engine.canGenerateText, false);
  const layout = engine.generateShapeLayout(BASE_CIRCLE_PARAMS);
  assert.ok(layout.count > 0, 'expected shape generation to work without a fontProviderRegistry');

  await assert.rejects(
    () => engine.generateTextLayout(BASE_PARAMS),
    /requires a fontProviderRegistry/
  );
});

// RS-1001 — generateSvgLayout(), sharing the same contour-flattening and outline/fill sampling
// primitives as generateTextLayout()/generateShapeLayout() above, via src/svg's parseSvgDocument().

function makeSvgSource({ width = '50mm', height = '20mm', body } = {}) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">${body}</svg>`;
}

const MULTI_SHAPE_SVG = makeSvgSource({
  body: '<rect x="5" y="5" width="15" height="10"/><circle cx="35" cy="10" r="6"/>'
});

const OPEN_ONLY_SVG = makeSvgSource({ body: '<line x1="0" y1="0" x2="40" y2="15"/>' });

const BASE_SVG_PARAMS = {
  svgSource: MULTI_SHAPE_SVG,
  layerId: 'svg-1',
  stoneSizeMm: 2,
  gapMm: 0.3,
  mode: 'outline',
  color: 'gold'
};

await test('22. SVG generation succeeds and produces stones for a multi-shape document', () => {
  const engine = createEngine();
  const layout = engine.generateSvgLayout(BASE_SVG_PARAMS);
  assert.ok(layout.count > 0, 'expected at least one stone');
});

await test('23. requested widthMm/heightMm placement scales the generated bounding box (independent X/Y scaling)', () => {
  const engine = createEngine();
  const natural = engine.generateSvgLayout(BASE_SVG_PARAMS);
  const scaledBoth = engine.generateSvgLayout({ ...BASE_SVG_PARAMS, xMm: 0, yMm: 0, widthMm: 100, heightMm: 40 });
  const scaledWidthOnly = engine.generateSvgLayout({ ...BASE_SVG_PARAMS, xMm: 0, yMm: 0, widthMm: 500, heightMm: 20 });

  assert.ok(scaledBoth.widthMm > natural.widthMm * 1.5, 'expected doubling declared width/height to widen the bounding box');
  assert.ok(scaledBoth.heightMm > natural.heightMm * 1.5, 'expected doubling declared width/height to heighten the bounding box');
  assert.ok(scaledWidthOnly.widthMm > scaledBoth.widthMm, 'expected a much larger independent widthMm to widen further without affecting height the same way');
  assert.ok(scaledWidthOnly.heightMm < scaledBoth.heightMm, 'expected independent X/Y scaling: a huge widthMm alone must not inflate heightMm');
});

await test('24. fill mode places stones inside closed shapes only; an open-only document in fill mode still outline-samples (no error)', () => {
  const engine = createEngine();
  const outline = engine.generateSvgLayout({ ...BASE_SVG_PARAMS, mode: 'outline' });
  const fill = engine.generateSvgLayout({ ...BASE_SVG_PARAMS, mode: 'fill' });
  assert.notEqual(outline.count, fill.count, 'expected fill mode to place a different stone count than outline mode');
  assert.ok(fill.count > 0);

  const openOutline = engine.generateSvgLayout({ ...BASE_SVG_PARAMS, svgSource: OPEN_ONLY_SVG, mode: 'outline' });
  const openFill = engine.generateSvgLayout({ ...BASE_SVG_PARAMS, svgSource: OPEN_ONLY_SVG, mode: 'fill' });
  assert.ok(openOutline.count > 0 && openFill.count > 0, 'expected an open-only document to still produce outline stones in fill mode');
  assert.deepEqual(openOutline.toJSON().stones, openFill.toJSON().stones, 'expected fill mode to be identical to outline mode when no closed shape exists to fill');
});

await test('25. outline/fill SVG generation is deterministic', () => {
  const engine = createEngine();
  const outlineFirst = engine.generateSvgLayout({ ...BASE_SVG_PARAMS, mode: 'outline' });
  const outlineSecond = engine.generateSvgLayout({ ...BASE_SVG_PARAMS, mode: 'outline' });
  assert.deepEqual(outlineFirst.toJSON(), outlineSecond.toJSON());

  const fillFirst = engine.generateSvgLayout({ ...BASE_SVG_PARAMS, mode: 'fill' });
  const fillSecond = engine.generateSvgLayout({ ...BASE_SVG_PARAMS, mode: 'fill' });
  assert.deepEqual(fillFirst.toJSON(), fillSecond.toJSON());
});

await test('26. SVG generated coordinates are finite and in millimeters', () => {
  const engine = createEngine();
  const layout = engine.generateSvgLayout(BASE_SVG_PARAMS);
  assert.ok(layout.count > 0);
  for (const stone of layout.stones) {
    assert.ok(Number.isFinite(stone.xMm));
    assert.ok(Number.isFinite(stone.yMm));
    assert.ok(Number.isFinite(stone.sizeMm));
  }
});

await test('27. every SVG stone carries the requested layerId and color', () => {
  const engine = createEngine();
  const layout = engine.generateSvgLayout({ ...BASE_SVG_PARAMS, layerId: 'svg-42', color: 'emerald' });
  assert.equal(layout.layerId, 'svg-42');
  for (const stone of layout.stones) {
    assert.equal(stone.layerId, 'svg-42');
    assert.equal(stone.color, 'emerald');
  }
});

await test('28. a malformed/empty svgSource throws a clear error from generateSvgLayout()', () => {
  const engine = createEngine();
  assert.throws(() => engine.generateSvgLayout({ ...BASE_SVG_PARAMS, svgSource: '' }), /non-empty svgSource/);
  assert.throws(
    () => engine.generateSvgLayout({ ...BASE_SVG_PARAMS, svgSource: '<svg width="1mm" height="1mm"><image href="x"/></svg>' }),
    /no supported shapes/
  );
});

await test('29. generateSvgLayout works with no fontProviderRegistry supplied', () => {
  const engine = new GeometryEngine();
  const layout = engine.generateSvgLayout(BASE_SVG_PARAMS);
  assert.ok(layout.count > 0, 'expected SVG generation to work without a fontProviderRegistry');
});

await test('30. an extreme placement size producing a very large fill stone count does not overflow the call stack', () => {
  // Regression: generateSvgLayout()'s fill mode used to accumulate samples via
  // `points.push(...sampleFillPoints(...))`, a single spread of the entire sample array. Once that
  // array grows past the JS engine's call-argument limit (~100k-150k on this engine, empirically
  // verified), it throws "RangeError: Maximum call stack size exceeded" instead of producing a
  // layout. A user stretching an SVG layer to a large placed size (e.g. a large-format banner,
  // well within plausible manufacturing scale) reaches that count through ordinary UI resizing,
  // not a contrived input.
  const engine = createEngine();
  const layout = engine.generateSvgLayout({
    ...BASE_SVG_PARAMS,
    xMm: 0,
    yMm: 0,
    widthMm: 1000,
    heightMm: 1000,
    stoneSizeMm: 1,
    gapMm: 0,
    mode: 'fill'
  });
  assert.ok(layout.count > 150000, `expected a very large stone count, got ${layout.count}`);
  for (const stone of layout.stones) {
    assert.ok(Number.isFinite(stone.xMm) && Number.isFinite(stone.yMm), 'expected finite stone coordinates');
  }
});

// RS-1003 — curved text. BASE_PARAMS is reused with curveEnabled omitted/false above, confirming
// straight text; the tests below turn curveEnabled on and exercise the arc-projection stage of
// generateTextLayout() end-to-end (real fonts, real GeometryEngine), complementing
// tools/test-arc-projection.mjs's isolated math-only unit tests.

const BASE_CURVE_PARAMS = {
  ...BASE_PARAMS,
  curveEnabled: true,
  curveRadiusMm: 40,
  curveDirection: 'outside',
  curveStartAngleDeg: 0,
  curveSweepAngleDeg: 120,
  curveAlignment: 'center'
};

await test('31. curveEnabled omitted/false reproduces the exact straight-text layout (regression)', async () => {
  const engine = createEngine();
  const withoutField = await engine.generateTextLayout(BASE_PARAMS);
  const explicitlyFalse = await engine.generateTextLayout({ ...BASE_PARAMS, curveEnabled: false });
  assert.deepEqual(withoutField.toJSON(), explicitlyFalse.toJSON());
});

await test('32. curved (outside) text produces a valid, non-empty layout distinct from straight text', async () => {
  const engine = createEngine();
  const straight = await engine.generateTextLayout(BASE_PARAMS);
  const curved = await engine.generateTextLayout(BASE_CURVE_PARAMS);
  assert.ok(curved.count > 0, 'expected at least one stone');
  assert.notDeepEqual(straight.toJSON().stones, curved.toJSON().stones);
});

await test('33. outside and inside curves produce different layouts for identical other params', async () => {
  const engine = createEngine();
  const outside = await engine.generateTextLayout({ ...BASE_CURVE_PARAMS, curveDirection: 'outside' });
  const inside = await engine.generateTextLayout({ ...BASE_CURVE_PARAMS, curveDirection: 'inside' });
  assert.notDeepEqual(outside.toJSON().stones, inside.toJSON().stones);
});

await test('34. positive (clockwise) and negative (counter-clockwise) sweep produce different layouts', async () => {
  const engine = createEngine();
  const clockwise = await engine.generateTextLayout({ ...BASE_CURVE_PARAMS, curveSweepAngleDeg: 120 });
  const counterClockwise = await engine.generateTextLayout({ ...BASE_CURVE_PARAMS, curveSweepAngleDeg: -120 });
  assert.notDeepEqual(clockwise.toJSON().stones, counterClockwise.toJSON().stones);
});

await test('35. start/center/end alignment produce different bounding boxes', async () => {
  const engine = createEngine();
  const start = await engine.generateTextLayout({ ...BASE_CURVE_PARAMS, curveAlignment: 'start' });
  const center = await engine.generateTextLayout({ ...BASE_CURVE_PARAMS, curveAlignment: 'center' });
  const end = await engine.generateTextLayout({ ...BASE_CURVE_PARAMS, curveAlignment: 'end' });
  assert.notDeepEqual(start.getBoundingBox().toJSON(), center.getBoundingBox().toJSON());
  assert.notDeepEqual(center.getBoundingBox().toJSON(), end.getBoundingBox().toJSON());
  assert.notDeepEqual(start.getBoundingBox().toJSON(), end.getBoundingBox().toJSON());
});

await test('36. curved text works in fill mode', async () => {
  const engine = createEngine();
  const layout = await engine.generateTextLayout({ ...BASE_CURVE_PARAMS, mode: 'fill' });
  assert.equal(layout.sourceMode, 'fill');
  assert.ok(layout.count > 0);
});

await test('37. curved text works in outline mode', async () => {
  const engine = createEngine();
  const layout = await engine.generateTextLayout({ ...BASE_CURVE_PARAMS, mode: 'outline' });
  assert.equal(layout.sourceMode, 'outline');
  assert.ok(layout.count > 0);
});

await test('38. curved text generation is deterministic', async () => {
  const engine = createEngine();
  const first = await engine.generateTextLayout(BASE_CURVE_PARAMS);
  const second = await engine.generateTextLayout(BASE_CURVE_PARAMS);
  assert.deepEqual(first.toJSON(), second.toJSON());
});

await test('39. every curved-text stone coordinate is finite (small radius stress case included)', async () => {
  const engine = createEngine();
  const layout = await engine.generateTextLayout({ ...BASE_CURVE_PARAMS, curveRadiusMm: 2, curveSweepAngleDeg: 360 });
  assert.ok(layout.count > 0);
  for (const stone of layout.stones) {
    assert.ok(Number.isFinite(stone.xMm));
    assert.ok(Number.isFinite(stone.yMm));
  }
});

await test('40. rejects curveRadiusMm <= 0, NaN, and Infinity', async () => {
  const engine = createEngine();
  await assert.rejects(() => engine.generateTextLayout({ ...BASE_CURVE_PARAMS, curveRadiusMm: 0 }));
  await assert.rejects(() => engine.generateTextLayout({ ...BASE_CURVE_PARAMS, curveRadiusMm: -5 }));
  await assert.rejects(() => engine.generateTextLayout({ ...BASE_CURVE_PARAMS, curveRadiusMm: NaN }));
  await assert.rejects(() => engine.generateTextLayout({ ...BASE_CURVE_PARAMS, curveRadiusMm: Infinity }));
});

await test('41. rejects curveSweepAngleDeg of 0, NaN, and Infinity', async () => {
  const engine = createEngine();
  await assert.rejects(() => engine.generateTextLayout({ ...BASE_CURVE_PARAMS, curveSweepAngleDeg: 0 }));
  await assert.rejects(() => engine.generateTextLayout({ ...BASE_CURVE_PARAMS, curveSweepAngleDeg: NaN }));
  await assert.rejects(() => engine.generateTextLayout({ ...BASE_CURVE_PARAMS, curveSweepAngleDeg: Infinity }));
});

await test('42. rejects an invalid curveDirection or curveAlignment', async () => {
  const engine = createEngine();
  await assert.rejects(() => engine.generateTextLayout({ ...BASE_CURVE_PARAMS, curveDirection: 'sideways' }));
  await assert.rejects(() => engine.generateTextLayout({ ...BASE_CURVE_PARAMS, curveAlignment: 'middle' }));
});

await test('43. curveEnabled:false ignores otherwise-invalid curve fields (straight text never validates them)', async () => {
  const engine = createEngine();
  const layout = await engine.generateTextLayout({ ...BASE_PARAMS, curveEnabled: false, curveRadiusMm: -1, curveSweepAngleDeg: 0, curveDirection: 'nonsense' });
  assert.ok(layout.count > 0, 'expected straight text to generate normally despite garbage curve fields');
});

// RS-1008A — generateImageLayout() coverage (mirroring the generateSvgLayout() block above).
// Image Trace's grid sampling (sampleFieldFillPoints() in StoneSampler.js) and Stone/StoneLayout
// construction now live in the permanent engine, exactly like every other layer type — this
// replaces the equivalent behavioral coverage that tools/test-image-trace-pipeline.mjs (RS-1008)
// had against the now-removed src/image/ImageTracePipeline.js. See
// docs/specifications/RS-1008A-ImageTraceArchitectureCorrection.md.
function halfBlackHalfWhiteImageBuffer(widthPx, heightPx) {
  const data = new Uint8ClampedArray(widthPx * heightPx * 4);
  for (let y = 0; y < heightPx; y++) {
    for (let x = 0; x < widthPx; x++) {
      const i = (y * widthPx + x) * 4;
      const v = x < widthPx / 2 ? 0 : 255;
      data[i] = v; data[i + 1] = v; data[i + 2] = v; data[i + 3] = 255;
    }
  }
  return createImageBuffer({ widthPx, heightPx, data });
}
function gradientImageBuffer(widthPx, heightPx) {
  const data = new Uint8ClampedArray(widthPx * heightPx * 4);
  for (let y = 0; y < heightPx; y++) {
    for (let x = 0; x < widthPx; x++) {
      const i = (y * widthPx + x) * 4;
      const v = Math.round((x / (widthPx - 1)) * 255);
      data[i] = v; data[i + 1] = v; data[i + 2] = v; data[i + 3] = 255;
    }
  }
  return createImageBuffer({ widthPx, heightPx, data });
}
function solidColorImageBuffer(widthPx, heightPx, [r, g, b, a]) {
  const data = new Uint8ClampedArray(widthPx * heightPx * 4);
  for (let i = 0; i < widthPx * heightPx; i++) {
    data[i * 4] = r; data[i * 4 + 1] = g; data[i * 4 + 2] = b; data[i * 4 + 3] = a;
  }
  return createImageBuffer({ widthPx, heightPx, data });
}
const BASE_IMAGE_PARAMS = { layerId: 'image-1', xMm: 0, yMm: 0, widthMm: 20, heightMm: 20, stoneSizeMm: 1, gapMm: 0.2, color: 'gold', maxWidthPx: 64, maxHeightPx: 64 };

await test('44. generateImageLayout(): a shape buffer traces to a non-empty StoneLayout with stones only over the foreground half', () => {
  const engine = createEngine();
  const buffer = halfBlackHalfWhiteImageBuffer(20, 20);
  const layout = engine.generateImageLayout({ imageBuffer: buffer, ...BASE_IMAGE_PARAMS });
  assert.ok(layout.count > 0);
  assert.ok(layout.stones.every((s) => s.xMm < BASE_IMAGE_PARAMS.xMm + BASE_IMAGE_PARAMS.widthMm / 2 + 0.5));
});

await test('45. generateImageLayout(): invert:true flips which half produces stones', () => {
  const engine = createEngine();
  const buffer = halfBlackHalfWhiteImageBuffer(20, 20);
  const layout = engine.generateImageLayout({ imageBuffer: buffer, ...BASE_IMAGE_PARAMS, invert: true });
  assert.ok(layout.count > 0);
  assert.ok(layout.stones.every((s) => s.xMm > BASE_IMAGE_PARAMS.xMm + BASE_IMAGE_PARAMS.widthMm / 2 - 0.5));
});

await test('46. generateImageLayout(): increasing threshold (lighter cutoff) increases traced foreground area for a gradient', () => {
  const engine = createEngine();
  const buffer = gradientImageBuffer(40, 10);
  const low = engine.generateImageLayout({ imageBuffer: buffer, ...BASE_IMAGE_PARAMS, threshold: 60 });
  const high = engine.generateImageLayout({ imageBuffer: buffer, ...BASE_IMAGE_PARAMS, threshold: 200 });
  assert.ok(high.count > low.count, `expected higher threshold to trace more area (${high.count} vs ${low.count})`);
});

await test('47. generateImageLayout(): blurRadiusPx softens a sharp edge without crashing or producing non-finite coordinates', () => {
  const engine = createEngine();
  const buffer = halfBlackHalfWhiteImageBuffer(20, 20);
  const sharp = engine.generateImageLayout({ imageBuffer: buffer, ...BASE_IMAGE_PARAMS, blurRadiusPx: 0 });
  const blurred = engine.generateImageLayout({ imageBuffer: buffer, ...BASE_IMAGE_PARAMS, blurRadiusPx: 3 });
  for (const layout of [sharp, blurred]) {
    for (const stone of layout.stones) {
      assert.ok(Number.isFinite(stone.xMm) && Number.isFinite(stone.yMm));
    }
  }
  assert.ok(blurred.count >= sharp.count * 0.5, 'blur should not drastically shrink the traced area');
});

await test('48. generateImageLayout(): maxWidthPx/maxHeightPx actually bound the working resolution (resize is applied, not a no-op)', () => {
  const engine = createEngine();
  const buffer = halfBlackHalfWhiteImageBuffer(200, 200);
  const capped = engine.generateImageLayout({ imageBuffer: buffer, ...BASE_IMAGE_PARAMS, maxWidthPx: 8, maxHeightPx: 8 });
  const uncapped = engine.generateImageLayout({ imageBuffer: buffer, ...BASE_IMAGE_PARAMS, maxWidthPx: 200, maxHeightPx: 200 });
  assert.ok(capped.count > 0);
  assert.ok(uncapped.count > 0);
  const maxXCapped = Math.max(...capped.stones.map((s) => s.xMm));
  const maxXUncapped = Math.max(...uncapped.stones.map((s) => s.xMm));
  assert.ok(Math.abs(maxXCapped - maxXUncapped) < 3, 'traced extent should be comparable regardless of working resolution');
});

await test('49. generateImageLayout(): requested xMm/yMm/widthMm/heightMm correctly place and scale the bounding box', () => {
  const engine = createEngine();
  const buffer = solidColorImageBuffer(10, 10, [0, 0, 0, 255]);
  const layout = engine.generateImageLayout({ imageBuffer: buffer, ...BASE_IMAGE_PARAMS, xMm: 50, yMm: 30, widthMm: 10, heightMm: 5 });
  const box = layout.getBoundingBox();
  assert.ok(box.minXmm >= 49 && box.maxXmm <= 61.5, `expected placement near x=50..60, got ${box.minXmm}..${box.maxXmm}`);
  assert.ok(box.minYmm >= 29 && box.maxYmm <= 36.5, `expected placement near y=30..35, got ${box.minYmm}..${box.maxYmm}`);
});

await test('50. generateImageLayout(): every stone carries the requested layerId/color/sizeMm and finite mm coordinates', () => {
  const engine = createEngine();
  const buffer = solidColorImageBuffer(10, 10, [0, 0, 0, 255]);
  const layout = engine.generateImageLayout({ imageBuffer: buffer, ...BASE_IMAGE_PARAMS, layerId: 'my-layer', color: 'sapphire', stoneSizeMm: 1.5 });
  assert.ok(layout.count > 0);
  for (const stone of layout.stones) {
    assert.equal(stone.layerId, 'my-layer');
    assert.equal(stone.color, 'sapphire');
    assert.equal(stone.sizeMm, 1.5);
    assert.ok(Number.isFinite(stone.xMm) && Number.isFinite(stone.yMm));
  }
});

await test('51. generateImageLayout() is deterministic (deepEqual StoneLayout.toJSON() across two calls)', () => {
  const engine = createEngine();
  const buffer = halfBlackHalfWhiteImageBuffer(20, 20);
  const a = engine.generateImageLayout({ imageBuffer: buffer, ...BASE_IMAGE_PARAMS });
  const b = engine.generateImageLayout({ imageBuffer: buffer, ...BASE_IMAGE_PARAMS });
  assert.deepEqual(a.toJSON(), b.toJSON());
});

await test('52. generateImageLayout(): malformed params throw clear, parameter-naming errors', () => {
  const engine = createEngine();
  const buffer = solidColorImageBuffer(4, 4, [0, 0, 0, 255]);
  assert.throws(() => engine.generateImageLayout({ imageBuffer: buffer, ...BASE_IMAGE_PARAMS, layerId: '' }), /layerId/);
  assert.throws(() => engine.generateImageLayout({ imageBuffer: buffer, ...BASE_IMAGE_PARAMS, stoneSizeMm: 0 }), /stoneSizeMm/);
  assert.throws(() => engine.generateImageLayout({ imageBuffer: buffer, ...BASE_IMAGE_PARAMS, threshold: 300 }), /threshold/);
  assert.throws(() => engine.generateImageLayout({ imageBuffer: buffer, ...BASE_IMAGE_PARAMS, blurRadiusPx: -1 }), /blurRadiusPx/);
  assert.throws(() => engine.generateImageLayout({ imageBuffer: buffer, ...BASE_IMAGE_PARAMS, maxWidthPx: 0 }), /maxWidthPx/);
  assert.throws(() => engine.generateImageLayout({ imageBuffer: buffer, ...BASE_IMAGE_PARAMS, maxHeightPx: -5 }), /maxHeightPx/);
  assert.throws(() => engine.generateImageLayout({ ...BASE_IMAGE_PARAMS }), /imageBuffer/, 'a missing imageBuffer must throw');
});

await test('53. generateImageLayout(): an all-background buffer produces a valid, empty StoneLayout (not an error); works with no fontProviderRegistry', () => {
  const engineNoFonts = new GeometryEngine();
  const buffer = solidColorImageBuffer(10, 10, [255, 255, 255, 255]);
  const layout = engineNoFonts.generateImageLayout({ imageBuffer: buffer, ...BASE_IMAGE_PARAMS });
  assert.equal(layout.count, 0);
});

// ---------------------------------------------------------------------------------------------
// TXT-102 (Professional Text Layout): multi-line, alignment, line spacing, rotation.
// ---------------------------------------------------------------------------------------------

await test('54. text without a newline reproduces the exact single-line layout (regression) regardless of align/lineSpacing', async () => {
  const engine = createEngine();
  const baseline = await engine.generateTextLayout(BASE_PARAMS);
  const withNewFieldsAtDefault = await engine.generateTextLayout({ ...BASE_PARAMS, align: 'left', lineSpacing: 1, rotationDeg: 0 });
  const withNonDefaultAlignSpacing = await engine.generateTextLayout({ ...BASE_PARAMS, align: 'center', lineSpacing: 2.5 });
  assert.deepEqual(baseline.toJSON(), withNewFieldsAtDefault.toJSON());
  // align/lineSpacing only affect the relationship between multiple lines -- a single line has
  // nothing to align or space against, so both must still reproduce the exact same layout.
  assert.deepEqual(baseline.toJSON(), withNonDefaultAlignSpacing.toJSON());
});

await test('55. a two-line text block produces the same stones as its two lines generated independently and stacked by the default line-height pitch', async () => {
  const engine = createEngine();
  const twoLine = await engine.generateTextLayout({ ...BASE_PARAMS, text: 'Hi\nYou' });
  const lineOne = await engine.generateTextLayout({ ...BASE_PARAMS, text: 'Hi' });
  const lineTwo = await engine.generateTextLayout({ ...BASE_PARAMS, text: 'You' });
  const lineHeightMm = BASE_PARAMS.heightMm * 1.4; // TEXT_LINE_HEIGHT_RATIO, lineSpacing default 1
  const key = (s) => `${s.xMm.toFixed(3)},${s.yMm.toFixed(3)}`;
  const twoLineKeys = new Set(twoLine.stones.map(key));
  for (const stone of lineOne.stones) assert.ok(twoLineKeys.has(key(stone)), `expected line 1 stone ${key(stone)} unshifted`);
  for (const stone of lineTwo.stones) {
    const shifted = { xMm: stone.xMm, yMm: stone.yMm + lineHeightMm };
    assert.ok(twoLineKeys.has(key(shifted)), `expected line 2 stone ${key(stone)} shifted down by ${lineHeightMm}mm`);
  }
  assert.equal(twoLine.count, lineOne.count + lineTwo.count);
});

await test('56. empty lines are preserved -- a blank line still occupies a full line-height slot', async () => {
  const engine = createEngine();
  const withBlankLine = await engine.generateTextLayout({ ...BASE_PARAMS, text: 'Hi\n\nYou' });
  const withoutBlankLine = await engine.generateTextLayout({ ...BASE_PARAMS, text: 'Hi\nYou' });
  const lineHeightMm = BASE_PARAMS.heightMm * 1.4;
  assert.equal(withBlankLine.count, withoutBlankLine.count, 'a blank line contributes zero stones of its own');
  const minYWith = Math.min(...withBlankLine.stones.map((s) => s.yMm));
  const minYWithout = Math.min(...withoutBlankLine.stones.map((s) => s.yMm));
  const maxYWith = Math.max(...withBlankLine.stones.map((s) => s.yMm));
  const maxYWithout = Math.max(...withoutBlankLine.stones.map((s) => s.yMm));
  // The extra blank line pushes every subsequent line down by one more line-height, so the block's
  // total vertical extent (max - min) grows by exactly lineHeightMm; the first line's own position
  // (min) is unaffected since the blank line comes after it.
  assert.ok(Math.abs(minYWith - minYWithout) < 1e-6, 'first line position unaffected by a later blank line');
  assert.ok(Math.abs((maxYWith - minYWith) - (maxYWithout - minYWithout) - lineHeightMm) < 1e-6, 'blank line adds exactly one line-height of vertical extent');
});

await test('57. left alignment (default) never offsets any line horizontally, even when lines have very different widths', async () => {
  const engine = createEngine();
  const layout = await engine.generateTextLayout({ ...BASE_PARAMS, text: 'I\nVitalina' });
  const lineI = await engine.generateTextLayout({ ...BASE_PARAMS, text: 'I' });
  const lineHeightMm = BASE_PARAMS.heightMm * 1.4;
  const firstLineStones = layout.stones.filter((s) => s.yMm < lineHeightMm / 2);
  const key = (s) => `${s.xMm.toFixed(6)},${s.yMm.toFixed(6)}`;
  const firstLineKeys = new Set(firstLineStones.map(key));
  // Left alignment applies zero offset to every line (see textAlignOffsetMm()), so the first line's
  // own stones (isolated by y < half a line-height, since line 2's baseline sits a full line-height
  // below) must reproduce "I" generated alone, stone for stone.
  assert.equal(firstLineStones.length, lineI.count);
  for (const stone of lineI.stones) assert.ok(firstLineKeys.has(key(stone)), `expected "I" alone's stone (${key(stone)}) to reappear unshifted as the first line`);
});

await test('58. center alignment centers each line relative to the widest line', async () => {
  const engine = createEngine();
  const layout = await engine.generateTextLayout({ ...BASE_PARAMS, text: 'I\nVitalina', align: 'center' });
  const bb = layout.getBoundingBox();
  const lineHeightMm = BASE_PARAMS.heightMm * 1.4;
  const isSecondLine = (yMm) => yMm > lineHeightMm / 2;
  const firstLineStones = layout.stones.filter((s) => !isSecondLine(s.yMm));
  const secondLineStones = layout.stones.filter((s) => isSecondLine(s.yMm));
  assert.ok(firstLineStones.length > 0 && secondLineStones.length > 0);
  const firstLineCenter = (Math.min(...firstLineStones.map((s) => s.xMm)) + Math.max(...firstLineStones.map((s) => s.xMm))) / 2;
  const secondLineCenter = (Math.min(...secondLineStones.map((s) => s.xMm)) + Math.max(...secondLineStones.map((s) => s.xMm))) / 2;
  const blockCenter = (bb.minXmm + bb.maxXmm) / 2;
  // "I" is a single narrow glyph, so its own center is close to its line's pen-advance center;
  // both lines' visual centers should land close to the whole block's horizontal center.
  assert.ok(Math.abs(secondLineCenter - blockCenter) < 1, `expected the wide line's center (${secondLineCenter}) to anchor the block center (${blockCenter})`);
  assert.ok(Math.abs(firstLineCenter - blockCenter) < 2, `expected the narrow line's center (${firstLineCenter}) close to the block center (${blockCenter})`);
});

await test('59. right alignment flushes every line to the widest line\'s right edge', async () => {
  const engine = createEngine();
  const layout = await engine.generateTextLayout({ ...BASE_PARAMS, text: 'I\nVitalina', align: 'right' });
  const bb = layout.getBoundingBox();
  const lineHeightMm = BASE_PARAMS.heightMm * 1.4;
  const isSecondLine = (yMm) => yMm > lineHeightMm / 2;
  const firstLineStones = layout.stones.filter((s) => !isSecondLine(s.yMm));
  const maxXFirstLine = Math.max(...firstLineStones.map((s) => s.xMm));
  // Tolerance covers one outline-sample spacing (stoneSizeMm + gapMm here): 'outline' mode places
  // stones at fixed arc-length intervals along the glyph perimeter, which does not guarantee a
  // sample lands exactly on the true geometric edge -- the alignment math itself (textAlignOffsetMm())
  // is exact in pen-advance-width terms; this only allows for that sampling granularity.
  const sampleSpacingMm = BASE_PARAMS.stoneSizeMm + BASE_PARAMS.gapMm;
  assert.ok(Math.abs(maxXFirstLine - bb.maxXmm) < sampleSpacingMm * 1.5, `expected the short line's right edge (${maxXFirstLine}) to land on the block's right edge (${bb.maxXmm})`);
});

await test('60. lineSpacing multiplies the default line-height pitch proportionally', async () => {
  const engine = createEngine();
  const single = await engine.generateTextLayout({ ...BASE_PARAMS, text: 'Hi\nYou', lineSpacing: 1 });
  const doubled = await engine.generateTextLayout({ ...BASE_PARAMS, text: 'Hi\nYou', lineSpacing: 2 });
  const pitchAt = (layout) => Math.max(...layout.stones.map((s) => s.yMm)) - Math.min(...layout.stones.map((s) => s.yMm));
  // Not an exact 2x (each line's own glyph extent contributes a fixed amount regardless of spacing),
  // but doubling the spacing multiplier must clearly widen the block's total vertical extent.
  assert.ok(pitchAt(doubled) > pitchAt(single) * 1.5, `expected lineSpacing:2 (${pitchAt(doubled)}mm) to be substantially taller than lineSpacing:1 (${pitchAt(single)}mm)`);
});

await test('61. rotationDeg omitted/0 reproduces the exact unrotated layout (regression)', async () => {
  const engine = createEngine();
  const withoutField = await engine.generateTextLayout(BASE_PARAMS);
  const explicitZero = await engine.generateTextLayout({ ...BASE_PARAMS, rotationDeg: 0 });
  assert.deepEqual(withoutField.toJSON(), explicitZero.toJSON());
});

await test('62. rotationDeg:180 flips the layout through its own bounding-box center (every stone maps to its point-reflection)', async () => {
  const engine = createEngine();
  const straight = await engine.generateTextLayout(BASE_PARAMS);
  const rotated = await engine.generateTextLayout({ ...BASE_PARAMS, rotationDeg: 180 });
  const bb = straight.getBoundingBox();
  const cx = (bb.minXmm + bb.maxXmm) / 2, cy = (bb.minYmm + bb.maxYmm) / 2;
  // Distance-based matching (not string-key equality): a 180 degree rotation's cos(pi) is not
  // exactly -1 in floating point, so an expected reflection can land a machine-epsilon's distance
  // from its actual match (occasionally straddling a -0/0 string-formatting boundary) -- a real
  // bug would miss by orders of magnitude more than this tolerance.
  for (const stone of straight.stones) {
    const expectedXmm = 2 * cx - stone.xMm, expectedYmm = 2 * cy - stone.yMm;
    const closestDistance = Math.min(...rotated.stones.map((s) => Math.hypot(s.xMm - expectedXmm, s.yMm - expectedYmm)));
    assert.ok(closestDistance < 1e-6, `expected a point-reflected match near (${expectedXmm.toFixed(3)},${expectedYmm.toFixed(3)}) for original (${stone.xMm.toFixed(3)},${stone.yMm.toFixed(3)}), closest was ${closestDistance}mm away`);
  }
});

await test('63. rotationDeg is normalized into [0,360) -- 90, 450, and -270 produce the identical layout', async () => {
  const engine = createEngine();
  const at90 = await engine.generateTextLayout({ ...BASE_PARAMS, rotationDeg: 90 });
  const at450 = await engine.generateTextLayout({ ...BASE_PARAMS, rotationDeg: 450 });
  const atNeg270 = await engine.generateTextLayout({ ...BASE_PARAMS, rotationDeg: -270 });
  assert.deepEqual(at90.toJSON(), at450.toJSON());
  assert.deepEqual(at90.toJSON(), atNeg270.toJSON());
});

await test('64. rotating a multi-line, center-aligned block preserves stone count and keeps every coordinate finite', async () => {
  const engine = createEngine();
  const layout = await engine.generateTextLayout({ ...BASE_PARAMS, text: 'Hi\nVitalina\nYou', align: 'center', lineSpacing: 1.2, rotationDeg: 37 });
  assert.ok(layout.count > 0);
  for (const stone of layout.stones) assert.ok(Number.isFinite(stone.xMm) && Number.isFinite(stone.yMm));
});

await test('65. curved text combined with multiple lines fails explicitly rather than silently curving only one line', async () => {
  const engine = createEngine();
  await assert.rejects(
    () => engine.generateTextLayout({ ...BASE_CURVE_PARAMS, text: 'Hi\nYou' }),
    /multiple lines/
  );
});

await test('66. an invalid align value throws a clear, parameter-naming error', async () => {
  const engine = createEngine();
  await assert.rejects(() => engine.generateTextLayout({ ...BASE_PARAMS, align: 'justify' }), /align/);
});

await test('67. a non-positive lineSpacing throws a clear, parameter-naming error', async () => {
  const engine = createEngine();
  await assert.rejects(() => engine.generateTextLayout({ ...BASE_PARAMS, lineSpacing: 0 }), /lineSpacing/);
  await assert.rejects(() => engine.generateTextLayout({ ...BASE_PARAMS, lineSpacing: -1 }), /lineSpacing/);
});

await test('68. resolveTextPolygons() reflects multi-line layout and alignment but not rotation (documented limitation)', async () => {
  const engine = createEngine();
  const straightPolygons = await engine.resolveTextPolygons({ text: 'Hi\nYou', fontId: BASE_PARAMS.fontId, layerId: BASE_PARAMS.layerId, heightMm: BASE_PARAMS.heightMm, align: 'center' });
  const rotatedPolygons = await engine.resolveTextPolygons({ text: 'Hi\nYou', fontId: BASE_PARAMS.fontId, layerId: BASE_PARAMS.layerId, heightMm: BASE_PARAMS.heightMm, align: 'center', rotationDeg: 45 });
  // Two lines produced (a taller bbox than a single line) and rotation is a no-op on this API.
  assert.ok(straightPolygons.boundingBox.heightMm > BASE_PARAMS.heightMm, 'expected a two-line block to be taller than one line');
  assert.deepEqual(straightPolygons.boundingBox.toJSON(), rotatedPolygons.boundingBox.toJSON());
});

console.log('GeometryEngine tests passed.');
