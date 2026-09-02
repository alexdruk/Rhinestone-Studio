// READ-004 -- recognition harness (render + signals + auditable records).
//
// Covers the deterministic, re-derivable half of the Layer 2 pipeline
// (docs/specifications/READ-004-RecognitionHarness.md): the A-first signal ordering, the
// answer-leakage and no-repeated-character sheet rules, the class-prior / confusable-pair
// partitioning, pure scoring, cache keying, and the Part A analyzeOne() regression. Makes NO
// network calls and uses createStubOracle() only.

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FontManager } from '../src/fonts/index.js';
import { createDefaultFontProviderRegistry } from '../src/text/index.js';
import { GeometryEngine } from '../src/geometry/index.js';
import { analyzeOne } from './font-certification/lib/productionAnalysis.mjs';
import { runProbe, resolveCorpus, CORPORA } from './font-certification/lib/readabilityProbe.mjs';
import { buildRecognitionSheetHtml, partitionEntries, entryChars } from './font-certification/lib/recognitionSheets.mjs';
import { CONFUSABLE_PAIRS } from './font-certification/lib/requiredCharacters.mjs';
import { createStubOracle } from './font-certification/lib/recognitionOracle.mjs';
import { scoreProbe, levenshtein } from './font-certification/lib/recognitionScoring.mjs';
import { computeCacheKey } from './font-certification/lib/probeRecordStore.mjs';
import { runRecognitionCase } from './font-certification/readability-probe.mjs';
import { assertTestRegistered } from './lib/test-registration-assertions.mjs';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));

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

const manifest = JSON.parse(await readFile(path.join(repoRoot, 'assets/fonts/manifest.json'), 'utf8'));
const fontManager = new FontManager(manifest);
const fontsById = new Map(fontManager.manifest.fonts.map((f) => [f.id, f]));
const engine = new GeometryEngine({
  fontProviderRegistry: createDefaultFontProviderRegistry(fontManager, {
    loadFontBuffer: async (rel) => {
      const b = await readFile(path.join(repoRoot, rel));
      return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
    }
  })
});

const ratioOf = (id) => fontsById.get(id).stemWidthRatio;

// A cheap probe whose measurements are irrelevant to the sheet-partitioning rules (those depend
// only on the corpus). courier-prime-regular / outline passes signal A, so buildRecognitionSheetHtml
// runs; corpus is overridden per call. Reused by tests 2, 3a-3d.
const partitionProbe = await runProbe({
  engine,
  fontId: 'courier-prime-regular',
  stemWidthRatio: ratioOf('courier-prime-regular'),
  mode: 'outline',
  heightMm: 42.5,
  stoneSizeId: 'ss6',
  corpus: 'search'
});
const sheetsForTier = (corpusName) => buildRecognitionSheetHtml({ probeRecord: partitionProbe, corpus: corpusName }).sheets;
const isSingleCharTile = (t) => [...t.expectedText].length === 1;

// --- 1. Signal ordering: A fails first, before any geometry or oracle call ---------------------

await test('1. cinzel-regular / radial / 56mm / ss16 fails signal A first -- oracleRequired false, no layouts measured', async () => {
  const probe = await runProbe({
    engine,
    fontId: 'cinzel-regular',
    stemWidthRatio: ratioOf('cinzel-regular'),
    mode: 'radial',
    heightMm: 56,
    stoneSizeId: 'ss16',
    corpus: 'search'
  });

  assert.equal(probe.signalA.passed, false, 'signal A must fail (stroke narrower than one stone)');
  assert.equal(probe.oracleRequired, false, 'oracleRequired must be false when signal A fails');
  assert.equal(probe.measurements, null, 'no layouts must be measured when the pure stroke check fails');
  assert.ok(probe.signalA.reasons.length > 0 && /narrower than one/.test(probe.signalA.reasons[0]));
});

// --- 2. Answer leakage: nothing from tileInventory appears in the sheet HTML, all three tiers ---

await test('2. a built sheet leaks none of its expected strings, over every corpus tier (short-entry exemption path included)', async () => {
  for (const corpusName of Object.keys(CORPORA)) {
    const sheets = sheetsForTier(corpusName);
    assert.ok(sheets.length >= 1, `${corpusName}: at least one sheet`);
    for (const sheet of sheets) {
      assert.ok(!/<!--/.test(sheet.html), `${corpusName} sheet ${sheet.index}: no comments`);
      assert.ok(!/\b(alt|aria-label|data-[\w-]+)\s*=/.test(sheet.html), `${corpusName} sheet ${sheet.index}: no alt/aria/data- attributes`);
      for (const { expectedText } of sheet.tileInventory) {
        // full-HTML scan only for entries >= 3 chars -- a 1-2 char sequence coincides too readily
        // with an SVG coordinate / hex colour to treat a raw byte match as a leak (the short-entry
        // exemption; those entries are covered by the caption + structural checks below).
        if ([...expectedText].length >= 3) {
          assert.ok(!sheet.html.includes(expectedText),
            `${corpusName} sheet ${sheet.index}: expected string ${JSON.stringify(expectedText)} appears in the sheet HTML`);
        }
      }
      const captions = [...sheet.html.matchAll(/<p class="cap">([^<]*)<\/p>/g)].map((m) => m[1]);
      assert.deepEqual(captions, sheet.tileInventory.map((t) => t.index),
        `${corpusName} sheet ${sheet.index}: every caption is its index label and nothing else`);
    }
  }
});

// --- 3. Partitioning rules ------------------------------------------------------------------

await test('3a. cross-entry no-repeat holds for the glyph-identification tiers; the words tier is exempt and lands on exactly one sheet', () => {
  // `search` and `full` are glyph-identification tasks: no character may appear in two entries on a
  // sheet, so a degraded glyph can't be resolved from a legible copy elsewhere on the page.
  for (const corpusName of ['search', 'full']) {
    assert.equal(resolveCorpus(corpusName).glyphIdentificationTask, true,
      `${corpusName}: expected glyphIdentificationTask true`);
    for (const sheet of sheetsForTier(corpusName)) {
      // one entry's repeated character (e.g. "mm") is not a cross-referencing risk -- the rule is
      // strictly cross-entry, so each tile contributes its DISTINCT characters.
      const chars = sheet.tileInventory.flatMap((t) => entryChars(t.expectedText));
      assert.equal(new Set(chars).size, chars.length,
        `${corpusName} sheet ${sheet.index}: a character appears in two entries (${JSON.stringify(sheet.tileInventory.map((t) => t.expectedText))})`);
    }
  }

  // `words` is deliberately exempt: the unit of recognition is the word, not the glyph, and a lone
  // word on a distractor-free page is an EASIER read. The exemption is pinned, not incidental.
  assert.equal(resolveCorpus('words').glyphIdentificationTask, false,
    'words: expected glyphIdentificationTask false');
  const wordSheets = sheetsForTier('words');
  assert.equal(wordSheets.length, 1, `words tier must produce exactly one sheet, got ${wordSheets.length}`);
  assert.deepEqual(
    wordSheets[0].tileInventory.map((t) => t.expectedText),
    resolveCorpus('words').entries,
    'the single words sheet carries every word in corpus order');
  // and it does share characters across entries -- that is the point of the exemption.
  const wordChars = wordSheets[0].tileInventory.flatMap((t) => entryChars(t.expectedText));
  assert.ok(new Set(wordChars).size < wordChars.length,
    'the words sheet is expected to have characters shared across entries (exemption is meaningful)');
});

await test('3b. every single-character sheet has its digits balanced to the proportional target (|digits - expected| <= 1)', () => {
  for (const corpusName of Object.keys(CORPORA)) {
    const singles = resolveCorpus(corpusName).entries.filter((e) => [...e].length === 1);
    const singleTiles = singles.length;
    const singleDigits = singles.filter((c) => /[0-9]/.test(c)).length;
    for (const sheet of sheetsForTier(corpusName)) {
      if (!sheet.tileInventory.every(isSingleCharTile)) continue;
      const glyphs = sheet.tileInventory.map((t) => t.expectedText);
      const digitCount = glyphs.filter((c) => /[0-9]/.test(c)).length;
      const expectedDigits = singleDigits * glyphs.length / singleTiles;
      assert.ok(glyphs.some((c) => /[A-Za-z]/.test(c)), `${corpusName} sheet ${sheet.index}: no letter`);
      assert.ok(Math.abs(digitCount - expectedDigits) <= 1,
        `${corpusName} sheet ${sheet.index}: ${digitCount} digits vs proportional target ${expectedDigits.toFixed(2)} — deviation > 1 ("at least one" is not enough)`);
    }
  }
});

await test('3c. both members of every in-corpus confusable pair land on the same sheet', () => {
  for (const corpusName of Object.keys(CORPORA)) {
    const sheets = sheetsForTier(corpusName);
    const entries = new Set(resolveCorpus(corpusName).entries);
    for (const [a, b] of CONFUSABLE_PAIRS) {
      if (!entries.has(a) || !entries.has(b)) continue;
      const sheetOf = (ch) => sheets.findIndex((s) => s.tileInventory.some((t) => t.expectedText === ch));
      assert.equal(sheetOf(a), sheetOf(b), `${corpusName}: confusable pair ${a}/${b} is split across sheets`);
    }
  }
});

await test('3d. no label character intersects any expected character, over every tier, unconditionally', () => {
  for (const corpusName of Object.keys(CORPORA)) {
    const sheets = sheetsForTier(corpusName);
    const labelChars = new Set(sheets.flatMap((s) => s.tileInventory.flatMap((t) => [...t.index])));
    const expectedChars = new Set(sheets.flatMap((s) => s.tileInventory.flatMap((t) => [...t.expectedText])));
    for (const ch of labelChars) {
      assert.ok(!expectedChars.has(ch), `${corpusName}: label character ${JSON.stringify(ch)} also appears as an expected character`);
    }
  }
});

// --- 4. Scoring purity -----------------------------------------------------------------------

await test('4. scoreProbe() returns exact per-tile distances for a fixed fixture (substitution, omission, empty)', () => {
  const tileInventory = [
    { index: '01', expectedText: 'cat' },   // substitution: cat -> cot
    { index: '02', expectedText: 'bridge' },// omission:     bridge -> brige
    { index: '03', expectedText: 'fox' },   // empty reading: fox -> ''
    { index: '04', expectedText: 'Emma' }   // exact
  ];
  const rawReadings = ['cot', 'brige', '', 'Emma'];
  const result = scoreProbe({ tileInventory, rawReadings });

  assert.deepEqual(result.perTile.map((t) => t.distance), [1, 1, 3, 0]);
  assert.equal(levenshtein('cat', 'cot'), 1);
  assert.equal(result.totalDistance, 5);
  assert.equal(result.totalExpectedChars, 3 + 6 + 3 + 4);
  assert.equal(result.aggregateCer, 5 / 16);
  assert.deepEqual(result.misreads.map((m) => m.index), ['01', '02', '03']);
  assert.equal(result.perTile[2].cer, 1); // 3 / max(1,3)

  assert.throws(() => scoreProbe({ tileInventory, rawReadings: ['x'] }), /length mismatch/);
});

// --- 5. Cache keying -----------------------------------------------------------------------

await test('5. cache key: mode-only difference changes it; identical inputs match; sheetPngSha256 and harnessVersion change it', () => {
  const base = {
    fontId: 'anton-regular', mode: 'fill', heightMm: 36.52, stoneSizeId: 'ss6', gapMm: 0.3,
    corpusName: 'words', corpusHash: 'abc123', sheetPngSha256: 'deadbeef', modelId: 'stub-oracle',
    harnessVersion: 'read-004.5'
  };
  const key = computeCacheKey(base);
  assert.equal(computeCacheKey({ ...base }), key, 'identical inputs must produce the same key');
  assert.notEqual(computeCacheKey({ ...base, mode: 'contour' }), key, 'a mode change must change the key');
  assert.notEqual(computeCacheKey({ ...base, sheetPngSha256: 'feedface' }), key, 'a PNG-hash change must change the key');
  // a scorer change leaves the PNG byte-identical, so harnessVersion is the only field that catches it.
  assert.notEqual(computeCacheKey({ ...base, harnessVersion: 'read-004.6' }), key,
    'a harnessVersion change must change the key (same PNG, different code path)');
  assert.throws(() => computeCacheKey({ ...base, modelId: undefined }), /missing key field/);
  assert.throws(() => computeCacheKey({ ...base, harnessVersion: undefined }), /missing key field/);
});

// --- 6. Part A regression: analyzeOne() with no options is byte-identical to develop ----------

await test('6. analyzeOne() with no options object returns the pre-change stone positions for a fixed glyph', async () => {
  const fixture = JSON.parse(await readFile(
    path.join(repoRoot, 'tools/font-certification/fixtures/read-004-part-a-analyze-one.json'), 'utf8'));
  const { fontId, text, stoneSizeId, heightMm } = fixture.case;
  const rec = await analyzeOne(engine, fontId, text, stoneSizeId, heightMm);

  assert.equal(rec.stoneCount, fixture.stoneCount);
  assert.equal(rec.stones.length, fixture.stones.length);
  rec.stones.forEach((stone, i) => {
    assert.equal(stone.xMm, fixture.stones[i].xMm, `stone ${i} xMm`);
    assert.equal(stone.yMm, fixture.stones[i].yMm, `stone ${i} yMm`);
    assert.equal(stone.sizeMm, fixture.stones[i].sizeMm, `stone ${i} sizeMm`);
  });
  // the additive fields Part A introduced default to outline / the production gap
  assert.equal(rec.mode, 'outline');
  assert.equal(rec.gapMm, 0.3);
});

// --- 7. registration -----------------------------------------------------------------------

await test('7. this file is registered in the `text` group and included in the default suite', () => {
  assertTestRegistered({ filename: 'test-read-004-recognition-harness.mjs', group: 'text', includedInDefault: true });
});

// --- 8. the CLI's per-case path never reaches the sheet builder for an A-fail probe -----------

await test('8. runRecognitionCase() for cinzel-regular / radial / 56 / ss16 returns before buildRecognitionSheetHtml', async () => {
  let buildCalls = 0;
  let screenshotCalls = 0;
  const res = await runRecognitionCase(
    { fontId: 'cinzel-regular', mode: 'radial', heightMm: 56, stoneSizeId: 'ss16' },
    {
      engine,
      fontsById,
      corpus: 'search',
      buildSheets: (args) => { buildCalls += 1; return buildRecognitionSheetHtml(args); },
      screenshot: async () => { screenshotCalls += 1; return { consoleErrors: [] }; }
    }
  );

  assert.equal(res.signalA, false, 'the case must fail signal A');
  assert.equal(buildCalls, 0, 'buildRecognitionSheetHtml must never be reached for an A-fail probe');
  assert.equal(screenshotCalls, 0, 'no screenshot must be taken for an A-fail probe');
  assert.ok(Array.isArray(res.reasons) && /narrower than one/.test(res.reasons[0]));
});

console.log('READ-004 recognition harness tests passed.');
