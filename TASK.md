# Task

**Task ID:** RS-2013 (Implementation Phase) — §4 step 4: flag-gated integration into the real
`Preview3DRenderer`
**Task Type:** Implementation (porting already-validated code, not new design)
**Status:** IMPLEMENTED
**Branch:** feature/rs-2013-instanced-stones-step4-integration

## Why this milestone exists

`docs/specifications/RS-2013-InstancedFacetedStoneRenderingDesign.md` §4 sequences the
instanced-faceted-stone work into 7 steps. Steps 1-3 (static grid, real placement/orientation,
lighting) and the inserted step 3b (facet geometry + material response evaluation) were all built
and evaluated in `tools/rs2013-instanced-stone-harness.html`, a standalone test harness never wired
into the live Studio. Step 3b's own `TASK_RESULT.md` (including its later single-stone,
render-time-resolution correction) landed on a clear scope for step 4: carry forward the plain
octahedron + **unmodified diffuse** `MeshStandardMaterial` (roughness=0.42, metalness=0.08) —
step 3b evaluated and rejected both a richer 16-triangle geometry (Candidate A) and a more
specular material preset (Candidate B) as the shipped default, so this milestone ships neither.

This milestone is step 4 itself: port the harness's validated placement/orientation math (step 2)
and extended lighting rig (step 3) into the real `Preview3DRenderer.js`, behind a new
`instancedStones` option on `update()`, defaulting to `false` (today's texture-baking path,
completely unchanged). Not a redesign — a porting exercise from an already-working reference
implementation.

## Scope

- Add `instancedStones` (default `false`) to `Preview3DRenderer.update()`'s options object.
- `false`/omitted: byte-identical to pre-step-4 behavior — `StoneLayoutTexture.js`'s texture-baking
  path runs exactly as before, completely untouched.
- `true`: build/update a `THREE.InstancedMesh` of stones (plain octahedron + unmodified diffuse
  material) as an additional child mesh alongside `bodyMesh`/`handleMesh`/`underMesh`, using the
  exact placement/orientation math already validated in the harness (azimuth/height/radius/normal
  per §3.3, ported not reimplemented), and skip assigning the baked stone texture to
  `bodyMesh.material.map` — the two modes are mutually exclusive per-frame.
- Also ports the harness's step-3 "extended" 4-light rig, applied only while `instancedStones` is
  on (toggled by `_applyLightRig()`); the default 2-light + 0.75-ambient rig `init()` already sets
  up is otherwise untouched.
- Follows the existing `_disposeGroup()`/`_rebuildMesh()` dispose/rebuild lifecycle for the new
  mesh — no parallel lifecycle mechanism.
- NOT exposed in `app.js`/`index.html`/the Studio UI in this step — reachable programmatically only
  (any caller of `Preview3DRenderer.update()` can pass `instancedStones: true`), consistent with
  `docs/specifications/RS-2013-InstancedFacetedStoneRenderingDesign.md` §4 step 4's own scope (step
  6, visual validation + default flip, is a separate future milestone; UI exposure is a separate
  decision for whoever scopes that step).

## Allowed files

- `src/preview3d/Preview3DRenderer.js`
- `src/preview3d/ObjectGeometryBuilder.js` (not touched — `wallRadiusAt()` was already exported by
  step 2, no further export needed)
- New test file for `Preview3DRenderer` covering both flag states
  (`tools/test-preview3d-instanced-stones.mjs`)
- `TASK.md`, `TASK_RESULT.md`

## Forbidden in this milestone

- Any change to `app.js`, `index.html`, or exposing a UI control for the flag.
- Carrying forward Candidate A (bipyramid16) or Candidate B (specular material) — step 3b rejected
  both; ship the plain octahedron + original diffuse material only.
- Deleting or modifying `StoneLayoutTexture.js`'s existing behavior — it remains fully functional
  and is the default (flag off).
- Attempting to fix the light-color washout (crystal/crystal-clear) or testing dark colors — both
  carried forward as known limitations, not resolved here (see `TASK_RESULT.md`).

## Testing

- `node tools/run-tests.mjs --all` — 100/100 passed (99 pre-existing + this milestone's new file).
- `node tools/test-documentation-consistency.mjs` — passed.
- Real-browser verification via a temporary (uncommitted, deleted before this commit), Playwright
  screenshot of the actual `Preview3DRenderer` class — see `TASK_RESULT.md`.

## Deliverables

- `src/preview3d/Preview3DRenderer.js` (the integration itself).
- `tools/test-preview3d-instanced-stones.mjs` (new Node test file, 10 tests).
- `TASK.md` (this file), `TASK_RESULT.md`.
