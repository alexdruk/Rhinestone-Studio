# RS-1003 — Curved Text

## Objective

Let any text layer follow a circular arc instead of a straight baseline, while reusing the exact
same `OpenTypeProvider -> VectorPath -> GeometryEngine -> StoneLayout` pipeline every other layer
type already uses. Curved text must stay fully editable (live regeneration, undo/redo, save/load,
duplicate) and must require zero changes to `StoneLayout`, the renderers, or the exporters.

## Current Repository State

* `src/geometry/GeometryEngine.js`'s `generateTextLayout()` resolves each character to a glyph via
  `FontProviderRegistry.getTextPath()`, translates its contours along a straight pen line
  (`translateContour(contour, penXMm, 0)` inside the private `_buildPositionedContours()`), flattens
  every contour to a polygon (`flattenContourToPolygon()`, `src/geometry/ContourGeometry.js`), then
  samples stone positions from the flattened polygons (`sampleOutlinePoints()`/`sampleFillPoints()`,
  `src/geometry/StoneSampler.js`). There is currently no notion of a non-straight baseline anywhere
  in this pipeline.
* Glyph contours returned by `OpenTypeProvider` (confirmed empirically against the bundled
  `courier-prime-regular` font) place the baseline at local `yMm = 0`, with ascenders at *negative*
  `yMm` and descenders at *positive* `yMm` — a top-left-origin, y-down millimeter space, matching
  every other coordinate in the app (canvas/cup rendering, `StoneLayout`, SVG import).
* `app.js`'s `generateTextStonesLive()` centers the generated `StoneLayout`'s bounding box on the
  canvas after generation (`offsetX`/`offsetY` from `result.getBoundingBox()`) — this centering step
  is layer-type-agnostic (it only reads the resulting bounding box) and requires no change for
  curved text.
* `src/renderer/CanvasRenderer2D.js` and `src/renderer/CupRenderer.js` consume only `StoneLayout`
  (stone `xMm`/`yMm`/`sizeMm`/`color`) and a bounding-box-driven fit transform — neither has any
  per-layer-type branching, so both already support an arbitrarily-shaped stone layout with zero
  changes.
* `src/export/SvgExporter.js` (`stoneLayoutToSvg()`) likewise consumes only `StoneLayout`.
* `app.js`'s text layer is a plain object
  (`{id,type:'text',visible,text,font,height,textMode,stoneSize,gap,color,autoFit}`); there is no
  existing curve-related field, and no existing precedent for text-layer alignment.
* `src/renderer/CupRenderer.js`'s non-`'front'` wrap modes already do the closest existing thing to
  an "arc projection": `theta = ((st.xMm - centerXMm) / boundingWidthMm) * maxTheta + rot` maps a
  stone's horizontal position *proportionally* onto a fixed total angle (`maxTheta`, derived from
  the `wrap` mode). This is useful internal precedent for how this repository already models
  "stretch a linear extent onto an explicit total angle" and is the model this milestone follows for
  `curveSweepAngleDeg` (see "Geometry Model" below) — it is only precedent, not shared code; the cup
  wrap projection is a *display-time* 3D-illusion transform inside a renderer (explicitly allowed to
  contain that kind of view logic) and stays untouched. Curved text's arc projection is a
  *geometry-time* transform inside the Geometry Engine, producing real 2D stone positions that are
  identical for every consumer (2D layout, cup preview after its own wrap transform, SVG/PNG/JSON
  export).
* Milestone brief's out-of-scope list (Bezier text, arbitrary paths, freehand paths, perspective
  text, interactive curve handles, multiple baselines, variable spacing) rules out per-character
  manual placement UI, non-circular curves, and any letter-spacing model that is not a single
  uniform reparameterization of the existing straight-line pen position.

## Required Outcome

Every text layer gains two layouts: **Straight** (unchanged, default) and **Curved**. New
per-text-layer properties (flat fields, matching the milestone brief's naming exactly):

| Field | Type | Meaning |
|---|---|---|
| `curveEnabled` | boolean | `false` (default) = straight text, unchanged pipeline. `true` = arc-projected. |
| `curveRadiusMm` | number > 0 | Radius of the circle the text's baseline is wrapped onto. |
| `curveDirection` | `'outside'` \| `'inside'` | Which way glyph "up" points relative to the circle's center — see "Geometry Model". |
| `curveStartAngleDeg` | number (finite) | Anchor angle, degrees. `0` = top of the circle (12 o'clock); positive angle turns clockwise (screen convention, y-down mm space, matching `CupRenderer`'s existing angle sense). |
| `curveSweepAngleDeg` | number (finite, non-zero) | Total angle, degrees, the full text is stretched across. Sign controls direction: positive = clockwise as text reads left-to-right, negative = counter-clockwise. |
| `curveAlignment` | `'start'` \| `'center'` \| `'end'` | Where the text's arc sits relative to `curveStartAngleDeg` — see "Geometry Model". |

Toggling `curveEnabled` off must reproduce byte-identical straight-text output to before this
milestone (this is a hard regression requirement — `tools/test-ux-visual-polish.mjs` test 9 already
pins the default project's straight-text stone count/bounds to exact values).

## Geometry Model

All new geometry lives in a new pure module, `src/geometry/ArcProjection.js`, consumed only by
`GeometryEngine.generateTextLayout()` — this is the "Arc projection" stage the milestone brief's
pipeline diagram calls out explicitly (`Text -> OpenTypeProvider -> VectorPath -> GeometryEngine ->
Arc projection -> StoneLayout -> existing renderers`).

**Where it runs in the pipeline:** after each character's contours are flattened into polygons
(`flattenContourToPolygon()`, unchanged) and before outline/fill sampling
(`sampleOutlinePoints()`/`sampleFillPoints()`, unchanged). Every flattened polygon vertex — already
a millimeter point in the glyph's straight pen-line space — is remapped onto the arc. Sampling then
walks the already-curved polygons exactly as it walks straight ones today; neither
`ContourGeometry.js` nor `StoneSampler.js` needs to know curves exist.

**Why project polygon vertices, not bezier control points:** warping bezier control points and
re-flattening with an unaware flattener would not produce a curve-following bezier (control points
do not transform isometrically under a non-affine map). Projecting the already-densely-flattened
polygon vertices (16 segments/curve, `CURVE_FLATTEN_SEGMENTS`) is the standard "text on a path"
technique, introduces no new approximation class beyond the existing chord-vs-curve error, and
requires no change to the flattening step itself.

**Per-point transform** (`projectPointToArc(point, options)`):

Let `t = totalAdvanceWidthMm > 0 ? point.xMm / totalAdvanceWidthMm : 0` — the point's proportional
position along the full text's straight-line pen advance (`totalAdvanceWidthMm`, the same quantity
`_buildPositionedContours()` already accumulates character-by-character; it now also returns this
total).

Let `sweepStartRad` depend on `curveAlignment` (`startRad`/`sweepRad` are `curveStartAngleDeg`/
`curveSweepAngleDeg` in radians):
* `'start'`: `sweepStartRad = startRad` — the first character begins exactly at the start angle.
* `'end'`: `sweepStartRad = startRad - sweepRad` — the last character ends exactly at the start angle.
* `'center'` (default): `sweepStartRad = startRad - sweepRad / 2` — the text is centered on the start angle.

Angle for this point: `angleRad = sweepStartRad + sweepRad * t`.

Effective radius for this point, from its local vertical offset `v = point.yMm` (negative for
ascenders, per "Current Repository State" above):
* `'outside'`: `effectiveRadius = curveRadiusMm - v` — ascenders (`v<0`) move to a *larger* radius,
  i.e. glyph "up" points away from the circle's center. This is the conventional look for text
  arching along the *outside/top* of a circle (a badge rim read left-to-right along the top).
* `'inside'`: `effectiveRadius = curveRadiusMm + v` — ascenders move to a *smaller* radius, i.e.
  glyph "up" points toward the center. This is the conventional look for text along the *inside* of
  a ring or the *bottom* of a circle, where "up" must point toward the circle's center to stay
  readable right-side-up. (Exactly like existing circular-text tools' inside/outside or "flip"
  toggle: the direction is a fixed geometric rule, not aware of *where* on the circle the text is
  placed — pairing `'inside'` with a top-of-circle placement produces upside-down text by the same
  honest rule that makes `'inside'` correct at the bottom. This is a known, accepted consequence of
  the two independent parameters, not a bug.)

Final position (arc center at the local origin `(0,0)` — i.e. the same layer-local space
`_buildPositionedContours()` already produces; `app.js`'s existing post-generation bounding-box
centering places the arc on the canvas exactly like it already places straight text, unchanged):

```
xMm = effectiveRadius * sin(angleRad)
yMm = -effectiveRadius * cos(angleRad)
```

At `angleRad = 0` this is `(0, -effectiveRadius)` (straight up = the top of the circle, since mm `y`
is negative-up); increasing angle sweeps clockwise, matching `CupRenderer`'s existing angle sense.

**Why `curveSweepAngleDeg` stretches (not clips) the text:** the brief validates `curveSweepAngleDeg`
independently (reject `0`) and calls out `180°`/`270°`/`360°` as distinct browser-verification cases
— for those to be independently meaningful (not simply derived from `curveRadiusMm` and text
length), `curveSweepAngleDeg` must directly determine the angle the text occupies. This repository
already has precedent for exactly this "stretch a linear extent onto an explicit total angle" model
(`CupRenderer`'s non-`'front'` wrap modes — see "Current Repository State"). This is a *uniform*
linear reparameterization of the existing pen-position axis (one global scale factor,
`sweepRad / totalAdvanceWidthMm`), not the excluded "variable spacing" (which would mean non-uniform
per-character adjustment) — kerning/letter-spacing between characters is computed exactly as before
and only the whole run is uniformly re-mapped onto the requested angle.

## Validation

Extends `normalizeTextParams()` in `GeometryEngine.js`, in the same style as its existing
`assertFiniteNumber`/`assertPositiveNumber` helpers, and only when `curveEnabled` is truthy
(straight text — the default — never validates or reads the other curve fields, guaranteeing
"straight text unchanged"):

* `curveRadiusMm` — must be a finite number > 0. Rejects `<= 0`, `NaN`, `Infinity` (all three
  already rejected by the existing `assertPositiveNumber` helper, reused as-is).
* `curveSweepAngleDeg` — must be a finite, non-zero number. Rejects `NaN`, `Infinity`, and exactly
  `0` (a new, explicit check; `assertFiniteNumber` alone does not reject `0`).
* `curveStartAngleDeg` — must be a finite number (any real value, including negative or `>360`;
  `sin`/`cos` are periodic so no range clamp is needed).
* `curveDirection` — must be `'outside'` or `'inside'`.
* `curveAlignment` — must be `'start'`, `'center'`, or `'end'`.

All failures throw `TypeError`/`RangeError` with a specific message, exactly like every other
`GeometryEngine` validation failure. `app.js`'s existing `updateAll()` already wraps every
`engine.generate()` call in `try`/`catch` and surfaces `error.message` in `#status` — this is the
"useful status messages only" requirement, satisfied by reusing existing infrastructure with no new
UI plumbing.

## Editing / State (`app.js`, `index.html`)

* `defaultProject()`'s text layer gains explicit curve fields (`curveEnabled:false,
  curveRadiusMm:40, curveDirection:'outside', curveStartAngleDeg:0, curveSweepAngleDeg:360,
  curveAlignment:'center'`) so every text layer always carries a complete, save/load-round-trippable
  set of fields, and so enabling the curve checkbox has an immediately sensible starting shape.
* `generateTextStonesLive()`'s `base` params object passes the six curve fields straight through to
  `generateTextLayout()` (spread from the layer, no per-field translation needed — the field names
  already match 1:1 between the layer schema and `GeometryEngine` params). Auto-fit's existing
  rescale-and-regenerate logic is untouched (it works purely off `result.widthMm`, agnostic to
  whether the shape is straight or curved).
* `syncSelectedControlsFromLayer()`/`writeSelectedControlsToLayer()` gain the six curve controls
  (mirrors every other per-field pair already in these functions), plus a `curveControls` `<div>`
  visibility toggle (mirrors the existing `svgControls`/`shapeControls` show/hide pattern).
* `HISTORY_TRACKED_CONTROL_IDS` gains the six new control ids, so curve edits are undoable/redoable
  and coalesce per edit session exactly like every other tracked field — no new history code needed.
* `validateProject()` (Project JSON import) is **not** changed: it already spreads every layer field
  verbatim (`layers: obj.layers.map(l=>({...l, visible: l.visible!==false}))`), so curve fields
  round-trip through export/import with zero extra code, exactly like `font`/`height`/`textMode`
  already do today without their own explicit checks. A malformed curve field that reaches
  generation still throws a specific, caught, status-surfaced error from `GeometryEngine`.
* `duplicateLayer()` is **not** changed: its existing `JSON.parse(JSON.stringify(l))` deep clone
  already preserves every field, curve fields included, with zero extra code.
* `index.html` gains six controls inside `#textControls` (an on/off `curveEnabled` `<select>`,
  matching the existing `autoFit` on/off pattern, plus a `curveControls` block with radius/direction/
  start angle/sweep angle/alignment) — no new panel, no layout restructuring.

## Allowed Files

* `src/geometry/ArcProjection.js` (new)
* `src/geometry/GeometryEngine.js`
* `src/geometry/index.js`
* `app.js`
* `index.html`
* `tools/**` (new and updated tests)
* `docs/specifications/RS-1003-CurvedText.md` (this file)
* `docs/ARCHITECTURE.md` (implementation-status note only)
* `TASK.md`, `TASK_RESULT.md`

## Forbidden Files

* `src/text/**`, `src/fonts/**`, `src/core/**`, `src/browser/**`, `src/svg/**`, `src/history/**`
  (no font, provider, project-model, browser-adapter, SVG-import, or history-engine change is
  needed).
* `src/renderer/**`, `src/export/**` (must require zero changes — this is a hard architectural
  requirement of the milestone, verified by a guard test).
* `assets/**`, `style.css`.

## Out of Scope

Bezier text, text on arbitrary/freehand paths, perspective text, interactive curve handles (drag
handles on canvas), multiple baselines, non-uniform/variable per-character spacing, and any change
to `StoneLayout`, the renderers, or the exporters.

## Automated Tests

* `tools/test-geometry-engine.mjs` — new numbered tests appended after the existing suite:
  straight text (`curveEnabled` omitted/`false`) unchanged; outside curve produces a valid,
  non-straight layout; inside curve differs from outside curve for identical other params; positive
  vs. negative `curveSweepAngleDeg` (clockwise/counter-clockwise) produce different, mirror-related
  layouts; `'start'`/`'center'`/`'end'` alignment produce different bounding boxes; fill mode works
  curved; outline mode works curved; deterministic (same params twice -> identical `toJSON()`);
  rejects `curveRadiusMm <= 0`, `NaN`, `Infinity`; rejects `curveSweepAngleDeg === 0`/`NaN`/
  `Infinity`; rejects an invalid `curveDirection`/`curveAlignment`.
* `tools/test-arc-projection.mjs` (new) — direct unit tests of `projectPointToArc()`/
  `projectPolygonToArc()` in `src/geometry/ArcProjection.js`: known-angle sanity checks (angle 0 ->
  top of circle; 90° -> right of circle, matching the clockwise convention), outside vs. inside
  radius sign, alignment anchor math, `totalAdvanceWidthMm=0` degenerate case does not throw/NaN.
* `tools/test-curved-text-integration.mjs` (new) — structural checks against the live `app.js`/
  `index.html` source (matching the established convention in
  `tools/test-live-text-integration.mjs`/`tools/test-undo-redo-integration.mjs`, since `app.js` is a
  browser entry point, not `import()`-able under plain Node): curve fields present in
  `defaultProject()`; `generateTextStonesLive()` passes all six curve fields through;
  `HISTORY_TRACKED_CONTROL_IDS` includes the six new ids; `syncSelectedControlsFromLayer()`/
  `writeSelectedControlsToLayer()` read/write all six; `index.html` exposes the six new control ids
  inside `#textControls`; `src/renderer/**`/`src/export/**` are unchanged by this milestone (a
  `git status --porcelain` guard, matching the established forbidden-file-list convention).
* Full existing suite (`npm test`) must continue to pass unmodified, including
  `tools/test-ux-visual-polish.mjs` test 9's exact pinned stone count/bounds for the default
  project's straight text.

## Browser / Manual Verification

Via headless Chrome/CDP against `npm run dev`, matching the established precedent
(`docs/specifications/RS-1001-SvgImport.md`'s audit, `docs/specifications/RS-1002-UndoRedo.md`):

* Small radius, large radius.
* `curveSweepAngleDeg` = 180°, 270°, 360°.
* `curveDirection` = inside, outside.
* Font switching (Courier Prime, Great Vibes) while curved.
* Outline mode and fill mode while curved.
* Cup preview reflects curved text with no changes needed beyond consuming the updated
  `StoneLayout`.
* SVG/PNG/Cup PNG/Project JSON/Generated Layout JSON exports all succeed for a curved layer.
* Toggling curve on/off, undo/redo across curve edits, duplicating a curved layer.
* Zero console errors throughout.

## Acceptance Criteria

* `curveEnabled:false` (or omitted) reproduces the pre-milestone straight-text pipeline exactly —
  no behavior change, confirmed by the existing pinned regression test.
* `curveEnabled:true` produces a deterministic, arc-following `StoneLayout` for outline and fill
  modes, honoring radius/direction/start angle/sweep angle/alignment.
* Invalid curve params (`radius<=0`, `NaN`, `Infinity`, `sweep===0`) throw a specific, caught error
  surfaced in `#status`.
* Undo/redo, Project JSON save/load, and layer duplication all preserve every curve field with no
  new code beyond what already exists for other fields (verified, not just claimed).
* `src/renderer/**` and `src/export/**` are byte-for-byte untouched.
* `npm test` passes in full.

## Next Milestone

Not decided by this task; candidates already on record from prior `TASK_RESULT.md`s (multi-object
grouping, per-layer rotation for shape/SVG layers, migrating `app.js`'s ad hoc project model onto
`src/core/Project.js`/`Layer.js`) remain unaffected by this milestone.
