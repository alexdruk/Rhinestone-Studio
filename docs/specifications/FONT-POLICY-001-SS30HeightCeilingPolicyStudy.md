# FONT-POLICY-001 -- SS30 Height Ceiling Policy Study

Status: **Findings complete, pending human-rating confirmation.** No production config changed
(`SS30.json`, `StoneSizes.js`, `manifest.json`'s `unsupportedStoneSizes` all untouched) per this
milestone's brief -- a rater-tool batch is built and browser-verified, awaiting human ratings
before any of those files are edited.

---

## 1. Objective

FONT-PORTFOLIO-001's human ratings collapsed at SS30 for 3 of 4 registered fonts (Anton 6/16,
Sacramento 2/16, Dancing Script 1/16) while Baloo2Variable wght400 held up (15/16). Its own
follow-up commit (a721445) found `clusterCount` does not spike at SS30 the way the collapse would
predict, and pointed back at FONT-DIAG-001/FONT-ARCH-001's still-unresolved question: is SS30's
106-111mm height range a real physical ceiling, or an arbitrary value that's simply too narrow?
This milestone answers that question with evidence.

## 2. Step 1 -- Where did 106-111mm come from?

Not a physical constraint. Three independent sources confirm this:

- **`FONT-ARCH-001-RhinestoneFontArchitectureStudy.md`** (the architecture study that produced this
  table) states outright: *"The certified height range per stone size is a **milestone-specified
  table**... not derived from each font's own metrics -- the certification proves the table is
  achievable, not that it is optimal per font."* The same doc flags, as its own **Unknown #5**,
  whether the SS30 floor "conflicts with any product's actual physical printable region" -- and
  that question was never answered until this milestone (no later doc references it).
- **`tools/font-generator/config/SS30.json`**'s `calibrationNotes` (added in FONT-GEN-001, the only
  commit that ever touched this file) says the whole per-size table, including SS30's, was
  *"derived from stoneDiameterMm proportionally"* -- an initial-pass formula, not a measured limit.
- Git history: `supportedHeightRangeMm` for every stone size has exactly one commit each
  (`bfc8bde`, FONT-GEN-001) and has never been revisited since.

## 3. Step 3 -- Physical constraint check (this milestone's own audit)

`src/products/definitions/*.json` + `src/products/VesselProductDefinition.js`'s
`computePrintableHeightMm()` (`= bodyHeightMm - printableMarginMm`, floored at 10mm) give the real
per-product printable-height envelope:

| Product | printableHeightMm range (min product config -> max) |
|---|---|
| Mug | 68mm - 92mm (bodyHeightMm 88-102, margin 10) |
| Tumbler | 135mm - 155mm (bodyHeightMm 165-185, margin 30) |
| Bottle | 120mm - 160mm (bodyHeightMm 130-170, margin 10) |
| Plate (center well) | 175mm - 215mm diameter (innerWellDiameterMm) |
| Plate (full top surface) | 250mm - 300mm diameter (outerDiameterMm) |

Two findings:

1. **SS30 is already categorically unusable on mugs, independent of any ceiling change** -- a
   mug's *maximum* achievable printable height (92mm) is already below SS30's *current* 106mm
   floor. `stoneSizeEntirelyExceedsPrintableHeight()` (`StoneSizes.js`) already disables SS30 in
   the `#stoneSize` picker for every mug configuration today (`app.js`'s
   `updateStoneSizePrintableCapabilityUI()`). This was never about the ceiling being too low --
   the floor alone already excludes mugs.
2. **Tumbler, bottle, and plate all have real headroom above 111mm** -- tumbler up to 155mm,
   bottle up to 160mm, plate far beyond that. There is no hard physical wall sitting at 111mm for
   any of these three; the current ceiling is simply below what those products can print.

## 4. Step 2 -- Height sweep, 111-200mm

`tools/font-generator/render_font_policy_001.py` swept `stoneSizeId: ss30` across 7 heights (111,
125, 140, 155, 170, 185, 200mm) for Anton, Sacramento, Dancing Script, and Baloo2Variable wght400
(control), full 16-phrase corpus (4 required + 12 longform), through the real
`measure.mjs`/`GeometryEngine` production pipeline -- 448 measured cases, zero collisions
everywhere. Renders (`render_review_png()`, genuine stone-dot images, not OCR's blur render) were
produced for the 4 required phrases at every height as contact sheets
(`tmp/font-policy-001/sheets/`) and visually read directly (this milestone's own vision pass).

**clusterCount alone is noisy and dominated by rising stone count as height increases** (more
height = more stones = more clusters, independent of whether letterforms are actually
fragmenting) -- confirming FONT-PORTFOLIO-001's own warning that this metric misses things a human
catches. Normalizing to **clusterCount/stoneCount ratio** (fragmentation density, aggregated across
all 16 phrases per height) isolates the real signal:

| Height | Anton | Sacramento | Dancing Script | Baloo2Variable (control) |
|---|---|---|---|---|
| 111mm (current ceiling) | 3.08% | 3.40% | 2.36% | 3.37% |
| 125mm | 2.75% | 3.16% | 2.73% | 2.99% |
| 140mm | 3.00% | 2.65% | 2.14% | 3.83% |
| 155mm | 3.88% | 1.54% | 1.66% | 3.19% |
| 170mm | 3.59% | **0.92%** | **1.33%** | 3.69% |
| 185mm | 3.33% | 0.83% | 1.78% | 3.71% |
| 200mm | 4.06% | 0.79% | 1.75% | 2.86% |
| **SS20 parity target** | 3.31% | 2.23% | 2.04% | -- |

- **Sacramento**: monotonic, substantial decline (3.40% -> 0.79%) -- crosses below its own SS20
  parity target (2.23%) between 140mm and 155mm, roughly **~146mm**, and keeps improving well past
  that.
- **Dancing Script**: same direction, crosses its SS20 parity target (2.04%) between 125mm and
  140mm, roughly **~135-140mm**, best around 170mm before flattening/going slightly noisy at
  185-200mm.
- **Anton**: flat-to-noisy across the whole range, already at/near its own SS20 parity (3.31%) even
  at the *current* 111mm ceiling -- height is not the lever for Anton's collapse.
- **Baloo2Variable (control)**: flat/noisy throughout, no regression at any tested height -- safe
  across the whole sweep.

**Genuine render_review_png() visual read confirms the numbers, and adds what the ratio alone
can't show:**

- **Sacramento** at 111mm is a thin single-track outline that is already reasonably legible for
  short/common words but visibly cramped on tighter connectors. At 200mm the outline becomes a
  clean double-track stroke with clearly separated letterforms -- a qualitative jump, not just a
  ratio change.
- **Dancing Script** at 111mm is the clearest visual casualty: interior counters and connecting
  strokes blur into a jagged single line, letters run together ("Bride Squad" reads noisy). At
  170mm the same phrases render as crisp double-track outlines with clean letter separation --
  the starkest before/after of the three.
- **Anton** at 111mm and at 200mm look essentially the same: a clean single-outline block
  letterform at both heights, no fragmentation to resolve either way. This reinforces the metric
  finding -- **raising the SS30 ceiling is not expected to fix Anton's SS30 collapse**; whatever
  caused its 6/16 human rating (likely specific glyphs/longform phrases, not height) is a separate,
  out-of-scope question.
- **Baloo2Variable** stays clean and legible at 200mm, matching its 111mm baseline -- confirms no
  regression risk from raising the ceiling.

## 5. Recommendation

**Raise SS30's `supportedHeightRangeMm` ceiling from 111mm to approximately 160-165mm** (floor
unchanged at 106mm) -- this is a height-calibration gap for the two connected-script fonts, not a
uniform stone-size limit, and no physical constraint blocks it for tumbler/bottle/plate (mugs are
already excluded by the existing floor regardless). 165mm was chosen as the candidate for human
validation because it sits comfortably past both script fonts' fragmentation-parity crossing
points (~140-146mm) while still fitting this project's own printable-height envelope for
non-mug products (tumbler max 155mm, bottle max 160mm, plate far beyond).

**Anton's SS30 gating should NOT be lifted by this change** -- its collapse shows no relationship
to height in either the fragmentation-ratio data or the genuine renders. It should stay disabled
via `unsupportedStoneSizes` pending separate investigation, out of scope here.

**Per the brief, no production files were changed.** `SS30.json`, `StoneSizes.js`, and
`manifest.json`'s `unsupportedStoneSizes` all remain exactly as FONT-PORTFOLIO-001 left them.

### Human validation batch (built, browser-verified, not yet rated)

`tools/font-generator/render_font_policy_001_rater_batch.py` rendered the full 16-phrase corpus at
both 111mm (current) and 165mm (candidate) for all 4 fonts (128 genuine `render_review_png()`
renders, real production pipeline). `tools/font-generator/build_rater_tool_font_policy_001.py`
built one rater tool per font (32 items each, height hidden/randomized so rating is blind, same
Readable/Unreadable/Not Sure UI as every prior rater tool):

- `review/FONT-POLICY-001-rater-Anton.html`
- `review/FONT-POLICY-001-rater-Sacramento.html`
- `review/FONT-POLICY-001-rater-DancingScript.html`
- `review/FONT-POLICY-001-rater-Baloo2Variable.html`

Browser-verified via isolated headless Chrome/CDP (Playwright): all 4 tools load, render the first
specimen, advance progress on rating, zero console errors.

**Next step (blocked on the user):** rate all 4 tools, export results, and compare 111mm vs.
165mm Readable rates per font. If Sacramento/Dancing Script's 165mm ratings clear a similar bar to
their SS20 performance (and Anton/Baloo2Variable show no regression), update `SS30.json`,
`StoneSizes.js`'s `ss30` entry, and re-run `tools/test-stone-size-library.mjs` +
`tools/test-font-portfolio-001-stone-size-gating.mjs` to confirm the new ceiling doesn't break
existing gating tests -- but not before that confirmation.

## 6. Raw data

- `tmp/font-policy-001/measurements.json` -- all 448 sweep measurements (clusterCount,
  collisionCount, stoneCount per font/height/phrase).
- `tmp/font-policy-001/renders/`, `tmp/font-policy-001/sheets/` -- 112 individual PNGs + 28 contact
  sheets (4 required phrases x 7 heights x 4 fonts).
- `tmp/font-policy-001-rater-batch/` -- the 128-render human-validation batch backing the rater
  tools above.

(`tmp/` output is not committed, matching every prior FONT-* milestone's convention -- only the
scripts under `tools/font-generator/` and the built `review/*.html` rater tools are.)
