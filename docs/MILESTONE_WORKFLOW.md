# Rhinestone Studio — Milestone Workflow

## Purpose

This document defines the development workflow for Rhinestone Studio.

The goal is to move faster while preserving architectural consistency and reliable milestone-level review.

The repository is the source of truth.

---

## Roles

### ChatGPT — Software Architect

ChatGPT owns:

- product and technical roadmap,
- milestone definition,
- architectural decisions,
- cross-module design,
- acceptance criteria for major milestones,
- final milestone review,
- merge recommendation,
- identification of follow-up milestones.

ChatGPT does not normally write implementation task files or detailed implementation specifications.

ChatGPT reviews at the milestone level unless a task is unusually risky.

### Claude Code — Implementation Engineer

Claude Code owns:

- drafting the milestone specification,
- creating and maintaining `TASK.md`,
- implementing the approved milestone,
- writing or updating tests,
- running automated tests,
- running browser or manual verification when possible,
- completing `TASK_RESULT.md`,
- committing and pushing the branch,
- fixing issues found during review.

Claude must follow the repository documents and the milestone definition supplied by ChatGPT.

### Human Owner

The human owner:

- starts Claude sessions,
- performs interactive checks that require a real display or judgment,
- decides whether to merge after ChatGPT's recommendation,
- resolves conflicts when repository instructions disagree.

---

## Standard Workflow

### 1. Milestone Definition

ChatGPT provides a concise milestone brief containing:

- milestone ID and title,
- goal,
- required outcome,
- architectural constraints,
- expected visible change,
- out-of-scope items,
- milestone-level acceptance criteria.

This brief is the architectural direction for the milestone.

### 2. Claude Drafts the Work Package

Claude reads:

- `docs/ARCHITECTURE.md`,
- `docs/AI_ENGINEER.md`,
- `docs/CLAUDE_GUIDE.md`,
- the previous milestone result,
- the milestone brief.

Claude then:

1. writes or updates the specification in `docs/specifications/`,
2. writes `TASK.md`,
3. checks the specification against the live repository,
4. records any assumptions or conflicts,
5. proceeds to implementation unless a blocking architectural contradiction exists.

A separate specification-review-only session is not required by default.

### 3. Implementation

Claude implements the milestone exactly within the approved scope.

Claude must:

- keep the repository as the source of truth,
- make the smallest coherent change,
- avoid unrelated refactoring,
- add meaningful tests,
- run all required checks,
- complete `TASK_RESULT.md`,
- create one logical commit unless the task explicitly requires more,
- push the working branch.

### 4. Milestone Review

ChatGPT reviews:

- the milestone specification,
- `TASK_RESULT.md`,
- commit summary,
- changed-file list,
- important test results,
- warnings and known limitations.

ChatGPT reviews source diffs only when needed.

The default review output is one of:

- `APPROVED`,
- `APPROVED WITH MINOR COMMENTS`,
- `CHANGES REQUESTED`.

### 5. Merge

After approval:

1. run final tests on the target branch,
2. merge,
3. push,
4. delete the feature branch when no longer needed.

---

## When a Separate Specification Review Is Required

Use a separate review-only phase only when the milestone includes one or more of the following:

- a new core architectural boundary,
- a persistent data-format change,
- a migration that can corrupt project files,
- a security-sensitive feature,
- a new external service or dependency,
- a major renderer or exporter replacement,
- a change that is difficult to reverse,
- unclear or conflicting repository constraints.

For ordinary implementation milestones, Claude drafts and implements in one workflow.

---

## Milestone Size

Prefer milestones that represent a meaningful user-visible or architectural outcome.

A milestone should usually contain enough work for approximately one to five focused development days.

Avoid splitting work into tiny administrative sub-milestones unless the split reduces real technical risk.

---

## Review Depth

Review effort should match risk.

### Low Risk

Examples:

- documentation,
- isolated tests,
- small UI corrections,
- mechanical module moves.

Review:

- changed files,
- test results,
- visible behavior,
- milestone acceptance criteria.

### Medium Risk

Examples:

- module integration,
- geometry changes,
- font loading,
- exporter changes.

Review:

- architecture,
- important implementation choices,
- tests,
- key diffs,
- manual verification.

### High Risk

Examples:

- project schema changes,
- destructive migrations,
- replacement of the geometry source of truth,
- production-file export changes.

Review:

- full specification,
- migration strategy,
- compatibility,
- detailed diffs,
- rollback path,
- manual verification.

---

## Repository Documents

The following documents have distinct purposes:

- `docs/ARCHITECTURE.md` — stable technical architecture.
- `docs/MILESTONE_WORKFLOW.md` — development and review process.
- `docs/AI_ENGINEER.md` — engineering rules for any implementation agent.
- `docs/CLAUDE_GUIDE.md` — operational instructions for Claude Code.
- `docs/REVIEW_CHECKLIST.md` — milestone-level review checklist.
- `TASK.md` — current milestone implementation task.
- `TASK_RESULT.md` — current milestone implementation report.
- `docs/specifications/` — milestone specifications.

Do not duplicate the same rules across every file unless repetition prevents a common failure.