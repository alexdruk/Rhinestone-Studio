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

  const distanceGrid = chamferDistanceTransform(insideGrid, cols, rows, cellSizeMm);

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
function chamferDistanceTransform(insideGrid, cols, rows, cellSizeMm) {
  const dist = new Float64Array(insideGrid.length);
  for (let i = 0; i < insideGrid.length; i++) {
    dist[i] = insideGrid[i] ? Number.POSITIVE_INFINITY : 0;
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
function traceIsoDistanceContour(distanceGrid, cols, rows, minXmm, minYmm, cellSizeMm, thresholdMm) {
  const bin = (i, j) => distanceGrid[j * cols + i] >= thresholdMm ? 1 : 0;
  const segments = [];

  for (let j = 0; j < rows - 1; j++) {
    for (let i = 0; i < cols - 1; i++) {
      const a = bin(i, j), b = bin(i + 1, j), c = bin(i + 1, j + 1), d = bin(i, j + 1);
      const caseIndex = a * 8 + b * 4 + c * 2 + d;
      if (caseIndex === 0 || caseIndex === 15) continue;

      const x0 = minXmm + i * cellSizeMm, x1 = minXmm + (i + 1) * cellSizeMm;
      const y0 = minYmm + j * cellSizeMm, y1 = minYmm + (j + 1) * cellSizeMm;
      const T = { xMm: (x0 + x1) / 2, yMm: y0 };
      const R = { xMm: x1, yMm: (y0 + y1) / 2 };
      const B = { xMm: (x0 + x1) / 2, yMm: y1 };
      const L = { xMm: x0, yMm: (y0 + y1) / 2 };
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
  if (!field || field.maxDistanceMm < startOffsetMm) {
    return [];
  }

  const rings = [];
  let ringCount = 0;
  for (let thresholdMm = startOffsetMm; thresholdMm <= field.maxDistanceMm + field.cellSizeMm; thresholdMm += spacingMm) {
    if (++ringCount > MAX_RING_COUNT) {
      throw new ContourFillPrecisionError(
        'Contour Fill produced an unexpectedly large number of rings for this shape and stone pitch. ' +
        'Try a larger stone size or gap.'
      );
    }
    const loops = traceIsoDistanceContour(field.distanceGrid, field.cols, field.rows, field.minXmm, field.minYmm, field.cellSizeMm, thresholdMm);
    if (loops.length === 0) break;
    rings.push(...loops);
  }

  return rings;
}
