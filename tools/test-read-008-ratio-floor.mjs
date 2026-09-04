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
// This suite proves the behavioural blast radius is *exactly* two committed fixtures. It extracts
// the real computeAutoFitScale() from app.js source and executes it (the `new Function` idiom
// tools/test-text-position-workflow.mjs already uses -- the arithmetic is never reimplemented),
// drives it against every examples/*.rhs fixture using real permanentEngine.generateTextLayout()
// widths, and asserts a hardcoded, explicitly named list of the fixtures whose auto-fit scale the
// new floor changes -- with their before/after scales -- plus the complementary property that every
// other fixture's auto-fit scale is byte-identical before and after.

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const examplesDir = path.join(repoRoot, 'examples');
const appJs = await readFile(path.join(repoRoot, 'app.js'), 'utf8');

const { FontManager } = await import('../src/fonts/index.js');
const { createDefaultFontProviderRegistry } = await import('../src/text/index.js');
const { GeometryEngine } = await import('../src/geometry/index.js');
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

// --- the code under test: the real computeAutoFitScale() + its constant, from app.js source -------

function extractBlock(source, pattern, label) {
  const match = source.match(pattern);
  assert.ok(match, `expected to find ${label} in app.js`);
  return match[0];
}

const ratioDecl = extractBlock(appJs, /const MIN_HEIGHT_TO_STONE_RATIO=\d+(\.\d+)?;/, 'the MIN_HEIGHT_TO_STONE_RATIO declaration');
const computeAutoFitScaleSrc = extractBlock(appJs, /function computeAutoFitScale\([^)]*\)\{[\s\S]*?\n\}/, 'function computeAutoFitScale()');
// eslint-disable-next-line no-new-func
const computeAutoFitScale = new Function(`${ratioDecl}\nreturn ${computeAutoFitScaleSrc};`)();
const MIN_HEIGHT_TO_STONE_RATIO = Number(ratioDecl.match(/=([\d.]+);/)[1]);

// The pre-READ-008 floor: height / (stoneSize + gap) >= 6. Reproduced here ONLY as an oracle to
// prove the change is confined to the fixtures named below -- it is not the code under test.
function preRead008AutoFitScale(layer, project, measuredWidthMm) {
  if (!layer.autoFit || !(measuredWidthMm > 0)) return { scale: 1 };
  const maxWidth = project.canvas.width - 10;
  if (measuredWidthMm <= maxWidth) return { scale: 1 };
  const fitScale = maxWidth / measuredWidthMm;
  const spacingMm = (layer.stoneSize || 0) + (layer.gap || 0);
  const minScale = spacingMm > 0 && layer.height > 0 ? (spacingMm * 6) / layer.height : fitScale;
  return { scale: Math.min(1, Math.max(fitScale, minScale)) };
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
    rows.push({
      file,
      text: layer.text,
      widthMm: result.widthMm,
      before: preRead008AutoFitScale(layer, project, result.widthMm).scale,
      after: computeAutoFitScale(layer, project, result.widthMm).scale
    });
  }
}

// The named list -- a list, not a count. Every fixture whose auto-fit scale READ-008's floor moves,
// with the exact before (pitch basis, ratio 6) and after (diameter basis, ratio 16) scales.
const FLOOR_CHANGES = {
  'long-name-autofit.rhs': {
    text: 'Alexandria Konstantinova',
    before: 0.46304994675729105, // fit-to-width: (210-10) / 431.9188489289052
    after: 0.96 // MIN_HEIGHT_TO_STONE_RATIO floor: 1.8 * 16 / 30
  },
  'long-script-name.rhs': {
    text: 'Anastasiya Konstantinovna Volkova',
    before: 0.6489219393227753, // fit-to-width: (210-10) / 308.20348008070584
    after: 12 / 13 // MIN_HEIGHT_TO_STONE_RATIO floor: 1.5 * 16 / 26
  }
};

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
  for (const name of Object.keys(FLOOR_CHANGES)) {
    assert.ok(rows.some((r) => r.file === name), `named fixture ${name} was not measured`);
  }
});

await test('2. READ-008 changes the auto-fit scale of exactly the named fixtures -- long-name-autofit.rhs and long-script-name.rhs -- and no others', () => {
  const observed = rows
    .filter((r) => Math.abs(r.before - r.after) > 1e-9)
    .map((r) => r.file)
    .sort();
  assert.deepEqual(observed, Object.keys(FLOOR_CHANGES).sort(),
    'the floor must move exactly the named fixtures');
});

await test('3. each named fixture\'s before/after auto-fit scale is exactly as recorded', () => {
  for (const [file, expected] of Object.entries(FLOOR_CHANGES)) {
    const row = rows.find((r) => r.file === file);
    assert.equal(row.text, expected.text, `${file}: text layer identity`);
    assert.ok(Math.abs(row.before - expected.before) < 1e-9,
      `${file}: before (pitch basis, ratio 6) expected ${expected.before}, got ${row.before}`);
    assert.ok(Math.abs(row.after - expected.after) < 1e-9,
      `${file}: after (diameter basis, ratio 16) expected ${expected.after}, got ${row.after}`);
    assert.ok(expected.before < expected.after,
      `${file}: the floor raises the scale (less shrink), so after must exceed before`);
  }
});

await test('4. every fixture NOT on the named list is byte-unchanged: identical auto-fit scale before and after', () => {
  for (const row of rows) {
    if (FLOOR_CHANGES[row.file]) continue;
    assert.equal(row.after, row.before,
      `${row.file} ("${row.text}") auto-fit scale changed (${row.before} -> ${row.after}) but is not on the named list`);
  }
});

await test('5. this file is registered in test:integration and the default suite (via tools/test-groups.mjs + tools/run-tests.mjs)', () => {
  assertTestRegistered({
    filename: 'test-read-008-ratio-floor.mjs',
    group: 'integration',
    includedInDefault: true
  });
});

console.log('READ-008 ratio-floor tests passed.');
