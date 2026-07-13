# Task

**Task ID:** RS-1015
**Task Type:** Feature — Design Library
**Specification:** `docs/specifications/RS-1015-DesignLibrary.md`
**Status:** IMPLEMENTED
**Branch:** feature/rs-1015-design-library

## Goal

Let users save, organize, preview, and reuse commonly-used rhinestone designs — a selection of
layers or an entire project — as a personal "Design Library", opened from the top menu, without
introducing a second project format or a second geometry/rendering pipeline.

## Required Outcome

See `docs/specifications/RS-1015-DesignLibrary.md` in full. Summary:

* Audit-first: no template/preset library infrastructure exists yet. `src/products/ObjectTemplate.js`
  is an unrelated concept (physical product templates, not design content); `src/core/Project.js`/
  `Layer.js` are unused by the live app. The live ad hoc `project`/layer JSON (already round-tripped
  by `#exportProject`/`validateProject()`) is reused verbatim as a library item's payload — no new
  schema for geometry/fill style/stone size/color/object type/text/SVG/Image Trace/boolean-path/
  transforms/layer ordering.
* New: `src/library/**` (`LibraryItem.js`, `LibraryTransform.js`, `DesignLibrary.js`,
  `LibraryStorageAdapter.js`, `index.js`) — a pure, DOM-free module (storage-adapter-injected CRUD +
  search/filter/sort + pure clone/insert/new-project transforms), fully unit-testable under Node,
  mirroring `src/editing/**`/`src/history/**`'s existing shape.
* `app.js`/`index.html`: one new Lightbox ("Design Library") from a new top-menu button; thumbnail
  generation reuses the existing `engine.generate()` bridge + `renderProductionLayout()` against an
  offscreen canvas (no second rendering pipeline); insertion and layer cloning reuse the existing
  `commitHistory()`/`updateAll()`/`duplicateLayer()`-style deep-clone-then-reid pattern; "New Project
  From This" mirrors the existing Project JSON import's full-replace + history-reset shape, reusing
  `validateProject()` for whole-project items.
* `GeometryEngine`, `StoneLayout`, every renderer, and every exporter are untouched.

## Rules

* Follow `docs/AI_ENGINEER.md`, `docs/CLAUDE_GUIDE.md`, `docs/ARCHITECTURE.md`,
  `docs/MILESTONE_WORKFLOW.md`.
* Repository is the source of truth; audit before implementing; do not duplicate project
  serialization, `GeometryEngine`, `StoneLayout`, or renderer/exporter logic.
* Do not touch any forbidden-file prefix still enforced by an existing `npm test` guard (`src/
  geometry/`, `src/renderer/`, `src/export/`, `src/editing/`, `src/history/`, `src/products/`,
  `src/text/`, `src/fonts/`, `src/svg/`, `src/image/`, `src/preview3d/`, `src/core/`, `src/browser/`,
  `src/ui/`, `style.css`, `assets/`, `examples/`, `README.md`, `LICENSE`, `CONTRIBUTING.md`).
* Preserve backward/project compatibility: a project saved before this milestone must load and
  render unchanged; Project JSON's schema does not change.

## Deliverables

* `src/library/**` — new permanent module (item model, transforms, storage-adapter-backed CRUD,
  barrel).
* `app.js`, `index.html` — Design Library Lightbox, top-menu entry, thumbnail generation, save/
  insert/create-project/rename/duplicate/delete wiring.
* `tools/test-app-module-migration.mjs` — extend the `app.js` import allowlist by one entry.
* `tools/test-design-library.mjs`, `tools/test-design-library-integration.mjs` — new tests.
* `package.json` — updated `test` script.
* `docs/specifications/RS-1015-DesignLibrary.md` — full specification and audit.
* `npm test` passing in full.
* Real-browser verification (headless Chrome via CDP, isolated temp profile) of every Library
  feature, thumbnails, Dual Workspace, Production Sheet, exports, undo/redo, with screenshots.
* `TASK_RESULT.md` completed.
* One commit on `feature/rs-1015-design-library`, branch pushed (not merged).
