/**
 * AI exporter (RS-3042, from PatternNifty `src/export/aiExport.js` at e9e7014).
 *
 * One true-size vector PDF page of the stones, built with PdfDocument and saved as `.ai`
 * (Illustrator opens a PDF-compatible file). The page is the design (the stones' footprint box)
 * plus AI_MARGIN_MM on every side, 10 mm in all. Stones are drawn as the production sheet draws
 * them: catalogue fill, catalogue stroke 0.12 mm. No PDF Info dictionary (IS's pdfInfo.js is not
 * ported).
 *
 * Per docs/ARCHITECTURE.md, exporters consume StoneLayout only: no Project, Layer, layer type,
 * GeometryEngine or DOM.
 */

import { STONE_COLORS } from '../renderer/StoneColors.js';
import { PT_PER_MM, PdfDocument } from './PdfDocument.js';

export const AI_MARGIN_MM = 5;
const STROKE_MM = 0.12;

const unitRgb = (hex) => [0, 2, 4].map((i) => parseInt(hex.replace('#', '').slice(i, i + 2), 16) / 255);

/**
 * @param {import('../geometry/StoneLayout.js').StoneLayout} stoneLayout
 * @returns {Uint8Array}
 */
export function stoneLayoutToAi(stoneLayout) {
  if (!stoneLayout || !Array.isArray(stoneLayout.stones) || stoneLayout.stones.length === 0) {
    throw new TypeError('stoneLayoutToAi requires a StoneLayout with at least one stone.');
  }
  const widthMm = stoneLayout.widthMm + 2 * AI_MARGIN_MM;
  const heightMm = stoneLayout.heightMm + 2 * AI_MARGIN_MM;
  const doc = new PdfDocument({ widthPt: widthMm * PT_PER_MM, heightPt: heightMm * PT_PER_MM });
  const toPt = (mm) => mm * PT_PER_MM;
  const box = stoneLayout.getBoundingBox();
  doc.setLineWidth(toPt(STROKE_MM));
  for (const stone of stoneLayout.stones) {
    const c = STONE_COLORS[stone.color] || STONE_COLORS.crystal;
    doc.setFillColor(unitRgb(c.fill));
    doc.setStrokeColor(unitRgb(c.stroke));
    const x = stone.xMm - box.minXmm + AI_MARGIN_MM;
    const y = stone.yMm - box.minYmm + AI_MARGIN_MM;
    doc.drawCircle(toPt(x), toPt(heightMm - y), toPt(stone.sizeMm / 2), { fill: true, stroke: true });
  }
  return doc.toBytes();
}
