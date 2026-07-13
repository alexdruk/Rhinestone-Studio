# RS-2006 — Project Model Consolidation

## Task ID

RS-2006

## Numbering note

This milestone's brief used the label "RS-2006," but the repository's own roadmap
(`docs/specifications/RS-2000A-PostMVPAudit.md`, Part 7) had already reserved that id for
"Contour Fill Performance Optimization," and originally scoped this exact schema-reconciliation
work as **RS-2002** ("Project/Layer Schema Reconciliation") — before RS-2002 was later reused for
the Typography & Font Library milestone (`RS-2002-TypographyFontLibrary.md`, merged `85ac769`).
Rather than block on the numbering mismatch, this document keeps the brief's own "RS-2006" label
(matching the branch name and this file), and records the history here so a future reader isn't
misled by the roadmap's original numbering.

## Objective

Consolidate the project model into one canonical representation, per instruction: "the application
must behave exactly the same after this milestone" — an architecture/maintainability milestone, not
a feature milestone.

## Audit Findings (before implementation)

A full repository audit was performed before any code was touched, re-verifying (not assuming) the
prior `RS-2000A-PostMVPAudit.md` finding still held:

1. **Two project/layer models existed in name only.** `src/core/Project.js`/`Layer.js` (138 + 178
   lines) implemented a fully-built, validated, mm-only project/layer model. `grep -rn "src/core"`
   across every file in `src/**`, `tools/**`, and `app.js` turned up **zero real imports** — every
   hit was a code comment documenting that the model was unused. This was independently confirmed
   by a pre-existing regression test, `tools/test-app-module-migration.mjs`, which asserted
   `app.js` must never import `src/core/**` — a permanent, deliberate guard dating to RS-0003.5B3,
   not a gap this audit discovered.
2. **`app.js` already owns one single ad hoc project/layer schema**, and every subsystem this
   milestone was asked to check already consumes exactly that one schema, not two:
   - **Gallery** (`src/gallery/RhsFixtureBridge.js`) converts its own distinct `.rhs` fixture
     schema *into* `app.js`'s schema via `toAppProjectShape()` — never touches `src/core/**`.
   - **Design Library** (`src/library/LibraryTransform.js`) operates purely on `app.js`'s plain
     project/layer JSON, with its own header comment stating it "never `src/core/Project`/`Layer`,
     which remain unused by the live app."
   - **Save/Load** (`app.js`'s `defaultProject()`/`validateProject()`/`#exportProject`/
     `#importProjectFile`), **Production Sheet** (`src/export/ProductionSheetExporter.js`, consumes
     a merged `StoneLayout`, never a `Project`), **Import/Export**, and **History**
     (`src/history/HistoryManager.js`, pure JSON-snapshot bookkeeping) all read/write the same one
     ad hoc object.
   - **GeometryEngine** and **Rendering** (`src/geometry/**`, `src/renderer/**`) are, and remain,
     `StoneLayout`/`Stone`-only — they have never taken a `Project`/`Layer` of either schema as
     input, by design (`tools/test-render-export-pipeline.mjs` enforces this).
3. **One other schema genuinely exists and is intentionally distinct, not a duplicate to merge:**
   the flat, mm-suffixed `.rhs` fixture schema used by the 27 `examples/*.rhs` Gallery fixtures.
   This is deliberate (documented at length in `RhsFixtureBridge.js`'s header comment) and already
   has exactly **one** shared conversion implementation, consolidated during RS-2001 (moved from a
   duplicated `tools/lib/rhsProject.mjs` into `src/gallery/RhsFixtureBridge.js`, now re-exported by
   a thin compatibility shim). No further consolidation of this schema was in scope or needed.
4. **No duplicate conversion logic was found** beyond the above — `RhsFixtureBridge.js`'s
   `generateProjectStoneLayout()` intentionally re-implements `app.js`'s cross-layer dedupe/auto-fit
   algorithm as a documented, verbatim port for Node-side test infrastructure (Node cannot execute
   `app.js`, which is DOM-coupled), not an accidental drift-prone duplicate — this was already
   called out in `RS-2000A-PostMVPAudit.md` and remains correctly scoped as-is.

**Conclusion:** the only real duplicate-model debt in the repository was the wholly unused
`src/core/**` module. Per the task's own decision rule ("either remove it completely, or make it
canonical — choose whichever produces the simplest architecture; do not preserve unused
abstractions"), **removal (Option A)** was chosen. Promoting `src/core/Project.js`/`Layer.js` to
canonical (Option B) would have required rewriting every layer-mutation call site across `app.js`'s
~1,500 lines onto an incompatible field-naming scheme (`xMm`/`params.heightMm`/`params.mode` vs.
`app.js`'s flat `x`/`height`/`textMode`), for zero behavior change and high regression risk — the
task explicitly warned against exactly this ("do not modify project schema unless absolutely
necessary," "the application must behave exactly the same").

## Implementation Summary

- **Deleted** `src/core/Project.js`, `src/core/Layer.js`, `src/core/index.js`, `src/core/README.md`
  (323 lines) and their dedicated test, `tools/test-core-model.mjs` (87 lines) — the entire unused
  module and everything that only existed to test it.
- **Updated `tools/test-app-module-migration.mjs`**: its "app.js does not import src/core" guard is
  kept (still true, now vacuously — the directory no longer exists) with a refreshed name; its
  separate "no forbidden file changed" guard no longer lists `src/core/` as forbidden (this
  milestone is exactly the sanctioned exception).
- **Updated the same "no forbidden file changed" guard in 27 other historical per-milestone test
  files** (`tools/test-*.mjs`) that each independently listed `src/core/` in their own forbidden-
  path snapshot — every one of these is a cumulative regression guard (checked against live
  `git status`, not a diff against its own milestone's base commit), so all 27 would otherwise have
  failed the moment `src/core/**` was deleted. Each was updated to drop `src/core/` from its
  forbidden list, consistent with how each test already carries prior milestones' own such
  exceptions (e.g., "RS-2002: assets/fonts/\*\* is legitimately expanded...").
- **Removed `tools/test-core-model.mjs` from `package.json`'s `test` script.**
- **Added `tools/test-project-model-consolidation.mjs`** (new regression suite, 5 assertions) —
  see Testing below.
- **Updated `docs/ARCHITECTURE.md`** in every place it described the prior two-model split (the
  Project Model section, Validation Engine section, Layer section, module dependency table,
  two Mermaid diagrams, the Orchestration Layer section, and "Current Architectural Limitations")
  to describe the current, single-model reality, with the removal recorded under "Remaining Legacy
  / Dead Code" for historical traceability.
- **No changes** to `app.js`'s schema, `GeometryEngine`, any renderer, any exporter, Gallery,
  Design Library, or any saved Project JSON's shape. Zero behavior change, by design.

### Files changed

37 files changed, 197 insertions(+), 507 deletions(-) — net −310 lines. Full list:

- Deleted: `src/core/Project.js`, `src/core/Layer.js`, `src/core/index.js`, `src/core/README.md`,
  `tools/test-core-model.mjs`
- Added: `tools/test-project-model-consolidation.mjs`,
  `docs/specifications/RS-2006-ProjectModelConsolidation.md` (this file)
- Modified: `package.json`, `docs/ARCHITECTURE.md`, `tools/test-app-module-migration.mjs`, and 27
  other `tools/test-*.mjs` files (one-line forbidden-path-list edits only)

### Removed code

The entire `src/core/**` module (`Project` class: constructor, `addLayer`/`removeLayer`/
`getLayer`/`updateLayer`/`duplicateLayer`/`moveLayer`/`visibleLayers`/`validate`/`toJSON`/
`fromJSON`; `Layer`/`TextLayer`/`CircleLayer`/`RectangleLayer`/`createLayer`) and its isolated unit
test. Nothing that removed code called into remains reachable from any entry point.

### Remaining technical debt

Unchanged by this milestone (out of scope, tracked separately in `RS-2000A-PostMVPAudit.md`):
no live Validation Engine against `app.js`'s project object; cross-layer `dedupe()` living in
`app.js` rather than `GeometryEngine`; the font manifest `enabled` flag not gating `getFont()`;
`svg` layers' `mode` vs. every other vector layer's `fillMode`. None of these are project-model
duplication and none were introduced or worsened by this milestone.

## Testing

`npm test`: **63 suites, 822 assertions, exit 0** — full green, no suite skipped or modified in
behavior (only forbidden-path-list edits, which are guard configuration, not test logic).

New regression suite (`tools/test-project-model-consolidation.mjs`), proving the deliverables the
brief asked for:

1. `src/core/` no longer exists on disk.
2. No file in `src/**`, `tools/**`, or `app.js` references `src/core/` (two known, intentional
   exceptions — the permanent "app.js must never import it" guard assertions — are explicitly
   allow-listed with a comment explaining why).
3. Exactly one project/layer model is reachable from `app.js`: `defaultProject()`/
   `validateProject()`, with no `Project` class importable from anywhere.
4. The one remaining, intentionally distinct schema (Gallery's `.rhs` bridge) serializes
   deterministically: `toAppProjectShape()` called twice on the same validated input produces
   deep-equal and byte-identical (`JSON.stringify`) output.
5. Every one of the 27 `examples/*.rhs` fixtures converts to the single app project shape without
   throwing.

Gallery, Design Library, Save/Load, and Production Sheet compatibility are additionally proven by
the pre-existing suites that were **not modified in behavior** and still pass unchanged:
`tools/test-gallery.mjs`, `tools/test-gallery-integration.mjs`, `tools/test-design-library.mjs`,
`tools/test-design-library-integration.mjs`, `tools/test-production-export-validation.mjs`,
`tools/test-production-sheet-exporter.mjs`, `tools/test-examples-regression.mjs` (27/27 fixtures,
deterministic generation, baseline-matched stone counts/bounds).

## Browser Verification

Performed with Playwright's bundled Chromium — a browser process entirely separate from, and never
touching, any of the user's real Chrome windows/profiles (including any named "main" or "airbnb");
closed via `browser.close()` at the end of the script, nothing else was opened or closed.

Against `python3 -m http.server 5173` (this repo's own dev-server script):

| Flow | Result |
|---|---|
| App loads, default project (text layer) renders | ✓ |
| Save Project (Export → Export Project JSON) downloads a file | ✓ |
| Text edit → Undo → Redo | ✓ |
| Gallery opens and lists items | ✓ |
| Design Library opens | ✓ |
| Production Sheet dialog opens | ✓ |

**7/7 steps passed. Zero console errors (excluding none — no favicon 404 was even observed this
pass). Zero uncaught page exceptions.**

Deep per-feature UI passes (Curved Text, SVG/Image Trace import, Boolean Operations, Fill
Algorithms, Variable Stone Sizes, Typography, 3D Preview, Dual Workspace) were not re-run
individually: none of their code paths changed (verified above — `GeometryEngine`, renderers,
exporters, and every layer-mutation function in `app.js` are byte-identical to `develop`), and each
already has its own passing, unmodified regression suite in `npm test`. Re-driving all of them
through the browser would re-verify code this milestone provably never touched.

## Product Owner Review

This is architecture work with no new customer-visible surface — but it directly de-risks every
future feature milestone that touches "the project":

- **RS-2003 (Live Validation Engine)**, next on the repository's own roadmap, no longer has to
  choose which of two schemas to validate — there is exactly one, so validation work can start
  immediately without a preliminary "which model" design question.
- **Any future schema change** (new layer type, new project-level field) now only has one place to
  update, one place to test, and one set of round-trip guarantees to preserve — previously, a
  contributor reasoning about "the project model" had to first figure out that half of what they
  were reading (`src/core/**`) was dead and could be ignored, a tax paid on every future milestone
  touching this area since RS-0003.5B3.
- **New contributors and future AI-assisted implementation work** (this repository's own stated
  practice) get a smaller, less ambiguous module graph to reason about — one fewer "which of these
  two similar-looking things is real" question.

## Business Review

**Would customers notice this work directly? No.** The application's behavior, every saved Project
JSON's shape, every export format, and every UI flow are unchanged — verified by a full,
unmodified-behavior test suite and a live browser pass.

**Why the investment is worthwhile anyway:** this was the single most-repeated piece of technical
debt in the repository's own audit history — first flagged at RS-0003.5B3, re-confirmed by
RS-2000's stabilization pass, and re-confirmed again by RS-2000A's post-MVP audit — called out each
time as blocking real validation work (RS-2003) without ever being scheduled. Every milestone that
touched "the project" between RS-0003.5B3 and today paid a small but real tax (an extra "which
model applies here" check) that this consolidation permanently removes. The fix itself was low-risk
precisely because the audit confirmed the debt was already fully isolated (an unused module, not a
live one) — this was the cheapest possible moment to remove it, and the cost only grows the longer
an unused parallel model sits next to the real one, since every new contributor has to independently
rediscover that it is dead.

## Handbook Recommendations

**ADRs to add to the Master Handbook:**

1. **"One canonical domain model per concept, enforced by a structural test, not a comment."** This
   repository already had the right instinct (`tools/test-app-module-migration.mjs`'s import
   allowlist) but the enforcement only ever prevented the *live* schema from drifting toward the
   *unused* one — nothing ever forced a decision to converge or delete the unused side. Recommend:
   when a "future-proof" or "principled" model is built ahead of the code that will consume it, set
   an explicit expiry/review milestone at build time, not an open-ended "will migrate later."
2. **"Cumulative forbidden-file guards need an explicit ownership/expiry story."** This audit
   surfaced that 28 separate test files each carried their own copy of a "these paths must never
   change" list, all checked against live `git status` rather than a diff scoped to their own
   milestone — meaning every prior milestone's guard silently became a permanent, repository-wide
   rule enforced forever, discovered only when a later milestone legitimately needs to touch one of
   those paths. Recommend a single shared, versioned "structural invariants" module (or at minimum
   a single shared forbidden-path list) rather than 28 independent copies, so a legitimate future
   change requires one edit, not 28.

**Architectural lessons learned:**

- An audit that re-verifies rather than assumes prior findings (per this milestone's own
  instruction) is what caught that the "two schemas" framing from `RS-2000A-PostMVPAudit.md` was
  still accurate but incompletely reasoned about — the prior audit correctly identified the debt
  but explicitly deferred the removal-vs-migrate decision; this milestone's job was exactly that
  decision, and the audit data (zero real references anywhere) made it unambiguous.
- "Simplest architecture" and "smallest diff" pointed the same direction here because the unused
  side of a two-model split had already been fully isolated by a pre-existing test guard — that is
  not guaranteed in general (an unused model with live callers scattered through the codebase would
  have made removal much riskier), so this should not be read as "removal is always simpler than
  migration," only that it was correctly simpler in this specific, well-isolated case.

## Recommendation

**APPROVED FOR REVIEW**

- `npm test`: 63 suites / 822 assertions / exit 0.
- Live browser verification: 7/7 flows passed, zero console errors, zero uncaught exceptions.
- Zero behavior change to any saved Project JSON, export format, or UI flow.
- Net −310 lines; one dead module and its dedicated test removed; `docs/ARCHITECTURE.md` brought
  back into agreement with the current tree.
- Feature branch pushed (`feature/rs-2006-project-model-consolidation`), not merged, per
  instruction.
