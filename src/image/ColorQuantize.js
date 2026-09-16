/**
 * Color quantizer (IMG-002).
 *
 * Pure, palette-agnostic: reduces a resized R/G/B/data field (already alpha-composited onto white
 * and resized to the working resolution by ImageFieldPipeline.js, mirroring how it already prepares
 * data/luminance/alpha) to a small set of representative colors via median cut over a 5-bit-per-
 * channel RGB histogram, followed by 8 fixed weighted k-means passes over the histogram's populated
 * bins. Only pixels whose `data` value is at/above FIELD_ON_THRESHOLD are eligible; every other pixel
 * is NO_LABEL. Never imports src/geometry/** or src/renderer/** -- the catalog palette a cluster
 * resolves against arrives as plain [{id, hex}] data (see docs/specifications/IMG-002-ColorLayers.md
 * decision 2), the same "peer input-processing module" boundary ImageFieldPipeline.js already keeps.
 *
 * Determinism: every tie encountered anywhere in this pipeline (which box to split, which channel to
 * split on, where the weighted median falls, which unclaimed palette entry a cluster nearest-matches)
 * is broken by a fixed, explicit rule rather than left to incidental Map/array iteration order, so
 * identical (r, g, b, data, palette, colorCount) always produce a deepEqual result.
 */

// Density field "on" threshold -- src/image/** does not import src/geometry/**, so this is a
// deliberate, kept-in-sync-by-test copy of StoneSampler.js's own FIELD_ON_THRESHOLD (value 128).
// See tools/test-img-002-color-layers.mjs's "FIELD_ON_THRESHOLD parity" case.
export const FIELD_ON_THRESHOLD = 128;

// A pixel with no cluster label: either its `data` value was below FIELD_ON_THRESHOLD, or (only
// possible if the caller mis-shapes its input) it fell outside every histogram bin.
export const NO_LABEL = 255;

const CHANNEL_KEYS = ['r5', 'g5', 'b5'];

// ---- sRGB -> CIE Lab (D65), for CIE76 nearest-palette-entry distance ----------------------------

function srgbToLinear(c) {
  const v = c / 255;
  return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
}

const D65_WHITE = [0.95047, 1.0, 1.08883];

function labF(t) {
  const delta = 6 / 29;
  return t > delta * delta * delta ? Math.cbrt(t) : t / (3 * delta * delta) + 4 / 29;
}

function rgbToLab(r, g, b) {
  const rl = srgbToLinear(r);
  const gl = srgbToLinear(g);
  const bl = srgbToLinear(b);
  const x = rl * 0.4124564 + gl * 0.3575761 + bl * 0.1804375;
  const y = rl * 0.2126729 + gl * 0.7151522 + bl * 0.0721750;
  const z = rl * 0.0193339 + gl * 0.1191920 + bl * 0.9503041;
  const fx = labF(x / D65_WHITE[0]);
  const fy = labF(y / D65_WHITE[1]);
  const fz = labF(z / D65_WHITE[2]);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

// CIE76: plain Euclidean distance in Lab space.
function cie76Distance(labA, labB) {
  return Math.hypot(labA[0] - labB[0], labA[1] - labB[1], labA[2] - labB[2]);
}

function parseHexColor(hex) {
  const h = String(hex).replace('#', '');
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

// ---- Histogram -----------------------------------------------------------------------------------

// 5 bits per channel (0-31): value >> 3. A bin's own "index" (its position in the flattened 32x32x32
// space) is the tie-break key used throughout this module.
function binIndexOf(r5, g5, b5) {
  return (r5 << 10) | (g5 << 5) | b5;
}

function buildHistogram(r, g, b, data) {
  const bins = new Map();
  for (let i = 0; i < data.length; i++) {
    if (data[i] < FIELD_ON_THRESHOLD) continue;
    const r5 = r[i] >> 3;
    const g5 = g[i] >> 3;
    const b5 = b[i] >> 3;
    const index = binIndexOf(r5, g5, b5);
    let bin = bins.get(index);
    if (!bin) {
      bin = { index, r5, g5, b5, count: 0, sumR: 0, sumG: 0, sumB: 0 };
      bins.set(index, bin);
    }
    bin.count++;
    bin.sumR += r[i];
    bin.sumG += g[i];
    bin.sumB += b[i];
  }
  // Sorted by bin index ascending -- the canonical order every later step's tie-breaking assumes,
  // independent of Map insertion order.
  return [...bins.values()].sort((a, z) => a.index - z.index);
}

// ---- Median cut -----------------------------------------------------------------------------------

function boxWeight(box) {
  let weight = 0;
  for (const bin of box) weight += bin.count;
  return weight;
}

function boxMinIndex(box) {
  let min = Infinity;
  for (const bin of box) if (bin.index < min) min = bin.index;
  return min;
}

// Splits the box with the greatest total pixel weight (ties broken by the box's own smallest bin
// index) along whichever of R/G/B has the greatest range within it (ties broken by channel order
// R, G, B), at the weighted median (ties among equal-channel-value bins broken by bin index).
function splitOnce(boxes) {
  let targetIdx = -1;
  let targetWeight = -1;
  let targetMinIndex = Infinity;
  for (let i = 0; i < boxes.length; i++) {
    const box = boxes[i];
    if (box.length <= 1) continue;
    const weight = boxWeight(box);
    const minIndex = boxMinIndex(box);
    if (weight > targetWeight || (weight === targetWeight && minIndex < targetMinIndex)) {
      targetIdx = i;
      targetWeight = weight;
      targetMinIndex = minIndex;
    }
  }
  if (targetIdx === -1) return null;

  const box = boxes[targetIdx];
  let bestChannel = CHANNEL_KEYS[0];
  let bestRange = -1;
  for (const channel of CHANNEL_KEYS) {
    let min = Infinity;
    let max = -Infinity;
    for (const bin of box) {
      if (bin[channel] < min) min = bin[channel];
      if (bin[channel] > max) max = bin[channel];
    }
    const range = max - min;
    if (range > bestRange) {
      bestRange = range;
      bestChannel = channel;
    }
  }

  const sorted = box.slice().sort((a, z) => (a[bestChannel] - z[bestChannel]) || (a.index - z.index));
  const totalWeight = boxWeight(sorted);
  let cumulative = 0;
  let splitAt = 1;
  for (let i = 0; i < sorted.length; i++) {
    cumulative += sorted[i].count;
    if (cumulative >= Math.ceil(totalWeight / 2)) {
      splitAt = i + 1;
      break;
    }
  }
  splitAt = Math.min(Math.max(splitAt, 1), sorted.length - 1);

  const boxes2 = boxes.slice();
  boxes2.splice(targetIdx, 1, sorted.slice(0, splitAt), sorted.slice(splitAt));
  return boxes2;
}

function medianCutBoxes(bins, colorCount) {
  let boxes = [bins.slice()];
  while (boxes.length < colorCount) {
    const next = splitOnce(boxes);
    if (!next) break;
    boxes = next;
  }
  return boxes;
}

function boxCentroid(box) {
  let sumR = 0, sumG = 0, sumB = 0, count = 0;
  for (const bin of box) {
    sumR += bin.sumR; sumG += bin.sumG; sumB += bin.sumB; count += bin.count;
  }
  return { r: sumR / count, g: sumG / count, b: sumB / count };
}

// ---- Weighted k-means over histogram bins (8 fixed passes) ---------------------------------------

function runKMeans(bins, initialCentroids) {
  let centroids = initialCentroids.map((c) => ({ ...c }));
  let assignment = new Map();

  for (let pass = 0; pass < 8; pass++) {
    const nextAssignment = new Map();
    for (const bin of bins) {
      const meanR = bin.sumR / bin.count;
      const meanG = bin.sumG / bin.count;
      const meanB = bin.sumB / bin.count;
      let bestCluster = 0;
      let bestDist = Infinity;
      for (let c = 0; c < centroids.length; c++) {
        const cen = centroids[c];
        const dr = meanR - cen.r, dg = meanG - cen.g, db = meanB - cen.b;
        const dist = dr * dr + dg * dg + db * db;
        if (dist < bestDist) {
          bestDist = dist;
          bestCluster = c;
        }
      }
      nextAssignment.set(bin.index, bestCluster);
    }
    assignment = nextAssignment;

    const sums = centroids.map(() => ({ sumR: 0, sumG: 0, sumB: 0, count: 0 }));
    for (const bin of bins) {
      const c = assignment.get(bin.index);
      sums[c].sumR += bin.sumR; sums[c].sumG += bin.sumG; sums[c].sumB += bin.sumB; sums[c].count += bin.count;
    }
    centroids = centroids.map((old, c) => (
      sums[c].count > 0
        ? { r: sums[c].sumR / sums[c].count, g: sums[c].sumG / sums[c].count, b: sums[c].sumB / sums[c].count }
        : old
    ));
  }

  return { centroids, assignment };
}

// ---- nearestId: greedy descending-pixelShare claim over the supplied catalog palette -------------

function assignNearestIds(groups, palette) {
  const paletteLab = palette.map((entry) => rgbToLab(...parseHexColor(entry.hex)));
  const order = groups
    .map((group, index) => ({ index, pixelShare: group.pixelShare }))
    .sort((a, z) => (z.pixelShare - a.pixelShare) || (a.index - z.index));

  const claimed = new Set();
  for (const { index } of order) {
    const groupLab = rgbToLab(...groups[index].rgb);
    let bestEntry = -1;
    let bestDist = Infinity;
    for (let p = 0; p < palette.length; p++) {
      if (claimed.has(p)) continue;
      const dist = cie76Distance(groupLab, paletteLab[p]);
      if (dist < bestDist) {
        bestDist = dist;
        bestEntry = p;
      }
    }
    // Defensive only: real callers always supply a palette larger than colorCount's 1..8 range, so
    // every cluster finds an unclaimed entry. Falls back to the closest entry regardless of claim
    // rather than throwing if the palette is ever smaller than the cluster count.
    if (bestEntry === -1) {
      for (let p = 0; p < palette.length; p++) {
        const dist = cie76Distance(groupLab, paletteLab[p]);
        if (dist < bestDist) { bestDist = dist; bestEntry = p; }
      }
    }
    claimed.add(bestEntry);
    groups[index].nearestId = palette[bestEntry].id;
  }
  return groups;
}

/**
 * @param {object} args
 * @param {Uint8ClampedArray} args.r Red channel, alpha-onto-white, resized to the working resolution.
 * @param {Uint8ClampedArray} args.g Green channel, same shape as `r`.
 * @param {Uint8ClampedArray} args.b Blue channel, same shape as `r`.
 * @param {Uint8ClampedArray} args.data Density field, same shape as `r` (ImageFieldPipeline.js's own
 *   post-threshold/blur/resize `data`) -- only pixels >= FIELD_ON_THRESHOLD are eligible.
 * @param {number} args.colorCount Integer >= 1. The upper bound on clusters; fewer than `colorCount`
 *   clusters can result when the eligible pixels contain fewer distinct 5-bit-per-channel colors.
 * @param {{id: string, hex: string}[]} args.palette Catalog entries each cluster's `nearestId`
 *   resolves against.
 * @returns {{labels: Uint8ClampedArray, colorGroups: {rgb: number[], pixelShare: number, nearestId: string}[]}}
 */
export function quantizeColors({ r, g, b, data, colorCount, palette }) {
  const labels = new Uint8ClampedArray(data.length).fill(NO_LABEL);
  const bins = buildHistogram(r, g, b, data);

  if (bins.length === 0) {
    return { labels, colorGroups: [] };
  }

  const boxes = medianCutBoxes(bins, colorCount);
  const initialCentroids = boxes.map(boxCentroid);
  const { assignment } = runKMeans(bins, initialCentroids);

  const clusterStats = initialCentroids.map(() => ({ sumR: 0, sumG: 0, sumB: 0, count: 0 }));
  for (const bin of bins) {
    const c = assignment.get(bin.index);
    clusterStats[c].sumR += bin.sumR; clusterStats[c].sumG += bin.sumG; clusterStats[c].sumB += bin.sumB;
    clusterStats[c].count += bin.count;
  }

  const totalEligible = clusterStats.reduce((sum, s) => sum + s.count, 0);
  const remap = new Map(); // old cluster index -> final (non-empty-compacted) cluster index
  const colorGroups = [];
  for (let c = 0; c < clusterStats.length; c++) {
    if (clusterStats[c].count === 0) continue;
    remap.set(c, colorGroups.length);
    colorGroups.push({
      rgb: [
        Math.round(clusterStats[c].sumR / clusterStats[c].count),
        Math.round(clusterStats[c].sumG / clusterStats[c].count),
        Math.round(clusterStats[c].sumB / clusterStats[c].count)
      ],
      pixelShare: clusterStats[c].count / totalEligible,
      nearestId: null
    });
  }

  const binToFinalCluster = new Map();
  for (const bin of bins) {
    binToFinalCluster.set(bin.index, remap.get(assignment.get(bin.index)));
  }

  for (let i = 0; i < data.length; i++) {
    if (data[i] < FIELD_ON_THRESHOLD) continue;
    const r5 = r[i] >> 3, g5 = g[i] >> 3, b5 = b[i] >> 3;
    labels[i] = binToFinalCluster.get(binIndexOf(r5, g5, b5));
  }

  assignNearestIds(colorGroups, palette);

  return { labels, colorGroups };
}
