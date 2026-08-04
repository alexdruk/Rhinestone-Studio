/**
 * S-110: Expanded Shape Library — pure natural-coordinate polygon generators.
 *
 * Each `createXNaturalContours()` function below returns one shape as an array of closed contours
 * (`{xMm, yMm}[][]`, one polygon per contour — every shape but Ring has exactly one), expressed in
 * a natural, unscaled coordinate space with its own bounding box's top-left corner rooted at
 * (0, 0). This is deliberately the exact same "natural, (0,0)-rooted contour" contract
 * GeometryEngine.js's generatePathLayout()/_pathPolygons() already defines and consumes (see that
 * file's own doc comment) — GeometryEngine places these contours into a caller-supplied
 * xMm/yMm/widthMm/heightMm box by scaling independently in X and Y, exactly like it already does
 * for Boolean Operation results and SVG imports. This module itself has no dependency on
 * GeometryEngine, the DOM, or any rendering/export concern; it only produces plain point arrays.
 *
 * A shape's *natural* proportions (e.g. Capsule's 2:1 natural width:height) are a deliberate
 * starting aspect ratio, not a constraint — placing a shape into a box of a different aspect ratio
 * stretches it non-uniformly (the same accepted tradeoff an Ellipse already makes from a circle).
 * Star and Cross are the two shapes where this is most visible (a stretched Star visually "leans";
 * a stretched Cross gets uneven arm thickness) — this is intentional, not a bug, matching how a
 * Rectangle already tolerates any non-square w/h.
 *
 * Units are millimeters only insofar as the caller decides to place the shape in mm; here they are
 * dimensionless natural units.
 */

const TWO_PI = Math.PI * 2;

function point(xMm, yMm) {
  return { xMm, yMm };
}

/**
 * Translates every point in every contour by the same offset so the shape's own combined bounding
 * box's top-left corner sits at (0, 0) — the "natural, origin-rooted" contract every generator
 * below must satisfy before returning. Applying one shared offset across all contours (rather than
 * rooting each contour independently) is what keeps a multi-contour shape's contours correctly
 * aligned relative to each other (see createRingNaturalContours()).
 *
 * @param {{xMm:number,yMm:number}[][]} contours
 * @returns {{xMm:number,yMm:number}[][]}
 */
function rootAtOrigin(contours) {
  let minXmm = Infinity;
  let minYmm = Infinity;
  for (const contour of contours) {
    for (const p of contour) {
      if (p.xMm < minXmm) minXmm = p.xMm;
      if (p.yMm < minYmm) minYmm = p.yMm;
    }
  }
  return contours.map((contour) => contour.map((p) => point(p.xMm - minXmm, p.yMm - minYmm)));
}

/**
 * Samples N points around a circle/ellipse arc, centered at (cxMm, cyMm), starting at startAngleRad
 * and sweeping sweepRad radians (positive = clockwise in a Y-down canvas convention). Shared by
 * every circular/elliptical shape below (ellipse, capsule caps, ring) so their arc math never
 * drifts apart.
 */
function sampleArc(cxMm, cyMm, rxMm, ryMm, startAngleRad, sweepRad, segments) {
  const points = [];
  for (let i = 0; i <= segments; i++) {
    const angle = startAngleRad + (sweepRad * i) / segments;
    points.push(point(cxMm + rxMm * Math.cos(angle), cyMm + ryMm * Math.sin(angle)));
  }
  return points;
}

const CIRCLE_SEGMENTS = 64;

/**
 * A full ellipse (a circle in its own natural space — GeometryEngine's independent X/Y scaling is
 * what turns it into an ellipse once placed into a non-square widthMm/heightMm box).
 */
export function createEllipseNaturalContours() {
  const contour = sampleArc(0, 0, 1, 1, 0, TWO_PI, CIRCLE_SEGMENTS).slice(0, -1);
  return rootAtOrigin([contour]);
}

/**
 * A stadium/pill shape: two semicircular caps of radius 1 joined by straight sides of length 2,
 * giving a natural 4:2 (2:1) width:height ratio — Capsule's canonical "oblong" look at creation.
 */
export function createCapsuleNaturalContours() {
  const r = 1;
  const halfStraightMm = 1;
  const rightCap = sampleArc(halfStraightMm, 0, r, r, -Math.PI / 2, Math.PI, 32);
  const leftCap = sampleArc(-halfStraightMm, 0, r, r, Math.PI / 2, Math.PI, 32);
  return rootAtOrigin([[...rightCap, ...leftCap]]);
}

/**
 * A regular polygon (Triangle/Pentagon/Hexagon/Octagon/... are all this one function with a
 * different `sides`, per S-110's "do not create separate implementations" requirement), inscribed
 * in a unit circle, point-up.
 *
 * @param {number} sides Integer, 3-12.
 */
export function createRegularPolygonNaturalContours(sides) {
  if (!Number.isInteger(sides) || sides < 3 || sides > 12) {
    throw new RangeError('createRegularPolygonNaturalContours requires sides to be an integer from 3 to 12.');
  }
  const n = sides;
  const contour = [];
  for (let i = 0; i < n; i++) {
    const angle = -Math.PI / 2 + (TWO_PI * i) / n;
    contour.push(point(Math.cos(angle), Math.sin(angle)));
  }
  return rootAtOrigin([contour]);
}

/**
 * A star with alternating outer/inner vertices, point-up.
 *
 * @param {number} points Integer, 3-12.
 * @param {number} innerRadiusRatio 0.1-0.9 — the inner (notch) radius as a fraction of the outer
 *   radius; the user-facing "Inner Radius"/"Point Depth" control.
 */
export function createStarNaturalContours(points, innerRadiusRatio) {
  if (!Number.isInteger(points) || points < 3 || points > 12) {
    throw new RangeError('createStarNaturalContours requires points to be an integer from 3 to 12.');
  }
  const n = points;
  if (!Number.isFinite(innerRadiusRatio) || innerRadiusRatio < 0.1 || innerRadiusRatio > 0.9) {
    throw new RangeError('createStarNaturalContours requires innerRadiusRatio to be a number from 0.1 to 0.9.');
  }
  const contour = [];
  const step = Math.PI / n;
  for (let i = 0; i < n * 2; i++) {
    const angle = -Math.PI / 2 + i * step;
    const radius = i % 2 === 0 ? 1 : innerRadiusRatio;
    contour.push(point(radius * Math.cos(angle), radius * Math.sin(angle)));
  }
  return rootAtOrigin([contour]);
}

/**
 * A classic parametric heart curve (x = 16 sin^3 t, y = 13 cos t - 5 cos 2t - 2 cos 3t - cos 4t),
 * with y negated so the cusp (the heart's point) lands at the bottom in this app's Y-down mm
 * canvas convention, matching how a heart is conventionally drawn.
 */
export function createHeartNaturalContours() {
  const segments = 48;
  const contour = [];
  for (let i = 0; i < segments; i++) {
    const t = (TWO_PI * i) / segments;
    const xMm = 16 * Math.pow(Math.sin(t), 3);
    const yMathMm = 13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t);
    contour.push(point(xMm, -yMathMm));
  }
  return rootAtOrigin([contour]);
}

/**
 * A right-pointing arrow: a rectangular shaft with a triangular head, natural width:height ~1.7:1.
 */
export function createArrowNaturalContours() {
  const contour = [
    point(-1, -0.3),
    point(0.2, -0.3),
    point(0.2, -0.6),
    point(1, 0),
    point(0.2, 0.6),
    point(0.2, 0.3),
    point(-1, 0.3)
  ];
  return rootAtOrigin([contour]);
}

/**
 * A plus/cross shape: a square with square notches cut from each corner, arm half-width 1/3 of the
 * overall half-extent (natural bbox is exactly square).
 */
export function createCrossNaturalContours() {
  const t = 1 / 3;
  const contour = [
    point(-t, -1), point(t, -1), point(t, -t), point(1, -t), point(1, t), point(t, t),
    point(t, 1), point(-t, 1), point(-t, t), point(-1, t), point(-1, -t), point(-t, -t)
  ];
  return rootAtOrigin([contour]);
}

/**
 * A crescent (lune): the region of a circle of radius R that lies outside a second, equal-radius
 * circle offset by `d` along X. Built directly from circle-circle intersection geometry (a closed
 * loop walking the far/major arc of the first circle, then the near/minor arc of the second circle
 * back to the start) rather than via a Boolean Operation, since the result only ever needs to be
 * this one fixed, non-configurable lune shape.
 */
export function createCrescentNaturalContours() {
  const R = 1;
  const d = 1.15;
  const halfChord = d / 2;
  const h = Math.sqrt(R * R - halfChord * halfChord);

  // Angle (relative to circle 1, centered at the origin) of the top intersection point.
  const a1 = Math.atan2(h, halfChord);
  // Outer boundary: circle 1's major arc from the top intersection point, through its far/left
  // side (angle pi), down to the bottom intersection point.
  const outerArc = sampleArc(0, 0, R, R, a1, TWO_PI - 2 * a1, 40);

  // Angle (relative to circle 2, centered at (d, 0)) of the top intersection point.
  const b1 = Math.atan2(h, halfChord - d);
  // Inner boundary: circle 2's minor arc from the bottom intersection point, through its near/left
  // side (angle pi, closest to circle 1's center), back up to the top intersection point.
  const innerArc = sampleArc(d, 0, R, R, TWO_PI - b1, -(TWO_PI - 2 * b1), 40);

  return rootAtOrigin([[...outerArc, ...innerArc]]);
}

/**
 * A ring/donut: two concentric circular contours (outer + inner). Left as two separate contours
 * (rather than combined into one) so the existing even-odd fill sampler treats the inner circle as
 * a hole for free (the same mechanism that already excludes a glyph's counter, e.g. the hole in
 * "o") and outline mode traces both circles independently, with zero changes to StoneSampler.js.
 *
 * @param {number} innerRatio 0.1-0.9 — the inner opening's radius as a fraction of the outer radius.
 */
export function createRingNaturalContours(innerRatio) {
  if (!Number.isFinite(innerRatio) || innerRatio < 0.1 || innerRatio > 0.9) {
    throw new RangeError('createRingNaturalContours requires innerRatio to be a number from 0.1 to 0.9.');
  }
  const outer = sampleArc(0, 0, 1, 1, 0, TWO_PI, CIRCLE_SEGMENTS).slice(0, -1);
  const inner = sampleArc(0, 0, innerRatio, innerRatio, 0, TWO_PI, CIRCLE_SEGMENTS).slice(0, -1);
  return rootAtOrigin([outer, inner]);
}

/** Shape kinds this module can generate, keyed exactly like GeometryEngine's shape param. */
export const SHAPE_LIBRARY_KINDS = new Set([
  'ellipse', 'capsule', 'polygon', 'star', 'heart', 'arrow', 'cross', 'crescent', 'ring'
]);

/**
 * Single dispatch entry point so GeometryEngine only ever needs one call site for every shape kind
 * this module knows how to generate.
 *
 * @param {string} kind One of SHAPE_LIBRARY_KINDS.
 * @param {object} [params]
 * @param {number} [params.sides] Required for 'polygon'.
 * @param {number} [params.points] Required for 'star'.
 * @param {number} [params.innerRadiusRatio] Required for 'star'.
 * @param {number} [params.innerRatio] Required for 'ring'.
 * @returns {{xMm:number,yMm:number}[][]}
 */
export function createShapeNaturalContours(kind, params = {}) {
  switch (kind) {
    case 'ellipse': return createEllipseNaturalContours();
    case 'capsule': return createCapsuleNaturalContours();
    case 'polygon': return createRegularPolygonNaturalContours(params.sides);
    case 'star': return createStarNaturalContours(params.points, params.innerRadiusRatio);
    case 'heart': return createHeartNaturalContours();
    case 'arrow': return createArrowNaturalContours();
    case 'cross': return createCrossNaturalContours();
    case 'crescent': return createCrescentNaturalContours();
    case 'ring': return createRingNaturalContours(params.innerRatio);
    default:
      throw new TypeError(`createShapeNaturalContours: unknown shape kind "${kind}". Expected one of: ${[...SHAPE_LIBRARY_KINDS].join(', ')}`);
  }
}
