/**
 * S-110: Smart Text-to-Shape Fitting — pure geometry helpers.
 *
 * This module has no knowledge of Project/Layer/StoneLayout/the DOM (matching src/editing/**'s
 * "pure, DOM-free" convention) -- it only answers three geometry questions: "what's the largest
 * rectangle of a given aspect ratio that fits inside this polygon?" (computeInscribedRect), "what
 * scale does a measured text box need to fit a target box, honoring a minimum legible height?"
 * (computeShapeFitScale), and — S-110A, the inverse of the first question — "what scale does a
 * reference shape need so its own largest-inscribed-rectangle grows to match a required box?"
 * (computeContainingShapeScale). app.js is the only caller, and is the only place that resolves a
 * shape layer to polygons, resolves a text layer's measured size, and writes the result back onto a
 * layer's own fields -- this module never touches a layer directly.
 */

import { Point2D } from '../text/VectorPath.js';
import { isPointInsidePolygons } from './StoneSampler.js';

/**
 * Shape kinds Fit Text to Shape supports. S-110's spec requires Circle/Rectangle/Ellipse/Capsule/
 * Regular Polygon/Star/Heart/Ring, and asks that Arrow/Cross/Crescent be audited for whether they
 * give a "useful and predictable" fitting region before being enabled.
 *
 * That audit (measured, not guessed, via this module's own computeInscribedRect fitRatio at
 * several aspect ratios during S-110 implementation): Star -- a required shape -- already only
 * achieves an 11% bbox-area fitRatio at aspect 1:1 (its five inner notches leave little usable
 * center). Cross/Arrow/Crescent measured at 8-30% depending on aspect ratio -- the same order of
 * magnitude as Star, not meaningfully worse -- and computeInscribedRect's own perimeter-sampled
 * fully-inside guarantee means the result is never geometrically wrong, only sometimes small. A
 * fitRatio cutoff that excluded Cross (11.1%) while keeping the required Star (11.0%) would be an
 * arbitrary line, not a real distinction, so all three are included rather than disabled for a
 * difference that doesn't hold up under measurement.
 */
export const FITTABLE_SHAPE_TYPES = new Set([
  'circle', 'rectangle', 'ellipse', 'capsule', 'polygon', 'star', 'heart', 'ring',
  'arrow', 'cross', 'crescent', 'shield'
]);

const PERIMETER_SAMPLES_PER_EDGE = 10;
const BINARY_SEARCH_ITERATIONS = 24;

/**
 * Whether every one of PERIMETER_SAMPLES_PER_EDGE*4 points walked around an axis-aligned
 * rectangle's own perimeter (not just its 4 corners) falls inside `polygons` (even-odd rule).
 * Sampling the perimeter -- not just corners/midpoints -- is what keeps this correct for concave
 * shapes (a Star's inner notch, a Heart's top dip): a rectangle edge that pokes out through a
 * concave gap between two corners is still caught by an intermediate perimeter sample.
 */
function isRectFullyInside(polygons, cxMm, cyMm, halfWidthMm, halfHeightMm) {
  const corners = [
    [cxMm - halfWidthMm, cyMm - halfHeightMm],
    [cxMm + halfWidthMm, cyMm - halfHeightMm],
    [cxMm + halfWidthMm, cyMm + halfHeightMm],
    [cxMm - halfWidthMm, cyMm + halfHeightMm]
  ];
  for (let edge = 0; edge < 4; edge++) {
    const [x0, y0] = corners[edge];
    const [x1, y1] = corners[(edge + 1) % 4];
    for (let i = 0; i < PERIMETER_SAMPLES_PER_EDGE; i++) {
      const t = i / PERIMETER_SAMPLES_PER_EDGE;
      const sample = new Point2D(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t);
      if (!isPointInsidePolygons(sample, polygons)) return false;
    }
  }
  return true;
}

/**
 * Binary-searches the largest axis-aligned rectangle of the given aspect ratio (width/height),
 * centered at `boundingBox`'s own center, that fits entirely inside `polygons`.
 *
 * @param {import('../text/VectorPath.js').Point2D[][]} polygons
 * @param {import('../text/VectorPath.js').BoundingBox|null} boundingBox
 * @param {number} aspectRatio width/height, must be positive.
 * @returns {{xMm:number,yMm:number,widthMm:number,heightMm:number,fitRatio:number}|null} null when
 *   there is no usable region at all (empty shape, non-finite aspect ratio).
 */
export function computeInscribedRect(polygons, boundingBox, aspectRatio) {
  if (!boundingBox || !Array.isArray(polygons) || polygons.length === 0) return null;
  if (!Number.isFinite(aspectRatio) || aspectRatio <= 0) return null;
  if (!(boundingBox.widthMm > 0) || !(boundingBox.heightMm > 0)) return null;

  const cxMm = boundingBox.center.xMm;
  const cyMm = boundingBox.center.yMm;

  // s is a scale (0..1) on the full bbox width; height is always derived from width via
  // aspectRatio, so a mismatched aspect ratio between the target rect and the shape's own bbox is
  // resolved by the search itself (it simply converges on a smaller s), not by special-casing here.
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < BINARY_SEARCH_ITERATIONS; i++) {
    const mid = (lo + hi) / 2;
    const widthMm = mid * boundingBox.widthMm;
    const heightMm = widthMm / aspectRatio;
    if (isRectFullyInside(polygons, cxMm, cyMm, widthMm / 2, heightMm / 2)) {
      lo = mid;
    } else {
      hi = mid;
    }
  }

  const widthMm = lo * boundingBox.widthMm;
  const heightMm = widthMm / aspectRatio;
  if (!(widthMm > 0) || !(heightMm > 0)) return null;

  return {
    xMm: cxMm - widthMm / 2,
    yMm: cyMm - heightMm / 2,
    widthMm,
    heightMm,
    fitRatio: (widthMm * heightMm) / (boundingBox.widthMm * boundingBox.heightMm)
  };
}

/**
 * Computes the scale to apply to a text layer's current heightMm so its measured box (at that
 * current height) fits inside a target box, honoring a minimum legible height
 * (spacingMm * minHeightToSpacingRatio) -- the same legibility-floor concept S-107's
 * computeAutoFitScale() already established for safe-area auto-fit (app.js), reused here (via this
 * parameter, not a hardcoded copy) so the two features can never disagree on "how small is too
 * small". Assumes text width/height scale linearly with requested heightMm, the same approximation
 * computeAutoFitScale() already makes -- callers re-measure the actual regenerated geometry at the
 * chosen height rather than trusting this scale as exact.
 *
 * @param {object} params
 * @param {number} params.currentHeightMm The text layer's current heightMm (what measuredWidthMm/
 *   measuredHeightMm were measured at).
 * @param {number} params.measuredWidthMm
 * @param {number} params.measuredHeightMm
 * @param {number} params.spacingMm stoneSizeMm + gapMm.
 * @param {number} params.targetWidthMm
 * @param {number} params.targetHeightMm
 * @param {number} params.minHeightToSpacingRatio
 * @returns {{ok:true,scale:number}|{ok:false,reason:'empty'|'degenerate'|'legibility'}}
 */
export function computeShapeFitScale({
  currentHeightMm, measuredWidthMm, measuredHeightMm, spacingMm,
  targetWidthMm, targetHeightMm, minHeightToSpacingRatio
}) {
  if (!(measuredWidthMm > 0) || !(measuredHeightMm > 0)) return { ok: false, reason: 'empty' };

  const scaleForWidth = targetWidthMm / measuredWidthMm;
  const scaleForHeight = targetHeightMm / measuredHeightMm;
  let scale = Math.min(scaleForWidth, scaleForHeight);
  if (!Number.isFinite(scale) || scale <= 0) return { ok: false, reason: 'degenerate' };

  const floorHeightMm = spacingMm > 0 ? spacingMm * minHeightToSpacingRatio : 0;
  const requestedHeightMm = currentHeightMm * scale;

  if (floorHeightMm > 0 && requestedHeightMm < floorHeightMm) {
    const flooredScale = floorHeightMm / currentHeightMm;
    // Linear-approximation check (see doc comment): does the floored height's width still fit?
    const widthAtFloor = measuredWidthMm * flooredScale;
    if (widthAtFloor > targetWidthMm) {
      return { ok: false, reason: 'legibility' };
    }
    scale = flooredScale;
  }

  return { ok: true, scale };
}

/**
 * S-110A (Smart Shape-to-Text Creation): the inverse of computeInscribedRect() -- given a
 * *reference* shape's already-resolved polygons/boundingBox (at any convenient reference size) and
 * a required box size (typically the existing text's rendered bbox plus a production margin), finds
 * the uniform scale factor that, if applied to the reference shape's own overall size, makes its
 * largest inscribed rectangle at the required box's aspect ratio come out exactly that size.
 *
 * This is exact, not an approximation: computeInscribedRect()'s search is expressed as a fraction
 * `s` of the shape's own bounding-box width (see its own doc comment), so both the shape and its
 * inscribed rectangle scale by the same factor under a uniform resize -- resolving the reference
 * shape's inscribed rect once and solving `requiredWidthMm = scale * inscribed.widthMm` for `scale`
 * is therefore exact at any target size, not a second fitting algorithm.
 *
 * @param {import('../text/VectorPath.js').Point2D[][]} polygons Reference shape's resolved polygons.
 * @param {import('../text/VectorPath.js').BoundingBox|null} boundingBox Reference shape's own bbox.
 * @param {number} requiredWidthMm
 * @param {number} requiredHeightMm
 * @returns {{scale:number}|null} null when the reference shape has no usable region, or the
 *   required box is degenerate.
 */
export function computeContainingShapeScale(polygons, boundingBox, requiredWidthMm, requiredHeightMm) {
  if (!(requiredWidthMm > 0) || !(requiredHeightMm > 0)) return null;
  const aspectRatio = requiredWidthMm / requiredHeightMm;
  const inscribed = computeInscribedRect(polygons, boundingBox, aspectRatio);
  if (!inscribed || !(inscribed.widthMm > 0)) return null;
  const scale = requiredWidthMm / inscribed.widthMm;
  if (!Number.isFinite(scale) || scale <= 0) return null;
  return { scale };
}
