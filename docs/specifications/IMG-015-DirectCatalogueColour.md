# IMG-015 — Direct Catalogue Colour

**Status: implemented.** File:line citations are against `develop` @ `918622f`, before the build. Every
figure marked "measured" was produced in this spec's own scratch probes (untracked, under
`tools/scratch/`), on the pristine tip and on a scratch copy of the tree with the proposal applied.
Figures marked "provided" were supplied by the lead architect and are recorded as given.

## Objective

`quantizeColors()` (`src/image/ColorQuantize.js:248`) reduces an image layer's subject pixels to at
most `colorCount` clusters using median cut (`:139`) and 8 weighted k-means passes (`:159`). Then
`assignNearestIds()` (`:201`) gives each cluster its own catalogue stone. Clusters claim stones
greedily in descending share, and a stone already claimed is skipped. On photographs this goes wrong
in two ways that make each other worse:

* **Desaturated means.** A cluster's colour is the mean of everything assigned to it. On a
  photograph that mean is a muddy blend no real stone matches. The tiger's k=3 middle cluster is
  (151,120,91), a brown-grey that resolves to **rose**, a pink stone. No pink appears in the image.
* **Distinct claim.** When two clusters are nearest to the same stone, the smaller one is pushed to
  its next-nearest *unclaimed* stone, however far away that is. On the portrait, a greyscale
  photograph, k=3 splits dark grey into (14,14,14) and (72,72,72). The first claims jet, so the second
  is forced onto **light-sapphire**, a blue stone.

Both effects raise the colour error as `colorCount` grows. That is why IMG-012's Auto (which picks
the `k` with the lowest mean ΔE) collapses to 2 on both photographs. The app then renders the tiger
in jet and silver, and the portrait in jet and light-sapphire.

IMG-010's Line Design mode already does something simpler that works better. It labels every pixel
with its nearest catalogue colour directly, drops colours under a 1.2% share, and relabels their
pixels to the nearest colour that survives (`src/geometry/LineDesignSampler.js:166-217`, "decision
(b)"). IMG-015 makes that the single colour rule for every image fill mode. It retires median cut,
k-means, the distinct claim, and IMG-012's ΔE sweep.

## Measured comparison — real images

### Shipped pipeline (provided, re-measured)

Provided by the lead architect at the app defaults: subject mask, `maxWidthPx`/`maxHeightPx` 400,
Auto. Re-measured here with the same settings (`transparent:'ignore'`, threshold 128, no invert, no
blur). Every provided figure reproduces exactly.

| Image | Auto | k=2 / k=3 / k=4 mean ΔE | k=3 cluster → stone | App output |
|---|---|---|---|---|
| tiger | 2 | 27.94 / 29.20 / 38.21 | jet, rose (151,120,91), silver | 2986 stones: jet 1433, silver 1553 |
| portrait | 2 | 22.10 / 25.60 / 31.06 | jet (14,14,14), light-sapphire (72,72,72), silver (137,137,137) | jet and light-sapphire only |

The tiger's app output reproduces at a **width** of 129.6 mm (height 129.80 mm, from the source's
1300×1302 aspect), Staggered, SS6 (2.0 mm), gap 0.3 mm, Fill Empty Slots on. A height of 129.6 mm
gives 2989 stones instead.

Measured only, on the same settings, for the other five images:

| Image | Auto | k=2..8 mean ΔE |
|---|---|---|
| logo | 2 | 7.79 10.31 10.47 10.75 11.25 11.51 11.72 |
| Einstein | 3 | 30.69 28.72 30.92 29.78 29.57 30.87 30.32 |
| butterfly | 4 | 39.03 34.82 26.79 27.32 29.58 29.42 34.71 |
| cartoon | 8 | 30.31 29.46 28.45 27.48 25.33 25.02 24.97 |
| furry | 7 | 31.26 32.25 28.55 28.15 33.27 27.57 31.65 |

### Direct catalogue labelling (this milestone)

The **primary** columns use decision 2's definitions, measured here: shares and mean ΔE *after* the
1.2% floor, relabelling and the 8-colour cap. The **raw** columns are nearest-colour labelling over
the full catalogue *before* the floor, relabelling and cap. That is the stage the architect's
figures were taken at, and the colour lists name the colours that clear the floor. Every raw figure
measured here agrees with the provided figure at the precision it was given. "Auto (proposed)" is
decision 7's resolved value, `max(2, n)`. Each of the seven photographs has n ≥ 3, so decision 7
leaves every figure in this table unchanged.

| Image | Auto (proposed) | Mean ΔE | Colours kept, share % (primary) | Raw, before floor and relabel (provided) | Raw, measured |
|---|---|---|---|---|---|
| tiger | 6 | 23.31 | silver 39.25, jet 30.81, topaz 11.95, siam 9.59, crystal-clear 6.91, rose 1.50 | 23.3; silver 38, jet 30, topaz 11, siam 9, crystal-clear 7, rose 1 | 23.27; 38.32, 30.497, 10.96, 9.03, 6.82, 1.31 |
| portrait | 3 | 18.79 | jet 65.61, silver 22.81, light-sapphire 11.58 | 18.8; jet 66, silver 23, light-sapphire 12 | 18.79; 65.61, 22.81, 11.58 |
| logo | 3 | 7.73 | jet 90.28, silver 8.22, light-sapphire 1.51 | 7.7; jet 90, silver 7, light-sapphire 2 | 7.66; 90.28, 7.11, 1.51 |
| Einstein | 7 | 25.08 | silver 29.14, jet 24.89, rose 17.43, siam 12.96, light-siam 7.24, light-sapphire 5.99, crystal-clear 2.36 | 25.1; silver 29, jet 25, rose 17, siam 13, light-siam 7, light-sapphire 6, crystal-clear 2 | 25.06; 29.09, 24.88, 17.23, 12.61, 6.83, 5.99, 2.34 |
| butterfly | 8 (10 clear the floor) | 22.99 | jet 34.62, light-sapphire 16.31, topaz 14.08, silver 9.19, siam 7.26, aquamarine 7.19, citrine 5.98, crystal-clear 5.37 | 22.6; jet 33 | 22.59; jet 32.80 |
| cartoon | 8 | 23.50 | gold 35.57, topaz 19.38, siam 12.07, light-siam 8.67, jet 8.23, peridot 7.73, citrine 5.52, rose 2.82 | 23.4; 8 colours led by gold 36 | 23.39; gold 35.57 |
| furry | 8 | 23.52 | silver 45.85, jet 20.03, light-sapphire 13.57, siam 7.31, topaz 5.49, aquamarine 3.41, crystal-clear 2.55, rose 1.79 | 23.5; 8 colours led by silver 46 | 23.50; silver 45.85 |

The provided butterfly figures originally said "eight colours". That was an error, confirmed by the
architect: **ten** colours clear the floor (sapphire 3.08% and gold 2.04% are the two below the
top eight). Under decision 3, Auto caps at 8. The cap drops those two colours, and relabelling their
pixels raises mean ΔE from 22.63 (floor only) to 22.99.

Mean ΔE falls on every photograph compared with the shipped Auto result: tiger 27.94 → 23.31,
portrait 22.10 → 18.79, logo 7.79 → 7.73, Einstein 28.72 → 25.08, butterfly 26.79 → 22.99, cartoon
24.97 → 23.50, furry 27.57 → 23.52.

**Fixture files.** None of the seven images is in the repository. They were decoded from the lead's
own files with PIL (RGBA, no resize; the app applies none below 4000 px):

| Image | File |
|---|---|
| tiger | `tiger_orig.jpg` |
| portrait | `portrat_orig.jpg` |
| logo | `logo_original.png` |
| Einstein | `albert-einstein_orig.png` |
| butterfly | `butterfly2_original.jpeg` |
| cartoon | `cartoon-orig.png` |
| furry | `furry-orig.png` |

The tiger and portrait reproduce every shipped figure above exactly. That confirms both the file
identity and the decoding.

## Decisions

### 1. The direct labelling moves into `src/image`, taking the palette as data

`LineDesignSampler.js`'s `buildLabelField()` (`:168-217`) is already the per-pixel labelling this
milestone needs. It moves, unchanged in arithmetic, into an exported pure function in
`src/image/ColorQuantize.js`, next to `quantizeColors()`. The function takes the r/g/b channels, a
per-pixel eligibility mask, the `[{id, hex}]` palette, a minimum share and a maximum colour count. It
returns per-pixel palette indices (255 where ineligible), the kept palette indices in palette order,
and raw and final per-colour counts. The share constant moves with it, as `0.012`, and
`LineDesignSampler.js` keeps exporting `LINE_DESIGN_MIN_COLOR_SHARE` as an alias of it.
`LineDesignSampler.js` then imports the function, which it may: `src/geometry/**` already imports
`src/image/SubjectMask.js` and `src/image/ColorSpace.js`.

*Rationale.* There is exactly one colour rule, and it lives on the image side of the
`src/image`/`src/geometry` boundary, where the palette already arrives as plain data. Line Design
passes its own eligibility mask (the hole-filled silhouette), its own inpainted channels and no cap.
With no cap, the function performs exactly the loops `buildLabelField()` performs today.

*Measured byte identity.* With the function moved and Line Design calling it, two checks came out
identical to the pristine tip:

* `tools/test-img-010-line-design.mjs` passes in full on the scratch copy.
* The full Line Design stone list, hashed as `[xMm, yMm, sizeMm, color]`, is identical on two real
  photographs: tiger at 129.6 mm, 1585 stones, `12bff27cdff18f6a`; butterfly, 760 stones,
  `59dcfdeba6fedb4a`.

`buildLabelField()`'s fallback (when no colour clears the floor, keep every observed colour) moves
with the function unchanged.

### 2. `quantizeColors()` becomes direct catalogue labelling; one group per catalogue colour

`quantizeColors({ r, g, b, data, colorCount, palette })` keeps its signature and its return shape,
`{ labels, colorGroups: [{ rgb, pixelShare, nearestId }] }`. Each colour group is now exactly one
catalogue colour:

1. Label every subject pixel (`data >= FIELD_ON_THRESHOLD`) with its CIE76-nearest entry over the
   full palette.
2. Drop every entry whose share of subject pixels is under 1.2%. If none clears the floor, keep
   every observed entry, as in decision 1.
3. Keep at most `colorCount` of the rest by descending raw share, ties broken by palette order.
4. Relabel every pixel of a dropped entry to its nearest kept entry. Ties go to the first in palette
   order, the same strict-less-than loop `buildLabelField()` uses.
5. Set each group's `rgb` to the rounded mean of the pixels finally labelled with it, `pixelShare`
   to its final share, and `nearestId` to its catalogue id.
6. Order `colorGroups` in **palette order**. `labels` holds group indices, and ineligible pixels are
   `NO_LABEL`, unchanged.

Fewer than `colorCount` groups result whenever fewer colours survive, which the current doc comment
already allows. No subject pixels still returns `colorGroups: []`.

Median cut, the histogram, k-means and `assignNearestIds()` retire. None of them is exported, and
none has another caller.

*Rationale.* Every pixel's stone is the stone nearest to *that pixel*, never to a blended mean, and
no stone is chosen because a nearer one was already taken. Uniqueness of `nearestId` across groups
(the one thing the distinct claim guaranteed, and what keys `colorMap` in decision 5) now holds by
construction, because a catalogue colour cannot be kept twice. Palette order makes group order stable
as shares shift, so Studio rows don't reshuffle while a slider moves. It also makes decision 4's
modal tie-break (lowest label wins) exactly Line Design's palette-order tie-break, with no extra field
on the group.

### 3. Auto resolves to the number of colours clearing the floor, capped at 8

`chooseAutoColorCount(field, palette)` (`src/image/AutoColourCount.js:79`) keeps its name, signature
and `resolvedCount`. It runs decision 1's labelling once over the same subject pixels and counts n,
the colours that clear the floor, capped at 8 (`AUTO_MAX_K`). It returns decision 7's
`max(2, n)`. No subject pixels still resolves to 1. Everywhere in this spec, "Auto" means that
resolved value. `app.js` reads only `resolvedCount` (`app.js:778`), so its call site, cache and freeze
(`app.js:754-783`) are unchanged in code. Their comment at `:726-753`, which describes "the 7-call
sweep", is updated.

The IMG-012 sweep and its 1% tie band retire:

| What | Status |
|---|---|
| `pickAutoColorCountWinner` (export, `:132-142`) | Only other consumer is `tools/test-img-012-auto-colour-count.mjs` Item 3. **Removed**, with that item. |
| `winnerK` and `scores` in `chooseAutoColorCount`'s return | No production reader. **Dropped**. |
| `AUTO_MIN_K`, `AUTO_TIE_TOLERANCE`, `SCORE_SUBSAMPLE_STRIDE` (`:25-33`) | **Removed**. |
| `parseHexColor()` (`:35`), the `quantizeColors`/`rgbToLab`/`cie76Distance` imports (`:20-21`) | **Removed**. |
| `prepareAutoColorField` (`:53`), `AUTO_MAX_K` | **Kept**. |
| `src/image/index.js:49-52` | Unchanged. It exports only `chooseAutoColorCount` and `prepareAutoColorField`. |

*Rationale.* Under direct labelling, extra colours no longer add error: a colour clears the floor
only because enough pixels are nearest to it. The lowest-error `k` is therefore just "every colour
that is really there". A sweep that re-runs the labeller for k=2..8 to discover that answer is
seven passes of work for a count the first pass already has.

### 4. Every fill mode gives each stone the modal kept label under its own radius

`generateImageLayout()`'s `colorAt` (`src/geometry/GeometryEngine.js:1263-1269`) changes from the
label of the stone-centre pixel (`fieldLabelAt()`, `src/geometry/StoneSampler.js:1812`) to the
**modal** label over every labelled pixel within `LINE_DESIGN_MODAL_COLOR_RADIUS_RATIO` (0.8,
`LineDesignSampler.js:54`) of the stone's own radius. This is the rule Line Design already applies
(`LineDesignSampler.js:736-758`). The details:

* The centre cell is `fieldLabelAt()`'s own clamped cell.
* The pixel radius is `max(1, round(radiusMm / (widthMm / widthPx)))` over a disk
  (`dx² + dy² ≤ r²`), counting only pixels that are not `NO_LABEL`.
* Ties go to the lowest label, which is palette order by decision 2.
* A disk with no labelled pixel falls back to `fieldLabelAt()`, and `NO_LABEL` still returns
  `options.color`, as today.
* The stone's own size is passed at every call site:

| Stones | Site | Size passed |
|---|---|---|
| Primary | `:1319` | `options.stoneSizeMm` |
| IMG-006 brightness | `:1310` | the rung size |
| S-200 infill | `:1349` | the point's `sizeMm` |
| IMG-013 gap fill | `:1369` | `GAP_FILL_STONE_SIZE_MM`, closed over the way Line Design's pocket pass does (`LineDesignSampler.js:875`), since `GapFill.js` calls `colorAt(xMm, yMm)` |

The disk lookup is a new exported `fieldModalLabelAt()` beside `fieldLabelAt()`. A `colorCount` of 1
never reaches it, because the lookup sits inside `labeled`, so single-colour layers stay
byte-identical.

*Rationale.* A stone covers a disk, not a pixel. On a photograph the centre pixel is often a
single-pixel outlier (fur tips, JPEG noise), and the modal label is the colour the stone mostly
covers.

*Measured on the tiger* (129.6 mm wide, Staggered, SS6, gap 0.3 mm, Fill Empty Slots on, Auto =
6): the pixel radius is 2 (0.8 mm at 0.3248 mm/px), and stone positions are identical under both
rules.

| | Stones | jet | silver | topaz | siam | crystal-clear | rose |
|---|---|---|---|---|---|---|---|
| Centre pixel | 2986 | 943 | 1135 | 358 | 281 | 214 | 55 |
| Modal | 2986 | 963 | 1169 | 372 | 268 | 186 | 28 |

**338 of 2986 stones (11.32%) change colour.** The largest transitions are silver→jet 57, jet→silver
56, crystal-clear→silver 48, siam→topaz 32, siam→jet 24 and silver→crystal-clear 22. The modal rule
roughly halves rose (55 → 28), the smallest kept colour at 1.50%.

### 5. `colorMap` semantics are unchanged; saved multi-colour layers regenerate differently

* **`colorMap`.** It stays keyed by catalogue id (`nearestId → overrideId`), and
  `imageRegionColorId()` (`GeometryEngine.js:2455`) is unchanged.
* **Studio rows.** The Colours rows (`app.js:6536-6548`) list the kept colours, one row per group:
  swatch = the group's pixel mean, share = its final share, select = its override or its own id. The
  write-back loop (`app.js:2794-2810`) is unchanged. No `app.js` code change is needed for this
  decision.
* **Regeneration.** **Every saved image layer with any `colorCount` above 1, numeric or `'auto'`,
  regenerates with different colours.** The groups, their catalogue ids, the Auto count and the
  per-stone assignment all change. An override keyed on a catalogue id that no longer appears as a
  group simply stops applying, under IMG-002's existing "unknown key is ignored" rule (item 8).
* **Unchanged layers.** Layers with `colorCount` 1 or absent regenerate byte-identically, as do Line
  Design layers.
* **Positions.** Stone positions and counts are unchanged in every mode (measured on every fixture
  below, and on the full test suite).
* No project version bump and no `validateProject()` change.

### 6. Out of scope

* Adding catalogue colours.
* Chains (Line Design's outline and line chains) in any colour other than jet.

### 7. Auto never takes the uncoloured path

When there are subject pixels, `chooseAutoColorCount()` returns `resolvedCount = max(2, n)`, where
n is the number of colours clearing the floor, capped at 8 (decision 3). With no subject pixels it
still returns 1. The explicit "1 (single colour)" option keeps IMG-002's uncoloured path, where every
stone takes `layer.color`, unchanged.

*Rationale.* Auto means "the image's own stones". A one-colour subject must render in its catalogue
colour, not in `layer.color` (gold for a new import, `app.js:5508`). `quantizeColors()` already
returns fewer groups than `colorCount` when fewer survive (decision 2). So with n = 1 it returns
`colorCount` 2 and a single group, and that group reaches every stone.

**Studio hint.** "Auto: N colours" (`app.js:6535`) reports the number of groups in the layer's
resolved colour field instead of `resolvedCount`. Those groups are the rows the Colours section
renders.
* **Source of the count.** It is `colorField.colorGroups.length`, where `colorField` is the
  `computeImageColorField(l)` result already bound at `app.js:6529`, just above the hint. The
  row loop at `app.js:6536-6548` reads the same `colorGroups` array.
* **No colour field.** When `colorField` is null, the hint falls back to
  `resolveImageColorCount(l)`, as today. That happens when there are no subject pixels (the resolved
  count is 1) or before the source image is decoded.
* **Stone Colour control.** The `multiColorImage` flag at `app.js:278` stays keyed on
  `resolveImageColorCount(sel) > 1`. A one-group Auto layer resolves to 2, so it keeps `#stoneColor`
  disabled, shows its single Colours row, and stays overridable through `colorMap` like any other
  group.

*Measured on the scratch copy* with decision 7 applied:

| Fixture | Auto | `colorGroups` | Hint count | Stones |
|---|---|---|---|---|
| A | 2 | jet (32,32,32) 100.00% | 1 | 169 jet |
| B | 2 | topaz (202,125,35) 100.00% | 1 | 169 topaz |
| C | 2 | jet (21,20,20) 91.00%, silver (216,221,228) 9.00% | 2 | 169: jet 157, silver 12 |

With no subject pixels, Auto is still 1. The seven photographs resolve to 6, 3, 3, 7, 8, 8 and 8,
unchanged from decision 3.

## Resolved finding

A one-colour subject under Auto would have fallen to the uncoloured path (`layer.color`); see
decision 7.

## Synthetic fixtures

The generator code below is to be pinned verbatim in `tools/test-img-015-direct-catalogue-colour.mjs`.
Every pixel is subject (luminance < 255 at threshold 255), and stones are generated with
`mode:'fill'`, 30×30 mm, SS6, gap 0.3 mm, against the real catalogue
(`Object.values(STONE_COLORS).map((c) => ({ id: c.id, hex: c.previewColor }))`).

```js
const FIXTURE_SIZE_PX = 60;

// Fixture A (distinct claim, two close dark greys): left 60% of columns (20,20,20), right 40% (50,50,50).
function buildCloseGreysBuffer(n = FIXTURE_SIZE_PX) {
  const data = new Uint8ClampedArray(n * n * 4);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const i = (y * n + x) * 4;
    const c = x < n * 0.6 ? [20, 20, 20] : [50, 50, 50];
    data[i] = c[0]; data[i + 1] = c[1]; data[i + 2] = c[2]; data[i + 3] = 255;
  }
  return { widthPx: n, heightPx: n, data };
}

// Fixture B (distinct claim, mid orange and a darker shade): left 60% (224,142,38), right 40% (170,100,30).
function buildOrangeShadeBuffer(n = FIXTURE_SIZE_PX) {
  const data = new Uint8ClampedArray(n * n * 4);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const i = (y * n + x) * 4;
    const c = x < n * 0.6 ? [224, 142, 38] : [170, 100, 30];
    data[i] = c[0]; data[i + 1] = c[1]; data[i + 2] = c[2]; data[i + 3] = 255;
  }
  return { widthPx: n, heightPx: n, data };
}

// Fixture C (share floor): rows 0-53 (20,20,20) = 90.0%; rows 54-59 (216,221,228) = 9.0%, except a
// 6x6 (155,28,28) block at the bottom-left = 1.0%, under the 1.2% floor.
function buildFloorBuffer(n = FIXTURE_SIZE_PX) {
  const data = new Uint8ClampedArray(n * n * 4);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const i = (y * n + x) * 4;
    let c = y < 54 ? [20, 20, 20] : [216, 221, 228];
    if (y >= 54 && x < 6) c = [155, 28, 28];
    data[i] = c[0]; data[i + 1] = c[1]; data[i + 2] = c[2]; data[i + 3] = 255;
  }
  return { widthPx: n, heightPx: n, data };
}

const FIXTURE_FIELD_PARAMS = { threshold: 255, invert: false, blurRadiusPx: 0, maxWidthPx: 60, maxHeightPx: 60, transparent: 'white', maskMode: 'threshold' };
const FIXTURE_LAYOUT_PARAMS = { layerId: 'img015', xMm: 0, yMm: 0, widthMm: 30, heightMm: 30, stoneSizeMm: 2, gapMm: 0.3, mode: 'fill', color: 'gold', colorMap: {} };
```

Measured on the pristine tip (shipped) and on the proposal:

| Fixture | Pipeline | Auto | `colorCount` | `colorGroups` (id, rgb, share) | Stones |
|---|---|---|---|---|---|
| A close greys | shipped | 2 | 2 | jet (20,20,20) 60.00%, **light-sapphire** (50,50,50) 40.00% | 169: jet 104, light-sapphire 65 |
| A close greys | proposed | 2 | 2 (Auto) | jet (32,32,32) 100.00% | 169: jet 169 |
| B orange + shade | shipped | 2 | 2 | **siam** (170,100,30) 40.00%, topaz (224,142,38) 60.00% | 169: topaz 104, siam 65 |
| B orange + shade | proposed | 2 | 2 (Auto) | topaz (202,125,35) 100.00% | 169: topaz 169 |
| C floor | shipped | 3 | 3 | jet (20,20,20) 90.00%, siam (155,28,28) 1.00%, silver (216,221,228) 9.00% | 169: jet 156, siam 1, silver 12 |
| C floor | proposed | 2 | 3 | jet (21,20,20) 91.00%, silver (216,221,228) 9.00% | 169: jet 157, silver 12 |
| C floor | proposed | 2 | 2 (Auto) | jet (21,20,20) 91.00%, silver (216,221,228) 9.00% | 169: jet 157, silver 12 |

What each fixture shows:

* **A.** The (50,50,50) grey is nearest jet, but jet is claimed, so the shipped pipeline sends it to
  light-sapphire: a blue stone for a grey pixel.
* **B.** The darker orange is nearest topaz, but topaz is claimed, so the shipped pipeline sends it
  to siam, a deep red.
* **C.** The 1% red block drops under the floor and is relabelled to jet, its nearest kept colour.
  The jet group's mean moves from (20,20,20) to (21,20,20), and the one siam stone becomes jet.

On all three fixtures, centre-pixel and modal assignment agree (0 stones change).

## Existing tests

A grep of `tools/test-*.mjs` for `quantizeColors`, `assignNearestIds`, `chooseAutoColorCount`,
`pickAutoColorCountWinner`, `colorGroups`, `nearestId`, `colorCount` and image-layer stone colours
matches the files below. Each was run against the scratch copy with the proposal applied, with
`assert` replaced by a logger so every mismatched literal is reported rather than only the first.

The full suite on that copy: 165 files, **161 pass, 4 fail**. The four failures are exactly
img-002, img-008, img-009 and img-012.

### Pinned literals expected to change

**`tools/test-img-002-color-layers.mjs`**
- Item 9 (`:256-276`): its premise, the distinct claim, retires. On its own fixture, `colorGroups`
  goes from `[{rgb:[5,5,5], pixelShare:0.3, nearestId:'distant'}, {rgb:[40,40,40], pixelShare:0.7,
  nearestId:'near-black'}]` to `[{rgb:[30,30,30], pixelShare:1, nearestId:'near-black'}]`.
- `:268` `colorGroups.length` 2 → 1. `:270-275` (majority/minority split, `'near-black'`/`'distant'`)
  have no counterpart.
- The item is replaced by one pinning "one group per catalogue colour".

**`tools/test-img-008-vector-first-svg.mjs`**
- Item 1, `:130`: the photo SVG sha256 goes from `e8d4f4506fa19dc4a8298f1ee0a7d66c2325848527ea09b628ae44651567e70e`
  to `14c52341a04adc46671f5148531ca7ba14c0979f95b954c94bab5a1a1e8f8d26`.
  - The stone count at `:126` stays 58. The colours (unpinned) go from crystal 37, siam 14, citrine
    7 to crystal 57, siam 1.
  - The logo half of Item 1 (`colorCount:1`) is unchanged.
- Item 2, `:142`: per-label raw contour counts `[2, 32, 2]` → `[2, 1, 2]`. The logo's star label was
  collecting 32 anti-aliased fragments and is now one region. `:145`'s 3 is unchanged.
- Item 4:

  | Line | What | Old | New |
  |---|---|---|---|
  | `:172` | siam vertices | 287 | 281 |
  | `:173` | siam areas | `[1278.5, 118.6]` | `[1281.5, 111.8]` |
  | `:177` | citrine vertices | 99 | 93 |
  | `:178` | citrine areas | `[118.6]` | `[111.8]` |

  Region count 3, colour ids siam/citrine/sapphire, siam contour count 2, all sapphire literals and
  the `colorMap` remap assertions are unchanged.
- Item 5:
  - `:207` `threeColor.regions.length` 3 → 2.
  - `:214-216` `expectedByLabel` goes from `[{citrine, 2, 182}, {siam, 7, 405}, {crystal, 7, 559}]`
    to `[{siam, 1, 58}, {crystal, 4, 506}]`, each entry being `{colorId, kept, raw}`.
  - On this synthetic greyscale photo against a four-entry test palette, the shipped pipeline's
    darkest cluster (50,50,50) claimed **citrine**, a yellow stone. It now labels siam
    (19,19,19) 3.96% and crystal (94,94,94) 96.04%.
  - The `colorCount:1` literals at `:196-204` are unchanged.
- Item 6, `:251` `expectedIoU`: citrine `'0.959'` → `'0.976'`, sapphire `'0.971'` → `'0.970'`. Siam
  `'0.991'` and both single-colour IoUs are unchanged.
- Items 3, 7 and 8 are unchanged, including Item 8's stone breakdown `{siam: 109, sapphire: 46,
  citrine: 11}`.

**`tools/test-img-009-subject-mask.mjs`**
- Item 6, `:216`: subject-mask ids `['jet', 'siam', 'citrine', 'silver', 'light-sapphire']` →
  `['jet', 'light-sapphire', 'topaz', 'citrine', 'silver']`. `:217` threshold-mask ids
  `['jet', 'siam']` → `['jet']`. The item title (`:213`) changes with them.
- Item 7, `:231-233`: the same eight ids, now in palette order:
  `['jet', 'siam', 'topaz', 'citrine', 'sapphire', 'light-sapphire', 'silver', 'crystal']` →
  `['jet', 'siam', 'sapphire', 'light-sapphire', 'topaz', 'citrine', 'silver', 'crystal']`.
  - Each single-pixel "cluster" still resolves to the same stone; only the group order changes.
  - The title (`:222`) names `assignNearestIds()`, which retires. The `PRISTINE_LAB` assertions are
    unchanged.

**`tools/test-img-012-auto-colour-count.mjs`**
- Import `:5`: `pickAutoColorCountWinner` is removed. The header comment (`:13-22`) is rewritten.
- Item 1, `:111`, `:113-117`: the `winnerK` and `scores` assertions retire. `:112` `resolvedCount` 4
  is **unchanged**.
- Item 2, `:123-126`: the `scores`/`winnerK` assertions retire. `:127` `resolvedCount` 6 is
  **unchanged**. The title drops "under D1 (winnerK=6)".
- Item 3 (`:131-148`) is removed with `pickAutoColorCountWinner`.
- Item 7 `STEP0_BASELINE`:

  | Line | Entry | Old | New |
  |---|---|---|---|
  | `:278` | subject 2 | `['light-sapphire', 'topaz']` | `['sapphire', 'siam']` |
  | `:279` | subject 3 | `['emerald', 'sapphire', 'topaz']` | `['emerald', 'sapphire', 'siam']` |
  | `:289` | threshold 2 | `['jet', 'sapphire']` | `['sapphire', 'siam']` |

  Every stone count and every other entry is unchanged. The fixture is four exact catalogue colours,
  so under direct labelling k=2 and k=3 keep the top shares by palette order, where the shipped
  k-means blend claimed light-sapphire, topaz and jet, none of which is in the image.
- Items 10 and 14 (decision 7): `extractAutoHintSource()`'s exact-source marker (`:401`) no longer
  matches once the hint reads the group count.
  - Both items then inject a stub colour field alongside the `resolveImageColorCount` stub.
  - Their expected texts are unchanged: `'Auto: 4 colours'` (`:417`, `:494`) and `'Auto: 1 colour'`
    (`:493`).
- Items 4, 5 and 6, 8, 9, and 11-13 are unchanged. Item 4's subject 4 / threshold 3 still hold.

### Unchanged, noted

- **`tools/test-img-010-line-design.mjs`** passes in full, byte-identical (decision 1).
- **`tools/test-img-013-fill-empty-slots.mjs`** passes with no literal change, Item 13's colour
  byte-identity literals included.
  - Item 7 (`:243`) independently reconstructs filler colour with the centre-pixel rule
    (`fieldLabelAt()`). It still passes on this fixture, where the two rules happen to agree.
  - The build updates that reconstruction to decision 4's modal rule, so it keeps testing the rule
    that ships.
- **`tools/test-img-011-import-defaults.mjs`**, **`tools/test-img-014-subject-mask-photographic.mjs`**
  and **`tools/test-fill-algorithms-integration.mjs`** match the grep and pass unchanged.

## Code sites the build touches (at `918622f`)

| File | Lines | Change |
|---|---|---|
| `src/image/ColorQuantize.js` | `:1-17` | header rewritten (direct labelling, not median cut) |
| | `:21` | import kept (the labeller needs `rgbToLab`/`cie76Distance`) |
| | `:32-233` | `CHANNEL_KEYS`, `parseHexColor`, histogram, median cut, k-means, `assignNearestIds()` removed; the moved labeller and share constant added |
| | `:235-298` | `quantizeColors()` doc and body per decision 2 |
| `src/image/AutoColourCount.js` | `:1-18`, `:20-23`, `:25-38`, `:73-120`, `:122-142` | header; imports; constants; `chooseAutoColorCount()` body returning `max(2, n)` with subject pixels (decisions 3, 7); `pickAutoColorCountWinner()` removed |
| `src/image/README.md` | `:69-75`, `:77-84`, `:136-138` | describe per-pixel catalogue labelling |
| `src/geometry/LineDesignSampler.js` | `:5-8` | header's "decision b" now points at the moved function |
| | `:24-25` | new import |
| | `:49-51` | `LINE_DESIGN_MIN_COLOR_SHARE` aliases the moved constant |
| | `:166-217` | `buildLabelField()` body delegates |
| | `:723` | call site (drops `widthPx`/`heightPx`) |
| `src/geometry/StoneSampler.js` | after `:1824` | new `fieldModalLabelAt()` |
| `src/geometry/GeometryEngine.js` | `:25` | import `fieldModalLabelAt` |
| | `:51` | import `GAP_FILL_STONE_SIZE_MM` |
| | `:55` | import `LINE_DESIGN_MODAL_COLOR_RADIUS_RATIO` |
| | `:1185-1187` | `colorCount` doc |
| | `:1258-1269` | `colorAt(xMm, yMm, sizeMm)` |
| | `:1310`, `:1319`, `:1349` | pass sizes |
| | `:1369` | gap-fill closure |
| `app.js` | `:726-753`, `:791-797` | comments only (Auto sweep and "median-cut + 8 k-means passes" cost notes) |
| | `:6535` | Auto hint reports `colorField.colorGroups.length` (decision 7), with `resolveImageColorCount(l)` as the fallback when `colorField` is null |
| | `:278` | unchanged: `multiColorImage` stays `resolveImageColorCount(sel) > 1` (decision 7) |
| `tools/test-img-002-color-layers.mjs`, `tools/test-img-008-vector-first-svg.mjs`, `tools/test-img-009-subject-mask.mjs`, `tools/test-img-012-auto-colour-count.mjs`, `tools/test-img-013-fill-empty-slots.mjs` | as listed above | |
| new `tools/test-img-015-direct-catalogue-colour.mjs` | | fixtures A-C, the Line Design hash parity, decision 4's modal rule; decision 7: fixtures A and B under Auto give 169 jet and 169 topaz, and the hint count is 1 |
| `tools/test-img-012-auto-colour-count.mjs` | `:401`, items 10 and 14 | hint marker and stubs (decision 7) |

`index.html`'s "Auto (best fit)" option label (`:1192`) is left as is.
