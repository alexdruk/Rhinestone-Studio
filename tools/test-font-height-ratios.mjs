import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// TXT-104 step 1 -- cross-checks assets/fonts/manifest.json's stored capHeightRatio/xHeightRatio
// for the shipped OpenType production portfolio (Baloo 2, Anton, Sacramento, Dancing Script)
// against a live re-measurement of the real .ttf/variable-font files, via the exact same
// FontManager -> OpenTypeProvider production path tools/measure-font-height-ratios.mjs uses --
// mirroring tools/test-stone-size-library.mjs's own "the manifest value and its offline
// calibration source can never silently drift apart" pattern (that file's test 12, for
// supportedHeightRangeMm/tools/font-generator/config/SS*.json). A future font-file swap that
// forgets to re-run the measurement script is caught here, not silently shipped.

const { measureFontHeightRatios, roundRatio } = await import('./measure-font-height-ratios.mjs');
const { FontManager } = await import('../src/fonts/FontManager.js');

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const manifestPath = path.join(repoRoot, 'assets/fonts/manifest.json');
const appJsPath = path.join(repoRoot, 'app.js');

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
const fontsById = new Map(manifest.fonts.map((f) => [f.id, f]));

// The exact four fonts design doc TXT-104 section 2/3.2 measured and this milestone's scope
// covers -- see measure-font-height-ratios.mjs's own module doc for why these four and no others.
const EXPECTED_IN_SCOPE_IDS = ['anton-regular', 'baloo2-variable-regular', 'sacramento-regular', 'dancing-script-regular'];

await test('1. manifest.json has capHeightRatio/xHeightRatio for exactly the shipped OpenType production portfolio', () => {
  for (const id of EXPECTED_IN_SCOPE_IDS) {
    const font = fontsById.get(id);
    assert.ok(font, `expected manifest to contain font id "${id}"`);
    assert.equal(typeof font.capHeightRatio, 'number', `${id} must have a numeric capHeightRatio`);
    assert.equal(typeof font.xHeightRatio, 'number', `${id} must have a numeric xHeightRatio`);
  }
});

await test('2. capHeightRatio/xHeightRatio are plausible ratios of the em square (0,1) for every in-scope font', () => {
  for (const id of EXPECTED_IN_SCOPE_IDS) {
    const font = fontsById.get(id);
    assert.ok(font.capHeightRatio > 0 && font.capHeightRatio < 1, `${id} capHeightRatio ${font.capHeightRatio} must be in (0,1)`);
    assert.ok(font.xHeightRatio > 0 && font.xHeightRatio < 1, `${id} xHeightRatio ${font.xHeightRatio} must be in (0,1)`);
    assert.ok(font.xHeightRatio < font.capHeightRatio, `${id} x-height (${font.xHeightRatio}) must be smaller than cap height (${font.capHeightRatio})`);
  }
});

await test('3. RS Block / RS Modern (authored stone-center fonts) must NOT have capHeightRatio/xHeightRatio -- no OpenType em-box exists for them (design doc section 1 row 4/row 5)', () => {
  for (const id of ['rs-block', 'rs-modern']) {
    const font = fontsById.get(id);
    assert.ok(font, `expected manifest to contain font id "${id}"`);
    assert.equal(font.providerId, 'rhinestone');
    assert.equal(font.capHeightRatio, undefined, `${id} must not carry a capHeightRatio`);
    assert.equal(font.xHeightRatio, undefined, `${id} must not carry an xHeightRatio`);
  }
});

await test('4. legacy, non-validated OpenType fonts (never offered by productionFonts()) must NOT have capHeightRatio/xHeightRatio', () => {
  for (const font of manifest.fonts) {
    if (EXPECTED_IN_SCOPE_IDS.includes(font.id)) continue;
    if (font.providerId === 'rhinestone') continue; // covered by test 3
    assert.equal(font.capHeightRatio, undefined, `${font.id} is not in this milestone's scope and must not carry a capHeightRatio`);
    assert.equal(font.xHeightRatio, undefined, `${font.id} is not in this milestone's scope and must not carry an xHeightRatio`);
  }
});

await test('5. manifest capHeightRatio/xHeightRatio exactly match a live re-measurement of the real .ttf/variable-font files', async () => {
  const measured = await measureFontHeightRatios();
  assert.equal(measured.length, EXPECTED_IN_SCOPE_IDS.length, 'measureFontHeightRatios() must return exactly the in-scope portfolio');

  for (const result of measured) {
    const font = fontsById.get(result.id);
    assert.ok(font, `measured font id "${result.id}" not found in manifest`);
    assert.equal(
      font.capHeightRatio,
      roundRatio(result.capHeightRatio),
      `${result.id} manifest capHeightRatio (${font.capHeightRatio}) has drifted from a live re-measurement of its font file (${roundRatio(result.capHeightRatio)}) -- re-run node tools/measure-font-height-ratios.mjs --write`
    );
    assert.equal(
      font.xHeightRatio,
      roundRatio(result.xHeightRatio),
      `${result.id} manifest xHeightRatio (${font.xHeightRatio}) has drifted from a live re-measurement of its font file (${roundRatio(result.xHeightRatio)}) -- re-run node tools/measure-font-height-ratios.mjs --write`
    );
  }
});

await test('6. measureFontHeightRatios() is deterministic across repeated calls (same font, same result)', async () => {
  const first = await measureFontHeightRatios();
  const second = await measureFontHeightRatios();
  assert.deepEqual(first, second);
});

// --- TXT-104 step 2: FontManager exposure + solveEngineHeightMm() ---
//
// FontManager.getFont() is a plain normalizeFontRecord() field allowlist (src/fonts/FontManager.js),
// not a passthrough of the raw manifest record -- these tests confirm capHeightRatio/xHeightRatio
// were actually added to that allowlist, not just present in the manifest test 1-4 already cover.
//
// solveEngineHeightMm() lives in app.js, which is a browser entry point with no exports (not
// import()-able under plain Node) -- extracted and executed via `new Function`, the established
// convention for testing app.js's pure logic functions (see tools/test-text-position-workflow.mjs's
// computeAutoFitScale() extraction). Because solveEngineHeightMm() reads the module-level
// `fontManager` variable rather than taking it as an argument (matching how it's called live in
// app.js), a real FontManager instance is injected as a function parameter of the same name.

const fontManager = new FontManager(JSON.parse(await readFile(manifestPath, 'utf8')));

await test('7. FontManager.getFont() exposes capHeightRatio/xHeightRatio for the validated OpenType portfolio, matching the manifest exactly', () => {
  for (const id of EXPECTED_IN_SCOPE_IDS) {
    const font = fontManager.getFont(id);
    assert.equal(font.capHeightRatio, fontsById.get(id).capHeightRatio, `${id}: FontManager.getFont() capHeightRatio must match the manifest`);
    assert.equal(font.xHeightRatio, fontsById.get(id).xHeightRatio, `${id}: FontManager.getFont() xHeightRatio must match the manifest`);
  }
});

await test('8. FontManager.getFont() leaves capHeightRatio/xHeightRatio undefined for RS Block/RS Modern and legacy non-validated OpenType fonts', () => {
  for (const font of fontManager.manifest.fonts) {
    if (EXPECTED_IN_SCOPE_IDS.includes(font.id)) continue;
    assert.equal(font.capHeightRatio, undefined, `${font.id}: FontManager.getFont() must not expose a capHeightRatio`);
    assert.equal(font.xHeightRatio, undefined, `${font.id}: FontManager.getFont() must not expose an xHeightRatio`);
  }
});

const appJs = await readFile(appJsPath, 'utf8');
function extractBlock(source, pattern, label) {
  const match = source.match(pattern);
  assert.ok(match, `expected to find ${label} in app.js`);
  return match[0];
}
const solveEngineHeightMmSrc = extractBlock(appJs, /function solveEngineHeightMm\([^)]*\)\{[\s\S]*?\n\}/, 'function solveEngineHeightMm()');
// eslint-disable-next-line no-new-func
const solveEngineHeightMm = new Function('fontManager', `return ${solveEngineHeightMmSrc};`)(fontManager);

await test('9. solveEngineHeightMm() solves the em-square heightMm from a desired cap height, matching desiredCapHeightMm / manifest capHeightRatio', () => {
  for (const id of EXPECTED_IN_SCOPE_IDS) {
    const desiredCapHeightMm = 30;
    const expected = desiredCapHeightMm / fontsById.get(id).capHeightRatio;
    const actual = solveEngineHeightMm({ fontId: id, desiredCapHeightMm });
    assert.ok(Math.abs(actual - expected) < 1e-9, `${id}: expected ~${expected}, got ${actual}`);
  }
  // Explicit sanity check against the exact example from the design doc's step-2 acceptance criteria.
  const baloo2 = solveEngineHeightMm({ fontId: 'baloo2-variable-regular', desiredCapHeightMm: 30 });
  assert.ok(Math.abs(baloo2 - 30 / 0.618) < 0.01, `expected baloo2-variable-regular's solved height to be ~${30 / 0.618}, got ${baloo2}`);
});

await test('10. solveEngineHeightMm() throws a clear error for fonts with no capHeightRatio (RS Block, and any non-validated legacy OpenType font)', () => {
  for (const id of ['rs-block', 'rs-modern', 'courier-prime-regular']) {
    assert.throws(
      () => solveEngineHeightMm({ fontId: id, desiredCapHeightMm: 30 }),
      /capHeightRatio/,
      `expected solveEngineHeightMm('${id}') to throw a capHeightRatio-related error, not return NaN`
    );
  }
});

console.log('Font height ratio tests passed.');
