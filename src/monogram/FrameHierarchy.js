/**
 * MONO-014: frame / letter visual hierarchy.
 *
 * The product rule (docs/specifications/MONO-014-FrameHierarchy.md): a monogram frame is either
 * clearly subordinate to the letters or clearly dominant over them -- never the same stone size,
 * which reads as two elements competing at equal weight. When the MONO-010 frame-stone toggle is
 * left unchecked, app.js's request builder is now in "automatic hierarchy" mode: it calls
 * defaultFrameStoneSizeMm() to pick the frame's own stone size one catalog rung above the letters',
 * so the ring frames the monogram rather than competing with it.
 *
 * Pure arithmetic over the StoneSizes.js catalog -- no DOM, no MonogramGenerator, no geometry. This
 * is the READ-009 situation (a shared module function), so tests import it directly rather than
 * slicing it out of app.js.
 */

import { listStoneSizes } from '../renderer/StoneSizes.js';

/**
 * The frame stone diameter (mm) one rung larger than `letterStoneSizeMm` in the shipped stone-size
 * catalog, or the largest catalog diameter when the letters are already at (or above) the top rung.
 *
 * src/renderer/StoneSizes.js:170 (validateStoneSizeCatalog's strictly-ascending assertion)
 * guarantees the catalog is sorted by ascending diameterMm, so "the next larger diameter" is simply
 * the first entry whose diameter exceeds the letters' -- no defensive sort here.
 *
 * @param {number} letterStoneSizeMm
 * @returns {number}
 */
export function defaultFrameStoneSizeMm(letterStoneSizeMm) {
  const diameters = listStoneSizes().map((s) => s.diameterMm);
  const nextLarger = diameters.find((d) => d > letterStoneSizeMm);
  return nextLarger !== undefined ? nextLarger : diameters[diameters.length - 1];
}
