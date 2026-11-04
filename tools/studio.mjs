// RS-3043: `npm run studio` starts the layout service (services/strass-layout) and the dev server
// together, so a redraw never falls back to the old method because the service was forgotten.
//
// 1. Checks the dev server's port is free.
// 2. Asks GET /health on the layout port (LAYOUT_PORT, default 8001; never 8000, which PatternNifty's
//    own strass service uses on the iMac). RS's service answers with `service:
//    "rhinestone-studio-layout"` and this checkout's version: it is reused, not started twice.
//    Anything else that answers there stops the studio with a message naming the port.
// 3. Otherwise starts scripts/start_layout.sh (under `caffeinate -i` on macOS) and waits for
//    /health to answer ok, up to three minutes.
// 4. Starts tools/dev-server.mjs with LAYOUT_SERVICE_URL set to the service's address.
// Ctrl+C stops both. When either stops on its own, the other is stopped and the studio says why.
// A service that was reused is never stopped. No npm dependency.
//
// Usage: node tools/studio.mjs [port]   (the dev server's port, default 5173)
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:net';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
export const DEFAULT_LAYOUT_PORT = 8001;
export const DEFAULT_DEV_PORT = 5173;
export const LAYOUT_SERVICE_NAME = 'rhinestone-studio-layout';
export const START_TIMEOUT_MS = 180000;
const PROBE_TIMEOUT_MS = 3000;
export const POLL_MS = 1000;
const STOP_GRACE_MS = 10000;

// The port from LAYOUT_PORT (environment only, like start_layout.sh), default 8001.
export function layoutPortFrom(env) {
  const text = String(env.LAYOUT_PORT ?? '').trim();
  if (!text) return DEFAULT_LAYOUT_PORT;
  const port = /^\d+$/.test(text) ? Number(text) : NaN;
  if (!(port >= 1 && port <= 65535)) throw new Error(`LAYOUT_PORT must be a port number between 1 and 65535 (it is "${text}").`);
  return port;
}

// The version this checkout's service reports: strass_layout/__init__.py's __version__.
export function repoLayoutVersion(root = ROOT) {
  const text = readFileSync(path.join(root, 'services/strass-layout/strass_layout/__init__.py'), 'utf8');
  const match = /^__version__\s*=\s*["']([^"']+)["']/m.exec(text);
  if (!match) throw new Error('No __version__ in services/strass-layout/strass_layout/__init__.py.');
  return match[1];
}

// What answers GET /health on the port: { state: 'free' } (nothing listens), 'ready' (RS's service,
// this version, models loaded), 'loading' (RS's service, models not loaded yet), 'stale' (RS's
// service, another version) or 'other' (anything else, including no answer within 3 s).
// RS-3046: 'ready' and 'loading' also carry `busy` (a layout is running); 'other' carries
// `unreachable` (the error code) when the connection itself failed for another reason than a
// refusal or the time limit, such as an unknown host.
export async function probeLayoutService({ fetch = globalThis.fetch, url, expectedVersion, timeoutMs = PROBE_TIMEOUT_MS }) {
  let response;
  try {
    response = await fetch(`${url}/health`, { signal: AbortSignal.timeout(timeoutMs) });
  } catch (error) {
    const cause = error && error.cause ? error.cause : error;
    if (cause && cause.code === 'ECONNREFUSED') return { state: 'free' };
    if (cause && typeof cause.code === 'string' && cause.name !== 'TimeoutError' && cause.name !== 'AbortError') return { state: 'other', unreachable: cause.code };
    return { state: 'other' };
  }
  const body = await response.json().catch(() => null);
  if (response.status !== 200 || !body || body.service !== LAYOUT_SERVICE_NAME) return { state: 'other' };
  if (body.version !== expectedVersion) return { state: 'stale', version: String(body.version) };
  return { state: body.ok === true && body.modelsLoaded === true ? 'ready' : 'loading', version: body.version, busy: body.busy === true };
}

// Resolves true when a server could listen on the port (as tools/dev-server.mjs does), false when it
// is taken.
export function portIsFree(port) {
  return new Promise((resolve) => {
    const server = createServer();
    server.once('error', () => resolve(false));
    server.listen(port, () => server.close(() => resolve(true)));
  });
}

// RS-3046: also the dev server's (tools/layout-control.mjs), which starts the service the same way.
export function defaultLayoutCommand(root, platform) {
  const script = path.join(root, 'services/strass-layout/scripts/start_layout.sh');
  return platform === 'darwin' ? ['caffeinate', '-i', script] : [script];
}

function defaultDevCommand(root, devPort) {
  return [process.execPath, path.join(root, 'tools/dev-server.mjs'), String(devPort)];
}

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Each child runs in its own process group (detached), so Ctrl+C reaches only the studio, which
// then stops each group: caffeinate, start_layout.sh's uvicorn and the dev server together.
export function startChild(name, command, { cwd, env }) {
  const child = spawn(command[0], command.slice(1), { cwd, env, stdio: 'inherit', detached: true });
  const exited = new Promise((resolve) => {
    child.once('exit', (code, signal) => resolve({ code, signal }));
    child.once('error', (error) => resolve({ code: null, signal: null, error }));
  });
  return { name, child, exited, running: true };
}

export function signalGroup(entry, signal) {
  try { process.kill(-entry.child.pid, signal); } catch { /* already gone */ }
}

export async function stopChild(entry) {
  if (!entry || !entry.running) return;
  signalGroup(entry, 'SIGTERM');
  const timer = setTimeout(() => signalGroup(entry, 'SIGKILL'), STOP_GRACE_MS);
  await entry.exited;
  clearTimeout(timer);
  // Anything left in the group (a grandchild that ignored SIGTERM) goes too.
  signalGroup(entry, 'SIGKILL');
}

export function exitText(result) {
  if (result.error) return `could not start (${result.error.message})`;
  if (result.signal) return `stopped (${result.signal})`;
  return `stopped (exit code ${result.code})`;
}

// Runs the studio. Resolves { code, message } once everything it started has stopped: code 0 after
// stop() (Ctrl+C), 1 when something failed or stopped on its own. Everything is injectable for
// tests: commands, ports, fetch, timings and the log.
export function runStudio({
  root = ROOT,
  env = process.env,
  platform = process.platform,
  devPort = DEFAULT_DEV_PORT,
  layoutCommand,
  devCommand,
  fetch = globalThis.fetch,
  expectedVersion,
  startTimeoutMs = START_TIMEOUT_MS,
  pollMs = POLL_MS,
  log = (line) => console.log(line)
} = {}) {
  let stopRequested = false;
  let wake = () => {};
  const stopSignal = new Promise((resolve) => { wake = resolve; });
  const children = [];

  const finish = async (code, message) => {
    for (const entry of children.slice().reverse()) await stopChild(entry);
    if (message) log(message);
    return { code, message };
  };

  const done = (async () => {
    let layoutPort;
    try {
      layoutPort = layoutPortFrom(env);
    } catch (error) {
      return finish(1, error.message);
    }
    const version = expectedVersion ?? repoLayoutVersion(root);
    const url = `http://127.0.0.1:${layoutPort}`;

    if (!(await portIsFree(devPort))) {
      return finish(1, `Port ${devPort} is already in use (is npm run dev or another studio still running?). Stop it, then run npm run studio again.`);
    }

    const first = await probeLayoutService({ fetch, url, expectedVersion: version });
    if (first.state === 'other') {
      return finish(1, `Another service is answering on port ${layoutPort}; it is not Rhinestone Studio's layout service. Stop it, or start the studio on another port: LAYOUT_PORT=8002 npm run studio`);
    }
    if (first.state === 'stale') {
      return finish(1, `An older Rhinestone Studio layout service (version ${first.version}; this checkout has ${version}) is running on port ${layoutPort}. Stop it, then run npm run studio again.`);
    }

    let layout = null;
    if (first.state === 'ready' || first.state === 'loading') {
      log(`Using the layout service already running on port ${layoutPort}. It keeps running when the studio stops.`);
    } else {
      layout = startChild('layout service', layoutCommand ?? defaultLayoutCommand(root, platform), { cwd: root, env: { ...env, LAYOUT_PORT: String(layoutPort) } });
      children.push(layout);
      layout.exited.then(() => { layout.running = false; wake(); });
    }

    if (first.state !== 'ready') {
      log(`Starting the layout service on port ${layoutPort}... (models load in about a minute; giving up after ${Math.round(startTimeoutMs / 1000)} s)`);
      const deadline = Date.now() + startTimeoutMs;
      for (;;) {
        if (stopRequested) return finish(0, 'Stopped.');
        if (layout && !layout.running) {
          return finish(1, `The layout service ${exitText(await layout.exited)} before it was ready. See its output above.`);
        }
        const probe = await probeLayoutService({ fetch, url, expectedVersion: version });
        if (probe.state === 'ready') break;
        if (probe.state === 'other' || probe.state === 'stale') {
          return finish(1, `Another service is answering on port ${layoutPort}; it is not Rhinestone Studio's layout service. Stop it, or start the studio on another port: LAYOUT_PORT=8002 npm run studio`);
        }
        if (Date.now() >= deadline) {
          return finish(1, `The layout service did not answer on port ${layoutPort} within ${Math.round(startTimeoutMs / 1000)} s, so the studio stopped it. See its output above.`);
        }
        await Promise.race([delay(pollMs), stopSignal]);
      }
    }
    log(`Layout service ready at ${url}.`);
    if (stopRequested) return finish(0, 'Stopped.');

    const dev = startChild('dev server', devCommand ?? defaultDevCommand(root, devPort), { cwd: root, env: { ...env, LAYOUT_SERVICE_URL: url } });
    children.push(dev);
    dev.exited.then(() => { dev.running = false; wake(); });
    log(`Rhinestone Studio: http://localhost:${devPort}/  Press Ctrl+C to stop.`);

    // stopSignal resolves on Ctrl+C or when either child exits.
    await stopSignal;
    if (stopRequested) return finish(0, layout ? 'Stopped the dev server and the layout service.' : 'Stopped the dev server.');
    if (!dev.running) {
      return finish(1, `The dev server ${exitText(await dev.exited)}${layout ? ', so the studio stopped the layout service too' : ''}.`);
    }
    return finish(1, `The layout service ${exitText(await layout.exited)}, so the studio stopped the dev server too.`);
  })();

  return {
    done,
    stop() { stopRequested = true; wake(); }
  };
}

// The command line: Ctrl+C (SIGINT) or SIGTERM stops both; a second Ctrl+C while stopping is ignored
// until the children are gone (each gets SIGKILL after 10 s).
export async function main({ argv = process.argv.slice(2), ...options } = {}) {
  const devPort = argv[0] === undefined ? DEFAULT_DEV_PORT : Number(argv[0]);
  const studio = runStudio({ devPort, ...options });
  const onSignal = () => studio.stop();
  process.on('SIGINT', onSignal);
  process.on('SIGTERM', onSignal);
  const { code } = await studio.done;
  process.off('SIGINT', onSignal);
  process.off('SIGTERM', onSignal);
  process.exitCode = code;
  return code;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) await main();
