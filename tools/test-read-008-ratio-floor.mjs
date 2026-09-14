import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertTestRegistered } from './lib/test-registration-assertions.mjs';

// READ-008 — the auto-fit readability floor, re-expressed in stone diameters.
//
// S-107's MIN_AUTOFIT_HEIGHT_TO_SPACING_RATIO = 6 was measured against stone *pitch*
// (stoneSize + gap); READ-008 renamed it MIN_HEIGHT_TO_STONE_RATIO, re-based it on stone *diameter*
// alone (gap is user-editable and legibility-irrelevant), and raised it to 16 -- chosen on
// StoneSizes.js's five supportedHeightRangeMm minima, not on READ-007's calibration, which cannot
// locate a boundary below ratio 20 (docs/specifications/READ-008-RatioFloor.md).
//
// READ-009 moved the floor's arithmetic (MIN_HEIGHT_TO_STONE_RATIO, the scale math) out of app.js
// and into the shared src/geometry/TextAutoFit.js module, so this suite now imports the real
// shared function directly instead of extracting+`new Function`-evaluating app.js source (the old
// extraction still finds app.js's thin computeAutoFitScale() wrapper, but that wrapper's body
// calls the shared module's exports, which a bare `new Function` sandbox has no closure over --
// this is the same MONO-006D lesson tools/test-text-position-workflow.mjs already applied).
//
// This suite originally proved the floor's behavioural blast radius was *exactly* two named
// fixtures (long-name-autofit.rhs, long-script-name.rhs), asserting their specific before/after
// scales against a hardcoded list. READ-009 re-authored both fixtures (shorter names, taller text)
// so auto-fit still genuinely engages for both, but the fit-to-width scale alone now lands above
// the floor for every fixture in the corpus -- see
// docs/specifications/READ-009-FixtureAutoFitFloor.md for why the fixtures moved rather than the
// committed geometry alone. A hardcoded "exactly these two" list would have nothing left to name,
// so this suite now asserts the underlying invariant directly: no committed fixture's auto-fit
// scale is floor-clamped. That invariant has teeth -- it fails the day anyone adds or edits a
// fixture whose auto-fit genuinely needs the floor, which is exactly the case this suite exists to
// catch. Floor-clamping itself is still exercised directly, against a synthetic in-memory project
// using the retired long-name-autofit.rhs parameters, by
// tools/test-read-009-bridge-autofit-floor.mjs.

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const examplesDir = path.join(repoRoot, 'examples');
const appJs = await readFile(path.join(repoRoot, 'app.js'), 'utf8');

const { FontManager } = await import('../src/fonts/index.js');
const { createDefaultFontProviderRegistry } = await import('../src/text/index.js');
const { GeometryEngine, MIN_HEIGHT_TO_STONE_RATIO, maxAutoFitWidthMm, computeTextAutoFitScale } = await import('../src/geometry/index.js');
const { validateRhsProject, toAppProjectShape } = await import('../src/gallery/RhsFixtureBridge.js');

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

// --- the code under test: the real shared floor, plus app.js's thin wrapper over it --------------

function extractBlock(source, pattern, label) {
  const match = source.match(pattern);
  assert.ok(match, `expected to find ${label} in app.js`);
  return match[0];
}

// Structural check only (test 0 below) -- app.js's own wrapper still must read layer.stoneSize and
// never layer.gap. The actual arithmetic under test is the imported computeTextAutoFitScale().
const computeAutoFitScaleSrc = extractBlock(appJs, /function computeAutoFitScale\([^)]*\)\{[\s\S]*?\n\}/, 'function computeAutoFitScale()');

function computeAutoFitScale(layer, project, measuredWidthMm) {
  if (!layer.autoFit) return { scale: 1 };
  return computeTextAutoFitScale({
    measuredWidthMm,
    maxWidthMm: maxAutoFitWidthMm(project.canvas.width),
    heightMm: layer.height,
    stoneSizeMm: layer.stoneSize
  });
}

await test('0. the extracted floor is expressed against stone diameter alone (not pitch) and its value is 16', () => {
  assert.equal(MIN_HEIGHT_TO_STONE_RATIO, 16, 'READ-008 sets the floor to 16 stone diameters');
  // computeAutoFitScale() must read layer.stoneSize but never layer.gap.
  assert.match(computeAutoFitScaleSrc, /layer\.stoneSize/);
  assert.doesNotMatch(computeAutoFitScaleSrc, /layer\.gap/, 'the diameter floor must not consult gap');
});

// --- real generated widths for every autoFit text layer in every fixture ------------------------

const manifest = JSON.parse(await readFile(path.join(repoRoot, 'assets/fonts/manifest.json'), 'utf8'));
const fontManager = new FontManager(manifest);
async function loadFontBuffer(relativePath) {
  const buffer = await readFile(path.join(repoRoot, relativePath));
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
}
const permanentEngine = new GeometryEngine({
  fontProviderRegistry: createDefaultFontProviderRegistry(fontManager, { loadFontBuffer })
});

const exampleFiles = (await readdir(examplesDir)).filter((f) => f.endsWith('.rhs')).sort();

// One row per visible autoFit text layer across the whole fixture set.
const rows = [];
// Fixtures validateRhsProject()/toAppProjectShape() reject are recorded, not silently skipped --
// test 1 asserts this is exactly zero across the whole fixture set (every examples/*.rhs file is a
// well-formed RhsFixtureBridge project), so a future fixture that genuinely fails to translate
// fails loudly here instead of quietly shrinking the measured set.
const swallowedFiles = [];
for (const file of exampleFiles) {
  const raw = JSON.parse(await readFile(path.join(examplesDir, file), 'utf8'));
  let app;
  try {
    app = toAppProjectShape(validateRhsProject(raw, file));
  } catch (error) {
    swallowedFiles.push({ file, message: error.message });
    continue;
  }
  for (const layer of app.layers) {
    if (layer.type !== 'text' || layer.visible === false || !layer.autoFit) continue;
    const result = await permanentEngine.generateTextLayout({
      text: layer.text,
      fontId: layer.font,
      providerId: fontManager.getFont(layer.font).providerId,
      layerId: layer.id,
      heightMm: layer.height,
      stoneSizeMm: layer.stoneSize,
      gapMm: layer.gap,
      mode: layer.textMode === 'fill' ? 'fill' : 'outline',
      color: layer.color
    });
    const project = { canvas: { width: app.canvas.width, height: app.canvas.height } };
    const fit = computeAutoFitScale(layer, project, result.widthMm);
    rows.push({
      file,
      text: layer.text,
      widthMm: result.widthMm,
      scale: fit.scale,
      floored: Boolean(fit.floored)
    });
  }
}

// The exact count of autoFit text layers across the current examples/*.rhs set: bottle-front-design
// (2), business-logo-monogram-bottle (1), long-name-autofit (1), long-script-name (1),
// mixed-fill-styles-and-sizes (2), multi-color-mixed-layers (1), svg-logo-import (1),
// team-jersey-name-number (1), tumbler-wrap-design (1), vitalina-serbin (1),
// wedding-bride-tribe-tumbler (1) = 13. An exact count, not a floor, so an added/removed autoFit
// text layer anywhere in the fixture set is caught here rather than passing silently.
const EXPECTED_ROW_COUNT = 13;

await test('1. no examples/*.rhs fixture was silently dropped by the RhsFixtureBridge translation, and the sub-suite measured exactly the expected set of autoFit text layers', () => {
  assert.deepEqual(swallowedFiles, [], `expected every examples/*.rhs fixture to translate cleanly; ${swallowedFiles.length} did not: ${JSON.stringify(swallowedFiles)}`);
  assert.equal(rows.length, EXPECTED_ROW_COUNT, `expected exactly ${EXPECTED_ROW_COUNT} autoFit text layers across the fixture set, measured ${rows.length}: ${JSON.stringify(rows.map((r) => r.file))}`);
});

await test('2. no committed examples/*.rhs fixture currently needs the floor to be clamped -- READ-009 re-authored the two fixtures that once did (long-name-autofit.rhs, long-script-name.rhs) so their auto-fit fits within the floor unclamped; this is a live invariant, not a historical snapshot, so it fails the moment any fixture is added or edited into needing the clamp again', () => {
  const clamped = rows.filter((r) => r.floored);
  assert.deepEqual(clamped.map((r) => r.file), [],
    `expected no fixture to have a floor-clamped auto-fit scale, found: ${JSON.stringify(clamped)}`);
});

await test('3. this file is registered in test:integration and the default suite (via tools/test-groups.mjs + tools/run-tests.mjs)', () => {
  assertTestRegistered({
    filename: 'test-read-008-ratio-floor.mjs',
    group: 'integration',
    includedInDefault: true
  });
});

console.log('READ-008 ratio-floor tests passed.');
