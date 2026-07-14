# Task

**Task ID:** S-104
**Task Type:** Small UX polish — Text Position Recovery & Drag Tuning
**Specification:** `docs/specifications/S-104-TextPositionRecoveryDragTuning.md`
**Status:** IMPLEMENTED
**Branch:** feature/s-104-text-position-recovery-drag-tuning

## Goal

Improve the usability of text positioning: reduce move-drag sensitivity so text (and every other
draggable layer) moves more precisely and predictably, and add a simple **Center on Object** action
that restores a selected text layer to the center of the printable area — position only, no other
property touched — recovering text that has been dragged fully outside the visible canvas.

## Required Outcome

See `docs/specifications/S-104-TextPositionRecoveryDragTuning.md` in full. Summary:

* Audit-first: confirmed the move-drag `pointermove` handler mapped pointer movement to mm 1:1
  (`rawDx`/`rawDy` applied verbatim), and that a text layer's world position is always
  `(canvas.width/2 + layer.x, canvas.height/2 + layer.y)` by construction of
  `computeTextPlacementOffset()` (RS-1009/RS-1012, unchanged) — so "center on the printable area" is a
  pure function of `getSafeAreaRectMm()` (`src/products/ObjectTemplate.js`, unchanged) and the canvas
  size, needing no new geometry.
* `app.js`: new named constant `LAYER_MOVE_DRAG_SENSITIVITY = 0.5`, applied to the move-drag delta
  before snapping/shift-lock/position-apply — matching this file's existing precedent (the removed
  `CUP_ROTATION_SENSITIVITY`) of naming pointer-tuning constants instead of inline magic numbers.
  Resize-drag and keyboard nudge are untouched (structurally different code paths).
* `app.js`/`index.html`: new `centerSelectedTextOnObject()` function and a `Center on Object` button in
  the Text Lightbox's existing Position section, reusing the existing `commitHistory()`/
  `syncSelectedControlsFromLayer()`/`updateAll(true)`/`#status` pattern every other mutating action
  already uses — one undo step, immediate UI refresh, no new storage or schema field.
* `GeometryEngine`, `StoneLayout`, every renderer, every exporter, the project schema, Design Library,
  and Gallery are untouched.

## Rules

* Follow `docs/AI_ENGINEER.md`, `docs/CLAUDE_GUIDE.md`, `docs/ARCHITECTURE.md`,
  `docs/MILESTONE_WORKFLOW.md`.
* Repository is the source of truth; audit before implementing; do not add new features beyond the
  two requested (drag tuning, Center on Object).
* Do not touch `GeometryEngine`, `StoneLayout`, the project schema, exporters, rendering
  (`src/renderer/**`, `src/preview3d/**`), Design Library (`src/library/**`), or Gallery
  (`src/gallery/**`).

## Deliverables

* `app.js`, `index.html` — reduced drag sensitivity, Center on Object action + button.
* `tools/test-s104-text-position-recovery-drag-tuning.mjs` — new test (9 checks).
* `tools/test-alignment-snapping-integration.mjs` — one pre-existing assertion updated to reflect the
  intentionally-changed drag-delta source line (behavior it protects is otherwise unchanged).
* `package.json` — new test wired into the `test` script.
* `docs/specifications/S-104-TextPositionRecoveryDragTuning.md` — full specification, audit findings,
  and browser verification detail.
* `npm test` passing in full (831 checks, 0 failures).
* Real-browser verification (headless Chromium via Playwright, isolated local run) of drag sensitivity,
  off-canvas recovery, non-position-property preservation, and undo/redo, with screenshots.
* `TASK_RESULT.md` completed.
* One commit on `feature/s-104-text-position-recovery-drag-tuning`, branch pushed (not merged).
