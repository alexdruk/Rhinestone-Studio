/**
 * Stone placement sampling for the Geometry Engine.
 *
 * These functions turn flattened polygons (already millimeters, already
 * positioned) into candidate stone center points for outline or fill
 * placement. They contain no font, rendering, or export concerns.
 */

import { Point2D } from '../text/VectorPath.js';

/**
 * Walk a closed polygon's perimeter and return points spaced spacingMm apart
 * along the outline, starting at the polygon's first vertex.
 *
 * @param {Point2D[]} polygon
 * @param {number} spacingMm
 * @returns {Point2D[]}
 */
export function sampleOutlinePoints(polygon, spacingMm) {
  if (spacingMm <= 0) {
    throw new RangeError('sampleOutlinePoints requires a positive spacingMm.');
  }
  if (polygon.length < 2) {
    return [];
  }

  const closed = [...polygon, polygon[0]];
  const segmentLengthsMm = [];
  let perimeterMm = 0;

  for (let i = 0; i < closed.length - 1; i++) {
    const length = closed[i].distanceTo(closed[i + 1]);
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
    const start = closed[segmentIndex];
    const end = closed[segmentIndex + 1];

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
