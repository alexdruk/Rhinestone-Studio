# FONT-GEN-003 — Per-Size Source Weight Selection (Correction-Magnitude Test)

> **Erratum (FONT-GEN-005):** every OCR/review render in this report was generated upside down
> (`render_stones.py` orientation bug, shared by the review-PNG and OCR-scoring paths). This is the
> most affected of the four FONT-GEN reports: corrected mean character accuracy roughly quadruples
> at every size (e.g. SS10 generated 0.16 → 0.66) and required-phrase recognition goes from 0/12
> everywhere to as high as 7/12 — see `docs/specifications/FONT-GEN-005-OCRRenderOrientationBugFix.md`
> for full corrected tables. The **REJECT recommendation is still unchanged** (no size clears the
> acceptance thresholds even corrected, and `clusterCount` geometry evidence — this report's actual
> mechanism-test finding, §7-§8 — was never affected). §6/§7's "OCR recognition is near-zero... same
> already-documented tesseract-ceiling reason" framing does not hold post-fix: Baloo2Variable's
> corrected baseline reaches up to 0.84 char accuracy and 9/12 required phrases at some sizes,
> genuinely legible to OCR — see FONT-GEN-005 §5's discussion of which typefaces that framing does
> and doesn't hold up for.

Branch `feature/font-arch-001`, built on top of FONT-ARCH-001 / FONT-CAL-001 / FONT-DIAG-001 /
FONT-CAL-002 / FONT-VIS-001 / FONT-GEN-001 / FONT-GEN-002 (all on this same branch, none merged).

**Final recommendation: REJECT GENERATED FAMILY.** All five Baloo2Variable variants are rejected on
the same OCR thresholds FONT-GEN-001/002 applied. But this milestone's actual purpose — testing
whether FONT-GEN-002's "correction magnitude drives fragmentation" mechanism holds when each size is
generated from its own best-fit weight instead of one shared ExtraBold — has a clear, size-dependent
answer: **the fragmentation regression shrank at 4 of 5 sizes, but a small regression appeared at the
one size (SS6) that previously had none.** No size fully eliminated its regression. Full evidence
below.

---

## 1. Purpose and hypothesis

FONT-GEN-002 found Baloo 2 ExtraBold's `clusterCount` regression grew with stone size (0.93x at SS6
up to 3.67x at SS30) and attributed this to correction magnitude: SS6 needed little transform
correction because ExtraBold's native strokes/counters were already close to SS6's thresholds, while
larger sizes forced much bigger corrections.

This milestone tests that mechanism directly: if every size variant is generated from the Baloo 2
weight instance whose *native* (untransformed) geometry is already closest to that size's own
thresholds — rather than instancing every size from the same fixed ExtraBold weight — does correction
magnitude shrink, and does the `clusterCount` regression shrink or disappear with it?

No transform pipeline, threshold, corpus, or evaluation logic was changed. The only variable under
test is which source weight instance each size variant is generated from.

---

## 2. Source fonts

`fonts/sources/Baloo2/Baloo2.ttf` (the original variable font, `wght` 400–800) was instanced to all
five named instances via `fontTools.varLib.instancer.instantiateVariableFont`: 400 (Regular), 500
(Medium), 600 (SemiBold), 700 (Bold), 800 (ExtraBold). Each was saved as
`fonts/sources/Baloo2/Baloo2-wght<weight>.ttf` with its name table relabeled to its actual weight
(`Baloo 2 Regular`, `Baloo 2 Medium`, etc.) — deliberately distinct filenames from FONT-GEN-002's
`Baloo2-Bold.ttf` (which is actually ExtraBold, kept as-is for that milestone's own naming reasons),
to avoid any ambiguity between the two milestones' source files. All five verified static (no `fvar`
table), full ASCII 32–126 cmap coverage, 1000 unitsPerEm, 1601 glyphs — confirmed identical
`unitsPerEm` across every instance, so mm↔fu conversion is weight-independent.

---

## 3. Step 1 — Measuring native metrics per named instance

### 3.1 Method

`tools/font-generator/select_source_weight.py` (new, committed) measures each weight's font-wide
minimum stroke half-width and minimum counter/loop-opening half-width, reusing
`lib.glyph_transform.measure_min_half_width` unchanged — the exact erosion-sweep primitive
`generate.py`'s transform already uses to size its own corrections — over the same ASCII 32–126
glyph set `font_build.py` processes, with holes classified via the existing
`looped-lowercase` category (`lib.glyph_category`).

**A first pass measured fully raw, untransformed outlines directly and was discarded.** It produced a
non-monotonic result — ExtraBold's font-wide minimum stroke half-width came out *thinner* than
Regular's — traced to acute-angle joint notches in specific glyphs (Baloo 2's "z", "k", "R"
diagonal-to-stem joins: a real geometric pinch point, but one `transform_glyph()` itself heals via its
own terminal-simplify opening pass *before* it ever reaches min-width enforcement. This was confirmed
against FONT-GEN-002's own `generation-metadata.Baloo2.SS30.json`: glyph "k" logs no
min-width-enforcement operation at all despite this raw pinch being present in the untransformed
outline.

The script therefore measures at the same point in the pipeline `transform_glyph()` itself measures
from: **post terminal-simplify, post sliver-dissolve** — reusing `_simplify_details` and
`_dissolve_sliver_holes` unchanged, in the same order transform_glyph() runs them, with each size's
own `terminalSimplifyFu`/`stoneDiameterFu` from `generate.py`'s own `resolve_config()` (unmodified,
called directly, calibrated at each size's minimum committed height exactly as real generation is).
This is what "native, as the transform pipeline actually sees it" means in context, and it produced a
clean, monotonic result. No transform-pipeline *behavior* was changed by this — only where the
already-existing measurement function was invoked from, for characterization purposes.

The resulting native fu values were converted to mm using each size's **midpoint** height (not the
minimum height `generate.py` calibrates corrections against), per the brief. Same conversion formula
(`fu_per_mm = unitsPerEm / heightMm`) already used throughout this tool, applied against a different
height input.

### 3.2 Results — 5 weights × 5 sizes

**SS6** (midpoint height 42.5mm) — thresholds: minFeatureWidth 3.3mm, minCounterOpening 5.3mm,
minLoopOpening 6.9mm

| Weight | native FeatureW (mm) | native CounterOp (mm) | native LoopOp (mm) | deficit sum (mm) | clears all? |
|---|---|---|---|---|---|
| Regular (400) | 0.64 | 5.84 | 6.38 | 3.19 | no |
| Medium (500) | 0.96 | 5.31 | 5.84 | 3.40 | no |
| SemiBold (600) | 1.27 | 4.78 | 2.12 | 7.32 | no |
| Bold (700) | 0.32 | 3.72 | 2.66 | 8.81 | no |
| ExtraBold (800) | 0.32 | 3.19 | 2.66 | 9.34 | no |

**SS10** (midpoint height 52.5mm) — thresholds: minFeatureWidth 4.5mm, minCounterOpening 7.3mm,
minLoopOpening 9.5mm

| Weight | native FeatureW (mm) | native CounterOp (mm) | native LoopOp (mm) | deficit sum (mm) | clears all? |
|---|---|---|---|---|---|
| Regular (400) | 0.79 | 7.22 | 7.88 | 5.42 | no |
| Medium (500) | 1.18 | 6.56 | 7.22 | 6.34 | no |
| SemiBold (600) | 1.57 | 5.91 | 2.62 | 11.19 | no |
| Bold (700) | 0.39 | 4.59 | 3.28 | 13.03 | no |
| ExtraBold (800) | 0.39 | 3.94 | 3.28 | 13.69 | no |

**SS16** (midpoint height 77.5mm) — thresholds: minFeatureWidth 6.3mm, minCounterOpening 10.3mm,
minLoopOpening 13.4mm

| Weight | native FeatureW (mm) | native CounterOp (mm) | native LoopOp (mm) | deficit sum (mm) | clears all? |
|---|---|---|---|---|---|
| Regular (400) | 1.16 | 10.66 | 11.62 | 6.91 | no |
| Medium (500) | 1.74 | 9.69 | 10.66 | 7.91 | no |
| SemiBold (600) | 2.33 | 8.72 | 3.88 | 15.08 | no |
| Bold (700) | 0.58 | 6.78 | 4.84 | 17.79 | no |
| ExtraBold (800) | 0.58 | 5.81 | 4.84 | 18.76 | no |

**SS20** (midpoint height 95.0mm) — thresholds: minFeatureWidth 7.35mm, minCounterOpening 12.05mm,
minLoopOpening 15.7mm

| Weight | native FeatureW (mm) | native CounterOp (mm) | native LoopOp (mm) | deficit sum (mm) | clears all? |
|---|---|---|---|---|---|
| Regular (400) | 1.43 | 13.06 | 14.25 | 7.38 | no |
| Medium (500) | 2.14 | 11.88 | 13.06 | 8.03 | no |
| SemiBold (600) | 2.85 | 10.69 | 4.75 | 16.81 | no |
| Bold (700) | 0.71 | 8.31 | 5.94 | 20.14 | no |
| ExtraBold (800) | 0.71 | 7.12 | 5.94 | 21.32 | no |

**SS30** (midpoint height 108.5mm) — thresholds: minFeatureWidth 9.9mm, minCounterOpening 16.3mm,
minLoopOpening 21.2mm

| Weight | native FeatureW (mm) | native CounterOp (mm) | native LoopOp (mm) | deficit sum (mm) | clears all? |
|---|---|---|---|---|---|
| Regular (400) | 1.63 | 14.92 | 16.27 | 14.58 | no |
| Medium (500) | 2.44 | 13.56 | 14.92 | 16.48 | no |
| SemiBold (600) | 3.25 | 12.21 | 5.42 | 26.51 | no |
| Bold (700) | 0.81 | 9.49 | 6.78 | 30.31 | no |
| ExtraBold (800) | 0.81 | 8.14 | 6.78 | 31.67 | no |

**No named weight instance clears all three thresholds at any size, at either the minimum or the
midpoint calibration height** — the deficit sum is positive for every weight at every size (flagged
per the brief rather than silently defaulted). The pattern is consistent across all 5 sizes: lighter
weights have thinner strokes (larger `minFeatureWidth` deficit) but wider-open counters/loops (smaller
or zero `minCounterOpening`/`minLoopOpening` deficit); heavier weights invert this. `minLoopOpening`
is the dominant deficit for every weight at 600/700/800 — Baloo 2's loops close in substantially as
weight increases, while `minFeatureWidth`'s deficit changes comparatively little across weights at a
given size (700 and 800 in particular measure identically on this metric at every size, i.e. that
specific stroke feature doesn't continue thinning between Bold and ExtraBold in this font's variable
axis, even though loops keep closing).

---

## 4. Step 2 — Weight selection per size

Selection criterion: the weight minimizing the **sum** of the three positive per-metric deficits (not
just the single worst metric) — this tracks total additional outline perimeter/area the transform
would need to add across stroke widening *and* hole enlargement combined, which is what FONT-GEN-002's
mechanism hypothesis is actually about. Ties would break toward the lighter weight; no ties occurred.

| Size | Selected weight | Selected deficit sum | ExtraBold deficit sum (FONT-GEN-002's weight) | Reduction |
|---|---|---|---|---|
| SS6  | **Regular (400)** | 3.19mm | 9.34mm | 66% smaller |
| SS10 | **Regular (400)** | 5.42mm | 13.69mm | 60% smaller |
| SS16 | **Regular (400)** | 6.91mm | 18.76mm | 63% smaller |
| SS20 | **Regular (400)** | 7.38mm | 21.32mm | 65% smaller |
| SS30 | **Regular (400)** | 14.58mm | 31.67mm | 54% smaller |

Regular (400) was selected at every size — not a hardcoded default (per §3.2, no weight fully clears
thresholds, so this is a genuine minimum, not a fallback), but a consistent outcome of the same
per-size independent minimization at all 5 sizes. Regular's own deficit is far from zero (3.2–14.6mm
total across the 3 metrics), but at every size it is the smallest available correction pressure among
the 5 named instances, and 54–66% smaller than what ExtraBold required for that same size.

---

## 5. Step 3 — Generation and structural validation

Generated from `paths.py`'s new per-size `FAMILY_SIZE_SOURCE_FONTS["Baloo2Variable"]` registry (all 5
sizes pointing at `Baloo2-wght400.ttf`, since Regular was selected everywhere), same unmodified
transform pipeline and per-size thresholds as FONT-GEN-001/002:

```
output/SS6/Baloo2VariableRhinestone_SS6.ttf
output/SS10/Baloo2VariableRhinestone_SS10.ttf
output/SS16/Baloo2VariableRhinestone_SS16.ttf
output/SS20/Baloo2VariableRhinestone_SS20.ttf
output/SS30/Baloo2VariableRhinestone_SS30.ttf
```

`validate_font.py`: **PASS** for all 5 sizes (reload, required tables, cmap coverage, valid bounds,
positive advances, family-name identification). `generation-metadata.Baloo2Variable.<SIZE>.json`
shows **zero** contour-count-decrease warnings at any size — same clean topology result FONT-GEN-002
found for Baloo 2 ExtraBold.

---

## 6. Evaluation method

Identical to FONT-GEN-001/002 (`pipeline.py` → `analyze.py`), reused unchanged: same 171-case corpus
per size, same real production pipeline (`measure.mjs` → `measureProduction.mjs` →
`productionAnalysis.mjs`), same OCR rasterization + scoring, same acceptance thresholds (mean char
accuracy ≥0.85, mean word accuracy ≥0.80, required-phrase accuracy 1.0, unrecognized-sample fraction
≤0.15).

---

## 7. Results — all five variants, generated vs. baseline

| Size | Selected weight | Gen char acc | Base char acc | Gen req. phrases | Base req. phrases | Gen mean clusters | Base mean clusters | **Cluster ratio** | Gen mean stones | Base mean stones |
|---|---|---|---|---|---|---|---|---|---|---|
| SS6  | Regular | 0.169 | 0.175 | 0/12 | 0/12 | 8.50  | 7.86 | **1.08x** | 276.3 | 271.7 |
| SS10 | Regular | 0.162 | 0.170 | 0/12 | 0/12 | 10.58 | 7.06 | **1.50x** | 240.0 | 244.9 |
| SS16 | Regular | 0.117 | 0.163 | 0/12 | 0/12 | 18.23 | 8.51 | **2.14x** | 243.6 | 257.5 |
| SS20 | Regular | 0.093 | 0.173 | 0/12 | 0/12 | 21.12 | 8.87 | **2.38x** | 254.4 | 273.2 |
| SS30 | Regular | 0.072 | 0.152 | 0/12 | 0/12 | 16.64 | 7.11 | **2.34x** | 200.7 | 225.2 |

Mean char accuracy across all 5 sizes: generated 0.123, baseline 0.167 — unlike FONT-GEN-001/002
(where generated and baseline were statistically indistinguishable), generated here is *consistently
lower* than baseline at every size, a real degradation rather than noise, and another independent
signal against acceptance. Required phrases: **0/12 at every height, every size, both generated and
baseline** — same tesseract-ceiling limitation already documented in FONT-GEN-001 §6/FONT-GEN-002 §8,
not re-derived here.

Collisions: **zero** in every case, both generated and baseline, at all 5 sizes (171 cases each) —
same as FONT-GEN-001/002, the transform never causes physical stone overlap.

---

## 8. Step 4 — Does per-size weight selection reduce the fragmentation regression?

**Partially — smaller at 4 of 5 sizes, but SS6 regressed for the first time.** Per-size comparison
against FONT-GEN-002 (fixed ExtraBold for all 5 sizes):

| Size | FONT-GEN-002 (fixed ExtraBold) | FONT-GEN-003 (per-size selected weight) | Effect |
|---|---|---|---|
| SS6  | 0.93x — no regression | **1.08x — small regression appeared** | **Worse** |
| SS10 | 1.88x worse | **1.50x worse** | Reduced (20% smaller gap above 1.0x) |
| SS16 | 2.43x worse | **2.14x worse** | Reduced |
| SS20 | 3.16x worse | **2.38x worse** | Reduced |
| SS30 | 3.67x worse | **2.34x worse** | Reduced, largest improvement |

At SS10/SS16/SS20/SS30 — the four sizes where FONT-GEN-002 found a regression — per-size weight
selection **reduced** it at every one, most substantially at SS30 (3.67x → 2.34x). This is consistent
with, and further supports, FONT-GEN-002's correction-magnitude mechanism: Regular's smaller total
deficit (§4) than ExtraBold's at every size tracks directly with a smaller `clusterCount` ratio at
4 of 5 sizes.

But the regression was **not eliminated at any size**, and at SS6 — the one size FONT-GEN-002 found
*no* regression at (0.93x, generated fragmentation slightly better than baseline) — per-size selection
introduced a small one (1.08x). Regular's own deficit at SS6 is still substantial (3.19mm total, §3.2)
— smaller than ExtraBold's 9.34mm, but not small enough, or differently distributed across the 3
metrics (SS6's minLoopOpening deficit for Regular, 0.53mm, is proportionally non-trivial against a
2.0mm stone diameter) that some correction was still needed and still fragmented some clusters that
ExtraBold's own (differently-shaped) SS6 correction had not.

The overall pattern supports "correction magnitude drives fragmentation" as a real, general mechanism
— smaller total correction correlates with smaller regression at 4/5 sizes — but disproves it as a
*complete* explanation: correction magnitude is not the only variable, since the smallest-magnitude
selection at SS6 still produced a worse outcome than FONT-GEN-002's larger-magnitude ExtraBold
correction did at that same size. Something about *which* metric the correction targets (stroke vs.
counter vs. loop) or the specific glyphs affected, not just the total mm of correction, also matters.

---

## 9. Remaining failures and ambiguities

- The SS6 regression (§8) was not investigated further — isolating exactly which glyph(s) fragment
  differently between ExtraBold-at-SS6 and Regular-at-SS6 would require per-glyph cluster attribution
  this milestone's evaluation pipeline does not produce, and the brief's stated question (does
  correction magnitude reduce the regression) already has a clear, if partial, answer without it.
- Selection was based on total deficit *sum* across all 3 metrics (§4); a max-of-3 or weighted
  criterion might select differently, particularly at sizes where one metric dominates. This
  milestone did not test alternate selection criteria — the brief specifies "smallest positive
  correction," and sum was chosen as the most direct proxy for total added outline perimeter (the
  quantity FONT-GEN-002's mechanism hypothesis is actually about); this choice is stated explicitly
  in §4 rather than left implicit.
- As in FONT-GEN-001/002, OCR recognition is near-zero for both baseline and generated at every size,
  for the same already-documented tesseract-ceiling reason — not re-validated against clean renders
  here.

---

## 10. HTML review location

`review/FONT-GEN-003-review.html` — same format as FONT-GEN-001/002's review pages, built by the same
`build_review_html.py --family Baloo2Variable --milestone FONT-GEN-003`. Review images:
`review/assets/Baloo2Variable/<SIZE>/*.png`. The page subtitle lists the actual per-size source
(`Baloo2-wght400.ttf` at every size, since Regular was selected everywhere) rather than one global
source name, since `build_review_html.py` was extended to detect per-size-source families.

---

## 11. Code changes

`tools/font-generator/paths.py`: added `FAMILY_SIZE_SOURCE_FONTS` (a per-size registry, distinct from
the existing per-family `FAMILY_SOURCE_FONTS`) and `Baloo2Variable`'s 5-entry mapping; `source_font_for()`
gained an optional `size_id` parameter, checked against the new registry first, falling back to the
existing single-path-per-family behavior unchanged for `Sacramento`/`Baloo2` (verified: neither
FONT-GEN-001 nor FONT-GEN-002's own artifacts, filenames, or invocations changed).

`generate.py`, `pipeline.py`, `build_review_html.py`: each of their 3 `source_font_for(family)` call
sites now passes the size being processed (`source_font_for(family, size_id)`), a pure additive
parameter — every existing call for `Sacramento`/`Baloo2` is unaffected since those families aren't in
the new per-size registry. `build_review_html.py`'s page-subtitle logic was extended to describe a
per-size source instead of one global name when the family requires it.

`tools/font-generator/select_source_weight.py` (new): the Step 1/2 measurement-and-selection script
described in §3–4, committed since it's the actual mechanism by which the per-size registry in
`paths.py` was derived and reproducibility requires it stay available. No changes to
`glyph_transform.py`, `glyph_geometry.py`, `glyph_category.py`, `font_build.py`, `analyze.py`,
`ocr_eval.py`, `render_stones.py`, or any threshold config — confirmed by diff against FONT-GEN-002's
committed state.

---

## 12. Studio integration

**No fonts registered.** Consistent with FONT-GEN-001/002/FONT-VIS-001's precedent, `assets/fonts/manifest.json`
was not modified. New files: `fonts/sources/Baloo2/Baloo2-wght{400,500,600,700,800}.ttf` (the 5
instanced static fonts), `output/<SIZE>/` family-qualified artifacts, `review/FONT-GEN-003-review.html`
+ `review/assets/Baloo2Variable/`, this report, `tools/font-generator/select_source_weight.py`, and the
per-size-source additions to `paths.py`/`generate.py`/`pipeline.py`/`build_review_html.py` described in
§11. Original Baloo 2, Sacramento, `Baloo2-Bold.ttf` (FONT-GEN-002's ExtraBold instance), all existing
fonts, existing projects, and exporters are unaffected.

---

## 13. Final recommendation

**REJECT GENERATED FAMILY** (all five Baloo2Variable variants), on the same grounds as
FONT-GEN-001/002: no OCR improvement over baseline (generated char accuracy is in fact consistently
*lower* than baseline here — §7), required phrases unrecognized at every height/size, and
`clusterCount` regression present at every size.

This milestone's real deliverable is the mechanism test, not a third rejection: per-size best-fit
weight selection **partially confirms** FONT-GEN-002's correction-magnitude hypothesis — the
regression shrank 20–37 percentage points of ratio at the 4 sizes that had one (most at SS30, least at
SS10) — but also **disproves it as a complete explanation**, since the size with the smallest
selected-weight correction (SS6) went from no regression under ExtraBold to a small one under Regular.
Correction magnitude is a real contributing factor, not the only one. FONT-CAL-002/FONT-VIS-001/
FONT-GEN-001/FONT-GEN-002's shared recommendation (**FONT-POLICY-001 — SS30 Height Ceiling Policy
Study**) remains the best-supported next step: three independent tests (two source fonts, plus this
milestone's within-font weight variation) now agree the procedural fatten/enlarge approach does not
reliably improve rhinestone readability and frequently worsens `StoneLayout` fragmentation, regardless
of how the source geometry is chosen going in.
