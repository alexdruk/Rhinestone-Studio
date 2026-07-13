# Task

**Task ID:** RS-2001
**Task Type:** Feature — Gallery & Acceptance Suite
**Specification:** `docs/specifications/RS-2001-GalleryAcceptanceSuite.md`
**Status:** IMPLEMENTED
**Branch:** feature/rs-2001-gallery-acceptance-suite

## Goal

Add a built-in, read-only Gallery of example rhinestone designs — browsable, searchable,
filterable, previewable, and openable as an editable copy (optionally saved to the Design Library)
— that also converts the existing 24 `examples/*.rhs` fixtures (plus 3 new customer-scenario
fixtures) into a formal, permanent acceptance-test and performance-benchmark surface, per
`docs/specifications/RS-2000A-PostMVPAudit.md` Part 7.

## Required Outcome

See `docs/specifications/RS-2001-GalleryAcceptanceSuite.md` in full. Summary:

* Audit-first: three parallel project schemas already exist in this repo (live `app.js` schema,
  unused `src/core/Project`, and the `.rhs` fixture schema bridged only by
  `tools/lib/rhsProject.mjs`). Gallery reuses the existing bridge (`toAppProjectShape()`), the
  existing Design-Library-pioneered thumbnail pipeline, and the existing `validateProject()` — no
  fourth schema, no second render pipeline, no duplicate storage/UI.
* New: `src/gallery/**` (`RhsFixtureBridge.js` — relocated from `tools/lib/rhsProject.mjs` so there
  is exactly one implementation shared by Node tooling and the browser; `GalleryCatalog.js`;
  `index.js`) — a pure, DOM-free module mirroring `src/library/**`'s shape.
  `tools/lib/rhsProject.mjs` is now a thin re-export shim.
* New: `examples/gallery.json` (additive curatorial metadata) and 3 new customer-scenario fixtures
  (Wedding/Sports/Business) with baselines regenerated via the existing
  `node tools/generate-example-baselines.mjs` tool.
* `app.js`/`index.html`: one new Lightbox pair ("Gallery" grid + "Preview" detail) from a new
  top-menu button; thumbnail generation reuses the generalized `generateProjectThumbnail()` (renamed
  from Design Library's `generateLibraryThumbnail()`); Open Copy and Save-to-Library reuse
  `validateProject()`/`buildProjectItemData()`/`designLibrary.add()` verbatim; grid markup reuses
  `.library-grid`/`.library-card`/`.library-badge` classes, with a small set of additive-only CSS
  classes for the read-only visual identity.
* A real, previously-latent bug (legacy fixtures storing a stone-color *display name* instead of a
  catalog *id*, silently corrupting the layer on the live editor's first subsequent edit) was found
  via browser verification and fixed at the schema-bridge boundary — see the specification's Audit
  Findings.
* `GeometryEngine`, `StoneLayout`, every renderer, and every exporter are untouched.

## Rules

* Follow `docs/AI_ENGINEER.md`, `docs/CLAUDE_GUIDE.md`, `docs/ARCHITECTURE.md`,
  `docs/MILESTONE_WORKFLOW.md`.
* Repository is the source of truth; audit before implementing; do not duplicate project
  serialization, `GeometryEngine`, `StoneLayout`, renderer/exporter logic, or the Design Library's
  own storage/UI.
* Do not touch any forbidden-file prefix still enforced by an existing `npm test` guard, per the
  specification's Forbidden Files list. `examples/**` is legitimately touched by this milestone
  (its whole point) and is intentionally excluded from this milestone's own forbidden-file guard,
  as documented.
* Preserve backward/project compatibility: a project saved before this milestone must load and
  render unchanged; Project JSON's schema does not change.

## Deliverables

* `src/gallery/**` — new permanent module (fixture bridge, catalog, barrel).
* `examples/gallery.json`, 3 new `.rhs` fixtures, updated `manifest.json`/`baselines.json`.
* `app.js`, `index.html` — Gallery + Preview Lightboxes, top-menu entry, thumbnail generalization,
  Open Copy / Save-to-Library wiring, additive-only CSS.
* `tools/test-app-module-migration.mjs`, `tools/test-shape-geometry-integration.mjs` — extended
  import allowlists.
* `tools/test-design-library-integration.mjs` and 18 other pre-existing integration tests — updated
  for the thumbnail rename / the `examples/`-is-no-longer-forbidden change.
* `tools/test-gallery.mjs`, `tools/test-gallery-integration.mjs`, `tools/test-gallery-benchmark.mjs`
  — new tests.
* `package.json` — updated `test` script.
* `docs/specifications/RS-2001-GalleryAcceptanceSuite.md` — full specification and audit.
* `npm test` passing in full (801 checks).
* Real-browser verification (headless Chrome via CDP, isolated temp profile) of every Gallery
  feature, thumbnails, Open Copy, Save to Library, Dual Workspace, Production Sheet, exports, with
  screenshots — including a real bug found and fixed mid-verification.
* `TASK_RESULT.md` completed, including Product Owner and Business reviews and a final
  recommendation.
* One commit on `feature/rs-2001-gallery-acceptance-suite`, branch pushed (not merged).
