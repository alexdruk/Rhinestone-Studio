# Task

**Task ID:** S-106
**Task Type:** Additive export feature — Combined Visual Preview PNG Export
**Specification:** `docs/specifications/S-106-CombinedVisualPreviewPNGExport.md`
**Status:** IMPLEMENTED
**Branch:** feature/s-106-combined-visual-preview-png-export

## Goal

Add one new Export option, "Export Combined Preview PNG", that produces a single PNG with the
current 2D Canvas on the left and the current Object Preview (3D) on the right, side by side, on a
white background — reflecting exactly what the operator currently sees, including whatever 3D
rotation/zoom is live, without requiring a switch to the Object Preview tab first.

## Required Outcome

See `docs/specifications/S-106-CombinedVisualPreviewPNGExport.md` in full. Summary:

* Audit-first: confirmed both `layoutCanvas`/`#layout` and `cupCanvas`/`#cup` are permanently
  mounted, always-rendered `<canvas>` elements regardless of the active workspace tab (the existing
  `.tab-hidden{visibility:hidden}` invariant, never `display:none`, documented in `index.html` for
  exactly this reason); confirmed the default `workspaceMode` is `'dual'` (both panels already shown
  side by side on load); confirmed `Preview3DRenderer` is constructed with
  `preserveDrawingBuffer:true` so its canvas's pixels are readable after the fact, the same
  precondition the existing `#exportCup` handler already relies on; confirmed `#exportPNG`/`#exportCup`
  already establish a "capture an existing rendered canvas via `toBlob`, not a standalone exporter"
  precedent this milestone reuses verbatim.
* `index.html`: one new button, `#exportCombined`, added to the existing "Visual previews"
  `.export-group` inside `#lightboxExport`, alongside `2D SVG` / `2D PNG` / `3D / Object Preview PNG`.
* `app.js`: new `composeCombinedPreviewCanvas()` — draws `layoutCanvas` (left) then `cupCanvas`
  (right) at their own native pixel size onto a new offscreen canvas with a white background and a
  fixed margin/gap, vertically centered on whichever is taller. `#exportCombined`'s handler mirrors
  the existing export handlers' guard/try-catch shape exactly and reuses `exportCanvas()` unchanged.
* No change to `GeometryEngine`, `StoneLayout`, the project schema, production geometry, any existing
  exporter, or any existing export's output.

## Rules

* Follow `docs/AI_ENGINEER.md`, `docs/CLAUDE_GUIDE.md`, `docs/ARCHITECTURE.md`,
  `docs/MILESTONE_WORKFLOW.md`.
* Repository is the source of truth; audit before implementing; do not add functionality beyond what
  the specification requires.
* Do not touch `GeometryEngine`, `StoneLayout`, the project schema, production geometry, any
  exporter's existing output, or any renderer (`src/renderer/**`, `src/preview3d/**`).

## Deliverables

* `index.html`, `app.js` — new `#exportCombined` export option and `composeCombinedPreviewCanvas()`.
* `tools/test-s106-combined-visual-preview-png-export.mjs` — new test suite.
* `tools/test-production-export-validation.mjs` — updated export-handler-count assertion.
* `package.json` — new test wired into the `test` script.
* `docs/specifications/S-106-CombinedVisualPreviewPNGExport.md` — full specification and audit
  findings.
* `npm test` passing in full.
* Real-browser verification (headless Chromium via Playwright, isolated local run) of the export
  working immediately after startup with no tab switch, correctly capturing a rotated Object
  Preview on re-export, and existing PNG exports unaffected — with sample PNGs.
* `TASK_RESULT.md` completed.
* One commit on `feature/s-106-combined-visual-preview-png-export`, branch pushed (not merged).
