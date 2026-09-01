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
(READ-000 §3, combination rule step 1). READ-005 is ~800–960 probes; signal A eliminates whole
`(font, mode)` regions with a single multiply before a single pixel is rendered.

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

2. **No character appears twice on a sheet.** A recognizer that can see the same glyph rendered
   *legibly* elsewhere on the image reads a degraded copy by cross-referencing it, not by resolving
   the letterforms — the identical false-pass mechanism READ-000 §3 identifies for familiar phrases
   ("Happy Birthday" completed from a language prior rather than read). Enforced two ways:
   - every tile on a sheet has a distinct `expectedText`; and
   - single-character tiles are partitioned by class — letters on their own sheets, digits on their
     own sheets, multi-character strings on their own sheets — so a lone `o` is never on the same
     image as `oo` or `Sophia`, and a lone `8` never shares an image with `88`.

3. **Tiles are labelled by index only.** The expected answer never appears as readable text
   anywhere in the HTML — not in a caption, comment, `title`, `alt`, `aria-*`, or `data-*`. A lone
   letter or digit is unavoidably present in SVG coordinates, hex colours, and CSS keywords, so the
   guarantee is "not as a label or human-readable string", not "not one matching byte anywhere";
   the built-in leak guard rejects comments and `alt`/`aria`/`data-` attributes outright, checks
   every caption against every answer, and does a full-HTML substring scan for entries ≥ 3
   characters. The index-label alphabet is chosen disjoint from the sheet's own glyphs (numeric
   labels for letter/string sheets, letter labels for digit sheets) so the label can't spell an
   answer either.

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
{ fontId, mode, heightMm, stoneSizeId, gapMm, corpusName, corpusHash, sheetPngSha256, modelId }
```

Every field feeds the key, so changing any geometry input, the corpus, the rendered pixels, or the
model is a cache **miss** rather than a silent stale hit. `sheetPngSha256` for a multi-sheet probe
is the sha256 of the per-sheet PNG hashes joined in order. Reading a record whose key already
exists returns it without re-rendering — READ-005 must be resumable across sessions and re-runnable
per font.

Each stored record contains, at minimum: the cache key and every field feeding it, `harnessVersion`,
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
```

`--oracle stub` is the only mode exercised in this milestone. `--oracle pinned` exists in the
argument parsing and is reachable (it constructs `createPinnedOracle()`), but is not run here.
`--corpus` selects the tier (`words` default, `search`, `full`); `--only` restricts to font ids;
`--channel` passes a Playwright browser channel through `screenshotPages()` (needed as `chrome` on
macOS 13, where Playwright has no bundled-Chromium download).

### 8.1 Ground-truth signal-A verdicts (all 11 cases, `--oracle stub`)

| font | mode | heightMm | stone | signal A | reason |
|---|---|---|---|---|---|
| anton-regular | outline | 36.52 | ss6 | **pass** | — |
| poppins-regular | outline | 42.5 | ss6 | **pass** | — |
| great-vibes-regular | outline | 42.5 | ss6 | **pass** | — |
| dancing-script-regular | outline | 34.3 | ss6 | **pass** | — |
| courier-prime-regular | outline | 77.5 | ss16 | **pass** | — |
| cinzel-regular | radial | 56 | ss16 | **fail** | stroke ~2.23mm is narrower than one 4mm stone in radial mode (stemWidthRatio 0.0398 × 56mm height) |
| caveat-regular | fill | 55 | ss16 | **fail** | stroke ~2.44mm is narrower than one 4mm stone in fill mode (stemWidthRatio 0.0443 × 55mm height) |
| lobster-regular | contour | 42 | ss10 | **pass** | — |
| lilita-one-regular | contour | 40 | ss10 | **pass** | — |
| lilita-one-regular | radial | 58 | ss16 | **pass** | — |
| anton-regular | contour (curved) | 60 | ss10 | **pass** | — |

The two failures are exactly Cinzel radial and Caveat fill — the pair READ-003's investigation
identified as the cases the stroke gate still catches (READ-000 §1.2). The curved row uses
`curveRadiusMm: 120` with an upward arc; the prompt's `curveDirection: 'up'` is recorded on the
probe as-authored and mapped to the arc engine's upward-bulging direction (`'outside'`, a 180°
sweep, `ArcProjection.js` only accepts `outside`/`inside`) — both values are kept in the record's
`curve` field.

---

## 9. Part I — the ratio-invariance residual

READ-000 §3 stores **one floor per `(font, mode)`** on the premise that height-to-stone-diameter
generalises across all five stone sizes. `PRODUCTION_GAP_MM` is absolute, so pitch/diameter runs
from **1.150 at SS6 to 1.047 at SS30** and the premise holds only approximately. Measured before
READ-005 commits ~900 recognition calls to it.

For `anton-regular`, `caveat-regular`, `great-vibes-regular`, `lilita-one-regular` × all five modes
× `{ss6, ss30}` at matched height-to-diameter ratios `{10, 12.5, 15, 20}`, on the string
`"Vitalina"`:

**Literal metric** — `stoneCount / (stemWidthRatio × heightMm)`, SS30/SS6 quotient:

> **max |quotient − 1| = 0.7278** (quotient 0.2722), at **(great-vibes-regular, radial, 10)**.

The literal quotient sits near **1/3.2 ≈ 0.31** *by construction*: at a matched height/diameter
ratio the stone **count** is nearly size-invariant (that is the whole point of the ratio), but
`stemWidthRatio × heightMm` — a millimetre stem width — is 3.2× larger at SS30 (heightMm(ss30) /
heightMm(ss6) = 6.4 / 2.0), so the quotient carries that trivial linear-scale term. The literal
number answers the prompt; it is not the interesting residual.

**Supplementary metric** — stem width expressed in **stone diameters**
(`stoneCount × stoneSizeMm / (stemWidthRatio × heightMm)`), which removes the 3.2× term and is the
quantity that actually tests whether a per-`(font, mode)` floor generalises across sizes:

> **max |quotient − 1| = 0.4889** (quotient 1.4889), at **(lilita-one-regular, radial, 12.5)**.

- **Outline mode is genuinely size-invariant:** |quotient − 1| ≤ ~0.05 for every font and ratio.
  A single outline floor per font is safe.
- **The interior-fill modes are not:** `fill` / `staggered` / `radial` / `contour` show 8–49%
  residual, worst in `radial` and at the extreme ratios. A single floor for these modes needs
  either a per-stone-size measurement or a conservative margin, and READ-005 should say which.

The complete raw table is in the final report for `feature/read-004` and is regenerated by
`tools/scratch/read-004-ratio-invariance-residual.mjs` (scratch, gitignored).

---

## 10. Caveats

- **Montserrat.** `montserrat-regular` carries `stemWidthRatio = 0.0145` — the lowest in the
  library by a wide margin — because the bundled `Montserrat-Regular.ttf` is actually Montserrat
  **Thin** (`usWeightClass = 100`) shipped under a Regular id (`docs/BACKLOG.md`). This is a data
  bug, not a readability finding, and its fix is a render-changing font-file migration deferred to
  its own milestone. **READ-005 must either exclude `montserrat-regular` from the sweep or record
  the caveat alongside its floor**, so a hairline-Thin measurement is never mistaken for Montserrat
  Regular's real behaviour.
- **Curved text** is represented by exactly one ground-truth row. Arc projection distorts spacing;
  READ-005 should either add curvature as a sweep dimension or apply a conservative margin to curved
  layers and say so (READ-000 §5).
- The stub oracle's readings in `--oracle stub` runs are a deterministic stand-in for real model
  noise (a fixed `O→0`, `l→1`, `S→5`, drop-trailing-`y` perturbation), so every ground-truth
  probe over the `words` tier reports the same aggregate CER. READ-005 replaces the stub entirely.
