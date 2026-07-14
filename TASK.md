# Task

**Task ID:** S-105
**Task Type:** UI/UX behavior change — Persistent Movable Lightboxes
**Specification:** `docs/specifications/S-105-PersistentMovableLightboxes.md`
**Status:** IMPLEMENTED
**Branch:** feature/s-105-persistent-movable-lightboxes

## Goal

Make every Lightbox (Text, Shapes, Import, Image Trace, Design Library, Export, Production Sheet,
Shipping & Handling, Settings, Help, Gallery) movable by its header, non-blocking of the 2D canvas /
Object Preview / Layers list / Inspector, and persistent until the operator explicitly closes it —
removing the current close-and-reopen-via-"More Options" round trip for reselecting a same-type layer.

## Required Outcome

See `docs/specifications/S-105-PersistentMovableLightboxes.md` in full. Summary:

* Audit-first: confirmed the one shared `src/ui/Lightbox.js` dialog controller wraps a full-viewport
  blocking `.lightbox-overlay` backdrop for every Lightbox except `lightboxShapes` (made non-modal in
  S-101, the only existing precedent); confirmed no drag/move code exists anywhere in the repository;
  confirmed reopening never creates a duplicate (already a no-op via `Lightbox.isOpen`); confirmed the
  `FIELD_GROUPS`/`activeFieldLightbox` shared-DOM relocation mechanism (`app.js:1063-1076`) already
  assumes exactly one of Text/Shapes/Import/Image Trace is "active" at a time, which is the concrete
  architectural reason this milestone keeps one primary Lightbox open at a time rather than allowing
  arbitrary concurrency; confirmed `syncSelectedControlsFromLayer()` already runs on every selection
  change regardless of Lightbox state, so removing the modal block is sufficient to make an open
  Lightbox live-update on same-type reselection with no new sync logic.
* `src/ui/Lightbox.js`: new `options.primary` exclusivity (closes any other open primary Lightbox
  before opening), header-drag-to-move with viewport clamping (on drag, on open, and on window
  resize), position persisted across close/reopen (not reset), `.lightbox.dragging` state class.
* `index.html`: the existing S-101 `.lightbox-overlay.non-modal` modifier applied to all 11 named
  Lightboxes (`aria-modal` flipped to `"false"` on each); new drag-cursor CSS only. The two sub-dialogs
  (`lightboxLibraryConfirm`, `lightboxGalleryPreview`) are untouched — still modal, not primary, per
  the specification's explicit scope boundary.
* `app.js`: the 11 primary `lightboxes` entries gain `primary:true`; no other logic changes.
* `GeometryEngine`, `StoneLayout`, every renderer, every exporter, the project schema, the Design
  Library/Gallery data layers, and Gallery's disabled top-menu button are untouched.

## Rules

* Follow `docs/AI_ENGINEER.md`, `docs/CLAUDE_GUIDE.md`, `docs/ARCHITECTURE.md`,
  `docs/MILESTONE_WORKFLOW.md`.
* Repository is the source of truth; audit before implementing; do not add functionality beyond what
  the specification requires.
* Do not touch `GeometryEngine`, `StoneLayout`, the project schema, exporters, rendering
  (`src/renderer/**`, `src/preview3d/**`), Design Library data layer (`src/library/**`), Gallery data
  layer (`src/gallery/**`), or Gallery's disabled menu state (`#menuGallery` in `index.html`).

## Deliverables

* `src/ui/Lightbox.js`, `index.html`, `app.js` — primary-exclusivity, drag-to-move, non-modal for all
  11 named Lightboxes.
* `tools/test-s105-persistent-movable-lightboxes.mjs` — new test suite.
* `tools/test-ui001-dialog-behavior.mjs`, `tools/test-ui001-lightboxes.mjs`,
  `tools/test-s101-ux-workflow-polish.mjs` — updated for the generalized non-modal/`aria-modal` state.
* `package.json` — new test wired into the `test` script.
* `docs/specifications/S-105-PersistentMovableLightboxes.md` — full specification and audit findings.
* `npm test` passing in full.
* Real-browser verification (headless Chromium via Playwright, isolated local run) of non-modal
  interaction, drag/viewport-clamp behavior, persistence across selection/canvas edits, no-duplicate
  reopening, and primary-Lightbox exclusivity, at 1366×768, 1440×900, and a narrow width, with
  screenshots.
* `TASK_RESULT.md` completed.
* One commit on `feature/s-105-persistent-movable-lightboxes`, branch pushed (not merged).
