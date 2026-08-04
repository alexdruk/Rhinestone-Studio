# Rhinestone Studio — Task Result

This document is completed by the implementation engineer after finishing the current task.

---

# Task ID

TXT-104 — Text Height Accuracy: Design and Audit Phase

---

# Status

COMPLETE. Design/audit-only phase, per the task brief's explicit instruction — no `src/**`,
`app.js`, `index.html`, or test file was touched. Deliverable is
`docs/specifications/TXT-104-TextHeightAccuracyDesign.md`, `TASK.md`, and this file.

---

# 1. Headline finding — flagged prominently, same as in the design doc itself

**ARCH-REVIEW-001's claim that finding #5 ("`heightMm` is em size, not physical letter height") is
already closed by `TXT-103A` is a mischaracterization.** Having read `TXT-103A` in full, its entire
scope is a *different* question — whether it's safe to change `heightMm` (does it regenerate
geometry rather than illegally re-scaling stone positions?). It never discusses em-box proportions,
cap-height, x-height, or any font-metrics ratio, and never measures how far a requested `heightMm`
diverges from a font's actual rendered letter height. **The actual gap ARCH-REVIEW-001 originally
described has never been measured or fixed by any shipped milestone and is fully open today.**

---

# 2. Re-verification of TXT-103A's other findings

Every other specific, checkable claim `TXT-103A` makes (safe regeneration semantics, no illegal
point-scaling, RS Block's fixed-pitch no-op behavior, exporter correctness, generic collision
handling) was re-checked line-by-line against the current code and **is still accurate** — full
per-claim table with current file/line citations is in
`docs/specifications/TXT-104-TextHeightAccuracyDesign.md` §1.

Two things did change since `TXT-103A`, neither contradicting it:
- The `#height` field's clamp (`TXT-103`, referenced but not separately audited by `TXT-103A`) is
  now `[4, 111]` (raised from `TXT-103`'s original 80 by the FONT-DECISION-001 studio-integration
  follow-up), still bounding the *raw* em-size field, not correcting its meaning.
- `TXT-103A`'s one flagged-but-out-of-scope gap — `fitTextToShape()` throwing unhandled for
  authored-stone-center fonts like RS Block — **was fixed since, by FONT-002** (confirmed in the
  live `app.js` function body, which explicitly cites TXT-103A in its own comment).

---

# 3. Quantified gap (real measurements, not estimates)

Parsed all four shipped OpenType production fonts (Baloo2, Anton, Sacramento, Dancing Script — the
`rhinestoneValidated:true`/`providerId:'opentype'` fonts `productionFonts()` actually offers) with
`opentype.js`, the same library already used in production, and measured both the OS/2 table's
metrics and the actual rendered bounding box of reference glyphs:

| Font | Measured cap-height ratio (of em) | Actual cap height at requested `heightMm=30` | Shortfall |
|---|---|---|---|
| Baloo 2 | 0.618 | 18.54mm | **38.2% smaller** |
| Anton | 0.859 | 25.78mm | **14.1% smaller** |
| Sacramento | 0.778 | 23.35mm | **22.2% smaller** |
| Dancing Script | 0.807 | 24.21mm | **19.3% smaller** |

RS Block / RS Modern (authored stone-center fonts) have no OpenType em-box at all — `heightMm` is
already a confirmed no-op for them, unrelated to this gap.

Also found: the OS/2 table's own `sCapHeight` field disagrees with the font's actual rendered
glyph outline by up to 12% (worst for the two script faces) — meaning a naive "trust the OS/2
metrics table" heuristic would leave real residual error exactly where the gap is largest. Full
measurement methodology and tables are in the design doc §2.

---

# 4. Design proposal summary

Full reasoning is in the design doc §3; headline decisions:

- **Correction belongs at the user-intent boundary in `app.js`'s orchestration layer**, translating
  a new "desired physical letter height" into the existing `heightMm` before it reaches
  `GeometryEngine` — not inside `generateTextLayout()`/`OpenTypeProvider` sampling, because every
  downstream consumer (Auto Fit, Fit-to-Shape, the `[4,111]` clamp, and critically the
  human-calibrated SS30 legibility gate) already depends on `heightMm` meaning what it means today.
- **Per-font-file ratios, measured through the real pipeline** (not a hand-tuned table, and not a
  blind trust in OS/2 metrics, per the 12% divergence found above), precomputed offline and stored
  as a new optional `assets/fonts/manifest.json` field — the same additive-field pattern
  `rhinestoneValidated`/`unsupportedStoneSizes` already use.
- **Backward compatibility**: a new additive `layer.heightMode` field (`'raw'`|`'capHeight'`),
  defaulting to `'raw'` for every existing project (zero behavior change, no schema-version bump
  needed — this repo has none), with new layers defaulting to the corrected mode going forward.
- **Auto Fit / Fit-to-Shape**: both already treat `heightMm` as an opaque scalar to scale and
  re-measure — need zero logic changes, as long as they keep consuming whatever value
  `layer.height` resolves to.
- **SS30 gating (FONT-POLICY-001)**: untouched by construction, since it's calibrated against the
  same raw `heightMm` this design deliberately never redefines at the engine level.

---

# 5. Scope and sequencing for implementation

Design doc §4 lays out 7 ordered, independently-testable steps: (1) derive/validate ratios,
manifest-only, no behavior change; (2) a pure helper solving `engineHeightMm` from desired
cap-height; (3) additive `layer.heightMode` field + new-layer-only wiring, verified against the
existing example-fixture regression suite for byte-identical legacy output; (4) UI exposure; (5)
Auto Fit/Fit-to-Shape verification; (6) RS Block/RS Modern no-op regression lock-in; (7) SS30 gating
regression confirmation. Steps 1-3 are the compatibility-critical steps, deliberately isolated from
UI work.

---

# 6. Commands executed

```
git branch --show-current
git status
git log --oneline -3
```

(pre-flight checks only — no build/test commands, since no code changed)

---

# 7. Automated test results

None run — not applicable to a documentation-only milestone, per `docs/AI_ENGINEER.md`'s testing
policy ("run only tests directly related to the current task").

---

# 8. Browser/manual verification

Not applicable — no UI or behavior change in this phase.

---

# 9. Warnings / known limitations

- The design doc's proposed `layer.heightMode` field name, its exact UI label ("Letter Height" vs.
  "Cap Height" vs. other), and the corrected control's own real-mm bounds (flagged in design doc
  §3.4 as bumping against the existing `[4,111]` clamp for some font/height combinations) are all
  left as open decisions for the implementation milestone, not resolved here.
- x-height ratios were measured alongside cap-height ratios for completeness but the design
  recommends cap-height as the primary target metric; whether x-height should also be exposed is
  left to the implementation milestone.

---

# 10. Recommended next milestone

Implementation step 1 from the design doc's §4 sequencing: derive and validate cap-height ratios
for the four shipped OpenType production fonts, manifest-only, no pipeline or UI changes — the
lowest-risk, fully isolated first slice, pending ChatGPT's milestone-level review of this design.
