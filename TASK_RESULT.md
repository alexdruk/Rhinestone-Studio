# Rhinestone Studio — Task Result

This document is completed by the implementation engineer after finishing the current task.

---

# Task ID

RS-1005 — Production Sheet Generator

---

# Status

IMPLEMENTED

---

# Branch

feature/rs-1005-production-sheet-generator

---

# Commit

Do not write the current commit hash into this file — this file is part of the same commit it
describes. Obtain it from Git history with:

```bash
git log -1 --oneline
```

---

# Summary

Added a new export, the **Production Sheet**: a one-page, millimeter-accurate, printable
manufacturing document generated only from the canonical `StoneLayout`, available as SVG, PNG, and
PDF.

Two new modules under `src/export/**`:

* `ProductionSheetExporter.js` — `PAGE_SIZES` (A4/Letter), `computeProductionSheetLayout()` (the
  single pure geometry-projection pass both output formats render — header text lines, the centered
  production rect, every stone re-projected into page space with an optional horizontal mirror,
  registration-mark line segments, and the scale-reference bar geometry), `productionSheetToSvg()`,
  `productionSheetToPdf()`.
* `PdfDocument.js` — a minimal, dependency-free, deterministic single-page vector PDF writer
  (lines/rects/circles/text) over the standard, non-embedded Helvetica font (WinAnsiEncoding). No
  external PDF library was added — `package.json`'s only dependency is still `opentype.js`.

`SvgExporter.js` gained a small, output-preserving `stoneCircleSvg()` extraction so the new
exporter reuses the exact same per-stone `<circle>` string template instead of duplicating it
(`stoneLayoutToSvg()`'s own output is byte-for-byte unchanged — its full pre-existing test suite
passes unmodified).

`app.js`/`index.html` gained: a new `project.name` field (permissive default `'Untitled Project'`,
following the exact pattern `cupColor`/`wrap`/`product` already use — old Project JSON files with
no `name` field still import cleanly); a "Production Sheet" UI section (page size A4/Letter, margin
mm, mirror on/off, registration marks on/off — all view/export-only options read live at
export-click time, like `rotation`/`zoom`, not part of `project`, not undo/redo-tracked); three
guarded, try/catch-wrapped export buttons following the exact pattern the five pre-existing export
handlers already use. PNG export has no new `src/export/**` module: `app.js` rasterizes the
generated SVG via an offscreen `Image`+`<canvas>` at a fixed, documented DPI
(`PRODUCTION_SHEET_PNG_DPI = 200`), matching the existing "PNG is a render capture, not a standalone
exporter" precedent `#exportPNG`/`#exportCup` already use.

`StoneLayout.js` and `GeometryEngine.js` are byte-for-byte untouched. No new stone position is
invented anywhere — the exporter only re-projects already-generated `stone.xMm/yMm` (a centering
translate, an optional mirror, mm→pt for PDF), the same category of transform
`CanvasRenderer2D.fitTransform()` already applies for the on-screen canvas. A production size that
cannot fit the chosen page (in either portrait or landscape orientation) at the requested margin
throws a clear `RangeError` naming the page/orientation tried — the sheet is never silently
rescaled ("no scaling" is a hard requirement, not a soft default).

**Mid-implementation fix (found via browser verification, not by the automated suite):** the first
rendered production sheet showed the last header line visually crowding the production rect's top
border and its registration marks. Root cause: the header's line-height arithmetic was duplicated
between `productionSheetToSvg()` and `productionSheetToPdf()`, and the fixed `HEADER_HEIGHT_MM`
constant was slightly too tight for 8 lines of text. Fixed by moving per-line baseline computation
(`yMm`) into `computeProductionSheetLayout()` itself — computed once, consumed identically by both
renderers — and deriving `HEADER_HEIGHT_MM` analytically from the actual line count/sizes plus a
10mm bottom padding constant, instead of a hand-picked magic number. Re-verified visually
(screenshots) and via the full automated suite after the fix; both passed.

---

# Files Changed

**New:**
* `src/export/ProductionSheetExporter.js`, `src/export/PdfDocument.js`
* `docs/specifications/RS-1005-ProductionSheetGenerator.md`
* `tools/test-pdf-document.mjs` (12 tests), `tools/test-production-sheet-exporter.mjs` (23 tests)

**Modified:**
* `src/export/SvgExporter.js` (`stoneCircleSvg()` extraction; output unchanged)
* `src/export/README.md`, `docs/ARCHITECTURE.md` (implementation-status notes)
* `app.js`, `index.html` (`project.name`; Production Sheet UI + 3 export handlers)
* `package.json` (registered the 2 new test files)
* `TASK.md` (this milestone's task)
* Eleven existing guard tests, each narrowly updated for one specific, documented reason (no guard
  test's actual protection was weakened beyond what this milestone legitimately changed — see the
  specification's "Allowed Files" section for the itemized list):
  * `tools/test-svg-integration.mjs`, `tools/test-undo-redo-integration.mjs`,
    `tools/test-cup-rotation-stabilization.mjs`, `tools/test-ux-visual-polish.mjs`,
    `tools/test-examples-regression.mjs`, `tools/test-object-template-integration.mjs` — removed
    `src/export/` from each's forbidden-prefix list.
  * `tools/test-app-module-migration.mjs`, `tools/test-shape-geometry-integration.mjs` — added
    `ProductionSheetExporter.js` to `app.js`'s approved direct-import allowlist (`src/export/**`
    has no barrel `index.js`).
  * `tools/test-curved-text-integration.mjs`, `tools/test-default-text-layer-editing.mjs` — each
    had its own dedicated, milestone-specific "`src/export/**` untouched" assertion; narrowed to
    name the specific files RS-1005 now legitimately touches.
  * `tools/test-svg-integration.mjs`, `tools/test-examples-regression.mjs`,
    `tools/test-default-text-layer-editing.mjs` — widened the source-text slice each extracts
    `validateProject()`/`defaultProject()` from, so it includes the new top-level
    `DEFAULT_PROJECT_NAME` constant those functions now reference.
  * `tools/test-production-export-validation.mjs` — updated its "every export handler reports via
    `#status`" catch-block count from 5 to 8 (5 original + 3 new Production Sheet handlers).

No forbidden file was changed beyond this itemized, documented list (`src/geometry/**`,
`src/renderer/**`, `src/text/**`, `src/fonts/**`, `src/core/**`, `src/svg/**`, `src/history/**`,
`src/products/**`, `assets/**`, `examples/**`, `style.css`, `README.md`, `LICENSE`,
`CONTRIBUTING.md` are all untouched).

---

# Commands Executed

```bash
npm test              # full suite, see below
git diff --check      # clean, no whitespace errors
git status             # reviewed before every commit
npm run dev            # python3 -m http.server 5173, used for browser verification
```

---

# Automated Test Results

`npm test` — **27/27 suites pass**, exit code 0 (25 pre-existing suites + the 2 new ones, all
unmodified pre-existing suites still pass after the 11 narrow guard-test updates above).

New suites:

* `tools/test-pdf-document.mjs` — 12/12 passed. Covers: valid `%PDF-1.4`/`%%EOF` framing; every
  xref byte offset verified to point at its own `"N 0 obj"`; `/MediaBox` matches requested
  dimensions; byte-identical determinism for identical draw calls, different output for different
  calls; circle draws emit exactly 4 Bézier `c` operators + correct fill/stroke operator; text
  draws emit a correct `BT/Tf/Td/Tj/ET` sequence with escaped parentheses; non-Latin-1 text
  degrades to `?` without corrupting the byte stream (documented limitation, not a defect);
  `PT_PER_MM` conversion is exact; constructor input validation.
* `tools/test-production-sheet-exporter.mjs` — 23/23 passed. Covers: input validation
  (`TypeError`/`RangeError`, including "doesn't fit either orientation" with a clear message);
  determinism for both SVG and PDF; header stone count/size(s)/color(s) derived from
  `stoneLayout.stones` (not passed-in options), including the empty-layout case; registration
  marks (exactly 4 corner marks, toggle on/off changes nothing else); mirror mode (exact reflected
  X, Y/size/color/order unaffected); A4 vs Letter page dimensions and automatic landscape
  orientation selection; margin behavior (symmetric clearance — the centered rect's position is
  margin-invariant while it fits, and the margin actually taken is reported in the header; a
  too-large margin throws the same clear error); SVG structural correctness (circle count/cx/cy/r/
  data-color, page-size root attributes); PDF structural correctness (`/MediaBox`, one 4-`c`-op
  circle per stone, correct `Tj` count for header + scale-bar labels); **every object template**
  (`OBJECT_TEMPLATE_IDS`) fits both page sizes at the default margin with the correct
  `displayName`; **every layer type** (text, curved text, SVG, circle, rectangle) generated via the
  real permanent `GeometryEngine` and merged into one `StoneLayout`, proving the exporter handles
  it identically to any other layout (exported circle count === merged stone count); architecture
  guards (neither new module references the permanent stone-generation engine, geometry-generation
  calls, `project.layers`, or a layer's `type`); `app.js`/`index.html` wiring structural checks; no
  forbidden file changed.

---

# Browser/Manual Verification

Real headless-Chrome session via Puppeteer (CDP) against `python3 -m http.server 5173`, per
`docs/AI_ENGINEER.md`. Console `error`/`warning` and `pageerror` events were explicitly captured for
the entire session, not inferred.

Actual observed values:

* **Default project (mug, "Vitalina Serbin" text layer), Export Production Sheet SVG:** downloaded
  and opened. Header present and correct: `Untitled Project`, `Object: Mug`,
  `Production size: 210 × 90 mm`, `Stone count: 375`, `Stone size: 2 mm`, `Gap: 0.3 mm`,
  `Crystal color: Gold`, `Page: A4 (landscape) · Margin: 10 mm · Mirror: Off · Registration marks:
  On`. 375 `<circle>` elements — matches the on-screen "375 stones" stat exactly. Scale reference
  bar with "0mm"/"50mm" labels and caption present. 4 corner registration marks present (14 total
  black `<line>` elements = 8 registration-mark segments + 6 scale-bar ticks).
* **Mirror toggle:** with Mirror On, the first stone's exported `cx` changed from `61.706` to
  `235.294` (a real reflection about the production rect, not a no-op); toggled back off afterward.
* **Registration marks toggle:** with Registration marks Off, the header read
  `Registration marks: Off` and line-element count dropped from 14 to 6 (only the scale-bar ticks
  remained) — confirms the toggle removes exactly the registration-mark elements and nothing else.
* **Object type switch:** Tumbler → header `Object: Straight Tumbler`,
  `Production size: 230 × 100 mm`; Bottle → `Object: Bottle`, `Production size: 180 × 90 mm`. Both
  exported with zero console errors; switched back to Mug afterward.
* **All layer types combined:** added a circle layer and a rectangle layer, imported a small SVG
  layer, and enabled curved text on the default text layer — on-screen stat read "638 stones";
  the exported Production Sheet SVG contained exactly 638 `<circle>` elements. Visual inspection
  (rendered screenshot) confirmed straight-vs-curved text, the imported SVG shape, the circle, and
  the rectangle all appear correctly as stones on one sheet, alongside the correct header/scale
  bar/registration marks.
* **Page size A4 vs Letter:** A4 export root was
  `<svg ... width="297mm" height="210mm" viewBox="0 0 297 210">`; Letter export root was
  `<svg ... width="279.4mm" height="215.9mm" viewBox="0 0 279.4 215.9">` — genuinely different
  dimensions, both landscape (this project's 210×90mm/230×100mm/180×90mm production sizes are all
  wider than tall, so landscape is selected automatically for every template at the default
  margin).
* **PNG export:** downloaded a real `image/png` blob, 460,895 bytes (well above a trivial/blank
  threshold).
* **PDF export:** downloaded a real `application/pdf` blob, 170,544 bytes; first bytes confirmed
  `%PDF-1.4`.
* **Console/errors:** the only network/console event across the entire session was a single
  `404 Failed to load resource` for `/favicon.ico` — the browser's automatic favicon request; the
  app defines no favicon and never has (confirmed unrelated to this milestone: `index.html` has no
  favicon `<link>` before or after this change). **Zero application-originated console errors or
  warnings, and zero page (uncaught exception/unhandled rejection) errors**, across every
  interaction above.
* Visual regression check: took full-app and exported-sheet screenshots before and after a
  mid-implementation header-spacing fix (see Summary) to confirm the fix actually resolved the
  crowding and introduced no new issue.

Not performed: printing an exported sheet on physical paper to verify the 50mm scale bar measures
exactly 50mm off a real printer (no physical printer available in this environment) — the bar's mm
dimensions are verified programmatically (`SCALE_BAR_LENGTH_MM = 50`, unit-tested) and the SVG/PDF
both declare explicit millimeter page dimensions, but true print-fidelity requires a human with a
printer and ruler.

---

# Warnings

* PDF text is Latin-1/WinAnsiEncoding only (standard Helvetica font, no embedding) — characters
  outside that range render as `?` instead of correctly. Documented in the specification's "Out of
  Scope" and in `PdfDocument.js`'s own header comment; unit-tested (`test-pdf-document.mjs` #9) to
  confirm graceful degradation rather than corruption. SVG/PNG output has no such limitation.
* PNG rasterization goes through the browser's native SVG image decoder (offscreen `Image` +
  `drawImage` at a fixed 200 DPI); this is a real, undistorted, mm-accurate raster (destination
  canvas pixel dimensions are computed directly from the page's mm size, never from a
  fit-to-viewport step), but sharpness at very high requested DPI depends on that native decoder,
  not a custom rasterizer.
* Margins are a single uniform value (not configurable per side) and only A4/Letter page sizes are
  offered, both explicitly scoped this way in the specification ("Out of Scope").

---

# Known Limitations

* Same as the "Warnings" above: Latin-1-only PDF text, browser-native PNG rasterization, uniform
  margin, two page sizes.
* Multi-page nesting, automatic stone packing, print-spooler/printer-driver integration, and color
  separation are explicitly out of scope per the milestone brief and were not built.

---

# Recommended Next Milestone

DXF export; multi-page nested production sheets for large production runs; per-side margins;
custom page sizes; embedding a Unicode-capable font in `PdfDocument.js`; consolidating the
cross-layer `dedupe()` merge step into `src/geometry/GeometryEngine.js` (still the one remaining
architectural gap documented in `docs/ARCHITECTURE.md`); migrating `app.js`'s ad hoc project/layer
objects onto `src/core/Project`/`Layer`.
