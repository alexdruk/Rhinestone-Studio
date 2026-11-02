// IMG-026Q -- the tinted view of the 2D canvas (src/renderer/TintedView.js, "Background: Tinted").
// Ported from the tinted cases of PatternNifty's tools/test-exports.mjs (IS commit e9e7014, spec
// section 8). See docs/specifications/IMG-026-StrassLayoutService.md, "Tinted view (build Q)".
// The pixel rules run on the pure functions (no canvas in Node); the full render runs against a
// fake canvas that records its calls. Real drawn stones are checked in the browser.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { Stone } from '../src/geometry/Stone.js';
import { StoneLayout } from '../src/geometry/StoneLayout.js';
import { STONE_COLORS } from '../src/renderer/StoneColors.js';
import { renderProductionLayout } from '../src/renderer/CanvasRenderer2D.js';
import { drawCrystalStone } from '../src/renderer/CrystalStoneRenderer.js';
import { getCrystalAppearance } from '../src/renderer/CrystalAppearance.js';
import {
  ENCLOSED_GAP_MAX_MM2, FILL_MARGIN_MM, GAP_RULE, INNER_SHARE, MARGIN_STONES, STONE_LIGHTNESS, TintedViewCache,
  drawTintedStone, gapRgb, keepStoneLightness, lightnessOfHex, lightnessOfRgb, mainDiameterMm, nearestStones,
  renderTintedBitmap, tintPixels
} from '../src/renderer/TintedView.js';
import { assertTestRegistered } from './lib/test-registration-assertions.mjs';

async function test(name, fn) {
  try {
    await fn();
    console.log(`✓ ${name}`);
  } catch (error) {
    console.error(`✗ ${name}`);
    console.error(error);
    process.exitCode = 1;
  }
}

const read = (rel) => readFile(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
const appJs = await read('../app.js');
const indexHtml = await read('../index.html');

const stone = (xMm, yMm, sizeMm, color, index, layerId = 'img') => new Stone({ xMm, yMm, sizeMm, color, layerId, index });
const gapOf = (color) => [...gapRgb(STONE_COLORS[color].fill), 255];

// The pixels of the gap layer (steps 2-4b) for stones on a bitmap covering their box plus
// MARGIN_STONES main diameters, at pxPerMm; at(xMm, yMm) is the RGBA of the pixel containing it.
function gapLayer(stones, pxPerMm, crystalGap = null) {
  const minX = Math.min(...stones.map((s) => s.xMm - s.sizeMm / 2)), maxX = Math.max(...stones.map((s) => s.xMm + s.sizeMm / 2));
  const minY = Math.min(...stones.map((s) => s.yMm - s.sizeMm / 2)), maxY = Math.max(...stones.map((s) => s.yMm + s.sizeMm / 2));
  const m = MARGIN_STONES * mainDiameterMm(stones);
  const geometry = { minXmm: minX - m, minYmm: minY - m, widthPx: Math.round((maxX - minX + 2 * m) * pxPerMm), heightPx: Math.round((maxY - minY + 2 * m) * pxPerMm), scale: pxPerMm };
  const near = nearestStones(stones, { ...geometry, second: Boolean(crystalGap) });
  const data = tintPixels(stones, { ...geometry, near, crystalGap });
  const at = (xMm, yMm) => {
    const x = Math.floor((xMm - geometry.minXmm) * pxPerMm), y = Math.floor((yMm - geometry.minYmm) * pxPerMm);
    const i = (y * geometry.widthPx + x) * 4;
    return { rgba: [...data.subarray(i, i + 4)], centre: [(x + 0.5) / pxPerMm + geometry.minXmm, (y + 0.5) / pxPerMm + geometry.minYmm] };
  };
  return { at, geometry, near, data };
}

// CIE Lab of sRGB (D65), for the hue check.
function lab([r, g, b]) {
  const lin = (v) => { const c = v / 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
  const [R, G, B] = [lin(r), lin(g), lin(b)];
  const X = (0.4124564 * R + 0.3575761 * G + 0.1804375 * B) / 0.95047, Y = 0.2126729 * R + 0.7151522 * G + 0.072175 * B, Z = (0.0193339 * R + 0.119192 * G + 0.9503041 * B) / 1.08883;
  const f = (t) => (t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116);
  return [116 * f(Y) - 16, 500 * (f(X) - f(Y)), 200 * (f(Y) - f(Z))];
}

// A: SS16 (r 2 mm) at x 10; B: SS6 (r 1 mm) at x 14.6 (gap 1.6 mm); C: SS6 alone at x 30 (IS's UNIT).
const UNIT = [stone(10, 10, 4, 'siam', 0), stone(14.6, 10, 2, 'sapphire', 1), stone(30, 10, 2, 'emerald', 2)];

await test('1. a pixel 0.5 mm beyond a stone\'s edge gets its gap colour, 0.7 mm beyond is background (transparent), for every size', () => {
  assert.equal(FILL_MARGIN_MM, 0.6);
  const { at } = gapLayer(UNIT, 40);
  for (const s of UNIT) {
    const edge = (p) => Math.hypot(p.centre[0] - s.xMm, p.centre[1] - s.yMm) - s.sizeMm / 2;
    const in05 = at(s.xMm, s.yMm - s.sizeMm / 2 - 0.5);
    assert.ok(Math.abs(edge(in05) - 0.5) < 0.03, `${s.color} sample at ${edge(in05)} mm`);
    assert.deepEqual(in05.rgba, gapOf(s.color), `${s.color} at 0.5 mm`);
    const out07 = at(s.xMm, s.yMm - s.sizeMm / 2 - 0.7);
    assert.ok(Math.abs(edge(out07) - 0.7) < 0.03);
    assert.deepEqual(out07.rgba, [0, 0, 0, 0], `${s.color} at 0.7 mm: the canvas background shows`);
  }
  // Nearest by edge, not by centre: 2.9 mm right of A is 0.9 mm from A's edge and 0.7 mm from B's.
  assert.deepEqual(at(12.9, 10).rgba, [0, 0, 0, 0]);
  assert.deepEqual(at(12.1, 10).rgba, gapOf('siam'), '0.1 mm from A, 1.5 mm from B');
  assert.deepEqual(at(13.3, 10).rgba, gapOf('sapphire'), '1.3 mm from A, 0.3 mm from B');
});

await test('2. the gap colour rule: a mid colour 4 L* darker, Silver and Crystal 8 (8-bit rounding never makes the step smaller), hue kept; every catalogue colour', () => {
  assert.deepEqual({ ...GAP_RULE }, { minStep: 4, slope: 0.05, fromL: 80, darkBelow: 0, lightAbove: 85, lightMinStep: 8 });
  const step = (id) => lightnessOfHex(STONE_COLORS[id].fill) - lightnessOfRgb(gapRgb(STONE_COLORS[id].fill));
  const mid = lightnessOfHex(STONE_COLORS.sapphire.fill);
  assert.ok(mid > 40 && mid < 80, `sapphire is a mid colour (L* ${mid.toFixed(1)})`);
  assert.ok(step('sapphire') >= 4 && step('sapphire') < 6, `sapphire step ${step('sapphire').toFixed(2)}`);
  for (const id of ['silver', 'crystal', 'crystal-clear']) {
    assert.ok(lightnessOfHex(STONE_COLORS[id].fill) > 85, `${id} is near-white`);
    assert.ok(step(id) >= 8 && step(id) < 10, `${id} step ${step(id).toFixed(2)}`);
  }
  // Hue kept: the gap's Lab hue angle is the fill's (a chromatic colour).
  const hue = (rgb) => { const [, a, b] = lab(rgb); return Math.atan2(b, a) * 180 / Math.PI; };
  const fill = STONE_COLORS.sapphire.fill.match(/\w\w/g).map((h) => parseInt(h, 16));
  assert.ok(Math.abs(hue(fill) - hue(gapRgb(STONE_COLORS.sapphire.fill))) < 3, 'sapphire hue');
  for (const [id, c] of Object.entries(STONE_COLORS)) {
    const l = lightnessOfHex(c.fill);
    const want = Math.max(4 + 0.05 * Math.max(0, l - 80), l > 85 ? 8 : 4);
    assert.ok(step(id) >= want - 1e-9 && step(id) < want + 2, `${id}: step ${step(id).toFixed(2)}, rule ${want.toFixed(2)}`);
  }
});

await test('3. Black & white "crystal" rule: Jet among Crystal gets Crystal\'s gap, between two Jet stones Jet\'s; a Colour layer keeps the nearest stone\'s', () => {
  // Jet at x 10 and Crystal at x 12.4 (SS6, 0.4 mm apart); two Jet at x 20 and 22.4; Jet alone at 40.
  const bw = [stone(10, 10, 2, 'jet', 0), stone(12.4, 10, 2, 'crystal-clear', 1), stone(20, 10, 2, 'jet', 2), stone(22.4, 10, 2, 'jet', 3), stone(40, 10, 2, 'jet', 4)];
  const spots = [[11.15, 10], [21.2, 9.3], [40, 8.7], [40, 8.2]];
  const crystal = gapLayer(bw, 40, new Uint8Array(bw.length).fill(1));
  assert.deepEqual(spots.map(([x, y]) => crystal.at(x, y).rgba), [gapOf('crystal-clear'), gapOf('jet'), gapOf('jet'), [0, 0, 0, 0]]);
  const colour = gapLayer(bw, 40);
  assert.deepEqual(spots.map(([x, y]) => colour.at(x, y).rgba), [gapOf('jet'), gapOf('jet'), gapOf('jet'), [0, 0, 0, 0]]);
});

await test('4. an enclosed speck between stones takes its nearest stone\'s gap colour; a true hole and the outside stay background', () => {
  // Six SS6 Siam stones around an empty centre (pitch 2.1 mm): the centre is 0.5 mm beyond the
  // margin, enclosed, about 0.8 mm2. A ring of SS6 Emerald stones 6 mm from (40, 10) encloses a
  // true hole of about 60 mm2, more than ENCLOSED_GAP_MAX_MM2.
  assert.equal(ENCLOSED_GAP_MAX_MM2, 2 * Math.PI);
  const stones = [];
  for (let k = 0; k < 6; k++) stones.push(stone(10 + 2.1 * Math.cos(k * Math.PI / 3), 10 + 2.1 * Math.sin(k * Math.PI / 3), 2, 'siam', stones.length));
  const n = Math.round(2 * Math.PI * 6 / 2.1);
  for (let k = 0; k < n; k++) stones.push(stone(40 + 6 * Math.cos(2 * Math.PI * k / n), 10 + 6 * Math.sin(2 * Math.PI * k / n), 2, 'emerald', stones.length));
  const { at } = gapLayer(stones, 40);
  const centre = at(10, 10);
  const nearestEdge = Math.min(...stones.map((s) => Math.hypot(s.xMm - centre.centre[0], s.yMm - centre.centre[1]) - 1));
  assert.ok(nearestEdge > FILL_MARGIN_MM, `the speck is beyond the margin (${nearestEdge.toFixed(2)} mm)`);
  assert.deepEqual(centre.rgba, gapOf('siam'), 'the speck is filled');
  assert.deepEqual(at(40, 10).rgba, [0, 0, 0, 0], 'the true hole stays background');
  assert.deepEqual(at(10, 5).rgba, [0, 0, 0, 0], 'outside stays background');
});

// Stones "drawn" as the crystal renderer does, roughly: the fill, a white highlight in the inner
// zone, a darker crescent and a rim in the accent colour, on 8-bit pixels.
function drawnStones(color, pxPerMm) {
  const stones = [];
  for (let r = 0; r < 3; r++) for (let k = 0; k < 3; k++) stones.push(stone(3 + k * 2.1 + (r % 2) * 1.05, 3 + r * 1.82, 2, color, stones.length));
  const widthPx = Math.round(12 * pxPerMm), heightPx = Math.round(10 * pxPerMm);
  const geometry = { minXmm: 0, minYmm: 0, widthPx, heightPx, scale: pxPerMm };
  const near = nearestStones(stones, geometry);
  const data = new Uint8ClampedArray(widthPx * heightPx * 4).fill(255);
  const rgb = (hex) => hex.match(/\w\w/g).map((h) => parseInt(h, 16));
  const c = STONE_COLORS[color];
  for (let p = 0; p < near.owner.length; p++) {
    if (near.owner[p] < 0 || near.best[p] > 0) continue;
    const s = stones[near.owner[p]], x = (p % widthPx + 0.5) / pxPerMm, y = (Math.floor(p / widthPx) + 0.5) / pxPerMm;
    const dx = (x - s.xMm) / (s.sizeMm / 2), dy = (y - s.yMm) / (s.sizeMm / 2), rho = Math.hypot(dx, dy);
    let px = rgb(c.fill);
    if (Math.hypot(dx + 0.35, dy + 0.45) < 0.3) px = [255, 255, 255];
    else if (rho > 0.85) px = rgb(c.accent);
    else if (dx + dy > 0.6) px = px.map((v) => v * 0.7);
    data.set([...px, 255], p * 4);
  }
  return { stones, near, data, widthPx };
}

await test('5. stone lightness after the hold: every stone within 3 L* of its fill, its inner 60 % within 5 (IS limits, rounding included), contrast kept; every catalogue colour', () => {
  assert.deepEqual({ ...STONE_LIGHTNESS }, { whole: 2, inner: 4 });
  for (const pxPerMm of [6, 16]) {
    for (const [id, c] of Object.entries(STONE_COLORS)) {
      const { stones, near, data, widthPx } = drawnStones(id, pxPerMm);
      keepStoneLightness(data, stones, near);
      const target = lightnessOfHex(c.fill);
      for (const s of stones) {
        const R = (s.sizeMm / 2) * pxPerMm, cx = s.xMm * pxPerMm, cy = s.yMm * pxPerMm;
        const all = [], inner = [];
        for (let y = Math.floor(cy - R); y <= cy + R; y++) for (let x = Math.floor(cx - R); x <= cx + R; x++) {
          const d2 = (x + 0.5 - cx) ** 2 + (y + 0.5 - cy) ** 2;
          if (d2 > R * R) continue;
          const q = (y * widthPx + x) * 4;
          all.push(lightnessOfRgb([data[q], data[q + 1], data[q + 2]]));
          if (d2 <= (INNER_SHARE * R) ** 2) inner.push(all.at(-1));
        }
        const mean = (a) => a.reduce((u, v) => u + v, 0) / a.length;
        assert.ok(Math.abs(mean(all) - target) <= 3, `${id} at ${pxPerMm} px/mm: stone L* ${mean(all).toFixed(1)}, fill ${target.toFixed(1)}`);
        assert.ok(Math.abs(mean(inner) - target) <= 5, `${id} at ${pxPerMm} px/mm: inner L* ${mean(inner).toFixed(1)}, fill ${target.toFixed(1)}`);
        all.sort((a, b) => a - b);
        assert.ok(all[Math.floor(all.length * 0.95)] - all[Math.floor(all.length * 0.05)] >= 3, `${id}: the highlight still shows`);
      }
    }
  }
});

// A fake 2D canvas: records arcs/strokes/drawImage, keeps ImageData pixels.
function fakeCanvas(width = 0, height = 0) {
  const calls = { arc: [], stroke: [], drawImage: [], getContextOptions: [] };
  let pixels = new Uint8ClampedArray(width * height * 4);
  const target = {
    arc(x, y, r) { calls.arc.push({ x, y, r }); },
    stroke() { calls.stroke.push({ lineWidth: target.lineWidth, strokeStyle: target.strokeStyle }); },
    createRadialGradient() { return { addColorStop() {} }; },
    createLinearGradient() { return { addColorStop() {} }; },
    createImageData(w, h) { return { width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }; },
    putImageData(img) { pixels = new Uint8ClampedArray(img.data); },
    getImageData(x, y, w, h) { return { width: w, height: h, data: w === width && h === height ? new Uint8ClampedArray(pixels) : new Uint8ClampedArray(w * h * 4) }; },
    drawImage(img, x, y) { calls.drawImage.push({ img, x, y }); },
    measureText() { return { width: 10 }; }
  };
  const ctx = new Proxy(target, {
    get(obj, prop) { return prop in obj ? obj[prop] : () => {}; },
    set(obj, prop, value) { obj[prop] = value; return true; }
  });
  return { width, height, calls, getContext(type, options) { calls.getContextOptions.push(options); return ctx; }, ctx, pixels: () => pixels };
}

const snapshot = (layout) => JSON.stringify(layout.stones.map((s) => s.toJSON()));

await test('6. the view never changes the stones: renderProductionLayout() with Tinted leaves the StoneLayout identical, draws the image layer from the bitmap and other layers as before', () => {
  const stones = [...UNIT, stone(20, 20, 2, 'jet', 3), stone(22.2, 20, 2, 'crystal-clear', 4), stone(50, 30, 2, 'gold', 5, 'text1'), stone(52.1, 30, 2, 'gold', 6, 'text1')];
  const layout = new StoneLayout({ layerId: 'all', stones });
  const before = snapshot(layout);
  const made = [];
  const cache = new TintedViewCache({ createCanvas: (w, h) => { const c = fakeCanvas(w, h); made.push(c); return c; }, schedule: () => assert.fail('a small layout renders within the first slice'), sliceMs: Infinity });
  const main = fakeCanvas(800, 600);
  renderProductionLayout(main.ctx, layout, { widthPx: 800, heightPx: 600, paddingPx: 20, tinted: { cache, layerIds: new Set(['img']), crystalGapLayerIds: new Set(['img']) } });
  assert.equal(snapshot(layout), before, 'the stones are unchanged');
  assert.equal(cache.renders, 1);
  assert.equal(made.length, 1);
  assert.deepEqual(made[0].calls.getContextOptions, [{ willReadFrequently: true }]);
  assert.equal(main.calls.drawImage.length, 1, 'the tinted bitmap is drawn once');
  assert.equal(main.calls.drawImage[0].img, made[0]);
  // On the main canvas only the two text stones are drawn as stones (their body arc).
  const transform = renderProductionLayout(fakeCanvas(800, 600).ctx, layout, { widthPx: 800, heightPx: 600, paddingPx: 20 });
  const bodies = main.calls.arc.filter((a) => stones.some((s) => Math.abs(a.x - (transform.ox + s.xMm * transform.s)) < 1e-6 && Math.abs(a.y - (transform.oy + s.yMm * transform.s)) < 1e-6));
  assert.deepEqual([...new Set(bodies.map((a) => `${a.x},${a.y}`))].length, 2, 'only the text layer\'s stones are drawn on the main canvas');
  // The gap layer in the bitmap is not empty and its stones are the image layer's only.
  assert.ok(made[0].pixels().some((v, i) => i % 4 === 3 && v === 255));
  // The same stones and transform: no new render; the bitmap again.
  renderProductionLayout(fakeCanvas(800, 600).ctx, layout, { widthPx: 800, heightPx: 600, paddingPx: 20, tinted: { cache, layerIds: new Set(['img']), crystalGapLayerIds: new Set(['img']) } });
  assert.equal(cache.renders, 1, 'cached');
  assert.equal(snapshot(layout), before);
  // Without tinted: no bitmap, every stone drawn.
  const plain = fakeCanvas(800, 600);
  renderProductionLayout(plain.ctx, layout, { widthPx: 800, heightPx: 600, paddingPx: 20 });
  assert.equal(plain.calls.drawImage.length, 0);
});

await test('7. the cache: renders in slices and asks for a redraw when done; renders again only when the stones, their rule or the transform change', () => {
  const stones = Array.from({ length: 600 }, (_, i) => stone(2.1 * (i % 30), 2.1 * Math.floor(i / 30), 2, i % 3 ? 'siam' : 'jet', i));
  const queue = [];
  let ready = 0, clock = 0;
  const cache = new TintedViewCache({ createCanvas: (w, h) => fakeCanvas(w, h), schedule: (fn) => queue.push(fn), now: () => (clock += 1), onReady: () => ready++, sliceMs: 3 });
  const view = { s: 5, ox: 20, oy: 20, canvasWidthPx: 400, canvasHeightPx: 300 };
  assert.equal(cache.get(stones, view), null, 'not ready after the first slice');
  assert.equal(cache.get(stones, view), null, 'the same job keeps running');
  let slices = 1;
  while (queue.length) { queue.shift()(); slices++; }
  assert.ok(slices > 2, `rendered in ${slices} slices`);
  assert.equal(ready, 1, 'onReady once');
  const bitmap = cache.get(stones, view);
  assert.ok(bitmap && bitmap.canvas);
  assert.equal(cache.renders, 1);
  assert.equal(cache.get(stones, { ...view }), bitmap, 'cached');
  assert.ok(cache.timing.totalMs > 0 && cache.timing.workMs > 0);
  // Anything that changes the picture starts a new render.
  const changed = [
    stones.map((s, i) => (i === 7 ? stone(s.xMm, s.yMm, s.sizeMm, 'gold', i) : s)),
    stones.map((s, i) => (i === 7 ? stone(s.xMm + 0.1, s.yMm, s.sizeMm, s.color, i) : s)),
    stones.map((s, i) => (i === 7 ? stone(s.xMm, s.yMm, 1.6, s.color, i) : s))
  ];
  for (const next of changed) {
    cache.get(stones, view);
    while (queue.length) queue.shift()();
    assert.equal(cache.get(next, view), null);
    while (queue.length) queue.shift()();
  }
  cache.get(stones, view);
  while (queue.length) queue.shift()();
  assert.equal(cache.get(stones, { ...view, crystalGap: new Uint8Array(stones.length).fill(1) }), null, 'the Black & white rule renders again');
  while (queue.length) queue.shift()();
  for (const other of [{ ...view, s: 6 }, { ...view, ox: 21 }, { ...view, canvasWidthPx: 500 }]) {
    assert.equal(cache.get(stones, other), null, `a new transform renders again: ${JSON.stringify(other)}`);
    while (queue.length) queue.shift()();
  }
  // cancel() drops a render in progress and keeps the last bitmap.
  const last = cache.get(stones, { ...view, canvasWidthPx: 500 });
  assert.ok(last);
  cache.get(stones, { ...view, s: 7 });
  cache.cancel();
  while (queue.length) queue.shift()();
  assert.equal(cache.get(stones, { ...view, canvasWidthPx: 500 }), last);
});

await test('8. a Jet stone above SS6 gets its light rim redrawn at an SS6 stone\'s width; SS6 Jet and other colours are drawn as drawCrystalStone() draws them', () => {
  // Strokes of drawTintedStone() beyond those drawCrystalStone() makes for the same stone.
  const extra = (sizeMm, color, pxPerMm) => {
    const s = stone(10, 10, sizeMm, color, 0), r = (sizeMm / 2) * pxPerMm;
    const tinted = fakeCanvas(), plain = fakeCanvas();
    drawTintedStone(tinted.ctx, s, 100, 100, r, pxPerMm);
    drawCrystalStone(plain.ctx, 100, 100, r, color, getCrystalAppearance(s));
    const plainStyle = (list) => list.map((c) => ({ lineWidth: c.lineWidth, strokeStyle: typeof c.strokeStyle === 'string' ? c.strokeStyle : 'gradient' }));
    assert.deepEqual(plainStyle(tinted.calls.stroke.slice(0, plain.calls.stroke.length)), plainStyle(plain.calls.stroke), 'drawn by drawCrystalStone() first');
    return tinted.calls.stroke.slice(plain.calls.stroke.length);
  };
  const pxPerMm = 30;
  for (const sizeMm of [2.8, 4, 4.7]) {
    const rim = extra(sizeMm, 'jet', pxPerMm);
    assert.equal(rim.length, 1, `Jet ${sizeMm} mm: one more stroke, the narrow rim`);
    assert.equal(rim[0].lineWidth, Math.max(0.45, 1 * pxPerMm * 0.09));
    assert.equal(rim[0].strokeStyle, STONE_COLORS.jet.stroke);
  }
  assert.deepEqual(extra(2, 'jet', pxPerMm), [], 'SS6 Jet is drawn as drawCrystalStone() draws it');
  assert.deepEqual(extra(4.7, 'siam', pxPerMm), [], 'only Jet has a rim lighter than its fill');
  const lighter = Object.entries(STONE_COLORS).filter(([, c]) => lightnessOfHex(c.stroke) > lightnessOfHex(c.fill)).map(([id]) => id);
  assert.deepEqual(lighter, ['jet']);
});

await test('9. renderTintedBitmap(): the bitmap covers the stones plus 2 main diameters, clipped to the canvas', () => {
  const stones = [stone(10, 10, 2, 'siam', 0), stone(20, 15, 2, 'siam', 1), stone(15, 12, 3, 'siam', 2)];
  const r = renderTintedBitmap(stones, { s: 10, ox: 5, oy: 7, canvasWidthPx: 1000, canvasHeightPx: 1000, createCanvas: (w, h) => fakeCanvas(w, h) });
  // Box 9..21 x 9..16 mm, plus 4 mm each side: 5..25 x 5..20 mm -> px 55..255 x 57..207.
  assert.deepEqual([r.xPx, r.yPx, r.canvas.width, r.canvas.height], [55, 57, 200, 150]);
  const clipped = renderTintedBitmap(stones, { s: 10, ox: 5, oy: 7, canvasWidthPx: 150, canvasHeightPx: 1000, createCanvas: (w, h) => fakeCanvas(w, h) });
  assert.deepEqual([clipped.xPx, clipped.canvas.width], [55, 95]);
  assert.equal(renderTintedBitmap([], { s: 10, ox: 0, oy: 0, canvasWidthPx: 100, canvasHeightPx: 100, createCanvas: () => assert.fail() }), null);
});

function extractFunctionSource(source, startMarker) {
  const start = source.indexOf(startMarker);
  assert.ok(start !== -1, `expected to find ${startMarker} in app.js`);
  const braceStart = source.indexOf('{', start);
  let depth = 0;
  for (let i = braceStart; i < source.length; i++) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}') { depth--; if (depth === 0) return source.slice(start, i + 1); }
  }
  throw new Error(`expected the closing brace of ${startMarker}`);
}

await test('10. app.js: Tinted tints every image layer, Black & white ones with the crystal rule; other choices pass nothing; view only, never in exports', async () => {
  const source = extractFunctionSource(appJs, 'function canvasTintedOptions(){');
  const { redrawLookOf } = await import('../src/ui/ImageStudioState.js');
  const run = (value, layers) => new Function('el', 'project', 'tintedViewCache', 'redrawLookOf', `${source}\nreturn canvasTintedOptions();`)(
    () => ({ value }), { layers }, 'CACHE', redrawLookOf);
  const layers = [
    { id: 'colour', type: 'image' }, { id: 'bold', type: 'image', redrawMode: 'bw', redrawBwStyle: 'bold' },
    { id: 'shaded', type: 'image', redrawMode: 'bw', redrawBwStyle: 'shaded' }, { id: 't', type: 'text' }, { id: 'm', type: 'path' }
  ];
  const tinted = run('tinted', layers);
  assert.equal(tinted.cache, 'CACHE');
  assert.deepEqual([...tinted.layerIds], ['colour', 'bold', 'shaded']);
  assert.deepEqual([...tinted.crystalGapLayerIds], ['bold', 'shaded']);
  assert.equal(run('white', layers), null);
  assert.equal(run('product', layers), null);
  const draw = extractFunctionSource(appJs, 'function drawLayout(){');
  assert.ok(draw.includes('backgroundColor:canvasBackgroundColor(),tinted:canvasTintedOptions()'));
  assert.ok(appJs.includes("el('canvasBackground').addEventListener('change',()=>{drawLayout();if(el('canvasBackground').value!=='tinted')tintedViewCache.cancel();"));
  assert.ok(appJs.includes("const tintedViewCache=new TintedViewCache({createCanvas:(w,h)=>{const c=document.createElement('canvas');c.width=w;c.height=h;return c},onReady:()=>drawLayout()});"));
  // Tinted keeps the white background (the canvas around the design).
  const bg = extractFunctionSource(appJs, 'function canvasBackgroundColor(){');
  assert.equal(new Function('el', 'currentObjectTemplate', 'project', `${bg}\nreturn canvasBackgroundColor();`)(() => ({ value: 'tinted' }), () => ({ preview: { kind: 'cylinder' } }), { cupColor: '#1f3556' }), '#fbfdff');
  // Only drawLayout() passes it: no export or other renderProductionLayout() call does.
  assert.equal(appJs.split('canvasTintedOptions()').length - 1, 2, 'its definition and the one call in drawLayout()');
  assert.match(indexHtml, /<option value="tinted">Background: Tinted<\/option><\/select>/);
  for (const file of ['SvgExporter.js', 'ProductionSheetExporter.js', 'DxfExporter.js', 'PdfDocument.js']) {
    const src = await read(`../src/export/${file}`).catch(() => '');
    assert.ok(!src.includes('TintedView'), `${file} does not use the tinted view`);
  }
});

await test('11. exports never show the tinted view: Export PNG and the Combined preview copy the canvas redrawn as on White, then the tinted view is restored', () => {
  const source = extractFunctionSource(appJs, 'function withoutTintedView(capture){');
  const run = (value, active) => {
    const select = { value }, draws = [];
    const fn = new Function('el', 'drawLayout', 'drawingTool', `${source}\nreturn withoutTintedView;`)(() => select, () => draws.push(select.value), { isActive: active });
    const seen = fn(() => select.value);
    return { seen, draws, after: select.value };
  };
  assert.deepEqual(run('tinted', false), { seen: 'white', draws: ['white', 'tinted'], after: 'tinted' });
  assert.deepEqual(run('white', false), { seen: 'white', draws: [], after: 'white' });
  assert.deepEqual(run('product', false), { seen: 'product', draws: [], after: 'product' });
  assert.deepEqual(run('tinted', true), { seen: 'tinted', draws: [], after: 'tinted' }, 'Design draws with Paper.js and shows no tinted view');
  // The value is restored even when the capture throws.
  const select = { value: 'tinted' };
  const fn = new Function('el', 'drawLayout', 'drawingTool', `${source}\nreturn withoutTintedView;`)(() => select, () => {}, { isActive: false });
  assert.throws(() => fn(() => { throw new Error('x'); }));
  assert.equal(select.value, 'tinted');
  assert.ok(appJs.includes("try{withoutTintedView(()=>exportCanvas('rhinestone-layout.png',layoutCanvas))}"));
  assert.ok(appJs.includes("try{withoutTintedView(()=>exportCanvas('rhinestone-combined-preview.png',composeCombinedPreviewCanvas()))}"));
});

await test('12. registration: test-img-026-tinted-view.mjs is in the renderers group and the default suite', () => {
  assertTestRegistered({ filename: 'test-img-026-tinted-view.mjs', group: 'renderers', includedInDefault: true });
});
