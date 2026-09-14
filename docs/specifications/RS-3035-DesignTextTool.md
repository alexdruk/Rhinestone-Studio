# RS-3035 — Text tool on the Design rail

## Goal

Add a **Text** tool to the Design left rail, positioned between Trace and Eraser. Clicking the
canvas with it active creates a new text layer centered on the click point, selects it, and opens
the existing Text Lightbox for editing — without leaving Design mode.

## The click-point-is-the-position rule

A text layer stores its position as `x`/`y`, an offset from the canvas center (see
`src/editing/TextPlacement.js`), not an absolute point. The Text tool's `DrawingCanvasTool.js` hook
(`onTextPlace`) reports the click in absolute project-mm, the module's own coordinate space, and
`app.js`'s `addText({atAbsoluteMm})` converts that point to the stored offset through the shared
`computeTextLayerPositionForTargetCenterMm()` — the same inverse the Lightbox's own `+ Add Text`
fit-to-shape path already relies on — rather than re-deriving the algebra a second time. This is a
deliberate reuse: there is exactly one place in the codebase that knows how to turn a target center
point into a text layer's `x`/`y`.

Passing `atAbsoluteMm` also suppresses `addText()`'s existing co-selected-shape auto-fit
(`fitPartnerShape`): an explicitly-placed text layer must land exactly at the click point, never
jump to fit inside whatever else happens to be selected. The Lightbox's own `+ Add Text` button,
called with no arguments, is untouched and remains byte-identical — same fit-partner branch, same
status text, same history commit.

## Why the tool is one-shot, not repeatable-touch

Stamp, Trace, Eraser, and Lasso all belong to `CLICK_TO_PLACE_MODES`
(`src/drawing/DrawingCanvasTool.js`) — they stay active after each placement so an operator can
place several stones/marks in a row, and Escape's idle-revert-to-Select keys off that shared set.
Text is deliberately **not** added to it. Placing text is a heavier, less repetitive action than
stamping a stone: each placement immediately opens the Lightbox for content/font/curve editing, so
there is no "place several in a row" workflow to support. The tool instead reverts `mode` to
`'select'` immediately on commit — the same `mode` / `updateResizeHandles()` / `updateCursor()` tail
`commitFinalizedShape()` already uses for Rect/Pen/etc — before `onTextPlace` fires, so by the time
`app.js` reacts, the rail's `aria-pressed` state already reflects Select. This also means Text needs
no entry in `CLICK_TO_PLACE_MODES`'s Escape-idle-revert handling: there is no lingering "active"
state left for Escape to close.

Text also has no selection-boundary semantics, unlike Stamp/Trace (RS-3012 Step 1's
`isPointInActiveSelection` gate). A text layer is free-standing — it belongs to no shape and has no
boundary to respect — so a click inside an existing shape and a click on empty canvas are the same
operation. Text is correspondingly absent from `isSelectionAwareMode` inside `setMode()`: switching
to Text clears any `activeSelection`, matching every other non-selection-aware tool.

## Why the Lightbox opens without `revealDualWorkspaceForLightbox()`

`revealDualWorkspaceForLightbox()`'s first act is `setDrawMode(false)` — appropriate for the
top-menu `Text` button, which opens the Lightbox from outside Design and needs to reveal Design's
dual workspace first. Calling it from inside Design would immediately exit Design mode, which is the
opposite of what a Design-rail tool should do. The `onTextPlace` hook instead opens the Lightbox
directly (`lightboxes.text.open()`), the same way `#menuShipping`/`#menuSettings`/`#menuHelp` already
do. The overlay is `.non-modal` (pointer-events disabled except over the panel itself) and
header-draggable, so the Design canvas underneath stays fully visible and usable while the Lightbox
is open — dragging/rotating the newly-placed text, or any other shape, still works.

`updateDrawToolButtons()` is called before `lightboxes.text.open()` (not after): it calls
`setActiveTopMenuButton(null)` while Design is active, which is a no-op here (no top-menu button was
ever activated for a Design-rail click) but reads confusingly if the ordering were reversed. The
`focus()`/`select()` pair on `#text` runs after `open()`, since `open()` itself ends by focusing its
own first focusable element — the explicit focus/select call must come after, to land on the content
field specifically rather than whatever `open()` focused first.

## The `TEXTAREA` guard fix

Six sites in `app.js`'s keyboard-shortcut handling tested `document.activeElement?.tagName` against
only `'INPUT'` and `'SELECT'`, omitting `'TEXTAREA'`. `#text`, the Text Lightbox's own content field,
**is** a `<textarea>`. This was a latent, pre-existing correctness defect independent of RS-3035:
before this fix, typing the word "text" into that field while Design was active would fire the
Trace (`t`), Ellipse (`e`), and Eraser (`x`) shortcuts; pressing Delete would delete the selected
shape instead of a character; pressing Space would start a canvas pan. Two of the six sites (the
Delete/Backspace and arrow-key nudge handlers) sit outside the `drawingTool.isActive` block and were
already broken the same way regardless of Design mode.

RS-3035 exposed this because the new Text tool is the first Design-rail feature that routes the
operator directly into `#text` as part of its own flow (click → place → Lightbox opens → content
field is focused and selected) — previously reaching `#text` required a deliberate detour through
the top-menu Text button, away from Design's own keyboard-shortcut surface. All six sites were fixed
identically, replacing the two-way tag check with a three-way one:

```js
if(t==='INPUT'||t==='SELECT'||t==='TEXTAREA')return;
```
