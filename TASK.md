# Task

**Task ID:** S-003
**Task Type:** Stabilization / Bug Fix
**Specification:** none (milestone brief supplied directly; scoped enough not to require a separate
`docs/specifications/` doc per `docs/MILESTONE_WORKFLOW.md`'s "ordinary implementation milestone"
path)
**Status:** IMPLEMENTED
**Branch:** fix/s-003-default-text-layer-editing

## Goal

Fix the reported blocking defect: "the default 'Vitalina Serbin' text layer cannot be edited or
deleted through the normal UI."

## Investigation (done before any code change)

A real headless-Chrome session (Puppeteer against `python3 -m http.server`) against the unmodified
repository showed that select / edit (text, font, textMode, curve fields) / duplicate / hide-show /
undo / redo all already worked correctly for the default layer — no crash, no stale state, layer
list and controls stayed synchronized. The one genuinely broken path was deletion: `deleteLayer()`'s
existing "never drop below one layer" guard only ever surfaced feedback via `#status.textContent`,
an element at the very bottom of the `.side` panel (1648px of content against a 726–800px
viewport in this session — the same panel `tools/test-ui-discoverability.mjs` already documented as
overflowing). Since a brand-new project always starts with exactly one layer (the default text
layer), clicking "Delete selected layer" — the single most obvious affordance for removing it —
produced zero visible effect anywhere on screen. That silent failure is what the report described as
"cannot be deleted."

## Required Outcome

* The default text layer can be selected. (already true — confirmed, unchanged)
* Its text and all text properties can be edited. (already true — confirmed, unchanged)
* It can be deleted (once at least one other layer exists). (already true — confirmed, unchanged)
* Duplicate, hide/show, undo, redo work. (already true — confirmed, unchanged)
* Deleting the last remaining layer must not crash the app. (already true — confirmed, unchanged)
* The "at least one layer" rule is enforced **visibly and consistently**: both delete affordances
  (row trash icon, sidebar "Delete selected layer" button) are disabled with an explanatory title,
  and an always-in-viewport `#layerRuleHint` note appears, the moment only one layer remains.
* The layer list and selected-layer controls stay synchronized after every action.
* Project save/load preserves the corrected behavior.
* `GeometryEngine`, `StoneLayout`, and export schemas are unchanged.

## Rules

* Follow `docs/AI_ENGINEER.md` and `docs/CLAUDE_GUIDE.md`.
* Smallest coherent change; no unrelated refactoring.
* Do not touch any other guard test's forbidden-file list.
* Do not commit failing tests.

## Deliverables

* Implementation (`app.js`, `index.html`).
* Automated test (`tools/test-default-text-layer-editing.mjs`), registered in `package.json`.
* `npm test` passing in full.
* Browser verification via a real headless-Chrome session, before and after the fix.
* `TASK_RESULT.md` completed.
* One commit on `fix/s-003-default-text-layer-editing`.
