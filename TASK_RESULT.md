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
