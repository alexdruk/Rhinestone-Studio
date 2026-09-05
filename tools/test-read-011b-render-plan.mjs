import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertTestRegistered } from './lib/test-registration-assertions.mjs';

// READ-011B -- docs/data/read-011/render-plan.json is the frozen experimental design for the
// READ-011 rating pass, enumerated by tools/font-certification/read-011-plan.mjs. This suite pins
// the design's own invariants so a regenerate that quietly changes the factorial, the stratum
// definitions, or the balance fails loudly:
//   1. every entry's fontId is an enabled manifest font;
//   2. every entry's stemRegime is exactly classifyStemRegime() on that font's manifest stemWidthRatio;
//   3. every slug is a unique 8-hex string;
//   4. heightMm == ratio x stoneDiameterMm and lands inside the 4-111mm engine bound;
//   5. the main grid is a balanced full factorial (every regime x mode x rung x tracking cell has
//      exactly two entries; per-font counts within a regime differ by at most one);
//   6. every size-invariance entry has a matching SS10 main-grid counterpart (font, mode, rung);
//   7. every repeatOf resolves to a real non-repeat entry, and repeatOf is null everywhere else;
//   8. the rhinestone probe holds only unmeasured-regime fonts;
//   9. this file is registered in the geometry group and runs in both the default and full suites.

const repoRoot = fileURLToPath(new URL('..', import.meta.url));

const { classifyStemRegime, STEM_REGIME } = await import('../src/geometry/StemRegime.js');

const manifest = JSON.parse(await readFile(path.join(repoRoot, 'assets/fonts/manifest.json'), 'utf8'));
const fontById = new Map(manifest.fonts.map((f) => [f.id, f]));

const plan = JSON.parse(
  await readFile(path.join(repoRoot, 'docs/data/read-011/render-plan.json'), 'utf8')
);
const entries = plan.entries;

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

const RECORDED_FIELDS = [
  'slug', 'fontId', 'stemRegime', 'stemWidthRatio', 'mode', 'ratio', 'stoneSizeId',
  'stoneDiameterMm', 'heightMm', 'text', 'trackingTarget', 'block', 'repeatOf'
];

const MAIN_REGIMES = ['monoline', 'transitional', 'massed'];
const MODES = ['outline', 'fill'];
const RUNGS = [16, 17.5, 19, 20.5, 22];
const TRACKING = ['none', 'separation'];

await test('0. plan shape: meta.seed recorded, block counts sum to the entry total, every entry carries exactly the 13 recorded fields', () => {
  assert.equal(typeof plan.meta.seed, 'number', 'meta.seed must be recorded');
  assert.ok(entries.length > 0);
  const blockSum = Object.values(plan.meta.blocks).reduce((a, b) => a + b, 0);
  assert.equal(blockSum, entries.length);
  assert.equal(plan.meta.total, entries.length);
  for (const e of entries) {
    assert.deepEqual(Object.keys(e).sort(), [...RECORDED_FIELDS].sort(), `entry ${e.slug} field set`);
  }
});

await test('1. every entry fontId is an enabled manifest font', () => {
  for (const e of entries) {
    const font = fontById.get(e.fontId);
    assert.ok(font, `entry ${e.slug} references unknown font "${e.fontId}"`);
    assert.notEqual(font.enabled, false, `font "${e.fontId}" is disabled in the manifest`);
  }
});

await test('2. every entry stemRegime == classifyStemRegime() on that font\'s manifest stemWidthRatio', () => {
  for (const e of entries) {
    const expected = classifyStemRegime(fontById.get(e.fontId).stemWidthRatio);
    assert.equal(e.stemRegime, expected, `entry ${e.slug} (${e.fontId})`);
    const manifestRatio = fontById.get(e.fontId).stemWidthRatio;
    const expectedRecorded = typeof manifestRatio === 'number' && Number.isFinite(manifestRatio)
      ? manifestRatio
      : null;
    assert.equal(e.stemWidthRatio, expectedRecorded, `entry ${e.slug} stemWidthRatio`);
  }
});

await test('3. every slug is a unique 8-hex string', () => {
  const seen = new Set();
  for (const e of entries) {
    assert.match(e.slug, /^[0-9a-f]{8}$/, `slug ${e.slug}`);
    assert.ok(!seen.has(e.slug), `duplicate slug ${e.slug}`);
    seen.add(e.slug);
  }
});

await test('4. heightMm == ratio x stoneDiameterMm and lies within the 4-111mm engine bound', () => {
  for (const e of entries) {
    assert.equal(e.heightMm, e.ratio * e.stoneDiameterMm, `entry ${e.slug} heightMm`);
    assert.ok(e.heightMm >= 4 && e.heightMm <= 111, `entry ${e.slug} heightMm ${e.heightMm} out of 4-111`);
  }
});

await test('5. the main grid is a balanced full factorial', () => {
  const main = entries.filter((e) => e.block === 'main');
  assert.equal(main.length, MAIN_REGIMES.length * MODES.length * RUNGS.length * TRACKING.length * 2);

  const cell = new Map();
  for (const e of main) {
    assert.ok(MAIN_REGIMES.includes(e.stemRegime), `main entry ${e.slug} regime ${e.stemRegime}`);
    assert.ok(MODES.includes(e.mode));
    assert.ok(RUNGS.includes(e.ratio));
    assert.ok(TRACKING.includes(e.trackingTarget));
    assert.equal(e.stoneSizeId, 'ss10', 'every main-grid cell is at SS10');
    const key = [e.stemRegime, e.mode, e.ratio, e.trackingTarget].join('|');
    cell.set(key, (cell.get(key) || 0) + 1);
  }
  for (const regime of MAIN_REGIMES) {
    for (const mode of MODES) {
      for (const ratio of RUNGS) {
        for (const t of TRACKING) {
          const key = [regime, mode, ratio, t].join('|');
          assert.equal(cell.get(key), 2, `cell ${key} must hold exactly two entries`);
        }
      }
    }
  }

  for (const regime of MAIN_REGIMES) {
    const counts = new Map();
    for (const e of main.filter((x) => x.stemRegime === regime)) {
      counts.set(e.fontId, (counts.get(e.fontId) || 0) + 1);
    }
    const pool = plan.meta.strata.find((s) => s.id === regime).pool;
    assert.deepEqual([...counts.keys()].sort(), [...pool].sort(), `${regime}: every pool font used`);
    const values = [...counts.values()];
    assert.ok(Math.max(...values) - Math.min(...values) <= 1, `${regime}: per-font counts differ by >1`);
  }
});

await test('6. every size-invariance entry has a matching SS10 main-grid counterpart on font, mode and rung', () => {
  const si = entries.filter((e) => e.block === 'size-invariance');
  assert.ok(si.length > 0);
  const main = entries.filter((e) => e.block === 'main');
  for (const e of si) {
    assert.ok(['ss16', 'ss20'].includes(e.stoneSizeId), `size-invariance ${e.slug} stone`);
    assert.equal(e.ratio, 19, 'size-invariance replicates rung 19');
    assert.equal(e.trackingTarget, 'none');
    const counterpart = main.find(
      (m) => m.fontId === e.fontId && m.mode === e.mode && m.ratio === e.ratio && m.stoneSizeId === 'ss10'
    );
    assert.ok(counterpart, `size-invariance ${e.slug} (${e.fontId}/${e.mode}) has no SS10 counterpart`);
  }
});

await test('7. every repeatOf resolves to a real non-repeat entry; repeatOf is null everywhere else', () => {
  const bySlug = new Map(entries.map((e) => [e.slug, e]));
  for (const e of entries) {
    if (e.block === 'repeats') {
      const src = bySlug.get(e.repeatOf);
      assert.ok(src, `repeat ${e.slug} repeatOf ${e.repeatOf} does not resolve`);
      assert.notEqual(src.block, 'repeats', `repeat ${e.slug} points at another repeat`);
    } else {
      assert.equal(e.repeatOf, null, `entry ${e.slug} (block ${e.block}) must have repeatOf null`);
    }
  }
});

await test('8. the rhinestone probe contains only unmeasured-regime fonts', () => {
  const probe = entries.filter((e) => e.block === 'rhinestone-probe');
  assert.ok(probe.length > 0);
  for (const e of probe) {
    assert.equal(
      classifyStemRegime(fontById.get(e.fontId).stemWidthRatio),
      STEM_REGIME.UNMEASURED,
      `rhinestone-probe entry ${e.slug} (${e.fontId}) is not an unmeasured-regime font`
    );
    assert.equal(e.stemRegime, STEM_REGIME.UNMEASURED);
  }
});

await test('9. this file is registered in the geometry group and runs in both the default and full suites', () => {
  assertTestRegistered({
    filename: 'test-read-011b-render-plan.mjs',
    group: 'geometry',
    includedInDefault: true
  });
});

console.log('READ-011B render-plan design tests passed.');
