# RS-2010 — Physical Product Dimensions

Status: proposed
Depends on: RS-1004 (Multi-Object Templates), S-112 (Round Dinner Plate)

------------------------------------------------------------------------------
1. Current architecture
------------------------------------------------------------------------------

Every vessel-kind object template (`mug`, `tumbler`, `bottle` — `src/products/ObjectTemplate.js`)
is a **fixed-size preset**, not a physical product definition:

- `productionWidthMm`/`productionHeightMm` are hard-coded per template (e.g. mug 210×90mm) and
  become `project.canvas.width/height` verbatim whenever that template is selected
  (`app.js`'s `#objectType` change handler, `app.js:1721`).
- `preview.topWidthFactor`/`bottomWidthFactor`/`bodyHeightFactor` are **dimensionless ratios**
  read by two independent consumers: `src/renderer/CupRenderer.js` (2D schematic silhouette, pure
  viewport-px, never touches mm) and `src/preview3d/ObjectDimensions.js`'s
  `computeObjectDimensionsMm()` (3D preview, mm). The 3D preview's `topRadiusMm` is **derived**,
  never authored — `bodyRadiusMm * (topWidthFactor/bottomWidthFactor)` — so there is no
  independently-specifiable top diameter.
- `computeBodyRadiusMm(canvasWidthMm)` anchors a full 360° revolution to exactly
  `canvasWidthMm` of arc length (S-107) — i.e. **circumference already equals canvas width** for
  every revolved-vessel kind. This one invariant is what RS-2010 builds on: a real
  `bodyDiameterMm` and a derived `canvas.width = π·bodyDiameterMm` are the same circumference
  contract already in place, just now sourced from a physical spec instead of a fixed preset.
- `bodyHeightMm` (3D preview) is set directly to `canvasHeightMm` — the entire canvas height is
  currently treated as the full revolved body height, with no separate non-printable margin.

The Round Dinner Plate (S-112) already proves the target shape of this milestone for one product:
`src/products/PlateProductDefinition.js` wraps a JSON definition
(`src/products/definitions/plate-round-dinner.json`) with range/default/normalize helpers;
`project.plate` is a project-level, always-present params bag (even for non-plate projects, mirroring
`project.wrap`); editing a plate field recomputes `project.canvas` from the live plate params
(`app.js:967-970`); `ObjectDimensions.js` takes an optional `plateParams` argument
(`computeObjectDimensionsMm(template, canvasWidthMm, canvasHeightMm, plateParams)`) that branches
to a plate-specific dimension computation. RS-2010 generalizes this exact pattern to the three
revolved-vessel kinds, which is why the plate code paths are read-only reference material here, not
something this milestone touches.

`GeometryEngine.js` has **zero references** to `canvas`, `template`, or any object-template field —
confirmed by audit (`grep` returns nothing). It only ever consumes `project.canvas.width/height` as
plain mm numbers and `project.layers`. This is what makes the whole milestone safe: nothing about
*how* `project.canvas` gets its value can affect geometry generation, only *what value it holds*.

------------------------------------------------------------------------------
2. Audit findings
------------------------------------------------------------------------------

- `src/products/index.js` re-exports `ObjectTemplate.js` + `PlateProductDefinition.js` +
  `PlateGuides.js`. No vessel-equivalent module exists yet.
- No UI control exists today to edit a mug/tumbler/bottle's mm size at all — `project.canvas` for
  those three kinds is fully fixed per template and only ever changes by switching object type.
  (Contrast with the plate, which has four live-editable mm fields.)
- `app.js validateProject()` (`app.js:620-677`) already has an established, permissive
  backward-compatible normalization pattern for a project-level params bag
  (`plate:normalizePlateParams(obj.plate)` — always runs, never throws, defaults to Round Dinner
  Plate's own JSON defaults when `obj.plate` is missing/malformed). RS-2010's `project.vessel`
  handling follows the same shape.
- `src/preview3d/ObjectGeometryBuilder.js`'s `buildObjectMesh(template, canvasWidthMm,
  canvasHeightMm, plateParams)` and `src/preview3d/Preview3DRenderer.js`'s `update(stoneLayout,
  {..., plateParams})` / `_rebuildMesh(...)` already thread an optional per-product params object
  from `app.js drawCup()` down to `computeObjectDimensionsMm()`. Adding a sibling `vesselParams`
  argument at each of these three call sites is a direct extension of an existing, working plumbing
  pattern — not a new one.
- `src/export/ProductionSheetExporter.js` never reads `ObjectTemplate`/`plate`/`vessel` fields at
  all — it only takes `productionWidthMm`/`productionHeightMm` (i.e. the live `project.canvas`) as
  plain numbers, already forwarded by `app.js currentProductionSheetOptions()`. No exporter change
  is needed; it will automatically reflect the new derived canvas size.
- `src/renderer/CupRenderer.js` (2D schematic silhouette) reads `preview.topWidthFactor` etc.
  directly off the `ObjectTemplate` record, entirely in viewport-px, with no mm/canvas coupling at
  all. It is unaffected by this milestone (per the explicit "Do NOT change ... 2D renderer"
  instruction) and requires no code change.

------------------------------------------------------------------------------
3. Product schema — new vessel product definitions
------------------------------------------------------------------------------

New module `src/products/VesselProductDefinition.js`, one shared implementation parameterized by
product id (`'mug' | 'tumbler' | 'bottle'`), backed by three JSON definitions under
`src/products/definitions/`: `vessel-standard-mug.json`, `vessel-standard-tumbler.json`,
`vessel-standard-bottle.json`. Each follows the plate JSON's shape (`dimensions` ranges +
`defaults` + `research` notes disclaiming "practical modeling envelope, not an industry standard").

Fields per definition:

| Field | Meaning |
|---|---|
| `dimensions.bodyDiameterMm` `{min,average,max}` | Cylindrical body wall diameter. Source of `canvas.width` (circumference = π·bodyDiameterMm). |
| `dimensions.topDiameterMm` `{min,average,max}` | Diameter at the mouth/rim (mug: flared; tumbler: forced equal to body — straight wall; bottle: body-top diameter, before the shoulder/neck taper already modeled by the existing `neckWidthFactor` ratio fields). Feeds `topRadiusMm` directly (mm), replacing the old ratio-derived value. |
| `dimensions.bodyHeightMm` `{min,average,max}` | True physical height of the cylindrical body wall. |
| `printableMarginMm` | Combined top+bottom non-printable margin (rim curl / base radius / handle-adjacent distortion) subtracted from `bodyHeightMm` to derive `printableHeightMm`. A single documented constant per product, not a range — this is a manufacturing/legibility margin, not a customer-facing spec. |
| `defaults` | `bodyDiameterMm`/`topDiameterMm`/`bodyHeightMm` defaults (the JSON's own `average`s). |

`printableHeightMm` is **derived**, never stored as an independent authored range:
`printableHeightMm = max(MIN_PRINTABLE_HEIGHT_MM, bodyHeightMm − printableMarginMm)`. This mirrors
how the plate's `rimWidthMm` is derived from outer/inner diameter
(`computeRimWidthMm()`) rather than separately authored — "structurally impossible for a stored
value to disagree with the dimensions it's derived from" (same rationale
`PlateProductDefinition.js` already documents). It is also why the UI (§6) exposes Body
Diameter/Body Height/Top Diameter as the three editable fields and never a separate "Printable
Height" control — exactly the three fields RS-2010's own instructions list.

**Chosen defaults and rationale** (approximate, sourced from common commercial sublimation-blank
spec sheets, not an exact SKU — same disclaimer posture as the plate JSON):

| Product | bodyDiameterMm | topDiameterMm | bodyHeightMm | printableMarginMm | → printableHeightMm |
|---|---|---|---|---|---|
| Standard Mug (11oz ceramic) | 76–88, avg 82 | 78–92, avg 85 (slight rim flare) | 88–102, avg 95 | 10 | avg 85 |
| Standard Tumbler (20oz skinny, straight) | 70–82, avg 76 | = body (straight wall, no taper) | 165–185, avg 175 | 30 (tapered base + rolled rim excluded) | avg 145 |
| Standard Bottle (500–750ml, cylindrical body zone only) | 62–74, avg 68 | = body (straight cylindrical body; shoulder/neck/cap unchanged, still ratio-derived) | 130–170, avg 150 | 10 | avg 140 |

For the tumbler, `topDiameterMm`'s range/default is a straight copy of `bodyDiameterMm`'s — the
"Straight Tumbler" template's defining trait — and the UI never exposes it as an independently
editable field (§6). For the bottle, `topDiameterMm` likewise mirrors `bodyDiameterMm` (the
cylindrical body zone this milestone models has no independent top diameter of its own; the
shoulder/neck/cap taper above it remains the existing ratio-based schematic, untouched).

`project.vessel` (new, optional, project-level — mirrors `project.plate`):

```js
project.vessel = {
  bodyDiameterMm: number,
  topDiameterMm: number,
  bodyHeightMm: number,
  printableHeightMm: number   // derived, but stored (like plate's rimWidthMm is *not* stored —
                               // difference: printableHeightMm must round-trip through legacy
                               // canvas-preserving derivation, see §4, so it is persisted)
}
```

Always present, exactly like `project.plate`, even when the active product is `plate` or when the
active vessel kind differs from the one `project.vessel` was last normalized against — inert but
well-formed data, never `null`/`undefined`, so no call site needs a null-check (matching this
codebase's established convention).

------------------------------------------------------------------------------
4. Migration & compatibility strategy
------------------------------------------------------------------------------

Two distinct normalization paths, both living in `VesselProductDefinition.js`:

**A. `normalizeVesselParams(productId, raw)`** — used whenever `raw` (`obj.vessel`) is a real
object, or when seeding a fresh/switched-to product. Clamps every field into that product's
commercial `[min,max]` range (JSON), exactly like `clampPlateDimensionMm()`. This is the path new
projects and live UI edits take — the operator can never type a value outside the approved
modeling envelope.

**B. `deriveLegacyVesselParams(productId, template, canvasWidthMm, canvasHeightMm)`** — used only
when `obj.vessel` is absent (any pre-RS-2010 project). Reverses today's existing formulas exactly,
**unclamped** (only a positivity guard), so it honestly reflects whatever the legacy canvas already
implied — even if that falls outside the new "realistic" range (the old mug preset, 210mm width, back-
solves to a ~66.8mm body diameter, well under the new 76–88mm commercial range; clamping it here
would silently lie about what the legacy project actually contains):

```
bodyDiameterMm  = canvasWidthMm / π                          // inverse of circumferenceMm()
topDiameterMm   = bodyDiameterMm * (topWidthFactor/bottomWidthFactor)  // inverse of today's ratio
printableHeightMm = canvasHeightMm                            // preserve the existing printable area, verbatim
bodyHeightMm    = canvasHeightMm + printableMarginMm           // reverse of the new margin formula
```

Both paths only ever populate `project.vessel` for **display/3D-preview purposes** — neither path
writes to `project.canvas`. `project.canvas` is changed only by the two places listed in §5 that
already own that responsibility (object-type switch, live vessel-field edit) — never by
`validateProject()`/import. This is the crux of the compatibility guarantee: **loading** an old
project can never move `project.canvas`, so GeometryEngine's input — the only thing that determines
`StoneLayout` — is byte-identical to before this milestone existed, for every legacy project,
unconditionally.

`validateProject()` addition (alongside the existing `plate:normalizePlateParams(obj.plate)` line):

```js
const productId = getObjectTemplate(obj.product).id;
const vessel = VESSEL_PRODUCT_IDS.includes(productId)
  ? (obj.vessel && typeof obj.vessel === 'object'
      ? normalizeVesselParams(productId, obj.vessel)
      : deriveLegacyVesselParams(productId, getObjectTemplate(productId), canvas.width, canvas.height))
  : (obj.vessel && typeof obj.vessel === 'object' ? normalizeVesselParams('mug', obj.vessel) : getVesselDefaults('mug'));
```

(The `else` branch — active product is `plate` — mirrors exactly how `project.plate` already stays
populated with valid-but-inert data while a cylindrical template is active.)

------------------------------------------------------------------------------
5. Canvas derivation (new projects / live edits only)
------------------------------------------------------------------------------

`computeCanvasFromVessel(vesselParams) → {width: π·bodyDiameterMm, height: printableHeightMm}`,
consumed at exactly the two places that already own `project.canvas` resets for a
non-legacy-loading reason:

1. **Object-type switch** (`app.js:1721`, mirroring the existing `if (template.id==='plate')`
   branch immediately below it): switching to `mug`/`tumbler`/`bottle` resets `project.vessel =
   getVesselDefaults(template.id)` and `project.canvas = computeCanvasFromVessel(project.vessel)`,
   replacing today's `canvas:{width:template.productionWidthMm,height:template.productionHeightMm}`
   for those three ids. (`ObjectTemplate.js`'s own `productionWidthMm`/`productionHeightMm` fields
   are left untouched — they still gate `safeAreaInsetMm` validation and remain the fallback used by
   `getSafeAreaRectMm()`, which stays canvas-size-relative and needs no change.)
2. **Live vessel-field edit** (`app.js writeSelectedControlsToLayer()`, mirroring the existing
   plate `if (currentObjectTemplate().preview.kind==='plate')` block at `app.js:967-970`): a new
   sibling branch for `kind==='mug'|'tumbler'|'bottle'` normalizes the three typed fields (Body
   Diameter / Body Height / Top Diameter — Top Diameter forced equal to Body Diameter for
   `tumbler`, whose field is hidden), then sets `project.canvas =
   computeCanvasFromVessel(project.vessel)`.

`defaultProject()`'s hard-coded `canvas:{width:210,height:90}` for the default `mug` product is
replaced with `computeCanvasFromVessel(getVesselDefaults('mug'))` for consistency — a *new* default
project is not a "legacy project," so it should reflect the new realistic default immediately.

------------------------------------------------------------------------------
6. User interface
------------------------------------------------------------------------------

`index.html`'s `#lightboxShapes` → Object Templates tab gains a `#vesselFields` section (sibling to
the existing `#plateFields`, same show/hide-by-`preview.kind` convention driven by
`updateObjectTemplateDetail()`):

- Body Diameter (mm) — `#vesselBodyDiameter`
- Body Height (mm) — `#vesselBodyHeight`
- Top Diameter (mm) — `#vesselTopDiameter` — hidden for `tumbler` (straight wall, not independently
  adjustable; the hint text explains why), shown for `mug`/`bottle`.

`min`/`max`/`step` attributes are re-applied on every object-type switch (three different products
share the section, unlike the plate's single fixed range) via a small helper
(`updateVesselFieldsRange()`), reading `getVesselDimensionRange(productId, field)` — same source of
truth pattern the plate fields already use (JSON stays authoritative; HTML attributes are read from
it, not invented).

Plate behavior is completely unchanged — a distinct section, distinct fields, distinct show/hide
condition, already `preview.kind==='plate'`-gated today.

------------------------------------------------------------------------------
7. Geometry / 3D Preview plumbing
------------------------------------------------------------------------------

`ObjectDimensions.js`'s `computeObjectDimensionsMm(template, canvasWidthMm, canvasHeightMm,
plateParams=null, vesselParams=null)` gains one new trailing optional parameter, mirroring
`plateParams`'s existing shape exactly:

- `vesselParams` only changes behavior for `preview.kind !== 'plate'` (mug/tumbler/bottle).
- When present: `topRadiusMm = vesselParams.topDiameterMm / 2` (mm-direct), replacing
  `bodyRadiusMm * (topWidthFactor/bottomWidthFactor)`.
- `bodyRadiusMm` computation is **unchanged** (`computeBodyRadiusMm(canvasWidthMm)`) — since
  `canvasWidthMm` is itself now `π·bodyDiameterMm` by construction (§5), this already yields
  `bodyDiameterMm/2` exactly, with no drift between the two independently-computed values.
- `dims.bodyHeightMm` stays `= canvasHeightMm`, exactly as today. This is a deliberate scoping
  decision (see §9, out of scope) — the true physical `bodyHeightMm` (which is *larger* than
  `printableHeightMm`/`canvasHeightMm` by `printableMarginMm`) is stored and shown in the UI but
  does not yet reshape the 3D revolve or its UV mapping. Only `topRadiusMm` becomes physically
  accurate this milestone; modeling the non-printable rim/base band as a real geometric margin is
  future work.
- When `vesselParams` is `null`/omitted (every existing call site, every existing test), behavior
  is **byte-identical** to today — the ratio-based fallback path is untouched code, not a new
  default value threaded through it.

Plumbing (mirrors the existing `plateParams` chain exactly, one new sibling argument at each hop):
`app.js drawCup()` → `Preview3DRenderer.update({..., vesselParams: project.vessel})` →
`_rebuildMesh(template, canvasWidthMm, canvasHeightMm, plateParams, vesselParams)` (also folded into
the mesh-rebuild cache key, like `plateParams` already is) →
`ObjectGeometryBuilder.buildObjectMesh(template, canvasWidthMm, canvasHeightMm, plateParams,
vesselParams)` → `computeObjectDimensionsMm(...)`. No change to `buildTaperedBodyGeometry()` /
`buildBottleGeometry()` / any UV-mapping function — they already just read `dimensions.topRadiusMm`
off the returned object, unaware of where it came from.

------------------------------------------------------------------------------
8. Test plan
------------------------------------------------------------------------------

New: `tools/test-vessel-product-definition.mjs` — mirrors `test-product-plate-round-dinner.mjs`'s
shape:
- range/default lookup for all three products, all three fields
- clamping (below-min, above-max, NaN/non-number → default)
- `computePrintableHeightMm`/derived-field consistency (never negative, respects `MIN_PRINTABLE_HEIGHT_MM` floor)
- `normalizeVesselParams` round-trips defaults unchanged; clamps malformed/out-of-range input
- `deriveLegacyVesselParams`: given a known legacy canvas (e.g. mug 210×90), derived
  `printableHeightMm` exactly equals the input `canvasHeightMm`; derived `bodyDiameterMm/π ≈
  canvasWidthMm` round-trips via `computeCanvasFromVessel`
- `computeCanvasFromVessel`: `width = π·bodyDiameterMm`, `height = printableHeightMm`, inverse of
  `deriveLegacyVesselParams` for the printable-height leg

Extended: `tools/test-object-dimensions.mjs` — add cases for the new `vesselParams` argument:
- `computeObjectDimensionsMm(template, w, h)` (no 5th arg) is unchanged for all existing assertions
  (regression guard — this is the byte-identical/legacy-compat contract)
- with `vesselParams` supplied, `topRadiusMm === vesselParams.topDiameterMm/2` exactly
- tumbler with `vesselParams.topDiameterMm === vesselParams.bodyDiameterMm` yields
  `topRadiusMm === bodyRadiusMm` (straight wall preserved)
- `bodyRadiusMm` is unaffected by `vesselParams` (still purely a function of `canvasWidthMm`)

Extended: `tools/test-object-geometry-builder.mjs` — one added case confirming `buildObjectMesh(...,
vesselParams)` produces geometry whose bounding radius reflects the mm-direct top diameter (no
regression to the plate/no-vesselParams paths).

New/extended app.js-level test (following this repo's established
`indexOf`-slice-and-`new Function` pattern, per [[rhinestone-studio-conventions]]): a
`validateProject()` regression test asserting (a) a legacy project (no `vessel` key) round-trips
with `project.canvas` byte-identical to its input, and a populated, in-range `project.vessel`; (b) a
project with an explicit `vessel` object gets clamped correctly; (c) switching object type from
`mug` to `tumbler` and back resets both `project.vessel` and `project.canvas` to that product's own
defaults (mirrors the existing plate switch-behavior test if one exists, else a new focused case).

Explicitly **not** run: `npm test`/`npm run test:full` (per CLAUDE.md's testing policy — this
milestone doesn't touch shared architecture, project schema *semantics* for existing fields,
exporters, or GeometryEngine — only adds an optional field with backward-compatible fallback
behavior). Focused test files above only.

------------------------------------------------------------------------------
9. Out of scope
------------------------------------------------------------------------------

- Modeling `printableMarginMm` as an actual non-printable band in the 3D revolve/UV mapping (today
  the entire canvas height still maps 1:1 onto the full revolved body, per §7) — deferred until a
  future milestone with real per-product curvature data, matching the plate JSON's own
  "provisional"/"confidence" disclaimers for similarly under-specified fields.
- Bottle shoulder/neck/cap absolute mm dimensions — these remain the existing
  `neckWidthFactor`/`neckHeightFactor`/`shoulderHeightFactor`/`capHeightFactor` ratios, relative to
  the (now physically real) body radius/height, unchanged.
- Any change to `GeometryEngine.js`, `StoneLayout` schema, SVG exporter, Production Sheet geometry,
  the 2D renderer (`CupRenderer.js`/`CanvasRenderer2D.js`), fill algorithms, or text generation —
  none of these read canvas-derivation logic or object-template mm fields in a way this milestone
  touches (confirmed by audit, §2).
- A generic N-product "vessel family" plugin architecture beyond the three named products — three
  JSON files + one shared normalization module is the smallest correct solution for the three
  products explicitly requested; not designed for hypothetical future vessel kinds beyond what
  `VesselProductDefinition.js`'s existing per-product-id parameterization already accommodates for
  free.
- Editable Printable Height as its own UI field — deliberately derived-only (§3), not exposed,
  matching the milestone's own UI field list (Body Diameter / Body Height / Top Diameter).
