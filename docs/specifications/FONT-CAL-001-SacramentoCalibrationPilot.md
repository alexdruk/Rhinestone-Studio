# FONT-CAL-001 -- Sacramento Calibration Pilot: Experiment Report

Status: **Experiment complete.** All 3 outline modifications tested were rejected. Height scaling
resolved the diagnosed defect, but only beyond SS30's currently-committed production height range.
No production application code or runtime font pipeline was modified. No candidate font became a
production asset.

Supporting tooling: `tools/font-cal-001/` (see that folder's `README.md` for the reproduction
steps). Raw measurements: `tools/font-cal-001/output/*.json`.

---

## 1. Objective

Does targeted outline modification of a specific glyph improve rhinestone production quality at
SS30 (Sacramento's hardest stone size) beyond what simply increasing text height already achieves
-- using the real, unmodified GeometryEngine/StoneSampler pipeline as the sole judge, not a
Python-side estimate?

---

## 2. Baseline

**Sacramento source**: `fonts/sources/Sacramento/Sacramento.ttf` (Google Fonts, OFL, glyf-flavored
TrueType, `unitsPerEm` 2048, 375 glyphs). SHA-256:
`9341fda10adbfeb7efc94302b34507a3e227d7e7f5c432df3f5ac8753ff73d24`. Same file FONT-SOURCE-001
already certified (`fonts/review/Sacramento/report.json`).

**Stone sizes**: SS30 (6.4mm stone, 6.7mm pitch) as the primary stress case; SS6 (2.0mm/2.3mm) and
SS10 (2.8mm/3.1mm) as controls. Heights used are each stone size's own milestone-committed "mid"
production height (`HEIGHT_RANGE_MM_BY_SIZE`, reused unchanged from FONT-SOURCE-001's
`sourceEvaluation.mjs`): SS6 = 42.5mm, SS10 = 52.5mm, SS30 = 108.5mm.

**Baseline measurement**: `tools/font-cal-001/baseline.mjs` ran the full FONT-CERT-001/
SOURCE-001 character/word corpus (69 glyphs + 9 words, reused unchanged from
`requiredCharacters.mjs`) through the real, unmodified pipeline
(`buildCandidateEngine`/`analyzeOne` from `productionAnalysis.mjs`) at all three sizes -- 213
measurements total (`tools/font-cal-001/output/baseline.json`).

Result: **zero stone collisions, zero isolated stones, and zero counter-bearing-floor violations**
anywhere in the corpus at any of the three sizes. The only defect the baseline measurement
surfaced was elevated `clusterCount` (StoneSampler's own nearest-neighbor connected-component
count) at SS30 relative to both controls, for several glyphs -- i.e. a stroke that should read as
one continuous line breaks into visually disconnected pieces once stones get large enough, even
though no stone actually collides or goes isolated by the certification's own existing thresholds.

**Mechanism** (read, not modified, from `src/geometry/StoneSampler.js`'s own `RC-004A` doc
comment on `sampleMultiContourOutlinePoints()`): outline mode walks a contour's arc length at fixed
`spacingMm`, then prunes any later sample within `minSeparationMm` (= `stoneSizeMm`) of an earlier
one -- same-contour or cross-contour alike, explicitly to prevent literal stone overlap. That same
doc comment already names "a cursive font's tight loop or cusp" as the scenario where this pruning
can remove several consecutive candidate points near a sharp direction reversal, leaving a real gap
-- and the size of that gap in stone-diameter terms grows as `stoneSizeMm` grows from SS6/SS10 to
SS30, even though the resulting fragments stay closer together than the isolation threshold
(2.5x pitch), so `isolatedCount`/`collisionCount` never flag it. `clusterCount` is therefore this
experiment's target metric, not the certification's existing collision/isolation checks.

**Glyph selection** (`tools/font-cal-001/diagnose.mjs`, ranking clusterCount(SS30) -
max(clusterCount(SS6), clusterCount(SS10)) across only the font's single-contour glyphs --
confirmed via `tools/font-cal-001/python/contour_counts.py` against the real glyf table, since
multi-contour glyphs like capital H/K fragment for a structurally different reason: their 2nd/3rd
contours are small decorative flourish marks, not a pinched single stroke, and are out of scope for
this experiment's chosen technique):

| glyph | clusters SS30 | clusters SS6 | clusters SS10 | fragmentation delta |
|---|---|---|---|---|
| **m** | 3 | 1 | 1 | **+2** |
| **n** | 2 | 1 | 1 | **+1** |
| **v** | 3 | 1 | 3 | 0 (already fragmented at SS10) |
| s | 2 | 2 | 1 | 0 |
| w | 2 | 1 | 2 | 0 |

Selected:

- **m** -- largest fragmentation delta among single-contour glyphs; the cleanest, strongest signal
  that SS30's coarser pitch, not the outline itself, is the cause.
- **n** -- same direction as "m" at smaller scale; tests whether one technique generalizes to a
  second, independent instance of the same defect.
- **v** -- fragmentation delta is 0 (already 3 clusters at the SS10 control) -- selected
  deliberately as a contrast case, since its multi-cluster behavior is evidently not a pure SS30
  artifact.

**Representative phrase**: **"movement"** -- a common, all-lowercase decorative word containing all
three selected glyphs in their exact selected case. A capitalized name ("Marvin") was considered
and rejected: its leading "M" is a different glyph than the lowercase "m" this experiment selected,
so it would not have exercised the modified glyph at all.

---

## 3. Experiment 1

**Glyph**: m

**Observed problem**: `clusterCount` = 3 at SS30 vs 1 at both SS6 and SS10 (mid heights), with zero
collisions/isolated stones at any size.

**Modification attempted**: single-vertex cusp widening
(`tools/font-cal-001/python/modify_glyph.py`) -- find the on-curve point with the sharpest
same-contour direction reversal (incoming/outgoing tangent dot product closest to -1) and push it
outward, along the direction it already points, by a fixed number of font units. For "m" the
sharpest cusp (turn dot -0.896) is at font-unit point (654, 108), one of the two baseline valleys
between its three humps. Tested at delta = 70, 150, and 300 font units (~3.7mm, 7.9mm, 15.9mm at
SS30's 108.5mm rendering height). A fourth run targeted the glyph's *second*-sharpest cusp (turn
dot -0.284, at (1116, 57) -- the other baseline valley) at delta = 200.

**Before metrics** (SS30, mid height): stones = 21, clusters = 3, bbox 74.2 x 31.8mm.

**After metrics** (SS30, mid height, real pipeline via `validate.mjs`):

| variant | stones | clusters | bbox |
|---|---|---|---|
| delta 70 (primary cusp) | 22 | 3 (unchanged) | 75.5 x 34.4mm |
| delta 150 (primary cusp) | 21 | 3 (unchanged) | 75.4 x 33.5mm |
| delta 300 (primary cusp) | 21 | 3 (unchanged) | 73.5 x **37.1mm** (+16.7% height) |
| delta 200 (secondary cusp) | 21 | **4 (worse)** | 73.6 x 36.2mm |

Representative phrase "movement" (SS30): baseline 116 stones / 11 clusters; delta 70 -> 119/11;
delta 300 -> 118/**12 (worse)**.

**Visual comparison**: at delta 300 the glyph's bounding-box height grows ~17% (its lowest point is
pushed well past the natural baseline) with no change to cluster count -- a visible distortion for
zero functional benefit. The alternate-cusp attempt visibly worsens fragmentation.

**Decision**: **REJECT**

**Reason**: no tested delta (70/150/300 font units on the primary cusp, or 200 on the secondary
cusp) changed the SS30 cluster count for the better; two of the four attempts produced measurable
regressions (glyph distortion with delta 300, worse fragmentation with the alternate cusp). This
indicates "m"'s fragmentation comes from an extended narrow region spanning multiple points around
both baseline valleys, not one sharp vertex -- a single-vertex nudge cannot address it.

---

## 4. Experiment 2

**Glyph**: n

**Observed problem**: `clusterCount` = 2 at SS30 vs 1 at both controls.

**Modification attempted**: same single-vertex cusp-widening technique, applied to "n"'s sharpest
cusp (turn dot -0.796, at font-unit point (198, 438)). Tested at delta = 70, 150, 300.

**Before metrics** (SS30, mid height): stones = 13, clusters = 2, bbox 51.2 x 31.9mm.

**After metrics**:

| variant | stones | clusters | bbox |
|---|---|---|---|
| delta 70 | 13 | 2 (unchanged) | 50.8 x 31.9mm |
| delta 150 | 14 | 2 (unchanged) | 52.3 x 36.3mm |
| delta 300 | 16 | 2 (unchanged) | 52.8 x **42.9mm** (+34.5% height) |

Representative phrase "movement" (SS30): baseline 116/11; delta 70 -> 116/11 (unchanged); delta 300
-> 119/11 (unchanged).

**Visual comparison**: at delta 300 the glyph grows ~34.5% taller (a severe, visible distortion --
the pushed point is dragged well past the descender line) while the cluster count never moves at
any delta tested.

**Decision**: **REJECT**

**Reason**: the same technique failed a second, independent glyph at increasing severity of visible
distortion without ever changing the target metric. This is not a glyph-specific fluke of "m" --
it indicates the technique itself (a single-vertex push at the sharpest same-contour cusp) does not
address this fragmentation mechanism, at least not via the direction/location this algorithm
identifies.

---

## 5. Experiment 3

**Glyph**: v

**Observed problem**: `clusterCount` = 3 at SS30, but *also* 3 at the SS10 control (only SS6 is a
clean 1) -- selected as a contrast case because its fragmentation is not purely an SS30-pitch
artifact.

**Modification attempted**: same technique, applied to "v"'s sharpest cusp (turn dot -0.716, at
font-unit point (220, 58)). Tested at delta = 70 and 150.

**Before metrics**: SS6 stones=15/clusters=1, SS10 stones=11/clusters=3, SS30 stones=10/clusters=3;
"movement" SS30 clusters=11.

**After metrics**:

| variant | SS6 clusters | SS10 clusters | SS30 clusters | "movement" SS30 clusters |
|---|---|---|---|---|
| delta 70 | **2 (worse)** | 3 (unchanged) | **4 (worse)** | **12 (worse)** |
| delta 150 | **2 (worse)** | 2 (better) | **2 (better)** | **10 (better)** |

**Visual comparison**: delta 150 is the only modification in this experiment that improved the
target SS30 metric (3 -> 2 clusters) and the representative phrase (11 -> 10 clusters) -- but it
simultaneously broke the SS6 control, which had been a clean single cluster, into 2.

**Decision**: **REJECT**

**Reason**: per this experiment's own acceptance rule ("keep only if improvement without a
meaningful regression"), delta 150's SS6 regression disqualifies it even though it is the one case
where the technique demonstrably worked at the target size. This is the clearest direct evidence in
the experiment that **a transformation direction/magnitude tuned for one stone size can actively
harm a different stone size** -- the exact risk this milestone's brief warned against assuming away.

---

## 6. Overall Comparison

All measurements from `tools/font-cal-001/output/candidate-*.json`, reproduced via
`tools/font-cal-001/compare.mjs` (full tables: `tools/font-cal-001/output/comparison-tables.md`).
Collisions and isolated-stone counts were **0 in every cell of every run in this experiment** --
omitted from the table below since they never varied.

**SS30 (primary stress case), stones / clusters / bbox:**

| candidate | m | n | v | movement |
|---|---|---|---|---|
| baseline (unmodified) | 21 / 3 / 74.2x31.8 | 13 / 2 / 51.2x31.9 | 10 / 3 / 45.2x34.2 | 116 / 11 / 359.6x67.7 |
| m modified (best: delta 70) | 22 / 3 / 75.5x34.4 | -- | -- | 119 / 11 / 361.3x67.7 |
| m modified (delta 300) | 21 / 3 / 73.5x**37.1** | -- | -- | 118 / **12** / 361.3x**72.9** |
| n modified (delta 300) | -- | 16 / 2 / 52.8x**42.9** | -- | 119 / 11 / 359.6x67.7 |
| v modified (delta 70) | -- | -- | 10 / **4** / 45.0x34.3 | 116 / **12** / 359.6x67.7 |
| v modified (delta 150) | -- | -- | 10 / **2** / 45.8x33.5 | 116 / **10** / 359.6x67.7 |

No modification survives to KEEP. Every column either shows no change to `clusterCount`, or a
worse one, or an improvement paired with a disqualifying regression elsewhere (Experiment 3).

---

## 7. Height Scaling Comparison

Unmodified Sacramento, SS30 only, height varied via `validate.mjs --height-override`:

| height (mm) | m clusters | n clusters | v clusters | "movement" clusters | note |
|---|---|---|---|---|---|
| 108.5 (mid, baseline) | 3 | 2 | 3 | 11 | current milestone mid height |
| 111 (max -- **current SS30 legal ceiling**) | **4 (worse)** | 2 | 3 | 10 | still within product's committed range |
| 150 (beyond current legal range) | **1 (fixed)** | **1 (fixed)** | 2 (improved) | 7 (improved) | diagnostic only -- not currently a legal SS30 height |
| 200 (beyond current legal range) | **1 (fixed)** | **1 (fixed)** | **1 (fixed)** | 2 (near-fixed) | diagnostic only |

**Did outline modification outperform height scaling? No.**

Height scaling, taken far enough (150-200mm), fully resolved fragmentation for all three isolated
glyphs and reduced the representative word's cluster count from 11 to as low as 2 -- something none
of the three outline modifications achieved for any glyph without a disqualifying regression.
Outline modification (0 of 3 kept) provided no measurable net benefit anywhere in this experiment.

However, height scaling is **not** a free win within the product's *current* SS30 commitment: at
111mm -- the top of SS30's own committed 106-111mm range -- "m" is measurably *worse* (4 clusters)
than at the 108.5mm mid height, and "movement" only improves by one cluster. The heights that
actually resolved the defect (150mm, 200mm) are both **beyond SS30's currently-committed production
height range** and were tested here purely to answer this section's question, not as a
production-ready recommendation. Whether SS30's legal height ceiling should be raised is a product/
architecture decision outside this experiment's scope.

---

## 8. Lessons Learned

- **Which glyphs benefited from outline modification**: none. 0 of 3 modifications (m, n, v) were
  kept.
- **Which did not**: all three. "m" and "n" showed *zero* sensitivity to the technique across a
  4x delta range (70 -> 300 font units) -- the cluster count never moved, only the glyph's visible
  distortion grew. "v" showed real sensitivity but with a stone-size-dependent trade-off that
  disqualified it.
- **Did different glyphs require different modifications?** The experiment applied one technique
  uniformly and it failed uniformly (in different ways) on all three -- itself evidence that a
  single reusable transformation rule is not currently supported. Whether a *different* technique
  (e.g. widening a contiguous span of points around each valley, rather than one vertex) would
  succeed is untested, not refuted.
- **Did any modification produce regressions?** Yes, repeatedly: "m" at delta 300 grew 16.7%
  taller for no benefit; "n" at delta 300 grew 34.5% taller for no benefit; "v" at delta 150 traded
  an SS30 fix for an SS6 regression. Regressions were more common than improvements in this
  experiment.
- **Does manual intervention appear necessary?** The evidence points that way: an automated
  single-vertex heuristic, even redirected to a glyph's second-sharpest cusp, failed to locate an
  effective correction for 2 of 3 glyphs. A human type designer reshaping the connecting stroke's
  curvature directly (not nudging one coordinate) is the more plausible next step -- a hypothesis
  this experiment did not test.

---

## 9. Architectural Conclusions

**What appears reusable**: the measurement/validation pipeline. `measureProduction.mjs`'s thin
wrapper around `productionAnalysis.mjs`'s real, unmodified `buildCandidateEngine`/`analyzeOne`
worked identically for the baseline, every one of 9 candidate fonts, and every height override,
with zero new geometry logic. This confirms FONT-ARCH-001's Section 5 conclusion (measurement/
analysis tooling should be shared) and extends it: cross-stone-size `clusterCount` comparison is a
usable, evidence-grounded diagnostic signal that the existing certification tooling did not
previously compute but needed no new stone-generation code to add.

**What appears glyph-specific**: everything about the modification side. Which point to move (if
any), whether any delta helps, and whether the technique is even viable at all differed per glyph
-- "m" and "n" tolerated no version of this technique, "v" only "worked" with an unacceptable
trade-off. This directly extends FONT-ARCH-001's Section 5 conclusion that "any future
outline-modification effort... is inherently per-font" down one more level: per-glyph, not just
per-font-category.

**Should a future calibration engine be rule-driven, measurement-driven, transformation-driven, or
hybrid?** This experiment's evidence favors **measurement-driven**, not transformation-driven or
rule-driven: the one general transformation rule tested here ("push the sharpest same-contour cusp
outward") failed on 2 of 3 glyphs and only partially worked on the third with a disqualifying
trade-off, so codifying it as a reusable rule would be premature and unsupported by this evidence.
What generalized cleanly across every one of the 9 candidates tested was the *measurement*
infrastructure, not the transformation.

**What is evidence vs hypothesis, stated explicitly:**

*Evidence (measured directly in this experiment):*
- SS30 cluster fragmentation in Sacramento is real, reproducible, and measurable with the existing
  certification tooling's own `clusterCount`, with zero collision/isolation/counter-floor findings
  masking it.
- The single-vertex cusp-widening technique, as implemented, does not fix it for 2 of 3 glyphs even
  at a 4x delta range, and trades a control-size regression for a target-size fix on the 3rd.
- Height scaling fully resolves it for isolated glyphs, but only when pushed beyond SS30's current
  106-111mm committed range; within that range, height scaling does not reliably help and can
  actively worsen it (m: 3 -> 4 clusters from mid to max height).

*Hypotheses (not tested here, and not to be treated as conclusions):*
- That a multi-point/region-based modification, or a human-redrawn correction, would succeed where
  the single-vertex technique failed.
- That a different diagnostic (not cusp-turn-angle) would locate a more effective intervention
  point.
- That these findings generalize beyond Sacramento, beyond SS30, or beyond the three glyphs tested.

---

## 10. Recommendation

**Another Sacramento experiment is justified** -- this pilot's clearest unresolved lead is that
"m"'s fragmentation persisted unchanged across a 4x delta range on its single sharpest cusp,
suggesting the defect spans a wider region than one vertex.

**Proposed next milestone (exactly one, narrowly scoped)**:

**FONT-CAL-002 -- Multi-point region widening for a single glyph ("m").** Test whether widening a
short, contiguous *span* of on-curve points around each of "m"'s two baseline valleys (rather than
one vertex) resolves its SS30 cluster fragmentation without the height distortion or cross-size
regressions this pilot observed -- validated against the exact same real production pipeline and
the exact same acceptance rule (improvement without a meaningful regression at SS6/SS10). Reuse
`tools/font-cal-001`'s measurement/validation harness unchanged; only the modification technique
(`modify_glyph.py`'s single-vertex logic) would need a new, separate script. No calibration engine,
rule engine, or application integration -- one glyph, one new technique variant, same evidence
standard.
