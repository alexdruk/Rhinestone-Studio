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

## Stone Color (RS-0003.5A1)

Every `Stone` carries a `color`. Pass `color` to `generateTextLayout()` to
propagate an explicit layer/request color to every generated stone; when
omitted, each `Stone` falls back to `DEFAULT_STONE_COLOR` (`'Crystal AB'`,
exported from `Stone.js`), matching the default already used for layer params
in `src/core/Layer.js`. Color is part of `Stone`'s plain-object shape, so it
survives `toJSON()`/`fromJSON()` round trips and is preserved by `StoneLayout`.
