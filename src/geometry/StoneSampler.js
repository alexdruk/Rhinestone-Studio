/**
 * Stone placement sampling for the Geometry Engine.
 *
 * These functions turn flattened polygons (already millimeters, already
 * positioned) into candidate stone center points for outline or fill
 * placement. They contain no font, rendering, or export concerns.
 */

import { Point2D, BoundingBox } from '../text/VectorPath.js';
import { computeInwardRingPolygons, splitSliverRuns } from './ContourRingSampler.js';
import { groupCongruentContours, applyRigidTransform } from './CongruentContours.js';

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
 * PERF-006: a grid fill (sampleFillPoints() and the other fill-mode loops in this file) calls this
 * once per candidate point against the *same* `polygons` array every time -- for a large/dense fill
 * of a multi-contour shape (many characters, or a shape assembled from many parts), that's grid
 * points times total vertices across every contour, most of which can never match (a candidate far
 * to the side of one letter's contour still ran that letter's whole ray-cast loop before this fix --
 * this matters more in X than Y for text specifically, since the glyphs in one line of text mostly
 * share a Y range but are spread out horizontally). Each contour's bounding box is cheap to
 * precompute once and cache by the `polygons` array's own identity (a WeakMap self-invalidates once
 * that array is no longer referenced, and this pipeline never mutates a polygon's points in place
 * after construction -- see Point2D's own translate()/scale(), which return new instances -- so
 * caching by reference is safe: the same array reference always holds the same coordinates for as
 * long as it's reachable). A point outside a contour's bounding box cannot cross any of that
 * contour's edges under the ray-cast test below, so skipping it can never change the even-odd
 * result -- this is a pure reject, not an approximation.
 *
 * @param {Point2D} point
 * @param {Point2D[][]} polygons
 * @returns {boolean}
 */
const polygonBoundsCache = new WeakMap(); // polygons (Point2D[][]) -> {minX, maxX, minY, maxY}[], same order/length as polygons
function getPolygonBounds(polygons) {
  let bounds = polygonBoundsCache.get(polygons);
  if (bounds) return bounds;
  bounds = polygons.map((polygon) => {
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const v of polygon) {
      if (v.xMm < minX) minX = v.xMm;
      if (v.xMm > maxX) maxX = v.xMm;
      if (v.yMm < minY) minY = v.yMm;
      if (v.yMm > maxY) maxY = v.yMm;
    }
    return { minX, maxX, minY, maxY };
  });
  polygonBoundsCache.set(polygons, bounds);
  return bounds;
}
export function isPointInsidePolygons(point, polygons) {
  let inside = false;
  const bounds = getPolygonBounds(polygons);
  for (let i = 0; i < polygons.length; i++) {
    const b = bounds[i];
    if (point.xMm < b.minX || point.xMm > b.maxX || point.yMm < b.minY || point.yMm > b.maxY) continue; // pure reject, see doc comment above
    if (isPointInsidePolygon(point, polygons[i])) {
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
 * READ-002 Part A: group a flat contour list into connected components by even-odd nesting.
 *
 * Returns `Point2D[][][]` -- an array of components, each an array of contours: one outer contour
 * followed by its holes, exactly the `[outer, ...holes]` shape sampleContourFillPoints() /
 * isPointInsidePolygons() already expect for one glyph or one shape part.
 *
 * The unit is a **connected component by even-odd nesting**, deliberately NOT a character:
 *
 *  - An `i`'s dot and its stem become separate components, so each gets its own radial anchor -- a
 *    per-character anchor would sit in the empty space between the two.
 *  - An `a`'s counter stays a hole of its outer contour, so the even-odd `isPointInsidePolygons()`
 *    semantics are preserved with no hole-specific code, exactly as sampleContourFillPoints()
 *    already relies on.
 *  - Grouping is derivable from the polygons already passed in, so this change stays entirely
 *    inside StoneSampler.js. A true per-character unit would need glyph identity threaded from
 *    GeometryEngine._buildLineContours() through _textPolygons() into the sampler, and would fix
 *    text only.
 *  - It generalises to SVG imports and multi-part shape layers at no extra cost.
 *
 * Algorithm:
 *  1. Compute each contour's bounding box once.
 *  2. `depth[i]` = the number of contours `j !== i` whose bounding box contains contour `i`'s
 *     bounding box AND for which `isPointInsidePolygons(polygons[i][0], [polygons[j]])` is true. The
 *     bounding-box test is a prefilter only; the point test decides.
 *  3. Even `depth` is an outer and starts a component. Components are emitted in ascending order of
 *     their outer contour's index in `polygons`, so the output is deterministic.
 *  4. Odd `depth` is a hole, attached to the containing even-depth contour with the smallest
 *     bounding-box area. An odd-depth contour with no containing outer (should not occur; defensive)
 *     becomes its own component rather than being dropped.
 *
 * @param {Point2D[][]} polygons
 * @returns {Point2D[][][]}
 */
export function groupPolygonsIntoComponents(polygons) {
  const n = polygons.length;
  if (n === 0) return [];

  const bounds = polygons.map((polygon) => {
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const v of polygon) {
      if (v.xMm < minX) minX = v.xMm;
      if (v.xMm > maxX) maxX = v.xMm;
      if (v.yMm < minY) minY = v.yMm;
      if (v.yMm > maxY) maxY = v.yMm;
    }
    return { minX, maxX, minY, maxY, areaMm2: Math.max(0, maxX - minX) * Math.max(0, maxY - minY) };
  });

  const bboxContains = (outer, inner) =>
    outer.minX <= inner.minX && outer.maxX >= inner.maxX &&
    outer.minY <= inner.minY && outer.maxY >= inner.maxY;

  // containers[i] = indices j !== i that geometrically contain contour i (bbox prefilter, then the
  // deciding point-in-polygon test).
  const containers = polygons.map((polygon, i) => {
    const inside = [];
    if (polygon.length > 0) {
      for (let j = 0; j < n; j++) {
        if (j === i) continue;
        if (!bboxContains(bounds[j], bounds[i])) continue;
        if (isPointInsidePolygons(polygon[0], [polygons[j]])) inside.push(j);
      }
    }
    return inside;
  });

  const depth = containers.map((c) => c.length);
  const isOuter = depth.map((d) => d % 2 === 0);

  const components = [];
  const componentByOuterIndex = new Map();
  for (let i = 0; i < n; i++) {
    if (!isOuter[i]) continue;
    const contours = [polygons[i]];
    components.push(contours);
    componentByOuterIndex.set(i, contours);
  }

  for (let i = 0; i < n; i++) {
    if (isOuter[i]) continue;
    let bestOuter = -1;
    let bestAreaMm2 = Infinity;
    for (const j of containers[i]) {
      if (!isOuter[j]) continue;
      if (bounds[j].areaMm2 < bestAreaMm2) {
        bestAreaMm2 = bounds[j].areaMm2;
        bestOuter = j;
      }
    }
    if (bestOuter === -1) {
      components.push([polygons[i]]); // defensive: an odd-depth contour with no containing outer
    } else {
      componentByOuterIndex.get(bestOuter).push(polygons[i]);
    }
  }

  return components;
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
            const pairKey = [stone.layerId, other.layerId].sort().join('\x00');
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
 * @returns {{points: Point2D[], arcLengthsMm: number[], isCorner: boolean[], perimeterMm: number}}
 *   `arcLengthsMm` is each returned point's true arc-length position along the contour (parallel to
 *   `points`), used by sampleMultiContourOutlinePoints()'s corner-gap backfill in place of the
 *   whole-loop walk's `index * uniformStepMm(...)` shortcut, which does not hold once side spacing
 *   varies per side. `isCorner` (bugfix: corner-anchoring dedup protection) flags which returned
 *   points are the corner-vertex-anchored ones (always the `step === 0` sample of a side, plus the
 *   final wrap-implicit corner on an open contour) versus ordinary in-between side samples -- used
 *   by sampleMultiContourOutlinePointsWithCornerProtection() to protect corners from the general
 *   dedup pass.
 */
function sampleCornerAnchoredOutlinePoints(polygon, cornerFlags, spacingMm, { closed = true } = {}) {
  if (spacingMm <= 0) {
    throw new RangeError('sampleCornerAnchoredOutlinePoints requires a positive spacingMm.');
  }
  if (polygon.length < 2) {
    return { points: [], arcLengthsMm: [], isCorner: [], perimeterMm: 0 };
  }

  const contourGeom = contourPerimeterAndSegments(polygon, closed);
  const { perimeterMm } = contourGeom;
  if (perimeterMm <= 0) {
    return { points: [], arcLengthsMm: [], isCorner: [], perimeterMm };
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
  const isCorner = [];
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
      isCorner.push(step === 0);
    }
  }

  if (!closed) {
    // Open contours have no wraparound side to place the final corner implicitly.
    const lastVertexIdx = cornerVertexIndices[cornerCount - 1];
    points.push(polygon[lastVertexIdx]);
    arcLengthsMm.push(vertexArcLengthMm[lastVertexIdx]);
    isCorner.push(true);
  }

  return { points, arcLengthsMm, isCorner, perimeterMm };
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
 * Bugfix (corner-anchoring dedup protection): when at least one contour is corner-anchored, this
 * dispatches to sampleMultiContourOutlinePointsWithCornerProtection() instead of running the plain
 * dedup below directly -- see that function's own doc comment. A shape with no corner-anchored
 * contour at all takes the exact code path below, completely unchanged.
 *
 * RS-congruent-outline (congruent-contour replication): before any per-contour sampling, geometrically
 * identical closed contours (CongruentContours.js's groupCongruentContours() -- translated, rotated,
 * or mirrored copies of one shape, e.g. an imported SVG's ring of ~5mm octagons) are grouped. Only
 * each group's own representative is actually sampled (through whichever path it would normally take,
 * corner-anchored or uniform); every other member's raw sample is produced by applying the recovered
 * rigid transform to the representative's already-sampled points, with arcLengthsMm/isCorner copied
 * unchanged (arc length is invariant under a rigid transform). This is what makes stone count and
 * phase identical across congruent copies -- they are, after this point, literally the same sampling
 * result restated in each copy's own frame, rather than N independent samplings each exposed to their
 * own sub-mm float noise. Everything below this point (cross-contour dedupe, corner protection,
 * backfill) runs completely unchanged on the resulting per-contour sample list; a layer where every
 * contour is unique (no group of size 2+) never enters this branch at all and takes the exact
 * pre-existing per-contour independent-sampling path.
 *
 * @param {Point2D[][]} polygons
 * @param {number} spacingMm
 * @param {{closed?: boolean, minSeparationMm?: number, cornerFlagsByContour?: (boolean[]|null)[]}} [options]
 * @param {{rawSampleCount: number, keptCount: number}} [stats] Layout-quality metrics (Prompt 3):
 *   when provided, filled in-place with the total raw sample count across every contour (before any
 *   dedup/backfill) and the final returned point count. Omitted by every pre-existing call site, so
 *   behavior is unchanged when absent.
 * @returns {Point2D[]}
 */
export function sampleMultiContourOutlinePoints(polygons, spacingMm, { closed = true, minSeparationMm = spacingMm, cornerFlagsByContour = null } = {}, stats = null) {
  const sampleContourIndependently = (polygon, c) => {
    const cornerFlags = cornerFlagsByContour ? cornerFlagsByContour[c] : null;
    if (cornerFlags) {
      const sampled = sampleCornerAnchoredOutlinePoints(polygon, cornerFlags, spacingMm, { closed });
      return { points: sampled.points, arcLengthsMm: sampled.arcLengthsMm, isCorner: sampled.isCorner, perimeterMm: sampled.perimeterMm };
    }
    return { points: sampleOutlinePoints(polygon, spacingMm, { closed, uniform: true }), arcLengthsMm: null, isCorner: null, perimeterMm: null };
  };

  const congruentGroups = closed && polygons.length >= 2 ? groupCongruentContours(polygons, { closed }) : null;
  const hasCongruentGroups = Boolean(congruentGroups) && congruentGroups.some((group) => group.indices.length >= 2);

  let contourSamples;
  if (hasCongruentGroups) {
    contourSamples = new Array(polygons.length);
    for (const group of congruentGroups) {
      const repIndex = group.representativeIndex;
      const repSample = sampleContourIndependently(polygons[repIndex], repIndex);
      contourSamples[repIndex] = repSample;
      for (const memberIndex of group.indices) {
        if (memberIndex === repIndex) continue;
        const transform = group.transforms[memberIndex];
        contourSamples[memberIndex] = {
          points: repSample.points.map((point) => applyRigidTransform(transform, point)),
          arcLengthsMm: repSample.arcLengthsMm,
          isCorner: repSample.isCorner,
          perimeterMm: repSample.perimeterMm
        };
      }
    }
  } else {
    contourSamples = polygons.map(sampleContourIndependently);
  }

  if (stats) {
    stats.rawSampleCount = contourSamples.reduce((sum, sample) => sum + sample.points.length, 0);
  }

  if (contourSamples.some((sample) => sample.isCorner !== null)) {
    const result = sampleMultiContourOutlinePointsWithCornerProtection(polygons, contourSamples, spacingMm, closed, minSeparationMm);
    if (stats) stats.keptCount = result.length;
    return result;
  }

  const contourRawPoints = contourSamples.map((sample) => sample.points);
  const points = contourRawPoints.flat();
  const kept = dedupeStonePoints(points, minSeparationMm);

  if (kept.length === points.length) {
    if (stats) stats.keptCount = kept.length;
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

  if (stats) stats.keptCount = result.length;
  return result;
}

/**
 * Bugfix (corner-anchoring dedup protection): union-find clustering of a single contour's own
 * corner points by straight-line distance, so two (or more) corners sitting closer to each other
 * than `minSeparationMm` -- most commonly two corners flanking a side shorter than one stone's own
 * diameter -- resolve into ONE connected group instead of being left for the general dedup pass to
 * silently drop one of them. Deliberately scoped to one contour's own corner records: "two corners
 * flanking a short side" is inherently a same-contour concept (a side only exists within one
 * contour), and every shape kind that currently carries cornerFlags (Rect, Regular Polygon, Star,
 * Arrow, Cross) is a single, hole-free contour, so no cross-contour corner conflict is reachable
 * through today's wiring.
 *
 * @param {{point: Point2D}[]} cornerRecords
 * @param {number} minSeparationMm
 * @returns {number[][]} Groups of indices into `cornerRecords`, each group one connected component
 *   (a lone, non-conflicting corner is its own group of size 1).
 */
function clusterCornersByProximity(cornerRecords, minSeparationMm) {
  const n = cornerRecords.length;
  const parent = Array.from({ length: n }, (_, i) => i);
  const find = (x) => {
    while (parent[x] !== x) {
      parent[x] = parent[parent[x]];
      x = parent[x];
    }
    return x;
  };
  const union = (a, b) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[ra] = rb;
  };

  const minSeparationSqMm = minSeparationMm * minSeparationMm;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const dx = cornerRecords[i].point.xMm - cornerRecords[j].point.xMm;
      const dy = cornerRecords[i].point.yMm - cornerRecords[j].point.yMm;
      if (dx * dx + dy * dy < minSeparationSqMm) union(i, j);
    }
  }

  const groups = new Map();
  for (let i = 0; i < n; i++) {
    const root = find(i);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root).push(i);
  }
  return [...groups.values()];
}

/**
 * Bugfix (corner-anchoring dedup protection): the arc-length position recorded for a merged group
 * of 2+ corners, so contourArcLengthsCache-style backfill span math downstream stays internally
 * consistent even though a merged corner is no longer a single walk-order sample. Uses a circular
 * (unit-vector) mean rather than a plain arithmetic mean so a group straddling the seam of a closed
 * contour (one corner just before arc-length 0 merging with one just after it wraps) doesn't average
 * to the wrong side of the loop.
 */
function circularMeanArcLengthMm(arcLengthsMm, perimeterMm, closed) {
  if (arcLengthsMm.length === 1) return arcLengthsMm[0];
  if (!closed || !(perimeterMm > 0)) {
    return arcLengthsMm.reduce((sum, sMm) => sum + sMm, 0) / arcLengthsMm.length;
  }
  let sumX = 0;
  let sumY = 0;
  for (const sMm of arcLengthsMm) {
    const thetaRad = (sMm / perimeterMm) * 2 * Math.PI;
    sumX += Math.cos(thetaRad);
    sumY += Math.sin(thetaRad);
  }
  const meanThetaRad = Math.atan2(sumY, sumX);
  const meanMm = (meanThetaRad / (2 * Math.PI)) * perimeterMm;
  return ((meanMm % perimeterMm) + perimeterMm) % perimeterMm;
}

/**
 * Bugfix (corner-anchoring dedup protection): sampleMultiContourOutlinePoints()'s plain dedup path
 * above treats every raw sample as equally disposable, including points anchored exactly on a
 * corner-anchored contour's own corners -- so a sufficiently tight shape (e.g. a rectangle shorter
 * than one stone's diameter) could lose genuine corners outright, breaking
 * sampleCornerAnchoredOutlinePoints()'s own "a stone at every corner" guarantee. Two real user
 * reports plus direct tracing confirmed this: a 20x5mm Rect at SS30/6.4mm lost its entire bottom
 * edge, including 2 of its 4 corners, because the short 5mm dimension is itself under one stone's
 * diameter.
 *
 * Runs whenever at least one contour is corner-anchored:
 *
 *  1. Per corner-anchored contour, cluster its own corner points by proximity
 *     (clusterCornersByProximity()) and resolve each cluster into one "resolved corner" -- the
 *     original point unchanged for a lone corner, or the cluster's centroid (with a circular-mean
 *     arc length, circularMeanArcLengthMm()) for two or more corners too close to coexist as
 *     separate stones.
 *  2. Seed a proximity index (buildProximityIndex(), the same structure the corner-gap backfill
 *     below already uses) with every resolved corner, THEN test/insert non-corner points one at a
 *     time. Corners are therefore never at risk of being evicted by a non-corner point -- they are
 *     always inserted first and never re-tested -- which is what makes "a corner is never silently
 *     dropped by ordinary dedup" an actual invariant here rather than an incidental side effect of
 *     scan order.
 *  3. Reconstruct the result in original per-contour walk order: each corner cluster contributes its
 *     resolved point exactly once (at its first member's raw position); each surviving non-corner
 *     point is emitted as sampled; each dropped non-corner point goes through the same corner-gap
 *     backfill as the plain path above, with corner neighbors and arc lengths resolved to their
 *     (possibly merged) values.
 *
 * Known, accepted limitation: a resolved-corner centroid can in principle land within
 * `minSeparationMm` of some other untouched corner that neither original member was close enough to
 * individually. Step 2 never re-tests corners against each other once seeded, so such a pair would
 * both survive as two very-close (rather than merged, or one dropped) stones. This is the same
 * "deliberate compromise" tradeoff the corner-merge design already accepts for a genuinely
 * degenerate shape, just one union-find pass short of perfect -- not iterated further here.
 *
 * @param {Point2D[][]} polygons
 * @param {{points: Point2D[], arcLengthsMm: number[]|null, isCorner: boolean[]|null, perimeterMm: number|null}[]} contourSamples
 *   Parallel to `polygons`; `sampleMultiContourOutlinePoints()`'s own already-sampled raw points per
 *   contour, corner-anchored or not.
 * @param {number} spacingMm
 * @param {boolean} closed
 * @param {number} minSeparationMm
 * @returns {Point2D[]}
 */
function sampleMultiContourOutlinePointsWithCornerProtection(polygons, contourSamples, spacingMm, closed, minSeparationMm) {
  // Step 1: resolve each corner-anchored contour's own corner conflicts independently.
  const perContourCornerInfo = contourSamples.map((sample) => {
    if (!sample.isCorner) return null;

    const cornerRecords = [];
    for (let i = 0; i < sample.points.length; i++) {
      if (sample.isCorner[i]) cornerRecords.push({ rawIndex: i, point: sample.points[i], arcLengthMm: sample.arcLengthsMm[i] });
    }

    const clusters = clusterCornersByProximity(cornerRecords, minSeparationMm);
    const resolvedByRawIndex = new Map();
    for (const memberIndices of clusters) {
      const members = memberIndices.map((idx) => cornerRecords[idx]);
      const canonicalRawIndex = Math.min(...members.map((m) => m.rawIndex));
      const resolvedPoint = members.length === 1
        ? members[0].point
        : new Point2D(
          members.reduce((sum, m) => sum + m.point.xMm, 0) / members.length,
          members.reduce((sum, m) => sum + m.point.yMm, 0) / members.length
        );
      const resolvedArcLengthMm = members.length === 1
        ? members[0].arcLengthMm
        : circularMeanArcLengthMm(members.map((m) => m.arcLengthMm), sample.perimeterMm, closed);

      for (const member of members) {
        resolvedByRawIndex.set(member.rawIndex, { point: resolvedPoint, arcLengthMm: resolvedArcLengthMm, canonicalRawIndex });
      }
    }
    return resolvedByRawIndex;
  });

  // Step 2: corners-first proximity seeding -- see this function's own doc comment for why this
  // makes corner protection an invariant rather than an incidental scan-order outcome.
  const resolvedCornerPoints = [];
  for (let c = 0; c < contourSamples.length; c++) {
    const sample = contourSamples[c];
    if (!sample.isCorner) continue;
    const cornerInfo = perContourCornerInfo[c];
    const emitted = new Set();
    for (let i = 0; i < sample.points.length; i++) {
      if (!sample.isCorner[i]) continue;
      const info = cornerInfo.get(i);
      if (emitted.has(info.canonicalRawIndex)) continue;
      emitted.add(info.canonicalRawIndex);
      resolvedCornerPoints.push(info.point);
    }
  }

  const index = buildProximityIndex(resolvedCornerPoints, minSeparationMm);
  const keptNonCorners = [];
  for (let c = 0; c < contourSamples.length; c++) {
    const sample = contourSamples[c];
    for (let i = 0; i < sample.points.length; i++) {
      if (sample.isCorner && sample.isCorner[i]) continue;
      const point = sample.points[i];
      if (index.hasConflict(point)) continue;
      index.insert(point);
      keptNonCorners.push(point);
    }
  }
  const keptSet = new Set([...resolvedCornerPoints, ...keptNonCorners]);

  // Step 3: reconstruct in original per-contour walk order, backfilling dropped non-corner gaps
  // exactly as the plain path above does.
  const result = [];
  for (let c = 0; c < polygons.length; c++) {
    const sample = contourSamples[c];
    const cornerInfo = perContourCornerInfo[c];
    const rawPoints = sample.points;
    const n = rawPoints.length;
    const contourGeomCache = contourPerimeterAndSegments(polygons[c], closed);
    const emitted = new Set();

    const isRawIndexCorner = (idx) => Boolean(sample.isCorner && sample.isCorner[idx]);
    const isRawIndexKept = (idx) => isRawIndexCorner(idx) || keptSet.has(rawPoints[idx]);
    const rawIndexPoint = (idx) => isRawIndexCorner(idx) ? cornerInfo.get(idx).point : rawPoints[idx];
    const rawIndexArcLengthMm = (idx) => isRawIndexCorner(idx)
      ? cornerInfo.get(idx).arcLengthMm
      : (sample.arcLengthsMm ? sample.arcLengthsMm[idx] : idx * uniformStepMm(contourGeomCache.perimeterMm, spacingMm));

    for (let i = 0; i < n; i++) {
      if (isRawIndexCorner(i)) {
        const info = cornerInfo.get(i);
        if (emitted.has(info.canonicalRawIndex)) continue;
        emitted.add(info.canonicalRawIndex);
        result.push(info.point);
        continue;
      }

      const point = rawPoints[i];
      if (keptSet.has(point)) {
        result.push(point);
        continue;
      }

      let prevSteps = 0;
      let nextSteps = 0;
      for (let step = 1; step <= n; step++) {
        const idx = closed ? ((i - step) % n + n) % n : i - step;
        if (idx < 0) break;
        if (isRawIndexKept(idx)) { prevSteps = step; break; }
      }
      for (let step = 1; step <= n; step++) {
        const idx = closed ? (i + step) % n : i + step;
        if (idx >= n) break;
        if (isRawIndexKept(idx)) { nextSteps = step; break; }
      }

      if (prevSteps === 0 || nextSteps === 0) continue;

      const prevIdx = closed ? ((i - prevSteps) % n + n) % n : i - prevSteps;
      const nextIdx = closed ? (i + nextSteps) % n : i + nextSteps;
      const prevPoint = rawIndexPoint(prevIdx);
      const nextPoint = rawIndexPoint(nextIdx);

      const flankGapMm = Math.hypot(prevPoint.xMm - nextPoint.xMm, prevPoint.yMm - nextPoint.yMm);
      if (flankGapMm <= spacingMm) continue;

      const { perimeterMm } = contourGeomCache;
      const fromArcLengthMm = rawIndexArcLengthMm(prevIdx);
      const toArcLengthMm = rawIndexArcLengthMm(nextIdx);
      const spanMm = closed
        ? (((toArcLengthMm - fromArcLengthMm) % perimeterMm) + perimeterMm) % perimeterMm
        : toArcLengthMm - fromArcLengthMm;
      const candidate = findEquidistantBackfillPoint(
        contourGeomCache, closed, prevPoint, nextPoint, fromArcLengthMm, spanMm, minSeparationMm
      );

      if (!candidate) continue;
      if (index.hasConflict(candidate)) continue;

      index.insert(candidate);
      result.push(candidate);
    }
  }

  return result;
}

// READ-001: dedupeStonePoints()'s minimum-distance floor for Contour/Radial Fill. The physical
// constraint is literal stone-on-stone overlap -- the sum of two same-size stones' radii, i.e.
// stoneSizeMm -- not the gap-inclusive pitch. Both samplers take an optional `stoneSizeMm`
// (defaulting to `spacingMm`, the pre-READ-001 full-pitch floor) and pass it straight through as
// this floor. Flooring at the full pitch culled sub-pitch rings wholesale where contour branches
// converge on an elongated region (see docs/specifications/READ-001-ContourCentreline.md); this
// mirrors sampleMultiContourOutlinePoints()'s RC-002 move to the same stoneSizeMm floor.

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
//
// READ-002 Part C: floor with a small absolute epsilon. At `r === spacingMm` the half-chord ratio is
// exactly 0.5 and the exact answer is exactly 6, because `2r*sin(pi/6) = r = spacingMm`. But
// `Math.asin(0.5)` rounds a half-ulp above `pi/6`, so `Math.PI / Math.asin(0.5)` evaluates to
// `5.999999999999999` and a bare floor returns 5 -- a 3.527mm chord where 3.000mm was intended,
// 17.6% over-spaced, on the innermost ring of every radial field ever produced. k = 2..20 were
// checked and are unchanged by the `+ 1e-9` epsilon; the worst-case chord shortfall it can
// introduce is ~1e-9 relative, far below any physical tolerance.
export function radialStepCount(radiusMm, spacingMm) {
  const halfChordRatio = Math.min(1, spacingMm / (2 * radiusMm));
  return Math.max(1, Math.floor(Math.PI / Math.asin(halfChordRatio) + 1e-9));
}

// READ-002 Part B: the raw concentric-ring candidate points (center first, then each ring's
// arc-length-even points) for one anchor. No point-in-polygon filtering or dedupe here -- callers
// apply those. Factored out of sampleRadialFillPoints() so the single-component path stays
// byte-identical to the pre-READ-002 code while the multi-component path reuses the identical ring
// geometry per component.
function radialCandidatePoints(center, maxRadiusMm, spacingMm) {
  const points = [center];
  for (let radiusMm = spacingMm; radiusMm <= maxRadiusMm; radiusMm += spacingMm) {
    const stepCount = radialStepCount(radiusMm, spacingMm);
    for (let step = 0; step < stepCount; step++) {
      const angleRad = (step / stepCount) * 2 * Math.PI;
      points.push(new Point2D(
        center.xMm + radiusMm * Math.cos(angleRad),
        center.yMm + radiusMm * Math.sin(angleRad)
      ));
    }
  }
  return points;
}

/**
 * Fill the interior of one or more polygons with concentric rings of points spaced radially and
 * along each ring's own arc-length by spacingMm (see docs/specifications/RS-1011-FillAlgorithms.md,
 * "Radial Fill", and docs/specifications/READ-002-RadialPerGlyph.md). One stone sits at each
 * anchor when the anchor itself is inside the shape.
 *
 * READ-002 Part B: the pattern's scale is set by distance from the anchor, so a single whole-layout
 * anchor makes a multi-part shape (an eight-letter word, an SVG with disjoint pieces) render as a
 * bullseye at its middle and as near-straight rows at its edges -- one mode, two behaviours in one
 * layout. So the contours are grouped into connected components (groupPolygonsIntoComponents()) and
 * each component rays out from its own bounding-box centre.
 *
 *  - Exactly one component: the `boundingBox` argument is used exactly as before READ-002 and the
 *    original code path runs unchanged. This guarantees every existing single-component caller
 *    (Circle, Rectangle, Slot, Polygon, single-glyph text, a one-piece SVG) stays byte-identical
 *    (modulo the one extra innermost-ring stone Part C adds).
 *  - Two or more components: each rays out from its own box's centre and farthest-corner radius; a
 *    candidate is kept only if it is inside BOTH its own component AND the global `polygons` set.
 *    The global test preserves today's even-odd `isPointInsidePolygons()` semantics bit-for-bit;
 *    the component test stops one component's rings bleeding into another.
 *
 * The combined candidate set is deduped once via `dedupeStonePoints(points, stoneSizeMm)` -- the
 * READ-001 `stoneSizeMm` floor, unchanged, including across components (no separate cross-component
 * floor). That floor guarantees no pair of stones is ever closer than one stone diameter, same-
 * component or cross-component alike. The *gap* between stones of two different components is NOT
 * guaranteed: per-component anchors are independent, so two adjacent glyphs' facing edge stones can
 * land arbitrarily close, down to zero gap (measured worst case across an 8-font x 10-string x
 * 4-size sweep: 1.0025x the stone diameter). This is the first time Radial Fill produces sub-pitch
 * spacing at all -- a single whole-layout anchor previously made min NN >= spacingMm structurally.
 * Same class as contour's post-READ-001 2.57mm-at-2.5mm neighbour. See
 * docs/specifications/READ-002-RadialPerGlyph.md.
 *
 * `sampleRadialFieldFillPoints()` (image/raster layers) has the same single-anchor defect but needs
 * raster connected-component labelling on a density field -- out of scope, see docs/BACKLOG.md.
 *
 * @param {Point2D[][]} polygons
 * @param {import('../text/VectorPath.js').BoundingBox|null} boundingBox
 * @param {number} spacingMm
 * @param {number} [stoneSizeMm] READ-001: dedupe floor -- see DEDUPE note above. Defaults to spacingMm.
 * @returns {Point2D[]}
 */
export function sampleRadialFillPoints(polygons, boundingBox, spacingMm, stoneSizeMm = spacingMm) {
  if (spacingMm <= 0) {
    throw new RangeError('sampleRadialFillPoints requires a positive spacingMm.');
  }
  if (!boundingBox) {
    return [];
  }

  const components = groupPolygonsIntoComponents(polygons);

  if (components.length <= 1) {
    // Single component (or an empty polygon set): use the caller's boundingBox exactly as today.
    const center = boundingBoxCenter(boundingBox);
    const maxRadiusMm = boundingBoxFarthestCornerDistanceMm(boundingBox, center);
    const points = radialCandidatePoints(center, maxRadiusMm, spacingMm)
      .filter((candidate) => isPointInsidePolygons(candidate, polygons));
    return dedupeStonePoints(points, stoneSizeMm);
  }

  const points = [];
  for (const componentContours of components) {
    const componentBox = BoundingBox.fromPoints(componentContours.flat());
    if (!componentBox) {
      continue;
    }
    const center = boundingBoxCenter(componentBox);
    const maxRadiusMm = boundingBoxFarthestCornerDistanceMm(componentBox, center);
    for (const candidate of radialCandidatePoints(center, maxRadiusMm, spacingMm)) {
      if (isPointInsidePolygons(candidate, componentContours) && isPointInsidePolygons(candidate, polygons)) {
        points.push(candidate);
      }
    }
  }

  return dedupeStonePoints(points, stoneSizeMm);
}

/**
 * Fill one or more polygons with repeated inward contour rings: the outline itself, then rings
 * eroded inward by spacingMm at a time (see src/geometry/ContourRingSampler.js and
 * docs/specifications/RS-1011-FillAlgorithms.md, "Contour Fill"). Holes are preserved with no
 * hole-specific code -- the same even-odd isPointInsidePolygons() every other mode uses defines
 * "inside" for the distance transform too, so a hole's interior seeds as "outside" automatically.
 *
 * READ-001: both the shape's own boundary contour(s) and every traced inward ring are passed
 * through splitSliverRuns() (minSeparationMm = spacingMm) before sampling -- where a loop's opposing
 * branches close up on an elongated region (a letter stroke), that run collapses to a single line
 * of medial-axis points instead of two near-coincident rows that dedupe would then cull in
 * arbitrary walk order. Collapsing the boundary contour is what centres a sub-pitch stroke.
 *
 * @param {Point2D[][]} polygons
 * @param {import('../text/VectorPath.js').BoundingBox|null} boundingBox
 * @param {number} spacingMm
 * @param {number} [stoneSizeMm] READ-001: dedupe floor -- see the DEDUPE note above. Defaults to spacingMm.
 * @returns {Point2D[]}
 */
export function sampleContourFillPoints(polygons, boundingBox, spacingMm, stoneSizeMm = spacingMm) {
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
  const sampleLoopWithCollapse = (loopVertices) => {
    for (const piece of splitSliverRuns(loopVertices, spacingMm)) {
      const piecePolygon = piece.points.map((p) => new Point2D(p.xMm, p.yMm));
      if (piecePolygon.length === 1) {
        points.push(piecePolygon[0]);
        continue;
      }
      for (const point of sampleOutlinePoints(piecePolygon, spacingMm, { closed: piece.closed })) points.push(point);
    }
  };

  // Inward rings first: computeInwardRingPolygons() throws ContourFillPrecisionError for a
  // pathological shape/pitch combination, and it must do so before splitSliverRuns() densifies the
  // (possibly huge, coarse) boundary polygon for that same input (READ-001 Finding 2).
  const insideAt = (xMm, yMm) => isPointInsidePolygons(new Point2D(xMm, yMm), polygons);
  const rings = computeInwardRingPolygons({ insideAt, boundingBox, spacingMm, startOffsetMm: spacingMm });

  for (const polygon of polygons) {
    sampleLoopWithCollapse(polygon);
  }
  for (const ring of rings) {
    sampleLoopWithCollapse(ring);
  }

  return dedupeStonePoints(points, stoneSizeMm);
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
 * @param {number} [stoneSizeMm] Physical stone diameter, used as an overlap floor by 'outline'
 *   (RC-002 cross-contour, see sampleMultiContourOutlinePoints()) and, since READ-001, by 'radial'
 *   and 'contour' (their post-sampling dedupeStonePoints() floor -- the physical constraint is
 *   literal stone overlap, not the gap-inclusive pitch). 'fill' and 'staggered' place points on a
 *   grid, never on converging lanes, and ignore it. Defaults to spacingMm (the pre-READ-001 floor)
 *   when omitted.
 * @param {boolean} [closed] RS-3011: whether `polygons` form closed loops. Only 'outline' reads
 *   this; every other mode's contours are always closed by construction. Defaults to true, so
 *   every pre-existing caller (Rect/Ellipse/Slot/Polygon, text, SVG's fill-mode branch) is
 *   unaffected -- only generatePathLayout() passes an explicit value.
 * @param {(boolean[]|null)[]} [cornerFlagsByContour] Corner-anchored per-side spacing (see
 *   sampleMultiContourOutlinePoints()). Only 'outline' reads this; every other mode ignores it.
 *   Defaults to null (every contour uses the existing whole-loop uniform walk), so every
 *   pre-existing caller is unaffected -- only generateShapeLayout()'s Rect/Regular
 *   Polygon/Star/Arrow/Cross path passes an explicit value.
 * @param {{rawSampleCount: number, keptCount: number}} [stats] Layout-quality metrics (Prompt 3):
 *   forwarded to sampleMultiContourOutlinePoints() for 'outline' mode only -- every other mode
 *   ignores it, since attrition is specifically an outline-sampling concept (dedup/backfill over a
 *   contour walk).
 * @returns {Point2D[]}
 */
export function sampleShapeFillPoints(mode, polygons, boundingBox, spacingMm, stoneSizeMm = spacingMm, closed = true, cornerFlagsByContour = null, stats = null) {
  switch (mode) {
    case 'fill': return sampleFillPoints(polygons, boundingBox, spacingMm);
    case 'staggered': return sampleStaggeredFillPoints(polygons, boundingBox, spacingMm);
    case 'radial': return sampleRadialFillPoints(polygons, boundingBox, spacingMm, stoneSizeMm);
    case 'contour': return sampleContourFillPoints(polygons, boundingBox, spacingMm, stoneSizeMm);
    case 'outline':
    default:
      return sampleMultiContourOutlinePoints(polygons, spacingMm, { closed, minSeparationMm: stoneSizeMm, cornerFlagsByContour }, stats);
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
 * @param {number} [stoneSizeMm] READ-001: dedupe floor. Defaults to spacingMm.
 * @returns {Point2D[]}
 */
export function sampleRadialFieldFillPoints(field, { xMm, yMm, widthMm, heightMm }, spacingMm, stoneSizeMm = spacingMm) {
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

  return dedupeStonePoints(points, stoneSizeMm);
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
 * @param {number} [stoneSizeMm] READ-001: dedupe floor -- see the DEDUPE note above. Defaults to spacingMm.
 * @returns {Point2D[]}
 */
export function sampleContourFieldFillPoints(field, { xMm, yMm, widthMm, heightMm }, spacingMm, stoneSizeMm = spacingMm) {
  if (spacingMm <= 0) {
    throw new RangeError('sampleContourFieldFillPoints requires a positive spacingMm.');
  }
  if (widthMm <= 0 || heightMm <= 0) {
    return [];
  }

  const insideAt = (localXMm, localYMm) => fieldPixelOn(field, localXMm, localYMm, widthMm, heightMm);
  const boundingBox = { minXmm: 0, minYmm: 0, maxXmm: widthMm, maxYmm: heightMm };
  const rings = computeInwardRingPolygons({ insideAt, boundingBox, spacingMm, startOffsetMm: spacingMm / 2 });

  // One-by-one, not spread -- see sampleContourFillPoints()'s identical safeguard above. Each ring
  // goes through splitSliverRuns() (READ-001) so a narrow neck in the density mask collapses to its
  // medial axis rather than a doubled row.
  const points = [];
  for (const ring of rings) {
    const placedRing = ring.map((p) => ({ xMm: xMm + p.xMm, yMm: yMm + p.yMm }));
    for (const piece of splitSliverRuns(placedRing, spacingMm)) {
      const piecePolygon = piece.points.map((p) => new Point2D(p.xMm, p.yMm));
      if (piecePolygon.length === 1) {
        points.push(piecePolygon[0]);
        continue;
      }
      for (const point of sampleOutlinePoints(piecePolygon, spacingMm, { closed: piece.closed })) points.push(point);
    }
  }

  return dedupeStonePoints(points, stoneSizeMm);
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
 * @param {number} [stoneSizeMm] READ-001: dedupe floor forwarded to the 'radial' and 'contour'
 *   field samplers (the physical overlap constraint is stoneSizeMm, not the gap-inclusive pitch).
 *   'fill'/'staggered' ignore it. Defaults to spacingMm.
 * @returns {Point2D[]}
 */
export function sampleFieldByMode(mode, field, placement, spacingMm, stoneSizeMm = spacingMm) {
  switch (mode) {
    case 'staggered': return sampleStaggeredFieldFillPoints(field, placement, spacingMm);
    case 'radial': return sampleRadialFieldFillPoints(field, placement, spacingMm, stoneSizeMm);
    case 'contour': return sampleContourFieldFillPoints(field, placement, spacingMm, stoneSizeMm);
    case 'fill':
    default:
      return sampleFieldFillPoints(field, placement, spacingMm);
  }
}
