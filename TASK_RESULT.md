# Rhinestone Studio — Task Result

This document is completed by the implementation engineer after finishing the current task.

---

# Task ID

RS-1009 — Alignment & Snapping

---

# Status

IMPLEMENTED

---

# Branch

feature/rs-1009-alignment-snapping

---

# Commit

Do not write the current commit hash into this file — this file is part of the same commit it
describes. Obtain it from Git history with:

```bash
git log -1 --oneline
```

---

# Summary

Added multi-select, six align commands, two distribute commands, and drag/keyboard snapping to
the 2D Production Layout editor, in a new permanent module (`src/editing/**`) kept fully separate
from `src/geometry/**`/`src/renderer/**`/`src/export/**`. `app.js` is the only consumer.

**Selection.** A single `Set<string>` (`selectedLayerIds`) is the one multi-selection model,
mutated only through three pure functions in `src/editing/Selection.js`
(`selectOnly`/`toggleSelection`/`clearSelection`) — every entry point that changes selection
(canvas click, layers-list click, the layer dropdown, new/duplicate/delete/import) goes through
the same three functions. Shift-click toggles a layer on the canvas or the layers list; clicking
empty canvas clears the selection; a plain click on a layer not already selected collapses the
selection to just that layer (preserving pre-existing single-selection behavior exactly).
`selectedLayerId` (pre-existing) keeps driving the single-layer property panel unchanged.

**Alignment/distribution.** `src/editing/AlignmentEngine.js` exports pure `alignLayers(items,
direction)` (2+ items, aligns to the selection's union bounding box) and `distributeLayers(items,
axis)` (3+ items, equal center-to-center spacing, holding the two extreme layers fixed). Both
operate only on `{id, bbox:{xMm,yMm,widthMm,heightMm}}` — never on layer type or generated stones.

**Snapping.** `src/editing/SnapEngine.js` exports `buildSnapTargets()` (canvas center/edges,
safe-area edges/center via the existing `src/products/index.js` `getSafeAreaRectMm()`, and every
other visible layer's edges/centers) and `computeSnapOffset()` (nearest match per axis within a
named `SNAP_TOLERANCE_MM`, returning a delta plus guide-line descriptors). Guides are drawn as
temporary magenta lines during a drag and cleared on pointerup. A sidebar "Snap to guides" toggle
(`snapEnabled`, view-only state like `rotation`/`zoom`) fully gates the snap computation.

**Movement.** Two small new `app.js` helpers, `getLayerPosition(layer)`/
`setLayerPosition(layer,xMm,yMm)`, are the one place that knows a layer's position field names
(`cx`/`cy` for circle, `x`/`y` for everything else) — used uniformly by mouse drag, keyboard nudge,
align, and distribute, replacing the old drag code's three-type-special-case branch. Arrow keys
nudge the selection by `NUDGE_STEP_MM` (0.5mm); Shift+Arrow uses `NUDGE_STEP_LARGE_MM` (5mm); both
are guarded against hijacking text/number-field or `<select>` focus, exactly like the pre-existing
Delete/Backspace guard. A multi-layer drag moves every selected layer by one shared delta (computed
once from the selection's union bbox at drag start), preserving relative positions. Exactly one
`commitHistory()` call happens per completed drag (at drag start, pre-existing pattern) and per key
press (one keydown = one undo step).

**Text layers become movable.** Previously `text` layers had no position field at all — always
auto-centered on the canvas, and `hitTest()` returned a non-draggable `'select'` kind for them.
RS-1009 adds optional `x`/`y` mm offset fields (default `0`, read via `layer.x||0`), added on top
of the existing auto-center math with zero change to that math — a Project JSON file saved before
this milestone (no `x`/`y` on its text layers) renders byte-identical to before. `hitTest()` now
returns `'move'` for every layer type; text still never gets resize handles (unchanged). Curved
text (`curveEnabled:true`) uses the exact same `x`/`y` fields since it is still `type:'text'`.

**Selection/snap state is intentionally not persisted.** Like `rotation`/`zoom`, `selectedLayerIds`
and `snapEnabled` are never part of `project`, never in the undo/redo snapshot
(`currentSnapshot()`), and never in exported Project JSON. Reopening a saved project always starts
with a single-layer selection.

---

# Files Changed

**New:**
* `src/editing/EditingConstants.js`, `src/editing/AlignmentEngine.js`, `src/editing/SnapEngine.js`,
  `src/editing/Selection.js`, `src/editing/index.js`, `src/editing/README.md`.
* `tools/test-alignment-engine.mjs` (14 assertions), `tools/test-snap-engine.mjs` (12 assertions),
  `tools/test-editing-selection.mjs` (7 assertions), `tools/test-alignment-snapping-integration.mjs`
  (28 assertions).
* `docs/specifications/RS-1009-AlignmentSnapping.md`.
* `TASK_RESULT.md` (this file).

**Modified:**
* `app.js` — imports `src/editing/index.js`; new `selectedLayerIds`/`snapEnabled`/`activeGuides`
  state; `getLayerPosition()`/`setLayerPosition()`/`unionBBoxOfLayers()`/
  `selectedItemsForEditing()`/`applyPositionDeltas()`/`runAlign()`/`runDistribute()`/
  `nudgeSelection()`/`updateEditingUI()` helpers; rewritten `pointerdown`/`pointermove`/`pointerup`
  handlers on `#layout` (multi-select, group drag, drag-time snapping); `hitTest()` returns `'move'`
  for every layer type; `drawSelection()` draws every selected layer's box (handles only when
  exactly one is selected) and a new `drawGuides()`; arrow-key nudge in the global `keydown`
  handler; `defaultProject()`'s text layer gains explicit `x:0,y:0`; `generateTextStonesLive()`'s
  offset math adds `layer.x||0`/`layer.y||0` on top of the existing auto-center calculation;
  `duplicateLayer()` nudges a duplicated text layer's new `x`/`y` by +8mm (matching every other
  layer type's existing convention); every layer-creation/deletion/import site now also resets
  `selectedLayerIds`; Align/Snap button and `snapEnabled` wiring.
* `index.html` — new "Align & Snap" sidebar section (six align buttons, two distribute buttons,
  snap toggle, selection-count summary, a Shift-click/arrow-key usage hint), placed immediately
  after the Layers list (visible without scrolling, before any per-layer-type detail controls).
* `package.json` — four new test files added to the `test` script.
* `docs/ARCHITECTURE.md` — new "Editing (Alignment & Snapping)" section; a `src/editing/**` row in
  the "Layer map" table; a paragraph in "Layers" documenting the new text `x`/`y` fields.
* `tools/test-app-module-migration.mjs`, `tools/test-shape-geometry-integration.mjs` — added
  `src/editing/index.js` to each file's own app.js-import allow-list (the same "each new permanent
  module gets an allow-list entry" pattern every prior milestone that added a barrel module used).
* `tools/test-default-text-layer-editing.mjs`, `tools/test-undo-redo-integration.mjs`,
  `tools/test-svg-integration.mjs`, `tools/test-image-integration.mjs` — narrow carve-outs updating
  four pre-existing structural assertions whose exact-substring matches against `app.js` were
  legitimately superseded by this milestone's rewrite (text now returns `'move'` not `'select'`
  from `hitTest()`; the dropdown's change handler and duplicateLayer's text case gained one more
  statement each; the old per-type drag-move branch was replaced by
  `getLayerPosition()`/`setLayerPosition()`; the old single-drag pointerdown commit-history
  assertion was split into the new resize/move drag-start paths). Each carve-out is commented
  in place with the specific reason, following this repository's established pattern.

**Untouched (verified by this milestone's own forbidden-file guard in
`tools/test-alignment-snapping-integration.mjs`):** `src/geometry/**`, `src/renderer/**`,
`src/export/**`, `src/text/**`, `src/fonts/**`, `src/core/**`, `src/browser/**`, `src/svg/**`,
`src/image/**`, `src/history/**`, `src/products/**`, `src/preview3d/**`, `style.css`, `README.md`,
`LICENSE`, `CONTRIBUTING.md`, `assets/**`, `examples/**`.

---

# Commands Executed

```bash
git checkout -b feature/rs-1009-alignment-snapping
node --check app.js
npm test                                              # iterated to green, 39/39 suites
git diff --check
git status
npm install --no-save --no-package-lock puppeteer-core   # temporary, browser verification only
python3 -m http.server 5199                           # browser verification
npm uninstall puppeteer-core --no-save                    # removed afterward
```

`package.json`/`package-lock.json` carry only the four new test-file entries in the `test` script
— `git status` confirms no dependency changes remain after the temporary Puppeteer install/uninstall.

---

# Automated Test Results

`npm test` — **39/39 suites pass, exit code 0.**

**New suites (61 new assertions):**
* `tools/test-alignment-engine.mjs` (14 assertions) — all six align directions, union-bbox
  reference, 2+/3+ item requirements, invalid-direction/axis errors, order-independence,
  axis-isolation (align never moves the orthogonal axis), non-numeric-bbox rejection.
* `tools/test-snap-engine.mjs` (12 assertions) — canvas center/edge snap, safe-area edge/center
  snap, layer edge/center snap (with `layerId` on the guide), tolerance boundary (exactly-at vs.
  just-beyond), no-match returns zero offset/no guides, closest-of-several-matches, axis
  independence.
* `tools/test-editing-selection.mjs` (7 assertions) — add/remove/clear, double-toggle no-op,
  immutability (never mutates the input `Set`), removing the last id empties the selection.
* `tools/test-alignment-snapping-integration.mjs` (28 assertions) — structural wiring (imports,
  selection state, every selection-changing site routes through `src/editing/Selection.js`,
  empty-canvas clear, Shift-click toggle on canvas and layers-list, grouped-drag delta
  application, snap gating/target exclusion/resize-never-snaps, guide clearing, align/distribute
  wiring and history-commit-once, arrow-key wiring and guard, selection excluded from
  history/export, Project-JSON-import selection reset, text `x`/`y` fields, sidebar
  labels/tooltips/initial-disabled-state/placement, `updateEditingUI()` thresholds) plus
  behavioral checks combining the real `src/editing/**` module with the extracted, pure
  `getLayerPosition()`/`setLayerPosition()` from `app.js`: round-trip for all 6 layer-type
  categories (text, curved text, circle, rectangle, svg, image), a mixed-type 5-layer align across
  all six directions verified against the resulting bounding boxes, 3-layer distribute verified
  for equal center spacing and fixed extremes, keyboard-nudge grouped movement preserving relative
  offsets, `computeSnapOffset`/`buildSnapTargets` integration against a realistic
  canvas+safe-area+other-layers input, this milestone's own forbidden-file guard.

**All 35 pre-existing suites remain green** (472+ prior assertions), including the six suites
given narrow, documented carve-outs (see "Files Changed") for structural assertions this
milestone's rewrite legitimately superseded.

---

# Browser/Manual Verification

Real headless-Chrome/CDP verification (system Google Chrome via a temporary `puppeteer-core`
install, `--use-gl=swiftshader --enable-unsafe-swiftshader`), served via `python3 -m http.server
5199`, against the actual `index.html`/`app.js`/`src/editing/**`.

**22/22 functional checks passed** (4 additional "failures" reported below are all the exact same
single, pre-existing, already-documented `/favicon.ico` 404 console message — confirmed via a
`response`-event listener to be that one request and nothing else; unrelated to this milestone):

* Page loads; default project generates (375 stones, as in every prior milestone's baseline).
* Added a circle and rectangle layer (3 layers total).
* Real pointer drag: dragging the default-centered rectangle away from center, then back, actually
  moved it, and the final position snapped the rectangle's **center** to within `SNAP_TOLERANCE_MM`
  of the canvas center (105mm on the 210mm-wide default canvas) — captured in a screenshot showing
  live magenta vertical+horizontal snap guides through the canvas center and the selection handles
  centered exactly on the crosshair.
* Shift-click multi-select across three **mixed layer types** (text, circle, rectangle): 3 selected
  → Shift-click removes one (3→2) → Shift-click re-adds it (2→3).
* Align/Distribute buttons enabled only once 3 layers were selected.
* Align Left, then Distribute Horizontal, both completed without error; screenshot confirms all
  three selected layers' left edges are now flush and the sidebar summary reads "3 layers
  selected."
* Clicking empty canvas cleared the selection ("No layers selected"); align/distribute buttons
  disabled again.
* Toggling "Snap to guides" to Off switched the control's value.
* Arrow-key nudge moved the selected layer by the small step; Shift+Arrow moved it by a visibly
  larger step (0.5mm vs. 5mm, confirmed numerically).
* Undo restored the pre-nudge position; Redo re-applied it.
* Project JSON import (a hand-built 3-layer save file, simulating save/reopen) succeeded, and the
  selection reset to exactly one layer afterward — confirming selection is not part of saved/loaded
  state.
* Export 2D SVG and Export Project JSON both still succeed ("Downloaded ..." status messages).
* Zero uncaught page errors throughout the entire session.

Not performed: real-GPU/real-device verification, mobile touch-gesture verification, DXF/PNG/PDF/
Cup-preview export spot-checks beyond the two already covered (same documented scope limitation as
every prior milestone's browser session; these exporters are untouched by this milestone and their
own dedicated suites already cover them).

---

# Warnings

* Six pre-existing structural/integration test files needed narrow, documented carve-outs because
  this milestone's `pointerdown`/`pointermove`/`hitTest()`/`duplicateLayer()`/dropdown-handler
  rewrite legitimately changed exact substrings those tests matched against. Each carve-out is
  commented in place with the specific reason (see "Files Changed") — flagged here as a
  concentration of guard-test churn worth a reviewer's attention, even though each individual
  change is small, mechanical, and preserves the original test's intent (verified behaviorally,
  not just re-matched).
* Resize-handle drags are deliberately not snap-aware (only move drags call the snap engine) — an
  explicit scope decision recorded in the specification, not an oversight.
* Multi-layer delete was not added (Delete/Backspace and the sidebar button still target one layer)
  — grouping/locking/multi-delete were not part of the required outcome and are out of scope.

---

# Known Limitations

* Same as every prior milestone: no rotation support (explicitly out of scope for this milestone
  too), no arbitrary user-created guides, no rulers/grid customization.
* S-004 (duplicated text in some 3D preview cases) remains deferred, unrelated to this milestone.

---

# Recommended Next Milestone

Rotation support for layers; user-created (arbitrary) guides; layer grouping/locking; investigating
S-004.
