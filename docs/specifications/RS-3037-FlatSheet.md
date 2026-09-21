# RS-3037 — Flat Sheet Object Type

Spec-only milestone. No changes to `app.js`, `index.html`, `src/`, or `tools/` test files were
made in this step. All line numbers below were captured by grep against this branch's starting
commit, `2e5f45b` (tip of `develop` at milestone start).

## Objective

Add a new object type, `sheet` / "Flat Sheet" — a flat, 2D-only production surface with no
physical/3D counterpart — following the closest existing precedent, the Round Dinner Plate
(`id: 'plate'`, `preview.kind: 'plate'`, S-112).

## Product decisions (given, not open for redesign)

1. New object type id `'sheet'`, display name "Flat Sheet", added to the `#objectType` picker
   after Round Dinner Plate.
2. Default canvas 150×150mm. Width and height are each independently editable, clamped to
   20–500mm, in the project's display units.

   **Why 150, not 220**: the Production Sheet must fit A4 and Letter at the default 10mm margin.
   Measured at `2e5f45b` with `computeProductionSheetLayout()`, mirror and registration marks on,
   one gap value — the largest square that still fits both A4 and Letter is 188.5mm at 1 crystal
   color, 166.5mm at 6 colors, 157.5mm at 8 colors (the current maximum); stone-size count has no
   effect on this (the color legend grows about 4.5mm per color, one header line each — see
   `computeSizeBreakdownLineTexts()`). 150×150 clears the 8-color case with margin to spare and
   therefore fits both page sizes at any supported color count. Raising the color-count cap above 8
   in a future milestone would break this guarantee and must re-run this measurement.

   A newly imported image lands at 130mm on its longest side on a default 150×150 sheet (IMG-011's
   `computeDefaultImagePlacement()` clamps to canvas minus 20mm).
3. Safe-area inset 10mm on all four sides.
4. No 3D preview: while Flat Sheet is active, Dual Workspace and Object Preview are disabled and
   the workspace is 2D Canvas only. No new 3D geometry of any kind.
5. No wrap control and no Front View Frame — same as Round Dinner Plate already hides both.
6. Importing an image never auto-switches object type. When the active object isn't Flat Sheet,
   the Image panel shows a one-click "Switch to Flat Sheet" action.
7. SVG, DXF, PNG, and Production Sheet export work at the sheet's canvas size.
8. Default new project stays Mug. Every pre-milestone project loads and regenerates
   byte-identically.

---

## A. Touchpoint inventory

Every site below was located by grep against this branch's starting commit (`2e5f45b`). Each row
gives the file:line, current behavior for `'plate'`, and what `'sheet'` must do.

### A.1 `src/products/ObjectTemplate.js` — the template registry itself

| Site | Current behavior for `plate` | What `sheet` must do |
|---|---|---|
| `ObjectTemplate.js:23` — `const PREVIEW_KINDS = new Set(['mug', 'tumbler', 'bottle', 'plate'])` | `plate` is a recognized `preview.kind` | Add `'sheet'` to this set, or template creation throws (`preview.kind must be one of ...`) for a `sheet` definition |
| `ObjectTemplate.js:111-115` — `if (preview.kind !== 'plate') { assertPositiveNumber(preview.topWidthFactor, ...) ... }` | `plate` is the one kind exempted from requiring `topWidthFactor`/`bottomWidthFactor`/`bodyHeightFactor` (it has no cylindrical wall) | Must become `if (preview.kind !== 'plate' && preview.kind !== 'sheet')` — a flat sheet has no cylindrical-wall ratios either. **Without this change, adding a `sheet` template definition without those three factors throws at module load time** (verified by reading `createObjectTemplate()`'s validation order: this check runs unconditionally at import). |
| `ObjectTemplate.js:206-226` — the plate `TEMPLATE_DEFINITIONS` entry (`id:'plate'`, `productionWidthMm/HeightMm: getPlateDefaults().outerDiameterMm`, `safeAreaInsetMm: {0,0,0,0}`, `wrap:{supported:WRAP_MODES, default:'full'}`, `preview:{kind:'plate', hasHandle:false}`) | Plate's production size comes from `PlateProductDefinition.js`'s own default; safe area is zero (guide is drawn separately, circular) | New entry: `id:'sheet'`, `displayName:'Flat Sheet'`, `productionWidthMm:150`, `productionHeightMm:150` (or sourced from a new `getSheetDefaults()`, see §B), `safeAreaInsetMm:{top:10,right:10,bottom:10,left:10}`, `wrap:{supported:WRAP_MODES, default:'full'}` (matches the plate's own `default:'full'`, since the field is hidden for both — see decision 5), `preview:{kind:'sheet', hasHandle:false}` |
| `ObjectTemplate.js:229-233` — `OBJECT_TEMPLATE_IDS` derived from `TEMPLATE_DEFINITIONS` | 4 ids | Becomes 5 ids: `['mug','tumbler','bottle','plate','sheet']` (registration order; sorted order used by tests is `['bottle','mug','plate','sheet','tumbler']`) |

### A.2 `app.js` — every `preview.kind==='plate'` / `template.id==='plate'` / `VESSEL_PRODUCT_IDS` branch

| Site | Current behavior for `plate` | What `sheet` must do |
|---|---|---|
| `app.js:1193` (`validateProject()`) — `const vessel=VESSEL_PRODUCT_IDS.includes(productId) ? ... : ...` | `plate` falls into the `:` branch (not a vessel) | `sheet` also falls into the `:` branch unchanged — no code change needed here, `VESSEL_PRODUCT_IDS` never needs `'sheet'` added |
| `app.js:2597` — `enteringRimBand=currentObjectTemplate().preview.kind==='plate'&&...` (Rim Band intelligent default, S-112A) | Plate-only, drives curve-control pre-fill when Design Target becomes `rimBand` | No-op for sheet — sheet has no Design Target concept at all. No change needed (condition stays `==='plate'`, never true for sheet). |
| `app.js:2754-2758` (`writeSelectedControlsToLayer()`) — `if(currentObjectTemplate().preview.kind==='plate'){ project.plate=normalizePlateParams(...); project.canvas={width:...,height:...}; project.cupColor=...}` | Reads `#plateOuterDiameter` etc., writes `project.plate` + syncs `project.canvas` to the (square) outer diameter | New sibling branch: `if(currentObjectTemplate().id==='sheet'){ project.canvas={width:clampSheetDimensionMm(readLengthField('sheetWidth')), height:clampSheetDimensionMm(readLengthField('sheetHeight'))} }` — writes `project.canvas` directly (see §B), no `project.plate`/`project.cupColor` touch needed |
| `app.js:2765-2769` — `if(VESSEL_PRODUCT_IDS.includes(currentObjectTemplate().id)){...}` | Not entered for plate | Not entered for sheet either (`sheet` never joins `VESSEL_PRODUCT_IDS`) — no change |
| `app.js:2530` (`syncSelectedControlsFromLayer()`) fills the plate fields from `project.plate` via `setLengthField()`; `app.js:7108` (`refreshAllLengthFieldDisplays()`, the units-change path) re-formats them the same way | Neither site touches `#sheetWidth`/`#sheetHeight` today (they don't exist yet) | **Missing touchpoint, correctness risk**: both sites must also fill `#sheetWidth`/`#sheetHeight` from `project.canvas`, gated on `currentObjectTemplate().id==='sheet'`. `writeSelectedControlsToLayer()` reads these DOM fields back on *every* `updateAll()` call that doesn't pass `skipWrite` (`app.js:2807`, `if(!skipWrite)writeSelectedControlsToLayer()`) — if the sync sites don't refill the fields first, an undo/redo, a Project JSON import, or an autosave-recovery boot that restores `project.canvas` will leave the DOM fields showing the *previous* sheet's stale size, and the very next `updateAll()` write-back silently overwrites the just-restored `project.canvas` with that stale value |
| `app.js:2867-2891` (`drawLayout()`) — `const isPlate=currentObjectTemplate().preview.kind==='plate'; if(isPlate){drawPlateDesignTargetGuide(...)}else{drawFrontViewFrame(...); if(showSafeArea)drawSafeAreaGuide(...)}` | Plate draws its own circular/annular guide instead of the Front View Frame + rectangular safe-area guide | Sheet must NOT take the `isPlate` branch (it has no circular Design Target guide) but also must NOT draw the Front View Frame (decision 5). Needs a three-way split: `isPlate` → plate guide; `isSheet` → `if(showSafeArea)drawSafeAreaGuide(...)` only (skip `drawFrontViewFrame`); else → both, as today. `fitNotice` text (same line) also branches on `isPlate` for its help string — sheet should get its own or reuse the plate string minus the "Design Target" reference (both currently say nothing FVF-specific for plate, so the non-plate string, which mentions "Drag the amber Front View Frame," is wrong for sheet and must not be used). |
| `app.js:2990-2993` (`isPointerOnFrontViewFrame()`) — `if(currentObjectTemplate().preview.kind==='plate')return false;` | Plate can never be the target of a frame drag | Must become `if(preview.kind==='plate'\|\|preview.kind==='sheet')return false;` (or equivalent) — sheet has no Front View Frame to drag either |
| `app.js:3118-3124` (`isTextTooLongForObject()`) — `if(currentObjectTemplate().preview.kind==='plate')return false;` | A flat plate is never "too long to wrap around" — the check is circumference-only | Same fix as above: must also return `false` for sheet (a flat sheet has no circumference/wrap concept) |
| `app.js:4045` (`drawCup()`) — `preview3D.update(layout,{...objectTemplate:currentObjectTemplate(),...plateParams:project.plate,vesselParams:project.vessel})`, called unconditionally from `updateAll()` (`app.js:2847`) regardless of which workspace tab is visible | For plate, flows into `ObjectDimensions.js`'s `preview.kind==='plate'` branch (uses `plateParams`) | **Must be gated**: `computeObjectDimensionsMm()` (`src/preview3d/ObjectDimensions.js:192-244`) has no `'sheet'` branch — a `sheet` template falls into the generic vessel/cylinder branch (line 219 on), computing `bodyRadiusMm` from `canvasWidthMm` and then `preview.topWidthFactor/preview.bottomWidthFactor` — both `undefined` for a sheet template (per §A.1, sheet has no such factors) — producing `NaN` dimensions, which `ObjectGeometryBuilder.js`/`Preview3DRenderer.js` would then try to mesh. Decision 4 ("no new 3D geometry of any kind") means the correct fix is to make `drawCup()` a no-op when `currentObjectTemplate().id==='sheet'`, not to teach `ObjectDimensions.js`/`ObjectGeometryBuilder.js` a new `'sheet'` kind. |
| `app.js:5360-5361` (`#exportCup`/`#exportCombined` `.onclick`) — capture `cupCanvas` directly, or via `composeCombinedPreviewCanvas()` (which itself reads `cupCanvas`), and download the result | Not template-aware; assumes `cupCanvas` was just redrawn by `drawCup()` | **Follow-up fix (found after the `drawCup()` no-op above landed)**: since `drawCup()` no longer redraws `#cup` while sheet is active, both buttons would otherwise export a stale image of whatever template was active before, or a blank canvas on a fresh sheet project. Each handler gets a leading guard, before the existing `if(!layout)` guard: `if(currentObjectTemplate().id==='sheet'){el('status').textContent='Flat Sheet has no 3D preview to export.';return}`. Both buttons are also hidden (`style.display=isSheet?'none':'block'`) alongside the other `isSheet` toggles in `updateObjectTemplateDetail()` (next row) as a discoverability measure, not a substitute for the handler guard (either button remains reachable via keyboard/devtools/a stale DOM reference). |
| `app.js:4076` (`updateStats()`) — `const isPlate=t.preview.kind==='plate'; ... el('cupStats').innerHTML=isPlate?plateCupStatsHtml(t):cylindricalCupStatsHtml(t)` | Plate gets `plateCupStatsHtml()` | For sheet, `cylindricalCupStatsHtml()` (the `else` branch) calls `frontViewFrameGeometry()`→`frontViewFrameWidthMm()`, computing Front-View/circumference numbers that are meaningless for a flat sheet. `#cupStats` is always hidden together with the Object Preview panel (`setWorkspaceMode()`, `app.js:6346`) so this isn't user-visible while sheet is forced to 2D-only, but it is wasted/misleading computation reachable via QA tooling (`window.__project`/devtools). Needs its own `isSheet` branch, e.g. a minimal `flatSheetCupStatsHtml(t)` or blank string. |
| `app.js:5356` (`currentProductionSheetOptions()`) — `const isPlate=t.preview.kind==='plate'; const plateFields=isPlate?{...}:{}` | Plate spreads 6 extra header fields into Production Sheet options | Sheet is `isPlate===false`, so `plateFields` is already `{}` — **no change needed**. `objectType:t.displayName` will correctly read "Flat Sheet"; `productionWidthMm/HeightMm` already read `project.canvas.width/height` directly. Decision 7 (Production Sheet exports at the sheet's canvas size) is satisfied with zero code change here. |
| `app.js:6124-6166` (`updateObjectTemplateDetail()`) — `isPlate`/`isVessel` toggle `#plateFields`/`#plateColorField`/`#cupColorField`/`#wrapField`/`#vesselFields` visibility | `#wrapField` hidden only for plate (`app.js:6142`, S-112A); `#cupColorField` shown for every non-plate template including where sheet would fall by default | Needs a new `isSheet` branch: (a) `#wrapField` hidden for sheet too — decision 5 (`el('wrapField').style.display=(isPlate\|\|isSheet)?'none':'flex'`); (b) a new `#sheetFields` group (mirroring `#plateFields`/`#vesselFields`) shown only for sheet, holding the Width/Height inputs; (c) `#cupColorField` hidden for sheet too — there is no Object Preview to color (`el('cupColorField').style.display=(isPlate\|\|isSheet)?'none':'flex'`); (d) this is also where `updateWorkspaceTabAvailability()` (§A.2's `setWorkspaceMode()` row) gets called from, since this function already runs on every selection change/undo/redo/import; (e) **follow-up**: `#exportCup`/`#exportCombined` hidden for sheet too (`el('exportCup').style.display=isSheet?'none':'block'`, same for `#exportCombined`) — see the dedicated `#exportCup`/`#exportCombined` row above. |
| `app.js:6127` — `const isVessel=VESSEL_PRODUCT_IDS.includes(t.id)` | n/a | Unaffected — sheet is never a vessel id |
| `app.js:6336-6348` (`setWorkspaceMode()`) | No object-type awareness at all today — any template can enter `'dual'`/`'preview'` | **Single guard, not per-call-site patching**: every path that can force Dual or Preview besides the tabs and boot was audited — `revealDualWorkspaceForLightbox()` (`app.js:5476`, entered from the Text/Shapes/Import/Export/Production Sheet menus and others, all via `lightboxes.*.onOpen`), `setDrawMode(false)` (`app.js:6444`) restoring `workspaceModeBeforeDrawing`, and autosave recovery (`app.js:2387`, `project=validateProject(recovered.project)`) replacing `project` — which runs earlier in the file than, and so is already in effect by the time, `bootActiveView` resolution's own `setWorkspaceMode(bootActiveView,true)` call (`app.js:6379`) executes. Rather than gate each of these individually, the guard lives inside `setWorkspaceMode()` itself: when `currentObjectTemplate().id==='sheet'` and the requested `mode` is `'dual'` or `'preview'`, it resolves to `'2d'` instead. The coercion never calls `persistActiveView()`, so a saved `'dual'`/`'preview'` preference in `localStorage` survives untouched for the next non-sheet project. A new helper, `updateWorkspaceTabAvailability()`, sets `#viewTabDual`/`#viewTab3D` `.disabled` and, when sheet is active and `workspaceMode` is not `'2d'`, calls `setWorkspaceMode('2d')` — called from `updateObjectTemplateDetail()` (`app.js:6124`), which already runs on every selection change, undo/redo and import (via `renderLayerUI()`, `app.js:2859`), so no separate audit of import/undo/redo call sites is needed. |
| `app.js:6359-6361` — `el('viewTabDual').onclick=...`, `el('viewTab2D').onclick=...`, `el('viewTab3D').onclick=...` | Unconditional | Paired with the new `.disabled` toggle above — a disabled `<button>` doesn't fire `onclick`, so no change to the handlers themselves is needed, only to whatever toggles `.disabled` (`updateWorkspaceTabAvailability()`) |
| `app.js:6372-6379` (`bootActiveView` resolution) | Not template-aware | No longer a sequencing risk: `setWorkspaceMode(bootActiveView,true)` (`app.js:6379`) now runs the guard above, and by the time it executes `project` already reflects its final boot value (default or autosave-recovered, `app.js:2387` — earlier in file/execution order) |
| `app.js:4867-4877` (`#objectType` change handler) | `commitHistory(); project.product=template.id; project.wrap=template.wrap.default;` then vessel-or-plain canvas reset, then a `plate`-only `project.plate`/`cupColor` reset | Needs a `sheet`-only reset paralleling the plate block: `if(template.id==='sheet'){project.canvas=getSheetDefaults()}` (the vessel/else branch at `app.js:4872` already does `project.canvas={width:template.productionWidthMm,height:template.productionHeightMm}` for any non-vessel id, which is already correct for sheet's default 150×150 case — a dedicated branch is only needed if `getSheetDefaults()` should be the canonical source instead of duplicating `150` as `productionWidthMm/HeightMm` on the template. See §B.) Also needs to call the new tab-availability guard (previous row) so switching *into* sheet from Mug/Plate/etc. immediately disables/forces-out-of Dual/3D, and switching *out of* sheet re-enables them. |

### A.3 `index.html`

| Site | Current | Needed |
|---|---|---|
| `index.html:1019` — `<select id="objectType"><option value="mug" selected>Mug</option><option value="tumbler">Straight Tumbler</option><option value="bottle">Bottle</option><option value="plate">Round Dinner Plate</option></select>` | 4 options | Add `<option value="sheet">Flat Sheet</option>` immediately after the `plate` option (decision 1) |
| `index.html:499` (`#wrapField`'s own `<label for="wrap">` + surrounding markup) | Already conditionally hidden by `app.js:6142` for plate — the HTML itself is unconditional, JS toggles `style.display` | No HTML change; covered by the JS fix in §A.2 |
| (new) `#sheetFields` block | No precedent markup | New field group (mirrors `#plateFields`'s/`#vesselFields`'s own markup shape) with two length inputs, `#sheetWidth`/`#sheetHeight`, `min`/`max` set to 20/500 in the project's display units (matching the `setLengthField`/`readLengthField` convention every other dimension field already uses) |
| Image panel (`#imageStudioGroupSource` area, `index.html:1138-1143`) | No "switch object type" affordance exists anywhere in the app today (grepped for `Switch to`/`autoSwitch`/`switchTo` — zero hits outside an unrelated height-mode toggle button) | New, genuinely novel UI: a small action (button or inline banner) shown only while `currentObjectTemplate().id!=='sheet'`, wired in `renderImageStudio()` (`app.js:6189`) next to the existing `isPlate`-style visibility toggles it already performs for other fields |

### A.4 Exporters — verified, not touchpoints

| File | Finding |
|---|---|
| `src/export/SvgExporter.js`, `src/export/DxfExporter.js` | Grepped for `plate`/`preview.kind`/`objectTemplate`/`template.id`/`VESSEL_PRODUCT_IDS` — zero matches. Both are purely `StoneLayout` + canvas-mm consumers, already product-agnostic. Decision 7 (SVG/DXF export at the sheet's canvas size) requires **no code change**. |
| `src/export/ProductionSheetExporter.js` | Only product-aware via the `plateFields` spread `currentProductionSheetOptions()` builds (`app.js:5356`, already covered above) — the exporter itself (`computeProductionSheetLayout()`) never inspects object type, only `options.productionWidthMm/HeightMm`/`options.plateOuterDiameterMm` (gates the extra header lines via presence-check, `ProductionSheetExporter.js:173`). No exporter-side code change needed; a **test-side gap** exists (see §D). |
| PNG export (`app.js:6867`, `canvas.toDataURL('image/png')`) | Rasterizes the already-generated SVG offscreen (comment at `app.js:50`) — generic, no product branch. No change needed. |

### A.5 Monogram Generator — verified, not a touchpoint

`app.js:5687-5697` (`computeMonogramDefaultSizeMm()`) and `app.js:6143` (`updateMonogramFrameSizeBounds()`) both branch on `preview.kind==='plate'` specifically because plate has a **zero** `safeAreaInsetMm` (its printable guide is circular, not rectangular — see `ObjectTemplate.js:220`), so the generic `getSafeAreaRectMm()`-based sizing (the `else` branch) doesn't apply to it. Sheet has a real, non-zero rectangular `safeAreaInsetMm` (decision 3, 10mm all sides) — so the existing `else` branch (generic safe-area-based monogram sizing) already produces correct behavior for sheet with **no code change**.

### A.6 3D preview modules (`src/preview3d/**`) — verified, out of scope by design

`ObjectDimensions.js` and `ObjectGeometryBuilder.js` both branch on `dimensions.kind`/`preview.kind` (`ObjectDimensions.js:196`, `ObjectGeometryBuilder.js:84,88`; `Preview3DRenderer.js:376,380,495,515,548,600`). Per decision 4 ("no new 3D geometry of any kind"), none of these files should learn a `'sheet'` kind — the correct fix is the `drawCup()` guard in §A.2, which prevents `preview.kind==='sheet'` from ever reaching these modules.

### A.7 `CupRenderer.js` — dead reference

The task list's "drawCup()/preview3D" touchpoint's old sibling, `src/renderer/CupRenderer.js`, no longer exists (`ls src/renderer/` confirms; only referenced in stale comments at `app.js:56-60` describing its RS-1006 replacement by `Preview3DRenderer.js`). Not a real touchpoint.

---

## B. Schema decision

**Decision: `project.canvas` is the sole source of truth for the sheet's width/height. No new
top-level project field.**

Why this differs from Plate/Vessel's own precedent, and why it's still the right call here:

- Plate and Vessel each carry a dedicated `project.plate` / `project.vessel` object because they
  have **multiple** physical parameters that don't reduce to a flat width/height (plate: outer
  diameter, inner well diameter, overall height, center depth, foot ring outer diameter, foot ring
  height, color, design target — `PlateProductDefinition.js`; vessel: body diameter, top diameter,
  body height — `VesselProductDefinition.js`). `project.canvas` is a *derived* representation for
  both (`computeCanvasFromVessel()`, and the plate's own `project.canvas={width:outerDiameterMm,
  height:outerDiameterMm}` line at `app.js:2756`) — the real source of truth is the product-specific
  object.
- Flat Sheet has exactly two physical parameters — width and height — and per decision 2 they
  *are* the production canvas dimensions, independently editable, with no derived-vs-authored
  split of the kind vessel/plate need. There is nothing left over that a `project.sheet` object
  would hold.
- The safe-area inset (decision 3, 10mm fixed) is a **template-level constant**, exactly like every
  other template's `safeAreaInsetMm` (`ObjectTemplate.js:160,175,192`, and now the new sheet entry)
  — never a per-project editable field for any existing template, so no new project field is needed
  for it either.

One implementation detail this decision surfaces: **no existing template lets the user edit
`project.canvas.width/height` directly.** Mug/Tumbler/Bottle derive canvas from
`project.vessel` (`computeCanvasFromVessel()`); Plate derives canvas from
`project.plate.outerDiameterMm`. Flat Sheet's Width/Height fields will be the first UI in the app
that writes `project.canvas` directly. The clamp-to-[20,500] behavior should still follow the
existing small-helper-module convention (`clampPlateDimensionMm()`, `clampVesselDimensionMm()`) for
consistency and testability — a new `src/products/SheetProductDefinition.js` exporting
`SHEET_MIN_MM`/`SHEET_MAX_MM` (or a single shared range, since width and height share one range
unlike plate's per-field ranges), `getSheetDefaults()` (`{widthMm:150,heightMm:150}`), and
`clampSheetDimensionMm(value)`. This does **not** contradict "`project.canvas` is the sole source
of truth" — the new module is a pure stateless helper (like `clampPlateDimensionMm`), not a new
persisted project field.

---

## C. Backward compatibility (measured)

`validateProject()` was extracted from `app.js` at this tip via `new Function(...)`, following the
exact precedent `tools/test-project-validation-security.mjs` already establishes (regex-extract
`validateProject()`+`defaultProject()`+their shared constants, inject the real
`src/products/index.js` functions as parameters). Run against a project JSON with
`product:'sheet'`, one image layer, and three canvas sizes (150×150 — the spec default; 20×20 — the
spec min; 500×500 — the spec max) — **all at this exact commit, before any RS-3037 code exists**:

```
=== 150x150 (spec default) ===
INPUT product: sheet canvas: {"width":150,"height":150}
THREW: no
resolved product: mug
resolved canvas: {"width":150,"height":150}
resolved vessel: {"bodyDiameterMm":47.7464829275686,"topDiameterMm":57.7399328426411,"bodyHeightMm":160,"printableHeightMm":150}
resolved plate: {"outerDiameterMm":270,"innerWellDiameterMm":195,"overallHeightMm":25,"centerDepthMm":12,"footRingOuterDiameterMm":165,"footRingHeightMm":5,"colorId":"white","designTarget":"centerWell"}

=== 20x20 (spec min) ===
INPUT product: sheet canvas: {"width":20,"height":20}
THREW: no
resolved product: mug
resolved canvas: {"width":20,"height":20}
resolved vessel: {"bodyDiameterMm":6.366197723675814,"topDiameterMm":7.698657712352148,"bodyHeightMm":30,"printableHeightMm":20}
resolved plate: {"outerDiameterMm":270,"innerWellDiameterMm":195,"overallHeightMm":25,"centerDepthMm":12,"footRingOuterDiameterMm":165,"footRingHeightMm":5,"colorId":"white","designTarget":"centerWell"}

=== 500x500 (spec max) ===
INPUT product: sheet canvas: {"width":500,"height":500}
THREW: no
resolved product: mug
resolved canvas: {"width":500,"height":500}
resolved vessel: {"bodyDiameterMm":159.15494309189535,"topDiameterMm":192.4664428088037,"bodyHeightMm":510,"printableHeightMm":500}
resolved plate: {"outerDiameterMm":270,"innerWellDiameterMm":195,"overallHeightMm":25,"centerDepthMm":12,"footRingOuterDiameterMm":165,"footRingHeightMm":5,"colorId":"white","designTarget":"centerWell"}
```

**Reading this literally**: nothing throws in any case. `product:'sheet'` is an unrecognized id at
this tip, so `getObjectTemplate('sheet')` falls back to its documented permissive default
(`DEFAULT_OBJECT_TEMPLATE_ID`, i.e. `'mug'` — `ObjectTemplate.js:245-247`) exactly the same way it
already does for any other unknown/legacy id. `project.canvas.width/height` pass through
**unmodified** in every case — `validateProject()` itself only asserts `canvas.width/height>0`
(`app.js:1112-1113`); there is no upper clamp at this layer for any template (the 20/500mm clamp is
a UI-field-level concern belonging to `writeSelectedControlsToLayer()`/`clampSheetDimensionMm()`,
not `validateProject()`). `project.vessel` gets populated via `deriveLegacyVesselParams('mug', ...)`
reverse-engineering plausible-if-odd mug body ratios from the sheet's own square canvas size — inert
data, never read by anything while `product` resolves to `'mug'`. `project.plate` gets the plain
JSON defaults (unused for a mug).

**This is exactly what "an older app version does with a Flat Sheet file" today**: it silently
reinterprets it as a Mug with the Flat Sheet's own canvas dimensions carried over verbatim (so no
data is lost or thrown away — reopening the same file *after* RS-3037 ships, with `'sheet'` now a
recognized id, recovers `product:'sheet'` correctly, since the raw `canvas.width/height` were never
mutated by the old app unless the user actively edited and re-saved the file while it was
misread as a Mug). No crash, no schema violation, consistent with decision 8's requirement that
pre-milestone projects round-trip unaffected (trivially true here since no pre-milestone project
can contain `product:'sheet'` in the first place — this measurement instead documents forward
behavior: an old app opening a *new*, sheet-authored file degrades gracefully rather than
throwing).

Script used for this measurement was ad hoc and not committed.

---

## D. Test impact (as implemented)

Grepped `tools/*.mjs` for `setWorkspaceMode`, `updateObjectTemplateDetail`, `drawCup`,
`syncSelectedControlsFromLayer`, `refreshAllLengthFieldDisplays`, `isPointerOnFrontViewFrame`,
`isTextTooLongForObject`, `updateStats`, `PREVIEW_KINDS`, `OBJECT_TEMPLATE_IDS`, and `objectType` —
every `tools/*.mjs` file that extracts one of these functions into a `new Function` sandbox and
would break on an undefined `currentObjectTemplate`/`isFlatObjectTemplate`, or that hardcodes a
plate-only literal now made a three-way (plate/sheet/other) or four-way (add sheet) match, needed a
fix. Fixes went to the test's sandbox stubs or stale literal-match assertions, never to production
code.

| File | What changed |
|---|---|
| `tools/test-object-template.mjs` (test 1) — the sorted-id list and count | `['bottle','mug','plate','tumbler']`/`4` → `['bottle','mug','plate','sheet','tumbler']`/`5`. |
| `tools/test-object-template.mjs` (test 4) — the hardcoded `preview.kind` allow-list | Gained `'sheet'`. |
| `tools/test-product-plate-round-dinner.mjs` (tests 20, 22, 23, 25) | Four assertions matched literal source text that legitimately changed shape when plate-only gates were extended to also cover sheet: `el('cupColorField').style.display=isPlate?...` → `(isPlate\|\|isSheet)?...`; `el('wrapField').style.display=isPlate?...` → same; `drawLayout()`'s `if(isPlate){...}else{drawFrontViewFrame(...)}` → a three-way `if(isPlate){...}else if(isSheet){...}else{drawFrontViewFrame(...)}`; `isPointerOnFrontViewFrame()`/`isTextTooLongForObject()`'s `if(currentObjectTemplate().preview.kind==='plate')return false;` → `if(isFlatObjectTemplate(currentObjectTemplate()))return false;` (the new shared predicate). All four updated to match the new (still plate-covering) source; no behavior assertion was weakened. |
| `tools/test-rs-3025-length-field-mm-stash.mjs` — `buildSandbox()`'s `new Function` factory | `refreshAllLengthFieldDisplays()` now references `currentObjectTemplate()` (the new sheet-resync branch) but that name wasn't a sandbox parameter — every scenario in this file would have thrown `ReferenceError: currentObjectTemplate is not defined`. Fixed by injecting a minimal stub (`() => ({ id: project.product || 'mug' })`) that never resolves to `'sheet'`, since none of this file's scenarios concern Flat Sheet. |
| `tools/test-object-template-integration.mjs`, `tools/test-production-sheet-exporter.mjs`, `tools/test-ui-shell-structure.mjs` | Verified, unaffected — no edits needed. `test-object-template-integration.mjs`'s `OBJECT_TEMPLATE_IDS`-driven loops (byte-identical-StoneLayout, product/canvas/wrap round-trip) automatically cover `'sheet'` once registered. `test-production-sheet-exporter.mjs`'s test 16 loop treats `'sheet'` as a non-plate id (must fit A4/Letter/A3 without throwing) — true at its 150×150 default. `test-ui-shell-structure.mjs`'s view-tab assertions check static source/markup, unaffected by the new dynamic `.disabled` toggle. |
| `tools/test-alignment-snapping-wiring.mjs`, `tools/test-auto-fit-default-toggle-warning.mjs`, `tools/test-autosave-recovery-wiring.mjs`, `tools/test-crystal-color-integration.mjs`, `tools/test-fill-algorithms-integration.mjs`, `tools/test-lightbox-movable-persistent.mjs`, `tools/test-mono-006-monogram-ui.mjs`, `tools/test-path-boolean-integration.mjs`, `tools/test-rs2012-text-gap-mixed-size-ux.mjs`, `tools/test-render-export-pipeline.mjs`, `tools/test-s200-app-integration.mjs`, `tools/test-shape-library-integration.mjs`, `tools/test-text-position-workflow.mjs`, `tools/test-variable-stone-sizes.mjs`, `tools/test-product-vessel-dimensions.mjs`, `tools/test-export-combined-preview-png.mjs`, `tools/test-gallery.mjs`, `tools/test-move-drag-fast-path-wiring.mjs`, `tools/test-architecture-module-boundaries.mjs` | Grepped and re-run; either they only run static regex/substring checks against the changed source (unaffected by the literal-text drift) or they inject `updateObjectTemplateDetail`/`drawCup`/etc. as opaque stub functions (`() => {}`) rather than extracting the real body — no sandbox gap. All pass unmodified. |
| `tools/rs-3011-step4-flash-check.mjs`, `tools/rs-3011-step4-flash-check-heavy.mjs`, `tools/rs-3011-step4-verify.mjs` | Playwright browser scripts (not `test-*.mjs`), exercise the view tabs only against the default-boot project, which stays Mug (decision 8). Unaffected. |
| `tools/test-rs-3037-flat-sheet.mjs` (new) | Items 1–13, see §E.2. Registered in `tools/test-groups.mjs`'s `core`, `products`, and `fast` groups (the same groups `test-object-template.mjs` belongs to). |

---

## E. Implementation plan

### E.1 Ordered implementation steps

1. **`src/products/SheetProductDefinition.js`** (new) — `SHEET_MIN_MM=20`, `SHEET_MAX_MM=500`,
   `getSheetDefaults()` (`{widthMm:150,heightMm:150}`), `clampSheetDimensionMm(value)`. Mirrors
   `PlateProductDefinition.js`'s pure-data-and-validation shape, scaled down to what sheet actually
   needs (one shared range instead of six per-field ranges — no `definitions/*.js` JSON-like file
   needed, since there's no rich per-field metadata to keep "verbatim" the way plate's approved
   product spec requires).
2. **`src/products/ObjectTemplate.js`** — add `'sheet'` to `PREVIEW_KINDS` (line 23); extend the
   `preview.kind !== 'plate'` exemption at line 111 to `preview.kind !== 'plate' && preview.kind !==
   'sheet'`; add the `sheet` entry to `TEMPLATE_DEFINITIONS` (after `plate`, per decision 1's picker
   order — registration order and picker order should match for consistency even though nothing
   technically requires it).
3. **`src/products/index.js`** — export `getSheetDefaults`/`clampSheetDimensionMm`
   (and `SHEET_MIN_MM`/`SHEET_MAX_MM` if the UI needs them directly for `min`/`max` HTML attributes)
   from the new module, following the existing plate/vessel export-grouping convention (§A, barrel
   read in full).
4. **`index.html`** — add the `<option value="sheet">Flat Sheet</option>` after `plate`
   (`index.html:1019`); add a `#sheetFields` field group (`#sheetWidth`/`#sheetHeight` length
   inputs) mirroring `#plateFields`/`#vesselFields`'s markup shape; add the Image panel's
   "Switch to Flat Sheet" action markup.
5. **`app.js` — data/state layer**:
   - `#objectType` change handler (`app.js:4867-4877`): the existing non-vessel `else` branch at
     line 4872 already sets `project.canvas` from `template.productionWidthMm/HeightMm`, which is
     already correct for sheet's default — decide whether to leave that as-is or add an explicit
     `if(template.id==='sheet'){project.canvas=getSheetDefaults()}` for symmetry with the plate
     branch immediately below it (recommended, for the same "don't duplicate the 150 default in two
     places" reasoning plate/vessel already follow).
   - `writeSelectedControlsToLayer()` (`app.js:2754-2758`): new `sheet` branch writing
     `project.canvas` directly from `#sheetWidth`/`#sheetHeight` via `clampSheetDimensionMm()`.
   - `syncSelectedControlsFromLayer()` (`app.js:2530`) and `refreshAllLengthFieldDisplays()`
     (`app.js:7108`, the units-change path): both need a new `sheet`-only branch filling
     `#sheetWidth`/`#sheetHeight` from `project.canvas` via `setLengthField()`, gated on
     `currentObjectTemplate().id==='sheet'` — without it, undo/redo, Project JSON import, and
     autosave recovery all restore `project.canvas` correctly but leave the DOM fields stale, and
     the next `updateAll()` write-back (§A.2's new row above) silently clobbers the just-restored
     value.
   - `validateProject()`: no change needed (§C already shows it degrades correctly both before and
     after `'sheet'` is a recognized id — `getObjectTemplate()`'s own permissive fallback handles
     it automatically once registered in step 2).
6. **`app.js` — 2D canvas / guides**:
   - `drawLayout()` (`app.js:2889-2891`): three-way split — `isPlate` → plate guide;
     `isSheet` → safe-area guide only, no Front View Frame; else → both (current behavior).
   - `isPointerOnFrontViewFrame()` (`app.js:2990-2993`) and `isTextTooLongForObject()`
     (`app.js:3118-3124`): extend the plate-only early-return to also cover sheet. Consider a small
     shared predicate (e.g. `isFlatObjectTemplate(template)` returning true for `plate`/`sheet`) to
     avoid the same `kind==='plate'||kind==='sheet'` check drifting out of sync across 3+ call
     sites — matches this codebase's existing preference for one shared gate over duplicated
     conditions (e.g. `isAuthoredStoneFontId()`'s own "one shared predicate" precedent,
     `app.js:1214-1219`).
7. **`app.js` — 3D preview gating**:
   - `drawCup()` (`app.js:4045`): early-return (no `preview3D.update()` call) when
     `currentObjectTemplate().id==='sheet'`.
   - `setWorkspaceMode()` (`app.js:6337`): the single guard — when `currentObjectTemplate().id===
     'sheet'` and the requested `mode` is `'dual'` or `'preview'`, resolve it to `'2d'` instead,
     before any of the function's existing DOM-toggle logic runs. This one change point covers
     every path that can request Dual/Preview (the two tab clicks, `revealDualWorkspaceForLightbox()`,
     `setDrawMode(false)`, and the boot-time `bootActiveView` resolution call) without auditing or
     patching each call site individually — see §A.2's rewritten `setWorkspaceMode()` row for why no
     import/undo/redo audit is needed either. The coercion must not call `persistActiveView()`.
   - New helper `updateWorkspaceTabAvailability()`: sets `#viewTabDual`/`#viewTab3D` `.disabled`
     to match whether sheet is active, and — while sheet is active and `workspaceMode!=='2d'` —
     calls `setWorkspaceMode('2d')`. Called from `updateObjectTemplateDetail()` (`app.js:6124`),
     which already runs on every selection change, undo/redo and import via `renderLayerUI()`
     (`app.js:2859`) — no separate wiring needed for those paths.
8. **`app.js` — remaining display-only sites**: `updateObjectTemplateDetail()`
   (`app.js:6124-6166`, `#wrapField`/`#sheetFields`/`#cupColorField` visibility, and the new
   `updateWorkspaceTabAvailability()` call) and `updateStats()` (`app.js:4076`, sheet-appropriate
   `#cupStats` content or blank).
9. **Image panel switch action**: wire the new button's `onclick` in `renderImageStudio()`
   (`app.js:6189`) to reuse the `#objectType` change handler's own logic (dispatch a real `change`
   event on `#objectType` after setting its value, rather than duplicating the reset logic — matches
   this codebase's stated preference for reuse over duplication). The button's own visibility
   (shown only while `currentObjectTemplate().id!=='sheet'`) must be refreshed from both
   `updateObjectTemplateDetail()` and `renderImageStudio()` itself, so it disappears immediately
   after switching regardless of which one runs next: the two functions are also called
   independently of each other — `updateObjectTemplateDetail()` from the Shapes Lightbox's own
   `onOpen` (`app.js:5430`), `renderImageStudio()` from the Image Trace Lightbox's own `onOpen`
   (`app.js:5432`) — so refreshing the toggle in only one would leave it stale whenever the other
   path is what actually re-renders next.
10. **`tools/test-groups.mjs`**: add the new test file to whichever group(s) list image/object-type
    tests together, following the `IMG-011`/`test-img-011-import-defaults.mjs` precedent (opt-in
    curated grouping — `npm test` auto-discovers the file regardless, per this repo's
    `test-*.mjs` convention).
11. Update the pre-existing test files identified in §D (`test-object-template.mjs`'s two
    hardcoded id/kind lists; `test-product-plate-round-dinner.mjs`'s four stale plate-only literal
    matches; `test-rs-3025-length-field-mm-stash.mjs`'s sandbox stub) — and verify, not necessarily
    edit, every other file the §D grep turned up.
12. Write `tools/test-rs-3037-flat-sheet.mjs` (see §E.2).

### E.2 Test plan for `tools/test-rs-3037-flat-sheet.mjs` (as implemented)

Items 1–4 exercise `src/products/index.js` directly. Items 5–14 extract and **really execute** the
real `app.js` source via `new Function` (app.js is a browser entry point, not `import()`-able
directly under plain Node), matching this repo's established convention (see e.g.
`tools/test-object-template-integration.mjs`, `tools/test-rs-3025-length-field-mm-stash.mjs`,
`tools/test-ui-import-autoswitch-regression.mjs`). Items 6, 7, 8, 9, 12, and 14 were mutation-tested:
each item's matching production code was deliberately broken, the file was re-run to confirm that
exact item (and only that item) failed, then the mutation was reverted and `git diff` reconfirmed
clean.

1. `OBJECT_TEMPLATE_IDS` contains `'sheet'`; `listObjectTemplates().length===5`;
   `getObjectTemplate('sheet').displayName==='Flat Sheet'`.
2. Sheet template: `productionWidthMm`/`productionHeightMm` are `150`, `safeAreaInsetMm` is
   `{top:10,right:10,bottom:10,left:10}`, `wrap.default==='full'`, `preview.kind==='sheet'`.
3. `getSafeAreaRectMm(getObjectTemplate('sheet'), 150, 150)` is `130` × `130`.
4. `clampSheetDimensionMm()`: `5`→`20`, `900`→`500`, `180`→`180` (unchanged), `NaN`→`150`.
5. **Behavioral, through the real extracted `validateProject()`** (same extraction as
   `tools/test-object-template-integration.mjs`): a project JSON with `product:'sheet'` resolves to
   `'sheet'` (not `'mug'`) at canvas `150×150`/`20×20`/`500×500`, with `canvas` passed through
   unmodified in every case (no clamp at this layer — the 20–500 clamp is a UI-layer concern, per
   §B); a `product:'mug'` project resolves exactly as before.
6. **Behavioral, through the real extracted `#objectType` change handler**: switching mug→sheet
   gives `product==='sheet'`, `canvas===150×150`, `wrap==='full'`; switching sheet→mug gives the
   mug's vessel-derived canvas (`257.610597594363×85`).
7. **Behavioral, sync-then-write round trip**: the real extracted sheet branches of
   `syncSelectedControlsFromLayer()`/`refreshAllLengthFieldDisplays()` (resync) and
   `writeSelectedControlsToLayer()` (write-back), plus the real extracted `setLengthField()`/
   `readLengthField()` choke points — `product:'sheet'`, `canvas:300×180` survives resync then
   write-back unchanged.
8. **Behavioral, through the real extracted `setWorkspaceMode()`/`updateWorkspaceTabAvailability()`**:
   `mode:'dual'` under a sheet template resolves to `'2d'` (under mug it stays `'dual'`);
   `updateWorkspaceTabAvailability()` disables `#viewTabDual`/`#viewTab3D` for sheet, re-enables them
   for mug, forces the workspace back to `'2d'` when sheet becomes active mid-session, and never
   calls `updateAll()` synchronously (the redraw is deferred via `requestAnimationFrame()` — this
   function runs *inside* `updateAll()` via `renderLayerUI()`, so a synchronous call would recurse).
   `persistActiveView` is deliberately not injected into the sandbox at all: any reference to it
   inside `setWorkspaceMode()`'s coercion would throw a `ReferenceError`, itself proof the coercion
   never calls it.
9. **Behavioral, through the real extracted `drawCup()`**: no `preview3D.update()` call for sheet;
   does call it for mug and plate.
10. **Behavioral, through the real extracted `isPointerOnFrontViewFrame()`/
    `isTextTooLongForObject()`/`isFlatObjectTemplate()`**: both return `false` for sheet, and never
    reach the frame/circumference geometry helpers they'd otherwise call (those helpers are injected
    as throw-if-called spies).
11. **Behavioral, guide-selection snippet from `drawLayout()`**: rather than extracting the whole
    function (which draws stones/HUD text/canvas state unrelated to guide selection), only the
    guide-selection statement itself (`const isPlate=...;const isSheet=...;if(isPlate){...}else
    if(isSheet){...}else{...}`) is extracted and run with the three guide-drawing functions replaced
    by spies: for sheet, `drawSafeAreaGuide()` is called (gated on `showSafeArea`, exactly like every
    cylindrical template) and neither `drawFrontViewFrame()` nor `drawPlateDesignTargetGuide()` is;
    plate and mug are asserted unaffected as a sanity check.
12. **Production Sheet, measured literal boundary**: a real `computeProductionSheetLayout()` call
    with an 8-colour (jet/siam/light-siam/rose/fuchsia/amethyst/sapphire/light-sapphire) × 3-size
    (2/2.8/3.4mm) `StoneLayout`, mirror and registration marks on, `marginMm:10`, `gapMm:[0.1]`: a
    150×150 sheet fits both A4 and Letter without throwing; a 158×158 sheet still fits A4 but throws
    a `RangeError` on Letter (this is the real, measured boundary — not 176; 158×158 fits A4 up to
    175×175 but Letter's shorter 279.4mm edge is exhausted first).
13. The Image panel's "Switch to Flat Sheet" button: its real extracted `onclick` handler, run
    against a fake `#objectType` element with a real `addEventListener`/`dispatchEvent`, fires a
    genuine `change` event with `value==='sheet'` (not a hand-simulated one); its `style.display`
    toggle in both `updateObjectTemplateDetail()` and `renderImageStudio()` is `'none'` while sheet
    is active, `'inline-block'` otherwise.
14. **Follow-up: `#exportCup`/`#exportCombined` no-op on sheet.** `drawCup()`'s no-op for sheet
    (item 9) leaves `cupCanvas` stale/blank, so its two consumers must refuse to export it: the real
    extracted `onclick` handlers for both buttons, run with a spy `exportCanvas()`, never call it and
    set `#status` to `'Flat Sheet has no 3D preview to export.'` under sheet, but still call it
    exactly once under mug. Also asserts both buttons' `style.display` toggle (`'none'` for sheet,
    `'block'` otherwise) in `updateObjectTemplateDetail()`.

---

## Open conflicts

None found. Every product decision (1–8) is implementable against the current architecture without
contradicting an existing invariant:

- Decision 4 ("no 3D preview... no new 3D geometry") is fully achievable by gating `drawCup()`
  before it reaches `ObjectDimensions.js`/`ObjectGeometryBuilder.js` — no change to any
  `src/preview3d/**` file's own `kind` branching is required (§A.6).
- Decision 8 ("every project saved before this milestone loads and regenerates byte-identically")
  is already true by construction: no pre-milestone project can contain `product:'sheet'`, and §C's
  measurement confirms `validateProject()`'s existing permissive-fallback behavior for *any*
  unrecognized `product` value is untouched by this milestone (registering `'sheet'` only changes
  the resolution of that one specific string; every other id's resolution, and the untouched-canvas
  behavior, stays exactly as measured).
- Decision 2's independent, directly-editable width/height is a genuinely new UI pattern (§B) but
  does not conflict with `project.canvas`'s existing role as the one geometry-facing canvas
  size — it's additive, not a redefinition.
