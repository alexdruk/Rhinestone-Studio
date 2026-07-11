# Task

**Task ID:** RS-1005
**Task Type:** Feature — Production Sheet Generator
**Specification:** `docs/specifications/RS-1005-ProductionSheetGenerator.md`
**Status:** IN PROGRESS
**Branch:** feature/rs-1005-production-sheet-generator

## Goal

Add a new export, the **Production Sheet**: a one-page, millimeter-accurate, printable
manufacturing document generated only from the canonical `StoneLayout` — project/object metadata,
stone count/size/color, a scale reference, optional registration marks, optional horizontal
mirror — available as SVG, PNG, and PDF.

## Required Outcome

See `docs/specifications/RS-1005-ProductionSheetGenerator.md` in full. Summary:

* New `src/export/ProductionSheetExporter.js` (`PAGE_SIZES`, `computeProductionSheetLayout()`,
  `productionSheetToSvg()`, `productionSheetToPdf()`) and `src/export/PdfDocument.js` (a minimal,
  dependency-free, deterministic, single-page vector PDF writer using the standard Helvetica font).
* `src/export/SvgExporter.js` gains a small, output-preserving `stoneCircleSvg()` extraction so the
  new exporter reuses it instead of duplicating the circle string template.
* `app.js`/`index.html`: a new `project.name` field (permissive default, like `cupColor`/`wrap`);
  a new "Production Sheet" UI section (page size A4/Letter, margin mm, mirror on/off, registration
  marks on/off) and three guarded, try/catch-wrapped export buttons (SVG/PNG/PDF), following the
  exact pattern of the five existing export handlers.
* PNG export has no new `src/export/**` module: `app.js` rasterizes the generated production-sheet
  SVG via an offscreen `Image`+`<canvas>` at a fixed documented DPI (no fit-to-viewport scaling),
  matching the existing "PNG is a capture, not a standalone exporter" precedent.
* `StoneLayout.js` and `GeometryEngine.js` are not modified. No new stone position is invented
  anywhere — the exporter only re-projects already-generated `stone.xMm/yMm` for centering/mirror/
  mm→pt, the same category of transform `CanvasRenderer2D.fitTransform()` already performs.
* A production size that cannot fit a chosen page (in either orientation) at the requested margin
  fails with a clear error — never silently rescaled ("no scaling" is a hard requirement).

## Rules

* Follow `docs/AI_ENGINEER.md`, `docs/CLAUDE_GUIDE.md`, `docs/ARCHITECTURE.md`.
* Smallest coherent change; no unrelated refactoring; no new dependency/bundler/CDN.
* Update only the guard tests that structurally required it for one specific, documented reason
  each (forbidden-`src/export/`-prefix removal, `app.js` import-allowlist addition, a milestone-
  specific dedicated "export untouched" assertion, or a `validateProject()`/`defaultProject()`
  source-slice extraction that needed widening to reach the new `DEFAULT_PROJECT_NAME` constant) —
  see the specification's "Allowed Files" section for the full, itemized list (eleven files) and
  reasons. Narrow updates only, matching the established precedent.
* Do not commit failing tests.

## Deliverables

* Implementation: `src/export/ProductionSheetExporter.js`, `src/export/PdfDocument.js`,
  `src/export/SvgExporter.js`, `src/export/README.md`, `app.js`, `index.html`,
  `docs/ARCHITECTURE.md`.
* Automated tests: `tools/test-pdf-document.mjs`, `tools/test-production-sheet-exporter.mjs`,
  registered in `package.json`; eleven existing guard tests narrowly updated (see specification).
* `npm test` passing in full (all prior suites + the two new ones).
* Browser verification via a real headless-Chrome session per the specification's checklist.
* `TASK_RESULT.md` completed.
* One commit on `feature/rs-1005-production-sheet-generator`.
