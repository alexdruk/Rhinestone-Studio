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
 * IMG-008: serializes one traced region record (see src/geometry's resolveImagePolygons()) as an
 * SVG `<path>` — every contour of the record becomes a subpath of the same `d`, closed with `Z`,
 * `fill-rule="evenodd"` so a hole contour nested inside an outer contour of the same colour renders
 * as a hole without this module knowing which contour is which (the same even-odd convention
 * src/geometry/PathBoolean.js's own contour-list consumers already rely on). Coordinates to 3
 * decimals, matching stoneCircleSvg(). Fill/stroke resolve from `STONE_COLORS[colorId]`, falling
 * back to crystal, exactly as stoneCircleSvg() does.
 *
 * @param {{colorId:string,contours:{xMm:number,yMm:number}[][]}} region
 * @returns {string}
 */
export function regionPathSvg(region) {
  const c = STONE_COLORS[region.colorId] || STONE_COLORS.crystal;
  const d = region.contours
    .map((contour) => `M${contour.map((p) => `${p.xMm.toFixed(3)},${p.yMm.toFixed(3)}`).join('L')}Z`)
    .join(' ');
  return `<path d="${d}" fill="${c.fill}" fill-opacity="0.35" stroke="${c.stroke}" stroke-width="0.12" fill-rule="evenodd"/>`;
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

// IMG-008: groups stones by layerId (order of first appearance in stoneLayout.stones), then by
// color sorted ascending, then by sizeMm ascending -- see stoneLayoutToSvg()'s own doc comment.
// Mirrors ProductionSheetExporter.js's computeSizeBreakdown() color-then-size grouping. Within each
// resulting (layerId, color, sizeMm) group, stones keep their relative order from the input array.
function groupStonesForSvg(stones) {
  const layerOrder = [];
  const byLayer = new Map();
  for (const stone of stones) {
    if (!byLayer.has(stone.layerId)) {
      byLayer.set(stone.layerId, []);
      layerOrder.push(stone.layerId);
    }
    byLayer.get(stone.layerId).push(stone);
  }

  const groups = [];
  for (const layerId of layerOrder) {
    const byColor = new Map();
    for (const stone of byLayer.get(layerId)) {
      if (!byColor.has(stone.color)) byColor.set(stone.color, []);
      byColor.get(stone.color).push(stone);
    }
    for (const color of [...byColor.keys()].sort()) {
      const bySize = new Map();
      for (const stone of byColor.get(color)) {
        if (!bySize.has(stone.sizeMm)) bySize.set(stone.sizeMm, []);
        bySize.get(stone.sizeMm).push(stone);
      }
      for (const sizeMm of [...bySize.keys()].sort((a, b) => a - b)) {
        groups.push({ layerId, color, sizeMm, stones: bySize.get(sizeMm) });
      }
    }
  }
  return groups;
}

/**
 * @param {import('../geometry/StoneLayout.js').StoneLayout} stoneLayout
 * @param {{widthMm:number,heightMm:number}} canvas
 * @param {{regions:{layerId:string,colorId:string,contours:{xMm:number,yMm:number}[][]}[]}} [options]
 *   IMG-008: omitted (the default), the document is byte-identical to before this milestone -- a
 *   flat list of `<circle>` elements, one per stone, in `stoneLayout.stones` order. Supplied (even
 *   as `{regions: []}`), the document instead carries a `<g id="regions">` of one `<path>` per
 *   region record (via regionPathSvg(), in the order given) followed by a `<g id="stones">` whose
 *   circles are grouped into nested `<g>` elements by groupStonesForSvg() above -- see
 *   docs/specifications/IMG-008-VectorFirstSvg.md decision 2 for the exact document shape.
 * @returns {string}
 */
export function stoneLayoutToSvg(stoneLayout, { widthMm, heightMm } = {}, options) {
  if (!stoneLayout || !Array.isArray(stoneLayout.stones)) {
    throw new TypeError('stoneLayoutToSvg requires a StoneLayout (an object with a stones array).');
  }
  assertPositiveFiniteNumber(widthMm, 'widthMm');
  assertPositiveFiniteNumber(heightMm, 'heightMm');

  let out = `<svg xmlns="http://www.w3.org/2000/svg" width="${widthMm}mm" height="${heightMm}mm" viewBox="0 0 ${widthMm} ${heightMm}">\n<rect width="100%" height="100%" fill="white"/>\n`;

  if (!options || !Array.isArray(options.regions)) {
    for (const s of stoneLayout.stones) {
      out += `${stoneCircleSvg(s)}\n`;
    }
    return out + '</svg>';
  }

  out += '<g id="regions">\n';
  for (const region of options.regions) {
    out += `<g data-layer="${escapeAttr(region.layerId)}" data-color="${escapeAttr(region.colorId)}">${regionPathSvg(region)}</g>\n`;
  }
  out += '</g>\n<g id="stones">\n';
  for (const group of groupStonesForSvg(stoneLayout.stones)) {
    out += `<g data-layer="${escapeAttr(group.layerId)}" data-color="${escapeAttr(group.color)}" data-size="${group.sizeMm.toFixed(3)}">\n`;
    for (const s of group.stones) {
      out += `${stoneCircleSvg(s)}\n`;
    }
    out += '</g>\n';
  }
  out += '</g>\n';
  return out + '</svg>';
}
