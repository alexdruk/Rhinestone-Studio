// READ-011D — golden-file guard for the rating-analysis pre-registration.
//
// docs/specifications/READ-011D-AnalysisPreRegistration.md fixes the derivation rule for the
// READ-011 auto-fit floor *before* docs/data/read-011/ratings.csv is rated. computeSession3() in
// tools/font-certification/analyze-ratings.mjs recomputes every session-3 table from
// docs/data/read-011/{ratings.csv,render-key.json} and assets/fonts/manifest.json; this test pins
// that computation to the committed golden docs/data/read-011/derived-tables.json, and pins the
// structural invariants that must hold while the outcome column is still blank, so the
// pre-registration fails loudly if the analysis set or the duplicate rule ever drifts.
//
// It also re-asserts that computeAll() still deep-equals the frozen READ-005 golden — session 3 is
// a separate function writing a separate golden and must not perturb READ-005B (spec §10).
//
// Import graph: this file, node: builtins, analyze-ratings.mjs (zero npm, zero src/), and the
// test-registration helper. It reads no rendered image and passes on a bare clone.

import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { computeAll, computeSession3, readCsvObjects } from './font-certification/analyze-ratings.mjs';
import { assertTestRegistered } from './lib/test-registration-assertions.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA_011 = path.join(REPO_ROOT, 'docs', 'data', 'read-011');
const DATA_005 = path.join(REPO_ROOT, 'docs', 'data', 'read-005');

const key = JSON.parse(readFileSync(path.join(DATA_011, 'render-key.json'), 'utf8'));
const ratings = readCsvObjects(path.join(DATA_011, 'ratings.csv'));
const rated = key.entries.filter((e) => e.excludedFromRating === false);

const DUP_KEY_FIELDS = ['fontId', 'mode', 'ratio', 'stoneSizeId', 'text', 'letterSpacingMm'];
const dupKey = (e) => DUP_KEY_FIELDS.map((f) => e[f]).join('|');

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

await test('1. computeSession3() deep-equals the committed docs/data/read-011/derived-tables.json', () => {
  assert.ok(existsSync(path.join(DATA_011, 'derived-tables.json')), 'derived-tables.json is missing');
  const golden = JSON.parse(readFileSync(path.join(DATA_011, 'derived-tables.json'), 'utf8'));
  assert.deepEqual(computeSession3(), golden);
});

await test('2. computeAll() still deep-equals the frozen READ-005 golden (spec §10)', () => {
  const golden = JSON.parse(readFileSync(path.join(DATA_005, 'derived-tables.json'), 'utf8'));
  assert.deepEqual(computeAll(), golden);
});

await test('3. ratings.csv has 147 rows matching the 147 non-excluded render-key slugs exactly', () => {
  assert.equal(ratings.length, 147, 'ratings.csv data rows');
  assert.equal(rated.length, 147, 'non-excluded render-key entries');
  assert.deepEqual(
    [...ratings.map((r) => r.slug)].sort(),
    [...rated.map((e) => e.slug)].sort(),
    'the rated slug set is exactly the non-excluded render-key slug set',
  );
  // Pre-registration: every outcome cell is blank at this commit (spec §1).
  for (const r of ratings) {
    assert.equal(r.readable, '', `${r.slug} readable must be blank`);
    assert.equal(r.sellable, '', `${r.slug} sellable must be blank`);
  }
});

await test('4. 20 duplicate-spec groups, sized 19×2 and 1×3, dropping 21 rows → primary population 126', () => {
  const byKey = new Map();
  for (const e of rated) {
    if (!byKey.has(dupKey(e))) byKey.set(dupKey(e), []);
    byKey.get(dupKey(e)).push(e);
  }
  const groups = [...byKey.values()].filter((v) => v.length > 1);
  assert.equal(groups.length, 20, 'duplicate group count');
  assert.equal(groups.filter((g) => g.length === 2).length, 19, 'pairs');
  assert.equal(groups.filter((g) => g.length === 3).length, 1, 'triples');
  assert.equal(groups.filter((g) => g.length > 3).length, 0, 'nothing larger than a triple');
  const dropped = groups.reduce((acc, g) => acc + g.length - 1, 0);
  assert.equal(dropped, 21, 'non-primary rows');
  assert.equal(rated.length - dropped, 126, 'primary population');

  const s3 = computeSession3().session3;
  assert.equal(s3.duplicateGroups.count, 20);
  assert.deepEqual(s3.duplicateGroups.sizes, { 2: 19, 3: 1 });
  assert.equal(s3.duplicateGroups.primaryPopulation, 126);
  assert.equal(s3.duplicateGroups.droppedRows, 21);
  assert.deepEqual(s3.duplicateGroups.byKind, {
    'main/repeats pair': 14,
    'main/main collision': 5,
    triple: 1,
  });
});

await test('5. six degenerate tracking cells (a none/separation contrast, all at 0 mm spacing)', () => {
  const s3 = computeSession3().session3;
  assert.equal(s3.degenerateTrackingCells.count, 6);
  for (const c of s3.degenerateTrackingCells.cells) {
    assert.ok(c.trackingTargets.includes('none') && c.trackingTargets.includes('separation'),
      `${c.key} is not a none/separation contrast`);
  }
});

await test('6. achieved-tracking arms: 34 tracked at the rated level (24 outline / 10 fill), 31 / 95 in the primary population', () => {
  // "tracked" is achieved spacing, letterSpacingMm > 0 (spec §4). 34 renders carry it (24 outline,
  // 10 fill); three are the higher-presentation-index members of tracked repeat pairs and leave the
  // primary tables under the duplicate rule (spec §3), so the primary arms are 31 and 95, not 34
  // and 92.
  const at = computeSession3().session3.achievedTracking;
  assert.equal(at.ratedLevel.tracked, 34, 'rated-level tracked');
  assert.equal(at.ratedLevel.untracked, 113, 'rated-level untracked');
  assert.deepEqual(at.ratedLevel.trackedByMode, { outline: 24, fill: 10 });
  assert.equal(at.primaryPopulation, 126);
  assert.equal(at.tracked, 31, 'primary tracked');
  assert.equal(at.untracked, 95, 'primary untracked');
  assert.equal(at.tracked + at.untracked, at.primaryPopulation);
  assert.equal(at.courierPrimeFailedEntry.countedAs, 'untracked',
    'courier-prime\'s failed separation entry (0 mm achieved) joins the untracked arm');
});

await test('7. five separationAchieved:false entries, every one outline mode', () => {
  const shortfall = rated.filter((e) => e.separationAchieved === false);
  assert.equal(shortfall.length, 5);
  assert.ok(shortfall.every((e) => e.mode === 'outline'), 'all five are outline');
  const s3 = computeSession3().session3;
  assert.equal(s3.separationShortfall.count, 5);
  assert.equal(s3.separationShortfall.allOutline, true);
});

await test('8. the rating sheet is in strictly increasing presentationIndex order', () => {
  const sheetOrder = [...rated].sort((a, b) => a.presentationIndex - b.presentationIndex);
  for (let i = 1; i < sheetOrder.length; i++) {
    assert.ok(
      sheetOrder[i].presentationIndex > sheetOrder[i - 1].presentationIndex,
      `presentationIndex not strictly increasing at sheet row ${i}`,
    );
  }
  // ratings.csv rows are written in that same order — row index is the within-session time axis.
  assert.deepEqual(ratings.map((r) => r.slug), sheetOrder.map((e) => e.slug),
    'ratings.csv row order == presentationIndex order');
});

await test('9. every floor-decision scope balances population and rated counts, and rated is present', () => {
  const s3 = computeSession3().session3;
  for (const [name, fl] of [['floorByStones', s3.floorByStones], ['floorByRatio', s3.floorByRatio]]) {
    const total = Object.values(fl.scopes).reduce((acc, sc) => acc + sc.population, 0);
    assert.equal(total, 126, `${name}: scope populations sum to ${total}, not 126`);
    for (const [scopeName, sc] of Object.entries(fl.scopes)) {
      assert.equal(typeof sc.rated, 'number', `${name}.${scopeName}: rated count missing`);
      for (const c of fl.candidates) {
        const cut = sc.byCandidate[c];
        assert.equal(cut.rowsBelow + cut.rowsAtOrAbove, sc.population,
          `${name}.${scopeName} candidate ${c}: rowsBelow + rowsAtOrAbove != population`);
        assert.equal(typeof cut.ratedBelow, 'number', `${name}.${scopeName} candidate ${c}: ratedBelow missing`);
        assert.equal(typeof cut.ratedAtOrAbove, 'number', `${name}.${scopeName} candidate ${c}: ratedAtOrAbove missing`);
        assert.equal(cut.ratedBelow + cut.ratedAtOrAbove, sc.rated,
          `${name}.${scopeName} candidate ${c}: ratedBelow + ratedAtOrAbove != scope rated count`);
      }
    }
  }
});

await test('10. self-consistency: n is 20, fullyRatedGroups is 0 with all agreement counts 0 at this commit', () => {
  const sc = computeSession3().session3.selfConsistency;
  assert.equal(sc.n, 20, 'n covers all 20 duplicate groups');
  assert.equal(sc.fullyRatedGroups, 0, 'no group is fully rated on the blank sheet');
  assert.equal(sc.readableAgreement, 0);
  assert.equal(sc.sellableAgreement, 0);
  assert.equal(sc.bothAgreement, 0);
});

await test('11. groupsUnderMinPositions has 3 entries with sheet spans 2, 7 and 12', () => {
  const s3 = computeSession3().session3;
  const sc = s3.selfConsistency;
  assert.equal(sc.groupsUnderMinPositions.count, 3);
  assert.deepEqual(
    sc.groupsUnderMinPositions.groups.map((g) => g.sheetSpan).sort((a, b) => a - b),
    [2, 7, 12],
  );
  // The span-2 group is the courier-prime none/separation collision — a degenerate tracking cell.
  const span2 = sc.groupsUnderMinPositions.groups.find((g) => g.sheetSpan === 2);
  assert.equal(span2.key, 'courier-prime-regular|outline|17.5|ss10|Vitalina|0');
  assert.equal(span2.isDegenerateTrackingCell, true);
  const span2Full = s3.duplicateGroups.groups.find((g) => g.key === span2.key);
  assert.deepEqual([...span2Full.memberSlugs].sort(), ['3bf95b5a', '9afe431e'],
    'the span-2 group is the courier-prime none/separation slug pair');
  // Only the span-7 poppins-semibold pair is a seeded repeat.
  assert.equal(sc.seededRepeatsUnderMinPositions.count, 1);
  assert.equal(sc.seededRepeatsUnderMinPositions.groups[0].sheetSpan, 7);
});

await test('12. the three regime pool-median stemWidthRatios come from the manifest', () => {
  const manifest = JSON.parse(readFileSync(path.join(REPO_ROOT, 'assets', 'fonts', 'manifest.json'), 'utf8'));
  const swr = new Map(manifest.fonts.map((f) => [f.id, f.stemWidthRatio]));
  const median = (a) => {
    const s = [...a].sort((x, y) => x - y);
    const mid = s.length >> 1;
    return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
  };
  const meta = computeSession3().meta;
  for (const regime of ['monoline', 'transitional', 'massed']) {
    const pool = [...new Set(rated.filter((e) => e.stemRegime === regime).map((e) => e.fontId))];
    const expected = median(pool.map((id) => swr.get(id)));
    assert.equal(meta.regimeMedianStemWidthRatio[regime], expected, `${regime} median`);
  }
});

await test('13. this file is registered in tools/test-groups.mjs (documentation group) and the default suite', () => {
  assertTestRegistered({
    filename: 'test-read-011d-session3.mjs',
    group: 'documentation',
    includedInDefault: true,
  });
});

if (process.exitCode === 1) {
  console.error('\nREAD-011D session-3 pre-registration check FAILED.');
} else {
  console.log('\nREAD-011D session-3 pre-registration check passed.');
}
