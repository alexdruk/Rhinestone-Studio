# Task

**Task ID:** S-001
**Task Type:** Stabilization
**Specification:** `docs/specifications/S-001-CupRenderingStabilization.md`
**Status:** READY FOR IMPLEMENTATION
**Branch:** feature/s-001-cup-rendering-stabilization

## Goal

Implement S-001 exactly as written in `docs/specifications/S-001-CupRenderingStabilization.md`. That
specification is the source of truth for allowed/forbidden files, required implementation steps,
required automated tests, required browser verification, acceptance criteria, commit message, and
deliverables.

## Required Outcome

* **S-001 (handle attachment/shape)**: the cup handle in `src/renderer/CupRenderer.js` must be
  visually attached to the cup body at every rotation angle — no floating, no twisting, believable
  thickness and perspective, smooth attachment to the tapered wall.
* **S-002 (rotation believability)**: the handle must be a real azimuthally-anchored 3D feature of
  the cup (sweeping in screen position, correctly occluded/visible depending on facing direction)
  synchronized with the same rotation term the stones already use, so the whole cup — not just the
  handle's opacity — reads as rotating. No visual hacks (fake shading sweep, discrete side-flip
  branch, opacity-only fade).
* **S-003 (view buttons)**: Front/Left/Right/Back buttons must all set the correct rotation and stay
  visually synchronized (highlighted) with the current rotation, including after manual drag or
  slider rotation.
* Do not modify `GeometryEngine`, `StoneLayout`, export architecture, SVG import, text generation,
  or shape generation.
* Add automated tests covering rotation logic, view buttons, renderer state, synchronization, and
  regression protection. Run `npm test` and confirm all suites pass.
* Perform real browser verification via `npm run dev` + headless Chrome over CDP, covering Front,
  Left, Right, Back, 45°, 135°, manual drag, zoom, light/dark cup color. Capture screenshots for
  front/left/right/back/45°/135°.
* Update `docs/ARCHITECTURE.md`'s CupRenderer implementation-status note, `TASK.md`, `TASK_RESULT.md`.
* Commit and push a new feature branch `feature/s-001-cup-rendering-stabilization`. Do not push to
  `main` or `develop`.

## Rules

* Follow `docs/AI_ENGINEER.md` and `docs/CLAUDE_GUIDE.md`.
* Do not modify `node_modules/**`.
* Do not modify `src/geometry/**`, `src/core/**`, `src/text/**`, `src/fonts/**`, `src/svg/**`,
  `src/export/**`, `src/browser/**`, `src/history/**`, `src/renderer/CanvasRenderer2D.js`,
  `src/renderer/StoneColors.js`, `assets/**`, `examples/**`, `style.css`.
* Follow the exact "Allowed Files" / "Forbidden Files" lists in
  `docs/specifications/S-001-CupRenderingStabilization.md`.
* No unrelated refactoring; no new features beyond the three listed issues.
* If a genuine defect is found outside this milestone's scope, document it in `TASK_RESULT.md` rather
  than fixing it, unless it is small and directly necessary.
* If any required change falls outside the specification's "Allowed Files" list, stop and explain
  before proceeding.
* Do not commit failing tests.
