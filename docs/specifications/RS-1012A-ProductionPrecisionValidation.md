# RS-1012A — Production Precision Validation for Vector Boolean Operations

## Objective

RS-1012 shipped Vector Boolean Operations (Union/Subtract/Intersect/Exclude) on a raster-assisted
engine (`src/geometry/PathBoolean.js`). This milestone is not a feature expansion: it audits and
*measures* that engine's production accuracy, fixes anything the measurements show is wrong, adds
adaptive resolution where the data justifies it, adds a fail-safe against silently returning
low-quality geometry, and documents the result well enough for a manufacturing decision.

## Audit Findings

The audit built a real measurement harness (`tools/measure-boolean-precision.mjs`, not part of
`npm test` — a report generator, matching the existing `tools/generate-example-baselines.mjs`
precedent) rather than estimating, per the milestone brief. Running it against the as-shipped
RS-1012 code surfaced two real problems, not just measurement numbers:

### 1. A real correctness bug: cascading simplification could break a contour

`PathBoolean.js`'s vertex-simplification pass measured each traced boundary point only against its
*original* immediate neighbors (three-point local test). On a smooth curve at fine grid resolution,
any three consecutive points are nearly collinear (the sagitta over a short arc is far smaller than
the simplification tolerance), so nearly every point looked *individually* safe to drop — but
dropping them independently, without tracking what had already been approximated, let error
compound silently across a long run.

Measured concretely: two concentric circles (radius 10mm/8mm, XOR — i.e. an annulus/ring), at the
grid resolution their combined bounding box produces (~0.09mm cells), collapsed from a 65-point
flattened circle down to a **degenerate 3-point shape covering only half the outer circle**. The
resulting "annulus" area was off by up to **453%** in the affected radius ranges (see the
before/after numbers below) — not a rounding error, a broken shape. This is exactly the class of bug
the ticket asked this milestone to find: it would have shipped a self-intersecting or truncated
contour into a customer's manufacturing file with no error or warning.

**Fix:** replaced the neighbor-only pass with an anchor-based greedy simplification (an
"Opheim"-style forward scan): a fixed anchor point is kept, and every point up to the current
candidate is validated against the line from that anchor to the candidate; the anchor only advances
when a skipped point would exceed the tolerance. Every dropped point's deviation is always measured
against the line it will actually be approximated by, so error cannot compound. See
`simplifyContour()` in `src/geometry/PathBoolean.js` for the implementation and a fuller writeup of
the failure mode in its doc comment.

Before/after on the same annulus test case (`tools/measure-boolean-precision.mjs`, section 2/3):

| outer/inner radius | before (broken) | after (fixed) |
|---|---|---|
| 20mm / 15mm | 44.9% area error | 0.32% |
| 10mm / 8mm | 103.7% area error | 0.14% |
| 5mm / 4mm | 355.3% area error | 0.50% |
| 3mm / 2.5mm | 453.2% area error | 1.92% |

The 8-circle repeated-union stability test (see "Repeated/Chained Boolean Stability" below) was
affected by the same bug even more severely (up to 82.7% cumulative area error, and a
left-to-right vs right-to-left fold producing 3 contours vs 1 — i.e. disagreeing on whether the
shape was even connected). After the fix, both dropped to well under 1%.

### 2. Resolution was bounding-box-driven only, with no stone-pitch or feature-size awareness

The original grid resolution was a single function of the two shapes' *combined* bounding box. This
has two real production consequences, both measured:

* **A small detail sharing an operation with a much larger shape got the larger shape's (coarser)
  resolution.** Measured: a 50×50mm square with a shrinking circular cutout reliably preserved
  cutouts down to ~0.25mm radius (worst case across grid-alignment phase — see below) — governed
  entirely by the square's own resolution, unrelated to how small the cutout itself was.
* **Resolution had no relationship to the actual stone pitch the result would be sampled at.** A
  design using very fine stones (e.g. 1mm + 0.1mm gap) got the same resolution as one using coarse
  stones (6mm + 0.5mm gap), at a given document size.

Neither of these was a *bug* — the original resolution was already sub-millimeter and well below
typical stone size at normal design scale (see "Precision Requirements" below) — but both are
exactly the gaps the milestone brief's "Adaptive Precision" section asks about, and the measured
narrow-bridge/tiny-cutout thresholds gave a concrete, data-backed reason to close them (see
"Adaptive Precision" below).

### Grid-alignment sensitivity (a measurement-methodology finding, not a bug)

An early version of the narrow-bridge/tiny-cutout measurement tested only bridge/cutout *size* and
found "features survive down to 0.03mm" — misleadingly optimistic. Re-testing the *same* sizes at
several sub-cell grid-alignment offsets ("phases") showed preservation is not purely a function of
feature size: a feature can happen to land on a grid sample row/column and survive, or miss every
sample and vanish, depending on its exact position, not just its width. All precision-threshold
numbers in this document are **worst-case across 8 tested alignment phases**, not best-case — this
is what makes them trustworthy for a manufacturing decision rather than an artifact of one lucky
test layout.

## Precision Requirements — Measured Results

All numbers from `tools/measure-boolean-precision.mjs` (full output archived with this branch),
run against the real, imported `src/geometry/index.js` module — not synthetic/idealized shapes —
using `GeometryEngine.resolveShapePolygons()` for circles/rectangles exactly as the live app does.

**Area error vs. exact closed-form analytic area** (rectangles: exact geometry; circles: the
standard circle-circle intersection formula), at production scale (60×40mm rectangles; r=20mm
circles, 24mm apart):

| Operation | Rectangle area error | Circle area error | Circle max boundary deviation |
|---|---|---|---|
| Union | 0.169% | 0.169% | 0.156mm |
| Intersect | 0.168% | 0.168% | 0.150mm |
| Subtract | 0.168% | 0.168% | 0.156mm |
| Exclude | 0.178% | 0.178% | 0.156mm |

All four operations, across both shape types, stay **well under 1% area error** and **under 0.16mm
maximum boundary deviation** at production scale (2mm+0.3mm stones are the app default — 0.16mm is
~7% of stone diameter, well inside placement tolerance).

**Hole preservation** (annulus, outer XOR inner circle, after the simplification fix): 0.14–1.92%
area error across ring widths from 5mm down to 0.5mm; every case correctly produced 2 contours
(outer boundary + hole) with the center reading as a hole under an even-odd test.

**Narrow bridge preservation** (two 20×20mm squares joined by a shrinking bridge, worst case across
8 alignment phases, ~70mm combined span): reliably connected at bridge widths **≥0.35mm**; unreliable
at ≤0.25mm.

**Tiny cutout preservation** (50×50mm square minus a shrinking circular cutout, worst case across 8
alignment phases): with the adaptive (feature-size-aware) resolution this milestone added, reliably
preserved down to **≥0.07mm** radius (up from ≥0.25mm pre-adaptive — see "Adaptive Precision"),
with area error under 0.01% at every preserved size.

**Repeated/chained boolean stability** (8 overlapping circles, unioned left-to-right vs.
right-to-left): 0.28% area disagreement between fold orders (both producing the same single
connected contour) — after the simplification fix; pre-fix this was 2.23% and the two fold orders
disagreed on contour *count* (3 vs. 1).

**Timing** at production scale: a 20mm-circle union ~20ms; a full 210×90mm mug-wrap-canvas-scale
rectangle union ~5ms; an 800×600mm production-sheet-scale union ~50ms. All comfortably interactive.

## Adaptive Precision

**Decision: yes, adaptive resolution was implemented**, based directly on the measured tiny-cutout
threshold improving from ≥0.25mm to ≥0.07mm (a ~3.5× improvement) with negligible added cost at
normal design scale, and because the milestone brief explicitly asks resolution to scale with stone
size, gap, document size, and feature size — the pre-existing bounding-box-only sizing satisfied
only "document size."

**Implementation** (`computeAdaptiveCellSizeMm()` in `src/geometry/PathBoolean.js`): the grid cell
size is now the *finest* (smallest) of:

1. The existing bounding-box-proportional baseline (`combinedSpanMm / 220`) — document size.
2. `smallerShapeDiagonalMm / 60` — the smaller of the two input shapes' own bounding diagonal,
   divided by 60, so a small shape/detail is never starved of resolution by an unrelated larger
   shape sharing the operation — **feature size**.
3. `targetSpacingMm / 6`, when the caller supplies the destination layer's `stoneSizeMm + gapMm` —
   **stone size and gap**. `app.js`'s `runBooleanOp()` now passes this from the backmost selected
   layer's own settings.

...clamped to the pre-existing `[0.08mm, 1mm]` absolute bounds — a coarse stone-pitch hint (e.g.
6mm+0.5mm stones) does **not** force finer-than-baseline resolution ("avoid unnecessary computation
on simple designs" — verified in `tools/test-boolean-precision-validation.mjs`, test 9).

`combineShapeSources()`/`combineManyShapeSources()` gained an optional third `options` parameter
(`{ targetSpacingMm }`); omitting it (every pre-existing caller/test) reproduces the original
bounding-box+feature-size-only behavior, so this is additive, not a breaking change.

## Fail Safe

Per the brief ("never silently return low-quality geometry"), a performance budget is enforced
*before* rasterizing: if the accuracy-driven cell size above would require more than
`MAX_GRID_CELLS_BUDGET` (4.5M) total grid cells, `combineShapeSources()` throws a
`BooleanPrecisionError` (exported from `src/geometry/index.js`) instead of silently coarsening the
grid to fit. The budget is sized so that two shapes spanning up to ~2100mm combined — comfortably
covering a large production sheet; rhinestone designs are garment/product scale, well under a meter
— still succeed even with no small-feature/stone-pitch constraint pulling resolution finer.
Measured: an ordinary 1000×800mm-scale operation completes normally; only a genuinely pathological
combination (measured: a 0.05mm-radius detail unioned with a 5000×4000mm shape) trips it.

The error message is plain language, names the actual problem, and suggests a concrete next step:

> "This combination cannot be computed at a safe, well-defined precision: the shapes differ too
> much in size or detail for the requested area (a very small detail combined with a very large
> shape). Try scaling the shapes closer in size, simplifying the smaller one, or splitting the
> operation into smaller parts."

It flows through `app.js`'s existing generic `runBooleanOp()` catch block unchanged (no special
casing needed — `BooleanPrecisionError` is a normal `Error` subclass) and is shown via the same
`#status`/`#booleanOpsValidation` UI every other Boolean Operation failure already uses.

## Determinism

Verified, not assumed: `PathBoolean.js` has no source of non-determinism (no `Math.random()`,
`Date.now()`, or iteration-order-dependent `Map`/`Set` use beyond JS's own guaranteed insertion
order) — confirmed by grep and by direct measurement:

* **Repeated identical calls**: 25 (measurement harness) / 10 (automated test) repeated calls with
  identical input produced byte-for-byte identical (`deepEqual`) output every time.
* **Repeated save/load**: contours survived 10 (measurement harness) / 20 (automated test)
  `JSON.stringify()`/`JSON.parse()` round-trips with zero numeric drift — the final round-tripped
  contours are `deepEqual` to the original. (JS's `JSON.stringify()` uses the shortest
  round-trippable decimal representation for a `float64`, so this was expected to hold; it is now
  also *verified*, per the brief.)

## Non-Goals (confirmed unaffected)

* `GeometryEngine.js` was **not** rewritten — only `combineShapeSources()`/
  `combineManyShapeSources()`'s new optional third parameter and `app.js`'s one call site changed.
* No second geometry pipeline was introduced — the fixes and the adaptive-resolution logic live
  entirely inside the existing `PathBoolean.js` module RS-1012 already introduced.
* No exporter changed (confirmed by `tools/test-path-boolean-integration.mjs`'s pre-existing
  tests 7/8, which run the real `stoneLayoutToSvg()`/`productionSheetToSvg()` against a boolean
  result's `StoneLayout` and still pass unmodified).
* No project schema change — `combineShapeSources()`'s new options parameter is a plain optional
  JS function argument, not a persisted field; nothing new is written to Project JSON.

## UX & Terminology Review

The one new user-facing message this milestone introduces (the `BooleanPrecisionError` text above)
was reviewed for plain language: it avoids internal terms ("grid," "raster," "cell," "budget" never
appear to the user), states the actual problem ("the shapes differ too much in size or detail"), and
suggests concrete next steps a non-technical user can act on. It reuses the exact same
`#status`/`#booleanOpsValidation` display path RS-1012's existing graceful-failure messages already
use, so it reads consistently with "has no closed shape to combine" / "produced an empty shape" from
the same feature.

## Files Changed

* `src/geometry/PathBoolean.js` — fixed the simplification cascading bug; added
  `computeAdaptiveCellSizeMm()`, the `MIN_CELLS_ACROSS_SMALLER_SOURCE`/`SPACING_RESOLUTION_DIVISOR`/
  `MAX_GRID_CELLS_BUDGET` constants, and the exported `BooleanPrecisionError` class; both
  `combineShapeSources()`/`combineManyShapeSources()` gained an optional `options` parameter.
* `src/geometry/index.js` — exports `BooleanPrecisionError`.
* `app.js` — `runBooleanOp()` now computes and passes `targetSpacingMm` (the backmost selected
  layer's `stoneSize+gap`) to `combineManyShapeSources()`.
* `tools/measure-boolean-precision.mjs` — new. The measurement harness this document's numbers come
  from (not part of `npm test`; a report generator, run manually — see the file's own header).
* `tools/test-boolean-precision-validation.mjs` — new. 12 fast (~1.2s), assertion-based regression
  tests derived from the measurements: analytic area error, the annulus/hole-preservation
  regression test for the simplification bug, narrow bridge/tiny cutout preservation, repeated/
  chained stability, determinism, save/load round-tripping, adaptive-resolution behavior, and both
  fail-safe cases (pathological trigger + ordinary-large-document non-trigger). Wired into
  `npm test`.
* `tools/test-path-boolean-integration.mjs` — one pre-existing test's regex updated to match the
  new `combineManyShapeSources(sources,operation,{targetSpacingMm})` call shape (mechanical, same
  pattern as every prior milestone's own regression-guard maintenance).
* `package.json` — adds `tools/test-boolean-precision-validation.mjs` to `npm test`.

No renderer, exporter, font/text, SVG-parsing, image-pipeline, history, product-template,
`src/core/Layer.js`, `src/editing/**`, or `index.html` file changed.

## Automated Test Results

`npm test`: **649 checks passed, 0 failed** (full suite, ~8 seconds), including:

* All pre-existing RS-1012 tests (`tools/test-path-boolean.mjs` — 15 tests;
  `tools/test-path-boolean-integration.mjs` — 23 tests) pass unmodified in behavior (one regex
  updated for the new call signature, per above).
* New `tools/test-boolean-precision-validation.mjs` — 12/12 tests pass.

## Browser Verification

Verified with real headless Chromium via Playwright/CDP (isolated instance; the local dev server
was the only thing driven — no interaction with any user Chrome window/profile):

* **Concentric-circle Exclude** (the exact shape of the simplification bug found in the audit,
  20mm/16mm radii): produced a clean, fully-formed ring — 2 contours, correctly rendered on both
  the 2D canvas and the 3D mug preview, with no truncation or corruption. This is a direct visual
  confirmation of the fix (screenshot archived with this branch).
* Rectangle+Rectangle Union: correct, matches RS-1012's original verification.
* **Editability preserved**: the boolean results remained fully editable (move via X/CX field,
  duplicate) after the fix — inspector panel correctly showed X/CX, Y/CY, Width/Radius, Height,
  Stone Size, Gap, Stone Color for each result layer.
* **Undo/redo**: correctly restored/reapplied both boolean results across the edit sequence.
* **Export SVG/PNG**: both downloaded successfully, unchanged behavior.
* **Production Sheet export**: downloaded successfully, unchanged behavior.
* **Console errors**: zero (not even a favicon 404 in this run).

## Known Limitations

* **Raster-assisted precision, not infinite-precision analytic geometry** (unchanged from RS-1012,
  now with measured numbers rather than an estimate): boundary vertices are accurate to
  sub-millimeter (measured: <0.16mm at production scale), not floating-point-exact.
* **Elongated, very thin bridges are governed by document-scale resolution, not the small-shape
  heuristic.** The feature-size adaptive resolution (item 2 in "Adaptive Precision") uses a shape's
  *bounding diagonal*, which a long-but-thin bridge doesn't have a small value for (its length
  dominates the diagonal even though its width is tiny). Measured worst-case bridge preservation
  (≥0.35mm) is unchanged by this milestone's adaptive resolution for that reason. This is
  documented, not silently accepted: a bridge that thin has no practical manufacturing meaning
  anyway (stones are ≥1mm; a structural connection narrower than a single stone gap can't be
  populated with stones regardless of how accurately its outline is drawn).
* **Fail-safe budget is a fixed constant** (4.5M grid cells), not itself adaptive to available
  system memory/CPU. It was sized from measured production-scale timings with comfortable headroom,
  not a hard system limit — a future milestone could make it configurable if a real workflow needs
  even larger combined spans than ~2100mm.
* **Performance scales with feature-size-adaptive resolution.** A single operation combining a
  very small feature with a modestly-sized document can take on the order of 100–400ms (still well
  within interactive bounds for a user-initiated click) rather than the ~5–50ms typical of same-
  scale shapes without a small-feature constraint — a direct, expected consequence of resolving
  finer detail, not a regression.

## Recommendation

**APPROVED FOR MERGE.**

The audit found and fixed one real correctness bug (not a precision nuance — a broken, non-simple
contour) that predates this milestone's own changes; every operation now measures well under 1%
area error and under 0.16mm boundary deviation at production scale; adaptive resolution measurably
improved small-feature preservation (~3.5× on tiny cutouts) without materially increasing cost at
normal design scale; a fail-safe now exists for the one class of input that could previously have
silently returned degraded geometry; determinism and save/load fidelity are verified, not assumed;
and browser verification directly confirms the fix on the exact shape of bug that was found, with
zero console errors and no regression to editability, export, or Production Sheet output.

Per this milestone's instructions, this branch is **not merged** — it is pushed for review.

## Commit Hash

See the deliverables summary.
