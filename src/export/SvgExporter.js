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
    const c = STONE_COLORS[s.color] || STONE_COLORS.crystal;
    out += `<circle cx="${s.xMm.toFixed(3)}" cy="${s.yMm.toFixed(3)}" r="${(s.sizeMm / 2).toFixed(3)}" fill="${c.fill}" stroke="${c.stroke}" stroke-width="0.12" data-color="${escapeAttr(s.color)}"/>\n`;
  }
  return out + '</svg>';
}
