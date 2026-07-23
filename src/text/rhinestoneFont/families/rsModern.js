/**
 * RS Modern -- minimal, geometric, premium rhinestone letterform family (TXT-101A).
 *
 * Renders the same shared original skeleton as RS Block (skeletonGlyphs.js) but through a
 * deliberately different stroke construction: a thin, refined stroke with smooth, near-true-circle
 * curve faceting and a tighter recommended stone pitch, suited to delicate premium branding rather
 * than jersey-scale boldness. Sharing a skeleton grammar with RS Block is a deliberate design
 * decision (see skeletonGlyphs.js's module doc), not a shortcut: the two families differ in exactly
 * the parameters a rhinestone producer actually cares about -- stroke weight, curve smoothness, and
 * production stone size/gap -- while both are original constructions, not digitized from any
 * existing typeface.
 */

import { UNITS_PER_EM, CAP_HEIGHT, SIDE_BEARING, getSkeletonGlyph } from '../skeletonGlyphs.js';

const STROKE_WIDTH_UNITS = 9; // ~13% of CAP_HEIGHT -- thin, refined stroke.
const CAPSULE_SEGMENTS = 32; // Smooth, near-true-circle curve faceting.

export const descriptor = {
  id: 'rs-modern-regular',
  displayName: 'RS Modern',
  category: 'modern',
  unitsPerEm: UNITS_PER_EM,
  capHeightUnits: CAP_HEIGHT,
  recommendedStoneSizeMm: 1.6,
  minStoneSizeMm: 1.2,
  recommendedGapMm: 0.3,
  recommendedUses: ['Premium/boutique branding', 'Minimalist logo lockups', 'Small, precise lettering'],
  notes: 'Thin uniform stroke, smooth near-circular curve faceting, tighter stone pitch -- built for delicate, precise placements rather than jersey-scale boldness.'
};

export function getGlyphStrokes(character) {
  const skeleton = getSkeletonGlyph(character);
  if (!skeleton) return null;
  return { width: skeleton.width + SIDE_BEARING * 2, strokes: skeleton.strokes, sideBearing: SIDE_BEARING };
}

export const renderOptions = { capsuleSegments: CAPSULE_SEGMENTS, defaultWidthUnits: STROKE_WIDTH_UNITS };
