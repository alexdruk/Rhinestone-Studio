# READ-009 — the legibility floor reaches the fixture/Gallery auto-fit path

**Status:** implemented. Branch `feature/read-009-fixture-autofit-floor` off `develop`, local-only
(not pushed).

**Authorises:** extending READ-008's `MIN_HEIGHT_TO_STONE_RATIO` auto-fit floor to
`src/gallery/RhsFixtureBridge.js`'s auto-fit path, and re-authoring the two committed fixtures whose
auto-fit could not satisfy that floor within their canvas. See
[`READ-008-RatioFloor.md`](READ-008-RatioFloor.md) §4 (follow-up 1) for where this gap was first
recorded, and its §2 for the floor value's own open question, which this milestone does not touch.

---

## 1. Root cause

READ-008 expressed the auto-fit legibility floor as `MIN_HEIGHT_TO_STONE_RATIO = 16` stone diameters
and wired it into `app.js`'s `computeAutoFitScale()` and four other call sites. It did not reach
`src/gallery/RhsFixtureBridge.js`'s `generateTextStonesForLayer()` (originally around line 396),
which is a *second, independent implementation* of auto-fit with no floor at all — a plain
fit-to-width shrink, unconditionally.

The precise attribution matters: `toAppProjectShape()` (`RhsFixtureBridge.js`, originally around
line 273) is a pure field-mapping function that performs no fitting of any kind and was never part
of this bug. `generateTextStonesForLayer()` is the floor-less path, and it is the only one.

That floor-less path is what `tools/generate-example-baselines.mjs` builds `examples/baselines.json`
from, so no committed baseline had ever exercised a legibility floor — the baseline for a fixture
whose auto-fit genuinely needed the floor differed from what the live app (`app.js`, correctly
floored since READ-008) actually produces for the identical layer. READ-008 §4.2 recorded the
concrete, live-user-visible consequence: opening `long-name-autofit.rhs` or `long-script-name.rhs`
as a Gallery copy already overflowed the printable canvas in the real, correctly-floored live app,
while the committed baseline (built from the floor-less bridge) showed a smaller, non-overflowing
result. The two pipelines disagreed about the same fixture.

## 2. The shared module

`src/geometry/TextAutoFit.js` extracts the floor's constant and arithmetic out of `app.js` into the
one place both consumers can import it from:

- `MIN_HEIGHT_TO_STONE_RATIO` (16) and `PRINTABLE_MARGIN_MM` (10), the same values `app.js` already
  used.
- `maxAutoFitWidthMm(canvasWidthMm)` — `canvasWidthMm - PRINTABLE_MARGIN_MM`.
- `computeTextAutoFitScale({ measuredWidthMm, maxWidthMm, heightMm, stoneSizeMm })` — the scale math
  itself, unchanged from `app.js`'s prior inline version, now callable from anywhere.

`app.js`'s `computeAutoFitScale(layer, project, measuredWidthMm)` is now a thin adapter: it maps its
own live-layer field names (`layer.height`, `layer.stoneSize`) onto the shared function's
schema-neutral parameter names and returns its result. `RhsFixtureBridge.js`'s
`generateTextStonesForLayer()` does the same, mapping its own `.rhs` schema's `layer.heightMm` /
`layer.stoneSizeMm` instead. Both call sites now produce identical scales for identical inputs by
construction — there is exactly one implementation of the arithmetic, not two kept in sync by hand.

**Why `computeTextAutoFitScale()` returns `degenerate`, not just `scale`.** The function has exactly
two callers, on two different field-name schemas. A caller that passed the wrong pair (e.g. the
bridge accidentally passing `layer.height`/`layer.stoneSize`, or app.js passing
`layer.heightMm`/`layer.stoneSizeMm`) would silently receive `heightMm`/`stoneSizeMm` as `undefined`,
fall through to the plain fit-to-width branch, and return a plausible-looking `{ scale }` — with
every existing test still green, because nothing was asserting on the *reason* the floor didn't
apply. `degenerate: true` makes that failure mode observable and testable directly (see
`tools/test-read-009-bridge-autofit-floor.mjs` test 2), rather than relying on it happening to
surface as a wrong stone count somewhere downstream.

## 3. Why the fixtures were re-authored, not just re-baselined

The first pass of this milestone (commit `68f606c`) wired the shared floor into the bridge and
regenerated `examples/baselines.json`, without changing either fixture. That moved
`long-name-autofit.rhs` and `long-script-name.rhs` to genuinely overflow the canvas by a wide margin
— exactly reproducing, in the committed baseline, the same overflow READ-008 §4.2 had already found
in the live app. That is correct behavior for the bridge (it now agrees with the live app), but it
left two committed example fixtures in a state no real user should be offered: a floor-clamped
auto-fit that still doesn't fit the object.

At any orderable catalog stone size (`src/renderer/StoneSizes.js`; SS6 at 2.0mm is the smallest),
neither original string can fit a 210mm mug canvas (`maxAutoFitWidthMm(210) = 200mm`) at that size's
own floor-minimum height. Measured directly against the real engine, at `heightMm = diameterMm × 16`
for every catalog size:

| Size | diameterMm | floor-minimum heightMm | "Alexandria Konstantinova" widthMm | "Anastasiya Konstantinovna Volkova" widthMm |
|------|-----------:|------------------------:|-------------------------------------:|----------------------------------------------:|
| SS6  | 2.0 | 32.0  | 459.48  | 379.35  |
| SS10 | 2.8 | 44.8  | 644.74  | 531.27  |
| SS16 | 4.0 | 64.0  | 922.33  | 759.09  |
| SS20 | 4.7 | 75.2  | 1080.89 | 892.41  |
| SS30 | 6.4 | 102.4 | 1473.98 | 1215.22 |

Every cell is far past 200mm. There is no stone size at which either original string can be shown
above the floor without overflowing this canvas — the fixture's *numbers* (stone size, canvas width)
were never the problem to fix; the *text* was too long for any of them. So the fix is to the text,
not to the stone size or canvas width.

**The re-authored fixtures:**

- `long-name-autofit.rhs`: text/`name` "Alexandria Konstantinova" → **"Alexandria"**, `heightMm` 30 →
  **45**. Font (Courier Prime), `stoneSizeMm` (1.8), color, canvas, and wrap unchanged.
- `long-script-name.rhs`: text/`name` "Anastasiya Konstantinovna Volkova" → **"Anastasiya
  Volkova"**, `heightMm` 26 → **45**. Font (Great Vibes), `stoneSizeMm` (1.5), color, canvas, and
  wrap unchanged.

Both still genuinely overflow at their own authored height before auto-fit runs (measured
`widthMm` 269.84 and 295.04 respectively, against `maxAutoFitWidthMm(210) = 200`), so auto-fit still
genuinely engages for both — these remain real auto-fit exercise fixtures, not fixtures where
auto-fit is a no-op. Once auto-fit's plain fit-to-width scale is applied, both land inside the
printable width (scaled width lands at `maxAutoFitWidthMm(210)`, i.e. exactly 200mm, by
construction) without the floor ever needing to clamp:

| Fixture | Text | Authored heightMm | Unscaled widthMm | Auto-fit scale | Resulting heightMm | Resulting height ÷ stoneSizeMm |
|---|---|---:|---:|---:|---:|---:|
| `long-name-autofit.rhs` | "Alexandria" | 45 | 269.84 | 0.7412 | 33.35 | 18.53 |
| `long-script-name.rhs` | "Anastasiya Volkova" | 45 | 295.04 | 0.6779 | 30.50 | 20.34 |

These two ratios (18.53, 20.34) are reported here purely as measurements of where this particular
auto-fit outcome happens to land for these two specific strings/fonts/stone sizes — they are not
evidence for, or against, any particular value of `MIN_HEIGHT_TO_STONE_RATIO`, and neither narrows
READ-008 §2's unresolved 16–20 band. Both ratios exceed 16 only because plain fit-to-width happened
to leave them there for this text; a different string at the same height/stone size could just as
easily land below 16 and require the floor. That the floor is not exercised by either committed
fixture anymore is exactly why `tools/test-read-009-bridge-autofit-floor.mjs` (§5 below) tests
floor-clamping directly, against a synthetic project, rather than relying on the committed corpus to
keep demonstrating it by accident.

`vitalina-serbin.rhs` was not re-authored — its text was never the problem. Its
`gallery.json` description claimed it "exercises the auto-fit rescale pass", which is false: its
measured width (161.07mm) is comfortably under `maxAutoFitWidthMm(210) = 200mm`, so `autoFit: true`
never actually engages for it (`scale: 1` always). Only the description text was corrected, to state
that Auto Fit is enabled but never actually needs to rescale this fixture — the `.rhs` file itself is
untouched.

## 4. Ordering constraint

`tools/generate-example-baselines.mjs` must only be run *after* both fixtures were re-authored and
the tests that assert specific stone counts/scales for them were updated to match. Running it against
the intermediate (floor-wired-but-not-re-authored) state would commit a baseline showing genuine
canvas overflow for both fixtures — technically correct for that intermediate state, but not a state
this repository should ever commit as the fixture corpus's steady state. This milestone's own history
went through exactly that intermediate state (commit `68f606c`) before the fixtures were re-authored
in a follow-up pass; the final committed baseline reflects only the re-authored fixtures.

## 5. Tests

- **`tools/test-read-008-ratio-floor.mjs`** — previously asserted the floor's blast radius was
  *exactly* two named fixtures, with their specific before/after scales hardcoded. Now that no
  committed fixture needs the floor clamped, that hardcoded list would be empty. Restructured into a
  live invariant instead: no fixture in `examples/*.rhs` has a floor-clamped auto-fit scale. This has
  teeth — it fails the moment a future fixture is added or edited into needing the clamp again, which
  is exactly the situation this milestone found and fixed.
- **`tools/test-read-009-bridge-autofit-floor.mjs`** (new) — since no committed fixture demonstrates
  floor-clamping anymore, this suite exercises it directly:
  1. A synthetic in-memory `.rhs` project built from the retired `long-name-autofit.rhs` parameters
     ("Alexandria Konstantinova", Courier Prime, `heightMm` 30, `stoneSizeMm` 1.8, `gapMm` 0.3, canvas
     210×90, `autoFit: true`) is run through the real `validateRhsProject()` →
     `generateProjectStoneLayout()` pipeline. Its stone count is asserted to match a floor-clamped
     `generateTextLayout()` call, and to differ from a plain fit-to-width `generateTextLayout()` call
     — both derived live in the test, neither hardcoded, so the test fails if the bridge ever silently
     reverts to the pre-READ-009 floor-less behavior.
  2. `computeTextAutoFitScale()` returns `degenerate: true` when handed app-schema field names
     (`height`/`stoneSize`) instead of the `.rhs` schema's `heightMm`/`stoneSizeMm` — the exact
     mistake `degenerate` exists to catch (§2).
  3. Every `autoFit` text layer across the real `examples/*.rhs` corpus yields `degenerate: false`,
     confirming the bridge always supplies real, positive `heightMm`/`stoneSizeMm`.
- **`tools/test-geometry-stone-overlap-same-contour.mjs`** test 1's golden stone count for
  `long-script-name.rhs` moved twice this milestone: 363 (pre-READ-009) → 665 (floor wired, fixture
  not yet re-authored) → 586 (final, re-authored fixture). Re-verified directly against the current
  committed geometry, not guessed; still 0 same-contour overlapping pairs, and the fixture remains a
  dense, multi-word Great Vibes script outline with plenty of tight cursive loops, so it continues to
  serve RC-004A's original purpose.
- **`tools/test-examples-regression.mjs`** test 14 (no stone wildly outside canvas) needed a named
  exemption for the two fixtures during the intermediate state (§4); that exemption is removed now
  that both fixtures fit inside the canvas on their own merits.

## 6. Follow-ups

None identified. The gap READ-008 §4 follow-up 1 recorded is closed: the bridge and the live app now
share one auto-fit implementation, and no committed fixture depends on the floor-less behavior that
implementation used to have.
