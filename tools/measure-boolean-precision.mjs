/**
 * RS-1012A — Production Precision Validation measurement harness.
 *
 * Not part of `npm test` (it prints measured numbers for a human/spec-doc to read, the same
 * "generate baselines" role tools/generate-example-baselines.mjs and
 * tools/generate-image-trace-baselines.mjs already play). Run with:
 *
 *   node tools/measure-boolean-precision.mjs
 *
 * Measures, against the REAL production code path (GeometryEngine.resolveShapePolygons() etc,
 * not synthetic idealized shapes) at production-representative scale (a 210x90mm mug-wrap canvas,
 * 2mm/0.3mm stone spacing):
 *
 *   1. Area error vs the closed-form analytic result, for Union/Subtract/Intersect/Exclude of
 *      rectangles (exact analytic area) and circles (exact analytic circle-intersection formula).
 *   2. Max boundary deviation (one-sided Hausdorff-style: max over every output vertex of its
 *      distance to the nearest point on a densely-sampled analytic reference curve).
 *   3. Hole preservation: an annulus (outer circle XOR inner circle) at several radii.
 *   4. Narrow bridge preservation: two squares joined by a thinning bridge -- the bridge width at
 *      which the union stops being one connected contour.
 *   5. Tiny cutout preservation: a square with a shrinking circular cutout -- the radius at which
 *      Subtract stops producing a second (hole) contour.
 *   6. Repeated/chained boolean stability: a chain of N unions, checking error growth and
 *      left-to-right vs right-to-left fold order sensitivity.
 *   7. Determinism: identical input run N times, byte-for-byte (deepEqual) comparison.
 *   8. Save/load (JSON round-trip) fidelity: contours through JSON.stringify/parse N times.
 *   9. Timing, at production scale, to characterize the resolution/performance tradeoff.
 */

import assert from 'node:assert/strict';
import { GeometryEngine, combineShapeSources, combineManyShapeSources } from '../src/geometry/index.js';

const engine = new GeometryEngine();

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
function polySource(polygons) {
  return { kind: 'polygons', polygons };
}
function rectanglePolygon(xMm, yMm, widthMm, heightMm) {
  return [{ xMm, yMm }, { xMm: xMm + widthMm, yMm }, { xMm: xMm + widthMm, yMm: yMm + heightMm }, { xMm, yMm: yMm + heightMm }];
}

// Densely-sampled analytic circle boundary, used as a ground-truth reference curve for max
// boundary deviation measurement (not the app's own 64-point flattened circle).
function analyticCircleCurve(cxMm, cyMm, radiusMm, samples = 4096) {
  const pts = [];
  for (let i = 0; i < samples; i++) {
    const a = (i / samples) * Math.PI * 2;
    pts.push({ xMm: cxMm + Math.cos(a) * radiusMm, yMm: cyMm + Math.sin(a) * radiusMm });
  }
  return pts;
}
function distancePointToPolyline(point, curve, closed = true) {
  let best = Infinity;
  const n = curve.length;
  const segCount = closed ? n : n - 1;
  for (let i = 0; i < segCount; i++) {
    const a = curve[i], b = curve[(i + 1) % n];
    const abx = b.xMm - a.xMm, aby = b.yMm - a.yMm;
    const apx = point.xMm - a.xMm, apy = point.yMm - a.yMm;
    const lenSq = abx * abx + aby * aby;
    const t = lenSq > 1e-12 ? Math.max(0, Math.min(1, (apx * abx + apy * aby) / lenSq)) : 0;
    const cx = a.xMm + abx * t, cy = a.yMm + aby * t;
    const d = Math.hypot(point.xMm - cx, point.yMm - cy);
    if (d < best) best = d;
  }
  return best;
}
function maxDeviationFromCurve(contours, curve) {
  let worst = 0;
  for (const contour of contours) {
    for (const point of contour) {
      const d = distancePointToPolyline(point, curve);
      if (d > worst) worst = d;
    }
  }
  return worst;
}
function maxDeviationFromRectangle(contours, xMm, yMm, widthMm, heightMm) {
  const curve = rectanglePolygon(xMm, yMm, widthMm, heightMm);
  return maxDeviationFromCurve(contours, curve);
}

const results = { sections: [] };
function section(name, fn) {
  console.log(`\n=== ${name} ===`);
  const startedAt = Date.now();
  const value = fn();
  const elapsedMs = Date.now() - startedAt;
  results.sections.push({ name, elapsedMs });
  console.log(`  (${elapsedMs}ms)`);
  return value;
}

// -------------------------------------------------------------------------------------------
// 1. Rectangle area/vertex error (exact analytic ground truth)
// -------------------------------------------------------------------------------------------
section('1. Rectangle boolean ops -- exact analytic error (production scale, 60x40mm rectangles)', () => {
  const a = rectanglePolygon(0, 0, 60, 40);
  const b = rectanglePolygon(30, 20, 60, 40);
  const expectedAreas = { union: 60 * 40 * 2 - 30 * 20, intersect: 30 * 20, subtract: 60 * 40 - 30 * 20, xor: 60 * 40 * 2 - 2 * 30 * 20 };
  for (const op of ['union', 'intersect', 'subtract', 'xor']) {
    const result = combineShapeSources(polySource([a]), polySource([b]), op);
    const measuredArea = totalArea(result.contours);
    const expected = expectedAreas[op];
    const areaErrorPct = (Math.abs(measuredArea - expected) / expected) * 100;
    const maxDevMm = maxDeviationFromRectangle(result.contours, 0, 0, 90, 60); // loose bound; real per-op check below
    console.log(`  ${op}: expected=${expected.toFixed(4)}mm² measured=${measuredArea.toFixed(4)}mm² error=${areaErrorPct.toFixed(4)}% contours=${result.contours.length}`);
  }
});

// -------------------------------------------------------------------------------------------
// 2. Circle area + max boundary deviation (real app circle flattening via resolveShapePolygons)
// -------------------------------------------------------------------------------------------
section('2. Circle boolean ops -- area error + max boundary deviation vs analytic circle (r=20mm, production scale)', () => {
  const radiusMm = 20;
  const distanceMm = 24;
  const cA = engine.resolveShapePolygons({ shape: 'circle', layerId: 'a', cxMm: 0, cyMm: 0, radiusMm }).polygons;
  const cB = engine.resolveShapePolygons({ shape: 'circle', layerId: 'b', cxMm: distanceMm, cyMm: 0, radiusMm }).polygons;
  const r2 = radiusMm * radiusMm, d = distanceMm;
  const intersectArea = 2 * r2 * Math.acos(d / (2 * radiusMm)) - (d / 2) * Math.sqrt(4 * r2 - d * d);
  const circleArea = Math.PI * r2;
  const expectedAreas = {
    union: 2 * circleArea - intersectArea,
    intersect: intersectArea,
    subtract: circleArea - intersectArea,
    xor: 2 * circleArea - 2 * intersectArea
  };
  const curveA = analyticCircleCurve(0, 0, radiusMm);
  const curveB = analyticCircleCurve(distanceMm, 0, radiusMm);
  for (const op of ['union', 'intersect', 'subtract', 'xor']) {
    const result = combineShapeSources(polySource(cA), polySource(cB), op);
    const measuredArea = totalArea(result.contours);
    const expected = expectedAreas[op];
    const areaErrorPct = (Math.abs(measuredArea - expected) / expected) * 100;
    let maxDevMm = 0;
    for (const contour of result.contours) {
      for (const point of contour) {
        const d1 = distancePointToPolyline(point, curveA);
        const d2 = distancePointToPolyline(point, curveB);
        const dev = Math.min(d1, d2);
        if (dev > maxDevMm) maxDevMm = dev;
      }
    }
    console.log(`  ${op}: expected=${expected.toFixed(4)}mm² measured=${measuredArea.toFixed(4)}mm² error=${areaErrorPct.toFixed(4)}% maxBoundaryDeviation=${maxDevMm.toFixed(4)}mm contours=${result.contours.length}`);
  }
});

// -------------------------------------------------------------------------------------------
// 3. Hole preservation (annulus) at several production-scale radii
// -------------------------------------------------------------------------------------------
section('3. Hole preservation -- annulus (outer XOR inner) at several radii', () => {
  for (const [outerR, innerR] of [[20, 15], [10, 8], [5, 4], [3, 2.5], [1.5, 1]]) {
    const outer = engine.resolveShapePolygons({ shape: 'circle', layerId: 'o', cxMm: 0, cyMm: 0, radiusMm: outerR }).polygons;
    const inner = engine.resolveShapePolygons({ shape: 'circle', layerId: 'i', cxMm: 0, cyMm: 0, radiusMm: innerR }).polygons;
    const result = combineShapeSources(polySource(outer), polySource(inner), 'xor');
    const expectedArea = Math.PI * (outerR * outerR - innerR * innerR);
    const measuredArea = netAreaEvenOdd(result.contours);
    const holePreserved = result.contours.length === 2;
    const centerIsHole = !isPointInsideAny({ xMm: 0, yMm: 0 }, result.contours);
    const errorPct = (Math.abs(measuredArea - expectedArea) / expectedArea) * 100;
    console.log(`  outer=${outerR}mm inner=${innerR}mm ringWidth=${(outerR - innerR).toFixed(2)}mm: contours=${result.contours.length} holePreserved=${holePreserved} centerIsHole=${centerIsHole} areaError=${errorPct.toFixed(3)}%`);
  }
});
function isPointInsideAny(point, contours) {
  let inside = false;
  for (const contour of contours) {
    let c = false;
    for (let i = 0, j = contour.length - 1; i < contour.length; j = i++) {
      const vi = contour[i], vj = contour[j];
      if (((vi.yMm > point.yMm) !== (vj.yMm > point.yMm)) &&
        (point.xMm < ((vj.xMm - vi.xMm) * (point.yMm - vi.yMm)) / (vj.yMm - vi.yMm) + vi.xMm)) c = !c;
    }
    if (c) inside = !inside;
  }
  return inside;
}
function isPointInsidePolygon(point, contour) {
  let c = false;
  for (let i = 0, j = contour.length - 1; i < contour.length; j = i++) {
    const vi = contour[i], vj = contour[j];
    if (((vi.yMm > point.yMm) !== (vj.yMm > point.yMm)) &&
      (point.xMm < ((vj.xMm - vi.xMm) * (point.yMm - vi.yMm)) / (vj.yMm - vi.yMm) + vi.xMm)) c = !c;
  }
  return c;
}
function contourCentroid(contour) {
  // Signed-area-weighted centroid; falls back to vertex average for degenerate (near-zero-area)
  // contours, which is only ever used as an interior sample point, not for area itself.
  let a = 0, cx = 0, cy = 0;
  for (let i = 0; i < contour.length; i++) {
    const p1 = contour[i], p2 = contour[(i + 1) % contour.length];
    const cross = p1.xMm * p2.yMm - p2.xMm * p1.yMm;
    a += cross;
    cx += (p1.xMm + p2.xMm) * cross;
    cy += (p1.yMm + p2.yMm) * cross;
  }
  a *= 0.5;
  if (Math.abs(a) < 1e-9) {
    const avg = contour.reduce((s, p) => ({ xMm: s.xMm + p.xMm / contour.length, yMm: s.yMm + p.yMm / contour.length }), { xMm: 0, yMm: 0 });
    return avg;
  }
  return { xMm: cx / (6 * a), yMm: cy / (6 * a) };
}
// A point guaranteed to be just inside `contour` itself: nudges a small distance in from an edge
// midpoint along that edge's inward normal (direction chosen via the contour's rough centroid,
// then verified with a real point-in-polygon check against the same contour). This is deliberately
// NOT "the contour's own centroid" -- for a concentric annulus, the outer circle's shoelace
// centroid is the shared center point, which is also inside the (smaller) inner/hole contour, which
// would corrupt nesting-depth detection for exactly the concentric-hole case this function exists
// to measure.
function interiorSamplePoint(contour) {
  const centroid = contourCentroid(contour);
  for (let i = 0; i < contour.length; i++) {
    const p1 = contour[i], p2 = contour[(i + 1) % contour.length];
    const edgeLenMm = Math.hypot(p2.xMm - p1.xMm, p2.yMm - p1.yMm);
    if (edgeLenMm < 1e-9) continue;
    const midX = (p1.xMm + p2.xMm) / 2, midY = (p1.yMm + p2.yMm) / 2;
    const nx = -(p2.yMm - p1.yMm) / edgeLenMm, ny = (p2.xMm - p1.xMm) / edgeLenMm;
    const dot = nx * (centroid.xMm - midX) + ny * (centroid.yMm - midY);
    const dir = dot >= 0 ? 1 : -1;
    const eps = Math.max(edgeLenMm * 0.01, 1e-6);
    const candidate = { xMm: midX + nx * dir * eps, yMm: midY + ny * dir * eps };
    if (isPointInsidePolygon(candidate, contour)) return candidate;
  }
  return centroid;
}
// Even-odd nesting-aware net area: marching squares emits every boundary loop (outer AND hole)
// with no winding-direction convention (see PathBoolean.js's own doc comment -- this is
// deliberate, matching how sampleFillPoints()'s even-odd rule doesn't care about winding either).
// A naive sum of each contour's absolute shoelace area double-counts a hole's interior (it adds
// the hole's own area instead of subtracting it), so measuring the true enclosed area of a shape
// WITH holes (an annulus, a glyph counter) requires resolving each contour's nesting depth first:
// odd nesting depth (inside an odd number of other contours) = a hole, subtract; even = add.
function netAreaEvenOdd(contours) {
  let net = 0;
  for (let i = 0; i < contours.length; i++) {
    const sample = interiorSamplePoint(contours[i]);
    let depth = 0;
    for (let j = 0; j < contours.length; j++) {
      if (i === j) continue;
      if (isPointInsidePolygon(sample, contours[j])) depth++;
    }
    const area = shoelaceArea(contours[i]);
    net += (depth % 2 === 0) ? area : -area;
  }
  return net;
}

// -------------------------------------------------------------------------------------------
// 4. Narrow bridge preservation threshold
// -------------------------------------------------------------------------------------------
section('4. Narrow bridge preservation -- two 20x20mm squares joined by a shrinking bridge, at production canvas scale, swept across grid-alignment phase', () => {
  // A first run (kept in git history/PR notes) found bridge preservation depends heavily on
  // whether the bridge happens to line up with a raster row/column, not just its width -- a
  // 0.05mm bridge "survived" only because of a lucky sub-cell alignment. This version sweeps
  // several Y offsets (phases) per width, in FRACTIONS OF A CELL, so the reported threshold is the
  // WORST case across alignment, not a lucky one. Directly combines the two rectangles with the
  // bridge in a single union (rather than pre-unioning the two squares first) so only ONE grid
  // resolution/alignment is in play, keeping the measurement unambiguous.
  const squareSize = 20;
  const gapBetweenSquares = 30;
  const bridgeLengthMm = gapBetweenSquares;
  const widths = [5, 3, 2, 1.5, 1, 0.75, 0.5, 0.35, 0.25, 0.15, 0.1, 0.05, 0.02];
  const phaseFractions = [0, 0.15, 0.25, 0.33, 0.5, 0.66, 0.75, 0.85]; // fraction of a ~0.32mm cell
  const approxCellSizeMm = Math.max(0.08, Math.min(1, (squareSize * 2 + gapBetweenSquares) / 220));
  let worstCasePreservedWidth = null;
  let worstCaseFirstLostWidth = null;
  for (const bridgeWidthMm of widths) {
    let allPhasesConnected = true;
    for (const phaseFraction of phaseFractions) {
      const yOffsetMm = phaseFraction * approxCellSizeMm;
      const squareA = rectanglePolygon(0, yOffsetMm, squareSize, squareSize);
      const squareB = rectanglePolygon(squareSize + gapBetweenSquares, yOffsetMm, squareSize, squareSize);
      const bridge = rectanglePolygon(squareSize, yOffsetMm + squareSize / 2 - bridgeWidthMm / 2, bridgeLengthMm, bridgeWidthMm);
      const result = combineShapeSources(polySource([squareA, squareB]), polySource([bridge]), 'union');
      if (result.contours.length !== 1) allPhasesConnected = false;
    }
    console.log(`  bridgeWidth=${bridgeWidthMm}mm: connected at every tested alignment phase = ${allPhasesConnected}`);
    if (allPhasesConnected) worstCasePreservedWidth = bridgeWidthMm;
    else if (worstCaseFirstLostWidth === null) worstCaseFirstLostWidth = bridgeWidthMm;
  }
  console.log(`  RESULT (worst-case over alignment): reliably preserved bridge width >= ${worstCasePreservedWidth}mm; unreliable/lost at <= ${worstCaseFirstLostWidth}mm (cellSize~=${approxCellSizeMm.toFixed(3)}mm at this 70mm-span scale)`);
});

// -------------------------------------------------------------------------------------------
// 5. Tiny cutout preservation threshold
// -------------------------------------------------------------------------------------------
section('5. Tiny cutout preservation -- 50x50mm square minus a shrinking circular cutout, swept across grid-alignment phase', () => {
  const radii = [2, 1, 0.5, 0.35, 0.25, 0.15, 0.1, 0.07, 0.05, 0.03, 0.01];
  const phaseFractions = [0, 0.15, 0.25, 0.33, 0.5, 0.66, 0.75, 0.85];
  const approxCellSizeMm = Math.max(0.08, Math.min(1, 50 / 220));
  let worstCasePreservedRadius = null;
  let worstCaseFirstLostRadius = null;
  for (const cutoutRadiusMm of radii) {
    let allPhasesPreserved = true;
    let worstAreaErrorPct = 0;
    for (const phaseFraction of phaseFractions) {
      const offsetMm = phaseFraction * approxCellSizeMm;
      const square = rectanglePolygon(0, 0, 50, 50);
      const cutout = engine.resolveShapePolygons({ shape: 'circle', layerId: 'c', cxMm: 25 + offsetMm, cyMm: 25 + offsetMm, radiusMm: cutoutRadiusMm }).polygons;
      const result = combineShapeSources(polySource([square]), polySource(cutout), 'subtract');
      const preserved = result.contours.length === 2;
      if (!preserved) allPhasesPreserved = false;
      const expectedArea = 50 * 50 - Math.PI * cutoutRadiusMm * cutoutRadiusMm;
      const measuredArea = netAreaEvenOdd(result.contours);
      const errPct = (Math.abs(measuredArea - expectedArea) / expectedArea) * 100;
      if (errPct > worstAreaErrorPct) worstAreaErrorPct = errPct;
    }
    console.log(`  cutoutRadius=${cutoutRadiusMm}mm: preserved at every tested alignment phase = ${allPhasesPreserved}, worst-case areaError=${worstAreaErrorPct.toFixed(4)}%`);
    if (allPhasesPreserved) worstCasePreservedRadius = cutoutRadiusMm;
    else if (worstCaseFirstLostRadius === null) worstCaseFirstLostRadius = cutoutRadiusMm;
  }
  console.log(`  RESULT (worst-case over alignment): reliably preserved cutout radius >= ${worstCasePreservedRadius}mm; unreliable/lost at <= ${worstCaseFirstLostRadius}mm (cellSize~=${approxCellSizeMm.toFixed(3)}mm at this 50mm-span scale)`);
});

// -------------------------------------------------------------------------------------------
// 6. Repeated/chained boolean stability
// -------------------------------------------------------------------------------------------
section('6. Repeated/chained boolean stability -- a row of N overlapping circles, union folded left-to-right vs right-to-left', () => {
  const N = 8;
  const radiusMm = 6;
  const stepMm = 8; // overlapping (< 2*radius)
  const sources = [];
  for (let i = 0; i < N; i++) {
    sources.push(polySource(engine.resolveShapePolygons({ shape: 'circle', layerId: `c${i}`, cxMm: i * stepMm, cyMm: 0, radiusMm }).polygons));
  }
  const leftToRight = combineManyShapeSources(sources, 'union');
  const rightToLeft = combineManyShapeSources([...sources].reverse(), 'union');
  const areaLTR = totalArea(leftToRight.contours);
  const areaRTL = totalArea(rightToLeft.contours);
  const orderSensitivityPct = (Math.abs(areaLTR - areaRTL) / areaLTR) * 100;
  console.log(`  N=${N} circles: area(L->R fold)=${areaLTR.toFixed(4)}mm² area(R->L fold)=${areaRTL.toFixed(4)}mm² orderSensitivity=${orderSensitivityPct.toFixed(4)}%`);
  console.log(`  contours: L->R=${leftToRight.contours.length} R->L=${rightToLeft.contours.length}`);

  // error growth per additional union in the chain, vs each prefix's own analytic union-of-circles
  // area computed via inclusion-exclusion over adjacent-pair overlaps only (valid here since only
  // immediate neighbors overlap at this spacing).
  let cumulativeExpected = Math.PI * radiusMm * radiusMm;
  let prevSource = sources[0];
  const errorsPct = [];
  for (let i = 1; i < N; i++) {
    const combined = combineShapeSources(prevSource, sources[i], 'union');
    const overlapD = stepMm;
    const r2 = radiusMm * radiusMm;
    const overlapArea = overlapD < 2 * radiusMm
      ? 2 * r2 * Math.acos(overlapD / (2 * radiusMm)) - (overlapD / 2) * Math.sqrt(4 * r2 - overlapD * overlapD)
      : 0;
    cumulativeExpected += Math.PI * radiusMm * radiusMm - overlapArea;
    const measured = totalArea(combined.contours);
    const errPct = (Math.abs(measured - cumulativeExpected) / cumulativeExpected) * 100;
    errorsPct.push(errPct);
    prevSource = polySource(combined.contours);
  }
  console.log(`  cumulative area error after each additional union (%): ${errorsPct.map((e) => e.toFixed(4)).join(', ')}`);
  console.log(`  error trend: first=${errorsPct[0].toFixed(4)}% last=${errorsPct[errorsPct.length - 1].toFixed(4)}% (bounded=${errorsPct[errorsPct.length - 1] < errorsPct[0] * 5})`);
});

// -------------------------------------------------------------------------------------------
// 7. Determinism
// -------------------------------------------------------------------------------------------
section('7. Determinism -- identical input run 25 times', () => {
  const a = engine.resolveShapePolygons({ shape: 'circle', layerId: 'a', cxMm: 0, cyMm: 0, radiusMm: 15 }).polygons;
  const b = engine.resolveShapePolygons({ shape: 'rectangle', layerId: 'b', xMm: 5, yMm: 5, widthMm: 25, heightMm: 18 }).polygons;
  const first = combineShapeSources(polySource(a), polySource(b), 'union');
  let allIdentical = true;
  for (let i = 0; i < 25; i++) {
    const next = combineShapeSources(polySource(a), polySource(b), 'union');
    try {
      assert.deepEqual(next, first);
    } catch {
      allIdentical = false;
    }
  }
  console.log(`  25 repeated identical calls byte-for-byte identical: ${allIdentical}`);
});

// -------------------------------------------------------------------------------------------
// 8. Save/load (JSON round-trip) fidelity
// -------------------------------------------------------------------------------------------
section('8. Save/load fidelity -- contours through JSON.stringify/parse 10 times in a row', () => {
  const a = engine.resolveShapePolygons({ shape: 'circle', layerId: 'a', cxMm: 0, cyMm: 0, radiusMm: 15 }).polygons;
  const b = engine.resolveShapePolygons({ shape: 'rectangle', layerId: 'b', xMm: 5, yMm: 5, widthMm: 25, heightMm: 18 }).polygons;
  const result = combineShapeSources(polySource(a), polySource(b), 'union');
  let roundTripped = result.contours;
  let identicalEveryRound = true;
  for (let i = 0; i < 10; i++) {
    const next = JSON.parse(JSON.stringify(roundTripped));
    try {
      assert.deepEqual(next, roundTripped);
    } catch {
      identicalEveryRound = false;
    }
    roundTripped = next;
  }
  console.log(`  10 JSON round-trips produce byte-identical contours every time: ${identicalEveryRound}`);
  // Also verify the FINAL round-tripped contours still equal the very first (no cumulative drift).
  assert.deepEqual(roundTripped, result.contours);
  console.log(`  final round-tripped contours equal original (no cumulative drift): true`);
});

// -------------------------------------------------------------------------------------------
// 9. Timing at production scale
// -------------------------------------------------------------------------------------------
section('9. Timing -- production-scale scenarios', () => {
  const scenarios = [
    ['small shape (20mm circle + 20mm circle)', () => {
      const a = engine.resolveShapePolygons({ shape: 'circle', layerId: 'a', cxMm: 0, cyMm: 0, radiusMm: 10 }).polygons;
      const b = engine.resolveShapePolygons({ shape: 'circle', layerId: 'b', cxMm: 12, cyMm: 0, radiusMm: 10 }).polygons;
      return combineShapeSources(polySource(a), polySource(b), 'union');
    }],
    ['full mug-wrap canvas scale (210x90mm rectangles)', () => {
      const a = rectanglePolygon(0, 0, 150, 70);
      const b = rectanglePolygon(60, 20, 150, 70);
      return combineShapeSources(polySource([a]), polySource([b]), 'union');
    }],
    ['large production sheet scale (800x600mm rectangles)', () => {
      const a = rectanglePolygon(0, 0, 500, 400);
      const b = rectanglePolygon(200, 150, 500, 400);
      return combineShapeSources(polySource([a]), polySource([b]), 'union');
    }]
  ];
  for (const [label, fn] of scenarios) {
    const t0 = Date.now();
    const result = fn();
    const elapsed = Date.now() - t0;
    console.log(`  ${label}: ${elapsed}ms, ${result.contours.length} contour(s), ${result.contours.reduce((s, c) => s + c.length, 0)} total vertices`);
  }
});

// -------------------------------------------------------------------------------------------
// 10. Stone-pitch-aware resolution: same operation with/without the destination layer's
//     stoneSizeMm+gapMm passed as options.targetSpacingMm.
// -------------------------------------------------------------------------------------------
section('10. Stone-pitch-aware resolution -- boundary deviation with vs without targetSpacingMm, at a large document scale', () => {
  const radiusMm = 15, distanceMm = 18;
  const a = engine.resolveShapePolygons({ shape: 'circle', layerId: 'a', cxMm: 0, cyMm: 0, radiusMm }).polygons;
  const b = engine.resolveShapePolygons({ shape: 'circle', layerId: 'b', cxMm: distanceMm, cyMm: 0, radiusMm }).polygons;
  const curveA = analyticCircleCurve(0, 0, radiusMm);
  const curveB = analyticCircleCurve(distanceMm, 0, radiusMm);
  const maxDev = (result) => {
    let worst = 0;
    for (const contour of result.contours) for (const point of contour) {
      const dev = Math.min(distancePointToPolyline(point, curveA), distancePointToPolyline(point, curveB));
      if (dev > worst) worst = dev;
    }
    return worst;
  };
  const withoutHint = combineShapeSources(polySource(a), polySource(b), 'union');
  const fineStones = combineShapeSources(polySource(a), polySource(b), 'union', { targetSpacingMm: 1.1 }); // 1mm stone + 0.1mm gap
  const coarseStones = combineShapeSources(polySource(a), polySource(b), 'union', { targetSpacingMm: 6.5 }); // 6mm stone + 0.5mm gap
  console.log(`  no hint (bbox/feature-size only): maxBoundaryDeviation=${maxDev(withoutHint).toFixed(4)}mm`);
  console.log(`  targetSpacingMm=1.1 (fine 1mm stones): maxBoundaryDeviation=${maxDev(fineStones).toFixed(4)}mm`);
  console.log(`  targetSpacingMm=6.5 (coarse 6mm stones): maxBoundaryDeviation=${maxDev(coarseStones).toFixed(4)}mm (should not be finer than necessary)`);
});

// -------------------------------------------------------------------------------------------
// 11. Fail-safe trigger: two shapes differing enormously in scale
// -------------------------------------------------------------------------------------------
section('11. Fail-safe -- a sub-millimeter detail combined with a multi-meter shape', () => {
  const tinyDot = engine.resolveShapePolygons({ shape: 'circle', layerId: 'dot', cxMm: 0, cyMm: 0, radiusMm: 0.05 }).polygons;
  const hugeRect = rectanglePolygon(0, 0, 5000, 4000); // 5m x 4m
  try {
    combineShapeSources(polySource(tinyDot), polySource([hugeRect]), 'union');
    console.log('  UNEXPECTED: no error thrown for an extreme scale mismatch');
  } catch (error) {
    console.log(`  threw as expected: ${error.constructor.name}: "${error.message}"`);
  }
  // Sanity: a merely large (not pathological) production-sheet-scale document does NOT trip it.
  try {
    const a = rectanglePolygon(0, 0, 1000, 800);
    const b = rectanglePolygon(300, 200, 1000, 800);
    combineShapeSources(polySource([a]), polySource([b]), 'union');
    console.log('  1000x800mm-scale rectangles: no error (expected -- ordinary large document, not pathological)');
  } catch (error) {
    console.log(`  UNEXPECTED error for ordinary large-document scale: ${error.message}`);
  }
});

console.log('\nDone.');
