// Explicit test-group manifest, consumed by tools/run-tests.mjs.
//
// Each list below is data, transcribed once from the pre-CI-001 package.json "&&" chains — add or
// remove a filename here to change what a group runs; never edit run-tests.mjs itself for that.

// The tools/test-*.mjs files the default `npm test` / `node tools/run-tests.mjs` (no arguments)
// selection skips. This is a continuation of the deliberate exclusion S-111
// (docs/specifications/S-111-TestSuiteRationalization.md) already made, not a new judgment call —
// see docs/specifications/CI-001-RealTestExecution.md for the audit. Every excluded file is still
// runnable directly, via a filename filter, or via `npm run test:full` (`--all`).
export const EXCLUDED_FROM_DEFAULT = [
  // Legacy src/renderer/CupRenderer.js suites, superseded by src/preview3d/** (RS-1006);
  // CupRenderer.js is no longer wired into the live Object Preview panel. Kept runnable, not
  // deleted, per the repository's "do not remove a module while a test still exercises it"
  // precedent — test:full only.
  'test-cup-rotation-stabilization.mjs',
  'test-object-preview-renderer.mjs',
  // Asserts a 5-second-per-fixture timing ceiling, not correctness. Timing assertions do not
  // belong in a suite that must stay fast and deterministic on every machine (S-111). Its
  // correctness assertions duplicate test-examples-regression.mjs. test:gallery / test:full only.
  'test-gallery-benchmark.mjs',
];

// Named groups preserved from the pre-CI-001 package.json scripts of the same name. File order is
// kept as it was in each original "&&" chain.
export const GROUPS = {
  core: [
    'test-font-manager.mjs',
    'test-vector-path.mjs',
    'test-font-provider-registry.mjs',
    'test-opentype-provider.mjs',
    'test-svg-parser.mjs',
    'test-arc-projection.mjs',
    'test-geometry-engine.mjs',
    'test-path-boolean.mjs',
    'test-stone-color.mjs',
    'test-history-manager.mjs',
    'test-object-template.mjs',
    'test-pdf-document.mjs',
    'test-object-dimensions.mjs',
    'test-stone-layout-texture.mjs',
    'test-object-geometry-builder.mjs',
    'test-crystal-color-catalog.mjs',
    'test-image-pipeline.mjs',
    'test-alignment-engine.mjs',
    'test-snap-engine.mjs',
    'test-editing-selection.mjs',
    'test-boolean-precision-validation.mjs',
    'test-stone-size-library.mjs',
    'test-fill-algorithms.mjs',
    'test-design-library.mjs',
    'test-gallery.mjs',
    'test-shape-library.mjs',
    'test-shape-fit.mjs',
    'test-shape-library-integration.mjs',
  ],
  integration: [
    'test-svg-integration.mjs',
    'test-render-export-pipeline.mjs',
    'test-production-export-validation.mjs',
    'test-ux-visual-polish.mjs',
    'test-object-template-integration.mjs',
    'test-s112-round-dinner-plate.mjs',
    'test-s112a-plate-ux-corrections.mjs',
    'test-examples-regression.mjs',
    'test-production-sheet-exporter.mjs',
    'test-crystal-color-integration.mjs',
    'test-image-trace-regression.mjs',
    'test-path-boolean-integration.mjs',
    'test-variable-stone-sizes.mjs',
    'test-fill-algorithms-integration.mjs',
    'test-design-library-integration.mjs',
    'test-gallery-integration.mjs',
    'test-typography-font-library.mjs',
    'test-s104-text-position-recovery-drag-tuning.mjs',
    'test-s105-persistent-movable-lightboxes.mjs',
    'test-s106-combined-visual-preview-png-export.mjs',
    'test-s107-long-text-readability.mjs',
    'test-s110-design-shapes-consolidation.mjs',
    'test-s110a-smart-shape-to-text-creation.mjs',
    'test-alignment-snapping-wiring.mjs',
    'test-lightbox-controller.mjs',
    'test-ui-shell-structure.mjs',
  ],
  architecture: [
    'test-app-module-migration.mjs',
    'test-browser-dependency-loading.mjs',
    'test-module-graph-exports.mjs',
    'test-project-model-consolidation.mjs',
  ],
  gallery: [
    'test-gallery.mjs',
    'test-gallery-integration.mjs',
    'test-gallery-benchmark.mjs',
  ],
};
