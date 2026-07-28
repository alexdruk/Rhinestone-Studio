#!/usr/bin/env node
/**
 * FONT-CAL-001 Step 3 -- diagnosis.
 *
 * Reads baseline.json (unmodified Sacramento, real production pipeline output) and ranks glyphs by
 * a single, evidence-grounded "production problem" signal: connected-cursive-stroke fragmentation
 * at the SS30 stress case, i.e. clusterCount at ss30 exceeding clusterCount at both ss6/ss10
 * controls for the same glyph. This is not a new metric -- clusterCount already comes from
 * productionAnalysis.mjs's own nearest-neighbor union-find (reused via measureProduction.mjs); this
 * script only compares it across stone sizes for the same glyph, which runProductionAnalysis()
 * itself never does (FONT-SOURCE-001's report only classifies per-size, not across sizes).
 *
 * Mechanism (read, not modified, from src/geometry/StoneSampler.js -- see that file's
 * sampleMultiContourOutlinePoints()/RC-004A doc comment): outline mode walks each contour's arc
 * length at fixed spacingMm, then prunes any later sample within minSeparationMm (= stoneSizeMm) of
 * an earlier one, same-contour or cross-contour alike. A cursive font's tight cusp or two nearby
 * contours can have that pruning remove several consecutive candidate points at once, leaving a real
 * gap in what should read as one connected stroke -- and that gap widens, in stone-diameter terms,
 * as stoneSizeMm grows from SS6/SS10 to SS30, even though isolatedCount/collisionCount (the
 * certification's own existing checks) never flag it, because the two resulting fragments are still
 * closer together than the isolation threshold (2.5x pitch). This experiment's target metric is
 * therefore clusterCount, not collision/isolation counts, which this baseline run confirms are zero
 * everywhere at the milestone's own mid heights (see console output below).
 *
 * Restricted to single-contour glyphs only (checked here against a fontTools-derived list, see
 * python/contour_counts.py) -- multi-contour glyphs (e.g. capital H/K, whose second/third contours
 * are small decorative flourish marks, confirmed via python/contour_counts.py's bounding-box dump)
 * fragment for a structurally different reason (a genuinely separate decorative mark, not a pinched
 * single stroke) that a single-vertex cusp modification cannot address, and are out of scope for
 * this experiment's chosen technique.
 *
 * Output: tools/font-cal-001/output/diagnosis.json with the ranked shortlist and the final
 * selection + reasoning (also printed to console for the experiment report).
 */
import { readFile, writeFile } from 'node:fs/promises';
import { repoPath } from '../font-certification/lib/repoPaths.mjs';

const BASELINE_PATH = repoPath('tools/font-cal-001/output/baseline.json');
const OUTPUT_PATH = repoPath('tools/font-cal-001/output/diagnosis.json');

// Single-contour glyphs in Sacramento (confirmed via tools/font-cal-001/python/contour_counts.py
// against the real Sacramento.ttf glyf table) -- the only glyphs this experiment's chosen
// modification technique (single-vertex cusp widening on one contour) can target.
const SINGLE_CONTOUR_GLYPHS = new Set([
  'a', 'c', 'k', 'm', 'n', 's', 'u', 'v', 'w', 'x',
  'C', 'I', 'M', 'N', 'S', 'T', 'U', 'V', 'W', 'X', 'Z',
  '1', '5', '6', '7', '9'
]);

async function main() {
  const baseline = JSON.parse(await readFile(BASELINE_PATH, 'utf8'));
  const bySize = {};
  for (const r of baseline.results) {
    if (r.text.length !== 1) continue;
    (bySize[r.stoneSizeId] ??= {})[r.text] = r;
  }

  // Confirm the two checks that already pass cleanly at mid height, so the report can state this
  // as measured fact rather than assumption.
  const nonZeroCollisionOrIsolation = baseline.results.filter((r) => (r.collisionCount ?? 0) > 0 || (r.isolatedCount ?? 0) > 0);
  const belowFloor = baseline.results.filter((r) => r.belowMeaningfulFloor);
  console.log(`Collisions/isolated-stone findings at mid height: ${nonZeroCollisionOrIsolation.length}`);
  console.log(`Below-meaningful-stone-count findings at mid height: ${belowFloor.length}`);

  const rows = [...SINGLE_CONTOUR_GLYPHS]
    .filter((ch) => bySize.ss30[ch] && bySize.ss6[ch] && bySize.ss10[ch])
    .map((ch) => {
      const s30 = bySize.ss30[ch], s6 = bySize.ss6[ch], s10 = bySize.ss10[ch];
      return {
        glyph: ch,
        clustersSs30: s30.clusterCount,
        clustersSs6: s6.clusterCount,
        clustersSs10: s10.clusterCount,
        stoneCountSs30: s30.stoneCount,
        fragmentationDelta: s30.clusterCount - Math.max(s6.clusterCount, s10.clusterCount)
      };
    })
    .sort((a, b) => b.fragmentationDelta - a.fragmentationDelta || b.clustersSs30 - a.clustersSs30);

  const selection = [
    {
      glyph: 'm',
      reason: 'Largest fragmentation delta among single-contour glyphs (3 clusters at SS30 vs 1 at both SS6 and SS10) -- the cleanest, strongest signal that SS30\'s coarser pitch is the cause, not the outline itself.'
    },
    {
      glyph: 'n',
      reason: 'Same fragmentation direction as "m" (2 clusters at SS30 vs 1 at both controls) at roughly half the stroke complexity -- tests whether the same modification technique generalizes to a smaller instance of the same problem.'
    },
    {
      glyph: 'v',
      reason: 'Already fragmented at one control (3 clusters at SS10, not just SS30) -- fragmentationDelta is 0, meaning this glyph\'s multi-cluster behavior is not purely an SS30-pitch artifact. Selected deliberately as a contrast case to test whether the same technique still helps, helps less, or should be rejected.'
    }
  ];

  const representativePhrase = {
    text: 'movement',
    reason: 'A common, all-lowercase decorative word containing all three selected glyphs in their exact selected case (m, v, n) -- unlike a capitalized name (e.g. "Marvin", rejected: its leading "M" is a different glyph than the lowercase "m" this experiment selected) -- so the whole-word measurement actually exercises the same three modified glyphs the isolated-glyph experiments do.'
  };

  const output = {
    generatedAt: new Date().toISOString(),
    checksConfirmedClean: {
      collisionOrIsolationFindings: nonZeroCollisionOrIsolation.length,
      belowMeaningfulStoneFloorFindings: belowFloor.length
    },
    targetMetric: 'clusterCount (connected-component count of the generated StoneLayout, from productionAnalysis.mjs)',
    rankedSingleContourGlyphs: rows,
    selection,
    representativePhrase
  };

  await writeFile(OUTPUT_PATH, JSON.stringify(output, null, 2));
  console.log(`Selected glyphs: ${selection.map((s) => s.glyph).join(', ')}`);
  console.log(`Representative phrase: "${representativePhrase.text}"`);
  console.log(`Wrote ${OUTPUT_PATH}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
