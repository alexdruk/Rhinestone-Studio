# S-105 — Persistent Movable Lightboxes

## Task ID

S-105

## Type

UI/UX behavior change to the shared dialog system. No new production features, no
GeometryEngine/StoneLayout/renderer/exporter/project-schema/Design Library data-layer/Gallery
data-layer changes. Gallery stays disabled from the top menu (S-103).

## Status

IMPLEMENTED

## Branch

feature/s-105-persistent-movable-lightboxes

## Objective

Make every Lightbox movable, non-blocking, and persistent until the user explicitly closes it, so an
operator can keep a Lightbox open while continuing to work the 2D canvas, Object Preview, Layers list,
and right Inspector — without the current close/reselect/"More Options" round-trip.

## Current Repository State (audited before implementation)

- **One shared dialog controller.** Every Lightbox (`src/ui/Lightbox.js`, 104 lines) wraps one static
  `.lightbox-overlay` block already present in `index.html`. There is no portal, no framework, no
  per-lightbox subclass — 13 instances are constructed from one object literal in `app.js`
  (`app.js:1079-1093`): `text`, `shapes`, `importBox`, `imagetrace`, `exportBox`, `prodSheet`,
  `shipping`, `settings`, `help`, `library`, `libraryConfirm`, `gallery`, `galleryPreview`.
  `libraryConfirm` (delete-design confirmation) and `galleryPreview` (read-only design preview) are
  transient sub-dialogs launched *from inside* an already-open Library/Gallery Lightbox — they are not
  named in this milestone's 11-item list and stay out of scope (see Out of Scope).
- **Every overlay is a full-viewport blocking backdrop except one.** `index.html:212-213`:
  `.lightbox-overlay{position:fixed;inset:0;background:rgba(17,23,43,.5);...z-index:100}`. This
  captures every pointer event across the whole viewport, including the always-visible Layers list,
  Inspector, and both canvases — while any Lightbox is open, nothing else is reachable. The one
  exception is `lightboxShapes`, made non-modal in S-101 (`index.html:220-221`,
  `.lightbox-overlay.non-modal{background:transparent;pointer-events:none}` +
  `.lightbox-overlay.non-modal .lightbox{pointer-events:auto}`) specifically so its own Boolean-Ops
  hint text ("Shift-click on the canvas or in the Layers list") was actually followable. This is the
  only precedent for "non-blocking" in the repository and this milestone generalizes it to all 11
  named Lightboxes.
- **Backdrop-click already closes the dialog** (`Lightbox.js:50-52`): `mousedown` on the overlay
  (not on the dialog card) calls `close()`. Escape does the same (`_handleKeydown`, topmost dialog
  only). Neither of these mechanisms is disabled per-lightbox today except implicitly for
  `lightboxShapes`, whose backdrop is click-through (`pointer-events:none`) so the listener never
  receives a real backdrop click.
- **No drag/move code exists anywhere.** Every dialog is simply flex-centered in its overlay
  (`.lightbox-overlay{display:flex;align-items:center;justify-content:center}`), fixed width
  (`.lightbox{width:640px}` / `.lightbox.wide{width:760px}`), `max-height:calc(100vh - 64px)`. No
  `Draggable` component, no drag library in `node_modules` (only `opentype.js`/`three` are runtime
  deps).
- **Reopening a Lightbox never creates a duplicate.** Each overlay id has exactly one `Lightbox`
  instance for the lifetime of the page; `open()` is a no-op if already open
  (`Lightbox.js:59-60: if (this.isOpen) return;`). This requirement is already satisfied structurally
  and needs no new code — verified, not re-implemented.
- **A single shared-field-DOM constraint already assumes one active field-owning Lightbox at a time.**
  `FIELD_GROUPS`/`relocateFieldGroups()` (`app.js:1063-1076`) physically re-parents one
  `sharedPositionFields` node and one `sharedStoneFields` node via `appendChild` into whichever of
  `text`/`shapes`/`import`/`imagetrace` is "active" (`activeFieldLightbox`, a single string), or back
  to the right Inspector's home slot when none is. **This is load-bearing**: if two of those four
  Lightboxes were ever open at once, the shared field DOM node can only physically live inside one of
  them — the other would silently show an empty position/stone section. This is the concrete
  architectural reason this milestone enforces one active (primary) Lightbox at a time rather than
  allowing arbitrary concurrent Lightboxes (see "Multiple Lightboxes" below).
- **Selection-driven field sync already runs independently of which Lightbox (if any) is open.**
  `syncSelectedControlsFromLayer()` (`app.js:461`) is called from every layer-selection path (Layers
  list click, canvas click/marquee, `#selectedLayer` change, add/duplicate/delete, Undo/Redo) and
  writes into the same DOM nodes regardless of their current parent slot. **This means the "More
  Options" round-trip is a pure side effect of every Lightbox currently being modal** — an operator
  cannot reach the Layers list to select a different layer while a Lightbox blocks it, so they must
  close the dialog (More Options' target Lightbox for a *different* layer type) and reopen via More
  Options. Once Lightboxes stop blocking the Layers list/canvas, the existing sync logic already keeps
  an open, same-type-relevant Lightbox's fields live across a same-type reselection with zero new
  code — this is the mechanism this milestone relies on to satisfy requirement 5, not a new feature.
- **"More Options"** (`app.js:1113-1119`, `#moreOptionsBtn`, `index.html:431`) opens the Lightbox
  matching `selectedLayer().type`. It remains the fastest way to jump straight to a *different* layer
  type's Lightbox and is left unchanged — it is a legitimate reopen affordance, not something to
  remove. The 11 top-menu buttons (`index.html:297-307`) are the other, always-visible reopen
  affordance and are also unchanged.
- **Gallery's disabled state** (`index.html:300`, `#menuGallery` with the native `disabled` +
  `aria-disabled="true"` attributes and its S-103 explanatory comment, `app.js:1098-1102`) is
  untouched by this milestone. Gallery's Lightbox (`lightboxGallery`) still becomes movable/non-modal/
  persistent like the other 10 — only the menu button stays unreachable.

## Expected Visible Change

- Opening any of the 11 named Lightboxes no longer dims or blocks the rest of the screen: the 2D
  canvas, Object Preview, Layers list, and Inspector all stay clickable and editable while the dialog
  is open.
- Each Lightbox's header can be dragged (pointerdown+move+up) to reposition the dialog anywhere; the
  dialog never leaves the viewport, and its last dragged position is kept the next time it is
  reopened (clamped again to the current viewport in case the window was resized while it was closed).
- A Lightbox stays open across canvas edits, layer (re)selection, and Undo/Redo. It only closes on
  Escape, its own Close/✕ button, or the operator opening a *different* primary Lightbox.
- Reselecting a different layer of the *same* editable type while its matching Lightbox is open now
  updates that Lightbox's fields live, with no need to close and reopen via More Options.
- Gallery's top-menu button stays disabled exactly as before.

## Required Outcome

1. Apply movable + non-blocking + persistent behavior to: Text, Shapes, Import, Image Trace, Design
   Library, Export, Production Sheet, Shipping & Handling, Settings, Help, and Gallery (11 Lightboxes;
   Gallery stays disabled from the menu).
2. **Non-modal.** An open Lightbox must not block the 2D canvas, Object Preview, Layers list, or
   Inspector — the operator can keep editing elsewhere while it is open.
3. **Movable.** Drag by the header; the dialog stays fully within the visible viewport at every drag
   position and can never become permanently unreachable.
4. **Persistent.** Once opened, a Lightbox stays open until the operator closes it. Interacting with
   the canvas, Layers list, or Inspector must never auto-close it.
5. **Reduced "More Options" dependency.** Type-specific controls stay available inside their own open
   Lightbox; reselecting a same-type layer updates it live without another More Options click. A clear
   way to reopen a closed Lightbox remains at all times (top menu + More Options).
6. **Multiple Lightboxes audited.** One primary Lightbox open at a time (see Architecture Decision
   below) — opening a different primary Lightbox closes the previous one first, so overlapping windows
   never become confusing or unreachable, and the existing single-slot `FIELD_GROUPS` DOM relocation
   never has two simultaneous owners.
7. All existing Lightbox content and functionality is preserved exactly.
8. `GeometryEngine`, `StoneLayout`, the project schema, exporters, production geometry, and Gallery's
   disabled-menu state are unchanged.

## Architecture Decision: One Primary Lightbox at a Time

Audited per requirement 6. The existing `FIELD_GROUPS`/`activeFieldLightbox` mechanism
(`app.js:1063-1076`) already assumes at most one of Text/Shapes/Import/Image Trace owns the shared
position/stone field DOM nodes at any moment; nothing in the repository was designed for two
simultaneously open Lightboxes. Redesigning that relocation mechanism to support true concurrency
(duplicating the shared field DOM per Lightbox, or another multi-owner scheme) is a materially larger,
unrequested change and would risk exactly the "confusing/unreachable overlapping windows" outcome
requirement 6 warns against. **Decision: the 11 named Lightboxes are "primary" and mutually exclusive**
— `Lightbox.open()` closes any other currently-open primary Lightbox first. Reopening the same,
already-open Lightbox remains a no-op (no flicker). This is an explicit architectural choice, not an
oversight — it is documented here per requirement 6's audit instruction. The two sub-dialogs
(`libraryConfirm`, `galleryPreview`) are not marked primary: they continue to stack on top of their
already-open parent (Library/Gallery) exactly as before, unaffected by the exclusivity rule.

Opening a different primary Lightbox is a deliberate operator action (clicking a top-menu button or
More Options), which is distinct from requirement 4's "clicking or editing elsewhere must not close
it" — that requirement governs incidental interaction with the canvas/Layers/Inspector while a
Lightbox stays open, not a second explicit dialog-open action.

## Implementation

- **`src/ui/Lightbox.js`** (the one shared, pure-DOM dialog controller — no Project/Layer/StoneLayout
  knowledge added, matching its existing charter):
  - `options.primary` (boolean, default `false`): when `true`, `open()` closes every other currently
    open `primary` Lightbox before opening this one (module-level `primaryLightboxes` registry,
    mirroring the existing `openLightboxes` stack pattern already in the file).
  - Header drag: `pointerdown` on `.lightbox-header` (ignoring clicks on `.lightbox-close` or other
    interactive header descendants) captures the pointer, switches the dialog from flex-centered to
    `position:fixed` with explicit `left`/`top` (computed from its current `getBoundingClientRect()`,
    so the very first drag has zero visual jump), and tracks `pointermove` via
    `setPointerCapture`/`releasePointerCapture` (mirroring this codebase's existing
    `pointerdown`/`pointermove`/`pointerup` canvas-drag convention, e.g. `app.js`'s layer-move drag).
  - `_clampToViewport(left, top)`: clamps so the dialog's rendered box stays fully inside the current
    `window.innerWidth`/`innerHeight` whenever it fits, and — on a viewport narrower/shorter than the
    dialog — keeps it flush against the near edge instead of letting it drift off-screen, so the
    header (and its Close button) is always at least partially reachable. Re-applied on every
    `pointermove`, once on `open()` (covers a resize that happened while closed), and on a shared
    `window` `resize` listener for whichever dialogs are currently positioned.
  - Position is **not** reset on `close()` — the next `open()` reuses the last dragged spot (re-clamped
    to the current viewport), matching "reuse the existing window" for both identity and placement. A
    Lightbox that has never been dragged keeps the original flex-centered default (no inline
    position styles are set until the first drag), so the common/never-dragged visual baseline is
    unchanged.
  - `.lightbox.dragging` class toggled for the duration of a drag (cursor + `user-select:none`).
- **`index.html`**: the existing `.lightbox-overlay.non-modal` modifier (S-101) is applied to all 11
  primary overlays (previously only `lightboxShapes`); each of their `.lightbox` dialogs' `aria-modal`
  changes from `"true"` to `"false"`. `lightboxLibraryConfirm` and `lightboxGalleryPreview` are
  untouched (still the plain dimmed/blocking overlay, still `aria-modal="true"`). New CSS:
  `.lightbox-header{cursor:grab}` and `.lightbox.dragging{cursor:grabbing;user-select:none}` (drag
  affordance only — no layout change).
- **`app.js`**: the 11 primary entries in the `lightboxes` object literal
  (`text`/`shapes`/`importBox`/`imagetrace`/`exportBox`/`prodSheet`/`shipping`/`settings`/`help`/
  `library`/`gallery`) each gain `primary:true` in their existing options object (their existing
  `onOpen`/`onClose` callbacks are untouched). `libraryConfirm`/`galleryPreview` are untouched. No
  other `app.js` logic changes — the "remove More Options dependency" requirement is satisfied purely
  by the non-modal + persistent change exposing already-existing selection-sync behavior (see Current
  Repository State above), not by new sync logic.

## Allowed Files

- `src/ui/Lightbox.js`
- `index.html` (Lightbox overlay classes/`aria-modal` attributes, new drag-cursor CSS only)
- `app.js` (only the `lightboxes` object literal's options, adding `primary:true`)
- `tools/test-ui001-dialog-behavior.mjs`, `tools/test-ui001-lightboxes.mjs`,
  `tools/test-s101-ux-workflow-polish.mjs` (updated for the generalized non-modal/aria-modal state)
- New `tools/test-s105-persistent-movable-lightboxes.mjs`
- `package.json` (wire the new test into `test`)
- `docs/specifications/S-105-PersistentMovableLightboxes.md`, `TASK.md`, `TASK_RESULT.md`

## Forbidden Files

`GeometryEngine`/`src/geometry/**`, `StoneLayout`/`src/layout/**`, `src/renderer/**`,
`src/preview3d/**`, `src/export/**`, the project/layer schema, `src/library/**` (data layer),
`src/gallery/**` (data layer), and `#menuGallery`'s `disabled`/`aria-disabled` attributes.

## Out of Scope

- `lightboxLibraryConfirm` and `lightboxGalleryPreview` staying modal/non-draggable-position-reset —
  not named in the 11-item list; changing their modality is not requested and would touch delete/
  preview confirmation UX beyond this milestone's brief.
- Redesigning `FIELD_GROUPS` for true multi-Lightbox concurrency (see Architecture Decision).
- Any new Lightbox content, field, or export option.
- Re-enabling the Gallery menu button.
- Remembering Lightbox position across a full page reload (in-memory only, matching every other piece
  of UI-only state in this app, e.g. `rotation`/`zoom`).

## Automated Tests

- `tools/test-s105-persistent-movable-lightboxes.mjs` (new): asserts `Lightbox.js` exposes the
  `primary`-exclusivity mechanism and the drag/clamp/resize machinery (structural, matching this
  repository's existing "check the live source" convention for the `Lightbox.js`/`index.html`/
  `app.js` layer), that all 11 named overlays carry `.non-modal` + `aria-modal="false"`, that the two
  sub-dialogs are untouched (still plain overlay + `aria-modal="true"`, still not `primary`), that
  `app.js` marks exactly the 11 named Lightboxes `primary:true`, and that Gallery's disabled menu
  attributes are unchanged.
- `tools/test-ui001-dialog-behavior.mjs`: test 8's per-overlay `aria-modal` expectation and test 13
  (the old "Shapes is the one exception" test) are updated to the generalized state.
- `tools/test-ui001-lightboxes.mjs`: test 1's per-overlay `aria-modal` expectation is updated the same
  way.
- `tools/test-s101-ux-workflow-polish.mjs`: test 2 ("every other lightbox overlay keeps the plain
  fully-modal class") is updated — Shapes is no longer the sole non-modal Lightbox, so the assertion
  is narrowed to what S-101 actually still guarantees (Shapes' own non-modal markup, still present
  verbatim).
- Full `npm test` must pass, 0 failures.

## Browser/Manual Verification

Headless Chromium (Playwright, this repo's local `node_modules`), `npm run dev`, no mocks:

- Open every one of the 11 Lightboxes (Gallery via `lightboxes.gallery.open()` directly, since its
  menu entry point stays intentionally disabled) and confirm the 2D canvas, Object Preview, Layers
  list, and Inspector all remain clickable/editable while each stays open.
- Drag each by its header; confirm it moves, stays within the viewport at the extremes (dragged past
  every edge), and the header/Close button stay reachable.
- With a Lightbox open, select a different layer via the Layers list and confirm the dialog does not
  close and (for a same-type reselection) its fields update to the new layer.
- Close and reopen each Lightbox; confirm no duplicate dialog is created and its position from before
  close is restored (clamped to the viewport).
- Confirm opening a second primary Lightbox closes the first (no overlap), and that
  `libraryConfirm`/`galleryPreview` still stack correctly on top of Library/Gallery.
- Verify at 1366×768, 1440×900, and a narrow (e.g. 480px) viewport width.
- Zero console errors throughout.
- Confirm `#menuGallery` is still `disabled`/unclickable.

## Acceptance Criteria

- All 8 numbered requirements above are met.
- `npm test` passes in full.
- Browser verification performed and recorded with screenshots.
- `GeometryEngine`, `StoneLayout`, project schema, exporters, production geometry, Design Library data
  layer, Gallery data layer, and Gallery's disabled menu state are byte-identical to `develop`.

## Required Commands

```bash
npm test
git diff --check
git status
npm run dev   # manual browser verification
```

## Commit Message

One logical commit:

```
feat(ui): S-105 - persistent, movable, non-modal Lightboxes
```

## Deliverables

- `src/ui/Lightbox.js`, `index.html`, `app.js` — implementation.
- `tools/test-s105-persistent-movable-lightboxes.mjs` — new.
- `tools/test-ui001-dialog-behavior.mjs`, `tools/test-ui001-lightboxes.mjs`,
  `tools/test-s101-ux-workflow-polish.mjs` — updated for the generalized non-modal state.
- `package.json` — new test wired in.
- This specification, `TASK.md`, `TASK_RESULT.md`.
- `npm test` passing in full.
- Real-browser verification with screenshots at three viewport sizes.
- One commit on `feature/s-105-persistent-movable-lightboxes`, branch pushed, not merged.

## Next Milestone

Not defined by this task; recommend the human owner/ChatGPT decide based on this milestone's review.

---

## Follow-up: No Empty Lightbox on Selection Mismatch

A manual review of the implemented milestone found one remaining UX issue: when a type-specific
Lightbox (Text/Shapes/Import/Image Trace) stays open (non-modal + persistent, as designed) and the
operator selects a layer of a *different* type, the Lightbox could show an empty content area —
reachable for the first time only because this milestone made it possible to select a different-type
layer while the dialog stays open at all (previously modal, this combination was unreachable). Noted
as a known limitation in the original `TASK_RESULT.md`; this follow-up fixes it.

### Audit

- **Confirmed root cause.** `syncSelectedControlsFromLayer()` already toggles each Lightbox's
  per-layer-type content (`#textControls`, `#shapeControls`, `#svgControls`/`#imageControls`) based
  on the selected layer's type, on every selection change, regardless of which Lightbox is open. For
  **Text**, `#textControls` wraps its *entire* body content (Content/Position/Curve/Stones) with no
  always-visible fallback — hiding it leaves the dialog empty. **Import** and **Image Trace** were
  audited too: both always keep an always-visible "add new" section (`index.html`'s Import-SVG-tab
  "SVG file" drop-zone; Image Trace's `imageTraceNewSection`, shown whenever the selection isn't an
  image layer) — so neither can go *fully* empty, but Image Trace's outer
  `imageTraceEditSection`/`imageTraceNewSection` split is only re-toggled by `updateImageTraceSections()`
  (called on open/commit/cancel, not on every selection change), so leaving it open across an
  unrelated selection change could show a stale, partially-empty "Edit selected image layer" section.
  **Shapes** was audited and found structurally different: its "Add a shape" and "Boolean Operations"
  sections (`#shapesPanelDesign`) are unconditionally visible regardless of the selected layer's
  type — only `#shapeControls` (the per-layer Position/Fill Style detail) is conditional. Shapes can
  never actually go empty.
- **Boolean Ops interaction audited before choosing a fix.** Prototyping a first version of the fix
  (auto-switch away from *any* type-specific Lightbox, including Shapes, on a mismatched selection)
  broke the S-101 Boolean Ops workflow in real browser verification: a Shift-click multi-selection
  always begins with one plain click (`el('layersList').addEventListener('click', ...)`: a plain
  click calls `selectOnly()`, Shift-click calls `toggleSelection()` — two separate events, not one).
  That first plain click is a genuine, momentary single-selection, indistinguishable in the instant it
  fires from an ordinary single-select — so a same-type-only auto-switch fired and closed Shapes
  before the Shift-click could add the second layer. Combined with Shapes never needing this
  protection (per the audit above), the fix excludes Shapes from the auto-switch-away trigger
  entirely.

### Fix (`app.js` only)

- New shared helper `lightboxForLayerType(t)` — the single layer-type → Lightbox mapping, extracted
  from `#moreOptionsBtn`'s previous inline branching (now calls the helper instead of repeating it) so
  the mapping has exactly one source of truth.
- `syncSelectedControlsFromLayer()` gains one guarded call at its end:
  `if(activeFieldLightbox&&activeFieldLightbox!=='shapes'&&selectedLayerIds.size<=1){const
  target=lightboxForLayerType(l.type);if(target&&!target.isOpen)target.open();}`
  - `activeFieldLightbox` (already tracked by each type-specific Lightbox's `onOpen`/`onClose`) gates
    this to only fire while Text, Import, or Image Trace is the one open — Settings/Export/Help/etc.
    are unaffected, and Shapes is explicitly excluded per the audit above.
  - `target.open()` both switches to the correct Lightbox for the new selection and — via S-105's
    existing single-primary-Lightbox exclusivity in `src/ui/Lightbox.js` — closes the now-incompatible
    one automatically. This satisfies requirement 2's preferred first option ("automatically switch")
    for every case where it applies, with no separate "close" call needed.
  - `selectedLayerIds.size<=1` additionally guards against acting mid-multi-selection generally
    (defense in depth beyond the Shapes exclusion, in case a future multi-select feature is added to
    another type-specific Lightbox).
  - The `!target.isOpen` check makes it a true no-op when the correct Lightbox is already open (no
    redundant close/reopen flicker).

### Requirements Met

1. No Lightbox may display an empty content area — Text/Import/Image Trace now always show real,
   matching content while open; Shapes never could go empty in the first place (confirmed by audit,
   not just assumed).
2. Automatic switch to the appropriate Lightbox is used wherever it safely applies (Text/Import/Image
   Trace); Shapes is deliberately left open rather than switched or closed, which is still "not an
   empty window" — satisfying the requirement's actual goal without its more disruptive literal
   application.
3. Non-modal/movable/persistent behavior: untouched (zero changes to `src/ui/Lightbox.js` or
   `index.html` in this follow-up).
4. One-primary-Lightbox architecture: reused as-is, not modified — the fix calls the same
   `Lightbox.open()`/exclusivity mechanism every other open path already uses.
5. `GeometryEngine`, `StoneLayout`, the project schema, exporters, and rendering: untouched (this
   follow-up is `app.js` + `tools/` + `docs/` only).

### Files Changed

```
app.js                                           — lightboxForLayerType() helper; moreOptionsBtn
                                                    refactored to use it; syncSelectedControlsFromLayer()
                                                    auto-switch (Shapes excluded)
tools/test-s105-persistent-movable-lightboxes.mjs — checks 16-18 (was 16 forbidden-file, now 19)
tools/test-ui001-leftpanel.mjs                    — check 8 updated for the lightboxForLayerType()
                                                     refactor
tools/test-path-boolean-integration.mjs           — check 12 updated the same way
docs/specifications/S-105-PersistentMovableLightboxes.md — this section
TASK_RESULT.md                                    — Follow-up section
```

No changes to `src/ui/Lightbox.js`, `index.html`, `GeometryEngine`, `StoneLayout`, any renderer, any
exporter, the project schema, `src/library/**`, or `src/gallery/**`.

### Tests

`npm test`: **860 checks, 0 failures** (3 new checks in `tools/test-s105-persistent-movable-lightboxes.mjs`,
2 pre-existing checks updated for the `lightboxForLayerType()` refactor).

### Browser Verification

Headless Chromium (Playwright), `npm run dev`, 1440×900, against the real running app:

- **Exact reproduction requested**: opened Text Lightbox (real content) → selected a Shape (circle)
  layer (auto-switched to Shapes, real content) → selected an SVG layer while a *different*
  type-specific Lightbox (Import, then separately Shapes) was open (switched to Import when Import was
  open; correctly *stayed open* on Shapes, still non-empty, when Shapes was open, per the audited
  exception) → selected an Image Trace (image) layer while Import was open (switched to Image Trace,
  real content, both new-import and post-commit states) → selected the Text layer again while Image
  Trace was open (switched back to Text, `#text` field read back `"Vitalina Serbin"`, confirming real
  content, not just a non-empty DOM check).
- **Regression check**: opened Shapes, plain-clicked a Text layer then Shift-clicked a Circle layer
  (the exact S-101 Boolean Ops mixed-type multi-select gesture) — Shapes stayed open throughout,
  confirming the exclusion fix resolved the regression found during this follow-up's own
  implementation.
- 15/15 scripted checks passed. Zero console/page errors throughout.
