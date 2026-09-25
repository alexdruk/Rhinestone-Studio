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
 * RS-3041: a sheet too big for one page is tiled by `computeProductionSheetDocument()` into a cover
 * page plus true-size tile pages, rendered by `productionSheetToPdf()` only; SVG (and PNG, which
 * goes through SVG) stays one page and asks for a PDF export instead.
 *
 * No DOM/Canvas dependency, no knowledge of Project/Layer/a layer's `type`, no dependency on the
 * permanent stone-generation engine (src/geometry/**).
 */

import { STONE_COLORS } from '../renderer/StoneColors.js';
import { formatStoneSizeLabel } from '../renderer/StoneSizes.js';
import { stoneCircleSvg } from './SvgExporter.js';
import { PdfDocument, PT_PER_MM } from './PdfDocument.js';
import { formatLengthDisplay, unitSuffix } from '../units/index.js';

// S-112: A3 joins A4/Letter -- the Round Dinner Plate's production rect (up to 300mm square, per
// the JSON's outerDiameterMm range) plus header/footer does not fit A4 or Letter at any margin in
// either orientation (this module's own "no scaling — hard requirement" policy, unchanged, throws a
// clear RangeError for that case, exactly as intended); A3 is real, commonly available print stock
// large-format production sheets already use, so it is added as a genuine additional page-size
// option, not a rescaling workaround. A4/Letter's own behavior and every pre-existing size/fit
// check is untouched.
export const PAGE_SIZES = Object.freeze({
  A4: Object.freeze({ widthMm: 210, heightMm: 297 }),
  Letter: Object.freeze({ widthMm: 215.9, heightMm: 279.4 }),
  A3: Object.freeze({ widthMm: 297, heightMm: 420 })
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
// One title line (HEADER_TITLE_SLOT_HEIGHT_MM) + a variable number of body lines
// (HEADER_LINE_SLOT_HEIGHT_MM each), plus top/bottom padding. Seven body lines are always present
// (Object/Production size/Stone count/Stone size/Gap/Crystal color/Page-Margin-Mirror-Registration);
// S-112 adds six more, only when the active object template is the Round Dinner Plate (see
// computePlateHeaderLineTexts() below) -- computeHeaderHeightMm() is the one place this arithmetic
// lives, so productionSheetToSvg()/productionSheetToPdf() never have to duplicate (or risk
// disagreeing on) it, exactly like before this milestone when it was a fixed constant.
const HEADER_BODY_LINE_COUNT = 7;
function computeHeaderHeightMm(extraBodyLineCount) {
  return HEADER_TOP_PADDING_MM + HEADER_TITLE_SLOT_HEIGHT_MM + (HEADER_BODY_LINE_COUNT + extraBodyLineCount) * HEADER_LINE_SLOT_HEIGHT_MM + HEADER_BOTTOM_PADDING_MM;
}
const FOOTER_HEIGHT_MM = 16;
const REG_MARK_ARM_MM = 4;
const REG_MARK_GAP_MM = 1.5;
const SCALE_BAR_LENGTH_MM = 50;
const SCALE_BAR_TICK_EVERY_MM = 10;
const SCALE_BAR_HEIGHT_MM = 3;

// RS-3041: multi-page tiling (docs/specifications/RS-3041-MultiPageSheets.md). A tile page has a
// TILE_LABEL_HEIGHT_MM label line on top, the tile's cell below it framed by an OVERLAP_MM band on
// every side (where the ghost stones of neighbouring pages are drawn), and FOOTER_HEIGHT_MM for the
// scale bar at the bottom.
const TILE_LABEL_HEIGHT_MM = 8;
const OVERLAP_MM = 8;
const COVER_MAP_MIN_HEIGHT_MM = 40;
const COVER_MAP_CAPTION_SLOT_MM = 6;
const COVER_MAP_LABEL_SIZE_MM = 3.4;
const CUT_LINE_DASH_MM = [2, 1.5];
const CUT_LINE_STROKE_WIDTH_MM = 0.25;
const GHOST_STROKE_RGB = [0.75, 0.77, 0.8];
const GHOST_STROKE_WIDTH_MM = 0.15;
const MAP_STROKE_RGB = [0.45, 0.5, 0.58];

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

function formatMmList(values, units) {
  if (!values.length) return '—';
  return values.map((v) => formatLengthDisplay(v, units)).join(', ') + ` ${unitSuffix(units)}`;
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

// S-200 (Mixed Stone-Size Layouts): groups stones by color, then by size ascending within each
// color -- the "Production Sheet must automatically group quantities" requirement's exact worked
// example shape (e.g. Blue / SS6: 142 / SS10: 1856 / SS16: 48). Always computed, not gated on more
// than one size/color being present, so its counts are independently checkable against
// distinctSizesMm/stoneCount on every sheet, mixed-size or not. One O(stoneCount) pass building
// nested Maps, not O(n^2).
function computeSizeBreakdown(stones) {
  const byColor = new Map();
  for (const stone of stones) {
    const colorName = (STONE_COLORS[stone.color] || {}).name || stone.color;
    const sizeMm = roundMm(stone.sizeMm);
    if (!byColor.has(colorName)) byColor.set(colorName, new Map());
    const sizes = byColor.get(colorName);
    sizes.set(sizeMm, (sizes.get(sizeMm) || 0) + 1);
  }

  const breakdown = [];
  for (const colorName of [...byColor.keys()].sort()) {
    const sizes = byColor.get(colorName);
    for (const sizeMm of [...sizes.keys()].sort((a, b) => a - b)) {
      breakdown.push({ colorName, sizeMm, sizeLabel: formatStoneSizeLabel(sizeMm), count: sizes.get(sizeMm) });
    }
  }
  return breakdown;
}

// S-200: renders computeSizeBreakdown()'s groups as extra header body lines -- one line per color,
// listing every distinct size present in that color and its count (e.g. "Blue: SS6 (2 mm): 142,
// SS10 (2.8 mm): 1856, SS16 (4 mm): 48"). One line per color (not one line per size) is a
// deliberate space budget choice: computeHeaderHeightMm()'s existing "no scaling — hard
// requirement" policy (resolvePageOrientation() throws rather than shrink content) means every
// extra header line narrows which page sizes/margins a production sheet still fits, and a project
// with several crystal colors already in use (fully possible before this milestone, via per-layer
// color choice) must not need more page room just because this milestone's grouping feature now
// exists. Mirrors S-112's computePlateHeaderLineTexts() -> computeHeaderHeightMm(extraBodyLineCount)
// integration -- no new page-layout/height-budgeting mechanism, same fixed-slot-height text
// rendering SVG/PDF already share for every other header line.
function computeSizeBreakdownLineTexts(breakdown) {
  const byColor = new Map();
  for (const entry of breakdown) {
    if (!byColor.has(entry.colorName)) byColor.set(entry.colorName, []);
    byColor.get(entry.colorName).push(`${entry.sizeLabel}: ${entry.count}`);
  }
  return [...byColor.entries()].map(([colorName, parts]) => ({ text: `${colorName}: ${parts.join(', ')}`, bold: false }));
}

function normalizeGapMm(gapMm) {
  if (gapMm === null || gapMm === undefined) return [];
  const values = Array.isArray(gapMm) ? gapMm : [gapMm];
  return [...new Set(values.map((v) => roundMm(Number(v))))]
    .filter((v) => Number.isFinite(v))
    .sort((a, b) => a - b);
}

// S-112: builds the Round Dinner Plate's extra header line texts from plain, optional
// caller-supplied fields (app.js's currentProductionSheetOptions() only populates them while the
// plate template is active) -- returns [] for every other object template, so the header falls back
// to exactly its pre-S-112 seven body lines and computeHeaderHeightMm(0) reproduces the old fixed
// HEADER_HEIGHT_MM constant byte-for-byte. Mirrors this module's existing "label + '—' fallback"
// convention (see the Gap/Crystal color lines above) for any individual field that happens to be
// missing while plateOuterDiameterMm (the field that gates whether these lines appear at all) is
// present.
function computePlateHeaderLineTexts(options) {
  const { plateDesignTarget, plateOuterDiameterMm, plateInnerWellDiameterMm, plateRimWidthMm, plateOverallHeightMm, plateWeightGrams, plateColorName, units } = options;
  if (plateOuterDiameterMm == null) return [];
  const suffix = unitSuffix(units);
  return [
    `Design target: ${plateDesignTarget || '—'}`,
    `Outer diameter (incl. rim): ${formatLengthDisplay(plateOuterDiameterMm, units)} ${suffix}`,
    `Inner well diameter: ${plateInnerWellDiameterMm != null ? `${formatLengthDisplay(plateInnerWellDiameterMm, units)} ${suffix}` : '—'}`,
    `Rim width: ${plateRimWidthMm != null ? `${formatLengthDisplay(plateRimWidthMm, units)} ${suffix}` : '—'}`,
    `Overall height: ${plateOverallHeightMm != null ? `${formatLengthDisplay(plateOverallHeightMm, units)} ${suffix}` : '—'}`,
    `Plate color: ${plateColorName || '—'} · Approx. weight: ${plateWeightGrams != null ? `${roundMm(plateWeightGrams)} g` : '—'}`
  ];
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

// RS-3038: how many stones fall outside the production area -- a stone's extent is its center +-
// half its size, so this is the same "no scaling, hard fit" geometry as the page-fit check above,
// just against project.canvas instead of the page. A 1e-6mm tolerance keeps a stone that exactly
// touches an edge (extent === the boundary) counted as inside, immune to float noise.
const OUTSIDE_PRODUCTION_AREA_TOLERANCE_MM = 1e-6;

/**
 * @param {import('../geometry/StoneLayout.js').StoneLayout} stoneLayout
 * @param {number} widthMm Production area width (project.canvas.width), in millimeters.
 * @param {number} heightMm Production area height (project.canvas.height), in millimeters.
 * @returns {number} Count of stones not wholly inside [0,widthMm] x [0,heightMm].
 */
export function countStonesOutsideProductionArea(stoneLayout, widthMm, heightMm) {
  let count = 0;
  for (const stone of stoneLayout.stones) {
    const half = stone.sizeMm / 2;
    const left = stone.xMm - half;
    const right = stone.xMm + half;
    const top = stone.yMm - half;
    const bottom = stone.yMm + half;
    const inside =
      left >= -OUTSIDE_PRODUCTION_AREA_TOLERANCE_MM &&
      top >= -OUTSIDE_PRODUCTION_AREA_TOLERANCE_MM &&
      right <= widthMm + OUTSIDE_PRODUCTION_AREA_TOLERANCE_MM &&
      bottom <= heightMm + OUTSIDE_PRODUCTION_AREA_TOLERANCE_MM;
    if (!inside) count += 1;
  }
  return count;
}

// The header's text lines, each with its baseline already placed. Shared by the single-page sheet
// and RS-3041's cover page, which appends its "Pages:" line through extraLineTexts.
function buildHeaderLines(headerTopMm, fields, extraLineTexts = []) {
  const {
    projectName, objectType, productionWidthMm, productionHeightMm, units, stoneCount, distinctSizesMm,
    distinctGapsMm, distinctColors, pageSize, orientation, marginMm, mirror, registrationMarks,
    plateHeaderLineTexts, sizeBreakdownLines
  } = fields;
  // Each line's baseline (yMm) is computed once, here, so productionSheetToSvg()/
  // productionSheetToPdf() only ever place text at an already-decided position instead of
  // duplicating (and risking disagreeing on) the same vertical-rhythm arithmetic.
  let headerCursorMm = headerTopMm + HEADER_TOP_PADDING_MM;
  return [
    { text: projectName || 'Untitled Project', sizeMm: HEADER_TITLE_SIZE_MM, bold: true, slotHeightMm: HEADER_TITLE_SLOT_HEIGHT_MM },
    { text: `Object: ${objectType || '—'}`, sizeMm: HEADER_LINE_SIZE_MM, slotHeightMm: HEADER_LINE_SLOT_HEIGHT_MM },
    { text: `Production size: ${formatLengthDisplay(productionWidthMm, units)} × ${formatLengthDisplay(productionHeightMm, units)} ${unitSuffix(units)}`, sizeMm: HEADER_LINE_SIZE_MM, slotHeightMm: HEADER_LINE_SLOT_HEIGHT_MM },
    { text: `Stone count: ${stoneCount}`, sizeMm: HEADER_LINE_SIZE_MM, slotHeightMm: HEADER_LINE_SLOT_HEIGHT_MM },
    { text: `Stone size: ${formatStoneSizeList(distinctSizesMm)}`, sizeMm: HEADER_LINE_SIZE_MM, slotHeightMm: HEADER_LINE_SLOT_HEIGHT_MM },
    { text: `Gap: ${formatMmList(distinctGapsMm, units)}`, sizeMm: HEADER_LINE_SIZE_MM, slotHeightMm: HEADER_LINE_SLOT_HEIGHT_MM },
    { text: `Crystal color: ${distinctColors.length ? distinctColors.join(', ') : '—'}`, sizeMm: HEADER_LINE_SIZE_MM, slotHeightMm: HEADER_LINE_SLOT_HEIGHT_MM },
    {
      text: `Page: ${pageSize} (${orientation}) · Margin: ${formatLengthDisplay(marginMm, units)} ${unitSuffix(units)} · Mirror: ${mirror ? 'On' : 'Off'} · Registration marks: ${registrationMarks ? 'On' : 'Off'}`,
      sizeMm: HEADER_LINE_SIZE_MM,
      slotHeightMm: HEADER_LINE_SLOT_HEIGHT_MM
    },
    // S-112: [] for every non-plate template (computePlateHeaderLineTexts() above) -- headerHeightMm
    // was already sized to include exactly this many extra lines, so this can never overflow into
    // the production rect below.
    ...plateHeaderLineTexts.map((text) => ({ text, sizeMm: HEADER_LINE_SIZE_MM, slotHeightMm: HEADER_LINE_SLOT_HEIGHT_MM })),
    // S-200: per-color/per-size quantity breakdown -- headerHeightMm above already includes
    // sizeBreakdownLines.length, so this can never overflow into the production rect below either.
    ...sizeBreakdownLines.map((line) => ({ text: line.text, bold: line.bold, sizeMm: HEADER_LINE_SIZE_MM, slotHeightMm: HEADER_LINE_SLOT_HEIGHT_MM })),
    // RS-3041: the cover page's "Pages:" line -- [] on a single-page sheet.
    ...extraLineTexts.map((text) => ({ text, sizeMm: HEADER_LINE_SIZE_MM, slotHeightMm: HEADER_LINE_SLOT_HEIGHT_MM }))
  ].map((line) => {
    // Baseline sits near the bottom of the line's own vertical slot (roughly text cap-height
    // above the baseline, matching how both SVG's y="baseline" and PDF's Td-positioned text work).
    const yMm = headerCursorMm + line.slotHeightMm * 0.72;
    headerCursorMm += line.slotHeightMm;
    return { text: line.text, sizeMm: line.sizeMm, bold: Boolean(line.bold), yMm };
  });
}

// Registration marks at the four corners of a rect: each an L of two short arms pointing away from
// the rect, REG_MARK_GAP_MM clear of the corner itself.
function cornerRegistrationMarks(leftMm, topMm, widthMm, heightMm) {
  const rectCorners = [
    { x: leftMm, y: topMm, dx: -1, dy: -1 },
    { x: leftMm + widthMm, y: topMm, dx: 1, dy: -1 },
    { x: leftMm + widthMm, y: topMm + heightMm, dx: 1, dy: 1 },
    { x: leftMm, y: topMm + heightMm, dx: -1, dy: 1 }
  ];
  return rectCorners.map(({ x, y, dx, dy }) => ({
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
  }));
}

function scaleReferenceAt(xMm, footerTopMm) {
  return {
    xMm,
    yMm: footerTopMm + 4,
    lengthMm: SCALE_BAR_LENGTH_MM,
    heightMm: SCALE_BAR_HEIGHT_MM,
    tickEveryMm: SCALE_BAR_TICK_EVERY_MM,
    labelYMm: footerTopMm + 4 + SCALE_BAR_HEIGHT_MM + 4,
    captionYMm: footerTopMm + 4 + SCALE_BAR_HEIGHT_MM + 8
  };
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
 * @param {'mm'|'in'} [options.units] Display unit for header text only -- geometry and the
 *   scale-reference bar are always real millimeters regardless of this option.
 * @param {string} [options.plateDesignTarget] S-112: Round Dinner Plate only -- see
 *   computePlateHeaderLineTexts(). Omitted (or options.plateOuterDiameterMm omitted) for every
 *   other object template, which adds zero extra header lines.
 * @param {number} [options.plateOuterDiameterMm]
 * @param {number} [options.plateInnerWellDiameterMm]
 * @param {number} [options.plateRimWidthMm]
 * @param {number} [options.plateOverallHeightMm]
 * @param {number} [options.plateWeightGrams]
 * @param {string} [options.plateColorName]
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
    registrationMarks = true,
    units = 'mm'
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

  const plateHeaderLineTexts = computePlateHeaderLineTexts({ ...options, units });
  const sizeBreakdown = computeSizeBreakdown(stoneLayout.stones);
  const sizeBreakdownLines = computeSizeBreakdownLineTexts(sizeBreakdown);
  const headerHeightMm = computeHeaderHeightMm(plateHeaderLineTexts.length + sizeBreakdownLines.length);

  const neededWidthMm = Math.max(productionWidthMm, SCALE_BAR_LENGTH_MM);
  const neededHeightMm = headerHeightMm + productionHeightMm + FOOTER_HEIGHT_MM;
  const { orientation, widthMm: pageWidthMm, heightMm: pageHeightMm, printableWidthMm, printableHeightMm } =
    resolvePageOrientation({ pageSize, marginMm, neededWidthMm, neededHeightMm });

  const contentBlockHeightMm = neededHeightMm;
  const contentTopMm = marginMm + (printableHeightMm - contentBlockHeightMm) / 2;
  const headerTopMm = contentTopMm;
  const productionRectTopMm = headerTopMm + headerHeightMm;
  const productionRectLeftMm = marginMm + (printableWidthMm - productionWidthMm) / 2;
  const footerTopMm = productionRectTopMm + productionHeightMm;

  const stoneCount = stoneLayout.stones.length;
  const distinctSizesMm = distinctStoneSizesMm(stoneLayout.stones);
  const distinctColors = distinctCrystalColorNames(stoneLayout.stones);
  const distinctGapsMm = normalizeGapMm(gapMm);

  const headerLines = buildHeaderLines(headerTopMm, {
    projectName, objectType, productionWidthMm, productionHeightMm, units, stoneCount, distinctSizesMm,
    distinctGapsMm, distinctColors, pageSize, orientation, marginMm, mirror, registrationMarks,
    plateHeaderLineTexts, sizeBreakdownLines
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

  const marks = registrationMarks
    ? cornerRegistrationMarks(productionRectLeftMm, productionRectTopMm, productionWidthMm, productionHeightMm)
    : [];

  const scaleReference = scaleReferenceAt(productionRectLeftMm, footerTopMm);

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
    // S-200: per-color/per-size quantity groups (see computeSizeBreakdown()) -- raw data for
    // callers/tests, independent of the rendered sizeBreakdownLines already folded into headerLines
    // above.
    sizeBreakdown,
    registrationMarks: marks,
    scaleReference
  };
}

// RS-3041 D3: the tile grid, portrait first then landscape, fewest pages wins (strict less-than, so
// a tie stays portrait). Every page of the document uses the chosen orientation.
function resolveTileGrid({ pageSize, marginMm, productionWidthMm, productionHeightMm }) {
  const base = PAGE_SIZES[pageSize];
  const candidates = [
    { orientation: 'portrait', widthMm: base.widthMm, heightMm: base.heightMm },
    { orientation: 'landscape', widthMm: base.heightMm, heightMm: base.widthMm }
  ];
  let best = null;
  for (const candidate of candidates) {
    const cellWidthMm = candidate.widthMm - 2 * marginMm - 2 * OVERLAP_MM;
    const cellHeightMm = candidate.heightMm - 2 * marginMm - TILE_LABEL_HEIGHT_MM - FOOTER_HEIGHT_MM - 2 * OVERLAP_MM;
    if (cellWidthMm <= 0 || cellHeightMm <= 0) continue;
    const cols = Math.ceil(productionWidthMm / cellWidthMm);
    const rows = Math.ceil(productionHeightMm / cellHeightMm);
    if (!best || cols * rows < best.cols * best.rows) {
      best = { ...candidate, cellWidthMm, cellHeightMm, cols, rows };
    }
  }
  if (!best) {
    throw new RangeError(
      `Production sheet does not fit ${pageSize} at margin ${marginMm}mm, even split across pages. ` +
        'Reduce the margin or choose a larger page size.'
    );
  }
  return best;
}

// RS-3041 D7: rows lettered top to bottom, columns numbered left to right as printed.
function tileName(row, col) {
  return `${String.fromCharCode(65 + row)}${col + 1}`;
}

/**
 * RS-3041: the whole Production Sheet document. A sheet that fits one page is returned exactly as
 * computeProductionSheetLayout() computes it, as `{ multiPage: false, pages: [layout] }`. Only when
 * that single page does not fit does this tile the production area across a cover page plus
 * `cols * rows` true-size tile pages (docs/specifications/RS-3041-MultiPageSheets.md). Like
 * computeProductionSheetLayout(), it only re-projects each stone's xMm/yMm; no stone moves.
 *
 * @param {import('../geometry/StoneLayout.js').StoneLayout} stoneLayout
 * @param {object} options See computeProductionSheetLayout().
 * @returns {object}
 */
export function computeProductionSheetDocument(stoneLayout, options = {}) {
  try {
    return { multiPage: false, pages: [computeProductionSheetLayout(stoneLayout, options)] };
  } catch (error) {
    // Input validation throws TypeError before the page-fit check, so a RangeError here is always
    // the one-page fit failure.
    if (!(error instanceof RangeError)) throw error;
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
    registrationMarks = true,
    units = 'mm'
  } = options;

  const grid = resolveTileGrid({ pageSize, marginMm, productionWidthMm, productionHeightMm });
  const { orientation, widthMm: pageWidthMm, heightMm: pageHeightMm, cellWidthMm, cellHeightMm, cols, rows } = grid;
  const tileCount = cols * rows;
  const tileWidthMm = productionWidthMm / cols;
  const tileHeightMm = productionHeightMm / rows;
  const printableWidthMm = pageWidthMm - 2 * marginMm;
  const printableHeightMm = pageHeightMm - 2 * marginMm;

  // D4 then D5: mirror first, then each stone is owned by exactly one tile. Clamping keeps a stone
  // outside the production area (RS-3038) on an edge tile.
  const sourceStones = stoneLayout.stones;
  const mirroredXMm = sourceStones.map((stone) => (mirror ? productionWidthMm - stone.xMm : stone.xMm));
  const clamp = (value, max) => Math.min(Math.max(value, 0), max);
  const ownerCol = mirroredXMm.map((x) => clamp(Math.floor(x / tileWidthMm), cols - 1));
  const ownerRow = sourceStones.map((stone) => clamp(Math.floor(stone.yMm / tileHeightMm), rows - 1));

  const cellLeftMm = marginMm + OVERLAP_MM;
  const cellTopMm = marginMm + TILE_LABEL_HEIGHT_MM + OVERLAP_MM;
  const tileLeftMm = cellLeftMm + (cellWidthMm - tileWidthMm) / 2;
  const tileTopMm = cellTopMm + (cellHeightMm - tileHeightMm) / 2;
  const footerTopMm = pageHeightMm - marginMm - FOOTER_HEIGHT_MM;
  const labelYMm = marginMm + TILE_LABEL_HEIGHT_MM * 0.72;

  const tiles = [];
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      const originXMm = col * tileWidthMm;
      const originYMm = row * tileHeightMm;
      const toPage = (index) => ({
        xMm: tileLeftMm + mirroredXMm[index] - originXMm,
        yMm: tileTopMm + sourceStones[index].yMm - originYMm,
        sizeMm: sourceStones[index].sizeMm,
        color: sourceStones[index].color
      });
      const ownedStoneIndices = [];
      const ghostStoneIndices = [];
      for (let index = 0; index < sourceStones.length; index += 1) {
        if (ownerCol[index] === col && ownerRow[index] === row) {
          ownedStoneIndices.push(index);
          continue;
        }
        // D6: a neighbour's stone whose centre lies within OVERLAP_MM of this tile (half-open box,
        // diagonals included) is drawn as a ghost.
        const x = mirroredXMm[index];
        const y = sourceStones[index].yMm;
        if (x >= originXMm - OVERLAP_MM && x < originXMm + tileWidthMm + OVERLAP_MM &&
            y >= originYMm - OVERLAP_MM && y < originYMm + tileHeightMm + OVERLAP_MM) {
          ghostStoneIndices.push(index);
        }
      }
      const name = tileName(row, col);
      const tileRect = { xMm: tileLeftMm, yMm: tileTopMm, widthMm: tileWidthMm, heightMm: tileHeightMm };
      tiles.push({
        kind: 'tile',
        name,
        row,
        col,
        pageWidthMm,
        pageHeightMm,
        marginMm,
        labelLine: {
          text: `${projectName || 'Untitled Project'} · Page ${name} of ${tileCount} · ${ownedStoneIndices.length} stones · grey stones belong to neighbouring pages`,
          sizeMm: HEADER_LINE_SIZE_MM,
          yMm: labelYMm
        },
        tileRect,
        cutLine: { ...tileRect },
        ownedCount: ownedStoneIndices.length,
        ownedStoneIndices,
        ghostStoneIndices,
        ownedStones: ownedStoneIndices.map(toPage),
        ghostStones: ghostStoneIndices.map(toPage),
        registrationMarks: registrationMarks ? cornerRegistrationMarks(tileLeftMm, tileTopMm, tileWidthMm, tileHeightMm) : [],
        scaleReference: scaleReferenceAt(tileLeftMm, footerTopMm)
      });
    }
  }

  // D8: the cover page -- today's header plus a "Pages:" line, then a page map of the tile grid.
  const plateHeaderLineTexts = computePlateHeaderLineTexts({ ...options, units });
  const sizeBreakdown = computeSizeBreakdown(sourceStones);
  const sizeBreakdownLines = computeSizeBreakdownLineTexts(sizeBreakdown);
  const pagesLineText = `Pages: cover + ${tileCount} (${cols} columns × ${rows} rows), overlap ${OVERLAP_MM} mm`;
  const headerHeightMm = computeHeaderHeightMm(plateHeaderLineTexts.length + sizeBreakdownLines.length + 1);
  const mapAreaHeightMm = printableHeightMm - headerHeightMm;
  if (mapAreaHeightMm < COVER_MAP_MIN_HEIGHT_MM) {
    throw new RangeError(
      `Production sheet cover page has no room for the page map on ${pageSize} at margin ${marginMm}mm. ` +
        'Reduce the margin or choose a larger page size.'
    );
  }
  const headerTopMm = marginMm;
  const headerLines = buildHeaderLines(headerTopMm, {
    projectName, objectType, productionWidthMm, productionHeightMm, units,
    stoneCount: sourceStones.length,
    distinctSizesMm: distinctStoneSizesMm(sourceStones),
    distinctGapsMm: normalizeGapMm(gapMm),
    distinctColors: distinctCrystalColorNames(sourceStones),
    pageSize, orientation, marginMm, mirror, registrationMarks, plateHeaderLineTexts, sizeBreakdownLines
  }, [pagesLineText]);

  const mapScale = Math.min(printableWidthMm / productionWidthMm, (mapAreaHeightMm - COVER_MAP_CAPTION_SLOT_MM) / productionHeightMm);
  const mapWidthMm = productionWidthMm * mapScale;
  const mapHeightMm = productionHeightMm * mapScale;
  const mapLeftMm = marginMm + (printableWidthMm - mapWidthMm) / 2;
  const mapTopMm = marginMm + headerHeightMm;
  const cellMapWidthMm = tileWidthMm * mapScale;
  const cellMapHeightMm = tileHeightMm * mapScale;
  const labelSizeMm = Math.min(COVER_MAP_LABEL_SIZE_MM, cellMapHeightMm / 3);
  const cover = {
    kind: 'cover',
    pageWidthMm,
    pageHeightMm,
    marginMm,
    headerTopMm,
    headerLines,
    stoneCount: sourceStones.length,
    sizeBreakdown,
    pageMap: {
      xMm: mapLeftMm,
      yMm: mapTopMm,
      widthMm: mapWidthMm,
      heightMm: mapHeightMm,
      caption: 'Page map, not to scale',
      captionYMm: mapTopMm + mapHeightMm + COVER_MAP_CAPTION_SLOT_MM * 0.72,
      labelSizeMm,
      cells: tiles.map((tile) => {
        const xMm = mapLeftMm + tile.col * cellMapWidthMm;
        const yMm = mapTopMm + tile.row * cellMapHeightMm;
        return {
          name: tile.name,
          ownedCount: tile.ownedCount,
          xMm,
          yMm,
          widthMm: cellMapWidthMm,
          heightMm: cellMapHeightMm,
          nameYMm: yMm + labelSizeMm * 1.3,
          countYMm: yMm + labelSizeMm * 2.6
        };
      })
    }
  };

  return {
    multiPage: true,
    pageSize,
    orientation,
    pageWidthMm,
    pageHeightMm,
    marginMm,
    mirror,
    cols,
    rows,
    tileWidthMm,
    tileHeightMm,
    overlapMm: OVERLAP_MM,
    stoneCount: sourceStones.length,
    pages: [cover, ...tiles]
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
  // RS-3041 D11: SVG stays one page. A multi-page sheet is PDF-only.
  const sheetDocument = computeProductionSheetDocument(stoneLayout, options);
  if (sheetDocument.multiPage) {
    const tileCount = sheetDocument.cols * sheetDocument.rows;
    throw new RangeError(
      `This Production Sheet needs ${tileCount} ${tileCount === 1 ? 'page' : 'pages'} on ${sheetDocument.pageSize} plus a cover page. Export it as PDF.`
    );
  }
  const layout = sheetDocument.pages[0];
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

// The layout descriptors are in top-down millimeter page space; PDF is bottom-up points. Flip once,
// at the render boundary, not inside computeProductionSheetLayout()/computeProductionSheetDocument().
function pdfPageSpace(pageHeightMm) {
  const pageHeightPt = pageHeightMm * PT_PER_MM;
  return { toPt: (mm) => mm * PT_PER_MM, flipY: (yMm) => pageHeightPt - yMm * PT_PER_MM };
}

function drawPdfRegistrationMarks(doc, marks, { toPt, flipY }) {
  doc.setStrokeColor([0, 0, 0]);
  doc.setLineWidth(toPt(0.2));
  for (const mark of marks) {
    for (const seg of [mark.horizontal, mark.vertical]) {
      doc.drawLine(toPt(seg.x1Mm), flipY(seg.y1Mm), toPt(seg.x2Mm), flipY(seg.y2Mm));
    }
  }
}

function drawPdfScaleReference(doc, sr, { toPt, flipY }) {
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
}

function drawPdfStones(doc, stones, { toPt, flipY }) {
  for (const stone of stones) {
    const c = STONE_COLORS[stone.color] || STONE_COLORS.crystal;
    const rgb = hexToRgbUnit(c.fill);
    const strokeRgb = hexToRgbUnit(c.stroke);
    doc.setFillColor(rgb);
    doc.setStrokeColor(strokeRgb);
    doc.setLineWidth(toPt(0.12));
    doc.drawCircle(toPt(stone.xMm), flipY(stone.yMm), toPt(stone.sizeMm / 2), { fill: true, stroke: true });
  }
}

function drawPdfHeaderLines(doc, layout, { toPt, flipY }) {
  doc.setFillColor([0.07, 0.09, 0.15]);
  for (const line of layout.headerLines) {
    doc.drawText(toPt(layout.marginMm + 2), flipY(line.yMm), line.text, { sizePt: toPt(line.sizeMm) });
  }
}

// The single-page sheet, drawn in exactly the pre-RS-3041 operator order so its bytes are unchanged.
function drawPdfSinglePage(doc, layout) {
  const space = pdfPageSpace(layout.pageHeightMm);
  const { toPt, flipY } = space;
  drawPdfHeaderLines(doc, layout, space);

  const r = layout.productionRect;
  doc.setStrokeColor([0.78, 0.81, 0.86]);
  doc.setLineWidth(toPt(0.3));
  doc.drawRect(toPt(r.xMm), flipY(r.yMm + r.heightMm), toPt(r.widthMm), toPt(r.heightMm), { stroke: true });

  drawPdfRegistrationMarks(doc, layout.registrationMarks, space);
  drawPdfScaleReference(doc, layout.scaleReference, space);
  drawPdfStones(doc, layout.stones, space);
}

// RS-3041 D8: header, then the tile grid scaled to fit, each cell labelled with its page name and
// owned stone count.
function drawPdfCoverPage(doc, cover) {
  const space = pdfPageSpace(cover.pageHeightMm);
  const { toPt, flipY } = space;
  drawPdfHeaderLines(doc, cover, space);

  const map = cover.pageMap;
  doc.setStrokeColor(MAP_STROKE_RGB);
  doc.setLineWidth(toPt(0.3));
  for (const cell of map.cells) {
    doc.drawRect(toPt(cell.xMm), flipY(cell.yMm + cell.heightMm), toPt(cell.widthMm), toPt(cell.heightMm), { stroke: true });
  }
  for (const cell of map.cells) {
    doc.drawText(toPt(cell.xMm + 1.5), flipY(cell.nameYMm), cell.name, { sizePt: toPt(map.labelSizeMm), color: [0.07, 0.09, 0.15] });
    doc.drawText(toPt(cell.xMm + 1.5), flipY(cell.countYMm), `${cell.ownedCount} stones`, { sizePt: toPt(map.labelSizeMm), color: [0.42, 0.45, 0.5] });
  }
  doc.drawText(toPt(map.xMm), flipY(map.captionYMm), map.caption, { sizePt: toPt(2.6), color: [0.42, 0.45, 0.5] });
}

// RS-3041 D9: label line, dashed cut line, registration marks at the tile corners, scale bar, then
// ghosts (grey outlines, D6) under the owned stones, which are drawn exactly as on a single page.
function drawPdfTilePage(doc, tile) {
  const space = pdfPageSpace(tile.pageHeightMm);
  const { toPt, flipY } = space;
  doc.drawText(toPt(tile.marginMm + 2), flipY(tile.labelLine.yMm), tile.labelLine.text, { sizePt: toPt(tile.labelLine.sizeMm), color: [0.07, 0.09, 0.15] });

  const cut = tile.cutLine;
  doc.setStrokeColor([0, 0, 0]);
  doc.setLineWidth(toPt(CUT_LINE_STROKE_WIDTH_MM));
  doc.setDash(CUT_LINE_DASH_MM.map(toPt));
  doc.drawRect(toPt(cut.xMm), flipY(cut.yMm + cut.heightMm), toPt(cut.widthMm), toPt(cut.heightMm), { stroke: true });
  doc.setDash([]);

  drawPdfRegistrationMarks(doc, tile.registrationMarks, space);
  drawPdfScaleReference(doc, tile.scaleReference, space);

  doc.setStrokeColor(GHOST_STROKE_RGB);
  doc.setLineWidth(toPt(GHOST_STROKE_WIDTH_MM));
  for (const ghost of tile.ghostStones) {
    doc.drawCircle(toPt(ghost.xMm), flipY(ghost.yMm), toPt(ghost.sizeMm / 2), { fill: false, stroke: true });
  }
  drawPdfStones(doc, tile.ownedStones, space);
}

/**
 * RS-3041: renders computeProductionSheetDocument() -- one page when the sheet fits, otherwise a
 * cover page plus one page per tile, all the same size.
 *
 * @param {import('../geometry/StoneLayout.js').StoneLayout} stoneLayout
 * @param {object} options See computeProductionSheetLayout().
 * @returns {Uint8Array}
 */
export function productionSheetToPdf(stoneLayout, options = {}) {
  const sheetDocument = computeProductionSheetDocument(stoneLayout, options);
  const [firstPage, ...otherPages] = sheetDocument.pages;
  const doc = new PdfDocument({ widthPt: firstPage.pageWidthMm * PT_PER_MM, heightPt: firstPage.pageHeightMm * PT_PER_MM });
  if (!sheetDocument.multiPage) {
    drawPdfSinglePage(doc, firstPage);
    return doc.toBytes();
  }
  drawPdfCoverPage(doc, firstPage);
  for (const tile of otherPages) {
    doc.addPage({ widthPt: tile.pageWidthMm * PT_PER_MM, heightPt: tile.pageHeightMm * PT_PER_MM });
    drawPdfTilePage(doc, tile);
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
