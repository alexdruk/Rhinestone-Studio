# RS-2013 — Instanced Faceted Stone Rendering: Design & Audit (Phase A)

## Task ID

RS-2013

## Title

Design-and-audit phase for replacing the 3D preview's canvas-texture stone layer with real
instanced, faceted 3D geometry lit by environment lighting. **This document is the only
deliverable of this phase — no implementation.**

## Status

Design proposal — not implemented, not approved for implementation. A separate, later milestone
(or several, per §4 below) will carry out the actual work.

## Why this milestone / ID

`ARCH-REVIEW-001` (`docs/specifications/ARCH-REVIEW-001-FullArchitectureAndCodebaseReview.md`,
§0 row 8 and Part 4 item 2) is the origin of this work: it re-confirmed that the 3D preview's
*vessel body* geometry is real and dimension-driven (`RS-1006`/`RS-1006A`/`RS-2010`/`RS-2011`), but
the *stones* are still `drawCrystalStone()` baked into a flat `CanvasTexture`
(`src/preview3d/StoneLayoutTexture.js`) applied to that body mesh — "the instanced-faceted-geometry
goal is unchanged," and ranked it the #2 next milestone after closing Version 1.0 (which RC-008
subsequently did). `RS-2012` is the most recent used `RS-20xx` id in `docs/specifications/`, so this
document is `RS-2013`, continuing the `RS-1006 → RS-1006A → RS-2010 → RS-2011` 3D-preview lineage.

## Correction to this phase's brief, found during audit

The brief that opened this phase stated that "cone geometry, flat-back mesh, outline tracing, and
skeletonization were all tried and abandoned" for 3D stone rendering, and asked this audit to find
the specs documenting those rejections before proposing a new approach. **That premise does not
match the repository.** A repo-wide search (`grep -rniE "cone geometry|flat.?back|outline trac|skeletoniz|instanced|faceted|chaton|bipyramid" docs/`)
found:

- **No spec, ADR, or `docs/ARCHITECTURE.md` passage describes any prior attempt — rejected or
  otherwise — at 3D stone geometry.** `ARCH-REVIEW-001` is the *first* place "instanced/faceted 3D
  geometry" for stones is even proposed (Part 4, item 2, explicitly future work, "large" scope).
  There is nothing to avoid repeating, because nothing was previously attempted here.
- `skeletoniz(e/ation)` and `outline trac(e/ing)` *do* appear in the repo, but exclusively in the
  **font-generation program** (`FONT-GEN-004-SkeletonRebuildCorrectionStrategy.md`, rejected
  skeleton-rebuild *glyph outline* correction for the procedural rhinestone font pipeline;
  `TXT-101A`'s two rejected vector-outline approaches, per memory/`docs/specifications/` — a 2D
  *font-glyph-to-stone-position* problem, `tools/font-generator/`, entirely separate from the 3D
  preview). `RS-1008`/`RS-1008A` (Image Trace) is a separate "outline tracing" feature, again 2D
  stone-position generation from a bitmap, not 3D rendering.
- `cone`/`flat-back` appear nowhere in `docs/` at all, except one unrelated use of "truncated
  cone/lampshade" in `RS-1006A-PreviewCorrections.md` describing what the *old bare-frustum mug
  body* looked like before that milestone fixed it — a vessel-body-silhouette note, not a
  stone-geometry one.

This is flagged prominently, not quietly corrected, because `CLAUDE.md`'s "Repository Is The Source
Of Truth" rule requires auditing before assuming — and because a design document that invented a
false rejection history to react to would be worse than one that has none to react to. §3.7 below
still explicitly addresses failure-mode risk for this specific proposal, argued from first
principles (viability math, engine constraints, and this codebase's own established patterns)
rather than from a rejection history that doesn't exist.

A second brief premise also needs correction: the brief describes the pinned Three.js version as
"r128." **The repository is pinned to Three.js `0.169.0`** — confirmed three ways: `package.json`'s
`"three": "^0.169.0"`, the installed `node_modules/three/package.json` (`"version": "0.169.0"`),
and `Preview3DRenderer.js`'s own inline comment ("Three.js 0.169 targets WebGL2 ..."), independently
re-confirmed by `RS-2011-3DPreviewCorrectness.md`'s own audit ("the installed Three.js version
(`0.169.0`, WebGL2-capable ...)"). `r128` is roughly three years and 40 minor versions behind what
is actually installed; §3.2 below evaluates instancing against the real, current API.

---

## §1 — Current-state audit

### 1.1 The texture-baking pipeline, end to end

**Data in:** `Preview3DRenderer.update(stoneLayout, { cupColor, objectTemplate, canvasWidthMm,
canvasHeightMm, plateParams, vesselParams })` — a `StoneLayout` (from `GeometryEngine`, untouched
by this module) plus plain display options. Nothing in `src/preview3d/**` generates or repositions
a stone; it only consumes `stoneLayout.stones` (`{xMm, yMm, sizeMm, color, layerId, index}` each,
per `src/geometry/Stone.js` — no rotation/orientation field; stones are inherently a flat,
production-canvas concept).

**Pipeline:**

1. `Preview3DRenderer._rebuildMesh()` calls `ObjectGeometryBuilder.buildObjectMesh()` (only on
   geometry-key change — object template/canvas-size/product-params) to get `{group, bodyMesh,
   handleMesh, underMesh, dimensions}`. `bodyMesh` is a real, dimension-driven `THREE.LatheGeometry`
   (or two, for the plate) — this part is correct and explicitly untouched by this design.
2. Every `update()` call — i.e. on **every** project edit, not just geometry changes — calls
   `Preview3DRenderer._updateTexture()`, which:
   - lazily creates (or, on a pixel-size change, disposes+recreates —
     `Preview3DRenderer.js:314-330`) an `HTMLCanvasElement` + 2D context + `THREE.CanvasTexture`,
     sized via `StoneLayoutTexture.textureSizeForMm()` (`TEXTURE_PX_PER_MM = 8`, fixed regardless
     of object size — `StoneLayoutTexture.js:17-29`);
   - calls `drawStoneLayoutTexture(ctx, stoneLayout, {widthMm, heightMm, backgroundColor})`
     (`StoneLayoutTexture.js:45-64`), which clears the canvas, fills the background color, then
     loops every `stone` in `stoneLayout.stones` and calls
     `drawCrystalStone(ctx, stone.xMm*pxPerMm, stone.yMm*pxPerMm, Math.max(0.75,(stone.sizeMm/2)*pxPerMm), stone.color, getCrystalAppearance(stone))`
     — i.e. **every stone is a full 2D canvas gradient-and-stroke draw call, into a flat texture,
     once per project edit**, not once per geometry rebuild;
   - sets `texture.needsUpdate = true` and assigns it to `bodyMesh.material.map` if not already
     assigned.
3. `bodyMesh`'s UV coordinates (assigned once, at mesh-build time, by `ObjectGeometryBuilder.js`'s
   `applyAzimuthUv()`/`applyBodyHeightUv()`) map the flat texture onto the revolved body: U from
   each vertex's *construction* column angle (not `atan2`, to avoid a branch-cut/signed-zero bug —
   see that file's extensive inline comments), V from the vertex's own mm height divided by
   `bodyHeightMm`.

**Where 3D-specific stone appearance logic currently lives:** almost nowhere separately — that is
the one genuinely good property of the current design. `StoneLayoutTexture.js` does not implement
its own stone look; it calls the *same* `drawCrystalStone()`/`getCrystalAppearance()` the 2D canvas
renderer uses (see §1.2). The only 3D-specific logic is: (a) the fixed `TEXTURE_PX_PER_MM` mm→px
scale, (b) `Preview3DRenderer._applyCrystalMaterialResponse()` (`Preview3DRenderer.js:276-281`), a
small, deliberately modest `roughness=0.42/metalness=0.08` nudge on the body material overall (not
per-stone — it can't be, since the whole vessel body is one texture-mapped mesh), and (c) the
texture wrap/filter parameters in `_applyTextureParams()` (§2.1 below).

### 1.2 2D crystal-appearance modules — what's directly reusable

- **`src/renderer/CrystalAppearance.js`** — `getCrystalAppearance(stone)`: pure, DOM-free, derives
  bounded/deterministic per-stone variation (`facetAngleDeg`, `highlightIntensity`,
  `secondaryAngleDeg/Intensity`, `shadowStrength`, `brightness`, `sparkle`, `sparkleVariant`) from a
  seeded hash of the stone's own stable fields (`xMm/yMm/sizeMm/color/layerId/index`, via FNV-1a +
  `mulberry32`). **Directly reusable, unchanged, by an instanced approach** — it already returns
  plain numbers, not canvas calls; a per-instance-attribute pipeline can call this exact function
  once per stone at instance-buffer-build time and map `facetAngleDeg`→instance rotation,
  `brightness`→instance color multiplier, etc., with zero duplication risk. This is the intended
  reuse path, not a new one this design invents — the module's own header already states it exists
  "so both previews derive the same per-stone look from the same seed."
- **`src/renderer/CrystalColors.js`** — the actual 17-entry color catalog (`CRYSTAL_COLOR_LIST`,
  `{fill, stroke, shine, accent}` per id). `src/renderer/CrystalStoneRenderer.js` and
  `StoneLayoutTexture.js` both resolve a stone's color via `STONE_COLORS[colorKey]`, which is
  `src/renderer/StoneColors.js`'s one-line re-export of this file's `STONE_COLORS`
  (`CrystalColors.js:135`). **Directly reusable, unchanged**: an instanced approach's per-instance
  color attribute should resolve `stone.color` through this exact catalog (`getCrystalColor(id)` or
  `STONE_COLORS[id]`), the same lookup every existing consumer already performs — never a new/
  duplicate color table.
- **`src/renderer/CrystalStoneRenderer.js`** (`drawCrystalStone()`) — **not directly reusable**, by
  construction: it *is* the 2D-canvas-specific gradient/stroke-drawing implementation (shadow
  gradient, body radial gradient, facet chords as strokes, highlight/secondary-reflection ellipses,
  sparkle glints) — a flat-appearance simulation of facets via 2D shading tricks, which is exactly
  what real 3D faceted geometry + real lighting is meant to replace, not wrap. What *is* reusable
  from it is one non-obvious piece of logic: `sparkleOpacityFor()`/the sparkle-eligibility rate
  (`~12.5%`, `CrystalAppearance.SPARKLE_ELIGIBILITY`) and `SPARKLE_VARIANT_COUNT=4` — if the
  instanced design wants an analogous "occasional extra glint" cue in 3D (e.g. a bloom/flare
  billboard on ~1-in-8 stones), that eligibility signal already exists in `CrystalAppearance.js` and
  should be read from there, not re-derived.
- **Conclusion**: the reusable seam is exactly `CrystalAppearance.js` (variation) +
  `CrystalColors.js` (color) — both pure-data modules with zero canvas/DOM/Three.js coupling
  already. Building a third per-stone-appearance model in a new `src/preview3d/**` instancing module
  would recreate precisely the "same problem solved twice" pattern `ARCH-REVIEW-001` flagged
  elsewhere in this codebase (§1.2 of that report, on `app.js` cross-layer logic) — avoiding that
  duplication is a hard requirement of this design (§3.5 makes the mapping explicit), not a nice-to-have.

### 1.3 Realistic stone-count ceiling

Two data sources, both audited directly (not assumed):

- **`examples/baselines.json`** (the committed fixture/regression baseline set,
  `test-examples-regression.mjs`'s source of truth) carries a `stoneCount` field per fixture. Across
  all 27 baselines, the largest is **1,161 stones** (`mixed-fill-styles-and-sizes.rhs`), followed by
  1,008 (`multi-color-mixed-layers.rhs`) and 808 (`svg-logo-import.rhs`). These are realistic,
  already-authored example designs, not synthetic stress tests.
- **Theoretical worst case**, computed from real product/stone-size bounds already in the repo
  (`src/products/definitions/plate-round-dinner.json`: `outerDiameterMm.max = 300`;
  `src/renderer/StoneSizes.js`: smallest catalog size `ss6`, `diameterMm = 2.0`): a 300mm plate
  filled edge-to-edge at SS6 with a typical small gap has an area of ~70,700mm² and a hex-packed
  stone pitch on the order of 2.2-2.5mm, giving a **rough upper bound in the 11,000-15,000 stone
  range** for the single largest realistic full-coverage design this product/size catalog can
  produce. `ARCH-REVIEW-001` independently described this class of design as "several thousand
  `Stone` records," consistent with this estimate.
- `tools/test-variable-stone-sizes.mjs` (RS-1013) does not itself construct a large-N fixture — it
  is an end-to-end correctness suite (per-layer stone size independence, mixed sizing, Stone Library
  wiring), not a stress/perf test. No file in `tools/` currently exercises a many-thousands-of-stones
  fixture; this is itself a gap worth carrying into the implementation phase's test plan (§4).

**Why this number matters for the design (§3.2):** ~1,000 stones (realistic today) to ~15,000
(theoretical ceiling for this catalog) is squarely in "one `THREE.InstancedMesh` draw call, trivial
at 60fps" territory (contemporary WebGL2/desktop-class GPUs comfortably render single-digit millions
of instanced triangles per frame) and squarely *outside* "one `THREE.Object3D`/`THREE.Mesh` per
stone" territory (thousands of independent draw calls / scene-graph nodes reliably drops well below
60fps in three.js, typically starting to show frame drops in the low thousands). This single number
is the strongest argument for `InstancedMesh` over per-stone objects in this codebase specifically,
not just as a general three.js best practice — see §3.2.

---

## §2 — Two smaller correctness items (audit only — not fixed in this phase)

### 2.1 Texture wrap mode — confirmed, still `ClampToEdgeWrapping`

`Preview3DRenderer.js:290-291`, inside `_applyTextureParams(texture)`:

```js
texture.wrapS = THREE.ClampToEdgeWrapping;
texture.wrapT = THREE.ClampToEdgeWrapping;
```

This is the one function that constructs/configures the `THREE.CanvasTexture` (called from both the
initial-creation and resize-triggered-recreation sites in `_updateTexture()`,
`Preview3DRenderer.js:304-330`). **Confirmed: still `ClampToEdgeWrapping` on both axes, not
`RepeatWrapping`.** For a design with a full 360° wrap (`wrap: 'full'`), the texture's own U=0/U=1
edges are the *same* physical seam the mesh's `phiStart=-PI` deliberately routes to the back
(`ObjectGeometryBuilder.js`'s extensive `S-107 follow-up` comments) — but `ClampToEdgeWrapping`
still means any UV sampling that lands slightly outside `[0,1]` (mipmap/anisotropic filtering at
the seam, which `_applyTextureParams()` explicitly enables just below this, lines 297-300) clamps to
the nearest edge texel instead of wrapping to the opposite edge's texel, which is a plausible source
of a visible seam artifact under minification/filtering at exactly the mesh seam location. This is
**listed as an explicit, separately-actionable prerequisite finding** (§4, step 0) — not fixed here.
Note it is orthogonal to the instanced-geometry work: it affects the *existing* texture path
regardless of whether instancing ever ships, so it is worth fixing on its own schedule regardless of
this milestone's timeline.

### 2.2 `Math.min(...array)`/`Math.max(...array)` spread risk

Grepped exactly as scoped (`grep -rnE "Math\.(min|max)\(\.\.\." src/geometry/ src/preview3d/ src/export/`):

| File:line | Array | Bounded by |
|---|---|---|
| `src/geometry/MixedSizeGenerator.js:70,73` | `allowedSizesMmRaw` | user-selected stone-size options (catalog length, ≤7) |
| `src/geometry/PathBoolean.js:120` | `diagonalsMm` | `[subjectBox, clipBox]`, length ≤2 |
| `src/geometry/PathBoolean.js:215-218` | `boxes.map(...)` | `[subjectBox, clipBox]`, length ≤2 |

**No occurrence in `src/geometry/**`, `src/preview3d/**`, or `src/export/**` applies this pattern to
a per-stone array.** A broader sweep (`grep -rnE` over all of `src/` + `app.js`, beyond this phase's
scoped three directories, done for completeness) finds two more occurrences —
`app.js:1511` (`layers.map(...)`, bounded by selected-layer count) and `app.js:1627`
(`listStoneSizes().map(...)`, bounded by the stone-size catalog) and one in
`src/monogram/MonogramGenerator.js:485` (`fillScaleCandidates`, a small bounded candidate list) —
none of which touch a stone-count-sized array either. **`ARCH-REVIEW-001`'s specific stack-overflow
concern (§1.3 of that report) does not currently have a live trigger anywhere in the codebase**, on
direct inspection — a materially different, more precise conclusion than that report's own "worth a
grep... before the next release candidate" framing suggested might be found.

That said, the *pattern itself* is still worth guarding against pre-emptively, precisely because
this milestone's own instanced-geometry work is the first thing in this codebase's history that
would plausibly want to compute a `Math.min`/`Math.max` (or similar) over a full per-stone array (a
`Float32Array` of instance positions/sizes, for bounding-sphere computation, culling, or
`InstancedBufferGeometry` housekeeping) — reduce-with-a-loop, not spread, whenever that array's
length is stone-count-scaled, not catalog/layer-count-scaled. Concretely, this repository's own
Node.js runtime (`node v22.15.0`, empirically tested in this audit via a binary search) throws
`RangeError: Maximum call stack size exceeded` on `Math.max(...array)` once `array.length` exceeds
**125,269 elements** (fails at 125,270) — this exact threshold is stack-depth/V8-version/platform
dependent in general, but the empirical number for this repo's actual dev/CI runtime is now known
rather than guessed. Given §1.3's ~15,000-stone theoretical ceiling, no currently-realistic design
gets within ~8x of that threshold even if a naive spread were used — this is a defensive-coding
note for the implementation phase (§4), not a live bug and not a blocker.

---

## §3 — Design proposal

### 3.1 Geometry: shape and polygon budget

**Proposed shape**: a low-poly **octahedral bipyramid** (a chaton-cut approximation) — two
4-sided pyramids joined base-to-base, i.e. an 8-triangle, 6-vertex solid (`THREE.OctahedronGeometry(radius, 0)`
is exactly this primitive, built-in, zero custom geometry authoring required). This is the standard
"looks like a faceted gem, costs almost nothing" primitive used across real-time jewelry/gem
visualizations, and matches how a rhinestone actually reads at typical viewing distance in this
preview: a compact, symmetric cluster of flat reflective facets, not a smooth dome (the current
texture's gradient-disc look) and not a fully detailed 32-facet round-brilliant cut (unnecessary
detail at these sizes/distances and this stone-count ceiling).

**Polygon budget, justified against §1.3's ceiling**: 8 triangles/stone × ~15,000 stones (the
theoretical worst case) = **120,000 triangles**, or ×1,161 (the largest *actual* fixture) = **9,288
triangles** — both trivially within a single `InstancedMesh` draw call's budget on any WebGL2-class
GPU. Even a richer 16-triangle "double bipyramid" (two stacked octahedra, a slightly more faceted
silhouette) stays under 250,000 triangles at the theoretical ceiling. There is no polygon-budget
pressure here at all; the real cost driver is draw calls and CPU-side instance-buffer updates (§3.2),
not triangle count. Recommendation: start at 8 triangles (plain octahedron) for Phase 1 of §4, and
only spend a later, separate step evaluating a richer cut if the visual result under-delivers —
resisting the temptation to over-engineer facet count before seeing it rendered is itself the
"smallest coherent change" principle `AI_ENGINEER.md` asks for.

### 3.2 Instancing mechanism: `THREE.InstancedMesh`

Confirmed viable and the correct primitive on the *actual* pinned version, `0.169.0` (not `r128` —
see the correction above): `InstancedMesh` has existed since three.js `r103` and `InstancedMesh`'s
built-in `.instanceColor` (a per-instance `Color` attribute, avoiding a hand-rolled custom shader
just to vary color) has existed since `r131` — both are seven-plus years and dozens of minor
versions behind `0.169.0`, so nothing about "is this API available yet" is a live concern the way it
would genuinely have been worth checking against a real `r128` pin. One real `0.169`-era
consideration: `MeshStandardMaterial` (already the material class this repo uses for every
`preview3d` mesh) supports per-instance color natively when `mesh.instanceColor` is set — no custom
`ShaderMaterial`/`onBeforeCompile` patching needed, keeping this consistent with
`ObjectGeometryBuilder.js`'s existing all-`MeshStandardMaterial` convention.

Mechanism: one `THREE.InstancedMesh(bipyramidGeometry, crystalMaterial, stoneCount)` per rebuild
(rebuilt whenever `stoneLayout.stones.length` or the object/geometry key changes, mirroring
`Preview3DRenderer._rebuildMesh()`'s existing geometry-key-change gating — §1.1 point 1). Per-stone
loop (CPU-side, once per `update()` call, analogous to today's per-stone canvas-draw loop in
`drawStoneLayoutTexture()`) writes:
- a `THREE.Matrix4` (position + rotation + uniform scale from `stone.sizeMm`) via
  `instancedMesh.setMatrixAt(i, matrix)`,
- a `THREE.Color` (resolved via `CrystalColors.js`, §1.2) via `instancedMesh.setColorAt(i, color)`,

then one `instanceMatrix.needsUpdate = true` / `instanceColor.needsUpdate = true` per frame that
actually changed — the same "batch the writes, flip one dirty flag" shape
`Preview3DRenderer._updateTexture()` already uses for the texture (`texture.needsUpdate = true`),
so this is a continuation of an existing pattern in this file, not a new one.

**One draw call for the entire stone layer, at any of §1.3's stone counts** — this is the
single biggest advantage over both the current texture approach (which is *already* one draw call,
so instancing doesn't regress draw-call count) and a naive one-`Object3D`-per-stone approach (which
would be `stoneCount` draw calls/scene-graph nodes, the single approach modern three.js guidance
universally rejects at this scale, and the one this design explicitly is not proposing).

**This does not mean the per-`update()` cost is free, and it is a distinct cost from the
steady-state GPU render budget above.** The CPU-side per-stone loop (§3.3's placement/orientation
math plus `Matrix4`/`Color` construction) runs once per `Preview3DRenderer.update()` call, and per
§1.1 `update()` fires on **every** project edit — including continuous, high-frequency events:
`app.js`'s own comments confirm `pointermove` "already calls `updateAll()` on every move" during a
drag (`app.js:1366`), with no throttling on that path today. At §1.3's ~15,000-stone ceiling, that
is 15,000 `Matrix4` constructions (each involving the orientation trig from §3.3) potentially
several times per second while an operator drags a shape — a real cost the texture approach doesn't
have in the same shape (it redraws a fixed-resolution canvas, not a per-stone JS loop that grows
with `stoneCount`). Worth noting this codebase already has exactly one precedent for coalescing a
high-frequency edit signal before doing expensive work: `app.js`'s autosave path debounces its own
write via `AUTOSAVE_DEBOUNCE_MS = 1200` (`app.js:872,920`) rather than firing on every edit — though
that debounce exists for a different concern (localStorage write cost) and is not currently applied
to `drawCup()`/`preview3D.update()` itself, so it is a precedent to reuse the *pattern* of, not
something already protecting this path. Two mitigation options worth evaluating during
implementation, not decided here: debouncing/throttling the instance-buffer rebuild specifically
during a continuous drag (mirroring the autosave precedent), or — if `StoneLayout` changes are ever
partial/diffable rather than always a full regeneration — updating only the changed instances'
`Matrix4`/`Color` entries instead of rebuilding the full buffer every call.

### 3.3 Placement/orientation on the curved surface — the genuinely hard part

This design deliberately builds on machinery `ObjectGeometryBuilder.js`/`ObjectDimensions.js`
**already established and got right** for the texture-UV mapping, rather than inventing a parallel
one:

- **Azimuth**: `ObjectDimensions.js` already exports exactly the function needed —
  `azimuthRadForCanvasXMm(stone.xMm, canvasWidthMm)` (`ObjectDimensions.js:94-97`) — the same
  formula `ObjectGeometryBuilder.js`'s `applyAzimuthUv()` uses (in its inverse direction) to place
  the texture's U coordinate. Reusing this one exported function (already unit-tested, already the
  single source of truth both the 2D Front View Frame and the mesh UV agree with) instead of a new
  `atan2`-based derivation sidesteps *exactly* the two real bugs `applyAzimuthUv()`'s own comments
  document (the ±π branch-cut swing and the r=0 signed-zero apex instability) — those bugs are
  specific to deriving azimuth *from a built vertex's position*; deriving it *from the stone's own
  canvas x*, as this function already does, never hits either failure mode.
- **Height**: the stone's `yMm`, divided by `bodyHeightMm` (`dimensions.bodyHeightMm`, already
  computed by `computeObjectDimensionsMm()`), the same ratio `applyBodyHeightUv()` already writes as
  V. For mug/tumbler, radius-at-that-height comes from `wallRadiusAt(y, dimensions)`
  (`ObjectGeometryBuilder.js:335-339`) — a 3-line linear interpolation between `bodyRadiusMm` and
  `topRadiusMm` — currently **module-private, not exported**. For the bottle, the printable body
  region is a true cylinder (`buildBottleGeometry()`'s profile is constant-radius
  `bodyRadiusMm` for `0..bodyHeightMm`; the taper only starts above the shoulder, outside the
  printable/texture-mapped region — confirmed by reading `buildBottleGeometry()`'s point list
  directly), so no interpolation is needed there at all — `radius = bodyRadiusMm` for every stone.
  For the plate, there is no curved surface: `applyPlateTopSurfaceUv()`'s direct planar
  `(x, z)` projection already establishes that the printable face is flat, so plate-stone placement
  is a strictly simpler flat-plane case (`position = (stone.xMm - canvasWidthMm/2, plateTopY,
  -(stone.yMm - canvasHeightMm/2))`, normal = `+Y` for every stone) — worth implementing first in
  the sequencing (§4) precisely because it has no curved-surface complexity at all.
- **3D position** (mug/tumbler/bottle): `x = radius * sin(azimuth)`, `z = radius * cos(azimuth)`,
  `y = stone.yMm` (clamped to `[0, bodyHeightMm]`, matching the texture's own V-clamp-via-
  `ClampToEdgeWrapping` behavior for off-body content like a bottle's shoulder overflow) — sign
  convention to be verified against `applyAzimuthUv()`'s exact column-to-position mapping during
  implementation (§4 step 2), not re-derived from scratch.
- **Orientation ("oriented outward, not flat")**: the facet geometry's local +Z axis should align
  with the surface's outward normal at that point. For mug/tumbler, the true normal is not purely
  radial (the wall tapers, so the surface has a slight vertical slope component) — the outward
  normal can be derived the same way `LatheGeometry` derives its own per-vertex normal: from the
  local tangent of `wallRadiusAt(y)` (a 1D function, so its slope is a trivial finite-difference or
  closed-form derivative, not a re-implementation of `LatheGeometry`'s own normal machinery). A pure
  radial-normal approximation (ignore the small taper-induced tilt) is very likely visually
  indistinguishable at typical camera distance for how gentle this repo's existing taper constants
  are (`RIM_*_FRACTION` constants in `ObjectGeometryBuilder.js` are all within a few percent of 1.0)
  — worth trying the cheap approximation first (§4) before building the exact tangent-based normal,
  again in the spirit of not over-building ahead of a visual check. `THREE.Object3D.lookAt()` (or
  equivalent quaternion-from-normal math) per stone, baked into each instance's `Matrix4`, is the
  mechanism — computed once per `update()` call in the same CPU loop as position (§3.2), not per
  frame.
- Random per-instance rotation *around* the outward-normal axis (so identical stones don't all show
  the same facet silhouette) should reuse `CrystalAppearance.js`'s `facetAngleDeg` (§1.2) as that
  axis-rotation input — the exact seeded, deterministic value the 2D renderer already computes for
  an analogous purpose (rotating its 2D facet-shading pattern), so the two previews stay visually
  "the same stone, same seed" in spirit even though the 3D one is real geometry, not a 2D fake.

### 3.4 Lighting: environment map vs. multi-light rig

**Recommendation: a small, fixed multi-light rig (extend the existing one), not a full HDRI
environment map, at least for the first shipped version.** Reasoning:

- `Preview3DRenderer.js` already has exactly the right *shape* of lighting for this — one ambient
  light plus two directional lights from different angles (`init()`, lines 92-102, the second one
  added specifically by `PREVIEW-001` "to give the design texture's own faceted-crystal highlights
  ... a second angle to catch"). Faceted geometry with real normals will respond to this rig far
  more convincingly than the current flat texture ever could (real per-facet Lambertian/specular
  response vs. a baked, fixed-appearing gradient) — the existing lights were already trying to
  simulate what real facet normals will now do for free.
  A third light (or repositioning the existing two) to cover more facet angles is a cheap,
  incremental extension of this file's established pattern, not a new lighting architecture.
- A real HDRI `PMREMGenerator`-based environment map would look better still (genuine multi-angle
  reflections, not just multi-angle diffuse/specular from point-ish directional sources) but costs
  meaningfully more: an HDR asset to load/ship, a `PMREMGenerator` pre-filter pass (a real one-time
  GPU cost per environment, non-trivial on lower-end devices this browser-based tool has no control
  over), and a new asset-loading path this codebase doesn't have yet for `preview3d`
  (`docs/ARCHITECTURE.md`/`AI_ENGINEER.md`'s "do not add a dependency unless it materially reduces
  risk or complexity" and "prefer existing... browser-native capabilities" both lean against
  reaching for this first). Given `MeshStandardMaterial` + a directional-light rig already produces
  a physically-plausible faceted look for a *single small, mostly-convex object under an
  orbit-controllable camera* (this preview's exact use case — not an open scene needing ambient
  occlusion or complex inter-reflection), the added realism from an HDRI is real but marginal
  relative to its cost here.
- **Migration-friendly**: nothing about building the multi-light version forecloses adding an HDRI
  later — `scene.environment` is an additive property change, not a rearchitecture, so this
  recommendation is a "start cheap, upgrade later if the multi-light result under-delivers
  visually" sequencing choice (§4), not a permanent one.

### 3.5 Color/appearance mapping

Direct, one-hop mapping — no new appearance model (per §1.2's hard requirement to avoid a third
appearance implementation):

- `stone.color` (a catalog id, e.g. `"gold"`) → `CrystalColors.getCrystalColor(id)` → its `fill` hex
  → `THREE.Color` → `instancedMesh.setColorAt(i, color)`. This is the *base* facet color; unlike the
  2D renderer's `adjustBrightness(c.shine/fill/accent, appearance.brightness)` 3-stop gradient
  (simulating light falloff across a flat disc, §1.2), an instanced 3D facet doesn't need to fake
  gradient shading at all — real per-vertex/per-facet normals under `MeshStandardMaterial` produce
  that falloff from the actual lighting rig (§3.4) automatically. `appearance.brightness` (from
  `getCrystalAppearance()`) can still be applied as a small multiplier on the instance color to
  preserve the existing "each stone reads as very slightly individual, not a stamped-out repeat"
  property the 2D renderer already has, without duplicating *how* that variation is derived.
  `appearance.facetAngleDeg` drives the per-instance rotation (§3.3), not color.
- `stroke`/`shine`/`accent` (the other three `CrystalColors.js` channels): `shine` has a natural 3D
  analogue (`MeshStandardMaterial.emissive` at very low intensity, or simply relying on the real
  specular highlight `roughness`/`metalness` already produce, matching `_applyCrystalMaterialResponse()`'s
  existing modest-not-chrome posture, §1.1); `stroke`/`accent` (the 2D renderer's outline color and
  gradient-endpoint color) have no obvious 1:1 3D equivalent and are reasonably left unused by the
  instanced material — they exist to fake facet edges/depth on a flat disc, which real facet
  geometry no longer needs faked.

### 3.6 Migration path: coexistence behind a flag

**Yes — and it should default to the existing texture path until validated, not flip immediately.**
Concretely:

- Add the instanced stone layer as an *additional* child of the same `group`
  `ObjectGeometryBuilder.buildObjectMesh()` already returns (a new `stoneMesh` alongside `bodyMesh`/
  `handleMesh`/`underMesh`), gated by a boolean passed into `Preview3DRenderer.update()`'s options
  (e.g. `instancedStones: false` default) — mirroring exactly how `plateParams`/`vesselParams` are
  already optional, product-specific options on that same method (§1.1's `update()` signature).
- When the flag is on: build/update the `InstancedMesh` (§3.2) and skip assigning the baked texture
  to `bodyMesh.material.map` (or keep `bodyMesh`'s material as a plain `cupColor`-tinted surface with
  no stone texture at all, since the stones now live in their own mesh) — the two are visually
  mutually exclusive per-frame (a vessel doesn't need both a printed-looking texture and real 3D
  stones simultaneously) but *architecturally* coexistent: `StoneLayoutTexture.js` stays completely
  unmodified and untouched by this work while the flag is off, so today's rendering is a pure
  regression-free fallback for as long as needed, exactly the "risky big-bang replacement" this
  question is asking to avoid.
- Because both paths consume the identical `StoneLayout` + `dimensions` inputs, an operator (or a
  future automated test) can toggle the flag and compare the same design side-by-side — a real
  A/B validation tool "for free" out of this structure, not an extra thing to build.
- Once validated (§4's later steps) and the instanced path is the shipped default, `StoneLayoutTexture.js`
  and the texture-construction code in `Preview3DRenderer.js` become removable in one final,
  separate step (§4's last step) — deliberately *not* scheduled as part of this design or its first
  implementation milestone.

### 3.7 Why this shouldn't fail the way other rejected approaches did

Per the correction above, there is no prior 3D-stone-geometry rejection history in this repository
to specifically avoid repeating. What *is* worth carrying over is the *shape* of why the font
program's analogous attempts (skeleton-rebuild, vector-outline, `FONT-GEN-004`/`TXT-101A`) were
rejected, since it's the closest precedent in spirit ("procedurally generate detailed geometry from
a simpler source, hope it reads correctly at production scale") even though the domain differs
entirely:

- Those were rejected primarily on an **empirical legibility/fragmentation metric** that only
  degraded *after* being built and measured at real stone-size scale — not on a viability argument
  available in advance. This design's core viability claim (draw-call count, triangle budget) *is*
  available in advance, from real numbers already in this repo (§1.3, §3.1/3.2) — there is no
  equivalent "won't know until we measure" risk for the *performance* half of this proposal.
- The *visual* half (does a faceted instanced stone actually look better than the current gradient
  disc, under this rig, at this scale) genuinely is a "build it and look" question, same as the font
  program's — which is exactly why §3.6's flag-gated coexistence and §4's staged sequencing (static
  test-plane geometry+color first, before placement, before lighting, before flag-flip) are
  structured to get a real visual read at the cheapest possible step, rather than committing to the
  full pipeline before the first visual checkpoint — the same lesson the font program's own staged,
  measure-then-decide milestones (`FONT-CAL-001/002`, `FONT-GEN-001..005`) demonstrate is the right
  posture for "will this actually look right" questions in this codebase, independent of domain.

---

## §4 — Scope and sequencing for the implementation phase

Ordered, independently testable/committable steps. Each step should be its own small milestone (or
sub-step of one), following `MILESTONE_WORKFLOW.md`'s normal draft→implement→test→commit loop — none
of this is implemented by this design phase.

0. **Prerequisite fixes (small, independent of everything else)** — §2.1 (texture wrap mode:
   confirm the intended fix is `RepeatWrapping` only for `wrap:'full'`, `ClampToEdgeWrapping`
   otherwise, since a partial wrap should still clamp) and §2.2 (replace any future stone-count-scaled
   `Math.min(...)/Math.max(...)` spread with a reduce loop, as a coding-standard note for step 3
   below — no live bug to fix today, so this is guidance for new code, not a fix to existing code).
   Can land before or fully independent of steps 1+.
1. **Static instanced geometry on a flat test plane** — octahedral-bipyramid `InstancedMesh`,
   correct facet shape, correct per-instance color (§3.5) and size, arranged in a trivial flat grid
   (not yet mapped onto the vessel surface, not yet reading real `StoneLayout` positions). Validates
   §3.1/§3.2/§3.5 in isolation, with nothing else in the pipeline to confound the visual read.
2. **Correct placement/orientation on the revolved body surface** — wire real `StoneLayout` data
   through §3.3's mapping (azimuth via `azimuthRadForCanvasXMm()`, height via `bodyHeightMm` ratio,
   radius via `wallRadiusAt()`/`bodyRadiusMm`, orientation via outward-normal alignment). Start with
   the plate (flat-plane case, no curved-surface complexity, per §3.3) to validate the
   `StoneLayout`-to-instance-buffer wiring itself before adding curved-surface math; then mug/tumbler
   (radial-normal approximation first, per §3.3); then bottle (constant-radius cylinder case).
3. **Lighting** — extend the existing directional-light rig (§3.4) to better serve real facet
   normals; defer HDRI environment-map evaluation to a follow-up step only if the multi-light result
   visually under-delivers.
4. **Flag-gated integration into `Preview3DRenderer`** — wire §3.6's coexistence flag end-to-end
   (`update()` option, `ObjectGeometryBuilder` returning the new mesh alongside the existing ones,
   dispose/rebuild lifecycle matching the existing `_disposeGroup()`/`_rebuildMesh()` pattern).
   Texture path remains the default; this step makes the instanced path *reachable*, not default.
5. **Stone-count stress testing** — a new test fixture/tool exercising a realistic large-N design
   (§1.3's ~1,000-15,000 range) to confirm frame timing holds up in a real browser, closing the
   coverage gap §1.3 identified (no existing test exercises a many-thousands-of-stones fixture).
   Must measure both a static render's frame timing (§1.3/§3.2's steady-state GPU cost) and
   interactive frame timing during a continuous drag/edit at the stone-count ceiling (§3.2's
   per-`update()` CPU rebuild cost) — the two are distinct costs and neither measurement substitutes
   for the other.
6. **Visual validation pass and default flip** — once steps 1-5 are visually/perf validated (a
   human-in-the-loop judgment call, not a mechanical test), flip the default to the instanced path.
7. **Remove the old texture path** — delete `StoneLayoutTexture.js`'s stone-drawing responsibility
   (the background-fill responsibility may still be needed for non-stone-covered regions, or may not
   be depending on how step 4 handled `bodyMesh` material — a call for whoever scopes that step) and
   the now-dead flag, once the instanced path has been the shipped default for long enough to be
   confident no fallback is needed. Deliberately last, and deliberately not bundled into any earlier
   step — this is exactly the kind of removal `CLAUDE.md`'s "Forbidden Changes" section (no rewriting
   working subsystems without explicit request) means to gate behind real validation, not
   assumption.

Each numbered step above is sized to be independently reviewable and revertible — consistent with
`MILESTONE_WORKFLOW.md`'s "prefer milestones... one to five focused development days" guidance, this
whole sequence is several milestones, not one.

---

## Files read for this audit

`src/preview3d/StoneLayoutTexture.js`, `src/preview3d/ObjectGeometryBuilder.js`,
`src/preview3d/Preview3DRenderer.js`, `src/preview3d/ObjectDimensions.js` (partial, the exported
azimuth/canvas-x functions), `src/renderer/CrystalStoneRenderer.js`, `src/renderer/CrystalAppearance.js`,
`src/renderer/CrystalColors.js`, `src/renderer/StoneColors.js`, `src/geometry/Stone.js` (partial),
`src/geometry/MixedSizeGenerator.js` (partial), `src/geometry/PathBoolean.js` (partial),
`docs/specifications/ARCH-REVIEW-001-FullArchitectureAndCodebaseReview.md` (full),
`docs/specifications/RS-1006A-PreviewCorrections.md` (partial), `docs/specifications/RS-2011-3DPreviewCorrectness.md`
(partial), `docs/ARCHITECTURE.md` (partial, 3D preview section), `docs/MILESTONE_WORKFLOW.md` (full),
`docs/AI_ENGINEER.md` (partial), `examples/baselines.json`, `src/products/definitions/plate-round-dinner.json`,
`src/products/definitions/vessel-standard-bottle.json`, `src/renderer/StoneSizes.js`, `package.json`,
`node_modules/three/package.json` (version check only). Repo-wide greps run for: cone/flat-back/outline-
tracing/skeletonization/instanced/faceted history; `Math.min(...)/Math.max(...)` spread pattern
(scoped to `src/geometry/**`, `src/preview3d/**`, `src/export/**`, then broadened to all of `src/`+`app.js`
for completeness); `RS-2013` collision check (none found — id confirmed available).
