# IMG-010 — Line Design

SPEC ONLY. No changes to `app.js`, `index.html`, `src/`, or `tools/` in this step. Reference:
`docs/prototypes/line_design_prototype_v2.py` (Python/numpy/scipy/scikit-image) — a reference
algorithm, not code to port line-by-line. Audited and measured against branch
`feature/img-010-line-design`, tip `64bb20f` (= `develop` at spec time).

## Objective

A new image fill mode, "Line design": a filled subject is traced as an outline chain plus
skeleton-derived line chains at SS6 (2.0mm), the remaining interior filled with SS10 (2.8mm) rings,
and the existing IMG-013 gap-fill pass runs last to pocket the leftover space with SS6 fillers — the
first genuinely mixed-size image fill mode built from three concurrently-generated stone
populations, not from S-200's own single-primary-plus-additive-infill shape.

## Product decisions (given, not open for redesign)

1. A new value on `#imageFillMode`, "Line design". Whether it becomes the default for new imports is
   decided after this spec's measurements, not now (Task D's numbers below).
2. Stones: outline chain and line chains at SS6 (2.0mm); fill rings at SS10 (2.8mm); then the
   existing IMG-013 gap-fill pass (`src/geometry/GapFill.js`, SS6) fills the pockets — mixed sizes.
3. Saved projects regenerate byte-identically; nothing changes for existing fill modes.

Pipeline, from the prototype:

- **(a)** Enclosed transparent pockets inside the subject are filled and their colour inpainted from
  the nearest opaque pixel.
- **(b)** Per-pixel catalog label by CIE76 over the catalog, dropping colours under 1.2% share.
- **(c)** Outline chain: a contour one stone radius inside the silhouette edge, smoothed, stones
  placed by chord distance.
- **(d)** Line chains: the jet-labelled mask closed with a disk whose RADIUS is 0.6 stone diameters
  (**implementation correction, D1**: the prototype's own `disk(0.6*2*rl)` -- `rl` the chain radius --
  passes a RADIUS argument, so the closing disk's radius is `0.6 * chainDiameterMm` = 1.2mm at SS6, not
  the 0.3mm a `0.6 stone diameters` reading as an overall-size-requiring-a-halving would give; this
  spec's own earlier wording was ambiguous between the two and is corrected here, not just in the
  implementation -- see Task D's "Antennae bridging (D1)" section below for the re-measured numbers
  this correction changes), clipped to the silhouette dilated by half a stone radius, skeletonized,
  restricted to thin structures (half-width ≤ 0.85 stone diameters), components under 1.2 stone
  diameters dropped whole, each path smoothed and stones placed by chord distance.
- **(e)** Fill rings: distance transform of the free space left by the chains, contours at stone
  radius + k·pitch, walked one pixel at a time placing a stone wherever it fits.
- **(f)** Pocket pass: `generateGapFillStones()` (IMG-013), unmodified.
- **(g)** Colour per stone: modal catalog label under 80% of the stone's radius.

Known failures, not to be repeated (design constraints, not merely prototype history): chain spacing
by arc length while overlap uses straight-line distance rejects every other stone on bends (space by
chord distance); advancing-front "touch two existing stones" packing jams at ~0.59 coverage; an
axis-aligned hex lattice collides with chains at every angle; overfill-then-relax loses stones; fill
rings on the whole silhouette instead of the free space collide with chains; fixed-position ring
sampling at exactly one pitch fails on floating-point noise (walk and slide); chaining the centre-line
of every dark area chops wings into pockets too small for anything.

**Prototype caveat, not an open conflict:** `line_design_prototype_v2.py`'s `build()` contains *two*
fill-ring techniques — `# 3a.` (distance-transform contour rings, walked and accept/reject-placed —
this is decision (e)) and `# 3b.` (a "touch two existing stones" advancing-front heap, `push_from()`)
— both folded into the same `n_fill`/`'fill'` kind. **3b is the already-rejected advancing-front
technique** from the known-failures list above, left in the file as dead code from an earlier
iteration. Only 3a is in scope; Task D's port and measurements below implement 3a only. An
implementer reading the prototype literally could port 3b by mistake — flagged here explicitly so
that doesn't happen.

## Naming and constants (this spec's choices, not yet in code)

- Mode value: **`'line-design'`** (kebab-case, matching the existing single-word raster mode values'
  convention closely enough while staying unambiguous against `'radial'`/`'contour'`/etc.).
- New constants, mirroring `GapFill.js`'s `GAP_FILL_STONE_SIZE_MM` precedent (a fixed size regardless
  of the layer's own `stoneSizeMm`): `LINE_DESIGN_CHAIN_STONE_SIZE_MM = 2.0` (SS6),
  `LINE_DESIGN_FILL_STONE_SIZE_MM = 2.8` (SS10) — both nominal diameters from
  `src/renderer/StoneSizes.js:38-39` (`ss6`/`ss10`).

## Architecture decision: bypass `sampleFieldByMode()` for this mode

`GeometryEngine.generateImageLayout()` (`src/geometry/GeometryEngine.js:1190-1339`) calls
`sampleFieldByMode(options.mode, field, placement, spacingMm, sampleStoneSizeMm, {...})`
(`GeometryEngine.js:1235`, dispatching into `StoneSampler.js:2132-2143`'s switch) exactly once, and
that call returns a flat `Point2D[]` at **one** stone size for the whole mode. Every existing mode
fits that contract; Line design does not — it is inherently two concurrently-placed populations
(SS6 chains, SS10 rings) from three different candidate-generation algorithms (contour offset,
skeleton trace, distance-field ring walk), not one uniform sampler at one pitch.

The existing precedent for "a mode whose stones don't come from one `sampleFieldByMode()` call" is
`isBrightness` (`GeometryEngine.js:1218-1221,1259-1292`): it still calls `sampleFieldByMode()` for
candidate *positions*, then assigns each point a size from `fieldLuminanceAt()` outside that call.
Line design goes one step further and needs its own **candidate generation**, not just its own sizing
of an existing sampler's output — so it should skip the `points = sampleFieldByMode(...)` call
(`GeometryEngine.js:1235`) entirely under a new top-level branch, parallel to (not nested inside) the
`isBrightness` branch, calling one new function (proposed `src/geometry/LineDesignSampler.js`, a
private-to-`GeometryEngine.js` module with the same relationship `GapFill.js`/`MixedSizeGenerator.js`/
`ContourRingSampler.js` already have — never a second `GeometryEngine`, never a second `StoneLayout`
producer, per this repo's forbidden-changes list) that returns `{xMm,yMm,sizeMm,kind}[]` directly,
mapped straight to `Stone` instances the same way the `isBrightness` branch already does at
`GeometryEngine.js:1275-1282`.

**Consequence for Task C's wiring table below:** `StoneSampler.js:2132-2143`'s switch does **not**
need a `'line-design'` case (the mode never reaches it) — only `IMAGE_SAMPLE_MODES`/
`IMAGE_FILL_MODES`/`SUPPORTED_IMAGE_FILL_MODES` (so `normalizeImageParams()` accepts the value instead
of throwing) and the new top-level branch in `generateImageLayout()` itself.

**S-200 Mixed Stone Size interaction (design note, not a blocking conflict):** `options.mixedOptions`
(`GeometryEngine.js:1300-1319`) is mode-agnostic — if left wired through, a layer with Mixed Stone Size
turned on *and* `'line-design'` selected would run S-200's own additive infill on top of an already
two-size layout, which decisions (b)-(e) don't anticipate and Task D never measured. Recommend the
Studio gate Mixed Stone Size's own eligibility control off for `'line-design'`, the same way other
mode-conditional Studio controls already disable (Task C, site 7) — a UI-only decision, no geometry
change, deferred to the implementation step since it wasn't asked for here.

## Open conflicts

None found. All three product decisions and the seven pipeline steps are implementable against the
code as it exists at this tip; see Task A/B/C/D below for the file:line evidence.

---

## A. Reuse audit

Ten building blocks were named. Distance-transform/contour-ring machinery, the subject mask, CIE76
colour math, and the gap-fill pass are all reusable; chord-distance resampling, path smoothing,
general skeletonization, connected-component labelling (full, not largest-only), and disk-shaped
morphology are missing and need new code — each is small, standard, and none duplicates an existing
geometry engine.

| # | Building block | Verdict | Citation |
|---|---|---|---|
| 1 | Euclidean distance transform | Reusable with a parameter | `ContourRingSampler.js:157-228` `chamferDistanceTransform()` (private) |
| 2 | Skeletonization / thinning | Missing (general case) | `ContourRingSampler.js:457-700` `splitSliverRuns()` solves a related, narrower problem only |
| 3 | Contour/isoline extraction | Reusable as-is (ring walk) / with parameter (single threshold) | `ContourRingSampler.js:716-770` `computeInwardRingPolygons()`; `:272` `traceIsoDistanceContour()` (private); `PathBoolean.js:301-358` (binary sibling, unrelated use) |
| 4 | Path smoothing | Missing | No moving-average/spline/fillet utility anywhere in `src/geometry/**` or `src/image/**`; `PathBoolean.js:435-465` `simplifyContour()` only reduces vertex count |
| 5 | Chord-distance resampling | Missing | `src/geometry/lineStampSpacing.js:26-47` and `StoneSampler.js:47-109` (`sampleOutlinePoints()`) are both arc-length; `StoneSampler.js:916-928`'s own RC-004A comment documents this exact bug class |
| 6 | Connected-component labelling | Reusable with a parameter (largest-only today) | `SubjectMask.js:57-94` `largestConnectedComponent()`; `StoneSampler.js:1529-1531`'s own comment calls general raster CC labelling "out of scope" |
| 7 | Morphological close/dilate (disk) | Missing (disk); reusable with a parameter (square, via max-filter) | `Edge.js:62-76` `maxFilter()` (private, square window, no matching min-filter for close) |
| 8 | Subject/silhouette mask (IMG-009) | Reusable as-is | `SubjectMask.js:104-134` `computeSubjectMask()` |
| 9 | CIE76 labelling against a fixed catalog | Reusable as-is (primitives); missing as a direct per-pixel composition | `ColorSpace.js:36,50` `rgbToLab()`/`cie76Distance()`; `ColorQuantize.js:201-233` `assignNearestIds()` labels k-means *clusters*, not pixels, directly |
| 10 | `GapFill.js` final pass | Reusable as-is | `GapFill.js:151-186` `generateGapFillStones()` |

### Detail

**1. Distance transform.** `buildDistanceField(insideAt, boundingBox, spacingMm)`
(`ContourRingSampler.js:106-137`) calls `chamferDistanceTransform()` — a standard two-pass chamfer
(orthogonal `cellSizeMm`, diagonal `cellSizeMm·√2`) with a READ-001 sub-cell boundary correction
(bisecting `insideAt` at each boundary-adjacent cell, `chamferDistanceTransform()`'s own
`localiseBoundaryMm()`). It's generic in `insideAt`, but private and bound to this module's own
`MIN/MAX_CELL_SIZE_MM`/`MAX_GRID_CELLS_BUDGET` constants, and its sub-cell seeding assumes a
continuous predicate it can bisect — a raw pixel mask has no such predicate at sub-pixel resolution.
Reusable for decisions (c)/(e) by exporting it or adding a raw-grid entry point; no second DT
implementation should be written.

**2. Skeletonization.** No Zhang-Suen/medial-axis/thinning implementation exists over a 2D raster
mask anywhere in `src/`. `splitSliverRuns()` collapses a single already-traced **vector loop**'s
pinched sides to a centreline (2-terminal open, 3+-terminal branching, and mixed cases) — real
prior art for "one ring's own degenerate centreline," not for skeletonizing an arbitrary multi-branch
ink mask. Decision (d) needs the latter: new code, most naturally a standard thinning pass over the
closed dark mask.

**3. Contour/isoline extraction.** `computeInwardRingPolygons()` already implements "distance field →
one iso-contour ring per pitch step from `startOffsetMm` to the field max" — almost exactly decision
(e)'s shape. `sampleContourFieldFillPoints()` (`StoneSampler.js:1970-2004`) is the existing full
worked example of turning those rings into stones (rings → `splitSliverRuns()` → `sampleOutlinePoints()`
→ `nudgeOrDropStonePoints()`), but its resample step is arc-length (item 5) and its accept/reject step
is a single-size repair pass, not decision (e)'s "wherever it fits against everything already placed"
walk — so the ring *extraction* is reusable as-is (call with `insideAt` = free space left by the
chains, `startOffsetMm` = fill radius), but the *placement* step needs decision (e)'s own accept/reject
walk (see item 5/10), not `sampleContourFieldFillPoints()`'s full pipeline verbatim.

**4. Path smoothing.** Confirmed nowhere in the codebase — `ContourGeometry.js`'s
`detectPolygonCornerFlags()` classifies corners for spacing purposes, it never rounds or averages a
polyline's actual shape, and `Blur.js` is raster-only. A small moving-average smoother (the
prototype's own `smooth()`, a boxcar convolution with edge padding) is standard and new — no existing
geometry primitive is close enough to reuse or extend.

**5. Chord-distance resampling.** Every existing path-placement primitive — `lineStampSpacing.js`'s
`placeStonesAlongPath()` (Paper.js `getPointAt(t)`, arc length), `StoneSampler.js`'s
`sampleOutlinePoints()`/`sampleCornerAnchoredOutlinePoints()` — walks by arc length. Chord distance
appears today only as a post-hoc dedupe/backfill check (`findEquidistantBackfillPoint()`,
`dedupeStonePoints()`), never as the primary placement rule, and `StoneSampler.js:916-928`'s own
comment documents arc-length-adjacent samples going below the physical chord threshold on curved
geometry as a recognized defect class — exactly what decisions (c)/(d) call out avoiding. New: walk
forward from the last **placed** point until straight-line distance reaches the target spacing, not
arc length.

**6. Connected-component labelling.** `largestConnectedComponent()` (`SubjectMask.js:57-94`) is a
proven BFS-flood-fill template (`Int32Array` labels, explicit queue, no recursion) but explicitly
keeps only the winner (line 84-93: rebuilds a mask of the single largest label). Decision (d) needs
every skeleton component's own length, to drop whichever are under 1.2 stone diameters — the same BFS
core generalizes trivially (stop discarding losers, return `{labels, sizes}`), but that generalization
doesn't exist yet.

**7. Morphological close/dilate.** No dilate/erode/close with a disk (or any) structuring element
exists. `Edge.js`'s `maxFilter()` is a separable square max-filter (monotonic-deque sliding window) —
literally a square dilation if run on a 0/1 mask, but square, not disk, and there's no matching
min-filter for the erosion half of a "close." The distance transform (item 1) can produce an exact
disk dilation for free (`distance < radius` after inverting inside/outside) — the more faithful reuse
for decision (d)'s 0.6-diameter closing disk and the silhouette's half-radius dilation, once the DT is
exposed for raw grids.

**8. Subject mask.** `computeSubjectMask(imageBuffer, {toleranceDe})` (`SubjectMask.js:104-134`) is
exactly what decision (a) needs as its input silhouette — alpha route when real transparency is
present, CIE76-background route otherwise, already reduced to the largest 4-connected component.
Reusable as-is, unmodified, exactly as `prepareImageField({maskMode:'subject'})` already wires it in
for other modes.

**9. CIE76 labelling.** `rgbToLab()`/`cie76Distance()` (`ColorSpace.js:36,50`) are genuine CIE76 (Lab
Euclidean distance) and are the correct, already-reused-elsewhere primitives for decision (b) — no
colour-math reimplementation warranted. What's missing is the *composition*: today's only
catalog-nearest-id resolution (`assignNearestIds()`, `ColorQuantize.js:201-233`) runs once per
k-means **cluster** (≤8 of them, from `quantizeColors()`'s median-cut+k-means reduction), not once per
pixel directly against the (up to 17-entry) catalog. Decision (b) is the simpler, direct form — loop
pixels, `cie76Distance()` against every catalog entry, argmin, no clustering step — a new ~15-line
composition of two already-reusable primitives, not a new algorithm. **The catalog itself needs no
new data**: the prototype's 17-entry `PALETTE` dict is a byte-identical hex match, id-for-id, to
`src/renderer/CrystalColors.js`'s production `CRYSTAL_COLORS` catalog (verified against all 17
entries) — decision (b)/(g) should read `CRYSTAL_COLORS[i].fill` directly rather than hand-copying a
second palette.

**10. `GapFill.js`.** `generateGapFillStones({baseStones, gapMm, isInside, placement, colorAt,
layerId, startIndex})` (`GapFill.js:151-186`) is deliberately agnostic to how `baseStones` were
produced — it only needs positions and sizes. Decision (f) is "call it unchanged with
`baseStones` = outline ∪ line ∪ fill stones," exactly the same relationship IMG-013 already has to
every other image mode's primary+S-200 stones. No change to `GapFill.js` itself.

---

## B. Colour rule

Decision (g)'s modal-label-under-80%-radius rule was measured against the existing single-point
`colorAt()`/`fieldLabelAt()`/`imageRegionColorId()` lookup (`GeometryEngine.js:1252-1256,2417-2422`),
on every outline+line+fill stone (pocket-pass stones excluded) from Task D's fixture, at both widths,
and again under synthetic per-channel colour noise to emulate a photographic (not flat-vector) source.

```
TASK B -- decision (g) modal (80% radius patch) vs existing single-point colorAt()
outline + line + fill stones only (pocket pass excluded)

                                   130 mm        180 mm
stones compared                       543          1025
differ                                  0             2   (0.00% / 0.20%)
  outline                             0/137         0/192
  line                                 0/70          1/98
  fill                                0/336         1/735
transitions (point -> modal)           --      topaz->jet 1, jet->sapphire 1
distance of every DIFFERING stone to nearest colour-zone boundary: 0.00 px (all of them)
cost over the whole stone set
  modal rule                       1.034 ms      6.008 ms   (0.14% / 0.68% of the whole pipeline)
  point rule                       0.059 ms      0.096 ms

SENSITIVITY -- same fixture + deterministic per-channel colour noise, 180 mm
                              clean      +/-12      +/-30
stones compared                1025       1025       1027
differ                            2          4         98   (0.20% / 0.39% / 9.54%)
transitions at +/-30:  light-sapphire->sapphire 52, aquamarine->emerald 41,
                       jet->topaz 3, topaz->jet 1, jet->sapphire 1
surviving catalog ids
  clean/+-12   jet, sapphire, emerald, topaz
  +/-30        jet, sapphire, light-sapphire, aquamarine, emerald, topaz
               -> the two speckle shades now clear the 1.2% share floor under noise, so the
                  point-sample rule emits per-stone colour speckle; the modal vote suppresses it.
```

On this spec's flat-vector-style fixture the two rules are all but identical (0.00%/0.20%), and every
disagreement sits exactly on a colour-zone boundary pixel — the best possible case for point sampling.
Under simulated photographic noise the gap widens sharply: at ±30/channel, 9.5% of stones would get a
visibly different (and locally inconsistent, speckled) colour from the point rule that the modal rule
suppresses, because two noise-shifted shades clear the 1.2%-share floor and the point sample can land
on either indiscriminately.

**Recommendation: adopt the modal rule.** It costs ~6ms on a ~1000-stone layer (0.7% of the whole
pipeline) and is a measurable no-op on clean, vector-like source art, but it is specifically what
prevents visible per-stone colour speckle on real (photographic, JPEG-artifacted) input — cheap
insurance with no downside on the input this pipeline is actually built for.

---

## C. Wiring inventory

`'line-design'` is a new `fillMode` string value for image layers, same shape as every existing image
mode. Per the architecture decision above, it does **not** need a case in `StoneSampler.js`'s
`sampleFieldByMode()` switch — it bypasses that call entirely inside `generateImageLayout()`.

| # | Site | file:line | Diff needed |
|---|---|---|---|
| 1a | UI fill-mode allow-list | `app.js:666` (`IMAGE_FILL_MODES`) | add `'line-design'` |
| 1b | Engine fill-mode allow-list | `src/geometry/GeometryEngine.js:63` (`IMAGE_SAMPLE_MODES`) | add `'line-design'` (this is what `normalizeImageParams()` throws against, `GeometryEngine.js:2452-2454`) |
| 1c | Gallery/`.rhs` fixture allow-list | `src/gallery/RhsFixtureBridge.js:49` (`SUPPORTED_IMAGE_FILL_MODES`) | add `'line-design'` |
| 2 | `resolveImageFillMode()` (×2) | `app.js:695`; `RhsFixtureBridge.js:530-532` | none — reads the set from 1a/1c |
| 3 | `<select id="imageFillMode">` options | `index.html:1179` | add `<option value="line-design">Line Design - ...</option>` |
| 4a | Layer → UI sync | `app.js:2557` | none — generic `resolveImageFillMode(l.fillMode)` read |
| 4b | UI → Layer write-back | `app.js:2720` | none — generic write |
| 4c | New-layer default | `app.js:5399` (`fillMode:'staggered'`) | unchanged this step — decision 1 defers the default-mode question |
| 5a | Mode-string validation | `GeometryEngine.js:2452-2454` | none beyond 1b |
| 5b | `checkFixStats` gate (IMG-005) | `GeometryEngine.js:1225-1227` (`'contour'`/`'radial'` only) | none — `'line-design'` has no repair-pass equivalent, stays `null` like every other mode |
| 5c | Raster sampler dispatch | `StoneSampler.js:2132-2143` | **none** — `'line-design'` never reaches `sampleFieldByMode()` (architecture decision above) |
| 5d | New top-level branch | `GeometryEngine.js:1259` area, parallel to the `isBrightness` branch | new: `if (options.mode === 'line-design') { ... } else if (isBrightness) { ... } else { ... }`, calling the new `LineDesignSampler.js` module |
| 6 | `.rhs` fixture schema check | `RhsFixtureBridge.js:227-230` | none — reads the set from 1c |
| 7 | Studio per-mode control gating | `app.js:6371-6377` (Organic/Edge controls), `app.js:6486-6490` (IMG-005 stats text) | none required — `'line-design'` needs no seed/spread/edge controls of its own; leaves them disabled like `'fill'`/`'staggered'` do today. (Design note above: consider also gating Mixed Stone Size's eligibility control off for this mode.) |

No `validateProject()` change (`app.js:1175-1234`) — `fillMode` is already permissive there, matching
`invert`'s own documented precedent; no project schema version bump, matching every prior image-mode
milestone (IMG-002 through IMG-013).

---

## D. Measured

Ported by hand into a scratch script (not committed): exact Euclidean DT, disk morphology, hole-fill +
nearest-opaque BFS inpaint, Zhang-Suen thinning, path tracing, chord resampler, and a grid-hash
packing/accept-reject walk (decisions a/c/d/e's missing pieces per Task A). Reused unmodified from the
real engine: `computeSubjectMask()`, `createImageBuffer()`, `rgbToLab()`/`cie76Distance()`,
`computeInwardRingPolygons()`, `generateGapFillStones()`, and
`createGeometryEngine().generateImageLayout()` (for the `'staggered'` comparison). The prototype's 3b
advancing-front technique was **not** ported (see the caveat above).

`butterfly2_original.jpeg` was searched for across the working tree and is **not present** — skipped
per the task's own instruction; a synthetic fixture was used for both widths.

### Fixture (literal — inline into `tools/test-img-010-line-design.mjs` per Task E item 1)

A 640×560px RGBA specimen exercising every decision at once: a filled silhouette (body + four wing
lobes) with a one-stone-wide dark rim band, four dark veins (two axis-aligned, one diagonal, one
quadratic-Bezier curve), a wide dark blob (must fill, not chain), two antennae made of geometrically
disconnected dark dots, three colour zones plus one deliberately under-1.2%-share colour spot, and two
enclosed fully-transparent pockets.

```js
export function makeFixture() {
  const W = 640, H = 560;
  const data = new Uint8ClampedArray(W * H * 4); // transparent black everywhere by default
  const WING_LEFT = [0x2f,0x6f,0xd0], WING_RIGHT = [0x31,0xa8,0x6d], BODY = [0xe3,0x92,0x30];
  const DARK = [0x17,0x17,0x17], SPOT = [0xc5,0x1f,0x63]; // near sapphire/emerald/topaz/jet/fuchsia
  const inEllipse = (x,y,cx,cy,rx,ry) => ((x-cx)/rx)**2 + ((y-cy)/ry)**2 <= 1;
  const distToSegment = (x,y,x1,y1,x2,y2) => { /* standard point-segment distance */ };
  const blobAt = (x,y) => inEllipse(x,y,320,300,26,150)
    || inEllipse(x,y,200,230,130,110) || inEllipse(x,y,440,230,130,110)
    || inEllipse(x,y,235,400,95,95)   || inEllipse(x,y,405,400,95,95);
  const ANTENNA_L = [[320,158],[250,60]], ANTENNA_R = [[320,158],[390,60]]; // 13 disconnected dots each
  const POCKETS = [[420,250,14],[250,420,10]];       // enclosed transparent holes
  const WIDE_BLOB = [200,255,26];                     // must fill, not chain
  const CURVED_VEIN = /* quadratic Bezier [350,360]->[440,480]->[530,375], sampled to a polyline */;
  // veins: 45deg [300,290]-[180,170]; horizontal [360,300]-[520,300]; vertical [240,300]-[240,430];
  // curved: CURVED_VEIN; rim: blob eroded by one SS6 stone radius; spot: circle at [470,400] r=12
  // (under the 1.2% share floor, must be relabelled to its nearest surviving catalog colour).
  // ... pixel loop: pockets -> alpha 0 (RGB stays 0,0,0, must be inpainted); rim/veins/wideBlob/dots
  // -> DARK; spot -> SPOT; body ellipse -> BODY; else left/right of x=320 -> WING_LEFT/WING_RIGHT.
  return { widthPx: W, heightPx: H, data };
}
```

### Results

```
FIXTURE    640 x 560 px, subject route = 'alpha' (computeSubjectMask)
           silhouette after hole-fill = 143,813 px  (1,204 px = recovered enclosed pockets)
PARAMS     chains SS6 = 2.0mm (r 1.0) | fill SS10 = 2.8mm (r 1.4) | pocket pass SS6 = 2.0mm
           gapMm = 0.3 for both pipelines (Studio default)
NODE       v22.15.0, darwin 22.6.0 -- 3 runs each; stone COUNTS/coverage bit-identical across runs

=========================== 130 mm (130.00 x 113.75 mm) ===========================
silhouette area 5,933.69 mm^2
                         outline  line   fill  pocket  TOTAL  coverage    time(ms)
Line design                  137    70    336     179    722    0.5530   729.6 / 732.2 / 734.4
staggered SS10 (2.8mm)         -     -      -       -    708    0.7347   104.0 / 104.6 / 107.5
staggered SS6  (2.0mm)         -     -      -       -   1284    0.6798    78.1 /  79.5 /  79.9

=========================== 180 mm (180.00 x 157.50 mm) ===========================
silhouette area 11,375.83 mm^2
                         outline  line   fill  pocket  TOTAL  coverage    time(ms)
Line design                  192    98    735     298   1323    0.5602   880.5 / 892.3 / 905.7
staggered SS10 (2.8mm)         -     -      -       -   1357    0.7345    93.5 /  98.9 /  99.1
staggered SS6  (2.0mm)         -     -      -       -   2468    0.6816    78.4 /  78.9 /  84.8

--------------------------------- STAGE DETAIL ----------------------------------
                                              130 mm        180 mm
outline ring polygons (1st threshold only)         1             1
fill ring polygons over free space                21            25
skeleton px after half-width gate               2,466         2,476
kept skeleton components (>= 1.2 diam)              4             4
traced paths                                    1,655         1,756
  of which shorter than one chain pitch         1,621         1,720   <-- see defect below
surviving catalog ids   jet, sapphire, emerald, topaz  (same at both widths)
dropped by 1.2% floor   fuchsia @ 0.31% share -> relabelled to nearest survivor

--------------------------- QUALITATIVE OBSERVATIONS -----------------------------
ANTENNAE (bridging test)               130 mm        180 mm
  dots per antenna                          13            13
  components BEFORE closing                 13            13   (truly disconnected)
  components AFTER closing                   1             1   (both antennae bridge into one chain)

D1 RE-MEASUREMENT (implementation step, corrected 1.2mm-radius closing disk, both dot pitches the
spec used, both widths -- tools/test-img-010-line-design.mjs item 14):
                                       130 mm                    180 mm
  9px pitch  (~0.41/0.56mm gap)   before=13 after=1        before=13 after=1
  10px pitch (~0.61/0.84mm gap)   before=13 after=1        before=13 after=1
  -> all four cases bridge into exactly 1 component per antenna under the corrected 1.2mm radius.
     The earlier "0.6 stone diameters" wording (ambiguous between the disk's radius and its overall
     size) had been implemented as a 0.3mm radius, under which the spec's own original measurement
     recorded the 10px-pitch case fragmenting into 3 components at 180mm; re-measured here at the
     corrected 1.2mm radius, that same case now bridges cleanly, and the 0.3mm-radius reading is
     retired.

WIDE DARK BLOB (14.6mm dia @180mm; must fill, not chain)
  skeleton px surviving the 0.85-diameter half-width gate     0             0
  fill-ring stones landing inside it                          9            15
  chain stones landing inside it                              0             0
  -> the half-width gate correctly routes wide dark area to FILL, not chain

ENCLOSED TRANSPARENT POCKETS (1,204 px)
  stones over pockets, Line design                            4             9
  stones over pockets, staggered SS10                         0             1
  stones over pockets, staggered SS6                          0             0
  -> without decision (a), these are near-empty voids; hole-fill + nearest-opaque inpaint recovers them

DARK RIM
  produces its own skeleton loop, but nearly all its line-chain candidates are rejected -- the
  outline chain runs first and already occupies that band. Correct (no double coverage), but the
  rim itself contributes almost no line stones of its own.

ERRORS / FALLBACKS: none. computeInwardRingPolygons() and generateGapFillStones() both ran
unmodified with no exception, no ContourFillPrecisionError, no empty return.
```

### Defect found: skeleton junction fragmentation

At both widths, the kept skeleton (post half-width-gate, post component-length-drop) traces into far
more path fragments than chain stones placed (1,756 traced paths vs. 98 line stones at 180mm): 1,720
of those 1,756 fragments (98%) are shorter than one chain pitch. Cause: Zhang-Suen thinning of the
*curved* rim band leaves degree-3/4 junction pixels (measured: 332 degree-2, 80 degree-3, 8 degree-4
pixels on the curved/rim structures, vs. clean 155/157-degree-2-with-2-endpoints on the straight/
diagonal veins) — a naive edge-per-fragment trace splits at every junction, so the same kept component
degrades toward one-fragment-per-junction, and the chord resampler (which always emits a path's first
point as a candidate) turns that into near-greedy packing wherever the skeleton is junction-dense.
Measured mitigation: dropping traced fragments shorter than one chain pitch, *after* tracing and
*independent of* the component-level 1.2-diameter drop decision (d) already specifies, changes line
count 98→78 at 180mm and total 1323→1303 (−1.5%) with no other pipeline change. **Decision (d) as
written (component-level length filtering only) does not fully prevent this; recommend the
implementation add an explicit minimum traced-path length** (distinct from, and applied after, the
existing component-level filter) — noted here as a measured refinement to record, not an open
conflict, since it doesn't contradict any given decision.

**Adopted (implementation step, D2).** A traced path shorter than one chain pitch
(`LINE_DESIGN_CHAIN_STONE_SIZE_MM + gapMm`, i.e. the SS6 chain's own pitch at the layer's own gap —
2.3mm at the Studio default 0.3mm gap) is dropped whole, after tracing and independent of the
component-level `LINE_DESIGN_MIN_COMPONENT_DIAMETER_RATIO` (1.2 stone diameters) filter above. Also
found and fixed in the same implementation step: Zhang-Suen thinning can additionally leave a
several-pixel-long double-strand ("staircase") artifact along some diagonal runs, a related but
distinct defect from the isolated-2x2-block case this section otherwise describes — every
mutually-8-adjacent group of junction/endpoint pixels is clustered into one logical node before
tracing (`LineDesignSampler.js`'s `traceSkeletonPaths()`), which is what let both antennae actually
place chain stones end to end rather than fragmenting into all-sub-pitch pieces near the junction
where each meets the body.

---

## E. Test plan — `tools/test-img-010-line-design.mjs`

1. **Synthetic generator fixture, pinned as a literal.** The fixture above (`makeFixture()`), inlined
   verbatim in the test file (not loaded from a file), so every downstream assertion is against a
   fixed, reviewable pixel source — matching this repo's existing convention
   (`tools/test-img-013-fill-empty-slots.mjs`'s own hand-constructed fixtures).
2. **Chains follow their vein within a tolerance.** For each of the four veins (45°, horizontal,
   vertical, curved), every line-chain stone whose position falls within the vein's bounding region
   is within `chainStoneSizeMm/2 + toleranceMm` of the vein's true centreline (computed independently
   from the fixture's own `distToSegment()`/polyline-distance helpers, not from the pipeline's own
   skeleton) — proves the chain actually tracks the ink, not just "some stones exist nearby."
3. **No gap between consecutive same-chain stones exceeds a stated bound on bends.** Walk each traced
   chain in placement order; consecutive stones' chord distance must be `<= chainPitchMm * (1 + slop)`
   for a small stated `slop` (e.g. 0.15) — this is the test that would have caught the "arc-length
   spacing rejects every other stone on bends" failure mode by construction, run specifically on the
   curved vein's chain.
4. **Antennae dots bridge into one chain.** Both `ANTENNA_L`/`ANTENNA_R` dot runs (13 geometrically
   disconnected dots each) produce exactly one connected skeleton component and therefore one traced
   chain per antenna, not 13 isolated single-stone fragments — the literal regression case for the
   0.6-diameter closing disk / half-radius silhouette-dilation clip (decision d), cross-checked at
   both fixture widths given Task D's own measured sensitivity (bridges at 130mm, marginal by
   ~0.84mm gaps).
5. **The wide dark area fills, it does not chain.** Every stone whose centre falls inside
   `WIDE_BLOB`'s circle has `sizeMm === LINE_DESIGN_FILL_STONE_SIZE_MM` (2.8mm) — zero chain-sized
   (2.0mm) stones land there — the literal regression case for decision (d)'s 0.85-stone-diameter
   half-width gate.
6. **No pairwise overlap.** Every stone (outline, line, fill, and pocket-pass) checked against every
   other stone satisfies `distance >= (sizeA+sizeB)/2 + gapMm` — brute-force O(n²) over the fixture's
   full stone set (~1,300 stones at 180mm, well within a test's time budget), the same
   verify-against-the-real-output style `tools/test-img-006-brightness-sizes.mjs` already uses.
7. **Enclosed pockets are filled and correctly coloured, not jet.** Every stone whose centre falls
   inside either of `POCKETS`'s two circles has a `color` matching its surrounding zone's catalog id
   (`sapphire`/`emerald`/`jet` per which pocket, from the fixture's own known geometry), never the raw
   `RGB(0,0,0)`-implied `'jet'` a missing inpaint step would produce — the literal regression case for
   decision (a).
8. **Under-threshold colour is dropped and relabelled.** The `SPOT` colour zone (fuchsia, ~0.3% share
   on this fixture, confirmed under the 1.2% floor in Task D) contributes **zero** stones whose
   `color === 'fuchsia'`; every stone that would have sampled it instead carries its geometrically
   nearest surviving catalog id — the literal regression case for decision (b)'s share-drop-and-
   relabel rule.
9. **Modal colour, not point-sample.** A fixture region straddling a colour-zone boundary (reuse
   Task B's boundary-adjacent stones) resolves to the *majority* colour under 80% of the stone's
   radius, verified independently against a direct per-pixel re-scan of that patch — not merely "some
   colour was assigned."
10. **Fixed-size stones regardless of layer `stoneSizeMm`.** Running the fixture through
    `generateImageLayout({mode:'line-design', stoneSizeMm: <any other value>, ...})` produces the
    identical stone set (same positions, same `LINE_DESIGN_CHAIN_STONE_SIZE_MM`/
    `LINE_DESIGN_FILL_STONE_SIZE_MM` sizes) as the layer's own `stoneSizeMm` is varied — proving the
    mode ignores the layer's stone-size control entirely, the same fixed-size contract
    `GAP_FILL_STONE_SIZE_MM` already establishes for the pocket pass.
11. **Byte identity for every existing mode, against literals measured on this pristine tip.**
    `generateImageLayout()` with `mode: 'fill'|'staggered'|'radial'|'contour'|'organic'|'edge'` on a
    small fixed fixture produces stone arrays (same length, same `xMm`/`yMm`/`sizeMm`/`color` in the
    same order) matching literal values captured on this tip (`64bb20f`) *before* any IMG-010 code
    lands — decision 3's byte-identity guarantee, pinned the same way `tools/test-img-013-fill-empty-
    slots.mjs`'s own item 13 pins its pre-existing-mode literals.
12. **Engine-level test that the mode value reaches `generateImageLayout()` through `app.js`'s real
    code.** Hand-copy the real params-object-building expression out of `generateImageStonesLive()`
    (`app.js:1089`) into the test file verbatim (this repo's established "mirrored, not imported"
    convention for testing `app.js` logic without a DOM — `tools/test-mono-012-single-chain.mjs:159`,
    `tools/test-img-013-fill-empty-slots.mjs`'s own item 12), construct a real `layer` object with
    `fillMode:'line-design'`, run it through that copied expression into a real
    `engine.generateImageLayout(params)` call, and assert the result contains outline/line/fill/pocket
    stones (not the plain-`'fill'` fallback `normalizeImageParams()` would silently produce if the
    mode string were ever dropped along the way) — a companion source-text guard pinning the exact
    wiring sites from Task C by stable substring is a second layer on top of this, never a substitute
    for it (the IMG-009 lesson, restated in IMG-013's own test plan).
13. **Performance gate.** The whole pipeline (subject mask → inpaint → label → outline → lines → fill
    rings → `generateGapFillStones()` → modal colour) completes in under a stated bound (e.g. 1500ms)
    on the 180mm fixture — Task D measured 880-906ms; a generous multiple of that guards against a
    silent complexity regression without being flaky on slower CI hardware.

---

## Summary

Everything above is a spec; nothing in `app.js`, `index.html`, `src/`, or `tools/` changed in this
step. For the implementation step: one new module (`src/geometry/LineDesignSampler.js`) housing the
five genuinely-missing pieces from Task A (pocket-fill + nearest-opaque inpaint, direct per-pixel CIE76
catalog labelling reusing `CRYSTAL_COLORS`/`cie76Distance()`, disk-based close/dilate reusing an
exported distance transform, skeletonization + component-length + traced-path-length filtering, and a
chord-distance placement/accept-reject walk), reusing `computeSubjectMask()`, `computeInwardRingPolygons()`,
and `generateGapFillStones()` unchanged; one new top-level branch in `generateImageLayout()` (parallel
to `isBrightness`, per the architecture decision above); and the three-site mode-value wiring plus one
new `<option>` from Task C's table. No `validateProject()` change, no project schema version bump.
