/**
 * Image Trace pipeline orchestrator (RS-1008).
 *
 * Runs the documented pipeline in order — grayscale -> threshold -> optional invert -> optional
 * blur -> optional resize -> grid-sample -> StoneLayout — and wraps the result in the real,
 * unmodified Stone/StoneLayout classes imported from src/geometry/index.js (the same public
 * barrel app.js already imports them from). This mirrors GeometryEngine.generateSvgLayout()'s
 * "normalize params -> sample points -> Stone[] -> StoneLayout" shape without editing
 * src/geometry/GeometryEngine.js itself (forbidden for this milestone — see
 * docs/specifications/RS-1008-ImageTrace.md, "Architecture Requirements").
 *
 * Units: every *Mm parameter is millimeters; every *Px parameter is pixels. Deterministic:
 * identical imageBuffer + params always produce deepEqual StoneLayout.toJSON() output.
 */

import { Stone, StoneLayout } from '../geometry/index.js';
import { toGrayscale } from './Grayscale.js';
import { applyThreshold, THRESHOLD_MIN, THRESHOLD_MAX, DEFAULT_THRESHOLD } from './Threshold.js';
import { invertMask } from './Invert.js';
import { blurMask } from './Blur.js';
import { resizeField } from './Resize.js';
import { sampleImageFillPoints } from './ImageStoneSampler.js';

function assertFiniteNumber(value, name) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new TypeError(`${name} must be a finite number.`);
  }
  return value;
}

function assertPositiveNumber(value, name) {
  assertFiniteNumber(value, name);
  if (value <= 0) {
    throw new RangeError(`${name} must be positive.`);
  }
  return value;
}

function normalizeParams(params) {
  if (typeof params.layerId !== 'string' || params.layerId.length === 0) {
    throw new TypeError('traceImageBufferToStoneLayout requires a non-empty layerId.');
  }

  const xMm = assertFiniteNumber(params.xMm ?? 0, 'xMm');
  const yMm = assertFiniteNumber(params.yMm ?? 0, 'yMm');
  const widthMm = assertPositiveNumber(params.widthMm, 'widthMm');
  const heightMm = assertPositiveNumber(params.heightMm, 'heightMm');
  const stoneSizeMm = assertPositiveNumber(params.stoneSizeMm, 'stoneSizeMm');

  const gapMm = assertFiniteNumber(params.gapMm ?? 0, 'gapMm');
  if (gapMm < 0) {
    throw new RangeError('gapMm must be zero or positive.');
  }

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

  if (params.color !== undefined && params.color !== null &&
    (typeof params.color !== 'string' || params.color.length === 0)) {
    throw new TypeError('traceImageBufferToStoneLayout color must be a non-empty string when provided.');
  }

  return {
    layerId: params.layerId,
    xMm,
    yMm,
    widthMm,
    heightMm,
    stoneSizeMm,
    gapMm,
    threshold,
    invert,
    blurRadiusPx,
    maxWidthPx,
    maxHeightPx,
    color: params.color ?? null
  };
}

/**
 * @param {{widthPx: number, heightPx: number, data: Uint8ClampedArray}} imageBuffer RGBA source.
 * @param {object} params
 * @param {string} params.layerId
 * @param {number} [params.xMm]
 * @param {number} [params.yMm]
 * @param {number} params.widthMm
 * @param {number} params.heightMm
 * @param {number} params.stoneSizeMm
 * @param {number} [params.gapMm]
 * @param {string} [params.color]
 * @param {number} [params.threshold] 0-255, default 128.
 * @param {boolean} [params.invert]
 * @param {number} [params.blurRadiusPx]
 * @param {number} params.maxWidthPx
 * @param {number} params.maxHeightPx
 * @returns {StoneLayout}
 */
export function traceImageBufferToStoneLayout(imageBuffer, params = {}) {
  const options = normalizeParams(params);

  const grayscale = toGrayscale(imageBuffer);
  let mask = applyThreshold(grayscale, options.threshold);
  if (options.invert) {
    mask = invertMask(mask);
  }
  const density = blurMask(mask, options.blurRadiusPx);
  const resized = resizeField(density, options.maxWidthPx, options.maxHeightPx);

  const spacingMm = options.stoneSizeMm + options.gapMm;
  const points = sampleImageFillPoints(resized, {
    xMm: options.xMm,
    yMm: options.yMm,
    widthMm: options.widthMm,
    heightMm: options.heightMm,
    spacingMm
  });

  const stones = points.map((point, index) => new Stone({
    xMm: point.xMm,
    yMm: point.yMm,
    sizeMm: options.stoneSizeMm,
    color: options.color,
    layerId: options.layerId,
    index
  }));

  return new StoneLayout({ layerId: options.layerId, sourceMode: 'fill', stones });
}
