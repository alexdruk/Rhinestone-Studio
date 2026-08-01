# Rhinestone Studio — Task Result

This document is completed by the implementation engineer after finishing the current task.

---

# Task ID

RS-2013 (Implementation Phase) — §4 step 3 (lighting)

---

# Status

IMPLEMENTED — rig extension built, tested, and committed locally. **Visual outcome is a qualified
"needs more work," not a clean success** — see "Honest visual assessment" below. Per the task's own
instruction, this is reported directly rather than described as a success it wasn't.

---

# Branch

feature/rs-2013-instanced-stones-step3-lighting (cut from the step-2 commit, `2413405`)

---

# Summary

Extended `tools/rs2013-instanced-stone-harness.html`'s lighting rig per
`docs/specifications/RS-2013-InstancedFacetedStoneRenderingDesign.md` §3.4/§4 step 3. A new
`?lighting=default|extended` URL param selects between the unmodified original rig (byte-identical
to `Preview3DRenderer.js`'s own `init()`, confirmed against the live source before touching
anything — no drift found, unlike steps 0/2's discrepancies) and a new rig with two additional
directional lights and a lower ambient floor, applied to the step-2 harness's real placed/oriented
stones (plate/mug/tumbler/bottle).

**Pre-flight confirmation (per the task's required first check):** `Preview3DRenderer.js:92-102` —
`AmbientLight(0xffffff, 0.75)`, key `DirectionalLight(0xffffff, 1.6)` at `(60,120,90)`, fill
`DirectionalLight(0xffffff, 0.5)` at `(-70,40,-60)` — matches §3.4's description exactly, and
matches what the harness itself already had (added unchanged in step 1). No premise to flag this
time.

---

## How to view the results yourself

```bash
npm run dev
```
then open, in a browser:
- `http://localhost:5173/tools/rs2013-instanced-stone-harness.html?product=mug` — default rig
- `http://localhost:5173/tools/rs2013-instanced-stone-harness.html?product=mug&lighting=extended` —
  extended rig
- swap `mug` for `plate`/`tumbler`/`bottle`; each page has a "Switch to default/extended lighting"
  link that toggles it live.

Both panels (left = texture reference, right = new instanced placement) always share one
`THREE.Scene`, so both render under whichever rig the URL selects — lights are a scene-global
resource in three.js, there is no stock per-object light-list override on `MeshStandardMaterial`.

Captured screenshots (regenerate any time with
`node tools/rs2013-instanced-stone-harness-screenshot.mjs`):
- `tools/rs2013-instanced-stone-harness-{plate,mug,tumbler,bottle}.png` — **unchanged**, default rig
  (identical content to the step-2 commit; regenerated only to confirm byte-for-byte visual parity).
- `tools/rs2013-instanced-stone-harness-{plate,mug,tumbler,bottle}-lighting.png` — **new**, extended
  rig, same `StoneLayout`/camera/product as its non-`-lighting` counterpart, for direct before/after
  comparison.
- `tools/rs2013-instanced-stone-harness-grid.png` — unchanged step-1 regression (no lighting
  variant produced for this view, per scope).

---

## The extended rig, and why these specific numbers

```js
default:  ambient 0.75  | key   1.6 @ (60,120,90)  | fill 0.5 @ (-70,40,-60)
extended: ambient 0.4   | key   1.6 @ (60,120,90)  | fill 0.5 @ (-70,40,-60)
                         | new   1.1 @ (-108,51,91)  (front-left, low elevation)
                         | new   0.7 @ (25,-39,142)  (front, from underneath)
```

**Reasoning, worked from the camera geometry, not guessed:** the harness's `frameCamera()` puts the
camera at roughly `(0, +Y, +Z)` relative to its target (elevation ≈28°), so the front-facing,
camera-visible facets of any stone are dominated by directions with a positive Z component. Checking
the *azimuth* (angle in the XZ plane) of the two original lights: key ≈ 34°, fill ≈ -131° (i.e. fill
is behind the object from the camera's viewpoint, acting as a soft rim/side fill around the far
edge, not a true second front light). So every camera-facing stone on an actual design was
effectively lit by **one** front-hemisphere directional source plus ambient — not two. The two new
lights are placed at genuinely different front-hemisphere azimuth/elevation combinations (front-left
low, and front-from-below) specifically so front-facing stones get a second and third independent
highlight source, per §3.4's "cover more facet angles" instruction. Ambient was lowered from 0.75 to
0.4 because a high ambient floor was flattening exactly the per-facet contrast the extra lights were
meant to create.

This was tuned empirically, not decided on paper — two earlier candidate rigs were built, rendered,
diffed (`magick compare -metric RMSE`), and rejected before this one:
1. Two moderate lights (0.55/0.45) at less-considered angles: ~1.7% RMSE on the mug view, visually
   indistinguishable at the crop level from the original.
2. One much brighter (1.0) grazing side light placed 90° off the key light's azimuth: ~2.2% RMSE,
   but that azimuth pointed at the side of the vessel body, not the front face carrying the design —
   negligible effect where it actually mattered.

---

## Honest visual assessment

**This is the part the task explicitly asks not to inflate, so: the extended rig is a real, measured
change, but it does not clearly deliver "faceted gem" over "flat painted polygon" beyond what the
original 2-light rig already achieves at this primitive/material/camera combination.**

Evidence, not just impression:
- RMSE between default and extended renders is ~3.4% on the mug view (confirms the rig change is
  real, not a no-op).
- A pixel-diff of a tight macro crop (a handful of individual stones, nearest-neighbor upscaled so
  no resampling blur) shows the diff is **spread fairly uniformly across each stone's silhouette**,
  not concentrated at new facet-edge boundaries — i.e. the change reads as "these stones got
  somewhat brighter/warmer overall," not "this facet is now lit differently from its neighbor."
- **Diagnostic check (not shipped):** temporarily set the new front-secondary light's intensity to
  2.4 — higher than the key light's own 1.6 — specifically to test whether a strong enough
  additional light could ever flip which facet reads bright vs. dark on these stones. It did not:
  the same facet stayed the highlighted one, just uniformly brighter overall. This is a meaningful
  negative result — it means the ceiling here is not "this milestone chose the wrong angle/
  intensity," it's a structural property of the combination of (a) an 8-facet octahedron, of which
  only ~2-4 faces are ever front-facing to the camera at once, (b) `MeshStandardMaterial` at
  `roughness=0.42/metalness=0.08` (the existing, unchanged `_applyCrystalMaterialResponse()` nudge —
  a fairly diffuse-dominant, not specular-dominant, response), and (c) Lambertian diffuse shading,
  where every additional light source's contribution *adds* to a facet's brightness rather than
  *replacing* or *competing with* the dominant light's contribution — so more lights raise the floor
  rather than redistribute which facet catches the highlight.

**What this suggests, without doing it here (out of scope for this step):** a visually stronger
"faceted gem" read most likely needs either richer facet geometry (more visible facet boundaries per
stone — §3.1 already anticipated "a later, separate step evaluating a richer cut … only if the
visual result under-delivers," which this result now motivates) or a more specular-dominant material
response (lower roughness / higher metalness, so highlights become sharp and position-dependent
rather than smoothly-added diffuse light) — not more/relocated lights within the current material.
Neither is implemented here; both are flagged as candidates for whoever scopes the next step,
consistent with §3.7's "build it and look before committing further" posture and with not
reaching for the HDRI path this step explicitly defers.

**What did not regress:** placement/orientation (step 2) is unaffected — both `-lighting` screenshots
and their non-`-lighting` counterparts show the same stone positions, same right-side-up orientation,
same relative design layout; only the shading response changed. No console/page errors on any of the
8 product×lighting combinations.

---

## Scope discipline

- No change to `app.js`, `index.html`, or Studio UI.
- No change to `src/preview3d/Preview3DRenderer.js` — the live rig is untouched; this milestone's
  rig extension exists only in the harness, exactly as scoped.
- No HDRI/environment-map/`PMREMGenerator` work of any kind — stayed within `MeshStandardMaterial` +
  ambient/directional lights, per §3.4's explicit deferral.
- No change to placement/orientation math (`StoneLayoutTexture.js`, position/normal/quaternion logic
  from step 2) — verified by diffing screenshots: stone positions are identical between the
  `-lighting` and non-`-lighting` renders of the same product.

---

## Testing

- `node tools/run-tests.mjs --all`: **98/98 passed**.
- `node tools/test-documentation-consistency.mjs`: **passed**.
- All 8 product×lighting harness combinations (`plate`/`mug`/`tumbler`/`bottle` × `default`/
  `extended`) load with zero console/page errors, verified via the screenshot script's existing
  error-capturing logic (unchanged from step 2, just run against more views).
- Screenshot asset sizes: 104K-252K across all 9 PNGs (`du -sh`), consistent with steps 1/2's
  existing asset sizes (99K-233K) — nothing unexpectedly large.

---

## Deliverables

- `tools/rs2013-instanced-stone-harness.html` — `?lighting=default|extended` param, `LIGHT_RIGS`
  table, `applyLightRig()`, updated info text with a live toggle link.
- `tools/rs2013-instanced-stone-harness-screenshot.mjs` — 4 new `-lighting` views alongside the
  existing 5.
- `tools/rs2013-instanced-stone-harness-{plate,mug,tumbler,bottle}-lighting.png` — new before/after
  comparison screenshots.
- `TASK.md` (this milestone's), `TASK_RESULT.md` (this file).
