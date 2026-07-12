# Task

**Task ID:** RS-1006A
**Task Type:** Fix — Real 3D Preview Corrections (follow-up to RS-1006)
**Specification:** `docs/specifications/RS-1006A-PreviewCorrections.md`
**Status:** IN PROGRESS
**Branch:** feature/rs-1006a-preview-corrections

## Goal

Fix four defects in the RS-1006 Three.js 3D preview confirmed by human visual review (not by the
automated suite, which passed throughout): a generic-cone mug silhouette, a visibly gapped/floating
mug handle, duplicated/unreadable artwork on the tumbler (and mug), and a bottle whose printable
texture bleeds onto its shoulder and whose silhouette doesn't read as a bottle. Improve the existing
`src/preview3d/**` renderer in place — do not replace its architecture.

## Required Outcome

See `docs/specifications/RS-1006A-PreviewCorrections.md` in full. Summary: all four fixes live in
`src/preview3d/ObjectGeometryBuilder.js` (mug/tumbler modeled rim + closed base via `LatheGeometry`,
embedded handle-attachment endpoints, `applyBodyHeightUv()` V-remap, improved bottle shoulder/cap
profile) and `src/preview3d/Preview3DRenderer.js` (body material `FrontSide` instead of
`DoubleSide`). `ObjectDimensions.js`, `StoneLayoutTexture.js`, `index.js`, `app.js`, `index.html`,
`StoneLayout.js`, `GeometryEngine.js`, and every exporter are untouched.

## Rules

* Follow `docs/AI_ENGINEER.md`, `docs/CLAUDE_GUIDE.md`, `docs/ARCHITECTURE.md`.
* Smallest coherent change; no unrelated refactoring.
* Forbidden files: everything RS-1006 forbade, plus `src/preview3d/ObjectDimensions.js`,
  `src/preview3d/index.js`, `src/preview3d/StoneLayoutTexture.js`, `app.js`, `index.html`,
  `package.json`.
* Do not commit failing tests.
* Root-cause fixes only — the tumbler duplicate-artwork defect must be fixed at its source (the
  `DoubleSide` material + open hollow geometry combination), not masked.

## Deliverables

* Implementation: `src/preview3d/ObjectGeometryBuilder.js`, `src/preview3d/Preview3DRenderer.js`.
* Tests: additive tests in `tools/test-object-geometry-builder.mjs` (no existing assertion weakened
  or removed).
* `npm test` passing in full.
* Browser verification via a real headless-Chrome session, producing comparison screenshots (Mug
  45°, Mug back, Tumbler, Bottle) checked against the human-review reference screenshots.
* `TASK_RESULT.md` completed.
* One commit on `feature/rs-1006a-preview-corrections`.
