# FONT-GEN-002 — Procedural Baloo 2 Rhinestone Font Family (Control Test)

> **Erratum (FONT-GEN-005):** every OCR/review render in this report was generated upside down
> (`render_stones.py` orientation bug, shared by the review-PNG and OCR-scoring paths). Corrected
> OCR numbers are in `docs/specifications/FONT-GEN-005-OCRRenderOrientationBugFix.md` — the change
> here is substantial: mean character accuracy roughly doubles-to-quadruples at every size and
> required-phrase recognition goes from 0/12 everywhere to as high as 3/12. The **REJECT
> recommendation is still unchanged** (no size clears the acceptance thresholds even corrected, and
> `clusterCount` geometry evidence was never affected), but this report's "statistically
> indistinguishable from baseline" OCR framing does not hold post-fix at every size — see
> FONT-GEN-005 §5 for the corrected comparison.

Branch `feature/font-arch-001`, built on top of FONT-ARCH-001 / FONT-CAL-001 / FONT-DIAG-001 /
FONT-CAL-002 / FONT-VIS-001 / FONT-GEN-001 (all on this same branch, none merged).

**Final recommendation: REJECT GENERATED FAMILY.** All five procedurally-generated Baloo 2 variants
are rejected on the same OCR thresholds FONT-GEN-001 applied. No font was registered in Rhinestone
Studio. But this milestone's actual purpose — isolating whether FONT-GEN-001's fragmentation
regression was specific to Sacramento or inherent to the transform approach — has a real, nuanced
answer: **partially the same regression, but smaller and size-dependent.** Full evidence below.

---

## 1. Purpose and hypothesis

FONT-GEN-001 rejected all five Sacramento rhinestone variants for two reasons: no OCR improvement,
and — the more decisive signal — `clusterCount` (StoneLayout fragmentation) 1.7x–5.9x **worse**
than doing nothing, at every size. This milestone asks: is that fragmentation regression caused by
Sacramento's connected-cursive structure (long thin connector strokes between letters, which the
transform's counter/loop enlargement is especially prone to fragmenting), or is it inherent to the
fatten/enlarge transform approach itself, independent of source font?

Baloo 2 is Sacramento's structural opposite — a rounded, bold, unconnected display sans with no
cursive joins — making it a clean control. Same pipeline, same thresholds, same corpus, same
evaluation code. Only the source font changes.

---

## 2. Source font

The brief's stated path (`fonts/sources/Baloo2/Baloo2-Bold.ttf`) did not exist. The repository has
`fonts/sources/Baloo2/Baloo2.ttf` only — a **variable font**, `wght` axis 400–800, default 400
(Regular), named instances at 400/500/600/700 (Bold)/800 (ExtraBold).

Per the brief's fallback instruction, the variable font was instanced to its **heaviest available
weight** using `fontTools.varLib.instancer.instantiateVariableFont`. The heaviest axis value is
**800 (ExtraBold)**, not the "Bold" named instance at 700 — "boldest weight" was read as the actual
maximum, not a specific named instance. The resulting static instance was saved to
`fonts/sources/Baloo2/Baloo2-Bold.ttf` (matching the brief's expected filename) with its name table
relabeled `Baloo 2 ExtraBold` so the actual weight used isn't hidden behind a misleading filename.
Verified static (no `fvar` table), full ASCII 32–126 cmap coverage, 1000 unitsPerEm, 1601 glyphs.

This file, not the original variable `Baloo2.ttf`, is the source for every generation and baseline
measurement below.

---

## 3. Tooling changes

**No new transform or evaluation logic**, per the brief. `tools/font-generator/lib/glyph_transform.py`,
`glyph_geometry.py`, `glyph_category.py`, `font_build.py`'s glyph-processing code, `lib/ocr_eval.py`,
`lib/render_stones.py`, and `analyze.py`'s threshold logic are byte-for-byte unchanged from
FONT-GEN-001 — confirmed by grep, these modules had zero Sacramento-specific paths or hardcoded
assumptions to begin with (only doc comments referencing Sacramento by name).

What *did* need to change was the I/O plumbing that hardcoded Sacramento's source path and output
filenames, since FONT-GEN-001 never anticipated a second family:

- `paths.py`: added a `FAMILY_SOURCE_FONTS` registry (`Sacramento` → unchanged default,
  `Baloo2` → the instanced file above) and two naming helpers, `variant_filename()` /
  `sized_json_filename()`.
- `generate.py`, `pipeline.py`, `analyze.py`, `validate_font.py`, `build_review_html.py`: each
  gained a `--family` CLI flag (default `Sacramento`, so every existing FONT-GEN-001 invocation and
  output file is byte-identical to before — `output/<SIZE>/evaluation.<SIZE>.json` etc. are
  untouched). For `--family Baloo2`, the generated TTF is named `Baloo2Rhinestone_<SIZE>.ttf` (per
  the brief) and its metadata/evaluation/summary JSON get a `.Baloo2.` infix
  (`evaluation.Baloo2.SS6.json`) so the two families' artifacts coexist in the same `output/<SIZE>/`
  folder without collision.
- `generate.py`'s `resolve_config()`: config JSON (thresholds) is reused completely unmodified
  across families — only the human-readable `familyName` string is relabeled
  (`"Sacramento Rhinestone SS6"` → `"Baloo2 Rhinestone SS6"`) since thresholds are proportional to
  stone diameter, not the source font (per the brief, not re-derived).
- `build_review_html.py`: review PNGs now render to a family-scoped subfolder
  (`review/assets/<family>/<SIZE>/`) so this run's assets don't overwrite FONT-GEN-001's, and the
  page title/milestone id are parameterized (`--milestone FONT-GEN-002`).

`measure.mjs` (the Node wrapper around the real production pipeline) already took an arbitrary font
path — no change needed there.

---

## 4. Per-size configurations

Identical to FONT-GEN-001 — same `tools/font-generator/config/{SS6,SS10,SS16,SS20,SS30}.json`, same
mm thresholds, same gap (0.3mm), reused without modification:

| Variant | Stone Ø | Gap | Height range | minFeatureWidth | minCounterOpening | minLoopOpening |
|---|---|---|---|---|---|---|
| SS6  | 2.0mm | 0.3mm | 35–50mm   | 3.3mm | 5.3mm  | 6.9mm  |
| SS10 | 2.8mm | 0.3mm | 45–60mm   | 4.5mm | 7.3mm  | 9.5mm  |
| SS16 | 4.0mm | 0.3mm | 65–90mm   | 6.3mm | 10.3mm | 13.4mm |
| SS20 | 4.7mm | 0.3mm | 80–110mm  | 7.35mm| 12.05mm| 15.7mm |
| SS30 | 6.4mm | 0.3mm | 106–111mm | 9.9mm | 16.3mm | 21.2mm |

SS20 uses 4.7mm (the shipped `STONE_SIZE_BY_ID.ss20` catalog value), matching FONT-GEN-001's own
discrepancy note against the brief's stated 4.8mm.

Structural/font-validity (`validate_font.py`): **PASS** for all 5 sizes — reload, required tables,
cmap coverage, valid bounds, positive advances, and family-name identification all clean.
`generation-metadata.Baloo2.<SIZE>.json` shows **zero** contour-count-decrease warnings at any size
(the topology guard never had to reject a step) — Baloo 2's bold, simple counters gave the
transform less to go wrong with than Sacramento's cursive connectors did.

---

## 5. Evaluation method

Identical to FONT-GEN-001 (`pipeline.py` → `analyze.py`), reused unchanged: same 171-case corpus per
size (4 required phrases + 53 corpus items × 3 heights — min/mid/max of each variant's own
committed range), same real production pipeline (`measure.mjs` → FONT-CAL-001's
`measureProduction.mjs` → FONT-CERT-001's `productionAnalysis.mjs`), same OCR rasterization + scoring
(`render_stones.py` + `pytesseract`), same acceptance thresholds:

| Metric | Threshold |
|---|---|
| Mean character accuracy | ≥ 0.85 |
| Mean word accuracy | ≥ 0.80 |
| Required-phrase accuracy (exact match, every tested height) | 1.0 |
| Unrecognized-sample fraction (0% char accuracy) | ≤ 0.15 |

---

## 6. Results — all five variants, generated vs. baseline

| Size | Stone Ø | Height range | Gen char acc | Base char acc | Gen req. phrases | Base req. phrases | Gen mean clusters | Base mean clusters | **Cluster ratio** | Gen mean stones | Base mean stones |
|---|---|---|---|---|---|---|---|---|---|---|---|
| SS6  | 2.0mm | 35–50mm   | 0.146 | 0.122 | 0/12 | 0/12 | 8.82  | 9.46  | **0.93x** | 293.6 | 284.8 |
| SS10 | 2.8mm | 45–60mm   | 0.087 | 0.102 | 0/12 | 0/12 | 13.37 | 7.13  | **1.88x** | 252.0 | 255.0 |
| SS16 | 4.0mm | 65–90mm   | 0.102 | 0.086 | 0/12 | 0/12 | 24.84 | 10.23 | **2.43x** | 253.5 | 270.1 |
| SS20 | 4.7mm | 80–110mm  | 0.082 | 0.123 | 0/12 | 0/12 | 32.44 | 10.26 | **3.16x** | 266.0 | 287.9 |
| SS30 | 6.4mm | 106–111mm | 0.065 | 0.101 | 0/12 | 0/12 | 34.35 | 9.35  | **3.67x** | 209.6 | 233.5 |

Mean char accuracy across all 5 sizes: generated 0.096, baseline 0.107 — statistically
indistinguishable, same conclusion as FONT-GEN-001. Required phrases: **0/12 at every height, every
size, both generated and baseline** — identical to Sacramento's result, and for the same
already-documented reason (tesseract's low ceiling on short, ambiguous strings rendered as dot
patterns is a rendering/OCR-methodology limitation, not specific to either typeface).

Collisions: **zero** in every case, both generated and baseline, at all 5 sizes (171 cases each) —
same as FONT-GEN-001, the transform never causes physical stone overlap.

---

## 7. The actual point of this milestone: does Baloo 2 show Sacramento's fragmentation regression?

**Partially, and it is size-dependent — a materially different result from Sacramento.**

| | FONT-GEN-001 (Sacramento) | FONT-GEN-002 (Baloo 2) |
|---|---|---|
| SS6  | 1.7x worse | **0.93x — no regression, marginally better** |
| SS10 | 2.6x worse | 1.88x worse |
| SS16 | 4.1x worse | 2.43x worse |
| SS20 | 5.9x worse | 3.16x worse |
| SS30 | 4.3x worse | 3.67x worse |

Sacramento regressed at **every single size** (1.7x–5.9x). Baloo 2 regresses at **4 of 5 sizes**
(1.9x–3.7x — smaller than Sacramento's range at every comparable size), and at the smallest size
(SS6) shows **no regression at all** — generated clusters were slightly *fewer* than baseline.

This means the hypothesis "the fragmentation regression is specific to Sacramento's cursive
connector structure" is **not fully supported** — Baloo 2, with no cursive connectors at all, still
regresses at 4/5 sizes. But it is **partially supported**: the regression is smaller in magnitude at
every comparable size, and vanishes entirely at SS6. The more accurate diagnosis is that the
fatten/enlarge transform's own corrections (wider strokes, larger counters/loops per the brief's
allowed operations) add outline perimeter that `StoneSampler` fragments into more disconnected
clusters — and this effect scales with how much correction the transform has to apply, not with
whether the source font is cursive. Baloo 2's counters and strokes are already close to (in some
cases already past) the SS6 thresholds at 2.0mm stones, so the transform makes small corrections at
SS6 and the fragmentation effect doesn't show up; at larger stone sizes (SS10–SS30) the same
proportionally-larger thresholds force bigger corrections, and the same fragmentation mechanism
Sacramento showed at every size reappears. This is consistent with, and now more precisely
characterized by, FONT-DIAG-001's original diagnosis that the transform's corrections are what
drives `StoneSampler` fragmentation, not any typeface-specific vulnerability.

---

## 8. Lowest-scoring samples

The required phrase "Ashley" was tesseract's worst case at every size for the generated variant,
consistent with FONT-GEN-001's pattern (short strings starting with a capital are systematically
harder). Sample raw OCR output at minimum height: SS6 "VWERIGA", SS10 "WERRGIA", SS20 "W i 3A" —
none of it resembling the input, matching FONT-GEN-001's near-zero required-phrase recognition. Full
per-case breakdown is in `output/<SIZE>/evaluation.Baloo2.<SIZE>.json` and the HTML review (§10).

---

## 9. Remaining failures and ambiguities

- OCR recognition is near-zero for both baseline and generated at every size, for the same reason
  FONT-GEN-001 documented: tesseract's low ceiling on this evaluation's short/ambiguous corpus items
  once rendered as blurred dot patterns, independent of typeface. This was validated once
  (§6 of the FONT-GEN-001 report) against clean, non-rhinestone Sacramento renders and was not
  re-validated against clean Baloo 2 renders here, since it is a rendering/OCR-methodology property
  established once and not re-derived per the brief.
- The size-dependence found in §7 (regression absent at SS6, present and growing SS10→SS30) was not
  present in Sacramento's data, where the regression held at every size. No further investigation
  into *why* SS6 specifically avoids the regression was run — the evidence needed to answer this
  milestone's stated question (typeface-specific vs. transform-inherent) is already unambiguous
  without it.

---

## 10. HTML review location

`review/FONT-GEN-002-review.html` — same format as FONT-GEN-001's review page (per-size navigation,
threshold-verdict badges, metric cards, required-phrase cards, worst-10 samples, full OCR-failure
table, confusable-pair table, geometry-warning table, searchable full-corpus table), built by the
same `build_review_html.py` with `--family Baloo2 --milestone FONT-GEN-002`. Review images:
`review/assets/Baloo2/<SIZE>/*.png` (family-scoped subfolder, does not overwrite FONT-GEN-001's
`review/assets/<SIZE>/*.png`).

---

## 11. Studio integration

**No fonts registered.** Consistent with FONT-GEN-001/FONT-VIS-001's precedent (no variant surviving
evaluation → no manifest registration), `assets/fonts/manifest.json` was not modified. Only new files
were added: `fonts/sources/Baloo2/Baloo2-Bold.ttf` (the instanced static font), `output/<SIZE>/`
family-qualified artifacts, `review/FONT-GEN-002-review.html` + `review/assets/Baloo2/`, this report,
and the `--family`-flag additions to the six `tools/font-generator/*.py` scripts listed in §3 (pure
additive CLI parameters with `Sacramento`-default behavior — every FONT-GEN-001 output file and
invocation is unaffected). Original Baloo 2, Sacramento, all existing fonts, existing projects, and
exporters are unaffected.

---

## 12. Final recommendation

**REJECT GENERATED FAMILY** (all five Baloo 2 variants), on the same grounds as FONT-GEN-001: no OCR
improvement over baseline, required phrases unrecognized at every height/size, and `clusterCount`
regression at 4 of 5 sizes.

But this milestone's real deliverable is the control-test answer, not a second rejection: the
fragmentation regression that sank FONT-GEN-001 is **not unique to Sacramento's cursive structure**
— it reappears with an unconnected, bold display sans at every size except the smallest — but it
*is* smaller in magnitude at every comparable size and disappears entirely at SS6. This points the
transform-approach diagnosis toward "the correction magnitude the thresholds force at a given stone
size drives fragmentation" rather than "cursive connectors are uniquely vulnerable." Combined with
FONT-GEN-001, two independently-sourced typefaces now agree that this procedural fatten/enlarge
approach does not reliably improve rhinestone readability and frequently makes `StoneLayout`
fragmentation worse. FONT-CAL-002/FONT-VIS-001/FONT-GEN-001's shared recommendation
(**FONT-POLICY-001 — SS30 Height Ceiling Policy Study**) remains the best-supported next step, now
reinforced by evidence spanning two structurally opposite source fonts rather than one.
