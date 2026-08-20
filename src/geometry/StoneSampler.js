/**
 * Stone placement sampling for the Geometry Engine.
 *
 * These functions turn flattened polygons (already millimeters, already
 * positioned) into candidate stone center points for outline or fill
 * placement. They contain no font, rendering, or export concerns.
 */

import { Point2D } from '../text/VectorPath.js';
import { computeInwardRingPolygons } from './ContourRingSampler.js';

// Outline-mode uniform-perimeter spacing: the actual per-contour walk step that makes
// n = round(perimeterMm / spacingMm) equal-length hops close the loop exactly, so every gap around
// the ring -- including the wrap-around seam -- ends up mathematically identical instead of
// concentrating a leftover remainder in one spot. Floors at one step (n=1) when perimeterMm is too
// small to fit even one nominal step -- round() would otherwise yield 0 and divide by zero -- which
// reproduces the single-point result the fixed-increment walk below already produces for such a
// shape today (its loop condition `targetMm < perimeterMm` naturally stops after one iteration
// whenever spacingMm > perimeterMm), not a new behavior.
function uniformStepMm(perimeterMm, spacingMm) {
  const stepCount = Math.max(1, Math.round(perimeterMm / spacingMm));
  return perimeterMm / stepCount;
}

/**
 * Walk a polygon's perimeter and return points spaced spacingMm apart along the outline, starting
 * at the polygon's first vertex. By default the polygon is treated as closed (a final segment
 * connects the last vertex back to the first, matching a filled shape's true outline); pass
 * `{ closed: false }` to walk an open path instead (e.g. an SVG `<line>`/`<polyline>` or an
 * unclosed `<path>` subpath), which omits that wrap-around segment.
 *
 * `{ uniform: true }` (outline-uniform-perimeter-spacing fix, used only by
 * sampleMultiContourOutlinePoints() i.e. real Outline mode) normalizes the step to
 * uniformStepMm(perimeterMm, spacingMm) instead of the raw spacingMm, so consecutive gaps around
 * the whole contour are all identical -- no leftover seam gap. Off by default: Contour Fill mode
 * (sampleContourFillPoints()/sampleContourFieldFillPoints()) calls this function directly and must
 * keep today's fixed-increment behavior unchanged, since that's a different mode with a separate,
 * unrequested spacing problem.
 *
 * @param {Point2D[]} polygon
 * @param {number} spacingMm
 * @param {{closed?: boolean, uniform?: boolean}} [options]
 * @returns {Point2D[]}
 */
export function sampleOutlinePoints(polygon, spacingMm, { closed = true, uniform = false } = {}) {
  if (spacingMm <= 0) {
    throw new RangeError('sampleOutlinePoints requires a positive spacingMm.');
  }
  if (polygon.length < 2) {
    return [];
  }

  const pathPoints = closed ? [...polygon, polygon[0]] : polygon;
  const segmentLengthsMm = [];
  let perimeterMm = 0;

  for (let i = 0; i < pathPoints.length - 1; i++) {
    const length = pathPoints[i].distanceTo(pathPoints[i + 1]);
    segmentLengthsMm.push(length);
    perimeterMm += length;
  }

  if (perimeterMm <= 0) {
    return [];
  }

  const samples = [];
  let segmentIndex = 0;
  let segmentStartMm = 0;

  const pushSampleAt = (targetMm) => {
    while (
      segmentIndex < segmentLengthsMm.length - 1 &&
      segmentStartMm + segmentLengthsMm[segmentIndex] < targetMm
    ) {
      segmentStartMm += segmentLengthsMm[segmentIndex];
      segmentIndex++;
    }

    const segmentLengthMm = segmentLengthsMm[segmentIndex];
    const t = segmentLengthMm === 0 ? 0 : (targetMm - segmentStartMm) / segmentLengthMm;
    const start = pathPoints[segmentIndex];
    const end = pathPoints[segmentIndex + 1];

    samples.push(new Point2D(
      start.xMm + (end.xMm - start.xMm) * t,
      start.yMm + (end.yMm - start.yMm) * t
    ));
  };

  if (uniform) {
    // Indexed as i * stepMm (multiplication), not accumulated via `targetMm += stepMm`, so
    // floating-point drift can never accumulate across many hops into a spurious extra sample
    // right at the seam.
    const stepCount = Math.max(1, Math.round(perimeterMm / spacingMm));
    const stepMm = perimeterMm / stepCount;
    for (let i = 0; i < stepCount; i++) {
      pushSampleAt(i * stepMm);
    }
  } else {
    for (let targetMm = 0; targetMm < perimeterMm; targetMm += spacingMm) {
      pushSampleAt(targetMm);
    }
  }

  return samples;
}

/**
 * Fill the interior of one or more polygons with a regular grid of points
 * spaced spacingMm apart, keeping only points that fall inside an odd number
 * of polygons (even-odd rule). This correctly excludes glyph counters
 * (e.g. the hole in "o") when the outer and inner contours are both passed.
 *
 * @param {Point2D[][]} polygons
 * @param {import('../text/VectorPath.js').BoundingBox|null} boundingBox
 * @param {number} spacingMm
 * @returns {Point2D[]}
 */
export function sampleFillPoints(polygons, boundingBox, spacingMm) {
  if (spacingMm <= 0) {
    throw new RangeError('sampleFillPoints requires a positive spacingMm.');
  }
  if (!boundingBox) {
    return [];
  }

  const points = [];

  for (let yMm = boundingBox.minYmm + spacingMm / 2; yMm <= boundingBox.maxYmm; yMm += spacingMm) {
    for (let xMm = boundingBox.minXmm + spacingMm / 2; xMm <= boundingBox.maxXmm; xMm += spacingMm) {
      const candidate = new Point2D(xMm, yMm);
      if (isPointInsidePolygons(candidate, polygons)) {
        points.push(candidate);
      }
    }
  }

  return points;
}

/**
 * Even-odd point-in-polygon test across multiple polygons, so glyph holes
 * (inner contours) correctly subtract from outer contours.
 *
 * @param {Point2D} point
 * @param {Point2D[][]} polygons
 * @returns {boolean}
 */
export function isPointInsidePolygons(point, polygons) {
  let inside = false;
  for (const polygon of polygons) {
    if (isPointInsidePolygon(point, polygon)) {
      inside = !inside;
    }
  }
  return inside;
}

function isPointInsidePolygon(point, polygon) {
  let inside = false;
  const n = polygon.length;

  for (let i = 0, j = n - 1; i < n; j = i++) {
    const vi = polygon[i];
    const vj = polygon[j];

    const intersects = (vi.yMm > point.yMm) !== (vj.yMm > point.yMm) &&
      point.xMm < ((vj.xMm - vi.xMm) * (point.yMm - vi.yMm)) / (vj.yMm - vi.yMm) + vi.xMm;

    if (intersects) {
      inside = !inside;
    }
  }

  return inside;
}

/**
 * Drop any point closer than minDistanceMm to a point already kept, scanning in input order (so the
 * first of any close pair always wins -- deterministic, matching every other sampler's fixed scan
 * order). Uses the same bucketed-neighbor-check shape as app.js's pre-existing cross-layer
 * dedupe() (grid-hash cell lookup, only the 3x3 neighborhood of cells around each candidate is
 * checked), just generalized to arbitrary Point2D input rather than plain {x,y} stone records.
 *
 * RS-1011: used by Contour Fill and Radial Fill, the two modes whose ring/spoke geometry can
 * legitimately place two candidate points closer than the nominal spacingMm pitch near a shape's
 * boundary (see docs/specifications/RS-1011-FillAlgorithms.md, "avoid duplicate stones where
 * contours converge"). Grid Fill, Staggered Fill, and Outline mode never need this -- their fixed
 * scan order makes duplicates geometrically impossible.
 *
 * @param {Point2D[]} points
 * @param {number} minDistanceMm
 * @returns {Point2D[]}
 */
export function dedupeStonePoints(points, minDistanceMm) {
  if (!(minDistanceMm > 0) || points.length === 0) {
    return points;
  }

  const cellSizeMm = minDistanceMm;
  const minDistanceSqMm = minDistanceMm * minDistanceMm;
  const buckets = new Map();
  const kept = [];

  for (const point of points) {
    const gx = Math.floor(point.xMm / cellSizeMm);
    const gy = Math.floor(point.yMm / cellSizeMm);
    let tooClose = false;

    for (let dy = -1; dy <= 1 && !tooClose; dy++) {
      for (let dx = -1; dx <= 1 && !tooClose; dx++) {
        const bucket = buckets.get(`${gx + dx},${gy + dy}`);
        if (!bucket) continue;
        for (const other of bucket) {
          const ddx = point.xMm - other.xMm;
          const ddy = point.yMm - other.yMm;
          if (ddx * ddx + ddy * ddy < minDistanceSqMm) {
            tooClose = true;
            break;
          }
        }
      }
    }

    if (!tooClose) {
      kept.push(point);
      const key = `${gx},${gy}`;
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key).push(point);
    }
  }

  return kept;
}

/**
 * RC-004: drop any stone whose center lands within the physically-correct "touching" distance of
 * an already-kept stone *from a different layer* -- the sum of the two stones' own radii, i.e.
 * `(a.d + b.d) / 2` -- scanning in input order (first of any overlapping pair wins, matching
 * dedupeStonePoints()'s convention).
 *
 * This is the cross-layer counterpart to sampleMultiContourOutlinePoints()'s RC-002 fix, applied
 * at layer granularity the same way that one applies at contour granularity: a point is never
 * dropped for being close to another point from its *own* layerId, only for landing on top of a
 * different layer's stone. `app.js`'s per-layer GeometryEngine calls (and RC-002's own
 * cross-contour guard inside each of those calls) are already the sole authority for a layer's own
 * internal spacing -- including deliberately-preserved tight spots like a glyph's concave corners
 * or a Star's inner notches (see sampleMultiContourOutlinePoints()'s doc comment) -- so re-checking
 * same-layer pairs here would both duplicate that logic and undo those intentional exceptions.
 *
 * Threshold is computed per pair from each stone's own `d` (not one global value) because RS-1013
 * (Variable Stone Sizes) allows a different stoneSizeMm per layer, so two overlapping stones from
 * different layers are not necessarily the same size.
 *
 * Takes/returns the flat `{x, y, d, layerId}` stone-record shape `app.js`/`RhsFixtureBridge.js`
 * build *before* wrapping survivors in real `Stone` instances (matching the pre-existing
 * `dedupe()` calling convention at both call sites), not `Stone`/`Point2D`.
 *
 * @param {{x: number, y: number, d: number, layerId: string}[]} stones
 * @returns {object[]}
 */
export function dedupeStonesByRadius(stones) {
  if (stones.length === 0) {
    return stones;
  }

  const cellSizeMm = Math.max(...stones.map((s) => s.d));
  const buckets = new Map();
  const kept = [];

  for (const stone of stones) {
    const gx = Math.floor(stone.x / cellSizeMm);
    const gy = Math.floor(stone.y / cellSizeMm);
    let overlaps = false;

    for (let dy = -1; dy <= 1 && !overlaps; dy++) {
      for (let dx = -1; dx <= 1 && !overlaps; dx++) {
        const bucket = buckets.get(`${gx + dx},${gy + dy}`);
        if (!bucket) continue;
        for (const other of bucket) {
          if (other.layerId === stone.layerId) continue;
          const ddx = stone.x - other.x;
          const ddy = stone.y - other.y;
          const minSeparationMm = (stone.d + other.d) / 2;
          if (ddx * ddx + ddy * ddy < minSeparationMm * minSeparationMm) {
            overlaps = true;
            break;
          }
        }
      }
    }

    if (!overlaps) {
      kept.push(stone);
      const key = `${gx},${gy}`;
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key).push(stone);
    }
  }

  return kept;
}

/**
 * MONO-005A: a pure collision *query* over tagged groups of stones -- reuses dedupeStonesByRadius()'s
 * exact grid-hash bucket technique (bucket size = the largest `d` in play, 3x3-neighborhood scan,
 * cross-`layerId`-only comparisons, `(a.d+b.d)/2` touching threshold) but never drops or reorders a
 * stone. dedupeStonesByRadius() is a *deduplication* API: it greedily discards the later of any
 * colliding pair, so an already-dropped stone can never be compared against anything after it --
 * fine for its own "keep a de-overlapped set" purpose, but the wrong tool for *classifying* which
 * group-pairs collide (a caller checking two categories via two separate dedupe passes would need to
 * reason carefully about processing order to be sure a real collision was never masked by an earlier,
 * unrelated drop). This function instead inserts every stone unconditionally, checking each one
 * against every already-inserted stone in its 3x3 neighborhood before inserting it -- the standard
 * "sweep and insert, only look backward" correctness argument applies: every unordered close pair is
 * found exactly once, when the later-inserted member of the pair is processed, regardless of overall
 * input order. Distinct group-pairs are deduplicated in the *result* (not the scan), so calling this
 * twice with the same stones in a different order always reports the identical set of colliding
 * group-pairs.
 *
 * @param {{x: number, y: number, d: number, layerId: string}[]} stones
 * @returns {{layerIdA: string, layerIdB: string}[]} One entry per distinct unordered pair of group
 *   ids with at least one colliding stone pair between them. Empty if there are no collisions.
 */
export function findCrossGroupCollisions(stones) {
  const collisions = [];
  if (stones.length === 0) {
    return collisions;
  }

  const cellSizeMm = Math.max(...stones.map((s) => s.d));
  const buckets = new Map();
  const seenGroupPairs = new Set();

  for (const stone of stones) {
    const gx = Math.floor(stone.x / cellSizeMm);
    const gy = Math.floor(stone.y / cellSizeMm);

    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const bucket = buckets.get(`${gx + dx},${gy + dy}`);
        if (!bucket) continue;
        for (const other of bucket) {
          if (other.layerId === stone.layerId) continue;
          const ddx = stone.x - other.x;
          const ddy = stone.y - other.y;
          const minSeparationMm = (stone.d + other.d) / 2;
          if (ddx * ddx + ddy * ddy < minSeparationMm * minSeparationMm) {
            const pairKey = [stone.layerId, other.layerId].sort().join(' ');
            if (!seenGroupPairs.has(pairKey)) {
              seenGroupPairs.add(pairKey);
              collisions.push({ layerIdA: stone.layerId, layerIdB: other.layerId });
            }
          }
        }
      }
    }

    const key = `${gx},${gy}`;
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(stone);
  }

  return collisions;
}

/**
 * RS-3011 (corner-gap backfill): build a grid-hash proximity index with the exact same bucket
 * scheme dedupeStonePoints() uses internally (cell size == the caller's own minDistanceMm, 3x3
 * neighborhood scan) but exposed as insert/hasConflict so a caller can incrementally add points
 * and query for conflicts against everything inserted so far. dedupeStonePoints() itself builds and
 * discards an identical structure on every call and is deliberately left untouched (see its own doc
 * comment); this is that same bucket algorithm factored out for reuse, not a second/different check.
 */
function buildProximityIndex(points, minDistanceMm) {
  const cellSizeMm = minDistanceMm;
  const minDistanceSqMm = minDistanceMm * minDistanceMm;
  const buckets = new Map();

  function insert(point) {
    const gx = Math.floor(point.xMm / cellSizeMm);
    const gy = Math.floor(point.yMm / cellSizeMm);
    const key = `${gx},${gy}`;
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(point);
  }

  function hasConflict(point) {
    const gx = Math.floor(point.xMm / cellSizeMm);
    const gy = Math.floor(point.yMm / cellSizeMm);
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const bucket = buckets.get(`${gx + dx},${gy + dy}`);
        if (!bucket) continue;
        for (const other of bucket) {
          const ddx = point.xMm - other.xMm;
          const ddy = point.yMm - other.yMm;
          if (ddx * ddx + ddy * ddy < minDistanceSqMm) return true;
        }
      }
    }
    return false;
  }

  for (const point of points) insert(point);
  return { insert, hasConflict };
}

/** RS-3011: perimeter + per-segment lengths for a single contour, honoring the same open/closed
 * convention sampleOutlinePoints() uses (an appended closing segment back to the first vertex only
 * for closed contours). */
function contourPerimeterAndSegments(polygon, closed) {
  const pts = closed ? [...polygon, polygon[0]] : polygon;
  const segLensMm = [];
  let perimeterMm = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const lengthMm = pts[i].distanceTo(pts[i + 1]);
    segLensMm.push(lengthMm);
    perimeterMm += lengthMm;
  }
  return { pts, segLensMm, perimeterMm };
}

/** RS-3011: the point on a contour at a given arc-length position, wrapping modulo the perimeter
 * for closed contours and clamping to the path's true endpoints for open ones. */
function pointAtArcLength({ pts, segLensMm, perimeterMm }, sMmRaw, closed) {
  const sMm = closed
    ? ((sMmRaw % perimeterMm) + perimeterMm) % perimeterMm
    : Math.min(Math.max(sMmRaw, 0), perimeterMm);
  let segIndex = 0;
  let segStartMm = 0;
  while (segIndex < segLensMm.length - 1 && segStartMm + segLensMm[segIndex] < sMm) {
    segStartMm += segLensMm[segIndex];
    segIndex++;
  }
  const segLenMm = segLensMm[segIndex];
  const t = segLenMm === 0 ? 0 : (sMm - segStartMm) / segLenMm;
  const a = pts[segIndex];
  const b = pts[segIndex + 1];
  return { xMm: a.xMm + (b.xMm - a.xMm) * t, yMm: a.yMm + (b.yMm - a.yMm) * t };
}

/**
 * Corner-anchored per-side outline spacing: a second Outline-mode raw-sampling strategy, alongside
 * sampleOutlinePoints()'s whole-loop `{ uniform: true }` walk above (this function is a new path,
 * not a replacement -- see sampleMultiContourOutlinePoints()'s `cornerFlagsByContour` option). Used
 * only for shape kinds where every contour vertex is confirmed to be a genuine corner with no
 * smooth-curve tessellation in between (Rect, Regular Polygon, Star, Arrow, Cross -- wired in
 * GeometryEngine.js); every other shape kind keeps sampleOutlinePoints()'s whole-loop walk exactly
 * as before.
 *
 * Implemented generically against `cornerFlags` (walking from one flagged corner to the next,
 * wrapping at the seam for closed contours) rather than hard-coding "every vertex is a corner", so
 * this same mechanism is reusable later for a genuinely mixed case (e.g. Crescent's 2 real corners
 * among ~80 curve points) without a rewrite -- even though for today's five wired shape kinds every
 * vertex is flagged, so in practice this walks each edge between adjacent vertices.
 *
 * For each side (the path between one flagged corner and the next): a stone is placed AT the
 * starting corner (guaranteed -- every corner is the *starting* corner of exactly one side, so it
 * is placed exactly once, never by the side that ends there), then
 * n_side = Math.max(1, Math.round(sideLengthMm / spacingMm)) stones are placed evenly at
 * sideLengthMm / n_side apart, from the starting corner up to (not including) the next corner --
 * the same Math.max(1, round(...)) degenerate-short-side floor uniformStepMm() already uses above.
 *
 * @param {Point2D[]} polygon
 * @param {boolean[]} cornerFlags Parallel to `polygon`; true marks a genuine corner vertex. Must
 *   contain at least one true entry.
 * @param {number} spacingMm
 * @param {{closed?: boolean}} [options]
 * @returns {{points: Point2D[], arcLengthsMm: number[], perimeterMm: number}} `arcLengthsMm` is
 *   each returned point's true arc-length position along the contour (parallel to `points`), used
 *   by sampleMultiContourOutlinePoints()'s corner-gap backfill in place of the whole-loop walk's
 *   `index * uniformStepMm(...)` shortcut, which does not hold once side spacing varies per side.
 */
function sampleCornerAnchoredOutlinePoints(polygon, cornerFlags, spacingMm, { closed = true } = {}) {
  if (spacingMm <= 0) {
    throw new RangeError('sampleCornerAnchoredOutlinePoints requires a positive spacingMm.');
  }
  if (polygon.length < 2) {
    return { points: [], arcLengthsMm: [], perimeterMm: 0 };
  }

  const contourGeom = contourPerimeterAndSegments(polygon, closed);
  const { perimeterMm } = contourGeom;
  if (perimeterMm <= 0) {
    return { points: [], arcLengthsMm: [], perimeterMm };
  }

  const vertexArcLengthMm = [0];
  for (let i = 0; i < polygon.length - 1; i++) {
    vertexArcLengthMm.push(vertexArcLengthMm[i] + contourGeom.segLensMm[i]);
  }

  const cornerVertexIndices = [];
  for (let i = 0; i < polygon.length; i++) {
    if (cornerFlags[i]) cornerVertexIndices.push(i);
  }
  if (cornerVertexIndices.length === 0) {
    throw new RangeError('sampleCornerAnchoredOutlinePoints requires at least one true entry in cornerFlags.');
  }

  const points = [];
  const arcLengthsMm = [];
  const cornerCount = cornerVertexIndices.length;
  const pairCount = closed ? cornerCount : cornerCount - 1;

  for (let k = 0; k < pairCount; k++) {
    const startVertexIdx = cornerVertexIndices[k];
    const startArcLengthMm = vertexArcLengthMm[startVertexIdx];
    const endArcLengthMm = k + 1 < cornerCount
      ? vertexArcLengthMm[cornerVertexIndices[k + 1]]
      : vertexArcLengthMm[cornerVertexIndices[0]] + perimeterMm;

    const sideLengthMm = endArcLengthMm - startArcLengthMm;
    const nSide = Math.max(1, Math.round(sideLengthMm / spacingMm));
    const effectiveSideSpacingMm = sideLengthMm / nSide;

    for (let step = 0; step < nSide; step++) {
      const arcLengthMm = startArcLengthMm + step * effectiveSideSpacingMm;
      const raw = pointAtArcLength(contourGeom, arcLengthMm, closed);
      points.push(new Point2D(raw.xMm, raw.yMm));
      arcLengthsMm.push(closed ? ((arcLengthMm % perimeterMm) + perimeterMm) % perimeterMm : arcLengthMm);
    }
  }

  if (!closed) {
    // Open contours have no wraparound side to place the final corner implicitly.
    const lastVertexIdx = cornerVertexIndices[cornerCount - 1];
    points.push(polygon[lastVertexIdx]);
    arcLengthsMm.push(vertexArcLengthMm[lastVertexIdx]);
  }

  return { points, arcLengthsMm, perimeterMm };
}

/**
 * RS-3011 (corner-gap backfill): given the two dedupe-surviving points that flank a dropped sample
 * (in walk order, `spanMm` apart along the contour's own arc-length parameterization starting from
 * `fromArcLengthMm`), find the single best replacement position between them -- the point on the
 * true contour boundary where the straight-line (chord) distance to `prevPoint` first equals the
 * distance to `nextPoint`. That crossing is the maximum-of-the-minimum-clearance position: as the
 * search position sweeps from prevPoint to nextPoint, distance-to-prevPoint rises monotonically and
 * distance-to-nextPoint falls monotonically, so their crossing point is provably the best any single
 * inserted point can do (see the RS-3011 corner-gap investigation this implements). Returns `null`
 * ("no legal position" -- the common case for a sharp 90-degree-class corner) when even that best
 * position doesn't clear `minSeparationMm` from both sides; callers must fall back to leaving the
 * gap exactly as today.
 */
function findEquidistantBackfillPoint(contourGeom, closed, prevPoint, nextPoint, fromArcLengthMm, spanMm, minSeparationMm) {
  if (!(spanMm > 0) || !(contourGeom.perimeterMm > 0)) return null;

  let loMm = fromArcLengthMm;
  let hiMm = fromArcLengthMm + spanMm;

  const distAt = (sMm, fromPoint) => {
    const p = pointAtArcLength(contourGeom, sMm, closed);
    return Math.hypot(p.xMm - fromPoint.xMm, p.yMm - fromPoint.yMm);
  };

  for (let iter = 0; iter < 60; iter++) {
    const midMm = (loMm + hiMm) / 2;
    if (distAt(midMm, prevPoint) < distAt(midMm, nextPoint)) loMm = midMm; else hiMm = midMm;
  }

  const eqMm = (loMm + hiMm) / 2;
  const clearanceMm = distAt(eqMm, prevPoint);
  if (clearanceMm < minSeparationMm - 1e-6) return null;

  const eqPoint = pointAtArcLength(contourGeom, eqMm, closed);
  return new Point2D(eqPoint.xMm, eqPoint.yMm);
}

/**
 * RC-002 / RC-004A: sample every contour's outline points independently (via sampleOutlinePoints()
 * with `{ uniform: true }` -- outline-uniform-perimeter-spacing -- so each contour's own arc-length
 * walk stays completely self-contained, just normalized to close the loop with zero leftover seam
 * gap instead of the raw spacingMm), then drop any point that lands within `minSeparationMm` of an
 * already-kept point -- from that *same* contour or a *different* one alike.
 *
 * RC-002 (cross-contour): outline mode samples stone centers directly on each contour's boundary
 * curve. For a multi-contour shape (Ring's outer+inner circle; a glyph's outer contour and an
 * interior counter/hole like "o" or "e"; a Boolean Operation difference result; an SVG document
 * with nested closed paths) two *different* contours can pass closer to each other than one stone
 * pitch -- e.g. a Ring whose annulus (outer radius - inner radius) is narrower than stoneSizeMm --
 * and independently sampling each contour then produces physically overlapping stones, since
 * nothing previously related one contour's points to another's.
 *
 * RC-004A (same-contour): a single contour's arc-length walk only guarantees consecutive samples
 * are (uniform-)spacingMm apart *along the perimeter* -- the straight-line (chord) distance between
 * them is always <= that, and sharp curvature (a cursive font's tight loop or cusp, a sharp corner)
 * can pull that chord below the physically-correct touching distance, even between *immediately
 * adjacent* samples. This is confirmed directly against `long-script-name.rhs`'s own contours: 132
 * adjacent-sample pairs and all 48 closing seams landed under the physical threshold before this fix
 * (see tools/test-rc-004a-same-contour-overlap.mjs). An "arc-length-adjacent samples are always
 * fine" exemption was considered and rejected: it left exactly these worst overlaps (near-zero
 * clearance) in place, because that is precisely where the defect lives. (The 48 closing-seam
 * overlaps specifically were also a symptom of the fixed-increment walk's leftover-remainder gap,
 * separately fixed by outline-uniform-perimeter-spacing's `{ uniform: true }` above; sharp-corner
 * curvature is a distinct, still-live geometric cause this pass keeps guarding against regardless of
 * how uniform the arc-length spacing is.)
 *
 * Both cases use the exact same rule, so there is only one to state: nothing is ever pruned merely
 * for being *close*. A tight-but-non-overlapping notch or cusp (e.g. Star's inner notches) never
 * breaches the physical sum-of-radii threshold and survives untouched; only a literal physical
 * overlap -- same-contour or cross-contour alike -- is ever removed. Earlier samples (by input
 * order, contour-by-contour then sample-by-sample) are therefore always fully preserved; a later
 * sample is the only one ever pruned, matching dedupeStonePoints()'s existing "first of any close
 * pair wins" convention -- this function's body is in fact now exactly dedupeStonePoints() applied
 * to every contour's points concatenated in that fixed order.
 *
 * `minSeparationMm` defaults to `spacingMm` (matching dedupeStonePoints()'s existing "full pitch"
 * floor for Contour/Radial Fill's own convergence problem), but callers should pass stoneSizeMm
 * explicitly: the reported defect is literal physical overlap (center-to-center distance less than
 * the sum of two stones' radii, i.e. less than stoneSizeMm for same-size stones), not merely
 * "closer than the full gap-inclusive pitch". Flooring at the full spacingMm pitch instead measurably
 * thins outline stone counts even for widely-used shapes/text that never actually overlap (dense
 * script fonts' nearby strokes, in particular) -- a much larger, more visible behavior change than
 * this fix's scope calls for. Flooring at stoneSizeMm is the minimal change that still strictly
 * guarantees no two stones -- from the same contour or different ones -- ever overlap.
 *
 * RS-3011 (corner-gap backfill): dedupeStonePoints() drops a too-close sample but leaves nothing in
 * its place, which can balloon the gap between its two surviving neighbors well past the intended
 * pitch -- most visibly at a sharp corner, where curvature pulls the walk-order-adjacent chord below
 * the physical threshold. After dedupeStonePoints() runs (unchanged, still the single source of
 * truth for what survives), this function makes one additional pass *per contour* over the points
 * that were dropped: if a dropped point's flanking survivors (found by walking outward along that
 * same contour's own raw samples, wrapping at the seam for closed contours) are now more than
 * spacingMm apart, it looks for the one legal position to backfill -- see
 * findEquidistantBackfillPoint(). This is a deliberately partial fix: most sharp corners (e.g. a
 * plain rectangle's 90-degree corners) have no geometric room for a legal replacement point at all,
 * and are left exactly as before; only where genuine room exists does a point get inserted. Every
 * candidate is checked against a proximity index seeded with the full dedupe-surviving set (and
 * grown as earlier backfills succeed), not just its own two neighbors, so a backfill can never
 * introduce a new overlap with some other nearby point -- from the same corner, a different corner,
 * or a different contour entirely.
 *
 * Corner-anchored per-side spacing (see sampleCornerAnchoredOutlinePoints() above): pass
 * `cornerFlagsByContour` -- an array parallel to `polygons`, each entry either a per-point
 * boolean[] (parallel to that contour's own polygon) or null/undefined -- to sample that
 * particular contour with corner-anchored per-side spacing instead of the whole-loop uniform walk.
 * Every contour with no entry (or a null/undefined one) is completely unaffected, still sampled by
 * sampleOutlinePoints()'s existing `{ uniform: true }` walk exactly as before this option existed.
 *
 * @param {Point2D[][]} polygons
 * @param {number} spacingMm
 * @param {{closed?: boolean, minSeparationMm?: number, cornerFlagsByContour?: (boolean[]|null)[]}} [options]
 * @returns {Point2D[]}
 */
export function sampleMultiContourOutlinePoints(polygons, spacingMm, { closed = true, minSeparationMm = spacingMm, cornerFlagsByContour = null } = {}) {
  const contourSamples = polygons.map((polygon, c) => {
    const cornerFlags = cornerFlagsByContour ? cornerFlagsByContour[c] : null;
    if (cornerFlags) {
      const sampled = sampleCornerAnchoredOutlinePoints(polygon, cornerFlags, spacingMm, { closed });
      return { points: sampled.points, arcLengthsMm: sampled.arcLengthsMm };
    }
    return { points: sampleOutlinePoints(polygon, spacingMm, { closed, uniform: true }), arcLengthsMm: null };
  });
  const contourRawPoints = contourSamples.map((sample) => sample.points);
  const points = contourRawPoints.flat();
  const kept = dedupeStonePoints(points, minSeparationMm);

  if (kept.length === points.length) {
    return kept;
  }

  const keptSet = new Set(kept);
  const index = buildProximityIndex(kept, minSeparationMm);
  let contourGeomCache = null;
  let contourArcLengthsCache = null;

  const result = [];
  for (let c = 0; c < polygons.length; c++) {
    const rawPoints = contourRawPoints[c];
    const n = rawPoints.length;
    contourGeomCache = null;
    contourArcLengthsCache = null;

    for (let i = 0; i < n; i++) {
      const point = rawPoints[i];
      if (keptSet.has(point)) {
        result.push(point);
        continue;
      }

      // Dropped by dedupeStonePoints(). Walk outward in both directions along THIS contour's own
      // raw samples only -- never across contours, since arc-length geometry is only meaningful
      // within one contour -- to find the two genuine dedupe-surviving neighbors flanking the gap.
      // Closed contours wrap at the seam: the closing seam is not geometrically distinct from any
      // other corner (a closed contour has no true "start", only an arbitrary sampling origin), so
      // it gets the same backfill treatment, not a special case. Open contours stop at the path's
      // true endpoints -- there is no segment beyond them to backfill into.
      let prevSteps = 0;
      let nextSteps = 0;
      for (let step = 1; step <= n; step++) {
        const idx = closed ? ((i - step) % n + n) % n : i - step;
        if (idx < 0) break;
        if (keptSet.has(rawPoints[idx])) { prevSteps = step; break; }
      }
      for (let step = 1; step <= n; step++) {
        const idx = closed ? (i + step) % n : i + step;
        if (idx >= n) break;
        if (keptSet.has(rawPoints[idx])) { nextSteps = step; break; }
      }

      if (prevSteps === 0 || nextSteps === 0) continue; // no two-sided gap: degenerate contour or open-path end

      const prevIdx = closed ? ((i - prevSteps) % n + n) % n : i - prevSteps;
      const nextIdx = closed ? (i + nextSteps) % n : i + nextSteps;
      const prevPoint = rawPoints[prevIdx];
      const nextPoint = rawPoints[nextIdx];

      const flankGapMm = Math.hypot(prevPoint.xMm - nextPoint.xMm, prevPoint.yMm - nextPoint.yMm);
      if (flankGapMm <= spacingMm) continue; // gap isn't worse than the intended pitch -- nothing to backfill

      if (!contourGeomCache) {
        contourGeomCache = contourPerimeterAndSegments(polygons[c], closed);
        // The raw samples above were walked at this contour's own per-point arc length -- for a
        // whole-loop-uniform contour that's `index * uniformStepMm(...)` (a fixed step, computed
        // here); for a corner-anchored contour it's sampleCornerAnchoredOutlinePoints()'s own
        // per-side arc lengths, already computed once above and reused as-is, since per-side
        // spacing varies and there is no single fixed step to multiply by.
        contourArcLengthsCache = contourSamples[c].arcLengthsMm
          ?? rawPoints.map((_, idx) => idx * uniformStepMm(contourGeomCache.perimeterMm, spacingMm));
      }
      const { perimeterMm } = contourGeomCache;
      const fromArcLengthMm = contourArcLengthsCache[prevIdx];
      const spanMm = closed
        ? (((contourArcLengthsCache[nextIdx] - contourArcLengthsCache[prevIdx]) % perimeterMm) + perimeterMm) % perimeterMm
        : contourArcLengthsCache[nextIdx] - contourArcLengthsCache[prevIdx];
      const candidate = findEquidistantBackfillPoint(
        contourGeomCache, closed, prevPoint, nextPoint, fromArcLengthMm, spanMm, minSeparationMm
      );

      if (!candidate) continue; // no legal position -- drop-fallback, matching current behavior exactly
      if (index.hasConflict(candidate)) continue; // would overlap some other already-kept/backfilled point

      index.insert(candidate);
      result.push(candidate);
    }
  }

  return result;
}

// RS-1011: dedupeStonePoints()'s minimum-distance floor for Contour/Radial Fill, as a fraction of
// the stone pitch. This is 1.0 -- the *full* pitch, not a discount -- deliberately: StoneSampler.js
// only ever receives the combined spacingMm (stoneSizeMm + gapMm), never the two values separately,
// so there is no safe smaller floor that is guaranteed non-overlapping for every stoneSize/gap
// split a user could configure (e.g. a small gap would let a fractional floor like 0.9*spacingMm
// fall below stoneSizeMm itself -- literal physical overlap). Every other mode's target minimum
// spacing is already exactly spacingMm; Contour/Radial Fill hold to the same one number, per "use
// the existing stone pitch convention, do not invent a second spacing formula" -- see
// docs/specifications/RS-1011-FillAlgorithms.md, "Precision and Fail-Safes".
const DEDUPE_FRACTION_OF_SPACING = 1.0;

/**
 * Fill the interior of one or more polygons with a hexagonal ("staggered") point arrangement:
 * alternating rows offset by spacingMm/2, with row-to-row spacing of spacingMm*sqrt(3)/2 -- the
 * unique row spacing at which every point's nearest neighbors (same row and both adjacent rows) are
 * all exactly spacingMm apart. This is standard hexagonal packing derived from the one stone-pitch
 * value every other mode already uses (see docs/specifications/RS-1011-FillAlgorithms.md,
 * "Staggered Fill"), not a second spacing formula: square (Grid Fill) packing gives 4 nearest
 * neighbors at spacingMm; this gives 6, at the same spacingMm, over the same area.
 *
 * @param {Point2D[][]} polygons
 * @param {import('../text/VectorPath.js').BoundingBox|null} boundingBox
 * @param {number} spacingMm
 * @returns {Point2D[]}
 */
export function sampleStaggeredFillPoints(polygons, boundingBox, spacingMm) {
  if (spacingMm <= 0) {
    throw new RangeError('sampleStaggeredFillPoints requires a positive spacingMm.');
  }
  if (!boundingBox) {
    return [];
  }

  const rowSpacingMm = spacingMm * (Math.sqrt(3) / 2);
  const points = [];
  let rowIndex = 0;

  for (let yMm = boundingBox.minYmm + spacingMm / 2; yMm <= boundingBox.maxYmm; yMm += rowSpacingMm, rowIndex++) {
    const rowOffsetMm = (rowIndex % 2 === 1) ? spacingMm / 2 : 0;
    for (let xMm = boundingBox.minXmm + spacingMm / 2 + rowOffsetMm; xMm <= boundingBox.maxXmm; xMm += spacingMm) {
      const candidate = new Point2D(xMm, yMm);
      if (isPointInsidePolygons(candidate, polygons)) {
        points.push(candidate);
      }
    }
  }

  return points;
}

function boundingBoxCenter(boundingBox) {
  return new Point2D(
    (boundingBox.minXmm + boundingBox.maxXmm) / 2,
    (boundingBox.minYmm + boundingBox.maxYmm) / 2
  );
}

function boundingBoxFarthestCornerDistanceMm(boundingBox, center) {
  let maxDistanceMm = 0;
  for (const xMm of [boundingBox.minXmm, boundingBox.maxXmm]) {
    for (const yMm of [boundingBox.minYmm, boundingBox.maxYmm]) {
      maxDistanceMm = Math.max(maxDistanceMm, Math.hypot(xMm - center.xMm, yMm - center.yMm));
    }
  }
  return maxDistanceMm;
}

// RS-1011: how many equally-spaced points fit around a ring of this radius while guaranteeing every
// pair of adjacent points' straight-line (chord) distance is still >= spacingMm -- not just their
// arc-length distance, which is always slightly *more* than chord distance for a positive radius, so
// targeting arc length alone (`round(2*pi*r/spacingMm)`) can silently place points closer than
// spacingMm in a straight line. Chord length for n equally-spaced points is `2*r*sin(pi/n)`, a
// function that decreases as n increases; solving `2*r*sin(pi/n) = spacingMm` for n and flooring
// picks the *largest* n (most points) whose chord still meets or exceeds spacingMm.
function radialStepCount(radiusMm, spacingMm) {
  const halfChordRatio = Math.min(1, spacingMm / (2 * radiusMm));
  return Math.max(1, Math.floor(Math.PI / Math.asin(halfChordRatio)));
}

/**
 * Fill the interior of one or more polygons with concentric rings of points spaced radially and
 * along each ring's own arc-length by spacingMm, centered on the shape's own bounding-box center
 * (see docs/specifications/RS-1011-FillAlgorithms.md, "Radial Fill" -- always well-defined, so no
 * per-layer center override field is needed). One stone sits at the exact center when the center
 * point itself is inside the shape.
 *
 * @param {Point2D[][]} polygons
 * @param {import('../text/VectorPath.js').BoundingBox|null} boundingBox
 * @param {number} spacingMm
 * @returns {Point2D[]}
 */
export function sampleRadialFillPoints(polygons, boundingBox, spacingMm) {
  if (spacingMm <= 0) {
    throw new RangeError('sampleRadialFillPoints requires a positive spacingMm.');
  }
  if (!boundingBox) {
    return [];
  }

  const center = boundingBoxCenter(boundingBox);
  const maxRadiusMm = boundingBoxFarthestCornerDistanceMm(boundingBox, center);
  const points = [];

  if (isPointInsidePolygons(center, polygons)) {
    points.push(center);
  }

  for (let radiusMm = spacingMm; radiusMm <= maxRadiusMm; radiusMm += spacingMm) {
    const stepCount = radialStepCount(radiusMm, spacingMm);
    for (let step = 0; step < stepCount; step++) {
      const angleRad = (step / stepCount) * 2 * Math.PI;
      const candidate = new Point2D(
        center.xMm + radiusMm * Math.cos(angleRad),
        center.yMm + radiusMm * Math.sin(angleRad)
      );
      if (isPointInsidePolygons(candidate, polygons)) {
        points.push(candidate);
      }
    }
  }

  return dedupeStonePoints(points, spacingMm * DEDUPE_FRACTION_OF_SPACING);
}

/**
 * Fill one or more polygons with repeated inward contour rings: the outline itself, then rings
 * eroded inward by spacingMm at a time (see src/geometry/ContourRingSampler.js and
 * docs/specifications/RS-1011-FillAlgorithms.md, "Contour Fill"). Holes are preserved with no
 * hole-specific code -- the same even-odd isPointInsidePolygons() every other mode uses defines
 * "inside" for the distance transform too, so a hole's interior seeds as "outside" automatically.
 *
 * @param {Point2D[][]} polygons
 * @param {import('../text/VectorPath.js').BoundingBox|null} boundingBox
 * @param {number} spacingMm
 * @returns {Point2D[]}
 */
export function sampleContourFillPoints(polygons, boundingBox, spacingMm) {
  if (spacingMm <= 0) {
    throw new RangeError('sampleContourFillPoints requires a positive spacingMm.');
  }
  if (!boundingBox) {
    return [];
  }

  // Appended one-by-one (not `points.push(...bigArray)`): spreading a very large sample array as
  // call arguments overflows the JS call stack -- the same hazard GeometryEngine.generateSvgLayout()
  // already documents and avoids, reachable here too because a shape's placement size and a fine
  // stone pitch are independent of each other.
  const points = [];
  for (const polygon of polygons) {
    for (const point of sampleOutlinePoints(polygon, spacingMm, { closed: true })) points.push(point);
  }

  const insideAt = (xMm, yMm) => isPointInsidePolygons(new Point2D(xMm, yMm), polygons);
  const rings = computeInwardRingPolygons({ insideAt, boundingBox, spacingMm, startOffsetMm: spacingMm });
  for (const ring of rings) {
    const ringPolygon = ring.map((p) => new Point2D(p.xMm, p.yMm));
    for (const point of sampleOutlinePoints(ringPolygon, spacingMm, { closed: true })) points.push(point);
  }

  return dedupeStonePoints(points, spacingMm * DEDUPE_FRACTION_OF_SPACING);
}

/**
 * Dispatch to the vector sampler for a given fill mode -- the one place every
 * generate*Layout() method in GeometryEngine.js asks "given this mode, these polygons, this
 * spacing, which points survive", replacing what was previously four near-identical
 * `mode === 'fill' ? sampleFillPoints(...) : sampleOutlinePoints(...)` ternaries (see
 * docs/specifications/RS-1011-FillAlgorithms.md, "GeometryEngine dispatch").
 *
 * @param {'outline'|'fill'|'staggered'|'radial'|'contour'} mode
 * @param {Point2D[][]} polygons
 * @param {import('../text/VectorPath.js').BoundingBox|null} boundingBox
 * @param {number} spacingMm
 * @param {number} [stoneSizeMm] RC-002: outline mode's cross-contour overlap floor (see
 *   sampleMultiContourOutlinePoints()). Only 'outline' reads this; every other mode ignores it.
 *   Defaults to spacingMm (the pre-RC-002 floor) when omitted, so callers that only care about
 *   fill/staggered/radial/contour modes need not pass it.
 * @param {boolean} [closed] RS-3011: whether `polygons` form closed loops. Only 'outline' reads
 *   this; every other mode's contours are always closed by construction. Defaults to true, so
 *   every pre-existing caller (Rect/Ellipse/Slot/Polygon, text, SVG's fill-mode branch) is
 *   unaffected -- only generatePathLayout() passes an explicit value.
 * @param {(boolean[]|null)[]} [cornerFlagsByContour] Corner-anchored per-side spacing (see
 *   sampleMultiContourOutlinePoints()). Only 'outline' reads this; every other mode ignores it.
 *   Defaults to null (every contour uses the existing whole-loop uniform walk), so every
 *   pre-existing caller is unaffected -- only generateShapeLayout()'s Rect/Regular
 *   Polygon/Star/Arrow/Cross path passes an explicit value.
 * @returns {Point2D[]}
 */
export function sampleShapeFillPoints(mode, polygons, boundingBox, spacingMm, stoneSizeMm = spacingMm, closed = true, cornerFlagsByContour = null) {
  switch (mode) {
    case 'fill': return sampleFillPoints(polygons, boundingBox, spacingMm);
    case 'staggered': return sampleStaggeredFillPoints(polygons, boundingBox, spacingMm);
    case 'radial': return sampleRadialFillPoints(polygons, boundingBox, spacingMm);
    case 'contour': return sampleContourFillPoints(polygons, boundingBox, spacingMm);
    case 'outline':
    default:
      return sampleMultiContourOutlinePoints(polygons, spacingMm, { closed, minSeparationMm: stoneSizeMm, cornerFlagsByContour });
  }
}

// Density field "on" (RS-1008A): a field value at/above this level counts as foreground for
// sampleFieldFillPoints(), the same 0-255 density scale Blur.js/Threshold.js already use
// (thresholded/uninverted 0/1 masks rescale to 0/255, so 128 is the natural midpoint cutoff).
const FIELD_ON_THRESHOLD = 128;

/**
 * Fill a placement box with a regular grid of points spaced spacingMm apart, keeping only points
 * whose corresponding pixel in a raster density field (RS-1008 Image Trace: grayscale -> threshold
 * -> optional invert -> optional blur -> optional resize) is at/above FIELD_ON_THRESHOLD.
 *
 * This is the raster analogue of sampleFillPoints() above: "inside a polygon" (even-odd point-in-
 * polygon test) becomes "at/above the field's density threshold" (nearest-pixel field lookup), but
 * the grid-walk-and-keep-if-on shape is otherwise identical. It lives here (not in src/image/**)
 * so every stone-sampling algorithm — vector outline, vector fill, and now raster fill — has
 * exactly one home, per docs/ARCHITECTURE.md's single-source-of-truth principle; src/image/**
 * prepares the neutral field input, GeometryEngine.generateImageLayout() is the only caller of
 * this function, matching how it is the only caller of sampleFillPoints()/sampleOutlinePoints().
 *
 * @param {{widthPx: number, heightPx: number, data: Uint8ClampedArray}} field Density field (0-255).
 * @param {object} placement
 * @param {number} placement.xMm Placement top-left X.
 * @param {number} placement.yMm Placement top-left Y.
 * @param {number} placement.widthMm Placement width (must be positive).
 * @param {number} placement.heightMm Placement height (must be positive).
 * @param {number} spacingMm Grid spacing (must be positive).
 * @returns {Point2D[]}
 */
export function sampleFieldFillPoints(field, { xMm, yMm, widthMm, heightMm }, spacingMm) {
  if (spacingMm <= 0) {
    throw new RangeError('sampleFieldFillPoints requires a positive spacingMm.');
  }
  if (widthMm <= 0 || heightMm <= 0) {
    return [];
  }

  const { widthPx, heightPx, data } = field;
  const points = [];

  for (let localYMm = spacingMm / 2; localYMm <= heightMm; localYMm += spacingMm) {
    const pixelY = Math.min(heightPx - 1, Math.max(0, Math.floor((localYMm / heightMm) * heightPx)));
    for (let localXMm = spacingMm / 2; localXMm <= widthMm; localXMm += spacingMm) {
      const pixelX = Math.min(widthPx - 1, Math.max(0, Math.floor((localXMm / widthMm) * widthPx)));
      if (data[pixelY * widthPx + pixelX] >= FIELD_ON_THRESHOLD) {
        points.push(new Point2D(xMm + localXMm, yMm + localYMm));
      }
    }
  }

  return points;
}

function fieldPixelOn(field, localXMm, localYMm, widthMm, heightMm) {
  if (localXMm < 0 || localYMm < 0 || localXMm > widthMm || localYMm > heightMm) {
    return false;
  }
  const pixelX = Math.min(field.widthPx - 1, Math.max(0, Math.floor((localXMm / widthMm) * field.widthPx)));
  const pixelY = Math.min(field.heightPx - 1, Math.max(0, Math.floor((localYMm / heightMm) * field.heightPx)));
  return field.data[pixelY * field.widthPx + pixelX] >= FIELD_ON_THRESHOLD;
}

/**
 * Raster counterpart to sampleStaggeredFillPoints() -- a hexagonal point arrangement over a density
 * field's placement box, keeping only points whose pixel is at/above FIELD_ON_THRESHOLD.
 *
 * @param {{widthPx: number, heightPx: number, data: Uint8ClampedArray}} field
 * @param {object} placement
 * @param {number} placement.xMm
 * @param {number} placement.yMm
 * @param {number} placement.widthMm
 * @param {number} placement.heightMm
 * @param {number} spacingMm
 * @returns {Point2D[]}
 */
export function sampleStaggeredFieldFillPoints(field, { xMm, yMm, widthMm, heightMm }, spacingMm) {
  if (spacingMm <= 0) {
    throw new RangeError('sampleStaggeredFieldFillPoints requires a positive spacingMm.');
  }
  if (widthMm <= 0 || heightMm <= 0) {
    return [];
  }

  const rowSpacingMm = spacingMm * (Math.sqrt(3) / 2);
  const points = [];
  let rowIndex = 0;

  for (let localYMm = spacingMm / 2; localYMm <= heightMm; localYMm += rowSpacingMm, rowIndex++) {
    const rowOffsetMm = (rowIndex % 2 === 1) ? spacingMm / 2 : 0;
    for (let localXMm = spacingMm / 2 + rowOffsetMm; localXMm <= widthMm; localXMm += spacingMm) {
      if (fieldPixelOn(field, localXMm, localYMm, widthMm, heightMm)) {
        points.push(new Point2D(xMm + localXMm, yMm + localYMm));
      }
    }
  }

  return points;
}

/**
 * Raster counterpart to sampleRadialFillPoints() -- concentric rings centered on the placement
 * box's own center, keeping only points whose pixel is at/above FIELD_ON_THRESHOLD.
 *
 * @param {{widthPx: number, heightPx: number, data: Uint8ClampedArray}} field
 * @param {object} placement
 * @param {number} placement.xMm
 * @param {number} placement.yMm
 * @param {number} placement.widthMm
 * @param {number} placement.heightMm
 * @param {number} spacingMm
 * @returns {Point2D[]}
 */
export function sampleRadialFieldFillPoints(field, { xMm, yMm, widthMm, heightMm }, spacingMm) {
  if (spacingMm <= 0) {
    throw new RangeError('sampleRadialFieldFillPoints requires a positive spacingMm.');
  }
  if (widthMm <= 0 || heightMm <= 0) {
    return [];
  }

  const centerLocalXMm = widthMm / 2;
  const centerLocalYMm = heightMm / 2;
  const maxRadiusMm = Math.hypot(widthMm / 2, heightMm / 2);
  const points = [];

  if (fieldPixelOn(field, centerLocalXMm, centerLocalYMm, widthMm, heightMm)) {
    points.push(new Point2D(xMm + centerLocalXMm, yMm + centerLocalYMm));
  }

  for (let radiusMm = spacingMm; radiusMm <= maxRadiusMm; radiusMm += spacingMm) {
    const stepCount = radialStepCount(radiusMm, spacingMm);
    for (let step = 0; step < stepCount; step++) {
      const angleRad = (step / stepCount) * 2 * Math.PI;
      const localXMm = centerLocalXMm + radiusMm * Math.cos(angleRad);
      const localYMm = centerLocalYMm + radiusMm * Math.sin(angleRad);
      if (fieldPixelOn(field, localXMm, localYMm, widthMm, heightMm)) {
        points.push(new Point2D(xMm + localXMm, yMm + localYMm));
      }
    }
  }

  return dedupeStonePoints(points, spacingMm * DEDUPE_FRACTION_OF_SPACING);
}

/**
 * Raster counterpart to sampleContourFillPoints() -- repeated inward contour rings traced directly
 * from the density field's own pixel mask (no polygon rasterization step needed, unlike the vector
 * case: a raster field already is a grid). There is no true vector perimeter to reuse for a "ring 0"
 * the way the vector sampler reuses sampleOutlinePoints() on the original polygons, so the first
 * ring here sits at spacingMm/2 in from the edge -- the same "start half a pitch in" convention
 * sampleFieldFillPoints()/sampleStaggeredFieldFillPoints() already use for their own first row.
 *
 * @param {{widthPx: number, heightPx: number, data: Uint8ClampedArray}} field
 * @param {object} placement
 * @param {number} placement.xMm
 * @param {number} placement.yMm
 * @param {number} placement.widthMm
 * @param {number} placement.heightMm
 * @param {number} spacingMm
 * @returns {Point2D[]}
 */
export function sampleContourFieldFillPoints(field, { xMm, yMm, widthMm, heightMm }, spacingMm) {
  if (spacingMm <= 0) {
    throw new RangeError('sampleContourFieldFillPoints requires a positive spacingMm.');
  }
  if (widthMm <= 0 || heightMm <= 0) {
    return [];
  }

  const insideAt = (localXMm, localYMm) => fieldPixelOn(field, localXMm, localYMm, widthMm, heightMm);
  const boundingBox = { minXmm: 0, minYmm: 0, maxXmm: widthMm, maxYmm: heightMm };
  const rings = computeInwardRingPolygons({ insideAt, boundingBox, spacingMm, startOffsetMm: spacingMm / 2 });

  // One-by-one, not spread -- see sampleContourFillPoints()'s identical safeguard above.
  const points = [];
  for (const ring of rings) {
    const placedRing = ring.map((p) => new Point2D(xMm + p.xMm, yMm + p.yMm));
    for (const point of sampleOutlinePoints(placedRing, spacingMm, { closed: true })) points.push(point);
  }

  return dedupeStonePoints(points, spacingMm * DEDUPE_FRACTION_OF_SPACING);
}

/**
 * Dispatch to the raster sampler for a given fill mode -- the field-based counterpart to
 * sampleShapeFillPoints(), used by GeometryEngine.generateImageLayout(). There is no 'outline' case
 * (a raster density field has no vector perimeter to walk); 'fill' is the default, matching
 * generateImageLayout()'s previous, only, always-fill behavior.
 *
 * @param {'fill'|'staggered'|'radial'|'contour'} mode
 * @param {{widthPx: number, heightPx: number, data: Uint8ClampedArray}} field
 * @param {object} placement
 * @param {number} spacingMm
 * @returns {Point2D[]}
 */
export function sampleFieldByMode(mode, field, placement, spacingMm) {
  switch (mode) {
    case 'staggered': return sampleStaggeredFieldFillPoints(field, placement, spacingMm);
    case 'radial': return sampleRadialFieldFillPoints(field, placement, spacingMm);
    case 'contour': return sampleContourFieldFillPoints(field, placement, spacingMm);
    case 'fill':
    default:
      return sampleFieldFillPoints(field, placement, spacingMm);
  }
}
