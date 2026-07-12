# Task

**Task ID:** RS-1009
**Task Type:** Feature — Alignment & Snapping
**Specification:** `docs/specifications/RS-1009-AlignmentSnapping.md`
**Status:** IN PROGRESS
**Branch:** feature/rs-1009-alignment-snapping

## Goal

Make layer placement fast, precise, and predictable: multi-select, align/distribute commands, and
snapping (canvas center/edges, safe area, other layers) during drag and keyboard movement.

## Required Outcome

See `docs/specifications/RS-1009-AlignmentSnapping.md` in full. Summary:

* Multi-select layers (Shift-click toggles, empty-canvas click clears, plain click preserves
  single-selection behavior).
* Align left/center-h/right/top/center-v/bottom (2+ layers); Distribute horizontal/vertical
  (3+ layers).
* Snap to canvas center/edges, safe-area edges/center, other visible layers' edges/centers, using a
  named tolerance; temporary visual guides while snapping; a UI toggle to disable snapping.
* Mouse drag uses snapping; arrow keys nudge by a small mm step, Shift+Arrow by a larger step;
  multi-selected layers move together preserving relative positions; one undo entry per completed
  drag/key action.
* All six layer types (text, curved text, circle, rectangle, svg, image) support movement.
* New `src/editing/**` module: pure, DOM-free alignment/snapping/selection logic, consumed only by
  `app.js`. No `StoneLayout`/`GeometryEngine` change.

## Rules

* Follow `docs/AI_ENGINEER.md`, `docs/CLAUDE_GUIDE.md`, `docs/ARCHITECTURE.md`.
* Smallest coherent change within the approved scope.
* Forbidden files: `src/geometry/**`, `src/renderer/**`, `src/export/**`, `src/text/**`,
  `src/fonts/**`, `src/core/**`, `src/browser/**`, `src/svg/**`, `src/image/**`, `src/history/**`,
  `src/products/**`, `src/preview3d/**`, `style.css`, `README.md`, `LICENSE`, `CONTRIBUTING.md`,
  `assets/**`, `examples/**`.
* No rotation, no arbitrary user guides, no rulers/grid customization, no layer
  locking/grouping/boolean ops, no geometry-algorithm or export-schema changes.
* Do not commit failing tests.

## Deliverables

* Implementation: `src/editing/EditingConstants.js`, `src/editing/AlignmentEngine.js`,
  `src/editing/SnapEngine.js`, `src/editing/Selection.js`, `src/editing/index.js`,
  `src/editing/README.md`, `app.js`, `index.html`.
* Tests: `tools/test-alignment-engine.mjs`, `tools/test-snap-engine.mjs`,
  `tools/test-editing-selection.mjs`, `tools/test-alignment-snapping-integration.mjs`;
  `package.json` test script updated.
* `npm test` passing in full.
* Browser verification.
* `TASK_RESULT.md` completed.
* One commit on `feature/rs-1009-alignment-snapping`, branch pushed.
