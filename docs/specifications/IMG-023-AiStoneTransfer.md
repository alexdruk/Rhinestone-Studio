# IMG-023 — AI stone transfer

**Status: spec.** File:line citations are against `develop` @ `eea2b8f` (the IMG-022 merge). Every
anchor below was re-grepped on that tip. No implementation code exists yet.

## Objective

A redrawn image (IMG-022) is a picture of rhinestones: round stones in honeycomb rows, one flat
colour each, with a small white highlight dot. Today the app treats it like a photo. The existing
image modes re-sample it on their own grid, so its one-stone lines break, and they quantise its
pixels, so its colours turn blotchy.

IMG-023 adds an image fill mode, **AI stones** (`'ai-stones'`), that reads the stones the AI drew and
places real stones from them. It also switches IMG-022's redraw to the prompt and model chosen by
experiment. After a redraw, the layer is set to AI stones and sized so that one AI stone is one real
stone.

The algorithm is fixed by the reference prototype `docs/prototypes/ai_stone_transfer_reference.py`
(a byte-identical copy of `tools/scratch/img-023/ai_stone_transfer_reference.py`). Its docstring
states the algorithm and every constant. The JavaScript implements exactly that algorithm with those
constants. Where the reference calls OpenCV, scipy or scikit-image, this spec says which plain-JS
operation replaces it ("Port contract" below).

`GeometryEngine.generateImageLayout()` stays the only producer of image-layer stones. The new code is
pure: no DOM, no canvas.

## Reference figures

### Provenance

The four inputs are `tools/scratch/img-023/{tiger,albert-einstein,portrat,butterfly2}.png`. They are
gpt-image-2 outputs from the D6 "designer" prompt, 1024 × 1024 RGBA, and are not committed. Every run
is SS6 (`stoneSize` 2 mm), gap 0.3 mm (pitch 2.3 mm). The full per-stone output of each run is in
`tools/scratch/img-023/<name>-100.json` (shrink 1.0) and `<name>-80.json` (shrink 0.8), also not
committed.

The figures come from two library setups running the unchanged reference script:

- **Setup A** (the brief's figures): numpy 2.4.4, OpenCV 4.13.0, scipy 1.17.1, scikit-image 0.26.0,
  Pillow 12.2.0.
- **Setup B** (Claude's re-run for this spec): numpy 2.2.5, OpenCV 4.11.0.86, scipy 1.17.1,
  scikit-image 0.26.0, Python 3.11 on macOS. Setup A could not be rebuilt here, because OpenCV
  4.13.0 has no wheel for this machine.

The figures are pinned in two groups.

### 1. Exact (identical in both setups)

For these, both setups give the same values. The spec pins Setup A's values.

| Image | Shrink | AI pitch px | Width × height mm | Real stones | Palette (catalogue order) | Positions SHA-256 (first 16) |
|---|---|---|---|---|---|---|
| tiger | 1.0 | 11.467 | 205.2 × 205.0 | 8176 | crystal-clear, jet, light-siam, topaz, gold, black-diamond, grey, light-colorado | `8c5cd56a6990bfa6` |
| tiger | 0.8 | 11.467 | 164.2 × 164.0 | 5325 | same | `29a39fdfe365b66c` |
| albert-einstein | 1.0 | 9.464 | 247.7 × 243.5 | 10499 | crystal-clear, jet, siam, light-siam, black-diamond, grey, light-colorado, light-peach | `b8147d0bdd8681d9` |
| albert-einstein | 0.8 | 9.464 | 198.1 × 194.8 | 6801 | same | `7b889f38a920a607` |
| portrat | 1.0 | 10.647 | 220.8 × 220.8 | 8867 | crystal-clear, jet, siam, hematite, black-diamond, grey, light-colorado, light-peach | `1285f5742b05e5ac` |
| portrat | 0.8 | 10.647 | 176.6 × 176.6 | 5693 | same | `8f9d131f47f9e610` |
| butterfly2 | 1.0 | 10.966 | 208.1 × 211.0 | 5109 | jet, sapphire, light-sapphire, aquamarine, topaz, gold, silver, light-colorado | `1a93815adde240c0` |
| butterfly2 | 0.8 | 10.966 | 166.5 × 168.8 | 3347 | same | `14d458396b4aa732` |

Width × height is the subject's size: the bounding box of pixels with alpha > 128, times the scale.
The position hash is the SHA-256 of the UTF-8 text made of one `"<x>,<y>\n"` line per stone, in
output order, with x and y formatted to 3 decimals (`f"{x:.3f},{y:.3f}\n"`). Every real-stone
position matched exactly between the two setups (identical hashes).

### 2. Tolerant (differ between setups)

These are the AI-stone count and the per-colour counts. They are pinned to Setup A's values with
these setup-to-setup tolerances (F1, resolved):

- AI-stone count and Jet: **max(0.5 % of the pinned value, 10 stones)**;
- every other per-colour count: **max(1.5 % of the pinned value, 15 stones)**.

Setup B's values are listed next to them, as `A / B`. All of them fall inside these bands.

| Run | AI stones | Per-colour counts, `A / B` |
|---|---|---|
| tiger 1.0 | 6531 / 6534 | jet 3004/3006, topaz 1280/1280, grey 1169/1169, crystal-clear 788/789, light-colorado 644/643, gold 578/579, black-diamond 476/473, light-siam 237/237 |
| tiger 0.8 | 6531 / 6534 | jet 1974/1978, topaz 819/819, grey 769/768, crystal-clear 481/487, light-colorado 438/434, gold 378/380, black-diamond 308/301, light-siam 158/158 |
| albert-einstein 1.0 | 8250 / 8257 | jet 3156/3158, grey 1441/1439, siam 1355/1355, light-siam 1256/1256, light-colorado 1173/1176, black-diamond 976/973, crystal-clear 624/629, light-peach 518/513 |
| albert-einstein 0.8 | 8250 / 8257 | jet 2045/2045, grey 915/914, siam 873/873, light-siam 819/819, light-colorado 765/769, black-diamond 637/636, crystal-clear 413/417, light-peach 334/328 |
| portrat 1.0 | 7527 / 7536 | jet 3600/3599, light-colorado 2253/2262, black-diamond 1021/1021, light-peach **862/851**, grey 466/465, hematite 359/360, crystal-clear 208/211, siam 98/98 |
| portrat 0.8 | 7527 / 7536 | jet 2338/2339, light-colorado 1464/1471, black-diamond 647/646, light-peach **514/502**, grey 311/309, hematite 217/217, crystal-clear 135/142, siam 67/67 |
| butterfly2 1.0 | 3682 / 3679 | jet 2447/2448, sapphire 712/710, topaz 476/476, light-sapphire 438/438, aquamarine 427/428, gold 308/306, light-colorado 198/200, silver 103/103 |
| butterfly2 0.8 | 3682 / 3679 | jet 1605/1608, sapphire 475/475, topaz 324/324, aquamarine 280/279, light-sapphire 272/272, gold 200/199, light-colorado 122/123, silver 69/67 |

The Siam counts behind the brief's "(siam 1355)" and "(siam 98, the lips)" are identical in both
setups. The largest AI-stone difference is 9 (portrat). The largest Jet difference is 4 (tiger 0.8).
Portrat's **light-peach** differs by 11 (shrink 1.0) and 12 (0.8). That exceeded the first band
of 10 even between two runs of the reference itself, and is why per-colour counts have the wider
band (F1).

Pitch is identical in both setups, so the difference comes after highlight detection: it is in the
step that adds stones without a dot, which uses the distance transform, Gaussian blur and
`peak_local_max`.

### What the difference suggests for the port

These are Setup B experiments with the reference script. Nothing was committed.

- **Engine grid in place of `hexgrid()`.** The real-stone count moves by −0.69 % to +0.18 %. The
  palette is identical, and no position coincides with the reference (see D4).
- **8-bit L\* computed as `round(L* × 255/100)`**, the plain-JS form (see "Port contract"). This
  differs from OpenCV's by at most one level, on about 20 % of pixels. The AI pitch moves by up to
  0.2 % (portrat 10.647 → 10.668, tiger 11.467 → 11.457), and real-stone totals move by up to
  −0.33 %. Because the scale follows the pitch, colours at the same grid position agree on only
  89.7 % (portrat) to 99.6 % of stones.
- **The same L\* change with the scale held at the pinned pitch.** Colour agreement at the same
  positions is 97.66 % (tiger 1.0), 97.77 %, 98.32 %, 98.46 %, 98.59 %, 98.56 %, 99.63 % and 99.52 %.

These figures shape the acceptance protocol below.

## Decisions

These were settled before this spec was written. They are recorded here and not reopened. Where
this spec adds detail a decision leaves open, the detail is marked **(spec)**.

### D1. New image fill mode `'ai-stones'`

`'ai-stones'` joins `IMAGE_FILL_MODES` (`app.js:667`) and `IMAGE_SAMPLE_MODES`
(`src/geometry/GeometryEngine.js:71`), appended after `'line-design'`. It follows the Line Design
precedent (`src/geometry/LineDesignSampler.js`, branched into from `generateImageLayout()` at
`GeometryEngine.js:1246`/`:1278-1294`): a mode with its own sampler module that never reaches
`sampleFieldByMode()`. Stone positions are still produced only inside
`GeometryEngine.generateImageLayout()`.

The code splits into two new pure modules:

- **`src/image/AiStoneDetect.js`** (image analysis): highlight detection, dot merge, pitch, stones
  without a dot, and per-stone Lab colour. It imports only from inside `src/image/`
  (`ColorSpace.js`'s `rgbToLab`); no `src/image/` file imports from elsewhere today, and this keeps it
  that way. `detectAiStones` is exported from the `src/image/index.js` barrel.
- **`src/geometry/AiStoneSampler.js`** (placement): palette choice, grid points (by calling the
  engine's existing staggered grid, D4), per-point colour, and the Jet rule. It imports
  `rgbToLab` from `../image/ColorSpace.js` (as `LineDesignSampler.js:27` does) and
  `sampleStaggeredFillPoints` from `./StoneSampler.js`.

**Exports (spec).**

```js
// src/image/AiStoneDetect.js
export function detectAiStones(imageBuffer)
//  -> { ok: true, pitchPx, widthPx, heightPx, dotCount,
//       stones: [{ xPx, yPx, lab: [L, a, b], jetLike: boolean, fromDot: boolean }] }
//  -> { ok: false, reason: 'too-few-highlights', dotCount, widthPx, heightPx }
export const AI_STONE_* // one named constant per reference constant (list below)

// src/geometry/AiStoneSampler.js
export function chooseAiStonePalette(labs, catalogLabs, cap = 8)   // -> sorted catalogue indices
export function placeAiStones({ detection, imageBuffer, placement, stoneSizeMm, gapMm, palette, points })
//  -> [{ xMm, yMm, color }]; `points` is optional (default: the engine grid, D4) so the
//     acceptance protocol can evaluate the reference's own positions.
```

`detectAiStones()` returns `ok: false` when fewer than 7 highlight blobs are found: the reference's
7-nearest-neighbour pitch estimate needs at least 7 **(spec)**. A layer in `'ai-stones'` mode then
generates no stones, and the Studio shows the D2 "no AI stones" hint.

**Engine wiring (spec).** In `generateImageLayout()`:

- `const isAiStones = options.mode === 'ai-stones';` is added next to `isLineDesign`.
- For AI stones, `prepareImageField()` is **not** called (`field` is `null`). Nothing on this path
  reads it, and skipping it avoids a subject-mask pass on every regenerate. `sampleFieldByMode()` is
  skipped, as for Line Design.
- A new branch builds the stones from `placeAiStones()`. It sits before the `isBrightness` branch,
  so a brightness `sizeMode` is ignored. Every stone gets `sizeMm = stoneSizeMm` and
  `color = <catalogue id>`. `metadata: { kind: 'ai-stone' }`.
- S-200 mixed infill and IMG-013 fill-gaps are skipped for `isAiStones` (`!isLineDesign` becomes
  `!isLineDesign && !isAiStones` at `:1341` and `:1370`). The IMG-021 rotation tail (`:1386-1388`)
  applies unchanged.
- `sourceMode` is `'ai-stones'`.
- `normalizeImageParams()` (`:2489`) passes through a new optional `aiStoneDetection` param. It must
  be `null`/absent or an object with a boolean `ok`; anything else throws a `TypeError`. When it is
  absent, the engine calls `detectAiStones(options.imageBuffer)` itself, so headless callers work.
- The engine imports `detectAiStones` by adding it to the existing `'../image/index.js'` import
  (`GeometryEngine.js:32`).

**App wiring (spec).** `generateImageStonesLive()` (`app.js:1147`) gets **no new branch and no
third `const params={…};`** (`test-img-017-vividness.mjs` T6 requires exactly two). The ordinary
params object (`:1170`) gains one field before `...mixedSizeParamsFor(layer)`:

```js
aiStoneDetection:mode==='ai-stones'?aiStoneDetectionFor(layer.imageSrc,buffer):null,
```

`aiStoneDetectionFor(imageSrc,buffer)` is a new module-level function next to `imageBufferCache`
(`app.js:231`). It keeps a 2-entry LRU `Map` keyed by `imageSrc` and calls `detectAiStones(buffer)`
on a miss. The ternary keeps the identifier unevaluated for every other mode, so the harnesses that
run this method through `new Function()` with a fixed dependency list (test-img-010, -013, -021) are
unaffected. With detection cached, a regenerate only runs placement. The build measures both costs
on the tiger image in Node and reports them. The budgets are 1.5 s for detection and 100 ms for
placement; they are reported, not asserted, because timing tests are flaky here.

Parameters that AI stones ignores (spec): threshold, invert, blurRadiusPx,
maxWidthPx/maxHeightPx, transparent, maskMode, colorCount, vividness, colorMap, seed, spread,
edgeWidthMm, edgeThinning, brightnessThinning, fillGaps, sizeMode and its mixed/brightness sizes,
and `color`.

### D2. Scale, shrink and sizing

The design's millimetres per pixel are:

```
mmPerPx = (stoneSize + gap) / (aiPitchPx / shrink)  =  (stoneSize + gap) × shrink / aiPitchPx
```

`layer.aiStoneShrink` is a new, optional image-layer field. It is set from a new Studio select,
`#imgAiStoneShrink`, with the steps 1.0 / 0.9 / 0.8.

- **Reading it (spec).** `resolveAiStoneShrink(value)` (app.js, next to `resolveImageFillMode()` at
  `:696`, plain literals) returns `value` when it is `0.9` or `0.8`, and `1` otherwise, including
  when the field is missing.
- **Writing it (spec).** The write in `writeSelectedControlsToLayer()`'s image branch goes after the
  vividness statement (`:2830`), and only for a layer that uses the mode or already has the key:
  `if(resolveImageFillMode(l.fillMode)==='ai-stones'||l.aiStoneShrink!==undefined)l.aiStoneShrink=resolveAiStoneShrink(Number(el('imgAiStoneShrink').value));`.
- **`applyRedraw()` does not write it (spec).** A missing field reads as 1.0 (D5).

**Pure sizing helpers (spec).** These are new exports from `src/redraw/RedrawLayerTransform.js`,
re-exported by `src/redraw/index.js`:

```js
export function fitAiStoneBox({ centerXMm, centerYMm, widthPx, heightPx, aiPitchPx, stoneSizeMm, gapMm,
                                shrink = 1, canvas, sheetMaxMm = null })   // -> { x, y, w, h, canvas }
export function aiStoneEffectiveShrink({ w, h, widthPx, heightPx, aiPitchPx, stoneSizeMm, gapMm }) // -> number
```

`fitAiStoneBox()` works as follows:

1. `w0 = widthPx × mmPerPx` and `h0 = heightPx × mmPerPx`.
2. **Flat Sheet** (`sheetMaxMm` given): the sheet grows. Each dimension becomes
   `min(sheetMaxMm, max(current, ceil(w0 + 20)))` for width and likewise `h0` for height. Growth is
   rounded up to a whole millimetre (spec), and the sheet never shrinks.
3. **Fit.** The box is fitted to the resulting canvas minus 20 mm, uniformly shrunk only if needed.
   This restates IMG-022's clamp (`RedrawLayerTransform.js:57-58`, which restates
   `computeDefaultImagePlacement()`), for the reason IMG-022 recorded.
4. **Position.** The box keeps its centre and is shifted, never rescaled, to lie inside the canvas,
   as IMG-022 D9 does.

So on a Flat Sheet the design is shrunk only when it does not fit even at the 500 mm maximum.

The Flat Sheet stores its size as `project.canvas` itself; there is no `project.sheet` object
(`app.js:2951-2956`, RS-3037 "Schema decision"). `SHEET_MAX_MM = 500` is at
`src/products/SheetProductDefinition.js:14`, exported from the barrel at `src/products/index.js:39`.
The canvas is written back from `#sheetWidth`/`#sheetHeight` on every write
(`app.js:2954-2956`). So any growth must also call `setLengthField('sheetWidth'|'sheetHeight', …)`,
or the next edit reverts it. `syncSelectedControlsFromLayer()` already does that at `app.js:2704`.

`aiStoneEffectiveShrink()` returns `min(w / widthPx, h / heightPx) × aiPitchPx / (stoneSize + gap)`.
It uses the layer's live box, so a manual resize counts.

**When the box is re-sized (spec).**

- **(a) After a redraw.** In `startImageRedraw()` (`app.js:5615`), after the result is decoded:
  1. Compute `const detection=aiStoneDetectionFor(result.dataUrl,buffer)`.
  2. On a Flat Sheet, call `fitAiStoneBox()` with `sheetMaxMm: SHEET_MAX_MM` to get the grown
     canvas.
  3. `commitHistory()`.
  4. Assign `project.canvas`.
  5. Call `applyRedraw(current,result,{canvas:project.canvas,naturalWidthPx,naturalHeightPx,now,aiPitchPx:detection.ok?detection.pitchPx:null,shrink:resolveAiStoneShrink(current.aiStoneShrink)})`.

  The existing `syncSelectedControlsFromLayer()` call refreshes the box and sheet fields. Nothing is
  added above the line `test-img-022` T12 pins.

  `applyRedraw()` with a positive finite `aiPitchPx` works like this:
  - It sets `fillMode: 'ai-stones'`.
  - It sizes x/y/w/h with `fitAiStoneBox()` (no `sheetMaxMm`: the canvas it gets is already grown).
  - It adds `previousFillMode` to the redraw record. The value is the previous record's
    `previousFillMode` when that record has one; otherwise `layer.fillMode ?? null`, so `null` means
    "had no fillMode" and survives JSON.

  Without `aiPitchPx`, it behaves exactly as IMG-022 (160 mm, fillMode unchanged). That keeps
  IMG-022 tests T10-T11 valid unchanged.

  `restoreOriginal()` restores `fillMode` only when the record has the `previousFillMode` key:
  `null` deletes it, a string sets it. It leaves `aiStoneShrink` as it is.
- **(b) In `writeSelectedControlsToLayer()`,** when the image layer's mode is `'ai-stones'` after
  the write and, compared with before the write, the mode just became `'ai-stones'`, or
  `aiStoneShrink`, `stoneSize` or `gap` changed. The build records a key of those four values at the
  top of the function, right after `const l=selectedLayer();`, guarded as
  `l.type==='image'?…:null`. It then re-sizes in one new statement placed **after** the Flat Sheet
  block (`:2954-2956`) and before the `project.name=` line (`:2957`). This spot keeps the
  `stoneSize`/`gap` statements (`:2851-2852`, pinned verbatim by test-mono-006a) and the sheet
  block (pinned by test-rs-3037) untouched.

  The re-size uses `fitAiStoneBox()` with the layer's current centre. It grows the sheet as in (a),
  and writes `setLengthField` for `shapeX`/`shapeY`/`shapeW`/`shapeH`. This matters: the image branch
  reads w/h back from those fields on the next write, so leaving them stale silently undoes the
  re-size. It also writes `sheetWidth`/`sheetHeight` when the sheet grew. The re-size is skipped
  when the buffer is not decoded yet or detection is not `ok`.

  A manual resize of the box (2D-canvas handles or Position & size fields) is **not** undone; only
  the effective shrink changes.

**Hint (spec).** `#imgAiStoneShrinkHint` (a `p.hint` inside the new field) is set in
`renderImageStudio()` while the mode is `'ai-stones'`:

- When detection is `ok` and the effective shrink is `< 0.8 − 1e-9`, it reads: "This design is
  smaller than the AI drew it, so fine lines may break."
- When detection is not `ok`: "No AI stones were found in this image. AI stones works on images
  redrawn with AI."
- Otherwise it is hidden.

### D3. Palette

Up to 8 catalogue colours are chosen greedily to minimise the summed colour error over **all** AI
stones (reference `palette()`). Colour distance is weighted Lab:
`sqrt((0.5·ΔL)² + Δa² + Δb²)`.

- Each stone starts with an error of 1e9.
- Each round, every candidate's gain is `Σ (cur − min(cur, D_k))`. Kept candidates get −1. The
  highest gain wins, with ties going to the lowest catalogue index.
- The loop stops early when the best gain is ≤ 0.
- The result is the kept indices, sorted by catalogue index.

The catalogue is `imageColorPalette()` (`app.js:735`). It matches the reference's `CATALOGUE`
exactly: 23 entries, same ids, same order, same hex (checked against `STONE_COLORS`).

AI stones ignores Auto colour count, Vividness and colour overrides. While `'ai-stones'` is
selected, `renderImageStudio()` disables `#imgColorCount`, `#imgVividness` and the eight Colours
rows `#imgColorPick0`-`#imgColorPick7` (F3), all with the title "Not used by AI stones: it picks up
to 8 colours from the stones the AI drew." This sits next to the existing Organic/Edge disabling at
`app.js:6642-6643`, the same idiom. `#imgColorReset` and the Colours canvas view are left as they
are.

### D4. Grid

Real stones sit on the engine's existing staggered grid at pitch `stoneSize + gap`.
`placeAiStones()` calls `sampleStaggeredFillPoints([boxPolygon], boxBounds, pitchMm)`
(`src/geometry/StoneSampler.js:1422`), where `boxPolygon` is the placement rectangle.
`sampleStaggeredFieldFillPoints()` (`:1921`) is not used, because it filters by the prepared field
AI stones does not build.

**Does it match the reference's `hexgrid()`?**

- **Row order: yes.** Rows run top to bottom and points left to right. Even rows are unshifted and
  odd rows are shifted `+pitch/2`. The row spacing is `pitch·√3/2`.
- **Origin: no.** `sampleStaggeredFillPoints()` starts at `(min + pitch/2, min + pitch/2)` and uses
  `<=` bounds. `hexgrid()` starts at `(0, 0)` and uses `<` bounds. So the engine grid is the
  reference grid shifted by `(+pitch/2, +pitch/2)`, and it may have one more point per row or
  column at the far edges.

**Measured effect** (Setup B, reference with the engine grid substituted): on the four images,
real-stone totals change by −0.69 % to +0.18 %, and palettes are identical. On the small synthetic
fixture below, the total changes from 246 to 224 (−9 %), because edge effects dominate a
34 mm design. No engine-grid position coincides with a reference position, so the reference figures
are expected to match closely, not exactly (decision 4). The acceptance protocol accounts for this.

Per grid point, `placeAiStones()` does the following (reference `transfer()`):

1. Map to image pixels with `sx = widthMm / widthPx` and `sy = heightMm / heightPx`. These are equal
   for an unedited box; the reference has one `s`.
2. Keep the point when two tests pass:
   - **On the subject:** `alpha[clamp(trunc(v/sy))][clamp(trunc(u/sx))] > 128`, where `(u, v)` is
     the point relative to the box origin.
   - **Near an AI stone:** its nearest AI stone, in mm (`box origin + (xPx·sx, yPx·sy)`), is closer
     than `0.8 × pitchMm`.
3. Take its 3 nearest AI stones, or all of them when fewer than 3 exist **(spec)**.
4. Weight each with `w = 1 / (d + 0.3)`. The 0.3 is a fixed millimetre constant from the reference,
   not the gap.
5. Colour the point:
   - **Jet:** when `Σ w·jetLike / Σ w ≥ 0.4`, the stone is **Jet** (catalogue id `'jet'`), even when
     the palette does not contain Jet (see F4).
   - **Otherwise:** the weighted mean Lab goes to its nearest palette colour by the D3 distance,
     with ties going to the lower catalogue index.

A stone is jet-like when `L* < 30` and `hypot(a*, b*) < 15`.

### D5. Every other mode is unchanged

Existing projects stay byte-identical:

- A missing `aiStoneShrink` reads as 1.0.
- No key is added to layers that do not use the mode (D2's guarded write).
- `validateProject()` needs no new line: its layer spread (`app.js:1342`) keeps the field. That also
  keeps the 17 `new Function()` harnesses around `validateProject()` untouched.
- For every other mode, the only change to engine input is `aiStoneDetection: null` in the params,
  which the engine ignores outside `'ai-stones'`. Generated stones are identical.

### D6. Prompt

`server/redraw/prompt.mjs` becomes `PROMPT_VERSION = 2`. The palette line is still generated from
`STONE_COLORS` by the unchanged `buildPaletteLine()`. `PROMPT_LINES` becomes exactly these lines,
verbatim, in this order:

```
You are a professional designer of hot-fix rhinestone transfer templates. Design a rhinestone version of the attached image that a machine can set stone by stone.
Use identical round stones in honeycomb rows, about 70 stones across. Every stone is one flat colour from the palette below, drawn as a glossy round stone with a small white highlight dot.
Design choices a good template designer makes:
- Simplify: fewer, larger colour areas; drop texture and fine shading that stones cannot show.
- Keep what makes the subject recognisable, and exaggerate it slightly if needed.
- Separate colour areas and outline the subject with one-stone-wide chains of Jet stones, with no gaps.
- Use at most 8 palette colours, with strong contrast between neighbouring areas.
Square image, subject fills the frame, transparent background, no shadow or glow, no text.
Palette (name and hex):
```

The default model stays `gpt-image-2`; it already is (`server/redraw/env.mjs:6`). The default
quality changes from `medium` to `high`, in three places:

- `REDRAW_ENV_DEFAULTS.OPENAI_IMAGE_QUALITY` at `env.mjs:7`;
- `.env.example:11`;
- the IMG-022 settings table (`docs/specifications/IMG-022-RedrawProvider.md:176`), with a
  note "changed by IMG-023".

### D7. Refusals

**Server (`server/redraw/handler.mjs`).**

- A safety rejection is an OpenAI 4xx response whose `error.message` contains "safety system".
  **(spec)** The match is case-insensitive.
- A safety rejection is retried once. It shares the existing 2-attempt budget of the loop at
  `handler.mjs:117-126` **(spec)**, so there are at most two paid calls. For example, a 500
  followed by a safety rejection gives `declined` without a third call.
- If the last attempt is a safety rejection, the handler returns HTTP **422** with
  `{ code: 'declined', message: <OpenAI's message> }`.
- **Logging.** `createRedrawHandler()` takes a new `logger` option (default `console`). For every
  OpenAI response with `400 ≤ status < 500`, on every attempt, it calls
  `logger.warn(\`Redraw: OpenAI returned ${status}: ${message}\`)`. `message` is `error.message`,
  or `''` when there is none. The log never includes the API key, the access code, the upload or any
  request header.
- **Client codes.** `'declined'` joins `REDRAW_ERROR_CODES` (`src/redraw/index.js:22`) and
  `KNOWN_FAILURE_CODES` (`src/redraw/OpenAiProxyProvider.js:14`). `redrawImage()` does not retry
  it; only `invalid-output` is retried there (`index.js:160`).

**UI (spec).** `app.js` must not contain the string "OpenAI" (IMG-022 T12). So the message is built
from the provider's `consent.recipientName`, the same way IMG-022 builds its consent text:

```
`${recipient} declined to redraw this image. This often happens with well-known cartoon characters or brands. Try again or use a different image; your design is unchanged.`
```

`recipient` is `redrawAvailability.consent.recipientName`, falling back to "The redraw service". With
the OpenAI proxy provider, this renders exactly as decided: "OpenAI declined to redraw this image. …".

A new `<p class="hint" id="imageRedrawStatusDetail">` below `#imageRedrawStatus` holds the
secondary line. It shows `Details: <id>` when `error.detail` matches `/\breq_[A-Za-z0-9]+/` and is
empty otherwise. Every `setImageRedrawStatus()` call clears it.

### D8. AI image view

When the selected layer has `layer.redraw`, the Studio view row (`index.html:1241-1246`) shows a new
radio, **AI image** (`value="ai"`), placed right after Source. It draws `layer.imageSrc`. **Source**
then draws `layer.redraw.originalImageSrc`. Without `layer.redraw`, nothing changes: the radio is
hidden and Source draws `layer.imageSrc`. If the hidden `ai` radio is still checked, it draws like
Source **(spec)**. **Overlay** keeps drawing `layer.imageSrc`, the image the stones come from
**(spec)**.

- **Markup.** `<label id="imageStudioViewAi" hidden><input type="radio" name="imageStudioView" value="ai">AI image</label>`.
- **CSS trap.** `.view-toggle label{display:flex}` (`index.html:292`) defeats `[hidden]`, the same
  trap as IMG-022's buttons (`:286-288`). So add `.view-toggle label[hidden]{display:none}`.
- **Visibility** is set in `renderImageStudio()` from `Boolean(l.redraw)`.

**Aspect (spec).** The original usually has a different aspect than the square AI image in the
layer's box. Source draws it contained, preserving its aspect and centred in the box, rather than
stretched. This goes through a module-level helper outside `renderImageStudio()`. The helper returns
a letterboxed canvas and names its 2D context anything but `ctx`.

**IMG-022 test constraints** still hold ("Existing tests" below):

- `ctx.drawImage(` count stays 2 and `drawInBox(` stays 3 inside `renderImageStudio()`. The new
  branch reuses `drawSource`/`paintSource`, and `drawSource` gains a `src` parameter defaulting to
  `l.imageSrc`.
- The `#imgColorCountAuto` marker and the `imageStudioSwitchToSheet` line stay verbatim.
- `generateImageStonesLive(l,{includeStats:true})` and `el('imageStudioStatCheckFix')` stay.

## Port contract (JS in place of OpenCV, scipy and scikit-image)

The reference's docstring writes "L\* > 150" and "top-hat > 40". Both are on OpenCV's **8-bit L
scale** (L8 = L\* × 255/100), not on L\*. Every constant below keeps the reference's own scale.

**Constants** (exported as `AI_STONE_*` from `AiStoneDetect.js`, or for the placement ones from
`AiStoneSampler.js`):

| Group | Value |
|---|---|
| Top-hat kernel | 9 × 9 ellipse |
| Highlight test | top-hat > 40 (L8), S8 < 110, L8 > 150, alpha > 128 |
| Blob area | 1-60 px |
| Merge radius | 0.55 × pitch |
| Pitch floor | 0.6 × rough |
| Neighbours for pitch | 2nd-6th (k = 7 including self) |
| Dot → centre offset | (0.30, 0.35) × pitch / 2 |
| Black-hat kernel | max(5, trunc(0.6 × pitch) \| 1) |
| Gap blur | 3 × 3, σ 0.7 |
| Gap percentile | 75 |
| Distance blur | σ 1.0 (9 × 9) |
| Peak spacing | m = max(3, trunc(0.45 × pitch)) |
| Peak floor | 0.2 × pitch |
| Dot-less keep radius | 0.7 × pitch |
| Colour disc radius | 0.33 × pitch |
| Colour L-percentiles | 15, 60 |
| Jet-like | L\* < 30, chroma < 15 |
| Palette cap | 8 |
| Lab weights | 0.5, 1, 1 |
| Keep radius | 0.8 × pitchMm |
| Neighbours for colour | 3 |
| Weight offset | 0.3 mm |
| Jet share | 0.4 |

**Operation replacements.**

| Reference | JS replacement |
|---|---|
| `cv2.cvtColor(RGB2LAB)[...,0]` (8-bit L) | `L8 = Math.round(L* × 255 / 100)`, with `L*` from `ColorSpace.rgbToLab()` (the same formula as the reference's `rgb2lab()`). Measured against OpenCV on the four images: at most 1 level different, on 19-24 % of pixels. |
| `cv2.cvtColor(RGB2HSV)[...,1]` | `S8 = max === 0 ? 0 : Math.round(255 × (max − min) / max)` on the RGB bytes. Measured: at most 1 level different. |
| `getStructuringElement(MORPH_ELLIPSE, (k,k))` | Literal masks. k = 9 (57 cells): rows `000010000 011111110 011111110 111111111 111111111 111111111 011111110 011111110 000010000`. k = 7 (33): `0001000 0111110 1111111 1111111 1111111 0111110 0001000`. k = 5 (17): `00100 11111 11111 11111 00100`. For any other k, OpenCV's rule: `r = c = trunc(k/2)`; row `i` spans `c ± round(c·sqrt((r² − (i−r)²)/r²))`. The four images use k = 5 and 7, the fixture k = 9. |
| `morphologyEx(TOPHAT / BLACKHAT)` | Grey erosion (min) and dilation (max) over the mask, ignoring out-of-image pixels (OpenCV's default border). Top-hat = `L8 − dilate(erode(L8))`; black-hat = `erode(dilate(L8)) − L8`, in floating point. The ellipse can be done as one 1-D min/max per mask row; that is a speed choice, not a behaviour change. |
| `GaussianBlur((3,3), 0.7)`, `GaussianBlur((0,0), 1.0)` | Separable Gaussian with sizes 3 and 9 (OpenCV's size for a float image is `round(8σ + 1) \| 1`). Weights are `exp(−i²/2σ²)`, normalised. Border is reflect-101 (`dcb\|abcd\|cba`). |
| `connectedComponentsWithStats(connectivity=8)` | 8-connected flood fill in raster order. Area is the pixel count; the centroid is the mean pixel x and mean pixel y (0-based column and row indices). `LineDesignSampler.js` has a private `labelComponents8()`; it is not exported, so write a local one. |
| `cKDTree.query(k)` / `query_ball_point(r)` | Brute force or a uniform-grid hash. Euclidean distance; a ball includes `d ≤ r`. |
| `np.percentile` (default) | Sort, `h = (n − 1)·q/100`, linear interpolation. |
| `np.median` | Middle value, or the mean of the two middle values. |
| `np.argsort(−area)` (merge order) | Stable sort: area descending, then component order. NumPy's default sort is not stable, so ties in area (common: dots are 6-9 px) may be ordered differently there. This is a known small source of difference. |
| Python `round()` (disc radius `rr`) | Round half to even. |
| `int()` on non-negative floats | `Math.trunc`. |
| `distanceTransform(L2, 5)`, `peak_local_max` | See "Stones without a dot" below. |

**Step by step** (reference `highlights()`, `detect()`, `stone_lab()`).

1. **Highlights.** A pixel is a spot when all four hold: top-hat > 40, S8 < 110, L8 > 150,
   alpha > 128. Label the spots 8-connected and keep blobs of 1-60 px as `(cx, cy, area)`.
2. **Pitch.** For each blob centroid, find the distances to its 7 nearest centroids, including
   itself at 0.
   - `rough` = the median of all 2nd-6th distances, pooled over every centroid.
   - `pitch` = the median of the 1st-neighbour distances, over the centroids whose 1st-neighbour
     distance is `> 0.6 × rough`.
   - This uses the unmerged blobs. With fewer than 7 blobs, return `ok: false`.
3. **Merge.** Walk the blobs in the D-table merge order. For each blob not yet taken:
   - its group is every untaken blob within `0.55 × pitch` of it, itself included;
   - mark the group taken;
   - emit the group's area-weighted mean centroid.
4. **Dot to centre.** Stone centre = merged dot + `(0.30 × pitch/2, 0.35 × pitch/2)`. The dot sits
   up-left of the centre.
5. **Stones without a dot** (below). These are appended after the dot stones.
6. **Per-stone colour.**
   - `rr = max(2, roundHalfEven(0.33 × pitch))`.
   - Window: columns `max(0, trunc(x) − rr)` up to but not including `min(w, trunc(x) + rr + 1)`,
     and the same for rows.
   - Use pixels with `(xx − x)² + (yy − y)² ≤ rr²` and alpha > 128.
   - With fewer than 3 pixels the colour is Lab `(0, 0, 0)`. The reference does this, and such a
     stone counts as jet-like; keep it.
   - Otherwise compute the pixels' Lab, then `lo` and `hi` = the 15th and 60th percentiles of L\*.
     Select `lo ≤ L* ≤ hi`, using the selection when it has at least 3 pixels and all pixels
     otherwise. Take the per-channel median.

**Stones without a dot** (its own step, because a plain-JS port will differ most here).

The AI does not draw a visible highlight on every stone: dots are missing, merged into a bright
colour, or too big. Without this step those stones become holes in the transfer. The step must find
one extra stone at the middle of every stone-shaped patch of the subject that has no dot-derived
stone nearby, and none anywhere else. It works like this:

1. **Separate stones from the gaps between them.** The gaps are the thin dark lines between stones.
   Measure how much darker each pixel is than its surroundings: the black-hat of L8 with an
   elliptical kernel of the constant size above, lightly smoothed (3 × 3, σ 0.7). Within the subject
   (alpha > 128), the pixels in the top quarter of that darkness are gap. The threshold is the 75th
   percentile over subject pixels, and a pixel equal to it is not gap. Every other subject pixel is
   **stone body**.
2. **Find the middle of each body patch.** For every body pixel, measure the distance to the nearest
   non-body pixel, and smooth the result with a Gaussian (σ 1.0). OpenCV uses a 5 × 5 chamfer
   approximation of Euclidean distance. The port may use an exact Euclidean distance transform
   instead. The image edge is not a boundary: only non-body pixels inside the image count.
3. **Pick one peak per patch.**
   - A candidate is a subject pixel whose smoothed distance equals the maximum over the
     `(2m + 1) × (2m + 1)` square around it, and is strictly greater than `0.2 × pitch`. Non-subject
     pixels count as −∞ in that maximum; beyond the image edge, use the nearest pixel.
   - Every pixel of a flat top is a candidate.
   - Sort the candidates by value, descending, with ties in raster order.
   - Walk that list and keep a candidate unless an already-kept one is closer than `m` in Chebyshev
     distance (`max(|dx|, |dy|) < m`). Only kept candidates suppress others.
4. **Keep only real gaps in the dot coverage.** A kept peak, at its integer (column, row), becomes a
   stone only when every dot-derived stone centre is more than `0.7 × pitch` away. Peaks are not
   compared with each other again.

The measurable requirement is on the synthetic fixture (T1):

- every one of the 12 dot-less discs gets exactly one stone within 1.0 px of its drawn centre. The
  reference is within 0.005 px.
- no other extra stones appear: 224 in total.

## Acceptance bands for the JS build, against the reference on the four images

The four images are not committed, so this check is a build-step script in `tools/scratch/img-023/`
(never committed). Its figures go in the build report. Each run uses shrink 1.0 and 0.8, SS6, and
gap 0.3.

- **End to end.** The layer box is the whole image at `fitAiStoneBox()` size on a canvas large
  enough that nothing is fitted (e.g. 1000 × 1000 mm). Run `engine.generateImageLayout({ mode:
  'ai-stones', … })`.
  - **AI pitch** within **1 %** of the pinned value.
  - **Width and height** within **1 %**. These are measured as the reference measures them: the
    alpha > 128 bounding box in pixels, times `mmPerPx`.
  - **Real-stone count** within **1 %**.
  - **Palette identical.**
  - **AI-stone count** within **3 %**.
- **Colour.** Call `placeAiStones()` with `points` set to the reference's own stone positions (from
  `<name>-100.json` / `<name>-80.json`) and the reference's scale
  (`mmPerPx = 2.3 / (pinnedPitch / shrink)`, box = the whole image). **At least 95 %** (F2) of the
  reference's stones must get the reference's colour at the same position. A reference stone that
  the JS keep-rule drops counts as a mismatch.

  Two things make this protocol necessary rather than a literal end-to-end comparison:
  - the engine grid shares no position with the reference grid (D4);
  - a pitch change of 0.2 % alone moves colours at fixed positions by up to 10 %, as measured above.

  With the scale held at the pinned pitch, the measured floor for a port that differs only in
  8-bit L\* rounding is 97.66 % (tiger 1.0). The band is 95 % to leave room for the port's other
  differences (F2).

## Anchors

Re-grepped on `eea2b8f`.

| Anchor | Where |
|---|---|
| `IMAGE_FILL_MODES` (includes `'line-design'`) | `app.js:667`; `resolveImageFillMode()` `:696` |
| `imageColorPalette()` | `app.js:735` |
| `lineDesignStoneCache` / `invalidateLineDesignCache()` | `app.js:854` / `:874-877` |
| `generateImageStonesLive()` | `app.js:1147`; `'line-design'` branch `:1151-1169`; ordinary `const params={…}` `:1170` |
| `imageBufferCache` | `app.js:231` |
| `validateProject()` layer spread | `app.js:1342` |
| Import lines (image barrel / products barrel / redraw) | `app.js:102` / `:101` / `:140` |
| `syncSelectedControlsFromLayer()` / `#imageFillMode` sync / sheet fields sync | `app.js:2611` / `:2654` / `:2704` |
| `writeSelectedControlsToLayer()` | `app.js:2752`; image branch `:2817`; colorCount `:2827`; vividness `:2830`; stoneSize/gap `:2851-2852`; sheet block `:2954-2956`; `project.name=` line `:2957` |
| `HISTORY_TRACKED_CONTROL_IDS` | `app.js:5087` |
| `REDRAW_ERROR_MESSAGES` / `setImageRedrawStatus()` / `redrawErrorMessage()` / `syncImageRedrawControls()` | `app.js:5572` / `:5580` / `:5581` / `:5586` |
| `startImageRedraw()` / its `applyRedraw(` call | `app.js:5615` / `:5634` |
| `renderImageStudio()` | `app.js:6608`; `isPoisson` `:6638`; disabling loop `:6642`; `drawSource` `:6669`; view dispatch `:6722-6739` |
| `IMAGE_SAMPLE_MODES` | `src/geometry/GeometryEngine.js:71` |
| `generateImageLayout()` | `GeometryEngine.js:1200`; `isLineDesign` `:1246`; `generateLineDesignStonePoints(` call `:1285`; mixed `:1341`; fill-gaps `:1370`; `normalizeImageParams()` `:2489`; `'../image/index.js'` import `:32`; `LineDesignSampler.js` import `:55` |
| `generateLineDesignStonePoints()` (precedent) | `src/geometry/LineDesignSampler.js:670`; its `src/image` imports `:25-28` |
| `sampleStaggeredFillPoints()` / `sampleStaggeredFieldFillPoints()` | `src/geometry/StoneSampler.js:1422` / `:1921` |
| `rgbToLab()` | `src/image/ColorSpace.js:36` |
| `applyRedraw()` / `restoreOriginal()` / restated clamp / `REDRAW_LONG_SIDE_MM = 160` | `src/redraw/RedrawLayerTransform.js:28` / `:87` / `:57-58` / `:7` |
| `REDRAW_ERROR_CODES` / client retry | `src/redraw/index.js:22` / `:159-160` |
| `KNOWN_FAILURE_CODES` | `src/redraw/OpenAiProxyProvider.js:14` |
| `PROMPT_VERSION = 1` / `PROMPT_LINES` / `buildPaletteLine()` | `server/redraw/prompt.mjs:7` / `:9-18` / `:22` |
| `createRedrawHandler()` / retry loop / status mapping | `server/redraw/handler.mjs:62` / `:117-126` / `:134-137` |
| Quality default | `server/redraw/env.mjs:7`; `.env.example:11`; IMG-022 spec table `:176` |
| Flat Sheet size = `project.canvas`; `SHEET_MAX_MM = 500` | `app.js:2951-2956`; `src/products/SheetProductDefinition.js:14`; barrel `src/products/index.js:39` |
| Studio view row / Fill style / colour count / vividness | `index.html:1241-1246` / `:1191` / `:1204` / `:1205` |
| `.view-toggle label{display:flex}` / IMG-022 `[hidden]` override | `index.html:292` / `:286-288` |

## Tests the build must add

New file `tools/test-img-023-ai-stone-transfer.mjs`, registered in the `geometry` group of
`tools/test-groups.mjs` (next to `test-img-021-rotated-image-stones.mjs`, `:219`). It uses the
repo's plain-Node pattern. Tests never touch the network or `tools/scratch/`.

### Synthetic detection fixture (drawn in the test)

The image is 256 × 248 RGBA, fully transparent `(0,0,0,0)` to start.

- **Constants.** `P = 16` and `ROWH = P*Math.sqrt(3)/2`. The margin `M = 20`.
- **Stones.** 16 rows (`r = 0..15`) × 14 columns (`c = 0..13`) of stones, 224 in total, in
  row-major order.
  - Centre: `cx = M + c*P + (r % 2 === 1 ? P/2 : 0)`, `cy = M + r*ROWH`.
  - Colour: stones on the border (`r` 0 or 15, `c` 0 or 13) are Jet `#141414`. Inside, `c < 7` is
    Sapphire `#2269d3` and the rest Gold `#f3bd32`.
  - Highlight dot centre: `(cx - 0.30*P/2, cy - 0.35*P/2)`, written exactly in that operation
    order.
  - Row 7's interior stones (`c` 1-12) have **no dot**.
- **Pixels.** For each pixel with integer `(x, y)`:
  1. Find the stone with the smallest `(x-cx)*(x-cx)+(y-cy)*(y-cy)`, taking the first one on ties.
  2. If that distance² is > 92, the pixel stays transparent.
  3. Otherwise it gets the stone's colour when distance² ≤ 45, and the gap colour `(8,8,8)`
     otherwise.
  4. If the stone has a dot and `(x-hx)*(x-hx)+(y-hy)*(y-hy) ≤ 2.25`, the pixel is white.
  5. Alpha is 255.
- **Pinned.**
  - SHA-256 of the RGBA bytes: `06827c645e6d454c29843a35607f07500435986111e216879fd38bfa65b18253`.
  - 51014 opaque pixels, 1442 white.
  - Reference (Setup B): 212 highlight blobs, 224 stones, pitch 16.000 (15.999999999999993), every
    centre within 0.401 px of its drawn centre, and the dot-less ones within 0.005 px.

### Reference output on the fixture (pinned literals)

SS6, gap 0.3 mm, from the reference script (Setup B). Shrink 1.0: `ai_stones` 224, `ai_pitch_px`
16.0, `mm_per_px` 0.14375, width × height 33.6 × 32.5 mm, total 246, palette `jet, sapphire, gold`,
Jet 92 / Sapphire 77 / Gold 77. Shrink 0.8: `mm_per_px` 0.115, 26.9 × 26.0 mm, total 148, Gold 52 /
Sapphire 50 / Jet 46.

**Reference grid.** This is the reference `hexgrid()`, pinned so the test does not depend on
floating-point edge rounding. With `s = 2.3 / (16 / shrink)`:

- Point `(j, k)` is at `x = k·2.3 + (j odd ? 1.15 : 0)` and `y = j·2.3·√3/2` (mm).
- Shrink 1.0: `j = 0..17`, `k = 0..15`.
- Shrink 0.8: `j = 0..14`, `k = 0..12`.

One character per point, in row order: `.` means not kept, `J` Jet, `S` Sapphire, `G` Gold.
Rerunning the reference with the pitch forced to exactly 16 gives the same strings.

Shrink 1.0 (rows `j = 0..17`):

```
................
.JJJJJJJJJJJJJJ.
.JJSSSSSJGGGGGJJ
.JSSSSSSGGGGGGJ.
.JJSSSSSJGGGGGJJ
.JSSSSSSGGGGGGJ.
.JJSSSSSJGGGGGJJ
.JSSSSSSGGGGGGJ.
.JJSSSSSJGGGGGJJ
.JSSSSSSGGGGGGJ.
.JJSSSSSJGGGGGJJ
.JSSSSSSGGGGGGJ.
.JJSSSSSJGGGGGJJ
.JSSSSSSGGGGGGJ.
.JJSSSSSJGGGGGJJ
.JSSSSSSGGGGGGJ.
.JJJJJJJJJJJJJJJ
.JJJJJJJJJJJJJJ.
```

Shrink 0.8 (rows `j = 0..14`):

```
.............
.JJJJJJJJJJJ.
.JSSSSSGGGGGJ
.JSSSSGGGGGJ.
.JSSSSSGGGGGJ
.JSSSSJGGGGJ.
.JSSSSSGGGGG.
.JSSSSJGGGGJ.
.JSSSSSGGGGGJ
.JSSSSJGGGGJ.
.JSSSSSGGGGGJ
.JSSSSGGGGGJ.
.JSSSSSGGGGGJ
.JJJJJJJJJJJ.
.............
```

The `J` where Sapphire meets Gold inside the design is the reference's own behaviour. Blue and
yellow blend to a grey whose nearest palette entry is Jet.

### Palette fixture (no image)

A list of 812 AI-stone Labs, each exactly `rgbToLab()` of a catalogue hex: 100 each of crystal-clear,
crystal, silver, gold, citrine, sapphire, light-sapphire and jet, plus **12 siam** (1.48 %).

- The greedy pick returns `crystal-clear, jet, siam, sapphire, light-sapphire, citrine, gold,
  silver`, dropping crystal. Siam wins its round with a gain of 742.74, against 613.52 for
  light-siam.
- A frequency pick (top 8 by nearest-catalogue count, computed in the test for contrast) returns the
  8 large groups and drops siam.
- With 8 siam instead of 12, greedy drops it too. So the fixture sits clear of that edge, not on it.

### Tests

- **T1. Detection.** `detectAiStones(fixture)`:
  - `ok`, exactly **224** stones;
  - `pitchPx` within **2 %** of 16;
  - a one-to-one match of every drawn centre within 1.0 px;
  - each of the 12 dot-less discs matched by a stone with `fromDot: false`;
  - `dotCount` 212.

  A 6-blob image returns `ok: false, reason: 'too-few-highlights'`.
- **T2. Palette.** `chooseAiStonePalette()` on the palette fixture gives exactly the list above, and
  the frequency pick does not contain siam.
- **T3. Jet rule.** Use hand-built detections with 3 equidistant AI stones around one point:
  - 2 jet-like of 3 → Jet, even with a palette of `sapphire, gold` only;
  - 1 of 3 → not Jet.
  - Jet-likeness at the boundaries: `L* 29.9, chroma 14.9` is jet-like; `L* 30` and `chroma 15` are
    not.
- **T4. Scale and shrink.** `fitAiStoneBox()` on 1024 px with pitch 11.467, SS6/0.3 and a large
  canvas gives `w = 1024 × 2.3 / 11.467` (205.39 mm) at shrink 1, and × 0.8 at 0.8. Also
  `resolveAiStoneShrink()`, extracted from app.js by marker and run:
  `1 → 1`, `0.9 → 0.9`, `0.8 → 0.8`, and `0.7`, `'0.9'`, `undefined`, `NaN` → 1.
- **T5. Canvas and Flat Sheet sizing** (w0 = 205.39):
  - canvas 300 × 250: unchanged size;
  - 200 × 200: fitted to 180, effective shrink 0.876, no hint;
  - 150 × 150: fitted to 130, effective shrink 0.633, hint (`< 0.8`).
  - Flat Sheet 150 × 150, `sheetMaxMm` 500: the canvas grows to 226 × 226 and the design is
    unshrunk.
  - Pitch 4 px (w0 = 588.8): the sheet stops at 500 × 500 and the design fits to 480.
  - The box keeps its centre, shifted inside, as in IMG-022 T10b.
- **T6. Byte identity.**
  - A project with an image layer and no new fields round-trips through the extracted
    `validateProject()` byte-identically.
  - The extracted `aiStoneShrink` write statement adds no key to a `'staggered'` layer and writes one
    for an `'ai-stones'` layer.
  - `generateImageLayout()` with and without `aiStoneDetection: null` gives identical stones for a
    staggered layer.
- **T7. Engine.** `generateImageLayout({ mode: 'ai-stones', … })` on the fixture:
  - `sourceMode` `'ai-stones'`;
  - every stone `sizeMm === stoneSizeMm`;
  - colours ⊆ palette ∪ {jet};
  - `sizeMode: 'brightness'`, `mixedOptions` and `fillGaps: true` change nothing;
  - `rotationDeg: 30` rotates (IMG-021);
  - a passed `aiStoneDetection` is used; a spy shows no second detection.
- **T8. Tolerance against the reference** (fixture). JS `detectAiStones` plus
  `chooseAiStonePalette`, then `placeAiStones` with `points` = the pinned reference grid and
  `mmPerPx = 2.3/(16/shrink)`:
  - the kept set matches the pinned strings to within 1 % (at most 2 of 246 and 1 of 148);
  - at least 95 % of the reference's kept stones get its colour (F2);
  - palette identical; pitch within 1 % of 16.0; AI stones 224.
- **T9. AI image view and wiring** (source-level):
  - `index.html` has `value="ai"` inside `#imageStudioViewAi` (with `hidden`), the
    `.view-toggle label[hidden]` rule, the `ai-stones` Fill style option, `#imgAiStoneShrink`
    (options 1, 0.9, 0.8), `#imgAiStoneShrinkHint` and `#imageRedrawStatusDetail`.
  - Inside `renderImageStudio()`, `ctx.drawImage(` is still 2 and `drawInBox(` still 3.
  - `renderImageStudio()` disables `imgColorCount`, `imgVividness` and `imgColorPick0`-`7` for
    `'ai-stones'` with one shared title (D3, F3).
  - `HISTORY_TRACKED_CONTROL_IDS` includes `'imgAiStoneShrink'`.
  - `detectAiStones` is imported from `./src/image/index.js` and `SHEET_MAX_MM` from the products
    barrel.

These tests go into the existing `tools/test-img-022-redraw-provider.mjs`, updated in place:

- **T1 updated.** `PROMPT_VERSION === 2` and the D6 lines verbatim; the palette-line assertion is
  unchanged.
- **T6 updated.** The 400 safety-system case now expects 422 `declined` with OpenAI's message and
  **2** calls. Add cases:
  - safety then 200 → 200 with 2 calls;
  - 500 then safety → 422 `declined` with 2 calls;
  - a message with "Safety System" in other capitals counts as declined.
- **New T6b. 4xx logging.** An injected recording logger gets exactly one
  `Redraw: OpenAI returned 400: <message>` per 4xx attempt, and one for 401, 403 and 429. No log
  line contains `sk-test` or `letmein`. 200 and 5xx responses produce no line. Existing handler
  tests that hit OpenAI 4xx pass a silent logger so the suite output stays clean.
- **New T8c. Client.** The proxy provider maps a 422 `{code:'declined'}` to
  `RedrawError('declined')` with the detail kept. `redrawImage()` calls the provider once (no
  retry). The extracted `redrawErrorMessage()`, run with recipient `'OpenAI'` and a detail containing
  `req_abc123`, gives the D7 text exactly and the details line `Details: req_abc123`.
- **T5 and T7 updated.** The default quality is `'high'`.
- **New T10d.** `applyRedraw()` with `aiPitchPx: 11.467` on a 1024² result:
  - `fillMode` becomes `'ai-stones'`, w/h are 205.39 on a large canvas, and fitted on a small one;
  - the record gains `previousFillMode: 'staggered'`;
  - `restoreOriginal()` gives the exact original layer back;
  - a layer with no `fillMode` records `null` and restores without a `fillMode` key, including
    after a JSON round trip;
  - a second redraw keeps the first `previousFillMode`.

  T10-T11 stay as they are (no `aiPitchPx` means IMG-022 behaviour).

## Existing tests that grep the text this build changes

For each place the build changes, these are the existing tests that match that text, including
regex-escaped forms. The build prompt should carry this list.

**`IMAGE_FILL_MODES` (`app.js:667`) and `resolveImageFillMode()` (`:696`).**
`test-fill-algorithms-integration.mjs:138` matches
`/function resolveImageFillMode\(value\)\{return IMAGE_FILL_MODES\.has\(value\)\?value:'fill'\}/`,
which must stay verbatim. `test-img-011-import-defaults.mjs:131-143` extracts `resolveImageFillMode`
and injects `IMAGE_FILL_MODES`. Only the `Set` contents change, so neither is affected.
`resolveAiStoneShrink()` goes on its own line after `:696`.

**`generateImageStonesLive()` (`app.js:1147-1170`).**

These extract the method and run it through `new Function()` with a fixed dependency list:
- `test-img-010-line-design.mjs:530-611` and `:661-762`;
- `test-img-013-fill-empty-slots.mjs:345-427`;
- `test-img-021-rotated-image-stones.mjs:110-160`.

They pass with the D1 ternary, because `aiStoneDetectionFor` is never evaluated for their modes.
Do not add an unguarded free identifier.

These pin exact text, which must survive:
- `test-img-017-vividness.mjs:182-187`: exactly **2** matches of `/const params=\{[^;]*\};/`, both
  containing `vividness:resolveImageVividness(layer.vividness)`, and the first
  `/const key=\[layer\.id,[^\]]*\]\.join/`.
- `test-img-018-whole-image-mask.mjs:176-183`: the Line Design branch slice from
  `"if(mode==='line-design'){"`.
- `test-img-021-rotated-image-stones.mjs:231`: `/const key=\[layer\.id,[^\]]*\]\.join\('\|'\);/`.
  So nothing new may contain `const key=[layer.id,`.
- `test-img-009-subject-mask.mjs:270-296`: exactly **5** occurrences of
  `maskMode:resolveImageMaskMode(layer.maskMode)` in app.js. So the new field must not repeat it.
- `test-fill-algorithms-integration.mjs:111-116`:
  - `/const mode=resolveImageFillMode\(layer\.fillMode\);/`;
  - `/gapMm:layer\.gap,mode,color:layer\.color,colorMap:layer\.colorMap\?\?\{\},palette:imageColorPalette\(\)/`;
  - `/gapMm:layer\.gap,mode,color:layer\.color,threshold:layer\.threshold/`.
- `test-image-trace-regression.mjs:50-52`:
  - `/async generateImageStonesLive\s*\(/`;
  - `/this\.permanentEngine\.generateImageLayout\(params\)/`;
  - the `generate()` dispatch regex.
- `test-img-005-check-and-fix.mjs:334-336`: the method must still include
  `checkFixStats:result.checkFixStats`.
- `test-img-004-edge-awareness.mjs:413-423`: the params must still include each Edge key.
- `test-img-006-brightness-sizes.mjs:310-312`: the params must still include
  `...mixedSizeParamsFor(layer)` and `brightnessThinning:`. The new field goes **before** the spread.
- `test-img-013-fill-empty-slots.mjs:427`: `fillGaps:Boolean(layer.fillGaps)`.
- `test-img-011-import-defaults.mjs:143`: `/colorCount:resolveImageColorCount\(layer\)/`.

Stub or name only: `test-mono-006b-stale-authored-scale-initial-load-recovery.mjs:342` and
`test-rs-3039-large-layout.mjs:206`.

**`writeSelectedControlsToLayer()` (`app.js:2752-2957`).** These must stay verbatim, which is why the
new lines go where D2 puts them:

- `test-mono-006a-authored-scale-regression.mjs:125-137` extracts the `stoneSize` and `gap`
  statements verbatim and runs them.
- `test-txt-103-text-sizing-consistency.mjs:103` matches `/const nextGap=readLengthField\('gap'\)\|\|\.3;/`.
- `test-rs-3037-flat-sheet.mjs:183-186` matches the sheet block:
  `/if\(currentObjectTemplate\(\)\.id==='sheet'\)\{\s*project\.canvas=\{width:clampSheetDimensionMm\(readLengthField\('sheetWidth'\)\),height:clampSheetDimensionMm\(readLengthField\('sheetHeight'\)\)\};\s*\}/`.
- `test-ux-visual-polish.mjs:83` matches the zoom clamp on the `:2957` line.
- `test-fill-algorithms-integration.mjs:149-157` matches
  `/l\.maxHeightPx=Math\.max\(8,parseIntOr\(el\('imgMaxHeight'\)\.value,DEFAULT_IMAGE_MAX_DIMENSION_PX\)\);l\.fillMode=resolveImageFillMode\(el\('imageFillMode'\)\.value\)/`.
  So nothing may be inserted between those two statements.
- `test-img-012-auto-colour-count.mjs:296-297` pins the colorCount statement verbatim.
- `test-img-017-vividness.mjs:199` pins
  `l.vividness=resolveImageVividness(Number(el('imgVividness').value));` verbatim. The new shrink
  write goes after it, not inside it.

These only check structure:
- `test-product-plate-round-dinner.mjs:494-540` extracts through `\n// S-107` and regex-checks the
  Rim Band logic;
- `test-s200-app-integration.mjs:93`;
- `test-path-boolean-integration.mjs:175`;
- `test-txt-103-text-sizing-consistency.mjs:42`;
- `test-rs2012-text-gap-mixed-size-ux.mjs:132` (slice between `function syncSelectedControlsFromLayer`
  and `function writeSelectedControlsToLayer`, unaffected).

Stubs only: `test-autosave-recovery-wiring.mjs:184-239` and `test-rs-3039-large-layout.mjs:272-286`.

**`HISTORY_TRACKED_CONTROL_IDS` (`app.js:5087`).** Append `'imgAiStoneShrink'` as a single-quoted id.

- `test-crystal-color-integration.mjs:92-94` parses the list with `JSON.parse` after swapping
  quotes.
- Other regexes over the list: `test-alignment-snapping-wiring.mjs:167`,
  `test-fill-algorithms-integration.mjs:160`, `test-img-006-brightness-sizes.mjs:314`,
  `test-img-009-subject-mask.mjs:300-304`, `test-img-017-vividness.mjs:195`,
  `test-product-vessel-dimensions.mjs:268`, `test-product-plate-round-dinner.mjs:356`,
  `test-s200-app-integration.mjs:104`, `test-variable-stone-sizes.mjs:233`, and
  `test-production-sheet-exporter.mjs:404` (excluded ids).
- Listener-order checks: `test-auto-fit-default-toggle-warning.mjs:165`,
  `test-font-decision-001-stone-size-ux.mjs:243-247` and
  `test-rs2012-text-gap-mixed-size-ux.mjs:146-152`.

All tolerate an appended id.

**`renderImageStudio()` (`app.js:6608`).**
- `test-img-021-rotated-image-stones.mjs:295-299`: `ctx\.drawImage\(` must stay 2 and `drawInBox\(`
  must stay 3. So the letterbox helper lives outside the function, and its context is not named
  `ctx`.
- `test-img-005-check-and-fix.mjs:338-340`: two substrings.
- `test-img-012-auto-colour-count.mjs:373-374` and `test-img-015-direct-catalogue-colour.mjs:161-167`:
  the `#imgColorCountAuto` hint text, verbatim.
- `test-rs-3037-flat-sheet.mjs:454`: `imageStudioSwitchToSheet`, verbatim.

Stubs or tail order only: `test-autosave-recovery-wiring.mjs`, `test-rs-3039-large-layout.mjs`,
`test-text-position-workflow.mjs`, `test-mono-006-monogram-ui.mjs:160` and
`test-ui-import-autoswitch-regression.mjs:150`.

**`startImageRedraw()`, `REDRAW_ERROR_MESSAGES`, `redrawErrorMessage()` and
`setImageRedrawStatus()` (`app.js:5572-5650`).** `test-img-022-redraw-provider.mjs:612` forbids
`OpenAI` anywhere in app.js. `:618` pins the first three lines of `startImageRedraw()` verbatim. No
other test matches these functions.

**Import lines `app.js:101-102`.** `test-object-template-integration.mjs:171-175` checks that names
are in the products-barrel import, which a subset check tolerates. Adding `SHEET_MAX_MM` and
`detectAiStones` is safe. `test-image-trace-regression.mjs:61` checks GeometryEngine's
`'../image/index.js'` import with `[^}]*`, which also tolerates the new name.

**`index.html`.** `test-ui-shell-structure.mjs:218` asserts a list of ids exist, which added
elements do not affect.

**Existing tests this build must update** (listed under "Tests the build must add"):
`test-img-022-redraw-provider.mjs` T1 (`:168-184`), T5 (`:251`, `'medium'`), T6 (`:272-296`, the
safety-system case `:277`) and T7 (`:299`, defaults).

## Build housekeeping

- **New files:** `src/image/AiStoneDetect.js`, `src/geometry/AiStoneSampler.js` and
  `tools/test-img-023-ai-stone-transfer.mjs`. This spec commit already adds
  `docs/prototypes/ai_stone_transfer_reference.py`.
- **Changed:** `app.js`, `index.html`, `src/image/index.js`, `src/geometry/GeometryEngine.js`,
  `src/redraw/RedrawLayerTransform.js`, `src/redraw/index.js`, `src/redraw/OpenAiProxyProvider.js`,
  `server/redraw/prompt.mjs`, `server/redraw/handler.mjs`, `server/redraw/env.mjs`,
  `.env.example`, `docs/specifications/IMG-022-RedrawProvider.md` (settings table only),
  `tools/test-img-022-redraw-provider.mjs` and `tools/test-groups.mjs`.
- **No new npm dependencies and no image files.** The reference script's Python dependencies are
  not repo dependencies. Nothing from `tools/scratch/` is committed.
- **Four-image acceptance run.** Report pitch, width/height, totals, palette, AI stones and colour
  agreement per run against the bands above, plus detection and placement timings.
- **Browser check.**
  1. Redraw in fake mode (`REDRAW_FAKE=1`); the fake PNG has no AI stones, so check the "no AI
     stones" hint and the IMG-022 160 mm fallback.
  2. Load one `tools/scratch/img-023` image as an image layer, switch Fill style to AI stones, and
     check the size, the shrink select, the hint on a mug, the Flat Sheet growth, and that Undo
     restores the size and sheet.
  3. Check the AI image and Source views on a redrawn layer.
  4. Make one live OpenAI call only with the operator's go-ahead, since it is billed.

## Non-goals

- The Colours rows are disabled, not adapted, for AI stones, and the Colours canvas view still shows
  the quantised field (F3).
- IMG-008's vector-first SVG regions for an AI stones layer still come from the traced field (as for
  Line Design).
- There is no phase alignment of the real grid to the AI lattice.
- There is no Web Worker for detection.

## Findings for decision

All resolved (commit "IMG-023 spec: findings F1-F6 resolved"). The original finding text is kept
under each resolution.

- **F1. Resolved: per-colour band widened.** The setup-to-setup band for per-colour counts is
  **max(1.5 %, 15 stones)**; the AI-stone count and Jet keep **max(0.5 %, 10)** ("Reference
  figures", group 2). *Finding:* portrat's light-peach differs by 11 (shrink 1.0) and 12 (0.8)
  between the two reference setups, which the first band, max(0.5 %, 10), did not allow.
- **F2. Resolved: colour band 95 %.** The colour-agreement band is **95 %**, under the controlled
  protocol (reference positions, reference scale), for the four-image acceptance run and for T8.
  *Finding:* a literal end-to-end comparison shares no positions with the reference (D4), and a
  0.2 % pitch change alone costs up to 10 %. Even under the protocol, a port that differs only in
  8-bit L\* rounding reaches 97.66 % on tiger 1.0, leaving almost no margin under 97 % for the
  dot-less step, morphology borders and merge-tie order.
- **F3. Resolved: Colours rows disabled.** While `'ai-stones'` is selected, `#imgColorPick0`-`7`
  are disabled with the same title as colour count and vividness (D3). *Finding:* AI stones ignores
  `colorMap`, so a pick in those rows changed nothing.
- **F4. Accepted as reference behaviour.** The Jet rule uses Jet even when the greedy palette did
  not pick it, so Jet can be a 9th colour. All four measured palettes contain Jet, so this has not
  been seen in practice.
- **F5. Accepted for now; backlog row added.** `docs/BACKLOG.md` has "Product-aware stone count in
  the redraw prompt (PROMPT_VERSION 3)". *Finding:* D2's fit-to-canvas rule fits the four designs
  (205-249 mm at shrink 1.0) to the default mug canvas (257.6 × 85 mm) at an effective shrink of
  0.26-0.32, and to tumbler and bottle at 0.48-0.61. The default plate (270 mm) and a grown Flat
  Sheet keep 1.0. On every vessel the one-stone lines break and the hint always shows. The prompt
  asks for about 70 stones across; a mug band would need roughly 30 at SS6.
- **F6. Kept.** The box re-sizes only when detection is `ok` (D2(b)); on a photo, detection fails,
  the box is left alone and the hint says so. It is intentional that AI stones also works on a
  rhinestone picture imported directly, without a redraw: such an image is sized from its own
  pitch like a redrawn one.
