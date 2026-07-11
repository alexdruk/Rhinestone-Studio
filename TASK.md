# Task

**Task ID:** RS-0003.5D2
**Task Type:** Implementation
**Specification:** `docs/specifications/RS-0003.5D2-UXVisualPolish.md`
**Status:** READY FOR IMPLEMENTATION
**Branch:** feature/rs-0003.5d2-ux-visual-polish

## Goal

Implement RS-0003.5D2 exactly as written in
`docs/specifications/RS-0003.5D2-UXVisualPolish.md`. That specification is the source of truth for
allowed/forbidden files, required implementation steps, required automated tests, required browser
verification, acceptance criteria, commit message, and deliverables.

## Required Outcome

- `src/renderer/CupRenderer.js`'s handle attaches to the cup wall at both ends (using the same
  tapered-wall interpolation the body silhouette uses), sweeps and fades continuously with
  `rotationDeg` (no discrete side flip, no jump at any angle including ±90°), and is drawn as a
  filled loop with a visible opening, gradient shading, a rim stroke, and soft contact-shadow
  patches fusing it into the body.
- `src/renderer/CupRenderer.js`'s cup body fill gradient is replaced with a smooth multi-stop
  cosine falloff (no abrupt banding) plus a subtle soft vertical sheen; `shade()`/`cupColor`
  configurability is unchanged.
- `src/renderer/CanvasRenderer2D.js`'s `drawStone()` gains a subtle contrast ring for the `'cup'`
  style so stones stay readable on both light and dark cup colors; the `'layout'` style is
  unchanged.
- `app.js` gains a named `CUP_ROTATION_SENSITIVITY` constant (substantially below `1`) used in the
  cup drag `pointermove` handler in place of the previous unscaled 1:1 pixel-to-degree mapping; the
  handler remains delta-based (no jump at drag start/end) and keeps the existing `-180..180` clamp.
- `app.js` gains named `ZOOM_MIN`/`ZOOM_MAX` constants (`0.7`/`1.4`, matching `#zoom`'s
  `min="70"`/`max="140"`) and clamps `zoom` to that range in `writeSelectedControlsToLayer()`.
- `app.js` gains `setNumericSelectValue(select, num)` and uses it for `#stoneSize` in
  `syncSelectedControlsFromLayer()`, fixing the blank-dropdown bug (`String(2)` = `"2"` matching no
  `<option value="2.0">`) while preserving the underlying millimeter value.
- `app.js`'s `drawSelection()` gains a white contrast halo behind the dashed blue selection outline
  and larger, soft-shadowed resize handles; hit-testing, drag, and resize math are unchanged.
- Courier Prime and Great Vibes readability is verified (not modified) across 2D layout, cup front
  view, front/wider wrap modes, and outline/fill text modes.
- Stone count and bounding box for the default project (and any unchanged project input) remain
  identical before and after this milestone.
- Add the automated tests listed under the specification's "Required Automated Tests" in a new
  `tools/test-ux-visual-polish.mjs`, and update the one forbidden-file guard
  (`tools/test-production-export-validation.mjs`) that currently forbids
  `src/renderer/CupRenderer.js`/`src/renderer/CanvasRenderer2D.js` from changing, per the same
  precedent RS-0003.5D1 used for `index.html`.
- Perform the "Required Browser Verification" checklist via `npm run dev` and record actual
  observed results and screenshots in `TASK_RESULT.md`.
- Follow "Allowed Files" and "Forbidden Files" exactly as listed in the specification.
- Create exactly one logical commit using the commit message given in the specification.
- Push the feature branch `feature/rs-0003.5d2-ux-visual-polish`. Do not push to `main` or
  `develop`.
- Complete `TASK_RESULT.md` with status, commit hash, branch, files changed, tests executed,
  browser verification, screenshots, warnings, and known limitations.

## Rules

- Follow `docs/AI_ENGINEER.md` and `docs/CLAUDE_GUIDE.md`.
- Do not modify `node_modules/**`.
- Do not modify `src/geometry/**`, `src/text/**`, `src/fonts/**`, `src/core/**`,
  `src/browser/**`, or `src/export/**`.
- Do not change the Project JSON schema, the Generated Layout JSON schema, or SVG geometry.
- Do not change geometry generation behavior, GeometryEngine sampling rules, or stone
  count/bounds for unchanged project inputs.
- Do not remove legacy/dead code.
- Do not add WebGL/Three.js, redesign the full UI, redesign the zoom control, or add new
  shapes/fonts.
- If any required change falls outside the specification's "Allowed Files" list, stop and explain
  before proceeding.
- Do not commit failing tests.
