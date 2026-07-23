/**
 * RS Block -- clear, sturdy, general-purpose/sports rhinestone letterform family (TXT-101A).
 *
 * Renders the shared original skeleton (skeletonGlyphs.js) as a thick, uniform-width stroke with
 * coarse curve faceting -- deliberately chunky, high-contrast-at-a-distance letterforms and a
 * larger recommended stone size/gap, suited to jersey names/numbers and bold general text where a
 * few missing or slightly-touching stones at production tolerances won't read as a defect.
 */

import { UNITS_PER_EM, CAP_HEIGHT, SIDE_BEARING, getSkeletonGlyph } from '../skeletonGlyphs.js';

const STROKE_WIDTH_UNITS = 15; // ~21% of CAP_HEIGHT -- thick, bold stroke.
const CAPSULE_SEGMENTS = 8; // Coarse faceting: visibly chunkier curves than RS Modern's smooth arcs.

export const descriptor = {
  id: 'rs-block-regular',
  displayName: 'RS Block',
  category: 'block',
  unitsPerEm: UNITS_PER_EM,
  capHeightUnits: CAP_HEIGHT,
  recommendedStoneSizeMm: 2.4,
  minStoneSizeMm: 1.8,
  recommendedGapMm: 0.4,
  recommendedUses: ['Sports jerseys and team names', 'Bold general-purpose text', 'High-visibility signage-style designs'],
  notes: 'Thick uniform stroke, coarse curve faceting, generous stone pitch -- built to stay legible and production-safe at larger stone sizes.'
};

export function getGlyphStrokes(character) {
  const skeleton = getSkeletonGlyph(character);
  if (!skeleton) return null;
  return { width: skeleton.width + SIDE_BEARING * 2, strokes: skeleton.strokes, sideBearing: SIDE_BEARING };
}

export const renderOptions = { capsuleSegments: CAPSULE_SEGMENTS, defaultWidthUnits: STROKE_WIDTH_UNITS };
