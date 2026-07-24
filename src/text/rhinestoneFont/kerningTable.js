/**
 * Shared kerning-table helper for authored rhinestone font families (FONT-002, Part 3).
 *
 * Every family that reviews specific letter pairs (RS Block, RS Modern) needs the exact same
 * mechanism: a flat `{'AB': mmAdjustment, ...}` lookup keyed by the two-character pair, looked up
 * with a 0 fallback for any pair not explicitly reviewed. Only the *data* differs per family (which
 * pairs, which mm values) -- see families/rsBlock.js/rsModern.js's own KERNING_PAIRS_MM. This module
 * is that one shared lookup mechanism, so it's written and tested once instead of once per family.
 *
 * The returned function matches the shape RhinestoneFontProvider.getKerningAdjustmentMm() already
 * expects from a family (see RhinestoneFontProvider.js's module doc): `(prevChar, nextChar) =>
 * mmAdjustment`. A family with no reviewed pairs simply doesn't call createKerningTable() at all and
 * has no getKerningAdjustmentMm export -- exactly like families/rsBlockPrototypeSS10.js today.
 *
 * @param {Object<string, number>} pairsMm Map of two-character pair strings to an mm pen-advance
 *   adjustment (negative tightens, positive loosens).
 * @returns {(prevChar: string, nextChar: string) => number}
 */
export function createKerningTable(pairsMm) {
  return function getKerningAdjustmentMm(prevChar, nextChar) {
    return pairsMm[`${prevChar}${nextChar}`] ?? 0;
  };
}
