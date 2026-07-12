# RS-1013 — Variable Stone Sizes (Stone Library)

## Numbering note

The task brief for this milestone was labeled "RS-1010," but RS-1010 is already used — and merged
into `develop` — for the Alignment & Snapping Upgrade
(`docs/specifications/RS-1010-AlignmentSnappingUpgrade.md`). This work is filed as **RS-1013**, the
next free id after RS-1012A, to avoid colliding with existing history. All branch, test, and
documentation references in this milestone use RS-1013.

## Objective

Allow each layer to use its own stone size while keeping the production pipeline deterministic.
The selected stone size affects geometry generation only; rendering, exports, Production Sheet,
and 3D preview consume the resulting `StoneLayout` exactly as they do today. Add a configurable,
extensible "Stone Library" of standard commercial rhinestone sizes (SS6, SS10, SS16, SS20, SS30),
displayed with both commercial name and actual diameter.

## Audit Findings (before implementation)

Per-layer variable stone size was **already fully implemented** at the geometry/rendering layer
before this milestone touched anything:

* `GeometryEngine` (`src/geometry/GeometryEngine.js`) already accepts an independent
  `stoneSizeMm`/`gapMm` pair on every one of its six `generate*Layout()` methods — text (including
  curved text, a mode of the text layout, not a separate layer type), shape (circle/rectangle),
  svg, image, and path. Each call is independent; nothing caches or shares a "current" stone size
  across layers.
* `Stone` (`src/geometry/Stone.js`) already carries its own `sizeMm` per instance — a `StoneLayout`
  has never assumed a uniform stone size.
* Every renderer/exporter already draws each stone at its own individual `sizeMm`, with no
  per-layer-type or per-size special case: `CanvasRenderer2D.js`, `CupRenderer.js`,
  `StoneLayoutTexture.js` (3D preview), `SvgExporter.js`, `ProductionSheetExporter.js`. Mixing
  sizes across layers in one project already rendered/exported correctly.
* The live application (`app.js`) already stores a `stoneSize` field per plain-object layer and
  already forwards it independently to `GeometryEngine` for every layer type
  (`generateTextStonesLive`/`generateShapeStonesLive`/`generateSvgStonesLive`/
  `generateImageStonesLive`/`generatePathStonesLive`).
* Undo/redo (`HISTORY_TRACKED_CONTROL_IDS` already includes `'stoneSize'`), duplicate
  (`duplicateLayer()`'s `JSON.parse(JSON.stringify(l))` deep clone, applied before any per-type
  position nudge), and save/load (`JSON.stringify(project)` / the ad hoc `validateProject()`) are
  already fully generic over every layer field, `stoneSize` included — no dedicated code exists or
  is needed for any of these per field.
* **Two parallel "layer" models exist** (a pre-existing, documented gap — see
  `docs/specifications/RS-1012-VectorBooleanOperations.md`'s own audit): `src/core/Layer.js`/
  `Project.js` is a tested but **unused-by-the-browser-app** model (only
  `tools/test-core-model.mjs` imports it — it already has a `stoneSizeMm` param, unrelated to this
  milestone). The live app is `app.js`'s own plain-object `project.layers`, which is what this
  milestone had to extend.

**What was actually missing:** a named, extensible catalog mapping commercial rhinestone sizes
(SS6, SS10, ...) to their nominal millimeter diameter, and its wiring into the UI (the one shared
`#stoneSize` picker) and the Production Sheet header. Before this milestone, `#stoneSize` was a
static, unnamed list of raw millimeter values (0.8-3.0mm) with no commercial-size vocabulary at
all.

## Architecture

`GeometryEngine` remains the single authority for stone placement; `StoneLayout` remains the single
production representation; every renderer/exporter continues to consume `StoneLayout` only. This
milestone adds **zero** geometry, rendering, or exporter capability — see "Audit Findings" above —
so none of `src/geometry/**`, `src/renderer/CanvasRenderer2D.js`, `src/renderer/CupRenderer.js`,
`src/preview3d/**`, or `src/export/SvgExporter.js` change.

### `src/renderer/StoneSizes.js` (new)

A pure data/validation catalog module, in the same shape and location as
`src/renderer/CrystalColors.js` (the RS-1007 crystal-color catalog this milestone's Stone Library
deliberately mirrors): a list of `{ id, name, diameterMm }` records, an id-keyed map, and lookup/
validation helpers (`listStoneSizes()`, `getStoneSize(id)`, `findStoneSizeByDiameterMm(mm)`,
`formatStoneSizeLabel(mm)`, `validateStoneSizeCatalog()`). Nothing in `src/geometry/**` reads this
file — a layer's `stoneSize` / a `Stone`'s `sizeMm` remain the same plain millimeter number they
always were; the catalog exists purely so the UI can show a commercial name next to that number.
Adding a new standard size later is exactly one more list entry, never a switch statement anywhere
in the codebase.

Shipped catalog (nominal diameters — not calibrated to any specific manufacturer's tolerance spec,
the same "decorative approximation" posture `CrystalColors.js` already takes for its hex values):

| Name | Diameter |
|---|---|
| SS6 | 2.0 mm |
| SS10 | 2.8 mm |
| SS16 | 4.0 mm |
| SS20 | 4.7 mm |
| SS30 | 6.4 mm |

### UI wiring (`app.js` / `index.html`)

The one shared `#stoneSize` `<select>` (relocated between the right inspector and whichever
Lightbox is open, exactly like `#stoneColor`/`#gap` already are — see `app.js`'s "Shared
field-group relocation" / `FIELD_GROUPS`) is populated at startup from the catalog
(`populateStoneSizeOptions()`, mirroring the pre-existing `populateStoneColorOptions()`), each
option reading e.g. "SS16 — 4.0 mm". Reading the control back
(`parseFloat(el('stoneSize').value)`) is unchanged, because an option's value is still the plain
millimeter number a layer's `stoneSize` has always been — no new mapping layer between the picker
and the geometry pipeline.

**Backward compatibility:** a project saved before this milestone (or a value produced by
undo/redo history, or simply hand-edited JSON) can hold a `stoneSize` that matches no catalog
entry. Rather than silently snapping the dropdown's displayed selection to the nearest *different*
catalog size — which would misrepresent the layer's real, unchanged `stoneSizeMm` — a new
`ensureStoneSizeOption(select, diameterMm)` injects a truthful, single synthetic "Custom — X mm"
option holding the exact stored value whenever it has no catalog match, called from
`syncSelectedControlsFromLayer()` immediately before the existing `setNumericSelectValue()` call.
This keeps `setNumericSelectValue()`'s nearest-match algorithm itself unchanged: after
`ensureStoneSizeOption()` runs, an exact-match option always exists, so the nearest match is always
the exact one.

### Production Sheet (`src/export/ProductionSheetExporter.js`)

The one exporter change this milestone makes, required by the "Display both commercial name and
actual diameter" acceptance criterion: the header's "Stone size: ..." line now runs each distinct
size through the new `formatStoneSizeLabel()`, e.g. "SS6 (2 mm), SS16 (4 mm)" for a mixed-size
project, falling back to a plain "1.5 mm" for a custom, non-catalog value. `distinctSizesMm` (the
raw numeric array `computeProductionSheetLayout()` returns, read directly by
`tools/test-production-sheet-exporter.mjs`) is unchanged — only the formatted header string gained
the commercial name.

## Out of scope

* No change to `GeometryEngine`, `StoneLayout`, `Stone`, or any renderer/exporter beyond the one
  Production Sheet header line above.
* No change to `src/core/Layer.js`/`Project.js` — they remain unused by the live app, exactly as
  every prior `app.js`-only milestone has left them (see RS-1009/RS-1010/RS-1012's own specs).
* No user-facing "add a custom size to the library" UI — the catalog is developer-editable
  (`src/renderer/StoneSizes.js`), matching the ticket's "avoid hard-coded switch statements,
  configurable list" requirement at the code level, not a runtime admin UI.
* No manufacturer-exact tolerance claims — diameters are nominal industry values, same posture as
  `CrystalColors.js`.

## Tests

* `tools/test-stone-size-library.mjs` (new) — catalog correctness: required sizes present with
  documented diameters, unique/well-formed ids and names, ascending order, lookup/validation
  helpers, no manufacturer trademark reference.
* `tools/test-variable-stone-sizes.mjs` (new) — end-to-end: every catalog size produces geometry
  with matching `Stone.sizeMm`; mixed per-layer sizes across text/curved-text/circle/rectangle/svg/
  image/path in one combined layout; Production Sheet header formatting (catalog name + custom
  fallback); SVG export/Production Sheet SVG render each stone at its own radius; `#stoneSize`
  dropdown population and the `ensureStoneSizeOption()` custom-fallback logic, executed against the
  real app.js source; undo/redo/duplicate/save-load genericity; new-layer stoneSize inheritance;
  forbidden-file guard.
* `tools/test-ux-visual-polish.mjs` test 4 updated for the now dynamically-populated `#stoneSize`
  dropdown (previously asserted a static `<option>` list).
* `tools/test-app-module-migration.mjs` / `tools/test-shape-geometry-integration.mjs` — their
  app.js import allow-lists extended for the new `src/renderer/StoneSizes.js` import.
* Several pre-existing milestone-scoped forbidden-file guards
  (`tools/test-crystal-color-catalog.mjs`, `tools/test-crystal-color-integration.mjs`,
  `tools/test-preview3d-integration.mjs`, `tools/test-alignment-snapping-upgrade.mjs`,
  `tools/test-alignment-snapping-integration.mjs`, `tools/test-ui001b-fixes.mjs`,
  `tools/test-image-integration.mjs`, `tools/test-image-trace-regression.mjs`,
  `tools/test-path-boolean-integration.mjs`) extended with an `allowedDespitePrefix` /
  `forbiddenExactWithinPrefix` exception for `src/renderer/StoneSizes.js` and
  `src/export/ProductionSheetExporter.js`, following this codebase's established convention (see
  the RS-1008A/RS-1012 precedents already documented in those same files) of amending an older
  milestone's own guard when a later, legitimate milestone touches a previously-forbidden file.

`npm test` passes in full (52 suites).
