# FONT-GEN-005 — OCR/Review Render Orientation Bug Fix and Re-Validation

Branch `feature/font-arch-001`. Not a new font-generation experiment: a bug investigation and
re-validation of FONT-GEN-001 through FONT-GEN-004's OCR evidence, triggered by a reported bug
("review images render upside down").

**Bug confirmed and fixed.** `tools/font-generator/lib/render_stones.py` rendered every review PNG
and every OCR-scoring image upside down, for every milestone that ever used it (FONT-GEN-001
through 004 — no earlier milestone used OCR at all). **The bug is fully shared** between the
human-review path and the OCR-scoring path: both `render_review_png()` and `render_ocr_image()` are
two functions in the same file with the identical flawed transform. After the fix, OCR accuracy
changes substantially for some fonts (especially Baloo 2 / Baloo2Variable) and mildly for others
(Sacramento / SacramentoSkeleton) — but **no milestone's REJECT recommendation changes**: geometry
(`clusterCount`) evidence, which never depended on rendering orientation, is untouched and remains
independently sufficient to reject all four generated families, and no font — before or after the
fix — clears the OCR acceptance thresholds.

---

## 1. Root cause

`render_stones.py`'s `render_review_png()`/`render_ocr_image()` computed pixel Y as:

```python
cy = h - (s["yMm"] - miny) * scale
```

This is the standard flip for converting **Y-up** (mathematical/font-space) coordinates into
**Y-down** (raster/image) pixel rows. It assumes `stone.yMm` is Y-up. It isn't.

`OpenTypeProvider.getTextPath()` (`src/text/OpenTypeProvider.js`) builds glyph outlines via
opentype.js's `Glyph.getPath(x, y, fontSize)`, which negates the font's Y coordinate internally
(`node_modules/opentype.js/dist/opentype.mjs`: `p.moveTo(x + cmd.x * xScale, y + -cmd.y * yScale)`)
— opentype.js is designed to hand back paths ready for direct canvas drawing, so its output is
already **Y-down**. `OpenTypeProvider` passes this straight through into `VectorPath`/`Contour`
with no re-flip, `GeometryEngine` samples stone positions from that same Y-down geometry, and
`src/renderer/CanvasRenderer2D.js`'s `renderStoneLayout()` — the code that actually draws every
project on screen in the shipped app — maps `yPx = oy + stone.yMm * s` with **no flip at all**.
Three independent pieces of evidence (opentype.js's own source, `CanvasRenderer2D.js`'s zero-flip
contract, and the empirical test below) agree: `StoneLayout.yMm` is Y-down, matching Canvas 2D's
native convention, by design.

`render_stones.py`'s extra `h - ...` flip therefore took already-correct Y-down data and flipped it
a second time, rendering every stone layout upside down in both the human-review PNGs and the
tesseract OCR input images — while the live Studio app itself (which never flips) has always
rendered correctly. This is a bug confined entirely to this offline research tool, not a
production defect.

### Empirical confirmation

Measured numeral "7" (Sacramento, SS10) directly via `measure.mjs`: the wide horizontal bar
(x-spread 29.4mm) sits at **minimum** `yMm`, and the narrow point (x-spread 1.4mm) sits at
**maximum** `yMm`. A real "7" has its bar at the top and its point at the bottom — confirming `yMm`
increases *downward* (min = top, max = bottom), i.e. Y-down.

Rendering the exact same, unmodified FONT-GEN-001 baseline case (`req-ashley__mid`, SS10) with the
old vs. new code and diffing the two PNGs: **the old image, flipped top-to-bottom, is pixel-for-pixel
identical to the new one (`ImageChops.difference` sum = 0)**. The fix is exactly and only a vertical
mirror — nothing else about the rendering changed.

---

## 2. Fix

`tools/font-generator/lib/render_stones.py`: removed the `h - (...)` flip in both
`render_review_png()` and `render_ocr_image()`, replaced with a direct, un-flipped mapping
(`cy = (s["yMm"] - miny) * scale`), matching `CanvasRenderer2D.js`'s own convention exactly. No
other change to either function (blur, supersampling, padding, sizing logic all untouched).

New regression test: `tools/font-generator/tests/test_render_orientation.py`. Synthetic two-stone
case (no font/measure.mjs dependency) asserts the min-`yMm` stone renders in the image's top half
and the max-`yMm` stone renders in the bottom half, for both `render_review_png()` and
`render_ocr_image()`. Verified this test fails against the pre-fix code (via `git stash`) and
passes against the fix.

No change to `ocr_eval.py` (it only runs tesseract against an already-rendered `PIL.Image` — no
coordinate transform of its own, confirmed by reading its full source) or to any geometry/clustering
code (`productionAnalysis.mjs`'s `pairwiseStats`/`countClusters` operate on `xMm`/`yMm` distances
directly, which are orientation-invariant — flipping every point's Y by the same transform doesn't
change any pairwise distance).

---

## 3. Re-validation method

Per the brief: TTFs were **not** regenerated (the bug is purely in rasterization for visualization/
OCR, not in font generation), and `clusterCount`/`collisionCount` geometry metrics were **not**
re-measured (confirmed orientation-independent, §5). Only OCR evaluation was re-run, against the
exact same already-generated, already-committed TTFs from FONT-GEN-001 through 004:

- **FONT-GEN-001** (`Sacramento` family): full re-run, generated + baseline (Sacramento.ttf itself).
- **FONT-GEN-004** (`SacramentoSkeleton` family): generated only, reusing FONT-GEN-001's freshly
  re-measured Sacramento baseline via `pipeline.py --reuse-baseline-from` (same mechanism FONT-GEN-004
  itself introduced) — avoids re-measuring the identical baseline font twice.
- **FONT-GEN-002** (`Baloo2` family): full re-run, generated + baseline (Baloo2-Bold.ttf).
- **FONT-GEN-003** (`Baloo2Variable` family): full re-run, generated + baseline (Baloo2-wght400.ttf).

All 4 families × 5 sizes × 171 cases = 3,420 OCR measurements, plus the 3 distinct baseline fonts ×
5 sizes × 171 cases = 2,565 more (Sacramento's baseline is shared by FONT-GEN-001 and FONT-GEN-004),
for 5,985 total render+OCR operations. `analyze.py --all` re-run for all 4 families afterward to
regenerate `summary.*.json` (verdicts) from the corrected `evaluation.*.json` files.
`build_review_html.py` re-run for all 4 milestones to regenerate `review/FONT-GEN-00{1,2,3,4}-review.html`
and every review PNG under `review/assets/**` with the corrected, right-side-up rendering.

Old (pre-fix) `evaluation.*.json`/`summary.*.json` were backed up before re-running, for the
before/after comparison below.

---

## 4. Results — OCR accuracy before vs. after the fix

**Geometry metrics are byte-identical before and after** (verified programmatically across all 20
generated-family/size combinations that already had `meanClusterCount`/`meanCollisionCount`/
`meanStoneCount` recorded pre-fix: 0 mismatches) — confirming clusterCount-based evidence in every
prior report is unaffected by this bug, exactly as expected.

**OCR accuracy changed meaningfully, and the size of the change is typeface-dependent:**

### FONT-GEN-001 (Sacramento)
| Size | Old genCA | New genCA | Old genWA | New genWA | Old req | New req | Old unrecFrac | New unrecFrac |
|---|---|---|---|---|---|---|---|---|
| SS6 | 0.092 | **0.139** | 0.006 | **0.006** | 0/12 | **0/12** | 0.637 | **0.585** |
| SS10 | 0.085 | **0.143** | 0.006 | **0.002** | 0/12 | **0/12** | 0.649 | **0.556** |
| SS16 | 0.049 | **0.089** | 0.006 | **0.002** | 0/12 | **0/12** | 0.795 | **0.702** |
| SS20 | 0.038 | **0.072** | 0.000 | **0.006** | 0/12 | **0/12** | 0.836 | **0.784** |
| SS30 | 0.045 | **0.081** | 0.000 | **0.006** | 0/12 | **0/12** | 0.801 | **0.725** |

### FONT-GEN-002 (Baloo2)
| Size | Old genCA | New genCA | Old genWA | New genWA | Old req | New req | Old unrecFrac | New unrecFrac |
|---|---|---|---|---|---|---|---|---|
| SS6 | 0.146 | **0.387** | 0.020 | **0.124** | 0/12 | **3/12** | 0.532 | **0.316** |
| SS10 | 0.087 | **0.241** | 0.006 | **0.060** | 0/12 | **3/12** | 0.708 | **0.521** |
| SS16 | 0.102 | **0.242** | 0.012 | **0.038** | 0/12 | **1/12** | 0.667 | **0.480** |
| SS20 | 0.082 | **0.233** | 0.008 | **0.028** | 0/12 | **1/12** | 0.702 | **0.509** |
| SS30 | 0.065 | **0.127** | 0.006 | **0.021** | 0/12 | **0/12** | 0.778 | **0.655** |

### FONT-GEN-003 (Baloo2Variable)
| Size | Old genCA | New genCA | Old genWA | New genWA | Old req | New req | Old unrecFrac | New unrecFrac |
|---|---|---|---|---|---|---|---|---|
| SS6 | 0.169 | **0.710** | 0.023 | **0.365** | 0/12 | **7/12** | 0.462 | **0.094** |
| SS10 | 0.162 | **0.658** | 0.020 | **0.318** | 0/12 | **7/12** | 0.485 | **0.135** |
| SS16 | 0.117 | **0.572** | 0.000 | **0.256** | 0/12 | **5/12** | 0.573 | **0.175** |
| SS20 | 0.094 | **0.527** | 0.006 | **0.196** | 0/12 | **6/12** | 0.620 | **0.222** |
| SS30 | 0.072 | **0.397** | 0.000 | **0.141** | 0/12 | **7/12** | 0.696 | **0.380** |

### FONT-GEN-004 (SacramentoSkeleton)
| Size | Old genCA | New genCA | Old genWA | New genWA | Old req | New req | Old unrecFrac | New unrecFrac |
|---|---|---|---|---|---|---|---|---|
| SS6 | 0.070 | **0.146** | 0.000 | **0.025** | 0/12 | **0/12** | 0.661 | **0.602** |
| SS10 | 0.075 | **0.123** | 0.000 | **0.002** | 0/12 | **0/12** | 0.655 | **0.626** |
| SS16 | 0.064 | **0.089** | 0.008 | **0.000** | 0/12 | **0/12** | 0.731 | **0.702** |
| SS20 | 0.046 | **0.068** | 0.000 | **0.004** | 0/12 | **0/12** | 0.784 | **0.743** |
| SS30 | 0.050 | **0.065** | 0.000 | **0.012** | 0/12 | **0/12** | 0.778 | **0.795** |

**The magnitude of the change is starkly typeface-dependent.** Baloo 2 / Baloo2Variable (non-cursive,
unconnected letterforms) show dramatic improvement — Baloo2Variable's mean character accuracy roughly
quadruples at every size (0.07–0.17 → 0.40–0.71), and required-phrase recognition goes from
**0/12 at every size, both milestones** to as high as **7/12**. Sacramento / SacramentoSkeleton
(connected cursive script) show much smaller absolute gains (char accuracy roughly doubles but stays
under 0.15 everywhere) and **required phrases remain 0/12 at every size, in every case, before and
after the fix.**

---

## 5. Does this change any milestone's final recommendation?

**No. All four milestones remain REJECT.** `analyze.py`'s `check_thresholds()` was re-run
(unmodified) against the corrected data, and **zero of the 20 generated-family/size combinations
pass** — every one still fails at least one of the four acceptance criteria (mean char accuracy
≥0.85, mean word accuracy ≥0.80, required-phrase accuracy = 1.0, unrecognized-fraction ≤0.15), most
by a wide margin. The closest case, Baloo2Variable SS10, now clears the unrecognized-fraction
threshold (0.135 ≤ 0.15) but still fails char accuracy (0.658), word accuracy (0.318), and
required-phrase accuracy (0.583) outright.

This holds independent of OCR, too: **`clusterCount` fragmentation regression — the second,
independent line of evidence every one of these reports weighted alongside OCR — is completely
unaffected by this bug** (§4), and on its own already justified REJECT in all four original reports.
Fixing the orientation bug removes a confound from the OCR evidence; it does not touch the geometry
evidence that was already sufficient.

**What does change is the narrative interpretation of *why* OCR scored near zero.** FONT-GEN-002's
report attributed low scores partly to "tesseract's low ceiling," generalizing FONT-GEN-001's
Sacramento-specific finding across typefaces. That explanation now reads as **overstated for
Baloo 2/Baloo2Variable specifically**: correctly oriented, Baloo2Variable's *baseline* reaches up to
0.84 mean character accuracy and 9/12 required phrases at some sizes — genuinely legible to OCR, not
capped by an inherent ceiling. The "tesseract ceiling on this typeface" explanation holds up far
better for Sacramento, where even the corrected baseline stays under 0.33 char accuracy and 0/12
(FONT-GEN-001) to 1/12 (per-size) required phrases — consistent with a real, typeface-specific OCR
limitation on connected cursive script, not an artifact.

The **generated-vs-baseline relative comparison** each report's OCR conclusion actually leaned on
mostly still holds: generated remains **worse than baseline at every FONT-GEN-001, FONT-GEN-003, and
FONT-GEN-004 size** (unchanged conclusion — the transform doesn't improve readability over doing
nothing). FONT-GEN-002 (Baloo 2, fixed ExtraBold) is the one exception: generated now exceeds
baseline's char accuracy at 3 of 5 sizes post-fix (previously read as "statistically
indistinguishable" either way) — a real shift in that report's own comparative framing, though not
enough on its own to move Baloo2 out of REJECT given §5's threshold numbers above.

---

## 6. What was NOT re-validated

- The four reports' own prose (specific quoted OCR failure examples, e.g. FONT-GEN-001 §6's "Ashley"
  → "Alley" table) was generated from upside-down renders and is **not reliable as stated** — the
  underlying raw OCR text for those specific cases would differ post-fix. This report does not
  re-derive per-case failure tables for all four milestones; the aggregate numbers in §4 are the
  authoritative corrected record.
- Review HTML pages and PNGs were regenerated for all 4 milestones (`review/FONT-GEN-00{1,2,3,4}-review.html`,
  `review/assets/**`) and are now correctly oriented, but this report did not re-inspect every
  milestone's qualitative findings (e.g. FONT-GEN-004's double-loop-ring artifact, §9 of that report)
  for orientation-dependent errors — that finding was based on geometry/contour-count metadata and
  directly-inspected renders, cross-checked against the (also-corrected) generation-metadata, and
  remains valid: it was never about text-reading direction, and the double-ring artifact is visible
  identically right-side-up or upside-down.
- No fonts were registered to `assets/fonts/manifest.json`; this remains unchanged from every prior
  milestone (all REJECT, none integrated).

---

## 7. Files changed

**Fix**: `tools/font-generator/lib/render_stones.py` (both render functions' Y transform).
**New test**: `tools/font-generator/tests/test_render_orientation.py`.
**Regenerated** (OCR-derived data only, geometry fields byte-identical): `output/SS*/evaluation.SS*.json`,
`output/SS*/evaluation.{Baloo2,Baloo2Variable,SacramentoSkeleton}.SS*.json` and their `summary.*.json`
counterparts (20 evaluation + 20 summary files). `generation-metadata.*.json` files are untouched
(unrelated to rendering). `review/FONT-GEN-00{1,2,3,4}-review.html` and every PNG under
`review/assets/**` regenerated with corrected orientation.
**Erratum notes added** (pointing here, original content otherwise untouched) to
`docs/specifications/FONT-GEN-00{1,2,3,4}-*.md`.

No change to `glyph_transform.py`, `glyph_transform_skeleton.py`, `glyph_geometry.py`,
`glyph_category.py`, `font_build.py`, `generate.py`, `paths.py`, `ocr_eval.py`, `validate_font.py`,
or any generated TTF — confirmed by diff. This milestone touches rasterization/evaluation only.

---

## 8. Final recommendation

**REJECT stands for all four generated families** (Sacramento/FONT-GEN-001, Baloo2/FONT-GEN-002,
Baloo2Variable/FONT-GEN-003, SacramentoSkeleton/FONT-GEN-004). The orientation bug was real, was
shared between the human-review and OCR-scoring paths, and materially understated OCR accuracy —
dramatically so for Baloo 2/Baloo2Variable — but correcting it does not change any milestone's
outcome, because (a) no corrected result gets remotely close to the declared acceptance thresholds,
and (b) the independent `clusterCount` geometry evidence, unaffected throughout, already justified
REJECT on its own in every one of the four original reports. FONT-POLICY-001 remains the
recommended next step, unchanged.
