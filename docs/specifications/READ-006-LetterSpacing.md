# READ-006 — Letter spacing in the product

Status: **proposed, not implemented.** First READ milestone to touch `app.js`. Consumes the tracking
experiment recorded in `docs/specifications/READ-005A-CalibrationFindings.md` §6 and frozen in
`docs/data/read-005/derived-tables.json` under `session2.paired`.

Everything in §1 and §2 below was measured against `develop` at `edb220b` (a fresh clone, real git
and real engine runs), not recalled. Where this document disagrees with the code, the code wins;
where it disagrees with `tools/font-certification/analyze-ratings.mjs`, that script wins.

READ-000 §3 names READ-006 as "live UI consuming baked floors". That is not this milestone. The
floors work is deferred; this document takes the one intervention the calibration actually
validated and ships it.

---

## 1. What the evidence supports, stated exactly

The tracking experiment paired 24 crowding-rejected calibration cases against themselves at zero
tracking. Two controls were never rated, so the analysis is over **22 complete pairs**.

| | tracked sellable | tracked not sellable |
|---|---|---|
| **control sellable** | 3 | 0 |
| **control not sellable** | 8 | 11 |

McNemar exact two-sided over the discordant cells (8, 0) gives p = 2 × 0.5⁸ = **0.0078**. Controls
behaved: 0 of 11 specificity cases (rejected for letterform inaccuracy, not crowding) flipped, 9 of
9 already-sellable cases survived tracking untouched, and the zero-tracking control block reproduced
the rater's own 13.3% self-inconsistency at 13.6%.

Per mode, over evaluable pairs: outline 2 → 8 of 12, contour 1 → 3 of 6, fill 0 → 0 of 3, staggered
0 → 0 of 1.

### 1.1 The width figure that matters is not the one usually quoted

`derived-tables.json` records `session2.paired.widthCostOnWins` as `{n: 8, medianPct: 25.31,
minPct: 4.38, maxPct: 51.31}`. **That is the cost on the eight conversions**, not the cost of
applying tracking.

The median width growth across all 22 tracked renders is **+22.7%**. Fourteen of the twenty-two got
wider and stayed rejected.

This distinction decides the milestone. Applying tracking to everything buys a ~36% conversion rate
on crowding-rejected designs at ~23% median width on *every* design, including the ~74% of the
catalogue that was never rejected for crowding at all.

### 1.2 There is no default tracking value

The experiment chose, per case, the lowest rung of `[0, 0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 2.5, 3, 4]
× pitch` reaching `separationRatio >= 0.95`. The chosen values spread across the entire ladder:

```
0×   2 cases    1.25×  1 case
0.25× 1          2×     4
0.5×  1          2.5×   4
0.75× 2          3×     4
1×    2          4×     3
```

Seven of the eight wins came at ≥ 2× pitch; the nine cases solving at ≤ 1.25× produced one win
between them. No constant captures both the wins and the restraint. The value has to be solved per
case or chosen by the operator.

---

## 2. Three measured facts that rule out automatic application

### 2.1 The solve is not interactive

Warm, in Node, "Vitalina" at ss10 / 2.8 mm stone / 0.3 mm gap, one `generateTextLayout()`:

| mode | stones | ms |
|---|---|---|
| outline | 194 | 3.2 |
| fill | 143 | 5.1 |
| radial | 146 | 0.7 |
| staggered | 164 | 0.3 |
| **contour** | 190 | **83.9** |

An eleven-rung ladder in contour is ~1.9 s, measured end to end on real calibration cases
(`f64a2e12` 1917 ms, `696e0e9e` 1935 ms). Contour is one of the two modes where tracking works. A
solve on every keystroke is not available.

### 2.2 The ladder cannot be bisected

`separationRatio` is **not monotone** in `letterSpacingMm`. Two of eight sampled calibration cases
fall back partway up the ladder — `mr-dafoe-regular` runs
`0.13 0.25 0.25 0.38 0.25 0.25 0.25 0.38 0.50 0.50 1.00`, and `sacramento-regular` shows the same
shape. Binary search would return a wrong answer on those. The solve is an **ascending** scan that
returns at the first rung reaching `SEPARATION_TARGET` — never bisected, and never skipping a rung.
The ladder is ascending, so the first hit is the lowest; non-monotonicity above it is irrelevant.
Only a case that never separates walks all eleven rungs.

### 2.3 The 0.95 target is sometimes reached by fragmentation

`f26ca719` (`anton-regular`, outline) goes 0.63 at 0× to **1.50** at 0.5×. The target is
"cluster count reached the per-character expected count", which a glyph shattering into extra
clusters satisfies as readily as two glyphs pulling apart. This is recorded, not fixed: the target
is what was validated and this milestone does not redefine it. It is why the solve's result is
presented to the operator rather than applied behind their back.

### 2.4 Independent reproduction

Re-solving the ladder from scratch against the live engine reproduced the stored
`letterSpacingXPitch` for 8 of 8 sampled paired-tracked cases, exactly. The harness is sound and the
solve is reimplementable from `src/`.

---

## 3. What the code contains today

Verified at `edb220b`.

- `letterSpacingMm` is a real, validated `generateTextLayout()` parameter:
  `assertFiniteNumber(params.letterSpacingMm ?? 0, 'letterSpacingMm')` at
  `src/geometry/GeometryEngine.js:1487`, applied at line 591 as `penXMm += options.letterSpacingMm`
  **only between characters** (`if (i < characters.length - 1)`), so there is no trailing advance.
  Documented in `src/geometry/README.md`. Negative values are accepted by validation.
- `resolveTextPolygons()` (line 459) runs the same `normalizeTextParams()` and the same
  `_buildLineContours()`, so it already honours `letterSpacingMm` with no engine change.
- The parameter appears **nowhere in `app.js`**. Every design in the product's history is at zero
  tracking.
- `computeAutoFitScale()` (`app.js:520`) does not trade height against width as a preference. It
  shrinks height *because of* width, floored by
  `MIN_AUTOFIT_HEIGHT_TO_SPACING_RATIO = 6` measured against `spacingMm = stoneSize + gap`.

### 3.1 Four wiring sites, not three

A new text-layer field must land in all four or the layer's own schema disagrees with itself:

1. `defaultProject()` — `app.js:892`
2. blank-layer literal (the `#addTextBtn` empty-text path) — `app.js:3496`
3. `addText()`'s `'New Text'` literal — `app.js:4220`. (Not `duplicateLayer()`: that one, at
   `app.js:3477`, deep-clones with `JSON.parse(JSON.stringify(l))` and carries any new field
   automatically — no change there.)
4. **`resolveLayerShapeSource()`'s text branch — `app.js:2588`.** This builds its *own* params
   object for `resolveTextPolygons()` and calls `computeAutoFitScale()` itself. Omitting
   `letterSpacingMm` here means a tracked text layer used as a boolean-op input silently resolves
   *untracked* polygons — the geometry and the shape source disagreeing about the same layer.

`buildTextLayoutBaseParams()` (`app.js:735`) is the fifth site and the one that reaches
`generateTextStonesLive()`.

### 3.2 Three existing notions of "ratio", and a fourth that must not be created

- `MIN_AUTOFIT_HEIGHT_TO_SPACING_RATIO = 6` — height ÷ (stone + gap), auto-fit's shrink floor.
- The calibration's height-to-**stone** ratio, covering the 15–32 band everything was rated in.
- `TEXT_PRINTABLE_VISIBILITY_RATIO = 0.5` — bounding-box overlap against the safe area, unrelated.

At the default 2.8 mm stone and 0.3 mm gap, `MIN_AUTOFIT_HEIGHT_TO_SPACING_RATIO` permits heights
around height-to-stone 6.6 — far below anything ever rated. **Auto-fit can already drive text into
territory nobody has rated, before this milestone changes anything.** See §6.

---

## 4. Design

### 4.1 A manual control and a one-shot solve. No continuous auto-application.

Automatic application fails on §1.1, §2.1 and §2.2 simultaneously: it cannot be computed at
interactive rates in contour, it cannot be shortcut, it has no defensible default (§1.2), and it
charges every design ~23% width for a ~36% conversion rate on the minority of designs that have the
defect. It would also run in a configuration the experiment never tested — the harness called
`generateTextLayout()` directly, with auto-fit off.

Ships instead:

- **`Letter spacing (mm)`** — a numeric field beside `Line spacing`, `step="0.1"`, default `0`,
  with bounds **derived per layer from `pitchMm` (`stoneSize + gap`)**: `max = TRACKING_XPITCH_LADDER`'s
  top rung × `pitchMm`, `min = -pitchMm`. A fixed `[-2, 20]` literal is wrong — the ladder's top rung
  is `4 × pitchMm`: 20.0 mm at SS20 (pitch 5.0 mm) and 26.8 mm at SS30 (pitch 6.7 mm), where even
  the 3× rung reaches 20.1 mm. The button writes `letterSpacingMm` straight onto the layer, so at
  those sizes its own solved value would be silently clamped back down by the next tracked-control
  write, with no undo entry. `app.js` writes these derived
  bounds onto the field's `min`/`max` (a `refreshLetterSpacingFieldBounds()` alongside
  `refreshHeightFieldBounds()`) and `writeSelectedControlsToLayer()`'s clamp reads the same values,
  never literals. Negative values are allowed (the engine validates them and tighter tracking is a
  legitimate display choice); the solve never produces one.
- **`Separate letters`** — a button that runs the validated ladder once, on demand, against the
  currently selected text layer, and writes the winning `letterSpacingMm` into that field as one
  undoable edit.

This delivers the intervention exactly as validated — lowest rung reaching 0.95 — as an explicit
operator action with a visible number, rather than an invisible continuous policy.

The button is not gated by mode. Fill (0/3) and staggered (0/1) have too little data to exclude, and
a null result on an operator-initiated action costs one click. The spec records that the expected
yield is concentrated in outline and contour.

### 4.2 With auto-fit on, the solve refuses. It does not apply and let height fall.

`computeAutoFitScale()` converts added width into lost height. Ratio is the strongest surviving
lever after mode, so letting the solve fire under auto-fit means paying for separation with the very
quantity separation exists to protect — and, per §3.2, the shrink can land below any rated ratio.

Tracking only into the available width headroom is the untested middle: the ladder result is binary
(reach 0.95 or don't), and the two cases that never reached it split one win, one loss. Partial
tracking has no evidence behind it in either direction.

So: when `layer.autoFit` is on and the solved spacing would make the measured width exceed
`project.canvas.width - 10`, the button **does not apply**. It reports the shortfall in mm and names
the remedies that change that comparison — turn Auto Fit off and shorten the text, or drop a stone
size — in the shape `textTooLongDetailMessage()` already uses.

Manual entry into the field is never blocked under auto-fit. That is the operator's own act, and
auto-fit behaves exactly as it does today for any other width increase.

### 4.3 One separation module, in `src/`

The app needs `countClusters()` and `expectedComponentCount()` to run the solve. Both currently live
in `tools/font-certification/lib/`, and `separationBand()` is duplicated identically between
`f-ladder.mjs` and `calibration-renders.mjs` (READ-005A §5 carried this forward as an open item).

Resolve both at once: a new `src/geometry/GlyphSeparation.js`, exported from
`src/geometry/index.js`, holding

- `countClusters(stones, thresholdMm)`
- `expectedComponentCount(engine, fontId, text, providerId)`
- `separationBand(ratio)` and its `0.65` / `1.35` boundaries
- `SEPARATION_TARGET = 0.95`
- `CLUSTER_GAP_MULTIPLIER = 1.6`
- `TRACKING_XPITCH_LADDER`

`f-ladder.mjs`, `calibration-renders.mjs`, `tracking-renders.mjs` and
`lib/productionAnalysis.mjs` import from there; every local copy is deleted.

**This is a pure move.** No behaviour changes. `tools/test-read-005-derived-tables.mjs` is the guard:
it must pass unmodified, and `node tools/font-certification/analyze-ratings.mjs` must emit
byte-identical output.

### 4.4 What the operator sees

- The solved spacing appears in the field as a number. Nothing is hidden.
- A hint below the field, written by the button, in one of three states:
  - applied — the new spacing, the new width in mm, and the percentage growth
  - refused (auto-fit) — the shortfall and the two remedies (§4.2)
  - solved but separation never reached — say so, and apply nothing. Two of the 24 calibration
    cases hit this; silently applying 4× pitch and calling it a fix would be a false guarantee.
- The hint clears on selection change, exactly as `#heightAutoAdjustedHint` and `#autoFitOnHint` do
  in `syncSelectedControlsFromLayer()` (`app.js:1967`).

### 4.5 Authored fonts are excluded — confirmed, not assumed

`resolveLayerShapeSource()` returns `null` for `isAuthoredStoneFontId(fontId)` at `app.js:2588`
because `resolveTextPolygons()` has no outline to give for an authored stone map. Therefore
`expectedComponentCount()` is **not computable at all** for `rs-block` / `rs-modern` — the exclusion
is a fact about the data, not a policy choice.

`letterSpacingMm` gets the treatment `curveEnabled` already has in `buildTextLayoutBaseParams()`
(`authored ? 0 : (layer.letterSpacing ?? 0)` — the layer field is `letterSpacing`; nothing writes a
`letterSpacingMm` onto a layer), and both the field and the button join
`#height` / `#autoFit` / `#gap` / `#curveEnabled` in `updateTextFontCapabilityUI()`'s disabled set
with a hint alongside `#gapFixedHint`.

### 4.6 History

`letterSpacing` joins `HISTORY_TRACKED_CONTROL_IDS` (`app.js:4023`) or undo/redo silently skips it.
The **button** is not a control id; it commits its own history entry before writing, in the
discrete-action pattern `#objectType`'s listener uses (`commitHistory()` then mutate), not the
continuous-session pattern.

---

## 5. Acceptances

Stated as measurements, not criteria.

1. `node tools/font-certification/analyze-ratings.mjs` emits output byte-identical to before the
   change, and `tools/test-read-005-derived-tables.mjs` passes **unmodified**.
2. Re-solving the ladder through `src/geometry/GlyphSeparation.js` for all 24 `paired-tracked`
   entries in `docs/data/read-005/tracking-key.json`: the **22** entries stored with
   `separationAchieved: true` reproduce their stored `letterSpacingXPitch` **exactly**, and the
   **2** entries stored with `separationAchieved: false` return `{ separationAchieved: false }`
   rather than the stored `letterSpacingXPitch` of `4` — that `4` is only the top-rung clamp
   `tracking-renders.mjs` applied because it needed a render, which the product must not do
   (§2.3, §4.4).
3. A text layer created by each of `defaultProject()`, the blank-layer literal and `addText()`'s
   literal carries `letterSpacing: 0`; `Object.keys()` of the three literals' text-layer objects are
   set-equal.
4. With a non-zero `letterSpacing`, the bounding box returned by `resolveLayerShapeSource()` for
   that layer has the same width as `generateTextStonesLive()`'s bounding box for the same layer, to
   within 0.01 mm. (Fails today by construction — §3.1 item 4.)
5. Loading a project JSON with no `letterSpacing` on its text layers produces stone positions
   identical to `develop` at `edb220b` for the default project.
6. With `autoFit: true` and a text whose solved spacing exceeds `canvas.width - 10`, the button
   leaves `layer.letterSpacing` unchanged and `layer.height` unchanged, and the hint is displayed.
7. An authored-font text layer has the field and button disabled, and
   `buildTextLayoutBaseParams()` returns `letterSpacingMm: 0` for it regardless of the stored value.

---

## 6. Deliberately not done

- **`MIN_AUTOFIT_HEIGHT_TO_SPACING_RATIO` is not touched.** Raising it to the calibration's rated
  band would change rendered output for every saved project that relies on auto-fit. That is a
  production-correctness decision with its own evidence requirement and its own milestone. Recorded
  here (§3.2) and in BACKLOG.
- **The 0.95 target is not redefined**, despite §2.3. It is what was validated.
- **Baked per-font-per-mode ratio floors in the live UI** — READ-000's original READ-006 — remain
  open.
- **A decision on staggered and radial** (9% and 10% sellable at every ratio tested) remains open;
  tracking does nothing for either and was never meant to.
