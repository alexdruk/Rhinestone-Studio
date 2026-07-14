# Rhinestone Studio — Task Result

This document is completed by the implementation engineer after finishing the current task.

---

# Task ID

S-104 — Text Position Recovery & Drag Tuning

---

# Status

IMPLEMENTED

---

# Branch

feature/s-104-text-position-recovery-drag-tuning

---

# Commit

Do not write the current commit hash into this file — this file is part of the same commit it
describes. Obtain it from Git history with:

```bash
git log -1 --oneline
```

---

# Audit Findings

Full detail in `docs/specifications/S-104-TextPositionRecoveryDragTuning.md`. Summary:

* **Move-drag was a 1:1 pointer-to-mm mapping.** `app.js`'s `layoutCanvas` `pointermove` handler
  applied `rawDx`/`rawDy` (from `pointerToLayout(e)`) to the dragged selection's position verbatim.
  One CSS pixel of pointer movement always produced the same mm movement, making fine text placement
  imprecise — text has no resize handles to fall back on (`hitTest()` explicitly excludes text from
  resize-handle hits). This is the same class of "unexplained inline drag multiplier"
  `docs/ARCHITECTURE.md` had already called out and fixed once before, for cup rotation
  (`CUP_ROTATION_SENSITIVITY`, since removed when `OrbitControls` took over rotation).
* **A text layer has no persisted absolute position of its own.** `computeTextPlacementOffset()`
  (RS-1009/RS-1012, unchanged) always auto-centers the generated bounding box on the full production
  canvas, then adds `layer.x`/`layer.y` on top — so a text layer's rendered world-center is always
  exactly `(canvas.width/2 + layer.x, canvas.height/2 + layer.y)`, independent of its content, font,
  or size. There was no UI action using this fact to recover a lost layer, and no reset affordance on
  the Text Lightbox's existing `#textX`/`#textY` inputs.
* **The printable area is `getSafeAreaRectMm()`** (`src/products/ObjectTemplate.js`, unchanged),
  already used for the safe-area guide and drag-snap targets. Every current object template
  (Mug/Tumbler/Bottle) has symmetric insets, so its center currently coincides with the raw canvas
  center — the implementation reads the safe-area rect rather than relying on that coincidence, so it
  stays correct if an asymmetric template is ever added.
* **Recovery path already half-existed.** The Layers-list row selection (RS-1009) already lets an
  operator select a layer regardless of whether it is currently visible on-canvas — the missing piece
  was purely a position-only reset action once selected.

---

# Implementation Summary

* `app.js` — new named constant `LAYER_MOVE_DRAG_SENSITIVITY = 0.5`, applied to the move-drag delta
  (`dx=rawDx*LAYER_MOVE_DRAG_SENSITIVITY,dy=rawDy*LAYER_MOVE_DRAG_SENSITIVITY`) before snapping/
  Shift-axis-lock/position-apply. Resize-drag and keyboard nudge are structurally untouched.
* `app.js` — new `centerSelectedTextOnObject()`: guards to text-only selections, computes the target
  `(x,y)` from `getSafeAreaRectMm(currentObjectTemplate(), project.canvas.width,
  project.canvas.height)`, writes only `l.x`/`l.y`, and follows the exact same
  `commitHistory()` → mutate → `syncSelectedControlsFromLayer()`+`updateAll(true)` → `#status` pattern
  every other mutating action (`runAlign`/`runDistribute`/`nudgeSelection`) already uses.
* `index.html` — new `Center on Object` button (`#centerTextOnObject`, reusing the existing `.btn .sm`
  class — no new CSS) in the Text Lightbox's existing Position section, under `#textX`/`#textY`, plus
  one sentence added to the section's existing hint paragraph pointing at it for the "dragged my text
  away" scenario.
* No changes to `GeometryEngine`, `StoneLayout`, any renderer (`src/renderer/**`, `src/preview3d/**`),
  any exporter (`src/export/**`), the project/layer schema (no field added/removed/renamed —
  `layer.x`/`layer.y` already existed since RS-1009), Design Library (`src/library/**`), or Gallery
  (`src/gallery/**`).

---

# Files Changed

**New (2):**
```
docs/specifications/S-104-TextPositionRecoveryDragTuning.md
tools/test-s104-text-position-recovery-drag-tuning.mjs
```

**Modified (6, plus four rounds of follow-up touches to `index.html`/`app.js`/the new test/this file):**
```
app.js                                          — LAYER_MOVE_DRAG_SENSITIVITY, centerSelectedTextOnObject();
                                                   follow-up 2: isTextOutsidePrintableArea(),
                                                   updateTextOutsidePrintableWarning();
                                                   follow-up 3: ratio-based threshold correction;
                                                   follow-up 4: dual-surface toggle, workspace button wiring
index.html                                      — Center on Object button + hint sentence;
                                                   follow-up: .primary styling + icon for discoverability;
                                                   follow-up 2: #textOutsidePrintableWarning;
                                                   follow-up 4: #workspaceTextOutsideWarning in #rightInspector
package.json                                    — new test wired into the `test` script
tools/test-alignment-snapping-integration.mjs   — one assertion updated for the intentional sensitivity change
TASK.md                                         — this milestone's task definition
TASK_RESULT.md                                  — this file
```

Follow-up (discoverability fix) additionally touched:
```
docs/specifications/S-104-TextPositionRecoveryDragTuning.md   — audit + fix addendum
tools/test-s104-text-position-recovery-drag-tuning.mjs        — new check 4b locks in the .primary class
```

Follow-up 3 (coordinate-space audit + partial-overlap fix) additionally touched:
```
docs/specifications/S-104-TextPositionRecoveryDragTuning.md   — coordinate-space audit + fix addendum
tools/test-s104-text-position-recovery-drag-tuning.mjs        — new check 12b locks in the ratio formula
```

Follow-up 4 (workspace warning) additionally touched:
```
docs/specifications/S-104-TextPositionRecoveryDragTuning.md   — placement audit + fix addendum
tools/test-s104-text-position-recovery-drag-tuning.mjs        — new checks 15-17
```

---

# Test Results

```bash
$ npm test
```

**840 checks run, 0 failures, exit code 0** as of the final commit (see the Follow-up sections below
for how this grew across four review rounds: 831 → 832 → 836 → 837 → 840). Includes the new
`tools/test-s104-text-position-recovery-drag-tuning.mjs` suite (18/18 passing) and the updated
`tools/test-alignment-snapping-integration.mjs` (28/28 passing, including the one assertion this
milestone deliberately changed). Every other pre-existing suite (font/geometry/history/editing/
alignment/snapping/export/preview3D/image/Gallery/Design Library/Typography/Project-Model-
Consolidation/etc.) passes unchanged.

```bash
$ git diff --stat HEAD~1..HEAD
```
(run after commit — see `git log -1 --oneline` for the commit this refers to)

---

# Browser Verification

Real headless Chromium (Playwright, project's local `node_modules`), `npm run dev`
(`python3 -m http.server 5173`), 1440×900 viewport, 2D-Canvas-only view. All steps against the actual
running app (no mocks):

1. **Moderate drag, reduced sensitivity confirmed live.** A 200×100 CSS-px drag from the default
   `(0,0)` text position landed at `(50.56, 26.51)` mm — proportional, controllable movement. Undo
   returned it to exactly `(0, 0)`.
2. **Text can still be positioned anywhere, including fully outside the printable area.** A
   1400×900 CSS-px drag moved the text to `(366.79, 235.80)` mm — far outside the 210×90mm mug canvas
   (safe area 182×70mm). Screenshot confirms the stones render clearly outside the printable-area
   guide rectangle.
3. **Center on Object immediately restores visibility.** Selected the text layer via the Layers list,
   opened More Options → Text Lightbox, clicked **Center on Object**: Position X/Y immediately read
   `(0, 0)`, `#status` read "Centered text on the printable area", and the screenshot shows the text
   stones back inside the printable-area grid. Font (`courier-prime-regular`), height (`25`), auto-fit,
   fill style (`stroke`), stone size (`2`), color (`gold`), and curve setting (`off`) were verified
   byte-identical before and after via a full property snapshot comparison (not just visual).
4. **Undo/Redo still works.** After closing the lightbox, Undo returned Position X/Y to the
   off-canvas `(366.79, 235.80)`; Redo returned to `(0, 0)` — one history step each, as intended.
5. **Console.** Zero console errors or page errors captured across the entire session (no favicon
   warning was even triggered in this run).

Screenshots captured at every step (initial state, after moderate drag, after off-canvas drag, Text
Lightbox open on an off-canvas layer, after Center on Object, after undo/redo).

---

# Follow-up: Visibility/Discoverability Audit

A visual reviewer reported the Center on Object button was not visible during manual testing. Full
detail in `docs/specifications/S-104-TextPositionRecoveryDragTuning.md` §"Follow-up: Visibility/
Discoverability Audit". Summary:

* **Audited, did not implement anything new, until root cause was determined.** Confirmed the button
  was actually added (`id="centerTextOnObject"`, exactly once, inside the Text Lightbox's Position
  section — unchanged location), correctly wired (`app.js`, no console errors), and is shown only while
  `#lightboxText` is open (same visibility condition as every other text property).
* **Reproduction across both entry points (top-menu Text, Inspector More Options) and five viewport
  sizes (1440×900 down to 1024×768) found no rendering or functional bug** — the button was always
  present, correctly positioned (no scrolling needed), `visibility:visible`/`opacity:1`, and clickable.
* **Root cause: a discoverability gap, not a bug.** The button used the same plain `.btn.sm` style as
  a neutral secondary field, blending into the surrounding form instead of reading as an action — a
  real usability problem for a feature whose purpose is fast recovery from a mistake, even though
  nothing was non-functional.
* **Fix (index.html only):** button now carries `.primary` (`class="btn sm primary"`), the same blue
  treatment already used for `Export`/`Save`/`Save Project`, plus a `↺` icon glyph. No change to the
  button's location, id, wiring, guard logic, or `app.js`'s `centerSelectedTextOnObject()` — it is
  byte-identical to before this follow-up. A new locked-in test assertion (check 4b in
  `tools/test-s104-text-position-recovery-drag-tuning.mjs`) guards against this regressing back to a
  plain, easy-to-overlook button.
* **Re-verified** via headless Chromium (1440×900): opened the Text Lightbox through the plain
  top-menu **Text** button (no drag, no More Options detour — the most direct discovery path),
  confirmed the button renders immediately with no scrolling, edited the text content and position by
  hand, clicked **Center on Object**, and confirmed the position reset to `(0, 0)` while the just-typed
  text content was left untouched. Zero console errors.

`npm test` after this follow-up: **832 checks, 0 failures** (one new assertion, 4b, added to lock in
the `.primary` styling).

---

# Follow-up 2: Outside-the-Printable-Area Warning

A second visual-review request: warn in the Text Lightbox when selected text has moved materially
outside the printable safe area, live, clearing automatically once back inside, without ever blocking
the move. Full detail in `docs/specifications/S-104-TextPositionRecoveryDragTuning.md` §"Follow-up 2".
Summary:

* **Threshold correction caught by browser verification, not shipped blind.** The first attempt used
  "not fully contained by the safe area." Verifying it live immediately showed a false positive: the
  *default, never-moved* text already overhangs the safe area (`199.4×17.0mm` bbox vs. `182×70mm` safe
  area — auto-fit caps to canvas width, not safe-area width, pre-existing/unrelated behavior). Fixed to
  fire only when the bbox has **no overlap at all** with the safe area (fully disjoint, small
  tolerance) — this also intentionally mirrors Center on Object's own "completely outside" scope, so
  the warning is a correct signal for exactly when that button is the fix.
* `app.js` — new `isTextOutsidePrintableArea(l)` (pure: `getLayerBBox()` vs `getSafeAreaRectMm()`,
  tolerance = existing `SNAP_TOLERANCE_MM`) and `updateTextOutsidePrintableWarning()` (DOM-only
  `.visible` class toggle). Neither writes any layer field — moving text outside the area is never
  prevented. Wired into `updateAll()` right after `layout` regenerates, so it is live on every
  position-changing action (drag, nudge, align, Undo/Redo, and every keystroke in `#textX`/`#textY`).
* `index.html` — `#textOutsidePrintableWarning`, reusing the existing `.validation-message`/`.visible`
  alert styling already used elsewhere in this same lightbox (no new CSS), placed between the X/Y
  fields and Center on Object (unchanged, still `.primary`).
* No changes to `GeometryEngine`, `StoneLayout`, any renderer, any exporter, or the project schema.

**Tests:** 4 new checks (10–13) in `tools/test-s104-text-position-recovery-drag-tuning.mjs`. `npm
test`: **836 checks, 0 failures**.

**Browser verification** (headless Chromium, 1440×900): baseline `(0,0)` → warning hidden (confirms
the corrected threshold); dragged text far outside the canvas (lightbox closed, since it's a real modal
and blocks canvas drags while open) → reopened lightbox → warning visible; typed Position X/Y back to
`(0,0)` **without closing the lightbox** → warning disappeared live; typed X back to `400` → warning
reappeared live; clicked **Center on Object** → position reset to `(0,0)` and warning disappeared in
the same render pass; Undo → warning back; Redo → warning gone again. Zero console errors throughout.

---

# Follow-up 3: Coordinate-Space Audit & Real-Mouse-Drag Fix

A third visual-review report: manual mouse-drag testing on the mug still showed no warning, and
distrusted the prior round's verification method, asking specifically for real CDP
`Input.dispatchMouseEvent` reproduction (not Playwright's `page.mouse` helper, not DOM field edits).
Full detail in `docs/specifications/S-104-TextPositionRecoveryDragTuning.md` §"Follow-up 3". Summary:

* **Reproduced with raw CDP** (`page.context().newCDPSession(page)` + `Input.dispatchMouseEvent`
  `mousePressed`/`mouseMoved`/`mouseReleased`) against the exact default mug project.
* **Coordinate-space audit** (required by this milestone before any code change): `layer.x/y` and
  `getLayerBBox()` are in the flat production-canvas mm frame; `getSafeAreaRectMm()` is the same
  frame's inset rect; the 3D preview (`StoneLayoutTexture.js`/`ObjectGeometryBuilder.js`) rasterizes
  the *entire* flat canvas into one texture and maps that whole texture across the wrap angle centered
  on the front (`WRAP_ANGLE_DEG`: front 70°, wide 115°, half 180°, full 300° —
  `src/preview3d/ObjectDimensions.js`) — so anything within the flat canvas's mm bounds is always
  front-facing/visible at any wrap mode or camera rotation, and anything outside is clipped from the
  texture before reaching the mesh. **Conclusion: the flat canvas-mm comparison was already the
  correct coordinate space** — no 3D projection math was missing; `GeometryEngine`, `StoneLayout`, and
  3D rendering remain untouched, per this milestone's constraint #6.
* **The real bug, found empirically:** a 200-screen-px, purely sideways real CDP drag moved the default
  text to `textX≈120mm`. At that position only **35.4%** of the text's own bounding-box area still
  overlaps the safe area — cup screenshot shows only "Vitali…" and stray streaks, genuinely unreadable
  — yet the previous "fully disjoint from the safe area" check computed **no warning**, because the
  default project's auto-fit text (`199.4mm` wide) is wider than the safe area (`182mm`): a large
  fraction can leave before literally 100% does, which is exactly what "fully disjoint" requires.
* **Fix:** `isTextOutsidePrintableArea()` now computes the real intersection area between the text bbox
  and the safe area and warns once less than a named `TEXT_PRINTABLE_VISIBILITY_RATIO` (50%) of the
  bbox's own area remains inside — "majority of the text has left," matching "no longer meaningfully
  visible" directly. Still a pure function (no layer mutation), still driven from `updateAll()` — drag
  sensitivity, Center on Object, and Undo/Redo are unaffected.
* **Tests:** one new check (12b) verifying the ratio-based formula. `npm test`: **837 checks, 0
  failures**.
* **Browser verification** (real CDP, no Playwright `page.mouse`, no DOM field edits for the drag):
  before-drag screenshot (baseline, warning hidden); the 200px gap-demonstration drag with both old
  and new formulas recomputed by hand from the resulting position (old → `false`, the bug; new → `true`,
  the fix) plus a cup screenshot showing the text genuinely unreadable at that exact spot; a larger
  drag to fully off-canvas (`≈(544.5, 363.0)`) with the warning confirmed both via DOM state and by
  screenshotting the opened Text Lightbox; Center on Object restoring the text (cup screenshot shows it
  fully legible again) and clearing the warning; Undo/Redo restoring/clearing it correctly; zero
  console errors throughout.

---

# Follow-up 4: Warning Moved to the Persistent Workspace

A fourth visual-review report, despite Follow-up 3 being verifiably correct: manual testing still
showed no visible warning. The report correctly identified the actual defect — the warning lived only
inside `#lightboxText`, a modal that is normally **closed** for the entire duration of a canvas drag
(dragging on the 2D canvas is impossible while any modal is open — it captures every pointer event
across the full viewport). A warning inside a closed dialog is indistinguishable from no warning during
the one interaction it exists to catch. This was a placement defect, not a computation bug — Follow-up
3's 50% threshold is unchanged, per this round's explicit instruction. Full detail in
`docs/specifications/S-104-TextPositionRecoveryDragTuning.md` §"Follow-up 4".

* **Fix:** a second copy of the same warning now lives in `#rightInspector` — normal page chrome,
  never covered by a modal, and already this app's persistent per-selection status surface (Stone
  Size/Gap/Stone Color/More Options). `#workspaceTextOutsideWarning` (reusing the same
  `.validation-message` styling) sits directly under the Inspector's layer-name heading with a
  `↺ Center Text` button (`#workspaceCenterTextBtn`).
* `updateTextOutsidePrintableWarning()` now computes `isTextOutsidePrintableArea()` **once** and
  toggles both the Lightbox's and the workspace's warning from that single shared boolean — they can
  never disagree, and both stay live via the same `updateAll()` call every position-changing action
  (including every drag `pointermove` frame) already goes through.
* `#workspaceCenterTextBtn` calls the *exact same* `centerSelectedTextOnObject()` function
  `#centerTextOnObject` already uses — no duplicated recovery logic, so it is guaranteed to only ever
  touch `l.x`/`l.y`.
* `#centerTextOnObject`/`#textOutsidePrintableWarning` (inside the Text Lightbox) are both **kept**, per
  this round's explicit instruction — they remain the visible copy for when the Lightbox is open (which
  covers the Inspector).
* No `GeometryEngine`/`StoneLayout`/renderer/exporter/schema change.
* **Tests:** 3 new checks (15–17) plus check 12 updated for the two-surface toggle. `npm test`: **840
  checks, 0 failures**.
* **Browser verification** (real CDP `Input.dispatchMouseEvent`, Text Lightbox never opened): a single
  continuous drag, checked live mid-gesture (before the mouse was released) — workspace warning hidden
  at `textX≈36/77mm`, **visible starting at `textX≈117mm`**, `lightboxOpen` confirmed `false`
  throughout. Screenshot at the unreadable state shows the cup with only stray streaks, Lightbox still
  closed, red warning + blue Center Text button in the Inspector. Clicked `#workspaceCenterTextBtn`
  directly (Lightbox never opened): position reset to `(0,0)`, warning cleared, cup shows the text fully
  legible again, every other text property (font/height/stone size/color/fill style/curve/text content)
  verified unchanged. Undo/Redo correctly restored/cleared the workspace warning. Zero console errors.

---

# Recommendation

Approve and merge. Both original requirements — reduced, more predictable drag sensitivity and a
one-click, position-only recovery action — plus all four follow-up fixes (Center on Object
discoverability, the outside-the-printable-area warning, its real-mouse-drag-verified
partial-overlap correction, and its move to the persistent workspace), are implemented as the smallest
coherent change on top of
existing, already-tested infrastructure (`getSafeAreaRectMm`, `commitHistory`/`HistoryManager`, the
Layers-list selection path, the shared `centerSelectedTextOnObject()`, and the app's existing
`.btn.primary`/
`.validation-message` visual language). No new geometry, no new storage, no schema change, and none of
the explicitly forbidden modules (`GeometryEngine`, `StoneLayout`, project schema, exporters, rendering,
Design Library, Gallery) were touched — enforced by an automated forbidden-file-prefix check in the
test suite. The `0.5` sensitivity constant and the disjoint-bbox warning threshold are both reasonable,
easily-retunable defaults if real usage calls for different values.
