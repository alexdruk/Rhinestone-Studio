#!/usr/bin/env node
/**
 * FONT-CAL-001 -- reporting: builds the Markdown comparison tables used in the experiment report
 * directly from the JSON files baseline.mjs/validate.mjs already wrote (tools/font-cal-001/output/
 * candidate-*.json), so the report's numbers are read from measured data, never hand-transcribed.
 *
 * Usage: node compare.mjs <label1> <label2> ... (labels correspond to candidate-<label>.json files)
 */
import { readFile } from 'node:fs/promises';
import { repoPath } from '../font-certification/lib/repoPaths.mjs';

const SELECTED_GLYPHS = ['m', 'n', 'v'];
const PHRASE = 'movement';

async function loadLabel(label) {
  const p = repoPath(`tools/font-cal-001/output/candidate-${label}.json`);
  return JSON.parse(await readFile(p, 'utf8'));
}

function row(result) {
  if (!result) return '(missing)';
  return `stones=${result.stoneCount} clusters=${result.clusterCount} collisions=${result.collisionCount} isolated=${result.isolatedCount} bbox=${result.boundingBoxMm ? `${result.boundingBoxMm.widthMm.toFixed(1)}x${result.boundingBoxMm.heightMm.toFixed(1)}mm` : 'n/a'}`;
}

async function main() {
  const labels = process.argv.slice(2);
  if (labels.length === 0) throw new Error('Usage: node compare.mjs <label1> <label2> ...');

  const data = {};
  for (const label of labels) data[label] = await loadLabel(label);

  for (const sizeId of ['ss6', 'ss10', 'ss30']) {
    console.log(`\n### ${sizeId.toUpperCase()}`);
    console.log('| label | ' + [...SELECTED_GLYPHS, PHRASE].join(' | ') + ' |');
    console.log('|---|' + [...SELECTED_GLYPHS, PHRASE].map(() => '---').join('|') + '|');
    for (const label of labels) {
      const d = data[label];
      const cells = [...SELECTED_GLYPHS, PHRASE].map((text) => {
        const r = d.results.find((x) => x.stoneSizeId === sizeId && x.text === text);
        return row(r);
      });
      console.log(`| ${label} | ${cells.join(' | ')} |`);
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
