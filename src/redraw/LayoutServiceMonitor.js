/**
 * RS-3046 -- the Image → Strass lightbox's view of the layout service. It asks the dev server
 * (tools/layout-control.mjs) GET /api/layout-service/status and POST /api/layout-service/start, and
 * keeps one view for app.js to show: the state (Ready, Busy, Starting, Not running, Wrong service),
 * its reason, and whether the "Start layout service" button shows. No DOM: fetch and the timers are
 * injected, so tests drive it with a fake service and a fake clock.
 *
 * open() (the lightbox opens) reads the state; when it is Not running it asks the dev server to
 * start the service once, then reads the state every pollMs until it is no longer Starting, giving up
 * after the dev server's start limit (npm run studio's). A start that fails or is refused shows the
 * button and the reason. check() re-reads the state; start() is the button. close() stops polling.
 * A server without these routes (404) or in fake mode (used: false) hides the indicator.
 */

export const LAYOUT_SERVICE_STATUS_ENDPOINT = '/api/layout-service/status';
export const LAYOUT_SERVICE_START_ENDPOINT = '/api/layout-service/start';
export const LAYOUT_SERVICE_POLL_MS = 3000;
// tools/studio.mjs's START_TIMEOUT_MS, restated because src/** never imports tools/**; every status
// carries the dev server's own value (startTimeoutMs), which wins.
export const LAYOUT_SERVICE_START_TIMEOUT_MS = 180000;

const LABELS = Object.freeze({ ready: 'Ready', busy: 'Busy', starting: 'Starting', 'not-running': 'Not running', 'wrong-service': 'Wrong service' });

/**
 * @returns {{shown:boolean, state:(string|null), text:string, reason:string, showStart:boolean, checking:boolean}}
 *   `text` is the label to show ("Starting…" while starting); `showStart` shows the Start button.
 */
function hiddenView() {
  return { shown: false, state: null, text: '', reason: '', showStart: false, checking: false };
}

export function createLayoutServiceMonitor({
  fetch = (...args) => globalThis.fetch(...args),
  setTimer = (fn, ms) => setTimeout(fn, ms),
  clearTimer = (id) => clearTimeout(id),
  now = () => Date.now(),
  onChange = () => {},
  pollMs = LAYOUT_SERVICE_POLL_MS
} = {}) {
  let view = hiddenView();
  let active = false;
  let token = 0;
  let timer = null;
  let deadline = null;
  let startTimeoutMs = LAYOUT_SERVICE_START_TIMEOUT_MS;

  const set = (next) => { view = { ...view, ...next }; onChange(view); };
  const stopPolling = () => { if (timer !== null) clearTimer(timer); timer = null; };
  const show = (state, reason, extra = {}) => set({
    shown: true, state, text: state === 'starting' ? 'Starting…' : LABELS[state], reason,
    showStart: state === 'not-running' || state === 'wrong-service', checking: false, ...extra
  });

  // Applies a status body; true when it was shown.
  function apply(body) {
    if (!body || body.used === false || !LABELS[body.state]) { stopPolling(); deadline = null; set(hiddenView()); return false; }
    if (Number.isFinite(body.startTimeoutMs) && body.startTimeoutMs > 0) startTimeoutMs = body.startTimeoutMs;
    show(body.state, String(body.reason || ''));
    return true;
  }

  function schedulePoll() {
    stopPolling();
    if (!active) return;
    if (deadline === null) deadline = now() + startTimeoutMs;
    timer = setTimer(() => { timer = null; poll(); }, pollMs);
  }

  async function poll() {
    if (!active) return;
    if (deadline !== null && now() >= deadline) {
      deadline = null;
      show('not-running', `It did not become ready within ${Math.round(startTimeoutMs / 1000)} s. See the dev server's output, then press Start layout service or Check.`);
      return;
    }
    await read(false);
  }

  // Reads the status; with autoStart, a Not running service is started (once per open).
  async function read(autoStart) {
    const mine = ++token;
    if (view.shown) set({ checking: true });
    let body = null;
    try {
      const res = await fetch(LAYOUT_SERVICE_STATUS_ENDPOINT, { headers: { Accept: 'application/json' } });
      if (mine !== token) return;
      body = res.status === 404 ? { used: false } : await res.json();
    } catch (error) {
      if (mine !== token) return;
      body = { used: true, state: 'not-running', reason: `Could not ask the dev server (${error && error.message ? error.message : 'no answer'}).` };
    }
    if (mine !== token || !active) return;
    // Opening on Not running goes straight to Starting…, without showing Not running and its button first.
    if (autoStart && body && body.used !== false && body.state === 'not-running') {
      if (Number.isFinite(body.startTimeoutMs) && body.startTimeoutMs > 0) startTimeoutMs = body.startTimeoutMs;
      await requestStart();
      return;
    }
    if (!apply(body)) return;
    if (body.state === 'starting') schedulePoll();
    else { stopPolling(); deadline = null; }
  }

  async function requestStart() {
    const mine = ++token;
    stopPolling();
    set({ shown: true, state: 'starting', text: 'Starting…', reason: 'Asking the dev server to start the layout service.', showStart: false, checking: false });
    let res, body;
    try {
      res = await fetch(LAYOUT_SERVICE_START_ENDPOINT, { method: 'POST', headers: { Accept: 'application/json' } });
      body = await res.json().catch(() => null);
    } catch (error) {
      if (mine !== token || !active) return;
      show('not-running', `Could not ask the dev server to start it (${error && error.message ? error.message : 'no answer'}).`);
      return;
    }
    if (mine !== token || !active) return;
    if (!res.ok) {
      // Refused or failed: the button and the dev server's reason. The state stays the one last read.
      const state = body && body.error === 'wrong-service' ? 'wrong-service' : 'not-running';
      show(state, body && body.message ? body.message : `The dev server could not start it (HTTP ${res.status}).`);
      return;
    }
    if (!apply(body)) return;
    deadline = now() + startTimeoutMs;
    if (body.state === 'starting') schedulePoll();
    else { stopPolling(); deadline = null; }
  }

  return {
    view: () => view,
    open() { active = true; deadline = null; return read(true); },
    close() { active = false; token++; stopPolling(); deadline = null; if (view.checking) set({ checking: false }); },
    check() { if (!active) return Promise.resolve(); return read(false); },
    start() { if (!active) return Promise.resolve(); return requestStart(); }
  };
}
