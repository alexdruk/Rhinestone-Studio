# READ-005 — Recognition sweep, signal F, and baked readability floors

Status: **proposed, not implemented.** Layer 2 of the readability program
(`docs/specifications/READ-000-readability-architecture.md` §3), consuming the harness READ-004
built (`docs/specifications/READ-004-RecognitionHarness.md`). READ-006 then consumes this
milestone's baked floors in the live UI, superseding FONT-LIB-004's font-blind height rule.

Where READ-004 and this document disagree, READ-004 is the more accurate account of the harness as
built; where either disagrees with the code, the code wins. Everything in §2 below was measured
against `develop` at `5fb897f`, not recalled.

---

## 1. What changed since READ-000 §3 was written

Four findings from the post-READ-001/002 human re-rating, plus three defects found by reading the
harness source, change this milestone's shape.

### 1.1 Signal E is the dominant term, not a margin

Of the twelve re-rated ground-truth cases, **eight are readable and two are sellable**. READ-000 §3
models signal B as the primary floor with an E-calibrated margin multiplied on top. It is the other
way round: readability barely discriminates and quality does nearly all of the separating.

This is not a regression from READ-001/002. Three outline rows previously labelled "good", on
geometry those milestones never touched, came back readable-but-not-sellable — the original single
verdict meant "readable" and the quality axis had never been measured. It also reframes READ-000
§1.5's 10-of-11 vision-versus-human agreement: that result shows the oracle reproduces human
*readability* judgement and says nothing about quality.

**Consequence.** A single scalar quality margin cannot be calibrated from this data, because the
readable→sellable gap varies by font at identical mode and identical ratio: at ratio 21.3,
`poppins-regular`/outline sells and `great-vibes-regular`/outline does not. READ-000 §3's
combination-rule step 3 is therefore replaced (§4 below).

### 1.2 Outline is not the safe mode

`anton-regular` fill and `anton-regular` outline at the same 36.52 mm height and the same SS6 stone
— ratio 18.26 for both, only the mode differs — split: the fill sells, the outline does not.
READ-000 treats outline as the safe baseline (it is the only mode the old certification pipeline
ever tested, and the stroke-width impossibility argument in `src/text/StrokeWidthGate.js` is scoped
to exclude it). At identical geometry it loses. Anton is heavy and condensed, so outlining puts two
bead lines close together and adjacent letters collide, while a solid stem reads as a letterform.

**Consequence.** READ-005 must not assume mode difficulty is ordered outline-easiest, and outline —
which has no signal A protection at all — is the mode most in need of a derived floor.

### 1.3 Signal B is structurally blind to crowding

Four of the six free-text complaints are letter-to-letter spacing. Signal B renders glyphs in
isolation, deliberately, to strip the language prior out of whole-word recognition, so it is
structurally blind to the leading stated reason a design does not sell.

**This is not fixed by changing signal B.** Isolating the glyphs is the correct decision for B and
it stays. The gap is closed by adding a word-level geometric signal (§3) that cannot be
contaminated by a language prior because it never looks at pixels.

### 1.4 The interior-fill calibration set is one image wide

`anton-regular` fill at 36.52 mm / SS6 is the only sellable interior-fill example in existence. The
interior bracket runs from 15.0 (not sellable) to 18.3 (sellable). No quality bar for
fill/staggered/radial/contour can be calibrated from one positive example. §5 builds the set.

### 1.5 Three harness defects READ-005 inherits

**D-1 — the default Production Font cannot be probed, and fails as a signal-A rejection.**
`analyzeOne()` (`tools/font-certification/lib/productionAnalysis.mjs`) calls
`engine.generateTextLayout()` without ever passing `providerId`. `app.js` does pass it
(`buildTextLayoutBaseParams()`, `resolveFontProviderId()`). Authored rhinestone fonts therefore
resolve to the registry's default OpenType provider and throw:

```
rs-block   outline  stones=0  err=OpenTypeProvider could not load font file for "rs-block" (rhinestone:rs-block)
rs-modern  fill     stones=0  err=OpenTypeProvider could not load font file for "rs-modern" (rhinestone:rs-modern)
anton      outline  stones=25 err=-
```

READ-004 §9.2 calls this "unmeasurable". In the sweep path it is worse: `runProbe()`'s signal A
part 2 turns `m.error` into a reason, sets `signalA.passed = false`, and the cell records as
**physically impossible**. `rs-block` is the default Production Font. Left alone, READ-005 would
bake "unsupported at every combination" for it.

**D-2 — bracket seeding from existing certification data is empty.** READ-004 §9.4's second economy
assumes `rhinestoneValidated` / `unsupportedStoneSizes` bracket the outline search. In the real
manifest only **4 of 32** fonts carry `rhinestoneValidated: true` (`anton-regular`,
`baloo2-variable-regular`, `sacramento-regular`, `dancing-script-regular`) and only 3 carry a
non-empty `unsupportedStoneSizes`, all `ss30`. The economy is withdrawn; it is not in this
milestone's cost model.

**D-3 — one browser launch per sheet, and resumption re-renders everything.**
`runRecognitionCase()` calls `screenshotPages()` once per sheet, and each call starts a static
server and a persistent Chromium context. Separately, `sheetPngSha256` is part of the cache key, so
a resumed run must re-render every sheet before it can discover it already holds the record.

---

## 2. Measurements taken during scoping

Made against a fresh clone of `develop` at `5fb897f` with the real pipeline. Reproducible from
`tools/scratch/` scripts regenerated by READ-005a.

### 2.1 Global stone crowding does not separate sellable from non-sellable — withdrawn

`measureStoneCrowding()` (`src/geometry/StoneLayout.js`) over `"Vitalina"` at each ground-truth
case, sorted by `fractionBelowHalfGap`:

| sell | ratio | mode | stones | minRimGapMm | medianRimGapMm | fractionBelowHalfGap | case |
|---|---:|---|---:|---:|---:|---:|---|
| no | 17.1 | outline | 208 | 0.000 | 0.245 | 0.240 | dancing-script |
| **YES** | 19.4 | outline | 346 | 0.002 | 0.299 | 0.173 | courier-prime |
| no | 21.4 | contour | 822 | 0.006 | 0.286 | 0.165 | anton curved |
| no | 14.3 | contour | 249 | 0.004 | 0.300 | 0.149 | lilita-one |
| no | 18.3 | outline | 327 | 0.004 | 0.295 | 0.122 | anton outline |
| no | 21.3 | outline | 288 | 0.003 | 0.289 | 0.094 | great-vibes |
| no | 15.0 | contour | 215 | 0.035 | 0.298 | 0.047 | lobster |
| **YES** | 21.3 | outline | 347 | 0.007 | 0.287 | 0.046 | poppins |
| **YES** | 18.3 | fill | 447 | 0.300 | 0.300 | 0.000 | anton fill |
| no | 14.0 | radial | 70 | 0.300 | 0.300 | 0.000 | cinzel |
| no | 13.8 | fill | 71 | 0.300 | 0.300 | 0.000 | caveat |
| no | 14.5 | radial | 238 | 0.300 | 0.300 | 0.000 | lilita-one radial |

Courier sells at 0.173 while Great Vibes fails at 0.094 — no threshold separates the classes. The
metric is global, so it is dominated by *intra-stroke* artifacts (outline's double bead line;
contour and radial's `stoneSizeMm` dedupe floor from READ-001/002), and those are evidently
tolerable. Every fill and radial case reads exactly 0.300 because those modes place at exact pitch.

`STONE_SIZE_CROWDING_FRACTION_THRESHOLD` / `measureStoneCrowding()` remain correct for the Stone
Size picker's own purpose in `app.js`. They are simply not the readability signal, and READ-005
does not use them.

### 2.2 Letter-to-letter separation does separate — the basis for signal F

Stones union-found at `1.6 × pitchMm` (the threshold `productionAnalysis.countClusters()` already
uses, surfaced as `clusterCount` on every `analyzeOne()` result), against the glyph-component count
of the same text's outline. `"Vitalina"` has 10 outline components in every non-script face here.

| sell | ratio | mode | stones | clusters @1.6·pitch | case |
|---|---:|---|---:|---:|---|
| **YES** | 18.3 | fill | 447 | **8** | anton fill |
| **YES** | 21.3 | outline | 347 | **10** | poppins |
| **YES** | 19.4 | outline | 346 | **11** | courier-prime |
| no | 21.3 | outline | 288 | 1 | great-vibes |
| no | 17.1 | outline | 208 | 2 | dancing-script |
| no | 18.3 | outline | 327 | 2 | anton outline |
| no | 21.4 | contour | 822 | 2 | anton curved |
| no | 14.3 | contour | 249 | 4 | lilita-one contour |
| no | 14.5 | radial | 238 | 4 | lilita-one radial |
| no | 15.0 | contour | 215 | 5 | lobster |
| no | 14.0 | radial | 70 | 28 | cinzel — **signal A fail** |
| no | 13.8 | fill | 71 | 10 | caveat — **signal A fail** |

Over the ten cases that pass signal A the separation is clean and wide: every sellable case is
≥ 8, every non-sellable case is ≤ 5. The two cases that land on the wrong side are exactly the two
signal A already rejects.

Two properties make this worth building on rather than treating as coincidence:

- It reproduces the **Anton fill-vs-outline reversal** (§1.2) — the only controlled pair in the
  dataset — from geometry alone, with no oracle. Fill 8 and sells; outline 2 and does not.
- It is mechanistically what the raters wrote down: "letters too close", four of six free-text
  notes.

**It is in-sample.** n = 10, one text string, and the threshold was chosen after seeing these
labels. §5 and §6 are the guard.

### 2.3 Separation against ratio — the ladder, and why bisection is wrong

`"Vitalina"`, SS6, clusters at `1.6 × pitch`:

| font / mode | r=10 | 12.5 | 15 | 18.26 | 21 | 24 | 28 | 32 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| anton-regular / outline | 1 | 1 | 1 | 2 | 3 | 3 | 5 | 6 |
| anton-regular / fill | 3 | 4 | 5 | 8 | 8 | 10 | 10 | 10 |
| poppins-regular / outline | 2 | 3 | 4 | 8 | 10 | 12 | 11 | 12 |
| courier-prime-regular / outline | 6 | 8 | 8 | 8 | 10 | 10 | 10 | 15 |
| great-vibes-regular / outline | 1 | 1 | 2 | 1 | 2 | 1 | 3 | 2 |
| dancing-script-regular / outline | 1 | 3 | 2 | 3 | 4 | 5 | 4 | 4 |
| lilita-one-regular / contour | 4 | 2 | 1 | 1 | 3 | 3 | 4 | 7 |
| lobster-regular / contour | 3 | 3 | 2 | 1 | 1 | 1 | 1 | 1 |

Three consequences:

1. **A per-(font, mode) ratio floor is the right storage shape.** The signal is broadly monotone for
   the faces that work — poppins 2→12, anton fill 3→10, courier 6→15. READ-000's storage decision
   survives.
2. **The signal is not monotone for the faces that do not work.** great-vibes, lilita-one/contour
   and lobster/contour all oscillate. **A binary search on a non-monotone signal returns a number
   correct for the two points it happened to probe and wrong everywhere else.** READ-004 §9.4's
   `~5 search steps` bisection is replaced by a full ladder with an explicit per-cell monotonicity
   check (§4.2).
3. **Some cells never clear at any achievable ratio.** anton/outline reaches only 6 at ratio 32;
   lobster/contour is pinned at 1 from ratio 18 upward; great-vibes never exceeds 3. For those the
   honest output is `unsupported`, not a floor.

---

## 3. Signal F — glyph separation

A fifth signal, deterministic, free, and measured on **whole words** — the level at which crowding
exists and signal B cannot see (§1.3).

### 3.1 Definition

For a layout of text `T` at `(fontId, mode, heightMm, stoneSizeId, gapMm, curve)`:

```
pitchMm         = stoneSizeMm + gapMm
clusterCount    = |union-find over stones, edge when centre distance <= 1.6 * pitchMm|
componentCount  = |groupPolygonsIntoComponents(resolveTextPolygons(T, fontId, heightMm, curve))|
separationRatio = clusterCount / componentCount
```

`clusterCount` is already computed and returned by `analyzeOne()`; no new geometry is introduced.
`groupPolygonsIntoComponents()` is READ-002's even-odd-nesting component splitter, exported from
`src/geometry/index.js`.

Signal F **passes** when `separationRatio >= F_SEPARATION_THRESHOLD`.

`F_SEPARATION_THRESHOLD` is **provisionally 0.65** — the midpoint of the observed gap, sellable
cases at 0.80/1.00/1.10 against non-sellable A-passing cases at 0.10–0.50. **The committed value is
set in Step 4 from the held-out block (§6), not from the twelve cases that suggested it.**

### 3.2 The denominator is the font's own outline component count (fixed denominator)

The alternative considered and rejected was a per-font *asymptotic* denominator — the cluster count
the font reaches at very high ratio, so each face is judged against its own best case. That
formulation would have passed `great-vibes-regular` at ratio 21.3 (2 clusters against an asymptote
of ~2–3), against the human rating.

The fixed denominator is the product decision: **a design whose adjacent letters merge into one
stone blob is not sellable, even when the font is a joined script by design.** The product sells
personal names that a stranger has to read. Signed off by the product owner. Its consequence — that
roughly eleven script faces get very high or unreachable floors — is exactly what the 20
joined-script renders in §5 exist to confirm or overturn with more than two labels.

### 3.3 F detects merging, not fragmentation

`separationRatio` can exceed 1 (courier-prime/outline reaches 15 clusters against 10 components at
ratio 32). That is a glyph breaking into more stone islands than its outline has components — a
plausible defect in the opposite direction, and one the top of the ladder is the most likely place
to produce.

READ-005 **gates only on the merge direction.** Fragmentation is recorded as a raw number in every
probe record and is carried into the human block (§5) so it can be judged, but it does not set a
floor in this milestone. Promoting it would be fitting a second threshold on zero labels.

### 3.4 Promoting a geometric metric to a verdict — the exception, and the guard

READ-000 §3 makes signal D "cross-check, never a verdict", on the evidence (§1.3, §1.4) that three
label-free geometric metrics were tried and all failed, and that objective geometry once
contradicted human raters and lost. Signal F breaks that rule and the departure is deliberate.

The argument for the exception: those three metrics were predicting **readability**, where they
lost to the vision oracle. F predicts **crowding/quality** — a different target, which §1.3
establishes the oracle structurally cannot see.

The guard, agreed with the product owner, is §6 Step 4: **F does not gate anything until it clears
the held-out validation block.** If it does not clear, F is recorded as a number and the milestone
returns for redesign rather than routing around the result.

---

## 4. The sweep

### 4.1 Cell universe

| | count | |
|---|---:|---|
| manifest fonts | 32 | |
| enabled | 31 | `roboto-mono-regular` is a 14-byte stub, disabled |
| carrying `stemWidthRatio` | 29 | plus `rs-block` / `rs-modern`, authored |
| **swept cells** | **140** | 28 fonts × 5 modes |

`montserrat-regular` is **excluded**. Its `stemWidthRatio` of 0.0145 is the lowest in the library by
a wide margin because the bundled `Montserrat-Regular.ttf` is Montserrat **Thin**
(`usWeightClass = 100`) shipped under a Regular id (`docs/BACKLOG.md`). A hairline-Thin measurement
must never be mistaken for Montserrat Regular's behaviour, and the fix is a render-changing font
file migration in its own milestone.

`rs-block` and `rs-modern` get D-1 fixed so they stop producing false signal-A rejections, but are
**scoped out of the ratio sweep**: their stone positions are hand-authored, they carry no
`stemWidthRatio`, and height-to-stone ratio is not obviously the governing axis for them. They are
recorded as `floorPolicy: "authored"` and handled in their own milestone.

### 4.2 The ladder, replacing bisection

Each cell is evaluated on a **fixed ratio ladder**, not bisected (§2.3 point 2).

- **Range is per-font and seeded at the signal-A boundary**, per READ-004 §9.2.1: 360 of 620
  triples in READ-004's invariance measurement were skipped because `stemWidthRatio × ratio < 1`,
  and every script face is skipped at every tested ratio. Their interior-mode floors are governed by
  signal A at `1 / stemWidthRatio` — 28.0 for `great-vibes-regular`, 25.1 for `cinzel-regular`,
  22.6 for `caveat-regular`, against 8.2 for `anton-regular` and 7.4 for `lilita-one-regular`. A
  fixed `[6, 30]` bracket would spend most of its steps below the A-floor for every script face.
- **Ladder start** = `max(6, ceil(A-floor))` for interior modes, `6` for outline (which has no A
  protection at all).
- **Ladder step size** is set by the oracle variance study (§6 Step 3): a step finer than the
  measured verdict-flip band near the floor is not measuring anything.
- **Monotonicity is checked and recorded per cell**, not assumed. Cells whose signal-F ladder is
  non-monotone are flagged in the baked output and their floor is the **highest** ratio below which
  any failure occurs, not the lowest passing ratio.
- **Cells that never pass** anywhere on the ladder are recorded `unsupported`, with the ladder
  attached, not given an extrapolated floor.

### 4.3 Combination rule

Replacing READ-000 §3's steps 2–3:

```
floor(font, mode) = max( A-floor, B-floor, F-floor )
```

with **no global quality-margin multiplier** (§1.1: it cannot be calibrated, and it would be a
single constant standing in for a gap that varies by font at matched mode and ratio).

Unchanged from READ-000 §3: any signal A failure is unsupported, deterministic and final; signal C
runs at the candidate floor as confirmation and a **B-fail + C-pass remains a red flag, not a
pass**; and where signals disagree sharply the cell is emitted for human review rather than trusting
either. That last clause now has something concrete to compare — F against B — instead of D against
B alone.

### 4.4 Stone-size invariance

READ-004 §9.3 leaves open whether one floor per `(font, mode)` is safe, since `PRODUCTION_GAP_MM` is
absolute and pitch/diameter runs 1.150 at SS6 to 1.047 at SS30. Its answer: run the search at both
SS6 and SS30 for four A-clearing cells and compare the resulting floors.

READ-005 does that with **twelve** cells rather than four (cost is no longer the constraint), one
outline and eleven interior-fill, chosen to span READ-004's measured chamfer drift — including
`courier-prime`/outline, `lilita-one`/fill, `abril-fatface`/radial and `pacifico`/staggered, the
four READ-004 nominates.

Additionally, because signal F is free, **the F ladder runs at all five stone sizes for all 140
cells**. That gives a far denser invariance picture than twelve oracle-backed cells alone, at zero
oracle cost. If the F floors agree across stone sizes but the B floors do not, that disagreement is
itself the finding.

### 4.5 Curvature

A **conservative margin applied to curved layers, stated explicitly** — not a sweep dimension.

Curved text is represented by exactly one ground-truth row, on real design-plane geometry (round
dinner plate rim band, mid-radius 116.25 mm, derived undistorted sweep ≈ 87.93°; READ-004 §8.1), and
it is the worst readability in the set at the highest ratio in the set. Adding curvature as a sweep
dimension multiplies 140 cells by however many sweep angles are chosen, on evidence of n = 1. The
margin's value is recorded with its justification and revisited when there is more than one curved
data point.

---

## 5. The human calibration set

**135 plain renders**, plus the existing 12 ratings. `--render plain` already produces exactly this
kind of image and already bypasses signal A (`analyzeOne()` directly, never `runProbe()`), so the
A-failing images — the ones that most need looking at — still render. The only new code is a
case-list argument; the CLI currently hardcodes `--cases ground-truth`.

| block | renders | purpose |
|---|---:|---|
| interior-fill positives, ratios above 18.3 | 40 | §1.4 — the sellable interior bracket is one image wide |
| F held-out validation | 40 | half F predicts sellable, half not, spread across all five modes |
| joined scripts, ratios 24–32 | 20 | §3.2 — two labels is thin support for effectively removing eleven faces |
| non-script outline, ratio ≥ 18 | 20 | §1.2 — outline has no signal A protection and only six ratings |
| **repeats** | 15 | duplicates of earlier cases, reshuffled — measures rater self-consistency |

**Two questions, kept apart: can you read it, and would you sell it.** Keeping them separate is what
made the original result legible. Free text is retained; it was the most useful column in the
original table.

**Rating is blind.** Filenames are opaque slugs; the ratio, mode, font and F's prediction are not
visible to the rater, and the key is held separately until rating is complete. F is being validated
*against* the rater — a render labelled `predicted-fail` would make that validation worthless. The
15 repeats are not identified.

**Two texts, not one**, so floors are not fitted to a single string's letter pairs:

- `"Vitalina"` — continuity with the twelve existing ratings.
- `"Emmanuel"` — `mm` and `nu` are the canonical crowding stressors and both already appear in
  `STRESS_STRINGS`.

The free F ladder runs over a much wider name set, since it costs nothing; only the rated set is
held to two.

---

## 6. Delivery

### Step 1 — READ-005a, deterministic groundwork (no oracle, no network)

- Thread `providerId` through `analyzeOne()` and `runProductionAnalysis()` so authored fonts stop
  producing false signal-A rejections (D-1). Every existing call site keeps byte-identical
  behaviour.
- Batch `screenshotPages()` to one browser context per run instead of one per sheet (D-3).
- Add a resume index keyed on the deterministic inputs only — everything in the READ-004 cache key
  except `sheetPngSha256` — so a resumed run skips rendering, plus a `--verify-render` mode that
  re-renders and checks the PNG hash against the record. The full cache key is still computed and
  stored on first write; the audit property is unchanged.
- Implement signal F (§3) and record it alongside signal D in every probe record.
- Run the dense free F+A ladder over all 140 cells × 5 stone sizes.
- Generate the 135 calibration renders with opaque slugs and a separately held key.

Bump `HARNESS_VERSION` (probe, sheet builder, scorer and geometry are all touched).

### Step 2 — human rating

135 images, two questions and a note each.

### Step 3 — READ-005b, oracle variance

The **first real invocation** of `createPinnedOracle()`, on its own and under review. `PINNED_MODEL_ID`
is re-pinned to the dated snapshot current at that point and recorded in every probe record's
`modelId`. An API key is supplied at run time; neither the key nor the PNGs are committed. Raw
readings are kept verbatim.

Six sheets — three near a candidate floor, three clearly above it — each run **20 times**. Reported:
per-tile reading flip rate, aggregate-CER standard deviation, and the rate at which the **pass/fail
verdict** flips. That last number sets the ladder step size (§4.2) and the CER threshold's noise
floor.

### Step 4 — F validation

Analysis against the Step 2 ratings, plus the rater self-consistency number from the 15 repeats.
`F_SEPARATION_THRESHOLD` is committed here. **If F does not clear the held-out block it does not
gate** (§3.4); the milestone returns for redesign.

### Step 5 — READ-005c, the sweep

Resumable batch, runnable per-font across sessions, which is what `probeRecordStore` exists for.

### Step 6 — bake floors, write results into this document, merge

Then READ-006 consumes them, superseding FONT-LIB-004's rule.

---

## 7. Cost

| stage | oracle calls |
|---|---:|
| F + A ladder, 140 cells × 5 stone sizes, dense steps | **0** (CPU only) |
| oracle variance study, 6 sheets × 20 repeats | 120 |
| independent full-ladder audit, 15 cells (§8) | 360 |
| `search` confirmation, 5 ratios per cell | 1,400 |
| `full` at candidate floor **and one ladder step below** | 1,680 |
| `words` at candidate floor | 140 |
| stone-size invariance, 12 cells at SS6 and SS30 | 120 |
| **total** | **≈ 3,820** |

Against READ-004 §9.4's 2,635 and READ-000's original 78. The increase over READ-004 buys two
things it did not have: an oracle ladder that can *disagree* with signal F (§8), and observation of
signal B actually failing below each floor rather than only passing at it.

---

## 8. The audit that matters most

If the oracle only ever runs near the ratio signal F nominates, F can be systematically wrong and
the sweep will never discover it. That is the failure mode this program has hit repeatedly and the
one the kickoff brief names: **a floor that is correct for what it was measured on and wrong for
what it gets applied to.** Every READ-004 defect was of this class — a rule reaching one level too
far or not far enough, with the arithmetic honest throughout.

So: **15 cells run the complete oracle ladder, blind to F**, chosen to span mode, weight class and F
behaviour, and including at least two cells F says never separate. The B-floor a full independent
ladder finds is compared against the B-floor the F-localised probe finds on the same cell. Agreement
validates F-localisation as a search economy for the remaining 125 cells; disagreement is caught
here rather than in the baked numbers.

### Acceptance measurements

Stated as exact measurements, not criteria — per the READ-004 lesson that an aggregate has somewhere
to hide and a named maximum does not.

1. **Component-count table.** `componentCount` for all 29 fonts × 2 texts, printed in full, with the
   count of entries differing from a hand-checked value. *Scoping found `cinzel-regular` returning 45
   components for `"Vitalina"` where every other face returns 10 — this is unexplained and must be
   resolved before F is trusted; it is the single most likely place for a silent denominator defect.*
2. **Provider fix.** `analyzeOne()` output for `rs-block` and `rs-modern` at one cell each, showing
   non-zero `stoneCount` and `error: null`; plus the diff of the READ-004 regression fixture
   (`fixtures/read-004-part-a-analyze-one.json`), which must be empty.
3. **F ladder monotonicity.** The count of cells whose F ladder is non-monotone, and the full ladder
   printed for the three worst.
4. **F against B.** For the 15 audit cells: the signed difference between the independent B-floor and
   the F-localised B-floor, per cell, and the maximum absolute difference with the cell it occurs on.
5. **Oracle variance.** Verdict-flip rate per sheet across 20 repeats, and the maximum over the six
   sheets with the sheet named.
6. **Rater consistency.** Read-verdict and sell-verdict agreement rate across the 15 repeat pairs.
7. **Stone-size invariance.** Maximum absolute floor difference between SS6 and SS30 over the 12
   cells, with the cell it occurs on, for B; and over all 140 cells for F.

---

## 9. Carried forward, not re-derived

Findings that were expensive to obtain. READ-005 does not contradict or re-litigate these.

- The certification pipeline only ever tested outline mode; `analyzeOne()` hardcoded
  `mode: 'outline'` until READ-004 threaded it. Every pre-READ-004 rating and every
  `unsupportedStoneSizes` entry describes outline at ratio 12.5 and nothing else.
- Readability is governed by mode and by the height-to-stone-diameter ratio, not by font choice
  alone — but font does matter: `great-vibes` and `poppins` are both at ratio 21.3 with opposite
  sell verdicts.
- The "stone wider than the stroke" impossibility argument applies **only** to interior-filling
  modes (`src/text/StrokeWidthGate.js`). Outline has no signal A protection at all.
- Three label-free geometric metrics were tried and all failed: shape fidelity, stones-across-stroke,
  topology. See §3.4 for why signal F is a deliberate exception rather than a fourth attempt.
- Whole-phrase recognition is contaminated by language priors; this product sells personal names, so
  context-free legibility is the correct standard for signal B.
- Contour fill is a chamfer distance field plus marching-squares iso-contours, not polygon offsets.
  The dedupe floor for contour and radial is `stoneSizeMm`, not pitch. Contour and radial designs
  gained roughly 30–40% more stones in READ-001/002, and both human contour complaints are now "too
  many stones" — the first human evidence against that trade. Backlog item, not a regression, and
  **not** something READ-005 changes.
- Radial's ring radii were never wrong (max deviation 1.155e-14 mm). The real defect was
  per-whole-placement anchoring, fixed per connected component. There is no discretisation defect in
  radial to go looking for.
