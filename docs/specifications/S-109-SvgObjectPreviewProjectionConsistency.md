# S-109 — SVG Object Preview Projection Consistency

## Objective

Whatever the user sees on the 2D Canvas must appear consistently on the Object Preview, subject
only to normal cylindrical perspective — same position, scale, orientation, and proportions.

## Audit

Before any code change, the full pipeline was walked and empirically tested (headless Chromium via
Playwright, `python3 -m http.server`, no mocks):

* **How imported SVG geometry is represented.** `src/svg/SvgDocumentParser.js`'s `parseSvgDocument()`
  turns raw SVG text into a natural millimeter size (`naturalWidthMm`/`naturalHeightMm`, from
  `width`/`height`/`viewBox` with unit conversion) and a flat `{contour, closed}[]` list — pure
  parsing, no stone positions invented, matching `docs/ARCHITECTURE.md`'s "only the Geometry Engine
  generates stone positions" rule.
* **Where SVG coordinates become StoneLayout.** `GeometryEngine.generateSvgLayout()`
  (`src/geometry/GeometryEngine.js`) re-parses `svgSource`, maps the SVG's natural bounding box
  independently in X and Y onto the requested `{xMm,yMm,widthMm,heightMm}` placement box (the same
  model `generateShapeLayout()`'s rectangle already uses), flattens every contour
  (`flattenContourToPolygon()`), and samples stones with the exact same primitives
  (`sampleOutlinePoints()`/`sampleShapeFillPoints()`) text and shape generation already use. Verified
  directly in Node: a known SVG's resulting `StoneLayout.getBoundingBox()` matched its expected
  placement to within stone-sampling tolerance — the geometry math itself is correct.
* **How layer bounds are calculated.** `app.js`'s `getLayerBBox()` treats every `XYWH_SHAPE_TYPES`
  member (`rectangle`, `svg`, `image`, `path`, every S-110 shape) identically — the layer's own
  requested `x/y/w/h`, not a re-derived stone bounding box. SVG is not a special case here.
  `isTextTooLongForObject()` is text-only (a pre-existing, narrower gap unrelated to this
  milestone's symptom — noted below under Known Limitations, not fixed here per scope).
* **How imported transforms are applied.** `src/svg/SvgTransform.js`'s matrix composition
  (`viewBox` normalization + per-element `transform` attributes, including nested `<g>`) was
  exercised with a multi-shape SVG containing a rotated, translated `<g><rect></g>`, a `<circle>`, a
  `<path>` triangle, and an open `<polyline>` — every shape's position/rotation matched the 2D Canvas
  on the Object Preview once the root cause below was fixed.
* **How the Object Preview texture is generated.** `src/preview3d/StoneLayoutTexture.js`'s
  `drawStoneLayoutTexture()` draws every `Stone` at `stone.xMm * pxPerMm, stone.yMm * pxPerMm` onto a
  canvas sized to the live `project.canvas` mm dimensions — layer-type-agnostic, identical to how
  `CanvasRenderer2D.js`'s `renderStoneLayout()` draws the same `StoneLayout`.
* **How SVG differs from text/shapes/image trace/Boolean results.** It doesn't, architecturally: all
  six layer kinds (`text`, `circle`/`rectangle`/S-110 shapes, `svg`, `image`, `path`) resolve through
  `GeometryEngine` into the same `Stone`/`StoneLayout` product, merged once per `updateAll()` in
  `app.js`, and consumed identically by `CanvasRenderer2D.js` and
  `StoneLayoutTexture.js`/`ObjectGeometryBuilder.js`. Neither renderer references a layer `type`.

**Empirical confirmation the defect was never SVG-specific:** an imported SVG triangle and a plain
Rectangle shape layer placed in the identical `x/y/w/h` box showed the *exact same* distortion on the
Object Preview. A complex multi-path SVG (rotated group, circle, closed path, open polyline) and the
default project's text layer showed the same class of distortion too. This ruled out every SVG-only
code path (`src/svg/**`, `GeometryEngine.generateSvgLayout()`, the SVG import UI in `app.js`) as the
cause.

## Root Cause

`src/preview3d/ObjectGeometryBuilder.js`'s `applyAzimuthUv()` (called via the since-removed
`applyWrapUv()`) mapped every mesh vertex's texture U coordinate as:

```
U = 0.5 + azimuth / wrapAngleRad(wrapMode)
```

instead of the object's true, wrap-mode-independent circumference scale. Because `wrapAngleRad()`
returns a fraction of a full 360-degree turn (`front`=70°, `wide`=115°, `half`=180°, `full`=300°),
this compressed the *entire* production canvas — the same flat mm space the 2D Canvas renders at true
scale — into that narrower angular window on the object mesh. Y (`applyBodyHeightUv()`) was never
rescaled this way, so the result was a real, wrap-mode-dependent, X-only aspect distortion: ~5.1x too
narrow at Mug's default `front` wrap, ~1.2x even at the least-severe `full` wrap. This affected every
layer type identically; it was simply most visually obvious on compact, simple-geometry content
(an imported SVG's or Design Shape's straight edges and corners) versus a long text run's already-
narrow individual glyphs.

This was not a latent bug — it was working exactly as designed and had been explicitly, deliberately
restored after being temporarily removed, and reviewed/approved: see
`docs/specifications/S-107-LongTextReadability.md`, Part 4 ("Decision: Restore wrap-mode-dependent
windowing"), commit `a6b88b4`. That decision's own stated trade-off ("wrap mode was always a
preview-only 'how much of the canvas is squeezed into view' stylization, not a physically 1:1
mapping") is precisely the "distortion"/"incorrect scaling" this milestone's requirements prohibit.
This milestone's explicit mandate — 2D Canvas and Object Preview must agree, subject only to normal
cylindrical perspective — supersedes that trade-off. This decision was confirmed with the human
project owner before implementing (the audit initially found no SVG-specific code path at all; the
owner then directed treating the shared wrap-mode compression as the real, in-scope root cause).

## Decision

Restore true-scale, wrap-mode-independent texture UV mapping (the original S-107 Part 3 design,
before Part 4's regression-driven reversal) while preserving everything wrap mode is documented to
otherwise control:

* `WRAP_ANGLE_DEG`, `wrapAngleRad()`, `frontViewFrameWidthMm()`, `canvasXMmForAzimuthRad()`,
  `azimuthRadForCanvasXMm()` (`src/preview3d/ObjectDimensions.js`) — **unchanged**. Wrap mode still
  sizes the Front View Frame's highlighted width on the 2D Canvas and still drives the frame's own
  drag/orbit-sync geometry.
* `app.js`'s Front View Frame drawing/drag logic, printable-circumference math, and the `#wrap`
  control itself — **unchanged**. Every existing wrap-mode behavior a user can see on the 2D Canvas
  (frame width per mode, drag-to-rotate, live-orbit sync) is untouched.
* The *only* thing removed is wrap mode's side effect on the Object Preview's texture UV — the one
  place it caused the 2D-vs-Preview inconsistency this milestone exists to fix.

## Implementation

* **`src/preview3d/ObjectGeometryBuilder.js`** — `applyAzimuthUv(geometry)` now computes
  `U = 0.5 + azimuth / (2*PI)` (the object's true circumference scale — the same dimensionless
  `canvasXMm / canvasWidthMm` relation `ObjectDimensions.js`'s `canvasXMmForAzimuthRad()` already
  defines for the Front View Frame, so both views literally share one mm-to-azimuth model). Called
  once inside `buildObjectMesh()`, alongside `applyBodyHeightUv()`, instead of being re-invoked on
  every wrap-mode change. `applyWrapUv()` (the old per-wrap-mode entry point) is removed — there is
  nothing left for it to do once UV no longer depends on wrap mode. The azimuth-from-column-index
  math (not `Math.atan2(position)`) and `phiStart=-PI` seam placement — both real, unrelated dark-
  band fixes from S-107 Part 4 — are unchanged.
* **`src/preview3d/Preview3DRenderer.js`** — `update()` no longer accepts/uses a `wrap` option;
  the `_wrap`/`_applyWrapUv` re-application bookkeeping is removed. `onAzimuthChange` (live-orbit
  sync) is untouched.
* **`app.js`** — `drawCup()` no longer passes `wrap:project.wrap` to `preview3D.update()` (one line).
  Nothing else changed: the Front View Frame, printable-circumference validation, and the `#wrap`
  control are all identical.
* No change to `GeometryEngine`, `StoneLayout`, the project schema, any exporter, or Front View Frame
  logic, per this milestone's explicit constraints. No SVG-specific code was added anywhere — the fix
  is entirely inside the shared `src/preview3d/**` rendering pipeline every layer type already
  flows through.

## Testing

* `tools/test-object-geometry-builder.mjs` — checks 7/8 rewritten to assert the mesh's UV is
  wrap-mode independent and matches the true circumference formula exactly (`U = 0.5 +
  azimuth/(2*PI)`), and that `applyWrapUv` no longer exists. Checks 8b/8c (dark-vertical-band /
  signed-zero apex regression guards, from S-107 Part 4) kept, simplified to no longer loop over wrap
  modes (UV is now built once).
* `tools/test-s107-long-text-readability.mjs` — checks 14/15 rewritten to assert `update()` no longer
  takes a `wrap` option and `ObjectGeometryBuilder.js` no longer exports `applyWrapUv`. Checks 15b/15c
  (`atan2` removal, `phiStart=-PI`) are independent of wrap-dependence and unchanged. All other
  Front-View-Frame/rotation-sync checks (10-13, 25-26) are unchanged and still pass.
* `npm test`: 792/792 checks, 0 failures.

## Browser Verification

Headless Chromium (Playwright), `python3 -m http.server 5173`, real app, no mocks. Before/after
comparison at Mug's default `front` wrap mode (the previously worst-case, ~5.1x distortion):

* **Right-triangle SVG** (asymmetric on both axes): before, rendered as a nearly-illegible thin
  sliver on the Object Preview; after, matches the 2D Canvas's shape/orientation/proportions exactly
  (mild, expected cylindrical bowing only).
* **Multi-path SVG** (rotated-group rectangle, circle, closed path, open polyline): after, all four
  shapes match the 2D Canvas on Mug and Bottle, at `front` wrap.
* **Default project text layer** ("Vitalina Serbin"): after, readable and correctly proportioned at
  `front` wrap (previously compressed to overlapping glyphs).
* **Wrap sweep** (`front`/`wide`/`half`/`full`) on the imported triangle: Object Preview screenshots
  are now pixel-identical across all four modes (texture is wrap-mode independent, as designed); the
  2D Canvas's Front View Frame width still changes correctly per mode (40.8mm/67.1mm/105.0mm/175.0mm
  on the default Mug — unchanged from S-107).
* **Save/load round trip**: exported Project JSON, reloaded the page, imported it back — Object
  Preview and 2D Canvas both rendered identically to before reload.
* **Zero console errors, zero page errors** across every step above.

## Known Limitations

* `isTextTooLongForObject()` (the printable-circumference overflow warning) remains text-only —
  an SVG/shape/image layer wider than the object's printable circumference gets no equivalent
  warning. This is a pre-existing UX gap noted during the audit, not a projection-consistency defect,
  and is out of scope for this milestone (no requirement asked for it).
* Wrap mode no longer visibly changes the Object Preview's texture at all (only the 2D Canvas's Front
  View Frame). This is the intended, required outcome of this milestone, but it is a real behavior
  change from the state shipped by S-107 Part 4 — flagged explicitly here since that state was
  previously reviewed and approved.

## Recommendation

Approve. The fix is a three-line net change to the actual UV formula (plus the removal of the now-
dead `applyWrapUv()` entry point and its call sites), fully covered by rewritten unit tests and real-
browser verification, with no change to `GeometryEngine`/`StoneLayout`/the project schema/exporters/
Front View Frame logic/wrap-mode configuration — only the one place wrap mode was incorrectly
rescaling the Object Preview's texture.
