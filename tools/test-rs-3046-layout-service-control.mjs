// RS-3046: the dev server's layout service routes (tools/layout-control.mjs, wired in
// tools/dev-server.mjs): GET /api/layout-service/status and POST /api/layout-service/start.
// In-process cases drive createLayoutServiceControl() with fake services (small Node HTTP servers
// answering GET /health, as RS-3043's test does) and a fake layout command. The real-process cases
// run the real dev server from a copy of tools/ whose start_layout.sh (real, under caffeinate on
// macOS) finds a fake venv whose uvicorn is the fake service. No Python, no OpenAI, nothing beyond
// 127.0.0.1 (the remote cases use a .invalid host, which never resolves).
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { createServer as createHttpServer } from 'node:http';
import { connect, createServer as createNetServer } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  LAYOUT_SERVICE_LABELS, LAYOUT_SERVICE_NAME, LAYOUT_SERVICE_ROUTES, createLayoutServiceControl, isLocalRequest, isLoopbackAddress,
  layoutServiceTarget
} from './layout-control.mjs';
import { START_TIMEOUT_MS } from './studio.mjs';
import { assertTestRegistered } from './lib/test-registration-assertions.mjs';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const tmp = mkdtempSync(path.join(os.tmpdir(), 'rs-3046-'));
const VERSION = '9.9.9';

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

// --- fakes ---------------------------------------------------------------------------------------

// The fake layout service (FAKE_MODE or argv[2]): ok (listens after 300 ms, as uvicorn opens the port
// only once models are loaded), crash (exits 2 at once), silent (never listens). Writes its pid.
const FAKE_SERVICE = path.join(tmp, 'fake-service.mjs');
writeFileSync(FAKE_SERVICE, `
import { createServer } from 'node:http';
import { writeFileSync } from 'node:fs';
const mode = process.argv[2] || process.env.FAKE_MODE || 'ok';
if (process.env.FAKE_PID_FILE) writeFileSync(process.env.FAKE_PID_FILE, String(process.pid));
if (mode === 'crash') process.exit(2);
setInterval(() => {}, 1000);
if (mode !== 'silent') {
  const body = { ok: true, service: '${LAYOUT_SERVICE_NAME}', modelsLoaded: true, version: process.env.FAKE_VERSION, busy: false };
  const server = createServer((req, res) => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)); });
  setTimeout(() => server.listen(Number(process.env.LAYOUT_PORT), '127.0.0.1'), 300);
}
`);

let caseNo = 0;
function freePort() {
  return new Promise((resolve) => {
    const s = createNetServer().listen(0, () => { const { port } = s.address(); s.close(() => resolve(port)); });
  });
}
function portTaken(port) {
  return new Promise((resolve) => {
    const socket = connect(port, '127.0.0.1');
    socket.once('connect', () => { socket.destroy(); resolve(true); });
    socket.once('error', () => resolve(false));
  });
}
function alive(pid) {
  try { process.kill(pid, 0); return true; } catch { return false; }
}
async function waitFor(check, ms = 8000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await check()) return true;
    await new Promise((r) => setTimeout(r, 50));
  }
  return false;
}
const RS_HEALTH = { ok: true, service: LAYOUT_SERVICE_NAME, modelsLoaded: true, version: VERSION, busy: false };
async function standingService(port, body) {
  const server = createHttpServer((req, res) => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)); });
  await new Promise((r) => server.listen(port, '127.0.0.1', r));
  return { server, close: () => { server.closeAllConnections(); return new Promise((r) => server.close(r)); } };
}

// One in-process control. `service` is the fake mode its layout command starts, or null for a
// command that must never run (it touches neverFile).
async function setup({ service = 'ok', url, fake = false, startTimeoutMs = 3000 } = {}) {
  const n = ++caseNo;
  const port = await freePort();
  const pidFile = path.join(tmp, `service-${n}.pid`);
  const neverFile = path.join(tmp, `never-${n}`);
  const logs = [];
  const control = createLayoutServiceControl({
    url: url === undefined ? `http://127.0.0.1:${port}` : url,
    fake,
    env: { PATH: process.env.PATH, FAKE_PID_FILE: pidFile, FAKE_VERSION: VERSION },
    expectedVersion: VERSION,
    startTimeoutMs,
    pollMs: 100,
    layoutCommand: service ? ['/bin/sh', '-c', `"${process.execPath}" "${FAKE_SERVICE}" ${service}; exit $?`] : ['/bin/sh', '-c', `touch "${neverFile}"`],
    log: (line) => logs.push(line)
  });
  return { n, port, pidFile, neverFile, logs, control };
}

// A request/response pair for control.handle(): resolves { status, body } once answered.
function call(control, { path: routePath, method = 'GET', remoteAddress = '127.0.0.1', host = 'localhost:5174', origin } = {}) {
  return new Promise((resolve) => {
    const headers = { host, ...(origin === undefined ? {} : { origin }) };
    const res = {
      statusCode: 0, headers: {},
      setHeader(k, v) { this.headers[k.toLowerCase()] = v; },
      writeHead(status, h) { this.statusCode = status; Object.assign(this.headers, h); },
      end(text) { resolve({ status: this.statusCode, body: JSON.parse(text), headers: this.headers }); }
    };
    const handled = control.handle({ method, headers, socket: { remoteAddress } }, res, routePath);
    if (!handled) resolve(null);
  });
}

// --- units ---------------------------------------------------------------------------------------

await test('1. loopback only: loopback addresses, a loopback Host and no other site\'s Origin; local URL means 127.0.0.1 or localhost', () => {
  for (const a of ['127.0.0.1', '127.1.2.3', '::1', '::ffff:127.0.0.1']) assert.equal(isLoopbackAddress(a), true, a);
  for (const a of ['192.168.1.20', '10.0.0.2', '::ffff:192.168.1.20', 'fe80::1', '', undefined, '1127.0.0.1']) assert.equal(isLoopbackAddress(a), false, String(a));
  const req = (remoteAddress, host, origin) => ({ socket: { remoteAddress }, headers: { host, ...(origin ? { origin } : {}) } });
  assert.equal(isLocalRequest(req('127.0.0.1', 'localhost:5173')), true);
  assert.equal(isLocalRequest(req('::1', '[::1]:5173')), true);
  assert.equal(isLocalRequest(req('127.0.0.1', '127.0.0.1:5173', 'http://127.0.0.1:5173')), true, 'the app itself');
  assert.equal(isLocalRequest(req('192.168.1.20', 'imac.local:5173')), false, 'another machine');
  assert.equal(isLocalRequest(req('192.168.1.20', 'localhost:5173')), false, 'another machine naming localhost');
  assert.equal(isLocalRequest(req('127.0.0.1', 'evil.example:5173')), false, 'DNS rebinding');
  assert.equal(isLocalRequest(req('127.0.0.1', 'localhost:5173', 'http://evil.example')), false, 'another web page');
  assert.equal(isLocalRequest(req('127.0.0.1', 'localhost:5173', 'http://localhost:8080')), false, 'another local page');
  assert.deepEqual(layoutServiceTarget('http://127.0.0.1:8001'), { local: true, port: 8001 });
  assert.deepEqual(layoutServiceTarget('http://localhost:8002/'), { local: true, port: 8002 });
  assert.deepEqual(layoutServiceTarget('http://localhost'), { local: true, port: null });
  assert.deepEqual(layoutServiceTarget('http://layout.example.com:8001'), { local: false, port: 8001 });
  assert.deepEqual(layoutServiceTarget('http://192.168.1.5:8001'), { local: false, port: 8001 });
  assert.equal(layoutServiceTarget(''), null);
  assert.equal(layoutServiceTarget('not a url'), null);
  assert.deepEqual(LAYOUT_SERVICE_LABELS, { ready: 'Ready', busy: 'Busy', starting: 'Starting', 'not-running': 'Not running', 'wrong-service': 'Wrong service' });
});

await test('2. both routes refuse a request from another machine, another Host or another page (403) and answer this Mac; other paths are not theirs; wrong methods get 405', async () => {
  const s = await setup({ service: null });
  for (const routePath of Object.values(LAYOUT_SERVICE_ROUTES)) {
    const method = routePath === LAYOUT_SERVICE_ROUTES.start ? 'POST' : 'GET';
    for (const bad of [{ remoteAddress: '192.168.1.20' }, { host: 'evil.example:5174' }, { origin: 'http://evil.example' }]) {
      const r = await call(s.control, { path: routePath, method, ...bad });
      assert.equal(r.status, 403, JSON.stringify(bad));
      assert.deepEqual(r.body, { error: 'forbidden', message: 'The layout service routes answer only to this Mac.' });
    }
  }
  assert.equal(existsSync(s.neverFile), false, 'a refused start started nothing');
  assert.equal((await call(s.control, { path: LAYOUT_SERVICE_ROUTES.status, origin: 'http://localhost:5174' })).status, 200);
  assert.equal((await call(s.control, { path: LAYOUT_SERVICE_ROUTES.status, method: 'POST' })).status, 405);
  assert.equal((await call(s.control, { path: LAYOUT_SERVICE_ROUTES.start, method: 'GET' })).status, 405);
  assert.equal(await call(s.control, { path: '/api/redraw/config' }), null);
});

// --- status --------------------------------------------------------------------------------------

await test('3. status: Ready, Busy, Starting (models loading), Not running, Wrong service (another service, an older RS) and their reasons', async () => {
  const s = await setup({ service: null });
  const url = `http://127.0.0.1:${s.port}`;
  const status = async () => (await call(s.control, { path: LAYOUT_SERVICE_ROUTES.status })).body;
  const nothing = await status();
  assert.deepEqual(nothing, { used: true, state: 'not-running', label: 'Not running', reason: `Nothing answers at ${url}.`, url, startTimeoutMs: 3000, canStart: true, startedHere: false });
  const cases = [
    [RS_HEALTH, 'ready', `Rhinestone Studio's layout service ${VERSION} answers at ${url}.`],
    [{ ...RS_HEALTH, busy: true }, 'busy', 'It is placing the stones of another redraw; the next layout waits for it.'],
    [{ ...RS_HEALTH, modelsLoaded: false }, 'starting', `It answers at ${url} and is loading its models; this takes about a minute.`],
    [{ ok: true, version: '1.2.0' }, 'wrong-service', `Another service answers at ${url}; it is not Rhinestone Studio's layout service. Stop it, or set LAYOUT_SERVICE_URL to another port (for example http://127.0.0.1:8002).`],
    [{ ...RS_HEALTH, version: '0.1.0' }, 'wrong-service', `An older Rhinestone Studio layout service (version 0.1.0; this checkout has ${VERSION}) answers at ${url}. Stop it, then start it again.`]
  ];
  for (const [body, state, reason] of cases) {
    const standing = await standingService(s.port, body);
    try {
      const got = await status();
      assert.equal(got.state, state, state);
      assert.equal(got.label, LAYOUT_SERVICE_LABELS[state]);
      assert.equal(got.reason, reason);
      assert.equal(got.canStart, false);
    } finally { await standing.close(); }
  }
  assert.equal(existsSync(s.neverFile), false, 'reading the state never starts anything');
});

await test('4. status without a URL, with a remote URL (nothing there, or a host that does not resolve), and in fake mode', async () => {
  const unset = await setup({ service: null, url: '' });
  assert.deepEqual(await unset.control.status(), {
    used: true, state: 'not-running', label: 'Not running', url: '', startTimeoutMs: 3000, canStart: false, startedHere: false,
    reason: 'LAYOUT_SERVICE_URL is not set, so redraws are placed with the old method. Set it in .env (for example http://127.0.0.1:8001), or start Rhinestone Studio with npm run studio.'
  });
  const unknownHost = await setup({ service: null, url: 'http://layout.invalid:8001' });
  const unreachable = await unknownHost.control.status();
  assert.equal(unreachable.state, 'not-running');
  assert.match(unreachable.reason, /^Could not reach http:\/\/layout\.invalid:8001 \((ENOTFOUND|EAI_AGAIN)\)\.$/);
  const fake = await setup({ service: null, fake: true });
  assert.deepEqual(await fake.control.status(), { used: false, reason: 'Fake mode (REDRAW_FAKE=1): redraws use a fixed test layout, not the layout service.' });
});

// --- start ---------------------------------------------------------------------------------------

await test('5. start with a local URL and nothing there: 202 Starting, start_layout.sh\'s place taken by the fake, then Ready; a second start does not start a second service', async () => {
  const s = await setup();
  const first = await call(s.control, { path: LAYOUT_SERVICE_ROUTES.start, method: 'POST' });
  assert.equal(first.status, 202);
  assert.equal(first.body.state, 'starting');
  assert.equal(first.body.label, 'Starting');
  assert.equal(first.body.startedHere, true);
  assert.equal(first.body.reason, `The dev server started it on port ${s.port}; it loads its models in about a minute (at most 3 s).`);
  const again = await call(s.control, { path: LAYOUT_SERVICE_ROUTES.start, method: 'POST' });
  assert.equal(again.status, 200, 'already starting');
  assert.ok(await waitFor(async () => (await s.control.status()).state === 'ready'), 'ready');
  const pid = Number(readFileSync(s.pidFile, 'utf8'));
  assert.ok(s.logs[0].startsWith(`Starting the layout service on port ${s.port} for the Image → Strass lightbox...`), s.logs.join('\n'));
  const ready = await call(s.control, { path: LAYOUT_SERVICE_ROUTES.start, method: 'POST' });
  assert.equal(ready.status, 200);
  assert.equal(ready.body.state, 'ready');
  assert.equal(Number(readFileSync(s.pidFile, 'utf8')), pid, 'the same one service');
  await s.control.stop();
  assert.ok(await waitFor(() => !alive(pid)), 'stop() stops the service it started');
  assert.equal(await portTaken(s.port), false);
});

await test('6. start reuses RS\'s service already running (200, nothing started) and stop() leaves it running', async () => {
  const s = await setup({ service: null });
  const standing = await standingService(s.port, RS_HEALTH);
  try {
    const r = await call(s.control, { path: LAYOUT_SERVICE_ROUTES.start, method: 'POST' });
    assert.equal(r.status, 200);
    assert.equal(r.body.state, 'ready');
    assert.equal(r.body.startedHere, false);
    await s.control.stop();
    assert.equal(existsSync(s.neverFile), false, 'the layout command never ran');
    assert.equal(await portTaken(s.port), true, 'the hand-started service still listens');
  } finally { await standing.close(); }
});

await test('7. start refuses another service on the port, a remote URL, a URL without a port, no URL and fake mode, each with a plain message, and starts nothing', async () => {
  const s = await setup({ service: null });
  const standing = await standingService(s.port, { ok: true, version: '1.2.0' });
  try {
    const r = await call(s.control, { path: LAYOUT_SERVICE_ROUTES.start, method: 'POST' });
    assert.equal(r.status, 409);
    assert.deepEqual(r.body, { error: 'wrong-service', message: `Another service answers at http://127.0.0.1:${s.port}; it is not Rhinestone Studio's layout service. Stop it, or set LAYOUT_SERVICE_URL to another port (for example http://127.0.0.1:8002).` });
  } finally { await standing.close(); }
  const refusals = [
    [{ url: 'http://layout.example.com:8001' }, 'remote', 'The layout service is set to http://layout.example.com:8001, which is not on this Mac, so the dev server does not start it. Start it where it runs.'],
    [{ url: 'http://localhost' }, 'no-port', 'LAYOUT_SERVICE_URL (http://localhost) names no port, so the dev server does not know where to start the layout service. Add one, for example http://127.0.0.1:8001.'],
    [{ url: '' }, 'not-set', 'LAYOUT_SERVICE_URL is not set, so redraws are placed with the old method. Set it in .env (for example http://127.0.0.1:8001), or start Rhinestone Studio with npm run studio.'],
    [{ fake: true }, 'not-used', 'Fake mode (REDRAW_FAKE=1) does not use the layout service.']
  ];
  for (const [options, error, message] of refusals) {
    const c = await setup({ service: null, ...options });
    const r = await call(c.control, { path: LAYOUT_SERVICE_ROUTES.start, method: 'POST' });
    assert.equal(r.status, 409, error);
    assert.deepEqual(r.body, { error, message });
    assert.equal(existsSync(c.neverFile), false, `${error}: nothing started`);
  }
  assert.equal(existsSync(s.neverFile), false);
  const remote = await setup({ service: null, url: 'http://layout.invalid:8001' });
  assert.match((await remote.control.status()).reason, /^Could not reach /, 'a remote URL is only read');
});

await test('8. a started service that stops before it is ready, or never answers within the limit (then stopped): Not running with the reason, and a new start is allowed', async () => {
  const crash = await setup({ service: 'crash' });
  assert.equal((await crash.control.start()).httpStatus, 202);
  assert.ok(await waitFor(async () => (await crash.control.status()).state === 'not-running'));
  const crashed = await crash.control.status();
  assert.equal(crashed.reason, 'The layout service stopped (exit code 2) before it was ready. See the dev server\'s output.');
  assert.equal(crashed.canStart, true);

  const silent = await setup({ service: 'silent', startTimeoutMs: 1000 });
  assert.equal((await silent.control.start()).httpStatus, 202);
  assert.equal((await silent.control.status()).state, 'starting');
  assert.ok(await waitFor(async () => (await silent.control.status()).state === 'not-running', 6000));
  assert.equal((await silent.control.status()).reason, `The layout service did not answer on port ${silent.port} within 1 s, so the dev server stopped it. See the dev server's output.`);
  assert.ok(await waitFor(() => !alive(Number(readFileSync(silent.pidFile, 'utf8')))), 'the silent service is gone');
  assert.equal(START_TIMEOUT_MS, 180000, 'the real limit is npm run studio\'s');
});

// --- the real dev server -------------------------------------------------------------------------

// A copy of the dev server's tools (their root is the copy) next to symlinks to the repo's server/
// and src/, the real start_layout.sh and a fake venv whose uvicorn runs the fake service.
function devTree() {
  const root = path.join(tmp, 'tree');
  if (existsSync(root)) return root;
  mkdirSync(path.join(root, 'tools'), { recursive: true });
  for (const f of ['dev-server.mjs', 'studio.mjs', 'layout-control.mjs']) copyFileSync(path.join(repoRoot, 'tools', f), path.join(root, 'tools', f));
  for (const d of ['server', 'src']) symlinkSync(path.join(repoRoot, d), path.join(root, d));
  const service = path.join(root, 'services/strass-layout');
  mkdirSync(path.join(service, 'scripts'), { recursive: true });
  mkdirSync(path.join(service, 'strass_layout'), { recursive: true });
  mkdirSync(path.join(service, '.venv/bin'), { recursive: true });
  copyFileSync(path.join(repoRoot, 'services/strass-layout/scripts/start_layout.sh'), path.join(service, 'scripts/start_layout.sh'));
  writeFileSync(path.join(service, 'strass_layout/__init__.py'), `__version__ = "${VERSION}"\n`);
  writeFileSync(path.join(service, '.venv/bin/python'), '#!/bin/sh\n');
  writeFileSync(path.join(service, '.venv/bin/uvicorn'), `#!/bin/sh\nexec "${process.execPath}" "${FAKE_SERVICE}"\n`);
  writeFileSync(path.join(service, '.venv/bin/activate'), `PATH="${path.join(service, '.venv/bin')}:$PATH"\n`);
  for (const f of ['scripts/start_layout.sh', '.venv/bin/python', '.venv/bin/uvicorn']) chmodSync(path.join(service, f), 0o755);
  return root;
}

async function startDevServer(layoutPort) {
  const pidFile = path.join(tmp, `dev-service-${++caseNo}.pid`);
  const child = spawn(process.execPath, [path.join(devTree(), 'tools/dev-server.mjs'), '0'], {
    env: { PATH: process.env.PATH, LAYOUT_SERVICE_URL: `http://127.0.0.1:${layoutPort}`, FAKE_PID_FILE: pidFile, FAKE_VERSION: VERSION },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let out = '';
  child.stdout.on('data', (d) => { out += d; });
  child.stderr.on('data', (d) => { out += d; });
  const exited = new Promise((r) => child.once('exit', (code, signal) => r({ code, signal })));
  assert.ok(await waitFor(() => /localhost:(\d+)/.test(out)), out);
  const base = `http://127.0.0.1:${/localhost:(\d+)/.exec(out)[1]}`;
  return { child, exited, base, pidFile, output: () => out };
}

await test('9. the real dev server: POST start from this Mac starts start_layout.sh (under caffeinate on macOS), status reaches Ready, and SIGINT stops that service before the dev server exits', async () => {
  for (const signal of ['SIGINT', 'SIGTERM']) {
    const layoutPort = await freePort();
    const dev = await startDevServer(layoutPort);
    try {
    const started = await fetch(`${dev.base}${LAYOUT_SERVICE_ROUTES.start}`, { method: 'POST' });
    assert.equal(started.status, 202, dev.output());
    assert.equal((await started.json()).state, 'starting');
    assert.ok(await waitFor(async () => (await (await fetch(`${dev.base}${LAYOUT_SERVICE_ROUTES.status}`)).json()).state === 'ready'), dev.output());
    const servicePid = Number(readFileSync(dev.pidFile, 'utf8'));
    assert.ok(alive(servicePid));
    if (process.platform === 'darwin') {
      // The dev server's root is its real path (/private/var/... on macOS), as Node loads it.
      const script = path.join(realpathSync(devTree()), 'services/strass-layout/scripts/start_layout.sh');
      const ps = spawnSync('ps', ['-axo', 'command'], { encoding: 'utf8' }).stdout.split('\n');
      assert.ok(ps.some((line) => line.trim() === `caffeinate -i ${script}`), 'started as caffeinate -i start_layout.sh');
    }
    dev.child.kill(signal);
    assert.deepEqual(await dev.exited, { code: null, signal }, 'it still ends by the signal');
    assert.equal(alive(servicePid), false, `${signal}: the service it started is gone by the time it exits`);
    assert.equal(await portTaken(layoutPort), false);
    assert.match(dev.output(), /Stopping the layout service the dev server started\.\.\./);
    } finally {
      if (dev.child.exitCode === null && dev.child.signalCode === null) { dev.child.kill('SIGINT'); await dev.exited; }
    }
  }
});

await test('10. the real dev server with a hand-started RS service: start does nothing, and stopping the dev server leaves that service running', async () => {
  const layoutPort = await freePort();
  const standing = await standingService(layoutPort, RS_HEALTH);
  try {
    const dev = await startDevServer(layoutPort);
    const r = await fetch(`${dev.base}${LAYOUT_SERVICE_ROUTES.start}`, { method: 'POST' });
    assert.equal(r.status, 200);
    assert.equal((await r.json()).state, 'ready');
    dev.child.kill('SIGINT');
    await dev.exited;
    assert.equal(existsSync(dev.pidFile), false, 'start_layout.sh never ran');
    const health = await (await fetch(`http://127.0.0.1:${layoutPort}/health`)).json();
    assert.equal(health.service, LAYOUT_SERVICE_NAME, 'the hand-started service still answers');
  } finally { await standing.close(); }
});

await test('11. the real dev server refuses a request that names another Host (403) and serves the app as before', async () => {
  const dev = await startDevServer(await freePort());
  try {
    const status = await fetch(`${dev.base}${LAYOUT_SERVICE_ROUTES.status}`, { headers: { Origin: 'http://evil.example' } });
    assert.equal(status.status, 403);
    assert.equal((await fetch(`${dev.base}/tools/dev-server.mjs`)).status, 200);
  } finally {
    dev.child.kill('SIGINT');
    await dev.exited;
  }
});

await test('Registered in tools/test-groups.mjs (integration)', () => {
  assertTestRegistered({ filename: 'test-rs-3046-layout-service-control.mjs', group: 'integration', includedInDefault: true });
});

rmSync(tmp, { recursive: true, force: true });
if (process.exitCode !== 1) console.log('RS-3046 layout service control tests passed.');
