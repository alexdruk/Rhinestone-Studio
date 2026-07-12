# RS-1006A — Real 3D Preview Corrections

## Task ID

RS-1006A

## Title

Follow-up correction pass on the RS-1006 Three.js 3D preview, driven by human visual review of the
shipped mesh (not by automated tests, which all passed while these defects were live).

## Status

In progress

## Objective

Fix four visual defects confirmed by human review of the RS-1006 3D preview, without replacing the
RS-1006 architecture. `src/preview3d/**` remains the only renderer; `StoneLayout`, `GeometryEngine`,
the exporters, and the Production Sheet pipeline are untouched.

## Defects (from human review, with screenshots)

1. **Mug geometry** — the mug body is a bare `CylinderGeometry` frustum: open top, open bottom, no
   rim. It reads as a generic truncated cone/lampshade, not a mug, because a real mug's mouth has
   visible wall thickness (a rim) and its base is a solid, visible disc, neither of which existed.
2. **Handle attachment** — `buildHandleMesh()`'s `TubeGeometry` curve endpoints sit exactly *on* the
   wall's mathematical surface, and `TubeGeometry`'s ends are open (uncapped). At that position the
   tube touches the wall at a single tangent point with an open circular cross-section right next to
   it, which reads as a floating loop with a visible gap, not a welded attachment.
3. **Tumbler/mug duplicated artwork** — confirmed root cause: the body mesh material was
   `side: THREE.DoubleSide` on a single-wall, open-ended (no bottom cap) hollow geometry. Looking
   into/across the open mouth from above makes the far interior wall's backface visible; since it is
   the same continuous surface (same per-vertex UV, driven only by `(x, z)` position, independent of
   face winding), it carries the same design texture, visible simultaneously with the near exterior
   wall and mirrored in screen-space by the viewing geometry — reading as duplicated, unreadable
   artwork. This is not a texture-generation or layout bug; `StoneLayout`/`StoneLayoutTexture.js` are
   correct and untouched.
4. **Bottle geometry / texture bleed** — confirmed root cause: `LatheGeometry`'s default `V` texture
   coordinate is proportional to *cumulative arc length along the whole revolved profile*
   (body+shoulder+neck+cap), not to the body's own millimeter height. The design texture — generated
   at exactly `canvasWidthMm × canvasHeightMm`, i.e. sized for the body only — was therefore mapped
   across the entire profile, visibly bleeding onto the shoulder. Compounding this, the shoulder was
   a single straight diagonal segment and the cap tapered to a point, which (combined with the
   texture bleed) made the silhouette read as one undifferentiated blob rather than a recognizable
   bottle (body → shoulder → neck → cap).

## Fix design

All four fixes live entirely inside `src/preview3d/ObjectGeometryBuilder.js` (geometry) and
`src/preview3d/Preview3DRenderer.js` (material). No change to `ObjectDimensions.js`'s public
contract (`computeObjectDimensionsMm()`'s returned fields are unchanged — existing pure-number tests
keep passing unmodified), `StoneLayoutTexture.js`, `StoneLayout.js`, `GeometryEngine.js`, or any
exporter.

1. **Mug/tumbler body**: replaced `CylinderGeometry` with a `LatheGeometry`-revolved profile (the
   same primitive the bottle already used), so all three object kinds now share one revolved-profile
   approach:
   * A closed flat base (`(0,0) → (bodyRadiusMm,0)`, a degenerate center point exactly like the
     bottle's existing base — proven correct since RS-1006).
   * The existing linear wall taper up to `RIM_FLARE_START_FRACTION` (95.5%) of `bodyHeightMm`.
   * A modeled rim: the wall flares slightly proud of its own radius to the true top of the object
     (`RIM_TOP_FRACTION = 1.0`, so the mesh's overall bounding-box height is unchanged — no existing
     height-based test needs updating), then folds back inward
     (`RIM_INNER_FRACTION`/`RIM_INNER_RADIUS_FACTOR`) to a slightly smaller radius — this visible
     fold is what reads as the mouth's wall thickness. The mouth stays open below that (no cap) —
     mugs/tumblers are genuinely open on top.
   * This is a real, if schematic, modeled rim — not a texture/shading trick.
2. **Handle attachment**: the `CatmullRomCurve3`'s two wall-attachment control points are moved
   `HANDLE_EMBED_FACTOR × tubeRadius` past the wall surface, toward the body's own axis, instead of
   sitting exactly on it. The tube's open end is now geometrically buried inside the solid body
   shell; from any camera position outside the body, the body wall's own front-facing surface is
   between the camera and the buried tube segment, so standard depth (z-buffer) occlusion hides the
   seam/open-cap artifact entirely — the handle now reads as physically continuous with the wall, the
   same technique commonly used to "weld" separate meshes without true CSG boolean union.
3. **Duplicate artwork**: body material changed from `side: THREE.DoubleSide` to the Three.js default
   `THREE.FrontSide`. A solid opaque vessel never needs its interior faces rendered from an external
   camera; removing them removes the actual second render pass through the open mouth (not a mask —
   the duplicate geometry pass is genuinely gone). Combined with fix 1's closed base, the mug/tumbler
   now reads as solid, not hollow-with-a-visible-phantom-interior.
4. **Bottle texture containment + shape**: a new `applyBodyHeightUv()` writes a custom per-vertex `V`
   coordinate — `v = position.y / bodyHeightMm` — for every body geometry (mug, tumbler, *and*
   bottle), replacing whichever default `V` Three.js's `CylinderGeometry`/`LatheGeometry` would have
   generated. For the body's straight wall this is unchanged in effect from the old
   `CylinderGeometry` default (bottom `v=0`, top `v=1` — no regression there); for the bottle, points
   above `bodyHeightMm` (shoulder/neck/cap) now get `v > 1`, which `ClampToEdgeWrapping` (already set
   on the texture in `Preview3DRenderer.js`) clamps to the texture's own top-edge texel — plain
   background color, not stretched design. The bottle's shoulder profile also gained one intermediate
   control point for a curved (not straight-diagonal) taper, and the cap gained a short
   near-cylindrical flared section before closing, instead of tapering straight to a point — both
   read closer to a recognizable bottle silhouette. `totalHeightMm` (base to cap tip) is unchanged, so
   the existing bounding-box-height test is unaffected.

## Allowed files

* `src/preview3d/ObjectGeometryBuilder.js`, `src/preview3d/Preview3DRenderer.js` (implementation).
* `tools/test-object-geometry-builder.mjs` (additive tests only — no existing assertion weakened).
* New: `docs/specifications/RS-1006A-PreviewCorrections.md`, `TASK.md`, `TASK_RESULT.md`.
* `docs/ARCHITECTURE.md` — a short note only, if needed.

## Forbidden files

Everything RS-1006 forbade, plus `src/preview3d/ObjectDimensions.js`, `src/preview3d/index.js`,
`src/preview3d/StoneLayoutTexture.js` (no reason to touch them — the defects are geometry/material,
not dimension math or texture drawing), `app.js`, `index.html`, `package.json`.

## Tests required

`npm test` (full existing suite, unmodified except the additive geometry-builder tests below) plus:

* Body material is `THREE.FrontSide` for mug/tumbler/bottle (regression guard for defect 3).
* Mug/tumbler body geometry has a closed base (a vertex at `y≈0` with `r≈0`) and its maximum radius
  occurs strictly above `y=0` and below the very top (i.e. a modeled rim exists, not a bare frustum).
* Handle tube's wall-attachment endpoints are strictly inside the wall radius at that height (not on
  or outside it) — regression guard for defect 2.
* A body vertex above `bodyHeightMm` (bottle shoulder/neck/cap) gets `v > 1`; a vertex within the
  body wall gets `v` within `[0,1]` — regression guard for defect 4.
* Existing bounding-box-height/circular-cross-section/`applyWrapUv` tests continue to pass unmodified
  (locks that these fixes did not change the object's overall size or the U-axis wrap behavior).

Browser verification (screenshots) against the four reference images from human review: Mug 45°, Mug
back (handle visible), Tumbler (the angle that previously showed duplicated artwork), Bottle.

## Commit message

```text
fix(preview3d): correct mug/handle/tumbler-duplicate/bottle geometry defects (RS-1006A)
```
