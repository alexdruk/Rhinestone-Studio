/**
 * MONO-004: Monogram Layout Engine — computes where monogram letters belong inside a frame, as
 * pure slot geometry. This is layout only: no text generation, no authored-font scaling, no
 * GeometryEngine/ShapeFit/FrameLibrary calls, no collision detection. A future milestone (MONO-005)
 * is expected to take one slot's targetRect, hand it to FrameLibrary/ShapeFit-style fitting and
 * GeometryEngine.scaleAuthoredTextLayout() (MONO-002), and generate the actual letter — this module
 * never does that itself.
 *
 * Same design philosophy as ShapeLibrary.js/FrameLibrary.js: pure data + math, no DOM, no app.js,
 * no renderer knowledge. The "frame interior rectangle" this module consumes is deliberately the
 * same plain {xMm,yMm,widthMm,heightMm} box shape FrameLibrary.js's own resolve/compute functions
 * already accept or return (e.g. computeFrameFitRect()'s result) — that keeps this module usable
 * with FrameLibrary's output without importing FrameLibrary itself.
 */

// Layout identifiers. A future UI/generator branches on these values, never on label text.
export const MONOGRAM_LAYOUTS = Object.freeze({
  SINGLE: 'single',
  TWO_LETTER: 'two-letter',
  TRADITIONAL_THREE: 'traditional-three',
  EQUAL_THREE: 'equal-three'
});

// The exact letter count each layout supports. computeMonogramLayout() rejects any other count
// for a given layoutId as MONOGRAM_LAYOUT_FAILURE_REASONS.UNSUPPORTED_LETTER_COUNT.
export const MONOGRAM_LAYOUT_LETTER_COUNTS = Object.freeze({
  [MONOGRAM_LAYOUTS.SINGLE]: 1,
  [MONOGRAM_LAYOUTS.TWO_LETTER]: 2,
  [MONOGRAM_LAYOUTS.TRADITIONAL_THREE]: 3,
  [MONOGRAM_LAYOUTS.EQUAL_THREE]: 3
});

// Reason codes computeMonogramLayout() returns on failure -- a caller branches on these, not on
// message text (same convention as GeometryEngine's TEXT_SCALE_FAILURE_REASONS).
export const MONOGRAM_LAYOUT_FAILURE_REASONS = Object.freeze({
  UNKNOWN_LAYOUT: 'unknown-layout',
  INVALID_FRAME_RECT: 'invalid-frame-rect',
  INVALID_LETTER_COUNT: 'invalid-letter-count',
  UNSUPPORTED_LETTER_COUNT: 'unsupported-letter-count',
  // MONO-006E: the requested minGapMm (a caller's real production stone-to-stone clearance) does
  // not fit alongside every slot's own ratio-derived width inside frameInteriorRect -- distinct
  // from INVALID_FRAME_RECT (a malformed rect) and UNSUPPORTED_LETTER_COUNT (a layout/letters
  // mismatch): the rect and letter count are both individually valid, there just is not enough
  // room to also honor the required gap.
  INSUFFICIENT_SPACE: 'insufficient-space'
});

// --- Layout constants ----------------------------------------------------------------------------
// Every ratio below is a fraction of the frame interior rectangle's own widthMm/heightMm.
// Three- and two-letter layouts deliberately leave a small margin (group width < frame interior
// width) rather than stretching to fill it exactly, so the group can be centered as a unit inside
// the frame interior.
//
// MONO-006E: before this milestone, MonogramGenerator always scaled a letter to its smallest
// legal (density-floor) size regardless of slot size (see that module's own MONO-006C history) --
// which meant these ratios only ever affected each slot's *position*, never its rendered *size*.
// That is the real reason Traditional Three and Equal Three used to look the same: Traditional
// Three's center/side ratio contrast below was already present, it just had no visible effect.
// Now that MonogramGenerator fits each letter to *fill* its own slot (bounded below by the
// production-legal floor, never above), these ratios directly control each letter's rendered size,
// so they are tuned here to produce two genuinely distinct silhouettes: Traditional Three's tall
// dominant center flanked by two visibly shorter sides (the conventional monogram look), versus
// Equal Three's uniform row of three same-height letters. Still placeholder-tuned (same status as
// FrameLibrary's own DEFAULT_INNER_RATIO/ROUNDED_SQUARE_CORNER_RATIO), just now against a
// meaningfully different baseline.

const SINGLE_HEIGHT_RATIO = 1;

const TWO_LETTER_WIDTH_RATIO = 0.46;
const TWO_LETTER_HEIGHT_RATIO = 0.92;
const TWO_LETTER_GAP_RATIO = 0.04;

const TRADITIONAL_THREE_CENTER_WIDTH_RATIO = 0.40;
const TRADITIONAL_THREE_CENTER_HEIGHT_RATIO = 1.0;
const TRADITIONAL_THREE_SIDE_WIDTH_RATIO = 0.24;
const TRADITIONAL_THREE_SIDE_HEIGHT_RATIO = 0.62;
const TRADITIONAL_THREE_GAP_RATIO = 0.02;

const EQUAL_THREE_WIDTH_RATIO = 0.30;
const EQUAL_THREE_HEIGHT_RATIO = 0.86;
const EQUAL_THREE_GAP_RATIO = 0.03;

function isValidFrameInteriorRect(rect) {
  return !!rect && typeof rect === 'object'
    && Number.isFinite(rect.xMm) && Number.isFinite(rect.yMm)
    && Number.isFinite(rect.widthMm) && Number.isFinite(rect.heightMm)
    && rect.widthMm > 0 && rect.heightMm > 0;
}

function failure(reason, message, layoutId, letterCount) {
  return {
    ok: false,
    reason,
    message,
    layoutId,
    letterCount,
    frameInteriorRect: null,
    slots: []
  };
}

/**
 * Places a row of slots side by side, centered as one group inside frameInteriorRect, with a
 * uniform gap between adjacent slots. widthRatios/heightRatios are parallel arrays, one entry per
 * slot, each a fraction of frameInteriorRect's own widthMm/heightMm; gapRatio is a fraction of
 * frameInteriorRect.widthMm. Every slot is vertically centered on the frame interior's own midline.
 *
 * @param {number} [minGapMm] MONO-006E: an absolute mm floor on the gap between adjacent slots --
 *   the effective gap is `Math.max(frameInteriorRect.widthMm * gapRatio, minGapMm)`. A caller
 *   (MonogramGenerator) that knows the real production stone-to-stone clearance
 *   (stoneSizeMm+gapMm) passes it here so two adjacent letters -- each now fit to fill its own
 *   slot, see this module's own doc comment -- are geometrically guaranteed at least that much
 *   room between their bounding boxes, rather than relying on collision detection to reject an
 *   undersized ratio-only gap after the fact.
 *
 *   When honoring minGapMm in full would leave the ratio-derived slot widths no room to fit
 *   (their sum plus every gap would exceed frameInteriorRect's own width), every slot's width is
 *   shrunk *proportionally* -- never its height, and never its ratio relative to the other slots,
 *   so e.g. Traditional Three's dominant-center-vs-side proportion survives intact -- just enough
 *   to make the required gap fit. Whether the resulting, smaller slots can still legally hold a
 *   real letter is decided later, per letter, by scaleAuthoredTextLayout()'s own minimum-legal-
 *   scale check (MONO-002); this only makes a borderline case *reach* that real, physical check
 *   instead of being rejected on ratio arithmetic alone. Returns `null` (not a slot array) only
 *   when the required gaps *alone* -- with every slot shrunk to zero width -- still would not fit;
 *   the caller must treat that as a genuine, reported failure, never silently overflow past the
 *   interior.
 */
function layoutHorizontalGroup(frameInteriorRect, widthRatios, heightRatios, gapRatio, minGapMm = 0) {
  const gapMm = Math.max(frameInteriorRect.widthMm * gapRatio, minGapMm);
  const totalGapMm = gapMm * (widthRatios.length - 1);
  const availableForSlotsMm = frameInteriorRect.widthMm - totalGapMm;
  if (!(availableForSlotsMm > 0)) return null;

  const rawSlotWidthsMm = widthRatios.map((ratio) => frameInteriorRect.widthMm * ratio);
  const rawTotalWidthMm = rawSlotWidthsMm.reduce((sum, w) => sum + w, 0);
  const shrink = rawTotalWidthMm > availableForSlotsMm ? availableForSlotsMm / rawTotalWidthMm : 1;
  const slotWidthsMm = rawSlotWidthsMm.map((w) => w * shrink);
  const slotHeightsMm = heightRatios.map((ratio) => frameInteriorRect.heightMm * ratio);
  const groupWidthMm = slotWidthsMm.reduce((sum, w) => sum + w, 0) + totalGapMm;

  let cursorXMm = frameInteriorRect.xMm + (frameInteriorRect.widthMm - groupWidthMm) / 2;
  const rects = [];
  for (let i = 0; i < widthRatios.length; i++) {
    const widthMm = slotWidthsMm[i];
    const heightMm = slotHeightsMm[i];
    const yMm = frameInteriorRect.yMm + (frameInteriorRect.heightMm - heightMm) / 2;
    rects.push({ xMm: cursorXMm, yMm, widthMm, heightMm });
    cursorXMm += widthMm + gapMm;
  }
  return rects;
}

function buildSlot(index, rect, targetHeightRatio, frameInteriorRect, drawOrder) {
  const frameCenterXMm = frameInteriorRect.xMm + frameInteriorRect.widthMm / 2;
  const frameCenterYMm = frameInteriorRect.yMm + frameInteriorRect.heightMm / 2;
  const rectCenterXMm = rect.xMm + rect.widthMm / 2;
  const rectCenterYMm = rect.yMm + rect.heightMm / 2;

  return {
    index,
    targetRect: { xMm: rect.xMm, yMm: rect.yMm, widthMm: rect.widthMm, heightMm: rect.heightMm },
    targetHeightRatio,
    xOffsetMm: rectCenterXMm - frameCenterXMm,
    yOffsetMm: rectCenterYMm - frameCenterYMm,
    drawOrder
  };
}

function buildSingleSlots(frameInteriorRect) {
  const rect = {
    xMm: frameInteriorRect.xMm,
    yMm: frameInteriorRect.yMm,
    widthMm: frameInteriorRect.widthMm,
    heightMm: frameInteriorRect.heightMm
  };
  return [buildSlot(0, rect, SINGLE_HEIGHT_RATIO, frameInteriorRect, 0)];
}

function buildTwoLetterSlots(frameInteriorRect, minGapMm) {
  const widthRatios = [TWO_LETTER_WIDTH_RATIO, TWO_LETTER_WIDTH_RATIO];
  const heightRatios = [TWO_LETTER_HEIGHT_RATIO, TWO_LETTER_HEIGHT_RATIO];
  const rects = layoutHorizontalGroup(frameInteriorRect, widthRatios, heightRatios, TWO_LETTER_GAP_RATIO, minGapMm);
  if (!rects) return null;
  return rects.map((rect, i) => buildSlot(i, rect, heightRatios[i], frameInteriorRect, i));
}

// Slot index order is purely positional (0=left, 1=center, 2=right) -- this module has no notion
// of which actual letter a caller assigns to which index. drawOrder puts the two side slots first
// (0, 1) and the enlarged center slot last (2), so a renderer drawing in ascending drawOrder paints
// the smaller side letters first and the dominant center letter on top of them, the conventional
// traditional-three-letter monogram look.
function buildTraditionalThreeSlots(frameInteriorRect, minGapMm) {
  const widthRatios = [
    TRADITIONAL_THREE_SIDE_WIDTH_RATIO,
    TRADITIONAL_THREE_CENTER_WIDTH_RATIO,
    TRADITIONAL_THREE_SIDE_WIDTH_RATIO
  ];
  const heightRatios = [
    TRADITIONAL_THREE_SIDE_HEIGHT_RATIO,
    TRADITIONAL_THREE_CENTER_HEIGHT_RATIO,
    TRADITIONAL_THREE_SIDE_HEIGHT_RATIO
  ];
  const rects = layoutHorizontalGroup(frameInteriorRect, widthRatios, heightRatios, TRADITIONAL_THREE_GAP_RATIO, minGapMm);
  if (!rects) return null;
  const drawOrders = [0, 2, 1]; // left, center, right -> center (index 1) drawn last
  return rects.map((rect, i) => buildSlot(i, rect, heightRatios[i], frameInteriorRect, drawOrders[i]));
}

function buildEqualThreeSlots(frameInteriorRect, minGapMm) {
  const widthRatios = [EQUAL_THREE_WIDTH_RATIO, EQUAL_THREE_WIDTH_RATIO, EQUAL_THREE_WIDTH_RATIO];
  const heightRatios = [EQUAL_THREE_HEIGHT_RATIO, EQUAL_THREE_HEIGHT_RATIO, EQUAL_THREE_HEIGHT_RATIO];
  const rects = layoutHorizontalGroup(frameInteriorRect, widthRatios, heightRatios, EQUAL_THREE_GAP_RATIO, minGapMm);
  if (!rects) return null;
  return rects.map((rect, i) => buildSlot(i, rect, heightRatios[i], frameInteriorRect, i));
}

const LAYOUT_BUILDERS = Object.freeze({
  [MONOGRAM_LAYOUTS.SINGLE]: buildSingleSlots,
  [MONOGRAM_LAYOUTS.TWO_LETTER]: buildTwoLetterSlots,
  [MONOGRAM_LAYOUTS.TRADITIONAL_THREE]: buildTraditionalThreeSlots,
  [MONOGRAM_LAYOUTS.EQUAL_THREE]: buildEqualThreeSlots
});

/**
 * Computes the ordered slot geometry for a monogram layout. Pure function of its inputs: no DOM,
 * no randomness, no shared mutable state, so identical arguments always produce identical slots.
 *
 * @param {{layoutId:string, frameInteriorRect:{xMm:number,yMm:number,widthMm:number,heightMm:number}, letterCount:number, minGapMm?:number}} request
 *   MONO-006E: `minGapMm` (default 0) is an absolute mm floor on the gap between adjacent slots --
 *   see layoutHorizontalGroup()'s own doc comment. Ignored (no gap to enforce) by the Single layout.
 * @returns {{
 *   ok: boolean,
 *   reason?: string,
 *   message?: string,
 *   layoutId: string|null,
 *   letterCount: number|null,
 *   frameInteriorRect: {xMm:number,yMm:number,widthMm:number,heightMm:number}|null,
 *   slots: Array<{
 *     index: number,
 *     targetRect: {xMm:number,yMm:number,widthMm:number,heightMm:number},
 *     targetHeightRatio: number,
 *     xOffsetMm: number,
 *     yOffsetMm: number,
 *     drawOrder: number
 *   }>
 * }}
 */
export function computeMonogramLayout(request) {
  const layoutId = request && typeof request === 'object' ? request.layoutId : undefined;
  const frameInteriorRect = request && typeof request === 'object' ? request.frameInteriorRect : undefined;
  const letterCount = request && typeof request === 'object' ? request.letterCount : undefined;
  const minGapMmRaw = request && typeof request === 'object' ? request.minGapMm : undefined;
  const minGapMm = Number.isFinite(minGapMmRaw) && minGapMmRaw > 0 ? minGapMmRaw : 0;

  const layoutIdForResult = typeof layoutId === 'string' ? layoutId : null;
  const letterCountForResult = typeof letterCount === 'number' ? letterCount : null;

  if (!Object.prototype.hasOwnProperty.call(MONOGRAM_LAYOUT_LETTER_COUNTS, layoutId)) {
    return failure(
      MONOGRAM_LAYOUT_FAILURE_REASONS.UNKNOWN_LAYOUT,
      `Unknown monogram layout id ${JSON.stringify(layoutId)}.`,
      layoutIdForResult,
      letterCountForResult
    );
  }

  if (!isValidFrameInteriorRect(frameInteriorRect)) {
    return failure(
      MONOGRAM_LAYOUT_FAILURE_REASONS.INVALID_FRAME_RECT,
      'frameInteriorRect must be a {xMm,yMm,widthMm,heightMm} rectangle with finite coordinates and positive width/height.',
      layoutIdForResult,
      letterCountForResult
    );
  }

  if (!Number.isInteger(letterCount) || letterCount <= 0) {
    return failure(
      MONOGRAM_LAYOUT_FAILURE_REASONS.INVALID_LETTER_COUNT,
      'letterCount must be a positive integer.',
      layoutIdForResult,
      letterCountForResult
    );
  }

  const requiredLetterCount = MONOGRAM_LAYOUT_LETTER_COUNTS[layoutId];
  if (letterCount !== requiredLetterCount) {
    return failure(
      MONOGRAM_LAYOUT_FAILURE_REASONS.UNSUPPORTED_LETTER_COUNT,
      `Layout ${JSON.stringify(layoutId)} requires exactly ${requiredLetterCount} letter(s), got ${letterCount}.`,
      layoutIdForResult,
      letterCountForResult
    );
  }

  const normalizedFrameInteriorRect = {
    xMm: frameInteriorRect.xMm,
    yMm: frameInteriorRect.yMm,
    widthMm: frameInteriorRect.widthMm,
    heightMm: frameInteriorRect.heightMm
  };

  const slots = LAYOUT_BUILDERS[layoutId](normalizedFrameInteriorRect, minGapMm);
  if (!slots) {
    return failure(
      MONOGRAM_LAYOUT_FAILURE_REASONS.INSUFFICIENT_SPACE,
      `Layout ${JSON.stringify(layoutId)} cannot fit ${letterCount} letter(s) inside a ${normalizedFrameInteriorRect.widthMm.toFixed(1)}×${normalizedFrameInteriorRect.heightMm.toFixed(1)}mm region while keeping ${minGapMm.toFixed(2)}mm of required spacing between letters.`,
      layoutIdForResult,
      letterCountForResult
    );
  }

  return {
    ok: true,
    layoutId,
    letterCount,
    frameInteriorRect: normalizedFrameInteriorRect,
    slots
  };
}
