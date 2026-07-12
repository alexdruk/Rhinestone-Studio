# Task

**Task ID:** RS-1008
**Task Type:** Feature — Image Trace
**Specification:** `docs/specifications/RS-1008-ImageTrace.md`
**Status:** IN PROGRESS
**Branch:** feature/rs-1008-image-trace

## Goal

Let a user import a bitmap image (PNG/JPG/JPEG/WebP) and automatically convert it into an editable
rhinestone layer via a grayscale → threshold → optional invert → optional blur → optional resize →
`StoneLayout` pipeline, without duplicating or modifying `StoneLayout`/`GeometryEngine`/exporters.

## Required Outcome

See `docs/specifications/RS-1008-ImageTrace.md` in full. Summary:

* New `src/image/**` module: pure, Node-testable pixel-processing pipeline
  (`ImageBuffer.js`/`Grayscale.js`/`Threshold.js`/`Invert.js`/`Blur.js`/`Resize.js`/
  `ImageStoneSampler.js`/`ImageTracePipeline.js`/`ImagePreviewRender.js`) plus one DOM-only decode
  file (`ImageDecoder.js`), all behind `src/image/index.js`.
* `traceImageBufferToStoneLayout()` builds a real `Stone`/`StoneLayout` (imported unmodified from
  `src/geometry/index.js`) via a grid-sample pass over the processed bitmap, mirroring
  `StoneSampler.js`'s `sampleFillPoints()` grid-and-containment-test shape without editing
  `src/geometry/**`.
* `app.js` gains an `image` layer type sharing the existing generic x/y/w/h placement-box editing
  path (move/resize/duplicate/hide/delete/undo/redo), an "Import Image..." control with a live
  preview-before-commit panel (Threshold/Invert/Blur radius/Maximum width/Maximum height), and a
  post-commit `#imageControls` sidebar section for continued live editing.
* `index.html` gains the import button/file input, preview panel, and `#imageControls` section.
* Every existing exporter (SVG, PNG, Generated Layout JSON, Project JSON, Production Sheet
  SVG/PNG/PDF) includes image-layer stones automatically with zero exporter code changes.

## Rules

* Follow `docs/AI_ENGINEER.md`, `docs/CLAUDE_GUIDE.md`, `docs/ARCHITECTURE.md`.
* Smallest coherent change; no unrelated refactoring.
* Do not modify `src/geometry/**` (`GeometryEngine.js`, `StoneLayout.js`, `Stone.js`,
  `StoneSampler.js`, `ContourGeometry.js`, `ArcProjection.js`) or `src/export/**`
  (`SvgExporter.js`, `ProductionSheetExporter.js`, `PdfDocument.js`) — this milestone's own explicit
  constraint, see the specification's "Architecture Requirements" for how single-source-of-truth is
  preserved without touching these files.
* Forbidden files: `src/geometry/**`, `src/export/**`, `src/text/**`, `src/fonts/**`,
  `src/core/**`, `src/browser/**`, `src/renderer/**`, `src/preview3d/**`, `src/svg/**`,
  `src/history/**`, `src/products/**`, `assets/**`, `examples/**`, `style.css`, `README.md`,
  `LICENSE`, `CONTRIBUTING.md`.
* No AI tracing, color separation, edge detection, vectorization, OCR, background removal, or
  multi-color conversion (explicitly out of scope).
* No new production dependency. A temporary `--no-save` `puppeteer-core` install for browser
  verification only is acceptable (established precedent), removed afterward.
* Do not commit failing tests.

## Deliverables

* Implementation: `src/image/**` (new), `app.js`, `index.html`.
* Tests: `tools/test-image-pipeline.mjs`, `tools/test-image-trace-pipeline.mjs`,
  `tools/test-image-integration.mjs` (new), registered in `package.json`; narrow update to
  `tools/test-app-module-migration.mjs`.
* Docs: `src/image/README.md`, `docs/ARCHITECTURE.md` (implementation-status note).
* `npm test` passing in full.
* Browser verification via a real headless-Chrome session (PNG/JPEG/WebP, small + large image,
  threshold/invert/blur/resize, all exports, 3D preview, zero relevant console errors).
* `TASK_RESULT.md` completed.
* One commit on `feature/rs-1008-image-trace`.
