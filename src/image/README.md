# src/image — Image Trace (RS-1008)

Converts a bitmap image (PNG/JPG/JPEG/WebP) into a `StoneLayout`, the same product every other
layer type (text/circle/rectangle/svg) produces, without modifying `src/geometry/**` or
`src/export/**` (forbidden by this milestone — see
`docs/specifications/RS-1008-ImageTrace.md`).

## Pipeline

```
Image bytes (File/Blob)
  -> ImageDecoder.decodeImageFileToBuffer()      [DOM-only: createImageBitmap + <canvas>]
  -> Grayscale.toGrayscale()                     [RGBA -> 0-255 luminosity, alpha onto white]
  -> Threshold.applyThreshold()                  [0-255 -> 0/1 binary mask]
  -> Invert.invertMask()                         [optional: flip 0/1]
  -> Blur.blurMask()                             [optional: 0/1 -> 0-255 density, separable box blur]
  -> Resize.resizeField()                        [optional: downscale-only, box-average, aspect-preserving]
  -> ImageStoneSampler.sampleImageFillPoints()   [grid-sample the mm placement box against the field]
  -> Stone[] / StoneLayout                        [src/geometry/index.js, imported unmodified]
```

`ImageTracePipeline.traceImageBufferToStoneLayout()` runs every step but the first (decode) and the
last (Stone/StoneLayout construction, using the real classes) and is the module's main entry
point.

Every file except `ImageDecoder.js` is pure — no DOM, Canvas, WebGL, or codec dependency — so it
runs identically under plain Node (`tools/test-image-pipeline.mjs`,
`tools/test-image-trace-pipeline.mjs`) and the browser. `ImageDecoder.js` isolates the one
unavoidable browser-only step (raster decode), matching
`src/browser/OpenTypeBrowserAdapter.js`'s existing "isolate the DOM-only glue" precedent;
`isSupportedImageFile()` inside it is still pure and Node-tested.

## Why this is not part of `src/geometry/**`

`docs/ARCHITECTURE.md`'s Final Rule favors the Geometry Engine as the single source of truth, but
this milestone's brief explicitly forbids editing `GeometryEngine.js`/`StoneLayout.js`/
`StoneSampler.js`. `src/image/**` is a peer input-processing module — exactly parallel to how
`src/svg/**` is a peer input-processing module for vector art — that only *imports* `Stone`/
`StoneLayout` from the permanent barrel, never redefines them. `ImageStoneSampler.js`'s grid-walk-
and-keep-if-on-mask shape deliberately mirrors `src/geometry/StoneSampler.js`'s
`sampleFillPoints()` grid-walk-and-keep-if-inside-polygon shape ("use the existing GeometryEngine
sampling principles"), implemented independently rather than by editing the forbidden files.

## Units

Every `*Mm` parameter/field is millimeters (the placement box, spacing). Every `*Px`
parameter/field is pixels (image/field dimensions, blur radius, resize bounds) — pixel values never
leak into a `Stone`/`StoneLayout`, which stay millimeter-only like every other layer type.

## Determinism

Identical `(imageBuffer, params)` always produce `deepEqual` `StoneLayout.toJSON()` output — no
randomness, no wall-clock/locale dependence. The only non-deterministic boundary is the browser's
own `createImageBitmap()` decode (upstream of every tested function here); re-decoding the exact
same source bytes produces the exact same pixel buffer.

## Public API (`index.js`)

* `createImageBuffer`, `createField` — pixel/field validation and wrapping.
* `toGrayscale`, `applyThreshold`, `invertMask`, `blurMask`, `resizeField` — individual pipeline
  stages, each independently testable.
* `sampleImageFillPoints` — the grid-sampling stage.
* `traceImageBufferToStoneLayout` — the full orchestrator; the one function `app.js` calls per
  regeneration.
* `maskFieldToRgba` — pure field-to-RGBA conversion for the "Preview before commit" panel.
* `SUPPORTED_IMAGE_MIME_TYPES`, `MAX_SOURCE_DIMENSION_PX`, `isSupportedImageFile`,
  `decodeImageFileToBuffer`, `readFileAsDataUrl`, `decodeDataUrlToBuffer` — the browser-only decode
  boundary (`isSupportedImageFile` is pure).
