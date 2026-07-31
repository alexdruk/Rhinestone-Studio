# Task

**Task ID:** RC-009
**Task Type:** File Structure Cleanup (Housekeeping)
**Status:** IMPLEMENTED
**Branch:** chore/rc-009-file-structure-cleanup

## Goal

`ARCH-REVIEW-001` (§2.2/§2.3) identified leftover milestone-specific scripts inside
`tools/font-generator/` sitting alongside genuinely reusable infrastructure, and a closed-out
font-selection program (`FONT-ARCH-001` through `FONT-POLICY-001`) whose evaluation-only output
directories are candidates for deletion now that the program is closed. Delete what is genuinely
unused; leave anything still referenced by live code or documentation in place. This is a
housekeeping milestone: deletion of things that are genuinely unused, not a redesign of anything.

## Required Outcome

1. Confirm and act on `ARCH-REVIEW-001`'s dead-`style.css` finding, and re-run the same kind of
   stale/orphaned-file search for anything else it flagged in Part 2 (empty directories, dangling
   references to files that no longer exist).
2. Re-derive `ARCH-REVIEW-001` §2.2's list of milestone-named scripts in `tools/font-generator/`
   (not just copy it) by checking imports and spec-doc coverage per script, and apply the same
   reference-check-first approach to the calibration/diagnostic experiment directories it named
   alongside them (`tools/font-cal-001/` and two sibling one-off experiment directories under
   `tools/`).
3. Confirm and act on the four evaluation-output locations named for the closed font-selection
   program: `fonts/comparison/`, `fonts/review/`, `review/` (repo root), and three numbered
   snapshot directories at repo root — directory by directory, not as one batch, grepping for
   references before each deletion.
4. Fix any dead path reference left behind in living documentation (or `.gitignore`) by a
   deletion.

## Rules

- No changes to `src/**`, `app.js`, `index.html`, or `style.css` other than a single possible
  `style.css` removal + its reference.
- `fonts/sources/` and `generated-fonts/` are off limits for this entire milestone (live
  production inputs/outputs, not orphaned study data).
- Grep the whole repository for every plausible reference before deleting anything; if genuinely
  uncertain whether something is safe to delete, leave it in place and flag it instead.
- Do not modify any `docs/specifications/*.md` file's findings/content — only fix a dead path
  reference if one exists, and say so explicitly.

## Deliverables

- `TASK.md` (this file) — updated to describe this milestone instead of the completed `RC-008`.
- `TASK_RESULT.md` — full accounting: what was deleted (with the reference-check result for each),
  what was kept and why (including anything flagged for a human decision), and total space
  reclaimed.
- `.gitignore` — stale entry for a deleted directory removed.
