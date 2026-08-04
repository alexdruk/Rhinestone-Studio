# MAINT-001 — Test Suite Consolidation

**Status:** IMPLEMENTED
**Branch:** `feature/maint-001-test-suite-consolidation` (cut from `develop`, clean at branch time)
**Scope:** Test suite only. No `src/**`/`app.js`/`index.html` file was modified.

---

## Objective

`docs/specifications/S-111-TestSuiteRationalization.md` (2026, status IMPLEMENTED) already did one
major pass of this exact work: it removed 39 `git status --porcelain` milestone guards from 37
files, merged the UI-001 cluster and the alignment/snapping wiring pair, and cut the suite from 74
to 56/59 files. Since then, new milestone-specific files accreted again (the RC-002…RC-006 series,
S-112/S-112A, `test-autosave-manager.mjs`, `test-documentation-consistency.mjs`,
`test-project-validation-security.mjs`) without being folded into `tools/test-groups.mjs`'s
manifest. This milestone re-audits the full suite with fresh eyes and reorganizes it around stable
subsystems instead of historical milestones, per the task's own suggested taxonomy.

---

## Audit method

Three parallel Explore passes (one per ~24-file batch) read every one of the 71 `tools/test-*.mjs`
files in full (not grepped) and classified each: subsystem category, presence of any residual
milestone guard, brittle-vs-real-behavioral content, overlap with sibling files, and a
Keep/Rename/Merge/Remove recommendation — the same rubric S-111 used.

**Headline finding: S-111's cleanup held.** Zero `git status`/`execSync`/`child_process` milestone
guards remain anywhere in the 71 audited files. The only residue was a handful of dangling
`// Forbidden files` section-header comments with no code underneath (left behind when S-111 removed
the guard body but not the header) and a couple of stale "no forbidden file changed" bullets in
prose file headers.

**Second finding: 12 of 71 files were invisible to `--group <name>`.** `test-autosave-manager.mjs`,
`test-cup-rotation-stabilization.mjs` (already `EXCLUDED_FROM_DEFAULT`), `test-documentation-
consistency.mjs`, `test-project-validation-security.mjs`, and all seven RC-series files ran under
default `npm test` (discovery-based, so they were never *unprotected*) but had no entry in
`tools/test-groups.mjs`'s `GROUPS`, so they were unreachable via `--group`.

**Third finding: genuine consolidation candidates existed, but most milestone-named "integration"
files were legitimately distinct, layered coverage, not duplication** — matching S-111's own
conclusion for the files it deliberately kept split (unit vs. integration pairs, e.g.
`test-shape-fit.mjs` vs. `test-shape-library-integration.mjs`). Three pairs were confirmed as the
same feature evolving across sequential milestones (see Consolidation below); everything else that
looked similar on the surface (e.g. the three RC overlap-detection files) turned out to protect
distinct code paths and was renamed, not merged, to avoid losing that separation.

---

## Consolidation (3 merges, 1 fold-in, 1 dedup)

| Merge | Into | Why |
|---|---|---|
| `test-rc-005-autosave-crash-recovery.mjs` + `test-rc-005a-recovery-notification.mjs` | `test-autosave-recovery-wiring.mjs` | Both files' own headers already described RC-005A as "a manual-verification follow-up to RC-005" over adjacent app.js code (recovery decision vs. its notification display). No assertion was dropped; both original sections are kept as clearly labeled parts of one file. |
| `test-s112-round-dinner-plate.mjs` + `test-s112a-plate-ux-corrections.mjs` | `test-product-plate-round-dinner.mjs` | S-112A is explicitly "three focused corrections on top of S-112" for the same product feature (Wrap Mode visibility, default camera angle, Rim Band curve default) — sequential, not independent. |
| `test-s104-text-position-recovery-drag-tuning.mjs` + `test-s107-long-text-readability.mjs` | `test-text-position-workflow.mjs` | Both drive the same app.js text-positioning surface (drag handling, the "outside printable area"/"too long" warning family, Text Lightbox + workspace Inspector controls), even though each introduced a distinct mechanism (drag sensitivity/Center-on-Object vs. the Front View Frame). Kept as two clearly labeled sections (A/B) rather than fully renumbered, since each section's internal check numbers are just log labels. |

| Fold-in | Where | Why |
|---|---|---|
| `test-gallery-benchmark.mjs` | New check 19 in `test-examples-regression.mjs`; file deleted | Its own header already said its correctness assertions ("stoneCount must match baseline") duplicated `test-examples-regression.mjs`; only the 5s-per-fixture timing ceiling was unique. That ceiling now runs as part of the Release Smoke Tests coverage in `test-examples-regression.mjs`, reusing its already-loaded fixtures/engine instead of a fourth independent fixture read (a follow-up S-111 itself flagged and deferred). |

| Dedup | Where | Why |
|---|---|---|
| "CupRenderer.js/CanvasRenderer2D.js never reference `project.layers`/a layer type" | Removed from `test-ux-visual-polish.mjs` check 6, kept in `test-render-export-pipeline.mjs` check 8 (which already covers the same two files plus `SvgExporter.js`) | Byte-identical regex assertions for the same two files in two different tests — S-111's own report flagged this exact duplication (6 files across the suite re-assert "StoneLayout-only" purity) as a known, deferred follow-up. `ux-visual-polish`'s check 6 keeps its two *unique* assertions (no `GeometryEngine` reference, no generation-function calls), which `render-export-pipeline` didn't have. |

No assertion's *behavior* was weakened or dropped by any merge/fold-in/dedup — every distinct check
still exists and still runs; only exact duplicates and the two originally-separate-suites-for-one-
feature pairs above were combined.

---

## Renames (milestone name → subsystem name, no content change)

| Old | New | Subsystem |
|---|---|---|
| `test-rc-002-ring-overlap.mjs` | `test-geometry-stone-overlap-cross-contour.mjs` | Geometry Engine |
| `test-rc-004-cross-layer-overlap.mjs` | `test-geometry-stone-overlap-cross-layer.mjs` | Geometry Engine |
| `test-rc-004a-same-contour-overlap.mjs` | `test-geometry-stone-overlap-same-contour.mjs` | Geometry Engine |
| `test-rc-003-project-import-lightbox.mjs` | `test-ui-import-autoswitch-regression.mjs` | UI Workflows |
| `test-rc-006-design-library-freeze.mjs` | `test-design-library-freeze-gate.mjs` | Design Library |
| `test-s105-persistent-movable-lightboxes.mjs` | `test-lightbox-movable-persistent.mjs` | UI Workflows |
| `test-s106-combined-visual-preview-png-export.mjs` | `test-export-combined-preview-png.mjs` | Import/Export |
| `test-s110-design-shapes-consolidation.mjs` | `test-shapes-design-consolidation.mjs` | Shapes & Fill |
| `test-s110a-smart-shape-to-text-creation.mjs` | `test-shapes-around-text-creation.mjs` | Shapes & Fill |
| `test-app-module-migration.mjs` | `test-architecture-module-boundaries.mjs` | Architecture |

The three RC overlap-detection files (`ring-overlap`/`cross-layer-overlap`/`same-contour-overlap`)
were confirmed, by reading all three in full, to protect three genuinely distinct code paths
(`sampleMultiContourOutlinePoints()`'s cross-contour guard, `dedupeStonesByRadius()`'s cross-layer
merge step, and same-contour self-overlap within one contour's own arc-length walk) — each file's
own comments explicitly document the gap the next one closes. Renamed, not merged, to preserve that
separation while dropping the milestone label.

Every internal cross-reference comment (e.g. "see tools/test-rc-003-…") was updated to the new
filename in the same commit as each rename, so no comment points at a nonexistent file.

`tools/lib/test-registration-assertions.mjs`'s 4 call sites (previously in `test-s107-…`,
`test-s110-…`, `test-s110a-…`, `test-s112a-…`) now live in their merged/renamed successor files with
updated `filename`/`group` arguments — each still asserts against the live `tools/test-groups.mjs` +
`tools/run-tests.mjs`, not a hardcoded duplicate of the manifest.

---

## `tools/test-groups.mjs` reorganization

Rewrote `GROUPS` around subsystems and registered every previously-orphaned file. Three new named
groups were added for categories the task's taxonomy calls out that had no home before:
`documentation` (`test-documentation-consistency.mjs`), `security`
(`test-project-validation-security.mjs`), `autosave` (`test-autosave-manager.mjs` +
`test-autosave-recovery-wiring.mjs`, mirroring the existing `gallery` group's pattern of
cross-referencing files that already run under `core`/`integration`). 12 files that were previously
absent from every named group (the RC-series, `test-autosave-manager.mjs`, `test-documentation-
consistency.mjs`, `test-project-validation-security.mjs`, `test-cup-rotation-stabilization.mjs`) are
now all registered somewhere. `EXCLUDED_FROM_DEFAULT` lost
its `test-gallery-benchmark.mjs` entry (file deleted) and keeps the two legacy `CupRenderer.js`
suites, unchanged from S-111's own reasoning.

A file appearing in more than one group (e.g. `test-gallery.mjs` in both `core` and `gallery`) only
affects `--group <name>` selection — the default suite is still computed by directory discovery
minus `EXCLUDED_FROM_DEFAULT`, independent of `GROUPS` membership, exactly as `tools/run-tests.mjs`
already implemented.

---

## Deliverables summary

| Metric | Before | After (default `npm test`) | After (`npm run test:full`) |
|---|---:|---:|---:|
| Test files (`tools/test-*.mjs`, excl. `test-groups.mjs`) | 71 | 65 selected | 67 |
| Assertions (`✓` lines, one per `test()` block) | 961 | 962 | 980 |
| Named groups in `tools/test-groups.mjs` | 4 | 7 | — |
| Files registered in `GROUPS` (reachable via `--group`) | 59 / 71 | 65 / 67 | — |

Assertion counts are within noise of each other (961→962 default, 981→980 full) — no coverage was
removed; the small full-suite delta is the net of folding `test-gallery-benchmark.mjs`'s 2 test
blocks into 1 new block in `test-examples-regression.mjs` and dropping literal duplicate regex lines
that don't each carry their own `test()` block.

- **Merged (6 files → 3 files):** RC-005+RC-005A, S-112+S-112A, S-104+S-107 (table above).
- **Folded in and deleted (1 file):** `test-gallery-benchmark.mjs` → `test-examples-regression.mjs`.
- **Renamed, no content change (10 files).**
- **Deduplicated (1 file, `test-ux-visual-polish.mjs`):** 3 duplicate assertion lines removed.
- **Dead comment cleanup (6 files):** vestigial empty `// Forbidden files` section headers deleted.
- **`tools/test-groups.mjs` rewritten:** subsystem-organized `GROUPS`, 3 new groups, all 9 previously
  orphaned files registered.
- **Unchanged (≈45 files):** already real, non-duplicated, subsystem-named, or a deliberately-kept
  unit/integration split.

### Confirmation: no application behavior changed

No file under `src/**`, `app.js`, or `index.html` was modified. Every merge/fold-in/rename/dedup was
verified file-by-file immediately after editing (`node tools/<file>.mjs`), then the full suite was
verified twice: `npm test` (65/65 pass) and `npm run test:full` (67/67 pass).

### Recommendation

Approve. Every check that existed before this milestone still exists and still passes; only exact
duplicates, two dangling comment-only fragments, and one confirmed-redundant benchmark file were
removed. The suite is smaller (71→67 files), better organized (subsystem names + groups instead of
milestone labels), and the registration gap this task set out to close (9 files invisible to
`--group`) is fully closed.
