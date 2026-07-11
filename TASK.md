# Task

**Task ID:** RS-1001
**Task Type:** Implementation
**Specification:** `docs/specifications/RS-1001-SvgImport.md`
**Status:** READY FOR IMPLEMENTATION
**Branch:** feature/rs-1001-svg-import

## Goal

Implement RS-1001 exactly as written in `docs/specifications/RS-1001-SvgImport.md`. That
specification is the source of truth for allowed/forbidden files, required implementation steps,
required automated tests, required browser verification, acceptance criteria, commit message, and
deliverables.

## Required Outcome

* Import SVG files and convert supported SVG paths/shapes (`path`, `circle`, `rect`, `line`,
  `polyline`, `polygon`) into the permanent vector/geometry pipeline (`src/svg/**` ->
  `src/geometry/GeometryEngine.js` -> `StoneLayout`).
* Preserve millimeter scaling from the source SVG's declared units/viewBox.
* Preserve deterministic geometry (fixed curve-flattening subdivision, no randomness).
* Show the imported SVG as an editable layer (select, drag, resize, duplicate, delete, visibility
  toggle) using the existing generic shape-layer editing code.
* Render the SVG layer's stones in the 2D layout and cup preview.
* Include SVG layer stones in Project JSON, Generated Layout JSON, 2D SVG, 2D PNG, and Cup PNG
  exports.
* Add validation and clear, specific errors for unsupported or malformed SVG (partial-failure
  tolerant: one bad element does not abort an otherwise-valid document).
* Do not change `StoneLayout`, `Stone`, Generated Layout JSON, or SVG export schemas. The ad hoc
  Project JSON schema gains only an additive `'svg'` layer type alongside the existing ones.
* Add automated tests (SVG parser unit tests, `GeometryEngine.generateSvgLayout()` tests, `app.js`
  structural integration tests) and perform real browser verification via `npm run dev` + headless
  Chrome over CDP.
* Update `docs/specifications/RS-1001-SvgImport.md` (already drafted), `docs/ARCHITECTURE.md`,
  `TASK.md`, `TASK_RESULT.md`.
* Commit and push a new feature branch `feature/rs-1001-svg-import`. Do not push to `main` or
  `develop`.

## Rules

* Follow `docs/AI_ENGINEER.md` and `docs/CLAUDE_GUIDE.md`.
* Do not modify `node_modules/**`.
* Do not modify `src/text/**`, `src/fonts/**`, `src/core/**`, `src/browser/**`, `src/renderer/**`,
  `src/export/**`, `assets/**`, `examples/**`, `style.css`.
* Follow the exact "Allowed Files" / "Forbidden Files" lists in
  `docs/specifications/RS-1001-SvgImport.md`.
* Reuse existing geometry primitives (`flattenContourToPolygon`, `sampleOutlinePoints`,
  `sampleFillPoints`, `Stone`, `StoneLayout`) — no parallel geometry implementation.
* Keep millimeters internal throughout; keep the Geometry Engine as the only place stone positions
  are generated.
* Update the narrow set of existing guard tests enumerated in the specification (forbidden-file
  prefix lists, allowed-import lists) — no unrelated change to those files.
* If a genuine defect is found outside this milestone's scope, document it in `TASK_RESULT.md`
  rather than fixing it, unless it is small and directly necessary.
* If any required change falls outside the specification's "Allowed Files" list, stop and explain
  before proceeding.
* Do not commit failing tests.
