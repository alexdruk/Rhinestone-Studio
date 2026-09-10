// RS-3015 -- Stamp / Trace / Eraser resolve their target past a non-'path' layer proxy, and the
// mark tools no longer discard a resolved-nothing gesture in silence.
//
// resolveMarkTargetByBounds() (src/drawing/DrawingCanvasTool.js) reverse-iterates
// board.listShapes() and returns { layerId, blockedByIneligible } for the topmost proxy whose
// AXIS-ALIGNED BOUNDS contain the point AND whose item.data.markEligible === true.
// syncFromProjectLayers() puts a proxy on that board for every 'path' / 'svg' / 'image' / 'text' /
// 'circle' / 'rectangle' / shape-library layer; tagMarkTarget() stamps markEligible = (type ===
// 'path') at every one of the twelve layerId-stamp sites, so a mark dropped on a non-'path' proxy
// falls THROUGH it to whatever 'path' layer sits underneath (a monogram frame under its lettering).
//
// commit e4957e4 wired Stamp's messaging (onStampPlace is always called, layerId may be null). This
// file's third commit wires Trace and Eraser: DrawingCanvasTool.js's own onMouseUp discards a
// resolved-nothing Trace/Eraser gesture BEFORE the onTracePlace/onEraseSweep hook fires, so the
// `if(!layerId)` branches app.js added in e4957e4 were unreachable. onTraceRejected now takes a
// `reason` ('no-target' | 'ineligible' | 'no-stones' | 'outside-selection') and onEraseRejected is
// new ('no-target' | 'ineligible'); app.js maps each to its own el('status') string.
//
// HARNESS. Same shape as tools/test-maint-003-materializer-contract.mjs / tools/test-rs3012-step4-
// circle-select.mjs: real createDrawingTool, real syncFromProjectLayers, paper.js's own Node/jsdom
// headless View (tools/lib/paper-node-env.mjs), dynamic import() only AFTER loadPaperForNode().
// Proxies are ALWAYS driven through the real sync -- no materializer is ever called directly, and
// every Trace/Eraser case below drives a REAL pointer gesture (mousedown -> mousedrag* -> mouseup)
// through paper.tool, never a direct call to a resolver or a hook. The exact el('status') string is
// asserted by executing app.js's OWN onTraceRejected / onEraseRejected / layerLabel source (sliced
// out brace-balanced, run with fakes) against the reason the real gesture produced.

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

// --- what the real gestures push into ---
let stampCalls = [];                 // onStampPlace layerId / '__rejected__:<reason>'
let traceHook = null;                // { kind:'place', ... } | { kind:'reject', reason, layerId }
let eraseHook = null;                // { kind:'sweep', ... } | { kind:'reject', reason }
let currentLayers = [];              // for the app.js-shaped getLayerStoneParams gate below
let textStonesByLayerId = {};
let activeSelectionAllows = () => true; // swapped per-test for the outside-selection regression

// getLayerStoneParams, shaped exactly like app.js:1798 -- null for a missing layer, a non-'path'
// layer, or a 'path' layer whose stones are not generated yet (stonesGenerated === false). That
// last case is the whole point of the 'no-stones' Trace reason.
function getLayerStoneParams(layerId) {
  const l = currentLayers.find((x) => x.id === layerId);
  if (!l || l.type !== 'path' || l.stonesGenerated === false) return null;
  return {
    stoneSizeMm: l.stoneSize, gapMm: l.gap, mode: 'outline', color: l.color,
    contours: (l.contours || []).map((c) => c.map((p) => ({ xMm: p.x, yMm: p.y }))),
    closed: l.closed !== false, regions: [], stampedStones: [], eraseDaubs: [], erasedGridPositions: [],
  };
}

const tool = createDrawingTool(canvas, {
  onShapeResized: () => {}, onShapeRotated: () => {}, onShapeMoved: () => {},
  getLayerStoneParams,
  generatePathLayout: () => [],
  resolveShapeLibraryPolygons: () => null,
  resolveSvgPolygons: () => null,
  getTextLayerStones: (id) => textStonesByLayerId[id] || [],
  isPointInActiveSelection: (p, sel) => activeSelectionAllows(p, sel),
  onStampPlace: ({ layerId }) => { stampCalls.push(layerId); },
  onStampRejected: (reason) => { stampCalls.push(`__rejected__:${reason}`); },
  onTracePlace: (placements, layerId, droppedCount = 0) => { traceHook = { kind: 'place', count: placements.length, layerId, droppedCount }; },
  onTraceRejected: (reason, layerId) => { traceHook = { kind: 'reject', reason, layerId }; },
  onEraseSweep: (daubs, layerId, corridors, mode) => { eraseHook = { kind: 'sweep', daubs: daubs.length, layerId, mode }; },
  onEraseRejected: (reason) => { eraseHook = { kind: 'reject', reason }; },
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

function sync(layers, textStones = {}) {
  currentLayers = layers;
  textStonesByLayerId = textStones;
  tool.syncFromProjectLayers(layers);
}
const layerIdOfShape = (shapeId) => (tool.debugShapes.find((s) => s.id === shapeId) || {}).layerId || null;

// Resolve a Stamp target at (xMm,yMm) exactly as a Stamp click does.
function resolveStampTargetLayerId(xMm, yMm) {
  tool.setMode('stamp');
  stampCalls = [];
  emit('mousedown', xMm, yMm);
  tool.setMode('select');
  assert.equal(stampCalls.length, 1, `expected exactly one onStampPlace/onStampRejected at (${xMm}, ${yMm})`);
  const only = stampCalls[0];
  return typeof only === 'string' && only.startsWith('__rejected__') ? only : (only || null);
}

// A REAL Trace drag: Trace mode, mousedown, N thinned mousedrag samples (>1mm apart -- the
// TRACE_MIN_SAMPLE_DISTANCE_MM gate), mouseup. Returns whatever reached onTracePlace/onTraceRejected.
function runTraceGesture(pts) {
  traceHook = null;
  tool.setMode('trace');
  emit('mousedown', pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i += 1) emit('mousedrag', pts[i].x, pts[i].y, pts[i - 1].x, pts[i - 1].y);
  const a = pts[pts.length - 1];
  const b = pts[pts.length - 2] || a;
  emit('mouseup', a.x, a.y, b.x, b.y);
  tool.setMode('select');
  return traceHook;
}

// A REAL Eraser gesture: Eraser mode, mousedown, mouseup (a plain click = one daub, per RS-3011
// decision 5). Returns whatever reached onEraseSweep/onEraseRejected.
function runEraserGesture(pts) {
  eraseHook = null;
  tool.setMode('eraser');
  emit('mousedown', pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i += 1) emit('mousedrag', pts[i].x, pts[i].y, pts[i - 1].x, pts[i - 1].y);
  const a = pts[pts.length - 1];
  const b = pts[pts.length - 2] || a;
  emit('mouseup', a.x, a.y, b.x, b.y);
  tool.setMode('select');
  return eraseHook;
}

// ---------------------------------------------------------------------------------------------
// app.js's OWN reject-handler source, sliced out brace-balanced and executed with fakes, so the
// asserted el('status') string is the exact string app.js produces -- not a copy that can drift.
// ---------------------------------------------------------------------------------------------
const appJs = await readFile(path.join(repoRoot, 'app.js'), 'utf8');

function extractBalanced(source, startMarker) {
  const start = source.indexOf(startMarker);
  assert.ok(start !== -1, `expected to find "${startMarker}" in app.js`);
  const braceStart = source.indexOf('{', start + startMarker.length - 1);
  let depth = 0;
  for (let i = braceStart; i < source.length; i += 1) {
    if (source[i] === '{') depth += 1;
    else if (source[i] === '}') { depth -= 1; if (depth === 0) return source.slice(start, i + 1); }
  }
  throw new Error(`unbalanced braces slicing "${startMarker}" from app.js`);
}

const layerLabelSrc = extractBalanced(appJs, 'function layerLabel(l){');
const layerLabel = new Function('SHAPE_DISPLAY_LABELS', `${layerLabelSrc}; return layerLabel;`)({});

// A mutable project ref so the extracted handler's `project.layers.find(...)` sees the current test's
// layers (the closure captures the object; each test reassigns .layers).
const projectRef = { layers: [] };

function buildRejectStatusFn(marker, sig, names, vals) {
  const arrowSrc = extractBalanced(appJs, marker);
  const bodySrc = arrowSrc.slice(arrowSrc.indexOf('=>') + 2);
  const box = { textContent: '' };
  const el = (id) => (id === 'status' ? box : {});
  const fn = new Function('el', ...names, `return ${sig}=>${bodySrc}`)(el, ...vals);
  return (...args) => { box.textContent = ''; fn(...args); return box.textContent; };
}
const traceRejectStatus = buildRejectStatusFn(
  'onTraceRejected:(reason,layerId)=>{', '(reason,layerId)', ['project', 'layerLabel'], [projectRef, layerLabel],
);
const eraseRejectStatus = buildRejectStatusFn(
  'onEraseRejected:(reason)=>{', '(reason)', [], [],
);

let passed = 0;
let failed = 0;
async function runTest(name, fn) {
  try { await fn(); console.log(`✓ ${name}`); passed += 1; }
  catch (error) { console.error(`✗ ${name}`); console.error(error); failed += 1; process.exitCode = 1; }
}

// ---- fixtures --------------------------------------------------------------------------------
// A real 'path' layer -- what Design's rectangle/pen tools commit (a closed contour + x/y/w/h box).
// Reachability: the user draws a shape in Design.
const pathLayer = (over = {}) => ({
  id: 'path-A', type: 'path', visible: true, pathName: 'Ring',
  contours: [[{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }]],
  x: 100, y: 100, w: 60, h: 60, stoneSize: 2, gap: 0.3, color: 'gold',
  ...over,
});
// A 'text' layer whose bbox proxy is made to cover a region. Reachability: the user adds a Text
// layer (or a monogram emits a joined-string 'text' layer for its lettering).
const textLayer = (over = {}) => ({
  id: 'text-over', type: 'text', visible: true, text: 'AB', font: 'rs-block',
  x: 120, y: 120, stoneSize: 2, gap: 0.3, color: 'gold',
  height: 12, align: 'left', lineSpacing: 1, rotationDeg: 0, ...over,
});
const boxStones = (lo, hi) => [
  { x: lo, y: lo, d: 2, color: 'gold' }, { x: hi, y: lo, d: 2, color: 'gold' },
  { x: lo, y: hi, d: 2, color: 'gold' }, { x: hi, y: hi, d: 2, color: 'gold' },
];
const textOverPathStones = boxStones(106, 154);
const P = { x: 120, y: 120 };

// =============================================================================================
// 1. Named negative control -- Stamp, one point, two boards, both resolved ids printed.
// =============================================================================================
await runTest('negative control: path alone resolves to the path; text-over-path also resolves to the path (skips the text proxy)', () => {
  sync([pathLayer()]);
  const aId = resolveStampTargetLayerId(P.x, P.y);

  sync([pathLayer(), textLayer()], { 'text-over': textOverPathStones });
  const bId = resolveStampTargetLayerId(P.x, P.y);

  console.log(`    negative control -- board A (path alone): resolved layerId = ${JSON.stringify(aId)}`);
  console.log(`    negative control -- board B (text over path): resolved layerId = ${JSON.stringify(bId)}`);
  console.log('    (before RS-3015, board B would have resolved "text-over"; after, "path-A")');

  assert.equal(aId, 'path-A', 'board A: a lone path resolves to itself (resolver still works)');
  assert.equal(bId, 'path-A', 'board B: the mark falls through the ineligible text proxy to the path');

  const selectHit = layerIdOfShape(tool.debugHitTestShapeId(P.x, P.y));
  console.log(`    Select (hitTestShapeId) at the same point resolves layerId = ${JSON.stringify(selectHit)}`);
  assert.equal(selectHit, 'text-over', 'Select still picks the topmost shape whose interior contains the point');
});

// =============================================================================================
// 2. Real MonogramGenerator result -- frame 'path' + letter 'text', not a synthetic stand-in.
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

await runTest('a Stamp on a real generated monogram resolves the frame path, not the letter text layer', async () => {
  const result = await realGenerator.generate({
    frameId: 'circle', layoutId: MONOGRAM_LAYOUTS.SINGLE, letters: ['A'],
    fontId: 'rs-block', providerId: 'rhinestone', stoneSizeMm: 2.0, color: 'gold',
    frameRect: { xMm: 70, yMm: 70, widthMm: 80, heightMm: 80 },
    canvasMm: { widthMm: 240, heightMm: 240 }, frameOptions: {},
  });
  assert.equal(result.ok, true, result.message);
  const framePathLayer = result.layers.find((l) => l.type === 'path');
  const letterTextLayer = result.layers.find((l) => l.type === 'text');
  assert.ok(framePathLayer && letterTextLayer, 'the generated monogram emits a frame path + a letter text layer');

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
  const letterStones = raw.stones.map((st) => ({ x: st.xMm - gx + cx, y: st.yMm - gy + cy, d: st.sizeMm, color: st.color }));

  sync([framePathLayer, letterTextLayer], { [letterTextLayer.id]: letterStones });
  const selectHit = layerIdOfShape(tool.debugHitTestShapeId(cx, cy));
  assert.equal(selectHit, letterTextLayer.id, 'Select picks the letter text proxy at the frame centre');
  const resolved = resolveStampTargetLayerId(cx, cy);
  console.log(`    monogram -- Select resolves ${JSON.stringify(selectHit)}; mark resolver resolves ${JSON.stringify(resolved)} (frame = ${JSON.stringify(framePathLayer.id)})`);
  assert.equal(resolved, framePathLayer.id, 'the stamp falls through the letter text proxy to the frame path');
});

// =============================================================================================
// 3. No eligible shape at all -> Stamp resolves null (kept from commit 2).
//    Reachability: the user deleted a monogram's frame, keeping the lettering, and clicks Stamp.
// =============================================================================================
await runTest('a board with no path layer resolves null for Stamp (nothing to place a mark on)', () => {
  sync([textLayer()], { 'text-over': textOverPathStones });
  const resolved = resolveStampTargetLayerId(P.x, P.y);
  console.log(`    no-eligible-shape -- Stamp resolved layerId = ${JSON.stringify(resolved)}`);
  assert.equal(resolved, null, 'no path proxy under the point -> null');
});

// =============================================================================================
// 4-8. Trace / Eraser -- REAL gestures, each asserting BOTH the reason the tool emitted AND the
//      exact el('status') string app.js's own onTraceRejected / onEraseRejected produces for it.
// =============================================================================================

// 4. Trace over one ineligible shape, nothing beneath.
//    Reachability: the user picks Trace and drags along a monogram's lettering (a 'text' proxy) --
//    or any lone 'text'/'svg'/'image'/'circle'/'rectangle' layer -- with no drawn shape under it.
await runTest('Trace over an ineligible shape with nothing beneath -> reason "ineligible" + its status string', () => {
  sync([textLayer()], { 'text-over': boxStones(100, 150) });
  const hook = runTraceGesture([{ x: 108, y: 120 }, { x: 120, y: 122 }, { x: 138, y: 124 }]);
  assert.deepEqual(hook, { kind: 'reject', reason: 'ineligible', layerId: undefined },
    'a Trace drag wholly over a non-path proxy rejects as "ineligible", no layerId');
  projectRef.layers = currentLayers;
  const status = traceRejectStatus(hook.reason, hook.layerId);
  console.log(`    Trace/ineligible -- reason = ${JSON.stringify(hook.reason)} ; status = ${JSON.stringify(status)}`);
  assert.equal(status, 'Trace: that layer cannot take traced marks — only drawn shapes can.');
});

// 5. Trace over an empty board.
//    Reachability: the user picks Trace and drags across blank canvas.
await runTest('Trace over an empty board -> reason "no-target" + its status string', () => {
  sync([]);
  const hook = runTraceGesture([{ x: 40, y: 40 }, { x: 55, y: 45 }, { x: 72, y: 50 }]);
  assert.deepEqual(hook, { kind: 'reject', reason: 'no-target', layerId: undefined },
    'a Trace drag over nothing rejects as "no-target"');
  projectRef.layers = currentLayers;
  const status = traceRejectStatus(hook.reason, hook.layerId);
  console.log(`    Trace/no-target -- reason = ${JSON.stringify(hook.reason)} ; status = ${JSON.stringify(status)}`);
  assert.equal(status, 'Trace: nothing under the stroke to trace along.');
});

// 6. Trace over a real 'path' layer whose stones are not generated yet.
//    Reachability: the user draws a shape in Design (stonesGenerated === false until "Generate
//    Stones" is pressed), then -- without pressing it -- picks Trace and drags along the shape.
await runTest('Trace over a path layer with stonesGenerated:false -> reason "no-stones" + its status string (names the layer, points at Generate Stones)', () => {
  sync([pathLayer({ stonesGenerated: false })]);
  const hook = runTraceGesture([{ x: 112, y: 130 }, { x: 128, y: 132 }, { x: 146, y: 134 }]);
  assert.equal(hook.kind, 'reject', 'a Trace drag over a stones-pending path rejects');
  assert.equal(hook.reason, 'no-stones', 'reason is "no-stones", NOT "ineligible" -- a drawn shape CAN hold stones');
  assert.equal(hook.layerId, 'path-A', 'the layerId is passed so app.js can name the layer');
  projectRef.layers = currentLayers;
  const status = traceRejectStatus(hook.reason, hook.layerId);
  console.log(`    Trace/no-stones -- reason = ${JSON.stringify(hook.reason)} ; layerId = ${JSON.stringify(hook.layerId)} ; status = ${JSON.stringify(status)}`);
  assert.equal(status, 'Trace: press Generate Stones on Ring before tracing along it.');
});

// 7. Eraser over one ineligible shape, nothing beneath.
//    Reachability: the user picks Eraser and clicks/sweeps on a lone 'text'/'svg'/'image' layer.
await runTest('Eraser over an ineligible shape with nothing beneath -> reason "ineligible" + its status string', () => {
  sync([textLayer()], { 'text-over': boxStones(100, 150) });
  const hook = runEraserGesture([{ x: 122, y: 124 }]);
  assert.deepEqual(hook, { kind: 'reject', reason: 'ineligible' },
    'an Eraser sweep wholly over a non-path proxy rejects as "ineligible"');
  const status = eraseRejectStatus(hook.reason);
  console.log(`    Eraser/ineligible -- reason = ${JSON.stringify(hook.reason)} ; status = ${JSON.stringify(status)}`);
  assert.equal(status, 'Eraser: that layer has no erasable marks — only drawn shapes do.');
});

// 8. Eraser over an empty board.
//    Reachability: the user picks Eraser and clicks blank canvas.
await runTest('Eraser over an empty board -> reason "no-target" + its status string', () => {
  sync([]);
  const hook = runEraserGesture([{ x: 30, y: 30 }]);
  assert.deepEqual(hook, { kind: 'reject', reason: 'no-target' },
    'an Eraser sweep over nothing rejects as "no-target"');
  const status = eraseRejectStatus(hook.reason);
  console.log(`    Eraser/no-target -- reason = ${JSON.stringify(hook.reason)} ; status = ${JSON.stringify(status)}`);
  assert.equal(status, 'Eraser: nothing under the sweep to erase.');
});

// 9. Regression / named negative control for the reason plumbing: Trace's pre-existing
//    selection-boundary rejection still produces RS-3012's exact message, verbatim. If every reason
//    collapsed to one string this is the test that fails.
//    Reachability: the user makes a Paint region / Select selection, then picks Trace and drags
//    entirely outside the selected region.
await runTest('Trace entirely outside an active selection -> reason "outside-selection" + RS-3012\'s exact message (regression)', () => {
  sync([pathLayer()]);
  // A real active-selection state (a region), set through the tool's own public entry point.
  tool.setActiveSelectionToRegion('path-A', 'reg-1', [
    { xMm: 5, yMm: 5 }, { xMm: 15, yMm: 5 }, { xMm: 15, yMm: 15 }, { xMm: 5, yMm: 15 },
  ]);
  activeSelectionAllows = () => false; // every spaced stone lands outside the region
  try {
    const hook = runTraceGesture([{ x: 112, y: 130 }, { x: 128, y: 132 }, { x: 146, y: 134 }]);
    assert.deepEqual(hook, { kind: 'reject', reason: 'outside-selection', layerId: undefined },
      'a Trace drag whose every spaced stone is outside the selection rejects as "outside-selection"');
    projectRef.layers = currentLayers;
    const status = traceRejectStatus(hook.reason, hook.layerId);
    console.log(`    Trace/outside-selection -- reason = ${JSON.stringify(hook.reason)} ; status = ${JSON.stringify(status)}`);
    assert.equal(status, 'Trace: entire stroke was outside the selection.',
      'RS-3012\'s wording is preserved verbatim -- the reasons did not collapse to one string');
  } finally {
    activeSelectionAllows = () => true;
    tool.clearActiveSelection();
  }
});

// 10. All four Trace status strings are distinct, and both Eraser strings are distinct (the
//     collapse this whole plumbing exists to prevent).
await runTest('every Trace reason and every Eraser reason maps to a DISTINCT status string', () => {
  projectRef.layers = [pathLayer()];
  const traceStrings = [
    traceRejectStatus('no-target'),
    traceRejectStatus('ineligible'),
    traceRejectStatus('no-stones', 'path-A'),
    traceRejectStatus('outside-selection'),
  ];
  const eraseStrings = [eraseRejectStatus('no-target'), eraseRejectStatus('ineligible')];
  console.log(`    Trace strings: ${JSON.stringify(traceStrings, null, 0)}`);
  console.log(`    Eraser strings: ${JSON.stringify(eraseStrings, null, 0)}`);
  assert.equal(new Set(traceStrings).size, 4, 'four distinct Trace status strings');
  assert.equal(new Set(eraseStrings).size, 2, 'two distinct Eraser status strings');
});

// =============================================================================================
// 11. Registration
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
