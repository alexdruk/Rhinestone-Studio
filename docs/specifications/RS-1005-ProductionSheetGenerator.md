# RS-1005 — Production Sheet Generator

## Objective

Add a new export — the **Production Sheet** — that packages an already-generated `StoneLayout`
into a single, millimeter-accurate, printable manufacturing document: project/product metadata,
the stone layout drawn at true (1:1) size, a scale reference bar, optional registration marks, and
an optional horizontal mirror. Available as SVG, PNG, and PDF. This milestone adds a new consumer
of `StoneLayout`; it does not change how geometry is generated, and it does not touch
`StoneLayout`/`GeometryEngine`.

## Current Repository State

* Per `docs/ARCHITECTURE.md`, every consumer (2D canvas, cup preview, SVG export) already reads
  from one merged `StoneLayout` (`layerId:'project'` sentinel) built once per `updateAll()` in
  `app.js`. `src/export/SvgExporter.js` (`stoneLayoutToSvg()`) is the only existing exporter
  module — pure string generation, no DOM dependency, validated input (RS-0003.5D1). PNG export
  (`#exportPNG`/`#exportCup`) is a `canvas.toBlob()` capture of whatever `CanvasRenderer2D`/
  `CupRenderer` last drew — not a `src/export/**` module. There is no PDF export and no dependency
  capable of producing one (`package.json` has only `opentype.js`); no CDN/bundler is permitted
  per `docs/AI_ENGINEER.md`.
* `app.js`'s ad hoc project object has no project-name field. `defaultProject()` and
  `validateProject()` need one new optional field (`name`), following the exact permissive-default
  pattern already used for `cupColor`/`wrap`/`product` (missing/invalid → a safe default, never a
  thrown error for old Project JSON files).
* `src/products/ObjectTemplate.js` (RS-1004) already gives every object template a
  `productionWidthMm`/`productionHeightMm`/`displayName`; `project.canvas.width`/`height` already
  equal the active template's production size. This milestone reads those as plain display
  metadata, exactly like `CupRenderer.renderCup()` already reads `objectTemplate` — it adds no new
  concept to `src/products/**`.
* `Stone` carries `xMm`/`yMm`/`sizeMm`/`color`/`layerId`/`index`/`metadata`, but no `gap` (gap is a
  per-layer *generation* parameter, never stored on a placed stone). The production sheet's "gap"
  header field therefore cannot be derived from `StoneLayout` alone — it is supplied as plain
  caller metadata, exactly like `stoneLayoutToSvg(layout, {widthMm, heightMm})` already accepts
  canvas dimensions as a second parameter untied to the layout itself. "Stone size" and "crystal
  color", by contrast, **are** derivable directly from `stoneLayout.stones` (`sizeMm`/`color` per
  stone) and are computed that way, not passed in — this is a stronger reading of "generated only
  from StoneLayout" wherever the data is actually present on `Stone`.

## Expected Visible Change

* A new "Project name" field appears at the top of the left panel (defaults to `Untitled Project`
  for new projects; existing Project JSON files without a `name` field still import cleanly).
* A new "Production Sheet" section appears in the left panel with four controls (Page size:
  A4/Letter; Margin (mm); Mirror: On/Off; Registration marks: On/Off) and three buttons ("Export
  Production Sheet (SVG)", "(PNG)", "(PDF)").
* Clicking any of the three buttons downloads a one-page document at the chosen page size showing:
  project name, object type, production size, stone count, stone size(s), gap(s), crystal
  color(s), a page/margin/mirror/registration-marks summary line, a 50 mm scale reference bar, the
  stone layout at true size (mirrored if requested) centered in the printable area, and four corner
  registration marks (if enabled).
* No change to the 2D canvas, cup preview, existing SVG/PNG/Layout-JSON/Project-JSON exports, or
  any generated stone position.

## Required Outcome

The Production Sheet must contain, exactly once each:

* project name, object type (template display name), production size in mm, stone count, stone
  size(s) in mm, gap(s) in mm, crystal color(s), a scale reference (a labeled 50 mm ruler bar with
  10 mm ticks), registration marks (four corner crop-marks, toggleable), and a page/margin/
  mirror/registration-marks summary.
* One page. Millimeter-accurate (the stone layout is drawn at true 1:1 scale — 1 mm of stone
  geometry is exactly 1 mm on the page — never fit-to-viewport-scaled the way the on-screen 2D
  canvas is). Centered automatically within the printable area (page size minus margins). Margins
  are a configurable, non-negative millimeter value.
* SVG, PNG, and PDF output, all generated from **one shared, pure layout computation**
  (`computeProductionSheetLayout()`) driven only by the `StoneLayout` passed in plus plain display
  options — never from a second, independently-computed geometry pass.
* Supports every existing layer type (text, curved text, SVG, circle, rectangle) and every object
  template (mug, tumbler, bottle) *by construction*: the exporter only ever reads `stone.xMm/yMm/
  sizeMm/color` from the `StoneLayout` it is given — it has no branch, string literal, or import
  referencing a layer `type` or a template id, so nothing about a layer/template can fail to be
  "supported".

## Architecture Requirements

* **`StoneLayout` and `GeometryEngine` are not modified.** No new stone position is ever computed
  by this milestone's code; the production sheet only re-projects already-generated `stone.xMm/
  yMm` into page coordinates (translate for centering, optional horizontal mirror, mm→pt for PDF).
  This is the same category of transform `CanvasRenderer2D.fitTransform()` already applies (mm→px
  + translate) — a rendering/export-time coordinate transform, not geometry generation.
* **New exporter modules, `src/export/**` only:**
  * `src/export/PdfDocument.js` — a minimal, dependency-free, single-page vector PDF writer
    (moveTo/lineTo/curveTo/rect/circle/text primitives over the standard, non-embedded Helvetica
    font). Generic: no knowledge of `Stone`/`StoneLayout`/production sheets. Deterministic byte
    output (no timestamps, no random IDs).
  * `src/export/ProductionSheetExporter.js` — `PAGE_SIZES`, `computeProductionSheetLayout()`,
    `productionSheetToSvg()`, `productionSheetToPdf()`. Pure functions; no DOM/Canvas dependency
    (same constraint `SvgExporter.js` already satisfies), no knowledge of `Project`/`Layer`/layer
    `type`.
  * `src/export/SvgExporter.js` gains one small, behavior-preserving refactor: the per-stone
    `<circle>` string is extracted into an exported `stoneCircleSvg()` helper so
    `ProductionSheetExporter.js` reuses it instead of re-implementing the same string template
    (existing `stoneLayoutToSvg()` output is byte-for-byte unchanged; covered by the existing
    RS-0003.5D1/RS-0003.5C2 exact-string tests, which must still pass unmodified).
* **PNG export has no new `src/export/**` module**, consistent with the existing precedent that PNG
  is a browser-side raster *capture*, not a standalone exporter: `app.js` rasterizes the already-
  generated production-sheet SVG string (via an offscreen `Image` + `<canvas>`, at a fixed
  documented DPI so the raster's pixel dimensions are a clean multiple of the mm page size — no
  fit-to-viewport scaling step) and downloads the result. This introduces no new dependency and no
  second drawing implementation.
* **`app.js`** gains: a `project.name` field (+ `defaultProject()`/`validateProject()` defaults),
  the Production Sheet UI wiring, and three guarded, try/catch-wrapped export handlers, following
  the exact existing pattern of the five current export handlers (guard on `layout` present, catch
  and report via `#status`). Page size / margin / mirror / registration-marks are **view/export-
  only options** (like `rotation`/`zoom`) — not part of `project`, not undo/redo-tracked, read live
  from their controls at export-click time.
* **`docs/ARCHITECTURE.md`** gets a small "Implementation status" note under "Exporters" recording
  that Production Sheet (SVG/PNG/PDF) now exists.

## Allowed Files

* `src/export/ProductionSheetExporter.js` (new)
* `src/export/PdfDocument.js` (new)
* `src/export/SvgExporter.js` (extract `stoneCircleSvg()` helper; output unchanged)
* `src/export/README.md`
* `app.js`, `index.html`
* `docs/ARCHITECTURE.md` (implementation-status note only)
* `docs/specifications/RS-1005-ProductionSheetGenerator.md`, `TASK.md`, `TASK_RESULT.md`
* `tools/test-pdf-document.mjs`, `tools/test-production-sheet-exporter.mjs` (new)
* Narrow updates to eleven existing guard tests, each for one specific, documented reason (every
  update follows the same narrow-update precedent RS-0003.5D1/RS-1004 already used for
  `index.html`'s forbidden-file lists) — no guard test's actual behavior is weakened beyond what
  RS-1005 itself legitimately changed:
  * `tools/test-svg-integration.mjs`, `tools/test-undo-redo-integration.mjs`,
    `tools/test-cup-rotation-stabilization.mjs`, `tools/test-ux-visual-polish.mjs`,
    `tools/test-examples-regression.mjs`, `tools/test-object-template-integration.mjs` — remove
    `src/export/` from each's forbidden-prefix list (each previously forbade the whole directory
    wholesale).
  * `tools/test-app-module-migration.mjs`, `tools/test-shape-geometry-integration.mjs` — add
    `ProductionSheetExporter.js` to app.js's approved direct-import allowlist, the same way
    `SvgExporter.js` is already listed (`src/export/**` has no barrel `index.js`, so every file it
    exposes to `app.js` is allowlisted individually).
  * `tools/test-curved-text-integration.mjs`, `tools/test-default-text-layer-editing.mjs` — each
    has its own dedicated, milestone-specific "`src/export/**` untouched" assertion (independent of
    the generic forbidden-prefix mechanism above); both narrowed to name the specific RS-1005 files
    now legitimately touched instead of forbidding the whole directory.
  * `tools/test-svg-integration.mjs`, `tools/test-examples-regression.mjs`,
    `tools/test-default-text-layer-editing.mjs` — each extracts and executes `app.js`'s
    `validateProject()`/`defaultProject()` from a source-text slice; the slice's start point is
    widened to include the new top-level `DEFAULT_PROJECT_NAME` constant those functions now
    reference (previously started later in the file), matching the precedent already used for
    `getObjectTemplate` injection in these same tests.
  * `tools/test-production-export-validation.mjs` — its "every export handler reports failures via
    `#status`" catch-block count is updated from 5 to 8 (the five pre-existing export handlers plus
    RS-1005's three new Production Sheet handlers).
* `package.json` (register the two new test files)

## Forbidden Files

* `src/geometry/**`, `src/renderer/**` (no change needed — production sheet reads `Stone`/
  `StoneLayout` fields directly and reuses `STONE_COLORS`, nothing else)
* `src/text/**`, `src/fonts/**`, `src/browser/**`, `src/core/**`, `src/svg/**`, `src/history/**`,
  `src/products/**`
* `assets/**`, `examples/**`
* `style.css`, `README.md`, `LICENSE`, `CONTRIBUTING.md`
* `node_modules/**`

## Out of Scope

* Multi-page nesting/pagination, automatic stone packing, print-spooler/printer-driver integration,
  color separation — explicitly excluded per the milestone brief.
* A second page size beyond A4/Letter, custom user-defined page dimensions, per-side margins
  (a single uniform margin value is sufficient per "keep margins configurable").
* Embedding a non-standard font in the PDF (Helvetica, a standard PDF font requiring no embedding,
  is sufficient for header/label text — this is a manufacturing cover sheet, not typeset design
  output).
* Full-fidelity international text in the PDF: the minimal PDF writer encodes text as Latin-1
  bytes against the standard font's WinAnsiEncoding; characters outside Latin-1 degrade instead of
  rendering correctly. SVG/PNG output has no such limitation (real Unicode text). Documented as a
  known limitation, not fixed this milestone.
* Migrating `app.js` onto `src/core/Project`/`Layer`, removing legacy dead code — unrelated.

## Required Automated Tests

`tools/test-pdf-document.mjs` (generic PDF writer, no production-sheet knowledge):
1. `toBytes()` output starts with `%PDF-1.4` and ends with `%%EOF`.
2. The xref table's byte offsets are correct: for every non-free entry, the bytes at that offset in
   the document actually begin with `"<n> 0 obj"` for the matching object number.
3. `/MediaBox` matches the requested `widthPt`/`heightPt`.
4. Two documents built from identical draw calls produce byte-identical output (determinism — no
   timestamp/ID varies between runs).
5. Two documents built from different draw calls produce different output (not hardcoded).
6. Drawing a circle emits four Bézier `c` operators and a fill/stroke operator; drawing text emits
   a `BT`/`Tf`/`Tj`/`ET` sequence with the (Latin-1-encoded) string content present in the stream.

`tools/test-production-sheet-exporter.mjs`:
1. `computeProductionSheetLayout()` throws a clear `TypeError`/`RangeError` for: missing/malformed
   `stoneLayout`; non-positive/non-finite `productionWidthMm`/`heightMm`; unknown `pageSize`;
   negative/non-finite `marginMm`; a production size that does not fit the printable area in either
   orientation of the chosen page size (message names the page size and orientation tried).
2. Deterministic output: `productionSheetToSvg()` and `productionSheetToPdf()` each produce
   byte-identical output for two calls with equivalent `StoneLayout`s + options; different inputs
   (different stone position, different `projectName`, different `pageSize`, different `mirror`)
   each produce different output.
3. Stone count / stone size(s) / crystal color(s) in the header are derived from
   `stoneLayout.stones`, not passed in — verify by holding options constant and only changing
   stones.
4. Registration marks: with `registrationMarks:true` exactly four corner marks are present at the
   expected coordinates (derived from the computed production-rect placement); with `false`, none
   are present, and nothing else in the output changes.
5. Mirror mode: with `mirror:true`, every stone's page-space X is `productionRectLeftMm +
   (productionWidthMm - stone.xMm)`; with `false`, `productionRectLeftMm + stone.xMm`. Y is
   unaffected. Stone count/order/size/color unaffected.
6. Page sizes: A4 vs Letter produce different page pixel/point/mm dimensions in both SVG (root
   `width`/`height`/`viewBox`) and PDF (`/MediaBox`), and orientation is chosen automatically
   (landscape) when a template's production size does not fit the chosen page in portrait.
7. Margins: increasing `marginMm` shrinks the printable area and shifts the centered production
   rect accordingly (assert the exact computed `productionRectLeftMm`/`productionRectTopMm` for at
   least two different margin values); a margin large enough to make the layout not fit throws the
   same clear error as case 1.
8. SVG output: exactly one `<circle>` per stone, each with correct `cx`/`cy`/`r`/`data-color`
   (reusing/matching `SvgExporter.js`'s existing circle format), well-formed root `<svg>` with
   explicit mm `width`/`height`/`viewBox` at the *page* size (not the production size).
9. PDF output: valid per `test-pdf-document.mjs`'s structural checks; content stream contains one
   circle per stone (four `c` operators + fill operator, grouped) and the expected count of text
   draws for the header lines.
10. **All object templates**: for every id in `OBJECT_TEMPLATE_IDS` (`src/products/index.js`), at
    that template's own `productionWidthMm`/`heightMm`, `computeProductionSheetLayout()` succeeds
    for both A4 and Letter at the default margin, and the header's object-type text matches the
    template's `displayName`.
11. **All layer types**: build real `StoneLayout`s via the permanent `GeometryEngine` (same
    `buildPermanentEngine()` pattern already used in `tools/test-object-template-integration.mjs`)
    for a text layer, a curved-text layer, an SVG layer, a circle layer, and a rectangle layer;
    merge their stones into one combined layout (concatenation only — no dedupe invented, matching
    `app.js`'s own merge semantics); feed the merged layout through `productionSheetToSvg()` and
    `productionSheetToPdf()`; assert no throw and that the SVG's `<circle>` count equals the
    merged stone count. This is the concrete proof that "every layer type is supported" — the
    exporter never branches on layer type, so a merged layout spanning all five is handled
    identically to any other `StoneLayout`.
12. Architecture guard: `ProductionSheetExporter.js`, `PdfDocument.js` source contains no reference
    to `GeometryEngine`, `generateTextLayout`, `generateShapeLayout`, `generateSvgLayout`, a layer
    `type`, or `Project`/`Layer`.
13. `stoneLayoutToSvg()`'s existing exact-byte-format tests still pass unmodified after the
    `stoneCircleSvg()` refactor (run as part of `npm test`, not reimplemented here).
14. Structural checks on `app.js`/`index.html`: `#projectName` input exists and round-trips through
    `defaultProject()`/`validateProject()` (missing `name` on import defaults to `'Untitled
    Project'`, present `name` is preserved); `#prodSheetPageSize`/`#prodSheetMargin`/
    `#prodSheetMirror`/`#prodSheetRegMarks` controls and `#exportProdSheetSVG`/
    `#exportProdSheetPNG`/`#exportProdSheetPDF` buttons exist; all three handlers guard on `layout`
    and are wrapped in `try`/`catch` reporting via `#status`, matching the five existing export
    handlers' pattern.
15. No forbidden file changed (this milestone's own list, from `git status --porcelain`).

Update the six existing guard tests' forbidden-file lists as described above (remove `src/export/`
from each, add a one-line comment pointing at this milestone, same as every prior narrow update).

Run the full suite (`npm test`) and confirm every prior suite still passes unmodified.

## Required Browser Verification

Run `npm run dev` and drive `http://localhost:5173/` with a real headless-Chrome session
(Puppeteer over CDP, matching the established project precedent — not source reading):

* [ ] Page loads, zero console errors/warnings during the whole sequence below.
* [ ] Default project (mug, text layer): export Production Sheet SVG; open it; verify project
      name, object type "Mug", production size "210 × 90 mm", correct stone count, stone size,
      crystal color, scale bar, and (default on) four registration marks are all present.
* [ ] Toggle Mirror on; export SVG again; verify at least one stone's X coordinate moved to its
      mirrored position relative to the un-mirrored export.
* [ ] Toggle Registration marks off; export SVG again; verify no registration-mark elements appear.
* [ ] Switch object type to Tumbler, then Bottle; export Production Sheet SVG each time; verify
      object type / production size update correctly and export succeeds with zero console errors.
* [ ] Add a circle layer, a rectangle layer, and import one SVG layer (alongside the default text
      layer, and toggle curved text on for the text layer); export Production Sheet SVG; verify the
      circle count in the exported SVG matches the on-screen stone count across all visible layers.
* [ ] Page size: export with A4 selected, then with Letter selected; verify the two SVGs report
      different page `width`/`height`.
* [ ] Export Production Sheet PNG; verify a real, non-trivial `image/png` blob downloads with zero
      console errors.
* [ ] Export Production Sheet PDF; verify a real, non-trivial `application/pdf` blob downloads
      (inspect the first bytes for `%PDF-`) with zero console errors.
* [ ] No uncaught exception / unhandled rejection during any of the above (explicitly instrumented
      via the page's `console`/`pageerror` events, not inferred).

Record actual observed values (stone counts, byte sizes, header text) in `TASK_RESULT.md`. Do not
claim unperformed interactive checks as passing.

## Acceptance Criteria

* `npm test` passes, including both new suites and every pre-existing suite unmodified.
* Production Sheet SVG/PNG/PDF are all generated from one shared pure layout computation driven
  only by `StoneLayout` + plain display options; no new stone geometry is invented anywhere.
* Every required header field is present and accurate; registration marks and mirror are correctly
  toggleable; page size and margins are configurable and validated with clear errors when the
  layout cannot fit without scaling.
* `StoneLayout.js`/`GeometryEngine.js` are byte-for-byte unchanged.
* No forbidden file changed; no unrelated refactor.
* `TASK_RESULT.md` accurately reports what was verified vs. not, including the documented Latin-1
  PDF text-encoding limitation.

## Implementation Constraints

* Smallest coherent change; no unrelated refactor of `app.js`, renderers, or geometry.
* Preserve millimeters throughout the layout computation; convert to points only inside
  `PdfDocument.js`'s own drawing primitives, and only PDF-ward (never back).
* Do not add a bundler, framework, or dependency (no jsPDF/pdf-lib/CDN).
* Do not change `StoneLayout`'s or `Stone`'s schema, or `stoneLayoutToSvg()`'s existing output byte
  format.
* Do not silently rescale a production sheet that doesn't fit its page — fail with a clear error
  instead ("no scaling" is a hard product requirement, not a soft default).

## Required Commands

```bash
npm test
git diff --check
git status
npm run dev
```

## Commit Message

```
feat(export): add mm-accurate Production Sheet export (SVG/PNG/PDF)
```

## Deliverables

* `src/export/ProductionSheetExporter.js`, `src/export/PdfDocument.js` (new);
  `src/export/SvgExporter.js` (`stoneCircleSvg()` extraction); `src/export/README.md` updated.
* `app.js` (`project.name`, Production Sheet UI wiring, three guarded export handlers);
  `index.html` (Project name input; Production Sheet controls/buttons).
* `docs/ARCHITECTURE.md` (implementation-status note).
* `tools/test-pdf-document.mjs`, `tools/test-production-sheet-exporter.mjs` (new); six guard tests'
  forbidden-file lists narrowly updated; `package.json` test script updated.
* This specification, `TASK.md`, `TASK_RESULT.md`.

## Next Milestone

Candidates: DXF export; multi-page nested production sheets for large runs; per-side margins;
custom page sizes; embedding a Unicode-capable font in the PDF writer; consolidating the
cross-layer `dedupe()` merge step into `src/geometry/GeometryEngine.js`; migrating `app.js` onto
`src/core/Project`/`Layer`.
