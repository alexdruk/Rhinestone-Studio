/**
 * FONT-CERT-002 -- objective, threshold-based readability findings for Part 3 (rhinestone production
 * review).
 *
 * A StoneLayout can generate successfully -- non-empty, zero collisions -- and still be visually
 * unreadable (e.g. a counter reduced to 2 stones, or two confusable glyphs collapsing to
 * near-identical layouts at a given size). Collision/error checks in productionAnalysis.mjs and
 * classification.mjs say nothing about that; this module is specifically the "successful layout
 * generation is different from visual readability" check the FONT-CERT-002 spec requires, computed
 * from the same productionAnalysis data every other Part 3 check already uses -- no new stone
 * generation, no GeometryEngine behavior change.
 */
import { chamferDistance } from './shapeSimilarity.mjs';
import { normalizedStonePoints } from './productionAnalysis.mjs';
import { RHINESTONE_SPECIMEN_PX_PER_MM_BY_SIZE, MIN_STONE_PX } from './specimenPages.mjs';
import { STONE_SIZE_IDS, CONFUSABLE_PAIRS } from './requiredCharacters.mjs';
import { STONE_SIZE_BY_ID } from '../../../src/renderer/StoneSizes.js';

// A distinguishable letterform needs enough stones to trace its defining features (a round counter, a
// stem, a crossbar) rather than reading as a blob or a dash. 6 is the smallest stone count that can
// still describe a simple closed loop (e.g. "o") as a recognizable ring instead of a triangle or a
// short dashed line -- below that, the stones stop meaningfully constraining the viewer's read of the
// shape. Chosen as a conservative floor, not a target: the redesigned per-size specimen heights
// (productionAnalysis.deriveSpecimenHeightMm()) comfortably clear it for every required character.
export const MIN_MEANINGFUL_STONE_COUNT = 6;

// Characters whose correct identification depends on a visible interior counter/hole -- these need a
// *higher* stone-count floor than MIN_MEANINGFUL_STONE_COUNT, because their stones must describe two
// boundaries (outer stroke and inner counter), not one.
//
// FONT-CERT-002 note on a rejected approach: an earlier version of this check used the production
// StoneLayout's connected-component count (clusterCount, computed via nearest-neighbor clustering,
// already used elsewhere in productionAnalysis.mjs) and flagged any counter-bearing character whose
// clusterCount fell below 2, on the theory that a "missing" counter would merge into a single cluster.
// Audited against a real candidate and found to have a 100% false-positive rate: a hollow ring (e.g.
// "O") is *always* one connected point-cloud under nearest-neighbor clustering -- the closest points
// on its outer and inner boundaries (e.g. at the top and bottom of the ring) are well within the
// clustering distance of each other even when the hole is clearly visible, so clusterCount was 1 for
// "O" in a candidate whose "O" visibly, correctly renders as a ring in the specimen. Connected-
// component clustering answers "is this point set spatially contiguous", not "does this shape have a
// visible hole", and cannot distinguish the two. Replaced with the stone-count floor below instead of
// tuning the flawed signal further.
export const COUNTER_BEARING_CHARACTERS = new Set([
  'a', 'b', 'd', 'e', 'g', 'o', 'p', 'q',
  'A', 'B', 'D', 'O', 'P', 'Q', 'R',
  '0', '4', '6', '8', '9'
]);
// Higher than MIN_MEANINGFUL_STONE_COUNT (6): a counter-bearing glyph's stones must be enough to
// describe *two* boundaries (outer stroke, inner counter) as distinguishable rings, not one simple
// closed loop. Verified against the original, pre-fix specimen defect this milestone was filed for
// (a fixed 25mm text height at SS30 gave "o" only 2 stones total) -- 10 comfortably catches that case
// while not flagging any counter-bearing character in a candidate using the corrected, per-size
// specimen heights (verified: this candidate's lowest counter-bearing count is well above 10 at every
// size).
export const MIN_STONE_COUNT_FOR_COUNTER_BEARING = 10;

// Reuses the exact chamfer-distance threshold productionAnalysis.mjs's SS16-only similarity check
// already validates against real candidates (see that module's own doc comment) -- applied here
// across *every* stone size, not just SS16, since two glyphs distinguishable at SS16 (more stones)
// can still collapse together at a size with fewer.
export const NEAR_IDENTICAL_CHAMFER_THRESHOLD = 0.09;

/**
 * Verifies the rhinestone specimen's own documented per-size scale (specimenPages.mjs) never renders
 * a stone smaller than MIN_STONE_PX -- the "a long specimen is rendered below the minimum readable
 * output scale" check the spec requires. This is a static property of the two constant tables (stone
 * diameters from the catalog, pxPerMm from the specimen renderer), not the candidate font, so it is
 * the same for every certification run -- included as a report line, and as its own regression test,
 * so a future change to either table can't silently violate the "never shrink below readable" rule.
 */
export function computeScaleCompliance() {
  const bySize = STONE_SIZE_IDS.map((sizeId) => {
    const stoneSizeMm = STONE_SIZE_BY_ID[sizeId].diameterMm;
    const pxPerMm = RHINESTONE_SPECIMEN_PX_PER_MM_BY_SIZE[sizeId];
    const renderedStonePx = Math.round(stoneSizeMm * pxPerMm * 100) / 100;
    return { sizeId, stoneSizeMm, pxPerMm, renderedStonePx, compliant: renderedStonePx >= MIN_STONE_PX };
  });
  return { minStonePx: MIN_STONE_PX, bySize, allCompliant: bySize.every((r) => r.compliant) };
}

/**
 * @param {object} productionAnalysis From productionAnalysis.runProductionAnalysis() -- must be the
 *   full in-memory object (with each result's `stones` array still present), i.e. called before
 *   certify.mjs strips that field for JSON output.
 */
export function computeReadabilityFindings(productionAnalysis) {
  const lowStoneCountFindings = [];
  const counterCollapseFindings = [];

  for (const [char, bySize] of productionAnalysis.glyphResults.entries()) {
    if (char.trim().length === 0) continue; // space has no stones by design, not a readability defect
    const isCounterBearing = COUNTER_BEARING_CHARACTERS.has(char);
    for (const [sizeId, result] of bySize.entries()) {
      if (result.error) continue;
      // General floor, every character: not enough stones to represent *any* glyph meaningfully.
      if (result.stoneCount < MIN_MEANINGFUL_STONE_COUNT) {
        lowStoneCountFindings.push({ char, sizeId, stoneCount: result.stoneCount, threshold: MIN_MEANINGFUL_STONE_COUNT });
      }
      // Stricter floor, counter-bearing characters only: enough to represent *any* glyph is not
      // necessarily enough to represent two boundaries (outer stroke + inner counter) distinctly.
      if (isCounterBearing && result.stoneCount > 0 && result.stoneCount < MIN_STONE_COUNT_FOR_COUNTER_BEARING) {
        counterCollapseFindings.push({ char, sizeId, stoneCount: result.stoneCount, threshold: MIN_STONE_COUNT_FOR_COUNTER_BEARING });
      }
    }
  }

  const nearIdenticalFindings = [];
  for (const sizeId of STONE_SIZE_IDS) {
    for (const [charA, charB] of CONFUSABLE_PAIRS) {
      const a = productionAnalysis.glyphResults.get(charA)?.get(sizeId);
      const b = productionAnalysis.glyphResults.get(charB)?.get(sizeId);
      if (!a || !b || a.error || b.error || !a.stones || !b.stones) continue;
      const distance = chamferDistance(normalizedStonePoints(a.stones), normalizedStonePoints(b.stones));
      if (distance !== null && distance < NEAR_IDENTICAL_CHAMFER_THRESHOLD) {
        nearIdenticalFindings.push({ pair: [charA, charB], sizeId, chamferDistance: distance, stoneCountA: a.stoneCount, stoneCountB: b.stoneCount });
      }
    }
  }

  const scaleCompliance = computeScaleCompliance();

  return { lowStoneCountFindings, counterCollapseFindings, nearIdenticalFindings, scaleCompliance };
}
