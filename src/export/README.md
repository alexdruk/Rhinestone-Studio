# Export

Exporters consume StoneLayout data and project metadata.

## SVG Exporter (RS-0003.5C2)

`SvgExporter.js` serializes a `StoneLayout` as a millimeter-scale SVG document. Pure string
generation — no DOM/Canvas dependency, no layer/type awareness.

```js
import { stoneLayoutToSvg } from './src/export/SvgExporter.js';

const svg = stoneLayoutToSvg(layout, { widthMm: project.canvas.width, heightMm: project.canvas.height });
```
