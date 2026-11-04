/**
 * Tinted view of the 2D production canvas (IMG-026 build Q).
 *
 * A view that looks like the finished piece: the gaps between an image layer's stones take a
 * darker shade of their stone's colour, each stone keeps its catalogue lightness, specks between
 * stones are closed and large Jet pupils get a thin rim. Ported from PatternNifty (IS, commit
 * e9e7014) src/render/tinted.js and IS spec section 8; plan: docs/IS-PORT-PLAN.md section 3.7.
 *
 * Rendering-only, like the rest of src/renderer/: it reads the stones it is given (xMm, yMm,
 * sizeMm, color, layerId) and never creates, moves, resizes or recolours one. Which stones are
 * tinted, and which use the Black & white gap rule, is decided by the caller as sets of layer ids;
 * this module knows nothing about layer types.
 *
 * The steps (IS spec 8):
 *   1. The tinted bitmap covers the tinted stones' box plus 2 main-stone diameters (clipped to the
 *      canvas).
 *   2. A pixel outside every stone takes the gap colour of its nearest stone, measured to the
 *      stone's edge (distance to the centre minus the radius),
 *   3. gapRgb(): the stone's catalogue fill darkened by GAP_RULE (hue kept),
 *   4. only within FILL_MARGIN_MM of that edge; beyond it the canvas background shows. Stones of a
 *      layer in crystalGapLayerIds (Black & white) use IS's BW_GAP "crystal": where the
 *      second-nearest stone's edge is within the margin too and its colour differs, the gap colour
 *      of the lighter of the two.
 *   4b. Every area still open, enclosed by the design (4-connected, not touching the bitmap's border)
 *      and at most ENCLOSED_GAP_MAX_MM2, takes its pixels' nearest stone's gap colour however far.
 *   5. The stones are drawn with drawCrystalStone() (unchanged); a stone above SS6 with a stroke
 *      lighter than its fill (Jet) gets its rim redrawn at an SS6 stone's width.
 *   6. keepStoneLightness(): each stone's inner 60 % brought within 4 L* of its fill, then the
 *      whole stone within 2.
 */

import { STONE_COLORS } from './StoneColors.js';
import { getStoneSize } from './StoneSizes.js';
import { adjustBrightness, drawCrystalStone } from './CrystalStoneRenderer.js';
import { getCrystalAppearance } from './CrystalAppearance.js';

export const MARGIN_STONES = 2;
// Step 4 (IS-05c): 0.6 x an SS6 stone's 1 mm radius beyond the edge, the same for every size.
export const SS6_RADIUS_MM = getStoneSize('ss6').diameterMm / 2;
export const FILL_MARGIN_MM = 0.6 * SS6_RADIUS_MM;
// Step 4b (PN-04d): the largest enclosed open area that is a speck, not a hole: two SS6 stones.
export const ENCLOSED_GAP_MAX_MM2 = 2 * Math.PI;
// Step 6 (IS-05b): aims for the whole stone's and the inner zone's mean L*.
export const STONE_LIGHTNESS = Object.freeze({ whole: 2, inner: 4 });
export const INNER_SHARE = 0.6;
export const RAMP_SHARE = 0.2;
// Step 3 (IS-05b): a fill of lightness L is darkened by minStep + slope * max(0, L - fromL) L*, and
// by at least lightMinStep when L is above lightAbove. darkBelow 0: no fill is lightened.
export const GAP_RULE = Object.freeze({ minStep: 4, slope: 0.05, fromL: 80, darkBelow: 0, lightAbove: 85, lightMinStep: 8 });

// ---- CIE L* of sRGB (D65, Y of white = 1) ----

const TO_LINEAR = Float64Array.from({ length: 256 }, (_, v) => {
  const c = v / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
});
const toSrgb8 = (lin) => {
  const c = lin <= 0.0031308 ? 12.92 * lin : 1.055 * Math.max(0, lin) ** (1 / 2.4) - 0.055;
  return Math.max(0, Math.min(255, Math.round(c * 255)));
};
// toSrgb8 by lookup: the linear value at each 8-bit rounding boundary (v + 0.5) / 255, searched.
const ROUND_AT = Float64Array.from({ length: 255 }, (_, v) => {
  const c = (v + 0.5) / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
});
const toSrgb8Fast = (lin) => {
  let lo = 0, hi = 255;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (ROUND_AT[mid] <= lin) lo = mid + 1;
    else hi = mid;
  }
  return lo;
};
const lumOf = (r, g, b) => 0.212671 * TO_LINEAR[r] + 0.71516 * TO_LINEAR[g] + 0.072169 * TO_LINEAR[b];
export const lightnessOfY = (y) => (y > 216 / 24389 ? 116 * Math.cbrt(y) - 16 : (24389 / 27) * y);
// L* of Y in 1/LUT_STEPS steps, linearly interpolated (error far below 0.01 L*), for the per-pixel loops.
const LUT_STEPS = 16384;
const L_OF_Y = Float64Array.from({ length: LUT_STEPS + 2 }, (_, i) => lightnessOfY(Math.min(1, i / LUT_STEPS)));
const fastL = (y) => {
  const f = Math.max(0, Math.min(1, y)) * LUT_STEPS, i = Math.floor(f);
  return L_OF_Y[i] + (L_OF_Y[i + 1] - L_OF_Y[i]) * (f - i);
};
const yOfLightness = (l) => (l > 8 ? ((l + 16) / 116) ** 3 : (l * 27) / 24389);

function hexToRgb(hex) {
  let h = hex.replace(/^#/, '');
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
}

/** CIE L* of a #rrggbb colour. */
export function lightnessOfHex(hex) {
  const [r, g, b] = hexToRgb(hex);
  return lightnessOfY(lumOf(r, g, b));
}

/** CIE L* of an [r, g, b] 0..255 colour. */
export function lightnessOfRgb([r, g, b]) {
  return lightnessOfY(lumOf(r, g, b));
}

// Every step below is a generator that yields every so often, so the view can be rendered in
// slices between frames (TintedViewCache); the exported functions run a step to completion.
const YIELD_STONES = 256, YIELD_PIXELS = 1 << 16;
function runSteps(steps) {
  let r = steps.next();
  while (!r.done) r = steps.next();
  return r.value;
}

const fillOf = (color) => (STONE_COLORS[color] || STONE_COLORS.crystal).fill;

/**
 * The gap colour of a fill (step 3): its linear RGB scaled down (darker) or screened towards white
 * (lighter) to the rule's target L*, so its hue is kept, then rounded to 8 bits so the step is never
 * smaller than the rule's.
 * @param {string} hex
 * @returns {number[]} [r, g, b] 0..255
 */
export function gapRgb(hex, rule = GAP_RULE) {
  const rgb = hexToRgb(hex);
  const lin = rgb.map((v) => TO_LINEAR[v]);
  const y = lumOf(...rgb);
  const l = lightnessOfY(y);
  const lightOf = (out) => lightnessOfY(lumOf(...out));
  if (l < rule.darkBelow) {
    const want = l + rule.minStep;
    let h = (1 - yOfLightness(want)) / (1 - y);
    let out = lin.map((c) => toSrgb8(1 - h * (1 - c)));
    while (lightOf(out) < want && h > 0) out = lin.map((c) => toSrgb8(1 - (h *= 0.98) * (1 - c)));
    return out;
  }
  let step = rule.minStep + rule.slope * Math.max(0, l - rule.fromL);
  if (rule.lightAbove !== undefined && l > rule.lightAbove) step = Math.max(step, rule.lightMinStep);
  const want = Math.max(0, l - step);
  let k = y > 0 ? yOfLightness(want) / y : 0;
  let out = lin.map((c) => toSrgb8(c * k));
  while (lightOf(out) > want && k > 0) out = lin.map((c) => toSrgb8(c * (k *= 0.98)));
  return out;
}

/** The most common stone diameter (SS6 in practice). */
export function mainDiameterMm(stones) {
  const counts = new Map();
  for (const s of stones) counts.set(s.sizeMm, (counts.get(s.sizeMm) || 0) + 1);
  let best = null;
  for (const [d, n] of counts) if (best === null || n > counts.get(best) || (n === counts.get(best) && d < best)) best = d;
  return best;
}

/**
 * The nearest stone of every pixel that can be filled: owner (stone index or -1) and best (the
 * distance from the pixel centre to that stone's edge, px; negative inside the stone), and with
 * `second` also owner2/best2, the second-nearest stone within the margin. Pixel (x, y)'s centre is
 * at mm (minXmm + (x + 0.5) / scale, minYmm + (y + 0.5) / scale). Each stone writes its edge
 * distance into the pixels within the margin, keeping the smallest: exact for every pixel that can
 * be filled.
 */
export function nearestStones(stones, options) {
  return runSteps(nearestStonesSteps(stones, options));
}

function* nearestStonesSteps(stones, { minXmm, minYmm, widthPx, heightPx, scale, fillMarginMm = FILL_MARGIN_MM, second = false }) {
  const best = new Float32Array(widthPx * heightPx).fill(Infinity);
  const owner = new Int32Array(widthPx * heightPx).fill(-1);
  const best2 = second ? new Float32Array(widthPx * heightPx).fill(Infinity) : null;
  const owner2 = second ? new Int32Array(widthPx * heightPx).fill(-1) : null;
  const reach = fillMarginMm * scale;
  for (let i = 0; i < stones.length; i++) {
    if (i % YIELD_STONES === YIELD_STONES - 1) yield;
    const s = stones[i];
    const cx = (s.xMm - minXmm) * scale;
    const cy = (s.yMm - minYmm) * scale;
    const r = (s.sizeMm / 2) * scale;
    const out = r + reach;
    const x0 = Math.max(0, Math.floor(cx - out)), x1 = Math.min(widthPx - 1, Math.ceil(cx + out));
    const y0 = Math.max(0, Math.floor(cy - out)), y1 = Math.min(heightPx - 1, Math.ceil(cy + out));
    for (let y = y0; y <= y1; y++) {
      const dy = y + 0.5 - cy;
      for (let x = x0; x <= x1; x++) {
        const dx = x + 0.5 - cx;
        const edge = Math.sqrt(dx * dx + dy * dy) - r;
        if (edge > reach) continue;
        const p = y * widthPx + x;
        if (edge < best[p]) {
          if (second) {
            best2[p] = best[p];
            owner2[p] = owner[p];
          }
          best[p] = edge;
          owner[p] = i;
        } else if (second && edge < best2[p]) {
          best2[p] = edge;
          owner2[p] = i;
        }
      }
    }
  }
  return second ? { owner, best, owner2, best2, scale } : { owner, best, scale };
}

/**
 * Steps 2-4b: the RGBA pixels of the gap layer. Pixels left open are transparent (0, 0, 0, 0), so
 * the canvas background shows through. `near` is nearestStones() of the same bitmap (with
 * `second` when any stone is in crystalGap). crystalGap: null, or a Uint8Array with 1 for each
 * stone whose gaps follow the Black & white "crystal" rule.
 */
export function tintPixels(stones, options) {
  return runSteps(tintPixelsSteps(stones, options));
}

function* tintPixelsSteps(stones, { minXmm, minYmm, widthPx, heightPx, scale, near, crystalGap = null, rule = GAP_RULE, fillMarginMm = FILL_MARGIN_MM }) {
  const data = new Uint8ClampedArray(widthPx * heightPx * 4);
  // Written as packed RGBA words (one store per pixel; byte order of the platform).
  const words = new Uint32Array(data.buffer);
  const pack = new Uint32Array(1), packBytes = new Uint8ClampedArray(pack.buffer);
  const { owner, best, owner2, best2 } = near;
  const margin = fillMarginMm * scale;
  const tints = new Map();
  const tintOf = (color) => {
    if (!tints.has(color)) {
      packBytes.set([...gapRgb(fillOf(color), rule), 255]);
      tints.set(color, pack[0]);
    }
    return tints.get(color);
  };
  const lightness = new Map();
  const lighter = (a, b) => {
    for (const c of [a, b]) if (!lightness.has(c)) lightness.set(c, lightnessOfHex(fillOf(c)));
    return lightness.get(a) >= lightness.get(b) ? a : b;
  };
  const open = new Uint8Array(owner.length);
  for (let p = 0; p < owner.length; p++) {
    if (p % YIELD_PIXELS === YIELD_PIXELS - 1) yield;
    const i = owner[p];
    if (i < 0 || best[p] > margin) {
      open[p] = 1;
      continue;
    }
    const s = stones[i];
    const j = owner2 ? owner2[p] : -1;
    if (crystalGap && crystalGap[i] && j >= 0 && best2[p] <= margin && stones[j].color !== s.color) words[p] = tintOf(lighter(s.color, stones[j].color));
    else words[p] = tintOf(s.color);
  }
  // Step 4b: enclosed specks take the gap colour of their nearest stone (of the lighter of the two
  // nearest under the crystal rule when they differ).
  const gaps = yield* enclosedGapsSteps(open, widthPx, heightPx, ENCLOSED_GAP_MAX_MM2 * scale * scale);
  if (gaps.length) {
    const indexOf = new Map(stones.map((s, i) => [s, i]));
    const nearestTwo = stoneFinder(stones);
    for (const p of gaps) {
      const x = ((p % widthPx) + 0.5) / scale + minXmm, y = (Math.floor(p / widthPx) + 0.5) / scale + minYmm;
      const [a, b] = nearestTwo(x, y);
      if (!a) continue;
      if (crystalGap && crystalGap[indexOf.get(a)] && b && b.color !== a.color) words[p] = tintOf(lighter(a.color, b.color));
      else words[p] = tintOf(a.color);
    }
  }
  return data;
}

/**
 * The pixels of every 4-connected area of open pixels that does not touch the bitmap's border and
 * has at most maxPx pixels (step 4b).
 */
export function enclosedGaps(open, widthPx, heightPx, maxPx) {
  return runSteps(enclosedGapsSteps(open, widthPx, heightPx, maxPx));
}

function* enclosedGapsSteps(open, widthPx, heightPx, maxPx) {
  const seen = new Uint8Array(open.length);
  const queue = new Int32Array(open.length);
  const out = [];
  for (let start = 0, done = 0; start < open.length; start++) {
    if (start - done >= YIELD_PIXELS) {
      done = start;
      yield;
    }
    if (!open[start] || seen[start]) continue;
    let head = 0, tail = 0, border = false;
    queue[tail++] = start;
    seen[start] = 1;
    while (head < tail) {
      const p = queue[head++], x = p % widthPx, y = (p - x) / widthPx;
      if (x === 0 || y === 0 || x === widthPx - 1 || y === heightPx - 1) border = true;
      if (x > 0 && open[p - 1] && !seen[p - 1]) { seen[p - 1] = 1; queue[tail++] = p - 1; }
      if (x < widthPx - 1 && open[p + 1] && !seen[p + 1]) { seen[p + 1] = 1; queue[tail++] = p + 1; }
      if (y > 0 && open[p - widthPx] && !seen[p - widthPx]) { seen[p - widthPx] = 1; queue[tail++] = p - widthPx; }
      if (y < heightPx - 1 && open[p + widthPx] && !seen[p + widthPx]) { seen[p + widthPx] = 1; queue[tail++] = p + widthPx; }
    }
    if (!border && tail <= maxPx) for (let k = 0; k < tail; k++) out.push(queue[k]);
  }
  return out;
}

// (xMm, yMm) -> the two stones whose edges are nearest to it, [nearest, second], among the stones
// whose centre lies in the FINDER_CELL_MM cell of the point or the eight around it. An enclosed gap
// is at most a few mm across, so its nearest stone is always among them.
const FINDER_CELL_MM = 5;
function stoneFinder(stones) {
  const cells = new Map();
  const key = (i, j) => `${i},${j}`;
  for (const s of stones) {
    const k = key(Math.floor(s.xMm / FINDER_CELL_MM), Math.floor(s.yMm / FINDER_CELL_MM));
    if (!cells.has(k)) cells.set(k, []);
    cells.get(k).push(s);
  }
  return (xMm, yMm) => {
    const ci = Math.floor(xMm / FINDER_CELL_MM), cj = Math.floor(yMm / FINDER_CELL_MM);
    let a, b, da = Infinity, db = Infinity;
    for (let i = ci - 1; i <= ci + 1; i++) for (let j = cj - 1; j <= cj + 1; j++) {
      for (const s of cells.get(key(i, j)) || []) {
        const d = Math.hypot(s.xMm - xMm, s.yMm - yMm) - s.sizeMm / 2;
        if (d < da) [b, db, a, da] = [a, da, s, d];
        else if (d < db) [b, db] = [s, d];
      }
    }
    return [a, b];
  };
}

/**
 * Step 6 on RGBA pixels, in place: each stone's pixels (those whose centre lies inside its disc,
 * best <= 0) are brought to its fill's L*: the inner INNER_SHARE of the radius to a mean within
 * `inner`, then the whole stone to a mean within `whole`, by changing the whole stone evenly when
 * that keeps the inner zone within its tolerance, else only outside the inner zone. Too light is
 * darkened (linear RGB scaled down), too dark is lightened (screened towards white); the change
 * fades out over RAMP_SHARE of the radius. `near` is nearestStones() of the same pixels.
 */
export function keepStoneLightness(data, stones, near, options) {
  return runSteps(keepStoneLightnessSteps(data, stones, near, options));
}

function* keepStoneLightnessSteps(data, stones, near, { whole = STONE_LIGHTNESS.whole, inner = STONE_LIGHTNESS.inner } = {}) {
  const { owner, best, scale } = near;
  const count = new Int32Array(stones.length + 1);
  for (let p = 0; p < owner.length; p++) if (owner[p] >= 0 && best[p] <= 0) count[owner[p] + 1]++;
  for (let i = 0; i < stones.length; i++) count[i + 1] += count[i];
  const pix = new Int32Array(count[stones.length]);
  const fillAt = count.slice(0, stones.length);
  for (let p = 0; p < owner.length; p++) if (owner[p] >= 0 && best[p] <= 0) pix[fillAt[owner[p]]++] = p;

  const targets = new Map();
  let ys = new Float64Array(64), ws = new Float64Array(64), alpha = new Float64Array(64), beta = new Float64Array(64);
  let ones = new Float64Array(64).fill(1), outer = new Float64Array(64);
  let isInner = new Uint8Array(64);
  for (let i = 0; i < stones.length; i++) {
    if (i % 64 === 63) yield;
    const from = count[i], n = count[i + 1] - from;
    if (!n) continue;
    const color = stones[i].color;
    if (!targets.has(color)) targets.set(color, lightnessOfHex(fillOf(color)));
    const target = targets.get(color);
    if (ys.length < n) {
      [ys, ws, alpha, beta, outer] = [n, n, n, n, n].map((k) => new Float64Array(k));
      ones = new Float64Array(n).fill(1);
      isInner = new Uint8Array(n);
    }
    // ws: 1 in the inner zone, fading to 0 over the ramp; each pixel's change so far is
    // lin' = alpha * lin + beta, the same on every channel (so on Y too).
    const r = (stones[i].sizeMm / 2) * scale;
    let innerN = 0;
    for (let k = 0; k < n; k++) {
      const p = pix[from + k], q = p * 4;
      ys[k] = lumOf(data[q], data[q + 1], data[q + 2]);
      const rho = (best[p] + r) / r;
      const f = Math.max(0, Math.min(1, (INNER_SHARE + RAMP_SHARE - rho) / RAMP_SHARE));
      isInner[k] = rho <= INNER_SHARE ? 1 : 0;
      ws[k] = isInner[k] ? 1 : f * f * (3 - 2 * f);
      outer[k] = 1 - ws[k];
      innerN += isInner[k];
      alpha[k] = 1;
      beta[k] = 0;
    }
    // Mean L* of the zone's pixels (innerOnly: the inner zone, else the whole stone) after the
    // change (strength t in [0, 1], t = 1: unchanged; pixel k changed with strength
    // 1 - w[k] * (1 - t)). Tight loops over typed arrays: this is the view's hot path.
    const meanAt = (t, darken, w, innerOnly) => {
      let sum = 0, m = 0;
      const u = 1 - t;
      for (let k = 0; k < n; k++) {
        if (innerOnly && !isInner[k]) continue;
        const tk = 1 - w[k] * u;
        const y = darken ? tk * ys[k] : 1 - tk * (1 - ys[k]);
        const f = (y <= 0 ? 0 : y >= 1 ? 1 : y) * LUT_STEPS, j = Math.floor(f);
        sum += L_OF_Y[j] + (L_OF_Y[j + 1] - L_OF_Y[j]) * (f - j);
        m++;
      }
      return m ? sum / m : target;
    };
    const meanOf = (innerOnly) => meanAt(1, true, ws, innerOnly);
    // Bring the zone's mean to within tol of the target by changing the pixels with weights w;
    // false if even full strength (t = 0) does not get there.
    const solve = (tol, w, innerOnly) => {
      const mean = meanOf(innerOnly);
      if (Math.abs(mean - target) <= tol) return true;
      const darken = mean > target;
      const want = darken ? target + tol : target - tol;
      if ((meanAt(0, darken, w, innerOnly) > want) === darken) return false;
      let lo = 0, hi = 1;
      for (let it = 0; it < 14; it++) {
        const mid = (lo + hi) / 2;
        if ((meanAt(mid, darken, w, innerOnly) > want) === darken) hi = mid;
        else lo = mid;
      }
      const t = (lo + hi) / 2;
      for (let k = 0; k < n; k++) {
        const tk = 1 - w[k] * (1 - t);
        if (tk === 1) continue;
        if (darken) {
          ys[k] *= tk; alpha[k] *= tk; beta[k] *= tk;
        } else {
          ys[k] = 1 - tk * (1 - ys[k]); alpha[k] *= tk; beta[k] = 1 - tk * (1 - beta[k]);
        }
      }
      return true;
    };
    if (inner !== null && innerN) solve(inner, ws, true);
    const innerOk = () => inner === null || !innerN || Math.abs(meanOf(true) - target) <= inner + 0.25;
    if (Math.abs(meanOf(false) - target) > whole) {
      const saved = [ys.slice(0, n), alpha.slice(0, n), beta.slice(0, n)];
      solve(whole, ones, false);
      if (!innerOk()) {
        ys.set(saved[0]); alpha.set(saved[1]); beta.set(saved[2]);
        if (!solve(whole, outer, false)) solve(whole, ones, false);
      }
    }
    for (let k = 0; k < n; k++) {
      if (alpha[k] === 1 && beta[k] === 0) continue;
      const q = pix[from + k] * 4;
      for (let c = 0; c < 3; c++) data[q + c] = toSrgb8Fast(alpha[k] * TO_LINEAR[data[q + c]] + beta[k]);
    }
  }
}

// Step 5: one stone, drawn by drawCrystalStone() (unchanged), whose outer edge is stroked
// max(0.45 px, 0.09 r) wide in the catalogue stroke colour. Jet's stroke is light grey, so a large
// Jet stone (a pupil) had a light ring as wide, in mm, as its size. IS-05c: a stone above SS6 whose
// stroke is lighter than its fill gets the rim an SS6 stone has: the edge band is painted over
// (inside with the stone's accent, outside with its gap colour) and the edge stroked again at an
// SS6 stone's width.
const TAU = Math.PI * 2;
const RS_EDGE = { share: 0.09, minPx: 0.45 };
const lightRim = new Map();
function hasLightRim(color) {
  if (!lightRim.has(color)) {
    const c = STONE_COLORS[color] || STONE_COLORS.crystal;
    lightRim.set(color, lightnessOfHex(c.stroke) > lightnessOfHex(c.fill));
  }
  return lightRim.get(color);
}

/** Draw one tinted-view stone (steps 5): drawCrystalStone(), plus the SS6 rim for a large Jet stone. */
export function drawTintedStone(ctx, stone, xPx, yPx, radiusPx, scale, rule = GAP_RULE) {
  const appearance = getCrystalAppearance(stone);
  drawCrystalStone(ctx, xPx, yPx, radiusPx, stone.color, appearance);
  const r6 = SS6_RADIUS_MM * scale;
  if (radiusPx <= r6 * (1 + 1e-9) || !hasLightRim(stone.color)) return;
  const c = STONE_COLORS[stone.color] || STONE_COLORS.crystal;
  const wide = Math.max(RS_EDGE.minPx, radiusPx * RS_EDGE.share), narrow = Math.max(RS_EDGE.minPx, r6 * RS_EDGE.share);
  const band = (from, to) => {
    ctx.beginPath();
    ctx.arc(xPx, yPx, to, 0, TAU);
    ctx.arc(xPx, yPx, from, 0, TAU, true);
  };
  ctx.save();
  band(radiusPx - wide / 2 - 0.5, radiusPx);
  ctx.fillStyle = adjustBrightness(c.accent, appearance.brightness);
  ctx.fill();
  band(radiusPx, radiusPx + wide / 2 + 0.5);
  ctx.fillStyle = `rgb(${gapRgb(c.fill, rule).join(',')})`;
  ctx.fill();
  ctx.beginPath();
  ctx.arc(xPx, yPx, radiusPx, 0, TAU);
  ctx.lineWidth = narrow;
  ctx.strokeStyle = c.stroke;
  ctx.stroke();
  ctx.restore();
}

/**
 * The pixel box (device px of the target canvas, integers) the tinted bitmap covers: the stones'
 * box plus MARGIN_STONES main-stone diameters, clipped to the canvas. null when nothing is left.
 */
export function tintedBoxPx(stones, { s, ox, oy, canvasWidthPx, canvasHeightPx }) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const st of stones) {
    const r = st.sizeMm / 2;
    minX = Math.min(minX, st.xMm - r); maxX = Math.max(maxX, st.xMm + r);
    minY = Math.min(minY, st.yMm - r); maxY = Math.max(maxY, st.yMm + r);
  }
  const m = MARGIN_STONES * mainDiameterMm(stones);
  const x0 = Math.max(0, Math.floor(ox + (minX - m) * s)), y0 = Math.max(0, Math.floor(oy + (minY - m) * s));
  const x1 = Math.min(canvasWidthPx, Math.ceil(ox + (maxX + m) * s)), y1 = Math.min(canvasHeightPx, Math.ceil(oy + (maxY + m) * s));
  if (!(x1 > x0 && y1 > y0)) return null;
  return { xPx: x0, yPx: y0, widthPx: x1 - x0, heightPx: y1 - y0 };
}

/**
 * The tinted bitmap of `stones` for the transform {s, ox, oy} (canvas device px = o + mm * s):
 * steps 1-6 on a canvas made by createCanvas(widthPx, heightPx). Returns { canvas, xPx, yPx } (the
 * bitmap's top-left on the target canvas; open pixels transparent), or null. Never changes a stone.
 * @param {Array<{xMm:number,yMm:number,sizeMm:number,color:string}>} stones
 * @param {{s:number,ox:number,oy:number,canvasWidthPx:number,canvasHeightPx:number,crystalGap?:Uint8Array|null,createCanvas:(w:number,h:number)=>any}} options
 */
export function renderTintedBitmap(stones, options) {
  return runSteps(tintedBitmapSteps(stones, options));
}

/** renderTintedBitmap() as a generator that yields every few milliseconds of work. */
export function* tintedBitmapSteps(stones, { s, ox, oy, canvasWidthPx, canvasHeightPx, crystalGap = null, createCanvas }) {
  if (!stones.length) return null;
  const box = tintedBoxPx(stones, { s, ox, oy, canvasWidthPx, canvasHeightPx });
  if (!box) return null;
  const { xPx, yPx, widthPx, heightPx } = box;
  // Bitmap pixel (x, y) is canvas pixel (xPx + x, yPx + y), whose centre is at mm
  // ((xPx + x + 0.5 - ox) / s, ...).
  const geometry = { minXmm: (xPx - ox) / s, minYmm: (yPx - oy) / s, widthPx, heightPx, scale: s };
  const near = yield* nearestStonesSteps(stones, { ...geometry, second: Boolean(crystalGap && crystalGap.some((v) => v)) });
  const canvas = createCanvas(widthPx, heightPx);
  // willReadFrequently: a CPU-backed canvas, so the getImageData() of step 6 is not a GPU readback.
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const tint = ctx.createImageData(widthPx, heightPx);
  tint.data.set(yield* tintPixelsSteps(stones, { ...geometry, near, crystalGap }));
  ctx.putImageData(tint, 0, 0);
  yield;
  for (let i = 0; i < stones.length; i++) {
    const stone = stones[i];
    drawTintedStone(ctx, stone, (stone.xMm - geometry.minXmm) * s, (stone.yMm - geometry.minYmm) * s, (stone.sizeMm / 2) * s, s);
    // A one-pixel read makes the canvas draw what is queued, so the work is spread over the slices.
    if (i % YIELD_STONES === YIELD_STONES - 1) {
      ctx.getImageData(0, 0, 1, 1);
      yield;
    }
  }
  ctx.getImageData(0, 0, 1, 1);
  yield;
  const drawn = ctx.getImageData(0, 0, widthPx, heightPx);
  yield;
  yield* keepStoneLightnessSteps(drawn.data, stones, near);
  ctx.putImageData(drawn, 0, 0);
  return { canvas, xPx, yPx };
}

// A cheap fingerprint of the tinted stones (position, size, colour, gap rule) for the cache key.
function stonesFingerprint(stones, crystalGap) {
  let h1 = 0x811c9dc5, h2 = 0x9e3779b9;
  const mix = (v) => {
    h1 = Math.imul(h1 ^ v, 16777619);
    h2 = Math.imul(h2 ^ v, 2246822519) ^ (h2 >>> 13);
  };
  const colours = new Map();
  for (let i = 0; i < stones.length; i++) {
    const st = stones[i];
    mix(Math.round(st.xMm * 1e4) | 0);
    mix(Math.round(st.yMm * 1e4) | 0);
    mix(Math.round(st.sizeMm * 1e4) | 0);
    if (!colours.has(st.color)) colours.set(st.color, colours.size + 1);
    mix(colours.get(st.color));
    mix(crystalGap && crystalGap[i] ? 7 : 3);
  }
  return `${stones.length}:${[...colours.keys()].join(',')}:${h1 >>> 0}:${h2 >>> 0}`;
}

/**
 * Keeps the last tinted bitmap until the tinted stones, their gap rule or the transform/canvas
 * size change, and renders a new one in slices of about sliceMs between frames, so the page stays
 * responsive. get() returns the bitmap when it is ready for these stones and this transform, else
 * null (the caller draws the stones as usual meanwhile); onReady() is called once a new bitmap is
 * ready (the caller redraws). createCanvas(w, h) makes the offscreen canvas and schedule(fn) runs
 * fn later (both the caller's: this module touches no DOM). `timing` records the last render:
 * wall-clock ms from the first slice to the bitmap, and ms of work in the slices.
 */
export class TintedViewCache {
  constructor({ createCanvas, schedule = (fn) => setTimeout(fn, 0), now = () => performance.now(), onReady = null, sliceMs = 12 }) {
    Object.assign(this, { createCanvas, schedule, now, onReady, sliceMs });
    this.key = null;
    this.result = null;
    this.job = null;
    this.renders = 0;
    this.timing = null;
  }

  get(stones, { s, ox, oy, canvasWidthPx, canvasHeightPx, crystalGap = null }) {
    const key = `${stonesFingerprint(stones, crystalGap)}|${s}|${ox}|${oy}|${canvasWidthPx}x${canvasHeightPx}`;
    if (key === this.key) {
      // Back to the finished bitmap: a render for another view is no longer wanted.
      this.job = null;
      return this.result;
    }
    if (this.job && this.job.key === key) return null;
    const steps = tintedBitmapSteps(stones, { s, ox, oy, canvasWidthPx, canvasHeightPx, crystalGap, createCanvas: this.createCanvas });
    this.job = { key, steps, startedAt: this.now(), workMs: 0 };
    this.runSlice(this.job, true);
    return this.key === key ? this.result : null;
  }

  runSlice(job, insideGet = false) {
    if (this.job !== job) return;
    const start = this.now();
    let r;
    do r = job.steps.next();
    while (!r.done && this.now() - start < this.sliceMs);
    const end = this.now();
    job.workMs += end - start;
    if (!r.done) {
      this.schedule(() => this.runSlice(job));
      return;
    }
    this.job = null;
    this.key = job.key;
    this.result = r.value;
    this.renders++;
    this.timing = { totalMs: end - job.startedAt, workMs: job.workMs };
    // A render finished inside get() needs no redraw: the caller draws it now.
    if (!insideGet && this.onReady) this.onReady();
  }

  /** Stop a render in progress (the last finished bitmap is kept). */
  cancel() {
    this.job = null;
  }

  clear() {
    this.key = null;
    this.result = null;
    this.job = null;
  }
}
