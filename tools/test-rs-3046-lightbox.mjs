// RS-3046: the Image → Strass lightbox's layout service indicator and its Tinted result view.
// - src/redraw/LayoutServiceMonitor.js against a scripted fake dev server (fake fetch, fake clock):
//   Not running → Starting → Ready, a refused or failed start with the button, giving up at the
//   limit, Check, close, fake mode; and once against the real routes (tools/layout-control.mjs over
//   HTTP) with a fake layout service process.
// - imageStudioState()'s redraw button rule per layout service state, and app.js's own
//   syncImageRedrawControls(), renderLayoutServiceIndicator() and openLayoutServiceIndicator(), run.
// - renderImageStudio() from app.js, run for real (unlisted names resolve to inert stubs) with the
//   Colour and the Black & white fake layouts: Tinted draws IMG-026Q's bitmap (crystal gap rule for
//   Black & white only), Template and Source switch away, and no stone, layer or project field changes.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { createServer as createNetServer } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { GeometryEngine, StoneLayout } from '../src/geometry/index.js';
import { fitTransform, renderStoneLayout } from '../src/renderer/CanvasRenderer2D.js';
import { TintedViewCache } from '../src/renderer/TintedView.js';
import { imageStudioState, redrawLookOf } from '../src/ui/ImageStudioState.js';
import { createLayoutServiceMonitor, LAYOUT_SERVICE_POLL_MS, LAYOUT_SERVICE_START_TIMEOUT_MS } from '../src/redraw/index.js';
import { createLayoutServiceControl, LAYOUT_SERVICE_NAME } from './layout-control.mjs';
import { START_TIMEOUT_MS } from './studio.mjs';
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

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const read = (rel) => readFile(path.join(repoRoot, rel), 'utf8');
const appJs = await read('app.js');
const indexHtml = await read('index.html');
const FAKE_LAYOUT = JSON.parse(await read('server/redraw/fixtures/fake-layout.json'));
const FAKE_LAYOUT_BW = JSON.parse(await read('server/redraw/fixtures/fake-layout-bw.json'));

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
const lineOf = (re) => { const m = re.exec(appJs); assert.ok(m, `app.js is missing ${re}`); return m[0]; };
const flush = async () => { for (let i = 0; i < 5; i++) await new Promise((r) => setImmediate(r)); };

// ---- the monitor against a scripted dev server -----------------------------------------------------

// A fake dev server: `statuses` are answered to GET status in turn (the last one repeats), `starts`
// to POST start; each is { status, body } or an Error to throw. A fake clock runs the timers.
function harness({ statuses, starts = [] }) {
  const calls = [];
  const timers = [];
  let clock = 0;
  const changes = [];
  const answer = (list, i) => list[Math.min(i, list.length - 1)];
  let si = 0, pi = 0;
  const fetch = async (url, options = {}) => {
    const method = options.method || 'GET';
    calls.push(`${method} ${url}`);
    const r = url.endsWith('/start') ? answer(starts, pi++) : answer(statuses, si++);
    if (r instanceof Error) throw r;
    return { status: r.status ?? 200, ok: (r.status ?? 200) < 300, json: async () => r.body };
  };
  const monitor = createLayoutServiceMonitor({
    fetch,
    setTimer: (fn, ms) => { const t = { fn, at: clock + ms }; timers.push(t); return t; },
    clearTimer: (t) => { const i = timers.indexOf(t); if (i !== -1) timers.splice(i, 1); },
    now: () => clock,
    onChange: (view) => changes.push(view.text)
  });
  const advance = async (ms) => {
    const end = clock + ms;
    for (;;) {
      timers.sort((a, b) => a.at - b.at);
      const next = timers[0];
      if (!next || next.at > end) break;
      timers.shift();
      clock = next.at;
      next.fn();
      await flush();
    }
    clock = end;
  };
  return { monitor, calls, timers, changes, advance, now: () => clock };
}
const st = (state, extra = {}) => ({ status: 200, body: { used: true, state, label: '', reason: `reason ${state}`, startTimeoutMs: 9000, ...extra } });
const STATUS = 'GET /api/layout-service/status';
const START = 'POST /api/layout-service/start';

await test('1. open with the service Not running: the app asks the dev server to start it, shows Starting… and polls every 3 s until Ready, then stops polling', async () => {
  assert.equal(LAYOUT_SERVICE_POLL_MS, 3000);
  assert.equal(LAYOUT_SERVICE_START_TIMEOUT_MS, START_TIMEOUT_MS, 'the same limit as npm run studio');
  const h = harness({ statuses: [st('not-running'), st('starting'), st('ready')], starts: [{ status: 202, body: st('starting').body }] });
  await h.monitor.open();
  assert.deepEqual(h.calls, [STATUS, START]);
  assert.deepEqual(h.monitor.view(), { shown: true, state: 'starting', text: 'Starting…', reason: 'reason starting', showStart: false, checking: false });
  assert.equal(h.timers.length, 1);
  assert.equal(h.timers[0].at, 3000);
  await h.advance(3000);
  assert.equal(h.monitor.view().text, 'Starting…');
  await h.advance(3000);
  assert.equal(h.monitor.view().state, 'ready');
  assert.equal(h.monitor.view().text, 'Ready');
  assert.equal(h.monitor.view().showStart, false);
  assert.deepEqual(h.calls, [STATUS, START, STATUS, STATUS]);
  assert.equal(h.timers.length, 0, 'no polling once Ready');
  assert.equal(h.changes[0], 'Starting…', 'never Not running first');
  assert.equal(h.changes.at(-1), 'Ready');
  await h.advance(60000);
  assert.equal(h.calls.length, 4);
});

await test('2. a refused start (remote URL, another service) or one that fails shows the reason and the Start layout service button; the button asks again', async () => {
  const refused = harness({
    statuses: [st('not-running'), st('ready')],
    starts: [{ status: 409, body: { error: 'remote', message: 'The layout service is set to http://x:8001, which is not on this Mac.' } }, { status: 202, body: st('starting').body }]
  });
  await refused.monitor.open();
  assert.deepEqual(refused.monitor.view(), { shown: true, state: 'not-running', text: 'Not running', reason: 'The layout service is set to http://x:8001, which is not on this Mac.', showStart: true, checking: false });
  assert.equal(refused.timers.length, 0);
  await refused.monitor.start();
  assert.equal(refused.monitor.view().text, 'Starting…');
  assert.equal(refused.monitor.view().showStart, false);
  await refused.advance(3000);
  assert.equal(refused.monitor.view().state, 'ready');

  const wrong = harness({ statuses: [st('not-running')], starts: [{ status: 409, body: { error: 'wrong-service', message: 'Another service answers.' } }] });
  await wrong.monitor.open();
  assert.equal(wrong.monitor.view().state, 'wrong-service');
  assert.equal(wrong.monitor.view().text, 'Wrong service');
  assert.equal(wrong.monitor.view().showStart, true);

  const down = harness({ statuses: [st('not-running')], starts: [new TypeError('Failed to fetch')] });
  await down.monitor.open();
  assert.equal(down.monitor.view().reason, 'Could not ask the dev server to start it (Failed to fetch).');
  assert.equal(down.monitor.view().showStart, true);

  const startedThenCrashed = harness({ statuses: [st('not-running'), st('not-running', { reason: 'The layout service stopped (exit code 2) before it was ready.' })], starts: [{ status: 202, body: st('starting').body }] });
  await startedThenCrashed.monitor.open();
  await startedThenCrashed.advance(3000);
  assert.deepEqual(startedThenCrashed.monitor.view(), { shown: true, state: 'not-running', text: 'Not running', reason: 'The layout service stopped (exit code 2) before it was ready.', showStart: true, checking: false });
  assert.equal(startedThenCrashed.calls.filter((c) => c === START).length, 1, 'never started again on its own');
  assert.equal(startedThenCrashed.timers.length, 0);
});

await test('3. a service that stays Starting: the app gives up after the dev server\'s limit (startTimeoutMs) and shows the button', async () => {
  const h = harness({ statuses: [st('not-running'), st('starting')], starts: [{ status: 202, body: st('starting').body }] });
  await h.monitor.open();
  await h.advance(8999);
  assert.equal(h.monitor.view().state, 'starting');
  await h.advance(3001);
  assert.deepEqual(h.monitor.view(), { shown: true, state: 'not-running', text: 'Not running', reason: 'It did not become ready within 9 s. See the dev server\'s output, then press Start layout service or Check.', showStart: true, checking: false });
  assert.equal(h.timers.length, 0);
  assert.equal(h.calls.filter((c) => c === STATUS).length, 3, 'read on open and at 3 and 6 s; at 9 s it gives up without asking');
});

await test('4. Check re-reads the state and never starts the service itself; while Starting it resumes polling; Busy and Ready need no button', async () => {
  const h = harness({ statuses: [st('ready'), st('not-running'), st('busy'), st('starting'), st('ready')] });
  await h.monitor.open();
  assert.equal(h.monitor.view().state, 'ready');
  assert.deepEqual(h.calls, [STATUS], 'Ready: nothing started');
  await h.monitor.check();
  assert.equal(h.monitor.view().state, 'not-running');
  assert.equal(h.monitor.view().showStart, true);
  assert.ok(!h.calls.includes(START), 'Check never starts it');
  await h.monitor.check();
  assert.deepEqual([h.monitor.view().text, h.monitor.view().showStart], ['Busy', false]);
  await h.monitor.check();
  assert.equal(h.monitor.view().text, 'Starting…');
  await h.advance(3000);
  assert.equal(h.monitor.view().state, 'ready');
  assert.ok(!h.calls.includes(START));
});

await test('5. close() stops polling and drops late answers; fake mode (used: false) and a server without the routes (404) hide the indicator; a status the app cannot read is Not running', async () => {
  const h = harness({ statuses: [st('not-running'), st('starting')], starts: [{ status: 202, body: st('starting').body }] });
  await h.monitor.open();
  h.monitor.close();
  assert.equal(h.timers.length, 0);
  await h.advance(30000);
  assert.deepEqual(h.calls, [STATUS, START]);
  for (const body of [{ status: 200, body: { used: false, reason: 'Fake mode' } }, { status: 404, body: null }]) {
    const hidden = harness({ statuses: [body] });
    await hidden.monitor.open();
    assert.equal(hidden.monitor.view().shown, false);
    assert.deepEqual(hidden.calls, [STATUS], 'nothing started');
  }
  const broken = harness({ statuses: [new TypeError('Failed to fetch')], starts: [new TypeError('Failed to fetch')] });
  await broken.monitor.open();
  assert.equal(broken.monitor.view().state, 'not-running');
  assert.equal(broken.monitor.view().showStart, true);
});

await test('6. against the real routes (tools/layout-control.mjs over HTTP) and a fake layout service process: Not running → Starting… → Ready', async () => {
  const tmp = mkdtempSync(path.join(os.tmpdir(), 'rs-3046-lb-'));
  const fake = path.join(tmp, 'fake.mjs');
  writeFileSync(fake, `import { createServer } from 'node:http';
setInterval(() => {}, 1000);
const body = { ok: true, service: '${LAYOUT_SERVICE_NAME}', modelsLoaded: true, version: '9.9.9', busy: false };
setTimeout(() => createServer((req, res) => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)); }).listen(Number(process.env.LAYOUT_PORT), '127.0.0.1'), 300);
`);
  const layoutPort = await new Promise((resolve) => { const s = createNetServer().listen(0, () => { const { port } = s.address(); s.close(() => resolve(port)); }); });
  const control = createLayoutServiceControl({ url: `http://127.0.0.1:${layoutPort}`, expectedVersion: '9.9.9', env: { PATH: process.env.PATH }, layoutCommand: [process.execPath, fake], pollMs: 50, log: () => {} });
  const server = createServer((req, res) => { if (!control.handle(req, res, req.url)) { res.writeHead(404); res.end(); } });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const seen = [];
  try {
    const monitor = createLayoutServiceMonitor({ fetch: (url, options) => fetch(base + url, options), pollMs: 100, onChange: (v) => seen.push(v.text) });
    await monitor.open();
    assert.equal(monitor.view().text, 'Starting…', monitor.view().reason);
    const end = Date.now() + 8000;
    while (monitor.view().state !== 'ready' && Date.now() < end) await new Promise((r) => setTimeout(r, 50));
    assert.equal(monitor.view().state, 'ready', seen.join(' → '));
    assert.equal(seen[0], 'Starting…');
    monitor.close();
  } finally {
    await control.stop();
    server.closeAllConnections();
    await new Promise((r) => server.close(r));
    rmSync(tmp, { recursive: true, force: true });
  }
});

// ---- the redraw button ----------------------------------------------------------------------------

const LEGACY = { id: 'image2', type: 'image', fillMode: 'staggered' };
await test('7. imageStudioState(): Starting makes the redraw button wait; Not running and Wrong service say the old method; Ready, Busy and unknown leave it as it was', () => {
  const on = { available: true, runningLayerId: null };
  const row = (layer, options) => { const s = imageStudioState(layer, options); return [s.redrawButton, s.redrawLabel, s.redrawWaits, s.oldMethod]; };
  assert.deepEqual(row(LEGACY, { ...on, layoutService: 'ready' }), ['Redraw with AI', 'Redraw with AI', false, false]);
  assert.deepEqual(row(LEGACY, { ...on, layoutService: 'busy' }), ['Redraw with AI', 'Redraw with AI', false, false]);
  assert.deepEqual(row(LEGACY, { ...on, layoutService: null }), ['Redraw with AI', 'Redraw with AI', false, false]);
  assert.deepEqual(row(LEGACY, { ...on, layoutService: 'starting' }), ['Redraw with AI', 'Redraw with AI', true, false]);
  assert.deepEqual(row(LEGACY, { ...on, layoutService: 'not-running' }), ['Redraw with AI', 'Redraw with AI (old method)', false, true]);
  assert.deepEqual(row(LEGACY, { ...on, layoutService: 'wrong-service' }), ['Redraw with AI', 'Redraw with AI (old method)', false, true]);
  assert.deepEqual(row(LEGACY, { ...on, failed: true, layoutService: 'not-running' }), ['Try again', 'Try again (old method)', false, true], 'the action stays "Try again", so its confirm still asks');
  assert.deepEqual(row(LEGACY, { ...on, available: false, layoutService: 'starting' }), [null, null, false, false], 'no button, nothing to wait for');
});

function fakeElements() {
  const els = {};
  const el = (id) => (els[id] ??= { id, hidden: false, disabled: false, textContent: '', title: '', style: {}, dataset: {}, classList: { toggle() {}, add() {}, remove() {} } });
  return { els, el };
}

await test('8. app.js: syncImageRedrawControls() shows the label and disables the button while it waits; the click handler still keys on the action', () => {
  const sync = extractFunction('function syncImageRedrawControls(l){');
  const run = (layoutService) => {
    const { els, el } = fakeElements();
    new Function('el', 'imageStudioStateFor', 'redrawAvailabilityRequested', 'redrawRun', 'syncImageRedrawLook', `return ${sync};`)(
      el, (l) => imageStudioState(l, { available: true, layoutService }), true, null, () => {})({ ...LEGACY });
    return [els.imageRedraw.textContent, els.imageRedraw.disabled];
  };
  assert.deepEqual(run('starting'), ['Redraw with AI', true]);
  assert.deepEqual(run('not-running'), ['Redraw with AI (old method)', false]);
  assert.deepEqual(run('ready'), ['Redraw with AI', false]);
  assert.ok(appJs.includes("function imageStudioStateFor(l){return imageStudioState(l,{available:Boolean(redrawAvailability&&redrawAvailability.available),runningLayerId,failed:Boolean(l)&&redrawFailedLayerIds.has(l.id),layoutService:layoutServiceStateForRedraw()})}"));
  const stateFor = new Function('layoutServiceMonitor', `return ${extractFunction('function layoutServiceStateForRedraw(){')};`);
  assert.equal(stateFor({ view: () => ({ shown: true, state: 'starting' }) })(), 'starting');
  assert.equal(stateFor({ view: () => ({ shown: false, state: null }) })(), null, 'fake mode: no rule');
  assert.match(lineOf(/el\('imageRedraw'\)\.onclick=\(\)=>\{[^\n]*/), /state\.redrawButton==='Try again'/);
});

await test('9. app.js: renderLayoutServiceIndicator() shows the state, the reason with what a redraw does, Start only when asked, and hides it all when not used', () => {
  const hints = lineOf(/const LAYOUT_SERVICE_REDRAW_HINTS=\{[^\n]*\};/);
  const render = extractFunction('function renderLayoutServiceIndicator(){');
  const run = (view) => {
    const { els, el } = fakeElements();
    new Function('el', 'layoutServiceMonitor', `${hints}\n${render}\nrenderLayoutServiceIndicator();`)(el, { view: () => view });
    return els;
  };
  const starting = run({ shown: true, state: 'starting', text: 'Starting…', reason: 'Loading.', showStart: false, checking: false });
  assert.equal(starting.layoutServiceIndicator.hidden, false);
  assert.equal(starting.layoutServiceIndicator.dataset.state, 'starting');
  assert.equal(starting.layoutServiceState.textContent, 'Starting…');
  assert.equal(starting.layoutServiceReason.textContent, 'Loading. The redraw button waits until it is ready.');
  assert.equal(starting.layoutServiceState.title, starting.layoutServiceReason.textContent, 'the reason on hover too');
  assert.equal(starting.layoutServiceStart.hidden, true);
  const down = run({ shown: true, state: 'not-running', text: 'Not running', reason: 'Nothing answers.', showStart: true, checking: true });
  assert.equal(down.layoutServiceReason.textContent, 'Nothing answers. Until it is ready, a redraw places its stones with the old method.');
  assert.equal(down.layoutServiceStart.hidden, false);
  assert.equal(down.layoutServiceCheck.disabled, true, 'Check waits for the read in progress');
  const ready = run({ shown: true, state: 'ready', text: 'Ready', reason: 'Answers.', showStart: false, checking: false });
  assert.equal(ready.layoutServiceReason.textContent, 'Answers.');
  const hidden = run({ shown: false, state: null, text: '', reason: '', showStart: false, checking: false });
  assert.equal(hidden.layoutServiceIndicator.hidden, true);
  assert.equal(hidden.layoutServiceState, undefined, 'nothing else touched');
});

await test('10. app.js: the lightbox opens on Tinted for an ai-layout layer and starts the indicator only where a redraw provider is available; closing stops it; Check and Start call the monitor', async () => {
  const open = extractFunction('async function openLayoutServiceIndicator(){');
  const run = async (available, isOpen) => {
    const log = [];
    await new Function('getRedrawAvailability', 'lightboxes', 'layoutServiceMonitor', `return ${open};`)(
      async () => ({ available }), { imagetrace: { isOpen } }, { open: () => log.push('open') })();
    return log;
  };
  assert.deepEqual(await run(true, true), ['open']);
  assert.deepEqual(await run(false, true), [], 'no redraw provider: no indicator, nothing started');
  assert.deepEqual(await run(true, false), [], 'closed meanwhile');
  const lightbox = lineOf(/ {2}imagetrace:new Lightbox\('lightboxImageTrace',[^\n]*/);
  assert.ok(lightbox.includes('onOpen(){activeFieldLightbox=\'imagetrace\';relocateFieldGroups();showTintedForAiLayout();renderImageStudio();openLayoutServiceIndicator()}'));
  assert.ok(lightbox.includes('onClose(){activeFieldLightbox=null;layoutServiceMonitor.close();studioTintedCache.cancel();'));
  assert.ok(appJs.includes("el('layoutServiceCheck').onclick=()=>layoutServiceMonitor.check();"));
  assert.ok(appJs.includes("el('layoutServiceStart').onclick=()=>layoutServiceMonitor.start();"));
  const show = extractFunction('function showTintedForAiLayout(){');
  for (const [layer, expected] of [[{ id: 'a', type: 'image', fillMode: 'ai-layout', aiLayout: FAKE_LAYOUT }, ['tinted']], [{ ...LEGACY }, []], [null, []]]) {
    const views = [];
    new Function('selectedLayer', 'imageStudioStateFor', 'setImageStudioView', `${show}\nshowTintedForAiLayout();`)(() => layer, (l) => imageStudioState(l, { available: true }), (v) => views.push(v));
    assert.deepEqual(views, expected);
  }
  // The redraw's own result: Source while it runs, then Tinted (tools/test-img-026-lightbox.mjs test 9 runs it).
  assert.ok(extractFunction('async function startImageRedraw(){').includes("if(layout){redrawFailedLayerIds.delete(layerId);setImageStudioView('tinted')}"));
});

await test('11. index.html: the indicator (state, Check, reason, Start) above the redraw buttons, hidden by default; Tinted next to Template, hidden until an ai-layout layer', () => {
  const box = indexHtml.slice(indexHtml.indexOf('<div id="layoutServiceIndicator"'), indexHtml.indexOf('<div class="image-redraw-row">'));
  assert.ok(box.startsWith('<div id="layoutServiceIndicator" class="layout-service" hidden>'));
  for (const id of ['layoutServiceState', 'layoutServiceCheck', 'layoutServiceReason', 'layoutServiceStart']) assert.ok(box.includes(`id="${id}"`), id);
  assert.ok(box.includes('<button id="layoutServiceStart" class="btn sm" type="button" hidden>Start layout service</button>'));
  assert.ok(box.includes('>Check</button>'));
  assert.ok(indexHtml.indexOf('.layout-service[hidden],.layout-service [hidden]{display:none}') > indexHtml.indexOf('.layout-service-line{'), '[hidden] wins');
  assert.ok(indexHtml.includes('<label id="imageStudioViewTinted" hidden><input type="radio" name="imageStudioView" value="tinted">Tinted</label>\n          <label><input type="radio" name="imageStudioView" value="template" checked>Template</label>'));
});

// ---- the Tinted view ------------------------------------------------------------------------------

// A fake 2D canvas (as test-img-026-tinted-view.mjs): records arcs, drawImage and fillRect, keeps
// ImageData pixels.
function fakeCanvas(width = 0, height = 0) {
  const calls = { arc: 0, drawImage: [], fillRect: [] };
  let pixels = new Uint8ClampedArray(width * height * 4);
  const canvas = { width, height, clientWidth: width, clientHeight: height, calls };
  const target = {
    canvas,
    arc() { calls.arc++; },
    createRadialGradient() { return { addColorStop() {} }; },
    createLinearGradient() { return { addColorStop() {} }; },
    createImageData(w, h) { return { width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }; },
    putImageData(img) { pixels = new Uint8ClampedArray(img.data); },
    getImageData(x, y, w, h) { return { width: w, height: h, data: w === canvas.width && h === canvas.height ? new Uint8ClampedArray(pixels) : new Uint8ClampedArray(w * h * 4) }; },
    drawImage(img, x, y) { calls.drawImage.push({ img, x, y }); },
    fillRect(...args) { calls.fillRect.push({ fill: target.fillStyle, args }); },
    measureText() { return { width: 10 }; }
  };
  const ctx = new Proxy(target, { get: (o, k) => (k in o ? o[k] : () => {}), set: (o, k, v) => { o[k] = v; return true; } });
  canvas.getContext = () => ctx;
  return canvas;
}

// An inert value for every name renderImageStudio() reads that the harness does not list.
const stub = new Proxy(function stubFn() {}, {
  get: (t, k) => (k === 'then' || k === Symbol.unscopables ? undefined : k === Symbol.toPrimitive ? () => '' : stub),
  apply: () => stub,
  construct: () => stub,
  set: () => true
});

const engine = new GeometryEngine();
// One ai-layout layer as a redraw leaves it, its stones from the one GeometryEngine.
function aiLayer(aiLayout, look) {
  const l = { id: 'img1', type: 'image', fillMode: 'ai-layout', x: 10, y: 12, w: aiLayout.widthMm, h: aiLayout.heightMm, rotationDeg: 0, imageSrc: 'data:image/png;base64,AI', imageName: 'cat.png', naturalWidthPx: 1024, naturalHeightPx: 1024, aiLayout: structuredClone(aiLayout), colorSwaps: {}, redraw: { originalImageSrc: 'data:image/png;base64,ORIG', style: look === 'bw' ? 'bold' : 'stones' }, ...(look === 'bw' ? { redrawMode: 'bw', redrawBwStyle: 'bold' } : {}) };
  const generated = engine.generateImageLayout({ mode: 'ai-layout', layerId: l.id, xMm: l.x, yMm: l.y, widthMm: l.w, rotationDeg: 0, aiLayout: l.aiLayout, colorSwaps: l.colorSwaps });
  return { l, layout: new StoneLayout({ layerId: 'all', stones: generated.stones }) };
}

// renderImageStudio() and drawStudioTinted() from app.js, run with the real renderer, cache and
// state, on a fake canvas. Returns render(view) and what it saw.
function studio({ l, layout, sliceMs = Infinity }) {
  const canvas = fakeCanvas(600, 480);
  const views = { value: 'template' };
  const { els, el } = fakeElements();
  els.imageStudioCanvas = canvas;
  els.imageStudioView = { querySelector: (q) => (q === 'input:checked' ? { value: views.value } : null) };
  const queue = [];
  const gaps = [];
  let ready = 0;
  const cache = new TintedViewCache({ createCanvas: (w, h) => fakeCanvas(w, h), schedule: (fn) => queue.push(fn), sliceMs, onReady: () => ready++ });
  const realGet = cache.get.bind(cache);
  cache.get = (stones, options) => { gaps.push([...options.crystalGap]); return realGet(stones, options); };
  const project = { units: 'mm', layers: [l] };
  const writes = [];
  const deps = {
    lightboxes: { imagetrace: { isOpen: true } }, el, window: { devicePixelRatio: 1 }, layout, project, engine: { generateImageStonesLive: async () => ({ checkFixStats: null, cleanupStats: null, aiLayoutStats: { minGapMm: 0.2, violations: 0, k: 1 } }) },
    imageStudioRenderToken: 0, currentObjectTemplate: () => ({ id: 'mug' }), selectedLayer: () => l,
    imageStudioStateFor: (x) => imageStudioState(x, { available: true }), applyImageStudioState: () => {}, renderAiLayoutColourRows: () => {}, syncImageRedrawControls: () => {},
    resolveImageFillMode: (v) => v, rotatedCornersAABB: (x, y, w, h) => ({ x, y, width: w, height: h }), fitTransform, StoneLayout, renderStoneLayout,
    loadStudioImageElement: (src) => ({ src, complete: true, naturalWidth: 10, naturalHeight: 10 }), letterboxToBoxAspect: (img) => img, aiLayoutImageBox: () => undefined,
    computeImageColorField: () => null, imageCleanupStatsText: () => '', drawGapViolationRings: () => {}, redrawLookOf, studioTintedCache: cache,
    commitHistory: () => writes.push('commitHistory'), scheduleAutosave: () => writes.push('scheduleAutosave'), updateAll: () => writes.push('updateAll')
  };
  const scope = new Proxy(deps, {
    has: (t, k) => k in t || !(k in globalThis),
    get: (t, k) => (k in t ? t[k] : k === Symbol.unscopables ? undefined : stub),
    set: (t, k, v) => { t[k] = v; return true; }
  });
  // Sloppy-mode `with`: app.js's own source runs, and only the names above are real.
  const { renderImageStudio } = new Function('scope', `with (scope) { ${extractFunction('function drawStudioTinted(ctx,l,stones,t){')}\nreturn { renderImageStudio: (${extractFunction('async function renderImageStudio(){')}) }; }`)(scope);
  const render = async (view) => {
    views.value = view;
    canvas.calls.drawImage.length = 0; canvas.calls.fillRect.length = 0; canvas.calls.arc = 0;
    await renderImageStudio();
    return { drawImage: canvas.calls.drawImage.map((c) => c.img.src ?? 'bitmap'), white: canvas.calls.fillRect.some((c) => c.fill === '#fbfdff'), arcs: canvas.calls.arc };
  };
  return { render, gaps, queue, ready: () => ready, writes, project };
}
const snapshot = (layout) => JSON.stringify(layout.stones.map((s) => s.toJSON()));

for (const [name, aiLayout, look, crystal] of [['Colour', FAKE_LAYOUT, 'colour', 0], ['Black & white', FAKE_LAYOUT_BW, 'bw', 1]]) {
  await test(`12. ${name}: Tinted draws IMG-026Q's bitmap on white (crystal gap rule ${crystal ? 'on' : 'off'}), and the switch goes to the plain stones and the original image; no stone, layer or project field changes`, async () => {
    const { l, layout } = aiLayer(aiLayout, look);
    assert.equal(layout.stones.length, 193);
    const before = { stones: snapshot(layout), layer: JSON.stringify(l) };
    const s = studio({ l, layout });
    const tinted = await s.render('tinted');
    assert.deepEqual(tinted.drawImage, ['bitmap'], 'the tinted bitmap, drawn once');
    assert.ok(tinted.white, 'on the 2D canvas\'s Tinted white');
    assert.equal(s.gaps.length, 1);
    assert.equal(s.gaps[0].length, 193);
    assert.ok(s.gaps[0].every((v) => v === crystal), `crystal gap ${crystal ? 'for every' : 'for no'} stone`);
    const plain = await s.render('template');
    assert.deepEqual(plain.drawImage, [], 'Template: no bitmap');
    assert.ok(plain.arcs >= 193, 'Template draws the stones themselves');
    const original = await s.render('source');
    assert.deepEqual(original.drawImage, ['data:image/png;base64,ORIG'], 'Source shows the original image');
    const back = await s.render('tinted');
    assert.deepEqual(back.drawImage, ['bitmap']);
    assert.equal(s.gaps.length, 2);
    assert.equal(snapshot(layout), before.stones, 'the StoneLayout is unchanged');
    assert.equal(JSON.stringify(l), before.layer, 'the layer (aiLayout stones included) is unchanged');
    assert.deepEqual(s.project.layers, [l]);
    assert.deepEqual(s.writes, [], 'no history step, autosave or regenerate');
  });
}

await test('13. until the sliced render is done, Tinted shows the plain stones, then the cache asks for a redraw; leaving Tinted cancels a render in progress', async () => {
  const { l, layout } = aiLayer(FAKE_LAYOUT, 'colour');
  const s = studio({ l, layout, sliceMs: 0 });
  const first = await s.render('tinted');
  assert.deepEqual(first.drawImage, [], 'no bitmap yet');
  assert.ok(first.arcs >= 193, 'the plain stones meanwhile');
  assert.ok(s.queue.length > 0, 'the rest is scheduled');
  await s.render('template');
  const left = s.queue.splice(0);
  for (const fn of left) fn();
  assert.equal(s.ready(), 0, 'cancelled: no redraw asked');
  await s.render('tinted');
  while (s.queue.length) s.queue.shift()();
  assert.equal(s.ready(), 1, 'onReady once');
  const done = await s.render('tinted');
  assert.deepEqual(done.drawImage, ['bitmap']);
  assert.ok(appJs.includes('const studioTintedCache=new TintedViewCache({createCanvas:(w,h)=>{const c=document.createElement(\'canvas\');c.width=w;c.height=h;return c},onReady:()=>renderImageStudio()});'));
});

await test('14. view only: the lightbox view is not a history control, the studio canvas is in no export, and exports still go through withoutTintedView()', () => {
  const tracked = lineOf(/const HISTORY_TRACKED_CONTROL_IDS=\[[^\]]*\]/);
  for (const id of ['imageStudioView', 'layoutServiceCheck', 'layoutServiceStart']) assert.ok(!tracked.includes(`'${id}'`), id);
  const uses = appJs.split("el('imageStudioCanvas')").length - 1;
  assert.equal(uses, 1, 'only renderImageStudio() reads the studio canvas');
  assert.ok(extractFunction('async function renderImageStudio(){').includes("el('imageStudioCanvas')"));
  assert.ok(appJs.includes("withoutTintedView(()=>exportCanvas('rhinestone-layout.png',layoutCanvas))"));
  assert.ok(appJs.includes("withoutTintedView(()=>exportCanvas('rhinestone-combined-preview.png',composeCombinedPreviewCanvas()))"));
});

await test('Registered in tools/test-groups.mjs (integration)', () => {
  assertTestRegistered({ filename: 'test-rs-3046-lightbox.mjs', group: 'integration', includedInDefault: true });
});

if (process.exitCode !== 1) console.log('RS-3046 lightbox tests passed.');
