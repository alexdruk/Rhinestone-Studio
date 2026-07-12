# Geometry

The Geometry Engine converts project layers into StoneLayout data in millimeters.

Renderers and exporters must consume Geometry Engine output instead of generating stones themselves.

## Vector Text Geometry Engine (RS-0003.5A)

`GeometryEngine` (`GeometryEngine.js`) implements the pipeline:

```
Text Parameters -> FontProviderRegistry -> VectorPath -> GeometryEngine -> StoneLayout
```

Usage:

```js
import { GeometryEngine } from './src/geometry/index.js';

const engine = new GeometryEngine({ fontProviderRegistry });

const layout = await engine.generateTextLayout({
  text: 'Vitalina',
  fontId: 'courier-prime-regular',
  layerId: 'layer-1',
  heightMm: 12,
  stoneSizeMm: 2,
  gapMm: 0.3,
  letterSpacingMm: 0,
  mode: 'outline' // or 'fill'
});

layout.count;            // total stone count
layout.getBoundingBox();  // BoundingBox in millimeters, or null when empty
layout.widthMm;
layout.heightMm;
```

Each character is resolved through the `FontProviderRegistry` individually and
positioned along the pen line so `letterSpacingMm` can be applied between
glyphs. Bezier contours are flattened with a fixed subdivision count
(`CURVE_FLATTEN_SEGMENTS` in `ContourGeometry.js`) so output is deterministic.
`outline` mode walks each flattened contour's perimeter at `stoneSizeMm + gapMm`
spacing; `fill` mode places a grid of stones inside the glyph shapes at the
same spacing, using an even-odd point-in-polygon test so letterforms with
counters (e.g. "o") keep their holes.

`GeometryEngine` has no dependency on the DOM, Canvas, WebGL, the renderer, or
any exporter. It is wired into the browser application (`app.js`) for both
text and shape layers as of RS-0003.5C1.

## Shape Geometry Engine (RS-0003.5C1)

`generateShapeLayout()` generates a StoneLayout for a circle or rectangle,
reusing the same contour-flattening (`ContourGeometry.js`) and outline/fill
sampling (`StoneSampler.js`) primitives as `generateTextLayout()`, via the
neutral `createCircleVectorPath()` / `createRectangleVectorPath()` helpers in
`src/text/VectorPath.js`. Text and shapes therefore share one Geometry Engine
and one `StoneLayout`/`Stone` product.

```js
import { GeometryEngine } from './src/geometry/index.js';

// No fontProviderRegistry is required for shape-only generation.
const engine = new GeometryEngine();

const circle = engine.generateShapeLayout({
  shape: 'circle',
  layerId: 'layer-1',
  cxMm: 105,
  cyMm: 45,
  radiusMm: 18,
  stoneSizeMm: 2,
  gapMm: 0.3,
  mode: 'outline', // or 'fill'
  color: 'gold'
});

const rectangle = engine.generateShapeLayout({
  shape: 'rectangle',
  layerId: 'layer-2',
  xMm: 65,
  yMm: 30,
  widthMm: 80,
  heightMm: 30,
  stoneSizeMm: 2,
  gapMm: 0.3
});
```

`generateShapeLayout()` is synchronous, unlike `generateTextLayout()` (no font
provider to await). A circle is built from a 4-cubic-Bézier `Contour`
flattened to a 64-segment polygon; a rectangle from a 4-`lineTo` `Contour`.
`outline` mode walks the flattened polygon's perimeter at `stoneSizeMm +
gapMm` spacing, same as text outline mode.

`fontProviderRegistry` is now optional on the `GeometryEngine` constructor —
only `generateTextLayout()` requires one (it throws a clear error if called
without one). Check `engine.canGenerateText` to see whether text generation
is available without triggering that error. Shape generation never depends on
it, so shape-only projects work even if font-manifest loading fails.

## SVG Geometry Engine (RS-1001)

`generateSvgLayout()` generates a StoneLayout for an SVG layer, parsing `svgSource` via
`src/svg/index.js`'s `parseSvgDocument()` (the SVG counterpart to `src/text`'s font glyph
extraction) and reusing the same contour-flattening (`ContourGeometry.js`) and outline/fill
sampling (`StoneSampler.js`) primitives as `generateTextLayout()`/`generateShapeLayout()`.

```js
import { GeometryEngine } from './src/geometry/index.js';

const engine = new GeometryEngine();

const layout = engine.generateSvgLayout({
  svgSource: '<svg xmlns="http://www.w3.org/2000/svg" width="50mm" height="20mm">...</svg>',
  layerId: 'layer-1',
  xMm: 10,       // placement top-left, defaults to 0
  yMm: 10,
  widthMm: 50,   // target placed size; defaults to the SVG's own natural mm size
  heightMm: 20,
  stoneSizeMm: 2,
  gapMm: 0.3,
  mode: 'outline', // or 'fill'
  color: 'gold'
});
```

The SVG's natural bounding box (top-left at its own origin, after `src/svg` resolves any
`viewBox`/`transform`) is mapped independently in X and Y onto the requested
`{xMm,yMm,widthMm,heightMm}` box — the same "place at x,y with an explicit width/height" model
`generateShapeLayout()`'s rectangle already uses (non-uniform stretch is allowed by design, not an
oversight).

Closed contours (a `<circle>`, `<rect>`, `<polygon>`, or a `<path>` subpath closed with `Z`)
participate in `fill`-mode even-odd sampling, combined across the whole document — matching how
`generateTextLayout()` combines every character's contours into one fill pass — and in per-contour
closed-outline sampling. Open contours (a `<line>`, `<polyline>`, or an unclosed `<path>` subpath)
are always outline-sampled as an open polyline regardless of `mode`, since an open path has no
interior to fill; `sampleOutlinePoints()`'s new `{ closed: false }` option (see below) implements
this without a wrap-around segment back to the first vertex.

`generateSvgLayout()` is synchronous, like `generateShapeLayout()` (no font provider to await), and
does not require a `fontProviderRegistry`.

`StoneSampler.js`'s `sampleOutlinePoints(polygon, spacingMm, { closed = true })` gained the
`closed` option this milestone; every pre-existing two-argument call site (text, circle, rectangle)
is unaffected, since `closed` defaults to `true`.

## Image Trace Geometry Engine (RS-1008A)

`generateImageLayout()` generates a StoneLayout for a bitmap-traced (`image`) layer, processing an
already-decoded `imageBuffer` via `src/image/index.js`'s `prepareImageField()` (the raster
counterpart to `src/svg`'s vector path extraction: grayscale → threshold → optional invert →
optional blur → optional resize, producing a neutral density field) and sampling it with
`StoneSampler.js`'s `sampleFieldFillPoints()` — the raster counterpart to `sampleFillPoints()`,
using the same fixed-spacing-grid-over-a-bounding-box shape but testing "at/above the field's
density threshold" instead of "inside a polygon" (even-odd).

```js
import { GeometryEngine } from './src/geometry/index.js';
import { createImageBuffer } from './src/image/index.js';

const engine = new GeometryEngine();

const layout = engine.generateImageLayout({
  imageBuffer: createImageBuffer({ widthPx, heightPx, data }), // decoded RGBA pixels
  layerId: 'layer-1',
  xMm: 10,       // placement top-left, defaults to 0
  yMm: 10,
  widthMm: 50,   // target placed size (required — an image has no "natural mm size")
  heightMm: 20,
  stoneSizeMm: 2,
  gapMm: 0.3,
  color: 'gold',
  threshold: 128,    // 0-255, default 128
  invert: false,
  blurRadiusPx: 0,
  maxWidthPx: 400,   // working-resolution cap for the internal resize stage
  maxHeightPx: 400
});
```

This is a deliberate architecture correction (RS-1008A) over the original RS-1008 milestone, which
had `src/image/**` construct `Stone`/`StoneLayout` directly — a second, independent stone-
generating implementation. `src/image/**` now only prepares image-derived input (`prepareImageField()`
never imports `src/geometry/**` or constructs a `Stone`); `generateImageLayout()` is the only
caller that turns that field into stones, exactly as `generateSvgLayout()` is the only caller that
turns `parseSvgDocument()`'s output into stones. See
`docs/specifications/RS-1008A-ImageTraceArchitectureCorrection.md`.

`generateImageLayout()` is synchronous, like `generateShapeLayout()`/`generateSvgLayout()` (no font
provider to await), and does not require a `fontProviderRegistry`. Decoding raw image bytes into
`imageBuffer` is a browser-only, asynchronous concern handled entirely by the caller (`app.js`, via
`src/image/index.js`'s `decodeImageFileToBuffer()`/`decodeDataUrlToBuffer()`) before this method is
ever called — `GeometryEngine.js` itself has no DOM dependency.

## Stone Color (RS-0003.5A1)

Every `Stone` carries a `color`. Pass `color` to `generateTextLayout()` to
propagate an explicit layer/request color to every generated stone; when
omitted, each `Stone` falls back to `DEFAULT_STONE_COLOR` (`'Crystal AB'`,
exported from `Stone.js`), matching the default already used for layer params
in `src/core/Layer.js`. Color is part of `Stone`'s plain-object shape, so it
survives `toJSON()`/`fromJSON()` round trips and is preserved by `StoneLayout`.

## Generated Layout JSON Schema (RS-0003.5D1)

`StoneLayout.toJSON()` / `Stone.toJSON()` (`StoneLayout.js`, `Stone.js`) define the exact shape of
the app's "Export Generated Layout JSON" button — it is not a separate exporter module, it is the
same `StoneLayout` the 2D canvas, cup preview, and SVG exporter already consume, serialized
directly (`app.js` calls `JSON.stringify(layout, null, 2)`, which invokes `toJSON()` because
`layout` is a real `StoneLayout` instance).

```json
{
  "layerId": "circle-1",
  "sourceMode": "outline",
  "count": 2,
  "boundingBox": { "minXmm": 9, "minYmm": 4, "maxXmm": 16, "maxYmm": 6, "widthMm": 7, "heightMm": 2 },
  "widthMm": 7,
  "heightMm": 2,
  "stones": [
    { "xMm": 10, "yMm": 5, "sizeMm": 2, "color": "gold", "layerId": "circle-1", "index": 0, "metadata": {} },
    { "xMm": 15, "yMm": 5, "sizeMm": 2, "color": "sapphire", "layerId": "circle-1", "index": 1, "metadata": {} }
  ]
}
```

(`app.js`'s merged, cross-layer export instead has `layerId: "project"`, `sourceMode: null`, and
`stones[].layerId` values spanning every visible layer — see the `layerId` field note below.)

Field notes:

* `layerId` (string) — for `app.js`'s merged cross-layer export this is always the `'project'`
  sentinel (`StoneLayout` requires exactly one non-empty `layerId` per instance; it was designed as
  a per-generation-call product — see `docs/ARCHITECTURE.md`, "StoneLayout"). `stones[].layerId`
  still names each stone's real source layer.
* `sourceMode` (`'outline'` | `'fill'` | `null`) — the generation mode for a single-layer
  `StoneLayout`; `null` for a merged cross-layer export, since no single mode applies to a
  multi-layer merge.
* `count` (number) — `stones.length`.
* `boundingBox` (object | `null`) — `BoundingBox.toJSON()` shape (`src/text/VectorPath.js`):
  `minXmm`/`minYmm`/`maxXmm`/`maxYmm`/`widthMm`/`heightMm`, covering every stone's physical
  footprint (center ± half size), not just center points. `null` for an empty layout.
* `widthMm`/`heightMm` (number) — equal to `boundingBox.widthMm`/`heightMm` (or `0` when empty),
  rounded to 6 decimal places.
* `stones` (array) — one entry per `Stone`, each with `xMm`/`yMm`/`sizeMm` (rounded to 6 decimal
  places), `color` (string id, e.g. `'gold'`), `layerId` (string), `index` (number | `null`, the
  stone's position within its own per-layer generation), and `metadata` (object, currently always
  `{}`).

There is no top-level `version` field. This has been the schema since RS-0003.5C2 — before that,
the export was a different, unrelated ad hoc shape
(`{version,units,canvas,stones:[{x,y,d,color,layerId}],bbox,stats}`). RS-0003.5D1 confirmed by
repository-wide search that no example, test, or application code still depends on that retired
shape, so no versioned compatibility layer exists or is needed for it — see
`docs/specifications/RS-0003.5D1-ProductionExportValidation.md`, "Current Repository State".
