# Task

**Task ID:** RS-0003.5C2
**Task Type:** Implementation
**Specification:** `docs/specifications/RS-0003.5C2-UnifiedRenderingPipeline.md`
**Status:** READY FOR IMPLEMENTATION
**Branch:** feature/rs-0003.5c2-unified-rendering-pipeline

## Goal

Implement RS-0003.5C2 exactly as written in
`docs/specifications/RS-0003.5C2-UnifiedRenderingPipeline.md`. That specification is the source of
truth for allowed/forbidden files, required implementation steps, required automated tests,
required browser verification, acceptance criteria, commit message, and deliverables.

## Required Outcome

- New `src/renderer/CanvasRenderer2D.js`, `src/renderer/CupRenderer.js`,
  `src/renderer/StoneColors.js`, and `src/export/SvgExporter.js` consume only `StoneLayout`
  (`src/geometry/StoneLayout.js` / `Stone.js`) — never `project.layers`, never a layer `type`.
- `app.js`'s `generate(project)` returns a real `StoneLayout` (merged across layers, `layerId:
  'project'`), built once per `updateAll()` call.
- `app.js`'s 2D canvas drawing (`drawLayout()`), cup preview drawing (`drawCup()`), and SVG export
  call into the new renderer/exporter modules instead of containing inline stone-drawing logic;
  `app.js` retains only the layer-aware editor overlay (selection outline/handles, grid, HUD text,
  drag/resize UI).
- Every renderer/exporter is handed the same generated `StoneLayout` per update; none of them
  recomputes or mutates stone positions.
- Stone size, gap, color, layer ID, bounding box, and deterministic output are preserved.
- 2D layout, cup preview, project JSON, generated-layout JSON, SVG export, and PNG exports continue
  to consume the unified generated `StoneLayout`. The Generated Layout JSON export now serializes
  the canonical `StoneLayout.toJSON()` shape (a deliberate, documented schema change — see the
  specification's "Expected Visible Change").
- The project file format does not change.
- Add the automated tests listed under the specification's "Required Automated Tests", including
  updating the seven existing guard test files that currently forbid `src/renderer/**` /
  `src/export/**`.
- Perform the "Required Browser Verification" checklist via `npm run dev` and record actual
  observed results in `TASK_RESULT.md`.
- Follow "Allowed Files" and "Forbidden Files" exactly as listed in the specification.
- Create exactly one logical commit using the commit message given in the specification.
- Push the feature branch `feature/rs-0003.5c2-unified-rendering-pipeline`. Do not push to `main`
  or `develop`.
- Complete `TASK_RESULT.md` with status, commit hash, branch, files changed, tests executed,
  browser verification, warnings, and known limitations.

## Rules

- Follow `docs/AI_ENGINEER.md` and `docs/CLAUDE_GUIDE.md`.
- Do not modify `node_modules/**`.
- Do not refactor unrelated `app.js` code beyond what this milestone's renderer/exporter extraction
  requires.
- Do not change the project JSON schema.
- Do not move the cross-layer `dedupe()` merge step into `src/geometry/GeometryEngine.js` (out of
  scope; see specification).
- If any required change falls outside the specification's "Allowed Files" list, stop and explain
  before proceeding.
- Do not commit failing tests.
