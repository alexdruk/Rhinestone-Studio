# READ-005A — Calibration findings from 208 blind human ratings

Status: **findings of record.** Supersedes `docs/specifications/READ-005-SweepAndFloors.md` §1.2,
§3.2, §3.4, §4.2, §4.3 and §7. That document is kept unrewritten per this repo's convention of
preserving superseded findings (cf. `RS-3001-drawing-board-integration.md`).

Measured against `develop` at `6358727`. Where this document and the code disagree, the code wins.

Every quantity in §2, §3, §4.3, §4.5 and §4.6 is recomputed from `docs/data/read-005/` by
`tools/font-certification/analyze-ratings.mjs` and frozen in `docs/data/read-005/derived-tables.json`,
which `tools/test-read-005-derived-tables.mjs` asserts on every run. Where this document and that
file disagree, the file wins and this document is stale.

## 1. What READ-005a built

- `tools/font-certification/lib/glyphSeparation.mjs` — signal F's denominator.
  `overlapComponentCount(polygons)` groups contours by geometric overlap (bbox reject → vertex-inside
  either direction → edge crossing, exact O(n²)). `expectedComponentCount(engine, fontId, text,
  providerId)` sums the per-character isolated count, returns `null` for authored fonts, memoized.
- `tools/font-certification/f-ladder.mjs` — the free F+A ladder. 140 cells (28 fonts × 5 modes),
  dense ss10 ladder at 0.5 steps, coarse ladder at 5 stone sizes, checkpointed and resumable.
  Records `separationBand`, `plateauRatio`, `floorRatio`, `lowestPassingRatio`, `monotone`.
- `calibration-renders.mjs` and `tracking-renders.mjs` — the two blind render sets.
- `make-rating-page.mjs` — a local blind rating page (one image at a time, Q/W/E and A/S shortcuts,
  local-storage autosave, CSV export).
- Harness fixes: `providerId` threaded through `analyzeOne`/`runProbe`/`runProductionAnalysis` and
  added to the cache key; screenshots batched to one browser context per run; a resume index keyed on
  the deterministic inputs with `--verify-render`; `letterSpacingMm` forwarded by `analyzeOne()`.
  `HARNESS_VERSION` is `read-005.1`.

## 2. Session 1 — 135 blind renders, rated

Marginals: readable 117 yes / 15 struggle / 3 no. Sellable 46 yes / 89 no.

Rater self-consistency from 15 hidden repeats: readable 14/15, sellable 13/15, both 12/15. So ~13% is
the noise floor on the sell axis; no signal can be judged better than ~87%.

Rejection causes over the 89 `sell=no` rows. All 46 sellable rows carried no note; notes were used
only to record failure. The classifier is **multi-label** — 10 rows name more than one cause — so the
counts below do not sum to 89 and the shares do not sum to 100%. Five of the 89 rows carry no note at
all; no note failed to match a tag.

| cause | n | share of 89 |
|---|---:|---:|
| inaccurate letterforms | 44 | 49.4% |
| letters too close | 25 | 28.1% |
| too many stones | 12 | 13.5% |
| ugly | 9 | 10.1% |
| extra stones | 4 | 4.5% |

The classifier is a keyword matcher over free text and is typo-tolerant by design ("too amny stones",
"inaccuarte"). It is deliberately coarse: "not equal spacing between letters" is filed under "letters
too close" although it is an evenness complaint rather than a crowding one, and a clause like "'a'
difficult to read" attached to a crowding note contributes nothing. The exact rules and the tag set
assigned to every distinct note string are in `analyze-ratings.mjs` and its markdown report.

Letters named in the notes: V (8), a (7), t (3), i (2), and one mention each of e, l, n and u.

## 3. Session 2 — the tracking experiment, 75 paired renders

`letterSpacingMm` exists in `GeometryEngine` (`penXMm += options.letterSpacingMm`), appears zero times
in `app.js`, and has no UI control. Every design in the product's history has been at zero tracking.

Paired design: each crowding-rejected case rendered twice — at zero tracking and at the lowest
tracking reaching `separationRatio >= 0.95` — with pair members ≥15 positions apart, plus a
specificity block (cases rejected as "inaccurate", tracked) and a harm block (already-sellable cases,
tracked).

Two of the 24 control renders were never rated (`3a742b32`, parisienne-regular outline; `31bd0784`,
cookie-regular outline), so their pairs are not evaluable. The table below is over the remaining 22
pairs.

| | n |
|---|---:|
| tracked sellable, control not | 8 |
| tracked not, control sellable | 0 |
| both | 3 |
| neither | 11 |

McNemar exact two-sided p = 0.0078 (b=8, c=0). Block level: tracked 50% sellable (12/24), control
13.6% (3/22 rated; 12.5% if the two unrated rows are counted as failures).

All three controls behave:

- **Drift** — the control block (identical cases, zero tracking) came back 3 of 22 rated, 13.6%,
  against an independently measured sellable self-inconsistency of 2 of 15, 13.3%. The control block
  reproduces the rater's own noise floor to within half a point, which is as close as 22 and 15
  observations can resolve.
- **Specificity** — 0 of 11. Tracking rescued no "inaccurate" case.
- **Harm** — 9 of 9 still sellable. Tracking broke nothing.

Cost: median +25.3% width on the eight fixes (range +4.4% to +51.3%). Effect concentrated in outline
(tracked 8/12 vs control 2/12) and contour (3/6 vs 1/6); fill was 0/3 both ways and staggered 0/1.
Two of the 24 tracked renders never reached `separationRatio >= 0.95` even at the maximum tracking
tried. Residual complaint on the eleven tracked members still rejected: 7 "inaccurate", 3 still
crowded, 1 "too many stones" — tracking removed the crowding and exposed the fidelity defect
underneath.

## 4. Findings that were expensive to obtain

These cost 210 human ratings. Do not re-derive or contradict them without new data.

### 4.1 Signal E dominates; signal B barely discriminates

87% of renders are readable, 34% sellable. READ-000 models B as the primary floor with E as a margin
on top. It is the other way round.

### 4.2 Signal F is redundant with a plain ratio floor

Held-out block (n=40): F-fail → 1 sellable of 20; F-pass → 7 of 20; 65% accuracy against an 87%
ceiling. Across all non-script renders (n=70), a floor at ratio ≥ 20 rejects 10 cases (0 sellable),
F ≥ 0.65 rejects 8 (0 sellable), and F adds exactly one rejection beyond the ratio floor, which was
not sellable. F's apparent specificity came from its F-fail cases being 13/20 below ratio 20 and
14/20 script faces. **F should be recorded, not gated.**

Caveat: only 10 of 70 non-script renders sit below ratio 20, so the comparison is thin at the bottom.

### 4.3 Mode dominates everything, and three modes cannot be fixed by any floor

| mode | n | sell | <20 | 20–25 | 25–30 | 30+ |
|---|---:|---:|---:|---:|---:|---:|
| outline | 53 | 60% | 0% | 60% | 57% | 85% |
| fill | 20 | 35% | 0% | 60% | 43% | 33% |
| contour | 19 | 16% | 0% | 0% | 40% | 25% |
| radial | 20 | 10% | 0% | 13% | 17% | 0% |
| staggered | 23 | 9% | 0% | 0% | 11% | 33% |

Several cells rest on very few observations: staggered 30+ is 1 of 3, radial 20–25 is 1 of 8, contour
30+ is 1 of 4, staggered 25–30 is 1 of 9, and fill 30+ is 1 of 3. Per-band counts for every cell are
in `derived-tables.json`. The mode totals (n=53, 23, 20, 20, 19) carry the weight here; the band
percentages are indicative only.

Fill peaks at 20–25 and declines — a band, not a floor, which READ-000's monotone-in-ratio assumption
cannot express. Staggered and radial never clear ~15% at any ratio.

### 4.4 Outline is the best mode, not the worst

READ-005 §1.2 claims otherwise on the strength of one controlled Anton pair. With n=53 outline is
clearly the best mode, and READ-000's original instinct to treat it as the baseline was right.

### 4.5 Joined scripts are sellable at high ratio

8 of 20 (40%), all with `separationRatio` 0.13–0.50. Script faces by ratio band: no rows below 22,
then 0% (0 of 6) at 22–26, 42.9% (3 of 7) at 26–29, and 71.4% (5 of 7) at 29 and above. READ-005
§3.2's fixed-denominator decision would have marked eleven faces unsupported and deleted a sellable
class. Within scripts F does not discriminate at all (Great Vibes sells at sep 0.13; Cookie fails at
0.13).

### 4.6 The dominant defect gets worse with ratio and has now defeated six metrics

"Inaccurate" is the largest single rejection cause at 44 of 89, and its share of rejections **rises**
with ratio rather than staying flat. Across fill, staggered and radial it runs 44.4% / 75% / 64.7% /
87.5% of rejections over ratio bands 15–20 / 20–25 / 25–30 / 30+; folding in contour gives 36.4% /
63.6% / 65% / 72.7%. Rows below ratio 15 are excluded and reported separately.

This is stronger than the earlier claim that the defect is ratio-invariant, and it is the reason no
height floor can reach it: raising the ratio strips away the crowding and stone-count complaints and
leaves fidelity as very nearly the only defect standing.

Tried and failed: shape fidelity; stones-across-stroke; topology (READ-000 §1.3); **coverage
deficit**, which runs backwards (0.394 for inaccurate vs 0.466 for not, and staggered has the best
coverage with the worst ratings); **edge raggedness**, which is flat (0.266 vs 0.272, and contour has
the smoothest edges at 16% sellability); and **stray islands**, weak as a gate (39% vs 23%) though
`tinyClusters >= 4` is an absolute veto at 0/9 sellable and matched the four "extra stones" notes at
6.75 vs 0.85.

### 4.7 Interior modes place 100% of stones inside the glyph outline

Outline and contour place ~50% by centre test, by construction. "Extra stones" are not spillage
outside the letterform.

### 4.8 Per-character isolated component counting is the correct signal-F denominator

Whole-word nesting over-counts (Cinzel 45/58 where the answer is 8, because many faces ship glyphs as
unmerged overlapping contours); whole-word overlap grouping under-counts (every joined script
collapses). Per-character is correct on all 29 fonts × 2 texts with no per-font flag, and is
automatically case-aware. Do not substitute either alternative.

### 4.9 `analyzeOne()` silently drops options it does not name

It builds its own parameter object; `letterSpacingMm` passed to it was ignored until the READ-005
tracking work fixed it. An early tracking measurement was void for exactly this reason. When adding a
parameter, check it reaches `generateTextLayout()`.

### 4.10 The ~3,820-call oracle sweep is not worth running as specified

It locates a readability bound that 87% of cases already clear, while the axis that decides 89
rejections stays unmeasured.

## 5. Carried forward from earlier milestones

- The certification pipeline only ever tested outline mode; every pre-READ-004 rating and every
  `unsupportedStoneSizes` entry describes outline at ratio 12.5 and nothing else.
- The "stone wider than the stroke" impossibility argument applies only to interior-filling modes
  (`src/text/StrokeWidthGate.js`). Outline has no signal A protection at all.
- Contour fill is a chamfer distance field plus marching-squares iso-contours, not polygon offsets.
  The dedupe floor for contour and radial is `stoneSizeMm`, not pitch.
- Radial's ring radii were never wrong (max deviation 1.155e-14 mm); the defect was per-whole-placement
  anchoring, fixed per connected component.
- `montserrat-regular` ships as Montserrat Thin (`usWeightClass=100`) under a Regular id. Excluded
  from the sweep; in `docs/BACKLOG.md`.
- `rs-block` / `rs-modern` are authored stone-map fonts. `resolveTextPolygons()` rejects them by
  design, so signal F records `null` for them.

## 6. What `READ-005-SweepAndFloors.md` gets wrong

- §1.2 — outline is not the risky mode. Reversed; see §4.4 above.
- §3.2 — joined scripts do not fail the fixed denominator. Overturned; see §4.5.
- §3.4 and §4.3 — F as a gate in `max(A, B, F)`. Becomes record-only; see §4.2.
- §4.2's ladder and §7's cost model describe a sweep that should not run at that scale; see §4.10.
- Nothing in it mentions letter spacing, which is the only validated improvement the milestone
  produced.

§1.1 (signal E dominant, not B) stands and is confirmed at n=135.

## 7. Next steps

1. **A letter-spacing milestone.** Expose tracking in the UI, and consider auto-applying the minimum
   tracking that reaches `separationRatio >= 0.95`, bounded by the printable area. This must interact
   sanely with `autoFit` and `isTextOutsidePrintableArea()` in `app.js`: tracking trades width, autoFit
   trades height. Highest-value validated work available.
2. **The fidelity defect.** 44% of rejections, ratio-invariant, six metrics defeated, concentrated in
   staggered (18 of 23 renders) and radial. Probably a geometry problem in the interior samplers
   rather than a readability problem. One concrete reproducible case: `cinzel-regular` / radial /
   ratio 31.5 / 88.2mm / "Emmanuel", where the rater noted an extra letter appearing after "u" when
   set on two lines. Likely related to the READ-002 backlog item on `sampleRadialFieldFillPoints()`
   still using a single whole-placement anchor.
3. **A product decision on staggered and radial** (9% and 10% sellable at every ratio tested): fix the
   geometry, or stop offering them for text.

## 8. Where the data lives

`docs/data/read-005/` — the two rating CSVs, their two blind keys, and the F+A ladder, with a
checksum manifest. `tools/font-certification/output/read-005/` remains canonical for tooling and
remains gitignored; the PNG render sets are not archived. `derived-tables.json` in the same directory
holds every computed table in this document, regenerated by
`node tools/font-certification/analyze-ratings.mjs --write` and guarded by
`tools/test-read-005-derived-tables.mjs`.
