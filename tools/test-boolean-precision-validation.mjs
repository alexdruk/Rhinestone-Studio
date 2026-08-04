import assert from 'node:assert/strict';
import { GeometryEngine, combineShapeSources, combineManyShapeSources, BooleanPrecisionError } from '../src/geometry/index.js';

// RS-1012A (Production Precision Validation) — automated regression tests for the findings in
// docs/specifications/RS-1012A-ProductionPrecisionValidation.md and tools/measure-boolean-precision.mjs
// (the full, slower measurement harness this file's thresholds were derived from; not part of
// `npm test` itself, matching tools/generate-example-baselines.mjs's precedent). Kept fast (no
// alignment-phase sweeps, no 8-shape chains) so it belongs in the regular suite.

const engine = new GeometryEngine();

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

function shoelaceArea(points) {
  let area = 0;
  for (let i = 0; i < points.length; i++) {
    const p1 = points[i], p2 = points[(i + 1) % points.length];
    area += p1.xMm * p2.yMm - p2.xMm * p1.yMm;
  }
  return Math.abs(area) / 2;
}
function polySource(polygons) { return { kind: 'polygons', polygons }; }
function rectanglePolygon(xMm, yMm, widthMm, heightMm) {
  return [{ xMm, yMm }, { xMm: xMm + widthMm, yMm }, { xMm: xMm + widthMm, yMm: yMm + heightMm }, { xMm, yMm: yMm + heightMm }];
}
function isPointInsidePolygon(point, contour) {
  let inside = false;
  for (let i = 0, j = contour.length - 1; i < contour.length; j = i++) {
    const vi = contour[i], vj = contour[j];
    if (((vi.yMm > point.yMm) !== (vj.yMm > point.yMm)) &&
      (point.xMm < ((vj.xMm - vi.xMm) * (point.yMm - vi.yMm)) / (vj.yMm - vi.yMm) + vi.xMm)) inside = !inside;
  }
  return inside;
}
function isPointInsideEvenOdd(point, contours) {
  let inside = false;
  for (const contour of contours) {
    if (isPointInsidePolygon(point, contour)) inside = !inside;
  }
  return inside;
}

// ---------------------------------------------------------------------------------------------
// 1. Geometric deviation measurements (regression thresholds from the RS-1012A measurement run)
// ---------------------------------------------------------------------------------------------

await test('1. Rectangle Union/Subtract/Intersect/Exclude stay within 1% of the exact analytic area at production scale', () => {
  const a = rectanglePolygon(0, 0, 60, 40);
  const b = rectanglePolygon(30, 20, 60, 40);
  const expected = { union: 4200, intersect: 600, subtract: 1800, xor: 3600 };
  for (const op of ['union', 'intersect', 'subtract', 'xor']) {
    const result = combineShapeSources(polySource([a]), polySource([b]), op);
    const measured = result.contours.reduce((sum, c) => sum + shoelaceArea(c), 0);
    const errorPct = (Math.abs(measured - expected[op]) / expected[op]) * 100;
    assert.ok(errorPct < 1, `expected ${op} area error < 1%, got ${errorPct.toFixed(3)}% (measured=${measured}, expected=${expected[op]})`);
  }
});

await test('2. Circle Union/Intersect area matches the closed-form circle-intersection formula within 1%', () => {
  const radiusMm = 20, distanceMm = 24;
  const cA = engine.resolveShapePolygons({ shape: 'circle', layerId: 'a', cxMm: 0, cyMm: 0, radiusMm }).polygons;
  const cB = engine.resolveShapePolygons({ shape: 'circle', layerId: 'b', cxMm: distanceMm, cyMm: 0, radiusMm }).polygons;
  const r2 = radiusMm * radiusMm;
  const intersectArea = 2 * r2 * Math.acos(distanceMm / (2 * radiusMm)) - (distanceMm / 2) * Math.sqrt(4 * r2 - distanceMm * distanceMm);
  const unionArea = 2 * Math.PI * r2 - intersectArea;
  const intersectResult = combineShapeSources(polySource(cA), polySource(cB), 'intersect');
  const unionResult = combineShapeSources(polySource(cA), polySource(cB), 'union');
  const intersectMeasured = intersectResult.contours.reduce((s, c) => s + shoelaceArea(c), 0);
  const unionMeasured = unionResult.contours.reduce((s, c) => s + shoelaceArea(c), 0);
  assert.ok(Math.abs(intersectMeasured - intersectArea) / intersectArea < 0.01, `intersect area error too large: measured=${intersectMeasured}, expected=${intersectArea}`);
  assert.ok(Math.abs(unionMeasured - unionArea) / unionArea < 0.01, `union area error too large: measured=${unionMeasured}, expected=${unionArea}`);
});

// ---------------------------------------------------------------------------------------------
// 2. Hole preservation -- regression test for the RS-1012A simplification bug (see PathBoolean.js's
//    module doc comment): an earlier single-pass simplification collapsed a concentric-circle
//    annulus into a broken, non-simple 3-point shape covering only half the outer circle.
// ---------------------------------------------------------------------------------------------

await test('3. an annulus (outer circle XOR inner circle) keeps two full, correctly-shaped boundary loops and a real hole', () => {
  const outer = engine.resolveShapePolygons({ shape: 'circle', layerId: 'o', cxMm: 0, cyMm: 0, radiusMm: 10 }).polygons;
  const inner = engine.resolveShapePolygons({ shape: 'circle', layerId: 'i', cxMm: 0, cyMm: 0, radiusMm: 8 }).polygons;
  const result = combineShapeSources(polySource(outer), polySource(inner), 'xor');
  assert.equal(result.contours.length, 2, 'expected exactly two contours (outer boundary + hole boundary)');
  for (const contour of result.contours) {
    const xs = contour.map((p) => p.xMm), ys = contour.map((p) => p.yMm);
    const width = Math.max(...xs) - Math.min(...xs), height = Math.max(...ys) - Math.min(...ys);
    // A broken/partial trace (the historical bug) produces a bounding box far smaller than the
    // true circle it should represent along at least one axis; a correct full loop is
    // approximately square (width ~= height) for a circle.
    assert.ok(Math.abs(width - height) / Math.max(width, height) < 0.05, `expected a roughly circular (square bbox) contour, got width=${width.toFixed(3)} height=${height.toFixed(3)}`);
    assert.ok(contour.length >= 20, `expected a full circle boundary to keep at least 20 vertices after simplification, got ${contour.length}`);
  }
  assert.equal(isPointInsideEvenOdd({ xMm: 0, yMm: 0 }, result.contours), false, 'expected the ring\'s center to be a real hole (even-odd: inside the outer circle, inside the inner circle too -> outside the ring)');
  assert.equal(isPointInsideEvenOdd({ xMm: 9, yMm: 0 }, result.contours), true, 'expected a point inside the ring band itself to be filled');
});

// ---------------------------------------------------------------------------------------------
// 3. Narrow bridge / tiny cutout preservation (fast, targeted -- not the full alignment sweep)
// ---------------------------------------------------------------------------------------------

await test('4. a 0.5mm bridge between two 20x20mm squares is reliably preserved (measured production threshold: >=0.35mm)', () => {
  const squareA = rectanglePolygon(0, 0, 20, 20);
  const squareB = rectanglePolygon(50, 0, 20, 20);
  const bridge = rectanglePolygon(20, 10 - 0.25, 30, 0.5);
  const result = combineShapeSources(polySource([squareA, squareB]), polySource([bridge]), 'union');
  assert.equal(result.contours.length, 1, 'expected the bridge to keep the two squares connected as one contour');
});

await test('5. a 0.25mm circular cutout in a 50x50mm square is reliably preserved (measured production threshold with feature-size-adaptive resolution: >=0.07mm)', () => {
  const square = rectanglePolygon(0, 0, 50, 50);
  const cutout = engine.resolveShapePolygons({ shape: 'circle', layerId: 'c', cxMm: 25, cyMm: 25, radiusMm: 0.25 }).polygons;
  const result = combineShapeSources(polySource([square]), polySource(cutout), 'subtract');
  assert.equal(result.contours.length, 2, 'expected the cutout to appear as a second (hole) contour');
  const expectedArea = 50 * 50 - Math.PI * 0.25 * 0.25;
  const areas = result.contours.map(shoelaceArea).sort((a, b) => b - a);
  const [outerArea, holeArea] = areas; // exactly two, non-nested-within-each-other-in-a-third-contour here
  const measuredArea = outerArea - holeArea;
  assert.ok(Math.abs(measuredArea - expectedArea) / expectedArea < 0.01, `expected <1% area error, got measured=${measuredArea}, expected=${expectedArea}`);
});

// ---------------------------------------------------------------------------------------------
// 4. Repeated/chained boolean stability
// ---------------------------------------------------------------------------------------------

await test('6. a chain of 5 overlapping circles folds to a stable result regardless of fold order (left-to-right vs right-to-left agree within 2%)', () => {
  const sources = [];
  for (let i = 0; i < 5; i++) {
    sources.push(polySource(engine.resolveShapePolygons({ shape: 'circle', layerId: `c${i}`, cxMm: i * 8, cyMm: 0, radiusMm: 6 }).polygons));
  }
  const ltr = combineManyShapeSources(sources, 'union');
  const rtl = combineManyShapeSources([...sources].reverse(), 'union');
  const areaLtr = ltr.contours.reduce((s, c) => s + shoelaceArea(c), 0);
  const areaRtl = rtl.contours.reduce((s, c) => s + shoelaceArea(c), 0);
  assert.equal(ltr.contours.length, 1, 'expected the chain to stay connected');
  assert.equal(rtl.contours.length, 1, 'expected the chain to stay connected regardless of fold order');
  assert.ok(Math.abs(areaLtr - areaRtl) / areaLtr < 0.02, `expected fold-order area difference < 2%, got ${(Math.abs(areaLtr - areaRtl) / areaLtr * 100).toFixed(3)}%`);
});

// ---------------------------------------------------------------------------------------------
// 5. Determinism
// ---------------------------------------------------------------------------------------------

await test('7. identical input produces byte-identical output across 10 repeated calls', () => {
  const a = engine.resolveShapePolygons({ shape: 'circle', layerId: 'a', cxMm: 0, cyMm: 0, radiusMm: 12 }).polygons;
  const b = engine.resolveShapePolygons({ shape: 'rectangle', layerId: 'b', xMm: 3, yMm: 3, widthMm: 18, heightMm: 14 }).polygons;
  const first = combineShapeSources(polySource(a), polySource(b), 'union');
  for (let i = 0; i < 10; i++) {
    assert.deepEqual(combineShapeSources(polySource(a), polySource(b), 'union'), first);
  }
});

// ---------------------------------------------------------------------------------------------
// 6. Repeated save/load (JSON round-trip) does not progressively degrade contours
// ---------------------------------------------------------------------------------------------

await test('8. contours survive 20 repeated JSON.stringify/parse round-trips with zero numeric drift', () => {
  const a = engine.resolveShapePolygons({ shape: 'circle', layerId: 'a', cxMm: 0, cyMm: 0, radiusMm: 12 }).polygons;
  const b = engine.resolveShapePolygons({ shape: 'rectangle', layerId: 'b', xMm: 3, yMm: 3, widthMm: 18, heightMm: 14 }).polygons;
  const original = combineShapeSources(polySource(a), polySource(b), 'union').contours;
  let roundTripped = original;
  for (let i = 0; i < 20; i++) {
    roundTripped = JSON.parse(JSON.stringify(roundTripped));
  }
  assert.deepEqual(roundTripped, original);
});

// ---------------------------------------------------------------------------------------------
// 7. Adaptive precision: stone-pitch-aware resolution, feature-size awareness, and fail-safe
// ---------------------------------------------------------------------------------------------

await test('9. combineShapeSources accepts an optional targetSpacingMm resolution hint and never becomes coarser than the un-hinted result', () => {
  const radiusMm = 15, distanceMm = 18;
  const a = engine.resolveShapePolygons({ shape: 'circle', layerId: 'a', cxMm: 0, cyMm: 0, radiusMm }).polygons;
  const b = engine.resolveShapePolygons({ shape: 'circle', layerId: 'b', cxMm: distanceMm, cyMm: 0, radiusMm }).polygons;
  const noHint = combineShapeSources(polySource(a), polySource(b), 'union');
  const fineStones = combineShapeSources(polySource(a), polySource(b), 'union', { targetSpacingMm: 1.1 });
  const coarseStones = combineShapeSources(polySource(a), polySource(b), 'union', { targetSpacingMm: 6.5 });
  const vertexCount = (r) => r.contours.reduce((s, c) => s + c.length, 0);
  assert.ok(vertexCount(fineStones) >= vertexCount(noHint), 'a finer stone pitch should never produce a coarser (or fewer-vertex) result than no hint at all');
  // A coarse stone-pitch hint must not force MORE resolution than the shape/document-driven
  // baseline already provides ("avoid unnecessary computation on simple designs").
  assert.equal(vertexCount(coarseStones), vertexCount(noHint), 'a coarse stone-pitch hint should not add resolution beyond the existing baseline');
});

await test('10. a sub-millimeter detail combined with a multi-meter shape fails safely with a clear, non-technical message, instead of silently returning coarse geometry', () => {
  const tinyDot = engine.resolveShapePolygons({ shape: 'circle', layerId: 'dot', cxMm: 0, cyMm: 0, radiusMm: 0.05 }).polygons;
  const hugeRect = rectanglePolygon(0, 0, 5000, 4000);
  assert.throws(
    () => combineShapeSources(polySource(tinyDot), polySource([hugeRect]), 'union'),
    (error) => {
      assert.ok(error instanceof BooleanPrecisionError, 'expected a BooleanPrecisionError');
      assert.ok(!/undefined|NaN|\[object/.test(error.message), 'error message must not leak internal values');
      assert.match(error.message, /cannot be computed at a safe/i);
      assert.match(error.message, /try/i, 'expected the message to suggest a concrete next step');
      return true;
    }
  );
});

await test('11. an ordinary large production-sheet-scale document (well within supported span) does not trip the fail-safe', () => {
  const a = rectanglePolygon(0, 0, 1000, 800);
  const b = rectanglePolygon(300, 200, 1000, 800);
  const result = combineShapeSources(polySource([a]), polySource([b]), 'union');
  assert.ok(result.contours.length >= 1, 'expected an ordinary large-document operation to succeed, not fail safe');
});

await test('12. combineManyShapeSources forwards the resolution options object to every fold step', () => {
  const a = engine.resolveShapePolygons({ shape: 'circle', layerId: 'a', cxMm: 0, cyMm: 0, radiusMm: 10 }).polygons;
  const b = engine.resolveShapePolygons({ shape: 'circle', layerId: 'b', cxMm: 12, cyMm: 0, radiusMm: 10 }).polygons;
  const c = engine.resolveShapePolygons({ shape: 'circle', layerId: 'c', cxMm: 6, cyMm: 12, radiusMm: 10 }).polygons;
  const noHint = combineManyShapeSources([polySource(a), polySource(b), polySource(c)], 'union');
  const withHint = combineManyShapeSources([polySource(a), polySource(b), polySource(c)], 'union', { targetSpacingMm: 1.1 });
  const vertexCount = (r) => r.contours.reduce((s, c2) => s + c2.length, 0);
  assert.ok(vertexCount(withHint) >= vertexCount(noHint), 'expected the fine-spacing hint to apply across every fold step, not just the first');
});

console.log('Boolean precision validation (RS-1012A) tests passed.');
