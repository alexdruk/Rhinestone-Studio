// IMG-026 build C1 -- the app side of ai-layout layers: validateProject(), the redraw paths
// (with a layout, without one, restore), the Fill style option, the live and export branches in
// app.js, the exporters with one 1.5 mm stone, and byte identity for gallery projects and legacy
// image modes. The app.js functions are cut out of app.js and run, not restated. See
// docs/specifications/IMG-026-StrassLayoutService.md, "App, part 1: data and engine (build C1)".

import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { GeometryEngine, Stone, StoneLayout, SHAPE_LIBRARY_KINDS } from '../src/geometry/index.js';
import { STONE_COLORS } from '../src/renderer/StoneColors.js';
import { LEGACY_IMAGE_COLOR_IDS } from '../src/renderer/CrystalColors.js';
import { isValidStoneSizeId } from '../src/renderer/StoneSizes.js';
import { applyRedraw, restoreOriginal, fitAiLayoutCanvas, REDRAW_STAGE_MESSAGES } from '../src/redraw/index.js';
import { getObjectTemplate, getPlateDefaults, normalizePlateParams, VESSEL_PRODUCT_IDS, getVesselDefaults, normalizeVesselParams, deriveLegacyVesselParams, computeCanvasFromVessel, SHEET_MAX_MM } from '../src/products/index.js';
import { computeProductionSheetLayout, productionSheetToSvg, productionSheetToPdf } from '../src/export/ProductionSheetExporter.js';
import { stoneLayoutToDxf } from '../src/export/DxfExporter.js';
import { stoneLayoutToSvg } from '../src/export/SvgExporter.js';
import { renderProductionLayout } from '../src/renderer/CanvasRenderer2D.js';
import { FontManager } from '../src/fonts/index.js';
import { createDefaultFontProviderRegistry } from '../src/text/index.js';
import { createImageBuffer } from '../src/image/index.js';
import { validateRhsProject, generateProjectStoneLayout } from './lib/rhsProject.mjs';
import { buildRegressionCases } from './lib/imageTraceFixtures.mjs';
import { assertTestRegistered } from './lib/test-registration-assertions.mjs';

let failures = 0;
async function test(name, fn) {
  try {
    await fn();
    console.log(`✓ ${name}`);
  } catch (error) {
    failures++;
    console.error(`✗ ${name}`);
    console.error(error);
  }
}

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const appJs = await readFile(path.join(repoRoot, 'app.js'), 'utf8');
const indexHtml = await readFile(path.join(repoRoot, 'index.html'), 'utf8');
const FAKE_LAYOUT = JSON.parse(await readFile(path.join(repoRoot, 'server/redraw/fixtures/fake-layout.json'), 'utf8'));
const engine = new GeometryEngine();

function extractFunction(startMarker) {
  const start = appJs.indexOf(startMarker);
  assert.ok(start !== -1, `expected to find ${startMarker} in app.js`);
  let depth = 0;
  for (let i = start + startMarker.length - 1; i < appJs.length; i++) {
    if (appJs[i] === '{') depth++;
    else if (appJs[i] === '}') { depth--; if (depth === 0) return appJs.slice(start, i + 1); }
  }
  throw new Error(`no closing brace for ${startMarker}`);
}

const fillModesLine = /const IMAGE_FILL_MODES=new Set\(\[[^\]]*\]\);/.exec(appJs)[0];
const resolveImageFillMode = new Function(`${fillModesLine}\n${extractFunction('function resolveImageFillMode(value){')}\nreturn resolveImageFillMode;`)();

// The same validateProject()/defaultProject() slice tools/test-img-023-ai-stone-transfer.mjs runs,
// with the two names the ai-layout checks read.
function extractProjectFunctions() {
  const validateMatch = appJs.match(/function validateProject\(obj\)\{[\s\S]*?\n\}\n/);
  const defaultMatch = appJs.match(/function defaultProject\(\)\{[\s\S]*?\}\}\n/);
  assert.ok(validateMatch && defaultMatch);
  const constantsStart = appJs.indexOf('const DEFAULT_TEXT_FONT_ID=');
  const source = `${appJs.slice(constantsStart, appJs.indexOf(defaultMatch[0]) + defaultMatch[0].length)}\n${appJs.slice(appJs.indexOf('const SUPPORTED_LAYER_TYPES=new Set'), appJs.indexOf(validateMatch[0]) + validateMatch[0].length)}`;
  return new Function(
    'getObjectTemplate', 'SHAPE_LIBRARY_KINDS', 'getPlateDefaults', 'normalizePlateParams',
    'VESSEL_PRODUCT_IDS', 'getVesselDefaults', 'normalizeVesselParams', 'deriveLegacyVesselParams', 'computeCanvasFromVessel',
    'isValidStoneSizeId', 'STONE_COLORS',
    `${source}\nreturn { validateProject, defaultProject };`
  )(getObjectTemplate, SHAPE_LIBRARY_KINDS, getPlateDefaults, normalizePlateParams, VESSEL_PRODUCT_IDS, getVesselDefaults, normalizeVesselParams, deriveLegacyVesselParams, computeCanvasFromVessel, isValidStoneSizeId, STONE_COLORS);
}
const { validateProject, defaultProject } = extractProjectFunctions();

// The real generateImageStonesLive() method, run as `this.permanentEngine`'s owner. Decoding an
// image is a test failure on the ai-layout path.
const liveSource = extractFunction('async generateImageStonesLive(layer,{includeStats=false}={}){').replace('async generateImageStonesLive(', 'async function generateImageStonesLive(');
const generateImageStonesLive = new Function('imageBufferCache', 'decodeDataUrlToBuffer', 'resolveImageFillMode', `return ${liveSource};`)(
  new Map(), async () => { throw new Error('unexpected decode'); }, resolveImageFillMode
);
const live = (layer, opts) => generateImageStonesLive.call({ permanentEngine: engine }, layer, opts);

const PNG = 'data:image/png;base64,';
const IMAGE_LAYER = { id: 'image1', type: 'image', visible: true, imageSrc: `${PNG}ORIGINAL`, imageName: 'cat.png', naturalWidthPx: 400, naturalHeightPx: 300, x: 60, y: 50, w: 80, h: 60, maskMode: 'subject', threshold: 128, stoneSize: 2, gap: 0.3, colorCount: 'auto', vividness: 1.4, rotationDeg: 0, fillMode: 'staggered', invert: false, transparent: 'ignore', blurRadiusPx: 0, maxWidthPx: 400, maxHeightPx: 400 };
const RESULT = { dataUrl: `${PNG}REDRAWN`, providerId: 'openai-proxy', model: 'gpt-image-2.5-sunburst', promptVersion: 3 };
const OPTS = { canvas: { width: 200, height: 200 }, naturalWidthPx: 1024, naturalHeightPx: 1024, now: () => Date.UTC(2026, 9, 6) };
const aiLayer = () => applyRedraw(IMAGE_LAYER, { ...RESULT, layout: FAKE_LAYOUT }, { ...OPTS, layout: FAKE_LAYOUT });

// ---- validateProject() ---------------------------------------------------------------------------

await test('1. validateProject() round-trips an ai-layout layer byte for byte (SS4, D2 colours, a colour swap and an out-of-box stone included)', () => {
  const l = aiLayer();
  l.aiLayout.stones.push([-1.5, 40.25, 'ss4', 'hyacinth'], [3, 3, 'ss30', 'colorado-topaz']);
  l.colorSwaps = { jet: 'scarlet' };
  const p0 = { ...defaultProject(), layers: [...defaultProject().layers, l] };
  const text = JSON.stringify(p0);
  const p1 = validateProject(JSON.parse(text));
  assert.equal(JSON.stringify(p1.layers[p1.layers.length - 1]), JSON.stringify(l));
  assert.equal(JSON.stringify(validateProject(JSON.parse(JSON.stringify(p1)))), JSON.stringify(p1));
  const legacy = validateProject({ ...defaultProject(), layers: [IMAGE_LAYER] });
  assert.equal(JSON.stringify(legacy.layers[0]), JSON.stringify(IMAGE_LAYER), 'a legacy layer is unchanged');
  const switched = { ...l, fillMode: 'ai-stones' };
  assert.doesNotThrow(() => validateProject({ ...defaultProject(), layers: [switched] }), 'a layer keeps aiLayout when switched to a legacy style');
});

await test('2. validateProject() rejects each listed bad aiLayout / colorSwaps input', () => {
  const l = aiLayer();
  const a = l.aiLayout;
  const stone = a.stones[0];
  const bad = {
    'aiLayout null': { aiLayout: null },
    'aiLayout array': { aiLayout: [] },
    'version 2': { aiLayout: { ...a, version: 2 } },
    'version missing': { aiLayout: { ...a, version: undefined } },
    'widthMm 0': { aiLayout: { ...a, widthMm: 0 } },
    'widthMm string': { aiLayout: { ...a, widthMm: '34' } },
    'heightMm negative': { aiLayout: { ...a, heightMm: -1 } },
    'heightMm missing': { aiLayout: { ...a, heightMm: undefined } },
    'stones not an array': { aiLayout: { ...a, stones: {} } },
    'stones over 20000': { aiLayout: { ...a, stones: Array.from({ length: 20001 }, () => stone) } },
    'stone not an array': { aiLayout: { ...a, stones: [{ x: 1 }] } },
    'stone x not finite': { aiLayout: { ...a, stones: [[null, 1, 'ss6', 'jet']] } },
    'stone y string': { aiLayout: { ...a, stones: [[1, '1', 'ss6', 'jet']] } },
    'stone unknown size': { aiLayout: { ...a, stones: [[1, 1, 'ss5', 'jet']] } },
    'stone unknown colour': { aiLayout: { ...a, stones: [[1, 1, 'ss6', 'ruby']] } },
    'stone too short': { aiLayout: { ...a, stones: [[1, 1, 'ss6']] } },
    'editCount 1.5': { aiLayout: { ...a, editCount: 1.5 } },
    'editCount -1': { aiLayout: { ...a, editCount: -1 } },
    'editCount missing': { aiLayout: { ...a, editCount: undefined } },
    'colorSwaps array': { colorSwaps: [] },
    'colorSwaps null': { colorSwaps: null },
    'colorSwaps unknown from': { colorSwaps: { ruby: 'jet' } },
    'colorSwaps unknown to': { colorSwaps: { jet: 'ruby' } }
  };
  for (const [label, override] of Object.entries(bad)) {
    const layer = JSON.parse(JSON.stringify({ ...l, ...override }));
    if (label === 'version missing' || label === 'heightMm missing' || label === 'editCount missing') {
      assert.ok(!(label.split(' ')[0] in layer.aiLayout));
    }
    assert.throws(() => validateProject({ ...defaultProject(), layers: [layer] }), /aiLayout|colorSwaps/, label);
  }
  const ok = { ...l, aiLayout: { ...a, stones: [[-3, 999, 'ss4', 'light-smoked-topaz']], editCount: 4 } };
  assert.doesNotThrow(() => validateProject({ ...defaultProject(), layers: [ok] }), 'out-of-box coordinates, SS4 and a D2 colour are allowed');
});

// ---- redraw writes the layout -------------------------------------------------------------------

await test('3. applyRedraw() with a layout: fillMode ai-layout, aiLayout with the kept report keys and editCount 0, colorSwaps {}, previousFillMode, box exactly widthMm x heightMm centred where the layer was', () => {
  const next = aiLayer();
  assert.equal(next.fillMode, 'ai-layout');
  assert.deepEqual(Object.keys(next.aiLayout), ['version', 'widthMm', 'heightMm', 'stones', 'report', 'editCount']);
  assert.equal(next.aiLayout.version, FAKE_LAYOUT.version);
  assert.equal(next.aiLayout.widthMm, FAKE_LAYOUT.widthMm);
  assert.equal(next.aiLayout.heightMm, FAKE_LAYOUT.heightMm);
  assert.deepEqual(next.aiLayout.stones, FAKE_LAYOUT.stones);
  assert.notEqual(next.aiLayout.stones[0], FAKE_LAYOUT.stones[0], 'stones are copied, not shared with the answer');
  const kept = ['minGapMm', 'violations', 'coverage', 'face', 'ms'].filter((k) => k in FAKE_LAYOUT.report);
  assert.deepEqual(next.aiLayout.report, Object.fromEntries(kept.map((k) => [k, FAKE_LAYOUT.report[k]])));
  assert.ok(Object.keys(FAKE_LAYOUT.report).length > kept.length, 'the fixture has report keys to drop');
  assert.equal(next.aiLayout.editCount, 0);
  assert.deepEqual(next.colorSwaps, {});
  assert.equal(next.redraw.previousFillMode, 'staggered');
  assert.equal(next.w, FAKE_LAYOUT.widthMm);
  assert.equal(next.h, FAKE_LAYOUT.heightMm);
  assert.equal(next.x + next.w / 2, IMAGE_LAYER.x + IMAGE_LAYER.w / 2);
  assert.equal(next.y + next.h / 2, IMAGE_LAYER.y + IMAGE_LAYER.h / 2);
  for (const k of ['threshold', 'blurRadiusPx', 'maxWidthPx', 'maxHeightPx', 'stoneSize', 'gap']) assert.equal(next[k], IMAGE_LAYER[k], k);
  assert.equal(next.imageSrc, RESULT.dataUrl);
  assert.equal(next.redraw.style, 'stones');

  const big = { version: 1, widthMm: 260, heightMm: 240, stones: [[1, 1, 'ss6', 'jet']], report: {} };
  const unshrunk = applyRedraw(IMAGE_LAYER, { ...RESULT, layout: big }, { ...OPTS, layout: big });
  assert.equal(unshrunk.w, 260, 'S15: never shrunk to the canvas');
  assert.equal(unshrunk.h, 240);
  assert.equal(unshrunk.x + 130, IMAGE_LAYER.x + IMAGE_LAYER.w / 2);

  const again = applyRedraw(next, { ...RESULT, layout: FAKE_LAYOUT }, { ...OPTS, layout: FAKE_LAYOUT });
  assert.equal(again.redraw.previousFillMode, 'staggered', 'a second redraw keeps the first previousFillMode');
  const flat = applyRedraw(IMAGE_LAYER, { ...RESULT, layout: FAKE_LAYOUT }, { ...OPTS, layout: FAKE_LAYOUT, style: 'flat' });
  assert.deepEqual(flat, applyRedraw(IMAGE_LAYER, RESULT, { ...OPTS, style: 'flat' }), 'a flat redraw ignores the layout');
});

await test('4. applyRedraw() without a layout is the IMG-023 path unchanged; restoreOriginal() undoes an ai-layout redraw exactly', () => {
  const withNull = applyRedraw(IMAGE_LAYER, { ...RESULT, layout: null }, { ...OPTS, layout: null, aiPitchPx: 16 });
  const before = applyRedraw(IMAGE_LAYER, RESULT, { ...OPTS, aiPitchPx: 16 });
  assert.deepEqual(withNull, before);
  assert.equal(before.fillMode, 'ai-stones');
  assert.ok(!('aiLayout' in before) && !('colorSwaps' in before));

  const next = aiLayer();
  next.colorSwaps = { jet: 'scarlet' };
  const restored = restoreOriginal(next);
  assert.deepEqual(restored, IMAGE_LAYER);
  const noFill = { ...IMAGE_LAYER };
  delete noFill.fillMode;
  assert.deepEqual(restoreOriginal(applyRedraw(noFill, RESULT, { ...OPTS, layout: FAKE_LAYOUT })), noFill, 'no fillMode before means none after');
});

await test('4b. an ai-layout layer redrawn again without a layout (or flat) loses aiLayout and colorSwaps; Use original still restores the layer from before the first redraw', () => {
  const first = { ...aiLayer(), colorSwaps: { jet: 'scarlet' } };
  const again = applyRedraw(first, { ...RESULT, layout: null, layoutError: { code: 'layout-failed', message: 'x' } }, { ...OPTS, layout: null, aiPitchPx: 16 });
  assert.equal(again.fillMode, 'ai-stones');
  assert.ok(!('aiLayout' in again) && !('colorSwaps' in again));
  assert.equal(again.redraw.previousFillMode, 'staggered');
  assert.deepEqual(restoreOriginal(again), IMAGE_LAYER);
  const flat = applyRedraw(first, { ...RESULT, layout: FAKE_LAYOUT }, { ...OPTS, layout: FAKE_LAYOUT, style: 'flat' });
  assert.equal(flat.fillMode, 'staggered');
  assert.ok(!('aiLayout' in flat) && !('colorSwaps' in flat));
  assert.deepEqual(restoreOriginal(flat), IMAGE_LAYER);
});

await test('5. fitAiLayoutCanvas(): the Flat Sheet grows to the box plus 20 mm, rounded up, capped at SHEET_MAX_MM, never shrinks', () => {
  assert.deepEqual(fitAiLayoutCanvas({ canvas: { width: 40, height: 40 }, widthMm: 34.2, heightMm: 33.87, sheetMaxMm: SHEET_MAX_MM }), { width: 55, height: 54 });
  assert.deepEqual(fitAiLayoutCanvas({ canvas: { width: 300, height: 290 }, widthMm: 34.2, heightMm: 33.87, sheetMaxMm: SHEET_MAX_MM }), { width: 300, height: 290 });
  assert.deepEqual(fitAiLayoutCanvas({ canvas: { width: 100, height: 100 }, widthMm: 600, heightMm: 120, sheetMaxMm: SHEET_MAX_MM }), { width: SHEET_MAX_MM, height: 140 });
});

// startImageRedraw() itself, run with stubs around it.
function buildStartImageRedraw({ result, template = 'sheet', canvas = { width: 40, height: 40 }, layer = IMAGE_LAYER, detection = { ok: true, pitchPx: 16 }, style = 'stones' }) {
  const state = { statuses: [], project: { canvas: { ...canvas }, layers: [JSON.parse(JSON.stringify(layer))] }, commits: 0, decoded: [], redrawRequests: [] };
  const deps = {
    redrawAvailability: { available: true, consent: null },
    selectedLayer: () => state.project.layers[0],
    askRedrawConsent: async () => true,
    setImageRedrawStatus: (text) => state.statuses.push(text),
    el: (id) => (id === 'imageRedrawStyle' ? { value: style } : {}),
    syncImageRedrawControls: () => {},
    redrawImage: async (request) => {
      state.redrawRequests.push(request);
      request.onStage('drawing');
      request.onStage('placing');
      request.onStage('done');
      return result;
    },
    REDRAW_STAGE_MESSAGES,
    decodeDataUrlToBuffer: async (dataUrl) => { state.decoded.push(dataUrl); return { widthPx: 1024, heightPx: 1024, data: new Uint8ClampedArray(4) }; },
    project: state.project,
    aiStoneDetectionFor: () => detection,
    resolveAiStoneShrink: () => 1,
    currentObjectTemplate: () => ({ id: template }),
    fitAiLayoutCanvas,
    SHEET_MAX_MM,
    fitAiStoneBox: () => ({ canvas: { width: 999, height: 999 } }),
    commitHistory: () => { state.commits++; },
    applyRedraw: (current, r, options) => applyRedraw(current, r, { ...options, now: OPTS.now }),
    imageBufferCache: new Map(),
    syncSelectedControlsFromLayer: () => {},
    updateAll: async () => {},
    RedrawError: class RedrawError extends Error {},
    saveRedrawAccessCode: () => {},
    setRedrawAccessCode: () => {},
    redrawErrorMessage: (e) => `error: ${e.message}`,
    redrawErrorDetail: () => '',
    syncImageRedrawControlsForSelection: () => {}
  };
  const names = Object.keys(deps);
  const run = new Function(...names, `let redrawRun=null,redrawConsentResolve=null,redrawConsentGiven=true;\n${extractFunction('async function startImageRedraw(){')}\nreturn startImageRedraw;`)(...names.map((n) => deps[n]));
  return { run, state };
}

await test('6. startImageRedraw() with a layout: stage texts, the Flat Sheet grows, the layer becomes ai-layout and its stones sit at x + layout x', async () => {
  const { run, state } = buildStartImageRedraw({ result: { ...RESULT, layout: FAKE_LAYOUT, layoutError: null } });
  await run();
  assert.equal(typeof state.redrawRequests[0].onStage, 'function');
  assert.deepEqual(state.statuses, ['Redrawing… this can take up to five minutes.', 'OpenAI is drawing… (up to five minutes)', 'Placing stones…', 'Redrawn with AI. Use original to undo this.']);
  assert.deepEqual(REDRAW_STAGE_MESSAGES, { drawing: 'OpenAI is drawing… (up to five minutes)', placing: 'Placing stones…' });
  assert.deepEqual(state.project.canvas, fitAiLayoutCanvas({ canvas: { width: 40, height: 40 }, widthMm: FAKE_LAYOUT.widthMm, heightMm: FAKE_LAYOUT.heightMm, sheetMaxMm: SHEET_MAX_MM }));
  assert.equal(state.commits, 1);
  const next = state.project.layers[0];
  assert.deepEqual(next, applyRedraw(IMAGE_LAYER, { ...RESULT, layout: FAKE_LAYOUT, layoutError: null }, { ...OPTS, canvas: state.project.canvas, layout: FAKE_LAYOUT }));
  const stones = await live(next);
  assert.equal(stones.length, FAKE_LAYOUT.stones.length);
  stones.forEach((s, i) => {
    assert.ok(Math.abs(s.x - (next.x + FAKE_LAYOUT.stones[i][0])) <= 1e-9 && Math.abs(s.y - (next.y + FAKE_LAYOUT.stones[i][1])) <= 1e-9, `stone ${i}`);
  });

  const mug = buildStartImageRedraw({ result: { ...RESULT, layout: FAKE_LAYOUT, layoutError: null }, template: 'mug', canvas: { width: 20, height: 20 } });
  await mug.run();
  assert.deepEqual(mug.state.project.canvas, { width: 20, height: 20 }, 'other products keep their canvas');
  assert.equal(mug.state.project.layers[0].w, FAKE_LAYOUT.widthMm, 'and the box is not shrunk');
});

await test('7. startImageRedraw() without a layout: the IMG-023 path runs and the status says why', async () => {
  const layoutError = { code: 'layout-unavailable', message: 'The layout service is not running.' };
  const { run, state } = buildStartImageRedraw({ result: { ...RESULT, layout: null, layoutError } });
  await run();
  assert.equal(state.statuses.at(-1), 'Placed with the old method: The layout service is not running.');
  const next = state.project.layers[0];
  assert.equal(next.fillMode, 'ai-stones');
  assert.ok(!('aiLayout' in next));
  assert.deepEqual(state.project.canvas, { width: 999, height: 999 }, 'the IMG-023 sheet growth ran');

  const flat = buildStartImageRedraw({ result: { ...RESULT, layout: FAKE_LAYOUT, layoutError: null }, style: 'flat' });
  await flat.run();
  assert.equal(flat.state.project.layers[0].fillMode, 'staggered', 'a flat redraw keeps the IMG-024 path');
  assert.equal(flat.state.statuses.at(-1), 'Redrawn with AI. Use original to undo this.');
});

// ---- live branch, export regions, Fill style ------------------------------------------------------

await test('8. generateImageStonesLive(): the ai-layout branch needs no decode and equals the engine; other modes still decode', async () => {
  const l = { ...aiLayer(), rotationDeg: 30, w: FAKE_LAYOUT.widthMm * 1.5, colorSwaps: { jet: 'scarlet' } };
  const expected = engine.generateImageLayout({ mode: 'ai-layout', layerId: l.id, xMm: l.x, yMm: l.y, widthMm: l.w, rotationDeg: 30, aiLayout: l.aiLayout, colorSwaps: l.colorSwaps });
  const stones = await live(l);
  assert.deepEqual(stones, expected.stones.map((s) => ({ x: s.xMm, y: s.yMm, d: s.sizeMm, color: s.color, layerId: s.layerId })));
  assert.ok(stones.some((s) => s.color === 'scarlet') && !stones.some((s) => s.color === 'jet'));
  const withStats = await live(l, { includeStats: true });
  assert.deepEqual(withStats.aiLayoutStats, expected.aiLayoutStats);
  await assert.rejects(live({ ...IMAGE_LAYER }), /unexpected decode/, 'a legacy layer still decodes its image');
  await assert.rejects(live({ ...aiLayer(), fillMode: 'ai-stones' }), /unexpected decode/, 'a switched layer keeps aiLayout but uses its legacy path');
});

await test('9. resolveImageExportRegions() skips ai-layout layers', () => {
  const run = new Function('imageBufferCache', `return ${extractFunction('function resolveImageExportRegions(project){')};`)(new Map());
  assert.deepEqual(run({ layers: [aiLayer()] }), []);
  assert.throws(() => run({ layers: [aiLayer(), IMAGE_LAYER] }), /not decoded yet/, 'legacy layers are still traced');
});

await test('10. the Fill style option: present and disabled in index.html, enabled only for a layer with aiLayout, and the write keeps ai-layout', () => {
  const select = /<select id="imageFillMode"[^>]*>([\s\S]*?)<\/select>/.exec(indexHtml)[1];
  assert.ok(select.endsWith('<option value="ai-layout" disabled>AI layout - stones placed from the AI redraw</option>'));
  assert.equal(resolveImageFillMode('ai-layout'), 'ai-layout');
  const statement = /\n  if\(l\.type==='image'\)\{el\('imageFillMode'\)[^\n]*/.exec(extractFunction('function syncSelectedControlsFromLayer(){'))[0];
  const sync = (l) => {
    const option = { disabled: true };
    const control = { value: 'fill', querySelector: (q) => (q === 'option[value="ai-layout"]' ? option : null) };
    new Function('l', 'el', 'resolveImageFillMode', statement)(l, () => control, resolveImageFillMode);
    return { disabled: option.disabled, value: control.value };
  };
  assert.deepEqual(sync(aiLayer()), { disabled: false, value: 'ai-layout' });
  assert.deepEqual(sync({ ...aiLayer(), fillMode: 'ai-stones' }), { disabled: false, value: 'ai-stones' });
  assert.deepEqual(sync(IMAGE_LAYER), { disabled: true, value: 'staggered' });
  const write = extractFunction('function writeSelectedControlsToLayer(){');
  assert.ok(write.includes("l.fillMode=resolveImageFillMode(el('imageFillMode').value);"));
  const l = { fillMode: 'ai-layout' };
  new Function('l', 'el', 'resolveImageFillMode', "l.fillMode=resolveImageFillMode(el('imageFillMode').value);")(l, () => ({ value: 'ai-layout' }), resolveImageFillMode);
  assert.equal(l.fillMode, 'ai-layout', 'never turned back into Grid Fill');
});

// ---- exporters ----------------------------------------------------------------------------------

await test('11. a 1.5 mm stone goes through the Production Sheet (labelled SS4), DXF, SVG and PNG exporters', () => {
  const layout = new StoneLayout({ layerId: 'project', stones: [new Stone({ xMm: 5, yMm: 6, sizeMm: 1.5, color: 'jet', layerId: 'a' }), new Stone({ xMm: 9, yMm: 6, sizeMm: 2, color: 'jet', layerId: 'a' })] });
  const sheet = computeProductionSheetLayout(layout, { projectName: 'SS4', objectType: 'Flat Sheet', productionWidthMm: 20, productionHeightMm: 12, gapMm: 0.1, pageSize: 'A4', marginMm: 10 });
  assert.equal(sheet.headerLines.find((l) => l.text.startsWith('Stone size:')).text, 'Stone size: SS4 (1.5 mm), SS6 (2 mm)');
  const svgSheet = productionSheetToSvg(layout, { productionWidthMm: 20, productionHeightMm: 12 });
  assert.ok(svgSheet.includes('SS4 (1.5 mm)'));
  assert.ok(Buffer.from(productionSheetToPdf(layout, { productionWidthMm: 20, productionHeightMm: 12 })).toString('latin1').includes('(Stone size: SS4 \\(1.5 mm\\), SS6 \\(2 mm\\)) Tj'), 'the PDF string escapes its parentheses');

  const dxf = stoneLayoutToDxf(layout, { widthMm: 20, heightMm: 12 }).split(/\r?\n/).map((s) => s.trim());
  const radii = [];
  let entity = null;
  for (let i = 0; i + 1 < dxf.length; i += 2) {
    if (dxf[i] === '0') entity = dxf[i + 1];
    else if (entity === 'CIRCLE' && dxf[i] === '40') radii.push(Number(dxf[i + 1]));
  }
  assert.deepEqual(radii.sort(), [0.75, 1]);

  const svg = stoneLayoutToSvg(layout, { widthMm: 20, heightMm: 12 });
  assert.ok(svg.includes('cx="5.000"') && svg.includes('r="0.750"'));

  const arcs = [];
  const ctx = new Proxy({ arc(x, y, r) { arcs.push({ x, y, r }); }, createRadialGradient() { return { addColorStop() {} }; }, createLinearGradient() { return { addColorStop() {} }; } }, { get: (o, p) => (p in o ? o[p] : () => {}), set: (o, p, v) => { o[p] = v; return true; } });
  const { s, ox, oy } = renderProductionLayout(ctx, layout, { widthPx: 800, heightPx: 600, paddingPx: 20 });
  assert.equal(arcs.filter((a) => a.x === ox + 5 * s && a.y === oy + 6 * s && a.r === Math.max(2, 1.5 * s / 2)).length, 2, 'the PNG canvas draws the 1.5 mm stone at its size');
});

// ---- byte identity --------------------------------------------------------------------------------

// sha256 of each gallery project's stones and of every legacy image mode on the shared Image Trace
// fixtures, recorded at 978dc8f (the spec commit, before build C1) with the same code as below.
const GALLERY_PINS = {
  'boolean-union-badge.rhs': '69917f270372592b13d01c3030f0c29f8d61a1a9ae5f961cf80955de6bbe82a1',
  'bottle-front-design.rhs': '62057e67ab63cdc921f4fedfebd85c046f2a7bfe83968df8c12e7df04a080437',
  'business-logo-monogram-bottle.rhs': '1c1669b14c4133aeea86bba93ae6a9c347c18a2719768509a1c78a2223ec8a1b',
  'circle-only.rhs': '4bfe6ec79e4c614438b7b8b29367f8ef07a7aa36df731aafc9fa3e4e6812cbe7',
  'front-wrap-light-cup.rhs': '67f1c3e36572230f9b36cdfa2d17249e47e1d4491dff1e2a212ab2f7ff6e6ecc',
  'large-stones-wide-gap.rhs': '596336b103085ba3540ee82bc14df8b2f9796dfe92c72c8cc1b165556a84e294',
  'long-name-autofit.rhs': 'd68f71d1f185bb669cf784e11c159e980c1f069ed10c3a82eeb5c8528b59718e',
  'long-script-name.rhs': '386150907ee475829e1c3d32612ed272641ee12e488a4a1129f4f2d1f5c9fc20',
  'mixed-all-layers.rhs': '9a078a377e97304d29f53811dea410e53b2923deb9867dbd7222490985c0626a',
  'mixed-fill-styles-and-sizes.rhs': '81c575649a7fcf6621ab5a1e270913b146d7caea31dffae3466b49f27175de76',
  'mixed-text-circle.rhs': '10b9e9e2a832e0fec1ac75816a3023c29f5aeab7745113278cf9771c7be1e1d1',
  'mixed-text-rectangle.rhs': 'caa4d7c771832cc32bb801afd538c956a5fc784027c743c29bbae72dffaf5af0',
  'monogram-fill.rhs': 'af62a8aea7979ccfa95fafb68cf76ade26a4d17283f61247a960a8d3d6dcf44d',
  'monogram-outline.rhs': '4b2c4ed0f02690a19f05b706b5e17ed79d900dada7898ca7a22daf2a2eaff7ae',
  'multi-color-mixed-layers.rhs': '3a49726d9abf3f0130a9d20fa80d354f9d8bab9b4b40ab0d033dd4f3bff61677',
  'rectangle-only.rhs': '31e77ceda7856cc4d12f5646ec2fc753e4b628c9441975248fec8e0a7dbddeec',
  'script-name-great-vibes.rhs': '22b0bb4d0d9b0395a729775c0380e212e89b2c6f8378988b5dc2c8bc0590e802',
  'short-name-block.rhs': '12f9e0b9dd13af70ced9a99f8fe34af2484f193f1af6a6caa8105bca078a9011',
  'small-stones-tight-gap.rhs': 'e0b21dbd097abb73574e219bcd2cc4ad1f8891bee5c1b055edcd310ac9776ba3',
  'svg-logo-import.rhs': '98df70ff56662b04a02db29f5075a03a51ae5065727e661ffd241aaaaaf67130',
  'team-jersey-name-number.rhs': 'ffc578bec9c26736b5934fb528184c13f142cea918d11d45bff5791574f3626d',
  'tumbler-wrap-design.rhs': 'bce213154b762bd69a121996cbf21d307972c78738706f89c7d3ce4407b150d1',
  'vitalina-serbin.rhs': '7611475e9f2a5603407344e8af6f549cbc79ebd01169ddbf62007f23c87348a5',
  'vitalina.rhs': 'e551b8f2535fe68a96273b7898efb74116b5b8e23ff7d3e737af2b17f43ba7d5',
  'wedding-bride-tribe-tumbler.rhs': '30b4cb5681719781f473c02b054e01306534687fd98f6a2243ca6c9abff90982',
  'wide-wrap-dark-cup.rhs': '2f744f4bde39da9102cdae998f728e8e739162ea98ec568015561cd555dc0d98'
};
const LEGACY_IMAGE_PIN = { cases: 112, sha256: 'a32499605e02434f3127885c3855c940061ee74a94a31625cd9d4b887c20d8fb' };
const sha = (v) => createHash('sha256').update(JSON.stringify(v)).digest('hex');

await test('12. every gallery project (without an image layer) and every legacy image mode gives the stones it gave before build C1', async () => {
  const manifest = JSON.parse(await readFile(path.join(repoRoot, 'assets/fonts/manifest.json'), 'utf8'));
  const registry = createDefaultFontProviderRegistry(new FontManager(manifest), { loadFontBuffer: async (p) => { const b = await readFile(path.join(repoRoot, p)); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength); } });
  const textEngine = new GeometryEngine({ fontProviderRegistry: registry });
  const got = {};
  for (const f of (await readdir(path.join(repoRoot, 'examples'))).filter((n) => n.endsWith('.rhs')).sort()) {
    const raw = JSON.parse(await readFile(path.join(repoRoot, 'examples', f), 'utf8'));
    if (raw.layers.some((l) => l.type === 'image')) continue;
    got[f] = sha((await generateProjectStoneLayout(validateRhsProject(raw, f), textEngine)).toJSON().stones);
  }
  assert.deepEqual(got, GALLERY_PINS);

  const palette = Object.values(STONE_COLORS).filter((c) => LEGACY_IMAGE_COLOR_IDS.includes(c.id)).map((c) => ({ id: c.id, hex: c.previewColor }));
  const image = {};
  for (const { name, buffer, params } of buildRegressionCases(createImageBuffer)) {
    for (const mode of ['fill', 'staggered', 'radial', 'contour', 'organic', 'edge', 'line-design']) {
      for (const colorCount of [1, 3]) {
        image[`${name}|${mode}|${colorCount}`] = sha(engine.generateImageLayout({ imageBuffer: buffer, ...params, mode, colorCount, palette, rotationDeg: 30 }).toJSON().stones);
      }
    }
  }
  assert.equal(Object.keys(image).length, LEGACY_IMAGE_PIN.cases);
  assert.equal(sha(image), LEGACY_IMAGE_PIN.sha256);
});

await test('Registered in tools/test-groups.mjs (integration)', () => {
  assertTestRegistered({ filename: 'test-img-026-ai-layout-app.mjs', group: 'integration', includedInDefault: true });
});

if (failures) process.exitCode = 1;
