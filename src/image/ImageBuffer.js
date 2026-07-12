/**
 * Plain pixel-buffer primitives for the Image Trace pipeline (RS-1008).
 *
 * An ImageBuffer is a DOM-free, Node-testable wrapper around raw RGBA pixel data
 * ({ widthPx, heightPx, data }) — the raster counterpart to src/text/VectorPath.js's Point2D/
 * Contour primitives for vector art. Nothing in this module touches the DOM, Canvas, or any
 * image codec; decoding real image bytes into this shape happens only in ImageDecoder.js.
 *
 * A single-channel field ({ widthPx, heightPx, data }) with a one-byte-per-pixel Uint8ClampedArray
 * is reused across Grayscale/Threshold/Invert/Blur/Resize — they all share this same shape, only
 * the interpretation of `data`'s values changes (0-255 gray, 0/1 mask, 0-255 density).
 */

function assertPositiveInteger(value, name) {
  if (!Number.isInteger(value) || value <= 0) {
    throw new TypeError(`${name} must be a positive integer.`);
  }
}

/**
 * Wrap and validate a raw RGBA pixel buffer.
 *
 * @param {object} params
 * @param {number} params.widthPx
 * @param {number} params.heightPx
 * @param {Uint8ClampedArray|Uint8Array} params.data RGBA, length === widthPx*heightPx*4.
 * @returns {{widthPx: number, heightPx: number, data: Uint8ClampedArray}}
 */
export function createImageBuffer({ widthPx, heightPx, data } = {}) {
  assertPositiveInteger(widthPx, 'widthPx');
  assertPositiveInteger(heightPx, 'heightPx');
  if (!data || typeof data.length !== 'number') {
    throw new TypeError('ImageBuffer requires a data array.');
  }
  const expectedLength = widthPx * heightPx * 4;
  if (data.length !== expectedLength) {
    throw new RangeError(`ImageBuffer data length ${data.length} does not match widthPx*heightPx*4 (${expectedLength}).`);
  }
  return { widthPx, heightPx, data: Uint8ClampedArray.from(data) };
}

/**
 * Wrap and validate a single-channel field (grayscale, binary mask, or density map — all share
 * this shape, distinguished only by which module produced them).
 *
 * @param {object} params
 * @param {number} params.widthPx
 * @param {number} params.heightPx
 * @param {Uint8ClampedArray|Uint8Array} params.data length === widthPx*heightPx.
 * @returns {{widthPx: number, heightPx: number, data: Uint8ClampedArray}}
 */
export function createField({ widthPx, heightPx, data } = {}) {
  assertPositiveInteger(widthPx, 'widthPx');
  assertPositiveInteger(heightPx, 'heightPx');
  if (!data || typeof data.length !== 'number') {
    throw new TypeError('Field requires a data array.');
  }
  const expectedLength = widthPx * heightPx;
  if (data.length !== expectedLength) {
    throw new RangeError(`Field data length ${data.length} does not match widthPx*heightPx (${expectedLength}).`);
  }
  return { widthPx, heightPx, data: Uint8ClampedArray.from(data) };
}

export { assertPositiveInteger };
