# MONO-015 — Weight-following stone size (opt-in)

**Status:** implemented. Branch `feature/mono-015-weight-sizing` off `develop` @ `87e20a5` (local
only).

**Authorises:** a third text-layer `sizeMode`, `'weight'`; two flat persisted layer fields
`weightMinSizeMm` / `weightMaxSizeMm`; `src/geometry/StrokeWidthProbe.js` and
`src/geometry/WeightSizing.js`; `StoneSampler.dropOverlappingSizedStones()`; a `#weightMinSize` /
`#weightMaxSize` inspector pair and a `weight` option on `#sizeMode`; a `#monogramWeightSizing`
checkbox; per-assignment generalisations of MONO-012's `CHAIN_TOO_THIN` gate and MONO-013's
clearance assertion.

---

## 1. The problem

Hand-placed rhinestone script uses larger stones on the wide parts of a stroke and smaller stones on
the hairlines. The app places one size everywhere. S-200's `sizeMode: 'mixed'`
(`src/geometry/MixedSizeGenerator.js`) is a gap filler — it adds *smaller* stones into leftover
space and never touches the primary stones — not a stroke-weight follower, so it does not produce
this look.

MONO-015 adds a third size mode. It is **opt-in everywhere**: no existing layer, project, fixture or
monogram changes behaviour unless a user explicitly turns it on. `resolveSizeMode()` still falls
back to `'uniform'` for any unknown/missing value.

---

## 2. Probe geometry — `src/geometry/StrokeWidthProbe.js`

Pure geometry, no engine/font/renderer/catalog dependency. Input is the same flattened millimeter
`Point2D[][]` every `StoneSampler.js` function already consumes.

`localStrokeWidthMm(point, inwardNormal, polygons, maxMm)` casts a ray from `point` along the unit
vector `inwardNormal` and returns the distance to the first crossing of any contour edge, excluding
the edge the point lies on (`t <= 1e-6` rejected), capped at `maxMm`. Returns `maxMm` when nothing
is crossed within `maxMm`.

`strokeWidthsForSamples(samples, polygons, maxMm)` is the per-sample driver for outline samples
(which lie *on* the contours). For each sample it takes the four nearest contour edges, derives an
inward normal from each edge's tangent — rotated 90° and oriented by the containing contour's signed
area, so a glyph counter (which winds opposite its outer contour) probes toward the stroke body, not
into the hole — and returns the tightest crossing. A short nudge/point-in-polygons check corrects
the normal sign if the flatten output's winding does not follow the assumed convention. Trying the
nearest few edges (not just one) reads the true cross-width at stroke terminals, where a single
end-cap normal would run down the stroke's length and over-read; a directed probe that finds no
opposite wall at all falls back to twice the straight-line distance to the nearest non-coincident
edge, never the maximum size.

---

## 3. Size mapping — `src/geometry/WeightSizing.js`

`weightSizeMm(widthMm, minMm, maxMm)` — the smallest catalog diameter `>= widthMm` (the largest
catalog diameter if `widthMm` exceeds all of them), then clamped into `[minMm, maxMm]`. The five
catalog diameters (`[2.0, 2.8, 4.0, 4.7, 6.4]`) are hand-mirrored from
`src/renderer/StoneSizes.js` — `src/geometry/**` never imports the renderer — and
`tools/test-mono-015-weight-sizing.mjs` cross-checks the mirror against `listStoneSizes()` on every
run.

**Which single-chain bound this rule enforces, and which it does not.** A stone at least as wide as
the stroke keeps both contour edges of that stroke collapsed onto one chain, so the rule enforces
the **upper** single-chain bound — `SINGLE_CHAIN_MAX_RATIO` (1.10, `SingleChain.js:23`), the ratio
at which a stem starts splitting into two chains. It does **not** enforce the **lower** bound: on a
hairline far narrower than `minMm` the assigned stone is floored at `minMm`, so stones-across-stem
there falls well below `SINGLE_CHAIN_MIN_RATIO` (0.70, `SingleChain.js:22`) — the ratio the constant
names as where a chain thins into visible gaps. Weight sizing keeps the stem solid where the stroke
is at least `weightMinSizeMm` wide and floors the rest at `weightMinSizeMm`; it does not claim to
preserve the single-chain condition on sub-`weightMinSizeMm` hairlines.

`defaultWeightMaxSizeMm(baseStoneSizeMm)` is the default a first enable applies to
`weightMaxSizeMm`: two catalog steps above the layer's current stone size, **clamped to the
catalog's largest entry** — SS20 has only one step above it and SS30 none, so the clamp is
load-bearing.

---

## 4. Flat persisted fields

`weightMinSizeMm` / `weightMaxSizeMm` are stored **flat** on the layer, following
`mixedSizeParamsFor()`. They are deliberately **not** S-200's `minSizeMm` / `maxSizeMm`: those
belong to `'mixed'`, and a layer that has switched modes would round-trip ambiguously if the two
modes shared fields. No nested `weightOptions` is persisted — the engine produces the nested bundle
at its own boundary, exactly the way `normalizeMixedSizeParams()` does for `mixedOptions`
(`MixedSizeGenerator.js`).

Defaults on first enable: `weightMinSizeMm` = the layer's current `stoneSize`; `weightMaxSizeMm` =
`defaultWeightMaxSizeMm(stoneSize)`.

Valid only for a text layer sampled in outline mode. `GeometryEngine.generateTextLayout()` throws a
descriptive error (in the style of the `curveEnabled` throw at `GeometryEngine.js:159`) for
`weight` + fill mode and for `weight` + an authored stone-center font. A stray `sizeMode: 'weight'`
on a non-text layer is coerced to `'uniform'` by `normalizeMixedSizeParams()` (its `allowWeight`
option is only passed by `normalizeTextParams()`), so a hand-edited project never throws on a shape
layer — it simply renders as it did before MONO-015.

---

## 5. Sampling — three phases, in this order

The order is the opposite of the obvious one, and it matters: sampling at the largest pitch first
would leave phase C nothing to drop, which is a check that cannot fail.

* **Phase A — sample, then oversample.**
  `oversampleFactor = weightMaxSizeMm > weightMinSizeMm ? 2 : 1`;
  `sampleShapeFillPoints('outline', polygons, boundingBox, (weightMinSizeMm + gapMm) /
  oversampleFactor, weightMinSizeMm / oversampleFactor)`.

  Why oversample. Phase C only ever *drops*, so a survivor sits at an integer multiple of the
  phase-A pitch. At the plain min pitch (2.3 mm for SS6 / 0.3 gap) a 2.8 mm stone assigned to a
  2.3-pitched run ends up 4.6 mm from its neighbour — **48 % over** its own 3.1 mm `d + gap` ideal,
  which is the `SINGLE_CHAIN_MIN_RATIO` (`SingleChain.js:22`) gap-failure mode: the middle of the
  catalog comes out systematically over-spaced. Halving the phase-A pitch drops the quantisation
  step to 1.15 mm, so a 2.8 mm run lands ≈ 3.45 mm (+11 %) and a 4.0 mm run ≈ 4.6 mm (+7 %) — both
  inside a 15 % tolerance. **Both** the walk step *and* the separation floor must be divided:
  lowering only the step does nothing, because `sampleMultiContourOutlinePoints()` re-quantises any
  point closer than `minSeparationMm` straight back to 2.3.

  The factor is **1** when `weightMinSizeMm === weightMaxSizeMm`. Every stone is then one size, so
  phase A at the min pitch is already exact and oversampling buys nothing — and pinning it to 1
  keeps the reduction-to-uniform guarantee (weight `{d, d}` is byte-identical to uniform at `d`)
  true *by construction* — identical `sampleShapeFillPoints()` arguments — not by luck.
* **Phase B — probe and assign.** `strokeWidthsForSamples(survivors, polygons, weightMaxSizeMm)`,
  then `weightSizeMm(width, weightMinSizeMm, weightMaxSizeMm)` per sample.
* **Phase C — radius-aware drop.** `StoneSampler.dropOverlappingSizedStones(assigned)`: for every
  pair whose centres are within the largest assigned diameter, require centre distance
  `>= (d1 + d2) / 2`; where it fails, drop the *later* sample in walk order. Never moves a stone.
  The floor is `(d1 + d2) / 2` with **no `+ gapMm`** — the exact per-pair generalisation of the
  scalar `minSeparationMm: stoneSizeMm` that `sampleShapeFillPoints()` passes for uniform outline
  mode: for two equal stones `(d + d) / 2 = d`. A gap term would make weight mode stricter than
  uniform for no stated reason. (The *chain* pitch is not restored by phase C — it drops, it does
  not re-space — it is restored by phase A oversampling: a run of same-size stones survives at
  ≈ `d + gap`, not at 2×`d`.)

  **`dedupeStonesByRadius()` was not reused.** Every stone in one text layer carries the same
  `layerId`, and that function skips same-`layerId` pairs unconditionally
  (`StoneSampler.js:379-385`), so applied within a layer it is a no-op on every pair. Phase C
  compares every pair regardless of `layerId`.

Phase C does real work because phase A only guaranteed `weightMinSizeMm / oversampleFactor`
separation while larger assigned stones need more (the vacuity control in
`tools/test-mono-015-weight-sizing.mjs` prints the entering/leaving counts).

---

## 6. Two scalars that become per-assignment

Both are generalisations that reduce exactly to today's value when every stone is one size. Neither
is a new rule.

* **`CHAIN_TOO_THIN` (`MonogramGenerator.js`).** `achievedStemStones` was
  `stemWidthRatio * heightMm / stoneSizeMm`, i.e. `stemWidthMm / stoneSizeMm`. For a weight-sized
  layer it is `stemWidthMm / weightSizeMm(stemWidthMm, weightMinSizeMm, weightMaxSizeMm)` — divide
  by the stone actually assigned at the stem width, **not** by the min (which would make the gate
  silently permissive) or the max (arbitrarily strict). Enabling weight sizing can legitimately turn
  a passing monogram into `CHAIN_TOO_THIN` on a thin-stemmed letter; that is correct behaviour.
* **MONO-013's clearance assertion (`MonogramGenerator._generateScriptMonogram()`).** Was
  `minStoneDistanceMm < stoneSizeMm - 1e-6`. Now per-pair: fail if any pair's distance is below
  `(d1 + d2) / 2 - 1e-6`, and record the binding (closest) pair's two diameters in
  `measurements.minStoneDistancePairDiametersMm`. Left as a scalar it would pass vacuously for every
  weight-sized layer, since every assigned stone is `>= weightMinSizeMm`.

---

## 7. UI

* `#sizeMode` gains a `weight` option. `updateWeightSizeCapabilityUI()` disables it (with an
  explaining title) for any selection that is not an outline-mode text layer with an OpenType font,
  and reverts a layer that is somehow already on `weight` back to `uniform`.
* `#weightMinSize` / `#weightMaxSize` are Stone-Library `<select>`s (populated exactly like
  `#mixedMinSize` / `#mixedMaxSize`), shown in `#weightSizeDetailFields` only while `#sizeMode` is
  `weight`. First enable seeds them from the layer's own stone size and `defaultWeightMaxSizeMm()`.
* Monogram: one opt-in checkbox `#monogramWeightSizing`, default unchecked, shown only for OpenType
  fonts. When checked, `buildMonogramRequest()` sends `weightSizing: true` with
  `weightMinSizeMm = stoneSizeMm` and `weightMaxSizeMm = defaultWeightMaxSizeMm(stoneSizeMm)`;
  `MonogramGenerator` threads those into every letter `generateTextLayout()` call and persists the
  flat fields on the emitted text layer. Unchecked is the existing uniform path, unchanged — so
  MONO-013's golden numbers (372 / 369 stones, 136.501458 / 131.901458 mm) are untouched.

---

## 8. Results

`tools/test-mono-015-weight-sizing.mjs` — all groups pass.

**Why a stone-count band was not the guard.** A weight layout mixing 2.0 / 2.8 / 4.0 mm stones must
land somewhere between the uniform-2.0 and uniform-4.0 counts, and on `develop` uniform-2.8 *alone*
is already −34 % (uniform Great Vibes "A" at 45 mm: 2.0 → **94**, 2.8 → **62**, 4.0 → **36**). No
band anchored to the uniform-SS6 count is both tight and correct.

**What is guarded instead — chain pitch.** Group the stones into runs of consecutive same-diameter
stones (split at any jump > 1.5 × that diameter's `d + gapMm`, i.e. a contour boundary or a
phase-C-dropped gap). For every run of ≥ 3 stones, the **median** centre-to-centre pitch must be
within **15 %** of `d + gapMm` (median, not max — corner anchoring makes individual pitches near a
corner legitimately irregular).

* Synthetic tapered stroke (0.8 → 4.6 mm, all three diameters form sustained runs): at the plain min
  pitch the 2.8 mm run is **+48.2 %** over-spaced; with oversampling every diameter's median run
  pitch is within tolerance (2.0 mm −0.1 %, 2.8 mm +11.2 %, 4.0 mm +6.9 %).
* Great Vibes "A" at 45 mm, weight `{2.0, 4.0}` through the real engine: the 2.0 mm and 4.0 mm runs
  are all within tolerance; 2.8 mm is a transition width on this particular glyph and forms only
  2-stone regions (printed, not asserted — the range endpoints are the diameters guaranteed a
  sustained region).
* **Golden stone count, pinned exact:** Great Vibes "A" at 45 mm, weight `{2.0, 4.0}` = **68**
  stones (between the uniform 94 and 36 anchors).
* Screenshots (`docs/screenshots/mono-015/`, Mug / gold / Great Vibes "A" / layout single / frame
  none / SS6 base): uniform **103**, weight `{SS6, SS10}` **95**, weight `{SS6, SS16}` **71**.

---

## 9. Related

* `docs/specifications/S-200-MixedStoneSizeLayouts.md` — the `'mixed'` size mode this sits beside.
* `docs/specifications/MONO-012-SingleChain.md` — the `CHAIN_TOO_THIN` gate generalised in §6.
* `docs/specifications/MONO-013-Interlock.md` §5 — the SS6-only three-letter-script ceiling, now
  also filed in `docs/BACKLOG.md` (weight sizing does not relieve it).
