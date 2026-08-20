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
  return flattenContourWithCornerFlags(contour, segmentsPerCurve).points;
}

/**
 * Same output as flattenContourToPolygon(), plus a parallel cornerFlags[] (same length/order as
 * the returned points) marking which points are genuine contour corners -- i.e. came from a
 * moveTo/lineTo command -- versus a curve-flattening sample point (quadraticTo/cubicTo), which
 * is never a real corner. Used by outline-mode corner-anchored spacing (StoneSampler.js) for shape
 * kinds where every vertex is known to be a real corner (Rect); kept as a separate export so every
 * pre-existing flattenContourToPolygon() caller is completely unaffected.
 *
 * @param {Contour} contour
 * @param {number} [segmentsPerCurve]
 * @returns {{points: Point2D[], cornerFlags: boolean[]}}
 */
export function flattenContourToPolygonWithCornerFlags(contour, segmentsPerCurve = CURVE_FLATTEN_SEGMENTS) {
  return flattenContourWithCornerFlags(contour, segmentsPerCurve);
}

function flattenContourWithCornerFlags(contour, segmentsPerCurve) {
  if (!(contour instanceof Contour)) {
    throw new TypeError('flattenContourToPolygon requires a Contour.');
  }
  if (!Number.isInteger(segmentsPerCurve) || segmentsPerCurve < 1) {
    throw new RangeError('segmentsPerCurve must be a positive integer.');
  }

  const points = [];
  const cornerFlags = [];
  let current = null;

  for (const command of contour.commands) {
    switch (command.type) {
      case 'moveTo':
      case 'lineTo': {
        current = command.points[0];
        points.push(current);
        cornerFlags.push(true);
        break;
      }
      case 'quadraticTo': {
        const [control, end] = command.points;
        for (let step = 1; step <= segmentsPerCurve; step++) {
          points.push(quadraticPointAt(current, control, end, step / segmentsPerCurve));
          cornerFlags.push(false);
        }
        current = end;
        break;
      }
      case 'cubicTo': {
        const [control1, control2, end] = command.points;
        for (let step = 1; step <= segmentsPerCurve; step++) {
          points.push(cubicPointAt(current, control1, control2, end, step / segmentsPerCurve));
          cornerFlags.push(false);
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

  return { points, cornerFlags };
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

// Corner detection for drawn 'path' layers (Rect/Polygon/Pen/Freehand tools, Boolean-op results),
// feeding Outline mode's corner-anchored per-side spacing (StoneSampler.js's
// sampleCornerAnchoredOutlinePoints()) exactly like flattenContourToPolygonWithCornerFlags() above
// already feeds it for Rect and CORNER_ANCHORED_SHAPE_LIBRARY_KINDS in GeometryEngine.js -- this is
// the detection step for shape kinds with no such known-safe-by-construction corner data.
//
// PATH_CORNER_NOISE_FLOOR_MM: the arc-length window (each side of a vertex) used to measure that
// vertex's incoming/outgoing direction -- see detectPolygonCornerFlags() below. Sub-noise-floor
// freehand jitter cannot produce a false direction change; a genuine corner between two edges longer
// than this still measures its true angle.
const PATH_CORNER_NOISE_FLOOR_MM = 0.5;
// A turn angle at/above this is a corner; below it, the path is considered locally straight (or a
// smooth curve's tessellation, which never approaches this angle within one noise-floor window for
// a curve of non-trivial radius).
const PATH_CORNER_TURN_ANGLE_DEG = 35;
// A closed loop with fewer genuine corners than this has no meaningful "sides" to anchor -- caller
// falls back to the existing whole-loop uniform walk.
const PATH_CORNER_MIN_COUNT = 3;
// Scribble safety valve: a dense zigzag whose segments are individually longer than the noise floor
// measures a genuine large turn angle at nearly every vertex, which would otherwise be misread as a
// many-cornered polygon. The two caps combine (both must be exceeded to reject) rather than either
// alone: a small legitimate polygon (a drawn rectangle or triangle, every vertex a genuine corner)
// has a corner FRACTION of 100% but a corner COUNT far below PATH_CORNER_MAX_COUNT, so it is never
// rejected by this valve; only a contour with both many corners in absolute terms and a high
// concentration of them relative to its own vertex count -- the zigzag/scribble signature -- trips it.
const PATH_CORNER_MAX_COUNT = 16;
const PATH_CORNER_MAX_FRACTION = 0.25;
// Below this, a measured incoming/outgoing direction vector is treated as degenerate (self-touching
// or coincident geometry) rather than fed into an angle calculation that would divide by ~zero.
const MIN_CORNER_DIRECTION_VECTOR_MM = 1e-9;

/**
 * Detect genuine corners in an already-flattened polygon whose vertices carry no known provenance
 * (unlike Rect's moveTo/lineTo commands or a ShapeLibrary kind's by-construction vertices) -- the
 * drawn 'path' layer case: Rect/Polygon/Pen/Freehand tool contours and Boolean-op results, all of
 * which reach GeometryEngine as plain flattened points with no corner metadata.
 *
 * At each vertex, the incoming direction is measured from the polyline point PATH_CORNER_NOISE_FLOOR_MM
 * of accumulated arc length behind the vertex to the vertex itself; the outgoing direction likewise
 * from the vertex to the point that far ahead (arc-length windowed, not vertex-indexed, so it is
 * immune to how finely a curve happens to be tessellated). The vertex is a corner iff the absolute
 * angle between those two directions is at least PATH_CORNER_TURN_ANGLE_DEG.
 *
 * Design provenance: the reference codebase (drawleather) was consulted for this design. Its
 * `handleIn/handleOut.isZero()` Paper.js handle test is a more precise classifier (a curve handle
 * being exactly zero-length is definitive corner evidence) but was rejected here because this engine
 * only ever receives pre-flattened contours -- handle data is unavailable by the time any polygon
 * reaches this function, and flags must also work for Boolean-op-derived contours and legacy saved
 * projects with no draw-time metadata at all. Its freehand `path.simplify()`-before-classify pattern
 * is what this function's arc-length window adapts, WITHOUT mutating the input geometry (the caller's
 * polygon is read only, never simplified/replaced). Whole-path corner scanning with a max-count/
 * max-fraction fallback (PATH_CORNER_MAX_COUNT/PATH_CORNER_MAX_FRACTION) has no drawleather
 * counterpart and is original to this codebase.
 *
 * @param {Point2D[]} polygon
 * @param {{closed?: boolean}} [options]
 * @returns {boolean[]|null} Parallel to `polygon`; null means "no usable corners, caller must fall
 *   back to uniform mode" -- an open contour, a degenerate/too-short contour, too few detected
 *   corners, or too many (the scribble safety valve).
 */
export function detectPolygonCornerFlags(polygon, { closed = true } = {}) {
  // RS-3011 (open freehand strokes): endpoint anchoring for open paths is a separate design question,
  // deferred -- open paths keep today's whole-loop uniform walk exactly as before this function existed.
  if (!closed) return null;

  const n = polygon.length;
  if (n < 3) return null;

  const segLensMm = [];
  let perimeterMm = 0;
  for (let i = 0; i < n; i++) {
    const a = polygon[i];
    const b = polygon[(i + 1) % n];
    const lengthMm = Math.hypot(b.xMm - a.xMm, b.yMm - a.yMm);
    segLensMm.push(lengthMm);
    perimeterMm += lengthMm;
  }

  // The window would swallow the whole contour -- degenerate, no meaningful direction measurement
  // is possible anywhere on it.
  if (perimeterMm <= 2 * PATH_CORNER_NOISE_FLOOR_MM) return null;

  const vertexArcLengthMm = [0];
  for (let i = 0; i < n - 1; i++) vertexArcLengthMm.push(vertexArcLengthMm[i] + segLensMm[i]);

  const pointAtArcLength = (sMmRaw) => {
    const sMm = ((sMmRaw % perimeterMm) + perimeterMm) % perimeterMm;
    let segIndex = 0;
    let segStartMm = 0;
    while (segIndex < segLensMm.length - 1 && segStartMm + segLensMm[segIndex] < sMm) {
      segStartMm += segLensMm[segIndex];
      segIndex++;
    }
    const segLenMm = segLensMm[segIndex];
    // A zero-length segment (duplicate consecutive points) is a pass-through, not a division: it
    // contributes no arc length and is effectively skipped by the walk above.
    const t = segLenMm === 0 ? 0 : (sMm - segStartMm) / segLenMm;
    const a = polygon[segIndex];
    const b = polygon[(segIndex + 1) % n];
    return { xMm: a.xMm + (b.xMm - a.xMm) * t, yMm: a.yMm + (b.yMm - a.yMm) * t };
  };

  const cornerFlags = new Array(n).fill(false);
  let cornerCount = 0;

  for (let i = 0; i < n; i++) {
    const vertex = polygon[i];
    const behind = pointAtArcLength(vertexArcLengthMm[i] - PATH_CORNER_NOISE_FLOOR_MM);
    const ahead = pointAtArcLength(vertexArcLengthMm[i] + PATH_CORNER_NOISE_FLOOR_MM);

    const inDx = vertex.xMm - behind.xMm;
    const inDy = vertex.yMm - behind.yMm;
    const inLenMm = Math.hypot(inDx, inDy);

    const outDx = ahead.xMm - vertex.xMm;
    const outDy = ahead.yMm - vertex.yMm;
    const outLenMm = Math.hypot(outDx, outDy);

    if (inLenMm < MIN_CORNER_DIRECTION_VECTOR_MM || outLenMm < MIN_CORNER_DIRECTION_VECTOR_MM) continue;

    const dot = (inDx / inLenMm) * (outDx / outLenMm) + (inDy / inLenMm) * (outDy / outLenMm);
    const turnAngleDeg = Math.acos(Math.min(1, Math.max(-1, dot))) * 180 / Math.PI;

    if (turnAngleDeg >= PATH_CORNER_TURN_ANGLE_DEG) {
      cornerFlags[i] = true;
      cornerCount++;
    }
  }

  if (cornerCount < PATH_CORNER_MIN_COUNT) return null;
  if (cornerCount > PATH_CORNER_MAX_COUNT && cornerCount > n * PATH_CORNER_MAX_FRACTION) return null;

  return cornerFlags;
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
