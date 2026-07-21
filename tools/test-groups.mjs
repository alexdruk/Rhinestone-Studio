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
];

// Named groups, organized around stable subsystems (MAINT-001 — Test Suite Consolidation) rather
// than the historical milestones that originally introduced each file. A file may appear in more
// than one group (e.g. Gallery's own catalog/wiring files also run as part of core/integration) —
// GROUPS only drives `--group <name>` selection; it has no bearing on the default suite, which is
// computed by discovery minus EXCLUDED_FROM_DEFAULT above.
export const GROUPS = {
  // Permanent-module unit/behavioral tests: no app.js/index.html dependency.
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
    'test-geometry-stone-overlap-cross-contour.mjs',
    'test-geometry-stone-overlap-cross-layer.mjs',
    'test-geometry-stone-overlap-same-contour.mjs',
    'test-autosave-manager.mjs',
  ],
  // app.js/index.html wiring + cross-module behavioral tests.
  integration: [
    'test-svg-integration.mjs',
    'test-render-export-pipeline.mjs',
    'test-production-export-validation.mjs',
    'test-ux-visual-polish.mjs',
    'test-object-template-integration.mjs',
    'test-product-plate-round-dinner.mjs',
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
    'test-text-position-workflow.mjs',
    'test-lightbox-movable-persistent.mjs',
    'test-export-combined-preview-png.mjs',
    'test-shapes-design-consolidation.mjs',
    'test-shapes-around-text-creation.mjs',
    'test-alignment-snapping-wiring.mjs',
    'test-lightbox-controller.mjs',
    'test-ui-shell-structure.mjs',
    'test-ui-import-autoswitch-regression.mjs',
    'test-design-library-freeze-gate.mjs',
    'test-autosave-recovery-wiring.mjs',
  ],
  // Permanent architectural rules (one GeometryEngine, one StoneLayout/project model, app.js
  // barrel-only imports, browser dependency loading).
  architecture: [
    'test-architecture-module-boundaries.mjs',
    'test-browser-dependency-loading.mjs',
    'test-module-graph-exports.mjs',
    'test-project-model-consolidation.mjs',
  ],
  // Gallery is disabled in the public UI, but its catalog/wiring logic is still protected — both
  // files here already run as part of core/integration, so this group is a complete,
  // self-contained Gallery check on its own.
  gallery: [
    'test-gallery.mjs',
    'test-gallery-integration.mjs',
  ],
  // Docs/manifest consistency checks (README/ARCHITECTURE/BACKLOG/etc. against the real filesystem
  // and package.json scripts).
  documentation: [
    'test-documentation-consistency.mjs',
  ],
  // Input-validation/XSS hardening checks (layer.id, escapeHtml, renderLayerUI against hostile
  // input).
  security: [
    'test-project-validation-security.mjs',
  ],
  // AutosaveManager's own pure record logic plus app.js's wiring around it (scheduling, boot-time
  // recovery decision, recovery notification). Both files already run as part of core/integration.
  autosave: [
    'test-autosave-manager.mjs',
    'test-autosave-recovery-wiring.mjs',
  ],
};
