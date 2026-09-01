/**
 * READ-003 / READ-004 — the single source of truth for the "stroke narrower than one stone"
 * physical-impossibility gate (Layer 1 of the readability program,
 * docs/specifications/READ-000-readability-architecture.md).
 *
 * Pure arithmetic: no FontManager, no layer object, no DOM. The caller resolves the layer's font
 * and fill mode and builds any user-facing label; this module owns only the decision.
 *
 * ## The arithmetic
 *
 * `stemWidthMm = stemWidthRatio * heightMm`, where `stemWidthRatio` is the dimensionless
 * stroke-to-height fraction measured offline per font by tools/measure-font-stem-width.mjs and
 * stored in assets/fonts/manifest.json. The gate fires when `stemWidthMm < stoneSizeMm`: a stone
 * dropped into a region narrower than its own diameter overhangs both edges, so no sampling of
 * that interior can render the letterform. That is geometry, not a quality judgement.
 *
 * ## Why only the interior-fill modes
 *
 * The impossibility argument is specifically about FILLING AN INTERIOR. It holds for the
 * interior-filling fill styles (Grid/Staggered/Radial/Contour) and NOT for Outline mode, where
 * stones trace the letterform as a single bead line — a hairline script rendered that way is the
 * canonical rhinestone result, not a defect (Great Vibes @ 42.5mm/SS6 and Dancing Script @
 * 34.3mm/SS6, both stem-to-stone ~0.7, are product-owner-confirmed good; the cases this still
 * catches are Cinzel radial @ 0.56 and Caveat fill @ 0.61). An absent or unrecognised mode should
 * be resolved to 'outline' by the caller before it gets here, so it stays silent — a false
 * "impossible" verdict on a good design is worse than a missed warning.
 */

// The four interior-filling text fill modes. Outline is deliberately absent (see the module doc).
export const INTERIOR_FILL_MODES = new Set(['fill', 'staggered', 'radial', 'contour']);

/**
 * @param {object} params
 * @param {number} params.stemWidthRatio Dimensionless stroke/height fraction (font.stemWidthRatio).
 * @param {number} params.heightMm Text layer height in millimetres.
 * @param {number} params.stoneSizeMm Stone diameter in millimetres.
 * @param {string} params.mode Already-resolved text fill mode ('outline'|'fill'|'staggered'|'radial'|'contour').
 * @returns {{ stemWidthMm: number, stoneSizeMm: number } | null} Non-null only when the stroke is
 *   physically narrower than one stone in an interior-fill mode; null in every other case
 *   (outline/unknown mode, missing or non-finite ratio, non-finite height/stone size, stroke wide
 *   enough).
 */
export function strokeNarrowerThanOneStone({ stemWidthRatio, heightMm, stoneSizeMm, mode } = {}) {
  if (!INTERIOR_FILL_MODES.has(mode)) return null;
  if (typeof stemWidthRatio !== 'number' || !Number.isFinite(stemWidthRatio)) return null;
  if (!Number.isFinite(heightMm) || !Number.isFinite(stoneSizeMm)) return null;
  const stemWidthMm = stemWidthRatio * heightMm;
  if (!(stemWidthMm < stoneSizeMm)) return null;
  return { stemWidthMm, stoneSizeMm };
}
