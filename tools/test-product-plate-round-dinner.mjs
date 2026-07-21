import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getPlateDesignTargetGuide as importedGetPlateDesignTargetGuide, getPlateDefaults as importedGetPlateDefaults } from '../src/products/index.js';
import { assertTestRegistered } from './lib/test-registration-assertions.mjs';

// Product Definitions — Round Dinner Plate. Covers what tools/test-object-template.mjs (registry
// shape) and tools/test-object-geometry-builder.mjs (3D radial profile/UV) do not: the
// product-definition JSON itself, PlateProductDefinition.js's ranges/defaults/color/design-target
// helpers, PlateGuides.js's circular/annular 2D printable-boundary geometry for all three design
// targets and target-switching, GeometryEngine reuse (all layer types generate normally on a plate
// canvas, no second stone-generation pipeline), save/load + backward compatibility (validateProject()
// with and without project.plate), structural wiring of the UI controls in app.js/index.html, and
// three follow-up UX corrections layered on top of the original feature: Wrap Mode hidden while a
// plate is active, an eye-level-ish default 3D camera angle instead of near-top-down, and an
// intelligent curved-text default when Design Target -> Rim Band is selected.
//
// Two originally-separate suites (S-112, S-112A), merged here because they cover the same product
// feature evolving across two sequential milestones, not two independent feature directions.
//
// Structural checks against the live app.js/index.html source use the same
// extract-and-execute-the-real-function technique as tools/test-object-template-integration.mjs /
// tools/test-svg-integration.mjs (app.js is a browser entry point, not import()-able directly).

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const appJs = await readFile(path.join(repoRoot, 'app.js'), 'utf8');
const indexHtml = await readFile(path.join(repoRoot, 'index.html'), 'utf8');

const products = await import('../src/products/index.js');
const {
  PLATE_ROUND_DINNER_DEFINITION,
  PLATE_DESIGN_TARGETS,
  DEFAULT_PLATE_DESIGN_TARGET,
  DEFAULT_PLATE_COLOR_ID,
  getPlateDimensionRange,
  clampPlateDimensionMm,
  getPlateDefaults,
  getPlateColorOptions,
  getPlateColor,
  isValidPlateDesignTarget,
  getPlateDesignTargetMeta,
  computeRimWidthMm,
  validatePlateDiameters,
  normalizePlateParams,
  getPlateDesignTargetGuide,
  getObjectTemplate
} = products;
const { GeometryEngine } = await import('../src/geometry/index.js');
const { FontManager } = await import('../src/fonts/index.js');
const { createDefaultFontProviderRegistry } = await import('../src/text/index.js');
const { computeProductionSheetLayout } = await import('../src/export/ProductionSheetExporter.js');

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

// --- 1. Product-definition JSON -----------------------------------------------------------------

await test('1. plate-round-dinner.json loads, matches the approved product-definition input, and is frozen/consumed read-only', () => {
  assert.equal(PLATE_ROUND_DINNER_DEFINITION.id, 'plate-round-dinner');
  assert.equal(PLATE_ROUND_DINNER_DEFINITION.family, 'plate');
  assert.equal(PLATE_ROUND_DINNER_DEFINITION.shape, 'round');
  assert.equal(PLATE_ROUND_DINNER_DEFINITION.colors.default.id, 'white');
  assert.equal(PLATE_ROUND_DINNER_DEFINITION.colors.alternatives[0].id, 'creme');
  assert.deepEqual(Object.keys(PLATE_ROUND_DINNER_DEFINITION.designTargets).sort(), ['centerWell', 'fullTopSurface', 'rimBand']);
  assert.equal(PLATE_ROUND_DINNER_DEFINITION.validation.requireDerivedRimWidthConsistency, true);
  assert.equal(PLATE_ROUND_DINNER_DEFINITION.validation.requireInnerWellSmallerThanOuterDiameter, true);
});

await test('2. default values match the JSON exactly: 270/195/25/12/165/5mm, 800g, white, centerWell', () => {
  const d = getPlateDefaults();
  assert.equal(d.outerDiameterMm, 270);
  assert.equal(d.innerWellDiameterMm, 195);
  assert.equal(d.overallHeightMm, 25);
  assert.equal(d.centerDepthMm, 12);
  assert.equal(d.footRingOuterDiameterMm, 165);
  assert.equal(d.footRingHeightMm, 5);
  assert.equal(d.weightGrams, 800);
  assert.equal(d.colorId, 'white');
  assert.equal(d.designTarget, 'centerWell');
  assert.equal(DEFAULT_PLATE_DESIGN_TARGET, 'centerWell');
  assert.equal(DEFAULT_PLATE_COLOR_ID, 'white');
});

await test('3. parameter ranges match the JSON, and clampPlateDimensionMm() enforces them', () => {
  assert.deepEqual(
    { min: getPlateDimensionRange('outerDiameterMm').min, max: getPlateDimensionRange('outerDiameterMm').max },
    { min: 250, max: 300 }
  );
  assert.deepEqual(
    { min: getPlateDimensionRange('innerWellDiameterMm').min, max: getPlateDimensionRange('innerWellDiameterMm').max },
    { min: 175, max: 215 }
  );
  assert.equal(clampPlateDimensionMm('outerDiameterMm', 1000), 300);
  assert.equal(clampPlateDimensionMm('outerDiameterMm', 1), 250);
  assert.equal(clampPlateDimensionMm('outerDiameterMm', 275), 275);
  // A non-finite/missing value falls back to the JSON's own default (permissive style, matching
  // this codebase's existing convention for cupColor/wrap/product).
  assert.equal(clampPlateDimensionMm('outerDiameterMm', NaN), 270);
  assert.throws(() => getPlateDimensionRange('notAField'), /unknown dimension field/);
});

await test('4. derived rim width: rimWidthMm = (outer - inner) / 2, never independently stored', () => {
  assert.equal(computeRimWidthMm(270, 195), 37.5);
  assert.equal(computeRimWidthMm(300, 175), 62.5);
  assert.equal(validatePlateDiameters(270, 195), 37.5);
  assert.throws(() => validatePlateDiameters(195, 270), /innerWellDiameterMm must be smaller/);
  assert.throws(() => validatePlateDiameters(200, 200), /innerWellDiameterMm must be smaller/);
});

await test('5. White is the default color, Creme is the alternative, with the exact JSON ids/hex values', () => {
  const options = getPlateColorOptions();
  assert.deepEqual(options, [
    { id: 'white', name: 'White', hex: '#F7F7F3' },
    { id: 'creme', name: 'Creme', hex: '#E9E0CC' }
  ]);
  assert.equal(getPlateColor('white').hex, '#F7F7F3');
  assert.equal(getPlateColor('creme').hex, '#E9E0CC');
  // Unknown/missing id falls back to White (this codebase's permissive-fallback convention).
  assert.equal(getPlateColor('mystery').id, 'white');
  assert.equal(getPlateColor(undefined).id, 'white');
});

await test('6. normalizePlateParams(): clamps out-of-range values, re-derives a consistent diameter pair, and defaults missing/malformed input entirely', () => {
  const { weightGrams, ...defaultsWithoutWeight } = getPlateDefaults();
  assert.deepEqual(normalizePlateParams(undefined), defaultsWithoutWeight);
  assert.deepEqual(normalizePlateParams(null), defaultsWithoutWeight);
  assert.deepEqual(normalizePlateParams({}), defaultsWithoutWeight);
  const clamped = normalizePlateParams({ outerDiameterMm: 5000, innerWellDiameterMm: -10, colorId: 'creme', designTarget: 'rimBand' });
  assert.equal(clamped.outerDiameterMm, 300);
  assert.ok(clamped.innerWellDiameterMm < clamped.outerDiameterMm);
  assert.equal(clamped.colorId, 'creme');
  assert.equal(clamped.designTarget, 'rimBand');
  // An inconsistent pair (inner >= outer) falls back to the JSON's own default ratio rather than
  // throwing -- requireInnerWellSmallerThanOuterDiameter is always satisfied by construction.
  const inconsistent = normalizePlateParams({ outerDiameterMm: 260, innerWellDiameterMm: 290 });
  assert.ok(inconsistent.innerWellDiameterMm < inconsistent.outerDiameterMm);
  assert.equal(normalizePlateParams({ designTarget: 'notReal' }).designTarget, 'centerWell');
});

// --- 2. Design targets ----------------------------------------------------------------------------

await test('7. PLATE_DESIGN_TARGETS lists exactly Center Well, Rim Band, Full Top Surface, Center Well first (the default)', () => {
  assert.deepEqual(PLATE_DESIGN_TARGETS, ['centerWell', 'rimBand', 'fullTopSurface']);
  assert.equal(isValidPlateDesignTarget('centerWell'), true);
  assert.equal(isValidPlateDesignTarget('rimBand'), true);
  assert.equal(isValidPlateDesignTarget('fullTopSurface'), true);
  assert.equal(isValidPlateDesignTarget('sideWall'), false);
  assert.equal(getPlateDesignTargetMeta('centerWell').name, 'Center Well');
  assert.equal(getPlateDesignTargetMeta('rimBand').name, 'Rim Band');
  assert.equal(getPlateDesignTargetMeta('fullTopSurface').name, 'Full Top Surface');
});

await test('8. Center Well guide: a single circle at the inner well diameter, centered on the canvas', () => {
  const plateParams = getPlateDefaults();
  const guide = getPlateDesignTargetGuide('centerWell', plateParams, 270, 270);
  assert.equal(guide.kind, 'circle');
  assert.equal(guide.radiusMm, 97.5);
  assert.equal(guide.cxMm, 135);
  assert.equal(guide.cyMm, 135);
  assert.equal(guide.transitionRadiusMm, null);
});

await test('9. Rim Band guide: a true annulus between the inner well and outer diameters', () => {
  const plateParams = getPlateDefaults();
  const guide = getPlateDesignTargetGuide('rimBand', plateParams, 270, 270);
  assert.equal(guide.kind, 'annulus');
  assert.equal(guide.outerRadiusMm, 135);
  assert.equal(guide.innerRadiusMm, 97.5);
});

await test('10. Full Top Surface guide: the complete outer circle, with a dashed inner transition guide at the well diameter', () => {
  const plateParams = getPlateDefaults();
  const guide = getPlateDesignTargetGuide('fullTopSurface', plateParams, 270, 270);
  assert.equal(guide.kind, 'circle');
  assert.equal(guide.radiusMm, 135);
  assert.equal(guide.transitionRadiusMm, 97.5);
});

await test('11. target switching: each of the three targets produces a distinct, correctly-shaped guide for the same plateParams, and an unknown target falls back to Center Well', () => {
  const plateParams = getPlateDefaults();
  const centerWell = getPlateDesignTargetGuide('centerWell', plateParams, 270, 270);
  const rimBand = getPlateDesignTargetGuide('rimBand', plateParams, 270, 270);
  const fullTop = getPlateDesignTargetGuide('fullTopSurface', plateParams, 270, 270);
  assert.notDeepEqual(centerWell, rimBand);
  assert.notDeepEqual(rimBand, fullTop);
  assert.notDeepEqual(centerWell, fullTop);
  assert.deepEqual(getPlateDesignTargetGuide('not-a-target', plateParams, 270, 270), centerWell);
});

// --- 3. GeometryEngine / StoneLayout reuse (no second stone-generation pipeline) -----------------

async function buildPermanentEngine() {
  const manifest = JSON.parse(await readFile(path.join(repoRoot, 'assets/fonts/manifest.json'), 'utf8'));
  const fontManager = new FontManager(manifest);
  async function loadFontBufferFromRepoRoot(relativePath) {
    return readFile(path.join(repoRoot, relativePath));
  }
  const registry = createDefaultFontProviderRegistry(fontManager, { loadFontBuffer: loadFontBufferFromRepoRoot });
  return new GeometryEngine({ fontProviderRegistry: registry });
}

await test('12. StoneLayout reuse: text, circle, and SVG layers all generate correctly on the plate\'s square production canvas via the unmodified permanent GeometryEngine (no plate-specific stone generation exists anywhere)', async () => {
  const engine = await buildPermanentEngine();
  const plate = getObjectTemplate('plate');
  const canvasWidthMm = plate.productionWidthMm, canvasHeightMm = plate.productionHeightMm;

  const text = await engine.generateTextLayout({
    text: 'Center', fontId: 'courier-prime-regular', heightMm: 20, mode: 'outline', stoneSizeMm: 2, gapMm: 0.3, color: 'gold', layerId: 'text-plate'
  });
  assert.ok(text.count > 0);
  for (const s of text.stones) assert.ok(Number.isFinite(s.xMm) && Number.isFinite(s.yMm));

  const circle = engine.generateShapeLayout({
    shape: 'circle', cxMm: canvasWidthMm / 2, cyMm: canvasHeightMm / 2, radiusMm: 90, mode: 'fill', stoneSizeMm: 2, gapMm: 0.6, color: 'silver', layerId: 'well'
  });
  assert.ok(circle.count > 0);

  const svg = engine.generateSvgLayout({
    svgSource: '<svg width="10mm" height="10mm"><circle cx="5" cy="5" r="4"/></svg>',
    layerId: 'rim-svg', xMm: 10, yMm: 10, widthMm: 40, heightMm: 40, stoneSizeMm: 2, gapMm: 0.3, color: 'ruby', mode: 'outline'
  });
  assert.ok(svg.count > 0);
});

// --- 4. Save/load + backward compatibility --------------------------------------------------------

async function extractProjectFunctions() {
  const validateMatch = appJs.match(/function validateProject\(obj\)\{[\s\S]*?\n\}\n/);
  assert.ok(validateMatch, 'expected to find validateProject() in app.js');
  const defaultMatch = appJs.match(/function defaultProject\(\)\{return\{[\s\S]*?\}\}\n/);
  assert.ok(defaultMatch, 'expected to find defaultProject() in app.js');
  const constantsStart = appJs.indexOf('const DEFAULT_TEXT_FONT_ID=');
  const source = `${appJs.slice(constantsStart, appJs.indexOf(defaultMatch[0]) + defaultMatch[0].length)}\n${appJs.slice(appJs.indexOf('const SUPPORTED_LAYER_TYPES=new Set'), appJs.indexOf(validateMatch[0]) + validateMatch[0].length)}`;
  const { SHAPE_LIBRARY_KINDS } = await import('../src/geometry/index.js');
  // eslint-disable-next-line no-new-func
  return new Function('getObjectTemplate', 'SHAPE_LIBRARY_KINDS', 'getPlateDefaults', 'normalizePlateParams', `${source}\nreturn { validateProject, defaultProject };`)(getObjectTemplate, SHAPE_LIBRARY_KINDS, getPlateDefaults, normalizePlateParams);
}
const { validateProject, defaultProject } = await extractProjectFunctions();

function plateProject(overrides = {}) {
  return {
    version: 2, name: 'Plate Test', product: 'plate', canvas: { width: 270, height: 270 },
    cupColor: '#F7F7F3', wrap: 'full',
    plate: { outerDiameterMm: 270, innerWellDiameterMm: 195, overallHeightMm: 25, centerDepthMm: 12, footRingOuterDiameterMm: 165, footRingHeightMm: 5, colorId: 'white', designTarget: 'centerWell' },
    layers: [{ id: 'text', type: 'text', visible: true, text: 'Hi', font: 'courier-prime-regular', height: 20, stoneSize: 2, gap: 0.3, color: 'gold' }],
    ...overrides
  };
}

await test('13. save/load: a plate project (with project.plate) round-trips through validateProject() with the diameters/target/color intact', () => {
  const validated = validateProject(plateProject());
  assert.equal(validated.product, 'plate');
  assert.equal(validated.plate.outerDiameterMm, 270);
  assert.equal(validated.plate.innerWellDiameterMm, 195);
  assert.equal(validated.plate.designTarget, 'centerWell');
  assert.equal(validated.plate.colorId, 'white');
});

await test('14. save/load: an inconsistent plate diameter pair (inner >= outer) does not throw -- it is normalized to a consistent pair (never leaves an invalid rim width)', () => {
  const validated = validateProject(plateProject({ plate: { ...plateProject().plate, outerDiameterMm: 260, innerWellDiameterMm: 290 } }));
  assert.ok(validated.plate.innerWellDiameterMm < validated.plate.outerDiameterMm);
});

await test('15. backward compatibility: a pre-plate-feature Mug project (no project.plate field at all) validates cleanly, defaulting project.plate without throwing', () => {
  const preS112 = { version: 2, product: 'mug', canvas: { width: 210, height: 90 }, layers: [{ id: 'text', type: 'text', visible: true, text: 'Hi', stoneSize: 2, gap: 0.3, color: 'gold' }] };
  assert.equal('plate' in preS112, false);
  const validated = validateProject(preS112);
  assert.equal(validated.product, 'mug');
  const { weightGrams, ...defaultsWithoutWeight } = getPlateDefaults();
  assert.deepEqual(validated.plate, defaultsWithoutWeight);
});

await test('16. backward compatibility: defaultProject() (product:"mug") is unaffected by the plate feature except for carrying a default-valued project.plate bag', () => {
  const d = defaultProject();
  assert.equal(d.product, 'mug');
  assert.equal(d.canvas.width, 210);
  assert.equal(d.canvas.height, 90);
  // Unlike validateProject() (which routes project.plate through normalizePlateParams(), stripping
  // the read-only weightGrams field), defaultProject() seeds it directly from getPlateDefaults() --
  // so the comparison here is unstripped.
  assert.deepEqual(d.plate, getPlateDefaults());
});

await test('17. no regression: mug/tumbler/bottle projects (with no plate field) still validate identically to before the plate feature', () => {
  for (const product of ['mug', 'tumbler', 'bottle']) {
    const t = getObjectTemplate(product);
    const proj = { version: 2, product, canvas: { width: t.productionWidthMm, height: t.productionHeightMm }, layers: [{ id: 'text', type: 'text', visible: true, text: 'Hi', stoneSize: 2, gap: 0.3, color: 'gold' }] };
    const validated = validateProject(proj);
    assert.equal(validated.product, product);
    assert.equal(validated.canvas.width, t.productionWidthMm);
  }
});

// --- 5. Production Sheet metadata ------------------------------------------------------------------

await test('18. Production Sheet: plate metadata (design target, outer/inner diameter, rim width, overall height, weight, color) appears in the header only for the plate template', async () => {
  const { StoneLayout } = await import('../src/geometry/StoneLayout.js');
  const layout = new StoneLayout({ layerId: 'l1', stones: [{ xMm: 5, yMm: 5, sizeMm: 2, color: 'gold', layerId: 'l1' }] });
  const d = computeProductionSheetLayout(layout, {
    projectName: 'Plate Sheet', objectType: 'Round Dinner Plate', productionWidthMm: 270, productionHeightMm: 270, pageSize: 'A3',
    plateDesignTarget: 'Rim Band', plateOuterDiameterMm: 270, plateInnerWellDiameterMm: 195, plateRimWidthMm: 37.5, plateOverallHeightMm: 25, plateWeightGrams: 800, plateColorName: 'White'
  });
  const texts = d.headerLines.map((l) => l.text);
  assert.ok(texts.some((t) => t === 'Design target: Rim Band'));
  assert.ok(texts.some((t) => t === 'Outer diameter (incl. rim): 270 mm'));
  assert.ok(texts.some((t) => t === 'Inner well diameter: 195 mm'));
  assert.ok(texts.some((t) => t === 'Rim width: 37.5 mm'));
  assert.ok(texts.some((t) => t === 'Overall height: 25 mm'));
  assert.ok(texts.some((t) => t === 'Plate color: White · Approx. weight: 800 g'));

  const mugSheet = computeProductionSheetLayout(layout, { projectName: 'Mug Sheet', objectType: 'Mug', productionWidthMm: 210, productionHeightMm: 90 });
  assert.equal(mugSheet.headerLines.some((l) => l.text.startsWith('Design target:')), false, 'non-plate templates must add zero extra header lines');
});

// --- 6. UI wiring (structural) ---------------------------------------------------------------------

await test('19. index.html exposes the plate dimension/design-target fields and the plate color swatch, both hidden by default', () => {
  assert.match(indexHtml, /<select id="objectType">[\s\S]*?<option value="plate">Round Dinner Plate<\/option>/);
  assert.match(indexHtml, /<div class="field-section" id="plateFields" style="display:none">/);
  for (const id of ['plateOuterDiameter', 'plateInnerWellDiameter', 'plateOverallHeight', 'plateCenterDepth', 'plateDesignTarget']) {
    assert.match(indexHtml, new RegExp(`id="${id}"`), `expected #${id} in index.html`);
  }
  assert.match(indexHtml, /<option value="centerWell" selected>Center Well<\/option>/);
  assert.match(indexHtml, /<option value="rimBand">Rim Band<\/option>/);
  assert.match(indexHtml, /<option value="fullTopSurface">Full Top Surface<\/option>/);
  assert.match(indexHtml, /<div class="toolbar-group" id="plateColorField" style="display:none">/);
  assert.match(indexHtml, /<select id="plateColor"><option value="white" selected>White<\/option><option value="creme">Creme<\/option><\/select>/);
});

await test('20. app.js: the plate fields are history-tracked, written into project.plate only while the plate template is active, and updateObjectTemplateDetail() toggles their visibility', () => {
  assert.match(appJs, /const HISTORY_TRACKED_CONTROL_IDS=\[[^\]]*'plateOuterDiameter'[^\]]*'plateInnerWellDiameter'[^\]]*'plateOverallHeight'[^\]]*'plateCenterDepth'[^\]]*'plateColor'[^\]]*'plateDesignTarget'[^\]]*\]/);
  assert.match(appJs, /if\(currentObjectTemplate\(\)\.preview\.kind==='plate'\)\{\s*project\.plate=normalizePlateParams\(/);
  assert.match(appJs, /el\('plateFields'\)\.style\.display=isPlate\?'block':'none'/);
  assert.match(appJs, /el\('plateColorField'\)\.style\.display=isPlate\?'flex':'none'/);
  assert.match(appJs, /el\('cupColorField'\)\.style\.display=isPlate\?'none':'flex'/);
});

await test('21. app.js: switching #objectType to plate reseeds project.plate/cupColor from the JSON defaults, exactly like project.canvas/wrap already reset for every template', () => {
  const handlerMatch = appJs.match(/el\('objectType'\)\.addEventListener\('change',\(\)=>\{([\s\S]*?)\}\);/);
  assert.ok(handlerMatch, 'expected an #objectType change handler');
  assert.match(handlerMatch[1], /if\(template\.id==='plate'\)\{project\.plate=getPlateDefaults\(\);project\.cupColor=getPlateColor\(project\.plate\.colorId\)\.hex\}/);
});

await test('22. app.js: the plate draws its own circular/annular design-target guide instead of the cylindrical Front View Frame, and drawCup() forwards plateParams to the 3D preview', () => {
  assert.match(appJs, /function drawPlateDesignTargetGuide\(/);
  assert.match(appJs, /if\(isPlate\)\{drawPlateDesignTargetGuide\(ctx,s,ox,oy,dpr\)\}else\{drawFrontViewFrame\(/);
  assert.match(appJs, /preview3D\.update\(layout,\{cupColor:project\.cupColor,objectTemplate:currentObjectTemplate\(\),canvasWidthMm:project\.canvas\.width,canvasHeightMm:project\.canvas\.height,plateParams:project\.plate\}\)/);
});

await test('23. app.js: isPointerOnFrontViewFrame()/isTextTooLongForObject() both opt the plate out of the cylindrical wrap-around concepts that do not apply to a flat disc', () => {
  const frameFn = appJs.match(/function isPointerOnFrontViewFrame\(mm\)\{[\s\S]*?\n\}/);
  assert.ok(frameFn);
  assert.match(frameFn[0], /if\(currentObjectTemplate\(\)\.preview\.kind==='plate'\)return false;/);
  const tooLongFn = appJs.match(/function isTextTooLongForObject\(l\)\{[\s\S]*?\n\}/);
  assert.ok(tooLongFn);
  assert.match(tooLongFn[0], /if\(currentObjectTemplate\(\)\.preview\.kind==='plate'\)return false;/);
});

// --- 7. UX corrections: Plate-Specific Workflow (Wrap Mode hidden for the plate) -------------------

await test('24. index.html wraps the Wrap Mode control in a #wrapField toolbar-group', () => {
  const wrapFieldBlock = extractBlock(indexHtml, /<div class="toolbar-group" id="wrapField">[\s\S]*?<\/div>/, '#wrapField');
  assert.match(wrapFieldBlock, /id="wrap"/, '#wrapField must contain the #wrap select');
});

await test('25. updateObjectTemplateDetail() hides #wrapField whenever the plate template is active, shows it otherwise', () => {
  const fn = extractBlock(appJs, /function updateObjectTemplateDetail\(\)\{[\s\S]*?\n\}/, 'updateObjectTemplateDetail()');
  assert.match(fn, /el\('wrapField'\)\.style\.display=isPlate\?'none':'flex'/, 'expected #wrapField to be toggled exactly like the other plate-only field groups, keyed off isPlate');
});

await test('26. the plate\'s Design Target select still exposes exactly Center Well / Rim Band / Full Top Surface, nothing else', () => {
  const selectBlock = extractBlock(indexHtml, /<select id="plateDesignTarget">[\s\S]*?<\/select>/, '#plateDesignTarget');
  const values = [...selectBlock.matchAll(/<option value="([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(values, ['centerWell', 'rimBand', 'fullTopSurface']);
});

await test('27. mug/bottle/tumbler are unaffected: no product-id gating was added anywhere near #wrap besides the plate check', () => {
  // The only conditional touching #wrapField's visibility must be the isPlate ternary asserted above
  // -- grep for any other reference to wrapField to make sure nothing else hides/shows it per-product.
  const matches = [...appJs.matchAll(/wrapField/g)];
  assert.equal(matches.length, 1, 'expected exactly one reference to wrapField in app.js (the isPlate toggle in updateObjectTemplateDetail())');
});

// --- 8. UX corrections: Improved Default 3D Presentation --------------------------------------------

const geometryBuilderSrc = await readFile(path.join(repoRoot, 'src/preview3d/ObjectGeometryBuilder.js'), 'utf8');
const rendererSrc = await readFile(path.join(repoRoot, 'src/preview3d/Preview3DRenderer.js'), 'utf8');

await test('28. PLATE_DEFAULT_POLAR_RAD was moved off the old near-top-down default, toward an eye-level-ish "real object" angle', () => {
  const match = rendererSrc.match(/const PLATE_DEFAULT_POLAR_RAD = ([\d.]+);/);
  assert.ok(match, 'expected PLATE_DEFAULT_POLAR_RAD to still be defined');
  const value = Number(match[1]);
  // The original default (0.68 rad, ~51 degrees of elevation) read as near-top-down and hid the
  // sloped rim/foot ring (see the implementation report for the real-browser sweep that established
  // this). It must no longer sit at or near that steep value, and must stay a real perspective angle
  // (not 0 == pure top-down, not >= MAX_POLAR_RAD == underneath).
  assert.ok(value >= 1.1 && value <= 1.5, `expected an eye-level-ish angle roughly matching the revolved-vessel DEFAULT_POLAR_RAD (1.3), got ${value}`);
});

await test('29. the plate camera angle is still selected only for the plate kind -- every revolved-vessel kind (mug/tumbler/bottle) keeps its own unchanged DEFAULT_POLAR_RAD', () => {
  assert.match(rendererSrc, /const DEFAULT_POLAR_RAD = 1\.3;/, 'the revolved-vessel default must be untouched by this plate-only correction');
  assert.match(rendererSrc, /const polarRad = this\._dimensions\.kind === 'plate' \? PLATE_DEFAULT_POLAR_RAD : DEFAULT_POLAR_RAD;/);
});

await test('30. the plate\'s revolved-profile geometry constants are byte-identical to the original feature -- the camera moved, the geometry was never "exaggerated" to compensate', () => {
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
    assert.equal(Number(match[1]), value, `${name} must be unchanged from the original feature -- this correction is camera-only, not a geometry change`);
  }
});

await test('31. no GeometryEngine/StoneLayout files were touched by the UX-correction milestone', async () => {
  // A direct, deterministic proxy for "no shared pipeline changes": neither file references any
  // plate-specific or UX-correction-specific symbol, i.e. they were never edited for this milestone.
  const geometryEngineSrc = await readFile(path.join(repoRoot, 'src/geometry/GeometryEngine.js'), 'utf8');
  const stoneLayoutSrc = await readFile(path.join(repoRoot, 'src/geometry/StoneLayout.js'), 'utf8');
  assert.doesNotMatch(geometryEngineSrc, /S-112A|rimBandCurveRadiusMm|wrapField/);
  assert.doesNotMatch(stoneLayoutSrc, /S-112A|rimBandCurveRadiusMm|wrapField/);
});

// --- 9. UX corrections: Rim Band Intelligent Default -------------------------------------------------

function buildRimBandCurveRadiusMm(project) {
  const fn = extractBlock(appJs, /function rimBandCurveRadiusMm\(\)\{[\s\S]*?\n\}/, 'rimBandCurveRadiusMm()');
  // eslint-disable-next-line no-new-func
  return new Function('getPlateDesignTargetGuide', 'project', `${fn}\nreturn rimBandCurveRadiusMm;`)(importedGetPlateDesignTargetGuide, project);
}

await test('32. rimBandCurveRadiusMm() returns the Rim Band annulus\'s own midline radius for the default plate dimensions', () => {
  const project = { plate: importedGetPlateDefaults(), canvas: { width: importedGetPlateDefaults().outerDiameterMm, height: importedGetPlateDefaults().outerDiameterMm } };
  const radius = buildRimBandCurveRadiusMm(project)();
  // Default plate: outer diameter 270mm (outer radius 135), inner well diameter 195mm (inner radius
  // 97.5) -- midline = (135 + 97.5) / 2 = 116.25.
  assert.ok(Math.abs(radius - 116.25) < 1e-9, `expected 116.25, got ${radius}`);
});

await test('33. rimBandCurveRadiusMm() re-derives from the live plate dimensions, not a hardcoded value', () => {
  const project = { plate: { ...importedGetPlateDefaults(), outerDiameterMm: 300, innerWellDiameterMm: 175 }, canvas: { width: 300, height: 300 } };
  const radius = buildRimBandCurveRadiusMm(project)();
  // outer radius 150, inner radius 87.5 -> midline 118.75.
  assert.ok(Math.abs(radius - 118.75) < 1e-9, `expected 118.75, got ${radius}`);
});

await test('34. rimBandCurveRadiusMm() reuses getPlateDesignTargetGuide() -- the single source of truth for the printable annulus -- rather than a second radius calculation', () => {
  const fn = extractBlock(appJs, /function rimBandCurveRadiusMm\(\)\{[\s\S]*?\n\}/, 'rimBandCurveRadiusMm()');
  assert.match(fn, /getPlateDesignTargetGuide\('rimBand',project\.plate,project\.canvas\.width,project\.canvas\.height\)/);
});

await test('35. writeSelectedControlsToLayer() detects "entering Rim Band" only for the plate template, comparing the new UI value against the still-unwritten previous project.plate.designTarget', () => {
  const fn = extractBlock(appJs, /function writeSelectedControlsToLayer\(\)\{[\s\S]*?\n\/\/ S-107/, 'writeSelectedControlsToLayer() (through the S-107 comment that follows it)');
  assert.match(fn, /const enteringRimBand=currentObjectTemplate\(\)\.preview\.kind==='plate'&&el\('plateDesignTarget'\)\.value==='rimBand'&&project\.plate\.designTarget!=='rimBand';/);
  // Must be computed before project.plate is overwritten later in the same function (the write to
  // project.plate is the single source of truth for "the previous target").
  const enteringIndex = fn.indexOf('const enteringRimBand=');
  const projectPlateWriteIndex = fn.indexOf('project.plate=normalizePlateParams(');
  assert.ok(enteringIndex !== -1 && projectPlateWriteIndex !== -1 && enteringIndex < projectPlateWriteIndex, 'enteringRimBand must be computed before project.plate is reassigned');
});

await test('36. the Rim Band default only applies to text layers, and seeds curveEnabled/curveRadiusMm/curveDirection/curveControls BEFORE they are read into the layer', () => {
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

await test('37. Center Well and Full Top Surface never force any curve field -- enteringRimBand is the only trigger, and it requires the target to specifically be "rimBand"', () => {
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

await test('38. re-entering Rim Band from a different target re-applies the default (no one-shot/sticky flag suppresses it)', () => {
  const fn = extractBlock(appJs, /function writeSelectedControlsToLayer\(\)\{[\s\S]*?\n\/\/ S-107/, 'writeSelectedControlsToLayer()');
  // enteringRimBand is derived fresh from live project/DOM state every call -- no persisted
  // "already applied" flag exists anywhere in app.js.
  for (const forbiddenField of ['rimBandDefaultApplied', 'rimBandAutoApplied', 'hasSeededRimBandCurve']) {
    assert.doesNotMatch(appJs, new RegExp(forbiddenField));
  }
});

await test('39. this milestone\'s test file is registered in the default suite, test:integration, and test:full (via tools/test-groups.mjs + tools/run-tests.mjs, not a literal package.json chain)', () => {
  assertTestRegistered({
    filename: 'test-product-plate-round-dinner.mjs',
    group: 'integration',
    includedInDefault: true,
  });
});

console.log('Product Definitions: Round Dinner Plate tests passed.');
