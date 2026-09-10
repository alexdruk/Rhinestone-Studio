// RS-3015 -- Stamp / Trace / Eraser resolve their target past a non-'path' layer proxy.
//
// resolveTargetLayerIdByBounds() (src/drawing/DrawingCanvasTool.js) reverse-iterates
// board.listShapes() and returns the topmost proxy whose AXIS-ALIGNED BOUNDS contain the point.
// syncFromProjectLayers() puts a proxy on that board for every 'path' / 'svg' / 'image' / 'text' /
// 'circle' / 'rectangle' / shape-library layer. Before RS-3015 a mark dropped anywhere inside a
// non-'path' proxy's bounding box resolved that layer, and app.js's onStampPlace / onTracePlace /
// onEraseSweep required type === 'path' and returned in silence -- so a stamp on a generated
// monogram (its joined-string 'text' bbox proxy sits above the frame 'path') did nothing.
//
// RS-3015 stamps item.data.markEligible = (layer.type === 'path') at every layerId-stamp site, and
// resolveTargetLayerIdByBounds() SKIPS any proxy whose markEligible !== true and keeps walking DOWN
// the stack -- so the mark falls through to the frame 'path' underneath.
//
// HARNESS. Same shape as tools/test-maint-003-materializer-contract.mjs / tools/test-rs3012-step4-
// circle-select.mjs: real createDrawingTool, real syncFromProjectLayers, paper.js's own Node/jsdom
// headless View (tools/lib/paper-node-env.mjs), dynamic import() only AFTER loadPaperForNode().
// Proxies are ALWAYS driven through the real sync -- no materializer is ever called directly.
// resolveTargetLayerIdByBounds() has no debug accessor, so it is exercised the way a user reaches
// it: a Stamp-mode mousedown, whose onStampPlace hook receives the resolved layerId (or null).

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertTestRegistered } from './lib/test-registration-assertions.mjs';
import { loadPaperForNode } from './lib/paper-node-env.mjs';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));

const paper = await loadPaperForNode();
globalThis.requestAnimationFrame = (fn) => { fn(0); return 0; };
globalThis.cancelAnimationFrame = () => {};

const { createDrawingTool } = await import('../src/drawing/index.js');
const { GeometryEngine } = await import('../src/geometry/index.js');
const { MonogramGenerator, MONOGRAM_LAYOUTS } = await import('../src/monogram/index.js');
const { FontManager } = await import('../src/fonts/index.js');
const { createDefaultFontProviderRegistry } = await import('../src/text/index.js');

// ---------------------------------------------------------------------------------------------
// Headless tool harness (one shared instance -- paper.tool is a singleton; each sync() re-syncs
// its own layers, which prunes the previous test's shapes).
// ---------------------------------------------------------------------------------------------
const canvas = self.document.createElement('canvas');
canvas.width = 1200;
canvas.height = 800;
self.document.body.appendChild(canvas);

// Every document.createElement('canvas') past this point is StoneSpriteCache.js's offscreen sprite
// bake (a text proxy with stones triggers rebuildTextStoneGroupForShape() -> buildStoneSpriteGroup()).
// jsdom has no 2D context -- hand those a dependency-free fake, same stub convention as
// tools/test-maint-003-materializer-contract.mjs. The sprite group is never asserted here.
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

let stampCalls = [];
let textStonesByLayerId = {};

const tool = createDrawingTool(canvas, {
  onShapeResized: () => {},
  onShapeRotated: () => {},
  onShapeMoved: () => {},
  getLayerStoneParams: () => null,
  generatePathLayout: () => [],
  resolveShapeLibraryPolygons: () => null,
  resolveSvgPolygons: () => null,
  getTextLayerStones: (id) => textStonesByLayerId[id] || [],
  onStampPlace: ({ layerId }) => { stampCalls.push(layerId); },
  onStampRejected: () => { stampCalls.push('__rejected__'); },
});
tool.enter({ width: 220, height: 220 }, 20, 'select');

function toolEvent(type, x, y) {
  const point = new paper.Point(x, y);
  return {
    type, point, lastPoint: point, downPoint: point,
    delta: new paper.Point(0, 0), modifiers: {}, event: {},
    stopPropagation() {}, preventDefault() {},
  };
}

// Resolve a mark target at (xMm, yMm) exactly as a Stamp click does: switch to Stamp mode, emit a
// mousedown, read back the layerId onStampPlace was handed (null = nothing resolved).
function resolveStampTargetLayerId(xMm, yMm) {
  tool.setMode('stamp');
  stampCalls = [];
  paper.tool.emit('mousedown', toolEvent('mousedown', xMm, yMm));
  tool.setMode('select');
  assert.equal(stampCalls.length, 1, `expected exactly one onStampPlace/onStampRejected for the click at (${xMm}, ${yMm})`);
  const only = stampCalls[0];
  return only === '__rejected__' ? '__rejected__' : (only || null);
}

// Sync a set of layers, optionally seeding each 'text' layer's stones (what materializeTextItem-
// FromLayer() derives its bbox proxy from) BEFORE the sync so the proxy is built at full size.
function sync(layers, textStones = {}) {
  textStonesByLayerId = textStones;
  tool.syncFromProjectLayers(layers);
}
const layerIdOfShape = (shapeId) => (tool.debugShapes.find((s) => s.id === shapeId) || {}).layerId || null;

let passed = 0;
let failed = 0;
async function runTest(name, fn) {
  try { await fn(); console.log(`✓ ${name}`); passed += 1; }
  catch (error) { console.error(`✗ ${name}`); console.error(error); failed += 1; process.exitCode = 1; }
}

// A real 'path' layer: exactly what Design's rectangle/pen tools commit to project.layers (a
// closed contour + an x/y/w/h placement box). Reachability: the user draws a shape in Design.
const pathLayer = {
  id: 'path-A', type: 'path', visible: true,
  contours: [[{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }]],
  x: 100, y: 100, w: 40, h: 40,
  stoneSize: 2, gap: 0.3, color: 'gold',
};
// A 'text' layer whose bbox proxy is made to cover the path. Reachability: the user adds a Text
// layer, then draws a path under it (or drags either) so the text bbox sits above the path in
// Design's shape stack.
const textOverPathLayer = {
  id: 'text-over', type: 'text', visible: true,
  text: 'AB', font: 'rs-block',
  x: 120, y: 120, stoneSize: 2, gap: 0.3, color: 'gold',
  height: 12, align: 'left', lineSpacing: 1, rotationDeg: 0,
};
// Stones that make the text proxy's AABB span ~(106..134, 106..134) -- overlapping the path box.
const textOverPathStones = [
  { x: 108, y: 108, d: 2, color: 'gold' },
  { x: 132, y: 108, d: 2, color: 'gold' },
  { x: 108, y: 132, d: 2, color: 'gold' },
  { x: 132, y: 132, d: 2, color: 'gold' },
];
const P = { x: 120, y: 120 }; // inside BOTH the path box and the text bbox

// =============================================================================================
// 1. Named negative control -- one point, two boards, both resolved ids printed.
//    Board A (path alone) proves the resolver still resolves SOMETHING at P -- a test that only
//    checked board B's post-fix value would pass even if the resolver stopped resolving anything.
//    Board B (text proxy stacked above the same path, both containing P): BEFORE RS-3015 the
//    resolver returned 'text-over' (topmost bounds-containing); AFTER, it returns 'path-A'.
// =============================================================================================

await runTest('negative control: path alone resolves to the path; text-over-path also resolves to the path (skips the text proxy)', () => {
  sync([pathLayer]);
  const aId = resolveStampTargetLayerId(P.x, P.y);

  sync([pathLayer, textOverPathLayer], { 'text-over': textOverPathStones });
  const bId = resolveStampTargetLayerId(P.x, P.y);

  console.log(`    negative control -- board A (path alone): resolved layerId = ${JSON.stringify(aId)}`);
  console.log(`    negative control -- board B (text over path): resolved layerId = ${JSON.stringify(bId)}`);
  console.log('    (before RS-3015, board B would have resolved "text-over"; after, "path-A")');

  assert.equal(aId, 'path-A', 'board A: a lone path resolves to itself (resolver still works)');
  assert.equal(bId, 'path-A', 'board B: the mark falls through the ineligible text proxy to the path');

  // Select is deliberately unchanged: hitTestShapeId() at the same point still hits the (topmost)
  // text proxy. The mark resolver differs from Select on purpose.
  const selectHit = layerIdOfShape(tool.debugHitTestShapeId(P.x, P.y));
  console.log(`    Select (hitTestShapeId) at the same point resolves layerId = ${JSON.stringify(selectHit)}`);
  assert.equal(selectHit, 'text-over', 'Select still picks the topmost shape whose interior contains the point');
});

// =============================================================================================
// 2. Real MonogramGenerator result -- frame 'path' + letter 'text', not a synthetic stand-in.
//    test-mono-014-frame-hierarchy.mjs:59-68 recipe (real FontManager + GeometryEngine + fonts).
// =============================================================================================

const manifest = JSON.parse(await readFile(path.join(repoRoot, 'assets/fonts/manifest.json'), 'utf8'));
const fontManager = new FontManager(manifest);
async function loadFontBufferFromRepoRoot(relativePath) {
  const buffer = await readFile(path.join(repoRoot, relativePath));
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
}
const fontProviderRegistry = createDefaultFontProviderRegistry(fontManager, { loadFontBuffer: loadFontBufferFromRepoRoot });
const realEngine = new GeometryEngine({ fontProviderRegistry });
const realGenerator = new MonogramGenerator({ geometryEngine: realEngine });

await runTest('a mark on a real generated monogram resolves the frame path, not the letter text layer', async () => {
  // test-mono-014's baseRequest: circle frame, Single layout, one letter, the RS Block authored font.
  const result = await realGenerator.generate({
    frameId: 'circle', layoutId: MONOGRAM_LAYOUTS.SINGLE, letters: ['A'],
    fontId: 'rs-block', providerId: 'rhinestone',
    stoneSizeMm: 2.0, color: 'gold',
    frameRect: { xMm: 70, yMm: 70, widthMm: 80, heightMm: 80 },
    canvasMm: { widthMm: 220, heightMm: 220 },
    frameOptions: {},
  });
  assert.equal(result.ok, true, result.message);

  const framePathLayer = result.layers.find((l) => l.type === 'path');
  const letterTextLayer = result.layers.find((l) => l.type === 'text');
  assert.ok(framePathLayer, 'the generated monogram emits a frame path layer');
  assert.ok(letterTextLayer, 'the generated monogram emits a letter text layer');

  // Real letter stones from the real engine (the same authoredScale the generator persisted),
  // translated so the glyph's own centre sits at the frame centre -- where a monogram letter
  // actually sits. This is the geometry the bug needs: a 'text' bbox proxy over the frame.
  const raw = await realEngine.generateTextLayout({
    text: letterTextLayer.text, fontId: letterTextLayer.font, providerId: 'rhinestone',
    layerId: letterTextLayer.id, heightMm: letterTextLayer.height,
    stoneSizeMm: letterTextLayer.stoneSize, gapMm: letterTextLayer.gap, mode: 'outline',
    color: letterTextLayer.color, authoredScale: letterTextLayer.authoredScale,
  });
  assert.ok(raw.stones.length > 0, 'the real engine produced letter stones');
  const fr = result.measurements.frameRect;
  const cx = fr.xMm + fr.widthMm / 2;
  const cy = fr.yMm + fr.heightMm / 2;
  const gx = raw.stones.reduce((s, st) => s + st.xMm, 0) / raw.stones.length;
  const gy = raw.stones.reduce((s, st) => s + st.yMm, 0) / raw.stones.length;
  const letterStones = raw.stones.map((st) => ({
    x: st.xMm - gx + cx, y: st.yMm - gy + cy, d: st.sizeMm, color: st.color,
  }));

  sync([framePathLayer, letterTextLayer], { [letterTextLayer.id]: letterStones });

  // Sanity: the letter proxy really is above the frame and really does contain the click point
  // (so the resolver's skip is doing real work, not just missing the proxy).
  const selectHit = layerIdOfShape(tool.debugHitTestShapeId(cx, cy));
  assert.equal(selectHit, letterTextLayer.id, 'Select picks the letter text proxy at the frame centre');

  const resolved = resolveStampTargetLayerId(cx, cy);
  console.log(`    monogram -- Select resolves ${JSON.stringify(selectHit)}; mark resolver resolves ${JSON.stringify(resolved)} (frame = ${JSON.stringify(framePathLayer.id)})`);
  assert.equal(resolved, framePathLayer.id, 'the stamp falls through the letter text proxy to the frame path');
});

// =============================================================================================
// 3. No eligible shape at all -> null.
//    Reachability: the user has only a Text layer selected/visible (e.g. deleted a monogram's
//    frame, keeping the lettering) and clicks Stamp on it.
// =============================================================================================

await runTest('a board with no path layer resolves null (nothing to place a mark on)', () => {
  sync([textOverPathLayer], { 'text-over': textOverPathStones });

  const resolved = resolveStampTargetLayerId(P.x, P.y);
  console.log(`    no-eligible-shape -- resolved layerId = ${JSON.stringify(resolved)}`);
  // The click is inside the text proxy, but onStampPlace is still called with layerId null (the
  // resolver skipped the only proxy) -- it is NOT an onStampRejected (that is the active-selection
  // path only).
  assert.equal(resolved, null, 'no path proxy under the point -> null');
});

// =============================================================================================
// 4. Registration
// =============================================================================================

await runTest('this test file is registered in its group and the default suite', () => {
  assertTestRegistered({
    filename: 'test-rs3015-mark-target-eligibility.mjs',
    group: 'editing',
    includedInDefault: true,
  });
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exitCode = 1;
