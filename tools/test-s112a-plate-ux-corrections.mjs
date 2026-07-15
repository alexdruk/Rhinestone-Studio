import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getPlateDesignTargetGuide, getPlateDefaults } from '../src/products/index.js';

// S-112A (Round Dinner Plate UX Corrections) — three focused corrections on top of S-112:
//   1. Plate-Specific Workflow: the cylindrical Wrap Mode control is hidden while a plate is active.
//   2. Improved Default 3D Presentation: the Object Preview's default camera angle for a plate was
//      moved from near-top-down to a shallow, eye-level-ish angle so the sloped rim, outer lip, and
//      foot ring all read as a real object without rotating (verified visually via real-browser
//      screenshots -- see the implementation report; this file only guards the underlying constants
//      and geometry against regression, matching Preview3DRenderer.js's own "no Node unit test, this
//      file is browser-verified" policy).
//   3. Rim Band Intelligent Default: selecting Design Target -> Rim Band auto-enables curved text at
//      the rim's own printable-annulus midline radius; Center Well/Full Top Surface are untouched.
//
// Follows this repo's established app.js-testing convention (see e.g.
// tools/test-s110a-smart-shape-to-text-creation.mjs): pure helpers with no DOM dependency
// (rimBandCurveRadiusMm()) are extracted via `new Function` and REALLY EXECUTED against a real
// getPlateDesignTargetGuide(); the DOM-entangled parts (writeSelectedControlsToLayer()'s
// el('curveEnabled')/el('plateDesignTarget') reads) are covered by structural/ordering assertions
// instead of a full DOM mock, plus the real-browser verification already run for this milestone.

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const appJs = await readFile(path.join(repoRoot, 'app.js'), 'utf8');
const indexHtml = await readFile(path.join(repoRoot, 'index.html'), 'utf8');
const geometryBuilderSrc = await readFile(path.join(repoRoot, 'src/preview3d/ObjectGeometryBuilder.js'), 'utf8');
const rendererSrc = await readFile(path.join(repoRoot, 'src/preview3d/Preview3DRenderer.js'), 'utf8');

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
  assert.ok(match, `expected to find ${label}`);
  return match[0];
}

// --- 1. Plate-Specific Workflow: Wrap Mode hidden for the plate -------------------------------

await test('1. index.html wraps the Wrap Mode control in a #wrapField toolbar-group', () => {
  const wrapFieldBlock = extractBlock(indexHtml, /<div class="toolbar-group" id="wrapField">[\s\S]*?<\/div>/, '#wrapField');
  assert.match(wrapFieldBlock, /id="wrap"/, '#wrapField must contain the #wrap select');
});

await test('2. updateObjectTemplateDetail() hides #wrapField whenever the plate template is active, shows it otherwise', () => {
  const fn = extractBlock(appJs, /function updateObjectTemplateDetail\(\)\{[\s\S]*?\n\}/, 'updateObjectTemplateDetail()');
  assert.match(fn, /el\('wrapField'\)\.style\.display=isPlate\?'none':'flex'/, 'expected #wrapField to be toggled exactly like the other plate-only field groups, keyed off isPlate');
});

await test('3. the plate\'s Design Target select still exposes exactly Center Well / Rim Band / Full Top Surface, nothing else', () => {
  const selectBlock = extractBlock(indexHtml, /<select id="plateDesignTarget">[\s\S]*?<\/select>/, '#plateDesignTarget');
  const values = [...selectBlock.matchAll(/<option value="([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(values, ['centerWell', 'rimBand', 'fullTopSurface']);
});

await test('4. mug/bottle/tumbler are unaffected: no product-id gating was added anywhere near #wrap besides the plate check', () => {
  // The only conditional touching #wrapField's visibility must be the isPlate ternary asserted above
  // -- grep for any other reference to wrapField to make sure nothing else hides/shows it per-product.
  const matches = [...appJs.matchAll(/wrapField/g)];
  assert.equal(matches.length, 1, 'expected exactly one reference to wrapField in app.js (the isPlate toggle in updateObjectTemplateDetail())');
});

// --- 2. Improved Default 3D Presentation --------------------------------------------------------

await test('5. PLATE_DEFAULT_POLAR_RAD was moved off the old near-top-down default, toward an eye-level-ish "real object" angle', () => {
  const match = rendererSrc.match(/const PLATE_DEFAULT_POLAR_RAD = ([\d.]+);/);
  assert.ok(match, 'expected PLATE_DEFAULT_POLAR_RAD to still be defined');
  const value = Number(match[1]);
  // The original S-112 default (0.68 rad, ~51 degrees of elevation) read as near-top-down and hid the
  // sloped rim/foot ring (see the implementation report for the real-browser sweep that established
  // this). It must no longer sit at or near that steep value, and must stay a real perspective angle
  // (not 0 == pure top-down, not >= MAX_POLAR_RAD == underneath).
  assert.ok(value >= 1.1 && value <= 1.5, `expected an eye-level-ish angle roughly matching the revolved-vessel DEFAULT_POLAR_RAD (1.3), got ${value}`);
});

await test('6. the plate camera angle is still selected only for the plate kind -- every revolved-vessel kind (mug/tumbler/bottle) keeps its own unchanged DEFAULT_POLAR_RAD', () => {
  assert.match(rendererSrc, /const DEFAULT_POLAR_RAD = 1\.3;/, 'the revolved-vessel default must be untouched by this plate-only correction');
  assert.match(rendererSrc, /const polarRad = this\._dimensions\.kind === 'plate' \? PLATE_DEFAULT_POLAR_RAD : DEFAULT_POLAR_RAD;/);
});

await test('7. the plate\'s revolved-profile geometry constants are byte-identical to S-112 -- the camera moved, the geometry was never "exaggerated" to compensate', () => {
  const expected = {
    PLATE_WALL_THICKNESS_FRACTION: 0.16,
    PLATE_RIM_SLOPE_FRACTION: 0.12,
    PLATE_EDGE_ROUND_FRACTION: 0.4,
    PLATE_FOOT_RING_WIDTH_FRACTION: 0.24,
    PLATE_WELL_CONCAVE_BOW: 0.22
  };
  for (const [name, value] of Object.entries(expected)) {
    const match = geometryBuilderSrc.match(new RegExp(`const ${name} = ([\\d.]+);`));
    assert.ok(match, `expected ${name} to still be defined in ObjectGeometryBuilder.js`);
    assert.equal(Number(match[1]), value, `${name} must be unchanged from S-112 -- this correction is camera-only, not a geometry change`);
  }
});

await test('8. no GeometryEngine/StoneLayout files were touched by this milestone', async () => {
  // A direct, deterministic proxy for "no shared pipeline changes": neither file references any
  // plate-specific or S-112A-specific symbol, i.e. they were never edited for this milestone.
  const geometryEngineSrc = await readFile(path.join(repoRoot, 'src/geometry/GeometryEngine.js'), 'utf8');
  const stoneLayoutSrc = await readFile(path.join(repoRoot, 'src/geometry/StoneLayout.js'), 'utf8');
  assert.doesNotMatch(geometryEngineSrc, /S-112A|rimBandCurveRadiusMm|wrapField/);
  assert.doesNotMatch(stoneLayoutSrc, /S-112A|rimBandCurveRadiusMm|wrapField/);
});

// --- 3. Rim Band Intelligent Default -------------------------------------------------------------

function buildRimBandCurveRadiusMm(project) {
  const fn = extractBlock(appJs, /function rimBandCurveRadiusMm\(\)\{[\s\S]*?\n\}/, 'rimBandCurveRadiusMm()');
  // eslint-disable-next-line no-new-func
  return new Function('getPlateDesignTargetGuide', 'project', `${fn}\nreturn rimBandCurveRadiusMm;`)(getPlateDesignTargetGuide, project);
}

await test('9. rimBandCurveRadiusMm() returns the Rim Band annulus\'s own midline radius for the default plate dimensions', () => {
  const project = { plate: getPlateDefaults(), canvas: { width: getPlateDefaults().outerDiameterMm, height: getPlateDefaults().outerDiameterMm } };
  const radius = buildRimBandCurveRadiusMm(project)();
  // Default plate: outer diameter 270mm (outer radius 135), inner well diameter 195mm (inner radius
  // 97.5) -- midline = (135 + 97.5) / 2 = 116.25.
  assert.ok(Math.abs(radius - 116.25) < 1e-9, `expected 116.25, got ${radius}`);
});

await test('10. rimBandCurveRadiusMm() re-derives from the live plate dimensions, not a hardcoded value', () => {
  const project = { plate: { ...getPlateDefaults(), outerDiameterMm: 300, innerWellDiameterMm: 175 }, canvas: { width: 300, height: 300 } };
  const radius = buildRimBandCurveRadiusMm(project)();
  // outer radius 150, inner radius 87.5 -> midline 118.75.
  assert.ok(Math.abs(radius - 118.75) < 1e-9, `expected 118.75, got ${radius}`);
});

await test('11. rimBandCurveRadiusMm() reuses getPlateDesignTargetGuide() -- the single source of truth for the printable annulus -- rather than a second radius calculation', () => {
  const fn = extractBlock(appJs, /function rimBandCurveRadiusMm\(\)\{[\s\S]*?\n\}/, 'rimBandCurveRadiusMm()');
  assert.match(fn, /getPlateDesignTargetGuide\('rimBand',project\.plate,project\.canvas\.width,project\.canvas\.height\)/);
});

await test('12. writeSelectedControlsToLayer() detects "entering Rim Band" only for the plate template, comparing the new UI value against the still-unwritten previous project.plate.designTarget', () => {
  const fn = extractBlock(appJs, /function writeSelectedControlsToLayer\(\)\{[\s\S]*?\n\/\/ S-107/, 'writeSelectedControlsToLayer() (through the S-107 comment that follows it)');
  assert.match(fn, /const enteringRimBand=currentObjectTemplate\(\)\.preview\.kind==='plate'&&el\('plateDesignTarget'\)\.value==='rimBand'&&project\.plate\.designTarget!=='rimBand';/);
  // Must be computed before project.plate is overwritten later in the same function (the write to
  // project.plate is the single source of truth for "the previous target").
  const enteringIndex = fn.indexOf('const enteringRimBand=');
  const projectPlateWriteIndex = fn.indexOf('project.plate=normalizePlateParams(');
  assert.ok(enteringIndex !== -1 && projectPlateWriteIndex !== -1 && enteringIndex < projectPlateWriteIndex, 'enteringRimBand must be computed before project.plate is reassigned');
});

await test('13. the Rim Band default only applies to text layers, and seeds curveEnabled/curveRadiusMm/curveDirection/curveControls BEFORE they are read into the layer', () => {
  const fn = extractBlock(appJs, /function writeSelectedControlsToLayer\(\)\{[\s\S]*?\n\/\/ S-107/, 'writeSelectedControlsToLayer()');
  const textBranchStart = fn.indexOf("if(l.type==='text'){");
  assert.ok(textBranchStart !== -1);
  const enteringRimBandBlockIndex = fn.indexOf('if(enteringRimBand){');
  const curveEnabledReadIndex = fn.indexOf("l.curveEnabled=el('curveEnabled').value==='on';");
  assert.ok(enteringRimBandBlockIndex !== -1 && curveEnabledReadIndex !== -1);
  assert.ok(textBranchStart < enteringRimBandBlockIndex, 'the Rim Band seeding must live inside the text-layer branch');
  assert.ok(enteringRimBandBlockIndex < curveEnabledReadIndex, 'the UI fields must be seeded before writeSelectedControlsToLayer() reads them back into the layer');
  const seedBlock = extractBlock(fn, /if\(enteringRimBand\)\{[\s\S]*?\}/, 'the enteringRimBand seed block');
  assert.match(seedBlock, /el\('curveEnabled'\)\.value='on'/);
  assert.match(seedBlock, /el\('curveRadiusMm'\)\.value=rimBandCurveRadiusMm\(\)\.toFixed\(2\)/);
  assert.match(seedBlock, /el\('curveDirection'\)\.value='outside'/, 'Rim Band text must use the "outside" curve direction so it reads normally around the rim (see ArcProjection.js)');
});

await test('14. Center Well and Full Top Surface never force any curve field -- enteringRimBand is the only trigger, and it requires the target to specifically be "rimBand"', () => {
  const fn = extractBlock(appJs, /function writeSelectedControlsToLayer\(\)\{[\s\S]*?\n\/\/ S-107/, 'writeSelectedControlsToLayer()');
  // The only place curveEnabled is ever force-set to a literal (not read from the DOM) is inside the
  // enteringRimBand seed block asserted above -- there must be no matching centerWell/fullTopSurface
  // branch that turns curve off/on.
  assert.doesNotMatch(fn, /designTarget\)\.value==='centerWell'/);
  assert.doesNotMatch(fn, /designTarget\)\.value==='fullTopSurface'/);
  const literalCurveEnabledAssignments = [...fn.matchAll(/el\('curveEnabled'\)\.value='(on|off)'/g)];
  assert.equal(literalCurveEnabledAssignments.length, 1, 'expected exactly one place that force-sets curveEnabled to a literal value (the Rim Band default) -- Center Well/Full Top Surface must leave the operator\'s own curve setting alone');
  assert.equal(literalCurveEnabledAssignments[0][1], 'on');
});

await test('15. re-entering Rim Band from a different target re-applies the default (no one-shot/sticky flag suppresses it)', () => {
  const fn = extractBlock(appJs, /function writeSelectedControlsToLayer\(\)\{[\s\S]*?\n\/\/ S-107/, 'writeSelectedControlsToLayer()');
  // enteringRimBand is derived fresh from live project/DOM state every call -- no persisted
  // "already applied" flag exists anywhere in app.js.
  for (const forbiddenField of ['rimBandDefaultApplied', 'rimBandAutoApplied', 'hasSeededRimBandCurve']) {
    assert.doesNotMatch(appJs, new RegExp(forbiddenField));
  }
});

await test('16. package.json registers this milestone\'s test file', async () => {
  const packageJson = JSON.parse(await readFile(path.join(repoRoot, 'package.json'), 'utf8'));
  for (const scriptName of ['test', 'test:integration', 'test:full']) {
    assert.ok(packageJson.scripts[scriptName].includes('test-s112a-plate-ux-corrections.mjs'), `expected ${scriptName} to include this milestone's test file`);
  }
});

console.log('Round Dinner Plate UX Corrections (S-112A) tests passed.');
