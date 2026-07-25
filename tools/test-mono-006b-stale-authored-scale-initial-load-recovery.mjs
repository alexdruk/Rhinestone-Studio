// MONO-006B: Stale Authored Scale Initial-Load Recovery.
//
// MONO-006A (invalidateAuthoredScaleForGeometryChange(), see
// tools/test-mono-006a-authored-scale-regression.mjs) only fixed the *edit* path: it runs from
// writeSelectedControlsToLayer(), and only for the currently-selected layer, only when a DOM field
// value actually differs from the layer's stored value. Manual visual inspection found this does
// NOT cover a project that already contains a stale layer.authoredScale before the first successful
// generation -- initial load, project import, autosave recovery, undo/redo, and simply selecting a
// different layer all reach engine.generate(project) via updateAll(true) (skipWrite=true), which
// never calls writeSelectedControlsToLayer() at all (see app.js's el('selectedLayer') 'change'
// listener, applyHistorySnapshot(), performUndo()/performRedo()). One bad persisted value blanked
// both previews with the identical error reported before:
//
//   GeometryEngine.generateTextLayout: authoredScale 1.451041666666667 is invalid for this text
//   (below-minimum-scale): Requested scale 1.451041666666667 is below the minimum legal scale
//   2.161290322580649 required to keep 6.7mm of center-to-center clearance.
//
// Reproduced exactly (not guessed) with the real engine: text 'Vitalina', font 'rs-modern',
// stoneSizeMm 6.4, gapMm 0.3, authoredScale 1.451041666666667 throws this byte-for-byte -- used
// below as the regression fixture, per the brief's own instruction to use the exact reported values
// where practical.
//
// The fix: app.js's inline GeometryEngine.generate(project) -- the one place every regeneration
// entry path already funnels through, per docs/ARCHITECTURE.md ("geometry generation happens
// exactly once here") -- now calls recoverStaleAuthoredScales(project) first. For every text layer
// with an explicit numeric authoredScale, it generates that layer's *natural* (unscaled) layout for
// its CURRENT text/font/stoneSize/gap and validates the persisted scale against it via the real
// scaleAuthoredTextLayout() (MONO-002) -- the exact legality check the engine itself throws from,
// reused rather than re-derived or parsed from an exception message. A structured {ok:false} means
// the field is stale/incompatible and is deleted (never clamped, never replaced with another
// number); a structured {ok:true} means it's still legal and is left untouched. This mutates the
// live `project` object in place (no commitHistory()), so every consumer downstream -- the very
// same generate() call, autosave, Save, undo/redo history created afterward, export -- sees the
// corrected state without repeatedly re-deriving it.

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FontManager } from '../src/fonts/index.js';
import { createDefaultFontProviderRegistry } from '../src/text/index.js';
import { GeometryEngine as PermanentGeometryEngine, listFrames, Stone, StoneLayout, dedupeStonesByRadius } from '../src/geometry/index.js';
import { MonogramGenerator } from '../src/monogram/index.js';

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

// ---------- Slice the real app.js source (same convention as TXT-103/MONO-006A) ----------

function sliceLine(source, startMarker, label) {
  const start = source.indexOf(startMarker);
  assert.ok(start !== -1, `expected to find "${startMarker}" (${label}) in app.js`);
  const end = source.indexOf('\n', start);
  assert.ok(end !== -1, `expected a line ending after "${startMarker}" (${label})`);
  return source.slice(start, end);
}

function sliceBalanced(source, startMarker, label) {
  const start = source.indexOf(startMarker);
  assert.ok(start !== -1, `expected to find "${startMarker}" (${label}) in app.js`);
  const braceStart = source.indexOf('{', start);
  assert.ok(braceStart !== -1, `expected an opening brace after "${startMarker}" (${label})`);
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

const textModeToEngineModeSrc = sliceLine(appJs, 'const TEXT_MODE_TO_ENGINE_MODE=', 'TEXT_MODE_TO_ENGINE_MODE');
const resolveTextFillModeSrc = sliceLine(appJs, 'function resolveTextFillMode(textMode){', 'resolveTextFillMode()');
const sizeModesSrc = sliceLine(appJs, "const SIZE_MODES=new Set(['uniform','mixed']);", 'SIZE_MODES');
const resolveSizeModeSrc = sliceLine(appJs, 'function resolveSizeMode(value){', 'resolveSizeMode()');
const mixedSizeParamsForSrc = sliceLine(appJs, 'function mixedSizeParamsFor(layer){', 'mixedSizeParamsFor()');
const buildTextLayoutBaseParamsSrc = sliceBalanced(appJs, 'function buildTextLayoutBaseParams(layer){', 'buildTextLayoutBaseParams()');
const resolveFontProviderIdSrc = sliceLine(appJs, 'function resolveFontProviderId(fontId){', 'resolveFontProviderId()');
const isAuthoredStoneFontIdSrc = sliceLine(appJs, 'function isAuthoredStoneFontId(fontId){', 'isAuthoredStoneFontId()');
const isFontKnownSrc = sliceLine(appJs, 'function isFontKnown(fontId){', 'isFontKnown()');
const resolveAuthoredScaleSrc = sliceLine(appJs, 'function resolveAuthoredScale(layer){', 'resolveAuthoredScale()');
const invalidatingFieldsSrc = sliceLine(appJs, 'const AUTHORED_SCALE_INVALIDATING_FIELDS=', 'AUTHORED_SCALE_INVALIDATING_FIELDS');
const invalidateFnSrc = sliceBalanced(appJs, 'function invalidateAuthoredScaleForGeometryChange(layer,changedField){', 'invalidateAuthoredScaleForGeometryChange()');
const recoverMethodSrc = sliceBalanced(appJs, 'async recoverStaleAuthoredScales(project){', 'recoverStaleAuthoredScales()')
  .replace(/^async recoverStaleAuthoredScales/, 'async function recoverStaleAuthoredScales');
const generateMethodSrc = sliceBalanced(appJs, 'async generate(project){await this.recoverStaleAuthoredScales(project);', 'generate()')
  .replace(/^async generate/, 'async function generate');

await test('0. app.js wires recoverStaleAuthoredScales(project) as the first statement of generate(), before any layer is processed', () => {
  assert.match(appJs, /async generate\(project\)\{await this\.recoverStaleAuthoredScales\(project\);/);
});

// ---------- Build a sandbox exposing the real recoverStaleAuthoredScales()/generate() bodies ----------
// (Same "extract and really execute" precedent as tools/test-txt-103-text-sizing-consistency.mjs
// and tools/test-mono-006a-authored-scale-regression.mjs -- proves the actual shipped
// implementation, not a re-description of it.)

function makeSandbox(fontManagerStub) {
  const factory = new Function(
    'fontManager',
    `
    ${textModeToEngineModeSrc}
    ${resolveTextFillModeSrc}
    ${sizeModesSrc}
    ${resolveSizeModeSrc}
    ${mixedSizeParamsForSrc}
    ${resolveFontProviderIdSrc}
    ${isAuthoredStoneFontIdSrc}
    ${isFontKnownSrc}
    ${resolveAuthoredScaleSrc}
    ${invalidatingFieldsSrc}
    ${invalidateFnSrc}
    ${buildTextLayoutBaseParamsSrc}
    ${recoverMethodSrc}
    return { recoverStaleAuthoredScales, invalidateAuthoredScaleForGeometryChange };
    `
  );
  return factory(fontManagerStub);
}

// knownIds is either an array of ids (all treated as 'rhinestone' authored fonts, the common case
// below) or an explicit {id: providerId} map, for the one test that needs a non-authored font id.
function makeFontManagerStub(knownIds) {
  const providerById = Array.isArray(knownIds)
    ? new Map(knownIds.map((id) => [id, 'rhinestone']))
    : new Map(Object.entries(knownIds));
  return {
    hasFont: (id) => providerById.has(id),
    getFont: (id) => ({ providerId: providerById.get(id) })
  };
}

// ---------- Real engine + real font manifest (same recipe as MONO-005/006 tests) ----------

const manifest = JSON.parse(await readFile(path.join(repoRoot, 'assets/fonts/manifest.json'), 'utf8'));
const realFontManager = new FontManager(manifest);
async function loadFontBufferFromRepoRoot(relativePath) {
  const buffer = await readFile(path.join(repoRoot, relativePath));
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
}
function createEngine() {
  const fontProviderRegistry = createDefaultFontProviderRegistry(realFontManager, { loadFontBuffer: loadFontBufferFromRepoRoot });
  return new PermanentGeometryEngine({ fontProviderRegistry });
}

const STALE_AUTHORED_SCALE = 1.451041666666667; // the exact value from the reported regression
const LARGE_PRODUCTION_STONE_MM = 6.4;

function staleTextLayer(overrides = {}) {
  return {
    id: 'text-1', type: 'text', visible: true, text: 'Vitalina', font: 'rs-modern',
    height: 25, textMode: 'stroke', stoneSize: LARGE_PRODUCTION_STONE_MM, gap: 0.3, color: 'gold',
    autoFit: false, curveEnabled: false, curveRadiusMm: 40, curveDirection: 'outside',
    curveStartAngleDeg: 0, curveSweepAngleDeg: 180, curveAlignment: 'center',
    align: 'left', lineSpacing: 1, rotationDeg: 0, x: 0, y: 0,
    authoredScale: STALE_AUTHORED_SCALE,
    ...overrides
  };
}

await test('1. reproduces the exact reported failure with the real engine (regression fixture)', async () => {
  const engine = createEngine();
  await assert.rejects(
    () => engine.generateTextLayout({
      text: 'Vitalina', fontId: 'rs-modern', providerId: 'rhinestone', layerId: 'text-1',
      heightMm: 25, stoneSizeMm: LARGE_PRODUCTION_STONE_MM, gapMm: 0.3, mode: 'outline', color: 'gold',
      authoredScale: STALE_AUTHORED_SCALE
    }),
    /authoredScale 1\.451041666666667 is invalid for this text \(below-minimum-scale\): Requested scale 1\.451041666666667 is below the minimum legal scale 2\.161290322580649 required to keep 6\.7mm of center-to-center clearance\./
  );
});

await test('2. recoverStaleAuthoredScales() removes the stale field from a project that already contains it, before any UI edit', async () => {
  const permanentEngine = createEngine();
  const sandbox = makeSandbox(makeFontManagerStub(['rs-modern', 'rs-block']));
  const project = { layers: [staleTextLayer()] };
  await sandbox.recoverStaleAuthoredScales.call({ permanentEngine }, project);
  assert.equal('authoredScale' in project.layers[0], false);
});

await test('3. the recovered layer then generates a non-empty natural layout (both 2D/3D consumers get real data)', async () => {
  const permanentEngine = createEngine();
  const sandbox = makeSandbox(makeFontManagerStub(['rs-modern', 'rs-block']));
  const project = { layers: [staleTextLayer()] };
  await sandbox.recoverStaleAuthoredScales.call({ permanentEngine }, project);
  const layer = project.layers[0];
  const result = await permanentEngine.generateTextLayout({
    text: layer.text, fontId: layer.font, providerId: 'rhinestone', layerId: layer.id,
    heightMm: layer.height, stoneSizeMm: layer.stoneSize, gapMm: layer.gap, mode: 'outline',
    color: layer.color, authoredScale: layer.authoredScale ?? 1
  });
  assert.ok(result.stones.length > 0);
});

await test('4. a currently-legal explicit authoredScale is left completely unchanged', async () => {
  const permanentEngine = createEngine();
  const sandbox = makeSandbox(makeFontManagerStub(['rs-modern', 'rs-block']));
  // Small production stone size -- the same scale that was illegal at 6.4mm is legal back at 2.8mm.
  const project = { layers: [staleTextLayer({ stoneSize: 2.8, authoredScale: 1.05 })] };
  await sandbox.recoverStaleAuthoredScales.call({ permanentEngine }, project);
  assert.equal(project.layers[0].authoredScale, 1.05);
});

await test('5. authoredScale:1 is validated like any other explicit value, not special-cased away', async () => {
  const permanentEngine = createEngine();
  const sandbox = makeSandbox(makeFontManagerStub(['rs-modern', 'rs-block']));
  // 1 is illegal at this stone size for this text (same mechanism as the reported bug) -- must
  // still be recovered, not silently trusted just because it's the "identity" value.
  const project = { layers: [staleTextLayer({ authoredScale: 1 })] };
  await sandbox.recoverStaleAuthoredScales.call({ permanentEngine }, project);
  assert.equal('authoredScale' in project.layers[0], false);
});

await test('6. ordinary authored text without the field is left completely unchanged (no field is introduced)', async () => {
  const permanentEngine = createEngine();
  const sandbox = makeSandbox(makeFontManagerStub(['rs-modern', 'rs-block']));
  const layer = staleTextLayer();
  delete layer.authoredScale;
  const project = { layers: [layer] };
  await sandbox.recoverStaleAuthoredScales.call({ permanentEngine }, project);
  assert.equal('authoredScale' in project.layers[0], false);
});

await test('7. a sampled/OpenType text layer with an authoredScale-shaped field (has no effect there) is left untouched', async () => {
  const permanentEngine = createEngine();
  const sandbox = makeSandbox(makeFontManagerStub({ 'courier-prime-regular': 'opentype' }));
  const project = { layers: [staleTextLayer({ font: 'courier-prime-regular', authoredScale: 0.0001 })] };
  await sandbox.recoverStaleAuthoredScales.call({ permanentEngine }, project);
  // Left alone (not this milestone's contract to touch), matching MONO-002's own "no effect on
  // sampled/OpenType text" rule -- it simply never reaches the authored branch either way.
  assert.equal(project.layers[0].authoredScale, 0.0001);
});

await test('8. one stale text layer does not prevent an unrelated layer from being examined/left alone', async () => {
  const permanentEngine = createEngine();
  const sandbox = makeSandbox(makeFontManagerStub(['rs-modern', 'rs-block']));
  const project = { layers: [
    staleTextLayer({ id: 'stale' }),
    staleTextLayer({ id: 'healthy', stoneSize: 2.8, authoredScale: 1.05 })
  ] };
  await sandbox.recoverStaleAuthoredScales.call({ permanentEngine }, project);
  assert.equal('authoredScale' in project.layers[0], false, 'stale layer recovered');
  assert.equal(project.layers[1].authoredScale, 1.05, 'unrelated healthy layer untouched');
});

await test('9. non-text layers are ignored entirely (no crash, no field touched)', async () => {
  const permanentEngine = createEngine();
  const sandbox = makeSandbox(makeFontManagerStub(['rs-modern']));
  const project = { layers: [{ id: 'shape-1', type: 'circle', cx: 10, cy: 10, r: 5 }] };
  await sandbox.recoverStaleAuthoredScales.call({ permanentEngine }, project);
  assert.deepEqual(project.layers[0], { id: 'shape-1', type: 'circle', cx: 10, cy: 10, r: 5 });
});

await test('10. imported (Save/Open-shaped) stale project JSON recovers via a plain JSON round trip', async () => {
  const permanentEngine = createEngine();
  const sandbox = makeSandbox(makeFontManagerStub(['rs-modern', 'rs-block']));
  const savedJson = JSON.stringify({ version: 2, layers: [staleTextLayer()] });
  const imported = JSON.parse(savedJson);
  await sandbox.recoverStaleAuthoredScales.call({ permanentEngine }, imported);
  assert.equal('authoredScale' in imported.layers[0], false);
});

await test('11. autosave-shaped stale project data (plain object, no class instances) recovers the same way', async () => {
  const permanentEngine = createEngine();
  const sandbox = makeSandbox(makeFontManagerStub(['rs-modern', 'rs-block']));
  // Autosave stores/restores project as plain JSON-shaped data, same shape as import.
  const autosavedProject = JSON.parse(JSON.stringify({ layers: [staleTextLayer()], canvas: { width: 200, height: 200 } }));
  await sandbox.recoverStaleAuthoredScales.call({ permanentEngine }, autosavedProject);
  assert.equal('authoredScale' in autosavedProject.layers[0], false);
});

await test('12. an undo/redo snapshot containing the stale value recovers identically to a live project', async () => {
  const permanentEngine = createEngine();
  const sandbox = makeSandbox(makeFontManagerStub(['rs-modern', 'rs-block']));
  // History snapshots are deep clones of `project` (HistoryManager), so recovering directly on the
  // restored snapshot object is the exact shape applyHistorySnapshot() hands to updateAll(true).
  const snapshotProject = JSON.parse(JSON.stringify({ layers: [staleTextLayer()] }));
  await sandbox.recoverStaleAuthoredScales.call({ permanentEngine }, snapshotProject);
  assert.equal('authoredScale' in snapshotProject.layers[0], false);
});

await test('13. unexpected, unrelated generation errors are never suppressed by the recovery pass', async () => {
  const permanentEngine = createEngine();
  const sandbox = makeSandbox(makeFontManagerStub(['rs-modern']));
  // A non-finite heightMm is illegal for ANY text layer, authored or not -- a real, unrelated
  // GeometryEngine error (normalizeTextParams()'s own assertPositiveNumber) this milestone must NOT
  // swallow. It throws from inside buildTextLayoutBaseParams's own natural-layout generation call,
  // before scaleAuthoredTextLayout is ever reached -- proving the recovery pass doesn't broadly
  // catch everything, only the one structured authoredScale verdict.
  const project = { layers: [staleTextLayer({ height: NaN })] };
  await assert.rejects(
    () => sandbox.recoverStaleAuthoredScales.call({ permanentEngine }, project),
    /heightMm/
  );
});

await test('14. no permanentEngine (font manifest failed to load) is a safe no-op, not a crash', async () => {
  const sandbox = makeSandbox(makeFontManagerStub(['rs-modern']));
  const project = { layers: [staleTextLayer()] };
  await sandbox.recoverStaleAuthoredScales.call({ permanentEngine: null }, project);
  assert.equal(project.layers[0].authoredScale, STALE_AUTHORED_SCALE, 'left untouched -- real generation will also skip this layer the same way it always has');
});

// ---------- End-to-end: the real generate() (not just the recovery sub-step) ----------

const generateSandboxFactory = () => {
  const factory = new Function(
    'fontManager', 'dedupeStonesByRadius', 'Stone', 'StoneLayout', 'SHAPE_LAYER_TYPES',
    `
    ${textModeToEngineModeSrc}
    ${resolveTextFillModeSrc}
    ${sizeModesSrc}
    ${resolveSizeModeSrc}
    ${mixedSizeParamsForSrc}
    ${resolveFontProviderIdSrc}
    ${isAuthoredStoneFontIdSrc}
    ${isFontKnownSrc}
    ${resolveAuthoredScaleSrc}
    ${invalidatingFieldsSrc}
    ${invalidateFnSrc}
    ${buildTextLayoutBaseParamsSrc}
    function computeAutoFitScale(){ return { scale: 1 }; }
    function computeTextPlacementOffset(){ return { offsetX: 0, offsetY: 0 }; }
    ${recoverMethodSrc}
    async function generateTextStonesLive(layer,project){if(!this.permanentEngine||!this.permanentEngine.canGenerateText||!layer.text||!isFontKnown(layer.font))return[];const base={...buildTextLayoutBaseParams(layer),authoredScale:resolveAuthoredScale(layer)};const result=await this.permanentEngine.generateTextLayout(base);const{offsetX,offsetY}=computeTextPlacementOffset();return result.stones.map(s=>({x:s.xMm+offsetX,y:s.yMm+offsetY,d:s.sizeMm,color:s.color,layerId:s.layerId}))}
    ${generateMethodSrc
      .replace(/if\(SHAPE_LAYER_TYPES\.has\(l\.type\)\)raw\.push\(\.\.\.await this\.generateShapeStonesLive\(l\)\);/, '')
      .replace(/if\(l\.type==='svg'\)raw\.push\(\.\.\.await this\.generateSvgStonesLive\(l\)\);/, '')
      .replace(/if\(l\.type==='image'\)raw\.push\(\.\.\.await this\.generateImageStonesLive\(l\)\);/, '')
      .replace(/if\(l\.type==='path'\)raw\.push\(\.\.\.await this\.generatePathStonesLive\(l\)\);/, '')}
    return { generate, recoverStaleAuthoredScales, generateTextStonesLive };
    `
  );
  return factory;
};

await test('15. the real generate() recovers a stale layer and returns non-empty stones, all in one call (the actual entry point every regeneration path shares)', async () => {
  const permanentEngine = createEngine();
  const sandbox = generateSandboxFactory()(makeFontManagerStub(['rs-modern', 'rs-block']), dedupeStonesByRadius, Stone, StoneLayout, new Set());
  const engineLike = { permanentEngine, generate: sandbox.generate, recoverStaleAuthoredScales: sandbox.recoverStaleAuthoredScales, generateTextStonesLive: sandbox.generateTextStonesLive };
  const project = { layers: [staleTextLayer()] };
  const layout = await engineLike.generate(project);
  assert.equal('authoredScale' in project.layers[0], false, 'generate() itself recovered the layer, not just a separate helper');
  assert.ok(layout.stones.length > 0, 'expected non-empty stones from the single call every entry path makes');
});

await test('16. generate() does not re-derive the same fix on every call once recovered (idempotent, no repeated churn)', async () => {
  const permanentEngine = createEngine();
  const sandbox = generateSandboxFactory()(makeFontManagerStub(['rs-modern', 'rs-block']), dedupeStonesByRadius, Stone, StoneLayout, new Set());
  const engineLike = { permanentEngine, generate: sandbox.generate, recoverStaleAuthoredScales: sandbox.recoverStaleAuthoredScales, generateTextStonesLive: sandbox.generateTextStonesLive };
  const project = { layers: [staleTextLayer()] };
  const first = await engineLike.generate(project);
  const second = await engineLike.generate(project);
  assert.equal('authoredScale' in project.layers[0], false);
  assert.equal(first.stones.length, second.stones.length, 'stable across repeated calls once recovered');
});

// ---------- MONO-005/006 regression: still green with this milestone's changes ----------

await test('17. MONO-005 round-trip: a real MonogramGenerator-fitted authoredScale still passes recovery unchanged', async () => {
  const permanentEngine = createEngine();
  const sandbox = makeSandbox(makeFontManagerStub(['rs-modern', 'rs-block']));
  const generator = new MonogramGenerator({ geometryEngine: permanentEngine });
  const genResult = await generator.generate({
    frameId: 'square', layoutId: 'single', letters: ['W'], fontId: 'rs-modern', providerId: 'rhinestone',
    stoneSizeMm: 2.8, gapMm: 0.3, color: 'crystal',
    frameRect: { xMm: 0, yMm: 0, widthMm: 150, heightMm: 150 }, canvasMm: { widthMm: 200, heightMm: 200 }
  });
  assert.ok(genResult.ok, `expected generation to succeed: ${genResult.reason} ${genResult.message}`);
  const letterLayer = genResult.layers.find((l) => l.type === 'text');
  const originalScale = letterLayer.authoredScale;
  const project = { layers: [letterLayer] };
  await sandbox.recoverStaleAuthoredScales.call({ permanentEngine }, project);
  assert.equal(project.layers[0].authoredScale, originalScale, 'a genuinely valid fitted scale must survive recovery unchanged');
});

await test('18. MONO-006 generation still stores an explicit, valid authoredScale field on generated letters', async () => {
  const monogramGeneratorSrc = await readFile(path.join(repoRoot, 'src/monogram/MonogramGenerator.js'), 'utf8');
  assert.match(monogramGeneratorSrc, /authoredScale: requestedScale/, 'expected MonogramGenerator to still persist authoredScale (contract unchanged by this milestone)');
});

console.log('MONO-006B Stale Authored Scale Initial-Load Recovery tests complete.');
