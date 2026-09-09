// MONO-019 -- Duplicate monogram layer ids.
//
// MonogramGenerator.generate() builds every layer id from frameId + layoutId alone
// (`monogram-<frame>-<layout>-letter-N` / `-frame`). That is deliberate: the generator's output is
// byte-identical across MONO-012/015/016 and test-geometry-engine's determinism cases, so re-iding
// inside generate() would force re-baselining every one of those. Instead app.js assigns
// collision-free ids at the insertion boundary (assignInsertionLayerIds(), sliced and executed
// below) -- one Date.now()-based suffix per generation, shared by every layer of the set, the
// `monogram-` prefix shortened to `mono-` and the per-session counter taken mod 36^3 so the
// worst-case id stays inside LAYER_ID_PATTERN's 64-char cap.
//
// Run `npm ci` first (opentype.js is needed for src/text/**).
//
// Real repository fonts + frames, same generator bootstrap as tools/test-mono-018-binding-letter.mjs.
// The app.js extraction (validateProject / defaultProject / LAYER_ID_PATTERN) mirrors
// tools/test-project-validation-security.mjs verbatim.

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FontManager } from '../src/fonts/index.js';
import { createDefaultFontProviderRegistry } from '../src/text/index.js';
import { GeometryEngine, listFrames, dedupeStonesByRadius } from '../src/geometry/index.js';
import { HistoryManager } from '../src/history/index.js';
import {
  MonogramGenerator,
  MONOGRAM_LAYOUTS,
  MONOGRAM_LAYOUT_LETTER_COUNTS
} from '../src/monogram/index.js';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const appJs = await readFile(path.join(repoRoot, 'app.js'), 'utf8');

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

// --- app.js extraction ----------------------------------------------------------------------------

// Mirrors tools/test-project-validation-security.mjs's extractProjectFunctions() exactly.
async function extractProjectFunctions() {
  const validateMatch = appJs.match(/function validateProject\(obj\)\{[\s\S]*?\n\}\n/);
  assert.ok(validateMatch, 'expected to find validateProject() in app.js');
  const defaultMatch = appJs.match(/function defaultProject\(\)\{[\s\S]*?\}\}\n/);
  assert.ok(defaultMatch, 'expected to find defaultProject() in app.js');
  const constantsStart = appJs.indexOf('const DEFAULT_TEXT_FONT_ID=');
  const source = `${appJs.slice(constantsStart, appJs.indexOf(defaultMatch[0]) + defaultMatch[0].length)}\n${appJs.slice(appJs.indexOf('const SUPPORTED_LAYER_TYPES=new Set'), appJs.indexOf(validateMatch[0]) + validateMatch[0].length)}`;
  const { SHAPE_LIBRARY_KINDS } = await import('../src/geometry/index.js');
  const { getObjectTemplate, getPlateDefaults, normalizePlateParams, VESSEL_PRODUCT_IDS, getVesselDefaults, normalizeVesselParams, deriveLegacyVesselParams, computeCanvasFromVessel } = await import('../src/products/index.js');
  // eslint-disable-next-line no-new-func
  return new Function(
    'getObjectTemplate', 'SHAPE_LIBRARY_KINDS', 'getPlateDefaults', 'normalizePlateParams',
    'VESSEL_PRODUCT_IDS', 'getVesselDefaults', 'normalizeVesselParams', 'deriveLegacyVesselParams', 'computeCanvasFromVessel',
    `${source}\nreturn { validateProject, defaultProject, LAYER_ID_PATTERN };`
  )(getObjectTemplate, SHAPE_LIBRARY_KINDS, getPlateDefaults, normalizePlateParams, VESSEL_PRODUCT_IDS, getVesselDefaults, normalizeVesselParams, deriveLegacyVesselParams, computeCanvasFromVessel);
}

// The MONO-019 re-id helper, sliced from app.js's Monogram Lightbox section and executed as-is. It
// touches no browser globals -- only Date -- so it runs unmodified in Node.
function extractAssignInsertionLayerIds() {
  const m = appJs.match(/let monogramGenerationCounter=0;\nfunction assignInsertionLayerIds\(layers\)\{[\s\S]*?\n\}/);
  assert.ok(m, 'expected to find assignInsertionLayerIds() in app.js');
  // eslint-disable-next-line no-new-func
  const raw = new Function(`${m[0]}\nreturn assignInsertionLayerIds;`)();
  // MONO-020 changed assignInsertionLayerIds() to return {layers, suffix} (the suffix is also
  // stamped onto each layer as monogramSetId). These id-focused tests only assert on the layers
  // array, so unwrap it here and leave the call sites below untouched.
  return (layers) => raw(layers).layers;
}

const { validateProject, defaultProject, LAYER_ID_PATTERN } = await extractProjectFunctions();
const assignInsertionLayerIds = extractAssignInsertionLayerIds();

// --- Real generator + engine --------------------------------------------------------------------

const manifest = JSON.parse(await readFile(path.join(repoRoot, 'assets/fonts/manifest.json'), 'utf8'));
const fontManager = new FontManager(manifest);
async function loadFontBufferFromRepoRoot(relativePath) {
  const buffer = await readFile(path.join(repoRoot, relativePath));
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
}
const fontProviderRegistry = createDefaultFontProviderRegistry(fontManager, { loadFontBuffer: loadFontBufferFromRepoRoot });
const geometryEngine = new GeometryEngine({ fontProviderRegistry });
const generator = new MonogramGenerator({ geometryEngine });

const CANVAS_MM = { widthMm: 200, heightMm: 200 };

// Authored-font slot monogram (rs-block / square / single) -- emits a frame path layer + one letter
// text layer, neither carrying baked stones.
function authoredRequest(over = {}) {
  return {
    frameId: 'square', layoutId: MONOGRAM_LAYOUTS.SINGLE, letters: ['A'],
    fontId: 'rs-block', providerId: 'rhinestone', stoneSizeMm: 2.8, color: 'gold',
    frameRect: { xMm: 60, yMm: 60, widthMm: 80, heightMm: 80 }, canvasMm: CANVAS_MM,
    ...over
  };
}

// MONO-013 connected-script monogram (great-vibes / none / script) -- one text layer.
function scriptRequest(over = {}) {
  return {
    frameId: 'none', layoutId: MONOGRAM_LAYOUTS.SCRIPT, letters: ['A', 'K', 'L'],
    fontId: 'great-vibes-regular', providerId: 'opentype', stemWidthRatio: 0.0357,
    stoneSizeMm: 2.0, gapMm: 0.3, color: 'gold', canvasMm: CANVAS_MM,
    frameRect: { xMm: 0, yMm: 0, widthMm: 150, heightMm: 150 },
    ...over
  };
}

async function generateOk(request) {
  const result = await generator.generate(request);
  assert.equal(result.ok, true, `generator failed: ${result.reason} ${result.message || ''}`);
  return result;
}

function projectWithLayers(layers) {
  const project = defaultProject();
  project.layers = layers;
  return project;
}

// Live per-layer render: exactly how app.js's generate*StonesLive() reaches stones -- the engine
// stamps every stone with the layerId passed in, so a re-id'd layer object yields re-id'd stones.
async function renderLetterStones(layers) {
  const records = [];
  for (const layer of layers) {
    if (layer.type !== 'text') continue;
    const layout = await geometryEngine.generateTextLayout({
      text: layer.text, fontId: layer.font, providerId: layer.font === 'rs-block' ? 'rhinestone' : 'opentype',
      layerId: layer.id, heightMm: layer.height, stoneSizeMm: layer.stoneSize,
      gapMm: layer.gap ?? 0, mode: 'outline', color: layer.color, curveEnabled: false,
      authoredScale: layer.authoredScale
    });
    for (const s of layout.stones) {
      records.push({ x: s.xMm, y: s.yMm, d: s.sizeMm, color: s.color, layerId: s.layerId });
    }
  }
  return records;
}

// =================================================================================================

await test('1. The bug is fixed: same frame+layout generated twice into one project validates', async () => {
  const a = assignInsertionLayerIds((await generateOk(authoredRequest())).layers);
  const b = assignInsertionLayerIds((await generateOk(authoredRequest())).layers);
  const allIds = [...a, ...b].map((l) => l.id);
  assert.equal(new Set(allIds).size, allIds.length, `all inserted ids must be distinct, got ${JSON.stringify(allIds)}`);

  const project = projectWithLayers([...a, ...b]);
  const validated = validateProject(project);
  assert.equal(validated.layers.length, a.length + b.length);

  const roundTripped = JSON.parse(JSON.stringify(project));
  const revalidated = validateProject(roundTripped);
  assert.deepEqual(revalidated.layers.map((l) => l.id), allIds, 'ids survive a JSON Save/Open round trip and still validate');
});

await test('2. Negative control: the generator\'s raw un-re-id\'d output collides on the second insert', async () => {
  const rawA = (await generateOk(authoredRequest())).layers;
  const rawB = (await generateOk(authoredRequest())).layers;
  assert.deepEqual(rawA.map((l) => l.id), rawB.map((l) => l.id), 'sanity: the generator really does emit identical ids for identical requests');
  assert.throws(
    () => validateProject(projectWithLayers([...JSON.parse(JSON.stringify(rawA)), ...JSON.parse(JSON.stringify(rawB))])),
    /Duplicate layer id:/,
    'without the insertion-time re-id, two same-frame+layout monograms must be rejected by validateProject()'
  );
});

await test('3. Generator output is unchanged -- ids are still deterministic at the generator boundary', async () => {
  const first = await generateOk(authoredRequest());
  const second = await generateOk(authoredRequest());
  const firstJson = JSON.stringify(first.layers);
  const secondJson = JSON.stringify(second.layers);
  console.log('  generate() run 1:', firstJson);
  console.log('  generate() run 2:', secondJson);
  assert.equal(firstJson, secondJson, 'two generate() calls with the same request must return byte-identical layer objects');

  // develop @ 573c4e5 + the MONO-018 merge: src/monogram/MonogramGenerator.js is untouched by
  // MONO-019 (the whole change is in app.js), so this golden, captured on the branch, equals
  // develop's output. The id templates below are the generator boundary MONO-019 leaves in place.
  const DEVELOP_GOLDEN = '[{"id":"monogram-square-single-frame","type":"path","visible":true,"pathName":"Square Frame","contours":[[{"x":2,"y":0},{"x":2,"y":2},{"x":0,"y":2},{"x":0,"y":0}],[{"x":1.85,"y":0.15000000000000002},{"x":1.85,"y":1.85},{"x":0.15000000000000002,"y":1.85},{"x":0.15000000000000002,"y":0.15000000000000002}]],"x":60,"y":60,"w":80,"h":80,"stoneSize":2.8,"gap":0.3,"color":"gold","fillMode":"fill"},{"id":"monogram-square-single-letter-0","type":"text","visible":true,"text":"A","font":"rs-block","height":63.615936609554645,"textMode":"stroke","stoneSize":2.8,"gap":0.3,"color":"gold","authoredScale":3.2696740112663787,"autoFit":false,"curveEnabled":false,"curveRadiusMm":40,"curveDirection":"outside","curveStartAngleDeg":0,"curveSweepAngleDeg":180,"curveAlignment":"center","align":"left","lineSpacing":1,"rotationDeg":0,"x":0,"y":0}]';
  assert.equal(firstJson, DEVELOP_GOLDEN, 'generator output must be byte-identical to develop for a fixed request');
  const generatorSrc = await readFile(path.join(repoRoot, 'src/monogram/MonogramGenerator.js'), 'utf8');
  for (const template of [
    '`monogram-${frameId}-${layoutId}-letter-${i}`',
    '`monogram-${frameId}-${layoutId}-frame`',
    '`monogram-${frameId}-${layoutId}-letter-0`'
  ]) {
    assert.ok(generatorSrc.includes(template), `MonogramGenerator.js must still build ids from ${template} -- the generator boundary is unchanged`);
  }
});

await test('4. Worst-case re-id\'d id length, crossed from the real catalogs, fits LAYER_ID_PATTERN', async () => {
  const frameIds = listFrames().map((f) => f.id);
  const layoutIds = Object.values(MONOGRAM_LAYOUTS);
  const roleFor = (layoutId) => {
    const count = MONOGRAM_LAYOUT_LETTER_COUNTS[layoutId] || 3; // 'script' has no fixed count; 3 is its max
    const roles = ['frame'];
    for (let i = 0; i < count; i++) roles.push(`letter-${i}`);
    return roles;
  };

  let longestBase = '';
  for (const frameId of frameIds) {
    for (const layoutId of layoutIds) {
      for (const role of roleFor(layoutId)) {
        const base = `monogram-${frameId}-${layoutId}-${role}`;
        if (base.length > longestBase.length) longestBase = base;
      }
    }
  }

  // Run the real helper on the worst-case base id.
  const [reid] = assignInsertionLayerIds([{ id: longestBase }]);
  console.log('  longest base id     :', longestBase, `(${longestBase.length})`);
  console.log('  longest re-id\'d id  :', reid.id, `(${reid.id.length})`);
  assert.match(reid.id, LAYER_ID_PATTERN, 'the worst-case re-id\'d id must satisfy LAYER_ID_PATTERN');
  assert.ok(reid.id.length <= 64, `worst-case re-id\'d id is ${reid.id.length} chars, over LAYER_ID_PATTERN's 64-char limit`);

  // Explicit upper bound: the fixed catalog prefix, plus the widest suffix the format can ever
  // produce -- a 9-char base-36 Date.now() (its width through ~2059) and the mod-36^3 counter at
  // its ceiling ("zzz"). Computed, never a hardcoded string.
  const maxCounter = (36 ** 3 - 1).toString(36); // 'zzz', 3 chars
  const widestSuffix = `-${'z'.repeat(9)}-${maxCounter}`;
  const worstCase = longestBase.replace(/^monogram-/, 'mono-') + widestSuffix;
  console.log('  format upper bound  :', worstCase, `(${worstCase.length})`);
  assert.ok(worstCase.length <= 64, `format upper bound is ${worstCase.length} chars, over 64`);
  assert.match(worstCase, LAYER_ID_PATTERN);
});

await test('5. Script layers too: a MONO-013 script monogram generated twice into one project validates', async () => {
  const a = assignInsertionLayerIds((await generateOk(scriptRequest())).layers);
  const b = assignInsertionLayerIds((await generateOk(scriptRequest())).layers);
  const allIds = [...a, ...b].map((l) => l.id);
  assert.ok(allIds.every((id) => id.startsWith('mono-none-script-')), `script layers must be re-id'd by the same rule, got ${JSON.stringify(allIds)}`);
  assert.equal(new Set(allIds).size, allIds.length, `script monogram ids must be distinct, got ${JSON.stringify(allIds)}`);
  const validated = validateProject(projectWithLayers([...a, ...b]));
  assert.equal(validated.layers.length, a.length + b.length);
});

await test('6. Undo/redo restores the same ids, and the whole set is one history step', async () => {
  // Mirrors generateMonogram()'s sequence: commitHistory() (snapshot BEFORE the push) -> re-id ->
  // project.layers.push(...), then performUndo()/performRedo() as at app.js:2001-2002. The re-id
  // happens before the snapshot the redo restores, so the restored ids are the inserted ids.
  const history = new HistoryManager({ maxSize: 100 });
  let project = projectWithLayers([{ id: 'initial-layer', type: 'text', visible: true, text: 'x', stoneSize: 2.8, gap: 0.3, color: 'gold' }]);
  const snapshot = () => ({ project: JSON.parse(JSON.stringify(project)) });

  const inserted = assignInsertionLayerIds((await generateOk(authoredRequest())).layers);
  const insertedIds = inserted.map((l) => l.id);

  history.commit(snapshot());               // past: [pre-insert]
  project.layers.push(...inserted);
  assert.equal(history.pastSize, 1, 'exactly one history step for the whole monogram');

  const undone = history.undo(snapshot());  // future: [post-insert], returns pre-insert
  project = undone.project;
  assert.deepEqual(project.layers.map((l) => l.id), ['initial-layer'], 'a single undo removes every generated layer together');

  const redone = history.redo(snapshot());  // returns the post-insert snapshot
  project = redone.project;
  assert.equal(history.pastSize, 1, 'redo leaves exactly one history step, not one per layer');
  assert.deepEqual(project.layers.slice(1).map((l) => l.id), insertedIds, 'redo restores the exact ids the layers carried before the undo');
});

await test('7. Two monograms in one project keep separate layerIds on their stones (RC-004 cross-layer dedupe)', async () => {
  const a = assignInsertionLayerIds((await generateOk(authoredRequest())).layers);
  const b = assignInsertionLayerIds((await generateOk(authoredRequest())).layers);

  const recordsA = await renderLetterStones(a);
  const recordsB = await renderLetterStones(b);
  assert.ok(recordsA.length > 0 && recordsB.length > 0, 'both monograms must produce letter stones');

  const idsA = new Set(recordsA.map((r) => r.layerId));
  const idsB = new Set(recordsB.map((r) => r.layerId));
  for (const id of idsA) assert.ok(!idsB.has(id), `stone layerId ${JSON.stringify(id)} appears in both monograms -- RC-004 would treat them as one layer`);

  // The two monograms are geometrically identical and placed identically, so every B stone
  // coincides with an A stone. With distinct layerIds, dedupeStonesByRadius() drops the overlaps;
  // if they shared a layerId (RC-004 skips same-layer pairs) nothing would be dropped.
  const deduped = dedupeStonesByRadius([...recordsA, ...recordsB]);
  assert.ok(deduped.length < recordsA.length + recordsB.length, 'cross-layer dedupe must remove the coincident second-monogram stones');

  const sameLayerRecordsB = recordsB.map((r) => ({ ...r, layerId: recordsA[0].layerId }));
  const notDeduped = dedupeStonesByRadius([...recordsA, ...sameLayerRecordsB]);
  assert.equal(notDeduped.length, recordsA.length + sameLayerRecordsB.length, 'sanity: sharing a layerId makes RC-004 skip every pair -- so the assertion above is not vacuous');
});

console.log('MONO-019 (duplicate monogram layer ids) tests passed.');
