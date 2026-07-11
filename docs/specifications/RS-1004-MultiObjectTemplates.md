# RS-1004 — Multi-Object Templates

## Task ID

RS-1004

## Title

Multi-Object Templates — preview and produce one design against Mug / Straight Tumbler / Bottle.

## Status

In progress

## Objective

Let one rhinestone design be previewed and produced against multiple physical object templates,
without duplicating the geometry pipeline or touching `StoneLayout`/`GeometryEngine`. Introduce a
real object-template model (a data-driven plugin registry) in the already-existing but inert
`src/products/**` module, wire it into the live app as a visible "Object type" control, and extend
the schematic 2D preview renderer to draw a Mug, a Straight Tumbler, or a Bottle from the same
`StoneLayout` — exactly as `docs/ARCHITECTURE.md`'s "Product Plugins" section already specifies but
notes is unimplemented.

## Current Repository State (inspected before writing this spec)

* `src/products/README.md` exists ("Product plugins define printable areas...") but there is no
  code in `src/products/**` — no `index.js`, no template model. This is the "already has an
  object/product abstraction" the milestone brief refers to; it must be extended, not duplicated.
* `app.js`'s ad hoc project object already carries a `product` field (`defaultProject()`:
  `product:'mug'`; `validateProject()`: `product:String(obj.product||'mug')`) but nothing reads it.
  `docs/ARCHITECTURE.md`'s "Product Plugins" section confirms this explicitly: "nothing in the
  codebase reads it — there is exactly one hardcoded cup preview." This field is the live
  serialization hook this milestone activates; the field name `product` is kept for backward
  compatibility with every existing Project JSON and `.rhs` example file that already round-trips
  it (see `tools/lib/rhsProject.mjs`, which already threads `product` through `validateRhsProject()`
  and `toAppProjectShape()`, unchanged by this milestone).
* `src/renderer/CupRenderer.js` (`renderCup()`) draws one hardcoded schematic silhouette: a tapered
  frustum body with a handle, parameterized by inline constants (`topW = w*.52*zoom`,
  `botW = w*.43*zoom`, `cupH = h*.64*zoom`, always `hasHandle`). The stone-wrap placement math
  (`wallHalfWidthAt()`, the `front`/`wide`/`half`/`full` theta computation) is generic frustum math
  already independent of "mug"-specific concepts.
* `src/renderer/CanvasRenderer2D.js` (`renderProductionLayout()`) draws the 2D production canvas
  fit to the `StoneLayout`'s own bounding box — it does not draw or depend on `project.canvas`
  dimensions at all today. There is currently no rendered canvas-boundary or safe-area guide of any
  kind.
* `app.js` owns all layer-aware/editor-only overlay drawing (selection outline/handles, HUD text) on
  top of `renderProductionLayout()`'s returned transform — this is the documented, correct place for
  a new safe-area guide overlay, not `CanvasRenderer2D.js` itself (multiple existing guard tests
  protect `CanvasRenderer2D.js`/`StoneColors.js` from casual milestone-to-milestone changes; see
  "Forbidden Files").
* Undo/redo (`src/history/**`), curved text, SVG import, and five export buttons are all live and
  must keep working unchanged in kind (only extended where this milestone's scope requires).

## Expected Visible Change

* A new "Object type" control (Mug / Straight Tumbler / Bottle) at the very top of the left sidebar,
  above "Selected layer" — reachable with zero scrolling on every viewport size already verified by
  `tools/test-ui-discoverability.mjs`.
* Switching it changes: the schematic preview panel's silhouette (mug w/ handle → straight-walled
  tumbler → bottle w/ neck+cap), the safe-area guide drawn on the 2D Production Layout canvas, and
  the wrap-mode dropdown's value (reset to that template's default).
* The preview panel header/labels are relabeled from "Cup"-specific wording ("Cup Preview", "Cup
  background") to object-generic wording ("Object Preview", "Preview background"). The `#cup`
  canvas id, `#cupColor` control id, `exportCup` button id, and the exported filename
  (`rhinestone-cup-preview.png`) are all kept byte-identical — this is the "preserve existing export
  compatibility/name" requirement; only their human-facing labels change.
* Existing Mug projects (Project JSON files with no `product` field, or `product:'mug'`) load and
  render identically to before.

## Required Outcome

1. **Object-template model** (`src/products/**`), separate from `StoneLayout`:
   * `id`, `displayName`.
   * `productionWidthMm` / `productionHeightMm` (the template's default production-canvas size).
   * `preview` parameters describing the schematic silhouette (a plain data object, not a mesh):
     relative top/bottom widths, body height, optional neck/shoulder/cap factors, `hasHandle`.
   * `wrap.supported` (subset of the four existing wrap modes) and `wrap.default`.
   * `safeAreaInsetMm` (`{top,right,bottom,left}`), used to derive a guide rectangle from whatever
     canvas size is actually in effect.
   * At minimum: `mug`, `tumbler` (Straight Tumbler), `bottle`.
2. `project.product` (already-existing field) selects the template id. Switching it via the new UI
   control is a discrete, undoable action: it sets `project.product`, resets `project.canvas` to the
   template's `productionWidthMm`/`productionHeightMm`, and resets `project.wrap` to the template's
   default wrap — then regenerates/redraws exactly like any other discrete layer action
   (`addCircle`/`addRect`/import, i.e. one `commitHistory()` call before mutating).
3. `GeometryEngine`/`StoneLayout` are not touched. `StoneLayout`'s schema, fields, and
   determinism are unchanged. Renderers keep consuming only `StoneLayout` plus plain display
   options (as `CupRenderer.js` already does for `cupColor`/`wrap`/`rotationDeg`/`zoom`) — the new
   `objectTemplate` option is one more plain option of the same kind, not a `Project`/`Layer`
   reference.
4. `CupRenderer.js`'s `renderCup()` is generalized to draw three silhouettes from one shared frustum
   + stone-wrap math (no duplicated wrap/placement geometry): mug (tapered + handle), straight
   tumbler (equal top/bottom width, no handle), bottle (narrower body + shoulder/neck/cap, no
   handle). A template-less call (no `objectTemplate` option) defaults to the exact pre-milestone mug
   parameters — byte-identical fallback behavior for any existing direct caller/test.
5. A safe-area guide (dashed rectangle, from the active template's `safeAreaInsetMm` applied to the
   current `project.canvas` size) is drawn on the 2D Production Layout canvas as an **editor
   overlay in `app.js`** (matching the existing selection-outline/HUD-text precedent), not inside
   `CanvasRenderer2D.js`.
6. Existing Project JSON files without a `product` field continue to default to `'mug'` exactly as
   `validateProject()` already does; an unrecognized `product` value also falls back to `'mug'`
   (defensive, not a thrown error — matches this file's existing permissive style for `cupColor`/
   `wrap`).
7. All five exports, curved text, SVG import, shape drag/resize, undo/redo, and layer editing keep
   working unchanged for every object type.

## Architecture Requirements

* `StoneLayout` stays canonical and unchanged (no new fields, no schema change).
* `GeometryEngine` stays object-agnostic — zero changes to `src/geometry/**`.
* Renderers consume `StoneLayout` plus plain display options only — no `Project`/`Layer` references
  inside `src/renderer/**`.
* One geometry pipeline: the mm-accurate stone positions are unaffected by object type; only the
  *display* (preview silhouette, safe-area guide, wrap angle mapping) varies by template. SVG
  export, Generated Layout JSON export, and the 2D production canvas remain millimeter-accurate and
  independent of which object template is active.
* `app.js` remains the only place that knows about `Project`/`Layer`/layer-aware overlays (per
  `docs/ARCHITECTURE.md`'s "Orchestration Layer" section) — the safe-area guide is drawn there, not
  in a permanent renderer module.
* Extend the existing `src/products/**` abstraction; do not create a second one.

## Allowed Files

```
src/products/ObjectTemplate.js   (new)
src/products/index.js            (new)
src/products/README.md           (updated)
src/renderer/CupRenderer.js
app.js
index.html
docs/ARCHITECTURE.md
docs/specifications/RS-1004-MultiObjectTemplates.md
TASK.md
TASK_RESULT.md
package.json
tools/test-object-template.mjs                 (new)
tools/test-object-preview-renderer.mjs         (new)
tools/test-object-template-integration.mjs     (new)
tools/test-undo-redo-integration.mjs           (narrow guard-list update only)
tools/test-curved-text-integration.mjs         (narrow guard-list update only)
```

## Forbidden Files

* `src/geometry/**`, `src/text/**`, `src/fonts/**`, `src/core/**`, `src/browser/**`,
  `src/svg/**`, `src/history/**`, `src/export/**`, `assets/**`, `examples/**`, `style.css`.
* `src/renderer/CanvasRenderer2D.js`, `src/renderer/StoneColors.js` — safe-area guidance is an
  `app.js` editor overlay, not a `CanvasRenderer2D.js` change, so neither file needs to change; both
  stay untouched (also protected by pre-existing guard tests).

## Out of Scope

* Arbitrary custom 3D meshes, WebGL/Three.js, photorealistic rendering.
* A custom template editor UI (templates are code-defined, per the milestone brief).
* Shirts/hats/bags.
* Manufacturing nesting.
* Changing the `StoneLayout` schema or `GeometryEngine` sampling.
* Per-layer-type object-specific geometry (e.g. cylindrical UV-mapping of stone positions) — the
  preview remains schematic, exactly like the existing mug preview.

## Implementation Notes / Known Discrepancies

* `docs/ARCHITECTURE.md`'s "Product Plugins" implementation-status paragraph currently says this is
  "future work, not a regression" — this milestone makes it real and that paragraph is updated
  accordingly (small, milestone-scoped documentation change, same precedent as every prior
  milestone's own architecture-doc update).
* Two pre-existing guard tests assert forbidden-file lists that would incorrectly block this
  milestone's legitimate changes, per `docs/AI_ENGINEER.md`'s explicit allowance to narrow such a
  list with a comment:
  * `tools/test-undo-redo-integration.mjs` test 10 lists `'src/products/'` as forbidden (correct at
    RS-1002 time, when `src/products/` had no code) — narrowed to drop that entry, with a comment
    pointing at this milestone and its own guard test.
  * `tools/test-curved-text-integration.mjs` test 10 asserts `src/renderer/**` is "byte-for-byte
    untouched by this milestone" — narrowed to drop the `src/renderer/` half of that check (keeping
    the `src/export/` half, since this milestone does not touch `src/export/**`), with a comment
    pointing at this milestone's own guard test, matching the exact precedent already used for the
    equivalent `src/renderer/` carve-outs in `tools/test-svg-integration.mjs` /
    `tools/test-undo-redo-integration.mjs` / `tools/test-examples-regression.mjs` (all reference
    S-001's `tools/test-cup-rotation-stabilization.mjs` as the milestone that owns that file).

## Tests Required

```bash
npm test
git diff --check
git status
```

New/updated suites:

* `tools/test-object-template.mjs` — template registry validation: all three templates exist and
  pass shape validation (display name, positive production dims, valid preview kind, wrap default
  is a member of its own supported set, safe-area insets are non-negative and leave a positive
  interior), unknown id lookup fails predictably, registry is deterministic/immutable-by-convention.
* `tools/test-object-preview-renderer.mjs` — `renderCup()` against a fake `CanvasRenderingContext2D`
  (matching the existing fake-context convention in `tools/test-cup-rotation-stabilization.mjs` /
  `tools/test-ux-visual-polish.mjs`): mug preview unchanged at default params (regression pin against
  pre-milestone values), tumbler preview has no handle draw calls and equal top/bottom silhouette
  width, bottle preview draws a neck/cap region and no handle, all three wrap modes produce stones
  for all three templates, an omitted `objectTemplate` option falls back to the exact pre-milestone
  mug silhouette.
* `tools/test-object-template-integration.mjs` — app.js/index.html wiring (structural checks,
  matching the established convention for browser-entry-point source, since `app.js` is not
  `import()`-able directly under plain Node): the Object type control exists and precedes
  `#selectedLayer`/is not buried below the fold per the existing measurable convention, switching
  commits history before mutating, mug backward compatibility (a Project JSON with no `product`
  field imports and renders identically), save/load round-trip of `product`, undo/redo restores
  `project.product`/`canvas`/`wrap` together, deterministic `StoneLayout` regardless of
  `project.product` (same layers → same stones, object type never perturbs geometry), unchanged
  geometry for unchanged inputs (switching object type and switching back returns to the exact
  original canvas/wrap and never mutates layer geometry fields), export button wiring/filenames
  unchanged, `GeometryEngine.js`/`StoneLayout.js` untouched.
* Existing suites (`npm test`, all 24 pre-existing suites) remain green.

## Browser / Manual Verification

Headless Chrome via raw CDP (established project convention, no new dependency), against
`npm run dev`:

* Create/open the default project; confirm it renders as Mug (unchanged from before this milestone).
* Switch Mug → Straight Tumbler → Bottle: confirm the preview silhouette changes each time, the
  design (stones) remains visible in both the 2D layout and the object-preview panel, the safe-area
  guide updates, and the wrap-mode dropdown updates to that template's default.
* Exercise all four wrap modes for each object type.
* Save (Export Project JSON) and re-load (Import Project JSON) for a non-mug object type; confirm
  `product`/canvas/wrap round-trip exactly.
* Undo/redo across an object-type switch.
* Run all five exports (Project JSON, Generated Layout JSON, SVG, 2D PNG, Object Preview PNG) for at
  least one non-mug object type; confirm filenames are unchanged from before this milestone.
* Zero relevant console errors throughout.
* Capture one screenshot per object type (Mug, Straight Tumbler, Bottle).

## Acceptance Criteria

- [ ] `src/products/**` defines a real, validated object-template registry with Mug/Tumbler/Bottle.
- [ ] `project.product` drives the live preview and is saved/restored in Project JSON.
- [ ] Existing Mug projects open identically (no visual/geometry regression).
- [ ] `StoneLayout`/`GeometryEngine` are byte-for-byte unchanged.
- [ ] The Object type control is visible with zero scrolling.
- [ ] All exports, layer editing, curved text, SVG import, and undo/redo keep working.
- [ ] `npm test` passes in full (pre-existing + new suites).
- [ ] Browser verification performed and recorded honestly in `TASK_RESULT.md`.

## Commit Message

```text
feat(products): add multi-object templates (mug/tumbler/bottle) (RS-1004)
```

## Deliverables

* This specification.
* `TASK.md` replaced for RS-1004.
* Implementation + tests above.
* `docs/ARCHITECTURE.md` "Product Plugins" status update.
* `TASK_RESULT.md` completed.
* One commit, pushed to `feature/rs-1004-multi-object-templates`.

## Next Milestone (candidate, not started)

Per-object-type production-safe layer placement guardrails (warn, don't block, when a layer's stones
fall outside the active template's safe area) — deferred, since the milestone brief scopes this
round to preview/production switching only, not new validation UX.
