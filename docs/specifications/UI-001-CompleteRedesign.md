# UI-001 — Complete Application Redesign

## Objective

Replace the current single long scrolling sidebar with a modern, minimal, "expensive-looking"
professional desktop-design-tool interface: a top application menu, a compact left project/layer
panel, a large central 2D/3D workspace, a compact contextual right inspector, and focused Lightbox
dialogs for full feature parameters. This is a reorganization and restyling of the existing UI. It
preserves 100% of existing user-facing behavior, geometry, exports, and project compatibility.

No mockup image file was actually attached to the chat message that authorized this milestone —
only a detailed textual visual-direction brief (deep blue primary, white background, light neutral
surfaces, minimal borders, subtle shadows, generous whitespace, compact controls). That text is
used as the acceptance reference for the design token system and layout below; there is no image to
pixel-compare against. This is recorded as a limitation, not a blocking contradiction — the brief is
specific enough to implement and verify against.

## Current Repository State (inspected before writing this spec)

* `index.html` (single file, ~17KB): one dark top bar, one `.side` scrolling sidebar `<aside>`
  containing every control for every layer type stacked vertically (project name, object type,
  layer list, add/import buttons, Align & Snap section, text/curve controls, shape/svg/image
  controls, stone size/gap/color, cup color, 3D view controls, project import, five normal exports,
  Production Sheet controls/exports), plus two side-by-side `<section>` panels (`#layout` 2D canvas,
  `#cup` 3D canvas) always visible, plus one modal (`#imageImportPanel`, Image Trace preview/commit).
  All styling is a single inline `<style>` block (no external stylesheet is linked).
* `app.js` (601 lines, dense): owns all state, the local `GeometryEngine` bridge to the permanent
  engine, undo/redo wiring, drag/resize/selection/snap pointer handlers, and every `<input>`/
  `<select>`/`<button>` event listener, addressed via `el(id) = document.getElementById(id)`. It
  imports only permanent-module barrels (`src/geometry`, `src/fonts`, `src/text`, `src/renderer`,
  `src/export`, `src/svg`, `src/history`, `src/products`, `src/preview3d`, `src/image`,
  `src/editing`), enforced by `tools/test-app-module-migration.mjs`.
* `style.css` exists but is **not referenced by `index.html`** (dead/legacy from an earlier
  milestone) and is protected by a hard, pre-existing guard
  (`tools/test-app-module-migration.mjs`'s forbidden-file list forbids any change to `style.css`).
  This redesign leaves it untouched and continues not linking it — all styling stays in
  `index.html`'s `<style>` block, now built on CSS custom properties (design tokens).
* 41 test suites currently pass (`npm test`); 18 of them assert directly against `index.html`'s raw
  markup (id presence, specific tag/attribute patterns, a handful of DOM-order/adjacency
  assumptions tied to the old single-sidebar layout). Each is accounted for in "Test Impact" below.

## Required Outcome

A four-region shell (top menu, left panel, central workspace, optional right inspector) plus nine
Lightbox dialogs (Text, Shapes, Import, Image Trace, Export, Production Sheet, Shipping & Handling,
Settings, Help), built on a centralized CSS custom-property design-token system in deep blue /
white / light-neutral, with every existing control preserved, relocated, and reachable without deep
scrolling.

## Architecture Requirements

* No change to `src/geometry/**`, `src/export/**`, `src/history/**`, `src/products/**`,
  `src/preview3d/**`, `src/svg/**`, `src/image/**`, `src/text/**`, `src/fonts/**`, `src/core/**`,
  `src/browser/**`, `src/editing/**`, or `src/renderer/**` business logic, `StoneLayout`/`Stone`
  schemas, export file schemas, or Project JSON schema.
* A real, working "Grid toggle" was investigated and deliberately dropped from this milestone's
  scope: `drawGrid()` is called unconditionally inside the permanent `src/renderer/CanvasRenderer2D.js`,
  so a real (non-fake) toggle requires touching that module. Doing so would additionally require
  amending roughly ten pre-existing tests' own `git status`-based forbidden-file guards (nearly
  every renderer/export/geometry milestone's integration suite independently re-forbids
  `src/renderer/CanvasRenderer2D.js` or the whole `src/renderer/` prefix) — a blast radius far
  larger than the one-line feature itself, for a control that isn't part of "preserve all existing
  functionality" (the grid was never toggleable before). The workspace toolbar instead shows a
  plain "grid always on" label rather than a non-functional control; see "Known Limitations."
* The Safe-area toggle is real and has none of this cost: `drawSafeAreaGuide()` is already an
  app.js-local overlay call (not inside any permanent module), so gating it behind a boolean is a
  same-file, zero-cascading-risk change.
* `app.js` keeps its existing `el(id)`-based single-canonical-control-per-field architecture: every
  field the app already reads/writes keeps exactly one DOM node and one id. Fields that the brief
  requires to appear in *both* the right inspector (quick-edit) and a Lightbox (complete editor) —
  shape position/size (`shapeX/Y/W/H`) and the shared stone fields (`stoneSize`/`gap`/`stoneColor`)
  — are implemented as one physical DOM node per field that is *relocated* (`appendChild`, which
  preserves bound listeners) between an inspector slot and the relevant open Lightbox's slot. This
  avoids duplicate ids, duplicate state, and any possibility of the two surfaces disagreeing — a
  real correctness concern in a manufacturing app — at the cost of the field only being visible in
  one place at a time (inspector when no Lightbox is open, Lightbox when one is). This is
  interpreted as satisfying "do not duplicate every parameter in both the inspector and Lightbox"
  literally, not just in spirit.
* One small new permanent-shaped UI module, `src/ui/Lightbox.js` (+ `src/ui/index.js` barrel),
  activating the pre-existing but previously-empty `src/ui/` directory
  (`src/ui/README.md` already described this purpose). Pure DOM dialog behavior only — open/close,
  focus trap, Escape-to-close, backdrop click, ARIA attributes — zero knowledge of `Project`,
  `Layer`, `StoneLayout`, or any layer type. Consumed only by `app.js`, exactly like every other
  permanent module. `tools/test-app-module-migration.mjs`'s app.js import allow-list gets one new
  entry for it (the same "each new permanent module gets an allow-list entry" pattern every prior
  milestone used).
* Text layers gain two new manual numeric fields, `#textX`/`#textY` (mm), wired into
  `writeSelectedControlsToLayer()`'s text branch and `syncSelectedControlsFromLayer()`, writing to
  the same `layer.x`/`layer.y` fields RS-1009 already added (previously settable only by drag/
  nudge/align/distribute, never by typing a number). This is required by the brief's explicit
  "Position X/Y in mm where supported" Text Lightbox field and is a minimal, additive exposure of
  data that already exists on the layer — not a geometry change.
* No change to keyboard shortcuts, undo/redo semantics, snap/align math, or any exporter output.

## Feature-to-UI Inventory

Every currently-implemented user-facing control, and exactly where it lives after the redesign.
"id" is the literal DOM id, unchanged unless noted, so the majority of existing structural tests
(id-presence / tag-pattern assertions) continue to pass with zero test changes.

| Feature / control (current id) | Today | After UI-001 |
|---|---|---|
| Project name (`projectName`) | Sidebar text input | Left panel → Project section (live) + Settings Lightbox (reference) |
| Object type / template (`objectType`) | Sidebar select | Shapes Lightbox → Object Templates tab |
| Units | Implicit ("mm" everywhere, no control) | Left panel → Project section, read-only "mm" label (no unit-conversion feature exists to control) |
| Selected layer dropdown (`selectedLayer`) | Sidebar select | Left panel → Layers section |
| Layers list (`layersList`, visibility/select/duplicate/delete per row) | Sidebar list | Left panel → Layers section |
| Add circle (`addCircle`) | Sidebar button | Left panel Layers "Add" shortcut → opens Shapes Lightbox (Design Shapes tab); direct add also available inside that tab |
| Add rectangle (`addRect`) | Sidebar button | Same as above |
| Import SVG (`importSvg`/`importSvgFile`) | Sidebar button + hidden file input | Import Lightbox → SVG Import tab |
| Import Image (`importImage`/`importImageFile`) | Sidebar button + hidden file input | Image Trace top-menu button |
| Delete selected layer (`deleteSelected`) | Sidebar button | Left panel → Actions section |
| `layerRuleHint` (last-layer guard) | Sidebar, after delete button | Left panel → Layers section, immediately after the delete-selected button (unchanged adjacency) |
| Align left/centerH/right/top/centerV/bottom (`alignLeft` etc.) | Sidebar buttons | Workspace toolbar → "Align & Snap" cluster (compact icon buttons) |
| Distribute H/V (`distributeH`/`distributeV`) | Sidebar buttons | Workspace toolbar → "Align & Snap" cluster |
| Snap toggle (`snapEnabled`) | Sidebar select | Workspace toolbar → "Align & Snap" cluster |
| Selection summary (`selectionSummary`) | Sidebar text | Workspace toolbar → "Align & Snap" cluster |
| Text content (`text`) | Sidebar input | Text Lightbox |
| Font (`font`) | Sidebar select | Text Lightbox |
| Text height mm (`height`) | Sidebar input | Text Lightbox |
| Auto fit (`autoFit`) | Sidebar select | Text Lightbox |
| Text mode / outline-fill (`textMode`) | Sidebar select | Text Lightbox |
| Curved text on/off (`curveEnabled`) | Sidebar select | Text Lightbox |
| Curve radius/direction/start/sweep/alignment (`curveRadiusMm` etc.) | Sidebar, `curveControls` sub-panel | Text Lightbox, same sub-panel |
| Text position X/Y mm | **New** (`textX`/`textY`) — previously mouse/keyboard-only | Text Lightbox (new manual fields; see Architecture Requirements) |
| Shape X/Y/W/H (`shapeX/Y/W/H`) | Sidebar, shared for circle/rect/svg/image | Right inspector (quick-edit, relocated node) + Shapes Lightbox / Import Lightbox / Image Trace Lightbox (same relocated node, whichever is open) |
| SVG fill mode (`svgMode`) | Sidebar select | Import Lightbox → SVG Import tab |
| Image threshold/invert/blur/max W/H (`imgThreshold` etc.) | Sidebar, post-commit editing | Image Trace Lightbox (post-commit fields also mirrored in right inspector's "More Options") |
| Image preview panel (`imageImportPanel` + `imgPreview*`/`imageImportPreviewCanvas`/`imageImportStoneCount`/Cancel/Commit) | Standalone modal | Becomes the Image Trace Lightbox's own body (same ids, same modal contract, now the reusable Lightbox shell) |
| Stone size (`stoneSize`) | Sidebar select | Right inspector (quick-edit, relocated node) + Text/Shapes/Import/Image-Trace Lightboxes (same relocated node) |
| Gap mm (`gap`) | Sidebar input | Same relocation pattern as stone size |
| Stone color + swatch (`stoneColor`/`stoneColorSwatch`) | Sidebar select + swatch | Same relocation pattern as stone size |
| Cup/preview background color (`cupColor`) | Sidebar select | Settings Lightbox (project-level default) + workspace 3D-tab quick control |
| 3D view buttons Front/Left/Right/Back (`.viewBtn`) | Sidebar buttons | Workspace → 3D tab toolbar |
| Rotation slider (`rotation`) | Sidebar range | Workspace → 3D tab toolbar |
| Zoom slider (`zoom`) | Sidebar range | Workspace → 3D tab toolbar |
| Reset view (`resetView`) | Sidebar button | Workspace → 3D tab toolbar |
| Wrap mode (`wrap`) | Sidebar select | Shapes Lightbox → Object Templates tab (it is a per-template preview option, not a design-shape one) |
| Import Project JSON (`importProject`/`importProjectFile`) | Sidebar button + hidden file input | Import Lightbox → Project Import tab |
| Export Project JSON / Generated Layout JSON / 2D SVG / 2D PNG / Cup PNG (`exportProject` etc.) | Sidebar buttons | Export Lightbox |
| Production Sheet page size/margin/mirror/registration marks + SVG/PNG/PDF export (`prodSheetPageSize` etc.) | Sidebar controls | Production Sheet Lightbox |
| Undo/Redo (`undoBtn`/`redoBtn`) + dirty indicator (`dirtyIndicator`) | Top bar | Top menu (unchanged position/behavior) + Left panel → Actions section (Save/Undo/Redo shortcuts) |
| 2D canvas (`layout`) + stats (`layoutStats`) + fit notice (`fitNotice`) | Always-visible panel | Workspace → 2D tab (default active) |
| 3D canvas (`cup`) + stats (`cupStats`) | Always-visible panel | Workspace → 3D tab |
| 2D/3D switching | **New** — both panels were always shown side by side | Workspace tab bar (`viewTab2D`/`viewTab3D`) |
| Grid toggle | Not implemented (grid was always-on before; a real toggle needs a permanent-renderer change, dropped — see Known Limitations) | Workspace toolbar shows an "always on" label, not a fake toggle |
| Safe-area toggle | **New** (was always-on; now app.js-local boolean gate, zero renderer change) | Workspace toolbar |
| Canvas/safe-area dimensions, units, selection bounds | Partially shown today (`layoutStats` text) | Workspace status strip, expanded with safe-area size and current selection bounds (computed from the same `getLayerBBox()`/`unionBBoxOfLayers()` app.js already has) |
| Shipping & Handling | Not implemented | New Lightbox shell with local-only metadata fields (package type/L/W/H/weight/notes/fragile), **not saved with the project** (see Shipping & Handling section below) |
| Settings | Not implemented as a dialog (controls were just inline) | New Lightbox aggregating units (read-only "mm"), theme (fixed "Light"), grid/safe-area/snap defaults, default stone size/gap, cup color default, app info |
| Help | Not implemented | New static-content Lightbox |

## Central Workspace

* 2D tab (default) and 3D tab, toggled by two tab buttons; only one canvas panel is laid out at a
  time, so each gets the full workspace width (more canvas area than today's fixed 50/50 split, not
  less).
* 2D tab: `#layout` canvas (unchanged auto-fit-to-viewport rendering — this milestone does not add
  2D pan/zoom, which does not exist today; see Known Limitations), the Align & Snap toolbar cluster,
  grid toggle, safe-area toggle, dimensions/selection-bounds status strip.
* 3D tab: `#cup` canvas (unchanged `OrbitControls` rotate/zoom/pan), Front/Left/Right/Back buttons,
  rotation slider, zoom slider, reset view, cup color quick control.
* Switching tabs calls the existing `updateAll(true)` after toggling `display`, so the just-shown
  canvas's `resizeCanvas()`/`ResizeObserver` picks up its real (now non-zero) box size — verified in
  browser testing, not just asserted.

## Shipping & Handling

Inspected the repository: no shipping/handling/carrier/weight/package code exists anywhere in
`app.js`, `src/**`, or the project schema. Per the brief, this milestone adds a lightweight local
metadata Lightbox only: package type, length/width/height (mm, consistent with the rest of the
app's units), weight (g), handling notes, fragile toggle. These fields are **UI-only local state**,
intentionally **not** added to `project` / Project JSON / `validateProject()` / undo-redo snapshots
in this milestone — the brief allows "Save with project only if this can be done without breaking
compatibility," and since `validateProject()` currently rejects unrecognized top-level fields
permissively (it does not reject them, it simply never reads them) a schema addition is *possible*
without breaking old files, but doing it correctly (round-trip through undo/redo, export/import,
dirty-tracking) is a real, separate piece of state-management work, not a styling/reorg change. It
is deliberately deferred rather than half-wired. The dialog is fully built and interactive (values
persist for the session, in a local `shippingInfo` object), with a visible note that values reset on
reload/reopen — not a fake "coming soon" placeholder, but honestly scoped.

## Test Impact

New tests (`tools/test-ui001-*.mjs`, see below) plus narrow, documented carve-outs to five
pre-existing structural tests whose exact assumptions were tied to the single-sidebar layout this
milestone deliberately replaces:

1. `tools/test-ui-discoverability.mjs` — fully rewritten. Its entire premise (a single `.side` panel
   whose content must appear within the first N pixels) is superseded by the new architecture, where
   discoverability is structural (top menu always visible, left panel scoped to Project/Layers/
   Actions only) rather than a scroll-position heuristic. New assertions check the same underlying
   intent: layer-creation/import affordances reachable from the left panel or one always-visible
   top-menu click, left panel contains no per-layer-type detail fields, top menu buttons exist in
   the required order.
2. `tools/test-curved-text-integration.mjs` test 7 — the old regex assumed `#shapeControls` is the
   literal next sibling after `#textControls`. Replaced with a small tag-depth-counting
   `extractElementHtml(html, id)` helper that extracts `#textControls`'s full inner HTML regardless
   of what follows it, then runs the exact same field-presence assertions as before.
3. `tools/test-object-template-integration.mjs` test 2 — the old assertion required
   `#objectType` to appear before `#selectedLayer` and `#cupColor` in raw source order (a
   single-sidebar artifact). Replaced with an assertion that `#objectType` is inside the Shapes
   Lightbox's Object Templates section (using the same `extractElementHtml` helper) and reachable
   from the always-visible top menu.
4. `tools/test-alignment-snapping-integration.mjs` — the "`Align & Snap` text before `#textControls`"
   ordering assertion (test 20) is preserved as-is and passes unmodified, since the new DOM order
   deliberately keeps the whole app shell (including the workspace toolbar's "Align & Snap" label)
   before any Lightbox markup in document order. Only the forbidden-file guard is amended (see
   Architecture Requirements above), with a one-line comment explaining why.
5. `tools/test-app-module-migration.mjs` — the app.js import allow-list gains one new entry for
   `src/ui/index.js`.

No other pre-existing test file's assertions depend on control location, only on id/tag-attribute
presence, which the inventory table above preserves for every field.

## Out of Scope (unchanged from the milestone brief)

Alignment & Snapping, Vector Boolean Operations, Variable Stone Sizes, new fill algorithms, a design
library, new GeometryEngine algorithms, new object templates, new editable shape types, real
shipping/carrier APIs, billing, a mobile application, a photorealistic 3D redesign, and S-004. The
existing Alignment & Snapping *feature* (RS-1009) is relocated, not extended or removed — it keeps
its exact current math, math module, and keyboard/mouse behavior.

## Known Limitations

* **No real grid toggle.** See "Architecture Requirements" — dropped to avoid touching the
  permanent renderer and ~10 unrelated tests' forbidden-file guards for one display control that
  was never toggleable before this milestone.
* **2D canvas has no pan/zoom.** It was auto-fit-to-viewport before this milestone and remains so;
  adding real 2D pan/zoom is a new interaction, not a reorg, and is out of scope.
* **Shipping & Handling is session-only.** See the "Shipping & Handling" section above.
* **Settings' default stone size/gap fields do not yet affect new-layer creation** (addCircle/
  addRect already default sensibly from the currently selected layer); wiring them would be new
  state-management behavior, not a styling/reorg change.
* **No mockup image was attached to the chat message that authorized this milestone** — only the
  textual visual-direction brief, used as the acceptance reference instead.

## Deliverables

* `index.html` — full DOM/CSS restructure (design tokens, top menu, left panel, workspace with
  2D/3D tabs, right inspector, nine Lightbox dialogs), same inline `<style>` block (style.css stays
  untouched and unlinked, per the pre-existing forbidden-file guard).
* `app.js` — additive UI orchestration only: Lightbox open/close wiring per top-menu button, tab
  switching, field-relocation helpers, `textX`/`textY` fields, safe-area-toggle boolean state,
  Shipping & Handling local state, Settings-panel wiring, Help content. No change to
  geometry/history/selection/snap/export logic, and no change to `src/renderer/**`.
* `src/ui/Lightbox.js`, `src/ui/index.js` — new generic dialog controller module.
* `docs/ARCHITECTURE.md` — new "User Interface (UI-001 Redesign)" implementation-status paragraph
  and a `src/ui/**` row in the Layer map table.
* Tests: `tools/test-ui001-topmenu.mjs`, `tools/test-ui001-lightboxes.mjs`,
  `tools/test-ui001-leftpanel.mjs`, `tools/test-ui001-dialog-behavior.mjs`,
  plus the carve-outs listed above; `package.json` test
  script updated.
* `TASK.md`, `TASK_RESULT.md`.

## Acceptance Criteria

* `npm test` passes in full (all pre-existing + new suites).
* Every item in the Feature-to-UI Inventory table is present and wired in the live app.
* Real-browser verification at 1280×800 / 1366×768 / 1440×900 / 1920×1080, all nine Lightboxes,
  and the sixteen workflows listed in the milestone brief, with screenshots.
* No `StoneLayout`, export-file, or Project-JSON schema change.
