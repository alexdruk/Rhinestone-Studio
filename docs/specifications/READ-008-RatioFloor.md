# READ-008 — Ratio floor, expressed in stone diameters

**Status:** implemented. Branch `feature/read-008-ratio-floor` off `develop`, local-only (not pushed).

**Authorises:** re-expressing `app.js`'s single readability floor against stone diameter instead of
stone pitch, and setting its value. See [`READ-007-RatioFloorEvidence.md`](READ-007-RatioFloorEvidence.md)
for the calibration evidence this milestone acts on, and its §7 for why the two were split into
separate milestones.

---

## 1. The change

`MIN_AUTOFIT_HEIGHT_TO_SPACING_RATIO = 6` (`app.js:534`, pre-milestone) was measured against
`spacingMm = stoneSize + gap` — the physical stone *pitch*, a quantity that drifts with a field
(`gap`) that has nothing to do with legibility. It is renamed `MIN_HEIGHT_TO_STONE_RATIO`,
re-expressed against **stone diameter alone**, and set to **16**.

`MIN_HEIGHT_TO_STONE_RATIO = height ÷ stoneSize`, where `height` is always `layer.height`, the raw
engine height GeometryEngine consumes — never a cap-height-mode display value (`heightMode` is a
labelling concept only; see READ-007 §1). Five call sites move together, all sharing this one
constant so the floor cannot mean two different things in two different places:

- **`computeAutoFitScale()`** (`app.js`) — `minScale` now reads `layer.stoneSize` alone; `layer.gap`
  is no longer consulted anywhere in the function.
- **`ShapeFit.computeShapeFitScale()`** (`src/geometry/ShapeFit.js`) and its one caller,
  **`fitTextToShape()`** (`app.js`) — the `spacingMm`/`minHeightToSpacingRatio` parameters are
  renamed `stoneSizeMm`/`minHeightToStoneRatio`, and the call site now passes the stone diameter
  alone. Leaving the pitch here would have silently given Fit-to-Shape a floor of
  `16 × pitch ≈ 17.8` stone diameters at the default 2.8 mm stone / 0.3 mm gap — a different,
  undocumented threshold from every other consumer of the same constant.
- **`textHeightBelowReadableMinimum()`** (`app.js`) — previously fired only when
  `findStoneSizeByDiameterMm(layer.stoneSize)` resolved to a catalog entry, so any non-catalog
  diameter (a legacy project, a hand-typed value) escaped the warning entirely. It is rebased to
  `heightMm < stoneSizeMm × MIN_HEIGHT_TO_STONE_RATIO`, so it now fires at *any* diameter. The
  authored-Production-Font exemption (RS Block / RS Modern have their own baked-in stone pitch and
  no `supportedHeightRangeMm` concept) is unchanged. `updateTextHeightReadabilityUI()`'s message no
  longer names a catalog size (`size.name`, `supportedHeightRangeMm[0]`) since there may be none —
  it now states the stone diameter and the minimum height that diameter needs. Precedence against
  READ-003's stroke gate and the FONT-LIB-003 crowding hint is unchanged (stroke > height > crowding).
- **`defaultProject()`** (`app.js`) — `height: 25 → 45`. Verified render-identical in the browser:
  RS Block is an authored, fixed-pitch font, so `heightMm` is a no-op for it — the default project's
  157 stones are unchanged at height 25, 45, and 60. The new value is chosen so the stored project is
  ratio-coherent with its own 2.8 mm default stone (45 ÷ 2.8 = 16.07, just above the floor) rather
  than for any rendering reason.
- **`addText()`** (`app.js`) — the fixed `height: 25` is replaced with
  `inheritedStoneSize × MIN_HEIGHT_TO_STONE_RATIO`, using the same `stoneSize` the line already
  inherits from the currently-selected layer. A newly created text layer is now never born below the
  floor, regardless of which stone size it inherits.

## 2. Why 16, not 20

READ-007 §8 found a ratio-20 lower bound *supported* by the calibration set: zero sellable renders
below ratio 20, surviving both the merge-band and offered-mode confound checks. But it also found the
set cannot locate the floor any more precisely than that — every ratio below 20 is a uniform zero in
the calibration data (§4.3: `offeredModesExcludingMerge` holds 0 rows below ratio 18 and 1 below
ratio 20), so **the data cannot distinguish 15 from 20 as the true floor.** Nothing in this document
or in the source comments it produced claims otherwise; 16 is not read off the calibration.

16 is chosen on independent evidence instead: `StoneSizes.js`'s five catalog sizes each carry a
human-rating-derived `supportedHeightRangeMm` (FONT-DECISION-001 / FONT-PORTFOLIO-001's own
validation program, unrelated to READ-005/007's calibration set). Each size's minimum implies a
height-to-diameter ratio:

| Size | `diameterMm` | `supportedHeightRangeMm[0]` | implied minimum ratio |
|------|-------------:|-----------------------------:|-----------------------:|
| SS6  | 2.0 | 35  | 17.50 |
| SS10 | 2.8 | 45  | 16.07 |
| SS16 | 4.0 | 65  | 16.25 |
| SS20 | 4.7 | 80  | 17.02 |
| SS30 | 6.4 | 106 | 16.56 |

Five independently derived minima — from a different rating program, at five different physical
scales — converge on **16–17.5**. A floor of 20 would put SS30's entire validated range
(`106–111mm ÷ 6.4mm = 16.56–17.34`) permanently in warning: every height that program certified as
good for the largest stone would trip the new floor. 16 is the largest value that does not contradict
that program's own findings.

**16–20 remains an unresolved band.** READ-007 supports 20 as a safe upper bound; this evidence
supports 16 as the highest value consistent with the certified catalog. Nothing here locates the true
boundary inside that range, and nothing in this milestone's source comments or messaging claims to.

## 3. What was verified, not assumed

- **Blast radius on the example fixture set.** `tools/test-read-008-ratio-floor.mjs` extracts the
  real `computeAutoFitScale()` from `app.js` (the `new Function` idiom already established by
  `tools/test-text-position-workflow.mjs`) and drives it, with real
  `permanentEngine.generateTextLayout()` widths, against every `examples/*.rhs` fixture. Exactly two
  of the fixture set's autoFit text layers change scale:

  | Fixture | Text | Before (ratio 6 × pitch) | After (ratio 16 × diameter) |
  |---|---|---:|---:|
  | `long-name-autofit.rhs` | "Alexandria Konstantinova" | 0.463050 | 0.960000 |
  | `long-script-name.rhs` | "Anastasiya Konstantinovna Volkova" | 0.648922 | 0.923077 |

  Every other fixture's auto-fit scale is byte-identical before and after (asserted directly, not
  inferred from a passing baseline diff).
- **`defaultProject()`'s render-identity claim**, checked live in a real browser (not asserted from
  reading the source): the default project's RS Block text layer produces exactly 157 stones at
  `height` 25, 45, and 60mm alike.
- **The new readability message**, checked live: at a 4mm stone and 40mm height (below the 64mm
  floor for that diameter), `#heightBelowReadableWarning` reads *"At 4 mm stones, text this short
  (40 mm) won't read clearly — 64 mm or taller is the minimum for this stone diameter. Use a taller
  text height or a smaller stone size."* — and clears once height crosses 64mm.

## 4. Follow-ups (not fixed here)

1. **`src/gallery/RhsFixtureBridge.js`'s `generateTextStonesForLayer()` reimplements auto-fit with no
   floor at all** (`app.js`'s own comment at that call site already flags this as a known gap). It is
   the code path both the Gallery and `tools/test-examples-regression.mjs`'s baselines run through,
   so `examples/*.rhs` fixtures never see this floor, or any floor, today. Out of scope here per the
   milestone brief; a future milestone should add the same `MIN_HEIGHT_TO_STONE_RATIO` floor there.
2. **`long-name-autofit.rhs` and `long-script-name.rhs`** — the two fixtures §3's table names — are
   both registered Gallery fixtures (`examples/gallery.json`, `examples/manifest.json`). They are
   unaffected today only because of follow-up 1. Once that gap closes, both fixtures' generated
   layout (and `examples/baselines.json` entries) will change and need re-authoring/re-baselining at
   that time.

## 5. Explicitly not changed

`src/gallery/RhsFixtureBridge.js` and `examples/baselines.json` — see §4. `docs/specifications/S-107-LongTextReadability.md`,
`READ-006-LetterSpacing.md`, and `TXT-103A`/`TXT-104` keep their original prose naming
`MIN_AUTOFIT_HEIGHT_TO_SPACING_RATIO`; they are historical records of what was true when written, not
live documentation, and are left as-is.
