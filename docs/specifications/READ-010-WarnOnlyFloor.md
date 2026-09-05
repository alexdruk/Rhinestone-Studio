# READ-010 — project-wide readability warning at Production Sheet export, plus a fix-to-floor affordance

**Status:** implemented. Branch `feature/read-010-warn-only-floor` off `develop`, local-only (not
pushed).

**Authorises:** a project-wide sweep of `MIN_HEIGHT_TO_STONE_RATIO`-floor violations surfaced on the
Production Sheet lightbox and its three export handlers, plus a one-click affordance on the existing
per-layer height warning that writes the floor height directly into `#height`.

---

## 1. Root cause: the floor check is selection-scoped, not project-scoped

READ-008 set `MIN_HEIGHT_TO_STONE_RATIO = 16` (`src/geometry/TextAutoFit.js`). Auto-Fit and
Fit-to-Shape both clamp to it. Everywhere else, `textHeightBelowReadableMinimum()`
(`app.js:2978`) only warns — but "only warns" understates the actual gap. That predicate has exactly
two call sites in the whole codebase:

- `app.js:3042` `updateTextHeightReadabilityUI()`, which reads `selectedLayer()`.
- `app.js:3270` (`updateStoneSizeOverlapCapabilityUI()`, `app.js:3220`), which reads `target.layer` and only uses
  the result to suppress its own crowding hint when a stronger signal already owns the shared
  warning element.

Nothing in the codebase ever asked whether the **project** contains a below-floor text layer.
Four text layers, three below floor, none of them selected — total silence, and the production sheet
exported with no signal at all. A project accumulates below-floor layers by several routes that never
touch the currently-selected layer: a loaded project, an imported `.rhs`, TXT-104's capHeight
conversion, or an undo/redo that writes `l.height` directly. Every one of those can leave a
non-selected layer below floor indefinitely.

The fix is not a stronger per-layer check — the existing predicate is correct and untouched — it is
a caller that asks the question at the right scope: **does this project, not this selection, have a
problem.**

## 2. `textLayersBelowReadableMinimum()`

Added immediately after `textHeightBelowReadableMinimum()` (`app.js:2998`). Iterates
`project.layers`, keeps only `l.visible` layers, calls the existing predicate on each, and returns
the non-null results, each carrying its `layer`. It introduces no second copy of the floor test —
every field of the returned objects (`stoneSizeMm`, `heightMm`, `minHeightMm`) comes straight out of
`textHeightBelowReadableMinimum()`, spread alongside `layer`.

Visible layers only: a hidden layer contributes no stones to the production sheet, so it cannot make
the sheet unreadable. This mirrors `currentProductionSheetOptions()`'s own
`project.layers.filter(l=>l.visible)` (`app.js:4735`) for the sheet's gap-value list.

Authored Production Font layers (RS Block / RS Modern) are excluded for free — inherited from
`textHeightBelowReadableMinimum()`'s own `isAuthoredStoneFontId()` guard, not reimplemented here.

## 3. Production Sheet validation

`index.html:1214` already had `<div class="validation-message" id="prodSheetValidation"
role="alert">` sitting above the SVG/PNG/PDF buttons in the Production Sheet lightbox, with nothing
ever writing to it. `updateProdSheetReadabilityValidation()` (`app.js:4710`) is the first writer: it
builds an itemized message from `textLayersBelowReadableMinimum()`, naming each offending layer via
the existing `layerLabel()` (`app.js:2306`), its current height, and the minimum height for its
stone diameter, formatted through `formatLengthDisplay()`/`unitSuffix()` against `project.units` —
the same formatting `updateTextHeightReadabilityUI()` already uses for its own message. It toggles
`.visible` on the element exactly as `updateTextHeightReadabilityUI()` does for
`#heightBelowReadableWarning`, and writes via `textContent` only — no markup, so no HTML-escaping
concern for layer names.

**Wired at two points so it cannot go stale:**

- `lightboxes.prodSheet`'s `onOpen` (`app.js:4801`) — the same idiom
  `lightboxes.shipping`/`lightboxes.settings` already use to refresh their own fields on open.
- Each of the three export handlers — `#exportProdSheetSVG` (`app.js:4723`), `#exportProdSheetPDF`
  (`app.js:4724`), `#exportProdSheetPNG` (`app.js:4730`) — calls it as the first statement **inside
  their `try` block**, after the existing `if(!layout){…return}` guard. One shared function, three
  call sites; the logic itself is never duplicated.

**Handler ordering constraint.** The call must sit inside `try`, not ahead of the `if(!layout)`
guard where it originally landed. Because the floor is warn-only (see below), a throw from the
readability sweep must not be allowed to escape the handler uncaught: an uncaught exception in the
`onclick` would leave `#status` silent and, worse, read as a dead export button. Inside `try` the
existing `catch(error){ el('status').textContent = 'Export failed: ' + error.message }` reports it
on the same status line every other export failure already uses. Keeping the `!layout` guard first
also means the sweep never runs when there is nothing to export. The three assertions in
`tools/test-read-010-warn-only-floor.mjs` (test 14) and test 21 of
`tools/test-production-sheet-exporter.mjs` both pin this ordering.

Scoped to the Production Sheet only. 2D SVG/PNG, the 3D preview, and the JSON exports are previews
and interchange formats, not the artifact a shop floor actually cuts from — they are deliberately
untouched.

### Why warn rather than block

The `MIN_HEIGHT_TO_STONE_RATIO` floor is font-blind by construction (READ-008), and the 16–20 ratio
band is explicitly unresolved — see the comment block above the constant's declaration in
`src/geometry/TextAutoFit.js`. Blocking a shop's actual production-sheet export on a rule the program
itself calls provisional would trade a real, immediate cost (an operator who cannot get their sheet
at all) for enforcement of a threshold that might move. Escalating a warning to a hard block later,
once the floor is font-aware and the band is resolved, is a small, reversible change — one guard
clause. De-escalating a block back to a warning after shops have already built workflows around "the
tool refuses this" is not free: it means retracting behavior people came to depend on. Given that
asymmetry, this milestone keeps every export path open and puts the decision in the operator's hands,
exactly as `updateTextHeightReadabilityUI()`'s own existing warning already does for the selected
layer.

## 4. Fix-to-floor affordance

`index.html`, directly after `#heightBelowReadableWarning`, gains a hint paragraph following the
exact idiom `#heightModeToggleHint`/`#heightModeToggleBtn` already use two lines below it:
`<p class="hint" id="heightFixToFloorHint" style="display:none"><button type="button" class="btn sm"
id="heightFixToFloorBtn"></button></p>`.

`updateTextHeightReadabilityUI()` (`app.js:3042`) shows this hint only when `below` is truthy and
`stroke` is not — i.e. exactly when the FONT-LIB-004 height message is the one on screen. It stays
hidden when READ-003's stroke message wins precedence (no height increase alone fixes a stroke that's
physically narrower than one stone at any height for this font), and hidden when neither message
shows. The button's label is set from the same `below.minHeightMm` detail
(`Set height to ${formatLengthDisplay(below.minHeightMm,...)} ...`), so it states the exact target
height before the operator clicks it.

The click handler (`app.js:4104`) writes the floor height into `#height` via `setLengthField()`, then
dispatches `'input'` and then `'change'` on `#height` — the same pattern `#letterHeight`'s own
listener uses (`app.js:4072`-ish, writing `#height` and dispatching `'input'`). That inherits
`heightManuallyEdited` marking, history tracking (`HISTORY_TRACKED_CONTROL_IDS`), and regeneration
for free; the handler itself never mutates `l.height` directly and never calls `commitHistory()`.

### Ratio floor, not the catalog midpoint — and why that split is deliberate

The button targets `stoneSizeMm × MIN_HEIGHT_TO_STONE_RATIO` — the exact threshold
`textHeightBelowReadableMinimum()` checks against — **not**
`applyStoneSizeHeightAutoSet()`'s catalog `supportedHeightRangeMm` midpoint. These two numbers can
and do differ: the ratio floor is the minimum height that clears *this specific warning*, while the
catalog midpoint is a font-certification-derived "good default" for a stone size, generally taller
than the bare floor. Targeting the floor is the minimum change that makes the warning the operator is
looking at go away; jumping further, to the catalog's own recommended range, is a separate, larger
decision that belongs to the operator, not to a button next to a warning about one specific
threshold.

**This choice is not sticky.** For every catalog size, the ratio floor sits strictly below that same
size's own `supportedHeightRangeMm[0]` — SS6: 32 vs 35, SS10: 44.8 vs 45, SS16: 64 vs 65, SS20: 75.2
vs 80, SS30: 102.4 vs 106. `applyStoneSizeHeightAutoSet()`'s `isHeightWithinStoneSizeRange()` check
(`src/renderer/StoneSizes.js`) is therefore never satisfied by a height the fix-to-floor button just
wrote, for that same stone size. Since that check only runs from `#stoneSize`'s own `'input'`
listener (`app.js:4038`), the fix-to-floor height survives untouched until the operator changes the
stone size selection at all — but the very next such change, even switching to a different size and
back to the original one, finds `staysValid` false and silently overwrites the height with the new
size's `stoneSizeHeightMidpointMm()`, discarding the fix-to-floor value without any further warning.

### The rounding trap

`setLengthField()` writes `formatLengthDisplay(mm, units)` into `.value`; `readLengthField()` parses
back from `.value` (via `displayValueToMm()`), never from the `dataset.mmValue` stash.
`formatLengthDisplay()` rounds to a **fixed number of decimals in the display unit**
(`Number(v.toFixed(2))`).

**This is not a millimetre-precision problem.** Every catalog stone size's ratio floor
(`diameterMm × MIN_HEIGHT_TO_STONE_RATIO`, `src/renderer/StoneSizes.js`) is already exact at 2
decimals in mm — `2.0×16=32`, `2.8×16=44.8`, `4.0×16=64`, `4.7×16=75.2`, `6.4×16=102.4` — so in `'mm'`
display mode a naive `setLengthField('height', floorMm)` never rounds down at all; the round trip
lands exactly on the floor for all five sizes. The trap is specific to **`'in'` display mode**: the
mm→inch conversion (`÷25.4`) produces a value with far more than 2 decimal digits, and rounding *that*
to 2 decimals for display can land on either side of the true floor depending on the third decimal
digit. Run through the real `setLengthField`/`readLengthField` round trip
(`src/units/LengthUnits.js`'s actual `formatLengthDisplay`/`displayValueToMm`) for all five catalog
sizes in both display modes:

| Size | floorMm | `'mm'` round trip | `'in'` displayed | `'in'` round trip | fails in `'in'`? |
|------|--------:|-------------------:|------------------:|--------------------:|:---:|
| SS6  | 32.0  | 32.0  (exact) | "1.26" | 32.004  | no  |
| SS10 | 44.8  | 44.8  (exact) | "1.76" | 44.704  | **yes** |
| SS16 | 64.0  | 64.0  (exact) | "2.52" | 64.008  | no  |
| SS20 | 75.2  | 75.2  (exact) | "2.96" | 75.184  | **yes** |
| SS30 | 102.4 | 102.4 (exact) | "4.03" | 102.362 | **yes** |

Three of the five catalog sizes (SS10, SS20, SS30) round-trip *below* their own floor in `'in'` mode
under a naive write — SS10's 44.8mm floor becomes "1.76" in, which reads back as 44.704mm, still
short of the 44.8mm the button claimed to clear. SS6 and SS16 happen not to fail only because their
particular inch conversions round *up* at the second decimal by coincidence of arithmetic, not
because inch mode is safe — a different `MIN_HEIGHT_TO_STONE_RATIO` value or a non-catalog stone
diameter could just as easily land either of them on the wrong side too. No catalog size fails in
`'mm'` mode, at any diameter, because the floor is always an exact multiple of a whole number
of millimetres times 16 with no more than 1 decimal digit of its own.

This is exactly why the guard cannot be simplified away by testing only `'mm'` mode: every catalog
size would round-trip correctly there even with a naive `setLengthField('height', floorMm)`, so a
future reader who checks mm mode alone and concludes `ceilToDisplayPrecisionMm()` is unnecessary
overhead would be wrong — the failure only shows up in `'in'` mode, and only for three of the five
sizes.

`ceilToDisplayPrecisionMm()` (`app.js:6007`) fixes this at the source: it converts the floor to the
display unit, rounds **up** at the same 2-decimal precision `setLengthField()`/`formatLengthDisplay()`
use (with a small epsilon subtracted before `Math.ceil()` so a value already exact at that precision
isn't bumped an unnecessary extra step by float noise), then converts back to mm. The button passes
`ceilToDisplayPrecisionMm(below.minHeightMm, project.units)` to `setLengthField()`, so the value that
round-trips through the `.value` string is guaranteed to be at or above the floor, in both unit modes.

## 5. Deferred

- **READ-003's stroke-narrower-than-one-stone check is equally selection-scoped, and this milestone
  does not aggregate it.** `textStrokeNarrowerThanOneStone()` has the same two call sites as
  `textHeightBelowReadableMinimum()` and the same blind spot for a non-selected layer. It was left
  out of `textLayersBelowReadableMinimum()` deliberately — that predicate mirrors
  `textHeightBelowReadableMinimum()` alone, per the milestone's own scope, and folding in a second,
  stronger signal with its own precedence rules is a larger change than "make the existing height
  check project-wide." A future milestone can add a parallel project-wide stroke sweep, or unify both
  under one project-wide readability report.
- **Revisiting warn-vs-block once the floor becomes font-aware.** §3's reasoning is contingent on the
  floor's provisional status (READ-008's unresolved 16–20 band, and its font-blindness). If a future
  milestone (READ-006's Layer 3 font- and mode-aware floors, referenced in
  `index.html`'s own comment on `#heightBelowReadableWarning`) replaces this with a floor that is
  actually validated per font, blocking export becomes a much more defensible trade — but that
  decision should be made then, against that floor, not now against this provisional one.

## 6. Tests

`tools/test-read-010-warn-only-floor.mjs` (new, auto-discovered by `tools/run-tests.mjs`), following
the `sliceBalanced()` real-source-execution harness pattern
`tools/test-font-lib-004-height-readability.mjs` already established. Covers:

- `textLayersBelowReadableMinimum()` finds every below-floor visible text layer in a multi-layer
  project, and finds none when all layers are at or above floor.
- Hidden below-floor layers are excluded.
- Authored Production Font layers are excluded (inherited from the per-layer predicate).
- Production Sheet validation itemizes below-floor visible text layers by name in a genuinely
  mixed-type project (a non-text layer is present alongside the text layers), and `layerLabel()`'s
  non-text `SHAPE_DISPLAY_LABELS` fallback branch is exercised directly against a non-text layer —
  not merely included in the project, since `updateProdSheetReadabilityValidation()` only ever calls
  `layerLabel()` on layers `textLayersBelowReadableMinimum()` already filtered to text, so a non-text
  layer alone in the project never reaches that branch through that path.
- The fix-to-floor value, after a full `setLengthField()` → `readLengthField()` round trip, lands at
  or above the floor in `'mm'` mode (test 7, using several representative values) and in `'in'` mode
  (test 8). Test 9 additionally proves the guard is load-bearing on a real, reachable input — SS10's
  own ratio floor (44.8mm) in `'in'` mode, the case identified in §4 — showing both that a naive
  (non-ceiled) write round-trips below the floor there, and that the same input through
  `ceilToDisplayPrecisionMm()` clears it.
- The fix-to-floor button/hint is hidden when READ-003's stroke message takes precedence.
