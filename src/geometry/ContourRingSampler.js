/**
 * Inward contour-ring geometry for Contour Fill — RS-1011.
 *
 * "Repeated inward contours" (concentric rings tracing a shape's interior, moving inward by one
 * stone pitch at a time) requires eroding a shape by a fixed distance, repeatedly. No analytic
 * polygon-offset algorithm (Minkowski/straight-skeleton) existed anywhere in this repository, and
 * one does not generalize cleanly to arbitrary multi-contour shapes with holes (glyph counters,
 * nested SVG paths) any more than analytic boolean clipping did for RS-1012 — see
 * src/geometry/PathBoolean.js's own "Why raster-assisted boolean ops" rationale, which this module
 * deliberately mirrors:
 *
 *   1. Build a distance-to-boundary field over a grid covering the shape's bounding box, using
 *      whatever "is this point inside the shape" test the caller supplies (isPointInsidePolygons()
 *      for a vector shape, a field-threshold lookup for an Image Trace layer) -- the same interior
 *      test every other fill mode in StoneSampler.js already uses. A cell outside the shape seeds
 *      distance 0; this treats a hole's interior as "outside" for free, so Contour Fill preserves
 *      holes with no hole-specific code, exactly like Grid Fill's even-odd rule already does.
 *   2. Run a standard two-pass chamfer (1, sqrt(2)) approximate-Euclidean distance transform over
 *      that grid.
 *   3. Each ring is the distance field's "value >= threshold" iso-contour, traced with the same
 *      16-case marching-squares table src/geometry/PathBoolean.js uses for its own boundary tracing
 *      -- a well-understood, standard algorithm, implemented independently here (not imported from
 *      PathBoolean.js) so this module never risks PathBoolean.js's RS-1012A precision-tuned
 *      behavior; the two modules' saddle-case resolutions are legitimately different (this one
 *      bilinear-interpolates the four corner distance values, appropriate for a smooth scalar
 *      field; PathBoolean.js re-samples its actual two-source combine function, which has no
 *      equivalent here since there is only one field, not two sources to re-sample).
 *
 * This module has no dependency on the DOM, Canvas, WebGL, or any renderer/exporter, matching every
 * other module in src/geometry/**.
 *
 * READ-001 -- sub-cell-accurate ring placement. Two systematic inward biases were measured (see
 * docs/specifications/READ-001-ContourCentreline.md) and corrected here:
 *
 *   - Crossing placement. traceIsoDistanceContour() previously placed every marching-squares
 *     crossing at the cell-edge *midpoint*. It now linearly interpolates the crossing from the
 *     distance values at the edge's two nodes -- the standard sub-cell marching-squares refinement.
 *     Two cells sharing an edge interpolate from the identical node pair, so the exact-key segment
 *     stitching in stitchSegmentsIntoLoops() is unaffected.
 *
 *   - Seeding bias. chamferDistanceTransform() seeds every *outside* node at distance 0, so an
 *     inside node one step in from the boundary would relax to a full cellSizeMm when the true
 *     boundary lies somewhere in (0, cellSizeMm) from it. A flat `cellSizeMm / 2` seed removes only
 *     the *average* of that bias -- it still translates the whole ring by up to half a cell whenever
 *     insideAt classifies the two boundary nodes asymmetrically (an axis-aligned edge landing on a
 *     grid line: the node on it reads inside, the node one cell out reads outside, so that side of
 *     the shape reads ~half a cell narrow). Each boundary-adjacent inside node is instead seeded
 *     with its *measured* sub-cell distance -- insideAt bisected along the axis to each outside
 *     neighbour, smallest crossing wins (see chamferDistanceTransform()). The field then carries a
 *     genuine true-distance estimate and computeInwardRingPolygons() traces at the nominal
 *     threshold.
 */

// Matches src/geometry/PathBoolean.js's MIN/MAX_CELL_SIZE_MM clamping shape (same order of
// magnitude, same rationale: neither a tiny stone pitch nor a huge simple shape should be able to
// allocate a pathological grid), scoped to this module's own distance-field grid.
const MIN_CELL_SIZE_MM = 0.05;
const MAX_CELL_SIZE_MM = 1;
const CELL_SPACING_DIVISOR = 8;

// Hard ceiling on total grid cells (cols*rows), mirroring PathBoolean.js's MAX_GRID_CELLS_BUDGET
// fail-safe: a shape/spacing combination that would need more cells than this throws a specific,
// actionable error instead of freezing the tab. Contour Fill's grid is one shape's bounding box
// only (never two shapes combined), so a slightly smaller budget than PathBoolean.js's is still
// generous for any production-scale design.
const MAX_GRID_CELLS_BUDGET = 4_000_000;

// Absolute cap on traced rings, independent of the distance field's own (already-monotonic) natural
// stopping point -- defense in depth against an unexpected non-monotonic edge case, not something
// any real shape is expected to hit (see docs/specifications/RS-1011-FillAlgorithms.md, "Precision
// and Fail-Safes").
const MAX_RING_COUNT = 1000;

export class ContourFillPrecisionError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ContourFillPrecisionError';
  }
}

function computeCellSizeMm(spanMm, spacingMm) {
  const idealCellSizeMm = Math.min(spacingMm / CELL_SPACING_DIVISOR, MAX_CELL_SIZE_MM);
  const cellSizeMm = Math.max(idealCellSizeMm, MIN_CELL_SIZE_MM);

  const cellsAcrossSpan = spanMm / cellSizeMm + 2;
  if (cellsAcrossSpan * cellsAcrossSpan > MAX_GRID_CELLS_BUDGET) {
    throw new ContourFillPrecisionError(
      'Contour Fill cannot be computed at a safe, well-defined precision for this shape and stone ' +
      'pitch (the shape is very large relative to the stone size/gap). Try a larger stone size or ' +
      'gap, or a smaller shape.'
    );
  }

  return cellSizeMm;
}

/**
 * Build the inside/outside grid and its chamfer distance-to-outside field, once, for reuse across
 * every ring threshold.
 *
 * @param {(xMm:number, yMm:number)=>boolean} insideAt
 * @param {{minXmm:number,minYmm:number,maxXmm:number,maxYmm:number}} boundingBox
 * @param {number} spacingMm
 * @returns {{distanceGrid: Float64Array, cols: number, rows: number, minXmm: number, minYmm: number, cellSizeMm: number, maxDistanceMm: number}|null}
 */
function buildDistanceField(insideAt, boundingBox, spacingMm) {
  const spanMm = Math.max(boundingBox.maxXmm - boundingBox.minXmm, boundingBox.maxYmm - boundingBox.minYmm, 1e-6);
  const cellSizeMm = computeCellSizeMm(spanMm, spacingMm);

  // Pad by one cell on every side, matching PathBoolean.js's own padding, so a shape flush against
  // its raw bounding box still has a ring of "outside" cells to erode inward from.
  const minXmm = boundingBox.minXmm - cellSizeMm;
  const minYmm = boundingBox.minYmm - cellSizeMm;
  const maxXmm = boundingBox.maxXmm + cellSizeMm;
  const maxYmm = boundingBox.maxYmm + cellSizeMm;

  const cols = Math.max(2, Math.round((maxXmm - minXmm) / cellSizeMm) + 1);
  const rows = Math.max(2, Math.round((maxYmm - minYmm) / cellSizeMm) + 1);

  const insideGrid = new Uint8Array(cols * rows);
  for (let j = 0; j < rows; j++) {
    const yMm = minYmm + j * cellSizeMm;
    for (let i = 0; i < cols; i++) {
      const xMm = minXmm + i * cellSizeMm;
      insideGrid[j * cols + i] = insideAt(xMm, yMm) ? 1 : 0;
    }
  }

  const distanceGrid = chamferDistanceTransform(insideGrid, cols, rows, cellSizeMm, insideAt, minXmm, minYmm);

  let maxDistanceMm = 0;
  for (let i = 0; i < distanceGrid.length; i++) {
    if (distanceGrid[i] > maxDistanceMm) maxDistanceMm = distanceGrid[i];
  }

  return { distanceGrid, cols, rows, minXmm, minYmm, cellSizeMm, maxDistanceMm };
}

// Standard two-pass chamfer distance transform: orthogonal-neighbor step costs cellSizeMm,
// diagonal-neighbor step costs cellSizeMm*sqrt(2), a well-known approximate-Euclidean distance
// transform (bounded error, no exact per-pixel sqrt needed). Cells outside the shape start at
// distance 0 (they are the boundary reference); every inside cell's distance is its shortest
// chamfer path to the nearest outside cell.
//
// READ-001 seeding-bias correction: an inside node with an orthogonally-adjacent outside node is
// seeded with its *measured* sub-cell distance to the boundary, not left to relax to a full
// `cellSizeMm` from the outside node's 0. A flat `cellSizeMm / 2` seed (the first cut of this fix)
// only removes the *average* of the bias; it still translates the whole ring by up to half a cell
// whenever `insideAt` classifies the two boundary nodes asymmetrically (e.g. an axis-aligned edge
// landing exactly on a grid line -- the node on it reads inside, the node one cell out reads
// outside, so the field treats the shape as ~half a cell narrower on that side). Instead, for each
// boundary-adjacent inside node we bisect `insideAt` along the axis to each outside neighbour
// (4 iterations -> `cellSizeMm / 16` resolution) and seed the node at the smallest crossing
// distance found. Only the first step off the boundary is measured this way; every deeper node
// inherits it through the ordinary chamfer relaxation. The field then carries a genuine
// true-distance estimate, so computeInwardRingPolygons() traces at the nominal threshold.
function chamferDistanceTransform(insideGrid, cols, rows, cellSizeMm, insideAt, minXmm, minYmm) {
  const dist = new Float64Array(insideGrid.length);
  const outsideAt = (i, j) => (i < 0 || j < 0 || i >= cols || j >= rows) ? true : !insideGrid[j * cols + i];

  const BOUNDARY_BISECTION_ITERS = 4; // -> cellSizeMm / 16 localisation resolution
  const NEIGHBOUR_DIRS = [[-1, 0], [1, 0], [0, -1], [0, 1]];
  const localiseBoundaryMm = (i, j) => {
    const xMm = minXmm + i * cellSizeMm;
    const yMm = minYmm + j * cellSizeMm;
    let bestMm = Infinity;
    for (const [di, dj] of NEIGHBOUR_DIRS) {
      if (!outsideAt(i + di, j + dj)) continue;
      let loMm = 0;            // xMm/yMm itself -- known inside
      let hiMm = cellSizeMm;   // the outside neighbour -- known outside
      for (let it = 0; it < BOUNDARY_BISECTION_ITERS; it++) {
        const midMm = (loMm + hiMm) / 2;
        const t = midMm / cellSizeMm;
        if (insideAt(xMm + di * t * cellSizeMm, yMm + dj * t * cellSizeMm)) loMm = midMm;
        else hiMm = midMm;
      }
      const crossingMm = (loMm + hiMm) / 2;
      if (crossingMm < bestMm) bestMm = crossingMm;
    }
    return bestMm;
  };

  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const idx = j * cols + i;
      if (!insideGrid[idx]) {
        dist[idx] = 0;
      } else {
        const boundaryMm = localiseBoundaryMm(i, j);
        dist[idx] = boundaryMm === Infinity ? Number.POSITIVE_INFINITY : boundaryMm;
      }
    }
  }

  const at = (i, j) => (i < 0 || j < 0 || i >= cols || j >= rows) ? 0 : dist[j * cols + i];
  const ORTHOGONAL_MM = cellSizeMm;
  const DIAGONAL_MM = cellSizeMm * Math.SQRT2;

  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const idx = j * cols + i;
      if (!insideGrid[idx]) continue;
      dist[idx] = Math.min(
        dist[idx],
        at(i - 1, j) + ORTHOGONAL_MM,
        at(i, j - 1) + ORTHOGONAL_MM,
        at(i - 1, j - 1) + DIAGONAL_MM,
        at(i + 1, j - 1) + DIAGONAL_MM
      );
    }
  }

  for (let j = rows - 1; j >= 0; j--) {
    for (let i = cols - 1; i >= 0; i--) {
      const idx = j * cols + i;
      if (!insideGrid[idx]) continue;
      dist[idx] = Math.min(
        dist[idx],
        at(i + 1, j) + ORTHOGONAL_MM,
        at(i, j + 1) + ORTHOGONAL_MM,
        at(i + 1, j + 1) + DIAGONAL_MM,
        at(i - 1, j + 1) + DIAGONAL_MM
      );
    }
  }

  return dist;
}

// READ-001: is this loop a long thin sliver (an elongated shape's collapsed medial band -- keep it)
// rather than a small round blob (a disc/square's degenerate centre -- drop it, no spurious centre
// stone)? Isoperimetric ratio: 4*pi for a circle, 16 for a square, grows without bound as a shape
// stretches. The cutoff sits well above any round shape and well below a stroke's ~40:1 band.
export const ELONGATION_MIN_ISOPERIMETRIC = 25;
export function loopIsElongated(loop) {
  let signedArea2 = 0;
  let perimeterMm = 0;
  for (let i = 0; i < loop.length; i++) {
    const a = loop[i];
    const b = loop[(i + 1) % loop.length];
    signedArea2 += a.xMm * b.yMm - b.xMm * a.yMm;
    perimeterMm += Math.hypot(b.xMm - a.xMm, b.yMm - a.yMm);
  }
  const areaMm2 = Math.abs(signedArea2) / 2;
  if (areaMm2 < 1e-9) return true; // zero-area (a true line) is maximally elongated
  return (perimeterMm * perimeterMm) / areaMm2 > ELONGATION_MIN_ISOPERIMETRIC;
}

// Bilinear value at a grid cell's center, from its four corners -- used only to resolve marching
// squares' ambiguous "saddle" cases (see traceIsoDistanceContour() below).
function cellCenterValue(distanceGrid, cols, i, j) {
  const a = distanceGrid[j * cols + i];
  const b = distanceGrid[j * cols + i + 1];
  const c = distanceGrid[(j + 1) * cols + i + 1];
  const d = distanceGrid[(j + 1) * cols + i];
  return (a + b + c + d) / 4;
}

function pointKey(xMm, yMm, precisionMm) {
  return `${Math.round(xMm / precisionMm)}:${Math.round(yMm / precisionMm)}`;
}

// Traces every closed loop where distanceGrid >= thresholdMm, via the standard 16-case
// marching-squares segment table (same case shape as src/geometry/PathBoolean.js's
// traceMarchingSquares(), independently implemented -- see this file's module comment for why).
//
// READ-001: each of the four cell-edge crossings (T/R/B/L) is linearly interpolated from the
// distance values at that edge's two nodes -- `frac = (thresholdMm - v1) / (v2 - v1)`, clamped to
// [0, 1], with a 0.5 fallback when the two node values are near-equal -- rather than fixed at the
// edge midpoint. The saddle resolution in cases 5 and 10 is unchanged (still the bilinear
// cell-centre value).
function traceIsoDistanceContour(distanceGrid, cols, rows, minXmm, minYmm, cellSizeMm, thresholdMm) {
  const val = (i, j) => distanceGrid[j * cols + i];
  const bin = (i, j) => val(i, j) >= thresholdMm ? 1 : 0;
  const segments = [];

  // Interpolation fraction of the crossing along an edge from node value v1 to node value v2.
  const crossFrac = (v1, v2) => {
    const denom = v2 - v1;
    if (Math.abs(denom) < 1e-9) return 0.5;
    const frac = (thresholdMm - v1) / denom;
    return frac < 0 ? 0 : frac > 1 ? 1 : frac;
  };

  for (let j = 0; j < rows - 1; j++) {
    for (let i = 0; i < cols - 1; i++) {
      const a = bin(i, j), b = bin(i + 1, j), c = bin(i + 1, j + 1), d = bin(i, j + 1);
      const caseIndex = a * 8 + b * 4 + c * 2 + d;
      if (caseIndex === 0 || caseIndex === 15) continue;

      const x0 = minXmm + i * cellSizeMm, x1 = minXmm + (i + 1) * cellSizeMm;
      const y0 = minYmm + j * cellSizeMm, y1 = minYmm + (j + 1) * cellSizeMm;
      // Node values: vA top-left (i,j), vB top-right (i+1,j), vC bottom-right (i+1,j+1),
      // vD bottom-left (i,j+1). Each shared edge is interpolated from the same node pair by both
      // cells that touch it, so stitchSegmentsIntoLoops()'s exact-key endpoint matching still holds.
      const vA = val(i, j), vB = val(i + 1, j), vC = val(i + 1, j + 1), vD = val(i, j + 1);
      const T = { xMm: x0 + crossFrac(vA, vB) * (x1 - x0), yMm: y0 };
      const R = { xMm: x1, yMm: y0 + crossFrac(vB, vC) * (y1 - y0) };
      const B = { xMm: x0 + crossFrac(vD, vC) * (x1 - x0), yMm: y1 };
      const L = { xMm: x0, yMm: y0 + crossFrac(vA, vD) * (y1 - y0) };
      const pushSeg = (p1, p2) => segments.push([p1, p2]);

      switch (caseIndex) {
        case 1: pushSeg(L, B); break;
        case 2: pushSeg(B, R); break;
        case 3: pushSeg(L, R); break;
        case 4: pushSeg(T, R); break;
        case 6: pushSeg(T, B); break;
        case 7: pushSeg(T, L); break;
        case 8: pushSeg(T, L); break;
        case 9: pushSeg(T, B); break;
        case 11: pushSeg(T, R); break;
        case 12: pushSeg(L, R); break;
        case 13: pushSeg(B, R); break;
        case 14: pushSeg(L, B); break;
        case 5: {
          const center = cellCenterValue(distanceGrid, cols, i, j) >= thresholdMm;
          if (center) { pushSeg(T, L); pushSeg(B, R); } else { pushSeg(T, R); pushSeg(L, B); }
          break;
        }
        case 10: {
          const center = cellCenterValue(distanceGrid, cols, i, j) >= thresholdMm;
          if (center) { pushSeg(T, R); pushSeg(L, B); } else { pushSeg(T, L); pushSeg(B, R); }
          break;
        }
        default: break;
      }
    }
  }

  return stitchSegmentsIntoLoops(segments, cellSizeMm);
}

// Stitches the unordered segment soup into closed loops by matching shared endpoints (every
// interior grid edge with a segment is shared by exactly two cells, which independently compute the
// exact same midpoint coordinates, so exact-key matching is sufficient), mirroring
// PathBoolean.js's stitchSegmentsIntoContours() shape.
function stitchSegmentsIntoLoops(segments, cellSizeMm) {
  const precisionMm = cellSizeMm / 1000;
  const endpointIndex = new Map();
  const addEndpoint = (key, segIndex, end) => {
    if (!endpointIndex.has(key)) endpointIndex.set(key, []);
    endpointIndex.get(key).push({ segIndex, end });
  };
  segments.forEach((segment, segIndex) => {
    addEndpoint(pointKey(segment[0].xMm, segment[0].yMm, precisionMm), segIndex, 0);
    addEndpoint(pointKey(segment[1].xMm, segment[1].yMm, precisionMm), segIndex, 1);
  });

  const usedSegment = new Uint8Array(segments.length);
  const loops = [];

  for (let startIndex = 0; startIndex < segments.length; startIndex++) {
    if (usedSegment[startIndex]) continue;
    usedSegment[startIndex] = 1;

    const startPoint = segments[startIndex][0];
    const loop = [startPoint, segments[startIndex][1]];
    let currentPoint = segments[startIndex][1];
    let guard = 0;

    while (guard++ < segments.length + 4) {
      if (pointKey(currentPoint.xMm, currentPoint.yMm, precisionMm) === pointKey(startPoint.xMm, startPoint.yMm, precisionMm) && loop.length > 1) break;
      const candidates = endpointIndex.get(pointKey(currentPoint.xMm, currentPoint.yMm, precisionMm)) || [];
      const next = candidates.find((candidate) => !usedSegment[candidate.segIndex]);
      if (!next) break;
      usedSegment[next.segIndex] = 1;
      const segment = segments[next.segIndex];
      currentPoint = next.end === 0 ? segment[1] : segment[0];
      loop.push(currentPoint);
    }

    if (pointKey(loop[loop.length - 1].xMm, loop[loop.length - 1].yMm, precisionMm) === pointKey(startPoint.xMm, startPoint.yMm, precisionMm)) {
      loop.pop();
    }
    if (loop.length >= 3) loops.push(loop);
  }

  return loops;
}

// Defense-in-depth cap: a pathological `maxSpacingMm` (a vanishingly small stone pitch) against a
// large loop would try to allocate millions of vertices. `computeInwardRingPolygons()` throws a
// ContourFillPrecisionError for that same input first (sampleContourFillPoints() computes rings
// before densifying the boundary), so in practice this is never hit -- but a caller of
// splitSliverRuns() with its own numbers should degrade to "no densification" rather than OOM.
const MAX_DENSIFIED_LOOP_VERTICES = 250_000;

// READ-001 (Finding 2): resample a closed loop so no two consecutive vertices are more than
// `maxSpacingMm` apart, interpolating extra vertices along any longer edge (the closing edge
// included). Coarse input (a 4-vertex Rect, a Slot, a sparse SVG path) needs this before
// splitSliverRuns() can detect an opposing branch; a marching-squares ring is already finer and
// passes through unchanged.
function densifyClosedLoop(loop, maxSpacingMm) {
  if (!(maxSpacingMm > 0)) return loop.slice();
  const n = loop.length;
  let perimeterMm = 0;
  for (let i = 0; i < n; i++) {
    const a = loop[i];
    const b = loop[(i + 1) % n];
    perimeterMm += Math.hypot(b.xMm - a.xMm, b.yMm - a.yMm);
  }
  if (perimeterMm / maxSpacingMm > MAX_DENSIFIED_LOOP_VERTICES) return loop.slice();
  const out = [];
  for (let i = 0; i < n; i++) {
    const a = loop[i];
    const b = loop[(i + 1) % n];
    out.push({ xMm: a.xMm, yMm: a.yMm });
    const segLenMm = Math.hypot(b.xMm - a.xMm, b.yMm - a.yMm);
    const steps = Math.ceil(segLenMm / maxSpacingMm);
    for (let s = 1; s < steps; s++) {
      const t = s / steps;
      out.push({ xMm: a.xMm + (b.xMm - a.xMm) * t, yMm: a.yMm + (b.yMm - a.yMm) * t });
    }
  }
  return out;
}

/**
 * READ-001 -- centreline collapse for slivered (near-self-touching) loops.
 *
 * A traced iso-distance loop on an elongated region (a letter stroke) runs down one side of the
 * stroke and back up the other. Where the remaining width drops below `minSeparationMm` the loop's
 * two opposing branches close up; sampled naively as a closed loop that lays two nearly-coincident
 * rows of stones which greedy dedupe then culls in arbitrary walk order. This function replaces each
 * such run with a single line of midpoints down its medial axis.
 *
 * The loop is first resampled to a vertex spacing of at most `minSeparationMm / 4` (see
 * densifyClosedLoop()) -- detection walks *vertices*, so a coarse polygon (a 4-vertex Rect, a Slot,
 * a sparse SVG path) would otherwise have no eligible partner within a quarter-loop and skip the
 * collapse entirely. A traced marching-squares ring is already finer than that, so densification is
 * a no-op for rings. Stone spacing is unaffected either way: sampleContourFillPoints() re-walks
 * every returned piece at the full `spacingMm`.
 *
 * For every (densified) vertex, its nearest *other* vertex at least `1.5 x minSeparationMm` away
 * along the loop's arc length is found via a grid-hash spatial index (never an O(n^2) scan). If that
 * neighbour is closer than `minSeparationMm` in a straight line, the vertex is "slivered" and the
 * pair's midpoint is its centreline point. Contiguous slivered runs become open polylines of those
 * midpoints; contiguous non-slivered runs become open polylines of the (densified) vertices. A loop
 * with no slivered vertex is returned unchanged as a single closed piece. Each opposing pair
 * contributes its midpoint once, so a collapsed sliver is a single line of points, not a doubled one.
 *
 * Stroke terminals: the arc-separation gate can never be satisfied by the few vertices right around
 * a stroke end narrower than `minSeparationMm` (a flat end spans only ~w of arc; a semicircular cap
 * spans at most ~(pi/2) x minSeparationMm), so a short non-slivered run flanked on both sides by
 * slivered runs is a terminal, not a widening. When *every* non-slivered run is such a terminal
 * (arc length < `2 x minSeparationMm`) the whole loop is one open medial path: each terminal is
 * absorbed as a single point at its arc-length midpoint and the result is one tip-to-tip open
 * centreline. A loop that also has a genuine wide non-slivered region keeps the per-run split
 * (slivered runs -> centreline pieces, wide runs -> outline pieces). A fully slivered loop (no
 * terminal runs at all) likewise returns one open centreline.
 *
 * @param {{xMm:number,yMm:number}[]} loop Closed-loop vertices (first vertex is not repeated at the end).
 * @param {number} minSeparationMm
 * @returns {{points: {xMm:number,yMm:number}[], closed: boolean}[]}
 */
export function splitSliverRuns(loop, minSeparationMm) {
  if (loop.length < 3 || !(minSeparationMm > 0)) {
    return [{ points: loop, closed: true }];
  }

  const densifiedLoop = densifyClosedLoop(loop, minSeparationMm / 4);
  const n = densifiedLoop.length;
  if (n < 3) {
    return [{ points: loop, closed: true }];
  }

  // A vertex's own near-in-walk neighbours are trivially within minSeparationMm (a short arc
  // connects them); only a vertex on the *opposing* branch of a slivered run counts. Gate on
  // arc length along the loop, not vertex-index count: a fraction-of-index gate (the first cut used
  // 25%) leaves most of a *tall* thin loop uncollapsed, because "25% of the perimeter" is a large
  // slice of the height once the loop is long and narrow. Any two same-branch points closer than
  // minSeparationMm in a straight line are also closer than that in arc length, so requiring the
  // partner to be at least 1.5x minSeparationMm away in arc excludes every same-branch neighbour
  // while still catching the opposing branch right up to each rounded end (a cap spans only about
  // pi/2 x minSeparationMm of arc).
  const arcLengthMm = new Float64Array(n);
  let perimeterMm = 0;
  for (let i = 0; i < n; i++) {
    arcLengthMm[i] = perimeterMm;
    const b = densifiedLoop[(i + 1) % n];
    perimeterMm += Math.hypot(b.xMm - densifiedLoop[i].xMm, b.yMm - densifiedLoop[i].yMm);
  }
  const minArcSepMm = minSeparationMm * 1.5;
  const circularArcSepMm = (a, b) => {
    const d = Math.abs(arcLengthMm[a] - arcLengthMm[b]);
    return Math.min(d, perimeterMm - d);
  };

  // Grid-hash every vertex (cell == minSeparationMm) so the nearest-far-vertex query below only ever
  // scans a 3x3 neighbourhood of cells, not the whole loop.
  const cellMm = minSeparationMm;
  const buckets = new Map();
  const bucketKey = (gx, gy) => `${gx},${gy}`;
  const cellOf = (p) => [Math.floor(p.xMm / cellMm), Math.floor(p.yMm / cellMm)];
  for (let i = 0; i < n; i++) {
    const [gx, gy] = cellOf(densifiedLoop[i]);
    const key = bucketKey(gx, gy);
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(i);
  }

  const partner = new Int32Array(n).fill(-1);
  const minSepSqMm = minSeparationMm * minSeparationMm;
  for (let i = 0; i < n; i++) {
    const p = densifiedLoop[i];
    const [gx, gy] = cellOf(p);
    let bestJ = -1;
    let bestSq = minSepSqMm;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const bucket = buckets.get(bucketKey(gx + dx, gy + dy));
        if (!bucket) continue;
        for (const j of bucket) {
          if (j === i || circularArcSepMm(i, j) < minArcSepMm) continue;
          const ddx = p.xMm - densifiedLoop[j].xMm;
          const ddy = p.yMm - densifiedLoop[j].yMm;
          const sq = ddx * ddx + ddy * ddy;
          if (sq < bestSq) { bestSq = sq; bestJ = j; }
        }
      }
    }
    partner[i] = bestJ;
  }

  const slivered = new Uint8Array(n);
  let anySliver = false;
  for (let i = 0; i < n; i++) {
    if (partner[i] >= 0) { slivered[i] = 1; anySliver = true; }
  }
  if (!anySliver) {
    return [{ points: loop, closed: true }];
  }

  const midpointOf = (i) => ({
    xMm: (densifiedLoop[i].xMm + densifiedLoop[partner[i]].xMm) / 2,
    yMm: (densifiedLoop[i].yMm + densifiedLoop[partner[i]].yMm) / 2
  });
  const pushDedup = (arr, pt) => {
    const last = arr[arr.length - 1];
    if (last && Math.hypot(last.xMm - pt.xMm, last.yMm - pt.yMm) < minSeparationMm * 1e-3) return;
    arr.push(pt);
  };

  // Rotate the scan origin to a run boundary; `start === n` means every vertex shares the same flag
  // (a single run around the whole loop).
  let start = 0;
  while (start < n && slivered[start] === slivered[(start - 1 + n) % n]) start++;

  if (start === n) {
    // Fully slivered: one open centreline (each pair's midpoint once, at its lower-indexed member).
    const pts = [];
    for (let i = 0; i < n; i++) {
      if (i < partner[i]) pushDedup(pts, midpointOf(i));
    }
    return pts.length >= 2 ? [{ points: pts, closed: false }] : [{ points: loop, closed: true }];
  }

  // Collect the loop's maximal same-flag runs in walk order.
  const runs = [];
  {
    let runFlag = slivered[start];
    let indices = [];
    for (let s = 0; s < n; s++) {
      const i = (start + s) % n;
      if (slivered[i] !== runFlag) {
        runs.push({ slivered: runFlag, indices });
        indices = [];
        runFlag = slivered[i];
      }
      indices.push(i);
    }
    runs.push({ slivered: runFlag, indices });
  }

  const runArcMm = (indices) => {
    let s = 0;
    for (let k = 0; k + 1 < indices.length; k++) {
      s += Math.hypot(
        densifiedLoop[indices[k + 1]].xMm - densifiedLoop[indices[k]].xMm,
        densifiedLoop[indices[k + 1]].yMm - densifiedLoop[indices[k]].yMm
      );
    }
    return s;
  };
  const arcMidpointOf = (indices) => {
    const total = runArcMm(indices);
    if (indices.length === 1 || !(total > 0)) return { ...densifiedLoop[indices[0]] };
    const half = total / 2;
    let acc = 0;
    for (let k = 0; k + 1 < indices.length; k++) {
      const a = densifiedLoop[indices[k]];
      const b = densifiedLoop[indices[k + 1]];
      const seg = Math.hypot(b.xMm - a.xMm, b.yMm - a.yMm);
      if (acc + seg >= half) {
        const t = seg > 0 ? (half - acc) / seg : 0;
        return { xMm: a.xMm + (b.xMm - a.xMm) * t, yMm: a.yMm + (b.yMm - a.yMm) * t };
      }
      acc += seg;
    }
    return { ...densifiedLoop[indices[indices.length - 1]] };
  };

  // A non-slivered run wedged between two slivered runs and shorter than `TERMINAL_ABSORB_ARC_MM`
  // of arc is a stroke terminal, not a genuine widening of the shape. The arc-separation gate
  // (partner at least 1.5x minSeparationMm away along the loop) can never be met by the handful of
  // vertices right around a stroke end narrower than minSeparationMm: a flat end spans only ~w of
  // arc, a semicircular cap spans at most about (pi/2) x minSeparationMm, and the unpaired run
  // around either works out to ~minArcSepMm = 1.5x minSeparationMm -- always comfortably under 2x.
  // Sampled as outline geometry those vertices land a half-width off the centreline (the corner of
  // a rectangle, the shoulder of a cap); absorbed into the collapse they contribute one centreline
  // point at the run's arc-length midpoint -- the flat end's centre, the cap's tip -- both correct.
  // A real non-slivered region (the shape genuinely widens past a pitch) is far longer and is left
  // to sample as its own outline piece in the mixed-case branch below.
  const TERMINAL_ABSORB_ARC_MM = minSeparationMm * 2;
  const slivRunCount = runs.reduce((c, r) => c + (r.slivered ? 1 : 0), 0);
  const nonSlivRuns = runs.filter((r) => !r.slivered);
  const allNonSlivAreTerminals = slivRunCount > 0 && nonSlivRuns.length > 0 &&
    nonSlivRuns.every((r) => runArcMm(r.indices) < TERMINAL_ABSORB_ARC_MM);

  if (allNonSlivAreTerminals && nonSlivRuns.length <= 2) {
    // Exactly two terminals: the medial axis is a single open path from one to the other. Walk the
    // runs in loop order: each slivered run contributes its opposing pairs' midpoints (each pair
    // once -- the first run to reach a pair consumes both members, so a mirror-image return run adds
    // nothing); each terminal contributes one point at its arc-length midpoint. Concatenated in walk
    // order this is a *cyclic* point list with exactly one oversized gap -- where a run emitted
    // nothing and the walk jumped straight from the near end of the stroke to the far end. Cut the
    // cycle at that gap (ORDERING HAZARD -- see this function's doc comment) so the open centreline
    // runs tip-to-tip, in order, with every internal step within a pitch.
    const consumed = new Uint8Array(n);
    const cyclic = [];
    for (const run of runs) {
      if (run.slivered) {
        for (const i of run.indices) {
          if (consumed[i]) continue;
          // Nearest-far-vertex pairing is not always mutual: near a cap a handful of vertices on
          // the return branch point at an already-emitted vertex rather than at the partner that
          // consumed them. Emitting them anyway would drop a near-duplicate midpoint on the far
          // side of the tip in walk order -- the spike the ordering hazard warns about. If this
          // vertex's partner has already contributed the pair, just mark it done.
          if (partner[i] >= 0 && consumed[partner[i]]) { consumed[i] = 1; continue; }
          consumed[i] = 1;
          if (partner[i] >= 0) consumed[partner[i]] = 1;
          pushDedup(cyclic, midpointOf(i));
        }
      } else {
        pushDedup(cyclic, arcMidpointOf(run.indices));
      }
    }
    if (cyclic.length < 2) {
      return [{ points: loop, closed: true }];
    }
    let cutAfter = cyclic.length - 1;
    let maxGapSq = -1;
    for (let i = 0; i < cyclic.length; i++) {
      const b = cyclic[(i + 1) % cyclic.length];
      const gapSq = (cyclic[i].xMm - b.xMm) ** 2 + (cyclic[i].yMm - b.yMm) ** 2;
      if (gapSq > maxGapSq) { maxGapSq = gapSq; cutAfter = i; }
    }
    const ordered = [];
    for (let k = 0; k < cyclic.length; k++) ordered.push(cyclic[(cutAfter + 1 + k) % cyclic.length]);
    return [{ points: ordered, closed: false }];
  }

  if (allNonSlivAreTerminals) {
    // Three or more terminals -- a branching medial axis (a thin "+"/"T"/"Y" shape). Threading one
    // polyline through a branch point would leave a jump that samples as a line of strays, so emit
    // each slivered run as its own centreline piece and each terminal as a single arc-midpoint
    // point. Still drops the off-centre outline stub the terminal would otherwise sample.
    const pieces = [];
    for (const run of runs) {
      if (run.slivered) {
        const pts = [];
        for (const i of run.indices) {
          if (i < partner[i]) pushDedup(pts, midpointOf(i));
        }
        if (pts.length > 0) pieces.push({ points: pts, closed: false });
      } else {
        pieces.push({ points: [arcMidpointOf(run.indices)], closed: false });
      }
    }
    return pieces;
  }

  // Mixed case: at least one genuine non-slivered region. Emit every run as its own piece --
  // slivered runs collapse to a midpoint centreline, non-slivered runs sample as outline.
  const pieces = [];
  for (const run of runs) {
    if (run.slivered) {
      const pts = [];
      for (const i of run.indices) {
        if (i < partner[i]) pushDedup(pts, midpointOf(i));
      }
      if (pts.length > 0) pieces.push({ points: pts, closed: false });
    } else {
      pieces.push({ points: run.indices.map((i) => densifiedLoop[i]), closed: false });
    }
  }
  return pieces;
}

/**
 * Compute every inward contour ring's polygon(s) for Contour Fill, starting `startOffsetMm` in from
 * the shape's boundary and stepping inward by `spacingMm` (the same stone pitch every other fill
 * mode uses) until the shape is exhausted.
 *
 * @param {object} params
 * @param {(xMm:number, yMm:number)=>boolean} params.insideAt Interior test (vector: isPointInsidePolygons(); raster: field threshold lookup).
 * @param {{minXmm:number,minYmm:number,maxXmm:number,maxYmm:number}} params.boundingBox
 * @param {number} params.spacingMm Stone pitch (stoneSizeMm + gapMm); must be positive.
 * @param {number} params.startOffsetMm Distance of the first computed ring from the boundary.
 * @returns {{xMm:number,yMm:number}[][]} Closed ring polygons, outermost first. Never includes the
 *   shape's true (un-eroded) boundary -- callers that want that ring sample it directly themselves.
 * @throws {ContourFillPrecisionError} If the shape/spacing combination would need an unreasonable grid.
 */
export function computeInwardRingPolygons({ insideAt, boundingBox, spacingMm, startOffsetMm }) {
  if (!(spacingMm > 0)) {
    throw new RangeError('computeInwardRingPolygons requires a positive spacingMm.');
  }
  if (!boundingBox) {
    return [];
  }

  const field = buildDistanceField(insideAt, boundingBox, spacingMm);
  if (!field) {
    return [];
  }

  // READ-001: the sub-cell boundary localisation in chamferDistanceTransform() gives the field a
  // genuine true-distance estimate, so a ring's iso-contour is traced at its nominal threshold with
  // no correction -- EXCEPT for the innermost, "degenerate" ring of an *elongated* shape whose
  // medial reach falls a fraction of a cell short of that ring's nominal distance (a stroke exactly
  // N pitches wide: the centreline ring's nominal distance is the true half-width, but the
  // discretised field's maximum lands just under it, and its exact iso-contour there is a single
  // ridge node -- an empty or near-degenerate loop). `slopMm` (one cell of localisation + chamfer
  // uncertainty) lets that ring still be attempted; a threshold above the field maximum is traced
  // one cell BELOW the maximum, giving a ~1-cell band straddling the medial ridge that
  // splitSliverRuns() collapses to the medial axis. Round shapes (a disc, a square) have a
  // *point* medial locus, not a line -- their degenerate band is a small blob, and loopIsElongated()
  // rejects it so no spurious one-stone centre ring appears. Non-degenerate rings are untouched.
  const slopMm = field.cellSizeMm;
  if (field.maxDistanceMm + slopMm < startOffsetMm) {
    return [];
  }

  const rings = [];
  let ringCount = 0;
  for (let thresholdMm = startOffsetMm; thresholdMm <= field.maxDistanceMm + slopMm; thresholdMm += spacingMm) {
    if (++ringCount > MAX_RING_COUNT) {
      throw new ContourFillPrecisionError(
        'Contour Fill produced an unexpectedly large number of rings for this shape and stone pitch. ' +
        'Try a larger stone size or gap.'
      );
    }
    const degenerate = thresholdMm > field.maxDistanceMm;
    const tracedThresholdMm = degenerate
      ? Math.max(field.cellSizeMm, field.maxDistanceMm - field.cellSizeMm)
      : thresholdMm;
    let loops = traceIsoDistanceContour(field.distanceGrid, field.cols, field.rows, field.minXmm, field.minYmm, field.cellSizeMm, tracedThresholdMm);
    if (degenerate) {
      loops = loops.filter(loopIsElongated);
      if (loops.length > 0) rings.push(...loops);
      break; // nothing lies deeper than the medial axis
    }
    if (loops.length === 0) break;
    rings.push(...loops);
  }

  return rings;
}
