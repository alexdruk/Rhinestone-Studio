# Task

**Task ID:** S-109
**Task Type:** SVG Object Preview Projection Consistency
**Specification:** `docs/specifications/S-109-SvgObjectPreviewProjectionConsistency.md`
**Status:** IMPLEMENTED
**Branch:** feature/s-109-svg-object-preview-projection-consistency

## Goal

Imported SVG designs were correctly shown on the 2D Canvas but projected incorrectly on the Object
Preview. Whatever the user sees on the 2D Canvas should appear consistently on the Object Preview,
subject only to the normal cylindrical perspective — same position, scale, orientation, and
proportions.

## Required Outcome

See `docs/specifications/S-109-SvgObjectPreviewProjectionConsistency.md` in full. Summary:

* Audit-first: walked SVG parsing (`src/svg/**`), SVG-to-StoneLayout generation
  (`GeometryEngine.generateSvgLayout()`), layer-bounds calculation (`app.js`'s `getLayerBBox()`),
  transform handling (`src/svg/SvgTransform.js`), and Object Preview texture generation
  (`src/preview3d/StoneLayoutTexture.js`/`ObjectGeometryBuilder.js`) before writing any code.
  Confirmed via direct Node testing and real-browser (Playwright) testing that SVG's geometry math
  is correct and that `src/renderer/**`/`src/preview3d/**` are genuinely layer-type-agnostic —
  empirically reproduced the identical distortion with a plain Rectangle shape layer in the same
  placement box, proving the defect was never SVG-specific.
* **Root cause** (confirmed with the human project owner before implementing, since it reverses a
  previously-approved decision): `src/preview3d/ObjectGeometryBuilder.js`'s `applyAzimuthUv()`
  compressed the *entire* production canvas into the current wrap mode's angular window (e.g. 70°
  for Mug's default `front` mode, vs. a true 360°) instead of mapping mm position to azimuth at the
  object's true, wrap-mode-independent circumference scale — an X-only aspect distortion (~5.1x too
  narrow at `front`) affecting every layer type identically, most visually obvious on SVG/shape
  content. This was deliberate, already-shipped, already-reviewed behavior (see
  `docs/specifications/S-107-LongTextReadability.md`, Part 4, commit `a6b88b4`), which this
  milestone's explicit "2D and Preview must agree, subject only to cylindrical perspective"
  requirement supersedes.
* `src/preview3d/ObjectGeometryBuilder.js`: `applyAzimuthUv()` now maps `U = 0.5 +
  azimuth/(2*PI)` (true circumference scale, matching `ObjectDimensions.js`'s own
  `canvasXMmForAzimuthRad()` model), computed once inside `buildObjectMesh()` instead of being
  re-invoked per wrap-mode change. `applyWrapUv()` is removed (nothing left for it to do).
* `src/preview3d/Preview3DRenderer.js`: `update()` no longer accepts/uses a `wrap` option.
* `app.js`: `drawCup()` no longer passes `wrap` to `preview3D.update()` (one line). The Front View
  Frame, printable-circumference validation, and the `#wrap` control are all unchanged — wrap mode
  keeps every other documented effect, it just no longer rescales the Object Preview's texture.
* No SVG-specific rendering code was added anywhere; the fix is entirely inside the shared
  `src/preview3d/**` pipeline every layer type already flows through.

## Rules

* Follow `docs/AI_ENGINEER.md`, `docs/CLAUDE_GUIDE.md`, `docs/ARCHITECTURE.md`,
  `docs/MILESTONE_WORKFLOW.md`.
* Repository is the source of truth; audit before implementing; do not guess; do not add
  SVG-specific rendering hacks.
* Do not change `GeometryEngine`, `StoneLayout`, the project schema, exporters, or
  wrap-mode configuration (`WRAP_ANGLE_DEG`, the Front View Frame's own drag/sizing logic). Only
  correct the inconsistent projection — and only for its shared root cause, not an SVG-only patch.
* If the audit reveals another layer type suffers the same defect, fix the shared root cause rather
  than only SVG — confirmed true here (Rectangle/text shared the exact same defect).

## Deliverables

* `src/preview3d/ObjectGeometryBuilder.js`/`Preview3DRenderer.js` — true-scale, wrap-mode-independent
  object mesh texture UV mapping.
* `app.js` — one-line `drawCup()` update (no `wrap` passed to `preview3D.update()`); no other change.
* `tools/test-object-geometry-builder.mjs`, `tools/test-s107-long-text-readability.mjs` —
  updated/rewritten checks for the new wrap-independent UV behavior; dark-band/apex regression guards
  (S-107 Part 4) kept unchanged.
* `docs/specifications/S-109-SvgObjectPreviewProjectionConsistency.md` — full audit findings, root
  cause, decision, and implementation record.
* `npm test` passing in full (792/792 checks, 0 failures).
* Real-browser verification (headless Chromium via Playwright): SVG (simple + multi-path) and the
  default text layer on Mug/Tumbler/Bottle at all four wrap modes; save/load round trip; zero
  console errors — before/after comparisons recorded in `TASK_RESULT.md`.
* `TASK_RESULT.md` completed.
* Feature branch pushed (not merged).
