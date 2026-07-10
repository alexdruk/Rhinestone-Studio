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
carries per-stone.
