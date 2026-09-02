# READ-004 — Recognition harness (render + signals + auditable records)

Status: **implemented, local branch `feature/read-004`.** Builds Layer 2 of the readability program
(`docs/specifications/READ-000-readability-architecture.md` §3). This milestone is the **harness
only** — it does not run a sweep and it does not call a recognition model. READ-005 runs the sweep
and bakes the floors; READ-006 consumes them in the app.

---

## 1. What the harness produces

For one probe point — a `(font, mode, heightMm, stoneSizeId, gapMm, corpus)` tuple — the harness
produces one auditable JSON record. The record is deliberately split into a **deterministic half**
that any reviewer can regenerate byte-for-byte from the inputs, and **one non-deterministic value**
(the model's reading of the image) that is recorded verbatim so a later disagreement is resolved by
resampling rather than argument.

```
readabilityProbe.runProbe()      geometry  → signals A + D + layout measurements   (deterministic)
recognitionSheets.build...()     record    → contact-sheet HTML                    (deterministic)
screenshotPages()                HTML      → PNG                                   (deterministic)
recognitionOracle                PNG       → per-tile readings                     (NOT deterministic)
recognitionScoring.scoreProbe()  readings  → per-tile Levenshtein, CER, misreads   (deterministic)
probeRecordStore                 all above → keyed JSON on disk                    (deterministic)
```

Only the fourth line is not re-derivable from the record. That is the whole audit strategy
(READ-000 §5): geometry→PNG is deterministic, readings→CER→floor is deterministic, and the one gap
is pinned and its raw output is stored.

---

## 2. The four signals

| | signal | what it measures | where it lives | role |
|---|---|---|---|---|
| **A** | physical impossibility: stroke narrower than one stone, plus `collectProductionIssues()`-equivalent checks (layout error, stone collision, zero-stone non-blank text) | `src/text/StrokeWidthGate.js` (arithmetic) + `readabilityProbe.mjs` (production issues) | **hard fail, no oracle** |
| **B** | context-free recognition — 62 isolated glyphs + 15 stress strings → character error rate | `full` corpus tier | primary floor (READ-005) |
| **C** | context-realistic recognition — the 9 production-review words → word/CER | `words` corpus tier | secondary; B-fail + C-pass is a red flag, not a pass |
| **D** | geometric corroboration — `chamferDistance` on confusable pairs, per-glyph stone counts vs the `readabilityMetrics.mjs` floors | `readabilityProbe.mjs` `computeSignalD()` | cross-check, **recorded as numbers, never a verdict** |

Signal E (human rating of marginal cases) is out of scope here; it calibrates the margin in
READ-005.

### 2.1 Signal A first — the ordering is load-bearing

`runProbe()` evaluates the **pure** part of signal A — `stemWidthRatio × heightMm < stoneSizeMm` in
an interior-fill mode — *before generating any geometry at all*. If it fails, the probe returns
immediately: `signalA.passed = false`, `oracleRequired = false`, `measurements = null`, and the
caller must not build a sheet or attempt a reading.

This is what keeps the expensive recognition calls off physically-unbuildable combinations
(READ-000 §3, combination rule step 1). READ-005 is on the order of a thousand probes and ~2,600
recognition calls (§9.4); signal A eliminates whole `(font, mode)` regions — for every script face,
every interior-fill mode (§9.2.1) — with a single multiply before a single pixel is rendered.

If the pure check passes, layouts are measured for every corpus entry and the rest of signal A
(the collision / error / zero-stone checks) is evaluated over those measurements. Signal D is then
recorded. `oracleRequired` is true only when the full signal A passes.

### 2.2 Signal A now has one source of truth

`app.js`'s live READ-003 warning and this offline harness both call
`strokeNarrowerThanOneStone({ stemWidthRatio, heightMm, stoneSizeMm, mode })` from the new
`src/text/StrokeWidthGate.js` (re-exported from the `src/text/index.js` barrel). `app.js` keeps the
layer/font resolution and the user-facing label; the module owns the arithmetic, the
`INTERIOR_FILL_MODES` set, and every case that returns null. The old inline
`READ_003_INTERIOR_FILL_MODES` constant and the inline comparison in `app.js` are gone.

---

## 3. `analyzeOne()` now threads `mode`

`tools/font-certification/lib/productionAnalysis.mjs` `analyzeOne()` hardcoded `mode: 'outline'` —
the reason every rated font, every `unsupportedStoneSizes` entry, and FONT-LIB-004's whole audit
describe outline only (READ-000 §1.1). It now takes a trailing options object:

```js
analyzeOne(engine, fontId, text, stoneSizeId, heightMm,
           { mode = 'outline', gapMm = PRODUCTION_GAP_MM, curve = null } = {})
```

`mode` and `gapMm` go straight to `generateTextLayout` and are echoed in the returned record;
`curve`, when non-null, is spread verbatim (the same `curveEnabled` / `curveRadiusMm` /
`curveDirection` / `curveStartAngleDeg` / `curveSweepAngleDeg` / `curveAlignment` fields
`buildTextLayoutBaseParams()` passes). `runProductionAnalysis()` gained the same optional `mode`.

**Every pre-existing call site keeps byte-identical behaviour** — the defaults reproduce the old
hardcoded call exactly (regression-tested against a fixture captured from `develop`,
`tools/font-certification/fixtures/read-004-part-a-analyze-one.json`).

---

## 4. Sheet rules and the false-pass reasoning

`recognitionSheets.buildRecognitionSheetHtml({ probeRecord, corpus })` turns one probe record into
one or more contact sheets, reusing `specimenPages.mjs`'s stone-circle rendering
(`renderLayoutSvg`) and its per-size px/mm table unchanged.

1. **One probe per sheet.** Every sheet comes from a single probe record, i.e. one
   `(font, mode, height, stone size)`. Two probes are never composited onto one image.

2. **No character appears in two entries on a sheet — on the tiers where the unit of recognition is
   the glyph.** A recognizer that can see the same glyph rendered *legibly* elsewhere on the image
   reads a degraded copy by cross-referencing it, not by resolving the letterforms — the identical
   false-pass mechanism READ-000 §3 identifies for familiar phrases ("Happy Birthday" completed from
   a language prior rather than read). A character repeated *within one entry* (`mm`, `88`) carries
   no such advantage — both copies are equally degraded — so the rule is strictly cross-entry.

   **Which tiers get the rule.** `search` and `full` do: their task is glyph identification —
   isolated characters, and stress strings like `rn` beside `m` where the question is "is this an
   `m` or an `r``n`". `words` does **not**: there the unit of recognition is the whole word, so two
   personal names sharing an `a` is incidental — every English word shares letters with every other
   — and a single word alone on a page *with no distractors* is an easier read than one among
   several, so fragmenting the 9 words across sheets would weaken signal C rather than protect it.
   The rule is carried as a corpus-tier property (`glyphIdentificationTask`, declared per tier in
   `CORPORA` and threaded through `resolveCorpus()` into `partitionEntries()` — `search`/`full`
   true, `words` false), not as a heuristic on entry content, so a future corpus change cannot
   silently flip it and the partitioner never special-cases a tier by name.

   The partitioning is:

   - **Single-character entries** are grouped by confusability (union-find over `CONFUSABLE_PAIRS`;
     with the current corpus that is `{I,l,1} {O,0,Q} {S,5} {B,8} {G,C} {e,c,o} {6,9}`), and each
     confusable group is placed *whole* onto one sheet — a pair split across two sheets is a hard
     failure. Groups are then **assigned to balance digits in proportion to tile count**, not merely
     to be present: each sheet's digit target is `corpusDigits × sheetTiles / corpusTiles` (with
     balanced tile counts, `corpusDigits / sheetCount`), and a group is placed on the sheet that
     minimises the combined squared deviation from that digit target and from an even tile split.
     The remaining loner characters then go to whichever sheet is currently furthest below its fair
     share of that loner's class. **Every single-character sheet is asserted `|digitCount −
     digitTarget| ≤ 1`** (in the test) and to carry at least one letter and at least one digit (in
     the builder).

     An earlier version of this rule assigned confusable groups largest-onto-emptiest with **no
     class balancing** and asserted only "at least one digit". That is a formal pass, not a
     substantive one: on the `search` tier (25 % digits) it produced sheets that were 7 % and 43 %
     digits, and it put `{I,l,1}` and `{G,C}` on the *digit-poorest* sheet — so `l→1` and `I→1`, the
     two confusions that most need a digit-rich page, got the weakest digit context in the corpus.
     A single `1` beside thirteen letters weakens the letter prior; it does not remove it.

     This whole rule replaces the still-earlier **partition-by-class** rule (letters on letter
     sheets, digits on digit sheets). That rule made every sheet homogeneous, which structurally
     *removes* the alphanumeric confusables — O/0, S/5, B/8, I/1, l/1 — from measurement: a
     recognizer looking at a letters-only sheet cannot make the O→0 error because no digit is on the
     page. This product sells names and years in the same design, so those are exactly the
     confusions that matter. The class prior is a contamination of the same family as the language
     prior READ-000 §3 rejects familiar phrases for — "this page is all letters, so it can't be a
     digit" is the same kind of outside-the-glyph inference as "this phrase is *Happy Birthday*".

   - **Multi-character entries on a glyph-identification tier** (`full`'s stress strings) are packed
     greedily: each entry goes on the first sheet whose character set (whitespace ignored) is
     disjoint from it, opening a new sheet when none fits. However many sheets that produces is
     accepted. They are **exempt from digit balancing** — `partitionMultiChars` partitions on
     character disjointness and cannot also balance classes, so `full`'s sheet 4
     (`rn mm oo ee pp qq ww`, all lowercase) is homogeneous by construction. That is acceptable: the
     stress strings test `rn`-vs-`m` and doubled-letter confusions, not letter-vs-digit, and no
     digit stress string exists to pair against. `STRESS_STRINGS` (15 entries, e.g. `mm` beside
     `mnuvw`, `rn` beside `nn`) lands on **3** sheets, not 1.

   - **Multi-character entries on a non-glyph tier** (`words`) are **not** disjointness-partitioned:
     all 9 words go on **one** sheet. `assertNoAnswerLeak` still runs over that sheet unchanged — no
     answer appears as readable text — but rule 2 does not, because a legible `Emma` on the same page
     as a degraded `Ashley` gives a word recognizer nothing (the shared `a` is not the unit it is
     reading), and a distractor-free single-word page would make signal C an *easier* read.

   Single- and multi-character entries never share a sheet, so a lone `o` is never on the same
   image as `oo` or `Sophia`. Order within a sheet is deterministic (by corpus index) so the same
   corpus always produces the same sheets and the cache key keeps meaning something.

3. **Tiles are labelled with circled numerals (`①②③…`).** That alphabet is disjoint from Latin
   letters and Arabic digits under every composition, so — now that sheets are no longer
   homogeneous — the label can never spell, or even share a character with, an expected answer
   regardless of what a sheet contains. (The previous scheme — numeric labels for letter/string
   sheets, alphabetic for digit sheets — argued disjointness from sheet homogeneity, and already
   failed on the mixed string sheet where numeric labels `01`–`15` shared the image with the
   answers `88` and `69`.) `labelsForClass()` collapses to one unconditional `labelsForCount()`.
   The expected answer never appears as readable text anywhere in the HTML — not in a caption,
   comment, `title`, `alt`, `aria-*`, or `data-*`. A lone letter or digit is unavoidably present in
   SVG coordinates, hex colours, and CSS keywords, so the guarantee is "not as a label or
   human-readable string", not "not one matching byte anywhere"; the built-in leak guard rejects
   comments and `alt`/`aria`/`data-` attributes outright, checks every caption against every answer
   (unconditional, since no caption can legitimately contain a Latin/Arabic run), and does a
   full-HTML substring scan for entries ≥ 3 characters.

4. **`tileInventory` is the answer key.** `[{ index, expectedText }]` is returned *alongside* the
   HTML and lives only in the record store — never embedded in the page, and never handed to the
   oracle.

---

## 5. The oracle adapter (implemented, not invoked)

`recognitionOracle.mjs` exports:

- `PINNED_MODEL_ID` — the pinned recognition model (`claude-opus-5` at authoring time; whoever
  first runs the pinned oracle in READ-005 should re-pin the dated snapshot current then and record
  it in each probe record's `modelId`).
- `createStubOracle(readingsByTileIndex)` — deterministic, used by every test and by the CLI's
  `--oracle stub` path. Carries a mutable `invocationCount` so a test can assert the oracle was
  never called.
- `createPinnedOracle({ apiKey })` — reads `process.env.ANTHROPIC_API_KEY`, calls the pinned model
  with the sheet PNG over raw HTTPS (this repo has no Anthropic SDK dependency, by design), returns
  `{ modelId, rawReadings }` where `rawReadings[i]` is the verbatim per-tile string.

The oracle receives **the PNG and the tile count and nothing else** — never `tileInventory`. It
does no scoring and returns no verdict.

**`createPinnedOracle` is not called anywhere in READ-004** — not in the CLI, not in tests, not to
"check it works". A non-deterministic oracle is the one thing in this pipeline that cannot be
re-derived from the record, so its first real invocation happens under review (READ-005), not here.
No API key is committed.

---

## 6. Scoring

`recognitionScoring.scoreProbe({ tileInventory, rawReadings })` → per-tile Levenshtein distance,
per-tile normalised character error rate, aggregate CER (total edits / total expected characters),
and the list of misread tiles with expected and read strings. Pure: no image, no model, no I/O —
fully reproducible from the stored record.

---

## 7. Record format and the store

`probeRecordStore.mjs`. Records are JSON on disk under the gitignored
`tools/font-certification/output/read-004/probe-records/`.

**Cache key** = sha256 over the canonical (recursively key-sorted) JSON of:

```
{ fontId, mode, heightMm, stoneSizeId, gapMm, corpusName, corpusHash, sheetPngSha256, modelId,
  harnessVersion }
```

Every field feeds the key, so changing any geometry input, the corpus, the rendered pixels, or the
model is a cache **miss** rather than a silent stale hit. `sheetPngSha256` for a multi-sheet probe
is the sha256 of the per-sheet PNG hashes joined in order. `harnessVersion`
(`readabilityProbe.HARNESS_VERSION`, `read-004.5`) covers the code paths the PNG hash does not —
most importantly a change to `recognitionScoring.mjs`, which leaves the rendered sheet
byte-identical but changes `aggregateCer`; bump it whenever the probe, sheet builder, scorer, or
their geometry changes in a way that makes a stored record no longer reproducible. Reading a record
whose key already exists returns it without re-rendering — READ-005 must be resumable across
sessions and re-runnable per font.

Each stored record contains, at minimum: the cache key and every field feeding it,
the signal A verdict and reasons, the signal D numbers, the (stones-stripped) layout measurements,
and per sheet: `pngSha256`, `tileInventory`, `rawReadings` verbatim, and the scoring output. The
heavy per-stone position arrays are dropped on write — they are deterministic geometry, re-derivable
by re-running the probe.

A probe that **fails signal A** produces no sheet, no PNG, and no oracle call, so it has no
`sheetPngSha256` and is not persisted — recomputing its single-multiply verdict is free.

---

## 8. CLI

```
node tools/font-certification/readability-probe.mjs --cases ground-truth --oracle stub
node tools/font-certification/readability-probe.mjs --render plain --channel chrome
```

`--oracle stub` is the only mode exercised in this milestone. `--oracle pinned` exists in the
argument parsing and is reachable (it constructs `createPinnedOracle()`), but is not run here.
`--corpus` selects the tier (`words` default, `search`, `full`); `--only` restricts to font ids;
`--channel` passes a Playwright browser channel through `screenshotPages()` (needed as `chrome` on
macOS 13, where Playwright has no bundled-Chromium download).

`--render plain` is a **ground-truth render mode**: one PNG per ground-truth case showing the text
`"Vitalina"` at that case's font / mode / height / stone size — no tiles, no labels, no grid, just
the layout as a person would see the design. This path **bypasses signal A entirely**: it calls
`analyzeOne()` directly rather than `runProbe()`, and never touches `buildRecognitionSheetHtml()`
(which correctly throws when `measurements` is null). That is deliberate — the two cases that fail
signal A, Cinzel radial and Caveat fill, are exactly the images that need looking at. All 12 cases
render, including the curved one. `renderPlainCase()` / `runPlainRenders()` are exported for reuse.

### 8.1 Ground-truth signal-A verdicts (all 12 cases, `--oracle stub`)

| font | mode | heightMm | stone | signal A | reason |
|---|---|---|---|---|---|
| anton-regular | Grid fill | 36.52 | ss6 | **pass** | — |
| poppins-regular | outline | 42.5 | ss6 | **pass** | — |
| great-vibes-regular | outline | 42.5 | ss6 | **pass** | — |
| dancing-script-regular | outline | 34.3 | ss6 | **pass** | — |
| courier-prime-regular | outline | 77.5 | ss16 | **pass** | — |
| cinzel-regular | radial | 56 | ss16 | **fail** | stroke ~2.23mm is narrower than one 4mm stone in radial mode (stemWidthRatio 0.0398 × 56mm height) |
| caveat-regular | fill | 55 | ss16 | **fail** | stroke ~2.44mm is narrower than one 4mm stone in fill mode (stemWidthRatio 0.0443 × 55mm height) |
| lobster-regular | contour | 42 | ss10 | **pass** | — |
| lilita-one-regular | contour | 40 | ss10 | **pass** | — |
| lilita-one-regular | radial | 58 | ss16 | **pass** | — |
| anton-regular | outline | 36.52 | ss6 | **pass** | — |
| anton-regular | contour (curved) | 60 | ss10 | **pass** | — |

The two failures are exactly Cinzel radial and Caveat fill — the pair READ-003's investigation
identified as the cases the stroke gate still catches (READ-000 §1.2).

**Row 1's mode was wrong through five passes.** The row was rendered and rated during READ-004 as
`anton-regular` *Grid fill*, verdict "good" — the only interior-fill case in the ground truth rated
good — but `STRAIGHT_GROUND_TRUTH_CASES` carried it as `mode: 'outline'`, so `--render plain` had
been drawing an outline for it from the first commit through `05a8540`. The sixth pass corrects the
row to `fill`. The `anton-regular` *outline* render at the same height/stone was also produced and
rated during READ-004; rather than discard that rating, it is kept as the **twelfth case** (row 11
above), flagged in the source as not part of the original ground truth.

**The curved row uses a real design-plane product geometry (Part 7).** `curveRadiusMm` is the
**round dinner plate's rim-band mid-radius** — `src/products/definitions/plate-round-dinner.json`,
`outerDiameterMm: 270` / `innerWellDiameterMm: 195` → outer rim R **135 mm**, inner rim R **97.5 mm**,
**mid R 116.25 mm** — derived at run time exactly as `app.js`'s `rimBandCurveRadiusMm()` (`app.js:2316`)
does, via `getPlateDesignTargetGuide('rimBand', …)`. That is the *only* place the codebase itself
derives a curve radius from product geometry, and curved text on a plate rim is a real production
case. A mug's body radius (the earlier choice, 41 mm) describes the cylinder a flat decal wraps
*around* — it is not a radius in the design plane where `ArcProjection` operates, and it gave a
249° sweep with the end letters rotated ±125°.

`curveSweepAngleDeg` is *derived* so `"Vitalina"` subtends its natural, **undistorted** arc.
`ArcProjection.projectPointToArc()` computes `t = xMm / totalAdvanceWidthMm` and
`angle = sweepStart + sweep·t`, so the text is uniformly stretched onto the sweep and the radius is
independent of it; `sweep = width / radius` is therefore the sweep at which arc length equals text
width and the stretch factor is exactly 1. For the measured `"Vitalina"` width of **178.387 mm**
(`anton-regular`, `contour`, `ss10`, 60 mm) that gives **`curveSweepAngleDeg ≈ 87.93`** (end letters
tilted ~±44°). (The pre-third-pass value, `curveRadiusMm: 41` / `sweep ≈ 249.3`, calibrated
READ-005's curvature margin on near-upside-down text; the pre-second-pass value,
`curveRadiusMm: 120` / `sweep: 180`, was a 377 mm arc chosen only to satisfy
`normalizeCurveParams()`'s non-zero requirement and stretched the text 2×.) The product id, design
target (`rimBand`), both rim radii, the mid-radius, the measured width and the derived sweep are all
recorded in the probe record's `curve.derivation`. The prompt's `curveDirection: 'up'` is kept
as-authored and mapped to the arc engine's upward-bulging direction (`'outside'`; `ArcProjection.js`
only accepts `outside`/`inside`) — both values live in `curve`.

---

## 9. Part 5 — direct layout-invariance measurement

READ-000 §3 stores **one floor per `(font, mode)`** on the premise that at a matched
height-to-stone-diameter ratio the *layout* is the same up to scale across all five stone sizes.
`PRODUCTION_GAP_MM` is absolute, so pitch/diameter runs from **1.150 at SS6 to 1.047 at SS30** and
the premise holds only approximately. Measured before READ-005 commits ~2,635 recognition calls to
it.

### 9.1 What the committed Part I measured, and why it could not answer the question

The original Part I measured **total stone count**. That number cannot answer whether the layout is
scale-similar: at a matched height/diameter ratio an interior fill tiles an *area*, so its stone
count scales as `((2.3/2.0)/(6.7/6.4))² = 1.2065` **by construction**, and the reported interior-mode
residuals clustered on exactly that value. That is area scaling, not a failure of ratio invariance —
and it is equally consistent with the layout being perfectly scale-similar. The stone-count metric
answers a different question than the one it was asked. Its stated conclusion ("interior-fill floors
do not generalise, up to ~49 %") **is not supported by the data, and neither is its opposite.** It
is withdrawn.

### 9.2 The direct measurement

`tools/scratch/read-004-invariance-chamfer.mjs` (scratch, gitignored). For **every enabled manifest
font** (31) × all **5 modes** × ratios `{10, 12.5, 15, 20}` × the glyph set `['R','a','e','8','m']`:
generate the layout at SS6 and at SS30 at the matched ratio, and compute

```
chamferDistance(normalizedStonePoints(ss6.stones), normalizedStonePoints(ss30.stones))
```

— the normalisation is unit-height and centred, so this is purely "is the SS30 layout the SS6 layout
rescaled?". A `(font, mode, ratio)` triple whose `stemWidthRatio × ratio < 1` is **skipped** (signal
A rejects it; a measurement there is meaningless). `rs-block` / `rs-modern` are authored stone-map
fonts with no `stemWidthRatio` and no OpenType outline for `analyzeOne()` to sample, so their 40
triples are unmeasurable here.

| bucket | triples |
|---|---:|
| total `(font, mode, ratio)` | 620 |
| authored, unmeasurable (`rs-block`, `rs-modern`) | 40 |
| skipped (`stemWidthRatio × ratio < 1`) | 360 |
| **measured** | **220** |

### 9.2.1 The 360 skips are themselves a finding

Every script face is skipped at **every** tested ratio, because `stemWidthRatio × 20 < 1` for all of
them. That is not just an exclusion from this measurement — it means their interior-fill-mode floors
are governed by **signal A, not signal B**, and sit at `1 / stemWidthRatio`:

| font | `stemWidthRatio` | interior-fill A-floor (`1/ratio`) |
|---|---:|---:|
| great-vibes-regular | 0.0357 | **28.0** |
| cinzel-regular | 0.0398 | **25.1** |
| caveat-regular | 0.0443 | **22.6** |
| … vs anton-regular | 0.1225 | 8.2 |
| … vs lilita-one-regular | 0.1355 | 7.4 |

**Consequence for READ-005: the binary-search height range must be per-font and seeded at the
A-boundary**, not a fixed bracket. A fixed `[6, 30]` ratio search would spend most of its steps
below the A-floor for every script face (where the answer is already "unsupported") and barely reach
the top of their usable range.

Over the **1,100** measured `(triple, glyph)` points (0 errored):

> **Maximum chamfer distance = 0.1633**, at **(`abril-fatface-regular`, `radial`, ratio 12.5, glyph
> `e`)**.
>
> Measured points exceeding `NEAR_IDENTICAL_CHAMFER_THRESHOLD` (0.09): **48 / 1,100**.
> Measured triples with at least one glyph over threshold: **27 / 220**.

Per-`(font, mode)` maxima (measured triples only) are in the `feature/read-004` final report and are
regenerated by the script. The shape of the result: **outline is essentially scale-invariant**
(per-`(font, mode)` outline maxima all ≤ ~0.09, most ≤ 0.05), while the **interior-fill modes drift
more, worst in `fill`/`staggered`/`radial` on the heavy display faces** (`abril-fatface`, `lilita-one`,
`righteous`, `pacifico`, `poppins-bold`) — but the drift is a chamfer of 0.10–0.16 on a unit-height
normalisation, i.e. a *few percent of glyph height*, not a categorically different layout.

### 9.3 The invariance question is still open

Chamfer on the *geometry* is a proxy. It says the layouts are close, not that a recognizer reads
them the same. **READ-004 does not settle whether one floor per `(font, mode)` is safe.** READ-005
settles it directly: run the binary search **at both SS6 and SS30** for **four `(font, mode)` cells
that clear signal A** — one outline and three interior-fill, chosen to span the drift above (e.g.
`courier-prime`/outline, `lilita-one`/fill, `abril-fatface`/radial, `pacifico`/staggered) — and
compare the resulting floors. If they agree within the E-margin, one number per `(font, mode)`
stands; if not, READ-005 records a per-stone-size floor or a conservative margin for the
interior-fill modes and says which.

### 9.4 READ-005 cost, and why it is a resumable batch job

Corrected estimate, with the tiered corpus and the multi-sheet partition:

| tier | passes | derivation |
|---|---:|---|
| `search` | **1,550** | 31 fonts × 5 modes × ~5 search steps = 775 probes, × 2 sheets each |
| `full` | **930** | 155 `(font, mode)` cells × 6 sheets, at the candidate floor |
| `words` | **155** | 155 `(font, mode)` cells × **1 sheet** — the `words` tier is not disjointness-partitioned (§4), so all 9 words share one sheet; signal C confirmation at the candidate floor only |
| **total recognition calls** | **≈ 2,635** | against READ-000's original estimate of **78** — **~34×** |

`search`: `31 × 5 × 5 = 775`, `× 2 = 1,550`. `full`: `31 × 5 = 155` cells `× 6 = 930`. `words`:
`155 × 1 = 155`. Total `1,550 + 930 + 155 = 2,635`.

The blow-up is the price of removing the class prior (more, smaller sheets) and of the tiered
corpus. It makes READ-005 a **resumable batch job** — which is exactly what `probeRecordStore` is
for: a probe whose cache key already exists is returned without re-rendering, so the sweep survives
being run per-font across sessions.

Two economies READ-005 should use:

- **Early termination.** If a `(font, mode)` already passes signal B at the *bottom* of the search
  range, record "no floor needed in range" and stop — do not bisect.
- **Bracket seeding.** The existing outline certification data in `assets/fonts/manifest.json`
  (`rhinestoneValidated`, `unsupportedStoneSizes`) brackets the outline search — use it to seed the
  bisection bounds, **not** as an answer (it is outline-only and predates the Layer 0 geometry
  fixes).

---

## 10. Caveats

- **Montserrat.** `montserrat-regular` carries `stemWidthRatio = 0.0145` — the lowest in the
  library by a wide margin — because the bundled `Montserrat-Regular.ttf` is actually Montserrat
  **Thin** (`usWeightClass = 100`) shipped under a Regular id (`docs/BACKLOG.md`). This is a data
  bug, not a readability finding, and its fix is a render-changing font-file migration deferred to
  its own milestone. **READ-005 must either exclude `montserrat-regular` from the sweep or record
  the caveat alongside its floor**, so a hairline-Thin measurement is never mistaken for Montserrat
  Regular's real behaviour. (In Part 5's measurement all of Montserrat's triples are skipped —
  `0.0145 × 20 = 0.29 < 1` — so it contributes nothing there.)
- **Curved text** is represented by exactly one ground-truth row, on a real design-plane geometry
  (Part 7 / §8.1: round dinner plate rim band, mid-radius 116.25 mm, derived undistorted sweep
  ≈ 87.9°). Arc projection still distorts spacing at the ends; READ-005 should either add curvature
  as a sweep dimension or apply a conservative margin to curved layers and say so (READ-000 §5).
- The stub oracle's readings in `--oracle stub` runs are a deterministic stand-in for real model
  noise (a fixed `O→0`, `l→1`, `S→5`, drop-trailing-`y` perturbation), so every ground-truth
  probe over the `words` tier reports the same aggregate CER. READ-005 replaces the stub entirely.
