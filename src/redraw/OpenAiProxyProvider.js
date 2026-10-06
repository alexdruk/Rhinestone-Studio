/**
 * IMG-022: the redraw provider that posts to our own server (server/redraw/handler.mjs, mounted by
 * tools/dev-server.mjs at POST /api/redraw), which calls OpenAI. The browser never sees the OpenAI
 * key; it sends only the operator's access code. See docs/specifications/IMG-022-RedrawProvider.md
 * D2 for the wire format.
 *
 * Failures are thrown as plain Errors carrying a `code` from REDRAW_ERROR_CODES (index.js turns them
 * into RedrawError), so this file has no import back into index.js. An abort is rethrown unchanged.
 *
 * IMG-026 build B: the POST starts a server job; this provider polls GET /api/redraw/:jobId every
 * 3 s, reports each new stage through onStage, sends DELETE on abort, and counts a failed poll as
 * `network` only after 3 in a row. A layout failure after a good OpenAI image resolves with
 * layout: null and layoutError; the job's error code is thrown only when there is no image. See
 * docs/specifications/IMG-026-StrassLayoutService.md, "Client".
 */

export const OPENAI_PROXY_PROVIDER_ID = 'openai-proxy';
export const REDRAW_ENDPOINT = '/api/redraw';
// IMG-026 build B: the POST answers 202 { jobId }; the job is polled every 3 s.
export const REDRAW_POLL_INTERVAL_MS = 3000;
const MAX_FAILED_POLLS = 3;

const KNOWN_FAILURE_CODES = new Set(['not-configured', 'unauthorized', 'rate-limited', 'network', 'provider-failed', 'invalid-output', 'declined', 'layout-unavailable', 'layout-timeout', 'layout-failed']);

function failure(code, detail) {
  const error = new Error(detail || code);
  error.code = code;
  error.detail = detail || '';
  return error;
}

function isAbort(error) {
  return Boolean(error && error.name === 'AbortError');
}

function abortErrorFor(signal) {
  return signal && signal.reason && signal.reason.name === 'AbortError' ? signal.reason : new DOMException('Redraw cancelled.', 'AbortError');
}

// Resolves after ms, or rejects with an AbortError as soon as the signal aborts.
function defaultWait(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal && signal.aborted) return reject(abortErrorFor(signal));
    const timer = setTimeout(() => { if (signal) signal.removeEventListener('abort', onAbort); resolve(); }, ms);
    function onAbort() { clearTimeout(timer); reject(abortErrorFor(signal)); }
    if (signal) signal.addEventListener('abort', onAbort, { once: true });
  });
}

async function readJson(response) {
  try {
    return await response.json();
  } catch (error) {
    if (isAbort(error)) throw error;
    return null;
  }
}

function failureFromResponse(response, body) {
  const code = body && KNOWN_FAILURE_CODES.has(body.code) ? body.code : 'provider-failed';
  return failure(code, body && typeof body.message === 'string' ? body.message : '');
}

function openAiResult(result) {
  if (!result || typeof result.dataUrl !== 'string' || !result.dataUrl.startsWith('data:image/')) return null;
  return { dataUrl: result.dataUrl, model: typeof result.model === 'string' ? result.model : '', promptVersion: result.promptVersion ?? null };
}

export function createOpenAiProxyProvider({ fetch, costLabel = '', wait = defaultWait, pollIntervalMs = REDRAW_POLL_INTERVAL_MS }) {
  return {
    id: OPENAI_PROXY_PROVIDER_ID,
    consent: { recipientName: 'OpenAI', costLabel, needsAccessCode: true },
    // Resolves { dataUrl, model, promptVersion, layout, layoutError }. onStage(stage) hears each new
    // job stage ('drawing', 'placing', 'done', 'failed').
    async redraw({ pngDataUrl, accessCode = '', signal, style = 'stones', onStage }) {
      let response;
      try {
        response = await fetch(REDRAW_ENDPOINT, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Redraw-Access-Code': accessCode },
          body: JSON.stringify({ image: pngDataUrl, style }),
          signal
        });
      } catch (error) {
        if (isAbort(error)) throw error;
        throw failure('network');
      }
      if (response.status === 404) throw failure('not-configured');
      const created = await readJson(response);
      if (!response.ok) throw failureFromResponse(response, created);
      if (!created || typeof created.jobId !== 'string' || !created.jobId) throw failure('provider-failed', 'The redraw server started no job.');

      const jobUrl = `${REDRAW_ENDPOINT}/${encodeURIComponent(created.jobId)}`;
      const headers = { 'X-Redraw-Access-Code': accessCode };
      // Cancel: tell the server to stop the job, then rethrow the abort unchanged.
      const cancelJob = () => { Promise.resolve().then(() => fetch(jobUrl, { method: 'DELETE', headers })).catch(() => {}); };
      let lastStage = null;
      let failedPolls = 0;
      try {
        for (;;) {
          await wait(pollIntervalMs, signal);
          let poll;
          try {
            poll = await fetch(jobUrl, { method: 'GET', headers, signal });
          } catch (error) {
            if (isAbort(error)) throw error;
            failedPolls++;
            if (failedPolls >= MAX_FAILED_POLLS) throw failure('network');
            continue;
          }
          failedPolls = 0;
          const body = await readJson(poll);
          if (signal && signal.aborted) throw abortErrorFor(signal);
          if (!poll.ok) throw failureFromResponse(poll, body);
          if (!body || typeof body.stage !== 'string') throw failure('provider-failed', 'The redraw server sent an unreadable job.');
          if (body.stage !== lastStage) {
            lastStage = body.stage;
            if (typeof onStage === 'function') onStage(body.stage);
          }
          if (body.stage === 'done') {
            const result = openAiResult(body.result);
            if (!result) throw failure('invalid-output');
            return { ...result, layout: body.result.layout ?? null, layoutError: null };
          }
          if (body.stage === 'failed') {
            const error = body.error && typeof body.error === 'object' ? body.error : {};
            const code = KNOWN_FAILURE_CODES.has(error.code) ? error.code : 'provider-failed';
            const message = typeof error.message === 'string' ? error.message : '';
            const result = openAiResult(body.result);
            if (!result) throw failure(code, message);
            return { ...result, layout: null, layoutError: { code, message } };
          }
        }
      } catch (error) {
        if (isAbort(error) || (signal && signal.aborted)) {
          cancelJob();
          throw isAbort(error) ? error : abortErrorFor(signal);
        }
        throw error;
      }
    }
  };
}
