# S-200 — Mixed Stone-Size Layouts

## Objective

Allow one design to contain multiple rhinestone sizes in a single `StoneLayout` (e.g. SS6 + SS10,
SS10 + SS16, SS6 + SS10 + SS16) — individual stones may have different diameters, not just
different layers. Add a second, opt-in "Mixed" generation mode alongside the existing "Uniform"
mode (unchanged default behavior), where the Geometry Engine may deterministically add smaller
stones into genuine gaps a layer's primary stone size cannot reach, subject to manufacturing
spacing and a user-selected size range. One `GeometryEngine`, one `StoneLayout` pipeline — no
parallel generation path, no renderer/exporter-side geometry.

## Audit Findings (before implementation)

Per-stone variable size is **already fully implemented at the geometry/rendering/export layer**,
by RS-1013 (Variable Stone Sizes). What that milestone did *not* do is generate more than one size
*within* a single layer — every `generate*Layout()` call still takes one `stoneSizeMm` and applies
it to every stone the call produces. Confirmed by direct reading of the current source:

* `Stone` (`src/geometry/Stone.js`) already carries its own `sizeMm` per instance —
  `StoneLayout` (`src/geometry/StoneLayout.js`) has never assumed a uniform stone size, and its
  `getBoundingBox()`/`toJSON()`/`fromJSON()` already operate per-stone. **No `StoneLayout`/`Stone`
  schema change is needed for this milestone.**
* Every consumer already reads `stone.sizeMm` per stone, with no per-layer-type or per-size special
  case: `src/renderer/CanvasRenderer2D.js` (`renderStoneLayout()`/`drawStone()`),
  `src/export/SvgExporter.js` (`stoneCircleSvg()`), `src/export/ProductionSheetExporter.js`
  (`computeProductionSheetLayout()`'s stone re-projection, `productionSheetToSvg/Pdf()`),
  `src/preview3d/StoneLayoutTexture.js` (`drawStoneLayoutTexture()`). **None of these need to
  change to render/export a mixed-size layout correctly** — this was already exercised by RS-1013
  for cross-layer size mixing, and the same per-stone code path handles intra-layer mixing
  identically, since a `Stone` has no notion of "its layer's size."
* `src/geometry/StoneSampler.js`'s `dedupeStonesByRadius()` already prevents cross-*layer* overlap
  using each stone's own diameter (`(a.d+b.d)/2` threshold), but explicitly skips same-`layerId`
  pairs — same-layer spacing has always been the sole responsibility of that layer's own
  `generate*Layout()` call. This milestone needs an equivalent *same-layer, cross-size* overlap
  guard, since Mixed mode is the first thing that can put two different-sized stones in one layer.
* `src/geometry/GeometryEngine.js`'s five `generate*Layout()` methods (text, shape, svg, image,
  path) each: build one `spacingMm = stoneSizeMm + gapMm`, sample candidate points via
  `StoneSampler.js` (`sampleShapeFillPoints()`/`sampleFieldByMode()`, dispatching on
  `'outline'|'fill'|'staggered'|'radial'|'contour'`), then map every point to a `Stone` at the one
  `stoneSizeMm`. This uniform mapping is the "Uniform" mode this milestone must keep byte-identical,
  and the exact seam Mixed mode's additive infill pass hooks into.
* `src/export/ProductionSheetExporter.js`'s `computeProductionSheetLayout()` already computes
  `distinctSizesMm` (every distinct size present) but only a single total `stoneCount` — it does
  **not** report a quantity per size (or per size-per-color), which is what this milestone's
  "Production Sheet must automatically group quantities" requirement needs added.
* `app.js`'s per-layer plain-object schema stores `stoneSize`/`gap`/`color` on every layer
  regardless of type, and its `GeometryEngine` wrapper class forwards them to the permanent engine
  per layer type (`generateTextStonesLive()`/`generateShapeStonesLive()`/`generateSvgStonesLive()`/
  `generateImageStonesLive()`/`generatePathStonesLive()`), then flattens every returned `Stone` back
  to `{x,y,d:s.sizeMm,color,layerId}` before the cross-layer `dedupeStonesByRadius()` pass — i.e.
  app.js already treats stone size as a per-stone field end-to-end, it just never generates more
  than one per layer today.
* `validateProject()` (app.js) only requires `stoneSize`/`gap` to be valid numbers per layer;
  every other per-layer field is optional and permissively defaulted downstream (e.g.
  `l.align??'left'`, `resolveVectorFillMode(l.fillMode)`). New optional layer fields for this
  milestone need **no `validateProject()` changes** — the existing `{...l}` spread already forwards
  unknown/legacy-missing fields, exactly the pattern RS-1013/S-112 already rely on.
* `project.version` has no migration function; it is read permissively (`Number(obj.version)||2`)
  and never gates behavior. This milestone adds no version bump — new fields are additive/optional.
* The per-layer inspector uses one shared, DOM-relocated field group per concern
  (`FIELD_GROUPS` in app.js: `sharedPositionFields`, `sharedStoneFields`), moved between the right
  inspector and whichever type-specific Lightbox is open via `relocateFieldGroups()`. This is the
  established pattern for a control that applies uniformly across every layer type, which the new
  Mixed Stone Size section (also universal, like Stone size/Gap/Color) follows exactly.

**Conclusion:** this milestone is almost entirely a `GeometryEngine` change (one new, narrowly
scoped infill pass) plus a `ProductionSheetExporter` grouping change plus UI wiring. No renderer,
no 3D preview, no SVG exporter, no `StoneLayout`/`Stone` schema change.

## Design

### Generation Modes

A new optional per-layer field, `sizeMode: 'uniform' | 'mixed'` (default `'uniform'` — including
for every layer with no such field at all, i.e. every project saved before this milestone).

* **Uniform** (existing behavior): every stone in the layer is `layer.stoneSize`. Code path is
  **completely unchanged** — Mixed-mode code never executes when `sizeMode !== 'mixed'`.
* **Mixed**: the layer's primary stones are generated exactly as Uniform mode would (same
  `stoneSize`, same sampling), then a second, additive **infill pass** may place *additional*,
  smaller stones into genuine gaps the primary pitch left uncovered.

### Why infill, not literal stone replacement

The brief describes Mixed mode as "replacing" larger stones with smaller ones. This spec
implements it as **strictly additive infill** (existing primary stones are never removed, resized,
or moved) for one deliberate, documented reason: it is the only version of "detail improves, no
overlap, spacing preserved, deterministic" that carries **zero risk of ever regressing the
Uniform-mode silhouette** a layer already produces. Removing/repositioning a primary stone to make
room for two smaller ones can only ever be geometrically equivalent to "delete that stone, then
run gap-fill in the newly-emptied circle" — which the additive algorithm below already does for
every *pre-existing* gap. The net visual and manufacturing effect (more, smaller stones filling
space the primary pitch missed) is the same; the additive framing is strictly safer and strictly
simpler to prove correct, which matches this milestone's explicit "correctness first," "do not
aggressively maximize," and "intentionally conservative" instructions. This is documented here as
the milestone's central decision rule.

### Decision rule: which gaps get filled, with which size

For a layer in Mixed mode with a non-empty set of *eligible smaller sizes* (see below):

1. Generate the primary layout exactly as Uniform mode does (`stoneSizeMm = layer.stoneSize`,
   the layer's own `mode`/`fillMode`). This is `baseStones`.
2. Compute `eligibleSizesMm` = the user's **Allowed Sizes** selection, filtered to sizes that are
   `< primarySizeMm` (only *smaller* sizes ever get added — "never replace with a larger stone" is
   implicit, since only-smaller keeps the layer's overall footprint/silhouette unchanged) and
   within `[minSizeMm, maxSizeMm]` (the user's Minimum/Maximum Size controls). Sorted **descending**
   (try the size closest to primary first — the smallest possible deviation from what Uniform mode
   would have produced, the most conservative choice at each candidate point).
   * If `eligibleSizesMm` is empty (no Allowed Size is both smaller than primary and inside the
     min/max range), Mixed mode produces **exactly** the Uniform-mode layout — a safe, explicit
     no-op, not an error.
3. Resample the **same shape** (same polygons/field, same `mode`) at a finer pitch —
   `smallestEligibleMm + gapMm`, widened by the **Conservative Detail** slider (`0`=sparsest
   candidate grid, `1`=finest possible, see "Conservative Detail" below) — using the exact same
   `StoneSampler.js` functions the primary pass used (`sampleShapeFillPoints()`/
   `sampleFieldByMode()`), so infill candidates come from the identical geometric source (interior
   test / density field) as the primary stones, in that sampler's own fixed, deterministic scan
   order.
4. Walk the candidates in that fixed order. For each candidate point, try `eligibleSizesMm` in
   order (largest-to-smallest); accept the first size whose stone does not overlap any already-
   accepted stone (primary or infill so far) — overlap threshold is the true manufacturing minimum,
   `(a.sizeMm + b.sizeMm)/2 + gapMm`, i.e. sum-of-radii plus the layer's own configured gap, so
   "maintain minimum manufacturing spacing" and "never create physical overlap" hold for every pair
   simultaneously, not just against the primary layer. If no eligible size fits at a candidate
   point, skip that point — infill never forces a placement that would violate spacing.
5. Append every accepted infill stone to the layer's stones. Primary stones are untouched.

This rule is identical for every sample mode (`outline`/`fill`/`staggered`/`radial`/`contour`) and
every vector layer type (text, shape, svg-closed-contours, path) plus the raster Image Trace field
— no mode-specific or layer-type-specific infill logic is needed, because the rule only ever asks
one geometric question ("does a stone of size S at point P overlap anything already placed?") of
whatever candidate points that mode's own existing sampler produces. Concretely this means:

* **Fill/Staggered/Radial/Contour**: the primary square/hex/ring grid at `primarySizeMm` pitch
  leaves real, irregular pockets near non-axis-aligned edges and concave corners that a finer
  candidate grid can legitimately reach — this is the common, expected case, and where Mixed mode
  produces most of its added stones.
* **Outline**: the primary perimeter walk is already dense at `primarySizeMm` pitch, so a finer
  resample mostly reproduces already-covered ground (rejected by the overlap check, at the cost of
  extra but bounded candidate-point work — see Performance). It can still add stones in the rare
  spot where same-contour/cross-contour overlap dedupe (RC-002/RC-004A) removed a primary point,
  leaving a short uncovered arc — a legitimate, if infrequent, detail improvement.
* **SVG layers specifically**: infill only samples closed contours (the same interior a fill mode
  needs). Open contours (`<line>`/`<polyline>`/an unclosed `<path>` subpath) have no interior to
  gap-fill and are excluded from the infill pass — their outline is already at full primary
  density and gains nothing from a second, finer walk of the same line.
* **Text layers with an authored-stone font** (RS Block/RS Modern/RS Script's `stoneCenters`
  contract): no vector outline exists to resample, so Mixed mode has no effect for these layers —
  documented, silent no-op (identical spirit to the existing authored-stone + curved-text
  restriction already in `generateTextLayout()`), never an error.

### Conservative Detail

A single `0..1` slider, `layer.conservativeDetail` (default `0.3` — deliberately biased toward the
sparse end, per "intentionally conservative... do not aggressively maximize"). It scales the
infill candidate pitch:

```
basePitchMm   = smallestEligibleSizeMm + gapMm       // finest geometrically valid pitch
infillPitchMm = basePitchMm * (2 - conservativeDetail) // range: [basePitchMm, 2*basePitchMm]
```

`0` → candidates are spaced at twice the finest pitch (fewest candidates, sparsest infill). `1` →
candidates are spaced at exactly the smallest eligible size's own pitch (as many candidates as that
size can geometrically support). The overlap/spacing guarantees in step 4 above hold **identically
regardless of this slider's value** — it only changes how many candidate points are *offered*, never
whether an accepted stone can overlap or violate spacing. This is what makes it safe to expose as a
simple, single continuous control rather than a set of independent, interacting parameters.

### Manufacturing rules — how each brief requirement is satisfied

| Requirement | How S-200 satisfies it |
|---|---|
| Never create physical overlap | Step 4's `(a.sizeMm+b.sizeMm)/2 + gapMm` threshold, checked against every already-placed stone (primary + infill), same-layer, via a grid-hash spatial index (see Performance) — not just the pre-existing cross-layer `dedupeStonesByRadius()`. |
| Maintain minimum manufacturing spacing | Same threshold includes `+ gapMm`, the layer's own configured gap — stricter than `dedupeStonesByRadius()`'s cross-layer check (which only guards true touching, no gap), because same-layer infill must respect the same spacing convention `spacingMm = size + gap` every sampler already uses. |
| Never smaller than the user-selected minimum size | `eligibleSizesMm` is filtered to `>= minSizeMm` before any candidate is ever considered (step 2). |
| Respect every existing GeometryEngine constraint | Infill candidates are produced by the exact same `StoneSampler.js` interior tests (`isPointInsidePolygons()` / density-field threshold) the primary pass already uses — no second containment/curve/hole implementation. |
| Deterministic output | Candidate order is the sampler's own fixed scan order (unchanged by this milestone); size-preference order is fixed (`eligibleSizesMm` descending); the overlap index is built and queried in that same fixed order. No randomness, no `Set`/`Map` iteration-order dependency on insertion from an unordered source. |
| Conservative (no aggressive maximization) | Infill is strictly additive gaps-only (never touches primary coverage), `eligibleSizesMm` always prefers the size closest to primary first, and the default `conservativeDetail` (`0.3`) biases toward fewer candidates. |

## Architecture

### `src/geometry/MixedSizeGenerator.js` (new)

A narrowly-scoped module, imported only by `GeometryEngine.js` (mirrors `ContourRingSampler.js`'s
relationship to `StoneSampler.js`/`GeometryEngine.js` — a private implementation detail of the one
Geometry Engine, not a second engine or a second `StoneLayout` producer):

* `normalizeMixedSizeParams(params, stoneSizeMm)` — validates/defaults `sizeMode`,
  `allowedSizesMm`, `minSizeMm`, `maxSizeMm`, `conservativeDetail`; computes `eligibleSizesMm`
  (descending). Returns `{ sizeMode: 'uniform', mixedOptions: null }` for Uniform (the common,
  default case — zero extra work).
* `generateMixedSizeInfillPoints({ mode, source, mixedOptions, gapMm, baseStones })` — the core
  algorithm (steps 3-4 above). `source` is `{ kind:'vector', polygons, boundingBox }` or
  `{ kind:'field', field, placement }`, so this one function serves every vector layer type and
  Image Trace alike. Returns raw `{xMm,yMm,sizeMm}` points (no `Stone` wrapping — used directly by
  `generateTextLayout()`, which must rotate infill points through the same pivot as its primary
  points before constructing `Stone`s; see below).
* `generateMixedSizeInfillStones({ mode, source, mixedOptions, gapMm, baseStones, layerId, color,
  startIndex })` — thin wrapper around the above that returns `Stone[]`, used by every
  `generate*Layout()` except text.
* `selectNonOverlappingSizedStones(candidatePoints, baseStones, eligibleSizesMm, gapMm)` — the
  spatial-index accept/reject core (step 4), a same-layer, multi-size generalization of
  `StoneSampler.js`'s existing `dedupeStonesByRadius()` grid-hash pattern (bucket size = the
  largest diameter in play + `gapMm`, 3×3 neighbor-cell check) — same O(n) shape, explicit reuse of
  that established technique rather than a new overlap strategy.

### `src/geometry/GeometryEngine.js`

Each of the five `generate*Layout()` methods gains the same two-line addition after building its
primary `stones` array: if `options.mixedOptions` is non-null, call
`generateMixedSizeInfillStones()`/`generateMixedSizeInfillPoints()` with that layer's own
`polygons`/`boundingBox` (or `field`/`placement` for Image Trace) and concatenate the result. Their
existing normalize\*Params() functions gain the new optional params, delegated to
`normalizeMixedSizeParams()`. `resolveTextPolygons()`/`resolveShapePolygons()`/
`resolveSvgPolygons()`/`resolvePathPolygons()` (the Boolean-Operations vector-outline entry points)
are untouched — Mixed mode is a stone-generation concern only, not a shape-outline concern.

`generateTextLayout()`'s `rotateTextPoints()` helper is widened to preserve any extra fields on
each input point (`{ ...point, xMm, yMm }` instead of constructing a bare `{xMm,yMm}`), so it can
rotate a combined primary+infill point list (each carrying its own `sizeMm`) through one shared
pivot in a single call — required so infill stones rotate around the exact same center primary
stones do, not a second, independently-computed bounding-box center. This is a behavior-preserving
widening: existing callers' points carry no extra fields, so output is unchanged for them.

### `src/export/ProductionSheetExporter.js`

`computeProductionSheetLayout()` gains a `sizeBreakdown` field: an array of
`{ colorName, sizeMm, sizeLabel, count }` groups (grouped by color, then by size within each color,
both ascending, matching the brief's worked example), plus the existing `stoneCount`/
`distinctSizesMm`/`distinctColors` fields (unchanged — existing consumers, including
`tools/test-production-sheet-exporter.mjs`, keep reading them). The header's existing single
"Stone size: ..." line is unchanged (still the overall distinct-size list); `sizeBreakdown` is
additionally rendered as extra header body lines, **one line per color** (not one line per size),
e.g. `Blue: SS6 (2 mm): 142, SS10 (2.8 mm): 1856, SS16 (4 mm): 48` — both SVG and PDF render the
one shared `headerLines` the layout descriptor already computes, no second grouping/rendering
implementation. One line per color is a deliberate space-budget choice, not just a formatting
preference: `computeHeaderHeightMm()`'s pre-existing "no scaling — hard requirement" policy means
every extra header line narrows which page sizes/margins a sheet still fits (`resolvePageOrientation()`
throws rather than shrink content), and a project with several crystal colors already in use (fully
possible before this milestone, via ordinary per-layer color choice, independent of Mixed mode) must
not need materially more page room just because this grouping feature now exists. A one-line-per-
size format was tried first and reverted after it broke two pre-existing, previously-just-fitting
`tools/test-production-sheet-exporter.mjs` fixtures (multi-color and multi-layer-type layouts) —
confirming this was a real, not hypothetical, backward-compatibility risk. Grouping itself is
computed with one pass building a `Map<color, Map<size, count>>` — O(stoneCount), not O(n²).

### `app.js` / `index.html`

New optional per-layer fields (written by `writeSelectedControlsToLayer()`'s existing universal
tail, alongside `stoneSize`/`gap`/`color`, so they apply to every layer type identically):
`sizeMode` (`'uniform'|'mixed'`, resolved defensively via a new `resolveSizeMode()` mirroring
`resolveVectorFillMode()`'s "unknown/missing → safe default" pattern), `allowedSizesMm` (number
array, from the Stone Library catalog only — see UI), `minSizeMm`/`maxSizeMm` (number, nullable —
`null` defers to `normalizeMixedSizeParams()`'s own derived default), `conservativeDetail` (number
`0..1`, default `0.3`).

New shared, DOM-relocated field group (`FIELD_GROUPS.mixedSize`, following `sharedStoneFields`'s
exact pattern): a "Mixed Stone Size" section with Generation Mode (select), Allowed Sizes
(checkboxes populated from `listStoneSizes()`, mirroring `populateStoneSizeOptions()`), Minimum/
Maximum Size (selects, same catalog), Conservative Detail (range slider). Allowed Sizes/Min/Max/
Conservative Detail are only shown when Generation Mode is Mixed (progressive disclosure, matching
`#curveControls`'s existing show/hide convention). **Primary Size is not a new control** — it is
the layer's existing `#stoneSize` field (already shared/relocated); the spec brief's "Primary Size
(default)" is documented here as an explicit reuse decision, not a duplicate control.

Every new control id is added to `HISTORY_TRACKED_CONTROL_IDS` for free undo/redo, exactly like
every existing inspector control.

`GeometryEngine.generate*StonesLive()` (app.js) forward the five new fields to the permanent
engine's params exactly like `stoneSize`/`gap` already are; no other change is needed there (the
existing `.map(s=>({x:s.xMm,y:s.yMm,d:s.sizeMm,...}))` flatten already reads per-stone size).

## Compatibility Strategy

* **`sizeMode` defaults to `'uniform'`** for any layer missing the field — every project saved
  before this milestone. Uniform mode's code path is byte-identical to before this milestone (no
  new code executes; verified by a dedicated regression test comparing generated `StoneLayout`
  JSON before/after this milestone's `GeometryEngine.js` changes for a representative project).
* **No `StoneLayout`/`Stone` schema change** — nothing to migrate; old and new projects serialize
  through the exact same `toJSON()`/`fromJSON()`.
* **No `validateProject()` change required** — new fields are optional, permissively defaulted at
  every read site, matching every prior milestone's established pattern (RS-1013, TXT-102, S-112).
* **No project version bump.**
* Only Mixed mode (an explicit, opt-in per-layer choice) can ever generate different geometry than
  before this milestone.

## Manufacturing Considerations

* Every accepted infill stone is checked against every already-placed stone in its own layer at the
  true physical threshold (`sum of radii + gapMm`), not merely "not exactly on top of" — the same
  standard `dedupeStonesByRadius()` already holds cross-layer stones to.
* Cross-layer overlap prevention (`dedupeStonesByRadius()`) already reads each stone's own `d`
  irrespective of how that stone was produced (primary or infill) — no change needed there; infill
  stones are indistinguishable from primary stones once emitted, by design (one `StoneLayout`, one
  kind of `Stone`).
* Minimum/Maximum Size and Allowed Sizes are all expressed in the same plain millimeter numbers
  `stoneSize`/`Stone.sizeMm` already use — no new unit system, no new catalog format. The existing
  Stone Library (`src/renderer/StoneSizes.js`) is reused unchanged for the Allowed Sizes checkboxes
  and Min/Max selects.
* A Mixed-mode layer whose Allowed Sizes selection contains only sizes `>= primarySizeMm` (or none
  at all) is a safe no-op (falls back to Uniform output) rather than an error — an operator toggling
  Generation Mode to Mixed before configuring Allowed Sizes never sees a crash or a validation wall,
  matching this codebase's general "permissive default over hard failure" convention.

## Performance

* Primary generation is unchanged — same complexity as before this milestone.
* Infill candidate sampling reuses the existing samplers at a finer pitch — the same order of
  growth as an existing `'fill'` mode call at that finer size already has (`O(area / pitch²)` grid
  cells for vector fill modes; `O(width*height / pitch²)` for the raster field), not a new
  complexity class. `conservativeDetail` is the direct lever for this cost on very large designs.
* `selectNonOverlappingSizedStones()`'s grid-hash spatial index makes accept/reject `O(1)` amortized
  per candidate (bounded 3×3-neighborhood bucket scan, same technique as
  `dedupeStonesByRadius()`/`dedupeStonePoints()`), so the whole infill pass is `O(candidates +
  baseStones)`, not `O(n²)`.
* Production Sheet's size/color grouping is one `O(stoneCount)` pass building nested `Map`s.

## Out of Scope

* No change to `StoneLayout`/`Stone` (already sufficient, per Audit Findings).
* No change to `CanvasRenderer2D.js`, `CupRenderer.js`, `src/preview3d/**`, `src/export/SvgExporter.js`
  (already render/export any per-stone size correctly, per Audit Findings).
* No literal "replace this specific primary stone with two smaller ones" operation — see "Why
  infill, not literal stone replacement" above.
* No infill for authored-stone-font text layers or SVG open contours (documented no-ops above).
* No third generation mode beyond Uniform/Mixed in this milestone (the brief's "future generation
  modes" extensibility is satisfied by `sizeMode` being a plain enum `normalizeMixedSizeParams()`
  already gates on, the same shape `SAMPLE_MODES` already uses for fill algorithms).
* No manufacturer-exact tolerance claims — reuses the existing Stone Library's nominal diameters.
* No change to Boolean Operations' vector-outline resolution methods (`resolveTextPolygons()` etc.).

## Test Plan

New `tools/test-s200-mixed-stone-sizes.mjs` (geometry-level, `GeometryEngine` + `MixedSizeGenerator`
directly):
* Mixed-size generation across shape/text/svg/path/image layers produces stones at more than one
  distinct `sizeMm`, all drawn from the configured Allowed Sizes.
* Overlap prevention: exhaustively check every accepted stone pair (primary-primary already
  guaranteed by existing samplers; primary-infill and infill-infill newly guaranteed by this
  milestone) never violates `(a.sizeMm+b.sizeMm)/2` (physical touching).
* Minimum manufacturing spacing: same check at `(a.sizeMm+b.sizeMm)/2 + gapMm`.
* Never below user minimum: every infill stone's `sizeMm >= minSizeMm`.
* Deterministic output: two independent `generate*Layout()` calls with identical Mixed-mode params
  produce byte-identical stone lists (same order, same positions/sizes).
* Uniform-mode backward compatibility: `sizeMode:'uniform'` (and layers with no `sizeMode` at all)
  produce byte-identical `StoneLayout` JSON to the pre-milestone output for a representative
  project fixture.
* Empty-eligible-sizes no-op: Allowed Sizes all `>= primarySizeMm` (or empty) yields the same output
  as Uniform mode.
* Authored-stone-font text + Mixed mode: no-op, no throw.
* Large-layout performance smoke test: a big canvas at a small primary/eligible size completes
  within a sane wall-clock bound, confirming no `O(n²)` blowup.

New `tools/test-s200-production-sheet-grouping.mjs`:
* `sizeBreakdown` groups correctly by color then size with correct counts on a synthetic mixed
  StoneLayout; totals reconcile against `stoneCount`.
* SVG/PDF Production Sheet output still renders every stone at its own radius (already covered by
  RS-1013's own test, re-asserted here for the mixed-color/size case specifically).

New `tools/test-s200-app-integration.mjs` (source-slice execution against real `app.js`, matching
this repo's established convention):
* `resolveSizeMode()` fallback behavior.
* `writeSelectedControlsToLayer()`/`syncSelectedControlsFromLayer()` round-trip the five new fields.
* `HISTORY_TRACKED_CONTROL_IDS` includes the new control ids.
* Legacy project (no `sizeMode`/`allowedSizesMm`/etc. on any layer) loads via `validateProject()`
  without error and generates Uniform output.
* `FIELD_GROUPS` relocation includes the new Mixed Stone Size group.

Only these new/directly-related test files are run for this milestone, per this repo's testing
policy — not the full `npm test` suite (no shared architecture, project schema, or exporter
contract is being restructured, only extended additively).

## Browser Verification

Isolated Playwright profile (per this repo's established pattern — a fresh
`chromium.launchPersistentContext()` profile, app served via `python3 -m http.server`), never
touching any window named `main`/`airbnb`:

* Create a shape layer, switch Generation Mode to Mixed, select SS10+SS16 Allowed Sizes with a
  primary of SS16 — confirm smaller stones visibly appear in the 2D canvas alongside the primary
  size, with no visual overlap.
* Save the project, reload it — confirm the Mixed layer's stones are unchanged (no regeneration
  drift) and the inspector controls reflect the saved Mixed configuration.
* Export SVG — confirm the file contains circles at more than one radius.
* Export/preview Production Sheet — confirm the per-size (and per-color, if multiple colors are
  used) quantity breakdown appears and totals match the stone count.
* 3D Preview — confirm mixed sizes render at their true relative size on the object texture.
* Undo/redo across a Generation-Mode toggle and an Allowed-Sizes edit.
* Switch selection between a Mixed-mode layer and a Uniform-mode layer — confirm the inspector's
  Mixed Stone Size section shows/hides and repopulates correctly, no stale values.
* No console errors throughout.

## Results (CI follow-up, 2026-07)

A full 74-file test run on this branch reported 2 failures outside the new S-200 test files:
`tools/test-crystal-color-integration.mjs` and `tools/test-fill-algorithms-integration.mjs`. Both
were investigated in isolation before any fix was made. **Neither was a genuine geometry/behavior
regression** — `GeometryEngine`'s Uniform-mode output, per-stone `color`/`sizeMm`, stone ordering,
and stone counts were all unaffected (re-confirmed by rerunning `tools/test-s200-mixed-stone-sizes.mjs`,
which explicitly asserts Uniform-mode byte-identical output, after the fixes below). Both were
app.js **source-text-shape incompatibilities** introduced by how the S-200 UI wiring (Part 3) built
two specific object/array literals — pre-existing tests in other suites parse `app.js`'s source text
directly (this repo's established convention for testing a browser entry point under plain Node,
see `tools/test-variable-stone-sizes.mjs`'s own header comment) and made reasonable but narrower
structural assumptions about those literals than the ones S-200 produced.

### Root cause 1 — `tools/test-crystal-color-integration.mjs` test 3

**Symptom:** `SyntaxError: Unexpected token '.', ..."sizeMode",...MIXED_A"... is not valid JSON`.

**Cause:** `HISTORY_TRACKED_CONTROL_IDS` (app.js) was built with a computed spread —
`...MIXED_ALLOWED_SIZE_CHECKBOXES.map(cb=>cb.id)` — to avoid hand-duplicating the five Allowed Size
checkbox ids. `test-crystal-color-integration.mjs`'s own history-tracking check extracts this
array's source text and runs it through `JSON.parse()` after a naive `'` → `"` substitution — a
reasonable assumption for what is otherwise a flat list of quoted string literals, but one a spread
expression can never satisfy (it is valid JavaScript, not valid JSON).

**Category:** parameter-normalization/output-format side effect on an unrelated test's source-text
assumption — not a genuine S-200 regression, not an outdated test expectation (the JSON-parseable
assumption is reasonable and other code may rely on it too), not unintended Mixed-mode activation.

**Fix:** production code (`app.js`, `HISTORY_TRACKED_CONTROL_IDS`) — the five checkbox ids are now
spelled out as literal strings instead of a computed spread, restoring the array to a flat,
JSON-parseable list. This matches the codebase's own established "kept in sync by hand" convention
(the same one already used for `VECTOR_FILL_MODES` mirroring `GeometryEngine`'s `SAMPLE_MODES`) —
`MIXED_ALLOWED_SIZE_CHECKBOXES` was already a fixed, hand-maintained list, so this loses no
correctness or extensibility, only a `.map()` call. No test's expected values were weakened.

### Root cause 2 — `tools/test-fill-algorithms-integration.mjs` tests 7 and 9

**Symptom:** `assert.match` failures — the expected regex (`...color:layer\.color\};const
result=this\.permanentEngine\.generateSvgLayout` / `...generatePathLayout`) no longer matched
`app.js`.

**Cause:** these two RS-1011 tests assert that `generateSvgStonesLive()`/`generatePathStonesLive()`'s
params object literal ends immediately (`color:layer.color}`, no trailing content) before the
closing brace. S-200 Part 1/3 **intentionally** extends all five `generate*StonesLive()` params
objects with a trailing `,...mixedSizeParamsFor(layer)` spread, per this spec's own "Architecture >
app.js / index.html" section ("`GeometryEngine.generate*StonesLive()` (app.js) forward the five new
fields to the permanent engine's params exactly like `stoneSize`/`gap` already are") — this is
approved, spec-mandated forwarding behavior, confirmed structurally by this milestone's own
`tools/test-s200-app-integration.mjs` test 6. `generateShapeStonesLive`'s (test 6) and
`generateImageStonesLive`'s (test 8) regexes did not require closing-brace adjacency, so they were
unaffected; only the two tests requiring strict adjacency broke.

**Category:** test expectation demonstrably asserting a source-text detail (object-literal tail
shape) that the approved S-200 specification intentionally changed for all five call sites — not a
genuine regression, not a normalization bug, not unintended Mixed-mode activation. What each test's
name actually promises (mode resolves via `resolveVectorFillMode(layer.mode/.fillMode)`) remains
true and unchanged.

**Fix:** test expectation (`tools/test-fill-algorithms-integration.mjs` tests 7 and 9) — both
regexes gained a non-capturing optional group, `(?:,\.\.\.mixedSizeParamsFor\(layer\))?`, between
`color:layer.color` and the closing brace, so they tolerate the now-intentional trailing spread
without weakening what they actually check (mode resolution, color forwarding, and the correct
`generate*Layout` call target are still all required). Production code was not changed for this
root cause — moving the spread earlier in each params object to dodge these two regexes was
considered and rejected: `generateImageStonesLive`'s own passing regex (test 8) requires
`color:layer.color,threshold:layer.threshold` to stay adjacent, so no single reordering satisfies
all three methods' pre-existing regexes simultaneously, and contorting parameter order purely to
satisfy brittle source-text adjacency (rather than fixing the assumption that no longer holds) would
have been the "make it pass" anti-pattern this task explicitly warned against.

### Files changed

* `app.js` — `HISTORY_TRACKED_CONTROL_IDS` literal-ids fix (production code).
* `tools/test-fill-algorithms-integration.mjs` — tests 7 and 9 regex tolerance (test expectation,
  justified above).
* `tools/test-s200-app-integration.mjs` — test 8 updated for the corrected literal-id shape; two new
  regression tests added (12: `HISTORY_TRACKED_CONTROL_IDS` stays JSON-parseable; 13: the two
  `generate*StonesLive()` params objects stay compatible with
  `test-fill-algorithms-integration.mjs`'s own regexes).
* `docs/specifications/S-200-MixedStoneSizeLayouts.md` — this section.

No changes to `src/geometry/**`, `src/export/**`, or `index.html` — both root causes were isolated
to `app.js`'s UI-wiring source-text shape.

### Focused test results

* `tools/test-crystal-color-integration.mjs` — 13/13 passing.
* `tools/test-fill-algorithms-integration.mjs` — 18/18 passing.
* `tools/test-s200-mixed-stone-sizes.mjs` — 19/19 passing (Uniform-mode byte-identical output
  re-confirmed).
* `tools/test-s200-production-sheet-grouping.mjs` — 7/7 passing.
* `tools/test-s200-app-integration.mjs` — 13/13 passing (was 11; 2 new regression tests added).
* All 14 previously-verified S-200-related suites re-run clean: `test-production-sheet-exporter`,
  `test-variable-stone-sizes`, `test-fill-algorithms`, `test-geometry-engine`,
  `test-geometry-stone-overlap-cross-contour`, `test-geometry-stone-overlap-cross-layer`,
  `test-geometry-stone-overlap-same-contour`, `test-shape-library`,
  `test-shape-library-integration`, `test-shape-fit`, `test-image-pipeline`,
  `test-image-trace-regression`, `test-path-boolean`, `test-stone-size-library`,
  `test-stone-layout-texture`, `test-production-export-validation`, `test-svg-integration`,
  `test-path-boolean-integration` (18 listed; all pass).
* Full 74-file suite was not rerun per this task's scope (focused verification only); the 2
  originally-failing files plus every directly related suite are confirmed green.

## RS-2010 integration (develop merge, 2026-07-24)

`develop` advanced with RS-2010 (Physical Product Dimensions) after S-200 branched. Merging
`origin/develop` into `feature/s-200-mixed-stone-size-layouts` produced one real `app.js` conflict
and one downstream test failure, both resolved on this branch (`develop` itself was never touched;
this branch was not merged back).

### The conflict

`HISTORY_TRACKED_CONTROL_IDS` (app.js) — both milestones independently added their own new control
ids to the end of this one array literal: S-200 appended `'sizeMode','mixedAllowedSs6',...,
'conservativeDetail'`; RS-2010 appended `'vesselBodyDiameter','vesselBodyHeight',
'vesselTopDiameter'`. **Resolution:** combined both sets into one array (RS-2010's three vessel ids
placed before S-200's block, preserving each milestone's own internal ordering) — a pure union, no
semantic conflict, since the two milestones' control ids are entirely disjoint and this array is
just a flat list every listed id gets identical generic undo/redo wiring from (see the `for(const id
of HISTORY_TRACKED_CONTROL_IDS)` loop immediately below it). No other part of `app.js` conflicted:
RS-2010 never touched `validateProject()`'s per-layer S-200 fields, `mixedSizeParamsFor()`, the five
`generate*StonesLive()` call sites, `FIELD_GROUPS`, or the Mixed Stone Size sync/write code; S-200
never touched `defaultProject()`/`validateProject()`'s vessel handling, `getVesselDefaults()`,
`normalizeVesselParams()`, or `deriveLegacyVesselParams()`. Audited directly post-merge (grepping
for every S-200 symbol in the merged `app.js`) to confirm all five `mixedSizeParamsFor(layer)`
forwarding call sites, `resolveSizeMode()`, and the sync/write wiring survived the auto-merge intact
alongside RS-2010's vessel schema/UI additions.

### The test failure — `tools/test-s200-app-integration.mjs` test 11

**Symptom:** `ReferenceError: VESSEL_PRODUCT_IDS is not defined`, thrown from inside the sandboxed
`validateProject()` this test's own `new Function(...)` extraction executes.

**Cause:** RS-2010 extended `validateProject()` to also resolve `project.vessel` (via
`VESSEL_PRODUCT_IDS.includes(productId)`, `normalizeVesselParams()`, `deriveLegacyVesselParams()`,
`getVesselDefaults()` — see `docs/specifications/RS-2010-PhysicalProductDimensions.md`). Test 11's
harness (written before RS-2010 existed) only injected minimal hand-rolled fakes for
`getObjectTemplate()`/`normalizePlateParams()`, so the sandbox had no binding for these four new
free variables `validateProject()` now references.

**Category:** combined-state / cross-milestone test-fixture gap — not a genuine regression in
either milestone (RS-2010's own `tools/test-project-validation-security.mjs`, which already extracts
`validateProject()` with the real vessel functions injected, passed against the merged `app.js`
without modification, proving the merged `validateProject()` itself is correct).

**Fix:** test fixture only, no production code change. Rewrote test 11 to mirror
`tools/test-project-validation-security.mjs`'s own established extraction pattern exactly: import
the **real** `getObjectTemplate`, `getPlateDefaults`, `normalizePlateParams`, `VESSEL_PRODUCT_IDS`,
`getVesselDefaults`, `normalizeVesselParams`, `deriveLegacyVesselParams`, `computeCanvasFromVessel`
from `src/products/index.js` (and `SHAPE_LIBRARY_KINDS` from `src/geometry/index.js`) and inject
those into the sandbox, rather than hand-rolling fakes for them — this is deliberately *more*
faithful than a patch-in fake would have been, since it can never drift from the real
implementations' actual behavior. Also strengthened the test with two new combined-state assertions
(RS-2010 + S-200 must not interfere with each other): a legacy project with no `vessel` field keeps
`project.canvas` byte-unchanged, and still derives a real `project.vessel` via
`deriveLegacyVesselParams()`.

### Combined-state verification

* Every RS-2010 requirement (vessel dimensions as source of truth; `normalizeVesselParams()` for
  new/edited vessels; `deriveLegacyVesselParams()` + untouched `project.canvas` for legacy projects;
  Mug/Tumbler/Bottle/Plate dimension controls and switching) and every S-200 requirement (Uniform
  mode backward-compatible; Mixed mode only activates when explicitly selected; Mixed-size inspector
  controls wired; Mixed params reach `GeometryEngine`; Production Sheet grouping functional; existing
  color/sizeMm/order/count/fill/text/SVG behavior intact) were re-verified together, not just each
  milestone's own isolated suite — see "Test results" below.
* Isolated Playwright browser verification (fresh profile, app served locally, no window named
  `main`/`airbnb` touched) covered: Mug/Tumbler/Bottle vessel dimension fields shown and editable,
  Bottle's independently-editable Top Diameter (taper); Plate's own S-112 fields unaffected and
  vessel fields correctly hidden; Uniform mode stone generation; Mixed mode opt-in activation (a
  freshly added layer defaults to Uniform, never silently Mixed); SVG export with multiple stone
  radii; Production Sheet per-size breakdown line; reload persistence; and importing a genuine
  legacy (pre-RS-2010, no `vessel` field, current layer schema) project, confirming
  `deriveLegacyVesselParams()` runs with no throw and no console errors anywhere in the run.

### Test results

* `node tools/test-s200-app-integration.mjs` — 13/13 passing (test 11 fixed).
* Focused categories re-run clean: S-200 app integration, S-200 mixed-size generation, S-200
  Production Sheet grouping, vessel physical dimensions (`test-product-vessel-dimensions.mjs`),
  object dimensions (`test-object-dimensions.mjs`), object geometry builder
  (`test-object-geometry-builder.mjs`), fill algorithms (engine + integration), crystal color
  integration, project import/legacy compatibility (`test-project-validation-security.mjs`,
  `test-examples-regression.mjs`), object template integration, and the four architecture checks
  (`test-architecture-module-boundaries`, `test-browser-dependency-loading`,
  `test-module-graph-exports`, `test-project-model-consolidation`).
* `npm test` (default tier): **24 selected, 24 passed, 0 failed.**
* `npm run test:full`: **75 selected, 75 passed, 0 failed.**
* Zero unresolved conflicts, zero conflict markers in the working tree after resolution.
