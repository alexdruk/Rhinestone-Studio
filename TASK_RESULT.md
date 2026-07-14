# Rhinestone Studio — Task Result

This document is completed by the implementation engineer after finishing the current task.

---

# Task ID

S-106 — Combined Visual Preview PNG Export

---

# Status

IMPLEMENTED

---

# Branch

feature/s-106-combined-visual-preview-png-export

---

# Commit

Do not write the current commit hash into this file — this file is part of the same commit it
describes. Obtain it from Git history with:

```bash
git log -1 --oneline
```

---

# Audit Findings

Full detail in `docs/specifications/S-106-CombinedVisualPreviewPNGExport.md`. Summary:

* **Both canvases are already real, always-rendered DOM elements, independent of the active
  workspace tab.** `layoutCanvas`/`#layout` and `cupCanvas`/`#cup` (`app.js:407`) are permanently
  mounted. `index.html`'s `.canvas-panel` rule deliberately never uses `display:none` — its own
  comment explains why: a collapsed 0×0 box would size the 3D renderer to 0×0 too, "silently
  producing a blank Object Preview PNG export if a user never opened the 3D tab first." Combined with
  the default `workspaceMode='dual'` (both panels shown side by side on load), this existing
  invariant already satisfies requirement 6 (works immediately after startup, no tab switch) —
  no new code was needed for it.
* **The Object Preview canvas is a live, continuously-animating Three.js `WebGLRenderer`**
  (`src/preview3d/Preview3DRenderer.js`), constructed with `preserveDrawingBuffer:true` specifically
  so its pixel buffer stays readable after the fact — the same precondition the pre-existing
  `#exportCup` handler already relies on. `drawCup()` calls `preview3D.syncView(rotation,zoom)` on
  every `updateAll()`, and `OrbitControls` mutates the camera directly on manual mouse-drag — so
  capturing the canvas's actual current pixels (rather than re-deriving a view from any tracked
  variable) is what preserves the operator's live rotation/zoom/orbit state.
* **`#exportPNG`/`#exportCup` already establish the reuse precedent this milestone follows
  verbatim**: both are a plain `canvas.toBlob(...)` capture of an already-rendered `<canvas>` element
  via the existing `exportCanvas()` helper — "capture, not a standalone exporter." No `src/export/**`
  module renders PNG for either.
* **The Export Lightbox already groups "Visual previews"** (2D SVG / 2D PNG / Object Preview PNG) as
  one `.export-group` — the natural location for a fourth sibling button; no new dialog needed.
* **`createPreview3D()`'s Three.js mount is async** (`src/preview3d/index.js`), so `cupCanvas` has no
  rendered pixels for a few tens of milliseconds after page load. This is a pre-existing
  characteristic `#exportCup` already carries unchanged (no readiness gate exists there either); by
  the time an operator clicks the Export menu button and then a button inside the resulting Lightbox,
  that window has always already elapsed. Verified empirically below (default `dual` startup export,
  no tab switch, real content captured on the right).

---

# Implementation Summary

* **`index.html`** — one new button, `#exportCombined` ("Export Combined Preview PNG"), added inside
  the existing "Visual previews" `.export-group` in `#lightboxExport`, alongside the existing
  `2D SVG` / `2D PNG` / `3D / Object Preview PNG` buttons. No new Lightbox, no new CSS rule beyond an
  inline `margin-top` matching the group's own spacing.
* **`app.js`** — new `composeCombinedPreviewCanvas()`: creates an offscreen `<canvas>` sized from
  both source canvases' own live `width`/`height`, fills it white, then `drawImage`s `layoutCanvas`
  (left) and `cupCanvas` (right) at each canvas's own native pixel size (no scaling/stretching) with
  a fixed, DPR-scaled margin/gap, vertically centered on whichever panel is taller so neither is
  clipped when their aspect ratios differ. `#exportCombined`'s `onclick` handler mirrors
  `#exportPNG`/`#exportCup` exactly: the same `if(!layout){...return}` guard, the same
  `exportCanvas(name, canvas)` reuse, the same `try/catch` → `el('status').textContent` error path.
  No new export module, no new render/generation call — pure canvas-to-canvas compositing of pixels
  the app already rendered.
* No change to `GeometryEngine`, `StoneLayout`, the project schema, production geometry
  (`src/geometry/**`), any existing exporter (`src/export/**`), or any existing export's output —
  `#exportPNG`, `#exportCup`, `#exportSVG`, Production Sheet exports, and Project/Layout JSON exports
  are byte-identical in behavior to `develop`.

---

# Files Changed

**New (2):**
```
docs/specifications/S-106-CombinedVisualPreviewPNGExport.md
tools/test-s106-combined-visual-preview-png-export.mjs
```

**Modified (5):**
```
index.html                                — new #exportCombined button in the Export Lightbox's
                                             "Visual previews" group
app.js                                    — new composeCombinedPreviewCanvas() + #exportCombined
                                             onclick handler
package.json                              — new test wired into the `test` script
tools/test-production-export-validation.mjs — check 14's export-handler catch-count assertion
                                             updated from 8 to 9 for the new #exportCombined handler
TASK.md                                   — this milestone's task definition
```

No changes to `GeometryEngine`, `StoneLayout`, any renderer (`src/renderer/**`, `src/preview3d/**`),
any exporter (`src/export/**`), the project/layer schema, `src/library/**`, `src/gallery/**`,
`src/editing/**`, or `src/ui/**`.

---

# Test Results

```bash
$ npm test
```

All 68 test files in the `test` script pass, **871 checks total, 0 failures**.

New `tools/test-s106-combined-visual-preview-png-export.mjs` (9/9 passing) covers: `#exportCombined`
present exactly once in the "Visual previews" export group with the required label; the handler
guards on `!layout` and wraps in `try/catch` reporting via `#status`, matching the sibling export
handlers' exact shape; the handler reuses `exportCanvas()` (no new download/export code path);
`composeCombinedPreviewCanvas()` draws `layoutCanvas` before `cupCanvas` (left-to-right), each at its
own native pixel size with no scaling args; a white background is filled before either canvas is
drawn; the offscreen canvas is sized from both source canvases' live `width`/`height` (not a
hardcoded constant); the compositor calls no renderer/generation function (pure pixel copy); no
forbidden file changed.

One pre-existing test needed updating (the same "check the live source" pattern S-104/S-105 also hit
when adding a new sibling to an already-counted set): `tools/test-production-export-validation.mjs`
check 14 asserted an exact count of export handlers reporting failures via `#status` (previously 8:
5 original + 3 Production Sheet). Adding `#exportCombined`'s handler makes this 9 — updated the
assertion and its `id` list accordingly; all other assertions in that file were unaffected.

---

# Browser Verification

Headless Chromium (Playwright, this repo's local `node_modules`, `--use-gl=angle
--use-angle=swiftshader` for a realistic 3D-preview signal), `python3 -m http.server 5173` serving
the actual app (no mocks), 1440×900 viewport.

1. **Fresh page load, default Dual Workspace, export immediately (no tab switch).** Confirmed
   `#viewTabDual` is active by default. Clicked the Export top-menu shortcut, then
   `#exportCombined`, ~400ms after the page finished its own startup script execution (no manual
   switch to the Object Preview tab at any point) — the download fired and produced a real
   1016×680 PNG with both panels fully rendered (not blank), confirming requirement 6.
2. **Rotate Object Preview, export again.** Dragged the mouse across `#cup` (OrbitControls) to orbit
   the object, then re-opened Export and exported Combined Preview PNG again. The resulting PNG
   visibly differs from the first: the cup's handle rotated into view and the text wrapped toward the
   object's edge, near-silhouette — confirming the export captures the operator's live 3D
   rotation/zoom, not a stale or re-derived view.
3. **Neither image blank, clipped, stretched, or unreadable.** Both exports show the full 2D Canvas
   (grid, stones, dimension readout) on the left and the full Object Preview (cup body, handle,
   texture) on the right, each fully within its own frame, on a solid white background, with clean
   spacing between and around them — visually confirmed (see sample PNGs below).
4. **Existing PNG exports still work, byte-for-byte the same code path.** Exported `2D PNG`
   (`#exportPNG`) and `3D / Object Preview PNG` (`#exportCup`) independently after the above steps —
   both produced correct, non-blank PNGs matching the (rotated) on-screen state, confirming no
   regression to the pre-existing single-panel exports.
5. **Zero console/page errors** across the entire run (page load, both combined exports, both single
   exports, the OrbitControls drag).

**Sample exported PNGs:** published as an artifact — https://claude.ai/code/artifact/2ae0fb94-9443-4ea6-ab99-13cfbe046956
(default-orbit export and post-rotation export, side by side with capture metadata).

---

# Recommendation

Approve. All 8 numbered requirements are met as the smallest coherent change on top of existing,
already-tested infrastructure: the new button lives in the pre-existing "Visual previews" export
group, the compositor is a pure canvas-to-canvas pixel copy of the two panels the app was already
rendering (no new renderer, no re-generation, no new export module), and the handler reuses the
existing `exportCanvas()` capture helper verbatim. Requirement 6 (works immediately at startup, no
tab switch) falls out of an architectural invariant (`.tab-hidden` never collapses either canvas to
0×0) that already existed for exactly this reason before this milestone. `GeometryEngine`,
`StoneLayout`, the project schema, production geometry, every existing exporter, and every existing
export's output are byte-identical to `develop`.
