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
any exporter. It is not yet wired into the browser application — that is a
later integration milestone.

## Stone Color (RS-0003.5A1)

Every `Stone` carries a `color`. Pass `color` to `generateTextLayout()` to
propagate an explicit layer/request color to every generated stone; when
omitted, each `Stone` falls back to `DEFAULT_STONE_COLOR` (`'Crystal AB'`,
exported from `Stone.js`), matching the default already used for layer params
in `src/core/Layer.js`. Color is part of `Stone`'s plain-object shape, so it
survives `toJSON()`/`fromJSON()` round trips and is preserved by `StoneLayout`.
