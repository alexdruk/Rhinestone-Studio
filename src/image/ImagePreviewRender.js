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
