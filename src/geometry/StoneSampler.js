/**
 * Stone placement sampling for the Geometry Engine.
 *
 * These functions turn flattened polygons (already millimeters, already
 * positioned) into candidate stone center points for outline or fill
 * placement. They contain no font, rendering, or export concerns.
 */

import { Point2D } from '../text/VectorPath.js';

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
