/**
 * Production Sheet exporter — RS-1005.
 *
 * Produces a single-page, millimeter-accurate manufacturing document from a StoneLayout: header
 * metadata (project name, object type, production size, stone count/size/color, page/margin/
 * mirror/registration-marks summary), a labeled scale reference bar, optional corner registration
 * marks, and the stone layout itself drawn at true (1:1) size, optionally horizontally mirrored,
 * centered in the printable area (page size minus margins).
 *
 * Per docs/ARCHITECTURE.md, exporters consume StoneLayout and never generate geometry.
 * `computeProductionSheetLayout()` is the single, pure geometry-projection pass both output
 * formats share — it invents no stone position, it only re-projects each already-generated
 * stone.xMm/yMm into page space (a translate for centering, an optional horizontal mirror, both
 * the same category of transform CanvasRenderer2D.fitTransform() already applies for the on-screen
 * canvas). `productionSheetToSvg()`/`productionSheetToPdf()` both render that one computed
 * descriptor; neither recomputes stone positions independently.
 *
 * No DOM/Canvas dependency, no knowledge of Project/Layer/a layer's `type`, no dependency on the
 * permanent stone-generation engine (src/geometry/**).
 */

import { STONE_COLORS } from '../renderer/StoneColors.js';
import { formatStoneSizeLabel } from '../renderer/StoneSizes.js';
import { stoneCircleSvg } from './SvgExporter.js';
import { PdfDocument, PT_PER_MM } from './PdfDocument.js';

export const PAGE_SIZES = Object.freeze({
  A4: Object.freeze({ widthMm: 210, heightMm: 297 }),
  Letter: Object.freeze({ widthMm: 215.9, heightMm: 279.4 })
});

// Fixed layout constants (mm). Kept as named constants, not magic numbers, per this codebase's
// existing convention (see app.js's CUP_ROTATION_SENSITIVITY/ZOOM_MIN/ZOOM_MAX etc.).
const HEADER_TITLE_SIZE_MM = 5.5;
const HEADER_TITLE_SLOT_HEIGHT_MM = 7.5;
const HEADER_LINE_SIZE_MM = 3.4;
const HEADER_LINE_SLOT_HEIGHT_MM = 4.4;
const HEADER_TOP_PADDING_MM = 2;
// Generous enough that the last header line never crowds the production rect's top border or the
// top corner registration marks, which extend REG_MARK_GAP_MM+REG_MARK_ARM_MM above that border.
const HEADER_BOTTOM_PADDING_MM = 10;
// One title line (HEADER_TITLE_SLOT_HEIGHT_MM) + seven body lines (HEADER_LINE_SLOT_HEIGHT_MM),
// plus top/bottom padding -- computed once here so productionSheetToSvg()/productionSheetToPdf()
// never have to duplicate (or risk disagreeing on) this arithmetic.
const HEADER_HEIGHT_MM =
  HEADER_TOP_PADDING_MM + HEADER_TITLE_SLOT_HEIGHT_MM + 7 * HEADER_LINE_SLOT_HEIGHT_MM + HEADER_BOTTOM_PADDING_MM;
const FOOTER_HEIGHT_MM = 16;
const REG_MARK_ARM_MM = 4;
const REG_MARK_GAP_MM = 1.5;
const SCALE_BAR_LENGTH_MM = 50;
const SCALE_BAR_TICK_EVERY_MM = 10;
const SCALE_BAR_HEIGHT_MM = 3;

function assertPositiveFiniteNumber(value, name) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    throw new TypeError(`Production sheet requires a positive finite ${name}.`);
  }
}

function assertNonNegativeFiniteNumber(value, name) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new TypeError(`Production sheet requires a non-negative finite ${name}.`);
  }
}

function roundMm(value) {
  return Math.round(value * 100) / 100;
}

function formatMmList(values) {
  if (!values.length) return '—';
  return values.map((v) => `${roundMm(v)}`).join(', ') + ' mm';
}

// RS-1013: stone sizes get their own formatter (unlike formatMmList(), used unchanged for Gap,
// which has no commercial name) so a size matching the Stone Library (src/renderer/StoneSizes.js)
// reads e.g. "SS16 (4.0 mm)" on the printed sheet -- the production floor's usual vocabulary --
// while a custom, non-catalog size still prints its plain millimeter value.
function formatStoneSizeList(sizesMm) {
  if (!sizesMm.length) return '—';
  return sizesMm.map((v) => formatStoneSizeLabel(v)).join(', ');
}

function distinctStoneSizesMm(stones) {
  const sizes = [...new Set(stones.map((s) => roundMm(s.sizeMm)))].sort((a, b) => a - b);
  return sizes;
}

function distinctCrystalColorNames(stones) {
  const names = [...new Set(stones.map((s) => (STONE_COLORS[s.color] || {}).name || s.color))];
  return names.sort();
}

function normalizeGapMm(gapMm) {
  if (gapMm === null || gapMm === undefined) return [];
  const values = Array.isArray(gapMm) ? gapMm : [gapMm];
  return [...new Set(values.map((v) => roundMm(Number(v))))]
    .filter((v) => Number.isFinite(v))
    .sort((a, b) => a - b);
}

/**
 * Chooses the smallest-fitting orientation (portrait, then landscape) of `pageSize` that leaves a
 * printable area large enough for the required content block at the requested margin. Throws a
 * clear RangeError (never silently rescales — "no scaling" is a hard requirement) when neither
 * orientation fits.
 */
function resolvePageOrientation({ pageSize, marginMm, neededWidthMm, neededHeightMm }) {
  const base = PAGE_SIZES[pageSize];
  const candidates = [
    { orientation: 'portrait', widthMm: base.widthMm, heightMm: base.heightMm },
    { orientation: 'landscape', widthMm: base.heightMm, heightMm: base.widthMm }
  ];
  for (const candidate of candidates) {
    const printableWidthMm = candidate.widthMm - 2 * marginMm;
    const printableHeightMm = candidate.heightMm - 2 * marginMm;
    if (printableWidthMm >= neededWidthMm && printableHeightMm >= neededHeightMm) {
      return { ...candidate, printableWidthMm, printableHeightMm };
    }
  }
  throw new RangeError(
    `Production sheet does not fit ${pageSize} at margin ${marginMm}mm in either orientation ` +
      `(needs ${roundMm(neededWidthMm)}×${roundMm(neededHeightMm)}mm printable area). ` +
      'Reduce the margin, choose a larger page size, or reduce the production size.'
  );
}

/**
 * Computes the full production-sheet layout: page dimensions/orientation, header text lines, the
 * centered production rect, every stone re-projected into page space (centered, optionally
 * mirrored), registration-mark line segments, and the scale-reference bar geometry. Pure function;
 * no rendering. Both `productionSheetToSvg()` and `productionSheetToPdf()` render this one
 * descriptor.
 *
 * @param {import('../geometry/StoneLayout.js').StoneLayout} stoneLayout
 * @param {object} options
 * @param {string} [options.projectName]
 * @param {string} [options.objectType]
 * @param {number} options.productionWidthMm
 * @param {number} options.productionHeightMm
 * @param {number|number[]|null} [options.gapMm]
 * @param {'A4'|'Letter'} [options.pageSize]
 * @param {number} [options.marginMm]
 * @param {boolean} [options.mirror]
 * @param {boolean} [options.registrationMarks]
 * @returns {object}
 */
export function computeProductionSheetLayout(stoneLayout, options = {}) {
  if (!stoneLayout || !Array.isArray(stoneLayout.stones)) {
    throw new TypeError('computeProductionSheetLayout requires a StoneLayout (an object with a stones array).');
  }

  const {
    projectName = 'Untitled Project',
    objectType = '',
    productionWidthMm,
    productionHeightMm,
    gapMm = null,
    pageSize = 'A4',
    marginMm = 10,
    mirror = false,
    registrationMarks = true
  } = options;

  assertPositiveFiniteNumber(productionWidthMm, 'productionWidthMm');
  assertPositiveFiniteNumber(productionHeightMm, 'productionHeightMm');
  if (!Object.prototype.hasOwnProperty.call(PAGE_SIZES, pageSize)) {
    throw new TypeError(`computeProductionSheetLayout: unknown pageSize "${pageSize}". Expected one of ${Object.keys(PAGE_SIZES).join(', ')}.`);
  }
  assertNonNegativeFiniteNumber(marginMm, 'marginMm');
  if (typeof mirror !== 'boolean') {
    throw new TypeError('computeProductionSheetLayout: mirror must be a boolean.');
  }
  if (typeof registrationMarks !== 'boolean') {
    throw new TypeError('computeProductionSheetLayout: registrationMarks must be a boolean.');
  }

  const neededWidthMm = Math.max(productionWidthMm, SCALE_BAR_LENGTH_MM);
  const neededHeightMm = HEADER_HEIGHT_MM + productionHeightMm + FOOTER_HEIGHT_MM;
  const { orientation, widthMm: pageWidthMm, heightMm: pageHeightMm, printableWidthMm, printableHeightMm } =
    resolvePageOrientation({ pageSize, marginMm, neededWidthMm, neededHeightMm });

  const contentBlockHeightMm = neededHeightMm;
  const contentTopMm = marginMm + (printableHeightMm - contentBlockHeightMm) / 2;
  const headerTopMm = contentTopMm;
  const productionRectTopMm = headerTopMm + HEADER_HEIGHT_MM;
  const productionRectLeftMm = marginMm + (printableWidthMm - productionWidthMm) / 2;
  const footerTopMm = productionRectTopMm + productionHeightMm;

  const stoneCount = stoneLayout.stones.length;
  const distinctSizesMm = distinctStoneSizesMm(stoneLayout.stones);
  const distinctColors = distinctCrystalColorNames(stoneLayout.stones);
  const distinctGapsMm = normalizeGapMm(gapMm);

  // Each line's baseline (yMm) is computed once, here, so productionSheetToSvg()/
  // productionSheetToPdf() only ever place text at an already-decided position instead of
  // duplicating (and risking disagreeing on) the same vertical-rhythm arithmetic.
  let headerCursorMm = headerTopMm + HEADER_TOP_PADDING_MM;
  const headerLines = [
    { text: projectName || 'Untitled Project', sizeMm: HEADER_TITLE_SIZE_MM, bold: true, slotHeightMm: HEADER_TITLE_SLOT_HEIGHT_MM },
    { text: `Object: ${objectType || '—'}`, sizeMm: HEADER_LINE_SIZE_MM, slotHeightMm: HEADER_LINE_SLOT_HEIGHT_MM },
    { text: `Production size: ${roundMm(productionWidthMm)} × ${roundMm(productionHeightMm)} mm`, sizeMm: HEADER_LINE_SIZE_MM, slotHeightMm: HEADER_LINE_SLOT_HEIGHT_MM },
    { text: `Stone count: ${stoneCount}`, sizeMm: HEADER_LINE_SIZE_MM, slotHeightMm: HEADER_LINE_SLOT_HEIGHT_MM },
    { text: `Stone size: ${formatStoneSizeList(distinctSizesMm)}`, sizeMm: HEADER_LINE_SIZE_MM, slotHeightMm: HEADER_LINE_SLOT_HEIGHT_MM },
    { text: `Gap: ${formatMmList(distinctGapsMm)}`, sizeMm: HEADER_LINE_SIZE_MM, slotHeightMm: HEADER_LINE_SLOT_HEIGHT_MM },
    { text: `Crystal color: ${distinctColors.length ? distinctColors.join(', ') : '—'}`, sizeMm: HEADER_LINE_SIZE_MM, slotHeightMm: HEADER_LINE_SLOT_HEIGHT_MM },
    {
      text: `Page: ${pageSize} (${orientation}) · Margin: ${roundMm(marginMm)} mm · Mirror: ${mirror ? 'On' : 'Off'} · Registration marks: ${registrationMarks ? 'On' : 'Off'}`,
      sizeMm: HEADER_LINE_SIZE_MM,
      slotHeightMm: HEADER_LINE_SLOT_HEIGHT_MM
    }
  ].map((line) => {
    // Baseline sits near the bottom of the line's own vertical slot (roughly text cap-height
    // above the baseline, matching how both SVG's y="baseline" and PDF's Td-positioned text work).
    const yMm = headerCursorMm + line.slotHeightMm * 0.72;
    headerCursorMm += line.slotHeightMm;
    return { text: line.text, sizeMm: line.sizeMm, bold: Boolean(line.bold), yMm };
  });

  const stones = stoneLayout.stones.map((stone) => {
    const localXMm = mirror ? productionWidthMm - stone.xMm : stone.xMm;
    return {
      xMm: productionRectLeftMm + localXMm,
      yMm: productionRectTopMm + stone.yMm,
      sizeMm: stone.sizeMm,
      color: stone.color
    };
  });

  const rectCorners = [
    { x: productionRectLeftMm, y: productionRectTopMm, dx: -1, dy: -1 },
    { x: productionRectLeftMm + productionWidthMm, y: productionRectTopMm, dx: 1, dy: -1 },
    { x: productionRectLeftMm + productionWidthMm, y: productionRectTopMm + productionHeightMm, dx: 1, dy: 1 },
    { x: productionRectLeftMm, y: productionRectTopMm + productionHeightMm, dx: -1, dy: 1 }
  ];
  const marks = registrationMarks
    ? rectCorners.map(({ x, y, dx, dy }) => ({
        xMm: x,
        yMm: y,
        horizontal: {
          x1Mm: x + dx * REG_MARK_GAP_MM,
          y1Mm: y,
          x2Mm: x + dx * (REG_MARK_GAP_MM + REG_MARK_ARM_MM),
          y2Mm: y
        },
        vertical: {
          x1Mm: x,
          y1Mm: y + dy * REG_MARK_GAP_MM,
          x2Mm: x,
          y2Mm: y + dy * (REG_MARK_GAP_MM + REG_MARK_ARM_MM)
        }
      }))
    : [];

  const scaleReference = {
    xMm: productionRectLeftMm,
    yMm: footerTopMm + 4,
    lengthMm: SCALE_BAR_LENGTH_MM,
    heightMm: SCALE_BAR_HEIGHT_MM,
    tickEveryMm: SCALE_BAR_TICK_EVERY_MM,
    labelYMm: footerTopMm + 4 + SCALE_BAR_HEIGHT_MM + 4,
    captionYMm: footerTopMm + 4 + SCALE_BAR_HEIGHT_MM + 8
  };

  return {
    pageSize,
    orientation,
    pageWidthMm,
    pageHeightMm,
    marginMm,
    mirror,
    registrationMarksEnabled: registrationMarks,
    headerTopMm,
    headerLines,
    productionRect: { xMm: productionRectLeftMm, yMm: productionRectTopMm, widthMm: productionWidthMm, heightMm: productionHeightMm },
    stones,
    stoneCount,
    distinctSizesMm,
    distinctColors,
    distinctGapsMm,
    registrationMarks: marks,
    scaleReference
  };
}

function escapeSvgText(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * @param {import('../geometry/StoneLayout.js').StoneLayout} stoneLayout
 * @param {object} options See computeProductionSheetLayout().
 * @returns {string}
 */
export function productionSheetToSvg(stoneLayout, options = {}) {
  const layout = computeProductionSheetLayout(stoneLayout, options);
  const { pageWidthMm, pageHeightMm } = layout;

  let out =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${pageWidthMm}mm" height="${pageHeightMm}mm" viewBox="0 0 ${pageWidthMm} ${pageHeightMm}">\n` +
    `<rect width="100%" height="100%" fill="white"/>\n`;

  for (const line of layout.headerLines) {
    out += `<text x="${(layout.marginMm + 2).toFixed(3)}" y="${line.yMm.toFixed(3)}" font-family="Helvetica,Arial,sans-serif" font-size="${line.sizeMm}" font-weight="${line.bold ? 'bold' : 'normal'}" fill="#111827">${escapeSvgText(line.text)}</text>\n`;
  }

  const r = layout.productionRect;
  out += `<rect x="${r.xMm.toFixed(3)}" y="${r.yMm.toFixed(3)}" width="${r.widthMm.toFixed(3)}" height="${r.heightMm.toFixed(3)}" fill="none" stroke="#c7cfdb" stroke-width="0.3"/>\n`;

  for (const mark of layout.registrationMarks) {
    for (const seg of [mark.horizontal, mark.vertical]) {
      out += `<line x1="${seg.x1Mm.toFixed(3)}" y1="${seg.y1Mm.toFixed(3)}" x2="${seg.x2Mm.toFixed(3)}" y2="${seg.y2Mm.toFixed(3)}" stroke="#000000" stroke-width="0.2"/>\n`;
    }
  }

  const sr = layout.scaleReference;
  out += `<rect x="${sr.xMm.toFixed(3)}" y="${sr.yMm.toFixed(3)}" width="${sr.lengthMm.toFixed(3)}" height="${sr.heightMm.toFixed(3)}" fill="none" stroke="#000000" stroke-width="0.25"/>\n`;
  for (let t = 0; t <= sr.lengthMm; t += sr.tickEveryMm) {
    out += `<line x1="${(sr.xMm + t).toFixed(3)}" y1="${sr.yMm.toFixed(3)}" x2="${(sr.xMm + t).toFixed(3)}" y2="${(sr.yMm + sr.heightMm).toFixed(3)}" stroke="#000000" stroke-width="0.2"/>\n`;
  }
  out += `<text x="${sr.xMm.toFixed(3)}" y="${sr.labelYMm.toFixed(3)}" font-family="Helvetica,Arial,sans-serif" font-size="2.6" fill="#111827">0mm</text>\n`;
  out += `<text x="${(sr.xMm + sr.lengthMm - 8).toFixed(3)}" y="${sr.labelYMm.toFixed(3)}" font-family="Helvetica,Arial,sans-serif" font-size="2.6" fill="#111827">${sr.lengthMm}mm</text>\n`;
  out += `<text x="${sr.xMm.toFixed(3)}" y="${sr.captionYMm.toFixed(3)}" font-family="Helvetica,Arial,sans-serif" font-size="2.6" fill="#6b7280">Scale reference — must measure exactly ${sr.lengthMm}mm when printed at true size</text>\n`;

  for (const stone of layout.stones) {
    out += `${stoneCircleSvg(stone)}\n`;
  }

  return out + '</svg>';
}

/**
 * @param {import('../geometry/StoneLayout.js').StoneLayout} stoneLayout
 * @param {object} options See computeProductionSheetLayout().
 * @returns {Uint8Array}
 */
export function productionSheetToPdf(stoneLayout, options = {}) {
  const layout = computeProductionSheetLayout(stoneLayout, options);
  const pageWidthPt = layout.pageWidthMm * PT_PER_MM;
  const pageHeightPt = layout.pageHeightMm * PT_PER_MM;
  const doc = new PdfDocument({ widthPt: pageWidthPt, heightPt: pageHeightPt });

  // The layout descriptor is in top-down millimeter page space; PDF is bottom-up points. Flip once
  // here, at the render boundary, not inside computeProductionSheetLayout().
  const toPt = (mm) => mm * PT_PER_MM;
  const flipY = (yMm) => pageHeightPt - toPt(yMm);

  doc.setFillColor([0.07, 0.09, 0.15]);
  for (const line of layout.headerLines) {
    doc.drawText(toPt(layout.marginMm + 2), flipY(line.yMm), line.text, { sizePt: toPt(line.sizeMm) });
  }

  const r = layout.productionRect;
  doc.setStrokeColor([0.78, 0.81, 0.86]);
  doc.setLineWidth(toPt(0.3));
  doc.drawRect(toPt(r.xMm), flipY(r.yMm + r.heightMm), toPt(r.widthMm), toPt(r.heightMm), { stroke: true });

  doc.setStrokeColor([0, 0, 0]);
  doc.setLineWidth(toPt(0.2));
  for (const mark of layout.registrationMarks) {
    for (const seg of [mark.horizontal, mark.vertical]) {
      doc.drawLine(toPt(seg.x1Mm), flipY(seg.y1Mm), toPt(seg.x2Mm), flipY(seg.y2Mm));
    }
  }

  const sr = layout.scaleReference;
  doc.setLineWidth(toPt(0.25));
  doc.drawRect(toPt(sr.xMm), flipY(sr.yMm + sr.heightMm), toPt(sr.lengthMm), toPt(sr.heightMm), { stroke: true });
  doc.setLineWidth(toPt(0.2));
  for (let t = 0; t <= sr.lengthMm; t += sr.tickEveryMm) {
    doc.drawLine(toPt(sr.xMm + t), flipY(sr.yMm), toPt(sr.xMm + t), flipY(sr.yMm + sr.heightMm));
  }
  doc.setFillColor([0.07, 0.09, 0.15]);
  doc.drawText(toPt(sr.xMm), flipY(sr.labelYMm), '0mm', { sizePt: toPt(2.6) });
  doc.drawText(toPt(sr.xMm + sr.lengthMm - 8), flipY(sr.labelYMm), `${sr.lengthMm}mm`, { sizePt: toPt(2.6) });
  doc.setFillColor([0.42, 0.45, 0.5]);
  doc.drawText(toPt(sr.xMm), flipY(sr.captionYMm), `Scale reference - must measure exactly ${sr.lengthMm}mm when printed at true size`, { sizePt: toPt(2.6) });

  for (const stone of layout.stones) {
    const c = STONE_COLORS[stone.color] || STONE_COLORS.crystal;
    const rgb = hexToRgbUnit(c.fill);
    const strokeRgb = hexToRgbUnit(c.stroke);
    doc.setFillColor(rgb);
    doc.setStrokeColor(strokeRgb);
    doc.setLineWidth(toPt(0.12));
    doc.drawCircle(toPt(stone.xMm), flipY(stone.yMm), toPt(stone.sizeMm / 2), { fill: true, stroke: true });
  }

  return doc.toBytes();
}

function hexToRgbUnit(hex) {
  const clean = hex.replace('#', '');
  const r = parseInt(clean.slice(0, 2), 16) / 255;
  const g = parseInt(clean.slice(2, 4), 16) / 255;
  const b = parseInt(clean.slice(4, 6), 16) / 255;
  return [r, g, b];
}
