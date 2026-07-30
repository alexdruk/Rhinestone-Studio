#!/usr/bin/env node
/**
 * FONT-CAL-001 Step 1-2 -- baseline measurement.
 *
 * Runs unmodified Sacramento through the real, unmodified production pipeline
 * (measureProduction.mjs -> productionAnalysis.mjs's buildCandidateEngine/analyzeOne) at the
 * primary stress case (SS30) and both candidate controls (SS6, SS10), at each stone size's own
 * "mid" milestone height (HEIGHT_RANGE_MM_BY_SIZE from FONT-SOURCE-001's sourceEvaluation.mjs --
 * the same real production letter-height range already used to certify this exact font, not a
 * ratio-derived specimen-only height).
 *
 * Corpus reused unmodified from tools/font-certification/lib/requiredCharacters.mjs
 * (PRODUCTION_REVIEW_GLYPHS / PRODUCTION_REVIEW_WORDS) -- the same character/word set
 * FONT-SOURCE-001 already certified this font against, so results are directly comparable to
 * fonts/review/Sacramento/report.json.
 *
 * Output: tools/font-cal-001/output/baseline.json (stones stripped) -- consumed by diagnose.mjs.
 */
import { writeFile, mkdir } from 'node:fs/promises';
import { repoPath } from '../font-certification/lib/repoPaths.mjs';
import { HEIGHT_RANGE_MM_BY_SIZE } from '../font-certification/lib/sourceEvaluation.mjs';
import { PRODUCTION_REVIEW_GLYPHS, PRODUCTION_REVIEW_WORDS } from '../font-certification/lib/requiredCharacters.mjs';
import { measureFont, forJson } from './lib/measureProduction.mjs';

const SACRAMENTO_PATH = repoPath('fonts/sources/Sacramento/Sacramento.ttf');
const STONE_SIZE_IDS = ['ss6', 'ss10', 'ss30']; // ss30 = primary stress case; ss6/ss10 = controls
const OUTPUT_PATH = repoPath('tools/font-cal-001/output/baseline.json');

function midHeightMm(sizeId) {
  const { min, max } = HEIGHT_RANGE_MM_BY_SIZE[sizeId];
  return (min + max) / 2;
}

function buildCases() {
  const cases = [];
  for (const sizeId of STONE_SIZE_IDS) {
    const heightMm = midHeightMm(sizeId);
    for (const char of PRODUCTION_REVIEW_GLYPHS) {
      cases.push({ text: char, stoneSizeId: sizeId, heightMm, label: char });
    }
    for (const word of PRODUCTION_REVIEW_WORDS) {
      cases.push({ text: word, stoneSizeId: sizeId, heightMm, label: word });
    }
  }
  return cases;
}

async function main() {
  console.log(`FONT-CAL-001 baseline: measuring ${SACRAMENTO_PATH} at ${STONE_SIZE_IDS.join(', ')} (mid milestone heights)`);
  const cases = buildCases();
  const results = await measureFont(SACRAMENTO_PATH, cases);

  await mkdir(repoPath('tools/font-cal-001/output'), { recursive: true });
  const output = {
    candidatePath: 'fonts/sources/Sacramento/Sacramento.ttf',
    generatedAt: new Date().toISOString(),
    heightMmBySize: Object.fromEntries(STONE_SIZE_IDS.map((id) => [id, midHeightMm(id)])),
    heightRangeMmBySize: HEIGHT_RANGE_MM_BY_SIZE,
    stoneSizeIds: STONE_SIZE_IDS,
    results: forJson(results)
  };
  await writeFile(OUTPUT_PATH, JSON.stringify(output, null, 2));
  console.log(`Wrote ${results.length} measurements to ${OUTPUT_PATH}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
