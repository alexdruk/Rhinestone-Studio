# RS-1002 — Undo / Redo

## Objective

Give the live editor unlimited (configurably bounded) undo/redo over every user-visible editing
operation, with keyboard shortcuts, toolbar buttons, and dirty-state tracking, without ever storing
generated geometry (`StoneLayout`) in history and without changing any export or geometry schema.

## Current Repository State

* `app.js` owns a single mutable `project` object (ad hoc, not `src/core/Project`) plus a handful of
  app-level view variables (`selectedLayerId`, `layout`, `rotation`, `zoom`, `layoutTransform`,
  `drag`, `generationToken`). Every editing action — typing text, dragging a shape, changing a
  dropdown, importing a layer — mutates `project` directly and then calls `updateAll()`, which
  regenerates the whole `StoneLayout` from scratch via `engine.generate(project)`. Nothing in
  `app.js` mutates a `Stone`/`StoneLayout` in place (`docs/ARCHITECTURE.md`, "User Interface"
  section) — this milestone's history mechanism can rely on that invariant instead of re-deriving
  it.
* There is no undo/redo today. `docs/ARCHITECTURE.md`'s "Future Direction" section lists
  "Undo/Redo — not started"; `docs/BACKLOG.md` lists it P1/Planned.
* `rotation` (cup rotation, degrees) and `zoom` (cup preview zoom) are view-only state, not part of
  `project` — they are not persisted in Project JSON export and are not in this milestone's list of
  undoable operations.
* `project` is already proven JSON-serializable: `#exportProject` does
  `JSON.stringify(project,null,2)` directly, and several call sites already deep-clone layers via
  `JSON.parse(JSON.stringify(l))` (`duplicateLayer`, drag-start `l0` snapshot). This milestone reuses
  that same serialization for history snapshots — no new serialization format.
* No generic undo/redo/command-history module exists anywhere in `src/**`.

## Expected Visible Change

* Two new toolbar buttons, "Undo" and "Redo", in the top bar, disabled when there is nothing to
  undo/redo respectively.
* A small "Saved" / "Unsaved changes" indicator next to them, reflecting whether `project` has
  changed since it was last loaded, imported, or exported as Project JSON.
* `Ctrl/Cmd+Z` undoes the last edit; `Ctrl/Cmd+Shift+Z` and `Ctrl/Cmd+Y` redo it. These shortcuts
  work globally, including while a text/number field has focus (the app's own history takes
  precedence over any native browser input-level undo).
* Undo/redo restores the exact prior project state (including which layer was selected) and
  regenerates the 2D layout and cup preview from it, exactly as if the user had made that edit
  themselves.
* Importing a Project JSON file clears all undo/redo history (a freshly loaded project starts with
  no history, matching app boot). Importing an SVG file as a new layer into the *current* project,
  by contrast, is itself a single undoable step.
* None of the five export actions (Project JSON / Generated Layout JSON / 2D SVG / 2D PNG / Cup PNG)
  touch history in any way.

## Required Outcome

* **New permanent module `src/history/HistoryManager.js`** (peer of `src/svg/**`, `src/core/**`):
  a small, dependency-free, framework-agnostic undo/redo stack operating purely on
  `JSON.stringify`-able snapshots, with no knowledge of `Project`/`Layer`/`StoneLayout` or the DOM.
  * `commit(state)` — serializes `state` and pushes it onto the past stack as the new "step before
    the change about to happen"; clears the redo (future) stack (branch-after-undo semantics).
  * `beginSession(state)` / `endSession()` — a "session" coalesces many rapid calls (one per
    keystroke or slider-drag tick) into a single undo step: `beginSession()` behaves like `commit()`
    but is a no-op if a session is already open; `endSession()` closes it so the next
    `beginSession()` starts a new step. This is what makes continuous edits (typing, dragging) count
    as one undo step instead of one per input event, matching ordinary editor UX.
  * `undo(currentState)` / `redo(currentState)` — return a freshly parsed clone of the
    previous/next snapshot, or `null` if there is nothing to undo/redo; push `currentState` onto the
    opposite stack (bounded by `maxSize`, evicting the oldest entry first). Both close any open
    session.
  * `clear()` — empties both stacks and closes any open session (used on Project JSON import).
  * `canUndo` / `canRedo` getters; `maxSize` is a required-by-construction, configurable positive
    integer (default 100) — this is what "unlimited undo/redo, limited only by configurable history
    size" means in practice: normal editing sessions never hit the limit, but memory use is bounded.
  * Snapshots are stored as JSON strings, not live object graphs — this both trivially guarantees
    isolation (mutating the caller's object after `commit()`/after receiving an `undo()`/`redo()`
    result never corrupts history) and minimizes per-entry memory overhead versus keeping deep-cloned
    object graphs alive.
  * `HistoryManager` never sees a `StoneLayout`/`Stone` — the only thing ever passed to it from
    `app.js` is `{ project, selectedLayerId }`. This is the enforcement point for "history must never
    contain generated geometry."
* **`app.js` wiring** (thin orchestration only, matching the existing architecture principle that
  `app.js` wires permanent modules together and does not reimplement their logic):
  * `const history = new HistoryManager({ maxSize: HISTORY_MAX_SIZE })` (`HISTORY_MAX_SIZE` a named
    constant, default 100, following the existing `CUP_ROTATION_SENSITIVITY`/`ZOOM_MIN`/`ZOOM_MAX`
    named-constant convention from RS-0003.5D2).
  * `currentSnapshot()` returns `{ project: <deep clone>, selectedLayerId }`.
  * `commitHistory()` — calls `history.commit(currentSnapshot())` for every **discrete** editing
    action, called immediately before the mutation: add circle, add rectangle, import SVG layer,
    duplicate layer, delete layer, toggle layer visibility, and the start of a shape move/resize drag
    (on `pointerdown`, before entering drag mode).
  * `openHistorySession()` / `closeHistorySession()` — thin wrappers around
    `history.beginSession(currentSnapshot())` / `history.endSession()`, used for every **continuous**
    project-affecting control (text, font, height, auto-fit, text mode, stone size, gap, stone color,
    cup color, wrap, shape X/Y/W/H, SVG fill mode): the shared `'input'` listener calls
    `openHistorySession()` before `updateAll()`, and a new shared `'change'` listener calls
    `closeHistorySession()`. `rotation` and `zoom` keep their existing plain `'input'` listener,
    untouched — they are view state, not project data, and are correctly excluded from history.
  * `performUndo()` / `performRedo()` — close any open session, call `history.undo()`/`redo()` with
    the current snapshot, restore `project`/`selectedLayerId` from the result via
    `applyHistorySnapshot()`, and update `#status`.
  * `applyHistorySnapshot(snap)` — assigns `project`/`selectedLayerId` from the restored snapshot,
    calls `syncSelectedControlsFromLayer()`, then `updateAll(true)`. `updateAll()` always regenerates
    `layout` from scratch via `engine.generate(project)` — this is "geometry regenerated after
    restore" and requires no new code, only correct wiring.
  * `updateHistoryUI()` — refreshes `#undoBtn`/`#redoBtn` `disabled` state from
    `history.canUndo`/`canRedo`, and refreshes `#dirtyIndicator` by comparing
    `JSON.stringify(project)` against `cleanProjectJson` (a baseline updated on app boot, Project JSON
    import, and successful Project JSON export). Called from `updateAll()` and after every
    undo/redo/commit.
  * The `#importProjectFile` change handler calls `history.clear()` (not `commitHistory()`) and
    resets `cleanProjectJson` after successfully replacing `project` — a full project load is not an
    undoable edit, matching "history cleared on project load."
  * The `#importSvgFile` change handler calls `commitHistory()` immediately before
    `project.layers.push(layer)` — adding an SVG layer to the *current* project is an ordinary,
    undoable layer-add, exactly like `addCircle`/`addRect`.
  * `window.addEventListener('keydown', ...)` gains `Ctrl/Cmd+Z` (undo; `+Shift` redoes),
    `Ctrl/Cmd+Y` (redo), both calling `event.preventDefault()` so the shortcut is not swallowed by a
    focused input's native undo. The existing Delete/Backspace-deletes-selected-layer behavior is
    unchanged.
  * None of the five export button handlers reference `history` at all (survives exports by
    construction, not by a special case).

## Architecture Requirements

* `src/history/**` has zero dependency on the DOM, `Project`/`Layer`, `StoneLayout`, or any other
  `src/**` module — pure JSON-snapshot bookkeeping, mirroring how `src/svg/**` has zero dependency on
  the DOM/renderer/exporter.
* `app.js` is the only caller of `HistoryManager`; it is consumed exclusively through
  `src/history/index.js`, matching the existing barrel-only import rule for every other permanent
  module.
* History snapshots are `{ project, selectedLayerId }` only — never `layout`/`StoneLayout`/`Stone`.
  `StoneLayout` itself is never duplicated for history purposes; it is always regenerated fresh from
  the restored `project` by the existing `updateAll()` path, exactly like a live edit.
* No change to `Stone`, `StoneLayout`, `StoneLayout.toJSON()` (Generated Layout JSON), SVG export, or
  the ad hoc Project JSON schema. Undo/redo operates one layer below all of those, on `app.js`'s
  in-memory `project` object only.
* `GeometryEngine`/`StoneSampler`/`ContourGeometry`/`Stone`/`StoneLayout` determinism is untouched —
  restoring an identical `project` snapshot must regenerate a `deepEqual` `StoneLayout`, since
  `generate()` is a pure function of `project`.

## Allowed Files

* `src/history/**` (new: `HistoryManager.js`, `index.js`, `README.md`)
* `app.js`, `index.html`
* `tools/**` (new tests; a narrow update to `tools/test-app-module-migration.mjs`'s allowed-import
  list)
* `package.json` (wire new test files into the `test` script)
* `docs/specifications/**`, `docs/ARCHITECTURE.md`, `docs/BACKLOG.md`
* `TASK.md`, `TASK_RESULT.md`

## Forbidden Files

* `src/text/**`, `src/fonts/**`, `src/core/**`, `src/browser/**`, `src/renderer/**`, `src/export/**`,
  `src/geometry/**`, `src/svg/**`, `src/products/**`
* `assets/**`, `examples/**`
* `style.css`, `README.md`, `LICENSE`, `CONTRIBUTING.md`
* `node_modules/**`

## Out of Scope

* Persisting history across a page reload (history is in-memory only, cleared on navigation —
  no `localStorage`/`sessionStorage` backing).
* Undoing view-only state (cup rotation, zoom) — these are not project data and are not in the
  required operation list.
* A "New Project" toolbar action — none exists in the live UI today; app boot already starts with
  empty history, which satisfies "history cleared on new project" for the affordance that actually
  exists (Project JSON import).
* Per-field granular diffing/patching (e.g., storing only a changed property instead of the whole
  project). The whole-project JSON snapshot is simple, correct, and small (`project` is a handful of
  KB even with many layers); a diff/patch format is unnecessary complexity for this data size and
  would risk drift from `validateProject()`'s schema.
* Migrating `app.js`'s ad hoc project/layer model onto `src/core/Project`/`Layer`.

## Required Automated Tests

New `tools/test-history-manager.mjs` (unit tests against `src/history/HistoryManager.js` directly,
no browser, no `app.js`):

1. Sequential undo/redo: three commits produce three undoable steps; undoing three times returns to
   the original state in reverse order; redoing three times replays them forward in order.
2. Branch after undo: undo once, then `commit()` a new state — `canRedo` becomes `false` and
   `redo()` returns `null` (the discarded future is truly discarded, not just hidden).
3. History limit: `maxSize: 3`, five commits — only the three most recent are undoable; undoing past
   the limit returns `null` without throwing.
4. `beginSession()`/`endSession()` coalescing: multiple `beginSession()` calls without an
   intervening `endSession()` push exactly one history entry; `endSession()` then a new
   `beginSession()` pushes a second, separate entry.
5. `clear()` empties both stacks and closes an open session; `canUndo`/`canRedo` are both `false`
   afterward.
6. Snapshot isolation: mutating the object passed to `commit()` after the call does not change what
   `undo()` later returns; mutating an object returned by `undo()`/`redo()` does not corrupt
   `HistoryManager`'s internal state on a subsequent call.
7. `undo()`/`redo()` on empty stacks return `null` without throwing.
8. Constructor validates `maxSize` (throws on zero/negative/non-integer/non-numeric).

New `tools/test-undo-redo-integration.mjs` (structural, mirroring the existing convention in
`tools/test-svg-integration.mjs`/`tools/test-shape-geometry-integration.mjs`, since `app.js` is a
browser entry point and not `import()`-able directly under plain Node):

1. `app.js` imports `HistoryManager` from `./src/history/index.js` and constructs it with a named,
   configurable `HISTORY_MAX_SIZE` constant.
2. `commitHistory()`/`openHistorySession()`/`closeHistorySession()`/`performUndo()`/`performRedo()`/
   `applyHistorySnapshot()`/`currentSnapshot()` are all defined, and `currentSnapshot()`'s body never
   references `layout` (history never touches generated geometry).
3. Every discrete mutation site — `duplicateLayer()`, `deleteLayer()`, the layer-visibility toggle,
   `addCircle`, `addRect`, the `#importSvgFile` handler, and the `pointerdown` drag-start handler —
   calls `commitHistory()` textually before its first project mutation (regex-verified ordering
   within each function/handler body).
4. The continuous-control `'input'`/`'change'` wiring calls `openHistorySession()`/
   `closeHistorySession()` for the project-affecting control id list, and explicitly excludes
   `rotation`/`zoom` from that list (they keep their own unwired `'input'`-only listener).
5. The `#importProjectFile` handler calls `history.clear()` (and resets the dirty baseline) instead
   of `commitHistory()`.
6. None of the five export button handlers (`#exportProject`, `#exportLayout`, `#exportSVG`,
   `#exportPNG`, `#exportCup`) reference `history` in any way (history survives exports).
7. `applyHistorySnapshot()` calls `updateAll(true)` (geometry regenerated after restore) and
   `updateAll()` itself calls `updateHistoryUI()`.
8. The `keydown` listener handles `Ctrl/Cmd+Z` (`performUndo`, or `performRedo` with `Shift`) and
   `Ctrl/Cmd+Y` (`performRedo`), each calling `event.preventDefault()`.
9. `index.html` exposes `#undoBtn`, `#redoBtn`, and `#dirtyIndicator`, wired in `app.js` to
   `performUndo`/`performRedo` and refreshed by `updateHistoryUI()`.
10. No forbidden file changed (this milestone's own forbidden list).

Update `tools/test-app-module-migration.mjs` and `tools/test-shape-geometry-integration.mjs`: add
`from\s*['"]\.\/src\/history\/index\.js['"]` to each file's allowed-import-pattern list (same pattern
as the RS-1001 addition of `src/svg/index.js` to both of these same two guard tests).

Run the full suite (`npm test`) and confirm every existing suite still passes with only those two
guard-list additions changed.

## Required Browser Verification

Run `npm run dev` and drive `http://localhost:5173/` (from-scratch CDP driver over headless Chrome,
matching the RS-0003.5B2–RS-1001 precedent — no new browser-automation dependency):

* [ ] Page loads, no console errors on load; Undo/Redo buttons render disabled.
* [ ] Text edit: change the text field, click elsewhere (blur), click Undo — original text is
      restored and stones regenerate; Redo brings the edited text back.
* [ ] Font change: switch font, Undo restores the previous font's stones.
* [ ] Stone size change: Undo restores previous stone size and stone count.
* [ ] Gap change: Undo restores previous gap.
* [ ] Color change: Undo restores previous stone color.
* [ ] Wrap mode change: Undo restores previous wrap mode (verify in cup preview).
* [ ] Text mode change (stroke/fill): Undo restores previous mode's stone pattern.
* [ ] SVG import: import an SVG layer, Undo removes it, Redo restores it with its stones intact.
* [ ] Add layer (circle and rectangle): Undo removes the newly added layer.
* [ ] Delete layer: Undo restores the deleted layer with its original stones.
* [ ] Duplicate layer: Undo removes the duplicate.
* [ ] Visibility toggle: Undo restores previous visibility state.
* [ ] Move (drag a shape): Undo restores the pre-drag position.
* [ ] Resize (drag a handle): Undo restores the pre-resize size.
* [ ] Cup color change: Undo restores the previous cup color.
* [ ] Keyboard shortcuts: `Ctrl/Cmd+Z` undoes, `Ctrl/Cmd+Shift+Z` redoes, `Ctrl/Cmd+Y` redoes; verify
      `Ctrl/Cmd+Z` works even while a text field has focus.
* [ ] Undo/Redo toolbar buttons perform the same actions as the shortcuts and correctly disable when
      there is nothing left to undo/redo.
* [ ] Branch after undo: undo twice, make a new edit, confirm Redo is disabled (old redo branch
      discarded).
* [ ] History limit: perform more edits than `HISTORY_MAX_SIZE` and confirm the oldest are no longer
      undoable (no crash, Undo simply becomes unavailable once exhausted).
* [ ] Dirty indicator: shows "Unsaved changes" after an edit, "Saved" after Export Project JSON, and
      reacts correctly to Undo (returning to a saved state clears it; a further edit sets it again).
* [ ] Import Project JSON clears Undo/Redo (both buttons disabled immediately after a successful
      import).
* [ ] Export Project JSON/Generated Layout JSON/2D SVG/2D PNG/Cup PNG all still succeed after
      performing several undo/redo cycles, and Undo/Redo remain available afterward (history survives
      exports).
* [ ] No uncaught exception / unhandled rejection during any of the above.

Record actual observed behavior in `TASK_RESULT.md`. Do not claim unperformed interactive checks as
passing.

## Acceptance Criteria

* `npm test` passes, including the two new suites.
* Every operation in the required list (text edits, font, stone size, gap, colors, wrap, text mode,
  SVG import, add/delete layer, duplicate, visibility, move, resize, cup color) is undoable and
  redoable in the browser.
* `Ctrl/Cmd+Z`, `Ctrl/Cmd+Shift+Z`, `Ctrl/Cmd+Y`, and the Undo/Redo buttons all work.
* History is bounded only by a configurable size, branches correctly after undo, is cleared on
  Project JSON import, and survives all five export actions.
* History never contains `StoneLayout`/`Stone` data; `StoneLayout` is always regenerated from the
  restored `project`, never duplicated for history purposes.
* No forbidden file changed; no export or geometry schema changed.

## Implementation Constraints

* Smallest coherent change: one new peer module (`src/history/**`) plus thin `app.js` wiring; no
  change to `GeometryEngine`, `StoneSampler`, `ContourGeometry`, `Stone`, `StoneLayout`,
  `CanvasRenderer2D`, `CupRenderer`, or `SvgExporter`.
* No bundler, framework, or new dependency.
* Preserve determinism: identical restored `project` always regenerates a `deepEqual` `StoneLayout`.
* Do not duplicate `StoneLayout` for history; do not store generated geometry in history under any
  circumstance.

## Required Commands

```bash
npm test
git diff --check
git status
npm run dev
```

## Commit Message

```
feat(history): add unlimited, configurable undo/redo over all editing operations
```

## Deliverables

* New `src/history/**` (`HistoryManager.js`, `index.js`, `README.md`).
* Updated `app.js` (history wiring, keyboard shortcuts, undo/redo buttons, dirty tracking),
  `index.html` (undo/redo buttons, dirty indicator, minimal styling).
* `tools/test-history-manager.mjs`, `tools/test-undo-redo-integration.mjs` (new); narrow update to
  `tools/test-app-module-migration.mjs`; `package.json` test script.
* This specification, `TASK.md`, `TASK_RESULT.md`, `docs/ARCHITECTURE.md`, `docs/BACKLOG.md` updates.

## Next Milestone

Candidates: curved text, multi-object support/grouping, an optional "lock aspect ratio" toggle for
SVG/rectangle layers, per-layer rotation, and migrating `app.js`'s ad hoc project/layer objects onto
`src/core/Project`/`Layer`.
