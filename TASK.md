# Task

**Task ID:** TXT-104 — Text Height Accuracy: Design and Audit Phase
**Task Type:** Design/audit only — no implementation code, no tests, no application changes
**Status:** COMPLETE
**Branch:** `feature/txt-104-text-height-accuracy` (already checked out at task start; clean tree;
HEAD was `e3cc809`, RS-2013 step 7's follow-up commit)

## Why this milestone exists

Sasha's stated top product priority is text-quality/opentype outline sampling accuracy. ARCH-REVIEW-001
listed "`heightMm` is em size, not physical letter height" as already closed, attributing the fix to
`TXT-103A`. Since `TXT-103A` predates the entire font-portfolio program (Baloo2/Anton/Sacramento/
DancingScript, SS30 gating) and RS-2013's 3D-rendering arc, this milestone re-verifies that claim
against the live codebase rather than trusting the prior summary, and — per this milestone's own
explicit brief — produces a design proposal for closing the gap if it's confirmed still open. This
phase is deliberately review-only (no implementation) because the change touches persistent project
data (`layer.height`'s interpretation) and interacts with an existing, human-calibrated legibility
gate (SS30/`supportedHeightRangeMm`), both of which `docs/MILESTONE_WORKFLOW.md` classifies as
requiring a separate specification-review phase before implementation.

## Scope

1. Read `TXT-103A` (`docs/specifications/TXT-103A-TextSizingArchitectureAudit.md`) in full and
   re-check every specific, checkable claim it makes against the current `src/text/**`,
   `src/fonts/**`, and `src/geometry/**` code — not from memory, not from ARCH-REVIEW-001's summary.
2. Confirm whether the actual ARCH-REVIEW-001 gap ("heightMm is em size, not physical letter
   height") is still live, and quantify it with real measurements from the shipped font files
   (Baloo2, Anton, Sacramento, Dancing Script, RS Block, RS Modern), not estimates.
3. Propose a concrete design for closing the gap: where the correction belongs in the pipeline,
   per-font vs. generic-heuristic derivation, backward compatibility for existing saved projects,
   and interaction with Auto Fit and the SS30 height-ceiling gating (FONT-POLICY-001).
4. Break the implementation into ordered, independently-testable steps for a later milestone on
   this same branch.

## Allowed files

- `docs/specifications/TXT-104-TextHeightAccuracyDesign.md` (new).
- `TASK.md`, `TASK_RESULT.md`.

## Forbidden in this milestone

- Any change to `src/**`, `app.js`, `index.html`, or any test file.
- Any proof-of-concept implementation, even partial.

## Method

- Verified starting repo state (branch, clean tree, recent HEAD) before any work, per the task
  brief's explicit instruction.
- Read `docs/AI_ENGINEER.md`, `docs/CLAUDE_GUIDE.md`, `docs/MILESTONE_WORKFLOW.md`, and
  `docs/ARCHITECTURE.md` in full.
- Read `docs/specifications/TXT-103A-TextSizingArchitectureAudit.md` in full and
  `docs/specifications/ARCH-REVIEW-001-FullArchitectureAndCodebaseReview.md`'s relevant sections.
- Re-read the current `src/text/OpenTypeProvider.js`, `src/text/rhinestoneFont/RhinestoneFontProvider.js`,
  `src/text/IFontProvider.js`, `src/geometry/ShapeFit.js`, relevant `src/geometry/GeometryEngine.js`
  regions, `src/fonts/FontManager.js`, and the relevant `app.js` sections (Auto Fit, Fit-to-Shape,
  the `#height` clamp, `updateStoneSizePrintableCapabilityUI()`) to re-verify every TXT-103A claim
  line by line.
- Inspected `assets/fonts/manifest.json` and the actual shipped font files (`assets/fonts/**`)
  to confirm which fonts `productionFonts()` actually offers today.
- **Measured real font metrics** for the four shipped OpenType production fonts (Baloo2, Anton,
  Sacramento, Dancing Script) by parsing each `.ttf` with `opentype.js` (the same library
  `OpenTypeProvider.js` already uses) and reading both the OS/2 table's `sCapHeight`/`sxHeight`
  fields and the actual rendered bounding box of reference glyphs (`H`, `x`) — no estimates.
- Checked for an existing `FONT-PORTFOLIO-001` spec file (none exists as a standalone doc; its
  content lives only in manifest.json annotations and other specs' cross-references) and confirmed
  the live `productionFonts()` gate in `app.js` matches what those annotations describe.
- Determined the next milestone id (`TXT-104`) by checking `docs/specifications/`'s existing
  `TXT-10x` naming (only `TXT-103A` exists; `TXT-103B` was recommended but never filed) and the
  branch name.

## Testing

Not applicable — no code changed. No automated tests were run or are required for a
documentation-only deliverable.

## Deliverables

- `docs/specifications/TXT-104-TextHeightAccuracyDesign.md` — full re-verification, quantified gap
  confirmation, design proposal, and implementation sequencing.
- `TASK.md` (this file), `TASK_RESULT.md` (audit summary).
