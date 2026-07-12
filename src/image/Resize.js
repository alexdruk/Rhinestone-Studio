/**
 * Optional resize stage of the Image Trace pipeline (RS-1008).
 *
 * Downscale-only (never upscales), aspect-ratio-preserving box-average resample so a field's
 * largest working dimension never exceeds maxWidthPx/maxHeightPx — this bounds the resolution the
 * final grid-sampling pass (ImageStoneSampler.js) walks, independent of the layer's mm placement
 * size. Uses a summed-area table (integral image) so every output pixel's box average is O(1) to
 * compute after one O(widthPx*heightPx) pass building the table — this stays fast at the
 * documented 2000x2000px working size.
 */

import { createField, assertPositiveInteger } from './ImageBuffer.js';

/**
 * @param {{widthPx: number, heightPx: number, data: Uint8ClampedArray}} field
 * @param {number} maxWidthPx
 * @param {number} maxHeightPx
 * @returns {{widthPx: number, heightPx: number, data: Uint8ClampedArray}}
 */
export function resizeField(field, maxWidthPx, maxHeightPx) {
  assertPositiveInteger(maxWidthPx, 'maxWidthPx');
  assertPositiveInteger(maxHeightPx, 'maxHeightPx');

  const { widthPx, heightPx, data } = field;
  const scale = Math.min(1, maxWidthPx / widthPx, maxHeightPx / heightPx);

  if (scale >= 1) {
    return createField({ widthPx, heightPx, data });
  }

  const newWidth = Math.max(1, Math.round(widthPx * scale));
  const newHeight = Math.max(1, Math.round(heightPx * scale));

  const stride = widthPx + 1;
  const integral = new Float64Array(stride * (heightPx + 1));
  for (let y = 0; y < heightPx; y++) {
    let rowSum = 0;
    for (let x = 0; x < widthPx; x++) {
      rowSum += data[y * widthPx + x];
      integral[(y + 1) * stride + (x + 1)] = integral[y * stride + (x + 1)] + rowSum;
    }
  }

  function rectSum(x0, y0, x1, y1) {
    const X0 = x0, Y0 = y0, X1 = x1 + 1, Y1 = y1 + 1;
    return integral[Y1 * stride + X1] - integral[Y0 * stride + X1] - integral[Y1 * stride + X0] + integral[Y0 * stride + X0];
  }

  const out = new Uint8ClampedArray(newWidth * newHeight);
  for (let oy = 0; oy < newHeight; oy++) {
    const sy0 = Math.min(heightPx - 1, Math.floor(oy / scale));
    const sy1 = Math.min(heightPx - 1, Math.max(sy0, Math.floor((oy + 1) / scale) - 1));
    for (let ox = 0; ox < newWidth; ox++) {
      const sx0 = Math.min(widthPx - 1, Math.floor(ox / scale));
      const sx1 = Math.min(widthPx - 1, Math.max(sx0, Math.floor((ox + 1) / scale) - 1));
      const area = (sx1 - sx0 + 1) * (sy1 - sy0 + 1);
      out[oy * newWidth + ox] = Math.round(rectSum(sx0, sy0, sx1, sy1) / area);
    }
  }

  return createField({ widthPx: newWidth, heightPx: newHeight, data: out });
}
