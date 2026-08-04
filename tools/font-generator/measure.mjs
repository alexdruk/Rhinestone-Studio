#!/usr/bin/env node
/**
 * FONT-GEN-001 -- batch production measurement CLI.
 *
 * Thin wrapper around tools/font-cal-001/lib/measureProduction.mjs's measureFont(), which itself
 * reuses tools/font-certification/lib/productionAnalysis.mjs's buildCandidateEngine/analyzeOne --
 * the real, unmodified FontManager -> OpenTypeProvider -> GeometryEngine.generateTextLayout()
 * pipeline. No parallel geometry or stone-generation logic here; this only lets one Node process
 * point that same measurement at an arbitrary font path and an arbitrary case list (this
 * milestone's corpus.json), one process per font instead of one per corpus item.
 *
 * Usage:
 *   node tools/font-generator/measure.mjs <input.json> <output.json>
 *
 * <input.json>: { "fontPath": "<absolute path>", "cases": [{ "id", "text", "stoneSizeId", "heightMm" }] }
 * <output.json>: { "fontPath", "results": [ ...analyzeOne() results incl. stones ] }
 */
import { readFile, writeFile } from 'node:fs/promises';
import { measureFont } from '../font-cal-001/lib/measureProduction.mjs';

async function main() {
  const [inputPath, outputPath] = process.argv.slice(2);
  if (!inputPath || !outputPath) {
    console.error('Usage: node measure.mjs <input.json> <output.json>');
    process.exit(1);
  }

  const spec = JSON.parse(await readFile(inputPath, 'utf8'));
  const cases = spec.cases.map((c) => ({ ...c, label: c.id }));
  const results = await measureFont(spec.fontPath, cases);

  await writeFile(outputPath, JSON.stringify({ fontPath: spec.fontPath, results }, null, 2));
  console.error(`[measure.mjs] ${results.length} cases -> ${outputPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
