// READ-011A -- classify a font by the stroke regime implied by its measured stemWidthRatio.
//
// Dependency-free leaf module (zero imports), a sibling of TextAutoFit.js. Nothing consumes it yet:
// this milestone only establishes the classification and its provenance, so a later milestone can
// give each regime its own auto-fit legibility floor instead of the single MIN_HEIGHT_TO_STONE_RATIO
// TextAutoFit.js applies to every font today.
//
// -- Mechanism the floor targets --
// TextAutoFit.js's own comment names the failure: below MIN_HEIGHT_TO_STONE_RATIO stone diameters
// "there are too few stones across a glyph's shrunk stroke width for the letterform to read as
// anything but a blurred row of dots". How many stones span a stem is a property of stroke width
// relative to glyph height -- exactly what stemWidthRatio measures -- not of whether the font is a
// connected script. A monoline script (Allura) and a monoline sans (the hairline Montserrat build)
// collapse the same way under shrink; a massed script (Pacifico) and a massed block (Anton) both
// tolerate far more. Stroke regime is the axis the floor actually depends on, so it replaces the
// script / non-script axis earlier readability work leaned on.
//
// -- Boundary provenance --
// Stones across a stem = R x stemWidthRatio, where R is the height-to-stone ratio
// (heightMm / stoneSizeMm). So a stemWidthRatio of 1/R puts exactly one stone across the stem at
// height-to-stone ratio R. With SS30 out of scope the reachable R band runs roughly 16 to 25:
//
//   1 / 25 = 0.04    -- below this, a stem never reaches one stone across, even at the most
//                       favourable R in the band.
//   1 / 16 = 0.0625  -- at this width or above, a stem always clears one stone across, even at the
//                       least favourable R in the band.
//
// Between the two, whether a stem clears one stone across depends on R. These are stated as literals
// on purpose: deriving them from MIN_HEIGHT_TO_STONE_RATIO would make the class boundaries shift
// whenever that floor moves, which is precisely the coupling this classification exists to avoid.
export const MONOLINE_MAX_STEM_WIDTH_RATIO = 0.04;
export const MASSED_MIN_STEM_WIDTH_RATIO = 0.0625;

// The four possible results of classifyStemRegime(). `unmeasured` is a first-class value, not a
// missing case: a font with no usable numeric stemWidthRatio must land here rather than fall through
// to a regime default.
export const STEM_REGIME = Object.freeze({
  MONOLINE: 'monoline',
  TRANSITIONAL: 'transitional',
  MASSED: 'massed',
  UNMEASURED: 'unmeasured'
});

// Maps a font's measured stemWidthRatio to one of the four STEM_REGIME values:
//
//   stemWidthRatio < 0.04            -> 'monoline'
//   0.04 <= stemWidthRatio < 0.0625  -> 'transitional'
//   stemWidthRatio >= 0.0625         -> 'massed'
//   no usable numeric measurement    -> 'unmeasured'
//
// Non-numeric, NaN, Infinity, negative and zero inputs all resolve to 'unmeasured'.
// assets/fonts/manifest.json's rhinestone-provider Production Fonts (rs-block, rs-modern) have
// individually authored stone positions rather than vector outlines and carry no stemWidthRatio;
// rs-block is the project default font, so the unmeasured path is live, not theoretical.
export function classifyStemRegime(stemWidthRatio) {
  if (typeof stemWidthRatio !== 'number' || !Number.isFinite(stemWidthRatio) || stemWidthRatio <= 0) {
    return STEM_REGIME.UNMEASURED;
  }
  if (stemWidthRatio < MONOLINE_MAX_STEM_WIDTH_RATIO) return STEM_REGIME.MONOLINE;
  if (stemWidthRatio < MASSED_MIN_STEM_WIDTH_RATIO) return STEM_REGIME.TRANSITIONAL;
  return STEM_REGIME.MASSED;
}
