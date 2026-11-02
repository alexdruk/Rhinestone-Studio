// RS-3043: `npm run studio` (tools/studio.mjs) and the layout service's port. Every case runs real
// child processes: a fake layout service (a small Node HTTP server answering GET /health on
// LAYOUT_PORT, like start_layout.sh's uvicorn) and a fake dev server that records the
// LAYOUT_SERVICE_URL it was started with. start_layout.sh itself runs against a fake venv whose
// uvicorn only prints its arguments. No Python, no OpenAI, no network beyond 127.0.0.1.
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer as createHttpServer } from 'node:http';
import { connect, createServer as createNetServer } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { runStudio, layoutPortFrom, repoLayoutVersion, probeLayoutService, DEFAULT_LAYOUT_PORT, LAYOUT_SERVICE_NAME } from './studio.mjs';
import { assertTestRegistered } from './lib/test-registration-assertions.mjs';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const tmp = mkdtempSync(path.join(os.tmpdir(), 'rs-3043-'));
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

// The fake layout service. Modes: ok (listens after 300 ms, answers as RS's service), other (answers
// as a different service), silent (never listens), crash (exits 2 at once), dies (answers ok, then
// exits 3 after 1.5 s). Writes its pid to FAKE_PID_FILE.
const FAKE_SERVICE = path.join(tmp, 'fake-service.mjs');
writeFileSync(FAKE_SERVICE, `
import { createServer } from 'node:http';
import { writeFileSync } from 'node:fs';
const mode = process.argv[2];
if (process.env.FAKE_PID_FILE) writeFileSync(process.env.FAKE_PID_FILE, String(process.pid));
if (mode === 'crash') process.exit(2);
setInterval(() => {}, 1000);
if (mode !== 'silent') {
  const body = mode === 'other' ? { ok: true, version: '1.2.0' } : { ok: true, service: '${LAYOUT_SERVICE_NAME}', modelsLoaded: true, version: process.env.FAKE_VERSION, busy: false };
  const server = createServer((req, res) => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)); });
  setTimeout(() => server.listen(Number(process.env.LAYOUT_PORT), '127.0.0.1'), 300);
  if (mode === 'dies') setTimeout(() => process.exit(3), 1500);
}
`);

// The fake dev server: listens on its port argument and writes { pid, url } to FAKE_DEV_FILE.
// FAKE_DEV_EXIT makes it exit with that code after 1 s.
const FAKE_DEV = path.join(tmp, 'fake-dev.mjs');
writeFileSync(FAKE_DEV, `
import { createServer } from 'node:http';
import { writeFileSync } from 'node:fs';
const server = createServer((req, res) => res.end('dev'));
server.listen(Number(process.argv[2]), () => writeFileSync(process.env.FAKE_DEV_FILE, JSON.stringify({ pid: process.pid, url: process.env.LAYOUT_SERVICE_URL ?? null })));
if (process.env.FAKE_DEV_EXIT) setTimeout(() => process.exit(Number(process.env.FAKE_DEV_EXIT)), 1000);
`);

let caseNo = 0;
function freePort() {
  return new Promise((resolve) => {
    const s = createNetServer().listen(0, () => { const { port } = s.address(); s.close(() => resolve(port)); });
  });
}
// True when something accepts a connection on 127.0.0.1:port (where the layout service listens; the
// dev server listens on every address, 127.0.0.1 included).
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
const readJson = (file) => JSON.parse(readFileSync(file, 'utf8'));

// One studio run with the fakes. `service` is the fake mode, or null to give a layout command that
// must never be started. The shell in front of node makes the service a grandchild, as caffeinate
// and start_layout.sh make uvicorn one.
async function setup({ service = 'ok', devExit, env = {} } = {}) {
  const n = ++caseNo;
  const layoutPort = await freePort();
  const devPort = await freePort();
  const pidFile = path.join(tmp, `service-${n}.pid`);
  const devFile = path.join(tmp, `dev-${n}.json`);
  const neverFile = path.join(tmp, `never-${n}`);
  const layoutCommand = service
    ? ['/bin/sh', '-c', `"${process.execPath}" "${FAKE_SERVICE}" ${service}; exit $?`]
    : ['/bin/sh', '-c', `touch "${neverFile}"`];
  const logs = [];
  const options = {
    env: { PATH: process.env.PATH, LAYOUT_PORT: String(layoutPort), FAKE_PID_FILE: pidFile, FAKE_DEV_FILE: devFile, FAKE_VERSION: VERSION, ...(devExit ? { FAKE_DEV_EXIT: String(devExit) } : {}), ...env },
    devPort,
    layoutCommand,
    devCommand: [process.execPath, FAKE_DEV, String(devPort)],
    expectedVersion: VERSION,
    startTimeoutMs: 2000,
    pollMs: 100,
    log: (line) => logs.push(line)
  };
  return { layoutPort, devPort, pidFile, devFile, neverFile, logs, options };
}

// A fake RS (or other) layout service already listening in this process, as if started by hand.
async function standingService(port, body) {
  const server = createHttpServer((req, res) => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)); });
  await new Promise((r) => server.listen(port, '127.0.0.1', r));
  return server;
}
const RS_HEALTH = { ok: true, service: LAYOUT_SERVICE_NAME, modelsLoaded: true, version: VERSION, busy: false };

// --- the port setting ----------------------------------------------------------------------------

await test('1. LAYOUT_PORT: default 8001, a number is used, anything else is refused with a plain message', () => {
  assert.equal(DEFAULT_LAYOUT_PORT, 8001);
  assert.equal(layoutPortFrom({}), 8001);
  assert.equal(layoutPortFrom({ LAYOUT_PORT: '' }), 8001);
  assert.equal(layoutPortFrom({ LAYOUT_PORT: ' 9123 ' }), 9123);
  for (const bad of ['abc', '0', '65536', '80.5', '-1']) {
    assert.throws(() => layoutPortFrom({ LAYOUT_PORT: bad }), { message: `LAYOUT_PORT must be a port number between 1 and 65535 (it is "${bad}").` });
  }
  assert.match(repoLayoutVersion(repoRoot), /^\d+\.\d+\.\d+$/);
});

await test('2. start_layout.sh runs uvicorn on 127.0.0.1 port LAYOUT_PORT (default 8001, never 8000) and refuses a bad port before anything starts', () => {
  const root = path.join(tmp, 'service-copy');
  mkdirSync(path.join(root, 'scripts'), { recursive: true });
  mkdirSync(path.join(root, '.venv/bin'), { recursive: true });
  copyFileSync(path.join(repoRoot, 'services/strass-layout/scripts/start_layout.sh'), path.join(root, 'scripts/start_layout.sh'));
  writeFileSync(path.join(root, '.venv/bin/python'), '#!/bin/sh\n');
  writeFileSync(path.join(root, '.venv/bin/uvicorn'), '#!/bin/sh\necho "uvicorn $*"\n');
  writeFileSync(path.join(root, '.venv/bin/activate'), `PATH="${path.join(root, '.venv/bin')}:$PATH"\n`);
  for (const f of ['scripts/start_layout.sh', '.venv/bin/python', '.venv/bin/uvicorn']) chmodSync(path.join(root, f), 0o755);
  const run = (env) => spawnSync(path.join(root, 'scripts/start_layout.sh'), { env: { PATH: process.env.PATH, ...env }, encoding: 'utf8' });
  const plain = run({});
  assert.equal(plain.status, 0, plain.stderr);
  assert.equal(plain.stdout.trim(), 'uvicorn app:app --host 127.0.0.1 --port 8001 --workers 1');
  const set = run({ LAYOUT_PORT: '9123' });
  assert.equal(set.stdout.trim(), 'uvicorn app:app --host 127.0.0.1 --port 9123 --workers 1');
  const bad = run({ LAYOUT_PORT: '80a' });
  assert.equal(bad.status, 1);
  assert.equal(bad.stdout, '', 'uvicorn never ran');
  assert.match(bad.stderr, /LAYOUT_PORT must be a port number between 1 and 65535 \(it is "80a"\)\./);
  const script = readFileSync(path.join(repoRoot, 'services/strass-layout/scripts/start_layout.sh'), 'utf8');
  assert.ok(!script.includes('8000') || /PatternNifty/.test(script), 'no 8000 except where it explains why not');
});

await test('3. .env.example and package.json: LAYOUT_SERVICE_URL=http://127.0.0.1:8001; "studio" runs tools/studio.mjs; "dev" is unchanged', () => {
  const lines = readFileSync(path.join(repoRoot, '.env.example'), 'utf8').split('\n');
  assert.ok(lines.includes('LAYOUT_SERVICE_URL=http://127.0.0.1:8001'));
  const pkg = readJson(path.join(repoRoot, 'package.json'));
  assert.equal(pkg.scripts.studio, 'node tools/studio.mjs 5173');
  assert.equal(pkg.scripts.dev, 'node tools/dev-server.mjs 5173');
});

// --- the studio with a fake service --------------------------------------------------------------

await test('4. a service that answers ok: "Starting the layout service...", then the dev server with LAYOUT_SERVICE_URL set (also over a different .env/environment value); stop() ends both and frees both ports', async () => {
  for (const env of [{}, { LAYOUT_SERVICE_URL: 'http://elsewhere:8000' }]) {
    const s = await setup({ env });
    const studio = runStudio(s.options);
    assert.ok(await waitFor(() => existsSync(s.devFile)), 'dev server started');
    const dev = readJson(s.devFile);
    assert.equal(dev.url, `http://127.0.0.1:${s.layoutPort}`);
    const servicePid = Number(readFileSync(s.pidFile, 'utf8'));
    assert.ok(s.logs.some((l) => l.startsWith(`Starting the layout service on port ${s.layoutPort}...`)), s.logs.join('\n'));
    assert.ok(s.logs.includes(`Layout service ready at http://127.0.0.1:${s.layoutPort}.`));
    assert.ok(s.logs.includes(`Rhinestone Studio: http://localhost:${s.devPort}/  Press Ctrl+C to stop.`));
    studio.stop();
    const result = await studio.done;
    assert.deepEqual(result, { code: 0, message: 'Stopped the dev server and the layout service.' });
    assert.ok(await waitFor(() => !alive(servicePid) && !alive(dev.pid)), 'both processes gone');
    assert.equal(await portTaken(s.layoutPort), false);
    assert.equal(await portTaken(s.devPort), false);
  }
});

await test('5. RS\'s service already running on the port (started by hand): reused, not started again, and left running after stop()', async () => {
  const s = await setup({ service: null });
  const standing = await standingService(s.layoutPort, RS_HEALTH);
  try {
    const studio = runStudio(s.options);
    assert.ok(await waitFor(() => existsSync(s.devFile)));
    assert.equal(readJson(s.devFile).url, `http://127.0.0.1:${s.layoutPort}`);
    assert.ok(s.logs.includes(`Using the layout service already running on port ${s.layoutPort}. It keeps running when the studio stops.`));
    assert.ok(!s.logs.some((l) => l.startsWith('Starting the layout service')));
    studio.stop();
    assert.deepEqual(await studio.done, { code: 0, message: 'Stopped the dev server.' });
    assert.equal(existsSync(s.neverFile), false, 'the layout command never ran');
    assert.equal(await portTaken(s.layoutPort), true, 'the hand-started service still listens');
    assert.equal(await portTaken(s.devPort), false);
  } finally {
    standing.closeAllConnections(); await new Promise((r) => standing.close(r));
  }
});

await test('6. another service answers on the port (no RS service name, or an older RS version): stop with a message naming the port; nothing is started', async () => {
  const cases = [
    [{ ok: true, version: '1.2.0' }, (port) => `Another service is answering on port ${port}; it is not Rhinestone Studio's layout service. Stop it, or start the studio on another port: LAYOUT_PORT=8002 npm run studio`],
    [{ ...RS_HEALTH, version: '0.1.0' }, (port) => `An older Rhinestone Studio layout service (version 0.1.0; this checkout has ${VERSION}) is running on port ${port}. Stop it, then run npm run studio again.`]
  ];
  for (const [body, message] of cases) {
    const s = await setup({ service: null });
    const standing = await standingService(s.layoutPort, body);
    try {
      const result = await runStudio(s.options).done;
      assert.deepEqual(result, { code: 1, message: message(s.layoutPort) });
      assert.equal(existsSync(s.neverFile), false);
      assert.equal(existsSync(s.devFile), false, 'no dev server');
    } finally {
      standing.closeAllConnections(); await new Promise((r) => standing.close(r));
    }
  }
  // A non-JSON answer and a port that accepts but never answers count as another service too.
  const s = await setup({ service: null });
  const html = createHttpServer((req, res) => res.end('<html>PatternNifty</html>'));
  await new Promise((r) => html.listen(s.layoutPort, '127.0.0.1', r));
  assert.deepEqual(await probeLayoutService({ url: `http://127.0.0.1:${s.layoutPort}`, expectedVersion: VERSION }), { state: 'other' });
  await new Promise((r) => html.close(r));
  const muted = [];
  const mute = createNetServer((socket) => muted.push(socket));
  await new Promise((r) => mute.listen(s.layoutPort, '127.0.0.1', r));
  assert.deepEqual(await probeLayoutService({ url: `http://127.0.0.1:${s.layoutPort}`, expectedVersion: VERSION, timeoutMs: 300 }), { state: 'other' });
  muted.forEach((socket) => socket.destroy());
  await new Promise((r) => mute.close(r));
  assert.deepEqual(await probeLayoutService({ url: `http://127.0.0.1:${s.layoutPort}`, expectedVersion: VERSION }), { state: 'free' });
});

await test('7. the started service answers as a different one: stop it with the same message', async () => {
  const s = await setup({ service: 'other' });
  const result = await runStudio(s.options).done;
  assert.equal(result.code, 1);
  assert.match(result.message, new RegExp(`^Another service is answering on port ${s.layoutPort};`));
  assert.ok(await waitFor(() => !alive(Number(readFileSync(s.pidFile, 'utf8')))), 'the service is gone');
  assert.equal(existsSync(s.devFile), false);
});

await test('8. a service that never answers: give up after the time limit with a plain message, stop it, start no dev server', async () => {
  const s = await setup({ service: 'silent' });
  const started = Date.now();
  const result = await runStudio(s.options).done;
  assert.ok(Date.now() - started >= 2000);
  assert.deepEqual(result, { code: 1, message: `The layout service did not answer on port ${s.layoutPort} within 2 s, so the studio stopped it. See its output above.` });
  assert.ok(await waitFor(() => !alive(Number(readFileSync(s.pidFile, 'utf8')))), 'the silent service (a grandchild) is gone');
  assert.equal(existsSync(s.devFile), false);
});

await test('9. a service that stops before it is ready: say so with its exit code', async () => {
  const s = await setup({ service: 'crash' });
  assert.deepEqual(await runStudio(s.options).done, { code: 1, message: 'The layout service stopped (exit code 2) before it was ready. See its output above.' });
  assert.equal(existsSync(s.devFile), false);
});

await test('10. the service dies after start: the dev server is stopped and the studio says why', async () => {
  const s = await setup({ service: 'dies' });
  const studio = runStudio(s.options);
  assert.ok(await waitFor(() => existsSync(s.devFile)));
  const dev = readJson(s.devFile);
  assert.deepEqual(await studio.done, { code: 1, message: 'The layout service stopped (exit code 3), so the studio stopped the dev server too.' });
  assert.ok(await waitFor(() => !alive(dev.pid)));
  assert.equal(await portTaken(s.devPort), false);
});

await test('11. the dev server stops on its own: the layout service is stopped and the studio says why', async () => {
  const s = await setup({ devExit: 4 });
  const result = await runStudio(s.options).done;
  assert.deepEqual(result, { code: 1, message: 'The dev server stopped (exit code 4), so the studio stopped the layout service too.' });
  assert.ok(await waitFor(() => !alive(Number(readFileSync(s.pidFile, 'utf8')))));
  assert.equal(await portTaken(s.layoutPort), false);
});

await test('12. the dev server\'s port is taken, or LAYOUT_PORT is bad: stop before starting anything', async () => {
  const s = await setup({ service: null });
  const taken = createNetServer();
  await new Promise((r) => taken.listen(s.devPort, r));
  try {
    assert.deepEqual(await runStudio(s.options).done, { code: 1, message: `Port ${s.devPort} is already in use (is npm run dev or another studio still running?). Stop it, then run npm run studio again.` });
  } finally {
    await new Promise((r) => taken.close(r));
  }
  const bad = await setup({ service: null, env: { LAYOUT_PORT: 'x' } });
  assert.deepEqual(await runStudio(bad.options).done, { code: 1, message: 'LAYOUT_PORT must be a port number between 1 and 65535 (it is "x").' });
  assert.equal(existsSync(s.neverFile) || existsSync(bad.neverFile), false);
});

await test('13. Ctrl+C (SIGINT to the studio process) stops both, the service a grandchild behind a shell, and leaves both ports free', async () => {
  const s = await setup();
  const wrapper = path.join(tmp, 'wrapper.mjs');
  const { log, ...plain } = s.options;
  writeFileSync(wrapper, `import { main } from ${JSON.stringify(pathToFileURL(path.join(repoRoot, 'tools/studio.mjs')).href)};\nawait main({ argv: [${JSON.stringify(String(s.devPort))}], ...${JSON.stringify(plain)} });\n`);
  const child = spawn(process.execPath, [wrapper], { stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '';
  child.stdout.on('data', (d) => { out += d; });
  child.stderr.on('data', (d) => { out += d; });
  const exited = new Promise((r) => child.once('exit', (code) => r(code)));
  assert.ok(await waitFor(() => existsSync(s.devFile)), out);
  const devPid = readJson(s.devFile).pid;
  const servicePid = Number(readFileSync(s.pidFile, 'utf8'));
  child.kill('SIGINT');
  assert.equal(await exited, 0, out);
  assert.match(out, /Stopped the dev server and the layout service\./);
  assert.ok(await waitFor(() => !alive(servicePid) && !alive(devPid)), 'nothing left running');
  assert.equal(await portTaken(s.layoutPort), false);
  assert.equal(await portTaken(s.devPort), false);
});

await test('Registered in tools/test-groups.mjs (integration)', () => {
  assertTestRegistered({ filename: 'test-rs-3043-studio.mjs', group: 'integration', includedInDefault: true });
});

rmSync(tmp, { recursive: true, force: true });
if (process.exitCode !== 1) console.log('RS-3043 studio tests passed.');
