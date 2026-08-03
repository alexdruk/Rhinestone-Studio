# Rhinestone Studio — Task Result

This document is completed by the implementation engineer after finishing the current task.

---

# Task ID

RS-2013 (Implementation Phase) — §4 step 4: flag-gated integration into the real
`Preview3DRenderer`

---

# Status

IMPLEMENTED. `instancedStones` option added to `Preview3DRenderer.update()`, default `false`
(byte-identical to pre-step-4 behavior, confirmed both by code inspection and a real-browser
screenshot comparison — see below). `true` builds a real `THREE.InstancedMesh` of octahedral
stones, positioned/oriented via the harness's already-validated math, alongside the existing
`bodyMesh`/`handleMesh`/`underMesh`. Not wired into `app.js`/the Studio UI — reachable
programmatically only, per this step's own scope.

---

# Branch

feature/rs-2013-instanced-stones-step4-integration (already checked out at task start, cut from the
step-3b closure commit `14ea561`)

---

# Cleanup accounting (steps 1-3b scratch assets)

Checked `tools/*.png` before starting any work: **zero PNG files present** (`find tools -iname
"*.png"` returned nothing; `du -sh tools` = 3.6M with no image files). The prior commit (`14ea561
RS-2013: remove all step 3/3b screenshot scratch assets`) already deleted every step 1-3b
screenshot; there was nothing left for this step to clean up. `tools/` size is unchanged by this
milestone's own work: **3.6M before and after** (the harness `.html`/`.mjs` files themselves were
not touched, per this step's scope — no changes were needed there).

---

# What was built

## `src/preview3d/Preview3DRenderer.js`

1. **`instancedStones` option on `update()`** (default `false`), documented in the method's own
   JSDoc alongside `plateParams`/`vesselParams`.
2. **Regression-safety guarantee for `false`/omitted**: no line inside `_updateTexture()`,
   `_applyTextureParams()`, or `_applyCrystalMaterialResponse()` was touched — those three methods
   are byte-for-byte identical to the pre-step-4 file. The only additions on the default path are
   two guarded early-returns that do nothing the first time they run and nothing at all thereafter:
   - `_applyLightRig(false)`: `instancedStones(false) === this._lightRigExtended` (initialized
     `false` in the constructor) is `true` on the very first call, so it returns immediately —
     ambient intensity and the light rig are never touched.
   - `_teardownInstancedStones()`: `if (!this._stoneMesh) return;` — `_stoneMesh` starts `null` and
     is only ever set by `_updateInstancedStones()`, which never runs unless `instancedStones` was
     at some point `true`. For a renderer that has never had `instancedStones: true` passed to
     `update()`, this is a pure no-op on every call.
   Confirmed two ways: (a) by inspection — the diff to `_updateTexture()`/`_applyTextureParams()`/
   `_applyCrystalMaterialResponse()` is empty; (b) a real-browser screenshot of the same design (the
   `short-name-block.rhs` "Emma" mug example) rendered through the real `Preview3DRenderer` class
   with `instancedStones` omitted looks pixel-for-pixel like the live Studio's current output (baked
   gradient-disc stones on the texture, not real geometry) — see "Browser verification" below.
3. **`_updateInstancedStones()`**: builds/updates a `THREE.InstancedMesh(OctahedronGeometry(1,0),
   MeshStandardMaterial({roughness:0.42, metalness:0.08}), capacity)`, ported directly from
   `tools/rs2013-instanced-stone-harness.html`'s `runStep2Placement()` — same azimuth
   (`azimuthRadForCanvasXMm()`), height (Y-down→Y-up inversion + `bodyHeightMm` clamp), radius
   (`wallRadiusAt()` for mug/tumbler, constant `bodyRadiusMm` for bottle, cached `_plateTopY` for
   plate), outward-normal alignment (`qAlign.setFromUnitVectors(zAxis, normal)`), and per-instance
   spin (`CrystalAppearance.js`'s `facetAngleDeg`) math, unchanged. Skips assigning the baked
   texture to `bodyMesh.material.map` when active (tints the body to `cupColor` instead), per §3.6.
   `capacity` (the `InstancedMesh`'s fixed buffer size) only triggers a full mesh rebuild when the
   stone count actually changes, not on every `update()` call — `.count` alone is adjusted otherwise.
4. **`_applyLightRig()`**: toggles the harness's step-3 "extended" 4-light rig (ambient lowered to
   0.4, two extra directional lights) on/off, idempotent across repeated same-flag calls (tracked
   via `_lightRigExtended`). Only active while `instancedStones` is `true`.
5. **`findPlateRimPlaneY()`** (module-level function): ported from the harness's `findRimPlaneY()`
   — scans the plate's real built top-surface mesh for the vertex nearest `innerWellRadiusMm` and
   reads its actual world Y, reusing the real built geometry instead of duplicating
   `ObjectGeometryBuilder.js`'s private profile constants a second time. Computed once per
   `_rebuildMesh()` (geometry-key change), cached in `this._plateTopY`, not recomputed on every
   `update()` call (it only depends on the built mesh, not the live `StoneLayout`).
6. **Lifecycle**: `_stoneMesh` is disposed as part of `_disposeGroup()`'s existing traversal
   (geometry-key change → full rebuild, same as `bodyMesh`/`handleMesh`/`underMesh`) and explicitly
   torn down by `_teardownInstancedStones()` when the flag turns off without a geometry change — no
   parallel lifecycle mechanism introduced.

## `src/preview3d/ObjectGeometryBuilder.js`

**Not modified.** `wallRadiusAt()` was already exported (by RS-2013 step 2, for the harness's own
use) — confirmed by reading the file before writing any code; no further export needed.

## No `app.js`/`index.html` changes

Confirmed by `git status`/the allowed-files list — the flag is reachable only by a caller of
`Preview3DRenderer.update()` passing `instancedStones: true` directly (e.g. from a test, a future
milestone's UI wiring, or the browser console via the existing `window.__preview3D` debug handle
`app.js` already exposes).

---

# Browser verification

A temporary, **uncommitted** verification page (`tools/_tmp-rs2013-step4-verify.html` +
a matching Playwright screenshot script) was built to exercise the real `Preview3DRenderer` class
end-to-end in an actual browser — not the harness's own hand-rolled placement math, the real
integrated code this milestone shipped. It imported `Preview3DRenderer` directly, called `init()`
and `update()` with the real `short-name-block.rhs` (mug) and an inline plate project (mirroring
the harness's own `PLATE_PROJECT`), and screenshotted three views:

- `instancedStones` omitted, mug — real Studio texture-baked stones (gradient discs), matching
  today's live output exactly, zero console/page errors.
- `instancedStones: true`, mug — real faceted octahedra correctly wrapped around the curved body,
  following the same "Emma" text placement/curvature the texture path shows, zero console/page
  errors.
- `instancedStones: true`, plate — two rings of faceted stones correctly sitting flat at the
  well/rim transition height (normal straight up), zero console/page errors.

All three screenshots were reviewed and confirmed correct, then **the temporary verification
file, its screenshot script, and all three PNGs were deleted before this commit** — they were a
one-off check of the ported code, not a deliverable, and are not part of git history. No screenshot
file paths are being handed to Sasha for this step: the verification confirmed the ported code
renders correctly, but produced nothing meant to be reviewed as a visual-design decision (that is
step 6's job, once this flag is wired into the UI). If a re-check is wanted, the same page can be
trivially rebuilt (it is ~70 lines, described in full above) or the flag exercised directly via
`window.__preview3D.update(...)` in a running `npm run dev` session.

---

# Known limitations carried forward (not resolved in this step, per scope)

1. **Light-colored stones (`crystal`/`crystal-clear`) show real facet washout.** Confirmed in step
   3b's single-stone close-up pass: the brightest facet can land within a few luminance units of
   (or, for `crystal-clear` on the bottle, become indistinguishable from) this renderer's own
   `0xe9eef5` scene background, at some stone orientations. Severity at realistic (non-close-up)
   camera distance, and whether the extended lighting rig this step ports changes that severity at
   all, was **not tested in this step** — out of scope per the task brief. Does not block this
   step's integration; the flag ships off by default, so no live Studio view is affected. A future
   visual-validation step (§4 step 6, or an inserted step before it) should check this specifically
   before ever flipping the default.
2. **Dark stone colors (`jet`, `sapphire`, `siam`, `emerald`, etc.) were never tested at all**, in
   this step or any prior RS-2013 step — no fixture reachable through the harness's (or this step's
   temporary verification page's) `?product=` mapping contains one. A real coverage gap, not a
   passed check. Also out of scope here; carried forward for whichever future step ships a real
   visual-validation pass.

---

# Scope discipline

- No change to `app.js`, `index.html`, or the live Studio UI.
- No change to `src/preview3d/ObjectGeometryBuilder.js` (already exported what was needed).
- Candidate A (16-triangle bipyramid) and Candidate B (specular material) from step 3b are **not**
  present anywhere in this commit — `_updateInstancedStones()` hardcodes the plain octahedron
  (`THREE.OctahedronGeometry(1, 0)`) and the unmodified diffuse preset
  (`roughness: 0.42, metalness: 0.08`), matching step 3b's final recommendation.
- `StoneLayoutTexture.js` was not opened for editing and is untouched — `_updateTexture()` (which
  calls it) is byte-for-byte the same function it was before this milestone.
- No attempt made to fix the light-color washout or test dark colors (see "Known limitations"
  above).
- The flag is reachable programmatically (any `update()` caller can pass `instancedStones: true`)
  but no end-user-facing control was added anywhere.

---

# Testing

- `node tools/run-tests.mjs --all`: **100/100 passed** (99 pre-existing + this milestone's new
  `test-preview3d-instanced-stones.mjs`, 10 tests).
- `node tools/test-documentation-consistency.mjs`: passed.
- Real-browser verification: see "Browser verification" above — zero console/page errors across all
  three views checked.

## `tools/test-preview3d-instanced-stones.mjs` (new, 10 tests)

Uses real `'three'` + real `ObjectGeometryBuilder.js` (both pure computation, no WebGL context
needed — same convention `tools/test-object-geometry-builder.mjs` already uses), with
`Preview3DRenderer` "mounted" the way `init()` would leave it but without any of `init()`'s real
browser/DOM dependencies (`WebGLRenderer`/`OrbitControls`/`ResizeObserver` all bypassed, mirroring
`tools/test-preview3d-render-scheduling.mjs`'s existing "mounted without a real `init()`"
convention). Covers:

1. `instancedStones` omitted takes the exact texture path (real `CanvasTexture` assigned, no stone
   mesh created).
2. `instancedStones: false` is identical to omitting it.
3. `false`/omitted never touches the lighting rig (ambient stays 0.75, no extra lights).
4. `instancedStones: true` builds a real `THREE.InstancedMesh` with one instance per stone, added
   alongside `bodyMesh`/`handleMesh`.
5. `true` skips the baked texture entirely (`material.map` stays `null`, body tinted to `cupColor`,
   `_updateTexture()` never runs — no texture canvas lazily created).
6. `true` lowers ambient to 0.4 and adds exactly the two extended-rig directional lights, not
   re-added on a second `update()` call.
7. A real mug stone's instance matrix decomposes to the exact expected position (azimuth × radius ×
   height, independently recomputed in the test from `azimuthRadForCanvasXMm()`/`wallRadiusAt()`)
   and the correct outward-normal-aligned orientation, plus the correct instance color.
8. A real plate stone sits at the cached `_plateTopY` rim/well transition height with a straight-up
   (+Y) normal and no per-stone spin.
9. Toggling `instancedStones` back to `false` tears the instanced mesh down, restores the default
   ambient intensity, removes the extra lights, and resumes the texture path.
10. A stone-count change with no geometry-key change (an edit adding/removing stones) rebuilds the
    `InstancedMesh` at the new count rather than leaving stale instances or leaking a second mesh.

---

# Deliverables

- `src/preview3d/Preview3DRenderer.js` (the integration).
- `tools/test-preview3d-instanced-stones.mjs` (new).
- `TASK.md` (this milestone's), `TASK_RESULT.md` (this file).

---

# How to exercise/verify the flag

- **Test suite**: `node tools/run-tests.mjs test-preview3d-instanced-stones` (or `--all` for the
  full suite).
- **Manual/browser**: with `npm run dev` running and the Studio open, the browser console already
  has a debug handle (`window.__preview3D`, set by `app.js`, "never used to drive any application
  logic" per its own comment) — call
  `window.__preview3D.update(<a real StoneLayout>, { ...<the same options drawCup() passes>,
  instancedStones: true })` to see real faceted geometry in place of the baked texture on the live
  object. No UI control exists for this yet (by design, per this step's scope).
