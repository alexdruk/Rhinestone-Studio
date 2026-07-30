# FONT-EVAL-002 — Human-Calibrated Legibility Baseline

Branch `feature/font-arch-001`. Follows FONT-EVAL-001 (solid-ink ceiling study, this same branch).
Objective: replace the invented 0.85/0.80/1.0/0.15 pytesseract thresholds used to REJECT every
generated font family in FONT-GEN-001 through 005 with a real, evidence-based bar.

**Result up front: pytesseract itself is the confound, not font legibility.** A vision-capable
read of the exact same rhinestone renders pytesseract scored near-zero on reads them at 99% char
accuracy. The recommended replacement is below (§5); a fully human-panel-calibrated numeric
threshold was not obtained (§4) and remains open work.

---

## 1. What this milestone actually delivered vs. the original brief

The original brief asked for four things. Here's what happened to each, plainly:

| Step | Brief | Outcome |
|---|---|---|
| Prerequisite | ("FONT-EVAL-001 solid-ink study" was referenced as already existing) | **Did not exist.** Audited the repo, found only an untracked, unwired `solid_ink.py` stub. Built and ran it for real as FONT-EVAL-001 first (separate commit). |
| Step 1 | Vision-model transcription vs. pytesseract, "every font/weight/size already measured" | Done, **scoped to a 140-image sample** (4 required phrases × mid-height × 7 variants × 5 sizes) — the full 5,985-case grid isn't something a human/vision reviewer can transcribe one-by-one in one sitting. Real numbers, not a subset average dressed up as the full grid. |
| Step 2 | Blind panel of 8–15 respondents | Built and published a real, working survey instrument. **Actual respondents: 1** (the repo owner, testing the instrument). This is not a panel and isn't treated as one. |
| Step 3 | Correlate human results against automated metrics, propose calibrated thresholds | **Cannot be done with n=1.** Reported as an illustrative single-rater note only (§4). No population threshold is proposed from this data — that would be fabricating statistical confidence that doesn't exist. |

---

## 2. Part A recap — the ceiling is the problem

FONT-EVAL-001 (full report: `FONT-EVAL-001-SolidInkLegibilityCeilingStudy.md`) rendered every font
variant as plain vector ink — zero rhinestone discretization — and scored it with the same
pytesseract pipeline every REJECT verdict was based on. **0 of 40 cells cleared any combination of
the four thresholds.** The single best cell anywhere in the grid (Baloo2Variable baseline, SS16)
reached 0.641 char accuracy against an 0.85 floor. The thresholds fail perfect vector ink. They were
never a legibility bar — they were an artifact of pytesseract's ceiling on this corpus.

---

## 3. Part B — vision-model transcription vs. pytesseract (real data, 140 images)

Sample: 4 required phrases (Ashley / Bride Squad / Happy Birthday / Class of 2027) at mid-height,
for all 7 font variants (4 generated + 3 baseline) × all 5 sizes — rhinestone renders only (the
disputed evidence was required-phrase accuracy on rhinestone renders specifically, which read 0/12
everywhere in FONT-GEN-005). Each image was read directly (no OCR engine) and scored with the exact
same `ocr_eval.normalize()`/Levenshtein logic every prior milestone used — an apples-to-apples
comparison, not a different metric.

| Family | Variant | n | Vision charAcc | Vision exact | pytesseract charAcc | pytesseract exact |
|---|---|---|---|---|---|---|
| Sacramento | baseline | 20 | 1.000 | 20/20 | 0.393 | 1/20 |
| Sacramento | generated | 20 | 0.996 | 19/20 | 0.163 | 0/20 |
| SacramentoSkeleton | generated | 20 | 1.000 | 20/20 | 0.242 | 0/20 |
| Baloo2 | baseline | 20 | 1.000 | 20/20 | 0.599 | 4/20 |
| Baloo2 | generated | 20 | 1.000 | 20/20 | 0.534 | 4/20 |
| Baloo2Variable | baseline | 20 | 1.000 | 20/20 | 0.910 | 12/20 |
| Baloo2Variable | generated | 20 | 0.957 | 13/20 | 0.916 | 9/20 |
| **Overall** | | **140** | **0.993** | **132/140** | **0.537** | **30/140** |

> **Correction (FONT-DIAG-002):** the original version of this table reported Sacramento
> generated at 18/20 vision-exact, including an SS30 "Class of 2027" → "Class of 202" miss. Full-
> resolution re-inspection during FONT-DIAG-002's root-cause pass found that miss was my own
> transcription error against the compressed multi-row review sheet used at the time, not a real
> rendering defect — the SS30 image reads "Class of 2027" correctly and completely. Corrected to
> 19/20 above; the SS6 case is real and stands (see FONT-DIAG-002).

**Every rhinestone design in this sample is legible to direct visual inspection.** pytesseract's
required-phrase pass rate (30/140, 21%) massively understates real readability; the vision read
(132/140, 94%) is the more trustworthy signal by a wide margin. Sacramento cursive is the starkest
case: pytesseract reads essentially nothing (0.163–0.393 char accuracy) on text a direct look reads
correctly nearly every time (0.996–1.000).

**The 8 remaining non-exact vision transcriptions are worth listing in full — they're real
findings, confirmed by glyph-level root-cause analysis in FONT-DIAG-002, not noise:**

| Family/variant | Size | Expected | Read as |
|---|---|---|---|
| Baloo2Variable generated | SS6/10/16/20/30 (5×) | "Happy Birthday" | "Happy Biri hday" |
| Baloo2Variable generated | SS20 | "Class of 2027" | "C lass of 2027" |
| Sacramento generated | SS6 | "Class of 2027" | "Class of 202" (trailing "7" collapses to a stray fragment) |
| Baloo2Variable generated | SS6 | "Class of 2027" | "Class of 2021" |

The "Biri hday" split reproduces at **every single size** for Baloo2Variable's generated (rhinestone
-transformed) family specifically — a real, consistent rendering defect, root-caused in FONT-DIAG-002
to a specific transform step (terminal-simplification over-eroding the "t" crossbar as a "spur"), not
a size-dependent legibility edge case. This is new information FONT-GEN-003's own
pytesseract-based report never surfaced, because pytesseract's noise floor was too high to
distinguish it from everything else scoring near zero.

---

## 4. Part C/D — human panel: instrument built, data insufficient for calibration

**Instrument**: [Rhinestone Legibility Panel](https://claude.ai/code/artifact/4f3d1ef3-2f28-47c2-a59a-464c7a50d481)
— a self-contained blind survey, 12 stimulus items (Sacramento baseline / Sacramento generated
(FONT-GEN-001) / SacramentoSkeleton generated (FONT-GEN-004) / Baloo2Variable baseline at wght
400/500/600, × SS16 + SS30), each a real rhinestone-dot render (not the OCR-blur render) with no
font/size labels shown. Respondents transcribe + rate 1–5 confidence, then download their answers
as JSON to send back. Verified the published page's content and structure load correctly; could not
click through the live submit/download flow myself — no interactive browser tool was available in
this session, so that step is unverified beyond one real respondent's report of it working.

**Data collected: 1 response** (repo owner, participant "AD"), confirmed by the repo owner to be
the only response this study will get. **This is not a panel and cannot support a calibrated
threshold** — no correlation coefficient, confidence interval, or "pass/fail line" is statistically
meaningful at n=1. Reporting it as a single-rater exploratory note only:

| Outcome | Count |
|---|---|
| Exact-match correct | 8 / 12 |
| Mean confidence rating when correct | 2.75 / 5 |
| Mean confidence rating when incorrect | 3.00 / 5 |

The one respondent's self-reported confidence showed **no visible relationship to actual
correctness** — if anything, slightly inverted (wrong answers rated marginally more confident than
right ones). Concretely: item 3 (Sacramento generated "Happy Birthday") was transcribed exactly
right but rated confidence 1 (lowest); item 8 (Baloo2Variable wght400 "Class of 2027") was
transcribed "Class of 20027" (wrong, extra digit) but rated confidence 5 (highest). This is a single
data point, not a finding — but it's a reason for caution against ever using self-reported
confidence as a proxy for measured accuracy, should a larger panel be run later.

**What would be needed to actually finish Step 3**: real responses from multiple people, not
optional. The instrument is built and reusable — re-running Part D with real panel data requires no
new tooling, only distributing the existing survey link and collecting responses.

---

## 5. Recommendation

**Retire the pytesseract-based acceptance gate.** FONT-EVAL-001 shows it fails perfect vector ink;
FONT-EVAL-002 Part B shows it dramatically understates real readability on the exact renders it was
grading. Continuing to use it as a REJECT criterion for future font milestones would keep rejecting
designs that are, in fact, legible.

**No numeric replacement threshold is proposed from this milestone's data** — that would require
the human panel this milestone did not obtain (§4). What the evidence here does support:

- **Direct visual review (a person looking at the rendered specimen) is the only validated
  legibility check right now.** Part B's 140-sample comparison is the closest thing to ground truth
  this codebase has; it says the generated families read as correctly as their baselines in the
  overwhelming majority of cases, with rendering-defect exceptions (§3) that are about specific
  glyph handling, not general fragmentation.
- **`clusterCount` ratio (FONT-DIAG-001) remains the best *automatable* proxy available**, since it
  doesn't depend on any OCR engine's quirks — but this milestone did not establish a validated
  numeric pass/fail value for it against real human judgment, and one should not be invented here
  either.
- **Before any new font milestone is graded**, either (a) re-run the human panel in this report with
  real multiple respondents using the existing survey instrument, or (b) adopt direct visual review
  as the acceptance gate explicitly, rather than reinstating an unreachable OCR threshold or
  inventing an uncalibrated one.

---

## 6. Files changed

**New**: `tools/font-generator/render_vision_sample.py`, `tools/font-generator/render_human_panel.py`,
this report. **Data (not committed to git — local/scratch only)**: 140 vision-transcription renders
and scores, 12 human-panel stimulus renders, the one collected response. The published survey
Artifact is external to this repo.

No change to any production code, GeometryEngine, StoneLayout, or prior milestone's TTF/output
files. Existing `tools/font-generator/tests/` suite re-run and passes unmodified.
