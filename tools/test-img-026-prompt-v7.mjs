// IMG-026 build N -- prompt v7 and the model input: the shape the product picks before the provider
// call, the OpenAI request each shape makes, the Flat Sheet crop (src/redraw/ModelInput.js), and fake
// mode for every product. See docs/specifications/IMG-026-StrassLayoutService.md, "Prompt v7 and model
// input (build N)" and Appendix E.
//
// Never touches the network (every fetch is injected), never needs OPENAI_API_KEY and never writes
// to the source tree.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { STONE_COLORS } from '../src/renderer/StoneColors.js';
import { PROMPT_VERSION, PROMPT_VERSIONS, REDRAW_SHAPES as SERVER_REDRAW_SHAPES, buildRedrawPrompt, buildPaletteLine } from '../server/redraw/prompt.mjs';
import { loadRedrawEnv } from '../server/redraw/env.mjs';
import { createRedrawHandler, OPENAI_IMAGE_EDITS_URL, FAKE_LAYOUT } from '../server/redraw/handler.mjs';
import { FAKE_REDRAW_DATA_URL } from '../src/redraw/FakeRedrawProvider.js';
import { redrawImage, configureRedraw, setRedrawAccessCode, RedrawError, REDRAW_SHAPES, REDRAW_STAGE_MESSAGES, applyRedraw, fitAiLayoutCanvas } from '../src/redraw/index.js';
import { subjectBox, cropToSubject, resizeToLongestSide, flatSheetModelInput, MODEL_INPUT_SIDE_PX, SUBJECT_ALPHA, SUBJECT_MARGIN } from '../src/redraw/ModelInput.js';
import { resizeImageBuffer } from '../src/image/ImageFieldPipeline.js';
import { OBJECT_TEMPLATE_IDS, SHEET_MAX_MM } from '../src/products/index.js';
import { assertTestRegistered } from './lib/test-registration-assertions.mjs';

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

const repo = (p) => fileURLToPath(new URL(`../${p}`, import.meta.url));
const appJs = await readFile(repo('app.js'), 'utf8');
const spec = await readFile(repo('docs/specifications/IMG-026-StrassLayoutService.md'), 'utf8');

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

// ---- Helpers -----------------------------------------------------------------------------------

const PNG_PREFIX = 'data:image/png;base64,';
const FAKE_B64 = FAKE_REDRAW_DATA_URL.slice(PNG_PREFIX.length);
const LAYOUT_BASE = 'http://layout.test:8000';

const SIXTY = 'Make the stones large: about 60 stones across the full width of the image.';
const SQUARE_LINE = '- Square image at the highest resolution available.';
const WHOLE_LINE = '- Use the whole image at the highest resolution available, in the same shape (width to height) as the uploaded image.';
const SKIN_RAMP = '  skin (every skin tone, from the lightest to the deepest; deep skin uses the dark end of this ramp): Silk, Light Peach, Rose Gold, Light Colorado Topaz, Golden Shadow, Copper, Colorado Topaz, Smoked Topaz, with Rose Peach and Vintage Rose for cheeks and Crystal only for the brightest highlights;';
const SKIN_RULE = "- Keep each person's skin tone, lightness and undertone as the photo shows them. Never lighten or whiten skin: each face stays as light or as dark as it is in the photo.";

function makeBuffer(widthPx, heightPx, pixel) {
  const data = new Uint8ClampedArray(widthPx * heightPx * 4);
  for (let y = 0; y < heightPx; y++) for (let x = 0; x < widthPx; x++) data.set(pixel(x, y), (y * widthPx + x) * 4);
  return { widthPx, heightPx, data };
}
const at = (b, x, y) => [...b.data.subarray((y * b.widthPx + x) * 4, (y * b.widthPx + x) * 4 + 4)];
const SUBJECT_RGBA = [180, 120, 90, 255];
// A small subject (30 x 20 px, box x 300..329, y 40..59) in a wide transparent image (400 x 100).
const WIDE = makeBuffer(400, 100, (x, y) => (x >= 300 && x < 330 && y >= 40 && y < 60 ? SUBJECT_RGBA : [0, 0, 0, 0]));
// An opaque photo, 3000 x 2000.
const OPAQUE = makeBuffer(3000, 2000, () => [10, 20, 30, 255]);
// The usable output: a 64 px Jet disc on transparent (the FakeRedrawProvider image).
const DISC = makeBuffer(64, 64, (x, y) => (Math.hypot(x + 0.5 - 32, y + 0.5 - 32) <= 24 ? [20, 20, 20, 255] : [0, 0, 0, 0]));
const SOURCES = new Map([[`${PNG_PREFIX}WIDE`, WIDE], [`${PNG_PREFIX}OPAQUE`, OPAQUE], [FAKE_REDRAW_DATA_URL, DISC]]);
const decodeImage = (u) => {
  if (!SOURCES.has(u)) throw new Error(`no fixture for ${u.slice(0, 40)}`);
  return SOURCES.get(u);
};

const okImage = () => new Response(JSON.stringify({ data: [{ b64_json: FAKE_B64 }] }), { status: 200 });
const okLayout = () => new Response(JSON.stringify(FAKE_LAYOUT), { status: 200 });

// OpenAI calls and layout calls, recorded.
function upstream() {
  const calls = { openAi: [], layout: [] };
  const fetch = async (url, init) => {
    if (url === OPENAI_IMAGE_EDITS_URL) { calls.openAi.push(init); return okImage(); }
    calls.layout.push(init);
    return okLayout();
  };
  return { fetch, calls };
}

function makeReq({ method = 'POST', body = '' } = {}) {
  const req = Readable.from(body ? [Buffer.from(body)] : []);
  req.method = method;
  req.headers = { 'x-redraw-access-code': 'letmein' };
  req.socket = { remoteAddress: '10.0.0.1' };
  return req;
}

function makeRes() {
  return {
    statusCode: 0, body: '', headersSent: false, writableEnded: false,
    writeHead(s) { this.statusCode = s; this.headersSent = true; },
    end(chunk = '') { this.body += chunk; this.writableEnded = true; },
    on() {},
    json() { return JSON.parse(this.body); }
  };
}

const KEY_ENV = { OPENAI_API_KEY: 'sk-test', REDRAW_ACCESS_CODE: 'letmein', LAYOUT_SERVICE_URL: LAYOUT_BASE };
const FAKE_ENV = { REDRAW_FAKE: '1', REDRAW_ACCESS_CODE: 'letmein' };
const handlerFor = (env, fetch) => createRedrawHandler({ settings: loadRedrawEnv({ env }), fetch, logger: { warn() {} } });

async function postBody(handler, body) {
  const res = makeRes();
  await handler.handleRedraw(makeReq({ body }), res);
  return res;
}

async function finish(handler, body) {
  const res = await postBody(handler, body);
  assert.equal(res.statusCode, 202, res.body);
  const { jobId } = res.json();
  for (let i = 0; i < 200; i++) {
    const poll = makeRes();
    await handler.handleJob(makeReq({ method: 'GET' }), poll, jobId);
    const view = poll.json();
    if (view.stage === 'done' || view.stage === 'failed') return view;
    await new Promise((r) => setImmediate(r));
  }
  throw new Error('the job did not finish');
}

// The browser's fetch, answered in-process by the real handler: the client, the proxy provider and
// the server all run their own code.
function bridge(handler) {
  return async (url, init = {}) => {
    if (url === '/api/redraw/config') return new Response(JSON.stringify({ providerId: 'openai-proxy', costLabel: '' }), { status: 200 });
    const res = makeRes();
    if (url === '/api/redraw' && init.method === 'POST') await handler.handleRedraw(makeReq({ body: init.body }), res);
    else await handler.handleJob(makeReq({ method: init.method }), res, decodeURIComponent(url.slice('/api/redraw/'.length)));
    return new Response(res.statusCode === 204 ? null : res.body, { status: res.statusCode });
  };
}

// ---- 1. Prompt -----------------------------------------------------------------------------------

await test('1. prompt v7: both shapes equal Appendix E, carry the skin lines, and differ only in the 60-across sentence and section 6\'s first line', () => {
  assert.equal(PROMPT_VERSION, 7);
  assert.deepEqual(PROMPT_VERSIONS, { stones: 7, flat: 1 });
  assert.deepEqual(SERVER_REDRAW_SHAPES, ['square', 'auto']);
  assert.deepEqual(REDRAW_SHAPES, SERVER_REDRAW_SHAPES, 'client and server agree');

  const appendix = spec.slice(spec.indexOf('## Appendix E'));
  const blocks = [];
  for (let from = 0; ;) {
    const open = appendix.indexOf('```\n', from);
    if (open === -1) break;
    const close = appendix.indexOf('\n```', open + 4);
    blocks.push(appendix.slice(open + 4, close));
    from = close + 4;
  }
  assert.equal(blocks.length, 2, 'Appendix E has the square block and the whole-image block');
  const palette = buildPaletteLine(STONE_COLORS, true);
  assert.equal(buildRedrawPrompt(undefined, 'stones', 'square'), blocks[0].replace('<palette line>', palette));
  assert.equal(buildRedrawPrompt(undefined, 'stones', 'auto'), blocks[1].replace('<palette line>', palette));
  assert.equal(buildRedrawPrompt(), buildRedrawPrompt(undefined, 'stones', 'square'), 'square is the default');

  for (const shape of REDRAW_SHAPES) {
    const lines = buildRedrawPrompt(undefined, 'stones', shape).split('\n');
    assert.ok(lines.includes(SKIN_RAMP), `${shape}: the skin ramp covers every skin tone`);
    assert.equal(lines.indexOf(SKIN_RULE), lines.indexOf('- Never use Topaz or Hyacinth on skin.') + 1, `${shape}: the skin-tone rule follows the Topaz rule`);
    assert.ok(!lines.some((l) => l.startsWith('  skin: ')), `${shape}: no v6 skin ramp`);
  }
  const square = buildRedrawPrompt(undefined, 'stones', 'square');
  const auto = buildRedrawPrompt(undefined, 'stones', 'auto');
  assert.ok(square.includes(SIXTY) && square.split('\n').includes(SQUARE_LINE) && !square.includes(WHOLE_LINE));
  assert.ok(!auto.includes(SIXTY) && auto.split('\n').includes(WHOLE_LINE) && !auto.includes('Square image'));
  assert.equal(auto.replace(WHOLE_LINE, SQUARE_LINE).replace('- Use one main stone size for the whole design.\n', `- Use one main stone size for the whole design. ${SIXTY}\n`), square);
  assert.equal(buildRedrawPrompt(undefined, 'flat', 'auto'), buildRedrawPrompt(undefined, 'flat'), 'the flat prompt has no shape');
});

// ---- 2. Server request ---------------------------------------------------------------------------

await test('2. server: shape auto sends size auto and the whole-image prompt; square or no shape sends 1024x1024 and the square prompt; both answer version 7', async () => {
  const cases = [
    [{ shape: 'auto' }, 'auto', 'auto'],
    [{ shape: 'square' }, '1024x1024', 'square'],
    [{}, '1024x1024', 'square']
  ];
  for (const [extra, size, shape] of cases) {
    const { fetch, calls } = upstream();
    const view = await finish(handlerFor(KEY_ENV, fetch), JSON.stringify({ image: FAKE_REDRAW_DATA_URL, style: 'stones', ...extra }));
    assert.equal(view.stage, 'done', JSON.stringify(extra));
    assert.equal(view.result.promptVersion, 7);
    assert.equal(calls.openAi.length, 1);
    const form = calls.openAi[0].body;
    assert.equal(form.get('size'), size, JSON.stringify(extra));
    assert.equal(form.get('prompt'), buildRedrawPrompt(undefined, 'stones', shape));
    assert.equal(form.get('background'), 'transparent');
    assert.ok(Buffer.from(await form.get('image').arrayBuffer()).equals(Buffer.from(FAKE_B64, 'base64')), 'the image is passed through unchanged');
  }
});

await test('3. server: any other shape is a 400 with no upstream call; fake mode checks the shape too and answers version 7 for both', async () => {
  for (const shape of [null, 'Auto', '', 'portrait', '1024x1024', 1, {}]) {
    const { fetch, calls } = upstream();
    const res = await postBody(handlerFor(KEY_ENV, fetch), JSON.stringify({ image: FAKE_REDRAW_DATA_URL, shape }));
    assert.equal(res.statusCode, 400, JSON.stringify(shape));
    assert.deepEqual(res.json(), { code: 'provider-failed', message: 'Unknown redraw shape.' });
    assert.equal(calls.openAi.length + calls.layout.length, 0);
  }
  for (const shape of REDRAW_SHAPES) {
    const { fetch, calls } = upstream();
    const view = await finish(handlerFor(FAKE_ENV, fetch), JSON.stringify({ image: FAKE_REDRAW_DATA_URL, shape }));
    assert.deepEqual(view.result, { dataUrl: FAKE_REDRAW_DATA_URL, model: 'fake', promptVersion: 7, layout: FAKE_LAYOUT });
    assert.equal(calls.openAi.length + calls.layout.length, 0, 'no provider call in fake mode');
  }
  const res = await postBody(handlerFor(FAKE_ENV, upstream().fetch), JSON.stringify({ image: FAKE_REDRAW_DATA_URL, shape: 'round' }));
  assert.equal(res.statusCode, 400);
});

// ---- 4-6. Model input ----------------------------------------------------------------------------

await test('4. crop: a small subject in a wide transparent image is cropped to its alpha box plus 3 % of the longest side, then enlarged to 1024 px with no padding', () => {
  assert.deepEqual([MODEL_INPUT_SIDE_PX, SUBJECT_ALPHA, SUBJECT_MARGIN], [1024, 128, 0.03]);
  assert.deepEqual(subjectBox(WIDE), { left: 300, top: 40, width: 30, height: 20 });
  const crop = cropToSubject(WIDE);
  // margin round(0.03 * 30) = 1 px on every side
  assert.deepEqual([crop.widthPx, crop.heightPx], [32, 22]);
  for (let y = 0; y < 22; y++) {
    for (let x = 0; x < 32; x++) {
      const inside = x >= 1 && x < 31 && y >= 1 && y < 21;
      assert.deepEqual(at(crop, x, y), inside ? SUBJECT_RGBA : [0, 0, 0, 0], `crop pixel ${x},${y}`);
    }
  }
  const input = flatSheetModelInput(WIDE);
  assert.deepEqual([input.widthPx, input.heightPx], [1024, 704], 'long side 1024, aspect 32:22 kept, no square padding');
  // Enlarged with premultiplied alpha: wherever a pixel is not fully transparent it has the subject's
  // colour, so the edge gets no dark fringe; the middle is the subject, the corners transparent.
  for (let i = 0; i < input.data.length; i += 4) {
    if (input.data[i + 3] > 0) assert.deepEqual([...input.data.subarray(i, i + 3)], SUBJECT_RGBA.slice(0, 3));
  }
  assert.deepEqual(at(input, 512, 352), SUBJECT_RGBA);
  assert.equal(at(input, 0, 0)[3], 0);
  assert.equal(at(input, 1023, 703)[3], 0);

  // A larger subject: margin round(0.03 * 100) = 3.
  const big = makeBuffer(1000, 400, (x, y) => (x >= 450 && x < 550 && y >= 100 && y < 150 ? SUBJECT_RGBA : [0, 0, 0, 0]));
  assert.deepEqual([cropToSubject(big).widthPx, cropToSubject(big).heightPx], [106, 56]);
  // Alpha 127 is background, 128 is subject.
  const soft = makeBuffer(100, 50, (x, y) => (x === 10 && y === 10 ? [0, 0, 0, 128] : x === 90 && y === 40 ? [0, 0, 0, 127] : [0, 0, 0, 0]));
  assert.deepEqual(subjectBox(soft), { left: 10, top: 10, width: 1, height: 1 });
});

await test('5. crop edges: the margin past the image edge is transparent; a subject that fills the image keeps its size plus the margin', () => {
  // Subject on the top-left edge: box 0..49 x 0..9, margin round(1.5) = 2.
  const corner = makeBuffer(400, 100, (x, y) => (x < 50 && y < 10 ? SUBJECT_RGBA : [0, 0, 0, 0]));
  let crop = cropToSubject(corner);
  assert.deepEqual([crop.widthPx, crop.heightPx], [54, 14]);
  assert.deepEqual(at(crop, 0, 0), [0, 0, 0, 0]);
  assert.deepEqual(at(crop, 1, 5), [0, 0, 0, 0], 'left margin outside the image');
  assert.deepEqual(at(crop, 5, 1), [0, 0, 0, 0], 'top margin outside the image');
  assert.deepEqual(at(crop, 2, 2), SUBJECT_RGBA, 'the subject starts after the margin');
  assert.deepEqual(at(crop, 51, 11), SUBJECT_RGBA);
  assert.deepEqual(at(crop, 52, 11), [0, 0, 0, 0], 'right margin inside the image, transparent there');

  // Subject on the bottom-right edge.
  const far = makeBuffer(400, 100, (x, y) => (x >= 350 && y >= 90 ? SUBJECT_RGBA : [0, 0, 0, 0]));
  crop = cropToSubject(far);
  assert.deepEqual([crop.widthPx, crop.heightPx], [54, 14]);
  assert.deepEqual(at(crop, 51, 11), SUBJECT_RGBA);
  assert.deepEqual(at(crop, 53, 13), [0, 0, 0, 0], 'margin past the bottom-right edge');

  // A transparent image whose subject touches all four edges: the crop is the whole image plus a
  // transparent frame of round(0.03 * 200) = 6.
  const full = makeBuffer(200, 100, (x, y) => (x === 199 && y === 0 ? [0, 0, 0, 0] : SUBJECT_RGBA));
  crop = cropToSubject(full);
  assert.deepEqual([crop.widthPx, crop.heightPx], [212, 112]);
  assert.deepEqual(at(crop, 6, 6), SUBJECT_RGBA);
  assert.deepEqual(at(crop, 5, 6), [0, 0, 0, 0]);
});

await test('6. without transparency the whole image is resized to 1024 px on the long side (shrunk as today, or enlarged); a fully transparent image is not cropped', () => {
  const shrunk = flatSheetModelInput(OPAQUE);
  assert.deepEqual([shrunk.widthPx, shrunk.heightPx], [1024, 683]);
  assert.deepEqual(shrunk, resizeImageBuffer(OPAQUE, 1024, 1024), 'the same shrink as the 1536 px upload uses');
  const small = makeBuffer(200, 100, (x) => [x, 50, 50, 255]);
  const grown = flatSheetModelInput(small);
  assert.deepEqual([grown.widthPx, grown.heightPx], [1024, 512]);
  assert.ok(grown.data.every((v, i) => i % 4 !== 3 || v === 255), 'opaque stays opaque');
  const tall = resizeToLongestSide(makeBuffer(100, 300, () => [1, 2, 3, 255]));
  assert.deepEqual([tall.widthPx, tall.heightPx], [341, 1024]);
  const exact = makeBuffer(1024, 10, () => [1, 2, 3, 255]);
  assert.deepEqual(flatSheetModelInput(exact), exact);
  // Alpha between 128 and 254 everywhere is not a transparent background.
  const veiled = makeBuffer(300, 100, () => [9, 9, 9, 200]);
  assert.deepEqual([flatSheetModelInput(veiled).widthPx, flatSheetModelInput(veiled).heightPx], [1024, 341]);
  const empty = makeBuffer(300, 100, () => [0, 0, 0, 0]);
  assert.equal(subjectBox(empty), null);
  assert.deepEqual([flatSheetModelInput(empty).widthPx, flatSheetModelInput(empty).heightPx], [1024, 341]);
});

await test('7. redrawImage(): shape auto uploads the Flat Sheet input and posts shape auto; square uploads today\'s 1536 px fit; an unknown shape is refused before any call', async () => {
  for (const [shape, source, expected] of [
    ['auto', 'WIDE', flatSheetModelInput(WIDE)],
    ['auto', 'OPAQUE', flatSheetModelInput(OPAQUE)],
    ['square', 'WIDE', resizeImageBuffer(WIDE, 1536, 1536)],
    ['square', 'OPAQUE', resizeImageBuffer(OPAQUE, 1536, 1536)]
  ]) {
    const encoded = [];
    const posts = [];
    const handler = handlerFor(FAKE_ENV, upstream().fetch);
    const viaBridge = bridge(handler);
    const fetch = async (url, init) => { if (init && init.method === 'POST') posts.push(JSON.parse(init.body)); return viaBridge(url, init); };
    configureRedraw({ fetch, decodeImage, encodePng: (b) => { encoded.push(b); return FAKE_REDRAW_DATA_URL; }, wait: async () => {} });
    setRedrawAccessCode('letmein');
    const result = await redrawImage({ dataUrl: `${PNG_PREFIX}${source}`, shape });
    assert.equal(result.promptVersion, 7);
    assert.equal(encoded.length, 1);
    assert.deepEqual(encoded[0], expected, `${shape} ${source}`);
    assert.deepEqual(posts, [{ image: FAKE_REDRAW_DATA_URL, style: 'stones', shape }]);
  }
  assert.deepEqual([resizeImageBuffer(OPAQUE, 1536, 1536).widthPx, resizeImageBuffer(OPAQUE, 1536, 1536).heightPx], [1536, 1024]);
  let calls = 0;
  configureRedraw({ provider: { id: 'p', consent: null, redraw: async () => { calls++; } }, decodeImage });
  await assert.rejects(redrawImage({ dataUrl: `${PNG_PREFIX}WIDE`, shape: 'portrait' }), (e) => e instanceof RedrawError && e.code === 'provider-failed' && e.detail === 'Unknown redraw shape.');
  assert.equal(calls, 0);
  configureRedraw();
});

// ---- 8-9. Every product, from app.js to the request ----------------------------------------------

const IMAGE_LAYER = { id: 'image1', type: 'image', visible: true, imageSrc: `${PNG_PREFIX}WIDE`, imageName: 'wide.png', naturalWidthPx: 400, naturalHeightPx: 100, x: 10, y: 10, w: 80, h: 20, maskMode: 'subject', threshold: 128, stoneSize: 2, gap: 0.3, colorCount: 'auto', vividness: 1.4, rotationDeg: 0, fillMode: 'staggered', invert: false, transparent: 'ignore', blurRadiusPx: 0, maxWidthPx: 400, maxHeightPx: 400 };

// app.js's startImageRedraw() with the real redrawImage() (client, proxy provider, server handler)
// and stubs for the rest of the app.
async function runApp(product, handler) {
  const encoded = [];
  const posts = [];
  const viaBridge = bridge(handler);
  configureRedraw({
    fetch: async (url, init) => { if (init && init.method === 'POST') posts.push(JSON.parse(init.body)); return viaBridge(url, init); },
    decodeImage, encodePng: (b) => { encoded.push(b); return FAKE_REDRAW_DATA_URL; }, wait: async () => {}
  });
  setRedrawAccessCode('letmein');
  const state = { statuses: [], project: { canvas: { width: 300, height: 300 }, layers: [JSON.parse(JSON.stringify(IMAGE_LAYER))] } };
  const deps = {
    redrawAvailability: { available: true, consent: null },
    selectedLayer: () => state.project.layers[0],
    askRedrawConsent: async () => true,
    setImageRedrawStatus: (text) => state.statuses.push(text),
    el: () => ({}),
    syncImageRedrawControls: () => {},
    redrawImage,
    REDRAW_STAGE_MESSAGES,
    decodeDataUrlToBuffer: async (u) => decodeImage(u),
    project: state.project,
    aiStoneDetectionFor: () => ({ ok: false }),
    resolveAiStoneShrink: () => 1,
    currentObjectTemplate: () => ({ id: product }),
    fitAiLayoutCanvas,
    SHEET_MAX_MM,
    fitAiStoneBox: () => ({ canvas: null }),
    commitHistory: () => {},
    applyRedraw: (current, r, options) => applyRedraw(current, r, { ...options, now: () => Date.UTC(2026, 10, 1) }),
    imageBufferCache: new Map(),
    syncSelectedControlsFromLayer: () => {},
    updateAll: async () => {},
    RedrawError,
    saveRedrawAccessCode: () => {},
    setRedrawAccessCode: () => {},
    redrawErrorMessage: (e) => `error: ${e.message}`,
    redrawErrorDetail: () => '',
    syncImageRedrawControlsForSelection: () => {},
    setImageStudioView: () => {},
    renderImageStudio: () => {},
    redrawFailedLayerIds: new Set()
  };
  const names = Object.keys(deps);
  const run = new Function(...names, `let redrawRun=null,redrawConsentResolve=null,redrawConsentGiven=true,runningLayerId=null;\n${extractFunction('async function startImageRedraw(){')}\nreturn startImageRedraw;`)(...names.map((n) => deps[n]));
  await run();
  configureRedraw();
  return { state, encoded, posts, layer: state.project.layers[0] };
}

await test('8. every product: the Flat Sheet request uses size auto, the whole-image prompt and the cropped input; vessels and the plate use 1024x1024, the square prompt and today\'s input; the layer records version 7', async () => {
  assert.deepEqual([...OBJECT_TEMPLATE_IDS].sort(), ['bottle', 'mug', 'plate', 'sheet', 'tumbler']);
  for (const product of OBJECT_TEMPLATE_IDS) {
    const { fetch, calls } = upstream();
    const { state, encoded, posts, layer } = await runApp(product, handlerFor(KEY_ENV, fetch));
    const shape = product === 'sheet' ? 'auto' : 'square';
    assert.deepEqual(posts.map((p) => p.shape), [shape], product);
    assert.equal(calls.openAi.length, 1, `${product}: one provider call`);
    const form = calls.openAi[0].body;
    const prompt = form.get('prompt');
    assert.equal(form.get('size'), shape === 'auto' ? 'auto' : '1024x1024', product);
    assert.equal(prompt, buildRedrawPrompt(undefined, 'stones', shape), product);
    assert.ok(prompt.includes(SKIN_RULE) && prompt.includes(SKIN_RAMP), `${product}: skin lines`);
    assert.equal(prompt.includes(WHOLE_LINE), shape === 'auto', `${product}: whole-image line`);
    assert.equal(prompt.includes(SIXTY), shape === 'square', `${product}: 60-across sentence`);
    assert.equal(prompt.split('\n').includes(SQUARE_LINE), shape === 'square', `${product}: square line`);
    assert.deepEqual(encoded[0], shape === 'auto' ? flatSheetModelInput(WIDE) : resizeImageBuffer(WIDE, 1536, 1536), `${product}: model input`);
    assert.deepEqual([encoded[0].widthPx, encoded[0].heightPx], shape === 'auto' ? [1024, 704] : [400, 100]);
    assert.equal(layer.redraw.promptVersion, 7, `${product}: the layer records version 7`);
    assert.equal(layer.fillMode, 'ai-layout', `${product}: the layout was applied`);
    assert.equal(state.statuses.at(-1), `Placed ${FAKE_LAYOUT.stones.length} stones. Gap check: ${FAKE_LAYOUT.report.violations} violations.`);
  }
});

await test('9. fake mode (no provider call) runs end to end for every product', async () => {
  for (const product of OBJECT_TEMPLATE_IDS) {
    const { fetch, calls } = upstream();
    const { state, posts, layer } = await runApp(product, handlerFor(FAKE_ENV, fetch));
    assert.equal(calls.openAi.length + calls.layout.length, 0, `${product}: no upstream call`);
    assert.deepEqual(posts.map((p) => p.shape), [product === 'sheet' ? 'auto' : 'square']);
    assert.equal(layer.fillMode, 'ai-layout', product);
    assert.equal(layer.redraw.promptVersion, 7);
    assert.equal(layer.redraw.model, 'fake');
    assert.equal(layer.aiLayout.stones.length, FAKE_LAYOUT.stones.length);
    assert.equal(state.statuses.at(-1), `Placed ${FAKE_LAYOUT.stones.length} stones. Gap check: ${FAKE_LAYOUT.report.violations} violations.`);
  }
});

await test('10. app.js reads the product before the provider call and passes the shape', () => {
  const start = extractFunction('async function startImageRedraw(){');
  const shapeLine = "const shape=currentObjectTemplate().id==='sheet'?'auto':'square';";
  assert.ok(start.includes(shapeLine));
  assert.ok(start.indexOf(shapeLine) < start.indexOf('redrawImage('));
  assert.ok(start.includes('setImageRedrawStatus(REDRAW_STAGE_MESSAGES[stage])},shape});'));
});

await test('11. registered in the integration group and the default suite', () => {
  assertTestRegistered({ filename: 'test-img-026-prompt-v7.mjs', group: 'integration', includedInDefault: true });
});
