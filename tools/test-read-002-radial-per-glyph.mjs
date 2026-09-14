import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Point2D, BoundingBox } from '../src/text/VectorPath.js';
import {
  groupPolygonsIntoComponents,
  radialStepCount,
  sampleRadialFillPoints,
  isPointInsidePolygons
} from '../src/geometry/index.js';
import { buildCandidateEngine } from './font-certification/lib/productionAnalysis.mjs';

// READ-002 -- Radial Fill: per-component anchors + innermost-ring step count. Every number asserted
// here was produced by an actual run; see docs/specifications/READ-002-RadialPerGlyph.md for the
// before/after tables. Part C's epsilon fix adds exactly one stone to each innermost ring, so the
// single-component invariance checks below assert "pre-change count + 1", not the raw pre-change
// count.

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FONT = (file) => path.join(REPO, 'assets/fonts', file);

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

const square = (x, y, w) => [
  new Point2D(x, y), new Point2D(x + w, y), new Point2D(x + w, y + w), new Point2D(x, y + w)
];

async function radialTextPolygons(fontFile, text, heightMm) {
  const { engine, fontId } = await buildCandidateEngine(FONT(fontFile));
  const { polygons } = await engine.resolveTextPolygons({ text, fontId, heightMm, layerId: 'read-002-test' });
  return polygons;
}

function minNearestNeighbourMm(points) {
  let min = Infinity;
  for (let i = 0; i < points.length; i++) {
    for (let j = i + 1; j < points.length; j++) {
      const d = Math.hypot(points[i].xMm - points[j].xMm, points[i].yMm - points[j].yMm);
      if (d < min) min = d;
    }
  }
  return min;
}

// --- 1. groupPolygonsIntoComponents() on synthetic input ------------------------------------------

await test('1. groupPolygonsIntoComponents(): disjoint / hole / island-in-hole nesting', () => {
  const disjoint = groupPolygonsIntoComponents([square(0, 0, 10), square(50, 0, 10)]);
  assert.equal(disjoint.length, 2, 'two disjoint squares are two components');
  assert.deepEqual(disjoint.map((c) => c.length), [1, 1], 'each disjoint component has one contour');

  const withHole = groupPolygonsIntoComponents([square(0, 0, 20), square(5, 5, 10)]);
  assert.equal(withHole.length, 1, 'a square with a concentric square hole is one component');
  assert.equal(withHole[0].length, 2, 'that component holds the outer contour and its hole');

  // outer square, its hole, and an island inside the hole -> depth 0 / 1 / 2. Depth 2 is an outer,
  // so the island starts its own component.
  const island = groupPolygonsIntoComponents([square(0, 0, 30), square(5, 5, 20), square(10, 10, 10)]);
  assert.equal(island.length, 2, 'island inside the hole is its own component (depth 2 is an outer)');
  const contourCounts = island.map((c) => c.length).sort();
  assert.deepEqual(contourCounts, [1, 2], 'outer+hole component has 2 contours, island component has 1');
});

await test('1b. groupPolygonsIntoComponents(): empty input, and deterministic component order', () => {
  assert.deepEqual(groupPolygonsIntoComponents([]), [], 'empty input -> no components');

  // three outers listed out of x-order: components come back in polygons-index order, not x-order.
  const a = square(100, 0, 10);
  const b = square(0, 0, 10);
  const c = square(50, 0, 10);
  const comps = groupPolygonsIntoComponents([a, b, c]);
  assert.equal(comps.length, 3);
  assert.strictEqual(comps[0][0], a);
  assert.strictEqual(comps[1][0], b);
  assert.strictEqual(comps[2][0], c);
});

// --- 2. Component grouping on real fonts ---------------------------------------------------------

await test('2. "Vitalina" at 58mm groups into exactly 10 components (Lilita One, Great Vibes)', async () => {
  for (const fontFile of ['LilitaOne-Regular.ttf', 'GreatVibes-Regular.ttf']) {
    const polygons = await radialTextPolygons(fontFile, 'Vitalina', 58);
    const components = groupPolygonsIntoComponents(polygons);
    assert.equal(components.length, 10, `${fontFile}: expected 10 components, got ${components.length}`);
    for (const contours of components) {
      assert.ok(contours.length >= 1 && contours.length <= 2, `${fontFile}: a component has ${contours.length} contours (expected 1 or 2 -- no merged glyphs)`);
    }
  }
});

// --- 3. Single-component invariance (identical geometry, +1 stone from Part C) -------------------

await test('3. sampleRadialFillPoints() on a plain rectangle / circle: identical first+last point, count + 1', () => {
  // Pre-change values measured on develop @ 14cc6ad, before READ-002:
  //   rectangle 50x36mm, spacing 4.3, stone 4.0  -> 94 stones, first (25, 18), last (49.326238, 9.404993)
  //   circle r=15mm (240-gon), spacing 3.0, stone 2.5 -> 61 stones, first (20, 20), last (31.622998, 17.015721)
  const rect = [[new Point2D(0, 0), new Point2D(50, 0), new Point2D(50, 36), new Point2D(0, 36)]];
  const rectStones = sampleRadialFillPoints(rect, BoundingBox.fromPoints(rect.flat()), 4.3, 4.0);
  assert.equal(rectStones.length, 95, `rectangle: expected 94 + 1 = 95 stones, got ${rectStones.length}`);
  assert.ok(Math.abs(rectStones[0].xMm - 25) < 1e-6 && Math.abs(rectStones[0].yMm - 18) < 1e-6, `rectangle first point moved to (${rectStones[0].xMm}, ${rectStones[0].yMm})`);
  const rLast = rectStones[rectStones.length - 1];
  assert.ok(Math.abs(rLast.xMm - 49.326238) < 1e-5 && Math.abs(rLast.yMm - 9.404993) < 1e-5, `rectangle last point moved to (${rLast.xMm}, ${rLast.yMm})`);

  const circle = [];
  for (let k = 0; k < 240; k++) {
    const angle = (k / 240) * 2 * Math.PI;
    circle.push(new Point2D(20 + 15 * Math.cos(angle), 20 + 15 * Math.sin(angle)));
  }
  const circleStones = sampleRadialFillPoints([circle], BoundingBox.fromPoints(circle), 3.0, 2.5);
  assert.equal(circleStones.length, 62, `circle: expected 61 + 1 = 62 stones, got ${circleStones.length}`);
  assert.ok(Math.abs(circleStones[0].xMm - 20) < 1e-6 && Math.abs(circleStones[0].yMm - 20) < 1e-6, `circle first point moved to (${circleStones[0].xMm}, ${circleStones[0].yMm})`);
  const cLast = circleStones[circleStones.length - 1];
  assert.ok(Math.abs(cLast.xMm - 31.622998) < 1e-5 && Math.abs(cLast.yMm - 17.015721) < 1e-5, `circle last point moved to (${cLast.xMm}, ${cLast.yMm})`);
});

// --- 4. radialStepCount() -----------------------------------------------------------------------

await test('4. radialStepCount(): exactly 6 at r === spacingMm; unchanged from the bare floor at k = 2..20', () => {
  const spacingMm = 3.0;
  assert.equal(radialStepCount(spacingMm, spacingMm), 6, 'r === spacingMm must give exactly 6 (bare floor gives 5)');

  // The epsilon only rescues the exact half-integer at r === spacingMm; every k = 2..20 ring is
  // identical to the pre-READ-002 bare floor.
  const bareFloor = (radiusMm) => {
    const ratio = Math.min(1, spacingMm / (2 * radiusMm));
    return Math.max(1, Math.floor(Math.PI / Math.asin(ratio)));
  };
  for (let k = 2; k <= 20; k++) {
    const radiusMm = k * spacingMm;
    assert.equal(radialStepCount(radiusMm, spacingMm), bareFloor(radiusMm), `k=${k}: epsilon changed the step count`);
  }
});

// --- 5. Every stone lies on its own component's ring grid --------------------------------------

await test('5. every stone is owned by exactly one component and lies on that component\'s ring grid', async () => {
  const spacingMm = 4.3;
  const polygons = await radialTextPolygons('LilitaOne-Regular.ttf', 'Vitalina', 58);
  const components = groupPolygonsIntoComponents(polygons);
  const anchors = components.map((contours) => BoundingBox.fromPoints(contours.flat()).center);
  const stones = sampleRadialFillPoints(polygons, BoundingBox.fromPoints(polygons.flat()), spacingMm, 4.0);

  // True ownership: the component whose filled region actually contains the stone -- not "whichever
  // anchor happens to fit best", which would let a stone off its own grid be rescued by a
  // coincidental fit to a neighbouring anchor.
  let worstErr = 0;
  let unowned = 0;
  let multiOwned = 0;
  for (const stone of stones) {
    const owners = [];
    for (let i = 0; i < components.length; i++) {
      if (isPointInsidePolygons(stone, components[i])) owners.push(i);
    }
    if (owners.length === 0) { unowned++; continue; }
    if (owners.length > 1) multiOwned++;
    const anchor = anchors[owners[0]];
    const d = Math.hypot(stone.xMm - anchor.xMm, stone.yMm - anchor.yMm);
    const err = Math.abs(d - Math.round(d / spacingMm) * spacingMm);
    if (err > worstErr) worstErr = err;
  }
  assert.equal(unowned, 0, `${unowned} stone(s) are inside no component`);
  assert.equal(multiOwned, 0, `${multiOwned} stone(s) are inside more than one component`);
  assert.ok(worstErr < 1e-9, `a stone is ${worstErr.toExponential(3)} mm off its own component's ring grid (want < 1e-9)`);
});

// --- 6. No physical overlap on a real multi-component word ------------------------------------

await test('6. global minimum nearest-neighbour distance >= stoneSizeMm on "Vitalina" (Lilita One, Great Vibes)', async () => {
  const stoneSizeMm = 4.0;
  for (const fontFile of ['LilitaOne-Regular.ttf', 'GreatVibes-Regular.ttf']) {
    const polygons = await radialTextPolygons(fontFile, 'Vitalina', 58);
    const stones = sampleRadialFillPoints(polygons, BoundingBox.fromPoints(polygons.flat()), 4.3, stoneSizeMm);
    const minNN = minNearestNeighbourMm(stones);
    assert.ok(minNN >= stoneSizeMm - 1e-6, `${fontFile}: two stones are ${minNN.toFixed(4)} mm apart (< ${stoneSizeMm} mm stone diameter)`);
  }
});

console.log('READ-002 radial per-glyph tests complete.');
