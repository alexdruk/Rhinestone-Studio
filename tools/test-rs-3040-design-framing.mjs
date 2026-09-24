// RS-3040 -- Design is framed on the sheet: entry and every resync fit the whole sheet in CSS px at
// any devicePixelRatio, the sheet outline and safe-area guide are drawn from the template data the
// 2D canvas uses, and a user's zoom survives a reconcile until the sheet itself changes. See
// docs/specifications/RS-3040-DesignFraming.md.
//
// Same harness as tools/test-img-020-image-stones-in-design.mjs: the real createDrawingTool() under
// loadPaperForNode(), a stubbed canvas for the sprite bake, and real pointer gestures through
// paper.tool.emit(). jsdom lays nothing out, so the canvas's CSS box and devicePixelRatio are stubbed
// per test. The tool's getSheetFraming hook is app.js's real hook, with its real designSheetFraming()
// and designFitNotice(), run through new Function() against a fake #fitNotice.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { assertTestRegistered } from './lib/test-registration-assertions.mjs';
import { loadPaperForNode } from './lib/paper-node-env.mjs';

const paper = await loadPaperForNode();
globalThis.requestAnimationFrame = (fn) => { fn(0); return 0; };
globalThis.cancelAnimationFrame = () => {};

const { createDrawingTool } = await import('../src/drawing/index.js');
const {
  getObjectTemplate, getSafeAreaRectMm, getPlateDefaults, getPlateDesignTargetGuide,
  getVesselDefaults, computeCanvasFromVessel, getSheetDefaults
} = await import('../src/products/index.js');

const realCreateElement = self.document.createElement.bind(self.document);
const fakeCanvas = () => {
  const ctx = new Proxy(
    { createRadialGradient: () => ({ addColorStop() {} }), createLinearGradient: () => ({ addColorStop() {} }) },
    { get: (o, p) => (p in o ? o[p] : () => {}), set: (o, p, v) => { o[p] = v; return true; } },
  );
  return { width: 0, height: 0, getContext: () => ctx };
};
globalThis.document = new Proxy(self.document, {
  get(target, prop) {
    if (prop === 'createElement') {
      return (tag) => (String(tag).toLowerCase() === 'canvas' ? fakeCanvas() : realCreateElement(tag));
    }
    const value = target[prop];
    return typeof value === 'function' ? value.bind(target) : value;
  },
});

const canvas = self.document.createElement('canvas');
self.document.body.appendChild(canvas);
let cssBox = null;
canvas.getBoundingClientRect = () => (cssBox
  ? { x: 0, y: 0, left: 0, top: 0, width: cssBox.width, height: cssBox.height, right: cssBox.width, bottom: cssBox.height }
  : { x: 0, y: 0, left: 0, top: 0, width: 0, height: 0, right: 0, bottom: 0 });

// A browser at `dpr`: CSS box w x h, backing store w*dpr x h*dpr (app.js's resizeCanvas() convention).
function setScreen(width, height, dpr) {
  cssBox = { width, height };
  globalThis.devicePixelRatio = dpr;
  canvas.width = width * dpr;
  canvas.height = height * dpr;
}

let passed = 0;
let failed = 0;
async function runTest(name, fn) {
  try { await fn(); console.log(`✓ ${name}`); passed += 1; }
  catch (error) { console.error(`✗ ${name}`); console.error(error); failed += 1; process.exitCode = 1; }
}

// ---------------------------------------------------------------------------------------------
// app.js's real getSheetFraming hook, designSheetFraming() and designFitNotice(), against the real
// product helpers, a mutable fake project and showSafeArea, and a fake #fitNotice.
// ---------------------------------------------------------------------------------------------
const appJs = readFileSync(new URL('../app.js', import.meta.url), 'utf8');
function sliceLine(marker) {
  const start = appJs.indexOf(marker);
  assert.ok(start >= 0, `app.js must contain ${marker}`);
  return appJs.slice(start, appJs.indexOf('\n', start));
}
const framingSrc = sliceLine('function designSheetFraming(){');
const noticeSrc = sliceLine('function designFitNotice(framing){');
const hookSrc = sliceLine('  getSheetFraming:()=>').trim().slice('getSheetFraming:'.length);
let fakeProject = null;
let fakeShowSafeArea = true;
const fitNotice = { textContent: '2D text' };
const appHook = new Function(
  'currentObjectTemplate', 'getSafeAreaRectMm', 'getPlateDesignTargetGuide', 'getProject', 'getShowSafeArea', 'el',
  `return () => { const project = getProject(); const showSafeArea = getShowSafeArea(); ${framingSrc}\n${noticeSrc}\nreturn (${hookSrc})(); };`
)(() => getObjectTemplate(fakeProject.product), getSafeAreaRectMm, getPlateDesignTargetGuide, () => fakeProject, () => fakeShowSafeArea,
  (id) => { assert.equal(id, 'fitNotice', `the hook may only touch #fitNotice, not #${id}`); return fitNotice; });

const SHEET = () => ({ product: 'sheet', canvas: { width: getSheetDefaults().widthMm, height: getSheetDefaults().heightMm } });
const MUG = () => ({ product: 'mug', canvas: computeCanvasFromVessel(getVesselDefaults('mug')) });
const PLATE = (designTarget = getPlateDefaults().designTarget) => {
  const plate = { ...getPlateDefaults(), designTarget };
  return { product: 'plate', plate, canvas: { width: plate.outerDiameterMm, height: plate.outerDiameterMm } };
};

let framingOn = true;
let committed = 0;
let selectionEvents = [];
const tool = createDrawingTool(canvas, {
  getLayerStoneParams: () => null,
  generatePathLayout: () => [],
  resolveShapeLibraryPolygons: () => null,
  resolveSvgPolygons: () => null,
  onShapeCommitted: () => { committed += 1; },
  onSelectionChanged: (ids) => { selectionEvents.push(ids); },
  getImageLayerStones: (id) => (id === 'I' ? IMAGE_STONES : []),
  getSheetFraming: () => (framingOn ? appHook() : null),
});

const PADDING_CSS_PX = 38;
const near = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps;
const view = () => paper.view;
const guides = () => tool.debugSheetGuides;
const guideBounds = (role) => {
  const item = guides().items.find((g) => g.role === role);
  assert.ok(item, `expected a "${role}" guide`);
  return item.bounds;
};
const assertBox = (actual, expected, label) => {
  assert.equal(actual.length, 4);
  for (let i = 0; i < 4; i += 1) assert.ok(near(actual[i], expected[i], 1e-6), `${label}: ${JSON.stringify(actual)} vs ${JSON.stringify(expected)}`);
};

function enterWith(project, { width = 600, height = 400, dpr = 1 } = {}) {
  if (tool.isActive) tool.exit();
  fakeProject = project;
  setScreen(width, height, dpr);
  tool.enter({ width: project.canvas.width, height: project.canvas.height }, PADDING_CSS_PX, 'select');
}

function toolEvent(type, x, y, lastX, lastY, modifiers = {}) {
  const point = new paper.Point(x, y);
  const last = new paper.Point(lastX ?? x, lastY ?? y);
  return {
    type, point, lastPoint: last, downPoint: point,
    delta: point.subtract(last), modifiers, event: {},
    stopPropagation() {}, preventDefault() {},
  };
}
const emit = (name, x, y, lx, ly, modifiers) => paper.tool.emit(name, toolEvent(name, x, y, lx, ly, modifiers));

const IMAGE = { id: 'I', type: 'image', visible: true, x: 40, y: 40, w: 60, h: 50, rotationDeg: 0, stoneSize: 2, gap: 0.3, color: 'gold' };
const RECT = { id: 'R', type: 'rectangle', visible: true, x: 20, y: 100, w: 30, h: 20, rotationDeg: 0, stoneSize: 2, gap: 0.3, color: 'gold' };
const IMAGE_STONES = [
  { x: 45, y: 45, d: 2, color: 'gold' }, { x: 50, y: 45, d: 2, color: 'jet' }, { x: 55, y: 60, d: 2, color: 'gold' },
];

// ---------------------------------------------------------------------------------------------
// T1 -- D1: the fit is in CSS px, identical at DPR 1 and 2, and shows the whole sheet.
// ---------------------------------------------------------------------------------------------
await runTest('T1. Design entry and resize fit the whole sheet plus 38 CSS px at DPR 1 and 2, with the same zoom', () => {
  const cases = [
    { project: SHEET(), width: 600, height: 400, zoom: 324 / 150 },
    { project: MUG(), width: 600, height: 400, zoom: 524 / MUG().canvas.width },
  ];
  for (const { project, width, height, zoom } of cases) {
    for (const dpr of [1, 2]) {
      enterWith(project, { width, height, dpr });
      const W = project.canvas.width, H = project.canvas.height;
      const label = `${project.product} at DPR ${dpr}`;
      assert.ok(near(view().zoom, zoom), `${label}: zoom ${view().zoom}, expected ${zoom}`);
      assert.ok(near(view().center.x, W / 2) && near(view().center.y, H / 2), `${label}: centre`);
      const b = view().bounds;
      assert.ok(b.x <= 0 && b.y <= 0 && b.x + b.width >= W && b.y + b.height >= H, `${label}: sheet not fully visible (${b})`);
      const marginPx = Math.min(-b.x, -b.y) * view().zoom;
      assert.ok(near(marginPx, PADDING_CSS_PX, 1e-6), `${label}: tight margin ${marginPx} px`);
      tool.resize(PADDING_CSS_PX);
      assert.ok(near(view().zoom, zoom), `${label}: zoom after resize ${view().zoom}`);
    }
  }
  // No laid-out box (jsdom, or a hidden canvas): falls back to the backing size divided by DPR.
  if (tool.isActive) tool.exit();
  cssBox = null;
  globalThis.devicePixelRatio = 2;
  canvas.width = 1200; canvas.height = 800;
  fakeProject = SHEET();
  tool.enter({ width: 150, height: 150 }, PADDING_CSS_PX, 'select');
  assert.ok(near(view().zoom, 324 / 150), `fallback zoom ${view().zoom}`);

  // app.js passes the margin in CSS px at every call site, never scaled by devicePixelRatio.
  assert.ok(appJs.includes('drawingTool.enter({width:project.canvas.width,height:project.canvas.height},38,mode);'), 'enter() gets 38 CSS px');
  assert.ok(appJs.includes('renderLayerUI();if(drawingTool.isActive){drawingTool.resize(38);'), 'updateAll() resizes with 38 CSS px');
  assert.ok(!/drawingTool\.(enter|resize)\([^;]*devicePixelRatio/.test(appJs), 'no Design call site scales the margin by devicePixelRatio');
});

// ---------------------------------------------------------------------------------------------
// T2 -- D2: guides for Flat Sheet, Mug and Plate, from designSheetFraming(), on their own layer.
// ---------------------------------------------------------------------------------------------
await runTest('T2. the sheet outline and safe-area guide have the template geometry, beneath every shape', () => {
  fakeShowSafeArea = true;
  enterWith(SHEET());
  tool.syncFromProjectLayers([IMAGE, RECT]);
  assert.deepEqual(guides().items.map((g) => [g.role, g.dashed, g.strokeScaling]), [['sheet', false, false], ['safeArea', true, false]]);
  assertBox(guideBounds('sheet'), [0, 0, 150, 150], 'sheet outline');
  assertBox(guideBounds('safeArea'), [10, 10, 130, 130], 'sheet safe area');
  const order = guides();
  assert.ok(order.gridLayerIndex < order.layerIndex && order.layerIndex < order.contentLayerIndex,
    `layer order grid ${order.gridLayerIndex} < guides ${order.layerIndex} < content ${order.contentLayerIndex}`);
  assert.equal(order.locked, true);
  assert.equal(tool.debugGrid.activeLayerIsContentLayer, true, 'the content layer stays active');

  const mug = MUG();
  enterWith(mug);
  const W = mug.canvas.width, H = mug.canvas.height;
  const safe = getSafeAreaRectMm(getObjectTemplate('mug'), W, H);
  assertBox(guideBounds('sheet'), [0, 0, W, H], 'mug outline');
  assertBox(guideBounds('safeArea'), [14, 10, W - 28, H - 20], 'mug safe area');
  assertBox(guideBounds('safeArea'), [safe.xMm, safe.yMm, safe.widthMm, safe.heightMm], 'mug safe area vs getSafeAreaRectMm');

  fakeShowSafeArea = false;
  tool.resize(PADDING_CSS_PX);
  assert.deepEqual(guides().items.map((g) => g.role), ['sheet'], 'the Settings toggle hides the safe-area guide');
  fakeShowSafeArea = true;
  const applySrc = appJs.slice(appJs.indexOf("el('settingsApply').onclick=()=>{"), appJs.indexOf('};', appJs.indexOf("el('settingsApply').onclick=()=>{")));
  assert.ok(applySrc.includes('if(drawingTool.isActive)drawingTool.resize(38);'), 'Settings Apply refreshes the guides while Design is open');

  // A plate draws exactly the 2D canvas's circles (PlateGuides.js), no rectangle: 270 mm plate,
  // 195 mm well, centred at (135, 135).
  const PLATE_CASES = {
    centerWell: [['plateTarget', false, [37.5, 37.5, 195, 195]]],
    fullTopSurface: [['plateTarget', false, [0, 0, 270, 270]], ['plateTransition', true, [37.5, 37.5, 195, 195]]],
    rimBand: [['plateOuter', false, [0, 0, 270, 270]], ['plateInner', false, [37.5, 37.5, 195, 195]]],
  };
  for (const [target, expected] of Object.entries(PLATE_CASES)) {
    enterWith(PLATE(target));
    const items = guides().items;
    assert.deepEqual(items.map((x) => [x.role, x.dashed]), expected.map(([role, dashed]) => [role, dashed]), `${target}: guides`);
    expected.forEach(([role, , box]) => assertBox(guideBounds(role), box, `${target} ${role}`));
    assert.ok(items.every((x) => x.strokeScaling === false), `${target}: screen-px strokes`);
  }
});

// ---------------------------------------------------------------------------------------------
// T3 -- D2: guides are not shapes: no hit, no selection, no commit, no stones, not in any export.
// ---------------------------------------------------------------------------------------------
await runTest('T3. guides are excluded from hit-testing, selection, shapes, stone counts and exports', () => {
  enterWith(SHEET());
  committed = 0;
  tool.syncFromProjectLayers([IMAGE, RECT]);
  const shapesBefore = tool.debugShapes.map((s) => s.layerId);
  assert.deepEqual(shapesBefore, ['I', 'R']);
  assert.equal(tool.debugStoneState('I').stoneGroupCount, 3);

  for (const [x, y] of [[0, 75], [150, 30], [10, 75], [75, 140]]) {
    assert.equal(tool.debugHitTestShapeId(x, y), null, `no shape at guide point (${x}, ${y})`);
    const hit = paper.project.hitTest(new paper.Point(x, y), { stroke: true, fill: true, tolerance: 4 / view().zoom });
    assert.ok(!hit || !hit.item.data.sheetGuideRole, `paper.project.hitTest returned a guide at (${x}, ${y})`);
  }

  selectionEvents = [];
  emit('mousedown', 0, 75); emit('mouseup', 0, 75);
  assert.ok(selectionEvents.every((ids) => ids.length === 0), `a click on the outline selected ${JSON.stringify(selectionEvents)}`);

  selectionEvents = [];
  const shift = { shift: true };
  emit('mousedown', -5, -5, -5, -5, shift);
  emit('mousedrag', 155, 155, -5, -5, shift);
  emit('mouseup', 155, 155, 155, 155, shift);
  const last = selectionEvents[selectionEvents.length - 1] || [];
  assert.deepEqual([...last].sort(), ['I', 'R'], `a marquee over the whole sheet selects the two layers only, got ${JSON.stringify(last)}`);

  tool.resize(PADDING_CSS_PX);
  assert.deepEqual(tool.debugShapes.map((s) => s.layerId), shapesBefore, 'guides never become shapes');
  assert.equal(tool.debugStoneState('I').stoneGroupCount, 3, 'guides add no stones');
  assert.equal(committed, 0, 'guides are never committed as layers');

  // Exports and stone counts read the StoneLayout, never Design's Paper.js scene. designSheetFraming
  // is referenced exactly twice in app.js (its definition and the hook), and nothing under src/export
  // mentions a sheet guide.
  assert.equal(appJs.split('designSheetFraming').length - 1, 2, 'designSheetFraming() is used only by the Design hook');
  assert.equal(appJs.split('getSheetFraming').length - 1, 1, 'getSheetFraming is wired only into createDrawingTool()');
});

// ---------------------------------------------------------------------------------------------
// T4 -- D3: a user zoom and pan survive a reconcile, a viewport resize and a guide-only change.
// ---------------------------------------------------------------------------------------------
await runTest('T4. the user zoom and pan survive resize(), a viewport change and a safe-area toggle', () => {
  enterWith(SHEET());
  const baseZoom = view().zoom;
  tool.onWheel({ ctrlKey: true, deltaY: -300, deltaX: 0, preventDefault() {} });
  tool.onWheel({ deltaY: 40, deltaX: 25, preventDefault() {} });
  const zoom = tool.zoom;
  assert.ok(!near(zoom, 1), 'the wheel zoomed');
  const center = [view().center.x, view().center.y];
  assert.ok(!near(center[0], 75) || !near(center[1], 75), 'the wheel panned');

  tool.syncFromProjectLayers([IMAGE, RECT]);
  tool.resize(PADDING_CSS_PX);
  assert.ok(near(tool.zoom, zoom) && near(view().zoom, baseZoom * zoom), `zoom after reconcile ${view().zoom}`);
  assert.ok(near(view().center.x, center[0]) && near(view().center.y, center[1]), 'pan after reconcile');

  fakeShowSafeArea = false;
  tool.resize(PADDING_CSS_PX);
  fakeShowSafeArea = true;
  tool.resize(PADDING_CSS_PX);
  assert.ok(near(tool.zoom, zoom), 'a guide-only change keeps the zoom');
  assert.ok(near(view().center.x, center[0]) && near(view().center.y, center[1]), 'a guide-only change keeps the pan');

  setScreen(800, 500, 2);
  tool.resize(PADDING_CSS_PX);
  assert.ok(near(tool.zoom, zoom), 'a viewport resize keeps the user zoom factor');
  assert.ok(near(view().zoom, (424 / 150) * zoom), `viewport resize re-derives the base scale, zoom ${view().zoom}`);
});

// ---------------------------------------------------------------------------------------------
// T5 -- D3: a template or canvas-size change while Design is open re-fits the new sheet.
// ---------------------------------------------------------------------------------------------
await runTest('T5. a template change and a sheet-size change re-fit, drop the user zoom and move the guides', () => {
  enterWith(SHEET());
  tool.onWheel({ ctrlKey: true, deltaY: -300, deltaX: 0, preventDefault() {} });
  tool.onWheel({ deltaY: 40, deltaX: 25, preventDefault() {} });
  assert.ok(!near(tool.zoom, 1));

  const mug = MUG();
  fakeProject = mug;
  tool.resize(PADDING_CSS_PX);
  const W = mug.canvas.width, H = mug.canvas.height;
  assert.ok(near(tool.zoom, 1), `user zoom dropped, got ${tool.zoom}`);
  assert.ok(near(view().zoom, 524 / W), `mug fit zoom ${view().zoom}`);
  assert.ok(near(view().center.x, W / 2) && near(view().center.y, H / 2), 'centred on the mug sheet');
  assertBox(guideBounds('sheet'), [0, 0, W, H], 'outline follows the template');

  tool.onWheel({ ctrlKey: true, deltaY: -300, deltaX: 0, preventDefault() {} });
  fakeProject = { product: 'sheet', canvas: { width: 200, height: 120 } };
  tool.resize(PADDING_CSS_PX);
  assert.ok(near(tool.zoom, 1), 'a sheet-size change drops the user zoom');
  assert.ok(near(view().zoom, Math.min(524 / 200, 324 / 120)), `200 x 120 fit zoom ${view().zoom}`);
  assert.ok(near(view().center.x, 100) && near(view().center.y, 60), 'centred on the resized sheet');
  assertBox(guideBounds('safeArea'), [10, 10, 180, 100], 'safe area follows the size');
});

// ---------------------------------------------------------------------------------------------
// T6 -- D4: #fitNotice names the current template and only the guides Design draws.
// ---------------------------------------------------------------------------------------------
await runTest('T6. #fitNotice names the current template and the guides Design draws, and follows a template change', () => {
  fakeShowSafeArea = true;
  fitNotice.textContent = 'Drag the amber Front View Frame to rotate the Object Preview.';
  enterWith(MUG());
  assert.equal(fitNotice.textContent, 'Mug: keep stones inside the dashed safe-area guide.');

  fakeProject = SHEET();
  tool.resize(PADDING_CSS_PX);
  assert.equal(fitNotice.textContent, 'Flat Sheet: keep stones inside the dashed safe-area guide.', 'a template change inside Design updates it');

  fakeShowSafeArea = false;
  tool.resize(PADDING_CSS_PX);
  assert.equal(fitNotice.textContent, 'Flat Sheet: keep stones inside the sheet outline.', 'no safe-area guide, no mention of one');
  fakeShowSafeArea = true;

  const expectedPlate = { centerWell: 'Center Well', fullTopSurface: 'Full Top Surface', rimBand: 'Rim Band' };
  for (const [target, label] of Object.entries(expectedPlate)) {
    fakeProject = PLATE(target);
    tool.resize(PADDING_CSS_PX);
    assert.equal(fitNotice.textContent, `Round Dinner Plate: keep stones inside the blue ${label} guide.`, target);
  }
  for (const text of [fitNotice.textContent, 'Mug: keep stones inside the dashed safe-area guide.']) {
    assert.ok(!/Front View|amber|drag to move/i.test(text), `mentions something Design does not draw: ${text}`);
  }
  assert.equal(appJs.split('designFitNotice').length - 1, 2, 'designFitNotice() is used only by the Design hook');
});

assertTestRegistered({ filename: 'test-rs-3040-design-framing.mjs', group: 'editing', includedInDefault: true });

console.log(`\n${passed} passed, ${failed} failed`);
