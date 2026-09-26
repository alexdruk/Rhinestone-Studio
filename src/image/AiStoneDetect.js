/**
 * IMG-023: find the stones an AI drew in a "picture of rhinestones" (an IMG-022 redraw, or any
 * rhinestone picture) -- every stone's centre in pixels, the stone pitch, and each stone's colour
 * in CIE Lab. Pure: no DOM, no canvas.
 *
 * This is a plain-JS port of detect()/highlights()/stone_lab() in
 * docs/prototypes/ai_stone_transfer_reference.py, with the same constants. The operations that
 * replace OpenCV/scipy/scikit-image are listed in docs/specifications/IMG-023-AiStoneTransfer.md,
 * "Port contract". Thresholds marked "L8" are on OpenCV's 8-bit L scale (L* x 255/100), as in the
 * reference.
 */

import { rgbToLab } from './ColorSpace.js';

export const AI_STONE_TOPHAT_KERNEL_PX = 9;
export const AI_STONE_TOPHAT_MIN_L8 = 40;
export const AI_STONE_MAX_SATURATION_S8 = 110;
export const AI_STONE_MIN_HIGHLIGHT_L8 = 150;
export const AI_STONE_ALPHA_THRESHOLD = 128;
export const AI_STONE_MIN_BLOB_AREA_PX = 1;
export const AI_STONE_MAX_BLOB_AREA_PX = 60;
export const AI_STONE_PITCH_NEIGHBOURS = 7;
export const AI_STONE_PITCH_FLOOR_RATIO = 0.6;
export const AI_STONE_MERGE_RATIO = 0.55;
export const AI_STONE_DOT_OFFSET_RATIO = Object.freeze([0.30, 0.35]);
export const AI_STONE_BLACKHAT_RATIO = 0.6;
export const AI_STONE_BLACKHAT_MIN_KERNEL_PX = 5;
export const AI_STONE_GAP_BLUR_SIGMA = 0.7;
export const AI_STONE_GAP_PERCENTILE = 75;
export const AI_STONE_DISTANCE_BLUR_SIGMA = 1.0;
export const AI_STONE_PEAK_SPACING_RATIO = 0.45;
export const AI_STONE_PEAK_MIN_SPACING_PX = 3;
export const AI_STONE_PEAK_FLOOR_RATIO = 0.2;
export const AI_STONE_DOTLESS_KEEP_RATIO = 0.7;
export const AI_STONE_COLOR_RADIUS_RATIO = 0.33;
export const AI_STONE_COLOR_PERCENTILES = Object.freeze([15, 60]);
export const AI_STONE_JET_MAX_L = 30;
export const AI_STONE_JET_MAX_CHROMA = 15;

// ---- small numeric helpers ----------------------------------------------------------------------

// Python's round(): half to even.
function roundHalfEven(x) {
  const f = Math.floor(x);
  const d = x - f;
  if (d > 0.5) return f + 1;
  if (d < 0.5) return f;
  return f % 2 === 0 ? f : f + 1;
}

// numpy.percentile's default (linear interpolation) on an already sorted array.
function percentileSorted(sorted, q) {
  const n = sorted.length;
  if (n === 0) return NaN;
  const h = (n - 1) * q / 100;
  const lo = Math.floor(h);
  const hi = Math.min(n - 1, lo + 1);
  return sorted[lo] + (h - lo) * (sorted[hi] - sorted[lo]);
}

function medianOf(values) {
  const s = Float64Array.from(values).sort();
  const n = s.length;
  const m = n >> 1;
  return n % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

export function isJetLikeLab(lab) {
  return lab[0] < AI_STONE_JET_MAX_L && Math.hypot(lab[1], lab[2]) < AI_STONE_JET_MAX_CHROMA;
}

// ---- structuring element (OpenCV getStructuringElement(MORPH_ELLIPSE, (k, k))) ------------------

// Half-width of each mask row, index 0..k-1; -1 marks an empty row.
export function ellipseRowHalfWidths(k) {
  const r = Math.floor(k / 2);
  const c = r;
  const out = [];
  for (let i = 0; i < k; i++) {
    const dy = i - r;
    if (Math.abs(dy) > r || r === 0) { out.push(r === 0 ? 0 : -1); continue; }
    out.push(roundHalfEven(c * Math.sqrt((r * r - dy * dy) / (r * r))));
  }
  return out;
}

// ---- grey morphology over an elliptical mask, out-of-image pixels ignored -----------------------

function morph(src, w, h, k, useMin) {
  const halfWidths = ellipseRowHalfWidths(k);
  const r = Math.floor(k / 2);
  const distinct = [...new Set(halfWidths.filter((d) => d >= 0))];
  const rowPass = new Map();
  for (const dx of distinct) {
    const out = new Float64Array(w * h);
    for (let y = 0; y < h; y++) {
      const base = y * w;
      for (let x = 0; x < w; x++) {
        const x0 = Math.max(0, x - dx);
        const x1 = Math.min(w - 1, x + dx);
        let v = src[base + x0];
        for (let xx = x0 + 1; xx <= x1; xx++) {
          const s = src[base + xx];
          if (useMin ? s < v : s > v) v = s;
        }
        out[base + x] = v;
      }
    }
    rowPass.set(dx, out);
  }
  const out = new Float64Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let v = useMin ? Infinity : -Infinity;
      for (let i = 0; i < k; i++) {
        const dx = halfWidths[i];
        if (dx < 0) continue;
        const yy = y + i - r;
        if (yy < 0 || yy >= h) continue;
        const s = rowPass.get(dx)[yy * w + x];
        if (useMin ? s < v : s > v) v = s;
      }
      out[y * w + x] = v;
    }
  }
  return out;
}

const erode = (src, w, h, k) => morph(src, w, h, k, true);
const dilate = (src, w, h, k) => morph(src, w, h, k, false);

// ---- Gaussian blur (separable, reflect-101 border) ----------------------------------------------

function gaussianKernel(size, sigma) {
  const half = (size - 1) / 2;
  const k = new Float64Array(size);
  let sum = 0;
  for (let i = 0; i < size; i++) { const t = i - half; k[i] = Math.exp(-(t * t) / (2 * sigma * sigma)); sum += k[i]; }
  for (let i = 0; i < size; i++) k[i] /= sum;
  return k;
}

function reflect101(i, n) {
  if (n === 1) return 0;
  while (i < 0 || i >= n) i = i < 0 ? -i : 2 * n - 2 - i;
  return i;
}

function gaussianBlur(src, w, h, size, sigma) {
  const k = gaussianKernel(size, sigma);
  const half = (size - 1) / 2;
  const tmp = new Float64Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let s = 0;
      for (let i = 0; i < size; i++) s += k[i] * src[y * w + reflect101(x + i - half, w)];
      tmp[y * w + x] = s;
    }
  }
  const out = new Float64Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let s = 0;
      for (let i = 0; i < size; i++) s += k[i] * tmp[reflect101(y + i - half, h) * w + x];
      out[y * w + x] = s;
    }
  }
  return out;
}

// OpenCV's kernel size for a float image when only sigma is given: round(8 sigma + 1) | 1.
const gaussianSizeForSigma = (sigma) => Math.round(sigma * 8 + 1) | 1;

// ---- exact Euclidean distance transform (Felzenszwalb-Huttenlocher) ----------------------------

function edt1d(f, n, d, v, z) {
  let k = 0;
  v[0] = 0; z[0] = -Infinity; z[1] = Infinity;
  for (let q = 1; q < n; q++) {
    if (f[q] === Infinity) continue;
    if (f[v[k]] === Infinity) { v[k] = q; continue; }
    let s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    while (s <= z[k]) { k--; s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]); }
    k++; v[k] = q; z[k] = s; z[k + 1] = Infinity;
  }
  if (f[v[0]] === Infinity) { for (let q = 0; q < n; q++) d[q] = Infinity; return; }
  k = 0;
  for (let q = 0; q < n; q++) {
    while (z[k + 1] < q) k++;
    const t = q - v[k];
    d[q] = t * t + f[v[k]];
  }
}

// Distance from each `inside` pixel to the nearest non-inside pixel of the image (0 elsewhere). The
// image edge is not a boundary.
function distanceToOutside(inside, w, h) {
  const g = new Float64Array(w * h);
  for (let i = 0; i < w * h; i++) g[i] = inside[i] ? Infinity : 0;
  const n = Math.max(w, h);
  const f = new Float64Array(n), d = new Float64Array(n), v = new Int32Array(n), z = new Float64Array(n + 1);
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) f[y] = g[y * w + x];
    edt1d(f, h, d, v, z);
    for (let y = 0; y < h; y++) g[y * w + x] = d[y];
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) f[x] = g[y * w + x];
    edt1d(f, w, d, v, z);
    for (let x = 0; x < w; x++) g[y * w + x] = Math.sqrt(d[x]);
  }
  return g;
}

// ---- point grid (nearest neighbours / radius queries) --------------------------------------------

export function createPointGrid(xs, ys, cellSize) {
  const n = xs.length;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (let i = 0; i < n; i++) {
    if (xs[i] < minX) minX = xs[i]; if (xs[i] > maxX) maxX = xs[i];
    if (ys[i] < minY) minY = ys[i]; if (ys[i] > maxY) maxY = ys[i];
  }
  if (n === 0) { minX = minY = 0; maxX = maxY = 0; }
  const cs = cellSize > 0 ? cellSize : 1;
  const cols = Math.max(1, Math.floor((maxX - minX) / cs) + 1);
  const rows = Math.max(1, Math.floor((maxY - minY) / cs) + 1);
  const cellOf = (x, y) => [Math.min(cols - 1, Math.max(0, Math.floor((x - minX) / cs))), Math.min(rows - 1, Math.max(0, Math.floor((y - minY) / cs)))];
  const heads = new Int32Array(cols * rows).fill(-1);
  const next = new Int32Array(n);
  for (let i = 0; i < n; i++) {
    const [cx, cy] = cellOf(xs[i], ys[i]);
    next[i] = heads[cy * cols + cx];
    heads[cy * cols + cx] = i;
  }
  function visitRing(cx, cy, R, fn) {
    for (let gy = cy - R; gy <= cy + R; gy++) {
      if (gy < 0 || gy >= rows) continue;
      for (let gx = cx - R; gx <= cx + R; gx++) {
        if (gx < 0 || gx >= cols) continue;
        if (Math.max(Math.abs(gx - cx), Math.abs(gy - cy)) !== R) continue;
        for (let i = heads[gy * cols + gx]; i !== -1; i = next[i]) fn(i);
      }
    }
  }
  return {
    // The k nearest points to (x, y), sorted by distance: [{ index, distance }].
    kNearest(x, y, k) {
      const [cx, cy] = cellOf(x, y);
      const found = [];
      const maxR = Math.max(cols, rows);
      for (let R = 0; R <= maxR; R++) {
        visitRing(cx, cy, R, (i) => found.push({ index: i, distance: Math.hypot(xs[i] - x, ys[i] - y) }));
        if (found.length >= k) {
          found.sort((a, b) => a.distance - b.distance || a.index - b.index);
          // Every point closer than `covered` lies in the cells visited so far: the distance from
          // the query to the nearest side of the visited square that is still inside the grid.
          const covered = Math.min(
            cx - R <= 0 ? Infinity : x - (minX + (cx - R) * cs),
            cx + R >= cols - 1 ? Infinity : (minX + (cx + R + 1) * cs) - x,
            cy - R <= 0 ? Infinity : y - (minY + (cy - R) * cs),
            cy + R >= rows - 1 ? Infinity : (minY + (cy + R + 1) * cs) - y
          );
          if (found[k - 1].distance <= covered) return found.slice(0, k);
        }
      }
      found.sort((a, b) => a.distance - b.distance || a.index - b.index);
      return found.slice(0, k);
    },
    // Every point with distance <= r, unsorted.
    within(x, y, r) {
      const [cx, cy] = cellOf(x, y);
      const R = Math.ceil(r / cs) + 1;
      const out = [];
      for (let ring = 0; ring <= R; ring++) visitRing(cx, cy, ring, (i) => { if (Math.hypot(xs[i] - x, ys[i] - y) <= r) out.push(i); });
      return out;
    }
  };
}

// ---- steps ---------------------------------------------------------------------------------------

function lightnessL8AndSaturation(imageBuffer) {
  const { widthPx: w, heightPx: h, data } = imageBuffer;
  const L8 = new Float64Array(w * h);
  const S8 = new Uint8Array(w * h);
  const cache = new Map();
  for (let i = 0; i < w * h; i++) {
    const r = data[i * 4], g = data[i * 4 + 1], b = data[i * 4 + 2];
    const key = (r << 16) | (g << 8) | b;
    let l8 = cache.get(key);
    if (l8 === undefined) { l8 = Math.round(rgbToLab(r, g, b)[0] * 255 / 100); cache.set(key, l8); }
    L8[i] = l8;
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
    S8[i] = mx === 0 ? 0 : Math.round(255 * (mx - mn) / mx);
  }
  return { L8, S8 };
}

// reference highlights(): 8-connected blobs of bright, unsaturated top-hat spots.
function findHighlights(imageBuffer, L8, S8) {
  const { widthPx: w, heightPx: h, data } = imageBuffer;
  const k = AI_STONE_TOPHAT_KERNEL_PX;
  const opened = dilate(erode(L8, w, h, k), w, h, k);
  const spot = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) {
    spot[i] = (L8[i] - opened[i] > AI_STONE_TOPHAT_MIN_L8 && S8[i] < AI_STONE_MAX_SATURATION_S8
      && L8[i] > AI_STONE_MIN_HIGHLIGHT_L8 && data[i * 4 + 3] > AI_STONE_ALPHA_THRESHOLD) ? 1 : 0;
  }
  const seen = new Uint8Array(w * h);
  const queue = new Int32Array(w * h);
  const blobs = [];
  for (let start = 0; start < w * h; start++) {
    if (!spot[start] || seen[start]) continue;
    let head = 0, tail = 0, sx = 0, sy = 0;
    queue[tail++] = start; seen[start] = 1;
    while (head < tail) {
      const idx = queue[head++];
      const x = idx % w, y = (idx - x) / w;
      sx += x; sy += y;
      for (let dy = -1; dy <= 1; dy++) {
        const ny = y + dy;
        if (ny < 0 || ny >= h) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          if ((dx === 0 && dy === 0) || nx < 0 || nx >= w) continue;
          const n = ny * w + nx;
          if (spot[n] && !seen[n]) { seen[n] = 1; queue[tail++] = n; }
        }
      }
    }
    const area = tail;
    if (area >= AI_STONE_MIN_BLOB_AREA_PX && area <= AI_STONE_MAX_BLOB_AREA_PX) blobs.push({ x: sx / area, y: sy / area, area });
  }
  return blobs;
}

function estimatePitch(blobs) {
  const xs = blobs.map((b) => b.x), ys = blobs.map((b) => b.y);
  // Cell size from the mean spacing of the blobs; any positive value is correct, this one is fast.
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const b of blobs) { minX = Math.min(minX, b.x); maxX = Math.max(maxX, b.x); minY = Math.min(minY, b.y); maxY = Math.max(maxY, b.y); }
  const cell = Math.max(1, Math.sqrt(((maxX - minX + 1) * (maxY - minY + 1)) / blobs.length));
  const grid = createPointGrid(xs, ys, cell);
  const second = [];
  const first = [];
  for (let i = 0; i < blobs.length; i++) {
    const nn = grid.kNearest(xs[i], ys[i], AI_STONE_PITCH_NEIGHBOURS);
    first.push(nn[1].distance);
    for (let j = 2; j < AI_STONE_PITCH_NEIGHBOURS; j++) second.push(nn[j].distance);
  }
  const rough = medianOf(second);
  return medianOf(first.filter((d) => d > AI_STONE_PITCH_FLOOR_RATIO * rough));
}

function mergeDots(blobs, pitch) {
  const xs = blobs.map((b) => b.x), ys = blobs.map((b) => b.y);
  const grid = createPointGrid(xs, ys, pitch);
  // Stable: area descending, then blob (raster) order.
  const order = blobs.map((_, i) => i).sort((a, b) => blobs[b].area - blobs[a].area || a - b);
  const taken = new Uint8Array(blobs.length);
  const merged = [];
  for (const i of order) {
    if (taken[i]) continue;
    const group = grid.within(xs[i], ys[i], AI_STONE_MERGE_RATIO * pitch).filter((j) => !taken[j]);
    let sw = 0, sx = 0, sy = 0;
    for (const j of group) { taken[j] = 1; sw += blobs[j].area; sx += xs[j] * blobs[j].area; sy += ys[j] * blobs[j].area; }
    merged.push({ x: sx / sw, y: sy / sw });
  }
  return merged;
}

// Stones whose highlight the AI did not draw: one peak of the distance-to-gap map per stone-shaped
// patch that has no dot-derived stone nearby. See the spec's "Stones without a dot".
function findDotlessStones(imageBuffer, L8, pitch, dotCentres) {
  const { widthPx: w, heightPx: h, data } = imageBuffer;
  const kk = Math.max(AI_STONE_BLACKHAT_MIN_KERNEL_PX, Math.trunc(pitch * AI_STONE_BLACKHAT_RATIO) | 1);
  const closed = erode(dilate(L8, w, h, kk), w, h, kk);
  const blackhat = new Float64Array(w * h);
  for (let i = 0; i < w * h; i++) blackhat[i] = closed[i] - L8[i];
  const bth = gaussianBlur(blackhat, w, h, 3, AI_STONE_GAP_BLUR_SIGMA);
  const subject = new Uint8Array(w * h);
  const subjectValues = [];
  for (let i = 0; i < w * h; i++) {
    if (data[i * 4 + 3] > AI_STONE_ALPHA_THRESHOLD) { subject[i] = 1; subjectValues.push(bth[i]); }
  }
  if (subjectValues.length === 0) return [];
  const threshold = percentileSorted(Float64Array.from(subjectValues).sort(), AI_STONE_GAP_PERCENTILE);
  const body = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) body[i] = subject[i] && bth[i] <= threshold ? 1 : 0;
  const dist = gaussianBlur(distanceToOutside(body, w, h), w, h, gaussianSizeForSigma(AI_STONE_DISTANCE_BLUR_SIGMA), AI_STONE_DISTANCE_BLUR_SIGMA);

  // Square maximum filter over subject pixels (non-subject = -Infinity, image edge clamped).
  const m = Math.max(AI_STONE_PEAK_MIN_SPACING_PX, Math.trunc(pitch * AI_STONE_PEAK_SPACING_RATIO));
  const masked = new Float64Array(w * h);
  for (let i = 0; i < w * h; i++) masked[i] = subject[i] ? dist[i] : -Infinity;
  const rowMax = new Float64Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let v = -Infinity;
      for (let xx = x - m; xx <= x + m; xx++) { const s = masked[y * w + Math.min(w - 1, Math.max(0, xx))]; if (s > v) v = s; }
      rowMax[y * w + x] = v;
    }
  }
  const floor = AI_STONE_PEAK_FLOOR_RATIO * pitch;
  const candidates = [];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (!subject[i] || !(masked[i] > floor)) continue;
      let v = -Infinity;
      for (let yy = y - m; yy <= y + m; yy++) { const s = rowMax[Math.min(h - 1, Math.max(0, yy)) * w + x]; if (s > v) v = s; }
      if (masked[i] === v) candidates.push(i);
    }
  }
  candidates.sort((a, b) => masked[b] - masked[a] || a - b);
  // Greedy spacing: keep unless an already-kept peak is closer than m (Chebyshev).
  const cellCols = Math.ceil(w / m), cellRows = Math.ceil(h / m);
  const cells = new Map();
  const kept = [];
  for (const i of candidates) {
    const x = i % w, y = (i - x) / w;
    const cx = Math.floor(x / m), cy = Math.floor(y / m);
    let blocked = false;
    for (let gy = cy - 1; gy <= cy + 1 && !blocked; gy++) {
      if (gy < 0 || gy >= cellRows) continue;
      for (let gx = cx - 1; gx <= cx + 1 && !blocked; gx++) {
        if (gx < 0 || gx >= cellCols) continue;
        for (const [px, py] of cells.get(gy * cellCols + gx) || []) {
          if (Math.max(Math.abs(px - x), Math.abs(py - y)) < m) { blocked = true; break; }
        }
      }
    }
    if (blocked) continue;
    kept.push([x, y]);
    const key = cy * cellCols + cx;
    if (!cells.has(key)) cells.set(key, []);
    cells.get(key).push([x, y]);
  }
  if (kept.length === 0) return [];
  const grid = createPointGrid(dotCentres.map((c) => c.x), dotCentres.map((c) => c.y), pitch);
  const keepBeyond = AI_STONE_DOTLESS_KEEP_RATIO * pitch;
  return kept.filter(([x, y]) => grid.kNearest(x, y, 1)[0].distance > keepBeyond).map(([x, y]) => ({ x, y }));
}

// reference stone_lab(): median Lab of the stone's middle band of lightness.
function stoneLab(imageBuffer, x, y, radius) {
  const { widthPx: w, heightPx: h, data } = imageBuffer;
  const rr = Math.max(2, roundHalfEven(radius));
  const x0 = Math.max(0, Math.trunc(x) - rr), x1 = Math.min(w, Math.trunc(x) + rr + 1);
  const y0 = Math.max(0, Math.trunc(y) - rr), y1 = Math.min(h, Math.trunc(y) + rr + 1);
  const labs = [];
  for (let yy = y0; yy < y1; yy++) {
    for (let xx = x0; xx < x1; xx++) {
      if ((xx - x) * (xx - x) + (yy - y) * (yy - y) > rr * rr) continue;
      const i = (yy * w + xx) * 4;
      if (data[i + 3] <= AI_STONE_ALPHA_THRESHOLD) continue;
      labs.push(rgbToLab(data[i], data[i + 1], data[i + 2]));
    }
  }
  if (labs.length < 3) return [0, 0, 0];
  const Ls = Float64Array.from(labs, (l) => l[0]).sort();
  const lo = percentileSorted(Ls, AI_STONE_COLOR_PERCENTILES[0]);
  const hi = percentileSorted(Ls, AI_STONE_COLOR_PERCENTILES[1]);
  const selected = labs.filter((l) => l[0] >= lo && l[0] <= hi);
  const use = selected.length >= 3 ? selected : labs;
  return [0, 1, 2].map((c) => medianOf(use.map((l) => l[c])));
}

/**
 * @param {{widthPx:number, heightPx:number, data:Uint8ClampedArray|Uint8Array}} imageBuffer RGBA
 * @returns {{ok:true, pitchPx:number, widthPx:number, heightPx:number, dotCount:number,
 *   stones:{xPx:number, yPx:number, lab:number[], jetLike:boolean, fromDot:boolean}[]}
 *   | {ok:false, reason:'too-few-highlights', dotCount:number, widthPx:number, heightPx:number}}
 */
export function detectAiStones(imageBuffer) {
  if (!imageBuffer || typeof imageBuffer.widthPx !== 'number' || typeof imageBuffer.heightPx !== 'number' || !imageBuffer.data) {
    throw new TypeError('detectAiStones requires an RGBA imageBuffer.');
  }
  const { widthPx, heightPx } = imageBuffer;
  const { L8, S8 } = lightnessL8AndSaturation(imageBuffer);
  const blobs = findHighlights(imageBuffer, L8, S8);
  if (blobs.length < AI_STONE_PITCH_NEIGHBOURS) return { ok: false, reason: 'too-few-highlights', dotCount: blobs.length, widthPx, heightPx };
  const pitchPx = estimatePitch(blobs);
  const [ox, oy] = AI_STONE_DOT_OFFSET_RATIO;
  const dotCentres = mergeDots(blobs, pitchPx).map((d) => ({ x: d.x + ox * pitchPx / 2, y: d.y + oy * pitchPx / 2 }));
  const dotless = findDotlessStones(imageBuffer, L8, pitchPx, dotCentres);
  const radius = pitchPx * AI_STONE_COLOR_RADIUS_RATIO;
  const stones = [...dotCentres.map((c) => ({ ...c, fromDot: true })), ...dotless.map((c) => ({ ...c, fromDot: false }))]
    .map(({ x, y, fromDot }) => {
      const lab = stoneLab(imageBuffer, x, y, radius);
      return { xPx: x, yPx: y, lab, jetLike: isJetLikeLab(lab), fromDot };
    });
  return { ok: true, pitchPx, widthPx, heightPx, dotCount: blobs.length, stones };
}
