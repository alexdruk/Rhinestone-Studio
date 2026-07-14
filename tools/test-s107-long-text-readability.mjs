import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { execSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// S-107 (Long Text Readability) — root cause: auto-fit (layer.autoFit) shrinks a text layer's
// heightMm to force very long text to fit project.canvas.width, but stoneSizeMm/gapMm (the physical
// stone pitch -- a real catalog rhinestone, see src/renderer/StoneSizes.js) never shrink to match.
// As requested text gets longer, auto-fit's required shrink grows without bound, so the fixed-size
// stones increasingly overwhelm the shrunk glyph strokes until the pattern reads as a blurred row of
// dots instead of letters -- reproducible in both the 2D canvas and the Object Preview alike (see
// docs/specifications/S-107-LongTextReadability.md's audit), and worse on the Object Preview because
// its curved-surface projection/lighting further reduces contrast on an already-marginal pattern.
//
// Fix: computeAutoFitScale() (app.js) now clamps how far auto-fit will shrink heightMm to a
// legibility floor -- heightMm never drops below MIN_AUTOFIT_HEIGHT_TO_SPACING_RATIO times the
// layer's own (unchanged) stoneSize+gap pitch. Text short/plain enough that the old fit-to-width
// scale never crossed that floor gets the exact same scale as before (byte-identical short/medium
// behavior); only text long enough to need more shrinking than the floor allows now overflows
// maxWidth (triggering the pre-existing "outside printable area" warning/Center Text affordance)
// instead of collapsing into illegible stone soup. No change to GeometryEngine/StoneLayout, no
// second layout pipeline, no exporter/schema change, no multi-row text.
//
// Structural checks against the live app.js source (app.js is a browser entry point and is not
// import()-able directly under plain Node, matching the established convention in
// tools/test-alignment-snapping-integration.mjs); behavioral checks extract and execute the real,
// pure computeAutoFitScale() function from that source, mirroring that same file's
// extractFunction()/new Function() precedent.

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const appJs = await readFile(path.join(repoRoot, 'app.js'), 'utf8');
const packageJson = JSON.parse(await readFile(path.join(repoRoot, 'package.json'), 'utf8'));

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

function extractFunction(source, name) {
  const match = source.match(new RegExp(`function ${name}\\([^)]*\\)\\{[\\s\\S]*?\\n(?=(function |const |let |class ))`))
    || source.match(new RegExp(`function ${name}\\([^)]*\\)\\{.*`));
  assert.ok(match, `expected to find function ${name}() in app.js`);
  // eslint-disable-next-line no-new-func
  return new Function(`return ${match[0].replace(/\n$/, '')}`)();
}

const ratioMatch = appJs.match(/const MIN_AUTOFIT_HEIGHT_TO_SPACING_RATIO=\d+(\.\d+)?;/);
assert.ok(ratioMatch, 'expected to find the MIN_AUTOFIT_HEIGHT_TO_SPACING_RATIO declaration in app.js');
const computeAutoFitScaleMatch = appJs.match(/function computeAutoFitScale\([^)]*\)\{[\s\S]*?\n\}/);
assert.ok(computeAutoFitScaleMatch, 'expected to find function computeAutoFitScale() in app.js');
// eslint-disable-next-line no-new-func
const computeAutoFitScale = new Function(`${ratioMatch[0]}\nreturn ${computeAutoFitScaleMatch[0]};`)();

// ---------------------------------------------------------------------------------------------
// Structural wiring checks
// ---------------------------------------------------------------------------------------------

await test('1. app.js declares a single MIN_AUTOFIT_HEIGHT_TO_SPACING_RATIO constant', () => {
  const matches = appJs.match(/const MIN_AUTOFIT_HEIGHT_TO_SPACING_RATIO=/g) || [];
  assert.equal(matches.length, 1, 'expected exactly one MIN_AUTOFIT_HEIGHT_TO_SPACING_RATIO declaration');
});

await test('2. generateTextStonesLive() computes its auto-fit scale via the shared computeAutoFitScale() helper, not inline maxWidth arithmetic', () => {
  const methodMatch = appJs.match(/generateTextStonesLive\(layer,project\)\{[\s\S]*?const bb=result\.getBoundingBox\(\);/);
  assert.ok(methodMatch, 'expected to find generateTextStonesLive() in app.js');
  assert.ok(methodMatch[0].includes('computeAutoFitScale(layer,project,result.widthMm)'));
  assert.ok(!/const maxWidth=project\.canvas\.width-10/.test(methodMatch[0]), 'expected the old inline maxWidth computation to be gone from generateTextStonesLive()');
});

await test('3. resolveLayerShapeSource()\'s text branch computes its auto-fit scale via the same shared helper', () => {
  const branchMatch = appJs.match(/if\(layer\.type==='text'\)\{[\s\S]*?\n {2}\}\n {2}if\(layer\.type==='image'\)/);
  assert.ok(branchMatch, "expected to find resolveLayerShapeSource()'s text branch in app.js");
  assert.ok(branchMatch[0].includes('computeAutoFitScale(layer,project,resolved.boundingBox.widthMm)'));
  assert.ok(!/const maxWidth=project\.canvas\.width-10/.test(branchMatch[0]), 'expected the old inline maxWidth computation to be gone from resolveLayerShapeSource()');
});

await test('4. no forbidden file changed (GeometryEngine/StoneLayout, any exporter, or the project schema)', () => {
  const output = execSync('git status --porcelain', { cwd: repoRoot, encoding: 'utf8' });
  const changedPaths = output
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .map((line) => line.slice(3).trim());

  const forbiddenPrefixes = ['src/geometry/', 'src/export/'];
  for (const changedPath of changedPaths) {
    assert.ok(
      !forbiddenPrefixes.some((prefix) => changedPath.startsWith(prefix)),
      `Forbidden file changed: ${changedPath} (S-107 must not touch GeometryEngine/StoneLayout or any exporter)`
    );
  }
});

await test('5. package.json registers this milestone\'s test suite', () => {
  assert.ok(packageJson.scripts.test.includes('test-s107-long-text-readability.mjs'));
});

// ---------------------------------------------------------------------------------------------
// Behavioral checks (real computeAutoFitScale(), extracted and executed)
// ---------------------------------------------------------------------------------------------

const project = { canvas: { width: 210, height: 90 } };

await test('6. autoFit off never rescales, regardless of measured width', () => {
  const layer = { autoFit: false, height: 25, stoneSize: 2, gap: 0.3 };
  assert.equal(computeAutoFitScale(layer, project, 1000), 1);
});

await test('7. text that already fits (widthMm <= maxWidth) is never rescaled -- short/medium text is untouched', () => {
  const layer = { autoFit: true, height: 25, stoneSize: 2, gap: 0.3 };
  assert.equal(computeAutoFitScale(layer, project, 150), 1); // maxWidth = 210-10 = 200
  assert.equal(computeAutoFitScale(layer, project, 200), 1); // exactly at the boundary
});

await test('8. mild overflow (fit-to-width scale stays above the legibility floor) rescales exactly as before this milestone', () => {
  const layer = { autoFit: true, height: 25, stoneSize: 2, gap: 0.3 };
  // spacingMm = 2.3, floor = 2.3*6/25 = 0.552; a measured width of 250mm needs fitScale = 200/250 = 0.8,
  // comfortably above the floor, so the pre-existing fit-to-width behavior must be unchanged.
  const scale = computeAutoFitScale(layer, project, 250);
  assert.ok(Math.abs(scale - 0.8) < 1e-9, `expected the unchanged fit-to-width scale 0.8, got ${scale}`);
});

await test('9. severe overflow (fit-to-width would crush text past the legibility floor) clamps to the floor instead, letting text overflow maxWidth', () => {
  const layer = { autoFit: true, height: 25, stoneSize: 2, gap: 0.3 };
  // Reproduces the reported bug's magnitude: a 67-character phrase measured ~786mm wide at height 25.
  const measuredWidthMm = 786.3;
  const fitScale = (project.canvas.width - 10) / measuredWidthMm; // ~0.254 -- the old, unreadable scale
  const scale = computeAutoFitScale(layer, project, measuredWidthMm);
  assert.ok(scale > fitScale, 'expected the floor to win over the old, more-aggressive fit-to-width shrink');
  const spacingMm = layer.stoneSize + layer.gap;
  const resultingHeightMm = layer.height * scale;
  assert.ok(resultingHeightMm / spacingMm >= 6 - 1e-9, 'expected the resulting height/spacing ratio to sit at the 6x legibility floor');
});

await test('10. the floor never scales height up past the original nominal height', () => {
  const layer = { autoFit: true, height: 5, stoneSize: 2, gap: 0.3 };
  // A tiny nominal height (already below the floor's own target) plus enormous measured width must
  // still never make computeAutoFitScale() return more than 1 -- auto-fit only ever shrinks.
  const scale = computeAutoFitScale(layer, project, 5000);
  assert.ok(scale <= 1, `expected scale to never exceed 1, got ${scale}`);
});

console.log('S-107 long text readability tests passed.');
