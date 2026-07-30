# FONT-CAL-002 -- Contiguous Span Calibration Experiment

Status: **Experiment complete.** No application behavior changed, no calibration engine built.
Tooling written (`tools/font-cal-002/`) reuses FONT-CAL-001's cusp-finding, candidate-font
assembly, and production-measurement code, plus FONT-DIAG-001's pipeline trace, unchanged wherever
possible.

---

## 1. Objective

FONT-CAL-001 tested whether moving a single outline vertex (a glyph's sharpest same-contour cusp)
could reduce SS30 `clusterCount` fragmentation in Sacramento. It found zero measurable leverage
for "m"/"n" across deltas 70-300 font units. FONT-DIAG-001 explained why: StoneSampler's RC-004A
dedup reads pairwise chord distance between arc-length-resampled points, and a single moved vertex
does not change the distance between the specific samples that determine the worst gap.

This experiment asks one question only: **can modifications affecting an entire contour span --
not just one vertex -- produce measurable production improvements?**

## 2. Scope

- Font: Sacramento (`fonts/sources/Sacramento/Sacramento.ttf`)
- Primary test: SS30 (stone diameter 6.4mm), mid-height 108.5mm (committed 106-111mm range,
  unchanged from FONT-CAL-001/FONT-DIAG-001, no height override used anywhere in this experiment)
- Controls: SS6, SS10, same heights as FONT-CAL-001
- Glyphs: **m** (largest FONT-CAL-001 fragmentation signal: 3 clusters at SS30 vs 1 at both
  controls) and **n** (same direction, smaller signal: 2 vs 1) -- reused directly from
  `tools/font-cal-001/output/diagnosis.json`, no new glyph diagnosis needed
- Span: 7 on-curve points (radius 3), centered on the same sharpest-cusp point FONT-CAL-001's
  `modify_glyph.py` located for each glyph -- located via that script's own
  `find_sharpest_cusp`/`push_direction` helpers, imported directly (`tools/font-cal-002/python/modify_glyph_span.py`)
- Representative phrase: "movement" (unchanged from FONT-CAL-001)

## 3. Modification Classes

Three fundamentally different classes, each applied once (one span radius, one magnitude/iteration
count -- no parameter sweep) to each of the two glyphs, for 6 candidate fonts total:

| Class | Mechanism | Span endpoints |
|---|---|---|
| **widen** | Push each span point outward along its own local normal, cosine-weighted bump peaking at the cusp | Unchanged (weight -> 0) |
| **straighten** | Replace interior span points with points linearly interpolated along the chord between the span's two endpoints -- removes the direction reversal entirely | Unchanged |
| **smooth** | 3 iterations of Laplacian smoothing on interior span points -- reduces turn-angle sharpness gradually | Unchanged (fixed boundary) |

All three produced comparable characteristic displacement magnitudes (123-305 font units --
the same order of magnitude as FONT-CAL-001's largest, already-zero-leverage delta-300 case), so
any effect measured is attributable to the span shape change, not simply to using a larger
magnitude than FONT-CAL-001 tried.

## 4. Results

Full tables: `tools/font-cal-002/output/comparison-tables.md` (built by `compare.mjs` directly from
measured JSON, including FONT-CAL-001's `baseline-selected`, `m-d300`, and `height-ss30-150` for
side-by-side comparison).

### 4.1 SS30 `clusterCount` (primary metric)

| Glyph | Modification | Baseline | Result | Moved? |
|---|---|---|---|---|
| m | widen | 3 | **1** | Yes |
| m | straighten | 3 | **1** | Yes |
| m | smooth | 3 | 3 | No |
| n | widen | 2 | 2 | No |
| n | straighten | 2 | 2 | No |
| n | smooth | 2 | 2 | No |

Two of six class/glyph combinations moved `clusterCount` -- the first measured movement in either
FONT-CAL-001 or this experiment. This contradicts FONT-CAL-001's blanket finding that outline
modification never affects fragmentation; it does not, however, contradict FONT-DIAG-001's model of
*why* -- see 4.2.

### 4.2 Did it change the driving prune event? No -- a different mechanism did the work

`pipeline-trace.mjs` (unchanged from FONT-DIAG-001) traces the arc-length-sampled prune events
directly, independent of `clusterCount`'s downstream union-find:

| Font | Glyph | Raw samples | Kept | Worst gap (mm) | Prune events |
|---|---|---|---|---|---|
| baseline | m | 51 | 21 | 29.23 | 10 |
| m-widen | m | 66 | 26 | **32.27** | 12 |
| m-straighten | m | 56 | 22 | 26.50 | 11 |
| m-smooth | m | 55 | 22 | 26.49 | 10 |
| baseline | n | 36 | 13 | 32.44 | 6 |
| n-widen | n | 52 | 16 | 30.60 | 9 |
| n-straighten | n | 45 | 15 | 32.09 | 9 |
| n-smooth | n | 39 | 14 | 32.61 | 7 |

The cluster threshold is 10.72mm. In every case -- including m-widen and m-straighten, which *did*
reduce `clusterCount` -- the worst prune-event gap stayed 2.5-3x above threshold (for m-widen it
actually grew, from 29.23mm to 32.27mm). The span modifications did not close the gap FONT-DIAG-001
identified as driving fragmentation.

What changed instead: m-widen and m-straighten increased the *total* raw/kept sample count (66/26
and 56/22, vs baseline's 51/21) enough that some of those extra kept points -- not the ones
adjacent to the driving gap -- became close enough to *other*, non-adjacent points to bridge
separate components in `clusterCount`'s global union-find (confirming FONT-DIAG-001's finding that
`clusterCount` bridges via arbitrary pairwise proximity, not sequential-order gaps). n's candidates
gained a comparable or larger fraction of extra samples (52/16 vs 36/13 for n-widen, +44% raw
samples) but no bridging occurred -- n's cluster geometry didn't happen to have two components close
enough for the extra points to connect. **The mechanism that worked for "m" is an emergent,
glyph-shape-dependent side effect of denser sampling, not a controllable response to the
modification class.**

### 4.3 Regressions

m-widen and m-straighten -- the two combinations that improved SS30 -- both regressed the SS10
control:

| Font | SS10 "m" clusters | SS10 "movement" clusters |
|---|---|---|
| baseline | 1 | 3 |
| m-widen | **2** | **5** |
| m-straighten | **2** | **6** |
| m-smooth (no SS30 improvement) | 1 | 4 (phrase regressed even without an isolated-glyph regression) |

n's three candidates and m-smooth introduced no SS10 isolated-glyph regression, but m-smooth's
"movement" phrase still regressed at SS10 (3 -> 4) despite "m" alone showing no change -- a
word-level interaction the isolated-glyph measurement alone did not predict. SS6 showed no
regressions in any candidate.

This regression is structural, not incidental: because outline modification edits the glyph itself,
every stone size that renders that glyph is affected simultaneously. Height scaling (4.4) cannot
cause this class of regression by construction -- it only overrides the render height for the one
stone size being tested.

### 4.4 Comparison against height scaling

FONT-CAL-001's `height-ss30-150` (unmodified Sacramento, SS30 rendered at 150mm instead of
108.5mm) reduced "movement" at SS30 from 11 clusters to 7, and every individual selected glyph
(m, n, v) to 1 cluster -- with zero SS6/SS10 change, since only the SS30 render height was
overridden.

m-widen and m-straighten matched the *phrase-level* result exactly (11 -> 7) at the real committed
108.5mm height, no override needed. But:

- Neither touched "n" or "v" at all (only "m"'s glyph was modified) -- height scaling fixed all
  three glyphs simultaneously with one parameter change; span modification would need a separate,
  independently-verified edit per glyph, and n's edits (4.1) demonstrate that per-glyph success is
  not guaranteed even at comparable magnitude.
- Both introduced the SS10 regression in 4.3, which height scaling structurally cannot cause.

Net: on the one glyph where it worked, span modification matched height scaling's magnitude while
staying within the committed height range -- but it does not generalize (n was untouched), and it
trades away height scaling's zero-regression, single-global-lever property for a per-glyph,
unpredictable, regression-carrying edit.

## 5. Modification Class Report

| Class | Changed driving prune event? | Reduced fragmentation? | Regressions? | Better than height scaling? | Worth further investigation? |
|---|---|---|---|---|---|
| Span widening | No (gap grew for m) | Yes, for m only (glyph-idiosyncratic bridging) | Yes -- SS10 m and phrase | No -- matches on the one glyph it helps, adds a regression height scaling can't cause, doesn't generalize | No |
| Span straightening | No | Yes, for m only, same mechanism as widening | Yes -- SS10 m and phrase (worse than widening) | No, same reasoning | No |
| Span smoothing | No | No (m and n both unchanged at SS30) | Yes -- phrase-level SS10 regression with no compensating SS30 gain | No | No |

## 6. Final Conclusion

**C -- No. Evidence now favors production policy over outline modification.**

Supporting evidence:

1. Only 2 of 6 class/glyph combinations moved `clusterCount`, and both were the same glyph ("m")
   under two different classes -- the differentiator was the glyph's own shape, not the
   modification class. "n" was untouched by all three classes despite comparable or larger
   displacement magnitude and a larger relative increase in raw/kept sample count. This is
   glyph-idiosyncratic, not a controllable, generalizable technique.
2. Where it did work, it worked for the wrong reason: not by closing the driving prune-event gap
   (which stayed 2.5-3x over threshold, and grew for m-widen) but through an incidental
   union-find bridge from extra sample density elsewhere in the contour -- an emergent side effect,
   not a predictable response to a deliberate design choice.
3. Both successful cases introduced a new SS10 control regression that height scaling cannot cause
   by construction, since outline edits affect every stone size that renders the glyph, while a
   height override is scoped to one size.
4. Height scaling (already measured, FONT-CAL-001) fixes all three selected glyphs simultaneously,
   with zero SS6/SS10 side effects, using one well-understood global parameter -- against N
   per-glyph bespoke edits of uncertain, unpredictable outcome.

**Proposed next study**: proceed with FONT-DIAG-001's already-recommended
**FONT-POLICY-001 -- SS30 Height Ceiling Policy Study** -- determine, across the full
`diagnose.mjs`-ranked glyph set, the minimum height that resolves fragmentation for each, and
evaluate against real product size constraints whether SS30's committed height ceiling can be
raised. No further outline-modification experiments are recommended by this milestone.

## Appendix -- Tooling

- `tools/font-cal-002/python/modify_glyph_span.py` -- span modification (widen/straighten/smooth),
  reuses FONT-CAL-001's cusp-finding/push-direction helpers directly
- `tools/font-cal-001/python/build_candidate_font.py` -- reused unchanged (already generic)
- `tools/font-cal-002/validate.mjs` -- reuses `../font-cal-001/lib/measureProduction.mjs` directly,
  writes into this milestone's own `output/` directory
- `tools/font-cal-002/compare.mjs` -- Markdown table reporting, can pull FONT-CAL-001 labels into
  the same table via `--cal001`
- `tools/font-diag-001/pipeline-trace.mjs` -- reused unchanged for the driving-prune-event check
- `tools/font-cal-002/output/*.json`, `output/comparison-tables.md` -- measured results this report
  is built from
