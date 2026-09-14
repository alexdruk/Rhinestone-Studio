// READ-011E — reachability dry-run for the READ-011D selection rule.
//
// docs/specifications/READ-011E-PreRegistrationDefect.md records that READ-011D's §6 selection
// rule — "convert each regime's chosen Form-B ratio cut to stones through that regime's pool-median
// stemWidthRatio; if the three converted values lie within ±0.25 stones, adopt Form A, otherwise
// Form B" — could never adopt Form A, and that Form B was power-capped below the band under test.
// Both facts were computable from the committed render key and manifest at the READ-011D commit,
// before a single specimen was rated.
//
// This test re-derives every quantity at runtime from computeSession3()'s `meta` (manifest-derived
// regime medians, the ±0.25 tolerance) and `session3.floorByRatio` (the ratio cut grid and each
// scope's population counts), and hardcodes only the expected results. Assertions 2–5 and 6 read
// only population (`rowsAtOrAbove` / `rowsBelow`) and manifest values, never a `sellable`/`rated`
// count, so they hold identically on the blank sheet and on the filled one — that is the point:
// the defect was visible before rating. Assertion 6 covers §5.1: READ-011D §7's margin clause has
// no denominator at the bottom rung, because nothing was rendered below ratio 16.
//
// Import graph: this file, node: builtins, analyze-ratings.mjs (zero npm, zero src/), and the
// test-registration helper. It reads no rendered image and passes on a bare clone.

import assert from 'node:assert/strict';
import { computeSession3 } from './font-certification/analyze-ratings.mjs';
import { assertTestRegistered } from './lib/test-registration-assertions.mjs';

const { meta, session3 } = computeSession3();

const REGIMES = ['monoline', 'transitional', 'massed'];
const medians = REGIMES.map((r) => meta.regimeMedianStemWidthRatio[r]);
const candidates = session3.floorByRatio.candidates;
const tolerance = meta.selectionToleranceStones;

const round5 = (x) => Math.round(x * 1e5) / 1e5;
const round3 = (x) => Math.round(x * 1000) / 1000;
const round1 = (x) => Math.round(x * 10) / 10;
const spreadOf = (cuts) => {
  const conv = cuts.map((c, i) => c * medians[i]);
  return Math.max(...conv) - Math.min(...conv);
};
const eligibleCuts = (scopeKey) =>
  candidates.filter((c) => session3.floorByRatio.scopes[scopeKey].byCandidate[c].rowsAtOrAbove >= 12);

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

await test('1. the selection tolerance is ±0.25 stones and the three regime medians are 0.0303 / 0.05535 / 0.09255', () => {
  assert.equal(tolerance, 0.25, 'meta.selectionToleranceStones');
  // transitional's median is the mean of two manifest values, so it lands one ULP off the decimal
  // literal 0.05535; compare at the manifest's five-decimal precision.
  assert.deepEqual(medians.map(round5), [0.0303, 0.05535, 0.09255], 'meta.regimeMedianStemWidthRatio, monoline/transitional/massed');
});

await test('2. across all 125 Form-B cut combinations every converted spread exceeds ±0.25; the minimum rounds to 0.814 stones at cuts 22 / 16 / 16', () => {
  let min = { spread: Infinity, cuts: null };
  let combos = 0;
  for (const a of candidates) {
    for (const b of candidates) {
      for (const c of candidates) {
        combos += 1;
        const spread = spreadOf([a, b, c]);
        assert.ok(spread > tolerance, `cuts ${a}/${b}/${c}: spread ${spread} is within the ±${tolerance} tolerance`);
        if (spread < min.spread) min = { spread, cuts: [a, b, c] };
      }
    }
  }
  assert.equal(combos, 125, 'combination count');
  assert.equal(round3(min.spread), 0.814, 'minimum achievable spread');
  assert.deepEqual(min.cuts, [22, 16, 16], 'minimising combination (monoline / transitional / massed)');
});

await test('3. restricted to cuts that reach 12 rows in the outline|untracked scopes, the minimum spread rounds to 0.996 stones at cuts 16 / 16 / 16', () => {
  const eligible = REGIMES.map((r) => eligibleCuts(`${r}|outline|untracked`));
  assert.ok(eligible.every((set) => set.length > 0), 'every outline|untracked scope has at least one eligible cut');
  let min = { spread: Infinity, cuts: null };
  for (const a of eligible[0]) {
    for (const b of eligible[1]) {
      for (const c of eligible[2]) {
        const spread = spreadOf([a, b, c]);
        if (spread < min.spread) min = { spread, cuts: [a, b, c] };
      }
    }
  }
  assert.equal(round3(min.spread), 0.996, 'minimum spread among row-minimum-reachable cuts');
  assert.deepEqual(min.cuts, [16, 16, 16], 'minimising combination (monoline / transitional / massed)');
});

await test('4. the eligible-cut set per Form-B scope matches READ-011E §5 exactly, and all six tracked scopes are empty', () => {
  const EXPECTED_UNTRACKED = {
    'monoline|outline|untracked': [16],
    'transitional|outline|untracked': [16, 17.5],
    'massed|outline|untracked': [16, 17.5],
    'monoline|fill|untracked': [16, 17.5, 19],
    'transitional|fill|untracked': [16, 17.5],
    'massed|fill|untracked': [16, 17.5, 19],
  };
  const scopeKeys = Object.keys(session3.floorByRatio.scopes);
  assert.equal(scopeKeys.length, 12, 'three regimes × two modes × two tracking arms');
  for (const scopeKey of scopeKeys) {
    const eligible = eligibleCuts(scopeKey);
    if (scopeKey.endsWith('|tracked')) {
      assert.deepEqual(eligible, [], `${scopeKey}: no cut can reach the 12-row minimum`);
    } else {
      assert.deepEqual(eligible, EXPECTED_UNTRACKED[scopeKey], `${scopeKey}: eligible cuts`);
    }
  }
});

await test('5. a constant N = 1.0 stone implies ratios 33.0 / 18.1 / 10.8, and only transitional lies inside the Form-B cut grid', () => {
  const implied = medians.map((m) => 1.0 / m);
  assert.deepEqual(implied.map(round1), [33.0, 18.1, 10.8], 'implied per-regime ratio for N = 1.0');
  const lo = Math.min(...candidates);
  const hi = Math.max(...candidates);
  assert.deepEqual(
    implied.map((x) => x >= lo && x <= hi),
    [false, true, false],
    'only transitional\'s constant-N boundary falls within the closed cut-grid interval',
  );
});

await test('6. at Form-B cut 16 every one of the twelve scopes has rowsBelow 0, so READ-011D §7\'s margin clause has no denominator at the bottom rung', () => {
  const scopeKeys = Object.keys(session3.floorByRatio.scopes);
  assert.equal(scopeKeys.length, 12, 'three regimes × two modes × two tracking arms');
  for (const scopeKey of scopeKeys) {
    assert.equal(
      session3.floorByRatio.scopes[scopeKey].byCandidate[16].rowsBelow,
      0,
      `${scopeKey}: rowsBelow at cut 16 must be 0 — 16 is the minimum ratio in the render plan`,
    );
  }
});

await test('7. this file is registered in tools/test-groups.mjs (documentation group) and the default suite', () => {
  assertTestRegistered({
    filename: 'test-read-011e-reachability.mjs',
    group: 'documentation',
    includedInDefault: true,
  });
});

if (process.exitCode === 1) {
  console.error('\nREAD-011E reachability dry-run FAILED.');
} else {
  console.log('\nREAD-011E reachability dry-run passed.');
}
