# IMG-009 — Subject Mask

## Objective

Every image layer's on/off mask is produced today by one operator: `applyThreshold()`
(`src/image/Threshold.js:27`), which keeps a pixel when its luminance is below `threshold`. That
operator answers "is this pixel dark?" For a logo, a silhouette or black text on white, dark and
subject are the same thing and the operator is correct. For a photograph of a coloured object on a
background — the case the IMG series was built for — they are not the same thing at all, and the
mask keeps the dark *parts of* the subject while discarding the subject.

IMG-009 adds a second masking operator, `computeSubjectMask()`, that answers the right question
for that case: is this pixel part of the subject? It has two routes. When the image carries real
transparency, the alpha channel already *is* the silhouette and drives the mask directly. When it
does not, the background colour is sampled from the image border and the subject is every pixel
far enough from it in CIE Lab, reduced to its largest connected component. A new per-layer
`maskMode` selects between the new operator and the existing threshold, defaulting to `threshold`
at every read site so that every saved project is byte-identical, and to `subject` for newly
imported images.

Nothing downstream changes. The mask this operator produces enters `prepareImageField()`
(`src/image/ImageFieldPipeline.js:149`) at exactly the point `applyThreshold()`'s output enters it
today, so invert, the transparent policy, blur, resize, the edge channel, colour quantization and
every sampler are untouched. That is what makes this a small milestone despite the size of the
behaviour change.

## Measured comparison

One fixture, built two ways — opaque on a near-uniform light background, and as a true-alpha
cutout — 240×240 px, placed at 60×60 mm, `maxWidthPx`/`maxHeightPx` 400, `threshold` 128,
`transparent: 'ignore'`, no invert, no blur. The generator is pinned verbatim below and is reused
as-is by `tools/test-img-009-subject-mask.mjs`. `wingShape()` is also the ground truth: the exact
set of pixels that *are* the subject, which is what makes the comparison a measurement rather than
an opinion.

```js
const N = 240;
const W = 60, H = 60;
const PALETTE = [
  { id: 'jet', hex: '#141414' }, { id: 'siam', hex: '#9b1c1c' }, { id: 'sapphire', hex: '#2269d3' },
  { id: 'light-sapphire', hex: '#6fa8dc' }, { id: 'topaz', hex: '#e08e26' }, { id: 'citrine', hex: '#f2c94c' },
  { id: 'silver', hex: '#d8dde4' }, { id: 'crystal', hex: '#e9f7ff' }
];

function wingShape(u, v) {
  const x = (u - 0.5) * 2, y = (v - 0.5) * 2;
  return Math.hypot(x / 0.55, (y + 0.28) / 0.45) < 1
    || Math.hypot(x / 0.42, (y - 0.32) / 0.38) < 1
    || (Math.abs(x) < 0.06 && Math.abs(y) < 0.62);
}
function subjectColor(u, v) {
  const x = (u - 0.5) * 2, y = (v - 0.5) * 2;
  if (Math.abs(x) < 0.06 && Math.abs(y) < 0.62) return [60, 45, 35];
  if (Math.abs(Math.sin(x * 14 + y * 4)) > 0.93) return [45, 40, 40];
  if (y < -0.05) { const t = (x + 0.6) / 1.2; return [90 + 90 * t, 150 + 70 * t, 210 + 40 * t]; }
  const t = (y - 0.05) / 0.7; return [225 - 10 * t, 165 + 35 * t, 60 + 30 * t];
}
function build(withAlpha) {
  const d = new Uint8ClampedArray(N * N * 4);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const u = (x + 0.5) / N, v = (y + 0.5) / N, i = (y * N + x) * 4;
    if (wingShape(u, v)) {
      const c = subjectColor(u, v);
      d[i] = c[0]; d[i + 1] = c[1]; d[i + 2] = c[2]; d[i + 3] = 255;
    } else if (withAlpha) {
      d[i] = d[i + 1] = d[i + 2] = 255; d[i + 3] = 0;
    } else {
      d[i] = d[i + 1] = d[i + 2] = 246; d[i + 3] = 255;
    }
  }
  return createImageBuffer({ widthPx: N, heightPx: N, data: d });
}
```

The subject is a blue upper wing pair, an orange-to-yellow lower pair, a dark body and dark veins —
the colour structure of an ordinary photographic subject, where most of the object is *brighter*
than mid-grey and only its detail is dark. `wingShape()` covers **0.294** of the frame.

| Mask operator | coverage | vs truth 0.294 | `colorCount: 6` finds |
|---|---|---|---|
| `applyThreshold()` at 128 (today) | 0.095 | keeps 32% of the subject | jet, siam |
| `computeSubjectMask()`, background route, tolerance ΔE 8 / 12 / 20 | 0.294 | exact | jet, siam, citrine, silver, light-sapphire |
| `computeSubjectMask()`, alpha route | 0.294 | exact | jet, siam, citrine, silver, light-sapphire |

Coverage is the fraction of field pixels with `data >= 128`; the tolerance column is driven by
`toleranceDe` and the colour column by `colorCount`. Stone counts at threshold 128, driven by
`stoneSizeMm`/`gapMm`: 32 at 2.8/0.3, 69 at 2.0/0.3, 105 at 1.6/0.2.

Three things this settles:

* **The failure is the operator, not its parameter.** No value of `threshold` recovers 0.294 here,
  because the subject spans luminances both above and below every background level. Tuning the
  default — an auto-threshold by Otsu's method was considered and measured — cannot fix this
  class of image. On a real photograph tested alongside this fixture, Otsu chose 164 where the
  correct split was 232, because two bright background levels dominated the histogram.
* **The colour collapse is downstream of the mask, and needs no fix of its own.**
  `quantizeColors()` (`src/image/ColorQuantize.js:276`) already builds its histogram from on-pixels
  only (`:318` skips anything below `FIELD_ON_THRESHOLD`) and `assignNearestIds()` (`:229`) already
  maps each cluster to its catalog entry by CIE76 Lab distance. The colour path is correct as
  built. It returned two colours because it was handed a mask containing only the dark veins and
  body; handed the right mask, the same unchanged code returns five.
* **Tolerance is not a sensitive parameter.** ΔE 8, 12 and 20 give identical coverage on a clean
  background. 12 is the default chosen here; it is not exposed as a control in this milestone
  (decision 4).

## Decisions

### 1. Two routes, chosen by the image, not by the operator

`computeSubjectMask(imageBuffer, options)` returns
`{ mask, route, backgroundRgb }` where `mask` is a native-resolution 0/255 field of the same shape
`applyThreshold()` returns.

* **Alpha route**, taken when more than 1% of pixels have alpha below
  `ALPHA_COVERAGE_THRESHOLD` (`src/image/Alpha.js:15`, already 128): the mask is exactly
  `alpha >= 128`. `backgroundRgb` is `null`. The 1% floor keeps a JPEG-sourced buffer, or a PNG
  with a stray anti-aliased pixel, on the background route rather than producing an all-on mask.
* **Background route**, otherwise: the border ring (row 0, row `h-1`, column 0, column `w-1`) is
  averaged to a background colour, and a pixel is subject when its CIE76 distance from it exceeds
  `toleranceDe`. The result is reduced to its largest 4-connected component, which drops the
  speckle a photographic background leaves behind and keeps holes as holes — an enclosed region
  that is background-coloured stays off, because it is simply not in the component.

The Lab conversion and CIE76 distance already exist in `ColorQuantize.js` for `assignNearestIds()`.
They move to a small shared module rather than being duplicated (decision 5).

### 2. It enters the pipeline where the threshold does

In `prepareImageField()` (`ImageFieldPipeline.js:149`), the single line

    let mask = applyThreshold(luminanceNative, options.threshold);

becomes a choice on `options.maskMode`: `'threshold'` keeps that call unchanged, `'subject'` calls
`computeSubjectMask()` instead. Everything after it — the invert branch, `maskOutTransparent()`,
`blurMask()`, `resizeField()`, the `luminance`/`alpha`/`edge` channels and the `colorCount > 1`
quantization block — is untouched and runs identically on whichever mask it is handed.

`transparent: 'ignore'` still applies on the subject route. On the alpha route it is a no-op by
construction (the mask is already the alpha coverage); on the background route it is a real
additional constraint and is left in place rather than special-cased.

`invert` also still applies, and on the subject route it means "stones on the background instead of
the subject" — a coherent and occasionally useful thing, not an edge case to block.

### 3. `maskMode` defaults to `threshold` at every read site

A new per-layer field `layer.maskMode`, resolved everywhere through one
`resolveImageMaskMode(value)` returning `'threshold'` unless the value is exactly `'subject'`.
Read-site default `'threshold'` is what makes every existing saved project byte-identical: a
project written before this milestone has no `maskMode`, resolves to `'threshold'`, and produces
the same stones it did before. The import factory (`app.js:5278`) sets `maskMode: 'subject'` on
newly imported layers, so new work gets the better operator and old work does not silently change
under the operator's feet.

Studio control: a new `#imgMaskMode` select (Subject / Threshold) in the existing image group,
added to `HISTORY_TRACKED_CONTROL_IDS` (`app.js:4840`). The threshold slider stays exactly where it
is and keeps working; on the subject route it simply has no effect on the mask, which the control's
hint states.

### 4. `toleranceDe` is not exposed in this milestone

`DEFAULT_SUBJECT_TOLERANCE_DE = 12`, a module constant in `SubjectMask.js`, not a per-layer field.
The measurement above shows ΔE 8 to 20 are indistinguishable on a clean background, so a control
would add a second new per-layer field, a second resolver, and five more wiring sites for a
parameter nobody yet has a reason to move. If real images turn out to need it, it becomes a
one-field follow-on with this milestone's wiring already in place.

### 5. Lab helpers move, they do not get duplicated

`rgbToLab()` and `cie76Distance()` are currently private to `ColorQuantize.js`. They move to
`src/image/ColorSpace.js` and both modules import them. This is a pure move: `ColorQuantize.js`'s
behaviour must be byte-identical afterwards, pinned by Test Plan item 7 against numbers measured on
the pristine tip.

## Structure

1. `src/image/ColorSpace.js` (new) — `rgbToLab()`, `cie76Distance()`, moved verbatim from
   `ColorQuantize.js`.
2. `src/image/SubjectMask.js` (new) — `computeSubjectMask()`,
   `DEFAULT_SUBJECT_TOLERANCE_DE`, `SUBJECT_ALPHA_PRESENCE_FRACTION` (0.01).
3. `src/image/ImageFieldPipeline.js` — `maskMode` through `normalizeParams()`, the one-line mask
   choice at `:154`.
4. `src/image/index.js` — export `computeSubjectMask` and the two constants.
5. `app.js` — `resolveImageMaskMode()`; `maskMode` added to all five sites in decision 6; the
   import factory (`:5278`); `HISTORY_TRACKED_CONTROL_IDS` (`:4840`).
6. `index.html` — the `#imgMaskMode` select and its hint, in the existing image studio group.
7. `tools/test-img-009-subject-mask.mjs` (new), registered in `tools/test-groups.mjs` beside
   `test-img-008-vector-first-svg.mjs` (both occurrences).
8. Docs — this spec; `docs/specifications/IMG-001-ImageToStrass.md` gains IMG-009 as a
   post-roadmap milestone with one sentence on why; `docs/BACKLOG.md`'s row on the luminance
   channel compositing alpha onto white is updated (decision 7); `docs/ARCHITECTURE.md`'s image
   pipeline description names the two operators.

### 6. Five wiring sites, every one guarded

This is the field-resolver class of bug that shipped silently in IMG-003 and again in IMG-006.
IMG-008 added a fifth site, so the surface is larger than the BACKLOG row (`:54`) describes.
`maskMode` must be present at all five, each with a source-text guard:

| Site | What it is |
|---|---|
| `app.js:1018` | `generateImageStonesLive()`'s params object — the live generate path |
| `app.js:2487` | Studio sync: control ← layer |
| `app.js:2638` | Studio readback: layer ← control |
| `app.js:3217` | `resolveLayerShapeSource()`'s `prepareImageField()` call — Boolean operations |
| `app.js:3239` | `resolveImageExportRegions()`'s params object — IMG-008's SVG regions |

The last two matter more than they look. If either misses `maskMode`, a Boolean operation or an
exported SVG region silently traces a *different silhouette* from the stones on screen — the exact
failure IMG-008 designed its own params object to prevent.

### 7. The BACKLOG row on luminance compositing

`docs/BACKLOG.md`'s row noting that `prepareImageField()`'s luminance channel always composites
alpha onto white regardless of the `transparent` policy is **closed by this milestone for the mask,
and left open for the luminance channel.** On the subject route a cutout's silhouette no longer
depends on composited luminance at all, which removes the practical consequence the row was
written about. The channel itself still composites onto white, which is still correct for
brightness sizing (IMG-006 decision 4), so the row's original text stands with an outcome note
appended.

## Out of Scope

* No change to `quantizeColors()` or `assignNearestIds()` beyond the pure helper move — the
  measurement shows they are already correct.
* No auto-threshold, Otsu or otherwise. Measured and rejected above.
* No automatic stone-size selection. 1.6 mm resolves a photograph where 2.8 mm cannot, but that is
  an operator's choice about cost and substrate, not something this milestone decides.
* No sampler, DXF, production-sheet or SVG-export change; no `StoneLayout` change.
* No background removal beyond a single border-sampled colour — no gradient backgrounds, no
  chroma-key on multiple colours, no matting of semi-transparent edges. A photograph shot on a
  gradient or cluttered background stays a threshold-mode image, and the Studio select lets an
  operator fall back to it in one click.
* No auto-detection of which mode suits a given image. `maskMode` is explicit.

## Compatibility

* Every project saved before this milestone resolves `maskMode` to `'threshold'` and produces
  byte-identical stones. Pinned by Test Plan item 1 against digests measured on the pristine tip.
* `prepareImageField()` called without `maskMode` — as four existing test files and
  `resolveLayerShapeSource()` do — behaves exactly as today.
* `ColorQuantize.js` is byte-identical in behaviour after the helper move (item 7).
* The new layer field is additive; no schema version change, and a project saved with
  `maskMode: 'subject'` read by an older build ignores the unknown key and falls back to threshold.

## Test Plan

`tools/test-img-009-subject-mask.mjs`, using the pinned generator verbatim. Every literal is inline
in the test file, measured either on the pristine tip (items 1, 7) or from this milestone's own
implementation (items 2-6, 8-9).

1. **Byte-identity of threshold mode.** `prepareImageField()` with no `maskMode`, and with
   `maskMode: 'threshold'`, produce fields whose `data`, `luminance`, `alpha` and `edge` arrays are
   deep-equal to each other and whose SHA-256 digests match the two literals measured on the
   pristine tip, for both fixture variants.
2. **Coverage.** Subject mode gives coverage `0.294` on both variants, against `0.095` in threshold
   mode, with `wingShape()`'s own count as the independently computed truth — the test recomputes
   the truth from the generator, not from the mask.
3. **Route selection.** The alpha variant reports `route: 'alpha'`; the opaque variant reports
   `route: 'background'` with `backgroundRgb` equal to `[246, 246, 246]`. A variant with exactly
   0.5% transparent pixels takes the background route; one with 2% takes the alpha route.
4. **Tolerance insensitivity.** ΔE 8, 12 and 20 give identical coverage on the opaque variant, and
   ΔE 2 does not (pinning that the parameter is wired through at all rather than ignored).
5. **Largest-component reduction.** A variant with a detached 3×3 speckle of subject colour in the
   corner yields the same coverage as the clean variant, and a variant with an enclosed
   background-coloured hole in a wing yields coverage below the clean variant by that hole's exact
   pixel count.
6. **Colour recovery.** `colorCount: 6` over the subject mask yields `nearestId`s
   `jet, siam, citrine, silver, light-sapphire`; over the threshold mask, `jet, siam`.
7. **The Lab move is pure.** `assignNearestIds()`'s output for a fixed set of cluster RGBs against
   the eight-entry palette equals the ids measured on the pristine tip, and `rgbToLab()` returns
   the pristine values for three fixed colours.
8. **Invert and transparent still compose.** Subject mode with `invert: true` gives coverage
   `1 - 0.294` on the opaque variant; subject mode with `transparent: 'ignore'` on the alpha
   variant is unchanged from `transparent: 'white'`.
9. **App-path source-text guard.** `app.js` contains `function resolveImageMaskMode(`, and each of
   the five sites in decision 6 contains `maskMode:` or `imgMaskMode` as appropriate; `index.html`
   contains `id="imgMaskMode"`; `HISTORY_TRACKED_CONTROL_IDS` contains `'imgMaskMode'`.

Pre-existing tests to re-grep before running the suite, since they pin literal source shapes near
what this milestone changes: the three `extractFunctionBody()` guards on `generateImageStonesLive()`
(`test-img-004-edge-awareness.mjs:413`, `test-img-005-check-and-fix.mjs:332`,
`test-img-006-brightness-sizes.mjs:304`); `test-img-008-vector-first-svg.mjs:9`'s own guard on
`resolveImageExportRegions()`'s key set, which gains `maskMode:`;
`test-production-export-validation.mjs:216` and `test-object-template-integration.mjs:303` on the
export handlers (untouched); any test greping `normalizeParams` or `prepareImageField`'s option
list; `test-module-graph-exports.mjs` for the two new modules.

## Anchor verification note

Re-grepped against `develop` at the IMG-008 merge immediately before writing:
`ImageFieldPipeline.js` `prepareImageField()` (`:149`, the `applyThreshold()` call at `:154`, the
`transparent`/blur/resize sequence `:158`-`:164`, the `colorCount > 1` block `:181`-`:194`);
`Threshold.js` `DEFAULT_THRESHOLD` (`:14`), `applyThreshold()` (`:27`); `Alpha.js`
`ALPHA_COVERAGE_THRESHOLD` (`:15`), `extractAlphaChannel()` (`:21`), `toCoverageMask()` (`:38`);
`ColorQuantize.js` `assignNearestIds()` (`:229`), `quantizeColors()` (`:276`, on-pixel skip at
`:318`); `app.js` `generateImageStonesLive()` (`:1018`), studio sync (`:2487`), studio readback
(`:2638`), `resolveLayerShapeSource()`'s `prepareImageField()` call (`:3217`),
`resolveImageExportRegions()` (`:3239`), `HISTORY_TRACKED_CONTROL_IDS` (`:4840`), image layer
factory (`:5278`).
