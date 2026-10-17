// IMG-020 -- an 'image' layer's stones are drawn in Design, read from the layout through the
// getImageLayerStones() hook (never regenerated), and rebuilt only when the layout stones' signature,
// the unrotated box or the rotation changes. See docs/specifications/IMG-020-ImageStonesInDesign.md.
//
// Same harness as tools/test-mono-021-mark-hooks.mjs: the real createDrawingTool() and
// syncFromProjectLayers() under loadPaperForNode(), a stubbed canvas for the sprite bake, and real
// pointer gestures through paper.tool.emit(). A rebuild is observed as a change of
// debugStoneState().groupId.

import assert from 'node:assert/strict';
import { assertTestRegistered } from './lib/test-registration-assertions.mjs';
import { loadPaperForNode } from './lib/paper-node-env.mjs';

const paper = await loadPaperForNode();
globalThis.requestAnimationFrame = (fn) => { fn(0); return 0; };
globalThis.cancelAnimationFrame = () => {};

const { createDrawingTool } = await import('../src/drawing/index.js');

// jsdom has no 2D context -- StoneSpriteCache.js's offscreen bake needs a dependency-free fake
// (same stub as tools/test-mono-021-mark-hooks.mjs). Sprite pixels are never asserted.
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
canvas.width = 1200;
canvas.height = 800;
self.document.body.appendChild(canvas);

let passed = 0;
let failed = 0;
async function runTest(name, fn) {
  try { await fn(); console.log(`✓ ${name}`); passed += 1; }
  catch (error) { console.error(`✗ ${name}`); console.error(error); failed += 1; process.exitCode = 1; }
}

// ---------------------------------------------------------------------------------------------
// Harness -- getImageLayerStones()/getTextLayerStones() are live getters over mutable per-layer
// lists, exactly as app.js's hooks filter the `layout` global. Each read is logged.
// ---------------------------------------------------------------------------------------------
let imageStonesById = {};
let textStonesById = {};
let hookReads = [];
const events = { moved: null, resized: null, rotated: null };

const tool = createDrawingTool(canvas, {
  onShapeMoved: (layerId, dx, dy) => { events.moved = { layerId, dx, dy }; },
  onShapeResized: (layerId, box) => { events.resized = { layerId, box }; },
  onShapeRotated: (layerId, deg) => { events.rotated = { layerId, deg }; },
  getLayerStoneParams: () => null,
  generatePathLayout: () => [],
  resolveShapeLibraryPolygons: () => null,
  resolveSvgPolygons: () => null,
  getTextLayerStones: (id) => { hookReads.push(['text', id]); return textStonesById[id] || []; },
  getImageLayerStones: (id) => { hookReads.push(['image', id]); return imageStonesById[id] || []; },
});
tool.enter({ width: 240, height: 240 }, 20, 'select');

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

const PALETTE = ['topaz', 'jet', 'aquamarine'];
function gridStones(box, pitch = 2.5) {
  const stones = [];
  const cols = Math.floor(box.w / pitch), rows = Math.floor(box.h / pitch);
  for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
    stones.push({ x: box.x + pitch / 2 + i * pitch, y: box.y + pitch / 2 + j * pitch, d: 2, color: PALETTE[(i + 2 * j) % 3] });
  }
  return stones;
}
const imageLayer = (over = {}) => ({ id: 'I', type: 'image', visible: true, x: 40, y: 40, w: 60, h: 50, rotationDeg: 0, stoneSize: 2, gap: 0.3, color: 'gold', ...over });
const textLayer = (over = {}) => ({
  id: 'T', type: 'text', visible: true, text: 'AB', font: 'rs-block',
  x: 0, y: 0, stoneSize: 2, gap: 0.3, color: 'gold',
  height: 12, align: 'left', lineSpacing: 1, rotationDeg: 0, ...over,
});

// MONO-021's five-bead cluster, AABB roughly (99,99)-(105,105).
const CLUSTER = [
  { x: 100, y: 100, d: 2, color: 'gold' },
  { x: 104, y: 100, d: 2, color: 'gold' },
  { x: 100, y: 104, d: 2, color: 'gold' },
  { x: 104, y: 104, d: 2, color: 'gold' },
  { x: 102, y: 102, d: 2, color: 'gold' },
];

const state = (id) => tool.debugStoneState(id);
const near = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps;

function assertDrawnEqualsLayout(drawn, stones) {
  assert.equal(drawn.length, stones.length, `drawn ${drawn.length} stones, layout has ${stones.length}`);
  for (let i = 0; i < stones.length; i += 1) {
    assert.ok(near(drawn[i].x, stones[i].x, 1e-6) && near(drawn[i].y, stones[i].y, 1e-6),
      `stone ${i} drawn at (${drawn[i].x}, ${drawn[i].y}), layout (${stones[i].x}, ${stones[i].y})`);
    assert.equal(drawn[i].color, stones[i].color, `stone ${i} colour`);
  }
}

// Every test starts from an empty board, then a sync of its own layers.
function freshSync(layers) {
  tool.syncFromProjectLayers([]);
  hookReads = [];
  events.moved = null;
  events.resized = null;
  events.rotated = null;
  tool.syncFromProjectLayers(layers);
}

// ---------------------------------------------------------------------------------------------
// T1 -- D1: the image's stones are the layout's, through getImageLayerStones(), with no markStones.
// ---------------------------------------------------------------------------------------------
await runTest('T1. an image layer draws exactly its layout stones, through getImageLayerStones(), with no markStones', () => {
  const layer = imageLayer();
  imageStonesById = { I: gridStones(layer) };
  freshSync([layer]);

  const s = state('I');
  assert.equal(s.stoneGroupCount, 480);
  assertDrawnEqualsLayout(s.stones, imageStonesById.I);
  const proxy = tool.debugShapes.find((shape) => shape.layerId === 'I');
  assert.ok(proxy, 'the image has a proxy');
  assert.deepEqual([proxy.bounds.left, proxy.bounds.top, proxy.bounds.width, proxy.bounds.height], [40, 40, 60, 50],
    'the proxy is still the layer box');
  assert.equal(s.markStones, null, 'an image proxy never carries markStones (RS-3015 box test kept)');
  assert.ok(hookReads.some(([kind, id]) => kind === 'image' && id === 'I'), 'stones read through getImageLayerStones');
  assert.ok(!hookReads.some(([kind]) => kind === 'text'), 'getTextLayerStones is never read for an image');
  console.log(`   passing: ${s.stoneGroupCount} drawn = layout, markStones null, reads ${JSON.stringify(hookReads)}`);
});

// ---------------------------------------------------------------------------------------------
// T2 -- D3: an Image dialog change with the box unchanged is caught by the signature.
// ---------------------------------------------------------------------------------------------
await runTest('T2. a recolour with the box unchanged rebuilds the group with the new colours', () => {
  const layer = imageLayer();
  imageStonesById = { I: gridStones(layer) };
  freshSync([layer]);
  const before = state('I').groupId;

  imageStonesById = { I: gridStones(layer).map((s) => (s.color === 'jet' ? { ...s, color: 'hematite' } : s)) };
  tool.syncFromProjectLayers([layer]);

  const after = state('I');
  assert.notEqual(after.groupId, before, 'the group was rebuilt');
  assertDrawnEqualsLayout(after.stones, imageStonesById.I);
  assert.equal(after.stones.filter((s) => s.color === 'hematite').length, 160);
  console.log(`   passing: groupId ${before} -> ${after.groupId}, 160 hematite`);
});

// ---------------------------------------------------------------------------------------------
// T3 -- D3/D6: an unchanged reconcile does not rebuild, unrotated or rotated.
// ---------------------------------------------------------------------------------------------
await runTest('T3. nothing changed: 10 reconciles keep the group at 0 and 30 degrees; forceStoneRebuild still rebuilds', () => {
  for (const rotationDeg of [0, 30]) {
    const layer = imageLayer({ rotationDeg });
    imageStonesById = { I: gridStones(layer) };
    freshSync([layer]);
    const id0 = state('I').groupId;
    for (let i = 0; i < 10; i += 1) tool.syncFromProjectLayers([layer]);
    assert.equal(state('I').groupId, id0, `no rebuild across 10 reconciles at ${rotationDeg} degrees`);
    tool.syncFromProjectLayers([layer], true);
    assert.notEqual(state('I').groupId, id0, `forceStoneRebuild rebuilds at ${rotationDeg} degrees`);
  }
});

// ---------------------------------------------------------------------------------------------
// T4 -- D4: drags.
// ---------------------------------------------------------------------------------------------
await runTest('T4a. move translates the group live; the reconcile after the move does not rebuild', () => {
  const layer = imageLayer();
  imageStonesById = { I: gridStones(layer) };
  freshSync([layer]);
  tool.selectShapeForLayer('I');
  const id0 = state('I').groupId;

  emit('mousedown', 40, 50);
  assert.equal(tool.debugInteractionKind, 'move');
  emit('mousedrag', 52, 58, 40, 50);
  const mid = state('I');
  assert.equal(mid.groupId, id0, 'no rebuild mid-drag');
  const dx = mid.stones[0].x - imageStonesById.I[0].x;
  const dy = mid.stones[0].y - imageStonesById.I[0].y;
  assert.ok(dx !== 0 && dy !== 0, `the group moved with the proxy (${dx}, ${dy})`);

  emit('mouseup', 52, 58, 52, 58);
  assert.ok(events.moved, 'onShapeMoved fired');
  assert.ok(near(events.moved.dx, dx, 1e-6) && near(events.moved.dy, dy, 1e-6),
    `onShapeMoved reports (${events.moved.dx}, ${events.moved.dy}), the group moved (${dx}, ${dy})`);

  const moved = { ...layer, x: layer.x + dx, y: layer.y + dy };
  imageStonesById = { I: imageStonesById.I.map((s) => ({ ...s, x: s.x + dx, y: s.y + dy })) };
  tool.syncFromProjectLayers([moved]);
  const after = state('I');
  assert.equal(after.groupId, id0, 'the reconcile after the move does not rebuild');
  assertDrawnEqualsLayout(after.stones, imageStonesById.I);
  console.log(`   passing: moved (${dx}, ${dy}), groupId ${id0} kept`);
});

await runTest('T4b. resize hides the group, never rebuilds mid-drag or at drop, and rebuilds on the next reconcile', () => {
  const layer = imageLayer();
  imageStonesById = { I: gridStones(layer) };
  freshSync([layer]);
  tool.selectShapeForLayer('I');
  const id0 = state('I').groupId;

  emit('mousedown', 100, 90);
  assert.equal(tool.debugInteractionKind, 'resize');
  emit('mousedrag', 95, 85, 100, 90);
  emit('mousedrag', 90, 80, 95, 85);
  const mid = state('I');
  assert.equal(mid.groupId, id0, 'no rebuild mid-drag');
  assert.equal(mid.groupVisible, false, 'hidden during the drag');

  emit('mouseup', 90, 80, 90, 80);
  const dropped = state('I');
  assert.equal(dropped.groupVisible, false, 'still hidden at drop: the layout has not regenerated yet');
  assert.equal(dropped.groupId, id0, 'not rebuilt from the pre-resize layout');
  assert.ok(events.resized, 'onShapeResized fired');
  assert.ok(near(events.resized.box.width, 50, 1e-6) && near(events.resized.box.height, 40, 1e-6),
    `onShapeResized reports ${events.resized.box.width} x ${events.resized.box.height}`);

  const resized = { ...layer, w: 50, h: 40 };
  imageStonesById = { I: gridStones(resized) };
  tool.syncFromProjectLayers([resized]);
  const after = state('I');
  assert.notEqual(after.groupId, id0, 'rebuilt from the regenerated layout');
  assert.equal(after.groupVisible, true);
  assert.equal(after.stoneGroupCount, 320);
  assertDrawnEqualsLayout(after.stones, imageStonesById.I);
});

await runTest('T4c. a handle click with no drag shows the group again, unrebuilt', () => {
  const layer = imageLayer();
  imageStonesById = { I: gridStones(layer) };
  freshSync([layer]);
  tool.selectShapeForLayer('I');
  const id0 = state('I').groupId;

  emit('mousedown', 100, 90);
  emit('mouseup', 100, 90);
  const s = state('I');
  assert.equal(s.groupVisible, true);
  assert.equal(s.groupId, id0);
});

await runTest('T4d. rotate keeps the group hidden at drop and rebuilds it visible on the next reconcile', () => {
  const layer = imageLayer();
  imageStonesById = { I: gridStones(layer) };
  freshSync([layer]);
  tool.selectShapeForLayer('I');
  const id0 = state('I').groupId;

  emit('mousedown', 70, 30);
  assert.equal(tool.debugInteractionKind, 'rotate');
  emit('mousedrag', 90, 40, 70, 30);
  emit('mouseup', 90, 40, 90, 40);
  assert.equal(state('I').groupVisible, false, 'still hidden at drop');
  assert.ok(events.rotated, 'onShapeRotated fired');

  tool.syncFromProjectLayers([{ ...layer, rotationDeg: events.rotated.deg }]);
  const after = state('I');
  assert.notEqual(after.groupId, id0, 'rebuilt on the reconcile after the drop');
  assert.equal(after.groupVisible, true);
  console.log(`   passing: rotated to ${events.rotated.deg.toFixed(2)} degrees, groupId ${id0} -> ${after.groupId}`);
});

// ---------------------------------------------------------------------------------------------
// T5 -- text keeps its own route, bounds gate and markStones refresh.
// ---------------------------------------------------------------------------------------------
await runTest('T5. text is unchanged: getTextLayerStones only, the bounds gate, and refreshStoneGroupForLayer() refreshing markStones', () => {
  textStonesById = { T: [...CLUSTER] };
  freshSync([textLayer()]);
  const s0 = state('T');
  assert.equal(s0.stoneGroupCount, 5);
  assert.equal(s0.markStones.length, 5);
  assert.ok(!hookReads.some(([kind]) => kind === 'image'), 'getImageLayerStones is never read for text');

  textStonesById = { T: [...CLUSTER, { x: 102, y: 101, d: 2, color: 'gold' }] };
  tool.syncFromProjectLayers([textLayer()]);
  assert.equal(state('T').groupId, s0.groupId, 'a sixth bead inside the AABB does not pass the bounds gate');

  tool.refreshStoneGroupForLayer('T');
  const s1 = state('T');
  assert.equal(s1.stoneGroupCount, 6);
  assert.equal(s1.markStones.length, 6, 'markStones refreshed with the group');
});

await runTest('this test file is registered in its group and the default suite', () => {
  assertTestRegistered({ filename: 'test-img-020-image-stones-in-design.mjs', group: 'editing', includedInDefault: true });
});

if (failed === 0) console.log(`\nIMG-020 image-stones-in-Design tests passed (${passed}).`);
else console.error(`\nIMG-020 image-stones-in-Design tests FAILED (${failed} of ${passed + failed}).`);
