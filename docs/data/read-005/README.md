# READ-005 / READ-005A measurement archive

These five files are the measurement artifacts behind
`docs/specifications/READ-005A-CalibrationFindings.md` — the two blind human rating sets, their two
held-back keys, and the F+A ladder those sets were drawn from.

They were moved here because `tools/font-certification/output/` is gitignored (`.gitignore:54`), and
210 human ratings are not reproducible. Losing them loses the finding.

## These are copies, not the working files

`tools/font-certification/tracking-renders.mjs` reads `calibration-key.json` and `ratings.csv` from
`tools/font-certification/output/read-005/`. That path is still canonical for tooling. This directory
is the archive of record — the copies are byte-identical (see the manifest below) but nothing reads
them.

The PNG render sets (`calibration-renders/`, `tracking-renders/`) are **not** archived — they are
deterministically regenerable (see below) and large.

## Files

### `ratings.csv` — session 1, 135 data rows

- Producer: the calibration blind rating page (HTML built for the calibration render directory; the
  tracked builder is `tools/font-certification/make-rating-page.mjs`), "Download CSV" button.
- Consumer: `tools/font-certification/tracking-renders.mjs` (`loadRatings()` / `categorise()`),
  which uses it to select the session-2 cases.
- Columns: `slug,readable,sellable,notes`.
  - `slug` — the 8-hex render id (the key back into `calibration-key.json`).
  - `readable` — one of `yes`, `struggle`, `no` (may be blank if unrated).
  - `sellable` — one of `yes`, `no` (may be blank if unrated).
  - `notes` — free text; per session-1 practice, used only to record why a render failed.

### `tracking-renders-ratings.csv` — session 2, 75 data rows

- Producer: the tracking blind rating page built by `tools/font-certification/make-rating-page.mjs`
  (storage key and CSV name are keyed on the render directory basename, so it cannot collide with
  the session-1 slot), "Download CSV" button.
- Consumer: the READ-005A analysis (session-2 paired-render results); no script reads it back.
- Columns: identical to `ratings.csv` — `slug,readable,sellable,notes`; `slug` keys into
  `tracking-key.json`.

### `calibration-key.json` — session 1 blind key

- Producer: `tools/font-certification/calibration-renders.mjs`.
- Consumer: `tools/font-certification/tracking-renders.mjs` (`CALIB_KEY_FILE`).
- Shape: `{ "<slug>": { fontId, mode, heightMm, stoneSizeId, ratio, text, block, separationRatio,
  separationBand, repeatOf } }`.
  - `block` — one of `interior-fill-positives`, `f-heldout-validation`, `joined-scripts`,
    `non-script-outline`, `repeats`.
  - `separationRatio` — `clusterCount / expectedComponents`, or `null`.
  - `separationBand` — `merge` (< 0.65), `aligned` ([0.65, 1.35)), `fragmented` (>= 1.35), or `null`.
  - `repeatOf` — the source slug when `block` is `repeats`, else `null`.

### `tracking-key.json` — session 2 blind key

- Producer: `tools/font-certification/tracking-renders.mjs`.
- Consumer: the READ-005A analysis; no script reads it back.
- Shape: `{ "<slug>": { fontId, mode, heightMm, stoneSizeId, ratio, text, block, letterSpacingMm,
  letterSpacingXPitch, separationRatioBefore, separationRatioAfter, separationAchieved, widthMm,
  widthGrowthPct, pairedWith, repeatOf, originalSlug } }`.
  - `block` — one of `paired-tracked`, `paired-control`, `specificity`, `harm`, `repeats`.
  - `letterSpacingXPitch` — the applied `letterSpacingMm` as a multiple of `stoneDiameterMm + gap`.
  - `separationRatioBefore` / `separationRatioAfter` — the F ratio at zero tracking and at the
    applied tracking.
  - `separationAchieved` — whether `separationRatioAfter >= 0.95`.
  - `widthGrowthPct` — bounding-box width growth from the applied tracking, percent.
  - `pairedWith` — the other member's slug for `paired-tracked` / `paired-control`, else `null`.
  - `repeatOf` — the source slug when `block` is `repeats`, else `null`.
  - `originalSlug` — the underlying calibration case this item derives from.

### `f-ladder.json` — the free F+A ladder

- Producer: `tools/font-certification/f-ladder.mjs`.
- Consumer: `tools/font-certification/calibration-renders.mjs` (`F_LADDER_FILE`), which builds its
  candidate pools from the completed cells.
- Shape: `{ meta, cells }`.
  - `meta` — `{ harnessVersion, fSeparationThreshold, texts, modes, denseStoneSizeId, denseTopRatio,
    denseStep, coarseRatios, coarseStoneSizeIds, excludedFont, derivedSchema, startedAt, updatedAt,
    finishedAt }`. This archive: `harnessVersion` `read-005.1`, 140 cells.
  - `cells` — keyed `"<fontId>::<mode>"` (28 fonts × 5 modes). Each cell:
    `{ fontId, mode, providerId, stemWidthRatio, ladderStart, dense[], coarse[], complete, monotone,
    monotoneByText, worstSeparationDrop, lowestPassingRatio, floorRatio, floorNote, neverPasses,
    floorDisagreesWithLowestPassing, elapsedSec, plateauRatio, derivedSchema }`.
  - Each rung of `dense[]` (ss10, ratio from `ladderStart` to 32.0 in 0.5 steps) and `coarse[]`
    (5 stone sizes × ratios `[10, 12.5, 15, 18, 21, 24, 28, 32]`):
    `{ ratio, stoneSizeId, heightMm, byText }`, where
    `byText["<text>"] = { clusterCount, expectedComponents, separationRatio, signalA, stoneCount,
    error, separationBand }`.

## Determinism

Both render sets are deterministically seeded:

- `calibration-renders.mjs` — `mulberry32(0x05a2_2026)` drives block selection and slug assignment.
- `tracking-renders.mjs` — `mulberry32(0x05a3_2026)` drives selection, slug assignment, and the
  emission-order repair that keeps pair members >= 15 positions apart.

So both keys are reproducible from `f-ladder.json` (calibration) and from `f-ladder.json` +
`calibration-key.json` + `ratings.csv` (tracking). `f-ladder.json` is archived alongside the keys
for exactly this reason.

## SHA-256 manifest

Computed at archive time (Step 1 of the READ-005A milestone); the same digests hold for the working
copies under `tools/font-certification/output/read-005/`.

```
e589c96de9d5a466ea8a5c5254f18160fa5d8d7c737a270ee56f978fb428c2e2  ratings.csv
dd11798f62265e642a668299fdf72089e9d7cde67b3ab0287affa67d1656468c  calibration-key.json
99b6fb66a0366efb03ba6ba4f6828415be1e713a608a4cc21235df395a6a7e55  tracking-renders-ratings.csv
1ba243363adaa6a7ef74c2f6381bcc52a725d859be45ea2b3ec0b64ad531a69a  tracking-key.json
85d996d66678dc88e35dacd4457d9cea2321a1f6cc84fcbb85a6a7789c02ba2d  f-ladder.json
```
