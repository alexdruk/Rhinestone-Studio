/**
 * Image Trace field-preparation pipeline (RS-1008A, extended IMG-001).
 *
 * Runs the documented pipeline's bitmap-processing stages in order — grayscale -> threshold ->
 * optional invert -> optional transparency mask -> optional blur -> optional resize — and returns
 * the resulting multi-channel field ({widthPx, heightPx, data, luminance, alpha, labels}). This
 * module never constructs a Stone or StoneLayout and never imports src/geometry/**: it prepares
 * image-derived input only, mirroring how src/svg/** only produces neutral Contours. The permanent
 * src/geometry/GeometryEngine.js (generateImageLayout()) is the only caller that turns this field
 * into stones — see docs/specifications/RS-1008A-ImageTraceArchitectureCorrection.md and
 * docs/specifications/IMG-001-ImageToStrass.md.
 *
 * Deterministic: identical (imageBuffer, params) always produce a deepEqual field.
 */

import { toGrayscale } from './Grayscale.js';
import { applyThreshold, THRESHOLD_MIN, THRESHOLD_MAX, DEFAULT_THRESHOLD } from './Threshold.js';
import { invertMask } from './Invert.js';
import { blurMask } from './Blur.js';
import { resizeField } from './Resize.js';
import { extractAlphaChannel, toCoverageMask, ALPHA_COVERAGE_THRESHOLD } from './Alpha.js';
import { createField } from './ImageBuffer.js';

// IMG-001: 'white' is the pre-IMG-001 default and the only behavior every existing caller/saved
// project has ever seen -- alpha is flattened onto white by toGrayscale() and no masking step runs.
// 'ignore' additionally forces any pixel whose source alpha is below ALPHA_COVERAGE_THRESHOLD off in
// `data`, regardless of luminance -- see prepareImageField()'s own doc comment for exactly where.
export const TRANSPARENT_MODES = new Set(['white', 'ignore']);
export const DEFAULT_TRANSPARENT_MODE = 'white';

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

  const transparent = params.transparent ?? DEFAULT_TRANSPARENT_MODE;
  if (!TRANSPARENT_MODES.has(transparent)) {
    throw new RangeError(`transparent must be one of: ${[...TRANSPARENT_MODES].join(', ')}.`);
  }

  return { threshold, invert, blurRadiusPx, maxWidthPx, maxHeightPx, transparent };
}

// IMG-001: forces every pixel whose native-resolution alpha is below the coverage threshold to 0
// ("off") in a threshold+invert mask, regardless of what luminance/invert produced there. Applied
// before blur, at native resolution, so a transparent region reads as a hard cutout rather than
// diffusing into its neighbors' density during the blur stage.
function maskOutTransparent(mask, alphaNative) {
  const out = Uint8ClampedArray.from(mask.data);
  for (let i = 0; i < out.length; i++) {
    if (alphaNative.data[i] < ALPHA_COVERAGE_THRESHOLD) {
      out[i] = 0;
    }
  }
  return createField({ widthPx: mask.widthPx, heightPx: mask.heightPx, data: out });
}

/**
 * @param {{widthPx: number, heightPx: number, data: Uint8ClampedArray}} imageBuffer RGBA source.
 * @param {object} params
 * @param {number} [params.threshold] 0-255, default 128.
 * @param {boolean} [params.invert]
 * @param {number} [params.blurRadiusPx]
 * @param {number} params.maxWidthPx
 * @param {number} params.maxHeightPx
 * @param {'white'|'ignore'} [params.transparent] Default 'white' -- see IMG-001-ImageToStrass.md.
 * @returns {{widthPx: number, heightPx: number, data: Uint8ClampedArray, luminance:
 *   Uint8ClampedArray, alpha: Uint8ClampedArray, labels: null}} the resulting multi-channel field.
 *   data/luminance/alpha all share the returned widthPx/heightPx.
 */
export function prepareImageField(imageBuffer, params = {}) {
  const options = normalizeParams(params);

  const luminanceNative = toGrayscale(imageBuffer);
  const alphaNative = extractAlphaChannel(imageBuffer);

  let mask = applyThreshold(luminanceNative, options.threshold);
  if (options.invert) {
    mask = invertMask(mask);
  }
  if (options.transparent === 'ignore') {
    mask = maskOutTransparent(mask, alphaNative);
  }
  const density = blurMask(mask, options.blurRadiusPx);
  const data = resizeField(density, options.maxWidthPx, options.maxHeightPx);

  const luminance = resizeField(luminanceNative, options.maxWidthPx, options.maxHeightPx);
  const alpha = toCoverageMask(resizeField(alphaNative, options.maxWidthPx, options.maxHeightPx));

  return {
    widthPx: data.widthPx,
    heightPx: data.heightPx,
    data: data.data,
    luminance: luminance.data,
    alpha: alpha.data,
    labels: null
  };
}
