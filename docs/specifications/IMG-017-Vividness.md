# IMG-017 — Vividness

**Status: specified, not built.** File:line citations are against `develop` @ `99d1d7c` (the IMG-016
merge). Every anchor below was re-grepped on that tip. The figures were measured by the lead
architect on `99d1d7c`. This spec's own scratch probes re-derived every fixture figure (T1 to T5,
including T5's mutant) and every photo figure, on a scratch copy of the tree with decisions 1 to 4
applied. Every one agrees. The copy lives in the session scratchpad, not under `tools/scratch/`.

## Objective

IMG-016 grew the catalogue to 23 colours by adding three neutrals and three browns. Photographs now
match much more closely: tiger mean ΔE falls from 23.3 to 11.0. The cost is that saturated stones
lose pixels to the nearer muted ones. The tiger's topaz, 11.0% of subject pixels with 17 colours, no
longer clears the 1.2% floor. Its fur labels light-colorado and smoked-topaz instead. This is the
`docs/BACKLOG.md` row IMG-016 decision 5 deferred.

IMG-017 adds a per-layer **vividness** factor. It scales each subject pixel's chroma before catalogue
matching, so the user can trade some colour accuracy for brighter stones. The default is 1, which
leaves every existing layer byte-identical.

## Measurement settings

All figures use the app's import defaults:

* `maskMode` `'subject'`, `transparent` `'ignore'`, threshold 128, `invert` false, blur 0.
* `maxWidthPx` and `maxHeightPx` 400.
* The 23-colour catalogue from `app.js`'s `imageColorPalette()` (`id` plus `previewColor`).

Stage labels:

* **Raw** is nearest-colour labelling over all 23 colours, before the floor, relabelling and the cap.
* **Decision** is after the 1.2% floor, relabelling and the cap of 8.

Stone figures come from `generateImageLayout()` with Staggered, SS6 (2.0 mm), gap 0.3 mm,
`fillGaps` true and Auto colour count, on a layer 129.6 mm wide. The layer height is the source aspect
rounded to 2 dp: tiger 129.80 mm, Einstein 121.91 mm, butterfly 121.01 mm and furry 129.60 mm. The
unrounded height moves individual colours on tiger and Einstein by 1 to 4 stones, with the same
totals.

The seven images are IMG-015's fixtures, decoded with PIL (see
`docs/specifications/IMG-015-DirectCatalogueColour.md`). PNG figures match the browser exactly. The
JPEG figures (tiger, portrait and butterfly) may differ from Chrome by a few tenths of a percent, or
a few stones per colour.

Mean ΔE is CIE76, measured from each pixel's **unscaled** Lab to its assigned stone. It is a measure
of colour fidelity, so it rises as vividness pushes pixels away from their true colour.

## Measured figures

### Pixel level

Auto / raw mean ΔE / decision mean ΔE, then the decision shares (%).

| Image | Factor | Auto / raw / decision | Decision colours |
|---|---|---|---|
| tiger | ×1.0 | 8 / 11.0 / 11.2 | light-colorado 17.2, silver 16.3, smoked-topaz 15.4, grey 14.7, jet 13.0, black-diamond 8.3, hematite 7.8, light-peach 7.3 |
| tiger | ×1.2 | 8 / 11.6 / 11.3 | topaz 0 (4.2 raw, dropped by the cap) |
| tiger | ×1.4 | 8 / 13.2 / 13.6 | topaz 10.1 |
| tiger | ×1.6 | 8 / 14.9 / 15.0 | topaz 14.6 |
| tiger | ×1.8 | 8 / 16.4 / 17.8 | siam 7.2 |
| tiger | ×2.0 | 8 / 17.7 / 19.0 | |
| Einstein | ×1.0 | 8 / 14.2 / 14.9 | smoked-topaz 28.3, no siam |
| Einstein | ×1.2 | 8 / 14.6 / 15.3 | siam 8.7 (the sweater) |
| Einstein | ×1.4 | 8 / 16.4 / 17.2 | siam 12.9, light-siam 9.0 (the face starts) |
| Einstein | ×1.6 | 8 / 18.6 / 19.4 | siam 19.3, light-siam 13.9 |
| Einstein | ×1.8 | 8 / 20.2 / 20.8 | siam 22.7, light-siam 16.7 |
| Einstein | ×2.0 | 8 / 21.5 / 22.1 | |

| Image | ×1.0 | ×1.2 | ×1.4 | ×1.6 | ×1.8 | ×2.0 | Notes |
|---|---|---|---|---|---|---|---|
| butterfly, decision ΔE | 18.7 | 19.0 | 21.9 | 23.1 | 24.1 | 25.2 | sapphire enters at ×1.4 (7.7) |
| cartoon, Auto | 8 | 8 | 8 | 7 | 6 | 6 | |
| cartoon, decision ΔE | 23.7 | 23.5 | 23.9 | 24.5 | 25.0 | 25.8 | |
| furry, decision ΔE | 14.1 | 15.0 | 15.5 | 16.7 | 17.6 | 19.2 | siam 4.1 at ×1.2 (the collar), topaz 8.8 at ×1.4 |

Portrait: Auto 4, raw 5.7, decision 5.7 at every factor. Logo: Auto 5, raw 5.9, decision 6.0 at
every factor. Both are near-neutral, so scaling a\* and b\* moves no pixel to another stone.

### Stone level

The total stone count is unchanged at every factor. Only colours move.

| Image | Stones | Colours |
|---|---|---|
| tiger | 2986 | ×1.0: light-colorado 526, silver 510, smoked-topaz 465, jet 429, grey 412, hematite 229, black-diamond 215, light-peach 200 |
| | | ×1.4: jet 508, smoked-topaz 462, silver 416, light-colorado 389, grey 326, topaz 320, black-diamond 294, light-peach 271 |
| Einstein | 2052 | ×1.0: no siam. ×1.2: siam 194. ×1.4: siam 278, light-siam 191. ×1.6: siam 414, light-siam 282 |
| butterfly | 1261 | topaz 223, 260, 336 and 243 at ×1.0, ×1.2, ×1.4 and ×1.6; sapphire 107 at ×1.4 |
| furry | 1221 | siam 56 at ×1.2 only; topaz 106 at ×1.4 |

## Decisions

### D1. What the factor does

`layer.vividness` multiplies each eligible pixel's Lab a\* and b\* by the factor. L\* is untouched and
hue is preserved. This happens before catalogue matching, inside `labelCatalogColors()`
(`src/image/ColorQuantize.js:68`), through a new parameter `chromaScale`, default 1. When
`chromaScale` is exactly 1, the multiply is skipped, so the arithmetic is the shipped arithmetic.

The scaled Lab is used for both the raw match and the relabelling of dropped colours. It is one
labelling pass. The floor, the cap and Auto all act on the scaled labels.

The factor does not touch:

* the subject mask;
* stone positions;
* `colorGroups` `rgb` means, which stay the real pixel means;
* Line Design's ink reference pass (D4).

### D2. Steps and range

A select offers four named steps:

| Label | Value |
|---|---|
| Natural | 1.0 |
| Rich | 1.2 |
| Vivid | 1.4 |
| Bold | 1.6 |

The upper limit is 1.6 because at 1.8 every coloured test image degrades:

* tiger's nose goes to siam;
* Einstein's face reaches siam 22.7% at the decision stage;
* furry's face takes aquamarine;
* cartoon's orange goes to siam.

Values below 1 (desaturation) are out of scope.

### D3. Defaults and persistence

The value is persisted as `layer.vividness`, a number. A missing or invalid value reads as 1, so
every saved project stays byte-identical.

* **Engine and pipeline read sites** accept any finite number in [1, 2] and fall back to 1 otherwise.
  These are `normalizeImageParams()` in `GeometryEngine.js` and `normalizeParams()` in
  `ImageFieldPipeline.js`.
* **`app.js`'s `resolveImageVividness()`** accepts exactly the four steps and falls back to 1.
* **The import factory** sets `vividness:1`.

*Rationale.* No single step improves every image. At 1.2, furry's orange collar turns red. At 1.4,
Einstein's face turns light-siam. So the faithful default stays, and the user chooses.

There is no `validateProject()` change and no version bump. `maskMode` (IMG-009 decision 3) set the
precedent.

### D4. Line Design

`generateLineDesignStonePoints()` takes `chromaScale` and passes it only to the colour
`buildLabelField()` call. The ink reference call, which labels against
`LINE_DESIGN_INK_REFERENCE_COLOR_IDS` (IMG-016 decision 3), never receives it.

Line Design geometry is therefore identical at every factor. Only the colours of `fill`, `outline` and
`pocket` stones change. `line` stones vote among ink pixels, so on T5's fixture they keep their colour
too.

Forwarding `chromaScale` to the ink call changes geometry. On T5's fixture at 1.6, 138 points drop to
130, and every `line` stone disappears (measured).

### D5. Wiring sites

Each anchor below was re-grepped on `99d1d7c`, and the line given is the actual line.

| File | Line | Change |
|---|---|---|
| `src/image/ColorQuantize.js` | `:68` | `labelCatalogColors()` gains `chromaScale = 1`. After `rgbToLab()`, scale a\* and b\* unless it is exactly 1. |
| | `:144` | `quantizeColors()` gains `chromaScale` and forwards it to `labelCatalogColors()` (the call at `:149-151`). |
| `src/image/ImageFieldPipeline.js` | `:101` | `normalizeParams()`'s return gains `vividness`, resolved per D3's engine rule. |
| | `:209` | The `quantizeColors()` call forwards `chromaScale: options.vividness`. |
| `src/image/AutoColourCount.js` | `:61` | `chooseAutoColorCount(field, palette)` gains a third argument, `{ chromaScale = 1 } = {}`. |
| | `:68` | Its `labelCatalogColors()` call forwards `chromaScale`. |
| `src/geometry/GeometryEngine.js` | `:2471` | `normalizeImageParams()` adds `vividness`, per D3's engine rule, next to `maskMode` at `:2544`. |
| | `:1208`, `:1408` | Both `prepareImageField()` calls forward `vividness: options.vividness` by hand. The params object is a whitelist with no spread; missing this is the IMG-009 lesson. `:1208` is in `generateImageLayout()`, `:1408` in `resolveImagePolygons()`. |
| | `:1283` | The `generateLineDesignStonePoints()` call passes `chromaScale: options.vividness`. |
| `src/geometry/LineDesignSampler.js` | `:655` | `generateLineDesignStonePoints()` gains `chromaScale = 1`. |
| | `:178` | `buildLabelField()` gains `chromaScale = 1` and forwards it to `labelCatalogColors()`. |
| | `:689` | The colour call forwards `chromaScale`. |
| | `:697` | The ink reference call does **not** forward it (D4). |
| `app.js` | beside `:717` | `IMAGE_VIVIDNESS_STEPS` and `resolveImageVividness()`, next to `resolveImageMaskMode()`. See the note below this table. |
| | `:758` | `autoColorCountKeyParts()`: the key includes the resolved vividness. |
| | `:782` | The `chooseAutoColorCount()` call passes `{ chromaScale: <resolved vividness> }`. |
| | `:822` | `computeImageColorField()`'s cache key includes the resolved vividness. |
| | `:825` | Its `prepareImageField()` call passes `vividness`. |
| | `:1136` | The Line Design cache key includes the resolved vividness. |
| | `:1146` | The Line Design params pass `vividness`. |
| | `:1154` | The live `generateImageLayout()` params pass `vividness`. |
| | `:3402` | `resolveImageExportRegions()` params pass `vividness`. |
| | `:5513` | The `importImageFile` new-layer factory sets `vividness:1`. |
| | `:2629` | The Studio control read (`syncSelectedControlsFromLayer()`, image branch): `el('imgVividness').value = resolveImageVividness(l.vividness)`. |
| | `:2785`, `:2795` | The write in `writeSelectedControlsToLayer()`. The image branch opens at `:2785`, and the neighbouring `imgColorCount` write is at `:2795`. The new write is a separate statement, so `:2795` stays byte-identical (see "Existing tests"). |
| | `:5048` | `HISTORY_TRACKED_CONTROL_IDS` gains `'imgVividness'`. |
| `index.html` | after `:1192` | A new `<select id="imgVividness">`, labelled "Colour vividness". It goes directly after `#imgColorCount`, in `#imageStudioGroupColors` (`:1190`). The hint text is "Pushes colours toward brighter stones. No effect on black-and-white images or single-colour layers." The options are Natural 1, Rich 1.2, Vivid 1.4 and Bold 1.6, in that order. |

**Why `IMAGE_VIVIDNESS_STEPS` must be plain literals.** Several harnesses slice `app.js` from
`const DEFAULT_TEXT_FONT_ID=` (`:176`) or `const DEFAULT_PROJECT_NAME=` (`:1209`) through
`validateProject()` (`:1240`) and evaluate the span with `new Function()`. The span covers `:717`. So
`IMAGE_VIVIDNESS_STEPS` and `resolveImageVividness()` must be plain literals that read no import at
load time. The comment above `imageColorPalette()` at `:722-723` records the same constraint.

**Deliberately unchanged: `resolveLayerShapeSource()` (`app.js:3380`).** Its `prepareImageField()`
call passes no `colorCount`, so it never labels, and a chroma factor has nothing to act on there.

**The new select is not a colour select.** Its id, `imgVividness`, does not match IMG-016's
selector-guard rule 3 regex, `/colou?r/i`. So `tools/test-img-016-neutral-brown-stones.mjs` needs no
new exemption.

## Test fixture

Pinned as literal generator code in the new test. It has four colours on a near-white background:

* an orange panel;
* a mid-grey panel;
* a brick-red panel;
* a dark-brown ink bar across all three.

```js
function vividFixture() {
  const w = 120, h = 60, data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = 4 * (y * w + x);
    let c = [245, 245, 245];
    if (y >= 10 && y < 50 && x >= 10 && x < 40) c = [185, 120, 60];
    if (y >= 10 && y < 50 && x >= 45 && x < 75) c = [128, 128, 128];
    if (y >= 10 && y < 50 && x >= 80 && x < 110) c = [110, 55, 50];
    if (y >= 28 && y < 32 && x >= 10 && x < 110) c = [70, 30, 25];
    data[i] = c[0]; data[i + 1] = c[1]; data[i + 2] = c[2]; data[i + 3] = 255;
  }
  return { widthPx: w, heightPx: h, data };
}
```

The field is `prepareAutoColorField(createImageBuffer(vividFixture()), params)`, with the import
defaults listed under "Measurement settings". It is 120×60 px, with 3640 eligible pixels
(`data >= 128`). The palette is `Object.values(STONE_COLORS).map((c) => ({ id: c.id, hex: c.previewColor }))`.

## Tests the build must add

T1 to T6 go in a new `tools/test-img-017-vividness.mjs`. T7 is a check on existing test files. Each
test lists its expected figures and the mutant it kills. The build mutation-tests each of T1 to T5
against its named mutant.

**T1. `labelCatalogColors()` scales chroma.**

The call is `labelCatalogColors({ ...field, eligible, palette, maxColors: 8, chromaScale })`. The
label is read at pixel index `y * 120 + x` for four sample pixels: (25,20) orange, (60,20) grey,
(95,20) red and (60,30) ink. Kept colours are listed in palette order.

| `chromaScale` | Orange, grey, red, ink | Kept |
|---|---|---|
| 1 | light-colorado, black-diamond, smoked-topaz, smoked-topaz | black-diamond, smoked-topaz, light-colorado |
| 1.2 | topaz, black-diamond, smoked-topaz, smoked-topaz | topaz, black-diamond, smoked-topaz |
| 1.4 | topaz, black-diamond, smoked-topaz, smoked-topaz | topaz, black-diamond, smoked-topaz |
| 1.6 | topaz, black-diamond, siam, smoked-topaz | siam, topaz, black-diamond, smoked-topaz |

Kills: `chromaScale` ignored.

**T2. Auto sees the scaled labels.** On the fixture field, `chooseAutoColorCount()` gives:

* `resolvedCount` 3 with `{ chromaScale: 1 }`;
* 4 with `{ chromaScale: 1.6 }`.

Kills: Auto not forwarded.

**T3. Engine `generateImageLayout()`.**

The params are: `widthMm` 60, `heightMm` 30, `mode` `'staggered'`, `stoneSizeMm` 2, `gapMm` 0.3,
`colorCount` 8, `fillGaps` true, and the import-default mask params. Every run gives 197 stones.

| `vividness` | Colours |
|---|---|
| omitted, 1, 0.5, 3, `'x'` | black-diamond 58, light-colorado 59, smoked-topaz 80 |
| 1.4 | black-diamond 58, smoked-topaz 80, topaz 59 |
| 1.6 | black-diamond 58, siam 59, smoked-topaz 21, topaz 59 |

Stone positions (`xMm`, `yMm`, `sizeMm`) are identical between 1 and 1.6, compared in order, not as a
set.

Kills: the `normalizeImageParams()` forward deleted, the `:1208` forward deleted, and a wrong
read-site fallback (0.5, 3 and `'x'` must read as 1).

**T4. `resolveImagePolygons()`.** Same params as T3. The region `colorId`s, sorted, are:

* at 1: black-diamond, light-colorado, smoked-topaz;
* at 1.6: black-diamond, siam, smoked-topaz, topaz.

Kills: the `:1408` forward deleted.

**T5. Line Design.**

The call is `generateLineDesignStonePoints()` with placement (0, 0, 60, 30) and `gapMm` 0.3.

* At `chromaScale` 1 and 1.6 alike, there are 138 points, with identical `xMm`, `yMm`, `sizeMm` and
  `kind`, in order.
* 13 of them are `line` points, all smoked-topaz at both factors.

| Kind | `chromaScale` 1 | `chromaScale` 1.6 |
|---|---|---|
| outline | light-colorado 23, smoked-topaz 29, black-diamond 23 | topaz 23, smoked-topaz 6, black-diamond 23, siam 23 |
| fill | light-colorado 4, black-diamond 4, smoked-topaz 4 | topaz 4, black-diamond 4, siam 4 |
| pocket | light-colorado 12, black-diamond 13, smoked-topaz 13 | topaz 12, black-diamond 13, siam 13 |
| line | smoked-topaz 13 | smoked-topaz 13 |

Kills two mutants:

* `chromaScale` forwarded to the ink call. Measured: 138 points drop to 130, and there are no `line`
  points.
* `chromaScale` not forwarded to the colour call.

**T6. `app.js` and `index.html` source guards.** The resolved vividness appears in:

* `autoColorCountKeyParts()`;
* the `:822` key and the `:1136` key;
* the `:1146`, `:1154` and `:3402` params;
* the import factory (`vividness:1`);
* `HISTORY_TRACKED_CONTROL_IDS`.

In addition, `#imgVividness` exists in `index.html` with exactly the four options, in order.

**T7. Byte identity.** Every pinned count and hash in `tools/test-img-015-direct-catalogue-colour.mjs`
and `tools/test-img-016-neutral-brown-stones.mjs` stays unchanged. Default vividness is exactly the
shipped arithmetic.

## Existing tests

### Sweep for pinned key and params lists

Two greps, run on `99d1d7c`:

```sh
grep -nF -e 'palette:imageColorPalette()' -e 'maskMode:resolveImageMaskMode(' -e 'colorCount:resolveImageColorCount(' -e 'lineDesignColorMapKey(' -e 'maxHeightPx:layer.maxHeightPx' tools/test-*.mjs
grep -nF "'resolveImageMaskMode'," tools/test-*.mjs
```

The first finds the tests that pin the `:1146`, `:1154` and `:3402` params, or the `:822` and `:1136`
keys:

| Site | What it does | Build action |
|---|---|---|
| `tools/test-img-008-vector-first-svg.mjs:359` | Needle list, each checked with `includes()`, over `resolveImageExportRegions()`'s body. | Add `'vividness:'`. Nothing breaks without it. |
| `tools/test-img-009-subject-mask.mjs:271`, `:277`, `:279`, `:283` | `maskMode` needles. | None. |
| `tools/test-img-009-subject-mask.mjs:295` | Exactly 4 occurrences of `maskMode:resolveImageMaskMode(layer.maskMode)`. | None, as long as the build adds no new occurrence of that substring. |
| `tools/test-img-011-import-defaults.mjs:18`, `:131`, `:143` | A comment, a title, and a `colorCount:resolveImageColorCount(layer)` match. | None. |
| `tools/test-img-010-line-design.mjs:560` | A comment only. | None. |

No test pins the `:822` or `:1136` key as a literal.

The second grep finds harnesses that run an extracted `app.js` span through `new Function()`, with its
dependencies passed as explicit parameters. Once the span calls `resolveImageVividness()`, each
throws a `ReferenceError` unless it passes that function too:

| Site | Span | Build action |
|---|---|---|
| `tools/test-img-010-line-design.mjs:548` | `generateImageStonesLive()` (Line Design branch, `:1136`/`:1146`) | Add `resolveImageVividness` as a parameter and pass a dependency. |
| `tools/test-img-013-fill-empty-slots.mjs:368` | `generateImageStonesLive()` (live params, `:1154`) | Same. |
| `tools/test-img-012-auto-colour-count.mjs:158` | `autoColorCountKeyParts()` up to `computeImageColorField()` | Same. |
| `tools/test-img-012-auto-colour-count.mjs:347`, `:353` | Item 9: the same resolver span, then `computeImageColorField()` (`:822`/`:825`) | Same, at both. |

These tests' fixtures never set `layer.vividness`, so every expected value in them is unchanged.

### Other pins the build must keep intact

* **`tools/test-img-012-auto-colour-count.mjs:295`** matches the exact `imgColorCount` write statement
  at `app.js:2795`. The vividness write is a separate statement.
* **`tools/test-img-011-import-defaults.mjs:111-114`** and
  **`tools/test-img-013-fill-empty-slots.mjs:493`** match fields in the import factory with regexes.
  Adding `vividness:1` breaks none of them.
* **Tests that match `HISTORY_TRACKED_CONTROL_IDS` with a regex**
  (`tools/test-s200-app-integration.mjs:104`, `:192`, `tools/test-crystal-color-integration.mjs:92`
  and others) require a flat list of string literals. Appending `'imgVividness'` keeps that.

## Out of scope

* Factors below 1 (desaturation).
* Any change to the floor, the cap, the catalogue or the subject mask.
* A pale yellow stone. The cartoon's pale-yellow fill labels peridot (green) at every factor. That is
  a catalogue gap, not a vividness issue. See the new `docs/BACKLOG.md` row.
