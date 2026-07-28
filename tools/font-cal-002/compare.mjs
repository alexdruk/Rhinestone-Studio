#!/usr/bin/env node
/**
 * FONT-CAL-002 -- reporting: builds Markdown comparison tables directly from the JSON files
 * validate.mjs wrote (tools/font-cal-002/output/candidate-*.json), same approach as
 * ../font-cal-001/compare.mjs. Also accepts font-cal-001 labels via --cal001 so this milestone's
 * span modifications can be tabulated alongside FONT-CAL-001's single-vertex/height-scaling
 * candidates in one table without copying those JSON files.
 *
 * Usage: node compare.mjs <label1> <label2> ... [--cal001 <label3> <label4> ...]
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFile } from 'node:fs/promises';
import { repoPath } from '../font-certification/lib/repoPaths.mjs';

const SELECTED_GLYPHS = ['m', 'n', 'v'];
const PHRASE = 'movement';
const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function loadLabel(label, dir) {
  const p = path.join(dir, `candidate-${label}.json`);
  return JSON.parse(await readFile(p, 'utf8'));
}

function row(result) {
  if (!result) return '(missing)';
  return `stones=${result.stoneCount} clusters=${result.clusterCount} collisions=${result.collisionCount} isolated=${result.isolatedCount} bbox=${result.boundingBoxMm ? `${result.boundingBoxMm.widthMm.toFixed(1)}x${result.boundingBoxMm.heightMm.toFixed(1)}mm` : 'n/a'}`;
}

function parseArgs(argv) {
  const splitIndex = argv.indexOf('--cal001');
  if (splitIndex === -1) return { local: argv, cal001: [] };
  return { local: argv.slice(0, splitIndex), cal001: argv.slice(splitIndex + 1) };
}

async function main() {
  const { local, cal001 } = parseArgs(process.argv.slice(2));
  if (local.length === 0 && cal001.length === 0) {
    throw new Error('Usage: node compare.mjs <label1> <label2> ... [--cal001 <label3> ...]');
  }

  const data = {};
  for (const label of local) data[label] = await loadLabel(label, path.join(__dirname, 'output'));
  for (const label of cal001) data[`cal001:${label}`] = await loadLabel(label, repoPath('tools/font-cal-001/output'));

  const labels = [...local, ...cal001.map((l) => `cal001:${l}`)];
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
