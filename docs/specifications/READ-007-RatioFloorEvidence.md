# READ-007 — Ratio floor evidence (analysis only)

**Status:** implemented. Branch `feature/read-007-ratio-floor-evidence` off `develop`. Analysis only
— no product code and no rendered output changed. Findings in §8.

**Authorises:** new derived tables in `docs/data/read-005/derived-tables.json`, computed by
`tools/font-certification/analyze-ratings.mjs` from the four existing frozen inputs.

**Does not authorise:** any change to `app.js`, to `MIN_AUTOFIT_HEIGHT_TO_SPACING_RATIO`, to the
default text layer, or to any UI. Those follow in their own milestone, gated on this one's numbers.

---

## 1. The production question this exists to answer

`MIN_AUTOFIT_HEIGHT_TO_SPACING_RATIO = 6` (`app.js:534`) is the only readability floor in the
product's sizing path. Two defects are visible in the source before any data is consulted.

**It is measured in the wrong unit.** `computeAutoFitScale()` divides by
`spacingMm = (layer.stoneSize || 0) + (layer.gap || 0)`. The calibration evidence is expressed in
height-to-**stone-diameter** ratio: `f-ladder.mjs:87` builds every rung as
`heightMm = ratio * stoneSizeMm`, and `calibration-key.json` stores that `ratio` alongside
`stoneSizeId`. Because gap is user-editable, the constant's meaning in the evidence's own unit
drifts with a field that has nothing to do with legibility — 6.0 stone diameters at gap 0, higher at
any positive gap. A readability constant whose effective threshold moves when the user edits gap is
wrong independently of what its value should be.

**The default sits below the evidence.** `defaultProject()` (`app.js:938`) and `addText()`
(`app.js:4345`) both create text at `height: 25`, `stoneSize: 2.8`. `heightMode` is a labelling
concept only — the toggle at `app.js:4059` flips `l.heightMode` and never `l.height`, so `l.height`
is the engine height in both modes and is directly comparable to the calibration's `heightMm`. Every
new text layer therefore starts at a height-to-stone ratio below the lowest band the frozen tables
report. In that region the frozen tables show `.session1.modeRatio[outline].bands["<20"]` at n 4 /
sellable 0 and `.session1.modeRatio[fill].bands["<20"]` at n 5 / sellable 0 — the two modes the
product still offers after READ-006A.

Auto-fit does not introduce this exposure. It extends it downward.

## 2. Why the obvious fix is not yet safe

Raising the constant does not make text smaller. `computeAutoFitScale()` returns
`Math.min(1, Math.max(fitScale, minScale))`, so once the floor binds, shrinking stops and the text
runs past `maxWidth` instead. Raising the floor therefore converts "shrinks too far" into "overflows
the canvas" for some population of saved projects, and changes rendered output for every project
relying on auto-fit. That is not a change to make on a number whose evidence has not been checked
for confounding.

And there is reason to think it is confounded. The calibration's four blocks were not sampled
uniformly over ratio. Three of them are ratio-gated in `calibration-renders.mjs`:
`interior-fill-positives` at `ratio > 18.3` (line 234), `non-script-outline` at `ratio >= 18`
(line 251), and `joined-scripts` at `ratio >= 24 && ratio <= 32` (line 246). Only
`f-heldout-validation` — selected on `separationRatio` band, half above and half below the
threshold, with no ratio constraint — can supply rows at the bottom of the range. If the sub-20
population turns out to be enriched for merged, crowded renders relative to the rest of the set,
then "nothing below ratio 20 was sellable" is partly or wholly a statement about crowding, not about
height. Crowding is precisely what READ-006's "Separate letters" now addresses, which would mean the
floor has already shipped under a different name.

`READ-005A-CalibrationFindings.md` §4.2 records the thinness of the bottom of the range but does not
test this enrichment. No key path in `derived-tables.json` crosses ratio with separation band, with
selection block, or with the post-READ-006A mode population.

This milestone builds those tables. It requires no new renders and no new rating session.

## 3. Terminology

`calibration-key.json` records engine mode names. The product's `#textMode` values differ. Outline
is engine `outline` / product `stroke`; Grid Fill is engine `fill`. Throughout this document
**"offered modes"** means engine `outline` and engine `fill` — the two READ-006A left in
`#textMode`. Staggered, radial and contour remain in the data and in every existing table; they are
excluded only from the new scopes that ask what the product now ships.

## 4. Required output

All new keys go under `.session1` in `derived-tables.json`, and every new table also appears as a
section in the markdown report the tool prints, matching the existing convention. Every banded table
must be built through the existing `bandTable()` / `assertBandSum()` helpers so that a row landing in
no band throws rather than vanishing. Every cell is emitted even when `n` is 0, with `sellablePct`
null in that case, matching `.session1.scriptFaceBands.bands["<22"]`.

Ratio bands reuse `MODE_BANDS` (`<20`, `20–25`, `25–30`, `30+`) so the new tables line up with
`.session1.modeRatio`.

**4.1 `session1.ratioBySeparation`** — the confound test. Separation band is read from the
`separationBand` field already stored on every `calibration-key.json` row; it is not recomputed. Two
scopes, each a full 3 × 4 cross-tab of separation band (`merge`, `aligned`, `fragmented`) against
ratio band, each cell `{ n, sellable, sellablePct }`:

- `allModes` — all 135 session-1 rows
- `offeredModes` — engine `outline` and engine `fill` only

Emit the population of each scope, and the count of rows carrying no `separationBand` value.

**4.2 `session1.blockByRatioBand`** — selection provenance. For each ratio band, the count of rows
from each of the five `block` values. All cells emitted including zeros. This puts the sampling
design into the frozen file so no future reader has to rediscover it from
`calibration-renders.mjs`.

**4.3 `session1.floorCandidates`** — the decision table. For each candidate floor in
`[10, 15, 18, 20, 22, 25]`, expressed in height-to-stone ratio, and for each of three scopes:

- `allModes`
- `offeredModes`
- `offeredModesExcludingMerge` — offered modes with `separationBand !== 'merge'`

emit `{ rowsBelow, sellableBelow, rowsAtOrAbove, sellableAtOrAbove }`. Both operands of every ratio,
never a percentage alone. Assert `rowsBelow + rowsAtOrAbove` equals the scope population.

`sellableBelow` is the cost of the floor — sellable work it would forbid — and is the number the
product milestone will be judged on. `offeredModesExcludingMerge` is the cut with the suspected
confound removed and is the decisive scope.

**4.4 `session1.nonScriptCut`** — reproducibility check on READ-005A §4.2. That section reports a
non-script population and a ratio-20 cut over it, but `analyze-ratings.mjs` has no font-level script
classification; its only script handling is `block === 'joined-scripts'`. Define non-script as
membership in `NON_SCRIPT_FONTS`, exported from `calibration-renders.mjs` rather than copied, and
emit: the resulting population, the same four counts as 4.3 at threshold 20, and — separately — the
number of distinct fonts appearing in `calibration-key.json` that are in neither `NON_SCRIPT_FONTS`
nor `JOINED_SCRIPT_FONTS`. If that last count is non-zero, say so plainly in the report; a font in
neither set is silently absent from both cuts and is exactly the kind of dropped singleton this
programme has been bitten by.

## 5. Constraints

**Additive only.** Regenerating the golden file must not change a single pre-existing value.
`tools/test-read-005-derived-tables.mjs` asserts deep equality against the golden file, so it will
pass after regeneration regardless of what changed — it cannot detect a silent revision. Before
running `--write`, copy the current `derived-tables.json` to `tools/scratch/`, and after writing,
run a scratch script that walks every leaf path of the copy and compares it to the new file. Report
two numbers: leaf paths compared, and leaf paths whose value differs. The second must be zero. Do
not delete the scratch copy before reporting.

**No product code.** `git diff --stat` on the finished branch must list only
`tools/font-certification/analyze-ratings.mjs`, `tools/font-certification/calibration-renders.mjs`
(export only), `docs/data/read-005/derived-tables.json`, and this specification. Any other path is a
scope error to report, not to resolve.

**No new inputs.** `.meta.inputs` stays at the same four files. Nothing is read from `f-ladder.json`,
from render PNGs, or from anything not already tracked.

**READ-005A is not edited.** Its findings stand. Where this milestone's tables bear on §4.2 or §4.6,
the finding is recorded here, not by revising a frozen findings document.

## 6. Acceptances

Each states a measurement to emit, not a value to hit.

1. `node tools/font-certification/analyze-ratings.mjs` exits 0 and its markdown report contains the
   four new sections.
2. `node tools/font-certification/analyze-ratings.mjs --write` regenerates the golden file, and the
   scratch subset check reports the two counts from §5, the second being zero.
3. `node tools/test-read-005-derived-tables.mjs`, run directly, passes.
4. Every new banded table is built through `assertBandSum()`; report the declared population of each
   new table alongside the summed cell counts.
5. `session1.ratioBySeparation` reports the count of rows with no `separationBand`.
6. `session1.nonScriptCut` reports the count of fonts in neither script set.
7. `git status` is clean and `git diff --stat` lists only the four paths in §5.

## 7. What follows, and what does not

The product milestone — re-expressing the auto-fit floor in stone diameters, setting its value,
adding a live ratio hint on the existing `stoneSizeCrowdingHint` /
`updateTextFontCapabilityUI()` path, and revisiting the 25 mm / 2.8 mm default pairing — gets its
own specification once these numbers exist. It is not authorised by this document. Its shape depends
on what §4.3's `offeredModesExcludingMerge` scope shows: a floor that survives the confound is a
different milestone from a floor that turns out to have been a separation floor all along.

Explicitly not in scope here: any re-rating session, any new renders, session 2, per-font floors
(135 rows over 28 fonts at a single stone size cannot support them), and the READ-000 §3 Layer 3
per-font-per-mode baked-floors design, which this programme should now consider superseded.

---

## 8. Result

`analyze-ratings.mjs` computes the four tables; `derived-tables.json` was regenerated additively
(440 pre-existing leaf paths compared, 0 changed). The full tables are in the markdown report the
tool prints; the load-bearing numbers:

**The sampling confound is real.** Of the 19 session-1 rows below ratio 20, 16 are `merge`
(§4.1, `allModes`). The `<20` ratio band is drawn entirely from `f-heldout-validation` (13), the
18.3–20 edge of `interior-fill-positives` (4), and `repeats` (2); `joined-scripts` and
`non-script-outline` contribute nothing below 20 (§4.2). The bottom of the range is exactly as
ratio-gated as §2 feared.

**It does not survive conditioning.** The sub-20 result — no sellable render below ratio 20 — holds
*within the merge band alone* (§4.1: `merge` `<20` is 0/16 in `allModes`, 0/8 in `offeredModes`,
against 12/40 and 10/25 at or above 20) and *within the offered modes alone* (§4.1 collapse:
offered-mode `<20` summed across separation bands is 0/9, against 39/64 at or above 20). Each
conditioning independently preserves it, so the zero is not merely an artefact of merge rows piling
up at low ratio.

**`offeredModesExcludingMerge` cannot measure the bottom of the range.** It holds 0 rows below
ratio 18 and 1 below ratio 20 (§4.3) — that scope's "0/1" at floor 20 is one row, not a rate. Its
first informative cut is floor 22 (2 sellable of 5 below) and floor 25 (11 of 14); every non-merge
offered-mode render between ratio 22 and 25 in the set is sellable (9/9). Removing the confound
removes the ability to *locate* a merge-free floor between ratio 18 and 22, where the calibration
set is nearly empty — it does not show the floor to be spurious.

**READ-005A §4.2 reproducibility (§4.4).** Non-script population under `NON_SCRIPT_FONTS` is 70,
with 0/10 sellable below ratio 20 and 31/60 at or above. Eight fonts in `calibration-key.json` are
in neither `NON_SCRIPT_FONTS` nor `JOINED_SCRIPT_FONTS` — `caveat-regular`,
`kaushan-script-regular`, `lobster-regular`, `lobster-two-bold`, `pacifico-regular`,
`sacramento-regular`, `satisfy-regular`, `yellowtail-regular` — and are silently absent from both
the non-script and joined-script cuts. Recorded here per §5, not by editing the frozen findings
document.

**For the product milestone.** A ratio-20 lower bound is supported and is not just a restatement of
crowding. The evidence does not fix the exact floor for merge-free offered modes between ratio 18
and 22; the product milestone should treat ~20 as a supported floor and choose the final value
against the `sellableBelow` cost in §4.3 (`offeredModes`: 0 at floor 20, 2 at 22, 12 at 25). The §7
framing stands but its two branches resolve toward "survives the confound".
