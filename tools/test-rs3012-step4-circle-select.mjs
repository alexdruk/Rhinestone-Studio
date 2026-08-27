// RS-3012 Step 4 -- 'circle' layers join Design's Select (click/drag + radius-from-center resize,
// NO rotate handle). Real end-to-end execution of the new circle-specific logic in
// src/drawing/DrawingCanvasTool.js: the tool is instantiated headlessly (paper.js's own Node/jsdom
// headless View, same tools/lib/paper-node-env.mjs shim tools/test-rs3011-step8-svg-import-
// flattening.mjs already uses), real project.layers are synced in, and real paper.Tool mouse
// events are emitted to drive select / resize / would-be-rotate gestures. No source-text regex
// assertions for the behaviours themselves -- the actual code paths run.
//
// One shared tool for the whole file (paper.js's `paper.tool` is a singleton -- a second
// createDrawingTool()/paper.setup() would leave paper.tool.emit() targeting a stale handler);
// each test re-syncs its own project.layers, which prunes the previous test's shapes.
//
// The app.js half (onShapeResized's circle branch converting the reported bounds back to l.r) is
// extracted from app.js source and executed with fakes, so the DrawingCanvasTool drag result and
// the app.js write-back are verified as one round-trip.

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertTestRegistered } from './lib/test-registration-assertions.mjs';
import { loadPaperForNode } from './lib/paper-node-env.mjs';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));

// paper.js (and src/drawing/**, which imports it) must load only AFTER loadPaperForNode() installs
// the jsdom `self` shim -- dynamic import(), same ordering rule as test-rs3011-step8.
const paper = await loadPaperForNode();
// DrawingCanvasTool schedules its in-drag stone-group rebuild via requestAnimationFrame, which
// Node has no global for -- run the callback synchronously (with the stub hooks below it is a
// no-op anyway: getLayerStoneParams returns null, so no sprite/canvas work happens).
globalThis.requestAnimationFrame = (fn) => { fn(0); return 0; };
globalThis.cancelAnimationFrame = () => {};
const { createDrawingTool } = await import('../src/drawing/index.js');

let passed = 0;
let failed = 0;
function test(name, fn) {
  try {
    fn();
    console.log(`✓ ${name}`);
    passed += 1;
  } catch (error) {
    console.error(`✗ ${name}`);
    console.error(error);
    failed += 1;
    process.exitCode = 1;
  }
}

// ---------------------------------------------------------------------------------------------
// Headless tool harness (one shared instance -- see this file's header comment)
// ---------------------------------------------------------------------------------------------
const canvas = self.document.createElement('canvas');
canvas.width = 1200;
canvas.height = 800;
self.document.body.appendChild(canvas);
const events = { resized: null, rotated: null, moved: null };
const tool = createDrawingTool(canvas, {
  onShapeResized: (id, b) => { events.resized = { id, b }; },
  onShapeRotated: (id, deg) => { events.rotated = { id, deg }; },
  onShapeMoved: (id, dx, dy) => { events.moved = { id, dx, dy }; },
  getLayerStoneParams: () => null,
  generatePathLayout: () => [],
  resolveShapeLibraryPolygons: () => null,
  resolveSvgPolygons: () => null,
  getTextLayerStones: () => [],
});
tool.enter({ width: 210, height: 90 }, 20, 'select');

function toolEvent(type, x, y, lastX, lastY) {
  const point = new paper.Point(x, y);
  const last = new paper.Point(lastX ?? x, lastY ?? y);
  return {
    type, point, lastPoint: last, downPoint: point,
    delta: point.subtract(last), modifiers: {}, event: {},
    stopPropagation() {}, preventDefault() {},
  };
}
const emit = (name, x, y, lx, ly) => paper.tool.emit(name, toolEvent(name, x, y, lx, ly));

function sync(layers) {
  events.resized = null;
  events.rotated = null;
  events.moved = null;
  tool.syncFromProjectLayers(layers);
}

// Count the dashed-stroke items paper.js is currently drawing -- updateRotateHandleItem()'s
// connecting line is the only chrome in this module with a dashArray (resize-handle squares and the
// rotate dot have none), so this is a direct read of "is a rotate handle being drawn right now".
function dashedItemCount() {
  let n = 0;
  for (const layer of paper.project.layers) {
    for (const child of layer.children) {
      if (child.dashArray && child.dashArray.length) n += 1;
    }
  }
  return n;
}

const CIRCLE = { id: 'c1', type: 'circle', cx: 105, cy: 45, r: 18, stoneSize: 2, gap: 0.3, color: 'gold', rotationDeg: 0 };
const circleLayer = (over = {}) => ({ ...CIRCLE, ...over });
const PATH_SQUARE = {
  id: 'p1', type: 'path', x: 20, y: 20, w: 30, h: 30,
  contours: [[{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }]],
  closed: true, stoneSize: 2, gap: 0.3, color: 'gold', rotationDeg: 0,
};

// ---------------------------------------------------------------------------------------------
// 1. Materialization: the proxy is the cx/cy/r box, unrotated, pivoted on the centre
// ---------------------------------------------------------------------------------------------
test('1. syncFromProjectLayers materializes a circle proxy as the exact cx+/-r box, rotationDeg 0, pivot = centre', () => {
  sync([circleLayer()]);
  const shapes = tool.debugShapes;
  assert.equal(shapes.length, 1, 'one proxy shape');
  const s = shapes[0];
  assert.equal(s.layerId, 'c1');
  assert.equal(s.rotationDeg, 0, 'circle proxy is never rotated');
  assert.equal(s.pivotXMm, 105, 'pivot X is the circle centre');
  assert.equal(s.pivotYMm, 45, 'pivot Y is the circle centre');
  assert.ok(Math.abs(s.bounds.left - 87) < 1e-9, `bounds.left = cx-r = 87 (got ${s.bounds.left})`);
  assert.ok(Math.abs(s.bounds.top - 27) < 1e-9, `bounds.top = cy-r = 27 (got ${s.bounds.top})`);
  assert.ok(Math.abs(s.bounds.width - 36) < 1e-9, `bounds.width = 2r = 36 (got ${s.bounds.width})`);
  assert.ok(Math.abs(s.bounds.height - 36) < 1e-9, `bounds.height = 2r = 36 (got ${s.bounds.height})`);
});

test('2. the circle proxy has its own reconciliation branch: editing r / cx / cy re-syncs the proxy in place', () => {
  sync([circleLayer()]);
  // Inspector-style edit: same layer id, new radius, no x/y/w/h fields ever introduced.
  sync([circleLayer({ r: 30 })]);
  const s = tool.debugShapes.find((x) => x.layerId === 'c1');
  assert.ok(Math.abs(s.bounds.left - 75) < 1e-9, `bounds.left = 105-30 = 75 (got ${s.bounds.left})`);
  assert.ok(Math.abs(s.bounds.width - 60) < 1e-9, `bounds.width = 60 (got ${s.bounds.width})`);
  // ...and a move (cx/cy) too.
  sync([circleLayer({ r: 30, cx: 150, cy: 60 })]);
  const s2 = tool.debugShapes.find((x) => x.layerId === 'c1');
  assert.ok(Math.abs(s2.bounds.left - 120) < 1e-9, `bounds.left = 150-30 = 120 (got ${s2.bounds.left})`);
  assert.ok(Math.abs(s2.bounds.top - 30) < 1e-9, `bounds.top = 60-30 = 30 (got ${s2.bounds.top})`);
});

// ---------------------------------------------------------------------------------------------
// 3. NO rotate handle -- hitTestRotateHandle() returns false, updateRotateHandleItem() no-ops
// ---------------------------------------------------------------------------------------------
test('3a. updateRotateHandleItem() draws no rotate-handle chrome for a selected circle (a path shape does)', () => {
  sync([circleLayer()]);
  tool.selectShapeForLayer('c1');
  assert.equal(dashedItemCount(), 0, 'no dashed rotate-handle line for a circle');

  // Contrast: a plain path shape selected the same way DOES get the rotate handle drawn.
  sync([PATH_SQUARE]);
  tool.selectShapeForLayer('p1');
  assert.equal(dashedItemCount(), 1, 'a path shape still gets its rotate-handle line');
});

test('3b. hitTestRotateHandle() returns false for a circle: mousedown where the handle would be never starts a rotate', () => {
  sync([circleLayer()]);
  tool.selectShapeForLayer('c1');
  // ROTATE_HANDLE_GAP_MM (10) above the proxy's top-centre: (105, 27-10) = (105, 17).
  emit('mousedown', 105, 17);
  assert.notEqual(tool.debugInteractionKind, 'rotate', `must not be 'rotate' (got '${tool.debugInteractionKind}')`);
  emit('mouseup', 105, 17);
  assert.equal(events.rotated, null, 'onShapeRotated never fired');

  // Contrast: the identical gesture on a path shape DOES start a rotate.
  sync([PATH_SQUARE]);
  tool.selectShapeForLayer('p1');
  const pb = tool.debugShapes.find((s) => s.layerId === 'p1').bounds;
  emit('mousedown', pb.left + pb.width / 2, pb.top - 10);
  assert.equal(tool.debugInteractionKind, 'rotate', 'a path shape DOES start a rotate from the same spot');
  emit('mouseup', pb.left + pb.width / 2, pb.top - 10);
});

// ---------------------------------------------------------------------------------------------
// 4. Radius-from-centre resize -- any handle, centre stays pinned, r = |pointer - centre|
// ---------------------------------------------------------------------------------------------
function dragResize(handleXY, toXY) {
  tool.selectShapeForLayer('c1');
  emit('mousedown', handleXY[0], handleXY[1]);
  assert.equal(tool.debugInteractionKind, 'resize', 'a handle grab starts a resize');
  emit('mousedrag', toXY[0], toXY[1], handleXY[0], handleXY[1]);
  emit('mouseup', toXY[0], toXY[1], toXY[0], toXY[1]);
  return events.resized;
}

test('4a. dragging the SE handle sets r to the pointer distance from the (pinned) centre', () => {
  sync([circleLayer()]);
  // SE handle of the cx/cy/r box is at (123, 63). Drag to (135, 75): dist from centre (105,45) is
  // hypot(30,30). Both target coords are on the 5mm snap grid so no snap perturbs the result.
  const r = dragResize([123, 63], [135, 75]);
  const expectedR = Math.hypot(30, 30);
  assert.ok(Math.abs(r.b.width - expectedR * 2) < 1e-6, `reported bounds width = 2r = ${expectedR * 2} (got ${r.b.width})`);
  assert.ok(Math.abs(r.b.height - expectedR * 2) < 1e-6, `reported bounds height = 2r (got ${r.b.height})`);
  // Centre pinned: the reported box is still centred on (105, 45).
  assert.ok(Math.abs((r.b.left + r.b.width / 2) - 105) < 1e-6, `box centre X still 105 (got ${r.b.left + r.b.width / 2})`);
  assert.ok(Math.abs((r.b.top + r.b.height / 2) - 45) < 1e-6, `box centre Y still 45 (got ${r.b.top + r.b.height / 2})`);
});

test('4b. the NW handle drives the same radius-from-centre formula (no per-handle axis)', () => {
  sync([circleLayer()]);
  // NW handle is at (87, 27). Drag to (75, 25): dist from centre (105,45) is hypot(30,20).
  const r = dragResize([87, 27], [75, 25]);
  const expectedR = Math.hypot(105 - 75, 45 - 25);
  assert.ok(Math.abs(r.b.width - expectedR * 2) < 1e-6, `NW-drag radius = ${expectedR} (got width ${r.b.width})`);
  assert.ok(Math.abs((r.b.left + r.b.width / 2) - 105) < 1e-6, 'centre X pinned on an NW drag');
  assert.ok(Math.abs((r.b.top + r.b.height / 2) - 45) < 1e-6, 'centre Y pinned on an NW drag');
});

test('4c. dragging the handle toward the centre shrinks r, clamped at a 2mm radius floor', () => {
  sync([circleLayer()]);
  // Drop the pointer 1mm off the centre -> hypot ~1 -> clamped up to the 2mm floor.
  const r = dragResize([123, 63], [106, 45]);
  assert.ok(Math.abs(r.b.width - 4) < 1e-6, `radius clamped to 2mm -> width 4 (got ${r.b.width})`);
});

test('4d. the live proxy tracks the resize frame-by-frame (debugShapes bounds follow the drag)', () => {
  sync([circleLayer()]);
  tool.selectShapeForLayer('c1');
  emit('mousedown', 123, 63);
  emit('mousedrag', 145, 45, 123, 63); // pointer 40mm due-east of centre -> r 40
  const live = tool.debugShapes.find((s) => s.layerId === 'c1').bounds;
  assert.ok(Math.abs(live.width - 80) < 1e-6, `live proxy width = 2*40 = 80 (got ${live.width})`);
  assert.ok(Math.abs((live.left + live.width / 2) - 105) < 1e-6, 'live proxy still centred on 105');
  emit('mouseup', 145, 45, 145, 45);
});

// ---------------------------------------------------------------------------------------------
// 5. Round-trip with app.js: onShapeResized's circle branch turns the reported bounds back into l.r
// ---------------------------------------------------------------------------------------------
const appJs = await readFile(path.join(repoRoot, 'app.js'), 'utf8');

function extractArrow(source, startMarker, label) {
  const start = source.indexOf(startMarker);
  assert.ok(start !== -1, `expected to find "${startMarker}" (${label}) in app.js`);
  const braceStart = source.indexOf('{', start + startMarker.length - 1);
  let depth = 0;
  for (let i = braceStart; i < source.length; i += 1) {
    if (source[i] === '{') depth += 1;
    else if (source[i] === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(start, i + 1);
    }
  }
  throw new Error(`unbalanced braces slicing "${startMarker}" (${label})`);
}

test('5. app.js onShapeResized converts the DrawingCanvasTool circle-resize bounds back to l.r (Math.max(2, width/2)), leaving cx/cy', () => {
  // Run a real headless resize, capture the exact bounds DrawingCanvasTool reports.
  sync([circleLayer()]);
  dragResize([123, 63], [135, 75]);
  const reported = events.resized.b;

  // Execute app.js's real onShapeResized arrow with fakes for its outer-scope collaborators.
  const arrowSrc = extractArrow(appJs, 'onShapeResized:(layerId,boundsMm)=>{', 'onShapeResized');
  const bodySrc = arrowSrc.slice(arrowSrc.indexOf('=>') + 2);
  const layer = { id: 'c1', type: 'circle', cx: 105, cy: 45, r: 18 };
  let updateAllCalled = 0;
  const onShapeResized = new Function(
    'project', 'commitHistory', 'updateAll',
    `return (layerId,boundsMm)=>${bodySrc}`,
  )({ layers: [layer] }, () => {}, () => { updateAllCalled += 1; });

  onShapeResized('c1', reported);
  const expectedR = Math.hypot(30, 30);
  assert.ok(Math.abs(layer.r - expectedR) < 1e-6, `l.r = ${expectedR} (got ${layer.r})`);
  assert.equal(layer.cx, 105, 'cx untouched by a resize');
  assert.equal(layer.cy, 45, 'cy untouched by a resize');
  assert.equal(layer.x, undefined, 'no x field introduced on a circle layer');
  assert.equal(layer.w, undefined, 'no w field introduced on a circle layer');
  assert.equal(updateAllCalled, 1, 'onShapeResized runs exactly one updateAll(true)');
});

// ---------------------------------------------------------------------------------------------
// 6. Registration
// ---------------------------------------------------------------------------------------------
test('6. this test file is registered in its group and the default suite', () => {
  assertTestRegistered({
    filename: 'test-rs3012-step4-circle-select.mjs',
    group: 'editing',
    includedInDefault: true,
  });
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exitCode = 1;
