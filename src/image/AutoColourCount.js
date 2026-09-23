/**
 * Automatic colour count (IMG-012, rewritten by IMG-015).
 *
 * Pure, palette-agnostic: runs ColorQuantize.js's direct catalog labelling once over the same
 * subject-pixel field prepareImageField()'s own colorCount>1 branch labels, and counts n, the catalog
 * colours clearing its 1.2% share floor, capped at AUTO_MAX_K. The resolved count is max(2, n), so
 * Auto never takes the uncoloured path while there are subject pixels, and 1 when there are none.
 * Never imports src/geometry/** or app.js -- the same "peer input-processing module" boundary every
 * other src/image/** file keeps. Deterministic: identical (field, palette) always produce a
 * deepEqual result, since the labelling itself is deterministic.
 *
 * See docs/specifications/IMG-015-DirectCatalogueColour.md, decisions 3 and 7. IMG-012's k=2..8
 * mean-ΔE sweep and its 1% tie band retired with the median-cut quantizer they scored.
 */

import { labelCatalogColors, FIELD_ON_THRESHOLD } from './ColorQuantize.js';
import { prepareImageField, compositeChannelOntoWhite } from './ImageFieldPipeline.js';
import { resizeField } from './Resize.js';

const AUTO_MAX_K = 8;

/**
 * Builds the mask-aware {r, g, b, data} field chooseAutoColorCount() labels, mirroring exactly what
 * generateImageStonesLive()'s own prepareImageField() call prepares for production (maskMode-aware
 * `data`), plus the same per-pixel r/g/b channels prepareImageField()'s own colorCount>1 branch
 * builds internally (via the now-exported compositeChannelOntoWhite()) but never returns to its
 * caller.
 *
 * @param {{widthPx: number, heightPx: number, data: Uint8ClampedArray}} imageBuffer RGBA source.
 * @param {object} params Same shape as prepareImageField()'s own params, minus colorCount/palette:
 *   threshold, invert, blurRadiusPx, maxWidthPx, maxHeightPx, transparent, maskMode.
 * @returns {{r: Uint8ClampedArray, g: Uint8ClampedArray, b: Uint8ClampedArray,
 *   data: Uint8ClampedArray, widthPx: number, heightPx: number}}
 */
export function prepareAutoColorField(imageBuffer, params = {}) {
  const { data, widthPx, heightPx } = prepareImageField(imageBuffer, {
    threshold: params.threshold,
    invert: params.invert,
    blurRadiusPx: params.blurRadiusPx,
    maxWidthPx: params.maxWidthPx,
    maxHeightPx: params.maxHeightPx,
    transparent: params.transparent,
    maskMode: params.maskMode
  });
  // Mirrors prepareImageField()'s own normalizeParams() rounding so r/g/b resize to the exact same
  // dimensions `data` above already resolved to.
  const maxWidthPx = Math.round(params.maxWidthPx);
  const maxHeightPx = Math.round(params.maxHeightPx);
  const r = resizeField(compositeChannelOntoWhite(imageBuffer, 0), maxWidthPx, maxHeightPx).data;
  const g = resizeField(compositeChannelOntoWhite(imageBuffer, 1), maxWidthPx, maxHeightPx).data;
  const b = resizeField(compositeChannelOntoWhite(imageBuffer, 2), maxWidthPx, maxHeightPx).data;
  return { r, g, b, data, widthPx, heightPx };
}

/**
 * @param {{r: Uint8ClampedArray, g: Uint8ClampedArray, b: Uint8ClampedArray, data: Uint8ClampedArray}} field
 *   Same shape quantizeColors() itself takes (r/g/b/data), e.g. from prepareAutoColorField().
 * @param {{id: string, hex: string}[]} palette Catalog entries, same shape quantizeColors() takes.
 * @param {{chromaScale?: number}} [options] IMG-017: the layer's resolved vividness, so Auto counts
 *   the same scaled labels the pipeline will. Default 1.
 * @returns {{resolvedCount: number}}
 */
export function chooseAutoColorCount(field, palette, { chromaScale = 1 } = {}) {
  const { r, g, b, data } = field;

  // Mirrors quantizeColors()'s own eligibility rule (FIELD_ON_THRESHOLD on `data`) exactly, so "no
  // subject pixels" is detected the same way quantizeColors() itself would report colorGroups:[].
  const eligible = new Uint8Array(data.length);
  for (let i = 0; i < data.length; i++) eligible[i] = data[i] >= FIELD_ON_THRESHOLD ? 1 : 0;
  const { keptIds, eligibleCount } = labelCatalogColors({ r, g, b, eligible, palette, maxColors: AUTO_MAX_K, chromaScale });
  if (eligibleCount === 0) {
    return { resolvedCount: 1 };
  }
  return { resolvedCount: Math.max(2, keptIds.length) };
}
