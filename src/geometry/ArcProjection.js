/**
 * Arc projection for curved text (RS-1003).
 *
 * Per docs/specifications/RS-1003-CurvedText.md, this is the "Arc projection" stage of the
 * pipeline:
 *
 *   Text -> OpenTypeProvider -> VectorPath -> GeometryEngine -> Arc projection -> StoneLayout
 *
 * It is a pure, deterministic remap of already-flattened polygon vertices (millimeters, straight
 * pen-line space) onto a circle. It has no dependency on the DOM, Canvas, fonts, or any
 * renderer/exporter, and no knowledge of characters/glyphs/contours — it only ever sees Point2D
 * coordinates, matching the neutral-geometry boundary the rest of src/geometry/** already keeps.
 *
 * Units are millimeters and radians/degrees as documented per field.
 */

import { Point2D } from '../text/VectorPath.js';

export const CURVE_DIRECTIONS = new Set(['outside', 'inside']);
export const CURVE_ALIGNMENTS = new Set(['start', 'center', 'end']);

/**
 * Map one straight pen-line point onto a circular arc.
 *
 * The point's horizontal position (xMm, distance along the straight pen line from the start of
 * the text) determines its angle around the circle, proportionally stretched onto
 * options.sweepAngleDeg (see the specification's "Geometry Model" for why this is a uniform
 * stretch, not the excluded "variable spacing"). The point's vertical offset from the baseline
 * (yMm, negative for ascenders per OpenTypeProvider's convention) determines its effective radius,
 * signed by options.direction.
 *
 * @param {Point2D} point
 * @param {object} options
 * @param {number} options.totalAdvanceWidthMm Full text's straight-line pen advance, in mm.
 * @param {number} options.radiusMm
 * @param {'outside'|'inside'} options.direction
 * @param {number} options.startAngleDeg
 * @param {number} options.sweepAngleDeg
 * @param {'start'|'center'|'end'} options.alignment
 * @returns {Point2D}
 */
export function projectPointToArc(point, options) {
  const { totalAdvanceWidthMm, radiusMm, direction, startAngleDeg, sweepAngleDeg, alignment } = options;

  const startRad = startAngleDeg * Math.PI / 180;
  const sweepRad = sweepAngleDeg * Math.PI / 180;

  let sweepStartRad;
  if (alignment === 'start') {
    sweepStartRad = startRad;
  } else if (alignment === 'end') {
    sweepStartRad = startRad - sweepRad;
  } else {
    sweepStartRad = startRad - sweepRad / 2;
  }

  const t = totalAdvanceWidthMm > 0 ? point.xMm / totalAdvanceWidthMm : 0;
  const angleRad = sweepStartRad + sweepRad * t;

  const v = point.yMm;
  const effectiveRadius = direction === 'inside' ? radiusMm + v : radiusMm - v;

  return new Point2D(
    effectiveRadius * Math.sin(angleRad),
    -effectiveRadius * Math.cos(angleRad)
  );
}

/**
 * Map every vertex of an already-flattened polygon onto the arc. See projectPointToArc() for the
 * per-point rule; applying it to every vertex of a densely-flattened polygon (rather than to
 * bezier control points before flattening) is what makes the glyph outlines themselves visibly
 * bend along the curve, not just slide as rigid unrotated shapes.
 *
 * @param {Point2D[]} polygon
 * @param {object} options Same shape as projectPointToArc()'s options.
 * @returns {Point2D[]}
 */
export function projectPolygonToArc(polygon, options) {
  return polygon.map((point) => projectPointToArc(point, options));
}
