# Task

**Task ID:** RS-0003.5B2
**Task Type:** Implementation
**Specification:** `docs/specifications/RS-0003.5B2-BrowserDependencyLoading.md`
**Specification Review:** `SPEC_REVIEW_RESULT.md` — Status: SPECIFICATION APPROVED (Round 4)
**Status:** READY FOR IMPLEMENTATION
**Branch:** feature/m2-vector-text

## Goal

Implement RS-0003.5B2 exactly as written in `docs/specifications/RS-0003.5B2-BrowserDependencyLoading.md`. That specification is the source of truth for allowed/forbidden files, required implementation steps, required automated tests, required browser verification, acceptance criteria, commit message, and deliverables.

Do not implement any part of RS-0003.5B3 (live integration of `GeometryEngine`, `OpenTypeProvider`, or `FontManager`). That is explicitly out of scope per the specification's "Next Milestone" section.

## Required Outcome

- Add browser-compatible dependency resolution for `opentype.js` via an import map plus a browser-only adapter under `src/browser/**`, per "Required Implementation" section 1 of the specification.
- `src/text/OpenTypeProvider.js` must remain unchanged.
- Add the browser dependency probe per "Required Implementation" section 2.
- Wire `app.js` to import the probe per "Required Implementation" section 3, without changing any visible or runtime behavior.
- Add all automated tests listed under "Required Automated Tests" (items 1–25).
- Perform the "Required Browser Verification" checklist via `npm run dev`, including MIME-type verification, and record actual observed values in `TASK_RESULT.md`.
- Follow "Allowed Files" and "Forbidden Files" exactly as listed in the specification.
- Create exactly one logical commit using the commit message given in the specification.
- Push the current feature branch (`feature/m2-vector-text`). Do not push to `main` or `develop`.
- Complete `TASK_RESULT.md` with status, commit hash, branch, files changed, tests executed, browser verification, observed MIME types, actual default stone count and bounds, warnings, and known limitations.

## Rules

- Follow `docs/AI_ENGINEER.md` and `docs/CLAUDE_GUIDE.md`.
- Do not modify `node_modules/**`.
- Do not refactor unrelated code in `app.js` or elsewhere.
- Do not rename existing controls or DOM IDs.
- If any required change falls outside the specification's "Allowed Files" list, stop and explain before proceeding.
- Do not commit failing tests.
