// READ-003 step 1 -- cross-checks assets/fonts/manifest.json's stored `stemWidthRatio` for every
// enabled OpenType production font against a live re-measurement through the real
// FontManager -> OpenTypeProvider -> GeometryEngine.resolveTextPolygons() path that
// tools/measure-font-stem-width.mjs uses -- mirroring tools/test-font-height-ratios.mjs test 5's
// "re-execute the real code, never hardcode the expected output" convention. A future font-file
// swap (or a percentile/method change) that forgets to re-run `--write` is caught here.
//
// NOTE: test 5 re-measures all 29 in-scope fonts (interior grid sampling over 62 glyphs each) and
// takes ~75s. This file is therefore in tools/test-groups.mjs's EXCLUDED_FROM_DEFAULT (test:full /
// explicit-filter only), the same treatment the repo already gives suites that are too heavy for
// the default `npm test` loop.

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FontManager } from '../src/fonts/index.js';
import { PRODUCTION_REVIEW_GLYPHS } from './font-certification/lib/requiredCharacters.mjs';
import {
  measureFontStemWidthRatios,
  measureLocalStrokeWidths,
  percentile,
  roundRatio,
  isInScope,
  REFERENCE_HEIGHT_MM,
  STEM_WIDTH_PERCENTILE
} from './measure-font-stem-width.mjs';
import { createDefaultFontProviderRegistry } from '../src/text/index.js';
import { GeometryEngine } from '../src/geometry/index.js';
import { assertTestRegistered } from './lib/test-registration-assertions.mjs';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const manifestPath = path.join(repoRoot, 'assets/fonts/manifest.json');

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

const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
const fontManager = new FontManager(manifest);
const fontsById = new Map(fontManager.manifest.fonts.map((f) => [f.id, f]));

// Every enabled font that resolves through the OpenType provider -- FONT-LIB-002 opened the picker
// to the whole library, so every one of these needs the check (deliberately wider than TXT-104's
// four rhinestoneValidated fonts).
const IN_SCOPE_IDS = fontManager.manifest.fonts.filter(isInScope).map((f) => f.id);

// The three anchors from the READ-003 investigation. cinzel/caveat were reported unreadable
// (stem < stone); anton @ SS6 was product-owner-confirmed good (stem > stone).
const ANCHORS = [
  { id: 'cinzel-regular', heightMm: 56, stoneMm: 4.0, reportedStemMm: 2.12, readable: false },
  { id: 'caveat-regular', heightMm: 55, stoneMm: 4.0, reportedStemMm: 2.50, readable: false },
  { id: 'anton-regular', heightMm: 36.52, stoneMm: 2.0, reportedStemMm: 4.37, readable: true }
];

await test('0. scope is every enabled providerId:opentype font (29), and excludes the rhinestone + disabled fonts', () => {
  assert.equal(IN_SCOPE_IDS.length, 29, `expected 29 in-scope fonts, got ${IN_SCOPE_IDS.length}: ${IN_SCOPE_IDS.join(', ')}`);
  for (const id of ['rs-block', 'rs-modern']) {
    assert.equal(IN_SCOPE_IDS.includes(id), false, `${id} (authored stone centres) must be out of scope`);
  }
  assert.equal(IN_SCOPE_IDS.includes('roboto-mono-regular'), false, 'the disabled roboto-mono stub must be out of scope');
});

await test('1. manifest.json carries a numeric stemWidthRatio for exactly the in-scope fonts', () => {
  for (const id of IN_SCOPE_IDS) {
    const font = fontsById.get(id);
    assert.equal(typeof font.stemWidthRatio, 'number', `${id} must have a numeric stemWidthRatio`);
    assert.ok(Number.isFinite(font.stemWidthRatio), `${id} stemWidthRatio must be finite`);
  }
});

await test('2. stemWidthRatio is a plausible stroke/height fraction (0 < r < 0.3) for every in-scope font', () => {
  for (const id of IN_SCOPE_IDS) {
    const r = fontsById.get(id).stemWidthRatio;
    assert.ok(r > 0 && r < 0.3, `${id} stemWidthRatio ${r} is outside the plausible (0, 0.3) range for a text stroke`);
  }
});

await test('3. authored stone-centre fonts (RS Block / RS Modern) and the disabled roboto-mono stub carry NO stemWidthRatio', () => {
  for (const id of ['rs-block', 'rs-modern', 'roboto-mono-regular']) {
    const font = fontsById.get(id);
    assert.ok(font, `expected manifest to contain "${id}"`);
    assert.equal(font.stemWidthRatio, undefined, `${id} must not carry a stemWidthRatio`);
  }
});

await test('4. FontManager.getFont() exposes stemWidthRatio for in-scope fonts (matching the manifest) and leaves it undefined otherwise', () => {
  for (const id of IN_SCOPE_IDS) {
    assert.equal(fontManager.getFont(id).stemWidthRatio, fontsById.get(id).stemWidthRatio, `${id}: getFont() must match the manifest`);
  }
  for (const id of ['rs-block', 'rs-modern']) {
    assert.equal(fontManager.getFont(id).stemWidthRatio, undefined, `${id}: getFont() must not expose a stemWidthRatio`);
  }
  // A record predating the field entirely must default cleanly, not throw.
  const legacy = new FontManager({ version: 2, fonts: [{ id: 'legacy', family: 'Legacy', path: 'x.ttf' }] });
  assert.equal(legacy.getFont('legacy').stemWidthRatio, undefined);
});

await test('5. every in-scope manifest stemWidthRatio exactly matches a live re-measurement of its real font file (~75s)', async () => {
  const measured = await measureFontStemWidthRatios();
  assert.equal(measured.length, IN_SCOPE_IDS.length, 'measureFontStemWidthRatios() must return exactly the in-scope set');
  for (const result of measured) {
    const font = fontsById.get(result.id);
    assert.ok(font, `measured font "${result.id}" not found in manifest`);
    assert.equal(
      font.stemWidthRatio,
      roundRatio(result.stemWidthRatio),
      `${result.id} manifest stemWidthRatio (${font.stemWidthRatio}) has drifted from a live re-measurement ` +
      `(${roundRatio(result.stemWidthRatio)}) -- re-run: node tools/measure-font-stem-width.mjs --write`
    );
  }
});

await test('6. the ratio is reference-height independent -- measuring one font at two heights yields the same ratio to 3 dp', async () => {
  const manifest2 = JSON.parse(await readFile(manifestPath, 'utf8'));
  const fm = new FontManager(manifest2);
  const engine = new GeometryEngine({
    fontProviderRegistry: createDefaultFontProviderRegistry(fm, {
      loadFontBuffer: async (rel) => {
        const b = await readFile(path.join(repoRoot, rel));
        return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
      }
    })
  });
  // A single mid-weight font at two very different heights; the ratio (stemWidth / referenceHeight)
  // must not move -- proving stemWidthRatio is dimensionless, not merely assuming linearity.
  const font = fm.getFont('cinzel-regular');
  const at60 = percentile(await measureLocalStrokeWidths(engine, font, 60), STEM_WIDTH_PERCENTILE) / 60;
  const at180 = percentile(await measureLocalStrokeWidths(engine, font, 180), STEM_WIDTH_PERCENTILE) / 180;
  assert.ok(
    Math.abs(at60 - at180) < 1e-3,
    `expected a height-independent ratio, got ${at60.toFixed(5)} at 60mm vs ${at180.toFixed(5)} at 180mm`
  );
});

await test('7. the three validation anchors rank correctly by stem-to-stone ratio, and split readable/unreadable at 1.0', () => {
  const rows = ANCHORS.map((a) => {
    const ratio = fontsById.get(a.id).stemWidthRatio;
    assert.equal(typeof ratio, 'number', `${a.id} needs a stemWidthRatio for this test`);
    const stemMm = ratio * a.heightMm;
    return { ...a, stemMm, stemOverStone: stemMm / a.stoneMm };
  });
  // reproduce the reported stem widths to within a few percent
  for (const r of rows) {
    const err = Math.abs(r.stemMm - r.reportedStemMm) / r.reportedStemMm;
    assert.ok(err < 0.08, `${r.id}: measured stem ${r.stemMm.toFixed(2)}mm is ${(err * 100).toFixed(1)}% off the reported ${r.reportedStemMm}mm`);
  }
  // rank: Cinzel < Caveat < Anton
  assert.ok(rows[0].stemOverStone < rows[1].stemOverStone, `Cinzel (${rows[0].stemOverStone.toFixed(2)}) must rank below Caveat (${rows[1].stemOverStone.toFixed(2)})`);
  assert.ok(rows[1].stemOverStone < rows[2].stemOverStone, `Caveat (${rows[1].stemOverStone.toFixed(2)}) must rank below Anton (${rows[2].stemOverStone.toFixed(2)})`);
  // the two reported-unreadable anchors are below one stone; the confirmed-good one is above
  for (const r of rows) {
    if (r.readable) assert.ok(r.stemOverStone > 1, `${r.id} was confirmed readable -- expected stem > stone, got ${r.stemOverStone.toFixed(2)}`);
    else assert.ok(r.stemOverStone < 1, `${r.id} was reported unreadable -- expected stem < stone, got ${r.stemOverStone.toFixed(2)}`);
  }
});

await test('8. the glyph corpus is PRODUCTION_REVIEW_GLYPHS (62 glyphs), not an ad-hoc word', () => {
  assert.equal(PRODUCTION_REVIEW_GLYPHS.length, 62);
  assert.equal(new Set(PRODUCTION_REVIEW_GLYPHS).size, 62, 'no duplicate glyphs');
});

await test('9. the manifest still parses and the font count is unchanged (32 records, 29 in scope)', () => {
  assert.equal(manifest.fonts.length, 32, 'READ-003 must not add or remove font records');
  assert.equal(manifest.fonts.filter((f) => f.providerId === 'rhinestone').length, 2);
  assert.equal(manifest.fonts.filter((f) => f.enabled === false).length, 1);
});

await test('10. this file is registered in the `text` group and excluded from the default suite (slow re-measurement)', () => {
  assertTestRegistered({ filename: 'test-read-003-stem-width.mjs', group: 'text', includedInDefault: false });
});

console.log('READ-003 stem-width tests passed.');
