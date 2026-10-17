/**
 * Alpha-channel stage of the Image Trace pipeline (IMG-001).
 *
 * Extracts the raw per-pixel alpha byte from an RGBA ImageBuffer into a single-channel field (the
 * same {widthPx, heightPx, data} shape Grayscale.js/Threshold.js/etc. already share), and reduces a
 * (possibly box-averaged, post-resize) alpha field to a strict 0/255 coverage mask.
 */

import { createField } from './ImageBuffer.js';

// A resized alpha field holds box-averaged 0-255 values (partial coverage of the output cell), not
// a strict mask -- this is the same "> 50% counts as covered" cutoff the transparency policy's
// native-resolution 'ignore' decision uses (ImageFieldPipeline.js), applied once more after resize
// so the exported `alpha` channel is always strictly 0/255, never a continuous average.
export const ALPHA_COVERAGE_THRESHOLD = 128;

/**
 * @param {{widthPx: number, heightPx: number, data: Uint8ClampedArray}} imageBuffer RGBA.
 * @returns {{widthPx: number, heightPx: number, data: Uint8ClampedArray}} raw alpha, 0-255.
 */
export function extractAlphaChannel(imageBuffer) {
  const { widthPx, heightPx, data } = imageBuffer;
  const pixelCount = widthPx * heightPx;
  const out = new Uint8ClampedArray(pixelCount);

  for (let i = 0; i < pixelCount; i++) {
    out[i] = data[i * 4 + 3];
  }

  return createField({ widthPx, heightPx, data: out });
}

/**
 * @param {{widthPx: number, heightPx: number, data: Uint8ClampedArray}} alphaField 0-255.
 * @param {number} [thresholdValue]
 * @returns {{widthPx: number, heightPx: number, data: Uint8ClampedArray}} strict 0/255 coverage mask.
 */
export function toCoverageMask(alphaField, thresholdValue = ALPHA_COVERAGE_THRESHOLD) {
  const { widthPx, heightPx, data } = alphaField;
  const out = new Uint8ClampedArray(data.length);

  for (let i = 0; i < data.length; i++) {
    out[i] = data[i] >= thresholdValue ? 255 : 0;
  }

  return createField({ widthPx, heightPx, data: out });
}
