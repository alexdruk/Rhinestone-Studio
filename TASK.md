# Task

**Task ID:** RS-1003
**Task Type:** Feature
**Specification:** `docs/specifications/RS-1003-CurvedText.md`
**Status:** IN PROGRESS
**Branch:** feature/rs-1003-curved-text

## Goal

Let any text layer follow a circular arc (curved text) while reusing the existing
`OpenTypeProvider -> VectorPath -> GeometryEngine -> StoneLayout` pipeline unchanged in every other
respect. See the specification for the full geometry model, validation rules, and file scope.

## Required Outcome

* Every text layer supports `curveEnabled` (straight/curved toggle), `curveRadiusMm`,
  `curveDirection` (`outside`/`inside`), `curveStartAngleDeg`, `curveSweepAngleDeg`, and
  `curveAlignment` (`start`/`center`/`end`).
* Arc projection happens inside `src/geometry/GeometryEngine.js` (new
  `src/geometry/ArcProjection.js` helper), between contour flattening and stone sampling. No stone
  generation in `app.js`.
* `StoneLayout`, `src/renderer/**`, and `src/export/**` require zero changes.
* Curved text is fully editable: live regeneration on any parameter change, full undo/redo, save/load
  round-trip, duplicate-preserves-curve.
* Invalid params (`radius<=0`, `NaN`, `Infinity`, `sweep===0`) are rejected with a specific,
  status-bar-surfaced error message.
* `curveEnabled:false` (default) is byte-identical to the pre-milestone straight-text pipeline.

## Rules

* Follow `docs/AI_ENGINEER.md` and `docs/CLAUDE_GUIDE.md`.
* Follow the "Allowed Files" / "Forbidden Files" lists in the specification exactly.
* Do not modify `node_modules/**`.
* Any pre-existing guard test (`tools/test-*.mjs`) whose own forbidden-file list would incorrectly
  block a legitimately-needed change here must be updated narrowly, with a comment explaining why —
  matching established precedent (e.g. the RS-1001 audit's `src/renderer/` carve-out). Based on
  inspection, no existing guard test currently forbids `src/geometry/**`, `app.js`, `index.html`, or
  `tools/**`, so none are expected to need this — recheck before assuming.
* No unrelated refactoring; no new features beyond this milestone's scope.
* Do not commit failing tests.

## Deliverables

* Specification (`docs/specifications/RS-1003-CurvedText.md`) — done.
* Implementation.
* Automated tests (new `tools/test-arc-projection.mjs`, new
  `tools/test-curved-text-integration.mjs`, additions to `tools/test-geometry-engine.mjs`).
* `npm test` passing in full.
* Browser verification via headless Chrome/CDP.
* `TASK_RESULT.md` completed.
* One commit, pushed to `feature/rs-1003-curved-text`.

---

## Addendum — UI Discoverability Fix

**Task Type:** Bug fix (human-reported, post-merge)
**Branch:** fix/rs-1003-ui-discoverability

After RS-1003 merged, manual testing reported that Curved Text, SVG Import, and Shape tools (Add
circle/Add rectangle) were not discoverable in the running app.

**Investigation:** all three features were fully implemented and correctly wired (confirmed: DOM
elements present, event listeners attached, `GeometryEngine`/`StoneLayout` unaffected). The defect
was a pure layout/discoverability issue: the left sidebar (`.side` in `index.html`) had grown to
~1615px of stacked content, while a typical browser viewport only exposes ~700-900px of it, and the
panel's native scroll had zero visual affordance. "Add circle"/"Add rectangle"/"Import SVG" sat
~800px down the panel — past the fold on every realistic screen size tested except 1920×1080.

**Fix (`index.html` only):** moved the Layers list + "Add circle"/"Add rectangle"/"Import
SVG"/"Delete selected layer" controls to immediately follow the "Selected layer" dropdown, before
any per-layer-type detail controls, so layer-creation tools are always reachable with zero scrolling.
Added a CSS-only scroll-shadow affordance to `.side` so the remaining scrollable content has a
visible cue. `app.js`, `GeometryEngine.js`, and `StoneLayout.js` were not touched.

**Tests:** new `tools/test-ui-discoverability.mjs` (7 tests), registered in `package.json`. Full
`npm test` (23 suites) passes.

**Browser verification:** headless Chrome/CDP at 1280×800, 1366×768, 1440×900, 1920×1080 — Add
circle/Add rectangle/Import SVG/Curved text are all now visible with zero scrolling at every size
tested. Functional smoke test (add circle, add rectangle, import a real SVG, enable curved text)
confirmed no regression. See `TASK_RESULT.md` for full detail and screenshots list.
