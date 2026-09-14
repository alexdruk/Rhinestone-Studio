// MONO-021 commit 5 -- every Design tool hook (Stamp / Trace / Eraser both modes / Paint) accepts a
// 'text' layer, and a text edit that MOVES NO BOUNDS (a stamp on a bead, an erase, a Paint recolour)
// still renders on Design's canvas.
//
// THE REBUILD GATE (milestone prompt Section 1, "the highest-risk item"):
// syncFromProjectLayers()'s existing-text branch rebuilds the on-canvas stone Group only when the
// proxy's rendered BOUNDS change. A stamp placed ON an existing bead extends nothing -> the gate
// does NOT fire -> without commit 5's fix the stamp is stored in project.layers, applied by the
// engine, reported as placed, and never drawn (markStones goes stale beside it). commit 5 makes the
// text mark/paint hooks call refreshStoneGroupForLayer() after updateAll(), which MONO-021 makes
// dispatch to rebuildTextStoneGroupForShape() UNCONDITIONALLY for a text proxy.
//
// This file drives the REAL Stamp pointer gesture through paper.tool (never a direct hook call) and
// asserts the on-canvas stone Group + item.data.markStones, with a NAMED NEGATIVE CONTROL that runs
// the same gesture through the OLD gated path (syncFromProjectLayers only) and shows the Group did
// NOT change -- if the control shows the stone appearing, the test is not exercising the gate.
//
// The engine-level edit application (frozen box, regions colour-only, erase ordering, the proximity
// resolver's discrimination) is covered by tools/test-mono-021-text-layer-edits.mjs. The app.js
// wiring that has been forgotten three times in this codebase is checked here by executing /
// slicing app.js's own source.

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

// jsdom has no 2D context -- StoneSpriteCache.js's offscreen bake needs a dependency-free fake
// (same stub convention as tools/test-rs3015-mark-target-eligibility.mjs). The sprite pixels are
// never asserted here; only the Group's child count is.
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
// Harness -- real createDrawingTool + real syncFromProjectLayers. getTextLayerStones() is a live
// getter over a mutable per-layer bead list, exactly as app.js's getTextLayerStones() is a filter
// over the `layout` global.
// ---------------------------------------------------------------------------------------------
let textStonesByLayerId = {};
let stampCalls = [];

const tool = createDrawingTool(canvas, {
  onShapeResized: () => {}, onShapeRotated: () => {}, onShapeMoved: () => {},
  getLayerStoneParams: () => null,
  generatePathLayout: () => [],
  resolveShapeLibraryPolygons: () => null,
  resolveSvgPolygons: () => null,
  getTextLayerStones: (id) => textStonesByLayerId[id] || [],
  onStampPlace: ({ layerId }) => { stampCalls.push({ kind: 'place', layerId }); },
  onStampRejected: (reason) => { stampCalls.push({ kind: 'reject', reason }); },
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

const textLayer = (over = {}) => ({
  id: 'T', type: 'text', visible: true, text: 'AB', font: 'rs-block',
  x: 0, y: 0, stoneSize: 2, gap: 0.3, color: 'gold',
  height: 12, align: 'left', lineSpacing: 1, rotationDeg: 0, ...over,
});

// A tight bead cluster -- AABB roughly (99,99)-(105,105). A stamp at the centre bead (102,102) sits
// INSIDE that AABB, so a re-sync sees no bounds change (the gate this test exists for).
const CLUSTER = [
  { x: 100, y: 100, d: 2, color: 'gold' },
  { x: 104, y: 100, d: 2, color: 'gold' },
  { x: 100, y: 104, d: 2, color: 'gold' },
  { x: 104, y: 104, d: 2, color: 'gold' },
  { x: 102, y: 102, d: 2, color: 'gold' },
];

// paper.tool is a singleton and this file shares one `tool` across tests -- freshSync() prunes
// everything first so each test's text proxy is materialized fresh (the new-layer branch, which
// always rebuilds the Group), never reconciled against a previous test's stale proxy bounds.
// regatedSync() is a plain reconcile of an ALREADY-materialized proxy -- the "old gated path" whose
// bounds-only rebuild gate is exactly what test 1's negative control probes.
function freshSync(layers) { tool.syncFromProjectLayers([]); tool.syncFromProjectLayers(layers); }
function regatedSync(layers) { tool.syncFromProjectLayers(layers); }

// A REAL Stamp click through paper.tool.
function runStampClick(xMm, yMm) {
  tool.setMode('stamp');
  stampCalls = [];
  emit('mousedown', xMm, yMm);
  emit('mouseup', xMm, yMm);
  tool.setMode('select');
  assert.equal(stampCalls.length, 1, `expected exactly one Stamp hook call at (${xMm},${yMm})`);
  return stampCalls[0];
}

// ---------------------------------------------------------------------------------------------
// 1. THE REBUILD GATE -- a stamp ON a bead (inside the letter's bounds) renders and refreshes
//    markStones.  NEGATIVE CONTROL: the same gesture through the old gated path shows no change.
// ---------------------------------------------------------------------------------------------
await runTest('1. a Stamp placed ON a bead renders (stone Group +1) and refreshes item.data.markStones', () => {
  textStonesByLayerId = { T: [...CLUSTER] };
  freshSync([textLayer()]);

  const before = tool.debugStoneState('T');
  assert.equal(before.stoneGroupCount, 5, 'precondition: 5 beads on the canvas');

  // Drive the real gesture. Its hook resolves the text layer by bead proximity (the click is on the
  // (102,102) bead centre). Then emulate app.js's onStampPlace text path: the engine appends the
  // stamp to the layer's rendered stones, and the hook calls refreshStoneGroupForLayer() AFTER the
  // (here: synchronous) regen -- exactly commit 5's fix.
  const hook = runStampClick(102, 102);
  assert.deepEqual(hook, { kind: 'place', layerId: 'T' }, 'the Stamp resolves the text layer, not empty canvas');

  const NEW_STONE = { x: 102, y: 102, d: 2, color: 'ruby' };
  textStonesByLayerId = { T: [...CLUSTER, NEW_STONE] };
  tool.refreshStoneGroupForLayer('T'); // commit 5: dispatches to rebuildTextStoneGroupForShape for a text proxy

  const after = tool.debugStoneState('T');
  console.log(`   passing: stone Group ${before.stoneGroupCount} -> ${after.stoneGroupCount}; markStones ${before.markStones.length} -> ${after.markStones.length}`);
  assert.equal(after.stoneGroupCount, 6, 'the stamp renders -- stone Group grew by one');
  assert.ok(after.markStones.some((s) => s.x === 102 && s.y === 102 && s.d === 2),
    'item.data.markStones contains the new stone -- the mark resolver will not go stale beside it');
});

await runTest('1. NEGATIVE CONTROL: the same gesture through the OLD gated path (syncFromProjectLayers only) does NOT render the stamp', () => {
  textStonesByLayerId = { T: [...CLUSTER] };
  freshSync([textLayer()]);
  const before = tool.debugStoneState('T');
  assert.equal(before.stoneGroupCount, 5);

  runStampClick(102, 102);

  // The old path: the stamp is in the rendered stone list, but the hook relies ONLY on
  // syncFromProjectLayers()'s bounds-gated rebuild (regatedSync = a plain reconcile, no prune). The
  // stamp is inside the bead AABB, so bounds do not change -> the gate does not fire -> no rebuild.
  const NEW_STONE = { x: 102, y: 102, d: 2, color: 'ruby' };
  textStonesByLayerId = { T: [...CLUSTER, NEW_STONE] };
  regatedSync([textLayer()]); // NO refreshStoneGroupForLayer()

  const after = tool.debugStoneState('T');
  console.log(`   control: stone Group ${before.stoneGroupCount} -> ${after.stoneGroupCount} (unchanged -- the gate did not fire); markStones still ${after.markStones.length}`);
  assert.equal(after.stoneGroupCount, 5, 'the gate did NOT fire -- proves the fix in test 1 is doing real work');
  assert.equal(after.markStones.length, 5, 'markStones stayed stale too -- exactly the failure mode commit 5 closes');
});

// ---------------------------------------------------------------------------------------------
// 2. A stamp OUTSIDE the letter bounds is caught by syncFromProjectLayers()'s own bounds change --
//    the two paths are complementary, and refreshStoneGroupForLayer() covers both.
// ---------------------------------------------------------------------------------------------
await runTest('2. a stamp OUTSIDE the letter bounds also renders (via the bounds-change path AND the unconditional refresh)', () => {
  textStonesByLayerId = { T: [...CLUSTER] };
  freshSync([textLayer()]);

  const FAR = { x: 160, y: 102, d: 2, color: 'ruby' }; // well past the cluster's right edge
  textStonesByLayerId = { T: [...CLUSTER, FAR] };
  regatedSync([textLayer()]); // bounds DID change -> the gate fires on its own
  assert.equal(tool.debugStoneState('T').stoneGroupCount, 6, 'a far stamp grows the bounds, so sync alone rebuilds');

  tool.refreshStoneGroupForLayer('T'); // and the unconditional refresh is idempotent, not double-counting
  assert.equal(tool.debugStoneState('T').stoneGroupCount, 6, 'refreshStoneGroupForLayer() is idempotent');
});

// ---------------------------------------------------------------------------------------------
// 3. refreshStoneGroupForLayer() dispatches to the TEXT rebuild for a text proxy (never the 'path'
//    rebuildStoneGroupForShape, which would ask the null getLayerStoneParams() and drop the Group).
// ---------------------------------------------------------------------------------------------
await runTest('3. refreshStoneGroupForLayer() on a text proxy keeps the Group (dispatches to rebuildTextStoneGroupForShape, not the path rebuild)', () => {
  textStonesByLayerId = { T: [...CLUSTER] };
  freshSync([textLayer()]);
  tool.refreshStoneGroupForLayer('T');
  const state = tool.debugStoneState('T');
  assert.equal(state.stoneGroupCount, 5, 'the path rebuild would have dropped this to 0 (getLayerStoneParams is null for text)');
  assert.equal(state.markStones.length, 5, 'markStones refreshed from the same stones argument');
});

// ---------------------------------------------------------------------------------------------
// app.js SOURCE -- the wiring gaps this milestone's own spec flags as forgotten three times.
// ---------------------------------------------------------------------------------------------
const appJs = await readFile(path.join(repoRoot, 'app.js'), 'utf8');

function sliceBalanced(source, startMarker) {
  const start = source.indexOf(startMarker);
  assert.ok(start !== -1, `expected "${startMarker}" in app.js`);
  const braceStart = source.indexOf('{', start + startMarker.length - 1);
  let depth = 0;
  for (let i = braceStart; i < source.length; i += 1) {
    if (source[i] === '{') depth += 1;
    else if (source[i] === '}') { depth -= 1; if (depth === 0) return source.slice(start, i + 1); }
  }
  throw new Error(`unbalanced braces slicing "${startMarker}"`);
}

await runTest('4. generateTextStonesLive() forwards regions/stampedStones/erasedGridPositions/naturalBoundingBoxMm into its OWN generateTextLayout() call (Section 5.2)', () => {
  const body = sliceBalanced(appJs, 'async generateTextStonesLive(layer,project,{includeStats=false}={}){');
  for (const field of ['regions:layer.regions', 'stampedStones:layer.stampedStones', 'erasedGridPositions:layer.erasedGridPositions', 'naturalBoundingBoxMm:layer.naturalBoundingBoxMm']) {
    assert.ok(body.includes(field), `generateTextStonesLive() must pass ${field} -- without it the edit stores to disk and never renders`);
  }
  console.log('   passing: all four edit fields are in generateTextStonesLive()\'s base object');
});

await runTest('5. buildTextLayoutBaseParams() does NOT carry the edit fields (recoverStaleAuthoredScales() must keep seeing the pure natural layout)', () => {
  const body = sliceBalanced(appJs, 'function buildTextLayoutBaseParams(layer){');
  for (const field of ['regions:', 'stampedStones:', 'erasedGridPositions:', 'naturalBoundingBoxMm:']) {
    assert.ok(!body.includes(field), `buildTextLayoutBaseParams() must NOT carry ${field} -- Section 5.2`);
  }
  console.log('   passing: buildTextLayoutBaseParams() is still the pure-natural-layout builder');
});

await runTest('6. onStampPlace / onTracePlace / onEraseSweep accept a text layer target', () => {
  for (const marker of ['onStampPlace:async({xMm,yMm,layerId})=>{', 'onTracePlace:async(placements,layerId,droppedCount=0)=>{', 'onEraseSweep:async(daubsAbsoluteMm,layerId,corridorPolygonsAbsoluteMm,mode)=>{']) {
    const body = sliceBalanced(appJs, marker);
    assert.ok(/l\.type===['"]path['"]\|\|l\.type===['"]text['"]/.test(body.replace(/\s/g, '')),
      `${marker.slice(0, 20)}... must widen its project.layers.find() to 'path' OR 'text'`);
  }
  console.log('   passing: all three mark hooks resolve a text layer');
});

await runTest('7. onEraseSweep\'s text branch precedes the contour-cutting branch and never touches eraseDaubs', () => {
  const body = sliceBalanced(appJs, 'onEraseSweep:async(daubsAbsoluteMm,layerId,corridorPolygonsAbsoluteMm,mode)=>{');
  const textAt = body.indexOf("targetLayer.type==='text'");
  const outlineAt = body.indexOf("if(mode==='outline'){");
  assert.ok(textAt !== -1 && outlineAt !== -1, 'both branches present');
  assert.ok(textAt < outlineAt, 'the text branch must come BEFORE the contour-cutting outline branch (Section 5.4)');
  const textBranch = body.slice(textAt, outlineAt);
  assert.ok(!/eraseDaubs\s*(=|\.push)/.test(textBranch), 'the text erase branch must never WRITE eraseDaubs (Section 2.2)');
  assert.ok(textBranch.includes('erasedGridPositions') && textBranch.includes('stampedStones'), 'it writes the same two fields Stones mode does');
  console.log('   passing: text erase branch is first, writes erasedGridPositions + splices stampedStones, never eraseDaubs');
});

await runTest('8. onPaintStroke has a text branch that avoids absolutePolygonsToNaturalSpace(); resolvePaintTargetTwoPass builds culled disc candidates', () => {
  const paint = sliceBalanced(appJs, 'onPaintStroke:async(lassoPolygons)=>{');
  const textAt = paint.indexOf("targetLayer.type==='text'");
  assert.ok(textAt !== -1, 'onPaintStroke must have a text branch (Section 6.0 -- absolutePolygonsToNaturalSpace throws for text)');
  const textBranch = paint.slice(textAt);
  assert.ok(textBranch.includes('textEditPolygonToStored'), 'the text branch converts via the frozen-box helper, not absolutePolygonsToNaturalSpace');
  assert.ok(/colour only/i.test(textBranch), 'the colour-only status message is folded in here');

  const resolve = sliceBalanced(appJs, 'function resolvePaintTargetTwoPass(polygonsAbsoluteMm){');
  assert.ok(resolve.includes('beadDiscPolygon'), 'text candidates are 16-gon discs per bead');
  assert.ok(resolve.includes('aabbOverlap'), 'text candidates are AABB-culled against the lasso BEFORE selectPaintTarget()');
  console.log('   passing: onPaintStroke text branch + disc candidates + bbox culling all present');
});

await runTest('9. this test file is registered in its group and the default suite', () => {
  assertTestRegistered({ filename: 'test-mono-021-mark-hooks.mjs', group: 'editing', includedInDefault: true });
});

if (failed === 0) console.log(`\nMONO-021 mark-hook tests passed (${passed}).`);
else console.error(`\nMONO-021 mark-hook tests FAILED (${failed} of ${passed + failed}).`);
