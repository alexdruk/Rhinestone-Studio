# READ-011B — Rating pass design (render plan)

**Status:** implemented. Branch `feature/read-011b-render-plan` off `develop`.

**Authorises:** a new planner `tools/font-certification/read-011-plan.mjs`, the tracked design file
`docs/data/read-011/render-plan.json` it writes, the test `tools/test-read-011b-render-plan.mjs`,
and this record. No product code, no renders, no geometry. The planner imports
`src/geometry/StemRegime.js` and reads `assets/fonts/manifest.json`; it does not touch Playwright or
`GeometryEngine`.

**Does not authorise:** any render, any re-rating session, any change to `app.js`,
`src/geometry/TextAutoFit.js`, `src/geometry/StemRegime.js`, `MIN_HEIGHT_TO_STONE_RATIO`, or
anything under `docs/data/read-005/`. The render milestone and the floor decision are separate
milestones, each gated on this plan.

---

## 1. Purpose

READ-011A gave every measured font a stroke regime (`monoline` / `transitional` / `massed` /
`unmeasured`) so a later milestone can replace the single `MIN_HEIGHT_TO_STONE_RATIO = 16` floor
with a per-regime floor. That milestone needs human ratings across the ratio band where the floor
would sit. This document fixes **what gets rendered and rated**, as data, before anything is drawn.

The plan is frozen as `docs/data/read-011/render-plan.json` and kept out of the gitignored
`tools/font-certification/output/` tree for the same reason READ-005's measurement archive was
moved under `docs/data/`: an experimental design that only exists as re-derivable output is a design
that gets silently re-cut between sessions. `read-011-plan.mjs` regenerates the file deterministically
from `SEED` (recorded in `meta.seed`); `test-read-011b-render-plan.mjs` pins its invariants.

## 2. The main grid — a full factorial

| Factor | Levels | n |
| --- | --- | --: |
| stem regime | monoline, transitional, massed | 3 |
| mode | outline, fill | 2 |
| ratio rung | 16, 17.5, 19, 20.5, 22 | 5 |
| tracking target | none, separation | 2 |

3 × 2 × 5 × 2 = **60 cells**, **two fonts per cell**, drawn from that regime's pool → **120
main-grid renders**. All at SS10 (2.8 mm). `heightMm = ratio × 2.8`, i.e. 44.8 / 49.0 / 53.2 / 57.4
/ 61.6 mm — every rung inside the engine's 4–111 mm bound
(`app.js` `RAW_ENGINE_HEIGHT_MM_MIN/MAX`).

Two fixed texts, *Vitalina* and *Emmanuel*, alternate across the grid so no font/mode/rung cell is
confounded with a single string.

### Why each factor is present

**Stem regime** is the axis the future floor depends on (READ-011A §1–3). The grid crosses it so the
rating data can show whether the floor should differ by regime at all, and where each regime's
boundary sits. Fonts are drawn from each regime's full enabled-and-measured pool
(`meta.strata[].pool`), seeded and balanced so every pool font appears
`floor(40 / poolSize)`–`ceil(40 / poolSize)` times within its regime — no font carries a stratum.

**Mode** — outline and fill are the two text modes the product still offers after READ-006A. READ-007
§8 already found the floor behaves differently in the two (`offeredModesExcludingMerge` could not
even locate a merge-free floor between ratio 18 and 22). Both must be sampled.

**Ratio rung** — five rungs spanning 16 to 22. 16 is the current floor; 22 is READ-007's first
informative merge-free cut. The band in between is where READ-007's evidence ran out
("the calibration set is nearly empty" between ratio 18 and 22), so this is exactly the interval the
rating pass has to populate.

Note: rung 16 at SS10 is 44.8 mm, **just below** SS10's own `supportedHeightRangeMm` minimum of 45
(`src/renderer/StoneSizes.js`). That is expected and intentional — the entire floor region under
investigation sits below the FONT-DECISION-001 validated range. The plan records this in
`meta.notes.ratio16Floor`.

**Tracking target** is a *blocked* factor — see §3.

## 3. Why tracking is blocked, not held constant

READ-005 session 2 rendered each crowding-rejected case twice, once at zero tracking and once at the
lowest `letterSpacingMm` reaching a separation ratio ≥ 0.95, with pair members ≥ 15 positions apart
(`docs/specifications/READ-005A-CalibrationFindings.md` §3). Over the 22 evaluable pairs:

| | n |
| --- | --: |
| tracked sellable, control not | **8** |
| tracked not, control sellable | **0** |
| both | 3 |
| neither | 11 |

McNemar exact two-sided **p = 0.0078** (b = 8, c = 0). Tracking flipped 8 of 22 paired renders from
not-sellable to sellable and reversed none.

That result forces the blocking:

- **Sampling at zero tracking alone** reproduces READ-007's confound. READ-007 §8 showed the sub-20
  ratio band in the calibration set was drawn entirely from crowding-prone blocks, so "nothing below
  ratio 20 was sellable" is partly a statement about crowding, not height. Zero-tracking renders
  carry that crowding, so a floor fit to them alone is again measuring crowding under a different
  name.
- **Sampling at achieved separation alone** describes text the product does not produce by default.
  `letterSpacingMm` has no UI control and is zero in every design in the product's history
  (READ-005A §3). A floor fit only to separated renders would not describe the text real projects
  contain.

So both tracking targets are levels of a crossed factor, and the future floor can be read at each.

`trackingTarget: "separation"` in the plan is an **intent, not a value**. This planner computes no
`letterSpacingMm`. The render milestone resolves the actual spacing that reaches
`separationRatio ≥ 0.95` per render and records the achieved values in its own key file
(`meta.notes.trackingTarget`, `meta.separationTargetRatio`).

## 4. The three additional blocks

### 4.1 Size invariance (12 renders)

Ratio 19, both modes, `none` tracking, **one font per regime**, rendered at SS16 (4.0 mm) and SS20
(4.7 mm). The planner forces that font into the rung-19 / `none` cells of both modes in the main
grid, so every size-invariance render has a direct SS10 counterpart already present (same font,
mode, rung). `heightMm = 19 × diameter` → 76.0 mm (SS16) and 89.3 mm (SS20), both inside the engine
bound.

The floor is expressed as a ratio; this block is the check that a ratio genuinely transfers across
stone sizes rather than standing in for an absolute millimetre height.

### 4.2 Rhinestone probe (12 renders) — a separate stratum

`rs-block` and `rs-modern` at rungs 16 / 19 / 22, both modes, `none` tracking, SS10.

These classify as `unmeasured` (READ-011A §5): every stone position is authored on a fixed pitch,
there is no outline to measure a stem from, so `stemWidthRatio` is undefined and they **cannot be
pooled with the stem-regime strata**. But `rs-block` is the default Production Font, and a
readability floor with no evidence for the default font is not shippable. The probe is marked as its
own stratum in `meta.strata` (`kind: "unmeasured"`), kept deliberately small, and analysed on its
own terms — the future authored-pitch floor rule for these fonts (READ-011A §5) is a different
milestone.

### 4.3 Repeats (15 renders)

A seeded selection of main-grid entries, duplicated under fresh slugs with `repeatOf` pointing back
at the source, mirroring READ-005's 15-render repeats block. These are not identified to the rater
and give a within-session self-consistency number to set against any effect the pass reports
(READ-005A measured ~13% sellable self-inconsistency this way).

## 5. SS30 is excluded

SS30's entire FONT-DECISION-001 validated height range is `[106, 111]` mm at a 6.4 mm stone —
ratio **16.56 to 17.34**. The whole band under test here is ratio 16 to 22. SS30 cannot vary across
that band: at most one rung (16 or 17.5) even lands inside its validated range, and nothing above
17.34 is reachable. It contributes no gradient to a floor fit, so it is left out of every block.
(This is the same size that FONT-PORTFOLIO-001 disabled per-font for Anton / Sacramento /
Dancing Script, and whose narrow height ceiling FONT-POLICY-001 flagged as an unresolved root
cause.)

## 6. Recorded fields

`render-plan.json` is `{ meta, entries }`. Every entry carries exactly:

`slug` (unique 8-hex) · `fontId` · `stemRegime` · `stemWidthRatio` (number, or `null` for the
unmeasured probe) · `mode` · `ratio` · `stoneSizeId` · `stoneDiameterMm` · `heightMm` (`= ratio ×
stoneDiameterMm`) · `text` · `trackingTarget` · `block` (`main` / `size-invariance` /
`rhinestone-probe` / `repeats`) · `repeatOf` (`null` outside the repeats block).

`meta` records the seed, the stem-regime boundary literals, the engine height range, the main-grid
factor levels, the per-stratum pools, the per-regime size-invariance font, and the per-block counts.

## 7. Totals

| Block | Renders |
| --- | --: |
| main grid | 120 |
| size invariance | 12 |
| rhinestone probe | 12 |
| repeats | 15 |
| **Total** | **159** |
