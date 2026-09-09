# MONO-020 — Monogram ownership: replace on generate, release on Design edit

**Status:** implemented. Branch `feature/mono-020-monogram-ownership` off `develop` @ the MONO-019
merge (`cff7959`). Local only — not pushed.

**Authorises:** the Monogram Lightbox owning the layer set it generated, so a second Generate
*replaces* the previous monogram instead of stacking a new one on top of it — but only while that
set is untouched. The moment the user edits a monogram layer in the Design workspace, the set is
*released*: the next Generate leaves it in place and adds the new monogram alongside. No change to
`MonogramGenerator.js`. No geometry change — no screenshots.

Builds directly on MONO-019's `assignInsertionLayerIds()` (the shared per-generation suffix is now
also the set identity).

---

## 1. The problem

Before MONO-020, every click of **Generate** in the Monogram Lightbox appended a fresh monogram to
`project.layers`. Generating twice — the normal way a user iterates on frame size, letters, or
stone size — left two, three, four overlapping monograms stacked on the canvas, each of which had
to be found and deleted by hand from the Layers list.

"One monogram per product" is the intent. But a blunt "delete the old one every time" destroys
hand-work: a user who generates a monogram, then opens Design and paints extra stones onto the
frame or erases part of a letter, must not have that silently wiped by the next Generate.

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
| **replaceable** | *every* layer carrying that `monogramSetId` is free of Design-authored data | removed before the new monogram is inserted |
| **released** | *any* layer carrying that `monogramSetId` has Design-authored data | left exactly where it is; the new monogram is inserted alongside it |

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

`hasDesignAuthoredEdits(layer)` (near `assignInsertionLayerIds()` in `app.js`) returns `true` if any
of these arrays is non-empty, or `naturalBoundingBoxMm` is defined:

- `regions` — Paint tool (RS-3011 Step 10b)
- `stampedStones` — Stamp tool (RS-3011 Step 12)
- `eraseDaubs` — Eraser daubs (RS-3011 Step 13)
- `erasedGridPositions` — persistent erased-stone snapshots
- `naturalBoundingBoxMm` — the frozen natural-space box an Outline-mode Eraser cut sets

These are exactly the five Design-authored `path` fields `app.js` already forwards into geometry
generation (the `params` object built in `generatePathStonesLive()`).

The predicate **deliberately does not branch on `layer.type`.** Today only `path` layers carry
these fields, so in practice it is the frame layer that gets released. But when Design's toolset is
extended to text layers (Paint/Stamp/Erase on letters), those same field names will appear on
`text` layers, and this predicate must cover them **without modification**. Keying on field
presence rather than layer type is what makes that true.

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
   `hasDesignAuthoredEdits()`.
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

One line, composed from up to three clauses (the third is the pre-existing MONO-011/MONO-014
frame-auto-shrink note):

| situation | status line |
|---|---|
| nothing removed, nothing released | `Generated monogram (N layers).` |
| a replaceable set was removed | `Replaced the previous monogram (N layers).` |
| a set was released | `Kept your edited monogram and added a new one (N layers).` |
| both happened in one Generate | both sentences, in that order |
| frame stones auto-shrank | ` Frame stones reduced to <size> to fit.` appended |

`N` is the new monogram's layer count in every case — the same referent the original
`Generated monogram (N layers).` used.

## 4. `duplicateLayer()`

`duplicateLayer()` clones a layer via `JSON.parse(JSON.stringify(l))`, which copies
`monogramSetId`. One added statement — `delete copy.monogramSetId` — drops it from the clone: a
deliberate duplicate is the *user's* copy, not the Lightbox's, and must survive the next Generate
rather than being silently removed as a replaceable monogram layer.

## 5. Pre-MONO-020 projects, and why the id prefix is not the marker

Monogram layers in `.rhs` files saved before MONO-020 carry **no `monogramSetId`**. The
classification in §2 requires a non-empty string `monogramSetId`, so those layers are neither
replaceable nor released — they are invisible to the ownership logic and Generate stays purely
additive for them. That cohort degrades to exactly the current behaviour. This is deliberate: there
is no migration and no retroactive ownership.

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
- **Released set:** three separate cases — `stampedStones`, `eraseDaubs`, `naturalBoundingBoxMm` —
  each asserting the owned set survives, the new set is added alongside, total count grows, and the
  status line reports the release.
- **Released-set id collision:** Generate → put `stampedStones` on set 1's frame → Generate (set 1
  released, set 2 added) → Generate (set 2 replaced, set 1 kept). All three generations use the same
  `frameId`+`layoutId`. Asserts and prints: the final id list; the two surviving `monogramSetId`
  values and that they differ; both suffixes' `Date.now()` segments (which collide, back to back)
  and their counter segments (which do not); that the third generate's status line carries **both**
  clauses in one message, deterministic order (`Replaced …` then `Kept …`); and that
  `validateProject()` accepts the final project.
- **`monogramSetId` persistence:** a project carrying `monogramSetId` passes the real
  `validateProject()` (which preserves the field — S-200 permissive pass-through) and round-trips
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

`tools/test-mono-019-layer-ids.mjs` — `extractAssignInsertionLayerIds()` unwraps the new
`{ layers, suffix }` return so its id-focused call sites are unchanged; `.raw` exposes the
un-unwrapped function for test 8, which pins the `{ layers, suffix }` shape: `suffix` a non-empty
string, every returned layer's `monogramSetId === suffix` and `id` ending with `suffix`.

No committed geometry baseline moves. `MonogramGenerator.js` is byte-identical to `develop`.
