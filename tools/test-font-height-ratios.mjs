import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { computeShapeFitScale } from '../src/geometry/ShapeFit.js';

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

await test('4. OpenType fonts outside TXT-104\'s measured portfolio (every bundled font except the rhinestoneValidated 4) must NOT have capHeightRatio/xHeightRatio', () => {
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

// --- TXT-104 step 4a: solveDesiredCapHeightMm() + computeLetterHeightBoundsMm() ---
//
// Same extraction-via-new-Function convention as solveEngineHeightMm() above. solveDesiredCapHeightMm()
// only reads the module-level fontManager (injected the same way); computeLetterHeightBoundsMm() also
// reads the RAW_ENGINE_HEIGHT_MM_MIN/MAX module-level constants and calls solveDesiredCapHeightMm(),
// so its extracted source is stitched together with those, and the already-extracted
// solveDesiredCapHeightMm function is injected as a free variable.

const solveDesiredCapHeightMmSrc = extractBlock(appJs, /function solveDesiredCapHeightMm\([^)]*\)\{[\s\S]*?\n\}/, 'function solveDesiredCapHeightMm()');
// eslint-disable-next-line no-new-func
const solveDesiredCapHeightMm = new Function('fontManager', `return ${solveDesiredCapHeightMmSrc};`)(fontManager);

const rawHeightConstSrc = extractBlock(appJs, /const RAW_ENGINE_HEIGHT_MM_MIN=\d+,RAW_ENGINE_HEIGHT_MM_MAX=\d+;/, 'RAW_ENGINE_HEIGHT_MM_MIN/MAX constants');
const computeLetterHeightBoundsMmSrc = extractBlock(appJs, /function computeLetterHeightBoundsMm\([^)]*\)\{[\s\S]*?\n\}/, 'function computeLetterHeightBoundsMm()');
// eslint-disable-next-line no-new-func
const computeLetterHeightBoundsMm = new Function('solveDesiredCapHeightMm', `${rawHeightConstSrc}\nreturn ${computeLetterHeightBoundsMmSrc};`)(solveDesiredCapHeightMm);

await test('11. solveDesiredCapHeightMm() is the exact inverse of solveEngineHeightMm() for every in-scope font', () => {
  for (const id of EXPECTED_IN_SCOPE_IDS) {
    for (const desiredCapHeightMm of [10, 30, 75]) {
      const engineHeightMm = solveEngineHeightMm({ fontId: id, desiredCapHeightMm });
      const roundTripped = solveDesiredCapHeightMm({ fontId: id, engineHeightMm });
      assert.ok(
        Math.abs(roundTripped - desiredCapHeightMm) < 1e-9,
        `${id}: round-trip of ${desiredCapHeightMm} through solveEngineHeightMm() then solveDesiredCapHeightMm() gave ${roundTripped}`
      );
    }
  }
});

await test('12. computeLetterHeightBoundsMm() produces a different {minMm,maxMm} per font (capHeightRatio must not be silently ignored)', () => {
  const bounds = EXPECTED_IN_SCOPE_IDS.map((id) => computeLetterHeightBoundsMm(id));
  const allSameMin = bounds.every((b) => b.minMm === bounds[0].minMm);
  const allSameMax = bounds.every((b) => b.maxMm === bounds[0].maxMm);
  assert.ok(!allSameMin && !allSameMax, `expected computeLetterHeightBoundsMm() bounds to differ per font, got ${JSON.stringify(bounds)}`);
});

await test('13. computeLetterHeightBoundsMm()\'s minMm/maxMm round-trip back through solveEngineHeightMm() to exactly the raw engine clamp (4, 111)', () => {
  for (const id of EXPECTED_IN_SCOPE_IDS) {
    const { minMm, maxMm } = computeLetterHeightBoundsMm(id);
    const engineMin = solveEngineHeightMm({ fontId: id, desiredCapHeightMm: minMm });
    const engineMax = solveEngineHeightMm({ fontId: id, desiredCapHeightMm: maxMm });
    assert.ok(Math.abs(engineMin - 4) < 1e-9, `${id}: minMm round-trip expected 4, got ${engineMin}`);
    assert.ok(Math.abs(engineMax - 111) < 1e-9, `${id}: maxMm round-trip expected 111, got ${engineMax}`);
  }
});

await test('14. solveDesiredCapHeightMm() and computeLetterHeightBoundsMm() throw for fonts with no capHeightRatio (RS Block, RS Modern, any non-validated legacy OpenType font)', () => {
  for (const id of ['rs-block', 'rs-modern', 'courier-prime-regular']) {
    assert.throws(
      () => solveDesiredCapHeightMm({ fontId: id, engineHeightMm: 30 }),
      /capHeightRatio/,
      `expected solveDesiredCapHeightMm('${id}') to throw a capHeightRatio-related error, not return NaN`
    );
    assert.throws(
      () => computeLetterHeightBoundsMm(id),
      /capHeightRatio/,
      `expected computeLetterHeightBoundsMm('${id}') to throw a capHeightRatio-related error, not return NaN`
    );
  }
});

// --- TXT-104 step 5: Auto Fit / Fit-to-Shape verification pass ---
//
// Design doc section 3.4/4 step 5 claims computeAutoFitScale() and ShapeFit.computeShapeFitScale()
// already treat layer.height as an opaque scalar to re-scale and re-measure, with no opinion on
// what it "means" -- i.e. heightMode ('raw' vs 'capHeight') cannot affect either function's output,
// since neither function reads heightMode at all (confirmed by re-reading both bodies: app.js:432-440
// only reads layer.autoFit/layer.stoneSize/layer.gap/layer.height/project.canvas.width;
// ShapeFit.computeShapeFitScale() takes currentHeightMm/measuredWidthMm/measuredHeightMm/spacingMm/
// targetWidthMm/targetHeightMm/minHeightToSpacingRatio as plain numbers, never a layer object). These
// tests prove that claim empirically with two otherwise-identical layers differing only in
// heightMode, rather than resting on the design doc's inspection alone. Zero production code change
// expected or made for this step.

const computeAutoFitScaleSrc = extractBlock(appJs, /function computeAutoFitScale\([^)]*\)\{[\s\S]*?\n\}/, 'function computeAutoFitScale()');
const minAutoFitRatioDecl = extractBlock(appJs, /const MIN_AUTOFIT_HEIGHT_TO_SPACING_RATIO=\d+(\.\d+)?;/, 'the MIN_AUTOFIT_HEIGHT_TO_SPACING_RATIO declaration');
const MIN_AUTOFIT_HEIGHT_TO_SPACING_RATIO = Number(minAutoFitRatioDecl.match(/=([\d.]+);/)[1]);
// eslint-disable-next-line no-new-func
const computeAutoFitScale = new Function(`${minAutoFitRatioDecl}\nreturn ${computeAutoFitScaleSrc};`)();

const shapeFitProject = { canvas: { width: 210, height: 90 } };

await test('15. computeAutoFitScale() returns an identical scale for two layers differing only in heightMode (mode-agnostic, per design doc section 3.4)', () => {
  const rawLayer = { autoFit: true, height: 25, heightMode: 'raw', stoneSize: 2, gap: 0.3 };
  const capHeightLayer = { ...rawLayer, heightMode: 'capHeight' };
  const measuredWidthMm = 250; // forces mild overflow (fit-to-width shrink, scale < 1)

  const rawResult = computeAutoFitScale(rawLayer, shapeFitProject, measuredWidthMm);
  const capHeightResult = computeAutoFitScale(capHeightLayer, shapeFitProject, measuredWidthMm);

  assert.ok(rawResult.scale < 1, `expected this width to force a shrink, got scale=${rawResult.scale}`);
  assert.equal(rawResult.scale, capHeightResult.scale, 'expected heightMode alone to never change the returned scale');

  // "shrinks the effective corrected value coherently" (design doc section 3.4), made concrete: the
  // effective cap height at the scaled engine height must equal the unscaled effective cap height
  // times the same scale, for a validated font.
  const fontId = 'baloo2-variable-regular';
  const scaledHeight = capHeightLayer.height * capHeightResult.scale;
  const scaledCapHeightMm = solveDesiredCapHeightMm({ fontId, engineHeightMm: scaledHeight });
  const unscaledCapHeightMm = solveDesiredCapHeightMm({ fontId, engineHeightMm: capHeightLayer.height });
  assert.ok(
    Math.abs(scaledCapHeightMm - unscaledCapHeightMm * capHeightResult.scale) < 1e-9,
    `expected the scaled effective cap height (${scaledCapHeightMm}) to equal the unscaled effective cap height (${unscaledCapHeightMm}) times the auto-fit scale (${capHeightResult.scale})`
  );
});

await test('16. ShapeFit.computeShapeFitScale() returns an identical scale for two layers differing only in heightMode (mode-agnostic, per design doc section 3.4)', () => {
  const rawLayer = { height: 25, heightMode: 'raw', stoneSize: 2, gap: 0.3 };
  const capHeightLayer = { ...rawLayer, heightMode: 'capHeight' };
  // measuredWidthMm/measuredHeightMm/targetWidthMm/targetHeightMm chosen so the width axis is the
  // binding constraint (scaleForWidth=0.75 < scaleForHeight=0.9), forcing a shrink (scale < 1) that
  // stays above the legibility floor (spacingMm*minHeightToSpacingRatio = 2.3*6 = 13.8mm), so this
  // test isolates the mode-agnostic claim rather than the separate legibility-floor path.
  const fitParams = { measuredWidthMm: 200, measuredHeightMm: 50, targetWidthMm: 150, targetHeightMm: 45, minHeightToSpacingRatio: MIN_AUTOFIT_HEIGHT_TO_SPACING_RATIO };

  const rawResult = computeShapeFitScale({ currentHeightMm: rawLayer.height, spacingMm: rawLayer.stoneSize + rawLayer.gap, ...fitParams });
  const capHeightResult = computeShapeFitScale({ currentHeightMm: capHeightLayer.height, spacingMm: capHeightLayer.stoneSize + capHeightLayer.gap, ...fitParams });

  assert.ok(rawResult.ok && capHeightResult.ok, `expected both fits to succeed, got ${JSON.stringify(rawResult)} / ${JSON.stringify(capHeightResult)}`);
  assert.ok(rawResult.scale < 1, `expected this target box to force a shrink, got scale=${rawResult.scale}`);
  assert.equal(rawResult.scale, capHeightResult.scale, 'expected heightMode alone to never change the returned scale');
});

console.log('Font height ratio tests passed.');
