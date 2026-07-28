#!/usr/bin/env node
/**
 * FONT-CAL-001 Step 6-7 -- production validation.
 *
 * Runs a candidate TTF (or the unmodified Sacramento, for the height-scaling comparison) through
 * the exact same real, unmodified production pipeline as baseline.mjs (measureProduction.mjs ->
 * productionAnalysis.mjs's buildCandidateEngine/analyzeOne). No parallel measurement logic.
 *
 * Usage:
 *   node validate.mjs <candidateTtfPath> <label> [--height-override ss30=125]
 *
 * Always measures the 3 selected glyphs (m, n, v) + representative phrase ("Marvin") at ss6/ss10/
 * ss30, at each stone size's own milestone mid-height (same as baseline.mjs), unless
 * --height-override is given (used for the height-scaling comparison in section 7 of the report).
 */
import path from 'node:path';
import { writeFile, mkdir } from 'node:fs/promises';
import { repoPath } from '../font-certification/lib/repoPaths.mjs';
import { HEIGHT_RANGE_MM_BY_SIZE } from '../font-certification/lib/sourceEvaluation.mjs';
import { measureFont, forJson } from './lib/measureProduction.mjs';

const SELECTED_GLYPHS = ['m', 'n', 'v'];
const REPRESENTATIVE_PHRASE = 'movement';
const STONE_SIZE_IDS = ['ss6', 'ss10', 'ss30'];

function midHeightMm(sizeId) {
  const { min, max } = HEIGHT_RANGE_MM_BY_SIZE[sizeId];
  return (min + max) / 2;
}

function parseArgs(argv) {
  const [candidatePath, label, ...rest] = argv;
  if (!candidatePath || !label) {
    throw new Error('Usage: node validate.mjs <candidateTtfPath> <label> [--height-override ss30=125]');
  }
  const heightOverrides = {};
  for (let i = 0; i < rest.length; i++) {
    if (rest[i] === '--height-override' && rest[i + 1]) {
      const [sizeId, mm] = rest[i + 1].split('=');
      heightOverrides[sizeId] = Number(mm);
      i++;
    }
  }
  return { candidatePath, label, heightOverrides };
}

function buildCases(heightOverrides) {
  const cases = [];
  for (const sizeId of STONE_SIZE_IDS) {
    const heightMm = heightOverrides[sizeId] ?? midHeightMm(sizeId);
    for (const glyph of SELECTED_GLYPHS) {
      cases.push({ text: glyph, stoneSizeId: sizeId, heightMm, label: glyph });
    }
    cases.push({ text: REPRESENTATIVE_PHRASE, stoneSizeId: sizeId, heightMm, label: REPRESENTATIVE_PHRASE });
  }
  return cases;
}

async function main() {
  const { candidatePath, label, heightOverrides } = parseArgs(process.argv.slice(2));
  const absolutePath = path.isAbsolute(candidatePath) ? candidatePath : repoPath(candidatePath);
  const cases = buildCases(heightOverrides);

  console.log(`FONT-CAL-001 validate: measuring ${absolutePath} (label="${label}")`);
  const results = await measureFont(absolutePath, cases);

  const heightMmBySize = Object.fromEntries(STONE_SIZE_IDS.map((id) => [id, heightOverrides[id] ?? midHeightMm(id)]));
  const outputDir = repoPath('tools/font-cal-001/output');
  await mkdir(outputDir, { recursive: true });
  const outputPath = path.join(outputDir, `candidate-${label}.json`);
  const output = {
    label,
    candidatePath,
    generatedAt: new Date().toISOString(),
    heightMmBySize,
    stoneSizeIds: STONE_SIZE_IDS,
    selectedGlyphs: SELECTED_GLYPHS,
    representativePhrase: REPRESENTATIVE_PHRASE,
    results: forJson(results)
  };
  await writeFile(outputPath, JSON.stringify(output, null, 2));

  for (const r of forJson(results)) {
    console.log(`  ${r.stoneSizeId} "${r.text}": stones=${r.stoneCount} clusters=${r.clusterCount} collisions=${r.collisionCount} isolated=${r.isolatedCount}`);
  }
  console.log(`Wrote ${outputPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
