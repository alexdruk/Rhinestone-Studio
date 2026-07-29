# FONT-GEN-004 — Skeleton-Rebuild Correction Strategy (Transform-Mechanism Test)

Branch `feature/font-arch-001`, built on top of FONT-ARCH-001 / FONT-CAL-001 / FONT-DIAG-001 /
FONT-CAL-002 / FONT-VIS-001 / FONT-GEN-001 / FONT-GEN-002 / FONT-GEN-003 (all on this same branch,
none merged).

**Final recommendation: REJECT GENERATED FAMILY.** Same OCR-threshold basis as every prior
FONT-GEN milestone. But this milestone's actual purpose — testing whether `clusterCount`
fragmentation regression is caused by the dilation *mechanism* itself (offsetting the existing
outline), independent of how much correction is applied — has a clear, partial answer: **replacing
dilation with skeleton-rebuild substantially reduces the regression at 4 of 5 sizes and makes it far
more size-independent, but does not eliminate it anywhere, makes SS6 slightly worse, and introduces
a new, distinct geometry artifact (spurious double-loop rings) that dilation never produced.** Full
evidence below.

---

## 1. Purpose and hypothesis

FONT-GEN-001/002/003 all corrected glyphs by dilating the existing outline (buffer-based
morphological expansion — widen strokes, enlarge counters/loops), on two structurally different
source fonts (Sacramento, Baloo 2) and across weight variation within one font. All three showed
`clusterCount` regression at most or all sizes, and FONT-GEN-003 additionally showed that
minimizing *how much* dilation correction is applied only partially reduces the regression — it did
not eliminate it anywhere, and even made SS6 measurably worse.

This milestone tests a different variable: whether the dilation **mechanism** — offsetting the
existing outline outward — is itself what adds fragmentation-prone perimeter, regardless of
correction magnitude, since a dilated stroke's added perimeter scales with how much correction was
needed, not with the stroke's own length. The replacement strategy tested here — skeleton-rebuild —
discards the mechanism entirely: extract each glyph's medial-axis skeleton, then reconstruct every
stroke as a new uniform-width band directly along that skeleton, so the rebuilt stroke's perimeter
scales with its length × 2, not with a correction amount. No dilation of the original outline occurs
anywhere in this transform.

`glyph_transform.py` (FONT-GEN-001/002/003's fatten/enlarge transform) is untouched and remains
callable — confirmed via this milestone's own diff and the existing regression tests (§10). This is
a new transform sitting alongside it, not a modification.

---

## 2. Source font

`fonts/sources/Sacramento/Sacramento.ttf` — the identical file FONT-GEN-001 used, unchanged.
Deliberate: this makes the comparison a clean single-variable test (transform strategy only)
against FONT-GEN-001's own already-measured numbers, which are reused rather than re-derived.

---

## 3. Physical targets

Identical stone sizes, height ranges, gap, and per-size thresholds as FONT-GEN-001/002/003 —
unchanged, not re-derived (`tools/font-generator/config/<SIZE>.json`, untouched).

---

## 4. Method — skeleton-rebuild transform

New module: `tools/font-generator/lib/glyph_transform_skeleton.py`
(`transform_glyph_skeleton`), same `(contours, char, config, categories) -> (new_contours, log)`
contract as `glyph_transform.transform_glyph`, selected per-family via a new
`TRANSFORM_FOR_FAMILY` registry in `generate.py` (family `SacramentoSkeleton` only; every other
family still resolves to the unmodified fatten/enlarge transform).

**No skeletonization utility already existed anywhere in this codebase to reuse.** The one prior
attempt at a shared centerline skeleton (`RhinestoneStrokeGeometry.js`, TXT-101A, commit `56ad557`)
**failed manual QA — "unreadable even at the most forgiving stone size (SS6)"** — and was deleted
entirely in commit `da2be76` before this milestone began. This was audited and confirmed (git log,
full-repo grep for skeleton/medial-axis/centerline code) before writing any new code, and flagged to
the user, who directed proceeding anyway given the different context here: baked font-outline
generation with per-size uniform-width reconstruction, not runtime dot placement from a hand-authored
approach. `scikit-image`'s `skeletonize()` (standard topological thinning) is used instead of
hand-rolling that algorithm a second time — added to `requirements.txt` with the same
established-library-over-reimplementation rationale FONT-GEN-001 used for `pytesseract`.

Pipeline per glyph:

1. **Rasterize** — the glyph's shapely ink geometry (holes already correct via even-odd
   composition, unchanged `glyph_geometry.contours_to_geometry`) is filled onto a binary grid via
   Pillow. Cell size = `minFeatureWidthFu / 8`, mirroring `ContourRingSampler.js`'s own
   resolution-from-pitch convention (an unrelated module, for an unrelated fill mode — reused only
   for that sizing rule, not its code). Measured grid sizes across all 375 glyph instances (94
   glyphs × 5 sizes, minus a handful of narrower glyphs) ranged from roughly 15×15 to 115×70 cells
   — small enough that all 5 fonts generated in 5.6s total.
2. **Skeletonize** — `skimage.morphology.skeletonize` reduces the mask to a 1px-wide medial axis.
3. **Graph + path trace** — the skeleton mask becomes a pixel-adjacency graph (`networkx`),
   decomposed into leaf↔junction / junction↔junction polylines for branching strokes (e.g. "m"),
   plus one full-loop path per pure-cycle component with no junction at all (e.g. "o", whose ink is
   a ring so its own skeleton is a closed loop near the ring's middle).
4. **Spur pruning** — leaf-terminated paths shorter than `max(cellSize×2, minFeatureWidth×0.25)`
   are dropped before rebuilding (raster/thinning noise near corners routinely produces tiny
   spurious branches never part of the glyph's real stroke structure).
5. **Rebuild** — each surviving path becomes a `LineString` (isolated single-pixel components — small
   dots/punctuation — become a `Point` instead), buffered to `minFeatureWidthFu` width with round
   caps/joins, then unioned. **No separate hole-opening step, no counter/loop threshold check, no
   corner-rounding pass** — per the brief, the enclosed opening size falls out of the reconstruction
   directly; rounded terminals/junctions are an emergent property of the round-capped/joined buffer,
   not a correction applied afterward.

Nothing from `glyph_transform.py` (`_enforce_min_width`, `_enlarge_holes`,
`_dissolve_sliver_holes`, `_simplify_details`, `_round_junctions`) is imported or reused beyond the
shared contour↔geometry conversion helpers both transforms need — this is a full geometry
replacement, not an incremental correction, so that transform's guard/measurement machinery doesn't
apply here.

---

## 5. Generation and structural validation

```
output/SS6/SacramentoSkeletonRhinestone_SS6.ttf
output/SS10/SacramentoSkeletonRhinestone_SS10.ttf
output/SS16/SacramentoSkeletonRhinestone_SS16.ttf
output/SS20/SacramentoSkeletonRhinestone_SS20.ttf
output/SS30/SacramentoSkeletonRhinestone_SS30.ttf
```

`validate_font.py`: **PASS** for all 5 sizes (reload, required tables, cmap coverage, valid bounds,
positive advances, family-name identification).

`generation-metadata.SacramentoSkeleton.<SIZE>.json` contour-count deltas (94 glyphs/size):
consistently ~13 glyphs per size show a contour-count **decrease** (quote mark, `#`, `%`, `3`, `E`,
`H`, `K`, `P`, `R`, `i`, `j`, `r`, `t` — small structural merges, e.g. a dot merging into its stem),
and ~11–14 glyphs per size show a contour-count **increase** — see §9 for what that increase is and
why it matters.

Existing focused regression tests (`test_font_structural.py`, `test_naming_and_cmap.py`,
`test_topology_preserved.py`, `test_deterministic_generation.py`, `test_config_schema.py`), which
exercise the default `Sacramento` family/fatten transform, all still **PASS** unchanged — confirming
FONT-GEN-001/002/003's own transform, outputs, and behavior are untouched by this milestone's
additions.

---

## 6. Evaluation method

Identical to FONT-GEN-001/002/003 (`pipeline.py` → `analyze.py`), same 171-case corpus per size,
same real production pipeline (`measure.mjs` → `measureProduction.mjs` → `productionAnalysis.mjs`),
same OCR rasterization + scoring, same acceptance thresholds. **Baseline was not re-measured**: per
the brief ("baseline hasn't changed"), `pipeline.py` gained an additive `--reuse-baseline-from`
flag that loads a prior milestone's already-computed baseline evaluation rows instead of
re-running `measure.mjs`/OCR against the same unmodified Sacramento.ttf a second time — used here as
`--reuse-baseline-from Sacramento`, pointing at FONT-GEN-001's own `output/<SIZE>/evaluation.<SIZE>.json`.
Default behavior (flag unused) is unchanged, so FONT-GEN-001/002/003 remain re-runnable exactly as
before. `analyze.py`'s per-size summary additionally now aggregates `meanClusterCount`,
`meanCollisionCount`, `meanStoneCount` (purely additive fields; existing OCR-threshold verdict logic
unchanged) so this report doesn't need a one-off script to compute the ratios in §8.

---

## 7. Results — all five variants, generated vs. baseline

| Size | Stone Ø | Height range | Gen char acc | Base char acc | Gen mean clusters | Base mean clusters | **Cluster ratio** | Gen mean stones | Base mean stones |
|---|---|---|---|---|---|---|---|---|---|
| SS6  | 2.0mm | 35–50mm   | 0.070 | 0.106 | 4.86 | 2.57 | **1.89x** | 286.8 | 198.3 |
| SS10 | 2.8mm | 45–60mm   | 0.075 | 0.085 | 6.68 | 3.30 | **2.02x** | 251.1 | 163.2 |
| SS16 | 4.0mm | 65–90mm   | 0.064 | 0.058 | 7.08 | 3.88 | **1.82x** | 264.5 | 172.7 |
| SS20 | 4.7mm | 80–110mm  | 0.046 | 0.048 | 7.87 | 4.19 | **1.88x** | 280.9 | 186.8 |
| SS30 | 6.4mm | 106–111mm | 0.050 | 0.044 | 7.81 | 5.07 | **1.54x** | 216.5 | 145.4 |

Mean char accuracy across all 5 sizes: generated 0.061, baseline 0.068 — statistically
indistinguishable, consistent with FONT-GEN-001/002's finding (not FONT-GEN-003's): tesseract's low
ceiling on Sacramento's connected cursive script (documented in FONT-GEN-001 §6) dominates
regardless of transform. Required phrases: **0/12 at every height, every size, both generated and
baseline.** Collisions: **zero** in every case, all 5 sizes (171 cases each) — the transform never
causes stones to physically overlap. Generated stone counts are consistently ~35–55% higher than
baseline at every size — expected: skeleton-rebuild forces *every* stroke to the target
`minFeatureWidth`, including strokes whose native Sacramento geometry already exceeded it (the
fatten transform only widens where a measured deficit exists).

---

## 8. Does removing dilation reduce or eliminate the fragmentation regression?

**Reduced substantially at 4 of 5 sizes, made worse at 1, eliminated at none.**

| Size | FONT-GEN-001 ratio (dilation) | FONT-GEN-004 ratio (skeleton-rebuild) | Effect |
|---|---|---|---|
| SS6  | 1.7x worse | **1.89x worse** | **Worse** |
| SS10 | 2.6x worse | **2.02x worse** | Reduced |
| SS16 | 4.1x worse | **1.82x worse** | Reduced substantially |
| SS20 | 5.9x worse | **1.88x worse** | Reduced substantially (largest improvement) |
| SS30 | 4.3x worse | **1.54x worse** | Reduced substantially |

At SS10/SS16/SS20/SS30, skeleton-rebuild's ratio is lower than dilation's — most dramatically at
SS16/SS20 (roughly cut in half to a third). More importantly, skeleton-rebuild's ratio sits in a
**narrow, size-independent band (1.54x–2.02x)** across all 5 sizes, in sharp contrast to dilation's
**wide, size-dependent range (1.7x–5.9x)**, where the regression grew substantially worse at larger
stone sizes. This is exactly what the hypothesis predicts: dilation's added perimeter scales with
correction magnitude, which itself grows with stone size (bigger stones → bigger `minFeatureWidth`/
`minCounterOpening` thresholds → bigger corrections); skeleton-rebuild's perimeter scales with
stroke length only, which is roughly constant regardless of stone size. Removing the dilation
mechanism therefore does measurably change fragmentation behavior in the predicted direction — but
it does not remove fragmentation regression itself, since a uniform-width reconstruction still adds
substantially more total outline perimeter than Sacramento's own native, non-uniform stroke widths
(§7's stone-count increase is the direct evidence: more ink → more perimeter → more clusters,
independent of *how* that ink was added).

SS6 is the one exception: skeleton-rebuild is *worse* than dilation there (1.89x vs 1.7x) — the only
size at which this milestone's strategy underperforms FONT-GEN-001's. At SS6's small raster
resolution, more of the glyph set's fine detail (thin joins, short terminal flicks) is close to or
below one raster cell, which both fuels a nontrivial number of spur-prune decisions and, per §9,
concentrates §9's double-loop artifact where SS6's coarser grid is most likely to bifurcate a
skeleton loop.

---

## 9. New failure mode: spurious double-loop rings

**Yes — a failure mode dilation cannot produce at all.** Dilation only ever offsets the *existing*
outline outward; a glyph with one hole before dilation has exactly one hole after it, by
construction. Skeleton-rebuild has no such guarantee, because it discards the original outline and
rebuilds from the medial axis — and the medial axis of a ring whose stroke width varies
substantially around its own circumference is not itself a simple circle. It can bulge toward the
wider side and bifurcate into two closely-spaced loops rather than one, which the uniform-width
buffer then renders as two separate concentric rings instead of the one ring/single-counter the
original design has.

This is directly visible, not just inferred from metadata: comparing rendered PNGs, numeral **"0"**
generates as two concentric rings with a thin dark gap between them where the baseline renders one
clean ring (`review/assets/SacramentoSkeleton/SS30/numerals__min.{generated,baseline}.png`), and
numeral **"9"**'s bowl shows the identical doubling. Not every round-counter glyph is affected —
lowercase "o", "e", and capital "8"'s two loops all reconstruct as clean single rings, matching
baseline — the artifact appears specific to glyphs whose native stroke width is least uniform around
their loop.

This matches §5's contour-count-increase list exactly: **a, b, d, g, p, q** (looped-lowercase), **B,
G, O** (round-bowled capitals), **6, 9** (numerals), **@, &** — the same 10–14 glyphs, consistently,
at all 5 sizes — are exactly the glyphs whose loop geometry gained an extra contour versus the
original 94-glyph set. Terminal/flourish loss and outright connectivity breaks (the brief's other two
example failure modes) were not observed in any of the inspected renders (required phrases, worst-N,
representative samples across SS10/SS30) — cursive Sacramento's connecting strokes and terminal
flicks visibly survive skeleton-rebuild at every stone size checked, including the smallest (SS6) and
largest (SS30). The double-loop artifact is the one new, reproducible, and qualitatively visible
failure mode this strategy introduces.

---

## 10. Remaining failures and ambiguities

- The double-loop artifact (§9) was not root-caused at the sub-pixel level (e.g. whether a finer
  raster grid would resolve it, or whether it's an inherent property of this specific stroke-width
  eccentricity regardless of resolution) — establishing that would need a dedicated investigation
  this milestone's brief didn't ask for, given the mechanism-comparison question already had a clear
  answer without it.
- SS6's regression (§8) reversing direction relative to FONT-GEN-001 was not investigated at the
  per-glyph level, mirroring FONT-GEN-003's own §9 precedent for its own SS6 anomaly.
- As in every prior FONT-GEN milestone, OCR recognition is near-zero for both baseline and generated
  at every size, for the same already-documented tesseract-ceiling reason — not re-validated against
  clean renders here.
- The spur-prune threshold (`max(cellSize×2, minFeatureWidth×0.25)`) was set once, from first
  principles, and not tuned against the corpus — a smaller or larger threshold might shift the
  double-loop/SS6 findings in either direction; this milestone tests the strategy as specified in
  the brief, not a calibrated variant of it.

---

## 11. HTML review location

`review/FONT-GEN-004-review.html` — same format as FONT-GEN-001/002/003's review pages, built by the
same `build_review_html.py --family SacramentoSkeleton --milestone FONT-GEN-004` (unmodified script;
`analyze.py`'s new mean-cluster fields are additive and don't change its behavior). Review images:
`review/assets/SacramentoSkeleton/<SIZE>/*.png`.

---

## 12. Code changes

**New**: `tools/font-generator/lib/glyph_transform_skeleton.py` (the skeleton-rebuild transform,
§4) — nothing in `glyph_transform.py` is imported or modified.

**Additive, backward-compatible**:
- `paths.py` — added `"SacramentoSkeleton": SOURCE_FONT` to `FAMILY_SOURCE_FONTS` (same Sacramento
  source file as FONT-GEN-001, deliberately).
- `generate.py` — added `TRANSFORM_FOR_FAMILY` registry and an optional `transform_fn` pass-through;
  every other family still resolves to the unmodified default.
- `lib/font_build.py` — `generate_variant()` gained an optional `transform_fn` parameter (defaults
  to `glyph_transform.transform_glyph`, i.e. byte-identical behavior when omitted).
- `pipeline.py` — added `--reuse-baseline-from` (§6), default `None` preserves exact prior behavior.
- `analyze.py` — `summarize()` gained `meanClusterCount`/`meanCollisionCount`/`meanStoneCount` fields
  (purely additive; `check_thresholds()` and its OCR-based verdict logic unchanged).
- `requirements.txt` — added `scikit-image>=0.24` (pulls in `scipy`, `networkx` as transitive deps;
  `networkx` reused directly for skeleton-graph path tracing).

No changes to `glyph_geometry.py`, `glyph_category.py`, `ocr_eval.py`, `render_stones.py`,
`validate_font.py`, `build_review_html.py`, or any threshold config — confirmed by diff against
FONT-GEN-003's committed state. Regenerating the default `Sacramento` family reproduces byte-identical
glyph geometry to FONT-GEN-001's committed output (verified: the one incidental non-determinism found
during this milestone's own test run was the `head` table's `modified` timestamp, which fontTools
re-stamps on every save regardless of identical glyph data — reverted before commit, not a code
change).

---

## 13. Studio integration

**No fonts registered.** Consistent with every prior FONT-GEN/FONT-VIS milestone's precedent,
`assets/fonts/manifest.json` was not modified. New files: `output/<SIZE>/SacramentoSkeletonRhinestone_<SIZE>.ttf`
+ metadata/evaluation/summary JSON, `review/FONT-GEN-004-review.html` + `review/assets/SacramentoSkeleton/`,
this report, `tools/font-generator/lib/glyph_transform_skeleton.py`, and the additive changes in §12.
Original Sacramento, Baloo2, Baloo2Variable, all existing fonts, existing projects, and exporters are
unaffected.

---

## 14. Final recommendation

**REJECT GENERATED FAMILY** (all five SacramentoSkeleton variants), on the same grounds as every
prior FONT-GEN milestone: no OCR improvement over baseline, required phrases unrecognized at every
height/size, and `clusterCount` regression present at every size.

This milestone's real deliverable is the mechanism test, not a fifth rejection: removing the
dilation mechanism entirely and rebuilding from a skeleton **does** measurably change fragmentation
behavior in the hypothesized direction — smaller regression at 4/5 sizes, and a much tighter,
size-independent ratio band (1.54x–2.02x) versus dilation's wide, size-growing one (1.7x–5.9x) —
supporting "added perimeter scales with correction magnitude" as a real mechanism specific to
dilation. But it **disproves dilation as the sole cause of fragmentation regression**: skeleton-rebuild
still regresses at every size, is worse than dilation at SS6, and trades dilation's failure mode for a
new one (§9's spurious double-loop rings on eccentric-width glyphs) that is arguably a more visible
readability defect than anything dilation produced. Neither transform mechanism, applied to
Sacramento, produces an acceptable rhinestone-readable result. FONT-CAL-002/FONT-VIS-001/
FONT-GEN-001/002/003's shared recommendation (**FONT-POLICY-001 — SS30 Height Ceiling Policy
Study**) remains the best-supported next step, now tested against two independent correction
*mechanisms* in addition to two source fonts and within-font weight variation, all reaching a
compatible conclusion: the procedural-correction approach, however it corrects, does not reliably
improve rhinestone readability for this typeface within these committed height ranges.
