// MONO-012 -- Single Chain: sizing arithmetic that lets an OpenType script font read as one
// continuous bead chain per stroke inside the Monogram tool, instead of a hollow double outline.
//
// This module is pure arithmetic. It owns no sampling code and no geometry: it decides *what
// heightMm to ask GeometryEngine for* so that, in outline mode, a script font's stem comes out
// roughly one stone diameter wide -- the width at which both contour edges of a stroke collapse
// onto the same sample positions and the stroke fills in solid. See MonogramGenerator.generate()'s
// OpenType branch for the consumer.
//
// -- Empirical basis for the three chain constants --
// Measured on Great Vibes at SS6 (2.0 mm stones), varying letter height so the stem width in stone
// diameters (stemWidthRatio * heightMm / stoneSizeMm) swept a range:
//   ratio 0.80 -> clean single chain (both edges coincide)
//   ratio 1.07 -> mostly single, occasional doubling
//   ratio 1.61 -> clearly doubled hollow line
// SINGLE_CHAIN_STEM_RATIO (0.85) is the target between the clean 0.80 and the still-good 1.07;
// SINGLE_CHAIN_MIN_RATIO (0.70) is where the chain starts thinning to visible gaps; and
// SINGLE_CHAIN_MAX_RATIO (1.10) is where doubling begins. These govern OUTLINE MODE ONLY. Fill /
// grid modes have their own readability governance in READ-003 (StrokeWidthGate.js) and do not use
// this module at all.
export const SINGLE_CHAIN_STEM_RATIO = 0.85;   // target stem width, in stone diameters
export const SINGLE_CHAIN_MIN_RATIO = 0.70;    // below this the chain thins to gaps
export const SINGLE_CHAIN_MAX_RATIO = 1.10;    // above this the chain starts splitting

// MONO-012 imports MIN_HEIGHT_TO_STONE_RATIO through the geometry barrel (re-exported from
// src/geometry/index.js), not by reaching into TextAutoFit.js directly -- same barrel-only
// convention every other cross-package import in src/monogram/** follows.
import { MIN_HEIGHT_TO_STONE_RATIO } from '../geometry/index.js';

// The largest stemWidthRatio a font may have and still produce a monogram letter that clears the
// project readability floor. A single-chain letter is sized to
// `SINGLE_CHAIN_STEM_RATIO * stoneSizeMm / stemWidthRatio`, so its height-to-stone ratio is
// `SINGLE_CHAIN_STEM_RATIO / stemWidthRatio`, independent of stone size. That clears
// MIN_HEIGHT_TO_STONE_RATIO exactly when `stemWidthRatio <= SINGLE_CHAIN_STEM_RATIO /
// MIN_HEIGHT_TO_STONE_RATIO` -- 0.85 / 16 = 0.053125 today.
//
// -- Why this is DERIVED where StemRegime.js's own boundaries are deliberate literals --
// These are opposite requirements, and the contrast is intentional, not an inconsistency:
//   * StemRegime.js classifies a font into a stroke regime. Its class boundaries (0.04 / 0.0625)
//     are hard-coded literals precisely so a font never changes regime when MIN_HEIGHT_TO_STONE_RATIO
//     moves -- the classification exists to be independent of the floor.
//   * MONOGRAM_MAX_STEM_WIDTH_RATIO exists for the opposite reason: to keep the Monogram picker's
//     eligible-font set exactly in sync with the readability floor, so a below-floor monogram is
//     structurally unreachable. It MUST shift when either SINGLE_CHAIN_STEM_RATIO or
//     MIN_HEIGHT_TO_STONE_RATIO changes, so it is computed from both, never written as a literal.
export const MONOGRAM_MAX_STEM_WIDTH_RATIO =
  SINGLE_CHAIN_STEM_RATIO / MIN_HEIGHT_TO_STONE_RATIO;

/**
 * The letter height (engine em-square heightMm) at which a stroke of the given font is
 * SINGLE_CHAIN_STEM_RATIO stone diameters wide -- the single-chain target.
 *
 * @param {{stoneSizeMm:number, stemWidthRatio:number}} params
 * @returns {number} heightMm = SINGLE_CHAIN_STEM_RATIO * stoneSizeMm / stemWidthRatio
 */
export function singleChainHeightMm({ stoneSizeMm, stemWidthRatio }) {
  return (SINGLE_CHAIN_STEM_RATIO * stoneSizeMm) / stemWidthRatio;
}

/**
 * Stones across a stem for a letter at `heightMm` -- StemRegime.js:19-21's documented identity
 * (stones across a stem = R * stemWidthRatio, where R = heightMm / stoneSizeMm), not a new
 * derivation.
 *
 * @param {{heightMm:number, stoneSizeMm:number, stemWidthRatio:number}} params
 * @returns {number} stemWidthRatio * heightMm / stoneSizeMm
 */
export function stemStones({ heightMm, stoneSizeMm, stemWidthRatio }) {
  return (stemWidthRatio * heightMm) / stoneSizeMm;
}

/**
 * The minimum stem-stone count a fitted monogram letter must still clear. Two independent lower
 * bounds apply and the binding one is whichever is larger:
 *   * SINGLE_CHAIN_MIN_RATIO -- below this the chain visibly breaks into gaps.
 *   * MIN_HEIGHT_TO_STONE_RATIO * stemWidthRatio -- the stem-stone count at the readability floor
 *     height. Fitting can shrink a letter below its ideal chain height, dragging R (and therefore
 *     the stem-stone count) down with it, so a font eligible at its ideal height can still be
 *     shrunk under the floor. For a font with stemWidthRatio >= SINGLE_CHAIN_MIN_RATIO /
 *     MIN_HEIGHT_TO_STONE_RATIO (~0.04375) the floor bites first; for a thinner font the 0.70 chain
 *     minimum does.
 *
 * @param {{stemWidthRatio:number}} params
 * @returns {number}
 */
export function minChainStones({ stemWidthRatio }) {
  return Math.max(SINGLE_CHAIN_MIN_RATIO, MIN_HEIGHT_TO_STONE_RATIO * stemWidthRatio);
}

/**
 * Whether a font's measured stemWidthRatio is thin enough for a single-chain monogram letter to
 * clear the readability floor at every stone size (stone size cancels out of the height-to-stone
 * ratio -- see MONOGRAM_MAX_STEM_WIDTH_RATIO). Non-numeric, NaN, Infinity, zero and negative all
 * return false. Counter-intuitively it is the *thicker*-stemmed fonts that fail: a thick stem
 * reaches SINGLE_CHAIN_STEM_RATIO stones across at a shorter -- less legible -- letter.
 *
 * @param {number} stemWidthRatio
 * @returns {boolean}
 */
export function isMonogramEligibleStemWidthRatio(stemWidthRatio) {
  return typeof stemWidthRatio === 'number'
    && Number.isFinite(stemWidthRatio)
    && stemWidthRatio > 0
    && stemWidthRatio <= MONOGRAM_MAX_STEM_WIDTH_RATIO;
}
