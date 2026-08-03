# Task

**Task ID:** RS-2013 (Implementation Phase) — §4 step 5b: curved-surface perf mitigation
**Task Type:** Implementation (one named mitigation option) + verification against the step 5 benchmark
**Status:** COMPLETE
**Branch:** feature/rs-2013-instanced-stones-step5b-perf-mitigation (cut from the step-5 commit
`9e98550`, verified as HEAD before any work began)

## Why this milestone exists

Step 5 (`9e98550`) measured `Preview3DRenderer._updateInstancedStones()`'s real per-`update()` cost
at the design doc's ~15,000-stone theoretical ceiling and found the curved-surface (mug/tumbler/
bottle) path has a median ~28-29ms and max ~34-38ms during a simulated continuous drag — roughly
double the 16ms/60fps frame budget. The flat plate path (~7ms) and today's real designs (~1,161
stones, ~2.1ms median) are not at risk. The design doc's §3.2 named two mitigation options, neither
implemented: (a) debounce/throttle the rebuild, or (b) incrementally update only changed instances.
This step investigates both, picks one, implements it, and re-proves the result against the same
benchmark step 5 built.

## Scope

- Investigate option (b) first: does `StoneLayout`/`GeometryEngine` expose any way to know which
  stones changed between two calls? If not (confirmed: `StoneLayout` is a plain array of `Stone`
  objects with no identity/dirty tracking, and every edit is a fresh full regeneration —
  `src/geometry/StoneLayout.js` has no diff/dirty-index concept at all), report (b) as out of reach
  for this scope (it would require inventing new upstream diffing plumbing, a separate, bigger
  milestone) rather than faking a diffing capability that doesn't exist.
- Investigate option (a): would a debounce introduce unacceptable visible lag for a live 3D preview?
  Conclusion: a *pure trailing debounce* (mirroring `AUTOSAVE_DEBOUNCE_MS`'s exact shape) would
  freeze the stone layer for the entire duration of a drag, snapping into place only once the
  pointer stops for the full window — acceptable for a background write nobody watches happen, not
  for a live preview. Chose a **leading-edge-plus-guaranteed-trailing throttle** instead: the first
  call in a burst (or any call spaced further apart than the throttle window) always rebuilds
  immediately; only calls arriving faster than `INSTANCED_STONES_REBUILD_THROTTLE_MS` (100ms) get
  coalesced into exactly one trailing rebuild once the burst quiets. A stone-count change (add/
  remove) is never throttled — only same-count position/color updates are, since that's the specific
  high-frequency-drag scenario step 5 measured.
- Implement the chosen mitigation in `Preview3DRenderer.js` only.
- Re-run `tools/measure-instanced-stone-performance.mjs` and report the new numbers. Because the
  mitigation is time-based and the original benchmark's drag simulation has zero real delay between
  its 20 calls, add one minimal new parameter (`intervalMs` on `runDragSimulation()`, default 0 —
  every existing call site is unaffected) plus one new "mitigation verification" section that awaits
  a realistic ~8ms inter-call gap, so the throttle's real coalescing/duty-cycle behavior is honestly
  exercised and reported, not hidden behind an artifact of the zero-delay tight loop.
- Extend `tools/test-preview3d-instanced-stones.mjs` with tests for the new throttle behavior.
- State plainly whether the mitigation closes the gap (every call under 16ms) or only partially
  helps, and report the debounce/throttle-introduced lag tradeoff honestly.

## Allowed files

- `src/preview3d/Preview3DRenderer.js` (the mitigation itself).
- `tools/measure-instanced-stone-performance.mjs` (one new optional parameter + one new section, per
  above).
- `tools/test-preview3d-instanced-stones.mjs` (extended with throttle-behavior tests).
- `TASK.md`, `TASK_RESULT.md`.

## Forbidden in this milestone

- Any change to `app.js`, `index.html`, or the live Studio UI.
- Any change to placement/orientation/lighting/material logic already shipped in step 4, except as
  strictly required by the mitigation's own mechanism (none was required here).
- Choosing option (b), since it would require inventing a `StoneLayout` diffing capability that
  doesn't exist today.
- Changing the `instancedStones` default (still `false`).

## Testing

- `node tools/test-preview3d-instanced-stones.mjs` (extended, 14 tests, all pass).
- `node tools/run-tests.mjs preview3d` (both `Preview3DRenderer`-related test files, 2/2 pass).
- `node tools/measure-instanced-stone-performance.mjs` — see `TASK_RESULT.md` for the actual
  before/after numbers.
- `npm run test:full`/`node tools/run-tests.mjs --all` not run, per `CLAUDE.md`'s testing policy —
  no shared architecture, schema, or exporter code changed.

## Deliverables

- `src/preview3d/Preview3DRenderer.js` (throttle mitigation).
- `tools/measure-instanced-stone-performance.mjs` (minimal extension: `intervalMs` param + one new
  verification section).
- `tools/test-preview3d-instanced-stones.mjs` (4 new tests: 11-14).
- `TASK.md` (this file), `TASK_RESULT.md`.
