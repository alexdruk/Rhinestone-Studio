# IMG-007 — Image → Strass Studio Shell

## Objective

`IMG-001`'s eight-milestone roadmap deferred "Full Image Trace Lightbox UX" to IMG-007, expecting it
after IMG-002 through IMG-006 had each added their own capability (color layers, organic placement,
edge awareness, check & fix, brightness sizes). This milestone builds that studio shell *first*,
ahead of schedule, so every later milestone lands directly into a placeholder group instead of
reflowing the dialog each time. It is UI shell only: no change under `src/image/**` or
`src/geometry/**`, no new stone producer. The dialog still drives the one existing
`generateImageLayout()` pipeline through the same six trace parameters (`threshold`, `invert`,
`transparent`, `blurRadiusPx`, `maxWidthPx`, `maxHeightPx`) it always has.

## Decisions

1. **Immediate layer creation replaces the pre-commit preview.** The old flow decoded a file into
   `pendingImageImport` module state, rendered a live preview canvas + approximate stone count, and
   only wrote a layer to `project.layers` when the operator clicked Import (Cancel discarded it).
   That two-step dance existed because there was no way to see the traced result against the real
   layer before committing. The studio's four-view canvas removes that reason: selecting a file now
   creates the `image` layer immediately (same object shape and default trace params
   `imageImportCommit` used to write), and every parameter is then edited live against that real
   layer — mirroring how every other layer type (text, shapes, SVG) already works in this app. There
   is no longer a Cancel step for a fresh import; `#imageStudioRemove` deletes the selected image
   layer if the operator changes their mind after the fact.
2. **Four views, one canvas.** `#imageStudioView` (a radio group: Source / Mask / Template /
   Overlay, default Template) toggles what `#imageStudioCanvas` draws for the selected image layer:
   the raw source bitmap, `prepareImageField()`'s density mask (via the existing
   `maskFieldToRgba()`), the generated `StoneLayout` (via the existing `renderStoneLayout()`), or the
   source at reduced opacity under the template. All four share one `fitTransform()` computed from
   the layer's `x/y/w/h` box, so switching views never re-centers or re-scales the image.
3. **Stats column reads the already-generated layout.** `#imageStudioStats` filters the app's single
   `layout.stones` array (the `GeometryEngine.generate()` output all layers share) down to the
   selected image layer's `layerId`, rather than calling `generateImageLayout()` a second time the
   way the old preview panel did — one source of truth, no risk of the stats disagreeing with what
   is actually on the canvas.
4. **Dock-left by default, one class switch.** `.lightbox-overlay.dock-left{justify-content:flex-start}`
   is the only new overlay rule; every other Lightbox keeps centering via the base
   `.lightbox-overlay` rule. A 1400px-wide studio dialog centered on a typical viewport would leave
   near-equal dead space on both sides — docking left keeps the 2D canvas panel visible alongside it
   at common viewport widths, matching the point of a "studio" (work *with* the canvas, not over it).
5. **Rename to Image → Strass.** The top-menu label (`#menuImageTrace`) shortens to "Image" (id and
   title tooltip unchanged) and the dialog heading becomes "Image → Strass" — reflecting that this is
   now a multi-capability studio, not a single trace-and-import dialog. No other Image Trace
   terminology (layer type `'image'`, function names, the `imageTrace*` slot ids) changes; renaming
   those would be pure churn against `docs/specifications/RS-1008-ImageTrace.md` and every test that
   already greps for them.
6. **Five closed placeholder groups.** `#imageStudioGroupColors` / `Organic` / `Edges` / `CheckFix` /
   `Brightness` each hold nothing but a `<p class="hint">Coming in IMG-00N</p>` line, closed by
   default (unlike Source/Trace/Position & size/Stones, which start open). They exist purely so
   IMG-002 through IMG-006 each have an exact slot to fill without touching this shell's layout
   again — see the roadmap note appended to `IMG-001-ImageToStrass.md` item 7.

## Structure

`#lightboxImageTrace` keeps its overlay id, `.lightbox-overlay.non-modal` class (now also
`.dock-left`), `role="dialog" aria-modal="false"`, and `data-lightbox-close` buttons — every S-105
non-modal-Lightbox invariant is unchanged. Its `.lightbox` gains a `.studio` class
(`width:1400px;height:calc(100vh - 64px)`), and `.lightbox-body` becomes a three-column CSS grid
(`360px` controls / flexible canvas / `260px` stats).

* **Left — `#imageStudioControls`**: `<details class="advanced-section">` groups (the same expand/
  collapse idiom `#mixedAdvancedSection` already uses), each with one `<summary>`:
  Source (file picker + `#imageStudioFileName` + `#imageStudioRemove`), Trace (the six existing
  `imageControls` fields, verbatim, plus `#imageFillMode`), Position & size
  (`#imageTracePositionSlot`), Stones (`#imageTraceStoneSlot` + `#imageTraceMixedSizeSlot`), then the
  five closed IMG-002..006 placeholders. The mouse-editing hint paragraph stays at the bottom, as
  before.
* **Center — `#imageStudioCanvasColumn`**: the `#imageStudioView` radio group, `#imageStudioCanvas`,
  and `#imageStudioEmpty` (shown, canvas cleared, when the selected layer isn't an `image`).
* **Right — `#imageStudioStats`**: a `<dl>` of image name+dimensions, stone count, per-size counts
  (`formatStoneSizeLabel()` — the same "SS16 (4.0 mm)" formatting the stone-size picker and
  Production Sheet header already use), per-color counts, and the layer's bounding box in the
  project's current display units.

`renderImageStudio()` (app.js) is a no-op unless `lightboxes.imagetrace.isOpen`. It runs from the
Lightbox's `onOpen`, from `updateAll()` right after `drawLayout()`, and on `#imageStudioView`
`change` — the same three trigger points `updateImageTraceSections()` (the function it replaces) used
to run from, so every existing call site keeps working with no new wiring elsewhere.

## Out of Scope

* No color quantization, organic/edge/brightness generation, or check & fix logic — the five
  placeholder groups stay inert (`Coming in IMG-00N`) until their own milestone.
* No `src/image/**` or `src/geometry/**` change; `generateImageLayout()`'s six-parameter contract is
  unchanged.
* No vector-first SVG export path (IMG-008).
* No BACKLOG/roadmap renumbering — IMG-007 keeps its milestone number even though it now ships ahead
  of IMG-002 through IMG-006 (see the note appended to `IMG-001-ImageToStrass.md` item 7).

## Files Touched

* `index.html` — `#lightboxImageTrace` rebuilt as the three-column studio panel; `#menuImageTrace`
  label; `.lightbox.studio`/`.lightbox-overlay.dock-left`/studio-column CSS.
* `app.js` — removed `pendingImageImport`, `currentImagePreviewParams()`, `updateImagePreview()`, the
  `imgPreview*` listeners, and the `imageImportCancel`/`imageImportCommit` handlers;
  `#importImageFile`'s change handler now creates the `image` layer directly; added
  `renderImageStudio()` (replacing `updateImageTraceSections()`) and `#imageStudioRemove`'s handler.
* `tools/test-ui-shell-structure.mjs` — `menuImageTrace`'s expected label and the Image Trace
  Lightbox's expected id list.
* `tools/test-mono-006-monogram-ui.mjs`, `tools/test-ui-import-autoswitch-regression.mjs` — their
  `sandboxFactory` parameter lists reference `renderImageStudio` instead of
  `updateImageTraceSections`, matching the app.js rename (both slice the real
  `const lightboxes={...}` source verbatim, so the identifier has to exist as a supplied parameter).
* `docs/specifications/IMG-007-StudioShell.md` (this file), `docs/specifications/
  IMG-001-ImageToStrass.md` (one sentence appended to roadmap item 7), `docs/ARCHITECTURE.md` (one
  clause noting the Image Trace dialog's title change).
