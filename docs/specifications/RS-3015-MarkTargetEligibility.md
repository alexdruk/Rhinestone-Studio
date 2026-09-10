# RS-3015 — Mark-tool target eligibility, and the end of the silent discard

## Task ID

RS-3015

## Title

Making Stamp / Trace / Eraser resolve their target past a non-`'path'` layer proxy instead of
landing on it and being discarded in silence — first reported as "Stamp places nothing on a
generated monogram frame."

## Status

**Shipped.** Three commits on `feature/rs-3015-mark-eligibility` off `develop` @ `ef1abba`
(the MONO-020A merge). Local only — Sasha merges and pushes.

  1. `RS-3015: diagnose the mark-tool target defect and correct the BACKLOG row` — this document
     plus the `docs/BACKLOG.md` row rewrite. No source changes.
  2. `RS-3015: skip non-path layers in mark target resolution and report rejected marks` — the
     resolver skip + `markEligible` flag + `onStampPlace`'s messaging.
  3. `RS-3015: report Trace and Eraser marks that resolve nothing` — the correction below (§4B
     revised). Commit 2's `if(!layerId)` branches in `app.js`'s `onTracePlace` / `onEraseSweep`
     were **unreachable** — `DrawingCanvasTool.js`'s own `onMouseUp` discards a resolved-nothing
     Trace/Eraser gesture *before* those hooks fire. This commit gives Trace/Eraser their own
     reason-carrying reject hooks, adds a single `tagMarkTarget()` tagging helper, and removes the
     dead branches.

---

## 1. The resolution chain, as it stood at `ef1abba`

Stamp, Trace and Eraser all resolve *which existing layer a manually-placed mark belongs to*
through one function:

- `resolveMarkTargetByBounds(point)` — `src/drawing/DrawingCanvasTool.js`. Reverse-iterates
  `board.listShapes()` (push-ordered oldest-first, so reverse visits topmost-first) and returns
  `{ layerId, blockedByIneligible }` for the **first** shape whose **axis-aligned bounding box**
  (`item.bounds.contains(point)`, Paper.js's own `Rectangle#contains`) contains the point AND
  carries `item.data.markEligible === true`, else `{ layerId: null, blockedByIneligible }`.
  `blockedByIneligible` is `true` when some shape's bounds *did* contain the point but it was
  skipped for `markEligible !== true` — the module knows an ineligible shape was there without
  ever learning its type.
  - `resolveTargetLayerIdByBounds(point)` — the bare-`layerId` form; `resolveStampTargetLayerId()`
    delegates straight to it (Stamp always calls `onStampPlace`, `layerId` may be null).
  - `resolveTraceTarget(points)` — builds a temp path from the drag's buffered points and resolves
    its `bounds.center` through `resolveMarkTargetByBounds`.
  - `resolveEraserTarget(points)` — calls `resolveMarkTargetByBounds` per buffered point, first
    non-null wins (RS-3014 Step 5); `blockedByIneligible` is sticky across the walk.

This is **deliberately separate** from `hitTestShapeId()` (`:1461`), Select's own click-to-pick,
which uses strict fill containment (`item.contains(point)`) plus a stroke-proximity fallback. Select
must select nothing when a click lands in genuinely empty space between two shapes; a mark tool,
by contrast, wants the looser bounding-box test so a stamp dropped into a shape's hollow interior
still tracks that shape.

### What is on the board

`syncFromProjectLayers()` (invoked from `app.js:2367`) materializes a Paper.js proxy for every
layer of type `'path'`, `'svg'`, `'image'`, `'text'`, `'circle'`, `'rectangle'` and every
shape-library kind. Each proxy carries `item.data.layerId`.

- A `'path'` layer materializes as its real outline (`materializeShapeFromLayer`).
- A `'text'` layer materializes as a **plain axis-aligned rectangle** over its stones' bounding box
  (`materializeTextItemFromLayer`, `DrawingCanvasTool.js:890`). It has no relation to the glyph
  shapes — it is a bbox.
- `'svg'` / `'image'` / `'circle'` / `'rectangle'` / shape-library each get their own proxy kind.

### The three handlers

`app.js` then routes the resolved `layerId` through one of three hooks, each of which **required a
`'path'` layer and returned in silence otherwise**:

| hook | definition | guard |
|---|---|---|
| `onStampPlace`  | `app.js:1459` | `app.js:1461` — `project.layers.find(l=>l.id===layerId&&l.type==='path')` then `if(!targetLayer)return;` |
| `onTracePlace`  | `app.js:1508` | `app.js:1510` — same |
| `onEraseSweep`  | `app.js:1577` | `app.js:1579` — same |

`onStampRejected()` (`app.js:1448`) had already established the opposite contract for the
active-selection case: a mark that places nothing **says so** in `el('status')`.

---

## 2. Why a monogram was the first report

A `'script'`-layout monogram is emitted as **one** `'text'` layer for the whole joined string, not
one per letter: `MonogramGenerator.js:1263` joins the letters (`joinedText`), builds a single
`letterLayerObj` at `:1502`, and returns `[frameLayerObj, letterLayerObj]` at `:1534`. (The
non-script layouts differ — `:1099` builds one `letterLayerObj` per letter — but each is still a
`'text'` layer.)

The frame is a real `'path'` layer (`MonogramGenerator.js:1485`, `type: 'path'`). The single joined
text layer's bbox proxy therefore covers most of the frame's interior and, being materialized after
the frame, sits **above** it in `board.listShapes()`.

So:

- A mark **on the monogram** — anywhere the joined-string bbox covers — resolved the **text**
  layer. `onStampPlace` / `onTracePlace` / `onEraseSweep` saw a non-`'path'` layer and returned in
  silence. Nothing placed, no message.
- A mark **inside the frame but off the string's bbox** resolved the **frame** and worked normally.

Both confirmed in the browser.

### There is no Select defect

`hitTestShapeId()` selects a monogram frame correctly — verified in the browser (Inspector shows
"Circle Frame", the Layers row highlights, the outline recolours). The earlier BACKLOG row's claim
that "clicking it selects nothing" was **wrong** and is deleted, not softened. `hitTestShapeId()`
is untouched by this milestone.

---

## 3. The defect is not monogram-specific

Every non-`'path'` layer that `syncFromProjectLayers()` puts on the board shadows whatever sits
under its bounding box the same way: an imported `'svg'` (`app.js:4728`, `type:'svg'`), a `'circle'`,
a `'rectangle'`, a shape-library shape. A mark dropped on any of them resolved that layer and was
discarded in silence. Monograms are just the first case a customer hit — the generated frame makes
the "a mark just off the shape works, a mark on it does nothing" contrast unusually easy to notice.

---

## 4. The corrections

### A. Mark eligibility travels as item data (commits 2–3)

`DrawingCanvasTool` never reads `project.layers` (enforced by
`tools/test-architecture-module-boundaries.mjs`). The resolver must not ask a layer's type; it
reads a flag stamped at sync time.

Commit 2 stamped `item.data.markEligible = <that layer>.type === 'path'` next to every one of the
**twelve** `item.data.layerId` writes. Commit 3 replaces all twelve with one module-private helper,
`tagMarkTarget(item, layer)`, that sets `layerId` and `markEligible` together — `board.replace-
ShapeItem()` carries no `data` across, so every item swap must re-set both, and twelve hand-written
copies of `layer.type === 'path'` guarantee drift. The twelve: `commitFinalizedShape`; the
`syncFromProjectLayers` brand-new-proxy loop; the `syncFromProjectLayers` reconcile loop-top (which
re-asserts on every synced layer, every tick); its seven reconciliation branches (each swaps in a
fresh item via `board.replaceShapeItem()` after a bounds / rotation / content change);
`refreshShapeGeometryForLayer` (an Outline-mode Eraser cut); and `duplicateShapeForLayer` — the one
exception, which has no `layer` object and runs for *every* `XYWH_SHAPE_TYPES` layer (not just
`'path'`, contrary to commit 2's comment), so the clone inherits the **source proxy's** own flag.

`tagMarkTarget()`'s doc comment states the resolver is **fail-closed**: `markEligible !== true` is
skipped, so a future stamp site that sets `layerId` but forgets the helper turns a genuinely drawn
`'path'` shape into a silent mark-rejecter, indistinguishable from empty canvas.

`resolveMarkTargetByBounds()` then **skips** any shape whose `item.data.markEligible !== true` and
keeps iterating to the shape below it. It does **not** return `null` on hitting an ineligible
shape — falling through to the frame underneath is the entire point — but it does remember that an
ineligible shape covered the point (`blockedByIneligible`), so a subsequent all-the-way-down miss
can be reported as `'ineligible'` rather than `'no-target'`.

`hitTestShapeId()` is untouched: Select still hits every shape.

The resolver's doc comment previously justified bounding-box containment with "an imported SVG with
an open center where a user still wants to place a stamp." That case can no longer reach the
resolver — an SVG layer is `'svg'`, not `'path'`, so it is now skipped. The comment now says the
bounding-box test still matters for a genuinely hollow **`'path'`** layer (a hand-drawn ring, an
`evenodd` outline with a hole).

### B. The silent discard goes — all three tools (commits 2–3)

Commit 2 rewrote `app.js`'s `onStampPlace` / `onTracePlace` / `onEraseSweep` to write a status
message instead of returning in silence. But for **Trace and Eraser** that was dead code:
`DrawingCanvasTool.js`'s own `onMouseUp` resolves the target and discards a resolved-nothing
gesture *before* `onTracePlace` / `onEraseSweep` is ever called, so commit 2's `if(!layerId){…}`
branches there were unreachable, as was `onTracePlace`'s non-`'path'` branch (`getLayerStoneParams`
returns `null` for a non-`'path'` layer, killing the gesture at `!styleParams` upstream). Correction
A made it worse: after A, a Trace/Eraser gesture over an unframed monogram falls *through* the
ineligible proxy to nothing, resolves null, and is discarded silently.

Commit 3 moves the reporting into `DrawingCanvasTool.js`'s `onMouseUp`:

- **Stamp** is unchanged — `onStampPlace` is always called (`layerId` may be null) and already
  messages the null and non-`'path'`-race cases. `onStampRejected` gains a `reason` argument for
  signature parity; its one value is `'outside-selection'` and its message is unchanged.
- **Trace**: `onTraceRejected(reason, layerId)`. `reason` is one of —
  - `'no-target'` — nothing eligible under the stroke at all.
  - `'ineligible'` — a shape *was* under it, but only drawn (`'path'`) shapes hold marks. Known
    from `resolveTraceTarget()`'s `blockedByIneligible`, **not** from any layer type.
  - `'no-stones'` — a real `'path'` layer whose stones are not generated yet. After correction A a
    non-null `layerId` here is necessarily `'path'`, so a null `styleParams` can only mean
    `stonesGenerated === false`; the message points at the **Generate Stones** button, not at "this
    layer can't hold stones", and `layerId` is passed so `app.js` can name the layer.
  - `'outside-selection'` — RS-3012's case, its exact wording kept.
- **Eraser**: new hook `onEraseRejected(reason)` — `'no-target'` or `'ineligible'` only. Eraser has
  no `'no-stones'`: it targets the `'path'` layer regardless, and `onEraseSweep` already reports
  "Nothing to erase on \<layer\>" for one that holds no stones.

`app.js` maps each `reason` to its own `el('status').textContent`, following `onStampRejected`'s
convention. Commit 2's now-unreachable branches (`onTracePlace`'s `if(!layerId)` and its non-`'path'`
branch, `onEraseSweep`'s `if(!layerId)`) are deleted; `onEraseSweep`'s non-`'path'` branch — commit
2's twin of `onTracePlace`'s — is reduced to the same bare `if(!targetLayer)return;` race guard.
No history session and no mutation in any rejection path, exactly as before.

`tools/test-rs3015-mark-target-eligibility.mjs` gains six gesture-driven cases (each drives a real
Trace/Eraser `mousedown → mousedrag* → mouseup` through `paper.tool` and asserts both the `reason`
and the exact `el('status')` string, the latter by executing `app.js`'s own handler source).

---

## 5. Machine fact registered

`tools/test-documentation-consistency.mjs` (the check FONT-LIB-005 added) now also fires on a
BACKLOG row containing the phrase **`silently discards a mark on a non-path layer`**, keyed to the
machine fact that `markEligible` appears in `src/drawing/DrawingCanvasTool.js`. Once the fix ships,
the row must carry the `**Resolved by` marker or the check fails — so commit 2 both ships the fix
and marks the row resolved.

---

## 6. Not done here

- **MONO-021** (flatten a monogram into ordinary Design layers) names this defect as its blocker.
  RS-3015 removes the blocker, but MONO-021's own row and milestone doc are left untouched — its
  scope is still unspecified and belongs to that milestone.
- Unifying Select across every layer type (the long-deferred "RS-3012 Decision 1" direction) is
  unrelated and untouched.
