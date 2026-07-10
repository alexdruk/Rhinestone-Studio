# Task

**Task ID:** RS-0003.5D1
**Task Type:** Implementation
**Specification:** `docs/specifications/RS-0003.5D1-ProductionExportValidation.md`
**Status:** READY FOR IMPLEMENTATION
**Branch:** feature/rs-0003.5d1-production-export-validation

## Goal

Implement RS-0003.5D1 exactly as written in
`docs/specifications/RS-0003.5D1-ProductionExportValidation.md`. That specification is the source
of truth for allowed/forbidden files, required implementation steps, required automated tests,
required browser verification, acceptance criteria, commit message, and deliverables.

## Required Outcome

- `app.js` gains a Project JSON import path (button + hidden file input in `index.html`) that
  validates a parsed project against the app's existing ad hoc project/layer shape and, on
  success, replaces `project` and regenerates the layout; on failure, leaves `project` untouched
  and reports a specific error via `#status`.
- `src/export/SvgExporter.js` validates its inputs (`stoneLayout.stones` array present;
  `widthMm`/`heightMm` positive finite numbers) and throws a clear `TypeError` otherwise; SVG
  `<circle>` elements gain a `data-color` attribute carrying the stone's original color id.
- `app.js`'s five export button handlers guard on `layout` being present and are wrapped in
  `try`/`catch`, reporting a specific `#status` message on failure instead of throwing.
- `src/geometry/README.md` documents the Generated Layout JSON schema
  (`StoneLayout.toJSON()`/`Stone.toJSON()` shape) with a worked example.
- The specification's "Required Compatibility Work" finding — no code in the repository depends on
  the old pre-RS-0003.5C2 `x`/`y`/`d` layout schema, so no versioned compatibility layer is
  required — is recorded in the specification (already done during drafting) and does not need
  further implementation.
- The Project JSON schema and the Generated Layout JSON schema (`StoneLayout.toJSON()` shape) are
  unchanged — this milestone only adds validation, an import path, and documentation around them.
- Add the automated tests listed under the specification's "Required Automated Tests", including
  updating the two existing guard tests that currently forbid `index.html`
  (`tools/test-render-export-pipeline.mjs`, `tools/test-shape-geometry-integration.mjs`).
- Perform the "Required Browser Verification" checklist via `npm run dev` and record actual
  observed results in `TASK_RESULT.md`, including opening/inspecting each exported file's actual
  content.
- Follow "Allowed Files" and "Forbidden Files" exactly as listed in the specification.
- Create exactly one logical commit using the commit message given in the specification.
- Push the feature branch `feature/rs-0003.5d1-production-export-validation`. Do not push to
  `main` or `develop`.
- Complete `TASK_RESULT.md` with status, commit hash, branch, files changed, tests executed,
  browser verification, export compatibility findings, warnings, and known limitations.

## Rules

- Follow `docs/AI_ENGINEER.md` and `docs/CLAUDE_GUIDE.md`.
- Do not modify `node_modules/**`.
- Do not migrate `app.js`'s ad hoc project/layer objects onto `src/core/Project.js`/`Layer.js` —
  out of scope (see specification).
- Do not change the Project JSON schema or the Generated Layout JSON schema.
- Do not modify geometry generation behavior to satisfy an export test.
- Do not remove legacy/dead code.
- If any required change falls outside the specification's "Allowed Files" list, stop and explain
  before proceeding.
- Do not commit failing tests.
