// IMG-026 build B: the redraw job store and the layout-service call. handler.mjs starts a job per
// POST /api/redraw; the browser polls GET /api/redraw/:jobId every 3 s. A running job nobody has
// polled for 30 s is cancelled (it replaces "abort when the browser disconnects"); a finished job is
// kept for 30 min; at most 20 jobs are kept. now and timers are injected so tests control time.
// See docs/specifications/IMG-026-StrassLayoutService.md, "Node jobs, prompt and colours (build B)".

export const JOB_ORPHAN_MS = 30 * 1000;
export const JOB_KEEP_MS = 30 * 60 * 1000;
export const MAX_JOBS = 20;
export const LAYOUT_TARGET_PITCH_MM = 2.1;

const LAYOUT_TIMEOUT = Symbol('layout-timeout');

export const DEFAULT_TIMERS = Object.freeze({
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (handle) => clearTimeout(handle)
});

// A server timer must not keep the process alive on its own (tests, a stopping dev server).
function unref(handle) {
  if (handle && typeof handle.unref === 'function') handle.unref();
  return handle;
}

export function createJobStore({ now, timers, randomUUID }) {
  const jobs = new Map();

  function clearJobTimers(job) {
    timers.clearTimeout(job.orphanTimer);
    timers.clearTimeout(job.expiryTimer);
    job.orphanTimer = null;
    job.expiryTimer = null;
  }

  function drop(job) {
    clearJobTimers(job);
    jobs.delete(job.id);
  }

  // Cancel = abort whatever is in flight and forget the job (DELETE, or an orphan).
  function cancel(job) {
    job.controller.abort();
    drop(job);
  }

  function isFinished(job) {
    return job.stage === 'done' || job.stage === 'failed';
  }

  // Restarts the 30 s orphan clock of a running job.
  function touch(job) {
    timers.clearTimeout(job.orphanTimer);
    job.orphanTimer = isFinished(job) ? null : unref(timers.setTimeout(() => cancel(job), JOB_ORPHAN_MS));
  }

  // Null when 20 jobs are kept and none has finished.
  function create() {
    if (jobs.size >= MAX_JOBS) {
      const oldestFinished = [...jobs.values()].find(isFinished);
      if (!oldestFinished) return null;
      drop(oldestFinished);
    }
    const job = { id: randomUUID(), stage: 'drawing', result: null, error: null, controller: new AbortController(), endedAt: null, orphanTimer: null, expiryTimer: null };
    jobs.set(job.id, job);
    touch(job);
    return job;
  }

  function end(job, stage, result, error) {
    if (!jobs.has(job.id) || isFinished(job)) return;
    job.stage = stage;
    job.result = result;
    job.error = error;
    job.endedAt = now();
    timers.clearTimeout(job.orphanTimer);
    job.orphanTimer = null;
    job.expiryTimer = unref(timers.setTimeout(() => drop(job), JOB_KEEP_MS));
  }

  function get(id) {
    const job = jobs.get(id);
    if (!job) return null;
    if (job.endedAt !== null && now() - job.endedAt >= JOB_KEEP_MS) {
      drop(job);
      return null;
    }
    return job;
  }

  return {
    create,
    get,
    touch,
    cancel,
    finish: (job, result) => end(job, 'done', result, null),
    fail: (job, error, result = null) => end(job, 'failed', result, error),
    setStage: (job, stage) => { if (jobs.has(job.id) && !isFinished(job)) job.stage = stage; },
    size: () => jobs.size
  };
}

// What GET answers: { stage, result?, error? }.
export function jobView(job) {
  const view = { stage: job.stage };
  if (job.result) view.result = job.result;
  if (job.error) view.error = job.error;
  return view;
}

// One POST /layout to the layout service. Never rejects: resolves { layout }, { error: { code,
// message } }, or { cancelled: true } when `signal` aborts. No retry.
export async function callLayoutService({ fetch, timers, url, timeoutMs, pngBuffer, colorIds, signal }) {
  if (!url) return { error: { code: 'layout-unavailable', message: 'The layout service is not set up (LAYOUT_SERVICE_URL is empty).' } };
  if (signal.aborted) return { cancelled: true };
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  signal.addEventListener('abort', onAbort, { once: true });
  const timeoutError = { error: { code: 'layout-timeout', message: `The layout service took longer than ${Math.round(timeoutMs / 1000)} s.` } };
  let timer;
  let timedOut = false;
  try {
    const form = new FormData();
    form.append('image', new Blob([pngBuffer], { type: 'image/png' }), 'redraw.png');
    form.append('options', JSON.stringify({ colorIds, targetPitchMm: LAYOUT_TARGET_PITCH_MM }));
    const timeout = new Promise((resolve) => { timer = timers.setTimeout(() => { timedOut = true; controller.abort(); resolve(LAYOUT_TIMEOUT); }, timeoutMs); });
    const request = fetch(`${url.replace(/\/+$/, '')}/layout`, { method: 'POST', body: form, signal: controller.signal });
    request.catch(() => {});
    const response = await Promise.race([request, timeout]);
    if (signal.aborted) return { cancelled: true };
    if (response === LAYOUT_TIMEOUT) return timeoutError;
    const reading = response.json().catch(() => null);
    const body = await Promise.race([reading, timeout]);
    if (signal.aborted) return { cancelled: true };
    if (body === LAYOUT_TIMEOUT) return timeoutError;
    if (response.status !== 200) {
      const message = body && typeof body.error === 'string'
        ? `${body.error}: ${typeof body.message === 'string' ? body.message : ''}`
        : `The layout service answered ${response.status}.`;
      return { error: { code: 'layout-failed', message } };
    }
    if (!body || !Array.isArray(body.stones)) return { error: { code: 'layout-failed', message: 'The layout service returned no layout.' } };
    return { layout: body };
  } catch (error) {
    if (signal.aborted) return { cancelled: true };
    if (timedOut) return timeoutError;
    const cause = error && error.cause ? error.cause : error;
    if (cause && cause.code === 'ECONNREFUSED') return { error: { code: 'layout-unavailable', message: `The layout service at ${url} is not running.` } };
    return { error: { code: 'layout-failed', message: error && error.message ? error.message : String(error) } };
  } finally {
    timers.clearTimeout(timer);
    signal.removeEventListener('abort', onAbort);
  }
}
