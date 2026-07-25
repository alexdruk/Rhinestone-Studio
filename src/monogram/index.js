// MONO-006: barrel for src/monogram/** -- previously imported directly (see
// tools/test-mono-005-headless-monogram-generator.mjs), but app.js (the first non-test consumer)
// must only import permanent modules through a src/*/index.js barrel, per
// tools/test-architecture-module-boundaries.mjs. Mirrors every other permanent module's barrel
// shape (src/history/index.js, src/library/index.js, ...).
export {
  MonogramGenerator,
  MONOGRAM_GENERATOR_FAILURE_REASONS
} from './MonogramGenerator.js';

export {
  MONOGRAM_LAYOUTS,
  MONOGRAM_LAYOUT_LETTER_COUNTS,
  MONOGRAM_LAYOUT_FAILURE_REASONS,
  computeMonogramLayout
} from './MonogramLayouts.js';
