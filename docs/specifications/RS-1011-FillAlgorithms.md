# RS-1011 — Fill Algorithms

## Objective

Add professional, production-safe fill algorithms — Grid, Staggered, Radial, Contour, in addition
to the existing Outline — comparable to the fill/hatch options in Illustrator/Affinity/embroidery
CAM tools. Every fill result must remain normal `StoneLayout` data produced by the existing
`GeometryEngine`: no renderer-only effects, no parallel fill engine, no visual approximation that
bypasses production geometry.

## Audit Findings (before implementation)

* **Two sample modes already exist, both already shared across every vector layer type.**
  `src/geometry/GeometryEngine.js`'s six `generate*Layout()` methods (text — including curved text,
  a text-mode option, not a separate layer type — shape, svg, image, path) all funnel through
  `src/geometry/StoneSampler.js`'s `sampleOutlinePoints()` (`'outline'` mode: walk the perimeter at
  `spacingMm` arc-length steps) and `sampleFillPoints()` (`'fill'` mode: a regular millimeter grid,
  `spacingMm` apart in both axes, kept only where an even-odd point-in-polygon test says "inside" —
  this already correctly excludes holes, e.g. a glyph counter or an SVG donut). **`'fill'` mode is
  already exactly what this milestone's brief calls "Grid Fill"** — regular rows/columns,
  deterministic, `spacingMm = stoneSizeMm + gapMm`. It needed a clearer user-facing label, not a
  reimplementation.
* **The stone pitch convention is one formula, used everywhere, with no exception:**
  `spacingMm = stoneSizeMm + gapMm`, computed once per `generate*Layout()` call and passed to every
  sampler. This is the only spacing formula in the codebase; this milestone introduces no second one
  — every new algorithm below derives its own row/ring/spoke spacing from this same `spacingMm`.
* **Staggered, Radial, and Contour fill did not exist anywhere.** No hex/staggered grid, no radial/
  concentric-ring placement, no inward-offset contour rings. This is the genuinely new geometry
  capability this milestone adds.
* **Not every layer type could reach `'fill'` mode before this milestone**, despite
  `generateShapeLayout()`/`generatePathLayout()` already accepting a `mode` parameter:
  `app.js`'s `generateShapeStonesLive()` (circle/rectangle) and `generatePathStonesLive()`
  (Boolean Operation results) hard-coded `mode:'outline'` and exposed no fill-mode control in
  `index.html` at all. Text (`textMode`: `stroke`/`fill`) and SVG (`mode`: `outline`/`fill`) already
  had a working UI control. Image Trace (`generateImageLayout()`) has no `mode` parameter at all —
  it always raster-fills via `sampleFieldFillPoints()`, and has no outline concept (a raster density
  field has no vector perimeter to walk).
* **Holes, multi-contour paths, and bounds are already handled once, centrally**, by
  `isPointInsidePolygons()`'s even-odd rule (`StoneSampler.js`) for vector shapes and by
  `sampleFieldFillPoints()`'s per-pixel threshold lookup for Image Trace. Every new algorithm below
  reuses these exact same interior tests — no second containment implementation is introduced,
  matching `src/geometry/PathBoolean.js`'s existing precedent of reusing `isPointInsidePolygons()`
  rather than inventing a parallel one.
* **Text, Curved Text, Circle, Rectangle, SVG, and Boolean/path layers all share one vector pipeline**
  (`ContourGeometry.js` flattening -> `StoneSampler.js` sampling), confirmed in
  `docs/specifications/RS-1012-VectorBooleanOperations.md`'s own audit and unchanged since. Curved
  text is not a separate layer type — it is `generateTextLayout()`'s arc-projection stage, applied
  before sampling; every fill mode below therefore works on curved text for free, with zero curve-
  specific code.
* **Image Trace is architecturally separate by design** (RS-1008A): it has its own raster sampler
  family (`sampleFieldFillPoints()`) parallel to the vector one, sharing only the `FIELD_ON_THRESHOLD`
  convention and the "one sampling algorithm, one home in `StoneSampler.js`" principle. This
  milestone keeps that split: every new fill mode gets both a vector sampler (`polygons` in,
  `Point2D[]` out) and, where mathematically meaningful, a field sampler (`field` in, `Point2D[]`
  out) — see "Supported Mode x Layer-Type Matrix" for the one combination (Outline x Image Trace)
  that stays unsupported, because a raster density field has no vector perimeter to walk.
* **No polygon-offset ("inward contour") algorithm existed anywhere.** `PathBoolean.js` rasterizes,
  combines, and marching-squares-traces two shape *sources* — it has no notion of eroding one shape
  inward by a fixed distance. This is Contour Fill's core new primitive (see Architecture).
* **No fill-generation code exists in any renderer/exporter.** `CanvasRenderer2D.js`, `CupRenderer.js`
  (unused, RS-1006), `StoneLayoutTexture.js`, `SvgExporter.js`, `ProductionSheetExporter.js` all only
  ever draw/export the stones a `StoneLayout` already contains — none of them branch on
  `sourceMode` or generate positions. This milestone requires no renderer/exporter changes, confirmed
  by grep and by the "no renderer regressions" browser verification pass below.

## Required Outcome

Extend `GeometryEngine`'s sample-mode enum from `{outline, fill}` to
`{outline, fill, staggered, radial, contour}` (the stored value `'fill'` is unchanged — meaning is
unchanged too, "Grid Fill" is only a clearer *display label* for the same value, so every existing
project's `textMode`/`svgMode` value keeps generating byte-identical geometry). Add:

* `sampleStaggeredFillPoints()` / `sampleStaggeredFieldFillPoints()` — hexagonal/staggered packing.
* `sampleRadialFillPoints()` / `sampleRadialFieldFillPoints()` — concentric rings outward from the
  shape's own bounding-box center.
* `sampleContourFillPoints()` / `sampleContourFieldFillPoints()` — repeated inward contour rings.

...all in `src/geometry/StoneSampler.js` (Contour Fill's inward-ring geometry lives in a new,
narrowly-scoped `src/geometry/ContourRingSampler.js`, imported only by `StoneSampler.js` — see
Architecture for why this is a new file rather than reusing `PathBoolean.js`'s private tracer).

Wire every layer type's `generate*Layout()` to the full mode set (image excepted: no `'outline'`),
add the one missing capability (circle/rectangle/path never had *any* fill-mode UI control) via a
new `fillMode` layer field (default `'outline'`, preserving every existing project's rendered
geometry exactly), and add one shared "Fill Style" control per layer-type Lightbox, replacing the
existing narrower Outline/Fill toggles with the same 5-way (4-way for Image Trace) choice, using
plain rhinestone-design language, not internal algorithm names.

## Architecture

### Staggered Fill — hexagonal row offset, same pitch

Alternating rows offset horizontally by `spacingMm/2`. Row-to-row vertical spacing is
`spacingMm * sqrt(3)/2` — the standard hexagonal-packing derivation from one pitch value, not a
second spacing formula: it is the unique row spacing at which every stone's nearest neighbors
(same row and both adjacent rows) all land at exactly `spacingMm`, the configured pitch. This is
what "alternating rows... to improve packing density" (the brief's own wording) means mathematically
— square (Grid Fill) packing has 4 nearest neighbors at `spacingMm`; hexagonal (Staggered Fill)
packing has 6, at the same `spacingMm`, filling the same area with more stones. Deterministic (fixed
row/column scan order, same as Grid Fill); interior test is the same `isPointInsidePolygons()`/field
lookup Grid Fill already uses.

### Radial Fill — concentric rings from the shape's own bounding-box center

Ring `k` (`k=1,2,...`) sits at radius `k * spacingMm`; each ring is walked in `n = round(2*pi*r /
spacingMm)` equal angular steps so consecutive stones on that ring are `spacingMm` apart (arc-length,
matching Outline mode's own convention); one stone is placed at the exact center if the center point
itself is inside the shape. Rings continue outward until the farthest bounding-box corner is passed;
every candidate point is still clipped through the same interior test every other mode uses. The
center is always the shape's own bounding-box center (not user-configurable): every shape (circle,
rectangle, arbitrary SVG/path/text bounding box) has exactly one well-defined bounding-box center, so
this is always meaningful, requires no extra per-layer field (no new undo/redo/save-load/duplicate
surface), and matches "no controls the implementation does not genuinely support" — see UI.

### Contour Fill — inward-offset rings via a distance transform (the one new primitive)

"Repeated inward contours" requires eroding a shape inward by a fixed distance, repeatedly. No
analytic polygon-offset (Minkowski/straight-skeleton) algorithm existed in this repository, and one
does not generalize cleanly to arbitrary multi-contour shapes with holes any more than analytic
boolean clipping did for RS-1012 (self-intersecting curves, glyph counters, nested SVG paths). This
milestone reuses `PathBoolean.js`'s own resolution of that exact tradeoff (see its "Why
raster-assisted boolean ops" section): rasterize, then trace boundaries with marching squares.
Concretely, `src/geometry/ContourRingSampler.js` adds:

1. **A distance-to-boundary field**, built once per `sampleContourFillPoints()`/
   `sampleContourFieldFillPoints()` call, over a grid whose cell size is `spacingMm/8` (clamped
   `0.05-1mm`, identical clamping shape to `PathBoolean.js`'s `MIN/MAX_CELL_SIZE_MM`), via a standard
   two-pass chamfer (1, sqrt(2)) approximate-Euclidean distance transform. Grid cells outside the
   shape (per the same `isPointInsidePolygons()`/field-threshold test every other mode uses) seed
   distance `0`; an inside cell orthogonally adjacent to an outside cell is seeded with its
   *measured* sub-cell distance to the boundary (READ-001: `insideAt` bisected along the axis to each
   outside neighbour, smallest crossing wins — a flat `cellSizeMm/2` seed still translates the whole
   ring by up to half a cell when the boundary lands on a grid line; see
   `docs/specifications/READ-001-ContourCentreline.md`). This correctly treats a hole's interior as
   "outside" too, for free — Contour Fill preserves holes without any hole-specific code, the same
   way Grid/fill mode already does via the even-odd rule.
2. **Ring `k`'s polygon(s)** are the distance field's `>= k * spacingMm` iso-contour, traced with the
   same 16-case marching-squares table `PathBoolean.js` uses (a well-understood, standard algorithm —
   this module does not import `PathBoolean.js`'s private tracer, see "Why a new tracer, not a
   shared one" below). Each cell-edge crossing is placed by **linear interpolation of the two node
   distance values** (READ-001 — previously the fixed cell-edge midpoint, a half-cell inward bias);
   saddle cases (5, 10) are still resolved by the bilinear cell-centre value (appropriate for a
   smooth scalar field; simpler and cheaper than `PathBoolean.js`'s re-sample-the-source approach,
   which does not apply here since there is no second source to re-sample).
3. Rings stop the first time a threshold produces zero contours — safe because the distance field's
   maximum is finite and monotonically bounds every larger threshold to empty too (also capped by a
   hard `MAX_RING_COUNT` fail-safe, see Precision and Fail-Safes).
4. Each ring polygon — and each boundary contour — is first passed through `splitSliverRuns()`
   (READ-001): the loop is resampled to ≤ `spacingMm/4` vertex spacing (so a coarse polygon — a
   Rect/Slot/sparse SVG path — can be analysed at all; a no-op for a marching-squares ring), then
   where its two branches close up below one `spacingMm`, detected by an **arc-length** proximity
   gate, that run collapses to a single line of medial-axis midpoints instead of two near-coincident
   rows that dedupe would cull in arbitrary walk order. A stroke **terminal** — a short non-slivered
   run (arc length < `2·spacingMm`) flanked by slivered runs, which the arc-length gate cannot pair —
   is absorbed into the collapse as one centreline point at its arc-length midpoint, so the loop
   becomes a single tip-to-tip open centreline rather than leaving an outline stub a half-width
   off-centre at each end. `sampleContourFillPoints()` computes the
   rings *before* densifying the boundary, so a pathological shape/pitch still fails with
   `ContourFillPrecisionError` rather than allocating. Every resulting piece (closed rings, open
   centrelines) is then walked at `spacingMm` arc-length steps with the *existing*
   `sampleOutlinePoints()` — Contour Fill introduces no second "walk a polygon at even spacing"
   algorithm.
5. The vector sampler's outermost ring (`k=0`) is not raster-traced at all — it is the *exact*,
   unmodified input polygon(s), sampled with the same `sampleOutlinePoints()` Outline mode uses. This
   is "Existing outline behavior must remain compatible" applied literally: Contour Fill's edge ring
   is byte-for-byte the same geometry as switching that layer to Outline mode, with zero raster
   approximation error on the one ring most visible to the eye. Only the inward rings (`k>=1`) are
   distance-field-derived. (The field sampler has no true vector perimeter to reuse this way, so its
   first ring sits at `spacingMm/2` — the same "start half a pitch in from the edge" convention
   Grid/Staggered Fill's raster row placement already uses.)
6. All points (outline/first ring plus every inward ring) are passed through a shared
   `dedupeStonePoints()` grid-hash proximity filter (same bucketed-neighbor-check shape as the
   pre-existing, already-shipped `app.js` cross-layer `dedupe()`), dropping any point within
   `stoneSizeMm` of one already kept (READ-001: the physical constraint is literal stone overlap,
   not the gap-inclusive pitch; flooring at the full `spacingMm` culled sub-pitch lanes wholesale
   where contour branches converge — the same reasoning RC-002 applied to outline mode.
   `stoneSizeMm` is threaded from every `GeometryEngine` call site through `sampleShapeFillPoints()`
   / `sampleFieldByMode()`, defaulting to `spacingMm` when a caller omits it). This is what "avoid
   duplicate stones where contours converge" means concretely: where two rings (or one ring's own
   near-self-intersection at a pinch point) land almost on top of each other, only one survives.

`dedupeStonePoints()` is also applied, as a defensive second layer, to Radial Fill's output (polar
sampling can occasionally place two rings' stones closer than the nominal pitch near a shape's
irregular boundary); Grid, Staggered, and Outline are not — their scan order makes duplicates
geometrically impossible, so running the same O(n) filter over them would be pure overhead with no
behavior change.

**Why a new tracer file, not a shared one with `PathBoolean.js`:** `PathBoolean.js` is the one module
covered by RS-1012A's dedicated precision-measurement milestone (see
`docs/specifications/RS-1012A-ProductionPrecisionValidation.md` and
`tools/measure-boolean-precision.mjs`) — its saddle-case resolution, grid-budget fail-safe, and
simplification tolerance are all tuned and regression-tested against that milestone's measured
scenarios. Refactoring its private marching-squares implementation to also serve a distance-field
threshold (a different scalar-field shape, needing a different, cheaper saddle resolution — see
point 2 above) would risk that tuned behavior for a shared-code benefit this milestone does not need.
`ContourRingSampler.js` implements the same textbook 16-case table independently, scoped to exactly
what Contour Fill needs; `isPointInsidePolygons()` (the actual "shape containment" primitive the
project's no-duplication rule is about) is still reused, not reimplemented.

### GeometryEngine dispatch

Every vector `generate*Layout()` method's previous `mode === 'fill' ? sampleFillPoints(...) :
sampleOutlinePoints(...)` ternary is replaced by one shared `sampleShapeFillPoints(mode, polygons,
boundingBox, spacingMm)` dispatcher (`StoneSampler.js`), removing four near-identical copies of the
same branch and making "every mode implemented for every vector layer type" a property of one
function instead of four independently-maintained call sites. `generateImageLayout()` gains its
first `mode` parameter (default `'fill'`, so every existing call site and every previously-saved
`image` layer — which has no `fillMode` field — generates exactly the same raster-fill geometry as
before) and dispatches through the equivalent `sampleFieldByMode()`. SVG's existing open-vs-closed
contour split (open polylines are always outline-walked, regardless of `mode` — they have no
interior) is untouched; only the closed-polygon branch now goes through the shared dispatcher.

## Supported Mode x Layer-Type Matrix

| Layer type              | Outline | Grid Fill | Staggered Fill | Radial Fill | Contour Fill |
|--------------------------|:-------:|:---------:|:---------------:|:------------:|:-------------:|
| Text (incl. Curved Text) |    Y    |     Y     |        Y        |      Y       |       Y       |
| Circle                   |    Y    |     Y     |        Y        |      Y       |       Y       |
| Rectangle                |    Y    |     Y     |        Y        |      Y       |       Y       |
| Imported SVG             |    Y    |     Y     |        Y        |      Y       |       Y       |
| Boolean/path layers      |    Y    |     Y     |        Y        |      Y       |       Y       |
| Image Trace              |    N    |     Y     |        Y        |      Y       |       Y       |

Image Trace has no Outline option because a raster density field has no vector perimeter to walk —
this is pre-existing (RS-1008/RS-1008A never added one) and unchanged by this milestone; the UI hides
that option for Image Trace layers rather than offering a control that would throw.

## Backward Compatibility

* The stored enum value `'fill'` is unchanged in meaning and byte output — only its UI label changed
  (to "Grid Fill"). Every pre-existing project's `textMode:'fill'`/`svgMode:'fill'`/(image, implicit)
  layer regenerates identical stone positions.
* `textMode:'stroke'` (text's own synonym for outline) and `svgMode`/`(new) fillMode` values other
  than the 5 recognized ones fall back to `'outline'` (image: to `'fill'`), the exact same permissive-
  default convention `validateProject()` already uses for `cupColor`/`wrap`/`product`.
* `fillMode` is a brand-new, optional field on circle/rectangle/path layers. Its absence (every
  layer in every project saved before this milestone) defaults to `'outline'` — identical to the
  hard-coded `mode:'outline'` `app.js` unconditionally passed before this milestone, so no existing
  project's rendered geometry changes.
* `image` layers gain an optional `fillMode` field, defaulting to `'fill'` — identical to
  `generateImageLayout()`'s previously-unconditional raster-fill behavior.
* No Project JSON schema field was removed or renamed; `validateProject()`'s existing per-type
  required-field checks are unchanged (the new fields are optional/permissive, matching the existing
  precedent for `textMode`/`svgMode`/`curveEnabled`/etc., none of which are strictly validated
  either).

## Precision and Fail-Safes

* `ContourRingSampler.js` clamps its distance-field cell size the same way `PathBoolean.js` clamps its
  boolean-combine grid (`0.05-1mm`, `spacingMm/8` ideal) and enforces the same shape of hard
  cell-count budget (4,000,000 cells) before allocating — a design whose shape or detail level would
  need an unreasonably fine grid throws a `ContourFillPrecisionError` with an actionable message
  ("try a larger stone size/gap, or simplify the shape") instead of freezing the tab. READ-001's
  sub-cell boundary localisation removed the need for a finer grid, so the divisor and this budget
  are unchanged from RS-1011.
* Ring count is bounded twice: naturally, by the distance field's own finite, computed maximum
  (rings stop the moment one threshold is empty); and by a hard `MAX_RING_COUNT` (1000) fail-safe
  against any unexpected non-monotonic edge case.
* `dedupeStonePoints()` guarantees Contour/Radial Fill never emit two stones closer than
  `stoneSizeMm` (READ-001; `spacingMm` when the caller omits `stoneSizeMm`) — measured directly (see
  `tools/test-fill-algorithms.mjs` and `tools/test-read-001-contour-centreline.mjs`), not merely
  visually inspected. Grid and Staggered Fill keep the full `spacingMm` floor (their lattice
  placement makes sub-pitch pairs impossible anyway).
* Every new sampler validates `spacingMm > 0` and returns `[]` for a null/empty bounding box, exactly
  matching every pre-existing sampler in `StoneSampler.js` — no new failure mode was invented, no
  existing one was removed.

## UI

One "Fill Style" control per layer-type Lightbox, replacing/extending the narrower control that
already existed for that type:

* **Text Lightbox** (`#textMode`): existing `stroke`/`fill` options relabeled "Outline" / "Grid Fill",
  three new options appended ("Staggered Fill", "Radial Fill", "Contour Fill"). Same field, same
  undo/redo/session-coalescing wiring — no new control plumbing.
* **Import Lightbox, SVG tab** (`#svgMode`): same relabel-plus-three-new-options treatment.
* **Shapes Lightbox** (new `#shapeFillMode`, in the existing "Stones" field-section, shown for
  circle/rectangle/path — the three layer types that already share this Lightbox): the one genuinely
  new control, since these layer types never had a fill-mode choice at all before this milestone.
* **Image Trace Lightbox** (new `#imageFillMode`, in the existing "Edit selected image layer"
  section): four options only (no "Outline" — see the matrix above), defaulting to "Grid Fill" to
  match `generateImageLayout()`'s pre-existing default behavior.

No secondary controls (grid angle / radial center / contour spacing) are exposed: Grid Fill has no
rotation control today and this milestone adds none (out of scope, not requested by any specific
mode's math); Radial Fill's center is always the shape's own bounding-box center — always well-
defined, needing no override; Contour Fill's ring spacing is always the same `spacingMm` pitch every
other mode uses, per "do not invent a second spacing formula" — a separate "contour spacing" field
would be exactly that second formula. Every option genuinely works with zero additional
configuration, matching "do not expose controls the current implementation does not genuinely
support."

## Out of Scope / Known Limitations

* Radial Fill's center is not user-configurable (see above) — a future milestone could add an
  explicit override if a real design need for an off-center radial pattern surfaces.
* Contour Fill's distance transform is an approximate (chamfer) Euclidean distance, not exact; with
  READ-001's interpolated crossings and sub-cell boundary localisation the residual ring-placement
  error is within ±0.012mm of nominal per branch at `spacingMm/8`, measured directly in
  `tools/test-read-001-contour-centreline.mjs` (and `tools/test-fill-algorithms.mjs`), not just
  asserted.
* Grid Fill retains its pre-existing axis-aligned-only orientation (no rotation control) — unchanged
  from before this milestone, not a regression.
