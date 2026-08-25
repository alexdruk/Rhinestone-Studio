import assert from 'node:assert/strict';
import { GeometryEngine, sampleShapeFillPoints, detectPolygonCornerFlags, groupCongruentContours } from '../src/geometry/index.js';
import { Point2D } from '../src/text/VectorPath.js';

// RS-congruent-outline: an imported SVG containing many near-identical small polygons (e.g. a ring
// of ~5mm octagons) got visibly inconsistent Outline-mode stone placement per polygon -- counts
// varying 4-6 and positions shifting -- from two mechanisms:
//   (A) corner-anchored sampling applied to a contour whose sides are shorter than minSeparationMm,
//       so clusterCornersByProximity() (StoneSampler.js) chains corners into an unstable,
//       float-sensitive centroid resolution -- see GeometryEngine.js's generatePathLayout()
//       tiny-contour guard.
//   (B) each contour sampled independently from its own first vertex, with per-contour
//       round(perimeter/spacing) -- sub-mm flattening differences between congruent contours flip
//       counts and phase -- see CongruentContours.js's groupCongruentContours() and its integration
//       into StoneSampler.js's sampleMultiContourOutlinePoints().

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

function octagonPolygon(cxMm, cyMm, radiusMm, rotationDeg = 0, mirror = false) {
  const points = [];
  const rotationRad = (rotationDeg * Math.PI) / 180;
  for (let i = 0; i < 8; i++) {
    const angle = (i / 8) * Math.PI * 2 + rotationRad;
    let xMm = radiusMm * Math.cos(angle);
    let yMm = radiusMm * Math.sin(angle);
    if (mirror) xMm = -xMm;
    points.push(new Point2D(cxMm + xMm, cyMm + yMm));
  }
  return points;
}

function distanceMm(a, b) {
  return Math.hypot(a.xMm - b.xMm, a.yMm - b.yMm);
}

// --- 1. Signature matching: translated/rotated/mirrored copies match, a different polygon does not

await test('1. groupCongruentContours: translated, rotated, and mirrored octagons all group together; a differently-sized octagon does not', () => {
  const base = octagonPolygon(0, 0, 5);
  const translated = octagonPolygon(120, 45, 5);
  const rotated = octagonPolygon(-60, 80, 5, 17);
  const mirrored = octagonPolygon(30, -90, 5, 53, true);
  const different = octagonPolygon(200, 200, 5.5); // same corner count, different edge length -> not congruent

  const polygons = [base, translated, rotated, mirrored, different];
  const groups = groupCongruentContours(polygons, { closed: true });

  const groupOf = (index) => groups.find((g) => g.indices.includes(index));

  const congruentGroup = groupOf(0);
  assert.deepEqual([...congruentGroup.indices].sort((a, b) => a - b), [0, 1, 2, 3],
    'base, translated, rotated, and mirrored octagons must all land in one congruent group');
  assert.equal(congruentGroup.indices.length, 4);
  assert.ok(congruentGroup.transforms[1] && congruentGroup.transforms[2] && congruentGroup.transforms[3],
    'every non-representative member must carry a recovered transform');

  const differentGroup = groupOf(4);
  assert.equal(differentGroup.indices.length, 1, 'a differently-scaled octagon must not join the congruent group');
});

// --- 2. End-to-end: 6 congruent octagons at various rotations/positions all get identical stone
//        counts, and every octagon's stones map back through the inverse transform onto the
//        representative's own stones within 1e-6mm.

await test('2. sampleShapeFillPoints: 6 congruent octagons (various rotations/positions) get identical stone counts and transform-consistent positions', () => {
  const stoneSizeMm = 2;
  const gapMm = 0.5;
  const spacingMm = stoneSizeMm + gapMm;
  const radiusMm = 5;

  // Placed far apart (well beyond any cross-contour dedupe/backfill interaction) so each octagon's
  // own sampling is fully independent of the others' positions.
  const centers = [
    { cxMm: 0, cyMm: 0, rotationDeg: 0, mirror: false },
    { cxMm: 200, cyMm: 0, rotationDeg: 13, mirror: false },
    { cxMm: 0, cyMm: 200, rotationDeg: 47, mirror: false },
    { cxMm: 200, cyMm: 200, rotationDeg: 90, mirror: false },
    { cxMm: 400, cyMm: 0, rotationDeg: 25, mirror: true },
    { cxMm: 400, cyMm: 200, rotationDeg: 71, mirror: true }
  ];
  const polygons = centers.map((c) => octagonPolygon(c.cxMm, c.cyMm, radiusMm, c.rotationDeg, c.mirror));

  const points = sampleShapeFillPoints('outline', polygons, null, spacingMm, stoneSizeMm, true, null);

  // Every stone must belong to exactly one octagon (well-separated, so nearest-centroid assignment
  // is unambiguous) -- tally real output membership instead of assuming a slice layout.
  const buckets = centers.map(() => []);
  for (const point of points) {
    let bestIndex = 0;
    let bestDistMm = Infinity;
    for (let i = 0; i < centers.length; i++) {
      const d = Math.hypot(point.xMm - centers[i].cxMm, point.yMm - centers[i].cyMm);
      if (d < bestDistMm) { bestDistMm = d; bestIndex = i; }
    }
    assert.ok(bestDistMm < radiusMm + spacingMm, 'every sampled point must land near exactly one octagon');
    buckets[bestIndex].push(point);
  }

  const counts = buckets.map((b) => b.length);
  assert.ok(counts[0] > 0, 'sanity: the representative octagon must produce at least one stone');
  for (let i = 1; i < counts.length; i++) {
    assert.equal(counts[i], counts[0], `octagon ${i} got ${counts[i]} stones, expected ${counts[0]} (same as octagon 0)`);
  }

  // Recompute the same grouping/transforms independently to verify every sibling's stones map back
  // onto the representative's own stones through the inverse rigid transform.
  const groups = groupCongruentContours(polygons, { closed: true });
  assert.equal(groups.length, 1, 'all 6 octagons must be recognized as one congruent group');
  const group = groups[0];
  const repIndex = group.representativeIndex;
  const repStones = buckets[repIndex];

  for (const memberIndex of group.indices) {
    if (memberIndex === repIndex) continue;
    const transform = group.transforms[memberIndex];
    const memberStones = buckets[memberIndex];
    assert.equal(memberStones.length, repStones.length);

    // Invert the orthogonal affine map: q = L*p + t  =>  p = L^T * (q - t).
    for (let i = 0; i < repStones.length; i++) {
      const q = memberStones[i];
      const qxMm = q.xMm - transform.tx;
      const qyMm = q.yMm - transform.ty;
      const invertedXMm = transform.a * qxMm + transform.c * qyMm;
      const invertedYMm = transform.b * qxMm + transform.d * qyMm;
      const d = distanceMm({ xMm: invertedXMm, yMm: invertedYMm }, repStones[i]);
      assert.ok(d < 1e-6, `octagon ${memberIndex} stone ${i} maps back to (${invertedXMm}, ${invertedYMm}), expected within 1e-6mm of representative's (${repStones[i].xMm}, ${repStones[i].yMm}), got ${d}mm`);
    }
  }
});

// --- 3. Part A guard: a tiny-sided corner-anchored polygon falls back to the uniform walk, byte-
//        identical to explicitly passing cornerFlagsByContour null.

await test('3. generatePathLayout tiny-contour guard: an 8-corner polygon whose sides are shorter than spacing samples byte-identical to the uniform (cornerFlagsByContour=null) walk', () => {
  const stoneSizeMm = 3;
  const gapMm = 0.5;
  const spacingMm = stoneSizeMm + gapMm; // 3.5mm

  // A regular octagon small enough that perimeter/8 (~1.5mm/side) is well under spacingMm -- its 8
  // corners cannot geometrically coexist as separate stones at this pitch.
  const radiusMm = 2;
  const octagon = octagonPolygon(radiusMm, radiusMm, radiusMm); // shifted so its own bbox top-left sits at (0,0)

  const flags = detectPolygonCornerFlags(octagon, { closed: true });
  assert.ok(flags, 'expected genuine corner flags for a regular octagon (not a null fallback)');
  const n = flags.filter(Boolean).length;
  assert.equal(n, 8);
  let perimeterMm = 0;
  for (let i = 0; i < octagon.length; i++) {
    const a = octagon[i];
    const b = octagon[(i + 1) % octagon.length];
    perimeterMm += Math.hypot(b.xMm - a.xMm, b.yMm - a.yMm);
  }
  assert.ok(perimeterMm / n < spacingMm, `sanity check: this octagon's perimeter/corner (${perimeterMm / n}mm) must be under spacingMm (${spacingMm}mm)`);

  const engine = new GeometryEngine();
  const layout = engine.generatePathLayout({
    contours: [octagon], layerId: 'tiny-octagon-1', xMm: 0, yMm: 0,
    widthMm: radiusMm * 2, heightMm: radiusMm * 2, stoneSizeMm, gapMm, mode: 'outline'
  });

  const { polygons } = engine.resolvePathPolygons({
    contours: [octagon], layerId: 'tiny-octagon-1', xMm: 0, yMm: 0, widthMm: radiusMm * 2, heightMm: radiusMm * 2
  });
  const uniformPoints = sampleShapeFillPoints('outline', polygons, null, spacingMm, stoneSizeMm, true, null);

  assert.equal(layout.count, uniformPoints.length);
  for (let i = 0; i < uniformPoints.length; i++) {
    assert.equal(layout.stones[i].xMm, uniformPoints[i].xMm);
    assert.equal(layout.stones[i].yMm, uniformPoints[i].yMm);
  }
});
