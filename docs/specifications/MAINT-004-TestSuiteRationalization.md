# MAINT-004 — Test Suite Rationalization, Pass 3 (Audit Only)

**Status:** AUDIT ONLY. No `src/**`, `app.js`, `index.html`, or `tools/test-*.mjs` file was changed by
this milestone. Deliverable is this document plus resumable measurement scripts under
`tools/scratch/` (gitignored, not part of the commit).

**Scope:** Read every one of the 150 `tools/test-*.mjs` files (excluding `tools/test-groups.mjs`)
start to finish and classify each — Keep / Merge / Demote / Remove / Pin-Once, per S-111's and
MAINT-001's own vocabulary — plus four specific cross-cutting investigations the task called out:
the READ series' final disposition, `src/renderer/CupRenderer.js`'s live reachability, the 6
ungrouped/2 double-registered `tools/test-groups.mjs` files, and a proposed end state with a
measured `--all` wall-time projection.

**Method:** Six parallel research passes (~25 files each), reading every file in full (never
grepped), calibrated against `docs/specifications/S-111-TestSuiteRationalization.md` and
`docs/specifications/MAINT-001-TestSuiteConsolidation.md`'s own method and vocabulary — the same
"read every file start to finish" standard those two milestones already established for this exact
suite. Mechanical facts (line counts, assertion counts, `tools/test-groups.mjs` membership, and
whether a file reads `app.js`/`index.html`/`manifest.json` as text) were computed once by script and
handed to every pass as trusted input, so each pass's effort went into behavioral judgment, not
re-deriving arithmetic. Per-file timing was measured individually (`node --import
file://tools/lib/paper-safe-self-preload.mjs tools/<file>`, the same invocation
`tools/run-tests.mjs` uses), in batches of 25, appended to `tools/scratch/timings.jsonl`.

---

## 0. Baseline reconciliation

Before auditing, the six given baseline figures were independently reproduced:

| Figure | Given | Reproduced | Match |
|---|---|---|---|
| Test files (excl. `test-groups.mjs`) | 150 | 150 | ✅ |
| Total lines | 37,937 | 37,937 (`wc -l tools/test-*.mjs \| tail -1`, which — despite the 150-file count excluding `test-groups.mjs` — naturally includes `test-groups.mjs`'s 413 lines in the printed "total" line unless separately filtered; excluding it gives 37,524) | ✅ (identical command, identical result) |
| Files reading `app.js` as text | 67 | 67 (after correcting one false negative: `test-source-hygiene.mjs` reads `app.js`'s bytes via an array-of-paths literal, not a direct `readFile('app.js')` call — a two-pass taint-tracking script that follows `const x = …app.js…` variables into later `readFile(x)` calls found the rest) | ✅ |
| Files reading `manifest.json` as text | 57 | 57 | ✅ |
| Files reading `index.html` as text | 31 | 31 | ✅ |
| Files in no subsystem group | 6: font-lib-003, font-lib-004, mono-019, perf-005, perf-006, read-010 | Identical 6 | ✅ |
| Files in two tier groups | 2: font-decision-001, font-portfolio-001 | Identical 2 | ✅ |
| `EXCLUDED_FROM_DEFAULT` count / default suite size | 4 / 146 | Identical | ✅ |
| MONO files / lines | 22 / 7,962 | Identical | ✅ |
| **READ files / lines** | **14 / 2,939** | **14 / 3,139** (`wc -l tools/test-read-*.mjs`, per-file breakdown below) | ❌ **200-line disagreement** |

READ per-file line counts (`wc -l`):
```
458  test-read-001-contour-centreline.mjs
187  test-read-002-radial-per-glyph.mjs
193  test-read-003-stem-width.mjs
327  test-read-004-recognition-harness.mjs
132  test-read-005-derived-tables.mjs
167  test-read-008-ratio-floor.mjs
185  test-read-009-bridge-autofit-floor.mjs
331  test-read-010-warn-only-floor.mjs
179  test-read-011-stem-regime.mjs
207  test-read-011b-render-plan.mjs
208  test-read-011c-render-key.mjs
174  test-read-011c-tracking-solver-regression.mjs
240  test-read-011d-session3.mjs
151  test-read-011e-reachability.mjs
3139 total
```
This was reported to the user mid-milestone, per the task's own instruction to stop and report
rather than adjust either side. The user directed the audit to proceed; the figure above (3,139) is
used throughout this document since it is independently reproducible from the current `develop` tree
at c2f9349, and no alternate 14-file, 2,939-line reading of the same series was found.

---

## 1. Per-file table (150 files)

Columns: **lines** | **assertions** (count of `test()`/`runTest()` call sites, matching S-111/
MAINT-001's own "✓ lines, one per `test()` block" definition) | **subsystem group(s)** from
`tools/test-groups.mjs`'s 17-group partition (`NONE` = ungrouped) | **reads app.js / index.html /
manifest.json as text** (Y/N each) | **classification** | **wiring-guard vs. behavioral** (only
shown where DEMOTE or mixed) | **reason**.

"Wiring-guard" = an assertion that only confirms a string/token/regex pattern exists in `app.js`,
`index.html`, or `manifest.json` source text, without executing any code. "Behavioral" = the
assertion calls real code (either a permanent module directly, or a function/block extracted from
`app.js` via brace-balanced slicing and then executed through `new Function(...)`) and checks its
actual output. Per `docs/specifications/S-111-TestSuiteRationalization.md` and
`docs/AI_ENGINEER.md`'s Testing Philosophy, extract-and-execute against sliced `app.js` source is
this repository's own sanctioned substitute for real browser/DOM testing (no jsdom dependency exists
here) — it counts as **behavioral**, not wiring-guard, throughout this table. Pure string/regex
matching against source text with no execution is the only thing counted as wiring-guard.

### Batch A — editing/geometry/architecture/renderers/stone-layout/exporters/text (25 files)

| filename | lines | assertions | group(s) | app.js/html/manifest | classification | wiring/behavioral | reason |
|---|---:|---:|---|---|---|---|---|
| test-alignment-engine.mjs | 159 | 14 | editing | N/N/N | KEEP | — | Pure `AlignmentEngine.js` math (union-bbox align, center-to-center distribute, order-independence). |
| test-alignment-snapping-wiring.mjs | 430 | 23 | editing | Y/Y/N | KEEP (mixed) | 17 wiring / 6 behavioral | 16 real checks execute extracted `getLayerPosition`/`setLayerPosition`/`alignLayers`/`distributeLayers`/`buildSnapTargets`/`computeSnapOffset`/`rotatedCornersAABB`; the rest are import/handler-body regex on app.js/index.html. |
| test-arc-projection.mjs | 135 | 15 | geometry | N/N/N | KEEP | — | Pure trig tests of `ArcProjection.js`. |
| test-architecture-module-boundaries.mjs | 146 | 9 | architecture | Y/Y/N | KEEP | 7 rule-pattern / 2 real graph-walk | The renamed CLAUDE.md "one GeometryEngine / barrel-only imports" enforcer; check 9 walks the real `src/geometry/**` import graph to prove no reference to `src/renderer/**`. |
| test-auto-fit-default-toggle-warning.mjs | 179 | 10 | ui | Y/Y/N | KEEP | 4 wiring / 6 behavioral | Extracts+executes `defaultProject()`/`addText()`/the `#autoFit` toggle listener across 5 real scenarios. |
| test-autosave-manager.mjs | 190 | 16 | autosave | N/N/N | KEEP | — | Pure `AutosaveManager` unit tests incl. an explicit pre-milestone legacy-project backward-compat round-trip. |
| test-autosave-recovery-wiring.mjs | 435 | 26 | autosave | Y/N/N | KEEP | 7 wiring / 19 behavioral | Merged RC-005+RC-005A per MAINT-001; boot-recovery decision and notification block extracted+executed. |
| test-boolean-precision-validation.mjs | 227 | 12 | geometry | N/N/N | KEEP | — | Real Boolean-op output checked against closed-form analytic area formulas; irreplaceable by source inspection. |
| test-browser-dependency-loading.mjs | 164 | 19 | architecture | Y/Y/N | KEEP (mixed) | 17 wiring / 2 behavioral | Mostly source-text (no-CDN, provider-isolation) but encodes a real permanent rule; final 2 checks import and execute the real adapter modules. |
| test-congruent-contours.mjs | 182 | 3 | geometry | N/N/N | KEEP | — | Real `groupCongruentContours`/corner-flag geometry regression (historical inconsistent-Outline-count bug). |
| test-crystal-appearance.mjs | 97 | 7 | renderers | N/N/N | KEEP | — | Pure `CrystalAppearance.js` determinism/seed-sensitivity/bounds tests. |
| test-crystal-color-catalog.mjs | 178 | 11 | stone-layout | N/N/N | KEEP | — | Protects the 7 legacy color ids' byte-identical values — CLAUDE.md backward-compatibility rule. |
| test-crystal-color-integration.mjs | 206 | 12 | stone-layout | Y/Y/Y | KEEP (mixed) | 4 wiring / 8 behavioral | Pushes a brand-new catalog color end-to-end through real `GeometryEngine`→SVG/Production-Sheet with zero renderer/exporter changes needed — direct proof of the StoneLayout-only architecture rule. |
| test-crystal-stone-renderer.mjs | 242 | 15 | renderers | N/N/N | KEEP | 2 wiring / 13 behavioral | Real fake-ctx draw-call-count tests; 2 checks are the renderer/exporter separation guard. |
| test-cup-rotation-stabilization.mjs | 178 | 10 | renderers | Y/N/N | **REMOVE** (see §4) | ~5 wiring / ~5 behavioral | CupRenderer.js suite; module confirmed dead — see CupRenderer resolution. |
| test-documentation-consistency.mjs | 302 | 11 | documentation | Y/N/Y | **DEMOTE** | 11 wiring / 0 behavioral | Every check is a string/path-existence/regex test over `docs/**`/README/package.json. No application behavior executes anywhere. Protects doc freshness, not "live user-facing behaviour or a permanent architectural rule" per the KEEP definition. |
| test-editing-selection.mjs | 69 | 9 | editing | N/N/N | KEEP | — | Pure `Selection.js` unit tests incl. immutability proof. |
| test-examples-regression.mjs | 399 | 19 | release-smoke | Y/N/Y | KEEP | — | Flagship regression file: real `validateProject()`, full fixture corpus through real `GeometryEngine`, SHA-256 file-integrity, 5s perf ceiling (folded in from deleted `test-gallery-benchmark.mjs` per MAINT-001). Zero wiring guards. |
| test-export-combined-preview-png.mjs | 111 | 8 | exporters | Y/Y/N | **DEMOTE** | 8 wiring / 0 behavioral | Pure regex against `composeCombinedPreviewCanvas()`'s source text and `#exportCombined` markup; never actually calls the function. |
| test-fill-algorithms-integration.mjs | 209 | 19 | geometry | Y/Y/N | DEMOTE-leaning (mixed) | 17 wiring / 2 behavioral | Only 2 of 19 checks execute real code (round-trip through SVG/Production-Sheet); the fill-mode engine behavior itself is already far more rigorously covered by `test-fill-algorithms.mjs`. |
| test-fill-algorithms.mjs | 330 | 15 | geometry | N/N/Y | KEEP | — | Real engine-level "Fill Styles" protection — every mode × layer type, spacing floors, determinism, fail-safes, 5s perf sanity. |
| test-font-002-production-font-mode.mjs | 160 | 7 | text | Y/N/Y | KEEP | — | Extracts+executes `fitTextToShape()` etc.; proves the TXT-103A-flagged authored-font throw gap is fixed. |
| test-font-cert-001-classification.mjs | 163 | 7 | text | N/N/N | KEEP | — | Pure `classifyCertification()` unit tests. See FONT-CERT merge-family note, §1 notes below. |
| test-font-cert-002-outline-detector-fixtures.mjs | 170 | 9 | text | N/N/N | KEEP | — | Pure `analyzeOutlineCommands()` unit tests, incl. the FONT-CERT-002 root-cause regression fixture. |
| test-font-cert-002-readability-metrics.mjs | 147 | 10 | text | N/N/N | KEEP | — | Pure `computeReadabilityFindings()`/`computeScaleCompliance()` unit tests. |

### Batch B — font/gallery/geometry (25 files)

| filename | lines | assertions | group(s) | app.js/html/manifest | classification | wiring/behavioral | reason |
|---|---:|---:|---|---|---|---|---|
| test-font-cert-002-word-space-narrative.mjs | 93 | 6 | text | N/N/N | KEEP | — | Pure `wordSpaceNarrative()`/`refinementNotes` unit tests, incl. the literal FONT-CERT-002 v003 regression (a 3.05x PASS ratio must never emit "runs together"). |
| test-font-decision-001-stone-size-ux.mjs | 255 | 9 | products, ui | Y/Y/N | KEEP (mixed) | 2 wiring / 7 behavioral | Extracts+executes `applyStoneSizeHeightAutoSet()`/`updateStoneSizePrintableCapabilityUI()` against real `StoneSizes`/`products`/`units`. |
| test-font-height-ratios.mjs | 306 | 16 | text | Y/N/Y | KEEP | — | Cross-checks manifest ratios against a live font-file re-measurement; extracts+executes real inverse-math helpers. |
| test-font-lib-003-crowding-hint.mjs | 353 | 11 | **NONE → recommend `text`** | Y/Y/Y | KEEP (mixed) | 1 wiring / 10 behavioral | Extracts+executes `updateStoneSizeOverlapCapabilityUI()`/`findBolderSibling()`. See merge-verdict below (not a merge). |
| test-font-lib-004-height-readability.mjs | 344 | 19 | **NONE → recommend `text`** | Y/Y/Y | KEEP (mixed) | 1 wiring / 18 behavioral | Extracts+executes `updateTextHeightReadabilityUI()`/`textStrokeNarrowerThanOneStone()`/`textHeightBelowReadableMinimum()`. See merge-verdict below. |
| test-font-lib-005-montserrat-retired.mjs | 154 | 8 | text | Y/N/Y | KEEP (mixed) | 1 wiring / 5 behavioral, 2 PIN-ONCE | Real backward-compat + `classifyStemRegime()` checks; 2 checks pin sha256/stemWidthRatio golden values. |
| test-font-lib-006-browse-fonts-flat-list.mjs | 180 | 7 | text | Y/N/Y | KEEP | — | Extracts+executes `renderFontLibraryList()`; flat-list/search/category behavior. |
| test-font-manager.mjs | 131 | 10 | text | N/N/Y | KEEP | — | Pure `FontManager` unit tests incl. legacy pre-field-existence record defaulting. |
| test-font-pitch-001-authored-stone-sizes.mjs | 209 | 2 | text | Y/N/Y | KEEP | — | Derives safe stone-pitch set from real glyph/kerning data (physical-overlap derivation, not a hardcoded pin). |
| test-font-portfolio-001-stone-size-gating.mjs | 214 | 6 | products, ui | Y/N/Y | KEEP | — | Extracts+executes the real SS30 per-font gate. |
| test-font-provider-registry.mjs | 128 | 6 | text | N/N/N | KEEP | — | Pure `FontProviderRegistry` unit tests via a mock provider. |
| test-font-source-001-evaluate.mjs | 85 | 2 | text | N/N/N | KEEP | — | Real `evaluateSource()` end-to-end (engineer-facing onboarding tool, not live-UI-reachable, but genuinely executes the real pipeline). |
| test-frame-library.mjs | 321 | 19 | shapes | N/N/N | KEEP | — | Pure `FrameLibrary`/`ShapeFit` geometry tests; foundational for Monogram Generator. |
| test-gallery-integration.mjs | 124 | 11 | gallery | Y/Y/N | **DEMOTE** | 11 wiring / 0 behavioral | Every check is a regex/substring match on app.js/index.html/package.json; nothing executes. Real Gallery correctness lives in `test-gallery.mjs`. |
| test-gallery.mjs | 206 | 18 | gallery | N/N/Y | KEEP | — | Real catalog/parsing/search logic against real fixtures; found+fixed a real legacy-color-name bug. |
| test-geometry-engine.mjs | 867 | 71 | geometry | N/N/Y | KEEP | — | Flagship `GeometryEngine` test. Check 12 is the one architectural check (no DOM/renderer/exporter reference from `src/geometry/*.js`) — not app.js/index.html text, so not a DEMOTE case. |
| test-geometry-layout-quality-metrics.mjs | 177 | 6 | geometry | N/N/N | KEEP | — | Real `measureStoneCrowding()`/outline-attrition tests incl. legacy-JSON backward compat. |
| test-geometry-path-corner-anchoring.mjs | 248 | 8 | geometry | N/N/N | KEEP | — | Real corner-anchored Outline sampling across a fixture matrix. |
| test-geometry-stone-overlap-cross-contour.mjs | 222 | 7 | geometry | N/N/N | KEEP | — | Real RC-002 Ring/SVG-donut cross-contour production-bug regression. |
| test-geometry-stone-overlap-cross-layer.mjs | 131 | 4 | geometry | N/N/N | KEEP | — | Real RC-004 cross-layer dedupe regression. |
| test-geometry-stone-overlap-early-exit.mjs | 153 | 7 | geometry | N/N/N | KEEP | — | Proves `hasAnyOverlappingStonePair()` boolean-equivalence to the full-pair finder — distinct perf-correctness proof. |
| test-geometry-stone-overlap-same-contour.mjs | 301 | 8 | geometry | N/N/Y | KEEP | — | Real RC-004A regression against a production fixture; exact stone counts are PIN-ONCE sentinels layered on top of a real physical-correctness assertion. |
| test-geometry-svg-polygon-cache.mjs | 127 | 5 | geometry | N/N/N | KEEP | — | Real `_svgNaturalPolygonCache` determinism/eviction tests. |
| test-history-manager.mjs | 169 | 8 | history | N/N/N | KEEP | — | Pure `HistoryManager` unit tests; protects Undo/Redo with zero DOM dependency. |
| test-image-pipeline.mjs | 191 | 9 | geometry | N/N/N | KEEP | — | Pure Image Trace field-preparation pipeline tests. |

### Batch C — image/lightbox/module-graph/monogram (25 files)

| filename | lines | assertions | group(s) | app.js/html/manifest | classification | wiring/behavioral | reason |
|---|---:|---:|---|---|---|---|---|
| test-image-trace-regression.mjs | 155 | 8 | geometry | Y/N/N | KEEP (mixed) | 3 wiring / 5 behavioral | Check 1 byte-matches a committed baseline; check 6 scans+parses every file to prove the one-way `src/image`→no-`geometry`-import rule; checks 7-8 execute real `generateImageLayout`/`validateProject`. |
| test-length-units.mjs | 67 | 8 | ui | N/N/N | KEEP | — | Pure `LengthUnits.js` unit tests. |
| test-lightbox-controller.mjs | 133 | 14 | ui | Y/Y/N | KEEP (repo convention) | 14 wiring / 0 behavioral | Every check is source-text inspection of the permanent `src/ui/Lightbox.js` contract — the repo's own sanctioned pattern for a module with no jsdom harness (S-111 explicitly kept its predecessor on these grounds). Meets the letter of DEMOTE; kept per established precedent — flagged, not changed. |
| test-lightbox-movable-persistent.mjs | 216 | 20 | ui | Y/Y/N | KEEP (repo convention) | 20 wiring / 0 behavioral | Same convention as above, for S-105 drag/clamp/persistence. Flagged, not changed. |
| test-maint-003-materializer-contract.mjs | 519 | 19 | editing | N/N/N | KEEP | 18 behavioral / 1 meta | Real headless paper.js + real materializer execution against real Gallery fixtures; caught a real double-rotation bug. |
| test-module-graph-exports.mjs | 126 | 3 | architecture | Y/N/N | KEEP (mixed) | 1 wiring / 2 behavioral | Checks 1-2 use Node's real ES module loader to walk the entire import graph from `app.js` — the strongest available "one GeometryEngine" proof outside a browser. |
| test-mono-002-authored-font-positional-scaling.mjs | 343 | 18 | monogram | N/N/Y | KEEP | — | Real `scaleAuthoredTextLayout()` execution: scale/pivot/minimum-legal-scale/failure-taxonomy. |
| test-mono-004-monogram-layout-engine.mjs | 325 | 11 | monogram | N/N/N | KEEP | — | Pure `computeMonogramLayout()` slot-geometry tests. |
| test-mono-005-headless-monogram-generator.mjs | 659 | 23 | monogram | N/N/Y | KEEP | — | Real `MonogramGenerator`+`GeometryEngine` end-to-end for every layout kind. |
| test-mono-005a-authored-scale-persistence.mjs | 193 | 11 | monogram | Y/N/Y | KEEP | — | Real `authoredScale` engine-param contract; default/throw-not-clamp/byte-match/rotation-invariance. See merge-verdict §1a below. |
| test-mono-005a-collision-query.mjs | 146 | 8 | monogram | N/N/N | KEEP | — | Pure `findCrossGroupCollisions()` tests. |
| test-mono-006-monogram-ui.mjs | 1066 | 34 | monogram | Y/N/Y | KEEP | ~33 behavioral / 1 wiring | Extracts+executes sliced app.js (`generateMonogram`, MONO-020 ownership) via real sandbox + real generator. Largest file in the suite. |
| test-mono-006a-authored-scale-regression.mjs | 399 | 19 | monogram | Y/N/N | KEEP | 4 wiring / 15 behavioral | Fixes+guards the edit-time invalidation hook. See merge-verdict §1a below. |
| test-mono-006b-stale-authored-scale-initial-load-recovery.mjs | 395 | 19 | monogram | Y/N/N | KEEP | 2 wiring / 17 behavioral | Fixes+guards a distinct entry point (import/autosave/undo-redo, not live field edits). See merge-verdict §1a below. |
| test-mono-006e-monogram-fitting-refinement.mjs | 230 | 10 | monogram | N/N/Y | KEEP | — | Real generator+engine reproduction of the named MONO-006E regression case. |
| test-mono-007-010-coverage.mjs | 287 | 13 | monogram | N/N/Y | KEEP | — | Fills a real documented coverage gap (`frame-too-small` branch, fallback-vs-override semantics). |
| test-mono-010-frame-stone-width-spacing.mjs | 141 | 2 | monogram | N/N/Y | KEEP | — | Real fix for a silent second-row stone deletion (outline-offset pitch bug). See merge-verdict §1b below. |
| test-mono-011-frame-stone-autoshrink.mjs | 163 | 2 | monogram | Y/N/Y | KEEP | — | Real `generateMonogramWithFrameAutoShrink()` retry-loop execution. See merge-verdict §1b below. |
| test-mono-012-single-chain.mjs | 331 | 15 | monogram | N/N/Y | KEEP | 1 PIN-ONCE | Real `SingleChain.js` arithmetic + generator tests; final test pins a byte-identical baseline. |
| test-mono-013-interlock.mjs | 397 | 14 | monogram | N/N/Y | KEEP | — | Real `'script'` interlocked-layout tests with negative controls. |
| test-mono-014-frame-hierarchy.mjs | 359 | 11 | monogram | Y/N/Y | KEEP | — | Real `frameHierarchy` classification + auto-shrink catalog-filter negative control. |
| test-mono-015-weight-sizing.mjs | 530 | 21 | monogram | Y/N/Y | KEEP | 3 PIN-ONCE | Real geometric sampling/statistics (`StrokeWidthProbe`); slowest monogram file (2.47s) for legitimate reasons. |
| test-mono-016-letter-spacing.mjs | 383 | 12 | monogram | Y/N/N | KEEP | 1 embedded golden set | Real asymmetric-range/monotonicity proofs. |
| test-mono-018-binding-letter.mjs | 259 | 7 | monogram | N/N/Y | KEEP | 1 embedded golden | Real non-monotone stem-figure-reporting bug fix, with a genuine negative control. |
| test-mono-019-layer-ids.mjs | 319 | 8 | **NONE → recommend `monogram`** | Y/N/Y | KEEP | 1 embedded golden | Real duplicate-id-bug fix with an explicit negative control (unfixed generator collides). |

### Batch D — mono-021/move-drag/products/renderers/perf/security (25 files)

| filename | lines | assertions | group(s) | app.js/html/manifest | classification | wiring/behavioral | reason |
|---|---:|---:|---|---|---|---|---|
| test-mono-021-mark-hooks.mjs | 290 | 10 | editing | Y/N/N | KEEP (mixed) | 5 wiring / 4 behavioral, 1 meta | Real `paper.tool` pointer-gesture harness for UI-to-canvas rebuild wiring. Tests 4-8 are wiring-guard-eligible on their own. See merge-verdict §1c below. |
| test-mono-021-text-layer-edits.mjs | 503 | 23 | geometry | N/N/Y | KEEP | — | Real `GeometryEngine.generateTextLayout()` edit-application math; zero app.js involvement. See merge-verdict §1c below. |
| test-mono-022-reachable-remedies.mjs | 244 | 7 | monogram | N/N/Y | KEEP | — | Real `CHAIN_TOO_THIN` remedies contract, with a byte-identical-to-baseline diff proving only the new field was added. |
| test-move-drag-fast-path-wiring.mjs | 128 | 12 | editing | Y/N/N | **DEMOTE** | 12 wiring / 0 behavioral | Every check is a source-text pattern match ("expected X bound", "expected Y to not contain Z"); nothing executes. |
| test-move-drag-translate.mjs | 120 | 5 | editing | Y/N/N | KEEP | — | Extracts+executes `translateLayoutForMoveDrag()` against real `Stone`/`StoneLayout`. |
| test-object-dimensions.mjs | 213 | 22 | products | N/N/N | KEEP | — | Pure `ObjectDimensions.js` numeric tests + RS-2010 vessel-params regression. |
| test-object-geometry-builder.mjs | 392 | 23 | renderers | N/N/N | KEEP | — | Real three.js `BufferGeometry` inspection; 3 concrete human-observed-defect regressions. |
| test-object-preview-renderer.mjs | 157 | 8 | renderers | N/N/N | **REMOVE** (see §4) | 1 wiring / 7 behavioral | Genuinely real behavior against fake ctx, but CupRenderer.js itself is dead — see CupRenderer resolution. |
| test-object-template-integration.mjs | 319 | 19 | products | Y/Y/Y | KEEP (mixed) | 11 wiring / 8 behavioral | Real merged-StoneLayout byte-identity proof across all 3 object templates (test 15) — a real architectural invariant — plus wiring checks. |
| test-object-template.mjs | 193 | 19 | products | N/N/N | KEEP | — | Pure `ObjectTemplate.js` registry unit tests. |
| test-opentype-provider.mjs | 121 | 8 | text | N/N/Y | KEEP | — | Real `OpenTypeProvider` tests incl. a deliberately corrupt font fixture. |
| test-path-boolean-integration.mjs | 317 | 22 | geometry | Y/Y/N | KEEP (mixed) | 13 wiring / 9 behavioral | Real engine/exporter execution for path-layer boolean ops. |
| test-path-boolean.mjs | 220 | 15 | geometry | N/N/N | KEEP | — | Pure `PathBoolean.js` math, closed-form cross-check. |
| test-pdf-document.mjs | 147 | 12 | exporters | N/N/N | KEEP | — | Byte-level PDF xref/MediaBox/Bezier-op verification, computed fresh each run (not a golden pin). |
| test-perf-005-stone-size-lazy-sweep.mjs | 137 | 4 | **NONE → recommend `editing`** | Y/N/N | KEEP (mixed) | 1 wiring / 3 behavioral | Extracts+executes the real UI call-count fix; belongs with the other edit-frequency tests. See merge-verdict §1d below. |
| test-perf-006-point-in-polygon-cache.mjs | 160 | 5 | **NONE → recommend `geometry`** | N/N/N | KEEP | — | Real 200-trial differential test against a naive reference + a real before/after timing proof. See merge-verdict §1d below. |
| test-preview3d-instanced-stones.mjs | 266 | 8 | renderers | N/N/N | KEEP | — | Real three.js `InstancedMesh` matrix/color inspection, incl. real-clock throttle-window behavior. |
| test-preview3d-render-scheduling.mjs | 107 | 6 | renderers | N/N/N | KEEP | — | Real rAF-scheduling invariant tests. |
| test-preview3d-stone-orientation.mjs | 151 | 3 | renderers | N/N/N | KEEP | — | Real quaternion/matrix tangent-frame math. |
| test-product-plate-round-dinner.mjs | 543 | 39 | products | Y/Y/Y | KEEP (mixed) | 18 wiring / 20 behavioral, 1 meta | S-112+S-112A merge (MAINT-001); real product-definition/engine/production-sheet execution plus UI wiring checks. |
| test-product-vessel-dimensions.mjs | 304 | 25 | products | Y/Y/N | KEEP (mixed) | 5 wiring / 19 behavioral, 1 meta | Heavily behavior-dominant real `VesselProductDefinition.js` + `validateProject()` execution. |
| test-production-export-validation.mjs | 235 | 15 | exporters | Y/Y/N | KEEP (mixed) | 4 wiring / 11 behavioral | Real `Stone`/`StoneLayout`/SVG-output checks; check 10 is a source-text purity sweep — **CUPRENDERER-RELATED**, see §4. |
| test-production-sheet-exporter.mjs | 411 | 22 | exporters | Y/Y/Y | KEEP (mixed) | 5 wiring / 17 behavioral | Real `computeProductionSheetLayout()`/SVG/PDF execution across a full object-template × page-size sweep. |
| test-project-model-consolidation.mjs | 124 | 5 | architecture | Y/N/N | KEEP | — | One of S-111's explicit `test:architecture` files; check 2 scans the whole codebase for a `src/core/` reference (a genuine codebase-wide invariant). |
| test-project-validation-security.mjs | 256 | 13 | security | Y/N/N | KEEP | — | SEC-001: real `validateProject()`/`escapeHtml()`/`renderLayerUI()` execution against hostile XSS strings — genuine security-behavior verification, not a token check. |

### Batch E — READ series + rs3011/rs3012/rs-block/rs-modern (25 files)

| filename | lines | assertions | group(s) | app.js/html/manifest | classification | wiring/behavioral | reason |
|---|---:|---:|---|---|---|---|---|
| test-read-001-contour-centreline.mjs | 458 | 12 | geometry | N/N/N | KEEP | — | Real `StoneSampler.js` Contour-mode geometry. Live for shapes/SVG/image/path Fill Style (Contour retired for **text only**, per READ-006A) — see §3. |
| test-read-002-radial-per-glyph.mjs | 187 | 7 | geometry | N/N/N | KEEP | — | Real `StoneSampler.js` Radial-mode geometry, same live-reachability argument as READ-001. |
| test-read-003-stem-width.mjs | 193 | 11 | text | Y (excluded) | KEEP | — | Live: `manifest.json`'s `stemWidthRatio` drives `strokeNarrowerThanOneStone()` at `app.js:3454-3455`. Correctly `EXCLUDED_FROM_DEFAULT` (65.5s). |
| test-read-004-recognition-harness.mjs | 327 | 13 | text | N/N/Y | KEEP | — | Checks 6, 10 call `analyzeOne()`, which internally drives the real, live `GeometryEngine.generateTextLayout()`; check 10 catches a real `letterSpacingMm`-not-forwarded regression class. The rest exercises offline tooling (`font-certification/lib/**`), not app.js. |
| test-read-005-derived-tables.mjs | 132 | 7 | documentation | N/N/N | PIN-ONCE | — | Golden-file guard for `docs/data/read-005/derived-tables.json`; no live consumer outside `tools/font-certification/**`. |
| test-read-008-ratio-floor.mjs | 167 | 4 | ui | Y/N/Y | KEEP | — | Live: `MIN_HEIGHT_TO_STONE_RATIO`/`computeAutoFitScale()` at `app.js:554`, called at `app.js:905,1184,3057`. See §3, §1e. |
| test-read-009-bridge-autofit-floor.mjs | 185 | 4 | gallery | N/N/Y | KEEP | — | Shares the live floor function, but its direct subject (`RhsFixtureBridge.generateProjectStoneLayout()`) has **no app.js call site** — protects `test-examples-regression.mjs`'s fixture corpus instead. See §3, §1e. |
| test-read-010-warn-only-floor.mjs | 331 | 14 | **NONE → recommend `ui`** | Y/Y/Y | KEEP | ~2 wiring / 12 behavioral | Fully live: `textLayersBelowReadableMinimum` (`app.js:3427`), `updateProdSheetReadabilityValidation` (`app.js:5177`, called from all 3 export handlers + Lightbox `onOpen`), `ceilToDisplayPrecisionMm` (`app.js:6754`). See §3, §1e. |
| test-read-011-stem-regime.mjs | 179 | 7 | geometry | N/N/Y | PIN-ONCE | — | Guards `StemRegime.js`, confirmed **not** exported from `src/geometry/index.js` and **not** imported by app.js/any live module. See §3. |
| test-read-011b-render-plan.mjs | 207 | 10 | geometry | N/N/Y | PIN-ONCE | — | Pins `docs/data/read-011/render-plan.json`; zero live consumer outside `tools/**`. See §3. |
| test-read-011c-render-key.mjs | 208 | 11 | geometry | N/N/N | PIN-ONCE | — | Pins `docs/data/read-011/render-key.json`; zero live consumer. See §3. |
| test-read-011c-tracking-solver-regression.mjs | 174 | 2 | geometry (excluded) | N/N/Y | PIN-ONCE | — | Pins `lib/trackingSolver.mjs` against a frozen key; consumed only by offline `font-certification/**` tooling. Correctly excluded (16.4s). |
| test-read-011d-session3.mjs | 240 | 13 | documentation | N/N/Y | PIN-ONCE | — | Pins `computeSession3()`'s derived-tables output; zero live consumer. |
| test-read-011e-reachability.mjs | 151 | 7 | documentation | N/N/N | PIN-ONCE | — | Re-derives facts purely from `computeSession3()`'s in-memory output — the reachability dry-run proof itself. See §3. |
| test-render-export-pipeline.mjs | 190 | 9 | renderers | Y/N/N | KEEP | 2 wiring / 7 behavioral | Real fake-ctx draw-call + real SVG-output checks. Checks 8-9 are a source-text renderer/exporter purity sweep — **CUPRENDERER-RELATED**, see §4. |
| test-rhinestone-font-prototype.mjs | 314 | 20 | text | N/N/Y | KEEP | — | Real deterministic-generation tests; deliberately not `manifest.json`-registered (diagnostic-only, not user-reachable via the font picker — flagged, not a REMOVE case since the module/registry code is real and live). |
| test-rs-3025-length-field-mm-stash.mjs | 257 | 6 | ui | Y/N/N | KEEP | ~6 preconditions / 6 real | Extracts+executes real length-field functions; behaviorally proves a real ~0.09mm precision-loss bug is fixed. |
| test-rs-block.mjs | 477 | 30 | text | N/N/Y | KEEP | — | Live default production font (FONT-002); full 70-char coverage, kerning, 200-string corpus, collision-freedom. |
| test-rs-modern.mjs | 463 | 30 | text | N/N/Y | KEEP | — | Second live production font; same rigor as RS Block. Structurally mirrors test-rs-block.mjs but protects distinct authored glyph data — not a merge candidate. |
| test-rs2012-text-gap-mixed-size-ux.mjs | 245 | 16 | ui | Y/Y/N | KEEP (mixed) | ~3 wiring / 13 behavioral | Extracts+executes real mixed-size eligibility/UI functions against fake DOM/layout harnesses. |
| test-rs3011-step10a-region-data-model.mjs | 334 | 6 | geometry | N/N/N | KEEP | — | Real Paint-region `generatePathLayout()` data-model tests. See merge-verdict §1f below. |
| test-rs3011-step10b-paint-target-selection.mjs | 245 | 4 | geometry | N/N/N | KEEP | — | Real `selectPaintTarget()`/coordinate-inversion tests, a different module (`PaintRegionSelection.js`). See merge-verdict §1f below. |
| test-rs3011-step8-svg-import-flattening.mjs | 281 | 7 | exporters | N/N/N | KEEP | — | Real headless paper.js SVG-import-flattening pipeline, incl. a real donut-hole avoidance round-trip. |
| test-rs3012-step4-circle-select.mjs | 285 | 10 | editing | Y/N/N | KEEP | 1 wiring / 9 behavioral | Real headless `DrawingCanvasTool` mouse-event execution (circle radius-from-center resize, no rotate handle). See merge-verdict §1g below. |
| test-rs3012-step5-rectangle-select.mjs | 286 | 9 | editing | Y/N/N | KEEP | 1 wiring / 8 behavioral | Same harness; includes a real materializer-misrouting regression trap + a real Gallery-fixture round-trip. See merge-verdict §1g below. |

### Batch F — rs3015/s200/shapes/svg/ui/stone-layout (25 files)

| filename | lines | assertions | group(s) | app.js/html/manifest | classification | wiring/behavioral | reason |
|---|---:|---:|---|---|---|---|---|
| test-rs3015-mark-target-eligibility.mjs | 561 | 14 | editing | Y/N/Y | KEEP | ~1 meta | Real headless paper.js gesture harness through real resolver + real `MonogramGenerator`/`GeometryEngine`. |
| test-s200-app-integration.mjs | 215 | 13 | ui | Y/Y/N | KEEP (mixed) | 9 wiring / 4 behavioral | Real `resolveSizeMode()`/`mixedSizeParamsFor()`/`validateProject()` execution incl. legacy-layer backward compat. |
| test-s200-mixed-stone-sizes.mjs | 287 | 19 | geometry | N/N/Y | KEEP | — | Real `MixedSizeGenerator`/`GeometryEngine` execution; protects the additive-only infill architecture rule. |
| test-s200-production-sheet-grouping.mjs | 98 | 7 | exporters | N/N/N | KEEP | — | Real Production-Sheet size-breakdown grouping/reconciliation. |
| test-shape-fit.mjs | 248 | 17 | shapes | N/N/N | KEEP | — | Pure geometry-math proofs against closed-form formulas. |
| test-shape-library-integration.mjs | 110 | 5 | shapes | N/N/N | KEEP | — | Every shape kind driven through real Boolean Ops/export/Production-Sheet — the S-110 architectural point. |
| test-shape-library.mjs | 233 | 15 | shapes | N/N/N | KEEP | — | Real natural-contour math + real `GeometryEngine.generateShapeLayout` integration. |
| test-shapes-around-text-creation.mjs | 190 | 10 | shapes | Y/Y/N | KEEP (mixed) | 4 wiring / 5 behavioral, 1 meta | Real `computeShapeAroundText()`/printable-area-containment execution. |
| test-shapes-design-consolidation.mjs | 268 | 16 | shapes | Y/Y/N | DEMOTE-leaning (mixed) | 13 wiring / 2 behavioral, 1 meta | Only 2 of 16 checks execute real code (`defaultShapeExtraFields()`/`shapeExtraParams()`); the rest are markup/order regex. |
| test-snap-engine.mjs | 130 | 12 | editing | N/N/N | KEEP | — | Pure `SnapEngine.js` unit tests. |
| test-source-hygiene.mjs | 68 | 1 | architecture | Y/N/N | KEEP | — | Codebase-wide NUL-byte hygiene scan (app.js + all of `src/**`) — a real regression guard, not a single-file token check. |
| test-stone-color.mjs | 120 | 8 | stone-layout | N/N/Y | KEEP | — | Real `Stone`/`StoneLayout`/engine color-preservation tests. |
| test-stone-size-library.mjs | 228 | 15 | stone-layout | N/N/N | KEEP | — | Real `STONE_SIZES` catalog tests incl. cross-file sync against `tools/font-generator/config/`. |
| test-stone-sprite-cache.mjs | 156 | 10 | renderers | N/N/N | KEEP | — | Real sprite-cache determinism/cache-hit tests against a fake canvas. |
| test-svg-integration.mjs | 147 | 7 | exporters | Y/Y/N | DEMOTE-leaning (mixed) | 6 wiring / 1 behavioral | Only check 6 executes real code (`validateProject()` accept/reject for `svg` layers); the rest is routing/import regex. |
| test-svg-parser.mjs | 341 | 28 | exporters | N/N/N | KEEP | — | Extensive real SVG-spec-edge-case parser tests. |
| test-text-position-workflow.mjs | 465 | 45 | ui | Y/Y/N | KEEP (mixed) | ~34 wiring / ~10 behavioral, 1 meta | S-104+S-107 merge (MAINT-001); B17-B26 execute real `computeTextAutoFitScale`/`ObjectDimensions.js` math; the rest is drag/recovery regex. |
| test-topmenu-active-state.mjs | 181 | 5 | ui | Y/N/N | KEEP | — | Extracts+executes real top-menu state functions against a fake DOM + real `Lightbox.js`. |
| test-txt-103-text-sizing-consistency.mjs | 106 | 7 | ui | Y/Y/N | KEEP (mixed) | 3 wiring / 4 behavioral | Extracts+executes the real `l.height=Math.max(...)` clamp expression across boundary inputs. |
| test-typography-font-library.mjs | 397 | 20 | text | Y/Y/Y | KEEP (mixed) | 4 wiring / 16 behavioral | Real `FontManager` + extracted-and-executed `populateFontOptions()`/`renderFontLibraryList()`/favorites round-trip. |
| test-ui-import-autoswitch-regression.mjs | 234 | 4 | ui | Y/N/N | KEEP | — | Replays real app.js statements in their **actual source order** (derived, not assumed) — fails on unmodified `develop`. |
| test-ui-shell-structure.mjs | 474 | 21 | ui | Y/Y/N | KEEP (repo convention) | 21 wiring / 0 behavioral | Every check is markup/handler-presence regex; the file's own header states real interaction is covered by manual browser verification. Meets the letter of DEMOTE; kept per established S-111 precedent (no jsdom in this repo). Flagged, not changed — notably this file is also in the Tier-1 `fast` group. |
| test-ux-visual-polish.mjs | 285 | 10 | ui | Y/Y/Y | KEEP (mixed) | 5 wiring / 4 behavioral, 1 PIN-ONCE | Checks 7-8 **live-import and execute** `renderCup()` — **CUPRENDERER-RELATED**, see §4. Check 9 pins an exact stone count/bbox; check 10 pins exact SVG output (PIN-ONCE). |
| test-variable-stone-sizes.mjs | 247 | 10 | stone-layout | Y/Y/Y | KEEP (mixed) | 3 wiring / 7 behavioral | Real per-layer mixed-size engine/exporter execution. |
| test-vector-path.mjs | 123 | 9 | text | N/N/N | KEEP | — | Pure `VectorPath.js` primitive unit tests. |

**Totals:** 150 files, 1,876 assertions (mechanically counted, cross-checked against every batch's
own per-file counts). Zero REMOVE candidates found among ordinary application-code tests; the only
two REMOVE candidates are the two CupRenderer.js-exclusive suites (§4). Zero PIN-ONCE-only files
outside the READ-011 family and 3 isolated golden checks embedded in otherwise-behavioral files
(noted inline above).

---

## 2. Merge-candidate verdicts

Every one of the 10 merge-candidate pairs/groups the task named was evaluated by reading every file
in the group in full. **All 10 evaluated to KEEP-SEPARATE — zero actual merges.** This is itself the
headline finding of this pass: the suite's apparent duplication, on closer reading, is almost
entirely either (a) the repo's own established unit/integration split (already blessed by S-111), or
(b) distinct bugs/entry-points sharing a feature-area name but not a code path.

| Candidate group | Files | Verdict | Evidence |
|---|---|---|---|
| **§1a** Authored-scale trio | mono-005a-authored-scale-persistence, mono-006a-authored-scale-regression, mono-006b-stale-authored-scale-initial-load-recovery | KEEP-SEPARATE | Three independently-reported, independently-fixed bugs at three non-overlapping call sites: the engine parameter contract itself (005a, no app.js); the *edit-time* invalidation hook `writeSelectedControlsToLayer()`→`invalidateAuthoredScaleForGeometryChange()` (006a); and a *different* entry point — initial load/import/autosave/undo-redo, none of which ever call `writeSelectedControlsToLayer()` — fixed via `recoverStaleAuthoredScales()` as the first statement of `generate()` (006b). Each file's own header explicitly documents why the others don't cover it. |
| **§1b** Frame stone width pair | mono-010-frame-stone-width-spacing, mono-011-frame-stone-autoshrink | KEEP-SEPARATE | 010 is a pure `FrameLibrary`/`GeometryEngine` row-offset-pitch fix (never touches app.js); 011 is an app.js UI-orchestration retry loop (`generateMonogramWithFrameAutoShrink()`). Different layers, zero fixture/assertion overlap. |
| **§1c** MONO-021 pair | mono-021-mark-hooks, mono-021-text-layer-edits | KEEP-SEPARATE | text-layer-edits (`geometry` group) proves the pure edit-application algorithm via direct `GeometryEngine` calls, never touching app.js. mark-hooks (`editing` group) proves the UI-to-canvas rebuild-gate wiring via a real `paper.tool` pointer-gesture harness — its own header states "the engine-level edit application... is covered by test-mono-021-text-layer-edits.mjs." The different subsystem-group placement accurately reflects a real split, not an accident. |
| **§1d** PERF pair | perf-005-stone-size-lazy-sweep, perf-006-point-in-polygon-cache | KEEP-SEPARATE, register into different groups | 005's subject is app.js's live-editing UI responsiveness (`updateStoneSizeOverlapCapabilityUI()` call-count fix) — belongs in `editing`. 006's subject is a pure spatial-geometry cache (`isPointInsidePolygons` in `StoneSampler.js`) — belongs in `geometry`. Both short because each is scoped to one optimization's mechanism-level proof, not because they duplicate each other. |
| **§1e** READ-008/009/010 trio | read-008-ratio-floor, read-009-bridge-autofit-floor, read-010-warn-only-floor | KEEP-SEPARATE | Three distinct call sites: 008 = the live on-canvas/export `computeAutoFitScale()` path against the full fixture corpus; 009 = a *tools-only* call site (`RhsFixtureBridge.generateProjectStoneLayout()`, confirmed to have no app.js consumer — Gallery's real open path uses `engine.generate()` directly) protecting the fixture corpus itself; 010 = an entirely different UI surface (project-wide warn-only sweep + fix-to-floor button + a real display-rounding bug). All three call sites verified live or tools-scoped by direct grep — see §3. |
| **§1f** RS3011 step10a/step10b | rs3011-step10a-region-data-model, rs3011-step10b-paint-target-selection | KEEP-SEPARATE | 10a tests the region **data model** (`generatePathLayout()`'s `regions` field: exclusion, priority, serialization, transform-tracking). 10b tests **target selection** (`selectPaintTarget()` in the separate `PaintRegionSelection.js` module — "which shape," not "how does the fill split"). 10b's own header frames itself as consuming 10a's transform convention, not repeating it. |
| **§1g** RS3012 step4/step5 | rs3012-step4-circle-select, rs3012-step5-rectangle-select | KEEP-SEPARATE | Same interaction harness, but each guards a distinct per-shape-type dispatch contract (circle: radius-from-center resize, no rotate handle; rectangle: box-corner resize, full rotate, plus a real materializer-misrouting regression trap and a real Gallery-fixture round-trip). Low-priority follow-up noted: the two files' harness boilerplate (`toolEvent()`/`emit()`/canvas setup) is duplicated and could be extracted to a shared `tools/lib/` helper without merging the files themselves. |
| **§1h** READ-011 trio | read-011-stem-regime, read-011b-render-plan, read-011c-render-key | KEEP-SEPARATE | A linear pipeline, each pinning a distinct artifact with zero literal duplicate assertions: 011 pins `classifyStemRegime()`'s logic + manifest membership; 011b pins the experimental-design invariants of `render-plan.json`; 011c pins the *post-render* derived-field contract of `render-key.json`, built on top of 011b's plan. Matches MAINT-001's own precedent for the 3 RC overlap-detection files (superficially similar, confirmed-distinct, renamed not merged). |
| **§1i** FONT-CERT family | font-cert-001-classification, font-cert-002-outline-detector-fixtures, font-cert-002-readability-metrics, font-cert-002-word-space-narrative | KEEP-SEPARATE | Each tests a different pure-logic module (`classification.mjs`, `glyphOutline.mjs`, `readabilityMetrics.mjs`, `reportHtml.mjs`'s narrative function respectively) against hand-built synthetic fixtures — no shared font-loading harness of any kind. Only literal duplication found: a 3-line `mapOf()` helper defined identically in 2 of the 4 files (negligible, not evidence of overlapping coverage). |
| **§1j** FONT-LIB-003/004 pair | font-lib-003-crowding-hint, font-lib-004-height-readability | KEEP-SEPARATE, register both into `text` | Each owns a **different DOM element** (`#stoneSizeCrowdingHint` packing-density warning vs. `#heightBelowReadableWarning` legibility warning) and a different app.js function pair. They do share one real dependency (both encode the READ-003 stroke-gate precedence rule against their own warning), which is deliberate cross-referencing between two independently-evolving UI surfaces, not duplicated setup — folding them together would conflate two different warnings under one harness. |

Two additional near-duplicate pairs were independently noticed (not on the task's original list) and
are flagged, not merged, for the same reasons:
- **test-rs-block.mjs / test-rs-modern.mjs** mirror each other's 30 test titles/structure almost
  exactly but protect genuinely distinct authored glyph data (the actual content at risk). The shared
  harness code (`makeEngine()`, `expectedStonesForText()`) is a low-priority extraction candidate.
- **test-rs3012-step4/step5**'s harness boilerplate (noted in §1g).

---

## 3. READ series specific finding

The READ program (READ-000 through READ-011E) is often summarized as having "shipped no readability
floor." That summary is only half true, and conflating its two halves would misclassify 3 of the 14
files. Two distinct things happened:

**A flat, warn-only floor (`MIN_HEIGHT_TO_STONE_RATIO = 16`, READ-008) is live and shipped.** It is
wired into `src/geometry/TextAutoFit.js`'s `computeTextAutoFitScale()`, called from `app.js:905,
1184, 3057` for Auto-Fit/Fit-to-Shape scaling, and into a project-wide warn-only Production Sheet
sweep (READ-010): `textLayersBelowReadableMinimum()` (`app.js:3427`),
`updateProdSheetReadabilityValidation()` (`app.js:5177`, called from all 3 export handlers at
`app.js:5191-5192` and the `prodSheet` Lightbox's `onOpen` at `app.js:5270`), and
`ceilToDisplayPrecisionMm()` (`app.js:6754`, used at `app.js:4565`).

**The READ-011 program's attempt to *replace* that flat ratio with a font-aware/mode-aware floor
never shipped.** Quoting `docs/specifications/READ-011E-PreRegistrationDefect.md` directly:

> "§4 ... under any ratings whatsoever, READ-011D §6 resolves to 'Otherwise Form B is adopted.' Form
> A was never reachable through the selection rule."
>
> "§8 Disposition: **No floor.** `MIN_HEIGHT_TO_STONE_RATIO` stays at **16**, warn-only."

Per file, by category:

**(a) guards live code still called from app.js or src/\*\*:**
- `test-read-003-stem-width.mjs` — `manifest.json`'s `stemWidthRatio` is read live at
  `app.js:3454-3455` inside `strokeNarrowerThanOneStone()`, driving the stroke-width UI warning.
- `test-read-008-ratio-floor.mjs` — `computeAutoFitScale()` (`app.js:554`), called at `app.js:905,
  1184, 3057`. Confirmed by grep.
- `test-read-010-warn-only-floor.mjs` — all four call sites above confirmed by grep, exactly
  matching the citations in `docs/specifications/READ-010-WarnOnlyFloor.md` §2-§4.
- `test-read-001-contour-centreline.mjs` / `test-read-002-radial-per-glyph.mjs` — guard
  `src/geometry/StoneSampler.js`'s Contour/Radial fill-sampling branches. READ-006A retired these
  fill **modes** only for **text** layers (`docs/specifications/READ-006A-RetireTextFillModes.md`);
  `sampleShapeFillPoints()`'s `case 'contour'`/`case 'radial'` dispatch (`StoneSampler.js:1555-1556`)
  remains reachable from `GeometryEngine.generateShapeLayout/generateSvgLayout/generateImageLayout/
  generatePathLayout` via the live `#shapeFillMode`/`#svgMode`/`#imageFillMode` selects
  (`app.js:2373-2545`) for every non-text layer type. Live.
- `test-read-004-recognition-harness.mjs` — mostly offline-tooling tests (`font-certification/
  lib/**`, no live consumer), but checks 6 and 10 call `analyzeOne()`, which internally drives the
  real, live `GeometryEngine.generateTextLayout()`; check 10 specifically catches a real
  `letterSpacingMm`-not-forwarded regression class against a live field (`layer.letterSpacing`,
  `app.js:823`). Mixed provenance — mostly (b), partly (a).

**(b) guards a frozen data file/analysis artifact against itself with no live consumer:**
- `test-read-005-derived-tables.mjs` — pins `docs/data/read-005/derived-tables.json`.
- `test-read-011-stem-regime.mjs` — guards `src/geometry/StemRegime.js`. Confirmed:
  `grep -n "StemRegime" src/geometry/index.js` returns nothing (not exported from the barrel);
  `grep -rn StemRegime app.js src/` finds only a comment reference in `src/monogram/SingleChain.js`
  ("StemRegime.js's own boundaries are deliberate literals"), never an import.
- `test-read-011b-render-plan.mjs` — pins `docs/data/read-011/render-plan.json`.
- `test-read-011c-render-key.mjs` — pins `docs/data/read-011/render-key.json`.
- `test-read-011c-tracking-solver-regression.mjs` — pins `lib/trackingSolver.mjs` against a frozen
  key; consumers confirmed to be exclusively `tools/font-certification/{read-011-renders,
  tracking-renders}.mjs` (offline rendering pipeline).
- `test-read-011d-session3.mjs` — pins `computeSession3()`'s derived-tables output.
- `test-read-011e-reachability.mjs` — the reachability dry-run itself; re-derives facts purely from
  `computeSession3()`'s in-memory output, reads no image, no app.js.
- `test-read-009-bridge-autofit-floor.mjs` — hybrid: the floor **function** it calls is live (shared
  with 008), but its direct subject, `RhsFixtureBridge.generateProjectStoneLayout()`, has zero app.js
  consumers (`grep -rln generateProjectStoneLayout` hits only `tools/**` and
  `src/gallery/{RhsFixtureBridge,index}.js`; app.js's Gallery-open path uses `engine.generate()`
  directly per the traced call chain at `app.js:6544-6553`). It is real, valuable infrastructure for
  `test-examples-regression.mjs`'s fixture corpus, just not a live UI call site.

**(c) guards a floor/threshold that was never shipped to production:** **None of the 14 files land
cleanly here.** The two files that most directly touch the READ-011E "no floor" conclusion
(`test-read-011d-session3.mjs`, `test-read-011e-reachability.mjs`) don't assert that the unshipped
floor *is* shipped — they correctly document, as a pre-registration reachability dry-run, that it
*couldn't have been* adopted under any rating outcome. That is category (b) (a frozen analysis
artifact pinned against itself), not (c)'s failure mode of a test masquerading as production
protection for something that never shipped.

**Conclusion:** 3 of 14 READ files are live-code guards (KEEP), 6 are frozen-artifact pins with no
live consumer (PIN-ONCE, not REMOVE — they protect the offline font-certification pipeline's own
regression safety, a real and still-used piece of engineering infrastructure, just not the shipped
web app), 1 is a hybrid (KEEP), 1 is mixed-provenance (KEEP), and the remaining 3
(read-001/002/003-adjacent) are live geometry-code guards. Zero files fall into category (c).

---

## 4. CupRenderer resolution

**`src/renderer/CupRenderer.js` is confirmed unreachable from the live application.** Traced every
non-comment reference from `index.html` and `app.js` through the real import graph:

- `index.html`: zero references to `CupRenderer` anywhere.
- `app.js`: zero `import` statements referencing `CupRenderer.js`. The only three hits are comments
  explaining the RS-1006 history (`app.js:56-60`). `app.js`'s real `src/renderer/` imports are
  `CanvasRenderer2D.js`, `StoneColors.js`, `StoneSizes.js` only (`app.js:91,94,95`).
- No `src/renderer/index.js` barrel exists to re-export it.
- Every other reference across `src/**` (`CrystalColors.js`, `CanvasRenderer2D.js`,
  `src/products/ObjectTemplate.js`, `src/preview3d/{ObjectDimensions,ObjectGeometryBuilder,
  Preview3DRenderer}.js`, `StoneColors.js`, READMEs) is prose in a comment or README, never an
  `import`/`require`/dynamic `import()`.

This confirms RS-1006's/`docs/ARCHITECTURE.md`'s documented claim. **Proposal: remove
`src/renderer/CupRenderer.js` and its two `EXCLUDED_FROM_DEFAULT` suites together**, breaking the
circular "kept because a test exercises it" rule that has preserved it since S-111:

- `test-cup-rotation-stabilization.mjs` (178 lines, 10 assertions, ~5 wiring/~5 behavioral) —
  **REMOVE**.
- `test-object-preview-renderer.mjs` (157 lines, 8 assertions, 1 wiring/7 behavioral) — **REMOVE**.

**Three currently-KEEP, in-default files would need a small edit as a side effect** if
`CupRenderer.js` is actually deleted in a future implementation milestone — none of these lose their
real value, they just lose a reference to a module that no longer exists:

- `test-ux-visual-polish.mjs` (in default `npm test`, `ui` group) — checks 7 and 8 **live-import and
  execute** `renderCup()` directly (full-rotation-sweep no-throw proof; handle-attachment continuity
  regression via captured `bezierCurveTo` calls). These 2 of 10 assertions exist only to exercise
  `CupRenderer.js` and would need to be dropped along with the module. Check 6 (a source-text purity
  regex) would also need its `CupRenderer.js` clause removed.
- `test-render-export-pipeline.mjs` (in default, `renderers` group) — checks 8-9 read
  `CupRenderer.js`'s source as part of a 2-file (`CupRenderer.js`+`CanvasRenderer2D.js`) purity
  sweep. Removing the `CupRenderer.js` clause (keeping the `CanvasRenderer2D.js` half) is a one-line
  edit, not an assertion loss.
- `test-production-export-validation.mjs` (in default, `exporters` group) — check 10 reads
  `CupRenderer.js`/`CanvasRenderer2D.js`/`SvgExporter.js` source for the same 3-file purity sweep.
  Same one-line-edit treatment.

Net effect of the full CupRenderer removal: **−2 files, −18 assertions** (10+8) from the 150-file/
1,876-assertion baseline, plus 3 one-line edits in files that keep their KEEP classification and the
rest of their assertion count unchanged.

---

## 5. Registration

**6 ungrouped files**, each read in full, with a recommended home based on actual content (not
filename guessing):

| File | Recommended group | Basis |
|---|---|---|
| `test-font-lib-003-crowding-hint.mjs` | `text` | Imports `FontManager`/`StoneSizes`/`text` modules; owns the `#stoneSizeCrowdingHint` warning. Not `products` or `shapes` — matches the other font-UX files already in `text`. |
| `test-font-lib-004-height-readability.mjs` | `text` | Same import surface as above; owns `#heightBelowReadableWarning`. |
| `test-mono-019-layer-ids.mjs` | `monogram` | Real `MonogramGenerator`/`FrameLibrary` usage, same bootstrap as `test-mono-018-binding-letter.mjs`. |
| `test-perf-005-stone-size-lazy-sweep.mjs` | `editing` | Its actual subject is app.js's live-editing UI responsiveness (stone-size-picker re-sweep count), not geometry. |
| `test-perf-006-point-in-polygon-cache.mjs` | `geometry` | Imports `isPointInsidePolygons` directly from `src/geometry/StoneSampler.js` — pure spatial-geometry algorithm. |
| `test-read-010-warn-only-floor.mjs` | `ui` | Owns Production Sheet validation UI + the fix-to-floor button/hint; matches `test-read-008-ratio-floor.mjs`'s existing placement in `ui`. |

**2 double-registered files**, both in `products` and `ui`:
`test-font-decision-001-stone-size-ux.mjs` and `test-font-portfolio-001-stone-size-gating.mjs`.

Assessment: **plausibly intentional, but undocumented — inconsistent with the repo's own
convention.** Both files genuinely span two subsystems (they gate a **product/font-data constraint**
— shape-fit eligibility, per-font SS30 support — through a **UI surface** that displays it), which is
the same shape of dual-purpose membership `tools/test-groups.mjs` already grants
`test-gallery.mjs` (`core`+`gallery`) and `test-autosave-manager.mjs`/
`test-autosave-recovery-wiring.mjs` (`core`/`integration`+`autosave`). But unlike those examples,
`tools/test-groups.mjs` carries no comment explaining *why* these two are double-registered — every
other deliberate dual-membership in the file is accompanied by one ("Gallery is disabled... both
files here already run as part of core/integration, so this group is a complete, self-contained
Gallery check"). Recommend keeping the dual registration (the content genuinely justifies it) but
adding a one-line comment matching that convention, rather than treating the absence of a comment as
license to guess it was accidental.

---

## 6. Proposed end state

**Target file count: 148** (150 − 2 REMOVE). **Target assertion count: 1,858** (1,876 − 18). No file
is proposed for MERGE (§2's finding: all 10 candidate groups are KEEP-SEPARATE), so the "before
must equal after for KEEP+MERGE" rule is satisfied trivially — nothing merged, nothing to reconcile.

**Assertions proposed for DEMOTE-driven removal, named individually** (files that are **entirely**
wiring-guard, per §1, with no unique behavioral or architectural value once cross-referenced against
what's protected elsewhere):

| File | Assertions to drop | Disposition |
|---|---|---|
| `test-gallery-integration.mjs` | all 11 | Drop the file's wiring-guard checks; real Gallery correctness is fully covered by `test-gallery.mjs` (KEEP, unaffected). Recommend excluding the file from default rather than deleting it outright, since its barrel-only-import check (#6) does map onto a permanent architecture rule even though it's unexecuted. |
| `test-export-combined-preview-png.mjs` | all 8 | Recommend excluding from default; propose a follow-up (not this milestone) to rewrite as extract-and-execute against `composeCombinedPreviewCanvas()`, matching the convention `test-auto-fit-default-toggle-warning.mjs` already uses. |
| `test-move-drag-fast-path-wiring.mjs` | all 12 | Recommend excluding from default; the real translate math is already fully covered by `test-move-drag-translate.mjs` (KEEP, unaffected). |

These three are proposed for **exclusion from the default suite** (move to `EXCLUDED_FROM_DEFAULT`,
still runnable under `test:full`) rather than literal deletion — consistent with this task's own
DEMOTE wording ("propose dropping the guards **or** excluding the file from the default suite") and
with S-111's own precedent of moving low-value-but-harmless files to optional tiers rather than
deleting them outright. **No assertion count changes under this option** — the 1,858 figure above
reflects only the CupRenderer REMOVE, since excluding a file from the default suite doesn't remove
its assertions from the repository, only from the fast/default run.

**Left unchanged, flagged only** (meets the letter of the DEMOTE definition but kept per the
established, S-111-blessed repo convention of source-text testing for browser-entry-point modules
with no jsdom harness): `test-lightbox-controller.mjs`, `test-lightbox-movable-persistent.mjs`,
`test-ui-shell-structure.mjs`, `test-documentation-consistency.mjs`. Also flagged as
majority-wiring-guard but left unchanged pending a judgment call beyond this audit's scope:
`test-fill-algorithms-integration.mjs` (17/19 wiring, real behavior duplicated in
`test-fill-algorithms.mjs`), `test-shapes-design-consolidation.mjs` (13/16 wiring),
`test-svg-integration.mjs` (6/7 wiring), `test-browser-dependency-loading.mjs` (17/19 wiring, but
encodes a permanent architecture rule), `test-alignment-snapping-wiring.mjs` (17/23 wiring, but 6
real checks are load-bearing).

**Merge map:** empty — zero pairs merged (§2).

### Wall-time projection

Measured via `node --import file://tools/lib/paper-safe-self-preload.mjs tools/<file>` per file,
sequential (the same model `tools/run-tests.mjs` uses), all 150 files, all passing:

| Metric | Measured now | After proposed REMOVE |
|---|---:|---:|
| Sum of all 150 files (`--all` / `test:full`) | **119.96s** | 119.80s (−0.16s: the 2 removed files were both cheap) |
| Sum of default-suite 146 files (excl. `EXCLUDED_FROM_DEFAULT`) | 37.90s | 37.90s (unchanged — both REMOVE files were already excluded from default) |

**The pre-merge hook's near-120s-timeout risk is *not* resolved by this audit's findings, and no
finding in this pass offers a fix within its own scope.** The measured 119.96s for `--all` matches
the task's own stated "~111-125s" almost exactly. Two files account for 81.9s of that — **68% of the
entire `--all` wall time**:

```
65.503s  test-read-003-stem-width.mjs           (KEEP — live code, §3 category a)
16.393s  test-read-011c-tracking-solver-regression.mjs  (PIN-ONCE — offline tooling, §3 category b)
```

Both are already `EXCLUDED_FROM_DEFAULT` (correctly — they're too heavy for the fast loop) but both
are still counted in `--all`, which is what the pre-merge hook runs. Every other file in the suite
combined totals only ~38s. Since both files are classified KEEP/PIN-ONCE (not REMOVE — they guard
real, still-needed behavior per §3), consolidating or removing them is not something this audit can
responsibly propose. The structural options — running `--all` minus these two heaviest files as the
hook's gate, splitting the hook into two sequential steps, or accepting the current margin — are a
process decision for a future milestone, not a test-content change, and are flagged here rather than
decided.

### Summary of what changed vs. what didn't

- **150 → 148 files** (CupRenderer.js's 2 dedicated suites, once the module itself is confirmed dead
  and removed in a future implementation milestone).
- **1,876 → 1,858 assertions** (the same 18, both from the removed files).
- **Zero merges.** Every one of the 10 candidate pairs/groups the task named survived full reading as
  a legitimate, non-duplicate split.
- **6 ungrouped files** get a named home; **2 double-registered files** keep their dual membership
  with a recommendation to document why.
- **3 wholly-wiring-guard files** proposed for exclusion from the default suite (not deletion),
  named individually above.
- **The `--all` pre-merge-hook timeout risk is structural and unresolved** — flagged prominently
  rather than papered over, since the two dominant costs are both legitimate KEEP/PIN-ONCE
  protection, not removable cruft.
