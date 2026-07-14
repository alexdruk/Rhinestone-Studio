# Task

**Task ID:** S-107
**Task Type:** Readability fix — Long Text Readability
**Specification:** `docs/specifications/S-107-LongTextReadability.md`
**Status:** IMPLEMENTED
**Branch:** feature/s-107-long-text-readability

## Goal

Improve the readability of long text projected onto cylindrical objects (Object Preview), without
regressing short/medium text, without a second layout pipeline, and without changing production
geometry, exporters, or the project schema.

## Required Outcome

See `docs/specifications/S-107-LongTextReadability.md` in full. Summary:

* Audit-first: walked the full text pipeline (measurement, scaling, spacing, wrap angle, projection)
  and confirmed the root cause is in the **scaling/spacing** stages, not wrap angle or projection:
  `app.js`'s auto-fit (`generateTextStonesLive()`/`resolveLayerShapeSource()`) shrinks a long text
  layer's `heightMm` without limit to fit `project.canvas.width`, but never shrinks the stone pitch
  (`stoneSizeMm`+`gapMm`) to match — so sufficiently long text renders as illegible stone soup in
  **both** the 2D Canvas and the Object Preview (the same shared `StoneLayout`, per
  `docs/ARCHITECTURE.md`'s single-source-of-truth principle), confirmed empirically in a real,
  unmocked browser.
* `app.js`: new `computeAutoFitScale()` helper (used by both existing auto-fit call sites, replacing
  their previously duplicated inline arithmetic) clamps the auto-fit shrink to a legibility floor —
  `heightMm` never drops below `MIN_AUTOFIT_HEIGHT_TO_SPACING_RATIO` (6) times the stone pitch. Text
  short/plain enough that the old scale never crossed that floor is byte-identical to before; only
  pathologically long text now overflows `maxWidth` (surfacing the pre-existing "outside the
  printable area" / "Center Text" warning) instead of collapsing into illegible dots.
* Stone size/gap are never rescaled — they are real catalog rhinestone sizes
  (`src/renderer/StoneSizes.js`), and silently shrinking them would misrepresent what gets
  manufactured.
* No change to `GeometryEngine`, `StoneLayout`, the project schema, any exporter, any renderer, or
  `src/preview3d/**`. No second layout pipeline. No multi-row text.

## Rules

* Follow `docs/AI_ENGINEER.md`, `docs/CLAUDE_GUIDE.md`, `docs/ARCHITECTURE.md`,
  `docs/MILESTONE_WORKFLOW.md`.
* Repository is the source of truth; audit before implementing; do not add functionality beyond what
  the specification requires.
* Do not touch `GeometryEngine`, `StoneLayout`, the project schema, production geometry, any
  exporter's existing output, or introduce a second layout pipeline.

## Deliverables

* `app.js` — new `MIN_AUTOFIT_HEIGHT_TO_SPACING_RATIO` constant and `computeAutoFitScale()` helper,
  wired into both existing auto-fit call sites.
* `tools/test-s107-long-text-readability.mjs` — new test suite (structural + behavioral).
* `package.json` — new test wired into the `test` script.
* `docs/specifications/S-107-LongTextReadability.md` — full specification and audit findings.
* `npm test` passing in full.
* Real-browser verification (headless Chromium via Playwright, isolated local run) of short/medium/
  very-long text on mug/tumbler/bottle, before and after, with sample screenshots.
* `TASK_RESULT.md` completed.
* One commit on `feature/s-107-long-text-readability`, branch pushed (not merged).
