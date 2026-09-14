// FONT-LIB-005 -- Montserrat ships as Thin, so it is retired from the picker.
//
// Manifest-side, arithmetic and hash only. No TTF parser dependency: the font is no longer in
// test-read-003-stem-width.mjs's in-scope set, so its frozen stemWidthRatio is no longer
// live-remeasured -- this suite pins it instead, against the recorded sha256 of the byte-identical
// Google Fonts variable-font file.
//
// Background (verified, see docs/specifications/FONT-LIB-005-MontserratRetired.md):
//   assets/fonts/Montserrat-Regular.ttf is byte-identical to google/fonts
//   ofl/montserrat/Montserrat[wght].ttf -- a VARIABLE font whose wght axis is min/default/max
//   100/100/900. opentype.js renders its default instance, which is Thin (usWeightClass 100). There
//   is no static Montserrat-Regular.ttf upstream. stemWidthMm = 0.0145 * heightMm, so the smallest
//   stone (2.0mm) needs heightMm >= 138, but a mug's printableHeightMm is 85. The .ttf is retained
//   deliberately so saved projects that use Montserrat keep rendering byte-identically.

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertTestRegistered } from './lib/test-registration-assertions.mjs';
import { FontManager } from '../src/fonts/index.js';
import { classifyStemRegime, STEM_REGIME } from '../src/geometry/StemRegime.js';
import { getVesselDefaults } from '../src/products/index.js';
import { listStoneSizes } from '../src/renderer/StoneSizes.js';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));

// The recorded hash of the bundled file. FONT-LIB-005 confirmed this is byte-identical to Google
// Fonts' official ofl/montserrat/Montserrat[wght].ttf variable font.
const MONTSERRAT_TTF_SHA256 = '0f7b311b2f3279e4eef9b2f968bcdbab6e28f4daeb1f049f4f278a902bcd82f7';

const manifest = JSON.parse(await readFile(path.join(repoRoot, 'assets/fonts/manifest.json'), 'utf8'));
const renderKey = JSON.parse(
  await readFile(path.join(repoRoot, 'docs/data/read-011/render-key.json'), 'utf8')
);
const renderPlan = JSON.parse(
  await readFile(path.join(repoRoot, 'docs/data/read-011/render-plan.json'), 'utf8')
);
const appJs = await readFile(path.join(repoRoot, 'app.js'), 'utf8');

const montserrat = manifest.fonts.find((f) => f.id === 'montserrat-regular');

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

await test('1. montserrat-regular is in the manifest, retired: enabled:false, style "Thin", weight 100', () => {
  assert.ok(montserrat, 'expected assets/fonts/manifest.json to still carry a montserrat-regular record');
  assert.equal(montserrat.enabled, false);
  assert.equal(montserrat.style, 'Thin');
  assert.equal(montserrat.weight, 100);
  // The identity fields must NOT move -- family stays "Montserrat" so sibling grouping keeps working,
  // and a saved project's layer.font === 'montserrat-regular' must still resolve.
  assert.equal(montserrat.id, 'montserrat-regular');
  assert.equal(montserrat.family, 'Montserrat');
  assert.equal(montserrat.path, 'assets/fonts/Montserrat-Regular.ttf');
});

await test('2. Montserrat-Regular.ttf still exists on disk and its sha256 is unchanged (the saved-project guarantee + the frozen stemWidthRatio, machine-checked)', async () => {
  // The font has left test-read-003-stem-width.mjs's in-scope set (enabled:false), so nothing
  // live-remeasures it any more. Pinning the file's bytes here keeps both promises: existing
  // Montserrat layers render byte-identically, and the frozen READ-011 stemWidthRatio (asserted in
  // test 3) still describes the file it was measured from.
  const bytes = await readFile(path.join(repoRoot, montserrat.path));
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  assert.equal(sha256, MONTSERRAT_TTF_SHA256, 'assets/fonts/Montserrat-Regular.ttf must not be modified or replaced by this milestone');
});

await test('3. its manifest stemWidthRatio is unchanged from the frozen READ-011 value', () => {
  // Read the expected number straight from the frozen key rather than hardcoding it.
  // docs/data/read-011/render-key.json: entries[].stemWidthRatio, keyed by entries[].fontId.
  const keyEntry = renderKey.entries.find((e) => e.fontId === 'montserrat-regular');
  assert.ok(keyEntry, 'expected docs/data/read-011/render-key.json to carry montserrat-regular entries');
  assert.equal(
    montserrat.stemWidthRatio,
    keyEntry.stemWidthRatio,
    'manifest stemWidthRatio must match the frozen READ-011 render-key value'
  );
});

await test('4. it still classifies as "monoline" through the real classifyStemRegime()', () => {
  assert.equal(classifyStemRegime(montserrat.stemWidthRatio), STEM_REGIME.MONOLINE);
});

await test('5. docs/data/read-011/render-plan.json still carries exactly 11 entries with fontId "montserrat-regular"', () => {
  const count = renderPlan.entries.filter((e) => e.fontId === 'montserrat-regular').length;
  assert.equal(count, 11, 'the frozen READ-011 render-plan must keep referencing montserrat-regular');
});

await test('6. the stroke cannot clear the smallest stone at a mug\'s printableHeightMm', () => {
  const printableHeightMm = getVesselDefaults('mug').printableHeightMm;
  const smallestStoneMm = Math.min(...listStoneSizes().map((s) => s.diameterMm));
  assert.equal(printableHeightMm, 85, 'test setup: the mug default printable height READ-003 cited');
  assert.equal(smallestStoneMm, 2.0, 'test setup: the smallest catalogued stone READ-003 cited');
  assert.ok(
    montserrat.stemWidthRatio * printableHeightMm < smallestStoneMm,
    `stemWidthRatio ${montserrat.stemWidthRatio} * ${printableHeightMm}mm = ` +
      `${(montserrat.stemWidthRatio * printableHeightMm).toFixed(2)}mm is below the ${smallestStoneMm}mm ` +
      'smallest stone -- Montserrat is unmanufacturable at every reachable height on the default product'
  );
});

await test('7. montserrat-regular is NOT in productionFonts(), IS in listFonts({includeDisabled:true}), and IS in the app.js TEXT_ENGINE_FONT_IDS build', () => {
  const manager = new FontManager(manifest);

  // productionFonts() -- run the real app.js line, not a reimplementation.
  const productionFontsSrc = (() => {
    const marker = 'function productionFonts(){';
    const start = appJs.indexOf(marker);
    assert.ok(start !== -1, 'expected productionFonts() to still be defined in app.js');
    const end = appJs.indexOf('\n', start);
    return appJs.slice(start, end);
  })();
  // eslint-disable-next-line no-new-func
  const productionFonts = new Function('fontManager', `${productionFontsSrc}\nreturn productionFonts();`);
  const offered = productionFonts(manager).map((f) => f.id);
  assert.equal(offered.includes('montserrat-regular'), false, 'the retired font must not be offered in the picker');
  assert.ok(offered.includes('poppins-regular'), 'test sanity: an enabled font is still offered');

  // listFonts({includeDisabled:true}) keeps the record -- this is what lets a saved project resolve it.
  const known = manager.listFonts({ includeDisabled: true }).map((f) => f.id);
  assert.ok(known.includes('montserrat-regular'), 'the retired font must stay a known record');

  // TEXT_ENGINE_FONT_IDS -- run the exact app.js expression. FONT-LIB-005 changed this to
  // includeDisabled:true precisely so a disabled-but-renderable Montserrat layer stays duplicable
  // (addText()'s "font:TEXT_ENGINE_FONT_IDS.has(l.font)?l.font:DEFAULT_TEXT_FONT_ID" fallback).
  const textEngineExpr = 'new Set(fontManager.listFonts({includeDisabled:true}).map(f=>f.id))';
  assert.ok(
    appJs.includes(`TEXT_ENGINE_FONT_IDS=${textEngineExpr}`),
    'expected app.js to build TEXT_ENGINE_FONT_IDS from listFonts({includeDisabled:true})'
  );
  // eslint-disable-next-line no-new-func
  const buildTextEngineFontIds = new Function('fontManager', `return ${textEngineExpr};`);
  const textEngineIds = buildTextEngineFontIds(manager);
  assert.ok(textEngineIds.has('montserrat-regular'), 'the text engine must still accept a saved Montserrat layer\'s font id');
});

await test('8. this file is registered in the `text` group and runs in both the default and full suites', () => {
  assertTestRegistered({
    filename: 'test-font-lib-005-montserrat-retired.mjs',
    group: 'text',
    includedInDefault: true
  });
});

console.log('FONT-LIB-005 Montserrat-retired tests passed.');
