/**
 * Offscreen sprite baking for the Design view's stone-dot preview (rs-design-crystal-dots).
 *
 * Bakes CrystalStoneRenderer.js's faceted-crystal treatment into small offscreen
 * `<canvas>` bitmaps, cached per (colorKey, quantized radius, variant), so
 * DrawingCanvasTool.js can place one paper.SymbolItem per stone instead of running
 * drawCrystalStone()'s full per-stone draw calls against the live Paper.js canvas. Pure
 * canvas-2D + DOM (`document.createElement('canvas')`, same convention as
 * src/image/ImageDecoder.js) -- no Paper.js/paper import here, so this stays testable with
 * a stubbed `document` and the same fake-CanvasRenderingContext2D convention every other
 * renderer test in tools/ already uses.
 *
 * Never derives appearance from a real stone: every sprite is baked from a synthetic,
 * deterministic stand-in stone keyed only by (colorKey, variantIndex) -- see
 * syntheticAppearance() -- so the same (colorKey, radiusBucket, variantIndex) key always
 * bakes pixel-identical output, and no Math.random() is ever used.
 */

import { drawCrystalStone } from '../renderer/CrystalStoneRenderer.js';
import { getCrystalAppearance } from '../renderer/CrystalAppearance.js';

export const VARIANT_COUNT = 4;

// Quantization step for the sprite cache's radius key (px). Reused by DrawingCanvasTool.js so a
// symbol-definition cache keyed the same way collapses onto the exact same sprite entries here,
// rather than drifting out of sync with a second, independently-rounded copy of this constant.
export const RADIUS_BUCKET_PX = 0.5;

// drawCrystalStone()'s furthest overdraw beyond the stone's true radius is its cast shadow: offset
// by rotateOffset(radiusPx*0.22, radiusPx*0.22, angle) (magnitude radiusPx*0.22*sqrt(2) ~= 0.311*
// radiusPx) plus its own radius (radiusPx*1.08) -- a maximum extent of ~1.391*radiusPx from center,
// i.e. a ~2.782*radiusPx bounding diameter. PADDING=1.4 (a 2.8*radiusPx canvas) clears that with a
// hair of margin, and the shadow gradient's alpha is already 0 at its own edge, so even that margin
// is not visually load-bearing.
const PADDING = 1.4;

const spriteCache = new Map();

export function quantizeRadiusPx(radiusPx) {
  return Math.round(radiusPx / RADIUS_BUCKET_PX) * RADIUS_BUCKET_PX;
}

function syntheticAppearance(colorKey, variantIndex) {
  return getCrystalAppearance({
    xMm: variantIndex,
    yMm: 0,
    sizeMm: 1,
    color: colorKey,
    layerId: 'sprite',
    index: variantIndex
  });
}

/**
 * Bakes one sprite canvas for (colorKey, radiusPx, variantIndex), unconditionally (no cache
 * lookup) -- the raw builder getStoneSprite() below caches.
 * @param {string} colorKey
 * @param {number} radiusPx
 * @param {number} variantIndex
 * @returns {HTMLCanvasElement}
 */
export function buildStoneSpriteCanvas(colorKey, radiusPx, variantIndex) {
  const size = Math.max(1, Math.ceil(2 * radiusPx * PADDING));
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  const center = size / 2;
  drawCrystalStone(ctx, center, center, radiusPx, colorKey, syntheticAppearance(colorKey, variantIndex));
  return canvas;
}

/**
 * Cached sprite lookup: same (colorKey, radiusBucket, variantIndex) key always returns the exact
 * same canvas instance (never rebuilt) until clearStoneSpriteCache() runs.
 * @param {string} colorKey
 * @param {number} radiusPx
 * @param {number} variantIndex
 * @returns {HTMLCanvasElement}
 */
export function getStoneSprite(colorKey, radiusPx, variantIndex) {
  const radiusBucket = quantizeRadiusPx(radiusPx);
  const key = `${colorKey}|${radiusBucket}|${variantIndex}`;
  let canvas = spriteCache.get(key);
  if (!canvas) {
    canvas = buildStoneSpriteCanvas(colorKey, radiusBucket, variantIndex);
    spriteCache.set(key, canvas);
  }
  return canvas;
}

/** Clears every cached sprite -- called on a zoom-bucket change so sprites re-bake at the new resolution. */
export function clearStoneSpriteCache() {
  spriteCache.clear();
}

/** Test-only: current cache size, to assert cache-key reuse behavior. */
export function _spriteCacheSizeForTesting() {
  return spriteCache.size;
}
