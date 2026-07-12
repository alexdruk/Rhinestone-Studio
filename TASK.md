# Task

**Task ID:** RS-1010
**Task Type:** Feature — Alignment & Snapping Upgrade
**Specification:** `docs/specifications/RS-1010-AlignmentSnappingUpgrade.md`
**Status:** IN PROGRESS
**Branch:** feature/rs-1010-alignment-snapping-upgrade

## Goal

Upgrade RS-1009's alignment/snapping system into a more complete, professional-editor-grade
feature set: configurable snap distance, an independent guide-visibility toggle, Shift-drag axis
constrain, and Alt/Option-drag duplicate — with every snapping setting exposed in the Settings
Lightbox using plain, non-technical language. No rewrite of the editing architecture, selection
system, or renderer; no duplicated snapping/alignment logic; no new visual effects.

## Required Outcome

See `docs/specifications/RS-1010-AlignmentSnappingUpgrade.md` in full. Summary:

* Snap distance becomes a configurable, view-only `snapToleranceMm` (Settings Lightbox: "Snap
  Distance (mm)", 0.5–5mm), replacing the fixed `SNAP_TOLERANCE_MM` constant as the value passed to
  `computeSnapOffset()`.
* Guide-line visibility becomes independently toggleable via `showSnapGuides` (Settings Lightbox:
  "Show Alignment Guides") — snapping still applies with guides hidden.
* Shift held during a move-drag locks movement to one axis, applied after snapping so the locked
  axis never drifts.
* Alt/Option held on pointerdown duplicates the current selection and drags the copies, leaving
  originals in place; one undo step covers duplicate+move.
* Settings Lightbox gains a dedicated "Alignment & Snapping" section with friendly labels ("Enable
  Snapping", "Snap Distance (mm)", "Show Alignment Guides").
* Help Lightbox and the canvas status hint document the two new drag modifiers.
* Verified (not re-implemented): object-corner snapping already works via RS-1009's existing
  independent per-axis matching; text/curved-text/SVG/Image-Trace bounds already reach the snap
  engine through the one generic `getLayerBBox()` path.

## Rules

* Follow `docs/AI_ENGINEER.md`, `docs/CLAUDE_GUIDE.md`, `docs/ARCHITECTURE.md`,
  `docs/MILESTONE_WORKFLOW.md`.
* Repository is the source of truth; audit before implementing; do not duplicate functionality
  that already exists (`src/editing/SnapEngine.js`'s configurable tolerance and independent-axis
  matching already covered "configurable snap tolerance" and "object corners" — verified via new
  tests, not reimplemented).
* Do not modify `GeometryEngine`, `StoneLayout`, exporters, or the Project schema unless
  absolutely necessary — none of this milestone's work required touching any of them.
* `src/editing/**` stays almost entirely untouched: the one addition is
  `Selection.js`'s `selectMany(ids)`, needed because Alt-drag-duplicate must select several new ids
  at once (no existing selection primitive expressed that) — still routed through the one
  selection-mutation module, preserving "no second selection model."
* Forbidden files: `src/geometry/**`, `src/renderer/**`, `src/export/**`, `src/text/**`,
  `src/fonts/**`, `src/core/**`, `src/browser/**`, `src/svg/**`, `src/image/**`, `src/history/**`,
  `src/products/**`, `src/preview3d/**`, `src/editing/SnapEngine.js`,
  `src/editing/AlignmentEngine.js`, `src/editing/EditingConstants.js`, `style.css`, `README.md`,
  `LICENSE`, `CONTRIBUTING.md`, `assets/**`, `examples/**`.
* Do not commit failing tests.
* Do not merge — push the feature branch only.

## Deliverables

* `app.js`, `index.html` — new state, drag-handler changes, Settings/Help Lightbox updates.
* `src/editing/Selection.js`, `src/editing/index.js`, `src/editing/README.md` — `selectMany()`.
* `docs/ARCHITECTURE.md` — RS-1010 implementation-status addendum under "Editing (Alignment &
  Snapping)" and the Layer map row.
* Tests: `tools/test-alignment-snapping-upgrade.mjs` (new); `tools/test-editing-selection.mjs`,
  `tools/test-alignment-snapping-integration.mjs`, `tools/test-undo-redo-integration.mjs`,
  `tools/test-ui001b-fixes.mjs` (regex/scope updates for changed literals and `src/editing/**`'s
  now-legitimate scope); `package.json` test script updated.
* `npm test` passing in full.
* Real-browser verification (headless Chrome/CDP, isolated profile) of drag snapping, resize,
  text/shape/SVG/Image-Trace snapping, alignment/distribution, Shift-constrain, Alt-duplicate,
  Settings Lightbox controls, dual workspace, with screenshots.
* `TASK_RESULT.md` completed.
* One commit on `feature/rs-1010-alignment-snapping-upgrade`, branch pushed.
