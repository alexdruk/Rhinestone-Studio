// READ-009 -- shared auto-fit floor logic, extracted from app.js's computeAutoFitScale() so the
// legibility floor (READ-008) reaches every auto-fit call site, not just the live-editing app.
//
// stoneSize itself never scales down during auto-fit -- it is a real catalog rhinestone
// (src/renderer/StoneSizes.js), not a continuously-adjustable display value, and shrinking it would
// silently produce a non-orderable size. Below MIN_HEIGHT_TO_STONE_RATIO stone diameters there are
// too few stones across a glyph's shrunk stroke width for the letterform to read as anything but a
// blurred row of dots. Auto-fit still shrinks heightMm as much as it can within this floor; only
// text so long it would need to shrink past the floor overflows maxWidth instead of collapsing into
// stone soup.
//
// Value 16: READ-007's calibration set cannot locate a boundary below ratio 20 -- every ratio under
// 20 is a uniform zero-cost floor there, so it cannot distinguish 15 from 20 (READ-007 §8). 16 is
// chosen on independent evidence: StoneSizes.js's five supportedHeightRangeMm minima imply ratios of
// 17.50 / 16.07 / 16.25 / 17.02 / 16.56 (SS6..SS30) -- five independently derived minima converging
// on 16-17.5, and a floor of 20 would put SS30's entire validated range permanently in warning.
// 16-20 remains an unresolved band; see docs/specifications/READ-008-RatioFloor.md.
export const MIN_HEIGHT_TO_STONE_RATIO = 16;

export const PRINTABLE_MARGIN_MM = 10;

export function maxAutoFitWidthMm(canvasWidthMm) {
  return canvasWidthMm - PRINTABLE_MARGIN_MM;
}

// Computes the heightMm scale factor auto-fit text applies, given the text's straight (unscaled)
// measured widthMm. `scale` is 1 (no change) whenever the text already fits or the inputs are
// degenerate. `degenerate` is true when heightMm/stoneSizeMm aren't usable numbers -- this module
// has two callers on two different schemas (app.js's live layer fields vs. the Gallery fixture
// bridge's `.rhs` fields), and a caller that passes the wrong field names would otherwise silently
// fall back to plain fit-to-width with every test still green rather than surfacing the mismatch.
export function computeTextAutoFitScale({ measuredWidthMm, maxWidthMm, heightMm, stoneSizeMm }) {
  if (!(measuredWidthMm > 0) || !(maxWidthMm > 0) || measuredWidthMm <= maxWidthMm) {
    return { scale: 1, floored: false, degenerate: false };
  }
  const fitScale = maxWidthMm / measuredWidthMm;
  const degenerate = !(heightMm > 0) || !(stoneSizeMm > 0);
  if (degenerate) return { scale: fitScale, floored: false, degenerate: true };
  const minScale = (stoneSizeMm * MIN_HEIGHT_TO_STONE_RATIO) / heightMm;
  const scale = Math.min(1, Math.max(fitScale, minScale));
  return { scale, floored: scale > fitScale, degenerate: false };
}
