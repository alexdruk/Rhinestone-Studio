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
  // READ-003: test 5 re-measures stemWidthRatio for all 29 in-scope fonts (interior grid sampling
  // over 62 glyphs each, ~75s) to prove the manifest has not drifted from the real font files.
  // Too heavy for the default loop; run via `npm run test:full` or an explicit filter.
  'test-read-003-stem-width.mjs',
  // READ-011C: re-runs lib/trackingSolver.mjs against all 75 frozen READ-005 tracking-key specs
  // (full font pipeline, ~44 ladder sweeps). Guards the extracted solver + detects GlyphSeparation.js
  // drift; too heavy for the default loop.
  'test-read-011c-tracking-solver-regression.mjs',
  // MAINT-004: 11 of 11 assertions are wiring-guard (regex/substring match on app.js/index.html/
  // package.json; nothing executes). Real Gallery correctness is fully covered by
  // test-gallery.mjs (KEEP, unaffected, still in the `gallery` group and the default suite).
  'test-gallery-integration.mjs',
  // MAINT-004: 8 of 8 assertions are wiring-guard -- pure regex against composeCombinedPreviewCanvas()'s
  // source text and #exportCombined markup; never actually calls the function.
  'test-export-combined-preview-png.mjs',
  // MAINT-004: 12 of 12 assertions are wiring-guard -- source-text pattern matches only; the real
  // translate math is already fully covered by test-move-drag-translate.mjs (KEEP, unaffected).
  'test-move-drag-fast-path-wiring.mjs',
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
    'test-rhinestone-font-prototype.mjs',
    'test-rs-block.mjs',
    'test-rs-modern.mjs',
    'test-svg-parser.mjs',
    'test-arc-projection.mjs',
    'test-geometry-engine.mjs',
    'test-path-boolean.mjs',
    'test-stone-color.mjs',
    'test-history-manager.mjs',
    'test-object-template.mjs',
    'test-rs-3037-flat-sheet.mjs',
    'test-pdf-document.mjs',
    'test-object-dimensions.mjs',
    'test-object-geometry-builder.mjs',
    'test-crystal-color-catalog.mjs',
    'test-image-pipeline.mjs',
    'test-img-001-field.mjs',
    'test-img-002-color-layers.mjs',
    'test-img-003-organic-placement.mjs',
    'test-img-004-edge-awareness.mjs',
    'test-img-005-check-and-fix.mjs',
    'test-img-006-brightness-sizes.mjs',
    'test-img-008-vector-first-svg.mjs',
    'test-img-009-subject-mask.mjs',
    'test-img-011-import-defaults.mjs',
    'test-img-012-auto-colour-count.mjs',
    'test-img-013-fill-empty-slots.mjs',
    'test-img-014-subject-mask-photographic.mjs',
    'test-img-015-direct-catalogue-colour.mjs',
    'test-img-016-neutral-brown-stones.mjs',
    'test-img-017-vividness.mjs',
    'test-img-018-whole-image-mask.mjs',
    'test-img-019-subject-mask-resized.mjs',
    'test-alignment-engine.mjs',
    'test-snap-engine.mjs',
    'test-editing-selection.mjs',
    'test-boolean-precision-validation.mjs',
    'test-stone-size-library.mjs',
    'test-fill-algorithms.mjs',
    'test-gallery.mjs',
    'test-shape-library.mjs',
    'test-shape-fit.mjs',
    'test-shape-library-integration.mjs',
    'test-frame-library.mjs',
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
    'test-product-vessel-dimensions.mjs',
    'test-examples-regression.mjs',
    'test-production-sheet-exporter.mjs',
    'test-rs-3038-prod-sheet-messages.mjs',
    'test-crystal-color-integration.mjs',
    'test-image-trace-regression.mjs',
    'test-path-boolean-integration.mjs',
    'test-variable-stone-sizes.mjs',
    'test-fill-algorithms-integration.mjs',
    'test-gallery-integration.mjs',
    'test-typography-font-library.mjs',
    'test-font-lib-006-browse-fonts-flat-list.mjs',
    'test-text-position-workflow.mjs',
    'test-lightbox-movable-persistent.mjs',
    'test-export-combined-preview-png.mjs',
    'test-shapes-design-consolidation.mjs',
    'test-shapes-around-text-creation.mjs',
    'test-alignment-snapping-wiring.mjs',
    'test-lightbox-controller.mjs',
    'test-topmenu-active-state.mjs',
    'test-ui-shell-structure.mjs',
    'test-ui-import-autoswitch-regression.mjs',
    'test-autosave-recovery-wiring.mjs',
    'test-font-decision-001-stone-size-ux.mjs',
    'test-font-portfolio-001-stone-size-gating.mjs',
    'test-auto-fit-default-toggle-warning.mjs',
    'test-read-008-ratio-floor.mjs',
    'test-rs-3039-large-layout.mjs',
  ],
  // Permanent architectural rules (one GeometryEngine, one StoneLayout/project model, app.js
  // barrel-only imports, browser dependency loading).
  architecture: [
    'test-architecture-module-boundaries.mjs',
    'test-browser-dependency-loading.mjs',
    'test-module-graph-exports.mjs',
    'test-project-model-consolidation.mjs',
    // Source-tree hygiene guard: no tracked JavaScript source file contains a raw NUL (0x00) byte
    // (which makes grep/git treat the file as binary). A permanent codebase-level rule, same
    // category as the module-boundary guards above.
    'test-source-hygiene.mjs',
    'test-browser-baseline.mjs',
    // Dev tooling: the `npm run dev` server (tools/dev-server.mjs) sends Cache-Control: no-cache,
    // no-store, so a browser never reuses a stale ES module during local testing.
    'test-dev-server-no-cache.mjs',
  ],
  // Gallery is disabled in the public UI, but its catalog/wiring logic is still protected — both
  // files here already run as part of core/integration, so this group is a complete,
  // self-contained Gallery check on its own.
  gallery: [
    'test-gallery.mjs',
    'test-gallery-integration.mjs',
    'test-read-009-bridge-autofit-floor.mjs',
  ],
  // Docs/manifest consistency checks (README/ARCHITECTURE/BACKLOG/etc. against the real filesystem
  // and package.json scripts).
  documentation: [
    'test-documentation-consistency.mjs',
    'test-read-005-derived-tables.mjs',
    // READ-011D: pins the READ-011 derived-tables golden (docs/data/read-011/derived-tables.json,
    // computeSession3() in analyze-ratings.mjs) the same way test-read-005-derived-tables.mjs pins
    // the READ-005 one — a pre-registered analysis rule guarded against drift before ratings land.
    'test-read-011d-session3.mjs',
    // READ-011E: the reachability dry-run for READ-011D's selection rule — proves from population
    // and manifest values alone (blank or filled sheet) that §6's ±0.25 tolerance was unsatisfiable
    // and Form B was power-capped below the interesting range. See
    // docs/specifications/READ-011E-PreRegistrationDefect.md.
    'test-read-011e-reachability.mjs',
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

  // --- MAINT-002 — Test Execution Tiers -------------------------------------------------------
  //
  // The 12 groups below, together with architecture/gallery/security/documentation/autosave above,
  // partition all `tools/test-*.mjs` files by subsystem with no gaps and no overlaps (every file
  // belongs to exactly one of these 17 groups) — Tier 2 of the tiered execution model. `core`/
  // `integration` above are unaffected: they remain their own, overlapping-with-everything,
  // test-layer-based groups for backward compatibility.

  geometry: [
    'test-geometry-engine.mjs',
    'test-path-boolean.mjs',
    'test-path-boolean-integration.mjs',
    'test-boolean-precision-validation.mjs',
    'test-geometry-stone-overlap-cross-contour.mjs',
    'test-geometry-stone-overlap-cross-layer.mjs',
    'test-geometry-stone-overlap-same-contour.mjs',
    'test-arc-projection.mjs',
    'test-image-pipeline.mjs',
    'test-img-001-field.mjs',
    'test-img-002-color-layers.mjs',
    'test-img-003-organic-placement.mjs',
    'test-img-004-edge-awareness.mjs',
    'test-img-005-check-and-fix.mjs',
    'test-img-006-brightness-sizes.mjs',
    'test-img-008-vector-first-svg.mjs',
    'test-img-009-subject-mask.mjs',
    'test-img-011-import-defaults.mjs',
    'test-img-012-auto-colour-count.mjs',
    'test-img-013-fill-empty-slots.mjs',
    'test-img-014-subject-mask-photographic.mjs',
    'test-img-015-direct-catalogue-colour.mjs',
    'test-img-016-neutral-brown-stones.mjs',
    'test-img-017-vividness.mjs',
    'test-img-018-whole-image-mask.mjs',
    'test-img-019-subject-mask-resized.mjs',
    'test-img-021-rotated-image-stones.mjs',
    'test-image-trace-regression.mjs',
    'test-fill-algorithms.mjs',
    'test-fill-algorithms-integration.mjs',
    // GeometryEngine / StoneSampler output geometry: per-side corner-anchored Outline sampling for
    // drawn paths, congruent-contour Outline stability, the boolean stone-overlap early-exit check,
    // the content-addressed SVG natural-polygon cache (M13), layout-quality crowding/attrition
    // measurement, additive mixed-size infill (S-200), and Paint-region fill claim/exclude +
    // lasso-target selection at the geometry level (RS-3011 Steps 10a/10b).
    'test-congruent-contours.mjs',
    'test-geometry-path-corner-anchoring.mjs',
    'test-geometry-stone-overlap-early-exit.mjs',
    'test-geometry-svg-polygon-cache.mjs',
    'test-geometry-layout-quality-metrics.mjs',
    'test-read-001-contour-centreline.mjs',
    'test-read-002-radial-per-glyph.mjs',
    // READ-011A: src/geometry/StemRegime.js -- a dependency-free leaf module (sibling of
    // TextAutoFit.js) classifying each manifest font into a stroke regime from its measured
    // stemWidthRatio. Grouped with the other src/geometry leaf-module tests here.
    'test-read-011-stem-regime.mjs',
    // READ-011B: docs/data/read-011/render-plan.json -- the frozen experimental design for the
    // READ-011 rating pass, enumerated by tools/font-certification/read-011-plan.mjs from the
    // manifest and StemRegime.js. Grouped with test-read-011-stem-regime.mjs.
    'test-read-011b-render-plan.mjs',
    // READ-011C: docs/data/read-011/render-key.json -- the key produced alongside the (gitignored)
    // rating-pass renders. Carries the READ-011B design through unchanged and adds the resolved
    // letter spacing + separation numbers + seeded presentation index. Grouped with the other
    // READ-011 design/key tests.
    'test-read-011c-render-key.mjs',
    // READ-011C: pins the extracted lib/trackingSolver.mjs against the frozen READ-005 tracking-key.
    // EXCLUDED_FROM_DEFAULT (heavy) -- see the list above.
    'test-read-011c-tracking-solver-regression.mjs',
    'test-s200-mixed-stone-sizes.mjs',
    'test-rs3011-step10a-region-data-model.mjs',
    'test-rs3011-step10b-paint-target-selection.mjs',
    'test-mono-021-text-layer-edits.mjs',
    // PERF-006 (MAINT-004 registration): pure spatial-geometry algorithm --
    // isPointInsidePolygons()'s cache in StoneSampler.js.
    'test-perf-006-point-in-polygon-cache.mjs',
    'test-rs-3039-large-layout.mjs',
  ],
  'stone-layout': [
    'test-stone-color.mjs',
    'test-stone-size-library.mjs',
    'test-crystal-color-catalog.mjs',
    'test-crystal-color-integration.mjs',
    'test-variable-stone-sizes.mjs',
  ],
  text: [
    'test-font-manager.mjs',
    'test-font-provider-registry.mjs',
    'test-opentype-provider.mjs',
    'test-vector-path.mjs',
    'test-typography-font-library.mjs',
    'test-font-lib-006-browse-fonts-flat-list.mjs',
    'test-rhinestone-font-prototype.mjs',
    'test-rs-block.mjs',
    'test-rs-modern.mjs',
    'test-font-002-production-font-mode.mjs',
    // FONT-PITCH-001: derives each authored font's overlap-safe stone-size set from its real glyph
    // maps + kerning tables and pins it against the manifest's unsupportedStoneSizes -- grouped with
    // the other rhinestone-font tests it imports from (rsBlock.js / rsModern.js).
    'test-font-pitch-001-authored-stone-sizes.mjs',
    // Font certification / evaluation tooling (tools/font-certification/**): certification
    // classification, glyph-outline command analysis, readability metrics, word-space narrative,
    // source-font evaluation, plus the manifest.json capHeight/xHeight ratios cross-checked against
    // a live re-measurement of the real font files (TXT-104).
    'test-font-cert-001-classification.mjs',
    'test-font-cert-002-outline-detector-fixtures.mjs',
    'test-font-cert-002-readability-metrics.mjs',
    'test-font-cert-002-word-space-narrative.mjs',
    'test-font-source-001-evaluate.mjs',
    'test-font-height-ratios.mjs',
    // READ-003: manifest.json stemWidthRatio (stroke-narrower-than-one-stone gate) cross-checked
    // against a live re-measurement of the real font files. Slow (~75s) -- excluded from the default
    // suite, but part of the `--group text` run.
    'test-read-003-stem-width.mjs',
    // READ-004: recognition harness -- A-first signal ordering, sheet answer-leakage / no-repeated
    // -character rules, pure scoring, cache keying, and the analyzeOne() mode-threading regression.
    // No network, stub oracle only; light enough for the default suite.
    'test-read-004-recognition-harness.mjs',
    // FONT-LIB-005: montserrat-regular retired from the picker (enabled:false -- the bundled file
    // renders as Montserrat Thin, an unmanufacturable hairline). Manifest/arithmetic/hash checks
    // that the .ttf is retained for saved projects while the font leaves productionFonts().
    'test-font-lib-005-montserrat-retired.mjs',
    // FONT-LIB-003/004 (MAINT-004 registration): the #stoneSizeCrowdingHint packing-density warning
    // and the #heightBelowReadableWarning legibility warning -- own distinct app.js functions/DOM
    // elements but both encode the READ-003 stroke-gate precedence rule against their own warning.
    'test-font-lib-003-crowding-hint.mjs',
    'test-font-lib-004-height-readability.mjs',
  ],
  shapes: [
    'test-shape-fit.mjs',
    'test-shape-library.mjs',
    'test-shape-library-integration.mjs',
    'test-shapes-design-consolidation.mjs',
    'test-shapes-around-text-creation.mjs',
    'test-frame-library.mjs',
  ],
  products: [
    'test-object-template.mjs',
    'test-rs-3037-flat-sheet.mjs',
    'test-object-template-integration.mjs',
    'test-object-dimensions.mjs',
    'test-product-plate-round-dinner.mjs',
    'test-product-vessel-dimensions.mjs',
    // Also in `ui` (deliberate dual membership, MAINT-004): each gates a product/font-data
    // constraint (shape-fit eligibility; per-font SS30 stone-size support) through the UI surface
    // that displays it, so both groups genuinely apply.
    'test-font-decision-001-stone-size-ux.mjs',
    'test-font-portfolio-001-stone-size-gating.mjs',
  ],
  // Import/Export. test-svg-parser.mjs lives here (not in `text`) because it parses *imported* SVG
  // into VectorPath contours -- the import half of Import/Export, paired with its own integration
  // test test-svg-integration.mjs -- not text/glyph rendering.
  exporters: [
    'test-svg-parser.mjs',
    'test-svg-integration.mjs',
    'test-production-export-validation.mjs',
    // RS-3036: DXF cutting-template export (StoneLayout -> mm DXF, per-color layers).
    'test-rs3036-dxf-exporter.mjs',
    'test-production-sheet-exporter.mjs',
    'test-rs-3038-prod-sheet-messages.mjs',
    // RS-3041: multi-page Production Sheets (cover + true-size tile pages, PDF only).
    'test-rs-3041-multi-page.mjs',
    'test-pdf-document.mjs',
    'test-export-combined-preview-png.mjs',
    // SVG import flattening -- flattenPathToContours() generalizing to paper.CompoundPath (holes)
    // and paper.Group (disjoint pieces), the import half of Import/Export (RS-3011 Step 8 Phase A),
    // same rationale as test-svg-parser.mjs living here.
    'test-rs3011-step8-svg-import-flattening.mjs',
    // Production Sheet per-color/per-size quantity grouping (S-200).
    'test-s200-production-sheet-grouping.mjs',
  ],
  renderers: [
    'test-render-export-pipeline.mjs',
    'test-object-geometry-builder.mjs',
    'test-crystal-appearance.mjs',
    'test-crystal-stone-renderer.mjs',
    // src/preview3d/Preview3DRenderer.js: instanced-stone mesh build/placement/lighting (RS-2013
    // §4), invalidation-based render scheduling (RS-2011), non-plate stone tangent-frame
    // orientation. WebGLRenderer needs a real GL context, so these exercise only the pure
    // construction/scheduling logic in isolation.
    'test-preview3d-instanced-stones.mjs',
    'test-preview3d-render-scheduling.mjs',
    'test-preview3d-stone-orientation.mjs',
    // src/drawing/StoneSpriteCache.js: offscreen sprite baking for the Design view's stone-dot
    // preview (cache-hit/miss behaviour against a stubbed canvas).
    'test-stone-sprite-cache.mjs',
  ],
  // Pure alignment/snap/selection math reused by the UI, kept separate from `ui` (markup/wiring)
  // so --group editing targets exactly that math.
  editing: [
    'test-alignment-engine.mjs',
    'test-snap-engine.mjs',
    'test-editing-selection.mjs',
    'test-alignment-snapping-wiring.mjs',
    'test-move-drag-translate.mjs',
    'test-move-drag-fast-path-wiring.mjs',
    'test-rs3012-step4-circle-select.mjs',
    'test-rs3012-step5-rectangle-select.mjs',
    'test-maint-003-materializer-contract.mjs',
    'test-rs3015-mark-target-eligibility.mjs',
    'test-mono-021-mark-hooks.mjs',
    'test-img-020-image-stones-in-design.mjs',
    'test-rs-3040-design-framing.mjs',
    // PERF-005 (MAINT-004 registration): app.js's live-editing UI responsiveness -- the
    // stone-size-picker overlap-capability re-sweep call-count fix.
    'test-perf-005-stone-size-lazy-sweep.mjs',
  ],
  ui: [
    'test-ui-shell-structure.mjs',
    'test-lightbox-controller.mjs',
    'test-topmenu-active-state.mjs',
    'test-lightbox-movable-persistent.mjs',
    'test-ui-import-autoswitch-regression.mjs',
    'test-text-position-workflow.mjs',
    'test-ux-visual-polish.mjs',
    // Also in `products` (deliberate dual membership, MAINT-004) -- see the comment there.
    'test-font-decision-001-stone-size-ux.mjs',
    'test-font-portfolio-001-stone-size-gating.mjs',
    'test-auto-fit-default-toggle-warning.mjs',
    // READ-008: the auto-fit readability floor's basis/value, re-expressed in stone diameters --
    // companion to test-text-position-workflow.mjs's B17-B21 (computeAutoFitScale() itself) and
    // test-auto-fit-default-toggle-warning.mjs (the Auto Fit control) directly above.
    'test-read-008-ratio-floor.mjs',
    // READ-010 (MAINT-004 registration): Production Sheet validation UI -- project-wide warn-only
    // sweep + fix-to-floor button/hint. Matches test-read-008-ratio-floor.mjs's placement here.
    'test-read-010-warn-only-floor.mjs',
    // app.js UI-layer wiring/behaviour: pure mm<->inch display helpers (RS-3018) and the bare-DOM
    // length-field mm stash that stops Units toggles drifting (RS-3025); the manual Text-height
    // field clamp (TXT-103); S-200 Mixed Stone Size UI wiring + editing lifecycle; and the RS-2012
    // Text Gap / Mixed Size UX polish (authored-font Gap lock, ineligible-size explain, Advanced
    // collapsible).
    'test-length-units.mjs',
    'test-rs-3025-length-field-mm-stash.mjs',
    'test-txt-103-text-sizing-consistency.mjs',
    'test-s200-app-integration.mjs',
    'test-rs2012-text-gap-mixed-size-ux.mjs',
  ],
  history: [
    'test-history-manager.mjs',
  ],
  // Monogram Generator subsystem (src/monogram/**): the headless generation pipeline and every
  // piece it orchestrates -- MONO-002 authored-font positional scaling, MONO-004 layout engine,
  // MONO-005/005A headless generator + persistable authoredScale + cross-group collision query,
  // MONO-006 UI, MONO-006A/006B stale-authoredScale recovery, MONO-006E fitting refinement, and the
  // MONO-007..011 frame stone-width / auto-shrink work. A few members touch GeometryEngine or
  // StoneSampler directly, but each exists to prove a Monogram behaviour, so they belong here.
  monogram: [
    'test-mono-002-authored-font-positional-scaling.mjs',
    'test-mono-004-monogram-layout-engine.mjs',
    'test-mono-005-headless-monogram-generator.mjs',
    'test-mono-005a-authored-scale-persistence.mjs',
    'test-mono-005a-collision-query.mjs',
    'test-mono-006-monogram-ui.mjs',
    'test-mono-006a-authored-scale-regression.mjs',
    'test-mono-006b-stale-authored-scale-initial-load-recovery.mjs',
    'test-mono-006e-monogram-fitting-refinement.mjs',
    'test-mono-007-010-coverage.mjs',
    'test-mono-010-frame-stone-width-spacing.mjs',
    'test-mono-011-frame-stone-autoshrink.mjs',
    'test-mono-012-single-chain.mjs',
    'test-mono-013-interlock.mjs',
    'test-mono-014-frame-hierarchy.mjs',
    'test-mono-015-weight-sizing.mjs',
    'test-mono-016-letter-spacing.mjs',
    'test-mono-018-binding-letter.mjs',
    // MONO-019 (MAINT-004 registration): real MonogramGenerator/FrameLibrary duplicate-layer-id
    // fix, same bootstrap as test-mono-018-binding-letter.mjs.
    'test-mono-019-layer-ids.mjs',
    'test-mono-022-reachable-remedies.mjs',
  ],
  // Full fixture-driven regression sweep (examples/*.rhs against committed baselines) -- expensive
  // relative to a fast dev loop, but exactly what merge/release/CI validation wants.
  'release-smoke': [
    'test-examples-regression.mjs',
  ],

  // Tier 1 — Fast Development. One cheap, high-value representative per subsystem above, plus all
  // four architecture guards (the cheapest, highest-leverage checks in the suite -- they directly
  // protect the "one GeometryEngine / one StoneLayout" invariant). `npm test` runs this group.
  // Deliberately excludes: gallery (disabled in the public UI), release-smoke (a full fixture sweep,
  // better suited to full validation), and test-fill-algorithms.mjs (4.5s alone -- its subsystem,
  // shapes, already has a cheap representative here). See
  // docs/specifications/MAINT-002-TestExecutionTiers.md for the full rationale.
  fast: [
    'test-architecture-module-boundaries.mjs',
    'test-browser-dependency-loading.mjs',
    'test-browser-baseline.mjs',
    'test-module-graph-exports.mjs',
    'test-project-model-consolidation.mjs',
    'test-geometry-engine.mjs',
    'test-path-boolean.mjs',
    'test-stone-color.mjs',
    'test-crystal-color-catalog.mjs',
    'test-font-manager.mjs',
    'test-opentype-provider.mjs',
    'test-shape-fit.mjs',
    'test-shape-library.mjs',
    'test-object-template.mjs',
    'test-rs-3037-flat-sheet.mjs',
    'test-svg-parser.mjs',
    'test-pdf-document.mjs',
    'test-render-export-pipeline.mjs',
    'test-editing-selection.mjs',
    'test-alignment-engine.mjs',
    'test-ui-shell-structure.mjs',
    'test-history-manager.mjs',
    'test-autosave-manager.mjs',
    'test-project-validation-security.mjs',
    'test-documentation-consistency.mjs',
  ],
};
