# MONO-015 — Weight-following stone size (opt-in)

**Status:** implemented. Branch `feature/mono-015-weight-sizing` off `develop` @ `87e20a5` (local
only).

**Authorises:** a third text-layer `sizeMode`, `'weight'`, driven by a **graduated** control (Off /
Step 1 / Step 2); one flat persisted layer field `weightSizesMm` (the step's ascending mm
diameters, stored the way S-200's `allowedSizesMm` is); `src/geometry/StrokeWidthProbe.js` and
`src/geometry/WeightSizing.js`; `StoneSampler.dropOverlappingSizedStones()`;
`src/renderer/StoneSizes.js`'s `stoneSizesFromBaseMm()` / `stoneSizeRungsAvailable()`; a
`#weightSteps` inspector select and a `weight` option on `#sizeMode`; a `#monogramWeightSteps`
select; per-assignment generalisations of MONO-012's `CHAIN_TOO_THIN` gate and MONO-013's clearance
assertion.

**Third commit — graduated steps.** The persisted representation changed from a
`weightMinSizeMm` / `weightMaxSizeMm` pair to a single flat array `weightSizesMm`, and the two
independent size pickers became one graduated control: **Off** (uniform), **Step 1** (the layer's
base stone size + one catalog rung), **Step 2** (base + two rungs). Levels are always relative to
the base, derived from the catalog and clamped at the top. Nothing had shipped, so the old fields
were replaced outright — no alias, no migration. The min/max pair and the step array are
informationally equivalent under `weightSizeMm`'s "smallest entry ≥ width" rule, so Step 2 at an SS6
base reproduces the old golden of **68** exactly.

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

`weightSizeMm(widthMm, sizesMm)` — the smallest entry of the ascending `sizesMm` that is
`>= widthMm`, or the largest entry when `widthMm` exceeds all of them. `sizesMm` is the graduated
step's diameters in raw millimeters.

**Pure arithmetic, no renderer import.** `src/geometry/WeightSizing.js` imports nothing from
`src/renderer/**`. Per `src/renderer/StoneSizes.js`'s own header, nothing in `src/geometry/**` reads
that file or knows what an "SS16" is — geometry works in raw millimeters for any positive value. The
first attempt at this milestone briefly broke that (importing `listStoneSizes()` into the engine)
and editing the header comment was the only thing that "allowed" it;
`tools/test-architecture-module-boundaries.mjs` now asserts the boundary directly. The catalog-aware
derivation of *which* diameters make up a step lives in `src/renderer/StoneSizes.js`
(`stoneSizesFromBaseMm(baseMm, rungCount)`, alongside `listStoneSizes()` /
`findStoneSizeByDiameterMm()`); the engine is handed the resulting array and never needs to know it
came from a catalog.

**Which single-chain bound this rule enforces, and which it does not.** A stone at least as wide as
the stroke keeps both contour edges of that stroke collapsed onto one chain, so the rule enforces
the **upper** single-chain bound — `SINGLE_CHAIN_MAX_RATIO` (1.10, `SingleChain.js:23`), the ratio
at which a stem starts splitting into two chains. It does **not** enforce the **lower** bound: on a
hairline far narrower than `sizesMm[0]` the assigned stone is floored at `sizesMm[0]`, so
stones-across-stem there falls well below `SINGLE_CHAIN_MIN_RATIO` (0.70, `SingleChain.js:22`) — the
ratio the constant names as where a chain thins into visible gaps. Weight sizing keeps the stem
solid where the stroke is at least `sizesMm[0]` wide and floors the rest there; it does not claim to
preserve the single-chain condition on sub-`sizesMm[0]` hairlines.

## 3a. Graduated steps — `src/renderer/StoneSizes.js`

`stoneSizesFromBaseMm(baseMm, rungCount)` returns `[base, base + 1 rung, … base + rungCount rungs]`,
length `rungCount + 1` — Step 1 → two diameters, Step 2 → three. `baseMm` is snapped to the nearest
catalog entry at or below it. It **throws** (does not clamp) when the catalog has fewer than
`rungCount` rungs above the base: SS16 has two, SS20 one, SS30 none. `stoneSizeRungsAvailable(baseMm)`
is the non-throwing predicate the UI uses to render a step's option disabled instead of offering it.
Reaching `stoneSizesFromBaseMm()` for an impossible step is therefore a caller bug, surfaced loudly
rather than silently degraded to a smaller step.

| over-wide case | failure |
|---|---|
| Step 2 from an SS20 base (one rung available) | `stoneSizesFromBaseMm()` throws `RangeError` ("no 2 rungs above 4.7 mm"); the UI option is disabled |
| any step from an SS30 base | same — both options disabled |
| a probe width beyond the step's largest diameter | not a failure — `weightSizeMm()` returns the largest entry (the upper clamp) |

---

## 4. Flat persisted field

`weightSizesMm` is a single flat array on the layer — the graduated step's ascending mm diameters —
stored and defaulted exactly the way S-200's `allowedSizesMm` is (`mixedSizeParamsFor()` forwards
`layer.weightSizesMm ?? []`; `normalizeMixedSizeParams()` validates it entry-by-entry with
`assertPositiveNumber`, plus a strictly-ascending check). It is deliberately **not** S-200's
`minSizeMm` / `maxSizeMm`: those belong to `'mixed'`, and a layer that has switched modes would
round-trip ambiguously if the two modes shared fields. No nested `weightOptions` is persisted — the
engine produces the nested `{ sizesMm }` bundle at its own boundary, exactly the way
`normalizeMixedSizeParams()` does for `mixedOptions` (`MixedSizeGenerator.js`).

An empty (or absent) `weightSizesMm` is the "weight on, step Off / nothing configured" case: the
engine substitutes `[stoneSizeMm]`, so the branch reduces to uniform output at the layer's own stone
size — exactly what `{d, d}` did before this representation change. On first enable the inspector
seeds Step 2, clamped to what the catalog can supply from the base (the graduated equivalent of the
old "two catalog steps up, clamped" default). The `#weightSteps` select carries the *rung count*
(0 / 1 / 2); the mm diameters are re-derived from the layer's own stone size on every write, so
changing the stone size re-bases the step rather than leaving a stale array.

Valid only for a text layer sampled in outline mode. `GeometryEngine.generateTextLayout()` throws a
descriptive error (in the style of the `curveEnabled` throw at `GeometryEngine.js:159`) for
`weight` + fill mode and for `weight` + an authored stone-center font. A stray `sizeMode: 'weight'`
on a non-text layer **throws** from `normalizeMixedSizeParams()` (its `allowWeight` option is only
passed by `normalizeTextParams()`) — a caller bug is loud, not silently absorbed. An unknown mode
*string*, separately, still falls back to `'uniform'` via app.js's `resolveSizeMode()` for
old-project compatibility, and never reaches the engine.

---

## 5. Sampling — three phases, in this order

The order is the opposite of the obvious one, and it matters: sampling at the largest pitch first
would leave phase C nothing to drop, which is a check that cannot fail.

* **Phase A — sample, then oversample.**
  `oversampleFactor = sizesMm.length > 1 ? 2 : 1`;
  `sampleShapeFillPoints('outline', polygons, boundingBox, (sizesMm[0] + gapMm) / oversampleFactor,
  sizesMm[0] / oversampleFactor)`.

  Why oversample. Phase C only ever *drops*, so a survivor sits at an integer multiple of the
  phase-A pitch. At the plain min pitch (2.3 mm for SS6 / 0.3 gap) a 2.8 mm stone assigned to a
  2.3-pitched run ends up 4.6 mm from its neighbour — **48 % over** its own 3.1 mm `d + gap` ideal,
  which is the `SINGLE_CHAIN_MIN_RATIO` (`SingleChain.js:22`) gap-failure mode: the middle of the
  catalog comes out systematically over-spaced. Halving the phase-A pitch drops the quantisation
  step to 1.15 mm, so a 2.8 mm run lands ≈ 3.45 mm (+11 %) and a 4.0 mm run ≈ 4.6 mm (+7 %) — both
  inside a 15 % tolerance. **Both** the walk step *and* the separation floor must be divided:
  lowering only the step does nothing, because `sampleMultiContourOutlinePoints()` re-quantises any
  point closer than `minSeparationMm` straight back to 2.3.

  The factor is **1** when `sizesMm` has a single entry (step Off / not configured, whose array is
  `[stoneSizeMm]`). Every stone is then one size, so phase A at the min pitch is already exact and
  oversampling buys nothing — and pinning it to 1 keeps the reduction-to-uniform guarantee
  (`weightSizesMm: [d]` is byte-identical to uniform at `d`) true *by construction* — identical
  `sampleShapeFillPoints()` arguments — not by luck.
* **Phase B — probe and assign.** `strokeWidthsForSamples(survivors, polygons,
  sizesMm[sizesMm.length - 1])`, then `weightSizeMm(width, sizesMm)` per sample.
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

Phase C does real work because phase A only guaranteed `sizesMm[0] / oversampleFactor` separation
while larger assigned stones need more (the vacuity control in
`tools/test-mono-015-weight-sizing.mjs` prints the entering/leaving counts).

---

## 6. Two scalars that become per-assignment

Both are generalisations that reduce exactly to today's value when every stone is one size. Neither
is a new rule.

* **`CHAIN_TOO_THIN` (`MonogramGenerator.js`).** `achievedStemStones` was
  `stemWidthRatio * heightMm / stoneSizeMm`, i.e. `stemWidthMm / stoneSizeMm`. For a weight-sized
  layer it is `stemWidthMm / weightSizeMm(stemWidthMm, sizesMm)` — divide by the stone actually
  assigned at the stem width, **not** by the smallest step diameter (which would make the gate
  silently permissive) or the largest (arbitrarily strict). Enabling weight sizing can legitimately
  turn a passing monogram into `CHAIN_TOO_THIN` on a thin-stemmed letter; that is correct behaviour.
* **MONO-013's clearance assertion (`MonogramGenerator._generateScriptMonogram()`).** Was
  `minStoneDistanceMm < stoneSizeMm - 1e-6`. Now per-pair: over every pair, track
  `(d1 + d2) / 2 - dist` and fail (`INTERNAL_CONTRACT_MISMATCH`) if the worst is `> 1e-6`; record the
  binding (closest) pair's two diameters in `measurements.minStoneDistancePairDiametersMm`. Left as a
  scalar it would accept a cross-class near-collision — e.g. a 2.0 mm and a 4.0 mm stone 2.5 mm apart
  passes `>= stoneSizeMm` (2.0) but fails the real `(2.0 + 4.0) / 2 = 3.0` floor. In a *passing*
  weight mark the reported closest pair is structurally always the tightly-packed hairline run
  (`(2.0, 2.0)`), because a same-size run is always tighter than any cross-class junction; the
  generalisation's distinguishing work is in phase C's drop (test `C2` forces a cross-class binding
  pair there) and in this rejection check.

---

## 7. UI

* `#sizeMode` gains a `weight` option. `updateWeightSizeCapabilityUI()` disables it (with an
  explaining title) for any selection that is not an outline-mode text layer with an OpenType font,
  and reverts a layer that is somehow already on `weight` back to `uniform`.
* `#weightSteps` is a single graduated `<select>` — Off / "SS6 → SS10" / "SS6 → SS10 → SS16", labels
  built live from the base stone size with `formatStoneSizeLabel()` — shown in
  `#weightSizeDetailFields` only while `#sizeMode` is `weight`. Its option value is the rung count;
  a step the catalog cannot supply from the current base is rendered `disabled` with an explaining
  title (`weightStepsOptionsHtml()`, gated by `stoneSizeRungsAvailable()`). One picker, not two: two
  independent Hairline/Widest pickers could express a four-rung span that reads as noise on a script
  face — the graduated control cannot express an invalid state.
* Monogram: one opt-in `<select>` `#monogramWeightSteps` with the same three options, default Off,
  shown only for OpenType fonts and rebuilt from the monogram stone size. When a step is chosen,
  `buildMonogramRequest()` sends `weightSizesMm = stoneSizesFromBaseMm(stoneSizeMm, step)`;
  `MonogramGenerator` threads that array into every letter `generateTextLayout()` call and persists
  it on the emitted text layer. Off is the existing uniform path, unchanged — so MONO-013's golden
  numbers (372 / 369 stones, 136.501458 / 131.901458 mm) are untouched.

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
  pitch is within tolerance (2.0 mm −0.1 %, 2.8 mm +11.2 %, 4.0 mm +6.9 %). Re-run for both steps
  through the real engine — Step 1 `[2.0, 2.8]` has no 4.0 mm stones at all, so its per-diameter
  runs differ; both stay within 15 %.
* **Golden stone counts, pinned exact** (Great Vibes "A" at 45 mm, SS6 base):
  * `weightSizesMm: [2.0]` (Step Off) = **94**, byte-identical to uniform SS6 — the anchor proving
    the representation change is behaviour-neutral. A negative control (`[2.0, 2.8]` on the same
    case) is run alongside so the byte-identity assertion is shown to discriminate.
  * Step 1 `[2.0, 2.8]` = **85** (between the develop anchors uniform-2.0 = 94 and uniform-2.8 = 62).
  * Step 2 `[2.0, 2.8, 4.0]` = **68** — identical to the develop golden for the old `{min 2.0,
    max 4.0}` pair. If it ever moves, the two representations have diverged; report it, do not re-pin.
* Screenshots (`docs/screenshots/mono-015/`, Mug / gold / Great Vibes "A" / layout single / frame
  none / SS6 base): `uniform.png` **103**, `weight-step1.png` **95**, `weight-step2.png` **71**.

---

## 9. Related

* `docs/specifications/S-200-MixedStoneSizeLayouts.md` — the `'mixed'` size mode this sits beside.
* `docs/specifications/MONO-012-SingleChain.md` — the `CHAIN_TOO_THIN` gate generalised in §6.
* `docs/specifications/MONO-013-Interlock.md` §5 — the SS6-only three-letter-script ceiling, now
  also filed in `docs/BACKLOG.md` (weight sizing does not relieve it).
