/**
 * Edge-detection channel for the Image Trace pipeline (IMG-004).
 *
 * Sobel gradient magnitude of a single-channel field, then an optional separable square max filter
 * (a "band" -- every pixel takes the max Sobel value within `bandRadiusPx` of itself) implemented as
 * a monotonic-deque sliding-window maximum: O(widthPx*heightPx) total, independent of `bandRadiusPx`,
 * the same "independent of radius" performance shape Blur.js's own box blur already claims for its
 * sliding-window sum. `bandRadiusPx = 0` returns the raw per-pixel Sobel magnitude unchanged (the max
 * filter degenerates to identity at radius 0).
 *
 * No src/geometry import -- src/image/** never imports src/geometry/** (docs/ARCHITECTURE.md's
 * directional boundary, RS-1008A). Pure field-in/field-out, exactly like Blur.js.
 */

import { createField } from './ImageBuffer.js';

function clamp(value, lo, hi) {
  return value < lo ? lo : value > hi ? hi : value;
}

function at(data, widthPx, heightPx, x, y) {
  const cx = clamp(x, 0, widthPx - 1);
  const cy = clamp(y, 0, heightPx - 1);
  return data[cy * widthPx + cx];
}

function sobelMagnitude(data, widthPx, heightPx) {
  const out = new Uint8ClampedArray(widthPx * heightPx);
  for (let y = 0; y < heightPx; y++) {
    for (let x = 0; x < widthPx; x++) {
      const gx =
        -at(data, widthPx, heightPx, x - 1, y - 1) + at(data, widthPx, heightPx, x + 1, y - 1) +
        -2 * at(data, widthPx, heightPx, x - 1, y) + 2 * at(data, widthPx, heightPx, x + 1, y) +
        -at(data, widthPx, heightPx, x - 1, y + 1) + at(data, widthPx, heightPx, x + 1, y + 1);
      const gy =
        -at(data, widthPx, heightPx, x - 1, y - 1) - 2 * at(data, widthPx, heightPx, x, y - 1) - at(data, widthPx, heightPx, x + 1, y - 1) +
        at(data, widthPx, heightPx, x - 1, y + 1) + 2 * at(data, widthPx, heightPx, x, y + 1) + at(data, widthPx, heightPx, x + 1, y + 1);
      out[y * widthPx + x] = Math.min(255, Math.round(Math.hypot(gx, gy) / 4));
    }
  }
  return out;
}

// Monotonic-deque sliding-window maximum over one line (a row or a column) of length `len`, window
// radius `W`. `idx(i)` maps a line position to its index in the shared 2D buffer.
function maxFilterLine(src, out, idx, len, W, dq) {
  let head = 0, tail = 0;
  for (let i = 0; i < len + W; i++) {
    if (i < len) {
      const v = src[idx(i)];
      while (tail > head && src[idx(dq[tail - 1])] <= v) tail--;
      dq[tail++] = i;
    }
    const o = i - W;
    if (o >= 0) {
      while (dq[head] < o - W) head++;
      out[idx(o)] = src[idx(dq[head])];
    }
  }
}

function maxFilter(src, widthPx, heightPx, W) {
  const horizontal = new Uint8ClampedArray(src.length);
  const rowDq = new Int32Array(widthPx);
  for (let y = 0; y < heightPx; y++) {
    maxFilterLine(src, horizontal, (i) => y * widthPx + i, widthPx, W, rowDq);
  }

  const out = new Uint8ClampedArray(src.length);
  const colDq = new Int32Array(heightPx);
  for (let x = 0; x < widthPx; x++) {
    maxFilterLine(horizontal, out, (i) => i * widthPx + x, heightPx, W, colDq);
  }

  return out;
}

/**
 * @param {{widthPx: number, heightPx: number, data: Uint8ClampedArray}} field single-channel source.
 * @param {number} bandRadiusPx Non-negative integer. 0 returns the raw Sobel magnitude unchanged.
 * @returns {{widthPx: number, heightPx: number, data: Uint8ClampedArray}} edge channel (0-255).
 */
export function edgeChannel(field, bandRadiusPx) {
  if (!Number.isInteger(bandRadiusPx) || bandRadiusPx < 0) {
    throw new RangeError('bandRadiusPx must be a non-negative integer.');
  }

  const { widthPx, heightPx, data } = field;
  const sob = sobelMagnitude(data, widthPx, heightPx);

  if (bandRadiusPx === 0) {
    return createField({ widthPx, heightPx, data: sob });
  }

  const out = maxFilter(sob, widthPx, heightPx, bandRadiusPx);
  return createField({ widthPx, heightPx, data: out });
}
