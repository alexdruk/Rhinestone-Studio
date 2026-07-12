/**
 * Optional invert stage of the Image Trace pipeline (RS-1008).
 *
 * Flips a binary mask's foreground/background classification. Applied only when the layer's
 * `invert` flag is true.
 */

import { createField } from './ImageBuffer.js';

/**
 * @param {{widthPx: number, heightPx: number, data: Uint8ClampedArray}} maskBuffer binary mask (0/1).
 * @returns {{widthPx: number, heightPx: number, data: Uint8ClampedArray}} inverted binary mask.
 */
export function invertMask(maskBuffer) {
  const { widthPx, heightPx, data } = maskBuffer;
  const out = new Uint8ClampedArray(data.length);

  for (let i = 0; i < data.length; i++) {
    out[i] = data[i] ? 0 : 1;
  }

  return createField({ widthPx, heightPx, data: out });
}
