import assert from 'node:assert/strict';
import { Point2D, BoundingBox } from '../src/text/VectorPath.js';
import {
  sampleContourFillPoints,
  sampleShapeFillPoints,
  computeInwardRingPolygons,
  splitSliverRuns,
  loopIsElongated,
  ELONGATION_MIN_ISOPERIMETRIC,
  isPointInsidePolygons
} from '../src/geometry/index.js';

// READ-001 -- Contour Fill: sub-cell ring placement, stoneSizeMm dedupe floor, and centreline
// collapse of slivered runs. Most strokes below are densely tessellated (~0.5mm edge steps),
// representative of a flattened glyph-stroke contour (font curves flatten to 16 segments each);
// test 1b additionally exercises literal 4-vertex rectangles (a Rect/Slot/Polygon layer), which
// splitSliverRuns() now internally densifies. Every number asserted here was produced by an actual
// run; see docs/specifications/READ-001-ContourCentreline.md for the before/after tables.

const SPACING_MM = 3.0;
const STROKE_HEIGHT_MM = 40;

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

function strokePolygon(widthMm) {
  const step = 0.5;
  const pts = [];
  for (let x = 0; x < widthMm; x += step) pts.push(new Point2D(x, 0));
  for (let y = 0; y < STROKE_HEIGHT_MM; y += step) pts.push(new Point2D(widthMm, y));
  for (let x = widthMm; x > 0; x -= step) pts.push(new Point2D(x, STROKE_HEIGHT_MM));
  for (let y = STROKE_HEIGHT_MM; y > 0; y -= step) pts.push(new Point2D(0, y));
  return pts;
}

// A stadium (rounded-cap) stroke: what a real glyph terminal actually looks like. Straight sides at
// x = 0 and x = widthMm, joined by semicircular caps of radius widthMm/2 at each end. Densely
// tessellated (~0.3mm) like a flattened font contour.
function stadiumStroke(widthMm) {
  const r = widthMm / 2;
  const cx = r;
  const step = 0.3;
  const capSteps = Math.max(6, Math.ceil((Math.PI * r) / step));
  const pts = [];
  for (let k = 0; k <= capSteps; k++) {
    const a = Math.PI + (k / capSteps) * Math.PI;              // bottom cap, centre (cx, r)
    pts.push(new Point2D(cx + r * Math.cos(a), r + r * Math.sin(a)));
  }
  for (let y = r; y < STROKE_HEIGHT_MM - r; y += step) pts.push(new Point2D(widthMm, y));
  for (let k = 0; k <= capSteps; k++) {
    const a = (k / capSteps) * Math.PI;                        // top cap, centre (cx, H - r)
    pts.push(new Point2D(cx + r * Math.cos(a), (STROKE_HEIGHT_MM - r) + r * Math.sin(a)));
  }
  for (let y = STROKE_HEIGHT_MM - r; y > r; y -= step) pts.push(new Point2D(0, y));
  return pts;
}

// The single measurement that matters for terminal collapse: the furthest any stone lands from the
// stroke's true centreline x = widthMm/2. Not grouped into lanes -- lane grouping silently drops the
// off-centre singletons a broken terminal leaves behind, which is exactly the defect.
const maxCentrelineDeviationMm = (stones, widthMm) =>
  stones.reduce((m, p) => Math.max(m, Math.abs(p.xMm - widthMm / 2)), 0);

function largestGapAlongYmm(stones) {
  const ys = stones.map((p) => p.yMm).sort((a, b) => a - b);
  let gap = 0;
  for (let i = 1; i < ys.length; i++) gap = Math.max(gap, ys[i] - ys[i - 1]);
  return { gapMm: gap, spanMm: ys.length ? ys[ys.length - 1] - ys[0] : 0 };
}

// The ordering hazard (see splitSliverRuns()'s doc comment): a naive terminal absorb appends the far
// tip after the near one, producing a polyline that jumps the length of the stroke. Every emitted
// open piece must instead be a connected walk -- no internal segment longer than 2x minSeparationMm.
function maxPieceSegmentMm(pieces) {
  let max = 0;
  for (const piece of pieces) {
    for (let i = 1; i < piece.points.length; i++) {
      max = Math.max(max, Math.hypot(
        piece.points[i].xMm - piece.points[i - 1].xMm,
        piece.points[i].yMm - piece.points[i - 1].yMm
      ));
    }
  }
  return max;
}

// perpendicular distance from an interior point to the boundary of the axis-aligned stroke rect
const strokeBoundaryDistanceMm = (xMm, yMm, widthMm) =>
  Math.min(xMm, widthMm - xMm, yMm, STROKE_HEIGHT_MM - yMm);

// 1-D positional clustering (points on lanes); merges values whose gap <= tolMm.
function clusterValues(values, tolMm) {
  const sorted = [...values].sort((a, b) => a - b);
  const lanes = [];
  for (const v of sorted) {
    const last = lanes[lanes.length - 1];
    if (last && v - last.values[last.values.length - 1] <= tolMm) last.values.push(v);
    else lanes.push({ values: [v] });
  }
  return lanes.map((lane) => ({
    meanMm: lane.values.reduce((s, x) => s + x, 0) / lane.values.length,
    count: lane.values.length
  }));
}
// half a pitch: distinct lanes are >= 1 pitch apart, so this never merges two real lanes, but it
// does merge the doubled row a sliver's rounded end cap leaves near x == cap centre.
const LANE_TOL_MM = SPACING_MM * 0.45;

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

function ringPolygonsForStroke(widthMm) {
  const polygon = strokePolygon(widthMm);
  const insideAt = (xMm, yMm) => isPointInsidePolygons(new Point2D(xMm, yMm), [polygon]);
  return computeInwardRingPolygons({
    insideAt,
    boundingBox: BoundingBox.fromPoints(polygon),
    spacingMm: SPACING_MM,
    startOffsetMm: SPACING_MM
  });
}

// The lane x-positions Contour Fill should land for each stroke width at spacingMm = 3.0: the two
// boundary lanes, each ring branch that survives as its own lane at k*pitch from a boundary, and
// W/2 where the innermost ring degenerates to (or a sub-2-pitch ring collapses onto) the medial
// axis. Every one of these is a "branch" -- asserted individually, never as a mean.
const EXPECTED_LANES_MM = {
  6: [0, 3.0, 6],
  7: [0, 3.5, 7],
  8: [0, 4.0, 8],
  9: [0, 3.0, 6.0, 9],
  12: [0, 3.0, 6.0, 9.0, 12]
};

// --- 1. Every ring branch lands within +/-0.10mm of nominal, asserted per branch ----------------

await test('1. every contour ring branch lands within +-0.10mm of its nominal position (W = 6, 7, 8, 9, 12mm), per branch', () => {
  const stoneSizeMm = 2.5;
  for (const widthMm of [6, 7, 8, 9, 12]) {
    const stones = sampleContourFillPoints(
      [strokePolygon(widthMm)],
      BoundingBox.fromPoints(strokePolygon(widthMm)),
      SPACING_MM,
      stoneSizeMm
    ).filter((p) => p.yMm >= 12 && p.yMm <= STROKE_HEIGHT_MM - 12);
    const lanes = clusterValues(stones.map((p) => p.xMm), LANE_TOL_MM);
    const expected = EXPECTED_LANES_MM[widthMm];
    assert.equal(lanes.length, expected.length, `W=${widthMm}: expected ${expected.length} lanes, got ${lanes.length} (${lanes.map((l) => l.meanMm.toFixed(2))})`);
    lanes.forEach((lane, i) => {
      assert.ok(
        Math.abs(lane.meanMm - expected[i]) <= 0.10,
        `W=${widthMm} lane ${i}: x=${lane.meanMm.toFixed(3)}mm is not within 0.10mm of nominal ${expected[i]}mm`
      );
    });
  }

  // The non-degenerate rings (W=9 k=1, W=12 k=1 -- both wider than one pitch, so they stay a real
  // two-branch ring) are also checked on the raw traced polygon, left and right branch separately.
  for (const widthMm of [9, 12]) {
    const [ring] = ringPolygonsForStroke(widthMm);
    const central = ring.filter((p) => p.yMm >= 10 && p.yMm <= STROKE_HEIGHT_MM - 10);
    const leftMm = central.filter((p) => p.xMm < widthMm / 2).map((p) => p.xMm);
    const rightMm = central.filter((p) => p.xMm >= widthMm / 2).map((p) => p.xMm);
    const leftDistMm = leftMm.reduce((s, x) => s + x, 0) / leftMm.length;
    const rightDistMm = widthMm - rightMm.reduce((s, x) => s + x, 0) / rightMm.length;
    assert.ok(Math.abs(leftDistMm - 3.0) <= 0.10, `W=${widthMm} k=1 left branch at ${leftDistMm.toFixed(3)}mm (nominal 3.0)`);
    assert.ok(Math.abs(rightDistMm - 3.0) <= 0.10, `W=${widthMm} k=1 right branch at ${rightDistMm.toFixed(3)}mm (nominal 3.0)`);
  }
});

// --- 1b. Literal 4-vertex rectangle: EVERY stone on the centreline, terminals included ----------

const rect4 = (widthMm) => [
  new Point2D(0, 0), new Point2D(widthMm, 0), new Point2D(widthMm, STROKE_HEIGHT_MM), new Point2D(0, STROKE_HEIGHT_MM)
];

await test('1b. a literal 4-vertex 2.5mm rectangle: every stone within 0.15mm of x = 1.25, terminals included', () => {
  // The earlier version of this test grouped stones into lanes with clusterValues() and asserted
  // "one lane at 1.25". That measurement dropped the two singletons a broken terminal leaves -- a
  // stone on each far corner, a full half-width (1.25mm) off-centre and hanging outside the letter.
  // It reported a pass the code had not earned. This asserts the maximum deviation over EVERY stone
  // and prints the full list so the result is inspectable.
  const stoneSizeMm = 2.5;
  const stones = sampleContourFillPoints([rect4(2.5)], BoundingBox.fromPoints(rect4(2.5)), SPACING_MM, stoneSizeMm)
    .slice().sort((a, b) => a.yMm - b.yMm);

  console.log('    4-vertex 2.5x40mm rectangle -- complete stone list, sorted by y:');
  for (const p of stones) console.log(`      (${p.xMm.toFixed(3)}, ${p.yMm.toFixed(2)})`);

  const devMm = maxCentrelineDeviationMm(stones, 2.5);
  assert.ok(devMm <= 0.15, `max deviation from x=1.25 is ${devMm.toFixed(3)}mm (want <= 0.15)`);

  const { gapMm, spanMm } = largestGapAlongYmm(stones);
  assert.ok(gapMm <= 1.2 * SPACING_MM, `largest gap along the centreline is ${gapMm.toFixed(2)}mm (want <= ${(1.2 * SPACING_MM).toFixed(1)})`);
  assert.ok(spanMm >= STROKE_HEIGHT_MM - 2.5, `centreline spans only ${spanMm.toFixed(1)}mm (want >= ${STROKE_HEIGHT_MM - 2.5})`);
  assert.ok(minNearestNeighbourMm(stones) >= stoneSizeMm - 1e-6, `two stones closer than ${stoneSizeMm}mm`);
});

await test('1b(ii). a literal 4-vertex 8mm rectangle: three lanes, interior lane within 0.15mm of x = 4.0', () => {
  const stoneSizeMm = 2.5;
  const stones = sampleContourFillPoints([rect4(8)], BoundingBox.fromPoints(rect4(8)), SPACING_MM, stoneSizeMm)
    .filter((p) => p.yMm >= 10 && p.yMm <= STROKE_HEIGHT_MM - 10);
  const lanes = clusterValues(stones.map((p) => p.xMm), LANE_TOL_MM);
  assert.equal(lanes.length, 3, `4-vertex W=8: expected three lanes, got ${lanes.length} (${lanes.map((l) => l.meanMm.toFixed(2))})`);
  assert.ok(Math.abs(lanes[1].meanMm - 4.0) <= 0.15, `4-vertex W=8: interior lane at x=${lanes[1].meanMm.toFixed(3)}mm (want 4.0)`);
});

// --- 1c. Rounded-cap (stadium) strokes narrower than a pitch: full-length centreline, no drift ---

await test('1c. stadium strokes W = 2.0, 2.5, 2.8, 2.9mm: every stone on the centreline, tip to tip', () => {
  const stoneSizeMm = 2.5;
  for (const widthMm of [2.0, 2.5, 2.8, 2.9]) {
    const poly = stadiumStroke(widthMm);
    const stones = sampleContourFillPoints([poly], BoundingBox.fromPoints(poly), SPACING_MM, stoneSizeMm);

    const devMm = maxCentrelineDeviationMm(stones, widthMm);
    assert.ok(devMm <= 0.15, `W=${widthMm}: a stone lands ${devMm.toFixed(3)}mm off the x=${widthMm / 2} centreline (want <= 0.15)`);

    const { gapMm, spanMm } = largestGapAlongYmm(stones);
    assert.ok(gapMm <= 1.2 * SPACING_MM, `W=${widthMm}: largest centreline gap ${gapMm.toFixed(2)}mm (want <= ${(1.2 * SPACING_MM).toFixed(1)})`);
    assert.ok(spanMm >= STROKE_HEIGHT_MM - widthMm, `W=${widthMm}: centreline spans ${spanMm.toFixed(1)}mm (want >= ${(STROKE_HEIGHT_MM - widthMm).toFixed(1)})`);
    assert.ok(minNearestNeighbourMm(stones) >= stoneSizeMm - 1e-6, `W=${widthMm}: two stones closer than ${stoneSizeMm}mm`);

    const maxSegMm = maxPieceSegmentMm(splitSliverRuns(poly.map((p) => ({ xMm: p.xMm, yMm: p.yMm })), SPACING_MM));
    assert.ok(maxSegMm <= 2 * SPACING_MM, `W=${widthMm}: an emitted piece has a ${maxSegMm.toFixed(2)}mm internal jump (ordering hazard; want <= ${2 * SPACING_MM})`);
  }
});

// --- 1d. Stadium strokes wider than a pitch must NOT collapse -- both edge lanes are real ---------

await test('1d. stadium strokes W = 3.2, 4.0, 5.0mm keep two distinct edge lanes (no collapse)', () => {
  const stoneSizeMm = 2.5;
  for (const widthMm of [3.2, 4.0, 5.0]) {
    const poly = stadiumStroke(widthMm);
    const pieces = splitSliverRuns(poly.map((p) => ({ xMm: p.xMm, yMm: p.yMm })), SPACING_MM);
    assert.ok(pieces.length === 1 && pieces[0].closed, `W=${widthMm}: expected the loop to stay one closed piece, got ${pieces.length} piece(s) closed=${pieces.map((p) => p.closed)}`);

    const stones = sampleContourFillPoints([poly], BoundingBox.fromPoints(poly), SPACING_MM, stoneSizeMm)
      .filter((p) => p.yMm >= 8 && p.yMm <= STROKE_HEIGHT_MM - 8);
    const lanes = clusterValues(stones.map((p) => p.xMm), LANE_TOL_MM);
    assert.equal(lanes.length, 2, `W=${widthMm}: expected two edge lanes, got ${lanes.length} (${lanes.map((l) => l.meanMm.toFixed(2))})`);
  }
});

// --- 2. Lane structure: W=8 fills its interior; W=12 is five symmetric lanes -------------------

await test('2. W=8mm yields >=3 lanes with a well-populated interior lane; W=12mm yields five mirror-symmetric lanes', () => {
  const stoneSizeMm = 2.5; // gap 0.5mm -> pitch 3.0mm

  const eight = sampleContourFillPoints([strokePolygon(8)], BoundingBox.fromPoints(strokePolygon(8)), SPACING_MM, stoneSizeMm)
    .filter((p) => p.yMm >= 6 && p.yMm <= STROKE_HEIGHT_MM - 6);
  const eightLanes = clusterValues(eight.map((p) => p.xMm), LANE_TOL_MM);
  assert.ok(eightLanes.length >= 3, `W=8: expected >=3 lanes, got ${eightLanes.length}`);
  const eightInterior = eightLanes.filter((l) => l.meanMm > 1 && l.meanMm < 7);
  assert.equal(eightInterior.length, 1, `W=8: expected exactly one interior lane, got ${eightInterior.length}`);
  assert.ok(eightInterior[0].count >= 8, `W=8: interior lane holds only ${eightInterior[0].count} stones (want >= 8)`);

  const twelve = sampleContourFillPoints([strokePolygon(12)], BoundingBox.fromPoints(strokePolygon(12)), SPACING_MM, stoneSizeMm)
    .filter((p) => p.yMm >= 6 && p.yMm <= STROKE_HEIGHT_MM - 6);
  const twelveLanes = clusterValues(twelve.map((p) => p.xMm), LANE_TOL_MM);
  assert.equal(twelveLanes.length, 5, `W=12: expected exactly five lanes, got ${twelveLanes.length} (${twelveLanes.map((l) => l.meanMm.toFixed(2))})`);
  // mirror-symmetry about the stroke centre (x = 6)
  for (let i = 0; i < twelveLanes.length; i++) {
    const mirror = twelveLanes[twelveLanes.length - 1 - i];
    const mirroredMm = 12 - mirror.meanMm;
    assert.ok(
      Math.abs(twelveLanes[i].meanMm - mirroredMm) <= 0.3,
      `W=12: lane ${twelveLanes[i].meanMm.toFixed(2)} is not the mirror of ${mirror.meanMm.toFixed(2)} within 0.3mm`
    );
  }
});

// --- 3. Sub-pitch stroke collapses to a centred single lane -----------------------------------

await test('3. a 2.5mm (sub-pitch) stroke collapses to a single lane centred within 0.3mm of x = 1.25', () => {
  const points = sampleContourFillPoints([strokePolygon(2.5)], BoundingBox.fromPoints(strokePolygon(2.5)), SPACING_MM, 2.5)
    .filter((p) => p.yMm >= 10 && p.yMm <= STROKE_HEIGHT_MM - 10);
  assert.ok(points.length > 0, 'expected interior points for the 2.5mm stroke');
  const lanes = clusterValues(points.map((p) => p.xMm), LANE_TOL_MM);
  assert.equal(lanes.length, 1, `expected a single collapsed lane, got ${lanes.length} (${lanes.map((l) => l.meanMm.toFixed(2))})`);
  assert.ok(
    Math.abs(lanes[0].meanMm - 1.25) <= 0.3,
    `collapsed lane at x=${lanes[0].meanMm.toFixed(3)} is not within 0.3mm of the 1.25mm centreline`
  );
});

// --- 4. W=7mm is one clean interior lane with no physical overlap -----------------------------

await test('4. a 7mm stroke yields one clean interior lane and no two surviving stones closer than stoneSizeMm', () => {
  const stoneSizeMm = 2.5;
  const all = sampleContourFillPoints([strokePolygon(7)], BoundingBox.fromPoints(strokePolygon(7)), SPACING_MM, stoneSizeMm);
  assert.ok(
    minNearestNeighbourMm(all) >= stoneSizeMm - 1e-6,
    `two stones are closer than stoneSizeMm (${minNearestNeighbourMm(all).toFixed(3)}mm < ${stoneSizeMm}mm)`
  );
  const central = all.filter((p) => p.yMm >= 6 && p.yMm <= STROKE_HEIGHT_MM - 6);
  const interior = clusterValues(central.map((p) => p.xMm), LANE_TOL_MM).filter((l) => l.meanMm > 1 && l.meanMm < 6);
  assert.equal(interior.length, 1, `W=7: expected exactly one interior lane, got ${interior.length}`);
  assert.ok(
    Math.abs(interior[0].meanMm - 3.5) <= 0.4,
    `W=7: interior lane at x=${interior[0].meanMm.toFixed(3)} is not near the 3.5mm centreline`
  );
});

// --- 5. Closed-shape regression: a circle still yields five clean concentric rings ------------

await test('5. a circle (r=15mm) still yields five concentric rings of decreasing radius and its stone count does not decrease', () => {
  const circle = [];
  for (let k = 0; k < 240; k++) {
    const a = (k / 240) * 2 * Math.PI;
    circle.push(new Point2D(20 + 15 * Math.cos(a), 20 + 15 * Math.sin(a)));
  }
  const boundingBox = BoundingBox.fromPoints(circle);

  // Production always passes stoneSizeMm (GeometryEngine.generateShapeLayout); with a real gap the
  // READ-001 floor keeps *more* stones than the pre-change full-pitch floor. Baseline captured on
  // develop @ 5fc122c — 53 stones.
  const BASELINE_COUNT = 53;
  const withGap = sampleContourFillPoints([circle], boundingBox, SPACING_MM, 2.5);
  assert.ok(withGap.length >= BASELINE_COUNT, `circle stone count dropped to ${withGap.length} (baseline ${BASELINE_COUNT})`);

  for (const points of [withGap, sampleContourFillPoints([circle], boundingBox, SPACING_MM)]) {
    const radii = points.map((p) => Math.hypot(p.xMm - 20, p.yMm - 20));
    const rings = clusterValues(radii, 1.2);
    assert.equal(rings.length, 5, `expected five concentric rings, got ${rings.length} (${rings.map((r) => r.meanMm.toFixed(2))})`);
    for (let i = 1; i < rings.length; i++) {
      assert.ok(rings[i].meanMm > rings[i - 1].meanMm, 'ring radii must be monotonically ordered');
    }
  }
});

// --- 6. Outline mode's sampling path is completely untouched ----------------------------------

await test('6. sampleShapeFillPoints("outline", ...) on a multi-contour glyph-like polygon is byte-for-byte unchanged', () => {
  const outer = [];
  for (let k = 0; k < 40; k++) {
    const a = (k / 40) * 2 * Math.PI;
    outer.push(new Point2D(20 + 18 * Math.cos(a), 20 + 18 * Math.sin(a)));
  }
  const inner = [];
  for (let k = 0; k < 24; k++) {
    const a = (k / 24) * 2 * Math.PI;
    inner.push(new Point2D(20 + 8 * Math.cos(a), 20 - 8 * Math.sin(a)));
  }
  const polygons = [outer, inner];
  const boundingBox = BoundingBox.fromPoints([...outer, ...inner]);
  const points = sampleShapeFillPoints('outline', polygons, boundingBox, SPACING_MM, 2.5);

  // Reference values captured on develop @ 5fc122c.
  assert.equal(points.length, 55, `outline stone count changed to ${points.length}`);
  assert.ok(
    Math.abs(points[0].xMm - 38.0) < 1e-3 && Math.abs(points[0].yMm - 20.0) < 1e-3,
    `outline first point moved to (${points[0].xMm.toFixed(3)}, ${points[0].yMm.toFixed(3)})`
  );
  const last = points[points.length - 1];
  assert.ok(
    Math.abs(last.xMm - 27.398) < 1e-3 && Math.abs(last.yMm - 22.865) < 1e-3,
    `outline last point moved to (${last.xMm.toFixed(3)}, ${last.yMm.toFixed(3)})`
  );
});

// --- 7. splitSliverRuns() contract ----------------------------------------------------------

await test('7. splitSliverRuns() leaves a wide loop untouched and collapses a thin loop to an un-doubled centreline', () => {
  // a wide circle: opposing edges are far apart -> no sliver -> single closed piece, unchanged
  const circle = [];
  for (let k = 0; k < 60; k++) {
    const a = (k / 60) * 2 * Math.PI;
    circle.push({ xMm: 20 * Math.cos(a), yMm: 20 * Math.sin(a) });
  }
  const wide = splitSliverRuns(circle, 3.0);
  assert.equal(wide.length, 1);
  assert.equal(wide[0].closed, true);
  assert.equal(wide[0].points.length, circle.length);

  // a long, ~1mm-wide loop: the parallel branches collapse to a centreline on y = 0. Its square
  // ends are short non-slivered runs flanked by slivered runs, so they are absorbed as terminals
  // (READ-001 third pass) and the whole loop becomes a single tip-to-tip open piece on y = 0.
  const thin = [];
  for (let x = 0; x <= 30; x += 0.5) thin.push({ xMm: x, yMm: 0.5 });
  for (let x = 30; x >= 0; x -= 0.5) thin.push({ xMm: x, yMm: -0.5 });
  const pieces = splitSliverRuns(thin, 3.0);
  assert.ok(pieces.every((p) => !p.closed), 'a fully-parallel thin loop must not stay a closed ring');
  const totalPoints = pieces.reduce((s, p) => s + p.points.length, 0);
  assert.ok(totalPoints <= thin.length * 0.7, `centreline collapse should roughly halve the vertex count, got ${totalPoints} of ${thin.length}`);
  const centreline = pieces.find((p) => p.points.length >= 20);
  assert.ok(centreline, 'expected one dominant centreline piece');
  assert.ok(centreline.points.every((p) => Math.abs(p.yMm) < 1e-6), 'the centreline should sit on y = 0');
  assert.ok(maxPieceSegmentMm(pieces) <= 2 * 3.0, `an emitted piece jumps ${maxPieceSegmentMm(pieces).toFixed(2)}mm internally (ordering hazard)`);
});

// --- 8. ELONGATION_MIN_ISOPERIMETRIC is pinned between a stroke band (keep) and a blob (reject) ---

await test('8. loopIsElongated() keeps an elongated degenerate band and rejects a round degenerate blob', () => {
  const perimeterAndArea = (loop) => {
    let a2 = 0;
    let per = 0;
    for (let i = 0; i < loop.length; i++) {
      const p = loop[i];
      const q = loop[(i + 1) % loop.length];
      a2 += p.xMm * q.yMm - q.xMm * p.yMm;
      per += Math.hypot(q.xMm - p.xMm, q.yMm - p.yMm);
    }
    return { perMm: per, areaMm2: Math.abs(a2) / 2 };
  };

  assert.equal(ELONGATION_MIN_ISOPERIMETRIC, 25, 'constant changed -- re-measure both sides before adjusting this test');

  // (a) an elongated band -- what an even-N-pitch stroke's innermost ring degenerates to: a thin
  // rectangle ~1 cell wide down the medial axis. Must be KEPT.
  const bandW = 0.4;
  const bandL = 30;
  const band = [
    { xMm: 0, yMm: 0 }, { xMm: bandW, yMm: 0 }, { xMm: bandW, yMm: bandL }, { xMm: 0, yMm: bandL }
  ];
  const bandGeom = perimeterAndArea(band);
  const bandRatio = (bandGeom.perMm * bandGeom.perMm) / bandGeom.areaMm2;
  console.log(`    elongated band ${bandW}x${bandL}mm: P^2/A = ${bandRatio.toFixed(1)} (cutoff ${ELONGATION_MIN_ISOPERIMETRIC})`);
  assert.ok(bandRatio > ELONGATION_MIN_ISOPERIMETRIC, `band P^2/A ${bandRatio.toFixed(1)} should exceed the cutoff`);
  assert.equal(loopIsElongated(band), true, 'an elongated degenerate band must be kept');

  // (b) a round-ish blob -- a disc's or square's degenerate centre. Must be REJECTED.
  const blob = [];
  for (let k = 0; k < 24; k++) {
    const a = (k / 24) * 2 * Math.PI;
    blob.push({ xMm: 2 * Math.cos(a), yMm: 2 * Math.sin(a) });
  }
  const blobGeom = perimeterAndArea(blob);
  const blobRatio = (blobGeom.perMm * blobGeom.perMm) / blobGeom.areaMm2;
  console.log(`    round blob r=2mm: P^2/A = ${blobRatio.toFixed(1)} (4*pi = ${(4 * Math.PI).toFixed(1)})`);
  assert.ok(blobRatio < ELONGATION_MIN_ISOPERIMETRIC, `blob P^2/A ${blobRatio.toFixed(1)} should be below the cutoff`);
  assert.equal(loopIsElongated(blob), false, 'a round degenerate blob must be rejected');

  // and a unit square (a Rect's degenerate centre) -- P^2/A = 16, also rejected.
  const square = [{ xMm: 0, yMm: 0 }, { xMm: 5, yMm: 0 }, { xMm: 5, yMm: 5 }, { xMm: 0, yMm: 5 }];
  const squareGeom = perimeterAndArea(square);
  const squareRatio = (squareGeom.perMm * squareGeom.perMm) / squareGeom.areaMm2;
  console.log(`    square 5x5mm: P^2/A = ${squareRatio.toFixed(1)}`);
  assert.equal(loopIsElongated(square), false, 'a square degenerate blob must be rejected');
});

console.log('READ-001 contour centreline tests complete.');
