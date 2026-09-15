/**
 * DXF exporter (cutting template).
 *
 * Serializes a StoneLayout as a millimeter-scale DXF document for CNC/laser cutting templates.
 * Per docs/ARCHITECTURE.md, exporters consume StoneLayout and never generate geometry — this
 * module has no knowledge of Project, Layer, or any layer type, and no DOM dependency.
 *
 * Y is flipped (`heightMm - yMm`) because DXF is Y-up while StoneLayout is Y-down (matching
 * CanvasRenderer2D.js). Stones are emitted as exact diameters with no cut offset — the template
 * is a positional/sizing reference, not a pre-compensated cutting path. Each distinct crystal
 * color gets its own DXF layer so a cutter/operator can isolate colors.
 */

import { DxfWriter, Units, LWPolylineFlags, point3d } from '@tarikjabiri/dxf';

function assertPositiveFiniteNumber(value, name) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    throw new TypeError(`stoneLayoutToDxf requires a positive finite ${name}.`);
  }
}

/**
 * Derives a DXF layer name for a stone color id. DXF layer/table names are sanitized by the
 * writer, but entity `layerName` references are not — so this sanitized name must always be the
 * one passed to both `addLayer()` and each entity's `layerName` option.
 *
 * @param {string} colorId
 * @returns {string}
 */
export function dxfLayerNameForColor(colorId) {
  return 'STONES_' + String(colorId).toUpperCase().replace(/[^A-Z0-9_-]/g, '_');
}

/**
 * @param {import('../geometry/StoneLayout.js').StoneLayout} stoneLayout
 * @param {{widthMm:number,heightMm:number}} canvas
 * @returns {string}
 */
export function stoneLayoutToDxf(stoneLayout, { widthMm, heightMm } = {}) {
  if (!stoneLayout || !Array.isArray(stoneLayout.stones)) {
    throw new TypeError('stoneLayoutToDxf requires a StoneLayout (an object with a stones array).');
  }
  assertPositiveFiniteNumber(widthMm, 'widthMm');
  assertPositiveFiniteNumber(heightMm, 'heightMm');

  const dxf = new DxfWriter();
  dxf.setUnits(Units.Millimeters);

  dxf.addLayer('CANVAS', 8);
  dxf.addLWPolyline(
    [
      { point: point3d(0, 0) },
      { point: point3d(widthMm, 0) },
      { point: point3d(widthMm, heightMm) },
      { point: point3d(0, heightMm) }
    ],
    { flags: LWPolylineFlags.Closed, layerName: 'CANVAS' }
  );

  const colors = [...new Set(stoneLayout.stones.map((s) => s.color))].sort();
  for (const color of colors) {
    dxf.addLayer(dxfLayerNameForColor(color), 7);
  }

  for (const s of stoneLayout.stones) {
    dxf.addCircle(point3d(s.xMm, heightMm - s.yMm, 0), s.sizeMm / 2, { layerName: dxfLayerNameForColor(s.color) });
  }

  return dxf.stringify();
}
