import assert from 'node:assert/strict';
import {
  combineShapeSources,
  combineManyShapeSources,
  BOOLEAN_OPERATIONS,
  isPointInsidePolygons
} from '../src/geometry/index.js';

// RS-1012 (Vector Boolean Operations) — pure unit tests for src/geometry/PathBoolean.js's
// raster-assisted Union/Subtract/Intersect/Exclude engine, in isolation from GeometryEngine/app.js.
// See tools/test-path-boolean-integration.mjs for the GeometryEngine.resolve*/generatePathLayout
// and app.js wiring tests.

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

function rectanglePolygon(xMm, yMm, widthMm, heightMm) {
  return [
    { xMm, yMm },
    { xMm: xMm + widthMm, yMm },
    { xMm: xMm + widthMm, yMm: yMm + heightMm },
    { xMm, yMm: yMm + heightMm }
  ];
}

function circlePolygon(cxMm, cyMm, radiusMm, segments = 64) {
  const points = [];
  for (let i = 0; i < segments; i++) {
    const angle = (i / segments) * Math.PI * 2;
    points.push({ xMm: cxMm + Math.cos(angle) * radiusMm, yMm: cyMm + Math.sin(angle) * radiusMm });
  }
  return points;
}

function shoelaceArea(points) {
  let area = 0;
  for (let i = 0; i < points.length; i++) {
    const p1 = points[i], p2 = points[(i + 1) % points.length];
    area += p1.xMm * p2.yMm - p2.xMm * p1.yMm;
  }
  return Math.abs(area) / 2;
}

function totalArea(contours) {
  return contours.reduce((sum, contour) => sum + shoelaceArea(contour), 0);
}

function polySource(...polygons) {
  return { kind: 'polygons', polygons };
}

await test('1. BOOLEAN_OPERATIONS lists exactly the four required operations', () => {
  assert.deepEqual([...BOOLEAN_OPERATIONS].sort(), ['intersect', 'subtract', 'union', 'xor'].sort());
});

await test('2. Union of two overlapping 10x10 rectangles produces roughly the correct combined area', () => {
  const a = rectanglePolygon(0, 0, 10, 10);
  const b = rectanglePolygon(5, 5, 10, 10);
  const result = combineShapeSources(polySource(a), polySource(b), 'union');
  assert.equal(result.contours.length, 1, 'expected one connected union contour');
  // True area is 175mm^2 (100+100-25 overlap). The raster grid trades a little precision for
  // handling arbitrary/multi-contour shapes and Image Trace fields uniformly — see
  // src/geometry/PathBoolean.js's module doc comment — so this checks "close", not "exact".
  assert.ok(Math.abs(totalArea(result.contours) - 175) < 3, `expected ~175mm^2, got ${totalArea(result.contours)}`);
});

await test('3. Intersect of the same two rectangles produces the correct 5x5 overlap area', () => {
  const a = rectanglePolygon(0, 0, 10, 10);
  const b = rectanglePolygon(5, 5, 10, 10);
  const result = combineShapeSources(polySource(a), polySource(b), 'intersect');
  assert.equal(result.contours.length, 1);
  assert.ok(Math.abs(totalArea(result.contours) - 25) < 2, `expected ~25mm^2, got ${totalArea(result.contours)}`);
  assert.ok(result.boundingBox.minXmm > 4 && result.boundingBox.minXmm < 6, 'expected overlap to start near x=5');
});

await test('4. Subtract removes the clip shape\'s area from the subject, leaving an L-shape', () => {
  const a = rectanglePolygon(0, 0, 10, 10);
  const b = rectanglePolygon(5, 5, 10, 10);
  const result = combineShapeSources(polySource(a), polySource(b), 'subtract');
  assert.equal(result.contours.length, 1);
  assert.ok(Math.abs(totalArea(result.contours) - 75) < 2, `expected ~75mm^2 (100-25), got ${totalArea(result.contours)}`);
  // The subtracted corner must be gone: the overlap region's center is outside the result.
  assert.equal(isPointInsidePolygons({ xMm: 7.5, yMm: 7.5 }, result.contours), false);
  // A point only in the subject must remain inside.
  assert.equal(isPointInsidePolygons({ xMm: 2, yMm: 2 }, result.contours), true);
});

await test('5. Subtract is not symmetric: swapping subject/clip changes the result', () => {
  const a = rectanglePolygon(0, 0, 10, 10);
  const b = rectanglePolygon(5, 5, 10, 10);
  const aMinusB = combineShapeSources(polySource(a), polySource(b), 'subtract');
  const bMinusA = combineShapeSources(polySource(b), polySource(a), 'subtract');
  assert.equal(isPointInsidePolygons({ xMm: 2, yMm: 2 }, aMinusB.contours), true);
  assert.equal(isPointInsidePolygons({ xMm: 2, yMm: 2 }, bMinusA.contours), false);
  assert.equal(isPointInsidePolygons({ xMm: 12, yMm: 12 }, bMinusA.contours), true);
});

await test('6. Exclude (xor) of two diagonally-overlapping squares removes only the shared corner and can split into two contours', () => {
  const a = rectanglePolygon(0, 0, 10, 10);
  const b = rectanglePolygon(5, 5, 10, 10);
  const result = combineShapeSources(polySource(a), polySource(b), 'xor');
  assert.ok(result.contours.length >= 1, 'expected at least one contour');
  assert.ok(Math.abs(totalArea(result.contours) - 150) < 3, `expected ~150mm^2 (175 union - 25 overlap*2... i.e. union-intersect*2), got ${totalArea(result.contours)}`);
  assert.equal(isPointInsidePolygons({ xMm: 7.5, yMm: 7.5 }, result.contours), false, 'the overlapping area must be excluded');
  assert.equal(isPointInsidePolygons({ xMm: 2, yMm: 2 }, result.contours), true);
  assert.equal(isPointInsidePolygons({ xMm: 12, yMm: 12 }, result.contours), true);
});

await test('7. disjoint shapes: union keeps both, intersect is empty, subtract is unchanged, xor keeps both', () => {
  const a = rectanglePolygon(0, 0, 5, 5);
  const b = rectanglePolygon(20, 20, 5, 5);
  assert.equal(combineShapeSources(polySource(a), polySource(b), 'union').contours.length, 2);
  assert.deepEqual(combineShapeSources(polySource(a), polySource(b), 'intersect').contours, []);
  assert.ok(Math.abs(totalArea(combineShapeSources(polySource(a), polySource(b), 'subtract').contours) - 25) < 1);
  assert.equal(combineShapeSources(polySource(a), polySource(b), 'xor').contours.length, 2);
});

await test('8. Union/Intersect of two circles matches the classic circle-intersection area formula', () => {
  const radiusMm = 10;
  const distanceMm = 12;
  const a = circlePolygon(0, 0, radiusMm);
  const b = circlePolygon(distanceMm, 0, radiusMm);
  const r2 = radiusMm * radiusMm;
  const d = distanceMm;
  const expectedIntersectArea = 2 * r2 * Math.acos(d / (2 * radiusMm)) - (d / 2) * Math.sqrt(4 * r2 - d * d);
  const intersect = combineShapeSources(polySource(a), polySource(b), 'intersect');
  assert.ok(Math.abs(totalArea(intersect.contours) - expectedIntersectArea) < 2, `expected ~${expectedIntersectArea.toFixed(2)}mm^2, got ${totalArea(intersect.contours)}`);

  const circleArea = Math.PI * r2;
  const expectedUnionArea = 2 * circleArea - expectedIntersectArea;
  const union = combineShapeSources(polySource(a), polySource(b), 'union');
  assert.ok(Math.abs(totalArea(union.contours) - expectedUnionArea) < 4, `expected ~${expectedUnionArea.toFixed(2)}mm^2, got ${totalArea(union.contours)}`);
});

await test('9. holes survive an even-odd combination (a ring/annulus keeps a real hole at its center)', () => {
  // xor of two concentric circles is a classic annulus: everything inside the big circle but
  // outside the small one. Text glyphs with counters ("o") and nested SVG paths rely on the exact
  // same even-odd rule inside GeometryEngine's outline/fill sampling (see StoneSampler.js), so this
  // proves PathBoolean.js's output is compatible with that convention without this module needing
  // to know which contour is "the hole".
  const outer = circlePolygon(0, 0, 10);
  const inner = circlePolygon(0, 0, 5);
  const ring = combineShapeSources(polySource(outer), polySource(inner), 'xor');
  assert.equal(ring.contours.length, 2, 'expected an outer boundary and an inner (hole) boundary');
  assert.equal(isPointInsidePolygons({ xMm: 0, yMm: 0 }, ring.contours), false, 'the center must be a hole');
  assert.equal(isPointInsidePolygons({ xMm: 7.5, yMm: 0 }, ring.contours), true, 'the ring band itself must be filled');
  assert.equal(isPointInsidePolygons({ xMm: 20, yMm: 0 }, ring.contours), false, 'well outside the ring must be empty');
});

await test('10. combineManyShapeSources folds 3+ sources left to right and matches manual pairwise folding', () => {
  const a = rectanglePolygon(0, 0, 10, 10);
  const b = rectanglePolygon(5, 5, 10, 10);
  const c = rectanglePolygon(8, 0, 10, 4);
  const folded = combineManyShapeSources([polySource(a), polySource(b), polySource(c)], 'union');
  const manual = combineShapeSources(
    { kind: 'polygons', polygons: combineShapeSources(polySource(a), polySource(b), 'union').contours },
    polySource(c),
    'union'
  );
  assert.ok(Math.abs(totalArea(folded.contours) - totalArea(manual.contours)) < 1);
});

await test('11. combineManyShapeSources requires at least two sources', () => {
  assert.throws(() => combineManyShapeSources([polySource(rectanglePolygon(0, 0, 5, 5))], 'union'), RangeError);
  assert.throws(() => combineManyShapeSources([], 'union'), RangeError);
});

await test('12. an unsupported operation throws a clear TypeError', () => {
  const a = rectanglePolygon(0, 0, 5, 5);
  const b = rectanglePolygon(1, 1, 5, 5);
  assert.throws(() => combineShapeSources(polySource(a), polySource(b), 'nonsense'), /Unsupported boolean operation/);
});

await test('13. a raster field source (Image Trace) combines correctly with a vector polygon source', () => {
  // A 10x10mm field, fully "on" in its left half only (foreground = 255, background = 0), placed at
  // the origin — the same field shape src/image/**'s prepareImageField() produces.
  const widthPx = 20, heightPx = 20;
  const data = new Uint8ClampedArray(widthPx * heightPx);
  for (let y = 0; y < heightPx; y++) {
    for (let x = 0; x < widthPx; x++) {
      data[y * widthPx + x] = x < widthPx / 2 ? 255 : 0;
    }
  }
  const field = { widthPx, heightPx, data };
  const fieldSource = { kind: 'field', field, xMm: 0, yMm: 0, widthMm: 10, heightMm: 10 };
  const rectSource = polySource(rectanglePolygon(0, 0, 10, 10));

  const intersect = combineShapeSources(fieldSource, rectSource, 'intersect');
  assert.ok(Math.abs(totalArea(intersect.contours) - 50) < 3, `expected ~50mm^2 (left half of a 10x10 square), got ${totalArea(intersect.contours)}`);
  assert.equal(isPointInsidePolygons({ xMm: 2, yMm: 5 }, intersect.contours), true);
  assert.equal(isPointInsidePolygons({ xMm: 8, yMm: 5 }, intersect.contours), false);
});

await test('14. combineShapeSources is deterministic for identical inputs', () => {
  const a = rectanglePolygon(0, 0, 10, 10);
  const b = circlePolygon(5, 5, 6);
  const first = combineShapeSources(polySource(a), polySource(b), 'union');
  const second = combineShapeSources(polySource(a), polySource(b), 'union');
  assert.deepEqual(first, second);
});

await test('15. every returned contour has 3+ points and a non-degenerate (non-zero) area', () => {
  const a = rectanglePolygon(0, 0, 10, 10);
  const b = rectanglePolygon(3, 3, 4, 4);
  const result = combineShapeSources(polySource(a), polySource(b), 'union');
  for (const contour of result.contours) {
    assert.ok(contour.length >= 3);
    assert.ok(shoelaceArea(contour) > 0);
  }
});

console.log('Path Boolean (RS-1012) unit tests passed.');
