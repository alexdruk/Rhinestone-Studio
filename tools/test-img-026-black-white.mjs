// IMG-026 build P -- Black & white in two styles: the Bold and Shaded prompts (Appendices F and G),
// the request each look makes (layout mode and palette), fake mode, the layer's look and the lightbox
// state, validateProject() for old and new layers, and the app.js wiring. See
// docs/specifications/IMG-026-StrassLayoutService.md, "Black & white (build P)". The service's
// mapping is tested in services/strass-layout/tests/test_build_p.py.
//
// Never touches the network (every fetch is injected), never needs OPENAI_API_KEY and never writes
// to the source tree.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { STONE_COLORS } from '../src/renderer/StoneColors.js';
import { isValidStoneSizeId } from '../src/renderer/StoneSizes.js';
import { PROMPT_VERSIONS, BOLD_PROMPT_VERSION, SHADED_PROMPT_VERSION, REDRAW_STYLES as SERVER_REDRAW_STYLES, BW_REDRAW_STYLES, BW_COLOR_IDS, buildRedrawPrompt, buildPaletteLine, layoutRequestFor } from '../server/redraw/prompt.mjs';
import { loadRedrawEnv } from '../server/redraw/env.mjs';
import { createRedrawHandler, OPENAI_IMAGE_EDITS_URL, FAKE_LAYOUT, FAKE_LAYOUT_BW } from '../server/redraw/handler.mjs';
import { FAKE_REDRAW_DATA_URL } from '../src/redraw/FakeRedrawProvider.js';
import { redrawImage, configureRedraw, setRedrawAccessCode, RedrawError, REDRAW_STYLES, REDRAW_STAGE_MESSAGES, applyRedraw, fitAiLayoutCanvas } from '../src/redraw/index.js';
import { imageStudioState, redrawLookOf, redrawStyleForLook, redrawLookFields, REDRAW_MODES, REDRAW_BW_STYLES } from '../src/ui/index.js';
import { SHAPE_LIBRARY_KINDS } from '../src/geometry/index.js';
import { OBJECT_TEMPLATE_IDS, SHEET_MAX_MM, getObjectTemplate, getPlateDefaults, normalizePlateParams, VESSEL_PRODUCT_IDS, getVesselDefaults, normalizeVesselParams, deriveLegacyVesselParams, computeCanvasFromVessel } from '../src/products/index.js';
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
const indexHtml = await readFile(repo('index.html'), 'utf8');
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

// The fenced blocks of one spec section, in order.
function blocksOf(heading) {
  const from = spec.indexOf(heading);
  assert.ok(from !== -1, `the spec has ${heading}`);
  const next = spec.indexOf('\n## ', from + heading.length);
  const section = spec.slice(from, next === -1 ? undefined : next);
  const out = [];
  for (let at = 0; ;) {
    const open = section.indexOf('```\n', at);
    if (open === -1) return out;
    const close = section.indexOf('\n```', open + 4);
    out.push(section.slice(open + 4, close));
    at = close + 4;
  }
}

const PNG_PREFIX = 'data:image/png;base64,';
const FAKE_B64 = FAKE_REDRAW_DATA_URL.slice(PNG_PREFIX.length);
const LAYOUT_BASE = 'http://layout.test:8000';
const STYLES = ['stones', 'bold', 'shaded'];
const LOOKS = { stones: { mode: 'colour', bwStyle: 'bold' }, bold: { mode: 'bw', bwStyle: 'bold' }, shaded: { mode: 'bw', bwStyle: 'shaded' } };
const SHAPES = ['square', 'auto'];

const SIXTY = 'Make the stones large: about 60 stones across the full width of the image.';
const SQUARE_LINE = '- Square image at the highest resolution available.';
const WHOLE_LINE = '- Use the whole image at the highest resolution available, in the same shape (width to height) as the uploaded image.';
const SKIN_RAMP_START = '  skin (every skin tone, from the lightest to the deepest;';
const SKIN_RULE = "- Keep each person's skin tone, lightness and undertone as the photo shows them. Never lighten or whiten skin: each face stays as light or as dark as it is in the photo.";
const RAMPS_CHECK = 'skin and fur only from their ramps';
const EYE_RULE = '- Eyes are never part of a dark area. In each eye the white is Crystal, the iris and the pupil are Jet, with one Crystal catch-light stone, and at least one row of Crystal stones separates the eye from any dark shadow or eyebrow around it.';
const MIX_RULE = '- Show mid-tones only by mixing the two colours in clear patterns (rows or patches), never by inventing a grey.';

// ---- 1-3. Prompts --------------------------------------------------------------------------------

await test('1. styles and versions: bold and shaded are new styles at version 1; the client and the server agree; Black & white is Jet and Crystal', () => {
  assert.equal(BOLD_PROMPT_VERSION, 1);
  assert.equal(SHADED_PROMPT_VERSION, 1);
  assert.deepEqual(PROMPT_VERSIONS, { stones: 7, flat: 1, bold: 1, shaded: 1 });
  assert.deepEqual(SERVER_REDRAW_STYLES, ['stones', 'flat', 'bold', 'shaded']);
  assert.deepEqual(REDRAW_STYLES, SERVER_REDRAW_STYLES);
  assert.deepEqual(BW_REDRAW_STYLES, ['bold', 'shaded']);
  assert.deepEqual(BW_COLOR_IDS, ['jet', 'crystal-clear']);
  assert.equal(STONE_COLORS['crystal-clear'].name, 'Crystal', 'Crystal is crystal-clear (id crystal is Crystal AB)');
  assert.deepEqual(REDRAW_BW_STYLES, BW_REDRAW_STYLES, 'the lightbox styles are the prompt styles');
});

await test('2. the Bold and Shaded prompts equal Appendix E of their shape with section 4 and the final check of Appendices F and G', () => {
  const [square, auto] = blocksOf('## Appendix E');
  const appendix = { bold: blocksOf('## Appendix F'), shaded: blocksOf('## Appendix G') };
  for (const style of BW_REDRAW_STYLES) {
    assert.equal(appendix[style].length, 2, `${style}: section 4 and the final check`);
    const [section4, check] = appendix[style];
    for (const [shape, block] of [['square', square], ['auto', auto]]) {
      const lines = block.split('\n');
      const from = lines.indexOf('4. COLOURS');
      const to = lines.indexOf('5. DESIGN') - 1; // the blank line before section 5
      const last = lines.findIndex((l) => l.startsWith('Before finishing, check that:'));
      assert.ok(from > 0 && to > from && last > to);
      const expected = [...lines.slice(0, from), ...section4.split('\n'), ...lines.slice(to, last), check].join('\n');
      assert.equal(buildRedrawPrompt(undefined, style, shape), expected, `${style} ${shape}`);
    }
  }
  assert.equal(appendix.bold[0].split('\n')[2], `Jet ${STONE_COLORS.jet.previewColor}, Crystal ${STONE_COLORS['crystal-clear'].previewColor}.`, 'the hex values are the catalogue preview colours');
});

await test('3. wording: no skin lines, no palette or ramps in Black & white; the eye rule in Bold, mixing in Shaded; the Flat Sheet size rules of build N apply to both', () => {
  for (const style of BW_REDRAW_STYLES) {
    for (const shape of SHAPES) {
      const prompt = buildRedrawPrompt(undefined, style, shape);
      const lines = prompt.split('\n');
      const name = `${style} ${shape}`;
      assert.ok(!prompt.includes(SKIN_RAMP_START) && !prompt.includes(SKIN_RULE), `${name}: no skin lines`);
      assert.ok(!prompt.includes(RAMPS_CHECK) && !prompt.includes('Use these ramps'), `${name}: no ramps`);
      assert.ok(!prompt.includes(buildPaletteLine(undefined, true)), `${name}: no palette line`);
      assert.ok(lines.includes('- Every stone is either Jet or Crystal. No greys, no other colours, no tints.'), name);
      assert.ok(lines.at(-1).includes('every stone is Jet or Crystal'), name);
      assert.equal(lines.includes(EYE_RULE), style === 'bold', `${name}: the eye rule`);
      assert.equal(lines.includes(MIX_RULE), style === 'shaded', `${name}: mixing`);
      assert.equal(lines.at(-1).includes('no area is mixed or speckled'), style === 'bold', `${name}: the check`);
      assert.equal(prompt.includes(SIXTY), shape === 'square', `${name}: 60-across sentence`);
      assert.equal(lines.includes(WHOLE_LINE), shape === 'auto', `${name}: whole-image line`);
      assert.equal(lines.includes(SQUARE_LINE), shape === 'square', `${name}: square line`);
      // Outside section 4 and the check, the text is the colour prompt's.
      const colour = buildRedrawPrompt(undefined, 'stones', shape).split('\n');
      assert.deepEqual(lines.slice(0, lines.indexOf('4. COLOURS')), colour.slice(0, colour.indexOf('4. COLOURS')), `${name}: sections 1-3`);
      assert.deepEqual(lines.slice(lines.indexOf('5. DESIGN'), -1), colour.slice(colour.indexOf('5. DESIGN'), -1), `${name}: sections 5-6`);
    }
  }
  const colour = buildRedrawPrompt(undefined, 'stones', 'auto');
  assert.ok(colour.includes(SKIN_RULE) && colour.includes(SKIN_RAMP_START), 'Colour keeps the skin lines');
});

await test('4. the layout request: Black & white styles ask for mode bw with Jet and Crystal only; every other style for mode colour with all 47 colours', () => {
  for (const style of BW_REDRAW_STYLES) assert.deepEqual(layoutRequestFor(style), { mode: 'bw', colorIds: ['jet', 'crystal-clear'] });
  for (const style of ['stones', 'flat', undefined]) assert.deepEqual(layoutRequestFor(style), { mode: 'colour', colorIds: Object.keys(STONE_COLORS) });
  assert.equal(layoutRequestFor('stones').colorIds.length, 47);
});

// ---- 5-6. Server --------------------------------------------------------------------------------

function upstream(layout = FAKE_LAYOUT) {
  const calls = { openAi: [], layout: [] };
  const fetch = async (url, init) => {
    if (url === OPENAI_IMAGE_EDITS_URL) { calls.openAi.push(init); return new Response(JSON.stringify({ data: [{ b64_json: FAKE_B64 }] }), { status: 200 }); }
    calls.layout.push(init);
    return new Response(JSON.stringify(layout), { status: 200 });
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

async function finish(handler, body) {
  const res = makeRes();
  await handler.handleRedraw(makeReq({ body }), res);
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

await test('5. server: each look sends its prompt and size to OpenAI and its mode and palette to the layout service, and answers its version', async () => {
  for (const style of STYLES) {
    for (const shape of SHAPES) {
      const { fetch, calls } = upstream();
      const view = await finish(handlerFor(KEY_ENV, fetch), JSON.stringify({ image: FAKE_REDRAW_DATA_URL, style, shape }));
      const name = `${style} ${shape}`;
      assert.equal(view.stage, 'done', name);
      assert.equal(calls.openAi.length, 1, `${name}: one provider call`);
      assert.equal(calls.openAi[0].body.get('prompt'), buildRedrawPrompt(undefined, style, shape), name);
      assert.equal(calls.openAi[0].body.get('size'), shape === 'auto' ? 'auto' : '1024x1024', name);
      assert.equal(calls.layout.length, 1, name);
      const options = JSON.parse(calls.layout[0].body.get('options'));
      const bw = style !== 'stones';
      assert.deepEqual(options, { colorIds: bw ? ['jet', 'crystal-clear'] : Object.keys(STONE_COLORS), targetPitchMm: 2.1, mode: bw ? 'bw' : 'colour' }, name);
      assert.equal(view.result.promptVersion, PROMPT_VERSIONS[style], name);
    }
  }
  const { fetch, calls } = upstream();
  const res = makeRes();
  await handlerFor(KEY_ENV, fetch).handleRedraw(makeReq({ body: JSON.stringify({ image: FAKE_REDRAW_DATA_URL, style: 'bw' }) }), res);
  assert.equal(res.statusCode, 400, 'an unknown style is refused');
  assert.equal(calls.openAi.length + calls.layout.length, 0);
});

await test('6. fake mode: Bold and Shaded answer the Black & white fake layout (the same stones in Jet and Crystal only), Colour the colour one; no upstream call', async () => {
  assert.equal(FAKE_LAYOUT_BW.stones.length, FAKE_LAYOUT.stones.length);
  assert.deepEqual(FAKE_LAYOUT_BW.stones.map((t) => t.slice(0, 3)), FAKE_LAYOUT.stones.map((t) => t.slice(0, 3)), 'positions and sizes unchanged');
  assert.deepEqual(new Set(FAKE_LAYOUT_BW.stones.map((t) => t[3])), new Set(BW_COLOR_IDS));
  const counts = {};
  for (const t of FAKE_LAYOUT_BW.stones) counts[t[3]] = (counts[t[3]] || 0) + 1;
  assert.deepEqual(FAKE_LAYOUT_BW.report.colours, counts);
  assert.deepEqual({ ...FAKE_LAYOUT_BW.report, colours: null }, { ...FAKE_LAYOUT.report, colours: null }, 'the rest of the report is the colour fake\'s');
  for (const style of STYLES) {
    const { fetch, calls } = upstream();
    const view = await finish(handlerFor(FAKE_ENV, fetch), JSON.stringify({ image: FAKE_REDRAW_DATA_URL, style, shape: 'auto' }));
    assert.equal(calls.openAi.length + calls.layout.length, 0, style);
    assert.deepEqual(view.result.layout, style === 'stones' ? FAKE_LAYOUT : FAKE_LAYOUT_BW, style);
    assert.equal(view.result.promptVersion, PROMPT_VERSIONS[style]);
  }
});

// ---- 7-9. The layer's look ----------------------------------------------------------------------

await test('7. the look: a layer without one is Colour; Black & white defaults to Bold; each look asks for its style and stores only its own fields', () => {
  assert.deepEqual(REDRAW_MODES, ['colour', 'bw']);
  for (const layer of [null, {}, { type: 'image' }, { redrawMode: 'grey' }, { redrawBwStyle: 'shaded' }]) {
    assert.equal(redrawLookOf(layer).mode, 'colour', JSON.stringify(layer));
    assert.equal(redrawStyleForLook(redrawLookOf(layer)), 'stones');
  }
  assert.deepEqual(redrawLookOf({ redrawMode: 'bw' }), { mode: 'bw', bwStyle: 'bold' });
  assert.deepEqual(redrawLookOf({ redrawMode: 'bw', redrawBwStyle: 'shaded' }), { mode: 'bw', bwStyle: 'shaded' });
  assert.deepEqual(redrawLookOf({ redrawMode: 'bw', redrawBwStyle: 'x' }), { mode: 'bw', bwStyle: 'bold' });
  for (const style of STYLES) assert.equal(redrawStyleForLook(LOOKS[style]), style);
  assert.deepEqual(redrawLookFields(LOOKS.stones), { redrawMode: 'colour' });
  assert.deepEqual(redrawLookFields(LOOKS.bold), { redrawMode: 'bw', redrawBwStyle: 'bold' });
  assert.deepEqual(redrawLookFields(LOOKS.shaded), { redrawMode: 'bw', redrawBwStyle: 'shaded' });
});

const AI_LAYOUT = { version: 1, widthMm: 30, heightMm: 30, stones: [[5, 5, 'ss6', 'jet']], report: { coverage: 0.7 }, editCount: 0 };
const aiLayer = (look, style, overrides = {}) => ({
  id: 'image1', type: 'image', fillMode: 'ai-layout', aiLayout: AI_LAYOUT, ...look,
  redraw: { originalImageSrc: 'data:image/png;base64,AAAA', ...(style === undefined ? {} : { style }) }, ...overrides
});

await test('8. imageStudioState(): the choice shows when a provider is available; a layer made in another look offers Redraw with AI, even at good coverage', () => {
  const on = { available: true };
  assert.equal(imageStudioState(null, on).look, true, 'shown before any upload');
  assert.equal(imageStudioState(null, {}).look, false, 'hidden without a provider');
  for (const made of STYLES) {
    for (const wanted of STYLES) {
      const layer = aiLayer(redrawLookFields(LOOKS[wanted]), made);
      const state = imageStudioState(layer, on);
      assert.equal(state.lookChanged, made !== wanted, `${made} -> ${wanted}`);
      assert.equal(state.redrawButton, made !== wanted ? 'Redraw with AI' : null, `${made} -> ${wanted}`);
    }
  }
  assert.equal(imageStudioState(aiLayer({}, undefined), on).lookChanged, false, 'an old redraw without a style is Colour');
  assert.equal(imageStudioState(aiLayer({ redrawMode: 'bw' }, undefined), on).lookChanged, true);
  assert.equal(imageStudioState(aiLayer({ redrawMode: 'bw' }, 'flat', { fillMode: 'staggered' }), on).lookChanged, false, 'a flat redraw has no look');
  assert.equal(imageStudioState({ id: 'image2', type: 'image', redrawMode: 'bw' }, on).lookChanged, false, 'no redraw yet: nothing to change');
  const changed = aiLayer({ redrawMode: 'bw' }, 'stones');
  assert.equal(imageStudioState(changed, { ...on, runningLayerId: 'x' }).redrawButton, null, 'no button while a redraw runs');
  assert.equal(imageStudioState(changed, {}).redrawButton, null, 'no button without a provider');
  assert.equal(imageStudioState(aiLayer({}, 'stones', { aiLayout: { ...AI_LAYOUT, report: { coverage: 0.4 } } }), on).redrawButton, 'Try again', 'low coverage still says Try again');
});

await test('9. applyRedraw(): a Bold or Shaded redraw with a layout makes an ai-layout layer and records its style and version', () => {
  const layer = { id: 'image1', type: 'image', imageSrc: `${PNG_PREFIX}SRC`, imageName: 'p.png', x: 10, y: 10, w: 50, h: 50, naturalWidthPx: 100, naturalHeightPx: 100, fillMode: 'staggered', vividness: 1.4, redrawMode: 'bw', redrawBwStyle: 'shaded' };
  for (const style of STYLES) {
    const result = { dataUrl: FAKE_REDRAW_DATA_URL, providerId: 'openai-proxy', model: 'gpt-image-1', promptVersion: PROMPT_VERSIONS[style] };
    const layout = style === 'stones' ? FAKE_LAYOUT : FAKE_LAYOUT_BW;
    const out = applyRedraw(layer, result, { canvas: { width: 300, height: 300 }, naturalWidthPx: 64, naturalHeightPx: 64, now: () => 0, style, layout });
    assert.equal(out.fillMode, 'ai-layout', style);
    assert.equal(out.redraw.style, style);
    assert.equal(out.redraw.promptVersion, PROMPT_VERSIONS[style]);
    assert.deepEqual(out.aiLayout.stones, layout.stones);
    assert.equal(out.redrawMode, 'bw', 'the look stays on the layer');
    assert.equal(out.redrawBwStyle, 'shaded');
  }
  assert.equal(applyRedraw(layer, { dataUrl: FAKE_REDRAW_DATA_URL }, { canvas: { width: 300, height: 300 }, naturalWidthPx: 64, naturalHeightPx: 64, now: () => 0, style: 'other' }).redraw.style, 'stones');
});

// ---- 10. validateProject() -------------------------------------------------------------------------

function extractProjectFunctions() {
  const validateMatch = appJs.match(/function validateProject\(obj\)\{[\s\S]*?\n\}\n/);
  const defaultMatch = appJs.match(/function defaultProject\(\)\{[\s\S]*?\}\}\n/);
  assert.ok(validateMatch && defaultMatch);
  const constantsStart = appJs.indexOf('const DEFAULT_TEXT_FONT_ID=');
  const source = `${appJs.slice(constantsStart, appJs.indexOf(defaultMatch[0]) + defaultMatch[0].length)}\n${appJs.slice(appJs.indexOf('const SUPPORTED_LAYER_TYPES=new Set'), appJs.indexOf(validateMatch[0]) + validateMatch[0].length)}`;
  return new Function(
    'getObjectTemplate', 'SHAPE_LIBRARY_KINDS', 'getPlateDefaults', 'normalizePlateParams',
    'VESSEL_PRODUCT_IDS', 'getVesselDefaults', 'normalizeVesselParams', 'deriveLegacyVesselParams', 'computeCanvasFromVessel',
    'isValidStoneSizeId', 'STONE_COLORS', 'REDRAW_MODES', 'REDRAW_BW_STYLES',
    `${source}\nreturn { validateProject, defaultProject };`
  )(getObjectTemplate, SHAPE_LIBRARY_KINDS, getPlateDefaults, normalizePlateParams, VESSEL_PRODUCT_IDS, getVesselDefaults, normalizeVesselParams, deriveLegacyVesselParams, computeCanvasFromVessel, isValidStoneSizeId, STONE_COLORS, REDRAW_MODES, REDRAW_BW_STYLES);
}
const { validateProject, defaultProject } = extractProjectFunctions();

const IMAGE_LAYER = { id: 'image1', type: 'image', visible: true, imageSrc: `${PNG_PREFIX}WIDE`, imageName: 'wide.png', naturalWidthPx: 400, naturalHeightPx: 100, x: 10, y: 10, w: 80, h: 20, maskMode: 'subject', threshold: 128, stoneSize: 2, gap: 0.3, colorCount: 'auto', vividness: 1.4, rotationDeg: 0, fillMode: 'staggered', invert: false, transparent: 'ignore', blurRadiusPx: 0, maxWidthPx: 400, maxHeightPx: 400 };
const projectWith = (layer) => ({ ...defaultProject(), layers: [layer] });

await test('10. validateProject(): an old image layer (no look) loads unchanged and is Colour; Colour, Bold and Shaded layers load; unknown values are refused', () => {
  const old = projectWith({ ...IMAGE_LAYER, fillMode: 'ai-layout', aiLayout: AI_LAYOUT, redraw: { originalImageSrc: 'data:image/png;base64,AAAA', style: 'stones', promptVersion: 7 } });
  const loaded = validateProject(JSON.parse(JSON.stringify(old)));
  assert.equal('redrawMode' in loaded.layers[0], false, 'nothing is added to an old layer');
  assert.equal('redrawBwStyle' in loaded.layers[0], false);
  assert.deepEqual(redrawLookOf(loaded.layers[0]), { mode: 'colour', bwStyle: 'bold' });
  assert.equal(imageStudioState(loaded.layers[0], { available: true }).lookChanged, false, 'an old layer needs no new redraw');
  for (const style of STYLES) {
    const p = projectWith({ ...IMAGE_LAYER, ...redrawLookFields(LOOKS[style]) });
    assert.equal(redrawStyleForLook(redrawLookOf(validateProject(p).layers[0])), style);
  }
  assert.throws(() => validateProject(projectWith({ ...IMAGE_LAYER, redrawMode: 'grey' })), /invalid 'redrawMode': expected one of colour, bw/);
  assert.throws(() => validateProject(projectWith({ ...IMAGE_LAYER, redrawMode: 'bw', redrawBwStyle: 'stencil' })), /invalid 'redrawBwStyle': expected one of bold, shaded/);
  // The service answers only known colours, so a Black & white layout's Jet and Crystal stones validate as any.
  validateProject(projectWith({ ...IMAGE_LAYER, fillMode: 'ai-layout', ...redrawLookFields(LOOKS.bold), aiLayout: { version: 1, widthMm: FAKE_LAYOUT_BW.widthMm, heightMm: FAKE_LAYOUT_BW.heightMm, stones: FAKE_LAYOUT_BW.stones, report: {}, editCount: 0 } }));
});

// ---- 11-12. Every product and look, from app.js to the request ------------------------------------

function makeBuffer(widthPx, heightPx, pixel) {
  const data = new Uint8ClampedArray(widthPx * heightPx * 4);
  for (let y = 0; y < heightPx; y++) for (let x = 0; x < widthPx; x++) data.set(pixel(x, y), (y * widthPx + x) * 4);
  return { widthPx, heightPx, data };
}
const WIDE = makeBuffer(400, 100, (x, y) => (x >= 300 && x < 330 && y >= 40 && y < 60 ? [180, 120, 90, 255] : [0, 0, 0, 0]));
const DISC = makeBuffer(64, 64, (x, y) => (Math.hypot(x + 0.5 - 32, y + 0.5 - 32) <= 24 ? [20, 20, 20, 255] : [0, 0, 0, 0]));
const SOURCES = new Map([[`${PNG_PREFIX}WIDE`, WIDE], [FAKE_REDRAW_DATA_URL, DISC]]);
const decodeImage = (u) => {
  if (!SOURCES.has(u)) throw new Error(`no fixture for ${u.slice(0, 40)}`);
  return SOURCES.get(u);
};

// The browser's fetch, answered in-process by the real handler.
function bridge(handler) {
  return async (url, init = {}) => {
    if (url === '/api/redraw/config') return new Response(JSON.stringify({ providerId: 'openai-proxy', costLabel: '' }), { status: 200 });
    const res = makeRes();
    if (url === '/api/redraw' && init.method === 'POST') await handler.handleRedraw(makeReq({ body: init.body }), res);
    else await handler.handleJob(makeReq({ method: init.method }), res, decodeURIComponent(url.slice('/api/redraw/'.length)));
    return new Response(res.statusCode === 204 ? null : res.body, { status: res.statusCode });
  };
}

// app.js's startImageRedraw() with the real redrawImage() (client, proxy provider, server handler) and
// the real look helpers, on a layer with the given look.
async function runApp(product, handler, look) {
  const posts = [];
  const viaBridge = bridge(handler);
  configureRedraw({
    fetch: async (url, init) => { if (init && init.method === 'POST') posts.push(JSON.parse(init.body)); return viaBridge(url, init); },
    decodeImage, encodePng: () => FAKE_REDRAW_DATA_URL, wait: async () => {}
  });
  setRedrawAccessCode('letmein');
  const state = { statuses: [], project: { canvas: { width: 300, height: 300 }, layers: [{ ...JSON.parse(JSON.stringify(IMAGE_LAYER)), ...redrawLookFields(look) }] } };
  const deps = {
    redrawAvailability: { available: true, consent: null },
    selectedLayer: () => state.project.layers[0],
    askRedrawConsent: async () => true,
    setImageRedrawStatus: (text) => state.statuses.push(text),
    el: () => ({}),
    syncImageRedrawControls: () => {},
    redrawImage,
    REDRAW_STAGE_MESSAGES,
    redrawLookOf, redrawStyleForLook,
    decodeDataUrlToBuffer: async (u) => decodeImage(u),
    project: state.project,
    aiStoneDetectionFor: () => ({ ok: false }),
    resolveAiStoneShrink: () => 1,
    currentObjectTemplate: () => ({ id: product }),
    fitAiLayoutCanvas,
    SHEET_MAX_MM,
    fitAiStoneBox: () => ({ canvas: null }),
    commitHistory: () => {},
    applyRedraw: (current, r, options) => applyRedraw(current, r, { ...options, now: () => Date.UTC(2026, 10, 2) }),
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
  return { state, posts, layer: state.project.layers[0] };
}

await test('11. fake mode runs end to end in all three looks on every product: the style is posted, the layer records it, Black & white layers hold only Jet and Crystal', async () => {
  assert.deepEqual([...OBJECT_TEMPLATE_IDS].sort(), ['bottle', 'mug', 'plate', 'sheet', 'tumbler']);
  for (const product of OBJECT_TEMPLATE_IDS) {
    for (const style of STYLES) {
      const name = `${product} ${style}`;
      const { fetch, calls } = upstream();
      const { state, posts, layer } = await runApp(product, handlerFor(FAKE_ENV, fetch), LOOKS[style]);
      assert.equal(calls.openAi.length + calls.layout.length, 0, `${name}: no upstream call`);
      assert.deepEqual(posts, [{ image: FAKE_REDRAW_DATA_URL, style, shape: product === 'sheet' ? 'auto' : 'square' }], name);
      assert.equal(layer.fillMode, 'ai-layout', name);
      assert.equal(layer.redraw.style, style, name);
      assert.equal(layer.redraw.promptVersion, PROMPT_VERSIONS[style], name);
      assert.equal(layer.redraw.model, 'fake');
      const colours = new Set(layer.aiLayout.stones.map((t) => t[3]));
      if (style === 'stones') assert.ok(colours.has('gold'), `${name}: colour`);
      else assert.deepEqual(colours, new Set(BW_COLOR_IDS), `${name}: Jet and Crystal only`);
      assert.equal(imageStudioState(layer, { available: true }).lookChanged, false, `${name}: made in its own look`);
      assert.equal(state.statuses.at(-1), `Placed ${FAKE_LAYOUT.stones.length} stones. Gap check: 0 violations.`, name);
    }
  }
});

await test('12. with a provider, every product and look: the prompt and size of build N, and the layout call carries the mode and the Black & white palette', async () => {
  for (const product of OBJECT_TEMPLATE_IDS) {
    for (const style of STYLES) {
      const name = `${product} ${style}`;
      const shape = product === 'sheet' ? 'auto' : 'square';
      const { fetch, calls } = upstream(style === 'stones' ? FAKE_LAYOUT : FAKE_LAYOUT_BW);
      const { layer } = await runApp(product, handlerFor(KEY_ENV, fetch), LOOKS[style]);
      assert.equal(calls.openAi.length, 1, `${name}: one provider call`);
      const prompt = calls.openAi[0].body.get('prompt');
      assert.equal(prompt, buildRedrawPrompt(undefined, style, shape), name);
      assert.equal(calls.openAi[0].body.get('size'), shape === 'auto' ? 'auto' : '1024x1024', name);
      assert.equal(prompt.includes(SKIN_RULE), style === 'stones', `${name}: skin lines only in Colour`);
      const options = JSON.parse(calls.layout[0].body.get('options'));
      assert.deepEqual([options.mode, options.colorIds.length], style === 'stones' ? ['colour', 47] : ['bw', 2], name);
      if (style !== 'stones') assert.deepEqual(options.colorIds, ['jet', 'crystal-clear']);
      assert.equal(layer.redraw.style, style);
    }
  }
});

// ---- 13-15. app.js and index.html ---------------------------------------------------------------

await test('13. index.html: the Look choice sits above the file button, hidden until a provider is known, with Colour first and the two styles with their lines', () => {
  const open = indexHtml.indexOf('<fieldset id="imageRedrawLook" class="image-redraw-look" hidden>');
  const close = indexHtml.indexOf('</fieldset>', open);
  assert.ok(open !== -1 && close > open);
  assert.ok(open < indexHtml.indexOf('id="importImage"'), 'above Choose image file');
  const box = indexHtml.slice(open, close);
  const radios = [...box.matchAll(/<input type="radio" name="(\w+)" value="(\w+)"( checked)?>([^<]*)/g)].map((m) => [m[1], m[2], Boolean(m[3])]);
  assert.deepEqual(radios, [['imageRedrawMode', 'colour', true], ['imageRedrawMode', 'bw', false], ['imageRedrawBwStyle', 'bold', true], ['imageRedrawBwStyle', 'shaded', false]]);
  assert.ok(box.includes('>Colour</label>') && box.includes('>Black &amp; white</label>'));
  assert.ok(box.includes('<span>Bold<span class="hint">Solid black and clear areas: strong and graphic.</span></span>'));
  assert.ok(box.includes('<span>Shaded<span class="hint">Black and clear stones mixed to show light and shade.</span></span>'));
  assert.ok(box.includes('<div id="imageRedrawBwStyles" class="look-styles" hidden>'));
  assert.ok(box.includes('<p class="hint" id="imageRedrawLookHint" hidden>'));
  // [hidden] must come after the look's display rules, or .look-styles{display:flex} keeps the styles shown.
  const hiddenRule = indexHtml.indexOf('.image-redraw-look[hidden],.image-redraw-look [hidden]{display:none}');
  assert.ok(hiddenRule !== -1);
  for (const rule of ['.image-redraw-look{', '.image-redraw-look label{', '.image-redraw-look .look-modes{', '.image-redraw-look .look-styles{']) {
    assert.ok(indexHtml.indexOf(rule) !== -1 && indexHtml.indexOf(rule) < hiddenRule, `${rule} comes before the [hidden] rule`);
  }
});

await test('14. app.js: the choice shows the layer\'s look (or the remembered one), writes a change to the layer in one history step, and remembers it for the next upload', () => {
  const inputs = [['imageRedrawMode', 'colour'], ['imageRedrawMode', 'bw'], ['imageRedrawBwStyle', 'bold'], ['imageRedrawBwStyle', 'shaded']].map(([name, value]) => ({ name, value, checked: false, disabled: false }));
  const els = { imageRedrawLook: { hidden: true, querySelectorAll: () => inputs, querySelector: (q) => inputs.find((i) => q === `input[name="${i.name}"]:checked` && i.checked) || null }, imageRedrawBwStyles: { hidden: true }, imageRedrawLookHint: { hidden: true } };
  const el = (id) => els[id];
  let remembered = { mode: 'colour', bwStyle: 'shaded' };
  const sync = new Function('el', 'redrawLookOf', 'loadRedrawLook', `return ${extractFunction('function syncImageRedrawLook(l,state,busy){')};`)(el, redrawLookOf, () => remembered);
  const checked = () => inputs.filter((i) => i.checked).map((i) => i.value);

  sync(null, { look: true, lookChanged: false }, false);
  assert.deepEqual(checked(), ['colour', 'shaded'], 'no layer: the remembered look');
  assert.equal(els.imageRedrawLook.hidden, false);
  assert.equal(els.imageRedrawBwStyles.hidden, true, 'the styles only for Black & white');
  const layer = { id: 'image1', type: 'image', redrawMode: 'bw', redrawBwStyle: 'bold', redraw: { originalImageSrc: 'data:image/png;base64,AA', style: 'stones' }, fillMode: 'ai-layout' };
  sync(layer, imageStudioState(layer, { available: true }), true);
  assert.deepEqual(checked(), ['bw', 'bold'], 'the layer\'s look');
  assert.equal(els.imageRedrawBwStyles.hidden, false);
  assert.equal(els.imageRedrawLookHint.hidden, false, 'made in another look');
  assert.ok(inputs.every((i) => i.disabled), 'disabled while a redraw runs');
  sync({ id: 'old', type: 'image' }, { look: false, lookChanged: false }, false);
  assert.deepEqual(checked(), ['colour', 'bold'], 'an old layer is Colour');
  assert.equal(els.imageRedrawLook.hidden, true, 'hidden without a provider');

  const log = [];
  const project = { layers: [{ id: 'image1', type: 'image', redrawMode: 'colour' }] };
  let selected = project.layers[0], redrawRun = null;
  const change = new Function('el', 'redrawLookOf', 'redrawLookFields', 'saveRedrawLook', 'selectedLayer', 'getRedrawRun', 'commitHistory', 'updateHistoryUI', 'scheduleAutosave', 'syncImageRedrawControlsForSelection',
    `return ${extractFunction('function onRedrawLookChange(){').replace('!redrawRun', '!getRedrawRun()')};`)(
    el, redrawLookOf, redrawLookFields, (look) => { remembered = look; log.push('save'); }, () => selected, () => redrawRun,
    () => log.push(`commit ${JSON.stringify(project.layers[0])}`), () => log.push('history'), () => log.push('autosave'), () => log.push('sync'));
  const pick = (mode, style) => { for (const i of inputs) i.checked = i.value === mode || i.value === style; };
  pick('bw', 'shaded');
  change();
  assert.deepEqual(project.layers[0], { id: 'image1', type: 'image', redrawMode: 'bw', redrawBwStyle: 'shaded' });
  assert.deepEqual(log, ['save', 'commit {"id":"image1","type":"image","redrawMode":"colour"}', 'history', 'autosave', 'sync'], 'one history step, taken before the change');
  assert.deepEqual(remembered, { mode: 'bw', bwStyle: 'shaded' });
  log.length = 0;
  pick('colour', 'shaded');
  change();
  assert.deepEqual(project.layers[0], { id: 'image1', type: 'image', redrawMode: 'colour' }, 'Colour stores no style');
  log.length = 0;
  change();
  assert.deepEqual(log, ['save', 'sync'], 'no change, no history step');
  pick('bw', 'bold');
  redrawRun = {};
  log.length = 0;
  change();
  assert.equal(project.layers[0].redrawMode, 'colour', 'not while a redraw runs');
  selected = { id: 'text1', type: 'text' };
  redrawRun = null;
  log.length = 0;
  change();
  assert.deepEqual(log, ['save', 'sync'], 'with no image layer selected it is only remembered');
  assert.deepEqual(remembered, { mode: 'bw', bwStyle: 'bold' });
});

await test('15. app.js: the upload gives the new layer the remembered look before its redraw starts; startImageRedraw() reads the layer\'s look; a changed look confirms before discarding edits', () => {
  const handler = appJs.match(/el\('importImageFile'\)\.addEventListener\('change',async e=>\{[\s\S]*?\n\}\);/)[0];
  const assign = 'Object.assign(layer,redrawLookFields(loadRedrawLook()));';
  assert.ok(handler.includes(assign));
  assert.ok(handler.indexOf(assign) < handler.indexOf('project.layers.push(layer);'));
  assert.ok(handler.indexOf(assign) < handler.indexOf('startImageRedraw()'));
  const load = new Function('localStorage', 'redrawLookOf', `${/const REDRAW_LOOK_STORAGE_KEY='[^']+';/.exec(appJs)[0]}\n${extractFunction('function loadRedrawLook(){')}\nreturn loadRedrawLook();`);
  assert.deepEqual(load({ getItem: () => null }, redrawLookOf), { mode: 'colour', bwStyle: 'bold' });
  assert.deepEqual(load({ getItem: (k) => (k === 'rhinestoneStudio.redrawLook' ? '{"mode":"bw","bwStyle":"shaded"}' : null) }, redrawLookOf), { mode: 'bw', bwStyle: 'shaded' });
  assert.deepEqual(load({ getItem: () => '{bad' }, redrawLookOf), { mode: 'colour', bwStyle: 'bold' });
  assert.deepEqual(load({ getItem() { throw new Error('blocked'); } }, redrawLookOf), { mode: 'colour', bwStyle: 'bold' });
  const start = extractFunction('async function startImageRedraw(){');
  assert.ok(start.includes('const style=redrawStyleForLook(redrawLookOf(layer));'));
  assert.ok(start.indexOf('const style=') < start.indexOf('redrawImage('));
  assert.ok(appJs.includes("if((state.redrawButton==='Try again'||state.lookChanged)&&edits>0&&!window.confirm(`This discards ${edits} manual edits.`))return;startImageRedraw()"));
  assert.ok(extractFunction('function syncImageRedrawControls(l){').includes('syncImageRedrawLook(l,state,busy);'));
});

await test('16. registered in the integration group and the default suite', () => {
  assertTestRegistered({ filename: 'test-img-026-black-white.mjs', group: 'integration', includedInDefault: true });
});
