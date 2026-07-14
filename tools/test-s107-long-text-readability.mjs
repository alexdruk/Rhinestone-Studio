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
// docs/specifications/S-107-LongTextReadability.md's audit).
//
// Fix (part 1): computeAutoFitScale() (app.js) clamps how far auto-fit will shrink heightMm to a
// legibility floor -- heightMm never drops below MIN_AUTOFIT_HEIGHT_TO_SPACING_RATIO times the
// layer's own (unchanged) stoneSize+gap pitch. Text short/plain enough that the old fit-to-width
// scale never crossed that floor gets the exact same scale as before (byte-identical short/medium
// behavior).
//
// Fix (part 2, this milestone's follow-up): the floor above means text long enough now overflows
// maxWidth instead of collapsing into illegible stone soup -- but silently letting it overflow still
// produced a confusing, heavily-clipped result on the Object Preview with only the pre-existing
// *positional* "outside the printable area" / "Center Text" warning, which is not a real fix for a
// text that is too wide to fit no matter where it sits. isTextTooLongForObject() detects that
// structural case (driven by computeAutoFitScale()'s `floorApplied`, not re-derived), and a new,
// persistent (non-Lightbox) "This text is too long to fit legibly on this object." warning replaces
// the misleading positional one whenever it applies.
//
// Structural checks against the live app.js/index.html source (app.js is a browser entry point and
// is not import()-able directly under plain Node, matching the established convention in
// tools/test-alignment-snapping-integration.mjs); behavioral checks extract and execute the real,
// pure logic functions from that source (mirroring that same file's extractFunction()/new Function()
// precedent), injecting a fake autoFitFloorAppliedByLayerId Map where a function reads that module
// state, so the actual decision logic runs for real rather than being merely pattern-matched.

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const appJs = await readFile(path.join(repoRoot, 'app.js'), 'utf8');
const indexHtml = await readFile(path.join(repoRoot, 'index.html'), 'utf8');
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

function extractBlock(source, pattern, label) {
  const match = source.match(pattern);
  assert.ok(match, `expected to find ${label} in app.js`);
  return match[0];
}

const ratioDecl = extractBlock(appJs, /const MIN_AUTOFIT_HEIGHT_TO_SPACING_RATIO=\d+(\.\d+)?;/, 'the MIN_AUTOFIT_HEIGHT_TO_SPACING_RATIO declaration');
const computeAutoFitScaleSrc = extractBlock(appJs, /function computeAutoFitScale\([^)]*\)\{[\s\S]*?\n\}/, 'function computeAutoFitScale()');
const isTextTooLongSrc = extractBlock(appJs, /function isTextTooLongForObject\([^)]*\)\{[\s\S]*?\n\}/, 'function isTextTooLongForObject()');
const recommendedWrapModeSrc = extractBlock(appJs, /function recommendedWrapModeForFit\([^)]*\)\{[\s\S]*?\n\}/, 'function recommendedWrapModeForFit()');
const textTooLongMessageSrc = extractBlock(appJs, /function textTooLongActionMessage\([^)]*\)\{[\s\S]*?\n\}/, 'function textTooLongActionMessage()');

// eslint-disable-next-line no-new-func
const computeAutoFitScale = new Function(`${ratioDecl}\nreturn ${computeAutoFitScaleSrc};`)();

// Builds { isTextTooLongForObject, recommendedWrapModeForFit, textTooLongActionMessage } wired
// together against a real, caller-supplied autoFitFloorAppliedByLayerId Map -- exactly the module
// state generateTextStonesLive() populates in the live app, injected here instead of the live app's
// own singleton so each test gets a clean, independent map.
function buildTooLongHelpers(floorAppliedByLayerId) {
  // eslint-disable-next-line no-new-func
  return new Function(
    'autoFitFloorAppliedByLayerId',
    `${isTextTooLongSrc}\n${recommendedWrapModeSrc}\n${textTooLongMessageSrc}\nreturn { isTextTooLongForObject, recommendedWrapModeForFit, textTooLongActionMessage };`
  )(floorAppliedByLayerId);
}

// ---------------------------------------------------------------------------------------------
// Structural wiring checks
// ---------------------------------------------------------------------------------------------

await test('1. app.js declares a single MIN_AUTOFIT_HEIGHT_TO_SPACING_RATIO constant', () => {
  const matches = appJs.match(/const MIN_AUTOFIT_HEIGHT_TO_SPACING_RATIO=/g) || [];
  assert.equal(matches.length, 1, 'expected exactly one MIN_AUTOFIT_HEIGHT_TO_SPACING_RATIO declaration');
});

await test('2. generateTextStonesLive() computes its auto-fit scale via the shared computeAutoFitScale() helper, not inline maxWidth arithmetic, and records floorApplied', () => {
  const methodMatch = appJs.match(/generateTextStonesLive\(layer,project\)\{[\s\S]*?const bb=result\.getBoundingBox\(\);/);
  assert.ok(methodMatch, 'expected to find generateTextStonesLive() in app.js');
  assert.ok(methodMatch[0].includes('const{scale,floorApplied}=computeAutoFitScale(layer,project,result.widthMm);'));
  assert.ok(methodMatch[0].includes('autoFitFloorAppliedByLayerId.set(layer.id,floorApplied);'));
  assert.ok(!/const maxWidth=project\.canvas\.width-10/.test(methodMatch[0]), 'expected the old inline maxWidth computation to be gone from generateTextStonesLive()');
});

await test('3. resolveLayerShapeSource()\'s text branch computes its auto-fit scale via the same shared helper', () => {
  const branchMatch = appJs.match(/if\(layer\.type==='text'\)\{[\s\S]*?\n {2}\}\n {2}if\(layer\.type==='image'\)/);
  assert.ok(branchMatch, "expected to find resolveLayerShapeSource()'s text branch in app.js");
  assert.ok(branchMatch[0].includes('const{scale}=computeAutoFitScale(layer,project,resolved.boundingBox.widthMm);'));
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

await test('6. GeometryEngine.generate() clears autoFitFloorAppliedByLayerId at the start of every generation, so a deleted/renamed layer can never leave a stale entry', () => {
  assert.match(appJs, /async generate\(project\)\{autoFitFloorAppliedByLayerId\.clear\(\);/);
});

await test('7. autoFitFloorAppliedByLayerId is transient, in-memory state -- never read by save/load, validateProject(), or any exporter', () => {
  assert.equal((appJs.match(/autoFitFloorAppliedByLayerId/g) || []).length >= 3, true, 'expected the map to be declared and used');
  for (const forbiddenContext of ['validateProject', 'JSON.stringify', 'exportSVG', 'exportCanvas']) {
    const fnMatch = appJs.match(new RegExp(`function ${forbiddenContext}\\([^)]*\\)\\{[\\s\\S]*?\\n\\}`));
    if (fnMatch) assert.ok(!fnMatch[0].includes('autoFitFloorAppliedByLayerId'), `${forbiddenContext}() must not reference autoFitFloorAppliedByLayerId`);
  }
});

// ---------------------------------------------------------------------------------------------
// Behavioral checks -- computeAutoFitScale()
// ---------------------------------------------------------------------------------------------

const project = { canvas: { width: 210, height: 90 } };

await test('8. autoFit off never rescales, regardless of measured width, and floorApplied is false', () => {
  const layer = { autoFit: false, height: 25, stoneSize: 2, gap: 0.3 };
  const { scale, floorApplied } = computeAutoFitScale(layer, project, 1000);
  assert.equal(scale, 1);
  assert.equal(floorApplied, false);
});

await test('9. text that already fits (widthMm <= maxWidth) is never rescaled -- short/medium text is untouched', () => {
  const layer = { autoFit: true, height: 25, stoneSize: 2, gap: 0.3 };
  assert.deepEqual(computeAutoFitScale(layer, project, 150), { scale: 1, floorApplied: false }); // maxWidth = 210-10 = 200
  assert.deepEqual(computeAutoFitScale(layer, project, 200), { scale: 1, floorApplied: false }); // exactly at the boundary
});

await test('10. mild overflow (fit-to-width scale stays above the legibility floor) rescales exactly as before, floorApplied false', () => {
  const layer = { autoFit: true, height: 25, stoneSize: 2, gap: 0.3 };
  // spacingMm = 2.3, floor = 2.3*6/25 = 0.552; a measured width of 250mm needs fitScale = 200/250 = 0.8,
  // comfortably above the floor, so the pre-existing fit-to-width behavior must be unchanged.
  const { scale, floorApplied } = computeAutoFitScale(layer, project, 250);
  assert.ok(Math.abs(scale - 0.8) < 1e-9, `expected the unchanged fit-to-width scale 0.8, got ${scale}`);
  assert.equal(floorApplied, false);
});

await test('11. severe overflow (fit-to-width would crush text past the legibility floor) clamps to the floor and reports floorApplied:true', () => {
  const layer = { autoFit: true, height: 25, stoneSize: 2, gap: 0.3 };
  // Reproduces the reported bug's magnitude: a 67-character phrase measured ~786mm wide at height 25.
  const measuredWidthMm = 786.3;
  const fitScale = (project.canvas.width - 10) / measuredWidthMm; // ~0.254 -- the old, unreadable scale
  const { scale, floorApplied } = computeAutoFitScale(layer, project, measuredWidthMm);
  assert.ok(scale > fitScale, 'expected the floor to win over the old, more-aggressive fit-to-width shrink');
  assert.equal(floorApplied, true);
  const spacingMm = layer.stoneSize + layer.gap;
  const resultingHeightMm = layer.height * scale;
  assert.ok(resultingHeightMm / spacingMm >= 6 - 1e-9, 'expected the resulting height/spacing ratio to sit at the 6x legibility floor');
});

await test('12. the floor never scales height up past the original nominal height', () => {
  const layer = { autoFit: true, height: 5, stoneSize: 2, gap: 0.3 };
  // A tiny nominal height (already below the floor's own target) plus enormous measured width must
  // still never make computeAutoFitScale() return more than 1 -- auto-fit only ever shrinks.
  const { scale } = computeAutoFitScale(layer, project, 5000);
  assert.ok(scale <= 1, `expected scale to never exceed 1, got ${scale}`);
});

// ---------------------------------------------------------------------------------------------
// Behavioral checks -- isTextTooLongForObject() / recommendedWrapModeForFit() / message copy
// ---------------------------------------------------------------------------------------------

await test('13. isTextTooLongForObject() is true only when this exact layer id\'s last generation had floorApplied:true', () => {
  const { isTextTooLongForObject } = buildTooLongHelpers(new Map([['a', true], ['b', false]]));
  assert.equal(isTextTooLongForObject({ id: 'a', type: 'text' }), true);
  assert.equal(isTextTooLongForObject({ id: 'b', type: 'text' }), false);
  assert.equal(isTextTooLongForObject({ id: 'never-generated', type: 'text' }), false);
});

await test('14. isTextTooLongForObject() ignores non-text layers and null/undefined', () => {
  const { isTextTooLongForObject } = buildTooLongHelpers(new Map([['a', true]]));
  assert.equal(isTextTooLongForObject({ id: 'a', type: 'circle' }), false);
  assert.equal(isTextTooLongForObject(null), false);
  assert.equal(isTextTooLongForObject(undefined), false);
});

await test('15. recommendedWrapModeForFit() returns null whenever isTextTooLongForObject() is false', () => {
  const { recommendedWrapModeForFit } = buildTooLongHelpers(new Map([['a', false]]));
  assert.equal(recommendedWrapModeForFit({ id: 'a', type: 'text' }), null);
});

await test('16. recommendedWrapModeForFit() never recommends a wrap-mode change today (fit is wrap-independent — audited in the spec) -- and never auto-applies one (project.wrap is never assigned by either function)', () => {
  const { recommendedWrapModeForFit } = buildTooLongHelpers(new Map([['a', true]]));
  assert.equal(recommendedWrapModeForFit({ id: 'a', type: 'text' }), null);
  assert.ok(!recommendedWrapModeSrc.includes('project.wrap='), 'recommendedWrapModeForFit() must never assign project.wrap');
  assert.ok(!isTextTooLongSrc.includes('project.wrap='), 'isTextTooLongForObject() must never assign project.wrap');
});

await test('17. textTooLongActionMessage() always lists the three always-available remedies', () => {
  const { textTooLongActionMessage } = buildTooLongHelpers(new Map([['a', true]]));
  const message = textTooLongActionMessage({ id: 'a', type: 'text' });
  assert.match(message, /shorten/i);
  assert.match(message, /stone size/i);
  assert.match(message, /wider object/i);
});

// ---------------------------------------------------------------------------------------------
// Structural checks -- warning priority + markup
// ---------------------------------------------------------------------------------------------

await test('18. updateTextOutsidePrintableWarning() shows the too-long warning and suppresses the positional one whenever isTextTooLongForObject() is true -- mutually exclusive, never both', () => {
  const fnMatch = appJs.match(/function updateTextOutsidePrintableWarning\(\)\{[\s\S]*?\n\}/);
  assert.ok(fnMatch, 'expected to find updateTextOutsidePrintableWarning() in app.js');
  const fn = fnMatch[0];
  assert.match(fn, /const tooLong=isTextTooLongForObject\(l\);/);
  assert.match(fn, /const outside=!tooLong&&isTextOutsidePrintableArea\(l\);/);
  assert.match(fn, /el\('textTooLongWarning'\)\.classList\.toggle\('visible',tooLong\);/);
  assert.match(fn, /el\('workspaceTextTooLongWarning'\)\.classList\.toggle\('visible',tooLong\);/);
});

await test('19. the persistent (non-Lightbox) Inspector panel has its own "too long to fit" warning with the exact required wording, and no misleading Center Text button inside it', () => {
  const blockMatch = indexHtml.match(/<div class="validation-message" id="workspaceTextTooLongWarning"[\s\S]*?<\/div>/);
  assert.ok(blockMatch, 'expected #workspaceTextTooLongWarning in index.html');
  assert.match(blockMatch[0], /This text is too long to fit legibly on this object\./);
  assert.ok(!blockMatch[0].includes('workspaceCenterTextBtn'), 'the too-long warning must not offer Center Text -- centering never fixes a structural too-long failure');
});

await test('20. the Text Lightbox has the same "too long to fit" warning, with the exact required wording, reusing the existing .validation-message styling (no new CSS)', () => {
  assert.match(indexHtml, /<p class="validation-message" id="textTooLongWarning" role="status">This text is too long to fit legibly on this object\.<\/p>/);
  assert.match(indexHtml, /<p class="hint" id="textTooLongWarningDetail"><\/p>/);
});

await test('21. #workspaceTextTooLongWarning appears in the always-visible right Inspector panel (never covered by a modal), matching the S-104 workspace-warning placement pattern', () => {
  const inspectorMatch = indexHtml.match(/<aside class="right-inspector" id="rightInspector"[\s\S]*?<\/aside>/);
  assert.ok(inspectorMatch, 'expected to find #rightInspector in index.html');
  assert.ok(inspectorMatch[0].includes('id="workspaceTextTooLongWarning"'));
});

console.log('S-107 long text readability tests passed.');
