# READ-011E — The READ-011D selection rule could not return Form A

**Status:** implemented. Branch `feature/read-011e-preregistration-record` off `develop`. Ships no
floor change. The READ-011 ratings are landed; this document records what they showed and why the
READ-011D pre-registered procedure did not resolve to a floor.

**Authorises:** this record, `tools/test-read-011e-reachability.mjs`, its registration in
`tools/test-groups.mjs`, one new row in `docs/BACKLOG.md`, and one status line in
`docs/specifications/READ-011D-AnalysisPreRegistration.md`.

**Does not authorise:** any floor change; any edit to READ-011D §§1–11; any change to `app.js`,
`src/geometry/TextAutoFit.js`, `MIN_HEIGHT_TO_STONE_RATIO`, `src/geometry/StemRegime.js`,
`docs/data/read-011/render-plan.json`, `docs/data/read-011/render-key.json`, or anything under
`docs/data/read-005/`.

---

## 1. What this milestone is

READ-011D §11 permits a change to the protected items — `MIN_HEIGHT_TO_STONE_RATIO`,
`TextAutoFit.js`, the estimand, the cut grids, the clearance rule, the ±0.25 tolerance, the
duplicate rule, the null branch — only through a **new milestone that records what was already seen
at the time the change was made**. The ratings have now been seen: `docs/data/read-011/ratings.csv`
holds all 147 outcomes and `docs/data/read-011/derived-tables.json` is regenerated against them.

This document is that record. It does not re-fit anything, move a threshold, or widen a tolerance.
It ships no floor: `MIN_HEIGHT_TO_STONE_RATIO` stays at **16**, warn-only, exactly as READ-011A
through READ-011D left it. What it adds is the finding that READ-011D §6 — the rule that was
supposed to choose between the two floor forms — was **unsatisfiable by construction**, together
with a reachability test that would have caught it from the blank sheet, and a standing process
rule so the next manipulation ships that check before rating begins.

## 2. What session 3 returned

Every figure here is read from the regenerated `docs/data/read-011/derived-tables.json` or the
analyzer's own session-3 markdown (`node tools/font-certification/analyze-ratings.mjs`). None is
carried across from a plan or re-parsed from `ratings.csv`.

- **Overall sellable rate: 45 / 147 (30.6%).** `sellable` marginal `{ no: 102, yes: 45 }`.
- **Readable marginal: `{ yes: 109, struggle: 25, no: 13 }`.** 38 of 147 specimens were not
  cleanly readable; only 13 were unreadable outright.
- **Form A's clearing cut in `outline|untracked` is 1.0 stones-across-stem.** At that cut the
  at-or-above rate is 12 / 19 (63.2%) against a below-cut rate of 3 / 21 (14.3%) — clears the
  60% bar, the 20-point margin, and the 12-row minimum. It is the smallest cut that clears (0.6 →
  41.2%, 0.8 → 53.8%).
- **Form A's best fill cell never clears.** The highest at-or-above sellable rate anywhere in fill
  is `fill|untracked` at cut 1.4: 7 / 14 (50.0%) at-or-above against 1 / 41 (2.4%) below — ten
  points short of the 60% bar, and no other fill cut in `[0.6, 2.0]` does better.
- **Form B's two near-misses are both in `massed|outline|untracked`:** cut 16 at 8 / 14 (57.1%)
  and cut 17.5 at 7 / 12 (58.3%). Both sit just under the 60% clearance bar. Cut 19 reaches 60%
  (6 / 10) but fails the 12-row minimum.
- **Mode × achieved-tracking pooled sellable rates** (`session3.trackingContrast`, between-font):
  `outline|tracked` 14 / 23 (60.9%), `outline|untracked` 15 / 40 (37.5%), `fill|tracked` 0 / 8
  (0%), `fill|untracked` 8 / 55 (14.5%).
- **Self-consistency over the 20 duplicate groups** (all fully rated): 18 / 20 agree on
  `readable`, 17 / 20 on `sellable`, 15 / 20 on both. READ-005 session 1's comparison figure is
  13 / 15 sellable self-consistency (`meta.comparisonFigure`).
- **Size invariance is flat and near the floor.** Sellable counts are ss10 1 / 6, ss16 0 / 6,
  ss20 1 / 6, every side fully rated. The ratio did not become more or less sellable as the stone
  grew; nothing here argues the floor should be a millimetre height rather than a ratio, and
  nothing argues it should differ by stone size — but n is 6 per size.

## 3. Data-quality caveat

Of the 102 `sellable: no` rows, **35 (34.3%) carry no note at all**. READ-005 session 1's
comparable figure was 5 of 89 (5.6%) — a six-fold higher blank-note rate here. A further **3**
notes matched no cause tag (`session3.rejectionCauses.noTagMatch`).

`session3.rejectionCauses` still computes, but its tagged population is thin (67 of 102 rows) and
skewed by the blank-note rate, so **no conclusion in this document leans on it**. Adding notes to
the rated sheet now, after the outcomes are known, would be post-hoc reconstruction and is
forbidden — the sheet is the evidence and stays as rated.

## 4. Defect 1 — §6's ±0.25 tolerance was unsatisfiable by construction

READ-011D §6 chooses between the two floor forms like this: convert each regime's chosen Form-B
`ratio` cut to stones by multiplying it by that regime's pool-median `stemWidthRatio` —
**monoline 0.0303, transitional 0.05535, massed 0.09255**, a 3.05× spread — and if the three
converted values lie within **±0.25 stones** of one another, adopt Form A; otherwise adopt Form B.

The Form-B cut grid is `[16, 17.5, 19, 20.5, 22]` — **the same grid for all three regimes**, and it
spans only 1.375×. Bringing the monoline and massed converted cuts within 0.25 stones of each
other would require the monoline `ratio` cut to sit roughly 3× above the massed cut, and the grid
cannot supply that: its largest ratio is 22 and its smallest is 16.

Over all **125** combinations of `(monoline, transitional, massed)` cuts drawn from the grid, the
**minimum achievable converted spread is 0.814 stones**, at cuts monoline 22 / transitional 16 /
massed 16 → converted 0.667 / 0.886 / 1.481 stones. Restricted to cuts that can actually reach the
12-row minimum in the `outline|untracked` scopes (§5), the minimum spread is **0.996 stones**, at
cuts 16 / 16 / 16 → 0.485 / 0.886 / 1.481.

Stated plainly: **under any ratings whatsoever, §6 resolves to "Otherwise Form B is adopted."**
Form A was never reachable through the selection rule. This was true from the commit that merged
READ-011D and does not depend on a single rating. `tools/test-read-011e-reachability.mjs` proves
it from `meta` and `session3.floorByRatio` alone.

## 5. Defect 2 — Form B was power-capped below the interesting range

`rowsAtOrAbove` is rating-independent, and on a fully rated sheet `ratedAtOrAbove` equals
`rowsAtOrAbove` on the primary rows, so the counts below are exact, not estimates. The following
table — **generated by `tools/test-read-011e-reachability.mjs`** — lists, per Form-B scope, the
candidate cuts whose at-or-above population reaches the 12-row clearance minimum:

| scope | candidate cuts that can reach 12 rows |
| --- | --- |
| `monoline\|outline\|untracked` | 16 |
| `transitional\|outline\|untracked` | 16, 17.5 |
| `massed\|outline\|untracked` | 16, 17.5 |
| `monoline\|fill\|untracked` | 16, 17.5, 19 |
| `transitional\|fill\|untracked` | 16, 17.5 |
| `massed\|fill\|untracked` | 16, 17.5, 19 |
| all six tracked scopes | none |

The clearance rule (§7) takes the **smallest** cleared candidate. In `monoline|outline|untracked`
only cut 16 can ever clear — every higher rung is below the row minimum before a specimen is
rated — so the best result Form B could have returned in outline is **monoline = 16**, the value
`MIN_HEIGHT_TO_STONE_RATIO` already holds. Rung 19 held only 10 rows in `massed|outline|untracked`.
Every tracked scope is empty: achieved tracking never populated a scope densely enough to fit a
per-regime cut.

## 6. Defect 3 — the ratio grid could not express the constant-N hypothesis outside transitional

A constant floor of **N = 1.0 stone across the stem** corresponds to `ratio = 1 / stemWidthRatio`:
**33.0 in monoline, 18.1 in transitional, 10.8 in massed**. Only transitional's boundary falls
inside the tested `16–22` band. The render plan therefore straddled the constant-N boundary in
exactly one regime, and placed monoline wholly below it (a stem never reaches one stone across at
any tested rung) and massed wholly above it (a stem always clears one stone across). That is what
produces the observed "regime behaves as a level, not a slope": the manipulation could only see a
slope where its grid crossed the boundary, and it crossed it in one regime out of three.

## 7. Held-out predictions, scored

The READ-011 manipulation was built to test the constant-N stroke-reading model of READ-011A
§§1–3. Scoring its predictions against session 3:

- **#6 (a floor near ratio 16–19 in outline): close.** Form B's outline near-misses land at
  ratio 16–17.5 in massed and cut 16 in monoline; Form A's outline clear sits at 1.0
  stones-across-stem. All in the neighbourhood, none clean.
- **#3 (mode matters — outline and fill floor differently): holds, on six renders a side.**
  Fill never clears 60% at any cut in either form; outline does. The contrast is one-directional
  and consistent across the grid.
- **#2 (achieved letter spacing lifts sellability): supported in outline.** `outline|tracked`
  60.9% against `outline|untracked` 37.5%. Fill is too sparse to read (`fill|tracked` 0 / 8).
- **#1 (a constant N across the stem — the same stones-across-stem floor in every regime): fails.**
  §6 explains why the design could not have shown it cleanly: transitional was the only regime
  whose grid crossed the constant-N boundary, and transitional showed no slope. Record this as
  **evidence against the constant-N model in the one place the design could test it**, not as a
  neutral miss.

## 8. Disposition

**No floor.** `MIN_HEIGHT_TO_STONE_RATIO` stays at **16**, warn-only.

This is **not** READ-011D §8's null branch. §8 ships no floor only when *neither form clears* —
and Form A did clear, at 1.0 stones-across-stem in `outline|untracked` (§2). The route to "no
floor" here is different: §6, the rule that was supposed to license adopting Form A's result, could
**never fire** (§4). Adopting Form A's number now — after seeing that Form B was capped and Form A
happened to clear — would be fitting the conclusion to the ratings, which READ-011D §11 forbids.

Form A's `outline|untracked` clearance (cut 1.0 stones-across-stem, 12 / 19 at-or-above) is
recorded here as a **measurement only**. It must not be cited as a floor, a provisional floor, or a
default by any later milestone.

## 9. Also load-bearing against Form A

Form A never clears in fill at any cut in `[0.6, 2.0]` (§2). READ-011D §7 picks the floor from
"whichever of the two modes clears at the higher cut" — a rule that is conservative **by intent**:
it selects the cut that protects both modes. When fill clears nowhere in the grid, the faithful
reading is that **fill's requirement exceeds the grid**, not that outline's cut stands in for it.
An outline-only clearance is not a both-mode floor.

## 10. Recommended successor manipulation — not pre-registered here

Sample on the **stones-across-stem axis directly** (READ-011A §1's variable, `R × stemWidthRatio`),
with a **per-regime ratio grid derived from each regime's `stemWidthRatio`** so that every regime
straddles the same set of candidate N values — the thing this design's single shared ratio grid
could not do (§4, §6). That is a different manipulation, not a re-fit of this one.

Its design, its cut grid, and its clearance rule belong to its own pre-registration milestone and
are deliberately **not** written here. READ-011E records only that the axis should change and why.

## 11. Standing process rule

**A pre-registration must ship a reachability dry-run against the committed render key before
rating begins.** For every branch of every selection rule: can it fire at all? For every candidate
cut in every scope: can it reach the row minimum? Both defects in this document were computable
from the blank sheet at the READ-011D commit — no outcome data was needed for either.
`tools/test-read-011e-reachability.mjs` is the worked example: it derives every quantity from
`meta` and `session3.floorByRatio` and asserts the reachability facts, and assertions 2–5 read only
population and manifest values, so they would have passed or failed identically on the blank sheet.

## 12. Out of scope

READ-003's `textStrokeNarrowerThanOneStone()` aggregation and `docs/BACKLOG.md`'s READ-010
warn-only-floor row are untouched by this milestone. So is every protected item in the
**Does not authorise** list above.
