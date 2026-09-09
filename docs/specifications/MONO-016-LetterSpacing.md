# MONO-016 — Unified letter spacing across monogram layouts

**Status:** implemented. Branch `feature/mono-016-letter-spacing` off `develop` @ `910e3c8` (local
only).

**Authorises:** renaming the monogram request param `interlockMm` → `letterSpacingMm` (outright, no
alias); widening its range and making it apply to **every** multi-letter layout, not just `script`;
a `MonogramLayouts.layoutHorizontalGroup()` / `computeMonogramLayout()` `extraGapMm` term;
`measurements.letterSpacingMm` / `diagnostics.letterSpacingMm`; renaming the `#monogramInterlock`
"Overlap" slider to `#monogramLetterSpacing` "Letter spacing" and showing it for any layout whose
resolved letter count is ≥ 2.

---

## 1. The problem

Three unrelated mechanisms governed letter spacing and none covered monograms properly:

- Ordinary **text layers** have `#letterSpacing` (READ-006), bounds `[-pitchMm, 4 × pitchMm]` from
  `letterSpacingBoundsMm()`. Out of scope here — untouched.
- **Script monograms** had `#monogramInterlock` ("Overlap"), clamped to `[-pitchMm, 0]` and
  validated as `INVALID_INPUT` for any positive value. A script mark could be tightened, never
  spread.
- **Slot layouts** (`two-letter`, `traditional-three`, `equal-three`) had **no user control at
  all**. Their inter-slot gap was `Math.max(frameInteriorRect.widthMm * gapRatio, minGapMm)` — a
  fixed fraction of frame width, floored by MONO-006E's production clearance.

MONO-016 makes it one control.

---

## 2. One control, two implementations, an asymmetric range

**This is the thing a future reader will get wrong, so it is stated explicitly.**

| | script | slot layouts |
|---|---|---|
| what the value does | glyph tracking inside one interlocked string | additive term on the inter-slot gap |
| where it lands | emitted layer's `letterSpacing` | `layoutHorizontalGroup()`'s `gapMm` |
| range | `[-pitchMm, 4 × pitchMm]` | `[0, 4 × pitchMm]` |

`pitchMm` is the monogram's **own** stone pitch — `stoneSizeMm + gapMm`, which inside
`MonogramGenerator` is exactly `requiredSpacingMm`. In app.js it is `monogramLetterSpacingPitchMm()`
— the `#monogramStoneSize` value plus the fixed `MONOGRAM_INTERLOCK_GAP_MM` (0.3), **not**
`letterSpacingBoundsMm()`, because that helper reads the `#stoneSize` / `#gap` *text-layer* controls,
which are not the monogram's. `buildMonogramRequest()` pins `request.gapMm` to that same 0.3 for the
script layout so the slider bounds and the generator's own pitch-derived range never drift. Only the
top-rung multiplier (`4`) is borrowed, via
`TRACKING_XPITCH_LADDER[TRACKING_XPITCH_LADDER.length - 1]`.

### Why the script floor is exactly `-pitchMm`

Unchanged from MONO-013 §4, and it is a hard reason, not aesthetics. The emitted text layer persists
the value as `layer.letterSpacing`. `writeSelectedControlsToLayer()` re-clamps `l.letterSpacing` to
`letterSpacingBoundsMm().minMm` (= `-pitchMm`) on **every** text-control write, **with no undo
entry** — READ-006's own documented silent-clamp behaviour. A wider negative range would silently
un-interlock the mark the first time the user touched any text control on the generated layer.

### Why slot layouts cannot go negative

`minGapMm` is the real production stone-to-stone clearance (MONO-006E). Below it, stones from
adjacent letters physically collide. Negative is meaningful only for `script`, where the letters are
one connected mark and MONO-013 *measures* clearance rather than gating it. A negative request on a
slot layout is rejected as `INVALID_INPUT` naming the production clearance — **not** silently clamped
to 0. Silent clamp-back is exactly what `letterSpacingBoundsMm()`'s own comment exists to prevent.

---

## 3. Change

### `MonogramLayouts.js`

`layoutHorizontalGroup(..., minGapMm = 0, extraGapMm = 0)`:

```
gapMm = Math.max(frameInteriorRect.widthMm * gapRatio, minGapMm) + extraGapMm
```

Everything downstream — `availableForSlotsMm`, the proportional `shrink`, the centering — is
unchanged. The existing `!(availableForSlotsMm > 0)` guard already yields `INSUFFICIENT_SPACE`
through `computeMonogramLayout()`; no new reason code. `extraGapMm` is threaded through
`computeMonogramLayout()`'s request into `buildTwoLetterSlots` / `buildTraditionalThreeSlots` /
`buildEqualThreeSlots`. `buildScriptSlots` ignores it for the same reason it already ignores
`minGapMm` — one slot, no inter-slot gap. `extraGapMm` defaults to 0, and 0 is byte-identical to
pre-MONO-016 for every layout.

### `MonogramGenerator.js`

The request param `interlockMm` → `letterSpacingMm`, renamed outright — nothing shipped with
`interlockMm` outside this repo, so no alias, no migration, no deprecation path. It now feeds two
sinks by layout: the emitted layer's `letterSpacing` for `script` (unchanged behaviour), and
`computeMonogramLayout()`'s `extraGapMm` for the slot layouts.

`resolveLetterSpacingRequest()` validates the asymmetric range up front in `generate()` (after the
structural layout check — this module's `frame → layout → spacing → font` failure-priority order).
`measurements.letterSpacingMm` records the applied value on both paths.

Both `CHAIN_TOO_THIN` remedy sentences — the per-letter slot message and the interlocked-string
message — now include "less letter spacing". Wide spacing shrinks slots, which shrinks letters,
which is a legitimate route to that failure; the diagnosis was right, only the suggested remedies
were incomplete.

### `index.html` / `app.js`

`#monogramInterlock` → `#monogramLetterSpacing` (and `…Field` / `…Value`); label "Overlap" →
"Letter spacing". The app.js helpers rename to match (`monogramLetterSpacingMm()`,
`monogramLetterSpacingBoundsMm()`, `refreshMonogramLetterSpacingBounds()`,
`updateMonogramLetterSpacingVisibility()`), plus a new `monogramResolvedLetterCount()`.

- **Visibility** keys on `monogramResolvedLetterCount() >= 2` for **any** layout — the count is
  fixed by the layout for the four slot layouts, or the number of letters typed for the range-based
  `script` layout. Hidden for `single` and a one-letter script mark (no inter-letter gap to
  regulate).
- **Bounds** are `[-pitchMm, 4 × pitchMm]` for script, `[0, 4 × pitchMm]` for slot layouts; the
  slider's `min` / `max` recompute wherever a stone-size or layout change can move them.
- `buildMonogramRequest()` sets `request.letterSpacingMm` whenever the control is shown (omitted
  otherwise, so a `single` / one-letter request is byte-identical to pre-MONO-016).

`HISTORY_TRACKED_CONTROL_IDS` is **not** touched — no monogram lightbox control is in that list;
monogram generation commits its own single undo step.

---

## 4. Which failure reason each over-wide case produces

| case | reason |
|---|---|
| slot layout, `letterSpacingMm < 0` | `INVALID_INPUT` (naming the production clearance) — never a clamp |
| any layout, `letterSpacingMm` outside `[min, 4 × pitchMm]` | `INVALID_INPUT` |
| slot layout, in-range spacing wide enough to drive `availableForSlotsMm` ≤ 0 | `computeMonogramLayout()` → `INSUFFICIENT_SPACE`, surfaced by the generator as `FITTING_FAILED` with a message naming the required spacing |
| in-range spacing that shrinks an OpenType letter's stem below the chain minimum | `CHAIN_TOO_THIN` (message now lists "less letter spacing" as a remedy) |

---

## 5. Tests

`tools/test-mono-016-letter-spacing.mjs` — real repository fonts + frames:

1. Default byte-identical (`letterSpacingMm` omitted == `0`) for all five layouts; golden total
   stone counts pinned (`single` 202, `two-letter` 361, `traditional-three` 300 — matches the
   MONO-013 spot check —, `equal-three` 374, `script` 372). Named negative control on
   `traditional-three` proves the byte-identity check discriminates.
2. Script goldens exact through the engine: `letterSpacingMm` 0 → 372 / 136.501458 mm, −2.3 → 369 /
   131.901458 mm.
3. Script spreads: positive values → strictly wider string bbox, monotone.
4. `traditional-three`: inter-slot gap strictly grows and slot widths strictly shrink, monotone
   across three values.
5. `letterSpacingMm: -1` rejected for a slot layout (`INVALID_INPUT`, naming the clearance) but OK
   for script — the asymmetry in one test.
6. Over-wide spacing: `computeMonogramLayout()` → `INSUFFICIENT_SPACE`; the generator → `FITTING_FAILED`
   naming the spacing.
7. Both `CHAIN_TOO_THIN` paths name letter spacing as a remedy. The slot per-letter message
   (`MonogramGenerator.js` ~L788) is reached on Great Vibes / `two-letter` / `none` at a ~100 mm
   frame, letters `A,B`, SS6: `letterSpacingMm` 0 passes (stem 0.726), `letterSpacingMm` 9 fails
   (`CHAIN_TOO_THIN`, stem 0.687) — spacing is the deciding input. The test also probes
   `none` 150×150 and prints that it never crosses the boundary at any legal spacing (stem stays
   0.850) rather than moving the frame to manufacture a transition there. The interlocked-string
   message is reached on `script` at SS10.
8. Control bounds and visibility (app.js helpers sliced and executed against a fake DOM): script
   `min` negative, slot `min` 0, both `max` = `TRACKING_XPITCH_LADDER` top rung ×
   `monogramLetterSpacingPitchMm()`; hidden for `single` / one-letter script; the slider re-clamps a
   now-illegal negative value to 0 when the layout switches script → slot.

Every test input is reachable through the UI — the `none` frame's `COMMON_SCALING_LIMITS_MM`
(20–150 mm, both axes) is respected.

`src/monogram/**` may import `src/renderer/**` — MONO-015's boundary assertion covers
`src/geometry/**` only.

---

## 5a. OpenType script fonts in slot layouts

An authored (stone-centre) font places stones on a fixed grid and works in every layout. An
**OpenType script font** must form a single readable chain across each stroke, and a slot layout
shrinks the letter to fill a per-slot rectangle — so whether it clears the `CHAIN_TOO_THIN` gate
depends on the layout and the frame. Measured on `develop` @ `910e3c8` with the real generator:
Great Vibes (`stemWidthRatio` 0.0357), frame `none`, SS6, `letterSpacingMm` 0, letters `A,K` for
`two-letter` and `A,K,L` for the three-letter layouts:

| layout | 150×150 | 150×100 | 120×120 | 100×70 |
|---|---|---|---|---|
| `two-letter` | **OK** | **OK** | chain-too-thin | chain-too-thin |
| `traditional-three` | chain-too-thin | chain-too-thin | chain-too-thin | chain-too-thin |
| `equal-three` | chain-too-thin | chain-too-thin | chain-too-thin | chain-too-thin |

So: the **three-letter** slot layouts (`traditional-three`, `equal-three`) are unreachable for an
OpenType script font at every frame size within the 150 mm cap — this is exactly the gap MONO-013's
`script` layout exists to fill. **`two-letter` is reachable** at the larger frames (≈ 150 mm wide).
Positive letter spacing narrows the slots further, so on a marginal `two-letter` frame (≈ 100 mm)
it can push a passing mark into `CHAIN_TOO_THIN` — that is test 7's per-letter path, and the reason
its `CHAIN_TOO_THIN` message now lists "less letter spacing".

The `docs/screenshots/mono-016/slot-natural.png` / `slot-wide.png` pair is therefore
**Great Vibes / `two-letter` / `none` 150×150 / SS6**, `letterSpacingMm` 0 and +4.6 (229 stones
each; string bbox 130.6 → 135.2 mm, the +4.6 mm being one inter-slot gap widened by `extraGapMm`) —
the OpenType script path MONO-016 actually changed for slot layouts, not an authored font whose
behaviour was never in question.

---

## 6. Related

* `docs/specifications/MONO-013-Interlock.md` — the `script` layout and the original `interlockMm`
  control this milestone renamed and widened.
* `docs/specifications/MONO-006E-...` history in `MONO-004`/`MONO-006` — `minGapMm`, the production
  clearance a slot layout's spacing floor of 0 protects.
* `docs/specifications/MONO-015-WeightSizing.md` — the neighbouring opt-in monogram control.
