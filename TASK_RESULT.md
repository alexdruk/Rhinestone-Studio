# Rhinestone Studio — Task Result

This document is completed by the implementation engineer after finishing the current task.

---

# Task ID

S-104 — Text Position Recovery & Drag Tuning

---

# Status

IMPLEMENTED

---

# Branch

feature/s-104-text-position-recovery-drag-tuning

---

# Commit

Do not write the current commit hash into this file — this file is part of the same commit it
describes. Obtain it from Git history with:

```bash
git log -1 --oneline
```

---

# Audit Findings

Full detail in `docs/specifications/S-104-TextPositionRecoveryDragTuning.md`. Summary:

* **Move-drag was a 1:1 pointer-to-mm mapping.** `app.js`'s `layoutCanvas` `pointermove` handler
  applied `rawDx`/`rawDy` (from `pointerToLayout(e)`) to the dragged selection's position verbatim.
  One CSS pixel of pointer movement always produced the same mm movement, making fine text placement
  imprecise — text has no resize handles to fall back on (`hitTest()` explicitly excludes text from
  resize-handle hits). This is the same class of "unexplained inline drag multiplier"
  `docs/ARCHITECTURE.md` had already called out and fixed once before, for cup rotation
  (`CUP_ROTATION_SENSITIVITY`, since removed when `OrbitControls` took over rotation).
* **A text layer has no persisted absolute position of its own.** `computeTextPlacementOffset()`
  (RS-1009/RS-1012, unchanged) always auto-centers the generated bounding box on the full production
  canvas, then adds `layer.x`/`layer.y` on top — so a text layer's rendered world-center is always
  exactly `(canvas.width/2 + layer.x, canvas.height/2 + layer.y)`, independent of its content, font,
  or size. There was no UI action using this fact to recover a lost layer, and no reset affordance on
  the Text Lightbox's existing `#textX`/`#textY` inputs.
* **The printable area is `getSafeAreaRectMm()`** (`src/products/ObjectTemplate.js`, unchanged),
  already used for the safe-area guide and drag-snap targets. Every current object template
  (Mug/Tumbler/Bottle) has symmetric insets, so its center currently coincides with the raw canvas
  center — the implementation reads the safe-area rect rather than relying on that coincidence, so it
  stays correct if an asymmetric template is ever added.
* **Recovery path already half-existed.** The Layers-list row selection (RS-1009) already lets an
  operator select a layer regardless of whether it is currently visible on-canvas — the missing piece
  was purely a position-only reset action once selected.

---

# Implementation Summary

* `app.js` — new named constant `LAYER_MOVE_DRAG_SENSITIVITY = 0.5`, applied to the move-drag delta
  (`dx=rawDx*LAYER_MOVE_DRAG_SENSITIVITY,dy=rawDy*LAYER_MOVE_DRAG_SENSITIVITY`) before snapping/
  Shift-axis-lock/position-apply. Resize-drag and keyboard nudge are structurally untouched.
* `app.js` — new `centerSelectedTextOnObject()`: guards to text-only selections, computes the target
  `(x,y)` from `getSafeAreaRectMm(currentObjectTemplate(), project.canvas.width,
  project.canvas.height)`, writes only `l.x`/`l.y`, and follows the exact same
  `commitHistory()` → mutate → `syncSelectedControlsFromLayer()`+`updateAll(true)` → `#status` pattern
  every other mutating action (`runAlign`/`runDistribute`/`nudgeSelection`) already uses.
* `index.html` — new `Center on Object` button (`#centerTextOnObject`, reusing the existing `.btn .sm`
  class — no new CSS) in the Text Lightbox's existing Position section, under `#textX`/`#textY`, plus
  one sentence added to the section's existing hint paragraph pointing at it for the "dragged my text
  away" scenario.
* No changes to `GeometryEngine`, `StoneLayout`, any renderer (`src/renderer/**`, `src/preview3d/**`),
  any exporter (`src/export/**`), the project/layer schema (no field added/removed/renamed —
  `layer.x`/`layer.y` already existed since RS-1009), Design Library (`src/library/**`), or Gallery
  (`src/gallery/**`).

---

# Files Changed

**New (2):**
```
docs/specifications/S-104-TextPositionRecoveryDragTuning.md
tools/test-s104-text-position-recovery-drag-tuning.mjs
```

**Modified (6):**
```
app.js                                          — LAYER_MOVE_DRAG_SENSITIVITY, centerSelectedTextOnObject()
index.html                                      — Center on Object button + hint sentence
package.json                                    — new test wired into the `test` script
tools/test-alignment-snapping-integration.mjs   — one assertion updated for the intentional sensitivity change
TASK.md                                         — this milestone's task definition
TASK_RESULT.md                                  — this file
```

---

# Test Results

```bash
$ npm test
```

831 checks run, **0 failures**, exit code 0. Includes the new
`tools/test-s104-text-position-recovery-drag-tuning.mjs` suite (9/9 passing) and the updated
`tools/test-alignment-snapping-integration.mjs` (28/28 passing, including the one assertion this
milestone deliberately changed). Every other pre-existing suite (font/geometry/history/editing/
alignment/snapping/export/preview3D/image/Gallery/Design Library/Typography/Project-Model-
Consolidation/etc.) passes unchanged.

```bash
$ git diff --stat HEAD~1..HEAD
```
(run after commit — see `git log -1 --oneline` for the commit this refers to)

---

# Browser Verification

Real headless Chromium (Playwright, project's local `node_modules`), `npm run dev`
(`python3 -m http.server 5173`), 1440×900 viewport, 2D-Canvas-only view. All steps against the actual
running app (no mocks):

1. **Moderate drag, reduced sensitivity confirmed live.** A 200×100 CSS-px drag from the default
   `(0,0)` text position landed at `(50.56, 26.51)` mm — proportional, controllable movement. Undo
   returned it to exactly `(0, 0)`.
2. **Text can still be positioned anywhere, including fully outside the printable area.** A
   1400×900 CSS-px drag moved the text to `(366.79, 235.80)` mm — far outside the 210×90mm mug canvas
   (safe area 182×70mm). Screenshot confirms the stones render clearly outside the printable-area
   guide rectangle.
3. **Center on Object immediately restores visibility.** Selected the text layer via the Layers list,
   opened More Options → Text Lightbox, clicked **Center on Object**: Position X/Y immediately read
   `(0, 0)`, `#status` read "Centered text on the printable area", and the screenshot shows the text
   stones back inside the printable-area grid. Font (`courier-prime-regular`), height (`25`), auto-fit,
   fill style (`stroke`), stone size (`2`), color (`gold`), and curve setting (`off`) were verified
   byte-identical before and after via a full property snapshot comparison (not just visual).
4. **Undo/Redo still works.** After closing the lightbox, Undo returned Position X/Y to the
   off-canvas `(366.79, 235.80)`; Redo returned to `(0, 0)` — one history step each, as intended.
5. **Console.** Zero console errors or page errors captured across the entire session (no favicon
   warning was even triggered in this run).

Screenshots captured at every step (initial state, after moderate drag, after off-canvas drag, Text
Lightbox open on an off-canvas layer, after Center on Object, after undo/redo).

---

# Recommendation

Approve and merge. Both requirements — reduced, more predictable drag sensitivity and a one-click,
position-only recovery action — are implemented as the smallest coherent change on top of existing,
already-tested infrastructure (`getSafeAreaRectMm`, `commitHistory`/`HistoryManager`, the Layers-list
selection path). No new geometry, no new storage, no schema change, and none of the explicitly
forbidden modules (`GeometryEngine`, `StoneLayout`, project schema, exporters, rendering, Design
Library, Gallery) were touched — enforced by an automated forbidden-file-prefix check in the new test
suite. The `0.5` sensitivity constant is a reasonable, easily-retunable default if real usage calls
for a different value.
