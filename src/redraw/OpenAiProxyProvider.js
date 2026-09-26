/**
 * IMG-022: the redraw provider that posts to our own server (server/redraw/handler.mjs, mounted by
 * tools/dev-server.mjs at POST /api/redraw), which calls OpenAI. The browser never sees the OpenAI
 * key; it sends only the operator's access code. See docs/specifications/IMG-022-RedrawProvider.md
 * D2 for the wire format.
 *
 * Failures are thrown as plain Errors carrying a `code` from REDRAW_ERROR_CODES (index.js turns them
 * into RedrawError), so this file has no import back into index.js. An abort is rethrown unchanged.
 */

export const OPENAI_PROXY_PROVIDER_ID = 'openai-proxy';
export const REDRAW_ENDPOINT = '/api/redraw';

const KNOWN_FAILURE_CODES = new Set(['not-configured', 'unauthorized', 'rate-limited', 'network', 'provider-failed', 'invalid-output', 'declined']);

function failure(code, detail) {
  const error = new Error(detail || code);
  error.code = code;
  error.detail = detail || '';
  return error;
}

export function createOpenAiProxyProvider({ fetch, costLabel = '' }) {
  return {
    id: OPENAI_PROXY_PROVIDER_ID,
    consent: { recipientName: 'OpenAI', costLabel, needsAccessCode: true },
    async redraw({ pngDataUrl, accessCode = '', signal }) {
      let response;
      try {
        response = await fetch(REDRAW_ENDPOINT, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Redraw-Access-Code': accessCode },
          body: JSON.stringify({ image: pngDataUrl }),
          signal
        });
      } catch (error) {
        if (error && error.name === 'AbortError') throw error;
        throw failure('network');
      }
      if (response.status === 404) throw failure('not-configured');
      let body = null;
      try {
        body = await response.json();
      } catch (error) {
        if (error && error.name === 'AbortError') throw error;
        body = null;
      }
      if (!response.ok) {
        const code = body && KNOWN_FAILURE_CODES.has(body.code) ? body.code : 'provider-failed';
        throw failure(code, body && typeof body.message === 'string' ? body.message : '');
      }
      if (!body || typeof body.dataUrl !== 'string' || !body.dataUrl.startsWith('data:image/')) throw failure('invalid-output');
      return { dataUrl: body.dataUrl, model: typeof body.model === 'string' ? body.model : '', promptVersion: body.promptVersion ?? null };
    }
  };
}
