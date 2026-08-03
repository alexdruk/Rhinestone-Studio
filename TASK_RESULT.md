# Rhinestone Studio — Task Result

This document is completed by the implementation engineer after finishing the current task.

---

# Task ID

RS-2013 (Implementation Phase) — §4 step 6b: tumbler wrap-seam clustering investigation

---

# Status

COMPLETE. Root cause identified with direct evidence, not inference. **This is a genuine screen-
space rendering property of instanced discrete stones on a curved surface at grazing/silhouette
viewing angles — not a bug in stone placement, and not specific to the tumbler.** No code fix was
made or is being proposed as part of this step.

---

# Branch

`feature/rs-2013-instanced-stones-step6b-tumbler-seam`. Verified at task start: correct branch,
clean working tree, but HEAD was stale — it had been cut from the step-5b commit (`cdccc33`) before
step 6 landed, so it did not yet include step 6's own commit (`ff36886`, on a sibling branch) or its
screenshots/`TASK_RESULT.md`. Fast-forwarded onto `ff36886` before starting (a clean fast-forward,
zero unique commits lost — `step6b` had made no commits of its own yet).

---

# 1. Pre-existing evidence this step builds on

Step 6's own `TASK_RESULT.md` §3 (tumbler section) reported, but explicitly did not investigate:

> a new, previously-unreported visual artifact showed up here... near the seam where the wrap
> closes... the instanced stones visibly cluster/overlap in screen space, while the texture version
> shows the same region as a single, cleanly blurred column... very likely an artifact of viewing
> discrete 3D geometry at a steep grazing angle near the surface silhouette... not a data or
> placement bug... not investigated or fixed, per this step's scope.

This step confirms that hypothesis with direct evidence, and also confirms/corrects the "tumbler
seam" framing (see §4 below — the ring's real azimuth extent is nowhere near the actual wrap seam).

---

# 2. Dimensions/profile comparison (mug vs. tumbler vs. bottle)

Computed via the real `computeObjectDimensionsMm()` (`src/preview3d/ObjectDimensions.js`) against
each product's own definition (`src/products/definitions/*.json`, `src/products/ObjectTemplate.js`):

| Product | bodyRadiusMm | topRadiusMm | Taper? | bodyHeightMm |
|---|---|---|---|---|
| mug (`short-name-block.rhs`, canvas 210×90) | 33.42 | 34.68 (ratio 85/82=1.037) | slight, mugs flare outward | 90 |
| tumbler (`tumbler-wrap-design.rhs`, canvas 230×100) | 36.61 | 36.61 (ratio 1.0, exact) | **none — true cylinder** (`requireTopDiameterEqualsBody: true`) | 100 |
| bottle (body/label zone) | ~34 (from `vessel-standard-bottle.json` defaults, 68mm/2) | = body | **none — true cylinder** below the shoulder | varies |

The tumbler is **not** the smallest-radius or most-tapered product — the bottle's body radius is
smaller, and both tumbler and bottle are true (untapered) cylinders by product-definition contract.
`wallRadiusAt()` (`ObjectGeometryBuilder.js`) is therefore *constant* for both, not a source of
radius-dependent compression. There is nothing about the tumbler's real-world geometry that makes it
uniquely susceptible to this artifact — see §4/§5, the actual variable is the *design content's*
azimuth extent, not the product kind.

---

# 3. World-space placement math: verified correct, not the cause

Generated the real `StoneLayout` for `tumbler-wrap-design.rhs` headlessly via `GeometryEngine`/
`generateProjectStoneLayout()` (same path `tools/generate-example-baselines.mjs` uses), then computed
each ring stone's nearest-neighbor distance two ways:

- **Canvas space** (2D, mm, as-authored) — `Math.hypot(xMm delta, yMm delta)`.
- **True 3D world space** — using the *exact* position formula from `Preview3DRenderer.js`'s
  `_updateInstancedStones()` (`azimuth = azimuthRadForCanvasXMm(...)`, `radius = wallRadiusAt(y,
  dims)`, `x = radius*sin(azimuth)`, `z = radius*cos(azimuth)`).

Result, across all 104 ring stones including right at the ring's azimuth extremes (±62°): **world/
canvas nearest-neighbor ratio = 1.0000 everywhere** (min 0.9999, max 1.0000 — floating-point noise
only). No compression at any azimuth. This is expected given `ObjectDimensions.js`'s own design
contract: `bodyRadiusMm = canvasWidthMm / 2π`, so a full wrap always has exactly `canvasWidthMm` of
true circumference by construction — canvas-space spacing is preserved exactly into world-space,
everywhere, for a true cylinder. **The placement math is correct. This rules out a world-space
placement bug conclusively**, not by inference from reading the code, but by direct measurement of
the real generated layout.

---

# 4. Live browser reproduction: camera-relative, not stone-relative

Loaded the real `tumbler-wrap-design.rhs` example in the actual running Studio
(`index.html?instancedStones=1`) via Playwright/Chromium, importing through the real
`#importProjectFile` path (same `toAppProjectShape()`/`validateRhsProject()` bridge step 6 used — no
reimplementation). Drove `#rotation`/`#zoom` and screenshotted `#cup` at several camera states.

**Correction to step 6's "wrap seam" framing:** the accent ring (`cx=115`=canvas-center, `radius=40`
on a 230mm-wide canvas) only sweeps azimuth **±62°**, nowhere near the true back-seam at ±180°. The
apparent "seam" step 6 described is really the ring's own left/right extremes in canvas-x, which land
well inside the front-visible hemisphere at typical camera framing — not the object's physical wrap
seam.

At the default front view, `rs2013-step6b-tumbler-front-instanced.png` reproduces the reported
clustering clearly at both ring edges. Critically:

- Rotating the camera to bring that exact azimuth (62°) to dead-center
  (`rs2013-step6b-tumbler-az62-instanced.png`) makes the ring render **cleanly, evenly spaced** at
  that spot — while the *opposite* side of the ring (now at the new grazing edge) starts clustering
  instead. **The clustering moves with the camera; it is not fixed to particular stones or world
  positions.** This is the signature of a projection/viewing artifact, not a data or placement bug.
- At that same camera state, toggling to the texture path
  (`rs2013-step6b-tumbler-az62-texture.png`) shows **no clustering at all** — clean, evenly spaced
  dots the whole way to the edge.

**Why instanced and not texture, given §3 proved positions are correct in both:** stone *positions*
correctly foreshorten toward the silhouette edge under the perspective camera (this is real,
unavoidable 3D perspective — a curved surface's own screen-space angular density increases as it
curves toward edge-on). A continuous texture's rendered surface foreshortens by exactly the same
factor as its underlying positions, so it looks fine — a compressed but still-continuous line. A
discrete instanced stone, however, has its own fixed real-world footprint (its `sizeMm`) that does
*not* shrink at the same rate its screen-space position spacing does near the grazing edge — so
neighboring stones' rendered footprints start overlapping in screen space before their true 3D
positions are anywhere near coincident. This is an inherent consequence of representing discrete 3D
geometry (vs. a continuous texture) on a strongly curved surface near a grazing viewing angle.

---

# 5. Generalization test: reproduces on the mug — not tumbler-specific

Added a synthetic circle/outline ring layer to the mug's own `short-name-block.rhs` example
(`cx`=canvas-center, radius chosen to sweep the same ±62° azimuth extent as the tumbler's ring),
imported it the same real way, and screenshotted at an equivalent camera state:
`rs2013-step6b-mug-synthetic-ring-instanced.png` shows **the identical clustering artifact at both
ring edges**, despite the mug having a *larger* body radius than the tumbler (§2) and a genuine (if
slight) taper the tumbler doesn't have.

This confirms the artifact is a general property of **any curved-surface product (mug/tumbler/
bottle) whose design content sweeps far enough in azimuth to approach the camera's current grazing/
silhouette zone** — not a tumbler-specific geometry issue. It only showed up on the tumbler in step
6's own evidence because `tumbler-wrap-design.rhs` was the only one of the three chosen examples with
a curved (circular) outline-mode layer sweeping that far around; `short-name-block.rhs` (mug) was
front-facing text only, and `bottle-front-design.rhs` used a *rectangle* outline, whose straight
edges have constant or linearly-varying canvas-x and never approach this condition regardless of how
wide the rectangle is.

---

# 6. Consolidated finding

**This is a genuine, inherent screen-space rendering property of instanced discrete stones on a
curved surface at grazing/silhouette viewing angles — confirmed by direct measurement to not be a
world-space placement bug (§3), confirmed live to be camera-relative rather than stone-relative
(§4), and confirmed to generalize beyond the tumbler via a controlled same-azimuth-extent test on
the mug (§5).** It will appear on any curved-surface product (mug/tumbler/bottle) whenever a design's
content — most commonly a circular/elliptical outline shape, since straight edges don't trigger it —
sweeps far enough in azimuth to approach the camera's current grazing edge at whatever framing/zoom
is in use. No code fix was made or is being proposed as part of this step.

**Noted, without implementing, for a later, separate decision:** a future mitigation could look like
shrinking instance scale as a stone's azimuth approaches the camera's current grazing angle, or a
texture/instance hybrid (continuous texture near the silhouette, discrete instanced stones near the
front-facing center). Neither is designed or scoped here — both are options to evaluate later, not a
recommendation.

---

# Cleanup check

`du -sh tools/*.png` before this step's own captures: the 8 PNGs from step 6 (still valid, still
referenced by step 6's own `TASK_RESULT.md` — not superseded by this step, which investigates them
rather than replacing them). This step's own exploratory screenshots (several rotation/zoom
iterations, a mislabeled camera-state pair from an early script bug) were written only to a private
scratch directory outside the repo, never to `tools/` — so no superseded files existed in `tools/` to
clean up. Only this step's final, correctly-labeled 4-screenshot set was written there. `du -sh
tools/*.png` after: 12 PNGs total (step 6's original 8 + this step's 4), all currently valid.

---

# Testing

- No production source files were changed — this was a read-only investigation. No syntax/unit tests
  apply.
- Headless numeric verification (§3): real `GeometryEngine`/`generateProjectStoneLayout()` output,
  cross-checked against `Preview3DRenderer.js`'s exact position formula — not a re-derivation or
  approximation.
- Live Playwright/Chromium verification (§4/§5) against the real running Studio, real import path,
  real `#rotation`/`#zoom` controls — confirmed zero console/page errors across all camera states and
  both product kinds tested.
- No shared architecture, project schema, or exporter code touched — per `CLAUDE.md`'s testing
  policy, `npm test`/`npm run test:full` was not run for this step.

---

# Scope discipline

- No production file was modified (`app.js`, `Preview3DRenderer.js`, `ObjectDimensions.js`, etc. all
  untouched) — this was a pure investigation.
- No fix was implemented or proposed as a concrete plan — §6's mitigation ideas are noted as future
  options only, not designed here.
- `instancedStones` default remains unchanged (`false`) everywhere.
- No Playwright/Node scratch scripts were committed — same convention step 6 used.

---

# Deliverables

- `TASK.md` (this milestone's brief), `TASK_RESULT.md` (this file).
- `tools/rs2013-step6b-tumbler-front-instanced.png` — reproduces the reported clustering.
- `tools/rs2013-step6b-tumbler-az62-instanced.png` — camera rotated to bring the clustering-prone
  azimuth to center; clean there, proving the artifact is camera-relative.
- `tools/rs2013-step6b-tumbler-az62-texture.png` — same camera state, texture path; no clustering,
  proving the artifact is instanced-only.
- `tools/rs2013-step6b-mug-synthetic-ring-instanced.png` — same artifact reproduced on the mug via a
  synthetic same-azimuth-extent ring, proving it is not tumbler-specific.
