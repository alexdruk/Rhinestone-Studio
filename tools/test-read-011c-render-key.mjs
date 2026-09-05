import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertTestRegistered } from './lib/test-registration-assertions.mjs';

// READ-011C -- docs/data/read-011/render-key.json is the key produced by
// tools/font-certification/read-011-renders.mjs alongside the (gitignored) specimen renders. It
// carries the frozen READ-011B design forward unchanged and adds, per entry, the resolved letter
// spacing plus the three separation numbers and the seeded presentation index. This suite pins that
// contract so a re-render that quietly drops an entry, mislabels a separation result, or breaks the
// presentation permutation fails loudly:
//   1. the key covers every plan slug exactly once, with no extras;
//   2. every plan field is carried through unchanged;
//   3. every separation entry has all four tracking fields, with separationAchieved consistent with
//      separationRatioAfter against the 0.95 threshold;
//   4. every none entry has zero letter spacing;
//   5. presentation indices form a complete 0..n-1 permutation;
//   6. this file is registered in the geometry group and runs in both the default and full suites.
//
// It asserts nothing about image files on disk -- the renders are gitignored, so this test must pass
// on a bare clone. Its whole import graph is this file, node: builtins and the test-registration
// helper (which reads tools/test-groups.mjs + run-tests.mjs) -- no src/, no Playwright.

const repoRoot = fileURLToPath(new URL('..', import.meta.url));

const plan = JSON.parse(await readFile(path.join(repoRoot, 'docs/data/read-011/render-plan.json'), 'utf8'));
const key = JSON.parse(await readFile(path.join(repoRoot, 'docs/data/read-011/render-key.json'), 'utf8'));

const planEntries = plan.entries;
const keyEntries = key.entries;
const keyBySlug = new Map(keyEntries.map((e) => [e.slug, e]));

const PLAN_FIELDS = [
  'slug', 'fontId', 'stemRegime', 'stemWidthRatio', 'mode', 'ratio', 'stoneSizeId',
  'stoneDiameterMm', 'heightMm', 'text', 'trackingTarget', 'block', 'repeatOf'
];
const SEPARATION_THRESHOLD = plan.meta.separationTargetRatio ?? 0.95;

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

await test('1. the key covers every plan slug exactly once, with no extras', () => {
  assert.equal(keyEntries.length, planEntries.length, 'entry count');
  const planSlugs = planEntries.map((e) => e.slug).sort();
  const keySlugs = keyEntries.map((e) => e.slug).sort();
  assert.deepEqual(keySlugs, planSlugs, 'slug sets match exactly');
  assert.equal(new Set(keySlugs).size, keySlugs.length, 'no duplicate slug in the key');
});

await test('2. every plan field is carried through unchanged', () => {
  for (const p of planEntries) {
    const k = keyBySlug.get(p.slug);
    assert.ok(k, `plan slug ${p.slug} missing from key`);
    for (const f of PLAN_FIELDS) {
      assert.deepEqual(k[f], p[f], `entry ${p.slug} field "${f}" (${JSON.stringify(k[f])} != ${JSON.stringify(p[f])})`);
    }
  }
});

await test('3. every separation entry has all four tracking fields, separationAchieved consistent with the 0.95 threshold', () => {
  const sep = keyEntries.filter((e) => e.trackingTarget === 'separation');
  assert.ok(sep.length > 0, 'the design has separation entries');
  for (const e of sep) {
    assert.equal(typeof e.letterSpacingMm, 'number', `entry ${e.slug} letterSpacingMm is a number`);
    assert.ok(Number.isFinite(e.letterSpacingMm) && e.letterSpacingMm >= 0, `entry ${e.slug} letterSpacingMm >= 0`);
    assert.equal(typeof e.separationRatioBefore, 'number', `entry ${e.slug} separationRatioBefore is a number`);
    assert.equal(typeof e.separationRatioAfter, 'number', `entry ${e.slug} separationRatioAfter is a number`);
    assert.equal(typeof e.separationAchieved, 'boolean', `entry ${e.slug} separationAchieved is a boolean`);
    assert.equal(
      e.separationAchieved,
      e.separationRatioAfter >= SEPARATION_THRESHOLD,
      `entry ${e.slug}: separationAchieved=${e.separationAchieved} but separationRatioAfter=${e.separationRatioAfter} vs threshold ${SEPARATION_THRESHOLD}`
    );
  }
});

await test('4. every none entry has zero letter spacing', () => {
  const none = keyEntries.filter((e) => e.trackingTarget === 'none');
  assert.ok(none.length > 0);
  for (const e of none) {
    assert.strictEqual(e.letterSpacingMm, 0, `entry ${e.slug} (trackingTarget none) letterSpacingMm must be 0`);
  }
});

await test('5. presentation indices form a complete 0..n-1 permutation', () => {
  const indices = keyEntries.map((e) => e.presentationIndex).sort((a, b) => a - b);
  assert.deepEqual(indices, [...Array(keyEntries.length).keys()], 'indices are exactly 0..n-1 with no gaps or repeats');
});

await test('6. this file is registered in the geometry group and runs in both the default and full suites', () => {
  assertTestRegistered({
    filename: 'test-read-011c-render-key.mjs',
    group: 'geometry',
    includedInDefault: true
  });
});

console.log('READ-011C render-key tests passed.');
