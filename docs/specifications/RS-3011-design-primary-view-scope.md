# RS-3011 — Design as Primary View + Live Per-Region Stone Assignment: Scope & Design

## Task ID

RS-3011

## Title

Scope/design phase for making "Design" the app's default, persistent view, removing the explicit
Commit Shape step, and giving users live per-shape and per-region stone color/size assignment
inside Design itself. **This document is the only deliverable of this phase — no implementation.**

## Status

Scoping. Following on directly from RS-3010 (drawing board v1: freehand + rect/ellipse/slot/polygon
presets, select/multi-select/move/delete, marquee, resize handles, Photoshop-style tool rail,
grid/vertex/angle snapping — shipped and merged to `develop`, HEAD `4bd0331`). This is a new
milestone, not a continuation step of RS-3010: it is a real architectural pivot in how Design
relates to the rest of the app, not an extension of already-scoped drawing-tool work.

## Why this milestone / ID

RS-3010 built Design as a self-contained authoring tool that hands its output to the rest of the
app through one explicit action (Commit Shape). That was the right sequencing — it let RS-3010 ship
drawing/selection/snapping without also solving how Design's shapes should live permanently
alongside every other layer type. This milestone is the follow-up RS-3010 always implied: Sasha
wants Design to *be* the app's primary surface, not a side tool that hands off to one.

## Decisions (Sasha, this scoping session)

Three open questions were resolved before writing this doc's scope, all toward the larger,
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

These decisions make this a substantially larger milestone than RS-3010. The v1 scope and phase
breakdown below are sized accordingly.

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
   (see Sasha's memory note) and applies in full here. **This doc's audit could not do this itself**:
   `drawleather` is private and this session has no credentials for it (confirmed directly — a plain
   `git clone` of the repo failed with an auth error, not assumed from the access-note alone).
   **Sasha needs to provide the zip before implementation prompts are written** for any step whose
   own row below is marked "needs drawleather check." Steps that are pure app-architecture wiring
   (no new drawing interaction) are marked "not applicable" and don't need this.

## v1 Scope: build order

Given the scope Decisions 1–3 above, and Sasha's own review of the proposed tool set against a
general-purpose-editor reference list (filtered down to what a physical rhinestone manufacturing
layout tool actually needs — general vector-editor concepts like node/path editing, frames,
connectors, gradients, and AI tooling are excluded as not applicable to this app's actual use case),
this milestone ships as eight ordered steps, each independently committable per this project's
usual splitting convention.

Each step below now includes a **Visual result** line — what's actually different to look at / click
on in the app once that step ships, for steps where there is one. Steps 1–2 are foundation work with
no new visible surface of their own; everything from Step 3 on has something to see.

### Step 1 — Make shapes real layers

Every shape Design creates (freehand or a finished preset) is pushed into `project.layers` directly,
at creation, wrapped in the existing `commitHistory()`/`openHistorySession()`/`closeHistorySession()`
machinery — reusing the session-coalescing pattern already built for continuous interactions (drags,
keystrokes), not inventing a new one. `#drawCommitBtn` and its handler are removed; RS-3010 Step 2a's
batch-commit workflow goes away by construction, since each shape is already a layer the moment it
exists. Side effect: in-progress Design shapes are now covered by autosave/crash-recovery
automatically (see "Correction" above — this is the actual user-facing bug this step fixes). Design's
own layer persists across tool switches for the same reason. **`drawleather` check: not applicable**
(this step is app-architecture wiring, not new drawing/interaction logic).
**Visual result:** the Commit Shape button disappears. Drawing a shape shows it immediately in the
Layers list, with no extra click. Refreshing the tab mid-drawing no longer loses it.

### Step 2 — Bridge Design's selection to the app-level selection

Feed Design's own selected shape ids into the `selectedLayerIds`/`selectedItemsForEditing()` that
`runAlign()`/`runDistribute()`/`duplicateLayer()`/the rotate-handle system already use for every
other layer type. This is markedly smaller than full Select-tool unification (deferred, below) — it
doesn't touch Text/Shapes-library/imports at all, it just lets Design's own (now-real, per Step 1)
shapes reach tools that already exist and already work. **`drawleather` check: not applicable.**
**Visual result:** the existing Align/Distribute/Rotate/Duplicate buttons and the rotate handle
start working on Design shapes for the first time — no new buttons, existing ones just stop being
inert for this shape type.

### Step 3 — Live stone panel in Design

A shape's `stoneSize`/`color`/`gap` become editable from within Design itself (the existing
contextual tool-options panel RS-3010 Design Step A introduced), previewed on the Design canvas —
no switch to Dual Workspace/2D Canvas required. Still whole-shape, not sub-region, at this step.
**`drawleather` check: not applicable** (UI/data-flow wiring onto an existing panel, not new drawing
interaction).
**Visual result:** selecting a shape in Design shows its stone size/color/gap fields right there in
the tool-options panel, and changing them updates the stone preview live, without leaving Design.

### Step 4 — Eyedropper

Click an existing stone or shape to pick up its size/color as the active spec for whatever tool runs
next. Cheap (reads one stone's/layer's fields), and makes every tool below faster to use once they
exist. **`drawleather` check: done** — no dedicated eyedropper tool exists in `drawleather` either;
its closest equivalent is just picking a stamp from `StampPanel.ts`'s library list before placing.
Confirms this is genuinely simple with no hidden interaction pattern to copy.
**Visual result:** a new Eyedropper icon in the tool rail; clicking a stone with it active sets the
active stone size/color fields to match, visible in the tool-options panel immediately.

### Step 5 — Paint tool

Live lasso-fill, built directly on RS-3010's already-shipped freehand tool.
**`drawleather` check: done** — `src/tools/FillTool.ts` does exactly this (click a piece to fill it
whole, or drag a lasso to fill part of it), and it resolves the open carving question cleanly: it
does **not** subtract anything from the base shape's own geometry. It stores the lassoed region as
its own independent `FillDecoration`, layered visually on top of the base piece
(`src/model/Project.ts`). For us, that means Paint doesn't need to rewrite `generatePathLayout()`'s
output — it just needs to skip base-layer stones wherever a higher-priority Paint region already
covers that point, the same interior-point-test approach `MixedSizeGenerator.js` already uses.
**Visual result:** a new Paint icon in the tool rail; dragging shows a dashed lasso outline live,
and on release stones fill the lassoed area immediately — either the whole shape (plain click) or
just the lassoed portion, visibly distinct in color/size from the rest of the shape if a different
spec is active.

### Step 6 — Trace tool

**Revised from the original description** (marking two points on an *existing* outline) after the
`drawleather` check, because the precedent found is meaningfully different and simpler:
`src/tools/LineStampTool.ts` doesn't pick points on anything existing — you drag out a brand-new
path, like a quick freehand stroke, and stamps repeat along *that* path at fixed spacing
(`src/stamps/lineStamping.ts`), independent of any shape's outline. This avoids needing any
hit-testing against an existing outline, and reuses the same freehand-capture code Paint and RS-3010
already have. Worth keeping either way: `lineStamping.ts`'s spacing algorithm recomputes step size
for closed loops so the seam meets cleanly (`count = round(total/step); actualStep = total/count`) —
our own `sampleOutlinePoints()` (`src/geometry/StoneSampler.js`) doesn't do this today and can leave
an uneven gap at the seam on closed shapes; worth a small fix regardless of Trace, since it affects
the existing outline fill mode too. **`drawleather` check: done.**
**Visual result:** a new Trace icon in the tool rail; dragging shows a dashed path preview live, and
on release, stones appear spaced evenly along the drawn path.

### Step 7 — Stamp tool

Place a single stone by hand, snapped to the existing grid. The one genuinely new data primitive in
this milestone: no precedent anywhere in the codebase for a manually-placed stone independent of a
sampled layer (confirmed directly — nothing in `Stone.js`/`GeometryEngine.js` supports this today).
**`drawleather` check: done** — `src/tools/StampTool.ts` places a `StampDecoration`, a standalone
object (position, rotation, id) stored as its own array entry on the piece, never regenerated. It
shows a 50%-opacity ghost stamp following the cursor before commit — worth copying directly, it's a
good, cheap UX pattern. I traced how it survives edits: `src/model/pieceTransform.ts`'s
`translateDecoration()` explicitly moves each decoration's own coordinates whenever the piece
translates — decorations are carried along, never regenerated, which directly answers this step's
persistence question. **One gap found, not resolved by drawleather**: I could only find translate
handling in `pieceTransform.ts`, not resize/scale — how a decoration should behave when its parent
shape is resized may be an open question even there, not something to copy an answer for.
**Visual result:** a new Stamp icon in the tool rail; a semi-transparent stone ghost follows the
cursor over the canvas, and clicking places a real, full-opacity stone at that point.

### Step 8 — Eraser

Remove placed stones directly at a point — Stamp's natural inverse, cheap once Step 7's manual-stone
data model exists. **`drawleather` check: done, and it's a real gap** — there is no eraser tool in
`drawleather` at all. Removing a stamp there means selecting the whole decoration object and deleting
it (an ordinary delete), never a brush-style sweep across several placements at once. Our Eraser is
genuinely new UI with no precedent to lift, not a port of anything.
**Visual result:** a new Eraser icon in the tool rail; dragging over placed stones removes them
live, one at a time, as the cursor passes over them.

## Deferred, not part of this milestone's numbered sequence

- **Unify Select across every layer type** (Text, Shapes-library, Monogram output, imports) — Decision
  1's long-term goal, but none of Steps 1–8 require it (Step 2's bridge is deliberately narrower).
  Highest architectural risk item raised during scoping; revisit as a possible follow-up milestone
  (RS-3012) once Steps 1–8 are in use and there's a real feel for whether full unification is needed.
- **Group/Ungroup** — open question raised during scoping, not yet answered. `project.layers` is a
  flat, per-shape manufacturing model where each layer becomes independent stone output; unclear
  whether grouping has a real manufacturing use case here. Needs Sasha's answer before it gets a slot
  in the sequence, if it gets one at all.
- **Layer reorder (bring-forward/send-backward) and Lock** — real, confirmed gaps (no reorder UI, no
  lock concept anywhere in `app.js`), but pre-existing and app-wide, not specific to Design or this
  milestone. Worth its own small backlog item rather than folding into RS-3011.

## Decision (2026-08-08, Sasha) — Step 6 resolved

Step 6 (Trace) follows `drawleather`'s approach: drag a new path, stones repeat along it at fixed
spacing — not "mark two points on an existing line." No open questions remain blocking any of the 8
steps; ready for implementation-prompt-writing to begin.

## Out of scope for this document

- Any implementation. This doc is scope/design only, per RS-3010's own established pattern.
- Settling exactly how Step 5's decoration-vs-base-layer point exclusion is implemented, or how Step
  7's manual stones behave under a parent-shape resize (flagged above as an open gap even in
  `drawleather`) — both left to their own implementation-prompt-writing sessions.

## Next step

Sasha review of this doc, its 8-step build order, and the Step 6 open question above. Once approved,
Step 1's own implementation-prompt-writing session starts (not part of this document) — same
conventions as RS-3010 throughout: self-verification blocks referencing actual commit hashes,
screenshots reported by exact file path and independently verified (not taken on faith), scoped git
diffs, local commits with no push until review, `git merge --no-ff` with `-m`, and splitting further
the moment two genuinely different kinds of risk show up in one piece of work.
