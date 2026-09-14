# MONO-020 — Monogram ownership: replace on generate, release on Design edit

**Status:** implemented. Branch `feature/mono-020-monogram-ownership` off `develop` @ the MONO-019
merge (`cff7959`). Local only — not pushed.

**Authorises:** the Monogram Lightbox owning the layer set it generated, so a second Generate
*replaces* the previous monogram instead of stacking a new one on top of it — but only while that
set is **unchanged since generation**. The moment the user changes a monogram layer in the Design
workspace — Stamp/Paint/Erase, *or* a move / resize / rotate — the set is *released*: the next
Generate leaves it in place and adds the new monogram alongside. No change to `MonogramGenerator.js`.
No geometry change — no screenshots.

Builds directly on MONO-019's `assignInsertionLayerIds()` (the shared per-generation suffix is now
also the set identity).

---

## 1. The problem

Before MONO-020, every click of **Generate** in the Monogram Lightbox appended a fresh monogram to
`project.layers`. Generating twice — the normal way a user iterates on frame size, letters, or
stone size — left two, three, four overlapping monograms stacked on the canvas, each of which had
to be found and deleted by hand from the Layers list.

"One monogram per product" is the intent. But a blunt "delete the old one every time" destroys
work the user put in by hand: a user who generates a monogram, then opens Design and drags it into
position, resizes the frame, or rotates the whole set, must not have that silently wiped by the
next Generate.

## 2. The ownership model

A generated layer carries **`monogramSetId`** — a string identifying the generation it came from.
It is MONO-019's per-generation suffix, reused verbatim: `assignInsertionLayerIds()` already
computes one `` `${Date.now().toString(36)}-${counter}` `` per Generate and stamps it into every
layer's `id`; MONO-020 additionally writes it to `layer.monogramSetId`.

`monogramSetId` is **identity only**. It is never parsed, never range-checked, never used to decide
anything except *which layers belong to the same monogram*. In particular the `mono-` id prefix is
**not** a second channel for the same information — see §5.

At Generate time, every set already in the project (grouped by `monogramSetId`) is classified:

| classification | condition | what Generate does |
|---|---|---|
| **replaceable** | *every* layer carrying that `monogramSetId` is unchanged since generation | removed before the new monogram is inserted |
| **released** | *any* layer carrying that `monogramSetId` has changed since generation | left exactly where it is; the new monogram is inserted alongside it |

"Changed since generation" means **either** a Design-authored data marker (Stamp/Paint/Erase)
**or** a placement change (move / resize / rotate) — see the predicate section below.

Classification is **set-level, not layer-level**. If the frame of a set is edited but its letters
are not, the whole set — frame *and* letters — is released. A per-layer rule would delete the
untouched letters and leave an orphan frame.

Every `monogramSetId`-bearing set is considered, not just the most recently generated one, so a
project that somehow holds two replaceable monograms converges to one on the next Generate.

### Release is the only way two monogram sets coexist — and where MONO-019's suffix is load-bearing

After MONO-020 the replace path always leaves exactly one monogram standing, so two sets can be in
one project **only** because at least one of them was released (hand-edited in Design). Those two
sets can have the identical `frameId` + `layoutId` — the user generates, edits, generates again
with the same settings. `MonogramGenerator.generate()` gives both the identical base ids
(`monogram-<frame>-<layout>-…`), so the **only** thing separating the released set's layer ids from
the new set's is MONO-019's per-generation suffix — and, because a real user does this back to
back, the suffix's `Date.now().toString(36)` segment is frequently identical between the two
generations. The `monogramGenerationCounter` segment is then the sole guarantor of uniqueness for
every layer id in the project (and for `validateProject()`'s `Duplicate layer id` gate). MONO-019's
`counter % 36³` is not a nicety here; the release path is the case that makes it load-bearing.
`tools/test-mono-006-monogram-ui.mjs`'s "released-set id collision" test forces exactly this — a
`Date.now()` collision with the counter carrying uniqueness — and prints both segments.

### The type-agnostic predicate

`hasDesignAuthoredEdits(layer)` (near `assignInsertionLayerIds()` in `app.js`) returns `true` if
**either** half fires.

**Marker half** — any of these arrays is non-empty, or `naturalBoundingBoxMm` is defined:

- `regions` — Paint tool (RS-3011 Step 10b)
- `stampedStones` — Stamp tool (RS-3011 Step 12)
- `eraseDaubs` — Eraser daubs (RS-3011 Step 13)
- `erasedGridPositions` — persistent erased-stone snapshots
- `naturalBoundingBoxMm` — the frozen natural-space box an Outline-mode Eraser cut sets

These are exactly the five Design-authored `path` fields `app.js` already forwards into geometry
generation (the `params` object built in `generatePathStonesLive()`).

**Placement half** — any snapshotted `monogramPlacement` field differs from the layer's current
value. Move / resize / rotate — `onShapeMoved` → `setLayerPosition` (`l.x`/`l.y`), `onShapeResized`
(`l.x`/`l.y`/`l.w`/`l.h`), `onShapeRotated` (`l.rotationDeg`), plus `nudgeSelection()` and
Align/Distribute — write these fields and, unlike Stamp/Paint/Erase, leave **no marker of their
own**. Without this half, "generate → drag the monogram into position → generate again" silently
deletes the positioned set. So at insertion `assignInsertionLayerIds()` records
`layer.monogramPlacement` = `captureMonogramPlacement(layer)`:

- `x`, `y`, `rotationDeg` — always (they are universal layer fields with a well-defined `0`
  default). In particular a generated **frame carries no `rotationDeg` key**, so snapshotting only
  "the fields it carries" would miss a frame rotation entirely — this is a deliberate widening.
- `w`, `h` — only when present (the box-shaped frame has them; a text letter never does).

**Excluded from the snapshot:** `authoredScale`, `heightMm`, `stoneSize`/`stoneSizeMm`, `color`,
`weightSizesMm`, `letterSpacing`. Those are *regenerate-from-parameters* concepts — changing a
letter's stone size or colour through the ordinary controls is not a Design edit, it's a parameter
the next Generate would re-apply anyway. `recoverStaleAuthoredScales()` also rewrites
`authoredScale` on its own (grepped: it only ever does `delete l.authoredScale`, never a placement
field), so a plain re-render must not look like an edit.

**Comparison is at display precision, not raw float equality.** `writeSelectedControlsToLayer()`
rewrites `l.x`/`l.y`/`l.rotationDeg` from the `#textX`/`#textY`/`#rotationDeg` inputs on *every*
ordinary control edit of a selected text layer, and `setLengthField()` → `readLengthField()` rounds
to 2 display decimals on the way through. A multi-letter monogram letter's generated `x` is a
full-precision offset (real value observed: `-13.162527517437937`), so selecting that letter and
changing its stone size rewrites `l.x` to `-13.16` — a ~0.0025 mm drift. A strict `!==` would flag
that as a placement edit and release the set, breaking the milestone's core promise. The predicate
therefore compares `formatLengthDisplay(current, project.units)` against
`formatLengthDisplay(recorded, project.units)` for lengths (and `.toFixed(2)` for the angle): the
benign round-trip is invisible, every real move still shows. The `test-mono-006` "NO FALSE
POSITIVE (display rounding)" test pins this with the observed value.

**Neither half branches on `layer.type`.** In practice today it is a **placement change** — a
move, resize or rotate — that releases a set. The marker half currently releases nothing through
the UI: as of the MONO-020 merge a stamp, paint daub or erase cannot be applied to a generated
monogram frame at all (see "Reachability of the marker half" below, and the `docs/BACKLOG.md`
row). The marker half stays in the predicate regardless — it is correct and costs nothing to
evaluate, and it starts firing the moment that defect is fixed. A **letter is already movable in
Design** (`'text'` is in `syncFromProjectLayers()`'s filter), so the placement half releases a set
the moment a letter is dragged, and that is the *only* kind of edit a letter can carry until
Design's Paint/Stamp/Erase toolset is extended to text. When it is, those same marker field names
will appear on `text` layers and this predicate covers them **without modification**.

### Reachability of the marker half

Observed in the browser after the MONO-020 merge — recorded here as behaviour, with no cause
diagnosed:

- The **Stamp** tool places nothing anywhere on a generated monogram frame, and reports nothing.
- The **Select** tool cannot select a generated monogram frame in Design — clicking it selects
  nothing.
- With the monogram's letter layers deleted, leaving only the frame, Stamp works on the frame
  normally.
- Stamp, Paint and Erase all work normally on an ordinary Design-drawn path layer.

So the **marker half** of the predicate — `regions` / `stampedStones` / `eraseDaubs` /
`erasedGridPositions` / `naturalBoundingBoxMm` — cannot be produced on a monogram through the UI
today. Every release currently comes from the **placement half**. The marker half is kept in the
predicate deliberately: it is correct, it costs nothing to evaluate, and it becomes effective the
moment the mark tools can reach a monogram frame. The defect is filed as a P0 row in
`docs/BACKLOG.md` (found by MONO-020A).

### Why release-on-edit, not clear-on-edit

An alternative: clear `monogramSetId` the moment a layer is edited in Design, so an edited set
simply stops being "a monogram" and the classification above never sees it.

Rejected. MONO-021 ("flatten to Design") needs to walk a released set by its shared identity to
convert it into permanent Design-owned geometry. If the identity is erased on the first edit, a
half-edited set (frame edited, letters not) is no longer addressable as a unit. `monogramSetId` is
therefore **never cleared on edit** — a released set keeps its identity indefinitely; only MONO-021
will decide what to do with it.

### Why no confirmation dialog

Generate never asks "replace the existing monogram?". Undo is a single keystroke, the removal and
the insertion are one history step (§3), and a modal in front of an undoable action is friction for
no safety gain. The genuinely destructive case — wiping hand-work — is prevented structurally by
release, not by a prompt the user learns to dismiss.

## 3. The change in `generateMonogram()`

Between `assignInsertionLayerIds()` and the `project.layers.push(...)`:

1. `assignInsertionLayerIds()` now returns `{ layers, suffix }`; `suffix` is the new set's
   `monogramSetId`.
2. Partition the existing `project.layers` by `monogramSetId` into released / replaceable, using
   `hasDesignAuthoredEdits()` (marker **or** placement).
3. **`commitHistory()` first — before the removal** — so the removal *and* the insertion land in a
   single undo step. `HistoryManager` snapshots the whole project; one undo restores the previous
   monogram exactly, one redo re-applies the replacement.
4. Filter the replaceable layers out of `project.layers`, then `push(...result.layers)`. The filter
   and the push are one synchronous block — `project.layers` is never observed empty, so this does
   **not** route through `deleteLayer()` (whose last-layer guard and own `commitHistory()` would
   both misfire).
5. `updateAll(true, true)` — `forceStoneRebuild`. A direct `project.layers` filter bypasses the
   Design tool's `drawingTool.deleteSelected()` / `onShapeDeleted()` hook exactly the way the
   Layers-list trash icon does, which is why `deleteLayer()` passes `forceStoneRebuild=true`.
   Without it, generating while the Design workspace is open leaves the removed frame's Paper.js
   shape painted on the canvas. This is now unconditional (the first generation forces a rebuild
   too), matching how every other structural mutation refreshes.

### Status line

One dedicated sentence per case — **not** a concatenation of parts — then the pre-existing
MONO-011/MONO-014 frame-auto-shrink note appended unchanged:

| situation | status sentence |
|---|---|
| nothing removed, nothing released | `Generated monogram (N layers).` |
| a replaceable set was removed | `Replaced the previous monogram (N layers).` |
| a set was released | `Kept your edited monogram and added a new one (N layers).` |
| both in one Generate | `Replaced the unedited monogram and kept your edited one (N layers).` |
| frame stones auto-shrank | ` Frame stones reduced to <size> to fit.` appended |

`N` is the new monogram's layer count in every case — the same referent the original
`Generated monogram (N layers).` used.

## 4. `duplicateLayer()`

`duplicateLayer()` clones a layer via `JSON.parse(JSON.stringify(l))`, which copies both
`monogramSetId` and `monogramPlacement`. One added statement —
`delete copy.monogramSetId; delete copy.monogramPlacement` — drops them from the clone: a
deliberate duplicate is the *user's* copy, not the Lightbox's, and must survive the next Generate
rather than being silently removed as a replaceable monogram layer.

## 5. Pre-MONO-020 projects, and why the id prefix is not the marker

Monogram layers in `.rhs` files saved before MONO-020 carry **no `monogramSetId`** (and no
`monogramPlacement`). The classification in §2 requires a non-empty string `monogramSetId`, so those
layers are neither replaceable nor released — they are invisible to the ownership logic and Generate
stays purely additive for them. A layer with no `monogramPlacement` is likewise not "moved" on that
basis alone. That cohort degrades to exactly the current behaviour. This is deliberate: there is no
migration and no retroactive ownership.

Matching on the `mono-` id prefix to catch that cohort is **explicitly rejected.** Layer ids are
identity, constrained by SEC-001's `LAYER_ID_PATTERN` (`/^[A-Za-z0-9_-]{1,64}$/`); putting
semantics — "this is a monogram, and Generate may delete it" — into a substring of the id would be
a parallel, fragile channel for state that `monogramSetId` already holds cleanly. A user who
renamed a layer, or a future id-format change, would silently break it. New monograms get the
marker; old ones do not; that is the whole rule.

## 6. Tests

`tools/test-mono-006-monogram-ui.mjs`:

- **Harness:** `buildScenario()` passes a recording spy for the 21st sandbox positional
  (`updateAll`), exposed as `sandbox.updateAllCalls`, so tests can assert the `forceStoneRebuild`
  argument.
- **Test 5/6 (rewritten):** first Generate inserts (one history step); second Generate *replaces*
  (layer count unchanged, set 1 ids gone, set 2 ids present, history grew by exactly one); one undo
  restores set 1 via `assert.deepEqual` on the **full layer objects**; redo returns to set 2. Both
  Generate calls' `updateAll` argument lists are printed and asserted `[true, true]`.
- **Negative control (pre-MONO-020 cohort):** pre-existing layers with `MonogramGenerator`'s
  deterministic `monogram-circle-single-frame` / `monogram-circle-single-letter-0` ids — exactly
  what a `.rhs` saved before this milestone holds — and **no** `monogramSetId`. A prefix-matching
  implementation (the one §5 rejects) would delete both; the classification never touches them.
  Pre- and post-Generate counts and full id lists printed.
- **Released set (marker):** three separate cases — `stampedStones`, `eraseDaubs`,
  `naturalBoundingBoxMm` — each asserting the owned set survives, the new set is added alongside,
  total count grows, and the status line reports the release.
- **Released set (placement):** move / resize / rotate the frame — three separate cases, each
  reproducing the exact field writes `onShapeMoved` / `onShapeResized` / `onShapeRotated` perform
  (those hooks are outside this file's slice) after a real `generateMonogram()` — the set is
  released. Plus **a moved *letter*** releases the whole set (frame + letters) — the case the
  marker tests can't reach, since letters take no stamps. (And, as of the MONO-020 merge, the
  three marker cases above build an input state that cannot be produced through the UI on a
  monogram at all — see "Reachability of the marker half" and the `docs/BACKLOG.md` P0 row — so
  the placement half is the only half these tests exercise against a state a user can create
  today. The marker assertions are kept for when that is fixed.)
- **NO FALSE POSITIVE:** generate, then apply things that are *not* edits — several `updateAll`
  cycles, a stone-size and colour change on a monogram letter, a selection change — and assert the
  set is still **replaced**, with the placement snapshot vs live values printed side by side. A
  second variant round-trips a full-precision letter `x` through
  `formatLengthDisplay`/`displayValueToMm` (the `writeSelectedControlsToLayer()` path) and asserts
  the ~0.0025 mm drift is *not* a placement edit.
- **Undo restores replaceability:** generate, move the set (`commitHistory()` then the write),
  undo, generate again — the set is replaced, because the placement snapshot came back with the
  undo.
- **Released-set id collision:** Generate → put `stampedStones` on set 1's frame → Generate (set 1
  released, set 2 added) → Generate (set 2 replaced, set 1 kept). All three generations use the same
  `frameId`+`layoutId`. Asserts and prints: the final id list; the two surviving `monogramSetId`
  values and that they differ; both suffixes' `Date.now()` segments (which collide, back to back)
  and their counter segments (which do not); that the third generate's status line carries **both**
  clauses in one message, deterministic order (`Replaced …` then `Kept …`); and that
  `validateProject()` accepts the final project.
- **`monogramSetId` + `monogramPlacement` persistence:** a project carrying both passes the real
  `validateProject()` (which preserves them — S-200 permissive pass-through) and round-trips
  through `JSON.stringify`/`parse` byte-for-byte (`deepEqual` on the whole project).
- **Partial edit:** frame edited, letters not — the whole set (including the untouched letters)
  survives. Pins set-level ownership.
- **`duplicateLayer()`:** source assertion that it deletes `copy.monogramSetId` (no test in the
  repo *executes* `duplicateLayer()` — `test-variable-stone-sizes.mjs` test 9 and
  `test-shapes-design-consolidation.mjs` test 6 both assert on its source), plus a sandbox check
  that a `monogramSetId`-less layer survives the next Generate.
- **MONO-020 × MONO-019:** regenerate, regenerate, undo, regenerate, then run the real
  `validateProject()` over the result — asserts unique ids and a valid project. The final id list
  is printed. (Uniqueness here is guaranteed by the replace path leaving one set; the
  released-set collision test above is the one that stresses the counter.)

`tools/test-mono-019-layer-ids.mjs` — the slice now starts at `MONOGRAM_PLACEMENT_LENGTH_FIELDS`
and includes `captureMonogramPlacement()` (which `assignInsertionLayerIds()` calls);
`extractAssignInsertionLayerIds()` unwraps the new `{ layers, suffix }` return so its id-focused
call sites are unchanged, and `.raw` exposes the un-unwrapped function for test 8, which pins the
`{ layers, suffix }` shape: `suffix` a non-empty string, every returned layer's
`monogramSetId === suffix` and `id` ending with `suffix`.

No committed geometry baseline moves. `MonogramGenerator.js` is byte-identical to `develop`.
