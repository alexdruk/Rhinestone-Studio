import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { displayValueToMm, formatLengthDisplay } from '../src/units/index.js';

// RS-3037 -- Flat Sheet object type. See docs/specifications/RS-3037-FlatSheet.md.
//
// Items 1-4 exercise the new registry/module surface directly. Items 5-13 extract and REALLY
// EXECUTE the real app.js source (a browser entry point, not import()-able directly under plain
// Node) via `new Function`, matching this repo's established app.js-testing convention (see e.g.
// tools/test-object-template-integration.mjs, tools/test-rs-3025-length-field-mm-stash.mjs,
// tools/test-ui-import-autoswitch-regression.mjs).

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const appJs = await readFile(path.join(repoRoot, 'app.js'), 'utf8');

const {
  OBJECT_TEMPLATE_IDS, getObjectTemplate, listObjectTemplates, getSafeAreaRectMm,
  getSheetDefaults, clampSheetDimensionMm, VESSEL_PRODUCT_IDS, getVesselDefaults, computeCanvasFromVessel,
  getPlateDefaults, getPlateColor, normalizePlateParams, deriveLegacyVesselParams, normalizeVesselParams
} = await import('../src/products/index.js');
const { SHAPE_LIBRARY_KINDS } = await import('../src/geometry/index.js');
const { Stone } = await import('../src/geometry/Stone.js');
const { StoneLayout } = await import('../src/geometry/StoneLayout.js');
const { computeProductionSheetLayout } = await import('../src/export/ProductionSheetExporter.js');

let failureCount = 0;
async function test(name, fn) {
  try {
    await fn();
    console.log(`✓ ${name}`);
  } catch (error) {
    console.error(`✗ ${name}`);
    console.error(error);
    failureCount++;
    process.exitCode = 1;
  }
}

function extractLine(source, startMarker, label) {
  const start = source.indexOf(startMarker);
  assert.ok(start !== -1, `expected to find "${startMarker}" (${label}) in app.js`);
  const end = source.indexOf('\n', start);
  assert.ok(end !== -1, `expected a line ending after "${startMarker}" (${label})`);
  return source.slice(start, end);
}

// =================================================================================================
// 1. Registry
// =================================================================================================

await test('1. OBJECT_TEMPLATE_IDS includes sheet; listObjectTemplates().length===5; getObjectTemplate(\'sheet\').displayName', () => {
  assert.ok(OBJECT_TEMPLATE_IDS.includes('sheet'));
  assert.equal(listObjectTemplates().length, 5);
  assert.equal(getObjectTemplate('sheet').displayName, 'Flat Sheet');
});

// =================================================================================================
// 2. Sheet template fields
// =================================================================================================

await test('2. sheet template: productionWidthMm/HeightMm 150, safeAreaInsetMm 10 on all sides, wrap.default full, preview.kind sheet', () => {
  const t = getObjectTemplate('sheet');
  assert.equal(t.productionWidthMm, 150);
  assert.equal(t.productionHeightMm, 150);
  assert.deepEqual(t.safeAreaInsetMm, { top: 10, right: 10, bottom: 10, left: 10 });
  assert.equal(t.wrap.default, 'full');
  assert.equal(t.preview.kind, 'sheet');
});

// =================================================================================================
// 3. getSafeAreaRectMm
// =================================================================================================

await test('3. getSafeAreaRectMm for the sheet at 150x150 is 130x130', () => {
  const rect = getSafeAreaRectMm(getObjectTemplate('sheet'), 150, 150);
  assert.equal(rect.widthMm, 130);
  assert.equal(rect.heightMm, 130);
});

// =================================================================================================
// 4. clampSheetDimensionMm
// =================================================================================================

await test('4. clampSheetDimensionMm(): 5->20, 900->500, 180->180 (unchanged), NaN->150', () => {
  assert.equal(clampSheetDimensionMm(5), 20);
  assert.equal(clampSheetDimensionMm(900), 500);
  assert.equal(clampSheetDimensionMm(180), 180);
  assert.equal(clampSheetDimensionMm(NaN), 150);
  assert.deepEqual(getSheetDefaults(), { widthMm: 150, heightMm: 150 });
});

// =================================================================================================
// 5. validateProject() -- extraction mirrors tools/test-object-template-integration.mjs
// =================================================================================================

function extractProjectFunctions() {
  const validateMatch = appJs.match(/function validateProject\(obj\)\{[\s\S]*?\n\}\n/);
  assert.ok(validateMatch, 'expected to find validateProject() in app.js');
  const defaultMatch = appJs.match(/function defaultProject\(\)\{[\s\S]*?\}\}\n/);
  assert.ok(defaultMatch, 'expected to find defaultProject() in app.js');
  const constantsStart = appJs.indexOf('const DEFAULT_TEXT_FONT_ID=');
  const source = `${appJs.slice(constantsStart, appJs.indexOf(defaultMatch[0]) + defaultMatch[0].length)}\n${appJs.slice(appJs.indexOf('const SUPPORTED_LAYER_TYPES=new Set'), appJs.indexOf(validateMatch[0]) + validateMatch[0].length)}`;
  // eslint-disable-next-line no-new-func
  return new Function(
    'getObjectTemplate', 'SHAPE_LIBRARY_KINDS', 'getPlateDefaults', 'normalizePlateParams',
    'VESSEL_PRODUCT_IDS', 'getVesselDefaults', 'normalizeVesselParams', 'deriveLegacyVesselParams', 'computeCanvasFromVessel',
    `${source}\nreturn { validateProject, defaultProject };`
  )(getObjectTemplate, SHAPE_LIBRARY_KINDS, getPlateDefaults, normalizePlateParams, VESSEL_PRODUCT_IDS, getVesselDefaults, normalizeVesselParams, deriveLegacyVesselParams, computeCanvasFromVessel);
}

const { validateProject } = extractProjectFunctions();

function minimalTextLayer() {
  return { id: 'text', type: 'text', text: 'Hi', font: 'courier-prime-regular', height: 25, stoneSize: 2, gap: 0.3, color: 'gold' };
}

await test('5. validateProject(): product sheet resolves to sheet at 150x150/20x20/500x500 with canvas unmodified; a mug project resolves exactly as before', () => {
  for (const size of [150, 20, 500]) {
    const input = { version: 2, product: 'sheet', canvas: { width: size, height: size }, layers: [minimalTextLayer()] };
    const validated = validateProject(JSON.parse(JSON.stringify(input)));
    assert.equal(validated.product, 'sheet', `size ${size}: product must resolve to sheet now that it is registered`);
    assert.deepEqual(validated.canvas, { width: size, height: size }, `size ${size}: canvas must round-trip unmodified (no clamp at this layer)`);
  }
  const mugInput = { version: 2, product: 'mug', canvas: { width: 210, height: 90 }, layers: [minimalTextLayer()] };
  const validatedMug = validateProject(JSON.parse(JSON.stringify(mugInput)));
  assert.equal(validatedMug.product, 'mug');
  assert.deepEqual(validatedMug.canvas, { width: 210, height: 90 });
});

// =================================================================================================
// 6. #objectType change handler
// =================================================================================================

function extractObjectTypeHandlerBody() {
  const match = appJs.match(/el\('objectType'\)\.addEventListener\('change',\(\)=>\{([\s\S]*?)\}\);/);
  assert.ok(match, 'expected to find the #objectType change handler in app.js');
  return match[1];
}

function runObjectTypeChange(project, chosenId) {
  const body = extractObjectTypeHandlerBody();
  // eslint-disable-next-line no-new-func
  const factory = new Function(
    'project', 'el', 'commitHistory', 'getObjectTemplate', 'VESSEL_PRODUCT_IDS', 'getVesselDefaults',
    'computeCanvasFromVessel', 'getPlateDefaults', 'getPlateColor', 'getSheetDefaults',
    'syncSelectedControlsFromLayer', 'updateAll',
    body
  );
  factory(
    project, () => ({ value: chosenId }), () => {}, getObjectTemplate, VESSEL_PRODUCT_IDS, getVesselDefaults,
    computeCanvasFromVessel, getPlateDefaults, getPlateColor, getSheetDefaults,
    () => {}, () => {}
  );
}

await test('6. #objectType change handler: mug->sheet gives product sheet/canvas 150x150/wrap full; sheet->mug gives the mug vessel-derived canvas', () => {
  const project = { product: 'mug', canvas: { width: 210, height: 90 }, wrap: 'front', plate: getPlateDefaults(), cupColor: '#1f3556', vessel: getVesselDefaults('mug') };

  runObjectTypeChange(project, 'sheet');
  assert.equal(project.product, 'sheet');
  assert.deepEqual(project.canvas, { width: 150, height: 150 });
  assert.equal(project.wrap, 'full');

  runObjectTypeChange(project, 'mug');
  assert.equal(project.product, 'mug');
  assert.equal(project.canvas.width, 257.610597594363);
  assert.equal(project.canvas.height, 85);
});

// =================================================================================================
// 7. sync-then-write round trip (syncSelectedControlsFromLayer()'s and writeSelectedControlsToLayer()'s
//    own sheet branches, plus the real setLengthField()/readLengthField() choke points)
// =================================================================================================

function extractSheetSyncBranch() {
  const match = appJs.match(/if\(currentObjectTemplate\(\)\.id==='sheet'\)\{setLengthField\('sheetWidth',project\.canvas\.width\);setLengthField\('sheetHeight',project\.canvas\.height\)\}/);
  assert.ok(match, 'expected the sheet resync branch in syncSelectedControlsFromLayer()/refreshAllLengthFieldDisplays()');
  return match[0];
}

function extractSheetWriteBranch() {
  const match = appJs.match(/if\(currentObjectTemplate\(\)\.id==='sheet'\)\{\s*project\.canvas=\{width:clampSheetDimensionMm\(readLengthField\('sheetWidth'\)\),height:clampSheetDimensionMm\(readLengthField\('sheetHeight'\)\)\};\s*\}/);
  assert.ok(match, 'expected the sheet branch in writeSelectedControlsToLayer()');
  return match[0];
}

function runSyncThenWrite(project) {
  const setLengthFieldSrc = extractLine(appJs, 'function setLengthField(id,mm){', 'setLengthField()');
  const readLengthFieldSrc = extractLine(appJs, 'function readLengthField(id){', 'readLengthField()');
  const syncBranch = extractSheetSyncBranch();
  const writeBranch = extractSheetWriteBranch();
  const elements = new Map();
  function el(id) {
    if (!elements.has(id)) elements.set(id, { value: '', dataset: {} });
    return elements.get(id);
  }
  // eslint-disable-next-line no-new-func
  const factory = new Function(
    'el', 'project', 'formatLengthDisplay', 'displayValueToMm', 'currentObjectTemplate', 'clampSheetDimensionMm',
    `${setLengthFieldSrc}\n${readLengthFieldSrc}\n${syncBranch}\n${writeBranch}\n`
  );
  factory(el, project, formatLengthDisplay, displayValueToMm, () => ({ id: 'sheet' }), clampSheetDimensionMm);
}

await test('7. sync-then-write round trip: product sheet, canvas 300x180 survives the real extracted sync followed by the real extracted write', () => {
  const project = { units: 'mm', canvas: { width: 300, height: 180 } };
  runSyncThenWrite(project);
  assert.deepEqual(project.canvas, { width: 300, height: 180 });
});

// =================================================================================================
// 8. setWorkspaceMode() / updateWorkspaceTabAvailability()
// =================================================================================================

function extractWorkspaceModeSource() {
  const declStart = appJs.indexOf("let workspaceMode='dual';");
  assert.ok(declStart !== -1, 'expected let workspaceMode=\'dual\'; in app.js');
  const declEnd = appJs.indexOf('\n', declStart);
  const setWorkspaceModeMatch = appJs.match(/function setWorkspaceMode\(mode,skipUpdate\)\{[\s\S]*?\n\}/);
  assert.ok(setWorkspaceModeMatch, 'expected setWorkspaceMode() in app.js');
  const updateTabAvailabilityMatch = appJs.match(/function updateWorkspaceTabAvailability\(\)\{[\s\S]*?\n\}/);
  assert.ok(updateTabAvailabilityMatch, 'expected updateWorkspaceTabAvailability() in app.js');
  return `${appJs.slice(declStart, declEnd)}\n${setWorkspaceModeMatch[0]}\n${updateTabAvailabilityMatch[0]}`;
}

function buildWorkspaceModeSandbox(templateId) {
  const source = extractWorkspaceModeSource();
  // Deliberately NOT injecting persistActiveView() as a binding: setWorkspaceMode() must never
  // reference it (that call belongs only to the tab onclick handlers, outside this function) -- if
  // the coercion were ever changed to call it, this factory call would throw a ReferenceError,
  // failing this test.
  // eslint-disable-next-line no-new-func
  const factory = new Function(
    'el', 'currentObjectTemplate', 'updateAll', 'requestAnimationFrame',
    `${source}\nreturn { setWorkspaceMode, updateWorkspaceTabAvailability, getWorkspaceMode: () => workspaceMode };`
  );
  const elements = new Map();
  function makeFakeTabElement() {
    const classes = new Set();
    return {
      disabled: false,
      classList: { toggle: (c, on) => { if (on) classes.add(c); else classes.delete(c); }, contains: (c) => classes.has(c) },
      setAttribute() {},
      style: {}
    };
  }
  function el(id) {
    if (!elements.has(id)) elements.set(id, makeFakeTabElement());
    return elements.get(id);
  }
  const updateAllCalls = [];
  const updateAll = (...args) => updateAllCalls.push(args);
  const rafQueue = [];
  const requestAnimationFrame = (cb) => rafQueue.push(cb);
  let currentTemplateId = templateId;
  const currentObjectTemplate = () => ({ id: currentTemplateId });
  const sandbox = factory(el, currentObjectTemplate, updateAll, requestAnimationFrame);
  return { ...sandbox, el, updateAllCalls, rafQueue, setTemplateId: (id) => { currentTemplateId = id; } };
}

await test('8. setWorkspaceMode(): dual under sheet resolves to 2d (dual under mug stays dual); updateWorkspaceTabAvailability() disables both tabs for sheet, re-enables for mug, and never calls updateAll() synchronously', () => {
  const sheetOnly = buildWorkspaceModeSandbox('sheet');
  sheetOnly.setWorkspaceMode('dual');
  assert.equal(sheetOnly.getWorkspaceMode(), '2d');

  const mugOnly = buildWorkspaceModeSandbox('mug');
  mugOnly.setWorkspaceMode('dual');
  assert.equal(mugOnly.getWorkspaceMode(), 'dual');

  const sandbox = buildWorkspaceModeSandbox('mug');
  sandbox.setWorkspaceMode('dual');
  assert.equal(sandbox.getWorkspaceMode(), 'dual', 'sanity: dual under mug stays dual');

  sandbox.setTemplateId('sheet');
  const updateAllCallsBeforeAvailabilityCheck = sandbox.updateAllCalls.length;
  sandbox.updateWorkspaceTabAvailability();
  assert.equal(sandbox.el('viewTabDual').disabled, true);
  assert.equal(sandbox.el('viewTab3D').disabled, true);
  assert.equal(sandbox.getWorkspaceMode(), '2d', 'expected updateWorkspaceTabAvailability() to force the workspace back to 2D once sheet becomes active');
  assert.equal(sandbox.updateAllCalls.length, updateAllCallsBeforeAvailabilityCheck, 'updateAll() must never be called synchronously from inside updateWorkspaceTabAvailability()');
  assert.equal(sandbox.rafQueue.length, 1, 'expected the redraw to be deferred via requestAnimationFrame()');

  sandbox.setTemplateId('mug');
  sandbox.updateWorkspaceTabAvailability();
  assert.equal(sandbox.el('viewTabDual').disabled, false);
  assert.equal(sandbox.el('viewTab3D').disabled, false);
});

// =================================================================================================
// 9. drawCup()
// =================================================================================================

function runDrawCup(templateId) {
  const src = extractLine(appJs, 'function drawCup(){', 'drawCup()');
  const calls = [];
  const project = { cupColor: '#1f3556', canvas: { width: 150, height: 150 }, plate: {}, vessel: {} };
  const preview3D = { update: (...args) => calls.push(['update', ...args]), syncView: (...args) => calls.push(['syncView', ...args]) };
  // eslint-disable-next-line no-new-func
  const factory = new Function('currentObjectTemplate', 'preview3D', 'layout', 'project', 'rotation', 'zoom', `${src}\ndrawCup();`);
  factory(() => ({ id: templateId }), preview3D, {}, project, 0, 1);
  return calls;
}

await test('9. drawCup(): does not call preview3D.update() for sheet; does call it for mug and plate', () => {
  assert.deepEqual(runDrawCup('sheet'), []);
  assert.ok(runDrawCup('mug').some((c) => c[0] === 'update'), 'expected drawCup() to call preview3D.update() for mug');
  assert.ok(runDrawCup('plate').some((c) => c[0] === 'update'), 'expected drawCup() to call preview3D.update() for plate');
});

// =================================================================================================
// 10. isPointerOnFrontViewFrame() / isTextTooLongForObject()
// =================================================================================================

function buildFrontViewAndTooLongSandbox(templateId) {
  const isFlatSrc = extractLine(appJs, 'function isFlatObjectTemplate(t){', 'isFlatObjectTemplate()');
  const frameMatch = appJs.match(/function isPointerOnFrontViewFrame\(mm\)\{[\s\S]*?\n\}/);
  assert.ok(frameMatch, 'expected isPointerOnFrontViewFrame() in app.js');
  const tooLongMatch = appJs.match(/function isTextTooLongForObject\(l\)\{[\s\S]*?\n\}/);
  assert.ok(tooLongMatch, 'expected isTextTooLongForObject() in app.js');
  const throwIfCalled = (name) => () => { throw new Error(`${name} should not be reached for a flat object template`); };
  // eslint-disable-next-line no-new-func
  const factory = new Function(
    'currentObjectTemplate', 'project', 'rotation', 'azimuthRadForCanvasXMm', 'normalizeAngleDeltaRad', 'wrapAngleRad',
    'getLayerBBox', 'printableCircumferenceMm',
    `${isFlatSrc}\n${frameMatch[0]}\n${tooLongMatch[0]}\nreturn { isPointerOnFrontViewFrame, isTextTooLongForObject };`
  );
  return factory(
    () => ({ id: templateId, preview: { kind: templateId } }),
    { canvas: { width: 150, height: 150 }, wrap: 'full' },
    0,
    throwIfCalled('azimuthRadForCanvasXMm'), throwIfCalled('normalizeAngleDeltaRad'), throwIfCalled('wrapAngleRad'),
    throwIfCalled('getLayerBBox'), throwIfCalled('printableCircumferenceMm')
  );
}

await test('10. isPointerOnFrontViewFrame() and isTextTooLongForObject() both return false for sheet, without ever touching frame/circumference geometry', () => {
  const { isPointerOnFrontViewFrame, isTextTooLongForObject } = buildFrontViewAndTooLongSandbox('sheet');
  assert.equal(isPointerOnFrontViewFrame({ x: 0, y: 0 }), false);
  assert.equal(isTextTooLongForObject({ type: 'text', text: 'Hi' }), false);
});

// =================================================================================================
// 11. drawLayout() guide selection
//
// Full drawLayout() draws stones/HUD text/canvas context state unrelated to guide selection and
// would need a large, irrelevant canvas/DOM stub -- so only the actual guide-selection statement
// (the isPlate/isSheet consts plus the if/else-if/else that picks which guide function(s) to call)
// is extracted and executed for real, with the guide-drawing functions themselves replaced by spies.
// =================================================================================================

function extractGuideSelectionSnippet() {
  const startMarker = "const isPlate=currentObjectTemplate().preview.kind==='plate';";
  const endMarker = "else{drawFrontViewFrame(ctx,s,ox,oy,dpr);if(showSafeArea)drawSafeAreaGuide(ctx,s,ox,oy,dpr,getSafeAreaRectMm(currentObjectTemplate(),project.canvas.width,project.canvas.height))}";
  const start = appJs.indexOf(startMarker);
  assert.ok(start !== -1, 'expected drawLayout()\'s guide-selection const isPlate= declaration in app.js');
  const endIdx = appJs.indexOf(endMarker, start);
  assert.ok(endIdx !== -1, 'expected drawLayout()\'s final else branch (Front View Frame + safe-area guide) in app.js');
  return appJs.slice(start, endIdx + endMarker.length);
}

function runGuideSelection(templateKind, showSafeArea) {
  const snippet = extractGuideSelectionSnippet();
  const calls = [];
  // eslint-disable-next-line no-new-func
  const factory = new Function(
    'currentObjectTemplate', 'showSafeArea', 'ctx', 's', 'ox', 'oy', 'dpr', 'project', 'getSafeAreaRectMm',
    'drawPlateDesignTargetGuide', 'drawFrontViewFrame', 'drawSafeAreaGuide',
    `${snippet}\n`
  );
  factory(
    () => ({ preview: { kind: templateKind } }), showSafeArea, {}, 1, 0, 0, 1, { canvas: { width: 150, height: 150 } },
    () => ({ xMm: 0, yMm: 0, widthMm: 1, heightMm: 1 }),
    () => calls.push('plate'), () => calls.push('frame'), () => calls.push('safe')
  );
  return calls;
}

await test('11. drawLayout() guide selection for sheet: draws the safe-area guide, never the Front View Frame or the plate guide', () => {
  assert.deepEqual(runGuideSelection('sheet', true), ['safe']);
  assert.deepEqual(runGuideSelection('sheet', false), [], 'safe-area guide must still respect showSafeArea for sheet');
  assert.deepEqual(runGuideSelection('plate', true), ['plate'], 'sanity: plate is unaffected');
  assert.deepEqual(runGuideSelection('mug', true), ['frame', 'safe'], 'sanity: every other template is unaffected');
});

// =================================================================================================
// 12. Production Sheet fit boundary
// =================================================================================================

function makeEightColorThreeSizeLayout() {
  const colors = ['jet', 'siam', 'light-siam', 'rose', 'fuchsia', 'amethyst', 'sapphire', 'light-sapphire'];
  const sizes = [2, 2.8, 3.4];
  const stones = [];
  let index = 0;
  for (const color of colors) {
    for (const sizeMm of sizes) {
      stones.push(new Stone({ layerId: 'layer-1', index: index++, xMm: 5 + index, yMm: 5 + index, sizeMm, color }));
    }
  }
  return new StoneLayout({ layerId: 'layer-1', stones });
}

function productionSheetOptionsFor(widthMm, heightMm, pageSize) {
  return {
    projectName: 'RS-3037 Flat Sheet', objectType: 'Flat Sheet',
    productionWidthMm: widthMm, productionHeightMm: heightMm,
    pageSize, marginMm: 10, mirror: true, registrationMarks: true, gapMm: [0.1]
  };
}

await test('12. Production Sheet (8 colours x 3 sizes, mirror+registration marks on, 10mm margin): 150x150 fits A4 and Letter; 158x158 throws a RangeError on Letter', () => {
  const layout = makeEightColorThreeSizeLayout();
  assert.doesNotThrow(() => computeProductionSheetLayout(layout, productionSheetOptionsFor(150, 150, 'A4')));
  assert.doesNotThrow(() => computeProductionSheetLayout(layout, productionSheetOptionsFor(150, 150, 'Letter')));
  assert.throws(() => computeProductionSheetLayout(layout, productionSheetOptionsFor(158, 158, 'Letter')), RangeError);
});

// =================================================================================================
// 13. Image panel "Switch to Flat Sheet" button
// =================================================================================================

await test('13. the switch button\'s click dispatches a real change event on #objectType with value sheet; the button is hidden when sheet is active', () => {
  const src = extractLine(appJs, "el('imageStudioSwitchToSheet').onclick=", "the #imageStudioSwitchToSheet onclick handler");
  const elements = new Map();
  function makeFakeElement() {
    const listeners = {};
    return {
      value: '',
      style: {},
      addEventListener(type, cb) { (listeners[type] = listeners[type] || []).push(cb); },
      dispatchEvent(evt) { (listeners[evt.type] || []).forEach((cb) => cb(evt)); }
    };
  }
  function el(id) {
    if (!elements.has(id)) elements.set(id, makeFakeElement());
    return elements.get(id);
  }
  let changeFired = false;
  let firedValue = null;
  el('objectType').addEventListener('change', () => { changeFired = true; firedValue = el('objectType').value; });

  // eslint-disable-next-line no-new-func
  const factory = new Function('el', 'Event', `${src}\nel('imageStudioSwitchToSheet').onclick();`);
  factory(el, Event);

  assert.ok(changeFired, 'expected clicking the switch button to fire a real change event on #objectType');
  assert.equal(firedValue, 'sheet');

  // Visibility: both toggle sites (updateObjectTemplateDetail()/renderImageStudio()) use the same
  // literal pattern -- a structural check, matching this codebase's convention for this kind of
  // pure DOM-wiring assertion.
  assert.match(appJs, /el\('imageStudioSwitchToSheet'\)\.style\.display=isSheet\?'none':''/);
  assert.match(appJs, /el\('imageStudioSwitchToSheet'\)\.style\.display=currentObjectTemplate\(\)\.id==='sheet'\?'none':''/);
});

// =================================================================================================
// 14. #exportCup / #exportCombined -- no 3D preview to export while Flat Sheet is active
// =================================================================================================

function runExportHandler(id, templateId) {
  const src = extractLine(appJs, `el('${id}').onclick=`, `the #${id} onclick handler`);
  const elements = new Map();
  function el(elId) {
    if (!elements.has(elId)) elements.set(elId, { textContent: '', style: {} });
    return elements.get(elId);
  }
  const exportCanvasCalls = [];
  const exportCanvas = (...args) => exportCanvasCalls.push(args);
  const currentObjectTemplate = () => ({ id: templateId });
  const layout = { layers: [] };
  const cupCanvas = {};
  const composeCombinedPreviewCanvas = () => ({});
  // eslint-disable-next-line no-new-func
  const factory = new Function(
    'el', 'currentObjectTemplate', 'layout', 'exportCanvas', 'cupCanvas', 'composeCombinedPreviewCanvas',
    `${src}\nel('${id}').onclick();`
  );
  factory(el, currentObjectTemplate, layout, exportCanvas, cupCanvas, composeCombinedPreviewCanvas);
  return { exportCanvasCalls, status: el('status').textContent };
}

await test('14. #exportCup/#exportCombined: no-op with a status message under sheet (exportCanvas never called), still export once under mug; both hidden while sheet is active in updateObjectTemplateDetail()', () => {
  for (const id of ['exportCup', 'exportCombined']) {
    const sheetResult = runExportHandler(id, 'sheet');
    assert.equal(sheetResult.exportCanvasCalls.length, 0, `expected #${id} to never call exportCanvas() under Flat Sheet`);
    assert.equal(sheetResult.status, 'Flat Sheet has no 3D preview to export.');

    const mugResult = runExportHandler(id, 'mug');
    assert.equal(mugResult.exportCanvasCalls.length, 1, `expected #${id} to call exportCanvas() exactly once under mug`);
  }

  assert.match(appJs, /el\('exportCup'\)\.style\.display=isSheet\?'none':''/);
  assert.match(appJs, /el\('exportCombined'\)\.style\.display=isSheet\?'none':''/);
});

if (failureCount === 0) {
  console.log('RS-3037 (Flat Sheet) tests passed.');
} else {
  console.error(`RS-3037 (Flat Sheet) tests FAILED (${failureCount} failing assertion(s) above).`);
}
