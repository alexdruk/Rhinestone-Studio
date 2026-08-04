/**
 * Image Trace field-preparation pipeline (RS-1008A).
 *
 * Runs the documented pipeline's bitmap-processing stages in order — grayscale -> threshold ->
 * optional invert -> optional blur -> optional resize — and returns the resulting neutral density
 * field ({widthPx, heightPx, data}). This module never constructs a Stone or StoneLayout and never
 * imports src/geometry/**: it prepares image-derived input only, mirroring how src/svg/** only
 * produces neutral Contours. The permanent src/geometry/GeometryEngine.js
 * (generateImageLayout()) is the only caller that turns this field into stones — see
 * docs/specifications/RS-1008A-ImageTraceArchitectureCorrection.md.
 *
 * Deterministic: identical (imageBuffer, params) always produce a deepEqual field.
 */

import { toGrayscale } from './Grayscale.js';
import { applyThreshold, THRESHOLD_MIN, THRESHOLD_MAX, DEFAULT_THRESHOLD } from './Threshold.js';
import { invertMask } from './Invert.js';
import { blurMask } from './Blur.js';
import { resizeField } from './Resize.js';

function assertPositiveNumber(value, name) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    throw new RangeError(`${name} must be a positive number.`);
  }
  return value;
}

function normalizeParams(params) {
  const threshold = params.threshold ?? DEFAULT_THRESHOLD;
  if (!Number.isInteger(threshold) || threshold < THRESHOLD_MIN || threshold > THRESHOLD_MAX) {
    throw new RangeError(`threshold must be an integer in [${THRESHOLD_MIN}, ${THRESHOLD_MAX}].`);
  }

  const invert = Boolean(params.invert);

  const blurRadiusPx = params.blurRadiusPx ?? 0;
  if (!Number.isInteger(blurRadiusPx) || blurRadiusPx < 0) {
    throw new RangeError('blurRadiusPx must be a non-negative integer.');
  }

  const maxWidthPx = Math.round(assertPositiveNumber(params.maxWidthPx, 'maxWidthPx'));
  const maxHeightPx = Math.round(assertPositiveNumber(params.maxHeightPx, 'maxHeightPx'));

  return { threshold, invert, blurRadiusPx, maxWidthPx, maxHeightPx };
}

/**
 * @param {{widthPx: number, heightPx: number, data: Uint8ClampedArray}} imageBuffer RGBA source.
 * @param {object} params
 * @param {number} [params.threshold] 0-255, default 128.
 * @param {boolean} [params.invert]
 * @param {number} [params.blurRadiusPx]
 * @param {number} params.maxWidthPx
 * @param {number} params.maxHeightPx
 * @returns {{widthPx: number, heightPx: number, data: Uint8ClampedArray}} the resulting density field.
 */
export function prepareImageField(imageBuffer, params = {}) {
  const options = normalizeParams(params);

  const grayscale = toGrayscale(imageBuffer);
  let mask = applyThreshold(grayscale, options.threshold);
  if (options.invert) {
    mask = invertMask(mask);
  }
  const density = blurMask(mask, options.blurRadiusPx);
  return resizeField(density, options.maxWidthPx, options.maxHeightPx);
}
