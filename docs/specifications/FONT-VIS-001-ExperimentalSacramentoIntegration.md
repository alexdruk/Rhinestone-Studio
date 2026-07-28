# FONT-VIS-001 — Experimental Sacramento Integration: Evaluation Report

Status: **Milestone complete via the brief's own no-candidate contingency.** No experimental font
was produced, no Studio registration was made, no comparison images were captured, and no
application/runtime code was changed. This document is the deliverable in place of items 1–3.

---

## 1. Summary of previous findings

- **FONT-ARCH-001** (`7d249ef`): architecture audit only. Established that any future
  outline-modification effort is inherently per-font/per-glyph, and that the shared, reusable part
  of any calibration work is the measurement pipeline, not a transformation engine. No modification
  proposed or tested.
- **FONT-CAL-001** (`b166750`): tested single-vertex cusp-widening on Sacramento's sharpest
  same-contour turn, on glyphs "m", "n", "v" (9 variants total: m×4, n×3, v×2). Result: **0 of 9
  kept**. "m" and "n" showed zero sensitivity to the technique across a 4x delta range; "v" showed
  real sensitivity but only with a disqualifying SS6 regression. Height scaling (a separate,
  non-outline lever) fully resolved fragmentation but only at 150–200mm, beyond SS30's committed
  106–111mm range — and at 111mm (the legal ceiling) it made "m" *worse* (3→4 clusters).
- **FONT-DIAG-001** (`7973644`): explained mechanistically why FONT-CAL-001 found zero leverage —
  StoneSampler's RC-004A dedup depends on pairwise chord distance between arc-length-resampled
  points, not on the sharp-cusp vertex a single-vertex nudge relocates. Recommended a
  contiguous-span technique as the next, and only remaining, untested outline-modification
  hypothesis.
- **FONT-CAL-002** (`42d3c9c`): tested contiguous-span widen/straighten/smooth on "m" and "n" (6
  variants). Result: **0 of 6 kept**. 2 of 6 (m-widen, m-straighten) did move SS30 `clusterCount`
  (3→1), but `pipeline-trace.mjs` showed the driving prune-event gap was never closed — the
  improvement came from an emergent, glyph-idiosyncratic union-find bridge, not a controllable
  response to the technique. Both also regressed the SS10 control (1→2 clusters), and neither
  generalized to "n" despite comparable or larger displacement. **Final conclusion: C — evidence
  favors production policy (height) over further outline modification.** Recommended next step:
  FONT-POLICY-001 (SS30 Height Ceiling Policy Study), explicitly *not* further outline-modification
  work.

## 2. Why this candidate was selected

**No candidate was selected.** Every outline modification tested across FONT-CAL-001 and
FONT-CAL-002 already carries an explicit REJECT verdict from that milestone's own acceptance rule
("improvement without a meaningful regression"). None is left unresolved (UNKNOWN) — each has a
measured, tabulated outcome. Per this milestone's brief: *"If no previous modification deserves
inclusion, explain why and continue with the original Sacramento."* That is the outcome here.

Height scaling is excluded from candidacy for a different reason: it is not an outline
modification (nothing to bake into a font file), and the only heights that resolved fragmentation
(150–200mm) fall outside SS30's currently-committed 106–111mm production range — it cannot be
realized as a shippable font variant without also changing product policy, which this milestone
is explicitly barred from doing ("Do not... perform another calibration study").

## 3. Previous modifications retained

None.

## 4. Previous modifications rejected

| Source | Glyph | Modification | Verdict (prior milestone's own) |
|---|---|---|---|
| FONT-CAL-001 | m | single-vertex, primary cusp, δ70/150/300 | REJECT — clusterCount unchanged (3) all 3 deltas; δ300 distorts bbox height +16.7% |
| FONT-CAL-001 | m | single-vertex, secondary cusp, δ200 | REJECT — clusterCount worse (3→4) |
| FONT-CAL-001 | n | single-vertex, δ70/150/300 | REJECT — clusterCount unchanged (2) all 3 deltas; δ300 distorts bbox height +34.5% |
| FONT-CAL-001 | v | single-vertex, δ70 | REJECT — clusterCount worse (3→4) |
| FONT-CAL-001 | v | single-vertex, δ150 | REJECT — clusterCount improved (3→2) but SS6 control regressed (1→2); disqualified by the experiment's own rule |
| FONT-CAL-002 | m | contiguous-span widen | REJECT — clusterCount improved (3→1) but via emergent bridging (driving gap grew, 29.2→32.3mm) and SS10 regressed (1→2); marked "not worth further investigation" |
| FONT-CAL-002 | m | contiguous-span straighten | REJECT — same profile as widen; SS10 regression worse (1→2, phrase 3→6) |
| FONT-CAL-002 | m | contiguous-span smooth | REJECT — clusterCount unchanged (3); phrase-level SS10 regression (3→4) with no SS30 gain |
| FONT-CAL-002 | n | contiguous-span widen/straighten/smooth | REJECT — clusterCount unchanged (2) in all 3 classes |

15 of 15 tested variants: REJECT. 0: KEEP. 0: UNKNOWN.

## 5. Side-by-side Studio comparisons

Not produced. There is no surviving experimental variant to compare against original Sacramento —
a comparison would necessarily show two renders of the same, unmodified font file, which would not
answer this milestone's question and would misrepresent the state of the research.

## 6. Production observations

No production-facing change. Original Sacramento (`fonts/sources/Sacramento/Sacramento.ttf`)
remains the only registered Sacramento asset; no `FontManager`/`FontProviderRegistry` entries were
added or modified. Existing projects and the production pipeline are unaffected. Sacramento's
known, already-documented production characteristic stands unchanged: zero stone collisions,
isolated stones, or counter-bearing-floor violations at any tested stone size; SS30 carries
elevated (but non-blocking, WARNING-tier) `clusterCount` fragmentation relative to SS6/SS10 for
several glyphs, per FONT-CAL-001's baseline measurement.

## 7. Visual observations

No new visual evidence was captured, since no experimental font exists to render. The relevant
prior visual evidence (unchanged from FONT-CAL-001/002, not re-verified here): at SS30, "m" and
similar glyphs' connecting strokes visibly break into disconnected fragments at their baseline
valleys, most noticeably in the representative word "movement" (11 clusters at SS30 baseline,
108.5mm). Every attempted outline correction either left this unchanged, made it worse, or fixed it
only through visible glyph distortion (bbox height growth up to +34.5%) or a newly introduced
break at a smaller stone size.

## 8. Would you ship this font?

**NO.**

There is no experimental font to ship. Sacramento in the studio today is unchanged from its
FONT-SOURCE-001-certified state. Prior evidence (FONT-CAL-001, FONT-CAL-002) conclusively rejects
every outline-modification technique attempted against the SS30 fragmentation defect motivating
this line of work — 15 of 15 variants, across two independent techniques (single-vertex and
contiguous-span), fail either to move the target metric at all or introduce a disqualifying
regression when they do. This is not an evidence gap that a demonstration font would help resolve;
it is a settled negative result.

## 9. Recommended next milestone

**FONT-POLICY-001 — SS30 Height Ceiling Policy Study** (already proposed by FONT-DIAG-001 and
reaffirmed by FONT-CAL-002; not started). Height scaling is the only technique with measured,
non-regressing, end-to-end leverage over SS30 fragmentation, but only outside the currently
committed 106–111mm range. The open question is a product/policy one — whether that ceiling can be
raised against real physical printable-region constraints (cross-referencing RS-2010) — not a
further font- or outline-modification experiment, which this and the two prior milestones have now
exhausted for Sacramento.

---

## Compliance notes

- No GeometryEngine, StoneSampler, FontManager, or production pipeline changes.
- No calibration engine or automation built.
- No new branch created; continued on `feature/font-arch-001`.
- No merge performed.
- No files added under `fonts/` — original Sacramento asset untouched.
