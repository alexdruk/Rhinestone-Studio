/**
 * RS-1008A — captures tools/image-trace-regression-baselines.json from a known-good Image Trace
 * implementation, for tools/test-image-trace-regression.mjs to replay against.
 *
 * Deliberately not run by `npm test` (mirrors tools/generate-example-baselines.mjs's precedent) —
 * only run this again if a *deliberate*, reviewed change to Image Trace output is intended. An
 * unexpected diff after running this script is a regression, not something to silently accept.
 */

import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createImageBuffer } from '../src/image/index.js';
import { buildRegressionCases } from './lib/imageTraceFixtures.mjs';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const outPath = path.join(repoRoot, 'tools', 'image-trace-regression-baselines.json');

// NOTE: this generator imports traceImageBufferToStoneLayout, the pre-RS-1008A implementation
// that built Stone/StoneLayout directly inside src/image/**. It must only ever be re-run against
// that known-good implementation (i.e. do not "fix" this import if it later starts failing after
// RS-1008A's refactor removes the export -- that removal is the whole point of RS-1008A, and this
// script's job is done once its baseline is captured and committed).
const { traceImageBufferToStoneLayout } = await import('../src/image/index.js');

const cases = buildRegressionCases(createImageBuffer);
const baselines = {};
for (const { name, buffer, params } of cases) {
  baselines[name] = traceImageBufferToStoneLayout(buffer, params).toJSON();
}

await writeFile(outPath, JSON.stringify(baselines, null, 2) + '\n', 'utf8');
console.log(`Wrote ${Object.keys(baselines).length} baseline case(s) to ${path.relative(repoRoot, outPath)}`);
