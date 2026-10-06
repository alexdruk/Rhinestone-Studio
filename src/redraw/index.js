/**
 * IMG-022 -- "Redraw with AI". app.js talks only to this file: it never imports a provider and never
 * names the service behind one. This file picks the provider, shrinks the upload, checks what comes
 * back, and retries once on an unusable image. See docs/specifications/IMG-022-RedrawProvider.md.
 *
 * Swapping in another provider (the planned in-browser Web Worker model) is an edit to
 * selectProvider() below plus that provider's own file. A provider is a plain object:
 *   { id, consent, redraw({ pngDataUrl, accessCode, signal, style, onStage }) -> Promise<{ dataUrl, model, promptVersion, layout?, layoutError? }> }
 * where consent is null (nothing leaves the browser) or { recipientName, costLabel, needsAccessCode }.
 * IMG-024: `style` is one of REDRAW_STYLES; a provider that sends no prompt (the fake, a future
 * Worker) ignores it.
 * A provider signals failure by throwing an Error whose `code` is one of REDRAW_ERROR_CODES, and
 * rethrows an AbortError unchanged.
 * IMG-026 build B: the proxy provider runs a server job (OpenAI, then the layout service) and
 * resolves `layout` (the layout service's answer) or `layoutError` ({ code, message }) next to the
 * image; redrawImage() passes both through and forwards `onStage`. A provider without a layout (the
 * fake, a future Worker) gives layout: null, layoutError: null.
 */

import { decodeDataUrlToBuffer, computeSubjectMask } from '../image/index.js';
// Not in the src/image barrel; imported directly, as src/geometry/LineDesignSampler.js does for
// SubjectMask.js.
import { resizeImageBuffer, SUBJECT_MASK_RESIZE_TRIGGER_PX, SUBJECT_MASK_MAX_DIMENSION_PX } from '../image/ImageFieldPipeline.js';
import { createOpenAiProxyProvider, OPENAI_PROXY_PROVIDER_ID } from './OpenAiProxyProvider.js';

export { applyRedraw, restoreOriginal, fitAiStoneBox, fitAiLayoutCanvas, aiStoneEffectiveShrink, aiStoneMmPerPx } from './RedrawLayerTransform.js';

// IMG-023: 'declined' is OpenAI's safety-system refusal (never retried here; the server retries once).
// IMG-026: the layout-* codes describe a layout failure after a good OpenAI image (layoutError).
export const REDRAW_ERROR_CODES = Object.freeze(['not-configured', 'unauthorized', 'rate-limited', 'network', 'provider-failed', 'invalid-output', 'declined', 'layout-unavailable', 'layout-timeout', 'layout-failed']);
// IMG-024 (D1): the same value as server/redraw/prompt.mjs's REDRAW_STYLES, restated because src/**
// never imports server/**; a test keeps the two deepEqual.
export const REDRAW_STYLES = Object.freeze(['stones', 'flat']);
// IMG-026 (C1): the status text for each job stage reported through onStage. Kept here, not in
// app.js, because app.js never names the image provider.
export const REDRAW_STAGE_MESSAGES = Object.freeze({ drawing: 'OpenAI is drawing… (up to five minutes)', placing: 'Placing stones…' });
const REDRAW_CONFIG_ENDPOINT = '/api/redraw/config';
const REDRAW_MAX_UPLOAD_PX = 1536;
const REDRAW_MIN_SUBJECT_COVERAGE = 0.01;
const REDRAW_MAX_SUBJECT_COVERAGE = 0.99;

export class RedrawError extends Error {
  constructor(code, detail = '') {
    super(detail || code);
    this.name = 'RedrawError';
    this.code = code;
    this.detail = detail;
  }
}

function abortError() {
  return new DOMException('Redraw cancelled.', 'AbortError');
}

function defaultEncodePng(buffer) {
  const canvas = document.createElement('canvas');
  canvas.width = buffer.widthPx;
  canvas.height = buffer.heightPx;
  canvas.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(buffer.data), buffer.widthPx, buffer.heightPx), 0, 0);
  return canvas.toDataURL('image/png');
}

const DEFAULTS = {
  fetch: (...args) => globalThis.fetch(...args),
  decodeImage: decodeDataUrlToBuffer,
  encodePng: defaultEncodePng,
  provider: null,
  // IMG-026: the proxy provider's wait between polls, (ms, signal) -> Promise; null = real timers.
  wait: null
};

let deps = { ...DEFAULTS };
let selection = null; // Promise<provider|null>, cached after the first call
let accessCode = '';

/** Test and wiring injection. No argument resets every default and the cached selection. */
export function configureRedraw(overrides) {
  deps = { ...DEFAULTS };
  if (overrides) for (const key of Object.keys(DEFAULTS)) if (overrides[key] !== undefined) deps[key] = overrides[key];
  selection = null;
  accessCode = '';
}

export function setRedrawAccessCode(code) {
  accessCode = typeof code === 'string' ? code : '';
}

async function selectProvider() {
  if (deps.provider) return deps.provider;
  try {
    const response = await deps.fetch(REDRAW_CONFIG_ENDPOINT, { method: 'GET' });
    if (!response || response.status !== 200) return null;
    const body = await response.json();
    if (!body || body.providerId !== OPENAI_PROXY_PROVIDER_ID) return null;
    const costLabel = typeof body.costLabel === 'string' ? body.costLabel : '';
    return createOpenAiProxyProvider(deps.wait ? { fetch: deps.fetch, costLabel, wait: deps.wait } : { fetch: deps.fetch, costLabel });
  } catch {
    return null;
  }
}

function activeProvider() {
  if (!selection) selection = selectProvider();
  return selection;
}

/** Resolves { available: false } or { available: true, providerId, consent }. */
export async function getRedrawAvailability() {
  const provider = await activeProvider();
  return provider ? { available: true, providerId: provider.id, consent: provider.consent ?? null } : { available: false };
}

/** Fraction of pixels computeSubjectMask() calls subject, on the same size rule the image pipeline
 * uses (computeNativeSizeSubjectMask() in ImageFieldPipeline.js). */
function subjectCoverage(buffer) {
  const sized = Math.max(buffer.widthPx, buffer.heightPx) > SUBJECT_MASK_RESIZE_TRIGGER_PX
    ? resizeImageBuffer(buffer, SUBJECT_MASK_MAX_DIMENSION_PX, SUBJECT_MASK_MAX_DIMENSION_PX)
    : buffer;
  const { data } = computeSubjectMask(sized, {}).mask;
  let subject = 0;
  for (let i = 0; i < data.length; i++) if (data[i] === 1) subject++;
  return data.length ? subject / data.length : 0;
}

async function isUsableOutput(dataUrl) {
  let buffer;
  try {
    buffer = await deps.decodeImage(dataUrl);
  } catch {
    return false;
  }
  if (!buffer || !(buffer.widthPx > 0) || !(buffer.heightPx > 0)) return false;
  const coverage = subjectCoverage(buffer);
  return coverage >= REDRAW_MIN_SUBJECT_COVERAGE && coverage <= REDRAW_MAX_SUBJECT_COVERAGE;
}

// Rejects as soon as the signal aborts, even if the promise it guards never settles.
function untilAborted(promise, signal) {
  if (!signal) return promise;
  if (signal.aborted) return Promise.reject(abortError());
  return new Promise((resolve, reject) => {
    const onAbort = () => reject(abortError());
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(
      (value) => { signal.removeEventListener('abort', onAbort); resolve(value); },
      (error) => { signal.removeEventListener('abort', onAbort); reject(error); }
    );
  });
}

/**
 * @param {{dataUrl:string, signal?:AbortSignal, style?:('stones'|'flat'), onStage?:function(string):void}} request
 * @returns {Promise<{dataUrl:string, providerId:string, model:string, promptVersion:(number|null), layout:(object|null), layoutError:({code:string,message:string}|null)}>}
 */
export async function redrawImage({ dataUrl, signal, style = 'stones', onStage } = {}) {
  if (signal && signal.aborted) throw abortError();
  if (!REDRAW_STYLES.includes(style)) throw new RedrawError('provider-failed', 'Unknown redraw style.');
  const provider = await untilAborted(activeProvider(), signal);
  if (!provider) throw new RedrawError('not-configured');

  let pngDataUrl;
  try {
    const source = await untilAborted(Promise.resolve(deps.decodeImage(dataUrl)), signal);
    pngDataUrl = await deps.encodePng(resizeImageBuffer(source, REDRAW_MAX_UPLOAD_PX, REDRAW_MAX_UPLOAD_PX));
  } catch (error) {
    if (error && error.name === 'AbortError') throw error;
    throw new RedrawError('provider-failed', `The image could not be prepared for upload: ${error && error.message ? error.message : error}`);
  }

  for (let attempt = 1; attempt <= 2; attempt++) {
    let result;
    try {
      result = await untilAborted(Promise.resolve().then(() => provider.redraw({ pngDataUrl, accessCode, signal, style, onStage })), signal);
    } catch (error) {
      if (error && error.name === 'AbortError') throw error;
      const code = error && REDRAW_ERROR_CODES.includes(error.code) ? error.code : 'provider-failed';
      if (code === 'invalid-output' && attempt === 1) continue;
      throw new RedrawError(code, error && typeof error.detail === 'string' ? error.detail : '');
    }
    const usable = result && typeof result.dataUrl === 'string' && await untilAborted(isUsableOutput(result.dataUrl), signal);
    if (usable) return { dataUrl: result.dataUrl, providerId: provider.id, model: result.model, promptVersion: result.promptVersion, layout: result.layout ?? null, layoutError: result.layoutError ?? null };
  }
  throw new RedrawError('invalid-output');
}
