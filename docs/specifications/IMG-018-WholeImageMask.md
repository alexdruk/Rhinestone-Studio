# IMG-018 — Whole-image mask

**Status: built.** File:line citations are against `develop` @ `d5ffe69` (the IMG-017 follow-up
merge). Every anchor below was re-grepped on that tip. The figures were measured by the lead
architect in a prototype. This spec's own scratch probes re-derived every fixture figure (W1 to W5),
every mutant result (M1 to M5) and every photo figure, on a scratch copy of the tree with decisions 1
to 7 applied. Every one agrees. The copy lives in the session scratchpad, not under `tools/scratch/`.

## Objective

`maskMode: 'subject'` (IMG-009, reworked by IMG-014) assumes the image has a background. Without
alpha, it takes the modal border colour as the background and removes it. A full-bleed image with no
background, such as a solid-colour-block import or a photo cropped tight to the subject, loses
whichever subject colour happens to dominate the border ring. `'threshold'` has no stable answer
either, because it keeps only pixels darker than the cutoff.

IMG-018 adds a third mask mode, `maskMode: 'whole'`. Every pixel is subject, except where
the `transparent` policy removes it. This closes the `docs/BACKLOG.md` row 58 ("Full-bleed images
with no real background lose whichever subject colour dominates the border ring"), which itself
proposes "an explicit whole-image/no-background mask mode for the general case".

The user chooses the mode. No automatic detection is added (D5). A missing value still reads as
`'threshold'`, so every saved project stays byte-identical (D6).

## Measurement settings

Photo figures come from `generateImageLayout()` with:

* Staggered, SS6 (2.0 mm), gap 0.3 mm, `fillGaps` true, Auto colour count;
* vividness 1.4, `transparent` `'ignore'`, `maxWidthPx` and `maxHeightPx` 400, blur 0, `invert`
  false;
* the 23-colour catalogue from `app.js`'s `imageColorPalette()` (`id` plus `previewColor`).

The layer is 129.6 mm wide. The layer height is the unrounded value
`129.6 * cropHeightPx / cropWidthPx`, as `computeDefaultImagePlacement()` produces it.

Auto is `chooseAutoColorCount(prepareAutoColorField(buffer, params), palette, { chromaScale: 1.4 })`.
All stone figures are engine output, taken at the decision stage (after the 1.2% floor, relabelling
and the cap).

The three images are crops of IMG-015's reference photos in `~/Downloads`, decoded with PIL as RGBA.
The PIL crop boxes are `(left, top, right, bottom)`:

| Image | Crop box | Crop size |
|---|---|---|
| `portrat_orig.jpg` | (80, 150, 660, 760) | 580×610 |
| `albert-einstein_orig.png` | (330, 230, 660, 620) | 330×390 |
| `tiger_orig.jpg` | (250, 250, 1050, 1050) | 800×800 |

The crop boxes were chosen by the lead architect to cut away the background, leaving the full-bleed
case that row 58 describes.

## Measured figures

These figures are the rationale. No test pins them.

| Image | Subject | Whole | Colour that returns |
|---|---|---|---|
| portrait | 3270 | 3808 | jet 149 → 698 |
| Einstein | 3642 | 4312 | light-colorado 409 → 931 |
| tiger | 3558 | 3640 | jet 537 → 629 |

Under Subject, each crop loses the pixels the border model takes for background, and most of the
loss falls on one colour, listed above. Whole keeps every pixel. Auto is the same under both modes
for all three (5, 8 and 8), and each crop keeps the same set of colours, so the extra stones go to
colours that were already there.

## Decisions

### D1. New value and Studio control

`maskMode` gains a third value, `'whole'`.

* `#imgMaskMode` (`index.html:1167`) gains `<option value="whole">Whole image - no background</option>`,
  after the Subject option. The Threshold option keeps `selected`.
* The `title` on `#imgMaskMode`'s `<label>` (same line) gains a sentence saying that in Whole image
  mode, neither the Threshold slider nor Invert has any effect. It also describes the mode: every
  pixel is used, for a full-bleed image with no background.

### D2. Main pipeline

In `prepareImageField()`, `'whole'` produces an all-ones 0/1 native mask through `createField()`,
at `imageBuffer.widthPx` × `imageBuffer.heightPx`.

* `threshold` is not read.
* `invert` is not applied in `'whole'` mode. The invert guard at `:181` becomes
  `options.invert && options.maskMode !== 'whole'`. Inverting an all-ones mask would leave nothing,
  and that is never what the user means.
* The `transparent` policy, blur and resize then run unchanged. So under `'ignore'`, pixels with
  alpha below `ALPHA_COVERAGE_THRESHOLD` are still removed.

On an opaque image, `'whole'` is therefore the same mask as `'threshold'` at threshold 0 with invert
on (W1). The difference is that it needs no setting, and Invert cannot undo it.

### D3. Line Design

Line Design honours `'whole'`. When `maskMode` is `'whole'`, `computeFilledMaskAndInpaint()` uses a
0/1 mask of the pixels whose alpha is at least `ALPHA_COVERAGE_THRESHOLD`, instead of calling
`computeSubjectMask()`. `ALPHA_COVERAGE_THRESHOLD` is exported from `src/image/Alpha.js:15`, and
`LineDesignSampler.js` does not import it yet. The build adds the import.

Every other `maskMode` value, including `'threshold'` and a missing value, keeps the current
`computeSubjectMask(imageBuffer, {})` call. So Line Design output for `'subject'` and `'threshold'`
is byte-identical, and every IMG-010, IMG-016 and IMG-017 Line Design pin stays.

Line Design reads alpha directly rather than the `transparent` policy, because it never reads
`transparent` today. The alpha test is the one `computeSubjectMask()`'s own alpha route applies
(`src/image/SubjectMask.js:223`). So a transparent margin is excluded whichever policy is set. On
`marginFixture()`, `'whole'` and `'subject'` then agree (W3), because `'subject'` also takes that
image's alpha route.

### D4. The import factory stays on Subject

The `importImageFile` new-layer factory (`app.js:5523`) keeps `maskMode:'subject'`. All seven
reference images have a real background or alpha, and `'whole'` would put stones on it. Whole is an
explicit choice for the image that has no background.

### D5. No automatic detection

The pipeline never switches to `'whole'` by itself. Row 58 records why: no border-share threshold
separates the two cases. `tools/test-img-010-line-design.mjs` Item 20's borderless fixture has a
modal-cluster border share of 0.509. A real portrait with a real background measures 0.515. A gate
anywhere near that value would misclassify one or the other.

### D6. Persistence

The value is persisted as `layer.maskMode`, a string, as before. A missing value still reads as
`'threshold'` at every read site, and so does any unknown value. Every saved project stays
byte-identical.

There is no `validateProject()` change and no version bump. This is the IMG-009 decision 3
precedent.

### D7. Line Design cache key

The Line Design cache key in `generateImageStonesLive()` gains the resolved `maskMode`. Without it,
switching a Line Design layer between Subject and Whole would return the cached stones of the other
mode. Changing between `'subject'` and `'threshold'` now also misses the cache, even though Line
Design output is the same for both. That costs one regeneration, and the result is still correct.

## Read sites

Every read site changes together. Each anchor below was re-grepped on `d5ffe69`, and the line given
is the actual line.

| File | Line | Change |
|---|---|---|
| `app.js` | `:717` | `resolveImageMaskMode()` returns `'subject'` for `'subject'`, `'whole'` for `'whole'`, and `'threshold'` for anything else. Plain literals only: this span is evaluated with `new Function()` by several harnesses (see IMG-017 D5's note on `IMAGE_VIVIDNESS_STEPS`). |
| | `:1143` | The Line Design cache key adds `resolveImageMaskMode(layer.maskMode)` (D7). |
| | `:1153` | The Line Design params add `maskMode:resolveImageMaskMode(layer.maskMode)`. |
| | `:767-768` | `autoColorCountKeyParts()`: no change. The key already includes the resolved `maskMode`, and `threshold` is pushed only in `'threshold'` mode, so a `'whole'` key ignores the slider, as it should. |
| `index.html` | `:1167` | `#imgMaskMode` gains the `whole` option, and its label's `title` gains the D1 sentence. |
| `src/image/ImageFieldPipeline.js` | `:99` | `normalizeParams()` resolves `'whole'` as well as `'subject'`, else `'threshold'`. |
| | `:178` | The mask choice gains the `'whole'` branch (D2). `createField` is already imported (`:31`). |
| | `:181` | The invert guard skips `'whole'` (D2). |
| `src/geometry/GeometryEngine.js` | `:2520` | `normalizeImageParams()` resolves `maskMode` the same way as `:99`. |
| | `:1284-1286` | The `generateLineDesignStonePoints()` call forwards `maskMode: options.maskMode`. |
| | `:1218`, `:1419` | Both `prepareImageField()` calls already forward `maskMode: options.maskMode` (confirmed). No change. |
| `src/geometry/LineDesignSampler.js` | `:657` | `generateLineDesignStonePoints()` gains `maskMode`, with no default. |
| | `:688` | The `computeFilledMaskAndInpaint()` call passes `maskMode`. |
| | `:163-164` | `computeFilledMaskAndInpaint(imageBuffer, maskMode)` branches on it (D3). |
| `tools/test-img-009-subject-mask.mjs` | `:294-295` | The expected count of `maskMode:resolveImageMaskMode(layer.maskMode)` in `app.js` goes from 4 to 5, for the new `:1153` Line Design params site. The assertion message names the fifth site. The D7 key entry has no `maskMode:` prefix, so it does not count. |

**Deliberately unchanged in `app.js`.** These already route through `resolveImageMaskMode()`, so
they accept `'whole'` once `:717` does:

* the Studio read in `syncSelectedControlsFromLayer()` (`:2636`);
* the write in `writeSelectedControlsToLayer()` (`:2792`);
* `computeImageColorField()`'s key and params (`:829`, `:832`). Its key includes `threshold` and
  `invert` in every mode. In `'whole'` mode that causes an extra cache miss when either changes, but
  never a wrong result.

The JSDoc types at `src/image/ImageFieldPipeline.js:161` and `src/geometry/GeometryEngine.js:1193`
(`{'threshold'|'subject'}`) gain `'whole'`.

**Existing two-way stubs may stay.** `tools/test-img-010-line-design.mjs:576`,
`tools/test-img-012-auto-colour-count.mjs:343` and `tools/test-img-013-fill-empty-slots.mjs:392`
stub `resolveImageMaskMode()` as `'subject'`-or-`'threshold'`. None of their fixtures sets `'whole'`,
so their results are unchanged. Every `new Function()` harness that runs the Line Design branch
(`tools/test-img-010-line-design.mjs:548`, `tools/test-img-013-fill-empty-slots.mjs:368`) already
passes `resolveImageMaskMode` as a dependency, so the new `:1143` and `:1153` calls need no new
parameter.

## Test fixture

Pinned as literal generator code in the new test. It is 300×300 and fully opaque, with three colours
and no background: a red block on the left, a blue block on the right (`x >= 180`), and a gold disc
of radius 60 in the centre.

```js
function blocksFixture() {
  const widthPx = 300, heightPx = 300;
  const data = new Uint8ClampedArray(widthPx * heightPx * 4);
  for (let y = 0; y < heightPx; y++) {
    for (let x = 0; x < widthPx; x++) {
      const o = (y * widthPx + x) * 4;
      const inDisc = (x - 150) * (x - 150) + (y - 150) * (y - 150) <= 60 * 60;
      const rgb = inDisc ? [250, 210, 40] : x >= 180 ? [30, 60, 180] : [200, 30, 40];
      data[o] = rgb[0]; data[o + 1] = rgb[1]; data[o + 2] = rgb[2]; data[o + 3] = 255;
    }
  }
  return { widthPx, heightPx, data };
}
```

`marginFixture()` is `blocksFixture()` with every pixel where `x < 20`, `y < 20`, `x >= 280` or
`y >= 280` set to RGBA (0, 0, 0, 0). It is the same image with a 20 px transparent margin.

On `blocksFixture()`, Subject takes red (the modal border colour) as background and keeps only blue
and gold. Threshold 128 keeps the two dark blocks and drops the light gold disc. Only Whole keeps all
three.

**Common parameters:**

* layer 60 × 60 mm at (0, 0);
* `stoneSizeMm` 2, `gapMm` 0.3;
* palette: every `STONE_COLORS` entry as `{ id, hex: previewColor }`;
* vividness 1.4, `maxWidthPx` and `maxHeightPx` 400, `transparent` `'ignore'`, threshold 128,
  `colorMap` `{}`.

All figures below are engine output, taken at the decision stage (after the floor, relabelling and
the cap).

## Tests the build must add

W1 to W6 go in a new `tools/test-img-018-whole-image-mask.mjs`. Each mutant below was verified in the
prototype and re-run by this spec's probes.

**W1. `prepareImageField()` on `blocksFixture()`.**

* `'whole'` gives 90000 on-pixels.
* `'whole'` with `invert` true is identical.
* `'whole'` equals `maskMode` `'threshold'` with threshold 0 and `invert` true, in both `data` and
  `labels`, at `colorCount` 3.

**W2. `generateImageLayout()`, Staggered.** The mode is `'staggered'` and `fillGaps` is true.
`colorCount` comes from `chooseAutoColorCount()` on `prepareAutoColorField()` with `chromaScale` 1.4.

| `maskMode` | Auto | Stones | Colours |
|---|---|---|---|
| `'subject'` | 2 | 396 | sapphire 296, gold 100 |
| `'whole'` | 3 | 780 | siam 384, sapphire 296, gold 100 |
| `'whole'`, `invert` true | 3 | 780 | identical to `'whole'` |
| `'threshold'`, threshold 128 | 2 | 680 | siam 384, sapphire 296 |

**W3. `generateImageLayout()`, Line Design.** The mode is `'line-design'`.

| Fixture | `maskMode` | Stones | Colours |
|---|---|---|---|
| `blocksFixture()` | `'subject'` | 211 | sapphire 162, gold 49 |
| `blocksFixture()` | `'whole'` | 399 | siam 203, sapphire 154, gold 42 |
| `marginFixture()` | `'whole'` | 293 | siam 144, sapphire 105, gold 44 |
| `marginFixture()` | `'subject'` | 293 | identical to `'whole'` |

**W4. `resolveImagePolygons()`**, `colorCount` 3. The region `colorId`s, in the order returned, are:

* `'whole'`: siam, sapphire, gold;
* `'subject'`: sapphire, gold;
* `'threshold'`: siam, sapphire.

**W5. Read sites are permissive.**

* Through `prepareImageField()`, `maskMode` `'bogus'` and an omitted `maskMode` both equal
  `'threshold'`.
* `app.js`'s `resolveImageMaskMode()`, extracted from source and evaluated, returns `'whole'`,
  `'subject'` and `'threshold'` for themselves, and `'threshold'` for `'bogus'` and `undefined`.

**W6. Source guards.**

* `index.html` contains `option value="whole"`.
* In `app.js`, the Line Design cache key and the Line Design params both contain
  `resolveImageMaskMode(layer.maskMode)`.

**Mutants and the item each kills:**

| Mutant | Killed by | Result under the mutant |
|---|---|---|
| M1. `GeometryEngine` does not forward `maskMode` to Line Design. | W3 | `'whole'` gives 211. |
| M2. `normalizeParams()` collapses `'whole'` to `'threshold'`. | W2 | `'whole'` gives 680. |
| M3. `invert` is applied in `'whole'` mode. | W1, W2 | Inverted `'whole'` differs in W1 and gives 0 stones in W2. |
| M4. `normalizeImageParams()` collapses `'whole'`. | W4 | `'whole'` gives siam, sapphire. |
| M5. The Line Design whole mask ignores alpha. | W3 | `marginFixture()` `'whole'` gives 441 (jet 190, siam 119, sapphire 87, gold 45). |

## Existing tests

* **`tools/test-img-009-subject-mask.mjs:295`** expects exactly 4 occurrences of
  `maskMode:resolveImageMaskMode(layer.maskMode)` in `app.js`. It becomes 5, as in the read-sites
  table. The needle list at `:271` to `:283` needs no change: each needle is checked with
  `includes()`, which still matches.
* **Line Design pins** in `tools/test-img-010-line-design.mjs`, `tools/test-img-016-neutral-brown-stones.mjs`
  and `tools/test-img-017-vividness.mjs` stay byte-identical, because no `maskMode` other than
  `'whole'` changes the Line Design mask (D3).
* **Main-pipeline pins** for `'subject'` and `'threshold'` are unaffected, because D2 adds a branch
  and does not touch the other two.

## Build housekeeping

* The `docs/BACKLOG.md` row 58 gains **Implemented:** `docs/specifications/IMG-018-WholeImageMask.md`,
  replacing this spec commit's **Addressed by IMG-018** marker, keeping its finding text, per the
  BACKLOG convention for closed rows.
* `tools/test-img-018-whole-image-mask.mjs` is registered in `tools/test-groups.mjs` in the same
  groups as `tools/test-img-017-vividness.mjs` (`core` at `:74` and `geometry` at `:207` on
  `d5ffe69`).
* `docs/ARCHITECTURE.md:160-170` describes the two `maskMode` values. It gains `'whole'`.
* This spec's Status line becomes "built" in the build commit.

## Out of scope

* Line Design continuing to ignore `'threshold'`. It calls `computeSubjectMask()` whatever
  `maskMode` says; that predates this milestone and stays as it is outside `'whole'`.
* Computing the mask on a resized image for speed. See `docs/BACKLOG.md` row 56.
* Automatic detection of a full-bleed image (D5).
* Changing the import default (D4).
