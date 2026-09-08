/**
 * MONO-015 -- weight-following stone size mapping.
 *
 * Turns a measured local stroke width (from src/geometry/StrokeWidthProbe.js) into a catalog stone
 * diameter. Pure arithmetic over the standard rhinestone catalog.
 *
 * src/geometry/** never imports src/renderer/StoneSizes.js (geometry works in raw millimeters for
 * any positive value -- see StoneSizes.js's own doc comment), so the catalog diameters are
 * hand-mirrored here as data, the same convention app.js's MIXED_ALLOWED_SIZE_CHECKBOXES and the
 * VECTOR_FILL_MODES/SAMPLE_MODES enum pairs already use. tools/test-mono-015-weight-sizing.mjs
 * cross-checks WEIGHT_SIZING_CATALOG_DIAMETERS_MM against listStoneSizes() on every run so the two
 * cannot drift apart.
 */

// Ascending, mirrored from src/renderer/StoneSizes.js (SS6 / SS10 / SS16 / SS20 / SS30).
export const WEIGHT_SIZING_CATALOG_DIAMETERS_MM = [2.0, 2.8, 4.0, 4.7, 6.4];

/**
 * The stone diameter assigned to a stroke sample of local width `widthMm`: the smallest catalog
 * diameter that is >= `widthMm` (the largest catalog diameter if `widthMm` exceeds all of them),
 * then clamped into `[minMm, maxMm]`.
 *
 * Which single-chain bound this rule enforces, and which it does not:
 *
 *   - It enforces the UPPER bound. A stone at least as wide as the stroke keeps both contour edges
 *     of that stroke collapsed onto one chain, so a stem never splits into a doubled hollow line.
 *     SINGLE_CHAIN_MAX_RATIO (1.10, src/monogram/SingleChain.js:23) names the ratio at which that
 *     splitting begins; picking a stone >= the stroke width holds the ratio at or below 1.
 *
 *   - It does NOT enforce the LOWER bound. On a hairline far narrower than `minMm` the assigned
 *     stone is floored at `minMm`, so stones-across-stem there falls well below
 *     SINGLE_CHAIN_MIN_RATIO (0.70, src/monogram/SingleChain.js:22) -- the ratio the constant
 *     names as where a single chain thins into visible gaps. Weight sizing does not claim to keep
 *     the single-chain condition intact on sub-`minMm` hairlines; it keeps the stem solid where
 *     the stroke is at least `minMm` wide and floors the rest at `minMm`.
 *
 * `minMm`/`maxMm` should themselves be catalog diameters for the result to stay catalog-valued
 * (weightMinSizeMm / weightMaxSizeMm are, by construction -- see app.js).
 *
 * @param {number} widthMm
 * @param {number} minMm
 * @param {number} maxMm
 * @returns {number}
 */
export function weightSizeMm(widthMm, minMm, maxMm) {
  const catalog = WEIGHT_SIZING_CATALOG_DIAMETERS_MM;
  let picked = catalog[catalog.length - 1];
  for (const diameterMm of catalog) {
    if (diameterMm >= widthMm) {
      picked = diameterMm;
      break;
    }
  }
  return Math.min(Math.max(picked, minMm), maxMm);
}

/**
 * The default `weightMaxSizeMm` when a user first turns weight sizing on for a layer: two catalog
 * steps above the layer's current stone size, clamped to the catalog's largest entry. SS20 has
 * only one step above it and SS30 none, so the clamp is load-bearing, not decorative.
 *
 * @param {number} baseStoneSizeMm The layer's current stone size (weightMinSizeMm's default).
 * @returns {number}
 */
export function defaultWeightMaxSizeMm(baseStoneSizeMm) {
  const catalog = WEIGHT_SIZING_CATALOG_DIAMETERS_MM;
  let baseIndex = 0;
  for (let k = 0; k < catalog.length; k++) {
    if (Math.abs(catalog[k] - baseStoneSizeMm) < 1e-6) { baseIndex = k; break; }
    if (catalog[k] < baseStoneSizeMm) baseIndex = k;
  }
  return catalog[Math.min(baseIndex + 2, catalog.length - 1)];
}
