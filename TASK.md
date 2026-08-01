# Task

**Task ID:** RS-2013 (Implementation Phase — §4 step 3)
**Task Type:** Implementation
**Status:** IMPLEMENTED
**Branch:** feature/rs-2013-instanced-stones-step3-lighting

## Goal

`docs/specifications/RS-2013-InstancedFacetedStoneRenderingDesign.md`'s §4 step 3: extend the
existing directional-light rig (§3.4) so it "better serves real facet normals," applied to the
step-2 harness's real placed/oriented stones (plate/mug/tumbler/bottle) — not the step-1 flat test
grid. Exactly step 3 — nothing from step 4 (flag/`Preview3DRenderer` wiring) or an HDRI evaluation
(explicitly deferred by §3.4 unless this step under-delivers, which it does — see below).

## Pre-flight check (per the task brief)

Read `Preview3DRenderer.js`'s `init()` (lines 92-102) before changing anything: ambient
`0xffffff @ 0.75`, key directional `0xffffff @ 1.6` at `(60,120,90)`, fill directional
`0xffffff @ 0.5` at `(-70,40,-60)` (added by `PREVIEW-001`, per its own inline comment, "to give the
design texture's own faceted-crystal highlights a second angle to catch"). **No drift found** — this
matches §3.4's description exactly, and also matches the harness's own step-1/2 lighting block
verbatim. No discrepancy to raise this time (unlike step 0's wrap-mode finding and step 2's
plate-flatness finding).

## What was built

Added a `?lighting=default|extended` URL param to the harness (`default` when omitted). `default`
is byte-identical to the original rig (unchanged, still the harness's own regression baseline).
`extended` adds two more directional lights and lowers ambient, all still `MeshStandardMaterial` +
ambient/directional only — no `scene.environment`, no `PMREMGenerator`, no HDRI asset, per the
task's explicit prohibition. Both the reference (left, texture-based) and instanced (right) panels
share one `THREE.Scene`, so both panels always render under whichever rig is selected — this is a
global scene property in three.js, not a per-mesh one (there is no built-in per-object light-list
override in stock `MeshStandardMaterial`/`WebGLRenderer`, so a true split-screen "rig A on the left
mesh, rig B on the right mesh, same canvas" is not achievable without maintaining two full separate
scenes+viewports; a URL-param toggle was the smaller, coherent option explicitly offered by the
task brief and was chosen over that).

Screenshots exist for both rigs per product (`-<product>.png` = default/unchanged,
`-<product>-lighting.png` = extended), giving a direct before/after image comparison. The step-1
grid view was **not** given a lighting variant, per the task's explicit scope ("apply this to the
harness's instanced stones from step 2 ... not the flat test grid from step 1").

## Rig-tuning process (why the numbers are what they are)

This was a real "build it and look" step, not a one-shot guess:

1. First attempt: two extra lights at moderate intensity (0.55/0.45), ambient 0.75→0.6. Measured
   difference via `magick compare -metric RMSE`: ~1.7% on the mug view. Visually indistinguishable
   from the original at the same crop.
2. Second attempt: a much brighter (1.0) low-elevation grazing side light 90° off the key light's
   azimuth, ambient→0.4. RMSE rose to ~2.2%, but the new light's azimuth pointed at the *side* of
   the vessel, not the front face where a design's stones actually sit — negligible visible change
   on the design itself.
3. Third (shipped) attempt: identified that both original lights are only *one* front-hemisphere
   source for camera-facing stones (the fill light's azimuth points at the back of the object from
   the camera's viewpoint) — added a second front-hemisphere light from a distinctly different
   azimuth/elevation (front-left, low), plus a third front light from underneath, ambient→0.4.
   RMSE ~3.4% on the mug view — a real, non-trivial pixel difference.
4. **Diagnostic-only check** (reverted before shipping): temporarily set the new front-secondary
   light's intensity to 2.4 (higher than the key light's 1.6) to test whether *any* lighting-only
   change could redraw which facets read bright vs. dark on a given stone, or whether the visible
   split is effectively locked in by geometry + the key light regardless of what else is added. Even
   at this unrealistic intensity, the same two facets stayed bright/dark in the same proportions —
   just uniformly brighter. This confirmed the effect is a ceiling in this material/geometry
   combination, not a mis-tuned angle, before finalizing the shipped (moderate-intensity) rig.

## Allowed files

- `tools/rs2013-instanced-stone-harness.html` (extended: `?lighting=` param, `LIGHT_RIGS` table,
  `applyLightRig()`, updated info text).
- `tools/rs2013-instanced-stone-harness-screenshot.mjs` (extended: 4 new `-lighting` views).
- New screenshot assets: `rs2013-instanced-stone-harness-{plate,mug,tumbler,bottle}-lighting.png`.
- `TASK.md`, `TASK_RESULT.md`.

No other file was touched. `src/preview3d/Preview3DRenderer.js`, `StoneLayoutTexture.js`, and the
step-2 placement/orientation math were not modified, per the task's forbidden-files list.

## Testing

- `node tools/run-tests.mjs --all`: 98/98 passed.
- `node tools/test-documentation-consistency.mjs`: passed.
- All 8 product+lighting harness views load with zero console/page errors (verified via the
  screenshot script's own error-capturing logic).
- Screenshot sizes checked (`du -sh`): 104K-252K, consistent with steps 1/2's existing asset sizes;
  nothing unexpectedly large.

## Honest outcome (see TASK_RESULT.md for the full writeup)

The extended rig is a real, working, in-bounds lighting change, but it does **not** clearly deliver
"faceted gem" over "flat painted polygon" beyond what the original 2-light rig already achieves at
this primitive/material/camera combination. The difference between rigs reads mainly as a brightness/
tone shift, not a qualitatively different facet highlight pattern — reported plainly, not smoothed
over, per the task's explicit "be honest, not optimistic" instruction.
