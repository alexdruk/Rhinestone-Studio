// RS-3039: large layouts and per-layer failure (docs/specifications/RS-3039-LargeLayout.md §6).
//
// T1 -- every D1 geometry site runs on 200,000 synthetic non-overlapping stones without throwing,
//       with its result pinned; GapFill.js's per-round append is covered by a source guard; and on a
//       1,000-stone slice the loop versions give results deep-equal to the pre-RS-3039 spread
//       versions. The spread reference copies are built here from the real module source with each
//       RS-3039 loop swapped back to its original spread line, then loaded as data: modules.
// T2 -- app.js's real generate(), extracted and executed via new Function() (the brace-balanced
//       pattern tools/test-img-013-fill-empty-slots.mjs and tools/test-mono-006b-* use): a throwing
//       middle layer contributes nothing, the others keep their stones in order, and `failures`
//       names it.
// T3 -- the same generate() with one 200,000-stone layer returns all 200,000 stones.
// T4 -- app.js's real updateAll(), executed via the runUpdateAll() harness pattern from
//       tools/test-autosave-recovery-wiring.mjs (layout exposed through a getter, real layerLabel()),
//       asserting the #status text built at runtime and that the success tail still runs.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { hasAnyOverlappingStonePair, measureStoneCrowding, StoneLayout } from '../src/geometry/StoneLayout.js';
import { dedupeStonesByRadius, dropOverlappingSizedStones, findCrossGroupCollisions } from '../src/geometry/StoneSampler.js';
import { selectNonOverlappingSizedStones } from '../src/geometry/MixedSizeGenerator.js';
import { generateGapFillStones } from '../src/geometry/GapFill.js';
import { Stone } from '../src/geometry/Stone.js';
import { SHAPE_LIBRARY_KINDS } from '../src/geometry/index.js';

const geometryDirUrl = new URL('../src/geometry/', import.meta.url);
const appJs = await readFile(fileURLToPath(new URL('../app.js', import.meta.url)), 'utf8');

async function test(name, fn) {
  try {
    await fn();
    console.log(`✓ ${name}`);
  } catch (error) {
    console.error(`✗ ${name}`);
    console.error(error);
    process.exitCode = 1;
  }
}

// `bodyOpener` locates the opening brace when the signature itself contains braces (destructured params).
function sliceBalanced(source, startMarker, label, bodyOpener = '{') {
  const start = source.indexOf(startMarker);
  assert.ok(start !== -1, `expected to find "${startMarker}" (${label})`);
  const braceStart = source.indexOf(bodyOpener, start) + bodyOpener.length - 1;
  let depth = 0;
  for (let i = braceStart; i < source.length; i++) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}') {
      depth--;
      if (depth === 0) return source.slice(start, i + 1);
    }
  }
  throw new Error(`unbalanced braces slicing "${startMarker}" (${label})`);
}

// ---------- Fixtures ----------

// The spec's grid: 2.5mm pitch, 2mm stones, starting at (0,0), `cols` columns.
function grid(count, cols) {
  return Array.from({ length: count }, (_, i) => ({ xMm: 2.5 * (i % cols), yMm: 2.5 * Math.floor(i / cols), sizeMm: 2 }));
}
// The flat {x,y,d,layerId} record shape dedupeStonesByRadius()/findCrossGroupCollisions() take,
// layerId alternating 'a'/'b' so every neighbour pair is a cross-layer comparison.
function records(stones) {
  return stones.map((s, i) => ({ x: s.xMm, y: s.yMm, d: s.sizeMm, layerId: i % 2 ? 'a' : 'b' }));
}

const BIG = grid(200000, 500);

// ---------- T1: D1 geometry at 200,000 stones ----------

await test('T1a. hasAnyOverlappingStonePair() on 200,000 stones returns false without throwing', () => {
  assert.equal(hasAnyOverlappingStonePair(BIG), false);
});

await test('T1b. measureStoneCrowding() on 200,000 stones returns the pinned metrics without throwing', () => {
  assert.deepEqual(measureStoneCrowding(BIG, { gapMm: 0.3 }), { count: 200000, minRimGapMm: 0.5, medianRimGapMm: 0.5, fractionBelowHalfGap: 0 });
});

await test('T1c. dedupeStonesByRadius() on 200,000 stone records keeps all 200,000 without throwing', () => {
  assert.equal(dedupeStonesByRadius(records(BIG)).length, 200000);
});

await test('T1d. dropOverlappingSizedStones() on 200,000 stones keeps all 200,000 without throwing', () => {
  assert.equal(dropOverlappingSizedStones(BIG).length, 200000);
});

await test('T1e. findCrossGroupCollisions() on 200,000 stone records returns [] without throwing', () => {
  assert.deepEqual(findCrossGroupCollisions(records(BIG)), []);
});

await test('T1f. selectNonOverlappingSizedStones() with 200,000 base stones accepts the one candidate 10mm outside the grid without throwing', () => {
  assert.deepEqual(selectNonOverlappingSizedStones([{ xMm: -10, yMm: -10 }], BIG, [2], 0.3), [{ xMm: -10, yMm: -10, sizeMm: 2 }]);
});

await test('T1g. source guard: generateGapFillStones() never spreads roundAccepted into push() (GapFill.js row 7)', async () => {
  const gapFillJs = await readFile(fileURLToPath(new URL('GapFill.js', geometryDirUrl)), 'utf8');
  const body = sliceBalanced(gapFillJs, 'export function generateGapFillStones(', 'generateGapFillStones()', ') {');
  assert.ok(body.includes('roundAccepted'), 'expected the slice to be the real generateGapFillStones() body');
  assert.doesNotMatch(body, /push\(\s*\.\.\.\s*roundAccepted\b/);
});

// Each RS-3039 loop, paired with the exact spread line it replaced and how often it occurs.
const SPREAD_REVERTS = {
  'MixedSizeGenerator.js': [
    ['  let maxDiameterMm = Math.max(eligibleSizesMm[0], 0);\n  for (const s of baseStones) maxDiameterMm = Math.max(maxDiameterMm, s.sizeMm);',
      '  const maxDiameterMm = Math.max(eligibleSizesMm[0], ...baseStones.map((s) => s.sizeMm), 0);', 1]
  ],
  'StoneLayout.js': [
    ['  let cellSizeMm = -Infinity;\n  for (const stone of stones) cellSizeMm = Math.max(cellSizeMm, stone.sizeMm);',
      '  const cellSizeMm = Math.max(...stones.map((stone) => stone.sizeMm));', 2]
  ],
  'StoneSampler.js': [
    ['  let cellSizeMm = -Infinity;\n  for (const s of stones) cellSizeMm = Math.max(cellSizeMm, s.d);',
      '  const cellSizeMm = Math.max(...stones.map((s) => s.d));', 2],
    ['  let cellSizeMm = -Infinity;\n  for (const s of assigned) cellSizeMm = Math.max(cellSizeMm, s.sizeMm);',
      '  const cellSizeMm = Math.max(...assigned.map((s) => s.sizeMm));', 1]
  ],
  'GapFill.js': [
    ['    for (const point of roundAccepted) acceptedPoints.push(point);', '    acceptedPoints.push(...roundAccepted);', 1]
  ]
};

// Loads `fileName` with its RS-3039 loops swapped back to the original spread lines, as a data:
// module whose relative imports point at the real files.
async function importSpreadCopy(fileName) {
  let source = await readFile(fileURLToPath(new URL(fileName, geometryDirUrl)), 'utf8');
  for (const [loopText, spreadText, expectedCount] of SPREAD_REVERTS[fileName]) {
    assert.equal(source.split(loopText).length - 1, expectedCount, `expected ${expectedCount} RS-3039 loop(s) in ${fileName}`);
    source = source.split(loopText).join(spreadText);
  }
  const fileUrl = new URL(fileName, geometryDirUrl);
  source = source.replace(/from '(\.{1,2}\/[^']+)'/g, (match, specifier) => `from '${new URL(specifier, fileUrl).href}'`);
  return import(`data:text/javascript,${encodeURIComponent(source)}`);
}

await test('T1h. on a 1,000-stone slice, every D1 geometry function gives deep-equal results in its loop and spread forms', async () => {
  const spread = {
    ...(await importSpreadCopy('StoneLayout.js')),
    ...(await importSpreadCopy('StoneSampler.js')),
    ...(await importSpreadCopy('MixedSizeGenerator.js')),
    ...(await importSpreadCopy('GapFill.js'))
  };
  const loop = {
    hasAnyOverlappingStonePair, measureStoneCrowding, dedupeStonesByRadius, dropOverlappingSizedStones,
    findCrossGroupCollisions, selectNonOverlappingSizedStones, generateGapFillStones
  };
  const cols = 50, rows = 20;
  const slice = grid(1000, cols);
  const squareCentres = slice
    .filter((s) => s.xMm < 2.5 * (cols - 1) && s.yMm < 2.5 * (rows - 1))
    .map((s) => ({ xMm: s.xMm + 1.25, yMm: s.yMm + 1.25 }));
  const run = (m) => ({
    hasAny: m.hasAnyOverlappingStonePair(slice),
    crowd: m.measureStoneCrowding(slice, { gapMm: 0.3 }),
    dedupe: m.dedupeStonesByRadius(records(slice)),
    drop: m.dropOverlappingSizedStones(slice),
    cross: m.findCrossGroupCollisions(records(slice)),
    select: m.selectNonOverlappingSizedStones(squareCentres, slice, [0.5], 0.3),
    gapFill: m.generateGapFillStones({
      baseStones: slice, gapMm: 0.3, fillerSizeMm: 0.5, isInside: () => true,
      placement: { xMm: 0, yMm: 0, widthMm: 122.5, heightMm: 47.5 }, colorAt: () => 'crystal', layerId: 'L', startIndex: 0
    }).map((stone) => ({ ...stone })),
    empty: [
      m.hasAnyOverlappingStonePair([]), m.measureStoneCrowding([], { gapMm: 0.3 }), m.dedupeStonesByRadius([]),
      m.dropOverlappingSizedStones([]), m.findCrossGroupCollisions([]),
      m.selectNonOverlappingSizedStones([{ xMm: 0, yMm: 0 }], [], [0.5], 0.3)
    ],
    nanSize: m.dropOverlappingSizedStones([{ xMm: 0, yMm: 0, sizeMm: NaN }, { xMm: 1, yMm: 0, sizeMm: 2 }]),
    overlapping: m.hasAnyOverlappingStonePair([...slice.slice(0, 10), { xMm: 0.5, yMm: 0, sizeMm: 2 }])
  });
  const loopResult = run(loop);
  assert.deepEqual(loopResult, run(spread));
  assert.equal(loopResult.select.length, 931);
  assert.equal(loopResult.gapFill.length, 931);
});

// ---------- T2/T3: app.js generate() ----------

const generateMethodSrc = sliceBalanced(appJs, 'async generate(project){await this.recoverStaleAuthoredScales(project);', 'generate()')
  .replace(/^async generate/, 'async function generate');

function buildGenerate(consoleImpl) {
  return new Function(
    'SHAPE_LAYER_TYPES', 'dedupeStonesByRadius', 'Stone', 'StoneLayout', 'console',
    `${generateMethodSrc}\nreturn generate;`
  )(new Set(['circle', 'rectangle', ...SHAPE_LIBRARY_KINDS]), dedupeStonesByRadius, Stone, StoneLayout, consoleImpl);
}

function stoneRecords(layerId, yMm, count) {
  return Array.from({ length: count }, (_, i) => ({ x: 3 * i, y: yMm, d: 2, color: 'crystal', layerId }));
}

// Three visible layers of different types; any layer id in `throwing` fails inside its Live call.
function makeEngineStub({ layers, throwing, consoleImpl }) {
  const stonesFor = (layer) => {
    if (throwing.has(layer.id)) throw new Error(`${layer.id} is too large`);
    return layer.stubStones;
  };
  return {
    generate: buildGenerate(consoleImpl),
    recoverStaleAuthoredScales: async () => {},
    generateTextStonesLive: async (layer) => stonesFor(layer),
    generateShapeStonesLive: async (layer) => stonesFor(layer),
    generateSvgStonesLive: async (layer) => stonesFor(layer),
    generateImageStonesLive: async (layer) => stonesFor(layer),
    generatePathStonesLive: async (layer) => stonesFor(layer),
    project: { layers }
  };
}

function threeLayerProject() {
  return [
    { id: 'first', type: 'text', text: 'Alpha', visible: true, stubStones: stoneRecords('first', 0, 4) },
    { id: 'middle', type: 'svg', svgName: 'logo.svg', visible: true, stubStones: stoneRecords('middle', 10, 4) },
    { id: 'third', type: 'image', imageName: 'photo.png', visible: true, stubStones: stoneRecords('third', 20, 3) }
  ];
}

function stoneSummary(layout) {
  return layout.stones.map((s) => `${s.layerId}@${s.xMm},${s.yMm}`);
}
const EXPECTED_FIRST_AND_THIRD = [
  ...stoneRecords('first', 0, 4), ...stoneRecords('third', 20, 3)
].map((s) => `${s.layerId}@${s.x},${s.y}`);

await test('T2. generate() isolates a throwing middle layer: first and third layers keep their stones in order, failures names the middle layer', async () => {
  const errors = [];
  const stub = makeEngineStub({ layers: threeLayerProject(), throwing: new Set(['middle']), consoleImpl: { error: (...args) => errors.push(args) } });
  const result = await stub.generate(stub.project);
  assert.ok(result.layout instanceof StoneLayout);
  assert.deepEqual(stoneSummary(result.layout), EXPECTED_FIRST_AND_THIRD);
  assert.equal(result.failures.length, 1);
  assert.equal(result.failures[0].layerId, 'middle');
  assert.equal(result.failures[0].error.message, 'middle is too large');
  assert.equal(errors.length, 1);
  assert.match(String(errors[0][0]), /middle/);
});

// Run once per Live branch (text / shape / svg / image / path) so every one of generate()'s five
// appends is exercised at 200,000 stones.
await test('T3. generate() with one 200,000-stone layer returns all 200,000 stones without throwing, through each of the five Live branches', async () => {
  const bigStones = BIG.map((s) => ({ x: s.xMm, y: s.yMm, d: s.sizeMm, color: 'crystal', layerId: 'big' }));
  for (const type of ['text', 'circle', 'svg', 'image', 'path']) {
    const bigLayer = { id: 'big', type, text: 'Big', visible: true, stubStones: bigStones };
    const stub = makeEngineStub({ layers: [bigLayer], throwing: new Set(), consoleImpl: { error: () => {} } });
    const result = await stub.generate(stub.project);
    assert.equal(result.layout.stones.length, 200000, `${type} branch`);
    assert.deepEqual(result.failures, [], `${type} branch`);
  }
});

// ---------- T4: app.js updateAll() status text ----------

const updateAllSrc = sliceBalanced(appJs, 'async function updateAll(skipWrite=false,forceStoneRebuild=false){', 'updateAll()');
const layerLabelSrc = sliceBalanced(appJs, 'function layerLabel(l){', 'layerLabel()');
const shapeDisplayLabelsSrc = sliceBalanced(appJs, 'const SHAPE_DISPLAY_LABELS={', 'SHAPE_DISPLAY_LABELS');
const SUCCESS_TAIL_ORDER = ['renderLayerUI', 'drawLayout', 'renderImageStudio', 'drawCup', 'updateStats', 'updateHistoryUI', 'updateEditingUI', 'updateViewButtons', 'updateTextOutsidePrintableWarning', 'scheduleAutosave'];

// Same shape as tools/test-autosave-recovery-wiring.mjs's runUpdateAll(), plus the real layerLabel()
// and a getter for the `layout` variable updateAll() assigns.
function runUpdateAll({ generate, statusText = 'Ready', permanentEngineError = null } = {}) {
  const calls = [];
  const record = (name) => () => { calls.push(name); };
  let statusValue = statusText;
  const el = (id) => {
    assert.equal(id, 'status', `updateAll() must only touch #status, not #${id}`);
    return { get textContent() { return statusValue; }, set textContent(v) { statusValue = v; } };
  };
  const drawingTool = { isActive: false, resize: record('drawingTool.resize'), syncFromProjectLayers: record('drawingTool.syncFromProjectLayers') };
  const factory = new Function(
    'writeSelectedControlsToLayer', 'engine', 'project', 'el', 'permanentEngineError', 'console',
    'renderLayerUI', 'drawLayout', 'renderImageStudio', 'drawCup', 'updateStats', 'updateHistoryUI', 'updateEditingUI',
    'updateViewButtons', 'updateTextOutsidePrintableWarning', 'scheduleAutosave', 'drawingTool', 'devicePixelRatio',
    'SHAPE_LIBRARY_KINDS',
    `
    let generationToken=0;
    let layout;
    ${shapeDisplayLabelsSrc};
    ${layerLabelSrc}
    ${updateAllSrc}
    return { updateAll, getLayout: () => layout };
    `
  );
  const { updateAll, getLayout } = factory(
    record('writeSelectedControlsToLayer'), { generate }, { layers: [] }, el, permanentEngineError, { error: () => {} },
    record('renderLayerUI'), record('drawLayout'), record('renderImageStudio'), record('drawCup'), record('updateStats'),
    record('updateHistoryUI'), record('updateEditingUI'), record('updateViewButtons'), record('updateTextOutsidePrintableWarning'),
    record('scheduleAutosave'), drawingTool, 1, SHAPE_LIBRARY_KINDS
  );
  return { run: () => updateAll(true), calls, getStatus: () => statusValue, getLayout };
}

function realGenerateFor(layers, throwing) {
  const stub = makeEngineStub({ layers, throwing, consoleImpl: { error: () => {} } });
  return () => stub.generate(stub.project);
}

await test('T4a. one failing layer: #status names it via layerLabel(), layout holds the other layers\' stones in order, and the draw step and the rest of the tail ran', async () => {
  const harness = runUpdateAll({ generate: realGenerateFor(threeLayerProject(), new Set(['middle'])) });
  await harness.run();
  assert.equal(harness.getStatus(), 'Layer "logo.svg" could not be generated: middle is too large');
  assert.deepEqual(stoneSummary(harness.getLayout()), EXPECTED_FIRST_AND_THIRD);
  assert.ok(harness.calls.includes('drawLayout'), 'the draw step must run after a layer failure');
  assert.deepEqual(harness.calls, SUCCESS_TAIL_ORDER);
});

await test('T4b. three failing layers: #status names the first and adds "(and 2 more)"', async () => {
  const layers = [
    ...threeLayerProject(),
    { id: 'fourth', type: 'path', pathName: 'Swoosh', visible: true, stubStones: stoneRecords('fourth', 30, 2) }
  ];
  const harness = runUpdateAll({ generate: realGenerateFor(layers, new Set(['first', 'middle', 'fourth'])) });
  await harness.run();
  assert.equal(harness.getStatus(), 'Layer "Alpha" could not be generated: first is too large (and 2 more)');
  assert.deepEqual(stoneSummary(harness.getLayout()), stoneRecords('third', 20, 3).map((s) => `${s.layerId}@${s.x},${s.y}`));
});

await test('T4c. a failure outside any layer reads "Layout generation failed: ..." and runs none of the tail', async () => {
  const harness = runUpdateAll({ generate: async () => { throw new Error('boom'); } });
  await harness.run();
  assert.equal(harness.getStatus(), 'Layout generation failed: boom');
  assert.deepEqual(harness.calls, []);
});

await test('T4d. a later full success resets either failure message to Ready; any other status is left alone', async () => {
  for (const stale of ['Layout generation failed: boom', 'Layer "logo.svg" could not be generated: middle is too large (and 2 more)']) {
    const harness = runUpdateAll({ statusText: stale, generate: realGenerateFor(threeLayerProject(), new Set()) });
    await harness.run();
    assert.equal(harness.getStatus(), 'Ready', `expected "${stale}" to be cleared`);
  }
  const unrelated = runUpdateAll({ statusText: 'Painted 2 regions on Alpha.', generate: realGenerateFor(threeLayerProject(), new Set()) });
  await unrelated.run();
  assert.equal(unrelated.getStatus(), 'Painted 2 regions on Alpha.');
});

await test('T4e. a font-manifest error still takes priority over a layer failure message', async () => {
  const harness = runUpdateAll({ permanentEngineError: new Error('manifest fetch failed'), generate: realGenerateFor(threeLayerProject(), new Set(['middle'])) });
  await harness.run();
  assert.match(harness.getStatus(), /^Font manifest failed to load \(manifest fetch failed\)/);
});

if (process.exitCode) console.error('\nRS-3039 large layout tests FAILED');
else console.log('\nRS-3039 large layout tests passed.');
