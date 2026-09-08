# MONO-012 — Single Chain: OpenType script fonts in the Monogram tool

**Status:** implemented. Branch `feature/mono-012-single-chain` off `develop`.

**Authorises:** letting the Monogram Generator produce letter layers from thin-stemmed OpenType
script fonts (not only the two authored `providerId:'rhinestone'` fonts), sized so each stroke reads
as one continuous bead chain; a new `SingleChain.js` sizing module; a new
`CHAIN_TOO_THIN` failure reason; renaming `authoredProductionFonts()` →
`monogramEligibleFonts()` in `app.js`.

---

## 1. The problem

The Monogram picker offered only RS Block / RS Modern, because `authoredProductionFonts()`
filtered `listFonts()` to `providerId === 'rhinestone'` and `MonogramGenerator.generate()`
hard-rejected any font whose first generated layout was not `sourceMode: 'authored'`. On a mug the
result reads as a wireframe, not jewelry — a script monogram is the common request.

## 2. The finding this milestone acts on

In **outline mode**, a script font sized so its stem is **0.7–1.0 stone diameters** wide produces
one continuous bead chain per stroke — both contour edges of the stroke collapse onto the same
sample positions. Above ~1.3 stones the edges separate into a hollow double line. Measured on Great
Vibes at SS6 (2.0 mm stones), varying letter height so the stem width in stone diameters swept a
range:

| stem width (stone diameters) | result |
|---|---|
| 0.80 | clean single chain (both edges coincide) |
| 1.07 | mostly single, occasional doubling |
| 1.61 | clearly doubled hollow line |

This is **sizing arithmetic**. No new sampling code: `PITCH_MM`, the authored code path, and the
`stoneSizeMm + gapMm` clearance model are all untouched. The `sourceMode !== 'authored'` guard was a
missing branch, not a wrong model.

## 3. `src/monogram/SingleChain.js` — the constants and the arithmetic

```
SINGLE_CHAIN_STEM_RATIO = 0.85   target stem width, in stone diameters
SINGLE_CHAIN_MIN_RATIO  = 0.70   below this the chain thins to visible gaps
SINGLE_CHAIN_MAX_RATIO  = 1.10   above this the chain starts splitting
```

These three govern **outline mode only**; fill / grid modes keep READ-003's `StrokeWidthGate.js`
governance and never touch this module.

```
singleChainHeightMm({ stoneSizeMm, stemWidthRatio }) = 0.85 * stoneSizeMm / stemWidthRatio
stemStones({ heightMm, stoneSizeMm, stemWidthRatio }) = stemWidthRatio * heightMm / stoneSizeMm
minChainStones({ stemWidthRatio })                    = max(0.70, 16 * stemWidthRatio)
```

`stemStones()` is `src/geometry/StemRegime.js:19-21`'s documented identity (*stones across a stem =
R × stemWidthRatio*, where `R = heightMm / stoneSizeMm`), not a new derivation.

### Stone-size invariance

A single-chain letter is sized to `0.85 × stoneSizeMm / stemWidthRatio`, so its height-to-stone
ratio is `0.85 / stemWidthRatio` — **independent of stone size**. It clears
`MIN_HEIGHT_TO_STONE_RATIO` (READ-009, currently 16) exactly when

```
stemWidthRatio ≤ 0.85 / 16 = 0.053125   (MONOGRAM_MAX_STEM_WIDTH_RATIO)
```

Stone size cancels; there is no per-size case to check. Counter-intuitively it is the
*thicker*-stemmed fonts that fail — a thick stem reaches 0.85 stones across at a shorter, less
legible letter.

### Why `MONOGRAM_MAX_STEM_WIDTH_RATIO` is derived where `StemRegime.js`'s bounds are literals

Opposite requirements, deliberately:

- `StemRegime.js` classifies a font into a stroke regime. Its class boundaries (`0.04` / `0.0625`)
  are hard-coded so a font never changes regime when `MIN_HEIGHT_TO_STONE_RATIO` moves — the
  classification exists to be *independent* of the floor.
- `MONOGRAM_MAX_STEM_WIDTH_RATIO` exists to keep the picker's eligible set exactly *in sync* with
  the floor, so a below-floor monogram is structurally unreachable. It **must** shift when either
  `SINGLE_CHAIN_STEM_RATIO` or `MIN_HEIGHT_TO_STONE_RATIO` changes, so it is computed from both.

## 4. Font eligibility — the picker enforces the readability floor

`monogramEligibleFonts()` (renamed from `authoredProductionFonts()`) returns every authored font
plus every enabled font passing `isMonogramEligibleStemWidthRatio()`. Gating the picker — rather
than exempting monogram letters from `textLayersBelowReadableMinimum()` — makes a below-floor
monogram structurally unreachable, so the readability floor never needs an opinion about monograms.
This matters concretely: `MonogramGenerator` emits `type: 'text'` layers and
`textLayersBelowReadableMinimum()` scans every visible text layer, so an ineligible font would seed
a production-sheet warning on every export.

Eligible OpenType set against the current manifest — **9 fonts**, derived at runtime, not
hard-coded:

| font | stemWidthRatio | R at 0.85 chain |
|---|---|---|
| cookie-regular | 0.0456 | 18.6 |
| caveat-regular | 0.0443 | 19.2 |
| dancing-script-regular | 0.0417 | 20.4 |
| cinzel-regular | 0.0398 | 21.4 |
| great-vibes-regular | 0.0357 | 23.8 |
| alex-brush-regular | 0.0309 | 27.5 |
| parisienne-regular | 0.0303 | 28.1 |
| allura-regular | 0.0302 | 28.1 |
| sacramento-regular | 0.0279 | 30.5 |

19 of the 28 enabled non-rhinestone fonts with a finite ratio fail, including 5 script-role fonts:
Pacifico (0.0883), Kaushan Script (0.0722), Mr Dafoe (0.0620), Yellowtail (0.0616), Satisfy
(0.0568). courier-prime-regular (0.0537) fails by a hair.

The picker keeps `groupFontsByCategory()` / `fontCategoryLabel()` exactly as they are — the eligible
set already spans `rhinestone`, `script`, `handwritten` and `monogram` roles, which is adequate
`<optgroup>` labelling. No new two-bucket grouping.

## 5. `MonogramGenerator.generate()` — the OpenType branch

The request gains an optional `stemWidthRatio` (from the `FontManager` record; `app.js`'s
`buildMonogramRequest()` supplies it). Authored fonts ignore it.

- A single cheap probe distinguishes authored (`sourceMode: 'authored'`) from OpenType.
- A non-authored font with a missing/non-numeric `stemWidthRatio`, or one failing
  `isMonogramEligibleStemWidthRatio()`, is rejected `INVALID_FONT` — the message names the field, or
  the measured ratio and the `0.053125` threshold.
- Per eligible OpenType letter:
  - `heightMm = singleChainHeightMm({ stoneSizeMm, stemWidthRatio })`.
  - Generate `mode: 'outline'`, the request's **real `gapMm`** (not the authored-only 0), that
    `heightMm`.
  - **Two-bound fitting.** If the sampled stone bounding box exceeds the slot, shrink `heightMm`
    only — by the min of the two axis ratios — and regenerate. Never grow. At most 6 iterations (the
    outline sampler's fixed per-edge stone halo does not scale with `heightMm`, so one division
    under-shrinks; a few passes converge). Expect this shrink path to be the **normal** path, not an
    edge case: ideal single-chain heights (Great Vibes SS6 wants 47.6 mm; Alex Brush SS10 wants
    77.0 mm) are large relative to typical slots.
  - After fitting, `stemStones` must be ≥ `minChainStones({ stemWidthRatio })`, else fail
    `CHAIN_TOO_THIN`. The message names **which bound bound** — the 0.70 chain minimum or the
    readability floor — plus the font, stone size, achieved ratio, and a suggestion. Why
    `minChainStones` and not the flat 0.70: shrinking lowers `heightMm`, so `R` (and the stem-stone
    count) falls with it; failing at 0.70 alone is sufficient only when `16 × stemWidthRatio < 0.70`
    (`stemWidthRatio < 0.04375`). Cookie (floor binds at 0.7296) and Caveat (0.7088) sit above that.
  - No internal round-trip regeneration (unlike the authored branch, whose round-trip checks that
    `scaleAuthoredTextLayout()` applied via `authoredScale` matches the transform applied directly —
    two genuinely different paths). The fitted layout is already a plain
    `generateTextLayout()` call with the persisted fields, so a second call only re-derives the same
    stones. `tools/test-mono-012-single-chain.mjs` owns the persisted-field round-trip check: it
    rebuilds the params from the emitted layer the way `buildTextLayoutBaseParams()` does, asserts
    stone count and the full bounding box against `measurements.scaledBoundingBox`, and includes a
    **negative control** (regenerating at `height = scaledBoundingBox.heightMm` must *not* match) so
    the assertion can actually catch the bbox-height substitution this milestone was written to
    prevent.
- **Emitted layer:** `height` = the fitted `heightMm` (the geometry input, *not* informational as
  it is for the authored branch, which legitimately still sets
  `height: r.scaledBoundingBox.heightMm`); `textMode: 'stroke'`; **no `authoredScale`**.
- **`heightMode: 'raw'`.** `app.js`'s `buildTextLayoutBaseParams()` passes `layer.height` straight
  through as the engine's em-square `heightMm` regardless of `heightMode` (a TXT-104 UI-display
  concept, not a geometry input), and `singleChainHeightMm()` returns exactly that em-square height —
  so `'raw'` is the value that describes `layer.height` correctly. `'capHeight'` would additionally
  break the Letter Height affordance for the 7 eligible fonts that carry no `capHeightRatio`.
- `measurements.letters[i]` gains `fittedHeightMm` and `stemStones` (both `null` for authored).

The slot-based aspect-ratio derivation (MONO-006E), frame erosion, `MonogramLayouts`, and collision
validation are **unchanged**.

## 6. What is explicitly unchanged

`PITCH_MM`; the authored `scaleAuthoredTextLayout()` / `authoredScale` code path; the
`stoneSizeMm + gapMm` clearance model; `StoneSampler`; `MIN_HEIGHT_TO_STONE_RATIO` (kept at 16 — not
exempted, not moved); `groupFontsByCategory()` / `fontCategoryLabel()`; the authored branch's
`height` semantics; MONO-011's `generateMonogramWithFrameAutoShrink()` (still only retries on
`FRAME_COLLISION` / `STONE_WIDTH_UNAVAILABLE`).

## 7. Tests

`tools/test-mono-012-single-chain.mjs` — arithmetic against hand-computed values, `minChainStones`
bound selection, eligibility (threshold, runtime-derived 9-font set, the 5 rejected scripts, null),
happy path, round-trip, both `CHAIN_TOO_THIN` paths (chain-minimum and floor-bound), missing
`stemWidthRatio`, and an authored byte-identical regression against a pre-branch baseline.
`tools/test-mono-005-headless-monogram-generator.mjs` and `tools/test-mono-006-monogram-ui.mjs`
updated for the widened eligible set.
