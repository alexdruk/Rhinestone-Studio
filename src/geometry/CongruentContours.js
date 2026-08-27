/**
 * Congruent-contour detection for Outline-mode sampling (RS-congruent-outline).
 *
 * An imported SVG can contain many geometrically identical small polygons (e.g. a ring of ~5mm
 * octagons) whose vertex coordinates nonetheless differ by sub-millimeter float noise -- separate
 * flattening passes, separate transform round-trips -- even though the shapes are, for every
 * production purpose, the same polygon repeated. Sampling each one independently
 * (StoneSampler.js's sampleMultiContourOutlinePoints()) lets that noise flip stone counts and phase
 * per-contour, and -- for contours whose sides are shorter than the stone pitch -- lets
 * clusterCornersByProximity() chain corners into unstable, float-sensitive centroid resolutions.
 *
 * This module only detects congruence and recovers the rigid transform between copies; it does not
 * sample anything itself. The caller (sampleMultiContourOutlinePoints()) samples one representative
 * per congruent group and reuses that single result -- transformed -- for every other member, so a
 * group's stone count and phase are decided exactly once, geometrically identically for every copy.
 */

import { Point2D } from '../text/VectorPath.js';

const DEFAULT_LENGTH_QUANTUM_MM = 0.05;
const DEFAULT_ANGLE_QUANTUM_DEG = 2;
// A vertex pair closer than this is a duplicate point (a zero-length edge), not a genuine short
// side -- collapsed before any signature is built, same convention as detectPolygonCornerFlags()'s
// own noise floor in ContourGeometry.js, several orders of magnitude below any real stone pitch.
const ZERO_LENGTH_EDGE_EPSILON_MM = 1e-6;
// A regular polygon's true turn angle/edge length can land exactly on a quantization tie (a regular
// octagon's 45-degree turn is precisely 22.5 quanta at the default 2-degree quantum) -- ordinary
// trig round-off then puts different congruent copies a few ULPs on either side of that tie,
// rounding one to 22 and another to 23 and breaking the match this whole module exists to make.
// Nudging the value before rounding breaks ties the same way every time regardless of which side of
// the tie a copy's own float noise happened to land on; far larger than realistic trig noise
// (~1e-9 degrees/mm at these magnitudes) but far smaller than any real quantum this module is
// configured with, so it never reclassifies a genuine non-tie measurement.
const QUANTIZE_TIE_EPSILON = 1e-6;

function quantize(value, quantum) {
  return Math.round(value / quantum + QUANTIZE_TIE_EPSILON);
}

/**
 * Remove duplicate consecutive vertices (zero-length edges), including the closing edge between the
 * last remaining vertex and the first, for a closed contour.
 *
 * @param {Point2D[]} polygon
 * @returns {Point2D[]}
 */
function collapseZeroLengthEdges(polygon) {
  const collapsed = [];
  for (const point of polygon) {
    const prev = collapsed[collapsed.length - 1];
    if (!prev || Math.hypot(point.xMm - prev.xMm, point.yMm - prev.yMm) > ZERO_LENGTH_EDGE_EPSILON_MM) {
      collapsed.push(point);
    }
  }
  while (collapsed.length > 1) {
    const first = collapsed[0];
    const last = collapsed[collapsed.length - 1];
    if (Math.hypot(last.xMm - first.xMm, last.yMm - first.yMm) <= ZERO_LENGTH_EDGE_EPSILON_MM) {
      collapsed.pop();
    } else {
      break;
    }
  }
  return collapsed;
}

/**
 * Build a cyclic (edge length, interior turn angle) signature for a closed, vertex-collapsed
 * contour, quantized so sub-noise-floor differences between otherwise-identical contours cannot
 * change the signature. Both the forward-walk arrays and the reversed-walk arrays (a mirrored copy
 * traverses its vertices in the opposite order) are precomputed here, so matching two contours never
 * needs to re-derive either.
 *
 * `edgeLenQ[i]`/`turnQ[i]` are anchored at vertex i: the length of the edge leaving vertex i, and the
 * unsigned turn angle AT vertex i (between the edge arriving and the edge leaving). Turn angle is
 * unsigned (magnitude only) because a rigid transform with reflection negates signed turn angle but
 * never changes its magnitude -- using magnitude here is what lets a single forward-vs-reversed
 * comparison (see matchContourSignatures()) cover both plain rotated copies and mirrored ones without
 * separate sign bookkeeping.
 *
 * @param {Point2D[]} verts Already vertex-collapsed (see collapseZeroLengthEdges()).
 * @param {number} lengthQuantumMm
 * @param {number} angleQuantumDeg
 */
function computeContourSignature(verts, lengthQuantumMm, angleQuantumDeg) {
  const n = verts.length;
  const edgeLenMm = new Array(n);
  for (let i = 0; i < n; i++) {
    const a = verts[i];
    const b = verts[(i + 1) % n];
    edgeLenMm[i] = Math.hypot(b.xMm - a.xMm, b.yMm - a.yMm);
  }

  const edgeLenQ = new Array(n);
  const turnQ = new Array(n);
  for (let i = 0; i < n; i++) {
    const prev = verts[(i - 1 + n) % n];
    const curr = verts[i];
    const next = verts[(i + 1) % n];
    const inX = curr.xMm - prev.xMm;
    const inY = curr.yMm - prev.yMm;
    const outX = next.xMm - curr.xMm;
    const outY = next.yMm - curr.yMm;
    const cross = inX * outY - inY * outX;
    const dot = inX * outX + inY * outY;
    const turnDeg = Math.abs((Math.atan2(cross, dot) * 180) / Math.PI);
    edgeLenQ[i] = quantize(edgeLenMm[i], lengthQuantumMm);
    turnQ[i] = quantize(turnDeg, angleQuantumDeg);
  }

  // Reversed-walk arrays: position k of a walk that visits the same vertices starting at vertex 0
  // but in the opposite direction lands on original vertex index (n - k) % n; the edge it leaves
  // from that position is the original edge arriving at that vertex, traversed backward (same
  // length); the turn angle there has the same magnitude as the original vertex's own turn.
  const edgeLenQRev = new Array(n);
  const turnQRev = new Array(n);
  for (let k = 0; k < n; k++) {
    edgeLenQRev[k] = edgeLenQ[(n - k - 1 + n) % n];
    turnQRev[k] = turnQ[(n - k) % n];
  }

  return { n, edgeLenQ, turnQ, edgeLenQRev, turnQRev };
}

function sequencesMatchAtShift(sigA, lenArr, turnArr, shift) {
  const { n } = sigA;
  for (let i = 0; i < n; i++) {
    const j = (i + shift) % n;
    if (sigA.edgeLenQ[i] !== lenArr[j] || sigA.turnQ[i] !== turnArr[j]) return false;
  }
  return true;
}

/**
 * Two signatures are congruent iff one is a cyclic shift of the other, walked forward (a plain
 * rotated/translated copy) or backward (a mirrored copy, reversal covering the reflection). Contours
 * with different post-collapse vertex counts are never congruent -- checked first as a cheap reject.
 *
 * @returns {{shift: number, reversed: boolean, n: number}|null}
 */
function matchContourSignatures(sigA, sigB) {
  if (sigA.n !== sigB.n) return null;
  const { n } = sigA;
  for (let shift = 0; shift < n; shift++) {
    if (sequencesMatchAtShift(sigA, sigB.edgeLenQ, sigB.turnQ, shift)) return { shift, reversed: false, n };
  }
  for (let shift = 0; shift < n; shift++) {
    if (sequencesMatchAtShift(sigA, sigB.edgeLenQRev, sigB.turnQRev, shift)) return { shift, reversed: true, n };
  }
  return null;
}

/**
 * Least-squares rigid transform (rotation + translation, with reflection when `reflect` is true)
 * mapping `repPoints[i]` onto `memberPoints[i]` for every matched i -- a small self-contained 2D
 * Kabsch/Procrustes solve. Reflection is applied as a fixed flip of the representative's centered
 * X-axis before solving for the optimal rotation; composing one fixed reflection with every possible
 * rotation spans every orientation-reversing isometry, so which axis is flipped doesn't matter.
 *
 * Returns an affine map `x' = a*x + b*y + tx`, `y' = c*x + d*y + ty` (orthogonal 2x2 linear part, so
 * it is exactly a rotation, or a reflection-then-rotation, never a general shear/scale).
 *
 * @param {Point2D[]} repPoints
 * @param {Point2D[]} memberPoints Same length as repPoints, matched pairwise (repPoints[i] <-> memberPoints[i]).
 * @param {boolean} reflect
 */
function solveRigidTransform(repPoints, memberPoints, reflect) {
  const n = repPoints.length;
  let crx = 0;
  let cry = 0;
  let cmx = 0;
  let cmy = 0;
  for (let i = 0; i < n; i++) {
    crx += repPoints[i].xMm;
    cry += repPoints[i].yMm;
    cmx += memberPoints[i].xMm;
    cmy += memberPoints[i].yMm;
  }
  crx /= n;
  cry /= n;
  cmx /= n;
  cmy /= n;

  let s1 = 0;
  let s2 = 0;
  const rf = reflect ? -1 : 1;
  for (let i = 0; i < n; i++) {
    const rx = (repPoints[i].xMm - crx) * rf;
    const ry = repPoints[i].yMm - cry;
    const mx = memberPoints[i].xMm - cmx;
    const my = memberPoints[i].yMm - cmy;
    s1 += rx * mx + ry * my;
    s2 += rx * my - ry * mx;
  }

  const theta = Math.atan2(s2, s1);
  const cosT = Math.cos(theta);
  const sinT = Math.sin(theta);

  const a = cosT * rf;
  const b = -sinT;
  const c = sinT * rf;
  const d = cosT;
  const tx = cmx - (a * crx + b * cry);
  const ty = cmy - (c * crx + d * cry);

  return { a, b, c, d, tx, ty, reflect };
}

/**
 * Apply a rigid transform (as returned by groupCongruentContours() group entries) to a point. Used
 * by the caller to map a representative contour's already-sampled points onto a congruent sibling
 * without re-sampling it.
 *
 * @param {{a:number,b:number,c:number,d:number,tx:number,ty:number}} transform
 * @param {{xMm:number,yMm:number}} point
 * @returns {Point2D}
 */
export function applyRigidTransform(transform, point) {
  return new Point2D(
    transform.a * point.xMm + transform.b * point.yMm + transform.tx,
    transform.c * point.xMm + transform.d * point.yMm + transform.ty
  );
}

/**
 * Group congruent closed contours (identical up to rotation, translation, and reflection) among
 * `polygons`, recovering the rigid transform from each group's representative onto every other
 * member.
 *
 * @param {Point2D[][]} polygons
 * @param {{closed?: boolean, lengthQuantumMm?: number, angleQuantumDeg?: number}} [options]
 *   `closed: false` (an open contour has no cyclic structure to match against) short-circuits to
 *   every contour being its own singleton group, matching this function's degenerate case.
 * @returns {{indices: number[], representativeIndex: number, transforms: Object<number, object>}[]}
 *   One entry per group; `transforms` maps a non-representative member's index (within `polygons`)
 *   to the rigid transform mapping the representative's raw points onto that member's. Groups of
 *   size 1 have an empty `transforms`.
 */
export function groupCongruentContours(polygons, options = {}) {
  const {
    closed = true,
    lengthQuantumMm = DEFAULT_LENGTH_QUANTUM_MM,
    angleQuantumDeg = DEFAULT_ANGLE_QUANTUM_DEG
  } = options;

  if (!closed) {
    return polygons.map((_, i) => ({ indices: [i], representativeIndex: i, transforms: {} }));
  }

  const collapsedVerts = polygons.map((polygon) => collapseZeroLengthEdges(polygon));
  const signatures = collapsedVerts.map((verts) => (
    verts.length >= 3 ? computeContourSignature(verts, lengthQuantumMm, angleQuantumDeg) : null
  ));

  const assigned = new Array(polygons.length).fill(false);
  const groups = [];

  for (let i = 0; i < polygons.length; i++) {
    if (assigned[i]) continue;
    assigned[i] = true;
    const group = { indices: [i], representativeIndex: i, transforms: {} };

    if (signatures[i]) {
      for (let j = i + 1; j < polygons.length; j++) {
        if (assigned[j] || !signatures[j]) continue;
        const match = matchContourSignatures(signatures[i], signatures[j]);
        if (!match) continue;

        const repVerts = collapsedVerts[i];
        const memberVerts = collapsedVerts[j];
        const { shift, reversed, n } = match;
        const correspondingMemberPoints = new Array(n);
        for (let k = 0; k < n; k++) {
          const memberIdx = reversed ? (n - ((k + shift) % n)) % n : (k + shift) % n;
          correspondingMemberPoints[k] = memberVerts[memberIdx];
        }

        const transform = solveRigidTransform(repVerts, correspondingMemberPoints, reversed);
        assigned[j] = true;
        group.indices.push(j);
        group.transforms[j] = transform;
      }
    }

    groups.push(group);
  }

  return groups;
}
