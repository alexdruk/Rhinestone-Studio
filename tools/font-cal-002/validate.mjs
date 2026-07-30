#!/usr/bin/env node
/**
 * FONT-CAL-002 -- production validation.
 *
 * Thin wrapper identical in spirit to ../font-cal-001/validate.mjs, writing into this milestone's
 * own output/ directory instead. Reuses the same shared measurement module
 * (../font-cal-001/lib/measureProduction.mjs -> productionAnalysis.mjs) rather than re-deriving
 * StoneLayout generation or its metrics -- no new geometry or stone-generation logic here.
 *
 * Usage:
 *   node validate.mjs <candidateTtfPath> <label> [--height-override ss30=125]
 *
 * Always measures the same 3 glyphs + representative phrase FONT-CAL-001 selected (m, n, v /
 * "movement") at ss6/ss10/ss30, at each stone size's own milestone mid-height, so
 * tools/font-cal-002 output stays directly comparable to tools/font-cal-001 output via compare.mjs.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeFile, mkdir } from 'node:fs/promises';
import { repoPath } from '../font-certification/lib/repoPaths.mjs';
import { HEIGHT_RANGE_MM_BY_SIZE } from '../font-certification/lib/sourceEvaluation.mjs';
import { measureFont, forJson } from '../font-cal-001/lib/measureProduction.mjs';

const SELECTED_GLYPHS = ['m', 'n', 'v'];
const REPRESENTATIVE_PHRASE = 'movement';
const STONE_SIZE_IDS = ['ss6', 'ss10', 'ss30'];
const __dirname = path.dirname(fileURLToPath(import.meta.url));

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

  console.log(`FONT-CAL-002 validate: measuring ${absolutePath} (label="${label}")`);
  const results = await measureFont(absolutePath, cases);

  const heightMmBySize = Object.fromEntries(STONE_SIZE_IDS.map((id) => [id, heightOverrides[id] ?? midHeightMm(id)]));
  const outputDir = path.join(__dirname, 'output');
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
