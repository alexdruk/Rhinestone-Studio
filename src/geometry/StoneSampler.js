/**
 * Stone placement sampling for the Geometry Engine.
 *
 * These functions turn flattened polygons (already millimeters, already
 * positioned) into candidate stone center points for outline or fill
 * placement. They contain no font, rendering, or export concerns.
 */

import { Point2D } from '../text/VectorPath.js';
import { computeInwardRingPolygons } from './ContourRingSampler.js';

/**
 * Walk a polygon's perimeter and return points spaced spacingMm apart along the outline, starting
 * at the polygon's first vertex. By default the polygon is treated as closed (a final segment
 * connects the last vertex back to the first, matching a filled shape's true outline); pass
 * `{ closed: false }` to walk an open path instead (e.g. an SVG `<line>`/`<polyline>` or an
 * unclosed `<path>` subpath), which omits that wrap-around segment.
 *
 * @param {Point2D[]} polygon
 * @param {number} spacingMm
 * @param {{closed?: boolean}} [options]
 * @returns {Point2D[]}
 */
export function sampleOutlinePoints(polygon, spacingMm, { closed = true } = {}) {
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

  for (let targetMm = 0; targetMm < perimeterMm; targetMm += spacingMm) {
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
 * @returns {Point2D[]}
 */
export function sampleShapeFillPoints(mode, polygons, boundingBox, spacingMm) {
  switch (mode) {
    case 'fill': return sampleFillPoints(polygons, boundingBox, spacingMm);
    case 'staggered': return sampleStaggeredFillPoints(polygons, boundingBox, spacingMm);
    case 'radial': return sampleRadialFillPoints(polygons, boundingBox, spacingMm);
    case 'contour': return sampleContourFillPoints(polygons, boundingBox, spacingMm);
    case 'outline':
    default:
      return polygons.flatMap((polygon) => sampleOutlinePoints(polygon, spacingMm));
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
