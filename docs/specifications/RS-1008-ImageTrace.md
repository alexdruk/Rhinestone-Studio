# RS-1008 — Image Trace

## Objective

Let a user import a bitmap image (PNG/JPG/JPEG/WebP) and automatically convert it into an
editable rhinestone layer: grayscale → threshold → optional invert → optional blur → optional
resize → `StoneLayout`, using the same "one Geometry Engine product" mental model RS-1001 (SVG
import) already established for vector art, but for raster art. The resulting `image` layer is a
normal editable layer (move/resize/duplicate/hide/delete/undo/redo/save/load) and its stones flow
through every existing renderer/exporter unchanged.

## Current Repository State

* `docs/ARCHITECTURE.md`'s Core Principle diagram is `Project → Geometry Engine → StoneLayout →
  {2D, 3D, Exporters}`, with exactly one component (`src/geometry/GeometryEngine.js`) allowed to
  generate stone positions. RS-1001 extended this for vector art (`generateSvgLayout()`, added
  directly to `GeometryEngine.js`). **This milestone's brief explicitly forbids that approach for
  raster art** — `GeometryEngine.js`, `StoneLayout.js`, `src/export/**`, and
  `src/export/ProductionSheetExporter.js` are all forbidden files for RS-1008 (see "Forbidden
  Files"). Bitmap sampling is architecturally distinct enough from vector contour sampling
  (`StoneSampler.js` operates on polygons and even-odd point-in-polygon tests, not pixel grids)
  that a new, standalone pixel-grid sampler is the correct design, not a modification of the
  permanent engine — see "Architecture Requirements" for how this stays consistent with the single-
  source-of-truth principle without touching the forbidden files.
* `app.js` owns an ad hoc, non-`src/core` project/layer model. Existing non-text layer types
  (`circle`, `rectangle`, `svg`) share one generic x/y/w/h placement-box editing path
  (`getLayerBBox()`, drag-move, drag-resize, `duplicateLayer()`, `layerLabel()`,
  `writeSelectedControlsToLayer()`, `syncSelectedControlsFromLayer()`), each dispatched to its own
  `generate*StonesLive()` method on `app.js`'s local `GeometryEngine` bridge class inside
  `generate()`. A new `image` layer type follows the exact same pattern: it is placed by
  `x`/`y`/`w`/`h` (mm) like `rectangle`/`svg`, and is dispatched to a new
  `generateImageStonesLive()` method.
* No raster decoding exists anywhere in the repository. Decoding PNG/JPEG/WebP bytes into pixel
  data is not something this codebase can hand-roll the way `src/svg/**` hand-rolled an XML/path
  parser (full image codecs are large, and `AI_ENGINEER.md` disallows adding a dependency without
  material need) — the browser's own `createImageBitmap()` + `<canvas>` `getImageData()` already do
  this natively for all three required formats with zero new dependency. This is architecturally
  identical to `src/browser/OpenTypeBrowserAdapter.js`'s existing precedent: a small, DOM-only glue
  module isolates the one browser-only step (decode), while every pixel-processing/sampling
  algorithm downstream is plain, DOM-free, Node-testable code.
* `tools/**`'s test suite runs entirely under plain Node (no browser, no jsdom) — `docs/
  ARCHITECTURE.md`'s "Testing Philosophy". A DOM-dependent decode step is therefore not unit-
  testable under `npm test` the way pure pixel-array functions are; it is covered by real browser
  verification instead (matching how `OpenTypeBrowserAdapter.js` itself has no direct Node test).
* `docs/ARCHITECTURE.md`'s "Layers" section already documents `svg`/`manual` as "generic layer type
  slots" reserved on the unused `src/core/Layer.js` model; `image` was not anticipated there and is
  not added to `src/core/**` by this milestone either (that model remains unused by the live app,
  per the existing documented architectural limitation — out of scope to fix here).

## Expected Visible Change

* A new "Import Image..." control (next to "Import SVG") opens a file picker restricted to
  `image/png`, `image/jpeg`, `image/webp`.
* On selecting a supported file, a preview panel opens showing the live traced result (a
  black/white density preview, not individual stone circles — cheap to compute, immediately
  legible) plus Threshold / Invert / Blur radius / Maximum width / Maximum height controls and an
  approximate stone count. Adjusting any control live-updates the preview. "Import" commits a new
  `image` layer to the project at the last-previewed settings; "Cancel" discards the preview and
  changes nothing.
* After import, the layer behaves exactly like an SVG/rectangle layer: selectable, draggable
  (move), resizable via corner/edge handles, duplicable, hideable (visibility checkbox),
  deletable, and undoable/redoable. Its Threshold/Invert/Blur radius/Maximum width/Maximum height
  controls remain live-editable in the sidebar (an `#imageControls` panel, shown only when an
  `image` layer is selected, mirroring `#svgControls`), each regenerating stones on change.
* An unsupported file type (e.g. `.gif`, `.bmp`, `.svg`) is rejected before decoding with a specific
  `#status` message; no layer is added and the project is untouched.
* All five original export buttons and both Production Sheet exports include `image` layer stones
  automatically — they already read the one merged `StoneLayout`/canvas elements `app.js` produces;
  no exporter-specific code changes are needed or made.

## Required Outcome

### Pipeline (new `src/image/**` module, DOM-free except one decode file)

`Image bytes → decode → grayscale → threshold → optional invert → optional blur → optional resize
→ grid-sample onto the StoneLayout's mm placement box`, implemented as small, single-purpose, pure
functions operating on a plain pixel-buffer shape (`{ widthPx, heightPx, data }`), each independent
Node-testable with synthetic pixel data (no real image bytes required):

* `src/image/ImageBuffer.js` — `createImageBuffer({widthPx, heightPx, data})`: validates and wraps
  an RGBA `Uint8ClampedArray` (`data.length === widthPx*heightPx*4`).
* `src/image/Grayscale.js` — `toGrayscale(imageBuffer)`: luminosity grayscale
  (`0.299R + 0.587G + 0.114B`), alpha-composited onto a white background (fully transparent pixels
  become white/background, not black/foreground — a deliberate default so a PNG with a transparent
  background traces its visible artwork only). Returns a one-channel `{widthPx, heightPx, data:
  Uint8ClampedArray}` buffer.
* `src/image/Threshold.js` — `applyThreshold(grayscaleBuffer, thresholdValue = 128)`: binary mask,
  `1` (foreground/"trace this") for pixels darker than `thresholdValue`, `0` otherwise.
  `thresholdValue` must be an integer in `[0, 255]`.
* `src/image/Invert.js` — `invertMask(maskBuffer)`: flips `0`/`1`. Applied only when the layer's
  `invert` flag is true.
* `src/image/Blur.js` — `blurMask(maskBuffer, radiusPx = 0)`: a separable box blur (two linear-time
  passes via a sliding-window sum, not an `O(radius²)` nested loop, so it stays fast at the full
  2000×2000 working size) turning the binary mask into a `0-255` density field (smooths jagged
  edges before the final grid sample). `radiusPx = 0` is a no-op that only rescales `0/1` to
  `0/255`.
* `src/image/Resize.js` — `resizeField(field, maxWidthPx, maxHeightPx)`: aspect-ratio-preserving,
  downscale-only (never upscales) box-average resample so the field's largest dimension is at most
  `maxWidthPx`/`maxHeightPx`. This is the "Maximum width"/"Maximum height" pipeline stage — it
  bounds the pixel resolution the final grid-sampling step walks, independent of the layer's mm
  placement size (see "Architecture Requirements" for why these are different controls).
* `src/image/ImageStoneSampler.js` — `sampleImageFillPoints(field, {xMm, yMm, widthMm, heightMm,
  spacingMm})`: walks a regular mm grid across the requested placement box at `spacingMm` spacing
  (the exact grid-loop shape `src/geometry/StoneSampler.js`'s `sampleFillPoints()` already uses for
  vector fill — see "Architecture Requirements"), maps each grid point to the nearest pixel in
  `field`, and keeps the point when that pixel's value is `>= 128`. Returns `Point2D`-shaped
  `{xMm, yMm}` points, reusing `src/text/VectorPath.js`'s existing `Point2D` (an import, not a
  reimplementation).
* `src/image/ImageTracePipeline.js` — `traceImageBufferToStoneLayout(imageBuffer, params)`:
  orchestrates all of the above in the documented order and wraps the sampled points into
  `Stone`/`StoneLayout` instances imported unmodified from `src/geometry/index.js` (the same
  barrel `app.js` already imports `Stone`/`StoneLayout` from) — matching `generateSvgLayout()`'s
  exact "normalize params → sample points → `Stone[]` → `StoneLayout`" shape, without editing
  `GeometryEngine.js` itself. Params: `{ layerId, xMm, yMm, widthMm, heightMm, stoneSizeMm, gapMm,
  color, threshold, invert, blurRadiusPx, maxWidthPx, maxHeightPx }`. Deterministic: identical
  inputs always produce `deepEqual` `StoneLayout.toJSON()` output (no randomness, no wall-clock
  dependence).
* `src/image/ImagePreviewRender.js` — `maskFieldToRgba(field)`: pure `field → RGBA Uint8ClampedArray`
  conversion (grayscale value repeated across R/G/B, alpha 255) for the "Preview before commit"
  panel's `<canvas>` — `app.js` wraps the result in a real `ImageData`/`putImageData()` call (DOM
  work stays in `app.js`, matching `CanvasRenderer2D.js`'s existing "renderer draws, does not decide
  geometry" split, even though this preview is an editor-only overlay, not a permanent renderer).
* `src/image/ImageDecoder.js` — the one DOM-dependent file:
  * `SUPPORTED_IMAGE_MIME_TYPES` (`image/png`, `image/jpeg`, `image/webp`) and a pure,
    DOM-free `isSupportedImageFile({name, type})` helper (checks `type` first, falls back to a
    `.png`/`.jpg`/`.jpeg`/`.webp` extension check for files with an empty/incorrect MIME type) —
    kept pure specifically so it has a real Node unit test.
  * `decodeImageFileToBuffer(file)` (async, browser-only): `createImageBitmap(file)` → draw onto an
    offscreen `<canvas>` → `getImageData()` → `createImageBuffer(...)`. Throws a clear error for a
    file that fails to decode (corrupt bytes) or exceeds a documented maximum source dimension.
  * `readFileAsDataUrl(file)` (async, browser-only): wraps `FileReader` for producing the
    project-persisted `imageSrc` string (see "Persistence" below).
* `src/image/index.js` — barrel exporting the public API of all of the above (mirroring
  `src/svg/index.js`'s barrel pattern); `app.js` and every test import only from this file.
* `src/image/README.md` — module documentation (mirroring `src/svg/README.md`/`src/history/
  README.md`'s structure: purpose, pipeline stages, public API, determinism/testing notes).

### Persistence (`app.js` ad hoc project/layer model)

* New layer shape: `{id, type:'image', visible, imageSrc, imageName, naturalWidthPx,
  naturalHeightPx, x, y, w, h, threshold, invert, blurRadiusPx, maxWidthPx, maxHeightPx, stoneSize,
  gap, color}`. `imageSrc` is a `data:` URL (base64) of the original decoded source image — the
  exact same "the layer carries its own complete, self-contained source" shape `svgSource` already
  established for SVG layers — so Project JSON export/import round-trips an image layer with zero
  new exporter code, and undo/redo snapshots (already whole-project JSON clones) carry it for free.
* `SUPPORTED_LAYER_TYPES` gains `'image'`; `validateProject()` gains an `image` case requiring a
  non-empty `imageSrc` string and finite `x`/`y`/`w`/`h` (mirroring the existing `svg` case) plus
  finite `threshold`/`blurRadiusPx`/`maxWidthPx`/`maxHeightPx` and a boolean `invert`.
* A module-scope `Map` in `app.js` (`imageBufferCache`, keyed by the `imageSrc` string) memoizes the
  one-time async decode (`decodeImageFileToBuffer` is only ever called from the import panel, on
  the raw `File`; regeneration after that — every threshold/invert/blur/resize edit, every undo/
  redo, every duplicate — decodes the already-known `imageSrc` `data:` URL through `createImageBitmap`
  once per distinct `imageSrc` value and reuses the cached pixel buffer for the pure, synchronous
  pipeline stages). This keeps live slider edits fast (only `Grayscale`→`Resize` re-run, not image
  decode) without adding an eviction/size-limit policy — out of scope for this milestone's size (see
  "Out of Scope").

### `app.js` wiring

* `GeometryEngine.generateImageStonesLive(layer)` (new method on the existing local bridge class,
  mirroring `generateSvgStonesLive()`): resolves/caches the decoded buffer for `layer.imageSrc`,
  calls `traceImageBufferToStoneLayout()`, and maps the result the same way every other
  `generate*StonesLive()` method already does (`{x,y,d,color,layerId}`). Dispatched from
  `generate()` alongside the existing `text`/`circle`/`rectangle`/`svg` dispatch.
* `getLayerBBox()`, drag-move, drag-resize, `writeSelectedControlsToLayer()`,
  `syncSelectedControlsFromLayer()`, `duplicateLayer()`, `layerLabel()` gain an `'image'` case,
  reusing the exact `x`/`y`/`w`/`h` fields and `#shapeX`/`#shapeY`/`#shapeW`/`#shapeH` inputs
  `rectangle`/`svg` already share.
* A new "Import Image..." button + hidden file input opens the preview panel described above. The
  panel's own Threshold/Invert/Blur radius/Maximum width/Maximum height controls drive a live
  preview canvas (recomputed synchronously on each control change — the pipeline is linear-time and
  the working resolution is capped by Maximum width/height, so this stays responsive; see
  "Performance"). "Import" commits the layer via the same `commitHistory()` → mutate → `updateAll()`
  pattern every other add-layer action already uses.
* `HISTORY_TRACKED_CONTROL_IDS` gains the sidebar `#imageControls` field ids (`imgThreshold`,
  `imgInvert`, `imgBlurRadius`, `imgMaxWidth`, `imgMaxHeight`) so post-commit edits coalesce into one
  undo step per edit session, exactly like every other continuous control.
* `index.html` gains the "Import Image..." button, its hidden file input (`accept="image/png,
  image/jpeg,image/webp"`), the preview panel (`#imageImportPanel`, hidden by default), and the
  post-commit `#imageControls` sidebar section (hidden unless an `image` layer is selected).

## Architecture Requirements

* **Why the bitmap sampler is new code, not a `StoneSampler.js` extension.** `docs/ARCHITECTURE.md`'s
  Final Rule is "if there's ever a choice between a simpler renderer and preserving the Geometry
  Engine as the single source of truth, the Geometry Engine wins" — but this milestone's own brief
  explicitly forbids touching `GeometryEngine.js`/`StoneLayout.js`. The two are reconciled the same
  way `src/svg/**` reconciled "no dependency on `src/geometry/**` running the other direction" for
  RS-1001: `src/image/**` is a peer input-processing module (bitmap pixels → grid-sampled points),
  exactly parallel to how `src/svg/**` is a peer input-processing module (vector XML → contours).
  Neither module invents a `Stone`/`StoneLayout` shape of its own — both import and construct the
  real `Stone`/`StoneLayout` classes unmodified. `sampleImageFillPoints()`'s grid-walk-and-keep-if-
  inside shape is deliberately the same mental model as `StoneSampler.js`'s `sampleFillPoints()`
  (fixed spacing grid over a bounding box, keep points satisfying a containment test) — "inside a
  polygon" becomes "at/above the mask threshold" — this is the "use the existing GeometryEngine
  sampling principles" requirement from the milestone brief, satisfied by parallel implementation
  rather than by editing the forbidden files.
* **Why "Maximum width/height" are pixel controls on the bitmap, not mm controls on the layer.**
  The layer's physical output size in mm is already a first-class, generically-editable field
  (`x`/`y`/`w`/`h`, identical to `rectangle`/`svg` — drag-move, drag-resize, numeric inputs). The
  milestone brief's Controls list separately requires "Maximum width"/"Maximum height" alongside
  Threshold/Invert/Blur radius, which are all bitmap-processing parameters, and the brief's
  Performance section frames the concern explicitly in pixels ("images up to 2000×2000 px"). Reading
  "Maximum width/height" as the pixel cap for the pipeline's "Optional resize" stage keeps every
  Controls-list item operating on the same bitmap-processing stage, and keeps the mm placement box a
  single, unambiguous, already-existing concept.
* **"Stone spacing" reuses the existing shared Stone size + Gap controls**, not a new field. Every
  other layer type already derives its sampling grid spacing as `stoneSizeMm + gapMm` from the
  sidebar's shared `#stoneSize`/`#gap` controls; an `image` layer does the same
  (`traceImageBufferToStoneLayout()`'s `spacingMm` parameter). Adding a second, redundant spacing
  control would duplicate an existing concept the milestone brief also says to avoid ("Do not
  introduce a second geometry pipeline").
* `src/image/**`'s pixel-processing modules (`ImageBuffer.js` through `ImageTracePipeline.js`,
  `ImagePreviewRender.js`) have zero dependency on the DOM, Canvas, WebGL, `src/renderer/**`, or
  `src/export/**` — pure typed-array math, so they run identically under plain Node (tests) and the
  browser. Only `ImageDecoder.js`'s two async functions touch `document`/`createImageBitmap`/
  `FileReader` — isolated in one file, matching `src/browser/OpenTypeBrowserAdapter.js`'s existing
  "isolate the one unavoidable browser-only step" precedent.
* `src/geometry/GeometryEngine.js`, `src/geometry/StoneLayout.js`, `src/geometry/Stone.js`,
  `src/geometry/StoneSampler.js`, `src/geometry/ContourGeometry.js`, `src/export/**` are untouched.
  `src/image/**` only imports `Stone`/`StoneLayout` from `src/geometry/index.js` (the public
  barrel) and `Point2D` from `src/text/VectorPath.js` (the same neutral primitive `src/svg/**`
  already imports) — read-only reuse, not modification.
* No new runtime dependency for the pipeline itself (`createImageBitmap`/`Canvas 2D`/`FileReader`
  are browser-native). A temporary, `--no-save` dev-only `puppeteer-core` install for browser
  verification only (matching RS-1006/RS-1006A/RS-1007's own precedent) leaves `package.json`/
  `package-lock.json` unchanged after uninstall.

## Allowed Files

* `src/image/**` (new)
* `app.js`, `index.html`
* `tools/**` (new tests; narrow updates to existing guard assertions — see below)
* `package.json` (wire new test files into the `test` script)
* `docs/specifications/**`, `docs/ARCHITECTURE.md`
* `TASK.md`, `TASK_RESULT.md`

## Forbidden Files

* `src/geometry/**` (`GeometryEngine.js`, `StoneLayout.js`, `Stone.js`, `StoneSampler.js`,
  `ContourGeometry.js`, `ArcProjection.js`, `README.md`, `index.js`)
* `src/export/**` (`SvgExporter.js`, `ProductionSheetExporter.js`, `PdfDocument.js`)
* `src/text/**`, `src/fonts/**`, `src/core/**`, `src/browser/**`, `src/renderer/**`,
  `src/preview3d/**`, `src/svg/**`, `src/history/**`, `src/products/**`
* `assets/**`, `examples/**`
* `style.css`, `README.md`, `LICENSE`, `CONTRIBUTING.md`
* `node_modules/**`

## Out of Scope

* AI tracing, color separation, edge detection, vectorization, OCR, background removal,
  multi-color conversion (per the milestone brief's explicit out-of-scope list).
* Any image format beyond PNG/JPG/JPEG/WebP (e.g. GIF, BMP, TIFF, AVIF, HEIC).
* A dedicated "Stone spacing" control distinct from the existing shared Stone size + Gap controls
  (see "Architecture Requirements").
* Per-layer rotation (no existing layer type in the live UI has it either — RS-1001's own
  documented scope decision, unchanged here).
* An image-buffer cache eviction/size-limit policy (`imageBufferCache` in `app.js` grows for the
  life of the page session; acceptable for this milestone's scope, flagged as a known limitation).
* Web Worker / off-main-thread processing. The pipeline is kept fast enough (linear-time blur,
  resolution-capped grid sampling) to avoid a *frozen* UI for the target 2000×2000 size without
  needing a worker; it does still run synchronously on the main thread, a documented limitation (see
  "Known Limitations").
* Migrating `app.js`'s ad hoc project/layer model onto `src/core/Project.js`/`Layer.js`.
* S-004 (duplicated text in 3D preview) — not touched, and this milestone's changes do not run
  through `src/preview3d/**` in any new way that could expose or mask it.

## Required Automated Tests

New `tools/test-image-pipeline.mjs` (unit tests against `src/image/**` directly, synthetic pixel
buffers, no browser, no decode):

1. `createImageBuffer()` validates dimensions and data length; rejects a mismatched buffer length.
2. `toGrayscale()` on a known 2×2 RGBA buffer (one pure-black, one pure-white, one pure-red, one
   fully-transparent pixel) produces the expected luminosity values, and the transparent pixel
   resolves to white (background), not black.
3. `applyThreshold()` at a known threshold correctly classifies pixels darker/lighter than the
   threshold as foreground/background; boundary value (`gray === thresholdValue`) behavior is
   pinned down explicitly.
4. `invertMask()` flips every value; inverting twice returns the original mask (`deepEqual`).
5. `blurMask()` with `radiusPx = 0` is a pure `0/1 → 0/255` rescale (no smoothing); with
   `radiusPx > 0`, an isolated single foreground pixel produces a smoothed density bump around it
   (values strictly between 0 and 255 at its neighbors) rather than a hard edge; blurring a
   uniform all-foreground or all-background field leaves it uniform.
6. `resizeField()` never upscales (a field already smaller than `maxWidthPx`/`maxHeightPx` is
   unchanged); a field larger than the max is downsized preserving aspect ratio, with the larger
   dimension landing exactly at its max.
7. `sampleImageFillPoints()` on a fully-foreground field returns a regular grid at the requested
   spacing across the full placement box; on a fully-background field returns zero points; on a
   half-foreground/half-background split field returns points only on the foreground half.
8. `isSupportedImageFile()` accepts `image/png`/`image/jpeg`/`image/webp` MIME types and rejects
   others (e.g. `image/gif`, `image/svg+xml`, empty string with a non-matching extension), including
   the extension-fallback path for a file with an empty `type`.
9. Determinism: `toGrayscale`→`applyThreshold`→`blurMask`→`resizeField` run twice on identical input
   produce `deepEqual` output.

Extend/add `tools/test-image-trace-pipeline.mjs` (integration of the whole pipeline via
`traceImageBufferToStoneLayout()`, synthetic buffers, no browser):

10. A synthetic checkerboard/shape buffer traces to a non-empty `StoneLayout` whose stones fall only
    over the foreground region (spot-checked against the known synthetic pattern).
11. `invert: true` flips which half of a half/half synthetic buffer produces stones.
12. Increasing `threshold` (a lighter cutoff) increases the traced foreground area/stone count for a
    grayscale-gradient synthetic buffer (monotonicity check, not exact-count).
13. `blurRadiusPx > 0` measurably changes the traced point set at a sharp edge versus `blurRadiusPx
    = 0` (softens the boundary) without crashing or producing non-finite coordinates.
14. `maxWidthPx`/`maxHeightPx` bound the internal working resolution (verified by constructing a
    large synthetic buffer and a small one, both producing a plausible/comparable stone density for
    the same placement box — proves resize is actually applied, not a no-op).
15. Requested `xMm`/`yMm`/`widthMm`/`heightMm` correctly places/scales the resulting bounding box.
16. Every stone carries the requested `layerId`/`color`; `sizeMm` equals the requested
    `stoneSizeMm`; all coordinates are finite millimeters.
17. Determinism: two calls with identical params produce `deepEqual` `StoneLayout.toJSON()`.
18. Malformed params (missing `layerId`, non-positive `stoneSizeMm`, out-of-range `threshold`,
    negative `blurRadiusPx`, non-positive `maxWidthPx`/`maxHeightPx`) each throw a clear,
    parameter-naming error.
19. An all-background (nothing darker than threshold) buffer produces a valid, empty `StoneLayout`
    (not an error).

New `tools/test-image-integration.mjs` (structural, mirroring `tools/test-svg-integration.mjs`):

1. `app.js`'s `generate()` routes `image` layers through a live method that calls
   `traceImageBufferToStoneLayout` (imported from `src/image/index.js`).
2. `getLayerBBox()`/drag-move/drag-resize/`duplicateLayer()`/`layerLabel()` each have an `'image'`
   case.
3. `validateProject()` accepts a valid `image` layer and rejects one missing `imageSrc`, and one
   with an out-of-range `threshold`.
4. `index.html` exposes `#importImage`, `#importImageFile`, `#imageImportPanel`, and
   `#imageControls` with the documented control ids.
5. `SUPPORTED_LAYER_TYPES` includes `'image'`.
6. `HISTORY_TRACKED_CONTROL_IDS` includes the post-commit `#imageControls` field ids.
7. No forbidden file changed (this milestone's own forbidden list).

Update existing guard assertions (narrow, surgical, matching prior-milestone precedent):

* `tools/test-app-module-migration.mjs`: add the new `from\s*['"]\.\/src\/image\/index\.js['"]`
  import line to its allow-list (mirroring the `src/svg/index.js` entry RS-1001 already added).
* `tools/test-examples-regression.mjs`: this milestone does not add example `.rhs` fixtures and
  does not change any file that suite already forbids or allows — verify (not modify) that its
  existing forbidden set already covers `app.js`/`index.html` correctly for this milestone; update
  only if a real conflict is found, and document it here if so.

Run the full suite (`npm test`) and confirm every pre-existing suite still passes with only the
enumerated guard updates changed.

## Required Browser Verification

Run `npm run dev` and drive `http://localhost:5173/` with a temporary, `--no-save` `puppeteer-core`
install driving `Google Chrome.app` headlessly over CDP (matching the established project
precedent — no permanent new dependency):

* [ ] Page loads, no console errors on load.
* [ ] Default project (text only) still renders correctly (regression check).
* [ ] Importing a small synthetic PNG (generated in-session, e.g. a black shape on white) opens the
      preview panel, shows a plausible live preview, and "Import" adds a new layer whose stones
      render in the 2D layout and the 3D preview.
* [ ] Importing a JPEG and a WebP (both generated in-session by re-encoding the same source via an
      offscreen canvas `toBlob()`) both succeed end-to-end.
* [ ] Adjusting Threshold/Invert/Blur radius/Maximum width/Maximum height in the preview panel
      visibly changes the live preview before Import.
* [ ] "Cancel" in the preview panel adds no layer and leaves the project unchanged.
* [ ] Importing an unsupported file (e.g. renamed `.txt` or a `.gif`) is rejected with a specific
      `#status` message; no layer added, no crash.
* [ ] After import, adjusting the committed layer's Threshold/Invert/Blur radius/Maximum
      width/Maximum height in `#imageControls` live-regenerates stones.
* [ ] Selecting the image layer and dragging it moves its stones live; dragging a resize handle
      resizes its stones live.
* [ ] Duplicating the image layer produces a second, offset copy with its own stones.
* [ ] Toggling visibility removes/restores its stones; deleting removes them.
* [ ] Undo/redo correctly steps through image-layer add/edit/delete operations.
* [ ] A ~1500×1500px synthetic source image imports without the page becoming unresponsive
      (measured: interaction remains possible during/after processing); actual wall-clock timing
      recorded in `TASK_RESULT.md`.
* [ ] Export Project JSON, Export Generated Layout JSON, Export 2D SVG, Export 2D PNG, Export Cup
      PNG, and both Production Sheet exports all succeed and reflect the image layer's stones.
* [ ] Re-importing the exported Project JSON restores the image layer correctly (round trip),
      including its `imageSrc`/threshold/invert/blur/resize settings.
* [ ] 3D preview renders the image layer's stones without error.
* [ ] No uncaught exception / unhandled rejection during any of the above; zero relevant console
      errors.

Record actual observed stone counts/bounds, timing, and screenshots in `TASK_RESULT.md`. Do not
claim unperformed interactive checks as passing.

## Acceptance Criteria

* `npm test` passes, including the new image pipeline/trace/integration suites.
* Importing a supported bitmap image produces a correctly placed, deterministic `StoneLayout`
  visible in the 2D layout and 3D preview, and present in every export format, without modifying
  `GeometryEngine`, `StoneLayout`, or any exporter.
* Unsupported formats are rejected with a clear, specific error; the current project is never
  corrupted by a failed import.
* An `image` layer supports move/resize/duplicate/hide/delete/undo/redo/save-load exactly like
  existing non-text layers.
* No forbidden file changed.
* `TASK_RESULT.md` accurately reports what was verified vs. not, including actual timing for the
  large-image performance check.

## Implementation Constraints

* Smallest coherent change: reuse `Stone`/`StoneLayout`/`Point2D` as-is; no parallel
  `Stone`/`StoneLayout` schema.
* Preserve millimeters throughout the mm-facing API surface (`xMm`/`yMm`/`widthMm`/`heightMm`/
  `spacingMm`); pixel-space values are always explicitly named `...Px`.
* Preserve deterministic output (no randomness; the only non-determinism boundary is the browser's
  own image decode, which is upstream of every pure/tested function).
* Do not add a bundler, framework, or new production dependency.
* Do not change `Stone`/`StoneLayout`/export schemas.

## Required Commands

```bash
npm test
git diff --check
git status
npm run dev
```

## Commit Message

```
feat(image): trace bitmap images (PNG/JPG/WebP) into an editable rhinestone layer
```

## Deliverables

* New `src/image/**` (`ImageBuffer.js`, `Grayscale.js`, `Threshold.js`, `Invert.js`, `Blur.js`,
  `Resize.js`, `ImageStoneSampler.js`, `ImageTracePipeline.js`, `ImagePreviewRender.js`,
  `ImageDecoder.js`, `index.js`, `README.md`).
* Updated `app.js`, `index.html` (image layer type, import UI/preview panel, `#imageControls`).
* `tools/test-image-pipeline.mjs`, `tools/test-image-trace-pipeline.mjs`,
  `tools/test-image-integration.mjs` (new); narrow update to
  `tools/test-app-module-migration.mjs`; `package.json` test script.
* This specification, `TASK.md`, `TASK_RESULT.md`, `docs/ARCHITECTURE.md` update.

## Next Milestone

Candidates: Web Worker-based off-main-thread image processing (removes the documented synchronous-
main-thread limitation), an image-buffer cache eviction policy, migrating `app.js`'s ad hoc project/
layer objects onto `src/core/Project.js`/`Layer.js`, DXF export, investigating S-004.
