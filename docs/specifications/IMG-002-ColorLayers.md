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
   (`src/geometry/StoneSampler.js:1770`) exactly once on `field.data`, as today. Each resulting stone
   (base and S-200 infill alike) then reads `field.labels` at the pixel `fieldPixelOn()`
   (`src/geometry/StoneSampler.js:1614`) would resolve for its `xMm`/`yMm`, and takes its color from
   that label's group. Positions, count and index order are byte-identical to today's output for
   every mode; only `Stone.color` changes.

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
   threshold value, kept in sync by the shared fixture in the Test Plan below) using median cut on a
   5-bit-per-channel RGB histogram, followed by 8 fixed weighted k-means passes over the histogram
   bins (ties broken by bin index, so the result is deterministic across runs on identical input).
   Every eligible pixel then maps to a label via its bin.

   Returns `labels` (`Uint8ClampedArray`, values `0..K-1`, `255 = NO_LABEL` for pixels off in `data`)
   and `colorGroups: [{rgb:[r,g,b], pixelShare, nearestId}]`, where `nearestId` is the CIE76
   Lab-nearest entry in the supplied `palette`. With `colorCount` omitted or `1`, nothing runs and
   `labels` stays `null` — every IMG-001 caller and test is unchanged.

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
   pixel-share percentage, and a catalog `<select>` populated by `populateStoneColorOptions()`
   (`app.js:242`, called once per row with that row's own select id as `targetId`); `#imgColorReset`
   clears `layer.colorMap`. `#stoneColor` is disabled (with an explanatory `title`) while
   `colorCount > 1`, since per-stone color then comes entirely from `colorMap`.

   A fifth `#imageStudioView` radio, "Colours", paints `field.labels` through a new pure
   `labelsFieldToRgba(field, fillsByLabel)` in `src/image/ImagePreviewRender.js`, beside the existing
   `maskFieldToRgba()` (`src/image/ImagePreviewRender.js:16`) it's modeled on — `fillsByLabel` is
   built in `app.js` from each row's resolved catalog color, keeping palette knowledge out of
   `src/image`. Stats column (`#imageStudioStats`) is unchanged by this milestone.

   The image-layer control readback branch at `app.js:2551` gains `l.colorCount` and (from the reset
   button and per-row selects) `l.colorMap` writes alongside its existing `l.threshold`/`l.invert`/
   etc. writes; the new control ids (`imgColorCount`, `imgColorGroup0`..`imgColorGroup7`'s selects,
   `imgColorReset`) join `HISTORY_TRACKED_CONTROL_IDS` (`app.js:4660`) and the studio id list
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
  -> each point's label looked up via fieldPixelOn()'s same pixel resolution
  -> Stone.color = colorMap[group.nearestId] ?? group.nearestId
  -> S-200 infill stones (generateMixedSizeInfillStones) labeled the same way
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

## Files Touched

* `src/image/ColorQuantize.js` (new) — median-cut + k-means quantizer, pure, no `src/geometry`/
  `src/renderer` imports.
* `src/image/ImageFieldPipeline.js` — `normalizeParams()` (`:38`) gains `colorCount`/`palette`;
  `prepareImageField()` (`:89`) calls the quantizer and populates `labels`/`colorGroups`.
* `src/image/ImagePreviewRender.js` — new `labelsFieldToRgba()` beside `maskFieldToRgba()` (`:16`).
* `src/geometry/GeometryEngine.js` — `normalizeImageParams()` (`:2221`) gains `colorCount`/`palette`/
  `colorMap`; `generateImageLayout()` (`:1164`) labels stones per point.
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
  `generateImageLayout()`'s output is `deepEqual` to today's output on every fixture
  `tools/test-image-pipeline.mjs` already uses — `colorMap`/`palette` are read but have nothing to do.
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
* `colorCount` omitted gives `labels === null`, and `generateImageLayout()`'s result is `deepEqual`
  to the current (pre-IMG-002) output on `tools/test-image-pipeline.mjs`'s existing fixtures.
* For each of Fill/Staggered/Radial/Contour: `colorCount: 3` and `colorCount: 1` produce identical
  `(xMm, yMm, sizeMm, index)` sequences (only `color` differs).
* `findCrossGroupCollisions()` run over the `colorCount: 3` stones, grouped into per-color synthetic
  `layerId`s, at `d = stoneSizeMm + gapMm` returns `[]`.
* `colorMap` override applies to matching `nearestId` stones; an unknown `colorMap` key is ignored
  (no throw, no effect).
* With `sizeMode: 'mixed'`, S-200 infill stones are labeled the same way base stones are (no
  unlabeled/`NO_LABEL`-colored infill stones when their source pixel has a valid label).

Report the raw per-case list above in this section, not a pass/fail count, per this repo's testing
policy for shared-architecture milestones.
