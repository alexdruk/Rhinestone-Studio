# Task

**Task ID:** RS-2013 (Implementation Phase) — §4 step 6: visual validation evidence
**Task Type:** Evidence-gathering for a human-in-the-loop decision (not a mechanical test, not a
default flip)
**Status:** COMPLETE
**Branch:** feature/rs-2013-instanced-stones-step6-visual-validation (cut from the step-5b commit
`cdccc33`, verified as HEAD before any work began)

## Why this milestone exists

Steps 1-5b built and validated the instanced-stone rendering path in isolation (static grid, real
placement/orientation, lighting, flag-gated integration, and stress/perf testing + throttle
mitigation). Per the design doc's own §4 step 6, flipping `instancedStones`'s default from `false`
to `true` is explicitly "a human-in-the-loop judgment call, not a mechanical test" — deliberately
not something an earlier step's automated tests or synthetic-fixture screenshots can settle on
their own. This step's job is to produce the clearest possible real-design comparison evidence
across all four product kinds so Sasha can make that call well-informed. **This step does not flip
the default and does not make a ship/don't-ship recommendation** — both are explicitly out of scope,
per the milestone brief.

## Scope

1. Confirm/add a convenient way to toggle `instancedStones` on a real running project in the actual
   Studio (not just the standalone `rs2013-instanced-stone-harness.html` test harness prior steps
   used) — dev-only, clearly isolated, not a user-facing control.
2. Capture real-design comparison screenshots (texture path vs. instanced path, same project, same
   camera angle) for one representative example per product kind (plate/mug/tumbler/bottle), pulled
   from actual committed `examples/*.rhs` fixtures wherever one exists — not synthetic stress
   fixtures — including at least one light stone color (crystal/crystal-clear) so step 3b's washout
   finding is honestly represented, not hidden by cherry-picking only saturated colors.
3. Write an honest, per-example comparison (better/comparable/worse for THIS design) — not an
   averaged verdict, not a recommendation.
4. Consolidate steps 3b/5b's already-known limitations in one place, stated plainly against what
   step 2 above actually shows (or doesn't show) for today's real examples.

## Allowed files

- `app.js` — only the minimal, clearly-isolated, dev-only toggle from item 1 above.
- New screenshot assets (the 8 real-design comparison PNGs from item 2).
- `TASK.md`, `TASK_RESULT.md`.

## Forbidden in this milestone

- Flipping `instancedStones`'s default to `true` anywhere.
- Adding any user-facing UI control for the flag.
- Fixing, re-investigating, or re-measuring any of steps 3b/5b's known limitations.
- Any change to placement/lighting/material/throttle logic already shipped.

## Testing

- `node -c app.js` (syntax check on the touched file).
- Manual Playwright-driven verification (scratch-only script, not committed) that both toggle
  mechanisms actually flip the live `Preview3DRenderer`'s rendering path on a real loaded project —
  see `TASK_RESULT.md` for what was observed.
- No shared architecture, schema, or exporter code changed — per `CLAUDE.md`'s testing policy,
  `npm test`/`npm run test:full` was not run for this step.

## Deliverables

- `app.js` — dev-only `?instancedStones=1` URL param + `window.__setInstancedStones(bool)` console
  helper.
- 8 screenshots in `tools/` (`rs2013-step6-<product>-texture.png` /
  `rs2013-step6-<product>-instanced.png` for plate/mug/tumbler/bottle).
- `TASK.md` (this file), `TASK_RESULT.md` (per-example honest comparison + consolidated
  limitations).
