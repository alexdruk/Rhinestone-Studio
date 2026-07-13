# Rhinestone Studio — Task Result

This document is completed by the implementation engineer after finishing the current task.

---

# Task ID

RS-1011 — Fill Algorithms

---

# Status

IMPLEMENTED

---

# Branch

feature/rs-1011-fill-algorithms

---

# Commit

Do not write the current commit hash into this file — this file is part of the same commit it
describes. Obtain it from Git history with:

```bash
git log -1 --oneline
```

---

# Summary

Audit-first, per the milestone brief. Before writing any code, `GeometryEngine`, `StoneSampler.js`,
every `generate*Layout()` call site in `app.js`, `index.html`'s existing fill-mode controls, and
`PathBoolean.js` were read against the "add Outline/Grid/Staggered/Radial/Contour Fill" feature
list. Findings (full detail in `docs/specifications/RS-1011-FillAlgorithms.md`):

* **Outline and Grid Fill already existed**, shared by every vector layer type (text/curved text/
  circle/rectangle/svg/path) through `sampleOutlinePoints()`/`sampleFillPoints()`. The stored mode
  value `'fill'` already **was** "Grid Fill" exactly as specified (regular grid, deterministic,
  `spacingMm = stoneSizeMm + gapMm`) — it needed a clearer UI label, not a reimplementation.
* **Staggered, Radial, and Contour Fill did not exist anywhere.** This is the genuinely new
  geometry capability.
* **Circle/rectangle/path layers had no fill-mode control at all** — `app.js` hard-coded
  `mode:'outline'` for all three, despite `GeometryEngine.generateShapeLayout()`/
  `generatePathLayout()` already accepting a `mode` parameter. Text (`textMode`) and SVG (`mode`)
  already had working, narrower (outline/fill-only) controls.
* **Image Trace had no `mode` parameter at all** — always raster-filled, with no outline concept (a
  density field has no vector perimeter).
* **Holes/multi-contour/bounds were already handled once**, centrally, by
  `isPointInsidePolygons()`'s even-odd rule (vector) and the field-threshold lookup (raster). No
  second containment implementation was introduced for the new modes.
* **No polygon-offset ("inward contour") algorithm existed.** `PathBoolean.js` combines two shape
  *sources*; it has no notion of eroding one shape inward by a distance. This is Contour Fill's one
  new primitive.
* **No renderer or exporter branches on fill mode** (`sourceMode`) at all — confirmed by grep and
  by a new automated check (`tools/test-fill-algorithms-integration.mjs`, test 16). No
  renderer/exporter file needed to change.

**What was built**, all inside `src/geometry/**`, reached only through `GeometryEngine`:

* `src/geometry/ContourRingSampler.js` (new) — a distance-transform (two-pass chamfer,
  approximate-Euclidean) + marching-squares (16-case, same textbook table `PathBoolean.js` uses,
  independently implemented so RS-1012A's precision-tuned tracer is never touched) inward-ring
  tracer, generic over any "is this point inside" test.
* `src/geometry/StoneSampler.js` gained `sampleStaggeredFillPoints()`/`sampleRadialFillPoints()`/
  `sampleContourFillPoints()` (vector) and their `...FieldFillPoints()` counterparts (raster, for
  Image Trace), a shared `sampleShapeFillPoints()`/`sampleFieldByMode()` dispatcher (replacing four
  near-identical `mode==='fill'?...:...` ternaries in `GeometryEngine.js` with one call each), and
  `dedupeStonePoints()` (a grid-hash proximity filter, same shape as `app.js`'s pre-existing
  cross-layer `dedupe()`, generalized).
* Staggered Fill uses the standard hexagonal-packing row spacing (`spacingMm * sqrt(3)/2`) derived
  from the one existing pitch value — not a second spacing formula.
* Radial Fill's ring step-count uses an **exact chord-length formula** (`n = floor(pi /
  asin(spacingMm / (2r)))`), not the naive `round(circumference / spacingMm)` I tried first — the
  naive version's *arc*-length target left the actual straight-line (chord) distance between
  neighboring stones measurably under `spacingMm` (measured: 2.202mm vs. a 2.3mm target on a test
  circle). The chord-exact formula closed that gap to zero, verified by direct measurement (see
  Precision below).
* Contour Fill's outermost ring reuses the *exact*, unmodified outline geometry
  (`sampleOutlinePoints()` on the real polygon) — zero raster approximation on the ring most visible
  to the eye; only inward rings (`k>=1`) are distance-field-derived.
* `GeometryEngine.js`: `SAMPLE_MODES` extended to `{outline, fill, staggered, radial, contour}`
  (`'fill'`'s stored meaning/output unchanged); `generateImageLayout()` gained its first `mode`
  parameter (default `'fill'`, `IMAGE_SAMPLE_MODES` excludes `'outline'`).
* `app.js`: new `resolveTextFillMode()`/`resolveVectorFillMode()`/`resolveImageFillMode()` helpers
  (permissive fallback to each layer type's pre-RS-1011 default for any unknown/missing value); a
  new optional `fillMode` field on circle/rectangle/path layers (default `'outline'`) and image
  layers (default `'fill'`); `textMode`/`mode` (svg) widened to the same 5-value (4 for image) enum
  in place, no field renamed.
* `index.html`: one "Fill Style" control per layer-type Lightbox — `#textMode`/`#svgMode` extended
  in place with 3 new `<option>`s each (relabeled: "Grid Fill", "Staggered Fill", "Radial Fill",
  "Contour Fill"); new `#shapeFillMode` (Shapes Lightbox, circle/rectangle/path — the one genuinely
  new control) and `#imageFillMode` (Image Trace Lightbox, no Outline option). No secondary controls
  (grid angle/radial center/contour spacing) were added: Radial Fill's center is always the shape's
  own bounding-box center (always well-defined); Contour Fill's ring spacing is always the same
  stone pitch every mode uses — a separate "contour spacing" field would itself be the forbidden
  second spacing formula.

**Two real bugs were caught by the new automated tests before this milestone was considered done**
(not found by inspection alone):
1. `sampleContourFillPoints()`/`sampleContourFieldFillPoints()` accumulated points via
   `points.push(...bigArray)` — for a shape large relative to a very fine stone pitch this
   overflowed the JS call stack (`RangeError: Maximum call stack size exceeded`). Fixed by switching
   to the one-by-one accumulation `GeometryEngine.generateSvgLayout()` already documents and uses
   for the identical reason.
2. Radial Fill's original `round(circumference/spacingMm)` step count let the actual chord distance
   between neighboring stones fall to ~96% of the configured pitch. Replaced with the exact
   chord-length formula above.

---

# Architecture Summary

`GeometryEngine` remains the single authority for stone placement; every fill mode is reached only
through its `generate*Layout()` methods; `StoneLayout`/`Stone` are unchanged; no renderer or
exporter contains fill logic or branches on `sourceMode`; no parallel fill engine exists.
`ContourRingSampler.js` is a new, narrowly-scoped file (not a refactor of `PathBoolean.js`'s private
tracer) so RS-1012A's precision-tuned boolean-operation code is never at risk. See
`docs/specifications/RS-1011-FillAlgorithms.md` for the full architecture writeup, including why a
new tracer file (not a shared one) was the right call.

---

# Implementation Summary

See Summary above and the specification's "Required Outcome"/"Architecture" sections. In one
sentence: every vector layer type now supports all 5 modes through one shared dispatcher, Image
Trace supports the 4 that make sense for a raster field, and the one new geometry primitive
(Contour Fill's inward-ring tracer) is isolated in its own file, reusing only the pre-existing
even-odd interior test.

---

# Supported Mode x Layer-Type Matrix

| Layer type               | Outline | Grid Fill | Staggered Fill | Radial Fill | Contour Fill |
|---------------------------|:-------:|:---------:|:---------------:|:------------:|:-------------:|
| Text (incl. Curved Text)  |    Y    |     Y     |        Y        |      Y       |       Y       |
| Circle                    |    Y    |     Y     |        Y        |      Y       |       Y       |
| Rectangle                 |    Y    |     Y     |        Y        |      Y       |       Y       |
| Imported SVG              |    Y    |     Y     |        Y        |      Y       |       Y       |
| Boolean/path layers       |    Y    |     Y     |        Y        |      Y       |       Y       |
| Image Trace               |    N    |     Y     |        Y        |      Y       |       Y       |

Image Trace has no Outline option — a raster density field has no vector perimeter to walk
(pre-existing since RS-1008/RS-1008A, unchanged). The UI hides that option for Image Trace rather
than offering a control that would throw.

---

# Precision and Spacing Measurements

Measured directly (`tools/test-fill-algorithms.mjs`, tests 5–8, 12), not visually inspected:

* **Minimum center-to-center spacing**, a 20mm-radius circle and a 50x30mm rectangle,
  `stoneSizeMm=2, gapMm=0.3` (pitch 2.3mm): Grid Fill 2.300mm, Staggered Fill 2.300mm, Radial Fill
  2.300mm (after the chord-formula fix; was 2.202mm before it), Contour Fill 2.300mm. All four meet
  or exceed the configured pitch exactly (`dedupeStonePoints()`'s guarantee); Outline mode's own
  pre-existing arc-vs-chord characteristic (1.30–1.43mm on these same shapes) is unchanged by this
  milestone and out of scope (see spec's "Known Limitations" — this is not a regression, it is
  Outline mode's byte-identical pre-existing behavior).
* **Overlap count:** 0 in every mode — the 2.300mm floor above is comfortably above the 2.0mm stone
  diameter, so no two stones' physical footprints (diameter `stoneSizeMm`) ever overlap.
* **Duplicate-stone count:** 0 in every mode (exact-coincidence check, tolerance 1e-6mm).
* **Boundary containment:** every sampled point passes the same interior test (`isPointInsidePolygons`/
  field threshold) every other mode already uses; no out-of-bounds stones observed in any test or
  browser check.
* **Hole preservation:** 0 stones inside a test hole (a 40x40mm square with a 10x10mm square hole,
  and a raster donut field) for Grid/Staggered/Radial/Contour Fill, vector and raster.
* **Determinism:** identical serialized stone sets across two independent runs with identical input,
  every mode, vector and raster.
* **Gap handling:** increasing `gapMm` from 0.2 to 1.5mm (stoneSizeMm fixed at 2) strictly widens the
  achieved minimum spacing and strictly reduces stone count, for every fill mode — one spacing
  formula, not two.
* **Save/load stability:** verified in the browser (see below) — a saved Project JSON's `fillMode`/
  `mode`/`textMode` fields round-trip through Import Project JSON and regenerate identical geometry.

---

# Performance Measurements

Representative cases (`tools/test-fill-algorithms.mjs`, test 15), each asserted under 5 seconds
(all completed in well under 1 second on this machine): a 210x90mm rectangle at Contour Fill and
Staggered Fill (production-canvas scale), a 45mm-radius circle at Radial Fill, a 100x100mm placed
Image Trace at Contour Fill (200x200px source), and short text at Contour Fill. A deliberately
pathological case (a 4000x4000mm rectangle at a 0.0011mm stone pitch) fails fast with a specific,
actionable `ContourFillPrecisionError` rather than freezing, exercising
`ContourRingSampler.js`'s grid-cell budget fail-safe.

---

# Files Changed

**New:**
* `src/geometry/ContourRingSampler.js` — distance-transform + marching-squares inward-ring tracer
  for Contour Fill.
* `docs/specifications/RS-1011-FillAlgorithms.md` — full specification and audit.
* `tools/test-fill-algorithms.mjs` (16 assertions) — engine-level: every mode x every vector layer
  type + Image Trace, precision/overlap/duplicate/hole/determinism/gap/fail-safe/performance
  measurements, forbidden-file guard.
* `tools/test-fill-algorithms-integration.mjs` (19 assertions) — UI wiring (Fill Style controls per
  Lightbox), the 5 `generate*StonesLive()` call sites' resolver usage, sync/write round-trip,
  history-tracking, duplicate/save-load genericity, `validateProject()` permissiveness, no
  renderer/exporter branches on `sourceMode`, real SVG/Production-Sheet export against the new
  modes, forbidden-file guard.
* `TASK_RESULT.md` (this file).

**Modified:**
* `src/geometry/StoneSampler.js` — new staggered/radial/contour vector + field samplers,
  `sampleShapeFillPoints()`/`sampleFieldByMode()` dispatchers, `dedupeStonePoints()`.
* `src/geometry/GeometryEngine.js` — `SAMPLE_MODES`/`IMAGE_SAMPLE_MODES`; all `mode` dispatch sites
  now call the shared dispatchers; `generateImageLayout()`/`normalizeImageParams()` gain `mode`.
* `src/geometry/index.js` — exports the new sampler functions, `computeInwardRingPolygons()`,
  `ContourFillPrecisionError`.
* `app.js` — `resolveTextFillMode()`/`resolveVectorFillMode()`/`resolveImageFillMode()` helpers; all
  5 `generate*StonesLive()` methods resolve mode through them instead of a hard-coded value or a
  narrow ternary; `syncSelectedControlsFromLayer()`/`writeSelectedControlsToLayer()` read/write the
  new `#shapeFillMode`/`#imageFillMode` controls; `HISTORY_TRACKED_CONTROL_IDS` extended.
* `index.html` — `#textMode`/`#svgMode` gain 3 new `<option>`s each (relabeled); new
  `#shapeFillModeField`/`#shapeFillMode` (Shapes Lightbox) and `#imageFillMode` (Image Trace
  Lightbox) field-sections.
* `docs/ARCHITECTURE.md` — updated the two stale "mode is always outline"/"app.js never requests
  fill" sentences in the shape/SVG generation-flow sections; new Layer map row for
  `ContourRingSampler.js`.
* `package.json` — `test` script registers the two new test files.
* `TASK.md` — replaced with this milestone's brief.
* Nine pre-existing milestones' own forbidden-file guards (`tools/test-alignment-snapping-
  integration.mjs`, `tools/test-alignment-snapping-upgrade.mjs`, `tools/test-path-boolean-
  integration.mjs`, `tools/test-preview3d-integration.mjs`, `tools/test-production-sheet-
  exporter.mjs`, `tools/test-ui001b-fixes.mjs`, `tools/test-variable-stone-sizes.mjs`) — each
  extended with the same `allowedDespitePrefix`/`forbiddenExactWithinPrefix` exception for
  `src/geometry/ContourRingSampler.js` (and, where not already present, `StoneSampler.js`),
  following this codebase's established convention (documented in those same files) of amending an
  older milestone's own guard when a later, legitimate milestone touches a previously-forbidden
  file. `tools/test-shape-geometry-integration.mjs`/`tools/test-svg-integration.mjs`/`tools/
  test-path-boolean-integration.mjs` also had one outdated literal-source-match assertion each
  updated for the new `resolveVectorFillMode(...)`/`resolveImageFillMode(...)` call shape (the
  underlying behavior they check — mode forwarded to the permanent engine — is unchanged in intent,
  only widened).

**Untouched (verified, not modified):** every renderer (`CanvasRenderer2D.js`, `CupRenderer.js`,
`StoneLayoutTexture.js`), every exporter (`SvgExporter.js`, `ProductionSheetExporter.js`,
`PdfDocument.js`), `Stone.js`, `StoneLayout.js`, `ContourGeometry.js`, `ArcProjection.js`,
`PathBoolean.js`, `src/text/**`, `src/fonts/**`, `src/core/**`, `src/browser/**`, `src/svg/**`,
`src/image/**`, `src/history/**`, `src/products/**`, `src/preview3d/**`, `src/editing/**`,
`src/ui/**`, `assets/**`, `examples/**`, `style.css`.

---

# Test Results

```
npm test
```

All 57 test suites pass (55 pre-existing + 2 new), including every pre-existing suite with an
updated forbidden-file guard or literal-match assertion.

---

# Browser Verification

Performed with Playwright's bundled Chromium (headless), launched via `launchPersistentContext()`
against a freshly created temporary `--user-data-dir` (deleted with the OS temp directory; never
touched the user's real Chrome installation, any window named "main"/"airbnb", or any existing
profile), against a local `python3 -m http.server 5173` instance serving the repo. Both the browser
context and the local server were the only things started and stopped this session.

Verified, with 17 screenshots and a full console-error listener attached for the entire session:

* **Text** — cycled Outline/Grid/Staggered/Radial/Contour Fill via `#textMode`; stone count changed
  each time (375/117/136/131/151 stones on the default "Vitalina Serbin" text).
* **Curved Text** — enabled curve (360° sweep, outside, 40mm radius) + Contour Fill together: 223
  stones, wrapped in a full circle, rendered correctly on both the 2D canvas and the "Fill Style"
  label read "Contour Fill - rings that follow the letters inward".
* **Circle / Rectangle** — added both via the Shapes Lightbox, cycled all 5 modes via the new
  `#shapeFillMode` (previously no fill-mode control existed for these types at all); counts varied
  correctly per mode (e.g. rectangle: 536/762/803/739/642).
* **Boolean/path layer** — ran a real Union on two shape layers via the Shapes Lightbox's Boolean
  Operations section, producing a `path` layer; cycled all 5 modes on it via the same
  `#shapeFillMode` control, counts varied correctly.
* **Imported SVG** — imported a real SVG file (`setInputFiles`), cycled all 5 modes via `#svgMode`.
* **Image Trace** — imported a real PNG (an in-page-rendered donut/ring shape with a genuine hole),
  confirmed `#imageFillMode` offers exactly 4 options (no Outline) with clear labels, cycled Grid/
  Staggered/Radial/Contour Fill. In the full combined project the displayed total stone count barely
  moved between image fill modes — investigated and confirmed this is the pre-existing, unrelated
  cross-layer proximity dedupe in `app.js`'s `generate()` masking a small layer's contribution to a
  large combined total, not a bug: re-tested the same image layer in isolation (only layer in the
  project) and got 20/24/12/10 stones for fill/staggered/radial/contour respectively — clearly
  distinct, matching the engine-level test results.
* **Shape with a hole** — the Union-result `path` layer above; also confirmed via the donut-shaped
  Image Trace import.
* **Mixed stone sizes** — verified at the engine-test level (`tools/test-fill-algorithms.mjs`, test
  11) across every new mode; the existing Stone Library `#stoneSize` picker continued working
  unchanged throughout every scenario above.
* **Changing fill style** regenerates geometry immediately (no manual refresh needed) in every case
  above, on both the 2D canvas and the live Object Preview.
* **Undo/redo** — cycling a rectangle's fill mode, Undo restored the previous stone count exactly,
  Redo restored the post-change count exactly.
* **Duplicate** — layer count went from 3 to 4, the duplicate carrying its own fill mode.
* **Save/load** — exported Project JSON, inspected it directly (`fillMode`/`mode`/`textMode` fields
  present: `["stroke","contour","contour","contour"]` for the layers at that point), then imported
  it back via Import → Project Import; the layout regenerated to the same stone count.
* **Align & Snap** — selected 2 layers, clicked Align Left; completed with the normal
  "Aligned 2 layers to left edges" status message, no crash — confirms fill-style changes did not
  disturb this pre-existing feature.
* **Dual Workspace** — both the 2D Canvas and the real WebGL Object Preview panel show the same
  generated layout side by side, kept in sync across every fill-style change above.
* **Exports** — triggered the real `Export SVG`, `Export PNG`, and `Production Sheet -> SVG` buttons
  (not just calling the exporter functions directly); all three produced real downloads with no
  errors, across a project containing every new fill mode and multiple layer types.
* **Responsive layout** — checked at 1600x1000 and 1280x800; no clipping/overlap in the new Fill
  Style controls, no hidden settings below the fold in any Lightbox.
* **Console/page errors:** zero, for the entire session (no favicon 404 was even observed, since a
  local dev server without a favicon file simply serves 404 silently without a console entry in this
  setup — confirmed no other errors of any kind).

---

# Known Limitations

* Radial Fill's center is always the shape's own bounding-box center (not user-configurable) — see
  the specification's "Out of Scope" section for the rationale (always well-defined, needs no
  override control, avoids a new per-layer field).
* Contour Fill's distance transform is an approximate (chamfer) Euclidean distance, not exact; the
  grid resolution (`spacingMm/8`, clamped 0.05–1mm) bounds this error to well under 12.5% of one
  stone pitch — measured directly in the new tests, not merely asserted.
* Outline mode's own pre-existing arc-vs-chord characteristic (a straight-line stone spacing
  slightly under its own arc-length target on curved outlines) is unchanged by this milestone — it
  predates RS-1011 and was explicitly out of scope ("existing outline behavior must remain
  compatible").
* `src/core/Layer.js`/`Project.js` remain unused by the live application — a pre-existing, documented
  gap (see RS-1009/RS-1010/RS-1012/RS-1013's own specs) this milestone did not need to close.

---

# Recommendation

**APPROVED FOR REVIEW**

---

# Next Recommended Step

None required for this milestone. Optional future follow-up: a user-configurable Radial Fill center
override, if a real design need for an off-center radial pattern surfaces.
