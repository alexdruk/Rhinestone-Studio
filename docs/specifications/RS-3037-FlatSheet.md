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
2. Default canvas 220×220mm. Width and height are each independently editable, clamped to
   20–500mm, in the project's display units.
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
| `ObjectTemplate.js:206-226` — the plate `TEMPLATE_DEFINITIONS` entry (`id:'plate'`, `productionWidthMm/HeightMm: getPlateDefaults().outerDiameterMm`, `safeAreaInsetMm: {0,0,0,0}`, `wrap:{supported:WRAP_MODES, default:'full'}`, `preview:{kind:'plate', hasHandle:false}`) | Plate's production size comes from `PlateProductDefinition.js`'s own default; safe area is zero (guide is drawn separately, circular) | New entry: `id:'sheet'`, `displayName:'Flat Sheet'`, `productionWidthMm:220`, `productionHeightMm:220` (or sourced from a new `getSheetDefaults()`, see §B), `safeAreaInsetMm:{top:10,right:10,bottom:10,left:10}`, `wrap:{supported:WRAP_MODES, default:'front'}` (wrap object is still schema-mandatory even though the UI hides it — same as plate, which carries `default:'full'` unused by any sheet-relevant code), `preview:{kind:'sheet', hasHandle:false}` |
| `ObjectTemplate.js:229-233` — `OBJECT_TEMPLATE_IDS` derived from `TEMPLATE_DEFINITIONS` | 4 ids | Becomes 5 ids: `['mug','tumbler','bottle','plate','sheet']` (registration order; sorted order used by tests is `['bottle','mug','plate','sheet','tumbler']`) |

### A.2 `app.js` — every `preview.kind==='plate'` / `template.id==='plate'` / `VESSEL_PRODUCT_IDS` branch

| Site | Current behavior for `plate` | What `sheet` must do |
|---|---|---|
| `app.js:1193` (`validateProject()`) — `const vessel=VESSEL_PRODUCT_IDS.includes(productId) ? ... : ...` | `plate` falls into the `:` branch (not a vessel) | `sheet` also falls into the `:` branch unchanged — no code change needed here, `VESSEL_PRODUCT_IDS` never needs `'sheet'` added |
| `app.js:2597` — `enteringRimBand=currentObjectTemplate().preview.kind==='plate'&&...` (Rim Band intelligent default, S-112A) | Plate-only, drives curve-control pre-fill when Design Target becomes `rimBand` | No-op for sheet — sheet has no Design Target concept at all. No change needed (condition stays `==='plate'`, never true for sheet). |
| `app.js:2754-2758` (`writeSelectedControlsToLayer()`) — `if(currentObjectTemplate().preview.kind==='plate'){ project.plate=normalizePlateParams(...); project.canvas={width:...,height:...}; project.cupColor=...}` | Reads `#plateOuterDiameter` etc., writes `project.plate` + syncs `project.canvas` to the (square) outer diameter | New sibling branch: `if(currentObjectTemplate().id==='sheet'){ project.canvas={width:clampSheetDimensionMm(readLengthField('sheetWidth')), height:clampSheetDimensionMm(readLengthField('sheetHeight'))} }` — writes `project.canvas` directly (see §B), no `project.plate`/`project.cupColor` touch needed |
| `app.js:2765-2769` — `if(VESSEL_PRODUCT_IDS.includes(currentObjectTemplate().id)){...}` | Not entered for plate | Not entered for sheet either (`sheet` never joins `VESSEL_PRODUCT_IDS`) — no change |
| `app.js:2867-2891` (`drawLayout()`) — `const isPlate=currentObjectTemplate().preview.kind==='plate'; if(isPlate){drawPlateDesignTargetGuide(...)}else{drawFrontViewFrame(...); if(showSafeArea)drawSafeAreaGuide(...)}` | Plate draws its own circular/annular guide instead of the Front View Frame + rectangular safe-area guide | Sheet must NOT take the `isPlate` branch (it has no circular Design Target guide) but also must NOT draw the Front View Frame (decision 5). Needs a three-way split: `isPlate` → plate guide; `isSheet` → `if(showSafeArea)drawSafeAreaGuide(...)` only (skip `drawFrontViewFrame`); else → both, as today. `fitNotice` text (same line) also branches on `isPlate` for its help string — sheet should get its own or reuse the plate string minus the "Design Target" reference (both currently say nothing FVF-specific for plate, so the non-plate string, which mentions "Drag the amber Front View Frame," is wrong for sheet and must not be used). |
| `app.js:2990-2993` (`isPointerOnFrontViewFrame()`) — `if(currentObjectTemplate().preview.kind==='plate')return false;` | Plate can never be the target of a frame drag | Must become `if(preview.kind==='plate'\|\|preview.kind==='sheet')return false;` (or equivalent) — sheet has no Front View Frame to drag either |
| `app.js:3118-3124` (`isTextTooLongForObject()`) — `if(currentObjectTemplate().preview.kind==='plate')return false;` | A flat plate is never "too long to wrap around" — the check is circumference-only | Same fix as above: must also return `false` for sheet (a flat sheet has no circumference/wrap concept) |
| `app.js:4045` (`drawCup()`) — `preview3D.update(layout,{...objectTemplate:currentObjectTemplate(),...plateParams:project.plate,vesselParams:project.vessel})`, called unconditionally from `updateAll()` (`app.js:2847`) regardless of which workspace tab is visible | For plate, flows into `ObjectDimensions.js`'s `preview.kind==='plate'` branch (uses `plateParams`) | **Must be gated**: `computeObjectDimensionsMm()` (`src/preview3d/ObjectDimensions.js:192-244`) has no `'sheet'` branch — a `sheet` template falls into the generic vessel/cylinder branch (line 219 on), computing `bodyRadiusMm` from `canvasWidthMm` and then `preview.topWidthFactor/preview.bottomWidthFactor` — both `undefined` for a sheet template (per §A.1, sheet has no such factors) — producing `NaN` dimensions, which `ObjectGeometryBuilder.js`/`Preview3DRenderer.js` would then try to mesh. Decision 4 ("no new 3D geometry of any kind") means the correct fix is to make `drawCup()` a no-op when `currentObjectTemplate().id==='sheet'`, not to teach `ObjectDimensions.js`/`ObjectGeometryBuilder.js` a new `'sheet'` kind. |
| `app.js:4076` (`updateStats()`) — `const isPlate=t.preview.kind==='plate'; ... el('cupStats').innerHTML=isPlate?plateCupStatsHtml(t):cylindricalCupStatsHtml(t)` | Plate gets `plateCupStatsHtml()` | For sheet, `cylindricalCupStatsHtml()` (the `else` branch) calls `frontViewFrameGeometry()`→`frontViewFrameWidthMm()`, computing Front-View/circumference numbers that are meaningless for a flat sheet. `#cupStats` is always hidden together with the Object Preview panel (`setWorkspaceMode()`, `app.js:6346`) so this isn't user-visible while sheet is forced to 2D-only, but it is wasted/misleading computation reachable via QA tooling (`window.__project`/devtools). Needs its own `isSheet` branch, e.g. a minimal `flatSheetCupStatsHtml(t)` or blank string. |
| `app.js:5356` (`currentProductionSheetOptions()`) — `const isPlate=t.preview.kind==='plate'; const plateFields=isPlate?{...}:{}` | Plate spreads 6 extra header fields into Production Sheet options | Sheet is `isPlate===false`, so `plateFields` is already `{}` — **no change needed**. `objectType:t.displayName` will correctly read "Flat Sheet"; `productionWidthMm/HeightMm` already read `project.canvas.width/height` directly. Decision 7 (Production Sheet exports at the sheet's canvas size) is satisfied with zero code change here. |
| `app.js:6124-6166` (`updateObjectTemplateDetail()`) — `isPlate`/`isVessel` toggle `#plateFields`/`#plateColorField`/`#cupColorField`/`#wrapField`/`#vesselFields` visibility | `#wrapField` hidden only for plate (`app.js:6142`, S-112A); `#cupColorField` shown for every non-plate template including where sheet would fall by default | Needs a new `isSheet` branch: (a) `#wrapField` hidden for sheet too — decision 5 (`el('wrapField').style.display=(isPlate\|\|isSheet)?'none':'flex'`); (b) a new `#sheetFields` group (mirroring `#plateFields`/`#vesselFields`) shown only for sheet, holding the Width/Height inputs; (c) `#cupColorField`'s current `isPlate?'none':'flex'` condition should probably also hide for sheet, since there is no Object Preview to color — not strictly required by any stated decision but follows directly from decision 4 (no 3D preview at all makes `cupColor` inert for sheet, same reasoning as plate's own swap to `plateColorField`). Flagged for the implementer's judgment, not a hard requirement. |
| `app.js:6127` — `const isVessel=VESSEL_PRODUCT_IDS.includes(t.id)` | n/a | Unaffected — sheet is never a vessel id |
| `app.js:6336-6348` (`setWorkspaceMode()`) | No object-type awareness at all today — any template can enter `'dual'`/`'preview'` | **New requirement, no precedent**: needs a guard so `mode` can never resolve to `'dual'`/`'preview'` while sheet is active. Two entry points must both be covered: (1) the three tab `onclick` handlers (`app.js:6359-6361`) — simplest fix is disabling `#viewTabDual`/`#viewTab3D` (real `<button>` elements, see `index.html:465-467` — `.disabled=true` natively blocks their `onclick`) whenever sheet is active; (2) `bootActiveView` resolution (`app.js:6372-6379`) — a project saved while a *different* template was active with `activeView==='dual'`/`'preview'` in `localStorage`, then reopened as (or switched to) a Flat Sheet project, must still force `2d`. |
| `app.js:6359-6361` — `el('viewTabDual').onclick=...`, `el('viewTab2D').onclick=...`, `el('viewTab3D').onclick=...` | Unconditional | Should be paired with the new `.disabled` toggle above — a disabled `<button>` doesn't fire `onclick`, so no change to the handlers themselves is strictly required, only to whatever toggles `.disabled` (new function, called from the `#objectType` change handler and from boot) |
| `app.js:6372-6379` (`bootActiveView` resolution) | Not template-aware | Must also collapse `'dual'`/`'preview'` to `'2d'` when the *loaded* project's `product==='sheet'` (this runs before `project` exists as `defaultProject()`/an imported project in today's boot order — needs sequencing care during implementation, since `bootActiveView` is resolved before `project` is constructed at `app.js:6377-6379` but `project` exists earlier for the default-boot case; verify order during implementation, this is a sequencing risk, not a design conflict) |
| `app.js:4867-4877` (`#objectType` change handler) | `commitHistory(); project.product=template.id; project.wrap=template.wrap.default;` then vessel-or-plain canvas reset, then a `plate`-only `project.plate`/`cupColor` reset | Needs a `sheet`-only reset paralleling the plate block: `if(template.id==='sheet'){project.canvas=getSheetDefaults()}` (the vessel/else branch at `app.js:4872` already does `project.canvas={width:template.productionWidthMm,height:template.productionHeightMm}` for any non-vessel id, which is already correct for sheet's default 220×220 case — a dedicated branch is only needed if `getSheetDefaults()` should be the canonical source instead of duplicating `220` as `productionWidthMm/HeightMm` on the template. See §B.) Also needs to call the new tab-availability guard (previous row) so switching *into* sheet from Mug/Plate/etc. immediately disables/forces-out-of Dual/3D, and switching *out of* sheet re-enables them. |

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
unlike plate's per-field ranges), `getSheetDefaults()` (`{widthMm:220,heightMm:220}`), and
`clampSheetDimensionMm(value)`. This does **not** contradict "`project.canvas` is the sole source
of truth" — the new module is a pure stateless helper (like `clampPlateDimensionMm`), not a new
persisted project field.

---

## C. Backward compatibility (measured)

`validateProject()` was extracted from `app.js` at this tip via `new Function(...)`, following the
exact precedent `tools/test-project-validation-security.mjs` already establishes (regex-extract
`validateProject()`+`defaultProject()`+their shared constants, inject the real
`src/products/index.js` functions as parameters). Run against a project JSON with
`product:'sheet'`, one image layer, and three canvas sizes (220×220 — the spec default; 20×20 — the
spec min; 500×500 — the spec max) — **all at this exact commit, before any RS-3037 code exists**:

```
=== 220x220 (spec default) ===
INPUT product: sheet canvas: {"width":220,"height":220}
THREW: no
resolved product: mug
resolved canvas: {"width":220,"height":220}
resolved vessel: {"bodyDiameterMm":70.02817496043394,"topDiameterMm":84.68523483587362,"bodyHeightMm":230,"printableHeightMm":220}
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

Script used for this measurement (not committed; ad hoc, run from the scratchpad):
`/private/tmp/claude-501/-Users-alex-Documents-rhinestone-studio/fb77f161-6fe4-425a-869c-43cf84b384c9/scratchpad/rs3037-taskc.mjs`.

---

## D. Test impact

Grepped `tools/*.mjs` for `OBJECT_TEMPLATE_IDS`, `listObjectTemplates`, `PREVIEW_KINDS`,
`#objectType` options, and `viewTabDual`/`viewTab2D`/`viewTab3D` — 8 files matched.

| File | What changes |
|---|---|
| `tools/test-object-template.mjs:44-45` — `assert.deepEqual([...OBJECT_TEMPLATE_IDS].sort(), ['bottle','mug','plate','tumbler']); assert.equal(listObjectTemplates().length, 4);` | Must become `['bottle','mug','plate','sheet','tumbler']` and length `5` |
| `tools/test-object-template.mjs:65` — `assert.ok(['mug','tumbler','bottle','plate'].includes(t.preview.kind), ...)` (inside the "every template has a valid `preview.kind`" loop, test 4) | Hardcoded array must gain `'sheet'` |
| `tools/test-object-template-integration.mjs:115-119` (test 1, "index.html exposes `#objectType` with mug/tumbler/bottle options") | Only asserts those three values are *present* (`for (const value of ['mug','tumbler','bottle'])`), never that the option list is exhaustive — **not broken** by adding a 4th/5th option. No required change, though the test's own name/comment is now slightly stale (pre-existing staleness, since it already doesn't mention `plate` either — not introduced by this milestone). |
| `tools/test-object-template-integration.mjs:264-276` (test 15, "the merged StoneLayout ... is identical across all three object templates") | Loops `for (const id of OBJECT_TEMPLATE_IDS)` — will automatically include `'sheet'` once registered, asserting generated stone positions are byte-identical to every other template. **No code change needed**, but this is exactly the kind of check that would catch a design mistake (e.g. accidentally letting `preview.kind` leak into `GeometryEngine`) — worth calling out as a regression guard that already covers RS-3037 for free. Test name says "all three," now stale to "all five" — cosmetic only. |
| `tools/test-ui-shell-structure.mjs:441-447` — asserts `#viewTabDual`/`#viewTab2D`/`#viewTab3D` exist with their exact `onclick` source text | Unaffected — RS-3037's tab-disabling is a *dynamic* `.disabled` toggle keyed on the active template, not a change to the handlers' own source text or the tags' default (enabled) state. Verified: default project is Mug (decision 8), so this test's assertions (made against static `index.html`/`app.js` source, not runtime state) hold unchanged. |
| `tools/test-product-plate-round-dinner.mjs:343` — `assert.match(indexHtml, /<select id="objectType">[\s\S]*?<option value="plate">Round Dinner Plate<\/option>/)` | Non-greedy `[\s\S]*?` stops at the *first* occurrence of the plate option; since decision 1 places the new Flat Sheet option *after* Plate, this regex is unaffected. Verified by inspection, not just assumed. |
| `tools/test-production-sheet-exporter.mjs:282-297` (test 16, "every cylindrical object template ... fits A4/Letter/A3; the plate fits A3 and throws on A4/Letter") | Loops `for (const id of OBJECT_TEMPLATE_IDS)` with a binary `isPlate` branch: non-plate ids are asserted to fit A4/Letter/A3 without throwing; plate is asserted to throw on A4/Letter and fit only A3. Once `'sheet'` joins `OBJECT_TEMPLATE_IDS`, it falls into the "non-plate, must not throw on A4/Letter" branch by default — **untested whether that's actually true**. `PAGE_SIZES.A4` is 210×297mm (`ProductionSheetExporter.js:36`); the sheet's default production size is 220×220mm — wider than A4's short edge, so this needs a real computed check during implementation (not resolved here — this is measurement work for the implementation step, not this spec step) to determine whether sheet needs its own third branch (most likely: yes, alongside or instead of `PLATE_FITTING_PAGE_SIZE='A3'`). |
| `tools/rs-3011-step4-flash-check.mjs`, `tools/rs-3011-step4-flash-check-heavy.mjs`, `tools/rs-3011-step4-verify.mjs` | Playwright browser scripts (not `test-*.mjs`, so not part of `npm test`'s auto-discovery — confirmed against the conventions in `[[rhinestone-studio-conventions]]`-style memory). They exercise the view tabs only against the **default-boot project**, which stays Mug (decision 8) — never set `product:'sheet'`. Unaffected. |

No other `tools/*.mjs` file enumerates object templates, ids, counts, `#objectType` options,
`PREVIEW_KINDS`, or the workspace tabs — confirmed by the grep above (8 files, all accounted for).

---

## E. Implementation plan

### E.1 Ordered implementation steps

1. **`src/products/SheetProductDefinition.js`** (new) — `SHEET_MIN_MM=20`, `SHEET_MAX_MM=500`,
   `getSheetDefaults()` (`{widthMm:220,heightMm:220}`), `clampSheetDimensionMm(value)`. Mirrors
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
     branch immediately below it (recommended, for the same "don't duplicate the 220 default in two
     places" reasoning plate/vessel already follow).
   - `writeSelectedControlsToLayer()` (`app.js:2754-2758`): new `sheet` branch writing
     `project.canvas` directly from `#sheetWidth`/`#sheetHeight` via `clampSheetDimensionMm()`.
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
   - `setWorkspaceMode()`/tab wiring (`app.js:6336-6379`): new helper (e.g.
     `updateWorkspaceTabAvailability()`) that disables `#viewTabDual`/`#viewTab3D` and forces
     `setWorkspaceMode('2d')` when sheet is active, re-enables them otherwise; called from the
     `#objectType` change handler (step 5) and from boot, after `bootActiveView` resolution
     (`app.js:6372-6379`) and after project load/import (any path that can change `project.product`
     outside the change handler, e.g. Project Import — audit needed during implementation for every
     such path, not just the one change handler already inventoried in §A.2).
8. **`app.js` — remaining display-only sites**: `updateObjectTemplateDetail()`
   (`app.js:6124-6166`, `#wrapField`/`#sheetFields`/`#cupColorField` visibility) and `updateStats()`
   (`app.js:4076`, sheet-appropriate `#cupStats` content or blank).
9. **Image panel switch action**: wire the new button's `onclick` in `renderImageStudio()`
   (`app.js:6189`) to reuse the `#objectType` change handler's own logic (dispatch a real `change`
   event on `#objectType` after setting its value, rather than duplicating the reset logic — matches
   this codebase's stated preference for reuse over duplication).
10. **`tools/test-groups.mjs`**: add the new test file to whichever group(s) list image/object-type
    tests together, following the `IMG-011`/`test-img-011-import-defaults.mjs` precedent (opt-in
    curated grouping — `npm test` auto-discovers the file regardless, per this repo's
    `test-*.mjs` convention).
11. Update the 4 pre-existing test files identified in §D
    (`test-object-template.mjs`, `test-production-sheet-exporter.mjs`, and verify — not necessarily
    edit — `test-object-template-integration.mjs`/`test-product-plate-round-dinner.mjs`).
12. Write `tools/test-rs-3037-flat-sheet.mjs` (see §E.2).

### E.2 Test plan for `tools/test-rs-3037-flat-sheet.mjs`

1. `OBJECT_TEMPLATE_IDS` contains `'sheet'`; `getObjectTemplate('sheet').displayName==='Flat
   Sheet'`; `listObjectTemplates().length===5`.
2. `getObjectTemplate('sheet')` round-trips through `createObjectTemplate()` without throwing
   (proves the `PREVIEW_KINDS`/factor-exemption fix in §A.1/§E.1 step 2 actually landed).
3. `getObjectTemplate('sheet').productionWidthMm===220`,
   `productionHeightMm===220`, `safeAreaInsetMm` is `{top:10,right:10,bottom:10,left:10}`.
4. `getSafeAreaRectMm(getObjectTemplate('sheet'), 220, 220)` returns a positive interior
   (`widthMm===200`, `heightMm===200`).
5. `clampSheetDimensionMm()`: below 20 clamps to 20, above 500 clamps to 500, a value inside the
   range passes through unchanged, a non-finite input falls back to the default (mirrors
   `clampPlateDimensionMm()`'s own contract and its test coverage in
   `tools/test-product-plate-round-dinner.mjs:108`).
6. **Behavioral, through `validateProject()`** (extracted the same way as §C's probe script,
   promoted into a real assertion): a project JSON with `product:'sheet'`, `canvas:{width:220,
   height:220}` round-trips with `resolved.product==='sheet'` (not `'mug'`) now that `'sheet'` is
   registered — the mirror image of §C's pre-implementation measurement, proving the fallback goes
   away once the id is real. Also assert `canvas:{width:20,height:20}` and `{width:500,height:500}`
   both pass through unmodified (no throw, no silent clamp at this layer — confirms `validateProject()`
   intentionally leaves the 20–500 clamp to the UI layer, per §B).
7. **Behavioral, through the `#objectType` change handler**: using the same `new Function(...)`
   DOM-stub extraction precedent as `tools/test-rc-003-project-import-lightbox.mjs`/
   `tools/test-rc-005-autosave-crash-recovery.mjs` (per `[[rhinestone-studio-conventions]]`),
   simulate selecting Flat Sheet from a Mug project: assert `project.product==='sheet'`,
   `project.canvas` becomes the sheet default (220×220), and (via a stubbed
   `el('viewTabDual').disabled`/`el('viewTab3D').disabled`) that the workspace-tab-availability
   guard actually ran. Then simulate switching back to Mug and assert the tabs re-enable and
   `project.canvas` returns to the mug default.
8. `drawCup()`/3D-preview guard: with a stubbed `preview3D.update` spy, assert it is **not called**
   (or is a true no-op) when `currentObjectTemplate().id==='sheet'`, and **is** called for every
   other template (regression guard against accidentally breaking mug/tumbler/bottle/plate).
9. `isPointerOnFrontViewFrame()` and `isTextTooLongForObject()` both return `false` unconditionally
   for a sheet template, mirroring the existing plate-only assertions this suite's precedent
   (`test-object-template-integration.mjs`) already makes for plate.
10. `drawLayout()`'s guide selection: for sheet, `drawSafeAreaGuide()` is called and
    `drawFrontViewFrame()`/`drawPlateDesignTargetGuide()` are not (spy-based, same technique as #8).
11. Production Sheet: `currentProductionSheetOptions()`-equivalent input with
    `objectType:'Flat Sheet'`, `productionWidthMm/HeightMm:220` produces a `computeProductionSheetLayout()`
    result with no plate-only header lines (`plateHeaderLineTexts.length===0`, since
    `plateOuterDiameterMm` is never spread in) — and record literally whether A4/Letter throw at the
    default margin (resolving §D's open measurement for `test-production-sheet-exporter.mjs`).
12. SVG/DXF/PNG export smoke test at the sheet's canvas size (220×220 and a non-default edited
    size, e.g. 350×180) — output dimensions match `project.canvas`, no product-specific branch
    fires.
13. Backward compatibility: a project object shaped like a genuine pre-milestone save (`product:
    'mug'`, no `sheet` field of any kind since none was ever added per §B) still validates and
    regenerates identically before/after this milestone's `validateProject()`/`defaultProject()`
    (byte-identical StoneLayout — reuses the existing `generateMergedLayout()` comparison idiom from
    `test-object-template-integration.mjs`'s test 15/16).
14. Image panel: the "Switch to Flat Sheet" action is present/visible only when the active template
    is not `'sheet'`, and clicking it results in `project.product==='sheet'` (through the same
    change-handler path exercised in #7, per the reuse decision in §E.1 step 9) without altering
    the currently-selected image layer's own fields.

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
