# Task

**Task ID:** RS-1013 (task brief labeled "RS-1010" — already used/merged for Alignment & Snapping
Upgrade; filed as RS-1013, the next free id — see the spec's "Numbering note")
**Task Type:** Feature — Variable Stone Sizes (Stone Library)
**Specification:** `docs/specifications/RS-1013-VariableStoneSizes.md`
**Status:** IMPLEMENTED
**Branch:** feature/rs-1013-variable-stone-sizes

## Goal

Allow each layer to use its own stone size, with a configurable, extensible library of standard
commercial rhinestone sizes (SS6, SS10, SS16, SS20, SS30) shown by both commercial name and actual
diameter. The selected size affects geometry generation only — rendering, exports, Production
Sheet, and 3D preview consume the resulting `StoneLayout` exactly as they do today. No parallel
geometry generation; `GeometryEngine` stays the single authority for stone placement.

## Required Outcome

See `docs/specifications/RS-1013-VariableStoneSizes.md` in full. Summary:

* Audit-first: per-layer variable stone size (geometry, fill, spacing, rendering, exports,
  Production Sheet, 3D preview, undo/redo, duplicate, save/load) was **already fully implemented**
  before this milestone — verified with tests, not reimplemented.
* New: `src/renderer/StoneSizes.js`, a data-only Stone Library catalog (SS6/SS10/SS16/SS20/SS30 ->
  nominal mm), mirroring the existing `CrystalColors.js` catalog pattern exactly — no switch
  statements, one more list entry to add a size later.
* The one shared `#stoneSize` picker is now populated from this catalog ("SS16 — 4.0 mm"), with a
  synthetic "Custom — X mm" fallback for any pre-existing project's non-catalog value (backward
  compatible — never silently snaps a stored value to a different displayed size).
* `ProductionSheetExporter.js`'s header now shows the commercial name alongside mm (the one
  required exporter change, per the "display both" acceptance criterion).

## Rules

* Follow `docs/AI_ENGINEER.md`, `docs/CLAUDE_GUIDE.md`, `docs/ARCHITECTURE.md`,
  `docs/MILESTONE_WORKFLOW.md`.
* Repository is the source of truth; audit before implementing; do not duplicate
  `GeometryEngine`/`StoneLayout` generation.
* Do not modify `GeometryEngine`, `Stone`, `StoneLayout`, or any renderer beyond the required
  Production Sheet header line — none of this milestone's work required touching any of them.
* Preserve backward/project compatibility: a project saved before this milestone must load and
  render unchanged; its `stoneSize` value must not be silently altered by the new picker.

## Deliverables

* `src/renderer/StoneSizes.js` — new Stone Library catalog.
* `app.js`, `index.html` — `#stoneSize` picker now catalog-driven, with legacy-value fallback.
* `src/export/ProductionSheetExporter.js` — header stone-size formatting gains commercial names.
* `docs/specifications/RS-1013-VariableStoneSizes.md` — full specification and audit.
* `docs/ARCHITECTURE.md` — RS-1013 implementation-status addendum and Layer map row.
* Tests: `tools/test-stone-size-library.mjs`, `tools/test-variable-stone-sizes.mjs` (new);
  `tools/test-ux-visual-polish.mjs`, `tools/test-app-module-migration.mjs`,
  `tools/test-shape-geometry-integration.mjs`, and several pre-existing milestones' own
  forbidden-file guards updated for the new legitimately-changed files; `package.json` test script
  updated.
* `npm test` passing in full.
* Real-browser verification (headless Chrome/CDP, isolated profile) of stone-size selection across
  every supported layer type, a mixed-size project, exports, Production Sheet, 2D canvas, 3D
  preview, Dual Workspace, with screenshots.
* `TASK_RESULT.md` completed.
* One commit on `feature/rs-1013-variable-stone-sizes`, branch pushed (not merged).
