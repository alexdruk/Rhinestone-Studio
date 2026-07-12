# src/image — Image Trace (RS-1008, corrected by RS-1008A)

Prepares a bitmap image (PNG/JPG/JPEG/WebP) into a neutral density field for the permanent
`GeometryEngine.generateImageLayout()` (`src/geometry/GeometryEngine.js`) to turn into stones — the
raster counterpart to how `src/svg/**` prepares neutral `Contour`s for `generateSvgLayout()`.
**This module never constructs a `Stone` or `StoneLayout` and never imports `src/geometry/**`.**

RS-1008 originally had this module build `Stone`/`StoneLayout` directly (a second, independent
stone-generating implementation, forced by that milestone's own no-`src/geometry/**`-changes
constraint). RS-1008A removed that second implementation — see
`docs/specifications/RS-1008A-ImageTraceArchitectureCorrection.md`.

## Pipeline

```
Image bytes (File/Blob)
  -> ImageDecoder.decodeImageFileToBuffer()   [DOM-only: createImageBitmap + <canvas>]
  -> Grayscale.toGrayscale()                  [RGBA -> 0-255 luminosity, alpha onto white]
  -> Threshold.applyThreshold()               [0-255 -> 0/1 binary mask]
  -> Invert.invertMask()                      [optional: flip 0/1]
  -> Blur.blurMask()                          [optional: 0/1 -> 0-255 density, separable box blur]
  -> Resize.resizeField()                     [optional: downscale-only, box-average, aspect-preserving]
  -> { widthPx, heightPx, data }              [the neutral "field" — src/image/**'s final product]

  ... consumed by src/geometry/GeometryEngine.js's generateImageLayout():
  -> StoneSampler.sampleFieldFillPoints()     [grid-sample the mm placement box against the field]
  -> Stone[] / StoneLayout                    [src/geometry/index.js — the ONLY place these are built]
```

`ImageFieldPipeline.prepareImageField()` runs every step from grayscale through resize and is this
module's main entry point — it is called both by `app.js` (for the live "preview before commit"
density-mask canvas) and internally by `GeometryEngine.generateImageLayout()` (before sampling),
the same "the permanent engine calls the peer module's own pure functions" pattern
`generateSvgLayout()` already established by calling `parseSvgDocument()` internally.

Every file except `ImageDecoder.js` is pure — no DOM, Canvas, WebGL, or codec dependency — so it
runs identically under plain Node (`tools/test-image-pipeline.mjs`) and the browser.
`ImageDecoder.js` isolates the one unavoidable browser-only step (raster decode), matching
`src/browser/OpenTypeBrowserAdapter.js`'s existing "isolate the DOM-only glue" precedent;
`isSupportedImageFile()` inside it is still pure and Node-tested.

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
* `prepareImageField` — the full field-preparation orchestrator (grayscale → threshold → invert →
  blur → resize); the one function both `app.js`'s preview panel and
  `GeometryEngine.generateImageLayout()` call.
* `maskFieldToRgba` — pure field-to-RGBA conversion for the "Preview before commit" panel.
* `SUPPORTED_IMAGE_MIME_TYPES`, `MAX_SOURCE_DIMENSION_PX`, `isSupportedImageFile`,
  `decodeImageFileToBuffer`, `readFileAsDataUrl`, `decodeDataUrlToBuffer` — the browser-only decode
  boundary (`isSupportedImageFile` is pure).
