# FONT-GEN-001 — Procedural Sacramento Rhinestone Font Family

> **Erratum (FONT-GEN-005):** every OCR/review render in this report was generated upside down
> (`render_stones.py` orientation bug, shared by the review-PNG and OCR-scoring paths). The bug is
> fixed and this milestone's OCR evidence was re-measured against the same TTFs — see
> `docs/specifications/FONT-GEN-005-OCRRenderOrientationBugFix.md` for corrected numbers. The
> **REJECT recommendation below is unchanged** (geometry/clusterCount evidence was never affected
> and remains independently sufficient), but §6/§8/§9's specific OCR percentages, quoted failure
> examples ("Ashley" → "Alley" etc.), and the "tesseract ceiling" framing should be read via
> FONT-GEN-005's corrected tables, not trusted as originally stated here.

Branch `feature/font-arch-001`, built on top of FONT-ARCH-001 / FONT-CAL-001 / FONT-DIAG-001 /
FONT-CAL-002 / FONT-VIS-001 (all on this same branch, none merged).

**Final recommendation: REJECT GENERATED FAMILY.** All five procedurally-generated variants are
rejected. No font was registered in Rhinestone Studio. Full evidence and reasoning below.

---

## 1. Implementation approach

Sacramento's glyph outlines were transformed procedurally (fontTools + shapely morphological
operations — contour offsetting, minimum-width enforcement, counter/loop enlargement, corner
rounding, small-detail removal), independently for each of five stone-size targets, then evaluated
against the **real, unmodified production pipeline** (the same `FontManager → OpenTypeProvider →
GeometryEngine.generateTextLayout()` path the Studio itself uses) using automated OCR-based
readability scoring plus the geometry metrics (`clusterCount`, `collisionCount`) already established
by FONT-CERT-001/002.

This deliberately differs in kind from FONT-CAL-001/002 (which nudged single vertices or short
contiguous spans by hand-selected heuristics, and were rejected for not generalizing) — this
milestone applies **systematic, category-driven, glyph-scale corrections measured against real mm
thresholds**, validated with real OCR rather than the `clusterCount` heuristic alone. That
methodological upgrade is real and is documented below — but the measured result is the same
conclusion FONT-CAL-002 and FONT-VIS-001 already reached: **Sacramento does not survive rhinestone
optimization within these committed height ranges**, now with substantially more rigorous evidence
than before.

### Source-path discrepancy

The brief specifies `/Users/alex/Documents/rhinestone-studio/fonts/Sacramento-Regular.ttf`. That
path does not exist in this repository. The actual Sacramento source (used by every prior FONT-CAL-*
milestone) is `fonts/sources/Sacramento/Sacramento.ttf`. All five variants were generated from that
file.

### Stone-diameter discrepancy

The brief's table lists SS20 at 4.8mm. The repository's shipped stone-size catalog
(`src/renderer/StoneSizes.js`, `STONE_SIZE_BY_ID.ss20`) uses **4.7mm**. All generation and
evaluation for SS20 used 4.7mm, since 4.8mm would not correspond to any real stone size the
production pipeline recognizes (`analyzeOne()` looks up `stoneSizeMm` by `stoneSizeId`, not a raw
number).

---

## 2. Dependencies

`tools/font-generator/requirements.txt` (installed into `tmp/font-generator-venv/`, not committed):

```
fontTools==4.63.0
numpy>=1.26,<3
shapely>=2.0,<3
Pillow>=10.0
pytesseract>=0.3.10
```

**OCR engine**: `pytesseract` wrapping the system `tesseract` binary (already installed on this
machine, MIT-licensed, actively maintained), not PaddleOCR/EasyOCR — those require multi-GB
PyTorch/ONNX downloads for a task tesseract handles adequately and is already available.
`skia-pathops` was considered for glyph boolean ops but shapely's `buffer()` covers every
transform this milestone needed (offset, morphological open/close, round joins) without an
additional native dependency.

Setup:

```
python3 -m venv tmp/font-generator-venv
tmp/font-generator-venv/bin/pip install -r tools/font-generator/requirements.txt
```

---

## 3. Transformation pipeline

`tools/font-generator/lib/glyph_transform.py`, applied per-glyph (ASCII 32–126 only — everything
the corpus/required phrases need; every other glyph, table, and the cmap itself pass through
unchanged) in this order:

1. **Terminal simplification** — morphological opening, radius capped to 60% of the glyph's own
   measured thinnest feature (see bug #1 below for why the cap exists).
2. **Sliver-hole dissolution** — interior rings classified as hairline self-crossing artifacts (not
   real counters) are filled solid rather than kept or enlarged (see bug #2 below).
3. **Minimum stroke-width enforcement** — an erosion sweep (`measure_min_half_width`) measures each
   glyph's own thinnest bridge and expands the *whole* outline by only the measured deficit — never
   more, so already-adequate strokes are left alone.
4. **Counter/loop enlargement** — remaining (already-known-legitimate) holes are enlarged if still
   below their category's threshold, checked *after* step 3's dilation so the target accounts for
   final stroke width.
5. **Corner/junction rounding** — a symmetric close-then-open round-join pass.
6. **Cleanup** — sub-`minAreaFu` slivers dropped, duplicate/zero-length segments removed.

Every buffer-based step is wrapped in a topology guard (`_guard_topology`): a step that would
delete an existing hole or split/merge a shell is rejected wholesale, falling back to its input,
rather than partially applied.

Glyph categories (`lib/glyph_category.py`): looped-lowercase, narrow-vertical, ascender, descender,
capital, numeral, counter-bearing — used to select stricter thresholds (e.g. `minLoopOpeningFu` vs
`minCounterOpeningFu`) per glyph, not per-vertex hand edits.

### Two real bugs found and fixed during development

**Bug 1 — counter deletion.** An early, unguarded version of terminal-simplification deleted "o"'s
counter outright (1 contour instead of 2) whenever the opening radius exceeded the glyph's own wall
thickness. Fixed by capping the opening radius to a measured-safe fraction and adding
`_guard_topology` around every morphological step.

**Bug 2 — phantom loop inflation.** The first working counter-enlargement pass, run against
Sacramento's actual "Ashley", "h", and "l" glyphs, produced large, obviously-wrong circular loops
nowhere in the letterform's design. Root cause, confirmed by comparing against PIL/FreeType
ground-truth renders of the *unmodified* source font: Sacramento's cursive connectors contain long,
thin, near-closed interior rings (not tiny — a long sliver can have substantial area) where a
connecting stroke curves back near itself. `StoneSampler`'s arc-length sampling already renders a
full ring of stones around one of these in the **unmodified baseline font**, with no transform
applied at all — this is a pre-existing production-pipeline characteristic, not something this
milestone introduced. Enlarging one to a full minimum-counter-opening size manufactured a much
bigger fictitious hole. Fixed with `_is_sliver_hole()`: an erosion-collapse-fraction test (shape,
not size) that distinguishes long thin slivers from real rounded counters — validated against both
a real counter ("e", collapses to only 39-73% of its area under a modest probe erosion, kept) and a
confirmed sliver (its area classification alone was insufficient — see below).

A related ordering bug surfaced while fixing #2: classifying holes *after* step 3's stroke dilation
made legitimately tight-but-real counters (a script "e"'s bowl) misread as slivers, because the
dilation had already shrunk every hole first. Fixed by moving hole classification (dissolve) before
dilation, and hole *sizing* (enlarge) after it. `tools/font-generator/tests/test_topology_preserved.py`
locks in both fixes as a regression guard.

---

## 4. Per-size configurations

`tools/font-generator/config/{SS6,SS10,SS16,SS20,SS30}.json`. Thresholds are proportional to stone
diameter, not identical across sizes (e.g. `minFeatureWidthMm = 1.5× stoneDiameterMm + gapMm`,
`minCounterOpeningMm = 2.5× stoneDiameterMm + gapMm`, `minLoopOpeningMm = 1.3× minCounterOpeningMm`)
— this keeps the minimum-stroke-width-to-height ratio consistent (~9–10%) across all five sizes
despite their very different absolute stone diameters and height ranges.

| Variant | Stone Ø | Gap | Height range | minFeatureWidth | minCounterOpening | minLoopOpening |
|---|---|---|---|---|---|---|
| SS6  | 2.0mm | 0.3mm | 35–50mm   | 3.3mm | 5.3mm  | 6.9mm  |
| SS10 | 2.8mm | 0.3mm | 45–60mm   | 4.5mm | 7.3mm  | 9.5mm  |
| SS16 | 4.0mm | 0.3mm | 65–90mm   | 6.3mm | 10.3mm | 13.4mm |
| SS20 | 4.7mm | 0.3mm | 80–110mm  | 7.35mm| 12.05mm| 15.7mm |
| SS30 | 6.4mm | 0.3mm | 106–111mm | 9.9mm | 16.3mm | 21.2mm |

mm thresholds are converted to font units using each variant's own **minimum** committed height
(worst case — `OpenTypeProvider` scales every coordinate uniformly by `heightMm/unitsPerEm`, so a
correction sized for the smallest height is still met at every larger height in the range).

---

## 5. Heights and gaps evaluated

Every variant evaluated at min/mid/max of its own supported height range (table above), gap fixed
at 0.3mm (within the brief's 0.2–0.5mm range, matching the production default in `app.js`'s
`defaultProject()`).

---

## 6. Automated readability method

`tools/font-generator/pipeline.py`, per size:

1. Build the case list: 4 required phrases + 45 corpus items (`tools/font-generator/corpus.json` —
   lowercase/uppercase alphabet, numerals, short names, common words, repeated/narrow/wide letters,
   ascenders/descenders, loops/counters, cursive joins, short/longer phrases, synthetic ambiguous
   strings) × 3 heights = 147 cases.
2. Measure both the generated variant and the original Sacramento (baseline) through the real
   pipeline (`measure.mjs`, a thin wrapper around FONT-CAL-001's `measureProduction.mjs`, itself
   reusing FONT-CERT-001's `productionAnalysis.mjs` — no parallel geometry logic anywhere in this
   milestone).
3. Rasterize each case's stones (`lib/render_stones.py`): supersampled circles, Gaussian-blurred and
   re-binarized so adjacent stones' halos merge into continuous strokes — this mimics how a human
   perceives a physical rhinestone applique from normal viewing distance, and is necessary because
   without it OCR (trained on continuous glyph strokes) cannot recognize literal isolated dots at
   all regardless of the underlying layout's actual quality.
4. Run OCR (`lib/ocr_eval.py`: pytesseract, PSM 7 single-line), normalize (case/punctuation/
   whitespace), score via Levenshtein alignment (char/word accuracy, substituted/omitted/inserted
   characters, confidence).
5. Aggregate (`analyze.py`): mean char/word accuracy, exact-match rate, required-phrase pass rate,
   unrecognized-sample fraction, worst-10 ranked.

### Critical methodology finding: OCR has a low ceiling on this typeface independent of rhinestone rendering

Before trusting the OCR numbers below, `tesseract` was tested against **clean, non-rhinestone,
full-vector renders** of unmodified Sacramento (PIL + FreeType, no dots, no degradation at all):

| Text | OCR result | Char accuracy |
|---|---|---|
| "Ashley" | "Alley" | 66.7% |
| "Happy Birthday" | "" (nothing recognized) | 0% |
| "Class of 2027" | "Clare of LOL/" | 53.8% |
| "hello" | ") 00." | 0% |

General-purpose OCR struggles to read Sacramento's connected cursive script **even at perfect
fidelity**. This means the near-zero absolute OCR scores reported below are **not purely a
rhinestone-rendering artifact** — a meaningful fraction of the failure is inherent to
"OCR + this typeface," independent of any dot-pattern degradation. Per the brief's own instruction
("Do not use OCR as the sole geometry validator"), this is exactly why geometry metrics
(`clusterCount`, `collisionCount`) are weighted as a second, independent line of evidence in the
final verdict (§9) — and that second line of evidence, unlike OCR, is unambiguous.

---

## 7. Acceptance thresholds

Declared before evaluation, applied identically to all five variants (`tools/font-generator/analyze.py`):

| Metric | Threshold |
|---|---|
| Mean character accuracy | ≥ 0.85 |
| Mean word accuracy | ≥ 0.80 |
| Required-phrase accuracy (exact match, every tested height) | 1.0 |
| Unrecognized-sample fraction (0% char accuracy) | ≤ 0.15 |

---

## 8. OCR and geometry metrics — all five variants

| Size | Stone Ø | Height range | Gen char acc | Base char acc | Gen req. phrases | Base req. phrases | Gen mean clusters | Base mean clusters | Gen mean stones | Base mean stones |
|---|---|---|---|---|---|---|---|---|---|---|
| SS6  | 2.0mm | 35–50mm   | 0.092 | 0.106 | 0/12 | 0/12 | **4.46**  | 2.57 | 269.6 | 198.3 |
| SS10 | 2.8mm | 45–60mm   | 0.085 | 0.085 | 0/12 | 0/12 | **8.67**  | 3.30 | 223.1 | 163.2 |
| SS16 | 4.0mm | 65–90mm   | 0.049 | 0.058 | 0/12 | 0/12 | **15.99** | 3.88 | 227.6 | 172.7 |
| SS20 | 4.7mm | 80–110mm  | 0.038 | 0.048 | 0/12 | 0/12 | **24.51** | 4.19 | 241.3 | 186.8 |
| SS30 | 6.4mm | 106–111mm | 0.045 | 0.044 | 0/12 | 0/12 | **21.91** | 5.07 | 184.2 | 145.4 |

Collisions: **zero** in every case, both generated and baseline, at all 5 sizes (171 cases each) —
the transform never causes stones to physically overlap.

Two independent, consistent findings across every size:

1. **OCR: no measurable improvement.** Generated char accuracy is statistically indistinguishable
   from baseline — better at SS10/SS30 by <0.1 percentage points, *worse* at SS6/SS16/SS20. Given
   §6's finding that OCR's ceiling on this typeface is low even at perfect fidelity, this alone
   would be inconclusive.
2. **Geometry: measurably worse fragmentation.** `clusterCount` (the same connected-component
   metric FONT-DIAG-001/FONT-CAL-002 used, reused unchanged from `productionAnalysis.mjs`) is
   **1.7×–5.9× higher** for the generated variant than baseline at every single size. The
   transform's own corrections (wider strokes, larger counters/loops) systematically add outline
   perimeter, and that additional perimeter is fragmenting into *more* disconnected stone clusters,
   not fewer — the opposite of its design intent. This is not typeface-dependent or
   OCR-methodology-dependent; it is a direct, unambiguous measurement of the actual `StoneLayout`
   the real production pipeline generates.

Together, these two independent signals agree: the generated variants are not more readable than
doing nothing, and are measurably worse by the one geometry metric this transform was specifically
designed to improve.

Structural/font-validity: **PASS** for all 5 (fontTools reload, required tables, cmap coverage,
valid bounds, positive advance widths — `tools/font-generator/validate_font.py`).

---

## 9. Lowest-scoring words and glyphs

Every one of the 4 required phrases (Ashley, Bride Squad, Happy Birthday, Class of 2027) failed
exact-match OCR at all 3 tested heights, for all 5 sizes, for both generated and baseline — 0/12 in
every row of the table above. The full per-case breakdown (worst-10 per size, every OCR failure,
raw OCR text, substituted/omitted/inserted characters) is in
`output/<SIZE>/evaluation.<SIZE>.json` and surfaced in the HTML review (§12).

Ambiguous-glyph-pair collapse checks (single-character OCR comparison across the 24 confusable
pairs in `corpus.json`) are included in the review page per size; given the near-zero single-glyph
OCR recognition rate overall, most pairs could not be meaningfully evaluated (OCR did not recognize
either glyph as any letter).

---

## 10. Remaining failures and ambiguities

- OCR recognition is near-zero across the board, for both baseline and generated, at every size —
  driven jointly by (a) tesseract's low ceiling on connected cursive script (§6) and (b) genuine
  rhinestone-pattern fragmentation that a human viewer would also find hard to parse.
- The procedural transform's geometry effect is the opposite of its design intent: intended to
  reduce `StoneSampler` dedup-pruning fragmentation (per FONT-DIAG-001's diagnosis), it measurably
  increases `clusterCount` instead, because widening strokes and enlarging counters adds more total
  outline perimeter for `StoneSampler` to sample and fragment.
- No further calibration rounds were run after this became consistent across all 5 sizes: the
  evidence (two independent metrics, 5/5 sizes, 3 heights each, 171 cases each) is unambiguous
  enough that further parameter tuning of the *same* transform approach is not expected to reverse
  the conclusion — this mirrors FONT-CAL-002's own finding that outline-modification techniques do
  not generalize for this source font.

---

## 11. HTML review location

`review/FONT-GEN-001-review.html` — per-size navigation, threshold-verdict badges, metric cards
(generated vs baseline), required-phrase cards, worst-10 OCR samples, full OCR-failure table,
confusable-pair collapse table, geometry-warning table, and a searchable/filterable full-corpus
results table (171 rows × 5 sizes), all from one static file with embedded data (vanilla JS, no
build step). Review images: `review/assets/<SIZE>/*.png` (208 PNGs, curated subset only — not
every corpus item, per the brief's exception-focused requirement).

---

## 12. Studio integration

**No fonts registered.** Per the REJECT recommendation below (consistent with FONT-VIS-001's
precedent: no variant surviving evaluation → no manifest registration), `assets/fonts/manifest.json`
was not modified. `git status` confirms zero existing files changed — only new files under `output/`,
`review/`, and `tools/font-generator/` were added. Original Sacramento, all existing fonts, existing
projects, and exporters are unaffected because nothing that they depend on was touched.

---

## 13. Final recommendation

**REJECT GENERATED FAMILY.**

None of the five variants (SS6, SS10, SS16, SS20, SS30) clear the declared acceptance thresholds at
any tested height. Required phrases are not recognized at any height for any size. More decisively,
the transform measurably *increases* `StoneLayout` fragmentation (`clusterCount`) relative to doing
nothing — 1.7×–5.9× worse across all 5 sizes — while producing no compensating OCR improvement.

This is not a rejection of the milestone's approach in the abstract: real bugs were found and fixed
during development (counter deletion, phantom-loop inflation), the topology-preservation guard and
sliver-vs-real-counter classifier are genuinely reusable infrastructure, and the OCR-based evaluation
framework (corpus, rendering, scoring, thresholds, review page) is a substantially more rigorous
readability-testing method than any prior FONT-CAL/FONT-VIS milestone used. But applied to
Sacramento specifically, within these five committed height ranges, procedural outline correction
does not produce a rhinestone-readable result — reinforcing, with much stronger evidence, the same
conclusion FONT-CAL-002 and FONT-VIS-001 already reached. Their shared recommendation
(**FONT-POLICY-001 — SS30 Height Ceiling Policy Study**, since height scaling was the only lever
FONT-DIAG-001 found with any real effect, but works only outside SS30's committed range) remains the
best-supported next step, now extended by this milestone's evidence to apply across all five
committed height ranges, not just SS30's.
