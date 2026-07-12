# Task

**Task ID:** RS-1008A
**Task Type:** Architecture Correction — Image Trace
**Specification:** `docs/specifications/RS-1008A-ImageTraceArchitectureCorrection.md`
**Status:** IN PROGRESS
**Branch:** feature/rs-1008-image-trace (continuation of the still-unmerged RS-1008 branch)

## Goal

RS-1008 (Image Trace) had `src/image/**` construct `Stone`/`StoneLayout` directly instead of going
through the permanent `GeometryEngine`, creating a second geometry implementation. Refactor so
image tracing feeds the existing permanent `GeometryEngine` pipeline instead, while preserving all
current functionality, browser behavior, exports, Project JSON compatibility, and tests.

## Required Outcome

See `docs/specifications/RS-1008A-ImageTraceArchitectureCorrection.md` in full. Summary:

* `src/geometry/GeometryEngine.js` gains `generateImageLayout()`: the only component that
  constructs `Stone`/`StoneLayout` for image-traced layers, mirroring
  `generateSvgLayout()`/`generateShapeLayout()`'s exact shape.
* `src/geometry/StoneSampler.js` gains `sampleFieldFillPoints()` (raster grid sampling), exported
  from the permanent barrel — no sampling logic duplicated anywhere.
* `src/image/**` is reduced to pure field-preparation only (`prepareImageField()`): zero dependency
  on `src/geometry/**`, never constructs a `Stone`/`StoneLayout`, mirroring `src/svg/**`'s existing
  "produces neutral input only" rule.
* `app.js`'s `generateImageStonesLive()` calls `this.permanentEngine.generateImageLayout(params)`,
  matching every other layer type's live-generation method.
* A dedicated regression suite proves: (1) Image Trace uses the permanent pipeline, (2) output is
  byte-identical to the pre-correction implementation for a committed baseline, (3) the old
  implementation was actually removed, not left duplicated.
* No visible behavior change: same layer fields, same Project JSON shape, same UI, same exports.

## Rules

* Follow `docs/AI_ENGINEER.md`, `docs/CLAUDE_GUIDE.md`, `docs/ARCHITECTURE.md`.
* Smallest coherent change; this is a refactor, not a feature — no UI/control changes.
* `src/geometry/StoneLayout.js`, `Stone.js`, `ContourGeometry.js`, `ArcProjection.js` stay
  untouched — only `GeometryEngine.js`/`StoneSampler.js`/`index.js`/`README.md` change within
  `src/geometry/**`.
* Forbidden files: `src/geometry/StoneLayout.js`, `src/geometry/Stone.js`,
  `src/geometry/ContourGeometry.js`, `src/geometry/ArcProjection.js`, `src/export/**`,
  `src/text/**`, `src/fonts/**`, `src/core/**`, `src/browser/**`, `src/renderer/**`,
  `src/preview3d/**`, `src/svg/**`, `src/history/**`, `src/products/**`, `index.html`,
  `assets/**`, `examples/**`, `style.css`, `README.md`, `LICENSE`, `CONTRIBUTING.md`.
* Do not commit failing tests. Preserve every existing test's intent even where its assertions must
  be updated to match the corrected architecture.

## Deliverables

* Implementation: `src/geometry/GeometryEngine.js`, `src/geometry/StoneSampler.js`,
  `src/geometry/index.js`, `src/geometry/README.md`, `src/image/ImageFieldPipeline.js` (new,
  replaces deleted `ImageTracePipeline.js`/`ImageStoneSampler.js`), `src/image/index.js`,
  `src/image/README.md`, `app.js`.
* Tests: `tools/lib/imageTraceFixtures.mjs`, `tools/generate-image-trace-baselines.mjs`,
  `tools/image-trace-regression-baselines.json`, `tools/test-image-trace-regression.mjs` (new);
  `tools/test-image-pipeline.mjs`, `tools/test-geometry-engine.mjs`,
  `tools/test-image-integration.mjs` (updated); narrow guard updates to six pre-existing suites;
  `package.json`.
* `npm test` passing in full (472/472 assertions).
* Browser verification confirming identical behavior to the RS-1008 verification session.
* `TASK_RESULT.md` completed.
* One commit on `feature/rs-1008-image-trace`.
