import assert from 'node:assert/strict';
import { GeometryEngine } from '../src/geometry/index.js';
import {
  SHAPE_LIBRARY_KINDS,
  createShapeNaturalContours,
  createEllipseNaturalContours,
  createCapsuleNaturalContours,
  createRegularPolygonNaturalContours,
  createStarNaturalContours,
  createHeartNaturalContours,
  createArrowNaturalContours,
  createCrossNaturalContours,
  createCrescentNaturalContours,
  createRingNaturalContours,
  createShieldNaturalContours
} from '../src/geometry/ShapeLibrary.js';

// S-110 (Expanded Shape Library) — proves each new shape kind's natural-contour math
// (src/geometry/ShapeLibrary.js) is correct in isolation, then proves GeometryEngine's
// generateShapeLayout()/resolveShapePolygons() place and sample every kind exactly like it already
// does for Circle/Rectangle -- no second shape system, no duplicated placement math.

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

function boundingBoxOf(contours) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const contour of contours) {
    for (const p of contour) {
      if (p.xMm < minX) minX = p.xMm;
      if (p.yMm < minY) minY = p.yMm;
      if (p.xMm > maxX) maxX = p.xMm;
      if (p.yMm > maxY) maxY = p.yMm;
    }
  }
  return { minX, minY, maxX, maxY, widthMm: maxX - minX, heightMm: maxY - minY };
}

function shoelaceArea(contour) {
  let area = 0;
  for (let i = 0; i < contour.length; i++) {
    const p1 = contour[i], p2 = contour[(i + 1) % contour.length];
    area += p1.xMm * p2.yMm - p2.xMm * p1.yMm;
  }
  return Math.abs(area / 2);
}

function createEngine() {
  return new GeometryEngine();
}

// --- 1. Every generator is rooted at (0,0), closed, and produces a plausible shape -------------

await test('1. SHAPE_LIBRARY_KINDS has exactly the ten shape kinds (nine from S-110 plus RS-3027\'s Shield)', () => {
  assert.deepEqual(
    [...SHAPE_LIBRARY_KINDS].sort(),
    ['arrow', 'capsule', 'crescent', 'cross', 'ellipse', 'heart', 'polygon', 'ring', 'shield', 'star'].sort()
  );
});

await test('2. every generator returns contours rooted at (0,0) (top-left of their own bounding box)', () => {
  const generators = [
    createEllipseNaturalContours(), createCapsuleNaturalContours(), createRegularPolygonNaturalContours(6),
    createStarNaturalContours(5, 0.5), createHeartNaturalContours(), createArrowNaturalContours(),
    createCrossNaturalContours(), createCrescentNaturalContours(), createRingNaturalContours(0.5),
    createShieldNaturalContours()
  ];
  for (const contours of generators) {
    const box = boundingBoxOf(contours);
    assert.ok(Math.abs(box.minX) < 1e-9, `minX should be 0, got ${box.minX}`);
    assert.ok(Math.abs(box.minY) < 1e-9, `minY should be 0, got ${box.minY}`);
    assert.ok(box.widthMm > 0 && box.heightMm > 0, 'bounding box must have positive extent');
  }
});

await test('3. Ellipse is a circle in its own natural space (a perfect circle before independent x/y placement scale)', () => {
  const [contour] = createEllipseNaturalContours();
  const box = boundingBoxOf([contour]);
  assert.ok(Math.abs(box.widthMm - box.heightMm) < 1e-9, 'natural ellipse must be circular (width === height)');
  assert.ok(Math.abs(shoelaceArea(contour) - Math.PI * (box.widthMm / 2) ** 2) < 0.01, 'area must match a circle of the same radius');
});

await test('4. Capsule has a natural 2:1 width:height ratio and its area matches the stadium-shape formula', () => {
  const [contour] = createCapsuleNaturalContours();
  const box = boundingBoxOf([contour]);
  assert.ok(Math.abs(box.widthMm / box.heightMm - 2) < 0.01, `expected a 2:1 natural ratio, got ${box.widthMm}/${box.heightMm}`);
  const r = box.heightMm / 2;
  const straightLenMm = box.widthMm - 2 * r;
  const expectedArea = straightLenMm * box.heightMm + Math.PI * r * r;
  assert.ok(Math.abs(shoelaceArea(contour) - expectedArea) < 0.05, 'stadium area must match rectangle + two semicircle caps');
});

await test('5. Regular Polygon produces exactly `sides` vertices and rejects an out-of-range side count', () => {
  for (const sides of [3, 4, 5, 6, 8, 12]) {
    const [contour] = createRegularPolygonNaturalContours(sides);
    assert.equal(contour.length, sides, `expected ${sides} vertices`);
  }
  assert.throws(() => createRegularPolygonNaturalContours(2), RangeError);
  assert.throws(() => createRegularPolygonNaturalContours(13), RangeError);
  assert.throws(() => createRegularPolygonNaturalContours(5.5), RangeError);
});

await test('6. Star produces exactly 2*points vertices, alternating outer/inner radius, and rejects out-of-range params', () => {
  for (const points of [3, 5, 8, 12]) {
    const [contour] = createStarNaturalContours(points, 0.5);
    assert.equal(contour.length, points * 2, `expected ${points * 2} vertices`);
  }
  assert.throws(() => createStarNaturalContours(2, 0.5), RangeError);
  assert.throws(() => createStarNaturalContours(5, 0.05), RangeError, 'innerRadiusRatio below 0.1 must be rejected');
  assert.throws(() => createStarNaturalContours(5, 0.95), RangeError, 'innerRadiusRatio above 0.9 must be rejected');

  // A deeper inner radius (smaller ratio) must shrink the star's own area relative to a shallower one.
  const shallow = shoelaceArea(createStarNaturalContours(5, 0.8)[0]);
  const deep = shoelaceArea(createStarNaturalContours(5, 0.2)[0]);
  assert.ok(deep < shallow, 'a smaller innerRadiusRatio (deeper points) must produce a smaller-area star');
});

await test('7. Ring returns exactly two concentric contours (outer + inner), and a larger innerRatio shrinks the annulus area', () => {
  const ring = createRingNaturalContours(0.5);
  assert.equal(ring.length, 2, 'Ring must return exactly two contours');
  const outerBox = boundingBoxOf([ring[0]]);
  const innerBox = boundingBoxOf([ring[1]]);
  assert.ok(innerBox.widthMm < outerBox.widthMm, 'the inner contour must be smaller than the outer contour');

  const annulusArea = (innerRatio) => {
    const [outer, inner] = createRingNaturalContours(innerRatio);
    return shoelaceArea(outer) - shoelaceArea(inner);
  };
  assert.ok(annulusArea(0.8) < annulusArea(0.2), 'a larger inner opening must leave a smaller annulus area');
  assert.throws(() => createRingNaturalContours(0.05), RangeError);
  assert.throws(() => createRingNaturalContours(0.95), RangeError);
});

await test('8. Heart/Arrow/Cross/Crescent/Shield each produce a single, non-degenerate closed contour', () => {
  for (const contours of [createHeartNaturalContours(), createArrowNaturalContours(), createCrossNaturalContours(), createCrescentNaturalContours(), createShieldNaturalContours()]) {
    assert.equal(contours.length, 1, 'expected a single contour');
    assert.ok(contours[0].length >= 4, 'expected a non-trivial polygon');
    assert.ok(shoelaceArea(contours[0]) > 0, 'expected positive area');
  }
});

await test('9. createShapeNaturalContours() dispatches every SHAPE_LIBRARY_KINDS entry and rejects an unknown kind', () => {
  const paramsByKind = { polygon: { sides: 6 }, star: { points: 5, innerRadiusRatio: 0.5 }, ring: { innerRatio: 0.5 } };
  for (const kind of SHAPE_LIBRARY_KINDS) {
    const contours = createShapeNaturalContours(kind, paramsByKind[kind] || {});
    assert.ok(Array.isArray(contours) && contours.length > 0, `${kind} must return at least one contour`);
  }
  assert.throws(() => createShapeNaturalContours('bogus'), TypeError);
});

// --- 2. GeometryEngine integration: placement, sampling, Fill Styles ----------------------------

await test('10. generateShapeLayout()/resolveShapePolygons() support every new shape kind at an arbitrary x/y/w/h box', () => {
  const engine = createEngine();
  const extra = { polygon: { sides: 7 }, star: { points: 6, innerRadiusRatio: 0.4 }, ring: { innerRatio: 0.3 } };
  for (const kind of SHAPE_LIBRARY_KINDS) {
    const params = { shape: kind, layerId: 'x', xMm: 10, yMm: 20, widthMm: 50, heightMm: 30, stoneSizeMm: 2, gapMm: 0.3, mode: 'outline', ...(extra[kind] || {}) };
    const layout = engine.generateShapeLayout(params);
    assert.ok(layout.count > 0, `${kind}: expected at least one stone`);

    const { polygons, boundingBox } = engine.resolveShapePolygons(params);
    assert.ok(boundingBox, `${kind}: expected a resolvable bounding box`);
    assert.ok(polygons.length > 0, `${kind}: expected at least one polygon`);
    // Placement box: the resolved geometry's own bounding box must sit at/within the requested
    // xMm/yMm/widthMm/heightMm placement (never outside it -- a shape's own natural contour is
    // always fully inside its natural bounding box by construction).
    assert.ok(boundingBox.minXmm >= 10 - 1e-6 && boundingBox.maxXmm <= 60 + 1e-6, `${kind}: must be placed within the requested x/width box`);
    assert.ok(boundingBox.minYmm >= 20 - 1e-6 && boundingBox.maxYmm <= 50 + 1e-6, `${kind}: must be placed within the requested y/height box`);
  }
});

await test('11. every Fill Style (Outline/Grid/Staggered/Radial/Contour) produces stones for every new shape kind', () => {
  const engine = createEngine();
  const extra = { polygon: { sides: 5 }, star: { points: 5, innerRadiusRatio: 0.5 }, ring: { innerRatio: 0.5 } };
  for (const kind of SHAPE_LIBRARY_KINDS) {
    for (const mode of ['outline', 'fill', 'staggered', 'radial', 'contour']) {
      const layout = engine.generateShapeLayout({ shape: kind, layerId: 'x', xMm: 0, yMm: 0, widthMm: 60, heightMm: 60, stoneSizeMm: 2, gapMm: 0.3, mode, ...(extra[kind] || {}) });
      assert.ok(layout.count > 0, `${kind} ${mode}: expected at least one stone`);
    }
  }
});

await test('12. Ring\'s hole is preserved under Grid Fill (no stone falls inside the inner opening)', () => {
  const engine = createEngine();
  const innerRatio = 0.5, widthMm = 60, heightMm = 60;
  const layout = engine.generateShapeLayout({ shape: 'ring', layerId: 'x', xMm: 0, yMm: 0, widthMm, heightMm, stoneSizeMm: 1.5, gapMm: 0.2, mode: 'fill', innerRatio });
  const cx = widthMm / 2, cy = heightMm / 2, innerRadiusMm = (innerRatio * widthMm) / 2;
  const insideHole = layout.stones.filter((s) => Math.hypot(s.xMm - cx, s.yMm - cy) < innerRadiusMm - 1);
  assert.equal(insideHole.length, 0, 'no stone should fall (well) inside the ring\'s inner opening');
});

await test('13. Ring outline mode traces both the outer and inner circle (two independent rings of stones)', () => {
  const engine = createEngine();
  const widthMm = 60, heightMm = 60, innerRatio = 0.5;
  const layout = engine.generateShapeLayout({ shape: 'ring', layerId: 'x', xMm: 0, yMm: 0, widthMm, heightMm, stoneSizeMm: 1.5, gapMm: 0.2, mode: 'outline', innerRatio });
  const cx = widthMm / 2, cy = heightMm / 2;
  const outerRadiusMm = widthMm / 2, innerRadiusMm = (innerRatio * widthMm) / 2;
  const nearOuter = layout.stones.filter((s) => Math.abs(Math.hypot(s.xMm - cx, s.yMm - cy) - outerRadiusMm) < 1);
  const nearInner = layout.stones.filter((s) => Math.abs(Math.hypot(s.xMm - cx, s.yMm - cy) - innerRadiusMm) < 1);
  assert.ok(nearOuter.length > 5, 'expected stones tracing the outer circle');
  assert.ok(nearInner.length > 5, 'expected stones tracing the inner circle');
});

await test('14. malformed shape-specific parameters throw a specific, actionable error (no malformed geometry produced)', () => {
  const engine = createEngine();
  const base = { layerId: 'x', xMm: 0, yMm: 0, widthMm: 40, heightMm: 40, stoneSizeMm: 2, gapMm: 0.3, mode: 'outline' };
  assert.throws(() => engine.generateShapeLayout({ ...base, shape: 'polygon', sides: 2 }), RangeError);
  assert.throws(() => engine.generateShapeLayout({ ...base, shape: 'polygon', sides: 3.5 }), RangeError);
  assert.throws(() => engine.generateShapeLayout({ ...base, shape: 'star', points: 5, innerRadiusRatio: 1.5 }), RangeError);
  assert.throws(() => engine.generateShapeLayout({ ...base, shape: 'ring', innerRatio: -0.1 }), RangeError);
});

await test('15. every new shape kind is deterministic across repeated runs with identical input', () => {
  const engine = createEngine();
  const extra = { polygon: { sides: 6 }, star: { points: 5, innerRadiusRatio: 0.5 }, ring: { innerRatio: 0.5 } };
  const serialize = (stones) => JSON.stringify(stones.map((s) => [Math.round(s.xMm * 1e6), Math.round(s.yMm * 1e6)]).sort());
  for (const kind of SHAPE_LIBRARY_KINDS) {
    const params = { shape: kind, layerId: 'x', xMm: 0, yMm: 0, widthMm: 50, heightMm: 50, stoneSizeMm: 2, gapMm: 0.3, mode: 'fill', ...(extra[kind] || {}) };
    const a = engine.generateShapeLayout(params);
    const b = engine.generateShapeLayout(params);
    assert.equal(serialize(a.stones), serialize(b.stones), `${kind} must be deterministic`);
  }
});

console.log('Shape Library (S-110) tests passed.');
