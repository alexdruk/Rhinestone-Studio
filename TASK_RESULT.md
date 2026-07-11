# Rhinestone Studio — Task Result

This document is completed by the implementation engineer after finishing the current task.

---

# Task ID

RS-1003 — Curved Text

---

# Status

IMPLEMENTED

---

# Branch

feature/rs-1003-curved-text

---

# Commit

Do not write the current commit hash into this file — this file is part of the same commit it
describes. Obtain it from Git history with:

```bash
git log -1 --oneline
```

---

# Summary

Every text layer now supports a Straight (unchanged) or Curved layout. Curved text is implemented
entirely as a new "Arc projection" stage inside the permanent `src/geometry/GeometryEngine.js`
(`generateTextLayout()`), between contour flattening and outline/fill stone sampling — exactly the
pipeline position the milestone brief specified (`Text -> OpenTypeProvider -> VectorPath ->
GeometryEngine -> Arc projection -> StoneLayout -> existing renderers`). `StoneLayout`,
`src/renderer/**`, and `src/export/**` were not touched: the 2D canvas, cup preview, and all five
export formats picked up curved text automatically, with zero code changes, because they only ever
consume `StoneLayout`.

Six new per-text-layer fields (`curveEnabled`, `curveRadiusMm`, `curveDirection`,
`curveStartAngleDeg`, `curveSweepAngleDeg`, `curveAlignment`) are forwarded straight through from
`app.js`'s layer object to `GeometryEngine.generateTextLayout()`; `app.js` generates no geometry
itself. Curved text is fully editable: every parameter is wired into live regeneration, the
existing undo/redo history mechanism, Project JSON save/load, and layer duplication — the last
three needed **zero new code**, because `app.js`'s existing generic deep-clone (`duplicateLayer()`)
and verbatim field-spread (`validateProject()`) already preserve arbitrary layer fields.

Full detail, including the geometric model and the reasoning behind each parameter's semantics, is
in `docs/specifications/RS-1003-CurvedText.md`.

---

# Files Changed

```
src/geometry/ArcProjection.js        (new — pure arc-projection math: projectPointToArc(),
                                       projectPolygonToArc(), CURVE_DIRECTIONS, CURVE_ALIGNMENTS)
src/geometry/GeometryEngine.js       (generateTextLayout(): _buildPositionedContours() now also
                                       returns totalAdvanceWidthMm; new arc-projection step between
                                       flattening and sampling, gated on options.curveEnabled;
                                       normalizeTextParams()/new normalizeCurveParams() validate the
                                       six curve fields only when curveEnabled is truthy)
src/geometry/index.js                (barrel export for ArcProjection.js)
app.js                               (defaultProject(): six curve fields on the default text layer;
                                       generateTextStonesLive(): forwards all six fields;
                                       syncSelectedControlsFromLayer()/writeSelectedControlsToLayer():
                                       read/write all six + curveControls visibility toggle;
                                       HISTORY_TRACKED_CONTROL_IDS: six new ids; header comment note)
index.html                           (#textControls: curveEnabled select, #curveControls block with
                                       radius/direction/start angle/sweep angle/alignment controls)
package.json                         (registers the two new test files in the `test` script)
tools/test-arc-projection.mjs        (new — 15 tests, pure math unit tests of ArcProjection.js)
tools/test-geometry-engine.mjs       (13 new numbered tests, 31-43: straight-text regression,
                                       outside/inside, clockwise/counter-clockwise, start/center/end
                                       alignment, fill/outline modes, determinism, small-radius
                                       finite-coordinate stress case, and all four required rejection
                                       cases)
tools/test-curved-text-integration.mjs (new — 11 tests, structural checks against live app.js/
                                       index.html: field wiring, history tracking, UI controls,
                                       duplicate/import needing no new code, renderer/exporter
                                       untouched, other forbidden paths untouched)
docs/specifications/RS-1003-CurvedText.md (new specification)
docs/ARCHITECTURE.md                 (Geometry Engine implementation-status note)
TASK.md                              (replaced with this task)
TASK_RESULT.md                       (this file)
```

No other file was changed. `src/text/**`, `src/fonts/**`, `src/core/**`, `src/browser/**`,
`src/svg/**`, `src/history/**`, `src/renderer/**`, `src/export/**`, and `assets/**` were not
touched — the milestone required no change to any of them, and this is now verified by
`tools/test-curved-text-integration.mjs` tests 10-11.

---

# Commands Executed

```bash
npm test              # 22 suites, all pass (0 failures)
git diff --check       # clean
git status              # only the files listed above
npm run dev             # static file server on :5173 (already running from a prior session), used
                         # for browser verification
```

---

# Automated Test Results

`npm test` passes in full — 22 suites, zero failures:

```
Core model tests passed. / Font manager tests passed. / Vector path tests passed. /
FontProviderRegistry tests passed. / OpenTypeProvider tests passed. /
Default font provider registry tests passed. / SVG parser tests passed. /
Arc projection tests passed.                    (new, 15/15)
GeometryEngine tests passed.                     (47 tests total, incl. 13 new curved-text tests
                                                   numbered 31-43)
Stone color tests passed. / History manager tests passed. /
App module migration tests passed. / Browser dependency loading tests passed. /
Live text integration tests passed. / Shape geometry integration tests passed. /
SVG integration tests passed. / Undo/redo integration tests passed. /
Curved text integration tests passed.            (new, 11/11)
Render/export pipeline tests passed. / Production export validation tests passed. /
UX visual polish tests passed.                   (includes the pre-existing pinned straight-text
                                                   regression: exactly 391 stones, widthMm~=199.385,
                                                   heightMm~=16.979 for the default project — proves
                                                   straight text is genuinely unchanged)
Cup rotation stabilization tests passed. / Examples regression suite passed.
```

Regression-test verification (not part of the normal `npm test` run — done manually to prove the
new tests are real): re-ran `tools/test-geometry-engine.mjs` test 31 (straight-text regression)
against the pre-milestone `GeometryEngine.js` via `git stash` — it passed unchanged (confirming
`curveEnabled` genuinely defaults to a no-op), then confirmed tests 32-43 all fail against the
pre-milestone code (no `curveEnabled` param existed) and pass after restoring the fix.

---

# Browser / Manual Verification

Performed via a from-scratch headless-Chrome/CDP driver (raw DevTools Protocol over Node's native
`WebSocket`, no new dependency — matching this repository's established precedent), against
`npm run dev` (static file server on `:5173`), Chrome launched headless with
`--window-size=1440,960` and `Emulation.setDeviceMetricsOverride(1440x900)`.

Verified, in one continuous session (screenshots captured, session-local, not committed):

* [x] Page loads, no console errors on load.
* [x] Default project (straight text, `curveEnabled:false`) renders unchanged — 375 stones,
      199.4×17.0mm, matching the pre-milestone baseline.
* [x] Enabling curved text (`curveEnabled:on`) live-regenerates the layout with no reload: 495
      stones, arced into a circle.
* [x] **Small radius** (10mm, sweep 360°, 25mm-tall text): text overlaps through the circle's
      center, producing a dense flower-like pattern — the honest, finite-coordinate consequence of
      text taller than the radius (verified: all coordinates finite, no NaN/crash). See "Warnings".
* [x] **Large radius** (150mm): 1081 stones, a gentle 315.6×317.5mm arc.
* [x] **Sweep 180°/270°/360°**: distinct stone counts and bounding boxes at each (408/514/625
      stones), confirming sweep genuinely controls how much of the circle the text occupies.
* [x] **Inside vs. outside direction**: visually confirmed via screenshot — outside produces
      upright, outward-facing letters (readable arching over the top, like a badge); inside produces
      letters flipped toward the center (the documented, honest consequence of the inside/outside
      rule applied at a top-of-circle placement — see the specification's "Geometry Model").
* [x] **Font switching while curved**: Great Vibes (script font) renders as a smooth, continuous
      curved ribbon; switching back to Courier Prime live-updates correctly.
* [x] **Outline and fill modes while curved**: both produce valid, non-empty curved layouts.
* [x] **Start/center/end alignment**: at a partial sweep (120°, distinguishable from a full circle)
      produced three visibly different placements (77.2×110.2mm / 125.6×44.9mm / 77.0×113.7mm) — the
      `align-center` screenshot shows "Vitalina Serbin" cleanly centered and arching over the top,
      the canonical curved-text look.
* [x] **Cup preview**: reflects curved text automatically in every screenshot (a visible ring/arc of
      gold stones on the cup), with zero renderer changes — confirms "Cup preview works
      automatically."
* [x] **Undo/redo across curve edits**: status changed to "Undo"/"Redo" and the layout reverted/
      reapplied correctly.
* [x] **Duplicate layer preserves curve**: duplicating the curved layer auto-selected the new layer,
      whose curve controls showed identical values to the original (radius 60, direction outside,
      sweep 180, alignment center).
* [x] **Save/load round-trip**: exported the live Project JSON (intercepting the real
      `URL.createObjectURL` Blob, not a re-implementation), then re-imported it through the real
      `#importProjectFile` change handler via a genuine `File`+`DataTransfer`; every curve field
      round-tripped exactly.
* [x] **Validation rejection**: imported a Project JSON with `curveRadiusMm:0` through the real
      import path — `GeometryEngine` threw `RangeError: curveRadiusMm must be positive.`, caught by
      `updateAll()`, logged once to `console.error`, with zero uncaught page exceptions. See
      "Warnings" for a related, pre-existing display nuance found during this check.
* [x] **All five exports** (Project JSON, Generated Layout JSON, SVG, PNG, Cup PNG) succeeded for a
      curved layer — confirmed via a `download`-click filename capture that survives the async
      `canvas.toBlob()` callback (`rhinestone-project.json`, `rhinestone-generated-layout.json`,
      `rhinestone-layout.svg`, `rhinestone-layout.png`, `rhinestone-cup-preview.png`).
* [x] Zero console errors across all normal editing/exporting steps. Exactly one `console.error` was
      logged, during the deliberate validation-rejection check above — the correct, intended
      behavior (proving the rejection path works), not a regression.

---

# Warnings

* **Small-radius overlap is expected, not a bug.** When `curveRadiusMm` is small relative to the
  text's height, ascenders/descenders (whose effective radius is `curveRadiusMm ∓ v`) can extend
  past the circle's center, producing overlapping/crossing glyph geometry. All coordinates stay
  finite (tested explicitly, `tools/test-geometry-engine.mjs` test 39, at `curveRadiusMm:2`).
  Clamping or warning about this was not in scope (interactive curve handles / live visual
  guardrails are explicitly out of scope per the milestone brief) — a future milestone could add a
  soft warning if this proves confusing in practice.
* **`'inside'` direction is a fixed geometric rule, not placement-aware.** It always points glyph
  "up" toward the circle's center, which reads correctly for bottom-of-circle or ring-interior text
  but produces upside-down-looking text if paired with a top-of-circle placement. This is documented
  behavior (see the specification's "Geometry Model"), matching how existing circular-text tools'
  inside/outside toggles already work — not a bug.
* **Pre-existing status-message quirk found (not introduced by this milestone).** When a Project
  JSON import triggers a `GeometryEngine` generation error (curved-text-invalid or otherwise —
  reproducible with e.g. an invalid font id too, unrelated to curves), `updateAll()`'s internal
  `catch` briefly sets `#status` to the specific error message, but the `importProjectFile` change
  handler's `await updateAll(true)` call returns normally afterward (the error is swallowed inside
  `updateAll()`, by design, so a single failed regeneration never crashes the surrounding action) and
  immediately overwrites `#status` with its own "Imported X: N layer(s)" success message — so the
  user briefly sees a success message even though the layout actually failed to regenerate and is
  showing a stale layout. The `console.error` and the underlying rejection are both real and correct;
  only the final displayed status text is misleading in this one scenario. This is a pre-existing
  `app.js` behavior (the same code path existed, unchanged, before this milestone, for every layer
  type) — fixing it is a cross-cutting `app.js` import-flow change outside RS-1003's scope, and is
  recorded here rather than fixed silently.
* **UI-level `parseFloat(...)||default` coercion for `curveRadiusMm`/`curveSweepAngleDeg`.** Typing a
  literal `0` into either field is silently coerced to a safe default (`40`/`360`) before it ever
  reaches `GeometryEngine`, matching the exact pattern every other numeric text-layer field
  (`height`, `stoneSize`, `gap`) already uses in this app. This means a user cannot literally type
  `0` into these two fields and see the engine's rejection message — the engine's own validation
  (tested directly, and reachable via Project JSON import) is the real, verified guarantee; the UI
  guard is an intentional, pre-existing-pattern-consistent extra layer, not a gap.

---

# Known Limitations

Unchanged from prior milestones' recorded scope, plus this milestone's own explicit out-of-scope
list: Bezier text, text on arbitrary/freehand paths, perspective text, interactive curve handles
(drag handles on canvas), multiple baselines, non-uniform/variable per-character spacing. As noted in
the specification, `curveSweepAngleDeg` uniformly stretches the text's existing pen-position axis
onto the requested angle (matching `CupRenderer`'s existing wrap-mode precedent) — this is a
deliberate, documented design decision, not an oversight.

---

# Recommended Next Milestone

Unchanged candidates from prior `TASK_RESULT.md`s remain open: multi-object grouping, per-layer
rotation for shape/SVG layers, migrating `app.js`'s ad hoc project model onto
`src/core/Project.js`/`Layer.js`. No new candidate is added by this milestone beyond the two minor,
pre-existing nuances recorded above under "Warnings" (neither blocks merge).

---

# Addendum — UI Discoverability Fix

**Branch:** fix/rs-1003-ui-discoverability
**Status:** IMPLEMENTED

## Root Cause

After RS-1003 merged into `develop`, manual testing reported that Curved Text, SVG Import, and Shape
tools (Add circle/Add rectangle) could not be found in the running app. Investigation (headless
Chrome/CDP, `getBoundingClientRect()` measurements at four realistic viewport sizes) found:

* **Not missing, not disconnected, not developer-only.** Every control existed in the DOM with
  correct `id`s, every event listener in `app.js` was correctly wired, and `GeometryEngine`/
  `StoneLayout` were unaffected — confirmed by re-running the full RS-1003 browser verification
  script, which drove every one of these controls successfully via real DOM events.
* **Not a non-user-interaction artifact of the original RS-1003 verification.** That verification
  used the same real `dispatchEvent`/`click()` DOM interactions a user's mouse/keyboard would
  trigger; it did not call any internal JS function directly for these three features.
* **The actual defect: layout/discoverability.** The left sidebar (`.side` in `index.html`) had grown
  to `scrollHeight` 1615px, while `.side`'s own `clientHeight` (the visible viewport) was only
  694-1006px at every tested size except one. `overflow-y` was already `auto` (scrolling was
  technically possible), but:
  1. "Add circle"/"Add rectangle"/"Import SVG" sat at `top: 807-863px` — below the fold (`clientHeight`
     694-826px) at 1440×900, 1366×768, and 1280×800; only visible without scrolling at 1920×1080.
  2. The panel gave **zero visual indication** that more content existed below the fold — no shadow,
     fade, "more" affordance, or any cue distinguishing "the panel has ended" from "there is more if
     you scroll." A user has no reason to suspect three major feature buttons are one scroll away.
  3. RS-1003 made this measurably worse by inserting a "Curved text" row into the already-long
     `#textControls` block sitting above the Layers/shape-tools section, pushing everything below it
     (shape tools, SVG import, 3D view, exports) further down.

Screenshot evidence (`inspect-common-laptop.png`, pre-fix, 1366×768): the visible panel ends exactly
at the "Layers" label with nothing else shown — "Add circle"/"Add rectangle"/"Import SVG" are 100%
invisible with no hint they exist, matching the report exactly.

## Fix

`index.html` only — no `app.js`, `GeometryEngine.js`, or `StoneLayout.js` change (verified by a new
test, see below):

1. **Reordered** the Layers section (layer list, "Add circle", "Add rectangle", "Import SVG" + its
   hidden file input, "Delete selected layer") to sit immediately after the "Selected layer" dropdown,
   before any per-layer-type detail controls (`#textControls`/`#shapeControls`/`#svgControls`). This
   is a pure move — no element was duplicated, removed, or given new behavior; `app.js`'s `el(id)`
   lookups are ID-based and do not depend on DOM order, so no JS change was needed.
2. **Added a CSS-only scroll-shadow** to `.side` (a well-established, `background-attachment:local`-
   based technique, no JavaScript): a soft shadow now appears at the bottom edge of the panel whenever
   there is more scrollable content below, and disappears once the user has actually scrolled to the
   true end — giving the remaining content (curved-text detail fields, stone/cup settings, 3D view,
   exports) a genuine, always-correct "scroll for more" cue instead of relying on an easy-to-miss
   native scrollbar.

## Files Changed

```
index.html                         (moved the Layers/shape-tools/SVG-import block; added a
                                     scroll-shadow background to .side)
tools/test-ui-discoverability.mjs  (new — 7 structural tests: layer-creation tools now precede all
                                     per-layer detail controls and sit immediately after the layer
                                     selector; no duplicated elements; the pre-existing
                                     #textControls/#shapeControls adjacency other tests depend on
                                     still holds; .side declares a real scroll-shadow; app.js still
                                     wires every id; GeometryEngine.js/StoneLayout.js untouched)
package.json                       (registers the new test)
TASK.md, TASK_RESULT.md            (this addendum)
```

No other file was changed. `app.js`, `src/geometry/**`, `src/renderer/**`, `src/export/**`, and every
other module are byte-for-byte untouched.

## Commands Executed

```bash
npm test        # 23 suites, all pass (0 failures)
git diff --check # clean
git status        # only the files listed above
npm run dev       # static file server on :5173 (already running), used for browser verification
```

## Browser / Manual Verification

Headless Chrome/CDP (raw DevTools Protocol, no new dependency), against `npm run dev`, at four
realistic viewport sizes: 1280×800, 1366×768, 1440×900 (my own RS-1003 verification size), 1920×1080.

**Before the fix** — `getBoundingClientRect()` measurements:

| Size | curveEnabled visible? | addCircle/addRect visible? | importSvg visible? |
|---|---|---|---|
| 1280×800 | yes | **no** | **no** |
| 1366×768 | yes | **no** | **no** |
| 1440×900 | yes | **no** | **no** |
| 1920×1080 | yes | yes | yes |

**After the fix** — same measurements, all four sizes:

| Size | curveEnabled visible? | addCircle/addRect visible? | importSvg visible? |
|---|---|---|---|
| 1280×800 | yes | yes | yes |
| 1366×768 | yes | yes | yes |
| 1440×900 | yes | yes | yes |
| 1920×1080 | yes | yes | yes |

Functional smoke test at 1366×768 (post-fix), one continuous session:

* [x] Clicked `#addCircle` — a "Circle" layer was added, layout regenerated (418 stones).
* [x] Clicked `#addRect` — a "Rectangle" layer was added, layout regenerated (496 stones).
* [x] Selected the circle layer — `#shapeControls` correctly became visible (`display:block`).
* [x] Clicked `#importSvg` — correctly triggers the hidden `#importSvgFile` file input's `click()`.
* [x] Imported a real SVG (`<circle>`, via a genuine `File`+`DataTransfer`+`change` event) — added a
      "test.svg" layer, status showed "Imported test.svg: 1 shape(s)".
* [x] Re-selected the text layer and enabled Curved text — regenerated correctly (a 4-layer project:
      text + circle + rectangle + SVG, all visible together in the 2D layout and cup preview,
      screenshot `func-03-curved-text-still-works.png`).
* [x] Zero console errors, zero page exceptions throughout.

Screenshots captured (session-local, not committed): `inspect-common-laptop.png` (before, showing the
cut-off panel), `after-fix-common-laptop.png` and `bottom-crop.png` (after, showing Add circle/Add
rectangle/Import SVG at the top and the scroll-shadow at the bottom edge), `func-01`–`func-03` (the
functional smoke test above).

## Warnings

* Export buttons (`#exportProject` etc.) still require scrolling to reach at every tested size except
  1920×1080 — this was not part of the reported issue (exports were separately verified reachable and
  working in RS-1003's original browser verification) and is now clearly signaled by the new
  scroll-shadow, so it was left as-is rather than also reordered, to keep this fix minimal and
  targeted at the three specifically-reported capabilities.
* The underlying total sidebar content height (1615px) is unchanged by this fix — it is a reordering
  and affordance fix, not a content-reduction fix. If a future milestone adds more per-layer controls,
  the same class of problem can recur; a longer-term fix (e.g. splitting the sidebar into a
  fixed-header toolbar plus an independently scrolling properties region) is a reasonable follow-up
  but was intentionally not done here per "do not implement new features."

## Known Limitations

None beyond the "Warnings" above.

## Recommended Next Milestone

Consider a structural sidebar redesign (fixed toolbar + independently scrolling properties panel) if
future milestones continue to add per-layer controls — flagged as a warning above, not a blocking
issue today.
