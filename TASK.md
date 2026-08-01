# Task

**Task ID:** RS-2013 (Implementation Phase — inserted step between §4 step 3 and step 4, "step 3b")
**Task Type:** Evaluation (build-and-measure, not a shipping decision)
**Status:** EVALUATED
**Branch:** feature/rs-2013-instanced-stones-step3b-facet-material

## Why this milestone exists

`docs/specifications/RS-2013-InstancedFacetedStoneRenderingDesign.md` §4 step 3's own
`TASK_RESULT.md` (lighting rig extension) reached an honest, evidence-backed negative result: the
extended 4-light rig is a real, measured change (~3.4% RMSE on the mug view) but does not read as
"faceted gem" over "flat painted polygon" any better than the original 2-light rig. A diagnostic
(an out-of-bounds 2.4-intensity test light, reverted before shipping) confirmed this is not a
mis-tuned angle: even a light brighter than the key light could not flip which facet reads bright
vs. dark on a stone. Root cause, as reported: a structural combination of (a) an 8-facet octahedron
where only ~2-4 faces are ever front-facing to the camera, and (b) a diffuse-dominant
`MeshStandardMaterial` response (`roughness=0.42/metalness=0.08`), under which every additional
light source's contribution *adds* to a facet's brightness rather than *redistributing* which facet
catches the highlight.

§3.1 of the design doc had already anticipated this exact fallback ("a later, separate step
evaluating a richer cut ... only if the visual result under-delivers") and named a specific
alternative shape (a 16-triangle "double bipyramid"). §3.4/step 3's own finding named the second
lever (material response), independently. This milestone is that inserted step: it evaluates both
candidates (plus their combination) against the same methodology step 3 already validated, before
step 4 (flag-gated `Preview3DRenderer` integration) commits to carrying anything forward.

## Scope

Build-and-measure evaluation only — **not** a decision to ship either candidate as the new default.
Extends `tools/rs2013-instanced-stone-harness.html` (still not wired into the live
`Preview3DRenderer`/`app.js`/Studio UI) with two new, independently selectable URL params:

- `?facet=octahedron|bipyramid16` — geometry primitive. `octahedron` (unchanged, 8 triangles) is
  still the default. `bipyramid16` is Candidate A: an "octagonal bipyramid" (2 apex vertices + an
  8-vertex equatorial ring = 16 triangular faces), the design doc's own anticipated fallback shape.
- `?material=diffuse|specular` — `MeshStandardMaterial` roughness/metalness preset. `diffuse`
  (unchanged, `roughness=0.42/metalness=0.08`) is still the default. `specular` is Candidate B: a
  more specular-dominant response, tuned via a 3-combination sweep (see `TASK_RESULT.md`) to
  `roughness=0.12/metalness=0.55`.
- Candidate C is both together: `?facet=bipyramid16&material=specular`.
- Raw `?roughness=`/`?metalness=` overrides also exist, for reproducing/extending the tuning sweep
  without editing the file.

`?lighting=default|extended` (step 3's own param) is unchanged and held at `extended` throughout
this step's evaluation and final product-kind renders, per the task brief's explicit instruction to
vary geometry/material only, holding placement and lighting constant.

## Triangle-budget check (§3.1, restated with real numbers)

16 triangles/stone × 15,000 stones (§1.3's theoretical worst case) = **240,000 triangles** — still
trivially within a single `InstancedMesh` draw call's budget on any WebGL2-class GPU, exactly as
§3.1 anticipated. At §1.3's largest *actual* fixture (1,161 stones), that's 18,576 triangles. No
polygon-budget pressure from Candidate A or C.

## Methodology — same as step 3, applied to the new variable

- RMSE (`magick compare -metric RMSE`) between each candidate and the unchanged 8-tri/diffuse
  baseline, both full-frame and on step 3's own macro-crop region (a tight, nearest-neighbor-upscaled
  crop of a handful of stones — no resampling blur).
- A new check this step adds: a grayscale difference-magnitude image (`-compose difference
  -colorspace Gray -auto-level`, not the default red/binary compare mask) on the macro crop, to
  distinguish "this stone's silhouette shifted brightness/tone uniformly" (step 3's finding) from
  "the difference is concentrated at internal facet-boundary lines within each stone" (the thing step
  3 confirmed was absent and this step is specifically testing for).
- Evaluation done on the mug view (matching step 3's own primary tuning view) before deciding whether
  any candidate wins; the winning candidate (if any) is then applied to all 4 product kinds.

## Allowed files

- `tools/rs2013-instanced-stone-harness.html` (extended: `?facet=`/`?material=`/raw override params,
  `buildBipyramid16Geometry()`, `MATERIAL_PRESETS`, updated info text/links; one necessary
  generalization to the plate-placement branch's orientation math, see `TASK_RESULT.md`).
- `tools/rs2013-instanced-stone-harness-screenshot.mjs` (extended: mug evaluation set + winning
  candidate applied to the other 3 products).
- New screenshot/crop/diff assets, same naming convention as prior steps.
- `TASK.md`, `TASK_RESULT.md`.

## Forbidden in this milestone

- Any change to `app.js`, `index.html`, or the live Studio UI.
- Any change to `src/preview3d/Preview3DRenderer.js` or `src/preview3d/ObjectGeometryBuilder.js`.
- Any change to placement/orientation math or lighting rig values from steps 2/3, beyond the one
  documented generalization needed so the plate branch's orientation quaternion works correctly for
  a geometry primitive whose apex axis isn't incidentally aligned with world +Y (see
  `TASK_RESULT.md` — verified to produce a pixel-identical result for the still-default octahedron).
- HDRI/environment-map/`PMREMGenerator` work.
- Silently making either candidate the new default `?lighting=extended`/step-1/2 view.

## Testing

- `node tools/run-tests.mjs --all` — must be 100% pass.
- `node tools/test-documentation-consistency.mjs` before committing.

## Deliverables

- This file.
- `TASK_RESULT.md` — full evidence writeup, verdict per candidate, final recommendation for step 4.
