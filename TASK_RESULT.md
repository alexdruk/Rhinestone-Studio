# Rhinestone Studio — Task Result

This document is completed by the implementation engineer after finishing the current task.

---

# Task ID

RS-1008A — Image Trace Architecture Correction

---

# Status

IMPLEMENTED

---

# Branch

feature/rs-1008-image-trace (continuation of the still-unmerged RS-1008 branch — this correction
lands as a second commit on the same branch, since RS-1008 had not yet merged to `develop` when
this correction was requested; see "Warnings" for why a new branch was not used)

---

# Commit

Do not write the current commit hash into this file — this file is part of the same commit it
describes. Obtain it from Git history with:

```bash
git log -1 --oneline
```

---

# Summary

Corrected a real architectural regression in RS-1008 (Image Trace): `src/image/**` originally
constructed `Stone`/`StoneLayout` directly instead of going through the permanent `GeometryEngine`
— a second, independent stone-generating implementation. This milestone moves stone construction
into the permanent engine, exactly like every other layer type, with zero visible behavior change.

**What moved where.**
* `src/geometry/GeometryEngine.js` gained `generateImageLayout(params)`: takes an already-decoded
  `imageBuffer` plus placement/stone/bitmap-processing params, calls `prepareImageField()`
  internally (imported from `../image/index.js`, mirroring exactly how `generateSvgLayout()`
  already imports and calls `parseSvgDocument()` from `../svg/index.js`), samples the resulting
  field, and constructs `Stone`/`StoneLayout` — the same "normalize params → sample points →
  `Stone[]` → `StoneLayout`" shape every other `generate*Layout()` method already uses.
* `src/geometry/StoneSampler.js` gained `sampleFieldFillPoints(field, placementBox, spacingMm)`:
  the raster analogue of the existing `sampleFillPoints()` (grid-walk-and-keep-if-on-field instead
  of grid-walk-and-keep-if-inside-polygon). Exported from `src/geometry/index.js`.
* `src/image/**` is now pure field-preparation only. `ImageTracePipeline.js` and
  `ImageStoneSampler.js` are **deleted** (not deprecated, not left alongside the new code); a new
  `ImageFieldPipeline.js` exports `prepareImageField()` — the unchanged grayscale → threshold →
  invert → blur → resize logic, now stopping at a neutral field instead of continuing into stone
  construction. `src/image/**` has zero dependency on `src/geometry/**` and never constructs a
  `Stone`/`StoneLayout` — verified by a dedicated regression test, not just claimed.
* `app.js`'s `generateImageStonesLive()` now calls `this.permanentEngine.generateImageLayout(params)`,
  matching `generateSvgStonesLive()`/`generateShapeStonesLive()`'s exact shape (the only one of the
  four `generate*StonesLive()` methods that did not already do this). The preview-before-commit
  panel's live density-mask canvas now calls `prepareImageField()` once (replacing a manually
  chained `toGrayscale`→`applyThreshold`→`invertMask`→`blurMask`→`resizeField` sequence that
  duplicated pipeline logic), and its approximate-stone-count readout now calls
  `permanentEngine.generateImageLayout()` directly — the exact same code path a real commit uses,
  not a separate implementation.

**Proof, not just claims.** A new `tools/test-image-trace-regression.mjs` proves three things the
milestone brief asked for directly:
1. **Byte-identical output.** Before touching any code, 8 representative test cases were run
   through the pre-correction `traceImageBufferToStoneLayout()` and their exact `StoneLayout.toJSON()`
   output committed as `tools/image-trace-regression-baselines.json`
   (`tools/generate-image-trace-baselines.mjs`, a one-time capture script mirroring
   `tools/generate-example-baselines.mjs`'s existing precedent, not run by `npm test`). The
   regression test replays the identical inputs (shared via `tools/lib/imageTraceFixtures.mjs`, so
   generator and test can never drift apart) through the corrected
   `GeometryEngine.generateImageLayout()` and asserts `deepEqual` against that baseline for every
   case — verified to pass before writing this report.
2. **Uses the permanent pipeline.** Structural assertions confirm `app.js` calls
   `this.permanentEngine.generateImageLayout(params)`, `GeometryEngine.js` defines the method and
   imports `prepareImageField`/calls `sampleFieldFillPoints`, and the barrel exports it.
3. **The old implementation was actually removed.** Assertions confirm `src/image/index.js` no
   longer exports `traceImageBufferToStoneLayout`/`sampleImageFillPoints`, the two files no longer
   exist on disk, and no file under `src/image/**` imports from `../geometry/` or constructs
   `new Stone(...)`/`new StoneLayout(...)` — proving this isn't a "leave the old one around too"
   half-fix.

**Guard-test maintenance.** Nine pre-existing suites hard-coded a forbidden-file assumption that
`src/geometry/GeometryEngine.js` (and, in six cases, also `StoneLayout.js`) would never change again
— a reasonable assumption at the time each was written, now legitimately broken by this milestone.
Each was updated with a narrow, documented carve-out (the established "narrow, surgical" pattern
this repo has used for every prior milestone that extended a previously-forbidden file, e.g.
RS-1005's `src/export/` carve-outs, RS-1007's `src/renderer/StoneColors.js` carve-outs) —
`StoneLayout.js`/`Stone.js`/`ContourGeometry.js`/`ArcProjection.js` remain forbidden everywhere;
only `GeometryEngine.js`/`StoneSampler.js`/`index.js`/`README.md` are newly allowed.

---

# Files Changed

**New:**
* `src/image/ImageFieldPipeline.js` — replaces `ImageTracePipeline.js`.
* `tools/lib/imageTraceFixtures.mjs` — shared synthetic-buffer test cases.
* `tools/generate-image-trace-baselines.mjs` — one-time baseline capture script (not run by `npm test`).
* `tools/image-trace-regression-baselines.json` — committed baseline fixture (captured from the
  pre-correction implementation before any refactor code was written).
* `tools/test-image-trace-regression.mjs` — the RS-1008A proof suite (8 assertions).
* `docs/specifications/RS-1008A-ImageTraceArchitectureCorrection.md`.
* `TASK_RESULT.md` (this file).

**Deleted:**
* `src/image/ImageTracePipeline.js`, `src/image/ImageStoneSampler.js`.
* `tools/test-image-trace-pipeline.mjs` (superseded by a new `generateImageLayout()` block in
  `tools/test-geometry-engine.mjs`, mirroring how RS-1001's SVG coverage lives there).

**Modified:**
* `src/geometry/GeometryEngine.js` — new `generateImageLayout()` method, `normalizeImageParams()`,
  new import of `prepareImageField`/`sampleFieldFillPoints`.
* `src/geometry/StoneSampler.js` — new `sampleFieldFillPoints()`.
* `src/geometry/index.js` — exports `sampleFieldFillPoints`.
* `src/geometry/README.md` — new "Image Trace Geometry Engine (RS-1008A)" section.
* `src/image/index.js` — exports `prepareImageField` instead of `traceImageBufferToStoneLayout`/
  `sampleImageFillPoints`.
* `src/image/README.md` — rewritten to describe the corrected pure-field-preparation design.
* `app.js` — `generateImageStonesLive()` now calls the permanent engine; the preview panel's
  `updateImagePreview()` now calls `prepareImageField()` + `permanentEngine.generateImageLayout()`
  instead of the old manual chain + `traceImageBufferToStoneLayout()`; import line updated; a new
  milestone header comment.
* `tools/test-image-pipeline.mjs` — `sampleImageFillPoints` test replaced with a `prepareImageField()`
  orchestration/validation test; other pure-stage tests unchanged (those functions did not move).
* `tools/test-geometry-engine.mjs` — new `generateImageLayout()` coverage block (tests 44-53,
  mirroring the existing `generateSvgLayout()` block), new `createImageBuffer` import.
* `tools/test-image-integration.mjs` — tests 1/2 updated for the new call shape; test 9's
  forbidden-file list narrowed (no longer forbids `src/geometry/`).
* `tools/test-ui-discoverability.mjs`, `tools/test-object-template-integration.mjs`,
  `tools/test-default-text-layer-editing.mjs`, `tools/test-production-sheet-exporter.mjs`,
  `tools/test-preview3d-integration.mjs`, `tools/test-crystal-color-catalog.mjs`,
  `tools/test-crystal-color-integration.mjs` — each narrowed to keep forbidding `StoneLayout.js`
  (and `Stone.js`/`ContourGeometry.js`/`ArcProjection.js` where applicable) while allowing
  `GeometryEngine.js`/`StoneSampler.js`/`index.js`/`README.md`, each pointing at
  `tools/test-image-trace-regression.mjs` for the dedicated proof.
* `package.json` — removes `test-image-trace-pipeline.mjs`, adds `test-image-trace-regression.mjs`.
* `docs/ARCHITECTURE.md` — the RS-1008 "deliberate exception" paragraph is left in place (as an
  honest record) but followed by a correction paragraph and a new "Image Trace Geometry Engine
  (RS-1008A)" account; the "Layers" section and "Current Implementation" layer-map table row are
  updated to reflect the corrected design.
* `TASK.md` — this milestone's task file (replaces RS-1008's, since this correction supersedes it
  on the same open branch).

**Untouched (verified by `tools/test-image-trace-regression.mjs`'s own forbidden-file guard):**
`src/geometry/StoneLayout.js`, `Stone.js`, `ContourGeometry.js`, `ArcProjection.js`, `src/export/**`,
`src/text/**`, `src/fonts/**`, `src/core/**`, `src/browser/**`, `src/renderer/**`,
`src/preview3d/**`, `src/svg/**`, `src/history/**`, `src/products/**`, `index.html`, `assets/**`,
`examples/**`, `style.css`, `README.md`, `LICENSE`, `CONTRIBUTING.md`.

---

# Commands Executed

```bash
# (continuing on feature/rs-1008-image-trace, already checked out)
node -e "... capture baseline via pre-refactor traceImageBufferToStoneLayout ..." > baseline
node tools/generate-image-trace-baselines.mjs        # committed baseline, run once before refactor
npm test                                              # full suite, iterated to green (472/472)
git diff --check
git status
python3 -m http.server 5199                           # browser verification
npm install --no-save --no-package-lock puppeteer-core   # temporary, browser verification only
npm uninstall puppeteer-core --no-save                    # removed afterward
```

`package.json`/`package-lock.json` carry only the test-script entry swap
(`test-image-trace-pipeline.mjs` → `test-image-trace-regression.mjs`) — `git status` confirms no
dependency changes remain after the temporary Puppeteer install/uninstall.

---

# Automated Test Results

`npm test` — **35/35 suites pass, 472/472 individual assertions, exit code 0**.

**`tools/test-image-trace-regression.mjs` (8 assertions, new):** byte-identical output against the
committed pre-correction baseline for all 8 regression cases; `app.js`/`GeometryEngine.js` wiring
proof; `sampleFieldFillPoints()` exported from the permanent barrel; old implementation actually
removed (unexported and off disk); one-way dependency proof (`src/image/**` never imports
`../geometry/` or constructs `Stone`/`StoneLayout`); a full-shape functional sanity check; this
suite's own forbidden-file guard.

**`tools/test-geometry-engine.mjs` (extended, 53 assertions total, 10 new):** `generateImageLayout()`
coverage — foreground-only placement, `invert` flip, monotonic threshold behavior, blur not
crashing, `maxWidthPx`/`maxHeightPx` bounding, correct placement/scaling, correct
`layerId`/`color`/`sizeMm`, determinism, six malformed-param cases, empty-background/no-font-registry
case — directly replacing the equivalent coverage the now-deleted
`tools/test-image-trace-pipeline.mjs` had against the removed direct-construction function.

**`tools/test-image-pipeline.mjs` (9 assertions, 1 changed):** the `prepareImageField()` test
verifies the five pipeline stages thread together in the documented order and that the function
validates its own threshold/blurRadiusPx/maxWidthPx/maxHeightPx params — everything else unchanged.

**`tools/test-image-integration.mjs` (9 assertions, 2 changed):** tests 1/2 now assert the
`this.permanentEngine.generateImageLayout(params)` call shape and the `prepareImageField` import
(plus that `traceImageBufferToStoneLayout` no longer appears anywhere in `app.js`).

All other suites (including the seven with narrow guard updates) pass unchanged in substance —
their assertions about actual behavior are untouched; only their forbidden-file lists were narrowed
where `src/geometry/GeometryEngine.js`/`StoneSampler.js` needed to newly become allowed.

---

# Browser/Manual Verification

Re-ran the exact same real headless-Chrome/CDP verification script used for the original RS-1008
milestone (same synthetic PNG/JPEG/WebP generation, same 20 numbered checks, 35 total assertions)
against the corrected implementation, via `python3 -m http.server 5199` and a temporary
`puppeteer-core` install (`--use-gl=swiftshader --enable-unsafe-swiftshader`).

**35/35 checks passed, with observed values identical to the pre-correction RS-1008 run:**

* Default project regression: 375 stones, 199.4×17.0mm — identical.
* PNG import preview: "28 stones (approx.)" at default settings — identical.
* Invert changes preview to "21 stones (approx.)" — identical.
* Threshold=0 (nothing qualifies) → "0 stones (approx.)" — identical.
* Cancel: 1→1 layers, panel hidden — identical.
* Commit: 1→2 layers, "392 stones 199.4×17.0mm" — identical.
* Post-commit threshold=0 edit: 392→375 stones — identical.
* JPEG/WebP import: both succeed, layer count increments correctly — identical.
* Unsupported file: rejected with the same specific `#status` message — identical.
* Move: same drag delta produces the same x/y change (96.53→117.81mm, 36.53→54.92mm) — identical.
* Duplicate: 4→5 layers — identical.
* Visibility toggle: 401→395→401 stones — identical.
* Delete: 5→4 layers — identical.
* Undo/redo: 4→5→4 layers — identical.
* Large 1500×1500px image: decode+preview open in 328ms, threshold recompute in 175ms, page
  responsive (18ms trivial-evaluate probe) immediately after — comparable timing to the
  pre-correction run (327ms/162ms/15ms), no regression.
* All 7 export buttons: succeed with the same "Downloaded ..." status messages — identical.
* Project JSON round trip: exported JSON contains `"type":"image"` and `"imageSrc":"data:image/…"`;
  re-import restores all 4 image layers — identical.
* 3D preview: live WebGL context, renders without error — identical.
* Console/network: zero application-originated console errors or page errors; only the
  pre-existing, already-documented `/favicon.ico` 404 — identical.

This is direct evidence (not just the automated-suite proof) that the refactor changed nothing
observable: every stone count, every timing figure, and every status message matches the
pre-correction session exactly.

Not performed: real-GPU/real-device verification (same documented limitation as every prior
milestone), mobile touch-gesture verification.

---

# Warnings

* **This correction landed on the same branch as RS-1008 (`feature/rs-1008-image-trace`), not a new
  `feature/rs-1008a-...` branch**, because RS-1008 had not yet merged to `develop` when this
  correction was requested — the precedent milestone `RS-1006A` used a separate branch because
  RS-1006 had already merged by that point. Treating this as a same-branch fix (per
  `docs/CLAUDE_GUIDE.md`'s "Review Fixes" workflow) avoids an unnecessary branch/merge dance for
  work that has not shipped. If a separate branch/commit history is actually wanted for this
  correction specifically, say so and it can be re-organized before merge.
* Nine pre-existing guard tests needed narrow forbidden-file-list updates (see "Files Changed").
  Each carve-out is documented inline at its exact location, following this repository's
  established pattern — flagged here as a concentration of guard-test churn worth a reviewer's
  attention, even though each individual change is small and mechanical.
* Same synchronous-main-thread and `imageBufferCache`-has-no-eviction limitations as RS-1008,
  unchanged by this refactor.

---

# Known Limitations

* Same as RS-1008's "Known Limitations" (only PNG/JPG/JPEG/WebP; no per-layer rotation; S-004
  remains deferred) — unaffected by this refactor.

---

# Recommended Next Milestone

Merge RS-1008 (now including this correction) to `develop`; Web Worker-based off-main-thread image
processing; an `imageBufferCache` eviction policy; migrating `app.js`'s ad hoc project/layer objects
onto `src/core/Project.js`/`Layer.js`; DXF export; investigating S-004.
