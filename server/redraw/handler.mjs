// IMG-022: the two redraw routes tools/dev-server.mjs mounts -- GET /api/redraw/config and
// POST /api/redraw. The POST checks the access code and the hourly limit, then sends the image to
// OpenAI's image edit endpoint (or returns the fixture image in fake mode). No npm dependency: Node
// 18+ global fetch, FormData and Blob. fetch, now and timeoutMs are injectable so tests never touch
// the network or wait on real time. See docs/specifications/IMG-022-RedrawProvider.md D3-D5.
import { timingSafeEqual } from 'node:crypto';
import { buildRedrawPrompt, PROMPT_VERSIONS, REDRAW_STYLES } from './prompt.mjs';
import { redrawConfigStatus, REDRAW_ENV_DEFAULTS } from './env.mjs';
import { FAKE_REDRAW_DATA_URL } from '../../src/redraw/FakeRedrawProvider.js';

export const OPENAI_IMAGE_EDITS_URL = 'https://api.openai.com/v1/images/edits';
export const REDRAW_MAX_BODY_BYTES = 20 * 1024 * 1024;
const RATE_WINDOW_MS = 60 * 60 * 1000;
const CACHE_CONTROL = 'no-cache, no-store';
const PNG_DATA_URL_PREFIX = 'data:image/png;base64,';
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const TIMEOUT = Symbol('timeout');

function sendJson(res, status, body) {
  if (res.headersSent || res.writableEnded) return;
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': CACHE_CONTROL });
  res.end(JSON.stringify(body));
}

function sendFailure(res, status, code, message = '') {
  sendJson(res, status, { code, message });
}

// Same body and headers as the static server's own 404, so an unconfigured route is
// indistinguishable from a missing file.
function sendNotFound(res) {
  if (res.headersSent || res.writableEnded) return;
  res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': CACHE_CONTROL });
  res.end('Not Found');
}

function accessCodeMatches(given, expected) {
  const a = Buffer.from(typeof given === 'string' ? given : '', 'utf8');
  const b = Buffer.from(expected, 'utf8');
  return a.length === b.length && timingSafeEqual(a, b);
}

async function readBody(req, maxBytes) {
  const declared = Number(req.headers && req.headers['content-length']);
  if (Number.isFinite(declared) && declared > maxBytes) return { tooLarge: true };
  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    const buf = typeof chunk === 'string' ? Buffer.from(chunk) : chunk;
    total += buf.length;
    if (total > maxBytes) return { tooLarge: true };
    chunks.push(buf);
  }
  return { text: Buffer.concat(chunks).toString('utf8') };
}

function messageOf(body) {
  return body && body.error && typeof body.error.message === 'string' ? body.error.message : '';
}

function isPngBase64(b64) {
  if (typeof b64 !== 'string' || b64.length < 12) return false;
  return Buffer.from(b64.slice(0, 12), 'base64').subarray(0, 8).equals(PNG_SIGNATURE);
}

// IMG-023 (D7): OpenAI's safety-system refusal. Matched case-insensitively on error.message.
const SAFETY_SYSTEM_PATTERN = /safety system/i;

export function createRedrawHandler({ settings, fetch = globalThis.fetch, now = Date.now, timeoutMs = settings.timeoutMs || REDRAW_ENV_DEFAULTS.REDRAW_TIMEOUT_SECONDS * 1000, logger = console }) {
  const { configured } = redrawConfigStatus(settings);
  const requestTimesByIp = new Map();

  // Sliding one-hour window per client IP (the socket address, never a forwarded header).
  function allowRequest(ip) {
    const t = now();
    const recent = (requestTimesByIp.get(ip) || []).filter((when) => t - when < RATE_WINDOW_MS);
    if (recent.length >= settings.rateLimitPerHour) {
      requestTimesByIp.set(ip, recent);
      return false;
    }
    recent.push(t);
    requestTimesByIp.set(ip, recent);
    return true;
  }

  // One OpenAI request. Resolves a Response, or TIMEOUT; rejects if fetch itself rejects.
  async function attemptOpenAi(pngBuffer, clientGone, style) {
    const controller = new AbortController();
    const onGone = () => controller.abort();
    clientGone.addEventListener('abort', onGone, { once: true });
    let timer;
    try {
      const form = new FormData();
      form.append('model', settings.imageModel);
      form.append('prompt', buildRedrawPrompt(undefined, style));
      form.append('image', new Blob([pngBuffer], { type: 'image/png' }), 'source.png');
      form.append('quality', settings.imageQuality);
      form.append('size', '1024x1024');
      form.append('background', 'transparent');
      form.append('output_format', 'png');
      form.append('n', '1');
      const timeout = new Promise((resolve) => { timer = setTimeout(() => { controller.abort(); resolve(TIMEOUT); }, timeoutMs); });
      const request = fetch(OPENAI_IMAGE_EDITS_URL, {
        method: 'POST',
        headers: { Authorization: `Bearer ${settings.openaiApiKey}` },
        body: form,
        signal: controller.signal
      });
      request.catch(() => {});
      return await Promise.race([request, timeout]);
    } finally {
      clearTimeout(timer);
      clientGone.removeEventListener('abort', onGone);
    }
  }

  async function callOpenAi(res, pngBuffer, style) {
    // Aborts the upstream call if the browser disconnects first (Cancel), so no paid call is left
    // running for nobody.
    const clientGone = new AbortController();
    if (typeof res.on === 'function') res.on('close', () => { if (!res.writableEnded) clientGone.abort(); });

    let response = null;
    let body = null;
    let timedOut = false;
    for (let attempt = 1; attempt <= 2 && !clientGone.signal.aborted; attempt++) {
      let outcome;
      try {
        outcome = await attemptOpenAi(pngBuffer, clientGone.signal, style);
      } catch {
        outcome = null; // fetch rejected (DNS, reset, abort)
      }
      if (clientGone.signal.aborted) return;
      response = null;
      // A timed-out call is usually still running, and billed, at OpenAI, so it is not retried.
      if (outcome === TIMEOUT) { timedOut = true; break; }
      if (outcome === null || outcome.status >= 500) continue;
      response = outcome;
      body = null;
      try { body = await response.json(); } catch { body = null; }
      if (response.status >= 400 && response.status < 500) {
        // IMG-023 (D7): every OpenAI 4xx is logged with its status and message -- never the key,
        // the access code, the upload or a request header.
        logger.warn(`Redraw: OpenAI returned ${response.status}: ${messageOf(body)}`);
        // A safety-system refusal is retried once, within the same two-attempt budget.
        if (SAFETY_SYSTEM_PATTERN.test(messageOf(body)) && attempt < 2) continue;
      }
      break;
    }
    if (clientGone.signal.aborted) return;
    if (timedOut) return sendFailure(res, 504, 'provider-failed', 'The image service took too long. Try again, or set a lower OPENAI_IMAGE_QUALITY.');
    if (!response) return sendFailure(res, 502, 'provider-failed', 'The image service did not respond. Try again later.');

    const openAiMessage = messageOf(body);
    if (response.status >= 400 && response.status < 500 && SAFETY_SYSTEM_PATTERN.test(openAiMessage)) return sendFailure(res, 422, 'declined', openAiMessage);
    if (response.status === 429) return sendFailure(res, 429, 'rate-limited', 'The image service is busy. Try again later.');
    if (response.status === 401 || response.status === 403) return sendFailure(res, 502, 'provider-failed', 'The redraw server is not set up correctly.');
    if (response.status !== 200) return sendFailure(res, 502, 'provider-failed', openAiMessage);
    const b64 = body && Array.isArray(body.data) && body.data[0] ? body.data[0].b64_json : null;
    if (!isPngBase64(b64)) return sendFailure(res, 502, 'invalid-output', 'The image service returned no image.');
    return sendJson(res, 200, { dataUrl: PNG_DATA_URL_PREFIX + b64, model: settings.imageModel, promptVersion: PROMPT_VERSIONS[style] });
  }

  async function handleConfig(req, res) {
    if (!configured) return sendNotFound(res);
    return sendJson(res, 200, { providerId: 'openai-proxy', costLabel: settings.costLabel });
  }

  async function handleRedraw(req, res) {
    if (!configured) return sendNotFound(res);
    try {
      if (!accessCodeMatches(req.headers && req.headers['x-redraw-access-code'], settings.accessCode)) {
        return sendFailure(res, 401, 'unauthorized', 'The access code was not accepted.');
      }
      if (!allowRequest((req.socket && req.socket.remoteAddress) || 'unknown')) {
        return sendFailure(res, 429, 'rate-limited', 'The hourly redraw limit has been reached.');
      }
      const { tooLarge, text } = await readBody(req, REDRAW_MAX_BODY_BYTES);
      if (tooLarge) return sendFailure(res, 413, 'provider-failed', 'The image is too large to upload.');
      let parsed = null;
      try { parsed = JSON.parse(text); } catch { parsed = null; }
      if (!parsed || typeof parsed.image !== 'string' || !parsed.image.startsWith(PNG_DATA_URL_PREFIX)) {
        return sendFailure(res, 400, 'provider-failed', 'The upload must be a PNG image.');
      }
      // IMG-024 (D1): a body with no style key is 'stones', so older clients keep working.
      const style = 'style' in parsed ? parsed.style : 'stones';
      if (!REDRAW_STYLES.includes(style)) return sendFailure(res, 400, 'provider-failed', 'Unknown redraw style.');
      if (settings.fake) return sendJson(res, 200, { dataUrl: FAKE_REDRAW_DATA_URL, model: 'fake', promptVersion: PROMPT_VERSIONS[style] });
      return await callOpenAi(res, Buffer.from(parsed.image.slice(PNG_DATA_URL_PREFIX.length), 'base64'), style);
    } catch (error) {
      console.error('Redraw request failed:', error && error.message ? error.message : error);
      return sendFailure(res, 502, 'provider-failed', '');
    }
  }

  return { configured, handleConfig, handleRedraw };
}
