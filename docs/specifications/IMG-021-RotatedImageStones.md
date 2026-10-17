# IMG-021 — Rotated image stones

**Status: built.** File:line citations are against `develop` @ `b22053b` (the dev-server no-cache
merge, after IMG-020). Every anchor below was re-grepped on that tip. The Step 0 figures come from a
real browser (Chrome, headless, isolated context) on that tip. The prototype figures, T1 to T7 and
every mutant result come from a scratch copy of the tree with D1 to D4 applied, served and tested the
same way. The copy lives in the session scratchpad, not under `tools/scratch/`.

## Objective

An `'image'` layer has `rotationDeg`, and the Inspector, the main-canvas rotate handle and Design all
write it. Image stones ignore it. `normalizeImageParams()` (`GeometryEngine.js:2474`) has no
`rotationDeg`, and neither `params` object in `app.js`'s `generateImageStonesLive()` (`:1161`,
`:1169`) passes one. The layout therefore holds upright stones inside a rotated box, and every
renderer and exporter shows that.

Other layer types already rotate. Text rotates its finished stones rigidly with
`rotatePointsAroundCenter()` (`GeometryEngine.js:283`, `:321`). Shapes and paths rotate their outline
before sampling (`_shapePolygons()`, `:860`, rotation at `:881`; `_pathPolygons()`, `:1857`, rotation
at `:1882`).

IMG-021 makes an image layer's stones follow its rotation. `generateImageLayout()` rotates its
finished stones rigidly around the centre of the unrotated placement box. That centre is the same one
the main canvas's `rotatedCornersAABB()` (`app.js:3191`) and Design's proxy rotate the box around. Nothing
outside `GeometryEngine` computes a stone position.

## Step 0: what develop shows today

The butterfly (`~/Downloads/butterfly2_original.jpeg`, 800 × 747) went through the Image input on a
Flat Sheet (150 × 150 mm). It was then re-imported alone through the Import dialog's project input.
Import defaults: x 10, y 14.31, 130 × 121.39 mm, Staggered, SS6, gap 0.3, vividness 1.4, subject
mask, Auto colours, fill gaps on. Rotation was typed into the Inspector's rotation field
(`#shapeRotationDeg`).

"Off target" is the largest distance between a stone and where a rigid rotation of its rotation-0
position, about the box centre, would put it. "Outside" counts stone centres outside the rotated box.

| | 0° | 30° | 90° |
|---|---|---|---|
| Stones in the layout | 1266 | 1266 | 1266 |
| Same sizes and colours as at 0°, in order | — | yes | yes |
| Centres outside the rotated box | 0 | 0 | 0 |
| Off target | — | 33.21 mm | 90.75 mm |
| Line Design (764 stones): off target | — | 33.69 mm | 92.05 mm |

No centre falls outside the rotated box because the butterfly's outline happens to sit inside the
rotated box's overlap with the upright one. "Outside" is not a usable measure of the defect for this
image. "Off target" is.

**Each surface at 30°:**

| Surface | Image layer (butterfly) | Rotated rectangle (90 × 60 mm, Outline), for comparison |
|---|---|---|
| Main canvas (2D) | rotated selection box, upright stones | rotated box, rotated stones (0 mm off target) |
| Design | rotated rectangle proxy, 1266 upright stones (drawn equals layout within 1.6e-14 mm) | rotated proxy, 0 stones (IMG-020 Findings 1: rectangles draw no stones in Design) |
| Image Studio, Template view | 1266 upright stones, framed on the unrotated box; Box stat 130 × 121.4 mm | empty: the Studio shows image layers only |
| Image Studio, Overlay view | upright bitmap under upright stones | empty |
| Production Sheet (SVG) | 1266 upright circles | 130 rotated circles |
| DXF export | 1266 upright circles, equal to the layout in order, 33.21 mm off target | 130 rotated circles, 0 mm off target |
| SVG export | upright stones over upright traced regions | rotated stones |

At 90° the table is the same, with 90.75 mm off target.

**Line Design regeneration time.** Switching the butterfly to Line Design took 1426 ms and 1331 ms in
two runs, from the fill-mode change to the new layout. Rotation will join Line Design's cache key
(D2), so this is the cost of one rotation step for a Line Design image.

**Rotated image in Design (IMG-020 route).** 50 unchanged reconciles: median 0.4 ms, no rebuild. A
Design move of the rotated butterfly: one rebuild, as IMG-020 D3 accepts, and none on the next
reconcile. The prototype gives the same figures.

Screenshots and the raw figures are in the report, not in the repository.

## Consumers of image-layer stones

Every consumer either reads the project `layout` or asks the engine again through
`generateImageStonesLive()`. None generates or moves a stone itself.

| Consumer | Where | Reads | Under IMG-021 |
|---|---|---|---|
| Project generation, cross-layer dedupe | `app.js:1085` `generate()` → `dedupeStonesByRadius(raw)` | regenerates (`generateImageStonesLive()`) | rotated stones (D1), deduped against other layers where they really are |
| Main canvas (2D) | `:3052` `drawLayout()`, `:420` `renderStoneLayout(ctx,layout,…)` | layout | rotated automatically |
| Object preview (3D) | `:4255` `drawCup()` → `preview3D.update(layout,…)` | layout | rotated automatically (not shown for a Flat Sheet) |
| Design (IMG-020 route) | `:1649` `layoutStonesForLayer()`, `:2433` `getImageLayerStones` | layout | rotated automatically; D5 |
| SVG export | `:5579` `stoneLayoutToSvg(layout,…,{regions})` | layout, plus traced regions from `resolveImageExportRegions()` (`:3423`) | stones rotated; regions rotated by D3 |
| PNG export | `:5580` `exportCanvas(…,layoutCanvas)` | the main canvas | rotated automatically |
| DXF export | `:5578` `stoneLayoutToDxf(layout,…)` | layout | rotated automatically |
| Production Sheet (SVG, PDF) and its outside-area count | `:5628`, `:5615` `countStonesOutsideProductionArea(layout,…)` | layout | rotated automatically; D3 |
| JSON export | project file | no stones (layer intent only) | `rotationDeg` already saved |
| Layout stats bar | `:4286` `updateStats()` | layout (`layout.count`, extent) | the extent follows the rotation |
| Image Studio Template and Overlay views, stats | `:6537` filters `layout.stones` by layer | layout | D4 |
| Image Studio Check & Fix report | `:6624` `engine.generateImageStonesLive(l,{includeStats:true})` | regenerates | unchanged stats (D3) |
| Stone Size overlap guard | `:3983` `stonesForCandidateStoneSize()` → `generateLiveStonesForCandidateLayer()`; `:4039` `hasAnyOverlappingStonePair()` | regenerates | rotated input; same answer (D3) |
| Mixed-size secondary count | `:3657` `mixedSizeSecondaryStoneCountFor()` | layout (count by size) | unchanged |
| Line Design | inside `generateImageLayout()` (`GeometryEngine.js:1278`), cached by `lineDesignStoneCache` (`app.js:853`) | regenerates | rotated (D1); cache key and drag freeze (D2) |
| Boolean Operations | `:3403-3409` `resolveLayerShapeSource()`: a `'field'` source for `PathBoolean.js` | no stones: the image's field | D3 |
| Gallery fixtures (scope-frozen, S-103) | `src/gallery/RhsFixtureBridge.js:484` `generateImageStonesForLayer()` | regenerates with its own params | unchanged: the fixture schema has no `rotationDeg`, so it passes none and the engine uses 0 |

`resolveImagePolygons()` (`GeometryEngine.js:1406`) is not used by Boolean Operations. Its only
caller is `resolveImageExportRegions()`, the SVG export's traced regions. Boolean Operations trace an
image through `resolveLayerShapeSource()`'s `'field'` source (`app.js:3408`) inside
`combineShapeSources()`. The brief's description of D3 is corrected here, and D3 covers both paths.

## Decisions

### D1. Rigid rotation of the finished stones in `generateImageLayout()`

As the very last step before `return new StoneLayout(...)` (`GeometryEngine.js:1384`), after the
primary stones (`:1277` onward), S-200 infill (`:1341`) and gap fill (`:1370`), and for every mode
including Line Design:

```js
if (options.rotationDeg !== 0) {
  stones = rotatePointsAroundCenter(stones, options.rotationDeg, imagePlacementCenter(options)).map((point) => new Stone(point));
}
```

* **Helper.** The existing `rotatePointsAroundCenter()` (`:2136`) rotates clockwise in this Y-down mm
  space. It spreads every field of the point, so each `Stone`'s `sizeMm`, `color`, `layerId`, `index`
  and `metadata` survive, and `new Stone(point)` re-wraps it.
* **Pivot.** The centre of the unrotated placement box, `(xMm + widthMm / 2, yMm + heightMm / 2)`,
  from a new module-level `imagePlacementCenter(options)` placed before `normalizePathParams()`
  (`:2582`). D3 uses it too. This is the centre every UI surface rotates the box around. Text pivots
  on its stones' own bounding box (`boundingBoxCenterOfPoints()`, `:2114`), and an image must not:
  its stones fill only part of the box, so that pivot would drift with the picture's content.
* **Why last.** Every pass before it (sampling, colour lookup, brightness sizes, IMG-005 spacing
  repair, S-200 infill, IMG-013 gap fill, Line Design's own pocket pass) reads the unrotated field in
  field coordinates. A rigid rotation keeps every distance, so none of them needs rotated input and
  none of their results changes (D3).
* **Unchanged by rotation:** the stone count, and each stone's size, colour, index and metadata, in
  order. Only `xMm` and `yMm` move.
* **Rotation 0 or missing** skips the block, so the output is byte-identical to today (T1). A
  normalized 360 is 0.

### D2. Wiring

**Engine.** `normalizeImageParams()` gains, after `fillGaps` (`:2575`):

```js
rotationDeg: normalizeRotationDeg(assertFiniteNumber(params.rotationDeg ?? 0, 'rotationDeg')),
```

This is the normalizer shapes (`:2351`) and paths (`:2644`) use. A non-finite value throws, as it does
for a shape. `generate()` catches a per-layer throw and reports the layer as failed (`app.js:1085`).
`validateProject()` does not check `rotationDeg` for any layer type, and IMG-021 does not add a check.

**app.js.** `rotationDeg:layer.rotationDeg??0` goes into every image generation call, directly after
`heightMm:layer.h`:

| Read site | Line | Change |
|---|---|---|
| Line Design cache key | `:1151` | `…,resolveImageMaskMode(layer.maskMode),layer.rotationDeg??0].join('\|')` |
| Line Design `params` | `:1161` | `heightMm:layer.h,rotationDeg:layer.rotationDeg??0,stoneSizeMm:…` |
| Live `params` (every other mode) | `:1169` | same insertion |
| SVG export regions `params` (D3) | `:3429` | same insertion |
| Boolean field source (D3) | `:3408` | `…,heightMm:layer.h,rotationDeg:layer.rotationDeg??0};` |

The insertion point keeps every existing source-text regex matching (see "Existing tests").

**Line Design drag freeze.** Rotation is now in the cache key, so a main-canvas rotate drag of a
Line Design image misses the cache on every pointermove. Every miss is a 1.3 to 1.4 s regeneration
(Step 0). A resize drag already has the same problem and the fix for it: `lineDesignFrozen`
(`app.js:872`), set at resize drag start (`:4569`) and cleared by `endActiveDrag()` (`:4760`) with
one real regeneration. IMG-021 extends that fix to rotate drags:

* after `drag={kind:'rotate',…}` (`:4587`), the same line as `:4569`:
  `if(hit.layer.type==='image'&&resolveImageFillMode(hit.layer.fillMode)==='line-design')lineDesignFrozen=true;`
* `endActiveDrag()` (`:4760`): `else if(ended&&(ended.kind==='resize'||ended.kind==='rotate')&&lineDesignFrozen){`

During the drag, the frozen fallback shows the stones as they were at drag start. On release they
are regenerated once at the final rotation, exactly as for a resize. A Design rotate drag needs no
freeze: Design hides the group during the drag and commits once (`onShapeRotated`, `app.js:2293`).

**Other caches.** `lineDesignStoneCache` is the only stone cache keyed on layer fields.
`autoColorCountKeyParts()` (`:767`) and `computeImageColorField()` (`:818`) key the field, which
rotation does not change, so they stay as they are. IMG-020's `layoutStoneSignature()`
(`DrawingCanvasTool.js:831`) reads the layout, so it picks up a rotation from the stones themselves.

**Harness slices and source-text guards** over these lines, each checked on the prototype:

| Test | Lines | What it reads | Result |
|---|---|---|---|
| `tools/test-fill-algorithms-integration.mjs` | `:111-117` | regexes `gapMm:layer\.gap,mode,color:layer\.color,colorMap:…` and `…,threshold:layer\.threshold` | unaffected: the insertion is before `stoneSizeMm` |
| `tools/test-img-017-vividness.mjs` | `:182-190` | key regex `/const key=\[layer\.id,[^\]]*\]\.join/`; `/const params=\{[^;]*\};/g`, exactly 2 | unaffected: `??0` adds no `]` or `;` |
| `tools/test-img-018-whole-image-mask.mjs` | `:175-181` | the same two regexes, plus `,mode,` and no `threshold:` in the Line Design params | unaffected |
| `tools/test-img-009-subject-mask.mjs` | `:271-296` | needle `maskMode:resolveImageMaskMode(layer.maskMode)`, exactly 5 occurrences | unaffected |
| `tools/test-img-008-vector-first-svg.mjs` | `:352-371`, `:134-148` | `resolveImageExportRegions()` needles; `'field'` sources with no `rotationDeg` | unaffected |
| `tools/test-img-010-line-design.mjs` | `:530-590`, items 12 to 19 | the real `generateImageStonesLive()` through `new Function()` with a fixed dependency list | unaffected: the change adds no free identifier; its layers have no `rotationDeg`, so every key gains the same `0` |
| `tools/test-img-013-fill-empty-slots.mjs` | `:345-427` | the same extraction | unaffected |
| `tools/test-img-004-edge-awareness.mjs`, `test-img-005-check-and-fix.mjs`, `test-img-006-brightness-sizes.mjs` | `:413-423`, `:332-339`, `:304-312` | `includes()` needles in the method body | unaffected |
| `tools/test-image-trace-regression.mjs`, `test-img-011-import-defaults.mjs`, `test-mono-006b-…`, `test-rs-3039-large-layout.mjs` | `:48-52`, `:143`, `:342`, `:206` | method name, dispatch line, `colorCount:` regex, a stub | unaffected |
| `tools/test-path-boolean-integration.mjs` | `:199` | `/kind:'field',field,xMm:layer\.x,yMm:layer\.y,widthMm:layer\.w,heightMm:layer\.h/` | unaffected: still a prefix |
| `tools/test-alignment-snapping-wiring.mjs` | `:122` | the whole of `endActiveDrag()`, as one regex | **moves** (see "Existing tests") |
| `tools/test-move-drag-fast-path-wiring.mjs` (not in the default run) | `:48-104` | fragments of `endActiveDrag()` | unaffected, 12 of 12 pass |

The tests were searched for the text of every changed line, in plain and in regex-escaped form:
`heightMm:layer.h` / `heightMm:layer\.h`, `maskMode)].join` / `\]\.join`, `drag={kind:'rotate'` /
`drag=\{kind:'rotate'`, `ended.kind==='resize'` / `ended\.kind==='resize'`, `lineDesignFrozen=true`,
`const bbox={minXmm:l.x` / `minXmm:l\.x`, `ctx.drawImage` / `ctx\.drawImage`, `paintSource`,
`rotatedCornersAABB`, `sourceMode: options.mode`, `regions.flatMap`, `params.fillGaps`,
`source.xMm` / `source\.xMm`, `localXMm` and `imageBuffer:buffer`. Every hit is in the table above
or in a test that reads unrelated code. The four `localXMm` hits are those tests' own helpers. The
`ctx\.drawImage` hit is `composeCombinedPreviewCanvas()`. The `rotatedCornersAABB` hits pin
`getLayerBBox()`, and none of them counts call sites.

### D3. Uses of image stones other than drawing

| Use | What rotation means for it | Input |
|---|---|---|
| IMG-005 Check & Fix (Contour, Radial spacing repair) | spacing is measured between stones of one layer; a rigid rotation keeps every distance | unrotated, inside the engine before D1. `checkFixStats` is identical at every angle (T2), so the Studio's Check & Fix line does not change |
| IMG-013 gap fill, S-200 infill, IMG-006 overlap drop, Line Design pocket pass | each tests candidates against the unrotated field (`fieldPixelOn()`, the placement box) | unrotated, before D1, for the same reason. Their stones are then rotated with the rest (T2, T3) |
| Cross-layer dedupe (`dedupeStonesByRadius()` in `generate()`) | compares this layer's stones with other layers' stones where they really are | **rotated**. It already runs on the output of `generateImageStonesLive()` |
| Stone Size overlap guard (`hasAnyOverlappingStonePair()`) | pairwise overlap within one candidate layer | rotated, through the same regeneration. The answer is the same as unrotated |
| Production-area and safe-area counts (`countStonesOutsideProductionArea()`, the Flat Sheet safe-area guide) | a rotated design can reach past an edge the upright one did not | **rotated**, from the layout. The prototype butterfly at 30° has 2 stones past the 10 mm safe inset, none past the sheet edge. Develop reports 0, because it checks the wrong positions |
| SVG export traced regions (`resolveImagePolygons()` via `resolveImageExportRegions()`) | the regions are drawn under the stones, so they must turn with them | **rotated.** `resolveImagePolygons()` rotates each finished contour with `rotatePointsAroundCenter()` around `imagePlacementCenter(options)`, just before `allPoints` (`:1447`). This is the same rigid transform as D1, so regions and stones stay in exact register (T6). `resolveImageExportRegions()` passes `rotationDeg` (D2) |
| Boolean Operations (`resolveLayerShapeSource()`'s `'field'` source) | a Boolean result must take the shape the user sees, not the upright one | **rotated.** The field source carries `rotationDeg` (D2), and `PathBoolean.js` honours it: `sourceBoundingBox()` (`:161`) returns the rotated corners' axis-aligned box, and `sampleSource()` (`:168`) rotates the query point back into the unrotated box around its centre before the pixel lookup (`:174`). A missing or 0 `rotationDeg` takes today's code path unchanged (T5) |

Two different mechanisms for regions and Boolean Operations are deliberate. The export traces one
layer alone, so its finished contours can be rotated rigidly, like the stones. A Boolean Operation
samples two sources on one world-space grid before tracing, and the other operand is not rotated. So
the rotation has to happen where the field is sampled, not after tracing.

The alternative for Boolean Operations was to leave them upright and record a BACKLOG row. Rejected:
after D1, a Boolean result from a rotated image would no longer match that image's stones.

### D4. The Image Studio shows the layer rotated

Step 0: every surface that can show a rotated rectangle shows it rotated: main canvas, Production
Sheet, DXF and SVG. Design shows the rotated rectangle proxy. The Studio shows image layers only, so
it has no view of another layer type. Its Template view draws the layout's stones for the layer
(`:6537`, `:6557`), so after D1 it shows them rotated, like every other surface. An upright Studio
would have to counter-rotate the layout's stones for display. It would then show positions that
nothing produces.

So the Studio frames and draws the rotated layer:

* `renderImageStudio()`'s frame (`:6532`) becomes the rotated box's axis-aligned box:
  `const studioRotationDeg=l.rotationDeg??0;`,
  `const studioBox=rotatedCornersAABB(l.x,l.y,l.w,l.h,studioRotationDeg);`,
  `const bbox={minXmm:studioBox.x,minYmm:studioBox.y,widthMm:studioBox.width,heightMm:studioBox.height};`.
  `rotatedCornersAABB()` returns the plain box at 0, so the frame is unchanged there.
* The three bitmap draws (Source and Overlay through `paintSource` at `:6547`, Mask at `:6555`,
  Colours at `:6592`) go through one new `drawInBox(src)`. At 0 it is today's `ctx.drawImage(src,…)`
  call. Otherwise it translates to the box centre, rotates by `studioRotationDeg` and draws the
  bitmap centred, inside `ctx.save()`/`ctx.restore()`. The Overlay's `globalAlpha` is set outside
  `drawInBox`, and `restore()` returns it to that value.
* The stats are unchanged. The Box stat stays `w × h`, the layer's own size, as the Inspector shows.

Prototype: the Overlay view shows the rotated bitmap under the rotated stones, in register.

### D5. Out of scope

* **SVG layers ignore `rotationDeg` too.** `generateSvgStonesLive()` passes none, and
  `normalizeSvgParams()` has none. `docs/ARCHITECTURE.md:1281` records that SVG layers "never got
  the RS-3028 rotationDeg-into-the-outline wiring". The brief calls this "a separate BACKLOG row",
  but **no such row exists** in `docs/BACKLOG.md`: the only rotation rows are the image row (`:69`)
  and the stale-Inspector row (`:70`). The build adds the row (Build housekeeping).
* **The rectangle-proxy rebuild on every reconcile for a rotated image** (IMG-020 audit, D3:
  `DrawingCanvasTool.js:4946-4951`, AABB against `layer.x/y/w/h`). IMG-021 does not change it.
  IMG-021 does not touch `DrawingCanvasTool.js`. The proxy is built from the box, not the stones, and
  the stone-group decision (`:4959`) uses the unrotated box and the signature. Measured on the
  prototype: 50 unchanged reconciles of the rotated butterfly rebuild no stone group (median 0.4 ms,
  as on develop). A Design move rebuilds once, as on develop.
* **The stale Inspector after a Design drag** (BACKLOG `:70`, IMG-020 Findings 3). Unchanged.
* Rotating the Studio's view to the image's own axes, and any rotation handle in the Studio.

## Anchors

Every anchor was re-grepped on `b22053b`, and the line given is the actual line.

| File | Line | Content |
|---|---|---|
| `src/geometry/GeometryEngine.js` | `:283`, `:321` | text: `rotatePointsAroundCenter(survivingStones, …)`, `rotatePointsAroundCenter(combinedPoints, …)` |
| | `:860`, `:881` | `_shapePolygons(options) {` and its rotation |
| | `:1200`, `:1201` | `generateImageLayout(params = {}) {`, `const options = normalizeImageParams(params);` |
| | `:1246` | `const isLineDesign = options.mode === 'line-design';` |
| | `:1277`, `:1341`, `:1370` | `let stones;`, S-200 infill, IMG-013 gap fill |
| | `:1384` | `return new StoneLayout({ layerId: options.layerId, sourceMode: options.mode, stones, checkFixStats });` (D1 goes before it) |
| | `:1406`, `:1426`, `:1447` | `resolveImagePolygons(params = {}) {`, `const baseSource = …`, `const allPoints = …` (D3 goes before it) |
| | `:1857`, `:1882` | `_pathPolygons(options) {` and its rotation |
| | `:2094`, `:2114`, `:2136` | `normalizeRotationDeg`, `boundingBoxCenterOfPoints`, `rotatePointsAroundCenter` |
| | `:2351`, `:2644` | the shape and path normalizers' `rotationDeg:` line (D2 copies it) |
| | `:2474`, `:2575` | `function normalizeImageParams(params) {`, `fillGaps: Boolean(params.fillGaps),` (D2 goes after it) |
| | `:2582` | `// RS-1012: contours/xMm/yMm/…` (`imagePlacementCenter()` goes before it) |
| `src/geometry/PathBoolean.js` | `:146`, `:161` | `function sourceBoundingBox(source) {`, its `'field'` branch |
| | `:168`, `:174` | `function sampleSource(source, xMm, yMm) {`, `const localXMm = xMm - source.xMm;` |
| `app.js` | `:853`, `:872`, `:873` | `lineDesignStoneCache`, `let lineDesignFrozen=false;`, `invalidateLineDesignCache()` |
| | `:1085` | `async generate(project){…}` (cross-layer dedupe) |
| | `:1146`, `:1147`, `:1150` | `async generateImageStonesLive(…){`, `const mode=…`, `if(mode==='line-design'){` |
| | `:1151`, `:1161`, `:1169` | the Line Design key, the Line Design `params`, the live `params` |
| | `:1649`, `:2433` | `layoutStonesForLayer()`, `getImageLayerStones:` |
| | `:2293`, `:2849` | `onShapeRotated:(layerId,rotationDeg)=>{`, the Inspector rotation write |
| | `:3052`, `:420` | `function drawLayout(){`, `renderStoneLayout(ctx,layout,transform,'layout');` |
| | `:3191`, `:3216` | `function rotatedCornersAABB(…){`, `function getLayerBBox(l){` |
| | `:3363`, `:3403`, `:3408` | `resolveLayerShapeSource()`, its image branch, the `'field'` return |
| | `:3423`, `:3429` | `function resolveImageExportRegions(project){`, its `params` |
| | `:3983`, `:4039` | `stonesForCandidateStoneSize()`, `hasAnyOverlappingStonePair(…)` |
| | `:4255`, `:4286` | `function drawCup(){`, `function updateStats(){` |
| | `:4465` | `function rotateHandleHitTest(mm){` (any single selected layer, image included) |
| | `:4569`, `:4587` | the resize freeze line, `drag={kind:'rotate',…};` |
| | `:4755`, `:4760` | `function endActiveDrag(){`, `else if(ended&&ended.kind==='resize'&&lineDesignFrozen){` |
| | `:5578`, `:5579`, `:5580`, `:5615`, `:5628` | DXF, SVG, PNG export, outside-area count, Production Sheet SVG |
| | `:6485`, `:6532`, `:6537` | `async function renderImageStudio(){`, `const bbox=…`, the layer's layout stones |
| | `:6547`, `:6555`, `:6557`, `:6592` | `paintSource`, Mask `drawImage`, `drawTemplate`, Colours `drawImage` |
| | `:6624` | `const checkFixResult=await engine.generateImageStonesLive(l,{includeStats:true});` |
| `src/drawing/DrawingCanvasTool.js` | `:831` | `function layoutStoneSignature(stones) {` |
| | `:4939`, `:4946`, `:4951`, `:4959` | the image reconcile branch, `boundsChanged`, the proxy re-materialize, the stone rebuild |
| `src/gallery/RhsFixtureBridge.js` | `:484`, `:503` | `generateImageStonesForLayer()`, its `generateImageLayout(params)` |
| `docs/BACKLOG.md` | `:69`, `:70` | the image-rotation row, the stale-Inspector row |
| `docs/ARCHITECTURE.md` | `:1275-1288` | RS-3012 Step 2 (`svg` and `image` join Select) |
| `tools/test-groups.mjs` | `:189`, `:215` | `geometry: [`, `'test-img-019-subject-mask-resized.mjs',` |

## Tests the build must add

T1 to T7 go in a new `tools/test-img-021-rotated-image-stones.mjs`. The brief lists T1 to T5. T4b, T6
and T7 are added so that D2's drag freeze, D3 and D4 each have an item that kills their mutants.

**Fixture.** A synthetic 96 × 72 px RGBA buffer, transparent except for three opaque shapes: a red
bar across the top (`#9b1c1c`, rows 6 to 21, columns 8 to 87), a blue block at the lower left
(`#2269d3`, rows 26 to 65, columns 8 to 39) and a green disc at the lower right (`#1e7a4a`, centre
(66, 48), radius 17). Nothing about it is symmetric under 30° or 90°. Placement box x 12, y 20,
64 × 48 mm (off-centre on purpose). `stoneSizeMm` 2, `gapMm` 0.3, threshold 128, 96 × 72 max px,
`colorCount` 3 against the full `STONE_COLORS` palette.

| Case | Params over the base | Stones |
|---|---|---|
| `fill` | `mode: 'fill'` | 285 |
| `staggeredFillGaps` | `mode: 'staggered', fillGaps: true` | 329 |
| `radial` | `mode: 'radial'` | 281 (Check & Fix: 2 found, 2 dropped) |
| `contour` | `mode: 'contour'` | 175 (Check & Fix: 160 found, 53 repaired, 107 dropped) |
| `organic` | `mode: 'organic', seed: 3, spread: 1.2` | 156 |
| `edge` | `mode: 'edge'` | 205 |
| `brightness` | `mode: 'fill', sizeMode: 'brightness', brightnessSizesMm: [2, 2.8, 4]` | 77, two sizes |
| `mixed` | `mode: 'contour', stoneSizeMm: 4, sizeMode: 'mixed', allowedSizesMm: [2, 2.8, 4], minSizeMm: 2, maxSizeMm: 4` | 62, 8 of them infill |
| `lineDesign` | `mode: 'line-design'` | 204: 112 outline, 55 fill, 37 pocket |

Every case has all three colours. The digest is SHA-256 over every stone's `xMm`, `yMm`, `sizeMm`,
`color`, `index` and `metadata`, at full precision and in order, cut to 16 hex digits.

**T1. Rotation 0 or missing is byte-identical to develop.** For all nine cases, the digest with
`rotationDeg` missing, 0, 360 and -0 equals the value pinned on `b22053b`:
`fill 99bd1dbc7b2d0392`, `staggeredFillGaps 0cd88f9918a629a0`, `radial f55eac61da9b1d9b`,
`contour 48d336f39f3d9731`, `organic 7eb2c466ed7e2c57`, `edge cb3b837fad7cdb1e`,
`brightness 79c5ffc4f959ee14`, `mixed 13af874660954ffd`, `lineDesign 2f97a31a8c3ce2cc`.

**T2. Every stone is the unrotated stone rotated about the box centre.** For the eight non-Line-Design
cases at 30° and 90°: the same count, and every stone within 1e-9 mm of the rotation-0 stone
rotated by the test's own rotation (clockwise, about (44, 44), written in the test, not
`rotatePointsAroundCenter()`). Size, colour, index and metadata are equal, and `checkFixStats` is
deep-equal. -330° equals 30°.

**T3. Line Design likewise.** At 30° and 90°: the same check, with `metadata.kind` and `pathId`
equal. The fixture's Line Design output has all three populations.

**T4. app.js passes `rotationDeg`, and the Line Design cache key includes it.** The real
`generateImageStonesLive()` body is extracted and run through `new Function()` against a spy engine
(the `test-img-013` item 12 pattern). Its dependency list adds `lineDesignStoneCache`,
`lineDesignFrozen` and `lineDesignColorMapKey`, as `test-img-010` does.

* For `fillMode` `'staggered'` and `'line-design'`: `rotationDeg` 30 reaches the engine as 30; 0 as 0;
  a layer with no `rotationDeg` key as 0. The 30° stones returned through `app.js` are the 0° stones
  rotated rigidly.
* Line Design cache: the same layer at 30° twice makes one engine call. At 45° it makes a second.
  The key matches `/const key=\[layer\.id,[^\]]*\]\.join\('\|'\);/` and contains `layer.rotationDeg??0`.
* Source guards: `resolveImageExportRegions()` contains `rotationDeg:layer.rotationDeg??0`; the
  Boolean field return is present verbatim; the rotate `drag=` line is directly followed by the Line
  Design freeze line.

**T4b. `endActiveDrag()` unfreezes after a rotate drag.** The real function body runs under
`new Function()` with a local `drag`, `activeGuides`, `lineDesignFrozen` and spies for
`drawLayout`, `updateAll` and `invalidateLineDesignCache`. For `kind` `'resize'` and `'rotate'` with
the cache frozen: unfrozen, `['I']` invalidated, one `updateAll`. An unfrozen rotate drag makes no
`updateAll`.

**T5. A non-rotated project is unchanged.** Through the same extracted `generateImageStonesLive()`
with the real engine, the layer with no `rotationDeg` key and with 0 gives the develop digest of
the live stones (`x`, `y`, `d`, `color`, `layerId`): `staggered 797ad52ad3430136`,
`line-design 58883c2d1d3b23f8`. `resolveImagePolygons()` gives regions digest `b0678a09255c2e44`, and
`combineShapeSources()` on a `'field'` source (union, `targetSpacingMm` 2.3) gives contours digest
`fdb389961b5ae2cf`, with `rotationDeg` missing and 0.

**T6. D3.** `resolveImagePolygons()` at 30° and 90°: the same region colour ids, and every contour
point within 1e-9 mm of the unrotated point rotated about the box centre. `combineShapeSources()` on
a `'field'` source with `rotationDeg` 30 and 90: the traced area is within 3% of the upright trace
(1530.8 and 1541.1 against 1541.1 mm²). The area centroid is within 0.25 mm of the upright centroid
rotated (0.075 mm and 0.000 mm measured). A source that ignored the rotation would be 1.46 mm and
4.00 mm off.

**T7. D4.** Source guards on `renderImageStudio()`: the `studioBox` and `bbox` lines verbatim;
exactly two `ctx.drawImage(` calls in the function, both inside `drawInBox`; exactly three
`drawInBox(` calls (Source and Overlay through `paintSource`, Mask, Colours). The Studio is DOM-bound,
so this item is a guard. The build's browser verification is what shows the rotated view.

All eight pass on the prototype in 1.7 s. On a develop copy, every item except T1 fails.

**Mutants and the item each kills.** Each was run on the prototype, one at a time.

| Decision | Mutant | Killed by | Result under the mutant |
|---|---|---|---|
| D1 | pivot is the stones' own bounding-box centre (text's convention) | T2 (also T3, T4) | `fill` at 30°: stone 0 at (30.494, 14.990), expected (30.392, 15.070) |
| D1 | counter-clockwise | T2 (also T3, T4) | stone 0 at (12.142, 41.320) |
| D1 | rotation applied before S-200 infill and gap fill | T2 | `staggeredFillGaps` at 30°: stone count differs |
| D1 | Line Design excluded from the rotation | T3 (also T4) | Line Design stone 0 stays at (18.499, 25.277) |
| D2 | `normalizeImageParams()` keeps the raw value, no `normalizeRotationDeg()` | T1 | 360° is no longer byte-identical |
| D2 | the live `params` omit `rotationDeg` | T4 | `staggered`: the engine gets `undefined`, not 30 |
| D2 | the Line Design `params` omit `rotationDeg` | T4 | the same for `line-design` |
| D2 | the Line Design cache key leaves out `rotationDeg` | T4 | the 0° call returns the cached 30° stones without an engine call |
| D2 | a rotate drag does not freeze Line Design | T4 | the freeze-line guard fails |
| D2 | `endActiveDrag()` unfreezes after a resize only | T4b | `rotate`: still frozen, no regeneration |
| D3 | `resolveImagePolygons()` leaves the regions upright | T6 | 30°: region 0 point 0 off |
| D3 | `resolveImageExportRegions()` does not pass `rotationDeg` | T4 | guard fails |
| D3 | the Boolean field source carries no `rotationDeg` | T4 | guard fails |
| D3 | `PathBoolean` samples a rotated field unrotated | T6 | 30°: centroid 1.49 mm off |
| D3 | `PathBoolean` rotates the query point the wrong way | T6 | 30°: centroid 2.86 mm off |
| D3 | `PathBoolean` keeps the unrotated bounding box | T6 | 30°: traced area 271.4 against 1541.1 mm² (the trace is clipped) |
| D4 | the Studio fits the unrotated box | T7 | `bbox` guard fails |
| D4 | the Studio's Mask view is drawn upright | T7 | three `ctx.drawImage(` calls, not two |

One more mutant was tried and dropped because it is equivalent: `PathBoolean` taking its rotated
branches at 0° (`source.rotationDeg !== undefined`). Rotating by 0 gives the same bits on this
fixture, so T5 does not see it. T5 has no mutant of its own. Each new branch is guarded by a
non-zero rotation, so rotation 0 takes today's code by construction, and T5 pins that end to end.

## Existing tests

**One existing test is expected to move:** `tools/test-alignment-snapping-wiring.mjs` test 7
(`:122`). It pins the whole of `endActiveDrag()` in one regex, and D2 changes its condition. The
regex's `else if\(ended&&ended\.kind==='resize'&&lineDesignFrozen\)` becomes
`else if\(ended&&\(ended\.kind==='resize'\|\|ended\.kind==='rotate'\)&&lineDesignFrozen\)`, and its
comment (`:116-119`) gains the rotate drag. Nothing else in the test changes.

The whole default suite (`node tools/run-tests.mjs`) was run on a clean copy of `b22053b` (168
files) and on the prototype (169, with the new file). On the develop copy, 167 passed. On the
prototype, 167 passed plus the new file. The one failure on both copies was
`test-img-013-fill-empty-slots.mjs` item 15, a 100 ms timing budget (118 ms), because the two suites
ran at the same time. It passes 15 of 15 on its own, on both. The only other failure on the prototype
is `test-alignment-snapping-wiring.mjs` test 7. The three files excluded from the default run that
touch this code pass on both copies: `test-move-drag-fast-path-wiring.mjs` (12 of 12),
`test-gallery-integration.mjs` (11 of 11) and `test-export-combined-preview-png.mjs` (8 of 8).

* No existing image test passes a non-zero `rotationDeg` to `generateImageLayout()`,
  `resolveImagePolygons()` or a `'field'` source, so no pinned geometry moves.
* `tools/test-img-020-image-stones-in-design.mjs` feeds Design synthetic stones and never calls the
  engine, so it is unaffected.

## Build housekeeping

* `tools/test-img-021-rotated-image-stones.mjs` is registered in `tools/test-groups.mjs`'s `geometry`
  group (`:189`), after `test-img-019-subject-mask-resized.mjs` (`:215`), with
  `assertTestRegistered({ filename, group: 'geometry', includedInDefault: true })`.
* `docs/BACKLOG.md:69` (image stones ignore `rotationDeg`) is marked implemented, pointing here.
* `docs/BACKLOG.md` gains the missing row: "SVG layers ignore `rotationDeg`". Evidence:
  `generateSvgStonesLive()` passes no rotation, and `docs/ARCHITECTURE.md:1281`. Proposed fix: the
  same insertion point as RS-3033's `_pathPolygons()` rotation.
* `docs/ARCHITECTURE.md`'s RS-3012 Step 2 paragraph (`:1275-1288`) gains one sentence: since IMG-021
  an image layer's stones, its SVG-export regions and its Boolean trace follow `rotationDeg`, about
  the unrotated box's centre.
* This spec's Status line becomes "built" in the build commit.

## Out of scope

* SVG layer rotation, the rotated image's rectangle-proxy rebuild on reconcile, and the stale
  Inspector (D5).
* Any change to Design (`src/drawing/**`).

## Findings for decision

1. **The brief's D3 premise.** `resolveImagePolygons()` feeds the SVG export's regions, not Boolean
   Operations. Boolean Operations use `resolveLayerShapeSource()`'s `'field'` source. D3 covers both.
   The Boolean part changes `src/geometry/PathBoolean.js`, a shared module. The change is additive,
   and a source without `rotationDeg` is byte-identical (T5). Approve or cut back to "regions only,
   plus a BACKLOG row for Boolean Operations".
2. **The brief's D5 premise.** There is no SVG-rotation row in `docs/BACKLOG.md` to point to. The
   build adds one (Build housekeeping).
3. **Test items beyond T1 to T5.** T4b, T6 and T7 were added so that D2's drag freeze, D3 and D4 each
   have an item that kills their mutants.
4. **Rotated designs can now reach past the safe area.** At 30°, the butterfly at import defaults
   puts 2 stones past the Flat Sheet's 10 mm safe inset. On develop the check reads upright stones
   and reports none. This is correct behaviour, not a defect. The existing safe-area guide and
   outside-area count report it.
