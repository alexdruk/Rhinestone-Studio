# Task

**Task ID:** RS-2013 (Implementation Phase — §4 step 0 + step 1)
**Task Type:** Implementation
**Status:** IMPLEMENTED
**Branch:** feature/rs-2013-instanced-stones-step0-1

## Goal

`docs/specifications/RS-2013-InstancedFacetedStoneRenderingDesign.md` (Phase A) laid out an ordered,
independently-committable sequence of steps (§4) for replacing the 3D preview's canvas-texture
stone layer with real instanced, faceted 3D geometry. This task implements exactly step 0 and
step 1 of that sequence — nothing more, nothing less.

## Required Outcome

1. **Step 0 — prerequisite fixes** (design doc §2.1/§2.2, small and independent of everything
   else):
   - Fix the texture wrap mode in `src/preview3d/Preview3DRenderer.js`'s `_applyTextureParams()`
     so `wrapS` uses `THREE.RepeatWrapping` instead of always `ClampToEdgeWrapping`, for object
     kinds whose mesh has a real circumferential seam.
   - No fix required for the `Math.min(...)`/`Math.max(...)` spread pattern (§2.2) — confirmed no
     live bug; carried forward only as a coding-standard note for step 1's own new code.
2. **Step 1 — static instanced geometry on a flat test plane** (design doc §3.1/§3.2/§3.5): a
   standalone, isolated visual test harness — one `THREE.InstancedMesh` of octahedral-bipyramid
   stones (`THREE.OctahedronGeometry(radius, 0)`), correct per-instance color (via
   `src/renderer/CrystalColors.js`) and size, in a trivial flat grid. Not mapped onto any vessel
   surface, not reading a real `StoneLayout`, not wired into the live `Preview3DRenderer`/
   `app.js`/Studio UI.

## Discrepancy from the design doc (documented per `AI_ENGINEER.md`'s conflict-resolution rule)

The design doc's §2.1 describes the wrap-mode fix as gating `RepeatWrapping` on the project's own
`wrap` field being `'full'`. Auditing the live repository before implementing (per `CLAUDE.md`'s
"Repository Is The Source Of Truth") found this premise is stale:

- `Preview3DRenderer.update()`'s own docstring (S-109) states plainly: *"no `wrap` option — the
  object mesh's texture UV is wrap-mode independent... this method no longer needs to react to
  wrap-mode changes at all."* No `wrap` value reaches `_applyTextureParams()` today.
- `ObjectDimensions.js`'s module header confirms why: *"the design always wraps fully and
  continuously around the object now; wrap mode only controls how wide a slice of that
  circumference the Front View Frame currently highlights... never what the object mesh's texture
  shows."*
- `ObjectGeometryBuilder.js` builds every revolved-vessel body
  (`buildTaperedBodyGeometry()`/`buildBottleGeometry()`) with
  `THREE.LatheGeometry(points, LATHE_SEGMENTS, -Math.PI, Math.PI * 2)` — always a full 2π revolve,
  unconditionally, for mug/tumbler/bottle regardless of the project's chosen wrap mode.

So the physical seam the design doc's §2.1 describes (U=0/U=1 same point) exists for **every**
mug/tumbler/bottle project today, not just ones set to `wrap:'full'` — and the plate (flat top
surface, no revolve) never has it at all. Gating on the literal `wrap==='full'` field as described
is both unimplementable without reintroducing a parameter S-109 deliberately removed, and would
leave the seam bug unfixed for the majority of real vessel projects.

This was raised with the human owner mid-task (`AskUserQuestion`) rather than silently resolved,
since it changes the implementation's actual gating condition from what the doc's text literally
says. **Approved resolution:** gate on `this._dimensions.kind !== 'plate'` instead —
`RepeatWrapping` for every revolved body (mug/tumbler/bottle), `ClampToEdgeWrapping` only for the
plate. This matches the current architecture exactly and fixes the seam for every vessel project.

## Allowed files

- New file(s) for the step-1 test harness.
- `src/preview3d/Preview3DRenderer.js` (step 0's wrap-mode fix only — no other change).
- A new or extended test file for the wrap-mode fix.
- `TASK.md`, `TASK_RESULT.md`.

## Forbidden files / out of scope

- `app.js`, `index.html`, or any live Studio UI wiring.
- Any `StoneLayout` placement/orientation logic (design doc §3.3 — step 2, future milestone).
- Any lighting-rig change (design doc §3.4 — step 3, future milestone).
- Any flag/integration wiring into `Preview3DRenderer`'s real `update()` path (§3.6/§4 step 4).
- Deleting or modifying `StoneLayoutTexture.js` or its stone-drawing responsibility.

## Rules

- Smallest coherent change; no unrelated refactoring.
- Reuse `src/renderer/CrystalColors.js` for color — never a new/duplicate color source.
- Follow the `Math.min`/`Math.max`-spread coding-standard note (§2.2) for any new stone-count-scaled
  array in step 1's own code (reduce loop, not spread) — no such array turned out to be needed.
- Run `node tools/run-tests.mjs --all` and confirm 100% pass before considering this done.
- Commit locally with a clear message; do **not** push.

## Deliverables

- `src/preview3d/Preview3DRenderer.js` — wrap-mode fix.
- `tools/test-preview3d-render-scheduling.mjs` — extended with wrap-mode coverage.
- `tools/rs2013-instanced-stone-harness.html` — standalone step-1 visual test harness.
- `tools/rs2013-instanced-stone-harness-screenshot.mjs` — Playwright screenshot capture script.
- `tools/rs2013-instanced-stone-harness.png` — captured verification screenshot.
- `TASK.md` (this file), `TASK_RESULT.md`.
