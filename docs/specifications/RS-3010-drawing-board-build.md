# RS-3010 — Custom Drawing Board: v1 Design & Scope

## Task ID

RS-3010

## Title

Design-and-scope phase for a freeform drawing board that lets users design custom shapes directly
in the canvas, replacing the retired RS-1015 Design Library (`src/library/**`, frozen behind
"Coming Soon" in the UI since RC-006's feature freeze — `index.html`'s `menuLibrary` button).
**This document is the only deliverable of this phase — no implementation.**

## Status

Design approved. Implementation in progress, broken into steps (Step 1 shipped freehand drawing;
Step 2a adds the multi-shape data model, rectangle/ellipse presets, and select/move/delete; Step 2b
adds the slot preset; Step 2c adds the polygon preset). Slot and polygon, originally bundled as one
"Step 2b" scope, were split into their own steps after Step 2a's review: slot reuses rect/ellipse's
drag-to-preview interaction shape (just new arc math), while polygon is a genuinely different
click-to-add-vertex interaction model, and bundling them risked repeating Step 2a's experience of
debugging two unrelated things at once. Step 2b covered slot only; Step 2c covered polygon, the
last of the four v1 presets. Only snapping (Steps 2d/2e) remained before the RS-3010 v1 scope
described in this document would have been complete -- but after Step 2c, Sasha redirected the
next work toward a "Design Step A"-"Design Step E" restructuring of how the whole feature is
presented, described below, before returning to snapping.

Design Steps A-E restructure the drawing board's UI shell -- a Photoshop-style vertical tool rail +
canvas + contextual options panel, replacing the horizontal inline toolbar row Steps 1-2c built --
without changing any of the underlying tool logic those steps already implemented and verified:

- **Design Step A** (shipped): layout shell. Adds the new tool rail, a contextual tool-options
  panel, and a `'select'` tool-mode value. The old horizontal `#drawToolGroup` toolbar row was
  originally meant to stay side by side with the new rail/panel through Step E, but Step A's own
  correction rounds removed it outright instead -- it does not exist in `index.html` at all
  anymore, only explanatory comments mention it. Layout only -- no new interaction behavior beyond
  that removal.
- **Design Step B** (shipped): keyboard shortcuts, per-tool cursor styling, space-held pan.
- **Design Step C** (shipped): marquee select, under the new explicit Select tool.
- **Design Step D** (shipped): pre-commit resize handles on in-progress shapes, mirroring the
  existing `project.layers` resize system.
- **Design Step E** (this step): end-to-end verification. Because the old toolbar row was already
  fully removed during Step A, there was no toolbar-removal work left for this step to do. Instead,
  Step E is the integration pass that drives Design Steps A-D together in one continuous session --
  all four presets, Select, marquee, resize, shortcuts, cursor, space-pan, and commit -- which no
  prior step exercised together, and brings this Status section in line with what actually
  happened. That continuous-session testing surfaced one real bug Step B's own (necessarily
  narrower) verification hadn't: a real multi-tick space-held pan drag (many native mousemove
  events between mousedown and mouseup, the normal case for actual mouse/trackpad input) lost
  roughly half its distance, because the pan handler derived its per-tick delta from Paper.js's own
  `event.point`/`event.delta`, which is computed each tick through the view matrix the *same*
  handler had just mutated on the previous tick -- a feedback loop that cancels out about every
  other tick's contribution. Fixed in `src/drawing/DrawingCanvasTool.js` by deriving the pan delta
  from the raw native event's untransformed `clientX`/`clientY` instead, which the mid-drag matrix
  mutation can't affect.

Snapping (Steps 2d/2e) remains the only item left from the original four-preset v1 scope once
Design Steps A-E land.

## Why this milestone / ID

`RS-3001` (`docs/specifications/RS-3001-drawing-board-integration.md`) investigated vendoring
`drawleather` (a private open-source drawing tool built by Sasha's son Sergey) to provide this
capability. That investigation is retired — its "Final Decision" section (merged to `develop`,
`af1eb1d`) records Sasha's decision to build a purpose-fit drawing board directly in this
codebase's own conventions instead, at an estimated 1,300–3,400 LOC against 22,488 LOC to vendor
the equivalent subset. `RS-3001` explicitly named a follow-up milestone to scope the build; this
is that milestone. Nothing in RS-3001's decision is revisited here.

## Correction to this phase's brief, found during audit

The brief that opened this phase describes the export path as "Paper.js's own `exportSVG()`
feeding the existing SVG-import pipeline (`PathBoolean.js` / `StoneSampler` / `GeometryEngine`)."
**That's a real pipeline, but not the most direct one available, and this doc proposes skipping
the SVG round-trip.**

`src/geometry/GeometryEngine.js` already has a `'path'` layer type (`generatePathLayout()`,
§"Generate a StoneLayout for a 'path' layer," added by RS-1012 for Boolean Operation results) that
takes pre-flattened, `(0,0)`-rooted millimeter contours directly — no SVG serialization or parsing
involved. `app.js`'s Boolean Operations code (the line committing a Union/Subtract/Intersect/
Exclude result, `newLayer={id:'path'+Date.now(), type:'path', ..., contours:[...], x, y, w, h,
stoneSize, gap, color}`) is the existing, working example of exactly the layer object this drawing
board needs to produce. `generatePathLayout()`'s own doc comment says as much: contours are "usable
for any pre-flattened contour list," not just Boolean Operation output.

Practically: Paper.js is still the right tool for the *drawing* half of this milestone (freehand
capture, shape presets, snapping math, and — critically — flattening whatever curves the user
drew into a plain point-array contour), but the *output* half should construct a `'path'` layer
object directly, the same shape Boolean Operations already produces, rather than serializing to
SVG text and re-parsing it through `src/svg/**`. This is strictly less work (no serialization
format in the middle) and reuses a path already proven correct in production. `Path.exportSVG()`
remains available if a literal SVG string is ever needed elsewhere, but nothing in this milestone's
v1 scope calls for one.

This still satisfies the layout/rendering separation principle the original brief invoked: the
drawing board produces contours; `GeometryEngine.generatePathLayout()` (unchanged) turns them into
stones. The board is a new *input* method, not new stone-computation logic — same conclusion as the
brief, reached by a shorter path.

## Objective

Give users a way to draw arbitrary custom shapes directly on the canvas — freehand or from basic
presets — snap them into alignment with other content, and have them participate in the same
stone-fill/outline pipeline every other shape layer already uses. This replaces the value RS-1015's
Design Library was meant to provide (reusable custom content) with an authoring tool instead of a
save/browse library, and removes the need to ever un-freeze `src/library/**`.

## v1 Scope

### Canvas & viewport

- Pan, zoom, a drawing surface in millimeters, consistent with the existing canvas's mm coordinate
  space (`src/core` / `app.js`'s existing `project.canvas` sizing — no new coordinate system).
- Mouse and trackpad input only. Touch/pen/pinch are explicitly deferred (not v1).

### Freehand drawing tool

- Pointer-sample capture → Paper.js `Path.simplify()` for smoothing. Per RS-3001's audit, this
  needs no custom smoothing algorithm — `Path.simplify()` alone is what the reference
  implementation's own freehand tool used it for, once its irrelevant leather-craft parts are
  excluded.

### Basic shape presets

- Rectangle and ellipse, at minimum.
- Slot and/or polygon presets: **open question, see §5** — not settled scope for v1.

### Snapping

- Vertex/point snapping to other drawn shapes.
- Angle snapping.
- Grid snapping.

### Selection

- Select, multi-select, move, delete.
- No resize handles, no point/handle editing — both explicitly deferred (see Out of Scope).

### Data model

- A small plain-object/pure-function path data model in this codebase's existing style.
  `src/geometry/StoneLayout.js` (86 LOC) is the reference point for how compact this should be —
  a "state a shape, don't own its editing history" model, not a scene-graph.
- Should map cleanly onto the `'path'` layer shape `app.js`'s Boolean Operations code already
  constructs (`{contours, x, y, w, h, stoneSize, gap, color}`, contours `(0,0)`-rooted per-polygon
  point arrays) — see "Correction to this phase's brief" above. The drawing board's own working
  representation while a user is actively drawing (Paper.js `Path`/`CompoundPath` objects) is
  internal to the tool; only the flattened, committed result needs to reach this shape.

### Output

- Committing a drawn shape constructs a `'path'` layer directly (same object shape Boolean
  Operations produces) and hands it to `GeometryEngine.generatePathLayout()` unchanged, exactly
  like every other `'path'` layer today. No SVG-export/import round-trip in v1.

## Dependency note

Paper.js is **not currently installed** (`package.json` lists only `opentype.js` and `three`).
Unlike those two, `index.html`'s `importmap` maps `three` to `./node_modules/three/build/
three.module.js` directly and `opentype.js` to a local browser adapter (`src/browser/
OpenTypeBrowserAdapter.js`) — there is no CDN usage anywhere in this codebase. Paper.js will need
the same treatment: added to `package.json` `dependencies`, installed into `node_modules`, and
given an `importmap` entry pointing at its built module (or a thin local adapter, if Paper.js's
own build output doesn't ship a clean ES module — needs a quick check against the installed
package before the implementation prompt is written, not assumed here).

## Out of scope for v1

- **Point/handle editing** (editing a shape's bezier curves/points after drawing). RS-3001's audit
  called this "by far the highest-cost, highest-risk piece of this whole feature area" (150–250 LOC
  minimal, 1,200–1,800 LOC for real polish) and recommended deferring it to its own later milestone
  once v1 ships and Sasha has a feel for whether users actually need it. This document does not
  revisit that recommendation.
- **Touch/pen/pinch input.**
- **DXF/PDF export** — already out of scope per RS-3001's original scope decisions.
- **Un-freezing or modifying `src/library/**`** — this milestone replaces the *need* for it; it does
  not touch the frozen code itself. Whether `src/library/**` is later deleted, kept dormant, or
  repurposed is a separate decision, not part of RS-3010.

## Decision (2026-08-06, Sasha)

Slot and polygon presets are both in v1 scope, alongside rectangle and ellipse. They are deferred
to RS-3010 Step 2b rather than built in Step 2a, which covers only the multi-shape data model plus
rectangle/ellipse and select/move/delete.

## Next step

Once you've answered the open question above, the next step is an implementation-prompt-writing
session (not part of this document) — likely broken into steps consistent with this repo's
milestone-workflow conventions (self-verification block, local commits per step, no push until
milestone end, screenshots reported by exact path and cleaned up between steps).
