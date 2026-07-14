# Task

**Task ID:** S-107
**Task Type:** Front View Frame & Long Text Workflow (Part 3 — supersedes Part 2's warning-only
workflow; Part 1 unchanged)
**Specification:** `docs/specifications/S-107-LongTextReadability.md`
**Status:** IMPLEMENTED
**Branch:** feature/s-107-long-text-readability

## Goal

Replace the current warning-based long-text workflow ("This text is too long to fit legibly on this
object.") with a Front View Frame on the 2D Canvas: a movable overlay showing the portion of the
design currently facing the viewer in the Object Preview, bidirectionally synchronized with the
Object Preview's rotation. A cylindrical object is treated as an unwrapped surface — text that fits
around the object's printable circumference stays valid and inspectable, regardless of the current
viewing angle. A warning is shown only when text genuinely exceeds that circumference — a real
manufacturing limitation, never a viewing-angle artifact.

## Required Outcome

See `docs/specifications/S-107-LongTextReadability.md`, Part 3, in full. Summary:

* Audit-first: walked production-canvas-width-to-circumference, circumference-to-wrap-mode,
  Object-Preview-rotation-to-production-coordinates, and existing-rotation-logic-coverage before
  writing any code. Found that the 3D preview's body radius was anchored at a 180-degree reference
  (canvas = half the circumference), which structurally prevents the canvas's own left/right edges
  from being adjacent points on the object — re-anchored to a full 360-degree reference (canvas *is*
  the complete unwrapped surface, exactly `canvasWidthMm` in circumference) so the Front View Frame
  can wrap continuously across the canvas edges with no discontinuity, per requirement 3.
* `src/preview3d/ObjectDimensions.js`: new pure mm<->azimuth/circumference/frame-width functions,
  reused (not duplicated) by both `ObjectGeometryBuilder.js`'s object-mesh texture UV and `app.js`'s
  Front View Frame — the 2D canvas and Object Preview compute "which part faces the viewer" with the
  literal same code.
* `ObjectGeometryBuilder.js`: the object mesh's texture now always wraps the complete production
  canvas fully and continuously around the object (mm-accurate), never clipped/hidden by wrap mode —
  wrap mode now only sizes the Front View Frame's highlighted width.
* `Preview3DRenderer.js`: new live camera-azimuth read-back (`onAzimuthChange`, via an `OrbitControls`
  `'change'` listener) so a free mouse/touch orbit of the Object Preview moves the Front View Frame,
  not just the reverse.
* `app.js`: draws the frame (visually distinct from the safe-area guide, width shown in mm), makes it
  draggable (rotates the Object Preview), wires the live-orbit callback, and replaces the old
  `maxWidth`-based `isTextTooLongForObject()` with one driven by the object's real printable
  circumference (`getLayerBBox()` vs. `circumferenceMm()`) — reusing the existing `StoneLayout`-backed
  bbox helper, no new bookkeeping map. The warning's copy states real mm numbers and never blames wrap
  mode/viewing angle.
* Never clips/crops/hides the production layout; never changes `GeometryEngine`, `StoneLayout`, any
  exporter's output, physical stone size/gap, or the project schema; no second layout/rendering
  pipeline; no multi-line text.

## Rules

* Follow `docs/AI_ENGINEER.md`, `docs/CLAUDE_GUIDE.md`, `docs/ARCHITECTURE.md`,
  `docs/MILESTONE_WORKFLOW.md`.
* Repository is the source of truth; audit before implementing; do not add functionality beyond what
  the specification requires.
* Do not touch `GeometryEngine`, `StoneLayout`, the project schema, production geometry (stone
  positions), any exporter's existing output, `src/renderer/**`, or introduce a second layout
  pipeline.

## Deliverables

* `src/preview3d/ObjectDimensions.js`/`ObjectGeometryBuilder.js`/`Preview3DRenderer.js`/`index.js` —
  mm-accurate, wrap-independent circumference/azimuth math and live rotation sync.
* `app.js`/`index.html` — the Front View Frame (draw/drag/hit-test), live-orbit sync, Inspector stats
  (Front View width, printable circumference, viewing position), and the corrected long-text warning.
* `tools/test-object-dimensions.mjs`, `tools/test-object-geometry-builder.mjs`,
  `tools/test-s107-long-text-readability.mjs` — updated/rewritten test suites.
* `tools/test-app-module-migration.mjs`, `tools/test-shape-geometry-integration.mjs` — allowlist the
  new `ObjectDimensions.js` import.
* 17 prior-milestone test files — stale `src/preview3d/` forbidden-path guard removed (mechanical
  scoping fix; `src/renderer/` guard, correctly still forbidding this milestone, is untouched).
* `docs/specifications/S-107-LongTextReadability.md` — Part 3 (this milestone's full specification
  and audit findings).
* `npm test` passing in full (904 checks, 0 failures).
* Real-browser verification (headless Chromium via Playwright) of short/medium/long text on
  mug/tumbler/bottle; frame-drag-rotates-preview and orbit-moves-frame in both directions; continuous
  edge-wrap; mm-labeled frame width; circumference-only warning; zero console errors — with
  screenshots.
* `TASK_RESULT.md` completed.
* Feature branch pushed (not merged).
