# RS-3015 — Mark-tool target eligibility, and the end of the silent discard

## Task ID

RS-3015

## Title

Making Stamp / Trace / Eraser resolve their target past a non-`'path'` layer proxy instead of
landing on it and being discarded in silence — first reported as "Stamp places nothing on a
generated monogram frame."

## Status

**Shipped.** Two commits on `feature/rs-3015-mark-eligibility` off `develop` @ `ef1abba`
(the MONO-020A merge). Local only — Sasha merges and pushes.

  1. `RS-3015: diagnose the mark-tool target defect and correct the BACKLOG row` — this document
     plus the `docs/BACKLOG.md` row rewrite. No source changes.
  2. `RS-3015: skip non-path layers in mark target resolution and report rejected marks` — the
     implementation.

---

## 1. The resolution chain, as it stood at `ef1abba`

Stamp, Trace and Eraser all resolve *which existing layer a manually-placed mark belongs to*
through one function:

- `resolveTargetLayerIdByBounds(point)` — `src/drawing/DrawingCanvasTool.js:1494`. Reverse-iterates
  `board.listShapes()` (push-ordered oldest-first, so reverse visits topmost-first) and returns
  `shapes[i].item.data.layerId` for the **first** shape whose **axis-aligned bounding box**
  (`item.bounds.contains(point)`, Paper.js's own `Rectangle#contains`) contains the point, else
  `null`.
  - `resolveStampTargetLayerId(point)` — `:1513` — delegates straight to it.
  - `resolveTraceTargetLayerId(points)` — `:1527` — builds a temp path from the drag's buffered
    points and resolves its `bounds.center`.
  - `resolveEraserTargetLayerId(points)` — `:1550` — calls `resolveTargetLayerIdByBounds` per
    buffered point, first non-null wins (RS-3014 Step 5).

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

## 4. The two corrections

### A. Mark eligibility travels as item data

`DrawingCanvasTool` never reads `project.layers` (enforced by
`tools/test-architecture-module-boundaries.mjs`). The resolver must not ask a layer's type; it
reads a flag stamped at sync time.

Every site that stamps `item.data.layerId` onto a board item also stamps
`item.data.markEligible = <that layer>.type === 'path'`:

- `DrawingCanvasTool.js:2178` — `commitFinalizedShape` (a freshly drawn shape; always `'path'`, but
  the expression is written out, not hardcoded `true`, so it cannot drift from the sync sites).
- `DrawingCanvasTool.js:4504` — `syncFromProjectLayers`, the brand-new-proxy loop.
- `DrawingCanvasTool.js:4365` — `refreshShapeGeometryForLayer` (an Outline-mode Eraser cut
  re-materializes a `'path'` item).
- `DrawingCanvasTool.js:4274` — `duplicateShapeForLayer` (Paper.js `clone()` already copies
  `data.markEligible`; re-asserted explicitly so the site stays visibly in step).
- `DrawingCanvasTool.js:4556 / 4585 / 4610 / 4634 / 4658 / 4668 / 4681` — the seven
  `syncFromProjectLayers` reconciliation branches, each of which swaps in a fresh item via
  `board.replaceShapeItem()` after a bounds / rotation / content change. `board.replaceShapeItem()`
  does **not** carry `data` across from the old item, so without these a resized / rotated /
  re-materialized `'path'` layer would silently lose its `markEligible` flag and stop being a valid
  mark target — the reason the two sites the diagnosis first named were not enough.

`resolveTargetLayerIdByBounds()` then **skips** any shape whose `item.data.markEligible !== true`
and keeps iterating to the shape below it. It does **not** return `null` on hitting an ineligible
shape — falling through to the frame underneath is the entire point.

`hitTestShapeId()` is untouched: Select still hits every shape.

The function's doc comment previously justified bounding-box containment with "an imported SVG with
an open center where a user still wants to place a stamp." That case can no longer reach the
resolver — an SVG layer is `'svg'`, not `'path'`, so it is now skipped. The comment is corrected to
say the bounding-box test still matters for a genuinely hollow **`'path'`** layer (a hand-drawn
ring, an `evenodd` outline with a hole).

### B. The silent discard goes

`onStampPlace`, `onTracePlace` and `onEraseSweep` now write a status message instead of returning
in silence, matching `onStampRejected()`'s contract. Two distinct situations, two distinct
messages:

- **No target at all** (`layerId` is `null`) — nothing under the gesture.
- **Target resolved but not a `'path'` layer** — after correction A this is a narrow race (the
  layer was deleted or changed type between resolution and the handler), but it is still named
  rather than swallowed: the message names the layer via `layerLabel(l)`.

No history session and no mutation in either case, exactly as before.

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
