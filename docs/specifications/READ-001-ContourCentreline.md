# READ-001 — Contour Fill: ring placement, dedupe floor, centreline collapse

Status: **Implemented** (`feature/read-001`, branched from `develop` @ `5fc122c`).

Part of the readability program — see `docs/specifications/READ-000-readability-architecture.md`,
§3 "Layer 0". Fixes three separable defects in Contour Fill (`'contour'`) that make it produce
lopsided, hollow, or mush-filled letter strokes.

---

## Background

Contour Fill does not walk analytic polygon offsets. `src/geometry/ContourRingSampler.js` builds a
chamfer distance-to-boundary field over a grid and traces iso-distance contours with marching
squares at thresholds of one stone pitch, two pitches, and so on — one loop per threshold. On a
letter stroke that single loop runs down one side of the stroke and back up the other; its two
branches converge in the middle. Nothing "collides" — but three things went wrong.

All measurements below are on 40mm-tall rectangular strokes at `spacingMm = 3.0` — the same
synthetic strokes `tools/test-read-001-contour-centreline.mjs` asserts against; before/after sweeps
were run from a throwaway script under `tools/scratch/`. "Lane" positions are the final sampled
stone x-positions (`stoneSizeMm = 2.5`) clustered in the central band; a stroke's interior lane is
either a distinct offset-ring branch at `k × spacingMm` from a boundary, or `W/2` where the
innermost ring degenerates to / a sub-2-pitch ring collapses onto the medial axis.

### Defect A — rings land short of, and shifted across, their own threshold

`chamferDistanceTransform()` seeded every *outside* node at 0, so the first inside node relaxed to a
full `cellSizeMm` when the true boundary lies somewhere in `(0, cellSizeMm)` from it;
`traceIsoDistanceContour()` placed each crossing at the cell-edge *midpoint*. The first cut fixed
the midpoint (interpolation) and the average of the seed bias (flat `cellSizeMm/2`), but a flat seed
still *translates* the ring by up to half a cell when `insideAt` reads the two boundary nodes
asymmetrically. Measured per branch — the mean (reported the first time) hid it:

| stroke W | ring | before, L / R | first cut (flat seed), L / R | this fix, final lane |
|---|---|---|---|---|
| 6mm  | k=1 (→ medial) | 2.63 / 2.63 | 2.75 / 3.00 | **2.988** (nominal 3.0) |
| 7mm  | k=1 (→ medial) | — / — | — | **3.492** (nominal 3.5) |
| 8mm  | k=1 (→ medial) | 2.50 / 2.50 | 2.875 / 3.125 | **3.996** (nominal 4.0) |
| 9mm  | k=1 (real ring) | 2.63 / 2.63 | 2.875 / 3.125 | **L 2.988 / R 3.012** (nominal 3.0) |
| 12mm | k=1 (real ring) | 2.63 / 2.63 | 2.875 / 3.125 | **L 2.988 / R 3.012** (nominal 3.0) |
| 12mm | k=2 (→ medial) | 5.63 / 5.63 | 5.875 / 6.125 | **5.988** (nominal 6.0) |

Every branch is now within ±0.012mm of nominal.

### Defect B — the dedupe floor equalled the lane spacing

`sampleContourFillPoints()` / `sampleRadialFillPoints()` deduped at the full `spacingMm` while
placing rings exactly `spacingMm` apart. A sub-pitch ring landing 0.8 of a pitch from the boundary
lane was culled wholesale by that boundary lane, which is sampled first and wins under greedy
first-come-kept. RC-002 already moved *outline* mode's floor to `stoneSizeMm` for this exact reason
(see `sampleMultiContourOutlinePoints()`); contour and radial were left behind.

Before, a 12mm stroke lost its `x = 3` lane entirely and kept `x = 9` — asymmetric, because walk
order decided which lane met the boundary lane first:

| stroke W | before lanes (x, mm) | after lanes (x, mm), `stoneSizeMm = 2.5` | min NN (mm) |
|---|---|---|---|
| 2.5mm | 2.50 (one edge only) | 1.25 (centreline) | 3.00 |
| 6mm  | 0, 3.19, 6 | 0, 2.99, 6 | 3.00 |
| 7mm  | 0, 4.31, 7 | 0, 3.49, 7 | 3.00 |
| 8mm  | 0, 8 (**hollow**) | 0, 4.00, 8 | 2.64 |
| 9mm  | 0, 6.19, 9 | 0, 2.99, 5.99, 9 | 2.90 |
| 12mm | 0, 6.1, 9.19, 12 (**4 lanes, asymmetric**) | 0, 2.99, 5.99, 8.99, 12 (5 lanes, symmetric) | 2.57 |

Every minimum nearest-neighbour distance is ≥ `stoneSizeMm` (2.5mm) — no physical overlap. The
same lanes come out of a literal 4-vertex rectangle now that `splitSliverRuns()` densifies its
input (Part C).

### Defect C — sliver loops laid doubled rows

Where the remaining stroke width drops below about two pitches, the loop's opposing branches close
up. Sampled as a closed loop, the walk goes down one branch and back the other, laying two
nearly-coincident rows that greedy dedupe then culls in arbitrary walk order — the "hollow stroke"
and "scattered strays" in the reported screenshots.

### Defect D — stroke terminals not collapsed

The centreline collapse handled the *sides* of a sub-pitch stroke but not its *ends*. The
arc-length gate needs a partner ≥ `1.5·minSeparationMm` away along the loop; a flat end spans only
≈ `w` and a semicircular cap ≈ `(π/2)·minSeparationMm`, neither of which reaches the gate, so the
terminal vertices stayed unpaired and sampled as an outline stub a half-width off the centreline —
a stone on each far corner of a 4-vertex rectangle, hanging 1.25mm outside the letter; 0.99–1.45mm
off-centre for stadium caps of `w` = 2.0–2.9mm. Lane-grouped measurement hid this (the two
singletons were dropped as noise). See "Terminal absorption" under Part C.

---

## Fix

### Part A — sub-cell-accurate ring placement (`ContourRingSampler.js`)

1. **Interpolated crossings.** `traceIsoDistanceContour()` now places each of the four cell-edge
   crossings by linear interpolation of the two node distance values —
   `frac = clamp((threshold − v1) / (v2 − v1), 0, 1)`, with a 0.5 fallback when the nodes are
   near-equal. Two cells sharing an edge interpolate from the identical node pair, so the exact-key
   segment stitching in `stitchSegmentsIntoLoops()` is unaffected. The saddle resolution in cases 5
   and 10 is unchanged.

2. **Seeding-bias correction — measured sub-cell localisation, not a flat half-cell.** A flat
   `cellSizeMm / 2` seed (the first cut) removes only the *average* of the bias; it still
   *translates* the whole ring by up to half a cell whenever `insideAt` classifies the two boundary
   nodes asymmetrically — an axis-aligned edge landing on a grid line reads the node *on* it as
   inside and the node one cell out as outside, so that side of the shape reads ~half a cell narrow.
   Per-branch that showed up as e.g. an 8mm stroke's k=1 ring at 2.875mm on the left and 3.125mm on
   the right (the mean, 3.000, hid it). Instead, for each boundary-adjacent inside node,
   `chamferDistanceTransform()` bisects `insideAt` along the axis to each outside neighbour (4
   iterations → `cellSizeMm / 16` resolution) and seeds the node at the smallest crossing distance.
   The threshold-side alternative — adding `cellSizeMm/2` to every traced threshold — stays rejected
   (it blanks the centre ring of a stroke whose half-width equals the first threshold exactly,
   because the un-inflated field never reaches the raised threshold).

   The degenerate centreline ring of an *elongated* shape (a stroke exactly N pitches wide: the
   field's discretised maximum lands a hair under N·pitch and its exact iso-contour there is a
   single ridge node) is still forced out: `computeInwardRingPolygons()` allows one cell of slop on
   the loop bound and, for a threshold above the field maximum, traces one cell *below* the maximum
   to get a ~1-cell band straddling the medial ridge that `splitSliverRuns()` collapses to the
   medial axis. `loopIsElongated()` (isoperimetric ratio > 25) drops the round degenerate blob of a
   disc or square, so no spurious one-stone centre ring appears.

3. **`CELL_SPACING_DIVISOR` stays at 8.** The residual the first cut tried to bury by raising the
   divisor to 12 was the classification asymmetry above, not a resolution shortfall — halving the
   cell halves it but never removes it, at ~2.2× the cost (measured: `computeInwardRingPolygons()`
   for r=50 / r=100 / r=140mm discs went 176 / 867 / 2388ms at divisor 8 → 381 / 1897 / 5255ms at
   divisor 12). With sub-cell localisation in place, divisor 8 puts every required stroke branch
   within ±0.012mm of nominal — finer than divisor 12 managed without it. The distance-field grid
   budget, the `ContourFillPrecisionError` ceiling, and PERF-005/006's headroom are all unchanged
   from before READ-001.

   The bisection's own cost is bounded by the boundary-adjacent node count (∝ perimeter / cell),
   not area: on the r=140mm disc it is 15,568 extra `insideAt` calls (1.6% of 970k) and ~40ms of
   the ~2.4s run.

### Part B — dedupe floor for contour and radial (`StoneSampler.js`)

`sampleContourFillPoints()`, `sampleRadialFillPoints()`, `sampleContourFieldFillPoints()` and
`sampleRadialFieldFillPoints()` take an optional `stoneSizeMm` (defaulting to `spacingMm`) and use
it as the `dedupeStonePoints()` floor. `sampleShapeFillPoints()` and `sampleFieldByMode()` thread it
through for the `'radial'` and `'contour'` cases (previously only `'outline'` read it).

Call-site audit in `src/geometry/GeometryEngine.js` — every site now passes the layer's
`stoneSizeMm`:

| line | call | before | after |
|---|---|---|---|
| ~206  | `sampleShapeFillPoints` (shape/text) | already passed | unchanged |
| ~636  | `sampleShapeFillPoints` (shape) | already passed | unchanged |
| ~835  | `sampleShapeFillPoints` (SVG fill branch) | **not passed** | now passes `options.stoneSizeMm` |
| ~1014 | `sampleFieldByMode` (image) | **not passed** | now passes `options.stoneSizeMm` |
| ~1130 | `sampleShapeFillPoints` (path) | already passed | unchanged |
| ~1325 | `sampleShapeFillPoints` (paint region) | already passed `region.stoneSizeMm` | unchanged |

No site had `stoneSizeMm` unavailable.

### Part C — collapse sliver runs to centrelines (`ContourRingSampler.js`)

New exported `splitSliverRuns(loop, minSeparationMm)`.

The loop is first **resampled** (`densifyClosedLoop()`) to a vertex spacing of at most
`minSeparationMm / 4`. Detection walks *vertices*, so a coarse polygon — a 4-vertex Rect, a Slot, a
sparse SVG path — otherwise has no eligible partner (the only far-enough vertex on a rectangle is
the 40mm-away diagonal one) and the collapse silently no-ops. A marching-squares ring is already
finer, so this is a no-op for rings. Stone spacing is untouched: `sampleContourFillPoints()`
re-walks every returned piece at the full `spacingMm`.

For each densified vertex, the nearest other vertex **at least `1.5 × minSeparationMm` away along
the loop's arc length** is found via a grid-hash spatial index; if that neighbour is within
`minSeparationMm` in a straight line, the vertex is "slivered" and contributes the pair's midpoint.
The gate is arc length, not a fraction of the vertex-index count — a fraction-of-index gate (the
first cut used 25%) leaves most of a *tall* thin loop uncollapsed, because "25% of the perimeter" is
a large slice of the height once the loop is long and narrow (an 8mm stroke's centreline came out at
x = 4.14 instead of 4.00, its rounded ends still doubled). Any two same-branch points closer than
`minSeparationMm` in a straight line are also closer in arc length, so `1.5 ×` excludes every
same-branch neighbour while still catching the opposing branch right up to each rounded end.

Contiguous slivered runs become open midpoint polylines (each pair emitted once — no doubling);
contiguous non-slivered runs stay open polylines of the densified vertices. A loop with no slivered
vertex is returned unchanged as one closed piece.

**Terminal absorption (third pass).** The arc-length gate can never be satisfied by the handful of
vertices right around a stroke end narrower than `minSeparationMm`: a flat end spans only ≈ `w` of
arc, a semicircular cap ≈ `(π/2)·minSeparationMm` (measured: 3.14 / 3.93 / 4.40 / 4.56 mm for
`w` = 2.0 / 2.5 / 2.8 / 2.9 at `minSeparationMm = 3.0`), and the unpaired run around either works
out to ≈ `minArcSepMm = 1.5·minSeparationMm` — always under `2·minSeparationMm`. Left as an outline
piece those vertices sample a half-width off the centreline (the corner of a rectangle, the shoulder
of a cap: `max |x − w/2|` was 1.25mm for the 4-vertex rectangle, 0.99–1.45mm for stadium caps).
So when **every** non-slivered run is such a short terminal, the loop is treated as one open medial
path: each slivered run contributes its pair midpoints once (the first run to reach a pair consumes
both members, and a "partner already consumed" check mops up the non-mutual nearest-neighbour pairs
a narrow cap creates, so the mirror-image return run contributes nothing and the tip stays a true
polyline endpoint rather than a mid-sequence spike), and each terminal contributes one point at its
arc-length midpoint. The runs' emissions, concatenated in walk order, form a cyclic point list with
exactly one oversized gap — where a run emitted nothing and the walk jumped from the near end of the
stroke to the far end. Cutting the cycle at that gap yields a single tip-to-tip open centreline.
A loop that also has a genuine wide non-slivered region keeps the per-run split (slivered → centreline
pieces, wide → outline pieces).

`sampleContourFillPoints()` computes the inward rings first (so a pathological shape/pitch throws
`ContourFillPrecisionError` before the boundary is densified), then runs every boundary contour
**and** every traced ring through `splitSliverRuns()` (`minSeparationMm = spacingMm`) before
sampling. `sampleContourFieldFillPoints()` does the same for its rings. Collapsing the *boundary*
contour is what centres the sub-pitch stroke (W = 2.5mm → single lane at x = 1.25, whether the input
is a dense contour or a literal 4-vertex rectangle). Scope is contour mode only — outline mode's
sampling path is untouched (verified: `sampleShapeFillPoints('outline', …)` on a multi-contour
glyph-like polygon returns the identical count and identical first/last points).

---

## Closed-shape regression

A circle of `r = 15mm` at `spacingMm = 3.0`:

| | before | after (`stoneSizeMm = 2.5`) | after (`stoneSizeMm = spacingMm`) |
|---|---|---|---|
| rings | 6 (incl. a spurious 1-stone centre at r ≈ 0.2) | 5 | 5 |
| ring radii | 0.19, 3.31, 6.38, 9.26, 12.29, 15.00 | 3.11, 6.13, 9.11, 12.09, 15.00 | ≈ 3, 6, 9, 12, 15 |
| total stones | 53 | **94** | 44 |
| min NN (mm) | — | 2.68 | ≥ 3.0 |

With a real gap (the production path — `GeometryEngine` always passes `stoneSizeMm`) the new floor
keeps materially more stones, all ≥ `stoneSizeMm` apart. The zero-gap `stoneSizeMm == spacingMm`
count drops from 53 to 44: the Defect-A bias correction pulls the inner rings to their correct
(smaller-circumference) radii and `loopIsElongated()` drops the spurious centre stone — the fix
working as intended, not a regression. Five concentric rings, monotonically decreasing radius, both
ways.

## Example-fixture baselines

Two committed fixtures use `contour`/`radial` fill and move (`examples/baselines.json` regenerated;
no other fixture changes):

| fixture | pre-READ-001 | READ-001 (all passes) |
|---|---|---|
| `mixed-fill-styles-and-sizes.rhs` (radial rect + contour circle) | 1168 | **1534** (deterministic) |
| `image-trace-monogram.rhs` (contour image) | 196 | **274** (± ~2, see below) |

The large jump from pre-READ-001 is Part B (the dedupe floor dropping from the gap-inclusive pitch
to `stoneSizeMm` keeps legitimately non-overlapping stones); the localised seed, arc-length gate and
terminal collapse then shift a handful of ring/centreline positions.

`mixed-fill-styles-and-sizes.rhs` is vector-only and regenerates to exactly 1534 every run;
`test-examples-regression.mjs` exact-checks it (it moved with Part B and has held at 1534 through the
second and third passes — its contour circle has no stroke terminal). `image-trace-monogram.rhs` has
an `image` layer, so the regression suite deliberately does **not** exact-check its stone count
(image-layer fixtures are excluded — the raster PNG→density-field decode through headless Chrome
carries run-batch variance of ≈ ±2). Its committed baseline is regenerated best-effort; the terminal
collapse does affect it (each traced glyph-stroke centreline now runs tip-to-tip, and the layout's
`x`-extent *tightens*, `maxXmm` 118.46 → 116.88mm, as the off-centre terminal stubs that used to hang
outside the glyph are gone), but the exact +N cannot be separated from the decoder noise.
