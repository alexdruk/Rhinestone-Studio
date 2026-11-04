// RS-3046: the dev server's control of the layout service, for the Image → Strass lightbox.
//
// GET /api/layout-service/status says what answers at LAYOUT_SERVICE_URL: Ready, Busy, Starting,
// Not running or Wrong service, each with a plain reason. POST /api/layout-service/start starts
// services/strass-layout/scripts/start_layout.sh under `caffeinate -i`, the way `npm run studio`
// does (tools/studio.mjs's own helpers, not a copy), but only when the URL is 127.0.0.1 or
// localhost and nothing answers there. RS's own service already answering is left as it is; another
// service on the port, a remote URL, no URL or fake mode is refused with a plain message. Both
// routes answer only to requests from this Mac (loopback address, loopback Host, and no other
// site's Origin), so another machine on the network or another web page cannot start anything.
//
// A service this module started is stopped by stop() (the dev server calls it when it stops); a
// service started elsewhere, by hand or by npm run studio, is never stopped here.
import { fileURLToPath } from 'node:url';
import {
  LAYOUT_SERVICE_NAME, POLL_MS, START_TIMEOUT_MS, defaultLayoutCommand, exitText, probeLayoutService, repoLayoutVersion,
  signalGroup, startChild, stopChild
} from './studio.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

export const LAYOUT_SERVICE_ROUTES = Object.freeze({ status: '/api/layout-service/status', start: '/api/layout-service/start' });
export const LAYOUT_SERVICE_LABELS = Object.freeze({
  ready: 'Ready',
  busy: 'Busy',
  starting: 'Starting',
  'not-running': 'Not running',
  'wrong-service': 'Wrong service'
});
export { LAYOUT_SERVICE_NAME };

const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost']);

// True for an IPv4 or IPv6 loopback address as Node reports req.socket.remoteAddress.
export function isLoopbackAddress(address) {
  const a = String(address || '');
  return a === '::1' || /^(::ffff:)?127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(a);
}

// True when the request comes from this Mac, names this Mac as its Host, and, when a browser sends
// an Origin, comes from a page served by this same server.
export function isLocalRequest(req) {
  if (!isLoopbackAddress(req.socket && req.socket.remoteAddress)) return false;
  const host = String(req.headers.host || '');
  let hostname;
  try { hostname = new URL(`http://${host}`).hostname; } catch { return false; }
  if (!LOCAL_HOSTS.has(hostname) && hostname !== '[::1]') return false;
  const origin = req.headers.origin;
  return origin === undefined || origin === `http://${host}`;
}

// Where the URL points: { local, port } with local true for 127.0.0.1 or localhost, and the
// explicit port (null when the URL names none). null when there is no usable URL.
export function layoutServiceTarget(url) {
  if (!url) return null;
  let parsed;
  try { parsed = new URL(url); } catch { return null; }
  return { local: parsed.protocol === 'http:' && LOCAL_HOSTS.has(parsed.hostname), port: parsed.port ? Number(parsed.port) : null };
}

function sendJson(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-cache, no-store' });
  res.end(JSON.stringify(body));
}

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * @param {{url?:string, fake?:boolean, root?:string, env?:object, platform?:string, fetch?:Function,
 *   expectedVersion?:string, startTimeoutMs?:number, pollMs?:number, layoutCommand?:string[],
 *   log?:(line:string)=>void}} options  everything injectable for tests, as runStudio()
 */
export function createLayoutServiceControl({
  url = '',
  fake = false,
  root = ROOT,
  env = process.env,
  platform = process.platform,
  fetch = globalThis.fetch,
  expectedVersion,
  startTimeoutMs = START_TIMEOUT_MS,
  pollMs = POLL_MS,
  layoutCommand,
  log = (line) => console.log(line)
} = {}) {
  const target = layoutServiceTarget(url);
  let version = expectedVersion;
  const versionOf = () => (version ??= repoLayoutVersion(root));
  let started = null; // the child this control started: { child, exited, running, ready }
  let failure = '';   // why the service it started is not running, until the next start
  let stopping = false;
  let starting = null; // the start() in progress, so two clicks start one service

  const seconds = Math.round(startTimeoutMs / 1000);
  const status = (state, reason, extra = {}) => ({
    used: true, state, label: LAYOUT_SERVICE_LABELS[state], reason, url, startTimeoutMs,
    canStart: false, startedHere: Boolean(started && started.running), ...extra
  });
  const notSetReason = 'LAYOUT_SERVICE_URL is not set, so redraws are placed with the old method. Set it in .env (for example http://127.0.0.1:8001), or start Rhinestone Studio with npm run studio.';
  const remoteReason = `The layout service is set to ${url}, which is not on this Mac, so the dev server does not start it. Start it where it runs.`;
  const noPortReason = `LAYOUT_SERVICE_URL (${url}) names no port, so the dev server does not know where to start the layout service. Add one, for example http://127.0.0.1:8001.`;
  const otherReason = `Another service answers at ${url}; it is not Rhinestone Studio's layout service. Stop it, or set LAYOUT_SERVICE_URL to another port (for example http://127.0.0.1:8002).`;
  const staleReason = (found) => `An older Rhinestone Studio layout service (version ${found}; this checkout has ${versionOf()}) answers at ${url}. Stop it, then start it again.`;

  function wrongService(probe) {
    return status('wrong-service', probe.state === 'stale' ? staleReason(probe.version) : otherReason);
  }

  async function getStatus() {
    if (fake) return { used: false, reason: 'Fake mode (REDRAW_FAKE=1): redraws use a fixed test layout, not the layout service.' };
    if (!target) return status('not-running', notSetReason);
    const probe = await probeLayoutService({ fetch, url, expectedVersion: versionOf() });
    if (probe.state === 'ready') {
      return probe.busy
        ? status('busy', 'It is placing the stones of another redraw; the next layout waits for it.')
        : status('ready', `Rhinestone Studio's layout service ${probe.version} answers at ${url}.`);
    }
    if (probe.state === 'loading') return status('starting', `It answers at ${url} and is loading its models; this takes about a minute.`);
    if (probe.state === 'stale') return wrongService(probe);
    if (probe.state === 'other') {
      return probe.unreachable
        ? status('not-running', `Could not reach ${url} (${probe.unreachable}).`)
        : wrongService(probe);
    }
    // Nothing answers. uvicorn opens the port only once its models are loaded, so a service this
    // dev server started is Starting until then.
    if (started && started.running && !started.ready) {
      return status('starting', `The dev server started it on port ${target.port}; it loads its models in about a minute (at most ${seconds} s).`);
    }
    if (!target.local) return status('not-running', `Nothing answers at ${url}. ${remoteReason}`);
    if (!target.port) return status('not-running', noPortReason);
    return status('not-running', failure || `Nothing answers at ${url}.`, { canStart: true });
  }

  // Waits for the started service as npm run studio does: ready, stopped, another service, or the
  // time limit (then it is stopped). After ready it only notes a later exit.
  async function watch(entry) {
    const deadline = Date.now() + startTimeoutMs;
    for (;;) {
      if (!entry.running) {
        if (!stopping) failure = `The layout service ${exitText(await entry.exited)} before it was ready. See the dev server's output.`;
        return;
      }
      const probe = await probeLayoutService({ fetch, url, expectedVersion: versionOf() });
      if (probe.state === 'ready') {
        entry.ready = true;
        log(`Layout service ready at ${url}. The dev server stops it when it stops.`);
        entry.exited.then((result) => { if (!stopping && started === entry) failure = `The layout service the dev server started ${exitText(result)}.`; });
        return;
      }
      if (probe.state === 'other' || probe.state === 'stale') {
        await stopChild(entry);
        failure = `${wrongService(probe).reason} The dev server stopped the service it had started.`;
        return;
      }
      if (Date.now() >= deadline) {
        await stopChild(entry);
        failure = `The layout service did not answer on port ${target.port} within ${seconds} s, so the dev server stopped it. See the dev server's output.`;
        return;
      }
      await Promise.race([delay(pollMs), entry.exited]);
    }
  }

  // { httpStatus, body }: 202 and the status when it started the service, 200 and the status when
  // RS's service already answers (or is already starting), 409 { error, message } when it refuses.
  async function start() {
    const refuse = (error, message) => ({ httpStatus: 409, body: { error, message } });
    if (fake) return refuse('not-used', 'Fake mode (REDRAW_FAKE=1) does not use the layout service.');
    if (!target) return refuse('not-set', notSetReason);
    if (!target.local) return refuse('remote', remoteReason);
    if (!target.port) return refuse('no-port', noPortReason);
    if (started && started.running && !started.ready) return { httpStatus: 200, body: await getStatus() };
    const probe = await probeLayoutService({ fetch, url, expectedVersion: versionOf() });
    if (probe.state === 'ready' || probe.state === 'loading') return { httpStatus: 200, body: await getStatus() };
    if (probe.state === 'other' || probe.state === 'stale') return refuse('wrong-service', wrongService(probe).reason);
    if (stopping) return refuse('stopping', 'The dev server is stopping.');
    failure = '';
    const entry = startChild('layout service', layoutCommand ?? defaultLayoutCommand(root, platform), { cwd: root, env: { ...env, LAYOUT_PORT: String(target.port) } });
    entry.ready = false;
    entry.exited.then(() => { entry.running = false; });
    started = entry;
    log(`Starting the layout service on port ${target.port} for the Image → Strass lightbox... (models load in about a minute; giving up after ${seconds} s)`);
    watch(entry);
    return { httpStatus: 202, body: await getStatus() };
  }

  const control = {
    status: getStatus,
    start() {
      starting ??= start().finally(() => { starting = null; });
      return starting;
    },
    // Stops the service this control started (and only that one); resolves when it is gone.
    async stop() {
      stopping = true;
      if (started && started.running) {
        log('Stopping the layout service the dev server started...');
        await stopChild(started);
      }
    },
    // The same, synchronously and without waiting: for process 'exit', where nothing async runs.
    stopNow() {
      if (started && started.running) signalGroup(started, 'SIGTERM');
    },
    // Answers the two routes; returns false for any other path.
    handle(req, res, routePath) {
      if (routePath !== LAYOUT_SERVICE_ROUTES.status && routePath !== LAYOUT_SERVICE_ROUTES.start) return false;
      if (!isLocalRequest(req)) {
        sendJson(res, 403, { error: 'forbidden', message: 'The layout service routes answer only to this Mac.' });
        return true;
      }
      const run = async () => {
        if (routePath === LAYOUT_SERVICE_ROUTES.status && req.method === 'GET') return sendJson(res, 200, await getStatus());
        if (routePath === LAYOUT_SERVICE_ROUTES.start && req.method === 'POST') {
          const { httpStatus, body } = await control.start();
          return sendJson(res, httpStatus, body);
        }
        res.setHeader('Allow', routePath === LAYOUT_SERVICE_ROUTES.status ? 'GET' : 'POST');
        return sendJson(res, 405, { error: 'method-not-allowed', message: 'Method Not Allowed' });
      };
      run().catch((error) => sendJson(res, 500, { error: 'failed', message: error.message }));
      return true;
    }
  };
  return control;
}
