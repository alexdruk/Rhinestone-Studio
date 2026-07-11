# Task

**Task ID:** RS-1002
**Task Type:** Implementation
**Specification:** `docs/specifications/RS-1002-UndoRedo.md`
**Status:** READY FOR IMPLEMENTATION
**Branch:** feature/rs-1002-undo-redo

## Goal

Implement RS-1002 exactly as written in `docs/specifications/RS-1002-UndoRedo.md`. That
specification is the source of truth for allowed/forbidden files, required implementation steps,
required automated tests, required browser verification, acceptance criteria, commit message, and
deliverables.

## Required Outcome

* Unlimited undo/redo (limited only by a configurable `HistoryManager` `maxSize`) over every
  user-visible editing operation: text edits, font changes, stone size, gap, colors, wrap, text
  mode, SVG import, add/delete layer, duplicate, visibility, move, resize, cup color.
* `Ctrl/Cmd+Z`, `Ctrl/Cmd+Shift+Z`, `Ctrl/Cmd+Y` keyboard shortcuts, and Undo/Redo toolbar buttons.
* Dirty-state tracking (Saved / Unsaved changes indicator).
* History cleared on Project JSON import (project load); survives all five export actions.
* Geometry (`StoneLayout`) always regenerated fresh from the restored project after undo/redo, never
  stored in or duplicated by history.
* `StoneLayout` generation remains deterministic; no export or geometry schema changes.
* New `src/history/**` module (`HistoryManager`) is dependency-free, DOM-free, and consumed only
  through its `index.js` barrel from `app.js`.
* Add automated tests (`HistoryManager` unit tests, `app.js` structural integration tests covering
  every commit site, session coalescing, import/export interactions, keyboard shortcuts) and perform
  real browser verification via `npm run dev` + headless Chrome over CDP, covering every operation in
  the required list plus branch-after-undo, history-limit, and dirty-indicator behavior.
* Update `docs/specifications/RS-1002-UndoRedo.md` (already drafted), `docs/ARCHITECTURE.md`,
  `docs/BACKLOG.md`, `TASK.md`, `TASK_RESULT.md`.
* Commit and push a new feature branch `feature/rs-1002-undo-redo`. Do not push to `main` or
  `develop`.

## Rules

* Follow `docs/AI_ENGINEER.md` and `docs/CLAUDE_GUIDE.md`.
* Do not modify `node_modules/**`.
* Do not modify `src/text/**`, `src/fonts/**`, `src/core/**`, `src/browser/**`, `src/renderer/**`,
  `src/export/**`, `src/geometry/**`, `src/svg/**`, `src/products/**`, `assets/**`, `examples/**`,
  `style.css`.
* Follow the exact "Allowed Files" / "Forbidden Files" lists in
  `docs/specifications/RS-1002-UndoRedo.md`.
* History snapshots are `{ project, selectedLayerId }` only, always JSON-serialized — never
  `layout`/`StoneLayout`/`Stone`. Do not duplicate `StoneLayout` for history purposes.
* Update the two existing guard tests enumerated in the specification
  (`test-app-module-migration.mjs` and `test-shape-geometry-integration.mjs` allowed-import lists) —
  no unrelated change to any other guard test.
* If a genuine defect is found outside this milestone's scope, document it in `TASK_RESULT.md`
  rather than fixing it, unless it is small and directly necessary.
* If any required change falls outside the specification's "Allowed Files" list, stop and explain
  before proceeding.
* Do not commit failing tests.
