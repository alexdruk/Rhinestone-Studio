# SVG Import (RS-1001)

Vector path extraction for SVG source files — the SVG counterpart to `src/text/**`'s font glyph
extraction. This module has no dependency on the DOM, Canvas, WebGL, `src/renderer/**`, or
`src/export/**`, and no dependency on `src/geometry/**` either (same layering as `src/text/**`): it
only produces neutral `src/text/VectorPath.js` `Contour`s. `src/geometry/GeometryEngine.js` is the
only caller that turns those contours into stones.

```js
import { parseSvgDocument } from './src/svg/index.js';

const { naturalWidthMm, naturalHeightMm, shapes, warnings } = parseSvgDocument(svgSourceText);
```

* `naturalWidthMm` / `naturalHeightMm` — the SVG's own declared physical size in millimeters,
  resolved from `width`/`height` (units `mm`/`cm`/`in`/`pt`/`pc`/`px`, or unitless treated as `px`
  at 96 CSS px/inch) or, if those are absent, from `viewBox` at the same 96 px/inch fallback.
* `shapes` — one `{ contour, closed }` entry per supported subpath, already resolved through any
  `viewBox` mapping and `transform` composition (`translate`/`scale`/`rotate`/`skewX`/`skewY`/
  `matrix`, including nested `<g>`/`<a>`/`<switch>` groups) into one consistent coordinate space
  whose origin is the SVG's own top-left corner.
* `warnings` — human-readable strings describing anything skipped (an unsupported element, rounded
  rectangle corners, an empty `<path d="">`) without failing the whole import.

Throws a descriptive `Error`/`TypeError` for XML that does not parse, a missing `<svg>` root, a
document with neither `width`/`height` nor `viewBox`, or a document left with zero usable shapes
after skipping unsupported/degenerate elements.

## Supported subset

* Shapes: `path` (full `M/L/H/V/C/S/Q/T/A/Z` grammar, absolute and relative, elliptical arcs
  converted to cubic Beziers), `circle`, `rect` (sharp corners only), `line`, `polyline`, `polygon`.
* Containers: `g`, `a`, `switch` (all children walked; `switch`'s conditional-child selection is not
  evaluated — every child is imported).
* Not walked for shapes (matches SVG's own "not directly rendered" semantics, or explicitly out of
  scope): `defs`, `symbol`, `clipPath`, `mask`, `pattern`, `style`, `title`, `desc`, `metadata`,
  nested `svg`.
* Everything else (`text`, `image`, `use`, gradients, filters, ...) is skipped with a warning.
* Presentation attributes (`fill`, `stroke`, `style`, `class`, `display`, `visibility`, `opacity`)
  are ignored — imported geometry always uses the importing layer's own stone size/gap/color/mode
  controls, matching how circle/rectangle/text layers already work.

## Modules

* `SvgXmlParser.js` — dependency-free XML tokenizer (`parseXml()`) producing a plain
  `{ name, attrs, children }` element tree. Not a general-purpose XML parser (no DTD/entity
  definitions); sufficient for the SVG element/attribute subset above.
* `SvgTransform.js` — 2D affine matrix math (`composeMatrix()`, `applyMatrix()`) and
  `parseTransformList()` for the `transform` attribute grammar.
* `SvgPathData.js` — `parsePathData()` (the `d` grammar tokenizer), `arcToBezierSegments()` (the
  standard SVG elliptical-arc-to-cubic-Bezier center-parameterization algorithm), and
  `pathDataToContours()` (full `d` string -> `{ contour, closed }[]`, splitting a new `Contour` at
  every subpath).
* `SvgDocumentParser.js` — `parseSvgDocument()`, the orchestrator described above.

## Determinism

Curve flattening happens later, in `src/geometry/ContourGeometry.js`'s existing fixed-subdivision
`flattenContourToPolygon()` — this module only builds exact (unflattened) `Contour`s, so it
introduces no new source of non-determinism. Arc-to-Bezier conversion is closed-form trigonometry
with no iteration or tolerance-based stopping condition, so identical input always produces
identical output.
