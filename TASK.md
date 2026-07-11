# Task

**Task ID:** RS-0003.5E1
**Task Type:** Implementation
**Specification:** `docs/specifications/RS-0003.5E1-RealProductionValidation.md`
**Status:** READY FOR IMPLEMENTATION
**Branch:** feature/rs-0003.5e1-real-production-validation

## Goal

Implement RS-0003.5E1 exactly as written in
`docs/specifications/RS-0003.5E1-RealProductionValidation.md`. That specification is the source of
truth for allowed/forbidden files, required implementation steps, required automated tests,
required browser verification, acceptance criteria, commit message, and deliverables.

## Required Outcome

- Add 15 new representative `.rhs` project examples under `examples/`, using the mm-suffixed `.rhs`
  schema already established by the two preserved fixtures (`vitalina.rhs`, `vitalina-serbin.rhs`),
  covering: short/long names, monograms, script font (Great Vibes), block font (Courier Prime),
  outline mode, fill mode, front wrap, wider wrap (wide/half/full), circles, rectangles, mixed
  text+shape layers, a hidden layer, light and dark cup colors, and varied stone sizes/gaps.
- Preserve `examples/vitalina.rhs` and `examples/vitalina-serbin.rhs` byte-for-byte unmodified.
- Add `examples/manifest.json` (machine-readable, one entry per example — file, description,
  validation-purpose tags) covering all 17 files.
- Add `examples/baselines.json` (committed baseline: layer count, visible layer count, stone
  count, bounding box, font ids, colors, validation category per example), generated once via a
  dedicated script and never regenerated automatically by `npm test`.
- Add `tools/lib/rhsProject.mjs`: parses/validates the `.rhs` schema; generates each example's
  merged `StoneLayout` by calling the permanent `src/geometry/GeometryEngine.js` per layer and
  reproducing `app.js`'s existing merge/dedupe/auto-fit/centering algorithm (a faithful port, not a
  new invention — see specification's "Resolved discrepancy" section); translates an `.rhs` project
  to `app.js`'s ad hoc schema for cross-checking against the real `validateProject()` and for
  browser-import verification.
- Add `tools/generate-example-baselines.mjs`, a manually-run script that (re)computes
  `examples/baselines.json` from the current examples — not invoked by `npm test`.
- Add `tools/test-examples-regression.mjs` implementing every check listed in the specification's
  "Automated tests" section, and wire it into `package.json`'s `test` script.
- Remove `examples/` from the forbidden-file prefix list in the seven existing
  `tools/test-*.mjs` guards that currently forbid it (`test-app-module-migration.mjs`,
  `test-live-text-integration.mjs`, `test-shape-geometry-integration.mjs`,
  `test-render-export-pipeline.mjs`, `test-browser-dependency-loading.mjs`,
  `test-production-export-validation.mjs`, `test-ux-visual-polish.mjs`) — no other change to those
  files.
- Perform the "Browser verification" checklist from the specification via `npm run dev` and a
  from-scratch CDP driver (matching the RS-0003.5B2–5D2 precedent — no new browser-automation
  dependency), covering at least 8 examples, and record actual observed results, a human-review
  readability table, and screenshots in `TASK_RESULT.md`.
- Follow "Allowed Files" and "Forbidden Files" exactly as listed in the specification.
- Create exactly one logical commit using the commit message given in the specification.
- Push the feature branch `feature/rs-0003.5e1-real-production-validation`. Do not push to `main`
  or `develop`.
- Complete `TASK_RESULT.md` with status, commit hash, branch, files changed, number/names of
  examples added, baseline approach, tests, browser verification, readability findings, defects
  discovered/fixed, warnings, known limitations, and anything requiring human verification.

## Rules

- Follow `docs/AI_ENGINEER.md` and `docs/CLAUDE_GUIDE.md`.
- Do not modify `node_modules/**`.
- Do not modify `app.js`, `index.html`, `style.css`, or anything under `src/**`, `assets/**`.
- Do not change the Project JSON schema `app.js` uses, the Generated Layout JSON schema, or SVG
  export geometry.
- Do not change geometry generation behavior, `GeometryEngine` sampling rules, or the cross-layer
  dedupe formula (this milestone reproduces the existing formula for test infrastructure; it does
  not change it).
- Do not remove legacy/dead code, migrate `app.js` to `src/core`, redesign the UI, add new fonts,
  add new geometry types, or change any export schema.
- If a genuine product defect is found, fix it only if small and directly necessary, with a
  regression test and documentation in `TASK_RESULT.md` — no unrelated redesign.
- If any required change falls outside the specification's "Allowed Files" list, stop and explain
  before proceeding.
- Do not commit failing tests.
- Do not silently modify example files during test execution.
