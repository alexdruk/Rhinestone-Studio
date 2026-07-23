/**
 * RS Block -- TXT-101B, the first production-quality original rhinestone font.
 *
 * Builds on the approved RS Block Prototype (SS10) approach (see families/rsBlockPrototypeSS10.js
 * and RhinestoneFontProvider.js's module doc): every glyph is a hand-placed dot-matrix pattern of
 * literal stone-center positions at a single fixed pitch, delivered to GeometryEngine via
 * FontProviderResult.stoneCenters -- no centerline, no vector outline, no derivation from any
 * shared skeleton or from another glyph in this same file. Full coverage: A-Z, a-z, 0-9, space,
 * and . , ! ? ' - &.
 *
 * Vertical zones (in PITCH_MM units, measured from the baseline at row 0):
 *   - Cap/ascender height: rows 0-6 (uppercase, digits, ascender lowercase b d f h k l).
 *   - x-height: rows 0-4 (lowercase without ascender/descender).
 *   - Descender: rows -2 to -1, below the baseline (lowercase g j p q y).
 *   - t's ascender is one row shorter than a full ascender (row 5, not 6) -- the one deliberate
 *     height break from "every ascender reaches cap height", matching how t reads in real type.
 * Each glyph specifies its own row width (ink columns) rather than a fixed column count, so advance
 * width is chosen per letter for optical spacing (e.g. i/l/1/./,/'  are narrow, m is wide) rather
 * than forced uniform width.
 *
 * Lowercase bowls (b d p q) use a flat-sided rectilinear shape rather than a round one where they
 * merge into a stem -- free-standing round counters (o, a, uppercase O/C/G/Q) stay round. This
 * follows the font-perf lesson from the two earlier failed vector attempts: flat/rectilinear shapes
 * read more reliably than round ones at sparse stone resolution (see docs/memory
 * rhinestone-studio-font-perf-lesson).
 *
 * Kerning: KERNING_PAIRS_MM below adjusts pen advance for specific reviewed pairs (AV VA WA AW To
 * Yo LA LT TT TA FA PA LY RY) where the default per-glyph advance leaves a visually oversized or
 * undersized gap. Exposed via this module's own getKerningAdjustmentMm(prevChar, nextChar) -- an
 * additive, optional family hook that RhinestoneFontProvider.getKerningAdjustmentMm() delegates to,
 * which FontProviderRegistry.getKerningAdjustmentMm() in turn exposes to GeometryEngine (the only
 * place that walks a text run's pen position character by character -- see
 * GeometryEngine._buildPositionedContours()). None of this changes the stoneCenters/
 * FontProviderResult contract, and a family without this method (e.g. the SS10 prototype) behaves
 * exactly as before.
 */

export const PITCH_MM = 3.1;

// Vertical layout constants, in row units from baseline (see module doc).
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
  I: glyph(['XXX', '.X.', '.X.', '.X.', '.X.', '.X.', 'XXX'], { topRow: CAP_TOP_ROW, advanceCols: 4 }),
  J: glyph(['..XX', '...X', '...X', '...X', '...X', 'X..X', '.XX.'], { topRow: CAP_TOP_ROW }),
  K: glyph(['X...X', 'X..X.', 'X.X..', 'XX...', 'X.X..', 'X..X.', 'X...X'], { topRow: CAP_TOP_ROW }),
  L: glyph(['X....', 'X....', 'X....', 'X....', 'X....', 'X....', 'XXXXX'], { topRow: CAP_TOP_ROW }),
  M: glyph(['X...X', 'XX.XX', 'X.X.X', 'X...X', 'X...X', 'X...X', 'X...X'], { topRow: CAP_TOP_ROW }),
  N: glyph(['X...X', 'XX..X', 'X.X.X', 'X..XX', 'X...X', 'X...X', 'X...X'], { topRow: CAP_TOP_ROW }),
  O: glyph(['.XXX.', 'X...X', 'X...X', 'X...X', 'X...X', 'X...X', '.XXX.'], { topRow: CAP_TOP_ROW }),
  P: glyph(['XXXX.', 'X...X', 'X...X', 'XXXX.', 'X....', 'X....', 'X....'], { topRow: CAP_TOP_ROW }),
  Q: glyph(['.XXX.', 'X...X', 'X...X', 'X...X', 'X...X', 'X..X.', '.XX.X', '...X.'], { topRow: CAP_TOP_ROW }),
  R: glyph(['XXXX.', 'X...X', 'X...X', 'XXXX.', 'X.X..', 'X..X.', 'X...X'], { topRow: CAP_TOP_ROW }),
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
// Digits -- 0 and 5 are deliberately distinguished from letters O and S (see module doc).
// ---------------------------------------------------------------------------------------------
const DIGITS = {
  0: glyph(['.XXX.', 'X...X', 'X..XX', 'X.X.X', 'XX..X', 'X...X', '.XXX.'], { topRow: CAP_TOP_ROW }),
  1: glyph(['.X.', 'XX.', '.X.', '.X.', '.X.', '.X.', 'XXX'], { topRow: CAP_TOP_ROW, advanceCols: 4 }),
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
// capitals. h/n and b/d/p/q intentionally share their x-height structure where real lowercase
// letterforms do too (h is "n with an ascender"; b/d/p/q are stem+bowl mirrors of each other) --
// each is still an individually authored pattern, not derived from one shared skeleton.
// ---------------------------------------------------------------------------------------------
const LOWERCASE = {
  a: glyph(['.XXX.', '....X', '.XXXX', 'X...X', '.XXXX'], { topRow: X_HEIGHT_TOP_ROW }),
  b: glyph(['X....', 'X....', 'XXXX.', 'X...X', 'X...X', 'X...X', 'XXXX.'], { topRow: CAP_TOP_ROW }),
  c: glyph(['.XXX.', 'X...X', 'X....', 'X...X', '.XXX.'], { topRow: X_HEIGHT_TOP_ROW }),
  d: glyph(['....X', '....X', '.XXXX', 'X...X', 'X...X', 'X...X', '.XXXX'], { topRow: CAP_TOP_ROW }),
  e: glyph(['.XXX.', 'X...X', 'XXXXX', 'X....', '.XXXX'], { topRow: X_HEIGHT_TOP_ROW }),
  f: glyph(['..XX.', '.X...', 'XXXX.', '.X...', '.X...', '.X...', '.X...'], { topRow: CAP_TOP_ROW }),
  g: glyph(['.XXX.', 'X...X', 'X...X', 'X...X', '.XXXX', '....X', 'XXXX.'], { topRow: X_HEIGHT_TOP_ROW }),
  h: glyph(['X....', 'X....', 'XXXXX', 'X...X', 'X...X', 'X...X', 'X...X'], { topRow: CAP_TOP_ROW }),
  i: glyph(['X', '.', 'X', 'X', 'X', 'X', 'X'], { topRow: CAP_TOP_ROW, advanceCols: 2 }),
  j: glyph(['.X', '..', '.X', '.X', '.X', '.X', '.X', '.X', 'X.'], { topRow: CAP_TOP_ROW, advanceCols: 3 }),
  k: glyph(['X....', 'X....', 'X..X.', 'X.X..', 'XX...', 'X.X..', 'X..X.'], { topRow: CAP_TOP_ROW }),
  l: glyph(['X', 'X', 'X', 'X', 'X', 'X', 'X'], { topRow: CAP_TOP_ROW, advanceCols: 2 }),
  m: glyph(['XXXXXXX', 'X..X..X', 'X..X..X', 'X..X..X', 'X..X..X'], { topRow: X_HEIGHT_TOP_ROW }),
  n: glyph(['XXXXX', 'X...X', 'X...X', 'X...X', 'X...X'], { topRow: X_HEIGHT_TOP_ROW }),
  o: glyph(['.XXX.', 'X...X', 'X...X', 'X...X', '.XXX.'], { topRow: X_HEIGHT_TOP_ROW }),
  p: glyph(['XXXX.', 'X...X', 'X...X', 'X...X', 'XXXX.', 'X....', 'X....'], { topRow: X_HEIGHT_TOP_ROW }),
  q: glyph(['.XXXX', 'X...X', 'X...X', 'X...X', '.XXXX', '....X', '....X'], { topRow: X_HEIGHT_TOP_ROW }),
  r: glyph(['XXXX.', 'X...X', 'X....', 'X....', 'X....'], { topRow: X_HEIGHT_TOP_ROW }),
  s: glyph(['.XXXX', 'X....', '.XXX.', '....X', 'XXXX.'], { topRow: X_HEIGHT_TOP_ROW }),
  t: glyph(['.X...', 'XXXX.', '.X...', '.X...', '.X...', '..XX.'], { topRow: X_HEIGHT_TOP_ROW + 1 }),
  // u borrows U's tapered-corner bottom transition ('.XXX.') instead of a flat full-width bar, so
  // the two share the same family geometry at the baseline -- just one row shorter (x-height).
  u: glyph(['X...X', 'X...X', 'X...X', 'X...X', '.XXX.'], { topRow: X_HEIGHT_TOP_ROW }),
  v: glyph(['X...X', 'X...X', 'X...X', '.X.X.', '..X..'], { topRow: X_HEIGHT_TOP_ROW }),
  // w borrows W's own diagonal double-V construction (the bottom 5 rows of the 7-row uppercase W
  // pattern, reused verbatim at x-height) instead of a flat-bottomed 3-leg bar, so the two share
  // the same family geometry -- narrower (5 cols, matching v/x) than the previous 7-col bar version.
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
// Kerning -- reviewed pairs only (see module doc). Values are in PITCH_MM units (negative tightens).
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
  id: 'rs-block',
  displayName: 'RS Block',
  category: 'rhinestone-native',
  recommendedStoneSizeMm: 2.8,
  minStoneSizeMm: 2.8,
  recommendedGapMm: 0.3,
  recommendedUses: ['Names', 'Team and sports names', 'Wedding phrases', 'Short business names'],
  // Same explicit-stone-center contract as RS Block Prototype (SS10) -- see
  // RhinestoneFontProvider.js's module doc. GeometryEngine.generateTextLayout() ignores a text
  // layer's stored Outline/Fill mode entirely for this family.
  fillModeIndependent: true,
  notes: 'First production-quality original rhinestone font (TXT-101B). Full coverage: A-Z, a-z, ' +
    '0-9, space, and . , ! ? \' - &. Each glyph is an individually hand-authored stone-center ' +
    'pattern at a fixed SS10 (2.8mm) + 0.3mm gap pitch -- no shared skeleton, no scaled capitals ' +
    'for lowercase, no auto-conversion from any outline font. Reviewed kerning pairs: AV VA WA AW ' +
    'To Yo LA LT TT TA FA PA LY RY.'
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
export function getKerningAdjustmentMm(prevChar, nextChar) {
  return KERNING_PAIRS_MM[`${prevChar}${nextChar}`] ?? 0;
}

export const renderOptions = {};
