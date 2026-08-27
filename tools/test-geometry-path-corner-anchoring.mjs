import assert from 'node:assert/strict';
import { GeometryEngine, detectPolygonCornerFlags, sampleShapeFillPoints } from '../src/geometry/index.js';

// Corner-anchored per-side Outline spacing for drawn 'path' layers (Rect/Polygon/Pen/Freehand
// tools, Boolean-op results). Prior to this milestone, generatePathLayout() never passed
// cornerFlagsByContour to sampleShapeFillPoints(), so a drawn path always fell back to the
// whole-loop uniform walk (no stone guaranteed at a drawn corner, equal-length opposite sides
// could get different stone counts). This is detection + plumbing only: the per-side sampling
// mechanism itself (sampleCornerAnchoredOutlinePoints()/
// sampleMultiContourOutlinePointsWithCornerProtection() in StoneSampler.js) already exists and is
// exercised by GeometryEngine's own Rect/Polygon/Star/Arrow/Cross ShapeLibrary path.
//
// detectPolygonCornerFlags() (ContourGeometry.js) is the new piece: given an already-flattened
// polygon with no corner provenance, it measures each vertex's incoming/outgoing direction over a
// PATH_CORNER_NOISE_FLOOR_MM=0.5mm arc-length window (immune to jitter shorter than that) and
// flags a corner where the turn angle is >= PATH_CORNER_TURN_ANGLE_DEG=35. It returns null (caller
// falls back to the existing uniform walk) for open contours, degenerate contours, too few corners
// (<3, no meaningful "sides"), or a scribble signature (>16 corners AND >25% of all vertices are
// corners -- both conditions, not either alone, or a small legitimate polygon like a plain
// rectangle/triangle -- where every vertex is a genuine corner -- would be wrongly rejected).

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

function rectPolygon(x, y, w, h) {
  return [{ xMm: x, yMm: y }, { xMm: x + w, yMm: y }, { xMm: x + w, yMm: y + h }, { xMm: x, yMm: y + h }];
}

function ellipsePolygon(cx, cy, rx, ry, n) {
  const pts = [];
  for (let i = 0; i < n; i++) {
    const t = (i / n) * Math.PI * 2;
    pts.push({ xMm: cx + rx * Math.cos(t), yMm: cy + ry * Math.sin(t) });
  }
  return pts;
}

// A rectangle whose edges are subdivided into short segments with a smooth, low-frequency
// perpendicular wobble (representative of real freehand-tool tremor, not independent per-vertex
// noise -- iid noise at this pitch/amplitude is unrealistically high-frequency for a human hand and
// isn't what PATH_CORNER_NOISE_FLOOR_MM is meant to absorb). Corners themselves are always exact,
// unjittered points.
function jitteredRectPolygon(x, y, w, h, segLenMm, jitterMm) {
  const corners = [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];
  const pts = [];
  for (let i = 0; i < 4; i++) {
    const [ax, ay] = corners[i];
    const [bx, by] = corners[(i + 1) % 4];
    const dx = bx - ax;
    const dy = by - ay;
    const lengthMm = Math.hypot(dx, dy);
    const n = Math.max(1, Math.round(lengthMm / segLenMm));
    const ux = dx / lengthMm;
    const uy = dy / lengthMm;
    const nx = -uy;
    const ny = ux;
    pts.push({ xMm: ax, yMm: ay });
    for (let k = 1; k < n; k++) {
      const t = k / n;
      const jitter = jitterMm * Math.sin(t * Math.PI * 2);
      pts.push({ xMm: ax + dx * t + nx * jitter, yMm: ay + dy * t + ny * jitter });
    }
  }
  return pts;
}

// A coarse scribble: short (1-2mm) segments alternating sharply between two directions, drifting
// slowly around a loop so it closes on itself without any two segments being individually shorter
// than the noise floor -- the "many genuinely sharp turns, none of them jitter" case the max-count/
// max-fraction safety valve exists for.
function zigzagPolygon(n) {
  const pts = [];
  let x = 0;
  let y = 0;
  const baseAngleStep = (Math.PI * 2) / n;
  for (let i = 0; i < n; i++) {
    const dir = baseAngleStep * i + (i % 2 === 0 ? 0.9 : -0.9);
    const segLenMm = 1 + (i % 2) * 1;
    x += Math.cos(dir) * segLenMm;
    y += Math.sin(dir) * segLenMm;
    pts.push({ xMm: x, yMm: y });
  }
  return pts;
}

function distanceMm(a, b) {
  return Math.hypot(a.xMm - b.xMm, a.yMm - b.yMm);
}

function closestDistanceMm(stones, point) {
  return Math.min(...stones.map((s) => distanceMm(s, point)));
}

// --- 1. Drawn rectangle: 4 corners flagged, a stone on each, equal counts on matching sides -----

await test('1. drawn 30x8mm rectangle: 4 corners flagged, a stone exactly on each, equal per-side counts', () => {
  const engine = new GeometryEngine();
  const contours = [rectPolygon(0, 0, 30, 8)];
  const stoneSizeMm = 2;
  const gapMm = 0.3;
  const spacingMm = stoneSizeMm + gapMm;

  const layout = engine.generatePathLayout({ contours, layerId: 'rect-1', xMm: 0, yMm: 0, widthMm: 30, heightMm: 8, stoneSizeMm, gapMm, mode: 'outline' });

  for (const corner of contours[0]) {
    assert.ok(closestDistanceMm(layout.stones, corner) < 1e-6, `expected a stone exactly on corner (${corner.xMm}, ${corner.yMm})`);
  }

  const bottomCount = layout.stones.filter((s) => Math.abs(s.yMm - 0) < 1e-6).length;
  const topCount = layout.stones.filter((s) => Math.abs(s.yMm - 8) < 1e-6).length;
  const leftCount = layout.stones.filter((s) => Math.abs(s.xMm - 0) < 1e-6).length;
  const rightCount = layout.stones.filter((s) => Math.abs(s.xMm - 30) < 1e-6).length;

  assert.equal(bottomCount, topCount, 'the two long (30mm) sides must get equal stone counts');
  assert.equal(leftCount, rightCount, 'the two short (8mm) sides must get equal stone counts');

  const nLong = Math.max(1, Math.round(30 / spacingMm));
  const nShort = Math.max(1, Math.round(8 / spacingMm));
  assert.equal(layout.count, 2 * nLong + 2 * nShort);
});

// --- 2. Drawn triangle: 3 corners flagged, a stone on each ---------------------------------------

await test('2. drawn triangle: 3 corners flagged, a stone on each vertex', () => {
  const engine = new GeometryEngine();
  const triangle = [{ xMm: 0, yMm: 0 }, { xMm: 10, yMm: 0 }, { xMm: 5, yMm: 8 }];

  const flags = detectPolygonCornerFlags(triangle);
  assert.deepEqual(flags, [true, true, true]);

  const layout = engine.generatePathLayout({ contours: [triangle], layerId: 'tri-1', xMm: 0, yMm: 0, widthMm: 10, heightMm: 8, stoneSizeMm: 2, gapMm: 0.3, mode: 'outline' });
  for (const vertex of triangle) {
    assert.ok(closestDistanceMm(layout.stones, vertex) < 1e-6, `expected a stone exactly on vertex (${vertex.xMm}, ${vertex.yMm})`);
  }
});

// --- 3. Coarse 64-gon ellipse: no corners, output identical to direct uniform-mode sampling ------

await test('3. coarse 64-gon ellipse approximation: detectPolygonCornerFlags returns null, layout matches direct uniform-mode sampling', () => {
  const engine = new GeometryEngine();
  const polygon = ellipsePolygon(10, 10, 10, 10, 64); // ~5.6 degrees/vertex, non-negative so xMm=yMm=0 keeps 1:1 placement
  assert.equal(detectPolygonCornerFlags(polygon), null);

  const stoneSizeMm = 2;
  const gapMm = 0.3;
  const spacingMm = stoneSizeMm + gapMm;
  const layout = engine.generatePathLayout({ contours: [polygon], layerId: 'ellipse-64', xMm: 0, yMm: 0, widthMm: 20, heightMm: 20, stoneSizeMm, gapMm, mode: 'outline' });

  const { polygons, boundingBox } = engine.resolvePathPolygons({ contours: [polygon], layerId: 'ellipse-64', xMm: 0, yMm: 0, widthMm: 20, heightMm: 20 });
  const directPoints = sampleShapeFillPoints('outline', polygons, boundingBox, spacingMm, stoneSizeMm, true, null);

  assert.equal(layout.count, directPoints.length);
  for (let i = 0; i < directPoints.length; i++) {
    assert.equal(layout.stones[i].xMm, directPoints[i].xMm);
    assert.equal(layout.stones[i].yMm, directPoints[i].yMm);
  }
});

// --- 4. Fine tessellation ellipse: still no corners, proving the window doesn't accumulate curve turn

await test('4. fine (~0.1mm segment) tessellated ellipse: detectPolygonCornerFlags still returns null', () => {
  const radiusMm = 10;
  const circumferenceMm = 2 * Math.PI * radiusMm;
  const n = Math.round(circumferenceMm / 0.1);
  const polygon = ellipsePolygon(radiusMm, radiusMm, radiusMm, radiusMm, n);
  assert.equal(detectPolygonCornerFlags(polygon), null);
});

// --- 5. Rectangle with sub-noise-floor jitter: exactly the 4 true corners flagged ----------------

await test('5. 30x8mm rectangle with ~0.3mm segments and 0.1mm perpendicular jitter: only the 4 true corners are flagged', () => {
  const polygon = jitteredRectPolygon(0, 0, 30, 8, 0.3, 0.1);
  const flags = detectPolygonCornerFlags(polygon);
  assert.ok(flags, 'expected corner flags, not a null fallback');

  const flaggedIndices = flags.map((f, i) => (f ? i : null)).filter((i) => i !== null);
  const flaggedPoints = flaggedIndices.map((i) => polygon[i]);

  assert.equal(flaggedIndices.length, 4, `expected exactly 4 flagged corners, got indices ${flaggedIndices.join(', ')}`);
  for (const corner of [{ xMm: 0, yMm: 0 }, { xMm: 30, yMm: 0 }, { xMm: 30, yMm: 8 }, { xMm: 0, yMm: 8 }]) {
    assert.ok(flaggedPoints.some((p) => distanceMm(p, corner) < 1e-9), `expected the true corner (${corner.xMm}, ${corner.yMm}) among the flagged points`);
  }
});

// --- 6. Coarse zigzag scribble: null via the max-count/fraction safety valve ---------------------

await test('6. coarse 40-vertex zigzag scribble: detectPolygonCornerFlags returns null (max-count/fraction safety valve)', () => {
  const polygon = zigzagPolygon(40);
  assert.equal(detectPolygonCornerFlags(polygon), null);
});

// --- 7. Open polyline: flags null, output unchanged vs current (whole-loop) behavior -------------

await test('7. open polyline (closed:false): detectPolygonCornerFlags returns null, layout unchanged vs the pre-existing whole-loop walk', () => {
  const polygon = rectPolygon(0, 0, 30, 8); // sharp corners, but open -- endpoint anchoring is separate, deferred work
  assert.equal(detectPolygonCornerFlags(polygon, { closed: false }), null);

  const engine = new GeometryEngine();
  const stoneSizeMm = 2;
  const gapMm = 0.3;
  const spacingMm = stoneSizeMm + gapMm;
  const layout = engine.generatePathLayout({ contours: [polygon], layerId: 'open-1', xMm: 0, yMm: 0, widthMm: 30, heightMm: 8, stoneSizeMm, gapMm, mode: 'outline', closed: false });

  const { polygons, boundingBox } = engine.resolvePathPolygons({ contours: [polygon], layerId: 'open-1', xMm: 0, yMm: 0, widthMm: 30, heightMm: 8 });
  const directPoints = sampleShapeFillPoints('outline', polygons, boundingBox, spacingMm, stoneSizeMm, false, null);

  assert.equal(layout.count, directPoints.length);
  for (let i = 0; i < directPoints.length; i++) {
    assert.equal(layout.stones[i].xMm, directPoints[i].xMm);
    assert.equal(layout.stones[i].yMm, directPoints[i].yMm);
  }
});

// --- 8. Degenerate thin rectangle: no crash, every corner protected, sane finite output ----------

await test('8. degenerate 8x1mm rectangle with 2mm stones: no crash, all 4 corners protected, finite sane output', () => {
  const engine = new GeometryEngine();
  const contours = [rectPolygon(0, 0, 8, 1)];
  const stoneSizeMm = 2;
  const gapMm = 0.3;

  const layout = engine.generatePathLayout({ contours, layerId: 'sliver-1', xMm: 0, yMm: 0, widthMm: 8, heightMm: 1, stoneSizeMm, gapMm, mode: 'outline' });

  assert.ok(Number.isFinite(layout.count) && layout.count > 0);
  for (const stone of layout.stones) {
    assert.ok(Number.isFinite(stone.xMm) && Number.isFinite(stone.yMm));
  }
  // The 1mm short sides are themselves under the 2mm stone diameter, so the corner-anchoring
  // bugfix's proximity clustering merges each short side's two corners into one stone at their
  // midpoint (corner protection: merged, never dropped) -- checked here as "some stone within one
  // stone diameter of every original corner", not exact-position equality, since a merged stone
  // sits at the cluster centroid rather than on any single original corner.
  for (const corner of contours[0]) {
    assert.ok(closestDistanceMm(layout.stones, corner) < stoneSizeMm, `expected a protected (possibly merged) stone near corner (${corner.xMm}, ${corner.yMm})`);
  }
  // NOTE: one-sided attrition on the long (8mm) sides is EXPECTED here, not a failure -- the
  // dedup/proximity-protection pass around 4 corner-anchored, mutually close-together points on a
  // 1mm-tall sliver can legitimately consume non-corner side samples entirely (see the corner-
  // anchoring bugfix commit's own "extreme 40x2mm sliver produces a sane fully-covered result").
});
