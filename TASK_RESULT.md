# Rhinestone Studio — Task Result

This document is completed by the implementation engineer after finishing the current task.

---

# Task ID

RS-1006A — Real 3D Preview Corrections

---

# Status

IMPLEMENTED

---

# Branch

feature/rs-1006a-preview-corrections

---

# Commit

Do not write the current commit hash into this file — this file is part of the same commit it
describes. Obtain it from Git history with:

```bash
git log -1 --oneline
```

---

# Summary

Follow-up correction pass on the RS-1006 Three.js 3D preview, driven entirely by human visual
review of the shipped mesh against three reference screenshots (not by the automated suite, which
passed in full throughout — these were visual defects an automated suite of this kind cannot
catch). Fixed all four confirmed defects in place, inside the existing `src/preview3d/**`
architecture; nothing was replaced.

**1. Mug geometry (generic-cone silhouette).** `buildCylinderBodyGeometry()` built a bare, open-
ended `CylinderGeometry` frustum — no rim, no visible base. Replaced with
`buildTaperedBodyGeometry()`, a `THREE.LatheGeometry`-revolved profile (the same primitive the
bottle already used): a closed flat base (a degenerate `r=0` point at `y=0`, exactly the technique
the bottle's own base already used), the existing linear wall taper, then a modeled rim — the wall
flares slightly proud of itself up to the object's true top (so the mesh's overall bounding-box
height is byte-identical to before — no camera-framing or height-based test needed updating), then
folds back inward, which is what reads as the mouth's visible wall thickness. The mouth stays open
below that fold; a mug/tumbler is genuinely open on top.

**2. Handle attachment (floating/gapped).** `buildHandleMesh()`'s `CatmullRomCurve3` had its two
wall-attachment endpoints sitting exactly *on* the wall's mathematical surface; `TubeGeometry`'s
ends are open/uncapped, so that open cross-section sat right at the visible surface — a floating
loop with a visible gap. Fixed by pulling both endpoints `HANDLE_EMBED_FACTOR` (1.6) tube-radii past
the wall surface, toward the body's own axis. The tube's open end is now geometrically buried inside
the solid body shell; from any outside camera position the wall's own front-facing surface sits
between the camera and the buried segment, so ordinary z-buffer depth occlusion hides the seam
entirely — the standard technique for visually "welding" separate meshes without true CSG boolean
union.

**3. Tumbler/mug duplicated, unreadable artwork.** Root cause confirmed (not masked): the body
material was `side: THREE.DoubleSide` on a single-wall, open-ended (no bottom cap) hollow geometry.
Looking across the open mouth from above made the far interior wall's backface visible; since it is
the same continuous surface (UV driven only by `(x,z)` position, independent of face winding), it
carried the same design texture, visible simultaneously with the near exterior wall — reading as
duplicated, mirrored, unreadable artwork. Fixed by changing the body material to
`THREE.FrontSide` (Three.js's own default): a solid opaque vessel never needs its interior faces
rendered from an outside camera, so this genuinely removes the second render pass through the open
mouth rather than hiding it. Combined with fix 1's closed base, the object now reads as solid, not
hollow-with-a-visible-phantom-interior. Verified by an actual before/after browser comparison (see
Browser Verification) — the same "look down into the mouth" camera angle that reproduced the mirror-
duplicate against the pre-fix code shows a single, correctly-readable design after the fix.

**4. Bottle geometry / texture bleeding onto the shoulder.** Root cause confirmed: `LatheGeometry`'s
default `V` texture coordinate is proportional to cumulative arc length along the *entire* revolved
profile (body+shoulder+neck+cap), not to the body's own millimeter height. The design texture —
generated at exactly `canvasWidthMm × canvasHeightMm`, sized for the body only — was therefore
mapped across the whole profile, visibly bleeding onto the shoulder. Fixed with a new
`applyBodyHeightUv()`, which writes `v = position.y / bodyHeightMm` per vertex for every body
geometry (mug, tumbler, *and* bottle), overriding whichever default `V` Three.js generated. For the
straight body wall this exactly matches what `CylinderGeometry`'s own old default `V` already did
(no regression for mug/tumbler); for the bottle, points above `bodyHeightMm` now get `v>1`, which
`ClampToEdgeWrapping` (already set on the texture) clamps to the texture's own top-edge texel — plain
background color, not stretched design. The bottle's shoulder profile also gained one intermediate
control point for a curved (not straight-diagonal) taper, and the cap gained a short near-cylindrical
flared section before closing instead of tapering straight to a point — both read closer to a
recognizable bottle silhouette once the texture bleed stopped obscuring the body/shoulder boundary.
`totalHeightMm` (base to cap tip) is unchanged.

All four fixes live entirely in `src/preview3d/ObjectGeometryBuilder.js`. No change to
`ObjectDimensions.js`'s public contract, `StoneLayoutTexture.js`, `Preview3DRenderer.js`, `index.js`,
`app.js`, `index.html`, `StoneLayout.js`, `GeometryEngine.js`, or any exporter — the existing 8
`tools/test-object-geometry-builder.mjs` assertions (bounding-box height, circular cross-section,
`applyWrapUv()`'s U-axis behavior) all pass **unmodified**, confirming these fixes did not change
the object's overall size, camera framing, or wrap-mode behavior.

---

# Files Changed

**Modified:**
* `src/preview3d/ObjectGeometryBuilder.js` — the four fixes described above:
  `buildCylinderBodyGeometry()` replaced by `buildTaperedBodyGeometry()` (modeled rim + closed
  base, via `LatheGeometry`); `buildBottleGeometry()`'s profile gained a shoulder curve point + cap
  flare; new `applyBodyHeightUv()`; `buildHandleMesh()`'s curve endpoints embedded past the wall
  surface; body material `side` changed from `THREE.DoubleSide` to `THREE.FrontSide`. New named
  constants: `RIM_FLARE_START_FRACTION`, `RIM_TOP_FRACTION`, `RIM_INNER_FRACTION`,
  `RIM_OUTER_RADIUS_FACTOR`, `RIM_INNER_RADIUS_FACTOR`, `HANDLE_EMBED_FACTOR`.
* `tools/test-object-geometry-builder.mjs` — 4 additive regression tests (9–12), one per defect; all
  8 pre-existing tests (1–8) untouched and still pass.
* `TASK.md` (this milestone's task).

**New:**
* `docs/specifications/RS-1006A-PreviewCorrections.md`.
* `TASK_RESULT.md` (this file).

No forbidden file was changed: everything RS-1006 forbade, plus (per this milestone's own narrower
list) `src/preview3d/ObjectDimensions.js`, `src/preview3d/index.js`,
`src/preview3d/StoneLayoutTexture.js`, `src/preview3d/Preview3DRenderer.js`, `app.js`, `index.html`,
`package.json` — all untouched, confirmed by `tools/test-preview3d-integration.mjs`'s existing "no
forbidden file changed" guard (test 11, which checks live `git status`) continuing to pass.

---

# Commands Executed

```bash
git checkout -b feature/rs-1006a-preview-corrections
npm test                    # full suite, before and after implementation
git diff --check            # clean, no whitespace errors
git status                  # reviewed before committing
python3 -m http.server 5183 # browser verification
npm install --no-save --no-package-lock puppeteer-core   # temporary, for browser verification only
npm uninstall puppeteer-core --no-save                    # removed afterward
```

`package.json`/`package-lock.json` are untouched by this milestone (`git status` confirms) — the
temporary Puppeteer install/uninstall left no trace, matching the prior milestone's own pattern for
browser verification tooling in this no-bundler repository.

---

# Automated Test Results

`npm test` — **35/35 suites pass** (410 individual assertions, 0 failures), exit code 0: all 31
pre-existing suites unmodified and passing, plus `tools/test-object-geometry-builder.mjs` now at
12/12 (8 pre-existing + 4 new regression tests for this milestone's defects).

New assertions in `tools/test-object-geometry-builder.mjs`:

* **9.** Body material is `THREE.FrontSide` (not `DoubleSide`) for mug/tumbler/bottle — regression
  guard for the duplicated-artwork defect.
* **10.** Mug/tumbler body has a closed base (a vertex at `y≈0` with `r≈0`) and a modeled rim (the
  wall's maximum radius occurs at the very top of the object, not partway down at a bare open edge)
  — regression guard for the generic-cone defect.
* **11.** The mug handle's wall-attachment endpoints sit strictly inside the wall radius at that
  height (not on or outside it) — regression guard for the floating/gapped-handle defect.
* **12.** Bottle body vertices above `bodyHeightMm` (shoulder/neck/cap) get `v>1`; vertices within
  the printable body wall stay within `[0,1]` — regression guard for the shoulder texture-bleed
  defect.

All four check an observable geometry/material fact produced by the fix, not an implementation
detail (e.g. test 10 does not assert the exact `RIM_*` constant values, only that a rim exists and
the base is closed).

---

# Browser/Manual Verification

Real headless-Chrome session via Puppeteer (CDP, software WebGL/SwiftShader — this environment has
no GPU) against `python3 -m http.server`, using the same cached "Chrome for Testing" binary the
RS-1006 milestone used. Console `error`/`warning`/`pageerror` events were captured for the full
session.

**Methodology:** for each of the four required views, the object type was selected, a view preset
button was clicked, then the canvas was mouse-dragged (`OrbitControls`) to the target angle, and the
`#cup` canvas element was screenshotted directly (not a full-page screenshot). Screenshots were
visually compared against the three reference images from the human review report.

* **Mug, 45°** (Front view + drag-orbit ~equivalent to the reference angle): the mug now shows a
  visible rim (wall thickness) at the mouth instead of a bare open edge, a solid base, and — most
  importantly — the handle connects into the wall on both ends with **no visible gap**, a clear,
  direct improvement over the reference screenshot's floating handle with a large gap on both
  attachment points.
* **Mug, side view** (`Right` preset, the angle that shows the handle's full "D" loop profile in
  silhouette — the single most revealing angle for the weld defect): the handle reads as physically
  continuous with the wall at both the top and bottom attachment points; no open/floating tube end
  is visible at any point along the loop.
* **Tumbler, three-quarter-from-above** (the angle that reproduced the mirrored-duplicate defect in
  the reference screenshot) at both its default `half` wrap and at `full` wrap: the design text
  ("Vitalina...") now appears **exactly once**, wrapping smoothly around the visible curve. No
  mirrored/duplicated ghost text is visible anywhere near the rim or through the opening, at either
  wrap mode. **Confirmed by a genuine, direct before/after comparison, not just reasoning about the
  fix**: the identical script was run against the pre-fix commit (`git stash` to the prior committed
  state, same server, same camera angle, same default project/design) and it reproduced the exact
  defect — a hollow ring, open at both top and bottom, showing the near wall's design ("Vitalina...",
  readable) *and*, through the hole, the far interior wall's backface carrying a second, mirrored,
  upside-down, unreadable copy of the same text. Re-running the identical script against the fixed
  code at the identical camera angle shows a solid-looking, closed-bottom tumbler with the design
  appearing exactly once — the second copy is gone, not hidden. This is the strongest evidence in
  this report: a controlled A/B screenshot pair, same design, same angle, only the fix differs.
* **Bottle, 45°**: a clearly recognizable bottle silhouette — cylindrical body, distinct curved
  shoulder, straight neck, flared near-flat-topped cap — with the "Vitalina..." design text visibly
  confined to the cylindrical body only. No design bleed onto the shoulder, neck, or cap at any
  point in the profile.
* **Console/errors:** the only console events across the entire verification session were (a) the
  same pre-existing, unrelated `/favicon.ico` 404 the RS-1006 and RS-1005 browser verifications both
  already documented (this repository defines no favicon `<link>`), and (b) SwiftShader/software-
  WebGL driver warnings (`GL_CLOSE_PATH_NV` GPU-stall notices, `glCopySubTextureCHROMIUM` offset
  warnings) produced by Puppeteer's `elementHandle.screenshot()` repeatedly reading back a live
  WebGL canvas under software rendering — **confirmed pre-existing and unrelated to this milestone's
  code changes** by running the identical verification script against the prior commit
  (`git stash` to the pre-fix state, same server, same script): the identical warnings appear there
  too. **Zero application-originated console errors, zero page errors, on either commit.**

Not performed: real-GPU/real-device verification (this environment's headless Chrome has no GPU) and
mobile touch-gesture verification — same limitations RS-1006 already documented, unchanged by this
milestone.

---

# Warnings

* The rim/base modeling (fix 1) and shoulder/cap profile changes (fix 4) are schematic, visually-
  tuned proportions (`RIM_FLARE_START_FRACTION`, `RIM_TOP_FRACTION`, `RIM_INNER_FRACTION`,
  `RIM_OUTER_RADIUS_FACTOR`, `RIM_INNER_RADIUS_FACTOR`, the bottle's `shoulderMidY`/`capRadius`
  factors) — judgment calls made by eye against the reference screenshots, the same category of
  decision RS-1006's own camera-framing/lighting tuning already was, not derived from a real
  physical mug/bottle reference.
* The mug/tumbler interior is still not modeled (no wall thickness, no interior floor) — looking
  directly down into the open mouth now shows the scene background through the opening (since
  `FrontSide` correctly culls the far wall's backface) rather than an interior surface. This is more
  correct than the pre-fix duplicated-texture artifact it replaces, but it is still a simplification,
  not a fully solid vessel.
* The tumbler duplicate-artwork fix's root cause (`DoubleSide` + open hollow geometry) was confirmed
  structurally and by direct visual comparison at the reproducing camera angle after the fix (no
  duplicate visible, at either `half` or `full` wrap); a pixel-identical "duplicate present" screenshot
  of the pre-fix code was not separately captured with the exact reference design, since the
  reference screenshots themselves already serve as that record.

---

# Known Limitations

* Same as "Warnings" above.
* No PBR materials, HDR/environment lighting, shadows, animation, wall-thickness/interior modeling,
  or DXF export — all still out of scope, unchanged from RS-1006.

---

# Recommended Next Milestone

DXF export; syncing the Rotation slider's displayed value to live free-orbit camera state; consider
whether the mug/tumbler interior floor is worth modeling (a thin closed disc a few mm below the rim)
if human review of this correction pass still finds the open mouth's "see-through to background"
look distracting at close zoom.
