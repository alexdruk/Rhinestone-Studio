# Task

**Task ID:** RS-2013 (Implementation Phase) — §4 step 6c: default-flip decision
**Task Type:** Implementation — one-line default flip + caller audit + test-suite update
**Status:** COMPLETE
**Branch:** `feature/rs-2013-instanced-stones-step6c-default-flip` (already checked out at task
start; clean tree; HEAD included the step 6b tumbler-seam investigation commit `04d0ff6`)

## Why this milestone exists

Steps 1-6/6b built, tested, stress-tested, and visually validated the instanced-stone rendering
path behind a flag, and investigated the one open visual question (tumbler wrap-seam clustering)
down to a root cause. Sasha has now made the default-flip decision described in §4 step 6 of
`docs/specifications/RS-2013-InstancedFacetedStoneRenderingDesign.md`, informed by that evidence
and three documented, non-blocking known limitations:

1. Light-colored stone washout against the live background (step 3b).
2. A curved-surface CPU-rebuild perf ceiling at extreme (~15,000) stone counts, partially
   mitigated by throttling (step 5b).
3. Grazing-angle stone crowding on high-azimuth-extent curved-surface designs (step 6b) — an
   inherent property of discrete 3D geometry at silhouette viewing angles, not a bug.

None of these block this decision; all three are carried forward as known, accepted limitations
of the newly-default behavior (see TASK_RESULT.md).

## Scope

Flip `instancedStones`'s default from `false` to `true` in
`src/preview3d/Preview3DRenderer.js`'s `update()` — and nothing else. This is intentionally the
entire scope: no placement/lighting/material/throttle logic changes, no attempt to further
mitigate the three known limitations above.

1. The one-line default flip itself.
2. Audit every caller of `preview3D.update(...)` for an assumption baked in around the OLD
   default, and fix what needs fixing to keep testing/behaving as originally intended.
3. Confirm (not assume) that `true`/omitted now produces byte-identical behavior to what explicit
   `instancedStones: true` already produced and was already fully tested by steps 4/5b.
4. Update the test suite: every existing test must still test what it originally intended to test,
   plus one new test confirming `instancedStones` omitted now behaves identically to
   `instancedStones: true` (the mirror image of step 4's own regression test for the OLD default).

## Allowed files

- `src/preview3d/Preview3DRenderer.js` (the one-line default flip).
- Any test file requiring an explicit `instancedStones: false` to keep testing the texture path.
- `tools/rs2013-instanced-stone-harness.html` (only if it needed an explicit `false` per the
  caller audit — audited, did not: see TASK_RESULT.md §2).
- `TASK.md`, `TASK_RESULT.md`.
- `app.js` — not originally listed, but the caller audit (§2 of the brief) explicitly required
  auditing app.js's own call site and step 6's dev toggle for an OLD-default assumption; one was
  found and required a fix for the default flip to have its intended real-world effect. See
  TASK_RESULT.md §2 for the full reasoning on why this was in-scope despite not being pre-listed.

## Forbidden in this milestone

- Any change to placement/lighting/material/throttle logic.
- Attempting to fix or further mitigate any of the three known limitations.

## Method

- Grepped the whole repo (`app.js`, every `src/`/`tools/` file, every test file) for every
  `instancedStones` reference and every `preview3D.update(...)`/`Preview3DRenderer.update(...)`
  call site, to build the exhaustive caller list required by the brief.
- Read `docs/specifications/RS-2013-InstancedFacetedStoneRenderingDesign.md` §4 steps 6-7 in full
  before starting, to confirm step 7 (removing the old texture path) is explicitly out of scope
  for this step.
- Ran the full focused test suite for every touched/adjacent area:
  `tools/test-preview3d-instanced-stones.mjs`, `tools/test-preview3d-render-scheduling.mjs`,
  `tools/test-object-template-integration.mjs`, `tools/test-render-export-pipeline.mjs`,
  `tools/test-text-position-workflow.mjs`, `tools/test-object-geometry-builder.mjs`.
- Live browser verification (Playwright + Chromium, isolated instance, closed after use) against
  the real running Studio (`python3 -m http.server 5173`) at three URLs
  (`index.html`, `index.html?instancedStones=0`, `index.html?instancedStones=1`), screenshotting
  the default project's real Object Preview in each mode and checking for console/page errors.

## Testing

- `node tools/test-preview3d-instanced-stones.mjs` — 14/14 pass (was 14 tests, 1 removed as
  testing a now-false premise, 2 fixed to explicit `false`, 1 new mirror test added).
- `node tools/test-preview3d-render-scheduling.mjs`, `test-object-template-integration.mjs`,
  `test-render-export-pipeline.mjs`, `test-text-position-workflow.mjs`,
  `test-object-geometry-builder.mjs` — all pass, unchanged.
- `npm test`/`npm run test:full` not run — per `CLAUDE.md`'s testing policy, this milestone
  touches one default value in one renderer option plus its direct callers/tests, not shared
  architecture, project schema, or exporters.
- Browser verification: 3 modes, 0 console/page errors in any, visually confirmed instanced
  (faceted 3D gems) vs. texture (flat blurred dots) rendering in the correct mode each time.

## Deliverables

- `TASK.md` (this file), `TASK_RESULT.md` (full caller audit + findings).
- `src/preview3d/Preview3DRenderer.js` — the default flip + updated doc comment.
- `app.js` — dev-toggle baseline flip (see TASK_RESULT.md §2).
- `tools/test-preview3d-instanced-stones.mjs` — 3 tests fixed to explicit `instancedStones:
  false`, 1 new mirror test added, tests renumbered 1-14 sequentially.
