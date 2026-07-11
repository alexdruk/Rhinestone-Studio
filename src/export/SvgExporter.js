/**
 * SVG exporter.
 *
 * Serializes a StoneLayout as a millimeter-scale SVG document. Per docs/ARCHITECTURE.md,
 * exporters consume StoneLayout and never generate geometry — this module has no knowledge of
 * Project, Layer, or any layer type, and no DOM/Canvas dependency.
 */

import { STONE_COLORS } from '../renderer/StoneColors.js';

function assertPositiveFiniteNumber(value, name) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    throw new TypeError(`stoneLayoutToSvg requires a positive finite ${name}.`);
  }
}

function escapeAttr(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * Serializes one Stone as an SVG `<circle>`, at an optional (xOffsetMm, yOffsetMm) translation —
 * used as-is by `stoneLayoutToSvg()` below (offset 0,0) and reused by
 * `src/export/ProductionSheetExporter.js` (which places stones inside a larger page, optionally
 * mirrored) instead of duplicating this string template. Shared, not layer/type-aware: it only
 * reads the four fields every Stone already carries.
 *
 * @param {import('../geometry/Stone.js').Stone} stone
 * @param {number} [xOffsetMm]
 * @param {number} [yOffsetMm]
 * @returns {string}
 */
export function stoneCircleSvg(stone, xOffsetMm = 0, yOffsetMm = 0) {
  const c = STONE_COLORS[stone.color] || STONE_COLORS.crystal;
  const cx = stone.xMm + xOffsetMm;
  const cy = stone.yMm + yOffsetMm;
  return `<circle cx="${cx.toFixed(3)}" cy="${cy.toFixed(3)}" r="${(stone.sizeMm / 2).toFixed(3)}" fill="${c.fill}" stroke="${c.stroke}" stroke-width="0.12" data-color="${escapeAttr(stone.color)}"/>`;
}

/**
 * @param {import('../geometry/StoneLayout.js').StoneLayout} stoneLayout
 * @param {{widthMm:number,heightMm:number}} canvas
 * @returns {string}
 */
export function stoneLayoutToSvg(stoneLayout, { widthMm, heightMm } = {}) {
  if (!stoneLayout || !Array.isArray(stoneLayout.stones)) {
    throw new TypeError('stoneLayoutToSvg requires a StoneLayout (an object with a stones array).');
  }
  assertPositiveFiniteNumber(widthMm, 'widthMm');
  assertPositiveFiniteNumber(heightMm, 'heightMm');

  let out = `<svg xmlns="http://www.w3.org/2000/svg" width="${widthMm}mm" height="${heightMm}mm" viewBox="0 0 ${widthMm} ${heightMm}">\n<rect width="100%" height="100%" fill="white"/>\n`;
  for (const s of stoneLayout.stones) {
    out += `${stoneCircleSvg(s)}\n`;
  }
  return out + '</svg>';
}
