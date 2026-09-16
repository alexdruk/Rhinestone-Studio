# IMG-000 — Image-to-Strass Reuse Audit

## Purpose

Before scoping the eight-milestone Image-to-Strass roadmap (`IMG-001`..`IMG-008`), this audit lists
every function those milestones can reuse, with file:line citations verified by grep against this
clone. For each, it states whether the function is reused as-is, extended, or bypassed, and why.

## Field sampling — `src/geometry/StoneSampler.js`

* **`sampleFieldByMode(mode, field, placement, spacingMm, stoneSizeMm)`** —
  `src/geometry/StoneSampler.js:1770`. The single dispatcher `GeometryEngine.generateImageLayout()`
  already calls (`src/geometry/GeometryEngine.js:1165`) to route a raster field to one of its four
  samplers by `mode`. **Reused as-is.** IMG-002 (color layers) and IMG-006 (brightness sizes) will
  call it once per derived field/mask; none of the eight milestones need a second dispatcher.
* **Its four samplers**, all in `src/geometry/StoneSampler.js`:
  * `sampleFieldFillPoints(field, placement, spacingMm)` — `:1590`. Grid Fill.
  * `sampleStaggeredFieldFillPoints(field, placement, spacingMm)` — `:1636`. Staggered Fill.
  * `sampleRadialFieldFillPoints(field, placement, spacingMm, stoneSizeMm)` — `:1674`. Radial Fill.
  * `sampleContourFieldFillPoints(field, placement, spacingMm, stoneSizeMm)` — `:1724`. Contour Fill.
  **Reused as-is.** Each already reads only `field.data` at `field.widthPx`/`field.heightPx`
  resolution (grep-confirmed: none references `field.luminance`/`field.alpha`/`field.labels`), so
  IMG-001's multi-channel field (below) is additive and changes no sampler behavior. IMG-002/IMG-006
  will build additional single-channel fields (per-color masks, a size-selector field) and pass them
  through this same dispatcher/sampler family — no new sampler is anticipated before IMG-004 (edge
  awareness), which may need a fifth, edge-weighted sampler as new code.

## Overlap and dedup

* **`dedupeStonePoints(points, minDistanceMm)`** — `src/geometry/StoneSampler.js:332`. Grid-hash
  proximity filter used by Radial/Contour Fill and by every mixed-size infill path. **Reused as-is.**
  IMG-002's per-color layers are disjoint by color already (no cross-color overlap by construction,
  since each color's field only samples its own hue's pixels), but same-color multi-mode composition
  (a future milestone) could reuse this directly if it ever needs to merge two point sets.
* **`dropOverlappingSizedStones(assigned)`** — `src/geometry/StoneSampler.js:467`, called from
  `GeometryEngine.js:257` inside its own mixed-size-assignment path. **Reused as-is** by IMG-006
  (brightness-driven sizes): once brightness assigns a candidate size per point, this is the same
  "assign then drop overlaps" shape IMG-006 needs — see `GeometryEngine.js:225` and its own doc
  comment for the two-pass rationale.
* **`findCrossGroupCollisions(stones)`** — `src/geometry/StoneSampler.js:529`, exported from
  `src/geometry/index.js:49`, used by `src/monogram/MonogramGenerator.js` (e.g. `:1122`, `:1504`) to
  validate collisions across independently-generated groups. **Reused as-is** by IMG-002: once each
  color's stones are generated as an independent group (mirroring how `MonogramGenerator.js` treats
  per-letter groups), this is the existing "prove no two groups collide" check — no second collision
  algorithm needed.
* **`generateMixedSizeInfillStones` / `generateMixedSizeInfillPoints`** —
  `src/geometry/MixedSizeGenerator.js:255` / `:228`. S-200's additive infill pass, already accepts a
  `{ kind: 'field', field, placement }` source (used today by `generateImageLayout()`'s own Mixed
  Stone-Size support, `GeometryEngine.js:1178`). **Reused as-is, unchanged.** IMG-006 (brightness
  sizes) is a *different* mechanism (per-point size driven by measured brightness, not an additive
  gap-filling pass) and will not call this; IMG-001 does not touch Mixed Stone-Size at all — a
  Mixed-mode image layer keeps working exactly as today, since IMG-001 changes only
  `prepareImageField()`'s return shape and adds an opt-in `transparent` param, not `field.data`'s
  values for any existing caller.

## Catalogs

* **`CrystalColors.js`** (`src/renderer/CrystalColors.js`) — `CRYSTAL_COLORS`/`CRYSTAL_COLOR_LIST`
  (`:132`), `STONE_COLORS` (`:135`), `getCrystalColor`/`isValidCrystalColorId` (`:140`/`:144`),
  `listCrystalColorGroups` (`:149`), `isValidHexColor`/`validateCrystalColorCatalog` (`:165`/`:175`).
  **Reused as-is.** IMG-002's color quantization needs to map traced pixel colors to the *nearest
  catalog crystal color*, not invent a new palette — `CRYSTAL_COLOR_LIST`'s existing hex values are
  the quantization target set. No extension needed until a quantizer is designed (IMG-002's own
  milestone), at which point it calls `listCrystalColorGroups()`/`getCrystalColor()` exactly as every
  other color-picking UI control already does.
* **`StoneSizes.js`** (`src/renderer/StoneSizes.js`) — `STONE_SIZES`/`STONE_SIZE_LIST` (`:45`),
  `STONE_SIZE_BY_ID` (`:48`), `getStoneSize`/`isValidStoneSizeId` (`:53`/`:57`), `listStoneSizes`
  (`:62`), `findStoneSizeByDiameterMm` (`:77`), `stoneSizeRungsAvailable`/`stoneSizesFromBaseMm`
  (`:106`/`:120`), `formatStoneSizeLabel` (`:140`), `stoneSizeHeightMidpointMm`/
  `isHeightWithinStoneSizeRange`/`stoneSizeEntirelyExceedsPrintableHeight` (`:152`/`:158`/`:170`),
  `validateStoneSizeCatalog` (`:182`). **Reused as-is.** IMG-006 (brightness sizes) needs exactly
  this catalog — a brightness value maps to one of the existing named rungs (SS6/SS10/SS16/...), the
  same catalog S-200's Allowed Sizes checkboxes and Mixed Stone-Size min/max selects already read
  (`docs/specifications/S-200-MixedStoneSizeLayouts.md`, "Manufacturing Considerations"). No new size
  system.

## Exporters — `src/export/` (4 files, verified by `ls`)

* **`SvgExporter.js`** (`stoneCircleSvg`/`stoneLayoutToSvg`) — reads only `stone.xMm`/`yMm`/`sizeMm`/
  `color` per stone (per-stone, not per-layer-type). **Reused as-is** for every IMG milestone: a
  multi-color, multi-size, multi-mode image layer's stones are still ordinary `Stone` instances in
  one `StoneLayout` by the time any exporter sees them (IMG-002's per-color layers still concatenate
  into stones on the same `layerId`, per "Architecture" below) — confirmed by grep,
  `src/export/SvgExporter.js` has zero references to `layer.type`, `sourceMode`, or anything
  image-specific.
* **`DxfExporter.js`** (`stoneLayoutToDxf`/`dxfLayerNameForColor`) — `src/export/DxfExporter.js:60-66`
  (verified by reading the file directly): builds `colors = [...new Set(stoneLayout.stones.map(s =>
  s.color))].sort()`, adds one DXF layer per distinct color via `dxfLayerNameForColor(color)`
  (`:30-31`, `'STONES_' + colorId.toUpperCase().replace(...)`), then places every stone's circle on
  its own color's layer (`:66`, `layerName: dxfLayerNameForColor(s.color)`) at `s.sizeMm / 2` radius.
  **`DxfExporter.js` separates DXF layers by color only, not by size.** Stones of different `sizeMm`
  sharing one color land on the same DXF layer as circles of different radii — there is no
  size-keyed layer name or grouping anywhere in the file (confirmed: `sizeMm`/`.d`/`.size` appears
  exactly once, at the `addCircle(...)` radius argument, never in a layer-naming expression).
  **Reused as-is** for IMG-001 (no color/size change yet); IMG-002's per-color layers map directly
  onto this existing per-color grouping (no exporter change needed — it already groups by whatever
  distinct `color` values exist in the `StoneLayout`, regardless of which layer type produced them).
  IMG-006's brightness sizes will **not** get separate DXF layers automatically — a future milestone
  wanting per-size cutting layers (mirroring `ProductionSheetExporter.js`'s existing per-size
  `sizeBreakdown`, `docs/specifications/S-200-MixedStoneSizeLayouts.md`) would need to extend
  `dxfLayerNameForColor` into a `dxfLayerNameFor(color, sizeMm)` or add a second grouping key — out
  of scope for IMG-001, noted here for IMG-006/IMG-008 to pick up.
* **`ProductionSheetExporter.js`** (`computeProductionSheetLayout`/`productionSheetToSvg`/
  `productionSheetToPdf`) — already computes a `sizeBreakdown` grouped by color then size (S-200).
  **Reused as-is.** A multi-color, multi-size image layer's stones flow through the exact same
  per-stone grouping every other layer type's stones already do.
* **`PdfDocument.js`** (`PdfDocument`/`createPdfDocument`) — the shared low-level PDF page/primitive
  writer `ProductionSheetExporter.js`'s PDF path calls. **Reused as-is**, no image-specific content.

## `app.js`

* **`imageBufferCache`** — `app.js:230` (`const imageBufferCache=new Map()`), read/written at
  `app.js:926` (`generateImageStonesLive()`), `app.js:3069-3070` (`resolveLayerShapeSource()`'s
  Boolean-Operations field resolution), and `app.js:5118` (fresh import). Keyed by the layer's
  persisted `imageSrc` data: URL, memoizing the **decoded RGBA buffer** (pre-field-preparation).
  **Reused as-is** by every IMG milestone that still decodes the same source image once per layer —
  IMG-001 adds no second decode step and does not change this cache's key or contents (the decoded
  buffer is unchanged; only what `prepareImageField()` computes *from* it changes). IMG-002's color
  quantization reads the same cached RGBA buffer's color channels (today only `Grayscale.js` reads
  R/G/B; IMG-002 will read them again, not via a new decode).
* **Image Trace Lightbox controls** (`index.html`) — the import-preview panel
  (`imgPreviewThreshold`/`imgPreviewInvert`/`imgPreviewBlur`/`imgPreviewMaxWidth`/
  `imgPreviewMaxHeight`, `index.html:1134-1142`) and the edit panel (`imgThreshold`/`imgInvert`/
  `imgBlurRadius`/`imgMaxWidth`/`imgMaxHeight`, `index.html:1154-1162`, plus `imageFillMode` at
  `:1166-1171`), wired in `app.js` via `currentImagePreviewParams()`/`updateImagePreview()`
  (`app.js:5083-5109`), `writeSelectedControlsToLayer()`'s image branch (`app.js:2546`),
  `syncSelectedControlsFromLayer()`'s image branch (`app.js:2395`), and
  `HISTORY_TRACKED_CONTROL_IDS` (`app.js:4652`). **Extended, not bypassed**, by IMG-001: one new
  two-option control (Transparency) is added to both panels next to Invert, following the exact same
  wiring shape every existing control here already uses (preview-panel default + live-recompute on
  `input`; edit-panel read/write/history-track). No new control-wiring pattern is introduced.

## Conclusion

Every function this audit lists already exists, is already the single implementation for its
concern, and needs no duplication to support the eight-milestone roadmap. The two genuinely new
things `IMG-001` introduces — the multi-channel field return shape and the transparency policy — are
additive fields on `prepareImageField()`'s return value and one new normalized param, respectively;
nothing above is replaced or forked.
