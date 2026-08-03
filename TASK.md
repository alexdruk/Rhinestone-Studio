# Task

**Task ID:** RS-2013 (Implementation Phase) — §4 step 6b: tumbler wrap-seam clustering investigation
**Task Type:** Investigation only (root-cause a visual artifact found in step 6's own evidence) — not
a fix, not a mechanical test
**Status:** COMPLETE
**Branch:** feature/rs-2013-instanced-stones-step6b-tumbler-seam (cut from the step-5b commit
`cdccc33`; fast-forwarded onto step 6's own commit `ff36886` at the start of this task, since the
branch had been cut before step 6 landed and this investigation depends directly on step 6's
evidence/screenshots)

## Why this milestone exists

Step 6's real-design visual-validation evidence found a new, previously-unreported artifact on the
tumbler's `tumbler-wrap-design.rhs` example: the crystal accent ring's stones visibly cluster/overlap
in screen space near the left and right edges of the visible surface in the instanced render, while
the texture render shows the same region as a clean, evenly blurred line. Step 6 explicitly did not
investigate or fix this — it only reported it, and flagged it as "very likely" a viewing-angle
artifact rather than a placement bug, without confirming that. This step's job is to actually root-
cause it: is it a world-space stone-placement bug, or a screen-space rendering artifact — and is it
really tumbler-specific, or a property of any curved-surface product under the right design
conditions.

## Scope

1. Confirm the artifact is real and reproducible in a live browser session (not a screenshot/camera
   fluke), across multiple camera angles/zoom levels.
2. Compare the tumbler's real dimensions/profile against mug and bottle (radius, height, taper) using
   the actual product definitions and `ObjectDimensions.js`/`ObjectGeometryBuilder.js` math.
3. Determine, with direct evidence (not inference), whether this is a world-space placement bug (do
   two stones' actual 3D positions come out closer together than their canvas-space spacing implies)
   or a rendering/projection artifact (are the true 3D positions correctly spaced, with the apparent
   clustering coming from the camera/perspective/discrete-geometry-footprint side instead).
4. Determine whether the artifact is genuinely tumbler-specific or a general property of curved-
   surface products that happened to only show up on the tumbler because of which example designs
   step 6 chose.
5. Write up the finding plainly. No code fix in scope for this step.

## Allowed files

- New screenshot assets (this step's own comparison PNGs, `tools/rs2013-step6b-*.png`).
- `TASK.md`, `TASK_RESULT.md`.
- No production source files touched — this is a read-only investigation.

## Forbidden in this milestone

- Any change to placement/orientation/lighting/material/throttle logic already shipped.
- Proposing or implementing a fix/mitigation as part of this step (a future mitigation may exist —
  noted as an open option for a later, separate decision, not designed or scoped here).
- Flipping `instancedStones`'s default anywhere.
- Any change to `app.js`, `Preview3DRenderer.js`, `ObjectDimensions.js`, or any other production file.

## Method

- Headless numeric verification: generated the real `StoneLayout` for `tumbler-wrap-design.rhs` via
  `GeometryEngine`/`generateProjectStoneLayout` (the same path `tools/generate-example-baselines.mjs`
  uses), then computed nearest-neighbor stone spacing two ways — in canvas (2D, as-authored) space
  and in true 3D world space using the exact position formula from `Preview3DRenderer.js`'s
  `_updateInstancedStones()` — to test for placement compression directly, not by inference.
- Live browser verification: Playwright + Chromium against the real running Studio
  (`index.html?instancedStones=1`), importing the real `tumbler-wrap-design.rhs` example through the
  actual `#importProjectFile` path (converted via `toAppProjectShape()`/`validateRhsProject()`, the
  same real bridge functions step 6 used), then driving `#rotation`/`#zoom` and screenshotting `#cup`
  at several camera states.
- Generalization test: added a synthetic circle/outline ring layer to the mug's own
  `short-name-block.rhs` example, sized to sweep the same azimuth extent (~±62°) as the tumbler's
  ring, to test whether the same artifact reproduces on a different product kind under equivalent
  design conditions.
- No `tools/*.mjs` scripts committed (scratch-only, per this milestone's Allowed Files list — same
  convention step 6 used for its own Playwright verification).

## Testing

- No source files changed, so no syntax/unit tests apply.
- `npm test`/`npm run test:full` not run — no shared architecture, schema, or exporter code touched,
  per `CLAUDE.md`'s testing policy.

## Deliverables

- `TASK.md` (this file), `TASK_RESULT.md` (root-cause finding).
- `tools/rs2013-step6b-tumbler-front-instanced.png` — reproduces the reported clustering at a closer,
  more legible framing than step 6's own screenshot.
- `tools/rs2013-step6b-tumbler-az62-instanced.png` / `tools/rs2013-step6b-tumbler-az62-texture.png` —
  matched camera-state pair proving the clustering is instanced-only and camera-relative (rotating
  the clustering-prone azimuth to center clears it there and moves it to the new grazing edge).
- `tools/rs2013-step6b-mug-synthetic-ring-instanced.png` — the same artifact reproduced on the mug via
  a synthetic same-azimuth-extent ring, proving this is not tumbler-specific.
