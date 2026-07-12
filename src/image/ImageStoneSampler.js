/**
 * Grid-sampling stage of the Image Trace pipeline (RS-1008).
 *
 * Walks a regular millimeter grid across the requested placement box at spacingMm spacing — the
 * same fixed-spacing-grid-over-a-bounding-box shape src/geometry/StoneSampler.js's
 * sampleFillPoints() already uses for vector fill sampling — and keeps a grid point when the
 * processed bitmap is "on" (density >= 128) at that location. This is the raster analogue of
 * sampleFillPoints()'s even-odd polygon containment test: "inside the shape" becomes "at/above the
 * mask threshold". Implemented independently of src/geometry/StoneSampler.js (per this milestone's
 * constraint not to modify src/geometry/**), reusing only the neutral Point2D primitive.
 */

import { Point2D } from '../text/VectorPath.js';

const FIELD_ON_THRESHOLD = 128;

/**
 * @param {{widthPx: number, heightPx: number, data: Uint8ClampedArray}} field Density field (0-255).
 * @param {object} options
 * @param {number} options.xMm Placement top-left X.
 * @param {number} options.yMm Placement top-left Y.
 * @param {number} options.widthMm Placement width (must be positive).
 * @param {number} options.heightMm Placement height (must be positive).
 * @param {number} options.spacingMm Grid spacing (must be positive).
 * @returns {Point2D[]}
 */
export function sampleImageFillPoints(field, { xMm, yMm, widthMm, heightMm, spacingMm }) {
  if (spacingMm <= 0) {
    throw new RangeError('sampleImageFillPoints requires a positive spacingMm.');
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
