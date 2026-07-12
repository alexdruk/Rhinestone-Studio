# Task

**Task ID:** UI-001
**Task Type:** Feature — Complete Application Redesign
**Specification:** `docs/specifications/UI-001-CompleteRedesign.md`
**Status:** IN PROGRESS
**Branch:** feature/ui-001-complete-redesign

## Goal

Replace the long, poorly organized single sidebar with a modern, minimal, professional desktop
design-tool interface: top application menu, left project/layer panel, large central 2D/3D
workspace, compact contextual right inspector, and focused Lightbox dialogs for full feature
parameters. Deep blue on white/light-neutral, CSS custom-property design tokens. Preserves all
existing behavior, geometry, exports, and project compatibility.

## Required Outcome

See `docs/specifications/UI-001-CompleteRedesign.md` in full, including the feature-to-UI inventory
table proving where every currently-implemented control lives after the redesign. Summary:

* Top menu: Text, Shapes, Import, Image Trace, Export, Production Sheet, Shipping & Handling,
  Settings, Help — each its own Lightbox — plus Undo/Redo/Save/dirty indicator.
* Left panel: Project (name, units, object-template summary), Layers (list/visibility/select/
  duplicate/delete/add-shortcut), Actions (Undo/Redo/Duplicate/Delete/Save). No per-layer-type
  parameter forms.
* Central workspace: 2D/3D tab switch, both canvases unchanged, Align & Snap toolbar (relocated,
  not extended), safe-area toggle (new, app.js-local), dimensions/selection-bounds status strip. No
  grid toggle — dropped (see Rules below); grid remains always-on as before.
* Nine Lightboxes with every currently-implemented parameter for their domain, per the spec's
  per-Lightbox sections.
* Right inspector: compact quick-edit for the selected layer (name/position/size/stone size/gap/
  color), "More Options" opens the matching Lightbox. Shared fields (position/size, stone size/gap/
  color) are one physical relocated DOM node, never a duplicate id.
* One reusable, accessible Lightbox system (`src/ui/Lightbox.js`): title, close, Cancel, Apply,
  Escape, focus trap, validation display, internal scroll only.

## Rules

* Follow `docs/AI_ENGINEER.md`, `docs/CLAUDE_GUIDE.md`, `docs/ARCHITECTURE.md`,
  `docs/MILESTONE_WORKFLOW.md`.
* Repository is the source of truth; preserve all existing user-facing behavior exactly.
* No change to `StoneLayout`/`Stone` schema, export file schemas, Project JSON schema, geometry
  output, Image Trace / SVG parser architecture, or 3D geometry architecture.
* No renderer exception: a real grid toggle was investigated and dropped (would require touching
  `src/renderer/CanvasRenderer2D.js` and amending ~10 unrelated tests' own forbidden-file guards for
  one control that was never toggleable before). The workspace shows a plain "always on" label.
* Forbidden files (business logic untouched): `src/geometry/**`, `src/export/**`, `src/history/**`,
  `src/products/**`, `src/preview3d/**`, `src/svg/**`, `src/image/**`, `src/text/**`, `src/fonts/**`,
  `src/core/**`, `src/browser/**`, `src/editing/**`, `src/renderer/**`, `style.css` (stays
  unlinked/untouched), `README.md`, `LICENSE`, `CONTRIBUTING.md`, `assets/**`, `examples/**`.
* No new shipping/carrier/billing APIs. Shipping & Handling is a local-only, session-scoped
  metadata Lightbox (not saved to project this milestone — documented, not faked).
* Do not extend Alignment & Snapping — relocate its existing UI only.
* Do not commit failing tests.

## Deliverables

* `index.html`, `app.js` — full redesign per the specification.
* `src/ui/Lightbox.js`, `src/ui/index.js` — new dialog-controller module.
* `docs/ARCHITECTURE.md` — new UI-001 implementation-status section + Layer map row.
* Tests: `tools/test-ui001-topmenu.mjs`, `tools/test-ui001-lightboxes.mjs`,
  `tools/test-ui001-leftpanel.mjs`, `tools/test-ui001-dialog-behavior.mjs`,
  narrow documented carve-outs to
  `tools/test-ui-discoverability.mjs`, `tools/test-curved-text-integration.mjs`,
  `tools/test-object-template-integration.mjs`, `tools/test-alignment-snapping-integration.mjs`,
  `tools/test-app-module-migration.mjs`; `package.json` test script updated.
* `npm test` passing in full.
* Real-browser verification at 1280×800 / 1366×768 / 1440×900 / 1920×1080, all nine Lightboxes,
  and the sixteen workflows from the milestone brief, with screenshots.
* `TASK_RESULT.md` completed.
* One commit on `feature/ui-001-complete-redesign`, branch pushed.
