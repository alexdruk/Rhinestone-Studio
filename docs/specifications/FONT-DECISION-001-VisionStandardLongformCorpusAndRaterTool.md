# FONT-DECISION-001 — Vision-Transcription Standard, Longform Corpus, Rater Tool, Feedback Loop

Branch `feature/font-decision-001`. Follows FONT-EVAL-002 (which found pytesseract was the
confound behind every prior REJECT verdict — a vision-capable read of the same rhinestone renders
scored 132/140 exact where pytesseract scored 30/140) and FONT-DIAG-002 (root-caused one of
FONT-EVAL-002's defects to terminal-simplify spur erosion on the "t" crossbar).

This milestone has four parts: (A) formalize vision-transcription as the primary evaluation
metric and consolidate all prior evidence into one table; (B) add a longer-text corpus targeting
known problem combinations; (C) replace the failed multi-respondent survey with a local
single-rater tool; (D) document the exact next-step prompt for closing the loop.

No production code changes — this is entirely `tools/font-generator/` offline research tooling.

---

## Part A — Vision-transcription as standard, consolidated table

**Pipeline change.** `tools/font-generator/lib/vision_eval.py` is new: it reuses
`ocr_eval.normalize()`/`levenshtein_ops()` unchanged and exposes `evaluate(expected_text,
transcribed_text)`, returning the same shape `ocr_eval.evaluate()` does, so vision and pytesseract
results are directly comparable. `analyze.py`'s `summarize()` gained an optional `vision_lookup`
parameter that attaches vision-transcription results per case (`attach_vision()`) and reports
`meanCharAccuracyVision`/`requiredPhraseAccuracyVision` alongside — purely additive, no existing
field renamed or removed. `check_thresholds()` (the pytesseract-based PASS/FAIL gate) is unchanged
in behavior but its docstring now states plainly that it is the **legacy metric**, retired as the
acceptance signal per FONT-EVAL-002 §5. No new numeric vision threshold is invented — FONT-EVAL-002
already concluded no calibrated threshold exists; direct/vision review is the acceptance signal,
operationalized in Part C's rater tool.

**Source data.** The 140-case FONT-EVAL-002 sample (4 required phrases × 7 variants × 5 sizes) was
reconstructed without re-viewing any image: 132 cases were exact-match by definition, and the 8
non-exact cases have their actual read text quoted verbatim in FONT-EVAL-002 §3 (as corrected by
FONT-DIAG-002). This is valid because the renders are byte-identical to what was already scored —
re-deriving the same answer from scratch would be redundant, not more rigorous. Reconstruction is
`tools/font-generator/build_partA_vision_transcriptions.py`; consolidation (pulling matching
pytesseract values from the existing `generated-fonts/SS*/evaluation*.json` files, and clusterCount
from the existing `summary*.json` files — none re-derived) is
`tools/font-generator/consolidate_decision001.py`.

### Table 1 — accuracy, vision (primary) vs. pytesseract (secondary/legacy), n=20 per row

| Family | Variant | Vision charAcc | Vision exact | pytesseract charAcc (legacy) | pytesseract exact (legacy) |
|---|---|---|---|---|---|
| Sacramento | baseline | 1.000 | 20/20 | 0.393 | 1/20 |
| Sacramento | generated | 0.996 | 19/20 | 0.163 | 0/20 |
| SacramentoSkeleton | generated | 1.000 | 20/20 | 0.242 | 0/20 |
| Baloo2 | baseline | 1.000 | 20/20 | 0.599 | 4/20 |
| Baloo2 | generated | 1.000 | 20/20 | 0.534 | 4/20 |
| Baloo2Variable | baseline | 1.000 | 20/20 | 0.910 | 12/20 |
| Baloo2Variable | generated | 0.957 | 13/20 | 0.916 | 9/20 |

(Identical to FONT-EVAL-002's own table — this consolidation reuses, not re-derives, that data.
See FONT-EVAL-002 §3 for the 8 individual non-exact transcriptions.)

**Baloo2Variable weights 500/600/700/800 have no OCR/vision evaluation data at all.** Only wght400
was ever generated as a rhinestone variant and evaluated (FONT-GEN-003 selected Regular at every
size); 500–800 were only measured for native-geometry deficit during weight *selection*
(`select_source_weight.py`), a different metric entirely, never rendered or read for legibility.
Noted here explicitly rather than fabricated or silently omitted.

### Table 2 — clusterCount (geometry, unaffected by this milestone), generated vs. baseline

| Family | SS6 | SS10 | SS16 | SS20 | SS30 |
|---|---|---|---|---|---|
| Sacramento (gen / base) | 4.46 / 2.57 | 8.67 / 3.30 | 15.99 / 3.88 | 24.51 / 4.19 | 21.91 / 5.07 |
| SacramentoSkeleton (gen / base\*) | 4.86 / 2.57 | 6.68 / 3.30 | 7.08 / 3.88 | 7.87 / 4.19 | 7.81 / 5.07 |
| Baloo2 (gen / base) | 8.82 / 9.46 | 13.37 / 7.13 | 24.84 / 10.23 | 32.44 / 10.26 | 34.35 / 9.35 |
| Baloo2Variable (gen / base) | 8.50 / 7.86 | 10.58 / 7.06 | 18.23 / 8.51 | 21.12 / 8.87 | 16.64 / 7.11 |

\*SacramentoSkeleton reuses Sacramento's baseline (unmodified source font, per FONT-GEN-004
convention) rather than re-measuring it.

**Reading the two tables together**: vision-transcription confirms every family/variant reads
correctly (94–100%) at the required-phrase level FONT-EVAL-002 tested — the previous REJECT
verdicts, which leaned on pytesseract, dramatically understated real readability. clusterCount
fragmentation (generated vs. baseline, every family, every size) is untouched and remains the
strongest automatable geometry-based signal that something *changes* structurally, even though it
was never validated against real human judgment as a pass/fail line (that's what Part C attempts,
at n=1).

---

## Part B — Longform corpus targeting known problem combinations

**New corpus**: `tools/font-generator/corpus_longform.json`, the 12 user-specified strings
(mixed case, ampersands, ordinals, numerals, dates, possessives, em-dashes, hashtags), additive to
`corpus.json`, not replacing it.

**Rendering**: `tools/font-generator/render_decision001_longform.py` measured the full grid — **all
7 variants × 5 sizes × 12 phrases = 420 cases** — via the real production pipeline
(`pipeline.run_measure()`), giving clusterCount/collisionCount/stoneCount for every combination at
no extra cost (fully automated). OCR-style PNGs were rendered only for the **240-case priority
subset**: Sacramento + Baloo2Variable (the two families with open findings from
FONT-EVAL-002/FONT-DIAG-002), baseline + generated, all 5 sizes — Baloo2 and SacramentoSkeleton
were excluded from this expensive manual pass since both are already unambiguous REJECT with no
open questions, but both still get full clusterCount coverage below.

**Vision-transcription**: I personally viewed and transcribed all 240 priority images.

### Vision accuracy, priority subset (12 longform phrases per cell)

| Family | Variant | SS6 | SS10 | SS16 | SS20 | SS30 |
|---|---|---|---|---|---|---|
| Sacramento | baseline | 1.000 (12/12) | 1.000 (12/12) | 1.000 (12/12) | 1.000 (12/12) | 1.000 (12/12) |
| Sacramento | generated | 0.992 (9/12) | 1.000 (12/12) | 1.000 (12/12) | 1.000 (12/12) | 1.000 (12/12) |
| Baloo2Variable | baseline | 1.000 (12/12) | 1.000 (12/12) | 1.000 (12/12) | 1.000 (12/12) | 1.000 (12/12) |
| Baloo2Variable | generated | 0.968 (6/12) | 0.962 (6/12) | 0.960 (6/12) | 0.953 (5/12) | 0.960 (6/12) |

Both baselines are perfect at every size, as expected (unmodified source fonts). Both generated
families show real, size-independent defects — a **finding this corpus was specifically designed
to surface**, since the required-phrase corpus alone only caught one of these (the "Biri hday"
case).

**Sacramento generated, SS6 only** — the known trailing-digit erosion (first reported in
FONT-EVAL-002 for "Class of 2027"→"Class of 202" at SS6) recurs on every phrase ending in "...27":

| Phrase | Read as |
|---|---|
| "Olivia & Sophia — Bride Squad 2027" | "...Bride Squad **202**" |
| "S. Miller, 05/16/2027, Room 608" | "...05/16/**202**, Room 608" |
| "Little Miss Sunshine, Summer 2027" | "...Summer **202**" |

Confirmed size-specific: identical phrases at SS10/16/20/30 all read the trailing "7" correctly.

**Baloo2Variable generated — a "t"-crossbar erosion defect generalizes well beyond "Birthday".**
FONT-DIAG-002 root-caused one case ("Happy Birthday"→"Happy Biri hday") to terminal-simplify
eroding a "t" crossbar as a misclassified spur. This corpus shows the same defect recurring, at
**every size (SS6–SS30)**, on essentially every phrase containing a medial "t":

| Phrase | Read as (representative size) |
|---|---|
| "8th Grade Graduation..." | "8th Grade **Gradua ion**..." |
| "...Little Angel..." | "...**Lil l le** Angel..." (SS6/16/20/30) / "**Lii i le**" (SS10) |
| "Congratulations Graduate..." | "**Congra ula ions** Gradua**l**e..." |
| "Happy 30th Birthday..." | "Happy 30th **Bir[t/i] hday**..." (30th itself renders fine) |
| "...Dumpling Kitchen" | "...Dumpling **Kii chen**" |

**New finding, not in any prior report**: at **SS20 specifically**, capital "C" also loses its
closure and reads as an open parenthesis — "Class"→"( lass", "Congratulations"→"( ongra...",
"Cheer"→"( heer" — confirmed present only at SS20, absent at SS6/10/16/30 for the identical
words. "8th"/"30th" (short, familiar ordinals) and word-initial "t" ("Team") are consistently
unaffected — the defect is specifically medial "t" adjacent to certain letter combinations, not
universal.

### clusterCount, full 7-variant × 5-size grid (420 cases, all automated)

| Family | Variant | SS6 | SS10 | SS16 | SS20 | SS30 |
|---|---|---|---|---|---|---|
| Sacramento | baseline | 16.83 | 17.25 | 19.50 | 20.33 | 26.58 |
| Sacramento | generated | 24.50 | 43.83 | 84.58 | 134.67 | 100.92 |
| SacramentoSkeleton | generated | 26.75 | 35.00 | 41.42 | 45.58 | 32.50 |
| Baloo2 | baseline | 48.42 | 30.75 | 62.00 | 52.33 | 54.75 |
| Baloo2 | generated | 47.58 | 74.75 | 140.25 | 168.75 | 179.08 |
| Baloo2Variable | baseline | 34.08 | 32.92 | 34.00 | 35.58 | 35.17 |
| Baloo2Variable | generated | 44.08 | 56.00 | 93.00 | 122.00 | 93.00 |

Same fragmentation pattern as the short-phrase corpus — generated consistently higher than
baseline, at every family/size — confirming this longer, more demanding corpus doesn't surface any
*new* geometry-level regression beyond what's already visible via vision-transcription above.

---

## Part C — Single-rater local review tool

**New**: `review/FONT-DECISION-001-rater.html` — a single self-contained file (vanilla JS, no
build step, no CDN), every specimen image embedded as a base64 data URI (same technique as the
`panel-b64.json` scratch file from FONT-EVAL-002's abandoned human-panel attempt). It opens
directly via double-click; nothing else needs to be on disk.

One specimen at a time, three buttons (Readable / Unreadable / Not Sure), a progress indicator
("N of 60"), and an always-visible "Export results" button that downloads
`font-decision-001-ratings.json`: `[{family, size, sampleText, rating, timestamp}, ...]` for every
rated item, via a client-side Blob — no server, no submission endpoint. Family/size labels are
hidden during rating (shown only in the exported data) to avoid anchoring the single rater's
judgment on which font is on screen.

**Item set (60 items)**, per the milestone's explicit priority list: Baloo2Variable generated
(wght400 — the only weight ever transformed to rhinestone; see Part A's note on 500–800) at
SS6/SS16/SS20 × all 16 phrases (12 longform + 4 required) = 48, plus Sacramento baseline at SS16 ×
the 12 longform phrases = 12, as a comparison anchor. All 60 images were already rendered (Part
B's longform pass + FONT-EVAL-002's required-phrase renders) — no new rendering.

**Browser-verified** with an isolated, Playwright-launched Chrome instance (a fresh automation
profile, not the user's own browser windows): specimen image loads, each button click advances the
progress counter, "Export results" downloads a JSON with the correct shape, and the completion
screen appears correctly after all 60 items are rated. No console errors.

---

## Part D — Feedback loop

Once ratings are exported (`font-decision-001-ratings.json`), send this prompt back:

> Load my ratings file at `font-decision-001-ratings.json` (or wherever I saved it) and: (1)
> compute agreement/correlation between my Readable/Unreadable/Not Sure judgments and both
> vision-transcription accuracy and clusterCount ratio, for the matching font/size/sample
> combinations in `tmp/font-decision-001/consolidated.partA.json` and
> `consolidated.partB.json`; (2) recommend a final font/weight/size candidate for production,
> combining my direct readability judgment with the two automated metrics — weight my direct
> judgment as the *primary* signal, since automated metrics (pytesseract in FONT-EVAL-001/002, and
> clusterCount's non-generalizing result in FONT-CAL-002) have twice been shown unreliable in this
> project; (3) state plainly that this remains a single-rater result, not a statistically
> validated panel, and do not overstate its generalizability.

**This milestone's own results are, likewise, a single-rater exploratory finding, not a
statistically validated panel** — every judgment above (the transcriptions in Parts A/B, the
defect characterizations) was made by one vision-capable reader (me), not a panel. Treat the
"t"-crossbar and SS20 "C"-split findings as real and reproducible (confirmed across multiple sizes
and phrases within this session) but not independently cross-checked by a second rater.

---

## Files changed

**New**: `tools/font-generator/lib/vision_eval.py`, `build_partA_vision_transcriptions.py`,
`consolidate_decision001.py`, `corpus_longform.json`, `render_decision001_longform.py`,
`consolidate_partB.py`, `build_rater_tool.py`, `review/FONT-DECISION-001-rater.html`, this report.
**Modified**: `tools/font-generator/analyze.py` (additive vision-merge support + legacy
docstrings only — no existing field renamed, removed, or changed in value).
**Data (not committed — local/scratch only)**: `tmp/font-decision-001/**` (vision-transcription
JSON, 240 priority renders, 420-case measurement grid, consolidated tables).

No change to any generated TTF, `generation-metadata.*.json`, `evaluation.*.json`, or
`summary.*.json` file — confirmed by diff (`analyze.py`'s change was verified against a live
re-run of SS16 producing purely additive new keys, then that regenerated file was reverted since
this milestone doesn't ask for regenerating pytesseract summaries). Existing
`tools/font-generator/tests/` suite re-run and passes unmodified.
