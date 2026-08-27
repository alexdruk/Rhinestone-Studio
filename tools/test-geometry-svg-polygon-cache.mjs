import assert from 'node:assert/strict';
import { GeometryEngine } from '../src/geometry/index.js';

// M13 (perf/svg-polygon-content-cache) — GeometryEngine._svgNaturalPolygonCache: a content-addressed
// cache of an SVG document's flattened natural-coordinate polygons, keyed on the raw svgSource
// string. parseSvgDocument() + flattenContourToPolygon() are pure and deterministic and
// CURVE_FLATTEN_SEGMENTS is a module constant, so identical svgSource always yields identical
// output — the cache needs no invalidation. These tests pin the three behaviours that matter:
// determinism is preserved, placement is NOT cached (only the pre-placement polygons are), and the
// per-call Point2D mapping means a returned layout's data is never shared mutable state.

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

function makeSvgSource({ width = '50mm', height = '20mm', body } = {}) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">${body}</svg>`;
}

const MULTI_SHAPE_SVG = makeSvgSource({
  body: '<rect x="5" y="5" width="15" height="10"/><circle cx="35" cy="10" r="6"/>'
});

const BASE_PARAMS = {
  svgSource: MULTI_SHAPE_SVG,
  layerId: 'svg-1',
  stoneSizeMm: 2,
  gapMm: 0.3,
  mode: 'outline',
  color: 'gold'
};

await test('1. two consecutive generateSvgLayout() calls with identical params are deepEqual (determinism preserved through the cache)', () => {
  const engine = new GeometryEngine();
  const first = engine.generateSvgLayout(BASE_PARAMS);
  const second = engine.generateSvgLayout(BASE_PARAMS);
  assert.deepEqual(second.toJSON(), first.toJSON());
});

await test('2. same svgSource, different xMm/widthMm placements produce correctly different stone positions (cache does not leak placement)', () => {
  const engine = new GeometryEngine();

  const atOrigin = engine.generateSvgLayout({ ...BASE_PARAMS, xMm: 0, yMm: 0 });
  const shifted = engine.generateSvgLayout({ ...BASE_PARAMS, xMm: 100, yMm: 0 });

  // Every stone shifted by exactly +100mm in X, unchanged in Y.
  assert.equal(shifted.count, atOrigin.count);
  for (let i = 0; i < atOrigin.count; i++) {
    assert.ok(Math.abs((shifted.stones[i].xMm - atOrigin.stones[i].xMm) - 100) < 1e-9, 'expected a pure +100mm X shift');
    assert.ok(Math.abs(shifted.stones[i].yMm - atOrigin.stones[i].yMm) < 1e-9, 'expected Y unchanged');
  }

  // Doubling the placement width really widens the layout (natural size is the same cached input).
  const natural = engine.generateSvgLayout({ ...BASE_PARAMS, xMm: 0, yMm: 0 });
  const wide = engine.generateSvgLayout({ ...BASE_PARAMS, xMm: 0, yMm: 0, widthMm: 200, heightMm: 20 });
  assert.ok(wide.widthMm > natural.widthMm * 1.5, 'expected a much wider bounding box from a larger placement width');
});

await test('3. mutating returned geometry does not affect a subsequent call\'s output (cache never hands out its own Point2D objects)', () => {
  const engine = new GeometryEngine();

  const firstLayout = engine.generateSvgLayout(BASE_PARAMS);
  const layoutBaseline = firstLayout.toJSON();
  for (const stone of firstLayout.stones) {
    stone.xMm = 999999;
    stone.yMm = -999999;
  }

  // resolveSvgPolygons() returns the placed polygon points directly — the closest a caller gets
  // to the cached arrays. Mutating them must not corrupt the cache.
  const firstPolys = engine.resolveSvgPolygons(BASE_PARAMS);
  const polyBaseline = firstPolys.polygons.map((poly) => poly.map((p) => ({ xMm: p.xMm, yMm: p.yMm })));
  for (const poly of firstPolys.polygons) {
    for (const p of poly) { p.xMm = 555555; p.yMm = -555555; }
  }

  assert.deepEqual(engine.generateSvgLayout(BASE_PARAMS).toJSON(), layoutBaseline, 'a later layout must be unaffected');
  const secondPolys = engine.resolveSvgPolygons(BASE_PARAMS);
  assert.deepEqual(
    secondPolys.polygons.map((poly) => poly.map((p) => ({ xMm: p.xMm, yMm: p.yMm }))),
    polyBaseline,
    'a later resolveSvgPolygons() call must be unaffected by mutating an earlier result'
  );
});

await test('4. cache is bounded to 8 entries with FIFO eviction and stays correct after eviction', () => {
  const engine = new GeometryEngine();

  // 10 distinct documents -> 10 distinct svgSource keys; only the last 8 stay cached.
  const layouts = [];
  for (let i = 0; i < 10; i++) {
    const svgSource = makeSvgSource({ body: `<rect x="${i}" y="5" width="15" height="10"/>` });
    layouts.push(engine.generateSvgLayout({ ...BASE_PARAMS, svgSource }));
  }
  assert.equal(engine._svgNaturalPolygonCache.size, 8, 'expected the cache to be capped at 8 entries');

  // The first document was evicted; regenerating it must still produce byte-identical output to
  // the original (re-parse path is equivalent to the cached path).
  const reSvg = makeSvgSource({ body: '<rect x="0" y="5" width="15" height="10"/>' });
  const regenerated = engine.generateSvgLayout({ ...BASE_PARAMS, svgSource: reSvg });
  assert.deepEqual(regenerated.toJSON(), layouts[0].toJSON());
});

await test('5. resolveSvgPolygons() and generateSvgLayout() agree on placed closed-contour geometry (both call sites unchanged by the split)', () => {
  const engine = new GeometryEngine();
  const params = { ...BASE_PARAMS, xMm: 12, yMm: 7, widthMm: 80, heightMm: 30 };

  const { polygons, boundingBox } = engine.resolveSvgPolygons(params);
  assert.ok(polygons.length > 0 && boundingBox, 'expected resolved closed polygons and a bounding box');

  // Fill-mode stones must all land inside the resolved outline's bounding box.
  const fill = engine.generateSvgLayout({ ...params, mode: 'fill' });
  for (const stone of fill.stones) {
    assert.ok(
      stone.xMm >= boundingBox.minXmm - 1e-6 && stone.xMm <= boundingBox.maxXmm + 1e-6 &&
      stone.yMm >= boundingBox.minYmm - 1e-6 && stone.yMm <= boundingBox.maxYmm + 1e-6,
      'expected fill stones within the resolved polygon bounding box'
    );
  }
});
