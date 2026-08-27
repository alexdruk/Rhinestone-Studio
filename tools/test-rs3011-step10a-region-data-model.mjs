import assert from 'node:assert/strict';
import { GeometryEngine, isPointInsidePolygons } from '../src/geometry/index.js';

// RS-3011 Step 10a — Paint region data model. Geometry-level proof that a 'path' layer's new
// optional `regions` field (a) lets a region's own fill correctly claim/exclude points from the
// base fill and from earlier regions (last-wins priority order), (b) never physically overlaps
// across the base/region boundary, (c) survives a JSON save/load round-trip losslessly, (d) is a
// byte-identical no-op when absent/empty, and (e) tracks its parent shape's move/resize through the
// exact same natural-space transform the shape's own `contours` already use. Calls the real,
// unmodified GeometryEngine directly, mirroring tools/test-s200-mixed-stone-sizes.mjs's own
// "geometry-level checks call the real engine" convention.

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

// Every accepted pair of stones (any origin -- base or region) must clear the true physical
// touching distance for the smaller of the two possibly-different manufacturing gaps in play, same
// shape as test-s200-mixed-stone-sizes.mjs's own assertNoOverlaps().
function assertNoPhysicalOverlap(stonesA, stonesB, label) {
  for (const a of stonesA) {
    for (const b of stonesB) {
      const distance = Math.hypot(a.xMm - b.xMm, a.yMm - b.yMm);
      const minSeparationMm = (a.sizeMm + b.sizeMm) / 2;
      assert.ok(
        distance >= minSeparationMm - 1e-6,
        `${label}: stones physically overlap: (${a.xMm.toFixed(2)},${a.yMm.toFixed(2)},d=${a.sizeMm}) vs ` +
          `(${b.xMm.toFixed(2)},${b.yMm.toFixed(2)},d=${b.sizeMm}) -- distance ${distance.toFixed(3)} < required ${minSeparationMm.toFixed(3)}`
      );
    }
  }
}

// A 20x20 natural-space (0,0)-rooted square, matching the layer's own placement box exactly
// (xMm:0,yMm:0,widthMm:20,heightMm:20) so scale=1/translate=0 -- natural-space region contours can
// be compared directly against placed stone coordinates without a mental transform.
// Points use {xMm,yMm} -- GeometryEngine's own params.contours contract (confirmed by
// _computeNaturalContourTransform() reading p.xMm/p.yMm), distinct from the persisted project-JSON
// layer.contours field, which uses {x,y} and is translated to {xMm,yMm} by app.js's
// generatePathStonesLive() before ever reaching the engine -- see test (d) below, which exercises
// that persisted {x,y} shape explicitly.
const SQUARE_CONTOUR = [{ xMm: 0, yMm: 0 }, { xMm: 20, yMm: 0 }, { xMm: 20, yMm: 20 }, { xMm: 0, yMm: 20 }];
const LEFT_HALF_CONTOUR = [{ xMm: 0, yMm: 0 }, { xMm: 10, yMm: 0 }, { xMm: 10, yMm: 20 }, { xMm: 0, yMm: 20 }];
const LEFT_TWO_THIRDS_CONTOUR = [{ xMm: 0, yMm: 0 }, { xMm: 14, yMm: 0 }, { xMm: 14, yMm: 20 }, { xMm: 0, yMm: 20 }];
const MIDDLE_RIGHT_CONTOUR = [{ xMm: 8, yMm: 0 }, { xMm: 20, yMm: 0 }, { xMm: 20, yMm: 20 }, { xMm: 8, yMm: 20 }];

// {x,y}-shaped counterparts, matching the PERSISTED project-JSON layer.contours convention (see
// validateProject()'s own contour check and app.js's generatePathStonesLive(), which translates
// {x,y} -> {xMm,yMm} before ever calling the engine) -- used only by test (d) below, which
// deliberately exercises that persisted shape end to end.
const toXY = (contour) => contour.map((p) => ({ x: p.xMm, y: p.yMm }));
const SQUARE_CONTOUR_XY = toXY(SQUARE_CONTOUR);
const LEFT_HALF_CONTOUR_XY = toXY(LEFT_HALF_CONTOUR);
const MIDDLE_RIGHT_CONTOUR_XY = toXY(MIDDLE_RIGHT_CONTOUR);

function baseParams(overrides = {}) {
  return {
    contours: [SQUARE_CONTOUR],
    layerId: 'path-1',
    xMm: 0,
    yMm: 0,
    widthMm: 20,
    heightMm: 20,
    stoneSizeMm: 2,
    gapMm: 0.3,
    mode: 'fill',
    color: 'gold',
    ...overrides
  };
}

// -----------------------------------------------------------------------------------------------
// (a) One region covering HALF the shape's own contour, different stoneSize/color from the base.
// -----------------------------------------------------------------------------------------------
await test('(a) a half-coverage region excludes base points, generates its own fill, never overlaps the base', () => {
  const engine = createEngine();
  const params = baseParams({
    regions: [
      { id: 'r1', contour: LEFT_HALF_CONTOUR, stoneSizeMm: 1, gapMm: 0.2, color: 'silver', fillMode: 'fill' }
    ]
  });

  const layout = engine.generatePathLayout(params);
  const baseStones = layout.stones.filter((s) => s.color === 'gold');
  const regionStones = layout.stones.filter((s) => s.color === 'silver');

  assert.ok(baseStones.length > 0, 'base fill should still produce stones in the right half');
  assert.ok(regionStones.length > 0, 'region should produce its own stones');
  for (const s of regionStones) assert.equal(s.sizeMm, 1, 'region stones use the region\'s own stoneSizeMm');
  for (const s of baseStones) assert.equal(s.sizeMm, 2, 'surviving base stones keep the layer\'s own stoneSizeMm');

  // Base fill correctly excludes points inside the region's own contour (same natural space as the
  // layer's own contours, here == placed space since scale=1/translate=0).
  const regionPolygon = [LEFT_HALF_CONTOUR];
  for (const s of baseStones) {
    assert.equal(
      isPointInsidePolygons({ xMm: s.xMm, yMm: s.yMm }, regionPolygon), false,
      `base stone at (${s.xMm},${s.yMm}) should have been excluded -- it falls inside the region`
    );
  }
  // Region's own points all fall inside its own contour.
  for (const s of regionStones) {
    assert.equal(
      isPointInsidePolygons({ xMm: s.xMm, yMm: s.yMm }, regionPolygon), true,
      `region stone at (${s.xMm},${s.yMm}) should fall inside the region's own contour`
    );
  }

  // Real distance check across the two sets -- no stone from either set physically overlaps a stone
  // from the other, not merely "counts look right."
  assertNoPhysicalOverlap(baseStones, regionStones, '(a) base vs region');

  console.log(`    base stones: ${baseStones.length}, region stones: ${regionStones.length}`);
});

// -----------------------------------------------------------------------------------------------
// (b) Two regions with overlapping contours -- later region wins the overlap.
// -----------------------------------------------------------------------------------------------
await test('(b) two overlapping regions: the LATER region in the array wins the overlapping area', () => {
  const engine = createEngine();
  const params = baseParams({
    regions: [
      { id: 'rA', contour: LEFT_TWO_THIRDS_CONTOUR, stoneSizeMm: 1.2, gapMm: 0.2, color: 'blue', fillMode: 'fill' },
      { id: 'rB', contour: MIDDLE_RIGHT_CONTOUR, stoneSizeMm: 1.5, gapMm: 0.2, color: 'red', fillMode: 'fill' }
    ]
  });

  const layout = engine.generatePathLayout(params);
  const aStones = layout.stones.filter((s) => s.color === 'blue');
  const bStones = layout.stones.filter((s) => s.color === 'red');

  assert.ok(aStones.length > 0, 'region A should still contribute stones outside the overlap');
  assert.ok(bStones.length > 0, 'region B should contribute its own stones');

  const bPolygon = [MIDDLE_RIGHT_CONTOUR];
  const aPolygon = [LEFT_TWO_THIRDS_CONTOUR];

  // No surviving region-A stone lies inside region B's contour -- B (later in the array) claimed
  // the whole overlap, including points region A would otherwise have generated there.
  for (const s of aStones) {
    assert.equal(
      isPointInsidePolygons({ xMm: s.xMm, yMm: s.yMm }, bPolygon), false,
      `region-A stone at (${s.xMm},${s.yMm}) survived inside region B's contour -- last-wins order violated`
    );
  }
  // Region B's own stones are free to be anywhere inside its own contour, including the part that
  // overlaps region A -- confirm at least one actually landed in the overlap zone (a.k.a. this test
  // is exercising the interesting case, not just the disjoint remainder).
  const bStonesInOverlap = bStones.filter((s) => isPointInsidePolygons({ xMm: s.xMm, yMm: s.yMm }, aPolygon));
  assert.ok(bStonesInOverlap.length > 0, 'expected at least one region-B stone inside the A/B overlap zone');

  assertNoPhysicalOverlap(aStones, bStones, '(b) region A vs region B');

  console.log(`    region A stones: ${aStones.length}, region B stones: ${bStones.length}, B-in-overlap: ${bStonesInOverlap.length}`);
});

// -----------------------------------------------------------------------------------------------
// (c) A region that exactly covers the WHOLE shape's own contour ("plain click" case).
// -----------------------------------------------------------------------------------------------
await test('(c) a region covering the whole shape\'s own contour: base contributes zero points', () => {
  const engine = createEngine();
  const params = baseParams({
    regions: [
      { id: 'rFull', contour: SQUARE_CONTOUR, stoneSizeMm: 1.5, gapMm: 0.25, color: 'emerald', fillMode: 'fill' }
    ]
  });

  const layout = engine.generatePathLayout(params);
  const baseStones = layout.stones.filter((s) => s.color === 'gold');
  const regionStones = layout.stones.filter((s) => s.color === 'emerald');

  assert.equal(baseStones.length, 0, 'base fill must contribute zero points when fully claimed');
  assert.equal(regionStones.length, layout.stones.length, 'output must be exactly the region\'s own fill');
  assert.ok(regionStones.length > 0, 'the full-coverage region should still produce stones');
  for (const s of regionStones) assert.equal(s.sizeMm, 1.5);

  console.log(`    total stones: ${layout.stones.length} (all region-owned)`);
});

// -----------------------------------------------------------------------------------------------
// (d) Save/load round-trip: JSON.stringify/parse survives regions losslessly, including mixed
//     fillMode values.
// -----------------------------------------------------------------------------------------------
await test('(d) a layer with regions survives a JSON.stringify/parse round-trip losslessly', () => {
  const layer = {
    id: 'path-2',
    type: 'path',
    contours: [SQUARE_CONTOUR_XY],
    x: 0, y: 0, w: 20, h: 20,
    stoneSize: 2, gap: 0.3, color: 'gold',
    regions: [
      { id: 'r1', contour: LEFT_HALF_CONTOUR_XY, stoneSizeMm: 1, gapMm: 0.2, color: 'silver', fillMode: 'fill' },
      { id: 'r2', contour: MIDDLE_RIGHT_CONTOUR_XY, stoneSizeMm: 1.4, gapMm: 0.15, color: 'red', fillMode: 'staggered' }
    ]
  };

  const roundTripped = JSON.parse(JSON.stringify(layer));
  assert.deepEqual(roundTripped, layer, 'round-tripped layer must deep-equal the original, including regions');
  assert.equal(roundTripped.regions[0].fillMode, 'fill');
  assert.equal(roundTripped.regions[1].fillMode, 'staggered');

  // And the round-tripped layer still generates identically to the pre-round-trip one.
  const engine = createEngine();
  const toParams = (l) => ({
    contours: l.contours.map((c) => c.map((p) => ({ xMm: p.x, yMm: p.y }))),
    layerId: l.id,
    xMm: l.x, yMm: l.y, widthMm: l.w, heightMm: l.h,
    stoneSizeMm: l.stoneSize, gapMm: l.gap, mode: 'fill', color: l.color,
    regions: l.regions.map((r) => ({
      id: r.id,
      contour: r.contour.map((p) => ({ xMm: p.x, yMm: p.y })),
      stoneSizeMm: r.stoneSizeMm, gapMm: r.gapMm, color: r.color, fillMode: r.fillMode
    }))
  });

  const before = engine.generatePathLayout(toParams(layer));
  const after = engine.generatePathLayout(toParams(roundTripped));
  assert.deepEqual(after.toJSON(), before.toJSON(), 'generation output must match before/after round-trip');

  console.log(`    stone count before/after round-trip: ${before.count}/${after.count}`);
});

// -----------------------------------------------------------------------------------------------
// (e) A layer with an EMPTY or ABSENT regions field produces byte-identical output (regression
//     guard) -- zero behavior change for every layer predating this step.
// -----------------------------------------------------------------------------------------------
await test('(e) absent vs empty-array regions produce byte-identical output to no regions field at all', () => {
  const engine = createEngine();
  const withoutRegionsKey = baseParams();
  const withEmptyRegions = baseParams({ regions: [] });

  const layoutA = engine.generatePathLayout(withoutRegionsKey);
  const layoutB = engine.generatePathLayout(withEmptyRegions);

  assert.deepEqual(layoutB.toJSON(), layoutA.toJSON(), 'empty regions array must be byte-identical to an absent regions field');
  assert.ok(layoutA.count > 0, 'sanity: the base fill actually produced stones');

  console.log(`    stone count (both): ${layoutA.count}`);
});

// -----------------------------------------------------------------------------------------------
// (f) Move/resize a layer that has regions -- region stones move/resize correctly WITH the shape,
//     proving the natural-space storage choice actually works (not just assumed).
// -----------------------------------------------------------------------------------------------
await test('(f) moving/resizing the parent shape moves/resizes its region\'s stones by the same transform', () => {
  const engine = createEngine();
  const regionSpec = { id: 'r1', contour: LEFT_HALF_CONTOUR, stoneSizeMm: 1, gapMm: 0.2, color: 'silver', fillMode: 'fill' };

  const original = baseParams({ regions: [regionSpec] });
  const originalRegionStones = engine.generatePathLayout(original).stones.filter((s) => s.color === 'silver');
  assert.ok(originalRegionStones.length > 0);

  // --- f1: pure translation (same widthMm/heightMm, only xMm/yMm shifted) --------------------
  // Same natural size -> same absolute stoneSizeMm/gapMm pitch grid -> identical candidate points,
  // just offset. This isolates the translate half of the transform with an exact point-for-point
  // check, unclouded by the area-scaling effect a widthMm/heightMm change also has on point count.
  const translated = baseParams({ xMm: 5, yMm: 7, regions: [regionSpec] });
  const translatedRegionStones = engine.generatePathLayout(translated).stones.filter((s) => s.color === 'silver');

  assert.equal(translatedRegionStones.length, originalRegionStones.length, 'pure translation must not change the region\'s own point count');
  const expectedTranslatedPoints = originalRegionStones
    .map((s) => ({ xMm: s.xMm + 5, yMm: s.yMm + 7 }))
    .sort((a, b) => a.xMm - b.xMm || a.yMm - b.yMm);
  const actualTranslatedPoints = translatedRegionStones
    .map((s) => ({ xMm: s.xMm, yMm: s.yMm }))
    .sort((a, b) => a.xMm - b.xMm || a.yMm - b.yMm);
  for (let i = 0; i < expectedTranslatedPoints.length; i++) {
    assert.ok(
      Math.abs(actualTranslatedPoints[i].xMm - expectedTranslatedPoints[i].xMm) < 1e-6 &&
      Math.abs(actualTranslatedPoints[i].yMm - expectedTranslatedPoints[i].yMm) < 1e-6,
      `region stone ${i} did not track pure translation: expected ` +
        `(${expectedTranslatedPoints[i].xMm.toFixed(3)},${expectedTranslatedPoints[i].yMm.toFixed(3)}), got ` +
        `(${actualTranslatedPoints[i].xMm.toFixed(3)},${actualTranslatedPoints[i].yMm.toFixed(3)})`
    );
  }

  // --- f2: resize (widthMm/heightMm doubled, plus a translate) --------------------------------
  // A fixed absolute stoneSizeMm/gapMm pitch over a quadrupled area (2x width * 2x height) legitimately
  // produces ~4x the points -- that is correct, expected behavior (identical to how the base fill's
  // own point count scales with widthMm/heightMm), not a bug. What this sub-test actually guards
  // against is the real bug caught during implementation: a region's transform being independently
  // re-derived from the region's OWN (smaller) natural bounding box instead of reusing the shape's
  // own scale -- which would fit the region to the FULL 40x40 placed box rather than correctly to
  // just its half, and the region would visibly bleed into the shape's right half.
  const resized = baseParams({ xMm: 50, yMm: 30, widthMm: 40, heightMm: 40, regions: [regionSpec] });
  const resizedRegionStones = engine.generatePathLayout(resized).stones.filter((s) => s.color === 'silver');
  assert.ok(resizedRegionStones.length > 0);

  // Correct transform: scaleX=scaleY=40/20=2, translate (50,30). The natural region spans
  // xMm∈[0,10] (out of the shape's own natural width 20) -> placed region must span xMm∈[50,70],
  // never past the shape's own left/right bounds [50,90] under a correctly-uniform scale.
  const xs = resizedRegionStones.map((s) => s.xMm);
  const ys = resizedRegionStones.map((s) => s.yMm);
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const minY = Math.min(...ys), maxY = Math.max(...ys);
  assert.ok(minX >= 50 - 1e-6, `region stones must not start left of the shape's own placed left edge (50), got minX=${minX}`);
  assert.ok(maxX <= 70 + 1e-6, `region stones must stay within the correctly-scaled half (xMm<=70) -- a maxX of ${maxX} indicates the region was fit to the FULL placed box instead of reusing the shape's own scale`);
  assert.ok(minY >= 30 - 1e-6 && maxY <= 70 + 1e-6, `region stones must stay within the placed shape's own y-range [30,70], got [${minY},${maxY}]`);

  // Every resized region stone, inverse-transformed back to natural space, must fall inside the
  // SAME natural LEFT_HALF_CONTOUR the original run used -- direct proof the shape-level transform,
  // not a bogus region-local one, produced these points.
  for (const s of resizedRegionStones) {
    const natural = { xMm: (s.xMm - 50) / 2, yMm: (s.yMm - 30) / 2 };
    assert.equal(
      isPointInsidePolygons(natural, [LEFT_HALF_CONTOUR]), true,
      `resized region stone inverse-transforms to (${natural.xMm.toFixed(2)},${natural.yMm.toFixed(2)}), outside the natural region contour`
    );
  }

  // Area quadruples (2x width * 2x height) at a fixed absolute pitch -> point count should be in
  // the same ballpark as 4x the original (loose bound; edge/pitch rounding prevents an exact 4x).
  const ratio = resizedRegionStones.length / originalRegionStones.length;
  assert.ok(ratio > 2.5 && ratio < 6, `expected roughly a 4x point-count increase for a 4x area increase, got ratio ${ratio.toFixed(2)} (${originalRegionStones.length} -> ${resizedRegionStones.length})`);

  // Region stones never re-scale the stone itself -- position scales with the shape, sizeMm doesn't.
  for (const s of resizedRegionStones) assert.equal(s.sizeMm, 1);

  console.log(`    region stone count original/translated/resized: ${originalRegionStones.length}/${translatedRegionStones.length}/${resizedRegionStones.length}`);
  console.log(`    resized region placed bbox: x[${minX.toFixed(2)},${maxX.toFixed(2)}] y[${minY.toFixed(2)},${maxY.toFixed(2)}] (expected x<=70, shape spans x[50,90])`);
});

console.log('RS-3011 Step 10a region data model tests complete.');
