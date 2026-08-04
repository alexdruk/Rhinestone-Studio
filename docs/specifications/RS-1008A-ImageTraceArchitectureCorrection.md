# RS-1008A — Image Trace Architecture Correction

## Objective

RS-1008 (Image Trace) shipped functionally correct but introduced a real architectural regression:
`src/image/**` constructed `Stone`/`StoneLayout` directly instead of going through the permanent
`GeometryEngine`, creating a second, independent geometry implementation. This milestone corrects
that: image tracing now feeds the existing permanent `GeometryEngine` pipeline. It runs on the same
branch as RS-1008 (unmerged at the time this correction was requested), so it is a direct fix to
that milestone's own commit, not a separate feature.

## Current Repository State (before this correction)

* `src/image/ImageTracePipeline.js`'s `traceImageBufferToStoneLayout()` ran the whole pipeline
  (grayscale → threshold → invert → blur → resize → grid-sample via
  `src/image/ImageStoneSampler.js`'s `sampleImageFillPoints()`) and constructed `Stone`/
  `StoneLayout` itself, importing those classes unmodified from `src/geometry/index.js` but never
  calling into `GeometryEngine.js`.
* This was a deliberate (if regrettable) consequence of RS-1008's own brief, which explicitly
  forbade modifying `src/geometry/GeometryEngine.js`/`StoneLayout.js`/`StoneSampler.js`. RS-1008's
  spec and `docs/ARCHITECTURE.md` both documented this openly as "one deliberate,
  milestone-brief-directed exception," not a silent regression — but it is still a second
  stone-generating implementation, and `docs/ARCHITECTURE.md`'s Core Principle is unambiguous:
  "There is only ONE source of truth" / "No consumer generates geometry" outside the Geometry
  Engine.
* `app.js`'s local `GeometryEngine` bridge class's `generateImageStonesLive()` called
  `traceImageBufferToStoneLayout(buffer, params)` directly — the only one of the four
  `generate*StonesLive()` methods that did not call `this.permanentEngine.generateXLayout(...)`.
* `app.js`'s "preview before commit" panel duplicated part of the same pipeline again (manually
  chaining `toGrayscale`/`applyThreshold`/`invertMask`/`blurMask`/`resizeField` for the live density
  canvas, then separately calling `traceImageBufferToStoneLayout()` for the approximate stone
  count) — a second call site exercising pipeline logic outside `src/image/**`'s own orchestrator.

## Required Outcome

* `src/geometry/GeometryEngine.js` gains `generateImageLayout(params)`: takes an already-decoded
  `imageBuffer` (RGBA pixels) plus placement/stone params
  (`layerId, xMm, yMm, widthMm, heightMm, stoneSizeMm, gapMm, color`) and bitmap-processing params
  (`threshold, invert, blurRadiusPx, maxWidthPx, maxHeightPx`), internally calls
  `prepareImageField()` (imported from `../image/index.js`, mirroring how `generateSvgLayout()`
  already imports and calls `parseSvgDocument()` from `../svg/index.js`), samples the resulting
  field with a new `sampleFieldFillPoints()`, and constructs `Stone`/`StoneLayout` itself — the
  same "normalize params → sample points → `Stone[]` → `StoneLayout`" shape every other
  `generate*Layout()` method already uses. Returns a `StoneLayout`.
* `src/geometry/StoneSampler.js` gains `sampleFieldFillPoints(field, placementBox, spacingMm)`: a
  grid-walk-and-keep-if-on-field function, the raster analogue of the existing
  `sampleFillPoints(polygons, boundingBox, spacingMm)` (grid-walk-and-keep-if-inside-polygon).
  Exported from `src/geometry/index.js`.
* `src/image/**` is reduced to pure field-preparation only. `ImageTracePipeline.js` and
  `ImageStoneSampler.js` are deleted; a new `ImageFieldPipeline.js` exports `prepareImageField(imageBuffer,
  {threshold, invert, blurRadiusPx, maxWidthPx, maxHeightPx})`, returning the neutral density field
  (grayscale → threshold → invert → blur → resize, unchanged logic, just no longer followed by
  sampling/Stone construction). `src/image/**` has **zero** dependency on `src/geometry/**` and
  never constructs a `Stone`/`StoneLayout` — mirroring `src/svg/**`'s existing "produces neutral
  input only" rule exactly.
* `app.js`'s `generateImageStonesLive()` now calls `this.permanentEngine.generateImageLayout(params)`,
  matching `generateSvgStonesLive()`/`generateShapeStonesLive()`'s shape exactly. Image decode and
  the `imageBufferCache` memoization stay in `app.js` (the one async, DOM-only step;
  `generateImageLayout()` itself is synchronous, like `generateShapeLayout()`).
* `app.js`'s preview panel now calls `prepareImageField()` once for the live density-mask canvas
  and `permanentEngine.generateImageLayout()` (the exact same code path a real commit uses, with a
  throwaway `'preview'` `layerId`) for the approximate stone count — removing the previous
  duplicated manual pipeline chain.
* Output is byte-identical to the pre-correction implementation for a fixed, committed set of
  regression cases (see "Required Automated Tests"), and every pre-existing Image Trace test/
  browser-verified behavior continues to pass unchanged.

## Architecture Requirements

* This corrects `docs/ARCHITECTURE.md`'s Core Principle back to holding without exception for
  Image Trace: `GeometryEngine` is again the only component that constructs `Stone`/`StoneLayout`
  for every layer type, including `image`.
* `GeometryEngine.js` importing `prepareImageField` from `../image/index.js` is the same shape it
  already has for SVG (`import { parseSvgDocument } from '../svg/index.js'`) — the permanent engine
  is allowed to depend on peer input-processing modules that produce neutral input; those modules
  must never depend back on `src/geometry/**`. This one-way rule is enforced by a dedicated
  regression test scanning `src/image/**` for any `../geometry/` import or `new Stone`/
  `new StoneLayout` call.
* `sampleFieldFillPoints()` lives in `StoneSampler.js`, not duplicated in `src/image/**`, so every
  stone-sampling algorithm (vector outline, vector fill, raster fill) has exactly one home.
* `Stone.js`/`StoneLayout.js`/`ContourGeometry.js`/`ArcProjection.js` remain untouched — only
  `GeometryEngine.js` and `StoneSampler.js` (plus `index.js`/`README.md`) change within
  `src/geometry/**`.
* No public behavior changes: layer fields, Project JSON shape, export formats, and the "preview
  before commit" UI are all unchanged from RS-1008 — this is purely an internal refactor.

## Allowed Files

* `src/geometry/GeometryEngine.js`, `src/geometry/StoneSampler.js`, `src/geometry/index.js`,
  `src/geometry/README.md`
* `src/image/**` (delete `ImageTracePipeline.js`/`ImageStoneSampler.js`; add
  `ImageFieldPipeline.js`; update `index.js`/`README.md`)
* `app.js`
* `tools/**` (updated/new tests; narrow guard updates to pre-existing forbidden-file lists that
  previously forbade `src/geometry/GeometryEngine.js`/`StoneSampler.js` for their own historical
  reasons)
* `package.json`
* `docs/specifications/**`, `docs/ARCHITECTURE.md`
* `TASK.md`, `TASK_RESULT.md`

## Forbidden Files

* `src/geometry/StoneLayout.js`, `src/geometry/Stone.js`, `src/geometry/ContourGeometry.js`,
  `src/geometry/ArcProjection.js`
* `src/export/**`, `src/text/**`, `src/fonts/**`, `src/core/**`, `src/browser/**`,
  `src/renderer/**`, `src/preview3d/**`, `src/svg/**`, `src/history/**`, `src/products/**`
* `index.html` (no UI/control changes — this is a pure internal refactor)
* `assets/**`, `examples/**`
* `style.css`, `README.md`, `LICENSE`, `CONTRIBUTING.md`
* `node_modules/**`

## Out of Scope

* Any change to the "Stone spacing reuses shared Stone size + Gap controls" / "Maximum
  width/height are pixel caps" design decisions from RS-1008 — unchanged.
* Any change to the preview-before-commit UI's visible behavior, controls, or ids.
* Web Worker / off-main-thread processing (unchanged limitation from RS-1008).
* Migrating `app.js`'s ad hoc project/layer model onto `src/core/Project.js`/`Layer.js`.

## Required Automated Tests

**Byte-identical regression proof** (`tools/lib/imageTraceFixtures.mjs`,
`tools/generate-image-trace-baselines.mjs`, `tools/image-trace-regression-baselines.json`,
`tools/test-image-trace-regression.mjs`):

1. A committed JSON fixture (`tools/image-trace-regression-baselines.json`) captured from the
   pre-correction (RS-1008) implementation via a one-time generator script
   (`tools/generate-image-trace-baselines.mjs`, not run by `npm test`, mirroring
   `tools/generate-example-baselines.mjs`'s established precedent), covering 8 representative cases
   (half-split shape, inverted, blurred, two threshold levels on a gradient, an explicitly placed
   solid shape, and capped-vs-uncapped working resolution).
2. `tools/test-image-trace-regression.mjs` replays the exact same inputs
   (`tools/lib/imageTraceFixtures.mjs`'s `buildRegressionCases()`, shared with the generator so the
   two can never drift apart by accident) through the corrected
   `GeometryEngine.generateImageLayout()` and asserts `deepEqual` against the committed baseline for
   every case.
3. Structural proof that Image Trace actually uses the permanent pipeline: `app.js`'s
   `generateImageStonesLive()` calls `this.permanentEngine.generateImageLayout(params)`;
   `GeometryEngine.js` defines `generateImageLayout()`, imports `prepareImageField` from
   `../image/index.js`, and calls `sampleFieldFillPoints()`/constructs `Stone` via the method body;
   `sampleFieldFillPoints()` is exported from `src/geometry/index.js`.
4. Structural proof the old implementation was actually removed, not left duplicated: `src/image/index.js`
   no longer exports `traceImageBufferToStoneLayout`/`sampleImageFillPoints`; `ImageTracePipeline.js`/
   `ImageStoneSampler.js` no longer exist on disk.
5. Structural proof of the one-way dependency rule: no file under `src/image/**` imports from
   `../geometry/` or constructs `new Stone(...)`/`new StoneLayout(...)`.
6. This suite's own forbidden-file guard (narrower than RS-1008's: `src/geometry/**` and
   `src/image/**` are expected to change; everything else stays forbidden).

**Extended pure-pipeline coverage** (`tools/test-image-pipeline.mjs`, updated): the previous
`sampleImageFillPoints()` unit test is replaced with a `prepareImageField()` orchestration test
(threads grayscale→threshold→invert→blur→resize in the documented order; validates its own
threshold/blurRadiusPx/maxWidthPx/maxHeightPx params). Grayscale/threshold/invert/blur/resize/
`isSupportedImageFile`/determinism tests are unchanged (those pure functions did not move).

**Extended permanent-engine coverage** (`tools/test-geometry-engine.mjs`, extended with a new
`generateImageLayout()` block, mirroring the existing `generateSvgLayout()` block): foreground-only
placement, `invert` flipping which half traces, monotonic threshold behavior on a gradient, blur
not crashing/producing non-finite coordinates, `maxWidthPx`/`maxHeightPx` actually bounding working
resolution, correct mm placement/scaling, correct `layerId`/`color`/`sizeMm` on every stone,
determinism, six distinct malformed-param cases, and an all-background buffer producing a valid
empty `StoneLayout` — the same coverage `tools/test-image-trace-pipeline.mjs` (RS-1008, now
deleted) had against the removed `traceImageBufferToStoneLayout()`, now exercised against
`GeometryEngine.generateImageLayout()` directly.

**Updated structural integration tests** (`tools/test-image-integration.mjs`): tests 1/2 updated to
assert the `this.permanentEngine.generateImageLayout(params)` call and the `prepareImageField`
import (and that `traceImageBufferToStoneLayout` no longer appears in `app.js`); test 9's
forbidden-file list narrowed to no longer forbid `src/geometry/`.

**Narrow guard updates** to six pre-existing suites that hard-coded "GeometryEngine.js and
StoneLayout.js are untouched" from earlier milestones (`tools/test-ui-discoverability.mjs`,
`tools/test-object-template-integration.mjs`, `tools/test-default-text-layer-editing.mjs`,
`tools/test-production-sheet-exporter.mjs`, `tools/test-preview3d-integration.mjs`,
`tools/test-crystal-color-catalog.mjs`, `tools/test-crystal-color-integration.mjs`): each narrowed
to keep forbidding `StoneLayout.js` (and, where applicable, `Stone.js`/`ContourGeometry.js`/
`ArcProjection.js`) while allowing `GeometryEngine.js`/`StoneSampler.js`/`index.js`/`README.md`,
each with an inline comment pointing at `tools/test-image-trace-regression.mjs` for the dedicated
proof — the same "narrow, surgical, documented carve-out" pattern this repository has used for
every prior milestone that legitimately extended a previously-forbidden file (e.g. RS-1005's
`src/export/` carve-outs, RS-1007's `src/renderer/StoneColors.js` carve-outs).

Run the full suite (`npm test`) and confirm every pre-existing suite still passes with only the
enumerated guard updates changed.

## Required Browser Verification

Re-run the full RS-1008 browser verification checklist (`docs/specifications/RS-1008-ImageTrace.md`,
"Required Browser Verification") against the corrected implementation, confirming identical
observed behavior (stone counts, timings, all interactions) to the pre-correction run:

* [ ] PNG/JPEG/WebP import, live preview, commit/cancel — identical stone counts to the RS-1008
      browser verification run.
* [ ] Post-commit `#imageControls` editing regenerates stones correctly.
* [ ] Move/resize/duplicate/hide/delete/undo/redo all still work.
* [ ] Large-image (~1500×1500px) import still completes without the page becoming unresponsive.
* [ ] All exports (Project JSON, Generated Layout JSON, 2D SVG, 2D PNG, Cup PNG, Production Sheet
      SVG/PDF) still succeed and reflect image-layer stones; Project JSON round-trip still works.
* [ ] 3D preview still renders image-layer stones.
* [ ] Zero relevant console errors.

## Acceptance Criteria

* `npm test` passes in full.
* `tools/test-image-trace-regression.mjs` proves (a) Image Trace uses the permanent geometry
  pipeline, (b) output is byte-identical to the pre-correction implementation, (c) the old
  implementation was actually removed.
* No forbidden file changed.
* Browser-observed behavior (stone counts, all interactions, exports) is identical to the RS-1008
  browser verification session.
* `docs/ARCHITECTURE.md` accurately reflects the corrected state, including an honest record that
  the exception existed and was corrected.

## Required Commands

```bash
npm test
git diff --check
git status
npm run dev
```

## Commit Message

```
refactor(image): route Image Trace through the permanent GeometryEngine (RS-1008A)
```

## Deliverables

* `src/geometry/GeometryEngine.js` (`generateImageLayout()`), `src/geometry/StoneSampler.js`
  (`sampleFieldFillPoints()`), `src/geometry/index.js`, `src/geometry/README.md`.
* `src/image/ImageFieldPipeline.js` (new, replaces the deleted `ImageTracePipeline.js`/
  `ImageStoneSampler.js`), `src/image/index.js`, `src/image/README.md`.
* `app.js`.
* `tools/lib/imageTraceFixtures.mjs`, `tools/generate-image-trace-baselines.mjs`,
  `tools/image-trace-regression-baselines.json`, `tools/test-image-trace-regression.mjs` (new);
  `tools/test-image-pipeline.mjs`, `tools/test-geometry-engine.mjs`,
  `tools/test-image-integration.mjs` (updated); narrow guard updates to six pre-existing suites
  listed above; `package.json` test script (removes `test-image-trace-pipeline.mjs`, adds
  `test-image-trace-regression.mjs`).
* This specification, `TASK.md`, `TASK_RESULT.md`, `docs/ARCHITECTURE.md` update.

## Next Milestone

Unchanged from RS-1008: Web Worker-based off-main-thread image processing, an `imageBufferCache`
eviction policy, migrating `app.js`'s ad hoc project/layer objects onto
`src/core/Project.js`/`Layer.js`, DXF export, investigating S-004.
