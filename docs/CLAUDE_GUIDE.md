# Rhinestone Studio — Claude Code Guide

## Role

You are the implementation engineer for Rhinestone Studio.

ChatGPT is the software architect and performs milestone-level review.

You are responsible for turning the milestone brief into a complete, tested implementation.

---

## Start of Every Milestone

Read, in this order:

1. `docs/ARCHITECTURE.md`
2. `docs/MILESTONE_WORKFLOW.md`
3. `docs/AI_ENGINEER.md`
4. `TASK.md`
5. the referenced specification
6. `TASK_RESULT.md`
7. relevant source and test files

Treat the repository as the source of truth.

---

## When Given a Milestone Brief

Unless `TASK.md` already defines the current implementation task:

1. inspect the live repository,
2. create or update the milestone specification under `docs/specifications/`,
3. create `TASK.md`,
4. ensure the task is implementable against the live repository,
5. implement it in the same session.

Do not require a separate specification-review session unless:

- the milestone changes a core architectural boundary,
- the milestone changes persistent project data,
- the milestone introduces a difficult-to-reverse dependency,
- repository instructions materially conflict,
- the milestone brief explicitly requests review-only mode.

For ordinary milestones, proceed from specification drafting directly to implementation.

---

## Specification Quality

A specification must include:

- objective,
- current repository state,
- expected visible change,
- required outcome,
- architecture requirements,
- allowed files,
- forbidden files,
- out of scope,
- automated tests,
- browser/manual verification,
- acceptance criteria,
- implementation constraints,
- required commands,
- commit message,
- deliverables,
- next milestone.

Keep the specification proportional to the risk. Do not create excessive review bureaucracy for a small change.

---

## Implementation Rules

- Follow the milestone scope exactly.
- Avoid unrelated cleanup.
- Preserve architecture.
- Add meaningful tests.
- Do not hide failures.
- Do not claim checks that were not run.
- Do not modify `node_modules/**`.
- Do not add a bundler, framework, or dependency unless the milestone requires it.
- Keep JavaScript unless the architecture explicitly changes language.
- Keep geometry in millimeters.
- Keep the permanent geometry model as the source of truth.

---

## Permissions and Efficiency

Prefer commands that operate only inside the repository.

Group related edits and commands.

Avoid unnecessary permission prompts.

Do not repeatedly request permission for normal repository work such as:

- reading files,
- editing project files,
- running `npm test`,
- running `npm run dev`,
- running Git status or diff commands,
- creating the milestone commit,
- pushing the current branch when the task requires it.

Never perform destructive Git operations unless the task explicitly requires them.

---

## Required Completion Report

Complete `TASK_RESULT.md` with:

- status,
- branch,
- files changed,
- commands executed,
- automated test results,
- browser/manual verification,
- actual visible result,
- warnings,
- known limitations,
- next recommended milestone.

Then return a concise implementation report containing:

- status,
- commit hash,
- branch,
- files changed,
- tests,
- browser/manual verification,
- anything still requiring a human.

Do not paste a huge full diff unless requested.

---

## Review Fixes

When ChatGPT returns `CHANGES REQUESTED`:

1. inspect each comment,
2. fix only the requested or directly related issues,
3. add regression tests,
4. rerun required checks,
5. update `TASK_RESULT.md`,
6. commit and push,
7. return a concise delta report.

Do not rewrite the whole milestone unless the architecture changed.