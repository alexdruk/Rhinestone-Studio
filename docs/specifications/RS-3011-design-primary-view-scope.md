# RS-3011 — Design as Primary View + Live Per-Region Stone Assignment: Scope & Design

## Task ID

RS-3011

## Title

Scope/design phase for making "Design" the app's default, persistent view, removing the explicit
Commit Shape step, and giving users live per-shape and per-region stone color/size assignment
inside Design itself.

## Status

**In progress.** Steps 1, 2, 3a, and 3b are complete and merged to `develop`. A cluster of five bugs
found during post-merge visual review (some genuine regressions from Steps 1–3b, some pre-existing
issues those steps made newly visible) has also been investigated and fixed. Five new/revised steps
were added after that same review, based on direct product feedback — see "New scope added after
visual review" below. Steps 4–8 (Eyedropper/Paint/Trace/Stamp/Eraser) are renumbered to 9–13
accordingly and have not started implementation yet.

### Completed and merged

| Step | What | Merge commit |
|---|---|---|
| 1 | Make shapes real layers (Commit Shape removed) | `4d7b7df` |
| 2 | Bridge Design's selection to the app-level selection | `16528c2` (+ test fix `54a8289`) |
| 3a | Mirror stone fields into Design's tool-options panel | `7bd3c71` |
| 3b | Live per-shape stone dots on the Design canvas | `a6790ad` |

### Bug fixes (post-merge visual review, six-bug investigation)

| Bug | Root cause | Merge commit |
|---|---|---|
| Undo/redo silently not reflected on the Design canvas; trash-icon delete same issue | Design's Paper.js shapes never resynced against `project.layers` on changes originating outside Design's own drag handlers | `0a7e147` |
| Re-clicking an active tool exits Design; mode never reverts to Select after a shape finalizes | `setDrawTool()`'s same-mode toggle-exit (pre-existing, RS-3010); no finalize site reset `mode` | `fa80918` |
| Resize drag felt slow | Paper.js's own per-frame canvas redraw (not stone-rebuild cost, confirmed via Chrome DevTools tracing after five methodologically-escalating investigation rounds) — hiding the stone Group during the drag recovers ~2ms/frame; the remaining cost is Paper.js's own baseline redraw, a separate, larger, not-yet-addressed question | `cec2c40` (partial fix) |
| Drawing an open freehand curve added spurious straight-line stones between its endpoints | `sampleMultiContourOutlinePoints()` defaulted every contour to closed, silently bridging real endpoints | `1a6e13c` |
| Visible gaps at some outline-mode corners despite a small Gap setting | `dedupeStonePoints()` correctly drops an overlap-causing corner sample but leaves nothing in its place | `ea3af31` (partial fix — backfills only where geometric room exists, confirmed ~25% of ordinary corners) |

### New scope added after visual review

Direct product feedback surfaced five more items, each triaged individually rather than batched:
Design not being the actual default view on load, `defaultProject()`'s seed content, layer naming,
stone-generation timing, and SVG import reachability. These are now Steps 4–8 below (see "Decisions,
this review session"); the original Steps 4–8 (Eyedropper/Paint/Trace/Stamp/Eraser) are renumbered
9–13.

Two items raised in the same review were **not** added to this milestone's scope:
- Menu items lacking a visual active/selected state — legitimate, but general nav polish unrelated
  to Design's architecture; belongs in its own backlog item.
- Two additional small bugs found investigating the toggle-exit fix (issue #3): the fix generalized
  correctly to every rail tool, not just Select, and is already covered by merge `fa80918` above.

## Why this milestone / ID

RS-3010 built Design as a self-contained authoring tool that hands its output to the rest of the
app through one explicit action (Commit Shape). That was the right sequencing — it let RS-3010 ship
drawing/selection/snapping without also solving how Design's shapes should live permanently
alongside every other layer type. This milestone is the follow-up RS-3010 always implied: Sasha
wants Design to *be* the app's primary surface, not a side tool that hands off to one.

## Decisions (Sasha, original scoping session)

Three open questions were resolved before writing this doc's original scope, all toward the larger,
more ambitious end of the range investigation raised:

1. **Full unification.** Design's Select tool should eventually be able to select, move, and resize
   every layer type (Text, Shapes-library, Monogram output, imports) — not just Design's own drawn
   shapes. Design becomes the one place all layer editing happens, not a parallel tool.
2. **Sub-region granularity is a hard v1 requirement**, not a stretch goal. Users must be able to
   assign different stone color/size to different parts of a single drawn shape (e.g. two halves of
   one polygon), previewed live inside Design.
3. **Autosave/crash-recovery coverage for in-progress Design shapes is in-scope for RS-3011**, since
   removing the Commit Shape step naturally fixes it (see "Correction to this phase's brief" below)
   rather than requiring separate work.

## Decisions (Sasha, this review session — post-Step-3b visual review)

Four more product decisions, made individually rather than batched, after direct usage surfaced
gaps the original scope didn't anticipate:

4. **`defaultProject()` changes app-wide**, not just inside Design — removing the seed "Vitalina
   Serbin" text layer and reducing prominence of the template/product description. This affects
   every new project, not a Design-specific display choice.
5. **SVG import becomes its own action reachable from inside Design** (not only the existing Import
   Lightbox), and an imported SVG becomes a full Design-native shape — selectable/movable there like
   any drawn shape. This is a narrower, earlier slice of Decision 1's long-term "unify Select"
   goal, scoped specifically to SVG imports rather than every layer type at once.
6. **Stone generation becomes button-gated, not immediate.** A drawn shape still becomes a real
   layer instantly (Step 1's behavior is unchanged), but its stones do not appear until a button
   next to the stone selector is pressed, using whatever spec is set at that moment. This is a
   deliberate, partial reversal of Step 3b's "live immediately" design — Sasha's own words: "only by
   button. Without it only drawing."
7. **Design should be the app's actual default view on open** (the milestone's own stated Objective,
   below, was never actually implemented — a real gap in the original 8-step breakdown, not new
   scope Sasha is asking for beyond what was already promised), restoring the previous project if
   one exists or a blank board otherwise, and the active view should persist across a page reload
   (currently reloading always lands in Dual Workspace regardless of what was active before).

## Correction to this phase's brief, found during audit

The kickoff brief for this phase treated three things as open architectural questions. Direct
investigation of the current codebase (not the brief's own framing) answered two of them more
concretely than expected, and surfaced one problem the brief didn't mention at all.

**Per-shape stone settings already exist, but only for one shape at a time.** Each committed Design
shape becomes an independent `'path'` layer with its own Inspector-editable `stoneSize`/`color`/
`gap` — confirmed in `app.js`'s `selectedLayer()`/`syncSelectedControlsFromLayer()`. But the
Inspector is single-selection only; there is no simultaneous multi-shape editing today either
inside or outside Design. "Live per-shape assignment inside Design" is new UI work, not just moving
existing UI into a new location.

**Sub-region granularity is more feasible than it looks, because of an existing precedent.**
`src/geometry/Stone.js` already carries `sizeMm`/`color` *per stone*, not per layer —
`StoneLayout` is just a flat collection of individually-specced stones sharing a `layerId`. Today,
`GeometryEngine.generatePathLayout()` happens to apply one uniform `stoneSizeMm`/`color` to every
sampled point in a single call (`GeometryEngine.js` line ~958), but `MixedSizeGenerator.js` (S-200,
"Mixed Stone-Size Layouts") already proves the pattern this milestone needs: it adds a *second* pass
of differently-sized stones into the same `StoneLayout`, using `StoneSampler.js`'s own
interior-point tests to decide which points get the special treatment. Sub-region assignment is the
same shape of problem — sample points, decide which region (sub-path/polygon) each point falls in
via the same interior tests, apply that region's `stoneSize`/`color` instead of one shared value.
This is a genuinely new feature (no "region" concept exists in the data model yet), but it is an
extension of a pattern already proven correct in production, not something built from nothing.

**Removing Commit Shape doesn't just change undo/redo scope — it currently leaves in-progress
Design work unprotected against crashes**, and the brief never raised this. `app.js`'s autosave
(`scheduleAutosave()`/`flushAutosaveNow()`) and the dirty-indicator both serialize `project` only.
`DrawingBoard.js`'s own header states shapes only enter the undo/redo system "once
`DrawingCanvasTool.js`'s commit() turns it into a real 'path' layer" — the same is true of
`project`, and therefore of autosave. **A user who draws for ten minutes and refreshes the tab today
loses everything**, silently. Folding Design shapes into `project.layers` immediately (removing
Commit Shape) fixes this as a side effect, matching Decision 3 above — but it's worth stating
explicitly as the actual user-facing bug this milestone resolves, not just an undo/redo technicality.

One thing this audit did *not* need to solve: "name it, save it, export it, import it back" (kickoff
point 1) is already fully general at the project level (`project.name`, `#exportProject` → JSON
download, `#importProjectFile`). Once Design's shapes are real `project.layers` entries, they
inherit this for free — no Design-specific save/export system is needed.

## Objective

Make Design the app's default, persistent view: every drawn shape becomes a real layer the instant
it's created (no separate Commit step), Design's own layer survives switching tools, and stone
color/size — including sub-region assignment — can be set and previewed live inside Design, without
switching to Dual Workspace/2D Canvas. Longer-term, unify Design's Select tool to operate on every
layer type, making Design the single place all layer editing happens.

## Standing requirements for every step below

Two rules apply to every step in this milestone, not called out per-step below to avoid repetition:

1. **Every tool gets a real entry in the Design tool rail** — a name and/or icon in the
   Photoshop-style rail RS-3010 Design Step A built (`railSelectToggle`/`railRectToggle`/etc.'s own
   pattern), the same way every RS-3010 preset did. No tool ships reachable only by a keyboard
   shortcut or a hidden gesture.
2. **`drawleather` (github.com/sergeychernyshev/drawleather, Sasha's own private repo) must be
   checked for reusable logic/technique before any implementation prompt is written for a step that
   introduces new drawing/interaction logic** — this was already this project's standing convention
   and applies in full here. Steps that are pure app-architecture wiring (no new drawing interaction)
   are marked "not applicable" and don't need this.

## v1 Scope: build order

Each step below includes a **Visual result** line — what's actually different to look at / click on
in the app once that step ships, for steps where there is one.

### Step 1 — Make shapes real layers ✅ merged `4d7b7df`

Every shape Design creates (freehand or a finished preset) is pushed into `project.layers` directly,
at creation, wrapped in the existing `commitHistory()`/`openHistorySession()`/`closeHistorySession()`
machinery. `#drawCommitBtn` and its handler are removed. Side effect: in-progress Design shapes are
now covered by autosave/crash-recovery automatically. **`drawleather` check: not applicable.**
**Visual result:** the Commit Shape button disappears. Drawing a shape shows it immediately in the
Layers list, with no extra click. Refreshing the tab mid-drawing no longer loses it.

### Step 2 — Bridge Design's selection to the app-level selection ✅ merged `16528c2`

Feed Design's own selected shape ids into the `selectedLayerIds`/`selectedItemsForEditing()` that
`runAlign()`/`runDistribute()`/`duplicateLayer()`/the rotate-handle system already use for every
other layer type. Two real drift bugs (Align/Distribute and Duplicate not moving/appearing on the
Design canvas) were found and fixed as part of this step, not deferred. **`drawleather` check: not
applicable.**
**Visual result:** the existing Align/Distribute/Rotate/Duplicate buttons and the rotate handle
start working on Design shapes for the first time.

### Step 3a — Mirror stone fields into Design's tool-options panel ✅ merged `7bd3c71`

A shape's `stoneSize`/`color`/`gap` fields, already live-editable via the Inspector, also appear in
`#designToolOptionsPanel` (the left panel under the tool rail) via the existing Lightbox
field-relocation mechanism (`FIELD_GROUPS`/`relocateFieldGroups()`) — reused, not duplicated.
**`drawleather` check: not applicable.**
**Visual result:** selecting a shape in Design shows its stone fields right there in the tool-options
panel, not only in the Inspector on the far right.

### Step 3b — Live per-shape stone dots on the Design canvas ✅ merged `a6790ad`

Every Design-drawn shape renders its actual stones as native Paper.js circles (a sibling `Group`,
inserted below the shape's own outline item), following the `drawleather` `Scene.ts` precedent of
rendering decorations natively in the same scene rather than a second overlay canvas. Kept in sync
through creation, param edits, move, resize, delete, and duplicate. **`drawleather` check: done** —
matches `Scene.ts`'s native-item approach directly; confirmed via a timed spike that panning/zooming
needs zero extra code (Paper.js items inherit the view transform automatically).
**Visual result:** Design shows real stone dots immediately, for every shape at once (Sasha's
decision — not just the selected shape), matching what the 2D Canvas already renders for the whole
project.

### Step 4 — Design is the actual default view on open (new, this review)

The milestone's own Objective (above) already promised this; it was never implemented in Steps 1–3b.
On app load: restore the previous project if one exists (in Design), or start a blank board in
Design if not — Design becomes the true default, not just internally more complete. Reloading the
page must also restore whichever view was active before the reload (currently always lands in Dual
Workspace regardless). **`drawleather` check: not applicable** (app-boot/routing logic, not new
drawing interaction).
**Visual result:** opening the app lands directly in Design, not Dual Workspace. Reloading mid-Design
session stays in Design instead of bouncing to Dual Workspace.

### Step 5 — `defaultProject()` changes app-wide (new, this review)

Remove the seed "Vitalina Serbin" text layer and reduce the prominence of the template/product
description in a brand-new project — an app-wide default-content change, not scoped to Design (per
Sasha's explicit decision). **`drawleather` check: not applicable.**
**Visual result:** a brand-new project starts with no pre-existing text layer and a less prominent
template description, everywhere in the app, not only in Design.

### Step 6 — Layer naming by shape type (new, this review)

Every Design-drawn layer is currently named "Drawn Shape" regardless of which tool created it.
Name by the actual preset used ("Rect", "Slot", "Polygon", "Freehand"/"Line", etc.) instead.
**`drawleather` check: not applicable** (naming/display only).
**Visual result:** the Layers list shows a shape's actual type instead of a generic "Drawn Shape"
label for every entry.

### Step 7 — Button-gated stone generation (new, this review)

A drawn shape still becomes a real layer immediately (Step 1's behavior is unchanged) and its
outline is still visible right away, but its stones do not generate until a button next to the
stone selector (in both the Inspector and Step 3a's mirrored panel) is pressed, using whatever
stoneSize/gap/color is set at that moment. This is a deliberate, partial reversal of Step 3b's
"stones live immediately" design, per Sasha's own decision. **`drawleather` check: recommended** —
worth a quick check of how `drawleather`'s own stamp/fill decorations handle a not-yet-committed
state (a ghost preview before commit, `StampTool.ts`'s own pattern from Steps 9–13 below) in case
the same treatment (an outline-only "not yet generated" state) applies here too.
**Visual result:** a newly-drawn shape shows its outline only, no stones, until the new "Generate
Stones" button (name TBD) is pressed; pressing it produces the live stone preview Step 3b already
built.

### Step 8 — SVG import into Design (new, this review)

SVG import becomes its own action reachable from inside Design, not only the existing Import
Lightbox. An imported SVG becomes a full Design-native shape — selectable, movable, and
resizable there like any drawn shape, and (per Steps 1/3b) gets a real `project.layers` entry and a
live stone preview immediately. This is a narrower, earlier slice of the long-term "unify Select"
goal (deferred, below), scoped specifically to SVG imports. **`drawleather` check: recommended** —
worth checking whether `drawleather` has any equivalent "import external vector content onto the
live canvas" flow before designing this from scratch.
**Visual result:** a new Import action inside Design's own tool rail/panel; an imported SVG appears
directly on the Design canvas, selectable and showing stones like any other shape, with no need to
leave Design or use the existing top-nav Import Lightbox.

### Step 9 — Eyedropper (renumbered from 4)

Click an existing stone or shape to pick up its size/color as the active spec for whatever tool runs
next. **`drawleather` check: done** — no dedicated eyedropper tool exists in `drawleather` either;
confirms this is genuinely simple with no hidden interaction pattern to copy.
**Visual result:** a new Eyedropper icon in the tool rail; clicking a stone with it active sets the
active stone size/color fields to match.

### Step 10 — Paint tool (renumbered from 5)

Live lasso-fill, built directly on RS-3010's already-shipped freehand tool. **`drawleather` check:
done** — `src/tools/FillTool.ts` does exactly this; stores the lassoed region as its own independent
`FillDecoration`, layered visually on top rather than subtracting from the base shape's geometry.
For us: Paint doesn't need to rewrite `generatePathLayout()`'s output, just skip base-layer stones
wherever a higher-priority Paint region already covers that point (the same interior-point-test
approach `MixedSizeGenerator.js` already uses).
**Visual result:** a new Paint icon in the tool rail; dragging shows a dashed lasso outline live,
stones fill the area on release.

### Step 11 — Trace tool (renumbered from 6)

Drag a new path (not two points on an existing outline — revised after the `drawleather` check;
Sasha confirmed this direction), stones repeat along it at fixed spacing. **`drawleather` check:
done** — `src/tools/LineStampTool.ts`/`src/stamps/lineStamping.ts`. Worth keeping regardless of this
step: `lineStamping.ts`'s spacing algorithm recomputes step size for closed loops so the seam meets
cleanly, something our own `sampleOutlinePoints()` doesn't do today.
**Visual result:** a new Trace icon in the tool rail; dragging shows a dashed path preview, stones
appear spaced evenly along it on release.

### Step 12 — Stamp tool (renumbered from 7)

Place a single stone by hand, snapped to the grid. **`drawleather` check: done** —
`src/tools/StampTool.ts` places a standalone `StampDecoration`, never regenerated, with a
50%-opacity ghost preview before commit — worth copying directly. `pieceTransform.ts`'s
`translateDecoration()` confirms decorations survive a piece moving without being regenerated. One
gap `drawleather` doesn't resolve: how a manually-placed stone should behave when its parent shape
resizes.
**Visual result:** a new Stamp icon in the tool rail; a translucent ghost stone follows the cursor,
clicking places a real one.

### Step 13 — Eraser (renumbered from 8)

Remove placed stones directly at a point. **`drawleather` check: done, and it's a real gap** — no
eraser tool exists in `drawleather` at all; genuinely new UI, not a port of anything.
**Visual result:** a new Eraser icon in the tool rail; dragging over placed stones removes them live.

## Deferred, not part of this milestone's numbered sequence

- **Unify Select across every layer type** (Text, Shapes-library, Monogram output, imports) —
  Decision 1's long-term goal. Step 8 above is a narrower, earlier slice of this scoped specifically
  to SVG imports; full unification (Text, Shapes-library, Monogram) stays deferred. Highest
  architectural risk item raised during scoping; revisit as a possible follow-up milestone (RS-3012)
  once the rest of this milestone is in use.
- **Group/Ungroup** — open question raised during original scoping, not yet answered.
  `project.layers` is a flat, per-shape manufacturing model; unclear whether grouping has a real
  manufacturing use case here.
- **Layer reorder (bring-forward/send-backward) and Lock** — real, confirmed gaps, but pre-existing
  and app-wide, not specific to Design or this milestone. Own small backlog item.
- **Menu items lacking a visual active/selected state** — raised in this review session's product
  feedback; legitimate but general nav polish, unrelated to Design's architecture. Own backlog item.
- **Full resize-drag performance fix** — the bug-fix cluster's partial fix (merge `cec2c40`) recovers
  ~2ms/frame by hiding stones during the drag; the remaining, larger cost is Paper.js's own baseline
  per-frame canvas redraw (outline, resize handles, grid), confirmed via Chrome DevTools tracing but
  not yet investigated as its own problem. Worth its own investigation if it continues to bother
  real usage.

## Decisions record

- **(2026-08-08)** Step 11/Trace resolved: `drawleather`'s drag-a-new-path approach, not "mark two
  points on an existing line."
- **(2026-08-10)** Four new decisions from this review session — see "Decisions, this review
  session" above (Steps 4–8's product direction).

## Out of scope for this document

- Any implementation. This doc is scope/design only, per RS-3010's own established pattern.
- Settling Step 10's decoration-vs-base-layer point exclusion, Step 12's manual-stone-resize
  behavior, or Step 7's exact "Generate Stones" button copy/placement in detail — left to their own
  implementation-prompt-writing sessions.

## Next step

Steps 4–8 (this review session's new scope) need implementation prompts, in an order to be decided —
Step 4 (Design as default view) and Step 7 (button-gated generation) are the two most likely to
interact with existing behavior in non-obvious ways and may deserve going first. Steps 9–13
(Eyedropper/Paint/Trace/Stamp/Eraser) remain ready to start once Steps 4–8 are settled. Same
conventions as always: self-verification blocks referencing actual commit hashes, diffs read in full
before authorizing a commit (never from a summary), scoped git diffs, local commits with no push
until review, `git merge --no-ff` with `-m`, `.gitignore` entries for any throwaway verification
script landing in the *same* commit as the script itself, and splitting further the moment two
genuinely different kinds of risk show up in one piece of work.
