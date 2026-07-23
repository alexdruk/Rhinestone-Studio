/**
 * RS Block Prototype (SS10) -- TXT-101A restart, diagnostic-only.
 *
 * Both prior approaches (a shared centerline skeleton expanded into stroke ribbons, then a
 * from-scratch outline rebuild combining primitive rectangles/ellipses via boolean union/subtract)
 * failed manual readability QA. Both shared the same root problem: glyph legibility was a side
 * effect of generic construction math (offset a centerline; combine parametrically-sized
 * primitives), never a direct design decision about what the resulting rhinestone dot pattern would
 * actually look like. This module abandons vector-outline construction entirely.
 *
 * Each glyph here is a hand-placed 5x7 dot-matrix pattern -- the same low-resolution-legibility
 * convention LED/bitmap signage fonts use -- authored as literal stone center positions at a single
 * fixed pitch (3.1mm = SS10's 2.8mm stone + 0.3mm gap, matching this family's name). There is no
 * intermediate vector shape, no centerline, no stroke width, and deliberately no scaling by
 * `heightMm` (see RhinestoneFontProvider.js) -- every stone position is exactly what was authored
 * below, nothing derived.
 *
 * Coverage is intentionally 12 diagnostic glyphs only (A B C D G M N O P R S 8), chosen to exercise
 * straight strokes, closed counters (O/D/P/R/B-shaped bowls, 8), open counters (C/G/S), and
 * diagonals (N/M) -- enough to judge whether the dot-matrix approach itself is readable before
 * investing in full coverage. No lowercase, no adaptive scaling, no second family: see this
 * restart's final report for what is explicitly out of scope until this prototype is visually
 * approved.
 */

// SS10 (2.8mm) + 0.3mm gap -- the one stone pitch this prototype is designed for. Using it with a
// different layer stoneSize will misalign the dedupe/collision assumptions baked into these
// hand-placed positions (see RhinestoneFontProvider.js's module doc) -- a known, accepted prototype
// limitation, not a bug to fix here.
export const PITCH_MM = 3.1;
const GRID_ROWS = 7;
// 5 ink columns + 1 blank column of inter-letter spacing.
const ADVANCE_COLS = 6;

// Each pattern is 7 rows, TOP row first, 5 characters per row ('X' = one stone, '.' = empty).
const PATTERNS = {
  A: ['.XXX.', 'X...X', 'X...X', 'XXXXX', 'X...X', 'X...X', 'X...X'],
  B: ['XXXX.', 'X...X', 'X...X', 'XXXX.', 'X...X', 'X...X', 'XXXX.'],
  C: ['.XXX.', 'X...X', 'X....', 'X....', 'X....', 'X...X', '.XXX.'],
  D: ['XXXX.', 'X...X', 'X...X', 'X...X', 'X...X', 'X...X', 'XXXX.'],
  G: ['.XXX.', 'X...X', 'X....', 'X.XXX', 'X...X', 'X...X', '.XXX.'],
  M: ['X...X', 'XX.XX', 'X.X.X', 'X...X', 'X...X', 'X...X', 'X...X'],
  N: ['X...X', 'XX..X', 'X.X.X', 'X..XX', 'X...X', 'X...X', 'X...X'],
  O: ['.XXX.', 'X...X', 'X...X', 'X...X', 'X...X', 'X...X', '.XXX.'],
  P: ['XXXX.', 'X...X', 'X...X', 'XXXX.', 'X....', 'X....', 'X....'],
  R: ['XXXX.', 'X...X', 'X...X', 'XXXX.', 'X.X..', 'X..X.', 'X...X'],
  S: ['.XXXX', 'X....', 'X....', '.XXX.', '....X', '....X', 'XXXX.'],
  8: ['.XXX.', 'X...X', 'X...X', '.XXX.', 'X...X', 'X...X', '.XXX.']
};

function parsePattern(rows) {
  const stones = [];
  for (let rowIndex = 0; rowIndex < rows.length; rowIndex++) {
    const rowFromBaseline = rows.length - 1 - rowIndex;
    const row = rows[rowIndex];
    for (let col = 0; col < row.length; col++) {
      if (row[col] === 'X') {
        stones.push({ xMm: col * PITCH_MM, yMm: rowFromBaseline * PITCH_MM });
      }
    }
  }
  return Object.freeze(stones);
}

const STONE_MAPS = Object.freeze(
  Object.fromEntries(Object.entries(PATTERNS).map(([character, rows]) => [character, parsePattern(rows)]))
);

export const CAP_HEIGHT_MM = (GRID_ROWS - 1) * PITCH_MM;
export const ADVANCE_WIDTH_MM = ADVANCE_COLS * PITCH_MM;

export const descriptor = {
  id: 'rs-block-prototype-ss10',
  displayName: 'RS Block Prototype (SS10)',
  category: 'experimental',
  recommendedStoneSizeMm: 2.8,
  minStoneSizeMm: 2.8,
  recommendedGapMm: 0.3,
  recommendedUses: ['Internal visual QA only -- not for production or customer-facing use'],
  // This family supplies explicit authored stone centers (see RhinestoneFontProvider.js), not
  // vector glyph contours -- GeometryEngine.generateTextLayout() ignores a text layer's stored
  // Outline/Fill mode entirely for these positions (ignoresFillMode note below), producing the same
  // stones regardless of which fill mode a layer has stored. A future UI surfacing this family
  // should read this flag to hide/disable the fill-mode selector rather than let a user pick a
  // setting with no effect.
  fillModeIndependent: true,
  notes: 'Diagnostic-only prototype: 12 hand-placed 5x7 dot-matrix glyphs (A B C D G M N O P R S 8) at a fixed SS10 (2.8mm) + 0.3mm gap pitch. No lowercase, no digits beyond 8, no adaptive scaling to other heights/stone sizes. Authored stone positions are delivered to GeometryEngine as explicit stone centers (FontProviderResult.stoneCenters), not vector contours -- Outline/Fill mode has no effect on this family\'s geometry (fillModeIndependent: true). Not registered in the desktop font manifest -- reachable only via direct FontProviderRegistry/RhinestoneFontRegistry access (see tools/generate-rs-block-prototype-qa-sheet.mjs), not the normal font picker.'
};

/**
 * @param {string} character
 * @returns {{advanceWidthMm: number, stones: ReadonlyArray<{xMm:number,yMm:number}>}|null}
 */
export function getGlyphStoneMap(character) {
  const stones = STONE_MAPS[character];
  if (!stones) return null;
  return { advanceWidthMm: ADVANCE_WIDTH_MM, stones };
}

export const renderOptions = {};
