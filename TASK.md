# Task

**Task ID:** RS-1011
**Task Type:** Feature — Fill Algorithms
**Specification:** `docs/specifications/RS-1011-FillAlgorithms.md`
**Status:** IN PROGRESS
**Branch:** feature/rs-1011-fill-algorithms

## Goal

Add professional fill algorithms — Grid Fill, Staggered Fill, Radial Fill, Contour Fill, alongside
the existing Outline mode — so every supported layer type (Text/Curved Text, Circle, Rectangle,
Imported SVG, Image Trace, Boolean/path layers) can choose a fill style through the existing
`GeometryEngine -> StoneLayout -> render/export` pipeline. No parallel fill engine; `GeometryEngine`
stays the single authority for stone placement.

## Required Outcome

See `docs/specifications/RS-1011-FillAlgorithms.md` in full. Summary:

* Audit-first: `'outline'`/`'fill'` sample modes already existed and were already shared by every
  vector layer type; `'fill'` mode already *was* Grid Fill (regular grid, `spacingMm =
  stoneSizeMm + gapMm`) and needed a clearer label, not a reimplementation. Staggered/Radial/Contour
  fill did not exist. Circle/Rectangle/Boolean-path layers had no fill-mode UI control at all
  (hard-coded to Outline in `app.js`).
* New: `sampleStaggeredFillPoints()`/`sampleRadialFillPoints()`/`sampleContourFillPoints()` (plus
  raster `...FieldFillPoints()` counterparts for Image Trace) in `src/geometry/StoneSampler.js`, and
  a new `src/geometry/ContourRingSampler.js` implementing a distance-transform + marching-squares
  inward-ring tracer for Contour Fill (the one genuinely new geometry primitive).
* `GeometryEngine`'s sample-mode enum extends to `{outline, fill, staggered, radial, contour}`
  (`'fill'`'s stored meaning/output is byte-identical to before — only its UI label changes); every
  `generate*Layout()` method now supports the full set via one shared dispatcher, replacing four
  near-identical `mode==='fill'?...:...` ternaries. `generateImageLayout()` gains its first `mode`
  parameter (default `'fill'`, matching its previous unconditional behavior; no `'outline'` — a
  raster field has no vector perimeter).
* New optional `fillMode` layer field on circle/rectangle/path layers (default `'outline'`,
  preserving every existing project's geometry) and on image layers (default `'fill'`); `textMode`/
  `svgMode`'s existing enums widen to the same 5 (4 for image) values, fully backward compatible.
* One "Fill Style" control per layer-type Lightbox (Text, Import/SVG, Shapes, Image Trace), no new
  secondary controls (Radial Fill's center is always the shape's own bounding-box center; Contour
  Fill's ring spacing is always the same stone pitch every other mode uses).

## Rules

* Follow `docs/AI_ENGINEER.md`, `docs/CLAUDE_GUIDE.md`, `docs/ARCHITECTURE.md`,
  `docs/MILESTONE_WORKFLOW.md`.
* Repository is the source of truth; audit before implementing; do not duplicate
  `GeometryEngine`/`StoneLayout` generation; no fill logic in any renderer or exporter.
* Do not modify `PathBoolean.js`'s private marching-squares tracer (precision-tuned by RS-1012A) —
  Contour Fill's tracer is a new, narrowly-scoped file reusing only `isPointInsidePolygons()`.
* Preserve backward/project compatibility: a project saved before this milestone must load and
  render unchanged; no existing layer field's meaning or default changes.

## Deliverables

* `src/geometry/ContourRingSampler.js` — new distance-transform + marching-squares inward-ring tracer.
* `src/geometry/StoneSampler.js` — new staggered/radial/contour vector + field samplers, shared
  `sampleShapeFillPoints()`/`sampleFieldByMode()` dispatchers, `dedupeStonePoints()`.
* `src/geometry/GeometryEngine.js` — extended `SAMPLE_MODES`, `generateImageLayout()` gains `mode`.
* `src/geometry/index.js` — new exports.
* `app.js`, `index.html` — `fillMode` field wiring for circle/rectangle/path/image, widened
  `textMode`/`svgMode` option lists, new Fill Style controls.
* `docs/specifications/RS-1011-FillAlgorithms.md` — full specification and audit.
* `tools/test-fill-algorithms.mjs`, `tools/test-fill-algorithms-integration.mjs` — new tests;
  `package.json` test script updated.
* `npm test` passing in full.
* Real-browser verification (headless Chrome via Playwright, isolated temp profile) of every fill
  mode across every supported layer type, undo/redo, duplicate, save/load, exports, Production
  Sheet, 2D canvas, 3D preview, Dual Workspace, with screenshots.
* `TASK_RESULT.md` completed.
* One commit on `feature/rs-1011-fill-algorithms`, branch pushed (not merged).
