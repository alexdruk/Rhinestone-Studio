# Task

**Task ID:** RC-007
**Task Type:** Documentation Cleanup
**Status:** IMPLEMENTED
**Branch:** feature/rc-007-documentation-cleanup

## Goal

Version 1.0 is under feature freeze (`RC-006`). Audit repository documentation for staleness
against the live repository and fix it, without touching application code or behavior.

## Required Outcome

* Fix outdated or incorrect documentation.
* Update installation, development, testing, and workflow instructions where needed.
* Remove references to completed or obsolete work.
* Ensure milestone/status documentation reflects the current state.
* Preserve historical information where appropriate, but clearly distinguish it from current
  behavior.
* Do not modify application code except for documentation-related comments that are demonstrably
  incorrect (none were found — no application-code comment changes were made).
* Do not introduce new features or refactor code.
* Add focused checks confirming documentation is internally consistent, commands match the current
  repository, referenced files still exist, and README/developer documentation do not contradict
  each other.

## Rules

* Follow `docs/AI_ENGINEER.md`, `docs/CLAUDE_GUIDE.md`, `docs/ARCHITECTURE.md`,
  `docs/MILESTONE_WORKFLOW.md`.
* Repository is the source of truth; audit before implementing; do not guess.
* Documentation-only milestone: no `src/**`, `app.js`, `index.html`, or `style.css` changes.
* Do not run `npm test` or `npm run test:full` (per this milestone's explicit instruction) — run
  only the new documentation-validation script.

## Deliverables

* `README.md`, `CONTRIBUTING.md` — corrected current-status and setup/workflow instructions.
* `docs/BACKLOG.md`, `docs/PRODUCT_ROADMAP.md`, `docs/release-process/progress-dashboard.md` —
  corrected stale "Planned"/"not started" status for long-shipped features; marked as historical
  where a living per-milestone record already exists elsewhere.
* `docs/ARCHITECTURE.md` — fixed two internal self-contradictions ("Future Direction" and "Current
  Architectural Limitations" both still listed the product-plugin system and the 3D/WebGL renderer
  as not implemented, contradicted by that same document's own "Product Plugins"/"Renderer"
  sections a few hundred lines earlier).
* `SPEC_REVIEW_RESULT.md` — removed (orphaned, unreferenced one-off spec-review artifact from a
  long-merged milestone; no defined ongoing role in `docs/MILESTONE_WORKFLOW.md`'s Repository
  Documents list, unlike `TASK.md`/`TASK_RESULT.md`).
* `TASK.md` (this file) — updated to describe the current milestone instead of the long-merged
  S-112.
* `tools/test-documentation-consistency.mjs` (new) — automated checks for the four items above.
* `TASK_RESULT.md` — completion report.
