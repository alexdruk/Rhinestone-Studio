# RS-3036 — DXF Export (Cutting Template)

## Purpose

Add a DXF export of the production `StoneLayout` for use as a millimetre-scale cutting/reference
template in CAD/CAM and cutting software: one circle per stone, one layer per crystal color, plus
a `CANVAS` boundary polyline.

## Design Decisions

- **DXF version: R2007** (the `@tarikjabiri/dxf` library's default), not R12 — R12 predates the
  `$INSUNITS` header variable, and this exporter's units contract (millimetres, `$INSUNITS = 4`)
  depends on it being present.
- **No cut offset.** Circles are emitted at each stone's exact diameter (`sizeMm`), centered at its
  exact `xMm`/`yMm` (Y-flipped — see below). This is a positional/sizing reference, not a
  kerf-compensated cutting path; adding an offset is out of scope by design.
- **Y is flipped.** DXF is Y-up; `StoneLayout` (like `CanvasRenderer2D.js`) is Y-down. Every
  coordinate is emitted as `(xMm, heightMm - yMm)`.
- **One layer per crystal color**, named via `dxfLayerNameForColor(colorId)` (`'STONES_' +
  colorId.toUpperCase().replace(/[^A-Z0-9_-]/g, '_')`), plus a fixed `CANVAS` layer for the
  boundary rectangle.
- **Entity-layer sanitization finding:** the DXF writer's `addLayer()` sanitizes the *table* name it
  writes, but an entity's `layerName` option is written through unsanitized — passing an
  unsanitized name to `addCircle`/`addLWPolyline` would silently reference a layer that doesn't
  match the declared table entry. `dxfLayerNameForColor()` is therefore always computed once and
  passed as-is to both `addLayer()` and every entity's `layerName`, never re-derived.
- **Exporter boundary preserved**: `DxfExporter.js` imports only from `@tarikjabiri/dxf`. It has no
  knowledge of `GeometryEngine`, `Project`/`Layer` types, or the DOM — it consumes a `StoneLayout`
  exactly as `SvgExporter.js` does, and its validation errors mirror `stoneLayoutToSvg()`'s
  (`stoneLayoutToDxf requires a StoneLayout (an object with a stones array).` /
  `stoneLayoutToDxf requires a positive finite widthMm|heightMm.`).

## Scope

This closes the DXF part of RS-2007 (`docs/specifications/RS-2000A-PostMVPAudit.md`'s "Manufacturing
Export Expansion" candidate). Batch export and print layout, RS-2007's other two components, remain
open.

## Files

- `src/export/DxfExporter.js` — `dxfLayerNameForColor()`, `stoneLayoutToDxf()`.
- `app.js` — imports `stoneLayoutToDxf`; `#exportDXF` handler alongside the other export handlers.
- `index.html` — `#exportDXF` button in the "Production geometry" export group.
- `tools/test-rs3036-dxf-exporter.mjs` — new test file (registered in `tools/test-groups.mjs`'s
  `exporters` group).
- `tools/test-production-export-validation.mjs` — test 14 extended to cover `#exportDXF`.
- `tools/test-ui-shell-structure.mjs` — Export Lightbox id-list extended to include `exportDXF`.
