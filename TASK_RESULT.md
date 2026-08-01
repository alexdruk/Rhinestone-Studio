# Rhinestone Studio — Task Result

This document is completed by the implementation engineer after finishing the current task.

---

# Task ID

RS-2013 (Implementation Phase) — §4 step 2 (correct placement/orientation on real object surfaces)

---

# Status

IMPLEMENTED — all three sub-steps (2a plate, 2b mug/tumbler, 2c bottle) complete, visually
verified, tested, and committed locally.

---

# Branch

feature/rs-2013-instanced-stones-step2-placement (cut from the step-0/1 commit, `db1c44c`)

---

# Summary

Implemented exactly `docs/specifications/RS-2013-InstancedFacetedStoneRenderingDesign.md`'s §4
step 2 — nothing from step 3 (lighting) or step 4 (flag/`Preview3DRenderer` wiring). Extended
`tools/rs2013-instanced-stone-harness.html` (previously a static flat-grid harness, step 0/1) so a
`?product=plate|mug|tumbler|bottle` query param now loads a **real** `StoneLayout` (via the same
`generateProjectStoneLayout()`/`GeometryEngine` entry point the app's own Gallery feature uses) and
places each stone on a real object surface using §3.3's placement/orientation mapping. The original
no-param flat-grid mode is unchanged and still works (regression-checked below).

**Two things were found and resolved before/during implementation, both documented in `TASK.md`:**

1. **Design-doc discrepancy (plate flatness), raised before implementing 2a.** §3.3 describes the
   plate's printable face as flat with a single-constant `plateTopY`. Auditing
   `ObjectGeometryBuilder.js`'s `buildPlateProfilePoints()` found the real plate mesh has ~12-15mm
   of genuine vertical relief (a concave well + sloped rim) — only the UV mapping is flat, not the
   geometry. Raised via `AskUserQuestion`; approved resolution: `plateTopY` = the well/rim
   transition height, derived by scanning the real built mesh for the vertex nearest
   `r=innerWellRadiusMm` and reading its actual Y (not a duplicated private constant).
2. **A real bug, found via visual verification of 2b (not a doc issue) — a Y-axis inversion.**
   `stone.yMm` is Y-down (production-canvas convention), but Three.js world Y is Y-up. The existing
   texture path gets this corrected for free by `THREE.CanvasTexture`'s default `flipY=true`; a
   direct position computation has no such automatic correction. The first mug render showed
   "Emma" upside down (verified by a scatter-plot comparison of original-canvas vs. computed-world
   coordinates, not just eyeballing — see "Sign convention" below for the full method). Fixed by
   computing `y = dimensions.bodyHeightMm - clamp(stone.yMm, 0, bodyHeightMm)` instead of using
   `stone.yMm` directly. This is implementation detail, not a design-doc conflict — the doc's "same
   ratio as `applyBodyHeightUv()`" guidance is correct in spirit; the inversion is what's needed to
   go from that ratio to a *position* without a texture's automatic `flipY` doing it implicitly.

---

## How to view the results yourself

```bash
npm run dev
```
then open, in a browser:
- `http://localhost:5173/tools/rs2013-instanced-stone-harness.html?product=plate` (2a)
- `http://localhost:5173/tools/rs2013-instanced-stone-harness.html?product=mug` (2b)
- `http://localhost:5173/tools/rs2013-instanced-stone-harness.html?product=tumbler` (2b)
- `http://localhost:5173/tools/rs2013-instanced-stone-harness.html?product=bottle` (2c)
- `http://localhost:5173/tools/rs2013-instanced-stone-harness.html` (no param — original step-1
  static grid, unchanged)

Each `?product=` page shows the same real `StoneLayout` rendered two ways side by side: **left**
is the existing, unmodified `StoneLayoutTexture.js` texture path (byte-identical logic to
`Preview3DRenderer._updateTexture()`, including the RS-2013-step-0 wrap-mode fix); **right** is the
new instanced-stone placement math on an undecorated body. Drag to orbit either view.

Captured screenshots (regenerate any time with
`node tools/rs2013-instanced-stone-harness-screenshot.mjs`):
- `tools/rs2013-instanced-stone-harness-grid.png` — step-1 regression (unchanged content, same
  data as before this milestone).
- `tools/rs2013-instanced-stone-harness-plate.png` — 2a.
- `tools/rs2013-instanced-stone-harness-mug.png` — 2b.
- `tools/rs2013-instanced-stone-harness-tumbler.png` — 2b (second vessel kind, confirms the mapping
  isn't mug-specific).
- `tools/rs2013-instanced-stone-harness-bottle.png` — 2c.

---

## 2a — Plate

**What was verified:** the reference (texture) and instanced renders show the same two-ring design
(gold outer ring, crystal-clear inner ring) at the same relative position, radius, and proportions
on the plate's top surface, both right-side-up and centered — using an inline `.rhs`-shaped project
object (two outline-mode concentric circles; see "No plate example project exists" below for why
it's inline rather than a file under `examples/`).

**Comparison method:** side-by-side render of the same `layout` object, both derived from the same
`buildObjectMesh()` call — left drawn via the real, unmodified `drawStoneLayoutTexture()`
(`StoneLayoutTexture.js`), right via the new per-stone placement math on an undecorated body.
Screenshot: `tools/rs2013-instanced-stone-harness-plate.png`.

**Sign-convention/placement finding:** `plateTopY` uses the approved resolution from the
"Discrepancy" section of `TASK.md` — the well/rim transition height, read directly off the real
built mesh (`findRimPlaneY()` in the harness) rather than a duplicated private constant. Visual
result matches closely for this design (both rings sit inside the well, close to that boundary);
the known, documented limitation is that a design with content much closer to the outer rim than
to the well would show a larger vertical offset under this single-flat-height approximation — an
accepted limitation of the "flat plane, zero curved-surface complexity" approximation §3.3 asks
for at this step, not something this milestone silently smoothed over.

---

## 2b — Mug / tumbler

**What was verified:** for both a mug (`short-name-block.rhs`, text "Emma") and a tumbler
(`tumbler-wrap-design.rhs`, script text "Wanderlust" + an outline circle), the reference and
instanced renders show the same design, right-side-up, same side of the object, same relative size
and position on the wall.

**Comparison method:** same side-by-side method as 2a. Screenshots:
`tools/rs2013-instanced-stone-harness-mug.png`, `tools/rs2013-instanced-stone-harness-tumbler.png`.

**A real bug was caught by this verification, not just a doc issue:** the first render showed
"Emma" upside down on the instanced side only. Rather than guess-and-check constants, this was
root-caused with two numeric checks run directly against the real modules (not just visual
inspection):
1. Compared my computed `(x,z)` for real stones directly against the actual built
   `bodyMesh.geometry`'s own vertex positions at the matching UV column — these matched closely
   (e.g. leftmost-`xMm` stone: computed `(-20.67, 26.27)` vs. real mesh vertex `(-20.35, 26.52)` at
   the same `u`), confirming the azimuth/radius/sin/cos math itself was correct.
2. Rendered a scatter plot of the original 2D `(stone.xMm, stone.yMm)` layout next to a scatter
   plot of my computed 3D `(worldX, worldY)` (ignoring `z`, i.e. an orthographic front view) — this
   showed the two were **vertically flipped** relative to each other (the text baseline was at the
   bottom in one and the top in the other), not horizontally mirrored as it first appeared at a
   glance in the small screenshot.

Root cause: `stone.yMm` is Y-down (the same convention `CanvasRenderer2D.js` uses), but world Y in
Three.js is Y-up. The texture path is correct "for free" because `THREE.CanvasTexture`'s default
`flipY=true` silently re-inverts V when sampling the source `<canvas>`; a direct position
computation (no texture, no `flipY`) has to bake that same inversion in manually. Fixed by using
`y = dimensions.bodyHeightMm - clamp(stone.yMm, 0, bodyHeightMm)` instead of `stone.yMm` directly.
Re-verified visually after the fix — both mugs/tumblers now match. This exact Y-convention pitfall
is also recorded in project memory from `FONT-GEN-005` (a prior, unrelated milestone that hit the
same "`StoneLayout.yMm` is Y-down" gotcha in a Python rendering script) — this is a second, now
confirmed, live instance of the same class of bug.

**Sign-convention finding (per the task's explicit ask):** verified `x = radius*sin(azimuth),
z = radius*cos(azimuth)` directly against `THREE.LatheGeometry`'s own source
(`node_modules/three/src/geometries/LatheGeometry.js`): for column `i`,
`phi = phiStart + i*inverseSegments*phiLength`, `vertex.x = points[j].x*sin(phi)`,
`vertex.z = points[j].x*cos(phi)` — and `applyAzimuthUv()`'s own `azimuth` variable is computed
with the exact same formula (`-PI + (column/LATHE_SEGMENTS)*2*PI`) for the exact same column. So
`azimuthRadForCanvasXMm()`'s output, fed through `x=r*sin(azimuth), z=r*cos(azimuth)`, is
guaranteed to reproduce the same `(x,z)` LatheGeometry itself assigned to that vertex — confirmed
empirically above, not just by reading source. **The doc's stated sign convention is correct as
written; no change was needed there.**

**Orientation approximation:** used the pure radial-normal approximation (§3.3's recommended first
try) — no visible defect observed at the harness's viewing distance for either vessel; the exact
tangent-based normal was not built (per the task's explicit instruction not to unless the
approximation demonstrably fails).

---

## 2c — Bottle

**What was verified:** using `bottle-front-design.rhs` (a rectangle outline border + two text
layers, "Serrano Vineyards" and "Est. 2010"), the reference and instanced renders show the same
design at the same position/size on the bottle's cylindrical body, right-side-up.

**Comparison method:** same side-by-side method as 2a/2b. Screenshot:
`tools/rs2013-instanced-stone-harness-bottle.png`.

**Radius:** `dimensions.bodyRadiusMm` (constant), confirmed by `ObjectGeometryBuilder.js`'s own
`buildBottleGeometry()` profile — the body wall points are `(bodyRadiusMm, 0)` and
`(bodyRadiusMm, bodyHeightMm)`, both the same radius, with taper only starting above the shoulder
(outside the printable/texture-mapped region) — no `wallRadiusAt()` interpolation needed or used
for this kind, per the design doc.

The same Y-axis fix found during 2b applies here too (shared code path for mug/tumbler/bottle);
re-verified visually after the fix.

---

# No plate example project exists in `examples/`

Audited every `examples/*.rhs` fixture's `product` field — all are `mug`/`tumbler`/`bottle`, none
is `plate`. Per this milestone's own brief ("construct one via the same `GeometryEngine` entry
point the live app uses"), 2a's plate design is a small inline `.rhs`-shaped object defined
directly in the harness's JS (two outline-mode concentric circles, styled like the existing
example fixtures) rather than a new file under `examples/` (outside this milestone's allowed-files
list). It goes through the identical `validateRhsProject()`/`generateProjectStoneLayout()` path
every real example fixture uses — nothing about the generation pipeline is special-cased for it.

---

# Files changed

- `src/preview3d/ObjectGeometryBuilder.js` — exported `wallRadiusAt()` (previously module-private).
  No other change to this file.
- `tools/test-object-geometry-builder.mjs` — new test #21 for `wallRadiusAt()`, cross-checked
  against a real built mesh's own base-ring vertex (no prior direct test of this function existed;
  the only existing coverage, test #11, reimplements its own private local copy of the formula).
- `tools/rs2013-instanced-stone-harness.html` — extended with the real-`StoneLayout` placement mode
  (`?product=`), the plate/mug/tumbler/bottle placement math, and the reference/instanced
  side-by-side rendering. The original no-param static-grid mode is unchanged (moved into its own
  `runStep1Grid()` function, byte-identical logic).
- `tools/rs2013-instanced-stone-harness-screenshot.mjs` — extended to capture one screenshot per
  view (`grid`/`plate`/`mug`/`tumbler`/`bottle`) instead of one fixed screenshot; now also fails
  loudly (`process.exitCode = 1`) on any console/page error per view instead of only on timeout.
- `tools/rs2013-instanced-stone-harness-{grid,plate,mug,tumbler,bottle}.png` (new) — captured
  verification screenshots. The old single `tools/rs2013-instanced-stone-harness.png` (step-1's
  output) was removed since `-grid.png` now covers the identical content under the new naming
  scheme.
- `TASK.md` (rewritten for this milestone), `TASK_RESULT.md` (this file).

No file under `app.js`, `index.html`, `StoneLayoutTexture.js`, `Preview3DRenderer.js`, or any
`StoneLayout`/geometry-generation module was touched.

---

# Tests run

```bash
node tools/run-tests.mjs --all
node tools/test-documentation-consistency.mjs
```

# Test result

`node tools/run-tests.mjs --all`: **98/98 passed** (includes the new `wallRadiusAt()` test in
`test-object-geometry-builder.mjs`, now 21/21 in that file).

`node tools/test-documentation-consistency.mjs`: passed.

---

# Browser/manual verification

Ran `node tools/rs2013-instanced-stone-harness-screenshot.mjs` (headless Chromium via Playwright)
against all five harness views (`grid`, `plate`, `mug`, `tumbler`, `bottle`), served from a local
static server. Confirmed for every view:
- No console or page errors (the script fails loudly if any occur — all five passed clean).
- `window.__rs2013HarnessReady === true` reached within 15s (i.e. the full
  fetch → `GeometryEngine` → `buildObjectMesh` → instance-buffer pipeline completed without
  throwing) for every product.
- Visually reviewed each captured PNG directly (not just "did it render something") — see the
  per-sub-step sections above for what was specifically checked and the one real bug this caught
  (2b's Y-axis inversion, found and fixed before considering 2b/2c done).

Did not verify inside the live Studio UI/`app.js` — out of scope by design (§4 step 4, a future
milestone).

---

# Notes / warnings

- **Design-doc discrepancy, raised and resolved before implementing 2a:** §3.3's plate
  "flat-plane" placement description doesn't match the real plate mesh's ~12-15mm well/rim relief.
  Raised via `AskUserQuestion` before writing any code; approved resolution (well/rim transition
  height, derived from the real built mesh) is recorded in full in `TASK.md`.
- **Real bug found and fixed during 2b's own verification (not a doc issue):** stone Y positions
  need `bodyHeightMm - clamp(stone.yMm, 0, bodyHeightMm)`, not raw `stone.yMm`, because
  `stone.yMm` is Y-down and world Y is Y-up; the texture path hides this because
  `THREE.CanvasTexture`'s default `flipY=true` does the inversion invisibly. Documented in code
  comments at the fix site and above.
- Two harness-only fixes were needed to make the browser module graph resolve at all, unrelated to
  the placement math itself: (1) the `opentype.js` bare-specifier importmap entry `index.html`
  already declares was missing from the harness's own importmap (needed since loading a real
  `GeometryEngine` pulls in font code); (2) `FontManager`'s default font-buffer loader resolves
  each font's manifest path relative to the *current page URL*, which works for `index.html` at
  the repo root but not for this harness at `tools/` — worked around with an explicit
  `loadFontBuffer` that resolves against the repo root instead (mirrors the pattern
  `tools/test-examples-regression.mjs`'s Node-side `buildPermanentEngine()` already uses for the
  same reason, just via `fetch()`/`URL` instead of `node:fs`).
- Per `CLAUDE.md`'s Standard Workflow, this milestone stops at step 6 (commit) — no merge, no push,
  no tag, no branch deletion.

---

# Next recommended step

Design doc §4 step 3 — extend the existing directional-light rig to better serve real facet
normals (deferring HDRI evaluation unless the multi-light result visually under-delivers).
