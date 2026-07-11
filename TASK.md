# Task

**Task ID:** RS-1006
**Task Type:** Feature — Real 3D Preview
**Specification:** `docs/specifications/RS-1006-Real3DPreview.md`
**Status:** IN PROGRESS
**Branch:** feature/rs-1006-real-3d-preview

## Goal

Replace the Object Preview panel's fake 2D schematic (`src/renderer/CupRenderer.js`) with a real,
interactive Three.js 3D preview: an actual revolved mesh per object template (mug/tumbler/bottle),
a canvas texture generated directly from `StoneLayout`, simple ambient+directional lighting, and
mouse rotate/zoom/pan via `OrbitControls`.

## Required Outcome

See `docs/specifications/RS-1006-Real3DPreview.md` in full. Summary:

* New `src/preview3d/` module family: `ObjectDimensions.js` (pure mm-scale math, no Three.js/DOM),
  `StoneLayoutTexture.js` (pure Canvas-2D texture drawing, no Three.js/DOM), `ObjectGeometryBuilder.js`
  (Three.js geometry construction — cylinder for mug/tumbler, lathe-revolved profile for the
  bottle, tube-geometry handle for the mug), `Preview3DRenderer.js` (WebGLRenderer, lighting,
  camera, `OrbitControls`, resize/animation loop), `index.js` (a synchronous facade that lazily
  dynamic-imports Three.js so `app.js`'s own module graph never eagerly loads it).
* `three` added as an npm dependency, loaded exactly the way `opentype.js` already is: an
  `index.html` import-map entry pointing at `node_modules/three/build/three.module.js`, and
  `OrbitControls` imported by relative path straight into
  `node_modules/three/examples/jsm/controls/OrbitControls.js`. No bundler, no CDN.
* `app.js`: swap `renderCup`/`CupRenderer.js` for `createPreview3D`/`src/preview3d/index.js` in
  `drawCup()`; remove the now-superseded custom pointer-drag-to-rotate handler on `#cup`
  (`OrbitControls` owns pointer interaction natively) and the now-dead
  `CUP_ROTATION_SENSITIVITY` constant; wire Reset view to also call `preview3D.resetView()`; drop
  the now-potentially-misleading `rotation °` readout from the cup stats line.
* `index.html`: import-map entry for `three`; Object Preview panel hint text updated to describe
  drag/scroll/pan instead of the old "front mode" wording. `#cup` canvas id and every other id
  (`#cupColor`, `#rotation`, `#zoom`, `#resetView`, `.viewBtn`, `#exportCup`) unchanged.
* `StoneLayout.js`/`GeometryEngine.js` are not modified — no new stone position is invented
  anywhere. `CupRenderer.js` is not modified or deleted (its own existing test suites keep passing
  unchanged); it is simply no longer imported/called by `app.js`.
* `#exportCup`'s existing `canvas.toBlob()` capture keeps working unmodified because the new
  `WebGLRenderer` is created with `preserveDrawingBuffer: true`.

## Rules

* Follow `docs/AI_ENGINEER.md`, `docs/CLAUDE_GUIDE.md`, `docs/ARCHITECTURE.md`.
* Smallest coherent change; no unrelated refactoring.
* Forbidden files (do not touch): `src/geometry/**`, `src/export/**`, `src/core/**`, `src/text/**`,
  `src/fonts/**`, `src/browser/**`, `src/svg/**`, `src/history/**`, `src/products/**`,
  `src/renderer/**`, `assets/**`, `examples/**`, `style.css`, `README.md`, `LICENSE`,
  `CONTRIBUTING.md`. (Every one of these is independently protected by an existing prior
  milestone's own "no forbidden file changed" guard test, which checks live `git status`, not a
  historical diff — touching any of them would fail an already-passing test.)
* Do not commit failing tests.
* Five existing guard tests required a narrow, documented update because `app.js` legitimately no
  longer imports/calls `renderCup`/`CupRenderer.js` (replaced by `createPreview3D`/
  `preview3D.update()`): `tools/test-app-module-migration.mjs`,
  `tools/test-shape-geometry-integration.mjs` (import allowlist), `tools/test-render-export-pipeline.mjs`,
  `tools/test-object-template-integration.mjs` (the `renderCup(...)` call-site assertion),
  `tools/test-ux-visual-polish.mjs` (its two `CUP_ROTATION_SENSITIVITY` tests, updated to verify the
  successor `OrbitControls` configuration instead). See the specification's "Allowed Files" section.

## Deliverables

* Implementation: `src/preview3d/ObjectDimensions.js`, `src/preview3d/StoneLayoutTexture.js`,
  `src/preview3d/ObjectGeometryBuilder.js`, `src/preview3d/Preview3DRenderer.js`,
  `src/preview3d/index.js`, `src/preview3d/README.md`, `app.js`, `index.html`, `package.json`,
  `docs/ARCHITECTURE.md`.
* Automated tests: `tools/test-object-dimensions.mjs`, `tools/test-stone-layout-texture.mjs`,
  `tools/test-object-geometry-builder.mjs`, `tools/test-preview3d-integration.mjs`, registered in
  `package.json`; five existing guard tests narrowly updated (see above).
* `npm test` passing in full (all prior suites + the four new ones).
* Browser verification via a real headless-Chrome session per the specification's checklist.
* `TASK_RESULT.md` completed.
* One commit on `feature/rs-1006-real-3d-preview`.
