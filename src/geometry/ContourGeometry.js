/**
 * Contour geometry helpers for the Geometry Engine.
 *
 * These functions operate only on the neutral VectorPath/Contour shapes
 * exported by src/text. They contain no font parsing, no rendering, and no
 * DOM/Canvas/WebGL access, matching the "Geometry Engine has no renderer
 * dependency" requirement.
 *
 * Units are millimeters unless documented otherwise.
 */

import { Contour, Point2D } from '../text/VectorPath.js';

// Bezier curves are flattened using a fixed subdivision count rather than an
// adaptive tolerance. A fixed count keeps output deterministic for identical
// input regardless of curve length, which downstream stone sampling depends
// on for reproducible manufacturing output.
export const CURVE_FLATTEN_SEGMENTS = 16;

/**
 * Convert a Contour (which may contain bezier curves) into a flat polygon
 * approximation, expressed as an ordered array of Point2D vertices in
 * millimeters. The returned polygon is implicitly closed: callers should
 * treat the last vertex as connected back to the first.
 *
 * @param {Contour} contour
 * @param {number} [segmentsPerCurve]
 * @returns {Point2D[]}
 */
export function flattenContourToPolygon(contour, segmentsPerCurve = CURVE_FLATTEN_SEGMENTS) {
  if (!(contour instanceof Contour)) {
    throw new TypeError('flattenContourToPolygon requires a Contour.');
  }
  if (!Number.isInteger(segmentsPerCurve) || segmentsPerCurve < 1) {
    throw new RangeError('segmentsPerCurve must be a positive integer.');
  }

  const points = [];
  let current = null;

  for (const command of contour.commands) {
    switch (command.type) {
      case 'moveTo':
      case 'lineTo': {
        current = command.points[0];
        points.push(current);
        break;
      }
      case 'quadraticTo': {
        const [control, end] = command.points;
        for (let step = 1; step <= segmentsPerCurve; step++) {
          points.push(quadraticPointAt(current, control, end, step / segmentsPerCurve));
        }
        current = end;
        break;
      }
      case 'cubicTo': {
        const [control1, control2, end] = command.points;
        for (let step = 1; step <= segmentsPerCurve; step++) {
          points.push(cubicPointAt(current, control1, control2, end, step / segmentsPerCurve));
        }
        current = end;
        break;
      }
      case 'closePath':
        break;
      default:
        throw new Error(`Unsupported path command in flattening: ${command.type}`);
    }
  }

  return points;
}

/**
 * Translate every point in a Contour by a fixed offset, returning a new
 * Contour. Used by the Geometry Engine to position each character's glyph
 * contours along the pen line without mutating provider output.
 *
 * @param {Contour} contour
 * @param {number} dxMm
 * @param {number} dyMm
 * @returns {Contour}
 */
export function translateContour(contour, dxMm, dyMm) {
  if (!(contour instanceof Contour)) {
    throw new TypeError('translateContour requires a Contour.');
  }

  const translated = new Contour();

  for (const command of contour.commands) {
    switch (command.type) {
      case 'moveTo': {
        const [point] = command.points;
        translated.moveTo(point.xMm + dxMm, point.yMm + dyMm);
        break;
      }
      case 'lineTo': {
        const [point] = command.points;
        translated.lineTo(point.xMm + dxMm, point.yMm + dyMm);
        break;
      }
      case 'quadraticTo': {
        const [control, end] = command.points;
        translated.quadraticTo(
          control.xMm + dxMm, control.yMm + dyMm,
          end.xMm + dxMm, end.yMm + dyMm
        );
        break;
      }
      case 'cubicTo': {
        const [control1, control2, end] = command.points;
        translated.cubicTo(
          control1.xMm + dxMm, control1.yMm + dyMm,
          control2.xMm + dxMm, control2.yMm + dyMm,
          end.xMm + dxMm, end.yMm + dyMm
        );
        break;
      }
      case 'closePath':
        translated.closePath();
        break;
      default:
        throw new Error(`Unsupported path command in translation: ${command.type}`);
    }
  }

  return translated;
}

function quadraticPointAt(p0, p1, p2, t) {
  const mt = 1 - t;
  return new Point2D(
    mt * mt * p0.xMm + 2 * mt * t * p1.xMm + t * t * p2.xMm,
    mt * mt * p0.yMm + 2 * mt * t * p1.yMm + t * t * p2.yMm
  );
}

function cubicPointAt(p0, p1, p2, p3, t) {
  const mt = 1 - t;
  return new Point2D(
    mt * mt * mt * p0.xMm + 3 * mt * mt * t * p1.xMm + 3 * mt * t * t * p2.xMm + t * t * t * p3.xMm,
    mt * mt * mt * p0.yMm + 3 * mt * mt * t * p1.yMm + 3 * mt * t * t * p2.yMm + t * t * t * p3.yMm
  );
}
