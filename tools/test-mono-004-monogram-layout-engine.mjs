import assert from 'node:assert/strict';
import {
  computeMonogramLayout,
  MONOGRAM_LAYOUTS,
  MONOGRAM_LAYOUT_LETTER_COUNTS,
  MONOGRAM_LAYOUT_FAILURE_REASONS
} from '../src/monogram/MonogramLayouts.js';

// MONO-004 (Monogram Layout Engine) — proves src/monogram/MonogramLayouts.js's pure slot-geometry
// contract: every supported layout produces ordered, deterministic slots inside a caller-supplied
// frame interior rectangle, with no GeometryEngine/FrameLibrary/authored-font involvement. This
// file only exercises layout geometry, never text/letter generation.

async function test(name, fn) {
  try {
    await fn();
    console.log(`✓ ${name}`);
  } catch (error) {
    console.error(`✗ ${name}`);
    console.error(error);
    process.exitCode = 1;
  }
}

// A realistic frame interior: roughly what FrameLibrary.computeFrameInterior()/computeFrameFitRect()
// would hand a caller for a 60mm frame with a moderate border.
const REALISTIC_FRAME_INTERIOR_RECT = { xMm: 12, yMm: 14, widthMm: 40, heightMm: 40 };

function rectRight(rect) {
  return rect.xMm + rect.widthMm;
}

function rectBottom(rect) {
  return rect.yMm + rect.heightMm;
}

function assertClose(actual, expected, label) {
  assert.ok(Math.abs(actual - expected) < 1e-9, `${label}: expected ~${expected}, got ${actual}`);
}

function assertRectInsideFrame(rect, frameRect, label) {
  assert.ok(rect.widthMm > 0, `${label}: widthMm must be positive`);
  assert.ok(rect.heightMm > 0, `${label}: heightMm must be positive`);
  assert.ok(rect.xMm >= frameRect.xMm - 1e-9, `${label}: xMm must be inside frame interior`);
  assert.ok(rect.yMm >= frameRect.yMm - 1e-9, `${label}: yMm must be inside frame interior`);
  assert.ok(rectRight(rect) <= rectRight(frameRect) + 1e-9, `${label}: must not exceed frame interior right edge`);
  assert.ok(rectBottom(rect) <= rectBottom(frameRect) + 1e-9, `${label}: must not exceed frame interior bottom edge`);
}

// --- 1. Single layout -----------------------------------------------------------------------------

await test('1. single layout returns one centered slot filling the frame interior', () => {
  const result = computeMonogramLayout({
    layoutId: MONOGRAM_LAYOUTS.SINGLE,
    frameInteriorRect: REALISTIC_FRAME_INTERIOR_RECT,
    letterCount: 1
  });

  assert.equal(result.ok, true, result.message);
  assert.equal(result.slots.length, 1);
  const [slot] = result.slots;
  assert.equal(slot.index, 0);
  assert.equal(slot.drawOrder, 0);
  assert.equal(slot.targetHeightRatio, 1);
  assert.equal(slot.xOffsetMm, 0);
  assert.equal(slot.yOffsetMm, 0);
  assert.deepEqual(slot.targetRect, REALISTIC_FRAME_INTERIOR_RECT);
});

// --- 2. Two-letter layout --------------------------------------------------------------------------

await test('2. two-letter layout produces two equal-size, horizontally balanced slots', () => {
  const result = computeMonogramLayout({
    layoutId: MONOGRAM_LAYOUTS.TWO_LETTER,
    frameInteriorRect: REALISTIC_FRAME_INTERIOR_RECT,
    letterCount: 2
  });

  assert.equal(result.ok, true, result.message);
  assert.equal(result.slots.length, 2);
  const [left, right] = result.slots;

  assert.equal(left.index, 0);
  assert.equal(right.index, 1);
  assert.equal(left.drawOrder, 0);
  assert.equal(right.drawOrder, 1);

  // Equal size.
  assert.equal(left.targetRect.widthMm, right.targetRect.widthMm);
  assert.equal(left.targetRect.heightMm, right.targetRect.heightMm);
  assert.equal(left.targetHeightRatio, right.targetHeightRatio);

  // Horizontally balanced: the two slots' offsets from the frame center are equal and opposite,
  // and left sits strictly left of right with no overlap.
  assertClose(left.xOffsetMm, -right.xOffsetMm, 'left/right offsets must be equal and opposite');
  assert.ok(rectRight(left.targetRect) <= right.targetRect.xMm + 1e-9);

  assertRectInsideFrame(left.targetRect, REALISTIC_FRAME_INTERIOR_RECT, 'left slot');
  assertRectInsideFrame(right.targetRect, REALISTIC_FRAME_INTERIOR_RECT, 'right slot');
});

// --- 3. Traditional three-letter layout -------------------------------------------------------------

await test('3. traditional-three layout enlarges the center slot and keeps explicit draw order', () => {
  const result = computeMonogramLayout({
    layoutId: MONOGRAM_LAYOUTS.TRADITIONAL_THREE,
    frameInteriorRect: REALISTIC_FRAME_INTERIOR_RECT,
    letterCount: 3
  });

  assert.equal(result.ok, true, result.message);
  assert.equal(result.slots.length, 3);
  const [left, center, right] = result.slots;

  assert.deepEqual(result.slots.map((s) => s.index), [0, 1, 2]);

  // Center is larger than both sides in both dimensions.
  assert.ok(center.targetRect.widthMm > left.targetRect.widthMm);
  assert.ok(center.targetRect.widthMm > right.targetRect.widthMm);
  assert.ok(center.targetRect.heightMm > left.targetRect.heightMm);
  assert.ok(center.targetRect.heightMm > right.targetRect.heightMm);
  assert.ok(center.targetHeightRatio > left.targetHeightRatio);

  // Sides are equal to each other.
  assert.equal(left.targetRect.widthMm, right.targetRect.widthMm);
  assert.equal(left.targetRect.heightMm, right.targetRect.heightMm);

  // Visually centered as a group: the center slot's own offset is 0, and side offsets are equal
  // and opposite.
  assertClose(center.xOffsetMm, 0, 'center slot must sit on the frame midline');
  assertClose(left.xOffsetMm, -right.xOffsetMm, 'left/right offsets must be equal and opposite');

  // Explicit drawing order: sides drawn first (0, 1), enlarged center drawn last (2).
  assert.deepEqual([left.drawOrder, right.drawOrder, center.drawOrder].sort((a, b) => a - b), [0, 1, 2]);
  assert.equal(center.drawOrder, 2);
  assert.ok(left.drawOrder < center.drawOrder);
  assert.ok(right.drawOrder < center.drawOrder);

  // No horizontal overlap, left-to-right order preserved.
  assert.ok(rectRight(left.targetRect) <= center.targetRect.xMm + 1e-9);
  assert.ok(rectRight(center.targetRect) <= right.targetRect.xMm + 1e-9);

  assertRectInsideFrame(left.targetRect, REALISTIC_FRAME_INTERIOR_RECT, 'left slot');
  assertRectInsideFrame(center.targetRect, REALISTIC_FRAME_INTERIOR_RECT, 'center slot');
  assertRectInsideFrame(right.targetRect, REALISTIC_FRAME_INTERIOR_RECT, 'right slot');
});

// --- 4. Equal three-letter layout --------------------------------------------------------------------

await test('4. equal-three layout produces three equal, evenly spaced slots', () => {
  const result = computeMonogramLayout({
    layoutId: MONOGRAM_LAYOUTS.EQUAL_THREE,
    frameInteriorRect: REALISTIC_FRAME_INTERIOR_RECT,
    letterCount: 3
  });

  assert.equal(result.ok, true, result.message);
  assert.equal(result.slots.length, 3);
  const [first, second, third] = result.slots;

  assert.deepEqual(result.slots.map((s) => s.index), [0, 1, 2]);
  assert.deepEqual(result.slots.map((s) => s.drawOrder), [0, 1, 2]);

  // All three equal in size.
  assert.equal(first.targetRect.widthMm, second.targetRect.widthMm);
  assert.equal(second.targetRect.widthMm, third.targetRect.widthMm);
  assert.equal(first.targetRect.heightMm, second.targetRect.heightMm);
  assert.equal(second.targetRect.heightMm, third.targetRect.heightMm);
  assert.equal(first.targetHeightRatio, second.targetHeightRatio);
  assert.equal(second.targetHeightRatio, third.targetHeightRatio);

  // Balanced spacing: gap between slot 1/2 equals gap between slot 2/3.
  const gapOne = second.targetRect.xMm - rectRight(first.targetRect);
  const gapTwo = third.targetRect.xMm - rectRight(second.targetRect);
  assert.ok(Math.abs(gapOne - gapTwo) < 1e-9);

  // Middle slot is centered on the frame; outer slots are equidistant from it.
  assertClose(second.xOffsetMm, 0, 'middle slot must sit on the frame midline');
  assertClose(first.xOffsetMm, -third.xOffsetMm, 'outer slot offsets must be equal and opposite');

  assertRectInsideFrame(first.targetRect, REALISTIC_FRAME_INTERIOR_RECT, 'first slot');
  assertRectInsideFrame(second.targetRect, REALISTIC_FRAME_INTERIOR_RECT, 'second slot');
  assertRectInsideFrame(third.targetRect, REALISTIC_FRAME_INTERIOR_RECT, 'third slot');
});

// --- 5. Determinism ---------------------------------------------------------------------------------

await test('5. deterministic repeated calls produce identical slots for every layout', () => {
  for (const layoutId of Object.values(MONOGRAM_LAYOUTS)) {
    const letterCount = MONOGRAM_LAYOUT_LETTER_COUNTS[layoutId];
    const first = computeMonogramLayout({ layoutId, frameInteriorRect: REALISTIC_FRAME_INTERIOR_RECT, letterCount });
    const second = computeMonogramLayout({ layoutId, frameInteriorRect: REALISTIC_FRAME_INTERIOR_RECT, letterCount });

    assert.equal(first.ok, true, first.message);
    assert.equal(second.ok, true, second.message);
    assert.deepEqual(first.slots, second.slots, `layout ${layoutId} must be deterministic`);
  }
});

await test('6. a different frame interior rectangle produces correctly re-derived slots, not accumulated drift', () => {
  const frameA = { xMm: 0, yMm: 0, widthMm: 40, heightMm: 40 };
  const frameB = { xMm: 100, yMm: 200, widthMm: 80, heightMm: 50 };

  const resultA1 = computeMonogramLayout({ layoutId: MONOGRAM_LAYOUTS.TWO_LETTER, frameInteriorRect: frameA, letterCount: 2 });
  computeMonogramLayout({ layoutId: MONOGRAM_LAYOUTS.TWO_LETTER, frameInteriorRect: frameB, letterCount: 2 });
  const resultA2 = computeMonogramLayout({ layoutId: MONOGRAM_LAYOUTS.TWO_LETTER, frameInteriorRect: frameA, letterCount: 2 });

  assert.deepEqual(resultA1.slots, resultA2.slots, 'calling with a different frame in between must not perturb frameA results');
});

// --- 7. Validation: unknown layout -------------------------------------------------------------------

await test('7. unknown layout id is rejected with a structured result, not a throw', () => {
  const result = computeMonogramLayout({
    layoutId: 'quad-diamond',
    frameInteriorRect: REALISTIC_FRAME_INTERIOR_RECT,
    letterCount: 4
  });

  assert.equal(result.ok, false);
  assert.equal(result.reason, MONOGRAM_LAYOUT_FAILURE_REASONS.UNKNOWN_LAYOUT);
  assert.equal(result.slots.length, 0);
  assert.equal(result.frameInteriorRect, null);
});

// --- 8. Validation: invalid frame rectangle -----------------------------------------------------------

await test('8. invalid frame interior rectangle is rejected with a structured result', () => {
  const invalidRects = [
    null,
    undefined,
    {},
    { xMm: 0, yMm: 0, widthMm: 0, heightMm: 40 },
    { xMm: 0, yMm: 0, widthMm: 40, heightMm: -5 },
    { xMm: 0, yMm: 0, widthMm: NaN, heightMm: 40 },
    { xMm: 0, yMm: 0, widthMm: 40 } // missing heightMm
  ];

  for (const frameInteriorRect of invalidRects) {
    const result = computeMonogramLayout({ layoutId: MONOGRAM_LAYOUTS.SINGLE, frameInteriorRect, letterCount: 1 });
    assert.equal(result.ok, false, `expected rejection for ${JSON.stringify(frameInteriorRect)}`);
    assert.equal(result.reason, MONOGRAM_LAYOUT_FAILURE_REASONS.INVALID_FRAME_RECT);
    assert.equal(result.slots.length, 0);
  }
});

// --- 9. Validation: invalid letter count --------------------------------------------------------------

await test('9. invalid letter count (not a positive integer) is rejected with a structured result', () => {
  const invalidCounts = [0, -1, 1.5, NaN, '2', null, undefined];

  for (const letterCount of invalidCounts) {
    const result = computeMonogramLayout({
      layoutId: MONOGRAM_LAYOUTS.SINGLE,
      frameInteriorRect: REALISTIC_FRAME_INTERIOR_RECT,
      letterCount
    });
    assert.equal(result.ok, false, `expected rejection for letterCount ${JSON.stringify(letterCount)}`);
    assert.equal(result.reason, MONOGRAM_LAYOUT_FAILURE_REASONS.INVALID_LETTER_COUNT);
    assert.equal(result.slots.length, 0);
  }
});

// --- 10. Validation: unsupported letter count for a known layout ---------------------------------------

await test('10. a valid but unsupported letter count for the given layout is rejected distinctly', () => {
  const cases = [
    { layoutId: MONOGRAM_LAYOUTS.SINGLE, letterCount: 2 },
    { layoutId: MONOGRAM_LAYOUTS.TWO_LETTER, letterCount: 1 },
    { layoutId: MONOGRAM_LAYOUTS.TWO_LETTER, letterCount: 3 },
    { layoutId: MONOGRAM_LAYOUTS.TRADITIONAL_THREE, letterCount: 2 },
    { layoutId: MONOGRAM_LAYOUTS.EQUAL_THREE, letterCount: 4 }
  ];

  for (const { layoutId, letterCount } of cases) {
    const result = computeMonogramLayout({ layoutId, frameInteriorRect: REALISTIC_FRAME_INTERIOR_RECT, letterCount });
    assert.equal(result.ok, false, `expected rejection for ${layoutId} with letterCount ${letterCount}`);
    assert.equal(result.reason, MONOGRAM_LAYOUT_FAILURE_REASONS.UNSUPPORTED_LETTER_COUNT);
    assert.equal(result.slots.length, 0);
  }
});

// --- 11. Every supported layout is independently reachable and well-formed -------------------------------

await test('11. every entry in MONOGRAM_LAYOUTS produces a well-formed successful result', () => {
  for (const layoutId of Object.values(MONOGRAM_LAYOUTS)) {
    const letterCount = MONOGRAM_LAYOUT_LETTER_COUNTS[layoutId];
    const result = computeMonogramLayout({ layoutId, frameInteriorRect: REALISTIC_FRAME_INTERIOR_RECT, letterCount });

    assert.equal(result.ok, true, `layout ${layoutId}: ${result.message}`);
    assert.equal(result.slots.length, letterCount);
    assert.equal(result.layoutId, layoutId);
    assert.equal(result.letterCount, letterCount);

    const drawOrders = result.slots.map((s) => s.drawOrder).sort((a, b) => a - b);
    assert.deepEqual(drawOrders, result.slots.map((_, i) => i), `layout ${layoutId}: drawOrder must be a permutation of 0..N-1`);

    for (const slot of result.slots) {
      assert.equal(typeof slot.index, 'number');
      assert.equal(typeof slot.targetHeightRatio, 'number');
      assert.ok(slot.targetHeightRatio > 0 && slot.targetHeightRatio <= 1);
      assertRectInsideFrame(slot.targetRect, REALISTIC_FRAME_INTERIOR_RECT, `${layoutId} slot ${slot.index}`);
    }
  }
});

if (process.exitCode) {
  console.error('\nSome MONO-004 tests failed.');
} else {
  console.log('\nAll MONO-004 tests passed.');
}
