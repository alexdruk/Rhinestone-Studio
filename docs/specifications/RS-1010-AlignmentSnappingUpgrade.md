# RS-1010 — Alignment & Snapping Upgrade

## Objective

Upgrade the RS-1009 alignment/snapping system into a more complete, professional-editor-grade
feature set — configurable snap distance, independently toggleable visual guides, Shift-drag axis
constrain, and Alt/Option-drag duplicate — with every snapping setting exposed in the Settings
Lightbox using plain, non-technical language. No rewrite of the editing architecture, selection
system, or renderer; no duplicated snapping/alignment logic.

## Current Repository State (inspected before writing this spec)

* RS-1009 (`docs/specifications/RS-1009-AlignmentSnapping.md`) already shipped multi-select,
  six align directions, two distribute axes, and drag-time snapping to canvas edges/center, safe-
  area edges/center, and other visible layers' edges/centers — via a permanent, pure, DOM-free
  `src/editing/**` module (`EditingConstants.js`, `AlignmentEngine.js`, `SnapEngine.js`,
  `Selection.js`), consumed only by `app.js`.
* `getLayerBBox()` (`app.js`) already returns a bounding box for every layer type through one of
  two paths: `circle`/`rectangle`/`svg`/`image` read their own `x`/`y`/`w`/`h` (or `cx`/`cy`/`r`)
  fields directly; every other type (`text`, including curved text) falls through to a
  `StoneLayout`-derived bounding box of that layer's generated stones. Both paths already feed the
  same `layerBBoxes` array `SnapEngine.js` snaps against — so text bounding boxes, imported SVG
  bounds, and Image Trace bounds were already snap targets before this milestone; no per-type
  snapping code exists or is needed.
* `computeSnapOffset(dragBBoxMm, targets, toleranceMm)` already takes tolerance as a parameter
  (`SNAP_TOLERANCE_MM` was just the fixed value `app.js` always passed) and already matches each
  axis (x, y) independently against every candidate target line — so a drag that is simultaneously
  close to another layer's right edge (on x) and bottom edge (on y) already snaps onto that corner
  today; no dedicated "corner" target type is needed for corner-to-corner snapping to work.
* `snapEnabled`/`activeGuides` are `app.js`-local, view-only editor state (never part of `project`,
  never history-tracked, never exported), mirrored between a toolbar quick-toggle
  (`#snapEnabled`) and the Settings Lightbox (`#settingsSnapDefault`, applied via
  `el('settingsApply').onclick`).
* The Settings Lightbox (`#lightboxSettings`, added by UI-001) has a "Canvas defaults" section
  containing grid/safe-area/snap toggles together; there is no snap-distance control and no
  separate guide-visibility control.
* Neither Shift nor Alt/Option has any effect during a canvas drag today. Shift only affects
  keyboard-nudge step size (`NUDGE_STEP_LARGE_MM` vs `NUDGE_STEP_MM`) and canvas/layers-list
  multi-select-toggle (on `pointerdown`, before any drag starts). Alt/Option is unused.

## Expected Visible Change

* Dragging near another object's corner still snaps both axes at once (unchanged, verified rather
  than re-implemented).
* Holding Shift while dragging a layer/selection locks movement to a single axis (horizontal or
  vertical, whichever the pointer has moved further along).
* Holding Alt/Option while starting a drag duplicates the current selection in place and drags the
  new copies; the originals stay where they were. One undo step covers duplicate+move together.
* The Settings Lightbox gains a dedicated "Alignment & Snapping" section: "Enable Snapping"
  (renamed from "Snap to guides by default"), a new "Snap Distance (mm)" numeric field (0.5–5mm),
  and a new "Show Alignment Guides" checkbox that hides the temporary guide lines without disabling
  snapping itself.
* The Help Lightbox's keyboard-shortcut list and the 2D-canvas status hint both document the two
  new drag modifiers.

## Required Outcome

**Configurable snap tolerance** — a new `snapToleranceMm` view-only state variable (default
`SNAP_TOLERANCE_MM`) replaces the fixed constant as the third argument to `computeSnapOffset()`.
Settable via the Settings Lightbox's "Snap Distance" field, clamped to `[0.5, 5]` mm on Apply.

**Guide visibility, decoupled from snapping** — a new `showSnapGuides` view-only state variable
(default `true`). When a snap is found, movement is still adjusted by the snap offset regardless of
this flag; `activeGuides` (what actually gets drawn) is populated only when `showSnapGuides` is
true. Settable via the Settings Lightbox's "Show Alignment Guides" checkbox.

**Shift-drag axis constrain** — during a move-drag's `pointermove`, after the (possibly snapped)
`dx`/`dy` is computed, if `e.shiftKey` is held, whichever of `dx`/`dy` has the smaller magnitude is
forced to exactly `0`. This is intentionally applied *after* snapping, not instead of it, so the
locked axis is always exactly the drag-start position, never nudged a fraction of a mm by a nearby
snap target on that axis. Does not change Shift's existing keyboard-nudge or multi-select-toggle
behavior (those are separate code paths, gated on `keydown`/pointerdown-before-drag respectively).

**Alt/Option-drag duplicate** — on `pointerdown`, once the target selection is resolved (same
single-vs-multi-selection resolution as an ordinary click) and *before* the drag begins, if
`e.altKey` is held: deep-clone every layer in the resolved selection, assign each a fresh id,
push the clones onto `project.layers`, and select the clones (via the new
`selectMany()` — see below) — then start the move-drag against the clones' ids, not the
originals'. The pre-existing `commitHistory()` call (already made once per drag, before mutation)
covers duplicate+move as a single undo step. Only move-drags duplicate; resize-drags (which start
and return before the Alt check) are unaffected, matching RS-1009's "resize is never
snap/selection-aware beyond its own layer" precedent.

**Settings Lightbox reorganization** — snap-related settings move into their own "Alignment &
Snapping" field-section (previously merged into "Canvas defaults"), with plain-language labels:
"Enable Snapping" (was "Snap to guides by default"), "Snap Distance (mm)" (new), "Show Alignment
Guides" (new). No change to how "Enable Snapping" itself behaves — same `snapEnabled` variable,
same toolbar quick-toggle mirroring it.

## Architecture Requirements

* `src/editing/**` gains exactly one addition: `Selection.js`'s `selectMany(ids)` — `(ids:
  string[]) => Set<string>`, a new selection containing exactly the given ids. This is the only
  change to `src/editing/**`; `SnapEngine.js`/`AlignmentEngine.js`/`EditingConstants.js` are
  unmodified (the configurable tolerance and independent per-axis matching this milestone relies
  on already existed). `selectMany()` exists because Alt-drag-duplicate needs to select several
  freshly created ids at once — a case `selectOnly`/`toggleSelection`/`clearSelection` cannot
  express — and every selection-changing site in `app.js` must keep going through
  `src/editing/Selection.js`'s functions (never a hand-rolled `new Set(...)`), preserving RS-1009's
  "no second selection model" invariant. `index.js`'s barrel and `README.md` are updated to list
  it.
* `app.js` is the only caller, exactly as RS-1009 established. `snapToleranceMm`/`showSnapGuides`
  join `snapEnabled`/`activeGuides` as the same category of view-only editor state: never part of
  `project`, never in the undo/redo snapshot (`currentSnapshot()`), never in exported Project JSON.
* `src/geometry/**`, `src/renderer/**`, `src/export/**`, `StoneLayout`, `Stone`, `GeometryEngine`
  are untouched. Project JSON schema is untouched (duplicated layers reuse the exact same
  per-type field shape `duplicateLayer()`/import already produce and validate).

## Allowed Files

* New: `docs/specifications/RS-1010-AlignmentSnappingUpgrade.md` (this file),
  `tools/test-alignment-snapping-upgrade.mjs`.
* Modified: `app.js`, `index.html`, `package.json` (test script), `docs/ARCHITECTURE.md`,
  `TASK.md`, `TASK_RESULT.md`, `src/editing/Selection.js`, `src/editing/index.js`,
  `src/editing/README.md`, `tools/test-alignment-snapping-integration.mjs`,
  `tools/test-editing-selection.mjs`, `tools/test-undo-redo-integration.mjs` (regex updates only,
  for the `dragIds`/`selectMany` literals these three pre-existing suites assert against).

## Forbidden Files

`src/geometry/**`, `src/renderer/**`, `src/export/**`, `src/text/**`, `src/fonts/**`,
`src/core/**`, `src/browser/**`, `src/svg/**`, `src/image/**`, `src/history/**`,
`src/products/**`, `src/preview3d/**`, `src/editing/SnapEngine.js`, `src/editing/AlignmentEngine.js`,
`src/editing/EditingConstants.js`, `style.css`, `README.md`, `LICENSE`, `CONTRIBUTING.md`,
`assets/**`, `examples/**`.

## Out of Scope

Arbitrary user-created guides, rulers, grid customization, rotation, layer locking/grouping,
boolean operations, 45°/other angle snapping beyond horizontal/vertical axis-lock, magnetic
animation, or any other visual-effect polish (explicitly excluded by the milestone brief).
Multi-layer delete remains out of scope (unchanged from RS-1009).

## Known Deferred Issue

S-004 (duplicated text in some 3D preview cases) remains deferred, unrelated to this milestone.

## Automated Tests

* `tools/test-editing-selection.mjs` — two new cases for `selectMany()`: returns a Set of exactly
  the given ids; an empty array returns an empty Set.
* `tools/test-alignment-snapping-upgrade.mjs` — structural checks (state variables, Settings
  Lightbox markup, Help Lightbox shortcuts, the Shift-constrain-after-snap ordering, the
  Alt-duplicate-then-selectMany wiring, that resize never duplicates) and behavioral checks against
  the real, unmodified `src/editing/SnapEngine.js` (configurable tolerance changes snap outcome;
  corner-to-corner snapping already works via independent per-axis matching) plus a structural
  proof that `getLayerBBox()` has no per-type branch for `text` (it shares the generic fallback
  every non-shape layer type uses, so text/curved-text/SVG/Image-Trace bounds all reach the snap
  engine through one path).
* `tools/test-alignment-snapping-integration.mjs`, `tools/test-undo-redo-integration.mjs` — regex
  updates only, for the renamed/extended literals (`snapToleranceMm`, `let dragIds`, `selectMany`)
  these pre-existing suites assert against; no behavioral changes to what they cover.
* `tools/test-ui001b-fixes.mjs` — its forbidden-file guard is scoped to UI-001's own milestone
  rules ("do not extend Alignment & Snapping"); since it checks live `git status` rather than a
  diff scoped to UI-001's own commit, it also had to stop forbidding `src/editing/**` now that a
  later milestone (this one) legitimately extends it — see the guard's own updated comment.
* Re-run full `npm test` — all pre-existing suites stay green.

## Browser/Manual Verification

Drag a layer near another layer's corner and confirm both axes snap simultaneously; drag with
Shift held and confirm movement locks to one axis; drag with Alt/Option held and confirm a
duplicate is created and dragged, original unchanged; open Settings, change Snap Distance and Show
Alignment Guides, Apply, and confirm both take effect; toggle Show Alignment Guides off and confirm
snapping still occurs but no guide line is drawn; verify text/curved-text/SVG/Image-Trace layers
all still snap; verify undo/redo across an Alt-duplicate-drag restores/reapplies correctly; verify
all export buttons still succeed; zero relevant console errors.

## Implementation Constraints

Smallest coherent change. No rewritten editing architecture, selection system, or renderer. No
duplicated snapping/alignment logic — `src/editing/SnapEngine.js`/`AlignmentEngine.js` remain the
one implementation. No magnetic animation or other visual effects. Millimeters throughout.

## Required Commands

```bash
npm test
git diff --check
git status
npm run dev   # browser verification
```

## Commit Message

`feat(editing): configurable snap distance, guide visibility, shift-constrain, alt-duplicate (RS-1010)`

## Deliverables

Implementation, tests, `TASK_RESULT.md`, one commit on
`feature/rs-1010-alignment-snapping-upgrade`, pushed branch.

## Next Milestone

Candidates: user-created guides, rulers, layer grouping/locking, rotation support — all explicitly
out of scope here (mirrors RS-1009's own deferred list).
