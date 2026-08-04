# RS-1009 — Alignment & Snapping

## Objective

Make layer placement fast, precise, and predictable: multi-select layers, align/distribute them
with one click, and snap them to the canvas, safe area, and each other while dragging or nudging
with the keyboard.

## Current Repository State (inspected before writing this spec)

* `app.js` is the live browser application (single ad hoc `project` object, per
  `docs/ARCHITECTURE.md`'s documented "two project models" gap — unchanged by this milestone).
  Selection is a single `selectedLayerId` string. Mouse interaction is one `pointerdown`/
  `pointermove`/`pointerup` trio on `#layout` driving one `drag` object; `hitTest()` resolves a
  pointer position to a layer + `move`/`resize` kind via each layer's bounding box
  (`getLayerBBox()`, mm) and 8 resize handles (`handlesFor()`).
* Layer position is per-type: `circle` uses `cx`/`cy`; `rectangle`/`svg`/`image` use `x`/`y`/`w`/`h`.
  **`text` layers have no position field at all** — `generateTextStonesLive()` always
  auto-centers generated stones on the canvas (`offsetX`/`offsetY` in `app.js`), and `hitTest()`
  deliberately returns `kind:'select'` (not `'move'`) for `type==='text'`, so text layers are
  currently not draggable. This milestone adds optional `x`/`y` offset fields to text layers
  (see "Text layer position" below) so text and curved text become movable/alignable/snappable
  like every other layer type, without changing default (centered) behavior for existing projects.
* Undo/redo (`src/history/HistoryManager.js`, RS-1002) is a generic JSON-snapshot stack; `app.js`
  calls `commitHistory()` once per discrete action and `openHistorySession()`/
  `closeHistorySession()` around continuous field edits. Movement in this milestone reuses
  `commitHistory()` exactly once per completed drag or key press — no new history primitive
  is needed.
* `src/products/index.js`'s `getSafeAreaRectMm(template, canvasWidthMm, canvasHeightMm)` returns
  `{xMm,yMm,widthMm,heightMm}` for the active object template's safe area — already computed and
  drawn as a guide overlay by `drawSafeAreaGuide()`; this milestone's snapping reuses the same
  function, does not change it.
* There is no `src/editing/**` module yet.

## Expected Visible Change

* Layer rows and canvas shapes can be multi-selected (shift-click toggles); clicking empty canvas
  clears the selection.
* A new "Align & Snap" sidebar section (placed directly under the Layers list, so it is visible
  without scrolling) exposes six align buttons, two distribute buttons (disabled until enough
  layers are selected), and a Snap to guides on/off toggle.
* Dragging a layer (or a multi-selected group) on the 2D canvas snaps to canvas center/edges, the
  safe-area rectangle's edges/center, and other visible layers' edges/centers, showing temporary
  magenta guide lines while a snap is active.
* Arrow keys move the current selection by a small mm step; Shift+Arrow moves by a larger step.
* Text and curved-text layers become draggable/movable for the first time (previously fixed to the
  canvas center).

## Required Outcome

See the milestone brief (verbatim goal: "Make layer placement fast, precise, and predictable").
Summary of scope, mapped onto this repository:

**Selection**
* Multi-select via Shift-click, on both the canvas and the layers list (one shared toggle
  implementation, see "No second selection model" below).
* Clicking empty canvas clears the selection.
* Plain click (no Shift) still selects exactly one layer, preserving all pre-existing
  single-selection behavior (`selectedLayerId` keeps driving the per-layer property panel exactly
  as before).

**Alignment** (align left / horizontal-center / right / top / vertical-center / bottom) — enabled
at 2+ selected layers, aligns to the union bounding box of the current selection.

**Distribution** (horizontal / vertical) — enabled at 3+ selected layers, equalizes center-to-center
spacing along the chosen axis, holding the two extreme layers fixed.

**Snapping** — during mouse drag only (not keyboard nudge, not align/distribute):
canvas center, canvas edges, safe-area edges/center, and other visible (non-dragged) layers' edges
and centers, all within one named tolerance constant. Temporary guide lines are drawn while a snap
is active during the drag and cleared on pointerup. A sidebar toggle enables/disables snapping;
disabling it makes drag movement exactly raw pointer delta (unchanged from before this milestone).

**Movement**
* Mouse drag already existed for circle/rectangle/svg/image; extended to snap and to move a whole
  multi-selection together (uniform delta applied to every selected layer, so relative positions
  are preserved) and to text/curved-text layers (new optional `x`/`y` offset fields).
* Arrow keys nudge the current selection by `NUDGE_STEP_MM`; Shift+Arrow uses
  `NUDGE_STEP_LARGE_MM`. Both ignore keystrokes while a text/number input or `<select>` has focus
  (matching the existing Delete/Backspace guard).
* One `commitHistory()` call per completed drag (already the existing pattern) and per key press
  (one keydown = one discrete action = one undo step) — never one per intermediate pointermove/
  mm of movement.

## Architecture Requirements

* New module: `src/editing/**` — pure, DOM-free, framework-agnostic logic:
  * `EditingConstants.js` — `SNAP_TOLERANCE_MM`, `NUDGE_STEP_MM`, `NUDGE_STEP_LARGE_MM`.
  * `AlignmentEngine.js` — `alignLayers(items, direction)`, `distributeLayers(items, axis)`. Pure
    functions over `{id, bbox:{xMm,yMm,widthMm,heightMm}}[]`, returning
    `Map<id,{dxMm,dyMm}>`. No DOM, no `Project`/`Layer`/`StoneLayout` types.
  * `SnapEngine.js` — `buildSnapTargets({canvasWidthMm,canvasHeightMm,safeAreaRectMm,
    layerBBoxes})` and `computeSnapOffset(dragBBoxMm, targets, toleranceMm)`. Pure geometry over
    plain mm numbers; returns `{dxMm,dyMm,guides}`.
  * `Selection.js` — `selectOnly(id)`, `toggleSelection(selectedIds, id)`, `clearSelection()`. Pure
    `Set<string>` helpers; the *one* selection-mutation implementation `app.js` calls from every
    entry point (canvas click, layers-list click, layer dropdown, new/duplicate/delete/import) —
    satisfying "no second selection model": there is exactly one place that knows how a selection
    changes, and `app.js`'s `selectedLayerIds: Set<string>` is the one piece of state it mutates.
  * `index.js` — barrel, mirroring every other permanent module's "consumed only through its
    barrel" convention.
* `app.js` is the only caller. It computes each layer's bounding box (existing `getLayerBBox()`,
  unchanged in shape), converts it to the `{xMm,yMm,widthMm,heightMm}` shape the editing module
  expects, calls the editing module for the *decision* (which direction/offset/snap), and performs
  the *application* itself via two small new per-type helpers, `getLayerPosition(layer)` /
  `setLayerPosition(layer,xMm,yMm)` — because only `app.js` knows each layer type's field names
  (`cx`/`cy` vs `x`/`y`), matching this repository's existing "orchestration lives in `app.js`,
  layer-type-awareness never leaks into a permanent module" convention (see `drawSelection()`/
  `hitTest()`, which already work this way).
* `src/geometry/**`, `src/renderer/**`, `src/export/**`, `StoneLayout`, `Stone` are **not**
  imported by `src/editing/**` and are not modified by this milestone. Snapping/alignment operate
  entirely on layer bounding boxes in mm (`getLayerBBox()`'s existing output), never on generated
  stone positions directly, and never trigger a second geometry generation pass — every move still
  flows through the pre-existing `Project -> updateAll() -> GeometryEngine -> StoneLayout` pipeline
  exactly once per change.
* `StoneLayout`/`Stone`/`GeometryEngine`'s public shape is unchanged. Project JSON gains one
  optional, permissively-defaulted pair of fields (`x`/`y` on `text` layers, default `0`) — not a
  schema version bump, matching this repository's existing precedent for every previous
  milestone's new optional layer field (`curveEnabled`, `threshold`, etc.).
* Undo/redo, export, and save/load are reused unmodified: selection (`selectedLayerId`/
  `selectedLayerIds`) is intentionally **not** part of `project` and is therefore not part of the
  undo/redo snapshot or of exported Project JSON — matching the existing treatment of `rotation`/
  `zoom` (view-only state). Re-opening a saved project always starts from
  `selectedLayerIds = {first layer}`, regardless of what was selected when it was saved.

## Text Layer Position

Add two new optional per-text-layer fields, `x`/`y` (mm), read via `layer.x||0`/`layer.y||0`
everywhere they are consulted — so a Project JSON file saved before this milestone (no `x`/`y` on
its text layers) opens with byte-identical rendered output (offset `0,0` from the pre-existing
auto-centered position). `generateTextStonesLive()`'s existing auto-center calculation
(`offsetX`/`offsetY`) becomes the base position; `x`/`y` are added on top as a further mm offset,
so autoFit/height/curve behavior is completely unchanged. `hitTest()` now returns `kind:'move'`
(never `'select'`) for text, matching every other layer type; text still never gets resize handles
(unchanged — text has no `w`/`h` to resize).

## Allowed Files

* New: `src/editing/EditingConstants.js`, `src/editing/AlignmentEngine.js`,
  `src/editing/SnapEngine.js`, `src/editing/Selection.js`, `src/editing/index.js`,
  `src/editing/README.md`.
* New tests: `tools/test-alignment-engine.mjs`, `tools/test-snap-engine.mjs`,
  `tools/test-editing-selection.mjs`, `tools/test-alignment-snapping-integration.mjs`.
* Modified: `app.js`, `index.html`, `package.json`, `docs/ARCHITECTURE.md`, `TASK.md`,
  `TASK_RESULT.md`, `docs/specifications/RS-1009-AlignmentSnapping.md` (this file).

## Forbidden Files

`src/geometry/**`, `src/renderer/**`, `src/export/**`, `src/text/**`, `src/fonts/**`,
`src/core/**`, `src/browser/**`, `src/svg/**`, `src/image/**`, `src/history/**`,
`src/products/**`, `src/preview3d/**`, `style.css`, `README.md`, `LICENSE`, `CONTRIBUTING.md`,
`assets/**`, `examples/**`.

## Out of Scope

Rotation, arbitrary user-created guides, smart-spacing labels, rulers, grid customization, locking
layers, grouping layers, boolean operations, changing geometry algorithms, changing export
schemas. Resize-handle drags are not snap-aware (only move drags are) — resizing is unchanged from
its pre-existing behavior. Multi-layer delete is not added (delete still targets one layer, per
existing `deleteLayer()` — grouping/locking are explicitly out of scope and multi-delete was not
requested).

## Known Deferred Issue

S-004 (duplicated text in some 3D preview cases) remains deferred, unrelated to this milestone.

## Automated Tests

* `tools/test-alignment-engine.mjs` — `alignLayers()` all six directions (including a >=2 item
  requirement and a union-bbox reference check), `distributeLayers()` horizontal/vertical
  (including the >=3 item requirement and an equal-center-spacing check), invalid-input errors.
* `tools/test-snap-engine.mjs` — canvas-center snap, canvas-edge snap, safe-area edge/center snap,
  layer-edge/center snap, tolerance boundary (just inside vs. just outside snaps), no-snap-found
  returns a zero offset and no guides.
* `tools/test-editing-selection.mjs` — `selectOnly`/`toggleSelection` add/remove/clear, toggling
  twice is a no-op, immutability (never mutates the input Set).
* `tools/test-alignment-snapping-integration.mjs` — structural/behavioral checks against the live
  `app.js`/`index.html`: multi-select add/remove/clear via simulated clicks, all six align
  directions move layers to the expected result, distribution, keyboard nudge (small/large step),
  grouped multi-layer movement preserves relative offsets, one `commitHistory()` per drag/key
  action, undo/redo restores pre-move state, save/reopen (Project JSON round trip) is
  selection-independent, every supported layer type (text, curved text, circle, rectangle, svg,
  image) is movable/alignable, forbidden-file guard, and that all pre-existing suites remain green.
* Re-run full `npm test` — all pre-existing suites must stay green.

## Browser/Manual Verification

Select multiple mixed layer types; align and distribute; drag with visible snap guides; snap to
center/edges/safe-area/other layers; toggle snapping off and confirm raw (unsnapped) drag; arrow-key
movement (small and large step); undo/redo; save and reopen a project; verify all 8 export buttons
still succeed and produce output; zero relevant console errors; screenshots of guides mid-drag and
of aligned/distributed layers.

## Implementation Constraints

Smallest coherent change. No rotation. No new selection model — one `Set<string>` in `app.js`,
mutated only through `src/editing/Selection.js`'s three pure functions. No `StoneLayout`/
`GeometryEngine` change. Millimeters throughout (no pixel math outside the existing mm<->px canvas
transform).

## Required Commands

```bash
npm test
git diff --check
git status
npm run dev   # browser verification
```

## Commit Message

`feat(editing): multi-select, align/distribute, and drag/keyboard snapping (RS-1009)`

## Deliverables

Implementation, tests, `TASK_RESULT.md`, one commit on `feature/rs-1009-alignment-snapping`, pushed
branch.

## Next Milestone

Candidates: rotation support, user-created guides, layer grouping/locking — all explicitly out of
scope here.
