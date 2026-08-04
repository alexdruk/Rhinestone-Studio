# RS-2001 — Gallery & Acceptance Suite

## Objective

Add a built-in, **read-only** Gallery of example rhinestone designs, opened from a dedicated
top-menu button, that lets users browse, search, filter, preview, and open an editable copy of any
example (optionally saving that copy into their Design Library). The Gallery is **not** the Design
Library (RS-1015): Design Library items are user-owned, editable, `localStorage`-backed personal
content; Gallery items are permanent, built-in, never-modified examples that also double as the
project's acceptance-test and performance-benchmark fixture set. Per `docs/specifications/
RS-2000A-PostMVPAudit.md` Part 7, RS-2001 converts the existing `examples/*.rhs` fixture set into
this formal, browsable surface.

## Audit Findings (before implementation)

* **Three parallel project schemas already exist** in this repo: `app.js`'s live ad hoc schema
  (authoritative — what the editor actually round-trips), the unused `src/core/Project.js`/
  `Layer.js`, and the flat mm-suffixed `.rhs` fixture schema (`examples/*.rhs`, bridged to the live
  schema only by `tools/lib/rhsProject.mjs`'s `toAppProjectShape()`). Gallery reuses this exact
  bridge rather than inventing a fourth schema.
* **Design Library (RS-1015) already solved "reusable save/browse/thumbnail/insert."** Gallery
  follows its architecture shape (a pure, DOM-free permanent module + barrel, one Lightbox + one
  top-menu button, thumbnails via the existing `engine.generate()` → `renderProductionLayout()`
  pipeline on an offscreen canvas) rather than reinventing any of it.
* **GeometryEngine / StoneLayout / every renderer and exporter are single-implementation and
  test-enforced to stay that way** (`tools/test-app-module-migration.mjs`'s import allowlist, and
  every milestone's own forbidden-file guard). Gallery adds zero geometry, rendering, or export
  code.
* **The 24 pre-existing fixtures are engineering regression fixtures, not customer-scenario
  designs** (`circle-only.rhs`, `monogram-fill.rhs`, `boolean-union-badge.rhs`, etc. — confirmed via
  `examples/manifest.json`). Categories like Wedding/Sports/Business had zero real members. Per
  product decision, 3 new customer-scenario fixtures were hand-authored (`wedding-bride-tribe-
  tumbler.rhs`, `team-jersey-name-number.rhs`, `business-logo-monogram-bottle.rhs`), using only
  already-supported layer types/products, with baselines regenerated via the existing, sanctioned
  `node tools/generate-example-baselines.mjs` tool — not a new mechanism.
* **A real, previously-latent bug was found and fixed during browser verification**: the two
  preserved legacy fixtures (`vitalina.rhs`/`vitalina-serbin.rhs`, byte-checksum-locked) store
  `color` as the display name `"Crystal AB"` rather than the crystal color catalog's id `"crystal"`.
  This was harmless while the `.rhs` schema was consumed only by Node tooling, but Gallery is the
  first feature to open a `.rhs` fixture into the *live* editor, whose `#stoneColor <select>` only
  offers real catalog ids as `<option value>`s — an unmatched value silently collapsed the control
  to `""`, corrupting the layer's color on the next edit. Fixed by adding `resolveStoneColorId()` to
  the shared bridge (mirroring the pre-existing `resolveFontId()` legacy-name-to-id pattern),
  applied only inside `toAppProjectShape()` (the live-editor path), never touching the Node-side
  geometry-generation path or the byte-locked fixture files themselves.

## Architecture

```
examples/*.rhs (24 existing + 3 new)  --fetch()-->  validateRhsProject() --> toAppProjectShape()
examples/manifest.json / baselines.json (existing, byte-unchanged except 3 new entries each)
examples/gallery.json (NEW, additive)  -- curatorial metadata: title/category/description/
                                           difficulty/tags/featured (stoneCount/objectType/wrap are
                                           derived at load time from baselines.json / the fixture's
                                           own product field -- never hand-typed, can never drift)
        |
        v
src/gallery/  (NEW permanent module, pure/DOM-free, mirrors src/library/** shape)
  RhsFixtureBridge.js   -- relocated from tools/lib/rhsProject.mjs: validateRhsProject(),
                           toAppProjectShape(), generateProjectStoneLayout(), resolveFontId(),
                           resolveStoneColorId(), visibleLayerCount(), SUPPORTED_* sets. One
                           implementation, now shared by the Node regression/benchmark suite AND
                           the browser Gallery (tools/lib/rhsProject.mjs is now a thin
                           `export * from '../../src/gallery/RhsFixtureBridge.js'` re-export shim).
  GalleryCatalog.js     -- pure functions: parseCatalog() cross-validates gallery.json against
                           manifest.json/baselines.json/each fixture's own content and merges them
                           into one read-only catalog entry per fixture; search(); filterByCategory()
                           (supports both curated categories and product-derived pseudo-categories
                           Mugs/Tumblers/Bottles); categories(); featuredEntries(); getEntry().
  index.js              -- barrel; the only file app.js imports from.

app.js / index.html
  - top-menu button `menuGallery`, Lightbox `lightboxGallery` (grid) + `lightboxGalleryPreview`
    (detail), mirroring the Design Library's Lightbox wiring exactly.
  - `generateLibraryThumbnail()` generalized to `generateProjectThumbnail()` — one function, used by
    both Design Library's save flow and Gallery's card/preview rendering. No second thumbnail
    renderer.
  - Grid markup reuses `.library-grid`/`.library-card`/`.library-badge`/`.library-card-meta`/
    `.library-card-thumb`/`.library-card-actions` verbatim; a handful of new additive-only classes
    (`.gallery-card` position anchor, `.gallery-readonly-badge` ribbon, `.gallery-category-pill`
    accent, `.gallery-preview-thumb`) add the read-only visual identity on top, using the existing
    `--color-primary` deep-blue token already used for every other primary action in the app.
  - Card actions: "Preview" (read-only detail panel, no project mutation) and "Open Copy" (fetch →
    `validateRhsProject()` → `toAppProjectShape()` → the app's own existing `validateProject()` →
    the exact same full-project-replace + `history.clear()`/dirty-baseline-reset path
    `#importProjectFile`/`createProjectFromLibraryItem()` already use). The preview panel also
    offers "Save to Design Library", which builds the same app-shape project and calls
    `buildProjectItemData()`/`designLibrary.add()` directly, without touching the user's current
    live project.
  - Gallery items are never mutated: `validateRhsProject()`/`toAppProjectShape()` both return fresh
    objects; a fetched fixture is only ever read and translated, never written back to
    `examples/**`.
```

## Metadata Schema (`examples/gallery.json`, new file)

```json
{
  "version": 1,
  "items": [
    {
      "file": "vitalina.rhs",
      "title": "Classic Name",
      "category": "Names",
      "description": "...",
      "difficulty": "beginner",
      "tags": ["names", "block-font", "outline-mode", "legacy"],
      "featured": true
    }
  ]
}
```

Deliberately **not** stored here: `stoneCount`/`layerCount`/`visibleLayerCount` (sourced from
`examples/baselines.json`), `objectType`/`wrap` (sourced from the fixture's own `product`/`wrap`
field). `GalleryCatalog.parseCatalog()` cross-validates all three sources agree and throws a
descriptive error if any gallery.json entry references a fixture missing from manifest.json or
baselines.json, or vice versa (full bidirectional coverage — every regression fixture is also a
Gallery entry).

## Category Mapping (27 fixtures)

Names (8), Monograms (2), Shapes (5: circle/rectangle-only + the three mixed-layer dedupe fixtures),
Boolean Operations (1), SVG (1), Image Trace (1), Multi-color (1), Mixed Stone Sizes (2), Large
Projects (1: `mixed-fill-styles-and-sizes.rhs`, the highest `stoneCount` at 1280 — the permanent
benchmark flagship), Tumblers (1 + the new Wedding tumbler), Bottles (1 + the new Business bottle),
Wedding (1, new), Sports (1, new), Business (1, new). `Featured` is a cross-cutting flag (not an
exclusive category) on 6 fixtures chosen for breadth. `Mugs`/`Tumblers`/`Bottles` are additionally
available as product-derived pseudo-categories in the filter dropdown (computed from each fixture's
own `product` field, not hand-curated), alongside the curated thematic categories.

## Allowed Files

* `src/gallery/**` (new)
* `examples/gallery.json` (new); `examples/*.rhs` (3 new fixtures);
  `examples/manifest.json`/`baselines.json` (3 new entries appended, existing 24 byte-unchanged)
* `tools/lib/rhsProject.mjs` (now a re-export shim)
* `app.js`, `index.html` (Gallery Lightbox/top-menu wiring, `generateProjectThumbnail()`
  generalization, additive-only CSS)
* `tools/test-app-module-migration.mjs`, `tools/test-shape-geometry-integration.mjs` (extend the
  `app.js` import allowlist by one entry each, exactly as every prior milestone that added a barrel
  module did)
* `tools/test-design-library-integration.mjs` (one assertion updated for the
  `generateLibraryThumbnail` → `generateProjectThumbnail` rename)
* 18 pre-existing integration tests' own `git status --porcelain` forbidden-prefix guards, updated
  to no longer forbid `examples/` (this milestone's whole point), mirroring the exact precedent of
  how `app.js`/`index.html` were unforbidden once RS-0003.5B3 needed them
* `tools/test-gallery.mjs`, `tools/test-gallery-integration.mjs`, `tools/test-gallery-benchmark.mjs`
  (new)
* `package.json` (`test` script)
* `docs/specifications/RS-2001-GalleryAcceptanceSuite.md`, `TASK.md`, `TASK_RESULT.md`

## Forbidden Files

`src/geometry/**`, `src/renderer/**`, `src/export/**`, `src/editing/**`, `src/history/**`,
`src/products/**`, `src/text/**`, `src/fonts/**`, `src/svg/**`, `src/image/**`, `src/preview3d/**`,
`src/core/**`, `src/browser/**`, `src/ui/**`, `src/library/**`, `assets/**`, `README.md`, `LICENSE`,
`CONTRIBUTING.md`. `style.css` remains untouched (it is dead/unlinked legacy CSS — the live app's
actual stylesheet is `index.html`'s own inline `<style>` block, already an allowed file).

## Out of Scope

* Fixing the pre-existing WebGL warning (`GL_INVALID_VALUE: glCopySubTextureCHROMIUM`) that occurs
  in `src/preview3d/**` when the Object Preview's canvas/texture dimensions change while the 3D view
  is already active (reproduced independent of Gallery — see Browser Verification below).
  `src/preview3d/**` is forbidden for this milestone; flagged as a fast-follow.
* A fourth new fixture per missing category, cloud sync of the Gallery, drag-and-drop reordering,
  per-user Gallery customization.
* Any change to Project JSON's own schema or a Validation Engine module.

## Automated Tests

* `tools/test-gallery.mjs` — `src/gallery/**` unit tests: catalog parsing/cross-validation against
  real repo data, bidirectional manifest/baseline/gallery.json coverage, `stoneCount`/`objectType`
  always sourced (never hand-typed), no-mutation guarantee, search/filter/category/featured
  behavior, and a dedicated regression test for the `resolveStoneColorId()` fix.
* `tools/test-gallery-integration.mjs` — wiring guard: Lightbox + top-menu button registered, DOM
  ids exist, read-only (no save/rename/duplicate/delete actions in the Gallery grid),
  `validateProject()`/`buildProjectItemData()`/`designLibrary.add()` reused not duplicated,
  `generateProjectThumbnail()` shared not duplicated, forbidden-file guard (deliberately excluding
  `examples/` from its own forbidden list).
* `tools/test-gallery-benchmark.mjs` — Node-side permanent performance benchmark: geometry
  generation, SVG export, and Production Sheet (SVG + PDF) generation timing for every non-image
  catalog fixture, asserting success and a generous sanity ceiling; asserts the Large Projects
  flagship is measured, not skipped. (Thumbnail generation and PNG export need a real `<canvas>`
  and are measured only in the manual browser pass, per the same constraint already documented in
  `tools/generate-example-baselines.mjs`.)
* `npm test` passes in full (801 checks across every suite, old and new).

## Browser Verification

Isolated headless Chrome via raw CDP (temp `--user-data-dir`, private debugging port; no
Playwright/Puppeteer dependency — matches this repo's established pattern in
`tools/lib/browserImageBuffer.mjs`). Never touched any pre-existing Chrome window/profile; only the
process this session started was ever closed. Verified: Gallery opens (27 cards render); every
curated category and both product pseudo-categories present; search ("wedding" → 1 result);
category filter ("Sports" → 1 result); Preview panel (title/thumbnail/description/tags/badges);
Save to Design Library (round-tripped into the Design Library grid); Open Copy (project replaced,
history reset, dirty indicator behaves correctly on subsequent edits); Dual Workspace / 2D Canvas /
Object Preview (3D) view switching; Production Sheet SVG + PDF export; Project JSON / 2D SVG / 2D
PNG export — all six downloaded files verified non-empty; **all 27 Gallery fixtures individually
opened as a copy with no failures**. No console errors other than the known favicon 404. One real,
reproducible WebGL warning was found and characterized (switching product/canvas dimensions while
the 3D Object Preview is already active) — confirmed to reproduce with a plain non-Gallery project
too, confirming it is a pre-existing `src/preview3d/**` behavior surfaced by, not caused by, Gallery.
Screenshots captured for every step (see `TASK_RESULT.md`).

## Acceptance Criteria

* Gallery opens from a dedicated top-menu button; browsing, search, category filter, preview, Open
  Copy, and Save to Design Library all work end-to-end in the browser.
* Every Gallery item is read-only; no action in the Gallery grid ever modifies `examples/**`.
* A project saved before this milestone loads, renders, and exports unchanged (Project JSON schema
  untouched).
* `GeometryEngine`, `StoneLayout`, every renderer, and every exporter are byte-unchanged.
* `npm test` passes in full.
* One commit on `feature/rs-2001-gallery-acceptance-suite`, branch pushed, not merged.

## Required Commands

```bash
npm test
git diff --check
git status
```

## Commit Message

`feat(gallery): Gallery & Acceptance Suite — browsable, read-only example designs (RS-2001)`

## Deliverables

See `TASK.md` / `TASK_RESULT.md`.

## Next Milestone

Candidate follow-ups (not in this milestone): investigate/fix the `src/preview3d/**` WebGL warning
on cross-product canvas resize; add further customer-scenario fixtures for underrepresented
industries (see `TASK_RESULT.md`'s Business Review); RS-2002 Project/Layer Schema Reconciliation
(already reserved in `docs/specifications/RS-2000A-PostMVPAudit.md`).
