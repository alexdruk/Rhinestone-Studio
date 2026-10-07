// IMG-026 build D -- editing ai-layout stones in Design. The N2_cat figures come from
// services/strass-layout/prototype/expected/N2_cat_final_rs.json, cropped with the S1 rule by the C1
// test's own cropS1() (sliced out of tools/test-img-026-ai-layout-engine.mjs and run here); nothing
// about the cat is pasted in. See docs/specifications/IMG-026-StrassLayoutService.md, "Editing in
// Design (build D)" and "Acceptance figures" (Build D).
//
// Three harnesses:
//  - the pure module src/redraw/AiLayoutEdit.js against the real GeometryEngine;
//  - one app.js sandbox running app.js's own source (generate(), the ai-layout branch of
//    generateImageStonesLive(), layoutStonesForLayer(), editAiLayoutStones(), the history functions,
//    the Stamp/Trace/Eraser hooks, onShapeResized, the Design keyboard block, deleteCurrentSelection()
//    and updateProdSheetReadabilityValidation()), sliced brace-balanced and run with new Function();
//  - the real createDrawingTool() under loadPaperForNode(), driven by pointer gestures through
//    paper.tool.emit(), as tools/test-img-020-image-stones-in-design.mjs runs it.

import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertTestRegistered } from './lib/test-registration-assertions.mjs';
import { loadPaperForNode } from './lib/paper-node-env.mjs';

const paper = await loadPaperForNode();
globalThis.requestAnimationFrame = (fn) => { fn(0); return 0; };
globalThis.cancelAnimationFrame = () => {};

const { createDrawingTool } = await import('../src/drawing/index.js');
const { GeometryEngine, Stone, StoneLayout, dedupeStonesByRadius, isPointInsidePolygons } = await import('../src/geometry/index.js');
const { aiLayoutPointFromAbsolute, aiLayoutDeltaFromAbsolute, applyAiLayoutEdits, aiLayoutBoxSize, AI_LAYOUT_MAX_STONES } = await import('../src/redraw/index.js');
const { STONE_COLORS } = await import('../src/renderer/StoneColors.js');
const { LEGACY_IMAGE_COLOR_IDS } = await import('../src/renderer/CrystalColors.js');
const { listAllStoneSizes, findStoneSizeByDiameterMm, formatStoneSizeLabel } = await import('../src/renderer/StoneSizes.js');
const { AI_STONE_NUDGE_STEP_MM, AI_STONE_NUDGE_STEP_LARGE_MM } = await import('../src/editing/index.js');
const { HistoryManager } = await import('../src/history/index.js');
const { formatLengthDisplay, unitSuffix } = await import('../src/units/index.js');
const { countStonesOutsideProductionArea } = await import('../src/export/ProductionSheetExporter.js');
const { FontManager } = await import('../src/fonts/index.js');
const { createDefaultFontProviderRegistry } = await import('../src/text/index.js');
const { createImageBuffer } = await import('../src/image/index.js');
const { validateRhsProject, generateProjectStoneLayout } = await import('./lib/rhsProject.mjs');
const { buildRegressionCases } = await import('./lib/imageTraceFixtures.mjs');

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const read = (rel) => readFile(path.join(repoRoot, rel), 'utf8');
const appJs = await read('app.js');
const c1Test = await read('tools/test-img-026-ai-layout-engine.mjs');
const catJson = JSON.parse(await read('services/strass-layout/prototype/expected/N2_cat_final_rs.json'));
const engine = new GeometryEngine();

let failures = 0;
let passes = 0;
async function test(name, fn) {
  try { await fn(); console.log(`✓ ${name}`); passes++; }
  catch (error) { failures++; console.error(`✗ ${name}`); console.error(error); }
}

function extract(marker, source = appJs) {
  const start = source.indexOf(marker);
  assert.ok(start !== -1, `app.js is missing ${marker}`);
  assert.equal(source.indexOf(marker, start + 1), -1, `${marker} is not unique in app.js`);
  let depth = 0;
  const open = marker.endsWith('{') ? start + marker.length - 1 : source.indexOf('{', start);
  for (let i = open; i < source.length; i++) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}') { depth--; if (depth === 0) return source.slice(start, i + 1); }
  }
  throw new Error(`no closing brace for ${marker}`);
}
// An arrow-function property of the createDrawingTool hooks object, as a plain arrow expression.
const hookArrow = (marker) => extract(marker).slice(marker.indexOf(':') + 1);

// ---- N2_cat, cropped with the S1 rule by the C1 test's helper ------------------------------------

const cropSource = c1Test.slice(c1Test.indexOf('const round3 = '), c1Test.indexOf('const CAT = '));
assert.ok(cropSource.includes('function cropS1(stones)'), 'the C1 test still defines cropS1()');
const cropS1 = new Function(`${cropSource}\nreturn cropS1;`)();
const CAT = cropS1(catJson.stones);
const catAiLayout = () => ({ ...CAT, stones: CAT.stones.map((t) => [...t]), report: {}, editCount: 0 });
function catLayer(over = {}) {
  const aiLayout = over.aiLayout || catAiLayout();
  return {
    id: 'I', type: 'image', visible: true, imageSrc: 'data:image/png;base64,AAAA', imageName: 'N2_cat (AI redraw)',
    x: 30, y: 20, w: aiLayout.widthMm, h: aiLayout.heightMm, rotationDeg: 0,
    fillMode: 'ai-layout', aiLayout, colorSwaps: {}, ...over
  };
}
const placed = (layer) => engine.generateImageLayout({
  mode: 'ai-layout', layerId: layer.id, xMm: layer.x, yMm: layer.y, widthMm: layer.w,
  rotationDeg: layer.rotationDeg ?? 0, aiLayout: layer.aiLayout, colorSwaps: layer.colorSwaps ?? {}
});
const KS = [1, 1.5, 2];
const ROTATIONS = [0, 30, 90];
const deepCopy = (v) => JSON.parse(JSON.stringify(v));

await test('0. the N2_cat reference crops to 2146 stones with no gap violation', () => {
  assert.equal(CAT.stones.length, 2146);
  const out = placed(catLayer());
  assert.equal(out.aiLayoutStats.violations, 0);
  assert.ok(out.stones.every((s, i) => s.metadata.aiIndex === i && s.metadata.gapViolation === undefined));
});

// ---- AiLayoutEdit.js: the inverse of the engine ------------------------------------------------

await test('1. aiLayoutPointFromAbsolute() inverts the engine within 1e-9 mm before rounding, at k = 1, 1.5, 2 and rotation 0, 30, 90', () => {
  for (const k of KS) for (const rotationDeg of ROTATIONS) {
    const layer = catLayer({ rotationDeg });
    layer.w = k * CAT.widthMm; layer.h = k * CAT.heightMm;
    const stones = placed(layer).stones;
    let worst = 0;
    for (const s of stones) {
      const [x, y] = CAT.stones[s.metadata.aiIndex];
      const p = aiLayoutPointFromAbsolute(layer, s);
      worst = Math.max(worst, Math.abs(p.xMm - x), Math.abs(p.yMm - y));
    }
    assert.ok(worst <= 1e-9, `k=${k} rotation=${rotationDeg}: worst ${worst}`);
    const d = aiLayoutDeltaFromAbsolute(layer, { dxMm: stones[5].xMm - stones[0].xMm, dyMm: stones[5].yMm - stones[0].yMm });
    assert.ok(Math.abs(d.dxMm - (CAT.stones[5][0] - CAT.stones[0][0])) <= 1e-9 && Math.abs(d.dyMm - (CAT.stones[5][1] - CAT.stones[0][1])) <= 1e-9, `delta at k=${k} rotation=${rotationDeg}`);
  }
});

await test('2. an add round trip through applyAiLayoutEdits() and the engine lands within k * 0.0005 * sqrt(2) + 1e-9 mm (the 0.001 mm rounding bound)', () => {
  for (const k of KS) for (const rotationDeg of ROTATIONS) {
    const layer = catLayer({ rotationDeg });
    layer.w = k * CAT.widthMm; layer.h = k * CAT.heightMm;
    const bound = k * 0.0005 * Math.SQRT2 + 1e-9;
    let worst = 0;
    for (let i = 0; i < 60; i++) {
      const at = { xMm: layer.x + (i * 37.13) % layer.w, yMm: layer.y + (i * 53.77) % layer.h };
      const { aiLayout } = applyAiLayoutEdits(layer, [{ op: 'add', stones: [{ ...at, sizeId: 'ss6', colorId: 'jet' }] }]);
      const back = placed({ ...layer, aiLayout }).stones.find((s) => s.metadata.aiIndex === CAT.stones.length);
      worst = Math.max(worst, Math.hypot(back.xMm - at.xMm, back.yMm - at.yMm));
    }
    assert.ok(worst <= bound, `k=${k} rotation=${rotationDeg}: worst ${worst} > ${bound}`);
    console.log(`   k=${k} rotation=${rotationDeg}: worst ${worst.toFixed(6)} mm <= ${bound.toFixed(6)} mm`);
  }
});

// ---- AiLayoutEdit.js: applyAiLayoutEdits() on N2_cat --------------------------------------------

const changedIndices = (a, b) => a.map((t, i) => (JSON.stringify(t) === JSON.stringify(b[i]) ? -1 : i)).filter((i) => i >= 0);

await test('3. each op changes exactly the stones it names; editCount goes up by 1 per call; the layer is never mutated', () => {
  const layer = catLayer({ rotationDeg: 30, w: 1.5 * CAT.widthMm, h: 1.5 * CAT.heightMm });
  const before = deepCopy(layer);
  const picked = [3, 700, 2145];

  const moved = applyAiLayoutEdits(layer, [{ op: 'move', indices: picked, dxMm: 1.2, dyMm: -0.4 }]);
  assert.deepEqual(changedIndices(CAT.stones, moved.aiLayout.stones), picked);
  const d = aiLayoutDeltaFromAbsolute(layer, { dxMm: 1.2, dyMm: -0.4 });
  for (const i of picked) {
    assert.ok(Math.abs(moved.aiLayout.stones[i][0] - (CAT.stones[i][0] + d.dxMm)) <= 0.0005 + 1e-12);
    assert.equal(moved.aiLayout.stones[i][0], Math.round(moved.aiLayout.stones[i][0] * 1000) / 1000, 'rounded to 0.001 mm');
  }
  assert.equal(moved.aiLayout.editCount, 1);

  const resized = applyAiLayoutEdits({ ...layer, aiLayout: moved.aiLayout }, [{ op: 'resize', indices: [10, 11], sizeId: 'ss30' }]);
  assert.deepEqual(changedIndices(moved.aiLayout.stones, resized.aiLayout.stones), [10, 11]);
  assert.ok(resized.aiLayout.stones[10][2] === 'ss30' && resized.aiLayout.stones[11][2] === 'ss30');
  assert.equal(resized.aiLayout.editCount, 2);

  const recoloured = applyAiLayoutEdits(layer, [{ op: 'recolour', indices: [0], colorId: 'scarlet' }]);
  assert.deepEqual(changedIndices(CAT.stones, recoloured.aiLayout.stones), CAT.stones[0][3] === 'scarlet' ? [] : [0]);
  assert.equal(recoloured.aiLayout.stones[0][3], 'scarlet');

  const deleted = applyAiLayoutEdits(layer, [{ op: 'delete', indices: [1, 5] }]);
  assert.equal(deleted.aiLayout.stones.length, 2144);
  assert.deepEqual(deleted.aiLayout.stones, CAT.stones.filter((_, i) => i !== 1 && i !== 5));

  const added = applyAiLayoutEdits(layer, [{ op: 'add', stones: [{ xMm: 60, yMm: 70, sizeId: 'ss4', colorId: 'jet' }, { xMm: 61, yMm: 70, sizeId: 'ss10', colorId: 'gold' }] }]);
  assert.equal(added.aiLayout.stones.length, 2148);
  assert.deepEqual(added.aiLayout.stones.slice(0, 2146), CAT.stones);
  assert.deepEqual(added.aiLayout.stones.slice(2146).map((t) => t.slice(2)), [['ss4', 'jet'], ['ss10', 'gold']], 'appended in order');

  assert.deepEqual(layer, before, 'the input layer is unchanged');
  assert.notEqual(moved.aiLayout, layer.aiLayout);
  assert.notEqual(moved.colorSwaps, layer.colorSwaps);
});

await test('4. recolour bakes colorSwaps into every stone and empties it; the engine draws the same colours before and after, apart from the recoloured stone', () => {
  const from = CAT.stones[0][3];
  const other = CAT.stones.find((t) => t[3] !== from)[3];
  const layer = catLayer({ colorSwaps: { [other]: 'hyacinth' } });
  const { aiLayout, colorSwaps } = applyAiLayoutEdits(layer, [{ op: 'recolour', indices: [0], colorId: 'emerald' }]);
  assert.deepEqual(colorSwaps, {});
  assert.ok(!aiLayout.stones.some((t) => t[3] === other), 'the swap is baked');
  const beforeColours = placed(layer).stones.map((s) => s.color);
  const afterColours = placed({ ...layer, aiLayout, colorSwaps }).stones.map((s) => s.color);
  assert.deepEqual(afterColours.slice(1), beforeColours.slice(1));
  assert.equal(afterColours[0], 'emerald');
});

await test('5. a call that would exceed 20,000 stones throws and leaves the layer unchanged', () => {
  assert.equal(AI_LAYOUT_MAX_STONES, 20000);
  const layer = catLayer();
  const before = deepCopy(layer);
  const extra = Array.from({ length: 20000 - 2146 + 1 }, (_, i) => ({ xMm: 40 + (i % 100), yMm: 30 + Math.floor(i / 100), sizeId: 'ss4', colorId: 'jet' }));
  assert.throws(() => applyAiLayoutEdits(layer, [{ op: 'add', stones: extra }]), /at most 20000/);
  assert.deepEqual(layer, before);
  assert.equal(applyAiLayoutEdits(layer, [{ op: 'add', stones: extra.slice(1) }]).aiLayout.stones.length, 20000, 'exactly 20,000 is allowed');
});

await test('6. each bad input throws', () => {
  const layer = catLayer();
  const bad = [
    [{}, [{ op: 'delete', indices: [0] }], /no ai-layout/],
    [layer, [], /non-empty list/],
    [layer, [{ op: 'flip', indices: [0] }], /Unknown/],
    [layer, [{ op: 'delete', indices: [] }], /non-empty array/],
    [layer, [{ op: 'delete', indices: [2146] }], /not in the layout/],
    [layer, [{ op: 'delete', indices: [-1] }], /not in the layout/],
    [layer, [{ op: 'delete', indices: [1.5] }], /not in the layout/],
    [layer, [{ op: 'delete', indices: [3, 3] }], /twice/],
    [layer, [{ op: 'move', indices: [0], dxMm: NaN, dyMm: 0 }], /finite/],
    [layer, [{ op: 'recolour', indices: [0], colorId: 'mauve' }], /unknown colour/],
    [layer, [{ op: 'resize', indices: [0], sizeId: 'ss8' }], /unknown size/],
    [layer, [{ op: 'add', stones: [] }], /non-empty array/],
    [layer, [{ op: 'add', stones: [{ xMm: 1, yMm: Infinity, sizeId: 'ss6', colorId: 'jet' }] }], /finite/],
    [layer, [{ op: 'add', stones: [{ xMm: 1, yMm: 1, sizeId: 'ss6', colorId: 'nope' }] }], /unknown colour/],
    [layer, [{ op: 'add', stones: [{ xMm: 1, yMm: 1, sizeId: 'big', colorId: 'jet' }] }], /unknown size/]
  ];
  for (const [l, ops, message] of bad) assert.throws(() => applyAiLayoutEdits(l, ops), message, JSON.stringify(ops));
});

// ---- the app.js sandbox -------------------------------------------------------------------------

const fillModesLine = /const IMAGE_FILL_MODES=new Set\(\[[^\]]*\]\);/.exec(appJs)[0];
const arrowLine = /const ARROW_KEY_DELTAS=\{[^\n]*\};/.exec(appJs)[0];
const keydownBody = extract("window.addEventListener('keydown',e=>{").slice("window.addEventListener('keydown',e=>".length);
const SANDBOX_SOURCE = `
  ${fillModesLine}
  ${arrowLine}
  ${extract('function resolveImageFillMode(value){')}
  ${extract('async generateImageStonesLive(layer,{includeStats=false}={}){').replace('async generateImageStonesLive(', 'async function generateImageStonesLive(')}
  ${extract('async generate(project){await this.recoverStaleAuthoredScales(project);').replace(/^async generate/, 'async function generateProject')}
  ${extract('function layoutStonesForLayer(layerId){')}
  ${extract('function layerLabel(l){')}
  ${extract('function aiLayoutLayerById(layerId){')}
  ${extract('async function editAiLayoutStones(layerId,ops,statusText){')}
  ${extract('function nearestAiLayoutStoneSize(sizeMm){')}
  ${extract('function aiLayoutMarkSizeText(size,sizeMm,targetLayer){')}
  ${extract('function syncAiStonePanel(stoneSel){')}
  ${extract('async function deleteCurrentSelection(){')}
  ${extract('function currentSnapshot(){')}
  ${extract('function commitHistory(){')}
  ${extract('function closeHistorySession(){')}
  ${extract('function applyHistorySnapshot(snap){')}
  ${extract('function performUndo(){')}
  ${extract('function performRedo(){')}
  ${extract('function textLayersBelowReadableMinimum(){')}
  ${extract('function updateProdSheetReadabilityValidation(){')}
  const history=new HistoryManager({maxSize:100});
  let project=initialProject,selectedLayerId=initialProject.layers[0].id,layout=null,lastUpdate=Promise.resolve();
  const engineObj={permanentEngine:engine,recoverStaleAuthoredScales:async()=>{},generateImageStonesLive,generateTextStonesLive:async()=>[],generateShapeStonesLive:async()=>[],generateSvgStonesLive:async()=>[],generatePathStonesLive:async()=>[]};
  function updateAll(){lastUpdate=generateProject.call(engineObj,project).then(r=>{layout=r.layout});return lastUpdate}
  function updateHistoryUI(){}
  function syncSelectedControlsFromLayer(){}
  const hooks={
    onStampPlace:${hookArrow('onStampPlace:async({xMm,yMm,layerId})=>{')},
    onTracePlace:${hookArrow('onTracePlace:async(placements,layerId,droppedCount=0)=>{')},
    onEraseSweep:${hookArrow('onEraseSweep:async(daubsAbsoluteMm,layerId,corridorPolygonsAbsoluteMm,mode)=>{')},
    onShapeResized:${hookArrow('onShapeResized:(layerId,boundsMm)=>{')}
  };
  const onKeydown=e=>${keydownBody};
  return {
    hooks,onKeydown,editAiLayoutStones,layoutStonesForLayer,deleteCurrentSelection,performUndo,performRedo,syncAiStonePanel,
    updateProdSheetReadabilityValidation,updateAll,
    settled:async()=>{await lastUpdate;await new Promise(r=>setTimeout(r,0));await lastUpdate},
    get project(){return project},set project(p){project=p},
    get layout(){return layout},
    get canUndo(){return history.canUndo}
  };
`;
const SANDBOX_NAMES = [
  'initialProject', 'engine', 'el', 'drawingTool', 'document', 'lightboxes', 'HistoryManager', 'SHAPE_LAYER_TYPES', 'SHAPE_DISPLAY_LABELS',
  'dedupeStonesByRadius', 'Stone', 'StoneLayout', 'console', 'applyAiLayoutEdits', 'aiLayoutBoxSize', 'listAllStoneSizes',
  'findStoneSizeByDiameterMm', 'formatStoneSizeLabel', 'isPointInsidePolygons', 'STONE_COLORS', 'stampSettings', 'traceSettings',
  'eraserSettings', 'AI_STONE_NUDGE_STEP_MM', 'AI_STONE_NUDGE_STEP_LARGE_MM', 'DRAW_TOOL_SHORTCUT_KEYS',
  'countStonesOutsideProductionArea', 'computeProductionSheetDocument', 'currentProductionSheetOptions', 'formatLengthDisplay', 'unitSuffix', 'textHeightBelowReadableMinimum'
];
const sandboxFactory = new Function(...SANDBOX_NAMES, SANDBOX_SOURCE);

function makeClassList() {
  const set = new Set();
  return { contains: (c) => set.has(c), add: (c) => set.add(c), remove: (c) => set.delete(c), toggle: (c, f) => { const on = f === undefined ? !set.has(c) : Boolean(f); if (on) set.add(c); else set.delete(c); return on; } };
}
async function makeApp(layers, { stoneSelection = null } = {}) {
  const els = new Map();
  const el = (id) => { if (!els.has(id)) els.set(id, { textContent: '', value: '', title: '', selectedIndex: 0, style: {}, classList: makeClassList() }); return els.get(id); };
  const calls = { clearStoneSelection: 0, refresh: [] };
  const drawingTool = {
    isActive: true, mode: 'select', activeSelection: null, stoneSelection,
    clearStoneSelection() { calls.clearStoneSelection++; this.stoneSelection = null; },
    refreshStoneGroupForLayer(id) { calls.refresh.push(id); },
    deleteSelected() { calls.deleteSelected = true; }, cancelPath() {}
  };
  const canvas = { width: 160, height: 160 };
  const app = sandboxFactory(
    { units: 'mm', canvas, layers }, engine, el, drawingTool, { activeElement: null }, { monogram: { isOpen: false } }, HistoryManager,
    new Set(['circle', 'rectangle']), {}, dedupeStonesByRadius, Stone, StoneLayout, console, applyAiLayoutEdits, aiLayoutBoxSize,
    listAllStoneSizes, findStoneSizeByDiameterMm, formatStoneSizeLabel, isPointInsidePolygons, STONE_COLORS,
    { sizeMm: 2, color: 'jet' }, { sizeMm: 2, gapMm: 0.3, color: 'gold' }, { radiusMm: 1, mode: 'stones' },
    AI_STONE_NUDGE_STEP_MM, AI_STONE_NUDGE_STEP_LARGE_MM, {},
    countStonesOutsideProductionArea, () => ({ multiPage: false }), () => ({}),
    formatLengthDisplay, unitSuffix, () => null
  );
  await app.updateAll(true);
  return { app, el, drawingTool, calls };
}
const lightboxStones = (layout, id) => layout.stones.filter((s) => s.layerId === id);
const key = (k, shiftKey = false) => ({ key: k, code: k, shiftKey, ctrlKey: false, metaKey: false, altKey: false, repeat: false, preventDefault() {} });

await test('7. app.js: layout stones of an ai-layout layer carry aiIndex and gapViolation through generate() and layoutStonesForLayer(); the lightbox reads the same layout', async () => {
  const studio = extract('async function renderImageStudio(){');
  assert.ok(studio.includes('const stones=(layout?.stones||[]).filter(s=>s.layerId===l.id);'), 'the lightbox reads the global layout');
  const { app } = await makeApp([catLayer()]);
  const design = app.layoutStonesForLayer('I');
  assert.equal(design.length, 2146);
  assert.ok(design.every((s, i) => s.aiIndex === i && s.gapViolation === false));
  const stones = lightboxStones(app.layout, 'I');
  assert.ok(stones.every((s, i) => s.metadata.aiIndex === i && !('gapViolation' in s.metadata)));
  assert.deepEqual(stones.map((s) => [s.xMm, s.yMm]), design.map((s) => [s.x, s.y]));
});

await test('8. app.js: an edit through editAiLayoutStones() changes the same stones in the layout Design and the Image->Strass view read; undo and redo restore aiLayout and colorSwaps exactly', async () => {
  const { app, calls } = await makeApp([catLayer({ colorSwaps: { jet: 'scarlet' } })]);
  const original = deepCopy({ aiLayout: app.project.layers[0].aiLayout, colorSwaps: app.project.layers[0].colorSwaps });
  const before = app.layoutStonesForLayer('I');
  assert.equal(await app.editAiLayoutStones('I', [{ op: 'move', indices: [7, 8], dxMm: 2, dyMm: 1 }], 'moved'), true);
  await app.settled();
  const after = app.layoutStonesForLayer('I');
  const changed = after.map((s, i) => (s.x === before[i].x && s.y === before[i].y ? -1 : s.aiIndex)).filter((i) => i >= 0);
  assert.deepEqual(changed, [7, 8]);
  assert.ok(Math.abs(after[7].x - before[7].x - 2) <= 0.0005 && Math.abs(after[7].y - before[7].y - 1) <= 0.0005);
  assert.deepEqual(lightboxStones(app.layout, 'I').map((s) => [s.xMm, s.yMm]), after.map((s) => [s.x, s.y]), 'the lightbox reads the same moved stones');
  assert.deepEqual(calls.refresh, ['I'], 'the Design stone group is refreshed');
  const edited = deepCopy({ aiLayout: app.project.layers[0].aiLayout, colorSwaps: app.project.layers[0].colorSwaps });
  assert.equal(edited.aiLayout.editCount, 1);

  assert.equal(await app.editAiLayoutStones('I', [{ op: 'recolour', indices: [0], colorId: 'emerald' }], 'recoloured'), true);
  await app.settled();
  const recoloured = deepCopy({ aiLayout: app.project.layers[0].aiLayout, colorSwaps: app.project.layers[0].colorSwaps });
  assert.deepEqual(recoloured.colorSwaps, {});

  app.performUndo(); await app.settled();
  assert.deepEqual({ aiLayout: app.project.layers[0].aiLayout, colorSwaps: app.project.layers[0].colorSwaps }, edited);
  app.performUndo(); await app.settled();
  assert.deepEqual({ aiLayout: app.project.layers[0].aiLayout, colorSwaps: app.project.layers[0].colorSwaps }, original);
  assert.deepEqual(app.layoutStonesForLayer('I'), before);
  app.performRedo(); await app.settled();
  assert.deepEqual({ aiLayout: app.project.layers[0].aiLayout, colorSwaps: app.project.layers[0].colorSwaps }, edited);
  app.performRedo(); await app.settled();
  assert.deepEqual({ aiLayout: app.project.layers[0].aiLayout, colorSwaps: app.project.layers[0].colorSwaps }, recoloured);

  assert.equal(await app.editAiLayoutStones('I', [{ op: 'delete', indices: [99999] }], 'x'), false, 'a refused edit');
  assert.deepEqual({ aiLayout: app.project.layers[0].aiLayout, colorSwaps: app.project.layers[0].colorSwaps }, recoloured, 'changes nothing');
  app.performUndo(); await app.settled();
  assert.deepEqual({ aiLayout: app.project.layers[0].aiLayout, colorSwaps: app.project.layers[0].colorSwaps }, edited, 'and made no history step');
});

await test('9. app.js: moving a stone into a 0.05 mm gap flags both stones, layoutStonesForLayer() carries the flag, and the Production Sheet warning counts them', async () => {
  const { app, el } = await makeApp([catLayer()]);
  app.updateProdSheetReadabilityValidation();
  assert.equal(el('prodSheetValidation').textContent, '', 'no warning before');
  const stones = app.layoutStonesForLayer('I');
  const a = stones[1000];
  let b = null;
  for (const s of stones) if (s !== a && (!b || Math.hypot(s.x - a.x, s.y - a.y) < Math.hypot(b.x - a.x, b.y - a.y))) b = s;
  const ux = (a.x - b.x) / Math.hypot(a.x - b.x, a.y - b.y), uy = (a.y - b.y) / Math.hypot(a.x - b.x, a.y - b.y);
  const centre = (a.d + b.d) / 2 + 0.05;
  await app.editAiLayoutStones('I', [{ op: 'move', indices: [a.aiIndex], dxMm: b.x + ux * centre - a.x, dyMm: b.y + uy * centre - a.y }], 'moved');
  await app.settled();
  const after = app.layoutStonesForLayer('I');
  const gap = Math.hypot(after[a.aiIndex].x - after[b.aiIndex].x, after[a.aiIndex].y - after[b.aiIndex].y) - centre + 0.05;
  assert.ok(gap > 0.04 && gap < 0.06, `gap ${gap}`);
  assert.equal(after[a.aiIndex].gapViolation, true);
  assert.equal(after[b.aiIndex].gapViolation, true);
  const flagged = lightboxStones(app.layout, 'I').filter((s) => s.metadata.gapViolation === true).length;
  assert.equal(after.filter((s) => s.gapViolation).length, flagged);
  app.updateProdSheetReadabilityValidation();
  assert.equal(el('prodSheetValidation').textContent, `${flagged} stones in AI layouts are closer than 0.1 mm to a neighbour. They have a red ring in Design.`);
  assert.ok(el('prodSheetValidation').classList.contains('visible'));
  console.log(`   passing: stones ${a.aiIndex} and ${b.aiIndex} at gap ${gap.toFixed(4)} mm; ${flagged} flagged`);
});

await test('10. app.js: arrow keys move a stone selection 0.1 mm (1 mm with Shift), one history step each; Delete deletes it and clears the selection', async () => {
  const { app, drawingTool, calls } = await makeApp([catLayer()], { stoneSelection: { layerId: 'I', indices: [4, 9] } });
  const p0 = app.layoutStonesForLayer('I');
  app.onKeydown(key('ArrowRight')); await app.settled();
  const p1 = app.layoutStonesForLayer('I');
  app.onKeydown(key('ArrowDown', true)); await app.settled();
  const p2 = app.layoutStonesForLayer('I');
  for (const i of [4, 9]) {
    assert.ok(Math.abs(p1[i].x - p0[i].x - 0.1) <= 0.0005 && p1[i].y === p0[i].y, `ArrowRight on ${i}`);
    assert.ok(Math.abs(p2[i].y - p1[i].y - 1) <= 0.0005 && p2[i].x === p1[i].x, `Shift+ArrowDown on ${i}`);
  }
  assert.deepEqual(p2.filter((s, i) => s.x !== p0[i].x || s.y !== p0[i].y).map((s) => s.aiIndex), [4, 9]);
  app.performUndo(); await app.settled();
  assert.deepEqual(app.layoutStonesForLayer('I'), p1, 'one undo undoes one key press');
  app.performUndo(); await app.settled();
  assert.deepEqual(app.layoutStonesForLayer('I'), p0);

  drawingTool.stoneSelection = { layerId: 'I', indices: [4, 9] };
  app.onKeydown(key('Delete')); await app.settled();
  assert.equal(app.layoutStonesForLayer('I').length, 2144);
  assert.equal(app.project.layers[0].aiLayout.stones.length, 2144);
  assert.equal(calls.clearStoneSelection, 1, 'a delete clears the selection');
  assert.equal(calls.deleteSelected, undefined, 'the shape delete is not reached');
});

await test('11. app.js: onShapeResized() keeps the S14 lock -- the dimension that differs more leads (ties to width), never below the layout, left/top kept', async () => {
  const { app } = await makeApp([catLayer()]);
  const l = app.project.layers[0];
  const W = CAT.widthMm, H = CAT.heightMm;
  app.hooks.onShapeResized('I', { left: 5, top: 6, width: 200, height: 50 });
  assert.equal(l.w, 200); assert.ok(Math.abs(l.h - 200 * H / W) <= 1e-9); assert.deepEqual([l.x, l.y], [5, 6]);
  app.hooks.onShapeResized('I', { left: 7, top: 8, width: l.w + 1, height: 300 });
  assert.ok(Math.abs(l.h - 300) <= 1e-9 && Math.abs(l.w - 300 * W / H) <= 1e-9, 'height leads');
  app.hooks.onShapeResized('I', { left: 7, top: 8, width: 40, height: 60 });
  assert.deepEqual([l.w, l.h], [W, H], 'never below the layout');
  app.hooks.onShapeResized('I', { left: 0, top: 0, width: W + 10, height: H + 10 });
  assert.equal(l.w, W + 10, 'a tie goes to width');
});

await test('12. app.js: Stamp, Trace and Eraser on an ai-layout layer -- the size snaps to a catalogue size and the status names it', async () => {
  const { app, el } = await makeApp([catLayer()]);
  const stampSnap = (sizeMm) => listAllStoneSizes().reduce((b, s) => (Math.abs(s.diameterMm - sizeMm) < Math.abs(b.diameterMm - sizeMm) ? s : b));
  const run = async (fn) => { await fn(); await app.settled(); };

  const stampSource = hookArrow('onStampPlace:async({xMm,yMm,layerId})=>{');
  assert.ok(stampSource.indexOf('aiLayoutLayerById(layerId)') < stampSource.indexOf("l.type==='path'||l.type==='text'"), 'the ai-layout branch comes before the path and text branches');

  await run(() => app.hooks.onStampPlace({ xMm: 60, yMm: 70, layerId: 'I' }));
  let stones = app.project.layers[0].aiLayout.stones;
  assert.equal(stones.length, 2147);
  assert.deepEqual(stones[2146].slice(2), ['ss6', 'jet']);
  assert.equal(el('status').textContent, 'Stamped SS6 (2 mm) on N2_cat (AI redraw).');
  const back = app.layoutStonesForLayer('I')[2146];
  assert.ok(Math.hypot(back.x - 60, back.y - 70) <= 0.0005 * Math.SQRT2 + 1e-9);
  assert.equal(stampSnap(2.5).id, 'ss10');

  const traceSource = hookArrow('onTracePlace:async(placements,layerId,droppedCount=0)=>{');
  assert.ok(traceSource.indexOf('aiLayoutLayerById(layerId)') < traceSource.indexOf("l.type==='path'||l.type==='text'"));
  await run(() => app.hooks.onTracePlace([{ xMm: 50, yMm: 50 }, { xMm: 52.3, yMm: 50 }, { xMm: 54.6, yMm: 50 }], 'I', 1));
  stones = app.project.layers[0].aiLayout.stones;
  assert.equal(stones.length, 2150);
  assert.deepEqual(stones.slice(2147).map((t) => t.slice(2)), [['ss6', 'gold'], ['ss6', 'gold'], ['ss6', 'gold']]);
  assert.ok(stones[2147][0] < stones[2148][0] && stones[2148][0] < stones[2149][0], 'in order');
  assert.equal(el('status').textContent, 'Traced 3 stones (1 outside selection, skipped) at SS6 (2 mm) on N2_cat (AI redraw).');

  const eraseSource = hookArrow('onEraseSweep:async(daubsAbsoluteMm,layerId,corridorPolygonsAbsoluteMm,mode)=>{');
  assert.ok(eraseSource.indexOf('aiLayoutLayerById(layerId)') < eraseSource.indexOf("targetLayer.type==='text'"));
  const design = app.layoutStonesForLayer('I');
  const daub = { xMm: design[300].x, yMm: design[300].y };
  const expected = design.filter((s) => (s.x - daub.xMm) ** 2 + (s.y - daub.yMm) ** 2 <= 1).map((s) => s.aiIndex);
  await run(() => app.hooks.onEraseSweep([daub], 'I', [], 'stones'));
  assert.equal(app.project.layers[0].aiLayout.stones.length, 2150 - expected.length);
  assert.equal(el('status').textContent, `Erased ${expected.length} stone${expected.length === 1 ? '' : 's'} on N2_cat (AI redraw).`);

  const now = app.layoutStonesForLayer('I');
  const square = [{ xMm: 70, yMm: 80 }, { xMm: 76, yMm: 80 }, { xMm: 76, yMm: 86 }, { xMm: 70, yMm: 86 }];
  const inside = now.filter((s) => isPointInsidePolygons({ xMm: s.x, yMm: s.y }, [square])).length;
  assert.ok(inside > 0);
  await run(() => app.hooks.onEraseSweep([{ xMm: 73, yMm: 83 }], 'I', [square], 'outline'));
  assert.equal(app.layoutStonesForLayer('I').length, now.length - inside, 'Outline mode deletes the stones whose centre is in the corridor');
  await run(() => app.hooks.onEraseSweep([{ xMm: 290, yMm: 290 }], 'I', [], 'stones'));
  assert.equal(el('status').textContent, 'Nothing to erase on N2_cat (AI redraw).');

  console.log(`   passing: stamp/trace/erase applied; eraser stones mode removed ${expected.length}, outline mode ${inside}`);
});

await test('13. app.js: a Stamp size that is not a catalogue size snaps to the nearest of listAllStoneSizes() and the status says so', async () => {
  const els = new Map();
  const el = (id) => { if (!els.has(id)) els.set(id, { textContent: '', style: {}, classList: makeClassList() }); return els.get(id); };
  const drawingTool = { clearStoneSelection() {}, refreshStoneGroupForLayer() {} };
  const canvas = { width: 300, height: 300 };
  const app = sandboxFactory(
    { units: 'mm', canvas, layers: [catLayer()] }, engine, el, drawingTool, { activeElement: null }, { monogram: { isOpen: false } }, HistoryManager,
    new Set(), {}, dedupeStonesByRadius, Stone, StoneLayout, console, applyAiLayoutEdits, aiLayoutBoxSize,
    listAllStoneSizes, findStoneSizeByDiameterMm, formatStoneSizeLabel, isPointInsidePolygons, STONE_COLORS,
    { sizeMm: 2.5, color: 'scarlet' }, { sizeMm: 1.6, gapMm: 0.3, color: 'gold' }, { radiusMm: 1, mode: 'stones' },
    AI_STONE_NUDGE_STEP_MM, AI_STONE_NUDGE_STEP_LARGE_MM, {}, countStonesOutsideProductionArea, () => ({ multiPage: false }), () => ({}), formatLengthDisplay, unitSuffix, () => null
  );
  await app.updateAll();
  await app.hooks.onStampPlace({ xMm: 60, yMm: 70, layerId: 'I' }); await app.settled();
  assert.deepEqual(app.project.layers[0].aiLayout.stones[2146].slice(2), ['ss10', 'scarlet']);
  assert.equal(el('status').textContent, 'Stamped SS10 (2.8 mm), the nearest size an AI layout uses.');
  await app.hooks.onTracePlace([{ xMm: 50, yMm: 50 }, { xMm: 52, yMm: 50 }], 'I', 0); await app.settled();
  assert.deepEqual(app.project.layers[0].aiLayout.stones.slice(2147).map((t) => t[2]), ['ss4', 'ss4'], '1.6 mm snaps to SS4');
  assert.equal(el('status').textContent, 'Traced 2 stones at SS4 (1.5 mm), the nearest size an AI layout uses.');
});

await test('14. app.js: the selection panel shows the shared colour and size, or a blank "Mixed"', async () => {
  const { app, el } = await makeApp([catLayer({ colorSwaps: { [CAT.stones[0][3]]: 'hyacinth' } })]);
  const same = CAT.stones.map((t, i) => [t, i]).filter(([t]) => t[3] === CAT.stones[0][3] && t[2] === CAT.stones[0][2]).slice(0, 2).map(([, i]) => i);
  app.syncAiStonePanel({ layerId: 'I', indices: same });
  assert.equal(el('aiStoneCount').textContent, '2 stones selected');
  assert.equal(el('aiStoneColor').value, 'hyacinth', 'the colour drawn, swaps applied');
  assert.equal(el('aiStoneSize').value, CAT.stones[0][2]);
  assert.equal(el('aiStoneColor').title, '');
  const mixed = [0, CAT.stones.findIndex((t) => t[3] !== CAT.stones[0][3] && t[2] !== CAT.stones[0][2])];
  app.syncAiStonePanel({ layerId: 'I', indices: mixed });
  for (const id of ['aiStoneColor', 'aiStoneSize']) {
    assert.equal(el(id).value, ''); assert.equal(el(id).selectedIndex, -1); assert.equal(el(id).title, 'Mixed');
  }
});

await test('15. index.html and app.js wiring: the panel fields, their population, no history tracking, the dblclick route', async () => {
  const indexHtml = await read('index.html');
  for (const id of ['aiStoneCount', 'aiStoneColorField', 'aiStoneColor', 'aiStoneSizeField', 'aiStoneSize', 'aiStoneDelete']) assert.match(indexHtml, new RegExp(`id="${id}"`));
  assert.match(indexHtml, /<select id="aiStoneColor" style="display:none"><\/select>/);
  assert.ok(appJs.includes("populateStoneColorOptions('aiStoneColor');"));
  assert.ok(extract('function populateAiStoneSizeOptions(){').includes('listAllStoneSizes()'));
  const tracked = /const HISTORY_TRACKED_CONTROL_IDS=[^\n]*/.exec(appJs)[0];
  for (const id of ['aiStoneColor', 'aiStoneSize']) assert.ok(!tracked.includes(id), `${id} is not history-tracked`);
  assert.ok(!/aiStone(Color|Size|Delete)/.test(extract('function writeSelectedControlsToLayer(){')), 'writeSelectedControlsToLayer() reads neither');
  const dbl = extract("layoutCanvas.addEventListener('dblclick',e=>{");
  assert.ok(dbl.includes('drawingTool.finishOpenPenPath();return') && dbl.includes('drawingTool.handleDoubleClick(e);'));
  const draw = extract('function updateDrawToolButtons(){');
  assert.ok(draw.includes("for(const id of['aiStoneCount','aiStoneColorField','aiStoneColor','aiStoneSizeField','aiStoneSize','aiStoneDelete'])"));
});

// ---- byte identity --------------------------------------------------------------------------------

// The only build D change on these paths is `metadata:s.metadata` in generate()'s Stone rebuild and
// in the ai-layout record map; the pre-D generate() is this one without it.
const generateSource = extract('async generate(project){await this.recoverStaleAuthoredScales(project);').replace(/^async generate/, 'async function generate');
const preDGenerateSource = generateSource.replace(',metadata:s.metadata}', '}');
const buildGenerate = (src) => new Function('SHAPE_LAYER_TYPES', 'dedupeStonesByRadius', 'Stone', 'StoneLayout', 'console', `${src}\nreturn generate;`)(new Set(['circle', 'rectangle']), dedupeStonesByRadius, Stone, StoneLayout, console);
const generateNow = buildGenerate(generateSource);
const generatePreD = buildGenerate(preDGenerateSource);
const recordsOf = (stoneLayout) => stoneLayout.stones.map((s) => ({ x: s.xMm, y: s.yMm, d: s.sizeMm, color: s.color, layerId: s.layerId }));
async function exportBoth(layers, recordsByLayer) {
  const live = async (l) => recordsByLayer.get(l.id) || [];
  const obj = { recoverStaleAuthoredScales: async () => {}, generateTextStonesLive: live, generateShapeStonesLive: live, generateSvgStonesLive: live, generateImageStonesLive: live, generatePathStonesLive: live };
  const now = await generateNow.call(obj, { layers });
  const pre = await generatePreD.call(obj, { layers });
  return [JSON.stringify(now.layout, null, 2), JSON.stringify(pre.layout, null, 2)];
}

await test('16. every gallery project and every legacy image mode gives byte-identical stones and JSON export; only the ai-layout branch carries metadata', async () => {
  assert.notEqual(preDGenerateSource, generateSource, 'the pre-D source differs only by the metadata hand-over');
  const live = extract('async generateImageStonesLive(layer,{includeStats=false}={}){');
  assert.equal((live.match(/metadata:/g) || []).length, 1, 'only the ai-layout record map hands metadata on');
  assert.ok(live.indexOf('metadata:s.metadata') < live.indexOf('let buffer='), 'and it is inside the ai-layout branch');
  assert.equal((appJs.match(/metadata:s\.metadata/g) || []).length, 3, 'generate(), the ai-layout map, translateLayoutForMoveDrag()');

  const manifest = JSON.parse(await read('assets/fonts/manifest.json'));
  const registry = createDefaultFontProviderRegistry(new FontManager(manifest), { loadFontBuffer: async (p) => { const b = await readFile(path.join(repoRoot, p)); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength); } });
  const textEngine = new GeometryEngine({ fontProviderRegistry: registry });
  let projects = 0;
  for (const f of (await readdir(path.join(repoRoot, 'examples'))).filter((n) => n.endsWith('.rhs')).sort()) {
    const raw = JSON.parse(await readFile(path.join(repoRoot, 'examples', f), 'utf8'));
    if (raw.layers.some((l) => l.type === 'image')) continue;
    const project = validateRhsProject(raw, f);
    const stoneLayout = await generateProjectStoneLayout(project, textEngine);
    const byLayer = new Map();
    for (const r of recordsOf(stoneLayout)) { if (!byLayer.has(r.layerId)) byLayer.set(r.layerId, []); byLayer.get(r.layerId).push(r); }
    const [now, pre] = await exportBoth(project.layers.filter((l) => l.visible !== false), byLayer);
    assert.equal(now, pre, f);
    assert.ok(!JSON.parse(now).stones.some((s) => Object.keys(s.metadata).length), `${f}: metadata {}`);
    projects++;
  }
  assert.ok(projects >= 20, `${projects} gallery projects`);

  // Legacy image modes: the engine's own stones (ai-stones and line-design carry engine metadata),
  // through the legacy record map generateImageStonesLive() applies, then generate().
  const legacyMap = /cached=\{stones:result\.stones\.map\((s=>\(\{x:s\.xMm,y:s\.yMm,d:s\.sizeMm,color:s\.color,layerId:s\.layerId\}\))\)/.exec(live);
  assert.ok(legacyMap, 'the legacy record map is unchanged');
  const toRecord = new Function(`return ${legacyMap[1]};`)();
  const palette = Object.values(STONE_COLORS).filter((c) => LEGACY_IMAGE_COLOR_IDS.includes(c.id)).map((c) => ({ id: c.id, hex: c.previewColor }));
  let cases = 0;
  for (const { name, buffer, params } of buildRegressionCases(createImageBuffer)) {
    for (const mode of ['fill', 'staggered', 'radial', 'contour', 'organic', 'edge', 'line-design']) {
      const out = engine.generateImageLayout({ imageBuffer: buffer, ...params, layerId: 'legacy', mode, colorCount: 3, palette, rotationDeg: 30 });
      const [now, pre] = await exportBoth([{ id: 'legacy', type: 'image', visible: true }], new Map([['legacy', out.stones.map(toRecord)]]));
      assert.equal(now, pre, `${name} ${mode}`);
      assert.ok(!JSON.parse(now).stones.some((s) => Object.keys(s.metadata).length), `${name} ${mode}: metadata {}`);
      cases++;
    }
  }
  console.log(`   passing: ${projects} gallery projects and ${cases} legacy image cases byte-identical`);
});

// ---- Design: the real DrawingCanvasTool ---------------------------------------------------------

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
    if (prop === 'createElement') return (tag) => (String(tag).toLowerCase() === 'canvas' ? fakeCanvas() : realCreateElement(tag));
    const value = target[prop];
    return typeof value === 'function' ? value.bind(target) : value;
  },
});
const canvasEl = self.document.createElement('canvas');
canvasEl.width = 1200;
canvasEl.height = 800;
self.document.body.appendChild(canvasEl);

const designApp = await makeApp([catLayer()]);
let catStonesForDesign = designApp.app.layoutStonesForLayer('I');
let designOrder = (list) => list;
const LEGACY = { id: 'L', type: 'image', visible: true, x: 150, y: 20, w: 60, h: 50, rotationDeg: 0, fillMode: 'staggered', aiLayout: catAiLayout() };
const legacyStones = [];
for (let j = 0; j < 20; j++) for (let i = 0; i < 24; i++) legacyStones.push({ x: 151.25 + i * 2.5, y: 21.25 + j * 2.5, d: 2, color: 'jet' });
const events = [];
const tool = createDrawingTool(canvasEl, {
  onShapeMoved: () => {}, onShapeResized: () => {}, onShapeRotated: () => {},
  getLayerStoneParams: () => null, generatePathLayout: () => [], resolveShapeLibraryPolygons: () => null, resolveSvgPolygons: () => null,
  getTextLayerStones: () => [],
  getImageLayerStones: (id) => (id === 'I' ? designOrder(catStonesForDesign) : id === 'L' ? legacyStones : []),
  onStonesMoved: (layerId, indices, dxMm, dyMm) => events.push(['moved', layerId, indices, dxMm, dyMm]),
  onStoneSelectionChanged: () => events.push(['selection', tool.stoneSelection]),
  onStampPlace: ({ layerId }) => events.push(['stamp', layerId]),
  onStampRejected: (reason) => events.push(['stampRejected', reason]),
  onTracePlace: (placements, layerId) => events.push(['trace', layerId, placements.length]),
  onTraceRejected: (reason) => events.push(['traceRejected', reason]),
  onEraseSweep: (daubs, layerId, corridors, mode) => events.push(['erase', layerId, mode]),
  onEraseRejected: (reason) => events.push(['eraseRejected', reason]),
});
tool.enter({ width: 240, height: 240 }, 20, 'select');
const AI = catLayer();
const sync = (force = false) => tool.syncFromProjectLayers([AI, LEGACY], force);
sync();

function toolEvent(type, x, y, lastX, lastY, shift) {
  const point = new paper.Point(x, y);
  const last = new paper.Point(lastX ?? x, lastY ?? y);
  return { type, point, lastPoint: last, downPoint: point, delta: point.subtract(last), modifiers: { shift: Boolean(shift) }, event: {}, stopPropagation() {}, preventDefault() {} };
}
const emit = (name, x, y, lx, ly, shift) => paper.tool.emit(name, toolEvent(name, x, y, lx, ly, shift));
const click = (x, y, shift) => { emit('mousedown', x, y, x, y, shift); emit('mouseup', x, y, x, y, shift); };
function drag(points, shift) {
  emit('mousedown', points[0].x, points[0].y, points[0].x, points[0].y, shift);
  for (let i = 1; i < points.length; i++) emit('mousedrag', points[i].x, points[i].y, points[i - 1].x, points[i - 1].y, shift);
  const a = points[points.length - 1];
  emit('mouseup', a.x, a.y, a.x, a.y, shift);
}
function dblclickAt(xMm, yMm) {
  const v = tool.debugProjectToViewPx(xMm, yMm);
  return tool.handleDoubleClick({ clientX: v.x, clientY: v.y, target: canvasEl });
}
const centre = { x: AI.x + AI.w / 2, y: AI.y + AI.h / 2 };
const byIndex = (i) => catStonesForDesign.find((s) => s.aiIndex === i);
const nearest = (p) => catStonesForDesign.reduce((b, s) => (Math.hypot(s.x - p.x, s.y - p.y) < Math.hypot(b.x - p.x, b.y - p.y) ? s : b));
const S0 = nearest(centre);
const S1 = nearest({ x: centre.x + 12, y: centre.y + 8 });
function findGap() {
  const reach = 4 / tool.pxPerMm;
  for (let y = AI.y + 0.5; y < AI.y + AI.h; y += 0.25) for (let x = AI.x + 0.5; x < AI.x + AI.w; x += 0.25) {
    if (catStonesForDesign.every((s) => Math.hypot(s.x - x, s.y - y) > s.d / 2 + reach + 0.05)) return { x, y };
  }
  throw new Error('no gap inside the layer');
}
function insidePolygon(x, y, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if ((a.y > y) !== (b.y > y) && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

await test('17. Design: a double-click enters stone mode only on an ai-layout layer; the canvas dims and the stones sit above the dim', () => {
  assert.equal(dblclickAt(LEGACY.x + 30, LEGACY.y + 25), false, 'another image layer: nothing new');
  assert.equal(tool.stoneEditLayerId, null);
  assert.equal(dblclickAt(centre.x, centre.y), true);
  const s = tool.debugStoneEdit;
  assert.equal(s.layerId, 'I');
  assert.ok(s.dimmed && s.groupAboveDim);
  assert.deepEqual(s.indices, []);
});

await test('18. Design: click, Shift-click, rectangle and lasso select by aiIndex (the stone list Design gets is reversed, so aiIndex is not the list position)', () => {
  designOrder = (list) => [...list].reverse();
  click(S0.x, S0.y);
  assert.deepEqual(tool.stoneSelection, { layerId: 'I', indices: [S0.aiIndex] });
  click(S1.x, S1.y, true);
  assert.deepEqual(tool.stoneSelection.indices, [S0.aiIndex, S1.aiIndex].sort((a, b) => a - b));
  click(S0.x, S0.y, true);
  assert.deepEqual(tool.stoneSelection.indices, [S1.aiIndex]);
  const rings = tool.debugStoneEdit.selectionRings;
  assert.equal(rings.length, 1);
  assert.ok(Math.abs(rings[0].x - S1.x) < 1e-6 && Math.abs(rings[0].y - S1.y) < 1e-6, 'a blue ring on the selected stone');

  const g = findGap();
  const toward = { x: g.x + Math.sign(centre.x - g.x) * 14, y: g.y + Math.sign(centre.y - g.y) * 10 };
  drag([g, { x: (g.x + toward.x) / 2, y: (g.y + toward.y) / 2 }, toward]);
  const [x0, x1] = [Math.min(g.x, toward.x), Math.max(g.x, toward.x)], [y0, y1] = [Math.min(g.y, toward.y), Math.max(g.y, toward.y)];
  const inRect = catStonesForDesign.filter((s) => s.x >= x0 && s.x <= x1 && s.y >= y0 && s.y <= y1).map((s) => s.aiIndex).sort((a, b) => a - b);
  assert.ok(inRect.length > 3);
  assert.deepEqual(tool.stoneSelection.indices, inRect, 'rectangle: stones whose centre is inside');
  click(S0.x, S0.y, true);
  drag([g, toward], true);
  assert.deepEqual(tool.stoneSelection.indices, [...new Set([S0.aiIndex, ...inRect])].sort((a, b) => a - b), 'Shift adds');

  tool.setMode('lasso');
  const poly = [{ x: centre.x - 10, y: centre.y - 10 }, { x: centre.x + 10, y: centre.y - 6 }, { x: centre.x + 2, y: centre.y + 12 }, { x: centre.x - 10, y: centre.y - 10 }];
  drag(poly);
  const inLasso = catStonesForDesign.filter((s) => insidePolygon(s.x, s.y, poly)).map((s) => s.aiIndex).sort((a, b) => a - b);
  assert.ok(inLasso.length > 10);
  assert.deepEqual(tool.stoneSelection.indices, inLasso, 'lasso: stones whose centre is inside');
  click(S1.x, S1.y, false);
  assert.deepEqual(tool.stoneSelection.indices, [S1.aiIndex], 'a lasso click picks the stone under it');
  tool.setMode('select');
  assert.equal(tool.stoneEditLayerId, 'I', 'Select <-> Lasso keeps the mode');
  designOrder = (list) => list;
});

await test('19. Design: a drag commits one move edit on release; mid-drag the stones are outlines at their new place and the real stones do not move', () => {
  click(S0.x, S0.y);
  click(S1.x, S1.y, true);
  events.length = 0;
  const before = tool.debugStoneState('I').stones;
  emit('mousedown', S0.x, S0.y);
  emit('mousedrag', S0.x + 1, S0.y + 0.5, S0.x, S0.y);
  emit('mousedrag', S0.x + 3, S0.y + 2, S0.x + 1, S0.y + 0.5);
  const preview = tool.debugStoneEdit.dragPreview;
  assert.equal(preview.length, 2);
  for (const s of [S0, S1]) assert.ok(preview.some((p) => Math.abs(p.x - s.x - 3) < 1e-6 && Math.abs(p.y - s.y - 2) < 1e-6), 'outline at the new place');
  assert.deepEqual(tool.debugStoneState('I').stones, before, 'the real stones have not moved');
  assert.equal(events.filter((e) => e[0] === 'moved').length, 0);
  emit('mouseup', S0.x + 3, S0.y + 2, S0.x + 3, S0.y + 2);
  const moved = events.filter((e) => e[0] === 'moved');
  assert.equal(moved.length, 1, 'one edit');
  assert.deepEqual(moved[0].slice(0, 3), ['moved', 'I', [S0.aiIndex, S1.aiIndex].sort((a, b) => a - b)]);
  assert.ok(Math.abs(moved[0][3] - 3) < 1e-9 && Math.abs(moved[0][4] - 2) < 1e-9);
  assert.equal(tool.debugStoneEdit.dragPreview, null);
  assert.equal(tool.stoneSelection.indices.length, 2, 'a move keeps the selection');
});

await test('20. Design: gap-violation stones get red rings on the stone group; a forced sync (undo/redo) clears the selection', async () => {
  assert.equal(tool.debugStoneState('I').gapRings.length, 0);
  const { app } = designApp;
  const a = byIndex(S0.aiIndex);
  const b = catStonesForDesign.filter((s) => s !== a).reduce((m, s) => (Math.hypot(s.x - a.x, s.y - a.y) < Math.hypot(m.x - a.x, m.y - a.y) ? s : m));
  const u = Math.hypot(a.x - b.x, a.y - b.y);
  const c = (a.d + b.d) / 2 + 0.05;
  await app.editAiLayoutStones('I', [{ op: 'move', indices: [a.aiIndex], dxMm: b.x + (a.x - b.x) / u * c - a.x, dyMm: b.y + (a.y - b.y) / u * c - a.y }], 'x');
  await app.settled();
  catStonesForDesign = app.layoutStonesForLayer('I');
  AI.aiLayout = app.project.layers[0].aiLayout;
  sync();
  const flagged = catStonesForDesign.filter((s) => s.gapViolation);
  const rings = tool.debugStoneState('I').gapRings;
  assert.ok(flagged.length >= 2);
  assert.equal(rings.length, flagged.length);
  for (const s of flagged) assert.ok(rings.some((r) => Math.abs(r.x - s.x) < 1e-6 && Math.abs(r.y - s.y) < 1e-6 && Math.abs(r.d - s.d) < 0.01), `ring on ${s.aiIndex}`);
  assert.equal(tool.debugStoneState('I').stoneGroupCount, catStonesForDesign.length, 'the sprites are unchanged in number');
  assert.ok(tool.debugStoneEdit.groupAboveDim, 'the rebuilt group is raised above the dim again');
  assert.ok(tool.stoneSelection, 'a plain sync keeps the selection');
  sync(true);
  assert.equal(tool.stoneSelection, null, 'a forced sync clears it');
  assert.equal(tool.stoneEditLayerId, 'I', 'and keeps the mode');
});

await test('21. Design: Escape leaves the mode; a click outside the layer leaves it; a fill-style change leaves it', () => {
  tool.cancelPath();
  assert.equal(tool.stoneEditLayerId, null);
  assert.equal(tool.debugStoneEdit.dimmed, false);
  assert.ok(dblclickAt(centre.x, centre.y));
  click(5, 5);
  assert.equal(tool.stoneEditLayerId, null, 'click outside the layer');
  assert.ok(dblclickAt(centre.x, centre.y));
  tool.syncFromProjectLayers([{ ...AI, fillMode: 'staggered' }, LEGACY]);
  assert.equal(tool.stoneEditLayerId, null, 'no longer ai-layout');
  sync();
});

await test('22. Design: Stamp, Trace and Eraser on an ai-layout layer reach their hooks with its layer id; any other image layer still rejects as ineligible', () => {
  const a = byIndex(S1.aiIndex);
  events.length = 0;
  tool.setMode('stamp');
  emit('mousedown', a.x, a.y); emit('mouseup', a.x, a.y);
  emit('mousedown', LEGACY.x + 30, LEGACY.y + 25); emit('mouseup', LEGACY.x + 30, LEGACY.y + 25);
  tool.setMode('trace');
  drag([{ x: a.x - 5, y: a.y }, { x: a.x - 2.5, y: a.y }, { x: a.x, y: a.y }, { x: a.x + 2.5, y: a.y }, { x: a.x + 5, y: a.y }]);
  drag([{ x: LEGACY.x + 20, y: LEGACY.y + 25 }, { x: LEGACY.x + 25, y: LEGACY.y + 25 }, { x: LEGACY.x + 30, y: LEGACY.y + 25 }]);
  tool.setMode('eraser');
  drag([{ x: a.x, y: a.y }]);
  drag([{ x: LEGACY.x + 30, y: LEGACY.y + 25 }]);
  tool.setMode('select');
  assert.deepEqual(events, [
    ['stamp', 'I'], ['stampRejected', 'ineligible'],
    ['trace', 'I', events[2][2]], ['traceRejected', 'ineligible'],
    ['erase', 'I', 'stones'], ['eraseRejected', 'ineligible']
  ]);
  assert.ok(events[2][2] > 0, 'trace placements');
});

await test('23. Design: in stone editing, Stamp, Trace and Eraser act on that layer far outside its box; after Escape the Stamp click resolves null again', () => {
  const far = { x: 5, y: 5 };
  assert.ok(far.x < AI.x - 20 && far.y <= AI.y, 'the point is far outside the layer box');
  assert.ok(dblclickAt(centre.x, centre.y));
  assert.equal(tool.stoneEditLayerId, 'I');
  events.length = 0;
  tool.setMode('stamp');
  assert.equal(tool.stoneEditLayerId, 'I', 'switching to Stamp keeps stone editing');
  emit('mousemove', far.x, far.y);
  assert.equal(paper.project.getItems({ match: (item) => item.data && item.data.isStampGhost === true }).length, 1, 'the Stamp ghost shows outside the box');
  click(far.x, far.y);
  tool.setMode('trace');
  drag([{ x: far.x - 3, y: far.y + 3 }, { x: far.x, y: far.y + 3 }, { x: far.x + 3, y: far.y + 3 }, { x: far.x + 6, y: far.y + 3 }]);
  tool.setMode('eraser');
  drag([{ x: far.x, y: far.y }, { x: far.x + 2, y: far.y }]);
  assert.equal(tool.stoneEditLayerId, 'I');
  assert.deepEqual(events, [['stamp', 'I'], ['trace', 'I', events[1][2]], ['erase', 'I', 'stones']]);
  assert.ok(events[1][2] > 0, 'trace placements');

  tool.setMode('stamp');
  tool.cancelPath();
  assert.equal(tool.stoneEditLayerId, null, 'Escape leaves stone editing');
  events.length = 0;
  click(far.x, far.y);
  assert.deepEqual(events, [['stamp', null]]);
  tool.setMode('select');
});

await test('Registered in tools/test-groups.mjs (editing)', () => {
  assertTestRegistered({ filename: 'test-img-026-design-editing.mjs', group: 'editing', includedInDefault: true });
});

if (failures) { process.exitCode = 1; console.error(`\nIMG-026 build D design-editing tests FAILED (${failures} of ${passes + failures}).`); }
else console.log(`\nIMG-026 build D design-editing tests passed (${passes}).`);
