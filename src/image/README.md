# src/image — Image Trace (RS-1008, corrected by RS-1008A, extended by IMG-001)

Prepares a bitmap image (PNG/JPG/JPEG/WebP) into a neutral, multi-channel field for the permanent
`GeometryEngine.generateImageLayout()` (`src/geometry/GeometryEngine.js`) to turn into stones — the
raster counterpart to how `src/svg/**` prepares neutral `Contour`s for `generateSvgLayout()`.
**This module never constructs a `Stone` or `StoneLayout` and never imports `src/geometry/**`.**
This is the first of an eight-milestone roadmap (`IMG-001`..`IMG-008`) turning Image Trace into a
multi-color, multi-mode, production-checked image-to-strass generator — see
`docs/specifications/IMG-001-ImageToStrass.md` and its reuse audit,
`docs/specifications/IMG-000-ImageToStrassAudit.md`.

RS-1008 originally had this module build `Stone`/`StoneLayout` directly (a second, independent
stone-generating implementation, forced by that milestone's own no-`src/geometry/**`-changes
constraint). RS-1008A removed that second implementation — see
`docs/specifications/RS-1008A-ImageTraceArchitectureCorrection.md`.

## Pipeline

```
Image bytes (File/Blob)
  -> ImageDecoder.decodeImageFileToBuffer()   [DOM-only: createImageBitmap + <canvas>]
  -> Grayscale.toGrayscale()                  [RGBA -> 0-255 luminosity, alpha onto white -- also
                                                the `luminance` channel below, always alpha-on-white
                                                regardless of `transparent`, see IMG-001-ImageToStrass.md]
  -> Alpha.extractAlphaChannel()              [RGBA -> raw 0-255 alpha, native resolution]
  -> Threshold.applyThreshold()               [0-255 -> 0/1 binary mask]
  -> Invert.invertMask()                      [optional: flip 0/1]
  -> (IMG-001) transparent:'ignore' masking   [optional: force alpha<128 pixels to 0 ("off"),
                                                regardless of luminance/invert -- native resolution,
                                                before blur]
  -> Blur.blurMask()                          [optional: 0/1 -> 0-255 density, separable box blur]
  -> Resize.resizeField()                     [optional: downscale-only, box-average, aspect-preserving
                                                -- applied to data, luminance, and alpha alike, so all
                                                three end up at the same widthPx/heightPx]
  -> Alpha.toCoverageMask()                   [alpha: re-threshold the resized, box-averaged alpha
                                                field back to a strict 0/255 coverage mask]
  -> { widthPx, heightPx, data, luminance, alpha, labels }  [the neutral multi-channel "field" —
                                                              src/image/**'s final product]

  ... consumed by src/geometry/GeometryEngine.js's generateImageLayout():
  -> StoneSampler.sampleFieldFillPoints()     [grid-sample the mm placement box against field.data]
  -> Stone[] / StoneLayout                    [src/geometry/index.js — the ONLY place these are built]
```

`ImageFieldPipeline.prepareImageField()` runs every step above and is this module's main entry
point — it is called both by `app.js` (for the live "preview before commit" density-mask canvas,
and for Boolean Operations shape resolution) and internally by `GeometryEngine.generateImageLayout()`
(before sampling), the same "the permanent engine calls the peer module's own pure functions"
pattern `generateSvgLayout()` already established by calling `parseSvgDocument()` internally.
Existing consumers read only `field.data`, byte-identical to the pre-IMG-001 pipeline whenever
`transparent` is omitted or `'white'` (the default) — see "Multi-channel field" below.

Every file except `ImageDecoder.js` is pure — no DOM, Canvas, WebGL, or codec dependency — so it
runs identically under plain Node (`tools/test-image-pipeline.mjs`, `tools/test-img-001-field.mjs`)
and the browser. `ImageDecoder.js` isolates the one unavoidable browser-only step (raster decode),
matching `src/browser/OpenTypeBrowserAdapter.js`'s existing "isolate the DOM-only glue" precedent;
`isSupportedImageFile()` inside it is still pure and Node-tested.

## Multi-channel field (IMG-001)

`prepareImageField()` returns `{widthPx, heightPx, data, luminance, alpha, labels}`. All four arrays
share one `widthPx`/`heightPx` pair (the post-resize working resolution `data` has always had):

* `data` — unchanged: the binary/blurred density field every existing caller already reads.
* `luminance` — the 0-255 grayscale *before* threshold (`toGrayscale()`'s own output, resized to
  match `data`). Reserved for IMG-006 (brightness-driven stone sizes).
* `alpha` — a strict 0/255 coverage mask (255 = opaque-enough source pixel), box-averaged down to
  `data`'s resolution then re-thresholded back to 0/255 (never a continuous average).
* `labels` (IMG-002) — `null` unless `colorCount > 1`, in which case a `Uint8ClampedArray` (same
  resolution as `data`) holding one colour-group index (`0..K-1`) per pixel, or `255` (`NO_LABEL`)
  for a pixel `data` itself already excludes (below `FIELD_ON_THRESHOLD`).
* `colorGroups` (IMG-002, IMG-015) — present only when `colorCount > 1` (and therefore `labels` is
  non-null): `[{rgb: [r,g,b], pixelShare, nearestId}]`, one entry per label value and one per kept
  catalog colour, in `palette` order. `nearestId` is that catalog entry's id (unique across groups),
  `rgb` the rounded mean of the pixels labelled with it and `pixelShare` their share of eligible
  pixels. `colorCount` omitted or `1` keeps the field
  at exactly IMG-001's six keys -- `colorGroups` is absent, not `null`.

`prepareImageField()` takes two more params for this (`ColorQuantize.js`, pure -- no
`src/geometry/**`/`src/renderer/**` import, the catalog palette pixels are labelled against arrives as
plain `[{id, hex}]` data): `colorCount` (integer 1-8, default 1) and `palette` (required when
`colorCount > 1`). `colorCount > 1` composites R/G/B onto white per channel (the same alpha-onto-white
rationale `toGrayscale()` already uses) and resizes each to the working resolution exactly like
`data`/`luminance`/`alpha`, then labels every eligible pixel (`data >= FIELD_ON_THRESHOLD`) with its
CIE76-nearest catalog colour, drops colours under a 1.2% share (`MIN_CATALOG_COLOR_SHARE`), keeps at
most `colorCount` of the rest by share, and relabels every dropped pixel to its nearest kept colour
(`labelCatalogColors()`, the same rule Line Design uses) -- deterministic, see
`docs/specifications/IMG-015-DirectCatalogueColour.md`.

## Transparency policy (IMG-001)

`prepareImageField()`/`GeometryEngine.normalizeImageParams()` take a `transparent` param:

* `'white'` (default) — current/only pre-IMG-001 behavior: alpha is flattened onto white before
  thresholding, no masking step runs.
* `'ignore'` — any pixel whose source alpha is `< 128` is forced off in `data`, regardless of
  luminance, applied at native resolution before blur.

Persisted per image layer as `layer.transparent`; missing (every project saved before this
milestone) resolves to `'white'` at every read site (`resolveImageTransparentMode()` in `app.js`),
so old projects regenerate byte-identical geometry. A freshly imported image's Lightbox toggle
defaults to `'ignore'`. See `docs/specifications/IMG-001-ImageToStrass.md` for the full rationale.

## Why stone generation is not here

`docs/ARCHITECTURE.md`'s Core Principle is that the Geometry Engine is the only component allowed
to generate stone positions. `src/image/**` is a peer input-processing module — exactly parallel to
how `src/svg/**` is a peer input-processing module for vector art — that prepares a neutral field
and stops there. `StoneSampler.sampleFieldFillPoints()`'s grid-walk-and-keep-if-on-field shape
deliberately mirrors `sampleFillPoints()`'s grid-walk-and-keep-if-inside-polygon shape ("use the
existing GeometryEngine sampling principles"), but it lives in `src/geometry/StoneSampler.js`, not
here, so every stone-sampling algorithm has exactly one home.

## Units

Every `*Mm` parameter is millimeters (the placement box, spacing) — but this module never receives
or produces `*Mm` values at all; that's `GeometryEngine.generateImageLayout()`'s concern. Every
`*Px` parameter/field here is pixels (image/field dimensions, blur radius, resize bounds).

## Determinism

Identical `(imageBuffer, params)` always produce a `deepEqual` field — no randomness, no wall-
clock/locale dependence. The only non-deterministic boundary is the browser's own
`createImageBitmap()` decode (upstream of every tested function here); re-decoding the exact same
source bytes produces the exact same pixel buffer.

## Public API (`index.js`)

* `createImageBuffer`, `createField` — pixel/field validation and wrapping.
* `toGrayscale`, `applyThreshold`, `invertMask`, `blurMask`, `resizeField` — individual pipeline
  stages, each independently testable.
* `extractAlphaChannel`, `toCoverageMask`, `ALPHA_COVERAGE_THRESHOLD` (IMG-001) — the alpha-channel
  stage: raw per-pixel alpha extraction, and reducing a (possibly box-averaged) alpha field to a
  strict 0/255 coverage mask.
* `prepareImageField` — the full field-preparation orchestrator (grayscale → threshold → invert →
  optional transparency mask → blur → resize); the one function both `app.js`'s preview panel and
  `GeometryEngine.generateImageLayout()` call. Returns the multi-channel field described above.
* `TRANSPARENT_MODES`, `DEFAULT_TRANSPARENT_MODE` (IMG-001) — the `transparent` param's valid values
  (`'white'`/`'ignore'`) and its default (`'white'`).
* `quantizeColors` (IMG-002, `ColorQuantize.js`) — the direct catalog-colour labeller
  `prepareImageField()` calls internally when `colorCount > 1` (IMG-015); also directly
  testable/callable on its own `{r, g, b, data, colorCount, palette}` shape.
* `maskFieldToRgba` — pure field-to-RGBA conversion for the "Preview before commit" panel.
* `labelsFieldToRgba` (IMG-002) — pure `field.labels` + per-label hex fills -> RGBA conversion, for
  the Image Studio's "Colours" preview view.
* `SUPPORTED_IMAGE_MIME_TYPES`, `MAX_SOURCE_DIMENSION_PX`, `isSupportedImageFile`,
  `decodeImageFileToBuffer`, `readFileAsDataUrl`, `decodeDataUrlToBuffer` — the browser-only decode
  boundary (`isSupportedImageFile` is pure).
