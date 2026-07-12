# 3D Preview

Real, interactive Three.js preview of the active object template (mug / straight tumbler /
bottle), replacing the previous schematic 2D "cup preview" (`src/renderer/CupRenderer.js`, which
still exists and is still tested, but is no longer wired into `app.js`).

Consumes only a `StoneLayout` plus plain display options — the same contract every renderer in
this repository follows. Never generates a `StoneLayout`, never reads a `Project`/`Layer`, never
invents a stone position, and never modifies `src/geometry/**` or `src/export/**`.

```js
import { createPreview3D } from './src/preview3d/index.js';

const preview3D = createPreview3D(canvasElement); // synchronous — Three.js loads lazily

preview3D.update(stoneLayout, {
  cupColor: '#1f3556',
  wrap: 'front', // 'front' | 'wide' | 'half' | 'full'
  objectTemplate, // from src/products/index.js
  canvasWidthMm: project.canvas.width,
  canvasHeightMm: project.canvas.height
});

preview3D.syncView(rotationDeg, zoom); // only repositions the camera when these actually changed
preview3D.resetView();
```

## Module map

* `ObjectDimensions.js` — pure mm-scale math (no Three.js, no DOM). Derives real body radius/height
  (and, for bottles, neck/shoulder/cap extents) from an `ObjectTemplate` record plus the live
  project canvas size.
* `StoneLayoutTexture.js` — pure Canvas-2D texture drawing (no Three.js, no canvas creation — the
  caller supplies the 2D context). Draws the object's base color plus every stone at its true mm
  position, at a fixed px-per-mm resolution.
* `ObjectGeometryBuilder.js` — Three.js geometry construction: a tapered open cylinder for
  mug/tumbler, a lathe-revolved profile for the bottle's body+shoulder+neck+cap, and a
  tube-geometry handle for the mug. Also exports `applyWrapUv()`, which maps the shared texture
  onto a wrap-mode-sized angular window on the body surface.
* `Preview3DRenderer.js` — the actual `WebGLRenderer`/lighting/camera/`OrbitControls`/resize/
  animation-loop orchestration. Three.js and `OrbitControls` are dynamic-imported inside `init()`.
* `index.js` — the only module `app.js` imports statically; returns a synchronous facade that
  queues calls until `Preview3DRenderer.js` finishes its lazy Three.js load.

## Loading Three.js (no bundler)

This repository has no bundler — every dependency is loaded either via the browser's native
`<script type="importmap">` or by a relative path straight into `node_modules/**`, exactly like
`src/browser/OpenTypeBrowserAdapter.js` already does for `opentype.js`. `index.html`'s import map
resolves the bare specifier `three` to `node_modules/three/build/three.module.js` (Three.js' own
native ES module build); `OrbitControls` is imported by relative path into
`node_modules/three/examples/jsm/controls/OrbitControls.js` (its own internal `import ... from
'three'` is what the import map resolves).

## Interaction

Mouse/touch rotate, zoom, and pan are handled entirely by `OrbitControls` on the canvas — there is
no custom pointer-drag code here. The Rotation slider, Zoom slider, Front/Left/Right/Back preset
buttons, and Reset view button in `app.js` drive the same camera via `syncView()`/`resetView()`,
but only reposition it when their value actually changed, so an unrelated project edit never
interrupts a manual orbit/pan already in progress.

## Out of scope

PBR materials, HDR/environment lighting, shadows, animation, multiple simultaneous objects, custom
mesh/GLTF import — see `docs/specifications/RS-1006-Real3DPreview.md`.
