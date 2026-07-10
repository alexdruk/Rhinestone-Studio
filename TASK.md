# Task

**Task ID:** RS-0003.5B3
**Task Type:** Implementation
**Specification:** `docs/specifications/RS-0003.5B3-LiveGeometryEngineIntegration.md`
**Status:** READY FOR IMPLEMENTATION
**Branch:** feature/m2-vector-text

## Goal

Implement RS-0003.5B3 exactly as written in
`docs/specifications/RS-0003.5B3-LiveGeometryEngineIntegration.md`. That specification is the
source of truth for allowed/forbidden files, required implementation steps, required automated
tests, required browser verification, acceptance criteria, commit message, and deliverables.

## Required Outcome

- `app.js` stops using the legacy bitmap text-generation path for text layers.
- The permanent `src/geometry/GeometryEngine.js` becomes the live source of text stone geometry.
- `OpenTypeProvider` (via `FontProviderRegistry`) and `FontManager` are used for live text
  generation.
- The existing 2D layout, cup preview, controls, layer model, shapes, exports, and project
  format continue to work.
- Shape generation remains on the legacy path.
- Millimeter-based geometry and stone color metadata are preserved.
- Visible output stays readable and stable; exact stone count does not need to match the bitmap
  baseline.
- The legacy engine is not removed; only its text path stops being called.
- Add all automated tests listed under the specification's "Required Automated Tests".
- Perform the "Required Browser Verification" checklist via `npm run dev` and record actual
  observed results in `TASK_RESULT.md`.
- Follow "Allowed Files" and "Forbidden Files" exactly as listed in the specification.
- Create exactly one logical commit using the commit message given in the specification.
- Push the current feature branch (`feature/m2-vector-text`). Do not push to `main` or
  `develop`.
- Complete `TASK_RESULT.md` with status, commit hash, branch, files changed, tests executed,
  browser verification, warnings, and known limitations.

## Rules

- Follow `docs/AI_ENGINEER.md` and `docs/CLAUDE_GUIDE.md`.
- Do not modify `node_modules/**`.
- Do not refactor unrelated code in `app.js` or elsewhere, with the single documented exception
  in the specification (the `input`-listener `skipWrite` fix, required to demonstrate this
  milestone's core outcome).
- Do not rename existing controls or DOM IDs (option values/labels on `#font` may change; the
  ID and its role as "the font control" do not).
- If any required change falls outside the specification's "Allowed Files" list, stop and
  explain before proceeding.
- Do not commit failing tests.
