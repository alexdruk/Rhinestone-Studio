/**
 * Shared original letterform skeletons for RS Block and RS Modern (TXT-101A).
 *
 * This is centerline data, not digitized outline data from any existing typeface: every stroke
 * below is an original construction from first principles (a stem is a vertical line, a bowl is an
 * elliptical arc, a crossbar is a horizontal line, etc.), authored directly for this project. RS
 * Block and RS Modern deliberately share this one skeleton (see families/rsBlock.js and
 * families/rsModern.js) -- what makes them genuinely different families is not the letter skeleton
 * but the *stroke construction*: RS Block renders it with a thick, chunky stroke and coarse curve
 * faceting; RS Modern renders the same skeleton with a thin stroke, fully round joins, and smooth
 * true-circle curves. RS Script (families/rsScript.js) does not use this module at all -- it is an
 * independently authored, tapered, connected-stroke construction, because a monoline skeleton has no
 * way to represent calligraphic width variation or letter-to-letter connection.
 *
 * Units: an abstract glyph-unit space, UNITS_PER_EM per em (matching the "unitsPerEm" convention
 * OpenTypeProvider.js already scales by, so a rhinestone font's `heightMm` behaves the same way an
 * OpenType font's does -- see RhinestoneFontProvider.js).
 *
 * BASELINE = 0. CAP_HEIGHT/ASCENDER = 70. X_HEIGHT = 50. DESCENDER = -20.
 *
 * A bowl/arch attached to a stem must land its open arc's endpoints *exactly* on that stem's line --
 * RhinestoneStrokeGeometry.js builds each stroke as its own independent ribbon and only relies on
 * strokes overlapping (not on any implicit snapping) to fuse into one solid letterform, so a
 * several-unit gap between an arc's endpoint and the stem it's meant to attach to reads as a visible
 * disconnect, not a rounding error. rightBowl()/leftBowl()/topArch() below exist specifically to
 * make that attachment exact by construction (their radius and the stem coordinate are the same
 * number), rather than something to eyeball per letter -- this was gotten wrong in an earlier
 * version of this file (verified by rendering every glyph and finding several letters, e.g. "n",
 * whose arc endpoints didn't actually reach their stems) and every bowl/arch letter below now goes
 * through one of these three helpers for exactly that reason.
 */

export const UNITS_PER_EM = 100;
export const CAP_HEIGHT = 70;
export const X_HEIGHT = 50;
export const BASELINE = 0;
export const DESCENDER = -20;
export const ASCENDER = 70;
// Side bearing added on both sides of a glyph's authored ink width to get its advance width.
export const SIDE_BEARING = 6;

function pt(x, y) {
  return { x, y };
}

function open(...coords) {
  const points = [];
  for (let i = 0; i < coords.length; i += 2) points.push(pt(coords[i], coords[i + 1]));
  return { points, closed: false };
}

function ellipseLoop(cx, cy, rx, ry, segments = 24) {
  const points = [];
  for (let i = 0; i < segments; i++) {
    const t = (i / segments) * Math.PI * 2;
    points.push(pt(cx + rx * Math.cos(t), cy + ry * Math.sin(t)));
  }
  return { points, closed: true };
}

// Open elliptical arc from startDeg to endDeg, sweeping linearly (in whichever direction --
// increasing or decreasing -- gets from startDeg to endDeg as given; callers pick the direction that
// sweeps through the correct side). Standard math convention: 0deg = +x (right), 90deg = +y (up).
function arc(cx, cy, rx, ry, startDeg, endDeg, segments = 20) {
  const points = [];
  const startRad = (startDeg * Math.PI) / 180;
  const endRad = (endDeg * Math.PI) / 180;
  for (let i = 0; i <= segments; i++) {
    const t = startRad + ((endRad - startRad) * i) / segments;
    points.push(pt(cx + rx * Math.cos(t), cy + ry * Math.sin(t)));
  }
  return { points, closed: false };
}

// A half-ellipse bulging right (+x) from a vertical stem at x=stemX, attaching exactly at
// (stemX, yBottom) and (stemX, yTop) -- e.g. "D"/"P"/"B"'s bowls, "b"'s bowl.
function rightBowl(stemX, yBottom, yTop, bulgeWidth, segments = 20) {
  return arc(stemX, (yBottom + yTop) / 2, bulgeWidth, (yTop - yBottom) / 2, -90, 90, segments);
}

// A half-ellipse bulging left (-x) from a vertical stem at x=stemX -- "d"/"q"'s bowls.
function leftBowl(stemX, yBottom, yTop, bulgeWidth, segments = 20) {
  return arc(stemX, (yBottom + yTop) / 2, bulgeWidth, (yTop - yBottom) / 2, 90, 270, segments);
}

// An arch at height y connecting two stems at x=leftX and x=rightX, bulging up by archHeight --
// "h"/"m"/"n"'s shoulders.
function topArch(leftX, rightX, y, archHeight, segments = 16) {
  return arc((leftX + rightX) / 2, y, (rightX - leftX) / 2, archHeight, 180, 0, segments);
}

function glyph(width, strokes) {
  return { width, strokes };
}

// --- Uppercase A-Z --------------------------------------------------------------------------
const UPPERCASE = {
  A: glyph(50, [open(0, 0, 25, 70, 50, 0), open(11, 26, 39, 26)]),
  B: glyph(46, [open(0, 0, 0, 70), rightBowl(0, 34, 70, 20), rightBowl(0, 0, 36, 20)]),
  C: glyph(54, [arc(27, 35, 25, 33, 40, 320)]),
  D: glyph(48, [open(0, 0, 0, 70), rightBowl(0, 0, 70, 44)]),
  E: glyph(46, [open(0, 0, 0, 70), open(0, 70, 42, 70), open(0, 35, 36, 35), open(0, 0, 42, 0)]),
  F: glyph(46, [open(0, 0, 0, 70), open(0, 70, 42, 70), open(0, 35, 36, 35)]),
  G: glyph(54, [arc(27, 35, 25, 33, 40, 320), open(46, 14, 28, 14)]),
  H: glyph(50, [open(0, 0, 0, 70), open(50, 0, 50, 70), open(0, 35, 50, 35)]),
  I: glyph(16, [open(8, 0, 8, 70)]),
  J: glyph(36, [open(30, 70, 30, 15), arc(18, 15, 12, 15, 0, -180)]),
  K: glyph(50, [open(0, 0, 0, 70), open(50, 70, 0, 35), open(0, 35, 50, 0)]),
  L: glyph(46, [open(0, 70, 0, 0), open(0, 0, 42, 0)]),
  M: glyph(56, [open(0, 0, 0, 70, 28, 20, 56, 70, 56, 0)]),
  N: glyph(50, [open(0, 0, 0, 70, 50, 0, 50, 70)]),
  O: glyph(54, [ellipseLoop(27, 35, 26, 33)]),
  P: glyph(44, [open(0, 0, 0, 70), rightBowl(0, 34, 70, 20)]),
  Q: glyph(54, [ellipseLoop(27, 35, 26, 33), open(45, 12, 58, -8)]),
  R: glyph(50, [open(0, 0, 0, 70), rightBowl(0, 34, 70, 20), open(6, 32, 50, 0)]),
  S: glyph(48, [leftBowl(24, 35, 68, 16), rightBowl(24, 2, 35, 16)]),
  T: glyph(50, [open(0, 70, 50, 70), open(25, 70, 25, 0)]),
  U: glyph(50, [open(0, 70, 0, 20), arc(25, 20, 25, 20, 180, 360), open(50, 20, 50, 70)]),
  V: glyph(50, [open(0, 70, 25, 0, 50, 70)]),
  W: glyph(60, [open(0, 70, 15, 0, 30, 45, 45, 0, 60, 70)]),
  X: glyph(50, [open(0, 70, 50, 0), open(0, 0, 50, 70)]),
  Y: glyph(50, [open(0, 70, 25, 35, 50, 70), open(25, 35, 25, 0)]),
  Z: glyph(50, [open(0, 70, 50, 70, 0, 0, 50, 0)])
};

// --- Digits 0-9 -------------------------------------------------------------------------------
const DIGITS = {
  0: glyph(48, [ellipseLoop(24, 35, 18, 33)]),
  1: glyph(48, [open(10, 55, 24, 70, 24, 0), open(12, 0, 36, 0)]),
  2: glyph(50, [arc(24, 54, 18, 14, 160, -20, 16), open(41, 49, 4, 0), open(4, 0, 48, 0)]),
  3: glyph(46, [rightBowl(8, 35, 68, 18), rightBowl(8, 2, 35, 18)]),
  4: glyph(50, [open(34, 70, 4, 22), open(4, 22, 48, 22), open(34, 70, 34, 0)]),
  5: glyph(46, [open(6, 70, 44, 70), open(6, 70, 6, 38), rightBowl(6, 0, 38, 20)]),
  6: glyph(48, [arc(28, 50, 16, 20, 90, 220, 16), ellipseLoop(24, 17, 20, 17)]),
  7: glyph(50, [open(4, 70, 48, 70), open(48, 70, 16, 0)]),
  8: glyph(46, [ellipseLoop(24, 51, 18, 17), ellipseLoop(24, 18, 19, 18)]),
  9: glyph(48, [ellipseLoop(24, 51, 19, 18), arc(24, 25, 19, 25, -90, 80)])
};

// --- Lowercase a-z (x-height, ascenders to ASCENDER, descenders to DESCENDER) -----------------
const LOWERCASE = {
  a: glyph(42, [leftBowl(38, 2, 40, 18), open(38, 44, 38, 0)]),
  b: glyph(40, [open(0, 70, 0, 0), rightBowl(0, 0, 34, 17)]),
  c: glyph(40, [arc(20, 22, 18, 22, 35, 325)]),
  d: glyph(42, [open(38, 70, 38, 0), leftBowl(38, 0, 34, 17)]),
  e: glyph(40, [ellipseLoop(20, 22, 18, 20), open(2, 24, 38, 24)]),
  f: glyph(36, [open(20, 70, 20, 0), open(6, 50, 34, 50), arc(28, 62, 8, 8, 180, 270)]),
  g: glyph(40, [leftBowl(36, 5, 45, 17), open(36, 45, 36, -18), arc(22, -18, 14, 10, 0, -180)]),
  h: glyph(40, [open(0, 70, 0, 0), topArch(0, 36, 30, 14), open(36, 30, 36, 0)]),
  i: glyph(16, [open(6, 50, 6, 0), open(6, 64, 6, 64)]),
  j: glyph(32, [open(24, 50, 24, -14), open(24, 64, 24, 64), arc(14, -14, 10, 8, 0, -170)]),
  k: glyph(36, [open(0, 70, 0, 0), open(0, 24, 30, 50), open(0, 24, 30, 0)]),
  l: glyph(20, [open(10, 70, 10, 0)]),
  m: glyph(72, [open(0, 50, 0, 0), topArch(0, 34, 32, 14), open(34, 32, 34, 0), topArch(34, 68, 32, 14), open(68, 32, 68, 0)]),
  n: glyph(40, [open(0, 50, 0, 0), topArch(0, 36, 32, 18), open(36, 32, 36, 0)]),
  o: glyph(40, [ellipseLoop(20, 25, 18, 24)]),
  p: glyph(40, [open(0, 45, 0, -20), rightBowl(0, 5, 45, 17)]),
  q: glyph(40, [open(38, 45, 38, -20), leftBowl(38, 5, 45, 17)]),
  r: glyph(30, [open(0, 50, 0, 0), arc(14, 32, 14, 10, 180, 60, 10)]),
  s: glyph(34, [leftBowl(17, 24, 46, 12), rightBowl(17, 4, 24, 12)]),
  t: glyph(34, [open(16, 64, 16, 10), open(2, 50, 32, 50), arc(22, 10, 6, 8, 180, 270)]),
  u: glyph(38, [open(0, 50, 0, 15), arc(18, 15, 18, 15, 180, 360), open(36, 15, 36, 50)]),
  v: glyph(38, [open(0, 50, 18, 0, 36, 50)]),
  w: glyph(42, [open(0, 50, 10, 0, 20, 28, 30, 0, 40, 50)]),
  x: glyph(34, [open(0, 50, 32, 0), open(0, 0, 32, 50)]),
  y: glyph(38, [open(0, 50, 18, 15), open(36, 50, 18, 15, 4, -18)]),
  z: glyph(36, [open(2, 50, 34, 50, 2, 0, 34, 0)])
};

// --- Punctuation (the "common punctuation already supported by the current text system" set) --
const PUNCTUATION = {
  ' ': glyph(28, []),
  '.': glyph(14, [{ ...open(6, 4, 6, 4), width: 13 }]),
  ',': glyph(14, [{ ...open(9, 6, 9, 4, 3, -8), width: 9 }]),
  '!': glyph(18, [open(9, 68, 9, 20), { ...open(9, 4, 9, 4), width: 11 }]),
  '?': glyph(30, [arc(17, 53, 13, 15, 150, -120, 16), open(11, 40, 15, 30, 15, 20), { ...open(15, 4, 15, 4), width: 11 }]),
  "'": glyph(12, [{ ...open(6, 68, 4, 54), width: 8 }]),
  '-': glyph(28, [{ ...open(2, 26, 26, 26), width: 12 }]),
  '&': glyph(48, [ellipseLoop(20, 16, 17, 16), ellipseLoop(24, 48, 13, 13), open(20, 20, 44, 0)])
};

export const SKELETON_GLYPHS = Object.freeze({
  ...UPPERCASE,
  ...DIGITS,
  ...LOWERCASE,
  ...PUNCTUATION
});

export const SKELETON_SUPPORTED_CHARACTERS = Object.freeze(Object.keys(SKELETON_GLYPHS));

export function getSkeletonGlyph(character) {
  return SKELETON_GLYPHS[character] ?? null;
}
