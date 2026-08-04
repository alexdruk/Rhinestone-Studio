# RS-2011 — 3D Preview Correctness Pack

## Task ID

RS-2011

## Title

Make the existing 3D Object Preview (`src/preview3d/**`, RS-1006/RS-1006A/S-107/S-109/S-112/S-112A/
RS-2010) geometrically and visually correct for the current Mug, Tumbler, Bottle, and Plate products,
without introducing a new rendering architecture, a second `StoneLayout` consumer, or any
gemstone/faceted-rendering feature (that is a future milestone).

## Status

Complete.

## Current architecture (as audited)

`src/preview3d/` is a five-module pipeline, unchanged in shape by this milestone:

* `ObjectDimensions.js` — pure mm math. `computeBodyRadiusMm()` anchors a revolved vessel's body
  radius so that a full 360° revolution has arc length exactly `canvasWidthMm` — the production
  canvas is the object's unwrapped surface, wrapping exactly once around it, seamlessly (canvas
  `x=0` and `x=canvasWidthMm` are the same physical point). A plate instead derives its dimensions
  directly from `project.plate` (a flat disc has no "unwrapped circumference").
* `StoneLayoutTexture.js` — pure Canvas-2D drawing of the production canvas background + every stone
  at its true mm position, at a fixed `TEXTURE_PX_PER_MM = 8`. No wraparound/duplicate drawing at the
  canvas edges (matches `src/renderer/CanvasRenderer2D.js`'s own `drawStone()` loop, which also draws
  each stone exactly once with no edge-wraparound logic — the 3D preview does not introduce any new
  edge behavior here relative to the 2D canvas).
* `ObjectGeometryBuilder.js` — builds a `LatheGeometry`-revolved body for mug/tumbler/bottle (closed
  base, modeled rim) and a two-mesh `LatheGeometry` pair for the plate (printable top + non-printable
  underside/foot-ring). `applyAzimuthUv()` writes each vertex's `U` from its own **construction**
  column angle (`column/LATHE_SEGMENTS`), not `atan2(x,z)` — deliberately, to avoid the branch-cut and
  signed-zero apex bugs documented inline (both previously real, both now regression-guarded by
  `tools/test-object-geometry-builder.mjs` tests 8b/8c). `applyBodyHeightUv()` writes `V` from the
  vertex's own mm height. `applyPlateTopSurfaceUv()` uses a direct planar `(x,z)` projection for the
  plate's top surface only.
* `Preview3DRenderer.js` — `WebGLRenderer`/scene/camera/lighting/`OrbitControls`/resize/animation-loop
  orchestration, plus `CanvasTexture` creation and product-switch mesh rebuild/disposal.
* `index.js` — synchronous facade `app.js` statically imports; queues `update()`/`syncView()` calls
  until the real renderer's lazy `import('three')` finishes.

## Confirmed defects

Audited by reading every module in `src/preview3d/`, the module's own README, its full git history
(`git log -p` on `Preview3DRenderer.js`), the installed Three.js version (`0.169.0`, WebGL2-capable —
NPOT mipmaps are natively supported, so there is no version-based reason to avoid them), and the
existing test suite (`tools/test-object-geometry-builder.mjs`, 20 tests, already covering UV
continuity, seam/branch-cut/apex regressions, plate profile/UV, and RS-2010 vessel params).

1. **Unconditional continuous render loop.** `_animate()` calls `requestAnimationFrame` recursively
   forever from the moment `init()` runs, calling `controls.update()` + `renderer.render()` on every
   frame regardless of whether the camera, texture, or geometry changed. This is real, unnecessary
   continuous rendering while the scene is idle — the exact Phase 5 defect the milestone names.
2. **No mipmapping or anisotropic filtering on the stone texture.** `_updateTexture()` sets
   `generateMipmaps = false`, `minFilter = THREE.LinearFilter`, and never sets `.anisotropy` (default
   `1`). Minifying a fixed-8px/mm canvas texture (e.g. viewing a rotated vessel at a distance, or the
   far side of the cylinder at a grazing angle) with no mipmaps and no anisotropy is a standard cause
   of shimmering/aliasing on small high-contrast detail (stone edges) and blur at oblique angles —
   matching the milestone's "blurry, shimmering, or unstable stone rendering" defect. `git log -p`
   shows this was the original RS-1006 setting with no recorded rationale (no comment, no later
   milestone note); nothing in the codebase depends on mipmaps being off.

## Investigated and found already correct (no code change)

* **Vessel seam/UV mapping (Phase 2).** `applyAzimuthUv()` maps `U=0`/`U=1` to the texture's two
  physical edges, which by `ObjectDimensions.js`'s own contract are the same physical seam point on
  the object; the texture's wrap mode is `ClampToEdgeWrapping` (no `RepeatWrapping`), so there is no
  double-sampling or duplicate stone rendering at the seam. `LatheGeometry`'s one genuinely unjoined
  column pair falls exactly on that seam (`phiStart=-PI`), matching the one texture discontinuity that
  is expected. This was fixed in S-107/S-109 and is regression-guarded by tests 7/8/8b/8c in
  `tools/test-object-geometry-builder.mjs`. No stone-duplication or seam defect was reproducible from
  the code; per the milestone's own instruction ("do not claim defects that cannot be reproduced or
  supported by repository evidence"), no change is made here beyond browser verification.
* **Tapered-vessel orientation.** `wallRadiusAt()` linearly interpolates `bodyRadiusMm → topRadiusMm`
  by fractional height, and `applyBodyHeightUv()` ties `V` to true mm height independent of the
  profile's arc length — bottom and top stay aligned for both straight (tumbler) and tapered
  (mug/bottle) walls. Covered by existing tests 4–6, 12.
* **Plate mapping (Phase 3).** `applyPlateTopSurfaceUv()` projects the top surface only; the
  underside/rim-edge/foot-ring is a second mesh (`underMesh`) with no texture map at all (plain
  `cupColor`). Covered by existing tests 13–18 plus `docs/specifications/S-112-RoundDinnerPlate.md`/
  `S-112A`. No stretching, no underside/foot-ring bleed possible.
* **Texture/geometry staleness across product or dimension changes.** `update()` computes a
  `geometryKey` from `objectTemplate.id` + canvas size + `plateParams`/`vesselParams` and only rebuilds
  the mesh when it changes; `_updateTexture()` disposes and recreates the `CanvasTexture` whenever its
  pixel size changes (a S-112-documented fix for a real observed stale-GPU-texture bug), and redraws
  its content on every call. `_rebuildMesh()` calls `_disposeGroup()` first, which disposes every
  child's geometry and material. `dispose()` disposes controls, texture, and renderer.
* **Resource/listener accumulation.** `createPreview3D()`/`Preview3DRenderer` are instantiated exactly
  once for the lifetime of the app (`app.js`'s top-level `const preview3D = createPreview3D(cupCanvas)`
  — never re-created), and `init()` is itself idempotent (`if (this._mounted) return`), so the
  `ResizeObserver` and `OrbitControls` `'change'` listener are each attached exactly once. Product
  switching reuses the same renderer/scene/controls and only replaces the mesh group + texture via the
  disposal path above — there is no per-switch listener or context accumulation to fix.
* **Color space.** `renderer.outputColorSpace` and `texture.colorSpace` are both already
  `THREE.SRGBColorSpace`; `toneMapping` is `NoToneMapping`. Correct as-is.

## Proposed minimal changes

Both changes are confined to `src/preview3d/Preview3DRenderer.js` (material/render-loop only, no
geometry/UV/dimension change) plus a small pass-through addition in `src/preview3d/index.js`.

1. **Invalidation-based rendering.** Replace the unconditional `_animate()` loop with
   `_requestRender()`/`_renderFrame()`: a frame is scheduled only when something can actually change
   the picture. Triggers wired to `_requestRender()`:
   * `init()`'s first frame (replaces the old always-on `_animate()` kick-off).
   * `update()` (texture redraw and/or geometry rebuild).
   * `_handleResize()` (`ResizeObserver` callback).
   * `setAzimuthDeg()` / `setZoom()` / `resetView()` (slider-driven camera moves).
   * `OrbitControls` `'start'` / `'change'` / `'end'` events (mouse/touch drag, wheel zoom, and
     damping's own residual-motion frames — `OrbitControls.update()` only dispatches `'change'` and
     returns `true` while the camera actually moved past its internal epsilon, so the loop
     self-terminates the frame after damping settles with no fixed-duration timer needed).
   A limited rAF-per-invalidation loop remains (not a fully event-free design) because
   `OrbitControls`'s damping inertia is itself expressed only through repeated `update()` calls, not a
   single event — this is the standard, documented Three.js on-demand-rendering pattern for
   `enableDamping: true` (`controls.addEventListener('change', requestRender)` plus one
   `renderAnimationFrame`-scheduled `update()`/`render()` pair per invalidation). No custom scheduler
   library or fixed animation timer is introduced.
   * Adds `getRenderCount()` (and a facade pass-through in `index.js`) purely as verification
     instrumentation — a monotonic counter incremented once per actual `renderer.render()` call, so
     idle-vs-active behavior can be confirmed by polling a number instead of eyeballing the canvas.
2. **Texture filtering.** On both `CanvasTexture` construction sites in `_updateTexture()` (initial
   creation and the resize-triggered recreation), set `generateMipmaps = true`,
   `minFilter = THREE.LinearMipmapLinearFilter`, and `anisotropy = renderer.capabilities.getMaxAnisotropy()`.
   `wrapS`/`wrapT` stay `ClampToEdgeWrapping` (unchanged — still the correct no-repeat seam behavior).

## Invariants preserved

* `GeometryEngine`, `StoneLayout`, every exporter, the 2D canvas renderer, Production Sheet, project
  JSON schema, undo/redo, and autosave are not imported, read, or modified by this milestone.
* `src/preview3d/ObjectDimensions.js`, `ObjectGeometryBuilder.js`, and `StoneLayoutTexture.js` are not
  modified — every geometry/UV/mm-position computation is byte-identical before and after.
* No new external dependency; `OrbitControls`/`Three.js` are the only libraries involved, both already
  in use.
* `index.js`'s existing `update`/`syncView`/`resetView`/`onAzimuthChange` contract is unchanged;
  `getRenderCount` is a strictly additive method.

## Tests

Node-level, added in `tools/test-preview3d-render-scheduling.mjs` (new — `Preview3DRenderer.js` has no
prior Node test; it needs a browser canvas/GL context to fully construct, documented in the file's own
header comment). The new render-scheduling logic (`_requestRender`/`_renderFrame`/`getRenderCount`)
only touches `this._mounted`/`this._frameScheduled`/`controls.update()`/`renderer.render()`, so it is
tested directly against a real `Preview3DRenderer` instance with `controls`/`renderer` swapped for
minimal fakes and a queued fake `requestAnimationFrame` — no WebGL/DOM required, same
dependency-free-fake convention `tools/test-object-preview-renderer.mjs` already uses for
`CanvasRenderingContext2D`.

Milestone test-coverage checklist, existing vs. new:

1. Vessel UV spans one circumference exactly — existing (`test-object-geometry-builder.mjs` #7, #8).
2. Seam boundaries don't duplicate/drop content — existing (#8b, #8c).
3. Mug/Tumbler/Bottle use current physical dimensions — existing (#4–#6, #19, #20).
4. Tapered/straight vessel orientation — existing (#6, #12).
5. Plate target areas map correctly — existing (#13–#18).
6. Texture replacement disposes obsolete resources — existing code path (`_updateTexture()`'s
   dispose-and-recreate-on-size-change), verified in browser (Playwright) per the checklist below;
   no WebGL context in Node to assert GPU-resource disposal directly.
7. Product switching retains no stale geometry/texture — existing code path (`_rebuildMesh()` →
   `_disposeGroup()`), verified in browser.
8. Idle rendering does not continuously redraw — **new** (`test-preview3d-render-scheduling.mjs` #2)
   plus browser verification via `getRenderCount()`.
9. Orbit/camera interaction invalidates and redraws — browser verification via `getRenderCount()`
   (drag/orbit needs real pointer events + a real `OrbitControls` instance).
10. Resize invalidates and redraws — **new** unit test covers the scheduling primitive; browser
    verification confirms the real `ResizeObserver` path.
11. Renderer-facing project APIs stay backward-compatible — **new** (`getRenderCount` is additive;
    `update`/`syncView`/`resetView`/`onAzimuthChange` signatures unchanged).
12. Mixed-size and Uniform layouts display without changing underlying data — no
    `StoneLayoutTexture.js` change; verified visually in browser.

## Browser-verification plan

Isolated Playwright profile. Load the app, then for each of Mug/Tumbler/Bottle/Plate: switch product,
edit physical dimensions, toggle Uniform/Mixed stone sizes, drag stones near both horizontal canvas
edges and inspect the seam, rotate a full revolution, resize the window, reload, export SVG, open
Production Sheet — confirm zero console errors and no stale product after switching. Confirm idle vs.
interactive rendering using `getRenderCount()` polled before/after a period of no input and
before/after a drag/orbit/resize, rather than visual guessing.

## Implementation

Files changed:

* `src/preview3d/Preview3DRenderer.js` — replaced `_animate()` (unconditional recursive
  `requestAnimationFrame`) with `_requestRender()`/`_renderFrame()` (dedup-guarded, single-frame,
  invalidation-based); wired invalidation into `init()`'s first frame, `OrbitControls`
  `'start'`/`'change'`/`'end'`, `_handleResize()`, `update()`, `_repositionCamera()` (covers
  `setAzimuthDeg`/`setZoom`), and `resetView()`. Added `getRenderCount()`. Extracted the duplicated
  `CanvasTexture` parameter block (both construction sites) into `_applyTextureParams()` and changed
  `generateMipmaps: false` → `true`, `minFilter` → `LinearMipmapLinearFilter`, added
  `anisotropy = renderer.capabilities.getMaxAnisotropy()`. `wrapS`/`wrapT`/`colorSpace` unchanged.
* `src/preview3d/index.js` — added `getRenderCount()` pass-through on the facade (additive; every
  existing method signature unchanged).
* `src/preview3d/README.md` — updated the `Preview3DRenderer.js` module-map entry to describe
  invalidation-based rendering instead of "animation-loop orchestration".
* `app.js` — added `window.__preview3D = preview3D;` immediately after the existing
  `const preview3D = createPreview3D(cupCanvas);` line, purely as QA/automated-verification
  instrumentation (reads `getRenderCount()`; nothing in `app.js` itself reads it back).
* `tools/test-preview3d-render-scheduling.mjs` — new. 6 Node-level tests of the scheduling logic in
  isolation (fake `requestAnimationFrame`/`controls`/`renderer`, no WebGL/DOM).
* `docs/specifications/RS-2011-3DPreviewCorrectness.md` — this file.

No changes to `ObjectDimensions.js`, `ObjectGeometryBuilder.js`, `StoneLayoutTexture.js`, any
exporter, `src/renderer/**`, `src/geometry/**`, project schema, undo/redo, or autosave.

## Focused test results

```
node tools/test-preview3d-render-scheduling.mjs   # 6/6 pass (new)
node tools/test-object-geometry-builder.mjs        # 20/20 pass (unmodified — UV/seam/plate regression guards)
node tools/test-object-dimensions.mjs              # 22/22 pass (unmodified)
node tools/test-object-template.mjs                # 19/19 pass (unmodified)
node tools/test-object-template-integration.mjs    # pass (unmodified)
node tools/test-text-position-workflow.mjs         # pass (unmodified — Front View Frame/onAzimuthChange source checks)
node tools/test-product-plate-round-dinner.mjs     # pass (unmodified)
node tools/test-ux-visual-polish.mjs               # pass (unmodified)
node tools/test-render-export-pipeline.mjs         # pass (unmodified)
node tools/test-architecture-module-boundaries.mjs # pass (unmodified)
```

`npm run test:full` was not run (no shared-architecture/schema/exporter change occurred; per the
milestone's own testing policy, the full suite runs at merge verification instead).

## Browser-verification results

Isolated persistent Playwright Chromium profile (headless, own temp profile dir — no interaction
with any "main"/"airbnb" Chrome window), against the local `python3 -m http.server 5173` dev server.

* Dual Workspace (both `#layout` and `#cup` canvases) is present on load. ✅
* Product switching Mug → Tumbler → Bottle → Plate → Mug: each switch produced exactly the expected
  render(s), `#objectType` reflected the selected id every time (no stale product), zero console
  errors across the whole sequence. ✅
* Editing a physical dimension (`#vesselBodyDiameter` → 95mm) triggered exactly one render, then the
  render count stayed flat (no residual loop). ✅
* Idle scene: render count identical across a 300ms+1200ms idle window before any interaction, and
  again after a rotation-slider interaction settled (damping decayed and stopped invalidating) — the
  scene genuinely stops rendering when nothing is pending. ✅
* Resize (`setViewportSize`) triggered a render. ✅
* Rotation slider (camera interaction) triggered a render, then settled back to idle. ✅
* Full ±180° rotation sweep (45° steps) across all four templates: no throw, no console error. ✅
* Uniform/Mixed stone-size toggle (`#sizeMode`) triggered a render. ✅
* Export → 2D SVG click succeeded; Production Sheet lightbox opened successfully. ✅
* Reload: facade re-mounts (`getRenderCount` callable again), `#objectType` reads back `mug`
  (consistent with the state left before reload — no stale value). ✅
* Zero console errors across the entire session (`page.on('console'/'pageerror')`). ✅
* Visual inspection (screenshots): Mug/Tumbler/Bottle seams (rotated to the handle-hidden azimuth,
  which is where `applyAzimuthUv()`'s one unjoined column pair sits) show continuous, non-duplicated
  text wrapping across the seam with no blank strip. Plate's default Center Well text ("Vitalina
  Serbin") reads correctly oriented and left-to-right — an initial visual impression of "curved/
  upside-down" during review turned out to be perspective foreshortening from the shallow default
  camera elevation across the well's existing slight concave profile (`PLATE_WELL_CONCAVE_BOW`,
  unchanged, pre-existing, out of this milestone's scope per Phase 3's "do not redesign Plate
  geometry"), not a mapping defect — confirmed by comparing against the 2D canvas's own straight,
  upright rendering of the same layer.

## Known limitations

* A limited, event-driven `requestAnimationFrame` loop remains (one frame per invalidation, chained
  automatically while `OrbitControls` damping still reports `'change'`). This is intentional and
  documented above under "Proposed minimal changes" — it is the standard Three.js on-demand-rendering
  pattern for `enableDamping: true` and is not a fixed-duration timer or custom scheduler.
* `getRenderCount()`/`window.__preview3D` are additive verification instrumentation, not used by any
  application logic; they can be left in place at negligible cost or removed in a future cleanup pass
  if desired.

## Commit message

```text
fix(preview3d): invalidation-based rendering + texture filtering (RS-2011)
```
