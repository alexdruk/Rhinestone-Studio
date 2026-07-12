# RS-1006 — Real 3D Preview

## Task ID

RS-1006

## Title

Real 3D Preview — replace the schematic 2D "cup preview" canvas with an interactive Three.js
preview rendering an actual 3D mesh (mug / straight tumbler / bottle).

## Status

In progress

## Objective

Replace the Object Preview panel's fake 2D schematic (`src/renderer/CupRenderer.js`, a flat
Canvas-2D silhouette with hand-drawn gradients standing in for lighting) with a real, interactive
3D preview built on Three.js: an actual revolved mesh per object template, a canvas texture
generated directly from `StoneLayout`, simple ambient+directional lighting, and mouse
rotate/zoom/pan via `OrbitControls`. `StoneLayout` remains the single source of truth — the new
renderer consumes it exactly the way `CupRenderer.js` already does (a `StoneLayout` plus plain
display options), and invents no stone positions of its own.

## Current Repository State (inspected before writing this spec)

* `src/renderer/CupRenderer.js` (`renderCup()`) draws one of three schematic frustum silhouettes
  (mug/tumbler/bottle, via `objectTemplate.preview.kind`) on a 2D canvas, with the stone-wrap
  placement itself computed inline (`theta`/`front`/`persp` math) rather than a real 3D
  projection. There is no mesh, no lighting model, no camera, and no free rotate/zoom/pan — only a
  custom pointer-drag handler in `app.js` that adjusts a single `rotation` number, plus a zoom
  slider and Front/Left/Right/Back preset buttons.
* `src/products/ObjectTemplate.js` already defines `mug`/`tumbler`/`bottle` as data records
  (`productionWidthMm`/`productionHeightMm`, `safeAreaInsetMm`, `wrap.supported`/`wrap.default`,
  and `preview` — `kind`, `topWidthFactor`/`bottomWidthFactor`/`bodyHeightFactor`/`hasHandle`, plus
  bottle-only `neckWidthFactor`/`neckHeightFactor`/`shoulderHeightFactor`/`capHeightFactor`). These
  `preview` factors were written for `CupRenderer.js`'s 2D viewport-relative fit, but are reusable
  as-is for real proportions once anchored to real mm dimensions (see "Geometry model" below) —
  `ObjectTemplate.js` itself needs no change.
* `app.js` owns `rotation`/`zoom` state, the Front/Left/Right/Back preset buttons, the rotation
  slider, the zoom slider, the Reset view button, and a custom `pointerdown`/`pointermove` handler
  on `#cup` that computes `rotation` from horizontal drag distance. `drawCup()` is the single call
  site that hands the current `StoneLayout` + display options to the renderer.
* `index.html`'s import map resolves the bare specifier `opentype.js` to a relative adapter module
  (`src/browser/OpenTypeBrowserAdapter.js` → `node_modules/opentype.js/dist/opentype.mjs`) — the
  established, dependency-free (no bundler, no CDN) pattern for loading an npm package as a native
  browser ES module. There is no bundler in this repository (`npm run dev`/`start` is
  `python3 -m http.server`); every dependency is loaded either as a native `<script type="module">`
  import resolved by the browser's own import map, or by relative path straight into
  `node_modules/**`.
* `package.json` has exactly one dependency (`opentype.js`). No 3D/WebGL library exists anywhere in
  the repository. `docs/ARCHITECTURE.md`'s "Renderer" section states explicitly: "there is no
  3D/WebGL renderer yet." `docs/REVIEW_CHECKLIST.md`'s User-Visible Quality section already lists
  "3D preview remains usable" as a standing review item, and the secondary
  `docs/architecture/architecture.md` pipeline diagram already shows a "3D renderer" branch — this
  milestone fills an anticipated, not novel, architectural slot.

## Expected Visible Change

* The Object Preview panel (`#cup` canvas) renders a real lit 3D mesh instead of a flat schematic:
  a mug with a handle, a straight tumbler, or a bottle with a neck/shoulder/cap, textured with the
  actual generated stones.
* Dragging the canvas orbits the camera around the object (left-drag rotates, wheel/pinch zooms,
  right-drag or ctrl/shift+left-drag pans) with smooth (damped) motion.
* The existing Front/Left/Right/Back buttons, Rotation slider, Zoom slider, and Reset view button
  continue to work, now driving the 3D camera instead of the 2D silhouette's `rotationDeg`/`zoom`
  parameters.
* "Export Cup PNG" continues to export a real captured image of whatever the 3D preview currently
  shows (same button, id, and filename as before).
* Every existing control (layers, text, shapes, SVG import, curved text, undo/redo, project
  import/export, 2D SVG/PNG export, Production Sheet export) is unaffected.

## Required Outcome

### Architecture / data flow

```
Project → GeometryEngine → StoneLayout → existing 2D canvas / existing exporters (unchanged)
                                        → src/preview3d/** (new) → Three.js canvas
```

`StoneLayout` is not modified, regenerated, or reinterpreted by the 3D preview. The new code reads
`stoneLayout.stones` (`xMm`, `yMm`, `sizeMm`, `color`) exactly as `CupRenderer.js` and
`CanvasRenderer2D.js` already do, plus the same category of plain display options `CupRenderer.js`
already accepts (`cupColor`, `wrap`, `objectTemplate`) with two additions carried from the live
project rather than the viewport: `canvasWidthMm`/`canvasHeightMm` (`project.canvas.width/height`)
— needed so the mesh and the texture share one real millimeter scale, which a 2D "fit to viewport"
renderer never needed.

### New module: `src/preview3d/`

* `ObjectDimensions.js` — pure functions, **no Three.js import**, no DOM: derives real millimeter
  body radius/height (and, for bottles, neck/shoulder/cap extents) from an `ObjectTemplate` record
  plus the live `canvasWidthMm`/`canvasHeightMm`. Fully unit-testable with plain numbers.
  * The body radius is anchored so that a 180° ("half wrap") arc around the cylinder equals
    `canvasWidthMm` exactly — the one wrap mode with a literal mm-accurate circumference. Every
    other wrap mode (`front`/`wide`/`full`) reuses that same fixed radius (a real object does not
    change size when the operator picks a different wrap mode) and only changes how much of the
    surface the texture covers — the same kind of approximation `CupRenderer.js`'s own
    `wrapDeg`/theta math already made (it never claimed literal mm accuracy for every wrap mode
    either).
* `StoneLayoutTexture.js` — pure Canvas-2D drawing (`drawStoneLayoutTexture(ctx, stoneLayout,
  {widthMm, heightMm, backgroundColor})`), **no Three.js import**, no canvas element creation (the
  caller supplies the 2D context, exactly like `CanvasRenderer2D.js`'s `drawStone()` already does)
  — this is what makes it unit-testable with the same dependency-free fake-`ctx` convention
  `tools/test-object-preview-renderer.mjs` already uses. Draws the production-canvas background
  (`cupColor`) plus every stone as a shaded circle at its true mm position, at a fixed
  `TEXTURE_PX_PER_MM` resolution — the texel-to-mm ratio never changes with object size, so texture
  cost stays flat and predictable.
* `ObjectGeometryBuilder.js` — imports Three.js; turns an `ObjectTemplate` + `ObjectDimensions.js`'s
  numbers into an actual `THREE.Group` (a `CylinderGeometry` body for mug/tumbler, a
  `LatheGeometry`-revolved profile for the bottle's body+shoulder+neck+cap, and a
  `TubeGeometry`-built handle for the mug only). No material, camera, lighting, or texture
  decisions are made here — geometry only. Also exports `applyWrapUv()`, which writes a custom `u`
  coordinate per vertex (`atan2(x, z)` azimuth mapped onto the current wrap mode's angular window,
  centered on the front-facing +Z azimuth) so the shared texture wraps only across the selected
  wrap angle and shows plain background elsewhere (via `ClampToEdgeWrapping`).
* `Preview3DRenderer.js` — the actual Three.js orchestration: `WebGLRenderer` (
  `preserveDrawingBuffer: true`, so the existing `#exportCup` button's `canvas.toBlob()` capture
  keeps working unmodified), one ambient + one directional light (no shadows, no PBR/HDR
  environment), a `PerspectiveCamera`, `OrbitControls` (damped rotate/zoom/pan), a `ResizeObserver`
  that keeps the renderer/camera in sync with the panel's actual size, and a persistent
  `requestAnimationFrame` loop. Rebuilds the mesh only when the object template or live mm canvas
  size actually changes; on every other update it only redraws the texture and reassigns it — the
  camera is left alone so an in-progress manual orbit/pan is never reset by an unrelated edit
  elsewhere in the app.
* `index.js` — the only module `app.js` imports statically. `createPreview3D(canvas)` returns a
  synchronous facade immediately (so `app.js`'s own module graph and startup are not blocked) that
  queues the latest `update()`/view-sync call while `Preview3DRenderer.js` — and, inside it, Three.js
  itself and `OrbitControls` — load via a **dynamic `import()`**, replaying the most recent call
  once mounted. This is the "lazy-load Three.js" requirement: nothing under `src/preview3d/**` that
  statically imports `'three'` is ever reached until a 3D preview is actually created.

### Three.js loading (no bundler)

Added as an ordinary npm dependency (`"three"` in `package.json`, resolved the same way
`opentype.js` already is): `index.html`'s import map gains one entry,
`"three": "./node_modules/three/build/three.module.js"` (three's own native ES module build).
`OrbitControls.js` is imported by a **relative path** straight into
`node_modules/three/examples/jsm/controls/OrbitControls.js` (mirroring
`OpenTypeBrowserAdapter.js`'s existing `../../node_modules/opentype.js/dist/opentype.mjs` import) —
its own internal `import ... from 'three'` bare specifier is what the import map resolves. No CDN,
no bundler, no build step added.

### `app.js` wiring

* Swap the `renderCup` import for `createPreview3D`; `drawCup()` calls `preview3D.update(layout,
  {cupColor, wrap, objectTemplate, canvasWidthMm, canvasHeightMm})` plus `preview3D.syncView(rotation,
  zoom)` (the latter only actually repositions the camera when `rotation`/`zoom` differ from the
  preview's last-known slider values, so an unrelated project edit's `updateAll()` never yanks the
  camera out from under a manual orbit/pan in progress).
* The custom `pointerdown`/`pointermove` drag-to-rotate handler on `#cup` is removed —
  `OrbitControls` now owns pointer interaction on that canvas natively (and does strictly more:
  rotate, zoom, and pan, with damping). `CUP_ROTATION_SENSITIVITY` (only used by that handler)
  is removed as dead code.
* The Reset view button additionally calls `preview3D.resetView()`, which restores the camera to
  the last-framed "home" position for the current object (via `OrbitControls`' own
  `saveState()`/`reset()`), not just the `rotation`/`zoom` numbers.
* `updateStats()`'s cup stats line drops the `rotation ${Math.round(rotation)}°` readout — once
  free-orbit is possible, that number reflects only the last preset/slider value, not the camera's
  actual live orientation, so displaying it would be misleading.
* `CupRenderer.js` itself is **not modified or deleted** — its own test suites
  (`tools/test-object-preview-renderer.mjs`, `tools/test-cup-rotation-stabilization.mjs`, etc.)
  keep passing unchanged, matching the repository's established "do not remove a module while any
  test still exercises it" precedent (see the legacy `GeometryEngine` bitmap-text path in `app.js`
  for the existing example of this same rule). It is simply no longer imported/called by `app.js`.

### `index.html`

* Import map gains `"three"`.
* The Object Preview panel's small hint text is updated from "front mode preserves readability" to
  describe the new interaction model (drag/scroll/pan).
* No other markup changes — `#cup` canvas id, `#cupColor`, `#rotation`, `#zoom`, `#resetView`,
  `.viewBtn` buttons, and `#exportCup` all keep their existing ids.

## Allowed Files

* New: `src/preview3d/ObjectDimensions.js`, `src/preview3d/StoneLayoutTexture.js`,
  `src/preview3d/ObjectGeometryBuilder.js`, `src/preview3d/Preview3DRenderer.js`,
  `src/preview3d/index.js`, `src/preview3d/README.md`.
* New tests: `tools/test-object-dimensions.mjs`, `tools/test-stone-layout-texture.mjs`,
  `tools/test-object-geometry-builder.mjs`, `tools/test-preview3d-integration.mjs`.
* Modified: `app.js`, `index.html`, `package.json`, `package-lock.json`, `docs/ARCHITECTURE.md`,
  `docs/specifications/RS-1006-Real3DPreview.md`, `TASK.md`, `TASK_RESULT.md`.
* Five existing guard tests, each narrowly updated for one specific, documented reason (`app.js` no
  longer imports/calls `renderCup`/`CupRenderer.js` for its live Object Preview panel — replaced by
  `createPreview3D`/`preview3D.update()`/`src/preview3d/**` — and the old custom pointer-drag-to-
  rotate handler and its `CUP_ROTATION_SENSITIVITY` constant are removed, superseded by
  `OrbitControls`):
  * `tools/test-app-module-migration.mjs`, `tools/test-shape-geometry-integration.mjs` — added
    `src/preview3d/index.js` to `app.js`'s approved direct-import allowlist.
  * `tools/test-render-export-pipeline.mjs`, `tools/test-object-template-integration.mjs` — updated
    the assertion that checked `renderCup(ctx,layout,...)` to instead check
    `preview3D.update(layout,...)`.
  * `tools/test-ux-visual-polish.mjs` — its two tests for the old `CUP_ROTATION_SENSITIVITY`
    pixel-drag handler updated to verify the successor behavior instead (a real `OrbitControls`
    instance with damping/pan/polar-angle limits configured in `Preview3DRenderer.js`) — not a
    regression, an architectural replacement of the exact interaction model those two tests
    covered.

## Forbidden Files

`src/geometry/**`, `src/export/**`, `src/core/**`, `src/text/**`, `src/fonts/**`, `src/browser/**`,
`src/svg/**`, `src/history/**`, `src/products/**`, `src/renderer/**` (including `CupRenderer.js` —
present but untouched), `assets/**`, `examples/**`, `style.css`, `README.md`, `LICENSE`,
`CONTRIBUTING.md`.

## Out of Scope

PBR materials, HDR/environment lighting, shadows, animation, multiple simultaneous objects, custom
mesh import, GLTF import, DXF export, print-fidelity verification, mobile/touch-specific tuning
beyond what `OrbitControls` provides by default.

## Tests Required

```bash
npm test
git diff --check
git status
```

New suites (registered in `package.json`):

* `tools/test-object-dimensions.mjs` — pure-number tests for `computeObjectDimensionsMm()`/
  `computeBodyRadiusMm()`/`wrapAngleRad()`: mm-accurate radius formula, bottle extra-height
  derivation, positive-input validation, sane output across all three templates and a range of
  canvas sizes.
* `tools/test-stone-layout-texture.mjs` — fake-`ctx` tests (no real canvas/DOM) for
  `drawStoneLayoutTexture()`: background fill uses `backgroundColor`, every stone draws one `arc()`
  at the correct scaled px position/radius, `textureSizeForMm()`'s px dimensions scale linearly
  with mm size at the fixed `TEXTURE_PX_PER_MM`.
* `tools/test-object-geometry-builder.mjs` — imports the real `three` package (pure geometry/math,
  no WebGL context needed) to verify `buildObjectMesh()`/`applyWrapUv()` for all three templates:
  correct group child count (handle present only for `mug`), geometry bounding-box dimensions
  consistent with `ObjectDimensions.js`'s numbers, and that `applyWrapUv()`'s front-azimuth vertices
  always map to `u≈0.5` while the wrap window's angular half-width scales inversely with wrap angle
  (`front` narrower than `full`).
* `tools/test-preview3d-integration.mjs` — structural checks against the live `app.js`/`index.html`
  source (same "extract and execute" / source-slice convention as
  `tools/test-object-template-integration.mjs`): `three` import map entry present, `#cup` canvas id
  unchanged, `createPreview3D` imported and wired into `drawCup()`, the old pointer-drag handler is
  gone, `CupRenderer.js`/`GeometryEngine.js`/`StoneLayout.js` byte-unchanged, no forbidden file
  changed, `exportCup` button/filename unchanged.

`Preview3DRenderer.js` itself (real `WebGLRenderer`/`OrbitControls`/canvas mounting) has no Node
unit test — like `app.js`'s own DOM wiring, it requires a real browser canvas/GL context and is
verified by the browser/manual pass below instead.

## Browser/Manual Verification Checklist

Via a real headless-Chrome (Puppeteer/CDP) session against `python3 -m http.server`, per
`docs/AI_ENGINEER.md`, capturing console `error`/`warning`/`pageerror` events explicitly:

* Mug, Straight Tumbler, and Bottle each render a distinct, correctly lit 3D mesh (handle present
  only for the mug; neck/shoulder/cap present only for the bottle).
* Mouse-drag rotation, wheel/scroll zoom, and pan (right-drag or ctrl/shift+left-drag) all visibly
  move the camera smoothly.
* Reset view restores the default framing.
* Straight text, curved text, an imported SVG layer, a circle layer, and a rectangle layer all
  appear correctly as textured stones on the 3D body.
* Switching wrap mode (front/wide/half/full) visibly changes how much of the body the design
  covers.
* Existing exports (2D SVG/PNG, Cup PNG, Generated Layout JSON, Project JSON, Production Sheet
  SVG/PNG/PDF) all still work and are visually/structurally unaffected.
* Zero console errors/warnings/page errors across the whole session.

## Acceptance Criteria

- [ ] Mug/Tumbler/Bottle each render as a real, distinct Three.js mesh.
- [ ] Mouse rotate/zoom/pan all work with smooth (damped) interaction; Reset view works.
- [ ] The texture is generated directly from `StoneLayout` and stays millimeter-accurate at the
      reference wrap angle.
- [ ] `StoneLayout`/`GeometryEngine` untouched; no exporter touched.
- [ ] `npm test` passes in full.
- [ ] Real browser verification performed and documented, zero console errors.
- [ ] `TASK_RESULT.md` completed honestly.

## Implementation Constraints

* Three.js is lazy-loaded (dynamic `import()`), never statically imported from `app.js`'s own
  top-level module graph.
* No bundler, no CDN — Three.js is loaded exactly the way `opentype.js` already is (import map +
  direct `node_modules/**` relative paths).
* Keep 60fps as the working target: geometry stays low-poly (tens to low hundreds of vertices per
  object), the texture is regenerated only on `StoneLayout` change (not every animation frame), and
  mesh rebuilds only happen on an actual object-template/canvas-size change.

## Commit Message

```text
feat(preview3d): replace fake 2D cup preview with real interactive Three.js 3D preview (RS-1006)
```

## Deliverables

* Implementation: `src/preview3d/**` (5 modules + README), `app.js`, `index.html`, `package.json`.
* Tests: 4 new suites registered in `package.json`; full existing suite passing unmodified.
* `docs/ARCHITECTURE.md` updated to describe the new 3D preview and Three.js dependency.
* `TASK_RESULT.md` completed.
* One commit on `feature/rs-1006-real-3d-preview`, pushed.

## Next Milestone

DXF export; consolidating the cross-layer `dedupe()` merge step into
`src/geometry/GeometryEngine.js`; migrating `app.js`'s ad hoc project/layer objects onto
`src/core/Project`/`Layer`; syncing the rotation slider's displayed value to live free-orbit camera
state (a UX polish item, not required by this milestone).
