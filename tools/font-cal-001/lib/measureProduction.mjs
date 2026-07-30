/**
 * FONT-CAL-001 -- shared production measurement wrapper.
 *
 * Reuses FONT-CERT-001/SOURCE-001's real, unmodified production analysis (buildCandidateEngine +
 * analyzeOne, from tools/font-certification/lib/productionAnalysis.mjs) rather than re-deriving
 * StoneLayout generation or its metrics. This module adds nothing to the measurement itself -- it
 * only lets baseline.mjs and validate.mjs both point the same measurement at an arbitrary TTF path
 * and an arbitrary list of {text, stoneSizeId, heightMm} cases, instead of the fixed
 * PRODUCTION_REVIEW_GLYPHS/WORDS corpus runProductionAnalysis() always iterates.
 *
 * Per CLAUDE.md/FONT-CAL-001 scope: no new geometry or stone-generation logic lives here. The only
 * per-glyph analysis this module adds beyond productionAnalysis.mjs's own fields is the
 * counter-bearing stone-count floor from readabilityMetrics.mjs (also reused, not duplicated).
 */
import { buildCandidateEngine, analyzeOne } from '../../font-certification/lib/productionAnalysis.mjs';
import { COUNTER_BEARING_CHARACTERS, MIN_STONE_COUNT_FOR_COUNTER_BEARING, MIN_MEANINGFUL_STONE_COUNT } from '../../font-certification/lib/readabilityMetrics.mjs';

/**
 * @param {string} candidateAbsolutePath
 * @param {Array<{text: string, stoneSizeId: string, heightMm: number, label?: string}>} cases
 * @returns {Promise<Array<object>>} one result per case, stones included
 */
export async function measureFont(candidateAbsolutePath, cases) {
  const { engine, fontId } = await buildCandidateEngine(candidateAbsolutePath);
  const results = [];
  for (const c of cases) {
    const result = await analyzeOne(engine, fontId, c.text, c.stoneSizeId, c.heightMm);
    const isCounterBearing = c.text.length === 1 && COUNTER_BEARING_CHARACTERS.has(c.text);
    const meaningfulFloor = isCounterBearing ? MIN_STONE_COUNT_FOR_COUNTER_BEARING : MIN_MEANINGFUL_STONE_COUNT;
    results.push({
      label: c.label ?? c.text,
      ...result,
      isCounterBearing,
      meaningfulStoneFloor: meaningfulFloor,
      belowMeaningfulFloor: result.error ? null : result.stoneCount < meaningfulFloor
    });
  }
  return results;
}

/** Strips the `stones` array (kept only for in-process diagnosis) before JSON serialization. */
export function forJson(results) {
  return results.map(({ stones, ...rest }) => rest);
}
