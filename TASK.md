# Task

**Task ID:** RS-1004
**Task Type:** Feature
**Specification:** `docs/specifications/RS-1004-MultiObjectTemplates.md`
**Status:** IN PROGRESS
**Branch:** feature/rs-1004-multi-object-templates

## Goal

Allow one rhinestone design to be previewed and produced against multiple physical object
templates (Mug, Straight Tumbler, Bottle), by activating the already-existing but inert
`src/products/**` abstraction and `project.product` field — not by creating a second
object/product model. See the specification for the full template schema, renderer generalization,
and file scope.

## Required Outcome

* `src/products/**` defines a validated object-template registry (`mug`, `tumbler`, `bottle`), each
  with display name, production width/height (mm), preview silhouette parameters, wrap
  behavior/default, and a safe-area inset.
* `project.product` selects the active template; switching it via a new, always-visible "Object
  type" UI control is one discrete, undoable action that also resets `project.canvas` and
  `project.wrap` to that template's defaults.
* `src/renderer/CupRenderer.js`'s `renderCup()` is generalized (shared frustum + wrap math, three
  silhouette variants) to draw all three templates; omitting `objectTemplate` falls back to the
  exact pre-milestone mug silhouette.
* A safe-area guide is drawn as an `app.js` editor overlay on the 2D Production Layout canvas — not
  inside `CanvasRenderer2D.js`.
* `StoneLayout` and `GeometryEngine` are unchanged. Existing Mug projects open identically. All
  exports/layer editing/curved text/SVG import/undo-redo keep working for every object type.

## Rules

* Follow `docs/AI_ENGINEER.md` and `docs/CLAUDE_GUIDE.md`.
* Follow the "Allowed Files" / "Forbidden Files" lists in the specification exactly.
* Do not modify `node_modules/**`.
* Two pre-existing guard tests (`tools/test-undo-redo-integration.mjs`,
  `tools/test-curved-text-integration.mjs`) have forbidden-file lists that would incorrectly block
  this milestone's legitimate `src/products/**`/`src/renderer/CupRenderer.js` changes — narrow them
  with an explanatory comment, matching established precedent (see the specification's
  "Implementation Notes / Known Discrepancies"). Do not touch any other guard test.
* No unrelated refactoring; no new features beyond this milestone's scope.
* Do not commit failing tests.

## Deliverables

* Specification (`docs/specifications/RS-1004-MultiObjectTemplates.md`) — done.
* Implementation.
* Automated tests (`tools/test-object-template.mjs`, `tools/test-object-preview-renderer.mjs`,
  `tools/test-object-template-integration.mjs`), registered in `package.json`.
* `npm test` passing in full.
* Browser verification via headless Chrome/CDP, with one screenshot per object type.
* `TASK_RESULT.md` completed.
* One commit, pushed to `feature/rs-1004-multi-object-templates`.
