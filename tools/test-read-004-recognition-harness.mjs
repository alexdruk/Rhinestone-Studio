// READ-004 -- recognition harness (render + signals + auditable records).
//
// Covers the deterministic, re-derivable half of the Layer 2 pipeline
// (docs/specifications/READ-004-RecognitionHarness.md): the A-first signal ordering, the
// answer-leakage and no-repeated-character sheet rules, pure scoring, cache keying, and the Part A
// analyzeOne() regression. Makes NO network calls and uses createStubOracle() only.

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FontManager } from '../src/fonts/index.js';
import { createDefaultFontProviderRegistry } from '../src/text/index.js';
import { GeometryEngine } from '../src/geometry/index.js';
import { analyzeOne } from './font-certification/lib/productionAnalysis.mjs';
import { runProbe, resolveCorpus, CORPORA } from './font-certification/lib/readabilityProbe.mjs';
import { buildRecognitionSheetHtml } from './font-certification/lib/recognitionSheets.mjs';
import { createStubOracle } from './font-certification/lib/recognitionOracle.mjs';
import { scoreProbe, levenshtein } from './font-certification/lib/recognitionScoring.mjs';
import { computeCacheKey } from './font-certification/lib/probeRecordStore.mjs';
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

// --- 1. Signal ordering: A fails first, before any geometry or oracle call ---------------------

await test('1. cinzel-regular / radial / 56mm / ss16 fails signal A first -- oracleRequired false, stub oracle never called', async () => {
  const stub = createStubOracle({});
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

  // The stub oracle is not wired into runProbe at all -- assert it was never invoked regardless.
  assert.equal(stub.invocationCount, 0, 'the oracle must record zero invocations for an A-fail probe');
});

// --- 2. Answer leakage: nothing from tileInventory appears in the sheet HTML -------------------

await test('2. a built sheet leaks none of its expected strings, and carries no alt/aria/data-/comment surface', async () => {
  const probe = await runProbe({
    engine,
    fontId: 'courier-prime-regular',
    stemWidthRatio: ratioOf('courier-prime-regular'),
    mode: 'outline',
    heightMm: 42.5,
    stoneSizeId: 'ss6',
    corpus: 'words'
  });
  assert.equal(probe.signalA.passed, true, 'precondition: the probe must pass signal A');

  const { sheets } = buildRecognitionSheetHtml({ probeRecord: probe });
  assert.ok(sheets.length >= 1);
  for (const sheet of sheets) {
    assert.ok(!/<!--/.test(sheet.html), 'sheet HTML must contain no comments');
    assert.ok(!/\b(alt|aria-label|data-[\w-]+)\s*=/.test(sheet.html), 'no alt/aria/data- attributes');
    assert.ok(!sheet.tileInventory.some((t) => sheet.html.includes(t.expectedText)),
      'no expected string from tileInventory may appear anywhere in the sheet HTML');
    // the caption of every tile is its index label and nothing else
    const captions = [...sheet.html.matchAll(/<p class="cap">([^<]*)<\/p>/g)].map((m) => m[1]);
    assert.deepEqual(captions, sheet.tileInventory.map((t) => t.index));
  }
});

// --- 3. No repeated character (== no duplicate expectedText) per sheet -------------------------

await test('3. no sheet has a duplicate expectedText, across every corpus tier', async () => {
  const probe = await runProbe({
    engine,
    fontId: 'courier-prime-regular',
    stemWidthRatio: ratioOf('courier-prime-regular'),
    mode: 'outline',
    heightMm: 42.5,
    stoneSizeId: 'ss6',
    corpus: 'search'
  });
  for (const corpusName of Object.keys(CORPORA)) {
    const { sheets } = buildRecognitionSheetHtml({ probeRecord: probe, corpus: corpusName });
    for (const sheet of sheets) {
      const values = sheet.tileInventory.map((t) => t.expectedText);
      assert.equal(new Set(values).size, values.length, `${corpusName} sheet ${sheet.index} has a duplicate expectedText`);
      // a single-character tile's glyph must never also be a label character on the same sheet
      const labelChars = new Set(sheet.tileInventory.flatMap((t) => [...t.index]));
      for (const { expectedText } of sheet.tileInventory) {
        if ([...expectedText].length === 1) {
          assert.ok(!labelChars.has(expectedText), `${corpusName} sheet ${sheet.index}: glyph "${expectedText}" collides with a label char`);
        }
      }
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

await test('5. cache key: mode-only difference changes it; identical inputs match; sheetPngSha256 changes it', () => {
  const base = {
    fontId: 'anton-regular', mode: 'fill', heightMm: 36.52, stoneSizeId: 'ss6', gapMm: 0.3,
    corpusName: 'words', corpusHash: 'abc123', sheetPngSha256: 'deadbeef', modelId: 'stub-oracle'
  };
  const key = computeCacheKey(base);
  assert.equal(computeCacheKey({ ...base }), key, 'identical inputs must produce the same key');
  assert.notEqual(computeCacheKey({ ...base, mode: 'contour' }), key, 'a mode change must change the key');
  assert.notEqual(computeCacheKey({ ...base, sheetPngSha256: 'feedface' }), key, 'a PNG-hash change must change the key');
  assert.throws(() => computeCacheKey({ ...base, modelId: undefined }), /missing key field/);
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

console.log('READ-004 recognition harness tests passed.');
