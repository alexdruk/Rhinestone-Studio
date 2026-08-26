# RS-3013 — Paint Region Selection & Editing: Scope & Design

## Task ID

RS-3013

## Title

Making a Paint-created `region` (RS-3011 Steps 10a/10b) independently selectable, movable,
copyable, deletable, and stone-size/color-editable after creation.

## Status

**Shipped.** Steps 1–5 below are merged into `develop`. One item from the original proposed build
outline — a pre-paint stone-spec picker (Decision 3) — was never built; see "Deferred" at the end
of this document.

Note on the task number: RS-3011's own "Deferred" section names a possible future "RS-3012" as the
follow-up for its Decision 1 — *unifying Select across every layer type* (Text, Shapes-library,
Monogram output, imports). This document is deliberately numbered RS-3013, not RS-3012, and is a
separate milestone from that one, despite real overlap between them (Lasso, shipped in Step 1
below, is a small, real slice of that same deferred direction). RS-3012 itself remains unscoped and
undecided — still just the one-line mention in RS-3011's own "Deferred" section, nothing more. This
document does not resolve it, in part or in full.

## Why this milestone

Feedback after RS-3011 Step 10b (Paint) shipped: a painted region was create-only — no way to edit
its stone size/color after the fact, move it, copy it, or delete it independently of redrawing the
whole shape. The actual gap, confirmed by reading the shipped code rather than assumed from the
feature description:

- `onPaintStroke()` (`app.js`) committed a region with the **target layer's current**
  `stoneSize`/`gap`/`color` silently inherited — no confirm step and no way to specify different
  values for the region being created.
- Nothing in the app could select a `region` object. Selection everywhere else in the app was
  layer-granular (`selectedLayerIds`) — `regions[]` entries were invisible to all of it.
- The result: once Paint committed a region, it was permanently opaque to every existing
  move/copy/delete/Inspector-edit operation. The only way to change one was to delete and redraw
  the entire parent shape, or manually edit `region.stoneSizeMm`/`gapMm`/`color` in exported JSON.

## What the region data model already gave us (RS-3011 Steps 10a/10b) — not rebuilt here

Each `region` object, as committed by `onPaintStroke()` and consumed by
`GeometryEngine._applyPathRegions()`, already had its own `id`, its own `contour` (natural-space,
independent of the parent shape's own `contours`), and its own independent
`stoneSizeMm`/`gapMm`/`color`/`fillMode`. That is, the **storage** half of "a region is its own
editable thing" was already built and production-correct before this milestone —
`normalizePathRegions()`/`normalizePathRegion()` already validated and defaulted every field
per-region, and `_applyPathRegions()` already treated each region as an independent,
priority-ordered patch on top of the base fill. What this milestone added was purely the
**editing surface**: a way to select one, operations that act on a selection of that shape instead
of a whole layer, and (still open, see "Deferred") a way to set a new region's spec before it's
created rather than after.

## `drawleather` precedent check

Done before Step 1 was scoped, per this project's standing convention. Two precedents in
`drawleather` (`github.com/sergeychernyshev/drawleather`) were directly relevant:

- The `Cutout` interface (`src/model/Project.ts:78`) is a directly analogous data-model
  precedent — a sub-object living inside a parent piece, independently selectable and moved via
  `translateCutoutInProject()` (`src/tools/SelectTool.ts:620`), which translates only that one
  cutout's own path data, never the whole piece. This confirmed per-region translation (Step 2,
  below) as a sound, precedented approach.
- How an existing cutout gets (re-)selected in `drawleather` is a **click-based hit test, not a
  lasso drag** (`SelectTool.ts:89-95`). This was direct, load-bearing precedent for click-to-select,
  and a point against assuming a lasso-drag was automatically the right call just because it
  mirrors how a region is created by Paint.

## Resolved decisions and what actually shipped

**1. Re-selecting an existing region.** Resolved as a genuine hybrid, not either option as
originally framed. **Click-to-select** an existing region (the `drawleather`-precedented
mechanism) works identically whether **Select** or a new, separate **Lasso** tool (rail button,
shortcut `L`) is active — one shared `performClickDispatch()`, backed by
`hitTestPathLayerRegion()` (`src/geometry/PaintRegionSelection.js`). Lasso itself is a genuinely
new general-purpose selection tool (arbitrary-shape drag, clipped to its best-overlap target shape
at creation, reusing Paint's own `selectPaintTarget()` choreography via a new
`resolvePaintTargetTwoPass()`) — distinct from Paint's own lasso, which still only creates regions.
Select's own rectangle-drag was also split on Shift at this step: unshifted starts a new unclipped
selection-rectangle gesture, Shift+drag preserves the existing marquee multi-select untouched.
(Step 1, `bbf0724`/`9384d4a`.)

**2. Resize.** Not built — the recommendation in the original draft of this document (repaint to
reshape, since an arbitrary post-hoc resize could produce a region that no longer clips sensibly
against its parent) was followed by omission. No resize operation exists for a region as of this
writing.

**3. Pre-paint stone-spec picker.** Not resolved, not built. See "Deferred" below — this is the one
genuine gap between the original proposed scope and what shipped.

**4. Moving/copying a region across its parent's own boundary.** Resolved: **no explicit clipping
logic was added.** `GeometryEngine._applyPathRegions()` already filters region stones against the
shape's live outline on every regeneration, so a region dragged or copied partly outside its
parent's outline simply renders fewer stones there, self-correcting if dragged back in — the
existing containment filter absorbs this for free, with no per-frame re-clip and no
reject/snap-back needed. (Step 2, `840c4be`.)

## What shipped, step by step

1. **Region selection mechanism** (`bbf0724`/`9384d4a`, fix `34c8ee3`). New `activeSelection`
   state, mutually exclusive with `selectedIds`, surviving Select↔Lasso switches and clearing on
   any other tool switch or Design exit/re-entry. `34c8ee3` fixed an ordering bug found after
   Step 1 shipped: a region hit-test running before Select's own resize-handle check could steal a
   drag from a handle when a region's contour vertex landed within the same hit-test tolerance a
   handle occupies (an ordinary case — a region painted flush against its parent's edge). Resolved
   by re-ordering: resize-handle check first, then region-hit, then whole-shape move.

2. **Region-level move** (`840c4be`). New `moveRegion` interaction kind; a drag starting on a
   selected region's own footprint moves the region via a new `onRegionMoved()` hook, translating
   the region's absolute polygon through the same natural-space transform chain
   `hitTestPathLayerRegion()` uses. No new cancel-on-Escape logic — matches the existing shape-move
   drag's own precedent.

3. **Region-level copy/duplicate** (`919ac3a`/`5214eaa`). New `duplicateRegionInPathLayer()`,
   offsetting by the same fixed (8,8)mm `duplicateLayer()` already uses for a whole layer, copying
   `stoneSizeMm`/`gapMm`/`color`/`fillMode` verbatim from the source — **no picker for a copy**,
   per the decided rule that a copy is a duplicate, not a new paint stroke. New region ids use a
   `'copy'` suffix, structurally distinct from `onPaintStroke()`'s own numeric-index scheme, so the
   two can never collide.

4. **Region-level delete** (`5409d3c`). New `deleteRegionFromPathLayer()` plus a shared
   `deleteCurrentSelection()` helper used by both existing delete entry points (button and
   Delete/Backspace key), so a selected region deletes correctly from either path without each
   carrying its own duplicated branch. No last-region guard — an empty `regions` array is already a
   path layer's normal default state.

5. **Per-region stone-spec editing** (`c3f18e9`/`adfc0d4`). `#stoneSize`/`#gap`/`#stoneColor`
   populate from and write to the selected region's own fields instead of the parent layer's; a new
   `#regionFillMode` select (fill/outline only — staggered/radial/contour against an arbitrary
   clipped region contour was left unproven and out of scope) takes over from the shape's own fill
   mode control while a region is selected. New `onActiveSelectionChanged()` hook keeps the
   Inspector in sync with every settled selection change.

Every step landed inside the existing `commitHistory()`/`openHistorySession()`/
`closeHistorySession()` machinery — a region-level operation is exactly as undoable as a
layer-level one, per RS-3011 Step 1's own standing convention.

## Deferred

**Pre-paint stone-spec picker (originally Decision 3 / build-step 6).** A new region still has no
UI moment between "lasso released" and "region committed" — `onPaintStroke()` still reads the
target layer's current `stoneSize`/`gap`/`color` directly at commit time, silently inherited exactly
as before this milestone. If this is still wanted, it needs its own scoping pass: where the picker
lives (a small panel near the Paint rail button, mirroring how the shape tools already mirror a
layer's own stone fields into `#designToolOptionsPanel`?) and what it defaults to (last-used region
spec? the target layer's current spec, shown and now editable rather than silently applied?) were
never decided.

**Region reordering/priority and region grouping** — neither was raised in the original feedback
that prompted this milestone; still not assumed in scope.

**RS-3012 itself** — the broader "unify Select across every layer type" milestone RS-3011
informally flagged. Deliberately kept separate, and remains unscoped and undecided regardless of
this document.
