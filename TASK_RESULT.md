# Rhinestone Studio — Task Result

This document is completed by the implementation engineer after finishing the current task.

---

# Task ID

RS-1006 — Real 3D Preview

---

# Status

IMPLEMENTED

---

# Branch

feature/rs-1006-real-3d-preview

---

# Commit

Do not write the current commit hash into this file — this file is part of the same commit it
describes. Obtain it from Git history with:

```bash
git log -1 --oneline
```

---

# Summary

Replaced the Object Preview panel's fake 2D schematic (`src/renderer/CupRenderer.js`, a flat
Canvas-2D silhouette with hand-drawn gradients standing in for lighting) with a real, interactive
Three.js 3D preview: an actual revolved mesh per object template (mug/tumbler/bottle), a canvas
texture generated directly from `StoneLayout`, simple ambient+directional lighting, and mouse
rotate/zoom/pan via `OrbitControls`.

New module family `src/preview3d/**`:

* `ObjectDimensions.js` — pure mm-scale math (no Three.js, no DOM). Derives real body radius/height
  (and, for bottles, neck/shoulder/cap extents) from an `ObjectTemplate` record plus the live
  `project.canvas` mm size. The body radius is anchored so a 180-degree ("half wrap") arc equals
  `canvasWidthMm` exactly — the one wrap mode with a literal mm-accurate circumference; every other
  wrap mode reuses that same fixed radius and only changes how much of the surface the texture
  covers (a real object does not resize when the operator picks a different wrap mode).
* `StoneLayoutTexture.js` — pure Canvas-2D texture drawing (no Three.js, no canvas element creation
  — the caller supplies the 2D context, exactly like `CanvasRenderer2D.js`'s `drawStone()` already
  does). Draws the object's base color plus every stone at its true mm position, at a fixed
  `TEXTURE_PX_PER_MM` resolution.
* `ObjectGeometryBuilder.js` — Three.js geometry construction: a tapered open cylinder
  (`CylinderGeometry`) for mug/tumbler, a `LatheGeometry`-revolved profile for the bottle's
  body+shoulder+neck+cap, and a `TubeGeometry` handle for the mug. Also exports `applyWrapUv()`,
  which writes a custom per-vertex U coordinate (`atan2(x,z)` azimuth mapped onto the current wrap
  mode's angular window, centered on the front) so the shared texture wraps only across the
  selected wrap angle and shows plain background elsewhere.
* `Preview3DRenderer.js` — the actual Three.js orchestration: a `WebGLRenderer`
  (`preserveDrawingBuffer: true`, so `#exportCup`'s existing `canvas.toBlob()` capture keeps
  working unmodified), one ambient + one directional light (no shadows, no PBR/HDR environment), a
  `PerspectiveCamera` framed to fit the object's actual height *and* diameter against the panel's
  real aspect ratio, `OrbitControls` (damped rotate/zoom/pan, `screenSpacePanning`, polar-angle
  limits), a `ResizeObserver`-driven resize, and a persistent `requestAnimationFrame` loop. Rebuilds
  the mesh only when the object template or live mm canvas size actually changes; every other
  `update()` call only redraws/reassigns the texture — the camera is left alone so an in-progress
  manual orbit/pan is never reset by an unrelated project edit elsewhere in the app.
* `index.js` — the only module `app.js` imports statically. `createPreview3D(canvas)` returns a
  synchronous facade immediately (so `app.js`'s own module graph/startup are never blocked waiting
  on a dynamic import + WebGL context creation) that queues the latest `update()`/`syncView()` call
  while `Preview3DRenderer.js` — and, inside it, Three.js itself and `OrbitControls` — load via a
  dynamic `import()`, replaying the most recent call once mounted. This is the "lazy-load Three.js"
  requirement: nothing that statically imports `'three'` is ever reached until a 3D preview is
  actually created.

Three.js is loaded exactly the way `opentype.js` already is (no bundler, no CDN): `three` was added
as an ordinary npm dependency; `index.html`'s import map gained one entry,
`"three": "./node_modules/three/build/three.module.js"` (Three's own native ES module build);
`OrbitControls` is imported by relative path straight into
`node_modules/three/examples/jsm/controls/OrbitControls.js` (mirroring
`OpenTypeBrowserAdapter.js`'s existing pattern for `opentype.js`) — its own internal
`import ... from 'three'` bare specifier is what the import map resolves.

`app.js` changes: swapped the `renderCup` import for `createPreview3D`; `drawCup()` now calls
`preview3D.update(layout, {cupColor, wrap, objectTemplate, canvasWidthMm, canvasHeightMm})` plus
`preview3D.syncView(rotation, zoom)` (the latter only actually repositions the camera when
`rotation`/`zoom` differ from the preview's last-known slider values, so an unrelated project edit's
`updateAll()` never yanks the camera out from under a manual orbit/pan in progress); the old custom
`pointerdown`/`pointermove` drag-to-rotate handler on `#cup` and its `CUP_ROTATION_SENSITIVITY`
constant are removed (`OrbitControls` now owns pointer interaction on that canvas natively, and does
strictly more — rotate, zoom, and pan, with damping); the Reset view button additionally calls
`preview3D.resetView()` (restores the camera via `OrbitControls`' own `saveState()`/`reset()`, not
just the `rotation`/`zoom` numbers); the cup stats line drops the `rotation °` readout (once free
orbit is possible, that number only ever reflected the last preset/slider value, not the camera's
actual live orientation). `index.html` gained the import-map entry and an updated Object Preview
hint ("drag to rotate · scroll to zoom · right-drag to pan"); every id (`#cup`, `#cupColor`,
`#rotation`, `#zoom`, `#resetView`, `.viewBtn`, `#exportCup`) is unchanged.

`StoneLayout.js`/`GeometryEngine.js` are byte-for-byte untouched — no new stone position is invented
anywhere. `CupRenderer.js` is not modified or deleted — its own pre-existing test suites
(`tools/test-object-preview-renderer.mjs`, `tools/test-cup-rotation-stabilization.mjs`, etc.) keep
passing unchanged; it is simply no longer imported/called by `app.js`.

**Mid-implementation fix (found via browser verification, not the automated suite):** the first
rendered 3D preview framed the camera using only the object's height, ignoring the Object Preview
panel's actual (portrait) aspect ratio — the bottle's wide shoulder/cap were clipped left/right, and
every object was framed a bit too tight. Root cause: `_frameCamera()`'s distance formula used a
single height-based heuristic (`max(radius*3.4, height*1.5, 40)`) with no aspect-ratio term. Fixed
by computing the camera distance required to fit the height *and* the full diameter independently
(the latter using `camera.aspect`), taking the larger of the two plus a named `FRAME_MARGIN`. Also
tuned `DEFAULT_POLAR_RAD` from ~66° to ~74.5° from vertical so the default view reads as looking at
the object from slightly above eye level, not down into its open mouth. Re-verified visually
(screenshots) after the fix for all three templates.

---

# Files Changed

**New:**
* `src/preview3d/ObjectDimensions.js`, `src/preview3d/StoneLayoutTexture.js`,
  `src/preview3d/ObjectGeometryBuilder.js`, `src/preview3d/Preview3DRenderer.js`,
  `src/preview3d/index.js`, `src/preview3d/README.md`
* `docs/specifications/RS-1006-Real3DPreview.md`
* `tools/test-object-dimensions.mjs` (11 tests), `tools/test-stone-layout-texture.mjs` (7 tests),
  `tools/test-object-geometry-builder.mjs` (8 tests, using the real `three` package),
  `tools/test-preview3d-integration.mjs` (11 tests)

**Modified:**
* `app.js`, `index.html` (3D preview wiring; see Summary)
* `package.json` (new `three` dependency; registered the 4 new test files), `package-lock.json`
* `docs/ARCHITECTURE.md` (Renderer implementation-status note)
* `TASK.md` (this milestone's task)
* Five existing guard tests, each narrowly updated for one specific, documented reason (`app.js`
  legitimately no longer imports/calls `renderCup`/`CupRenderer.js`):
  * `tools/test-app-module-migration.mjs`, `tools/test-shape-geometry-integration.mjs` — added
    `src/preview3d/index.js` to `app.js`'s approved direct-import allowlist.
  * `tools/test-render-export-pipeline.mjs`, `tools/test-object-template-integration.mjs` — updated
    the assertion checking `renderCup(ctx,layout,...)` to check `preview3D.update(layout,...)`
    instead.
  * `tools/test-ux-visual-polish.mjs` — its two tests for the old `CUP_ROTATION_SENSITIVITY`
    pixel-drag handler updated to verify the successor `OrbitControls` configuration (damping,
    panning, polar-angle limits) instead — an architectural replacement of the exact interaction
    model those two tests covered, not a regression.

No forbidden file was changed beyond this itemized list (`src/geometry/**`, `src/export/**`,
`src/core/**`, `src/text/**`, `src/fonts/**`, `src/browser/**`, `src/svg/**`, `src/history/**`,
`src/products/**`, `src/renderer/**` — including `CupRenderer.js`, present but untouched —
`assets/**`, `examples/**`, `style.css`, `README.md`, `LICENSE`, `CONTRIBUTING.md` are all
untouched).

---

# Commands Executed

```bash
npm install three@0.169.0 --save   # new runtime dependency
npm test                            # full suite, see below
git diff --check                    # clean, no whitespace errors
git status                          # reviewed before every commit
npm run dev                         # python3 -m http.server 5173, used for browser verification
```

Browser verification additionally used a temporary, not-committed Puppeteer (`puppeteer-core`,
installed with `--no-save --no-package-lock` and uninstalled afterward — `package.json`/
`package-lock.json` show only the `three` dependency) session against a locally cached "Chrome for
Testing" binary, with software WebGL enabled (`--use-angle=swiftshader
--enable-unsafe-swiftshader`), since headless Chrome has no GPU in this environment.

---

# Automated Test Results

`npm test` — **32/32 suites pass**, exit code 0 (28 pre-existing suites, all passing unmodified or
with the 5 narrowly-updated guard tests above, + the 4 new suites).

New suites:

* `tools/test-object-dimensions.mjs` — 11/11 passed. Covers: the mm-accurate 180-degree-arc radius
  formula and its linear scaling; positive-input validation; `wrapAngleRad()`'s ordering
  (front < wide < half < full) and permissive fallback; mug/tumbler/bottle dimension derivation
  (equal top/bottom radius for the tumbler, positive bottle neck/shoulder/cap heights with
  `totalHeightMm > bodyHeightMm`); object size is wrap-mode-invariant by construction (no wrap
  parameter exists on `computeObjectDimensionsMm()` at all).
* `tools/test-stone-layout-texture.mjs` — 7/7 passed. Covers: `textureSizeForMm()`'s linear px/mm
  scaling and 2px floor; exactly one background `fillRect` using `backgroundColor`; exactly one
  `arc()` per stone at the correct mm-scaled position/radius; an unknown stone color degrades to
  the gold palette instead of throwing; deterministic output for identical inputs. Uses the same
  dependency-free fake-`ctx` convention already established by
  `tools/test-object-preview-renderer.mjs`.
* `tools/test-object-geometry-builder.mjs` — 8/8 passed, using the real `three` npm package (pure
  geometry/math classes run fine under plain Node with no WebGL context, so this is a real test of
  the actual geometry, not a mock). Covers: no throw for any of the three templates; mug has exactly
  a body + a handle mesh, tumbler/bottle have body-only; real `THREE.Mesh`/`BufferGeometry`
  instances; body bounding-box height matches `ObjectDimensions.js`'s numbers for mug/tumbler and
  the bottle's total height (body+shoulder+neck+cap); tumbler radius is constant top-to-bottom;
  `applyWrapUv()` maps the front azimuth to `u≈0.5` for every wrap mode, and the same off-front
  azimuth maps further from center under a narrower wrap window (`front`) than a wider one
  (`full`).
* `tools/test-preview3d-integration.mjs` — 11/11 passed. Covers: the `three` import-map entry (no
  CDN); `#cup`/`#cupColor`/`#rotation`/`#zoom`/`#resetView`/`#exportCup`/`.viewBtn` ids unchanged;
  `app.js` imports `createPreview3D` (not `renderCup`/`CupRenderer.js`); `drawCup()` wires
  `preview3D.update()`/`syncView()` with the live mm canvas size; the old pointer-drag handler and
  `CUP_ROTATION_SENSITIVITY` are gone; Reset view calls `preview3D.resetView()`; `#exportCup`'s
  button/filename unchanged; `package.json` declares `three` and registers all 4 new suites;
  `ObjectDimensions.js`/`StoneLayoutTexture.js` have no Three.js import and never touch
  `Project`/`Layer`; `CupRenderer.js` still exists, still exports `renderCup`, unmodified; no
  forbidden file changed.

---

# Browser/Manual Verification

Real headless-Chrome session via Puppeteer (CDP, software WebGL) against
`python3 -m http.server 5173`, per `docs/AI_ENGINEER.md`. Console `error`/`warning` and `pageerror`
events were explicitly captured for the entire session, not inferred.

Actual observed results:

* **Default project (mug, "Vitalina Serbin" text layer):** a real lit 3D mug renders on `#cup` — a
  WebGL context is genuinely attached (`canvas.getContext('webgl2')` truthy), the body shows a
  smooth lighting gradient (not the old hand-drawn 2D shading), the handle is visible when rotated
  to the back, and the gold "Vitalina Serbin" text is correctly wrapped onto the front of the body
  at true mm scale.
* **Mouse rotate:** a drag from the canvas center visibly orbits the camera (screenshot comparison:
  the design rotates out of view, the handle becomes visible on the far side) — smooth, damped
  motion, not a jump.
* **Scroll zoom:** mouse wheel visibly moves the camera closer/farther (screenshot comparison
  confirms a materially closer framing after `wheel({deltaY:-300})`).
* **Right-drag pan:** visibly translates the camera's target (screenshot confirms a different part
  of the object framed, at the same zoom level).
* **Reset view:** restores the exact "home" framing (pixel-identical screenshot to the initial
  load), after rotate+zoom+pan — confirms `OrbitControls`' `saveState()`/`reset()` round-trips
  correctly through `Preview3DRenderer.js`'s own `_frameCamera()`.
* **Object type switch:** Mug → Straight Tumbler → Bottle, each rendering a genuinely distinct mesh
  (tumbler: true constant-radius cylinder, no handle; bottle: shoulder taper + neck + cap, no
  handle) with the correct default wrap mode's coverage, correct new production size shown in the
  2D layout stats (`220.3×18.5 mm` design bbox for the wider tumbler canvas, `169.8×14.7 mm` for the
  narrower bottle canvas), and zero console errors on each switch.
* **Wrap modes:** front/wide/half/full each visibly change how much of the body surface the design
  covers (screenshot comparison across all four), confirming `applyWrapUv()`'s per-mode angular
  window is live-wired to the `#wrap` control.
* **Curved text, circle layer, rectangle layer, imported SVG layer:** enabling curved text, then
  adding a circle layer, a rectangle layer, and importing a small SVG (via a real
  `page.waitForFileChooser()` + `fileChooser.accept()` flow, not a synthetic DOM event) all appear
  correctly as textured stones on the 3D body — the 2D layout's "542 stones" stat matches what
  renders on the mesh (visually confirmed via screenshot; the same merged `StoneLayout` feeds both
  renderers, so this is expected, not separately re-derived).
* **Existing exports unchanged:** 2D SVG, 2D PNG, Cup PNG, Generated Layout JSON, Project JSON, and
  Production Sheet SVG all downloaded successfully. The Cup PNG (`rhinestone-cup-preview.png`,
  516×635 real RGBA PNG, 58KB) is a genuine capture of the current 3D-rendered content (visually
  confirmed) — proves `preserveDrawingBuffer: true` on the new `WebGLRenderer` keeps
  `canvas.toBlob()` working unmodified.
* **Console/errors:** the only console event across the entire session (initial load + every
  interaction above) was a single `404` for `/favicon.ico` — the browser's automatic favicon
  request; `index.html` defines no favicon `<link>` before or after this milestone (same
  pre-existing, unrelated event RS-1005's own browser verification documented). **Zero
  application-originated console errors or warnings, and zero page (uncaught
  exception/unhandled rejection) errors.**
* One test-script-level observation, not an application defect: `#exportPNG`/`#exportCup` do not
  update `#status` at all (`exportCanvas()` is a fire-and-forget `canvas.toBlob()` callback with no
  status-bar write) — this is pre-existing behavior, unchanged by this milestone; only
  `download()` (used by the SVG/JSON/Production-Sheet-SVG exports) writes to `#status`.

Not performed: real-device/GPU verification (this environment's headless Chrome has no GPU; WebGL
was exercised via software rendering/SwiftShader) and mobile touch-gesture verification (out of
scope per the specification — `OrbitControls`' default touch handling was not separately exercised
beyond what its own library test suite already covers).

---

# Warnings

* The default camera framing/lighting is a judgment call (not a spec-mandated exact number) — tuned
  visually during this milestone (see "Mid-implementation fix" above) but not tied to a real
  physical camera/lighting reference.
* `OrbitControls`-driven free rotation is decoupled from the Rotation slider/Front-Left-Right-Back
  buttons' displayed values by design (see the specification's "Next Milestone" note) — the slider
  shows the last preset value, not the camera's live orientation, after a manual mouse drag. This
  was a deliberate scope decision (syncing it back would need a continuous polling/eventing loop)
  documented in the spec, not an oversight.
* The mug/tumbler body is open at both ends (no cap geometry) — a deliberate simplification (avoids
  a UV-mapping special case for cap faces that would otherwise pick up a radial slice of the design
  texture) rather than a modeled wall thickness; visible only if the camera is panned to look
  directly into the mouth or straight up from below.

---

# Known Limitations

* Same as the "Warnings" above.
* No PBR materials, HDR/environment lighting, shadows, animation, multiple simultaneous objects,
  custom mesh/GLTF import, or DXF export — all explicitly out of scope per the specification.
* Print-fidelity / physical-device verification was not performed (same limitation category as
  prior milestones' PDF/PNG export verification).

---

# Recommended Next Milestone

DXF export; syncing the Rotation slider's displayed value to live free-orbit camera state (read
`OrbitControls.getAzimuthalAngle()` each frame) as a UX polish item; consolidating the cross-layer
`dedupe()` merge step into `src/geometry/GeometryEngine.js` (still the one remaining architectural
gap documented in `docs/ARCHITECTURE.md`); migrating `app.js`'s ad hoc project/layer objects onto
`src/core/Project`/`Layer`.
