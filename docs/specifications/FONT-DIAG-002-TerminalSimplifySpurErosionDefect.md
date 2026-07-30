# FONT-DIAG-002 — Terminal-Simplify Spur-Erosion Defect

Branch `feature/font-arch-001`. Root-cause investigation into the "Biri hday" rendering defect
FONT-EVAL-002's vision-transcription pass surfaced in Baloo2Variable's generated family, per direct
request: confirm which sizes it appears at, whether it's spacing/hmtx/kerning or a glyph-boundary
defect, whether other families show the same class of defect, and re-check the full 140-image
vision-transcription output for anything else that doesn't read as the exact input string.

**Finding: it's a glyph-outline defect, not spacing.** A specific transform step —
`_simplify_details()` in `tools/font-generator/lib/glyph_transform.py` — erodes thin protruding
strokes (a "t" crossbar, a "7" 's top hook) as if they were spurs/flourishes to be cleaned up. It
reproduces wherever a glyph's terminal stroke is thin relative to the per-size erosion radius, and
never reproduces on the one family (Baloo2, FONT-GEN-002) whose source weight is thick enough to
have margin against it.

---

## 1. Confirmed defect inventory (full 140-image re-check)

Re-scored every non-exact vision transcription from FONT-EVAL-002's 140-image sample against the
actual glyph geometry. **One of the four previously-reported defect rows was a transcription error
on my part, not a real rendering defect** — see §4. The corrected, confirmed list:

| Family/variant | Size(s) | Expected | Read as | Root cause (this doc) |
|---|---|---|---|---|
| Baloo2Variable generated | **SS6, SS10, SS16, SS20, SS30 — all 5** | "Happy Birthday" | "Happy Biri hday" | "t" crossbar eroded, §2 |
| Baloo2Variable generated | SS20 only | "Class of 2027" | "C lass of 2027" | "C" over-eroded, §3 |
| Baloo2Variable generated | SS6 only | "Class of 2027" | "Class of 2021" | "7" hook eroded, §3 |
| Sacramento generated | SS6 only | "Class of 2027" | "Class of 202" (+ stray fragment) | "7" collapses, §3 |
| ~~Sacramento generated~~ | ~~SS30~~ | ~~"Class of 2027"~~ | ~~"Class of 202"~~ | **Not real — §4** |

No other required-phrase transcription among the 140 images was non-exact. This is the complete
list.

---

## 2. The "t" defect — confirmed at every size, confirmed as an outline defect

Compared glyph bounding boxes (fontTools `BoundsPen`) between each generated `Baloo2VariableRhinestone_<SIZE>.ttf`'s "t" and its baseline source (`Baloo2-wght400.ttf`):

| Size | Generated "t" bounds | Width | % of baseline width (255 units) |
|---|---|---|---|
| baseline | (76, -13, 331, 603) | 255 | 100% |
| SS6 | (76, -11, 233, 603) | 157 | 62% |
| SS10 | (76, -6, 214, 603) | 138 | 54% |
| SS16 | (76, -1, 199, 603) | 123 | 48% |
| SS20 | (76, -8, 221, 603) | 145 | 57% |
| SS30 | (76, -4, 206, 603) | 130 | 51% |

The **left edge (x=76) is identical to baseline at every size** — that's the vertical stem, untouched.
Only the right edge moves, i.e. only the crossbar's rightward extension is clipped — by roughly half,
consistently, at every committed size. `hmtx` confirms this isn't a spacing artifact: left-side-
bearing is unchanged (76 in both baseline and SS16-generated) and advance width is nearly identical
(372 → 386 units, an ordinary small correction, not a truncation).

**Gap analysis on the actual rendered stones** (SS16, "Happy Birthday" case) confirms the visual
symptom matches: binning stone x-positions into 2mm columns shows normal inter-letter gaps of
6–10mm throughout the word, one clean 22mm word-space between "Happy" and "Birthday" — and one
20mm gap *inside* "Birthday" itself, almost as wide as the word-space, sitting exactly where the
crossbar should bridge the stem to "h". That's what reads as "Biri hday": the stem survives as a
thin fragment (misread as a second "i"), the crossbar's bridge to "h" is simply gone.

---

## 3. Same mechanism, different glyphs, different sizes

**"7" in Baloo2Variable generated, SS6 only**: baseline bounds (24, -5, 438, 608), width 414. SS6-
generated bounds (106, -5, 438, 608), width 332 (80%). The **right edge is unchanged**; the *left*
edge moved from 24 to 106 — the numeral's top-left hook is what's clipped this time, not a uniform
shrink. Same erosion mechanism, different terminal stroke, same "thin protrusion gets treated as a
spur" signature.

**"C" in Baloo2Variable generated, SS20 only**: baseline width 485. SS16/SS6/SS10/SS30 all generate
at 494–495 units (normal, slightly larger than baseline — expected correction). **SS20 alone**
generates at 291 units (60%) — a severe, isolated outlier at exactly one size.

**"7" in Sacramento generated, SS6 only**: baseline bounds (0, -38, 1323, 1403), width 1323. SS6-
generated bounds (851, 1036, 1342, 1428), width 491 (37%) — and the y-range (1036–1428) sits
entirely in the *upper* portion of the glyph's original vertical extent (baseline spans -38 to
1403). The diagonal downstroke and lower two-thirds of the numeral are gone; what's left is a small
disconnected fragment in the upper-right, confirmed visually (full-resolution image shows an
isolated blob, disconnected from "202", not read as "7" by direct inspection either).

**Why sizes differ per glyph, and why this isn't a "per-size weight selection" bug**: `paths.py`
(`FAMILY_SIZE_SOURCE_FONTS`) confirms FONT-GEN-003 selected the same wght400 (Regular) source font
at *all five* committed sizes — no weight varies. The defect instead comes from the **same shared**
transform code (`glyph_transform.py`, used identically regardless of size) running independently
per size against size-scaled thresholds (`terminalSimplifyMm` differs SS6→SS30 per
`config/SS*.json`). Those thresholds cross a given glyph's specific terminal-stroke width at
different points for different glyphs — "t"'s crossbar is thin enough to trip the erosion at every
size; "7"'s hook and "C"'s curve are only thin enough (relative to that size's specific radius) at
one particular size each. This is consistent with a fixed-radius morphological operation interacting
with slightly different per-glyph geometry, not a systematic per-size scaling error.

**The mechanism, named in code**: `_simplify_details()` (`glyph_transform.py:196`) — "terminal
simplification / detail removal — morphological opening (erode, dilate) at `terminalSimplifyFu`,
removing spurs/flourishes smaller than that radius" (module docstring, step 1 of 4). A crossbar
protruding from a stem, or a hook protruding from a stroke, is exactly the shape this operation is
designed to clean up as noise — and does, here, when the source glyph's terminal stroke is thin
enough relative to that size's radius. The function already caps its erosion radius "to a safe
fraction of the glyph's own thinnest existing feature" specifically to guard against this failure
mode (`glyph_transform.py:199`) — that cap is evidently not fully protective for these specific
terminal strokes.

---

## 4. Correction: the SS30 Sacramento "digit drop" was not a real defect

FONT-EVAL-002 originally reported Sacramento generated dropping the trailing "7" at **both** SS6
and SS30. Checking SS30's actual glyph bounds found nothing unusual (491→1405 units, essentially
identical to SS10/16/20's ~1400-unit "7"). Re-viewing the actual per-case image at full resolution
(rather than the compressed 7-row review sheet used during the original transcription pass)
confirms it: **the SS30 image reads "Class of 2027" correctly and completely** — the "7" is present,
merged visually with the preceding "2" in a way that was illegible at the sheet's compressed scale
but is unambiguous at full resolution. This was a transcription misread against a low-resolution
composite, not a font defect. `FONT-EVAL-002-HumanCalibratedLegibilityBaseline.md` §3 has been
corrected accordingly (18/20 → 19/20 Sacramento-generated vision-exact, 131/140 → 132/140 overall).

The SS6 Sacramento case is unaffected by this correction and remains a confirmed real defect (§3).

---

## 5. Why Baloo2 (FONT-GEN-002) and SacramentoSkeleton (FONT-GEN-004) don't show it

**Baloo2** (ExtraBold-sourced, fixed weight, ships as its own family independent of the per-size
weight-selection mechanism): "t" glyph bounds are **pixel-identical** generated vs. baseline —
(54, -15, 370, 609), width 316, both. Zero erosion. ExtraBold's naturally thick strokes never
approach the terminal-simplify radius closely enough to be treated as a removable spur — the same
transform code runs, the same erosion step executes, but there's nothing thin enough to erode.
This directly confirms the defect needs a *thin* source stroke to manifest, not just "the transform
ran."

**SacramentoSkeleton** (FONT-GEN-004): zero non-exact vision transcriptions in the 140-image sample.
Its correction strategy (`glyph_transform_skeleton.py`, skeleton-rebuild) is a categorically
different algorithm from `glyph_transform.py`'s buffer-based morphological passes — it doesn't run
`_simplify_details()`'s erode/dilate opening at all. Consistent with the root cause being specific
to that one transform step, not an inherent property of rhinestone conversion in general.

---

## 6. Scope note

This report identifies the mechanism (terminal-simplify's spur-erosion step, insufficiently capped
for thin terminal strokes) and confirms it empirically across four glyph/size combinations. It does
not trace the exact numeric interaction between each glyph's stroke width, each size's
`terminalSimplifyFu`, and the "safe fraction" cap's formula — that would be the natural next step if
this defect is prioritized for a fix, alongside auditing whether other thin-stroke terminal features
(other letters' crossbars, hooks, serifs) are affected outside this milestone's 140-image sample.

---

## 7. Files changed

**Correction only**: `docs/specifications/FONT-EVAL-002-HumanCalibratedLegibilityBaseline.md` (§3
table and prose, per §4 above). **New**: this report. No code changes — this is a diagnostic
investigation, not a fix. No production code, `GeometryEngine`, `StoneLayout`, generated TTF, or
prior milestone's output touched.
