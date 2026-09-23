/**
 * Color quantizer (IMG-002, rewritten by IMG-015).
 *
 * Pure, palette-agnostic: labels every eligible pixel of a resized R/G/B/data field (already
 * alpha-composited onto white and resized to the working resolution by ImageFieldPipeline.js,
 * mirroring how it already prepares data/luminance/alpha) with its CIE76-nearest catalog entry,
 * drops every entry under a 1.2% share of eligible pixels, keeps at most `colorCount` of the rest,
 * and relabels every pixel of a dropped entry to its nearest kept entry -- one colour group per kept
 * catalog colour. Only pixels whose `data` value is at/above FIELD_ON_THRESHOLD are eligible; every
 * other pixel is NO_LABEL. Never imports src/geometry/** or src/renderer/** -- the catalog palette
 * arrives as plain [{id, hex}] data (see docs/specifications/IMG-002-ColorLayers.md decision 2), the
 * same "peer input-processing module" boundary ImageFieldPipeline.js already keeps. See
 * docs/specifications/IMG-015-DirectCatalogueColour.md.
 *
 * Determinism: every tie (nearest entry, which entries the cap keeps, which kept entry a dropped
 * pixel relabels to) is broken by palette order, so identical (r, g, b, data, palette, colorCount)
 * always produce a deepEqual result.
 */

// IMG-009: rgbToLab()/cie76Distance() moved to ColorSpace.js (a pure move, byte-identical), since
// SubjectMask.js needs the same conversion for its own background-distance test.
import { rgbToLab, cie76Distance } from './ColorSpace.js';

// Density field "on" threshold -- src/image/** does not import src/geometry/**, so this is a
// deliberate, kept-in-sync-by-test copy of StoneSampler.js's own FIELD_ON_THRESHOLD (value 128).
// See tools/test-img-002-color-layers.mjs's "FIELD_ON_THRESHOLD parity" case.
export const FIELD_ON_THRESHOLD = 128;

// A pixel with no colour label: its `data` value was below FIELD_ON_THRESHOLD.
export const NO_LABEL = 255;

function hexToRgb(hex) {
  const h = String(hex).replace('#', '');
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

// IMG-015 decision 1: colours under this share of the eligible pixels are dropped and relabelled to
// their nearest kept catalog colour (IMG-010's decision (b) floor, moved here with the labeller;
// LineDesignSampler.js's LINE_DESIGN_MIN_COLOR_SHARE aliases it).
export const MIN_CATALOG_COLOR_SHARE = 0.012;

/**
 * Direct per-pixel CIE76 catalog labelling with a share floor and an optional colour cap (IMG-015
 * decision 1) -- moved unchanged in arithmetic out of LineDesignSampler.js's buildLabelField(), the
 * single colour rule every image fill mode now uses.
 *
 * 1. Every eligible pixel takes its nearest palette entry (ties to the first in palette order).
 * 2. Entries whose raw share of eligible pixels is under `minShare` are dropped; if none clears it,
 *    every observed entry is kept instead.
 * 3. At most `maxColors` of those are kept, by descending raw share, ties broken by palette order.
 * 4. Every pixel of a dropped entry is relabelled to its nearest kept entry (ties to the first in
 *    palette order).
 *
 * @param {object} args
 * @param {ArrayLike<number>} args.r Red channel, one byte per pixel.
 * @param {ArrayLike<number>} args.g Green channel, same shape as `r`.
 * @param {ArrayLike<number>} args.b Blue channel, same shape as `r`.
 * @param {ArrayLike<number>} args.eligible Per-pixel eligibility, truthy where the pixel is labelled.
 * @param {{id: string, hex: string}[]} args.palette Catalog entries.
 * @param {number[][]} [args.catalogLabs] The palette's own Lab values, when the caller already has
 *   them; computed from `palette` otherwise.
 * @param {number} [args.minShare] Default MIN_CATALOG_COLOR_SHARE.
 * @param {number} [args.maxColors] Default Infinity (no cap).
 * @param {number} [args.chromaScale] IMG-017: multiplies each pixel's Lab a* and b* before matching
 *   (L* untouched, hue preserved). Default 1, where the multiply is skipped entirely so the arithmetic
 *   is exactly the pre-IMG-017 one.
 * @returns {{labels: Uint8Array, keptIds: number[], rawCounts: number[], finalCounts: number[], eligibleCount: number}}
 *   `labels` holds palette indices, 255 where ineligible; `keptIds` holds palette indices in palette
 *   order.
 */
export function labelCatalogColors({ r, g, b, eligible, palette, catalogLabs = palette.map((entry) => rgbToLab(...hexToRgb(entry.hex))), minShare = MIN_CATALOG_COLOR_SHARE, maxColors = Infinity, chromaScale = 1 }) {
  const pixelCount = eligible.length;
  const rawLabel = new Uint8Array(pixelCount).fill(255);
  const labL = new Float64Array(pixelCount);
  const labA = new Float64Array(pixelCount);
  const labB = new Float64Array(pixelCount);
  const rawCounts = new Array(catalogLabs.length).fill(0);
  let eligibleCount = 0;

  for (let i = 0; i < pixelCount; i++) {
    if (!eligible[i]) continue;
    eligibleCount++;
    const lab = rgbToLab(r[i], g[i], b[i]);
    if (chromaScale !== 1) { lab[1] *= chromaScale; lab[2] *= chromaScale; }
    labL[i] = lab[0]; labA[i] = lab[1]; labB[i] = lab[2];
    let best = 0, bestD = Infinity;
    for (let c = 0; c < catalogLabs.length; c++) {
      const d = cie76Distance(lab, catalogLabs[c]);
      if (d < bestD) { bestD = d; best = c; }
    }
    rawLabel[i] = best;
    rawCounts[best]++;
  }

  let keptIds = [];
  for (let c = 0; c < rawCounts.length; c++) {
    if (eligibleCount > 0 && rawCounts[c] / eligibleCount >= minShare) keptIds.push(c);
  }
  if (keptIds.length === 0) {
    // Degenerate fixture (no colour clears the floor, or no eligible pixel) -- fall back to every
    // observed label rather than producing an unlabellable field.
    keptIds = rawCounts.map((count, c) => (count > 0 ? c : -1)).filter((c) => c >= 0);
  }
  if (keptIds.length > maxColors) {
    keptIds = keptIds
      .slice()
      .sort((a, z) => (rawCounts[z] - rawCounts[a]) || (a - z))
      .slice(0, maxColors)
      .sort((a, z) => a - z);
  }
  const keptSet = new Set(keptIds);

  const labels = new Uint8Array(pixelCount).fill(255);
  const finalCounts = new Array(catalogLabs.length).fill(0);
  for (let i = 0; i < pixelCount; i++) {
    if (!eligible[i]) continue;
    const raw = rawLabel[i];
    if (keptSet.has(raw)) { labels[i] = raw; finalCounts[raw]++; continue; }
    const lab = [labL[i], labA[i], labB[i]];
    let best = keptIds[0], bestD = Infinity;
    for (const c of keptIds) {
      const d = cie76Distance(lab, catalogLabs[c]);
      if (d < bestD) { bestD = d; best = c; }
    }
    labels[i] = best;
    finalCounts[best]++;
  }

  return { labels, keptIds, rawCounts, finalCounts, eligibleCount };
}

/**
 * IMG-015 decision 2: one colour group per kept catalog colour, in palette order. Each group's `rgb`
 * is the rounded mean of the pixels finally labelled with it, `pixelShare` its final share of
 * eligible pixels and `nearestId` its catalog id -- unique across groups by construction.
 *
 * @param {object} args
 * @param {Uint8ClampedArray} args.r Red channel, alpha-onto-white, resized to the working resolution.
 * @param {Uint8ClampedArray} args.g Green channel, same shape as `r`.
 * @param {Uint8ClampedArray} args.b Blue channel, same shape as `r`.
 * @param {Uint8ClampedArray} args.data Density field, same shape as `r` (ImageFieldPipeline.js's own
 *   post-threshold/blur/resize `data`) -- only pixels >= FIELD_ON_THRESHOLD are eligible.
 * @param {number} args.colorCount Integer >= 1. The upper bound on groups; fewer than `colorCount`
 *   groups result when fewer catalog colours clear the share floor.
 * @param {{id: string, hex: string}[]} args.palette Catalog entries each pixel is labelled against.
 * @param {number} [args.chromaScale] IMG-017 vividness, forwarded to labelCatalogColors(). Default 1.
 *   Group `rgb` means stay the real (unscaled) pixel means.
 * @returns {{labels: Uint8ClampedArray, colorGroups: {rgb: number[], pixelShare: number, nearestId: string}[]}}
 */
export function quantizeColors({ r, g, b, data, colorCount, palette, chromaScale = 1 }) {
  const labels = new Uint8ClampedArray(data.length).fill(NO_LABEL);
  const eligible = new Uint8Array(data.length);
  for (let i = 0; i < data.length; i++) eligible[i] = data[i] >= FIELD_ON_THRESHOLD ? 1 : 0;

  const { labels: catalogLabels, keptIds, finalCounts, eligibleCount } = labelCatalogColors({
    r, g, b, eligible, palette, maxColors: colorCount, chromaScale
  });
  if (eligibleCount === 0) {
    return { labels, colorGroups: [] };
  }

  const groupIndexOf = new Map(keptIds.map((c, index) => [c, index]));
  const sums = keptIds.map(() => ({ sumR: 0, sumG: 0, sumB: 0 }));
  for (let i = 0; i < data.length; i++) {
    if (!eligible[i]) continue;
    const group = groupIndexOf.get(catalogLabels[i]);
    labels[i] = group;
    sums[group].sumR += r[i]; sums[group].sumG += g[i]; sums[group].sumB += b[i];
  }

  const colorGroups = keptIds.map((c, index) => {
    const count = finalCounts[c];
    return {
      rgb: [Math.round(sums[index].sumR / count), Math.round(sums[index].sumG / count), Math.round(sums[index].sumB / count)],
      pixelShare: count / eligibleCount,
      nearestId: palette[c].id
    };
  });

  return { labels, colorGroups };
}
