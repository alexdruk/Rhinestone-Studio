# READ-011D — Rating-analysis pre-registration

**Status:** implemented, then executed. Branch `feature/read-011d-analysis-preregistration` off `develop`. The procedure below was run against the landed READ-011 ratings and returned no floor: §6's selection rule could never adopt Form A, and Form B was power-capped at the value `MIN_HEIGHT_TO_STONE_RATIO` already holds. Superseded in effect by `docs/specifications/READ-011E-PreRegistrationDefect.md`; the pre-registered text below is unchanged as evidence.

**Authorises:** this record, a new `computeSession3()` in
`tools/font-certification/analyze-ratings.mjs`, the new golden file
`docs/data/read-011/derived-tables.json`, and `tools/test-read-011d-session3.mjs`.

**Does not authorise:** any change to `app.js`, `src/geometry/TextAutoFit.js`,
`MIN_HEIGHT_TO_STONE_RATIO`, `src/geometry/StemRegime.js`, `docs/data/read-011/render-plan.json`,
`docs/data/read-011/render-key.json`, or anything under `docs/data/read-005/`. The floor change
itself is a separate milestone gated on this one.

---

## 1. Why this is written before rating

READ-011B fixed what got rendered and READ-011C resolved the spacing and froze the presentation
order. `docs/data/read-011/ratings.csv` now exists as a blind sheet: 147 rows, one per rated
specimen, and every `readable` and `sellable` cell is empty at the commit that merges this
document.

The purpose of this milestone is to fix the rule that turns those ratings into a floor **while the
outcome column is still blank**, so the rule cannot be fitted to the ratings after the fact. The
commit that merges this spec is the pre-registration; git history is its evidence. Everything
`computeSession3()` needs to decide between the two candidate floor forms — the cut grids, the
scoping, the clearance thresholds, the tie-break tolerance, the duplicate rule, the definition of
"tracked", and the null branch — is written here, and `docs/data/read-011/derived-tables.json` is
generated against the blank sheet so the diff that fills it in later touches only the outcome
numbers.

## 2. What the design supports

Each fact below is stated with its derivation from `docs/data/read-011/render-key.json`.

**The finest crossing holds two renders.** The main grid crosses stem regime (3) × mode (2) ×
ratio rung (5) × tracking target (2) = 60 cells, two fonts per cell (READ-011B §2). Every
`(stemRegime, mode, ratio, trackingTarget)` cell therefore contains exactly two renders. Cell-level
sellable rates are uninformative at n = 2; every floor estimate in §6 is a **cut applied to a
pooled population**, following the `session1.floorCandidates` pattern from READ-007.

**Tracking is unpaired.** Of the 108 distinct `fontId × mode × ratio` combinations in the main
grid, 12 carry both tracking targets; once the fixed text is also matched, 8 do. There is no
render that differs from another *only* in tracking on an otherwise identical spec. A McNemar-style
paired test as used in READ-005 session 2 is therefore unavailable here; tracking can only be read
as a **between-font contrast**.

**Separation mostly resolved to zero spacing.** 33 of the 67 `trackingTarget: "separation"` entries
resolved to `letterSpacingMm` 0 (the solver reached the 0.95 separation ratio with no added
spacing) — 26 of 36 in fill against 7 of 31 in outline. The renders that *do* carry achieved
spacing number 34, of which 24 are outline and 10 fill. Any pooled tracking term is estimated
mostly from outline renders.

**Twenty duplicate-spec groups.** Grouping the 147 rated entries on
`(fontId, mode, ratio, stoneSizeId, text, letterSpacingMm)` gives 20 groups with more than one
member: 19 pairs and one triple. Fourteen are the intended `main`/`repeats` pairs from READ-011B
§4.3; five are `main`/`main` collisions where a `none` render and a `separation` render for the
same cell both resolved to 0 mm and so share the tuple; the triple holds both kinds. Six cells
(the five collisions plus the triple) therefore carry a `none`/`separation` tracking contrast that
has **no contrast left in it** once the images are recognised as identical.

**Five separation entries fell short of the target.** Five entries did not reach
`separationRatioAfter ≥ 0.95`: `lobster-two-bold` twice (0.1 → 0.9, 0.3 → 0.9), `sacramento-regular`
(0.3 → 0.8), `pt-serif-regular` (0.6 → 0.8), and `courier-prime-regular` (0.8 → 0.8, at 0 mm). All
five are outline mode.

**Row index is the time axis.** The rating sheet is written in strictly increasing
`presentationIndex` order (the 12 excluded probe entries keep their slots; the sheet skips them,
it does not renumber). Row index therefore serves as the within-session time axis, and sitting
boundaries may be recorded later as row ranges without altering the sheet.

## 3. The analysis set

No row is excluded on geometric grounds. Excluding renders because the tracking solver missed its
0.95 target — or because a font's stem is unusually thin, or because the rung landed below a stone
size's validated range — would select on a property plausibly correlated with the outcome, and
would let the exclusion rule quietly do the work the floor is supposed to do. The five
`separationAchieved: false` entries stay in.

The only handling is structural. Within each of the 20 duplicate groups, the member with the
lowest `presentationIndex` enters the primary tables; the remaining members feed self-consistency
(§5) only. This is the rule the render-key's own `duplicateOf` field already implements, and
`computeSession3()` cross-checks its computed non-primary set against that field. Twenty-one rows
leave the primary tables this way, so the **primary population is 147 − 21 = 126 rows**.

Rows with a blank `sellable` are listed under `session3.unratedRows`, mirroring
`session2.unratedRows` in READ-005B. They **remain in `rowsBelow` / `rowsAtOrAbove`** as
population — those counts still sum to the scope population — but they are excluded from every rate
through the separate `ratedBelow` / `ratedAtOrAbove` counts (§7, §9), so population and rate
denominator are never confused. At the pre-registration commit every row is unrated; the count
falls as the sheet is filled in.

## 4. Achieved tracking, not intended tracking

The rater judges a rendered image, so the causal factor is the spacing **actually applied**, not
the spacing that was asked for. `tracked` is defined as `letterSpacingMm > 0`. `trackingTarget`
is intent; it is emitted only as a sensitivity table (`session3.trackingContrastByIntent`).

At the rated level 34 renders carry achieved spacing — 24 outline, 10 fill. Three of those 34 are
the higher-`presentationIndex` members of tracked `main`/`repeats` pairs, and they leave the
primary tables under §3. Within the 126-row primary population the arms are therefore **31 tracked
and 95 untracked** (`achievedTracking.tracked` / `.untracked`); by mode, 23 / 40 in outline and
8 / 55 in fill. `courier-prime-regular`'s failed separation entry (0.8 → 0.8 at 0 mm achieved
spacing) has `letterSpacingMm` 0 and joins the untracked arm automatically. `session3` also emits
the rated-level split (`achievedTracking.ratedLevel`) so the 34 / 24 / 10 figures above remain
checkable.

## 5. Self-consistency

Span and agreement are both computed over all 20 duplicate groups, not only the 15 seeded repeats:
the five accidental collisions are equally valid re-presentations of one image to the rater. Each
group in `session3.duplicateGroups.groups` carries its `presentationSpan` (index distance), its
`sheetSpan` (distance in rated-row positions), an `allMembersRated` flag, and whether its members
agree on `readable`, on `sellable`, and on both.

**Agreement denominator.** A group counts toward agreement only when every member has a non-blank
`sellable` (`allMembersRated`); a blank cell never counts as agreement. `session3.selfConsistency`
emits `n` (all 20 groups) and `fullyRatedGroups` (the agreement denominator) as separate fields, so
a partially-rated sheet reads unambiguously. At the pre-registration commit `fullyRatedGroups` is
0 and all three agreement counts are 0.

**Under-15 spans.** A group is flagged `spansUnderMinPositions` when its `sheetSpan` is below 15 —
READ-005's design separation for hidden repeats (READ-005A §3). The flag is evaluated on all 20
groups; `session3.selfConsistency.groupsUnderMinPositions` lists every group that trips it, and the
`seededRepeatsUnderMinPositions` subset lists only the seeded repeats among them. Three groups are
under 15:

- `courier-prime-regular` outline 17.5 spans **2** sheet positions. It is byte-identical (the
  solver reached separation at 0 mm), and it is simultaneously one of the six degenerate tracking
  cells (§2) — a `none` and a `separation` render that collapsed to the same image. It is therefore
  both a near-certain recognition *and* a contrast with no contrast in it, and it contributes
  weakly on both counts.
- `cookie-regular` fill 19 spans **12**, likewise a byte-identical `none`/`separation` collision
  and a degenerate tracking cell.
- `poppins-semibold` fill 22 (`Emmanuel`) spans **7**. This is the one **seeded** repeat under 15,
  short of READ-005's ≥ 15-position design separation; it is not a degenerate cell.

The flag is the mechanism — it is emitted so the by-hand analysis can down-weight these groups.
§7's clearance rule does not change.

READ-005 session 1 measured 13/15 sellable self-consistency; that is the comparison figure
(`meta.comparisonFigure`).

## 6. The two candidate forms and the rule that chooses between them

**Form A — a single constant.** `floor = N / stemWidthRatio`, where the cut is expressed in the
variable `stonesAcrossStem = ratio × stemWidthRatio` (the number of stone diameters spanning a
shrunk stem — READ-011A §1). Candidate cuts `[0.6, 0.8, 1.0, 1.2, 1.4, 1.6, 1.8, 2.0]`. Scoped by
mode × achieved tracking. Uses every rated primary row and estimates one parameter.
`session3.floorByStones`.

**Form B — three class steps.** Cut variable `ratio`, candidates `[16, 17.5, 19, 20.5, 22]` (the
five rung values). Scoped by stem regime × mode × achieved tracking. `session3.floorByRatio`.

**Selection rule, fixed here.** Convert each regime's chosen Form-B `ratio` cut into stones by
multiplying it by that regime's pool-median `stemWidthRatio`, recorded in
`meta.regimeMedianStemWidthRatio`. The **regime pool** is the set of fonts appearing in the rated
set for that regime (`session3.meta.regimePools`); the median is taken over each pool font's
`stemWidthRatio` in `assets/fonts/manifest.json`. That set currently equals the manifest's
enabled-and-measured pool for all three regimes — 7 / 10 / 12 fonts — and the analyzer asserts
each rated entry's carried `stemWidthRatio` against the manifest value, so the two cannot silently
diverge:

| regime | pool size | pool-median `stemWidthRatio` |
| --- | --: | --- |
| monoline | 7 | 0.0303 |
| transitional | 10 | 0.05535 |
| massed | 12 | 0.09255 |

If the three converted values lie within **±0.25 stones** of one another, Form A is adopted and
the regimes are recorded as having served only as sampling strata. Otherwise Form B is adopted.
The tolerance is 0.25 and does not move (`meta.selectionToleranceStones`).

## 7. Clearance

A candidate cut is **cleared** when, reading the rated counts:

- the sellable rate at or above the cut, `sellableAtOrAbove / ratedAtOrAbove`, is ≥ 60%,
- that rate is at least 20 percentage points above the below-cut rate
  `sellableBelow / ratedBelow`, and
- `ratedAtOrAbove` is at least 12.

The chosen floor is the smallest cleared candidate, read at **achieved tracking = untracked** (the
condition the product produces by default — `letterSpacingMm` has no UI control) and at whichever
of the two modes clears at the higher cut.

`computeSession3()` emits both operands of every rate — `sellableBelow` / `ratedBelow` /
`rowsBelow` and `sellableAtOrAbove` / `ratedAtOrAbove` / `rowsAtOrAbove` per candidate per scope,
with the assertions that `rowsBelow + rowsAtOrAbove` equals the scope population and
`ratedBelow + ratedAtOrAbove` equals the scope's rated count (`scope.rated`) — and **never applies
the clearance rule itself**. `rows*` is population (unrated rows included); `rated*` is the rate
denominator; the clearance rule reads only `rated*` and `sellable*`. §7 is applied by hand to the
emitted tables, exactly as READ-007 did. The thresholds are recorded as data in
`meta.clearanceRule`.

## 8. The null branch

If no candidate clears in either form at the untracked level, this program ships no floor change:
`MIN_HEIGHT_TO_STONE_RATIO` stays at 16, warn-only, and the recorded conclusion is that the
16–22 band is not separable under this manipulation. The next step is then a **different
manipulation** — text length, stone size, or a rater panel — and explicitly not a re-fit, a moved
threshold, or a widened tolerance.

## 9. Emitted tables

`computeSession3()` returns `{ meta, session3 }`. `session3` carries:

`rowCount` · `unratedRows` · `marginals` · `duplicateGroups` · `selfConsistency` ·
`degenerateTrackingCells` · `achievedTracking` · `floorByStones` · `floorByRatio` ·
`sizeInvariance` · `trackingContrast` · `trackingContrastByIntent` · `separationShortfall` ·
`rejectionCauses`.

`floorByStones` and `floorByRatio` extend the `session1.floorCandidates` shape —
`{ candidates, scopes: { … : { population, rated, byCandidate } } }`. Each `byCandidate` entry
carries `sellableBelow` / `ratedBelow` / `rowsBelow` and `sellableAtOrAbove` / `ratedAtOrAbove` /
`rowsAtOrAbove`: `rows*` is population with unrated rows included (and `rowsBelow + rowsAtOrAbove`
sums to `population`), `rated*` is the rate denominator (and `ratedBelow + ratedAtOrAbove` sums to
`rated`), and the two are never conflated. Session 1's own two call sites stay on the default and
emit only the `rows*` / `sellable*` fields, so `docs/data/read-005/derived-tables.json` is
untouched.

`selfConsistency` emits `n` (all groups), `fullyRatedGroups` (the agreement denominator), the
three agreement counts, `seededRepeatsUnderMinPositions`, and `groupsUnderMinPositions` (all 20
groups, each with `key`, `primarySlug`, `sheetSpan`, `kind`, and `isDegenerateTrackingCell`).

`sizeInvariance` pairs each SS16 / SS20 render with its SS10 counterpart at the same `fontId`,
`mode` and `ratio` and reports the counts on both sides. `trackingContrast` is the between-font
pooled rate by mode × achieved tracking; `trackingContrastByIntent` is the same table keyed by
`trackingTarget`.

`meta` records milestone `READ-011D`, `generatedBy`, `inputs`
(`docs/data/read-011/ratings.csv`, `docs/data/read-011/render-key.json`,
`assets/fonts/manifest.json`), `causeTags`, the duplicate-key fields, the achieved-tracking
definition, the regime pools and their medians, the two cut grids, the clearance constants, and the
±0.25 selection tolerance.

## 10. Non-drift on READ-005

`docs/data/read-005/derived-tables.json` is frozen and must remain byte-identical. `computeAll()`'s
returned shape does not change; session 3 is a separate function reading separate inputs and
writing a separate golden. The shared `floorCut` / `buildFloorScope` helpers were lifted to module
scope so both sessions use one implementation, and `tools/test-read-005-derived-tables.mjs` plus
`tools/test-read-011d-session3.mjs` both assert `computeAll()` still deep-equals the READ-005
golden.

## 11. What may change after ratings land

Mechanical handling only: CSV parse edge cases, unrated-row accounting, and note-tag
classification failures. The estimand, the two cut grids, the 60 / 20 / 12 clearance rule, the
±0.25 tolerance, the achieved-tracking definition, the duplicate rule, and the null branch may
**not** change. Altering any of them requires a new milestone that records what was already seen
at the time the change was made.
