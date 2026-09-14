// MAINT-003 -- layer-in / proxy-out contract coverage for the SIX materializer functions in
// src/drawing/DrawingCanvasTool.js:
//
//   materializeShapeFromLayer            ('path')
//   materializeShapeLibraryItemFromLayer (a SHAPE_LIBRARY_KINDS kind: star/heart/ring/...)
//   materializeSvgImageItemFromLayer     ('svg', 'image')
//   buildRectangleProxyItem              ('rectangle', + the svg/image rectangle fallback)
//   materializeTextItemFromLayer         ('text')
//   materializeCircleItemFromLayer       ('circle')
//
// Before this milestone only two of the six (circle via test-rs3012-step4, rectangle via
// test-rs3012-step5) had any committed coverage. In particular the single highest-value invariant
// in the file -- materializeTextItemFromLayer() must NOT re-rotate its proxy, because
// GeometryEngine.generateTextLayout() already bakes rotationDeg into the stone positions
// (docs/ARCHITECTURE.md "Selection beyond shapes (RS-3012)" Step 3) -- had zero tests, and the
// Step 5 refactor that extracted buildRectangleProxyItem() from the shared svg/image fallback was
// verified only by reading the old and new source side by side.
//
// SCOPE. This file covers the materializer layer only -- near-pure layer-in / proxy-out functions.
// It does NOT touch the interaction layer (Pen, Eraser, mode-toggle, grid autoscale, RS-3013
// region gestures, the drag state machine); docs/ARCHITECTURE.md's "Known test-coverage gap" note
// deliberately declines those and this milestone does not overturn that judgment. See
// docs/specifications/MAINT-003-MaterializerContractCoverage.md.
//
// The materializers are module-private and the type -> materializer dispatch is itself part of the
// contract, so every proxy here is driven through the REAL syncFromProjectLayers() (real
// createDrawingTool, real paper.js headless View via tools/lib/paper-node-env.mjs), never by
// calling a materializer directly -- the same harness shape as
// tools/test-rs3012-step4-circle-select.mjs / tools/test-rs3012-step5-rectangle-select.mjs. Real
// Gallery .rhs fixtures (examples/*.rhs via validateRhsProject / toAppProjectShape) supply every
// layer a fixture carries that type; only 'star' (no SHAPE_LIBRARY_KINDS fixture exists) falls
// back to a synthetic layer.

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertTestRegistered } from './lib/test-registration-assertions.mjs';
import { loadPaperForNode } from './lib/paper-node-env.mjs';
import { validateRhsProject, toAppProjectShape } from '../src/gallery/RhsFixtureBridge.js';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));

// paper.js (and src/drawing/**) must load only AFTER loadPaperForNode() installs the jsdom `self`
// shim -- dynamic import(), same ordering rule as the step4/step5 tests.
const paper = await loadPaperForNode();
globalThis.requestAnimationFrame = (fn) => { fn(0); return 0; };
globalThis.cancelAnimationFrame = () => {};
const { createDrawingTool } = await import('../src/drawing/index.js');

// ---------------------------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------------------------
async function loadFixtureLayers(file) {
  const raw = JSON.parse(await readFile(path.join(repoRoot, 'examples', file), 'utf8'));
  return toAppProjectShape(validateRhsProject(raw, file)).layers;
}
const pathLayer = (await loadFixtureLayers('boolean-union-badge.rhs')).find((l) => l.type === 'path');
const rectLayer = (await loadFixtureLayers('rectangle-only.rhs')).find((l) => l.type === 'rectangle');
const circleLayer = (await loadFixtureLayers('circle-only.rhs')).find((l) => l.type === 'circle');
const textLayer = (await loadFixtureLayers('short-name-block.rhs')).find((l) => l.type === 'text');
const svgLayer = (await loadFixtureLayers('svg-logo-import.rhs')).find((l) => l.type === 'svg');
const imageLayer = (await loadFixtureLayers('image-trace-monogram.rhs')).find((l) => l.type === 'image');
// No examples/*.rhs carries a SHAPE_LIBRARY_KINDS layer (RhsFixtureBridge's SUPPORTED_LAYER_TYPES
// stops at text/circle/rectangle/svg/image/path), so 'star' is the one synthetic layer here. Its
// x/y/w/h box model is exactly what app.js's live-editor schema stores for every "More Shapes"
// shape (see app.js's SHAPE_LAYER_TYPES / XYWH_SHAPE_TYPES).
const starLayer = {
  id: 'star-syn', type: 'star', visible: true,
  x: 120, y: 20, w: 40, h: 30,
  stoneSize: 2, gap: 0.3, color: 'gold',
};

const withField = (layer, over) => ({ ...layer, ...over });

// ---------------------------------------------------------------------------------------------
// Headless tool harness (one shared instance -- paper.tool is a singleton; each sync() re-syncs
// its own layers, which prunes the previous test's shapes)
// ---------------------------------------------------------------------------------------------
const canvas = self.document.createElement('canvas');
canvas.width = 1200;
canvas.height = 800;
self.document.body.appendChild(canvas);

// From here on, every document.createElement('canvas') is StoneSpriteCache.js's offscreen sprite
// bake (rebuildTextStoneGroupForShape() -> buildStoneSpriteGroup(), unconditional for a text proxy
// with stones). jsdom has no 2D context without the native `canvas` package, so hand those a
// dependency-free fake -- same stub convention as tools/test-stone-sprite-cache.mjs /
// tools/test-crystal-stone-renderer.mjs. The sprite group is decorative here and never asserted.
// StoneSpriteCache.js reaches for a bare `document` (not `self.document`), which the
// paper-node-env shim never defines -- provide one that returns the fake for a canvas and
// delegates everything else to jsdom.
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

// Every injected hook records each call as [hookName, ...args-of-interest] so one DISPATCH
// assertion can read the whole picture: which materializer a layer type reached is observable
// purely through which resolver hook it did (or did not) call.
let hookCalls = [];
// Mutable per-test: what the polygon resolvers hand back. `null` exercises the svg/image
// rectangle fallback; a box polygon exercises the real-outline branch.
let svgPolygonsReturn = null;
let shapeLibraryPolygonsReturn = null;
let textStonesReturn = [];

const boxPolygons = (x, y, w, h) => [[
  { xMm: x, yMm: y }, { xMm: x + w, yMm: y }, { xMm: x + w, yMm: y + h }, { xMm: x, yMm: y + h },
]];

const tool = createDrawingTool(canvas, {
  onShapeResized: () => {},
  onShapeRotated: () => {},
  onShapeMoved: () => {},
  getLayerStoneParams: (id) => { hookCalls.push(['getLayerStoneParams', id]); return null; },
  generatePathLayout: (params) => { hookCalls.push(['generatePathLayout', params && params.layerId]); return []; },
  resolveShapeLibraryPolygons: (layer) => {
    hookCalls.push(['resolveShapeLibraryPolygons', layer.type]);
    return shapeLibraryPolygonsReturn;
  },
  resolveSvgPolygons: (layer) => {
    hookCalls.push(['resolveSvgPolygons', layer.type]);
    return svgPolygonsReturn;
  },
  getTextLayerStones: (id) => { hookCalls.push(['getTextLayerStones', id]); return textStonesReturn; },
});
tool.enter({ width: 210, height: 90 }, 20, 'select');

function sync(layers) {
  hookCalls = [];
  tool.syncFromProjectLayers(layers);
}
const hookNamesCalled = () => [...new Set(hookCalls.map((c) => c[0]))];
const proxyFor = (layerId) => tool.debugShapes.find((s) => s.layerId === layerId) || null;

// The materializers stamp their interaction-flag decisions on item.data, which debugShapes does
// not surface. Walk the live paper scene for the proxy item (only the proxy carries data.layerId;
// stone-dot sprites and resize/rotate chrome do not) and read them straight off.
function proxyDataFlags(layerId) {
  let found = null;
  const walk = (item) => {
    if (found) return;
    if (item.data && item.data.layerId === layerId) { found = item; return; }
    if (item.children) item.children.forEach(walk);
  };
  paper.project.layers.forEach(walk);
  assert.ok(found, `expected a live proxy item for layer "${layerId}"`);
  return {
    noResizeHandles: Boolean(found.data.noResizeHandles),
    noRotateHandle: Boolean(found.data.noRotateHandle),
    isCircleProxy: Boolean(found.data.isCircleProxy),
    isTextProxy: Boolean(found.data.isTextProxy),
  };
}

// AABB (accounting for each stone's own diameter) of a {x,y,d}[] list -- the exact box
// materializeTextItemFromLayer() derives its proxy from.
function stoneAabb(stones) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const s of stones) {
    minX = Math.min(minX, s.x - s.d / 2); maxX = Math.max(maxX, s.x + s.d / 2);
    minY = Math.min(minY, s.y - s.d / 2); maxY = Math.max(maxY, s.y + s.d / 2);
  }
  return { left: minX, top: minY, width: maxX - minX, height: maxY - minY };
}

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

const NEAR = (a, b, tol = 1e-6) => Math.abs(a - b) <= tol;

// =============================================================================================
// 1. DISPATCH -- each layer category reaches its own materializer and no other. For the three
//    hook-driven materializers the positive contrast is explicit (assert the hook DID fire), so
//    the assertion can never pass by the hook simply never being called.
// =============================================================================================

test("1a. 'path' -> materializeShapeFromLayer (builds from layer.contours; no resolver hook)", () => {
  sync([pathLayer]);
  const p = proxyFor(pathLayer.id);
  assert.ok(p, 'a path proxy materialized');
  // Positive signal that materializeShapeFromLayer specifically ran: one paper segment per stored
  // contour point (231 in this fixture), not a 4-corner box or a resolver-built outline.
  assert.equal(p.points.length, pathLayer.contours[0].length, 'proxy has one segment per contour point');
  assert.ok(!hookNamesCalled().includes('resolveShapeLibraryPolygons'), 'no shape-library resolve for a path');
  assert.ok(!hookNamesCalled().includes('resolveSvgPolygons'), 'no svg resolve for a path');
  assert.ok(!hookNamesCalled().includes('getTextLayerStones'), 'no text-stone lookup for a path');
});

test("1b. 'star' (SHAPE_LIBRARY_KINDS) -> materializeShapeLibraryItemFromLayer via resolveShapeLibraryPolygons", () => {
  shapeLibraryPolygonsReturn = { polygons: boxPolygons(starLayer.x, starLayer.y, starLayer.w, starLayer.h), boundingBox: null };
  sync([starLayer]);
  assert.ok(proxyFor(starLayer.id), 'a star proxy materialized');
  // Positive contrast: resolveShapeLibraryPolygons WAS asked for this layer, with its real type.
  assert.deepEqual(
    hookCalls.filter((c) => c[0] === 'resolveShapeLibraryPolygons'),
    [['resolveShapeLibraryPolygons', 'star']],
    'resolveShapeLibraryPolygons called exactly once, for the star',
  );
  assert.ok(!hookNamesCalled().includes('resolveSvgPolygons'), 'a star never routes through the svg resolver');
  assert.ok(!hookNamesCalled().includes('getTextLayerStones'), 'a star never routes through the text-stone hook');
});

test("1c. 'svg' -> materializeSvgImageItemFromLayer via resolveSvgPolygons", () => {
  svgPolygonsReturn = { polygons: boxPolygons(svgLayer.x, svgLayer.y, svgLayer.w, svgLayer.h), boundingBox: null };
  sync([svgLayer]);
  assert.ok(proxyFor(svgLayer.id), 'an svg proxy materialized');
  assert.deepEqual(
    hookCalls.filter((c) => c[0] === 'resolveSvgPolygons'),
    [['resolveSvgPolygons', 'svg']],
    'resolveSvgPolygons called exactly once, for the svg',
  );
  assert.ok(!hookNamesCalled().includes('resolveShapeLibraryPolygons'), 'an svg never routes through the shape-library resolver');
});

test("1d. 'image' -> materializeSvgImageItemFromLayer, rectangle-fallback branch (no resolver hook at all)", () => {
  sync([imageLayer]);
  const p = proxyFor(imageLayer.id);
  assert.ok(p, 'an image proxy materialized');
  assert.ok(NEAR(p.bounds.width, imageLayer.w) && NEAR(p.bounds.height, imageLayer.h), 'image proxy is the x/y/w/h box');
  // 'image' short-circuits before resolveSvgPolygons (that call is guarded by layer.type === 'svg').
  assert.ok(!hookNamesCalled().includes('resolveSvgPolygons'), 'an image never calls the svg resolver');
  assert.ok(!hookNamesCalled().includes('resolveShapeLibraryPolygons'), 'an image never calls the shape-library resolver');
});

test("1e. 'rectangle' -> buildRectangleProxyItem, NOT materializeShapeLibraryItemFromLayer (the Step 5 trap)", () => {
  sync([rectLayer]);
  const p = proxyFor(rectLayer.id);
  assert.ok(p, 'a rectangle proxy materialized');
  assert.ok(NEAR(p.bounds.width, rectLayer.w) && NEAR(p.bounds.height, rectLayer.h), 'rectangle proxy is the x/y/w/h box');
  // Widening the call-site filter WITHOUT the materializeForLayer() branch would send every
  // rectangle into the shape-library builder, which would ask GeometryEngine for an outline for a
  // kind ('rectangle') it does not know.
  assert.ok(!hookNamesCalled().includes('resolveShapeLibraryPolygons'), "a rectangle must never be asked for a SHAPE_LIBRARY_KINDS outline");
  assert.ok(!hookNamesCalled().includes('resolveSvgPolygons'), 'a rectangle never calls the svg resolver');
});

test("1f. 'text' -> materializeTextItemFromLayer via getTextLayerStones", () => {
  textStonesReturn = [];
  sync([textLayer]);
  assert.ok(proxyFor(textLayer.id), 'a text proxy materialized');
  // Positive contrast: getTextLayerStones WAS asked, keyed by this layer's id.
  assert.ok(
    hookCalls.some((c) => c[0] === 'getTextLayerStones' && c[1] === textLayer.id),
    'getTextLayerStones called with the text layer id',
  );
  assert.ok(!hookNamesCalled().includes('resolveShapeLibraryPolygons'), 'text never routes through the shape-library resolver');
  assert.ok(!hookNamesCalled().includes('resolveSvgPolygons'), 'text never routes through the svg resolver');
});

test("1g. 'circle' -> materializeCircleItemFromLayer (cx/cy/r; no resolver hook)", () => {
  sync([circleLayer]);
  const p = proxyFor(circleLayer.id);
  assert.ok(p, 'a circle proxy materialized');
  assert.ok(NEAR(p.bounds.width, circleLayer.r * 2) && NEAR(p.bounds.height, circleLayer.r * 2), 'circle proxy is the cx/cy +/- r box');
  assert.equal(hookNamesCalled().filter((n) => n.startsWith('resolve')).length, 0, 'a circle calls no resolver hook');
  assert.ok(!hookNamesCalled().includes('getTextLayerStones'), 'a circle never routes through the text-stone hook');
});

// =============================================================================================
// 2. ROTATION -- the point of the milestone. Three distinct rules, asserted explicitly:
//
//    (a) 'path' / 'svg' / 'image' / 'rectangle'  -- the proxy is an UNROTATED item that Design
//        rotates itself via paper's item.rotate(rotationDeg, pivot). A non-zero rotationDeg on a
//        non-square box therefore swaps the AABB's width/height about the box centre.
//    (b) 'star' (SHAPE_LIBRARY_KINDS) / 'text'   -- the proxy is NEVER re-rotated by Design. Its
//        geometry arrives already-rotated from upstream (GeometryEngine.resolveShapePolygons()'s
//        RS-3028 step for shape-library; generateTextLayout()'s baked-in rotationDeg for text),
//        so identical geometry in + a different rotationDeg = an identical proxy. data.rotationDeg
//        is still stamped from the layer.
//    (c) 'circle'  -- rotationally invariant. rotationDeg is ignored entirely and stamped 0.
//
// The work order lumped circle and SHAPE_LIBRARY_KINDS in with the item.rotate() group; the code
// does not (materializeCircleItemFromLayer / materializeShapeLibraryItemFromLayer never call
// item.rotate()), so this asserts what the code actually contracts.
// =============================================================================================

function assertItemRotated(layer, id, w, h) {
  sync([withField(layer, { rotationDeg: 0 })]);
  const flat = proxyFor(id).bounds;
  assert.ok(NEAR(flat.width, w, 1e-4) && NEAR(flat.height, h, 1e-4), `unrotated AABB is the ${w}x${h} box`);
  sync([withField(layer, { rotationDeg: 90 })]);
  const rot = proxyFor(id);
  assert.equal(rot.rotationDeg, 90, 'data.rotationDeg stamped with the applied rotation');
  assert.ok(NEAR(rot.bounds.width, h, 1e-4), `90deg rotation swaps width -> original height (${h}), got ${rot.bounds.width}`);
  assert.ok(NEAR(rot.bounds.height, w, 1e-4), `90deg rotation swaps height -> original width (${w}), got ${rot.bounds.height}`);
  assert.ok(NEAR(flat.left + flat.width / 2, rot.bounds.left + rot.bounds.width / 2, 1e-4), 'rotation pivots about the box centre X');
  assert.ok(NEAR(flat.top + flat.height / 2, rot.bounds.top + rot.bounds.height / 2, 1e-4), 'rotation pivots about the box centre Y');
}

test("2a-path. materializeShapeFromLayer applies rotationDeg via item.rotate()", () => {
  assertItemRotated(pathLayer, pathLayer.id, pathLayer.w, pathLayer.h);
});

test("2a-svg. materializeSvgImageItemFromLayer applies rotationDeg via item.rotate() (real-outline branch)", () => {
  // svg-logo-import.rhs is 76x76 (square -> a 90deg rotation would be a no-op AABB); give it a
  // non-square box and a box-filling outline so item.rotate() is the only thing that can swap the
  // AABB. resolveSvgPolygons has no rotationDeg parameter, so the item MUST rotate itself.
  const nonSquare = withField(svgLayer, { h: 40 });
  svgPolygonsReturn = { polygons: boxPolygons(nonSquare.x, nonSquare.y, nonSquare.w, nonSquare.h), boundingBox: null };
  assertItemRotated(nonSquare, nonSquare.id, nonSquare.w, nonSquare.h);
});

test("2a-image. buildRectangleProxyItem (image fallback) applies rotationDeg via item.rotate()", () => {
  // image-trace-monogram.rhs is 70x70 (square); make it non-square so the swap is observable.
  const nonSquare = withField(imageLayer, { h: 40 });
  svgPolygonsReturn = null;
  assertItemRotated(nonSquare, nonSquare.id, nonSquare.w, nonSquare.h);
});

test("2a-rectangle. buildRectangleProxyItem applies rotationDeg via item.rotate()", () => {
  assertItemRotated(rectLayer, rectLayer.id, rectLayer.w, rectLayer.h); // rectangle-only.rhs is 130x50
});

test("2b-text. materializeTextItemFromLayer does NOT re-rotate: same stones + different rotationDeg = identical proxy", () => {
  // THE double-rotation guard. generateTextLayout() already bakes rotationDeg into the stone
  // positions getTextLayerStones() returns (docs/ARCHITECTURE.md "Selection beyond shapes
  // (RS-3012)" Step 3: "rotating a text proxy the same way would double the rotation, so it is
  // deliberately not rotated"). A future refactor making 'text' "consistent" with the other five
  // types by adding item.rotate() would double every rotated text layer's on-canvas angle
  // silently -- this test fails the instant that happens.
  textStonesReturn = [
    { x: 10, y: 20, d: 2, color: 'gold' },
    { x: 48, y: 22, d: 2, color: 'gold' },
    { x: 30, y: 38, d: 2, color: 'gold' },
  ];
  const want = stoneAabb(textStonesReturn);

  sync([withField(textLayer, { rotationDeg: 0 })]);
  const at0 = proxyFor(textLayer.id).bounds;

  sync([withField(textLayer, { rotationDeg: 137 })]);
  const at137 = proxyFor(textLayer.id);

  for (const [label, b] of [['rotationDeg 0', at0], ['rotationDeg 137', at137.bounds]]) {
    assert.ok(NEAR(b.left, want.left, 1e-6), `${label}: proxy left = stone-AABB left`);
    assert.ok(NEAR(b.top, want.top, 1e-6), `${label}: proxy top = stone-AABB top`);
    assert.ok(NEAR(b.width, want.width, 1e-6), `${label}: proxy width = stone-AABB width`);
    assert.ok(NEAR(b.height, want.height, 1e-6), `${label}: proxy height = stone-AABB height`);
  }
  assert.equal(at137.rotationDeg, 137, 'data.rotationDeg is still stamped from the layer (read by a live rotate-drag)');
  textStonesReturn = [];
});

test("2b-star. materializeShapeLibraryItemFromLayer does NOT re-rotate: it trusts the resolved (pre-rotated) polygons", () => {
  // GeometryEngine.resolveShapePolygons() has already applied rotationDeg to the points before
  // this materializer sees them, so it must not rotate again. With a FIXED box polygon returned
  // regardless of layer.rotationDeg, the proxy AABB is identical at 0 and 90 -- proof the
  // materializer adds no item.rotate() of its own -- while data.rotationDeg still reflects the layer.
  shapeLibraryPolygonsReturn = { polygons: boxPolygons(starLayer.x, starLayer.y, starLayer.w, starLayer.h), boundingBox: null };
  sync([withField(starLayer, { rotationDeg: 0 })]);
  const at0 = proxyFor(starLayer.id).bounds;
  sync([withField(starLayer, { rotationDeg: 90 })]);
  const at90 = proxyFor(starLayer.id);
  assert.ok(NEAR(at0.width, at90.bounds.width) && NEAR(at0.height, at90.bounds.height), 'identical resolved polygons -> identical proxy AABB');
  assert.ok(NEAR(at0.left, at90.bounds.left) && NEAR(at0.top, at90.bounds.top), 'proxy position unchanged by rotationDeg');
  assert.equal(at90.rotationDeg, 90, 'data.rotationDeg still stamped from the layer');
});

test("2c-circle. materializeCircleItemFromLayer ignores rotationDeg entirely and stamps 0", () => {
  sync([withField(circleLayer, { rotationDeg: 0 })]);
  const at0 = proxyFor(circleLayer.id).bounds;
  sync([withField(circleLayer, { rotationDeg: 90 })]);
  const at90 = proxyFor(circleLayer.id);
  assert.equal(at90.rotationDeg, 0, 'a circle proxy always stamps rotationDeg 0 regardless of the layer value');
  assert.ok(NEAR(at0.width, at90.bounds.width) && NEAR(at0.height, at90.bounds.height), 'a circle AABB is rotation-invariant');
});

// =============================================================================================
// 3. PIVOT / data stamps -- every proxy carries data.rotationDeg + data.pivotXMm + data.pivotYMm,
//    and the pivot each type uses is asserted directly (box centre for the XYWH types; the
//    stone-AABB centre for text; the circle centre for circle) -- one rule is NOT assumed for all.
// =============================================================================================

test('3. each materializer stamps rotationDeg + the pivot its own geometry dictates', () => {
  svgPolygonsReturn = { polygons: boxPolygons(svgLayer.x, svgLayer.y, svgLayer.w, svgLayer.h), boundingBox: null };
  shapeLibraryPolygonsReturn = { polygons: boxPolygons(starLayer.x, starLayer.y, starLayer.w, starLayer.h), boundingBox: null };
  textStonesReturn = [
    { x: 10, y: 20, d: 2, color: 'gold' },
    { x: 48, y: 22, d: 2, color: 'gold' },
    { x: 30, y: 38, d: 2, color: 'gold' },
  ];
  const textCentre = (() => { const b = stoneAabb(textStonesReturn); return { x: b.left + b.width / 2, y: b.top + b.height / 2 }; })();

  const cases = [
    // [label, layer, expected pivot X, expected pivot Y]
    ['path (box centre)', pathLayer, pathLayer.x + pathLayer.w / 2, pathLayer.y + pathLayer.h / 2],
    ['star (box centre)', starLayer, starLayer.x + starLayer.w / 2, starLayer.y + starLayer.h / 2],
    ['svg (box centre)', svgLayer, svgLayer.x + svgLayer.w / 2, svgLayer.y + svgLayer.h / 2],
    ['image (box centre)', imageLayer, imageLayer.x + imageLayer.w / 2, imageLayer.y + imageLayer.h / 2],
    ['rectangle (box centre)', rectLayer, rectLayer.x + rectLayer.w / 2, rectLayer.y + rectLayer.h / 2],
    ['text (stone-AABB centre)', textLayer, textCentre.x, textCentre.y],
    ['circle (circle centre)', circleLayer, circleLayer.cx, circleLayer.cy],
  ];
  for (const [label, layer, px, py] of cases) {
    if (layer.type === 'image') svgPolygonsReturn = null; // image never resolves an outline
    sync([layer]);
    const p = proxyFor(layer.id);
    assert.equal(typeof p.rotationDeg, 'number', `${label}: data.rotationDeg stamped`);
    assert.ok(NEAR(p.pivotXMm, px, 1e-6), `${label}: data.pivotXMm = ${px}, got ${p.pivotXMm}`);
    assert.ok(NEAR(p.pivotYMm, py, 1e-6), `${label}: data.pivotYMm = ${py}, got ${p.pivotYMm}`);
    if (layer.type === 'svg') svgPolygonsReturn = { polygons: boxPolygons(svgLayer.x, svgLayer.y, svgLayer.w, svgLayer.h), boundingBox: null };
  }
  textStonesReturn = [];
});

// =============================================================================================
// 4. INTERACTION FLAGS as a matrix -- one row per layer category. A future layer type added
//    without a conscious flag decision fails here.
// =============================================================================================

test('4. interaction-flag matrix: only text -> noResizeHandles/isTextProxy; only circle -> noRotateHandle/isCircleProxy', () => {
  svgPolygonsReturn = { polygons: boxPolygons(svgLayer.x, svgLayer.y, svgLayer.w, svgLayer.h), boundingBox: null };
  shapeLibraryPolygonsReturn = { polygons: boxPolygons(starLayer.x, starLayer.y, starLayer.w, starLayer.h), boundingBox: null };
  textStonesReturn = [{ x: 10, y: 20, d: 2, color: 'gold' }, { x: 48, y: 38, d: 2, color: 'gold' }];

  const expected = {
    path: { noResizeHandles: false, noRotateHandle: false, isCircleProxy: false, isTextProxy: false },
    star: { noResizeHandles: false, noRotateHandle: false, isCircleProxy: false, isTextProxy: false },
    svg: { noResizeHandles: false, noRotateHandle: false, isCircleProxy: false, isTextProxy: false },
    image: { noResizeHandles: false, noRotateHandle: false, isCircleProxy: false, isTextProxy: false },
    rectangle: { noResizeHandles: false, noRotateHandle: false, isCircleProxy: false, isTextProxy: false },
    text: { noResizeHandles: true, noRotateHandle: false, isCircleProxy: false, isTextProxy: true },
    circle: { noResizeHandles: false, noRotateHandle: true, isCircleProxy: true, isTextProxy: false },
  };
  const byType = { path: pathLayer, star: starLayer, svg: svgLayer, image: imageLayer, rectangle: rectLayer, text: textLayer, circle: circleLayer };

  for (const [key, layer] of Object.entries(byType)) {
    if (key === 'image') svgPolygonsReturn = null;
    sync([layer]);
    assert.deepEqual(proxyDataFlags(layer.id), expected[key], `${key} proxy interaction flags`);
    if (key === 'image') svgPolygonsReturn = { polygons: boxPolygons(svgLayer.x, svgLayer.y, svgLayer.w, svgLayer.h), boundingBox: null };
  }
  textStonesReturn = [];
});

// =============================================================================================
// 5. FALLBACK -- an 'image' layer, and an 'svg' whose resolveSvgPolygons resolves nothing, both
//    produce the SHARED rectangle proxy: the same bounds an equivalent 'rectangle' layer would.
//    This is the path buildRectangleProxyItem() was extracted onto during Step 5 with no test
//    guarding it.
// =============================================================================================

test('5. image, and an unresolvable svg, both fall back to the buildRectangleProxyItem box', () => {
  const box = { x: 55, y: 12, w: 90, h: 44 };
  const asRect = { id: 'fb-rect', type: 'rectangle', visible: true, ...box, stoneSize: 2, gap: 0.3, color: 'gold' };
  const asImage = { ...imageLayer, id: 'fb-image', ...box };
  const asSvg = { ...svgLayer, id: 'fb-svg', ...box };

  sync([asRect]);
  const rectBounds = proxyFor('fb-rect').bounds;

  sync([asImage]);
  const imageBounds = proxyFor('fb-image').bounds;

  svgPolygonsReturn = null; // svgSource present but unresolvable
  sync([asSvg]);
  const svgBounds = proxyFor('fb-svg').bounds;

  for (const [label, b] of [['image', imageBounds], ['unresolvable svg', svgBounds]]) {
    assert.ok(NEAR(b.left, rectBounds.left) && NEAR(b.top, rectBounds.top), `${label} fallback left/top == rectangle`);
    assert.ok(NEAR(b.width, rectBounds.width) && NEAR(b.height, rectBounds.height), `${label} fallback w/h == rectangle`);
  }
  assert.ok(NEAR(rectBounds.width, box.w) && NEAR(rectBounds.height, box.h), 'and the shared box is the layer x/y/w/h');
});

// =============================================================================================
// 6. RESIZE_MIN_DIM_MM clamping in buildRectangleProxyItem -- a degenerate zero-width layer still
//    yields a usable (non-zero) proxy.
// =============================================================================================

test('6. buildRectangleProxyItem clamps a degenerate 0-width layer to RESIZE_MIN_DIM_MM (2mm)', () => {
  sync([withField(rectLayer, { id: 'degenerate', w: 0 })]);
  const p = proxyFor('degenerate');
  assert.ok(p, 'a proxy still materialized for a zero-width rectangle');
  assert.ok(NEAR(p.bounds.width, 2), `clamped width = 2mm, got ${p.bounds.width}`);
  assert.ok(NEAR(p.bounds.height, rectLayer.h), 'the non-degenerate axis is untouched');
});

// =============================================================================================
// 7. Registration
// =============================================================================================

test('7. this test file is registered in its group and the default suite', () => {
  assertTestRegistered({
    filename: 'test-maint-003-materializer-contract.mjs',
    group: 'editing',
    includedInDefault: true,
  });
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exitCode = 1;
