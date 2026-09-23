/**
 * Subject-mask stage of the Image Trace pipeline (IMG-009, background route replaced by IMG-014).
 *
 * applyThreshold() (Threshold.js) answers "is this pixel dark?" -- correct for a logo or black text
 * on white, wrong for a photographed subject that spans luminances both above and below any single
 * cutoff. computeSubjectMask() answers "is this pixel part of the subject?" instead, via two routes
 * chosen by the image itself -- see docs/specifications/IMG-009-SubjectMask.md decision 1.
 *
 * Alpha route: when the image already carries real transparency (more than
 * SUBJECT_ALPHA_PRESENCE_FRACTION of pixels below Alpha.js's ALPHA_COVERAGE_THRESHOLD), the alpha
 * channel already is the silhouette and drives the mask directly. Unchanged by IMG-014.
 *
 * Background route (IMG-014, see docs/specifications/IMG-014-SubjectMaskPhotographic.md): the
 * background colour is the modal border colour, not the mean -- every 7th pixel of the border ring
 * (row 0, row h-1, column 0, column w-1) votes for how many border pixels overall fall within
 * BACKGROUND_CLUSTER_DE of it, the highest-count pixel wins, and backgroundLab/backgroundRgb are the
 * mean Lab / mean sRGB of that winning cluster. A pixel is background-eligible when its ΔE from
 * backgroundLab is at most `toleranceDe`; background itself is the 4-connected flood fill from every
 * border run of eligible pixels at least 5% of its own side's length (a run never wraps a corner),
 * run once over the whole image. Subject is everything the flood fill does not reach -- including
 * enclosed background-coloured regions, which are no longer treated as holes (this reverses IMG-009
 * decision 1: an enclosed background-coloured region is subject, not a hole, since decision 2 above
 * never reaches it). 4-connected subject components below 0.05% of the image's pixel count are then
 * pruned as noise, regardless of rank.
 *
 * The returned mask is the exact 0/1 native-resolution shape applyThreshold() returns -- it replaces
 * that single call in ImageFieldPipeline.js's prepareImageField() (decision 2), and everything after
 * that call site (invert, transparent policy, blur, resize) depends on that same 0/1 convention
 * (invertMask() flips 0<->1; blurMask()'s radius-0 path rescales 0/1 -> 0/255, and its box-blur path
 * scales a 0/1 average by 255 -- either would silently corrupt a 0/255 input).
 */

import { extractAlphaChannel, ALPHA_COVERAGE_THRESHOLD } from './Alpha.js';
import { createField } from './ImageBuffer.js';
import { rgbToLab, cie76Distance } from './ColorSpace.js';

export const DEFAULT_SUBJECT_TOLERANCE_DE = 12;
export const SUBJECT_ALPHA_PRESENCE_FRACTION = 0.01;

// IMG-014 decision 1: fixed, non-exported ΔE used only to cluster border pixels into a modal colour
// vote -- unrelated to toleranceDe/DEFAULT_SUBJECT_TOLERANCE_DE, which keeps its existing role
// (decision 2's background-eligibility test).
const BACKGROUND_CLUSTER_DE = 8;

// IMG-014 decision 2: a background-eligible border run must cover at least this fraction of its own
// side's length to seed the flood fill.
const BORDER_SEED_RUN_LENGTH_FRACTION = 0.05;

// IMG-014 decision 4: 4-connected subject components smaller than this fraction of the image's total
// pixel count are pruned as noise, regardless of rank.
const SMALL_COMPONENT_FLOOR_FRACTION = 0.0005;

// Border ring pixel indices in the same enumeration order the pre-IMG-014 averageBorderRgb() walked
// (row 0, row h-1 for each column, then column 0, column w-1 for each interior row -- each pixel
// counted once, corners included via the top/bottom rows only).
function borderRingIndices(widthPx, heightPx) {
  const indices = [];
  for (let x = 0; x < widthPx; x++) {
    indices.push(x);
    indices.push((heightPx - 1) * widthPx + x);
  }
  for (let y = 1; y < heightPx - 1; y++) {
    indices.push(y * widthPx);
    indices.push(y * widthPx + (widthPx - 1));
  }
  return indices;
}

// IMG-014 decision 1: the modal border colour. Every 7th border pixel (in ring enumeration order) is
// a candidate; its vote is how many border pixels overall fall within BACKGROUND_CLUSTER_DE of it.
// The highest-count candidate wins (ties keep the first-found, mirroring largestConnectedComponent()'s
// own pre-existing tie convention). backgroundLab is the mean Lab, backgroundRgb the mean sRGB
// (decision 6), of every border pixel within BACKGROUND_CLUSTER_DE of the winner.
function computeModalBackgroundColor(data, pixelLab, borderIndices) {
  const borderCount = borderIndices.length;
  const borderLab = new Float64Array(borderCount * 3);
  for (let k = 0; k < borderCount; k++) {
    const i = borderIndices[k];
    borderLab[k * 3] = pixelLab[i * 3];
    borderLab[k * 3 + 1] = pixelLab[i * 3 + 1];
    borderLab[k * 3 + 2] = pixelLab[i * 3 + 2];
  }

  let bestWinner = 0, bestCount = -1;
  for (let k = 0; k < borderCount; k += 7) {
    const candidate = [borderLab[k * 3], borderLab[k * 3 + 1], borderLab[k * 3 + 2]];
    let count = 0;
    for (let j = 0; j < borderCount; j++) {
      const other = [borderLab[j * 3], borderLab[j * 3 + 1], borderLab[j * 3 + 2]];
      if (cie76Distance(candidate, other) <= BACKGROUND_CLUSTER_DE) count++;
    }
    if (count > bestCount) { bestCount = count; bestWinner = k; }
  }

  const winnerLab = [borderLab[bestWinner * 3], borderLab[bestWinner * 3 + 1], borderLab[bestWinner * 3 + 2]];
  let sumL = 0, sumA = 0, sumBv = 0, sumR = 0, sumG = 0, sumB = 0, clusterCount = 0;
  for (let j = 0; j < borderCount; j++) {
    const other = [borderLab[j * 3], borderLab[j * 3 + 1], borderLab[j * 3 + 2]];
    if (cie76Distance(winnerLab, other) <= BACKGROUND_CLUSTER_DE) {
      sumL += other[0]; sumA += other[1]; sumBv += other[2];
      const o = borderIndices[j] * 4;
      sumR += data[o]; sumG += data[o + 1]; sumB += data[o + 2];
      clusterCount++;
    }
  }
  return {
    backgroundLab: [sumL / clusterCount, sumA / clusterCount, sumBv / clusterCount],
    backgroundRgb: [Math.round(sumR / clusterCount), Math.round(sumG / clusterCount), Math.round(sumB / clusterCount)]
  };
}

// IMG-014 decision 2 (seed half): border-ring pixels that are background-eligible and belong to a
// consecutive run, along one side only (a run never wraps a corner from one side to another), of
// length at least BORDER_SEED_RUN_LENGTH_FRACTION of that side's own length. Returns pixel indices.
function collectBorderSeeds(eligible, widthPx, heightPx) {
  const seeds = [];
  const scanSide = (length, indexAt) => {
    const threshold = BORDER_SEED_RUN_LENGTH_FRACTION * length;
    let runStart = -1;
    for (let k = 0; k <= length; k++) {
      const isEligible = k < length && eligible[indexAt(k)] === 1;
      if (isEligible) {
        if (runStart === -1) runStart = k;
      } else if (runStart !== -1) {
        if (k - runStart >= threshold) {
          for (let j = runStart; j < k; j++) seeds.push(indexAt(j));
        }
        runStart = -1;
      }
    }
  };
  scanSide(widthPx, (x) => x); // top row, y = 0
  scanSide(widthPx, (x) => (heightPx - 1) * widthPx + x); // bottom row
  scanSide(heightPx, (y) => y * widthPx); // left column, x = 0
  scanSide(heightPx, (y) => y * widthPx + (widthPx - 1)); // right column
  return seeds;
}

// IMG-014 decision 2 (flood half): the 4-connected flood fill from every seed, through
// background-eligible pixels, run once over the whole image. Returns a 0/1 background mask.
function floodFillBackground(eligible, widthPx, heightPx, seeds) {
  const pixelCount = widthPx * heightPx;
  const background = new Uint8Array(pixelCount);
  const queue = new Int32Array(pixelCount);
  let tail = 0;
  for (const s of seeds) {
    if (eligible[s] === 1 && background[s] === 0) { background[s] = 1; queue[tail++] = s; }
  }
  let head = 0;
  while (head < tail) {
    const idx = queue[head++];
    const x = idx % widthPx;
    const y = (idx - x) / widthPx;
    if (x > 0) { const n = idx - 1; if (eligible[n] === 1 && background[n] === 0) { background[n] = 1; queue[tail++] = n; } }
    if (x < widthPx - 1) { const n = idx + 1; if (eligible[n] === 1 && background[n] === 0) { background[n] = 1; queue[tail++] = n; } }
    if (y > 0) { const n = idx - widthPx; if (eligible[n] === 1 && background[n] === 0) { background[n] = 1; queue[tail++] = n; } }
    if (y < heightPx - 1) { const n = idx + widthPx; if (eligible[n] === 1 && background[n] === 0) { background[n] = 1; queue[tail++] = n; } }
  }
  return background;
}

// IMG-014 decision 4: 4-connected subject components below SMALL_COMPONENT_FLOOR_FRACTION of the
// image's pixel count are removed; every component at or above that floor survives, regardless of
// rank (replaces largestConnectedComponent()'s single-winner reduction).
function pruneSmallSubjectComponents(maskData, widthPx, heightPx) {
  const pixelCount = widthPx * heightPx;
  const floor = SMALL_COMPONENT_FLOOR_FRACTION * pixelCount;
  const labels = new Int32Array(pixelCount).fill(-1);
  const queue = new Int32Array(pixelCount);
  const sizes = [];
  let nextLabel = 0;

  for (let start = 0; start < pixelCount; start++) {
    if (maskData[start] === 0 || labels[start] !== -1) continue;
    let head = 0, tail = 0;
    queue[tail++] = start;
    labels[start] = nextLabel;
    let size = 0;
    while (head < tail) {
      const idx = queue[head++];
      size++;
      const x = idx % widthPx;
      const y = (idx - x) / widthPx;
      if (x > 0 && maskData[idx - 1] === 1 && labels[idx - 1] === -1) { labels[idx - 1] = nextLabel; queue[tail++] = idx - 1; }
      if (x < widthPx - 1 && maskData[idx + 1] === 1 && labels[idx + 1] === -1) { labels[idx + 1] = nextLabel; queue[tail++] = idx + 1; }
      if (y > 0 && maskData[idx - widthPx] === 1 && labels[idx - widthPx] === -1) { labels[idx - widthPx] = nextLabel; queue[tail++] = idx - widthPx; }
      if (y < heightPx - 1 && maskData[idx + widthPx] === 1 && labels[idx + widthPx] === -1) { labels[idx + widthPx] = nextLabel; queue[tail++] = idx + widthPx; }
    }
    sizes.push(size);
    nextLabel++;
  }

  const out = new Uint8ClampedArray(pixelCount);
  for (let i = 0; i < pixelCount; i++) {
    if (maskData[i] === 1 && sizes[labels[i]] >= floor) out[i] = 1;
  }
  return out;
}

/**
 * @param {{widthPx: number, heightPx: number, data: Uint8ClampedArray}} imageBuffer RGBA source.
 * @param {object} [options]
 * @param {number} [options.toleranceDe] CIE76 ΔE cutoff for the background route, default
 *   DEFAULT_SUBJECT_TOLERANCE_DE (12).
 * @returns {{mask: {widthPx: number, heightPx: number, data: Uint8ClampedArray}, route: 'alpha'|
 *   'background', backgroundRgb: number[]|null}}
 */
export function computeSubjectMask(imageBuffer, options = {}) {
  const toleranceDe = options.toleranceDe ?? DEFAULT_SUBJECT_TOLERANCE_DE;
  const { widthPx, heightPx, data } = imageBuffer;
  const pixelCount = widthPx * heightPx;

  const alphaField = extractAlphaChannel(imageBuffer);
  let transparentCount = 0;
  for (let i = 0; i < pixelCount; i++) {
    if (alphaField.data[i] < ALPHA_COVERAGE_THRESHOLD) transparentCount++;
  }
  const transparentFraction = transparentCount / pixelCount;

  if (transparentFraction > SUBJECT_ALPHA_PRESENCE_FRACTION) {
    const maskData = new Uint8ClampedArray(pixelCount);
    for (let i = 0; i < pixelCount; i++) {
      maskData[i] = alphaField.data[i] >= ALPHA_COVERAGE_THRESHOLD ? 1 : 0;
    }
    return { mask: createField({ widthPx, heightPx, data: maskData }), route: 'alpha', backgroundRgb: null };
  }

  // Each pixel's Lab computed once, reused by the eligibility test and the flood fill.
  const pixelLab = new Float64Array(pixelCount * 3);
  for (let i = 0; i < pixelCount; i++) {
    const o = i * 4;
    const lab = rgbToLab(data[o], data[o + 1], data[o + 2]);
    pixelLab[i * 3] = lab[0]; pixelLab[i * 3 + 1] = lab[1]; pixelLab[i * 3 + 2] = lab[2];
  }

  const borderIndices = borderRingIndices(widthPx, heightPx);
  const { backgroundLab, backgroundRgb } = computeModalBackgroundColor(data, pixelLab, borderIndices);

  const eligible = new Uint8Array(pixelCount);
  for (let i = 0; i < pixelCount; i++) {
    const lab = [pixelLab[i * 3], pixelLab[i * 3 + 1], pixelLab[i * 3 + 2]];
    eligible[i] = cie76Distance(lab, backgroundLab) <= toleranceDe ? 1 : 0;
  }

  const seeds = collectBorderSeeds(eligible, widthPx, heightPx);
  const background = floodFillBackground(eligible, widthPx, heightPx, seeds);

  const rawSubjectMask = new Uint8ClampedArray(pixelCount);
  for (let i = 0; i < pixelCount; i++) rawSubjectMask[i] = background[i] === 1 ? 0 : 1;

  const pruned = pruneSmallSubjectComponents(rawSubjectMask, widthPx, heightPx);
  return { mask: createField({ widthPx, heightPx, data: pruned }), route: 'background', backgroundRgb };
}
