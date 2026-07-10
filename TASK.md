# Task

**Task ID:** RS-0003.5C1
**Task Type:** Implementation
**Specification:** `docs/specifications/RS-0003.5C1-PermanentShapeGeometryIntegration.md`
**Status:** READY FOR IMPLEMENTATION
**Branch:** feature/rs-0003.5c1-shape-geometry

## Goal

Implement RS-0003.5C1 exactly as written in
`docs/specifications/RS-0003.5C1-PermanentShapeGeometryIntegration.md`. That specification is the
source of truth for allowed/forbidden files, required implementation steps, required automated
tests, required browser verification, acceptance criteria, commit message, and deliverables.

## Required Outcome

- Circle layers use `GeometryEngine.generateShapeLayout({ shape: 'circle', ... })` in
  `src/geometry/GeometryEngine.js`.
- Rectangle layers use `GeometryEngine.generateShapeLayout({ shape: 'rectangle', ... })`.
- Text layers continue using `generateTextLayout()`, unchanged.
- Text and shapes both produce `Stone`/`StoneLayout` instances from the permanent engine.
- `app.js` stops calling the legacy `generateCircle()` / `generateRect()` for live generation;
  they remain present, unused (same treatment as the legacy bitmap text path since RS-0003.5B3).
- Stone size, gap, color, layer ID, bounds, and deterministic output are preserved.
- Shape editing (add, select, drag, resize, duplicate, delete, visibility) remains functional.
- 2D layout, cup preview, project JSON, generated-layout JSON, SVG export, and PNG exports
  continue to consume the unified generated layout.
- The project file format does not change.
- Add the automated tests listed under the specification's "Required Automated Tests".
- Perform the "Required Browser Verification" checklist via `npm run dev` and record actual
  observed results in `TASK_RESULT.md`.
- Follow "Allowed Files" and "Forbidden Files" exactly as listed in the specification.
- Create exactly one logical commit using the commit message given in the specification.
- Push the feature branch `feature/rs-0003.5c1-shape-geometry`. Do not push to `main` or
  `develop`.
- Complete `TASK_RESULT.md` with status, commit hash, branch, files changed, tests executed,
  browser verification, warnings, and known limitations.

## Rules

- Follow `docs/AI_ENGINEER.md` and `docs/CLAUDE_GUIDE.md`.
- Do not modify `node_modules/**`.
- Do not refactor unrelated `app.js` code, with the single documented exception in the
  specification (the `permanentTextEngine` -> `permanentEngine` rename, required because the
  field is no longer text-only).
- Do not change the project JSON schema.
- If any required change falls outside the specification's "Allowed Files" list, stop and
  explain before proceeding.
- Do not commit failing tests.
