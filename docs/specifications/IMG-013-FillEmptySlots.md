# IMG-013 — Fill Empty Slots

Implemented (`src/geometry/GapFill.js`, `GeometryEngine.js` wiring, `app.js`,
`tools/test-img-013-fill-empty-slots.mjs`). Build-time product-change override to decision 1 below:
there is no toggle button and no Studio control — see "Implementation override" under decision 1.

## Objective

Add an optional per-layer gap-fill pass for image layers: after a layer's normal layout runs,
place small (SS6, 2.0 mm) filler stones into the remaining gaps between already-placed stones of
that same layer, without touching the primary stones.

## Product decisions (given, not open for redesign)

1. A toggle button at the bottom of the Image → Strass Lightbox (`#lightboxImageTrace`), labelled
   "Fill empty slots", shows on/off state. It sets a new per-layer image field (`fillGaps`, boolean,
   default `false`/absent). Saved projects without the field regenerate byte-identically.

   **Implementation override:** shipped with no button and no Studio control at all. `fillGaps` is
   set once, programmatically, by the `importImageFile` new-layer factory (`app.js`'s
   `el('importImageFile').addEventListener('change',...)` handler) — every newly imported image
   layer gets `fillGaps:true`; there is no UI to turn it off per-layer. The field's own contract
   (permissive boolean, `false`/absent default, byte-identical regeneration for every layer saved
   before this milestone) is unchanged. This drops Task B's Studio-sync (site 2) and Studio-readback
   (site 3) sites, the `#imgColorReset`-button pattern recommendation under site 3, and
   Task E's caching recommendation (no cache shipped this milestone) — struck through in place
   below rather than deleted, so the reuse-audit trail stays intact.
2. When on, generation runs a gap-fill pass after the layer's normal layout: candidate positions are
   points touching two existing stones of that layer (the circle-circle intersection at distance
   `r_a+r+gap` and `r_b+r+gap`); a stone is placed wherever it fits against every existing and newly
   placed stone of that layer with the layer's gap. Repeat until no candidate fits.
3. Filler stones are always SS6, 2.0 mm, regardless of the layer's stone size, and use the layer's
   gap.
4. A filler stone's centre must lie inside the layer's subject area (the same mask the layer's
   layout used), and the whole stone must lie inside the layer's placement rectangle.
5. Filler colour: for a multi-colour layer, the colour the existing pipeline would assign to a stone
   at that point (cluster at that pixel, then colorMap override, then catalog id); for a
   single-colour layer, the layer colour.
6. The pass only considers stones of the same layer; other layers are ignored, as today.

Field name chosen for this spec: **`fillGaps`** (boolean). Chosen to match the existing boolean
per-layer field naming convention (`invert`, `autoFit`, `closed`), not a string enum like
`maskMode`/`transparent`, since there are only two states.

Filler size constant chosen for this spec: **`GAP_FILL_STONE_SIZE_MM = 2.0`** (matches catalog id
`ss6`, `src/renderer/StoneSizes.js:38`), defined next to `MixedSizeGenerator.js`'s own
`DEFAULT_CONSERVATIVE_DETAIL` precedent (`src/geometry/MixedSizeGenerator.js:23`).

## Open conflicts

None found. All six product decisions are implementable against the code as it exists at this tip
(commit `827b70d`, branch `feature/img-013-fill-empty-slots` off `develop`); see Task A/B/C below for
the file:line evidence.

---

## A. Reuse audit

Four existing systems were named as candidates, plus a general search for spatial-index reuse.

### 1. S-200 Mixed Stone-Size infill (`src/geometry/MixedSizeGenerator.js`)

`generateMixedSizeInfillPoints()` (`MixedSizeGenerator.js:253-266`) already does "additive infill
into gaps the primary pitch left uncovered" for image layers — GeometryEngine.js:1299-1318 calls it
from inside `generateImageLayout()`, right after the primary stones are built and before
`return new StoneLayout(...)`. Its candidate generation is **not** reusable as-is: it samples
candidates from `sampleFieldByMode()`/`sampleShapeFillPoints()` at a uniform pitch derived from the
smallest eligible size (`infillPitchMm()`, `MixedSizeGenerator.js:156-159`) — a density-field/grid
resample of the whole shape, not "points touching two existing stones." Decision 2 requires the
latter (pairwise circle-circle intersections), which no sampler in this codebase produces (see item
5 below).

Its accept/reject core, `selectNonOverlappingSizedStones()` (`MixedSizeGenerator.js:179-233`), **is**
directly reusable with a parameter: it is a grid-hash bucket scan (bucket size = largest diameter in
play + gap, 3×3-neighbourhood, `(a.sizeMm+b.sizeMm)/2 + gapMm` per-pair threshold) that walks a list
of candidate points in order and greedily accepts the first size from a caller-supplied,
descending-sorted `eligibleSizesMm` list that does not overlap any already-placed stone (primary or
already-accepted infill). Calling it with `eligibleSizesMm: [GAP_FILL_STONE_SIZE_MM]` (a single
entry) reduces it to exactly decision 2/3's "one fixed filler size, fits against everything placed so
far" rule — no source change to `MixedSizeGenerator.js` needed, just a new call from wherever the
gap-fill pass lives. Its per-pair `(a.sizeMm+b.sizeMm)/2` averaging is also the right generalisation
when the filler (2.0 mm) differs from the layer's own primary/S-200-infill stone sizes.

**Verdict: candidate generation not reusable (different algorithm); `selectNonOverlappingSizedStones()` reusable with a parameter (`eligibleSizesMm: [2.0]`).**

### 2. IMG-005 `nudgeOrDropStonePoints()` (`src/geometry/StoneSampler.js:399-...`)

Same grid-hash-bucket shape as item 1, but a different contract: it takes an already-generated point
list and, for each candidate, either accepts it (clear of a single scalar floor
`stoneSizeMm + gapMm`), nudges it directly away from the single nearest violating point to exactly
that floor and re-validates, or drops it. Two things make it the wrong fit here:

- It assumes one `stoneSizeMm` for every point in the call (the floor is a single scalar, not
  `MixedSizeGenerator.js`'s per-pair `(a.d+b.d)/2`), so it cannot correctly test a fixed 2.0 mm filler
  against a layer whose primary/S-200 stones may be a different size — exactly the case decision 3
  requires.
- It is a repair pass over points a sampler already produced (called from
  `sampleRadialFieldFillPoints()`/`sampleContourFieldFillPoints()`, `StoneSampler.js:1940,1998`), not
  a candidate generator or a general accept/reject-into-an-existing-set primitive.

**Verdict: not reusable, not even with a parameter — `selectNonOverlappingSizedStones()` (item 1) is the correct tool for the same "same grid-hash technique" job, because it already generalizes per-pair sizes.**

### 3. `ContourRingSampler.js`

Computes inward-eroded concentric contour rings for Contour Fill mode via a distance-field
transform + marching-squares trace (`computeInwardRingPolygons()`, `ContourRingSampler.js:716`). This
answers a different question ("what does the shape look like eroded by N mm") than decision 2 asks
("where do two specific existing stones' offset circles cross"). There is no code path from a
distance-field ring trace to a pairwise touching-point list.

**Verdict: not reusable, not even with a parameter.**

### 4. `PathBoolean.js`

Combines two shape *sources* (Union/Subtract/Intersect/Exclude) into new polygon contours via a
shared-grid raster-and-retrace (`combineShapeSources()`, `PathBoolean.js:215`). Unrelated to
per-stone-pair candidate generation or overlap testing; it operates on shapes, not point sets.

**Verdict: not reusable.**

### 5. Existing spatial grid / neighbour-lookup for stone collision checks

Grepped for every accept/reject or dedup pass over stone points in `src/geometry/`:

| Function | Location | Technique | Same-layer only? | Multi-size? |
|---|---|---|---|---|
| `dedupeStonePoints()` | `StoneSampler.js:333` | grid-hash, single radius | n/a (pre-Stone) | no |
| `nudgeOrDropStonePoints()` | `StoneSampler.js:399` | grid-hash, single floor + nudge | n/a (pre-Stone) | no |
| `dedupeStonesByRadius()` | `StoneSampler.js:515` | grid-hash, `(a.d+b.d)/2`, **skips same-layerId pairs** | inverse of what's needed (cross-layer only) | yes |
| `dropOverlappingSizedStones()` | `StoneSampler.js:583` | grid-hash, `(a.sizeMm+b.sizeMm)/2`, no gap term, all pairs | yes | yes |
| `findCrossGroupCollisions()` | `StoneSampler.js:645` | grid-hash query (non-destructive), cross-layer only | inverse | yes |
| `selectNonOverlappingSizedStones()` | `MixedSizeGenerator.js:179` | grid-hash, `(a.sizeMm+b.sizeMm)/2+gapMm`, all pairs, caller-supplied size list | yes | yes |

Every one of these is the identical "grid bucket sized to the largest diameter in play, 3×3
neighbourhood scan" idiom, six near-duplicate implementations of the same technique for six slightly
different contracts. `selectNonOverlappingSizedStones()` is the only one whose contract already
matches decision 2/3 exactly (same-layer, gap-inclusive, per-pair size-aware, caller-supplied
candidate list) — see item 1's verdict.

No general-purpose reusable spatial-grid *class* exists (e.g. no `SpatialHashGrid.js`) — each caller
inlines its own `Map`-based bucket grid. A new gap-fill pass reusing
`selectNonOverlappingSizedStones()` follows this file's existing precedent rather than departing from
it.

**Candidate generation itself (decision 2's circle-circle intersection) has no existing
counterpart anywhere in `src/`.** The only near-hit is `ShapeLibrary.js:189`'s
`createCrescentNaturalContours()`, which uses circle-circle intersection geometry to build one fixed,
equal-radius, origin-relative crescent shape for the shape library — not a general two-arbitrary-circle
intersection helper. This is new, standard geometry (~15 lines): given two circles of radii `Ra`,
`Rb` at distance `d`, the two intersection points are

```
a  = (Ra² − Rb² + d²) / (2d)
h  = sqrt(Ra² − a²)
```
projected along and perpendicular to the line between centres. No source in the repo needs to change
for this; it is a small new pure function, most naturally placed in `MixedSizeGenerator.js` next to
`selectNonOverlappingSizedStones()` (or a new sibling module, since it is conceptually a candidate
*generator* for the same accept/reject core, matching that file's own "generator function feeds the
accept/reject core" internal shape at lines 253-266).

---

## B. Wiring inventory

The `fillGaps` field is a per-layer image field. Six sites were named, plus history-tracking and
`validateProject()`.

| # | Site | file:line | Field must reach it? |
|---|---|---|---|
| 1 | `generateImageStonesLive()` params object | `app.js:1089` | **Yes** |
| 2 | ~~Studio sync (control ← layer)~~ | ~~`app.js:6344` (`renderImageStudio()`)~~ | **No (implementation override: no Studio control shipped)** |
| 3 | ~~Studio readback (layer ← control)~~ | ~~`app.js:2720` (`writeSelectedControlsToLayer()`)~~ | **No (implementation override: no Studio control shipped)** |
| 4 | `resolveLayerShapeSource()` image branch | `app.js:3311-3317` | **No** |
| 5 | `resolveImageExportRegions()` params object | `app.js:3331-3342` | **No** |
| 6 | `GeometryEngine.normalizeImageParams()` | `src/geometry/GeometryEngine.js:2409-2504` | **Yes** |
| 6a | — hand-written forward in `generateImageLayout()` | `src/geometry/GeometryEngine.js:1189-1321` | **Yes** (this is where the pass itself runs) |
| 6b | — hand-written forward in `resolveImagePolygons()` | `src/geometry/GeometryEngine.js:1342-1385` | **No** |

### Site-by-site detail

**1. `generateImageStonesLive()` — `app.js:1089`.** Single-line function; builds a `params` object
forwarded to `engine.generateImageLayout(params)`, listing every image-layer field
(`threshold`, `invert`, `maskMode`, `colorMap`, `...mixedSizeParamsFor(layer)`, etc.) by hand. Needs
one more entry: `fillGaps:Boolean(layer.fillGaps)`.

**2/3. Studio sync and readback — not implemented.** Implementation override (see decision 1): this
milestone ships no Studio control and no toggle button, so there is nothing for `renderImageStudio()`
or `writeSelectedControlsToLayer()` to sync or read back. `fillGaps` is set exactly once, at import
time, by the `importImageFile` new-layer factory, and is otherwise a plain, permissive per-layer
field with no UI path to change it. The analysis originally here (an `#imgColorReset`-pattern
dedicated `onclick` recommendation) is moot under the override.
`writeSelectedControlsToLayer()`. Listed as a site here because the task named it as one of the six,
but under this recommendation it does not actually need a new line.

**4. `resolveLayerShapeSource()` image branch — `app.js:3311-3317`.** Builds a `field` (via
`prepareImageField()`) and returns `{kind:'field', field, xMm, yMm, widthMm, heightMm}` for Boolean
Operations — a shape *source*, never stones. `fillGaps` only affects which stones get generated, not
the traced silhouette. Confirmed by precedent: S-200's `mixedOptions` (which also only affects
stones) is never referenced by this branch either.

**5. `resolveImageExportRegions()` — `app.js:3331-3342`.** Builds a `params` object passed to
`permanentEngine.resolveImagePolygons(params)` for the Vector-first SVG export's silhouette regions —
again, no stones. Its own doc comment (`app.js:3325-3329`) says the params object duplicates
`generateImageStonesLive()`'s field-shaping keys "on purpose... the field these regions are traced
from must be the exact field the stones were sampled from" — it is about the *field* (mask), not the
stone list, and `resolveImagePolygons()` itself proves the point (see 6b below): it accepts `mode` and
`mixedOptions` (via `normalizeImageParams()`) and explicitly ignores both
(`GeometryEngine.js:1336`: `"mode is accepted... and ignored"`). `fillGaps` would be ignored there
the same way. (That comment's own `app.js:1018` citation for `generateImageStonesLive()` is itself
stale — it is at `app.js:1089` as of this tip — a pre-existing drift, not something this spec
introduces.)

**6. `GeometryEngine.normalizeImageParams()` — `GeometryEngine.js:2409-2504`.** The single
params-normalizing function both `generateImageLayout()` and `resolveImagePolygons()` call. Needs one
more line in its returned object. The established precedent for a new boolean-ish image param is
"read-site permissive default, no `validateProject()` change" — see `edgeThinning`
(`GeometryEngine.js:2493`), `brightnessThinning` (`GeometryEngine.js:2499`), and the block comment at
`GeometryEngine.js:2483-2486` ("no `validateProject()` change, no project version bump. Invalid
values... fall back to..."). `fillGaps` should follow this exactly:
`fillGaps: Boolean(params.fillGaps)` — never throws, defaults falsy, satisfies decision 1's "Saved
projects without the field regenerate byte-identically" outright.

**6a. `generateImageLayout()` — `GeometryEngine.js:1189-1321`.** This is where the pass itself must
run. The natural insertion point is immediately after the existing S-200 infill block
(`GeometryEngine.js:1293-1318`, which already does "additive pass over the same density field,
`baseStones: stones`") and before `return new StoneLayout(...)` at line 1320 — i.e., gap-fill runs
last, against the combined primary+S-200-infill stone set, exactly matching decision 2's "existing
and newly placed stones of that layer" (S-200 infill counts as "existing" from gap-fill's point of
view). The same `colorAt(xMm,yMm)` closure already built at `GeometryEngine.js:1251-1256` is reused
unchanged for filler colour (see Task C).

**As implemented:** landed exactly as described, immediately after the S-200 block and gated on
`options.fillGaps`, calling the new `generateGapFillStones()` (`src/geometry/GapFill.js`) with an
`isInside` closure built from `StoneSampler.js`'s `fieldPixelOn()` (exported for this purpose) and
the same `colorAt`/`placement` already in scope.

**6b. `resolveImagePolygons()` — `GeometryEngine.js:1342-1385`.** Produces silhouette contours, never
stones (`"produces no Stone/StoneLayout"`, `GeometryEngine.js:1329`). Confirmed no forwarding needed —
same reasoning as site 5, and it already demonstrates the "accepted via `normalizeImageParams()`,
ignored here" pattern for `mode`.

### History-tracking list

`HISTORY_TRACKED_CONTROL_IDS`, `app.js:4941` (array). Moot under the implementation override (no
toggle button, no control id) — nothing to add here.

### `validateProject()` — `app.js:1175-1234`

No new check needed. The function's own stated convention, at the comment immediately above the
image-layer checks (`app.js:1197-1200`): *"'invert' is a plain boolean UI toggle, not strictly
validated here, matching this function's existing permissive style for other boolean-ish fields."*
`fillGaps` is the same shape as `invert` — permissive, coerced at the read site
(`Boolean(layer.fillGaps)` in `normalizeImageParams()`), no `validateProject()` addition, no project
schema version bump.

---

## C. Colour lookup

Decision 5's rule — "cluster at that pixel, then colorMap override, then catalog id" for a
multi-colour layer, else the layer colour — is **already computed, today, by the exact closure
`generateImageLayout()` builds for its own primary stones**:

```js
// GeometryEngine.js:1250-1256
const labeled = options.colorCount > 1 && field.labels !== null;
const colorAt = (xMm, yMm) => {
  if (!labeled) return options.color;
  const label = fieldLabelAt(field, placement, xMm, yMm);
  if (label === NO_LABEL) return options.color;
  return imageRegionColorId(options, field, label);
};
```

`imageRegionColorId()` (`GeometryEngine.js:2399-2402`) is the single colour-resolution rule already
factored out of this closure specifically so stones and IMG-008's exported regions cannot drift
(`GeometryEngine.js:2395-2398`):

```js
function imageRegionColorId(options, field, label) {
  const group = field.colorGroups[label];      // cluster at that pixel
  return options.colorMap[group.nearestId] ?? group.nearestId;   // colorMap override, else catalog id
}
```

This is a literal three-line match for decision 5's three steps: `fieldLabelAt()` finds the cluster
label at the pixel under `(xMm, yMm)`; `imageRegionColorId()` looks up that cluster's catalog
`nearestId` and applies the layer's `colorMap` override if present; `!labeled` (single-colour layer,
`colorCount<=1` or an unquantized field) falls back to `options.color`, the plain layer colour.

The gap-fill pass (6a above) runs inside the same `generateImageLayout()` call, after `colorAt` is
already constructed and already in scope — it calls `colorAt(fillerStone.xMm, fillerStone.yMm)` for
each accepted filler stone, exactly as the existing S-200 infill block already does one line above it
(`GeometryEngine.js:1313`: `color:colorAt(point.xMm,point.yMm)`). No new colour-resolution code is
needed; filler stones get colours by the identical rule primary and S-200-infill stones already use,
not a new one.

---

## D. Measured (not reasoned)

Prototyped in a scratch script (not committed), calling the real, unmodified
`createGeometryEngine().generateImageLayout()` for "stones before," then running a standalone
prototype of the decision-2/3/4/5 gap-fill pass — circle-circle intersection candidate generation +
`selectNonOverlappingSizedStones()`-style grid-hash accept/reject (single filler size,
gap-inclusive) — against the real engine's own stone output and the real field it was sampled from
(rebuilt via the real, unmodified `prepareImageField()`).

**Fixture:** synthetic 400×400 px raster, a filled black disc (radius 46% of the frame) on white,
placed at 130×130 mm, `stoneSizeMm: 2.0`, `gapMm: 0.3`, `colorCount: 4` (4-entry synthetic RGB
palette). `butterfly2_original.jpeg` was searched for across the repository working tree
(`find . -iname "*butterfly2*"`) and is **not present** — skipped per the task's own instruction.

```
=== IMG-013 gap-fill prototype measurements ===
mode=fill       stoneSize=2 filler=2 | before=2121 added=2  passes=2 candidatesTried=46576 acceptFraction=0.0000 timeMs=87.5 sampleColors=["p-red","p-red"]
mode=staggered  stoneSize=2 filler=2 | before=2447 added=0  passes=1 candidatesTried=41376 acceptFraction=0.0000 timeMs=58.2 sampleColors=[]
mode=organic    stoneSize=2 filler=2 | before=1402 added=40 passes=2 candidatesTried=20032 acceptFraction=0.0020 timeMs=38.4 sampleColors=["p-red","p-red","p-red","p-red","p-red"]
--- stoneSize 2.8mm, 2.0mm fillers ---
mode=fill       stoneSize=2.8 filler=2 | before=1168 added=14 passes=2 candidatesTried=18028 acceptFraction=0.0008 timeMs=33.4 sampleColors=["p-red","p-red","p-red","p-red","p-red"]
```

Observations, literal:

- At stone size = filler size (2.0/2.0), Fill mode (the densest hex-packed mode) is already so tight
  that almost no circle-circle candidate clears the mask/overlap/rect gates: 2 stones added out of
  2121, from 46,576 candidate points tried (an acceptance fraction of 0.00004, rounds to 0.0000 at 4
  decimal places). Staggered mode added 0. Organic mode (randomized placement, real gaps by
  construction) added 40 from 20,032 candidates (0.0020 acceptance).
- At stone size 2.8 mm with a 2.0 mm filler (the case the task calls out specifically), Fill mode's
  primary pitch is now measurably coarser than the filler, so real gaps open up: 14 stones added out
  of 1168 base stones, 18,028 candidates tried.
- All four runs completed in 33–88 ms, entirely below the ~100 ms threshold Task E asks about.
- The pass needed only 2 passes (rarely more than one round of newly-placed stones opening further
  candidate pairs) at this fixture's scale in every case that added anything at all.

**Caveat on generality:** this fixture is a single, uniformly-toned disc (no interior texture), so
every filler stone in the sample resolves to the same colour cluster (`"p-red"` repeated) — expected
for this fixture, not a defect; it demonstrates `colorAt()` executes successfully for filler
positions, not colour diversity. It also has only one contour (no holes, no disjoint regions), so it
under-represents how many gap sites a busier production image (holes, thin necks, disjoint colour
regions) would expose. The stone counts (1100–2450) are a realistic mid-range image-layer scale for
this constants set, but a full-canvas image at the largest supported placement with a small stone
size could run several times larger — see Task E.

---

## E. Performance decision

At the measured scale (1100–2450 base stones), the full gap-fill pass costs 33–88 ms — under the
~100 ms line this task asks about, so no caching is strictly required to hit that bar at this
fixture's size. Two things argue for caching anyway rather than treating this as closed:

1. The algorithm is inherently super-linear in the base stone count within a pass (every pair of
   stones within reach is a candidate check; the measured runs already show
   `candidatesTried` growing with `before`), and a larger placement / smaller stone size / smaller gap
   than this fixture used would push well past 2450 base stones. `docs/BACKLOG.md:50-56`'s own IMG-006/
   IMG-009 performance notes for this same image pipeline (quantization: "+312ms at 1000×1000,
   +218ms at 2000x2000, +575ms at 4000×4000") establish that this pipeline's costs do scale
   meaningfully with working resolution/complexity in production use, not just in a small synthetic
   fixture.
2. `generateImageLayout()` (and therefore any gap-fill pass wired into it, per site 6a) runs on every
   `updateAll()` — which `HISTORY_TRACKED_CONTROL_IDS`' `input` listener
   (`app.js:4942`) fires on every drag tick of a slider like `#imgThreshold`, not just on commit. A
   pass that is cheap once can still add up when re-run tens of times per second while dragging.

**Recommendation (superseded):** the analysis above argued for an `app.js`-side
`imageFillGapsCache`, mirroring `imageColorFieldCache`. **Implementation override: no cache shipped
in this milestone**, by explicit product-change instruction, not because point 2's concern went
away — `fillGaps:true` is now the permanent default for every imported image layer (decision 1's
override), so `generateImageLayout()` still re-runs the gap-fill pass on every `updateAll()` a
drag-tick fires for such a layer, same as before. The measured cost (33-88ms at this fixture's scale
in Task D; ~40-70ms at ~2,250-2,450 base stones measured again at implementation time, item 15's own
number) clears the ~100ms bar this task gates on without a cache, so nothing broke by shipping
without one, but the drag-repeat cost this section flagged is real and un-mitigated. Revisit this
caching recommendation if UI-latency during a slider drag on a gap-filled image layer turns out to be
noticeable in practice.

---

## F. Test plan — `tools/test-img-013-fill-empty-slots.mjs`

**As implemented:** items 1-11 below match this section as written. Item 12 does not hand-copy
`generateImageStonesLive()`'s params expression (the IMG-009 lesson: a copy can drift) — it extracts
the real method source from `app.js` via a brace-balanced slice and executes it with `new Function()`
against a real engine and stubbed caches/helpers, asserting the `fillGaps:true` layer's stones are a
strict superset of the `fillGaps:false` layer's. Item 13's literals are STEP 0's own (captured on
this branch's actual pristine tip, commit `d1cfca0`, not `827b70d` — this spec had one more commit
land on top of it before build started), inlined directly rather than loaded from a saved-project
JSON fixture. Item 14 (new) pins the `importImageFile` factory literal's `fillGaps:true`. Item 15
(new) is the performance gate.

1. **Off by default, byte-identical.** `normalizeImageParams({...literal params, no fillGaps field})`
   resolves `fillGaps:false`; `generateImageLayout()` with `fillGaps` omitted produces the identical
   stone array (same length, same `xMm`/`yMm`/`sizeMm`/`color` in the same order) as before this
   milestone — pin against literal stone-count/coordinate values captured on this pristine tip
   (commit `827b70d`) before any IMG-013 code lands, per the task's own instruction.
2. **On, adds only smaller stones.** With `fillGaps:true` on a fixture with a known, deliberately
   coarse primary pitch (e.g. this spec's stoneSize 2.8/filler 2.0 case), every added stone has
   `sizeMm === GAP_FILL_STONE_SIZE_MM (2.0)`, and the pre-existing stones are present unchanged
   (same length, same values) as a prefix/subset of the output — gap-fill is strictly additive per
   decision 2's "never removes/resizes/moves," mirroring how
   `tools/test-mono-012-single-chain.mjs`-style / S-200's own test suite already assert additivity for
   `generateMixedSizeInfillStones()`.
3. **Known gap count fixture.** A small, hand-constructed synthetic field (few enough base stones to
   reason about by hand — e.g. two rows of primary stones spaced to leave exactly N
   circle-circle-reachable triangular gaps) where the pass must add **exactly** N filler stones — not
   "at least N" or "roughly N." This is the one test that actually exercises the circle-circle
   intersection math end-to-end against a predictable geometric answer.
4. **No overlap, pairwise.** Every filler stone, checked against every other filler stone and every
   pre-existing stone of the same layer, satisfies `distance >= (sizeA+sizeB)/2 + gapMm` — an
   O(n²) pairwise check over the small fixtures in tests 2/3 (not the large Task D fixture), the same
   brute-force-verification style `tools/test-img-006-brightness-sizes.mjs`'s
   `assignedPoints()`/engine cross-check already uses to independently verify a
   grid-hash-accepted result.
5. **No centre outside the mask.** Every filler stone's centre passes the same on-field test
   (`fieldPixelOn()`-equivalent) the fixture's own field would answer, checked against the field
   independently reconstructed via `prepareImageField()` with the fixture's own literal params — not
   trusted from the pass's own internal state.
6. **Whole stone inside the placement rectangle.** Every filler stone's centre is at least
   `GAP_FILL_STONE_SIZE_MM/2` from every edge of `[xMm, xMm+widthMm] × [yMm, yMm+heightMm]` — a
   fixture with a mask that extends to the placement rectangle's edge (so the constraint is actually
   exercised, not vacuously true because the mask already stays well clear of the boundary).
7. **Filler colour, decision 5, multi-colour.** A fixture with `colorCount > 1` and no `colorMap`
   override: every filler stone's `color` equals `imageRegionColorId()`'s catalog `nearestId` for the
   cluster at its own centre pixel — cross-checked directly against `fieldLabelAt()` +
   `imageRegionColorId()` called independently (mirroring test 4's "verify against the real exported
   primitives, not the pass's own internals" pattern already established by
   `tools/test-img-006-brightness-sizes.mjs`'s `assignedPoints()`).
8. **Filler colour, decision 5, colorMap override.** Same fixture, with a `colorMap` entry overriding
   one cluster's `nearestId`: filler stones whose centre falls in that cluster carry the *overridden*
   id, not the catalog default — this is the step decision 5 explicitly calls out ("colorMap override")
   and the one most likely to be silently skipped by an implementation that copies `options.color`
   instead of calling the real `colorAt()` closure.
9. **Filler colour, decision 5, single-colour layer.** `colorCount <= 1` (or omitted): every filler
   stone's `color` equals the layer's own `options.color`, exactly like every primary stone.
10. **Other layers ignored (decision 6).** A two-image-layer project where layer B's stones sit close
    enough to layer A's that a naive cross-layer grid query would find "gaps," but `fillGaps` is on
    only for layer A: layer B contributes zero candidate stones and zero filler stones to layer A's
    pass, and vice versa when only B has it on — mirroring how `dedupeStonesByRadius()`
    (`StoneSampler.js:515`) deliberately skips same-`layerId` pairs for the opposite reason (it is
    cross-layer-only); this test is the inverse assertion.
11. **Repeat-until-no-candidate-fits terminates and is idempotent.** Running the pass a second time
    against its own first-pass output (base stones = primary + first-pass filler stones) adds zero
    further stones — the pass is a true fixed point, not merely "stops because it ran out of passes."
12. **Engine-level behavioural test that the field reaches `generateImageLayout()` through `app.js`'s
    real forwarding** (the IMG-009 lesson: a source-text/grep guard alone is not sufficient — see
    `tools/test-img-009-subject-mask.mjs`'s own item 9, which is exactly such a guard and is
    explicitly paired with, not a substitute for, behavioural coverage elsewhere in that suite).
    Concretely: hand-copy the real params-object-building expression out of
    `generateImageStonesLive()` (`app.js:1089`) into the test file verbatim — the same "mirrored, not
    imported... hand-copied verbatim from `app.js`" convention this repo already uses for testing
    `app.js` logic without a DOM (`tools/test-mono-012-single-chain.mjs:159`,
    `tools/test-alignment-snapping-wiring.mjs:380`; this repo's stated convention is no DOM/jsdom
    testing of `app.js`, `tools/test-shapes-design-consolidation.mjs:8`) — construct a real `layer`
    object with `fillGaps:true` vs. `fillGaps:false`/absent, run each through that copied expression
    into a real `engine.generateImageLayout(params)` call, and assert the resulting stone counts
    differ (or, more precisely, that the `true` case is a strict superset of the `false` case). A
    companion source-text guard (mirroring `test-img-009-subject-mask.mjs`'s item 9) should also pin
    the exact six call sites from Task B by stable substring, but only as a second layer on top of
    this behavioural test, not instead of it.
13. **Byte identity of saved projects with the field absent.** Load a project JSON captured on this
    pristine tip (before any IMG-013 code exists) that has no `fillGaps` field on any layer; assert
    the regenerated `StoneLayout` for every image layer is byte-identical (same stone count, same
    `xMm`/`yMm`/`sizeMm`/`color` values in the same order) to a reference captured from this same
    pristine tip — the literal before/after comparison the task's own instruction asks for, not a
    freshly-generated "looks the same" check.

---

## Summary of file:line changes (as implemented)

- `src/geometry/GapFill.js` (new module) — `generateGapFillStones()` (circle-circle intersection
  candidate generation, round-based iteration per decision 2, `selectNonOverlappingSizedStones()`
  reused unchanged for accept/reject) and `GAP_FILL_STONE_SIZE_MM = 2.0`.
- `src/geometry/StoneSampler.js` — exported `fieldPixelOn()` (was module-private) so `GapFill.js`'s
  mask test (decision 4) reuses the exact on-field check every sampler in this module already uses.
- `src/geometry/GeometryEngine.js:2409-2504` (`normalizeImageParams()`) — added `fillGaps:
  Boolean(params.fillGaps)`, read-site permissive default.
- `src/geometry/GeometryEngine.js:1189-1321` (`generateImageLayout()`) — invokes the gap-fill pass
  after the existing S-200 infill block, reusing `colorAt()` for filler colour and a new
  `fieldPixelOn()`-based `isInside` closure for the mask test.
- `app.js:1089` (`generateImageStonesLive()`) — forwards `fillGaps:Boolean(layer.fillGaps)` into the
  engine params object.
- `app.js` (`importImageFile` new-layer factory) — new image layers default to `fillGaps:true`
  (decision 1's implementation override: no button, no Studio control).
- No changes to: `app.js:3311-3317` (`resolveLayerShapeSource()`), `app.js:3331-3342`
  (`resolveImageExportRegions()`), `GeometryEngine.js:1342-1385` (`resolveImagePolygons()`),
  `HISTORY_TRACKED_CONTROL_IDS` (`app.js:4941`), `validateProject()` (`app.js:1175-1234`),
  `renderImageStudio()`, `writeSelectedControlsToLayer()`, `index.html` — matching the table in
  Task B above.
