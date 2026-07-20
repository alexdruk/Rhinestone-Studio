import assert from 'node:assert/strict';
import { GeometryEngine } from '../src/geometry/index.js';

// RC-002 — regression coverage for the Ring outline-overlap Release Candidate blocker.
//
// Root cause: outline mode samples stone centers directly on each contour's boundary curve
// (StoneSampler.js's sampleOutlinePoints()). For Ring (ShapeLibrary.js's
// createRingNaturalContours()) that means an outer-circle contour and an inner-circle contour,
// sampled completely independently. When the annulus between them (outer radius - inner radius)
// is narrower than one stone pitch (stoneSizeMm + gapMm), the two independently-sampled rings of
// stones physically overlap -- nothing previously related one contour's points to another's.
//
// Fix: StoneSampler.js's new sampleMultiContourOutlinePoints() (wired into sampleShapeFillPoints()'s
// 'outline' case, and into generateSvgLayout()'s closed-contour outline branch) still samples every
// contour's own points with the exact same per-contour arc-length walk as before, then drops any
// point that lands within one stone pitch of an already-kept point from a *different* contour. This
// is a general multi-contour fix, not Ring-specific -- it also protects any other shape whose
// GeometryEngine layout can produce more than one contour in outline mode (an SVG document with
// nested closed paths, a Boolean Operation difference result, a glyph with a counter/hole).

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

function createEngine() {
  return new GeometryEngine();
}

/** Every pair of stones whose center-to-center distance is less than the sum of their radii. */
function findOverlappingPairs(stones) {
  const pairs = [];
  for (let i = 0; i < stones.length; i++) {
    for (let j = i + 1; j < stones.length; j++) {
      const a = stones[i], b = stones[j];
      const distanceMm = Math.hypot(a.xMm - b.xMm, a.yMm - b.yMm);
      const minSeparationMm = (a.sizeMm + b.sizeMm) / 2;
      if (distanceMm < minSeparationMm - 1e-9) {
        pairs.push([a, b]);
      }
    }
  }
  return pairs;
}

/**
 * Overlapping pairs, restricted to pairs whose two stones classify to *different* contours (per
 * `classify`) -- i.e. the RC-002 defect this milestone fixes. A circular/elliptical outline
 * contour, even well outside this bug's scope, can have a same-contour "closing seam" pair (its
 * last arc-length sample back to its first, which is not necessarily exactly spacingMm) landing
 * slightly under the nominal spacing; that is a separate, pre-existing, single-contour artifact
 * (confirmed present and unchanged on `develop` before this fix) that this milestone does not
 * touch, so tests that sweep many parameter combinations classify pairs and assert only on the
 * cross-contour subset.
 */
function findCrossContourOverlappingPairs(stones, classify) {
  return findOverlappingPairs(stones).filter(([a, b]) => classify(a) !== classify(b));
}

/** Classifies a stone to 'outer' or 'inner' by which of two concentric circles it is nearer to. */
function classifyByNearerCircle(cx, cy, outerRadiusMm, innerRadiusMm) {
  return (s) => {
    const rMm = Math.hypot(s.xMm - cx, s.yMm - cy);
    return Math.abs(rMm - outerRadiusMm) < Math.abs(rMm - innerRadiusMm) ? 'outer' : 'inner';
  };
}

/** Classifies a stone to 'outer' or 'inner' by which of two concentric ellipses it is nearer to. */
function classifyByNearerEllipse(cx, cy, outer, inner) {
  const residual = (s, e) => {
    const dx = (s.xMm - cx) / e.rx, dy = (s.yMm - cy) / e.ry;
    return Math.abs(dx * dx + dy * dy - 1);
  };
  return (s) => (residual(s, outer) < residual(s, inner) ? 'outer' : 'inner');
}

function ringOutlineLayout(engine, { widthMm, heightMm, innerRatio, stoneSizeMm, gapMm }) {
  return engine.generateShapeLayout({
    shape: 'ring', layerId: 'ring-1', xMm: 0, yMm: 0, widthMm, heightMm,
    stoneSizeMm, gapMm, mode: 'outline', innerRatio
  });
}

// --- 1. The exact reported RC-001 repro case: no physical overlap ------------------------------

await test('1. reported repro case (20x20mm Ring, Inner Opening 0.9) produces zero overlapping stones', () => {
  const engine = createEngine();
  const layout = ringOutlineLayout(engine, { widthMm: 20, heightMm: 20, innerRatio: 0.9, stoneSizeMm: 1.5, gapMm: 0.2 });
  assert.ok(layout.stones.length > 0, 'expected at least one stone');
  assert.deepEqual(findOverlappingPairs(layout.stones), [], 'no two stones should physically overlap');
});

// --- 2. Maximum Inner Opening (narrowest annulus) across a range of stone sizes ----------------

await test('2. maximum Inner Opening (0.9) never has cross-contour overlap, across a range of stone sizes and gaps', () => {
  const engine = createEngine();
  const classify = classifyByNearerCircle(10, 10, 10, 9);
  const stoneConfigs = [
    { stoneSizeMm: 0.5, gapMm: 0.1 },
    { stoneSizeMm: 1.5, gapMm: 0.2 },
    { stoneSizeMm: 3, gapMm: 0.4 },
    { stoneSizeMm: 5, gapMm: 0.5 }
  ];
  for (const { stoneSizeMm, gapMm } of stoneConfigs) {
    const layout = ringOutlineLayout(engine, { widthMm: 20, heightMm: 20, innerRatio: 0.9, stoneSizeMm, gapMm });
    assert.deepEqual(
      findCrossContourOverlappingPairs(layout.stones, classify), [],
      `stoneSizeMm=${stoneSizeMm}, gapMm=${gapMm} should not have an outer/inner stone overlap`
    );
  }
});

// --- 3. Minimum Inner Opening (widest annulus, tiny inner circle) ------------------------------

await test('3. minimum Inner Opening (0.1) still traces both contours with zero cross-contour overlap', () => {
  const engine = createEngine();
  const layout = ringOutlineLayout(engine, { widthMm: 20, heightMm: 20, innerRatio: 0.1, stoneSizeMm: 1.5, gapMm: 0.2 });
  const classify = classifyByNearerCircle(10, 10, 10, 1);
  assert.deepEqual(
    findCrossContourOverlappingPairs(layout.stones, classify), [],
    'no outer-contour stone should overlap an inner-contour stone'
  );
});

// --- 4. Different stone sizes at a variety of Inner Openings ------------------------------------

await test('4. no cross-contour overlap across a matrix of Inner Openings and stone sizes', () => {
  const engine = createEngine();
  const innerRatios = [0.2, 0.5, 0.7, 0.85, 0.9];
  const stoneConfigs = [{ stoneSizeMm: 1, gapMm: 0.15 }, { stoneSizeMm: 2, gapMm: 0.3 }, { stoneSizeMm: 4, gapMm: 0.5 }];
  for (const innerRatio of innerRatios) {
    const classify = classifyByNearerCircle(20, 20, 20, innerRatio * 20);
    for (const { stoneSizeMm, gapMm } of stoneConfigs) {
      const layout = ringOutlineLayout(engine, { widthMm: 40, heightMm: 40, innerRatio, stoneSizeMm, gapMm });
      assert.deepEqual(
        findCrossContourOverlappingPairs(layout.stones, classify), [],
        `innerRatio=${innerRatio}, stoneSizeMm=${stoneSizeMm}, gapMm=${gapMm} should not have an outer/inner stone overlap`
      );
    }
  }
});

// --- 5. Non-circular (elliptical) Ring placement -------------------------------------------------

await test('5. an elliptical Ring placement (width != height) with a narrow annulus has no cross-contour overlap', () => {
  const engine = createEngine();
  // width != height (a genuinely elliptical, not circular, Ring) with a short semi-minor axis:
  // the annulus at its tightest (the flat top/bottom) is under one stone pitch, so this configuration
  // physically overlaps by 56 stone pairs before this fix (verified against `develop` directly).
  const widthMm = 40, heightMm = 16, innerRatio = 0.9, stoneSizeMm = 1.5, gapMm = 0.2;
  const layout = ringOutlineLayout(engine, { widthMm, heightMm, innerRatio, stoneSizeMm, gapMm });
  const cx = widthMm / 2, cy = heightMm / 2;
  const classify = classifyByNearerEllipse(
    cx, cy,
    { rx: widthMm / 2, ry: heightMm / 2 },
    { rx: (innerRatio * widthMm) / 2, ry: (innerRatio * heightMm) / 2 }
  );
  assert.deepEqual(
    findCrossContourOverlappingPairs(layout.stones, classify), [],
    'no outer-contour stone should overlap an inner-contour stone'
  );
});

// --- 6. Regression: a comfortable annulus is completely unaffected by the fix -------------------

await test('6. a normal Ring (wide annulus relative to stone pitch) has an unaffected cross-contour count, modulo RC-004A\'s own-circle closing-seam fix', () => {
  const engine = createEngine();
  const widthMm = 60, heightMm = 60, innerRatio = 0.5;
  const layout = ringOutlineLayout(engine, { widthMm, heightMm, innerRatio, stoneSizeMm: 1.5, gapMm: 0.2 });
  const cx = widthMm / 2, cy = heightMm / 2;
  const outerRadiusMm = widthMm / 2, innerRadiusMm = (innerRatio * widthMm) / 2;
  const nearOuter = layout.stones.filter((s) => Math.abs(Math.hypot(s.xMm - cx, s.yMm - cy) - outerRadiusMm) < 1);
  const nearInner = layout.stones.filter((s) => Math.abs(Math.hypot(s.xMm - cx, s.yMm - cy) - innerRadiusMm) < 1);
  assert.ok(nearOuter.length > 5, 'expected stones tracing the outer circle');
  assert.ok(nearInner.length > 5, 'expected stones tracing the inner circle');
  assert.deepEqual(
    findCrossContourOverlappingPairs(layout.stones, classifyByNearerCircle(cx, cy, outerRadiusMm, innerRadiusMm)), [],
    'a comfortable annulus should never have an outer/inner stone overlap'
  );

  // A wide annulus (30mm gap) is nowhere near the spacingMm=1.7 cross-contour proximity check, so
  // RC-002's cross-contour filter still prunes nothing here. RC-004A (this Ring's outer and inner
  // circle are each their own single contour) now additionally closes each circle's own
  // closing-seam gap: 167 was the pre-RC-004A count (verified directly against the pre-fix code);
  // this Ring's closing-seam remainder on both the outer and inner circle happened to land under
  // stoneSizeMm=1.5mm (confirmed: post-fix, every stone's own-circle angular neighbor is >=
  // 1.698mm apart, comfortably clear -- see tools/test-rc-004a-same-contour-overlap.mjs for the
  // dedicated closing-seam regression coverage), so one redundant stone is correctly dropped from
  // each circle: 165, not 167.
  assert.equal(layout.stones.length, 165, 'a wide annulus must sample exactly as many points as before this fix, minus the two same-circle closing-seam duplicates RC-004A now removes');
});

// --- 7. General multi-contour fix, not Ring-specific: an SVG donut (two nested closed circles) --

await test('7. an SVG document with two nested closed circles (a "donut", not Ring) also gets zero cross-contour overlap', () => {
  const engine = createEngine();
  // Two concentric circles in one SVG document, in natural (unplaced) units 20 wide, annulus of 1
  // natural unit between them -- narrow relative to the requested stone pitch once placed at 20mm.
  const donutSvg = '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20">'
    + '<circle cx="10" cy="10" r="10"/>'
    + '<circle cx="10" cy="10" r="9"/>'
    + '</svg>';
  const layout = engine.generateSvgLayout({
    svgSource: donutSvg, layerId: 'svg-donut', widthMm: 20, heightMm: 20,
    stoneSizeMm: 1.5, gapMm: 0.2, mode: 'outline'
  });
  assert.ok(layout.stones.length > 0, 'expected at least one stone');
  assert.deepEqual(findOverlappingPairs(layout.stones), [], 'nested SVG contours should not produce overlapping stones');
});

console.log('RC-002 (Ring outline overlap) tests passed.');
