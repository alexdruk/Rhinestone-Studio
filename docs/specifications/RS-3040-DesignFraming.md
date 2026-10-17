# RS-3040 — Design framed on the sheet

**Status: built.** File:line citations are against `develop` @ `f7f7aa1`
(the IMG-021 merge). Every anchor below was re-grepped on that tip. The Step 0 figures come from a
real browser (Chrome, headless, isolated context) on that tip. The prototype figures, T1 to T6 and
every mutant result come from a scratch copy of the tree with D1 to D4 applied, served and tested the
same way. The copy lives in the session scratchpad, not under `tools/scratch/`. The follow-up commit
records the decisions on the four findings (see the last section). It changed D2's plate guides,
added D4 (`#fitNotice`), T6 and six mutants, and added a BACKLOG row to the build housekeeping.

## Objective

Design opens too far zoomed in on a high-density screen, and it never shows where the sheet is.

* **Zoom.** `enter()` (`DrawingCanvasTool.js:4205`) and `resize()` (`:4375`) compute the fit scale as
  `drawingBaseScale(canvasMm, canvasEl.width, canvasEl.height, paddingPx)` (`:4241`, `:4378`).
  `canvasEl.width`/`height` are the backing store, which is `devicePixelRatio` times the CSS box.
  `paper.view.zoom` is in CSS px per mm, because `resyncViewSize()` (`:1415`) feeds Paper the CSS box
  (`:1428`). app.js also passes the padding already multiplied by `devicePixelRatio` (`app.js:2996`,
  `:6763`). At DPR 2 Design opens at exactly twice the fit zoom, and only 37 to 57% of the sheet is
  visible.
* **Template change.** `canvasMm` is fixed at `enter()`. A template or sheet-size change while Design
  is open goes through `updateAll()` into `resize()`, which re-fits the old sheet. The view stays
  centred on the previous template.
* **No sheet.** Design draws a grid, shapes and stones. It never draws the sheet outline or the
  safe-area guide. The 2D canvas's hint (`#fitNotice`, `app.js:3074`) still reads "Flat Sheet: keep
  stones inside the dashed safe-area guide." while Design is open, because `drawLayout()` is a no-op
  in Design and leaves the last 2D text in place.

RS-3040 makes Design fit the whole sheet in CSS px at any DPR, draws the sheet outline and the
safe-area guide (or, for a plate, the plate circles) from the data the 2D canvas uses, keeps the
user's zoom until the sheet itself changes, and makes `#fitNotice` describe what Design shows.

## Step 0: what develop shows today

Design is active at boot. "Entry" below is a fresh entry: the Text dialog opened (which exits Design),
closed, then `#menuDesign`. For Flat Sheet, the template was switched first. "CSS fit" is
`min((cssW - 76) / W, (cssH - 76) / H)`, the fit with a 38 CSS px margin. "Sheet visible" is the part
of the `W × H` sheet inside `paper.view.bounds`.

| Template | Viewport | DPR | CSS box | Backing | Paper viewSize | Zoom | CSS fit | Ratio | Centre | Sheet visible |
|---|---|---|---|---|---|---|---|---|---|---|
| Flat Sheet 150 × 150 | 2576 × 1366 | 1 | 1766 × 1192 | 1766 × 1192 | 1766 × 1192 | 7.44 | 7.44 | 1 | (75, 75) | 150 × 150 mm (100%) |
| Mug 257.61 × 85 | 2576 × 1366 | 1 | 1766 × 1192 | 1766 × 1192 | 1766 × 1192 | 6.5603 | 6.5603 | 1 | (128.81, 42.5) | 257.6 × 85 mm (100%) |
| Flat Sheet 150 × 150 | 2576 × 1366 | 2 | 1766 × 1192 | 3532 × 2384 | 1766 × 1192 | 14.88 | 7.44 | 2 | (75, 75) | 118.7 × 80.1 mm (42.3%) |
| Mug 257.61 × 85 | 2576 × 1366 | 2 | 1766 × 1192 | 3532 × 2384 | 1766 × 1192 | 13.1206 | 6.5603 | 2 | (128.81, 42.5) | 134.6 × 85 mm (52.2%) |
| Flat Sheet 150 × 150 | 1440 × 900 | 1 | 630 × 726 | 630 × 726 | 630 × 726 | 3.6933 | 3.6933 | 1 | (75, 75) | 150 × 150 mm (100%) |
| Mug 257.61 × 85 | 1440 × 900 | 1 | 630 × 726 | 630 × 726 | 630 × 726 | 2.1505 | 2.1505 | 1 | (128.81, 42.5) | 257.6 × 85 mm (100%) |
| Flat Sheet 150 × 150 | 1440 × 900 | 2 | 630 × 726 | 1260 × 1452 | 630 × 726 | 7.3867 | 3.6933 | 2 | (75, 75) | 85.3 × 98.3 mm (37.3%) |
| Mug 257.61 × 85 | 1440 × 900 | 2 | 630 × 726 | 1260 × 1452 | 630 × 726 | 4.3011 | 2.1505 | 2 | (128.81, 42.5) | 146.5 × 85 mm (56.9%) |

The ratio is exactly 2.000 at DPR 2 in every case, and exactly 1 at DPR 1. Paper's own `viewSize`
is always the CSS box, so only the fit scale is wrong.

**Template change while Design is open** (boot on Mug, then Flat Sheet chosen in `#objectType`):
zoom and centre do not move. The view keeps the Mug's centre (128.81, 42.5) on a 150 × 150 sheet
whose centre is (75, 75).

| Viewport, DPR | Zoom before → after | CSS fit for the sheet | Sheet visible after |
|---|---|---|---|
| 2576 × 1366, 1 | 6.5603 → 6.5603 | 7.44 | 150 × 133.3 mm (88.9%) |
| 2576 × 1366, 2 | 13.1206 → 13.1206 | 7.44 | 88.5 × 87.9 mm (34.6%) |
| 1440 × 900, 1 | 2.1505 → 2.1505 | 3.6933 | 150 × 150 mm (100%, off-centre) |
| 1440 × 900, 2 | 4.3011 → 4.3011 | 3.6933 | 94.4 × 126.9 mm (53.3%) |

**User zoom across a reconcile.** Four Ctrl+wheel steps, then a `#selectedLayer` change
(`updateAll(true)`, which runs `resize()` and `syncFromProjectLayers()`): zoom and centre are unchanged
in all eight cases. `resize()` already keeps `board.zoom` and the pan. D3 keeps that behaviour.

**Design's Paper layers.** Two: the grid (2090 lines, built once per page by `buildGrid()`, `:1453`)
and the content layer. Nothing marks the sheet.

Screenshots and the raw figures are in the report, not in the repository.

## What the 2D canvas draws, and what "sheet" means

The 2D canvas (`drawLayout()`, `app.js:3052`) never draws the sheet outline either. It draws:

* `renderProductionLayout()` (`CanvasRenderer2D.js:204`): background, a grid around the stones and
  the stones. The view is fitted to the **stones' bounding box** (`fitTransform()`, `:74`), not the
  sheet, so the sheet's edges are often off screen.
* One guide branch (`app.js:3073`), all from `project.canvas` and the current template:

| Template kind | Guide | Source |
|---|---|---|
| `sheet` (Flat Sheet) | dashed safe-area rectangle, if `showSafeArea` | `drawSafeAreaGuide()` (`app.js:3080`) with `getSafeAreaRectMm(template, W, H)` (`ObjectTemplate.js:148`) |
| `mug`, `tumbler`, `bottle` | amber Front View Frame, then the dashed safe-area rectangle, if `showSafeArea` | `drawFrontViewFrame()`, `drawSafeAreaGuide()` |
| `plate` | the design-target circle or annulus, plus a dashed transition circle for Full Top Surface | `drawPlateDesignTargetGuide()` (`app.js:3089`) with `getPlateDesignTargetGuide()` (`PlateGuides.js:29`) |

"Sheet" is the production canvas, `project.canvas`, with origin (0, 0) in the same Y-down mm space as
every layer and stone:

* **Flat Sheet**: the sheet itself, 150 × 150 mm by default (`getSheetDefaults()`), editable. Safe
  inset 10 mm on every side (`ObjectTemplate.js:239`), so the guide is (10, 10, 130, 130).
* **Mug**: the unwrapped printable band, `computeCanvasFromVessel()`
  (`VesselProductDefinition.js:177`): width π × body diameter (π × 82 = 257.61 mm), height the
  printable height (85 mm). Safe inset 14 mm left and right, 10 mm top and bottom (`:161`), so the
  guide is (14, 10, 229.61, 65).
* **Plate**: a square of the outer diameter (270 × 270 mm by default). Inset 0 (`:221`). Its printable
  boundary is the design-target circle, not a rectangle.

## Decisions

### D1. The fit is in CSS px at any `devicePixelRatio`

A new private `fitBaseScale(paddingPx)` in `DrawingCanvasTool.js`, placed after `resyncViewSize()`,
replaces both `drawingBaseScale(canvasMm, canvasEl.width, canvasEl.height, paddingPx)` calls
(`:4241`, `:4378`):

```js
function fitBaseScale(paddingPx) {
  const rect = canvasEl.getBoundingClientRect();
  const dpr = Math.max(1, (typeof devicePixelRatio === 'number' && devicePixelRatio) || 1);
  const widthPx = rect.width > 0 ? rect.width : canvasEl.width / dpr;
  const heightPx = rect.height > 0 ? rect.height : canvasEl.height / dpr;
  return drawingBaseScale(canvasMm, widthPx, heightPx, paddingPx);
}
```

* **Units.** `paddingPx` becomes CSS px. `drawingBaseScale()` (`DrawingBoard.js:155`) is unchanged.
  The box is the same `getBoundingClientRect()` that `resyncViewSize()` gives Paper, so the fit and
  Paper's `viewSize` can no longer disagree.
* **Margin.** 38 CSS px, a fixed value. app.js passes `38` at both call sites: `enter()` in
  `setDrawMode()` (`app.js:6763`) and `resize()` in `updateAll()` (`:2996`). Today both pass
  `38*Math.max(1,devicePixelRatio||1)`, which equals 38 CSS px only at DPR 1. The DPR 1 figures above
  therefore do not change.
* **No laid-out box.** A zero-size rect (jsdom, a hidden canvas) falls back to the backing size divided
  by DPR. In a browser Design only runs on a visible canvas, so the fallback never applies there. It
  exists so the Node Design harness keeps today's zoom: those tests set `canvas.width`/`height` and
  get a 0 × 0 rect from jsdom, and `devicePixelRatio` is undefined there, so the fallback gives exactly
  today's figure. No existing harness test moves (Existing tests).
* **Fit target.** The whole `canvasMm` (D3 keeps it equal to `project.canvas`), centred. Unchanged
  from today apart from the units: `applyViewport()` (`:1377`) already centres on `canvasMm`.

### D2. Design draws the sheet outline and the safe-area guide, or the plate circles

**Data, in app.js.** A new `designSheetFraming()` next to `layoutStonesForLayer()` (`app.js:1649`)
returns `{canvasMm, guides}` for the current project. It calls the same `project.canvas`,
`currentObjectTemplate()`, `getSafeAreaRectMm()`, `getPlateDesignTargetGuide()` and `showSafeArea`
that `drawLayout()` uses, so no guide geometry is written twice:

| Guide | Role | When | Geometry |
|---|---|---|---|
| sheet outline, solid | `sheet` | not a plate | `(0, 0, W, H)` |
| safe area, dashed | `safeArea` | not a plate, and `showSafeArea` | `getSafeAreaRectMm(template, W, H)` |
| plate target, solid | `plateTarget` (circle) or `plateOuter` and `plateInner` (annulus) | plate | `getPlateDesignTargetGuide(project.plate.designTarget, project.plate, W, H)` |
| plate transition, dashed | `plateTransition` | plate, when `transitionRadiusMm` is set | the same call |

**A plate draws exactly the 2D canvas's circles** (`drawPlateDesignTargetGuide()`, `app.js:3089`),
from the same `PlateGuides.js` call, and no rectangle. There is no `sheet` outline for a plate: its
`project.canvas` is the outer-diameter square, which is not a physical edge. With the default plate
(270 mm, 195 mm well, centred at (135, 135)):

| Design target | Guides (role, dashed, bounds) |
|---|---|
| Center Well (default) | `plateTarget`, solid, (37.5, 37.5, 195, 195) |
| Full Top Surface | `plateTarget`, solid, (0, 0, 270, 270); `plateTransition`, dashed, (37.5, 37.5, 195, 195) |
| Rim Band | `plateOuter`, solid, (0, 0, 270, 270); `plateInner`, solid, (37.5, 37.5, 195, 195) |

The fit (D1) still frames the whole `project.canvas`, so the disc is fully visible.

Each guide is plain data: `{role, kind: 'rect'|'circle', xMm, yMm, widthMm, heightMm}` or
`{role, kind, cxMm, cyMm, radiusMm}`, plus `dashed`. Plate guides also carry the design target's
`label` (for D4). `DrawingCanvasTool.js` never learns about templates. It draws rectangles and circles
and ignores `label`.

**Wiring.** One new hook in `createDrawingTool()`'s hooks (after `getImageLayerStones`, `:1159`), with
a `() => null` default: `getSheetFraming`. app.js adds, after `getImageLayerStones:` (`app.js:2433`):

```js
getSheetFraming:()=>{const framing=designSheetFraming();el('fitNotice').textContent=designFitNotice(framing);return framing}
```

D4 covers the `#fitNotice` write. The tool reads the hook in `enter()` and in every `resize()`, so
every existing `updateAll()` pass while Design is open picks up the current data.
`updateAll()`'s body changes only by the `38` argument. This matters because
`test-autosave-recovery-wiring.mjs` runs that body under `new Function()` with a fixed dependency list
(`:203-224`). A new identifier there would throw.

The Settings dialog's Apply (`app.js:7382`) toggles `showSafeArea` and calls only `drawLayout()`, a
no-op in Design. It gains `if(drawingTool.isActive)drawingTool.resize(38);` before `drawLayout()`.

**Drawing.** A new `sheetGuideLayer`, a `paper.Layer` created on first use and kept for the page's
lifetime, like `gridLayer`:

* **Order.** `insertBelow(contentLayer)`, then `contentLayer.activate()`. The stack is grid, guides,
  content, so every shape, stone, handle and preview draws on top. `debugGrid.activeLayerIsContentLayer`
  stays true.
* **Rebuild.** `rebuildSheetGuides(guides)` runs after `buildGrid()` in `enter()` and after the fit in
  `resize()`. It is keyed on `JSON.stringify(guides)` and returns early when nothing changed, so an
  ordinary reconcile builds nothing.
* **Style.** `strokeScaling = false`, so the 1.25 px width and the `[5, 4]` px dashes stay screen-sized
  at every zoom with no rebuild on wheel or pan (verified in Chrome at DPR 1 and 2). The safe area
  uses the 2D guide's colour, `rgba(20,120,255,.6)`, dashed. The outline is solid
  `rgba(20,40,80,.55)`, so the sheet edge reads as distinct from the safe area. Stroke only, no fill:
  the grid stays visible inside the sheet.
* **Not interactive.** `sheetGuideLayer.locked = true`. Paper's `_hitTest` returns null for a locked
  item (`paper-core.js:4028`), so the stroke fallback in `hitTestShapeId()` (`:1521`) never returns a
  guide. Guides are never in `board.shapes`, so `.contains()`, marquee, Select, mark-target resolution
  and every `onShape*` hook never see them. They carry `data.sheetGuideRole` and no `layerId` or
  `shapeId`.
* **Not exported, not counted.** Every exporter and every stone count reads the `StoneLayout`
  (`layout`). None reads Design's Paper scene. Guides never reach `project.layers` or `layout`.
* **QA surface.** A read-only `debugSheetGuides` getter, next to `debugGrid` (`:5092`): the three layer
  indexes, `locked`, and each guide's role, `bounds`, `dashed` and `strokeScaling`.

**Not drawn in Design:** the Front View Frame (an Object Preview control with its own drag), the
plate's text label (a BACKLOG row, Build housekeeping), and the 2D canvas's stone-count caption. See
Out of scope.

### D3. User zoom and pan are kept; a sheet change re-fits

`resize()` becomes:

```js
resize(paddingPx) {
  if (!board.active) return;
  resyncViewSize();
  const framing = getSheetFraming();
  applySheetFraming(framing, true);
  baseScale = fitBaseScale(paddingPx);
  if (framing) rebuildSheetGuides(framing.guides);
  applyViewport();
},
```

`applySheetFraming(framing, refitOnCanvasChange)` copies `framing.canvasMm` into `canvasMm`. When
`refitOnCanvasChange` is true and the width or height differs from the previous `canvasMm`, it resets
`board.zoom` to 1 and the pan to 0. `enter()` calls it with `false`, because `board.reset()` has
already reset the viewport there.

| Change while Design is open | Result |
|---|---|
| reconcile (`updateAll()`), undo, redo, layer edits | zoom and pan kept (as today) |
| window resize, workspace reflow | base scale re-derived from the new box; the user's zoom factor and pan kept (as today) |
| Settings Apply (safe area on or off) | guides rebuilt; zoom and pan kept |
| template change (`#objectType`) | re-fit to the new sheet: zoom 1, pan 0, new guides |
| sheet width or height, vessel diameter or printable height | re-fit (the canvas size changed) |

Without the hook (the Node harness's existing tests), `resize()` keeps the `canvasMm` given to
`enter()` and draws no guides, exactly as today.

### D4. `#fitNotice` describes Design while Design is open

`#fitNotice` (`index.html:528`) is written only by `drawLayout()` (`app.js:3074`), which is a no-op in
Design. So Design shows whatever the 2D canvas last wrote: on a Mug it asks the user to drag an amber
Front View Frame Design does not draw, and after a template change inside Design it names the old
template.

A new `designFitNotice(framing)`, directly after `designSheetFraming()`, returns the text from the
current template's `displayName` and the guides the framing actually holds:

```js
function designFitNotice(framing){const name=currentObjectTemplate().displayName,plate=framing.guides.find(g=>g.label);if(plate)return`${name}: keep stones inside the blue ${plate.label} guide.`;return framing.guides.some(g=>g.role==='safeArea')?`${name}: keep stones inside the dashed safe-area guide.`:`${name}: keep stones inside the sheet outline.`}
```

| Case | `#fitNotice` in Design |
|---|---|
| Flat Sheet, safe area on | `Flat Sheet: keep stones inside the dashed safe-area guide.` |
| Mug, safe area on | `Mug: keep stones inside the dashed safe-area guide.` |
| any rectangle template, safe area off | `<name>: keep stones inside the sheet outline.` |
| plate | `Round Dinner Plate: keep stones inside the blue <Center Well \| Full Top Surface \| Rim Band> guide.` |

* **Where it is written.** In the `getSheetFraming` hook (D2), which the tool calls on `enter()` and on
  every `resize()`. So it is set on entry and follows a template change, a sheet-size change, a plate
  design-target change, undo and redo, and Settings Apply, with no new call site in `updateAll()`.
* **On exit.** `setDrawMode(false)` already calls `drawLayout()`, which writes the 2D text again.
* **Never mentions** the Front View Frame, dragging, or a guide the framing does not hold.

### D5. Out of scope

* **The stale Inspector after a Design drag** (IMG-020 Findings 3, `docs/BACKLOG.md:70`). Unchanged.
* **Stones in Design for `svg`, `circle`, `rectangle` and the shape library** (IMG-020 Findings 1).
  Unchanged.
* **The Image dialog exits Design and does not return to it** (IMG-020 build notes). Unchanged.
* The Front View Frame in Design, a sheet-coloured fill, and any change to the 2D canvas.

## Anchors

Every anchor was re-grepped on `f7f7aa1`, and the line given is the actual line.

| File | Line | Content |
|---|---|---|
| `src/drawing/DrawingCanvasTool.js` | `:260` | `const GRID_EXTENT_MARGIN_MM = 2000;` (the guide style constants go after it) |
| | `:1159` | `getImageLayerStones = () => null` (the `getSheetFraming` hook default goes after it) |
| | `:1168`, `:1170`, `:1171` | `let gridLayer = null;`, `let canvasMm = …`, `let baseScale = 1;` |
| | `:1377` | `function applyViewport() {` (centres on `canvasMm`) |
| | `:1415`, `:1428` | `function resyncViewSize() {`, `paper.view.viewSize = new paper.Size(rect.width, rect.height);` |
| | `:1453`, `:1482` | `function buildGrid() {`, `gridLayer.sendToBack();` |
| | `:1516`, `:1521` | `function hitTestShapeId(point) {`, its `paper.project.hitTest(point, {` fallback |
| | `:1995` | the rotate handle's `dashArray` (the only dashed chrome today) |
| | `:4205`, `:4241`, `:4247` | `enter(projectCanvasMm, paddingPx, …) {`, its `drawingBaseScale(…canvasEl.width…)`, `if (!gridLayer) buildGrid();` |
| | `:4375`, `:4378` | `resize(paddingPx) {`, its `drawingBaseScale(…canvasEl.width…)` |
| | `:4382`, `:4416` | `exit() {`, `onWheel(event) {` |
| | `:5092`, `:5111` | `get debugGrid() {`, `debugHitTestShapeId(xMm, yMm) {` |
| `src/drawing/DrawingBoard.js` | `:155` | `export function drawingBaseScale(…)` (unchanged) |
| `app.js` | `:1649`, `:1650` | `function layoutStonesForLayer(layerId){`, `const drawingTool=createDrawingTool(layoutCanvas,{` |
| | `:2433` | `getImageLayerStones:(layerId)=>layoutStonesForLayer(layerId)` |
| | `:2474`, `:2499` | `let showSafeArea=true;`, `function currentObjectTemplate(){` |
| | `:2996` | `renderLayerUI();if(drawingTool.isActive){drawingTool.resize(38*Math.max(1,devicePixelRatio\|\|1));` |
| | `:3040`, `:3052` | `function resizeCanvas(c){`, `function drawLayout(){` |
| | `:3073`, `:3074` | the 2D guide branch, `#fitNotice` text |
| | `:3080`, `:3089` | `function drawSafeAreaGuide(…){`, `function drawPlateDesignTargetGuide(…){` |
| | `:5116` | `el('objectType').addEventListener('change',…` (template change, then `updateAll(true)`) |
| | `:6728`, `:6763` | `function setDrawMode(active,mode){`, its `drawingTool.enter({…},38*Math.max(1,devicePixelRatio\|\|1),mode);` |
| | `:7382` | `el('settingsApply').onclick=()=>{` |
| `src/products/ObjectTemplate.js` | `:148` | `export function getSafeAreaRectMm(…)` |
| | `:161`, `:221`, `:239` | the `mug`, `plate` and `sheet` template definitions |
| `src/products/PlateGuides.js` | `:29` | `export function getPlateDesignTargetGuide(…)` |
| `src/products/VesselProductDefinition.js` | `:177` | `export function computeCanvasFromVessel(…)` |
| `src/renderer/CanvasRenderer2D.js` | `:74`, `:204` | `fitTransform()` (fits the stones, not the sheet), `renderProductionLayout()` |
| `index.html` | `:528`, `:632` | `#fitNotice`, `#drawModeHint` |
| `tools/test-autosave-recovery-wiring.mjs` | `:198`, `:203-224`, `:272` | the `drawingTool.resize` spy, the `new Function()` dependency list, the Design `updateAll()` test |
| `tools/test-rs3012-step4-circle-select.mjs` | `:92` | `function dashedItemCount() {` (counts dashed items on every layer) |
| `tools/test-rs3012-step5-rectangle-select.mjs` | `:103` | `function dashedItemCount() {` (the same) |
| `docs/BACKLOG.md` | `:71` | the "SVG layers ignore `rotationDeg`" row (the plate-label row goes after it) |
| `tools/test-groups.mjs` | `:366`, `:378` | `editing: [`, `'test-img-020-image-stones-in-design.mjs',` |

## Tests the build must add

T1 to T5 go in a new `tools/test-rs-3040-design-framing.mjs`, on the Design harness of
`tools/test-img-020-image-stones-in-design.mjs`: the real `createDrawingTool()` under
`loadPaperForNode()`, the sprite-bake canvas stub, and real pointer gestures through
`paper.tool.emit()`.

**Harness.** jsdom lays nothing out, so the test stubs `canvas.getBoundingClientRect()` and sets
`globalThis.devicePixelRatio`. `setScreen(w, h, dpr)` gives a CSS box of `w × h` and a backing store
of `w·dpr × h·dpr`, as `resizeCanvas()` does. One tool, created once. Its `getSheetFraming` hook is
app.js's real hook: the hook line, `designSheetFraming()` and `designFitNotice()` (one line each) are
sliced from `app.js` and run through `new Function()` with the real `getObjectTemplate`,
`getSafeAreaRectMm` and `getPlateDesignTargetGuide`, a mutable fake `project` and `showSafeArea`, and
an `el` that returns a fake `#fitNotice` (and fails for any other id). Projects: Flat Sheet
(`getSheetDefaults()`, 150 × 150), Mug (`computeCanvasFromVessel(getVesselDefaults('mug'))`,
257.61 × 85) and Plate (`getPlateDefaults()`, 270 × 270, with `designTarget` set per case). Layers:
an image `I` at (40, 40, 60 × 50) with three layout stones, and a rectangle `R` at (20, 100, 30 × 20).

**T1. Fit at DPR 1 and 2 (D1).** On a 600 × 400 CSS box at DPR 1 and 2, `enter()` with padding 38:

* Flat Sheet: zoom exactly `324 / 150` = 2.16 at both DPRs. Mug: `524 / 257.61` at both.
* Centre `(W / 2, H / 2)`. `paper.view.bounds` contains `(0, 0, W, H)`, and the tight margin is 38 CSS
  px (`min(-bounds.x, -bounds.y) × zoom`).
* `resize(38)` gives the same zoom.
* Fallback: a 0 × 0 rect with a 1200 × 800 backing store at DPR 2 gives `324 / 150` (1200 / 2 = 600
  CSS px wide).
* Source guards: app.js's `enter()` call contains `…},38,mode);`, and `updateAll()` contains
  `renderLayerUI();if(drawingTool.isActive){drawingTool.resize(38);`. No `drawingTool.enter(` or
  `drawingTool.resize(` call contains `devicePixelRatio`.

**T2. Guides with the template geometry (D2).**

* Flat Sheet: roles `['sheet', 'safeArea']`, dashed `[false, true]`, `strokeScaling` false on both.
  Bounds (0, 0, 150, 150) and (10, 10, 130, 130).
* Layer order grid < guides < content. `locked` is true. The content layer is still active.
* Mug: outline (0, 0, 257.61, 85). Safe area (14, 10, 229.61, 65), equal to `getSafeAreaRectMm()`.
* `showSafeArea` false, then `resize(38)`: roles `['sheet']` only.
* Settings Apply's body contains `if(drawingTool.isActive)drawingTool.resize(38);`.
* Plate, one entry per design target: exactly D2's plate table (roles, dashed and bounds, in order),
  no `sheet` and no `safeArea`, and `strokeScaling` false on every guide.

**T3. Guides are excluded (D2).** With `I` and `R` synced on Flat Sheet:

* At four guide points ((0, 75), (150, 30) on the outline, (10, 75), (75, 140) on the safe area):
  `debugHitTestShapeId()` is null, and `paper.project.hitTest(point, {stroke, fill, tolerance})` never
  returns an item with `data.sheetGuideRole`.
* A click on the outline at (0, 75) reports no selected layer.
* A Shift marquee from (-5, -5) to (155, 155), which covers every guide, reports exactly `['I', 'R']`.
* After `resize(38)`: `debugShapes` is still `['I', 'R']`, `I` still draws 3 stones, and
  `onShapeCommitted` never fired.
* Source guards: `designSheetFraming` appears exactly twice in app.js (its definition and the hook),
  and `getSheetFraming` exactly once. Exports and stone counts read `layout` only.

**T6. `#fitNotice` (D4).** The fake `#fitNotice` starts with the 2D Mug text ("Drag the amber Front
View Frame …"). Then:

* Enter on the Mug: `Mug: keep stones inside the dashed safe-area guide.`
* The fake project becomes Flat Sheet, then `resize(38)`:
  `Flat Sheet: keep stones inside the dashed safe-area guide.`
* `showSafeArea` false, then `resize(38)`: `Flat Sheet: keep stones inside the sheet outline.`
* Plate at each design target, then `resize(38)`:
  `Round Dinner Plate: keep stones inside the blue Center Well guide.` (and `Full Top Surface`,
  `Rim Band`).
* None of the texts matches `/Front View|amber|drag to move/i`.
* `designFitNotice` appears exactly twice in app.js (its definition and the hook).

**T4. User zoom survives (D3).** On Flat Sheet: one Ctrl+wheel zoom and one wheel pan through
`onWheel()`. Then:

* `syncFromProjectLayers()` and `resize(38)`: `tool.zoom`, `paper.view.zoom` and the centre are
  unchanged.
* `showSafeArea` off then on, each followed by `resize(38)`: unchanged.
* A new 800 × 500 box at DPR 2, then `resize(38)`: `tool.zoom` unchanged, and `paper.view.zoom` =
  `(424 / 150) × tool.zoom`.

**T5. A sheet change re-fits (D3).** On Flat Sheet, zoomed and panned:

* The fake project becomes the Mug, then `resize(38)`: `tool.zoom` 1, zoom `524 / 257.61`, centre
  (128.81, 42.5), outline (0, 0, 257.61, 85).
* Zoom again, then a 200 × 120 sheet: `tool.zoom` 1, zoom `min(524 / 200, 324 / 120)`, centre
  (100, 60), safe area (10, 10, 180, 100).

All six pass on the prototype in about 1 s. On a develop copy the file stops at its first assertion:
app.js has no `designSheetFraming()`.

**Mutants and the item each kills.** Each was run on the prototype, one at a time.

| Decision | Mutant | Killed by | Result under the mutant |
|---|---|---|---|
| D1 | the fit reads `canvasEl.width`/`height`, as develop does | T1 (also T4) | Flat Sheet at DPR 2: zoom 4.8267, expected 2.16 |
| D1 | the no-layout fallback does not divide by DPR | T1 | fallback zoom 4.8267 |
| D1 | `updateAll()` keeps `38*Math.max(1,devicePixelRatio\|\|1)` | T1 | guard fails |
| D2 | the guide layer is not locked | T2, T3 | `locked` false; `paper.project.hitTest` returns a guide |
| D2 | the guide layer goes above the content layer | T2 | layer order grid 0 < guides 2 < content 1 |
| D2 | guide strokes scale with zoom | T2 | `strokeScaling` true |
| D2 | cylindrical templates get no safe-area guide | T2 (also T6) | no `safeArea` guide on the Mug |
| D2 | the safe-area guide ignores `showSafeArea` | T2 (also T6) | still drawn with the toggle off |
| D2 | Settings Apply does not refresh Design | T2 | guard fails |
| D2 | a plate also gets the square sheet outline | T2 | plate guides start with `sheet` |
| D2 | the plate transition circle is solid | T2 | `fullTopSurface`: guides differ |
| D3 | `resize()` never re-fits on a sheet change | T5 | `tool.zoom` 1.568 after the Mug switch |
| D3 | `resize()` re-fits on every call | T4 | zoom 2.16 after a reconcile |
| D3 | `resize()` ignores the hook (develop: `canvasMm` fixed at entry) | T2, T5 (also T6) | the toggle and the new sheet are not picked up |
| D4 | the hook does not write `#fitNotice` | T6 | the Mug entry leaves the 2D text |
| D4 | the notice names a fixed template (`'Flat Sheet'`) | T6 | the Mug entry reads `Flat Sheet: …` |
| D4 | the notice always mentions the safe-area guide | T6 | still mentioned with the toggle off |
| D4 | a plate gets the rectangle text | T6 | `centerWell`: wrong text |

## Existing tests

**No existing test is expected to move.** After the follow-up's changes, the existing files that touch
this code were re-run on the prototype, not the whole suite: `test-autosave-recovery-wiring.mjs`
(26 of 26), `test-img-020-image-stones-in-design.mjs` (9), `test-mono-021-mark-hooks.mjs` (10),
`test-maint-003-materializer-contract.mjs` (19), `test-rs3012-step4-circle-select.mjs` (10),
`test-rs3012-step5-rectangle-select.mjs` (9), `test-rs3015-mark-target-eligibility.mjs` (14),
`test-object-template-integration.mjs` (19) and `test-documentation-consistency.mjs` (29), all
passing. Before the follow-up, the whole default suite (`node tools/run-tests.mjs`) was
run on a clean copy of `f7f7aa1` (169 files, 169 passed) and then on the prototype (170 files, 170
passed, with the new file). The two runs were sequential, not parallel. The three files excluded from
the default run that touch this code pass on the prototype: `test-move-drag-fast-path-wiring.mjs`
(12 of 12), `test-gallery-integration.mjs` (11 of 11) and `test-export-combined-preview-png.mjs`
(8 of 8).

Why nothing moves:

* **Node Design harness tests** (`test-img-020-…`, `test-mono-021-mark-hooks.mjs`,
  `test-maint-003-…`, `test-rs3012-step4-…`, `test-rs3012-step5-…`, `test-rs3015-…`) pass no
  `getSheetFraming` hook, so they get no guide layer and today's `canvasMm`. jsdom's 0 × 0 rect takes
  D1's fallback, and `devicePixelRatio` is undefined there, so the zoom is today's figure (probed:
  3.1667 for the IMG-020 harness's 1200 × 800 canvas, 240 mm sheet, padding 20). This matters for
  `dashedItemCount()` in the two RS-3012 files, which counts dashed items on every layer. A dashed
  safe-area guide would be counted if those harnesses had guides.
* **`test-autosave-recovery-wiring.mjs`** records `drawingTool.resize` by name only, and `updateAll()`'s
  body gains no new identifier.

## Build housekeeping

* `tools/test-rs-3040-design-framing.mjs` is registered in `tools/test-groups.mjs`'s `editing` group
  (`:366`), after `test-img-020-image-stones-in-design.mjs` (`:378`), with
  `assertTestRegistered({ filename, group: 'editing', includedInDefault: true })`.
* `docs/ARCHITECTURE.md` gains one sentence in its "Design Mode / Drawing Board" section (`:1198`):
  since RS-3040 Design fits the sheet in CSS px and draws the sheet outline and safe-area guide from
  app.js's `designSheetFraming()`, on a locked layer between the grid and the content.
* No BACKLOG row exists for either defect, so none is closed.
* `docs/BACKLOG.md` gains one row, after the "SVG layers ignore `rotationDeg`" row (`:71`): "Design
  draws no label on a plate's design-target guide". Source RS-3040. Evidence: the 2D canvas labels the
  guide "`<target>` · printable boundary" (`drawPlateDesignTargetGuide()`); Design draws the circles
  (RS-3040 D2) and no text, and has no text chrome of its own.
* This spec's Status line becomes "built" in the build commit.

## Out of scope

* The stale Inspector, stones for other shapes in Design, and the Image dialog's return to Design
  (D5).
* The Front View Frame in Design, the plate label in Design (a BACKLOG row), and any 2D canvas change.

## Decisions on the findings

The four findings of the first version of this spec were decided as follows.

1. **Plate outline: replaced.** Design draws the plate circles from the same `PlateGuides.js` geometry
   the 2D canvas uses, not the 270 × 270 square (D2's plate table, T2, two new D2 mutants).
2. **Vessel dimension edits re-fit: approved** as D3 specifies. Editing a mug's body diameter or
   printable height inside Design re-fits the view.
3. **`#fitNotice`: fixed here.** While Design is open it names the current template, mentions only the
   guides Design draws, and follows a template change (D4, T6, four D4 mutants).
4. **Plate label in Design: out of scope.** The build adds a BACKLOG row (Build housekeeping).
