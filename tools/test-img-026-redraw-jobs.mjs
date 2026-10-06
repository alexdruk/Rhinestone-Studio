// IMG-026 build B -- redraw jobs: POST /api/redraw starts a job (202 { jobId }), GET and DELETE
// /api/redraw/:jobId poll and cancel it, the job calls OpenAI and then the layout service, and the
// browser provider polls the job. See docs/specifications/IMG-026-StrassLayoutService.md, "Node jobs,
// prompt and colours (build B)" and "Tests the builds must add" (B).
//
// Never touches the network (every fetch is injected) and never waits on real time: now and the
// server timers come from a virtual clock, and the client's wait between polls is injected.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { STONE_COLORS } from '../src/renderer/StoneColors.js';
import { getStoneSize } from '../src/renderer/StoneSizes.js';
import { loadRedrawEnv } from '../server/redraw/env.mjs';
import { createRedrawHandler, OPENAI_IMAGE_EDITS_URL, FAKE_LAYOUT } from '../server/redraw/handler.mjs';
import { JOB_ORPHAN_MS, JOB_KEEP_MS, MAX_JOBS } from '../server/redraw/jobs.mjs';
import { buildRedrawPrompt } from '../server/redraw/prompt.mjs';
import { FAKE_REDRAW_DATA_URL } from '../src/redraw/FakeRedrawProvider.js';
import { createOpenAiProxyProvider, REDRAW_POLL_INTERVAL_MS } from '../src/redraw/OpenAiProxyProvider.js';
import { redrawImage, configureRedraw, setRedrawAccessCode, RedrawError, REDRAW_ERROR_CODES } from '../src/redraw/index.js';
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
const devServer = await readFile(repo('tools/dev-server.mjs'), 'utf8');
const envExample = await readFile(repo('.env.example'), 'utf8');
const fixtureText = await readFile(repo('server/redraw/fixtures/fake-layout.json'), 'utf8');

// ---- Helpers -----------------------------------------------------------------------------------

const PNG_PREFIX = 'data:image/png;base64,';
const FAKE_B64 = FAKE_REDRAW_DATA_URL.slice(PNG_PREFIX.length);
const UPLOAD_BODY = JSON.stringify({ image: FAKE_REDRAW_DATA_URL });
const LAYOUT_BASE = 'http://layout.test:8000';
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

const flush = async () => { for (let i = 0; i < 40; i++) await new Promise((r) => setImmediate(r)); };

// A virtual clock: now() and setTimeout/clearTimeout that fire only inside advance().
function createClock(start = 1_000_000) {
  let t = start;
  let nextId = 1;
  const pending = new Map();
  return {
    now: () => t,
    timers: {
      setTimeout(fn, ms) { const id = nextId++; pending.set(id, { at: t + ms, fn }); return id; },
      clearTimeout(id) { pending.delete(id); }
    },
    async advance(ms) {
      const end = t + ms;
      for (;;) {
        let next = null;
        for (const [id, p] of pending) if (p.at <= end && (!next || p.at < next[1].at)) next = [id, p];
        if (!next) break;
        pending.delete(next[0]);
        t = next[1].at;
        next[1].fn();
        await flush();
      }
      t = end;
      await flush();
    }
  };
}

function deferred() {
  let resolve, reject;
  const promise = new Promise((a, b) => { resolve = a; reject = b; });
  return { promise, resolve, reject };
}

// Like a real fetch, rejects with an AbortError when its signal aborts -- on a later turn, as
// Node's fetch does, not inside the abort() call.
function abortable(promise, signal) {
  if (!signal) return promise;
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(new DOMException('aborted', 'AbortError'));
    signal.addEventListener('abort', () => setImmediate(() => reject(new DOMException('aborted', 'AbortError'))), { once: true });
    promise.then(resolve, reject);
  });
}

// Routes OpenAI calls and layout calls to their own responders; records both.
function router({ openAi = () => okImage(), layout = () => okLayout() } = {}) {
  const calls = { openAi: [], layout: [] };
  const fetch = (url, init) => {
    if (url === OPENAI_IMAGE_EDITS_URL) { calls.openAi.push({ url, init }); return abortable(Promise.resolve().then(() => openAi(calls.openAi.length, init)), init.signal); }
    calls.layout.push({ url, init });
    return abortable(Promise.resolve().then(() => layout(calls.layout.length, init)), init.signal);
  };
  return { fetch, calls };
}

const okImage = () => new Response(JSON.stringify({ data: [{ b64_json: FAKE_B64 }] }), { status: 200 });
const okLayout = () => new Response(JSON.stringify(FAKE_LAYOUT), { status: 200 });
const status = (code, body = {}) => new Response(JSON.stringify(body), { status: code });
const quietLogger = { warn() {} };

function makeHandler({ env = {}, fetch, clock = createClock(), ...rest } = {}) {
  const settings = loadRedrawEnv({ env: { OPENAI_API_KEY: 'sk-test', REDRAW_ACCESS_CODE: 'letmein', LAYOUT_SERVICE_URL: LAYOUT_BASE, ...env } });
  return { handler: createRedrawHandler({ settings, fetch, now: clock.now, timers: clock.timers, logger: quietLogger, ...rest }), clock };
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
    writeHead(s, headers) { this.statusCode = s; this.headers = headers; this.headersSent = true; },
    end(chunk = '') { this.body += chunk; this.writableEnded = true; },
    on() {},
    json() { return JSON.parse(this.body); }
  };
}

const headersFor = (code) => (code === null ? {} : { 'x-redraw-access-code': code });

async function post(handler, { code = 'letmein', ip, body = UPLOAD_BODY } = {}) {
  const res = makeRes();
  await handler.handleRedraw(makeReq({ headers: headersFor(code), ip, body }), res);
  return res;
}

async function poll(handler, jobId, { code = 'letmein', method = 'GET', ip } = {}) {
  const res = makeRes();
  await handler.handleJob(makeReq({ method, headers: headersFor(code), ip }), res, jobId);
  return res;
}

async function start(handler, opts) {
  const res = await post(handler, opts);
  assert.equal(res.statusCode, 202, res.body);
  return res.json().jobId;
}

const DONE_RESULT = { dataUrl: FAKE_REDRAW_DATA_URL, model: 'gpt-image-2.5-sunburst', promptVersion: 3 };

// ---- Job stages ---------------------------------------------------------------------------------

await test('1. stages: POST answers 202 { jobId } (a UUID) at once; GET shows drawing during OpenAI, placing during the layout, then done with { dataUrl, model, promptVersion, layout }', async () => {
  const openAi = deferred();
  const layout = deferred();
  const { fetch, calls } = router({ openAi: () => openAi.promise, layout: () => layout.promise });
  const { handler } = makeHandler({ fetch });
  const res = await post(handler);
  assert.equal(res.statusCode, 202);
  assert.deepEqual(Object.keys(res.json()), ['jobId']);
  const { jobId } = res.json();
  assert.match(jobId, UUID_PATTERN);
  assert.equal(res.headers['Cache-Control'], 'no-cache, no-store');
  await flush();
  assert.deepEqual((await poll(handler, jobId)).json(), { stage: 'drawing' });
  openAi.resolve(okImage());
  await flush();
  assert.deepEqual((await poll(handler, jobId)).json(), { stage: 'placing' });
  assert.equal(calls.layout.length, 1);
  layout.resolve(okLayout());
  await flush();
  const done = await poll(handler, jobId);
  assert.equal(done.statusCode, 200);
  assert.deepEqual(done.json(), { stage: 'done', result: { ...DONE_RESULT, layout: FAKE_LAYOUT } });
  assert.deepEqual(Object.keys(done.json().result), ['dataUrl', 'model', 'promptVersion', 'layout']);
  assert.equal(calls.openAi.length, 1);
  assert.equal(calls.openAi[0].init.body.get('prompt'), buildRedrawPrompt());
  // A done job is still readable on later polls.
  assert.equal((await poll(handler, jobId)).json().stage, 'done');
});

await test('2. OpenAI failures end the job failed with the same codes and messages as before, no result, no layout call; retry and safety-retry budgets unchanged', async () => {
  const SAFETY = 'Your request was rejected by the safety system. request ID req_abc123';
  const cases = [
    [() => status(500), { code: 'provider-failed', message: 'The image service did not respond. Try again later.' }, 2],
    [() => { throw new TypeError('fetch failed'); }, { code: 'provider-failed', message: 'The image service did not respond. Try again later.' }, 2],
    [() => status(429), { code: 'rate-limited', message: 'The image service is busy. Try again later.' }, 1],
    [() => status(401, { error: { message: 'bad key' } }), { code: 'provider-failed', message: 'The redraw server is not set up correctly.' }, 1],
    [() => status(403), { code: 'provider-failed', message: 'The redraw server is not set up correctly.' }, 1],
    [() => status(400, { error: { message: 'Invalid size.' } }), { code: 'provider-failed', message: 'Invalid size.' }, 1],
    [() => status(400, { error: { message: SAFETY } }), { code: 'declined', message: SAFETY }, 2],
    [(n) => (n === 1 ? status(500) : status(400, { error: { message: SAFETY } })), { code: 'declined', message: SAFETY }, 2],
    [() => new Response(JSON.stringify({ data: [{ b64_json: Buffer.from('not a png at all').toString('base64') }] }), { status: 200 }), { code: 'invalid-output', message: 'The image service returned no image.' }, 1],
    [() => new Response(JSON.stringify({ data: [] }), { status: 200 }), { code: 'invalid-output', message: 'The image service returned no image.' }, 1]
  ];
  for (const [responder, error, attempts] of cases) {
    const { fetch, calls } = router({ openAi: responder });
    const { handler } = makeHandler({ fetch });
    const jobId = await start(handler);
    await flush();
    assert.deepEqual((await poll(handler, jobId)).json(), { stage: 'failed', error }, error.code);
    assert.equal(calls.openAi.length, attempts, `${error.code}: ${attempts} OpenAI call(s)`);
    assert.equal(calls.layout.length, 0, 'no layout call after an OpenAI failure');
  }
  // A safety refusal then a good image succeeds on the 2nd call; 500 then 200 likewise.
  for (const responder of [(n) => (n === 1 ? status(400, { error: { message: SAFETY } }) : okImage()), (n) => (n === 1 ? status(500) : okImage())]) {
    const { fetch, calls } = router({ openAi: responder });
    const { handler } = makeHandler({ fetch });
    const jobId = await start(handler);
    await flush();
    assert.equal((await poll(handler, jobId)).json().stage, 'done');
    assert.equal(calls.openAi.length, 2);
  }
});

await test('3. OpenAI timeout: after REDRAW_TIMEOUT_SECONDS (300 s) the job fails provider-failed with the old message, once, not retried', async () => {
  const { fetch, calls } = router({ openAi: () => new Promise(() => {}) });
  const { handler, clock } = makeHandler({ fetch });
  const jobId = await start(handler);
  for (let s = 3; s < 300; s += 3) { await clock.advance(3000); assert.equal((await poll(handler, jobId)).json().stage, 'drawing'); }
  await clock.advance(2999);
  assert.equal((await poll(handler, jobId)).json().stage, 'drawing', 'still drawing at 299.999 s');
  await clock.advance(1);
  assert.deepEqual((await poll(handler, jobId)).json(), { stage: 'failed', error: { code: 'provider-failed', message: 'The image service took too long. Try again, or set a lower OPENAI_IMAGE_QUALITY.' } });
  assert.equal(calls.openAi.length, 1);
  assert.equal(calls.openAi[0].init.signal.aborted, true);
});

// ---- Layout --------------------------------------------------------------------------------------

await test('4. the exact multipart request to the layout service: POST <LAYOUT_SERVICE_URL>/layout, image (image/png, the OpenAI bytes) and options { colorIds: all 27 ids, targetPitchMm: 2.1 }', async () => {
  for (const base of [LAYOUT_BASE, `${LAYOUT_BASE}/`]) {
    const { fetch, calls } = router();
    const { handler } = makeHandler({ fetch, env: { LAYOUT_SERVICE_URL: base } });
    const jobId = await start(handler);
    await flush();
    assert.equal((await poll(handler, jobId)).json().stage, 'done');
    assert.equal(calls.layout.length, 1);
    const { url, init } = calls.layout[0];
    assert.equal(url, 'http://layout.test:8000/layout');
    assert.equal(init.method, 'POST');
    assert.equal(init.headers, undefined, 'no headers: fetch sets the multipart boundary');
    assert.ok(init.signal instanceof AbortSignal);
    const form = init.body;
    assert.ok(form instanceof FormData);
    assert.deepEqual([...form.keys()], ['image', 'options']);
    const image = form.get('image');
    assert.ok(image instanceof Blob);
    assert.equal(image.type, 'image/png');
    assert.ok(Buffer.from(await image.arrayBuffer()).equals(Buffer.from(FAKE_B64, 'base64')));
    assert.equal(typeof form.get('options'), 'string');
    const options = JSON.parse(form.get('options'));
    assert.deepEqual(options, { colorIds: Object.keys(STONE_COLORS), targetPitchMm: 2.1 });
    assert.equal(options.colorIds.length, 27);
    assert.deepEqual(options.colorIds.slice(-4), ['colorado-topaz', 'light-smoked-topaz', 'scarlet', 'hyacinth']);
  }
});

await test('5. layout failures: unavailable (no URL, connection refused), failed (any non-200, with the service code and message), timeout after 180 s; each keeps the OpenAI image in result and is not retried', async () => {
  const cases = [
    [{ env: { LAYOUT_SERVICE_URL: '' } }, () => okLayout(), 'layout-unavailable', /LAYOUT_SERVICE_URL/, 0],
    [{}, () => { throw new TypeError('fetch failed', { cause: Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:8000'), { code: 'ECONNREFUSED' }) }); }, 'layout-unavailable', /not running/, 1],
    [{}, () => status(422, { error: 'catalogue-mismatch', message: 'The layout service has colours the app does not know: x' }), 'layout-failed', /^catalogue-mismatch: The layout service has colours the app does not know: x$/, 1],
    [{}, () => status(422, { error: 'no-stones', message: 'Fewer than 50 stones.' }), 'layout-failed', /^no-stones: Fewer than 50 stones\.$/, 1],
    [{}, () => status(400, { error: 'no-alpha', message: 'No transparent background.' }), 'layout-failed', /^no-alpha: /, 1],
    [{}, () => new Response('<html>Bad Gateway</html>', { status: 502 }), 'layout-failed', /^The layout service answered 502\.$/, 1],
    [{}, () => status(200, { nothing: true }), 'layout-failed', /no layout/, 1],
    [{}, () => { throw new TypeError('socket hang up'); }, 'layout-failed', /socket hang up/, 1]
  ];
  for (const [options, layout, code, message, layoutCalls] of cases) {
    const { fetch, calls } = router({ layout });
    const { handler } = makeHandler({ fetch, ...options });
    const jobId = await start(handler);
    await flush();
    const body = (await poll(handler, jobId)).json();
    assert.equal(body.stage, 'failed', code);
    assert.deepEqual(body.result, DONE_RESULT, `${code}: result carries the OpenAI image, no layout`);
    assert.equal(body.error.code, code);
    assert.match(body.error.message, message);
    assert.deepEqual(Object.keys(body.error), ['code', 'message']);
    assert.equal(calls.layout.length, layoutCalls, `${code}: ${layoutCalls} layout call(s), no retry`);
  }

  const { fetch, calls } = router({ layout: () => new Promise(() => {}) });
  const { handler, clock } = makeHandler({ fetch });
  const jobId = await start(handler);
  await flush();
  for (let s = 0; s < 177; s += 3) { await clock.advance(3000); assert.equal((await poll(handler, jobId)).json().stage, 'placing'); }
  await clock.advance(2999);
  assert.equal((await poll(handler, jobId)).json().stage, 'placing', 'still placing at 179.999 s');
  await clock.advance(1);
  assert.deepEqual((await poll(handler, jobId)).json(), { stage: 'failed', result: DONE_RESULT, error: { code: 'layout-timeout', message: 'The layout service took longer than 180 s.' } });
  assert.equal(calls.layout.length, 1);
  assert.equal(calls.layout[0].init.signal.aborted, true, 'the timed-out layout request is aborted');

  // LAYOUT_TIMEOUT_SECONDS sets the timeout.
  const slow = router({ layout: () => new Promise(() => {}) });
  const custom = makeHandler({ fetch: slow.fetch, env: { LAYOUT_TIMEOUT_SECONDS: '10' } });
  const customId = await start(custom.handler);
  await flush();
  await custom.clock.advance(9999);
  assert.equal((await poll(custom.handler, customId)).json().stage, 'placing');
  await custom.clock.advance(1);
  assert.equal((await poll(custom.handler, customId)).json().error.code, 'layout-timeout');
});

await test('6. one layout at a time, in job order: a second job waits in placing until the first layout settles', async () => {
  const layouts = [];
  const { fetch, calls } = router({ layout: () => { const d = deferred(); layouts.push(d); return d.promise; } });
  const { handler } = makeHandler({ fetch });
  const first = await start(handler);
  const second = await start(handler);
  const third = await start(handler);
  await flush();
  assert.equal(calls.openAi.length, 3, 'OpenAI calls are not queued');
  assert.equal(calls.layout.length, 1, 'only the first layout is sent');
  for (const id of [first, second, third]) assert.equal((await poll(handler, id)).json().stage, 'placing');
  layouts[0].resolve(okLayout());
  await flush();
  assert.equal((await poll(handler, first)).json().stage, 'done');
  assert.equal(calls.layout.length, 2, 'the second layout starts only now');
  layouts[1].resolve(status(500, { error: 'layout-failed', message: 'boom' }));
  await flush();
  assert.equal((await poll(handler, second)).json().error.code, 'layout-failed');
  assert.equal(calls.layout.length, 3, 'a failed layout releases the queue too');
  layouts[2].resolve(okLayout());
  await flush();
  assert.equal((await poll(handler, third)).json().stage, 'done');
});

// ---- Cancel, orphan, expiry, cap ------------------------------------------------------------------

await test('7. DELETE answers 204, aborts the OpenAI or layout request in flight and drops the job (then 404 not-found); an unknown job is 404', async () => {
  const { fetch, calls } = router({ openAi: () => new Promise(() => {}) });
  const { handler } = makeHandler({ fetch });
  const jobId = await start(handler);
  await flush();
  const del = await poll(handler, jobId, { method: 'DELETE' });
  assert.equal(del.statusCode, 204);
  assert.equal(del.body, '');
  assert.equal(calls.openAi[0].init.signal.aborted, true, 'the OpenAI request is aborted');
  await flush();
  assert.equal(calls.openAi.length, 1, 'no retry after a cancel');
  const gone = await poll(handler, jobId);
  assert.equal(gone.statusCode, 404);
  assert.deepEqual(gone.json(), { code: 'not-found' });
  assert.equal((await poll(handler, jobId, { method: 'DELETE' })).statusCode, 404);
  assert.deepEqual((await poll(handler, 'no-such-job')).json(), { code: 'not-found' });

  const placing = router({ layout: () => new Promise(() => {}) });
  const second = makeHandler({ fetch: placing.fetch });
  const id2 = await start(second.handler);
  await flush();
  assert.equal((await poll(second.handler, id2)).json().stage, 'placing');
  assert.equal((await poll(second.handler, id2, { method: 'DELETE' })).statusCode, 204);
  assert.equal(placing.calls.layout[0].init.signal.aborted, true, 'the layout request is aborted');
  assert.equal((await poll(second.handler, id2)).statusCode, 404);

  // A job cancelled while waiting for the layout queue never sends its layout.
  const queued = [];
  const queue = router({ layout: () => { const d = deferred(); queued.push(d); return d.promise; } });
  const third = makeHandler({ fetch: queue.fetch });
  const a = await start(third.handler);
  const b = await start(third.handler);
  await flush();
  assert.equal((await poll(third.handler, b, { method: 'DELETE' })).statusCode, 204);
  queued[0].resolve(okLayout());
  await flush();
  assert.equal((await poll(third.handler, a)).json().stage, 'done');
  assert.equal(queue.calls.layout.length, 1, 'the cancelled job sent no layout');
});

await test('8. orphans: a running job not polled for 180 s is cancelled as if deleted; each poll restarts the 180 s; a finished job is not an orphan', async () => {
  assert.equal(JOB_ORPHAN_MS, 180000);
  const { fetch, calls } = router({ openAi: () => new Promise(() => {}) });
  const { handler, clock } = makeHandler({ fetch, timeoutMs: 3_600_000 });
  const jobId = await start(handler);
  await flush();
  await clock.advance(179000);
  assert.equal(calls.openAi[0].init.signal.aborted, false, 'not cancelled at 179 s without a poll');
  assert.equal((await poll(handler, jobId)).json().stage, 'drawing', 'polled at 179 s');
  await clock.advance(179999);
  assert.equal(calls.openAi[0].init.signal.aborted, false, 'the poll restarted the clock');
  assert.equal((await poll(handler, jobId)).json().stage, 'drawing', 'polled again at 179.999 s after the last poll');
  await clock.advance(179999);
  assert.equal(calls.openAi[0].init.signal.aborted, false, 'still running 1 ms before the orphan time');
  await clock.advance(1);
  assert.equal(calls.openAi[0].init.signal.aborted, true, 'the orphan\'s OpenAI request is aborted at 180 s');
  assert.deepEqual((await poll(handler, jobId)).json(), { code: 'not-found' });

  const placing = router({ layout: () => new Promise(() => {}) });
  const second = makeHandler({ fetch: placing.fetch });
  const id2 = await start(second.handler);
  await flush();
  assert.equal(placing.calls.layout.length, 1);
  await second.clock.advance(179999);
  assert.equal(placing.calls.layout[0].init.signal.aborted, false, 'placing: not cancelled before 180 s');
  await second.clock.advance(1);
  assert.equal(placing.calls.layout[0].init.signal.aborted, true, 'an orphan in placing aborts its layout request');
  assert.equal((await poll(second.handler, id2)).statusCode, 404);

  const done = makeHandler({ fetch: router().fetch });
  const id3 = await start(done.handler);
  await flush();
  await done.clock.advance(10 * 60 * 1000);
  assert.equal((await poll(done.handler, id3)).json().stage, 'done', 'a finished job is kept, not cancelled');
});

await test('9. lifetime: a finished or failed job is kept 30 min after it ends, then dropped (404)', async () => {
  assert.equal(JOB_KEEP_MS, 30 * 60 * 1000);
  for (const openAi of [() => okImage(), () => status(429)]) {
    const { handler, clock } = makeHandler({ fetch: router({ openAi }).fetch });
    const jobId = await start(handler);
    await flush();
    const stage = (await poll(handler, jobId)).json().stage;
    assert.ok(stage === 'done' || stage === 'failed');
    await clock.advance(JOB_KEEP_MS - 1);
    assert.equal((await poll(handler, jobId)).json().stage, stage, 'kept at 29:59.999');
    await clock.advance(1);
    assert.deepEqual((await poll(handler, jobId)).json(), { code: 'not-found' });
  }
});

await test('10. at most 20 jobs: a 21st drops the oldest finished job first; with none finished it gets 429 rate-limited', async () => {
  assert.equal(MAX_JOBS, 20);
  const openAiCalls = [];
  const { fetch } = router({ openAi: () => { const d = deferred(); openAiCalls.push(d); return d.promise; } });
  const { handler } = makeHandler({ fetch, env: { REDRAW_RATE_LIMIT_PER_HOUR: '100' } });
  const ids = [];
  for (let i = 0; i < 20; i++) ids.push(await start(handler));
  await flush();
  const blocked = await post(handler);
  assert.equal(blocked.statusCode, 429);
  assert.equal(blocked.json().code, 'rate-limited');
  assert.equal(openAiCalls.length, 20, 'the refused job never called OpenAI');
  openAiCalls[7].resolve(status(400, { error: { message: 'x' } }));
  openAiCalls[3].resolve(status(400, { error: { message: 'x' } }));
  await flush();
  const extra = await start(handler);
  assert.equal((await poll(handler, ids[3])).statusCode, 404, 'the oldest finished job (index 3) was dropped');
  assert.equal((await poll(handler, ids[7])).json().stage, 'failed', 'the newer finished job is kept');
  for (const [i, id] of ids.entries()) if (i !== 3 && i !== 7) assert.equal((await poll(handler, id)).json().stage, 'drawing');
  assert.equal((await poll(handler, extra)).json().stage, 'drawing');
});

// ---- Access code, rate limit, fake mode ------------------------------------------------------------

await test('11. access code on all three routes: missing or wrong -> 401 unauthorized; unconfigured -> 404 on all three', async () => {
  const { handler } = makeHandler({ fetch: router({ openAi: () => new Promise(() => {}) }).fetch });
  const jobId = await start(handler);
  for (const code of [null, '', 'wrong', 'letmein!']) {
    const p = await post(handler, { code });
    assert.equal(p.statusCode, 401);
    assert.equal(p.json().code, 'unauthorized');
    for (const method of ['GET', 'DELETE']) {
      const r = await poll(handler, jobId, { code, method });
      assert.equal(r.statusCode, 401, `${method} ${code}`);
      assert.deepEqual(r.json(), { code: 'unauthorized', message: 'The access code was not accepted.' });
    }
    assert.equal((await poll(handler, 'no-such-job', { code })).statusCode, 401, 'the code is checked before the job lookup');
  }
  assert.equal((await poll(handler, jobId)).json().stage, 'drawing', 'a refused DELETE leaves the job running');

  const off = createRedrawHandler({ settings: loadRedrawEnv({ env: { OPENAI_API_KEY: 'k' } }) });
  for (const method of ['GET', 'DELETE']) {
    const r = await poll(off, jobId, { method });
    assert.equal(r.statusCode, 404);
    assert.equal(r.body, 'Not Found');
  }
});

await test('12. the rate limit counts job creation only: polls and deletes never count and still work after the limit is reached', async () => {
  const { handler } = makeHandler({ fetch: router({ openAi: () => new Promise(() => {}) }).fetch, env: { REDRAW_RATE_LIMIT_PER_HOUR: '2' } });
  const a = await start(handler, { ip: 'A' });
  for (let i = 0; i < 10; i++) assert.equal((await poll(handler, a, { ip: 'A' })).statusCode, 200);
  assert.equal((await poll(handler, 'no-such-job', { ip: 'A', method: 'DELETE' })).statusCode, 404);
  const b = await start(handler, { ip: 'A' });
  const third = await post(handler, { ip: 'A' });
  assert.equal(third.statusCode, 429);
  assert.deepEqual(third.json(), { code: 'rate-limited', message: 'The hourly redraw limit has been reached.' });
  assert.equal((await poll(handler, b, { ip: 'A' })).statusCode, 200);
  assert.equal((await poll(handler, b, { ip: 'A', method: 'DELETE' })).statusCode, 204);
});

await test('13. fake mode: 202 with a job, no OpenAI and no layout call; the first three polls see drawing, placing, done with the fake image and fake-layout.json; flat keeps promptVersion 1', async () => {
  const spy = router();
  const { handler } = makeHandler({ fetch: spy.fetch, env: { REDRAW_FAKE: '1', OPENAI_API_KEY: '' } });
  for (const [body, promptVersion] of [[UPLOAD_BODY, 3], [JSON.stringify({ image: FAKE_REDRAW_DATA_URL, style: 'flat' }), 1]]) {
    const jobId = await start(handler, { body });
    assert.match(jobId, UUID_PATTERN);
    assert.deepEqual((await poll(handler, jobId)).json(), { stage: 'drawing' });
    assert.deepEqual((await poll(handler, jobId)).json(), { stage: 'placing' });
    assert.deepEqual((await poll(handler, jobId)).json(), { stage: 'done', result: { dataUrl: FAKE_REDRAW_DATA_URL, model: 'fake', promptVersion, layout: FAKE_LAYOUT } });
    assert.equal((await poll(handler, jobId)).json().stage, 'done');
  }
  assert.equal(spy.calls.openAi.length + spy.calls.layout.length, 0);
  assert.equal((await poll(handler, 'x', { code: 'wrong' })).statusCode, 401);
});

await test('14. fake-layout.json: about 200 stones in the build A response shape, valid size and colour ids, its report matches its stones, and 0 gap violations (recomputed)', () => {
  const layout = JSON.parse(fixtureText);
  assert.deepEqual(layout, FAKE_LAYOUT);
  assert.deepEqual(Object.keys(layout), ['version', 'widthMm', 'heightMm', 'stones', 'report']);
  assert.equal(layout.version, 1);
  assert.ok(layout.stones.length >= 150 && layout.stones.length <= 250, `${layout.stones.length} stones`);
  const DIAMETERS = { ss4: 1.5, ss6: 2.0, ss10: 2.8, ss16: 4.0, ss20: 4.7, ss30: 6.4 };
  for (const [key, mm] of Object.entries(DIAMETERS)) if (key !== 'ss4') assert.equal(getStoneSize(key).diameterMm, mm, `${key} agrees with StoneSizes.js`);
  const d = [];
  for (const s of layout.stones) {
    assert.equal(s.length, 4);
    assert.ok(Number.isFinite(s[0]) && Number.isFinite(s[1]));
    assert.ok(s[2] in DIAMETERS, s[2]);
    assert.ok(s[3] in STONE_COLORS, s[3]);
    assert.equal(Math.round(s[0] * 1000) / 1000, s[0]);
    d.push(DIAMETERS[s[2]]);
  }
  const xs = layout.stones.map((s, i) => [s[0] - d[i] / 2, s[0] + d[i] / 2]);
  const ys = layout.stones.map((s, i) => [s[1] - d[i] / 2, s[1] + d[i] / 2]);
  assert.ok(Math.abs(Math.min(...xs.map((v) => v[0]))) < 1e-9 && Math.abs(Math.min(...ys.map((v) => v[0]))) < 1e-9, 'cropped to the stones (S1)');
  assert.ok(Math.abs(Math.max(...xs.map((v) => v[1])) - layout.widthMm) < 1e-9);
  assert.ok(Math.abs(Math.max(...ys.map((v) => v[1])) - layout.heightMm) < 1e-9);
  let minGap = Infinity, violations = 0;
  for (let i = 0; i < layout.stones.length; i++) for (let j = i + 1; j < layout.stones.length; j++) {
    const g = Math.hypot(layout.stones[i][0] - layout.stones[j][0], layout.stones[i][1] - layout.stones[j][1]) - (d[i] + d[j]) / 2;
    minGap = Math.min(minGap, g);
    if (g < 0.1 - 1e-6) violations++;
  }
  assert.equal(violations, 0);
  assert.ok(minGap >= 0.1);
  const r = layout.report;
  assert.deepEqual(Object.keys(r), ['stones', 'bySize', 'colours', 'minGapMm', 'violations', 'coverage', 'largestEmptyCircleMm', 'face', 'pupilsMm', 'frameMm', 'offsetMm', 'mmPerPx', 'stagesMs', 'ms']);
  assert.equal(r.stones, layout.stones.length);
  assert.equal(r.violations, 0);
  assert.equal(r.minGapMm, Math.round(minGap * 10000) / 10000);
  const count = (key) => { const out = {}; for (const s of layout.stones) out[s[key]] = (out[s[key]] || 0) + 1; return out; };
  assert.deepEqual(r.bySize, count(2));
  assert.deepEqual(r.colours, count(3));
});

await test('15. settings: LAYOUT_SERVICE_URL (default empty) and LAYOUT_TIMEOUT_SECONDS (default 180) are read in env.mjs; a missing URL leaves the routes on; .env.example adds them as two plain lines', async () => {
  const defaults = loadRedrawEnv({ env: {} });
  assert.equal(defaults.layoutServiceUrl, '');
  assert.equal(defaults.layoutTimeoutMs, 180000);
  const set = loadRedrawEnv({ env: { LAYOUT_SERVICE_URL: ' http://127.0.0.1:8000 ', LAYOUT_TIMEOUT_SECONDS: '240' } });
  assert.equal(set.layoutServiceUrl, 'http://127.0.0.1:8000');
  assert.equal(set.layoutTimeoutMs, 240000);
  for (const bad of ['0', '-5', 'abc']) assert.equal(loadRedrawEnv({ env: { LAYOUT_TIMEOUT_SECONDS: bad } }).layoutTimeoutMs, 180000, bad);
  const file = loadRedrawEnv({ env: {}, envFileText: 'LAYOUT_SERVICE_URL=http://laptop.local:8000\n' });
  assert.equal(file.layoutServiceUrl, 'http://laptop.local:8000');
  const noUrl = createRedrawHandler({ settings: loadRedrawEnv({ env: { OPENAI_API_KEY: 'k', REDRAW_ACCESS_CODE: 'c' } }) });
  assert.equal(noUrl.configured, true);
  const lines = envExample.split('\n');
  assert.ok(lines.includes('LAYOUT_SERVICE_URL='));
  assert.ok(lines.includes('LAYOUT_TIMEOUT_SECONDS=180'));
  const at = lines.indexOf('LAYOUT_SERVICE_URL=');
  assert.equal(lines[at + 1], 'LAYOUT_TIMEOUT_SECONDS=180');
  assert.ok(!lines[at - 1].startsWith('#') && !(lines[at + 2] || '').startsWith('#'), 'no comment lines around them');
  assert.deepEqual(lines.filter((l) => l.startsWith('#') && l.includes('LAYOUT')), [], 'no comment mentions the layout settings');
});

await test('16. dev-server mounts GET and DELETE /api/redraw/:jobId on handleJob, after the config and POST routes', () => {
  const config = devServer.indexOf("routePath === '/api/redraw/config' && req.method === 'GET'");
  const postRoute = devServer.indexOf("routePath === '/api/redraw' && req.method === 'POST'");
  const jobRoute = devServer.indexOf("const jobMatch = /^\\/api\\/redraw\\/([^/]+)$/.exec(routePath);");
  assert.ok(config > 0 && postRoute > config && jobRoute > postRoute, 'route order');
  assert.ok(devServer.includes("if (jobMatch && (req.method === 'GET' || req.method === 'DELETE')) return redraw.handleJob(req, res, jobMatch[1]);"));
});

// ---- Client provider ------------------------------------------------------------------------------

const LAYOUT_ERROR = { code: 'layout-timeout', message: 'The layout service took longer than 180 s.' };

// A scripted server: POST answers 202 { jobId: 'job-1' }; each GET takes the next scripted reply.
function scriptedServer(gets, { post = () => status(202, { jobId: 'job-1' }) } = {}) {
  const requests = [];
  const fetch = async (url, init = {}) => {
    requests.push({ url, method: init.method, headers: init.headers, signal: init.signal });
    if (url === '/api/redraw/config') return status(200, { providerId: 'openai-proxy', costLabel: '' });
    if (init.method === 'POST') return post();
    if (init.method === 'DELETE') return new Response(null, { status: 204 });
    const next = gets.shift();
    if (typeof next === 'function') return next(init);
    return status(200, next);
  };
  return { fetch, requests };
}

const recordWait = (waits) => async (ms, signal) => {
  waits.push(ms);
  if (signal && signal.aborted) throw new DOMException('Redraw cancelled.', 'AbortError');
};

await test('17. provider: posts, then polls GET /api/redraw/:jobId every 3 s with the access code, reports each new stage once through onStage, and resolves { dataUrl, model, promptVersion, layout, layoutError: null }', async () => {
  assert.equal(REDRAW_POLL_INTERVAL_MS, 3000);
  const server = scriptedServer([{ stage: 'drawing' }, { stage: 'drawing' }, { stage: 'placing' }, { stage: 'placing' }, { stage: 'done', result: { ...DONE_RESULT, layout: FAKE_LAYOUT } }]);
  const waits = [];
  const stages = [];
  const provider = createOpenAiProxyProvider({ fetch: server.fetch, wait: recordWait(waits) });
  const result = await provider.redraw({ pngDataUrl: `${PNG_PREFIX}UPLOAD`, accessCode: 'letmein', onStage: (s) => stages.push(s) });
  assert.deepEqual(result, { ...DONE_RESULT, layout: FAKE_LAYOUT, layoutError: null });
  assert.deepEqual(stages, ['drawing', 'placing', 'done']);
  assert.deepEqual(waits, [3000, 3000, 3000, 3000, 3000], 'one 3 s wait before every poll');
  assert.deepEqual(server.requests.map((r) => [r.method, r.url]), [['POST', '/api/redraw'], ...Array(5).fill(['GET', '/api/redraw/job-1'])]);
  for (const r of server.requests) assert.equal(r.headers['X-Redraw-Access-Code'], 'letmein');
  // onStage is optional.
  const quiet = createOpenAiProxyProvider({ fetch: scriptedServer([{ stage: 'done', result: { ...DONE_RESULT, layout: FAKE_LAYOUT } }]).fetch, wait: recordWait([]) });
  assert.deepEqual((await quiet.redraw({ pngDataUrl: `${PNG_PREFIX}UPLOAD` })).layout, FAKE_LAYOUT);
});

await test('18. provider result shapes: a layout failure with an OpenAI image resolves layout: null and layoutError; a failed job without an image throws its code; unknown codes become provider-failed', async () => {
  const wait = recordWait([]);
  const withImage = createOpenAiProxyProvider({ fetch: scriptedServer([{ stage: 'placing' }, { stage: 'failed', result: DONE_RESULT, error: LAYOUT_ERROR }]).fetch, wait });
  assert.deepEqual(await withImage.redraw({ pngDataUrl: 'x' }), { ...DONE_RESULT, layout: null, layoutError: LAYOUT_ERROR });
  for (const code of ['declined', 'rate-limited', 'invalid-output', 'provider-failed', 'layout-unavailable']) {
    const p = createOpenAiProxyProvider({ fetch: scriptedServer([{ stage: 'failed', error: { code, message: `m-${code}` } }]).fetch, wait });
    await assert.rejects(p.redraw({ pngDataUrl: 'x' }), (e) => e.code === code && e.detail === `m-${code}`);
  }
  const odd = createOpenAiProxyProvider({ fetch: scriptedServer([{ stage: 'failed', error: { code: 'weird', message: 'w' } }]).fetch, wait });
  await assert.rejects(odd.redraw({ pngDataUrl: 'x' }), (e) => e.code === 'provider-failed' && e.detail === 'w');
  // POST failures map as before; a 202 without a jobId is provider-failed.
  for (const [reply, code] of [[() => status(401, { code: 'unauthorized', message: 'm' }), 'unauthorized'], [() => status(429, { code: 'rate-limited', message: 'm' }), 'rate-limited'], [() => new Response('Not Found', { status: 404 }), 'not-configured'], [() => status(202, {}), 'provider-failed']]) {
    const p = createOpenAiProxyProvider({ fetch: scriptedServer([], { post: reply }).fetch, wait });
    await assert.rejects(p.redraw({ pngDataUrl: 'x' }), (e) => e.code === code);
  }
  // A poll answered 404 (job expired or cancelled elsewhere) or 401 ends the redraw.
  for (const [reply, code] of [[() => status(404, { code: 'not-found' }), 'provider-failed'], [() => status(401, { code: 'unauthorized', message: 'm' }), 'unauthorized']]) {
    const p = createOpenAiProxyProvider({ fetch: scriptedServer([reply]).fetch, wait });
    await assert.rejects(p.redraw({ pngDataUrl: 'x' }), (e) => e.code === code);
  }
  // A done job whose image is not a data URL is invalid-output.
  const bad = createOpenAiProxyProvider({ fetch: scriptedServer([{ stage: 'done', result: { dataUrl: 'http://x', model: 'm', promptVersion: 3, layout: FAKE_LAYOUT } }]).fetch, wait });
  await assert.rejects(bad.redraw({ pngDataUrl: 'x' }), (e) => e.code === 'invalid-output');
});

await test('19. provider polls are not retried: a failed poll counts as network only after 3 failures in a row; 2 failures then an answer carry on', async () => {
  const offline = () => { throw new TypeError('offline'); };
  const waits = [];
  const recovering = scriptedServer([offline, offline, { stage: 'drawing' }, offline, offline, { stage: 'done', result: { ...DONE_RESULT, layout: FAKE_LAYOUT } }]);
  const ok = await createOpenAiProxyProvider({ fetch: recovering.fetch, wait: recordWait(waits) }).redraw({ pngDataUrl: 'x' });
  assert.deepEqual(ok.layout, FAKE_LAYOUT);
  assert.equal(waits.length, 6, 'every poll, failed or not, waits 3 s first; no immediate retry');
  const down = scriptedServer([{ stage: 'drawing' }, offline, offline, offline, { stage: 'done', result: DONE_RESULT }]);
  await assert.rejects(createOpenAiProxyProvider({ fetch: down.fetch, wait: recordWait([]) }).redraw({ pngDataUrl: 'x' }), (e) => e.code === 'network');
  assert.equal(down.requests.filter((r) => r.method === 'GET').length, 4, 'gave up on the 3rd failure in a row');
});

await test('20. provider abort: during a wait or a poll it sends DELETE /api/redraw/:jobId with the access code and rethrows the AbortError; before the job exists it sends nothing', async () => {
  for (const when of ['wait', 'poll']) {
    const controller = new AbortController();
    const server = scriptedServer([{ stage: 'drawing' }, (init) => { controller.abort(); return abortable(new Promise(() => {}), init.signal); }]);
    const wait = when === 'wait'
      ? async (ms, signal) => { if (server.requests.length >= 2) controller.abort(); if (signal.aborted) throw new DOMException('Redraw cancelled.', 'AbortError'); }
      : recordWait([]);
    const provider = createOpenAiProxyProvider({ fetch: server.fetch, wait });
    await assert.rejects(provider.redraw({ pngDataUrl: 'x', accessCode: 'letmein', signal: controller.signal }), (e) => e.name === 'AbortError' && !('detail' in e), when);
    await flush();
    const del = server.requests.filter((r) => r.method === 'DELETE');
    assert.equal(del.length, 1, `${when}: one DELETE`);
    assert.equal(del[0].url, '/api/redraw/job-1');
    assert.equal(del[0].headers['X-Redraw-Access-Code'], 'letmein');
    assert.equal(del[0].signal, undefined, 'the DELETE is not tied to the aborted signal');
  }
  const controller = new AbortController();
  controller.abort();
  const early = scriptedServer([]);
  const fetchAborting = (url, init) => (init.signal && init.signal.aborted ? Promise.reject(new DOMException('aborted', 'AbortError')) : early.fetch(url, init));
  await assert.rejects(createOpenAiProxyProvider({ fetch: fetchAborting, wait: recordWait([]) }).redraw({ pngDataUrl: 'x', signal: controller.signal }), (e) => e.name === 'AbortError');
  await flush();
  assert.equal(early.requests.length, 0);
});

await test('21. redrawImage(): forwards onStage, passes layout and layoutError through, knows the three layout codes; a provider without a layout gives null for both', async () => {
  assert.deepEqual(REDRAW_ERROR_CODES.slice(-3), ['layout-unavailable', 'layout-timeout', 'layout-failed']);
  const disc = { widthPx: 64, heightPx: 64, data: new Uint8ClampedArray(64 * 64 * 4) };
  for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) if (Math.hypot(x + 0.5 - 32, y + 0.5 - 32) <= 24) disc.data.set([20, 20, 20, 255], (y * 64 + x) * 4);
  const decodeImage = (u) => (u === FAKE_REDRAW_DATA_URL ? disc : { widthPx: 4, heightPx: 4, data: new Uint8ClampedArray(64).fill(200) });
  const stages = [];
  let server = scriptedServer([{ stage: 'drawing' }, { stage: 'placing' }, { stage: 'done', result: { ...DONE_RESULT, layout: FAKE_LAYOUT } }]);
  configureRedraw({ fetch: server.fetch, decodeImage, encodePng: () => `${PNG_PREFIX}UPLOAD`, wait: recordWait([]) });
  setRedrawAccessCode('letmein');
  const done = await redrawImage({ dataUrl: `${PNG_PREFIX}SOURCE`, onStage: (s) => stages.push(s) });
  assert.deepEqual(done, { ...DONE_RESULT, providerId: 'openai-proxy', layout: FAKE_LAYOUT, layoutError: null });
  assert.deepEqual(stages, ['drawing', 'placing', 'done']);

  server = scriptedServer([{ stage: 'failed', result: DONE_RESULT, error: LAYOUT_ERROR }]);
  configureRedraw({ fetch: server.fetch, decodeImage, encodePng: () => `${PNG_PREFIX}UPLOAD`, wait: recordWait([]) });
  setRedrawAccessCode('letmein');
  assert.deepEqual(await redrawImage({ dataUrl: `${PNG_PREFIX}SOURCE` }), { ...DONE_RESULT, providerId: 'openai-proxy', layout: null, layoutError: LAYOUT_ERROR });

  server = scriptedServer([{ stage: 'failed', error: { code: 'declined', message: 'safety system' } }]);
  configureRedraw({ fetch: server.fetch, decodeImage, encodePng: () => `${PNG_PREFIX}UPLOAD`, wait: recordWait([]) });
  await assert.rejects(redrawImage({ dataUrl: `${PNG_PREFIX}SOURCE` }), (e) => e instanceof RedrawError && e.code === 'declined' && e.detail === 'safety system');

  configureRedraw({ provider: { id: 'plain', consent: null, redraw: async () => ({ dataUrl: FAKE_REDRAW_DATA_URL, model: 'm', promptVersion: null }) }, decodeImage, encodePng: () => `${PNG_PREFIX}UPLOAD` });
  assert.deepEqual(await redrawImage({ dataUrl: `${PNG_PREFIX}SOURCE` }), { dataUrl: FAKE_REDRAW_DATA_URL, providerId: 'plain', model: 'm', promptVersion: null, layout: null, layoutError: null });
  configureRedraw();
});

await test('22. end to end through the real handler: the provider drives a fake-mode job to done in three polls', async () => {
  const { handler } = makeHandler({ fetch: router().fetch, env: { REDRAW_FAKE: '1' } });
  const fetch = async (url, init) => {
    const res = makeRes();
    if (init.method === 'POST') await handler.handleRedraw(makeReq({ headers: { 'x-redraw-access-code': init.headers['X-Redraw-Access-Code'] }, body: init.body }), res);
    else await handler.handleJob(makeReq({ method: init.method, headers: { 'x-redraw-access-code': init.headers['X-Redraw-Access-Code'] } }), res, url.split('/').pop());
    return new Response(res.statusCode === 204 ? null : res.body, { status: res.statusCode });
  };
  const stages = [];
  const waits = [];
  const result = await createOpenAiProxyProvider({ fetch, wait: recordWait(waits) }).redraw({ pngDataUrl: FAKE_REDRAW_DATA_URL, accessCode: 'letmein', onStage: (s) => stages.push(s) });
  assert.deepEqual(result, { dataUrl: FAKE_REDRAW_DATA_URL, model: 'fake', promptVersion: 3, layout: FAKE_LAYOUT, layoutError: null });
  assert.deepEqual(stages, ['drawing', 'placing', 'done']);
  assert.equal(waits.length, 3);
});

await test('23. registration: test-img-026-redraw-jobs.mjs is in the integration group and the default suite', () => {
  assertTestRegistered({ filename: 'test-img-026-redraw-jobs.mjs', group: 'integration', includedInDefault: true });
});
