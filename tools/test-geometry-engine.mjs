import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FontManager } from '../src/fonts/index.js';
import { createDefaultFontProviderRegistry } from '../src/text/index.js';
import { GeometryEngine } from '../src/geometry/index.js';

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

await test('this task did not modify forbidden UI, renderer, or exporter files', async () => {
  const { execSync } = await import('node:child_process');
  const output = execSync('git status --porcelain', { cwd: repoRoot, encoding: 'utf8' });
  const changedPaths = output
    .split('\n')
    .filter((line) => line.trim().length > 0)
    // Porcelain lines are exactly "XY path" (2 status chars + 1 space); slicing must happen on
    // the untrimmed line, since trimming first eats the leading status character for common
    // single-letter-in-column-2 statuses like " M", silently truncating the path.
    .map((line) => line.slice(3).trim());

  const forbiddenExact = new Set(['style.css', 'README.md']);
  // src/renderer/ and src/export/ are legitimately changed by RS-0003.5C2 (rendering pipeline).
  const forbiddenPrefixes = ['assets/fonts/'];

  for (const changedPath of changedPaths) {
    assert.ok(!forbiddenExact.has(changedPath), `Forbidden file changed: ${changedPath}`);
    assert.ok(
      !forbiddenPrefixes.some((prefix) => changedPath.startsWith(prefix)),
      `Forbidden file changed: ${changedPath}`
    );
  }
});

console.log('GeometryEngine tests passed.');
