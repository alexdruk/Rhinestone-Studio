# Rhinestone Studio — Task Result

This document is completed by the implementation engineer after finishing the current task.

---

# Task ID

RS-2013 (Phase A) — Instanced Faceted Stone Rendering: Design & Audit

---

# Status

IMPLEMENTED — design document produced. No application code, test file, or 3D geometry was
written, modified, or generated.

---

# Branch

design/instanced-stone-rendering-audit (cut from `develop` at RC-010's tip, `a42e27c`)

---

# Commit

Do not write the current commit hash into this file — this file is part of the same commit it
describes. Obtain it from Git history with:

```bash
git log -1 --oneline
```

Changes are left staged/unstaged, not committed, per the task instructions.

---

# Summary

Produced `docs/specifications/RS-2013-InstancedFacetedStoneRenderingDesign.md`, a full design/audit
document for replacing the 3D preview's canvas-texture stone layer with real instanced, faceted 3D
geometry. It covers, in order: a corrected premise (see below), a full audit of the current
texture-baking pipeline, an audit of what the 2D crystal-appearance modules can/can't be reused,
a realistic stone-count ceiling, audits (not fixes) of two smaller correctness findings from
`ARCH-REVIEW-001`, a concrete design proposal (geometry, instancing mechanism, placement/
orientation, lighting, color mapping, migration path), and an ordered implementation-sequencing
list for a future milestone.

**Two factual corrections to this phase's own brief were found during the audit and are documented
prominently at the top of the design doc, not silently worked around:**

1. **No prior 3D-stone-geometry rejection history exists in this repository.** The brief asked this
   audit to find spec docs recording rejected "cone geometry, flat-back mesh, outline tracing, and
   skeletonization" attempts at 3D stone rendering. A repo-wide search found none — those terms
   (skeletonization, outline tracing) exist only in the unrelated font-generation program
   (`FONT-GEN-004`, `TXT-101A`, `RS-1008`/`RS-1008A` Image Trace), a 2D glyph/stone-position problem,
   not 3D rendering. `ARCH-REVIEW-001` is the first place instanced/faceted 3D stone geometry is even
   proposed, as explicit future work.
2. **The repository is pinned to Three.js `0.169.0`, not `r128`** as the brief stated — confirmed via
   `package.json`, the installed `node_modules/three/package.json`, `Preview3DRenderer.js`'s own
   inline comment, and `RS-2011-3DPreviewCorrectness.md`'s independent prior audit. The design
   proposal evaluates the actual, current Three.js API (which has had `InstancedMesh`/`instanceColor`
   for years longer than an `r128` pin would have implied) rather than a stale assumption.

---

## 1. Current-state audit (design doc §1)

- **Pipeline**: `Preview3DRenderer.update()` → (on geometry-key change only) `ObjectGeometryBuilder.
  buildObjectMesh()` builds the real, dimension-driven body mesh (untouched, correct — explicitly
  out of scope to touch). On **every** project edit, `_updateTexture()` redraws the *entire* flat
  canvas texture via `StoneLayoutTexture.drawStoneLayoutTexture()`, which loops every stone and calls
  the same `drawCrystalStone()`/`getCrystalAppearance()` the 2D canvas renderer uses — confirmed this
  is the one already-good property of the current design (no separate 3D-specific appearance model
  exists today beyond the fixed px/mm scale and a small material-roughness nudge).
- **Reuse audit**: `CrystalAppearance.js` (per-stone seeded variation) and `CrystalColors.js` (the
  17-color catalog) are pure, DOM-free, already Three.js-agnostic — directly reusable, unchanged, by
  an instanced approach. `CrystalStoneRenderer.js`'s `drawCrystalStone()` itself is **not**
  reusable — it's the 2D-canvas-specific gradient/stroke implementation that real 3D facets replace,
  not wrap.
- **Stone-count ceiling**: `examples/baselines.json`'s largest realistic fixture is 1,161 stones;
  a computed theoretical worst case (300mm plate, SS6 stones, edge-to-edge) lands in the
  11,000-15,000 range — both comfortably within `InstancedMesh` single-draw-call territory and well
  outside per-`Object3D`-per-stone territory.

## 2. Two smaller correctness items — audited, not fixed (design doc §2)

- **Texture wrap mode**: confirmed still `ClampToEdgeWrapping` on both `wrapS`/`wrapT`, exact
  location `src/preview3d/Preview3DRenderer.js:290-291` (`_applyTextureParams()`). Listed as an
  explicit prerequisite finding — not fixed in this phase.
- **`Math.min(...array)`/`Math.max(...array)` spread risk**: grepped exactly as scoped
  (`src/geometry/**`, `src/preview3d/**`, `src/export/**`) — found 5 occurrences, **all bounded by
  small fixed-size arrays (≤7 catalog entries or ≤2 bounding boxes), none touching a per-stone
  array**. A broader sweep of all of `src/`+`app.js` found 3 more occurrences, same conclusion. This
  is a materially more precise finding than `ARCH-REVIEW-001`'s original "worth a grep" framing:
  **the specific risk that report flagged does not currently have a live trigger anywhere in the
  codebase.** Empirically measured this repo's actual Node runtime (`v22.15.0`) throws at exactly
  125,270 array elements for `Math.max(...array)` — cited precisely rather than guessed, and noted
  as ~8x beyond even the theoretical stone-count ceiling from §1.

## 3. Design proposal (design doc §3)

Octahedral-bipyramid geometry (8 tri/stone, built-in `THREE.OctahedronGeometry`) via one
`THREE.InstancedMesh` per stone layer; placement reuses `ObjectDimensions.js`'s already-exported
`azimuthRadForCanvasXMm()` (avoiding the two real `atan2`-branch-cut/signed-zero bugs
`ObjectGeometryBuilder.js`'s own comments document) plus `bodyHeightMm`/`wallRadiusAt()` for radius;
plate case is flat-plane and simpler, recommended first in sequencing. Lighting: extend the existing
2-directional-light rig rather than reach for an HDRI environment map first (cost/benefit argued
explicitly). Color: direct reuse of `CrystalColors.js` via `instanceColor`, no new appearance model.
Migration: a flag-gated coexisting mesh alongside the existing texture path, texture remains default
until visually/perf validated, removed only in the sequencing's last, separate step.

## 4. Implementation sequencing (design doc §4)

8 ordered steps: prerequisite fixes → static test-plane geometry → curved-surface placement
(plate first, then mug/tumbler, then bottle) → lighting → flag-gated integration → stone-count
stress testing (closing a real test-coverage gap identified in §1) → visual validation & default
flip → old-path removal.

---

# Files changed

- `docs/specifications/RS-2013-InstancedFacetedStoneRenderingDesign.md` (new)
- `TASK.md` (rewritten for this phase)
- `TASK_RESULT.md` (this file)

No file under `src/**`, `app.js`, `index.html`, or any test file was touched.

---

# Tests run

None. Per `AI_ENGINEER.md`'s testing policy, this phase made zero application-code changes, so no
test run is required or meaningful.

---

# Test result

Not applicable — no tests run, no code changed.

---

# Visible change

None — documentation only.

---

# QA result

Not applicable — no browser/manual verification is meaningful for a documentation-only phase.
Verified instead: `git status`/`git diff --check` (clean except the three allowed files);
`docs/specifications/RS-2013-*.md` addresses every numbered requirement in the phase brief (§1-§4,
plus the pre-existing correctness items and the naming-convention check).

---

# Notes / warnings

- Two factual premises in this phase's own brief did not match the repository (see Summary above)
  and are documented, corrected, and explained in the design doc itself rather than silently
  adjusted — flagging this explicitly per `CLAUDE.md`'s "Repository Is The Source Of Truth" rule.
- The design doc's §2 correctness-item audits (texture wrap mode, `Math.min`/`Math.max`) are
  intentionally **not fixed** here, per this phase's explicit scope — they are listed as
  prerequisite/defensive-coding findings for the future implementation phase to act on.
- `RS-2013` was confirmed as the correct next milestone id: `RS-2012` is the highest `RS-20xx` id
  currently used in `docs/specifications/`/git history; no `RS-2013` reference exists anywhere in
  the repo prior to this document.
- **Addendum (review feedback)**: added a CPU-side instance-buffer-rebuild cost paragraph to §3.2
  (the per-`update()` `Matrix4`/`Color` rebuild loop firing on every project edit, including
  un-throttled `pointermove` drags per `app.js:1366`, citing the existing `AUTOSAVE_DEBOUNCE_MS`
  precedent as a mitigation pattern to consider) and a one-sentence interactive-vs-static frame-
  timing clarification to §4 step 5 — this was a genuine gap in the original GPU-only budgeting, not
  covered by the initial audit.

---

# Next recommended step

Implementation Phase (a separate milestone, or several, per the design doc's §4 sequencing) —
starting with §4 step 0 (the two small prerequisite correctness fixes, independent of everything
else) and step 1 (static instanced geometry on a flat test plane, the cheapest possible visual
checkpoint before any curved-surface placement work begins).

---

# Terminal output

```
$ git branch --show-current
design/instanced-stone-rendering-audit

$ git status
On branch design/instanced-stone-rendering-audit
Your branch is up to date with 'origin/design/instanced-stone-rendering-audit'.
Changes not staged for commit:
  modified:   TASK.md
  modified:   TASK_RESULT.md
Untracked files:
  docs/specifications/RS-2013-InstancedFacetedStoneRenderingDesign.md

$ git diff --stat
 TASK.md        | ~70 ++++++++++++++++++++------------------
 TASK_RESULT.md | ~180 ++++++++++++++++++++++++-----------------------
```

(No `npm test` run — see "Tests run" above.)
