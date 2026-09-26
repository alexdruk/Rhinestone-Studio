/**
 * IMG-023: place real stones from the stones an AI drew (src/image/AiStoneDetect.js's
 * detectAiStones()). Palette choice, grid points, per-point colour and the Jet rule, ported from
 * palette()/transfer() in docs/prototypes/ai_stone_transfer_reference.py with the same constants.
 * Pure: no DOM, no canvas. GeometryEngine.generateImageLayout() is the only caller that turns these
 * points into Stones -- see docs/specifications/IMG-023-AiStoneTransfer.md D1/D3/D4.
 */

import { rgbToLab } from '../image/ColorSpace.js';
import { createPointGrid } from '../image/AiStoneDetect.js';
import { sampleStaggeredFillPoints } from './StoneSampler.js';
import { Point2D, BoundingBox } from '../text/VectorPath.js';

export const AI_STONE_PALETTE_CAP = 8;
export const AI_STONE_LAB_WEIGHTS = Object.freeze([0.5, 1, 1]);
export const AI_STONE_KEEP_RATIO = 0.8;
export const AI_STONE_COLOR_NEIGHBOURS = 3;
export const AI_STONE_WEIGHT_OFFSET_MM = 0.3;
export const AI_STONE_JET_SHARE = 0.4;
export const AI_STONE_JET_ID = 'jet';
const ALPHA_THRESHOLD = 128;
const INITIAL_ERROR = 1e9;

function hexToRgb(hex) {
  const h = hex.replace('#', '');
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

export function catalogueLabs(palette) {
  return palette.map((entry) => rgbToLab(...hexToRgb(entry.hex)));
}

// Weighted Lab distance: L* x 0.5, a*, b* x 1.
export function weightedLabDistance(a, b) {
  const [wl, wa, wb] = AI_STONE_LAB_WEIGHTS;
  return Math.hypot((a[0] - b[0]) * wl, (a[1] - b[1]) * wa, (a[2] - b[2]) * wb);
}

/**
 * Greedy palette: up to `cap` catalogue colours minimising the summed weighted-Lab error over all
 * AI stones (not by frequency). Returns catalogue indices sorted ascending.
 */
export function chooseAiStonePalette(labs, catalogLabs, cap = AI_STONE_PALETTE_CAP) {
  const n = labs.length;
  const D = catalogLabs.map((c) => Float64Array.from(labs, (l) => weightedLabDistance(l, c)));
  const cur = new Float64Array(n).fill(INITIAL_ERROR);
  const keep = [];
  for (let round = 0; round < cap; round++) {
    let best = -1, bestGain = -Infinity;
    for (let k = 0; k < catalogLabs.length; k++) {
      let gain = -1;
      if (!keep.includes(k)) {
        gain = 0;
        const d = D[k];
        for (let i = 0; i < n; i++) gain += cur[i] - Math.min(cur[i], d[i]);
      }
      if (gain > bestGain) { bestGain = gain; best = k; }
    }
    if (!(bestGain > 0)) break;
    keep.push(best);
    const d = D[best];
    for (let i = 0; i < n; i++) if (d[i] < cur[i]) cur[i] = d[i];
  }
  return keep.sort((a, b) => a - b);
}

// The engine's own staggered grid over the placement box (D4).
export function aiStoneGridPoints(placement, pitchMm) {
  const { xMm, yMm, widthMm, heightMm } = placement;
  const polygon = [new Point2D(xMm, yMm), new Point2D(xMm + widthMm, yMm), new Point2D(xMm + widthMm, yMm + heightMm), new Point2D(xMm, yMm + heightMm)];
  return sampleStaggeredFillPoints([polygon], new BoundingBox(xMm, yMm, xMm + widthMm, yMm + heightMm), pitchMm);
}

/**
 * @param {object} args
 * @param {object} args.detection detectAiStones()'s result (`ok: true`)
 * @param {{widthPx:number, heightPx:number, data:Uint8ClampedArray|Uint8Array}} args.imageBuffer
 * @param {{xMm:number, yMm:number, widthMm:number, heightMm:number}} args.placement unrotated box
 * @param {number} args.stoneSizeMm
 * @param {number} args.gapMm
 * @param {{id:string, hex:string}[]} args.palette the catalogue
 * @param {{xMm:number, yMm:number}[]} [args.points] grid points; default the engine grid
 * @returns {{xMm:number, yMm:number, color:string}[]}
 */
export function placeAiStones({ detection, imageBuffer, placement, stoneSizeMm, gapMm, palette, points }) {
  if (!detection || !detection.ok || detection.stones.length === 0) return [];
  if (!Array.isArray(palette) || palette.length === 0) throw new TypeError('placeAiStones requires a non-empty palette.');
  const pitchMm = stoneSizeMm + gapMm;
  const { widthPx, heightPx, data } = imageBuffer;
  const { xMm, yMm, widthMm, heightMm } = placement;
  const sx = widthMm / widthPx, sy = heightMm / heightPx;
  const catLabs = catalogueLabs(palette);
  const keep = chooseAiStonePalette(detection.stones.map((s) => s.lab), catLabs);
  const jetIndex = palette.findIndex((entry) => entry.id === AI_STONE_JET_ID);
  const aiX = detection.stones.map((s) => xMm + s.xPx * sx);
  const aiY = detection.stones.map((s) => yMm + s.yPx * sy);
  const grid = createPointGrid(aiX, aiY, pitchMm);
  const k = Math.min(AI_STONE_COLOR_NEIGHBOURS, detection.stones.length);
  const gridPoints = points ?? aiStoneGridPoints(placement, pitchMm);
  const out = [];
  for (const point of gridPoints) {
    const u = point.xMm - xMm, v = point.yMm - yMm;
    const px = Math.min(widthPx - 1, Math.max(0, Math.trunc(u / sx)));
    const py = Math.min(heightPx - 1, Math.max(0, Math.trunc(v / sy)));
    if (!(data[(py * widthPx + px) * 4 + 3] > ALPHA_THRESHOLD)) continue;
    const nn = grid.kNearest(point.xMm, point.yMm, k);
    if (!(nn[0].distance < AI_STONE_KEEP_RATIO * pitchMm)) continue;
    let sw = 0, jet = 0;
    const target = [0, 0, 0];
    for (const { index, distance } of nn) {
      const w = 1 / (distance + AI_STONE_WEIGHT_OFFSET_MM);
      const s = detection.stones[index];
      sw += w;
      if (s.jetLike) jet += w;
      target[0] += w * s.lab[0]; target[1] += w * s.lab[1]; target[2] += w * s.lab[2];
    }
    target[0] /= sw; target[1] /= sw; target[2] /= sw;
    let colorIndex;
    if (jetIndex >= 0 && jet / sw >= AI_STONE_JET_SHARE) {
      colorIndex = jetIndex;
    } else {
      let bestD = Infinity;
      for (const c of keep) {
        const d = weightedLabDistance(target, catLabs[c]);
        if (d < bestD) { bestD = d; colorIndex = c; }
      }
    }
    out.push({ xMm: point.xMm, yMm: point.yMm, color: palette[colorIndex].id });
  }
  return out;
}
