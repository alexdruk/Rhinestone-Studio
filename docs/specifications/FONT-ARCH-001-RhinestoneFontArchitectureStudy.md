# FONT-ARCH-001 — Rhinestone Font Architecture Study

Status: **Study only.** No calibration engine implemented, no fonts modified or generated, no
dependencies installed, no application code changed. This document is the deliverable.

Scope: audit of `src/geometry/`, `src/text/`, `src/fonts/`, `src/renderer/StoneSizes.js`,
`tools/font-certification/`, and the FONT-SOURCE-001 evaluation artifacts (`fonts/review/`,
`fonts/comparison/`) as they exist on `main` at commit `2d2e7f4`.

---

## 1. Runtime architecture: TTF → StoneLayout

```
FontManager (src/fonts/FontManager.js)
    resolves a fontId -> { path, providerId, ... } record
        ↓
FontProviderRegistry (src/text/FontProviderRegistry.js) + IFontProvider contract
        ↓
OpenTypeProvider (src/text/OpenTypeProvider.js)   -- the only module allowed to know opentype.js
    parses the TTF, walks text one Unicode code point at a time via charToGlyph()
    (not stringToGlyphs()/font.getPath(), which would invoke GSUB substitution some
    script fonts ship in a form opentype.js cannot parse), returns a neutral
    FontProviderResult { path: VectorPath(Contours), metrics: GlyphMetrics }, already
    scaled to millimeters via heightMm / unitsPerEm.
        ↓
GeometryEngine._buildPositionedContours() / generateTextLayout()  (src/geometry/GeometryEngine.js)
    calls the provider once per character, positions contours by pen X, applies
    multi-line/align/lineSpacing/rotation and optional curved-text arc projection.
        ↓
StoneSampler (src/geometry/StoneSampler.js)
    flattens contours to polygons, samples outline or fill points at
    spacingMm = stoneSizeMm + gapMm. Purely geometric — no font concept anywhere in
    this file.
        ↓
StoneLayout (src/geometry/StoneLayout.js) — Stone[] in millimeters
        ↓
2D Canvas / 3D Preview / SVG / PNG / JSON export / Production Sheet
    (all consume StoneLayout identically; none re-derive geometry)
```

A second, parallel branch exists for **authored stone-position fonts** (RS Block, RS Modern —
`src/text/rhinestoneFont/`): a family returns `FontProviderResult.stoneCenters`, hand-placed
millimeter positions at one fixed pitch, which `GeometryEngine` converts straight into `Stone`
objects — no contour flattening, no `StoneSampler`, no dependency on the requested fill mode.
This is a legitimate, documented contract branch (not a workaround; see
`src/text/rhinestoneFont/RhinestoneFontProvider.js`'s module doc), selected by whether the
provider returns `stoneCenters`, never by stone size.

**Does the architecture fully support genuine TrueType fonts?** Broadly, yes, with caveats:

- FONT-SOURCE-001 (previous commit) certified 14 real Google Fonts TTFs through this *exact,
  unmodified* pipeline at all 5 stone sizes (min/mid/max height each) and every one landed
  `CONDITIONAL_PASS` with **zero blocking failures** (`fonts/review/*/report.json`).
- Known, real limitations:
  - Per-character glyph lookup deliberately bypasses GSUB (ligatures, contextual forms) — a
    genuine ceiling for connected-script TTFs, not a bug (`OpenTypeProvider.js:185-190`).
  - No hinting or variable-font instance selection is evaluated or applied.
  - Curved text and Boolean Operations are unsupported against authored stone-center fonts —
    an architectural boundary, not a TTF limitation.
  - Confusable-pair shape-similarity checking currently runs at one representative stone size
    (SS16) only, for cost reasons (`productionAnalysis.mjs`'s `SIMILARITY_CHAMFER_THRESHOLD`
    comment) — not exhaustively validated at all 5 sizes.
  - The certified height range per stone size is a **milestone-specified table**
    (`sourceEvaluation.mjs`'s `HEIGHT_RANGE_MM_BY_SIZE`), not derived from each font's own
    metrics — the certification proves the table is achievable, not that it is optimal per font.

---

## 2. Physical constraints by stone size

| Size | Diameter (mm) | Pitch = diameter + 0.3mm gap | Milestone height range (min–max, mm) |
|------|------|------|------|
| SS6  | 2.0 | 2.3 | 35–50 |
| SS10 | 2.8 | 3.1 | 45–60 |
| SS16 | 4.0 | 4.3 | 65–90 |
| SS20 | 4.7 | 5.0 | 80–110 |
| SS30 | 6.4 | 6.7 | 106–111 |

(`src/renderer/StoneSizes.js`, `tools/font-certification/lib/sourceEvaluation.mjs`)

Every geometric threshold in the pipeline — collision distance, `ISOLATION_MULTIPLIER` (2.5×
pitch), `CLUSTER_GAP_MULTIPLIER` (1.6× pitch) — is pitch-relative
(`productionAnalysis.mjs:40-41`), so the *sampling algorithm's shape* never changes across
sizes. What changes is the achievable **detail budget**:

- **Counter/aperture area needed per stone scales with pitch².** A fixed absolute stone-count
  floor (`MIN_STONE_COUNT_FOR_COUNTER_BEARING = 10`, `readabilityMetrics.mjs`) applies
  identically at every size, but is far harder to satisfy at SS30 for the same physical counter
  (an "o", "e", a script loop) than at SS6 — this is the constraint most likely to force
  different letterform anatomy, not different code.
- **Minimum legible height grows with stone size, and the usable range compresses.** SS6 has
  15mm of headroom between its min and max prescribed height; SS30 has only 5mm
  (106–111mm) — large stones leave far less room to fit a design into a given physical print
  area before either falling below the meaningful-stone-count floor or exceeding the product's
  physical printable region (see `RS-2010-PhysicalProductDimensions`, cross-reference flagged as
  Unknown #5 below).
- **The 0.3mm production gap is a fixed absolute floor, not a percentage** — so fine details
  that are one pitch wide at SS6 (thin stems, tight serifs, script connectors) may not exist as
  a discrete addressable position at all at SS30.

FONT-SOURCE-001's own run did not observe any font actually failing at any tested size — but its
3 sample heights (min/mid/max) were pre-selected specifically within a range designed to keep
stone counts viable. It validates the height-range table's own achievability, not "any font, any
height, at SS30 is safe" (see Unknown #2).

---

## 3. Font strategy

**Evidence for each option:**

- **(A) One universal font/skeleton for all 5 sizes:** partially supported — every one of the 14
  certified TTFs passed at every stone size *when height was allowed to scale with stone size per
  the milestone's own table*. This is standard type-design practice (the same font file used at
  different point sizes) and the repo's `StoneSampler` already treats stone size as just another
  spacing parameter, not a font-selection axis.
- **(B) Grouped variants:** this is what FONT-SOURCE-001 already, empirically, organized itself
  around — `categoryGroups` in `fonts/comparison/comparison.json` groups the 14 candidates into
  6 style categories (casual/elegant/monoline script, rounded, heavy, modern sans) and picks a
  per-category winner. The grouping axis used today is **typographic style**, not stone size.
- **(C) One font per stone size:** no evidence in the repo supports or tests this. Nothing in
  FONT-SOURCE-001 or the certification lib compares "same font, taller at SS30" against "a
  font whose outline was specifically redesigned for SS30." That experiment has never been run
  (see Unknown #1).
- **(D) Other:** the authored stone-map families (RS Block/RS Modern) are a third, already-shipped
  architecture — hand-placed dot-matrix positions at one fixed pitch, used where TTF-resampling
  legibility failed outright at the sparsest end (see `rhinestone_studio_font_perf_lesson`
  memory / `RhinestoneFontProvider.js`). This is not a stone-size-driven strategy either; it is a
  from-scratch-authoring strategy chosen when no existing outline could be trusted.

**Best-supported answer today: (B), grouped by style category** — matching the axis
FONT-SOURCE-001's own milestone spec and results already converged on — with one shared
height/pitch table driving size, not per-category or per-size font forks. Whether any single
category (most plausibly script, given its connecting strokes and the GSUB limitation above)
will eventually need size-specific outline treatment — a (C)-style fork scoped to just that one
category, not a general rule — is unresolved pending Unknown #1.

---

## 4. Transformation strategy

**No — not every stone-size variant needs the same algorithm, and the repo already proves it two
ways:**

1. **Within the sampled/TTF path**, one uniform algorithm already serves every stone size:
   `spacingMm = stoneSizeMm + gapMm` feeds the same `StoneSampler` outline/fill functions and the
   same pitch-relative collision/isolation/cluster thresholds regardless of requested size. This
   is precisely what let FONT-SOURCE-001 certify 14 fonts across 5 sizes with zero size-specific
   branching in production code.
2. **The authored stone-map path is a second, permanently different algorithm** that already
   coexists with it in production: hand-placed absolute positions at one fixed pitch, explicitly
   **not** scaled by `heightMm` at all (`RhinestoneFontProvider.js`'s module doc: "Deliberately
   NOT scaled by heightMm... rescaling stone positions would change the pitch between them,
   defeating the point of a fixed-stone diagnostic"). Selection between the two algorithms is by
   `FontProviderResult.stoneCenters` presence, never by stone size.

So the real axis that currently changes the transformation is **authored-vs-sampled font
strategy**, not stone size itself. Whether stone size *should* additionally pick a different
transformation (e.g. a simplified/coarsened sampling strategy specifically at SS30) is unproven —
nothing in the repo branches transformation logic by SS id today, and no evidence yet shows the
uniform pitch-relative sampler breaking down at any tested size (see Unknown #2).

---

## 5. Calibration architecture

**Should be shared** (and, per FONT-SOURCE-001's commit message — "Reuses FONT-CERT-001/002's
certification lib wholesale... rather than a parallel pipeline" — already is, deliberately):

- The measurement/analysis tooling: `ttfValidation`, `typographyFindings`, `productionAnalysis`,
  `readabilityMetrics`, `classification`, `claudeDesignFeedback`.
- The transformation engine itself: `GeometryEngine`/`StoneSampler` — CLAUDE.md forbids a second
  one outright, and every certification script already imports the real, unmodified engine
  module rather than re-deriving its math (`productionAnalysis.mjs`'s header comment).
- The stone-size physical catalog (`STONE_SIZES`, default 0.3mm gap) — one source
  (`src/renderer/StoneSizes.js`).
- The height-range-per-stone-size policy table — currently one fixed table applied to every
  font/category uniformly; whether it should stay one shared table or become category-specific
  is unresolved (Unknown #4).

**Should remain independent per font/category:**

- The source TTF/outline file itself for each style category.
- Glyph-level exceptions: kerning tables and confusable-pair handling are already independent
  per family today (`rsBlock.js`/`rsModern.js` each own distinct kerning *data* through the
  shared `kerningTable.js` *mechanism* — mechanism shared, data independent).
- Any future outline-modification effort — every one of the 14 candidates was flagged "Medium"
  modification effort with font-specific refinement notes; corrections are inherently per-font.
- The authored dot-matrix families (RS Block/Modern) — a fully separate delivery mechanism
  solving a different problem (guaranteed legibility at one committed pitch) from TTF-based
  categories, and should stay architecturally separate rather than being folded into a shared
  "calibration profile" concept.

---

## 6. Python / fontTools evaluation

The repo has zero Python today; the only font-parsing dependency is `opentype.js` (JS), used
exclusively for read-only path extraction at runtime — there is no font-*editing* capability
anywhere in the current stack.

**fontTools** (`fontTools.ttLib`, `pens`, `varLib`) is the appropriate offline foundation *if and
only if* outline modification (Option C treatment for a specific category/size, per Unknown #1)
is ever greenlit — it is the standard, scriptable, CI-friendly library for contour surgery,
generating simplified instances, subsetting, and variable-font instancing, none of which exists
in the JS runtime (nor should it — CLAUDE.md forbids adding font-mutation capability to the
shipped app).

Recommend fontTools alone as the floor. Do **not** add FontForge/RoboFont or other GUI-first
tools unless a human-in-the-loop glyph-drawing workflow is explicitly requested — nothing in the
current evidence (a measurement/classification problem, per Section 8) justifies them yet, and
they are harder to script and run in CI. Only justified additions if a specific need arises:
`ufo2ft`/`fontmake` if UFO-sourced masters become the authoring format for a modified category
(not evidenced as needed); no case yet for any Python-side plotting or reporting library, since
the certification lib's existing Node-based specimen/report pipeline already does this and
should not be duplicated.

Any Python work must stay strictly offline/build-time: its only output is a standard TTF/OTF
artifact that re-enters the existing pipeline exactly like the 14 Google Fonts already did
(`FontManager` → `OpenTypeProvider`), never a new runtime code path.

---

## 7. Boundary between Python and Rhinestone Studio

- **Python's job**: offline, human/CI-triggered font *engineering* — selecting, measuring, and
  (where justified by evidence) modifying source outlines so they survive rhinestone resampling
  better at a specific stone-size/category. Output is always a standard font-file artifact.
- **Rhinestone Studio's (JS) job**: everything it already owns per CLAUDE.md — the one
  `GeometryEngine`/`StoneSampler` pipeline that turns *any* conforming font file into a
  `StoneLayout`, plus the certification/measurement tooling that scores it. This already never
  moves — `productionAnalysis.mjs` imports `src/geometry/GeometryEngine.js` directly rather than
  re-implementing sampling, and both the live app and every offline certification script share
  that one engine.
- **Avoiding duplicated production logic**: the temptation in a Python prototyping loop is to
  re-derive stone spacing/fill math in Python to "preview" a candidate offline without round-
  tripping through Node. The existing certification pattern already establishes the correct rule
  and should extend unchanged to any Python tooling: Python measures typographic/outline
  properties in font units (contour counts, stroke contrast, aperture size); the *production*
  verdict always comes from calling the existing, real Node certification pipeline — never from
  a parallel estimate.

---

## 8. Validation strategy

Already-built, reusable, proven machinery (FONT-CERT-001/002, FONT-SOURCE-001):

- `ttfValidation` — structural/coverage/geometry TTF checks.
- `productionAnalysis` — real `StoneLayout` generation per glyph/word × stone size: collision
  count, isolated-stone count, cluster count, confusable-pair chamfer-distance similarity.
- `readabilityMetrics` — fixed stone-count floors (`MIN_MEANINGFUL_STONE_COUNT`,
  `MIN_STONE_COUNT_FOR_COUNTER_BEARING = 10`) and specimen pixel-density compliance.
- `classification` — rule-based PASS/CONDITIONAL_PASS/FAIL, deliberately auditable rather than a
  weighted score, so every verdict traces to a specific check.

**Objective measurements a future calibration result should be judged against** (all already
implemented, several already blocking, some currently only WARNING-tier):

- Zero stone collisions at the target stone size (blocking today).
- Zero "materially misread" confusable pairs — one side of a pair degenerate (≤1 stone) while the
  other isn't (blocking today).
- Stone count per counter-bearing glyph ≥ 10 (currently WARNING-tier; candidate for promotion to
  blocking in a stone-size-focused study).
- Confusable-pair chamfer distance below threshold — **currently computed at SS16 only**, a real
  gap for any study specifically about size-dependent legibility.

**What's missing for a genuinely size-focused calibration study**: none of the above currently
produce a *comparative, size-normalized trend* (e.g. "does font X's legibility degrade faster
from SS10→SS30 than font Y's"). Classification is a per-report snapshot at 3 sampled heights, not
a continuous cross-size curve — a future milestone should measure that curve directly rather than
re-running the existing classifier at more fixed points.

---

## 9. Unknowns and the smallest experiment for each

1. **Does per-stone-size outline modification ever outperform simply holding one TTF's
   height:pitch ratio constant?** Smallest experiment: take one already-certified font (e.g.
   BebasNeue, "heavy" category) at SS30, use fontTools to simplify one problem glyph already
   flagged in its `refinementNotes`, rerun the existing `productionAnalysis.mjs` against original
   vs. modified glyph, compare `stoneCount`/`collisionCount`/`isolatedCount` deltas at SS30 only.
   No new pipeline code — reuses the `fonts/candidates/` one-off-candidate workflow FONT-CERT-001A/B
   already established.
2. **Is the fixed `HEIGHT_RANGE_MM_BY_SIZE` table (same min/max for every font regardless of
   weight/style) actually correct, or was it only validated against fonts that happened to fit
   it?** Smallest experiment: sweep height in small steps (not just min/mid/max) for 2–3 already
   `CONDITIONAL_PASS` fonts (one script, one heavy) at SS30 only, using
   `deriveSpecimenHeightMm()`'s ratio as a center point, and find the actual height at which
   `counterCollapseFindings`/`collisionCount` first go non-zero.
3. **Does confusable-pair similarity meaningfully change across stone sizes, given it's currently
   computed at SS16 only?** Smallest experiment: rerun the existing chamfer-distance computation
   at all 5 sizes instead of one, for a single already-certified font — no architecture change,
   just remove the SS16-only restriction for one test run and diff the findings.
4. **Is "style category" the right grouping axis, or would a stone-size-driven grouping better
   predict which fonts need modification?** Smallest experiment: pure data analysis over the 14
   already-generated `fonts/review/*/report.json` files — correlate refinement/warning density
   against both groupings and see which clusters more tightly. No new font work.
5. **Does the SS30 106–111mm minimum-legible-height floor conflict with any product's actual
   physical printable region?** Smallest experiment: cross-reference `src/products/definitions`'
   printable-region dimensions (RS-2010) against the SS30 range for the smallest supported
   product, to check whether any product physically cannot fit a legible SS30 word at all.
6. **Do any of the 14 certified fonts actually fail at the true extremes of their stated range,
   rather than the 3 sampled min/mid/max points?** Covered by Unknown #2's sweep.

---

## Deliverable

**Recommended architecture** (supported by current evidence, not yet fully proven):
grouped-variant strategy (**Option B**), grouped by **typographic style category** — matching
the axis FONT-SOURCE-001 already converged on — sharing one calibration/measurement engine and
one height/pitch policy table across all categories, with independent source outlines and
glyph-level exceptions per category. The existing authored stone-map families (RS Block/RS
Modern) remain a separate, third strategy for cases no TTF resampling could serve.

**Unresolved, requiring experiment**: whether any single category (script is the most likely
candidate, given the GSUB/connected-stroke limitation in Section 1) needs stone-size-specific
outline treatment — a narrow, category-scoped Option C — rather than one committed TTF per
category serving all 5 sizes via height scaling alone. This is the load-bearing open question;
everything else in this study is either already-shipped architecture or a data-analysis exercise
over already-generated results.

**Proposed next milestone** (not implemented here): a single-glyph, single-size fontTools
modification experiment (Unknown #1) — the smallest test that can actually distinguish Option B
from a category-scoped Option C, before committing to either for the broader font-strategy
rollout.
