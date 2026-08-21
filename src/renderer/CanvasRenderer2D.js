/**
 * 2D production canvas renderer.
 *
 * Draws a StoneLayout onto a CanvasRenderingContext2D. Per docs/ARCHITECTURE.md, the renderer
 * visualizes StoneLayout and never computes geometry: every function here takes millimeter
 * coordinates already present on Stone instances and a viewport transform, and has no knowledge
 * of Project, Layer, or any layer type (text/circle/rectangle/future shapes).
 *
 * Layer-aware editor affordances (selection outline/handles, drag state) are not part of this
 * module — they belong to the application, which does know about layers.
 */

import { STONE_COLORS } from './StoneColors.js';
import { drawCrystalStone } from './CrystalStoneRenderer.js';
import { getCrystalAppearance } from './CrystalAppearance.js';

/**
 * Draw a single stone at an already-transformed pixel position.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} xPx
 * @param {number} yPx
 * @param {number} radiusPx
 * @param {string} colorKey
 * @param {'layout'|'cup'} [style]
 */
export function drawStone(ctx, xPx, yPx, radiusPx, colorKey, style = 'layout') {
  const c = STONE_COLORS[colorKey] || STONE_COLORS.crystal;
  if (style === 'cup') {
    // A faint dark contrast ring keeps light stone colors readable on light cup backgrounds and
    // dark stone colors readable on dark cup backgrounds — the cup preview has no fixed
    // background color (cupColor is configurable), unlike the 2D layout's white canvas.
    ctx.beginPath();
    ctx.ellipse(xPx, yPx, radiusPx * 1.12, radiusPx * 1.12, 0, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(0,0,0,.16)';
    ctx.fill();
  }
  const g = ctx.createRadialGradient(xPx - radiusPx * .35, yPx - radiusPx * .45, radiusPx * .1, xPx, yPx, radiusPx);
  g.addColorStop(0, c.shine);
  g.addColorStop(.45, c.fill);
  g.addColorStop(1, c.accent);
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(xPx, yPx, radiusPx, 0, Math.PI * 2);
  ctx.fill();
  ctx.lineWidth = style === 'cup' ? Math.max(.35, radiusPx * .06) : Math.max(.55, radiusPx * .10);
  ctx.strokeStyle = c.stroke;
  ctx.stroke();
  if (radiusPx > 2.4) {
    ctx.beginPath();
    ctx.moveTo(xPx - radiusPx * .42, yPx);
    ctx.lineTo(xPx, yPx - radiusPx * .42);
    ctx.lineTo(xPx + radiusPx * .42, yPx);
    ctx.lineTo(xPx, yPx + radiusPx * .42);
    ctx.closePath();
    ctx.strokeStyle = 'rgba(255,255,255,.42)';
    ctx.lineWidth = Math.max(.3, radiusPx * .05);
    ctx.stroke();
  }
}

/**
 * Millimeter bounding box -> pixel viewport transform that fits the box, padded, into the
 * viewport while preserving aspect ratio. Matches BoundingBox's field names loosely coupled:
 * accepts either a real BoundingBox (minXmm/minYmm/widthMm/heightMm) or null (empty layout).
 *
 * @param {{minXmm:number,minYmm:number,widthMm:number,heightMm:number}|null} boundingBoxMm
 * @param {number} viewportWidthPx
 * @param {number} viewportHeightPx
 * @param {number} paddingPx
 * @returns {{s:number,ox:number,oy:number}}
 */
export function fitTransform(boundingBoxMm, viewportWidthPx, viewportHeightPx, paddingPx) {
  const b = boundingBoxMm
    ? { x: boundingBoxMm.minXmm, y: boundingBoxMm.minYmm, width: boundingBoxMm.widthMm, height: boundingBoxMm.heightMm }
    : { x: 0, y: 0, width: 0, height: 0 };
  const viewWidthMm = Math.max(70, b.width + 24);
  const viewHeightMm = Math.max(45, b.height + 24);
  const s = Math.min(
    (viewportWidthPx - paddingPx * 2) / viewWidthMm,
    (viewportHeightPx - paddingPx * 2) / viewHeightMm
  );
  const ox = viewportWidthPx / 2 - (b.x + b.width / 2) * s;
  const oy = viewportHeightPx / 2 - (b.y + b.height / 2) * s;
  return { s, ox, oy };
}

const GRID_NICE_STEPS_MM = [0.5, 1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000];
// 8px, not the rounder 20px, so that today's real default project (boot zoom, s ~= 1.79px/mm)
// still resolves to minorStep=5/majorStep=20 -- an exact no-op vs. develop's hardcoded grid.
const GRID_TARGET_MINOR_PX = 8;

/**
 * Pick the minor grid step (mm) whose on-screen spacing at px-per-mm `s` is the smallest
 * step in GRID_NICE_STEPS_MM that is still >= GRID_TARGET_MINOR_PX apart.
 *
 * @param {number} s px-per-mm
 * @returns {number}
 */
function chooseGridMinorStepMm(s) {
  for (const step of GRID_NICE_STEPS_MM) {
    if (step * s >= GRID_TARGET_MINOR_PX) return step;
  }
  return GRID_NICE_STEPS_MM[GRID_NICE_STEPS_MM.length - 1];
}

/**
 * Draw the production-canvas reference grid for a millimeter bounding box.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {{minXmm:number,minYmm:number,widthMm:number,heightMm:number}|null} boundingBoxMm
 * @param {{s:number,ox:number,oy:number}} transform
 */
export function drawGrid(ctx, boundingBoxMm, transform) {
  const b = boundingBoxMm
    ? { x: boundingBoxMm.minXmm, y: boundingBoxMm.minYmm, width: boundingBoxMm.widthMm, height: boundingBoxMm.heightMm }
    : { x: 0, y: 0, width: 0, height: 0 };
  const { s, ox, oy } = transform;
  const minorIdx = GRID_NICE_STEPS_MM.indexOf(chooseGridMinorStepMm(s));
  const minorStep = GRID_NICE_STEPS_MM[minorIdx];
  const majorStep = GRID_NICE_STEPS_MM[Math.min(minorIdx + 2, GRID_NICE_STEPS_MM.length - 1)];
  const gx0 = Math.floor((b.x - 15) / minorStep) * minorStep, gx1 = Math.ceil((b.x + b.width + 15) / minorStep) * minorStep;
  const gy0 = Math.floor((b.y - 15) / minorStep) * minorStep, gy1 = Math.ceil((b.y + b.height + 15) / minorStep) * minorStep;

  ctx.strokeStyle = '#e9eef5';
  ctx.lineWidth = 1;
  for (let x = gx0; x <= gx1; x += minorStep) { ctx.beginPath(); ctx.moveTo(ox + x * s, oy + gy0 * s); ctx.lineTo(ox + x * s, oy + gy1 * s); ctx.stroke(); }
  for (let y = gy0; y <= gy1; y += minorStep) { ctx.beginPath(); ctx.moveTo(ox + gx0 * s, oy + y * s); ctx.lineTo(ox + gx1 * s, oy + y * s); ctx.stroke(); }

  ctx.strokeStyle = '#bcd6ff';
  ctx.lineWidth = 1.5;
  for (let x = Math.floor(gx0 / majorStep) * majorStep; x <= gx1; x += majorStep) { ctx.beginPath(); ctx.moveTo(ox + x * s, oy + gy0 * s); ctx.lineTo(ox + x * s, oy + gy1 * s); ctx.stroke(); }
  for (let y = Math.floor(gy0 / majorStep) * majorStep; y <= gy1; y += majorStep) { ctx.beginPath(); ctx.moveTo(ox + gx0 * s, oy + y * s); ctx.lineTo(ox + gx1 * s, oy + y * s); ctx.stroke(); }
}

/**
 * Draw every stone in a StoneLayout using an already-computed transform.
 *
 * `'layout'` (the default) uses the faceted-crystal treatment (PREVIEW-001) -- the normal
 * artistic preview for the 2D production canvas and thumbnails. `'cup'` is unchanged: CupRenderer
 * calls drawStone() directly for its own per-stone drawing and never goes through this function.
 * `'exact'` is an internal, UI-less diagnostic path (no toggle added -- see PREVIEW-001's report):
 * it draws the original flat-shaded single-arc stone via drawStone(), for callers that need an
 * exact-boundary reference without the decorative facets/sparkle.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {import('../geometry/StoneLayout.js').StoneLayout} stoneLayout
 * @param {{s:number,ox:number,oy:number}} transform
 * @param {'layout'|'cup'|'exact'} [style]
 */
export function renderStoneLayout(ctx, stoneLayout, transform, style = 'layout') {
  const { s, ox, oy } = transform;
  for (const stone of stoneLayout.stones) {
    const xPx = ox + stone.xMm * s;
    const yPx = oy + stone.yMm * s;
    const radiusPx = Math.max(2, stone.sizeMm * s / 2);
    if (style === 'layout') {
      drawCrystalStone(ctx, xPx, yPx, radiusPx, stone.color, getCrystalAppearance(stone));
    } else {
      drawStone(ctx, xPx, yPx, radiusPx, stone.color, style === 'exact' ? 'layout' : style);
    }
  }
}

/**
 * Draw the full 2D production canvas background: clear, fill, fit-to-viewport grid, and every
 * stone in the StoneLayout. Returns the transform used, so the caller can layer layer-aware
 * overlays (selection, HUD text) on top using the exact same mm->px mapping.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {import('../geometry/StoneLayout.js').StoneLayout} stoneLayout
 * @param {{widthPx:number,heightPx:number,paddingPx:number}} viewport
 * @returns {{s:number,ox:number,oy:number}}
 */
export function renderProductionLayout(ctx, stoneLayout, { widthPx, heightPx, paddingPx }) {
  ctx.clearRect(0, 0, widthPx, heightPx);
  ctx.fillStyle = '#fbfdff';
  ctx.fillRect(0, 0, widthPx, heightPx);

  const boundingBoxMm = stoneLayout.getBoundingBox();
  const transform = fitTransform(boundingBoxMm, widthPx, heightPx, paddingPx);

  drawGrid(ctx, boundingBoxMm, transform);
  renderStoneLayout(ctx, stoneLayout, transform, 'layout');

  return transform;
}
