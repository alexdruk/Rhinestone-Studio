# IMG-002 — Color Quantization and Color Layers

## Objective

IMG-002 is the second of `IMG-001`'s eight-milestone roadmap (`docs/specifications/IMG-001-ImageToStrass.md`
item 2). It populates the `labels` field IMG-001 reserved as `null`: quantizing a traced image's
colors down to a small palette and coloring each generated stone by which quantized color its pixel
belongs to, so a multi-color source image produces a multi-color `StoneLayout` on one `layerId`
instead of the single `layer.color` every image layer is limited to today. No new sampling algorithm,
no exporter change — a color-quantized image layer's stones are still ordinary `Stone` instances with
per-stone `color`, exactly what every exporter already reads (`docs/specifications/IMG-000-ImageToStrassAudit.md`,
"Exporters" section).

## Decisions

1. **Sample once, label after.** `GeometryEngine.generateImageLayout()`
   (`src/geometry/GeometryEngine.js:1164`) keeps calling `sampleFieldByMode()`
   (`src/geometry/StoneSampler.js:1770`) exactly once on `field.data`, as today; positions, count and
   index order are byte-identical to today's output for every mode.

   `fieldPixelOn()` (`src/geometry/StoneSampler.js:1614`) is not usable for the label lookup as-is: it
   takes LOCAL mm measured from the placement box's own corner, but a `Stone` carries absolute
   `xMm`/`yMm`, and a fresh import is never placed at the origin (`app.js:5098` computes a real
   `x`/`y` from the decoded image's own dimensions) — reading labels at a stone's absolute coordinates
   would read the wrong pixel. `fieldPixelOn()` is also module-private (no `export` keyword, and not
   in `src/geometry/index.js`), so it cannot be called from outside `StoneSampler.js` regardless. A
   new exported helper, `fieldLabelAt(field, placement, xMm, yMm)` (`src/geometry/StoneSampler.js`,
   new), subtracts `placement.xMm`/`placement.yMm` to get the same local coordinates `fieldPixelOn()`
   expects, then applies `fieldPixelOn()`'s own clamped `floor((local/extentMm)*extentPx)` formula,
   returning the label byte at that pixel (`NO_LABEL` if the resolved pixel is off-field).
   `sampleFieldFillPoints()` (`src/geometry/StoneSampler.js:1590`) already applies that identical
   formula inline, rather than calling `fieldPixelOn()`, to place its own points — `fieldLabelAt()`
   reuses the same formula so the two agree pixel-for-pixel on which cell a given local coordinate
   falls into. Each resulting stone (base and S-200 infill alike — infill stones are constructed
   directly inside `generateImageLayout()` rather than via a wrapper that only takes one color; see
   Structure below) calls `fieldLabelAt(field, placement, stone.xMm, stone.yMm)` and takes its color
   from that label's group; only `Stone.color` changes from today's output.

   Measured, not assumed: across nine field shapes (disc, annulus, C-shape, two blobs, comb, spiral,
   coarse 24px checker, pixel noise, thin cross) and all four modes, with the placement box offset to
   `(10, 7)` mm (not the origin — the same non-origin condition that motivated `fieldLabelAt()` above),
   zero sampled points landed on a pixel below `FIELD_ON_THRESHOLD`. This is expected, not a
   coincidence: `sampleFieldByMode()` only ever emits a point where its own on/off test already
   passed, so `fieldLabelAt()` reading the same field at the same coordinates always lands on an "on"
   pixel too — one that was clustered (assigned a real label between `0` and `K-1`) whenever
   `colorCount > 1`, since the quantizer clusters every `data`-eligible pixel (decision 2). S-200
   infill points inherit this guarantee because they are produced by the same `sampleFieldByMode()`-
   driven field test (`generateMixedSizeInfillPoints()`'s `source: { kind: 'field', field, placement }`
   — see Structure below). `NO_LABEL` at a sampled point is therefore unreachable in practice, but
   `fieldLabelAt()` returning it is still handled defensively: such a stone falls back to the layer's
   own `color` (the same value `colorCount:1` stones already use), rather than throwing or silently
   mis-coloring.

   Per-mask sampling — running `sampleFieldByMode()` once per color against a color-restricted field
   — was rejected. Re-derived directly rather than assumed: on a three-color disc in a 60×60 mm box at
   SS10 + 0.3 mm gap, per-mask sampling matched union sampling for Fill/Staggered/Radial (214/250/223
   stones both ways) but not Contour (187 vs 216 stones). On a wavy two-color boundary, per-mask
   Contour gave 194 vs 235 stones and a minimum cross-color center distance of 3.143 mm against a
   3.3 mm pitch — which `findCrossGroupCollisions()` at `d = stoneSizeMm + gapMm`
   (`src/geometry/StoneSampler.js:529`) reports as one colliding pair. A checkerboard split gave 129
   vs 235 stones. Contour Fill's ring-tracing walk is sensitive to exactly which pixels are "on" in
   the field it walks, so restricting that field per color changes which rings it finds, not merely
   which color they're labeled — sample-once-label-after has no such sensitivity because the sampled
   point set never depends on the palette.

   `docs/specifications/IMG-000-ImageToStrassAudit.md`'s `findCrossGroupCollisions()` and
   `dedupeStonePoints()` bullets each get one sentence appended recording that their "disjoint by
   color already" framing held only for the lattice-placement modes, and that IMG-002 partitions one
   sampled point set rather than sampling each color's field independently — see "Files Touched"
   below for the exact text.

2. **Quantizer in a new pure `src/image/ColorQuantize.js`, palette-agnostic.** `prepareImageField()`
   (`src/image/ImageFieldPipeline.js:89`) gains `colorCount` (integer 1..8, default 1) and `palette`
   (`[{id, hex}]`, required when `colorCount > 1`) alongside its existing params, normalized by
   `normalizeParams()` (`src/image/ImageFieldPipeline.js:38`).

   When `colorCount > 1`: composite R, G, B onto white per channel (the same alpha-onto-white
   rationale `toGrayscale()` already uses, `src/image/Grayscale.js:21`), resize each channel to the
   working resolution the same way `data`/`luminance`/`alpha` already are, then cluster only pixels
   whose `data` value is `>= FIELD_ON_THRESHOLD` (`src/geometry/StoneSampler.js:1566`, value `128` —
   `src/image` does not import `src/geometry`, so `ColorQuantize.js` carries its own copy of this
   threshold value, kept in sync by the Test Plan's "`FIELD_ON_THRESHOLD` parity" case below, which
   imports both constants and asserts equality) using median cut on a 5-bit-per-channel RGB histogram,
   followed by 8 fixed weighted k-means passes over the histogram bins (ties broken by bin index, so
   the result is deterministic across runs on identical input). Every eligible pixel then maps to a
   label via its bin.

   Returns `labels` (`Uint8ClampedArray`, values `0..K-1`, `255 = NO_LABEL` for pixels off in `data`)
   and `colorGroups: [{rgb:[r,g,b], pixelShare, nearestId}]`, where `nearestId` is the CIE76
   Lab-nearest entry in the supplied `palette`. With `colorCount` omitted or `1`, nothing runs and
   `labels` stays `null` — every IMG-001 caller and test is unchanged.

   `colorGroups` is a seventh field key, present only when `colorCount > 1` (and therefore `labels` is
   non-null); with `colorCount` omitted or `1`, the field keeps exactly IMG-001's six keys. This
   matters because `tools/test-img-001-field.mjs`'s case 2 (`:80`) asserts the field's key set is
   exactly `{widthPx, heightPx, data, luminance, alpha, labels}` — that assertion, and every other case
   in the file, calls `prepareImageField()` with no `colorCount`, so the shape it observes stays
   byte-identical and **the file needs no change**.

   `src/image/**` still never imports `src/geometry/**` or `src/renderer/**` (RS-1008A, restated by
   `IMG-001-ImageToStrass.md`'s Architectural Rules); `src/geometry/**` still never reads
   `CrystalColors.js` directly. `app.js` supplies the palette from `CRYSTAL_COLORS`
   (`src/renderer/CrystalColors.js:132`) as plain `{id, hex}` data, the same boundary
   `populateStoneColorOptions()` (`app.js:242`) already crosses for the existing single-color picker.

3. **Persistence: `layer.colorCount` and `layer.colorMap`.** `layer.colorCount` (absent resolves to
   `1`) and `layer.colorMap` (a plain object, `nearestId -> overrideId`, absent resolves to `{}`).
   `generateImageLayout()` takes `colorCount`, `palette`, `colorMap`; a labeled stone's color becomes
   `colorMap[group.nearestId] ?? group.nearestId`.

   Keying overrides by the quantizer's auto-assigned `nearestId` rather than by cluster index is
   deliberate: re-thresholding (or any param change that reruns quantization) re-clusters and can
   renumber which bin is cluster 0 vs cluster 1, but `nearestId` is derived from the cluster's actual
   RGB centroid each time, so an override the user picked for "the red cluster" keeps landing on the
   red cluster's override rather than silently migrating to whatever cluster happens to occupy that
   index after the next regeneration.

   Two clusters can be nearest the same catalog entry — plausible with 18 catalog entries and `K` up
   to 8 — which would otherwise leave `colorMap`'s key ambiguous, with two rows writing one key and
   two distinct clusters collapsing to one color. `nearestId` is therefore assigned greedily: clusters
   are visited in descending `pixelShare` order, each catalog entry can be claimed by at most one
   cluster, and a cluster whose nearest entry is already claimed falls through to its own next-nearest
   unclaimed entry. This keeps all `K` groups' `nearestId`s distinct, so `colorMap`'s keys stay unique
   and no override can land on more than one cluster.

   Read-site permissive defaults, no `validateProject()` change, no project version bump — the same
   precedent `layer.transparent` established in IMG-001 (`docs/specifications/IMG-001-ImageToStrass.md`,
   "Compatibility") and S-200 established for `sizeMode`/`allowedSizesMm`. Fresh imports default
   `colorCount: 1`, matching the fresh-import layer defaults block at `app.js:5098` (unchanged: a new
   `colorCount: 1` field joins that literal alongside the existing `transparent: 'ignore'`).

4. **Studio Colours group.** `#imageStudioGroupColors` (`index.html:1170`, the closed placeholder
   `IMG-007` reserved) gets real content and joins `IMAGE_STUDIO_LIVE_GROUP_IDS`
   (`app.js:5976`) so `renderImageStudio()` (`app.js:5977`) keeps it live like Trace/Position &
   size/Stones; it starts open by default now that it has content, matching those three groups
   instead of the four still-inert placeholders.

   Contents: `#imgColorCount` (`<select>`, 1..8); eight static rows `#imgColorGroup0`..
   `#imgColorGroup7` (hidden beyond the current `colorCount`), each showing a centroid swatch, a
   pixel-share percentage, and a catalog `<select>` — `#imgColorPick0`..`#imgColorPick7`, one per row —
   populated by `populateStoneColorOptions()` (`app.js:242`, called once per row with that row's own
   `imgColorPickN` id as `targetId`); `#imgColorReset` clears `layer.colorMap`. `#stoneColor` is
   disabled (with an explanatory `title`) while `colorCount > 1`, since per-stone color then comes
   entirely from `colorMap`.

   A fifth `#imageStudioView` radio, "Colours", paints `field.labels` through a new pure
   `labelsFieldToRgba(field, fillsByLabel)` in `src/image/ImagePreviewRender.js`, beside the existing
   `maskFieldToRgba()` (`src/image/ImagePreviewRender.js:16`) it's modeled on — `fillsByLabel` is
   built in `app.js` from each row's resolved catalog color, keeping palette knowledge out of
   `src/image`. Stats column (`#imageStudioStats`) is unchanged by this milestone.

   The image-layer control readback branch at `app.js:2551` gains `l.colorCount` and (from the reset
   button and per-row selects) `l.colorMap` writes alongside its existing `l.threshold`/`l.invert`/
   etc. writes; the new control ids (`imgColorCount`, `imgColorPick0`..`imgColorPick7`, `imgColorReset`)
   join `HISTORY_TRACKED_CONTROL_IDS` (`app.js:4660`) and the studio id list
   `tools/test-ui-shell-structure.mjs:201` already asserts against.

5. **Test plan.** New `tools/test-img-002-color-layers.mjs`, registered in `tools/test-groups.mjs`'s
   `core` and `geometry` groups immediately after `test-img-001-field.mjs` (`tools/test-groups.mjs:59`
   and `:176`). Full case list in "Test Plan" below.

## Structure

Data flow, extending IMG-001's field contract:

```
prepareImageField(imageBuffer, {..., colorCount, palette})
  -> ColorQuantize.js (new, pure): median-cut + k-means over eligible pixels
  -> field.labels populated (was null), field.colorGroups new

GeometryEngine.generateImageLayout({..., colorCount, palette, colorMap})
  -> sampleFieldByMode() unchanged, one call, produces the same point set as colorCount:1
  -> each base stone's label looked up via fieldLabelAt(field, placement, stone.xMm, stone.yMm)
  -> Stone.color = label===NO_LABEL ? layer.color : (colorMap[group.nearestId] ?? group.nearestId)
     (NO_LABEL is unreachable in practice per decision 1's measured sweep; the fallback is defensive)
  -> S-200 infill: generateMixedSizeInfillPoints() called directly (GeometryEngine.js, new call site),
     not generateMixedSizeInfillStones() -- its Stone-wrapping convenience takes only one `color`
     argument (MixedSizeGenerator.js:255) and cannot carry per-point color. generateImageLayout()
     builds infill Stones itself from the returned points, the same direct-call pattern
     generateTextLayout() already uses for its own per-point needs (GeometryEngine.js:293; see
     MixedSizeGenerator.js:246's own doc comment for why), applying the identical fieldLabelAt() +
     colorMap lookup as base stones. MixedSizeGenerator.js itself needs no change.
  -> findCrossGroupCollisions() available for tests to prove per-color groups never overlap
```

UI flow: `#imgColorCount` change re-runs `renderImageStudio()`, which calls `generateImageLayout()`
with the current `palette` (built from `CRYSTAL_COLORS`) and reads back `result.stones` grouped by
`color` to populate each visible `#imgColorGroupN` row's swatch/share/select from `field.colorGroups`;
picking a catalog color in a row writes `layer.colorMap[nearestId]` and triggers the same live
regeneration every other Studio control already does. The "Colours" `#imageStudioView` radio calls
`labelsFieldToRgba()` the same way "Mask" already calls `maskFieldToRgba()`.

## Out of Scope

* Organic/edge/check-fix/brightness generation — IMG-003 through IMG-006 placeholders
  (`#imageStudioGroupOrganic`/`Edges`/`CheckFix`/`Brightness`) stay closed and inert.
* IMG-008's vector-first SVG export path.
* Any `StoneSampler.js` sampling-algorithm change — `sampleFieldByMode()` is called exactly as today.
* Any exporter change — per-color grouping already follows `stone.color`, which every exporter already
  reads per-stone (`docs/specifications/IMG-000-ImageToStrassAudit.md`, "Exporters").
* Blur-halo handling: a blurred halo pixel is `data`-eligible like any other pixel and clusters as
  whatever color its own composite lands on — this is documented, known behavior, not a defect IMG-002
  fixes.
* Boundary blending: R/G/B are box-averaged to the working resolution before clustering (the same
  resize step `data`/`luminance`/`alpha` already go through), so pixels on a color boundary blend to
  an intermediate hue, and a blended band can claim its own cluster slot when `K` is small — most
  visible on edge-heavy art at the shipped `DEFAULT_IMAGE_MAX_DIMENSION_PX` default of 400px
  (`app.js:224`). Documented, known behavior, not a defect IMG-002 fixes.
* Any change to `src/geometry/MixedSizeGenerator.js` — `generateMixedSizeInfillPoints()` (`:228`) is
  called directly by `generateImageLayout()`, the same direct-call pattern `generateTextLayout()`
  already uses (`GeometryEngine.js:293`; see `MixedSizeGenerator.js:246`'s own doc comment for why);
  `generateMixedSizeInfillStones()`'s single-`color`-argument wrapper (`:255`) is simply not called
  for image layers, so the file itself needs no change.

## Files Touched

* `src/image/ColorQuantize.js` (new) — median-cut + k-means quantizer, pure, no `src/geometry`/
  `src/renderer` imports.
* `src/image/ImageFieldPipeline.js` — `normalizeParams()` (`:38`) gains `colorCount`/`palette`;
  `prepareImageField()` (`:89`) calls the quantizer and populates `labels`/`colorGroups`.
* `src/image/ImagePreviewRender.js` — new `labelsFieldToRgba()` beside `maskFieldToRgba()` (`:16`).
* `src/image/index.js` — exports `ColorQuantize.js`'s entry point and the new `labelsFieldToRgba()`,
  alongside the existing `ImageFieldPipeline.js`/`ImagePreviewRender.js` exports.
* `src/image/README.md` — "Multi-channel field" (`:59`) and "Public API" (`:109`) sections updated for
  `colorCount`/`palette`/`labels`/`colorGroups` and the two new exports.
* `tools/test-img-001-field.mjs` — **not touched.** Its case 2 (`:80`) key-set assertion and every
  other case call `prepareImageField()` with no `colorCount`; `colorGroups` is added only when
  `colorCount > 1`, which no IMG-001 test exercises, so the six-key shape it asserts is unaffected.
* `src/geometry/StoneSampler.js` — new exported `fieldLabelAt(field, placement, xMm, yMm)`, beside the
  module-private `fieldPixelOn()` (`:1614`) it reuses the pixel-resolution formula from.
* `src/geometry/index.js` — exports `fieldLabelAt` alongside the existing `StoneSampler.js` export
  list.
* `src/geometry/GeometryEngine.js` — `normalizeImageParams()` (`:2221`) gains `colorCount`/`palette`/
  `colorMap`; `generateImageLayout()` (`:1164`) labels stones per point via `fieldLabelAt()` and builds
  its own labeled infill Stones from `generateMixedSizeInfillPoints()` (see Structure).
* `docs/specifications/IMG-001-ImageToStrass.md` — one sentence added to its Field Contract section
  noting `labels` is populated and `colorGroups` added by IMG-002 when `colorCount > 1`.
* `app.js` — new Studio Colours controls and their readback (`:2551` branch,
  `HISTORY_TRACKED_CONTROL_IDS` at `:4660`), fresh-import `colorCount: 1` default (`:5098` block),
  `#imageStudioGroupColors` joins `IMAGE_STUDIO_LIVE_GROUP_IDS` (`:5976`), `renderImageStudio()`
  (`:5977`) renders the Colours group and the new "Colours" view.
* `index.html` — `#imageStudioGroupColors` (`:1170`) filled in; new `#imgColorCount`,
  `#imgColorGroup0`..`#imgColorGroup7`, `#imgColorReset`, "Colours" `#imageStudioView` radio.
* `tools/test-img-002-color-layers.mjs` (new).
* `tools/test-groups.mjs` — registers the new test file in `core` and `geometry` (`:59`, `:176`
  neighborhoods).
* `tools/test-ui-shell-structure.mjs` — studio id list (`:201`) gains the new control ids.
* `docs/specifications/IMG-002-ColorLayers.md` (this file).
* `docs/specifications/IMG-000-ImageToStrassAudit.md` — one sentence appended to each of the
  `dedupeStonePoints()` (`:30`) and `findCrossGroupCollisions()` (`:40`) bullets:

  > *(appended to the `dedupeStonePoints()` bullet)* Per IMG-002's own milestone brief, this
  > "disjoint by color already" framing holds only for the lattice-placement modes (Fill/Staggered/
  > Radial); IMG-002 does not sample each color's field independently but instead labels one shared
  > sampled point set after the fact, because per-mask sampling diverges from union sampling under
  > Contour (measured: 194 vs 235 stones on a two-color wavy boundary, with a 3.143 mm minimum
  > cross-color center distance against a 3.3 mm pitch — see `IMG-002-ColorLayers.md` decision 1).

  > *(appended to the `findCrossGroupCollisions()` bullet)* IMG-002 still generates one independent
  > stone group per color, so this per-group collision check remains the right tool, but each group's
  > points come from partitioning one shared `sampleFieldByMode()` call rather than from per-color
  > field sampling — see `IMG-002-ColorLayers.md` decision 1 for why per-mask sampling was rejected.

## Compatibility

* `colorCount` omitted or `1`: `field.labels` stays `null` (byte-identical to IMG-001), and
  `generateImageLayout()`'s output is `deepEqual` to a reference `StoneLayout` captured from `develop`
  (see the Test Plan's "byte-identity vs. `develop`" case below, using the same capture-and-freeze
  technique `tools/test-img-001-field.mjs`'s case 9 (`:170`) already established) —
  `colorMap`/`palette` are read but have nothing to do. "Today's output" cannot itself be the
  assertion target once this milestone lands, since the code under test becomes the new output; a
  literal frozen from `develop` before this change is the only fixed reference.
* `colorCount > 1`: for every mode (Fill/Staggered/Radial/Contour), the `(xMm, yMm, sizeMm, index)`
  sequence is identical to the `colorCount: 1` run on the same inputs — only `color` differs.
* No `StoneLayout`/`Stone` schema change beyond the existing `color` field already carrying arbitrary
  string values; no project version bump; no `validateProject()` change — `colorCount`/`colorMap` are
  new, optional, permissively-defaulted layer fields, the same precedent `layer.transparent`
  (IMG-001) and `sizeMode`/`allowedSizesMm` (S-200) already established.
* Every pre-IMG-002 saved `image` layer has no `colorCount` field and resolves to `1`, generating
  byte-identical `StoneLayout` output to before this milestone.

## Test Plan

`tools/test-img-002-color-layers.mjs` (new, registered in `tools/test-groups.mjs`'s `core` and
`geometry` groups immediately after `test-img-001-field.mjs`):

* Quantizer determinism: `ColorQuantize.js` run twice on the same synthetic fixture and palette
  produces `deepEqual` `labels`/`colorGroups`.
* Region-correct labels: a synthetic RGBA fixture with three flat color regions and a transparent
  quadrant produces the expected label per region and `NO_LABEL` (255) across the transparent
  quadrant.
* `colorCount` omitted gives `labels === null`, and `field`'s key set stays IMG-001's exact six names
  (`colorGroups` absent).
* Byte-identity vs. `develop`: `colorCount` omitted, `generateImageLayout()`'s result is `deepEqual`
  to a stone list captured by running `develop`'s `generateImageLayout()` against
  `tools/test-image-pipeline.mjs`'s existing fixture(s), frozen as a literal in the test file, with
  its provenance documented in a comment the way `tools/test-img-001-field.mjs:170`'s case 9 does
  (git ref, confirmation the intervening image code is unchanged, and that the capture script itself
  was discarded).
* `FIELD_ON_THRESHOLD` parity: import `FIELD_ON_THRESHOLD` from `src/geometry/StoneSampler.js` and
  `ColorQuantize.js`'s own copy, assert they are equal.
* For each of Fill/Staggered/Radial/Contour: `colorCount: 3` and `colorCount: 1` produce identical
  `(xMm, yMm, sizeMm, index)` sequences (only `color` differs).
* `findCrossGroupCollisions()` run over the `colorCount: 3` stones, grouped into per-color synthetic
  `layerId`s, at `d = stoneSizeMm + gapMm` returns `[]`.
* `colorMap` override applies to matching `nearestId` stones; an unknown `colorMap` key is ignored
  (no throw, no effect).
* `nearestId` uniqueness: a fixture with two clusters whose nearest catalog entry is the same id
  yields two distinct `nearestId`s, with the larger (`pixelShare`) cluster keeping the contested entry
  and the smaller falling through to its own next-nearest unclaimed entry.
* `NO_LABEL` unreachability: across all four modes, with and without `sizeMode: 'mixed'`, zero stones
  (base or infill) resolve to `NO_LABEL` — the stronger invariant decision 1's measured sweep
  establishes.

Report the raw per-case list above in this section, not a pass/fail count, per this repo's testing
policy for shared-architecture milestones.
