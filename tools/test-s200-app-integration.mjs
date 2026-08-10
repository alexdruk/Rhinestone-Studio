import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// S-200 (Mixed Stone-Size Layouts) — UI wiring, editing-lifecycle (undo/redo, layer schema), and
// legacy-project-loading proof. app.js is a browser entry point (not import()-able directly under
// plain Node -- it runs document.getElementById() at module scope), so checks are structural or
// execute a real extracted function against minimal fakes, matching the existing convention in
// tools/test-fill-algorithms-integration.mjs / tools/test-variable-stone-sizes.mjs.

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const appJs = await readFile(path.join(repoRoot, 'app.js'), 'utf8');
const indexHtml = await readFile(path.join(repoRoot, 'index.html'), 'utf8');

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

// --- 1. index.html markup ---------------------------------------------------------------------

await test('1. index.html has the Mixed Stone Size shared field group with Generation Mode, five Allowed Size checkboxes, Min/Max Size, and Conservative Detail', () => {
  assert.match(indexHtml, /<div id="sharedMixedSizeFields">/);
  assert.match(indexHtml, /<select id="sizeMode"[^>]*>\s*<option value="uniform" selected>Uniform<\/option>\s*<option value="mixed">Mixed<\/option>/);
  for (const id of ['mixedAllowedSs6', 'mixedAllowedSs10', 'mixedAllowedSs16', 'mixedAllowedSs20', 'mixedAllowedSs30']) {
    assert.match(indexHtml, new RegExp(`<input type="checkbox" id="${id}"`), `expected checkbox #${id}`);
  }
  assert.match(indexHtml, /<select id="mixedMinSize"/);
  assert.match(indexHtml, /<select id="mixedMaxSize"/);
  assert.match(indexHtml, /<input id="conservativeDetail" type="range" min="0" max="1"/);
});

await test('2. every Lightbox tab (Text/Shapes/Import/Image Trace) and the inspector each have a Mixed Stone Size relocation slot', () => {
  for (const id of ['inspectorMixedSizeSlot', 'textMixedSizeSlot', 'shapesMixedSizeSlot', 'importMixedSizeSlot', 'imageTraceMixedSizeSlot']) {
    assert.match(indexHtml, new RegExp(`<div id="${id}" class="field-slot">`), `expected slot #${id}`);
  }
});

// --- 2. app.js wiring --------------------------------------------------------------------------

await test('3. resolveSizeMode() falls back to \'uniform\' for any unrecognized or missing value', () => {
  const fnSource = appJs.slice(appJs.indexOf('const SIZE_MODES='), appJs.indexOf('\n', appJs.indexOf('function resolveSizeMode')) + 1);
  const run = new Function(`${fnSource}\nreturn resolveSizeMode;`);
  const resolveSizeMode = run();
  assert.equal(resolveSizeMode('mixed'), 'mixed');
  assert.equal(resolveSizeMode('uniform'), 'uniform');
  assert.equal(resolveSizeMode(undefined), 'uniform');
  assert.equal(resolveSizeMode('bogus'), 'uniform');
});

await test('4. MIXED_ALLOWED_SIZE_CHECKBOXES lists exactly the five Stone Library sizes, matching src/renderer/StoneSizes.js\'s shipped catalog', async () => {
  const { STONE_SIZES } = await import('../src/renderer/StoneSizes.js');
  const fnSource = appJs.slice(appJs.indexOf('const MIXED_ALLOWED_SIZE_CHECKBOXES='), appJs.indexOf('];', appJs.indexOf('const MIXED_ALLOWED_SIZE_CHECKBOXES=')) + 2);
  const run = new Function(`${fnSource}\nreturn MIXED_ALLOWED_SIZE_CHECKBOXES;`);
  const checkboxes = run();
  assert.equal(checkboxes.length, STONE_SIZES.length);
  for (let i = 0; i < STONE_SIZES.length; i++) {
    assert.equal(checkboxes[i].diameterMm, STONE_SIZES[i].diameterMm, `checkbox ${i} diameter must match the catalog`);
  }
});

await test('5. mixedSizeParamsFor() forwards sizeMode:\'uniform\' for a layer with no S-200 fields at all (legacy layer)', () => {
  const sizeModeFn = appJs.slice(appJs.indexOf('const SIZE_MODES='), appJs.indexOf('\n', appJs.indexOf('function resolveSizeMode')) + 1);
  const fnSource = appJs.slice(appJs.indexOf('function mixedSizeParamsFor'), appJs.indexOf('\n', appJs.indexOf('function mixedSizeParamsFor')) + 1);
  const run = new Function(`${sizeModeFn}\n${fnSource}\nreturn mixedSizeParamsFor;`);
  const mixedSizeParamsFor = run();
  const legacyLayer = { id: 'x', type: 'rectangle', stoneSize: 4, gap: 0.3 };
  assert.deepEqual(mixedSizeParamsFor(legacyLayer), {
    sizeMode: 'uniform', allowedSizesMm: [], minSizeMm: null, maxSizeMm: null, conservativeDetail: undefined
  });
});

await test('6. every generate*StonesLive() forwards mixedSizeParamsFor(layer) into its engine params', () => {
  for (const call of ['generateTextLayout(base)', 'generateShapeLayout(params)', 'generateSvgLayout(params)', 'generateImageLayout(params)', 'generatePathLayout(params)']) {
    assert.match(appJs, /\.\.\.mixedSizeParamsFor\(layer\)/, `expected at least one ...mixedSizeParamsFor(layer) spread (checking presence for ${call})`);
  }
  // Each of the five params objects individually includes the spread (not just one, coincidentally).
  const occurrences = appJs.match(/\.\.\.mixedSizeParamsFor\(layer\)/g) || [];
  assert.equal(occurrences.length, 5, `expected exactly 5 call sites forwarding mixedSizeParamsFor(layer), found ${occurrences.length}`);
});

await test('7. syncSelectedControlsFromLayer()/writeSelectedControlsToLayer() round-trip sizeMode/allowedSizesMm/min/max/conservativeDetail', () => {
  assert.match(appJs, /el\('sizeMode'\)\.value=sizeMode/, 'expected sizeMode to be synced from the layer');
  assert.match(appJs, /el\('mixedSizeDetailFields'\)\.style\.display=sizeMode==='mixed'\?'block':'none'/, 'expected progressive disclosure of the Mixed detail fields');
  assert.match(appJs, /l\.sizeMode=resolveSizeMode\(el\('sizeMode'\)\.value\)/);
  assert.match(appJs, /l\.allowedSizesMm=MIXED_ALLOWED_SIZE_CHECKBOXES\.filter\(cb=>el\(cb\.id\)\.checked\)\.map\(cb=>cb\.diameterMm\)/);
  assert.match(appJs, /l\.minSizeMm=parseFloat\(el\('mixedMinSize'\)\.value\)\|\|null/);
  assert.match(appJs, /l\.maxSizeMm=parseFloat\(el\('mixedMaxSize'\)\.value\)\|\|null/);
  assert.match(appJs, /l\.conservativeDetail=Math\.max\(0,Math\.min\(1,parseFloat\(el\('conservativeDetail'\)\.value\)\|\|0\)\)/);
});

await test('8. HISTORY_TRACKED_CONTROL_IDS includes sizeMode, every allowed-size checkbox (as literal ids), min/max size, and conservativeDetail', () => {
  const arrayMatch = appJs.match(/const HISTORY_TRACKED_CONTROL_IDS=\[([\s\S]*?)\];/);
  assert.ok(arrayMatch, 'expected to find HISTORY_TRACKED_CONTROL_IDS');
  const arraySource = arrayMatch[1];
  assert.match(arraySource, /'sizeMode'/);
  // CI follow-up (2026-07): the five checkbox ids must be literal string entries, not a computed
  // `...MIXED_ALLOWED_SIZE_CHECKBOXES.map(cb=>cb.id)` spread -- a spread here broke
  // tools/test-crystal-color-integration.mjs's own history-tracking check, which JSON.parses this
  // array's source text (a reasonable assumption for a plain list of DOM control ids). See test 12
  // below for the general-purpose regression guard.
  for (const id of ['mixedAllowedSs6', 'mixedAllowedSs10', 'mixedAllowedSs16', 'mixedAllowedSs20', 'mixedAllowedSs30']) {
    assert.match(arraySource, new RegExp(`'${id}'`), `expected a literal '${id}' entry`);
  }
  assert.doesNotMatch(arraySource, /\.\.\./, 'HISTORY_TRACKED_CONTROL_IDS must stay a flat list of string literals, no spread expressions');
  assert.match(arraySource, /'mixedMinSize'/);
  assert.match(arraySource, /'mixedMaxSize'/);
  assert.match(arraySource, /'conservativeDetail'/);
});

await test('9. FIELD_GROUPS includes a mixedSize relocation group covering every layer-type Lightbox', () => {
  const groupMatch = appJs.match(/mixedSize:\{field:'sharedMixedSizeFields',home:'inspectorMixedSizeSlot',lightboxSlots:\{([^}]*)\}\}/);
  assert.ok(groupMatch, 'expected a FIELD_GROUPS.mixedSize entry');
  for (const key of ['text', 'shapes', 'import', 'imagetrace']) {
    assert.match(groupMatch[1], new RegExp(`${key}:`), `expected a lightboxSlots.${key} entry`);
  }
});

await test('10. populateMixedSizeSelectOptions() is called once at startup, alongside populateStoneSizeOptions()', () => {
  assert.match(appJs, /populateStoneColorOptions\(\);populateStoneSizeOptions\(\);populateMixedSizeSelectOptions\(\);/);
});

// --- 3. Legacy / backward-compatibility ---------------------------------------------------------

await test('11. validateProject() requires no S-200 fields — a legacy layer with none of them still validates', async () => {
  // RS-2010 merge follow-up (2026-07): validateProject() now also references
  // VESSEL_PRODUCT_IDS/getVesselDefaults/normalizeVesselParams/deriveLegacyVesselParams (project.vessel
  // handling), so the old minimal hand-rolled fakes for getObjectTemplate()/normalizePlateParams() no
  // longer cover its full dependency surface (ReferenceError: VESSEL_PRODUCT_IDS is not defined).
  // Rather than hand-roll fakes for the new vessel functions too (risking silently-wrong fixture
  // behavior drifting from the real thing), this now mirrors
  // tools/test-project-validation-security.mjs's own extraction exactly: the REAL
  // getObjectTemplate/getPlateDefaults/normalizePlateParams/VESSEL_PRODUCT_IDS/getVesselDefaults/
  // normalizeVesselParams/deriveLegacyVesselParams/computeCanvasFromVessel/SHAPE_LIBRARY_KINDS are
  // imported from their actual modules and injected into the sandbox, so this test only ever
  // exercises validateProject()'s own logic against genuine dependencies, not a second,
  // maintained-by-hand implementation of them.
  const { SHAPE_LIBRARY_KINDS } = await import('../src/geometry/index.js');
  const {
    getObjectTemplate, getPlateDefaults, normalizePlateParams,
    VESSEL_PRODUCT_IDS, getVesselDefaults, normalizeVesselParams, deriveLegacyVesselParams, computeCanvasFromVessel
  } = await import('../src/products/index.js');

  const validateMatch = appJs.match(/function validateProject\(obj\)\{[\s\S]*?\n\}\n/);
  assert.ok(validateMatch, 'expected to find validateProject() in app.js');
  const constantsStart = appJs.indexOf('const DEFAULT_TEXT_FONT_ID=');
  const source = appJs.slice(constantsStart, appJs.indexOf(validateMatch[0]) + validateMatch[0].length);

  const run = new Function(
    'getObjectTemplate', 'SHAPE_LIBRARY_KINDS', 'getPlateDefaults', 'normalizePlateParams',
    'VESSEL_PRODUCT_IDS', 'getVesselDefaults', 'normalizeVesselParams', 'deriveLegacyVesselParams', 'computeCanvasFromVessel',
    `${source}\nreturn validateProject;`
  );
  const validateProject = run(
    getObjectTemplate, SHAPE_LIBRARY_KINDS, getPlateDefaults, normalizePlateParams,
    VESSEL_PRODUCT_IDS, getVesselDefaults, normalizeVesselParams, deriveLegacyVesselParams, computeCanvasFromVessel
  );

  const legacyProject = {
    version: 2, canvas: { width: 210, height: 90 },
    layers: [{ id: 'circle-1', type: 'circle', cx: 30, cy: 30, r: 10, stoneSize: 4, gap: 0.3 }]
  };
  const result = validateProject(legacyProject);
  assert.equal(result.layers[0].sizeMode, undefined, 'a legacy layer keeps no sizeMode field — resolved defensively downstream, not injected here');
  // RS-2010 combined-state check: a legacy (no obj.vessel) project must still derive vessel from its
  // own untouched canvas, not silently reset canvas from a fresh product default.
  assert.deepEqual(result.canvas, { width: 210, height: 90 }, 'legacy project.canvas must be preserved unchanged, per RS-2010');
  assert.ok(result.vessel && typeof result.vessel === 'object', 'expected a derived project.vessel for a legacy mug-shaped project');
});

// --- 4. CI follow-up regression guards (2026-07) -------------------------------------------------
// Both added after a full-suite CI run caught two S-200-introduced incompatibilities that this
// file's original test 8 did not catch (it directly encoded the very shape that broke another
// suite). See docs/specifications/S-200-MixedStoneSizeLayouts.md, "Results" for the full root-cause
// writeup.

await test('12. HISTORY_TRACKED_CONTROL_IDS stays JSON-parseable as a flat string-literal array (other suites, e.g. test-crystal-color-integration.mjs, rely on this)', () => {
  const arrayMatch = appJs.match(/const HISTORY_TRACKED_CONTROL_IDS=\[([\s\S]*?)\];/);
  assert.ok(arrayMatch, 'expected to find HISTORY_TRACKED_CONTROL_IDS');
  // Mirrors tools/test-crystal-color-integration.mjs's own extraction exactly: naive quote
  // substitution then JSON.parse. Any computed expression (a spread, a function call, a template
  // literal) inside this array makes it fail exactly like it did before this fix.
  const ids = JSON.parse(`[${arrayMatch[1].replace(/'/g, '"')}]`);
  assert.ok(Array.isArray(ids) && ids.length > 40, 'expected a large flat array of control ids');
  assert.ok(ids.includes('sizeMode') && ids.includes('mixedAllowedSs6'), 'expected the S-200 control ids to still be present');
});

await test('13. generateSvgStonesLive()/generatePathStonesLive() params objects still satisfy tools/test-fill-algorithms-integration.mjs\'s mode-resolution regexes with the S-200 mixedSizeParamsFor(layer) spread present', () => {
  // Guards against re-breaking those two pre-existing RS-1011 assertions the way the original
  // trailing `,...mixedSizeParamsFor(layer)}` placement did (see the "Results" section of the spec).
  // RS-3011 (2026-08): tolerates the closed:layer.closed!==false field the open-contour fix added
  // between color and the mixedSizeParamsFor spread.
  assert.match(appJs, /mode:resolveVectorFillMode\(layer\.mode\),color:layer\.color(?:,\.\.\.mixedSizeParamsFor\(layer\))?\};const result=this\.permanentEngine\.generateSvgLayout/);
  assert.match(appJs, /gapMm:layer\.gap,mode:resolveVectorFillMode\(layer\.fillMode\),color:layer\.color(?:,closed:layer\.closed!==false)?(?:,\.\.\.mixedSizeParamsFor\(layer\))?\};const result=this\.permanentEngine\.generatePathLayout/);
});

console.log('S-200 app integration tests complete.');
