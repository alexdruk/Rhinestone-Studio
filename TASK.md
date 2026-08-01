# Task

**Task ID:** RS-2013 (Implementation Phase — §4 step 2)
**Task Type:** Implementation
**Status:** IMPLEMENTED
**Branch:** feature/rs-2013-instanced-stones-step2-placement

## Goal

`docs/specifications/RS-2013-InstancedFacetedStoneRenderingDesign.md`'s §4 step 2: wire a real
`StoneLayout` through §3.3's placement/orientation mapping onto a real object surface, extending
the step-1 test harness (`tools/rs2013-instanced-stone-harness.html`). Exactly step 2 — nothing
from step 3 (lighting), step 4 (flag/`Preview3DRenderer` wiring), or later.

## Required Outcome

Per §3.3/§4 step 2, in this order, each visually checkable before the next:

- **2a — Plate**: `position = (stone.xMm - canvasWidthMm/2, plateTopY, -(stone.yMm -
  canvasHeightMm/2))`, `normal = +Y` for every stone, no orientation computation.
- **2b — Mug/tumbler**: azimuth via `azimuthRadForCanvasXMm()` (`ObjectDimensions.js`, reused
  as-is, never re-derived via `atan2`), height via `stone.yMm / bodyHeightMm`, radius via
  `wallRadiusAt()` (`ObjectGeometryBuilder.js`, exported this milestone), pure radial-normal
  orientation approximation (no tangent-based exact normal).
- **2c — Bottle**: same as 2b but `radius = bodyRadiusMm` (constant), no interpolation.
- **Orientation refinement (2b/2c only)**: per-instance rotation around the outward-normal axis
  reuses `CrystalAppearance.js`'s `facetAngleDeg` — no new randomization source.
- **Sign convention**: verify `x = radius*sin(azimuth), z = radius*cos(azimuth)` against
  `applyAzimuthUv()`'s actual column-to-position mapping (i.e. `THREE.LatheGeometry`'s own vertex
  construction) rather than assuming it — document the finding.

## Discrepancy from the design doc, raised and resolved before implementing (2a)

§3.3 describes the plate's printable face as flat and 2a's placement as a single-constant
`plateTopY`. Auditing the live `ObjectGeometryBuilder.js` (`buildPlateProfilePoints()`) found the
plate's top surface has real ~12-15mm vertical relief (a concave center well, `centerDepthMm`
below the rim, plus a sloped rim up to the outer edge) — only the *UV mapping*
(`applyPlateTopSurfaceUv()`) is a flat orthographic projection; the mesh itself is not flat. A
single flat `plateTopY` would visibly float/sink stones relative to the true surface depending on
their distance from center, which is exactly the kind of stale-premise mismatch `CLAUDE.md`'s
"Repository Is The Source Of Truth" rule requires flagging rather than silently reinterpreting
(parallel to step 0's wrap-mode-field finding).

Raised via `AskUserQuestion` before implementing. **Approved resolution:** `plateTopY` is the
well/rim transition height (where the concave well meets the sloped rim) — derived by scanning the
already-built plate top mesh's own vertices for the one closest to `r = innerWellRadiusMm` and
reading its real Y, rather than duplicating `ObjectGeometryBuilder.js`'s private profile constants
in a second place. This is still a single flat constant (matches §3.3's literal "flat-plane case,
zero curved-surface complexity" instruction for this step) but chosen to minimize the known,
documented mismatch for stones far from that boundary. Full reasoning and remaining known
limitation recorded in `TASK_RESULT.md`.

## No plate example project exists in `examples/`

Audited: every `examples/*.rhs` fixture is `mug`/`tumbler`/`bottle`; none is `product:"plate"`.
Per this task's own brief ("construct one via the same `GeometryEngine` entry point the live app
uses"), the harness constructs a small inline `.rhs`-shaped plate project object (two outline-mode
concentric circles, matching the style of the existing example fixtures) instead of adding a new
file under `examples/` (outside this milestone's allowed-files list). Mug/tumbler/bottle use real,
existing example fixtures (`short-name-block.rhs`, `tumbler-wrap-design.rhs`,
`bottle-front-design.rhs`) loaded via `fetch()`.

## Verification method

For each sub-step, the harness renders the *same* real `StoneLayout` two ways, side by side, in
one scene: the existing texture-based path (`StoneLayoutTexture.js`'s real
`drawStoneLayoutTexture()`, applied to a body mesh exactly as `Preview3DRenderer._updateTexture()`
does) on the left, and the new instanced-stone placement math on an undecorated body mesh on the
right. A visual match between the two (same stone arrangement, same side of the object, same
height, right-side-up) is the pass criterion for that sub-step — not just "stones appear somewhere
on the object."

## Allowed files

- `tools/rs2013-instanced-stone-harness.html` (extended, not replaced).
- `tools/rs2013-instanced-stone-harness-screenshot.mjs` (extended for the new per-product views).
- `src/preview3d/ObjectGeometryBuilder.js` — only to export `wallRadiusAt()`. No other change.
- New screenshot asset(s) documenting each sub-step's visual result.
- `tools/test-object-geometry-builder.mjs` — a direct test for the newly-exported `wallRadiusAt()`,
  if no existing coverage already exercises it.
- `TASK.md`, `TASK_RESULT.md`.

## Forbidden in this milestone

- `app.js`, `index.html`, any live Studio UI wiring.
- Any lighting-rig change (§3.4 — step 3).
- Any flag/integration wiring into `Preview3DRenderer`'s real `update()` path (§3.6/§4 step 4).
- Building the exact tangent-based normal for mug/tumbler (only if the radial approximation
  demonstrably fails — report first, do not unilaterally upgrade).
- Deleting or modifying `StoneLayoutTexture.js` or its stone-drawing responsibility (consumed
  read-only, for the reference/comparison render).

## Rules

- Smallest coherent change; reuse existing exported functions (`azimuthRadForCanvasXMm()`,
  `wallRadiusAt()`, `getCrystalAppearance()`, `getCrystalColor()`) — never re-derive.
- Run `node tools/run-tests.mjs --all` and confirm 100% pass.
- Run `node tools/test-documentation-consistency.mjs` before committing.
- Commit locally with a clear message; do **not** push.

## Deliverables

- `src/preview3d/ObjectGeometryBuilder.js` — `wallRadiusAt()` export.
- `tools/rs2013-instanced-stone-harness.html` — extended with real-`StoneLayout` placement for
  plate/mug/tumbler/bottle, selectable via a `?product=` query param, each showing the
  texture-based reference and the new instanced placement side by side.
- `tools/rs2013-instanced-stone-harness-screenshot.mjs` — extended to capture one screenshot per
  product.
- Screenshot PNGs for each of 2a/2b/2c.
- `tools/test-object-geometry-builder.mjs` — `wallRadiusAt()` coverage, if needed.
- `TASK.md` (this file), `TASK_RESULT.md`.
