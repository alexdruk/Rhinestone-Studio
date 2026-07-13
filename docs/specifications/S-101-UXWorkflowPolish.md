# S-101 — UX & Workflow Polish

## Task ID

S-101

## Type

Small, high-value workflow/UI polish. No new production features, no architecture refactoring, no
GeometryEngine/StoneLayout/exporter/schema changes. Builds directly on the findings already recorded
in `docs/specifications/RS-2000A-PostMVPAudit.md` (Proposals C/D/E, milestone RS-2004).

## Status

IMPLEMENTED

## Branch

feature/s-101-ux-workflow-polish

## Method

Every reported issue was re-verified live against the current `develop` tip (commit `44e6d97`)
before any code was touched — none were assumed from the prior audit doc. Grep/read of
`index.html`/`app.js` confirmed all four issues below still existed exactly as described. A live,
isolated headless Chrome pass (own `--user-data-dir`, own randomized debug port, driven over raw
CDP, killed at the end of the session — no existing Chrome window/profile touched) then verified
every fix end-to-end at a realistic 1440×900 viewport, with screenshots captured at each step.

---

## Audit Findings (verified before implementation)

1. **Boolean Ops dialog-ordering bug — CONFIRMED.** The Shapes lightbox's own hint text
   (`index.html`, `#booleanOpsHint`) instructs "Select two or more layers (Shift-click on the canvas,
   or in the Layers list)," but every `.lightbox-overlay` is a `position:fixed;inset:0` element that
   captures pointer events across the full viewport while open — including the always-visible left
   Layers list and the 2D canvas. `document.elementFromPoint()` over a Layers-list row while the
   Shapes dialog was open returned the overlay, not the row, confirming the dialog's own instructions
   were unfollowable from inside the dialog.
2. **Curved-text default is a closed circle — CONFIRMED.** `curveSweepAngleDeg` defaulted to `360` in
   three places (`index.html`'s input `value`, `app.js`'s `defaultProject()`, and the `??`/`||`
   fallbacks in `syncSelectedControlsFromLayer()`/`writeSelectedControlsToLayer()`). Enabling Curved
   Text for the first time turned straight text into a tight closed wreath, not an arc.
3. **Unnecessarily technical/inconsistent shape-field wording — CONFIRMED.** The shared
   position/size fields (`#sharedPositionFields`, reused across Circle/Rectangle/SVG/Image/Path
   editing) were statically labeled "X / CX (mm)", "Y / CY (mm)", and "Width / Radius" regardless of
   the selected shape's actual type — exposing raw SVG-attribute jargon (`cx`/`cy`) to end users. For
   a selected circle, the Height field also showed a static "Height" label next to a permanently
   empty input (circles have no independent height), which reads as a broken/unfilled field.
4. **Layer names truncate with no way to see the full name — CONFIRMED.** `.layer .name` uses
   `overflow:hidden;text-overflow:ellipsis` with no `title` attribute, so a descriptively-named layer
   ("Vitalina Serbin" → "Vitalina...") has no way to reveal its full name short of widening the panel.

No other candidate issue from `RS-2000A-PostMVPAudit.md` Part 3/6-E was in scope for this milestone
(schema reconciliation, validation engine, contour-fill performance, font library expansion, etc. are
explicitly out of scope per the S-101 charter and are correctly deferred to RS-2002/2003/2006+).

---

## Issues Resolved

### 1. Boolean Ops / non-modal Shapes lightbox

**Fix shape chosen: non-modal lightbox** (of the four options offered — movable, non-modal, temporary
minimize, other). This was the smallest change that preserves the existing dialog architecture: no
new interaction model, no second dialog implementation, `src/ui/Lightbox.js` untouched.

- `index.html`: added a `.lightbox-overlay.non-modal` CSS modifier — transparent background,
  `pointer-events:none` on the overlay itself, `pointer-events:auto` restored on the `.lightbox` card
  — so clicks pass through the (now invisible) backdrop to the canvas/Layers list underneath, while
  the dialog's own header/body/footer controls remain fully interactive.
- `#lightboxShapes` alone carries the new `non-modal` class and `aria-modal="false"` (every other
  lightbox is untouched — still `aria-modal="true"`, still fully modal, still closes on backdrop
  click).
- No change to the Boolean Ops hint text — it was already correct; the dialog just now actually
  supports what it always claimed to support.
- **Trade-off, accepted deliberately**: backdrop-click-to-close no longer applies to the Shapes
  dialog specifically (clicks in the dimmed area now reach the canvas/sidebar instead). Escape and
  the ✕/Close button are unaffected.

### 2. Curved-text default arc, not a closed circle

- Default `curveSweepAngleDeg` changed from `360` → `180` in all three places it appeared
  (`index.html` input value; `app.js`'s `defaultProject()`; the `??`/`||` fallbacks used when a field
  is missing/blank). `180°` renders as a legible half-circle "banner" arc rather than a closed wreath.
- Added one clarifying hint line under the Curve section: *"180° arcs the text halfway around the
  curve, like a banner. Raise it toward 360° to wrap text into a closed circle."*
- **Backward compatible by construction**: the `??`/`||` fallbacks only ever apply when a layer has
  no explicit value for the field at all. Every existing saved Project JSON that already has an
  explicit `curveSweepAngleDeg` (including old files saved with `360`) round-trips completely
  unchanged — verified live (see Browser Verification).

### 3. Shape-field terminology

- `"X / CX (mm)"` → `"X (mm)"`, `"Y / CY (mm)"` → `"Y (mm)"` (dropped raw SVG-attribute jargon).
- The Width/Radius label (`#shapeWLabel`) and the Height field's wrapper (`#shapeHField`) are now
  retitled/hidden per shape type inside the single existing `syncSelectedControlsFromLayer()`
  function: circles show **"Radius (mm)"** and hide the (inapplicable) Height field entirely;
  every other shape type (Rectangle/SVG/Image/Path) shows **"Width (mm)"** and a visible **"Height
  (mm)"** field, exactly as before.

### 4. Layer-list name tooltip

- `.layer .name` now carries a `title="<full layer name>"` attribute, giving a free native tooltip
  on hover for any name the sidebar's CSS ellipsis truncates. Zero new UI surface, one line changed.

---

## Files Changed

| File | Change |
|---|---|
| `index.html` | `.lightbox-overlay.non-modal` CSS rule; `#lightboxShapes` gets the `non-modal` class + `aria-modal="false"`; curve sweep default `360`→`180` + new hint line; shape field label wording (`X`/`Y`/`shapeWLabel`/`shapeHField`) |
| `app.js` | Curve sweep default/fallbacks `360`→`180` (3 sites); `syncSelectedControlsFromLayer()` retitles `shapeWLabel`/toggles `shapeHField` per shape type; layer-row `title` attribute |
| `package.json` | Wired the new test file into the `test` script |
| `tools/test-s101-ux-workflow-polish.mjs` | **New.** 11 assertions covering all four fixes |
| `tools/test-ui001-lightboxes.mjs` | Test 1 updated: `lightboxShapes` is the one documented `aria-modal="false"` exception |
| `tools/test-ui001-dialog-behavior.mjs` | Test 8 updated the same way; new test 13 asserts the non-modal CSS/class contract directly |
| `tools/test-ui001-topmenu.mjs` | Test 4's overlay-class regex loosened to allow `lightboxShapes`' extra `non-modal` class |

No changes to `GeometryEngine`, `StoneLayout`, any exporter, `src/core/**` (project/layer schema), or
`src/ui/Lightbox.js` (the shared dialog controller itself is untouched — only its CSS/markup usage for
one instance changed).

---

## Architecture Summary

- Reused the existing Lightbox architecture completely — no second dialog implementation, no new
  interaction model. The non-modal treatment is a CSS modifier class applied to one existing overlay
  instance; `src/ui/Lightbox.js`'s open/close/focus-trap/Escape logic is untouched and still governs
  every dialog, including Shapes.
- The curved-text default change is a pure default-value edit; `GeometryEngine`/the permanent text
  engine already accepted any `curveSweepAngleDeg` value and required no change.
- The shape-field relabeling reuses the single existing shared DOM block
  (`#sharedPositionFields`) and the single existing sync function
  (`syncSelectedControlsFromLayer()`) — no new field-relocation logic, no new component.
- All changes are additive/localized to `index.html`+`app.js`'s UI layer; `src/**`'s permanent modules
  are untouched.

---

## Test Results

`npm test`: **all suites pass, exit code 0** (768 passing assertions across 61 suites, up from 60 —
the new `tools/test-s101-ux-workflow-polish.mjs` adds 11 assertions; three pre-existing structural
tests were updated in place to reflect the one deliberate `aria-modal="false"` exception rather than
weakened).

---

## Browser Verification

Performed with an isolated headless Chrome instance (own `--user-data-dir`, own randomized remote-
debugging port `127.0.0.1:9334`, software WebGL via `--use-gl=angle --use-angle=swiftshader` for a
realistic 3D-preview signal, killed at the end of the session). No existing Chrome window/profile was
touched, closed, or quit — verified before and after (`ps aux` showed only the user's pre-existing
Chrome process, unrelated to this session, still running throughout).

Verified, at a realistic 1440×900 viewport:

- **Boolean Ops workflow (end-to-end, real regression)**: opened Shapes, added a Circle and a
  Rectangle *while the dialog stayed open*, confirmed `elementFromPoint()` over a Layers-list row
  returns the row itself (not the overlay), Shift-clicked both rows *through* the dialog's own
  backdrop without closing it, watched the Union button go from disabled → enabled and the selection
  summary update to "2 layers selected," clicked Union, got
  `"Union: combined 2 layers into one editable shape (1 contour)."` — the dialog was never closed
  during the whole sequence. This is the exact workflow the original hint text promised but the old
  modal blocked.
- **Curved text**: enabling Curved Text now defaults to `180°` and renders as a legible arc — visually
  confirmed in both the 2D canvas and the 3D mug preview (screenshot: text reads as a banner arcing
  over the top of the mug, not a closed wreath).
- **Shape field terminology**: selecting a Circle layer shows "Radius (mm)" with the Height field
  hidden; selecting a Rectangle shows "Width (mm)" with Height visible; X/Y show plain "(mm)" labels
  with no SVG jargon.
- **Layer tooltip**: confirmed `title` attribute present and equal to the full (untruncated) layer
  name, including for a freshly-imported layer.
- **Undo/redo**: 3× undo after Union/add-circle/add-rectangle correctly restored the original
  single-layer state.
- **Keyboard interaction**: Escape still closes the (now non-modal) Shapes dialog — the pointer-events
  change does not affect the document-level keydown handler.
- **Save/load round trip (backward compatibility, the critical check)**: exported a Project JSON with
  curved text enabled — confirmed `"curveSweepAngleDeg": 180"` in the file. Separately hand-crafted an
  **old-style** project with an explicit `"curveSweepAngleDeg": 360` (simulating a file saved before
  this milestone) and imported it: the loaded layer's sweep angle field read back exactly **360**, not
  silently rewritten to the new default. Compatibility confirmed, not just asserted.
- **Export / Production Sheet dialogs**: unaffected, still fully modal, opened and closed cleanly, no
  visual regressions, no clipped controls at 1440×900.
- **Dual Workspace / Object Preview / 2D Canvas tabs**: all switch correctly; 3D preview renders
  without the RS-1006A duplicated-artwork defect recurring.
- **Console**: zero errors or exceptions across the entire pass (with software WebGL enabled — see
  note below). `favicon.ico` independently confirmed to 404 via `curl` (pre-existing, unrelated to
  this milestone, matches the task's own "known favicon 404" allowance).

**Note on the 3D/WebGL console errors seen on the first pass**: the initial isolated headless Chrome
launch (no GPU flags) threw `THREE.WebGLRenderer` context-creation errors on every page load. This is
an artifact of headless Chrome's sandboxed, GPU-less environment, not a code defect — the errors
disappeared completely once the second Chrome instance was launched with software rendering
(`--use-gl=angle --use-angle=swiftshader`), which is unrelated to any change in this milestone.
Reported here for transparency since the task instructions ask for an exhaustive console-error
account.

---

## Remaining Known UX Issues (found during this pass, out of scope for S-101)

- **Narrow-viewport (~1100–1300px) Layers-list name collapse.** At the intermediate responsive
  breakpoint (below 1300px, where `--left-panel-width` shrinks to 220–240px), the `.layer` grid row's
  fixed-width columns (checkbox/type/3 icon buttons) leave the name column almost no room —
  confirmed live: the name element's rendered width collapses to ~2px, making the layer name
  effectively invisible (not just further-truncated) at that width. Confirmed pre-existing (identical
  on `develop` before this branch's changes — `git diff develop -- index.html` shows no change to
  `.layer`'s grid-template-columns or the responsive breakpoints). Not fixed here: it is a distinct,
  general responsive-layout defect, not one of the four audited S-101 items, and a real fix likely
  wants a small dedicated pass (e.g., collapsing the type badge or icon buttons below a breakpoint)
  rather than a one-line patch bundled into this milestone. Recommend a follow-up polish item.
- Every other friction item already catalogued in `RS-2000A-PostMVPAudit.md` Part 3/11 (schema
  reconciliation, validation engine, font-library size, Design Library backup/export, autosave, etc.)
  remains open and out of scope by design.

---

## Product Owner Review

**Did these changes noticeably improve the product for a first-time user?** Yes, on the two items
most likely to shape a first impression:

- A first-time user who enables Curved Text — the marquee feature this milestone specifically
  protects — now sees a legible arc instead of a surprising closed wreath on the very first toggle,
  confirmed by direct visual comparison (before: tight closed loop; after: readable banner arc, both
  screenshotted in this session against the identical "Vitalina Serbin" default text).
- A user attempting the Shapes dialog's own advertised workflow — select 2+ layers, combine them —
  can now actually do it without an unexplained failure or a "close-select-reopen" workaround they'd
  have to discover themselves. This was verified as a real, reproducible, end-to-end fix (Union
  executed successfully with the dialog never closed), not just a UI cosmetic change.

The terminology and tooltip fixes are smaller, "no longer confusing" wins rather than
"noticeably delightful" ones — appropriate for their size, and unlikely to be the thing a user
mentions first, but they remove two small, real "this looks unfinished" moments (a blank Height field
on a circle; unexplained "CX"/"CY" jargon).

**Would you change anything else before RS-2001?** One item surfaced live during this pass is worth a
follow-up before or alongside RS-2001: the narrow-viewport Layers-list name collapse described above.
It's a real, reproducible defect a user resizing their window (or working on a smaller laptop screen)
would hit, and it was not on record anywhere before this session. Everything else already on the
RS-2000A roadmap (schema reconciliation, validation engine, font-library expansion, Design
Library backup) stands as previously triaged — this pass found no new evidence to reprioritize any of
it ahead of what RS-2000A already recommended.

**Evidence, not opinion**: every claim above is backed by either a passing automated assertion (see
`tools/test-s101-ux-workflow-polish.mjs`) or a specific, reproducible live-browser observation
recorded in this document (element-level `elementFromPoint()` checks, exact exported-JSON field
values, exact rendered label text, before/after screenshots) — not a general impression.

---

## Recommendation

**APPROVED FOR REVIEW**
