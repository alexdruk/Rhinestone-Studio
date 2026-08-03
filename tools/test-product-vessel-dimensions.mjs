import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertTestRegistered } from './lib/test-registration-assertions.mjs';

// RS-2010 — Physical Product Dimensions. Covers the new Standard Mug/Tumbler/Bottle product
// definitions (VesselProductDefinition.js + their JSON), the canvas<->vessel derivation contract
// (computeCanvasFromVessel()/deriveLegacyVesselParams()), save/load + backward compatibility
// (validateProject() with and without project.vessel, for both vessel and non-vessel products), and
// structural wiring of the new UI controls in app.js/index.html. Mirrors
// tools/test-product-plate-round-dinner.mjs's own structure/technique (the same
// extract-and-execute-the-real-function approach for app.js, since it is a browser entry point, not
// import()-able directly).

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const appJs = await readFile(path.join(repoRoot, 'app.js'), 'utf8');
const indexHtml = await readFile(path.join(repoRoot, 'index.html'), 'utf8');

const products = await import('../src/products/index.js');
const {
  VESSEL_PRODUCT_IDS,
  isValidVesselProductId,
  getVesselDefinition,
  getVesselDimensionRange,
  clampVesselDimensionMm,
  computePrintableHeightMm,
  getVesselDefaults,
  normalizeVesselParams,
  deriveLegacyVesselParams,
  computeCanvasFromVessel,
  getObjectTemplate
} = products;

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

// --- 1. Product-definition JSON -----------------------------------------------------------------

await test('1. all three vessel product definitions load, are id/family/type-correct, and cover exactly mug/tumbler/bottle', () => {
  assert.deepEqual([...VESSEL_PRODUCT_IDS].sort(), ['bottle', 'mug', 'tumbler']);
  for (const id of VESSEL_PRODUCT_IDS) {
    const def = getVesselDefinition(id);
    assert.equal(def.family, 'vessel');
    assert.equal(def.type, id);
    assert.ok(def.dimensions.bodyDiameterMm);
    assert.ok(def.dimensions.topDiameterMm);
    assert.ok(def.dimensions.bodyHeightMm);
    assert.equal(typeof def.printableMarginMm, 'number');
  }
  assert.equal(isValidVesselProductId('mug'), true);
  assert.equal(isValidVesselProductId('plate'), false);
  assert.equal(isValidVesselProductId('bogus'), false);
});

await test('2. default values match each JSON exactly', () => {
  assert.deepEqual(
    { bodyDiameterMm: 82, topDiameterMm: 85, bodyHeightMm: 95 },
    (({ bodyDiameterMm, topDiameterMm, bodyHeightMm }) => ({ bodyDiameterMm, topDiameterMm, bodyHeightMm }))(getVesselDefaults('mug'))
  );
  assert.deepEqual(
    { bodyDiameterMm: 76, topDiameterMm: 76, bodyHeightMm: 175 },
    (({ bodyDiameterMm, topDiameterMm, bodyHeightMm }) => ({ bodyDiameterMm, topDiameterMm, bodyHeightMm }))(getVesselDefaults('tumbler'))
  );
  assert.deepEqual(
    { bodyDiameterMm: 68, topDiameterMm: 68, bodyHeightMm: 150 },
    (({ bodyDiameterMm, topDiameterMm, bodyHeightMm }) => ({ bodyDiameterMm, topDiameterMm, bodyHeightMm }))(getVesselDefaults('bottle'))
  );
});

await test('3. parameter ranges match each JSON, and clampVesselDimensionMm() enforces them per-product', () => {
  assert.deepEqual({ min: getVesselDimensionRange('mug', 'bodyDiameterMm').min, max: getVesselDimensionRange('mug', 'bodyDiameterMm').max }, { min: 76, max: 88 });
  assert.equal(clampVesselDimensionMm('mug', 'bodyDiameterMm', 1000), 88);
  assert.equal(clampVesselDimensionMm('mug', 'bodyDiameterMm', 1), 76);
  assert.equal(clampVesselDimensionMm('mug', 'bodyDiameterMm', 80), 80);
  // Non-finite/missing falls back to that product's own default (permissive style, matching the
  // plate's clampPlateDimensionMm() convention).
  assert.equal(clampVesselDimensionMm('mug', 'bodyDiameterMm', NaN), 82);
  assert.throws(() => getVesselDimensionRange('mug', 'notAField'), /unknown dimension field/);
  // Ranges are genuinely per-product, not shared.
  assert.notDeepEqual(getVesselDimensionRange('mug', 'bodyDiameterMm'), getVesselDimensionRange('bottle', 'bodyDiameterMm'));
});

// --- 2. Derived printableHeightMm ------------------------------------------------------------------

await test('4. printableHeightMm = bodyHeightMm - printableMarginMm, never independently authored', () => {
  assert.equal(computePrintableHeightMm('mug', 95), 85);
  assert.equal(computePrintableHeightMm('tumbler', 175), 145);
  assert.equal(computePrintableHeightMm('bottle', 150), 140);
  assert.equal(getVesselDefaults('mug').printableHeightMm, 85);
});

await test('5. printableHeightMm never collapses to zero/negative for an extreme-min bodyHeightMm', () => {
  assert.ok(computePrintableHeightMm('tumbler', 1) >= 10, 'expected the MIN_PRINTABLE_HEIGHT_MM floor to apply');
});

// --- 3. normalizeVesselParams() (live-edit/new-project path, clamped) ------------------------------

await test('6. normalizeVesselParams(): defaults missing/malformed input entirely, matching getVesselDefaults()', () => {
  for (const id of VESSEL_PRODUCT_IDS) {
    assert.deepEqual(normalizeVesselParams(id, undefined), getVesselDefaults(id));
    assert.deepEqual(normalizeVesselParams(id, null), getVesselDefaults(id));
    assert.deepEqual(normalizeVesselParams(id, {}), getVesselDefaults(id));
  }
});

await test('7. normalizeVesselParams(): clamps out-of-range values into the product\'s own commercial range', () => {
  const clampedHigh = normalizeVesselParams('mug', { bodyDiameterMm: 5000, topDiameterMm: 5000, bodyHeightMm: 5000 });
  assert.equal(clampedHigh.bodyDiameterMm, 88);
  assert.equal(clampedHigh.topDiameterMm, 92);
  assert.equal(clampedHigh.bodyHeightMm, 102);
  const clampedLow = normalizeVesselParams('mug', { bodyDiameterMm: -10, topDiameterMm: -10, bodyHeightMm: 0 });
  assert.equal(clampedLow.bodyDiameterMm, 76);
  assert.equal(clampedLow.topDiameterMm, 78);
  assert.equal(clampedLow.bodyHeightMm, 88);
});

await test('8. normalizeVesselParams(): straight-wall products (tumbler, bottle) force topDiameterMm===bodyDiameterMm regardless of stored input', () => {
  for (const id of ['tumbler', 'bottle']) {
    const inRangeBodyDiameterMm = getVesselDimensionRange(id, 'bodyDiameterMm').average;
    const normalized = normalizeVesselParams(id, { bodyDiameterMm: inRangeBodyDiameterMm, topDiameterMm: 999 });
    assert.equal(normalized.topDiameterMm, normalized.bodyDiameterMm);
    assert.equal(normalized.topDiameterMm, inRangeBodyDiameterMm);
  }
});

await test('9. normalizeVesselParams(): mug\'s topDiameterMm is independently adjustable (not forced equal to body)', () => {
  const normalized = normalizeVesselParams('mug', { bodyDiameterMm: 80, topDiameterMm: 90 });
  assert.equal(normalized.bodyDiameterMm, 80);
  assert.equal(normalized.topDiameterMm, 90);
});

// --- 4. deriveLegacyVesselParams() (legacy-load path, unclamped, canvas-preserving) ----------------

await test('10. deriveLegacyVesselParams(): printableHeightMm exactly equals the input canvasHeightMm (preserves the existing printable area verbatim)', () => {
  for (const id of VESSEL_PRODUCT_IDS) {
    const template = getObjectTemplate(id);
    const derived = deriveLegacyVesselParams(id, template, template.productionWidthMm, template.productionHeightMm);
    assert.equal(derived.printableHeightMm, template.productionHeightMm);
  }
});

await test('11. deriveLegacyVesselParams(): bodyDiameterMm = canvasWidthMm/pi, unclamped (may legitimately fall outside the new commercial range for an old fixed preset)', () => {
  const template = getObjectTemplate('mug');
  const derived = deriveLegacyVesselParams('mug', template, 210, 90);
  assert.ok(Math.abs(derived.bodyDiameterMm - 210 / Math.PI) < 1e-9);
  // The legacy mug preset (210mm width) implies a body diameter (~66.85mm) below the new 76-88mm
  // commercial range -- deriveLegacyVesselParams() must report that honestly, not silently clamp it.
  const range = getVesselDimensionRange('mug', 'bodyDiameterMm');
  assert.ok(derived.bodyDiameterMm < range.min, 'expected the legacy-derived value to fall below the new commercial range, proving it is unclamped');
});

await test('12. deriveLegacyVesselParams(): straight-wall products reverse-derive topDiameterMm===bodyDiameterMm; mug reverses the ratio', () => {
  const tumblerTemplate = getObjectTemplate('tumbler');
  const tumblerDerived = deriveLegacyVesselParams('tumbler', tumblerTemplate, 230, 100);
  assert.equal(tumblerDerived.topDiameterMm, tumblerDerived.bodyDiameterMm);
  const mugTemplate = getObjectTemplate('mug');
  const mugDerived = deriveLegacyVesselParams('mug', mugTemplate, 210, 90);
  const expectedTopDiameterMm = mugDerived.bodyDiameterMm * (mugTemplate.preview.topWidthFactor / mugTemplate.preview.bottomWidthFactor);
  assert.ok(Math.abs(mugDerived.topDiameterMm - expectedTopDiameterMm) < 1e-9);
});

// --- 5. computeCanvasFromVessel() (new-project/live-edit canvas derivation) -------------------------

await test('13. computeCanvasFromVessel(): width = pi*bodyDiameterMm (circumference), height = printableHeightMm', () => {
  const vessel = getVesselDefaults('mug');
  const canvas = computeCanvasFromVessel(vessel);
  assert.ok(Math.abs(canvas.width - Math.PI * vessel.bodyDiameterMm) < 1e-9);
  assert.equal(canvas.height, vessel.printableHeightMm);
});

await test('14. computeCanvasFromVessel() is the inverse of deriveLegacyVesselParams() for the printable-height leg (round-trips exactly)', () => {
  const template = getObjectTemplate('bottle');
  const derived = deriveLegacyVesselParams('bottle', template, template.productionWidthMm, template.productionHeightMm);
  const canvas = computeCanvasFromVessel(derived);
  assert.ok(Math.abs(canvas.width - template.productionWidthMm) < 1e-9);
  assert.equal(canvas.height, template.productionHeightMm);
});

// --- 6. Save/load + backward compatibility ----------------------------------------------------------

async function extractProjectFunctions() {
  const validateMatch = appJs.match(/function validateProject\(obj\)\{[\s\S]*?\n\}\n/);
  assert.ok(validateMatch, 'expected to find validateProject() in app.js');
  const defaultMatch = appJs.match(/function defaultProject\(\)\{[\s\S]*?\}\}\n/);
  assert.ok(defaultMatch, 'expected to find defaultProject() in app.js');
  const constantsStart = appJs.indexOf('const DEFAULT_TEXT_FONT_ID=');
  const source = `${appJs.slice(constantsStart, appJs.indexOf(defaultMatch[0]) + defaultMatch[0].length)}\n${appJs.slice(appJs.indexOf('const SUPPORTED_LAYER_TYPES=new Set'), appJs.indexOf(validateMatch[0]) + validateMatch[0].length)}`;
  const { SHAPE_LIBRARY_KINDS } = await import('../src/geometry/index.js');
  const { getPlateDefaults, normalizePlateParams } = products;
  // eslint-disable-next-line no-new-func
  return new Function(
    'getObjectTemplate', 'SHAPE_LIBRARY_KINDS', 'getPlateDefaults', 'normalizePlateParams',
    'VESSEL_PRODUCT_IDS', 'getVesselDefaults', 'normalizeVesselParams', 'deriveLegacyVesselParams', 'computeCanvasFromVessel',
    `${source}\nreturn { validateProject, defaultProject };`
  )(getObjectTemplate, SHAPE_LIBRARY_KINDS, getPlateDefaults, normalizePlateParams, VESSEL_PRODUCT_IDS, getVesselDefaults, normalizeVesselParams, deriveLegacyVesselParams, computeCanvasFromVessel);
}
const { validateProject, defaultProject } = await extractProjectFunctions();

await test('15. save/load: a vessel project (with explicit project.vessel) round-trips through validateProject(), clamped into range', () => {
  const proj = {
    version: 2, name: 'Mug Test', product: 'mug', canvas: { width: 257.6, height: 85 },
    cupColor: '#1f3556', wrap: 'front', vessel: { bodyDiameterMm: 5000, topDiameterMm: 85, bodyHeightMm: 95 },
    layers: [{ id: 'text', type: 'text', visible: true, text: 'Hi', font: 'courier-prime-regular', height: 20, stoneSize: 2, gap: 0.3, color: 'gold' }]
  };
  const validated = validateProject(proj);
  assert.equal(validated.product, 'mug');
  assert.equal(validated.vessel.bodyDiameterMm, 88, 'expected the out-of-range value to be clamped, not passed through');
});

await test('16. backward compatibility: a legacy vessel project (no project.vessel field at all) validates cleanly, deriving project.vessel from the existing canvas without ever touching project.canvas', () => {
  const legacy = { version: 2, product: 'mug', canvas: { width: 210, height: 90 }, layers: [{ id: 'text', type: 'text', visible: true, text: 'Hi', stoneSize: 2, gap: 0.3, color: 'gold' }] };
  assert.equal('vessel' in legacy, false);
  const validated = validateProject(legacy);
  assert.equal(validated.product, 'mug');
  // The crux of the compatibility guarantee: canvas is byte-identical to the legacy input.
  assert.equal(validated.canvas.width, 210);
  assert.equal(validated.canvas.height, 90);
  // project.vessel is populated (never null/undefined), and preserves the existing printable area.
  assert.ok(validated.vessel);
  assert.equal(validated.vessel.printableHeightMm, 90);
  assert.ok(Math.abs(validated.vessel.bodyDiameterMm - 210 / Math.PI) < 1e-9);
});

await test('17. backward compatibility: a legacy plate project (no project.vessel) still validates cleanly with an inert, well-formed project.vessel (mirrors project.plate\'s own always-present-but-inert convention)', () => {
  const legacyPlate = { version: 2, product: 'plate', canvas: { width: 270, height: 270 }, layers: [{ id: 'text', type: 'text', visible: true, text: 'Hi', stoneSize: 2, gap: 0.3, color: 'gold' }] };
  const validated = validateProject(legacyPlate);
  assert.equal(validated.product, 'plate');
  assert.deepEqual(validated.vessel, getVesselDefaults('mug'));
});

await test('18. no regression: switching object type never mutates canvas.width/height for a plate-only field, and vessel/plate stay independently namespaced', () => {
  const proj = { version: 2, product: 'bottle', canvas: { width: 180, height: 90 }, layers: [{ id: 'text', type: 'text', visible: true, text: 'Hi', stoneSize: 2, gap: 0.3, color: 'gold' }] };
  const validated = validateProject(proj);
  assert.equal(validated.canvas.width, 180);
  assert.equal(validated.canvas.height, 90);
  assert.ok(validated.plate);
  assert.ok(validated.vessel);
});

await test('19. defaultProject(): a *fresh* project (product mug) derives its canvas from the Standard Mug defaults, not the old fixed 210x90mm preset', () => {
  const d = defaultProject();
  assert.equal(d.product, 'mug');
  assert.deepEqual(d.vessel, getVesselDefaults('mug'));
  assert.ok(Math.abs(d.canvas.width - Math.PI * d.vessel.bodyDiameterMm) < 1e-9);
  assert.equal(d.canvas.height, d.vessel.printableHeightMm);
});

// --- 7. UI wiring (structural) ------------------------------------------------------------------

await test('20. index.html exposes the vessel dimension fields, hidden by default, with a Top Diameter field that can be independently hidden for the tumbler', () => {
  assert.match(indexHtml, /<div class="field-section" id="vesselFields" style="display:none">/);
  for (const id of ['vesselBodyDiameter', 'vesselBodyHeight', 'vesselTopDiameter']) {
    assert.match(indexHtml, new RegExp(`id="${id}"`), `expected #${id} in index.html`);
  }
  assert.match(indexHtml, /id="vesselTopDiameterField"/);
});

await test('21. app.js: the vessel fields are history-tracked, written into project.vessel+project.canvas only while a vessel template is active, and updateObjectTemplateDetail() toggles their visibility', () => {
  assert.match(appJs, /const HISTORY_TRACKED_CONTROL_IDS=\[[^\]]*'vesselBodyDiameter'[^\]]*'vesselBodyHeight'[^\]]*'vesselTopDiameter'[^\]]*\]/);
  assert.match(appJs, /if\(VESSEL_PRODUCT_IDS\.includes\(currentObjectTemplate\(\)\.id\)\)\{/);
  assert.match(appJs, /project\.vessel=normalizeVesselParams\(vesselProductId,/);
  assert.match(appJs, /project\.canvas=computeCanvasFromVessel\(project\.vessel\);/);
  assert.match(appJs, /el\('vesselFields'\)\.style\.display=isVessel\?'block':'none'/);
});

await test('22. app.js: switching #objectType to a vessel product reseeds project.vessel from that product\'s own defaults and derives project.canvas from it, exactly like project.plate already reseeds for the plate', () => {
  const handlerMatch = appJs.match(/el\('objectType'\)\.addEventListener\('change',\(\)=>\{([\s\S]*?)\}\);/);
  assert.ok(handlerMatch, 'expected an #objectType change handler');
  assert.match(handlerMatch[1], /if\(VESSEL_PRODUCT_IDS\.includes\(template\.id\)\)\{project\.vessel=getVesselDefaults\(template\.id\);project\.canvas=computeCanvasFromVessel\(project\.vessel\)\}/);
});

await test('23. app.js: drawCup() forwards vesselParams:project.vessel to the 3D preview alongside plateParams', () => {
  // RS-2013 step 6c: drawCup() now also forwards instancedStones:__devInstancedStonesState.on
  // after vesselParams -- additive only, plateParams/vesselParams forwarding itself is unchanged.
  assert.match(appJs, /preview3D\.update\(layout,\{cupColor:project\.cupColor,objectTemplate:currentObjectTemplate\(\),canvasWidthMm:project\.canvas\.width,canvasHeightMm:project\.canvas\.height,plateParams:project\.plate,vesselParams:project\.vessel,instancedStones:__devInstancedStonesState\.on\}\)/);
});

// --- 8. Out-of-scope guard: GeometryEngine/StoneLayout untouched ------------------------------------

await test('24. no GeometryEngine/StoneLayout file references any RS-2010/vessel-specific symbol -- this milestone only changes where canvas dimensions come from, never geometry generation', async () => {
  const geometryEngineSrc = await readFile(path.join(repoRoot, 'src/geometry/GeometryEngine.js'), 'utf8');
  const stoneLayoutSrc = await readFile(path.join(repoRoot, 'src/geometry/StoneLayout.js'), 'utf8');
  assert.doesNotMatch(geometryEngineSrc, /vessel|RS-2010/i);
  assert.doesNotMatch(stoneLayoutSrc, /vessel|RS-2010/i);
});

await test('25. this milestone\'s test file is registered in the default suite, test:integration, and test:full (via tools/test-groups.mjs + tools/run-tests.mjs, not a literal package.json chain)', () => {
  assertTestRegistered({
    filename: 'test-product-vessel-dimensions.mjs',
    group: 'integration',
    includedInDefault: true,
  });
});

console.log('Product Definitions: Physical Vessel Dimensions tests passed.');
