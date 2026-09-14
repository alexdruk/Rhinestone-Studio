/**
 * The two script-face font lists the READ-005A calibration set is built from.
 *
 * Data only, zero imports. Relocated here (READ-007A) from calibration-renders.mjs so the ratings
 * analysis (tools/font-certification/analyze-ratings.mjs) can share the exact same lists without
 * importing the render builder — which drags in src/geometry, src/fonts, src/text and Playwright.
 * calibration-renders.mjs (the joined-scripts and non-script-outline block selection) and
 * analyze-ratings.mjs (READ-007 §4.4's non-script cut) are the two consumers; they must never drift.
 *
 * This module is deliberately dependency-free. analyze-ratings.mjs recomputes the frozen READ-005
 * derived tables (docs/data/read-005/derived-tables.json) and must stay runnable from a bare clone
 * with no `npm install` — its whole transitive import graph is this file plus node: builtins.
 * Do not add an import from src/ or from any npm package to this module.
 */

// The seven joined-script faces spec §5 names for the joined-scripts block.
export const JOINED_SCRIPT_FONTS = [
  'great-vibes-regular', 'dancing-script-regular', 'allura-regular',
  'alex-brush-regular', 'parisienne-regular', 'cookie-regular', 'mr-dafoe-regular'
];

// Faces that are unambiguously NOT connected scripts — the pool for the non-script outline block.
// (Everything cursive/handwritten is deliberately excluded, matching spec §5's intent.)
export const NON_SCRIPT_FONTS = new Set([
  'courier-prime-regular', 'pt-serif-regular', 'playfair-display-regular', 'cinzel-regular',
  'anton-regular', 'bebas-neue-regular', 'righteous-regular', 'lilita-one-regular',
  'abril-fatface-regular', 'poppins-regular', 'poppins-semibold', 'poppins-bold',
  'baloo2-variable-regular'
]);
