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
  (`app.js:4724`), `#exportProdSheetPNG` (`app.js:4730`) — calls it as the first statement, before
  their existing `if(!layout)` guard and export work. One shared function, three call sites; the
  logic itself is never duplicated.

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

### The rounding trap

`setLengthField()` writes `formatLengthDisplay(mm, units)` into `.value`; `readLengthField()` parses
back from `.value` (via `displayValueToMm()`), never from the `dataset.mmValue` stash.
`formatLengthDisplay()` rounds to a **fixed number of decimals in the display unit**
(`Number(v.toFixed(2))`). A naive `setLengthField('height', minHeightMm)` can therefore round the
*displayed* value down — e.g. a floor of `44.803mm` displays as `"44.80"`, and reading that back
yields `44.80mm`, which is still below the `44.803mm` floor the button claimed to clear. The same
bites in `'in'` mode: the floor is converted to inches, rounded to 2 decimals for display, and
converted back — rounding down at the display step still lands below the original mm floor after the
round trip.

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
- The fix-to-floor value, after a full `setLengthField()` → `readLengthField()` round trip, lands at
  or above the floor in both `project.units` modes (`'mm'` and `'in'`).
- The fix-to-floor button/hint is hidden when READ-003's stroke message takes precedence.
