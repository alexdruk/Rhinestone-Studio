/**
 * MONO-015 -- weight-following stone size mapping.
 *
 * Turns a measured local stroke width (from src/geometry/StrokeWidthProbe.js) into a stone diameter,
 * picked from an ascending list of candidate diameters the caller supplies in raw millimeters.
 *
 * Pure arithmetic. No import from src/renderer/** -- src/renderer/StoneSizes.js's own header states
 * that nothing in src/geometry/** reads that file or knows what an "SS16" is, and that geometry
 * works in raw millimeters for any positive value. The catalog-aware derivation of which diameters
 * make up a "step" lives in src/renderer/StoneSizes.js (stoneSizesFromBaseMm()); this module is
 * handed the resulting mm array and never needs to know it came from a catalog.
 */

/**
 * The stone diameter assigned to a stroke sample of local width `widthMm`: the smallest entry of the
 * ascending `sizesMm` that is `>= widthMm`, or the largest entry when `widthMm` exceeds all of them.
 *
 * Which single-chain bound this rule enforces, and which it does not:
 *
 *   - It enforces the UPPER bound. A stone at least as wide as the stroke keeps both contour edges
 *     of that stroke collapsed onto one chain, so a stem never splits into a doubled hollow line.
 *     SINGLE_CHAIN_MAX_RATIO (1.10, src/monogram/SingleChain.js:23) names the ratio at which that
 *     splitting begins; picking a stone >= the stroke width holds the ratio at or below 1.
 *
 *   - It does NOT enforce the LOWER bound. On a hairline far narrower than `sizesMm[0]` the assigned
 *     stone is floored at `sizesMm[0]`, so stones-across-stem there falls well below
 *     SINGLE_CHAIN_MIN_RATIO (0.70, src/monogram/SingleChain.js:22) -- the ratio the constant names
 *     as where a single chain thins into visible gaps. Weight sizing does not claim to keep the
 *     single-chain condition intact on sub-`sizesMm[0]` hairlines; it keeps the stem solid where the
 *     stroke is at least `sizesMm[0]` wide and floors the rest at `sizesMm[0]`.
 *
 * `sizesMm` is validated the way MixedSizeGenerator.normalizeMixedSizeParams() validates
 * `allowedSizesMm` -- a non-empty array of positive finite numbers -- and is assumed ascending (its
 * only producer, normalizeMixedSizeParams()'s weight branch, guarantees that).
 *
 * @param {number} widthMm
 * @param {number[]} sizesMm Ascending candidate diameters, in millimeters.
 * @returns {number}
 */
export function weightSizeMm(widthMm, sizesMm) {
  if (!Array.isArray(sizesMm) || sizesMm.length === 0) {
    throw new TypeError('weightSizeMm: sizesMm must be a non-empty ascending array of positive diameters.');
  }
  for (const value of sizesMm) {
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
      throw new RangeError(`weightSizeMm: every sizesMm entry must be a positive finite number, got ${JSON.stringify(value)}.`);
    }
  }
  for (const diameterMm of sizesMm) {
    if (diameterMm >= widthMm) return diameterMm;
  }
  return sizesMm[sizesMm.length - 1];
}
