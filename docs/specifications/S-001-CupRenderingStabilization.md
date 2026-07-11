# S-001 — Cup Rendering & 3D Preview Stabilization

## Objective

Fix three related visual defects in the cup/mug preview (`src/renderer/CupRenderer.js`) without
changing `GeometryEngine`, `StoneLayout`, or export architecture:

1. **S-001** — the cup handle looks detached, twisted, and unrealistically thick/flat.
2. **S-002** — rotating the cup only visibly moves the handle's opacity/bulge and the stones; the
   body silhouette never appears to participate in the rotation.
3. **S-003** — the Front/Left/Right/Back view buttons do not stay visually synchronized with the
   actual rotation (manual drag or slider never updates which button looks "active").

This is a stabilization milestone: fix exactly these defects, add regression tests, and leave
`GeometryEngine`/`StoneLayout`/exporters/SVG import/text/shape generation untouched.

## Current Repository State

* `src/renderer/CupRenderer.js` draws a schematic tapered-cylinder cup body (a fixed trapezoid
  silhouette, rotation-invariant by construction — true for any real right-cylinder/frustum viewed
  from any azimuth around its own vertical axis) plus a separate `drawHandle()` loop and the
  wrap-mode stone placement.
* The handle is anchored to the wall at both ends via `wallHalfWidthAt()` (correct tapered-wall
  attachment, kept), but it never moves in screen space: its `x` position is always
  `cx + wallHalfWidthAt(...)` (fixed right flank). Only its `opacity` (`presence`, a smoothstep of
  `cos(rotationDeg)`) and `bulge` magnitude (`0.45 + 0.55*presence`) respond to rotation. This is
  the direct cause of S-001 (it reads as a floating, fading decal rather than a solid 3D handle
  that is part of the cup) and S-002 (nothing about the handle's *position* changes, so the only
  things that visibly sweep across the cup are the stones).
* Stones already rotate correctly: `theta = ((st.xMm - center)/width)*maxTheta + rot` where
  `rot = rotationDeg * Math.PI/180`. This formula is the existing, tested rotation convention for
  this renderer and is not changed by this milestone.
* `app.js`'s view buttons (`.viewBtn`, `data-view="0|-90|90|180"` for Front/Left/Right/Back) set
  `rotation` and call `updateAll()`, which calls `drawCup()`. Only the Front button carries a
  hardcoded `primary` CSS class (dark highlight) in `index.html`; nothing in `app.js` ever adds or
  removes `primary` from any `.viewBtn` after that, for view-button clicks, `resetView`, the
  rotation slider, or manual cup-canvas drag rotation. This is the direct cause of S-003.
* `tools/test-ux-visual-polish.mjs` test 8 already asserts the handle's wall-attachment x sweeps
  continuously (no discrete jump) across a full rotation sweep — this milestone must keep that test
  passing (it is a valid, still-relevant regression guard) while fixing the underlying visual bug
  the comments in that test describe as already fixed; in fact the "opacity fade, fixed screen
  position" design it validates is exactly what needs replacing with a real positional sweep.

## Expected Visible Change

* The handle visibly swings around the cup as `rotation` changes: hidden (occluded by the body)
  directly behind the cup at Front view, in full side profile at Left/Right view, and fully visible
  in front of the body at Back view — continuously, with no jump at any intermediate angle,
  including 45°/135°.
* The handle's attachment to the wall at both ends is always exact (reuses the existing
  `wallHalfWidthAt()` tapered-wall interpolation), with no visible seam, gap, or twist at any angle.
* Clicking Front/Left/Right/Back highlights that button (and only that button); dragging the cup or
  moving the rotation slider away from an exact view angle clears all four highlights; returning to
  an exact view angle (by drag or slider) re-highlights the matching button.
* No change to stone placement, wrap-mode culling, cup body color/shading, zoom, or any exported
  file.

## Required Outcome / Design

### CupRenderer.js — handle redesign

Replace the fixed-flank, opacity-faded handle with a handle whose 3D azimuth is
`theta = HANDLE_AZIMUTH_RAD + rot` (`HANDLE_AZIMUTH_RAD = Math.PI`, i.e. the handle is mounted
opposite the front-facing design, matching a real mug, and reuses the exact same `rot` term the
stones already use — this is what keeps body/stones/handle synchronized under one rotation value).

From `theta`, derive two continuous, signed factors:

* `sideFactor = Math.sin(theta)` — screen-space (`x`) attachment offset and bulge direction/
  magnitude.
* `depthFactor = Math.cos(theta)` — which side of the body the handle is facing: `> 0` means facing
  the camera (draw the handle after/over the body fill), `<= 0` means facing away (draw it before/
  under the body fill, so the wall naturally occludes the overlapping portion — real depth
  ordering, not an opacity hack).

Both wall-attachment `x` positions and the outward bulge scale directly and only by `sideFactor`
(signed, not `Math.abs`), so the whole shape — attachment points, outer bulge, inner bulge, the
thin "inner edge" offset — passes through one consistent continuous deformation: full profile "D"
loop at Left/Right (`|sideFactor| = 1`), smoothly thinning to an edge-on sliver exactly at Front/
Back (`sideFactor = 0`, where `depthFactor = ±1` and the loop is either fully hidden behind the wall
or reduced to a thin front-facing ring — both physically correct for a true 3D handle viewed exactly
along its own mounting axis). No opacity fade, `smoothstep`, or discrete side-flip branch remains;
z-ordering is the only discrete choice, and it is proven visually seamless because `sideFactor` and
`depthFactor` are 90° out of phase — the draw-order switch (at `depthFactor = 0`) always coincides
with maximum `|sideFactor|` (handle fully clear of the body silhouette), so switching which side of
the body fill it's drawn on is never visible as a pop.

This directly fixes:

* **S-001** — attachment is always exact (same `wallHalfWidthAt()` interpolation as before, now
  actually load-bearing at every angle instead of only the one fixed flank); no floating (the loop
  is either occluded correctly or fully attached, never semi-transparent and detached); no twisting
  (inner/outer offsets share one sign, so the bezier control points never cross); thickness and
  perspective read as a real 3D loop because the bulge itself is a believable foreshortening
  function of viewing angle instead of a constant.
* **S-002** — the handle is now a real azimuthally-anchored 3D feature of the cup body (not a
  separately-faded decal), so it — together with the already-correct stone sweep — reads as the
  whole cup turning. (Note: a true right-cylinder/frustum body silhouette is, by definition,
  rotation-invariant around its own vertical axis under a fixed camera — rotating a real cylindrical
  mug does not change its outline. Faking a silhouette change, or animating the shading/sheen
  independent of any real surface feature, would be a visual hack the milestone brief explicitly
  disallows. The body's silhouette is therefore intentionally left unchanged; the handle fix is what
  makes the rotation of the *object* legible, matching how a real mug actually looks when spun.)

### app.js — view button synchronization (S-003)

Add a small helper that compares the current `rotation` against each `.viewBtn`'s `data-view`
(mod-360-aware, since `rotation` is clamped to `-180..180` and `180`/`-180` are the same physical
angle as `Back`) within a small epsilon, and toggles the `primary` class accordingly. Call it from
inside `updateAll()`, so it runs after every path that can change `rotation`: view-button clicks,
`resetView`, the rotation slider's `input` handler, and manual cup-drag rotation — one function, one
call site, always in sync, no per-call-site duplication.

## Architecture Requirements

* No change to `src/geometry/**`, `src/core/**`, `src/text/**`, `src/fonts/**`, `src/svg/**`,
  `src/export/**`, `src/browser/**`, `src/history/**`.
* `src/renderer/CupRenderer.js` and `src/renderer/CanvasRenderer2D.js` remain `StoneLayout`-only
  (no `Project`/`Layer`/layer-type/`GeometryEngine` reference) — unchanged constraint, re-verified
  by the existing guard test.
* No new dependency; no bundler; pure Canvas 2D + trigonometry.
* `StoneLayout` generation remains deterministic and untouched — this milestone only changes how an
  already-generated `StoneLayout` is drawn onto the cup canvas.

## Allowed Files

* `src/renderer/CupRenderer.js`
* `app.js`, `index.html` (view-button sync only; no unrelated UI change)
* `tools/**` (new/updated tests only)
* `docs/specifications/S-001-CupRenderingStabilization.md`, `docs/ARCHITECTURE.md`
* `TASK.md`, `TASK_RESULT.md`

## Forbidden Files

* `src/geometry/**`, `src/core/**`, `src/text/**`, `src/fonts/**`, `src/svg/**`, `src/export/**`,
  `src/browser/**`, `src/history/**`, `src/renderer/CanvasRenderer2D.js`, `src/renderer/StoneColors.js`
* `assets/**`, `examples/**`
* `style.css`, `README.md`, `LICENSE`, `CONTRIBUTING.md`
* `node_modules/**`

## Out of Scope

* Any new 3D/WebGL renderer (the milestone brief permits replacing `CupRenderer`'s implementation if
  needed; a 2D-canvas trigonometric redesign is sufficient and keeps the existing dependency-free,
  DOM-free renderer contract intact — no rewrite to a new rendering technology was needed or done).
* New view angles/buttons (45°/135° are verified via the existing rotation slider, not new buttons).
* Changing the rotation-to-screen-direction convention for stones (`theta = ... + rot`) — unchanged,
  reused as-is for synchronization.
* Product-plugin system, DXF export, manufacturing reports, per-layer rotation — unrelated backlog
  items.

## Required Automated Tests

Update `tools/test-ux-visual-polish.mjs` test 8 only if its assumptions about *how* the handle fades
no longer hold (they should still hold structurally — see Design). Add a new
`tools/test-cup-rotation-stabilization.mjs` covering:

1. `renderCup` never throws across a full `-180..180` rotation sweep (5° steps), both zoom extremes,
   all four wrap modes (extends existing coverage with a finer step).
2. The handle's wall-attachment point sweeps continuously with rotation: no single-step jump greater
   than a small pixel threshold across 5° steps, for a full sweep (regression guard, independent of
   `test-ux-visual-polish.mjs`'s own version of this check).
3. The handle attachment is *signed*/bidirectional: at some rotation the attachment x is measurably
   left of center, and at another measurably right of center (proves the fixed-flank bug is gone —
   the old implementation could never produce an attachment left of center).
4. The handle and the stone sweep move in the same rotational sense (both driven by the same `rot`
   term) — a structural/source check that `HANDLE_AZIMUTH_RAD`-based `theta` uses `+ rot`, matching
   the stones' `+ rot`.
5. `app.js` structural checks: a named view-button-sync function/helper exists and is called from
   `updateAll()`; it is not called only from the view-button click handler (so drag/slider rotation
   also re-syncs it).
6. `app.js`/CupRenderer remain `StoneLayout`-only (re-run of the existing guard, extended to any new
   helper).
7. No forbidden file changed.

Run `npm test` (all suites) and confirm no regression.

## Required Browser Verification

Run `npm run dev` and drive `http://localhost:5173/` with a from-scratch CDP driver (headless Chrome,
matching the RS-1001/RS-1002 precedent):

* [ ] Front (0°): handle not visible (correctly hidden behind the body); Front button highlighted.
* [ ] Left (-90°): handle visible in full side profile; Left button highlighted, others not.
* [ ] Right (90°): handle visible in full side profile on the mirrored side; Right button
      highlighted.
* [ ] Back (180°): handle fully visible in front of the body; Back button highlighted.
* [ ] 45° and 135° (via the rotation slider): handle at an intermediate, believable position/size
      between the adjacent view states; no view button highlighted (none match within epsilon).
* [ ] Manual drag rotation: dragging the cup preview rotates the handle+stones together smoothly, no
      jump; view button highlight updates live as the dragged angle crosses each exact view angle,
      and clears when between angles.
* [ ] Zoom: handle and body scale together at both zoom extremes without visual break.
* [ ] Light cup color and dark cup color: handle shading remains readable against both.
* [ ] No console error / uncaught exception throughout.

Capture screenshots for: front, left, right, back, 45°, 135°.

Record actual observed behavior in `TASK_RESULT.md`. Do not claim unperformed checks as passing.

## Acceptance Criteria

- [ ] `npm test` passes, including new/updated suites.
- [ ] Handle is visibly attached (no floating/seam), not twisted, believable thickness/perspective at
      every verified angle.
- [ ] Handle and body/stones rotate together; no visual hack (opacity-only fade) remains.
- [ ] Front/Left/Right/Back buttons work and stay synchronized with manual rotation.
- [ ] No forbidden file changed; no geometry/export schema changed.

## Implementation Constraints

* Smallest coherent change: rewrite only `drawHandle()`/its geometry inputs inside
  `src/renderer/CupRenderer.js`, plus one small `app.js` sync helper. No change to body silhouette
  drawing, stone placement, zoom, or color logic.
* No new dependency, no bundler.
* Preserve `renderCup()`'s existing signature and StoneLayout-only contract.

## Required Commands

```bash
npm test
git diff --check
git status
npm run dev
```

## Commit Message

```
fix(cup): stabilize handle attachment/rotation and sync 3D view buttons
```

## Deliverables

* Updated `src/renderer/CupRenderer.js` (handle redesign).
* Updated `app.js` (view-button synchronization helper).
* New `tools/test-cup-rotation-stabilization.mjs`; `package.json` test script updated to include it.
* This specification, `TASK.md`, `TASK_RESULT.md`, `docs/ARCHITECTURE.md` updates.

## Next Milestone

Candidates: curved text, multi-object support/grouping, per-layer rotation, migrating `app.js`'s ad
hoc project/layer objects onto `src/core/Project`/`Layer`.
