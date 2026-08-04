# Export

Exporters consume StoneLayout data and project metadata.

## SVG Exporter (RS-0003.5C2, validated + color metadata RS-0003.5D1)

`SvgExporter.js` serializes a `StoneLayout` as a millimeter-scale SVG document. Pure string
generation — no DOM/Canvas dependency, no layer/type awareness.

```js
import { stoneLayoutToSvg } from './src/export/SvgExporter.js';

const svg = stoneLayoutToSvg(layout, { widthMm: project.canvas.width, heightMm: project.canvas.height });
```

`stoneLayoutToSvg()` throws a `TypeError` if `stoneLayout` is missing/malformed (no `stones`
array) or if `widthMm`/`heightMm` are not positive finite numbers, instead of emitting a malformed
document. Each `<circle>` carries the stone's original color id as `data-color="<id>"` (e.g.
`data-color="gold"`), in addition to the display `fill`/`stroke` looked up from `StoneColors.js` —
this preserves the manufacturing-relevant color metadata that Generated Layout JSON already
carries per-stone. The per-stone `<circle>` string itself is `stoneCircleSvg(stone, xOffsetMm,
yOffsetMm)` (RS-1005) — `stoneLayoutToSvg()` calls it at offset `0,0`; `ProductionSheetExporter.js`
reuses the same helper when placing stones inside a larger page.

## Production Sheet Exporter (RS-1005)

`ProductionSheetExporter.js` turns a `StoneLayout` plus plain display metadata into a one-page,
millimeter-accurate manufacturing document: header (project name, object type, production size,
stone count, stone size(s), gap(s), crystal color(s), a page/margin/mirror/registration-marks
summary line), a labeled 50mm scale-reference bar, optional corner registration marks, and the
stone layout itself at true 1:1 size, optionally horizontally mirrored, centered in the printable
area (page size minus margin). Stone count, stone size(s), and crystal color(s) are always derived
from the `StoneLayout` itself, never passed in.

```js
import { computeProductionSheetLayout, productionSheetToSvg, productionSheetToPdf, PAGE_SIZES } from './src/export/ProductionSheetExporter.js';

const options = {
  projectName: 'Vitalina Serbin',
  objectType: 'Mug',
  productionWidthMm: 210,
  productionHeightMm: 90,
  gapMm: 0.3,           // number | number[] | null — not derivable from StoneLayout (Stone has no gap field)
  pageSize: 'A4',        // or 'Letter'
  marginMm: 10,
  mirror: false,
  registrationMarks: true
};

const svg = productionSheetToSvg(layout, options);
const pdfBytes = productionSheetToPdf(layout, options);   // Uint8Array
const descriptor = computeProductionSheetLayout(layout, options); // the shared pure layout both render
```

`computeProductionSheetLayout()` is the single pure geometry-projection pass both `productionSheetToSvg()`
and `productionSheetToPdf()` render — it invents no stone position, only re-projecting each
already-generated `stone.xMm/yMm` (centering translate, optional mirror) into page space, the same
category of transform `CanvasRenderer2D.fitTransform()` already applies for the on-screen canvas.
It picks the smallest-fitting orientation (portrait, then landscape) of the requested page size and
throws a clear `RangeError` if the production size cannot fit either orientation at the requested
margin — the sheet is never silently rescaled.

PDF output is produced by `PdfDocument.js`, a minimal, dependency-free, deterministic single-page
vector PDF writer (lines/rects/circles/text) over the standard, non-embedded Helvetica font.
Non-Latin-1 text degrades to `?` in PDF output only (a documented limitation — SVG/PNG output has
full Unicode text).

Production Sheet PNG has no dedicated exporter module: `app.js` rasterizes the generated SVG via an
offscreen `Image`+`<canvas>` at a fixed DPI, matching the existing "PNG is a render capture, not a
standalone exporter" shape `#exportPNG`/`#exportCup` already use.
