# Rhinestone Studio — Task Result

This document is completed by the implementation engineer after finishing the current task.

---

# Task ID

S-109 — SVG Object Preview Projection Consistency

---

# Status

IMPLEMENTED

---

# Branch

feature/s-109-svg-object-preview-projection-consistency (cut from `develop`, per this milestone's
"do not merge" instruction).

---

# Commit

Do not write the current commit hash into this file — this file is part of the same commit it
describes. Obtain it from Git history with:

```bash
git log -1 --oneline
```

---

# Audit Findings

Full detail is in `docs/specifications/S-109-SvgObjectPreviewProjectionConsistency.md`. Summary:

1. **Walked the full SVG pipeline** — `src/svg/SvgDocumentParser.js`/`SvgTransform.js` (parsing,
   viewBox/unit normalization, `<g>` transform composition) → `GeometryEngine.generateSvgLayout()`
   (placement, flattening, sampling) → merged `StoneLayout` → `CanvasRenderer2D.js` (2D) /
   `StoneLayoutTexture.js`+`ObjectGeometryBuilder.js` (Object Preview). Confirmed by direct code
   reading and a direct Node.js call to `GeometryEngine.generateSvgLayout()` that SVG's placement
   math produces a numerically correct stone bounding box for a known input.
2. **Confirmed `src/renderer/**`/`src/preview3d/**` are genuinely layer-type-agnostic** — neither
   references `Project`, `Layer`, or a layer `type` string (matches `docs/ARCHITECTURE.md`'s own
   claim); both consume only the one merged `StoneLayout` `app.js`'s `updateAll()` builds once per
   generation.
3. **Empirically disproved "SVG-specific"**: reproduced the identical distortion (extreme,
   wrap-mode-dependent horizontal compression) on the Object Preview using a plain **Rectangle**
   shape layer placed in the exact same `x/y/w/h` box as an imported SVG triangle — screenshots were
   qualitatively identical. Also reproduced it on the default project's **text** layer. This ruled
   out every SVG-only code path.
4. **Root-caused to `ObjectGeometryBuilder.js`'s `applyAzimuthUv()`**, which compressed the *entire*
   production canvas into the selected wrap mode's angular window (`wrapAngleRad(wrapMode)`, e.g. 70°
   for Mug's default `front` mode) instead of the object's true 360° circumference — an X-only aspect
   distortion (~5.1x too narrow at `front`, ~1.2x even at `full`) that Y (`applyBodyHeightUv()`) never
   shared. This behavior was deliberate and had already been explicitly reviewed and approved: see
   `docs/specifications/S-107-LongTextReadability.md` Part 4 ("Decision: Restore wrap-mode-dependent
   windowing"), commit `a6b88b4`.
5. **This finding was surfaced to the human project owner before any code change**, since fixing it
   means reversing a previously-approved decision and directly touches wrap-mode behavior this
   milestone's own instructions said not to change. Two options were presented: (a) fix the shared
   root cause, updating the two test suites that assert the old wrap-dependent behavior, or (b) leave
   it untouched and keep searching for a narrower SVG-only defect. The owner first chose (b); after a
   second, exhaustive round of audit (multi-path SVG, Mug/Tumbler/Bottle, very wide/tall SVGs, nested
   `<g>` transforms — no further divergence found beyond the same shared defect), the owner reversed
   to (a): fix the shared root cause. Implementation below reflects that final direction.
6. **Secondary, out-of-scope finding**: `isTextTooLongForObject()` (the printable-circumference
   overflow warning) is text-only; SVG/shape/image layers wider than the object's printable
   circumference get no equivalent warning. Documented as a known limitation, not fixed here — no
   requirement of this milestone asked for it, and the milestone's own scope discipline rule ("do not
   add functionality beyond what the specification requires") applies.

---

# Root Cause

See "Root Cause" in `docs/specifications/S-109-SvgObjectPreviewProjectionConsistency.md`. In one
line: the Object Preview's texture UV mapping rescaled the design's X axis by
`360° / wrapAngleRad(wrapMode)` while never touching Y, for every layer type — not a rendering
artifact of cylindrical perspective, an artificial preview-only stylization that this milestone's
"2D and Preview must agree" requirement does not permit.

---

# Architectural Explanation

The single-source-of-truth pipeline (`Project → GeometryEngine → StoneLayout → {2D Canvas, Object
Preview, Exporters}`) was already correctly implemented and untouched by this fix — every layer type,
including SVG, produces one shared `StoneLayout` in millimeters, and both renderers already consumed
it identically. The defect lived entirely inside the Object Preview's own texture-to-mesh UV mapping
(`src/preview3d/ObjectGeometryBuilder.js`), a rendering concern, not a geometry concern — so the fix
required zero changes to `GeometryEngine`, `StoneLayout`, or the project schema. The correct
architectural level for the fix was confirmed by the audit itself: since the defect was reproducible
with any layer type in the same box, it could not be inside anything layer-aware (`app.js`'s
per-type logic, `src/svg/**`), only inside the layer-agnostic rendering pipeline every type shares —
exactly where the fix landed.

---

# Implementation Summary

* **`src/preview3d/ObjectGeometryBuilder.js`**:
  * `applyAzimuthUv(geometry)` (signature changed — no longer takes a `wrapAngleRadValue` parameter)
    now computes `U = 0.5 + azimuth / (2*PI)`, the object's true, wrap-mode-independent circumference
    scale — the same dimensionless `canvasXMm/canvasWidthMm` relation
    `ObjectDimensions.js`'s `canvasXMmForAzimuthRad()` already defines for the Front View Frame, so
    the 2D Canvas and Object Preview now share one mm-to-azimuth model exactly.
  * Called once inside `buildObjectMesh()`, alongside `applyBodyHeightUv()`, since it no longer needs
    to react to wrap-mode changes.
  * `applyWrapUv(bodyMesh, wrapMode)` — removed. Nothing calls it, and there is nothing left for a
    per-wrap-mode UV re-application to do.
  * The azimuth-from-Lathe-column-index math (not `Math.atan2(position)`) and both `LatheGeometry`
    calls' `phiStart=-PI` seam placement — two real, independent dark-vertical-band fixes from S-107
    Part 4 — are byte-identical, unchanged.
* **`src/preview3d/Preview3DRenderer.js`**: `update(stoneLayout, options)` no longer destructures or
  uses `wrap`; the `_wrap` field and `_applyWrapUv` bookkeeping (both only meaningful for the removed
  per-wrap-mode re-application) are removed. `onAzimuthChange`/live-orbit sync is untouched.
* **`app.js`**: `drawCup()`'s call to `preview3D.update()` no longer includes `wrap:project.wrap`
  (one key removed from one object literal). Nothing else in `app.js` changed — the Front View Frame
  drawing/drag/hit-test code, `printableCircumferenceMm()`, `isTextTooLongForObject()`, and the
  `#wrap` `<select>` are all byte-identical to before this milestone.
* No production file outside `src/preview3d/**` and this one line of `app.js` was touched. No
  SVG-specific code was added anywhere.

---

# Files Changed

```
docs/specifications/S-109-SvgObjectPreviewProjectionConsistency.md   (new)
TASK.md                                                                (this milestone)
TASK_RESULT.md                                                        (this file)

src/preview3d/ObjectGeometryBuilder.js   (applyAzimuthUv() true-scale, wrap-independent;
                                           applyWrapUv() removed)
src/preview3d/Preview3DRenderer.js       (update() no longer takes/uses `wrap`)
app.js                                   (drawCup(): `wrap` no longer passed to preview3D.update();
                                           2 comment updates, no other logic change)

tools/test-object-geometry-builder.mjs           (checks 7/8 rewritten for wrap-independent UV;
                                                   8b/8c simplified, same regression coverage)
tools/test-s107-long-text-readability.mjs        (checks 14/15 rewritten; 15b/15c unchanged)
```

---

# Test Results

| Command | Files | Assertions | Result |
|---|---:|---:|---|
| `npm test` | 56 | 792 | **PASS**, 0 failures |

`git diff --check` — clean, no whitespace errors.

---

# Browser Verification

Headless Chromium (Playwright), `python3 -m http.server 5173`, real app, no mocks. Before/after
comparison performed at Mug's default `front` wrap mode — the previously worst-case, ~5.1x
distortion:

1. **Right-triangle SVG import** (asymmetric on both axes, to catch orientation/flip bugs
   independently of scale): **before** — rendered as a nearly-illegible thin sliver, hypotenuse and
   left edge nearly overlapping. **after** — matches the 2D Canvas's shape, orientation
   (right-angle corner position preserved, not flipped/rotated), and proportions exactly, with only
   mild, expected cylindrical bowing.
2. **Multi-path SVG** (a `<g transform="translate(10,10) rotate(15)"><rect></g>`, a `<circle>`, a
   closed `<path>` triangle, and an open `<polyline>`): after the fix, all four shapes' relative
   position/rotation/shape match the 2D Canvas, verified on both Mug and Bottle at `front` wrap.
3. **Default project text layer** ("Vitalina Serbin", the milestone's own worst-case default state):
   before — compressed into overlapping, near-illegible glyphs. After — readable, correctly
   proportioned, at the exact same `front` wrap mode.
4. **Wrap-mode sweep** (`front`/`wide`/`half`/`full`) on the imported triangle: Object Preview
   screenshots are now visually identical across all four modes (texture is wrap-mode independent, as
   intended). The 2D Canvas's Front View Frame width still changes correctly per mode — 40.8mm
   (front) / 67.1mm (wide) / 105.0mm (half) / 175.0mm (full) on the default Mug, unchanged from S-107
   — confirming wrap mode's remaining, intended effects were not disturbed.
5. **Object types**: Mug, Tumbler, Bottle all tested with the multi-path SVG; no clipping, no
   errors, correct rim/shoulder/neck/cap geometry (unchanged, RS-1006A behavior not touched).
6. **Save/load round trip**: exported Project JSON from a project with the multi-path SVG on a
   Bottle, reloaded the page (fresh app state), imported the file back — Object Preview and 2D Canvas
   both rendered identically to before reload.
7. **Very wide (600mm) and very tall (400mm) SVG imports**: both imported without error, auto-scaled
   to fit the canvas on import (aspect-ratio preserved), no crash, no NaN.
8. **Zero console errors, zero page errors** across every step above (verified via Playwright's
   `console`/`pageerror` event listeners on every run, not just visual inspection).

Screenshots were captured to a local scratch directory during this session (not committed to the
repository, consistent with this repository's existing convention of not embedding binary screenshots
in `docs/specifications/**`); this section is the complete verification record.

---

# Known Limitations

* `isTextTooLongForObject()` remains text-only — see Audit Finding 6. Not fixed in this milestone;
  no requirement asked for it, and fixing it would be functionality beyond this milestone's stated
  scope.
* Wrap mode no longer visibly changes the Object Preview's texture at all — only the 2D Canvas's
  Front View Frame. This is the correct, required outcome per this milestone's explicit mandate, but
  it is a real, deliberate behavior change from what S-107 Part 4 shipped and had approved. Flagged
  here for visibility, not because it is considered a defect.

---

# Recommendation

**APPROVE.** The fix is minimal and lands at the correct architectural level: a rewritten UV formula
inside `ObjectGeometryBuilder.js` (plus removing the now-dead `applyWrapUv()` entry point and its two
call sites), with zero changes to `GeometryEngine`, `StoneLayout`, the project schema, any exporter,
or the Front View Frame's own drawing/drag logic. No SVG-specific code exists anywhere in the diff —
consistent with the audit's own finding that the defect was never SVG-specific. Both affected test
suites were rewritten to assert the new, correct behavior; all pre-existing dark-band/seam regression
guards from S-107 Part 4 are preserved unchanged. Real-browser verification confirms the 2D Canvas
and Object Preview now agree on position/scale/orientation/proportions for SVG, shapes, and text
alike, at every wrap mode and object type, subject only to normal cylindrical perspective.

Recommended next milestone (optional, not attempted here — out of this milestone's scope): extend
`isTextTooLongForObject()`'s printable-circumference overflow warning to non-text layer types
(SVG/shape/image), so an oversized imported design gets the same real-manufacturing-limit warning
long text already does.
