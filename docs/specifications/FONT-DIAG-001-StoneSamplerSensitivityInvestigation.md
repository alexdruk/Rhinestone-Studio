# FONT-DIAG-001 -- StoneSampler Sensitivity Investigation

Status: **Investigation complete.** Engineering investigation only -- no application behavior
changed, no Sacramento optimization attempted, no calibration engine built. One temporary
diagnostic script was written and kept (`tools/font-diag-001/pipeline-trace.mjs`) because it
proved generally useful, per this milestone's own instrumentation policy.

---

## 1. Problem Statement

FONT-CAL-001 (`docs/specifications/FONT-CAL-001-SacramentoCalibrationPilot.md`) tested whether
targeted outline modification of Sacramento's "m", "n", and "v" glyphs could reduce SS30
`clusterCount` fragmentation (a stroke that should read as one connected line breaking into
visually separate pieces once stones get large enough, with zero actual stone collisions or
isolated stones). The technique tested was a single-vertex "cusp widening" push, applied to each
glyph's sharpest same-contour direction reversal, at deltas from 70 to 300 font units.

Findings that motivate this investigation:

- **m** and **n**: zero `clusterCount` sensitivity across the full delta range -- only visible
  glyph distortion increased (up to +34.5% bounding-box height at delta 300).
- **v**: one delta (150) improved SS30 `clusterCount` but simultaneously regressed the SS6
  control from 1 to 2 clusters -- disqualified.
- Increasing text height (via `validate.mjs --height-override`, unmodified Sacramento) fully
  resolved fragmentation for all three glyphs, but only beyond SS30's currently-committed
  106-111mm production height range.

FONT-CAL-001 could not explain *why* the outline modifications were ineffective; that is this
milestone's sole objective.

---

## 2. Pipeline Analysis

Traced by reading (not modifying) `src/text/OpenTypeProvider.js`, `src/geometry/ContourGeometry.js`,
`src/geometry/GeometryEngine.js`, and `src/geometry/StoneSampler.js`, and by adding read-only
instrumentation (`tools/font-diag-001/pipeline-trace.mjs`) around the exact exported functions the
real pipeline calls.

The text pipeline, in call order, for an unmodified/modified TTF at a given height:

1. **Font loading + glyph command extraction** -- `OpenTypeProvider.getTextPath()`
   (`src/text/OpenTypeProvider.js:171-219`). `unitsToMm = heightMm / font.unitsPerEm`
   (line 183); every glyph coordinate opentype.js emits (`glyph.getPath(x, y, heightMm)`, line 202)
   is already scaled by this single factor. **This is a uniform linear scale of the entire glyph**,
   not a resize applied later -- confirmed directly: raw contour point counts and coordinates
   scale exactly with `heightMm` in the instrumentation output (Section 3).

2. **Contour construction** -- `convertGlyphCommandsToVectorPath()` (`OpenTypeProvider.js:52-94`)
   converts opentype.js path commands 1:1 into `Contour` moveTo/lineTo/quadraticTo/cubicTo/closePath
   commands. No simplification, no point dropping.

3. **Contour flattening** -- `flattenContourToPolygon()` (`src/geometry/ContourGeometry.js:30-73`).
   `CURVE_FLATTEN_SEGMENTS = 16` is a **fixed subdivision count per Bezier curve, not adaptive to
   curve length or curvature** (line 18's own comment: chosen for deterministic output, not
   tolerance-based simplification). A single-vertex outline edit moves a curve's on-curve endpoint,
   which is a direct input to this subdivision -- the edit is fully preserved into the flattened
   polygon at this stage, confirmed empirically (Section 3: raw sample counts change measurably and
   monotonically with delta).

4. **Point sampling** -- `sampleOutlinePoints()` (`src/geometry/StoneSampler.js:24-71`) walks each
   contour's flattened polygon at fixed `spacingMm` **arc-length** intervals, independent of local
   curvature. This stage does not discard geometric information either -- it repositions candidate
   points along arc length, and an edit that changes local perimeter length shifts every downstream
   sample's arc-length position by a corresponding (small, local) phase shift.

5. **Same-contour dedup pruning (RC-004A)** -- `dedupeStonePoints()`
   (`StoneSampler.js:160-199`), invoked by `sampleMultiContourOutlinePoints()`
   (`StoneSampler.js:381-384`) with `minSeparationMm = stoneSizeMm` (passed from
   `GeometryEngine.generateTextLayout()`, `GeometryEngine.js:192-193`:
   `spacingMm = stoneSizeMm + gapMm`, dedup floor = `stoneSizeMm` alone, not `spacingMm`). This
   drops any later-scanned sample whose **straight-line (chord) distance** to an already-kept
   sample is below `stoneSizeMm` -- regardless of *why* the two arc-length-spaced samples ended up
   spatially close (curvature, cusp, or otherwise). **This is the stage where geometric detail
   becomes insignificant**: the function only ever reads point-to-point Euclidean distance; it has
   no concept of corner angle, curvature, stroke width, or cusp sharpness. Any outline change that
   does not shift a pruned pair's chord distance across the `stoneSizeMm` floor has zero effect on
   the surviving stone set, no matter how the change is described geometrically.

6. **StoneLayout generation** -- surviving points become `Stone` objects 1:1
   (`GeometryEngine.js:220-227`). No further pruning.

**Answer to Question 1**: information becomes insignificant at step 5 (same-contour dedup
pruning), not at font loading, contour generation, flattening, or point sampling -- all of which
were confirmed (Section 3) to faithfully propagate outline edits right up to that step.

---

## 3. Sensitivity Analysis

Measured directly with `tools/font-diag-001/pipeline-trace.mjs`, which calls
`GeometryEngine.resolveTextPolygons()` (the exact flattening path `generateTextLayout()` itself
uses) followed by the real, unmodified `sampleOutlinePoints()` / `dedupeStonePoints()`, and reports
every maximal run of consecutive pruned samples as a "prune event" with the resulting gap (chord
distance) between its surviving neighbors, compared against
`productionAnalysis.mjs`'s own `clusterCount` threshold (`pitchMm * 1.6`, where `pitchMm =
stoneSizeMm + 0.3`).

### 3.1 Baseline "m", SS30, mid height (108.5mm) -- 51 raw samples, 21 kept, 30 pruned

| gap (mm) | pruned run length |
|---|---|
| 11.97 | 1 |
| 18.01 | 2 |
| 11.64 | 1 |
| 9.49 | 1 |
| 21.32 | 3 |
| 16.63 | 4 |
| 13.40 | 1 |
| **29.23** | **10** |
| 10.28 | 1 |

Cluster threshold at SS30 = 10.72mm. **Six of nine measurable prune-event gaps already exceed the
cluster threshold**, the worst by 2.7x (a single 10-sample pruned run). Yet the real pipeline
reports `clusterCount = 3`, not 6+ (verified directly against `analyzeOne()`). This is only
possible because `countClusters()` (`tools/font-certification/lib/productionAnalysis.mjs:77-90`)
is a **global union-find over every pairwise stone distance**, not a check of sequential
arc-length-order gaps: a stone on one side of a local prune gap can still be "bridged" into the
same cluster via a *different*, non-adjacent stone elsewhere on the outline (e.g. "m"'s three
arches pass close to each other spatially even though they are far apart along the perimeter walk).
**Local dedup gaps are necessary but not sufficient evidence of a visible cluster break.**

### 3.2 Effect of the tested outline modifications on the same glyph

| variant | raw samples | kept | worst prune-run gap (mm) | worst run length |
|---|---|---|---|---|
| m baseline | 51 | 21 | 29.23 | 10 |
| m delta 70 | 52 | 22 | 25.32 | 9 |
| m delta 150 | 53 | 21 | **53.75** | **18** |
| m delta 300 | 56 | 21 | 31.40 | 12 |

The single-vertex push never shrinks the worst prune run -- at delta 150 it makes it dramatically
**worse** (18 consecutive raw samples pruned, more than the entire glyph's final 21-stone count).
This matches FONT-CAL-001's unchanged `clusterCount = 3` at every delta and its observed delta-300
distortion with no benefit.

### 3.3 The clearest single piece of evidence -- "n", delta 300

| variant | raw | kept | prune events (gap mm / run length) |
|---|---|---|---|
| n baseline | 36 | 13 | 11.79/1, 9.61/1, 16.36/4, **32.44/10**, 11.47/1 |
| n delta 300 | 41 | 16 | 11.79/1, 9.61/1, 16.36/4, **32.44/10**, 23.47/4 |

The modification targeted "n"'s sharpest same-contour cusp (turn-angle closest to a full reversal)
and pushed it 300 font units. The glyph's **single worst prune event -- a 10-sample run producing
a 32.44mm gap, three times the cluster threshold -- is byte-for-byte unchanged**: identical gap
distance, identical run length. The modification added stones elsewhere (13 -> 16 kept, matching
FONT-CAL-001's reported delta-300 stone count) but had *zero measurable leverage* on the region
actually driving fragmentation. This is direct, measured evidence -- not inference -- that
**cusp turn-angle (the metric `modify_glyph.py` used to select its target vertex) does not
reliably identify the location that drives `clusterCount` fragmentation.**

### 3.4 Effect of height scaling on the same mechanism (baseline "m", unmodified)

| height (mm) | raw samples | kept (=stones) | worst gap (mm) | gaps exceeding 10.72mm threshold | clusterCount |
|---|---|---|---|---|---|
| 108.5 (mid) | 51 | 21 | 29.23 | 6 of 9 | 3 |
| 150 | 70 | 36 | 28.04 | 8 of 9 | **1** |
| 200 | 94 | 81 | 17.54 | 8 of 8 | **1** |

This is the most counterintuitive finding of the investigation: **local prune gaps exceeding the
cluster threshold do not disappear as height increases** -- there are still 8 of 9 (150mm) and all
8 (200mm) measurable local gaps above threshold, and the single worst gap barely shrinks (29.2mm ->
28.0mm -> 17.5mm, still above threshold at 200mm). Yet `clusterCount` drops to 1 at both heights.
The explanation is the same global-bridging mechanism from Section 3.1: height scaling uniformly
increases the glyph's overall point *density* (perimeter grows faster than the fixed `spacingMm`
pitch does not, so raw sample count grows 51 -> 70 -> 94, kept count grows 21 -> 36 -> 81) which
increases the odds that *some* non-adjacent stone spatially bridges *any* given local gap, even one
that individually still exceeds the cluster threshold. Pruned fraction also drops monotonically
(30/51 = 59% -> 34/70 = 49% -> 13/94 = 14%), consistent with fixed-mm thresholds (`stoneSizeMm`,
cluster threshold) becoming small relative to a uniformly larger glyph.

### 3.5 Property-by-property sensitivity

The dedup stage (Section 2, step 5) reads exactly one derived quantity: **pairwise Euclidean
distance between candidate points**. Every geometric property in the milestone's list matters only
to the extent it changes that distance for the samples the arc-length walk happens to place near
each other. Given that:

| property | StoneSampler sensitivity | evidence |
|---|---|---|
| **Local feature size at a pinch/cusp** (chord distance across the pinch) | **Directly, fully load-bearing.** This *is* the dedup test. | Section 3.1: every prune event is exactly a chord-distance-below-`stoneSizeMm` violation, by construction of `dedupeStonePoints()`. |
| **Cusp/corner turn-angle** (`modify_glyph.py`'s own selection metric) | **Only a weak, unreliable proxy** for local feature size -- not read by the sampler itself. | Section 3.3: the sharpest-turn-angle vertex for "n" was not where the worst prune event occurred; modifying it left that event unchanged. |
| **Contour length / perimeter** | Indirect: sets raw sample count (`perimeter / spacingMm`) and phase-shifts every later sample's arc-length position. | Section 3.2/3.4: raw sample counts scale with both outline edits and height changes. |
| **Overall point density / stone count** | Indirect but strong: denser point clouds create more cross-gap spatial bridges in the global union-find `clusterCount` metric. | Section 3.4: `clusterCount` fixed at height 150/200mm despite local gaps remaining above threshold. |
| **Enclosed area, curvature magnitude away from cusps, stroke joins** | No measurable direct effect found; not read anywhere in `StoneSampler.js`. | Not read by any inspected sampling/dedup code path (Section 2). |
| **Radius at a curve (indirectly, chord-vs-arc-length ratio)** | Same mechanism as local feature size -- a tighter radius increases the gap between arc-length and chord distance. | Restates local-feature-size sensitivity; not independently tested. |

**Answer to Question 2**: `StoneSampler` is sensitive to exactly one thing mechanically --
candidate-point chord distance versus `stoneSizeMm` -- and to overall point density as a
second-order effect on the `clusterCount` measurement (not the sampler itself). Named "outline
properties" like curvature, corner angle, or cusp sharpness matter only inasmuch as they are
correlated (sometimes poorly, per 3.3) with local feature size at the specific arc-length position
the fixed-step walk happens to sample.

**Answer to Question 3**: yes -- a modification is "too small to survive sampling" whenever it
does not shift the chord distance of the *specific* sample pair(s) forming the worst prune run
above `stoneSizeMm` (6.4mm at SS30) **across the entire pruned run's arc-length span**, not just at
one point. Section 3.2/3.3 show single-vertex deltas up to 300 font units (~15.9mm at SS30's mid
height -- more than 2x the stone diameter) applied at one vertex failed to do this, in one case
(3.3) with *zero* measured effect on the worst gap at all. No minimum single-vertex delta can
therefore be quoted as sufficient; the evidence instead indicates the *technique* (single point,
not a span) has near-zero leverage on this specific defect, independent of magnitude.

**Answer to Question 4**: of the modification classes listed in the milestone brief, only
techniques that widen a *contiguous span* of the outline across an entire pruned run's arc length
(not one vertex) are mechanically plausible, per the pipeline analysis in Section 2 step 5 -- this
was FONT-CAL-001's own untested hypothesis (Section 8/10 of that report) and this investigation's
new evidence (3.2, 3.3) reinforces rather than newly establishes it. "Opening counters" and
"enlarging enclosed areas" are not evidenced to matter (Section 3.5, no enclosed-area sensitivity
found). "Simplifying corners" or "changing stroke joins" are not applicable to already-flattened
polygon geometry. None of these alternatives were implemented or tested here -- per this
milestone's scope, only the existing FONT-CAL-001 modification (single-vertex) was re-analyzed.

**Answer to Question 5**: partially. Local chord-distance analysis (as `pipeline-trace.mjs` performs)
can cheaply flag *candidate* risk locations, but it costs essentially the same as generating the
real `StoneLayout` (it calls the identical flattening + arc-walk + dedup functions), so it is not a
cheaper *pre*-generation predictor of collisions/isolation -- those are already directly measured
by the existing `analyzeOne()`/`clusterCount` tooling with no headroom to predict "earlier". More
importantly, Section 3.4 shows a local prune-gap analysis alone is **not sufficient** to predict
final `clusterCount`, because the global union-find bridging effect can absorb local gaps that
individually exceed the cluster threshold. Reliable fragmentation prediction requires the full
pairwise stone-distance pass `countClusters()` already performs -- there is no shortcut found in
this investigation.

**Answer to Question 6**: height scaling in `OpenTypeProvider.js` is a **uniform linear scale of
every glyph coordinate** (Section 2, step 1: `unitsToMm = heightMm / unitsPerEm` applied before any
contour is built). This means every local pinch separation that causes fragmentation grows in exact
proportion to height, while the dedup floor (`stoneSizeMm`) and cluster threshold (`pitchMm * 1.6`)
are fixed millimeter values determined by stone size, not by text height. Increasing height
therefore has two compounding, evidenced effects (Section 3.4): it directly shrinks the *fraction*
of candidate samples that fall under the fixed dedup floor (pruned fraction 59% -> 49% -> 14%), and
it increases overall point density enough to create more cross-gap spatial bridges in the
`clusterCount` union-find. Single-vertex outline modification, by contrast, is a local, one-point,
fixed-font-unit change that (per 3.2/3.3) does not propagate to most of a pruned run's chord
distances and, being local, can only ever address one of several independent fragmentation sources
around a glyph's contour (Section 3.1: nine separate measurable prune events for "m" alone). This is
the pipeline-level reason height scaling outperformed outline modification -- it acts on the exact
quantity (chord distance vs. fixed mm thresholds) that determines fragmentation, uniformly and
everywhere at once; the tested outline technique does not.

---

## 4. Why FONT-CAL-001 Failed

**Facts (measured in this investigation):**

- The same-contour dedup stage (`dedupeStonePoints()`, RC-004A) is the sole point in the pipeline
  where geometric detail is discarded; font loading, contour construction, flattening, and
  arc-length point sampling all faithfully propagate outline edits up to that stage (Section 2, 3.2).
- For "m" at SS30 mid-height, the fragmentation-driving gaps are not one isolated defect but at
  least nine independent prune events, six of which individually exceed the cluster threshold
  (Section 3.1).
- The single-vertex modification technique left "n"'s single worst prune event completely
  unchanged in both gap distance and run length at its largest tested delta (Section 3.3) --
  measured zero leverage, not merely insufficient magnitude.
- `clusterCount` is a global union-find over all pairwise stone distances, not a function of local
  sequential-order gaps alone; local gaps exceeding the cluster threshold can be "bridged" by
  unrelated, non-adjacent stones and not manifest as an extra cluster (Section 3.1, 3.4).
- Height scaling changes the same chord-distance quantity the dedup stage tests, uniformly, across
  the entire glyph at once, and also increases the point density that drives cluster-bridging
  (Section 3.4/3.5).

**Hypotheses (plausible, not measured here):**

- A modification widening a *contiguous span* of points across an entire pruned run's arc length
  (not one vertex) would have more leverage on the mechanism identified in Section 2 step 5 --
  consistent with, and now mechanically motivated by, FONT-CAL-001's own untested Section 10
  recommendation, but not implemented or tested in this investigation (out of scope).
  Follow-up: see Section 7 -- the concretely evidenced next step (height-policy investigation) is
  offered in preference to this hypothesis because it can be validated with the existing, unmodified
  pipeline with no new font-editing technique required.
- A selection metric that scores candidate cusps by the actual resulting worst-prune-run gap
  (essentially, by running the real sampler on trial edits) rather than by static turn-angle would
  more reliably locate the load-bearing region -- turn-angle was shown to miss it in one direct case
  (3.3), but this was not tested as an alternative selection criterion.

**In summary**: FONT-CAL-001's modifications failed not because the deltas were too small or the
wrong glyphs were chosen, but because a single-vertex edit is structurally the wrong shape of
intervention for a defect caused by dedup pruning a run of many consecutive samples across an
extended arc-length span, and because the vertex-selection heuristic (sharpest turn-angle) does not
reliably locate the arc-length span that actually drives the worst fragmentation.

---

## 5. Architectural Implications

The evidence points most directly at **text-height policy**, not font outline engineering, as the
only investigated lever that measurably worked end-to-end through the real, unmodified pipeline
(Section 3.4, and originally FONT-CAL-001 Section 7). It is currently gated by a product/UX
constraint (SS30's committed 106-111mm height range), not a pipeline limitation.

**Font outline engineering** (the direction FONT-CAL-001 tried) is not disproven as a category, but
this investigation's evidence narrows what could plausibly work: only span-widening across an
entire pruned run, not the single-vertex technique tested, and even that is an untested hypothesis,
not a recommendation to implement (per this milestone's explicit restriction against further
Sacramento optimization).

**Sampling strategy** (RC-004A's dedup mechanism itself) is the direct, confirmed *mechanical*
cause of the pruning that drives fragmentation (Section 2 step 5). This investigation traced and
measured its behavior in detail but did not test any alternative sampling strategy, and per this
milestone's explicit restriction ("do not redesign StoneSampler ... unless the investigation proves
such work is necessary"), the evidence gathered here identifies a mechanism, not a proof that the
mechanism must change -- RC-004A's own doc comment (`StoneSampler.js:201-267`) already documents
its rationale (preventing literal physical stone overlap) and this investigation found no case
where its behavior was incorrect relative to that goal; every pruned point was, in fact, a real
physical overlap under the fixed-step arc-length sampling that precedes it.

**Measurement strategy** is the one area this investigation found a genuinely new, actionable
insight not present in FONT-CAL-001: `clusterCount`'s global union-find bridging means a
"local gap exceeds threshold" reading (like `pipeline-trace.mjs` produces) is **not** by itself a
reliable predictor of a visible fragmentation defect (Section 3.1, 3.4) -- confirmed empirically,
not assumed. Any future diagnostic work should measure `clusterCount` itself (or the full pairwise
union-find it already performs), not local dedup-gap counts in isolation.

---

## 6. Open Questions

Ranked by importance:

1. **Would a contiguous-span outline modification (not single-vertex) actually reduce the worst
   prune-run's chord distances enough to matter?** This is the most direct, mechanically motivated
   follow-up from Section 2/4, and the only outline-engineering hypothesis this investigation did
   not rule out. Untested.
2. **Is SS30's 106-111mm committed height range itself the right product constraint, or could/should
   it be extended?** The only technique proven to work in this investigation only works outside that
   range (Section 3.4, FONT-CAL-001 Section 7). This is a product/architecture decision, not a
   pipeline question, and was explicitly out of scope for both this and the prior milestone.
3. **Does the turn-angle-misses-the-real-defect finding (Section 3.3) generalize beyond "n", or was
   it specific to that glyph's geometry?** Only one clean case was measured.
4. **Do the findings here (dedup-driven fragmentation, global-bridging measurement behavior)
   generalize to other cursive/connected fonts, or are they specific to Sacramento's particular
   stroke geometry?** Not tested against any other font.

---

## 7. Recommendation

**Exactly one next milestone, justified directly by this investigation's evidence:**

**FONT-POLICY-001 -- SS30 Height Ceiling Policy Study.** Height scaling is the only technique this
investigation and FONT-CAL-001 together found to measurably resolve Sacramento's SS30 fragmentation
end-to-end through the real, unmodified pipeline (Section 3.4/5) -- but it only works beyond SS30's
currently-committed 106-111mm range, and whether that range can or should be extended is a
product/UX/manufacturing-constraint question, not a geometry question, and was explicitly out of
scope for both this milestone and FONT-CAL-001. The proposed milestone would: (a) reuse
`tools/font-cal-001`'s and this milestone's measurement tooling unchanged to find, for the broader
`diagnose.mjs`-ranked glyph set (not just m/n/v), the minimum height at which `clusterCount`
fragmentation resolves at SS30; (b) evaluate the physical/production impact of raising SS30's
committed height ceiling to cover that range against real product size constraints (mug/tumbler
printable regions, per `docs/CLAUDE.md`'s Product Definitions); and (c) explicitly decide, with
evidence, whether height-range extension is viable -- closing off the one lever this investigation
found to work, or confirming it as the actual production fix. This is preferred over further
outline-modification experiments (Section 6, item 1) because it requires no new font-editing
technique and directly tests the one mechanism already proven to work.

---

## Appendix -- Diagnostic Tooling

`tools/font-diag-001/pipeline-trace.mjs` (kept, not removed, per this milestone's "unless it
becomes generally useful" instrumentation policy): calls the real, unmodified
`GeometryEngine.resolveTextPolygons()` and `StoneSampler.sampleOutlinePoints()`/
`dedupeStonePoints()` directly against an arbitrary TTF/glyph/height, and reports every maximal run
of consecutive same-contour-dedup-pruned samples with its resulting gap distance, compared against
the cluster/isolation thresholds `productionAnalysis.mjs` already uses. No new geometry or
stone-generation logic -- every call is to an existing exported function, used read-only. Useful for
any future font calibration investigation that needs to see *why* a given glyph fragments, not just
*whether* it does.

```
node tools/font-diag-001/pipeline-trace.mjs <ttfPath> <glyph> <heightMm> [stoneSizeMm=6.4] [gapMm=0.3]
```
