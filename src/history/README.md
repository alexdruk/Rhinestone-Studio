# History

`HistoryManager` is a generic undo/redo stack. It has no knowledge of `Project`, `Layer`,
`StoneLayout`, or the DOM — it operates purely on plain, JSON-serializable state handed to it by its
caller (`app.js` passes `{ project, selectedLayerId }`; it never sees generated geometry).

Snapshots are stored as JSON strings, not live object graphs, so a history entry can never be
mutated after the fact by its caller and costs little memory per entry.

## API

- `commit(state)` — one discrete action (add/delete/duplicate/etc.) as a single undo step; clears
  the redo stack (branch-after-undo).
- `beginSession(state)` / `endSession()` — coalesces many rapid calls (one per keystroke or
  slider-drag tick) into a single undo step.
- `undo(currentState)` / `redo(currentState)` — return a fresh clone of the previous/next snapshot,
  or `null` if there is nothing to undo/redo.
- `clear()` — empties both stacks (used on a full project load).
- `canUndo` / `canRedo` — booleans.
- `maxSize` — a required-positive-integer constructor option (default 100) bounding memory; normal
  editing sessions never reach it.

See `docs/specifications/RS-1002-UndoRedo.md` for the full design rationale.
