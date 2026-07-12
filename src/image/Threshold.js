/**
 * Threshold stage of the Image Trace pipeline (RS-1008).
 *
 * Converts a grayscale field into a binary mask: 1 ("foreground" — trace this) for pixels
 * strictly darker than thresholdValue, 0 ("background") otherwise. A pixel exactly equal to
 * thresholdValue is treated as background (not darker than the cutoff), matching the intuitive
 * reading of "threshold" as "how dark counts as foreground".
 */

import { createField } from './ImageBuffer.js';

export const THRESHOLD_MIN = 0;
export const THRESHOLD_MAX = 255;
export const DEFAULT_THRESHOLD = 128;

function assertThresholdValue(value) {
  if (!Number.isInteger(value) || value < THRESHOLD_MIN || value > THRESHOLD_MAX) {
    throw new RangeError(`thresholdValue must be an integer in [${THRESHOLD_MIN}, ${THRESHOLD_MAX}].`);
  }
}

/**
 * @param {{widthPx: number, heightPx: number, data: Uint8ClampedArray}} grayscaleBuffer
 * @param {number} [thresholdValue]
 * @returns {{widthPx: number, heightPx: number, data: Uint8ClampedArray}} binary mask (0/1).
 */
export function applyThreshold(grayscaleBuffer, thresholdValue = DEFAULT_THRESHOLD) {
  assertThresholdValue(thresholdValue);
  const { widthPx, heightPx, data } = grayscaleBuffer;
  const out = new Uint8ClampedArray(data.length);

  for (let i = 0; i < data.length; i++) {
    out[i] = data[i] < thresholdValue ? 1 : 0;
  }

  return createField({ widthPx, heightPx, data: out });
}
