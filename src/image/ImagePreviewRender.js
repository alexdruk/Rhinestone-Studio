/**
 * Pure preview-rendering helper for the "Preview before commit" import panel (RS-1008).
 *
 * Converts a single-channel field (typically the post-blur/resize density field) into an RGBA
 * buffer suitable for a real ImageData/putImageData() call. This function itself touches no DOM —
 * app.js wraps the result in an actual `ImageData`/`putImageData()` call, keeping DOM work in the
 * one place that already owns canvas access (matching CanvasRenderer2D.js's "renderer draws, does
 * not decide geometry" split, even though this helper is an editor-only preview, not a permanent
 * renderer).
 */

/**
 * @param {{widthPx: number, heightPx: number, data: Uint8ClampedArray}} field
 * @returns {Uint8ClampedArray} RGBA, length === widthPx*heightPx*4.
 */
export function maskFieldToRgba(field) {
  const { data } = field;
  const out = new Uint8ClampedArray(data.length * 4);

  for (let i = 0; i < data.length; i++) {
    const value = data[i];
    const offset = i * 4;
    out[offset] = value;
    out[offset + 1] = value;
    out[offset + 2] = value;
    out[offset + 3] = 255;
  }

  return out;
}

function hexToRgb(hex) {
  const h = String(hex).replace('#', '');
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

/**
 * IMG-002: converts a labeled field (`field.labels`, populated by the quantizer once colorCount > 1)
 * into an RGBA buffer for the "Colours" preview view -- modeled on maskFieldToRgba() above, the same
 * "field-to-RGBA is a pure, DOM-free conversion, app.js wraps it in an actual ImageData/putImageData()
 * call" split. `fillsByLabel` keeps palette knowledge out of src/image: app.js resolves each row's
 * catalog color to a hex string and hands this function a plain array indexed by label; any label
 * with no entry (including NO_LABEL, 255, which never has one) paints white -- the same "background"
 * convention Grayscale.js's own alpha-onto-white compositing already uses.
 *
 * @param {{labels: (Uint8ClampedArray|null)}} field
 * @param {string[]} fillsByLabel Hex color per label index (0..K-1).
 * @returns {Uint8ClampedArray} RGBA, length === field.labels.length*4 (or 0 when labels is null).
 */
export function labelsFieldToRgba(field, fillsByLabel) {
  const labels = field.labels;
  const length = labels ? labels.length : 0;
  const out = new Uint8ClampedArray(length * 4);

  for (let i = 0; i < length; i++) {
    const hex = fillsByLabel[labels[i]];
    const [r, g, b] = hex ? hexToRgb(hex) : [255, 255, 255];
    const offset = i * 4;
    out[offset] = r;
    out[offset + 1] = g;
    out[offset + 2] = b;
    out[offset + 3] = 255;
  }

  return out;
}
