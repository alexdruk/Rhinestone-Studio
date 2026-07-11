# RS-1001 — SVG Import

## Objective

Let a user import an SVG file as a new, editable design layer that flows through the same
permanent Geometry Engine as text/circle/rectangle layers, producing a canonical `StoneLayout` in
millimeters that renders in the 2D layout and cup preview and is included in every export format.

## Current Repository State

* `src/core/Layer.js` already reserves `'svg'` as a supported layer `type` (`SUPPORTED_LAYER_TYPES`)
  but has no params factory or generator for it — `docs/ARCHITECTURE.md`'s "Layers" section
  explicitly records this as a documented gap. `src/core/**` is not used by the live app (see below)
  and is not changed by this milestone.
* `app.js` owns an ad hoc, non-`src/core` project/layer model. Circle and rectangle layers are
  plain objects (`{id,type,visible,x,y,w,h,stoneSize,gap,color,...}`) generated via
  `GeometryEngine.generateShapeStonesLive()` -> `PermanentGeometryEngine.generateShapeLayout()` ->
  `createCircleVectorPath`/`createRectangleVectorPath` (`src/text/VectorPath.js`) ->
  `flattenContourToPolygon` (`src/geometry/ContourGeometry.js`) ->
  `sampleOutlinePoints`/`sampleFillPoints` (`src/geometry/StoneSampler.js`) -> `Stone`/`StoneLayout`.
  Text layers follow the analogous `generateTextLayout()` path. No code path exists for a layer
  sourced from arbitrary vector art (SVG).
* `src/geometry/StoneSampler.js`'s `sampleOutlinePoints()` always treats its input polygon as
  closed (it appends the first vertex to close the loop before walking the perimeter). SVG requires
  supporting genuinely open shapes (`<line>`, `<polyline>`, and any `<path>` subpath that never
  closes with `Z`), which this function cannot currently express.
* AI_ENGINEER.md's architecture-boundary list already names "vector path extraction" as a distinct
  concern (parallel to font loading) — `src/text/**` is the existing example (font glyphs ->
  `VectorPath`/`Contour`). SVG parsing belongs in a new peer module, not in `app.js` and not inside
  `src/geometry/**` itself.
* `app.js`'s `validateProject()` (used for Project JSON import) only recognizes layer types
  `'text'|'circle'|'rectangle'`; an imported Project JSON containing an `'svg'` layer would be
  rejected today.
* Seven `tools/test-*.mjs` guard tests assert, via `git status --porcelain`, that specific path
  prefixes were not touched by their own historical milestone. Two of them
  (`tools/test-render-export-pipeline.mjs`, `tools/test-ux-visual-polish.mjs`) currently forbid
  `src/geometry/`; two (`tools/test-app-module-migration.mjs`,
  `tools/test-shape-geometry-integration.mjs`) enumerate an exact allow-list of `app.js` import
  lines; `tools/test-examples-regression.mjs` forbids `app.js`, `index.html`, and all of `src/`.
  This milestone legitimately changes `src/geometry/**`, adds `src/svg/**`, and changes `app.js`, so
  these five guards need narrow, surgical updates (same pattern as every prior milestone's own
  forbidden-list maintenance — see e.g. RS-0003.5C1, RS-0003.5E1).

## Expected Visible Change

* A new "Import SVG" control (next to "Add circle"/"Add rectangle") lets the user pick a local
  `.svg` file. On success, a new SVG layer appears in the Layers list, its stones render in the 2D
  layout and cup preview, and it is selectable/movable/resizable/duplicable/deletable exactly like a
  circle or rectangle layer (same drag/resize/selection code path, generalized).
* A new "Fill mode" control (Outline / Fill) appears when an SVG layer is selected.
* On a malformed or unsupported SVG file, the import is rejected with a specific message in
  `#status`; no layer is added and the current project is untouched.
* All five export buttons (Project JSON, Generated Layout JSON, 2D SVG, 2D PNG, Cup PNG) include SVG
  layer stones automatically, because they all already read the single merged `StoneLayout`/canvas
  elements `app.js` already produces — no exporter-specific code changes are needed.

## Required Outcome

* New permanent module `src/svg/**` (analogous to `src/text/**`) with no DOM/Canvas/renderer/
  exporter dependency, parsing a decisive, documented subset of SVG:
  * Root `<svg>` `width`/`height` (units: `mm`, `cm`, `in`, `pt`, `pc`, `px`, or unitless treated as
    `px` at 96 CSS px/inch) and optional `viewBox`, resolved into the SVG's natural millimeter size
    (`naturalWidthMm`/`naturalHeightMm`) and a viewBox-to-declared-size coordinate transform.
  * Shape elements: `path` (full `d` grammar: `M/m L/l H/h V/v C/c S/s Q/q T/t A/a Z/z`, including
    elliptical-arc-to-cubic-Bezier conversion), `circle`, `rect` (sharp corners only — `rx`/`ry`
    rounded corners are read as a non-fatal warning and imported as a sharp rectangle), `line`,
    `polyline`, `polygon`.
  * `<g>` nesting with `transform` composition (`translate`, `scale`, `rotate` with optional pivot,
    `skewX`, `skewY`, `matrix`), applied per-element as an affine transform on every emitted point.
    Nested `<svg>`, `<defs>`, `<symbol>`, `<clipPath>`, `<mask>`, `<pattern>`, `<style>`, `<title>`,
    `<desc>`, `<metadata>` subtrees are not walked for shapes (matches SVG's own "not directly
    rendered" semantics for the def-like ones; the rest are presentation/text concerns explicitly
    out of scope — see "Out of Scope").
  * Presentation attributes (`fill`, `stroke`, `style`, `class`, `display`, `visibility`, `opacity`)
    are ignored; imported geometry always uses the layer's own stone size/gap/color/mode controls,
    matching existing circle/rectangle/text layer behavior (their generators do not read style data
    either).
  * Returns `{ naturalWidthMm, naturalHeightMm, shapes: [{ contour, closed }], warnings }` for a
    valid document (`shapes` has one entry per subpath, each an `src/text/VectorPath.js` `Contour`
    plus whether it is closed), and throws a descriptive `Error`/`TypeError` for: XML that does not
    parse, a missing/non-`<svg>` root, a document with neither `width`/`height` nor `viewBox`, or a
    document with zero usable shapes after skipping unsupported/degenerate elements.
  * An individual malformed/unsupported element (bad path syntax, negative circle radius handled per
    SVG's own "not rendered" rule, an unrecognized element, a nested `<svg>`) does not fail the whole
    import — it is skipped and recorded in `warnings`, unless it leaves zero usable shapes overall.
* `GeometryEngine.generateSvgLayout()` (new method on the existing permanent
  `src/geometry/GeometryEngine.js` class): takes `{ svgSource, layerId, xMm, yMm, widthMm, heightMm,
  stoneSizeMm, gapMm, mode, color }`, parses `svgSource` via `src/svg`, uniformly maps the SVG's
  natural bounding box onto the requested `xMm,yMm,widthMm,heightMm` placement box (independent X/Y
  scale — see "Architecture Requirements"), reuses `flattenContourToPolygon()` for every contour, and
  samples stones with the same rule text/shape generation already uses: closed contours participate
  in `fill`-mode even-odd sampling (combined across the whole document, same as
  `generateTextLayout()`'s per-character contours today) and in per-contour closed-outline sampling;
  open contours are always outline-sampled as an open polyline (never filled — an open path has no
  interior), regardless of the layer's `mode`. Returns a `StoneLayout`, matching the return contract
  of `generateTextLayout()`/`generateShapeLayout()`.
* `src/geometry/StoneSampler.js`'s `sampleOutlinePoints()` gains a new optional third parameter
  `{ closed = true } = {}`; existing two-argument call sites (text, circle, rectangle) are
  byte-identical in behavior. When `closed: false`, the perimeter walk omits the wrap-around segment
  back to the first vertex, correctly supporting open paths.
* `app.js` wires a new SVG layer type sharing the existing generic shape machinery:
  * `GeometryEngine.generateSvgStonesLive()` (mirroring `generateShapeStonesLive()`) calls
    `this.permanentEngine.generateSvgLayout(...)`, dispatched from `generate()` alongside the
    existing `text`/`circle`/`rectangle` dispatch.
  * `getLayerBBox()`, drag-move, drag-resize, `writeSelectedControlsToLayer()`,
    `syncSelectedControlsFromLayer()`, `duplicateLayer()`, and `layerLabel()` gain an `'svg'` case,
    reusing the same `x`/`y`/`w`/`h` fields and UI inputs (`#shapeX`/`#shapeY`/`#shapeW`/`#shapeH`)
    rectangle already uses, so selection/drag/resize/duplicate/delete/visibility work for free.
  * A new "Import SVG" button + hidden file input reads the selected file as text, validates it via
    `parseSvgDocument()` from `src/svg/index.js` (measuring natural size and surfacing warnings —
    this call inspects/measures only, it does not generate stones, preserving "only the Geometry
    Engine generates stone positions"), and on success adds a new `svg`-type layer (default
    placement centered on the canvas, scaled down only if the natural size exceeds the canvas,
    preserving aspect ratio for that initial default) inheriting stone size/gap/color from the
    currently selected layer, matching `addCircle`/`addRect`'s existing pattern.
  * `validateProject()` (the ad hoc Project JSON import validator) accepts `'svg'` layers, requiring
    a non-empty string `svgSource` and finite `x`/`y`/`w`/`h`, so SVG layers round-trip through
    Project JSON export/import.
* `index.html` gains the "Import SVG" button, its hidden file input, and a small "Fill mode" select
  shown only for `svg`-type layers (reusing the existing conditional-visibility pattern
  `textControls`/`shapeControls` already use).
* Millimeter scaling is preserved end to end: an SVG authored with explicit `mm` (or `cm`/`in`/`pt`/
  `pc`) units imports at its exact physical size before any layer-level width/height override is
  applied; an SVG with only `px`/unitless sizing imports using the standard 96 px/inch conversion,
  matching how browsers themselves render unit-less SVG.
* Geometry generation remains fully deterministic: identical `svgSource` + params always produce
  `deepEqual` `StoneLayout.toJSON()` output (same fixed-subdivision curve flattening already used
  everywhere else, same arc-to-Bezier algorithm, no randomness, no wall-clock/locale dependence).

## Architecture Requirements

* `src/svg/**` has zero dependency on the DOM, Canvas, WebGL, `src/renderer/**`, or `src/export/**`
  (pure string/XML/math parsing), so it runs identically under plain Node (tests) and the browser —
  no browser-specific adapter is needed (contrast with `src/browser/OpenTypeBrowserAdapter.js`,
  which exists only because of a Node/browser ES-module resolution mismatch that does not apply
  here).
* `src/geometry/GeometryEngine.js` is the only caller of `src/svg/**`'s parser from within
  `src/geometry/**`, mirroring how it is the only caller of `src/text/FontProviderRegistry.js` for
  text. `app.js` additionally calls `parseSvgDocument()` directly (not through the permanent
  engine) purely for pre-import validation/measurement, which is architecturally equivalent to
  `app.js`'s existing direct calls to `src/renderer/**`/`src/export/**` functions — it does not
  generate stones, so "only the Geometry Engine generates stone positions" is preserved.
* SVG-to-mm placement is a non-uniform fit into the requested `{xMm,yMm,widthMm,heightMm}` box
  (independent X and Y scale factors), the same mental model `generateShapeLayout()`'s rectangle
  already uses (place at `x,y`, explicit `width`,`height`). This is a deliberate scope decision, not
  an oversight — see "Out of Scope".
* `Stone`/`StoneLayout` schemas, `StoneLayout.toJSON()` (Generated Layout JSON), `stoneLayoutToSvg()`
  (SVG export), and the ad hoc Project JSON schema's existing fields are unchanged. The only schema
  change is additive: `'svg'` becomes a recognized `layers[].type` value with new fields
  (`svgSource`, `x`, `y`, `w`, `h`, `mode`, `stoneSize`, `gap`, `color`) alongside the existing
  `'circle'`/`'rectangle'`/`'text'` shapes already in that same ad hoc schema.
* No new runtime dependency. SVG XML parsing is implemented by hand (a small tokenizer sufficient
  for the supported element/attribute subset), matching AI_ENGINEER.md's "prefer existing
  dependencies and browser-native capabilities" — a `DOMParser`-based approach was considered and
  rejected because it would not run under the plain-Node test suite this repository relies on for
  deterministic, browser-free regression coverage (`docs/ARCHITECTURE.md`'s "Testing Philosophy").

## Allowed Files

* `src/svg/**` (new: XML tokenizer, transform matrix math, path-data + arc-to-Bezier parser,
  document parser, `index.js` barrel, `README.md`)
* `src/geometry/GeometryEngine.js`, `src/geometry/StoneSampler.js`, `src/geometry/README.md`
* `app.js`, `index.html`
* `tools/**` (new tests; narrow updates to existing guard assertions enumerated below)
* `package.json` (wire new test files into the `test` script)
* `docs/specifications/**`, `docs/ARCHITECTURE.md`
* `TASK.md`, `TASK_RESULT.md`

## Forbidden Files

* `src/text/**`, `src/fonts/**`, `src/core/**`, `src/browser/**`, `src/renderer/**`, `src/export/**`
* `assets/**`, `examples/**`
* `style.css`, `README.md`, `LICENSE`, `CONTRIBUTING.md`
* `node_modules/**`

## Out of Scope

* Raster embedding (`<image>`), `<text>`, `<use>`/`<symbol>` references, gradients/patterns/filters,
  CSS `<style>` blocks, and any presentation-attribute-driven fill/stroke/color/visibility behavior.
* SVG units expressed as `%` (percentage sizing requires a containing-viewport concept this
  standalone import does not have).
* Rounded-rectangle corners (`rx`/`ry` on `<rect>`) — imported as a sharp rectangle with a warning.
* Uniform (aspect-ratio-preserving) auto-scale as the *only* option — the layer's width/height fields
  allow independent stretch, matching rectangle's existing model; a future milestone could add an
  optional "lock aspect ratio" toggle.
* Per-layer rotation (`Layer.rotationDeg` exists on the unused `src/core/Layer.js` model but no
  layer type in the live `app.js` UI uses rotation today; SVG layers do not introduce it either).
* Migrating `app.js`'s ad hoc project/layer model onto `src/core/Project.js`/`Layer.js`.
* A DXF exporter, manufacturing reports, or any other unrelated exporter format.
* New example `.rhs` fixtures under `examples/**` (that fixture/baseline system belongs to
  RS-0003.5E1's scope; this milestone does not add SVG examples there).

## Required Automated Tests

New `tools/test-svg-parser.mjs` (unit tests against `src/svg/**` directly, no browser, no
`GeometryEngine`):

1. Parses a minimal `<svg>` with a `<rect>` and returns one closed contour with the expected corner
   coordinates.
2. `<circle>`, `<line>` (open), `<polyline>` (open), `<polygon>` (closed) each parse to the expected
   contour shape/closedness.
3. `<path>` parses `M L H V C S Q T Z` (absolute and relative) to matching contour commands; multiple
   `M`-started subpaths within one `<path>` produce multiple contours; an unclosed subpath is open.
4. Elliptical arc (`A`) parsing: a known quarter-circle arc's flattened endpoint matches the
   requested endpoint within tolerance, and a 0-radius/degenerate arc falls back to a straight line
   without throwing.
5. `<g transform="...">` composition: `translate`, `scale`, `rotate` (with and without a pivot),
   `skewX`/`skewY`, `matrix`, and nested groups all apply correctly and in the SVG-spec-defined
   order (verified against hand-computed expected points).
6. Unit conversion: `width="50mm"`/`"5cm"`/`"2in"`/`"200px"`/unitless all resolve to the expected
   `naturalWidthMm`; a `viewBox`-only document (no `width`/`height`) resolves via the 96px/inch
   fallback; a document with neither throws a clear error.
7. A document mixing one valid `<rect>` with one unsupported element (e.g. `<image>`) imports the
   rect and records a non-fatal warning naming the skipped element.
8. A document containing only unsupported elements throws a clear "no supported shapes" error.
9. Malformed XML (unterminated tag, mismatched close tag) throws a clear parse error.
10. A single malformed `<path d="...">` (unparseable data) is skipped with a warning rather than
    aborting a document that also contains other valid shapes.
11. Determinism: parsing the same source twice produces `deepEqual` contour output.

Extend `tools/test-geometry-engine.mjs` with `generateSvgLayout()` coverage (mirroring the existing
`generateShapeLayout()` test block):

12. SVG generation succeeds and produces stones for a representative multi-shape document.
13. Requested `widthMm`/`heightMm` placement scales the generated bounding box accordingly
    (independent X/Y scaling verified).
14. `mode: 'fill'` places stones inside closed shapes only; a document with only open shapes
    (e.g. a single `<line>`) in `fill` mode still produces the same outline stones a `outline`
    request would (no interior to fill, no error).
15. Outline/fill generation is deterministic (`deepEqual` `toJSON()` across two calls).
16. Generated coordinates are finite and in millimeters.
17. Every stone carries the requested `layerId` and `color`.
18. A malformed/empty `svgSource` throws a clear error from `generateSvgLayout()`.
19. `generateSvgLayout()` works with no `fontProviderRegistry` supplied (shape-only-style
    independence from font infrastructure, matching `generateShapeLayout()`).

New `tools/test-svg-integration.mjs` (structural, mirroring `tools/test-shape-geometry-integration.mjs`):

1. `app.js`'s `generate()` routes `svg` layers through a live method that calls the permanent
   engine's `generateSvgLayout`.
2. `app.js` imports `parseSvgDocument` from `./src/svg/index.js` for pre-import validation.
3. `validateProject()` accepts an `'svg'`-type layer with a valid `svgSource`/`x`/`y`/`w`/`h` and
   rejects one missing `svgSource`.
4. `index.html` exposes the `#importSvg` button and `#importSvgFile` file input `app.js` expects.
5. `getLayerBBox()`/drag/resize/`duplicateLayer()` each have an `'svg'` case (structural regex
   checks against `app.js`, matching the existing convention for these guard tests).
6. No forbidden file changed (this milestone's own forbidden list).

Update existing guard assertions (narrow, surgical, matching prior-milestone precedent):

* `tools/test-app-module-migration.mjs` and `tools/test-shape-geometry-integration.mjs`: add
  `from\s*['"]\.\/src\/svg\/index\.js['"]` to each file's `allowed` import-pattern list.
* `tools/test-render-export-pipeline.mjs` and `tools/test-ux-visual-polish.mjs`: remove
  `'src/geometry/'` from each file's forbidden-prefix list (this milestone legitimately changes it);
  everything else in those lists stays forbidden.
* `tools/test-examples-regression.mjs`: remove `'app.js'`/`'index.html'` from its forbidden-exact
  set and replace the blanket `'src/'` forbidden prefix with the still-forbidden subset
  (`'src/text/'`, `'src/fonts/'`, `'src/core/'`, `'src/browser/'`, `'src/renderer/'`,
  `'src/export/'`); `'assets/'` stays forbidden.

Run the full suite (`npm test`) and confirm every existing suite still passes with only the
enumerated guard updates changed.

## Required Browser Verification

Run `npm run dev` and drive `http://localhost:5173/` (from-scratch CDP driver over headless Chrome,
matching the RS-0003.5B2-5E1 precedent — no new browser-automation dependency):

* [ ] Page loads, no console errors on load.
* [ ] Default project (text only) still renders correctly (regression check).
* [ ] Importing a simple valid SVG (e.g. a single `<rect>`/`<path>` logo) adds a new layer whose
      stones render in the 2D layout.
* [ ] The imported SVG layer's stones render in the cup preview.
* [ ] Selecting the SVG layer and dragging it in the 2D canvas moves its stones live.
* [ ] Dragging a resize handle on the SVG layer resizes its stones live.
* [ ] Switching the SVG layer's Fill mode between Outline/Fill regenerates its stones live.
* [ ] Duplicating the SVG layer produces a second, offset copy with its own stones.
* [ ] Toggling the SVG layer's visibility checkbox removes/restores its stones from the layout.
* [ ] Deleting the SVG layer removes its stones from the layout.
* [ ] Importing a malformed/empty SVG file shows a specific error in `#status` and does not add a
      layer or crash the page.
* [ ] Importing an SVG containing one unsupported element alongside supported ones still imports
      successfully (status/console notes the skipped element).
* [ ] Export Project JSON, Export Generated Layout JSON, Export 2D SVG, Export 2D PNG, and Export
      Cup PNG all succeed and reflect the SVG layer's stones.
* [ ] Re-importing the exported Project JSON restores the SVG layer correctly (round trip).
* [ ] No uncaught exception / unhandled rejection during any of the above.

Record actual observed stone counts/bounds and screenshots in `TASK_RESULT.md`. Do not claim
unperformed interactive checks as passing.

## Acceptance Criteria

* `npm test` passes, including the new SVG parser/integration suites.
* Importing a supported SVG produces a correctly scaled, deterministic `StoneLayout` visible in the
  2D layout and cup preview, and present in all five export formats.
* Malformed/unsupported SVG produces a clear, specific error and never corrupts the current project.
* No forbidden file changed; `StoneLayout`/export schemas are unchanged except for the additive
  `'svg'` layer type in the ad hoc Project JSON shape.
* `TASK_RESULT.md` accurately reports what was verified vs. not.

## Implementation Constraints

* Smallest coherent change: reuse `flattenContourToPolygon`/`sampleOutlinePoints`/`sampleFillPoints`/
  `Stone`/`StoneLayout` as-is; no parallel geometry/sampling implementation.
* Preserve millimeters throughout; preserve deterministic output (fixed curve-flattening subdivision,
  no randomness).
* Do not add a bundler, framework, XML-parsing dependency, or CDN reference.
* Do not change `Stone`/`StoneLayout`/Generated-Layout-JSON/SVG-export schemas.

## Required Commands

```bash
npm test
git diff --check
git status
npm run dev
```

## Commit Message

```
feat(svg): import SVG files as an editable vector layer through the permanent Geometry Engine
```

## Deliverables

* New `src/svg/**` (SVG XML/transform/path-data parser, `index.js`, `README.md`).
* Updated `src/geometry/GeometryEngine.js` (`generateSvgLayout()`), `src/geometry/StoneSampler.js`
  (open-path outline sampling), `src/geometry/README.md`.
* Updated `app.js`, `index.html` (SVG layer type, import UI, fill-mode control).
* `tools/test-svg-parser.mjs`, `tools/test-svg-integration.mjs` (new), `tools/test-geometry-engine.mjs`
  (extended), narrow guard updates to `tools/test-app-module-migration.mjs`,
  `tools/test-shape-geometry-integration.mjs`, `tools/test-render-export-pipeline.mjs`,
  `tools/test-ux-visual-polish.mjs`, `tools/test-examples-regression.mjs`; `package.json` test script.
* This specification, `TASK.md`, `TASK_RESULT.md`, `docs/ARCHITECTURE.md` update.

## Next Milestone

Candidates: curved text (P0 backlog item, complementary to this milestone's arc/Bezier path
handling), multi-object support / grouping (P0 backlog item), an optional "lock aspect ratio" toggle
for SVG/rectangle layers, per-layer rotation support in the live editor, and migrating `app.js`'s ad
hoc project/layer objects onto `src/core/Project.js`/`Layer.js`.
