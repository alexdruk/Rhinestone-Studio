# RS-1012 — Vector Boolean Operations

## Objective

Add professional vector boolean operations — Union, Subtract, Intersect, Exclude — comparable to
Illustrator/Affinity Designer/Inkscape's Pathfinder tools. The result of every operation becomes a
normal, fully editable vector layer that continues through the existing single
`GeometryEngine → StoneLayout` production pipeline: no special-case rendering, no duplicated
geometry, no parallel vector system.

## Audit Findings (before implementation)

* **Two parallel "layer" models exist in this repository**, and only one of them is live:
  `src/core/Layer.js` (`Layer`/`TextLayer`/`CircleLayer`/`RectangleLayer`) is a fully-tested but
  **unused-by-the-browser-app** model (only `tools/test-core-model.mjs` imports it). The actual
  running application (`app.js`) maintains its own plain-object `project.layers` array
  (`{id,type,...type-specific fields}`), completely independently, and is the one this milestone had
  to extend. This gap predates RS-1012 (see `docs/ARCHITECTURE.md`, "Current Architectural
  Limitations") and was left as-is: per this milestone's brief ("do not modify the project schema
  unless absolutely necessary"), `src/core/Layer.js` was not touched.
* **`GeometryEngine` (`src/geometry/GeometryEngine.js`) is genuinely the single source of stone
  geometry**, exactly as `docs/adr/ADR-0001-geometry-engine-single-source.md` requires. Every layer
  type (text, circle, rectangle, svg, image) already funnels through one of its
  `generate*Layout()` methods, sharing `ContourGeometry.js` (bezier flattening) and
  `StoneSampler.js` (outline/fill sampling, even-odd point-in-polygon test). This meant a sixth
  `generate*Layout()` sibling (`generatePathLayout()`) could reuse that exact same pipeline with
  zero duplication.
* **No polygon boolean/clipping algorithm existed anywhere in the codebase.** This is the one
  genuinely new geometry capability this milestone adds.
* **Image Trace (`image`) layers have no vector representation at all** — `generateImageLayout()`
  samples stones directly from a raster density field (`src/image/**`'s `prepareImageField()`);
  there is no marching-squares/vectorization step anywhere. A boolean engine that only accepts
  vector polygons would have had to either invent a second, parallel image-vectorization subsystem,
  or exclude Image Trace layers from Boolean Operations entirely (a "not mathematically possible,
  fail gracefully" case the brief explicitly permits). This milestone avoids both: see Architecture.
* **No per-layer rotation exists anywhere in the app**, for any layer type — the only "rotation" in
  the whole codebase is the 3D preview's camera orbit (`rotation`/`zoom`, view-only state). Every
  layer type today supports move (drag) and, for `rectangle`/`svg`/`image`, corner/edge-handle
  resize; `circle` resizes by radius; `text` has no resize handles at all. This is a pre-existing
  gap, not something this milestone could add without inventing an app-wide rotation system for
  every layer type (a much larger, unrelated feature) — see "Known Limitations".
* Multi-selection already exists (RS-1009/RS-1010: `selectedLayerIds`, Shift-click on canvas or in
  the Layers list) — Boolean Operations reuse it directly, exactly like Align/Distribute do.
* Exporters (`src/export/SvgExporter.js`, `src/export/ProductionSheetExporter.js`) only ever consume
  a `StoneLayout` and have no knowledge of layer types — confirmed no exporter changes were needed
  (see `tools/test-path-boolean-integration.mjs`, tests 7-8, which exercise both exporters against a
  boolean result's real `StoneLayout`).

## Architecture

### Why raster-assisted boolean ops, not analytic (Greiner-Hormann-style) clipping

True analytic polygon clipping does not generalize cleanly to:
* multi-contour shapes with holes (a glyph counter like "o", a nested SVG path) — even-odd fill
  membership, not a single simple polygon;
* self-intersecting or highly complex curves (arbitrary imported SVG paths, script fonts);
* a raster Image Trace field, without a second, independent vectorization system.

`src/geometry/PathBoolean.js` instead:

1. Rasterizes both input shapes onto one shared millimeter grid. A vector shape source
   (`{kind:'polygons', polygons}`) is rasterized with `StoneSampler.js`'s existing even-odd
   `isPointInsidePolygons()` — the exact same interior test `sampleFillPoints()` (fill-mode stone
   placement) already uses. A raster shape source (`{kind:'field', field, xMm,yMm,widthMm,heightMm}`
   — an Image Trace layer's density field) is sampled with the same nearest-pixel/threshold lookup
   `sampleFieldFillPoints()` already uses.
2. Combines the two rasterized masks with the requested boolean truth table (OR/AND/AND-NOT/XOR).
3. Traces the combined mask's boundary back into vector polygons with marching squares (16-case
   table, ambiguous "saddle" cases resolved by re-sampling the true combined value at the cell
   center), then a single-pass perpendicular-distance simplification to collapse the many collinear
   midpoints a straight edge produces back down to just its corners.

Grid resolution (`TARGET_GRID_CELLS=220`, clamped to `0.08-1mm` per cell) is far finer than any
`stoneSizeMm+gapMm` spacing used elsewhere in this app (stones are >=~1mm), so the result is
visually and dimensionally indistinguishable from an analytic clip for rhinestone placement — see
"Known Limitations" for the actual measured precision.

Holes and multiple disjoint contours fall out of this for free: marching squares traces every
boundary loop independently, and the even-odd combination rule means a hole contour nested inside
an outer contour is correct without the algorithm ever needing to know which contour is "the hole" —
the exact same property `sampleFillPoints()`'s even-odd rule already relies on for glyph counters.
Image Trace layers participate in Boolean Operations for free too, with no separate vectorization
step: their raster field is combined directly at the same grid resolution as every vector shape.

### GeometryEngine: reuse, not duplication

`GeometryEngine.js` gained four small `resolve*Polygons()` methods — `resolveShapePolygons()`,
`resolveSvgPolygons()`, `resolveTextPolygons()`, `resolvePathPolygons()` — each backed by a private
helper (`_shapePolygons()`/`_svgPolygons()`/`_textPolygons()`/`_pathPolygons()`) extracted from, and
still used by, its pre-existing `generate*Layout()` sibling. A layer's boolean-input outline is
therefore always identical to what it already renders as, by construction, not by convention — and
none of `generateShapeLayout()`/`generateSvgLayout()`/`generateTextLayout()` changed behavior (see
`tools/test-geometry-engine.mjs`/`tools/test-svg-integration.mjs`, still green, byte-for-byte).

`generatePathLayout()` is the fifth `generate*Layout()` sibling: it turns a `'path'` layer's raw
`(0,0)-rooted` contours into a `StoneLayout`, reusing the identical "place a natural-size shape into
an x/y/w/h box, then outline/fill-sample it" model `generateSvgLayout()` already uses.

### app.js: orchestration only, no geometry

`app.js` never computes boolean math itself. `resolveLayerShapeSource(layer)` asks the permanent
engine (or, for an `image` layer, `src/image`'s existing `prepareImageField()` directly, reusing the
same decode/cache path `generateImageStonesLive()` already uses) for a shape source; `runBooleanOp()`
folds the current multi-selection's sources through `combineManyShapeSources()`; the normalized
result becomes a new `'path'` layer generated by `generatePathLayout()`. The `'path'` layer type
reuses the exact generic `x/y/w/h` placement-box editing (`getLayerBBox()`/drag-resize/
`duplicateLayer()`/`getLayerPosition()`/`setLayerPosition()`) `rectangle`/`svg`/`image` layers
already share — no new selection, drag, resize, undo/redo, or Project-JSON-import code was needed
beyond adding `'path'` alongside those three existing types at each shared branch.

## Boolean Operations

| Operation | Meaning | Convention with 3+ selected layers |
|---|---|---|
| Union (⊕) | Combine the selected layers into one shape | associative: `A∪B∪C` |
| Subtract (⊖) | Cut the front layer(s) out of the back layer | `A-(B∪C)` — the backmost selected layer (by `project.layers` z-order, matching `hitTest()`'s existing "last in the array is topmost" convention) minus everything in front of it, i.e. Illustrator's "Minus Front"/Affinity's "Subtract" |
| Intersect (⊗) | Keep only the mutual overlap | associative: `A∩B∩C` |
| Exclude (⊙) | Keep the non-overlapping parts, remove the overlap | associative (symmetric difference): `A⊕B⊕C` |

Supported object types (Union/Subtract/Intersect/Exclude, any combination): rectangles, circles,
text (including curved text — arc projection runs identically to `generateTextLayout()`'s own),
imported SVG (closed contours only — an open `<line>`/`<polyline>`/unclosed `<path>` has no interior
to combine), Image Trace layers (via their raster field, no vectorization needed), and a previous
Boolean Operation's own `'path'` result (operations chain).

### Graceful failure

* Fewer than 2 layers selected — the four buttons are disabled (mirroring Align's `n<2` disabled
  state) and, if triggered anyway, `#status`/`#booleanOpsValidation` report "Select two or more
  layers... to use Boolean Operations."
* A selected layer has no closed/fillable outline (empty text, an SVG made only of open lines, an
  Image Trace layer with no placed area) — reports `"<layer name>" has no closed shape to combine`
  and changes nothing.
* The operation's result has zero area (e.g. Intersect of non-overlapping shapes, a Subtract that
  fully cancels out) — reports `<Operation> produced an empty shape...` and changes nothing.
* Every failure path returns before `commitHistory()`/`project.layers` mutation, so `project` is
  left completely untouched — verified in `tools/test-path-boolean-integration.mjs`, test 15.

## Editability

A `'path'` layer supports exactly what `rectangle`/`svg`/`image` layers already support (all
generic, all pre-existing code paths, none of it new): move (drag), resize (corner/edge handles),
duplicate, align & snap, undo/redo, save/load (Project JSON `validateProject()` gained `path`-
specific field checks), export (SVG/PNG — unmodified, StoneLayout-only), and Production Sheet
(unmodified, StoneLayout-only). Source layers are removed only after `resolveLayerShapeSource()` and
`combineManyShapeSources()` both succeed and the result has non-zero area.

**Rotation is not supported**, for the same reason no other layer type supports it: there is no
per-layer rotation feature anywhere in this application yet (see Audit Findings). Adding one is a
separate, cross-cutting feature (it would touch every layer type's bounding-box/drag/resize/
snap/export math, not just Boolean Operation results) and is out of scope for this milestone.

## UI

Boolean Operations live in the Shapes Lightbox (`#lightboxShapes`), under a new "Boolean Operations"
section, directly below "Add a shape" — no floating toolbar, matching the completed UI-001 redesign.
Four buttons use the required terminology (Union/Subtract/Intersect/Exclude — "Exclude" is this
app's user-facing name for the XOR/symmetric-difference operation, never shown as "XOR"), each
disabled until 2+ layers are selected and each carrying a plain-language tooltip explaining what it
does (e.g. Subtract: "Cut the front layer(s) out of the back layer, like a cookie cutter."). A hint
line explains how to multi-select (Shift-click on the canvas or in the Layers list) and that the
result becomes one new editable layer with the originals removed (reversible via Undo). Errors
surface in a dedicated inline validation banner (`#booleanOpsValidation`, matching the existing
`#importProjectValidation` precedent) as well as the workspace `#status` strip.

## Known Limitations

* **Raster-assisted precision, not infinite-precision analytic geometry.** Boundary vertices are
  accurate to roughly one grid cell (~0.08-1mm, scaled to the combined shapes' size — see
  `PathBoolean.js`'s `TARGET_GRID_CELLS`/`MIN_CELL_SIZE_MM`/`MAX_CELL_SIZE_MM`), not to floating-
  point precision. This is far finer than any stone spacing used in this app (stones are >=~1mm) and
  is verified against the closed-form circle-circle intersection area formula in
  `tools/test-path-boolean.mjs` (test 8, within ~2mm² on a ~140mm² intersection) — but a user
  comparing exported SVG path coordinates pixel-for-pixel against Illustrator's analytic output
  would see small (sub-mm) differences.
* **No per-layer rotation** (pre-existing app-wide gap — see Audit Findings and Editability above).
* **Very large or very intricate shapes are proportionally slower**, since the algorithm's cost
  scales with grid-cell count × source-polygon vertex count. This matches the pre-existing
  performance profile of `fill`-mode text/SVG stone sampling — no new asymptotic behavior — but a
  Boolean Operation over, e.g., a paragraph of curved text is not instantaneous.
* **Image Trace layers combine via their raster field, not an inferred vector outline** — this is a
  deliberate architecture choice (see Architecture above), not a missing feature, but it means the
  resulting `'path'` layer's contour follows the traced field's pixel grid at the Image Trace layer's
  own working resolution (`maxWidthPx`/`maxHeightPx`), same as viewing that Image Trace layer alone.

## Files Changed

* `src/geometry/PathBoolean.js` — new. Raster-assisted Union/Subtract/Intersect/Exclude engine.
* `src/geometry/GeometryEngine.js` — adds `resolveShapePolygons()`/`resolveSvgPolygons()`/
  `resolveTextPolygons()`/`resolvePathPolygons()`/`generatePathLayout()`; factors
  `_shapePolygons()`/`_svgPolygons()`/`_textPolygons()`/`_pathPolygons()` out of the pre-existing
  `generate*Layout()` methods (behavior-preserving).
* `src/geometry/index.js` — exports `combineShapeSources`/`combineManyShapeSources`/
  `BOOLEAN_OPERATIONS`.
* `src/geometry/README.md` — documents the above.
* `app.js` — new `'path'` layer type (`SUPPORTED_LAYER_TYPES`, `validateProject()`,
  `generatePathStonesLive()`, `getLayerBBox()`/drag-resize/`duplicateLayer()`/`layerLabel()`/
  `moreOptionsBtn`/`writeSelectedControlsToLayer()` cases); `computeTextPlacementOffset()` extracted
  from `generateTextStonesLive()` (behavior-preserving) and reused by the new
  `resolveLayerShapeSource()`; new `resolveLayerShapeSource()`, `runBooleanOp()`,
  `showBooleanOpsError()`/`clearBooleanOpsError()`; `updateEditingUI()` gains the four buttons'
  disabled-state logic; four `onclick` handlers.
* `index.html` — new "Boolean Operations" section in the Shapes Lightbox.
* `docs/ARCHITECTURE.md` — documents the sixth editable layer type.
* `docs/specifications/RS-1012-VectorBooleanOperations.md` — this document.
* `package.json` — adds `tools/test-path-boolean.mjs`/`tools/test-path-boolean-integration.mjs` to
  `npm test`.
* `tools/test-path-boolean.mjs`, `tools/test-path-boolean-integration.mjs` — new.
* `tools/test-svg-integration.mjs`, `tools/test-image-integration.mjs`,
  `tools/test-ui001-leftpanel.mjs`, `tools/test-alignment-snapping-integration.mjs`,
  `tools/test-alignment-snapping-upgrade.mjs`, `tools/test-ui001b-fixes.mjs`,
  `tools/test-preview3d-integration.mjs`, `tools/test-production-sheet-exporter.mjs` — updated
  regression-guard regexes/forbidden-file allowlists to reflect the shared branches this milestone
  legitimately extends (each with an inline comment explaining why, matching this repository's
  established precedent for every prior milestone that touched a shared branch).

No exporter, renderer, font/text, SVG-parsing, image-pipeline, history, product-template, or
`src/core/Layer.js`/`src/editing/**` file changed.

## Automated Tests

`npm test` runs the full suite, including two new files:

* `tools/test-path-boolean.mjs` (15 tests) — pure unit tests of `PathBoolean.js`: exact-area checks
  for rectangle/circle union/subtract/intersect/xor (including a closed-form circle-circle
  intersection formula cross-check), disjoint shapes, hole/annulus preservation (even-odd), a raster
  Image Trace field source, N-ary folding, determinism, and error handling.
* `tools/test-path-boolean-integration.mjs` (23 tests) — `GeometryEngine.resolve*Polygons()`/
  `generatePathLayout()` behavior; export/Production Sheet compatibility (real `stoneLayoutToSvg()`/
  `productionSheetToSvg()` calls against a boolean result's `StoneLayout`); `app.js` structural
  wiring (layer-type dispatch, UI buttons/tooltips, graceful-failure messages, terminology);
  undo/redo and save/load behavior; this milestone's own forbidden-file guard.

Result: **all tests pass** (`npm test` exit code 0).

## Browser Verification

See the deliverables summary in the pull/handoff notes for the full checklist run against real
headless Chrome via CDP (rectangle+rectangle, circle+circle, text+shape, SVG+shape, Image Trace+
shape, undo/redo, duplicate, align & snap, export SVG/PNG, Production Sheet, console-error check).

## Commit Hash

See the deliverables summary.
