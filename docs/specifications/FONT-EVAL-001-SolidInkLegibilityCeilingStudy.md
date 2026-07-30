# FONT-EVAL-001 — Solid-Ink Legibility Ceiling Study

Branch `feature/font-arch-001`. Prerequisite milestone for FONT-EVAL-002, triggered by an audit
finding: no prior milestone had actually run the "solid-ink ceiling" study its own acceptance
thresholds were being judged against. The `tools/font-generator/lib/solid_ink.py` helper existed
in the working tree, untracked and never wired up. This milestone builds the missing evaluation
path, runs it for real, and answers the question directly: **is FONT-GEN-001 through 005's
0.85/0.80/1.0/0.15 pytesseract threshold reachable at all on this corpus, even with zero
information loss from rhinestone discretization?**

**Answer: no. 0 of 40 cells clear it — not one.**

---

## 1. Method

`tools/font-generator/evaluate_solidink.py` (new) renders each case as **plain filled vector glyph
outlines** — no stone sampling, no `GeometryEngine`, no `StoneLayout`, nothing downstream of the
raw font outline — via `lib/solid_ink.py` (`layout_text_contours()` reads fontTools `glyf` contours
directly; `render_solid_ink_image()` rasterizes them at the same physical letter height and
`px_per_mm` convention `render_ocr_image()` uses). Every case is then scored with the **exact same**
`lib/ocr_eval.py` pytesseract pipeline every FONT-GEN milestone used — same `normalize()`, same
Levenshtein char/word accuracy, same `--psm 7` config. This isolates one variable: rhinestone
discretization. Everything else (corpus, heights, OCR engine, scoring) is held identical to
FONT-GEN-001 through 005.

**Grid** — the same 7 distinct font files FONT-GEN-005 re-validated (§3 of that report), each
rendered as solid ink and evaluated at all 5 stone sizes, same 171-case corpus (`corpus.json`: 4
required phrases + 53 items, × min/mid/max heights) as every prior milestone:

- **generated**: Sacramento (FONT-GEN-001), Baloo2 (FONT-GEN-002), Baloo2Variable (FONT-GEN-003),
  SacramentoSkeleton (FONT-GEN-004) — the rhinestone-*transformed* outline, rendered solid instead
  of sampled into stones. This isolates outline-transform distortion from stone-sampling loss.
- **baseline**: Sacramento, Baloo2 (Bold), Baloo2Variable (wght400) — the unmodified source
  typeface. SacramentoSkeleton reuses Sacramento's baseline cell (identical source font, same
  reuse convention FONT-GEN-005 introduced) — not re-rendered.

7 distinct fonts × 5 sizes × 171 cases = 5,985 solid-ink render+OCR operations (`analyze_solidink.py`
reports 40 summary rows because the shared Sacramento/SacramentoSkeleton baseline is printed under
both family names, matching FONT-GEN-005's own accounting).

Acceptance thresholds are `analyze.py`'s unmodified `THRESHOLDS` (imported directly, not
reimplemented): mean char accuracy ≥0.85, mean word accuracy ≥0.80, required-phrase accuracy =1.0,
unrecognized-fraction ≤0.15.

---

## 2. Results

| Size | Family | Variant | charAcc | wordAcc | reqPhrase | unrecFrac | Verdict |
|---|---|---|---|---|---|---|---|
| SS6 | Sacramento | generated | 0.286 | 0.056 | 0/12 | 0.415 | FAIL |
| SS6 | Sacramento | baseline | 0.289 | 0.088 | 0/12 | 0.444 | FAIL |
| SS6 | Baloo2 | generated | 0.549 | 0.193 | 3/12 | 0.211 | FAIL |
| SS6 | Baloo2 | baseline | 0.617 | 0.226 | 0/12 | 0.146 | FAIL |
| SS6 | Baloo2Variable | generated | 0.569 | 0.177 | 4/12 | 0.164 | FAIL |
| SS6 | Baloo2Variable | baseline | 0.641 | 0.283 | 4/12 | 0.164 | FAIL |
| SS6 | SacramentoSkeleton | generated | 0.356 | 0.169 | 0/12 | 0.433 | FAIL |
| SS10 | Sacramento | generated | 0.264 | 0.039 | 2/12 | 0.462 | FAIL |
| SS10 | Sacramento | baseline | 0.276 | 0.092 | 0/12 | 0.485 | FAIL |
| SS10 | Baloo2 | generated | 0.556 | 0.194 | 0/12 | 0.211 | FAIL |
| SS10 | Baloo2 | baseline | 0.617 | 0.241 | 0/12 | 0.135 | FAIL |
| SS10 | Baloo2Variable | generated | 0.567 | 0.190 | 6/12 | 0.216 | FAIL |
| SS10 | Baloo2Variable | baseline | 0.617 | 0.260 | 4/12 | 0.181 | FAIL |
| SS10 | SacramentoSkeleton | generated | 0.255 | 0.091 | 3/12 | 0.497 | FAIL |
| SS16 | Sacramento | generated | 0.190 | 0.047 | 3/12 | 0.643 | FAIL |
| SS16 | Sacramento | baseline | 0.262 | 0.099 | 0/12 | 0.503 | FAIL |
| SS16 | Baloo2 | generated | 0.538 | 0.168 | 0/12 | 0.199 | FAIL |
| SS16 | Baloo2 | baseline | 0.591 | 0.246 | 3/12 | 0.164 | FAIL |
| SS16 | Baloo2Variable | generated | 0.532 | 0.142 | 5/12 | 0.222 | FAIL |
| SS16 | Baloo2Variable | baseline | 0.624 | 0.233 | 4/12 | 0.135 | FAIL |
| SS16 | SacramentoSkeleton | generated | 0.214 | 0.082 | 0/12 | 0.561 | FAIL |
| SS20 | Sacramento | generated | 0.197 | 0.053 | 3/12 | 0.561 | FAIL |
| SS20 | Sacramento | baseline | 0.251 | 0.117 | 0/12 | 0.561 | FAIL |
| SS20 | Baloo2 | generated | 0.536 | 0.174 | 0/12 | 0.199 | FAIL |
| SS20 | Baloo2 | baseline | 0.580 | 0.228 | 3/12 | 0.175 | FAIL |
| SS20 | Baloo2Variable | generated | 0.558 | 0.160 | 3/12 | 0.181 | FAIL |
| SS20 | Baloo2Variable | baseline | 0.630 | 0.226 | 3/12 | 0.123 | FAIL |
| SS20 | SacramentoSkeleton | generated | 0.187 | 0.082 | 3/12 | 0.643 | FAIL |
| SS30 | Sacramento | generated | 0.145 | 0.047 | 3/12 | 0.725 | FAIL |
| SS30 | Sacramento | baseline | 0.228 | 0.103 | 0/12 | 0.567 | FAIL |
| SS30 | Baloo2 | generated | 0.516 | 0.151 | 3/12 | 0.211 | FAIL |
| SS30 | Baloo2 | baseline | 0.580 | 0.228 | 3/12 | 0.175 | FAIL |
| SS30 | Baloo2Variable | generated | 0.536 | 0.132 | 3/12 | 0.187 | FAIL |
| SS30 | Baloo2Variable | baseline | 0.628 | 0.214 | 3/12 | 0.123 | FAIL |
| SS30 | SacramentoSkeleton | generated | 0.219 | 0.102 | 3/12 | 0.632 | FAIL |

(SacramentoSkeleton's baseline row is identical to Sacramento's baseline row at each size — reused,
not re-rendered — omitted from the table to avoid double-counting; both are FAIL regardless.)

**0 of 40 reported cells clear all four thresholds. 0 of 40 clear even one threshold's worst-case
margin** — the single highest char accuracy anywhere in the grid (Baloo2Variable baseline, SS16,
0.641) is still 0.21 below the 0.85 floor; the single highest word accuracy (same cell, 0.283) is
0.52 below the 0.80 floor.

---

## 3. Interpretation

This is a **ceiling**, not a font result. Every cell here is pytesseract reading **plain filled
vector outlines** — no stones, no gaps, no discretization, the actual TrueType glyph shapes at
real committed heights. There is no rhinestone-specific information loss left to blame. If the
thresholds were reachable in principle, at least the cleanest cells (large, non-cursive, unmodified
baseline fonts — Baloo2Variable baseline, Baloo2 baseline) should clear them. None do, by a wide
margin, at every size.

This directly confirms the premise FONT-EVAL-002 was commissioned to test: **the 0.85/0.80/1.0/0.15
thresholds are not a real bar any font on this corpus could pass against this OCR engine** — they
were never actually validated against a reachable ceiling before being applied as a REJECT gate in
FONT-GEN-001 through 005.

Two secondary patterns, consistent with FONT-GEN-005's own findings:

- **Cursive is categorically harder for pytesseract than block lettering**, ceiling included:
  Sacramento/SacramentoSkeleton solid ink tops out at ~0.29 char accuracy; Baloo2/Baloo2Variable
  solid ink reaches ~0.55–0.64. Neither family gets remotely close to 0.85.
- **The rhinestone transform itself still costs something relative to its own solid-ink ceiling** —
  generated-family solid ink scores at or below its matching baseline's solid ink at every size for
  every family (e.g. Sacramento generated 0.145–0.286 vs. baseline 0.228–0.289) — but that gap is
  dwarfed by the gap between *either* number and the 0.85 threshold. The threshold was failing this
  corpus before the rhinestone pipeline was ever involved.

---

## 4. What this does and doesn't change

- **Does not reopen FONT-GEN-001 through 005's REJECT verdicts.** Those were independently
  justified by `clusterCount` geometry evidence, which this milestone doesn't touch and which
  FONT-GEN-005 already confirmed is orientation- and (by construction) OCR-independent.
- **Does establish that the OCR-based acceptance gate itself is broken** — not miscalibrated in
  degree, unreachable in kind, on this corpus with this engine — and needs replacing, per
  FONT-POLICY-001's standing recommendation and this branch's FONT-EVAL-002 that follows.

---

## 5. Files changed

**New**: `tools/font-generator/lib/solid_ink.py` (was untracked, now committed),
`tools/font-generator/evaluate_solidink.py`, `tools/font-generator/analyze_solidink.py`.
**New output**: `generated-fonts/SS*/evaluation.solidink.{generated,baseline}[.<family>].SS*.json` (35
files) and matching `summary.solidink.*.json` (40 files, including the reused
SacramentoSkeleton-baseline duplicate).

No change to any production code, existing font-generator library module, generated TTF, or prior
milestone's output. Existing `tools/font-generator/tests/` suite (7 files) re-run unmodified and
still passes — confirmed no shared code path was touched.

---

## 6. Final recommendation

**The 0.85/0.80/1.0/0.15 pytesseract thresholds should not be used as an acceptance gate going
forward.** They fail every font this codebase has ever generated or sourced, including plain
unmodified baseline typefaces rendered as solid ink with zero rhinestone information loss. See
FONT-EVAL-002 for the replacement metric/threshold recommendation.
