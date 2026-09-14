// RS-3012 Step 5 -- 'rectangle' layers join Design's Select (full click / drag / resize / rotate,
// NO new interaction machinery). 'rectangle' is a first-class layer type (SUPPORTED_LAYER_TYPES /
// XYWH_SHAPE_TYPES / VECTOR_FILL_MODE_TYPES, and GeometryEngine's SHAPE_TYPES) that Gallery .rhs
// fixtures build and that occurs across several examples/*.rhs -- it was simply never listed in
// app.js's syncFromProjectLayers() call-site filter, so it was the one layer type still unselectable
// in Design while every layer beside it selected normally.
//
// Real end-to-end execution, same harness/shape as tools/test-rs3012-step4-circle-select.mjs: the
// tool is instantiated headlessly (paper.js's own Node/jsdom headless View, via
// tools/lib/paper-node-env.mjs), real project.layers are synced in, and real paper.Tool mouse events
// drive the select / resize / rotate gestures. One shared tool for the whole file (paper.js's
// `paper.tool` is a singleton); each test re-syncs its own project.layers, which prunes the previous
// test's shapes.
//
// The trap this step guards against (section 2 of the work order): widening the filter WITHOUT a
// materializeForLayer() dispatch branch sends every rectangle into
// materializeShapeLibraryItemFromLayer(), which asks GeometryEngine for a SHAPE_LIBRARY_KINDS
// outline for a kind it does not know. Test 2 proves the dispatch reaches the rectangle proxy
// instead, via a spy on the resolveShapeLibraryPolygons hook.

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertTestRegistered } from './lib/test-registration-assertions.mjs';
import { loadPaperForNode } from './lib/paper-node-env.mjs';
import { validateRhsProject, toAppProjectShape } from '../src/gallery/RhsFixtureBridge.js';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));

// paper.js (and src/drawing/**) must load only AFTER loadPaperForNode() installs the jsdom `self`
// shim -- dynamic import(), same ordering rule as test-rs3012-step4-circle-select.mjs.
const paper = await loadPaperForNode();
globalThis.requestAnimationFrame = (fn) => { fn(0); return 0; };
globalThis.cancelAnimationFrame = () => {};
const { createDrawingTool } = await import('../src/drawing/index.js');

const appJs = await readFile(path.join(repoRoot, 'app.js'), 'utf8');
const fixtureRaw = JSON.parse(
  await readFile(path.join(repoRoot, 'examples', 'mixed-text-rectangle.rhs'), 'utf8'),
);

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
// Spy: records the layer.type of every resolveShapeLibraryPolygons call. A 'rectangle' must NEVER
// appear here -- that would mean materializeForLayer() routed it to the shape-library builder (the
// trap). Returns null, which is enough to prove the spy fired for a genuine shape-library layer.
const shapeLibraryResolveCalls = [];
const tool = createDrawingTool(canvas, {
  onShapeResized: (id, b) => { events.resized = { id, b }; },
  onShapeRotated: (id, deg) => { events.rotated = { id, deg }; },
  onShapeMoved: (id, dx, dy) => { events.moved = { id, dx, dy }; },
  getLayerStoneParams: () => null,
  generatePathLayout: () => [],
  resolveShapeLibraryPolygons: (layer) => { shapeLibraryResolveCalls.push(layer.type); return null; },
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

// updateRotateHandleItem()'s connecting line is the only chrome in this module with a dashArray, so
// counting dashed items is a direct read of "is a rotate handle being drawn right now" (identical
// helper to test-rs3012-step4-circle-select.mjs).
function dashedItemCount() {
  let n = 0;
  for (const layer of paper.project.layers) {
    for (const child of layer.children) {
      if (child.dashArray && child.dashArray.length) n += 1;
    }
  }
  return n;
}

const RECT = { id: 'r1', type: 'rectangle', x: 20, y: 20, w: 40, h: 40, stoneSize: 2, gap: 0.3, color: 'gold', rotationDeg: 0, fillMode: 'outline' };
const rectLayer = (over = {}) => ({ ...RECT, ...over });
const STAR = { id: 's1', type: 'star', x: 120, y: 20, w: 30, h: 30, stoneSize: 2, gap: 0.3, color: 'gold', rotationDeg: 0 };

// ---------------------------------------------------------------------------------------------
// 1. app.js's syncFromProjectLayers() call-site filter admits 'rectangle'
// ---------------------------------------------------------------------------------------------

// Slice the real `l=>...` predicate out of `drawingTool.syncFromProjectLayers(project.layers.filter(
// <predicate>),forceStoneRebuild)` by balancing parens from the `filter(` open-paren.
function extractFilterPredicate() {
  const marker = 'drawingTool.syncFromProjectLayers(project.layers.filter(';
  const start = appJs.indexOf(marker);
  assert.ok(start !== -1, 'expected drawingTool.syncFromProjectLayers(project.layers.filter( in app.js');
  const open = start + marker.length - 1; // index of the filter( open-paren
  let depth = 0;
  for (let i = open; i < appJs.length; i += 1) {
    if (appJs[i] === '(') depth += 1;
    else if (appJs[i] === ')') {
      depth -= 1;
      if (depth === 0) return appJs.slice(open + 1, i);
    }
  }
  throw new Error('unbalanced parens slicing the syncFromProjectLayers filter predicate');
}

test("1. app.js's call-site filter predicate admits 'rectangle' (and still admits the earlier-step types)", () => {
  const predicateSrc = extractFilterPredicate();
  assert.match(predicateSrc, /l\.type===['"]rectangle['"]/, "filter predicate must test l.type==='rectangle'");
  // Execute the real predicate with a stand-in SHAPE_LIBRARY_KINDS so runtime behaviour, not just
  // the source text, is asserted.
  const predicate = new Function('SHAPE_LIBRARY_KINDS', `return (${predicateSrc});`)(
    new Set(['ellipse', 'capsule', 'polygon', 'star', 'heart', 'arrow', 'cross', 'crescent', 'ring', 'shield']),
  );
  assert.equal(predicate({ type: 'rectangle' }), true, 'rectangle passes the filter');
  assert.equal(predicate({ type: 'circle' }), true, 'circle still passes (Step 4 regression)');
  assert.equal(predicate({ type: 'text' }), true, 'text still passes (Step 3 regression)');
  assert.equal(predicate({ type: 'star' }), true, 'SHAPE_LIBRARY_KINDS still passes');
  assert.ok(!predicate({ type: 'grid' }), 'an unknown type is still rejected');
});

// ---------------------------------------------------------------------------------------------
// 2. THE TRAP: materializeForLayer() dispatches 'rectangle' to the rectangle proxy, NOT to
//    materializeShapeLibraryItemFromLayer()
// ---------------------------------------------------------------------------------------------
test('2. syncFromProjectLayers materializes a rectangle proxy and never calls resolveShapeLibraryPolygons for it', () => {
  shapeLibraryResolveCalls.length = 0;
  sync([rectLayer()]);
  const shapes = tool.debugShapes;
  assert.equal(shapes.length, 1, 'one proxy shape materialized for the rectangle');
  assert.equal(shapes[0].layerId, 'r1');
  assert.ok(!shapeLibraryResolveCalls.includes('rectangle'),
    `resolveShapeLibraryPolygons must never be asked for a 'rectangle' outline (got: ${JSON.stringify(shapeLibraryResolveCalls)})`);

  // Contrast: a real SHAPE_LIBRARY_KINDS layer DOES go through resolveShapeLibraryPolygons -- proves
  // the spy actually fires and the dispatch genuinely differs by type.
  shapeLibraryResolveCalls.length = 0;
  sync([STAR]);
  assert.deepEqual(shapeLibraryResolveCalls, ['star'], "a 'star' layer still routes to the shape-library builder");
});

// ---------------------------------------------------------------------------------------------
// 3. The proxy's bounds match the layer's x/y/w/h exactly, pivot = box center
// ---------------------------------------------------------------------------------------------
test('3. the rectangle proxy is the exact x/y/w/h box, pivot on the box center', () => {
  sync([rectLayer()]);
  const s = tool.debugShapes[0];
  assert.ok(Math.abs(s.bounds.left - 20) < 1e-9, `bounds.left = x = 20 (got ${s.bounds.left})`);
  assert.ok(Math.abs(s.bounds.top - 20) < 1e-9, `bounds.top = y = 20 (got ${s.bounds.top})`);
  assert.ok(Math.abs(s.bounds.width - 40) < 1e-9, `bounds.width = w = 40 (got ${s.bounds.width})`);
  assert.ok(Math.abs(s.bounds.height - 40) < 1e-9, `bounds.height = h = 40 (got ${s.bounds.height})`);
  assert.equal(s.rotationDeg, 0, 'an unrotated rectangle stamps rotationDeg 0');
  assert.ok(Math.abs(s.pivotXMm - 40) < 1e-9, 'pivot X = x + w/2 = 40');
  assert.ok(Math.abs(s.pivotYMm - 40) < 1e-9, 'pivot Y = y + h/2 = 40');

  // An Inspector-style edit (x/y/w/h fields) re-syncs the proxy in place through the generic
  // bounds-comparison branch -- no dedicated re-materialize-and-diff branch (unlike text/circle).
  sync([rectLayer({ x: 30, y: 25, w: 100, h: 20 })]);
  const s2 = tool.debugShapes[0];
  assert.ok(Math.abs(s2.bounds.left - 30) < 1e-9, `re-synced bounds.left = 30 (got ${s2.bounds.left})`);
  assert.ok(Math.abs(s2.bounds.width - 100) < 1e-9, `re-synced bounds.width = 100 (got ${s2.bounds.width})`);
  assert.ok(Math.abs(s2.bounds.height - 20) < 1e-9, `re-synced bounds.height = 20 (got ${s2.bounds.height})`);
});

// ---------------------------------------------------------------------------------------------
// 4. rotationDeg is applied by an explicit item.rotate() -- UNLIKE 'text', whose rotationDeg is
//    already baked into its real stone positions by GeometryEngine and must NOT be rotated again
//    (materializeTextItemFromLayer() builds its proxy from already-rotated stones, no item.rotate()).
// ---------------------------------------------------------------------------------------------
test("4. a rotated rectangle's proxy AABB is the item.rotate()-rotated box (not the unrotated one)", () => {
  // x=20 y=15 w=60 h=30 -> center (50,30). A 90deg rotation about that center maps the 60x30 box to
  // a 30x60 AABB still centered on (50,30): left 35, top 0, width 30, height 60.
  sync([rectLayer({ x: 20, y: 15, w: 60, h: 30, rotationDeg: 90 })]);
  const s = tool.debugShapes[0];
  assert.equal(s.rotationDeg, 90, 'item.data.rotationDeg stamped with the applied rotation');
  assert.ok(Math.abs(s.bounds.width - 30) < 1e-6, `rotated AABB width = original height = 30 (got ${s.bounds.width})`);
  assert.ok(Math.abs(s.bounds.height - 60) < 1e-6, `rotated AABB height = original width = 60 (got ${s.bounds.height})`);
  assert.ok(Math.abs((s.bounds.left + s.bounds.width / 2) - 50) < 1e-6, 'rotation pivots about the box center X');
  assert.ok(Math.abs((s.bounds.top + s.bounds.height / 2) - 30) < 1e-6, 'rotation pivots about the box center Y');
});

// ---------------------------------------------------------------------------------------------
// 5. The proxy carries NEITHER noResizeHandles ('text', Step 3) NOR noRotateHandle / isCircleProxy
//    ('circle', Step 4) -- asserted behaviourally: every handle behaves as it does for a plain
//    'path' shape.
// ---------------------------------------------------------------------------------------------
test('5a. NOT noRotateHandle: a selected rectangle draws the dashed rotate-handle line, and the handle grab starts a rotate', () => {
  sync([rectLayer()]);
  tool.selectShapeForLayer('r1');
  assert.equal(dashedItemCount(), 1, 'a rectangle gets a rotate-handle line (a circle would get none)');
  // Box top-center is (40, 20); the rotate handle sits ROTATE_HANDLE_GAP_MM (10) above it.
  emit('mousedown', 40, 10);
  assert.equal(tool.debugInteractionKind, 'rotate', `grabbing the rotate handle starts a 'rotate' (got '${tool.debugInteractionKind}')`);
  emit('mouseup', 40, 10);
});

test("5b. NOT noResizeHandles: grabbing a corner handle starts a 'resize'", () => {
  sync([rectLayer()]);
  tool.selectShapeForLayer('r1');
  // SE corner handle of the 20,20,40,40 box is at (60, 60).
  emit('mousedown', 60, 60);
  assert.equal(tool.debugInteractionKind, 'resize', `a corner-handle grab starts a 'resize' (got '${tool.debugInteractionKind}')`);
  emit('mouseup', 60, 60);
});

test('5c. NOT isCircleProxy: a corner drag is a box-corner resize (opposite corner pinned), not radius-from-center', () => {
  sync([rectLayer()]);
  tool.selectShapeForLayer('r1');
  // Drag the SE handle (60,60) to (80,80). A box resize pins the NW corner (20,20) and reports
  // 60x60. A circle-style radius-from-center resize would instead pin the CENTER and report a
  // square ~2*hypot wide -- a completely different box.
  emit('mousedown', 60, 60);
  emit('mousedrag', 80, 80, 60, 60);
  emit('mouseup', 80, 80, 80, 80);
  const b = events.resized.b;
  assert.ok(Math.abs(b.left - 20) < 1e-6, `NW corner pinned: left still 20 (got ${b.left})`);
  assert.ok(Math.abs(b.top - 20) < 1e-6, `NW corner pinned: top still 20 (got ${b.top})`);
  assert.ok(Math.abs(b.width - 60) < 1e-6, `width = 60 (got ${b.width})`);
  assert.ok(Math.abs(b.height - 60) < 1e-6, `height = 60 (got ${b.height})`);
});

// ---------------------------------------------------------------------------------------------
// 6. A rectangle layer from a real Gallery fixture materializes -- the actual user-reachable path
//    (examples/mixed-text-rectangle.rhs -> RhsFixtureBridge -> app.js layer), not a synthetic layer.
// ---------------------------------------------------------------------------------------------
test("6. examples/mixed-text-rectangle.rhs's rectangle layer materializes a proxy at its fixture x/y/w/h", () => {
  const app = toAppProjectShape(validateRhsProject(fixtureRaw, 'mixed-text-rectangle.rhs'));
  const rect = app.layers.find((l) => l.type === 'rectangle');
  assert.ok(rect, 'the fixture has a rectangle layer');
  assert.ok([rect.x, rect.y, rect.w, rect.h].every((n) => typeof n === 'number' && Number.isFinite(n)),
    'the bridged rectangle layer carries numeric x/y/w/h');

  sync([rect]);
  const s = tool.debugShapes.find((x) => x.layerId === rect.id);
  assert.ok(s, 'the fixture rectangle materialized a Design proxy');
  assert.ok(Math.abs(s.bounds.left - rect.x) < 1e-9, `proxy left = fixture x = ${rect.x} (got ${s.bounds.left})`);
  assert.ok(Math.abs(s.bounds.top - rect.y) < 1e-9, `proxy top = fixture y = ${rect.y} (got ${s.bounds.top})`);
  assert.ok(Math.abs(s.bounds.width - rect.w) < 1e-9, `proxy width = fixture w = ${rect.w} (got ${s.bounds.width})`);
  assert.ok(Math.abs(s.bounds.height - rect.h) < 1e-9, `proxy height = fixture h = ${rect.h} (got ${s.bounds.height})`);
});

// ---------------------------------------------------------------------------------------------
// 7. Registration
// ---------------------------------------------------------------------------------------------
test('7. this test file is registered in its group and the default suite', () => {
  assertTestRegistered({
    filename: 'test-rs3012-step5-rectangle-select.mjs',
    group: 'editing',
    includedInDefault: true,
  });
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exitCode = 1;
