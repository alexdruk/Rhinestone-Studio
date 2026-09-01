# READ-000 — Readability program: architecture proposal

Status: **Partially implemented.** READ-003 (Layer 1 physical-impossibility gate), READ-001 (Layer 0
contour centreline) and READ-002 (Layer 0 radial per-component) are merged; the remaining layers are
still for sign-off. Supersedes the ad-hoc approach that produced FONT-LIB-003 and FONT-LIB-004.

---

## 1. What we now know

Six findings from the investigation, in the order they changed the picture:

1. **The certification pipeline only ever tested outline mode.** `analyzeOne()` hardcodes
   `mode: 'outline'`. Every rated font, every `unsupportedStoneSizes` entry, and FONT-LIB-004's
   whole audit describe outline only. Fill, staggered, radial and contour shipped ungated. This is
   the root cause of the reported problem, not any individual font.

2. **Mode dominates, not the font.** Across 11 human-labeled cases: outline good 4/4 (even at 0.60
   stones across the stroke); contour bad 3/3 (including the *widest* stroke measured, Anton at
   2.32); radial bad 2/2; fill split by stroke width. Outline traces the letterform itself, so it
   survives thin strokes. Contour and radial are area fills designed for shapes and have no relation
   to a letter's skeleton.

3. **Three label-free geometric metrics were tried and all failed.** Shape fidelity (IoU/coverage/
   spill) rated certified-good outline *worst* of everything. Stones-across-stroke put good and bad
   within 0.05 of each other (Dancing Script 0.60 good vs Caveat 0.58 bad). Topology (connected
   components + holes) put the best Fill example at the bottom. Each failure was only detectable
   because a few human labels existed to check against.

4. **The existing objective metrics already contradicted human raters once.** Run across the
   library, they declared Anton/Sacramento/Dancing Script clean at SS30, where human raters had
   measured 6% readable. The humans were right. Objective geometry is a floor, never the verdict.

5. **Vision recognition works.** Rendering the layout as it physically looks and reading it back
   agreed with human labels on 10/11 cases, including correctly misreading the one case where
   letters are genuinely lost. The single disagreement (Lilita One / radial / SS16 — decodable but
   ugly) defines the method's limit precisely: it measures *decipherability*, not *quality*.

6. **Height is a real but blunt factor.** FONT-LIB-004 (merged) warns below each stone size's
   validated minimum height. It is font-blind and mode-blind, and already false-positives on a
   human-approved case (Dancing Script outline at 34.3mm vs a 35mm floor).

## 2. Design principles

- **Fix causes before gating symptoms.** A mode that produces mush is a bug, not a configuration to
  disable.
- **Cheap checks live, expensive checks offline.** Physical impossibility is arithmetic and belongs
  in the app. Recognition is a batch job whose output is baked data.
- **Recognition is a floor, humans set the bar.** Automate the catastrophic; reserve human judgment
  for the marginal.
- **Store a continuous number, not a boolean.** A per-combination on/off flag cannot express "this
  works if you make it bigger", which is the actual shape of the constraint.

## 3. Proposed architecture

### Layer 0 — Fix contour and radial for text (READ-001, READ-002)

Contour fill traces one iso-distance loop per threshold inward from the boundary. On a closed shape
that is correct; on a letter stroke that single loop runs down one side of the stroke and back up
the other, and where the stroke narrows its two opposing branches converge — sampled naively that
lays two near-coincident rows of stones which greedy dedupe then culls in arbitrary walk order,
exactly the mush in the reported screenshots. The correct degenerate case for a narrow stroke is a
**single line down the stroke's medial axis** — the monoline result rhinestone lettering actually
wants. **Implemented in READ-001** (`docs/specifications/READ-001-ContourCentreline.md`):
`splitSliverRuns()` collapses any run that has closed up below one stone pitch to a line of
midpoints, plus sub-cell-accurate ring placement and a `stoneSizeMm` (not full-pitch) dedupe floor.

Radial fill rays outward from a single anchor: the bounding-box centre of the whole layout. For an
eight-letter word that anchor sits in the middle of the word with no relation to any letter, so the
pattern is a tight bullseye at the middle letters and near-straight rows (indistinguishable from
Grid Fill) at the outer ones — one mode, two behaviours in one word. **Implemented in READ-002**
(`docs/specifications/READ-002-RadialPerGlyph.md`): `groupPolygonsIntoComponents()` splits the
contours into connected components by even-odd nesting — deliberately a connected component, not a
character, so an `i`'s dot and stem anchor separately while an `a`'s counter stays a hole of its
outer — and `sampleRadialFillPoints()` rays each component out from its own bounding-box centre,
keeping a candidate only if it is inside both its own component and the global polygon set. A
single-component shape (Circle, Rectangle, single-glyph text, one-piece SVG) is byte-identical to
before. READ-002 also fixed a floating-point floor bug that dropped every radial fill's innermost
ring from 6 stones to 5 (17.6% over-spaced). Radial fill for image/raster layers keeps the single
whole-placement anchor — connected-component labelling on a density field is a different technique,
deferred (`docs/BACKLOG.md`).

These are the highest-value items: they likely remove most bad cases at source, and they turn two
"broken" modes into useful ones rather than deleting user options.

### Layer 1 — Live physical-impossibility check (READ-003)

If the stroke is narrower than one stone diameter, the stone physically overhangs the stroke on both
sides and no algorithm can render it. This is geometry, not a heuristic, and needs no data: compute
the glyph's stem width at the current height (already prototyped) and compare to the stone diameter.
Catches Cinzel (0.51) and Caveat (0.58) immediately, in the app, with no baked table.

### Layer 2 — Offline composite sweep → baked floors (READ-004, READ-005)

Recognition is one signal among several, not the criterion. Four classes of evidence, each good at
something the others are not, combined by an explicit rule.

**Corpus.** Reuse `tools/font-certification/lib/requiredCharacters.mjs` as-is — it already carries
`PRODUCTION_REVIEW_GLYPHS` (62 alphanumerics), `CONFUSABLE_PAIRS`, `STRESS_STRINGS` (`rn`, `mm`,
`oo`, `88`, `69`, `GC`, `OQ`) and `PRODUCTION_REVIEW_WORDS` (Ashley, Sophia, Bride Squad, Happy
Birthday, Class of 2027). No new corpus is needed; it needs to be *rendered in every mode* rather
than outline only.

**Why the corpus must be tiered.** A recognizer shown a degraded "Happy Birthday" reads it correctly
by completing a familiar phrase, not by resolving the letterforms — a false pass. This product sells
**personal names**, which carry no such prior: a reader meeting "Vitalina" for the first time gets no
help from context. Context-free legibility is therefore the correct standard here, and whole-phrase
accuracy is the weaker, secondary check.

| | signal | measures | cost | role |
|---|---|---|---|---|
| **A** | Deterministic defects: stone collisions, zero-stone/unusable layout (existing `collectProductionIssues()`), stroke < 1 stone diameter | physical impossibility | free, exact | **Hard fail.** No oracle involved; final. |
| **B** | Context-free recognition: 62 isolated glyphs + confusable pairs + stress strings → character error rate | legibility with no language prior | batch | **Primary floor.** |
| **C** | Context-realistic recognition: `PRODUCTION_REVIEW_WORDS` → word accuracy | realistic order legibility | batch | Secondary; **B-fail + C-pass is a red flag, not a pass** |
| **D** | Geometric corroboration: existing `chamferDistance` on confusable pairs, attrition ratio, crowding | shape divergence | free | **Cross-check, never a verdict** (it has already been wrong once, §1.4) |
| **E** | Human rating of marginal cases | quality above decipherability | scarce | Sets the margin |

**Combination rule.**
1. Any **A** failure → unsupported at that combination. Deterministic and final.
2. Otherwise the floor is the lowest height-to-stone ratio at which **B**'s character error rate
   clears threshold *and* **C** is fully correct.
3. Multiply by the **E**-calibrated quality margin.
4. Where **B** and **D** disagree sharply, emit for human review rather than trusting either. This
   is the guard against oracle flakiness, and it should be a small set.

**Per-character diagnosis falls out for free.** Because B tests glyphs in isolation, the output is
not a boolean but "this font loses `e` vs `c` below ratio X" — far more actionable than a flag, and
it gives the UI something specific to say.

**What gets stored: a minimum readable height-to-stone ratio per (font, mode).** Readability is
governed by that ratio, not by absolute size, so one number generalizes across all five stone sizes:

```
"readabilityFloors": { "outline": 12.5, "fill": 18.0, "contour": 16.0, ... }
```

The batch tool binary-searches height at a reference stone size until signal **B** stops clearing,
per font per mode. Signals **A** and **D** are free and run at every probe; **C** runs only at the
candidate floor to confirm. That is ~31 fonts × 5 modes × ~5 search steps ≈ 775 renders, batched
~10 per contact sheet ≈ 78 recognition passes. A one-time job, re-run only when fonts are added or
Layer 0 changes the geometry.

Ordering the signals this way matters for cost as much as correctness: **A** eliminates whole
combinations before any recognition call is made, so the expensive signal only ever runs on
candidates that are physically buildable.

Two safeguards this needs and the existing certification tooling does not have:
- **Reproducibility.** Pin the model and record its identifier plus the raw readings alongside the
  derived floor, so a later disagreement can be audited rather than re-litigated. A recognition
  oracle is not deterministic the way `hasAnyOverlappingStonePair()` is, and the manifest should not
  pretend otherwise.
- **A quality margin.** Recognition finds the decipherability floor; the product bar is higher. Ship
  `floor × margin`, with the margin calibrated against human-labeled marginal cases (the Lilita One
  case is the first). One tunable, one clear meaning.

### Layer 3 — Live UI consuming the floors (READ-006)

The app computes `heightMm / stoneSizeMm` for the current layer and compares against the floor for
its font and mode. This **supersedes FONT-LIB-004's blunt rule**: same warning surface, but
font-aware and mode-aware, so outline stops being warned at heights it handles fine and fill starts
being warned at heights the current rule misses. FONT-LIB-004's `#heightBelowReadableWarning` and
`textHeightBelowReadableMinimum()` become the delivery mechanism rather than the policy.

## 4. Sequencing

| | milestone | depends on | why here |
|---|---|---|---|
| 1 | READ-003 live impossibility check | — | Independent, immediate, no data needed — **merged** |
| 2 | READ-001 contour centreline | — | Highest value; removes causes — **merged** |
| 3 | READ-002 radial per-component | — | Highest value; removes causes — **merged** |
| 4 | READ-004 render + recognition harness | 001, 002 | Grid must render post-fix geometry |
| 5 | READ-005 sweep + bake floors | 004 | |
| 6 | READ-006 live UI on floors | 005 | Supersedes FONT-LIB-004's rule |

READ-004/005 **must** follow the algorithm fixes; a sweep run now would be invalidated by them.

## 5. Risks and open questions

- **Curved text is unmeasured.** One reported bad case was curved (Anton, contour, curved). Arc
  projection distorts spacing and is not represented in any measurement so far. Either add curvature
  as a sweep dimension or apply a conservative margin to curved layers and say so.
- **Recognition as an oracle is not deterministic.** Mitigated by pinning and recording raw
  readings, not eliminated. This is a genuine departure from how every other gate in this codebase
  works and should be a conscious decision, not a side effect.
- **The tool must not become a runtime dependency.** Like `tools/font-certification/`, this is a dev
  tool; the app only ever reads baked numbers.
- **Margin calibration needs human labels** — a modest number (10–20 marginal cases), but not zero.
  This is the irreducible human input, and it is far less than rating the full grid by hand.
- **Mixed-size and per-region stone specs** are out of scope for the first pass; floors assume a
  uniform stone size per text layer.

## 6. What this does not do

It does not gate modes off, and it does not treat geometric metrics as verdicts. Both were
considered and rejected above, on evidence.
