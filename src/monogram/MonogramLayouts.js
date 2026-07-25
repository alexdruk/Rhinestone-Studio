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
  UNSUPPORTED_LETTER_COUNT: 'unsupported-letter-count'
});

// --- Layout constants ----------------------------------------------------------------------------
// Every ratio below is a fraction of the frame interior rectangle's own widthMm/heightMm.
// Placeholder defaults for this foundational milestone (same status as FrameLibrary's own
// DEFAULT_INNER_RATIO/ROUNDED_SQUARE_CORNER_RATIO) -- a future milestone may tune them once real
// fitted letters are visible. Three- and two-letter layouts deliberately leave a small margin
// (group width < frame interior width) rather than stretching to fill it exactly, so the group can
// be centered as a unit inside the frame interior.

const SINGLE_HEIGHT_RATIO = 1;

const TWO_LETTER_WIDTH_RATIO = 0.44;
const TWO_LETTER_HEIGHT_RATIO = 0.86;
const TWO_LETTER_GAP_RATIO = 0.06;

const TRADITIONAL_THREE_CENTER_WIDTH_RATIO = 0.38;
const TRADITIONAL_THREE_CENTER_HEIGHT_RATIO = 0.92;
const TRADITIONAL_THREE_SIDE_WIDTH_RATIO = 0.25;
const TRADITIONAL_THREE_SIDE_HEIGHT_RATIO = 0.62;
const TRADITIONAL_THREE_GAP_RATIO = 0.02;

const EQUAL_THREE_WIDTH_RATIO = 0.28;
const EQUAL_THREE_HEIGHT_RATIO = 0.72;
const EQUAL_THREE_GAP_RATIO = 0.04;

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
 */
function layoutHorizontalGroup(frameInteriorRect, widthRatios, heightRatios, gapRatio) {
  const gapMm = frameInteriorRect.widthMm * gapRatio;
  const slotWidthsMm = widthRatios.map((ratio) => frameInteriorRect.widthMm * ratio);
  const slotHeightsMm = heightRatios.map((ratio) => frameInteriorRect.heightMm * ratio);
  const groupWidthMm = slotWidthsMm.reduce((sum, w) => sum + w, 0) + gapMm * (widthRatios.length - 1);

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

function buildTwoLetterSlots(frameInteriorRect) {
  const widthRatios = [TWO_LETTER_WIDTH_RATIO, TWO_LETTER_WIDTH_RATIO];
  const heightRatios = [TWO_LETTER_HEIGHT_RATIO, TWO_LETTER_HEIGHT_RATIO];
  const rects = layoutHorizontalGroup(frameInteriorRect, widthRatios, heightRatios, TWO_LETTER_GAP_RATIO);
  return rects.map((rect, i) => buildSlot(i, rect, heightRatios[i], frameInteriorRect, i));
}

// Slot index order is purely positional (0=left, 1=center, 2=right) -- this module has no notion
// of which actual letter a caller assigns to which index. drawOrder puts the two side slots first
// (0, 1) and the enlarged center slot last (2), so a renderer drawing in ascending drawOrder paints
// the smaller side letters first and the dominant center letter on top of them, the conventional
// traditional-three-letter monogram look.
function buildTraditionalThreeSlots(frameInteriorRect) {
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
  const rects = layoutHorizontalGroup(frameInteriorRect, widthRatios, heightRatios, TRADITIONAL_THREE_GAP_RATIO);
  const drawOrders = [0, 2, 1]; // left, center, right -> center (index 1) drawn last
  return rects.map((rect, i) => buildSlot(i, rect, heightRatios[i], frameInteriorRect, drawOrders[i]));
}

function buildEqualThreeSlots(frameInteriorRect) {
  const widthRatios = [EQUAL_THREE_WIDTH_RATIO, EQUAL_THREE_WIDTH_RATIO, EQUAL_THREE_WIDTH_RATIO];
  const heightRatios = [EQUAL_THREE_HEIGHT_RATIO, EQUAL_THREE_HEIGHT_RATIO, EQUAL_THREE_HEIGHT_RATIO];
  const rects = layoutHorizontalGroup(frameInteriorRect, widthRatios, heightRatios, EQUAL_THREE_GAP_RATIO);
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
 * @param {{layoutId:string, frameInteriorRect:{xMm:number,yMm:number,widthMm:number,heightMm:number}, letterCount:number}} request
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

  const slots = LAYOUT_BUILDERS[layoutId](normalizedFrameInteriorRect);

  return {
    ok: true,
    layoutId,
    letterCount,
    frameInteriorRect: normalizedFrameInteriorRect,
    slots
  };
}
