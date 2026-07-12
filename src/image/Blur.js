/**
 * Optional blur stage of the Image Trace pipeline (RS-1008).
 *
 * Smooths a binary mask into a 0-255 density field via a separable box blur (horizontal pass then
 * vertical pass), each pass a sliding-window sum — O(widthPx*heightPx) total, independent of
 * radiusPx, so this stays fast at the full working resolution (documented up to 2000x2000px)
 * instead of the naive O(widthPx*heightPx*radiusPx^2) nested-loop box blur. Edge pixels use
 * clamp-to-edge sampling (the window's out-of-bounds taps repeat the nearest in-bounds value)
 * rather than treating the image border as background, so a shape touching the edge is not
 * artificially darkened/thinned by the blur.
 */

import { createField } from './ImageBuffer.js';

function clamp(value, lo, hi) {
  return value < lo ? lo : value > hi ? hi : value;
}

function boxBlurPass(src, widthPx, heightPx, radiusPx, horizontal) {
  const out = new Float32Array(src.length);
  const windowSize = radiusPx * 2 + 1;

  if (horizontal) {
    for (let y = 0; y < heightPx; y++) {
      const rowStart = y * widthPx;
      let sum = 0;
      for (let k = -radiusPx; k <= radiusPx; k++) {
        sum += src[rowStart + clamp(k, 0, widthPx - 1)];
      }
      out[rowStart] = sum / windowSize;
      for (let x = 1; x < widthPx; x++) {
        const addIdx = rowStart + clamp(x + radiusPx, 0, widthPx - 1);
        const removeIdx = rowStart + clamp(x - radiusPx - 1, 0, widthPx - 1);
        sum += src[addIdx] - src[removeIdx];
        out[rowStart + x] = sum / windowSize;
      }
    }
  } else {
    for (let x = 0; x < widthPx; x++) {
      let sum = 0;
      for (let k = -radiusPx; k <= radiusPx; k++) {
        sum += src[clamp(k, 0, heightPx - 1) * widthPx + x];
      }
      out[x] = sum / windowSize;
      for (let y = 1; y < heightPx; y++) {
        const addIdx = clamp(y + radiusPx, 0, heightPx - 1) * widthPx + x;
        const removeIdx = clamp(y - radiusPx - 1, 0, heightPx - 1) * widthPx + x;
        sum += src[addIdx] - src[removeIdx];
        out[y * widthPx + x] = sum / windowSize;
      }
    }
  }

  return out;
}

/**
 * @param {{widthPx: number, heightPx: number, data: Uint8ClampedArray}} maskBuffer binary mask (0/1).
 * @param {number} [radiusPx] 0 disables blurring (a pure 0/1 -> 0/255 rescale).
 * @returns {{widthPx: number, heightPx: number, data: Uint8ClampedArray}} density field (0-255).
 */
export function blurMask(maskBuffer, radiusPx = 0) {
  if (!Number.isInteger(radiusPx) || radiusPx < 0) {
    throw new RangeError('radiusPx must be a non-negative integer.');
  }

  const { widthPx, heightPx, data } = maskBuffer;

  if (radiusPx === 0) {
    const out = new Uint8ClampedArray(data.length);
    for (let i = 0; i < data.length; i++) {
      out[i] = data[i] ? 255 : 0;
    }
    return createField({ widthPx, heightPx, data: out });
  }

  const horizontalPass = boxBlurPass(Float32Array.from(data), widthPx, heightPx, radiusPx, true);
  const bothPasses = boxBlurPass(horizontalPass, widthPx, heightPx, radiusPx, false);

  const out = new Uint8ClampedArray(bothPasses.length);
  for (let i = 0; i < bothPasses.length; i++) {
    out[i] = Math.round(bothPasses[i] * 255);
  }

  return createField({ widthPx, heightPx, data: out });
}
