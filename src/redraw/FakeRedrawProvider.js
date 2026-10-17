/**
 * IMG-022: a redraw provider that returns one fixed image, for tests and for the dev server's
 * REDRAW_FAKE=1 mode (server/redraw/handler.mjs imports FAKE_REDRAW_DATA_URL from here, so the
 * fixture has one source). It makes no request and needs no consent.
 *
 * FAKE_REDRAW_DATA_URL is a 64 x 64 RGBA PNG: pixel (x, y) is opaque Jet #141414 when
 * Math.hypot(x + 0.5 - 32, y + 0.5 - 32) <= 24, transparent otherwise (subject coverage 0.4404,
 * so it passes redrawImage()'s output check). See docs/specifications/IMG-022-RedrawProvider.md D2.
 */

export const FAKE_REDRAW_DATA_URL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAYAAACqaXHeAAAAq0lEQVR42u3awQ3EIAwFUYqg/1ZJCyttMJ/4jZQCZk7E9hgAAAAFzDnXL19L6U/F+Ff66hi75OMj7BaPDlEtHxXhlHxEhNPyRyOkyB+JkCZfGiFVvixC6wDp8lsj3CK/LYIAnQPcJv96BAE6B7hV/rUIAggggAACCCCAAF6D/gUEWGYCJkICLJPhrvIWIwJYjlqPO5BwIuNIypmcQ0mnsrUxxpdoKQ0AAGJ5ANdmrD3Awg4wAAAAAElFTkSuQmCC';

export const FAKE_REDRAW_PROVIDER_ID = 'fake';

export function createFakeRedrawProvider({ dataUrl = FAKE_REDRAW_DATA_URL } = {}) {
  return {
    id: FAKE_REDRAW_PROVIDER_ID,
    consent: null,
    async redraw({ signal } = {}) {
      if (signal && signal.aborted) throw new DOMException('Redraw cancelled.', 'AbortError');
      // No prompt is sent, so there is no prompt version.
      return { dataUrl, model: 'fake', promptVersion: null };
    }
  };
}
