// READ-005B — golden-file guard for the READ-005 ratings analysis.
//
// Every table in docs/specifications/READ-005A-CalibrationFindings.md is recomputed by
// tools/font-certification/analyze-ratings.mjs from the four tracked files in docs/data/read-005/.
// This test pins that computation to the committed golden file docs/data/read-005/derived-tables.json
// so the findings fail loudly if the analysis ever drifts from the data. It imports computeAll()
// directly (no subprocess), never reads f-ladder.json, and runs in well under a second.

import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { computeAll, parseCsv, readCsvObjects } from './font-certification/analyze-ratings.mjs';
import { assertTestRegistered } from './lib/test-registration-assertions.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA_DIR = path.join(REPO_ROOT, 'docs', 'data', 'read-005');

async function test(name, fn) {
  try {
    await fn();
    console.log(`✓ ${name}`);
  } catch (error) {
    console.error(`✗ ${name}`);
    console.error(error);
    process.exitCode = 1;
  }
}

await test('1. computeAll() deep-equals the committed derived-tables.json', () => {
  const golden = JSON.parse(readFileSync(path.join(DATA_DIR, 'derived-tables.json'), 'utf8'));
  assert.deepEqual(computeAll(), golden);
});

await test('2. the four input files exist and parse, with 135 and 75 data rows', () => {
  for (const f of ['ratings.csv', 'calibration-key.json', 'tracking-renders-ratings.csv', 'tracking-key.json']) {
    assert.ok(existsSync(path.join(DATA_DIR, f)), `${f} is missing`);
  }
  const s1 = readCsvObjects(path.join(DATA_DIR, 'ratings.csv'));
  const s2 = readCsvObjects(path.join(DATA_DIR, 'tracking-renders-ratings.csv'));
  assert.equal(s1.length, 135, 'ratings.csv should have 135 data rows');
  assert.equal(s2.length, 75, 'tracking-renders-ratings.csv should have 75 data rows');
  // Guard against a line-based reader: the embedded-newline rows would inflate these counts.
  assert.ok(parseCsv(readFileSync(path.join(DATA_DIR, 'ratings.csv'), 'utf8')).length === 136);

  const calibKey = JSON.parse(readFileSync(path.join(DATA_DIR, 'calibration-key.json'), 'utf8'));
  const trackKey = JSON.parse(readFileSync(path.join(DATA_DIR, 'tracking-key.json'), 'utf8'));
  assert.equal(Object.keys(calibKey).length, 135);
  assert.equal(Object.keys(trackKey).length, 75);
});

await test('3. every ratings slug appears in the matching key, and vice versa', () => {
  const pairs = [
    ['ratings.csv', 'calibration-key.json'],
    ['tracking-renders-ratings.csv', 'tracking-key.json'],
  ];
  for (const [csvFile, keyFile] of pairs) {
    const rows = readCsvObjects(path.join(DATA_DIR, csvFile));
    const key = JSON.parse(readFileSync(path.join(DATA_DIR, keyFile), 'utf8'));
    const csvSlugs = new Set(rows.map((r) => r.slug));
    const keySlugs = new Set(Object.keys(key));
    assert.equal(csvSlugs.size, rows.length, `${csvFile} has duplicate slugs`);
    for (const s of csvSlugs) assert.ok(keySlugs.has(s), `${csvFile} slug ${s} missing from ${keyFile}`);
    for (const s of keySlugs) assert.ok(csvSlugs.has(s), `${keyFile} slug ${s} missing from ${csvFile}`);
  }
});

await test('4. pairedWith over paired-tracked is one-to-one into paired-control', () => {
  const key = JSON.parse(readFileSync(path.join(DATA_DIR, 'tracking-key.json'), 'utf8'));
  const tracked = Object.keys(key).filter((s) => key[s].block === 'paired-tracked');
  const partners = tracked.map((s) => key[s].pairedWith);
  assert.ok(partners.every((p) => key[p] && key[p].block === 'paired-control'), 'every partner is a paired-control row');
  assert.equal(new Set(partners).size, partners.length, 'pairing is one-to-one');
  // and the relation is symmetric
  for (const t of tracked) assert.equal(key[key[t].pairedWith].pairedWith, t, `${t} pairing is not symmetric`);
});

await test('5. this file is registered in tools/test-groups.mjs (documentation group) and the default suite', () => {
  assertTestRegistered({
    filename: 'test-read-005-derived-tables.mjs',
    group: 'documentation',
    includedInDefault: true,
  });
});

await test('6. every banded table partitions its declared population (band counts sum exactly)', () => {
  const data = computeAll();
  const sumBands = (bands) => Object.values(bands).reduce((acc, b) => acc + b.n, 0);
  const checks = [];

  for (const m of data.session1.modeRatio) {
    checks.push([`session1.modeRatio[${m.mode}].bands`, sumBands(m.bands), m.n]);
  }
  checks.push([
    'session1.scriptFaceBands.bands',
    sumBands(data.session1.scriptFaceBands.bands),
    data.session1.scriptFaceBands.n,
  ]);
  for (const g of data.session1.interiorFidelity.groups) {
    checks.push([
      `session1.interiorFidelity[${g.modes.join('+')}]`,
      sumBands(g.byBand),
      g.population,
    ]);
  }

  assert.ok(checks.length >= 7, `expected to find several banded tables, found ${checks.length}`);
  for (const [label, sum, population] of checks) {
    assert.equal(sum, population, `${label}: band counts sum to ${sum}, population is ${population}`);
  }

  // The script-face top band must be open-ended: a ratio of exactly 32.0 belongs in it.
  assert.ok('29+' in data.session1.scriptFaceBands.bands, 'script-face top band should be "29+"');
});

if (process.exitCode === 1) {
  console.error('\nREAD-005 derived-tables check FAILED.');
} else {
  console.log('\nREAD-005 derived-tables check passed.');
}
