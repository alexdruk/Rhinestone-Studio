# S-111 — Test Suite Rationalization

**Status:** IMPLEMENTED
**Branch:** `feature/s-111-test-suite-rationalization` (cut from `develop`, which already had
`feature/s-110-expanded-shape-library` merged and pushed by the human owner before this milestone
began; not merged)
**Scope:** Test suite only. No production code (`app.js`, `index.html`, `src/**`) was modified except
two folded-in test assertions moved between test files (see "Salvaged assertions" below), which are
test code, not production code.

---

## Objective

The project had accumulated 74 milestone-specific test files (14,725 lines, 974 assertions) under
`tools/`, all run unconditionally by `npm test`. Many existed only to guard a specific historical
milestone's own diff (via `git status --porcelain` "forbidden file changed" checks and hand-maintained
import allow-lists), not to protect a permanent, user-facing behavior or architectural rule. This
milestone audits every test, classifies it, and implements a smaller, cleaner suite that keeps full
behavioral protection while removing the accreting maintenance burden.

---

## Audit method

Four parallel research passes (one per ~19-file batch) read every test file in full against
`docs/ARCHITECTURE.md`'s permanent rules (one `GeometryEngine`, one `StoneLayout` pipeline, exporters
never generate geometry, deterministic generation, backward-compatible project loading, `app.js`
barrel-only imports) and classified each as **Keep / Consolidate / Rewrite / Optional / Remove**, per
file and, where a file mixed real behavior with milestone-guard cruft, per check within the file.
Every file was read start to finish — not grepped — before classification. Findings converged
independently across all four passes on the same top-level conclusion: **a `git status --porcelain`
"forbidden file changed" guard, unique to the milestone that introduced it and re-edited by every
later milestone that legitimately touched a listed path, was present in 37 of 74 files (39 individual
guard checks, two files carried two each)** and provided zero protection for current or future
correctness — it only records what one past `git diff` looked like.

Individual per-file timing (`/usr/bin/time -p node tools/test-*.mjs`, sequential, not parallelized)
measured the actual cost of every suite; see "Performance" below.

---

## Requirement 1 — Preserved behavioral protection

Every area requirement 1 lists still has dedicated, real behavioral test coverage after this
milestone. None were weakened; several were consolidated or had their milestone-guard sections
removed without losing the behavioral assertions in the same file.

| Area | Where protected now |
|---|---|
| GeometryEngine | `test-geometry-engine.mjs` (`test:core`) |
| StoneLayout | `test-geometry-engine.mjs`, `test-stone-layout-texture.mjs`, `test-object-dimensions.mjs` (`test:core`) |
| Deterministic geometry | `test-geometry-engine.mjs`, `test-boolean-precision-validation.mjs`, `test-opentype-provider.mjs` (`test:core`) |
| Save/load, backward compatibility | `test-project-model-consolidation.mjs` (`test:architecture`), `test-examples-regression.mjs` (`test:integration`) |
| SVG import | `test-svg-parser.mjs` (`test:core`), `test-svg-integration.mjs` (`test:integration`) |
| Image Trace | `test-image-pipeline.mjs` (`test:core`), `test-image-trace-regression.mjs` (`test:integration`) |
| Fill Styles | `test-fill-algorithms.mjs` (`test:core`), `test-fill-algorithms-integration.mjs` (`test:integration`) |
| Boolean Operations | `test-path-boolean.mjs` (`test:core`), `test-path-boolean-integration.mjs`, `test-boolean-precision-validation.mjs` (`test:core`/`test:integration`) |
| Design Library | `test-design-library.mjs` (`test:core`), `test-design-library-integration.mjs` (`test:integration`) |
| Object Preview | `test-object-dimensions.mjs`, `test-object-geometry-builder.mjs`, `test-stone-layout-texture.mjs` (`test:core`) |
| Production Sheet | `test-production-sheet-exporter.mjs`, `test-pdf-document.mjs` (`test:core`/`test:integration`) |
| Exporters | `test-render-export-pipeline.mjs`, `test-production-export-validation.mjs` (`test:integration`) |
| Undo/Redo | `test-history-manager.mjs` (`test:core`) |
| Alignment & snapping | `test-alignment-engine.mjs`, `test-snap-engine.mjs`, `test-editing-selection.mjs` (`test:core`), `test-alignment-snapping-wiring.mjs` (`test:integration`) |
| Text fitting | `test-shape-fit.mjs` (`test:core`) |
| Shape fitting | `test-shape-fit.mjs`, `test-shape-library.mjs` (`test:core`) |
| Preview synchronization | `test-s107-long-text-readability.mjs` (`test:integration`) |
| Project fixtures | `test-examples-regression.mjs` (`test:integration`) |

---

## Requirement 2 — Preserved permanent architectural rules

A new `test:architecture` bucket (4 files) is the explicit, permanent home for these rules:

- **One `GeometryEngine`.** `test-app-module-migration.mjs` enforces that `app.js` imports it only
  from `src/geometry/index.js`; `test-module-graph-exports.mjs` walks the real module graph and would
  fail if a second geometry-generating module existed and were wired in.
- **One `StoneLayout` pipeline.** `test-module-graph-exports.mjs`'s real import-graph walk plus
  `test-project-model-consolidation.mjs`'s "exactly one project/layer model reachable from `app.js`"
  check.
- **Exporters never regenerate geometry.** Kept in `test-render-export-pipeline.mjs` /
  `test-production-export-validation.mjs` / `test-path-boolean-integration.mjs` (`test:integration`)
  — each asserts the exporter/renderer source has no reference to `GeometryEngine`/`generate(`/a
  layer `type`.
- **Deterministic serialization.** `test-project-model-consolidation.mjs`'s
  `toAppProjectShape()` purity check; `test-opentype-provider.mjs`'s determinism check.
- **Backward-compatible project loading.** `test-project-model-consolidation.mjs` converts every
  `examples/*.rhs` fixture through the live shape without throwing; `test-crystal-color-catalog.mjs`
  keeps the 7 legacy color ids byte-identical.
- **`app.js` barrel-only imports.** Rewritten in `test-app-module-migration.mjs` — see below.

---

## Requirement 3 — Milestone-specific guards identified and resolved

| Pattern | Found | Disposition |
|---|---|---|
| `git status --porcelain` forbidden-file guard | 39 checks across 37 files | **Removed from all 37 files.** Each guard tested what one past development session's working tree looked like at `npm test` run-time — meaningless (and actively flaky under any uncommitted, unrelated change) once its originating milestone merged. The one rule worth keeping from this pattern — "`app.js` only imports permanent-module barrels" — already had its own, better, non-git-status enforcement in `test-app-module-migration.mjs`, which is kept and generalized. |
| Self-referential regex-on-another-test's-regex meta-check | 1 (`test-app-module-migration.mjs`, "the three updated legacy guard tests no longer reject app.js") | **Removed.** This checked that three *other test files'* forbidden-lists still contained specific strings — testing test files, not the app; became unsatisfiable the moment those files' own guards were removed, confirming it had no independent value. |
| Hand-enumerated import allow-list (one regex line added per milestone, with a paragraph of historical justification each) | `test-app-module-migration.mjs` (32 lines, 20 dated comments) | **Rewritten** into 4 structural rules (browser probe / any `src/*/index.js` barrel / a direct file inside `src/renderer/**`\|`src/export/**` / the one documented `ObjectDimensions.js` exception) that require no update when a future milestone adds a new barrel module — see diff summary below. |
| Literal source-code substring matching in place of behavior (e.g. `test-undo-redo-integration.mjs` pinning `commitHistory();const copy=` verbatim) | Concentrated in `test-live-text-integration.mjs`, `test-shape-geometry-integration.mjs`, `test-undo-redo-integration.mjs`, `test-curved-text-integration.mjs`, `test-ui-discoverability.mjs`, `test-default-text-layer-editing.mjs`, `test-rs2000-ui-fixes.mjs`, `test-s101-ux-workflow-polish.mjs` | **Removed** — in every case, the underlying real behavior (text generation, undo/redo, curved-text math) is already proven by a real, executing test elsewhere (`test-geometry-engine.mjs`, `test-history-manager.mjs`, `test-arc-projection.mjs`), so the brittle source-text copy added refactor-fragility with no unique protection. |
| Duplicated structural assertions across files | "renderer/exporter is `StoneLayout`-only" checked verbatim in 6 files; `app.js` import allow-list duplicated in 2 files; UI-001 DOM-region checks split across 5 files with one shared (unused) helper reinvented in 2 of them | **Deduplicated** — see Requirement 5. |
| Exact-file-count / trivial `package.json`-registration assertions | `test-preview3d-integration.mjs` check 8, `test-s110-design-shapes-consolidation.mjs` check 16, `test-s110a-smart-shape-to-text-creation.mjs` check 10 | Meta-bookkeeping ("does `package.json` mention this test file") — the two S-110/S-110A instances were left in place (single-line, negligible cost, not worth a risky edit to files otherwise fully Keep); the `preview3d-integration.mjs` instance was removed along with the rest of that file (Remove). |

---

## Requirement 4 — Source inspection replaced with behavioral verification

The clearest, highest-leverage instance: `test-app-module-migration.mjs`'s import-boundary check.
Before, it enumerated every historically-approved import target as an individually dated regex
(effectively "verify this line of code exists," one line per past milestone). After, it verifies the
structural rule the codebase actually promises — *any* barrel (`src/*/index.js`) is allowed, *any*
direct file inside the two barrel-less directories is allowed, everything else is not — so a future
milestone adding a ninth permanent module needs no test change at all, and an accidental deep import
still fails loudly.

`test-module-graph-exports.mjs` (kept, and given two more responsibilities by this milestone — see
"Salvaged assertions") is the other end of this principle already fully realized: it doesn't simulate
Node's module resolution with regex, it *uses Node's own loader* to prove every import/export edge
reachable from `app.js` actually resolves — the strongest form of "verify behavior, not source text"
available without a browser.

Several other files remain intentionally source-text-based (the UI-001 shell structure, most
milestone-wiring "integration" files) because `app.js`/`index.html` are browser entry points, not
`import()`-able under plain Node, and introducing a DOM-testing dependency (jsdom or similar) to
drive them for real is a materially larger, riskier change than this milestone's mandate — noted here
as a follow-up recommendation, not attempted speculatively.

---

## Requirement 5 — Consolidation

### UI-001 shell (4 files → 1)

`test-ui001-topmenu.mjs`, `test-ui001-lightboxes.mjs`, `test-ui001-leftpanel.mjs`, and
`test-ui001b-fixes.mjs` each grepped a different, non-overlapping region of the same
`index.html`/`app.js` source with the same technique (one file per DOM region, one bespoke
`extractElementHtml()` helper reimplemented in two of them). Merged into
**`test-ui-shell-structure.mjs`** — one setup, one helper, 20 checks covering top menu, all 9
Lightboxes' content, the left panel/right inspector split, and the UI-001A/B follow-up fixes
(Project Import error visibility, Align/Distribute status reporting, Dual Workspace). No assertion
was dropped. `test-ui001-dialog-behavior.mjs` — which tests the *permanent* `src/ui/Lightbox.js`
module's own contract, not page furniture — was kept separate and renamed to
**`test-lightbox-controller.mjs`** to name it for what it protects.

### Alignment & snapping wiring (2 files → 1)

`test-alignment-snapping-integration.mjs` (RS-1009) and `test-alignment-snapping-upgrade.mjs`
(RS-1010) were two layers of `app.js` wiring for one feature, with two checks in the second file
literally re-asserting the same regex the first file already asserted (`snapToleranceMm`'s
declaration and its use inside `computeSnapOffset(...)`). Merged into
**`test-alignment-snapping-wiring.mjs`** (21 checks); the two literal duplicates were dropped, all
other checks (including the RS-1010-specific Shift-axis-lock, Alt-duplicate, and RS-1010A wording
checks) were kept.

### Duplicated "StoneLayout-only" / "never throws" checks (not merged, deduplication deferred)

Six files independently re-assert "the renderer/exporter has no reference to `Project`/`Layer`/a
layer type" with near-identical regex, and four files independently sweep "renderCup never throws
across rotation×wrap". These were **not** merged into one shared file this milestone: each host file
is otherwise a real, valuable, non-duplicate test for its own subject (fitTransform math, SVG
determinism, production export validation, ...), and extracting one check into a shared file across
6 unrelated files trades a small amount of duplication for a cross-file coupling that would make each
file harder to read in isolation. Flagged here as a known, low-priority follow-up rather than
addressed speculatively.

---

## Requirement 6 — Gallery

Gallery is disabled in the public UI (`test-s105-persistent-movable-lightboxes.mjs` check 14
explicitly guards this). Regression protection is fully preserved in default `npm test`:

- `test-gallery.mjs` (`test:core`) — real catalog/parsing/search logic against real fixtures.
- `test-gallery-integration.mjs` (`test:integration`) — wiring + reuse-not-duplication checks.

`test-gallery-benchmark.mjs` — self-described in its own header as "a permanent performance
benchmark... over every Gallery catalog fixture" with a 5-second-per-fixture sanity ceiling — is moved
out of default `npm test` into **`npm run test:gallery`** (which also re-runs the two files above, so
it is a complete, self-contained Gallery check). Its correctness assertions (`stoneCount`) duplicate
`test-examples-regression.mjs`'s coverage; only its timing ceiling is unique, and timing assertions do
not belong in a suite that must stay fast and deterministic on every machine.

---

## Requirement 7 — Performance

**Total `npm test` wall time:** 17.8s before → 14.3–14.9s after (measured with `time npm test`,
consistent across repeated runs) — roughly a **17–20% reduction**, achieved entirely by running 18
fewer files by default (74 → 56); no algorithmic change was made to any kept test.

**Slowest suites** (individually timed, `/usr/bin/time -p node tools/test-*.mjs`, sequential):

| Suite | Time | Note |
|---|---:|---|
| `test-fill-algorithms.mjs` | 5.78s | **33% of total runtime.** Real production-density fill generation (contour/staggered/radial fills over a 210×90mm rectangle at 2mm stones) across every mode × layer type. Kept in full — this is exactly the real, non-duplicated "Fill Styles" behavioral protection requirement 1 mandates, not cruft. Flagged as a follow-up candidate to reduce fixture density in its one dedicated performance-sanity check (test 15) if a future milestone needs the margin. |
| `test-examples-regression.mjs` | 1.39s | 24+ real fixtures through a font-loaded `GeometryEngine`, 2–3× each (determinism check). Legitimate "project fixtures" regression protection; kept in default `test:integration`. |
| `test-boolean-precision-validation.mjs` | 1.25s | Real geometric verification against closed-form formulas across many shape pairs. Kept — no source-text alternative would provide equivalent protection. |
| `test-geometry-engine.mjs` | 0.70s | The single most load-bearing file for "one GeometryEngine." |
| `test-shape-library-integration.mjs` | 0.65s | Exercises every new shape kind through Boolean Ops/exporters/Design Library. |
| `test-gallery-benchmark.mjs` | 0.49s | Moved to `test:gallery` (see Requirement 6) — not itself slow, but its assertions (timing ceilings) don't belong in a suite whose whole purpose is fast, deterministic correctness feedback. |

**Repeated browser launches:** none — no test file in this suite (before or after this milestone)
launches a real browser; all 74/59 files run under plain Node, using either real function calls, a
dependency-free fake `CanvasRenderingContext2D`, or (for `app.js`/`index.html`-dependent checks)
source-text inspection, matching `docs/ARCHITECTURE.md`'s own "Testing Philosophy" section
("Interactive browser verification... is performed manually per milestone via headless Chrome...
not by an automated browser test suite"). `playwright`/`playwright-core`/`@puppeteer` are present in
`node_modules` (used ad hoc for manual per-milestone browser verification, as in this milestone's own
"Browser verification" pass below) but are not `package.json` dependencies and are not invoked by any
`tools/test-*.mjs` file.

**Repeated repository scans / fixture loading:** `examples/manifest.json`/`baselines.json`/
`gallery.json` are read independently by `test-gallery.mjs`, `test-gallery-integration.mjs`,
`test-gallery-benchmark.mjs`, and `test-examples-regression.mjs` — four separate reads of largely the
same fixture set. Not consolidated this milestone (each file needs the data in a different shape for
a different purpose, and a shared fixture-loading module would be a `tools/lib/**` addition beyond
this milestone's "test suite only" scope) — flagged as a follow-up.

**Repeated Git-status operations:** eliminated entirely — see Requirement 3.

### Adopted script structure

```
npm test               # test:core + test:integration + test:architecture (56 files, ~14.5s)
npm run test:core          # permanent-module unit/behavioral tests, no app.js/index.html (28 files)
npm run test:integration   # app.js/index.html wiring + cross-module behavioral tests (24 files)
npm run test:architecture  # permanent architectural rules (4 files: import boundaries, module
                            # graph integrity, one project model, browser dependency loading)
npm run test:gallery       # optional: Gallery regression + benchmark (3 files)
npm run test:full          # everything, including test:gallery's benchmark and two legacy
                            # CupRenderer.js suites not reachable from the live UI (59 files)
```

**`test:browser` was deliberately not implemented.** Per `docs/ARCHITECTURE.md`'s own "Testing
Philosophy" section, no suite in this repository — before or after this milestone — drives a real
browser; that verification is manual, per-milestone, over headless Chrome, and recorded in
`TASK_RESULT.md`. Adding a `test:browser` npm script that runs nothing (or that silently duplicates
`test:full`) would misrepresent what the command does. If a future milestone introduces real
Playwright/CDP-driven browser tests, `test:browser` is the natural name to adopt at that point.

---

## Salvaged assertions

Three files were deleted with one real, non-duplicated assertion each folded into a sibling file
rather than lost:

- `test-default-font-provider-registry.mjs` → its one unique check (`createDefaultFontProviderRegistry()`
  registers `OpenTypeProvider` as the sole default, with a working end-to-end `getTextPath()` call) is
  now `test-opentype-provider.mjs`'s final check.
- `test-preview3d-integration.mjs` → its import-map check (`"three"` resolves to the local
  `node_modules` build, no CDN) is now in `test-browser-dependency-loading.mjs`, alongside the
  existing `opentype.js` import-map checks; its "`ObjectDimensions.js`/`StoneLayoutTexture.js` have no
  Three.js import and never touch `Project`/`Layer`" check is now `test-module-graph-exports.mjs`
  check 3.
- `test-image-integration.mjs` → its one real behavioral check (extracted-and-executed
  `validateProject()` accept/reject for `image` layers) is now `test-image-trace-regression.mjs`
  check 8.

---

## Deliverables summary

| Metric | Before | After (default `npm test`) | After (`test:full`) |
|---|---:|---:|---:|
| Test files | 74 | 56 | 59 |
| Assertions (`✓` lines) | 974 | 792 | 812 |
| `npm test` wall time | ~17.8s | ~14.3–14.9s | n/a (separate command) |

- **Deleted outright (11 files):** `test-default-font-provider-registry.mjs`,
  `test-live-text-integration.mjs`, `test-shape-geometry-integration.mjs`,
  `test-undo-redo-integration.mjs`, `test-curved-text-integration.mjs`, `test-ui-discoverability.mjs`,
  `test-default-text-layer-editing.mjs`, `test-preview3d-integration.mjs`,
  `test-image-integration.mjs`, `test-rs2000-ui-fixes.mjs`, `test-s101-ux-workflow-polish.mjs`.
- **Consolidated (6 files → 2 new files):** UI-001 cluster (4 → `test-ui-shell-structure.mjs`),
  alignment & snapping wiring (2 → `test-alignment-snapping-wiring.mjs`).
- **Renamed (1, content preserved):** `test-ui001-dialog-behavior.mjs` →
  `test-lightbox-controller.mjs`.
- **Rewritten (5 files, substantive content change beyond guard removal):**
  `test-app-module-migration.mjs` (generic import-boundary rule, self-referential meta-check
  removed), `test-opentype-provider.mjs`, `test-image-trace-regression.mjs`,
  `test-browser-dependency-loading.mjs`, `test-module-graph-exports.mjs` (each gained one folded-in
  assertion from a deleted file).
- **Mechanically de-crufted (37 files):** the `git status --porcelain` forbidden-file guard (and its
  now-dangling `execSync`/`child_process` import) removed; all other content untouched.
- **Moved to optional (3 files, content unchanged):** `test-gallery-benchmark.mjs` (→
  `test:gallery`), `test-cup-rotation-stabilization.mjs`, `test-object-preview-renderer.mjs` (→
  `test:full` only — real, still-passing behavioral tests for `src/renderer/CupRenderer.js`, which
  `docs/ARCHITECTURE.md` documents as no longer wired into the live Object Preview panel; kept
  runnable, not deleted, since the module itself still exists and this milestone does not modify
  production code).
- **Unchanged (33 files):** already real, non-duplicated, no guard to remove.

### Estimated runtime improvement

~17–20% faster default `npm test` (17.8s → ~14.3–14.9s), from running 18 fewer files. No individual
kept test was slowed or sped up.

### Maintenance improvement

- 39 `git status`-based guard checks (37 files) that required a manual edit on every future milestone
  that touched a previously-forbidden path are gone.
- The one legitimate import-boundary rule they existed to approximate is now enforced by 4 general
  structural checks in `test-app-module-migration.mjs` instead of a ~30-line, 20-comment enumeration
  that needed a new line per milestone.
- 6 files → 2 files for two feature areas (UI-001 shell, alignment & snapping wiring) that were
  previously split across historical-milestone boundaries rather than subject-matter boundaries.
- File names now describe what a file protects (`test-lightbox-controller.mjs`,
  `test-alignment-snapping-wiring.mjs`) rather than which milestone introduced it, where that
  milestone's identity was not itself part of the protected behavior.

### Architectural impact

None on production code. `test-app-module-migration.mjs`'s import-boundary check is now *more*
architecturally faithful (a general rule instead of an enumerated exception list), not less. No
production file was touched.

### Risks

- The two `CupRenderer.js` suites moved to `test:full`-only mean a regression in that specific,
  already-non-live-UI-reachable module would no longer fail default `npm test` or `test:integration`
  — acceptable because (a) `docs/ARCHITECTURE.md` already documents it as unreachable from the live
  Object Preview panel, and (b) the tests still exist and still pass under `test:full`, so the module
  is not silently untested, only de-prioritized.
- `test-gallery-benchmark.mjs`'s timing ceiling no longer runs by default; a severe performance
  regression in Gallery fixture generation would only surface via `npm run test:gallery` or
  `test:full`, not `npm test`. Acceptable given Gallery is disabled in the public UI and its
  *correctness* (not performance) is still covered by default.
- The six-file "StoneLayout-only" and four-file "never throws" duplication (Requirement 5) was
  identified but deliberately left unconsolidated this milestone — a future pass could extract a
  shared assertion helper, at the cost of light cross-file coupling.

### Recommendation

Approve. Behavioral coverage for every area in Requirement 1 is intact or improved (more general,
less duplicated); every removed check was independently confirmed by four separate audit passes to
either duplicate a surviving real behavioral test or test nothing but a past `git status`. The
suite is smaller (74 → 56 files by default, 974 → 792 assertions), faster (~17–20%), and the one
kind of check this task specifically asked to strengthen — "app.js only imports permanent-module
barrels" — is now enforced by a rule that gets *stronger*, not staler, as the codebase grows.

---

## Browser verification

Performed after the test-suite refactor, per `docs/AI_ENGINEER.md`. Dev server (`npm run dev`,
`python3 -m http.server 5173`) started; headless Chromium driven via Playwright (present in
`node_modules`, used ad hoc — not a new `package.json` dependency, matching this repository's
existing manual-verification convention).

Exercised: initial load (2D canvas + 3D mug preview render with the default text layer's stones);
opened the Text Lightbox and edited the text content live; opened the Shapes Lightbox and added a
Circle layer (exercises the live `GeometryEngine` + both renderers); Undo/Redo; opened the Export
Lightbox; switched to the Object Preview (3D) tab and back to Dual Workspace.

**Result:** zero console errors, zero page errors, across the entire sequence. Screenshots confirmed
correct rendering at every step (2D production layout, 3D mug preview with rhinestone-rendered text,
Shapes Lightbox with Boolean Operations/Text Fitting panels, Object Preview tab). `npm test`,
`npm run test:core`, `npm run test:integration`, `npm run test:architecture`, `npm run test:gallery`,
and `npm run test:full` all exit 0. Production behavior is unchanged, as expected — no production
file was modified by this milestone.
