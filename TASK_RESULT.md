# Rhinestone Studio — Task Result

This document is completed by the implementation engineer after finishing the current task.

---

# Task ID

RS-1002

---

# Status

IMPLEMENTED

---

# Branch

feature/rs-1002-undo-redo

---

# Commit

Do not write the current commit hash into this file — this file is part of the same commit it
describes. Obtain it from Git history with:

```bash
git log -1 --oneline
```

---

# Files Changed

```
src/history/HistoryManager.js           (new — generic, dependency-free undo/redo stack: commit(),
                                          beginSession()/endSession() session coalescing, undo(),
                                          redo(), clear(), canUndo/canRedo, configurable maxSize)
src/history/index.js                    (new — barrel)
src/history/README.md                   (new — module documentation)
app.js                                  (modified — HistoryManager wiring: HISTORY_MAX_SIZE
                                          constant, history/currentSnapshot/commitHistory/
                                          openHistorySession/closeHistorySession/performUndo/
                                          performRedo/applyHistorySnapshot/updateHistoryUI;
                                          commitHistory() at every discrete mutation site
                                          (duplicate/delete/visibility/addCircle/addRect/SVG-import/
                                          drag-start); openHistorySession()/closeHistorySession()
                                          wired to continuous project-affecting controls (text,
                                          font, height, stone size, gap, colors, wrap, text mode,
                                          shape x/y/w/h, svg mode), explicitly excluding
                                          rotation/zoom (view-only); Ctrl/Cmd+Z / +Shift+Z / Ctrl/
                                          Cmd+Y keyboard shortcuts; Project JSON import calls
                                          history.clear() instead of committing; Export Project
                                          JSON updates the dirty baseline; also fixes a real bug in
                                          syncSelectedControlsFromLayer() — see "Design Summary")
index.html                              (modified — #undoBtn/#redoBtn/#dirtyIndicator in the top
                                          toolbar, minimal scoped CSS)
package.json                            (modified — test script runs the two new suites)
tools/test-history-manager.mjs          (new — 8 unit tests for src/history/HistoryManager.js)
tools/test-undo-redo-integration.mjs    (new — 10 structural tests for app.js/index.html wiring)
tools/test-app-module-migration.mjs     (modified — added src/history/index.js to the allowed-
                                          import list)
tools/test-shape-geometry-integration.mjs (modified — added src/history/index.js to its own,
                                          separate allowed-import list)
docs/specifications/RS-1002-UndoRedo.md (new — milestone specification)
docs/ARCHITECTURE.md                    (modified — new "History (Undo/Redo)" principle section,
                                          Layer map/Orchestration rows, Future Direction status,
                                          Testing Philosophy paragraph)
docs/BACKLOG.md                         (modified — Undo/Redo row marked Done (RS-1002))
TASK.md                                 (replaced — RS-1002 task)
TASK_RESULT.md                          (this file)
```

No file under `src/text/**`, `src/fonts/**`, `src/core/**`, `src/browser/**`, `src/renderer/**`,
`src/export/**`, `src/geometry/**`, `src/svg/**`, `src/products/**`, `assets/**`, `examples/**`, or
`style.css` was changed.

---

# Design Summary (read before reviewing the diff)

* **New permanent module `src/history/**`** (peer of `src/svg/**`, `src/core/**`): `HistoryManager`
  is a small, dependency-free, DOM-free undo/redo stack. It only ever operates on
  `JSON.stringify`-able snapshots handed to it by the caller and stores them as JSON strings, not
  live object graphs — this is the enforcement point for "history must never contain generated
  geometry" (it never sees `layout`/`StoneLayout`/`Stone`) and for "minimize memory usage" /
  "do not duplicate StoneLayout." `commit(state)` records one discrete undo step and clears the
  redo stack (branch-after-undo). `beginSession(state)`/`endSession()` coalesce many rapid calls —
  one per keystroke or slider-drag tick — into a single undo step. `maxSize` (constructor option,
  default 100 in `app.js`'s `HISTORY_MAX_SIZE`) bounds memory; undo/redo is otherwise unlimited.
* **`app.js` wiring is a thin orchestration layer**, matching the existing architecture principle
  (permanent modules own logic, `app.js` wires them together). `currentSnapshot()` returns
  `{project: <deep clone>, selectedLayerId}` — never `layout`. `commitHistory()` is called
  immediately before every discrete mutation (add circle/rectangle, SVG import, duplicate, delete,
  visibility toggle, the start of a shape drag on `pointerdown`). Continuous controls (text, font,
  height, auto-fit, text mode, stone size, gap, stone color, cup color, wrap, shape X/Y/W/H, SVG
  fill mode) open a session on their shared `'input'` listener and close it on a new shared
  `'change'` listener — `rotation`/`zoom` are deliberately excluded (they are view state, not part
  of `project`, and not in the required operation list). `applyHistorySnapshot()` restores
  `project`/`selectedLayerId` and calls `updateAll(true)`, which always regenerates `layout` from
  scratch via `engine.generate(project)` — "geometry regenerated after restore" required no new
  geometry code, only correct wiring. Project JSON import calls `history.clear()` instead of
  `commitHistory()` (a fresh project is not an undoable edit); none of the five export handlers
  reference `history` at all, so history survives exports by construction. `Ctrl/Cmd+Z`
  (`+Shift` redoes) and `Ctrl/Cmd+Y` (redo) are wired globally with `preventDefault()`, taking
  precedence over any native browser input-level undo even while a text field has focus.
* **Dirty-state tracking**: a `cleanProjectJson` baseline (a plain `JSON.stringify(project)` string)
  is set at boot, reset on Project JSON import, and reset on successful Export Project JSON.
  `updateHistoryUI()` (called from `updateAll()` and after every undo/redo/commit) compares the
  live project against that baseline to drive the `#dirtyIndicator` ("Saved" / "Unsaved changes").
  Undoing back to the saved state correctly clears the indicator again (verified in the browser).
* **A real, pre-existing bug was found and fixed as directly necessary for this milestone**:
  `syncSelectedControlsFromLayer()` never synced `project.cupColor`/`project.wrap` (project-level,
  not per-layer, fields) back into the `#cupColor`/`#wrap` `<select>` elements. This was latent
  since RS-0003.5D1 (Project JSON import never refreshed these two controls either) but was
  functionally invisible until now because nothing ever restored `project` out from under the DOM.
  Undo/redo does exactly that: without this fix, undoing a wrap/cup-color change would correctly
  revert `project` internally (cup preview would render correctly), but the `#wrap`/`#cupColor`
  dropdowns would stay stale, and the *next* edit's `writeSelectedControlsToLayer()` call would
  silently write the stale (wrong, pre-undo) value from the DOM back into `project` — invisibly
  undoing the undo. Fixed by adding two lines to `syncSelectedControlsFromLayer()` (already called
  by every restore path: undo/redo, Project JSON import, layer selection). Discovered via real
  browser testing of "wrap mode change undoes" / "cup color change undoes" (see below).
* **No schema changes**: `Stone`, `StoneLayout`, Generated Layout JSON, SVG export, and the ad hoc
  Project JSON schema are byte-identical in shape. Undo/redo operates one layer below all of those,
  on `app.js`'s in-memory `project` object only.

---

# Commands Executed

```bash
npm test
git diff --check
git status
npm run dev                                     # python3 -m http.server 5173
# headless Google Chrome (OS-installed binary at
# "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"), isolated ephemeral
# --user-data-dir, --window-size=1600,2600 (so the full sidebar is on-screen without needing
# scroll-aware click coordinates), no browser-automation dependency added, driven over raw CDP via
# Node 22's built-in fetch + WebSocket (matching the RS-0003.5B2-RS-1001 precedent) — a
# from-scratch driver script in the session scratchpad (cdp.mjs + verify.mjs)
```

---

# Test Results

## Automated Tests

PASS (20 suites, 219 assertions total, including 2 new suites):

```
node tools/test-core-model.mjs && node tools/test-font-manager.mjs && node tools/test-vector-path.mjs
  && node tools/test-font-provider-registry.mjs && node tools/test-opentype-provider.mjs
  && node tools/test-default-font-provider-registry.mjs && node tools/test-svg-parser.mjs
  && node tools/test-geometry-engine.mjs && node tools/test-stone-color.mjs
  && node tools/test-history-manager.mjs && node tools/test-app-module-migration.mjs
  && node tools/test-browser-dependency-loading.mjs && node tools/test-live-text-integration.mjs
  && node tools/test-shape-geometry-integration.mjs && node tools/test-svg-integration.mjs
  && node tools/test-undo-redo-integration.mjs && node tools/test-render-export-pipeline.mjs
  && node tools/test-production-export-validation.mjs && node tools/test-ux-visual-polish.mjs
  && node tools/test-examples-regression.mjs
```

New `tools/test-history-manager.mjs` (8 tests, `src/history/HistoryManager.js` in isolation, no
DOM/app.js): sequential undo/redo replays states in the correct order; branch after undo truly
discards (not just hides) the redo stack; a `maxSize:3` history evicts the oldest entries so only
the 3 most recent are undoable; `beginSession()`/`endSession()` coalesce multiple rapid calls into
exactly one committed entry, and a new session after `endSession()` commits a separate entry;
`clear()` empties both stacks and closes an open session; snapshots are isolated from later
mutation of the caller's object in both directions (commit-time and return-value mutation);
`undo()`/`redo()` on an empty history return `null` without throwing; the constructor validates
`maxSize` (throws on zero/negative/non-integer/non-numeric).

New `tools/test-undo-redo-integration.mjs` (10 tests, structural, mirroring
`tools/test-svg-integration.mjs`'s convention since `app.js` is a browser entry point not
`import()`-able under plain Node): `HistoryManager` is imported and constructed with a named
`HISTORY_MAX_SIZE`; `currentSnapshot()`/`commitHistory()`/`openHistorySession()`/
`closeHistorySession()`/`performUndo()`/`performRedo()`/`applyHistorySnapshot()`/`updateHistoryUI()`
are all defined, and `currentSnapshot()`'s body never references `layout`; every discrete mutation
site (`duplicateLayer`, `deleteLayer`, visibility toggle, `addCircle`, `addRect`, the
`#importSvgFile` handler, the `pointerdown` drag-start handler) calls `commitHistory()` textually
before its first mutation; the tracked-control-id list includes every continuous project field and
explicitly excludes `rotation`/`zoom`; `#importProjectFile` calls `history.clear()` (not
`commitHistory()`) and resets the dirty baseline; none of the five export handlers reference
`history` in any way; `applyHistorySnapshot()` calls `updateAll(true)` and `updateAll()` calls
`updateHistoryUI()`; the `keydown` listener handles Ctrl/Cmd+Z/+Shift+Z/Ctrl/Cmd+Y with
`preventDefault()`; `index.html` exposes `#undoBtn`/`#redoBtn`/`#dirtyIndicator` wired correctly; no
forbidden file changed.

Updated `tools/test-app-module-migration.mjs` and `tools/test-shape-geometry-integration.mjs`: each
has its own independent "app.js only imports allowed modules" guard (a duplicated pattern from
RS-1001, not something this milestone introduced) — both needed the same one-line addition for
`./src/history/index.js`. Both were updated; no other guard test required any change.

`git diff --check` reported no whitespace errors. No `build` script exists in `package.json`, so
`npm run build` was not run (unchanged from prior milestones).

## Browser Verification

Ran `npm run dev` and drove `http://localhost:5173/` with a from-scratch, dependency-free CDP driver
(headless Chrome, Node 22's built-in `fetch`/`WebSocket`, real `Input.dispatchMouseEvent`/
`Input.dispatchKeyEvent` — genuine OS-level-equivalent input, not JS `dispatchEvent()` synthetic
events). 57 real interactive checks, **57 passed, 0 failed**, 0 console errors, 0 uncaught page
errors throughout the entire run:

* Page load: title correct, no console errors, Undo/Redo buttons render disabled, dirty indicator
  shows "Saved".
* **Text edit**: typed a full replacement string character-by-character (real per-keystroke `input`
  events), confirmed the field reflects it, confirmed one Undo click restores the *original* text in
  a single step (proving session coalescing — many keystrokes, one undo step), confirmed Redo brings
  the edit back.
* **Keyboard shortcuts**: `Ctrl+Z` undid a completed text edit *while the text field still had
  focus* (proving the app's history takes precedence over any native input-level undo);
  `Ctrl+Shift+Z` and `Ctrl+Y` both redid correctly.
* **Font, stone size, gap, stone color, wrap mode, text mode, cup color**: each changed via a real
  `<select>`/`<input>` interaction, each undoes and redoes correctly, verified by reading the actual
  control's value after each step.
* **Add circle / add rectangle**: each adds a layer (verified via `#layersList` child count), Undo
  removes it, Redo re-adds it.
* **Duplicate layer**: real click on the layer row's duplicate button adds a copy; Undo removes it,
  Redo restores it.
* **Visibility toggle**: real click on the layer's visibility checkbox toggles it; Undo/Redo
  restore/reapply correctly.
* **Delete layer**: real click on Delete; Undo restores the deleted layer, Redo re-deletes it.
* **Move**: a real mouse drag (`Input.dispatchMouseEvent` press/move/release) on the circle layer's
  body in the 2D layout canvas moved it (`#shapeX` changed from 105 to ~130.8mm); Undo restored the
  exact pre-drag position; Redo re-applied the move.
* **Resize**: the mm-per-pixel scale was calibrated empirically from the verified move above (no
  app.js instrumentation added), used to compute the on-screen position of the circle's east resize
  handle, then a real mouse drag on that handle resized it (`#shapeW`/radius changed from 18mm to
  ~30.9mm); Undo restored the exact pre-resize size; Redo re-applied the resize.
* **SVG import**: imported a real synthetic `<svg>` file via the file input (`DataTransfer`/`File`,
  dispatching a real `change` event); confirmed a new layer was added and the import succeeded
  (`"Imported test.svg: 1 shape(s)"`); Undo removed the SVG layer, Redo restored it.
* **Branch after undo**: undid twice, made a brand-new edit (gap change), confirmed Redo became
  disabled (the old redo branch was truly discarded, matching the `HistoryManager` unit test).
* **History limit, precisely**: from a freshly-cleared history (right after a Project JSON import),
  committed exactly 105 single-field edits (`HISTORY_MAX_SIZE` in `app.js` is 100), then clicked
  Undo repeatedly until it disabled itself: **exactly 100 clicks**, confirming the oldest 5 commits
  were evicted and the app remained fully responsive throughout (no crash, no console error).
* **Exports + history survives**: clicked all five export buttons (Project JSON, Generated Layout
  JSON, 2D SVG, 2D PNG, Cup PNG) in sequence — all completed without error (`#status` showed
  "Downloaded rhinestone-layout.svg" etc.) — and confirmed Undo's enabled/disabled state was
  identical before and after (history untouched by exports).
* **Dirty-state tracking**: showed "Saved" at boot and immediately after Export Project JSON;
  flipped to "Unsaved changes" after a further edit; correctly returned to "Saved" after undoing
  back to the exported state (not just after any undo — the *saved* state specifically).
* **Project JSON import clears history**: imported a synthetic project file; confirmed the new
  project's text loaded, confirmed Undo *was* enabled beforehand and both Undo and Redo were
  disabled immediately after the import, and confirmed the dirty indicator showed "Saved".
* No uncaught exception / unhandled rejection was observed at any point across the entire 57-check
  run (`pageErrors.length === 0` checked repeatedly throughout).

Not separately re-verified in the browser (already covered by automated tests / by the mechanism
being identical across operations): the exact `HistoryManager` eviction unit-test assertions (numeric
step-for-step correctness — covered by `tools/test-history-manager.mjs`); `StoneLayout` determinism
after restore (already guaranteed by `GeometryEngine`'s existing determinism tests plus the fact that
`updateAll()` is the same regeneration path used for every live edit, restored or not — no new
geometry code was written for this milestone to separately re-verify).

---

# Warnings

* None from `npm test` / `git diff --check`.
* The CDP driver script used for browser verification lives only in the session scratchpad
  (`/private/tmp/.../scratchpad/cdp.mjs`, `verify.mjs`) and was not committed — it is a one-off
  verification tool, not a product artifact, matching the RS-1001 precedent (its driver was also not
  committed).

---

# Known Limitations

* History is in-memory only; it does not survive a page reload/navigation (out of scope per the
  specification — no `localStorage` backing was requested or added).
* There is no explicit "New Project" toolbar action in the live UI today, so "history cleared on new
  project" is satisfied by (a) history starting empty at app boot and (b) Project JSON import
  explicitly clearing it — the two project-reset affordances that actually exist.
* `rotation` (cup rotation) and `zoom` (cup preview zoom) are intentionally not undoable — they are
  view-only state, not part of `project`, and are not in the milestone's required operation list.
* Per-layer rotation, curved text, and migrating `app.js`'s ad hoc project/layer model onto
  `src/core/Project`/`Layer` remain out of scope, as before.

---

# Next Milestone

Candidates: curved text, multi-object support/grouping, an optional "lock aspect ratio" toggle for
SVG/rectangle layers, per-layer rotation, and migrating `app.js`'s ad hoc project/layer objects onto
`src/core/Project`/`Layer`.
