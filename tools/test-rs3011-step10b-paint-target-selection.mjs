import assert from 'node:assert/strict';
import { GeometryEngine, isPointInsidePolygons, computeNaturalContourTransform, applyNaturalContourTransform } from '../src/geometry/index.js';
import { selectPaintTarget, absolutePolygonsToNaturalSpace } from '../src/geometry/PaintRegionSelection.js';

// RS-3011 Step 10b — Paint tool target selection (Phase A geometry). Proves selectPaintTarget()
// picks the candidate 'path' layer with the largest lasso-intersection area (not the one containing
// the lasso's bounding-box center, matching drawleather's FillTool.ts reference this step
// deliberately departs from) and that absolutePolygonsToNaturalSpace() inverts GeometryEngine's own
// placement transform exactly, so a picked region round-trips back through the SAME transform a
// 'path' layer's own `contours` field already uses -- including after the parent shape has moved or
// resized. Calls the real, unmodified GeometryEngine + PaintRegionSelection directly, mirroring
// tools/test-rs3011-step10a-region-data-model.mjs's own "geometry-level checks call the real
// engine" convention.

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

// A natural, (0,0)-rooted unit square -- scaled/translated per-candidate by GeometryEngine's own
// placement transform via each layer's x/y/w/h, exactly like a real Design-drawn shape.
const NATURAL_UNIT_SQUARE_XY = [[{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }]];

// Builds a raw project.layers 'path' layer object -- the same {contours:{x,y}[][], x, y, w, h}
// shape app.js's generatePathStonesLive()/onShapeResized() already read/write, not a GeometryEngine
// params object (see PaintRegionSelection.js's absolutePolygonsToNaturalSpace() doc comment).
function buildPathLayer(id, xMm, yMm, wMm, hMm) {
  return { id, type: 'path', contours: NATURAL_UNIT_SQUARE_XY, x: xMm, y: yMm, w: wMm, h: hMm };
}

// Mirrors app.js's own {x,y} -> {xMm,yMm} remap (generatePathStonesLive()) to call
// GeometryEngine.resolvePathPolygons(), producing the absolute-mm candidate polygons
// selectPaintTarget() expects.
function resolveCandidate(engine, layer) {
  const polygons = engine.resolvePathPolygons({
    contours: layer.contours.map((contour) => contour.map((p) => ({ xMm: p.x, yMm: p.y }))),
    layerId: layer.id,
    xMm: layer.x,
    yMm: layer.y,
    widthMm: layer.w,
    heightMm: layer.h
  }).polygons;
  return { layerId: layer.id, polygons };
}

function bboxCenter(polygon) {
  const xs = polygon.map((p) => p.xMm);
  const ys = polygon.map((p) => p.yMm);
  return { xMm: (Math.min(...xs) + Math.max(...xs)) / 2, yMm: (Math.min(...ys) + Math.max(...ys)) / 2 };
}

function insideLayerBounds(point, layer) {
  return point.xMm >= layer.x && point.xMm <= layer.x + layer.w && point.yMm >= layer.y && point.yMm <= layer.y + layer.h;
}

function formatContours(contours) {
  return contours.map((c) => c.map((p) => `(${p.xMm.toFixed(2)},${p.yMm.toFixed(2)})`).join(' -> ')).join(' | ');
}

// (a) A lasso fully inside one of two candidate shapes -- confirm it picks that shape, and the
// returned natural-space contour round-trips back to (approximately) the same absolute-mm shape
// when run back through the SAME transform in the forward direction.
await test('(a) lasso fully inside one candidate -> picks that candidate; round-trips through the transform', () => {
  const engine = createEngine();
  const shapeA = buildPathLayer('shapeA', 0, 0, 20, 20);   // absolute square x[0,20] y[0,20]
  const shapeB = buildPathLayer('shapeB', 40, 0, 20, 20);  // absolute square x[40,60] y[0,20], no overlap
  const candidates = [resolveCandidate(engine, shapeA), resolveCandidate(engine, shapeB)];

  const lasso = [[{ xMm: 5, yMm: 5 }, { xMm: 15, yMm: 5 }, { xMm: 15, yMm: 15 }, { xMm: 5, yMm: 15 }]]; // 10x10, inside shapeA

  const result = selectPaintTarget(lasso, candidates, { targetSpacingMm: 2.3 });
  console.log(`    picked layerId=${result && result.layerId}, area=${result && result.area.toFixed(4)}mm^2 (expected ~100)`);
  console.log(`    contours: ${formatContours(result.contours)}`);

  assert.ok(result, 'expected a target to be selected');
  assert.equal(result.layerId, 'shapeA');
  assert.ok(Math.abs(result.area - 100) < 5, `expected area near 100mm^2, got ${result.area}`);

  const naturalContours = absolutePolygonsToNaturalSpace(result.contours, shapeA);
  const forwardTransform = computeNaturalContourTransform(
    shapeA.contours.map((c) => c.map((p) => ({ xMm: p.x, yMm: p.y }))),
    shapeA.x, shapeA.y, shapeA.w, shapeA.h
  );
  const roundTripped = naturalContours.map((contour) => applyNaturalContourTransform(contour, forwardTransform));

  console.log(`    natural-space contour: ${formatContours(naturalContours)}`);
  console.log(`    round-tripped contour: ${formatContours(roundTripped)}`);

  for (let ci = 0; ci < result.contours.length; ci++) {
    for (let pi = 0; pi < result.contours[ci].length; pi++) {
      const original = result.contours[ci][pi];
      const roundTrip = roundTripped[ci][pi];
      assert.ok(
        Math.hypot(original.xMm - roundTrip.xMm, original.yMm - roundTrip.yMm) < 1e-6,
        `round-trip mismatch at contour ${ci} point ${pi}: original (${original.xMm},${original.yMm}) vs round-tripped (${roundTrip.xMm},${roundTrip.yMm})`
      );
    }
  }
});

// (b) A lasso overlapping two candidate shapes unevenly -- confirm it picks the shape with more
// overlap, not the one containing the lasso's bounding-box center. Constructed as an L-shaped lasso
// so its own bounding-box center sits inside shapeA while its actual overlap AREA is larger against
// shapeB -- centroid-based and area-based selection genuinely disagree here.
await test('(b) uneven overlap -> picks larger-area candidate even though bbox-center lies in the other one', () => {
  const engine = createEngine();
  const shapeA = buildPathLayer('shapeA', 0, 0, 11, 10);   // absolute box x[0,11] y[0,10]
  const shapeB = buildPathLayer('shapeB', 14, 0, 10, 10);  // absolute box x[14,24] y[0,10]
  const candidates = [resolveCandidate(engine, shapeA), resolveCandidate(engine, shapeB)];

  // L-shaped: a top strip spanning the full x[0,20] range (y[8,10]) plus a right-side block
  // x[11,20] y[0,10] -- overall bounding box x[0,20] y[0,10], center (10,5), strictly inside
  // shapeA's box x[0,11] y[0,10]. Most of the polygon's actual area sits over shapeB.
  const lasso = [[
    { xMm: 0, yMm: 8 }, { xMm: 0, yMm: 10 }, { xMm: 20, yMm: 10 },
    { xMm: 20, yMm: 0 }, { xMm: 11, yMm: 0 }, { xMm: 11, yMm: 8 }
  ]];

  const center = bboxCenter(lasso[0]);
  console.log(`    lasso bbox center: (${center.xMm.toFixed(2)},${center.yMm.toFixed(2)})`);
  const centerInA = insideLayerBounds(center, shapeA);
  const centerInB = insideLayerBounds(center, shapeB);
  console.log(`    center inside shapeA=${centerInA}, inside shapeB=${centerInB}`);
  assert.ok(centerInA && !centerInB, 'test setup requires the bbox center to land in shapeA only, to prove disagreement with area-based selection');

  const result = selectPaintTarget(lasso, candidates, { targetSpacingMm: 2.3 });
  console.log(`    picked layerId=${result && result.layerId}, area=${result && result.area.toFixed(4)}mm^2`);

  // Compute each candidate's own overlap area independently to report the actual split.
  const areaAgainst = (layer) => {
    const single = selectPaintTarget(lasso, [resolveCandidate(engine, layer)], { targetSpacingMm: 2.3 });
    return single ? single.area : 0;
  };
  const areaA = areaAgainst(shapeA);
  const areaB = areaAgainst(shapeB);
  console.log(`    overlap area vs shapeA=${areaA.toFixed(4)}mm^2, vs shapeB=${areaB.toFixed(4)}mm^2 (split ${(100 * areaB / (areaA + areaB)).toFixed(1)}%/${(100 * areaA / (areaA + areaB)).toFixed(1)}%)`);

  assert.ok(result, 'expected a target to be selected');
  assert.equal(result.layerId, 'shapeB', 'expected the larger-overlap-area candidate to win over the bbox-center-containing one');
  assert.ok(areaB > areaA, `expected shapeB's own overlap area (${areaB}) to exceed shapeA's (${areaA})`);
});

// (c) A lasso that touches no candidate shape at all -- confirm null.
await test('(c) lasso overlapping no candidate -> null', () => {
  const engine = createEngine();
  const shapeA = buildPathLayer('shapeA', 0, 0, 20, 20);
  const shapeB = buildPathLayer('shapeB', 40, 0, 20, 20);
  const candidates = [resolveCandidate(engine, shapeA), resolveCandidate(engine, shapeB)];

  const lasso = [[{ xMm: 100, yMm: 100 }, { xMm: 110, yMm: 100 }, { xMm: 110, yMm: 110 }, { xMm: 100, yMm: 110 }]];

  const result = selectPaintTarget(lasso, candidates, { targetSpacingMm: 2.3 });
  console.log(`    result: ${result}`);
  assert.equal(result, null);
});

// (d) A candidate shape moved/resized from its original draw position -- confirm the natural-space
// conversion still round-trips correctly, since a region's transform must track the CURRENT
// placement, not a stale one (Step 10a's own doc comment on _applyPathRegions()).
await test('(d) moved+resized candidate -> natural-space conversion still tracks the CURRENT placement', () => {
  const engine = createEngine();
  // Drawn originally at x[0,20] y[0,20]; app.js's onShapeResized() has since moved/resized it to
  // x[50,90] y[30,70] (matching test10a's own resized-candidate scenario numbers).
  const shapeA = buildPathLayer('shapeA', 50, 30, 40, 40);
  const shapeB = buildPathLayer('shapeB', 200, 200, 20, 20); // far away, no overlap
  const candidates = [resolveCandidate(engine, shapeA), resolveCandidate(engine, shapeB)];

  // Lasso covering the left half of shapeA's CURRENT placement (x[50,70] of its x[50,90] span).
  const lasso = [[{ xMm: 45, yMm: 25 }, { xMm: 70, yMm: 25 }, { xMm: 70, yMm: 75 }, { xMm: 45, yMm: 75 }]];

  const result = selectPaintTarget(lasso, candidates, { targetSpacingMm: 2.3 });
  console.log(`    picked layerId=${result && result.layerId}, area=${result && result.area.toFixed(4)}mm^2`);
  assert.ok(result);
  assert.equal(result.layerId, 'shapeA');

  const naturalContours = absolutePolygonsToNaturalSpace(result.contours, shapeA);
  console.log(`    natural-space contour: ${formatContours(naturalContours)}`);

  // Every natural-space point must fall inside the shape's own original natural unit-square contour
  // ([0,1]x[0,1]) -- direct proof the CURRENT x/y/w/h (50,30,40,40), not the original draw
  // position, drove the inversion. Inflated by a small epsilon: combineShapeSources()'s own
  // marching-squares tracing is an approximation (this module's own doc comment says as much), and
  // that boundary noise (a fraction of a grid cell, here ~0.1mm absolute) gets divided by shapeA's
  // own scale factor (40) when converted to natural space, same as every other consumer of this
  // module accepts at this precision level.
  const NATURAL_SPACE_TOLERANCE = 0.01;
  const naturalSquare = [
    { xMm: -NATURAL_SPACE_TOLERANCE, yMm: -NATURAL_SPACE_TOLERANCE },
    { xMm: 1 + NATURAL_SPACE_TOLERANCE, yMm: -NATURAL_SPACE_TOLERANCE },
    { xMm: 1 + NATURAL_SPACE_TOLERANCE, yMm: 1 + NATURAL_SPACE_TOLERANCE },
    { xMm: -NATURAL_SPACE_TOLERANCE, yMm: 1 + NATURAL_SPACE_TOLERANCE }
  ];
  for (const contour of naturalContours) {
    for (const point of contour) {
      assert.ok(
        isPointInsidePolygons(point, [naturalSquare]),
        `natural-space point (${point.xMm.toFixed(3)},${point.yMm.toFixed(3)}) falls outside the shape's own natural unit square (+-${NATURAL_SPACE_TOLERANCE} tolerance)`
      );
    }
  }

  // Forward-retransform through the CURRENT placement must reproduce the original absolute contour.
  const forwardTransform = computeNaturalContourTransform(
    shapeA.contours.map((c) => c.map((p) => ({ xMm: p.x, yMm: p.y }))),
    shapeA.x, shapeA.y, shapeA.w, shapeA.h
  );
  const roundTripped = naturalContours.map((contour) => applyNaturalContourTransform(contour, forwardTransform));
  console.log(`    round-tripped contour: ${formatContours(roundTripped)}`);
  for (let ci = 0; ci < result.contours.length; ci++) {
    for (let pi = 0; pi < result.contours[ci].length; pi++) {
      const original = result.contours[ci][pi];
      const roundTrip = roundTripped[ci][pi];
      assert.ok(
        Math.hypot(original.xMm - roundTrip.xMm, original.yMm - roundTrip.yMm) < 1e-6,
        `round-trip mismatch at contour ${ci} point ${pi}: original (${original.xMm},${original.yMm}) vs round-tripped (${roundTrip.xMm},${roundTrip.yMm})`
      );
    }
  }

  // Sanity: the SAME natural contour placed through shapeA's ORIGINAL draw box (0,0,20,20) instead
  // of its current one must land somewhere different -- proves the round-trip above is actually
  // exercising the current, not stale, transform.
  const staleTransform = computeNaturalContourTransform(
    shapeA.contours.map((c) => c.map((p) => ({ xMm: p.x, yMm: p.y }))),
    0, 0, 20, 20
  );
  const staleRetransformed = naturalContours.map((contour) => applyNaturalContourTransform(contour, staleTransform));
  const differs = staleRetransformed.some((contour, ci) => contour.some((point, pi) => {
    const current = roundTripped[ci][pi];
    return Math.hypot(point.xMm - current.xMm, point.yMm - current.yMm) > 1;
  }));
  assert.ok(differs, 'expected the stale (original-position) transform to produce visibly different points than the current-position transform');
});

console.log('RS-3011 Step 10b Paint target selection tests complete.');
