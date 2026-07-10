# Renderer

2D and 3D renderers display StoneLayout data. They must never generate or mutate stone positions.

## 2D Production Canvas Renderer (RS-0003.5C2)

`CanvasRenderer2D.js` draws a `StoneLayout` onto a `CanvasRenderingContext2D`. It has no
dependency on `Project`, `Layer`, or any layer type (text/circle/rectangle/future shapes) — only
`StoneLayout`, `Stone`, and plain viewport/transform numbers.

```js
import { renderProductionLayout } from './src/renderer/CanvasRenderer2D.js';

// Clears, fills the background, draws the fit-to-viewport reference grid, and draws every
// stone in `layout`. Returns the {s,ox,oy} mm->px transform used, so the caller can reuse it
// for layer-aware overlays (selection outline/handles, HUD text) drawn on top.
const { s, ox, oy } = renderProductionLayout(ctx, layout, { widthPx, heightPx, paddingPx });
```

Lower-level pieces (`drawStone`, `fitTransform`, `drawGrid`, `renderStoneLayout`) are exported
individually for reuse — `CupRenderer.js` reuses `drawStone`.

## Cup Preview Renderer (RS-0003.5C2)

`CupRenderer.js` draws the cup body, handle, and the `StoneLayout` projected onto it (front label
or wrapped, depending on `wrap`). Same rule: no layer/type awareness, only `StoneLayout` plus
plain display options.

```js
import { renderCup } from './src/renderer/CupRenderer.js';

renderCup(ctx, layout, {
  widthPx, heightPx, dpr,
  cupColor: '#1f3556', // hex
  wrap: 'front',        // 'front' | 'wide' | 'half' | 'full'
  rotationDeg: 0,
  zoom: 1
});
```

## Stone Colors (RS-0003.5C2)

`StoneColors.js` exports the `STONE_COLORS` display palette (fill/stroke/shine/accent per color
id) shared by both renderers and `src/export/SvgExporter.js`, so there is exactly one definition
instead of one copy per consumer.
