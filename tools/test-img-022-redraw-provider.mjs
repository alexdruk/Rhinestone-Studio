// IMG-022 -- Redraw with AI: the server handler (server/redraw/), the client module (src/redraw/),
// the layer transform, and validateProject()'s redraw rule. See
// docs/specifications/IMG-022-RedrawProvider.md, "Tests the build must add" (T1-T12, T7b, T10b, T10c).
//
// Never touches the network (every fetch is injected), never needs OPENAI_API_KEY, never writes to
// the source tree and never runs git.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { inflateSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { STONE_COLORS } from '../src/renderer/StoneColors.js';
import { computeSubjectMask } from '../src/image/index.js';
import { PROMPT_VERSION, buildRedrawPrompt } from '../server/redraw/prompt.mjs';
import { loadRedrawEnv } from '../server/redraw/env.mjs';
import { createRedrawHandler, OPENAI_IMAGE_EDITS_URL } from '../server/redraw/handler.mjs';
import { FAKE_REDRAW_DATA_URL, createFakeRedrawProvider } from '../src/redraw/FakeRedrawProvider.js';
import { redrawImage, getRedrawAvailability, setRedrawAccessCode, configureRedraw, RedrawError, applyRedraw, restoreOriginal } from '../src/redraw/index.js';
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

const appJs = await readFile(fileURLToPath(new URL('../app.js', import.meta.url)), 'utf8');
const indexHtml = await readFile(fileURLToPath(new URL('../index.html', import.meta.url)), 'utf8');

// ---- Helpers -----------------------------------------------------------------------------------

const PNG_PREFIX = 'data:image/png;base64,';
const FAKE_B64 = FAKE_REDRAW_DATA_URL.slice(PNG_PREFIX.length);

// Minimal PNG decoder (8-bit RGBA, colour type 6, all five filter types) for checking the fixture.
function decodePng(b64) {
  const buf = Buffer.from(b64, 'base64');
  assert.ok(buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])), 'PNG signature');
  let off = 8, ihdr = null;
  const idat = [];
  while (off < buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString('ascii', off + 4, off + 8);
    const data = buf.subarray(off + 8, off + 8 + len);
    if (type === 'IHDR') ihdr = { widthPx: data.readUInt32BE(0), heightPx: data.readUInt32BE(4), bitDepth: data[8], colorType: data[9] };
    if (type === 'IDAT') idat.push(data);
    off += 12 + len;
  }
  const { widthPx, heightPx } = ihdr;
  const raw = inflateSync(Buffer.concat(idat));
  const stride = widthPx * 4;
  const out = new Uint8ClampedArray(widthPx * heightPx * 4);
  for (let y = 0; y < heightPx; y++) {
    const filter = raw[y * (stride + 1)];
    for (let i = 0; i < stride; i++) {
      const x = raw[y * (stride + 1) + 1 + i];
      const a = i >= 4 ? out[y * stride + i - 4] : 0;
      const b = y > 0 ? out[(y - 1) * stride + i] : 0;
      const c = i >= 4 && y > 0 ? out[(y - 1) * stride + i - 4] : 0;
      let v;
      if (filter === 0) v = x;
      else if (filter === 1) v = x + a;
      else if (filter === 2) v = x + b;
      else if (filter === 3) v = x + ((a + b) >> 1);
      else { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); v = x + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c); }
      out[y * stride + i] = v & 0xff;
    }
  }
  return { ...ihdr, data: out };
}

function makeBuffer(w, h, pixel) {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) data.set(pixel(x, y), (y * w + x) * 4);
  return { widthPx: w, heightPx: h, data };
}

function maskReport(buffer) {
  const { mask, route } = computeSubjectMask(buffer);
  let n = 0;
  for (const v of mask.data) n += v === 1 ? 1 : 0;
  return { route, coverage: (n / mask.data.length).toFixed(4) };
}

// T9 fixtures, exactly as the spec pins them (64 x 64, integer x and y).
const OPAQUE_ON_WHITE = makeBuffer(64, 64, (x, y) => (Math.hypot(x - 31.5, y - 31.5) <= 20 ? [20, 20, 20, 255] : [255, 255, 255, 255]));
const FAKE_FORMULA = makeBuffer(64, 64, (x, y) => (Math.hypot(x + 0.5 - 32, y + 0.5 - 32) <= 24 ? [0x14, 0x14, 0x14, 255] : [0, 0, 0, 0]));
const BLANK_TRANSPARENT = makeBuffer(64, 64, () => [0, 0, 0, 0]);
const BLANK_WHITE = makeBuffer(64, 64, () => [255, 255, 255, 255]);
const FULLY_COVERED = makeBuffer(64, 64, (x, y) => ((Math.floor(x / 3) + Math.floor(y / 3)) % 2 ? [255, 0, 0, 255] : [0, 0, 255, 255]));

const OUTPUTS = new Map([
  [`${PNG_PREFIX}OPAQUE_ON_WHITE`, OPAQUE_ON_WHITE],
  [`${PNG_PREFIX}BLANK_TRANSPARENT`, BLANK_TRANSPARENT],
  [`${PNG_PREFIX}BLANK_WHITE`, BLANK_WHITE],
  [`${PNG_PREFIX}FULLY_COVERED`, FULLY_COVERED]
]);

// decodeImage for the client module: fixture keys, the real fake PNG, or a small source image.
function fixtureDecode(dataUrl) {
  if (OUTPUTS.has(dataUrl)) return OUTPUTS.get(dataUrl);
  if (dataUrl === FAKE_REDRAW_DATA_URL) return decodePng(FAKE_B64);
  if (dataUrl === `${PNG_PREFIX}SOURCE`) return makeBuffer(40, 30, () => [200, 100, 50, 255]);
  throw new Error(`cannot decode ${dataUrl.slice(0, 40)}`);
}

function sequenceProvider(outputs) {
  const calls = [];
  return {
    calls,
    provider: {
      id: 'seq',
      consent: null,
      async redraw(args) {
        calls.push(args);
        const next = outputs[Math.min(calls.length - 1, outputs.length - 1)];
        if (next instanceof Error) throw next;
        return { dataUrl: next, model: 'seq-model', promptVersion: 1 };
      }
    }
  };
}

function makeReq({ method = 'POST', headers = {}, ip = '10.0.0.1', body = '' } = {}) {
  const req = Readable.from(body ? [Buffer.from(body)] : []);
  req.method = method;
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

const UPLOAD_BODY = JSON.stringify({ image: FAKE_REDRAW_DATA_URL });
const KEY_SETTINGS = loadRedrawEnv({ env: { OPENAI_API_KEY: 'sk-test', REDRAW_ACCESS_CODE: 'letmein' } });
const FAKE_SETTINGS = loadRedrawEnv({ env: { REDRAW_FAKE: '1', REDRAW_ACCESS_CODE: 'letmein' } });

function spyFetch(responder) {
  const calls = [];
  const fetch = async (url, init) => { calls.push({ url, init }); return responder(calls.length, url, init); };
  return { fetch, calls };
}
const okImage = () => new Response(JSON.stringify({ data: [{ b64_json: FAKE_B64 }] }), { status: 200 });
const status = (code, body = {}) => new Response(JSON.stringify(body), { status: code });
// IMG-023: handler tests that hit an OpenAI 4xx pass a logger, so the suite output stays clean.
function recordingLogger() { const lines = []; return { lines, warn: (line) => lines.push(line) }; }

async function post(handler, { code = 'letmein', ip, body = UPLOAD_BODY } = {}) {
  const res = makeRes();
  const headers = code === null ? {} : { 'x-redraw-access-code': code };
  await handler.handleRedraw(makeReq({ headers, ip, body }), res);
  return res;
}

// ---- T1. Prompt --------------------------------------------------------------------------------

await test('T1. prompt: IMG-023 "designer" text verbatim, palette line = every STONE_COLORS entry once as "Name #hex" in catalogue order, PROMPT_VERSION 2', () => {
  assert.equal(PROMPT_VERSION, 2);
  const lines = buildRedrawPrompt().split('\n');
  assert.deepEqual(lines.slice(0, -1), [
    'You are a professional designer of hot-fix rhinestone transfer templates. Design a rhinestone version of the attached image that a machine can set stone by stone.',
    'Use identical round stones in honeycomb rows, about 70 stones across. Every stone is one flat colour from the palette below, drawn as a glossy round stone with a small white highlight dot.',
    'Design choices a good template designer makes:',
    '- Simplify: fewer, larger colour areas; drop texture and fine shading that stones cannot show.',
    '- Keep what makes the subject recognisable, and exaggerate it slightly if needed.',
    '- Separate colour areas and outline the subject with one-stone-wide chains of Jet stones, with no gaps.',
    '- Use at most 8 palette colours, with strong contrast between neighbouring areas.',
    'Square image, subject fills the frame, transparent background, no shadow or glow, no text.',
    'Palette (name and hex):'
  ]);
  assert.deepEqual(lines[lines.length - 1].split(', '), Object.values(STONE_COLORS).map((c) => `${c.name} ${c.previewColor}`));
});

// ---- T2-T7b. Server handler --------------------------------------------------------------------

await test('T2. a missing or wrong access code gets 401 unauthorized, and OpenAI is never called', async () => {
  const { fetch, calls } = spyFetch(okImage);
  const handler = createRedrawHandler({ settings: KEY_SETTINGS, fetch });
  for (const code of [null, '', 'wrong', 'letmei', 'letmein!']) {
    const res = await post(handler, { code });
    assert.equal(res.statusCode, 401, `code ${code}`);
    assert.equal(res.json().code, 'unauthorized');
  }
  assert.equal(calls.length, 0);
});

await test('T3. rate limit: requests 1-20 from one IP pass, the 21st gets 429, another IP still passes, and the window slides after an hour', async () => {
  let t = 1_000_000;
  const handler = createRedrawHandler({ settings: FAKE_SETTINGS, now: () => t });
  for (let i = 1; i <= 20; i++) assert.equal((await post(handler, { ip: 'A' })).statusCode, 200, `request ${i}`);
  const blocked = await post(handler, { ip: 'A' });
  assert.equal(blocked.statusCode, 429);
  assert.equal(blocked.json().code, 'rate-limited');
  assert.equal((await post(handler, { ip: 'B' })).statusCode, 200);
  t += 3_600_001;
  assert.equal((await post(handler, { ip: 'A' })).statusCode, 200);
  // A request with a wrong code is not counted.
  const handler2 = createRedrawHandler({ settings: FAKE_SETTINGS, now: () => t });
  for (let i = 0; i < 25; i++) await post(handler2, { ip: 'C', code: 'wrong' });
  assert.equal((await post(handler2, { ip: 'C' })).statusCode, 200);
});

await test('T4. retry: 500 then 200 succeeds on the 2nd call; 500 twice is provider-failed; a fetch that never settles times out twice', async () => {
  let spy = spyFetch((n) => (n === 1 ? status(500) : okImage()));
  let res = await post(createRedrawHandler({ settings: KEY_SETTINGS, fetch: spy.fetch }));
  assert.equal(res.statusCode, 200);
  assert.equal(res.json().dataUrl, FAKE_REDRAW_DATA_URL);
  assert.equal(spy.calls.length, 2);

  spy = spyFetch(() => status(500));
  res = await post(createRedrawHandler({ settings: KEY_SETTINGS, fetch: spy.fetch }));
  assert.equal(res.statusCode, 502);
  assert.equal(res.json().code, 'provider-failed');
  assert.equal(spy.calls.length, 2);

  spy = spyFetch(() => new Promise(() => {}));
  res = await post(createRedrawHandler({ settings: KEY_SETTINGS, fetch: spy.fetch, timeoutMs: 10 }));
  assert.equal(res.statusCode, 502);
  assert.equal(res.json().code, 'provider-failed');
  assert.equal(spy.calls.length, 2);

  spy = spyFetch(() => { throw new TypeError('fetch failed'); });
  res = await post(createRedrawHandler({ settings: KEY_SETTINGS, fetch: spy.fetch }));
  assert.equal(res.statusCode, 502);
  assert.equal(spy.calls.length, 2);
});

await test('T5. the outgoing request: images/edits, Bearer key, model/quality/size/background/output_format/n/prompt and a PNG image', async () => {
  let spy = spyFetch(okImage);
  let res = await post(createRedrawHandler({ settings: KEY_SETTINGS, fetch: spy.fetch }));
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.json(), { dataUrl: FAKE_REDRAW_DATA_URL, model: 'gpt-image-2', promptVersion: 2 });
  const { url, init } = spy.calls[0];
  assert.equal(url, OPENAI_IMAGE_EDITS_URL);
  assert.equal(url, 'https://api.openai.com/v1/images/edits');
  assert.equal(init.method, 'POST');
  assert.equal(init.headers.Authorization, 'Bearer sk-test');
  const form = init.body;
  assert.ok(form instanceof FormData);
  assert.equal(form.get('model'), 'gpt-image-2');
  assert.equal(form.get('quality'), 'high');
  assert.equal(form.get('size'), '1024x1024');
  assert.equal(form.get('background'), 'transparent');
  assert.equal(form.get('output_format'), 'png');
  assert.equal(form.get('n'), '1');
  assert.equal(form.get('prompt'), buildRedrawPrompt());
  const image = form.get('image');
  assert.ok(image instanceof Blob);
  assert.equal(image.type, 'image/png');
  assert.equal(image.name, 'source.png');
  assert.ok(Buffer.from(await image.arrayBuffer()).equals(Buffer.from(FAKE_B64, 'base64')));
  assert.deepEqual([...form.keys()].sort(), ['background', 'image', 'model', 'n', 'output_format', 'prompt', 'quality', 'size']);

  spy = spyFetch(okImage);
  const custom = loadRedrawEnv({ env: { OPENAI_API_KEY: 'sk-test', REDRAW_ACCESS_CODE: 'letmein', OPENAI_IMAGE_MODEL: 'gpt-image-9', OPENAI_IMAGE_QUALITY: 'medium' } });
  res = await post(createRedrawHandler({ settings: custom, fetch: spy.fetch }));
  assert.equal(spy.calls[0].init.body.get('model'), 'gpt-image-9');
  assert.equal(spy.calls[0].init.body.get('quality'), 'medium');
  assert.equal(res.json().model, 'gpt-image-9');
});

await test('T6. status mapping: 429 -> rate-limited; 401 -> provider-failed (not unauthorized); 400 -> provider-failed with the message; 200 without a PNG -> invalid-output', async () => {
  const cases = [
    [() => status(429), 429, 'rate-limited'],
    [() => status(401, { error: { message: 'bad key' } }), 502, 'provider-failed'],
    [() => status(403), 502, 'provider-failed'],
    [() => status(400, { error: { message: 'Invalid size.' } }), 502, 'provider-failed', 'Invalid size.'],
    [() => new Response(JSON.stringify({ data: [{ b64_json: Buffer.from('not a png at all').toString('base64') }] }), { status: 200 }), 502, 'invalid-output'],
    [() => new Response(JSON.stringify({ data: [] }), { status: 200 }), 502, 'invalid-output']
  ];
  for (const [responder, httpStatus, code, message] of cases) {
    const spy = spyFetch(responder);
    const res = await post(createRedrawHandler({ settings: KEY_SETTINGS, fetch: spy.fetch, logger: recordingLogger() }));
    assert.equal(res.statusCode, httpStatus);
    assert.equal(res.json().code, code);
    if (message) assert.equal(res.json().message, message);
    assert.equal(spy.calls.length, 1, `${code} is not retried`);
  }
  // IMG-023 (D7): a safety-system refusal is retried once, then answered 422 'declined' with OpenAI's
  // message; the retry shares the two-attempt budget.
  const SAFETY = 'Your request was rejected by the safety system. request ID req_abc123';
  const safetyCases = [
    [() => status(400, { error: { message: SAFETY } }), 422, 'declined'],
    [(n) => (n === 1 ? status(400, { error: { message: SAFETY } }) : okImage()), 200, null],
    [(n) => (n === 1 ? status(500) : status(400, { error: { message: SAFETY } })), 422, 'declined'],
    [() => status(400, { error: { message: 'Rejected by our Safety System.' } }), 422, 'declined']
  ];
  for (const [responder, httpStatus, code] of safetyCases) {
    const spy = spyFetch(responder);
    const res = await post(createRedrawHandler({ settings: KEY_SETTINGS, fetch: spy.fetch, logger: recordingLogger() }));
    assert.equal(res.statusCode, httpStatus);
    if (code) assert.equal(res.json().code, code);
    if (code) assert.ok(res.json().message.toLowerCase().includes('safety system'));
    assert.equal(spy.calls.length, 2, 'two calls at most');
  }
  // Upload that is not a PNG data URL, and a malformed body.
  for (const body of [JSON.stringify({ image: 'data:image/jpeg;base64,AAAA' }), 'not json']) {
    const res = await post(createRedrawHandler({ settings: FAKE_SETTINGS }), { body });
    assert.equal(res.statusCode, 400);
    assert.equal(res.json().code, 'provider-failed');
  }
});

await test('T6b. every OpenAI 4xx is logged with its status and message, never the key or the access code; 200 and 5xx are not', async () => {
  for (const [responder, expected] of [
    [() => status(400, { error: { message: 'Invalid size.' } }), ['Redraw: OpenAI returned 400: Invalid size.']],
    [() => status(401, { error: { message: 'bad key' } }), ['Redraw: OpenAI returned 401: bad key']],
    [() => status(403), ['Redraw: OpenAI returned 403: ']],
    [() => status(429, { error: { message: 'slow down' } }), ['Redraw: OpenAI returned 429: slow down']],
    [() => status(400, { error: { message: 'safety system' } }), ['Redraw: OpenAI returned 400: safety system', 'Redraw: OpenAI returned 400: safety system']],
    [okImage, []],
    [() => status(500), []]
  ]) {
    const logger = recordingLogger();
    await post(createRedrawHandler({ settings: KEY_SETTINGS, fetch: spyFetch(responder).fetch, logger }));
    assert.deepEqual(logger.lines, expected);
    for (const line of logger.lines) assert.ok(!line.includes('sk-test') && !line.includes('letmein'));
  }
});

await test('T7. env: defaults, environment wins over the file, quotes and comments; config route 404 unless the access code and a key are set', async () => {
  const defaults = loadRedrawEnv({ env: {} });
  assert.deepEqual(defaults, { openaiApiKey: '', imageModel: 'gpt-image-2', imageQuality: 'high', accessCode: '', rateLimitPerHour: 20, costLabel: '', fake: false });
  const file = '# comment\n\nOPENAI_IMAGE_MODEL=from-file\nREDRAW_COST_LABEL="about $0.05 per image"\nREDRAW_ACCESS_CODE=\'quoted\'\nREDRAW_RATE_LIMIT_PER_HOUR=5\n';
  const merged = loadRedrawEnv({ env: { OPENAI_IMAGE_MODEL: 'from-env' }, envFileText: file });
  assert.equal(merged.imageModel, 'from-env');
  assert.equal(merged.costLabel, 'about $0.05 per image');
  assert.equal(merged.accessCode, 'quoted');
  assert.equal(merged.rateLimitPerHour, 5);

  const config = async (env) => {
    const res = makeRes();
    await createRedrawHandler({ settings: loadRedrawEnv({ env }) }).handleConfig(makeReq({ method: 'GET' }), res);
    return res;
  };
  for (const env of [{}, { OPENAI_API_KEY: 'k' }, { REDRAW_FAKE: '1' }, { OPENAI_API_KEY: 'k', REDRAW_FAKE: '1' }, { REDRAW_ACCESS_CODE: 'c' }, { REDRAW_ACCESS_CODE: 'c', REDRAW_FAKE: '0' }]) {
    const res = await config(env);
    assert.equal(res.statusCode, 404, JSON.stringify(env));
    assert.equal(res.headers['Cache-Control'], 'no-cache, no-store');
    const post404 = makeRes();
    await createRedrawHandler({ settings: loadRedrawEnv({ env }) }).handleRedraw(makeReq({ headers: { 'x-redraw-access-code': 'c' }, body: UPLOAD_BODY }), post404);
    assert.equal(post404.statusCode, 404, `POST ${JSON.stringify(env)}`);
  }
  const ok = await config({ REDRAW_ACCESS_CODE: 'c', OPENAI_API_KEY: 'k', REDRAW_COST_LABEL: 'about $0.05 per image' });
  assert.equal(ok.statusCode, 200);
  assert.deepEqual(ok.json(), { providerId: 'openai-proxy', costLabel: 'about $0.05 per image' });
});

await test('T7b. fake mode with no key: config 200, the right code gets the fixture, a wrong code 401, no fetch; fake mode also wins over a key', async () => {
  const { fetch, calls } = spyFetch(okImage);
  const handler = createRedrawHandler({ settings: FAKE_SETTINGS, fetch });
  const cfg = makeRes();
  await handler.handleConfig(makeReq({ method: 'GET' }), cfg);
  assert.equal(cfg.statusCode, 200);
  assert.deepEqual(cfg.json(), { providerId: 'openai-proxy', costLabel: '' });
  const res = await post(handler);
  assert.equal(res.statusCode, 200);
  assert.equal(res.json().dataUrl, FAKE_REDRAW_DATA_URL);
  assert.equal(res.json().model, 'fake');
  assert.equal((await post(handler, { code: 'wrong' })).statusCode, 401);
  const both = createRedrawHandler({ settings: loadRedrawEnv({ env: { REDRAW_FAKE: '1', REDRAW_ACCESS_CODE: 'letmein', OPENAI_API_KEY: 'sk-test' } }), fetch });
  assert.equal((await post(both)).json().model, 'fake');
  assert.equal(calls.length, 0);
});

await test('T4b. Cancel stops the upstream call: the client closing aborts the OpenAI fetch, with no retry and nothing written', async () => {
  const signals = [];
  const fetch = (url, init) => { signals.push(init.signal); return new Promise(() => {}); };
  // This fake fetch ignores its signal (a real fetch rejects on abort), so the short timeout only
  // lets handleRedraw() finish; the abort itself is checked before the timer can fire.
  const handler = createRedrawHandler({ settings: KEY_SETTINGS, fetch, timeoutMs: 50 });
  const res = makeRes();
  const closeListeners = [];
  res.on = (event, fn) => { if (event === 'close') closeListeners.push(fn); };
  const writes = [];
  res.writeHead = (...args) => { writes.push(['writeHead', ...args]); };
  res.end = (...args) => { writes.push(['end', ...args]); };
  const done = handler.handleRedraw(makeReq({ headers: { 'x-redraw-access-code': 'letmein' }, body: UPLOAD_BODY }), res);
  while (signals.length === 0) await new Promise((r) => setTimeout(r, 1));
  assert.equal(res.writableEnded, false);
  assert.equal(closeListeners.length, 1);
  for (const fn of closeListeners) fn();
  assert.equal(signals[0].aborted, true, 'the upstream signal is aborted as soon as the client closes');
  await done;
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(signals.length, 1, 'fetch was called once, and no second attempt followed');
  assert.equal(signals[0].aborted, true, 'the upstream signal is aborted');
  assert.deepEqual(writes, [], 'nothing was written to res');
});

// ---- T8-T9. Client module ----------------------------------------------------------------------

await test('T8. provider selection: config 404 / network error / bad body -> unavailable; good body -> the proxy provider; an injected provider is used without fetch', async () => {
  const configFetch = (responder) => async (url, init) => {
    assert.equal(url, '/api/redraw/config');
    assert.equal(init.method, 'GET');
    return responder();
  };
  for (const responder of [() => new Response('Not Found', { status: 404 }), () => { throw new TypeError('offline'); }, () => status(200, { providerId: 'other' }), () => new Response('not json', { status: 200 })]) {
    configureRedraw({ fetch: configFetch(responder) });
    assert.deepEqual(await getRedrawAvailability(), { available: false });
  }
  configureRedraw({ fetch: configFetch(() => new Response('Not Found', { status: 404 })) });
  await assert.rejects(redrawImage({ dataUrl: `${PNG_PREFIX}SOURCE` }), (e) => e instanceof RedrawError && e.code === 'not-configured');

  configureRedraw({ fetch: configFetch(() => status(200, { providerId: 'openai-proxy', costLabel: 'about $0.05 per image' })) });
  assert.deepEqual(await getRedrawAvailability(), { available: true, providerId: 'openai-proxy', consent: { recipientName: 'OpenAI', costLabel: 'about $0.05 per image', needsAccessCode: true } });

  const spy = spyFetch(() => { throw new Error('fetch must not be called'); });
  configureRedraw({ provider: createFakeRedrawProvider(), fetch: spy.fetch, decodeImage: fixtureDecode, encodePng: () => `${PNG_PREFIX}UPLOAD` });
  assert.deepEqual(await getRedrawAvailability(), { available: true, providerId: 'fake', consent: null });
  const result = await redrawImage({ dataUrl: `${PNG_PREFIX}SOURCE` });
  assert.deepEqual(result, { dataUrl: FAKE_REDRAW_DATA_URL, providerId: 'fake', model: 'fake', promptVersion: null });
  assert.equal(spy.calls.length, 0);
});

await test('T8b. the proxy provider posts the upload with the access code and maps server failures to RedrawError codes', async () => {
  const posts = [];
  const serverReplies = [status(200, { dataUrl: FAKE_REDRAW_DATA_URL, model: 'gpt-image-2', promptVersion: 1 }), status(401, { code: 'unauthorized', message: 'The access code was not accepted.' }), status(502, { code: 'provider-failed', message: 'safety system' }), new Response('Not Found', { status: 404 }), new Response('<html>', { status: 500 })];
  const fetch = async (url, init) => {
    if (url === '/api/redraw/config') return status(200, { providerId: 'openai-proxy', costLabel: '' });
    posts.push({ url, init });
    const reply = serverReplies.shift();
    return new Response(await reply.text(), { status: reply.status });
  };
  configureRedraw({ fetch, decodeImage: fixtureDecode, encodePng: () => `${PNG_PREFIX}UPLOAD` });
  setRedrawAccessCode('letmein');
  assert.equal((await redrawImage({ dataUrl: `${PNG_PREFIX}SOURCE` })).providerId, 'openai-proxy');
  assert.equal(posts[0].url, '/api/redraw');
  assert.equal(posts[0].init.headers['X-Redraw-Access-Code'], 'letmein');
  assert.equal(posts[0].init.headers['Content-Type'], 'application/json');
  assert.deepEqual(JSON.parse(posts[0].init.body), { image: `${PNG_PREFIX}UPLOAD` });
  for (const [code, detail] of [['unauthorized', 'The access code was not accepted.'], ['provider-failed', 'safety system'], ['not-configured', ''], ['provider-failed', '']]) {
    await assert.rejects(redrawImage({ dataUrl: `${PNG_PREFIX}SOURCE` }), (e) => e instanceof RedrawError && e.code === code && e.detail === detail);
  }
  configureRedraw({ fetch: async (url) => { if (url === '/api/redraw/config') return status(200, { providerId: 'openai-proxy', costLabel: '' }); throw new TypeError('offline'); }, decodeImage: fixtureDecode, encodePng: () => `${PNG_PREFIX}UPLOAD` });
  await assert.rejects(redrawImage({ dataUrl: `${PNG_PREFIX}SOURCE` }), (e) => e instanceof RedrawError && e.code === 'network');
});

await test('T8c. declined: the proxy maps 422 declined to RedrawError with the detail kept, redrawImage() does not retry it, and app.js builds the D7 message and details line', async () => {
  const MESSAGE = 'Your request was rejected by the safety system. request ID req_abc123';
  let posts = 0;
  configureRedraw({ fetch: async (url) => { if (url === '/api/redraw/config') return status(200, { providerId: 'openai-proxy', costLabel: '' }); posts++; return status(422, { code: 'declined', message: MESSAGE }); }, decodeImage: fixtureDecode, encodePng: () => `${PNG_PREFIX}UPLOAD` });
  setRedrawAccessCode('letmein');
  let caught = null;
  await redrawImage({ dataUrl: `${PNG_PREFIX}SOURCE` }).catch((e) => { caught = e; });
  assert.ok(caught instanceof RedrawError && caught.code === 'declined' && caught.detail === MESSAGE);
  assert.equal(posts, 1, 'no client retry');

  const block = appJs.slice(appJs.indexOf('const REDRAW_ERROR_MESSAGES={'), appJs.indexOf('function syncImageRedrawControls(l){'));
  const messageFn = block.slice(block.indexOf('function redrawErrorMessage(error){'));
  const detailFn = block.slice(block.indexOf('function redrawErrorDetail(error){'), block.indexOf('function redrawErrorMessage(error){'));
  const tables = block.slice(0, block.indexOf('function setImageRedrawStatus('));
  const build = (availability) => new Function('RedrawError', 'redrawAvailability', `${tables}\n${detailFn}\n${messageFn}\nreturn { redrawErrorMessage, redrawErrorDetail };`)(RedrawError, availability);
  const { redrawErrorMessage, redrawErrorDetail } = build({ consent: { recipientName: 'OpenAI' } });
  assert.equal(redrawErrorMessage(caught), 'OpenAI declined to redraw this image. This often happens with well-known cartoon characters or brands. Try again or use a different image; your design is unchanged.');
  assert.equal(redrawErrorDetail(caught), 'Details: req_abc123');
  assert.equal(redrawErrorDetail(new RedrawError('declined', 'no id here')), '');
  assert.equal(redrawErrorDetail(new RedrawError('provider-failed', 'req_zzz')), '');
  assert.ok(build(null).redrawErrorMessage(caught).startsWith('The redraw service declined to redraw this image.'));
  configureRedraw();
});

await test('T9. fixtures: routes and coverages are the pinned figures, and the fake PNG decodes to exactly the D2 formula', () => {
  assert.deepEqual(maskReport(OPAQUE_ON_WHITE), { route: 'background', coverage: '0.3086' });
  assert.deepEqual(maskReport(BLANK_TRANSPARENT), { route: 'alpha', coverage: '0.0000' });
  assert.deepEqual(maskReport(BLANK_WHITE), { route: 'background', coverage: '0.0000' });
  assert.deepEqual(maskReport(FULLY_COVERED), { route: 'background', coverage: '1.0000' });
  const fake = decodePng(FAKE_B64);
  assert.equal(fake.widthPx, 64);
  assert.equal(fake.heightPx, 64);
  assert.equal(fake.bitDepth, 8);
  assert.equal(fake.colorType, 6);
  assert.deepEqual([...fake.data], [...FAKE_FORMULA.data]);
  assert.deepEqual(maskReport(fake), { route: 'alpha', coverage: '0.4404' });
});

await test('T9. client limits: upload shrunk to 1536 px; opaque-on-white and the fake are valid; blank / fully covered / undecodable retried once then invalid-output; abort is an AbortError', async () => {
  const encoded = [];
  const big = makeBuffer(3000, 2000, () => [10, 20, 30, 255]);
  let run = sequenceProvider([`${PNG_PREFIX}OPAQUE_ON_WHITE`]);
  configureRedraw({ provider: run.provider, decodeImage: (u) => (u === `${PNG_PREFIX}BIG` ? big : fixtureDecode(u)), encodePng: (b) => { encoded.push([b.widthPx, b.heightPx]); return `${PNG_PREFIX}UPLOAD`; } });
  const ok = await redrawImage({ dataUrl: `${PNG_PREFIX}BIG` });
  assert.deepEqual(encoded, [[1536, 1024]]);
  assert.equal(run.calls[0].pngDataUrl, `${PNG_PREFIX}UPLOAD`);
  assert.deepEqual(ok, { dataUrl: `${PNG_PREFIX}OPAQUE_ON_WHITE`, providerId: 'seq', model: 'seq-model', promptVersion: 1 });
  assert.equal(run.calls.length, 1, 'opaque image on white is valid first time');

  const withOutputs = (outputs) => {
    const r = sequenceProvider(outputs);
    configureRedraw({ provider: r.provider, decodeImage: fixtureDecode, encodePng: () => `${PNG_PREFIX}UPLOAD` });
    return r;
  };
  run = withOutputs([FAKE_REDRAW_DATA_URL]);
  assert.equal((await redrawImage({ dataUrl: `${PNG_PREFIX}SOURCE` })).dataUrl, FAKE_REDRAW_DATA_URL);
  assert.equal(run.calls.length, 1);

  for (const invalid of ['BLANK_TRANSPARENT', 'BLANK_WHITE', 'FULLY_COVERED', 'UNDECODABLE']) {
    run = withOutputs([`${PNG_PREFIX}${invalid}`, `${PNG_PREFIX}OPAQUE_ON_WHITE`]);
    assert.equal((await redrawImage({ dataUrl: `${PNG_PREFIX}SOURCE` })).dataUrl, `${PNG_PREFIX}OPAQUE_ON_WHITE`, `${invalid} then valid`);
    assert.equal(run.calls.length, 2);
    run = withOutputs([`${PNG_PREFIX}${invalid}`]);
    await assert.rejects(redrawImage({ dataUrl: `${PNG_PREFIX}SOURCE` }), (e) => e instanceof RedrawError && e.code === 'invalid-output', `${invalid} twice`);
    assert.equal(run.calls.length, 2);
  }

  // A provider-reported invalid-output also gets the one retry; any other code does not.
  const invalidErr = Object.assign(new Error('x'), { code: 'invalid-output' });
  run = withOutputs([invalidErr, `${PNG_PREFIX}OPAQUE_ON_WHITE`]);
  await redrawImage({ dataUrl: `${PNG_PREFIX}SOURCE` });
  assert.equal(run.calls.length, 2);
  run = withOutputs([Object.assign(new Error('x'), { code: 'rate-limited' })]);
  await assert.rejects(redrawImage({ dataUrl: `${PNG_PREFIX}SOURCE` }), (e) => e.code === 'rate-limited');
  assert.equal(run.calls.length, 1);

  let started;
  const startedPromise = new Promise((resolve) => { started = resolve; });
  configureRedraw({ provider: { id: 'hang', consent: null, redraw: () => { started(); return new Promise(() => {}); } }, decodeImage: fixtureDecode, encodePng: () => `${PNG_PREFIX}UPLOAD` });
  const controller = new AbortController();
  const pending = redrawImage({ dataUrl: `${PNG_PREFIX}SOURCE`, signal: controller.signal });
  await startedPromise;
  controller.abort();
  await assert.rejects(pending, (e) => e.name === 'AbortError' && !(e instanceof RedrawError));
  configureRedraw();
});

// ---- T10-T10c. Layer transform ------------------------------------------------------------------

const NOW = () => Date.UTC(2026, 8, 25, 12, 0, 0);
const CANVAS = { width: 300, height: 250 };
const RESULT = { dataUrl: `${PNG_PREFIX}NEW`, providerId: 'openai-proxy', model: 'gpt-image-2', promptVersion: 1 };
const SIZE = { naturalWidthPx: 1024, naturalHeightPx: 1024 };
function baseLayer(overrides = {}) {
  return { id: 'image1', type: 'image', visible: true, imageSrc: `${PNG_PREFIX}ORIG`, imageName: 'photo.jpg', naturalWidthPx: 4000, naturalHeightPx: 3000, x: 20, y: 30, w: 200, h: 150, maskMode: 'subject', threshold: 128, stoneSize: 2, gap: 0.3, colorCount: 'auto', vividness: 1.4, rotationDeg: 15, fillMode: 'staggered', invert: false, transparent: 'ignore', blurRadiusPx: 0, maxWidthPx: 400, maxHeightPx: 400, ...overrides };
}

await test('T10. applyRedraw sets exactly the D9 fields; a second redraw keeps original*/previous*; Use original restores everything exactly', () => {
  const layer = baseLayer();
  const frozen = JSON.stringify(layer);
  const out = applyRedraw(layer, RESULT, { canvas: CANVAS, ...SIZE, now: NOW });
  assert.equal(JSON.stringify(layer), frozen, 'input not mutated');
  assert.equal(out.imageSrc, `${PNG_PREFIX}NEW`);
  assert.equal(out.imageName, 'photo.jpg (AI redraw)');
  assert.equal(out.vividness, 1);
  assert.equal(out.naturalWidthPx, 1024);
  assert.equal(out.naturalHeightPx, 1024);
  assert.deepEqual([out.x, out.y, out.w, out.h], [40, 25, 160, 160]);
  assert.deepEqual([out.x + out.w / 2, out.y + out.h / 2], [120, 105]);
  assert.deepEqual(out.redraw, {
    originalImageSrc: `${PNG_PREFIX}ORIG`, originalImageName: 'photo.jpg', previousVividness: 1.4, previousW: 200, previousH: 150,
    previousNaturalWidthPx: 4000, previousNaturalHeightPx: 3000, previousX: 20, previousY: 30, appliedX: 40, appliedY: 25,
    providerId: 'openai-proxy', model: 'gpt-image-2', promptVersion: 1, createdAt: '2026-09-25T12:00:00.000Z'
  });
  const changed = new Set(['imageSrc', 'imageName', 'vividness', 'naturalWidthPx', 'naturalHeightPx', 'x', 'y', 'w', 'h', 'redraw']);
  for (const key of Object.keys(layer)) if (!changed.has(key)) assert.deepEqual(out[key], layer[key], key);
  assert.deepEqual(Object.keys(out).filter((k) => !(k in layer)), ['redraw']);

  const small = applyRedraw(layer, RESULT, { canvas: { width: 100, height: 100 }, ...SIZE, now: NOW });
  assert.deepEqual([small.x, small.y, small.w, small.h], [20, 20, 80, 80]);

  const moved = { ...out, x: 60, y: 45 };
  const second = applyRedraw(moved, { dataUrl: `${PNG_PREFIX}NEW2`, providerId: 'fake', model: 'fake', promptVersion: null }, { canvas: CANVAS, ...SIZE, now: () => NOW() + 1000 });
  assert.equal(second.imageName, 'photo.jpg (AI redraw)');
  assert.deepEqual(second.redraw, {
    originalImageSrc: `${PNG_PREFIX}ORIG`, originalImageName: 'photo.jpg', previousVividness: 1.4, previousW: 200, previousH: 150,
    previousNaturalWidthPx: 4000, previousNaturalHeightPx: 3000, previousX: 20, previousY: 30, appliedX: 60, appliedY: 45,
    providerId: 'fake', model: 'fake', promptVersion: null, createdAt: '2026-09-25T12:00:01.000Z'
  });

  for (const redrawn of [out, second]) {
    const restored = restoreOriginal(redrawn);
    assert.equal(JSON.stringify(restored), frozen, 'Use original gives back the exact layer, key order included');
    assert.equal('redraw' in restored, false);
  }
  // A layer that predates a field (no vividness key) gets no `vividness: undefined` back.
  const noVividness = baseLayer();
  delete noVividness.vividness;
  const back = restoreOriginal(applyRedraw(noVividness, RESULT, { canvas: CANVAS, ...SIZE, now: NOW }));
  assert.equal('vividness' in back, false);
  assert.equal(JSON.stringify(back), JSON.stringify(noVividness));
});

await test('T10b. a small image touching the canvas edge: shifted inside without rescaling, and Use original restores it exactly', () => {
  const topLeft = baseLayer({ x: 0, y: 0, w: 40, h: 30 });
  const a = applyRedraw(topLeft, RESULT, { canvas: CANVAS, ...SIZE, now: NOW });
  assert.deepEqual([a.x, a.y, a.w, a.h], [0, 0, 160, 160]);
  assert.deepEqual([a.redraw.appliedX, a.redraw.appliedY], [0, 0]);
  const bottomRight = baseLayer({ x: 260, y: 220, w: 40, h: 30 });
  const b = applyRedraw(bottomRight, RESULT, { canvas: CANVAS, ...SIZE, now: NOW });
  assert.deepEqual([b.x, b.y, b.w, b.h], [140, 90, 160, 160]);
  assert.deepEqual([b.redraw.appliedX, b.redraw.appliedY], [140, 90]);
  for (const l of [a, b]) {
    assert.ok(l.x >= 0 && l.x + l.w <= 300 && l.y >= 0 && l.y + l.h <= 250);
  }
  const ra = restoreOriginal(a);
  assert.deepEqual([ra.x, ra.y, ra.w, ra.h], [0, 0, 40, 30]);
  const rb = restoreOriginal(b);
  assert.deepEqual([rb.x, rb.y, rb.w, rb.h], [260, 220, 40, 30]);
  const nudged = restoreOriginal({ ...a, x: 1e-10 });
  assert.deepEqual([nudged.x, nudged.y], [0, 0], 'within 1e-9 mm counts as unmoved');
});

await test('T10c. moved after the redraw: Use original recentres on the moved box', () => {
  const a = applyRedraw(baseLayer({ x: 0, y: 0, w: 40, h: 30 }), RESULT, { canvas: CANVAS, ...SIZE, now: NOW });
  const r1 = restoreOriginal({ ...a, x: 50, y: 40 });
  assert.deepEqual([r1.x, r1.y, r1.w, r1.h], [110, 105, 40, 30]);
  const r2 = restoreOriginal({ ...a, x: 50, y: 0 });
  assert.deepEqual([r2.x, r2.y], [110, 65]);
  const noApplied = { ...a, redraw: { ...a.redraw } };
  delete noApplied.redraw.appliedX;
  const r3 = restoreOriginal(noApplied);
  assert.deepEqual([r3.x, r3.y], [60, 65], 'a record without appliedX recentres');
});

// ---- T11. validateProject() round trip -----------------------------------------------------------

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
    `${source}\nreturn { validateProject, defaultProject };`
  )(getObjectTemplate, SHAPE_LIBRARY_KINDS, getPlateDefaults, normalizePlateParams, VESSEL_PRODUCT_IDS, getVesselDefaults, normalizeVesselParams, deriveLegacyVesselParams, computeCanvasFromVessel);
}

await test('T10d. with an AI stone pitch the redraw becomes an AI stones layer sized per IMG-023 D2; Use original restores fillMode exactly', () => {
  const layer = baseLayer();
  const frozen = JSON.stringify(layer);
  const W0 = 1024 * 2.3 / 11.467;
  const out = applyRedraw(layer, RESULT, { canvas: { width: 1000, height: 1000 }, ...SIZE, now: NOW, aiPitchPx: 11.467 });
  assert.equal(out.fillMode, 'ai-stones');
  assert.ok(Math.abs(out.w - W0) < 1e-9 && Math.abs(out.h - W0) < 1e-9);
  assert.equal(out.redraw.previousFillMode, 'staggered');
  assert.ok(!('aiStoneShrink' in out), 'applyRedraw writes no aiStoneShrink');
  assert.equal(JSON.stringify(restoreOriginal(out)), frozen);
  const small = applyRedraw(layer, RESULT, { canvas: { width: 200, height: 200 }, ...SIZE, now: NOW, aiPitchPx: 11.467 });
  assert.ok(Math.abs(small.w - 180) < 1e-9, 'fitted to the canvas minus 20 mm');
  const shrunk = applyRedraw(layer, RESULT, { canvas: { width: 1000, height: 1000 }, ...SIZE, now: NOW, aiPitchPx: 11.467, shrink: 0.8 });
  assert.ok(Math.abs(shrunk.w - W0 * 0.8) < 1e-9);

  const noMode = baseLayer();
  delete noMode.fillMode;
  const a = applyRedraw(noMode, RESULT, { canvas: CANVAS, ...SIZE, now: NOW, aiPitchPx: 11.467 });
  assert.equal(a.redraw.previousFillMode, null);
  const back = restoreOriginal(JSON.parse(JSON.stringify(a)));
  assert.ok(!('fillMode' in back));
  assert.equal(JSON.stringify(back), JSON.stringify(noMode));

  const second = applyRedraw({ ...out, fillMode: 'edge' }, RESULT, { canvas: CANVAS, ...SIZE, now: NOW, aiPitchPx: 11.467 });
  assert.equal(second.redraw.previousFillMode, 'staggered', 'a second redraw keeps the first previousFillMode');
  const fallback = applyRedraw(out, RESULT, { canvas: CANVAS, ...SIZE, now: NOW });
  assert.equal(fallback.fillMode, 'ai-stones', 'without a pitch fillMode is left as it is');
  assert.equal(fallback.redraw.previousFillMode, 'staggered');
  assert.equal(restoreOriginal(fallback).fillMode, 'staggered');
});

await test('T11. a project without redraw round-trips byte-identical; Use original round-trips too; validateProject() accepts a good redraw and rejects bad ones', async () => {
  const { validateProject, defaultProject } = await extractProjectFunctions();
  const withImage = (layer) => ({ ...defaultProject(), layers: [...defaultProject().layers, layer] });
  const p0 = validateProject(withImage(baseLayer()));
  const p1 = validateProject(JSON.parse(JSON.stringify(p0)));
  assert.equal(JSON.stringify(p1), JSON.stringify(p0));
  assert.ok(p1.layers.every((l) => !('redraw' in l)));

  const imageIndex = p0.layers.findIndex((l) => l.type === 'image');
  const redrawn = { ...p0, layers: p0.layers.map((l, i) => (i === imageIndex ? applyRedraw(l, RESULT, { canvas: p0.canvas, ...SIZE, now: NOW }) : l)) };
  const reopened = validateProject(JSON.parse(JSON.stringify(redrawn)));
  assert.deepEqual(reopened.layers[imageIndex].redraw, redrawn.layers[imageIndex].redraw, 'the redraw record survives save and reopen');
  const restored = { ...reopened, layers: reopened.layers.map((l, i) => (i === imageIndex ? restoreOriginal(l) : l)) };
  assert.equal(JSON.stringify(validateProject(JSON.parse(JSON.stringify(restored)))), JSON.stringify(p0));

  const good = validateProject(withImage(baseLayer({ redraw: { originalImageSrc: 'data:image/png;base64,AAAA' } })));
  assert.deepEqual(good.layers[good.layers.length - 1].redraw, { originalImageSrc: 'data:image/png;base64,AAAA' });
  for (const redraw of [{ originalImageSrc: '' }, { originalImageSrc: 'https://x/y.png' }, {}, 'x', null, [], { originalImageSrc: 42 }]) {
    assert.throws(() => validateProject(withImage(baseLayer({ redraw }))), { message: 'Image layer "image1" has an invalid \'redraw\' record: originalImageSrc must be a data:image/ URL.' }, JSON.stringify(redraw));
  }
});

// ---- T12. Wiring -------------------------------------------------------------------------------

await test('T12. app.js imports ./src/redraw/index.js and never names OpenAI or a provider file; index.html has the D11/D8 ids', () => {
  assert.match(appJs, /^import \{[^}]*\} from '\.\/src\/redraw\/index\.js';$/m);
  for (const forbidden of ['OpenAI', 'OpenAiProxyProvider', 'FakeRedrawProvider']) assert.ok(!appJs.includes(forbidden), `app.js contains ${forbidden}`);
  for (const id of ['imageRedraw', 'imageRedrawCancel', 'imageRedrawUseOriginal', 'imageRedrawStatus', 'lightboxRedrawConsent', 'redrawConsentRecipient', 'redrawConsentCost', 'redrawAccessCode', 'redrawConsentContinue']) {
    assert.ok(indexHtml.includes(`id="${id}"`), `index.html is missing #${id}`);
  }
  assert.ok(appJs.includes("const REDRAW_ACCESS_CODE_STORAGE_KEY='rhinestoneStudio.redrawAccessCode';"));
  // Double-click guard: a click while the consent dialog is open returns before anything else.
  assert.ok(appJs.includes("async function startImageRedraw(){\n  // A second click while the consent dialog is open would open a second consent wait; ignore it.\n  if(redrawConsentResolve!==null)return;\n"), 'startImageRedraw() returns first thing while the consent dialog is open');
});

await test('Registered in tools/test-groups.mjs', () => {
  assertTestRegistered({ filename: 'test-img-022-redraw-provider.mjs', group: 'integration', includedInDefault: true });
});
