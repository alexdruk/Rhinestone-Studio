/**
 * Subject-mask stage of the Image Trace pipeline (IMG-009).
 *
 * applyThreshold() (Threshold.js) answers "is this pixel dark?" -- correct for a logo or black text
 * on white, wrong for a photographed subject that spans luminances both above and below any single
 * cutoff. computeSubjectMask() answers "is this pixel part of the subject?" instead, via two routes
 * chosen by the image itself -- see docs/specifications/IMG-009-SubjectMask.md decision 1.
 *
 * Alpha route: when the image already carries real transparency (more than
 * SUBJECT_ALPHA_PRESENCE_FRACTION of pixels below Alpha.js's ALPHA_COVERAGE_THRESHOLD), the alpha
 * channel already is the silhouette and drives the mask directly.
 *
 * Background route: otherwise, the border ring (row 0, row h-1, column 0, column w-1) is averaged to
 * a background color, and a pixel is subject when its CIE76 distance from it exceeds `toleranceDe`.
 * The result is reduced to its largest 4-connected component, dropping speckle while leaving holes as
 * holes (an enclosed background-colored region was never "on" to begin with).
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

// Averages the raw RGB of the border ring (each pixel counted once, corners included via the top/
// bottom rows only) -- no alpha compositing, since the background route is only reached when at most
// SUBJECT_ALPHA_PRESENCE_FRACTION of the image is transparent.
function averageBorderRgb(imageBuffer) {
  const { widthPx, heightPx, data } = imageBuffer;
  let sumR = 0, sumG = 0, sumB = 0, count = 0;
  const addPixel = (x, y) => {
    const i = (y * widthPx + x) * 4;
    sumR += data[i]; sumG += data[i + 1]; sumB += data[i + 2];
    count++;
  };
  for (let x = 0; x < widthPx; x++) {
    addPixel(x, 0);
    addPixel(x, heightPx - 1);
  }
  for (let y = 1; y < heightPx - 1; y++) {
    addPixel(0, y);
    addPixel(widthPx - 1, y);
  }
  return [Math.round(sumR / count), Math.round(sumG / count), Math.round(sumB / count)];
}

// Reduces a 0/1 mask to its largest 4-connected component via BFS flood fill. Ties (equal-size
// components) resolve to whichever is found first in row-major scan order -- deterministic, though
// no documented behavior depends on which of two equal-size components wins.
function largestConnectedComponent(maskData, widthPx, heightPx) {
  const pixelCount = widthPx * heightPx;
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

  if (sizes.length === 0) return maskData;

  let bestLabel = 0, bestSize = sizes[0];
  for (let i = 1; i < sizes.length; i++) {
    if (sizes[i] > bestSize) { bestSize = sizes[i]; bestLabel = i; }
  }

  const out = new Uint8ClampedArray(pixelCount);
  for (let i = 0; i < pixelCount; i++) out[i] = labels[i] === bestLabel ? 1 : 0;
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

  const backgroundRgb = averageBorderRgb(imageBuffer);
  const backgroundLab = rgbToLab(backgroundRgb[0], backgroundRgb[1], backgroundRgb[2]);
  const rawMask = new Uint8ClampedArray(pixelCount);
  for (let i = 0; i < pixelCount; i++) {
    const o = i * 4;
    const lab = rgbToLab(data[o], data[o + 1], data[o + 2]);
    rawMask[i] = cie76Distance(lab, backgroundLab) > toleranceDe ? 1 : 0;
  }
  const reduced = largestConnectedComponent(rawMask, widthPx, heightPx);
  return { mask: createField({ widthPx, heightPx, data: reduced }), route: 'background', backgroundRgb };
}
