# IMG-020 — Image stones in Design

**Status: built.** File:line citations are against `develop` @ `fcc6b16` (the IMG-019 merge). Every
anchor below was re-grepped on that tip. The Step 0 figures come from a real browser (Chrome, headless,
isolated context) on that tip. The rebuild figures, T1 to T5 and every mutant result come from a
scratch copy of the tree with D1 to D4 applied, served and tested the same way. The copy lives in the
session scratchpad, not under `tools/scratch/`.

## Objective

In Design, an `'image'` layer shows only its rectangle proxy, with no stones. The proxy comes from
`materializeSvgImageItemFromLayer()`, and its stone group from `rebuildStoneGroupForShape()`. That
function asks `app.js`'s `getLayerStoneParams()` for style params, and the hook returns null for any
layer that is not `'path'`, so the group is torn down.

`'text'` avoids this by drawing its stones straight from the layout. `getTextLayerStones()` filters
`layout.stones` by `layerId`, and `DrawingCanvasTool.js` routes text proxies to
`rebuildTextStoneGroupForShape()`.

IMG-020 gives `'image'` the same route. Design draws an image layer's stones from the layout that
`engine.generate()` already produced, never from a second call into `GeometryEngine`. The image keeps
its rectangle proxy and its box model for move, resize and rotate.

## Step 0: what Design draws today

Each layer type Design materializes was put alone on a Flat Sheet (150 × 150 mm), imported through
the Import dialog's project input, then Design was entered. "Layout" is the number of `layout.stones` for that
layer. "Design group" is `debugStoneState(layerId).stoneGroupCount`.

| Type | Layout | Design group | Stones drawn |
|---|---|---|---|
| `path` (`examples/boolean-union-badge.rhs`) | 227 | 227 | yes |
| `text` ("AB", RS Block) | 38 | 38 | yes |
| `svg` (`examples/svg-logo-import.rhs`) | 221 | 0 | **no** |
| `image` (butterfly, import defaults) | 1266 | 0 | **no** |
| `circle` | 61 | 0 | **no** |
| `rectangle` | 78 | 0 | **no** |
| `star` (shape library) | 65 | 0 | **no** |

Circle, rectangle and star were created through the Shapes grid and the butterfly through the Image
input, then each was re-imported alone. Screenshots are in the report, not in the repository.

**Butterfly at import defaults.** `~/Downloads/butterfly2_original.jpeg` (800 × 747) through the Image
input on a default Flat Sheet: `computeDefaultImagePlacement()` gives x 10, y 14.31, 130 × 121.39 mm,
Staggered, SS6, gap 0.3, vividness 1.4, subject mask, Auto colours. 1266 stones. (IMG-017's 1261 is
the same image at 129.6 mm wide on a mug.)

**Reconcile timing on `fcc6b16`.** `syncFromProjectLayers()` called 100 times with the butterfly's
layers and nothing changed: median 0.0 ms, max 0.1 ms (the timer resolution). It does no stone work for
an image today.

**Two more measurements that shape the decisions.**

* Moving the butterfly's box by 7.3 mm (Inspector X) leaves every stone at the same box-relative
  position, to within 1.4e-14 mm, with the same colours. The image sampler is translation-exact.
* Setting its rotation to 30° leaves every stone exactly where it was. Image stones ignore
  `rotationDeg` (see Findings).

## Decisions

### D1. Source of stones: the layout, through an image-specific hook

An image proxy's stones come from the layout, through the same filter `getTextLayerStones()` uses.
Design never calls `GeometryEngine` for an image layer.

* `app.js` gains `layoutStonesForLayer(layerId)`, the body of today's `getTextLayerStones` hook
  (`:2427`): `layout.stones.filter(s=>s.layerId===layerId).map(s=>({x:s.xMm,y:s.yMm,d:s.sizeMm,color:s.color}))`.
  Both `getTextLayerStones` and a new `getImageLayerStones` hook return it. The filter exists once.
* `DrawingCanvasTool.js`'s hook list (`:1126`) gains `getImageLayerStones = () => null` after
  `getTextLayerStones`.

The alternative, generalizing to one renamed hook (for example `getLayoutStones`) and one proxy flag,
changes more tests. Five harnesses pass `getTextLayerStones` by name:
`tools/test-maint-003-materializer-contract.mjs`, `tools/test-mono-021-mark-hooks.mjs`,
`tools/test-rs3012-step4-circle-select.mjs`, `tools/test-rs3012-step5-rectangle-select.mjs` and
`tools/test-rs3015-mark-target-eligibility.mjs`. `test-maint-003` also asserts hook names
(`'getTextLayerStones'`, tests 1a to 1f) and the exact `isTextProxy` flag matrix, with
`image: { ..., isTextProxy: false }` (test 4). A generalization would change all five. The
image-specific hook changes none of them. These harnesses don't pass `getImageLayerStones`, so their
image proxies get the default `null`, read as an empty group.

The image proxy is marked with a new flag, `item.data.isImageProxy = true`. It is set in
`materializeSvgImageItemFromLayer()`'s rectangle fallback (`:804`) when `layer.type === 'image'`, and
not for an unresolvable `'svg'`. `isTextProxy` is not reused. It carries text-only meaning at `:3613`,
`:4516` and in `test-maint-003` test 4.

An image proxy never gets `item.data.markStones`. `markProxyContainsPoint()` (`:1565`) switches any
proxy that carries the array from a box test to bead proximity. That would change RS-3015's
`'ineligible'` reporting for a Stamp, Trace or Eraser gesture landing inside an image's box. So the
image route does not call `rebuildTextStoneGroupForShape()`. The shared tail of that function
(`:2534-2539`: build, `insertBelow`, remove old, `stoneGroups.set`) moves into a new
`installStoneGroupForShape(shape, stones)`, which returns the group. The text function keeps its
`markStones` line and calls the helper. The new `rebuildImageStoneGroupForShape(shapeId, stones)`
calls it too:

* no shape: `removeStoneGroupForShape(shapeId)` and return, as the text version does;
* while this shape's resize is in progress (`interactionKind === 'resize' && shapeId === resizeShapeId`,
  the guard at `:2502`): return, leaving the hidden group as it is (D4);
* otherwise: `stones` (or `getImageLayerStones(layerId) || []` when omitted) through
  `installStoneGroupForShape()`, and `group.data.layoutSignature = layoutStoneSignature(stones)` (D3).

`rebuildStoneGroupForShape()` (`:2420`) dispatches at its top, after the missing-shape check and
before the `getLayerStoneParams()` call at `:2427`: an `isImageProxy` shape goes to
`rebuildImageStoneGroupForShape(shapeId)` and returns. Every caller that reaches an image through the
generic rebuild therefore takes the layout route with no edit of its own (D2).

### D2. Every text dispatch site, and what an image does there

Three sites test `item.data.isTextProxy` (`:2394`, `:3613`, `:4516`). The other three text sites the
brief lists sit at the stated lines inside `syncFromProjectLayers()`, but they test
`layer.type === 'text'`, not `isTextProxy` (`:4692`, `:4737`, `:4809`). All six are covered. The
flag itself is set at `:922`.

| Site | Text today | Image under IMG-020 |
|---|---|---|
| `:922` `materializeTextItemFromLayer()` sets `isTextProxy` | the flag every `isTextProxy` site reads | counterpart: `isImageProxy` set in the rectangle fallback (`:804`), D1 |
| `:2394` `rebuildAllStoneGroups()` (zoom-bucket re-bake) | `rebuildTextStoneGroupForShape()` | unchanged line: the `else rebuildStoneGroupForShape()` branch dispatches to the layout route (D1) |
| `:3613` rotate commit in `onMouseUp` | text rebuild from the current layout | new image branch just before it (D4) |
| `:4516` `refreshStoneGroupForLayer()` | text rebuild, unconditionally | unchanged: falls through to `rebuildStoneGroupForShape()`, which dispatches. No `app.js` caller passes an image today (`:2907` is `'path'` only) |
| `:4692` `materializeForLayer()` | `materializeTextItemFromLayer()` | unchanged: `'image'` stays on `materializeSvgImageItemFromLayer()` at `:4686`, the rectangle proxy |
| `:4737-4738` new-shape stone build | text rebuild | unchanged: the `else rebuildStoneGroupForShape(shapeId)` dispatches |
| `:4809` existing-shape reconcile | bounds from fresh stones | new image branch, placed after the text branch and before `'circle'` (`:4835`), D3 |

Two more generic sites reach an image. `duplicateShapeForLayer()` (`:4472`) rebuilds the clone
through `rebuildStoneGroupForShape()`: Paper's `clone()` copies `isImageProxy`, and the new layer's
stones are not in the layout yet, so the clone gets an empty group, which the next reconcile rebuilds
(D3). The resize commit (`:3575`) gets the same image branch as the rotate commit (D4).

The image keeps its rectangle proxy and its box-based bounds reconcile. The new branch re-materializes
the proxy on exactly the condition the generic `'svg'`/`'image'` branch uses today (`:4883`: AABB
against `layer.x/y/w/h`, or `rotationChanged`). Only the stone decision changes. `replaceShapeItem()`
(`src/drawing/DrawingBoard.js:116`) inserts the new item above the old one, so a group left in place
stays directly below the proxy.

### D3. Refresh trigger: a signature of the layout stones

Image stones change when an Image dialog setting changes and the box does not move (vividness,
colours, mask, fill mode, stone size, seed). The reconcile cannot see that from the box alone.

A new module-level pure function in `DrawingCanvasTool.js`:

```js
function layoutStoneSignature(stones) {
  if (!stones.length) return '0';
  const x0 = stones[0].x, y0 = stones[0].y;
  let h = 2166136261 >>> 0;
  const mix = (v) => { h ^= v | 0; h = Math.imul(h, 16777619) >>> 0; };
  for (const s of stones) {
    mix(Math.round((s.x - x0) * 1000));
    mix(Math.round((s.y - y0) * 1000));
    mix(Math.round(s.d * 1000));
    for (let i = 0; i < s.color.length; i++) mix(s.color.charCodeAt(i));
  }
  return stones.length + ':' + h;
}
```

The count, plus FNV-1a over x, y and d at 0.001 mm and the colour key's characters. x and y are taken
relative to the first stone.

In the new reconcile branch, for an existing image shape:

1. `boxChanged`: `unrotatedLocalBoundsFor(shape.item)` (`:359`) against `layer.x`, `layer.y`,
   `Math.max(RESIZE_MIN_DIM_MM, layer.w)` and `Math.max(RESIZE_MIN_DIM_MM, layer.h)`, 1e-6 tolerance.
   This is computed before step 2 replaces the item.
2. The proxy is re-materialized on today's condition (D2).
3. `stones = getImageLayerStones(layerId) || []`. `signatureChanged` is true when the shape has no
   group, or when the group's `data.layoutSignature` differs from `layoutStoneSignature(stones)`.
4. If `boxChanged || rotationChanged || signatureChanged || forceStoneRebuild`, the branch calls
   `rebuildImageStoneGroupForShape(shape.id, stones)`. Otherwise it leaves the group alone.

This is the brief's rule, with two refinements, each pinned by a mutant:

* **The signature is translation-invariant.** A Design move translates the group live (D4). The
  regenerated layout is the same stones shifted by the move, which is exact to 1.4e-14 mm (Step 0). An
  absolute signature would rebuild all 1266 sprites right after every move. A pure translation that
  did not come from a Design drag (Inspector X or Y, undo, redo, import) always moves the box, so
  `boxChanged` still catches it.
* **The box test uses the unrotated local box, not the AABB.** A rotated rectangle's AABB never equals
  `layer.x/y/w/h`. Today that makes `:4883` re-materialize a rotated image's cheap proxy on every
  reconcile. As a stone trigger, it would rebuild every group on every tick.

A Design move of an already-rotated image leaves `item.data.pivotXMm/pivotYMm` where they were (the
move branch does not update them). Its unrotated box then misses by the move once, so that one
reconcile rebuilds. The next re-materialization refreshes the pivot. This costs one rebuild per move
of a rotated image and is accepted.

### D4. Drag behaviour matches the other box layers

* **Move** is unchanged: `onMouseDrag`'s move branch translates the group with the proxy
  (`:3191`), live, with no rebuild. The reconcile after the drop sees no box change and no signature
  change, and does not rebuild.
* **Resize** hides the group at drag start, as today (`:2905`). During the drag,
  `scheduleStoneRebuildForShape()` (`:2597`) reaches `rebuildImageStoneGroupForShape()` through the
  dispatch, and the in-progress-resize guard (D1) returns. No sprite is built mid-drag.
* **Rotate** hides the group at drag start, as today (`:2856`).
* **Drop.** `onShapeResized` and `onShapeRotated` call `updateAll(true)` without awaiting it
  (`app.js:2267`, `:2290`), so `layout` is still the pre-drag layout when `onMouseUp` returns. The
  resize commit (`:3575`) and the rotate commit (`:3613`) each gain an image branch, which runs after
  the drag state is cleared and before the existing rebuild:
  * real change (resize: the commit's own `changed` test, currently scoped inside its `if` at
    `:3549` and hoisted out; rotate: `Math.abs(rotateAppliedDeg) > 1e-6`, captured before
    `rotateAppliedDeg` is reset): the group stays hidden, `group.data.layoutSignature = null`, and the
    branch returns. The next reconcile finds a signature mismatch and rebuilds from the regenerated
    layout. The new group is visible.
  * no change (a handle click): `group.visible = true`, and the branch returns without a rebuild.

`updateAll()`'s generation token (`app.js:2977`, `if(token!==generationToken)return;`) drops any
older in-flight generation, so the first reconcile after a drop reads the post-drop layout. If that
generation throws, `updateAll()` returns before reconciling, and the group stays hidden until the next
successful one.

### D5. Out of scope

* Stamp, Trace, Eraser, Paint and Lasso on image layers. They keep skipping images:
  `tagMarkTarget()` (`:1685`) leaves `markEligible` false and D1 keeps `markStones` off the proxy.
  IMG-021 adds image editing.
* Drawing the source bitmap.
* The other layer types Step 0 found without stones (`svg`, `circle`, `rectangle`, shape library).
  See Findings.

### D6. Performance

A reconcile with no image change does not rebuild the image's group (T3, including a rotated image).

Browser figures for the butterfly (1266 stones) on the scratch build:

| Case | Figure |
|---|---|
| Reconcile, nothing changed, 100 calls | median 0.5 ms, max 1.2 ms, 0 rebuilds (develop: median 0.0 ms, max 0.1 ms) |
| Reconcile, rotated 30°, nothing changed, 50 calls | median 0.9 ms, 0 rebuilds (develop: 0.2 ms) |
| One rebuild, warm sprite cache | 12.6 to 16.6 ms |
| First rebuild on entering Design (cold sprite cache) | 26.6 to 37.6 ms |
| Reconcile with `forceStoneRebuild`, 10 calls | median 15.2 ms (min 12.9, max 18.6) |
| Vividness 1.4 → 1 | 1 rebuild |
| Design move by (15, 5.69) mm | 0 rebuilds |
| Design resize, 10 drag frames | 0 rebuilds during the drag, 1 after (1266 → 929 stones) |

The added cost of an unchanged reconcile (about 0.5 ms) is the layout filter plus the signature, a
linear pass over the layout on every Design reconcile. `forceStoneRebuild` callers (undo, redo, the
Layers trash icon) now pay one image rebuild each.

## Anchors

Every anchor was re-grepped on `fcc6b16`, and the line given is the actual line.

| File | Line | Content |
|---|---|---|
| `src/drawing/DrawingCanvasTool.js` | `:359` | `function unrotatedLocalBoundsFor(item) {` (D3 box test) |
| | `:768` | `function materializeSvgImageItemFromLayer(layer, resolveSvgPolygons) {` |
| | `:804` | `if (!item) return buildRectangleProxyItem(layer);` (D1 sets `isImageProxy` here) |
| | `:839` | `function buildRectangleProxyItem(layer) {` (`layoutStoneSignature()` goes before it) |
| | `:898`, `:922` | `function materializeTextItemFromLayer(...)`, `item.data.isTextProxy = true;` |
| | `:1126` | `getTextLayerStones = () => null` (D1 adds `getImageLayerStones` after it) |
| | `:1565` | `function markProxyContainsPoint(item, point) {` (why images never get `markStones`) |
| | `:1685` | `function tagMarkTarget(item, layer) {` |
| | `:2388`, `:2394` | `rebuildAllStoneGroups()` and its `isTextProxy` dispatch |
| | `:2420`, `:2427` | `function rebuildStoneGroupForShape(shapeId) {`, the `getLayerStoneParams(layerId)` call (D1 dispatch goes before it) |
| | `:2502` | `if (interactionKind === 'resize' && shapeId === resizeShapeId) group.visible = false;` |
| | `:2527`, `:2534-2539` | `function rebuildTextStoneGroupForShape(shapeId, stones) {` and its shared tail (D1 extracts it) |
| | `:2555`, `:2582` | `function buildStoneSpriteGroup(...)`, `symbolItem.data.isStoneDot = true;` (T2 adds `data.color` after it) |
| | `:2597` | `function scheduleStoneRebuildForShape(shapeId) {` |
| | `:2856`, `:2905` | rotate and resize drag start: `stoneGroup.visible = false` |
| | `:3191` | `if (stoneGroup) stoneGroup.translate(incrementalDelta);` (move, D4) |
| | `:3549`, `:3575` | resize commit: `const changed =`, `if (shape) rebuildStoneGroupForShape(finishedShapeId);` |
| | `:3597`, `:3613` | rotate commit: `const finishedShapeId = rotateShapeId;`, the `isTextProxy` dispatch |
| | `:4472` | `duplicateShapeForLayer(sourceLayerId, newLayerId, dxMm, dyMm) {` |
| | `:4505`, `:4516` | `refreshStoneGroupForLayer(layerId) {` and its `isTextProxy` dispatch |
| | `:4674` | `syncFromProjectLayers(layers, forceStoneRebuild = false) {` |
| | `:4686`, `:4692` | `materializeForLayer()`: the `'svg' \|\| 'image'` and `'text'` branches |
| | `:4737-4738` | new-shape stone build (`'text'` branch, `else rebuildStoneGroupForShape(shapeId)`) |
| | `:4762` | `const rotationChanged =` |
| | `:4809`, `:4835` | existing-shape `'text'` and `'circle'` branches (the image branch goes between them) |
| | `:4883`, `:4920` | generic `'svg'`/`'image'` re-materialize, and the generic stone rebuild |
| | `:4935`, `:4940` | `debugStoneState(layerId) {`, `stoneGroupCount: ...` |
| `src/drawing/DrawingBoard.js` | `:116` | `replaceShapeItem(id, newItem) {` (`insertAbove`, z-order kept) |
| `app.js` | `:1647` | `const drawingTool=createDrawingTool(layoutCanvas,{` |
| | `:2254`, `:2267`, `:2290` | `onShapeMoved`, `onShapeResized`, `onShapeRotated` (each calls `updateAll(true)`, not awaited) |
| | `:2339`, `:2341` | `getLayerStoneParams:(layerId)=>{`, `if(!l\|\|l.type!=='path')return null;` |
| | `:2427` | `getTextLayerStones:(layerId)=>layout.stones.filter(...)` (D1) |
| | `:2977` | `async function updateAll(...)` and its generation token |
| | `:3017` | `drawingTool.syncFromProjectLayers(project.layers.filter(...),forceStoneRebuild)` (filter unchanged; already admits `'image'`) |
| | `:1161`, `:1169` | `generateImageStonesLive()`'s two `params` objects, neither carrying `rotationDeg` (Findings) |
| `src/geometry/GeometryEngine.js` | `:1200`, `:2474` | `generateImageLayout(params = {}) {`, `function normalizeImageParams(params) {` (no rotation) |
| `tools/test-mono-021-mark-hooks.mjs` | `:32-89`, `:286` | the harness T1 to T5 reuse; `assertTestRegistered({ ..., group: 'editing', ... })` |
| `tools/test-groups.mjs` | `:362`, `:373` | `editing: [`, `'test-mono-021-mark-hooks.mjs',` |

**Source-text search.** `getTextLayerStones`, `isTextProxy`, `debugStoneState` and the
`syncFromProjectLayers` filter were searched across `tools/`. No test slices `app.js`'s hook object or
the `getTextLayerStones:` line. `rs3012-step5` slices only the filter predicate, which is unchanged.
Every `debugStoneState()` reader takes fields one by one (`test-mono-021-mark-hooks.mjs:145-213`,
`tools/mono-021-verify.mjs:42`), so the new fields do not disturb them.

## Test harness

The Design stone-group harness for text is `tools/test-mono-021-mark-hooks.mjs` (MONO-021). It uses
the real `createDrawingTool()` and the real `syncFromProjectLayers()` under `loadPaperForNode()`
(`tools/lib/paper-node-env.mjs`), stubs `document.createElement('canvas')` for the sprite bake, and
drives real pointer gestures through `paper.tool.emit()`. RS-3012 Step 3 has no test file of its own.
Its text-proxy coverage lives in that harness and in `tools/test-maint-003-materializer-contract.mjs`
(tests 1f and 4).

IMG-020 needs two QA-only, read-only additions, in the same precedent as `debugStoneState()` itself:

* `buildStoneSpriteGroup()` stamps `symbolItem.data.color = stone.color` next to `isStoneDot` (`:2582`).
* `debugStoneState()` also returns `groupId` (the Paper id of the current group, or null),
  `groupVisible`, and `stones` (`{ x, y, color }` per sprite, from `position` and `data.color`). A
  rebuild is observed as a change of `groupId`.

## Tests the build must add

T1 to T5 go in a new `tools/test-img-020-image-stones-in-design.mjs`. It copies the MONO-021 harness
and passes one extra hook: `getImageLayerStones(id)` returns `imageStonesById[id] || []` and logs
`['image', id]`. `getTextLayerStones` logs `['text', id]` the same way.
`tool.enter({ width: 240, height: 240 }, 20, 'select')`. Every test starts with
`syncFromProjectLayers([])`, then a sync of its own layers.

```js
const PALETTE = ['topaz', 'jet', 'aquamarine'];
function gridStones(box, pitch = 2.5) {
  const stones = [];
  const cols = Math.floor(box.w / pitch), rows = Math.floor(box.h / pitch);
  for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
    stones.push({ x: box.x + pitch / 2 + i * pitch, y: box.y + pitch / 2 + j * pitch, d: 2, color: PALETTE[(i + 2 * j) % 3] });
  }
  return stones;
}
const imageLayer = (over = {}) => ({ id: 'I', type: 'image', visible: true, x: 40, y: 40, w: 60, h: 50, rotationDeg: 0, stoneSize: 2, gap: 0.3, color: 'gold', ...over });
```

`gridStones(imageLayer())` is 480 stones (24 × 20), 160 of each colour. It stands in for the layout's
stones for the layer, the way MONO-021's `CLUSTER` stands in for text beads.

**T1. Stones equal the layout's.** After a sync of `imageLayer()` with
`imageStonesById.I = gridStones(imageLayer())`: `stoneGroupCount` is 480, and every drawn stone equals
the list in order (x and y within 1e-6, colour exact). The proxy's bounds are exactly 40, 40, 60, 50.
`markStones` is null. The log holds `['image', 'I']` and no `'text'` read.

**T2. A dialog setting rebuilds with the new colours.** Same layer. Replace the list with the same
positions and every `'jet'` recoloured `'hematite'`, as a vividness change would, then sync with the
box unchanged. `groupId` changes, the drawn stones equal the new list, and 160 are `'hematite'`.

**T3. Nothing changed, no rebuild.** For `rotationDeg` 0 and 30: after the first sync, 10 more syncs
leave `groupId` unchanged. A sync with `forceStoneRebuild` true then changes it, which shows the
observation works.

**T4. Drags.**

* T4a, move: `selectShapeForLayer('I')`, `mousedown` (40, 50) (the left edge, clear of the west handle
  at (40, 65)); the interaction is `'move'`. `mousedrag` to (52, 58). Mid-drag `groupId` is unchanged
  and the first drawn stone has moved by a non-zero (dx, dy). `mouseup`: `onShapeMoved` reports that
  same (dx, dy). The fake app shifts the layer and every stone by (dx, dy) and syncs. `groupId` is
  still unchanged, and the drawn stones equal the shifted list.
* T4b, resize: `mousedown` on the SE handle (100, 90); the interaction is `'resize'`. Two `mousedrag`
  frames to (90, 80). Mid-drag, `groupId` is unchanged and `groupVisible` is false. At `mouseup`, the
  group is still hidden and not rebuilt, and `onShapeResized` reports 50 × 40. The fake app sets
  `w: 50, h: 40` and `gridStones()` of that box (320 stones), then syncs. `groupId` changes,
  `groupVisible` is true, and the 320 drawn stones equal the list.
* T4c, handle click: `mousedown` and `mouseup` on (100, 90). `groupVisible` is true, `groupId`
  unchanged.
* T4d, rotate: `mousedown` on the rotate handle (70, 30); the interaction is `'rotate'`. `mousedrag`
  to (90, 40), `mouseup`. The group is still hidden. A sync with `rotationDeg` from
  `onShapeRotated` (stones unchanged, as the engine gives today) changes `groupId`, and the group is
  visible.

**T5. Text unchanged.** MONO-021's five-bead `CLUSTER` as `'text'` layer `T`. After the sync,
`stoneGroupCount` is 5 and `markStones` has 5 entries. No `'image'` read is logged. Add a sixth bead
inside the AABB at (102, 101) and sync: `groupId` is unchanged (the bounds gate at `:4809`).
`refreshStoneGroupForLayer('T')` then gives 6 stones and 6 `markStones`.

All eight pass on the scratch build.

**Mutants and the item each kills.** Each was run on the scratch build, one decision at a time.

| Decision | Mutant | Killed by | Result under the mutant |
|---|---|---|---|
| D1 | The image route reads `getTextLayerStones()` instead of `getImageLayerStones()` | T1 | 0 stones, and a `'text'` read for `'I'`. T2, T4a and T4b fail too |
| D1 | The image route sets `markStones` (reusing `rebuildTextStoneGroupForShape()`) | T1 | `markStones` is a 480-entry array, not null |
| D2 | The rotate commit's image branch is missing (falls to the generic rebuild at `:3613`) | T4d | the group is rebuilt from the stale layout and visible at drop |
| D3 | No signature: rebuild only on box, rotation or force | T2 | `groupId` unchanged after the recolour. T4b also fails: the drop's cleared signature is never compared |
| D3 | The signature leaves out the colour | T2 | `groupId` unchanged |
| D3 | The signature uses absolute x and y | T4a | the reconcile after the move rebuilds |
| D3/D6 | The box test uses the AABB (`:4883`'s comparison) | T3 | at 30°, every sync rebuilds |
| D4 | The resize drop rebuilds at once, from the current layout | T4b | at drop the group is visible and rebuilt from the pre-resize stones |
| D4 | No in-progress-resize guard in the image rebuild | T4b | `groupId` changes mid-drag, once per frame |
| T5 | `installStoneGroupForShape()` extraction drops the text `markStones` refresh | T5 | 6 stones drawn, `markStones` still 5 |

Two weaker mutants were tried and dropped because the same sync call repairs them. Removing the
`rebuildStoneGroupForShape()` dispatch (D1) is repaired by the reconcile branch, which rebuilds the
dropped group. Building the image proxy with `materializeTextItemFromLayer()` (D2) is repaired by the
AABB check, which re-materializes the rectangle. Neither is observable at the end of a sync.

## Existing tests

**No existing test is expected to move.**

The whole default suite (`node tools/run-tests.mjs`, 166 files) was run on a clean copy of `fcc6b16`
and on the scratch build. Both pass all 166. `tools/test-move-drag-fast-path-wiring.mjs`, which is
excluded from the default run, also passes on the scratch build. The other files excluded from the
default run do not touch the drawing tool.

* The five harnesses listed in D1 don't pass `getImageLayerStones`. Their image proxies get the
  default `null` and an empty group, which none of them asserts on.
* `test-maint-003` test 4's flag matrix reads only `noResizeHandles`, `noRotateHandle`,
  `isCircleProxy` and `isTextProxy`. The new `isImageProxy` is not among them, so the matrix is
  unchanged.
* `test-rs3015-mark-target-eligibility.mjs` keeps its image `'ineligible'` results because image
  proxies get no `markStones` (D1).

## Build housekeeping

* `tools/test-img-020-image-stones-in-design.mjs` is registered in `tools/test-groups.mjs`'s `editing`
  group (`:362`), next to `test-mono-021-mark-hooks.mjs` (`:373`), with the same
  `assertTestRegistered({ filename, group: 'editing', includedInDefault: true })` call.
* `docs/ARCHITECTURE.md`'s RS-3012 Step 2 paragraph (`:1275-1286`) says the image proxy is a rectangle
  with "the generated stone dots". It gains one sentence: in Design the image's stones are drawn from
  the layout through `getImageLayerStones()`, like text's, and are rebuilt when their signature, box
  or rotation changes.
* This spec's Status line becomes "built" in the build commit.

## Out of scope

* Mark tools, Paint and Lasso on images (IMG-021), and drawing the bitmap (D5).
* Making the signature or the image route available to other layer types. See Findings.

## Findings for decision

These were found during Step 0. None is changed by IMG-020.

1. **`svg`, `circle`, `rectangle` and shape-library layers draw no stones in Design either** (Step 0
   table). All four have their stones in the layout (221, 61, 78 and 65 above), and all four hit the
   same `getLayerStoneParams()` `'path'`-only null. **Proposed fix:** a follow-up that widens D1's
   route from `isImageProxy` to a `stonesFromLayout` flag set on every non-`path`, non-`text` proxy.
   It would reuse `getImageLayerStones()` (renamed then), `layoutStoneSignature()` and the D3 branch.
   `circle` would keep its own proxy branch (`:4835`) and gain only the signature check. `svg` and
   shape-library proxies are real outlines, not rectangles, so their box tests stay the ones they
   have. That follow-up would move `test-maint-003` test 4's flag matrix.
2. **Image stones ignore `rotationDeg` in production.** Neither `params` object in
   `generateImageStonesLive()` (`app.js:1161`, `:1169`) passes it, and `normalizeImageParams()`
   (`GeometryEngine.js:2474`) has no rotation step. Rotating an image rotates its box everywhere but
   leaves the stones upright in the layout, so every renderer and exporter gets them upright too. With
   IMG-020, Design will show this plainly: upright stones inside a rotated box.
   **Proposed fix:** rotate the image's stones around the box centre in `generateImageLayout()`, as
   RS-3033 did for `'path'`. D3's signature then picks up a rotation from the layout itself.
3. **The Inspector's X, Y, W and H go stale after a Design drag, and the next Inspector edit reverts
   the drag.** On `fcc6b16`, with a rectangle: after a Design move, the layer's x is 50 while the
   visible X field still reads 35. Typing a rotation then writes 35 back
   (`writeSelectedControlsToLayer()` reads every field), and the move is lost. The same happens for an
   image. `onShapeMoved`, `onShapeResized` and `onShapeRotated` (`app.js:2254-2295`) call
   `updateAll(true)` but not `syncSelectedControlsFromLayer()`. **Proposed fix:** call
   `syncSelectedControlsFromLayer()` in those three hooks when the moved layer is the selected one.
