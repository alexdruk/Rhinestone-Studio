import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertTestRegistered } from './lib/test-registration-assertions.mjs';

// READ-011A -- StemRegime.js classifies every enabled font in assets/fonts/manifest.json into one of
// four stroke regimes (monoline / transitional / massed / unmeasured) from its measured
// stemWidthRatio. This suite pins:
//   1. every enabled font classifies into exactly one of the four values, none left unclassified;
//   2. the two documented boundary literals (0.04, 0.0625) land in the classes the module's comment
//      block says they do;
//   3. the four invalid-input shapes (non-numeric, NaN, negative, zero) all resolve to 'unmeasured';
//   4. the per-class membership derived from the current manifest, font by font -- so adding a font
//      forces a conscious update here rather than silently shifting a class.
// Nothing consumes StemRegime.js yet; this milestone changes no product behaviour.

const repoRoot = fileURLToPath(new URL('..', import.meta.url));

const {
  classifyStemRegime,
  STEM_REGIME,
  MONOLINE_MAX_STEM_WIDTH_RATIO,
  MASSED_MIN_STEM_WIDTH_RATIO
} = await import('../src/geometry/StemRegime.js');

const manifest = JSON.parse(await readFile(path.join(repoRoot, 'assets/fonts/manifest.json'), 'utf8'));
const enabledFonts = manifest.fonts.filter((f) => f.enabled !== false);

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

const ALL_REGIMES = new Set(Object.values(STEM_REGIME));

// --- 4. per-class membership, derived once from the current manifest -----------------------------
//
// Every enabled font id in assets/fonts/manifest.json, mapped to the regime it must classify into.
// roboto-mono-regular is absent because it is enabled:false (its file is a 14-byte non-font stub);
// see docs/specifications/READ-011A-StemRegimeClasses.md. A new manifest font that does not appear
// here fails test 4a below -- the update is deliberately not automatic.
const EXPECTED_REGIME_BY_FONT = {
  // monoline -- stemWidthRatio < 0.04
  'great-vibes-regular': 'monoline',
  'montserrat-regular': 'monoline',
  'cinzel-regular': 'monoline',
  'sacramento-regular': 'monoline',
  'alex-brush-regular': 'monoline',
  'allura-regular': 'monoline',
  'parisienne-regular': 'monoline',
  // transitional -- 0.04 <= stemWidthRatio < 0.0625
  'courier-prime-regular': 'transitional',
  'pt-serif-regular': 'transitional',
  'playfair-display-regular': 'transitional',
  'caveat-regular': 'transitional',
  'baloo2-variable-regular': 'transitional',
  'dancing-script-regular': 'transitional',
  'satisfy-regular': 'transitional',
  'yellowtail-regular': 'transitional',
  'cookie-regular': 'transitional',
  'mr-dafoe-regular': 'transitional',
  // massed -- stemWidthRatio >= 0.0625
  'lobster-regular': 'massed',
  'anton-regular': 'massed',
  'pacifico-regular': 'massed',
  'kaushan-script-regular': 'massed',
  'bebas-neue-regular': 'massed',
  'righteous-regular': 'massed',
  'lilita-one-regular': 'massed',
  'abril-fatface-regular': 'massed',
  'poppins-regular': 'massed',
  'poppins-semibold': 'massed',
  'poppins-bold': 'massed',
  'lobster-two-bold': 'massed',
  // unmeasured -- no numeric stemWidthRatio (rhinestone-provider Production Fonts)
  'rs-block': 'unmeasured',
  'rs-modern': 'unmeasured'
};

const EXPECTED_CLASS_COUNTS = { monoline: 7, transitional: 10, massed: 12, unmeasured: 2 };

await test('1. every enabled manifest font classifies into exactly one of the four regime values, none unclassified', () => {
  assert.ok(enabledFonts.length > 0, 'expected the manifest to list at least one enabled font');
  for (const font of enabledFonts) {
    const regime = classifyStemRegime(font.stemWidthRatio);
    assert.ok(
      ALL_REGIMES.has(regime),
      `font "${font.id}" classified as ${JSON.stringify(regime)}, not one of ${[...ALL_REGIMES].join(' / ')}`
    );
  }
});

await test('2. the documented boundary literals land in the classes StemRegime.js\'s comment block states', () => {
  assert.equal(MONOLINE_MAX_STEM_WIDTH_RATIO, 0.04);
  assert.equal(MASSED_MIN_STEM_WIDTH_RATIO, 0.0625);
  // 0.04 is the monoline/transitional boundary: "0.04 up to but excluding 0.0625" is transitional.
  assert.equal(classifyStemRegime(0.04), STEM_REGIME.TRANSITIONAL);
  // 0.0625 is the transitional/massed boundary: "0.0625 and above" is massed.
  assert.equal(classifyStemRegime(0.0625), STEM_REGIME.MASSED);
  // and the values just inside each neighbouring class.
  assert.equal(classifyStemRegime(0.0399), STEM_REGIME.MONOLINE);
  assert.equal(classifyStemRegime(0.0624), STEM_REGIME.TRANSITIONAL);
});

await test('3. non-numeric, NaN, negative and zero inputs all resolve to unmeasured -- never a regime default', () => {
  assert.equal(classifyStemRegime(undefined), STEM_REGIME.UNMEASURED);
  assert.equal(classifyStemRegime('0.05'), STEM_REGIME.UNMEASURED);
  assert.equal(classifyStemRegime(Number.NaN), STEM_REGIME.UNMEASURED);
  assert.equal(classifyStemRegime(-0.05), STEM_REGIME.UNMEASURED);
  assert.equal(classifyStemRegime(0), STEM_REGIME.UNMEASURED);
});

await test('4a. every enabled manifest font is accounted for in EXPECTED_REGIME_BY_FONT (a new font forces a conscious update here)', () => {
  const enabledIds = enabledFonts.map((f) => f.id).sort();
  const expectedIds = Object.keys(EXPECTED_REGIME_BY_FONT).sort();
  assert.deepEqual(
    enabledIds,
    expectedIds,
    'the set of enabled manifest fonts has drifted from READ-011A\'s recorded membership -- update ' +
      'EXPECTED_REGIME_BY_FONT, EXPECTED_CLASS_COUNTS and docs/specifications/READ-011A-StemRegimeClasses.md'
  );
});

await test('4b. each enabled font classifies into exactly the regime READ-011A recorded for it', () => {
  const byId = new Map(enabledFonts.map((f) => [f.id, f]));
  for (const [id, expectedRegime] of Object.entries(EXPECTED_REGIME_BY_FONT)) {
    const font = byId.get(id);
    assert.ok(font, `manifest no longer has an enabled font "${id}"`);
    assert.equal(
      classifyStemRegime(font.stemWidthRatio),
      expectedRegime,
      `font "${id}" (stemWidthRatio ${JSON.stringify(font.stemWidthRatio)}) no longer classifies as "${expectedRegime}"`
    );
  }
});

await test('4c. per-class membership counts match the current manifest exactly', () => {
  const counts = { monoline: 0, transitional: 0, massed: 0, unmeasured: 0 };
  for (const font of enabledFonts) counts[classifyStemRegime(font.stemWidthRatio)] += 1;
  assert.deepEqual(counts, EXPECTED_CLASS_COUNTS);
  const total = Object.values(EXPECTED_CLASS_COUNTS).reduce((a, b) => a + b, 0);
  assert.equal(total, enabledFonts.length, 'class counts must sum to the enabled-font count');
});

await test('5. this file is registered in the geometry group and runs in both the default and full suites', () => {
  assertTestRegistered({
    filename: 'test-read-011-stem-regime.mjs',
    group: 'geometry',
    includedInDefault: true
  });
});

console.log('READ-011A stem-regime classification tests passed.');
