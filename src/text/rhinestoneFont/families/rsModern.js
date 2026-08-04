/**
 * RS Modern -- FONT-002, the second complete authored rhinestone font family.
 *
 * Same architecture and contract as RS Block (see families/rsBlock.js and
 * RhinestoneFontProvider.js's module doc): every glyph is a hand-placed dot-matrix pattern of
 * literal stone-center positions at a single fixed pitch, delivered to GeometryEngine via
 * FontProviderResult.stoneCenters -- no centerline, no vector outline, no derivation from any shared
 * skeleton, no scaled capitals for lowercase, and no automatic conversion from RS Block or any other
 * font. Full coverage: A-Z, a-z, 0-9, space, and . , ! ? ' - &. RS Block glyphs are not modified by
 * this file.
 *
 * Same PITCH_MM/vertical-zone grid as RS Block -- FONT-002's brief calls for reusing the authored
 * stone pitch unless the repository gives a reason not to, and none does; a second physical pitch
 * would need new, unvalidated collision/legibility assumptions for no benefit here.
 *
 * Visual identity, distinct from RS Block's (see rsBlock.js's own module doc for its style):
 *   - No serifs anywhere: "I" is a plain unadorned stem (RS Block's has top/bottom serif bars), and
 *     digit "1" is a plain diagonal-flag stroke with no base serif (RS Block's has one).
 *   - Single-story "a" and a fully round, closed descender loop on "g" (RS Block's g uses a flatter
 *     hook-shaped loop).
 *   - Round bowls throughout, including b/d/p/q/R/P (RS Block deliberately uses a flat-sided
 *     rectilinear bowl for b/d/p/q -- see its module doc's font-perf-lesson rationale; RS Modern's
 *     brief is a distinct geometric/grotesque identity, not a replacement, so the two coexist).
 *   - Straight-sided letters that have essentially one legible form at this dot resolution (A, E, F,
 *     H, K, L, M, N, T, V, W, X, Y, Z) and already-round letters (O, C, G, Q, 0, and their lowercase
 *     counterparts) are authored independently here but converge on similar shapes to RS Block's --
 *     that convergence is a property of 5-column dot-matrix geometry at this pitch, not a shared
 *     skeleton or derivation.
 * Same confusability discipline as RS Block: 0 keeps its internal diagonal slash (vs. round O), 1 is
 * unambiguous against I/l via width and its flag, S/5 and B/8 keep the same distinguishing logic
 * (flat-stemmed B vs. fully-round 8; flat-topped closed-loop 5 vs. serpentine S).
 *
 * Kerning: KERNING_PAIRS_MM below reviews the same pair set RS Block reviews (AV VA WA AW To Yo LA
 * LT TT TA FA PA LY RY) -- these are the letters whose *advance widths* are unchanged from RS Block
 * (RS Modern's bowl-rounding only changes which cells inside a glyph are filled, not its ink width or
 * advance), so the geometrically correct adjustment is the same value; this is not an un-reviewed
 * copy, see the values' shared derivation above. Uses the shared lookup mechanism from
 * ../kerningTable.js (FONT-002, Part 3) -- see rsBlock.js for the same usage.
 */

import { createKerningTable } from '../kerningTable.js';

export const PITCH_MM = 3.1;

// Vertical layout constants, in row units from baseline -- identical to RS Block's (see module doc).
export const CAP_TOP_ROW = 6;
export const X_HEIGHT_TOP_ROW = 4;
export const DESCENDER_BOTTOM_ROW = -2;
export const CAP_HEIGHT_MM = CAP_TOP_ROW * PITCH_MM;
export const X_HEIGHT_MM = X_HEIGHT_TOP_ROW * PITCH_MM;
export const TOTAL_HEIGHT_MM = (CAP_TOP_ROW - DESCENDER_BOTTOM_ROW) * PITCH_MM;

/**
 * @param {string[]} rows Top-to-bottom rows, 'X' = stone, '.' = empty. Every row must be the same
 *   length (the glyph's ink width in columns).
 * @param {object} options
 * @param {number} options.topRow Row-from-baseline value of rows[0] (the array's first/top row).
 * @param {number} [options.advanceCols] Advance width in columns (pitch units). Defaults to the
 *   glyph's ink width + 1 column of inter-letter gap.
 */
function glyph(rows, { topRow, advanceCols = null }) {
  const width = rows.length === 0 ? 0 : rows[0].length;
  const stones = [];
  for (let rowIndex = 0; rowIndex < rows.length; rowIndex++) {
    const rowFromBaseline = topRow - rowIndex;
    const row = rows[rowIndex];
    for (let col = 0; col < row.length; col++) {
      if (row[col] === 'X') stones.push({ xMm: col * PITCH_MM, yMm: rowFromBaseline * PITCH_MM });
    }
  }
  const resolvedAdvanceCols = advanceCols ?? width + 1;
  return { stones: Object.freeze(stones), advanceWidthMm: resolvedAdvanceCols * PITCH_MM };
}

// ---------------------------------------------------------------------------------------------
// Uppercase A-Z
// ---------------------------------------------------------------------------------------------
const UPPERCASE = {
  A: glyph(['.XXX.', 'X...X', 'X...X', 'XXXXX', 'X...X', 'X...X', 'X...X'], { topRow: CAP_TOP_ROW }),
  B: glyph(['XXXX.', 'X...X', 'X...X', 'XXXX.', 'X...X', 'X...X', 'XXXX.'], { topRow: CAP_TOP_ROW }),
  C: glyph(['.XXX.', 'X...X', 'X....', 'X....', 'X....', 'X...X', '.XXX.'], { topRow: CAP_TOP_ROW }),
  D: glyph(['XXXX.', 'X...X', 'X...X', 'X...X', 'X...X', 'X...X', 'XXXX.'], { topRow: CAP_TOP_ROW }),
  E: glyph(['XXXXX', 'X....', 'X....', 'XXXX.', 'X....', 'X....', 'XXXXX'], { topRow: CAP_TOP_ROW }),
  F: glyph(['XXXXX', 'X....', 'X....', 'XXXX.', 'X....', 'X....', 'X....'], { topRow: CAP_TOP_ROW }),
  G: glyph(['.XXX.', 'X...X', 'X....', 'X.XXX', 'X...X', 'X...X', '.XXX.'], { topRow: CAP_TOP_ROW }),
  H: glyph(['X...X', 'X...X', 'X...X', 'XXXXX', 'X...X', 'X...X', 'X...X'], { topRow: CAP_TOP_ROW }),
  // No-serif differentiator vs. RS Block's I (plain stem, matching lowercase l's own construction).
  I: glyph(['X', 'X', 'X', 'X', 'X', 'X', 'X'], { topRow: CAP_TOP_ROW, advanceCols: 2 }),
  J: glyph(['..XX', '...X', '...X', '...X', '...X', 'X..X', '.XXX'], { topRow: CAP_TOP_ROW }),
  K: glyph(['X...X', 'X..X.', 'X.X..', 'XX...', 'X.X..', 'X..X.', 'X...X'], { topRow: CAP_TOP_ROW }),
  L: glyph(['X....', 'X....', 'X....', 'X....', 'X....', 'X....', 'XXXXX'], { topRow: CAP_TOP_ROW }),
  M: glyph(['X...X', 'XX.XX', 'X.X.X', 'X...X', 'X...X', 'X...X', 'X...X'], { topRow: CAP_TOP_ROW }),
  N: glyph(['X...X', 'XX..X', 'X.X.X', 'X..XX', 'X...X', 'X...X', 'X...X'], { topRow: CAP_TOP_ROW }),
  O: glyph(['.XXX.', 'X...X', 'X...X', 'X...X', 'X...X', 'X...X', '.XXX.'], { topRow: CAP_TOP_ROW }),
  // Round-bowl differentiator vs. RS Block's flat-topped 'XXXX.' bowl.
  P: glyph(['.XXX.', 'X...X', 'X...X', '.XXX.', 'X....', 'X....', 'X....'], { topRow: CAP_TOP_ROW }),
  Q: glyph(['.XXX.', 'X...X', 'X...X', 'X...X', 'X...X', 'X..X.', '.XX.X', '...X.'], { topRow: CAP_TOP_ROW }),
  // Round-bowl differentiator (vs. RS Block's flat 'XXXX.' bowl), diagonal leg kept for legibility.
  R: glyph(['.XXX.', 'X...X', 'X...X', '.XXX.', 'X.X..', 'X..X.', 'X...X'], { topRow: CAP_TOP_ROW }),
  S: glyph(['.XXXX', 'X....', 'X....', '.XXX.', '....X', '....X', 'XXXX.'], { topRow: CAP_TOP_ROW }),
  T: glyph(['XXXXX', '..X..', '..X..', '..X..', '..X..', '..X..', '..X..'], { topRow: CAP_TOP_ROW }),
  U: glyph(['X...X', 'X...X', 'X...X', 'X...X', 'X...X', 'X...X', '.XXX.'], { topRow: CAP_TOP_ROW }),
  V: glyph(['X...X', 'X...X', 'X...X', 'X...X', 'X...X', '.X.X.', '..X..'], { topRow: CAP_TOP_ROW }),
  W: glyph(['X...X', 'X...X', 'X...X', 'X...X', 'X.X.X', 'XX.XX', 'X...X'], { topRow: CAP_TOP_ROW }),
  X: glyph(['X...X', 'X...X', '.X.X.', '..X..', '.X.X.', 'X...X', 'X...X'], { topRow: CAP_TOP_ROW }),
  Y: glyph(['X...X', 'X...X', '.X.X.', '..X..', '..X..', '..X..', '..X..'], { topRow: CAP_TOP_ROW }),
  Z: glyph(['XXXXX', '....X', '...X.', '..X..', '.X...', 'X....', 'XXXXX'], { topRow: CAP_TOP_ROW })
};

// ---------------------------------------------------------------------------------------------
// Digits -- 0 and 5 are deliberately distinguished from letters O and S (see module doc), same
// confusability logic as RS Block.
// ---------------------------------------------------------------------------------------------
const DIGITS = {
  0: glyph(['.XXX.', 'X...X', 'X..XX', 'X.X.X', 'XX..X', 'X...X', '.XXX.'], { topRow: CAP_TOP_ROW }),
  // No-serif differentiator vs. RS Block's 1 (top flag only, no base serif bar).
  1: glyph(['.XX', '..X', '..X', '..X', '..X', '..X', '..X'], { topRow: CAP_TOP_ROW, advanceCols: 4 }),
  2: glyph(['.XXX.', 'X...X', '....X', '...X.', '..X..', '.X...', 'XXXXX'], { topRow: CAP_TOP_ROW }),
  3: glyph(['XXXX.', '....X', '....X', '.XXX.', '....X', '....X', 'XXXX.'], { topRow: CAP_TOP_ROW }),
  4: glyph(['...X.', '..XX.', '.X.X.', 'X..X.', 'XXXXX', '...X.', '...X.'], { topRow: CAP_TOP_ROW }),
  5: glyph(['XXXXX', 'X....', 'X....', 'XXXX.', '....X', 'X...X', '.XXX.'], { topRow: CAP_TOP_ROW }),
  6: glyph(['.XXX.', 'X....', 'X....', 'XXXX.', 'X...X', 'X...X', '.XXX.'], { topRow: CAP_TOP_ROW }),
  7: glyph(['XXXXX', '....X', '...X.', '..X..', '..X..', '..X..', '..X..'], { topRow: CAP_TOP_ROW }),
  8: glyph(['.XXX.', 'X...X', 'X...X', '.XXX.', 'X...X', 'X...X', '.XXX.'], { topRow: CAP_TOP_ROW }),
  9: glyph(['.XXX.', 'X...X', 'X...X', '.XXXX', '....X', '....X', '.XXX.'], { topRow: CAP_TOP_ROW })
};

// ---------------------------------------------------------------------------------------------
// Lowercase a-z -- designed as lowercase (x-height/ascender/descender proportions), never scaled
// capitals. Single-story a/g and round b/d/p/q bowls are this family's main differentiators from
// RS Block -- see module doc.
// ---------------------------------------------------------------------------------------------
const LOWERCASE = {
  a: glyph(['.XXX.', '....X', '.XXXX', 'X...X', '.XXXX'], { topRow: X_HEIGHT_TOP_ROW }),
  // Round-bowl differentiator vs. RS Block's flat-sided rectilinear bowl.
  b: glyph(['X....', 'X....', '.XXX.', 'X...X', 'X...X', 'X...X', '.XXX.'], { topRow: CAP_TOP_ROW }),
  c: glyph(['.XXX.', 'X...X', 'X....', 'X...X', '.XXX.'], { topRow: X_HEIGHT_TOP_ROW }),
  d: glyph(['....X', '....X', '.XXX.', 'X...X', 'X...X', 'X...X', '.XXX.'], { topRow: CAP_TOP_ROW }),
  e: glyph(['.XXX.', 'X...X', 'XXXXX', 'X....', '.XXXX'], { topRow: X_HEIGHT_TOP_ROW }),
  f: glyph(['..XX.', '.X...', 'XXXX.', '.X...', '.X...', '.X...', '.X...'], { topRow: CAP_TOP_ROW }),
  // Single-story, fully round closed descender loop -- vs. RS Block's flatter hook-shaped loop.
  g: glyph(['.XXX.', 'X...X', 'X...X', 'X...X', '.XXX.', 'X...X', '.XXX.'], { topRow: X_HEIGHT_TOP_ROW }),
  h: glyph(['X....', 'X....', 'XXXXX', 'X...X', 'X...X', 'X...X', 'X...X'], { topRow: CAP_TOP_ROW }),
  i: glyph(['X', '.', 'X', 'X', 'X', 'X', 'X'], { topRow: CAP_TOP_ROW, advanceCols: 2 }),
  j: glyph(['.X', '..', '.X', '.X', '.X', '.X', '.X', '.X', 'X.'], { topRow: CAP_TOP_ROW, advanceCols: 3 }),
  k: glyph(['X....', 'X....', 'X..X.', 'X.X..', 'XX...', 'X.X..', 'X..X.'], { topRow: CAP_TOP_ROW }),
  l: glyph(['X', 'X', 'X', 'X', 'X', 'X', 'X'], { topRow: CAP_TOP_ROW, advanceCols: 2 }),
  m: glyph(['XXXXXXX', 'X..X..X', 'X..X..X', 'X..X..X', 'X..X..X'], { topRow: X_HEIGHT_TOP_ROW }),
  n: glyph(['XXXXX', 'X...X', 'X...X', 'X...X', 'X...X'], { topRow: X_HEIGHT_TOP_ROW }),
  o: glyph(['.XXX.', 'X...X', 'X...X', 'X...X', '.XXX.'], { topRow: X_HEIGHT_TOP_ROW }),
  // Round-bowl differentiator vs. RS Block's flat-sided rectilinear bowl.
  p: glyph(['.XXX.', 'X...X', 'X...X', 'X...X', '.XXX.', 'X....', 'X....'], { topRow: X_HEIGHT_TOP_ROW }),
  q: glyph(['.XXX.', 'X...X', 'X...X', 'X...X', '.XXX.', '....X', '....X'], { topRow: X_HEIGHT_TOP_ROW }),
  r: glyph(['XXXX.', 'X...X', 'X....', 'X....', 'X....'], { topRow: X_HEIGHT_TOP_ROW }),
  s: glyph(['.XXXX', 'X....', '.XXX.', '....X', 'XXXX.'], { topRow: X_HEIGHT_TOP_ROW }),
  // No-serif/no-curl differentiator vs. RS Block's curled terminal.
  t: glyph(['.X...', 'XXXX.', '.X...', '.X...', '.X...', '.XXX.'], { topRow: X_HEIGHT_TOP_ROW + 1 }),
  u: glyph(['X...X', 'X...X', 'X...X', 'X...X', '.XXX.'], { topRow: X_HEIGHT_TOP_ROW }),
  v: glyph(['X...X', 'X...X', 'X...X', '.X.X.', '..X..'], { topRow: X_HEIGHT_TOP_ROW }),
  w: glyph(['X...X', 'X...X', 'X.X.X', 'XX.XX', 'X...X'], { topRow: X_HEIGHT_TOP_ROW }),
  x: glyph(['X...X', '.X.X.', '..X..', '.X.X.', 'X...X'], { topRow: X_HEIGHT_TOP_ROW }),
  y: glyph(['X...X', 'X...X', '.X.X.', '..X..', '..X..', '..X..', '.X...'], { topRow: X_HEIGHT_TOP_ROW }),
  z: glyph(['XXXXX', '...X.', '..X..', '.X...', 'XXXXX'], { topRow: X_HEIGHT_TOP_ROW })
};

// ---------------------------------------------------------------------------------------------
// Space and punctuation
// ---------------------------------------------------------------------------------------------
const PUNCTUATION = {
  ' ': glyph([], { topRow: 0, advanceCols: 3 }),
  '.': glyph(['X'], { topRow: 0, advanceCols: 2 }),
  ',': glyph(['X.', '.X'], { topRow: 0, advanceCols: 3 }),
  '!': glyph(['X', 'X', 'X', 'X', '.', '.', 'X'], { topRow: CAP_TOP_ROW, advanceCols: 2 }),
  '?': glyph(['.XXX.', 'X...X', '....X', '...X.', '..X..', '.....', '..X..'], { topRow: CAP_TOP_ROW }),
  "'": glyph(['X', 'X'], { topRow: CAP_TOP_ROW, advanceCols: 2 }),
  '-': glyph(['XXX'], { topRow: 2, advanceCols: 4 }),
  '&': glyph(['.XX..', 'X..X.', 'X.X..', '.X...', 'X.X.X', 'X..X.', '.XX.X'], { topRow: CAP_TOP_ROW })
};

const GLYPHS = Object.freeze({ ...UPPERCASE, ...DIGITS, ...LOWERCASE, ...PUNCTUATION });

// ---------------------------------------------------------------------------------------------
// Kerning -- reviewed pairs only (see module doc for why the values match RS Block's). Values are
// in PITCH_MM units (negative tightens).
// ---------------------------------------------------------------------------------------------
const KERNING_PAIRS_MM = Object.freeze({
  AV: -0.5 * PITCH_MM,
  VA: -0.5 * PITCH_MM,
  WA: -0.6 * PITCH_MM,
  AW: -0.6 * PITCH_MM,
  To: -0.5 * PITCH_MM,
  Yo: -0.4 * PITCH_MM,
  LA: -0.6 * PITCH_MM,
  LT: -0.2 * PITCH_MM,
  TT: -0.15 * PITCH_MM,
  TA: -0.45 * PITCH_MM,
  FA: -0.35 * PITCH_MM,
  PA: -0.25 * PITCH_MM,
  LY: -0.35 * PITCH_MM,
  RY: -0.2 * PITCH_MM
});

export const descriptor = {
  id: 'rs-modern',
  displayName: 'RS Modern',
  category: 'rhinestone-native',
  recommendedStoneSizeMm: 2.8,
  minStoneSizeMm: 2.8,
  recommendedGapMm: 0.3,
  recommendedUses: ['Names', 'Team and sports names', 'Wedding phrases', 'Short business names'],
  // Same explicit-stone-center contract as RS Block -- see RhinestoneFontProvider.js's module doc.
  // GeometryEngine.generateTextLayout() ignores a text layer's stored Outline/Fill mode entirely for
  // this family.
  fillModeIndependent: true,
  notes: 'Second production-quality original rhinestone font (FONT-002). Full coverage: A-Z, a-z, ' +
    '0-9, space, and . , ! ? \' - &. A distinct geometric/grotesque style from RS Block: no serifs ' +
    'anywhere, single-story a/g, and round bowls throughout (including b/d/p/q/R/P). Same fixed ' +
    'pitch as RS Block (2.8mm stone + 0.3mm gap). Reviewed kerning pairs: AV VA WA AW To Yo LA LT ' +
    'TT TA FA PA LY RY.'
};

/**
 * @param {string} character
 * @returns {{advanceWidthMm: number, stones: ReadonlyArray<{xMm:number,yMm:number}>}|null}
 */
export function getGlyphStoneMap(character) {
  const entry = GLYPHS[character];
  if (!entry) return null;
  return { advanceWidthMm: entry.advanceWidthMm, stones: entry.stones };
}

/**
 * Optional family-level kerning hook, consumed by RhinestoneFontProvider.getTextPath(). Returns an
 * mm adjustment (negative tightens, positive loosens) applied to the pen position before placing
 * `nextChar`'s stones. Additive only -- absent for any family that doesn't define it.
 * @param {string} prevChar
 * @param {string} nextChar
 * @returns {number}
 */
export const getKerningAdjustmentMm = createKerningTable(KERNING_PAIRS_MM);

export const renderOptions = {};
