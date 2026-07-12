/**
 * Vector Boolean Operations — RS-1012.
 *
 * Combines two shape "sources" (Union / Subtract / Intersect / Exclude) into a new set of
 * millimeter-space polygon contours. A source is either:
 *
 *   { kind: 'polygons', polygons: {xMm,yMm}[][] }               -- any already-flattened vector
 *                                                                   shape (circle/rectangle/svg/
 *                                                                   text/a previous boolean result)
 *   { kind: 'field', field, xMm, yMm, widthMm, heightMm }        -- an Image Trace layer's raster
 *                                                                   density field (src/image/**),
 *                                                                   placed the same way
 *                                                                   generateImageLayout() places it
 *
 * True analytic polygon clipping (Weiler-Atherton/Greiner-Hormann-style) does not generalize
 * cleanly to multi-contour shapes with holes (glyph counters, nested SVG paths) or to a raster
 * Image Trace field without inventing a second, parallel vectorization system. This module instead
 * rasterizes both sources onto one shared millimeter grid (reusing StoneSampler's even-odd
 * `isPointInsidePolygons()` for vector sources -- the same interior test `sampleFillPoints()`
 * already uses, so a vector shape's "inside" here is defined identically to how it is defined for
 * fill-mode stone placement), combines them with the requested boolean truth table, and traces the
 * combined mask's boundary back into vector polygons with marching squares. The grid resolution
 * (see TARGET_GRID_CELLS/MIN_CELL_SIZE_MM/MAX_CELL_SIZE_MM below) is far finer than any stone
 * spacing used in this app, so the result is visually and dimensionally indistinguishable from an
 * analytic clip for rhinestone-placement purposes -- see docs/specifications/
 * RS-1012-VectorBooleanOperations.md, "Architecture", for the full rationale and its tradeoffs.
 *
 * Holes and multiple disjoint contours fall out of this for free: marching squares traces every
 * boundary loop in the combined mask independently, and every downstream consumer
 * (GeometryEngine.generatePathLayout()'s outline/fill sampling) already treats a shape's contour
 * list as an even-odd set (see ContourGeometry.js/StoneSampler.js), so a hole contour nested inside
 * an outer contour "just works" without this module needing to know which contour is a hole.
 *
 * No DOM/Canvas/WebGL dependency. Pure functions of plain {xMm,yMm} points.
 *
 * RS-1012A (Production Precision Validation) measured this engine against production-scale
 * examples (see tools/measure-boolean-precision.mjs and docs/specifications/
 * RS-1012A-ProductionPrecisionValidation.md) and made two changes as a direct result:
 *
 *   1. Grid resolution is now adaptive, not purely a function of the combined bounding box (see
 *      computeAdaptiveCellSizeMm() below) -- it also tightens for a small shape combined with a
 *      much larger one (so a tiny cutout/detail isn't starved of resolution by an unrelated big
 *      shape sharing the operation) and, when the caller supplies the destination layer's
 *      stoneSizeMm+gapMm (`options.targetSpacingMm`), tightens further so boundary error stays a
 *      small, bounded fraction of the actual stone pitch regardless of document size -- see
 *      "Precision Requirements" and "Adaptive Precision" in the RS-1012A spec.
 *   2. `combineShapeSources()`/`combineManyShapeSources()` now throw a `BooleanPrecisionError`
 *      instead of silently coarsening when the accuracy-driven resolution would need more grid
 *      cells than a fixed performance budget allows (MAX_GRID_CELLS_BUDGET) -- this can only
 *      happen when the two shapes differ enormously in scale (e.g. a sub-millimeter detail
 *      combined with a multi-meter shape); ordinary rhinestone-design-scale operations never hit
 *      it (see the spec's "Fail Safe" section for the measured margin).
 */

import { isPointInsidePolygons } from './StoneSampler.js';

export const BOOLEAN_OPERATIONS = new Set(['union', 'subtract', 'intersect', 'xor']);

// Density field "on" threshold, matching StoneSampler.js's FIELD_ON_THRESHOLD / the raster Image
// Trace pipeline (src/image/**): a field value at/above this level counts as foreground.
const FIELD_ON_THRESHOLD = 128;

// Grid resolution. cellSizeMm starts from the combined bounding box's longer dimension so a small
// shape (a few mm) and a large one (a whole canvas) both get a proportionate number of grid cells,
// then computeAdaptiveCellSizeMm() below tightens it further for a small feature or a fine stone
// pitch (RS-1012A) -- clamped so neither a tiny shape/spacing (which would otherwise get a
// sub-micron cell) nor a huge simple shape (which would otherwise allocate an enormous grid for no
// accuracy benefit -- "avoid unnecessary computation on simple designs") can make this pathological.
const TARGET_GRID_CELLS = 220;
const MIN_CELL_SIZE_MM = 0.08;
const MAX_CELL_SIZE_MM = 1;

// RS-1012A: a shape's own bounding-box diagonal must span at least this many grid cells, even when
// combined with a much larger shape in the same operation -- otherwise a small cutout/detail's
// resolution would be dictated entirely by an unrelated, much bigger, shape sharing the operation.
// Measured against production-scale examples: without this, a 50mm-square-minus-circle-cutout
// operation reliably preserved cutout radii down to only ~0.25mm at the square's own (unrelated,
// coarser) grid resolution; this brings small-feature preservation in line with what a shape's own
// scale would otherwise resolve if it were being combined with something its own size.
const MIN_CELLS_ACROSS_SMALLER_SOURCE = 60;

// RS-1012A: when the caller knows the destination layer's stone pitch (stoneSizeMm + gapMm), keep
// the grid at least this many cells finer than that pitch, so boundary error stays a small,
// bounded fraction of stone placement regardless of document size -- directly answers "resolution
// should scale with stone size/gap" from the milestone brief. Optional: callers that don't have a
// concrete destination pitch yet (e.g. this module's own unit tests) simply don't pass it.
const SPACING_RESOLUTION_DIVISOR = 6;

// RS-1012A fail-safe: the hard ceiling on total grid cells (cols*rows) this engine will ever
// allocate. Sized so that two shapes spanning up to ~2100mm combined (comfortably covering a large
// production sheet -- most rhinestone designs are garment/product scale, well under a meter) still
// succeed even at the coarsest allowed resolution (MAX_CELL_SIZE_MM, i.e. no small-feature/stone-
// pitch constraint pulling it finer): (2100/MAX_CELL_SIZE_MM + 2)^2 ~= 4.4M. Measured
// production-scale scenarios (a 210x90mm mug-wrap canvas, an 800x600mm production-sheet-scale
// operation, a 1000x800mm large-document-scale operation, a 60mm chain of overlapping circles) all
// complete in well under this budget with room to spare, in well under a second (see
// tools/measure-boolean-precision.mjs, sections 9/11). Only a combination whose two shapes differ
// enormously in scale (e.g. a sub-mm detail unioned with a multi-meter shape) can exceed it -- see
// computeAdaptiveCellSizeMm().
const MAX_GRID_CELLS_BUDGET = 4_500_000;

export class BooleanPrecisionError extends Error {
  constructor(message) {
    super(message);
    this.name = 'BooleanPrecisionError';
  }
}

// Computes the grid cell size for one combineShapeSources() call. See the module-level RS-1012A
// comment above for the rationale; throws BooleanPrecisionError (rather than silently coarsening)
// when the accuracy-driven size would need an unreasonable grid.
function computeAdaptiveCellSizeMm({ subjectBox, clipBox, combinedSpanMm, targetSpacingMm }) {
  let idealCellSizeMm = combinedSpanMm / TARGET_GRID_CELLS;

  const diagonalsMm = [subjectBox, clipBox]
    .filter(Boolean)
    .map((box) => Math.hypot(box.maxXmm - box.minXmm, box.maxYmm - box.minYmm))
    .filter((diagonal) => diagonal > 1e-9);
  if (diagonalsMm.length > 0) {
    idealCellSizeMm = Math.min(idealCellSizeMm, Math.min(...diagonalsMm) / MIN_CELLS_ACROSS_SMALLER_SOURCE);
  }

  if (typeof targetSpacingMm === 'number' && Number.isFinite(targetSpacingMm) && targetSpacingMm > 0) {
    idealCellSizeMm = Math.min(idealCellSizeMm, targetSpacingMm / SPACING_RESOLUTION_DIVISOR);
  }

  idealCellSizeMm = Math.max(idealCellSizeMm, MIN_CELL_SIZE_MM);
  const cellSizeMm = Math.min(idealCellSizeMm, MAX_CELL_SIZE_MM);

  const totalCells = (combinedSpanMm / cellSizeMm + 2) ** 2; // +2 mirrors the one-cell padding on every side
  if (totalCells > MAX_GRID_CELLS_BUDGET) {
    throw new BooleanPrecisionError(
      'This combination cannot be computed at a safe, well-defined precision: the shapes differ too ' +
      'much in size or detail for the requested area (a very small detail combined with a very large ' +
      'shape). Try scaling the shapes closer in size, simplifying the smaller one, or splitting the ' +
      'operation into smaller parts.'
    );
  }

  return cellSizeMm;
}

function sourceBoundingBox(source) {
  if (!source) return null;
  if (source.kind === 'polygons') {
    let minXmm = Infinity, minYmm = Infinity, maxXmm = -Infinity, maxYmm = -Infinity;
    for (const polygon of source.polygons) {
      for (const point of polygon) {
        if (point.xMm < minXmm) minXmm = point.xMm;
        if (point.xMm > maxXmm) maxXmm = point.xMm;
        if (point.yMm < minYmm) minYmm = point.yMm;
        if (point.yMm > maxYmm) maxYmm = point.yMm;
      }
    }
    if (!Number.isFinite(minXmm)) return null;
    return { minXmm, minYmm, maxXmm, maxYmm };
  }
  if (source.kind === 'field') {
    if (!(source.widthMm > 0) || !(source.heightMm > 0)) return null;
    return { minXmm: source.xMm, minYmm: source.yMm, maxXmm: source.xMm + source.widthMm, maxYmm: source.yMm + source.heightMm };
  }
  throw new TypeError(`Unsupported boolean shape source kind: ${source.kind}`);
}

function sampleSource(source, xMm, yMm) {
  if (!source) return 0;
  if (source.kind === 'polygons') {
    return isPointInsidePolygons({ xMm, yMm }, source.polygons) ? 1 : 0;
  }
  const { field } = source;
  const localXMm = xMm - source.xMm;
  const localYMm = yMm - source.yMm;
  if (localXMm < 0 || localYMm < 0 || localXMm > source.widthMm || localYMm > source.heightMm) return 0;
  const pixelX = Math.min(field.widthPx - 1, Math.max(0, Math.floor((localXMm / source.widthMm) * field.widthPx)));
  const pixelY = Math.min(field.heightPx - 1, Math.max(0, Math.floor((localYMm / source.heightMm) * field.heightPx)));
  return field.data[pixelY * field.widthPx + pixelX] >= FIELD_ON_THRESHOLD ? 1 : 0;
}

function combineValues(subjectValue, clipValue, operation) {
  switch (operation) {
    case 'union': return (subjectValue || clipValue) ? 1 : 0;
    case 'intersect': return (subjectValue && clipValue) ? 1 : 0;
    case 'subtract': return (subjectValue && !clipValue) ? 1 : 0;
    case 'xor': return (subjectValue !== clipValue) ? 1 : 0;
    default: throw new TypeError(`Unsupported boolean operation: ${operation}. Expected one of: ${[...BOOLEAN_OPERATIONS].join(', ')}`);
  }
}

/**
 * Combine two shape sources with a single boolean operation.
 *
 * @param {{kind:'polygons',polygons:{xMm:number,yMm:number}[][]}|{kind:'field',field:object,xMm:number,yMm:number,widthMm:number,heightMm:number}} subjectSource
 * @param {*} clipSource Same shape as subjectSource.
 * @param {'union'|'subtract'|'intersect'|'xor'} operation
 * @param {object} [options]
 * @param {number} [options.targetSpacingMm] The destination layer's stoneSizeMm+gapMm, if known --
 *   RS-1012A: used to tighten grid resolution so boundary error stays a bounded fraction of the
 *   actual stone pitch. Optional; omitting it falls back to bounding-box/feature-size sizing alone.
 * @returns {{contours:{xMm:number,yMm:number}[][], boundingBox:{minXmm:number,minYmm:number,maxXmm:number,maxYmm:number}|null}}
 * @throws {BooleanPrecisionError} If the accuracy-driven resolution would need an unreasonable grid
 *   (the two shapes differ enormously in scale) -- see computeAdaptiveCellSizeMm().
 */
export function combineShapeSources(subjectSource, clipSource, operation, options = {}) {
  if (!BOOLEAN_OPERATIONS.has(operation)) {
    throw new TypeError(`Unsupported boolean operation: ${operation}. Expected one of: ${[...BOOLEAN_OPERATIONS].join(', ')}`);
  }

  const subjectBox = sourceBoundingBox(subjectSource);
  const clipBox = sourceBoundingBox(clipSource);
  const boxes = [subjectBox, clipBox].filter(Boolean);
  if (boxes.length === 0) {
    return { contours: [], boundingBox: null };
  }

  const minXmm = Math.min(...boxes.map((box) => box.minXmm));
  const minYmm = Math.min(...boxes.map((box) => box.minYmm));
  const maxXmm = Math.max(...boxes.map((box) => box.maxXmm));
  const maxYmm = Math.max(...boxes.map((box) => box.maxYmm));

  const spanMm = Math.max(maxXmm - minXmm, maxYmm - minYmm, 1e-6);
  const cellSizeMm = computeAdaptiveCellSizeMm({
    subjectBox,
    clipBox,
    combinedSpanMm: spanMm,
    targetSpacingMm: options.targetSpacingMm
  });

  // Pad by one cell on every side so a shape flush against the raw bounding box still closes into a
  // proper loop (the grid border always samples 0/outside).
  return traceCombinedMask({
    subjectSource,
    clipSource,
    operation,
    minXmm: minXmm - cellSizeMm,
    minYmm: minYmm - cellSizeMm,
    maxXmm: maxXmm + cellSizeMm,
    maxYmm: maxYmm + cellSizeMm,
    cellSizeMm
  });
}

/**
 * Fold a boolean operation across 2+ shape sources, left to right: `((s0 op s1) op s2) op ...`.
 * Correct for every supported operation -- union/intersect are associative, sequential subtract
 * (`A-B-C`) equals `A-(B∪C)`, and symmetric difference (xor/"Exclude") is associative too, matching
 * how Illustrator/Affinity resolve a 3+ shape Pathfinder operation.
 *
 * @param {Array} sources 2 or more shape sources (see combineShapeSources()).
 * @param {'union'|'subtract'|'intersect'|'xor'} operation
 * @param {object} [options] Same as combineShapeSources()'s options, applied to every fold step.
 * @returns {{contours:{xMm:number,yMm:number}[][], boundingBox:object|null}}
 */
export function combineManyShapeSources(sources, operation, options = {}) {
  if (!Array.isArray(sources) || sources.length < 2) {
    throw new RangeError('combineManyShapeSources requires at least two shape sources.');
  }

  let subject = sources[0];
  let result = null;
  for (let i = 1; i < sources.length; i++) {
    result = combineShapeSources(subject, sources[i], operation, options);
    subject = { kind: 'polygons', polygons: result.contours };
  }
  return result;
}

function traceCombinedMask({ subjectSource, clipSource, operation, minXmm, minYmm, maxXmm, maxYmm, cellSizeMm }) {
  const cols = Math.max(2, Math.round((maxXmm - minXmm) / cellSizeMm) + 1);
  const rows = Math.max(2, Math.round((maxYmm - minYmm) / cellSizeMm) + 1);
  const grid = new Uint8Array(cols * rows);

  for (let j = 0; j < rows; j++) {
    const yMm = minYmm + j * cellSizeMm;
    for (let i = 0; i < cols; i++) {
      const xMm = minXmm + i * cellSizeMm;
      grid[j * cols + i] = combineValues(sampleSource(subjectSource, xMm, yMm), sampleSource(clipSource, xMm, yMm), operation);
    }
  }

  const sampleCombinedAt = (xMm, yMm) => combineValues(sampleSource(subjectSource, xMm, yMm), sampleSource(clipSource, xMm, yMm), operation);
  const segments = traceMarchingSquares(grid, cols, rows, minXmm, minYmm, cellSizeMm, sampleCombinedAt);
  const contours = stitchSegmentsIntoContours(segments, cellSizeMm)
    .map((contour) => simplifyContour(contour, cellSizeMm * 0.35))
    .filter((contour) => contour.length >= 3 && contourAreaAbs(contour) > (cellSizeMm * cellSizeMm) / 4);

  return { contours, boundingBox: computeContoursBoundingBox(contours) };
}

// Standard 16-case marching-squares segment table. Corners are sampled a=TL, b=TR, c=BR, d=BL;
// caseIndex = a*8+b*4+c*2+d. Edges are named by compass position of the cell (T=top, R=right,
// B=bottom, L=left); each edge's contour point is that edge's midpoint (the field is binary, not a
// continuous isovalue, so there is no sub-edge interpolation position to compute). Cases 5 and 10
// are the ambiguous "saddle" cases (diagonally opposite corners disagree) and are resolved by
// sampling the true combined value at the cell center: if the center matches the two positive
// corners, they are treated as connected through the middle (the boundary instead isolates the two
// negative corners); otherwise the two positive corners are treated as separate pockets.
function traceMarchingSquares(grid, cols, rows, minXmm, minYmm, cellSizeMm, sampleCombinedAt) {
  const segments = [];

  for (let j = 0; j < rows - 1; j++) {
    for (let i = 0; i < cols - 1; i++) {
      const a = grid[j * cols + i];
      const b = grid[j * cols + i + 1];
      const c = grid[(j + 1) * cols + i + 1];
      const d = grid[(j + 1) * cols + i];
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
          const center = sampleCombinedAt((x0 + x1) / 2, (y0 + y1) / 2);
          if (center) { pushSeg(T, L); pushSeg(B, R); } else { pushSeg(T, R); pushSeg(L, B); }
          break;
        }
        case 10: {
          const center = sampleCombinedAt((x0 + x1) / 2, (y0 + y1) / 2);
          if (center) { pushSeg(T, R); pushSeg(L, B); } else { pushSeg(T, L); pushSeg(B, R); }
          break;
        }
        default: break;
      }
    }
  }

  return segments;
}

function pointKey(point, precisionMm) {
  return `${Math.round(point.xMm / precisionMm)}:${Math.round(point.yMm / precisionMm)}`;
}

// Stitches the unordered soup of boundary segments marching squares produces into closed loops by
// matching shared endpoints (every interior grid edge with a segment is shared by exactly two
// cells, which independently compute the exact same midpoint coordinates, so exact-key matching --
// no distance tolerance -- is sufficient and unambiguous).
function stitchSegmentsIntoContours(segments, cellSizeMm) {
  const precisionMm = cellSizeMm / 1000;
  const endpointIndex = new Map();
  const addEndpoint = (key, segIndex, end) => {
    if (!endpointIndex.has(key)) endpointIndex.set(key, []);
    endpointIndex.get(key).push({ segIndex, end });
  };
  segments.forEach((segment, segIndex) => {
    addEndpoint(pointKey(segment[0], precisionMm), segIndex, 0);
    addEndpoint(pointKey(segment[1], precisionMm), segIndex, 1);
  });

  const usedSegment = new Uint8Array(segments.length);
  const contours = [];

  for (let startIndex = 0; startIndex < segments.length; startIndex++) {
    if (usedSegment[startIndex]) continue;
    usedSegment[startIndex] = 1;

    const startPoint = segments[startIndex][0];
    const contour = [startPoint, segments[startIndex][1]];
    let currentPoint = segments[startIndex][1];
    let guard = 0;

    while (guard++ < segments.length + 4) {
      if (pointKey(currentPoint, precisionMm) === pointKey(startPoint, precisionMm) && contour.length > 1) break;
      const candidates = endpointIndex.get(pointKey(currentPoint, precisionMm)) || [];
      const next = candidates.find((candidate) => !usedSegment[candidate.segIndex]);
      if (!next) break;
      usedSegment[next.segIndex] = 1;
      const segment = segments[next.segIndex];
      currentPoint = next.end === 0 ? segment[1] : segment[0];
      contour.push(currentPoint);
    }

    if (pointKey(contour[contour.length - 1], precisionMm) === pointKey(startPoint, precisionMm)) {
      contour.pop();
    }
    if (contour.length >= 3) contours.push(contour);
  }

  return contours;
}

function perpendicularDistanceMm(point, lineStart, lineEnd) {
  const dx = lineEnd.xMm - lineStart.xMm, dy = lineEnd.yMm - lineStart.yMm;
  const lenMm = Math.hypot(dx, dy);
  if (lenMm < 1e-9) return Math.hypot(point.xMm - lineStart.xMm, point.yMm - lineStart.yMm);
  const cross = (point.xMm - lineStart.xMm) * dy - (point.yMm - lineStart.yMm) * dx;
  return Math.abs(cross) / lenMm;
}

// RS-1012A: anchor-based greedy simplification (an "Opheim"-style forward scan), replacing an
// earlier single-pass version that measured each point only against its ORIGINAL immediate
// neighbors. That approach cascaded on smooth curves: at fine grid resolution, any three
// consecutive points on a circle's boundary are locally near-collinear (the sagitta over a short
// arc is far smaller than the simplification tolerance), so nearly every point looked individually
// safe to drop even though the arc as a whole curves substantially -- on at least one measured
// case (two concentric circles, radius 10mm/8mm, ~0.09mm grid cells) this collapsed a 65-point
// flattened circle boundary down to a degenerate, non-simple 3-point shape covering only half the
// circle (see docs/specifications/RS-1012A-ProductionPrecisionValidation.md, "Audit Findings").
//
// This version keeps a fixed anchor point and only advances it once a candidate point would place
// some already-passed-over point more than epsilonMm from the straight line (anchor -> candidate) --
// i.e. every dropped point's deviation is always measured against the line it will actually be
// approximated by once simplified, not against its own original neighbors, so error cannot
// compound silently across a long smooth run the way the neighbor-only version did.
function simplifyContour(points, epsilonMm) {
  const deduped = [];
  for (const point of points) {
    const prev = deduped[deduped.length - 1];
    if (!prev || Math.hypot(point.xMm - prev.xMm, point.yMm - prev.yMm) > 1e-9) deduped.push(point);
  }
  if (deduped.length < 4) return deduped;

  const n = deduped.length;
  const kept = [deduped[0]];
  let anchorIndex = 0;

  for (let i = 1; i < n; i++) {
    const anchor = deduped[anchorIndex];
    const candidate = deduped[i];
    let withinTolerance = true;
    for (let k = anchorIndex + 1; k < i; k++) {
      if (perpendicularDistanceMm(deduped[k], anchor, candidate) > epsilonMm) {
        withinTolerance = false;
        break;
      }
    }
    if (!withinTolerance) {
      kept.push(deduped[i - 1]);
      anchorIndex = i - 1;
    }
  }
  kept.push(deduped[n - 1]);

  return kept.length >= 3 ? kept : deduped;
}

function contourAreaAbs(points) {
  let area = 0;
  for (let i = 0; i < points.length; i++) {
    const p1 = points[i], p2 = points[(i + 1) % points.length];
    area += p1.xMm * p2.yMm - p2.xMm * p1.yMm;
  }
  return Math.abs(area) / 2;
}

function computeContoursBoundingBox(contours) {
  let minXmm = Infinity, minYmm = Infinity, maxXmm = -Infinity, maxYmm = -Infinity;
  for (const contour of contours) {
    for (const point of contour) {
      if (point.xMm < minXmm) minXmm = point.xMm;
      if (point.xMm > maxXmm) maxXmm = point.xMm;
      if (point.yMm < minYmm) minYmm = point.yMm;
      if (point.yMm > maxYmm) maxYmm = point.yMm;
    }
  }
  if (!Number.isFinite(minXmm)) return null;
  return { minXmm, minYmm, maxXmm, maxYmm };
}
