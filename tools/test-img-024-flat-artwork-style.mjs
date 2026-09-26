// IMG-024 -- Flat artwork redraw style: the server's style check and per-style prompt, the client
// wire body and redraw record, applyRedraw()/restoreOriginal() for 'flat', the 'error' palette rule
// (ColorQuantize.js, AutoColourCount.js, the engine), the WeightedLabPalette.js move, byte identity
// without paletteRule, and the app.js / index.html wiring. See
// docs/specifications/IMG-024-FlatArtworkStyle.md, "Tests the build must add" (T1-T12).
//
// Never touches the network (every fetch is injected), never needs OPENAI_API_KEY and reads nothing
// from tools/scratch/.
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { STONE_COLORS } from '../src/renderer/StoneColors.js';
import { PROMPT_VERSION, FLAT_PROMPT_VERSION, PROMPT_VERSIONS, REDRAW_STYLES as SERVER_REDRAW_STYLES, buildRedrawPrompt, buildPaletteLine } from '../server/redraw/prompt.mjs';
import { loadRedrawEnv } from '../server/redraw/env.mjs';
import { createRedrawHandler } from '../server/redraw/handler.mjs';
import { FAKE_REDRAW_DATA_URL } from '../src/redraw/FakeRedrawProvider.js';
import { redrawImage, setRedrawAccessCode, configureRedraw, RedrawError, applyRedraw, restoreOriginal, REDRAW_STYLES } from '../src/redraw/index.js';
import { quantizeColors, labelErrorPaletteColors, ERROR_PALETTE_MAX_SAMPLES } from '../src/image/ColorQuantize.js';
import { chooseAutoColorCount } from '../src/image/AutoColourCount.js';
import { rgbToLab, cie76Distance } from '../src/image/ColorSpace.js';
import { prepareImageField } from '../src/image/ImageFieldPipeline.js';
import * as WeightedLabPalette from '../src/image/WeightedLabPalette.js';
import * as AiStoneSampler from '../src/geometry/AiStoneSampler.js';
import { GeometryEngine } from '../src/geometry/index.js';
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

const repoUrl = new URL('..', import.meta.url);
const appJs = await readFile(fileURLToPath(new URL('app.js', repoUrl)), 'utf8');
const indexHtml = await readFile(fileURLToPath(new URL('index.html', repoUrl)), 'utf8');
const PALETTE = Object.values(STONE_COLORS).map((c) => ({ id: c.id, hex: c.previewColor }));
const { chooseAiStonePalette, weightedLabDistance } = WeightedLabPalette;
const engine = new GeometryEngine();

const FLAT_LINE_1 = 'Create a production-oriented flat-color artwork specifically designed to be converted into a rhinestone placement pattern. Do NOT draw rhinestones. Do NOT simulate stones. Use only the palette below. Use large, clean, contiguous color regions with strong boundaries and simplified detail. Avoid gradients, photographic texture, shadows, highlights, hair-level texture, tiny isolated regions and fine lines thinner than approximately one rhinestone diameter (1/70 of the image width). Transparent background. No frame. Preserve the recognizable silhouette and major facial features. The resulting artwork will be converted separately into precisely measured rhinestone geometry.';

// ---- Server helpers (as test-img-022) ------------------------------------------------------------

const PNG_PREFIX = 'data:image/png;base64,';
const FAKE_B64 = FAKE_REDRAW_DATA_URL.slice(PNG_PREFIX.length);

function makeReq({ headers = {}, ip = '10.0.0.1', body = '' } = {}) {
  const req = Readable.from(body ? [Buffer.from(body)] : []);
  req.method = 'POST';
  req.headers = headers;
  req.socket = { remoteAddress: ip };
  return req;
}

function makeRes() {
  return {
    statusCode: 0, headers: null, body: '', headersSent: false, writableEnded: false,
    writeHead(status, headers) { this.statusCode = status; this.headers = headers; this.headersSent = true; },
    end(chunk = '') { this.body += chunk; this.writableEnded = true; },
    on() {},
    json() { return JSON.parse(this.body); }
  };
}

const KEY_SETTINGS = loadRedrawEnv({ env: { OPENAI_API_KEY: 'sk-test', REDRAW_ACCESS_CODE: 'letmein' } });
const FAKE_SETTINGS = loadRedrawEnv({ env: { REDRAW_FAKE: '1', REDRAW_ACCESS_CODE: 'letmein' } });

function spyFetch(responder) {
  const calls = [];
  const fetch = async (url, init) => { calls.push({ url, init }); return responder(calls.length, url, init); };
  return { fetch, calls };
}
const okImage = () => new Response(JSON.stringify({ data: [{ b64_json: FAKE_B64 }] }), { status: 200 });
const status = (code, body = {}) => new Response(JSON.stringify(body), { status: code });

// Posts a raw JSON body with the right access code.
async function post(handler, body) {
  const res = makeRes();
  await handler.handleRedraw(makeReq({ headers: { 'x-redraw-access-code': 'letmein' }, body }), res);
  return res;
}
const bodyWith = (extra) => JSON.stringify({ image: FAKE_REDRAW_DATA_URL, ...extra });

// ---- T1. Server style validation and default ----------------------------------------------------

await test('T1. server: no style / stones -> 200 promptVersion 2 with the stones prompt; flat -> 200 promptVersion 1 with the flat prompt; any other value -> 400 with no upstream fetch; fake mode per style', async () => {
  for (const body of [JSON.stringify({ image: FAKE_REDRAW_DATA_URL }), bodyWith({ style: 'stones' })]) {
    const spy = spyFetch(okImage);
    const res = await post(createRedrawHandler({ settings: KEY_SETTINGS, fetch: spy.fetch }), body);
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.json(), { dataUrl: FAKE_REDRAW_DATA_URL, model: 'gpt-image-2', promptVersion: 2 });
    assert.equal(spy.calls[0].init.body.get('prompt'), buildRedrawPrompt());
  }
  const spy = spyFetch(okImage);
  const res = await post(createRedrawHandler({ settings: KEY_SETTINGS, fetch: spy.fetch }), bodyWith({ style: 'flat' }));
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.json(), { dataUrl: FAKE_REDRAW_DATA_URL, model: 'gpt-image-2', promptVersion: 1 }, 'style is not echoed');
  assert.equal(spy.calls[0].init.body.get('prompt'), buildRedrawPrompt(undefined, 'flat'));

  for (const style of [null, 'Flat', '', 1, {}]) {
    const bad = spyFetch(okImage);
    const r = await post(createRedrawHandler({ settings: KEY_SETTINGS, fetch: bad.fetch }), bodyWith({ style }));
    assert.equal(r.statusCode, 400, JSON.stringify(style));
    assert.deepEqual(r.json(), { code: 'provider-failed', message: 'Unknown redraw style.' });
    assert.equal(bad.calls.length, 0, `${JSON.stringify(style)}: no upstream fetch`);
  }

  const fake = createRedrawHandler({ settings: FAKE_SETTINGS });
  assert.equal((await post(fake, bodyWith({ style: 'flat' }))).json().promptVersion, 1);
  assert.equal((await post(fake, bodyWith({ style: 'stones' }))).json().promptVersion, 2);
  assert.equal((await post(fake, JSON.stringify({ image: FAKE_REDRAW_DATA_URL }))).json().promptVersion, 2);
});

// ---- T2. Flat prompt text and version -----------------------------------------------------------

await test('T2. prompt: versions; the flat prompt is exactly line 1, the palette header and buildPaletteLine(); the stones prompt is unchanged; REDRAW_STYLES agree', () => {
  assert.equal(FLAT_PROMPT_VERSION, 1);
  assert.equal(PROMPT_VERSION, 2);
  assert.deepEqual(PROMPT_VERSIONS, { stones: 2, flat: 1 });
  assert.deepEqual(buildRedrawPrompt(undefined, 'flat').split('\n'), [FLAT_LINE_1, 'Palette (name and hex):', buildPaletteLine()]);
  assert.equal(buildRedrawPrompt(), buildRedrawPrompt(undefined, 'stones'));
  assert.equal(buildRedrawPrompt(STONE_COLORS), buildRedrawPrompt());
  assert.ok(!FLAT_LINE_1.includes('\n'));
  assert.deepEqual(SERVER_REDRAW_STYLES, REDRAW_STYLES);
  assert.deepEqual(REDRAW_STYLES, ['stones', 'flat']);
});

// ---- T3. Client wire and record -----------------------------------------------------------------

const NOW = () => Date.UTC(2026, 8, 25, 12, 0, 0);
const CANVAS = { width: 300, height: 250 };
const RESULT = { dataUrl: `${PNG_PREFIX}NEW`, providerId: 'openai-proxy', model: 'gpt-image-2', promptVersion: 1 };
const SIZE = { naturalWidthPx: 1024, naturalHeightPx: 1024 };
function baseLayer(overrides = {}) {
  return { id: 'image1', type: 'image', visible: true, imageSrc: `${PNG_PREFIX}ORIG`, imageName: 'photo.jpg', naturalWidthPx: 4000, naturalHeightPx: 3000, x: 20, y: 30, w: 200, h: 150, maskMode: 'subject', threshold: 128, stoneSize: 2, gap: 0.3, colorCount: 'auto', vividness: 1.4, rotationDeg: 15, fillMode: 'staggered', invert: false, transparent: 'ignore', blurRadiusPx: 0, maxWidthPx: 400, maxHeightPx: 400, ...overrides };
}

await test('T3. client: the proxy posts style (stones by default); an unknown style rejects before any request; applyRedraw() records style', async () => {
  const posts = [];
  let requests = 0;
  const fetch = async (url, init) => {
    requests++;
    if (url === '/api/redraw/config') return status(200, { providerId: 'openai-proxy', costLabel: '' });
    posts.push(JSON.parse(init.body));
    return status(200, { dataUrl: FAKE_REDRAW_DATA_URL, model: 'gpt-image-2', promptVersion: 1 });
  };
  // The source is any small image; the output must pass the usability check, so it is a disc on
  // transparent (test-img-022's FAKE_FORMULA shape).
  const disc = { widthPx: 64, heightPx: 64, data: new Uint8ClampedArray(64 * 64 * 4) };
  for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) if (Math.hypot(x + 0.5 - 32, y + 0.5 - 32) <= 24) disc.data.set([20, 20, 20, 255], (y * 64 + x) * 4);
  const decodeImage = (u) => (u === FAKE_REDRAW_DATA_URL ? disc : { widthPx: 4, heightPx: 4, data: new Uint8ClampedArray(64).fill(200) });
  configureRedraw({ fetch, decodeImage, encodePng: () => `${PNG_PREFIX}UPLOAD` });
  setRedrawAccessCode('letmein');
  const flatResult = await redrawImage({ dataUrl: `${PNG_PREFIX}SOURCE`, style: 'flat' });
  assert.deepEqual(Object.keys(flatResult), ['dataUrl', 'providerId', 'model', 'promptVersion'], 'the resolved value gains no key');
  await redrawImage({ dataUrl: `${PNG_PREFIX}SOURCE` });
  assert.deepEqual(posts, [{ image: `${PNG_PREFIX}UPLOAD`, style: 'flat' }, { image: `${PNG_PREFIX}UPLOAD`, style: 'stones' }]);

  configureRedraw({ fetch, decodeImage: () => { throw new Error('must not decode'); }, encodePng: () => `${PNG_PREFIX}UPLOAD` });
  const before = requests;
  await assert.rejects(redrawImage({ dataUrl: `${PNG_PREFIX}SOURCE`, style: 'bogus' }), (e) => e instanceof RedrawError && e.code === 'provider-failed' && e.detail === 'Unknown redraw style.');
  assert.equal(requests, before, 'no request, not even the config');
  configureRedraw();

  const flat = applyRedraw(baseLayer(), RESULT, { canvas: CANVAS, ...SIZE, now: NOW, style: 'flat' });
  assert.equal(flat.redraw.style, 'flat');
  assert.equal(flat.redraw.promptVersion, 1);
  assert.equal(applyRedraw(baseLayer(), { ...RESULT, promptVersion: 2 }, { canvas: CANVAS, ...SIZE, now: NOW }).redraw.style, 'stones');
  assert.equal(applyRedraw(baseLayer(), RESULT, { canvas: CANVAS, ...SIZE, now: NOW, style: 'other' }).redraw.style, 'stones', 'any other value is stones');
});

// ---- T4. applyRedraw() for 'flat', and restoreOriginal() ----------------------------------------

await test('T4. flat redraw: IMG-022 sizing even with a pitch, vividness 1, staggered + error; previous* recorded; Use original exact; chains flat->stones, stones->flat, flat->flat', () => {
  const layer = baseLayer();
  const frozen = JSON.stringify(layer);
  const out = applyRedraw(layer, RESULT, { canvas: CANVAS, ...SIZE, now: NOW, aiPitchPx: 11.467, style: 'flat' });
  assert.equal(JSON.stringify(layer), frozen, 'input not mutated');
  const plain = applyRedraw(layer, RESULT, { canvas: CANVAS, ...SIZE, now: NOW });
  assert.deepEqual([out.x, out.y, out.w, out.h], [plain.x, plain.y, plain.w, plain.h]);
  assert.deepEqual([out.x, out.y, out.w, out.h], [40, 25, 160, 160]);
  assert.equal(out.vividness, 1);
  assert.equal(out.fillMode, 'staggered');
  assert.equal(out.paletteRule, 'error');
  assert.equal(out.redraw.previousFillMode, 'staggered');
  assert.equal(out.redraw.previousPaletteRule, null);
  assert.equal(JSON.stringify(restoreOriginal(out)), frozen);

  const edge = baseLayer({ fillMode: 'edge' });
  const noMode = baseLayer();
  delete noMode.fillMode;
  for (const original of [edge, noMode]) {
    const f = applyRedraw(original, RESULT, { canvas: CANVAS, ...SIZE, now: NOW, style: 'flat' });
    assert.equal(f.fillMode, 'staggered');
    assert.equal(JSON.stringify(restoreOriginal(JSON.parse(JSON.stringify(f)))), JSON.stringify(original));
  }

  const small = applyRedraw(layer, RESULT, { canvas: { width: 100, height: 100 }, ...SIZE, now: NOW, style: 'flat' });
  assert.deepEqual([small.w, small.h], [80, 80]);

  // flat -> stones (pitch)
  const flatThenStones = applyRedraw(out, RESULT, { canvas: { width: 1000, height: 1000 }, ...SIZE, now: NOW, aiPitchPx: 11.467 });
  assert.equal(flatThenStones.fillMode, 'ai-stones');
  assert.ok(!('paletteRule' in flatThenStones), 'paletteRule is absent after a stones redraw of a flat layer');
  assert.equal(flatThenStones.redraw.previousFillMode, 'staggered');
  assert.equal(flatThenStones.redraw.previousPaletteRule, null);
  assert.equal(flatThenStones.redraw.style, 'stones');
  assert.equal(JSON.stringify(restoreOriginal(flatThenStones)), frozen);

  // stones -> flat
  const stones = applyRedraw(edge, RESULT, { canvas: CANVAS, ...SIZE, now: NOW, aiPitchPx: 11.467 });
  assert.equal(stones.fillMode, 'ai-stones');
  assert.ok(!('previousPaletteRule' in stones.redraw), 'a stones redraw never writes previousPaletteRule');
  const stonesThenFlat = applyRedraw(stones, RESULT, { canvas: CANVAS, ...SIZE, now: NOW, style: 'flat' });
  assert.equal(stonesThenFlat.redraw.previousFillMode, 'edge', "the original's, not 'ai-stones'");
  assert.equal(stonesThenFlat.redraw.previousPaletteRule, null);
  assert.equal(JSON.stringify(restoreOriginal(stonesThenFlat)), JSON.stringify(edge));

  // flat -> flat
  const flatFlat = applyRedraw({ ...out, fillMode: 'radial', paletteRule: 'x' }, RESULT, { canvas: CANVAS, ...SIZE, now: NOW, style: 'flat' });
  assert.equal(flatFlat.redraw.previousFillMode, 'staggered');
  assert.equal(flatFlat.redraw.previousPaletteRule, null);
  assert.equal(JSON.stringify(restoreOriginal(flatFlat)), frozen);
});

// ---- Colour fixtures -----------------------------------------------------------------------------

function hexRgb(hex) { return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)); }

// T5's 100 x 100 fixture, every pixel eligible, exact catalogue colours, no anti-aliasing.
function t5Colour(x, y) {
  if (y < 40) return x >= 45 && x <= 54 && y >= 15 && y <= 24 ? '#9b1c1c' : '#eec6a4';
  return y < 70 ? '#141414' : '#f5f5f5';
}
function makeField(w, h, colourAt) {
  const n = w * h, r = new Uint8ClampedArray(n), g = new Uint8ClampedArray(n), b = new Uint8ClampedArray(n), data = new Uint8ClampedArray(n).fill(255);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const [R, G, B] = colourAt(x, y); const i = y * w + x; r[i] = R; g[i] = G; b[i] = B; }
  return { r, g, b, data, widthPx: w, heightPx: h };
}
const T5 = makeField(100, 100, (x, y) => hexRgb(t5Colour(x, y)));
const eligibleOf = (field) => new Uint8Array(field.data.length).fill(1);
const ids = (groups) => groups.map((g) => g.nearestId);

// ---- T5. The error rule on a synthetic image -----------------------------------------------------

await test('T5. error rule: keeps the 1.00% Siam block the share floor drops; Auto resolves 4 (3 without); no NaN rgb', () => {
  const catalogue = quantizeColors({ ...T5, colorCount: 8, palette: PALETTE });
  assert.deepEqual(ids(catalogue.colorGroups), ['crystal-clear', 'jet', 'light-peach']);
  const error = quantizeColors({ ...T5, colorCount: 8, palette: PALETTE, paletteRule: 'error' });
  assert.deepEqual(ids(error.colorGroups), ['crystal-clear', 'jet', 'siam', 'light-peach']);
  assert.equal(error.colorGroups.find((g) => g.nearestId === 'siam').pixelShare, 0.01);
  assert.equal(chooseAutoColorCount(T5, PALETTE, { paletteRule: 'error' }).resolvedCount, 4);
  assert.equal(chooseAutoColorCount(T5, PALETTE).resolvedCount, 3);
  for (const g of [...catalogue.colorGroups, ...error.colorGroups]) assert.ok(g.rgb.every(Number.isFinite), JSON.stringify(g));
  const none = labelErrorPaletteColors({ ...T5, eligible: new Uint8Array(T5.data.length), palette: PALETTE });
  assert.deepEqual([none.keptIds, none.pickCount, none.eligibleCount], [[], 0, 0]);
  assert.ok(none.labels.every((v) => v === 255));
  assert.equal(chooseAutoColorCount({ ...T5, data: new Uint8ClampedArray(T5.data.length) }, PALETTE, { paletteRule: 'error' }).resolvedCount, 1);
});

// ---- T6. Stride sampling -------------------------------------------------------------------------

await test('T6. stride: 300 x 300 samples every 3rd eligible pixel (30,000); repeat calls agree; 100 x 100 samples every pixel', () => {
  assert.equal(ERROR_PALETTE_MAX_SAMPLES, 40000);
  const big = makeField(300, 300, (x, y) => [(x * 7 + y * 13) % 256, (x * 3 + y * 5) % 256, (x * 11 + y * 2) % 256]);
  const catLabs = PALETTE.map((p) => rgbToLab(...hexRgb(p.hex)));
  const labsOf = (field) => Array.from({ length: field.data.length }, (_, i) => rgbToLab(field.r[i], field.g[i], field.b[i]));
  const allBig = labsOf(big);
  const sample = allBig.filter((_, k) => k % 3 === 0);
  assert.equal(sample.length, 30000);
  const direct = chooseAiStonePalette(sample, catLabs, 8);
  const first = labelErrorPaletteColors({ ...big, eligible: eligibleOf(big), palette: PALETTE });
  assert.equal(first.pickCount, direct.length);
  assert.deepEqual(first.keptIds, direct);
  const second = labelErrorPaletteColors({ ...big, eligible: eligibleOf(big), palette: PALETTE });
  assert.deepEqual(second, first);

  const small = makeField(100, 100, (x, y) => [(x * 7 + y * 13) % 256, (x * 3 + y * 5) % 256, (x * 11 + y * 2) % 256]);
  const smallDirect = chooseAiStonePalette(labsOf(small), catLabs, 8);
  const smallOut = labelErrorPaletteColors({ ...small, eligible: eligibleOf(small), palette: PALETTE });
  assert.equal(smallOut.pickCount, smallDirect.length);
  assert.deepEqual(smallOut.keptIds, smallDirect);
});

// ---- T7. Mapping weights and ties ----------------------------------------------------------------

await test('T7. mapping uses weightedLabDistance, not CIE76; an exact tie goes to the lower palette index', () => {
  // Blocks of dark grey and dark red make the greedy pick both entries (cap 2); the probe is black.
  const GREY = [48, 48, 48], RED = [40, 0, 10], PROBE = [0, 0, 0];
  const colourAt = (x, y) => (x === 0 && y === 0 ? PROBE : y < 5 ? GREY : RED);
  const field = makeField(10, 10, colourAt);
  const probeLab = rgbToLab(...PROBE);
  const twoEntries = [{ id: 'a', hex: '#000000' }, { id: 'b', hex: '#000000' }];

  const weightedWins = [[probeLab[0] + 20, probeLab[1], probeLab[2]], [probeLab[0], probeLab[1] + 15, probeLab[2]]];
  const [w0, w1] = weightedWins.map((c) => weightedLabDistance(probeLab, c));
  const [c0, c1] = weightedWins.map((c) => cie76Distance(probeLab, c));
  assert.ok(w0 < w1 && c1 < c0, `the metrics disagree (weighted ${w0} vs ${w1}, CIE76 ${c0} vs ${c1})`);
  const out = labelErrorPaletteColors({ ...field, eligible: eligibleOf(field), palette: twoEntries, catalogLabs: weightedWins, maxColors: 2 });
  assert.deepEqual(out.keptIds, [0, 1], 'both entries picked');
  assert.equal(out.labels[0], 0, 'the probe takes the weighted-nearest pick');

  // Swapped order: the weighted winner is now index 1.
  const swapped = labelErrorPaletteColors({ ...field, eligible: eligibleOf(field), palette: twoEntries, catalogLabs: [weightedWins[1], weightedWins[0]], maxColors: 2 });
  assert.equal(swapped.labels[0], 1);

  const tie = [[probeLab[0], probeLab[1] + 10, probeLab[2]], [probeLab[0], probeLab[1] - 10, probeLab[2]]];
  assert.equal(weightedLabDistance(probeLab, tie[0]), weightedLabDistance(probeLab, tie[1]), 'an exact tie');
  const tieField = makeField(10, 10, (x, y) => (x === 0 && y === 0 ? PROBE : y < 5 ? [60, 0, 20] : [0, 40, 20]));
  const tied = labelErrorPaletteColors({ ...tieField, eligible: eligibleOf(tieField), palette: twoEntries, catalogLabs: tie, maxColors: 2 });
  assert.deepEqual(tied.keptIds, [0, 1]);
  assert.equal(tied.labels[0], 0, 'ties go to the lower palette index');
});

// ---- T8. Manual count overrides the cap ---------------------------------------------------------

await test('T8. manual count 2 under the error rule gives the first two greedy picks: jet and light-peach', () => {
  const two = quantizeColors({ ...T5, colorCount: 2, palette: PALETTE, paletteRule: 'error' });
  assert.deepEqual(ids(two.colorGroups), ['jet', 'light-peach']);
  const shares = Object.fromEntries(two.colorGroups.map((g) => [g.nearestId, g.pixelShare]));
  // Crystal goes to light-peach, Siam to its weighted-nearest of the two.
  const siamLab = rgbToLab(...hexRgb('#9b1c1c'));
  const siamTo = weightedLabDistance(siamLab, rgbToLab(...hexRgb('#141414'))) < weightedLabDistance(siamLab, rgbToLab(...hexRgb('#eec6a4'))) ? 'jet' : 'light-peach';
  const expected = { jet: 0.3, 'light-peach': 0.39 + 0.3 };
  expected[siamTo] += 0.01;
  for (const id of ['jet', 'light-peach']) assert.ok(Math.abs(shares[id] - expected[id]) < 1e-12, `${id} ${shares[id]}`);
});

// ---- T9. Move, not copy --------------------------------------------------------------------------

await test('T9. AiStoneSampler.js re-exports the moved bindings; no copy left behind; src/image never imports ../geometry/', async () => {
  for (const name of ['chooseAiStonePalette', 'weightedLabDistance', 'AI_STONE_LAB_WEIGHTS', 'AI_STONE_PALETTE_CAP']) {
    assert.ok(AiStoneSampler[name] === WeightedLabPalette[name], name);
  }
  const sampler = await readFile(fileURLToPath(new URL('src/geometry/AiStoneSampler.js', repoUrl)), 'utf8');
  assert.ok(!sampler.includes('function chooseAiStonePalette'));
  const dir = fileURLToPath(new URL('src/image/', repoUrl));
  for (const name of await readdir(dir)) {
    if (!name.endsWith('.js')) continue;
    const src = await readFile(dir + name, 'utf8');
    assert.ok(!/from\s+['"]\.\.\/geometry\//.test(src), `${name} imports ../geometry/`);
  }
});

// ---- T10. Byte identity without paletteRule -----------------------------------------------------

async function extractProjectFunctions() {
  const validateMatch = appJs.match(/function validateProject\(obj\)\{[\s\S]*?\n\}\n/);
  const defaultMatch = appJs.match(/function defaultProject\(\)\{[\s\S]*?\}\}\n/);
  assert.ok(validateMatch && defaultMatch);
  const constantsStart = appJs.indexOf('const DEFAULT_TEXT_FONT_ID=');
  const source = `${appJs.slice(constantsStart, appJs.indexOf(defaultMatch[0]) + defaultMatch[0].length)}\n${appJs.slice(appJs.indexOf('const SUPPORTED_LAYER_TYPES=new Set'), appJs.indexOf(validateMatch[0]) + validateMatch[0].length)}`;
  const { SHAPE_LIBRARY_KINDS } = await import('../src/geometry/index.js');
  const { getObjectTemplate, getPlateDefaults, normalizePlateParams, VESSEL_PRODUCT_IDS, getVesselDefaults, normalizeVesselParams, deriveLegacyVesselParams, computeCanvasFromVessel } = await import('../src/products/index.js');
  // eslint-disable-next-line no-new-func
  return new Function(
    'getObjectTemplate', 'SHAPE_LIBRARY_KINDS', 'getPlateDefaults', 'normalizePlateParams',
    'VESSEL_PRODUCT_IDS', 'getVesselDefaults', 'normalizeVesselParams', 'deriveLegacyVesselParams', 'computeCanvasFromVessel',
    `${source}\nreturn { validateProject, defaultProject };`
  )(getObjectTemplate, SHAPE_LIBRARY_KINDS, getPlateDefaults, normalizePlateParams, VESSEL_PRODUCT_IDS, getVesselDefaults, normalizeVesselParams, deriveLegacyVesselParams, computeCanvasFromVessel);
}

// test-img-023's IMAGE_LAYER.
const IMAGE_LAYER = { id: 'image1', type: 'image', visible: true, imageSrc: 'data:image/png;base64,AAAA', imageName: 'a.png', naturalWidthPx: 256, naturalHeightPx: 248, x: 20, y: 30, w: 100, h: 97, maskMode: 'subject', threshold: 128, stoneSize: 2, gap: 0.3, colorCount: 'auto', vividness: 1.4, rotationDeg: 0, fillMode: 'staggered', invert: false, transparent: 'ignore', blurRadiusPx: 0, maxWidthPx: 400, maxHeightPx: 400 };

// The T5 picture as an opaque RGBA image buffer.
const T5_IMAGE = (() => {
  const data = new Uint8ClampedArray(100 * 100 * 4);
  for (let i = 0; i < 100 * 100; i++) data.set([T5.r[i], T5.g[i], T5.b[i], 255], i * 4);
  return { widthPx: 100, heightPx: 100, data };
})();
const ENGINE_BASE = { imageBuffer: T5_IMAGE, layerId: 'L', xMm: 0, yMm: 0, widthMm: 50, heightMm: 50, stoneSizeMm: 2, gapMm: 0.3, mode: 'staggered', maxWidthPx: 100, maxHeightPx: 100, transparent: 'white', maskMode: 'whole', colorCount: 8, palette: PALETTE };
const FIELD_PARAMS = { maxWidthPx: 100, maxHeightPx: 100, transparent: 'white', maskMode: 'whole', colorCount: 8, palette: PALETTE };
const stoneKey = (layout) => layout.stones.map((s) => [s.xMm, s.yMm, s.sizeMm, s.color]);

await test('T10. byte identity: a project without paletteRule round-trips; stones and colorGroups identical for absent/undefined/null/catalogue; an error layer survives the round trip', async () => {
  const { validateProject, defaultProject } = await extractProjectFunctions();
  const p0 = validateProject({ ...defaultProject(), layers: [...defaultProject().layers, IMAGE_LAYER] });
  const p1 = validateProject(JSON.parse(JSON.stringify(p0)));
  assert.equal(JSON.stringify(p1), JSON.stringify(p0));
  assert.ok(p1.layers.every((l) => !('paletteRule' in l)));

  const reference = stoneKey(engine.generateImageLayout(ENGINE_BASE));
  assert.ok(reference.length > 0);
  const referenceGroups = prepareImageField(T5_IMAGE, FIELD_PARAMS).colorGroups;
  for (const paletteRule of [undefined, null, 'catalogue']) {
    assert.deepEqual(stoneKey(engine.generateImageLayout({ ...ENGINE_BASE, paletteRule })), reference, String(paletteRule));
    assert.deepEqual(prepareImageField(T5_IMAGE, { ...FIELD_PARAMS, paletteRule }).colorGroups, referenceGroups, String(paletteRule));
  }

  const withError = validateProject({ ...defaultProject(), layers: [...defaultProject().layers, { ...IMAGE_LAYER, paletteRule: 'error' }] });
  const reopened = validateProject(JSON.parse(JSON.stringify(withError)));
  assert.equal(reopened.layers[reopened.layers.length - 1].paletteRule, 'error');
});

// ---- T11. Engine wiring --------------------------------------------------------------------------

await test('T11. engine: an error-rule layer uses only the error-rule colours (Siam included); resolveImagePolygons() traces one region per error-rule group', () => {
  const groups = ids(prepareImageField(T5_IMAGE, { ...FIELD_PARAMS, paletteRule: 'error' }).colorGroups);
  assert.deepEqual(groups, ['crystal-clear', 'jet', 'siam', 'light-peach']);
  const colours = new Set(engine.generateImageLayout({ ...ENGINE_BASE, paletteRule: 'error' }).stones.map((s) => s.color));
  assert.ok([...colours].every((c) => groups.includes(c)), [...colours].join(','));
  assert.ok(colours.has('siam'), 'the Siam block gets stones');
  assert.ok(!new Set(engine.generateImageLayout(ENGINE_BASE).stones.map((s) => s.color)).has('siam'), 'the catalogue rule drops Siam');
  const { regions } = engine.resolveImagePolygons({ ...ENGINE_BASE, paletteRule: 'error' });
  assert.deepEqual(regions.map((r) => r.colorId), groups);
});

// ---- T12. app.js and index.html wiring ----------------------------------------------------------

function extractFunction(marker) {
  const start = appJs.indexOf(marker);
  assert.ok(start !== -1, `expected ${marker}`);
  let depth = 0;
  for (let i = start + marker.length - 1; i < appJs.length; i++) {
    if (appJs[i] === '{') depth++;
    else if (appJs[i] === '}') { depth--; if (depth === 0) return appJs.slice(start, i + 1); }
  }
  throw new Error(`no closing brace for ${marker}`);
}

await test('T12. wiring: the Redraw style select, its storage, the run-bound style, and the five colour-pipeline edits', () => {
  const label = /<label id="imageRedrawStyleField"[^>]*\bhidden\b[^>]*>[^<]*<select id="imageRedrawStyle">([\s\S]*?)<\/select><\/label>/.exec(indexHtml);
  assert.ok(label, 'index.html has #imageRedrawStyleField (hidden) wrapping #imageRedrawStyle');
  const options = [...label[1].matchAll(/<option value="([^"]*)"( selected)?>([^<]*)<\/option>/g)];
  assert.deepEqual(options.map((m) => [m[1], m[3]]), [['stones', 'Stone picture'], ['flat', 'Flat artwork']]);
  assert.deepEqual(options.map((m) => Boolean(m[2])), [true, false], 'Stone picture is selected');
  assert.ok(indexHtml.includes('.image-redraw-row label[hidden]{display:none}'));
  assert.ok(indexHtml.indexOf('id="imageRedrawStyleField"') < indexHtml.indexOf('id="imageRedraw"'), 'the select comes before Redraw with AI');

  assert.ok(appJs.includes("const REDRAW_STYLE_STORAGE_KEY='rhinestoneStudio.redrawStyle';"));
  const load = "function loadRedrawStyle(){try{return localStorage.getItem(REDRAW_STYLE_STORAGE_KEY)==='flat'?'flat':'stones'}catch{return'stones'}}";
  const save = 'function saveRedrawStyle(style){try{localStorage.setItem(REDRAW_STYLE_STORAGE_KEY,style)}catch{}}';
  assert.ok(appJs.includes(load) && appJs.includes(save));
  assert.ok(appJs.indexOf(load) < appJs.indexOf('const REDRAW_ERROR_MESSAGES={'), 'before the T8c slice');
  const history = /const HISTORY_TRACKED_CONTROL_IDS=\[([^\]]*)\];/.exec(appJs);
  assert.ok(history && !history[1].includes('imageRedrawStyle'));

  const sync = extractFunction('function syncImageRedrawControls(l){');
  assert.ok(sync.includes("el('imageRedrawStyleField').hidden=el('imageRedraw').hidden;el('imageRedrawStyle').disabled=busy;"));
  const start = extractFunction('async function startImageRedraw(){');
  assert.ok(start.includes("const style=el('imageRedrawStyle').value==='flat'?'flat':'stones';"));
  assert.ok(start.includes('redrawImage({dataUrl:source,signal:redrawRun.signal,style})'));
  assert.ok(start.includes("style==='stones'?aiStoneDetectionFor("));
  assert.ok(start.includes('detection&&detection.ok?'));
  assert.ok(start.includes('now:Date.now,aiPitchPx,shrink,style})'));
  assert.ok(appJs.includes("el('imageRedrawStyle').value=loadRedrawStyle();el('imageRedrawStyle').onchange=()=>saveRedrawStyle(el('imageRedrawStyle').value==='flat'?'flat':'stones');"));

  assert.ok(extractFunction('function autoColorCountKeyParts(layer){').includes("resolveImageVividness(layer.vividness),layer.paletteRule==='error'?'error':''];"));
  assert.ok(extractFunction('function resolveImageColorCount(layer){').includes('chooseAutoColorCount(field,imageColorPalette(),{chromaScale:resolveImageVividness(layer.vividness),paletteRule:layer.paletteRule})'));
  const colorField = extractFunction('function computeImageColorField(layer){');
  assert.ok(colorField.includes("maskMode,vividness,layer.paletteRule==='error'?'error':''].join('|');"));
  assert.ok(colorField.includes('vividness,paletteRule:layer.paletteRule,palette:imageColorPalette()});'));
  const live = extractFunction('async generateImageStonesLive(layer,{includeStats=false}={}){');
  assert.equal((live.match(/palette:imageColorPalette\(\),paletteRule:layer\.paletteRule,/g) || []).length, 1, 'the live params only, not Line Design');
  assert.ok(extractFunction('function resolveImageExportRegions(project){').includes('palette:imageColorPalette(),paletteRule:layer.paletteRule,'));

  const run = (storage) => new Function('localStorage', `const REDRAW_STYLE_STORAGE_KEY='rhinestoneStudio.redrawStyle';\n${load}\nreturn loadRedrawStyle();`)(storage);
  assert.equal(run({ getItem() { throw new Error('blocked'); } }), 'stones');
  assert.equal(run({ getItem: (k) => (k === 'rhinestoneStudio.redrawStyle' ? 'flat' : null) }), 'flat');
  assert.equal(run({ getItem: () => 'x' }), 'stones');
  const runSave = (storage) => new Function('localStorage', `const REDRAW_STYLE_STORAGE_KEY='rhinestoneStudio.redrawStyle';\n${save}\nsaveRedrawStyle('flat');`)(storage);
  assert.doesNotThrow(() => runSave({ setItem() { throw new Error('blocked'); } }));
});

await test('Registered in tools/test-groups.mjs', () => {
  assertTestRegistered({ filename: 'test-img-024-flat-artwork-style.mjs', group: 'integration', includedInDefault: true });
});
