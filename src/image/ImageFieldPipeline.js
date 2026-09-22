/**
 * Image Trace field-preparation pipeline (RS-1008A, extended IMG-001).
 *
 * Runs the documented pipeline's bitmap-processing stages in order — grayscale -> threshold ->
 * optional invert -> optional transparency mask -> optional blur -> optional resize — and returns
 * the resulting multi-channel field ({widthPx, heightPx, data, luminance, alpha, edge, labels}).
 * `edge` (IMG-004) is the Sobel-magnitude edge channel of `data` at working resolution, computed
 * unconditionally via src/image/Edge.js's edgeChannel(); its band radius (`edgeBandFraction`) is
 * expressed as a fraction of the working field's own post-resize widthPx, converted to a real pixel
 * radius against `data.widthPx` right before that call -- not a pixel count passed straight through,
 * since resizeField() is downscale-only and aspect-preserving (a caller-supplied pixel radius sized
 * against the requested maxWidthPx would be wrong whenever the source is already smaller than
 * maxWidthPx, or heightPx is the binding dimension). `edge` is read only by the 'edge' image sample
 * mode. This
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
import { edgeChannel } from './Edge.js';
import { resizeField } from './Resize.js';
import { extractAlphaChannel, toCoverageMask, ALPHA_COVERAGE_THRESHOLD } from './Alpha.js';
import { createField } from './ImageBuffer.js';
import { quantizeColors } from './ColorQuantize.js';
import { computeSubjectMask } from './SubjectMask.js';

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

  // IMG-004 follow-up: a dimensionless fraction of the working field's own post-resize widthPx,
  // not a pixel count -- resizeField() is downscale-only and aspect-preserving, so a caller-supplied
  // pixel radius sized against the requested maxWidthPx would be wrong whenever the source is already
  // smaller than maxWidthPx or heightPx is the binding dimension. prepareImageField() converts this to
  // a real pixel radius itself, against `data.widthPx` (see its own call site below).
  const edgeBandFraction = params.edgeBandFraction ?? 0;
  if (typeof edgeBandFraction !== 'number' || !Number.isFinite(edgeBandFraction) || edgeBandFraction < 0) {
    throw new RangeError('edgeBandFraction must be a non-negative finite number.');
  }

  const maxWidthPx = Math.round(assertPositiveNumber(params.maxWidthPx, 'maxWidthPx'));
  const maxHeightPx = Math.round(assertPositiveNumber(params.maxHeightPx, 'maxHeightPx'));

  const transparent = params.transparent ?? DEFAULT_TRANSPARENT_MODE;
  if (!TRANSPARENT_MODES.has(transparent)) {
    throw new RangeError(`transparent must be one of: ${[...TRANSPARENT_MODES].join(', ')}.`);
  }

  // IMG-002: colorCount omitted or 1 keeps this milestone's colorGroups/quantizer entirely out of
  // the picture -- see prepareImageField()'s own doc comment.
  const colorCount = params.colorCount ?? 1;
  if (!Number.isInteger(colorCount) || colorCount < 1 || colorCount > 8) {
    throw new RangeError('colorCount must be an integer in [1, 8].');
  }
  let palette = null;
  if (colorCount > 1) {
    if (!Array.isArray(params.palette) || params.palette.length === 0) {
      throw new TypeError('palette is required (a non-empty [{id, hex}] array) when colorCount > 1.');
    }
    palette = params.palette;
  }

  // IMG-009: read-site permissive default, like every other optional layer-derived param above --
  // 'threshold' unless the value is exactly 'subject', never a throw. This is what makes every saved
  // project (no stored maskMode) and every caller predating this milestone (four existing test files,
  // resolveLayerShapeSource()) resolve to 'threshold' and stay byte-identical -- see
  // docs/specifications/IMG-009-SubjectMask.md decision 3.
  const maskMode = params.maskMode === 'subject' ? 'subject' : 'threshold';

  return { threshold, invert, blurRadiusPx, edgeBandFraction, maxWidthPx, maxHeightPx, transparent, colorCount, palette, maskMode };
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

// IMG-002: alpha-composites one RGBA channel onto white, at native resolution -- the same
// alpha-onto-white rationale toGrayscale() (Grayscale.js) already uses for its luminosity blend,
// applied per-channel instead of luminosity-combined, so R/G/B can be clustered in their own right.
// IMG-012: exported (this function's own body is unchanged) so AutoColourCount.js's
// prepareAutoColorField() can build the same per-pixel r/g/b channels prepareImageField() computes
// internally for colorCount>1 -- prepareImageField() itself has no return-value slot for per-pixel
// color (only aggregate colorGroups[].rgb, one value per cluster, not per pixel), and Auto's own
// mean-ΔE-per-subject-pixel scoring needs the real per-pixel value. Reusing this existing pure
// function (rather than widening prepareImageField()'s own params/return contract, or duplicating
// its logic) is the smaller, already-correct fix -- see docs/specifications/IMG-012-AutoColourCount.md.
export function compositeChannelOntoWhite(imageBuffer, channelOffset) {
  const { widthPx, heightPx, data } = imageBuffer;
  const pixelCount = widthPx * heightPx;
  const out = new Uint8ClampedArray(pixelCount);
  for (let i = 0; i < pixelCount; i++) {
    const offset = i * 4;
    const c = data[offset + channelOffset];
    const a = data[offset + 3] / 255;
    out[i] = c * a + 255 * (1 - a);
  }
  return createField({ widthPx, heightPx, data: out });
}

/**
 * @param {{widthPx: number, heightPx: number, data: Uint8ClampedArray}} imageBuffer RGBA source.
 * @param {object} params
 * @param {number} [params.threshold] 0-255, default 128.
 * @param {boolean} [params.invert]
 * @param {number} [params.blurRadiusPx]
 * @param {number} [params.edgeBandFraction] Non-negative finite number, default 0. The IMG-004
 *   `edge` channel's max-filter band radius, as a fraction of the working field's own post-resize
 *   widthPx (not a pixel count -- see this file's header comment for why); converted to a real pixel
 *   radius against `data.widthPx` below. A fraction of 0 returns the raw Sobel magnitude.
 * @param {number} params.maxWidthPx
 * @param {number} params.maxHeightPx
 * @param {'white'|'ignore'} [params.transparent] Default 'white' -- see IMG-001-ImageToStrass.md.
 * @param {number} [params.colorCount] Integer 1-8, default 1. >1 runs the IMG-002 quantizer.
 * @param {{id: string, hex: string}[]} [params.palette] Required when colorCount > 1.
 * @param {'threshold'|'subject'} [params.maskMode] Default 'threshold' -- which operator produces
 *   the on/off mask `data`/blur/resize/colorCount all run on. 'subject' calls SubjectMask.js's
 *   computeSubjectMask() instead of applyThreshold(); see docs/specifications/IMG-009-SubjectMask.md.
 * @returns {{widthPx: number, heightPx: number, data: Uint8ClampedArray, luminance:
 *   Uint8ClampedArray, alpha: Uint8ClampedArray, edge: Uint8ClampedArray, labels:
 *   (Uint8ClampedArray|null), colorGroups?: {rgb: number[], pixelShare: number, nearestId: string}[]}}
 *   the resulting multi-channel field. data/luminance/alpha/edge/labels all share the returned
 *   widthPx/heightPx. `colorGroups` is present only when colorCount > 1 (and therefore labels is
 *   non-null); `colorCount` omitted or 1 returns exactly the seven IMG-001/IMG-004 keys,
 *   `colorGroups` absent.
 */
export function prepareImageField(imageBuffer, params = {}) {
  const options = normalizeParams(params);

  const luminanceNative = toGrayscale(imageBuffer);
  const alphaNative = extractAlphaChannel(imageBuffer);

  let mask = options.maskMode === 'subject'
    ? computeSubjectMask(imageBuffer, {}).mask
    : applyThreshold(luminanceNative, options.threshold);
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
  // IMG-004 follow-up: bandRadiusPx is computed from data's own real post-resize widthPx, not the
  // requested maxWidthPx -- see normalizeParams()'s edgeBandFraction comment above.
  const bandRadiusPx = Math.round(options.edgeBandFraction * data.widthPx);
  const edge = edgeChannel(data, bandRadiusPx);

  const field = {
    widthPx: data.widthPx,
    heightPx: data.heightPx,
    data: data.data,
    luminance: luminance.data,
    alpha: alpha.data,
    edge: edge.data,
    labels: null
  };

  if (options.colorCount > 1) {
    const rNative = compositeChannelOntoWhite(imageBuffer, 0);
    const gNative = compositeChannelOntoWhite(imageBuffer, 1);
    const bNative = compositeChannelOntoWhite(imageBuffer, 2);
    const r = resizeField(rNative, options.maxWidthPx, options.maxHeightPx);
    const g = resizeField(gNative, options.maxWidthPx, options.maxHeightPx);
    const b = resizeField(bNative, options.maxWidthPx, options.maxHeightPx);
    const { labels, colorGroups } = quantizeColors({
      r: r.data, g: g.data, b: b.data, data: field.data, colorCount: options.colorCount, palette: options.palette
    });
    field.labels = labels;
    field.colorGroups = colorGroups;
  }

  return field;
}
