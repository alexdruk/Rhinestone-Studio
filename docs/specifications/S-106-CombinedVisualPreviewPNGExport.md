# S-106 — Combined Visual Preview PNG Export

## Task ID

S-106

## Type

Small, additive export feature. No new production features beyond one export option, no
GeometryEngine/StoneLayout/project-schema/production-geometry/existing-export-output changes.

## Status

IMPLEMENTED

## Branch

feature/s-106-combined-visual-preview-png-export

## Objective

Add one new Export option, "Export Combined Preview PNG", that produces a single PNG with the
current 2D Canvas on the left and the current Object Preview (3D) on the right, side by side, on a
white background, reflecting exactly what the operator currently sees (including whatever 3D
rotation/zoom is live) — without requiring the operator to switch to the Object Preview tab first.

## Audit Findings (verified against the live repository before implementation)

1. **Both canvases are already real, always-rendered DOM elements, independent of which workspace
   tab is active.** `app.js:407`: `const layoutCanvas=el('layout'),cupCanvas=el('cup')`. Both are
   permanently mounted `<canvas>` elements; `index.html`'s `.canvas-panel` CSS rule
   (`.canvas-panel{position:absolute;inset:...}` / `.tab-hidden{visibility:hidden;pointer-events:none}`)
   deliberately never uses `display:none` — its own comment explains why: "a canvas whose box
   collapses to 0x0 while 'hidden' would size its 3D renderer to 0x0 too, silently producing a blank
   Object Preview PNG export if a user never opened the 3D tab first." This existing invariant, plus
   the default `workspaceMode='dual'` (`app.js:1209`, both panels shown side by side out of the box),
   is what already makes requirement 6 (works immediately after startup, no tab switch required)
   true structurally — no new code was needed to satisfy it.
2. **2D Canvas (`layoutCanvas`/`#layout`) is redrawn on every `updateAll()`** via `drawLayout()`
   (`app.js:530`), a plain 2D `CanvasRenderingContext2D` raster of the current `layout`
   (`src/renderer/CanvasRenderer2D.js`'s `renderProductionLayout`). Its backing pixel size is set by
   `resizeCanvas()` (`app.js:528`) from the panel's live `getBoundingClientRect()` × `devicePixelRatio`.
3. **Object Preview (`cupCanvas`/`#cup`) is a live, continuously-animating Three.js
   `WebGLRenderer`** (`src/preview3d/Preview3DRenderer.js`), constructed with
   `preserveDrawingBuffer: true` (line 56) specifically so its canvas's pixel buffer is readable by
   `drawImage`/`toBlob` after the fact — the same precondition `#exportCup` (`app.js:1043`,
   pre-existing) already relies on. `drawCup()` (`app.js:793`) calls `preview3D.syncView(rotation,zoom)`
   every `updateAll()`, so the canvas always reflects the operator's live rotation/zoom/orbit state,
   including manual `OrbitControls` mouse-drag not tracked by the `rotation`/`zoom` variables at all —
   capturing the canvas's actual pixels (not re-deriving a view from `rotation`/`zoom`) is required to
   preserve that.
4. **`#exportPNG`/`#exportCup` (`app.js:1042-1043`) already establish the precedent this milestone
   reuses verbatim**: both are a plain `canvas.toBlob(...)` capture of an existing, already-rendered
   `<canvas>` element (`exportCanvas()`, `app.js:807`) — "capture, not a standalone exporter." No
   `src/export/**` module renders PNG for either; this milestone's combined export follows the exact
   same shape: composite the two existing canvases' pixels onto one offscreen `<canvas>`, then reuse
   `exportCanvas()` unchanged.
5. **The Export Lightbox (`index.html:727-751`, `#lightboxExport`) already groups "Visual previews"**
   (`2D SVG` / `2D PNG` / `3D / Object Preview PNG`) as one `.export-group` — the natural, minimal
   location for a fourth sibling button, no new Lightbox/dialog needed.
6. **`createPreview3D()`'s async mount** (`src/preview3d/index.js`) means `cupCanvas` has no rendered
   pixels until the dynamic `import('three')` + `WebGLRenderer` init resolves, a few tens of
   milliseconds after page load. This is a pre-existing characteristic `#exportCup` already carries
   unchanged (no readiness gate exists there either) — by the time an operator has clicked the Export
   top-menu button and then a button inside the resulting Lightbox, that window has already elapsed in
   every real-world interaction. Verified empirically in browser testing below (default `dual` startup,
   immediate export, no tab switch).

## Decision: reuse, not re-render

The combined PNG is built by drawing the two existing canvas elements' **current pixel content**
onto a new offscreen canvas, at each source canvas's own native pixel size (no rescale/stretch) —
not by invoking any renderer a second time. This is the smallest change that satisfies "reflects the
current visible project state" and "preserve the current 3D rotation/view" simultaneously: the
already-rendered pixels are, by construction, exactly what the operator currently sees on screen,
including manual orbit-drag state that isn't captured in any tracked variable.

## Implementation Summary

* **`index.html`** — one new button, `#exportCombined` ("Export Combined Preview PNG"), added to the
  existing "Visual previews" `.export-group` inside `#lightboxExport`, alongside `2D SVG` / `2D PNG` /
  `3D / Object Preview PNG`. No new Lightbox, no new CSS rule beyond an inline `margin-top` matching
  the group's existing spacing convention.
* **`app.js`** — new `composeCombinedPreviewCanvas()`: creates an offscreen `<canvas>`, fills it
  white, then `drawImage`s `layoutCanvas` (left) and `cupCanvas` (right) at their own native pixel
  dimensions with a fixed DPR-scaled margin/gap between and around them (vertically centered on
  whichever of the two is taller, so neither panel is stretched or clipped when their aspect ratios
  differ). `#exportCombined`'s `onclick` handler mirrors `#exportPNG`/`#exportCup` exactly: the same
  `if(!layout){...return}` guard, the same `exportCanvas(name, canvas)` reuse, the same `try/catch`
  → `el('status').textContent` error path. No new export module, no new render/generation call.
* No change to `GeometryEngine`, `StoneLayout`, the project schema, production geometry
  (`src/geometry/**`), any existing exporter (`src/export/**`), or any existing export's output —
  `#exportPNG`, `#exportCup`, `#exportSVG`, Production Sheet exports, and Project/Layout JSON exports
  are byte-identical in behavior to `develop`.

## Out of Scope

* Configurable layout (stacked vs. side-by-side, custom gap/margin, custom canvas order) — the
  specification asks for one fixed layout (2D left, Object Preview right).
* Capturing menus, Lightboxes, side panels, or browser chrome — explicitly excluded by requirement 4;
  the implementation only ever touches the two canvas elements' own pixel buffers, never `html2canvas`
  or a full-viewport screenshot.
* A readiness gate/spinner for the Object Preview's async Three.js mount — out of scope per the
  "reuse existing... logic" instruction; this milestone carries the same pre-existing, already-shipped
  characteristic `#exportCup` has always had (see Audit Finding 6).

## Testing

`tools/test-s106-combined-visual-preview-png-export.mjs` — structural checks against the live
`index.html`/`app.js` source (this repository's established "check the live source" convention),
plus a forbidden-file `git status` check. Real interactive rendering is verified with a real browser
(Playwright, headless Chromium) and recorded in `TASK_RESULT.md`.
