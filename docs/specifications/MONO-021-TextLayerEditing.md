# MONO-021 — Every Design tool works on a text layer

## Task ID

MONO-021

## Title

Making Stamp, Trace, Eraser (both modes) and Paint operate on a `type: 'text'` layer — so that
*generate a monogram → edit it in Design → apply it to the mug* actually works — without flattening
the letter to a path, and as a general text-layer capability rather than a monogram special case.

## Status

**In progress.** Branch `feature/mono-021-text-marks` off `develop` @ `abbd878`. Local only —
Sasha merges `--no-ff` and runs `--all` / `--group documentation` himself.

Commit sequence:

1. `MONO-021: specify Design tool support on text layers` — this document + the `docs/BACKLOG.md`
   changes in §12. No code.
2. `MONO-021: apply stamped and erased stones to text layers` — the frozen-box transform, the
   engine application block in `generateTextLayout()`, tests. (+ correction:
   `MONO-021: centre text layers on their pre-edit bounds` — the `generateTextStonesLive()` placement fix.)
3. `MONO-021: recolour text layer stones inside paint regions` — `_applyTextRegions()`, tests.
   (+ correction: `MONO-021: revert the pre-gesture paint panel gating` — the Paint target is not
   the selected layer, so there is no correct *pre-gesture* signal to gate the panel on; reporting
   colour-only moves to commit 5, after the target resolves.)
4. `MONO-021: text layers become mark targets` — `tagMarkTarget()` widened to `'path'` or `'text'`,
   `item.data.markStones` on the text proxy, the proximity resolver
   (`TEXT_MARK_PROXIMITY_FACTOR = 1.0`), `markStones` refresh at every rebuild site, the RS-3015
   doc/comment corrections, tests. **Not** `onPaintStroke`/disc candidates — see the split note in §6.
5. `MONO-021: accept text layers in every Design tool hook` — the three mark hooks widened, the
   corridor-erase text branch, disc paint candidates + bbox culling, the `onPaintStroke` text branch
   + colour-only status message, the four edit fields into `generateTextStonesLive()`'s call
   directly (never `buildTextLayoutBaseParams()`, per `recoverStaleAuthoredScales()`),
   `refreshStoneGroupForLayer()` text dispatch, tests.

Corrections land as follow-up commits, never amends.

---

## 1. The governing principle

**A text layer's stones are its geometry.**

Every tool operates on the base stones `GeometryEngine.generateTextLayout()` produces, expressed in
the layer's own frozen natural space. **No contours are ever synthesised for a text layer. No glyph
outline is ever required.**

This is load-bearing, not a convenience. `GeometryEngine.resolveTextPolygons()` **throws** for
`rs-block` and `rs-modern` — those fonts supply authored stone centres, not vector glyphs
(`generateTextLayout()`'s `authoredStones.length > 0` branch). They are being retired from the
*monogram picker* separately (FONT-LIB-007, §12), but they remain ordinary text fonts and, once Text
mode reaches the Design toolset, will hit every code path in this milestone. Any code that resolves a
text layer's outline is a wrong turn — report it, do not build it.

**Nothing in this milestone may branch on whether a text layer came from the monogram generator.**
Monogram letters get this for free because they are ordinary `type: 'text'` layers.

### 1.1 Why not flatten

Flatten was diagnosed and rejected on measured evidence (prompt author, `develop` @ `abbd878`):
script `"QW"` / Great Vibes / SS6, flattened to a path layer and regenerated in outline mode, gives
275 stones against the original 279, and only **35 of 279 (12.5%)** land within 0.001 mm of their
original position — 79 (28.3%) within 0.25 mm. Negative control (same comparison, flattened set
shifted +3 mm in x, matched at 0.25 mm): **2 of 279**. The chain visibly re-phases at the exact
moment the user asks to edit it. A flattened letter also stops being retypable / regenerable /
resizable-by-font-size. MONO-021 keeps the letter `type: 'text'` with its `text` / `font` / `height`
intact.

---

## 2. Tool by tool

| Tool | On a `'path'` layer today | On a `'text'` layer (this milestone) |
|---|---|---|
| **Stamp** | appends to `stampedStones` | identical |
| **Trace** | appends to `stampedStones` | identical |
| **Eraser — Stones** | snapshots into `erasedGridPositions`, splices `stampedStones` | identical |
| **Eraser — Outline** | boolean-subtracts `contours`; the fill reflows | suppresses every base stone inside the swept corridor and splices stamped stones inside it; surviving beads **do not move** |
| **Paint** | masks the region and **resamples** it at the region's own stone size, gap, fill mode | **recolours** the base stones inside the region — colour only, no size / gap / re-gridding |
| **Select** | works | already works (RS-3012 Step 3), unchanged |

Two behaviours deliberately diverge from the path layer.

### 2.1 Why Paint on text is colour-only

Three measurements, all on script `"QW"` / Great Vibes / SS6 / 279 beads, with a 25 mm square lasso
over the middle of the chain covering 36 beads:

1. **Resample empties the painted stretch — it does not merely degrade.** Through the real shipped
   `_applyPathRegions()` with a genuine `regions[]` entry: **35 beads removed, 0 placed.** Negative
   control at the *same* stone size also placed **0**. `_applyPathRegions()` clips region candidates
   to points inside the shape polygons, and on a stroke one stone wide almost none survive that
   clip.
2. **Restyling with a size change is unmanufacturable.** Painting those 36 beads from SS6 to 3.2 mm
   in place, positions untouched: **53 overlapping pairs, worst penetration 1.163 mm** — a third of
   the painted stone's diameter.
3. **Thinning the chain to absorb a size change is a real option, not this milestone's.** A greedy
   drop rule keyed to `stoneSize + gap` fails its own negative control: run at the *original* stone
   size it removes 19 beads that should stay, because the shipped chain already contains neighbour
   pairs at **2.093 mm**, tighter than `stoneSize + gap`. Correct thinning needs the touching
   threshold and its own goldens — filed (§12), not built.

Colour-only cannot produce an invalid design, needs no outline, and two-tone monograms are a real
product. Per-letter stone size is already a layer property for the size case.

A text region carries the same `{id, contour, stoneSizeMm, gapMm, color, fillMode}` shape a path
region does, so `.rhs` stays uniform and `hasDesignAuthoredEdits()` needs no change. On a text
region **`stoneSizeMm`, `gapMm` and `fillMode` are stored and ignored** — nothing is re-gridded, so
there is no pitch to honour. This is commented at the field and stated here. The Paint inspector
**hides or disables the stone-size and gap controls when the target is a text layer**, rather than
offering a control that silently does nothing.

### 2.2 Why the Outline eraser sweeps instead of cutting

A text layer has no fill to reflow. Cutting a boundary and letting the fill redistribute is exactly
what a path layer does and exactly what must not happen here — it would move beads the user never
touched, the same defect that disqualified flatten. So on a text layer, Outline mode reuses
`buildEraserCorridorPolygons()` to get the swept corridor, then applies it as a shape-defined erase:
base stones inside the corridor go into `erasedGridPositions`, stamped stones inside it are spliced
out of `stampedStones`. The same two fields Stones mode writes. **Nothing is added to `eraseDaubs`**
— that field stays path-only and legacy.

---

## 3. Data model

A `'text'` layer gains four optional fields, with the **same names, same shapes and same
natural-space convention** a `'path'` layer already uses. The engine reuses the path normalizers
verbatim (`normalizePathRegions()`, `normalizePathStampedStones()`, `normalizePathErasedGridPositions()`,
`normalizeNaturalBoundingBoxMm()` in `GeometryEngine.js`):

- `stampedStones[]` — `{id, xMm, yMm, sizeMm, color}`
- `erasedGridPositions[]` — `{xMm, yMm}`
- `regions[]` — `{id, contour, stoneSizeMm, gapMm, color, fillMode}`
- `naturalBoundingBoxMm` — `{minXmm, minYmm, maxXmm, maxYmm}`

`validateProject()` (`app.js`) is permissive and passes unknown layer fields through the `{...l}`
spread, exactly as it does for a path layer's `regions` / `stampedStones`. No schema change. This is
verified empirically by round-tripping a stamped + recoloured + erased text layer through save and
load (§9 control 7 / §11 step 9), not assumed.

`.rhs` files saved before this milestone have none of the fields and render byte-identically —
the whole application block in `generateTextLayout()` is a strict no-op when all four are absent or
empty.

### 3.1 The frozen reference box

A path layer roots its natural space in its own `contours` via `computeNaturalContourTransform()`.
A text layer has no `contours` and no `w`/`h` box, so it needs its own reference. This reuses the
frozen-box pattern RS-3014 Step 3 established for cut path layers:

- The reference is the axis-aligned bounding box of the layer's **base text stones** — the stones
  `generateTextLayout()` produces *before* any edit is applied, in the engine's own pre-`app.js`-
  offset coordinate space (see §5.1).
- `naturalBoundingBoxMm` is captured **once**, at the first edit of any kind on that layer, by the
  `app.js` hook that writes that first edit — never by the engine, never rewritten.
- Edits are stored `(0,0)`-rooted relative to that frozen box (stored point = absolute-at-edit-time
  minus the box min corner), exactly as a path layer's are relative to its `(0,0)`-rooted contours.
- On every regeneration they are placed by an affine box→box map from the frozen box onto the
  layer's **current** base-stone bounds. A letter that is moved, resized, or has its stone size
  changed carries its edits with it.

**Trap (named in a comment at the transform):** the "current bounds" in that map must always be the
base stones' bounds, computed *before* any edit is applied. Using post-edit bounds makes the map
circular — a stamp placed outside the letter grows the box, which silently moves every other edit on
the layer.

The two helpers split across the two files **exactly as `computeNaturalContourTransform()` (forward,
in `GeometryEngine.js`) and `absolutePolygonsToNaturalSpace()` (app-facing inverse, in
`PaintRegionSelection.js`) already do** — `PaintRegionSelection.js` imports *from* `GeometryEngine.js`,
never the reverse, and `generateTextLayout()` needs the forward helper directly, so putting the
forward helper in `PaintRegionSelection.js` would create an import cycle. No second
coordinate-conversion implementation is written anywhere. New helpers:

- `computeFrozenBoxTransform(frozenBoxMm, currentBoundsMm)` — **`src/geometry/GeometryEngine.js`,
  next to `computeNaturalContourTransform()`.** Returns `{xMm, yMm, scaleX, scaleY}` in the shape
  `applyNaturalContourTransform()` already consumes (`p → xMm + p.xMm * scaleX`), so a `(0,0)`-rooted
  stored edit maps straight onto the current base-stone bounds. Returns `null` for a missing or
  degenerate (zero-width/height) box.
- `absolutePointsToFrozenBoxSpace(pointsAbsoluteMm, frozenBoxMm, currentBoundsMm)` —
  **`src/geometry/PaintRegionSelection.js`, next to `absolutePolygonsToNaturalSpace()`.** The
  inverse, the text counterpart of `absolutePolygonsToNaturalSpace()`, used by the `app.js` hooks to
  convert an absolute click / lasso into stored `(0,0)`-rooted form. At the first edit,
  `currentBoundsMm` *is* `frozenBoxMm`, so this reduces to `absolute − boxMin`.

### 3.2 Rotation

Edits are **not** rotated. `generatePathLayout()` deliberately does not rotate
`regions` / `stampedStones` / `eraseDaubs` / `erasedGridPositions` (its own doc comment). A text
layer's base stones are already rotated by the engine (`rotationDeg` is baked into their positions
before `app.js`'s offset), so the frozen box is the AABB of the rotated base stones and edits map
onto rotated base-stone bounds without themselves rotating — matching the path layer's "each overlay
is independent, a rotated layer with existing overlay data visibly desyncs until a future milestone"
architecture exactly.

### 3.3 Degenerate case

A text layer whose base text produces zero stones (empty text, unknown font, failed manifest) has no
reference bounds and therefore no transform. Edits become unplaceable and are silently skipped — the
same graceful degradation `generatePathLayout()` gives a null transform on empty contours. **Do not
throw.**

### 3.4 Retyping an edited layer

If the user retypes an edited text layer, the frozen box is **kept** and edits are remapped onto the
new base-stone bounds — they rescale proportionally rather than being discarded. Discarding a user's
paint and stamp work because they fixed a typo is worse.

---

## 4. Engine

Everything is applied inside `GeometryEngine.generateTextLayout()`, not in `app.js`. Two
load-bearing reasons: `docs/ARCHITECTURE.md` requires geometry to be computed exactly once, in the
engine; and Design's canvas reads a text layer's stones by filtering the global layout
(`getTextLayerStones`, `app.js`), so putting the work in the engine makes the Design preview correct
for free with no second code path.

Order of application mirrors `generatePathLayout()`: **regions → erased positions → stamped
stones.** Regions recolour base stones; erased positions then suppress base stones but never stamped
ones; stamped stones are appended last with their own identity, removed directly from `stampedStones`
by the caller when erased. Region priority is the same as path — later regions win over earlier ones
for a stone they both cover.

Reused, not cloned: `normalizePathStampedStones()`, the region normalizer,
`ERASED_POSITION_EPSILON_MM = 0.001`, `applyNaturalContourTransform()`.

`_applyTextRegions()` is written as a sibling of `_applyPathRegions()`, with its own doc comment
explaining the colour-only divergence and citing the three measurements in §2.1. It takes **no
`shapePolygons` argument** — there is no shape. It places nothing, removes nothing, moves nothing:
it only rewrites `color` on base stones whose centre falls inside a region contour (placed through
the frozen-box transform, `isPointInsidePolygons()` for the interior test — the same primitive
`_applyPathRegions()` uses).

The whole block is a **strict no-op** when all four fields are absent or empty. This is what protects
the frozen baselines (§10).

### 4.1 `naturalBoundingBoxMm` is never set at generate time

`hasDesignAuthoredEdits()` returns `true` for any layer with a defined `naturalBoundingBoxMm`. If
the engine — or `MonogramGenerator` — set it at generation time, every freshly generated monogram
would read as edited and never be replaced by a re-Generate. Neither does. Verified by a test
asserting a freshly generated monogram letter has no `naturalBoundingBoxMm` and
`hasDesignAuthoredEdits()` returns `false` for it.

---

## 5. `app.js` wiring

### 5.1 The base bounding box must survive to `app.js`

`generateTextStonesLive()` computes the layer's on-canvas placement offset from
`result.getBoundingBox()` (`computeTextPlacementOffset()`) and its auto-fit scale from
`result.widthMm`. Once `generateTextLayout()` appends stamped stones — which can sit outside the
letter — that bounding box grows and the whole letter shifts on the canvas, and auto-fit misbehaves.
This is the same circular-bounds hazard as §3.1's trap, in a second place.

Fix: `generateTextLayout()` exposes the **base** (pre-edit) stone bounding box on its returned
`StoneLayout` as an additive field (`baseBoundingBoxMm`, in the spirit of `outlineStats`), a plain
`{minXmm,minYmm,maxXmm,maxYmm,widthMm,heightMm}` object at full precision. It is set on **every**
text layout (edited or not — for an unedited layer it equals `getBoundingBox()`, and the centring
fix needs it there too); `null` for every non-text layout and every pre-milestone layout.
`generateTextStonesLive()` uses `result.baseBoundingBoxMm ?? result.getBoundingBox()` for the
`computeTextPlacementOffset()` box and `result.baseBoundingBoxMm?.widthMm ?? result.widthMm` for the
`computeAutoFitScale()` width, so placement and auto-fit stay anchored to the letter, not to the
stamps. `computeTextPlacementOffsetMm()` (`src/editing/TextPlacement.js`) reads only
`.widthMm`/`.minXmm`/`.heightMm`/`.minYmm`, all present on the plain object, so this is a drop-in
with no adapter. `app.js:2788`'s *other* `computeTextPlacementOffset()` call is fed
`resolveTextPolygons()`'s glyph-outline box, which never sees edits, and is left unchanged.

### 5.2 `generateTextStonesLive()` forwards the four fields

`generateTextStonesLive()` (`app.js`) must forward `regions` / `stampedStones` /
`erasedGridPositions` / `naturalBoundingBoxMm` into `generateTextLayout()`. They are added to the
call's `base` object **directly in `generateTextStonesLive()`**, alongside `authoredScale` — **not**
in `buildTextLayoutBaseParams()`, which MONO-006B's own comment reserves for "the exact same
*natural* layout" `recoverStaleAuthoredScales()` regenerates to validate a persisted `authoredScale`
against; that check must see the pure text layout, without a stamp shifting its bounding-box centre.
This is the identical wiring-gap fix RS-3011 Steps 10b/12/13 made
for `generatePathStonesLive()`. **This exact step has been forgotten three times in this codebase
for three different fields.** Without it an edit is stored on disk and never renders.

### 5.2a Other text-layer bounding-box consumers — audited, unchanged

Every consumer of a text layer's stone bounding box (`getBoundingBox()` / `.widthMm` / `.heightMm` /
`.baseBoundingBoxMm`), and the call on each:

| Site | What it measures | Call |
|---|---|---|
| `generateTextStonesLive()` `computeTextPlacementOffset` + `computeAutoFitScale` | canvas centring / auto-fit of the **letter** | **fixed** — use `baseBoundingBoxMm` (§5.1) |
| `app.js` font-preview (`fitTransform(layout.getBoundingBox(), …)`) | fit a synthetic `font-preview:<id>` layer that never carries edits | no change — box == base |
| `app.js` status bar (`layout.widthMm × layout.heightMm`) | extent of the **whole project** (`engine.generate()`'s `'project'` layout, which has no `baseBoundingBoxMm`) | no change — should include everything |
| `getLayerBBox(l)` — text branch | on-canvas **extent** of the layer, from the global `layout.stones` filter (selection box, alignment, distribute, snap targets) | no change — this measures rendered output, is not a placement *input*, so no circular dependency; a stamp that sticks out legitimately widens the selection box that then moves with the layer |
| `fitTextToShape()` (`app.js:2782`/`2788`/`4627`/`4635`) | glyph outline via `resolveTextPolygons()` | no change — never sees edits |
| `recoverStaleAuthoredScales()` (`app.js:861`) → `scaleAuthoredTextLayout()` | legality of a persisted `authoredScale` against the **pure natural** layout | no change **here**, but §5.2 keeps the edit fields out of `buildTextLayoutBaseParams()` precisely so this call keeps seeing the pure layout |

### 5.3 `getLayerStoneParams()` — no change

Established by reading the code: `getLayerStoneParams()` returns `null` for any non-`'path'` layer,
and Design's text preview flows through `getTextLayerStones` **alone** — a filter over the global
`layout` that `engine.generate()` already produced this tick — never through `getLayerStoneParams`
(`app.js` comments at the `getTextLayerStones` hook and `rebuildAllStoneGroups()` /
`rebuildTextStoneGroupForShape()` in `DrawingCanvasTool.js` confirm the two rebuild paths are
disjoint by `isTextProxy`). So `getLayerStoneParams()` stays `'path'`-only and untouched.

### 5.4 The tool hooks

`onStampPlace` / `onTracePlace` / `onEraseSweep` each do
`project.layers.find(l => l.id === layerId && l.type === 'path')`. Each is widened to accept
`'text'`, and the natural-space conversion is routed through the frozen-box transform
(`absolutePointsToFrozenBoxSpace()`) when the target is a text layer, capturing
`naturalBoundingBoxMm` from the current base-stone bounds on the first edit if the layer has none.
The Paint commit path that writes `regions` does the same.

`onEraseSweep`'s `mode === 'outline'` branch currently boolean-subtracts `targetLayer.contours`. A
text branch is added **before** it: take the corridor polygons, convert to frozen-box space, drop
base stones inside them into `erasedGridPositions` and splice stamped stones inside them out of
`stampedStones` — never reaching the contour-cutting code.

Trace's `'no-stones'` reject reason (currently `stonesGenerated === false`, path-only) means, for a
text target, that the layer rendered zero base stones. Same reason code, same message shape.

`refreshStoneGroupForLayer()` (`DrawingCanvasTool.js`) currently always calls the `'path'`
`rebuildStoneGroupForShape()`. It is widened to dispatch to `rebuildTextStoneGroupForShape()` for a
text proxy and to refresh that proxy's `markStones` (§6.3).

---

## 6. Design canvas — mark and paint target resolution

### 6.0 The commit-4 / commit-5 split

`absolutePolygonsToNaturalSpace()` (`PaintRegionSelection.js`) opens with `pathLayer.contours.map(…)`
— a `TypeError` for a text layer. `onPaintStroke` hands its resolved target straight to that
function. So the moment a text layer becomes a Paint *candidate* (disc geometry in
`resolvePaintTargetTwoPass()`), `onPaintStroke` must also have its text branch, or Paint on a letter
throws. Those two ship together, in **commit 5**.

Stamp is not symmetrical: `onStampPlace` does
`.find(l => l.id === layerId && l.type === 'path')`, gets `undefined` for a text layerId, and
reports "cannot hold stamped stones" with no mutation — a safe no-op. So **commit 4** makes text a
*mark* target (Stamp/Trace/Eraser resolution) without wiring any hook; the observable effect is a
click on a letter's beads that used to place a stone on the frame beneath now refuses instead.
Commit 5 makes the refusal into an actual edit.

### 6.1 Eligibility

`tagMarkTarget()` (`DrawingCanvasTool.js`) defaults `markEligible` to `layer.type === 'path'`.
Widened to `'path'` or `'text'`. That function's doc comment and the RS-3015 comment block at
`resolveMarkTargetByBounds()` (which describes text as permanently skipped) are both updated — they
are now wrong.

### 6.2 Mark resolution — proximity, not bounding box

`resolveMarkTargetByBounds()` uses `shapes[i].item.bounds.contains(point)` — an axis-aligned
bounding-box test. The stacking hazard is far larger than the old BACKLOG row implies: a script
`"QW"` letter's bbox is 101.9 × 57.1 mm = **25.8 % of a 150 mm circle frame's own box**; a
traditional-three `"QWE"` letter set spans a 25.9 % union of an 80 mm frame's box. Under a bbox test
a mark aimed at the ring lands on a letter across a quarter of the frame.

So a text proxy resolves by proximity to a real bead:

- `materializeTextItemFromLayer()` already receives the layer's stones (to compute its bounds).
  They are stashed as `item.data.markStones` — `[{x, y, d}]`, absolute project-mm.
- An item carrying `markStones` is "contained" when the point lies within
  `TEXT_MARK_PROXIMITY_FACTOR * d` of some bead's centre. `TEXT_MARK_PROXIMITY_FACTOR = 1.0` — one
  full stone diameter from a centre. At SS6 that is 2 mm, which keeps a chain continuous (Great
  Vibes' chain pitch is 2.093–2.587 mm, so the midpoint between neighbours falls inside) while
  leaving the frame ring reachable everywhere else. Named, not inlined.
- Everything else about the walk is unchanged: topmost-first, ineligible proxies stay transparent
  and set `blockedByIneligible`. An item with no `markStones` (every non-text proxy) keeps the
  `item.bounds.contains()` test.

### 6.3 `markStones` goes stale

It must be refreshed wherever a text layer's stone Group is rebuilt. The refresh lives in **one**
place — `rebuildTextStoneGroupForShape(shapeId, stones)` (`DrawingCanvasTool.js`), the single
function through which a text proxy's stones ever change — which sets
`shape.item.data.markStones` from its `stones` argument before building the sprite Group.
`materializeTextItemFromLayer()` also sets it on the fresh proxy. Every rebuild site
(re-grepped at implementation time) then covers `markStones` for free:

| Site | Reaches a text proxy? | markStones refresh |
|---|---|---|
| `materializeTextItemFromLayer()` | yes — the proxy builder | sets it directly |
| `rebuildTextStoneGroupForShape()` | yes — the one stone-change point | sets it directly |
| `rebuildAllStoneGroups()` (zoom bucket) | dispatches to `rebuildTextStoneGroupForShape` for `isTextProxy` | via the above (zoom doesn't move beads, but the refresh is harmless and keeps one code path) |
| `onMouseUp` drag/rotate commit | dispatches to `rebuildTextStoneGroupForShape` | via the above |
| `syncFromProjectLayers()` new-layer branch | `materializeTextItemFromLayer` + `rebuildTextStoneGroupForShape` | both |
| `syncFromProjectLayers()` existing-text branch | re-materializes (bounds/rotation change) + `rebuildTextStoneGroupForShape` (gated `boundsChanged \|\| rotationChanged \|\| forceStoneRebuild`) | both — see the gap note below |
| `rebuildStoneGroupForShape()` | no — `getLayerStoneParams()` returns null for non-`path` | n/a |
| `refreshShapeGeometryForLayer()` | no — Outline-eraser contour cut, `path` only | n/a |
| `refreshStoneGroupForLayer()` | **not today** — always calls the `path` rebuild; the tool hooks that call it are `path`-only until commit 5 | **commit 5** widens it to dispatch text → `rebuildTextStoneGroupForShape`, at which point the hooks route text edits through it |
| `duplicateShapeForLayer()` | **no** — `app.js`'s `duplicateLayer()` only calls it for `XYWH_SHAPE_TYPES`; a duplicated *text* layer is re-materialized by the next `syncFromProjectLayers()` tick instead | n/a |

**Gap (commit 5's to close):** `syncFromProjectLayers()`'s existing-text branch only rebuilds the
Group when the proxy's *bounds* change. A stamp added inside the letter's bbox, or a Paint recolour,
does not move the bounds — so after commit 5 the tool hooks must call `refreshStoneGroupForLayer()`
(which commit 5 makes dispatch to `rebuildTextStoneGroupForShape` unconditionally) for the immediate
refresh, exactly as the `path` hooks already do.

### 6.4 Paint target resolution — commit 5

(Ships with `onPaintStroke`'s text branch, per §6.0.)

`resolvePaintTargetTwoPass()` (`app.js`) filters candidates to `l.type === 'path'` and builds each
candidate's `polygons` from `resolvePathPolygons()`. A text layer has no contours, so it needs
different candidate geometry: **its beads.** One regular 16-gon per base stone at that stone's own
radius. Those discs are the letter's true physical footprint, which is what `selectPaintTarget()`
intersects a lasso against.

Measured cost (prompt author): a 279-stone script layer produces 279 disc polygons;
`selectPaintTarget()` picks the text layer correctly for a lasso over the lettering at
**142–184 ms per call**; Paint runs two passes per gesture (~300 ms of gesture latency); a lasso that
misses everything measured **591 ms**.

**Required mitigation:** cull text candidates by cheap axis-aligned bounding-box overlap against the
lasso *before* handing them to `selectPaintTarget()`. Before/after gesture latency is reported for
both the hit case and the miss case in the commit message.

---

## 7. Persistence and ownership

- `validateProject()` — no schema change; verified empirically (§3, §9 control 7).
- Pre-milestone `.rhs` files render byte-identically.
- `hasDesignAuthoredEdits()` already returns `true` for any layer with non-empty
  `regions` / `stampedStones` / `erasedGridPositions`, or any `naturalBoundingBoxMm`, and its own
  comment says it was written unbranched on `layer.type` for this milestone. **Nothing changes
  there.** A test proves it fires for an edited text layer against an unedited control, and confirms
  nothing in the generation path sets `naturalBoundingBoxMm` at generate time.
- MONO-020 ownership: an edited monogram letter releases its set (a re-Generate keeps it and adds a
  new one — the `"Kept your edited monogram and added a new one"` message) because
  `hasDesignAuthoredEdits()` now sees its `stampedStones` / `regions` / `erasedGridPositions` /
  `naturalBoundingBoxMm`. No code needed for this — it falls out of the field names.

---

## 8. Baselines that must not move

Committed goldens. If any changes, **stop and report — do not re-baseline, do not adjust anything to
match.**

- MONO-013 goldens: 372 / 369 stones, 136.501458 / 131.901458 mm
- The three regression fixtures: 147 / 66 / 441
- MONO-015: Step 1 = 85, Step 2 = 68
- MONO-016 test 1 per-layout counts: 202 / 361 / 300 / 374 / 372

---

## 9. Verification — seven negative controls

Three separate milestones in this project shipped a check that could not fail. For each of these the
passing value **and** the control value are printed:

1. **Edits are a no-op when absent.** Generate a text layer's stones with no edit fields, and with
   all four present but empty. Both counts printed and asserted equal to the pre-milestone value.
   Control: one stamped stone → count differs.
2. **The proximity resolver discriminates.** Sample a grid across a framed script monogram's frame
   interior; print the percentage of points that resolve to the letter under the new proximity test
   and under the old `item.bounds.contains()` test. The prompt author's bbox figure is 25.8 % of the
   frame box; the proximity figure must be dramatically smaller. Both printed.
3. **Paint recolours and does nothing else.** Print base stone count and every stone's position and
   size before and after a region is applied. Count, positions, sizes unchanged; only `color` inside
   the region differs. Control: the same assertion form against a *path* layer, which must show
   positions changing — this proves only that the "positions unchanged" assertion *can* fail. It is
   **not** evidence for the §2.1 "0 placed" figure (a different geometry, and it drops-and-resamples
   rather than placing zero); that figure stays a standalone measurement, unre-derived here.
4. **Outline erase removes only what the corridor covers.** Print counts inside and outside the
   corridor, before and after. Control: an empty corridor removes nothing.
5. **Edits track placement.** Move an edited text layer by a known offset; print a stamp's absolute
   position and a region's absolute contour bounds before and after. Control: the un-moved case
   changes nothing.
6. **Ownership fires.** `hasDesignAuthoredEdits()` on an edited text layer vs an unedited one — both
   booleans printed.
7. **Old files still open.** Load a `.rhs` saved before this milestone and print its total stone
   count against the same file's count on `develop` @ `abbd878`.

Every new `app.js` / canvas branch is reached by driving a real pointer gesture, not by calling the
hook directly — RS-3015's commit 2 shipped three unreachable branches whose tests passed because they
called the hooks. Per-test lines are reported for every test file, including unmodified ones.

---

## 10. My measured numbers (prompt author, `develop` @ `abbd878`)

Reported here as the design basis; re-measured in commit 2 on a fresh checkout with the real
`MonogramGenerator` + `GeometryEngine` + shipped fonts. Any disagreement is reported unreconciled —
neither side is adjusted.

Canvas 220 × 220 mm throughout, SS6 (`stoneSizeMm: 2.0`), Great Vibes `stemWidthRatio` `0.0357`.

| case | measurement |
|---|---|
| script `"QW"`, Great Vibes, `frameId: 'none'`, frameRect 150 mm | 1 layer; 279 stones; bbox 101.9 × 57.1 mm |
| script `"QW"`, Great Vibes, `frameId: 'circle'`, frameRect 150 mm | 2 layers (frame 0, letter 1); `totalStoneCount` 1206, `frameStoneCount` 927 |
| script `"QWE"`, Great Vibes, `frameId: 'circle'`, frameRect 150 mm | FAILS `chain-too-thin`, 0.679 stems vs 0.70 |
| script `"QWE"`, Great Vibes, `frameId: 'none'`, frameRect 150 mm | succeeds, 365 stones |
| traditional-three `"QWE"`, rs-block, circle, frameRect 80 mm | 4 layers, frame / Q (−19.779) / E (+19.779) / W (0.000); `totalStoneCount` 324, `frameStoneCount` 272 |
| Great Vibes `"Q"` at 20 mm, stone 2.0, gap 0.2 | 35 beads, nn pitch min 2.093 / mean 2.178 / max 2.587 mm |
| real `regions[]` resample over 36 beads of the `"QW"` chain, 3.2 mm | 35 removed, **0 placed**; same at 2.0 mm — also **0 placed** |
| in-place restyle of those 36 beads to 3.2 mm | 53 overlapping pairs, worst penetration 1.163 mm |
| `COMMON_SCALING_LIMITS_MM` (`src/geometry/FrameLibrary.js`) | 20–150 mm on both axes |

---

## 11. Browser verification

Chrome-channel Playwright, isolated instance (never `main` / `airbnb`). Steps (report what is seen
at each, with screenshot paths; prior-step screenshots + scratch deleted with `du -sh` before/after):

1. Monogram lightbox: Great Vibes, Script, `QW`, SS6, frame Circle, 150 mm. Generate.
2. Design → Stamp, click directly on a bead of the lettering → stone added to the letter layer,
   status names the letter layer, not the frame.
3. Same tool, click inside the frame ring away from any bead → stone on the **frame**, as before.
4. Eraser, Stones, sweep three beads of the lettering → gone, still gone after a redraw.
5. Eraser, Outline, sweep a corridor across one stroke → every bead under the corridor removed, the
   surrounding beads do not move (before/after screenshots from the identical viewport).
6. Trace along a stroke → a spaced run of stones on the letter layer.
7. Paint, lasso a group of beads, red, apply → exactly those beads red, original positions, original
   size, rest untouched. Stone-size and gap controls hidden/disabled — report what is seen.
8. Select the letter layer, drag 20 mm → every stamped / traced / recoloured change moves with it,
   erased gaps stay erased.
9. Save, reload → steps 4–8 survive.
10. Re-open the Monogram lightbox, Generate with the same settings → the MONO-020 released-set
    message (`"Kept your edited monogram and added a new one"`), **not** the replaced message.
11. Add a plain **Text** layer, font **rs-block**, repeat steps 2, 4, 5, 7. This is the font whose
    `resolveTextPolygons()` throws — every tool must behave identically. Any misbehaviour means an
    outline dependency has crept in somewhere; find and report it rather than special-casing the
    font.

---

## 12. `docs/BACKLOG.md` changes (commit 1)

- **Mark-tool row (MONO-020A):** RS-3015 delivered the fall-through and the status messages;
  MONO-021 delivers the editability. Any wording implying RS-3015 made letters editable is corrected.
- **Stacking-order row (MONO-021, currently the "Flatten…" row):** rewritten. The hazard was a
  bounding-box test covering 25.8 % of the frame box; MONO-021 answers it with proximity resolution
  and makes the letters editable without flattening. Flatten itself is rejected on measured evidence
  (§1.1).
- **SS6-ceiling row (MONO-015):** it reads as "three-letter interlocked script fails above SS6."
  Measured: three-letter Great Vibes at SS6 fails `CHAIN_TOO_THIN` (0.679 vs 0.70) even at the
  150 mm cap **whenever there is a frame**, and only succeeds with `frameId: 'none'`. Rewritten as
  "three letters need no frame at all at SS6."
- **New row — chain thinning for painted stone size.** Paint on text is colour-only because a size
  change either empties the stretch (resample: 0 placed) or overlaps (restyle: 53 pairs). Thinning
  would make size work but needs the touching threshold, not `stoneSize + gap` — a naive rule
  removes 19 beads at the original size. Its own milestone and goldens.
- **New row — FONT-LIB-007.** Retire `rs-block` and `rs-modern` from the monogram font picker only.
  Precedent: FONT-LIB-005 retired Montserrat from the picker while retaining the binary so saved
  projects render unchanged. 16 monogram test files and 36 test files overall reference these two
  font ids and are expected to be unaffected because the engine keeps the fonts — **that expectation
  must be verified, not assumed, when FONT-LIB-007 is scoped.** Not implemented here.
- **New row — Playwright is imported by eight repo files** (`tools/**`) and is not declared in
  `package.json`; `npm ci` removes it and browser verification is lost. Use `npm install`.
- **New row — Stamp on a `stonesGenerated: false` path layer** shows no ghost circle but places a
  stone anyway, while Trace on the same layer refuses. Pre-dates RS-3015. Needs a decision, not a
  fix now.
