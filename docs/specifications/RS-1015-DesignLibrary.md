# RS-1015 — Design Library

## Objective

Let users save commonly-used rhinestone designs — a single selection or an entire project — into a
personal library, then browse, search, filter, rename, duplicate, delete, and reuse them (insert
into the current project, or start a new project from one). The Design Library is a **user
workflow feature layered on top of the existing project/layer model** — it introduces no second
project format, no parallel geometry pipeline, and no parallel renderer.

## Audit Findings (before implementation)

* **No template/preset/library infrastructure exists.** `src/products/ObjectTemplate.js` (RS-1004)
  is a same-named-sounding but unrelated concept: a catalog of physical *product* templates
  (mug/tumbler/bottle print-area geometry), not reusable *design* content. `src/core/Project.js`/
  `Layer.js` are a fully-formed, validated, serializable project/layer model — but per
  `docs/ARCHITECTURE.md`'s "Current Architectural Limitations" #1, they are **not used by the live
  app** (`tools/test-app-module-migration.mjs` enforces `app.js` never importing `src/core/**`).
  There is no `localStorage`/`indexedDB` usage anywhere in the repository today — this milestone is
  the first persistent-storage consumer.
* **The live project *is* the authoritative format.** `app.js` owns one ad hoc plain-object
  `project` (`{version, units, name, product, canvas, cupColor, wrap, layers:[...]}`), serialized
  via plain `JSON.stringify(project)` (`#exportProject`) and restored via `validateProject()`
  (`#importProjectFile`) — the exact shape every layer type (`text`/`circle`/`rectangle`/`svg`/
  `image`/`path`) already round-trips through today. `duplicateLayer()` already shows the correct
  pattern for cloning a layer (deep `JSON.parse(JSON.stringify(...))`, then a fresh id, then a small
  positional offset), and it already works uniformly across every layer type without a per-type
  switch on which *fields* to copy.
* **Reusable rendering pipeline for thumbnails already exists.** `app.js`'s local `engine.generate(
  project)` bridge (a thin per-layer dispatcher to the permanent `GeometryEngine`, merged + deduped
  into one `StoneLayout`) plus the permanent `renderProductionLayout(ctx, stoneLayout, {widthPx,
  heightPx, paddingPx})` (`src/renderer/CanvasRenderer2D.js`) is exactly what the live 2D canvas
  already calls (`drawLayout()`). Both are reusable as-is against a small offscreen `<canvas>` to
  produce a thumbnail — no second rendering pipeline is needed.
* **Undo/redo, selection, and the Lightbox dialog system are all generic and reusable.**
  `HistoryManager` (`src/history/**`) snapshots `{project, selectedLayerId}` JSON generically —
  inserting library layers via the same `commitHistory()` → mutate `project.layers` → `updateAll()`
  pattern every other add-layer action already uses gives correct undo/redo for free, with zero
  History changes. `src/editing/Selection.js`'s `selectMany()` (RS-1010) already selects an
  arbitrary id set, useful for selecting newly-inserted layers. `src/ui/Lightbox.js` (UI-001) is a
  generic dialog controller; a new "Design Library" dialog is just another `new Lightbox(...)`
  entry, no changes to `src/ui/**` itself.
* **`validateProject()` already exists in `app.js`** and is the correct, single place to validate a
  whole-project library item before it becomes the live `project` — reused as-is, not duplicated.

**Conclusion:** the only genuinely new capability needed is (1) a small, pure, DOM-free data module
that stores/organizes library item records (name/category/tags/thumbnail/timestamps + a verbatim
copy of existing project/layer JSON) and (2) `app.js`/`index.html` orchestration wiring a new
Lightbox to that module, reusing the existing generate → render → capture pipeline for thumbnails
and the existing commit-history → mutate-project → `updateAll()` pattern for insertion. No
`src/geometry/**`, `src/renderer/**`, `src/export/**`, `src/editing/**`, `src/history/**`,
`src/products/**`, `src/text/**`, `src/svg/**`, `src/image/**`, `src/preview3d/**`, or
`src/core/**` file changes.

## Architecture

```
Design Library item
  { id, name, category, tags, kind: 'project' | 'selection', created, modified, thumbnail,
    data: { project: <verbatim project JSON> }              -- kind: 'project'
         | { canvas: {width,height}, layers: [<verbatim layer JSON>...] }  -- kind: 'selection' }
```

* A library item's `data` is **never a new schema** — `data.project` is byte-identical to what
  `#exportProject` already writes; `data.layers` entries are byte-identical to entries of
  `project.layers`, i.e. exactly what `duplicateLayer()` already clones. Nothing about a layer's
  geometry, fill style, stone size, color, object type, text properties, SVG source, Image Trace
  buffer, boolean/path contours, transform (`x`/`y`/`w`/`h`/`cx`/`cy`/`r`), or layer ordering is
  reinterpreted — it is carried through as opaque JSON.
* **Storage**: a new permanent module, `src/library/**`, mirroring the existing "pure, DOM-free,
  consumed only through its barrel" shape of `src/editing/**`/`src/history/**`:
  * `LibraryItem.js` — validates/creates an item record, derives a default `category` from the
    layer types it contains (`'Text'`, `'Shapes'`, `'SVG'`, `'Image Trace'`, `'Boolean / Path'`,
    `'Mixed'`, or `'Full Project'`), touches `modified` on update.
  * `LibraryTransform.js` — pure functions: `buildSelectionItemData()`, `buildProjectItemData()`,
    `prepareLayersForInsert()` (fresh ids + small positional offset, mirroring `duplicateLayer()`),
    `buildProjectFromItem()` (constructs a full plain project object from either item kind, for
    "New Project From This").
  * `DesignLibrary.js` — an in-memory list of items behind an injected storage adapter (`load()`/
    `save(items)`), with `add`/`rename`/`duplicate`/`remove`/`get`/`list`/`search`/`filterByCategory`
    /`sortByName`/`categories`. No DOM, no `Project`/`Layer`/`StoneLayout`/`GeometryEngine`
    dependency — fully unit-testable under Node, exactly like `HistoryManager`.
  * `LibraryStorageAdapter.js` — `createLocalStorageAdapter(key)` (real persistence, `localStorage`)
    and `createMemoryStorageAdapter()` (default/fallback and the adapter every Node test uses).
  * `index.js` — barrel, the only file `app.js` imports from.
* **Thumbnails**: generated in `app.js` (orchestration, not a permanent module) by building a
  minimal `{layers, canvas}` project from the item's own data, calling the existing `engine.generate
  ()` bridge, drawing the resulting `StoneLayout` to a small offscreen `<canvas>` via the existing
  `renderProductionLayout()`, and capturing `canvas.toDataURL('image/png')`. This is the exact same
  generate → render call sequence `drawLayout()` already performs against the live canvas — reused,
  not reimplemented. Thumbnails are generated once at save time and cached in the item record (never
  regenerated on every library open), keeping browsing responsive independent of project complexity.
* **Insertion / new-project-from-item** reuse the existing editing pipeline verbatim:
  `commitHistory()` → clone+re-id the item's layers onto `project.layers` → `selectMany(newIds)` →
  `updateAll(true)` for "Insert"; full `project =` replacement + history reset (the same shape
  `#importProjectFile` already uses for a freshly loaded file) for "New Project From This".
  `GeometryEngine`/`StoneLayout` regenerate exactly as they do for any other project edit — no
  special-cased geometry path exists for library-sourced layers.
* **UI**: one new Lightbox (`lightboxLibrary`), opened from a new top-menu button ("Design
  Library"), containing: Save-current-project / Save-selection actions, a search field, a category
  filter, a sort control, and a responsive card grid (thumbnail + name + category + kind badge +
  Insert / New Project / Rename / Duplicate / Delete). Destructive actions (Delete) require a
  confirmation dialog. Card grid styling extends the existing `.template-cards`/`.template-card`
  pattern already used by the Object Templates picker — no new visual language.

## Allowed Files

* `src/library/**` (new)
* `app.js`, `index.html`
* `tools/test-app-module-migration.mjs` (extend the `app.js` import allowlist by one entry, exactly
  as every prior milestone that added a new barrel module did)
* `tools/test-design-library.mjs`, `tools/test-design-library-integration.mjs` (new)
* `package.json` (`test` script)
* `docs/specifications/RS-1015-DesignLibrary.md`, `TASK.md`, `TASK_RESULT.md`

## Forbidden Files

`src/geometry/**`, `src/renderer/**`, `src/export/**`, `src/editing/**`, `src/history/**`,
`src/products/**`, `src/text/**`, `src/fonts/**`, `src/svg/**`, `src/image/**`, `src/preview3d/**`,
`src/core/**`, `src/browser/**`, `src/ui/**`, `style.css`, `assets/**`, `examples/**`, `README.md`,
`LICENSE`, `CONTRIBUTING.md` — matching the union of every pre-existing milestone's own
`git status --porcelain` forbidden-file guard test still active in `npm test`.

## Out of Scope

* Cloud sync / cross-device library, sharing/export of individual library items as separate files,
  drag-and-drop reordering of the grid, nested folders — none required by the brief; may be a future
  milestone.
* Any change to Project JSON's own schema, DXF export, or a Validation Engine module.

## Automated Tests

* `tools/test-design-library.mjs` — `src/library/**` unit tests: item creation/validation/category
  derivation, `DesignLibrary` CRUD, search (case-insensitive substring), category filter, alphabetic
  sort (asc/desc), storage adapter round-trip (save → new instance with same adapter → load),
  `prepareLayersForInsert()` id-freshness + no-shared-references, `buildProjectFromItem()` for both
  `kind`s, performance sanity at ~500 items.
* `tools/test-design-library-integration.mjs` — guards `app.js`/`index.html` wiring: Lightbox
  registered, top-menu button present, DOM ids referenced by new app.js code exist in `index.html`,
  `validateProject` reused (not duplicated) for whole-project items, no forbidden-file changes, no
  new dependency added, `src/geometry`/`src/renderer`/`src/export`/`src/editing`/`src/history` byte
  content unchanged (checked via the shared forbidden-prefix list, consistent with every other
  milestone's own integration test).
* `npm test` must pass in full (all pre-existing + new suites).

## Browser/Manual Verification

Headless Chrome via CDP, isolated temporary profile (never the user's real profile, never a window
named "main"/"airbnb"): save a selection, save a whole project, browse/search/filter/sort, rename,
duplicate, delete (with confirmation), insert into the current project (verify undo/redo, layer
ordering, fill style, stone size, color, transforms all preserved), create a new project from a
library item, thumbnails render correctly, Dual Workspace (2D Canvas + Object Preview), Production
Sheet, and all five export buttons keep working against library-sourced layers; responsive layout at
narrow/wide widths; no console errors other than the known favicon 404.

## Acceptance Criteria

* Every "Library Features" action in the milestone brief works end-to-end in the browser.
* A project saved before this milestone loads, renders, and exports unchanged (Project JSON schema
  untouched).
* `GeometryEngine`, `StoneLayout`, every renderer, and every exporter are byte-unchanged.
* `npm test` passes in full.
* One commit on `feature/rs-1015-design-library`, branch pushed, not merged.

## Required Commands

```bash
npm test
git diff --check
git status
```

## Commit Message

`feat(library): Design Library — save, browse, and reuse rhinestone designs (RS-1015)`

## Deliverables

See `TASK.md` / `TASK_RESULT.md`.

## Next Milestone

Candidate follow-ups (not in this milestone): exporting/importing individual library items as
shareable files, IndexedDB migration if the catalog grows beyond a comfortable `localStorage`
footprint, nested categories/folders.
