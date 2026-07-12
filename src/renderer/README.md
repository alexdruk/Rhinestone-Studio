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

## Crystal Color Catalog (RS-1007, supersedes RS-0003.5C2)

`CrystalColors.js` is the permanent crystal-color catalog: at least 17 named colors (Crystal,
Crystal AB, Jet, Siam, Light Siam, Rose, Fuchsia, Amethyst, Sapphire, Light Sapphire, Aquamarine,
Emerald, Peridot, Topaz, Citrine, Gold, Silver), each with a stable `id`, display `name`, `group`
(UI-organization only), a `previewColor` hex, optional `highlight`/`shadow` hex accents, and the
render-channel fields (`fill`/`stroke`/`shine`/`accent`) every consumer reads — `previewColor`/
`highlight`/`shadow` are aliases of `fill`/`shine`/`accent` respectively, so both naming schemes
always agree. These are decorative approximations, not calibrated to any specific manufacturer's
commercial color line.

`StoneColors.js` is now a one-line compatibility shim re-exporting the same `STONE_COLORS`
(id-keyed) map from `CrystalColors.js`, so every existing consumer — both renderers
(`CanvasRenderer2D.js`, `CupRenderer.js` via `drawStone`), `src/preview3d/StoneLayoutTexture.js`,
`src/export/SvgExporter.js`, `src/export/ProductionSheetExporter.js`, and `app.js` — keeps working
unchanged. The 7 ids that existed before RS-1007 (`crystal`, `gold`, `silver`, `jet`, `rose`,
`sapphire`, `emerald`) keep byte-identical `fill`/`stroke`/`shine`/`accent` values.

```js
import { STONE_COLORS } from './src/renderer/StoneColors.js'; // unchanged import path/shape
import { CRYSTAL_COLORS, getCrystalColor, listCrystalColorGroups } from './src/renderer/CrystalColors.js';

listCrystalColorGroups(); // [{ group: 'Clear & Neutral', colors: [...] }, ...] -- what app.js's
                           // #stoneColor <optgroup> selector iterates
```
