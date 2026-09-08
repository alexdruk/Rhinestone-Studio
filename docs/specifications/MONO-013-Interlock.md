# MONO-013 — Interlocked script: one mark, not three boxes

**Status:** implemented. Branch `feature/mono-013-interlock` off `develop` @ `b2f07b0` (local only).

**Authorises:** a fifth monogram layout id `MONOGRAM_LAYOUTS.SCRIPT = 'script'`; a range-based
letter-count map (`MONOGRAM_LAYOUT_LETTER_COUNT_RANGES`) alongside the exact-count one; a separate
`MonogramGenerator._generateScriptMonogram()` branch; an optional `interlockMm` request param;
`measurements.interlockMm` / `measurements.minStoneDistanceMm`; a `#monogramInterlock` "Overlap"
slider shown only for the script layout.

---

## 1. The defect

`computeMonogramLayout()` places each letter in a disjoint rectangular slot with a mandatory
production gap (`minGapMm`), and `MonogramGenerator` emits each letter as its own text layer.
`findCrossGroupCollisions()` then turns any letter-to-letter overlap into a hard `LETTER_COLLISION`.
For a connected script font that is backwards: the Etsy-style monograms this product chases are one
flowing mark whose swashes deliberately cross.

The fix is to stop *placing* script letters at all — set them as a single string using the font's
own advances and kerning, with a negative letter-spacing "overlap" as the crossing control.

---

## 2. Fact A — a joined string is deduped in one sampling call

`MonogramGenerator._generateScriptMonogram()` makes exactly one
`generateTextLayout({ text: letters.join(''), mode: 'outline', letterSpacingMm: interlockMm, … })`
call. Inside `GeometryEngine`:

1. `generateTextLayout()` calls `_textPolygons()` — **`src/geometry/GeometryEngine.js:144`**.
2. `_textPolygons()` → `_buildPositionedContours()` → `_buildLineContours()` —
   **`src/geometry/GeometryEngine.js:507` → `:547`**.
3. `_buildLineContours()` pushes *every* character's contours into one flat array —
   **`src/geometry/GeometryEngine.js:578`** — advancing the pen by `advanceWidthMm` and then by
   `options.letterSpacingMm` between characters (**`:591`**, the interlock control).
4. Back in `generateTextLayout()`, one `sampleShapeFillPoints()` call runs over the whole contour
   set — **`src/geometry/GeometryEngine.js:206`**.
5. For outline mode that dispatches to
   `StoneSampler.sampleMultiContourOutlinePoints(polygons, spacingMm, { minSeparationMm: stoneSizeMm })`
   — **`src/geometry/StoneSampler.js:1492`**.

Cross-letter overlap is therefore just cross-contour overlap inside a single call, which RC-002's
cross-contour dedup already handles. `dedupeStonesByRadius()` is the *cross-layer* counterpart and
is not involved, because the script layout emits exactly one text layer.

`letterSpacingMm` is passed straight through — `normalizeTextParams()` runs it through
`assertFiniteNumber()` (`src/geometry/GeometryEngine.js:1487`) with no clamp — so a negative value
is applied verbatim at the pen advance.

---

## 3. Fact B — the enforced clearance floor drops from `stoneSizeMm + gapMm` to `stoneSizeMm`

**This is an accepted MONO-013 production decision, not an oversight.**

On the per-letter path, the 2.3 mm cross-letter clearance at SS6 / gap 0.3 exists only because
letters are *separate layers*: `MonogramGenerator` feeds `findCrossGroupCollisions()` a synthetic
`d = stoneSizeMm + gapMm` per stone (`src/monogram/MonogramGenerator.js`, the collision-records
step), and that function's shared `(a.d + b.d) / 2` touching threshold then equals
`stoneSizeMm + gapMm`. That check **skips same-layer pairs outright**
(`src/geometry/StoneSampler.js:481`).

Collapsing the mark to one layer removes that synthetic cross-layer floor. What remains is the
sampler's own guarantee: `sampleMultiContourOutlinePoints()` drops any sample within
`minSeparationMm = stoneSizeMm` of a kept one. So a fitted script mark can legally have a closest
pair anywhere between `stoneSizeMm` and `stoneSizeMm + gapMm` apart. **For an interlocked mark that
is correct** — the letters are *meant* to touch.

`_generateScriptMonogram()` therefore **measures** the minimum pairwise stone distance in the
emitted mark into `measurements.minStoneDistanceMm` and **does not gate on it**. The only assertion
is `minStoneDistanceMm >= stoneSizeMm - 1e-6` (what the sampler actually promises); a value below
that — which the sampler is supposed to make impossible — is a hard `INTERNAL_CONTRACT_MISMATCH`
naming the offending pair's coordinates.

**Measured floor.** Great Vibes "AKL", SS6 (2.0 mm stones), gap 0.3 mm, `interlockMm` 0, −2.3 and
+2.3 (re-derived on `develop` @ `b2f07b0`, `tools/scratch/mono-013-*.mjs`): the minimum pairwise
stone distance is **2.002187 mm at all three spacings** — it does not move with `interlockMm`,
because the closest pair sits inside a single glyph and simply translates. It is `stoneSizeMm`
(2.0 mm) plus float noise, i.e. exactly the sampler floor, and comfortably inside the
`[stoneSizeMm, stoneSizeMm + gapMm]` = `[2.0, 2.3]` band Fact B permits. `minStoneDistanceMm` is
therefore **not** evidence about interlock and must not be presented as such; the stone count and
string bounding-box width are (they respond monotonically to the knob: 380 → 372 → 369 stones and
141.10 → 136.50 → 131.90 mm as spacing goes +2.3 → 0 → −2.3).

---

## 4. `interlockMm` range: `[-(stoneSizeMm + gapMm), 0]`

Optional, default `0`. Positive values (spreading letters apart) are rejected with `INVALID_INPUT`
— the opposite of this milestone.

The **lower bound is exactly `-pitchMm`** (`pitchMm = stoneSizeMm + gapMm`), and the reason is
READ-006's silent-clamp behaviour, not an aesthetic choice:

- The emitted text layer persists the overlap as `layer.letterSpacing`.
- `letterSpacingBoundsMm()` (`app.js:616`) sets `minMm = -pitchMm`.
- `writeSelectedControlsToLayer()` (`app.js:2175`) clamps `l.letterSpacing` to that range on
  **every** text-control write, **with no undo entry** — the exact silent-clamp failure READ-006's
  own comment at `app.js:605-612` describes.

Any `interlockMm` below `-pitchMm` would therefore be silently pulled back up to `-pitchMm` the
first time the user touched any text control on the generated layer — the monogram would
un-interlock itself. Constraining the generator's input to `[-pitchMm, 0]` keeps the persisted
value permanently inside the clamp.

The `#monogramInterlock` slider mirrors this: its `min` is `-pitchMm` computed from the monogram
Stone Size control plus the gap the generator applies to a monogram
(`AUTHORED_FONT_FITTING_GAP_MM` = 0.3, pinned into `request.gapMm` for the script layout by
`buildMonogramRequest()` so the two never drift), refreshed whenever the stone size changes —
mirroring `refreshLetterSpacingFieldBounds()` for the live text control.

---

## 5. Reachable configurations

Single-chain height scales with stone size (`singleChainHeightMm = SINGLE_CHAIN_STEM_RATIO *
stoneSizeMm / stemWidthRatio`), but the frame does not: the `none` frame — the default for script
fonts — is capped at **150 mm** (`COMMON_SCALING_LIMITS_MM`, `src/geometry/FrameLibrary.js:142`,
applied to the Frame Size fields at `app.js:5041-5050`; not enforced inside the generator, which is
why a headless test *can* pass a larger frame). So the larger the stone, the taller — and wider —
the mark the fit must accommodate, against a fixed ceiling.

The shrink-only fit may reduce the mark to at most
`minChainStones({ stemWidthRatio: 0.0357 }) / SINGLE_CHAIN_STEM_RATIO` = `0.7 / 0.85` =
**`0.8235294117647058`** of its ideal height before `CHAIN_TOO_THIN` (`minChainStones` is `0.7`
here — the flat single-chain minimum, since `16 * 0.0357 = 0.5712` is smaller;
`SINGLE_CHAIN_STEM_RATIO` is `0.85`). The minimum fitting region is therefore
`naturalRawWidthMm * 0.8235294117647058 + stoneSizeMm`, where `naturalRawWidthMm` is the raw
point-spread (un-padded) of the mark at its ideal single-chain height.

Minimum frame width, Great Vibes, `interlockMm: 0` (re-derived on `develop` @ `b2f07b0`,
`tools/scratch/mono-013-reachable.mjs`):

| letters | SS6 (2.0) | SS10 (2.8) | SS16 (3.8) | SS20 (4.7) |
|---|---|---|---|---|
| "A"   | 35.14  | 49.14  | 66.79  | 82.63  |
| "AK"  | 93.74  | 131.45 | 178.66 | 221.43 |
| "AKL" | 112.77 | 157.87 | 214.29 | 265.13 |

Against the 150 mm cap: **three-letter script is an SS6-only configuration today** (reachable in a
~113–150 mm window); at SS10 and above it is structurally impossible with `none`. Two-letter script
fails from SS16 up. This follows from the design — it is a limitation to know about, not a defect to
fix in this milestone. `CHAIN_TOO_THIN`'s message already advises "a smaller stone size, a larger
frame, or fewer letters"; a future milestone could tie the interlock fit to the frame cap or offer
a taller `none` region for script.

---

## 6. What the script layout does and does not do

`MONOGRAM_LAYOUTS.SCRIPT` produces **one** slot equal to `frameInteriorRect` (`targetHeightRatio`
1, `xOffsetMm`/`yOffsetMm` 0, `drawOrder` 0). It performs no slot arithmetic and ignores
`minGapMm`, exactly as the Single layout already does. Letter count is a range, `1–3`
(`MONOGRAM_LAYOUT_LETTER_COUNT_RANGES`); out-of-range counts return the existing
`UNSUPPORTED_LETTER_COUNT`.

Fitting is shrink-only against that single slot, the same iteration shape as MONO-012's per-letter
OpenType loop, including the `stemStones()` / `minChainStones()` gate and its `CHAIN_TOO_THIN`
failure (whose message names the string, not a letter/slot). Authored (stone-center) fonts are
rejected with `INVALID_FONT` — the script layout is outline-only. The emitted layer id keeps the
existing deterministic convention `monogram-${frameId}-${layoutId}-letter-0`; the duplicate-id
defect in `docs/BACKLOG.md` is its own milestone and is not touched here.

**Out of scope, deliberately:** middle-letter emphasis (the traditional larger centre initial). A
script mark is one continuous stroke system at one size; a per-letter emphasis axis would
reintroduce the per-letter placement this layout exists to remove. If it is ever wanted it is a
separate milestone with its own DSL.
