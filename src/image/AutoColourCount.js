/**
 * Automatic best-fit colour count (IMG-012).
 *
 * Pure, palette-agnostic: sweeps k = 2..8 through the existing quantizeColors() (ColorQuantize.js)
 * over the same subject-pixel field prepareImageField()'s own colorCount>1 branch quantizes
 * against, scores each k by the mean CIE76 ΔE between every (subsampled) subject pixel's own
 * pre-quantization colour and the catalog colour its cluster resolved to, and picks a winner.
 * Never imports src/geometry/** or app.js -- the same "peer input-processing module" boundary every
 * other src/image/** file keeps. Deterministic: identical (field, palette) always produce a
 * deepEqual result, since quantizeColors() itself is already deterministic and this module's own
 * tie-break rule is a fixed, explicit comparison, not incidental iteration order.
 *
 * See docs/specifications/IMG-012-AutoColourCount.md, decision D1 (this repo's own override of the
 * spec's original "prefer the larger k" tie rule): among the k within 1% of the lowest mean ΔE,
 * the winner is the one whose quantization produced the most non-empty clusters (ties broken by the
 * smallest k) -- and the resolved colour count is that winner's own non-empty cluster count, which
 * can differ from its k when quantizeColors()'s non-empty-cluster compaction drops empty clusters.
 */

import { quantizeColors, FIELD_ON_THRESHOLD } from './ColorQuantize.js';
import { rgbToLab, cie76Distance } from './ColorSpace.js';
import { prepareImageField, compositeChannelOntoWhite } from './ImageFieldPipeline.js';
import { resizeField } from './Resize.js';

const AUTO_MIN_K = 2;
const AUTO_MAX_K = 8;
// Decision 2 (spec): "within 1%" -- exclusive upper bound is decision D1's own tie-boundary test
// (item 3): exactly 1.0% above the minimum is a candidate, 1.01% above is not.
const AUTO_TIE_TOLERANCE = 0.01;
// D4: "Scoring subsamples every 3rd subject pixel, as the spec decided; quantization runs on the
// full set." Only the mean-ΔE scoring loop below is subsampled -- quantizeColors() itself always
// receives every subject pixel, unchanged.
const SCORE_SUBSAMPLE_STRIDE = 3;

function parseHexColor(hex) {
  const h = String(hex).replace('#', '');
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

/**
 * Builds the mask-aware {r, g, b, data} field chooseAutoColorCount() sweeps, mirroring exactly what
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
 * @returns {{resolvedCount: number, winnerK: (number|null), scores: {k: number, meanDeltaE: number, clusters: number}[]}}
 */
export function chooseAutoColorCount(field, palette) {
  const { r, g, b, data } = field;

  // Mirrors quantizeColors()'s own eligibility rule (FIELD_ON_THRESHOLD on `data`) exactly, so "no
  // subject pixels" is detected the same way quantizeColors() itself would report colorGroups:[].
  const subjectIndices = [];
  for (let i = 0; i < data.length; i++) {
    if (data[i] >= FIELD_ON_THRESHOLD) subjectIndices.push(i);
  }
  if (subjectIndices.length === 0) {
    return { resolvedCount: 1, winnerK: null, scores: [] };
  }

  const strided = subjectIndices.filter((_, j) => j % SCORE_SUBSAMPLE_STRIDE === 0);
  const sampled = strided.length > 0 ? strided : subjectIndices;

  const paletteById = new Map(palette.map((entry) => [entry.id, entry]));
  const catalogLabById = new Map();
  const catalogLabFor = (id) => {
    let lab = catalogLabById.get(id);
    if (!lab) {
      lab = rgbToLab(...parseHexColor(paletteById.get(id).hex));
      catalogLabById.set(id, lab);
    }
    return lab;
  };

  const scores = [];
  for (let k = AUTO_MIN_K; k <= AUTO_MAX_K; k++) {
    const { labels, colorGroups } = quantizeColors({ r, g, b, data, colorCount: k, palette });
    let sumDeltaE = 0;
    for (const i of sampled) {
      const group = colorGroups[labels[i]];
      const pixelLab = rgbToLab(r[i], g[i], b[i]);
      sumDeltaE += cie76Distance(pixelLab, catalogLabFor(group.nearestId));
    }
    scores.push({ k, meanDeltaE: sumDeltaE / sampled.length, clusters: colorGroups.length });
  }

  const winner = pickAutoColorCountWinner(scores);
  return { resolvedCount: winner.clusters, winnerK: winner.k, scores };
}

/**
 * D1's own tie-break rule, factored out so it can be exercised directly against synthetic
 * {k, meanDeltaE, clusters} scores (not only ones quantizeColors() itself produced): let m be the
 * lowest meanDeltaE; candidates are every score with meanDeltaE <= m * 1.01 (inclusive -- exactly
 * 1.0% above m is a candidate, 1.01% above is not); the winner is the candidate with the most
 * non-empty clusters, ties broken by the smallest k.
 *
 * @param {{k: number, meanDeltaE: number, clusters: number}[]} scores Non-empty.
 * @returns {{k: number, meanDeltaE: number, clusters: number}}
 */
export function pickAutoColorCountWinner(scores) {
  const m = Math.min(...scores.map((s) => s.meanDeltaE));
  const candidates = scores.filter((s) => s.meanDeltaE <= m * (1 + AUTO_TIE_TOLERANCE));
  let winner = candidates[0];
  for (const c of candidates) {
    if (c.clusters > winner.clusters || (c.clusters === winner.clusters && c.k < winner.k)) {
      winner = c;
    }
  }
  return winner;
}
