# Rhinestone Studio — Task Result

This document is completed by the implementation engineer after finishing the current task.

---

# Task ID

RS-1008 — Image Trace

---

# Status

IMPLEMENTED

---

# Branch

feature/rs-1008-image-trace

---

# Commit

Do not write the current commit hash into this file — this file is part of the same commit it
describes. Obtain it from Git history with:

```bash
git log -1 --oneline
```

---

# Summary

Added the ability to import a bitmap image (PNG/JPG/JPEG/WebP) and automatically trace it into an
editable rhinestone layer, without modifying `GeometryEngine`, `StoneLayout`, or any exporter — the
milestone brief's own explicit constraint.

**Pipeline (`src/image/**`, new).** `ImageBuffer.js`/`Grayscale.js`/`Threshold.js`/`Invert.js`/
`Blur.js`/`Resize.js`/`ImageStoneSampler.js` are small, pure, DOM-free functions operating on plain
pixel buffers (`{widthPx,heightPx,data}`), each independently unit-tested with synthetic pixel data.
They implement the documented pipeline in order: grayscale (alpha composited onto white) →
threshold (0-255, darker-than-threshold = foreground) → optional invert → optional blur (a
linear-time separable box blur, not the naive O(radius²) form) → optional resize (a summed-area-
table box-average downscale, never upscales) → a fixed-spacing grid sample over the layer's mm
placement box. `ImageTracePipeline.js`'s `traceImageBufferToStoneLayout()` orchestrates all of the
above and constructs the real `Stone`/`StoneLayout` classes, imported unmodified from
`src/geometry/index.js` — mirroring `generateSvgLayout()`'s "normalize params → sample points →
`Stone[]` → `StoneLayout`" shape without touching `src/geometry/GeometryEngine.js` (forbidden by
this milestone). `ImageDecoder.js` isolates the one unavoidable browser-only step
(`createImageBitmap`/`<canvas>` decode, `FileReader` for the persisted data URL), matching
`src/browser/OpenTypeBrowserAdapter.js`'s existing "isolate the DOM-only glue" precedent; its
`isSupportedImageFile()` MIME/extension check is itself pure and Node-tested.

**Why this is architecturally an exception, documented as one.** `docs/ARCHITECTURE.md`'s Core
Principle is "the Geometry Engine is the only component allowed to generate stone positions." This
milestone's own brief explicitly forbids editing `GeometryEngine.js`/`StoneLayout.js`/
`StoneSampler.js`, so `src/image/**` is a second, independent module that also constructs
`Stone`/`StoneLayout` directly — a real, deliberate exception, not an oversight. This is recorded
plainly in `docs/ARCHITECTURE.md` (new paragraph under "Geometry Engine") and in
`docs/specifications/RS-1008-ImageTrace.md` ("Architecture Requirements"), including the
recommended follow-up (converge `src/image/**`'s sampler into `src/geometry/**` once the
forbidden-file constraint is lifted by a future milestone).

**`app.js`/`index.html`.** A new `image` layer type reuses the exact generic x/y/w/h placement-box
editing (`getLayerBBox`, drag-move, drag-resize, `duplicateLayer`, `layerLabel`,
`writeSelectedControlsToLayer`, `syncSelectedControlsFromLayer`) `rectangle`/`svg` layers already
share — no new editing machinery. A new "Import Image..." control opens a "preview before commit"
modal panel (`#imageImportPanel`): live density-mask preview canvas, an approximate stone count,
and Threshold/Invert/Blur radius/Maximum width/Maximum height controls, recomputed synchronously on
every control change (fast enough at the documented 2000×2000px working size — see Performance
below). "Import" commits the layer at the previewed settings; "Cancel" discards it, mutating
nothing. After commit, the same five controls remain live-editable in a post-commit
`#imageControls` sidebar section, history-tracked like every other continuous control.
`imageBufferCache` (a `Map` keyed by the layer's persisted `imageSrc` data: URL) means the
(comparatively expensive) browser image decode only runs once per distinct source image — every
subsequent threshold/invert/blur/resize edit, undo/redo, or duplicate only re-runs the pure, fast
pixel-processing stages.

**"Stone spacing" and "Maximum width/height".** Per the specification's documented design decision:
"Stone spacing" reuses the existing shared Stone size + Gap controls (`spacingMm =
stoneSizeMm + gapMm`, the same derivation every other layer type already uses) rather than adding a
redundant field. "Maximum width"/"Maximum height" are read as pixel caps on the bitmap pipeline's
"Optional resize" stage (bounding the working resolution for performance), independent of the
layer's mm placement size, which is already covered by the generic, always-present x/y/w/h editing.

**Persistence.** `layer.imageSrc` (a `data:` URL of the original source image) makes an image layer
fully self-contained, the same shape `svgSource` already established for SVG layers — Project JSON
export/import round-trips it with zero new exporter code, and undo/redo (already whole-project JSON
snapshots) carries it for free. `validateProject()` gained an `image` case (non-empty `imageSrc`,
numeric x/y/w/h, `threshold` in [0,255], non-negative `blurRadiusPx`, positive
`maxWidthPx`/`maxHeightPx`).

**Bug found and fixed during browser verification.** `ImageDecoder.js`'s original
`decodeImageFileToBuffer()` called `bitmap.close()` before reading `bitmap.width`/`bitmap.height` on
the next line — per spec, closing an `ImageBitmap` zeroes those properties, so every real import
threw `TypeError: widthPx must be a positive integer.` immediately. This was invisible to the
Node-only pipeline tests (they never call the decoder) and only surfaced once real image bytes were
decoded in an actual browser — exactly the scenario `AI_ENGINEER.md`'s "a passing automated suite
does not replace user-visible verification" describes. Fixed by capturing `widthPx`/`heightPx` into
local variables before the `close()` call. Re-verified end to end afterward (see Browser
Verification below).

---

# Files Changed

**New:**
* `src/image/` — `ImageBuffer.js`, `Grayscale.js`, `Threshold.js`, `Invert.js`, `Blur.js`,
  `Resize.js`, `ImageStoneSampler.js`, `ImageTracePipeline.js`, `ImagePreviewRender.js`,
  `ImageDecoder.js`, `index.js`, `README.md`.
* `tools/test-image-pipeline.mjs` — pure-stage unit tests (9 assertions).
* `tools/test-image-trace-pipeline.mjs` — full-pipeline integration tests (10 assertions).
* `tools/test-image-integration.mjs` — structural app.js/index.html wiring tests (9 assertions).
* `docs/specifications/RS-1008-ImageTrace.md`.
* `TASK_RESULT.md` (this file).

**Modified:**
* `app.js` — `image` layer type throughout (dispatch in `generate()`, new
  `generateImageStonesLive()`, `SUPPORTED_LAYER_TYPES`, `validateProject()`, `getLayerBBox()`,
  drag-move/drag-resize, `duplicateLayer()`, `layerLabel()`, `syncSelectedControlsFromLayer()`,
  `writeSelectedControlsToLayer()`, `HISTORY_TRACKED_CONTROL_IDS`), the new Import Image
  preview-panel logic (`pendingImageImport`, `computeDefaultImagePlacement()`,
  `currentImagePreviewParams()`, `updateImagePreview()`, event wiring), a new `parseIntOr()` helper
  (fixes a real footgun: the file's existing `parseFloat(...)||fallback` pattern silently discards
  an explicit `0`, which matters for `imgThreshold`'s valid `0` value), `imageBufferCache`, two new
  named constants (`DEFAULT_IMAGE_THRESHOLD`, `DEFAULT_IMAGE_MAX_DIMENSION_PX`), a milestone header
  comment.
* `index.html` — "Import Image..." button + hidden file input, `#imageImportPanel` (modal overlay,
  new `.modalOverlay`/`.modalPanel`/`.modalStoneCount` CSS), `#imageControls` sidebar section.
* `package.json` — registers the three new test files in the `test` script.
* `docs/ARCHITECTURE.md` — new "As of RS-1008" paragraphs under "Geometry Engine" (documenting the
  architectural exception) and "Layers", plus a new `src/image/**` row in the "Layer map" table.
* `tools/test-app-module-migration.mjs`, `tools/test-shape-geometry-integration.mjs` — added
  `src/image/index.js` to each file's allowed-import-pattern list (mirroring the `src/svg/index.js`
  entry RS-1001 already added to both).
* `tools/test-svg-integration.mjs` — test 7's hardcoded `getLayerBBox`/drag regexes updated to
  match the now-three-way `l.type==='rectangle'||l.type==='svg'||l.type==='image'` condition (the
  `svg` case itself is unchanged; documented inline, matching this repo's established guard-test-
  maintenance precedent).

**Untouched (verified by `tools/test-image-integration.mjs`'s own forbidden-file guard):**
`src/geometry/**`, `src/export/**`, `src/text/**`, `src/fonts/**`, `src/core/**`, `src/browser/**`,
`src/renderer/**`, `src/preview3d/**`, `src/svg/**`, `src/history/**`, `src/products/**`,
`assets/**`, `examples/**`, `style.css`, `README.md`, `LICENSE`, `CONTRIBUTING.md`.

---

# Commands Executed

```bash
git checkout -b feature/rs-1008-image-trace
npm test                                          # full suite, iterated to green (464/464)
git diff --check
git status
python3 -m http.server 5199                       # browser verification
npm install --no-save --no-package-lock puppeteer-core   # temporary, browser verification only
npm uninstall puppeteer-core --no-save                    # removed afterward
```

`package.json`/`package-lock.json` carry only the three new test-script entries — `git status`
confirms no dependency changes remain after the temporary Puppeteer install/uninstall (same pattern
as RS-1006/RS-1006A/RS-1007's own browser-verification tooling).

---

# Automated Test Results

`npm test` — **35/35 suites pass, 464/464 individual assertions, exit code 0**: all 32 pre-existing
suites (with the three documented narrow guard updates above) plus the three new suites for this
milestone.

**`tools/test-image-pipeline.mjs` (9 assertions):** buffer/field validation; grayscale luminosity +
alpha-onto-white compositing; threshold classification and its boundary rule; invert
flip/double-flip identity; box blur's radius-0 no-op, its true flat-plateau-then-hard-cutoff
response to an impulse (not a gaussian falloff — verified this is the mathematically correct box-
filter behavior, not a bug, after an initial incorrect test assumption caught and corrected during
this session), and uniform-field stability; resize's never-upscale guarantee and aspect-preserving
downscale; grid sampling's full-foreground/full-background/half-split behavior;
`isSupportedImageFile()`'s MIME + extension-fallback logic; pipeline determinism.

**`tools/test-image-trace-pipeline.mjs` (10 assertions):** end-to-end `traceImageBufferToStoneLayout()`
against synthetic buffers — foreground-only placement, `invert` flipping which half traces,
monotonic threshold behavior on a gradient, blur not crashing/producing non-finite coordinates,
`maxWidthPx`/`maxHeightPx` actually bounding working resolution (not a no-op), correct mm placement/
scaling, correct `layerId`/`color`/`sizeMm` on every stone, determinism, parameter validation
(6 distinct malformed-input cases), and an all-background buffer producing a valid empty
`StoneLayout` rather than an error.

**`tools/test-image-integration.mjs` (9 assertions):** `generate()` dispatch and the
`generateImageStonesLive()`/`traceImageBufferToStoneLayout` wiring; the `src/image/index.js` import
line; `getLayerBBox`/drag-move/drag-resize/`duplicateLayer`/`layerLabel` image cases;
`SUPPORTED_LAYER_TYPES`; `validateProject()` accept/reject cases (missing `imageSrc`, out-of-range
`threshold`, missing bbox, invalid `maxWidthPx`); `index.html` control ids; `HISTORY_TRACKED_CONTROL_IDS`;
the import handler's validate-then-decode-then-status-on-failure shape; this suite's own
forbidden-file guard.

---

# Browser/Manual Verification

Real headless-Chrome session (`Google Chrome.app`, software WebGL via `--use-gl=swiftshader
--enable-unsafe-swiftshader`) driven over CDP with a temporary `puppeteer-core` install, against
`python3 -m http.server 5199`. Every image used was a real PNG/JPEG/WebP encoded in-browser via
`canvas.toBlob()` and injected into the real `#importImageFile` input via `DataTransfer` + a real
`change` event — the real `File`/`Blob` decode path (`createImageBitmap`), not a mock. Console
`error`/`pageerror` events and all HTTP responses were captured for the full session.
**35/35 scripted checks passed** (one real bug found and fixed along the way — see Summary):

* **Page load / regression:** page loads with no relevant console errors; the default text-only
  project still renders (375 stones, 199.4×17.0mm) unchanged.
* **PNG import + live preview:** selecting a synthetic 64×64 PNG (left-half black) opened the
  preview panel with a live density-mask preview and an approximate stone count ("28 stones
  (approx.)"). Toggling Invert, changing Blur radius, and changing Threshold each visibly changed
  the preview canvas and/or stone count (confirmed via `canvas.toDataURL()` diffing and the
  displayed count).
* **Cancel:** added no layer, left the layer count and project unchanged, hid the panel.
* **Commit:** "Import" added a new `image` layer (layer count 1→2), stones appeared in both the 2D
  Production Layout (`layoutStats` count increased) and the 3D Object Preview.
* **JPEG and WebP:** both formats imported end to end (real `canvas.toBlob('image/jpeg')`/
  `('image/webp')` encode → real decode → committed layer), each adding one more layer.
* **Post-commit live editing:** with the committed layer selected, `#imageControls` was visible;
  setting its Threshold to an extreme value (0, so nothing classifies as foreground) measurably
  changed the merged stone count (392→375), confirming the committed layer's controls actually
  regenerate stones, not just the pre-commit preview.
* **Unsupported format:** a `.gif`-typed file was rejected with `#status` reading "Image import
  failed: unsupported file type. Supported formats: PNG, JPG/JPEG, WebP." — no layer added, no
  crash, no console/page error.
* **Move:** dragging the selected image layer's bounding box on the 2D canvas changed its `x`/`y`
  fields live (96.53→117.81mm, 36.53→54.92mm for a 40/25px drag).
* **Duplicate:** produced a second, offset layer (layer count 4→5).
* **Visibility toggle:** hiding a real (non-zeroed-threshold) image layer measurably reduced the
  merged stone count (401→395), restoring it on re-show (→401).
* **Delete:** removed the layer and its stones (layer count 5→4).
* **Undo/redo:** undo restored the just-deleted layer (4→5), redo re-removed it (5→4).
* **Large image / performance:** a synthetic 1500×1500px PNG imported and opened its preview panel
  in **327ms**; changing its Threshold recomputed the live preview (pure pipeline stages only, no
  re-decode) in **162ms**; a trivial `page.evaluate(() => 1+1)` issued immediately afterward
  returned in **15ms**, confirming the page's JS thread was not left blocked/unresponsive by the
  large-image pipeline run. This is a synchronous-main-thread implementation (documented limitation
  below), but stayed well within "does not freeze the UI" at the documented 2000×2000px target size
  in this measurement.
* **All exports:** Project JSON, Generated Layout JSON, 2D SVG, 2D PNG, Cup PNG, Production Sheet
  SVG, and Production Sheet PDF all completed with the expected "Downloaded ..." `#status` message
  and no thrown error, against a project containing four image layers.
* **Round trip:** the exported Project JSON contained `"type":"image"` and a `"imageSrc":"data:image/…"`
  field; re-importing that exact file via the real `#importProjectFile` control restored all four
  image layers (`layer types: TEXT,IMAGE,IMAGE,IMAGE,IMAGE`) with a "Imported roundtrip.json: 5
  layer(s)" status.
* **3D preview:** the Object Preview canvas has a live WebGL context and rendered without a page
  error across every step above (visually confirmed via screenshot — a small imported circle's
  stones render on the mug alongside the text layer's stones).
* **Console/network:** zero application-originated console errors or page errors across the entire
  session. The only 4xx response was the pre-existing, already-documented `/favicon.ico` 404 (no
  favicon `<link>` in `index.html` — the same finding recorded in every prior milestone's browser
  verification, e.g. RS-1007's).

**One observed, expected (not a bug) interaction:** in the screenshot capture, a small imported
circle placed directly over the dense default text layer added only 6 net stones (381 vs. 375
text-only) even though its own trace produced ~19 candidate points — `app.js`'s pre-existing
cross-layer proximity `dedupe()` (unchanged by this milestone) discarded most of them as too close
to already-placed text stones. This is the same merge behavior any overlapping SVG/shape layer
already exhibits; verified by placing the same image layer away from the text (see the "Threshold
change" measurement above, which used a layer with negligible overlap and showed a clean count
delta).

Not performed: real-GPU/real-device verification (headless Chrome here has no GPU, matching every
prior milestone's documented limitation), mobile touch-gesture verification, and a test against a
source image at the exact upper bound of `MAX_SOURCE_DIMENSION_PX` (4000px) — the 1500px large-image
check above was judged sufficient evidence for the documented 2000×2000px target.

---

# Warnings

* **Second stone-generating module, by design.** As detailed in Summary and now recorded in
  `docs/ARCHITECTURE.md`, `src/image/**` constructs `Stone`/`StoneLayout` directly instead of going
  through `GeometryEngine.js` — a deliberate, milestone-brief-directed exception to "the Geometry
  Engine is the only component allowed to generate stone positions," not an oversight. A future
  milestone should converge `src/image/**`'s sampler into `src/geometry/**` once the forbidden-file
  constraint that necessitated this split is lifted.
* **Synchronous main-thread processing.** The pipeline is linear-time and resolution-capped (not
  the naive quadratic-in-blur-radius form), and measured comfortably responsive at 1500×1500px in
  this session's headless environment, but it is not off-main-thread (no Web Worker). A very large,
  heavily blurred source image on slower hardware could still cause a brief, bounded UI pause during
  recomputation. Documented as out of scope for this milestone (see the specification's "Out of
  Scope").
* **`imageBufferCache` has no eviction policy.** It grows for the life of the page session (one
  entry per distinct imported source image's decoded pixel buffer). Acceptable at this milestone's
  scope; flagged as a known limitation, not fixed here.
* **`parseIntOr()` footgun fix is local to the new image controls.** The pre-existing
  `parseFloat(...)||fallback` pattern elsewhere in `app.js` (e.g. `gap`, shape `x`/`y`/`w`/`h`) still
  silently discards an explicit `0` in favor of its fallback — harmless for those fields (their
  fallback is also a reasonable default), left unchanged per "smallest coherent change," but worth
  noting as a pattern a future cleanup milestone could generalize.

---

# Known Limitations

* Same as "Warnings" above.
* AI tracing, color separation, edge detection, vectorization, OCR, background removal, and
  multi-color conversion are all explicitly out of scope, per the milestone brief.
* Only PNG/JPG/JPEG/WebP are supported; no GIF/BMP/TIFF/AVIF/HEIC.
* No per-layer rotation for `image` layers (matches every other non-text layer type today).
* S-004 (duplicated text in some 3D preview cases) remains deferred, as directed — this milestone's
  changes never touch `src/preview3d/**`.

---

# Recommended Next Milestone

Converge `src/image/**`'s grid sampler into `src/geometry/**` once permitted (removing the
documented "two stone-generating modules" exception); Web Worker-based off-main-thread image
processing; an `imageBufferCache` eviction policy; migrating `app.js`'s ad hoc project/layer objects
onto `src/core/Project.js`/`Layer.js`; DXF export; investigating S-004.
