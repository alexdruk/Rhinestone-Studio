// PERF-006 — per-contour X/Y-bounding-box early-reject cache for isPointInsidePolygons().
//
// Grid fill (sampleFillPoints() and the other fill-mode loops in StoneSampler.js) calls
// isPointInsidePolygons() once per candidate point against the same `polygons` array every time.
// For a large/dense fill of a multi-contour shape (many glyphs, or a shape assembled from many
// parts), most (candidate point, contour) pairs can never match -- a point far above one letter's
// contour still ran that letter's full ray-cast edge loop before this fix. This test proves two
// things: (1) the optimization never changes the result -- a large randomized/adversarial
// differential test against a naive reference implementation, plus every existing production
// geometry test still passing unmodified -- and (2) it actually is faster for the shape of workload
// that motivated it (many small, spatially-separated contours across a wide bounding box, which is
// exactly what a long word or phrase looks like).

import assert from 'node:assert/strict';
import { isPointInsidePolygons } from '../src/geometry/StoneSampler.js';
import { Point2D } from '../src/text/VectorPath.js';

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

// The exact pre-PERF-006 algorithm, reimplemented independently here (not imported) so this test
// can't accidentally pass by comparing the optimized function against itself.
function naiveIsPointInsidePolygons(point, polygons) {
  let inside = false;
  for (const polygon of polygons) {
    let polyInside = false;
    const n = polygon.length;
    for (let i = 0, j = n - 1; i < n; j = i++) {
      const vi = polygon[i];
      const vj = polygon[j];
      const intersects = (vi.yMm > point.yMm) !== (vj.yMm > point.yMm) &&
        point.xMm < ((vj.xMm - vi.xMm) * (point.yMm - vi.yMm)) / (vj.yMm - vi.yMm) + vi.xMm;
      if (intersects) polyInside = !polyInside;
    }
    if (polyInside) inside = !inside;
  }
  return inside;
}

function mulberry32(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randomPolygon(rng, cx, cy, r, sides) {
  const pts = [];
  for (let i = 0; i < sides; i++) {
    const angle = (i / sides) * Math.PI * 2 + rng() * 0.3;
    const radius = r * (0.6 + rng() * 0.4);
    pts.push(new Point2D(cx + Math.cos(angle) * radius, cy + Math.sin(angle) * radius));
  }
  return pts;
}

await test('1. differential correctness: many random single/multi-contour polygon sets, many random and boundary-hugging points -- identical results to a naive reference implementation', () => {
  const rng = mulberry32(12345);
  for (let trial = 0; trial < 200; trial++) {
    const contourCount = 1 + Math.floor(rng() * 4);
    const polygons = [];
    for (let c = 0; c < contourCount; c++) {
      const cx = rng() * 40 - 20, cy = rng() * 40 - 20, r = 3 + rng() * 8, sides = 3 + Math.floor(rng() * 9);
      polygons.push(randomPolygon(rng, cx, cy, r, sides));
    }
    for (let p = 0; p < 30; p++) {
      // Mix of purely random points and points snapped near an actual contour vertex's Y (the exact
      // boundary condition the early-reject depends on getting right).
      let point;
      if (p % 3 === 0 && polygons.length > 0) {
        const poly = polygons[Math.floor(rng() * polygons.length)];
        const v = poly[Math.floor(rng() * poly.length)];
        point = new Point2D(v.xMm + (rng() - 0.5) * 2, v.yMm + (rng() - 0.5) * 0.01);
      } else {
        point = new Point2D(rng() * 60 - 30, rng() * 60 - 30);
      }
      const expected = naiveIsPointInsidePolygons(point, polygons);
      const actual = isPointInsidePolygons(point, polygons);
      assert.equal(actual, expected, `trial ${trial}, point ${p}: (${point.xMm.toFixed(3)}, ${point.yMm.toFixed(3)}) vs ${contourCount} contour(s)`);
    }
  }
});

await test('2. an empty polygons array and a polygon with zero vertices are handled identically to the naive reference (no crash, correct false)', () => {
  const point = new Point2D(0, 0);
  assert.equal(isPointInsidePolygons(point, []), naiveIsPointInsidePolygons(point, []));
  assert.equal(isPointInsidePolygons(point, [[]]), naiveIsPointInsidePolygons(point, [[]]));
});

await test('3. two structurally-identical but distinct polygon array references are cached independently (WeakMap keys by identity, not content) -- mutating-by-replacement one does not affect the other', () => {
  const square = (cx, cy, s) => [
    new Point2D(cx - s, cy - s), new Point2D(cx + s, cy - s), new Point2D(cx + s, cy + s), new Point2D(cx - s, cy + s)
  ];
  const polygonsA = [square(0, 0, 5)];
  const polygonsB = [square(0, 0, 5)]; // same content, different array/point instances
  const inside = new Point2D(0, 0);
  const outside = new Point2D(20, 20);
  assert.equal(isPointInsidePolygons(inside, polygonsA), true);
  assert.equal(isPointInsidePolygons(inside, polygonsB), true);
  assert.equal(isPointInsidePolygons(outside, polygonsA), false);
  assert.equal(isPointInsidePolygons(outside, polygonsB), false);
  // A fresh array (never seen by the cache before) for a shape that does NOT contain `inside`
  // must not somehow inherit polygonsA/B's cached bounds.
  const polygonsC = [square(100, 100, 5)];
  assert.equal(isPointInsidePolygons(inside, polygonsC), false);
});

await test('4. repeated calls against the SAME array reference (the real grid-fill access pattern) stay correct across many different points, including points outside every contour\'s Y-range (the actual case being optimized)', () => {
  const rng = mulberry32(999);
  const polygons = [randomPolygon(rng, -15, 0, 4, 6), randomPolygon(rng, 15, 0, 4, 6), randomPolygon(rng, 0, 20, 4, 6)];
  // Simulate a grid scan: many points, most of which are nowhere near any of the three contours.
  for (let y = -40; y <= 40; y += 2) {
    for (let x = -40; x <= 40; x += 2) {
      const point = new Point2D(x, y);
      assert.equal(isPointInsidePolygons(point, polygons), naiveIsPointInsidePolygons(point, polygons), `(${x}, ${y})`);
    }
  }
});

await test('5. performance: many small, spatially-separated contours across a wide bounding box (the "long word" shape of workload) is meaningfully faster than the naive reference', () => {
  const rng = mulberry32(42);
  // 20 small "glyph-like" contours spread across a wide horizontal span -- most grid points are far
  // from most contours, which is exactly the case the bounding-box reject is meant to short-circuit.
  // 80 vertices per contour approximates a real bezier-flattened glyph outline (a simple polygon
  // undersells the benefit -- the whole point is skipping the *edge loop*, so the win scales with
  // how many edges a rejected contour would otherwise have cost).
  const polygons = [];
  for (let i = 0; i < 20; i++) {
    polygons.push(randomPolygon(rng, i * 8, 0, 3, 80));
  }
  const points = [];
  for (let y = -5; y <= 5; y += 0.3) {
    for (let x = -5; x <= 160; x += 0.3) {
      points.push(new Point2D(x, y));
    }
  }

  const t0 = performance.now();
  for (const p of points) isPointInsidePolygons(p, polygons);
  const optimizedMs = performance.now() - t0;

  const t1 = performance.now();
  for (const p of points) naiveIsPointInsidePolygons(p, polygons);
  const naiveMs = performance.now() - t1;

  console.log(`   (${points.length} points x ${polygons.length} contours x 80 vertices: optimized ${optimizedMs.toFixed(1)}ms vs naive ${naiveMs.toFixed(1)}ms, ${(naiveMs / optimizedMs).toFixed(1)}x)`);
  assert.ok(optimizedMs < naiveMs, `expected the cached-bounding-box version to be faster for this workload (optimized ${optimizedMs.toFixed(1)}ms, naive ${naiveMs.toFixed(1)}ms)`);
});

console.log('PERF-006 point-in-polygon early-reject cache tests passed.');
