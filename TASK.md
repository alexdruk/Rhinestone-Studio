# Task

**Task ID:** RS-2013 (Implementation Phase) — §4 step 5: stone-count stress testing
**Task Type:** Measurement only (no application-code changes)
**Status:** COMPLETE
**Branch:** feature/rs-2013-instanced-stones-step5-stress-testing

## Why this milestone exists

The design doc (`docs/specifications/RS-2013-InstancedFacetedStoneRenderingDesign.md`) §1.3
identified a real, previously-unaddressed test-coverage gap: no file in `tools/` constructs a
many-thousands-of-stones fixture, so neither the steady-state GPU render cost nor the per-`update()`
CPU-side instance-buffer rebuild cost had ever been measured at realistic scale. §3.2 raised the
specific concern this step exists to answer: `Preview3DRenderer._updateInstancedStones()`'s
per-stone `Matrix4`/`Color` rebuild loop runs on **every** `update()` call, and `update()` fires on
every project edit including continuous, un-throttled `pointermove`-driven drags (`app.js:1366`,
cited by §3.2). Step 4 (flag-gated integration, `5ad66a1`) shipped the `instancedStones` option but
explicitly deferred performance-at-scale to this step.

## Scope

- Build a synthetic, programmatically-generated (not hand-authored) large-N `StoneLayout` fixture
  spanning §1.3's realistic-to-ceiling range: ~1,000 / ~5,000 / ~15,000 stones.
- Measure (a) `InstancedMesh` build success and cost at each count, and (b) the real per-`update()`
  wall-clock cost during a simulated rapid drag, at each count — report actual numbers, not a
  pass/fail.
- State plainly whether the CPU-side rebuild cost at the ceiling count is fast enough to stay under
  one 60fps frame budget (~16ms), the concrete threshold step 3/the design doc raised.
- Add a new, re-runnable benchmark script (not a `test-*.mjs` pass/fail test — a performance
  measurement, following `tools/measure-performance.mjs`'s existing convention).
- `TASK.md`/`TASK_RESULT.md` only, plus the new benchmark script. No changes to
  `src/preview3d/**`, `src/geometry/**`, `app.js`, `index.html`, or any other application code —
  this step measures, it does not optimize or fix.

## Allowed files

- New benchmark script: `tools/measure-instanced-stone-performance.mjs`
- `TASK.md`, `TASK_RESULT.md`

## Forbidden in this milestone

- Implementing either mitigation option (debouncing the rebuild, incremental/partial instance
  updates) that the design doc named as future options — measurement only.
- Any change to the placement/lighting/material logic already shipped in step 4.
- Any change to `app.js`, `index.html`, or the live Studio UI.

## Testing

- `node tools/measure-instanced-stone-performance.mjs` — the new benchmark itself; see
  `TASK_RESULT.md` for the actual numbers.
- `node tools/run-tests.mjs preview3d` — pre-existing `Preview3DRenderer`/instanced-stones tests
  (untouched by this step) still pass, confirming no regression from this measurement-only work.

## Deliverables

- `tools/measure-instanced-stone-performance.mjs` (new).
- `TASK.md` (this file), `TASK_RESULT.md`.
