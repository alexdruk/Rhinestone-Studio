# Task

**Task ID:** RS-1001 (Audit Follow-up)
**Task Type:** Audit / Hardening
**Specification:** `docs/specifications/RS-1001-SvgImport.md` (see "Audit Addendum" section)
**Status:** COMPLETE
**Branch:** feature/rs-1001-svg-import-audit

## Goal

A milestone brief requested implementing RS-1001 ("SVG Import") from scratch. Inspection of the live
repository found RS-1001 already fully implemented, tested, and merged into `develop` (commit
`393af48`, an ancestor of current HEAD `4c9565b`). Per the user's direction, this task is an audit of
the existing implementation against the brief rather than a reimplementation: verify the live
`src/svg/**`/`GeometryEngine.generateSvgLayout()`/`app.js` SVG-import feature actually satisfies the
brief, fix any real gaps found, and leave everything else untouched.

## Required Outcome

* Re-run `npm test` and confirm all existing suites still pass before making any change.
* Compare the brief's minimum supported-element list (`path`, `circle`, `rect`, `ellipse`, `line`,
  `polyline`, `polygon`, `g`) against `src/svg/SvgDocumentParser.js`'s `SUPPORTED_SHAPE_ELEMENTS`.
* Exercise the feature in a real browser (import, select, move, resize, fill-mode toggle, duplicate,
  hide, delete, all five exports) via a from-scratch headless-Chrome/CDP driver, watching for console
  errors, and fix anything genuinely broken.
* Fix only real gaps found; do not re-implement, refactor, or redesign anything already working.
* Add regression tests for every fix; do not remove or weaken existing tests.
* Update the specification with an audit addendum documenting what was found and fixed.
* Commit and push a new feature branch `feature/rs-1001-svg-import-audit`. Do not push to `main` or
  `develop`.

## Rules

* Follow `docs/AI_ENGINEER.md` and `docs/CLAUDE_GUIDE.md`.
* Do not modify `node_modules/**`.
* Reuse `docs/specifications/RS-1001-SvgImport.md`'s original "Allowed Files" list as the scope
  boundary: `src/svg/**`, `src/geometry/GeometryEngine.js`, `src/geometry/StoneSampler.js`,
  `src/geometry/README.md`, `app.js`, `index.html`, `tools/**`, `package.json`,
  `docs/specifications/**`, `docs/ARCHITECTURE.md`, `TASK.md`, `TASK_RESULT.md`.
* No unrelated refactoring; no new features beyond gaps found during the audit.
* Any pre-existing guard test (`tools/test-*.mjs`) whose own forbidden-file list blocks a
  legitimately-needed fix must be updated narrowly, with a comment explaining why, matching the
  established precedent in those files (e.g. S-001's `src/renderer/` carve-out).
* Do not commit failing tests.

## Audit Findings (summary — see `TASK_RESULT.md` for full detail)

1. **Gap:** `<ellipse>` was not a supported shape element (the original spec's own list omitted it
   too). Fixed in `src/svg/SvgDocumentParser.js`.
2. **Gap:** `GeometryEngine.generateSvgLayout()` could throw `RangeError: Maximum call stack size
   exceeded` for a placed size large enough that a single sampled-points array exceeded the JS
   engine's call-argument spread limit. Fixed in `src/geometry/GeometryEngine.js`.
3. Everything else audited (transforms, `viewBox`, nested groups, editing, all five exports,
   determinism, error handling for malformed/empty/unsupported SVG) matched the brief with no
   further changes needed.
