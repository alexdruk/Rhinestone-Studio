/**
 * Faceted-crystal stone drawing (PREVIEW-001).
 *
 * Draws one stone as a small faceted crystal instead of a flat dot: colored body, cast shadow,
 * darker lower-edge shading, two contrasting facet chords, a primary specular highlight, a
 * smaller secondary reflection, a crisp outer edge, and -- for a deterministic, restrained subset
 * of stones -- a sparkle glint.
 *
 * Pure Canvas-2D, no DOM/Three.js dependency: `drawCrystalStone()` takes an already-transformed
 * pixel position (matching drawStone()'s existing contract in CanvasRenderer2D.js) and issues only
 * absolute-coordinate ctx calls (arc/ellipse/moveTo/lineTo/gradients), never ctx.translate/rotate.
 * That keeps it testable with the same dependency-free fake CanvasRenderingContext2D convention
 * every other renderer test in tools/ already uses, and lets src/preview3d/StoneLayoutTexture.js
 * reuse this exact function for the 3D preview's baked texture instead of duplicating the look.
 *
 * Rendering-only: never reads or writes anything beyond a stone's xMm/yMm/sizeMm/color and the
 * bounded appearance object from CrystalAppearance.js. Never touches StoneLayout/Stone/geometry.
 */

import { STONE_COLORS } from './StoneColors.js';
import { getCrystalAppearance } from './CrystalAppearance.js';

const TAU = Math.PI * 2;
const MIN_SPARKLE_RADIUS_PX = 1.6;

function clampChannel(v) {
  return Math.max(0, Math.min(255, Math.round(v)));
}

function hexToRgb(hex) {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? h.split('').map((ch) => ch + ch).join('') : h;
  const num = parseInt(full, 16);
  return { r: (num >> 16) & 255, g: (num >> 8) & 255, b: num & 255 };
}

function rgbToHex({ r, g, b }) {
  return '#' + [r, g, b].map((v) => clampChannel(v).toString(16).padStart(2, '0')).join('');
}

// Memoized per (hex, quantized brightness bucket): a production layout typically reuses a small
// number of distinct colors across thousands of stones, and stones land in the same 0.02-wide
// brightness bucket often enough that this avoids redundant hex-parse/multiply work in the
// per-stone hot loop (PREVIEW-001's "avoid expensive allocations ... cache reusable ... assets by
// relevant size/color buckets" requirement) without needing a real canvas/DOM to build bitmap
// sprites -- see the milestone report for why a full sprite cache was not pursued at this scale.
const brightnessCache = new Map();

/**
 * Multiplies a hex color's RGB channels by `factor`, memoized per (hex, quantized factor).
 * @param {string} hex
 * @param {number} factor
 * @returns {string} hex color
 */
export function adjustBrightness(hex, factor) {
  const bucket = Math.round(factor * 50) / 50; // 0.02 steps
  const key = hex + '|' + bucket;
  const cached = brightnessCache.get(key);
  if (cached) return cached;
  const { r, g, b } = hexToRgb(hex);
  const result = rgbToHex({ r: r * bucket, g: g * bucket, b: b * bucket });
  brightnessCache.set(key, result);
  return result;
}

/** Test-only: current memoized-color cache size, to assert cache-key reuse behavior. */
export function _brightnessCacheSizeForTesting() {
  return brightnessCache.size;
}

function rotateOffset(dx, dy, angleRad) {
  const cos = Math.cos(angleRad), sin = Math.sin(angleRad);
  return { x: dx * cos - dy * sin, y: dx * sin + dy * cos };
}

function drawSparkle(ctx, xPx, yPx, radiusPx, intensity) {
  const len = radiusPx * 0.85;
  ctx.beginPath();
  ctx.moveTo(xPx - len, yPx);
  ctx.lineTo(xPx + len, yPx);
  ctx.moveTo(xPx, yPx - len);
  ctx.lineTo(xPx, yPx + len);
  ctx.strokeStyle = `rgba(255,255,255,${(0.55 + 0.35 * intensity).toFixed(3)})`;
  ctx.lineWidth = Math.max(0.3, radiusPx * 0.07);
  ctx.stroke();
}

/**
 * Draw one faceted-crystal stone at an already-transformed pixel position.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} xPx
 * @param {number} yPx
 * @param {number} radiusPx
 * @param {string} colorKey
 * @param {ReturnType<typeof getCrystalAppearance>} appearance
 */
export function drawCrystalStone(ctx, xPx, yPx, radiusPx, colorKey, appearance) {
  const c = STONE_COLORS[colorKey] || STONE_COLORS.crystal;
  const angleRad = (appearance.facetAngleDeg * Math.PI) / 180;

  // Cast shadow -- soft, offset with the stone's own facet angle so it reads as attached to the
  // crystal rather than a fixed light direction repeated identically across every stone.
  const shadowOffset = rotateOffset(radiusPx * 0.22, radiusPx * 0.22, angleRad);
  const shadowR = radiusPx * 1.08;
  const shadowGrad = ctx.createRadialGradient(
    xPx + shadowOffset.x, yPx + shadowOffset.y, 0,
    xPx + shadowOffset.x, yPx + shadowOffset.y, shadowR
  );
  shadowGrad.addColorStop(0, `rgba(15,15,25,${(0.28 * appearance.shadowStrength).toFixed(3)})`);
  shadowGrad.addColorStop(1, 'rgba(15,15,25,0)');
  ctx.fillStyle = shadowGrad;
  ctx.beginPath();
  ctx.arc(xPx + shadowOffset.x, yPx + shadowOffset.y, shadowR, 0, TAU);
  ctx.fill();

  // Crystal body -- preserves the stone's true center/radius exactly (xPx, yPx, radiusPx).
  const highlightOffset = rotateOffset(-radiusPx * 0.35, -radiusPx * 0.45, angleRad);
  const bodyGrad = ctx.createRadialGradient(
    xPx + highlightOffset.x, yPx + highlightOffset.y, radiusPx * 0.08,
    xPx, yPx, radiusPx
  );
  bodyGrad.addColorStop(0, adjustBrightness(c.shine, appearance.brightness));
  bodyGrad.addColorStop(0.5, adjustBrightness(c.fill, appearance.brightness));
  bodyGrad.addColorStop(1, adjustBrightness(c.accent, appearance.brightness));
  ctx.fillStyle = bodyGrad;
  ctx.beginPath();
  ctx.arc(xPx, yPx, radiusPx, 0, TAU);
  ctx.fill();

  // Darker lower-edge shading -- a crescent roughly opposite the highlight, for subtle depth.
  const shadeStart = angleRad + Math.PI * 0.65;
  const shadeEnd = angleRad + Math.PI * 1.35;
  ctx.beginPath();
  ctx.moveTo(xPx, yPx);
  ctx.arc(xPx, yPx, radiusPx * 0.98, shadeStart, shadeEnd);
  ctx.closePath();
  ctx.fillStyle = `rgba(0,0,0,${(0.10 + appearance.shadowStrength * 0.14).toFixed(3)})`;
  ctx.fill();

  // Two contrasting facet chords (one light, one dark) -- the "at least one contrasting facet"
  // faceted-crystal cue.
  const facetA1 = rotateOffset(-radiusPx * 0.62, -radiusPx * 0.05, angleRad);
  const facetA2 = rotateOffset(radiusPx * 0.48, -radiusPx * 0.58, angleRad);
  ctx.beginPath();
  ctx.moveTo(xPx + facetA1.x, yPx + facetA1.y);
  ctx.lineTo(xPx + facetA2.x, yPx + facetA2.y);
  ctx.strokeStyle = 'rgba(255,255,255,0.30)';
  ctx.lineWidth = Math.max(0.3, radiusPx * 0.05);
  ctx.stroke();

  const facetB1 = rotateOffset(-radiusPx * 0.5, radiusPx * 0.42, angleRad);
  const facetB2 = rotateOffset(radiusPx * 0.65, radiusPx * 0.08, angleRad);
  ctx.beginPath();
  ctx.moveTo(xPx + facetB1.x, yPx + facetB1.y);
  ctx.lineTo(xPx + facetB2.x, yPx + facetB2.y);
  ctx.strokeStyle = 'rgba(0,0,0,0.16)';
  ctx.lineWidth = Math.max(0.3, radiusPx * 0.045);
  ctx.stroke();

  // Primary specular highlight.
  ctx.beginPath();
  ctx.ellipse(
    xPx + highlightOffset.x, yPx + highlightOffset.y,
    radiusPx * 0.24, radiusPx * 0.15, angleRad - 0.6, 0, TAU
  );
  ctx.fillStyle = `rgba(255,255,255,${(0.5 + 0.42 * appearance.highlightIntensity).toFixed(3)})`;
  ctx.fill();

  // Secondary reflection -- smaller, dimmer, independently placed.
  const secAngleRad = (appearance.secondaryAngleDeg * Math.PI) / 180;
  const secondaryOffset = rotateOffset(radiusPx * 0.3, 0, secAngleRad);
  ctx.beginPath();
  ctx.ellipse(
    xPx + secondaryOffset.x, yPx + secondaryOffset.y,
    radiusPx * 0.12, radiusPx * 0.08, secAngleRad, 0, TAU
  );
  ctx.fillStyle = `rgba(255,255,255,${(0.16 + 0.24 * appearance.secondaryIntensity).toFixed(3)})`;
  ctx.fill();

  // Crisp outer edge.
  ctx.beginPath();
  ctx.arc(xPx, yPx, radiusPx, 0, TAU);
  ctx.lineWidth = Math.max(0.45, radiusPx * 0.09);
  ctx.strokeStyle = c.stroke;
  ctx.stroke();

  if (appearance.sparkle && radiusPx > MIN_SPARKLE_RADIUS_PX) {
    drawSparkle(ctx, xPx, yPx, radiusPx, appearance.highlightIntensity);
  }
}

/**
 * Draw every stone in a StoneLayout with the faceted-crystal treatment, using an already-computed
 * transform. Mirrors renderStoneLayout()'s {s,ox,oy} transform contract in CanvasRenderer2D.js.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {import('../geometry/StoneLayout.js').StoneLayout} stoneLayout
 * @param {{s:number,ox:number,oy:number}} transform
 */
export function renderCrystalStoneLayout(ctx, stoneLayout, transform) {
  const { s, ox, oy } = transform;
  for (const stone of stoneLayout.stones) {
    const xPx = ox + stone.xMm * s;
    const yPx = oy + stone.yMm * s;
    const radiusPx = Math.max(2, stone.sizeMm * s / 2);
    drawCrystalStone(ctx, xPx, yPx, radiusPx, stone.color, getCrystalAppearance(stone));
  }
}
