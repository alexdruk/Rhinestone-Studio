// IMG-026 build C2 -- the Image -> Strass lightbox for ai-layout layers. The N2_cat figures come from
// services/strass-layout/prototype/expected/N2_cat_final_rs.json, cropped with the S1 rule by the
// C1 test's own cropS1() (sliced out of tools/test-img-026-ai-layout-engine.mjs and run here);
// nothing about the cat is pasted in. See docs/specifications/IMG-026-StrassLayoutService.md,
// "Lightbox (build C2)" and "Acceptance figures" (Build C2).

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { GeometryEngine } from '../src/geometry/index.js';
import { STONE_COLORS } from '../src/renderer/CrystalColors.js';
import { isValidStoneSizeId } from '../src/renderer/StoneSizes.js';
import { imageStudioState, aiLayoutColourRows } from '../src/ui/index.js';
import { applyRedraw, aiLayoutBoxSize, aiLayoutImageBox } from '../src/redraw/index.js';
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

const read = (rel) => readFile(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
const appJs = await read('../app.js');
const indexHtml = await read('../index.html');
const c1Test = await read('./test-img-026-ai-layout-engine.mjs');
const catJson = JSON.parse(await read('../services/strass-layout/prototype/expected/N2_cat_final_rs.json'));
const catPng = await readFile(fileURLToPath(new URL('../services/strass-layout/prototype/img/N2_cat.png', import.meta.url)));
const engine = new GeometryEngine();

function extractFunction(marker, source = appJs) {
  const start = source.indexOf(marker);
  assert.ok(start !== -1, `app.js is missing ${marker}`);
  let depth = 0;
  for (let i = start + marker.length - 1; i < source.length; i++) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}') { depth--; if (depth === 0) return source.slice(start, i + 1); }
  }
  throw new Error(`no closing brace for ${marker}`);
}

// ---- N2_cat, cropped with the S1 rule by the C1 test's helper ------------------------------------

const cropSource = c1Test.slice(c1Test.indexOf('const round3 = '), c1Test.indexOf('const CAT = '));
assert.ok(cropSource.includes('function cropS1(stones)'), 'the C1 test still defines cropS1()');
const cropS1 = new Function(`${cropSource}\nreturn cropS1;`)();
const CAT = cropS1(catJson.stones);
const CAT_OFFSET = (() => {
  let x = Infinity, y = Infinity;
  for (const s of catJson.stones) { x = Math.min(x, s.x - s.d / 2); y = Math.min(y, s.y - s.d / 2); }
  return [Math.round(x * 1000) / 1000, Math.round(y * 1000) / 1000];
})();
const CAT_MM_PER_PX = Math.round(catJson.report.mm_per_px * 1e6) / 1e6;
const CAT_PX = [catPng.readUInt32BE(16), catPng.readUInt32BE(20)];
const CAT_REPORT = { minGapMm: catJson.report.min_gap_mm, violations: catJson.report.gap_violations, coverage: catJson.report.coverage, offsetMm: CAT_OFFSET, mmPerPx: CAT_MM_PER_PX };
const catAiLayout = (report = CAT_REPORT) => ({ ...CAT, stones: CAT.stones.map((t) => [...t]), report: { ...report } });
function catLayer(overrides = {}) {
  const aiLayout = catAiLayout();
  return {
    id: 'image1', type: 'image', visible: true, imageSrc: 'data:image/png;base64,AAAA', imageName: 'N2_cat (AI redraw)',
    naturalWidthPx: CAT_PX[0], naturalHeightPx: CAT_PX[1], x: 30, y: 20, w: aiLayout.widthMm, h: aiLayout.heightMm,
    rotationDeg: 0, fillMode: 'ai-layout', aiLayout, colorSwaps: {},
    redraw: { originalImageSrc: 'data:image/png;base64,BBBB', style: 'stones' }, ...overrides
  };
}
const LEGACY = { id: 'image2', type: 'image', fillMode: 'staggered' };
const AI_STONES = { id: 'image3', type: 'image', fillMode: 'ai-stones', redraw: { originalImageSrc: 'data:image/png;base64,CCCC' } };

await test('0. the N2_cat reference crops to 2146 stones', () => {
  assert.equal(CAT.stones.length, 2146);
  assert.deepEqual(CAT_PX, [1254, 1254]);
});

// ---- imageStudioState(): "Who sees what" --------------------------------------------------------

await test('1. imageStudioState() gives the "Who sees what" table for every listed case', () => {
  const on = { available: true, runningLayerId: null, failed: false };
  const legacyViews = { mask: true, colours: true, ai: false };
  const cases = [
    ['ai-layout, coverage 0.65', catLayer({ aiLayout: { ...catAiLayout(), report: { ...CAT_REPORT, coverage: 0.65 } } }), on,
      { legacy: false, aiColours: true, aiStats: true, redrawButton: null, useOriginal: false, views: { mask: false, colours: false, ai: true } }],
    ['ai-layout, coverage 0.4', catLayer({ aiLayout: { ...catAiLayout(), report: { ...CAT_REPORT, coverage: 0.4 } } }), on,
      { legacy: false, aiColours: true, aiStats: true, redrawButton: 'Try again', useOriginal: false, views: { mask: false, colours: false, ai: true } }],
    ['staggered', LEGACY, on,
      { legacy: true, aiColours: false, aiStats: false, redrawButton: 'Redraw with AI', useOriginal: false, views: legacyViews }],
    ['staggered, failed', LEGACY, { ...on, failed: true },
      { legacy: true, aiColours: false, aiStats: false, redrawButton: 'Try again', useOriginal: false, views: legacyViews }],
    ['ai-stones with a redraw record', AI_STONES, on,
      { legacy: true, aiColours: false, aiStats: false, redrawButton: 'Redraw with AI', useOriginal: true, views: { mask: true, colours: true, ai: true } }],
    ['the layer whose run is going', LEGACY, { ...on, runningLayerId: LEGACY.id },
      { legacy: false, aiColours: false, aiStats: false, redrawButton: null, useOriginal: false, views: legacyViews }],
    ['another layer while it runs', AI_STONES, { ...on, runningLayerId: LEGACY.id },
      { legacy: true, aiColours: false, aiStats: false, redrawButton: null, useOriginal: false, views: { mask: true, colours: true, ai: true } }],
    ['available: false', LEGACY, { ...on, available: false },
      { legacy: true, aiColours: false, aiStats: false, redrawButton: null, useOriginal: false, views: legacyViews }],
    ['available: false, ai-layout at 0.4', catLayer({ aiLayout: { ...catAiLayout(), report: { ...CAT_REPORT, coverage: 0.4 } } }), { ...on, available: false },
      { legacy: false, aiColours: true, aiStats: true, redrawButton: null, useOriginal: false, views: { mask: false, colours: false, ai: true } }],
    ['no layer', null, on,
      { legacy: false, aiColours: false, aiStats: false, redrawButton: null, useOriginal: false, views: legacyViews }]
  ];
  for (const [name, layer, options, expected] of cases) assert.deepEqual(imageStudioState(layer, options), expected, name);
  const noCoverage = catLayer({ aiLayout: { ...catAiLayout(), report: {} } });
  assert.equal(imageStudioState(noCoverage, on).redrawButton, null, 'an ai-layout layer without coverage gets no Try again');
});

// ---- aiLayoutBoxSize() (S14) ---------------------------------------------------------------------

await test('2. aiLayoutBoxSize() on N2_cat: half the width gives the layout size exactly; twice the width gives twice heightMm; a height request gives the matching width', () => {
  const a = catAiLayout();
  assert.deepEqual(aiLayoutBoxSize(a, { widthMm: a.widthMm / 2 }), { w: a.widthMm, h: a.heightMm });
  assert.deepEqual(aiLayoutBoxSize(a, { heightMm: a.heightMm / 2 }), { w: a.widthMm, h: a.heightMm });
  const twice = aiLayoutBoxSize(a, { widthMm: 2 * a.widthMm });
  assert.equal(twice.w, 2 * a.widthMm);
  assert.ok(Math.abs(twice.h - 2 * a.heightMm) <= 1e-9, `${twice.h} vs ${2 * a.heightMm}`);
  const tall = aiLayoutBoxSize(a, { heightMm: 200 });
  assert.ok(Math.abs(tall.w - 200 * a.widthMm / a.heightMm) <= 1e-9 && Math.abs(tall.h - 200) <= 1e-9, JSON.stringify(tall));
  assert.deepEqual(aiLayoutBoxSize(a, { widthMm: NaN }), { w: a.widthMm, h: a.heightMm }, 'a request that is not a number gives the layout size');
});

// ---- aiLayoutColourRows() (S17) -----------------------------------------------------------------

await test('3. aiLayoutColourRows() on N2_cat: counts sum to 2146 and are sorted; after a swap a->b row a has toId b and the engine has count(a)+count(b) stones of b', () => {
  const a = catAiLayout();
  const rows = aiLayoutColourRows(a, {});
  assert.equal(rows.reduce((n, r) => n + r.count, 0), 2146);
  assert.deepEqual(new Set(rows.map((r) => r.fromId)), new Set(a.stones.map((t) => t[3])));
  const order = Object.keys(STONE_COLORS);
  rows.forEach((r, i) => {
    assert.equal(r.toId, r.fromId);
    assert.equal(r.count, a.stones.filter((t) => t[3] === r.fromId).length, r.fromId);
    if (i > 0) assert.ok(rows[i - 1].count > r.count || (rows[i - 1].count === r.count && order.indexOf(rows[i - 1].fromId) < order.indexOf(r.fromId)), `row ${i} order`);
  });
  assert.deepEqual(aiLayoutColourRows({ stones: [[0, 0, 'ss6', 'jet'], [0, 0, 'ss6', 'gold']] }, {}).map((r) => r.fromId), order.filter((id) => id === 'jet' || id === 'gold'), 'ties follow STONE_COLORS order');

  const from = rows[0].fromId, to = rows[1].fromId;
  const swapped = aiLayoutColourRows(a, { [from]: to });
  assert.deepEqual(swapped.find((r) => r.fromId === from), { fromId: from, toId: to, count: rows[0].count });
  assert.equal(swapped.filter((r) => r.toId === to).length, 2, 'two colours swapped to one target stay two rows');
  const layout = engine.generateImageLayout({ mode: 'ai-layout', layerId: 'L', xMm: 0, yMm: 0, widthMm: a.widthMm, rotationDeg: 0, aiLayout: a, colorSwaps: { [from]: to } });
  assert.equal(layout.stones.filter((s) => s.color === to).length, rows[0].count + rows[1].count);
});

// ---- aiLayoutImageBox() and the report keys ------------------------------------------------------

await test('4. aiLayoutImageBox(): exact boxes at k = 1 and k = 2, rotation ignored by the box, null without offsetMm or mmPerPx', () => {
  const l1 = catLayer();
  assert.deepEqual(aiLayoutImageBox(l1), {
    x: l1.x - CAT_OFFSET[0], y: l1.y - CAT_OFFSET[1], w: CAT_MM_PER_PX * CAT_PX[0], h: CAT_MM_PER_PX * CAT_PX[1]
  });
  assert.ok(Math.abs(aiLayoutImageBox(l1).w - catJson.report.width_mm) < 0.01, 'the AI image spans the prototype frame');
  const l2 = catLayer({ w: 2 * CAT.widthMm, h: 2 * CAT.heightMm, rotationDeg: 30 });
  assert.deepEqual(aiLayoutImageBox(l2), {
    x: l2.x - 2 * CAT_OFFSET[0], y: l2.y - 2 * CAT_OFFSET[1], w: 2 * CAT_MM_PER_PX * CAT_PX[0], h: 2 * CAT_MM_PER_PX * CAT_PX[1]
  });
  const small = catLayer({ w: CAT.widthMm / 2 });
  assert.deepEqual(aiLayoutImageBox(small), aiLayoutImageBox(l1), 'k below 1 is 1');
  const { offsetMm, ...noOffset } = CAT_REPORT;
  const { mmPerPx, ...noScale } = CAT_REPORT;
  assert.equal(aiLayoutImageBox(catLayer({ aiLayout: catAiLayout(noOffset) })), null);
  assert.equal(aiLayoutImageBox(catLayer({ aiLayout: catAiLayout(noScale) })), null);
  assert.equal(aiLayoutImageBox({ ...LEGACY }), null);

  const stone = l1.aiLayout.stones[0], d = catJson.stones[0].d;
  const box = aiLayoutImageBox(l1);
  const px = (l1.x + stone[0] - box.x) / CAT_MM_PER_PX;
  assert.ok(Math.abs(px - catJson.stones[0].x / catJson.report.mm_per_px) < 0.05, `stone 0 sits on its AI pixel (${px})`);
  assert.ok(d > 0);
});

async function extractProjectFunctions() {
  const validateMatch = appJs.match(/function validateProject\(obj\)\{[\s\S]*?\n\}\n/);
  const defaultMatch = appJs.match(/function defaultProject\(\)\{[\s\S]*?\}\}\n/);
  assert.ok(validateMatch && defaultMatch);
  const constantsStart = appJs.indexOf('const DEFAULT_TEXT_FONT_ID=');
  const source = `${appJs.slice(constantsStart, appJs.indexOf(defaultMatch[0]) + defaultMatch[0].length)}\n${appJs.slice(appJs.indexOf('const SUPPORTED_LAYER_TYPES=new Set'), appJs.indexOf(validateMatch[0]) + validateMatch[0].length)}`;
  const { SHAPE_LIBRARY_KINDS } = await import('../src/geometry/index.js');
  const { getObjectTemplate, getPlateDefaults, normalizePlateParams, VESSEL_PRODUCT_IDS, getVesselDefaults, normalizeVesselParams, deriveLegacyVesselParams, computeCanvasFromVessel } = await import('../src/products/index.js');
  return new Function(
    'getObjectTemplate', 'SHAPE_LIBRARY_KINDS', 'getPlateDefaults', 'normalizePlateParams',
    'VESSEL_PRODUCT_IDS', 'getVesselDefaults', 'normalizeVesselParams', 'deriveLegacyVesselParams', 'computeCanvasFromVessel',
    'STONE_COLORS', 'isValidStoneSizeId',
    `${source}\nreturn { validateProject, defaultProject };`
  )(getObjectTemplate, SHAPE_LIBRARY_KINDS, getPlateDefaults, normalizePlateParams, VESSEL_PRODUCT_IDS, getVesselDefaults, normalizeVesselParams, deriveLegacyVesselParams, computeCanvasFromVessel, STONE_COLORS, isValidStoneSizeId);
}

await test('5. applyRedraw() keeps offsetMm and mmPerPx; validateProject() accepts them and rejects a bad offsetMm and a non-positive mmPerPx', async () => {
  const layout = { version: 1, widthMm: CAT.widthMm, heightMm: CAT.heightMm, stones: CAT.stones, report: { ...CAT_REPORT, frameMm: catJson.report.width_mm, stagesMs: {} } };
  const before = { ...catLayer(), fillMode: 'staggered' };
  delete before.aiLayout; delete before.colorSwaps; delete before.redraw;
  const next = applyRedraw(before, { dataUrl: 'data:image/png;base64,DDDD', providerId: 'p', model: 'm', promptVersion: 3 }, { canvas: { width: 300, height: 300 }, naturalWidthPx: CAT_PX[0], naturalHeightPx: CAT_PX[1], now: () => 0, layout });
  assert.deepEqual(next.aiLayout.report.offsetMm, CAT_OFFSET);
  assert.notEqual(next.aiLayout.report.offsetMm, layout.report.offsetMm, 'offsetMm is copied');
  assert.equal(next.aiLayout.report.mmPerPx, CAT_MM_PER_PX);
  assert.ok(!('frameMm' in next.aiLayout.report) && !('stagesMs' in next.aiLayout.report));

  const { validateProject, defaultProject } = await extractProjectFunctions();
  const base = { ...next, threshold: 128, blurRadiusPx: 0, maxWidthPx: 400, maxHeightPx: 400, stoneSize: 2, gap: 0.3, color: 'gold', redraw: { ...next.redraw, originalImageSrc: 'data:image/png;base64,AAAA' } };
  const withLayer = (layer) => ({ ...defaultProject(), layers: [...defaultProject().layers, layer] });
  const p0 = validateProject(withLayer(base));
  assert.equal(JSON.stringify(validateProject(JSON.parse(JSON.stringify(p0)))), JSON.stringify(p0), 'round-trips with both keys');
  const report = (r) => ({ ...base, aiLayout: { ...base.aiLayout, report: r } });
  validateProject(withLayer(report({ coverage: 0.6 })));
  for (const bad of [[1], [1, 'a'], [1, Infinity], 'x', [1, 2, 3]]) {
    assert.throws(() => validateProject(withLayer(report({ ...CAT_REPORT, offsetMm: bad }))), /offsetMm must be two finite numbers/, JSON.stringify(bad));
  }
  for (const bad of [0, -0.1, NaN, '0.1']) {
    assert.throws(() => validateProject(withLayer(report({ ...CAT_REPORT, mmPerPx: bad }))), /mmPerPx must be a positive number/, String(bad));
  }
});

// ---- index.html ----------------------------------------------------------------------------------

function elementHtml(html, id) {
  const open = html.indexOf(`id="${id}"`);
  assert.ok(open !== -1, `index.html is missing #${id}`);
  const start = html.lastIndexOf('<', open);
  const tag = /^<(\w+)/.exec(html.slice(start))[1];
  const re = new RegExp(`<${tag}\\b|</${tag}>`, 'g');
  re.lastIndex = start;
  let depth = 0, m;
  while ((m = re.exec(html))) {
    depth += m[0].startsWith('</') ? -1 : 1;
    if (depth === 0) return html.slice(start, m.index + m[0].length);
  }
  throw new Error(`#${id} is not closed`);
}

await test('6. index.html: the wrapper holds exactly the seven legacy groups; Position & size comes before it; Colours used, the stats rows and the view ids exist; the style field stays hidden', () => {
  const controls = elementHtml(indexHtml, 'imageStudioControls');
  const wrapper = elementHtml(indexHtml, 'legacyImageControls');
  assert.ok(wrapper.startsWith('<div id="legacyImageControls">'));
  const groupIds = (html) => [...html.matchAll(/<details class="advanced-section" id="(imageStudioGroup\w+)"/g)].map((m) => m[1]);
  assert.deepEqual(groupIds(wrapper), ['imageStudioGroupTrace', 'imageStudioGroupStones', 'imageStudioGroupColors', 'imageStudioGroupOrganic', 'imageStudioGroupEdges', 'imageStudioGroupCheckFix', 'imageStudioGroupBrightness']);
  assert.deepEqual(groupIds(controls), ['imageStudioGroupSource', 'imageStudioGroupPosition', 'imageStudioGroupTrace', 'imageStudioGroupStones', 'imageStudioGroupColors', 'imageStudioGroupOrganic', 'imageStudioGroupEdges', 'imageStudioGroupCheckFix', 'imageStudioGroupBrightness', 'imageStudioGroupAiColours']);
  assert.ok(controls.indexOf('id="imageStudioGroupPosition"') < controls.indexOf('id="legacyImageControls"'));
  assert.ok(controls.indexOf('id="legacyImageControls"') < controls.indexOf('id="imageStudioGroupAiColours"'));
  for (const id of ['imageTraceStoneSlot', 'imageTraceMixedSizeSlot', 'imageRedrawStyle', 'imgMaskMode', 'imageFillMode', 'imgColorReset']) {
    const inWrapper = wrapper.includes(`id="${id}"`);
    assert.equal(inWrapper, id !== 'imageRedrawStyle', `#${id} ${inWrapper ? 'is' : 'is not'} inside the wrapper`);
  }
  assert.equal(elementHtml(indexHtml, 'imageStudioGroupAiColours'), '<details class="advanced-section" id="imageStudioGroupAiColours" open>\n          <summary>Colours used</summary>\n          <div id="aiLayoutColourRows"></div>\n          <button id="aiLayoutColourReset" class="btn sm">Reset colours</button>\n        </details>');
  assert.match(indexHtml, /<label id="imageRedrawStyleField" class="image-redraw-style" hidden>/);
  const stats = elementHtml(indexHtml, 'imageStudioStats');
  const rows = [...stats.matchAll(/<dt(?: id="(\w+)")?( hidden)?>([^<]*)<\/dt><dd id="(\w+)"( hidden)?>/g)].map((m) => [m[3], m[4], Boolean(m[2]) && Boolean(m[5]) && m[1] === `${m[4]}Label`]);
  assert.deepEqual(rows, [
    ['Image', 'imageStudioStatImage', false], ['Stones', 'imageStudioStatCount', false], ['Sizes', 'imageStudioStatSizes', false],
    ['Colours', 'imageStudioStatColors', false], ['Bounding box', 'imageStudioStatBox', false],
    ['Min gap', 'imageStudioStatMinGap', true], ['Gap violations', 'imageStudioStatViolations', true],
    ['Coverage', 'imageStudioStatCoverage', true], ['Enlarged', 'imageStudioStatScale', true]
  ]);
  assert.ok(indexHtml.includes('<label id="imageStudioViewMask"><input type="radio" name="imageStudioView" value="mask">Mask</label>'));
  assert.ok(indexHtml.includes('<label id="imageStudioViewColors"><input type="radio" name="imageStudioView" value="colors">Colours</label>'));
});

// ---- app.js --------------------------------------------------------------------------------------

function fakeElements() {
  const els = {};
  const el = (id) => {
    if (!els[id]) {
      const classes = new Set();
      els[id] = {
        id, hidden: false, disabled: false, textContent: '', value: '', checked: false, attributes: {},
        classList: { toggle: (c, on) => (on ? classes.add(c) : classes.delete(c)), contains: (c) => classes.has(c) },
        removeAttribute(name) { delete this.attributes[name]; delete this[name]; }
      };
    }
    return els[id];
  };
  return { els, el };
}

function buildUploadHandler({ availability, startImageRedraw, getRedrawAvailability }) {
  const marker = "el('importImageFile').addEventListener('change',async e=>{";
  const handler = appJs.match(/el\('importImageFile'\)\.addEventListener\('change',async e=>\{[\s\S]*?\n\}\);/)[0];
  const body = handler.slice(marker.length, -3);
  const state = { statuses: [], project: { layers: [] }, getCalls: 0 };
  const deps = {
    el: (id) => (id === 'status' ? { set textContent(v) { state.status = v; } } : {}),
    isSupportedImageFile: () => true,
    decodeImageFileToBuffer: async () => ({ widthPx: 10, heightPx: 10 }),
    readFileAsDataUrl: async () => 'data:image/png;base64,AAAA',
    imageBufferCache: new Map(),
    computeDefaultImagePlacement: () => ({ x: 0, y: 0, w: 10, h: 10 }),
    DEFAULT_IMAGE_THRESHOLD: 128, DEFAULT_IMAGE_MAX_DIMENSION_PX: 400,
    selectedLayer: () => ({ gap: 0.3, color: 'gold' }),
    commitHistory: () => {},
    project: state.project,
    selectOnly: (id) => new Set([id]),
    syncSelectedControlsFromLayer: () => {},
    updateAll: async () => {},
    getRedrawAvailability: async () => { state.getCalls++; return getRedrawAvailability; },
    startImageRedraw: () => { state.started = state.project.layers.at(-1).id; startImageRedraw?.(); },
    setImageRedrawStatus: (text) => state.statuses.push(text)
  };
  const names = Object.keys(deps);
  const run = new Function(...names, 'redrawAvailability0', `let selectedLayerId=null,selectedLayerIds=null,redrawAvailabilityRequested=false,redrawAvailability=redrawAvailability0;\nreturn async e=>{${body}};`)(...names.map((n) => deps[n]), availability);
  return { run: () => run({ target: { files: [{ name: 'cat.png', type: 'image/png' }], value: 'x' } }), state };
}

await test('7. app.js: the upload handler starts the redraw, awaiting availability when unknown; without a provider it says so', async () => {
  const known = buildUploadHandler({ availability: { available: true } });
  await known.run();
  assert.equal(known.state.started, known.state.project.layers[0].id, 'started on the new layer');
  assert.equal(known.state.getCalls, 0);
  const unknown = buildUploadHandler({ availability: null, getRedrawAvailability: { available: true } });
  await unknown.run();
  assert.equal(unknown.state.getCalls, 1);
  assert.ok(unknown.state.started);
  const none = buildUploadHandler({ availability: null, getRedrawAvailability: { available: false } });
  await none.run();
  assert.equal(none.state.started, undefined);
  assert.deepEqual(none.state.statuses, ['Redraw with AI is not available on this server, so the image was placed with the classic method.']);
  assert.equal(none.state.project.layers[0].fillMode, 'staggered', 'the layer is created as before');
});

await test('8. app.js: Remove aborts a run on its own layer only, before deleting it', () => {
  const handler = appJs.match(/el\('imageStudioRemove'\)\.onclick=\(\)=>\{[\s\S]*?\};/)[0];
  const runRemove = (runningLayerId) => {
    const log = [];
    const target = {};
    const redrawRun = { abort: () => log.push('abort') };
    new Function('el', 'selectedLayer', 'deleteLayer', 'lightboxes', 'redrawRun', 'runningLayerId', handler)(
      () => target, () => ({ id: 'img1', type: 'image' }), (id) => log.push(`delete ${id}`), { imagetrace: { isOpen: true, open() {} } }, redrawRun, runningLayerId
    );
    target.onclick();
    return log;
  };
  assert.deepEqual(runRemove('img1'), ['abort', 'delete img1']);
  assert.deepEqual(runRemove('img9'), ['delete img1']);
  assert.deepEqual(runRemove(null), ['delete img1']);
});

function buildStartImageRedraw({ result, failWith = null, consent = true }) {
  const layer = { id: 'image1', type: 'image', imageSrc: 'data:image/png;base64,AAAA', x: 0, y: 0, w: 50, h: 50, stoneSize: 2, gap: 0.3, fillMode: 'staggered', threshold: 128, blurRadiusPx: 0, maxWidthPx: 400, maxHeightPx: 400 };
  const state = { statuses: [], views: [], project: { canvas: { width: 300, height: 300 }, layers: [layer] }, requests: [], runningSeen: [] };
  const failed = new Set(['image1']);
  const deps = {
    redrawAvailability: { available: true, consent: consent ? null : { recipientName: 'X' } },
    selectedLayer: () => state.project.layers[0],
    askRedrawConsent: async () => false,
    setImageRedrawStatus: (text) => state.statuses.push(text),
    el: (id) => (id === 'imageRedrawStyle' ? { value: 'flat' } : {}),
    syncImageRedrawControls: () => {},
    redrawImage: async (request) => { state.requests.push(request); state.runningSeen.push(getRunning()); if (failWith) throw failWith; return result; },
    REDRAW_STAGE_MESSAGES: {},
    decodeDataUrlToBuffer: async () => ({ widthPx: 1254, heightPx: 1254 }),
    project: state.project,
    aiStoneDetectionFor: () => ({ ok: false }),
    resolveAiStoneShrink: () => 1,
    currentObjectTemplate: () => ({ id: 'mug' }),
    fitAiLayoutCanvas: () => null, SHEET_MAX_MM: 600, fitAiStoneBox: () => null,
    commitHistory: () => {},
    applyRedraw: (current, r, options) => applyRedraw(current, r, options),
    imageBufferCache: new Map(),
    syncSelectedControlsFromLayer: () => {},
    updateAll: async () => {},
    RedrawError: class RedrawError extends Error {},
    saveRedrawAccessCode: () => {}, setRedrawAccessCode: () => {},
    redrawErrorMessage: (e) => `error: ${e.message}`, redrawErrorDetail: () => '',
    syncImageRedrawControlsForSelection: () => {},
    setImageStudioView: (v) => state.views.push(v),
    renderImageStudio: () => {},
    redrawFailedLayerIds: failed
  };
  const names = Object.keys(deps);
  let getRunning = () => undefined;
  const { run, running } = new Function(...names, `let redrawRun=null,redrawConsentResolve=null,redrawConsentGiven=false,runningLayerId=null;\n${extractFunction('async function startImageRedraw(){')}\nreturn { run: startImageRedraw, running: () => runningLayerId };`)(...names.map((n) => deps[n]));
  getRunning = running;
  return { run, running, state, failed };
}

await test('9. app.js: startImageRedraw() sends stones whatever the old select says, sets runningLayerId for the run, shows Source then Template, and keeps the failed set', async () => {
  const report = { minGapMm: 0.1, violations: 2, coverage: 0.65, offsetMm: CAT_OFFSET, mmPerPx: CAT_MM_PER_PX };
  const ok = buildStartImageRedraw({ result: { dataUrl: 'data:image/png;base64,EEEE', providerId: 'p', model: 'm', promptVersion: 3, layout: { version: 1, widthMm: CAT.widthMm, heightMm: CAT.heightMm, stones: CAT.stones, report } } });
  await ok.run();
  assert.equal(ok.state.requests[0].style, 'stones');
  assert.deepEqual(ok.state.runningSeen, ['image1']);
  assert.equal(ok.running(), null, 'cleared after the run');
  assert.deepEqual(ok.state.views, ['source', 'template']);
  assert.equal(ok.state.statuses.at(-1), 'Placed 2146 stones. Gap check: 2 violations.');
  assert.ok(!ok.failed.has('image1'), 'a run with a layout removes the layer from the failed set');

  const fallback = buildStartImageRedraw({ result: { dataUrl: 'data:image/png;base64,EEEE', providerId: 'p', model: 'm', promptVersion: 3, layout: null, layoutError: { message: 'down' } } });
  fallback.failed.clear();
  await fallback.run();
  assert.ok(fallback.failed.has('image1'), 'the old-method fallback marks the layer failed');
  assert.deepEqual(fallback.state.views, ['source']);

  const failing = buildStartImageRedraw({ result: null, failWith: Object.assign(new Error('x'), { name: 'AbortError' }) });
  failing.failed.clear();
  await failing.run();
  assert.ok(failing.failed.has('image1'), 'a cancel marks the layer failed');
  assert.equal(failing.running(), null);

  const refused = buildStartImageRedraw({ result: null, consent: false });
  refused.failed.clear();
  await refused.run();
  assert.ok(refused.failed.has('image1'), 'refused consent marks the layer failed');
  assert.equal(refused.state.requests.length, 0);
});

await test('10. app.js: "Try again" asks first when the layout has manual edits', () => {
  const handler = appJs.match(/el\('imageRedraw'\)\.onclick=\(\)=>\{[\s\S]*?\};/)[0];
  const run = (layer, answer) => {
    const log = [];
    const target = {};
    const imageStudioStateFor = (l) => imageStudioState(l, { available: true, runningLayerId: null, failed: false });
    new Function('el', 'selectedLayer', 'imageStudioStateFor', 'startImageRedraw', 'window', handler)(
      () => target, () => layer, imageStudioStateFor, () => log.push('start'), { confirm: (text) => { log.push(text); return answer; } }
    );
    target.onclick();
    return log;
  };
  const low = (editCount) => catLayer({ aiLayout: { ...catAiLayout(), report: { ...CAT_REPORT, coverage: 0.4 }, editCount } });
  assert.deepEqual(run(low(3), false), ['This discards 3 manual edits.']);
  assert.deepEqual(run(low(3), true), ['This discards 3 manual edits.', 'start']);
  assert.deepEqual(run(low(0), false), ['start']);
  assert.deepEqual(run({ ...LEGACY }, false), ['start'], 'Redraw with AI never asks');
  assert.match(appJs, /^\/\/ confirm dialog of its own, so this is window\.confirm\.$/m);
});

await test('11. app.js: syncImageRedrawControls() and renderImageStudio() apply imageStudioState() and do not restate its rules', () => {
  const sync = extractFunction('function syncImageRedrawControls(l){');
  const apply = extractFunction('function applyImageStudioState(state){');
  const studio = extractFunction('async function renderImageStudio(){');
  for (const source of [sync, apply, studio]) {
    assert.ok(!/fillMode\s*[!=]==\s*'ai-layout'|coverage\s*<|'Try again'|'Redraw with AI'/.test(source.replace(/const aiImageBox=mode==='ai-layout'\?/, '')), 'no restated rule');
  }
  assert.ok(sync.includes('state=imageStudioStateFor(l)'));
  assert.ok(studio.includes('const state=imageStudioStateFor(l);\n  applyImageStudioState(state);'));
  assert.ok(studio.includes('applyImageStudioState(imageStudioStateFor(null))'));

  for (const [layer, legacy] of [[catLayer(), false], [{ ...LEGACY }, true]]) {
    const { els, el } = fakeElements();
    const view = { value: 'mask' };
    const viewInputs = { querySelector: (q) => (q === 'input:checked' ? { value: view.value } : { set checked(v) { if (v) view.value = /value="(\w+)"/.exec(q)[1]; } }) };
    const AI_LAYOUT_STAT_IDS = /const AI_LAYOUT_STAT_IDS=(\[[^\]]*\]);/.exec(appJs)[1];
    const setImageStudioView = new Function('el', `return ${extractFunction('function setImageStudioView(value){')};`)((id) => (id === 'imageStudioView' ? viewInputs : el(id)));
    const applyFn = new Function('el', 'setImageStudioView', `const AI_LAYOUT_STAT_IDS=${AI_LAYOUT_STAT_IDS};\nreturn ${apply};`)((id) => (id === 'imageStudioView' ? viewInputs : el(id)), setImageStudioView);
    applyFn(imageStudioState(layer, { available: true }));
    assert.equal(els.legacyImageControls.hidden, !legacy);
    assert.equal(els.imageStudioGroupAiColours.hidden, legacy);
    for (const id of ['imageStudioStatMinGap', 'imageStudioStatViolations', 'imageStudioStatCoverage', 'imageStudioStatScale']) {
      assert.equal(els[id].hidden, legacy, id);
      assert.equal(els[`${id}Label`].hidden, legacy, `${id}Label`);
    }
    assert.equal(els.imageStudioViewMask.hidden, !legacy);
    assert.equal(els.imageStudioViewColors.hidden, !legacy);
    assert.equal(view.value, legacy ? 'mask' : 'template', 'a checked hidden view falls back to Template');
  }

  const { els, el } = fakeElements();
  new Function('el', 'imageStudioStateFor', 'redrawAvailabilityRequested', 'redrawRun', `return ${sync};`)(el, (l) => imageStudioState(l, { available: true, failed: true }), true, null)({ ...LEGACY });
  assert.equal(els.imageRedraw.hidden, false);
  assert.equal(els.imageRedraw.textContent, 'Try again');
  assert.equal(els.imageRedrawUseOriginal.hidden, true);
  assert.ok(!('imageRedrawStyleField' in els), 'the style field is never touched, so it stays hidden');
});

await test('12. app.js: the colour rows and Reset are not history-tracked controls; writeSelectedControlsToLayer() reads neither', () => {
  const history = /const HISTORY_TRACKED_CONTROL_IDS=\[([^\]]*)\];/.exec(appJs)[1];
  assert.ok(!history.includes('aiLayoutColour'));
  const write = extractFunction('function writeSelectedControlsToLayer(){');
  assert.ok(!write.includes('aiLayoutColour') && !write.includes('colorSwaps'));
  assert.ok(appJs.includes("el('aiLayoutColourReset').onclick=()=>{const l=selectedLayer();if(!l||l.type!=='image'||l.fillMode!=='ai-layout')return;commitHistory();l.colorSwaps={};updateAll(true)};"));
  const rows = extractFunction('function renderAiLayoutColourRows(l){');
  assert.ok(rows.includes('aiLayoutColourRows(l.aiLayout,l.colorSwaps)') && rows.includes('populateStoneColorOptions(pick.id)'));
  assert.ok(rows.includes("commitHistory();if(!target.colorSwaps)target.colorSwaps={};if(pick.value===row.fromId)delete target.colorSwaps[row.fromId];else target.colorSwaps[row.fromId]=pick.value;updateAll(true)"));
});

const resizeBranch = (() => {
  const start = appJs.indexOf("}else if(drag.kind==='resize'){");
  const end = appJs.indexOf("}else if(drag.kind==='rotate'){", start);
  return appJs.slice(start + "}else if(drag.kind==='resize'){".length, end);
})();
const rotatePointDeg = new Function(`return ${extractFunction('function rotatePointDeg(x,y,cx,cy,rotationDeg){')};`)();
const HANDLE_UNIT_OFFSET = new Function(`return ${/const HANDLE_UNIT_OFFSET=(\{[^;]*\});/.exec(appJs)[1]};`)();
function resizeDrag(layer, handle, mm) {
  const project = { layers: [layer] };
  const b0 = { x: layer.x, y: layer.y, width: layer.w, height: layer.h, x2: layer.x + layer.w, y2: layer.y + layer.h };
  const rotationDeg = layer.rotationDeg || 0, off = HANDLE_UNIT_OFFSET[handle];
  const cx0 = b0.x + b0.width / 2, cy0 = b0.y + b0.height / 2;
  const anchorLocal = { x: cx0 - off.x * (b0.width / 2), y: cy0 - off.y * (b0.height / 2) };
  const anchorAbs = rotationDeg ? rotatePointDeg(anchorLocal.x, anchorLocal.y, cx0, cy0, rotationDeg) : anchorLocal;
  const drag = { kind: 'resize', handle, layerId: layer.id, b0, rotationDeg, anchorAbs, handleOffset: off };
  new Function('drag', 'mm', 'project', 'XYWH_SHAPE_TYPES', 'rotatePointDeg', 'aiLayoutBoxSize', resizeBranch)(drag, mm, project, new Set(['image', 'rectangle']), rotatePointDeg, aiLayoutBoxSize);
  return { layer, anchorAbs };
}

await test('13. app.js: both canvas resize branches lock an ai-layout box with aiLayoutBoxSize(); corners keep the opposite corner, edges the opposite edge midpoint', () => {
  const unrotated = resizeBranch.slice(0, resizeBranch.indexOf('else if(XYWH_SHAPE_TYPES.has(l.type)){'));
  const rotated = resizeBranch.slice(resizeBranch.indexOf('else if(XYWH_SHAPE_TYPES.has(l.type)){'));
  assert.ok(unrotated.includes('aiLayoutBoxSize(') && rotated.includes('aiLayoutBoxSize('), 'both branches');
  const W = CAT.widthMm, H = CAT.heightMm, ratio = H / W;
  const close = (a, b, what) => assert.ok(Math.abs(a - b) <= 1e-9, `${what}: ${a} vs ${b}`);

  const se = resizeDrag(catLayer(), 'se', { x: 30 + 2 * W, y: 0 }).layer;
  close(se.w, 2 * W, 'se w'); close(se.h, 2 * W * ratio, 'se h'); close(se.x, 30, 'se x'); close(se.y, 20, 'se y');
  const nw = resizeDrag(catLayer(), 'nw', { x: 30 - W, y: 0 }).layer;
  close(nw.w, 2 * W, 'nw w'); close(nw.x + nw.w, 30 + W, 'nw keeps the se corner x'); close(nw.y + nw.h, 20 + H, 'nw keeps the se corner y');
  const e = resizeDrag(catLayer(), 'e', { x: 30 + 1.5 * W, y: 999 }).layer;
  close(e.w, 1.5 * W, 'e w'); close(e.x, 30, 'e x'); close(e.y + e.h / 2, 20 + H / 2, 'e keeps the w edge midpoint');
  const n = resizeDrag(catLayer(), 'n', { x: 999, y: 20 + H - 2 * H }).layer;
  close(n.h, 2 * H, 'n h'); close(n.w, 2 * W, 'n w follows'); close(n.y + n.h, 20 + H, 'n keeps the s edge'); close(n.x + n.w / 2, 30 + W / 2, 'n keeps the s edge midpoint');
  const tiny = resizeDrag(catLayer(), 'se', { x: 31, y: 21 }).layer;
  assert.deepEqual([tiny.w, tiny.h], [W, H], 'never below the layout size');

  const turned = resizeDrag(catLayer({ rotationDeg: 30 }), 'se', rotatePointDeg(30 + 2 * W, 20 + 2 * H, 30 + W / 2, 20 + H / 2, 30));
  close(turned.layer.w, 2 * W, 'rotated w'); close(turned.layer.h, 2 * W * ratio, 'rotated h');
  const nwCorner = rotatePointDeg(turned.layer.x, turned.layer.y, turned.layer.x + turned.layer.w / 2, turned.layer.y + turned.layer.h / 2, 30);
  close(nwCorner.x, turned.anchorAbs.x, 'rotated anchor x'); close(nwCorner.y, turned.anchorAbs.y, 'rotated anchor y');
  const turnedS = resizeDrag(catLayer({ rotationDeg: 30 }), 's', rotatePointDeg(30 + W / 2, 20 + 3 * H, 30 + W / 2, 20 + H / 2, 30)).layer;
  close(turnedS.h, 3 * H, 'rotated s h'); close(turnedS.w, 3 * W, 'rotated s w follows');

  const plain = resizeDrag({ id: 'r', type: 'rectangle', x: 0, y: 0, w: 10, h: 10, rotationDeg: 0 }, 'se', { x: 40, y: 15 }).layer;
  assert.deepEqual([plain.w, plain.h], [40, 15], 'other layers resize freely');
  const legacy = resizeDrag({ ...catLayer(), fillMode: 'staggered' }, 'se', { x: 40, y: 25 }).layer;
  assert.deepEqual([legacy.w, legacy.h], [10, 5], 'an image that is not ai-layout resizes freely');
});

await test('14. app.js: the W and H fields keep the locked box; the edited field leads, the other follows, and change snaps both back', () => {
  const write = new Function('el', 'readLengthField', 'setLengthField', 'formatLengthDisplay', 'project', 'aiLayoutBoxSize', `return ${extractFunction('function writeAiLayoutBoxFromFields(l){')};`);
  const run = (layer, fields) => {
    const values = { shapeW: String(fields.w), shapeH: String(fields.h) };
    const el = (id) => ({ get value() { return values[id]; } });
    const fmt = (mm) => Number(mm.toFixed(2));
    write(el, (id) => parseFloat(values[id]), (id, mm) => { values[id] = String(fmt(mm)); }, fmt, { units: 'mm' }, aiLayoutBoxSize)(layer);
    return { layer, values };
  };
  const W = CAT.widthMm, H = CAT.heightMm;
  const fmt = (mm) => Number(mm.toFixed(2));
  const wider = run(catLayer(), { w: 200, h: fmt(H) });
  assert.equal(wider.layer.w, 200); assert.ok(Math.abs(wider.layer.h - 200 * H / W) <= 1e-9); assert.equal(wider.values.shapeH, String(fmt(200 * H / W)));
  const taller = run(catLayer(), { w: fmt(W), h: 300 });
  assert.ok(Math.abs(taller.layer.w - 300 * W / H) <= 1e-9); assert.ok(Math.abs(taller.layer.h - 300) <= 1e-9);
  const below = run(catLayer(), { w: 10, h: fmt(H) });
  assert.deepEqual([below.layer.w, below.layer.h], [W, H]);
  const same = run(catLayer({ w: 2 * W, h: 2 * H }), { w: fmt(2 * W), h: fmt(2 * H) });
  assert.equal(same.layer.w, 2 * W, 'a field showing the rounded box is not an edit');
  const empty = run(catLayer({ w: 2 * W, h: 2 * H }), { w: '', h: fmt(2 * H) });
  assert.equal(empty.layer.w, 2 * W, 'an empty field while typing keeps the box');

  const write2 = extractFunction('function writeSelectedControlsToLayer(){');
  assert.ok(write2.includes("}else if(l.type==='image'){l.x=readLengthField('shapeX')||0;l.y=readLengthField('shapeY')||0;if(l.fillMode==='ai-layout'&&l.aiLayout)writeAiLayoutBoxFromFields(l);else{l.w=Math.max(1,readLengthField('shapeW')||10);l.h=Math.max(1,readLengthField('shapeH')||10)}"));
  assert.ok(appJs.includes("for(const id of['shapeW','shapeH'])el(id).addEventListener('change',()=>{const l=selectedLayer();if(l&&l.type==='image'&&l.fillMode==='ai-layout'&&l.aiLayout){setLengthField('shapeW',l.w);setLengthField('shapeH',l.h)}});"));
  const sync = extractFunction('function syncSelectedControlsFromLayer(){');
  assert.ok(sync.includes("if(l.type==='image'&&l.fillMode==='ai-layout'&&l.aiLayout){el('shapeW').min=String(formatLengthDisplay(l.aiLayout.widthMm,project.units));el('shapeH').min=String(formatLengthDisplay(l.aiLayout.heightMm,project.units))}else{el('shapeW').removeAttribute('min');el('shapeH').removeAttribute('min')}"));
});

await test('15. app.js: the stats rows and the aligned AI image / Overlay drawing', () => {
  const studio = extractFunction('async function renderImageStudio(){');
  assert.ok(studio.includes('const aiStats=state.aiStats?checkFixResult.aiLayoutStats:null;'), 'from the existing includeStats call');
  assert.equal((studio.match(/engine\.generateImageStonesLive\(/g) || []).length, 1, 'no new call');
  assert.ok(studio.includes("formatLengthDisplay(aiStats.minGapMm,project.units,3)"));
  assert.ok(studio.includes("for(const cls of['validation-message','visible'])el('imageStudioStatViolations').classList.toggle(cls,aiStats.violations>0);"));
  assert.ok(studio.includes("typeof coverage==='number'?`${Math.round(coverage*100)}%`:'—'"));
  assert.ok(studio.includes('`×${aiStats.k.toFixed(2)}`'));
  assert.ok(studio.includes("const aiImageBox=mode==='ai-layout'?aiLayoutImageBox(l)||undefined:undefined;"));
  assert.ok(studio.includes('paintSource(img,aiImageBox);') && studio.includes('ctx.globalAlpha=.35;paintSource(img,aiImageBox);ctx.globalAlpha=1;'));

  const drawLine = /const drawInBox=\(src,b=l\)=>\{[^\n]*\};/.exec(studio)[0];
  const draws = [];
  const ctx = { drawImage: (...a) => draws.push(['draw', ...a]), save() {}, restore() {}, translate: (x, y) => draws.push(['translate', x, y]), rotate: (r) => draws.push(['rotate', r]) };
  const t = { ox: 5, oy: 7, s: 2 };
  const drawWith = (l, b) => { draws.length = 0; new Function('ctx', 't', 'l', 'studioRotationDeg', `${drawLine}\ndrawInBox('img',${b ? 'arguments[4]' : 'undefined'});`)(ctx, t, l, l.rotationDeg ?? 0, b); return [...draws]; };
  const l = catLayer({ w: 2 * CAT.widthMm, h: 2 * CAT.heightMm });
  const box = aiLayoutImageBox(l);
  assert.deepEqual(drawWith(l, box), [['draw', 'img', t.ox + box.x * t.s, t.oy + box.y * t.s, box.w * t.s, box.h * t.s]]);
  assert.deepEqual(drawWith(l), [['draw', 'img', t.ox + l.x * t.s, t.oy + l.y * t.s, l.w * t.s, l.h * t.s]], 'the layer box by default');
  const turned = { ...l, rotationDeg: 90 };
  const [, tr, , dr] = [null, ...drawWith(turned, box)];
  assert.deepEqual(tr, ['translate', t.ox + (l.x + l.w / 2) * t.s, t.oy + (l.y + l.h / 2) * t.s], 'turns about the layer box centre');
  assert.deepEqual(dr, ['draw', 'img', (box.x - l.x - l.w / 2) * t.s, (box.y - l.y - l.h / 2) * t.s, box.w * t.s, box.h * t.s]);
});

await test('Registered in tools/test-groups.mjs', () => {
  assertTestRegistered({ filename: 'test-img-026-lightbox.mjs', group: 'ui', includedInDefault: true });
});

if (failures) process.exitCode = 1;
