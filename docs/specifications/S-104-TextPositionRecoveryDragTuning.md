# S-104 — Text Position Recovery & Drag Tuning

## Task ID

S-104

## Type

Small, high-value UX polish. No new production features, no architecture refactoring, no
GeometryEngine/StoneLayout/renderer/exporter/project-schema/Design Library/Gallery changes.

## Status

IMPLEMENTED

## Branch

feature/s-104-text-position-recovery-drag-tuning

## Objective

Improve the usability of text positioning: make move-drags smoother and more precise, and give the
operator an easy, position-only way to recover a text layer that has been dragged fully outside the
visible printable area.

## Audit Findings (verified against the live repository before implementation)

1. **Move-drag was a 1:1 pointer-to-mm mapping.** `app.js`'s `layoutCanvas` `pointermove` handler
   computed `rawDx/rawDy` (`mm.x-drag.start.x`, `mm.y-drag.start.y`) from `pointerToLayout(e)` and
   applied that delta to the dragged selection's position verbatim (after optional snapping and the
   Shift axis-lock, both already pre-existing RS-1009/RS-1010 behavior). One CSS pixel of pointer
   movement therefore always produced the same mm movement regardless of how small an adjustment the
   operator wanted, which made fine text placement (text has no resize handles to fall back on —
   `hitTest()` explicitly excludes `l.type==='text'` from resize-handle hits) imprecise. This is the
   same class of "unexplained inline drag multiplier" `docs/ARCHITECTURE.md` already called out and
   fixed once before, for cup rotation (`CUP_ROTATION_SENSITIVITY`, since removed when `OrbitControls`
   took over rotation).
2. **A text layer has no persisted absolute position of its own.** `computeTextPlacementOffset()`
   (RS-1009/RS-1012) always auto-centers the generated text bounding box on the full production
   canvas first, then adds `layer.x`/`layer.y` (mm, default 0) on top. Algebraically this means the
   rendered bbox's world-space center is always exactly `(canvas.width/2 + layer.x, canvas.height/2 +
   layer.y)` — independent of the text's own content, font, or size. There was, however, no UI action
   that used this fact to recover a lost layer: the Text Lightbox's Position section only exposed raw
   `#textX`/`#textY` number inputs (RS-1009/UI-001), with no "reset" affordance, and dragging a text
   layer fully outside the canvas left no on-canvas way to reselect or move it back (the Layers-list
   selection path already existed and still works for *finding* the layer, just not for un-losing its
   position).
3. **The printable area is `getSafeAreaRectMm(template, canvasWidthMm, canvasHeightMm)`**
   (`src/products/ObjectTemplate.js`, untouched), already used for the safe-area guide overlay and as
   a drag-snap target (RS-1009). Every current object template (Mug/Tumbler/Bottle) happens to use
   symmetric left/right and top/bottom insets, so its center currently coincides with the raw canvas
   center — but a correct "center on the printable area" implementation should read the safe-area rect
   rather than hardcode that coincidence, so it stays correct if an asymmetric template is ever added.

## Changes Made

### 1. Reduced move-drag sensitivity

`app.js`: a new named constant `LAYER_MOVE_DRAG_SENSITIVITY = 0.5` (placed with its own explanatory
comment immediately above the `pointerdown` handler, matching this file's existing precedent of
naming pointer-tuning constants rather than leaving inline magic numbers) scales `rawDx`/`rawDy` down
*before* they become `dx`/`dy` in the `pointermove` handler's `'move'` branch:

```js
let dx=rawDx*LAYER_MOVE_DRAG_SENSITIVITY,dy=rawDy*LAYER_MOVE_DRAG_SENSITIVITY;
```

This is the one and only change to the move-drag path — snapping (`buildSnapTargets`/
`computeSnapOffset`), the Shift axis-lock, Alt-duplicate, multi-selection grouped movement, and
arrow-key nudging (a separate, already-precise code path, untouched) all continue to operate exactly
as before, just against an already-scaled delta. Resize-drag (`drag.kind==='resize'`) maps the pointer
directly to an mm position under the cursor rather than a delta, so it is structurally unaffected and
was deliberately left alone — text layers have no resize handles in the first place.

`0.5` was chosen as a straightforward halving: precise enough to make small adjustments controllable,
without requiring an unreasonable amount of extra pointer travel to still reach any position on a
realistic canvas (confirmed in browser verification below — arbitrarily large drags still reach
arbitrarily far positions, including well outside the canvas).

### 2. "Center on Object" recovery action

`app.js`: a new `centerSelectedTextOnObject()` function, guarded to only ever act on the selected
layer when it is a text layer:

```js
function centerSelectedTextOnObject(){
  const l=selectedLayer();if(!l||l.type!=='text')return;
  const safe=getSafeAreaRectMm(currentObjectTemplate(),project.canvas.width,project.canvas.height);
  const targetX=safe.xMm+safe.widthMm/2-project.canvas.width/2,targetY=safe.yMm+safe.heightMm/2-project.canvas.height/2;
  commitHistory();
  l.x=targetX;l.y=targetY;
  syncSelectedControlsFromLayer();updateAll(true);
  el('status').textContent='Centered text on the printable area';
}
```

It writes exactly two fields (`l.x`, `l.y`) and nothing else — font, text height/auto-fit, fill
style, curve settings, stone size/gap/color are never touched, satisfying the "position only, no
other properties" requirement by construction (there is no code path in this function that can reach
them). It follows the exact same pattern every other mutating editor action already uses
(`runAlign`/`runDistribute`/`nudgeSelection`): one `commitHistory()` before the mutation (undo/redo
support, for free, via the existing `HistoryManager`), `syncSelectedControlsFromLayer()` +
`updateAll(true)` to refresh the UI without re-reading stale input values, and a `#status` confirmation
message.

`index.html`: a new `Center on Object` button (`id="centerTextOnObject"`, reusing the existing `.btn
.sm` class already used by e.g. `#resetView` — no new CSS) added to the Text Lightbox's existing
Position field-section, directly under the `#textX`/`#textY` inputs, with a title attribute spelling
out exactly what it does and does not touch. The section's existing hint paragraph gained one sentence
pointing at the button for the "I dragged my text away and can't find it" scenario. Because the
Layers-list row selection path (RS-1009, pre-existing) already lets an operator select a layer
regardless of whether it is currently visible on-canvas, the full recovery flow needs no other new UI:
select the (possibly off-canvas) text layer in the Layers list → More Options → Center on Object.

Wired via `el('centerTextOnObject').onclick=()=>centerSelectedTextOnObject();`, placed next to the
other single-click action-button wiring (`alignLeft` etc.).

## Do-not-change list — verified untouched

`GeometryEngine`, `StoneLayout`, every renderer (`src/renderer/**`, `src/preview3d/**`), every
exporter (`src/export/**`), the project/layer schema (no field added/removed/renamed — `layer.x`/
`layer.y` already existed since RS-1009), Design Library (`src/library/**`), and Gallery
(`src/gallery/**`) are all untouched. Enforced by an automated forbidden-file-prefix check in the new
test suite (see below), mirroring the guard pattern every prior milestone's own test file already
uses.

## Tests

New: `tools/test-s104-text-position-recovery-drag-tuning.mjs` (9 checks) — structural checks against
the live `app.js`/`index.html` source (the established convention for this browser-entry-point file,
see `tools/test-ui001b-fixes.mjs`/`tools/test-alignment-snapping-integration.mjs`):

1. `LAYER_MOVE_DRAG_SENSITIVITY` exists and is strictly between 0 and 1.
2. The pointermove handler scales the pointer delta by that constant *before* snapping/shift-lock/
   position-apply.
3. The resize-drag branch is untouched by the sensitivity constant.
4. The Text Lightbox's Position section has a `Center on Object` button placed after the X/Y fields.
5. `centerSelectedTextOnObject()` is defined and wired to `#centerTextOnObject`.
6. It only ever writes `l.x`/`l.y` — no font/size/rotation/curve/spacing/fill/stone-size assignment
   appears in its body.
7. It guards non-text/missing selections, opens exactly one undo step, and re-syncs the UI/history the
   same way every other mutating action does.
8. It targets the printable (safe) area's center via the existing `getSafeAreaRectMm()`, not a
   hardcoded canvas-center assumption.
9. No forbidden file changed.

Updated: one pre-existing assertion in `tools/test-alignment-snapping-integration.mjs` (`27. snapping-
disabled drag falls back to raw pointer delta`) encoded the old 1:1 mapping (`let dx=rawDx,dy=rawDy;`)
as its literal expected source text. Updated to expect the new, deliberately-changed
`let dx=rawDx*LAYER_MOVE_DRAG_SENSITIVITY,dy=rawDy*LAYER_MOVE_DRAG_SENSITIVITY;` — the *behavior* the
test protects (dx/dy start unsnapped, gated fully behind `snapEnabled`) is unchanged; only the
sensitivity this milestone intentionally introduced needed reflecting.

`package.json`'s `test` script gained the new test file at the end of the existing chain.

**Result:** `npm test` — 831 checks, 0 failures, exit code 0 (see Result Package below).

## Browser Verification

Real headless Chromium (Playwright, local `node_modules`), `npm run dev` (`python3 -m http.server
5173`), 1440×900 viewport, 2D-Canvas-only view for an unambiguous drag target. All steps performed
against the actual running app, not a mock:

1. **Moderate drag, default state.** A 200×100 CSS-px drag from the default `(0,0)` text position
   landed at `(50.56, 26.51)` mm — proportional, controllable movement; reduced sensitivity confirmed
   live (a pre-S-104 1:1 mapping would have produced a much larger mm delta for the same pointer
   travel, consistent with the source-level check that the constant is `<1` and actually wired into
   the live delta). Undo returned it to exactly `(0, 0)`.
2. **Large drag, fully outside the printable area.** A 1400×900 CSS-px drag moved the text to
   `(366.79, 235.80)` mm — far outside the 210×90mm mug canvas (safe area 182×70mm). Screenshot
   confirms the stones render clearly outside the printable-area guide rectangle, with the 2D canvas
   auto-panning/zooming (pre-existing renderer behavior, unrelated to this milestone) to keep the
   now-distant selection visible.
3. **Recovery.** Selected the (already-selected, but exercised via the Layers-list row per the
   intended recovery flow) text layer, opened More Options → Text Lightbox, clicked **Center on
   Object**. Position X/Y immediately read `(0, 0)`, `#status` read "Centered text on the printable
   area", and the screenshot shows the text stones back inside the printable-area grid. Font
   (`courier-prime-regular`), height (`25`), auto-fit, fill style (`stroke`), stone size (`2`), color
   (`gold`), and curve setting (`off`) were byte-identical before and after — verified by comparing the
   full property snapshot, not just eyeballing the UI.
4. **Undo/Redo.** After closing the lightbox, Undo returned Position X/Y to the off-canvas
   `(366.79, 235.80)`; Redo returned to `(0, 0)`. Both single history steps, exactly as `commitHistory()`
   +`updateAll(true)` intends.
5. **Console.** Zero console errors or page errors captured across the entire session (favicon 404, if
   any, was not even triggered in this run — `page.on('console'/'pageerror')` list was empty).

Screenshots captured at every step (initial state, after moderate drag, after off-canvas drag, Text
Lightbox open on an off-canvas layer, after Center on Object, after undo/redo) confirm the above
visually as well as via the read DOM values.

## Follow-up: Visibility/Discoverability Audit

A visual reviewer reported that after this milestone's initial implementation, "no such control is
visible" for Center on Object during manual testing. Re-audited before writing any new code, per the
review request:

* **Was the button actually added?** Yes — `id="centerTextOnObject"` is present exactly once in
  `index.html`, inside the Text Lightbox's Position `field-section`, and `app.js` wires it
  (`el('centerTextOnObject').onclick=...`) without error.
* **Where is it located?** Text Lightbox → Position section, directly under the Position X/Y (mm)
  inputs, above the position hint paragraph — unchanged from the original implementation.
* **Under what conditions is it shown?** Only while `#lightboxText` is open (`class="lightbox-overlay
  open"`), reachable via the top-menu **Text** button or the right Inspector's **More Options** button
  when a text layer is selected — the same visibility condition every other Text property (font,
  height, curve, stone size, etc.) already has. It does not appear anywhere outside that modal.
* **Reproduction attempts (all failed to find a rendering/functional bug):** opened via both entry
  points (`#menuText` top-menu button and Inspector `#moreOptionsBtn`); tested at five viewport sizes
  (1440×900, 1440×800, 1366×768, 1280×720, 1024×768); measured the button's live
  `getBoundingClientRect()`/computed style (`display:inline-flex`, `visibility:visible`, `opacity:1`)
  and confirmed it sits within the Text Lightbox's visible scroll position at every size tested (no
  scrolling required to reach the Position section — it is second of four sections, well above any
  overflow). Zero console/page errors in any run. The control is real, correctly wired, and renders
  and functions correctly in every reproducible scenario.
* **Conclusion — not a rendering bug; a discoverability gap.** The control's *only* problem was that,
  before this fix, it used the same plain `.btn.sm` styling as a neutral secondary field, visually
  indistinguishable from ordinary form controls around it. For a feature whose entire purpose is
  "I lost my text, get it back fast," blending into a wall of plain inputs inside a modal a confused
  user may not think to open in the first place is a real usability failure, even though no line of
  code was non-functional. This matches this review's second branch ("if intentionally hidden, make it
  visible and discoverable in the Text Lightbox") rather than the first ("if a bug, fix it") — there
  was nothing to fix functionally.

**Fix applied (index.html only, no functional/wiring change):** the button now carries `.primary` in
addition to `.sm` (`class="btn sm primary"`) — the same prominent blue treatment already used for
`Export`/`Save`/`Save Project`, matching this app's existing visual vocabulary for "this is the action
you want here," and gained a `↺` (undo/restore) icon glyph reinforcing the "brings something back"
meaning at a glance. Nothing else about the button — its position, id, wiring, guard logic, or
the fields it touches — changed. `centerSelectedTextOnObject()` in `app.js` is byte-identical to
before this follow-up. A new test assertion
(`tools/test-s104-text-position-recovery-drag-tuning.mjs`, check 4b) locks in the `.primary` class so
this cannot silently regress back to an easy-to-overlook plain button.

Re-verified via headless Chromium at 1440×900: opened the Text Lightbox through the plain top-menu
**Text** button (the most direct, most-likely-discovered path — no drag, no More Options detour),
confirmed the button is immediately visible with no scrolling
(`getBoundingClientRect()` inside the modal's visible body), edited the text content and position
manually, clicked **Center on Object**, and confirmed it reset the position (`textX`/`textY` → `0,0`)
while leaving the just-edited text content (`"Hello World"`) untouched. Zero console errors.

## Follow-up 2: Outside-the-Printable-Area Warning

A second visual-review request: show a clear warning in the Text Lightbox when the selected text has
moved materially outside the printable safe area, updating live and clearing automatically once the
text is back inside — without ever preventing the move itself.

**Threshold chosen — full disjointness, not strict containment.** The first implementation attempt
used "not fully contained by the safe area" (any overhang triggers the warning), and browser
verification immediately caught it as wrong: the *default, never-moved* text layer already overhangs
the safe area at `(0,0)` (its auto-fit bounding box, `199.4×17.0mm`, is wider than the `182×70mm` safe
area — `generateTextStonesLive()`'s auto-fit deliberately caps width to `canvas.width-10`, not to the
safe area, and this is pre-existing, unrelated behavior). A strict-containment check would have shown
the warning on essentially every normal project, defeating its purpose. The corrected rule —
`isTextOutsidePrintableArea()` in `app.js` — fires only when the text's bounding box has **no overlap
at all** with the safe area (fully disjoint, with a small tolerance so a bbox resting exactly on the
boundary never flickers). This intentionally mirrors `centerSelectedTextOnObject()`'s own scope
("recovers text dragged *completely* outside the visible printable area"), so the warning is a direct,
correct signal for exactly when Center on Object is the right fix — never a false alarm for ordinary
auto-fit overhang.

**Implementation:**
* `app.js` — `isTextOutsidePrintableArea(l)` (pure function: `getLayerBBox(l)` vs
  `getSafeAreaRectMm(currentObjectTemplate(), project.canvas.width, project.canvas.height)`, tolerance
  = the existing `SNAP_TOLERANCE_MM`) and `updateTextOutsidePrintableWarning()` (toggles the `.visible`
  class on the warning element). Both are read-only — neither writes to any layer field, so the move
  itself is never affected or prevented, satisfying "do not prevent moving text outside the area" by
  construction.
* `updateTextOutsidePrintableWarning()` is called from inside `updateAll()`, immediately after `layout`
  is regenerated — the same function every position-changing action already funnels through (drag
  `pointermove`, keyboard nudge, Align/Distribute, Undo/Redo, Center on Object, and every keystroke in
  the Text Lightbox's own `#textX`/`#textY` fields). This is what makes the warning "live": it is
  recomputed on literally every call that could have changed the layer's extent, with no separate
  polling or event wiring needed.
* `index.html` — a `<p class="validation-message" id="textOutsidePrintableWarning">This text is
  outside the printable area.</p>` in the Text Lightbox's Position section, between the X/Y fields and
  the Center on Object button. Reuses the exact `.validation-message`/`.visible` styling already used
  by `#textValidation` elsewhere in this same lightbox — a red alert box, no new CSS.
* Center on Object (`#centerTextOnObject`) is completely unchanged — same id, position, wiring, guard
  logic, and styling as the prior follow-up left it.
* No changes to `GeometryEngine`, `StoneLayout`, any renderer, any exporter, or the project schema —
  the warning is computed entirely from already-generated `layout` data and the already-existing
  `getSafeAreaRectMm()`.

**Tests:** `tools/test-s104-text-position-recovery-drag-tuning.mjs` gained checks 10–13: the warning
element exists with the exact required wording between the X/Y fields and the button; it reuses the
existing `.validation-message` styling; `isTextOutsidePrintableArea()`/`updateTextOutsidePrintableWarning()`
are purely read+DOM-toggle (regex-verified: no property assignment of any kind in the pure function);
and the update call is wired into `updateAll()`. `npm test`: **836 checks, 0 failures** (4 new).

**Browser verification** (headless Chromium, 1440×900, 2D-Canvas-only):
1. Baseline: opened the Text Lightbox at the default `(0,0)` position — warning correctly **hidden**
   (confirming the corrected, non-strict threshold).
2. Dragged the text far outside the canvas (lightbox closed during the drag, as it must be — the Text
   Lightbox is a real modal and blocks canvas pointer events while open); reopened the lightbox —
   warning **visible**, sitting directly above Center on Object.
3. **Live update inside the open lightbox**, the closest in-app analog to "live while dragging" since
   the modal cannot be open during an actual canvas drag: typed the Position X/Y fields back to
   `(0,0)` without closing/reopening anything — warning disappeared immediately; typed X back to `400`
   — warning reappeared immediately. No reopen needed either time.
4. Clicked **Center on Object** — position reset to `(0,0)` and the warning disappeared in the same
   render pass.
5. Closed the lightbox, clicked **Undo** — position returned to the off-canvas value; reopening the
   lightbox showed the warning again. Clicked **Redo** — position returned to `(0,0)`; warning gone
   again.
6. Zero console/page errors across the entire session.

## Recommendation

Approve and merge. Both original requirements, plus both follow-up fixes (Center on Object
discoverability, and the outside-the-printable-area warning), are implemented as the smallest coherent
change on top of existing, already-tested infrastructure
(`getSafeAreaRectMm`, `commitHistory`/`HistoryManager`, the Layers-list selection path, and now the
app's existing `.btn.primary` visual language) — no new geometry, no new storage, no schema change, no
forbidden file touched, and the follow-up fix touched only a `class`/label on one existing element. The
`0.5` sensitivity constant is a reasonable default; if real usage shows it too aggressive or too mild
in either direction, it is a one-line, well-isolated tuning change.
