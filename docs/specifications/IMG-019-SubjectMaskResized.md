# IMG-019 — Subject mask on a resized copy

**Status: spec.** File:line citations are against `develop` @ `47c6ba8` (the RS-3039 merge). Every
anchor below was re-grepped on that tip. The photo figures and timings were measured by the lead
architect in a prototype. This spec's own scratch probes re-derived every fixture figure (T1, T2),
the T3 identity, every digest (T4, T5) and every mutant result, on a scratch copy of the tree with
decisions 1 to 6 applied. Every one agrees. The copy lives in the session scratchpad, not under
`tools/scratch/`.

## Objective

`maskMode: 'subject'` runs `computeSubjectMask()` on the native RGBA buffer. Its background route
converts every native pixel to Lab and flood-fills the whole image, and `prepareImageField()` then
resizes the result to `maxWidthPx` × `maxHeightPx` (400 by default). On a large photo, the mask
dominates the cost of a live generate. This is `docs/BACKLOG.md` row 56 ("Computing the subject mask
on a pre-resized buffer (resize first, then mask) would cut native-pixel Lab-conversion work").

IMG-019 computes the subject mask on a box-resized copy of the image when the image is large, and
maps the small mask back to native size. Everything after the mask (invert, transparent policy,
blur, resize) is unchanged. Images whose longer side is at most 1000 px are byte-identical, and so
are `'threshold'`, `'whole'` and Line Design.

## Measurement settings

Photo figures come from `generateImageLayout()` at the app's import defaults:

* Staggered, SS6 (2.0 mm), gap 0.3 mm, `fillGaps` true, Auto colour count;
* vividness 1.4, `maskMode` `'subject'`, `transparent` `'ignore'`, `maxWidthPx` and `maxHeightPx`
  400;
* the 23-colour catalogue from `app.js`'s `imageColorPalette()`.

The layer is 129.6 mm wide, at the unrounded height `computeDefaultImagePlacement()` produces. All
stone figures are engine output, taken at the decision stage (after the 1.2% floor, relabelling and
the cap). The seven images are IMG-015's reference photos in `~/Downloads`.

## Measured figures

These figures are the rationale. No test pins them.

**Cap 400 (rejected).** Masking at the working resolution itself is too coarse. The portrait's mask
changes by 12.6% and its stones drop from 3464 to 2970: the hair and lash lines that stop the
background flood fill blur away, and the fill runs into the face.

**Cap 800, applied to all seven images:**

| Image | Stones, native mask | Stones, cap 800 | Mask pixels that differ |
|---|---|---|---|
| tiger | 2986 | 2971 (2966 unmoved, 6 recoloured) | 0.64% |
| portrait | 3464 | 3458 | 0.52% |
| Einstein | 2052 | 2049 | 0.62% |
| butterfly | unchanged | unchanged | 0% |
| logo | unchanged | unchanged | 0% |
| cartoon | unchanged | unchanged | 0% |
| furry | unchanged | unchanged | 0% |

With the D1 trigger, only the tiger (1300 px) takes the new path. The other six stay on the native
path and are byte-identical.

**Timing.** On a 4000×3000 photo (the tiger upscaled), `prepareImageField()` in `'subject'` mode
takes 3228 ms with the native mask and about 980 ms at cap 800. `'threshold'` on the same image
takes 445 ms.

**Line Design.** Routing Line Design through the resized mask gives identical stones on all seven
images. It stays on the native mask anyway (D3), so its pins need no re-derivation.

## Decisions

### D1. Resized copy above the trigger

Two constants are added to `src/image/ImageFieldPipeline.js`:

* `SUBJECT_MASK_RESIZE_TRIGGER_PX = 1000`
* `SUBJECT_MASK_MAX_DIMENSION_PX = 800`

In `prepareImageField()`'s `'subject'` branch (`:183-184`, the `computeSubjectMask(imageBuffer, {})`
call), when `Math.max(imageBuffer.widthPx, imageBuffer.heightPx)` is greater than
`SUBJECT_MASK_RESIZE_TRIGGER_PX`, the mask is computed on a resized copy of the RGBA buffer instead
of the buffer itself.

The copy is defined as exactly what `resizeField()` (`src/image/Resize.js:20`) produces when it is
applied to each of the four channels separately, with `maxWidthPx` and `maxHeightPx` both
`SUBJECT_MASK_MAX_DIMENSION_PX`, and the four results interleaved back into RGBA. Its size is
therefore `resizeField()`'s own `newWidth` × `newHeight` (`:31-32`): the longer side is at most 800,
and the aspect ratio is kept. The alpha channel is resized along with the colour channels, so
`computeSubjectMask()`'s alpha route (`src/image/SubjectMask.js:220-223`) also runs on the copy.

At or below the trigger, the branch is today's native call, unchanged.

### D2. Nearest mapping back to native size

The small mask (`w` × `h`) is mapped back to the native size (`W` × `H`) by nearest lookup. Native
pixel (x, y) takes small pixel

    (min(w - 1, floor(x * w / W)), min(h - 1, floor(y * h / H)))

The result is a 0/1 native-resolution field built with `createField()` (already imported at `:31`).
It is the same shape `computeSubjectMask()` returns today, so invert (`:190-191`), the transparent
policy (`:193-194`, still reading the native alpha), blur (`:196`, `blurRadiusPx` still in native
pixels) and the final resize (`:197`) run unchanged.

### D3. Line Design is out of scope

`computeFilledMaskAndInpaint()` (`src/geometry/LineDesignSampler.js:166`) keeps calling
`computeSubjectMask(imageBuffer, {})` on the native buffer (`:176`). It does not import the new
path. Line Design output is pinned byte-identical (T4).

### D4. Other mask modes

`'threshold'` (`:188`) and `'whole'` (`:185-186`) are unchanged. Their fields are pinned byte-identical
(T5).

### D5. One-pass resize allowed

The build may resize all four channels in one pass, over one four-channel integral image, instead of
four `resizeField()` calls. The result must be byte-identical to D1's definition. T3 compares them.

This spec's probe built both forms. On `rgbaFixture()` below, both give an 800×395 copy, and the
two copies are byte-identical.

### D6. Exports

`SUBJECT_MASK_RESIZE_TRIGGER_PX` and `SUBJECT_MASK_MAX_DIMENSION_PX` are exported from
`src/image/ImageFieldPipeline.js`, next to `TRANSPARENT_MODES` (`:39`).

The RGBA resize is also exported from the same file, as
`resizeImageBuffer(imageBuffer, maxWidthPx, maxHeightPx)`, returning `{ widthPx, heightPx, data }`
with RGBA `data`. T3 calls it directly. Without the export, T3 could only compare it indirectly,
through a whole `prepareImageField()` run.

## Anchors

Every anchor was re-grepped on `47c6ba8`, and the line given is the actual line.

| File | Line | Content |
|---|---|---|
| `src/image/ImageFieldPipeline.js` | `:29` | `import { resizeField } from './Resize.js';` |
| | `:31` | `import { createField } from './ImageBuffer.js';` |
| | `:33` | `import { computeSubjectMask } from './SubjectMask.js';` |
| | `:39` | `export const TRANSPARENT_MODES = ...` (the new exports go beside it) |
| | `:174` | `export function prepareImageField(imageBuffer, params = {}) {` |
| | `:183-184` | `if (options.maskMode === 'subject') {` / `mask = computeSubjectMask(imageBuffer, {}).mask;` — the one line D1 changes |
| | `:185-186` | the `'whole'` branch (D4) |
| | `:188` | `mask = applyThreshold(luminanceNative, options.threshold);` (D4) |
| | `:190-197` | invert, transparent policy, `blurMask(mask, options.blurRadiusPx)`, `resizeField(density, ...)` (D2, unchanged) |
| `src/image/Resize.js` | `:20` | `export function resizeField(field, maxWidthPx, maxHeightPx) {` |
| | `:25` | `const scale = Math.min(1, maxWidthPx / widthPx, maxHeightPx / heightPx);` |
| | `:31-32` | `newWidth` and `newHeight` |
| `src/image/SubjectMask.js` | `:208` | `export function computeSubjectMask(imageBuffer, options = {}) {` |
| | `:220-223` | the alpha route: `if (transparentFraction > SUBJECT_ALPHA_PRESENCE_FRACTION)` and its per-pixel alpha test |
| `src/geometry/LineDesignSampler.js` | `:166` | `function computeFilledMaskAndInpaint(imageBuffer, maskMode) {` |
| | `:176` | `data = computeSubjectMask(imageBuffer, {}).mask.data;` (D3, unchanged) |
| | `:670` | `export function generateLineDesignStonePoints({ ... })` |
| `tools/test-groups.mjs` | `:75`, `:210` | `test-img-018-whole-image-mask.mjs` in `core` and `geometry` |
| `docs/BACKLOG.md` | `:56` | row 56, the finding this spec closes |

**Source-text search for the changed line.** The text `computeSubjectMask(imageBuffer, {}).mask`, its
regex-escaped form `computeSubjectMask\(imageBuffer, \{\}\)\.mask`, and the branch condition
`options.maskMode === 'subject'` were searched across `tools/`. No test reads
`src/image/ImageFieldPipeline.js` as text. The only match is
`tools/test-img-010-line-design.mjs:849`, a test's own direct `computeSubjectMask(imageBuffer, {})`
call, which does not go through `prepareImageField()` and is unaffected.

## Test fixtures

Pinned as literal generator code in the new test.

```js
function ringFixture(side) {
  const widthPx = side, heightPx = side;
  const data = new Uint8ClampedArray(side * side * 4);
  const c = side / 2;
  for (let y = 0; y < side; y++) {
    for (let x = 0; x < side; x++) {
      const o = (y * side + x) * 4;
      const r = Math.hypot(x + 0.5 - c, y + 0.5 - c);
      let rgb = [255, 255, 255];
      if (r < side * 0.1) rgb = [40, 40, 160];
      else if (Math.abs(r - side * 0.3) < 0.75) rgb = [200, 200, 200];
      data[o] = rgb[0]; data[o + 1] = rgb[1]; data[o + 2] = rgb[2]; data[o + 3] = 255;
    }
  }
  return { widthPx, heightPx, data };
}
```

A thin light-grey ring on white, around a blue disc. At native resolution the ring stops the
background flood fill, so everything inside it is subject. At 800 px the box resize blends the ring
into the white until it falls within the background tolerance, so the fill reaches the disc and only
the disc is subject.

```js
function cropFixture(source, widthPx, heightPx) {
  const data = new Uint8ClampedArray(widthPx * heightPx * 4);
  for (let y = 0; y < heightPx; y++) {
    data.set(source.data.subarray(y * source.widthPx * 4, (y * source.widthPx + widthPx) * 4), y * widthPx * 4);
  }
  return { widthPx, heightPx, data };
}
```

The top-left `widthPx` × `heightPx` corner of `source`. T2 crops `ringFixture(1200)` to non-square
sizes, so the trigger is tested on both axes and a swapped x/y mapping shows.

```js
function rgbaFixture() {
  const widthPx = 1237, heightPx = 611;
  const data = new Uint8ClampedArray(widthPx * heightPx * 4);
  for (let y = 0; y < heightPx; y++) {
    for (let x = 0; x < widthPx; x++) {
      const o = (y * widthPx + x) * 4;
      data[o] = (x * 7 + y * 3) % 256; data[o + 1] = (x * y) % 256; data[o + 2] = (x ^ y) & 255;
      data[o + 3] = (x + 2 * y) % 97 < 30 ? 0 : 255 - (x % 64);
    }
  }
  return { widthPx, heightPx, data };
}
```

Non-square, with every channel varying independently, and with fully and partly transparent pixels.
Its resized copy is 800×395.

## Tests the build must add

T1 to T5 go in a new `tools/test-img-019-subject-mask-resized.mjs`. "On-count" below means the number
of `field.data` values above 127.

**T1. Pinned figures.** `prepareImageField(fixture, { maskMode: 'subject', transparent: 'ignore',
maxWidthPx: 400, maxHeightPx: 400 })`:

| Fixture | Path | On-count |
|---|---|---|
| `ringFixture(1000)` | native (trigger not met) | 45528 |
| `ringFixture(1200)` | resized | 5034 |

Both figures were checked against this spec's scratch implementation of D1 and D2, and agree
exactly.

**T2. Trigger boundary.** `prepareImageField(fixture, { maskMode: 'subject', maxWidthPx: 400,
maxHeightPx: 400 })` (transparent `'white'`, blur 0, invert false), on three crops of
`ringFixture(1200)`. Two references are built in the test:

* native: `resizeField(blurMask(computeSubjectMask(fixture, {}).mask, 0), 400, 400).data`;
* resized: the same, with the mask computed as D1 and D2 define it, written out in the test with four
  `resizeField()` calls and the D2 formula.

| Crop | Path | Equals | On-count (native / resized reference) |
|---|---|---|---|
| 1000×700 | native | native reference | 7346 / 6929 |
| 1001×700 | resized | resized reference | 7337 / 6952 |
| 700×1001 | resized | resized reference | 7337 / 6952 |

For each crop, the test also asserts that the native and resized references differ, so an equality
could not hold on both paths at once.

**T3. One-pass resize.** `resizeImageBuffer(rgbaFixture(), 800, 800)` is byte-identical, in
`widthPx`, `heightPx` and `data`, to four `resizeField()` calls on the separated channels,
interleaved back into RGBA. The result is 800×395.

**T4. Line Design unchanged.** `generateLineDesignStonePoints({ imageBuffer: ringFixture(1200),
placement: { xMm: 0, yMm: 0, widthMm: 100, heightMm: 100 }, gapMm: 0.3, layerId: 'img019', palette })`,
where `palette` is every `STONE_COLORS` entry as `{ id, hex: previewColor }`. The result is 302 stones
(outline 77, fill 219, pocket 6). The SHA-256 of
`JSON.stringify(stones.map((s) => [s.xMm, s.yMm, s.sizeMm, s.color, s.kind]))` is

    dc7c07a728f8951fb3ad5cdb93308e1acb0f56eaafea912112ecd67bcaeb983c

This is the pre-change result, taken on `47c6ba8`, and the scratch implementation reproduces it.

**T5. Other modes unchanged.** On `ringFixture(1200)`, with `{ transparent: 'ignore', maxWidthPx: 400,
maxHeightPx: 400 }`, the SHA-256 over the raw bytes of `data`, `luminance`, `alpha` and `edge`, in that
order, is:

| `maskMode` | Digest |
|---|---|
| `'threshold'`, threshold 128 | `54ad5095bbad8da6297a76cea23e7a7273f4b3399682a856e1774656623bbc66` |
| `'whole'` | `1acc564dced309c349efb708c66a8650921bf31168c59eae656ed7cbebe33930` |

Both are the pre-change values on `47c6ba8`, and the scratch implementation reproduces them.

**Mutants and the item each kills.** Each was run on the scratch implementation.

| Mutant | Killed by | Result under the mutant |
|---|---|---|
| M1. Trigger `>` becomes `>=`. | T2 | The 1000×700 crop takes the resized path: on-count 6929, not the native 7346. T1's 1000 figure also moves, 45528 → 5033. |
| M2. Cap 800 becomes 400. | T1 | `ringFixture(1200)` gives 5088, not 5034. |
| M3. The D2 mapping swaps x and y (`floor(x * h / H)` for the column, `floor(y * w / W)` for the row). | T2 | The 1001×700 and 700×1001 crops give 6963, not the resized reference's 6952. T3 does not see it: T3 tests the resize, not the mapping. T1 does not see it either, because its fixtures are square. |
| M4. Line Design routed through the resized path. | T4 | 39 stones (outline 24, fill 12, pocket 3), digest `812bbacb9b71d206fdf057c3581ee88f04d539be6a2b43398a7da0fbabc9b0a7`. |

## Existing tests

**No existing test is expected to move.**

The search covered every `tools/test-*.mjs` that mentions `subject`, `maskMode`,
`prepareImageField`, `generateImageLayout`, `image-trace` or `Image`, 42 files in all. Every one was
run on the scratch implementation, with the resized path instrumented to log each time it was taken.

* All 42 pass unchanged.
* The resized path was taken zero times. No test fixture that reaches `prepareImageField()` in
  `'subject'` mode has a longer side above 1000 px. The `maxWidthPx: 2000` in
  `tools/test-img-010-line-design.mjs` and `tools/test-img-015-direct-catalogue-colour.mjs` is a
  resize cap, not an image size.
* No test loads a photo from disk. The one image example, `examples/image-trace-monogram.rhs`, has no
  `maskMode`, so it reads as `'threshold'` (D4).
* Line Design pins in `tools/test-img-010-line-design.mjs`, `tools/test-img-016-neutral-brown-stones.mjs`,
  `tools/test-img-017-vividness.mjs` and `tools/test-img-018-whole-image-mask.mjs` stay byte-identical
  (D3).

## Build housekeeping

* `docs/BACKLOG.md` row 56 gains **Implemented:** `docs/specifications/IMG-019-SubjectMaskResized.md`,
  replacing this spec commit's **Addressed by IMG-019** marker and keeping its finding text, per the
  BACKLOG convention for closed rows.
* `tools/test-img-019-subject-mask-resized.mjs` is registered in `tools/test-groups.mjs` in the same
  groups as `tools/test-img-018-whole-image-mask.mjs`: `core` (`:75`) and `geometry` (`:210`).
* `docs/ARCHITECTURE.md:161-174` describes `maskMode`. It gains one sentence: above 1000 px on the
  longer side, `'subject'` computes its mask on an 800 px copy and maps it back by nearest lookup;
  Line Design keeps the native mask.
* This spec's Status line becomes "built" in the build commit.

## Out of scope

* Line Design's mask (D3). Its stones were identical on all seven images under the resized path, but
  it is not changed here.
* `'threshold'` and `'whole'`, which are already cheap (D4).
* Making the trigger or the cap a user setting.
* The Auto colour-count field and `computeImageColorField()` go through `prepareImageField()`, so
  they pick up the change with no edit of their own. No other caller of `computeSubjectMask()` is
  changed.
