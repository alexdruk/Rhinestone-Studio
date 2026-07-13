# RS-2000A — Post-MVP Product Audit & Roadmap

## Task ID

RS-2000A

## Type

Audit and planning milestone only. No production code was modified. No features were implemented.
No branch was created; no commit is associated with this document beyond adding it.

## Status

COMPLETE (recommendations only — see Part 7 for the release-readiness decision)

## Method

- Full re-read of `docs/ARCHITECTURE.md` (1,116 lines — the project's own living record of
  principles, current implementation, and tracked debt) against the current state of `src/**`,
  `app.js`, `index.html`, and `tools/**`.
- Full commit-history and `docs/specifications/**` review (31 spec files, ~70 commits) to build the
  milestone status table in Part 6.
- A dedicated static audit of dead code, duplication, oversized modules, test coverage, input
  validation, and terminology consistency, cross-checked against the current tree (not taken on
  faith from prior docs).
- Live product review: an isolated, temporary headless Chrome instance (own `--user-data-dir`, own
  debugging port, never touching any of the user's own Chrome windows/profiles — see Browser Safety
  compliance below), driven over the raw DevTools Protocol against `python3 -m http.server 5173`,
  exercising text editing, curved text, undo/redo, object templates (Mug/Tumbler/Bottle), wrap
  modes, 3D preview rotation, Design Library, Export, Production Sheet, and Settings dialogs, with
  screenshots captured at each step and the console-log/exception stream captured for the entire
  session (zero errors observed across all passes).
- `npm test` was **not** re-run destructively; its last known-good result is RS-2000's own
  (60 suites, 756 assertions, exit 0), which this audit did not invalidate (no source files were
  changed).

**Browser safety compliance:** every browser session in this audit launched its own headless Chrome
process with a fresh temp profile directory and a randomized local debug port, and was killed at the
end of each script. No existing Chrome window (named "main", "airbnb", or otherwise) was touched,
closed, or quit.

---

# Part 1 — Repository Audit

## 1.1 Architecture

The architecture is unusually well self-documented. `docs/ARCHITECTURE.md` already tracks, in its own
"Current Architectural Limitations" and "Remaining Legacy / Dead Code" sections, most of what a
fresh audit would otherwise have to discover from scratch. This audit's job was to **verify those
claims still hold** rather than take them on faith, and to find what the document does not already
know about.

**Confirmed still accurate:**

- **Two unreconciled project/layer models.** `src/core/Project.js`/`Layer.js` are a fully-built,
  validated, mm-only project model that **nothing in the live app imports** — enforced by
  `tools/test-app-module-migration.mjs`'s import allowlist. `app.js` edits its own ad hoc plain-object
  project instead. This is the single largest piece of architectural debt in the repository, called
  out consistently since RS-0003.5B3 and never scheduled for reconciliation. See Part 3/4, RS-2002.
- **Cross-layer merge (`dedupe()`) lives in `app.js`, not the Geometry Engine.** Confirmed live and
  called at `app.js:258`, still the only cross-layer proximity merge. Does not violate "only the
  Geometry Engine generates stone positions" (it only filters, never invents positions) but means the
  permanent engine has no native multi-layer aggregation API.
- **The font manifest's `enabled` flag doesn't gate what can load.** Confirmed: all three fonts in
  `assets/fonts/manifest.json` are marked `"enabled": false`, but `FontManager.getFont()` doesn't
  check the flag, so `app.js` loads two of them anyway by calling `getFont()` directly by id.
  `roboto-mono-regular`'s font file is a 14-byte placeholder stub that would throw if ever selected —
  it currently isn't offered in the UI, so this is latent, not live-broken.
- **No Validation Engine.** `src/core/Project.js.validate()` implements real checks (duplicate layer
  ids, canvas bounds, units) but only against the unused `src/core/Project` model — none of it runs
  against what a user actually edits. There is no overlap-detection or missing-font validation
  anywhere.
- **PNG export has no dedicated exporter module** — it's a `canvas.toBlob()` capture of whatever the
  2D/cup renderer most recently drew. Documented as intentional; still true.
- **`svg` layers use `mode` where every other vector layer type uses `fillMode`** for the identical
  concept. Cosmetic/internal only — the UI label is uniformly "Fill Style."
- **RS-2000's dead-code deletion is genuinely clean.** `FONT5`, `generateText()`, `sampleGlyphFill()`,
  `sampleGlyphStroke()`, `generateCircle()`, `generateRect()` have zero remaining references in
  `app.js`/`src/**` outside of an explanatory comment and the regression tests that assert their
  absence. `dedupe()` was correctly kept — it's still live (`app.js:258`).

**New findings this audit surfaced that were not already tracked:**

- **Wall-taper math is independently duplicated between the 2D and 3D renderers.**
  `wallHalfWidthAt()` in `src/renderer/CupRenderer.js:202-205` and `wallRadiusAt()` in
  `src/preview3d/ObjectGeometryBuilder.js:165-169` both compute the identical linear taper-by-height
  interpolation, once for the 2D canvas preview and once for the 3D mesh. Not previously documented
  (only `ContourRingSampler`/`PathBoolean`'s "intentional near-duplication" was). Low-medium severity
  — same math expressed twice, could silently drift if one is changed without the other.
- **A basic numeric-assertion helper (`assertFiniteNumber`/`assertPositiveFiniteNumber`) is hand-rolled
  independently in at least 9 files** (`ObjectTemplate.js`, `Stone.js`, `GeometryEngine.js`,
  `VectorPath.js`, `ImageFieldPipeline.js`, `PdfDocument.js`, `ProductionSheetExporter.js`,
  `SvgExporter.js`, `ObjectDimensions.js`) with no shared home. Trivial bodies, but a real missing
  primitive.
- **`StoneSampler.js` (591 lines) implements every fill strategy (outline/staggered/radial/contour)
  twice** — once for polygon input, once for image-field input — a real internal duplication inside
  one file, distinct from the already-documented `ContourRingSampler`/`PathBoolean` overlap.
- **`src/image/ImagePreviewRender.js`'s `maskFieldToRgba()` has zero test coverage** despite being
  live-used by `app.js`'s Image Trace live-preview canvas (`updateImagePreview()`).
- **A previously undocumented, real UX-blocking interaction**: every lightbox (`.lightbox-overlay`,
  `index.html:188`, `position:fixed;inset:0;z-index:100`) captures pointer events across the entire
  viewport while open, including the always-visible left-sidebar Layers list. Confirmed live via
  `document.elementFromPoint()` at a Layers-list row's coordinates while the Shapes dialog was open —
  it returned the overlay element, not the layer row. This directly undercuts the Shapes dialog's own
  Boolean Ops hint text ("Select two or more layers... in the Layers list") — see Part 2/3, RS-2004.
- **`ARCHITECTURE.md`'s "Future Direction" claim that "text layers are select-only, not draggable" now
  reads as stale.** `app.js`'s `pointerdown` handler (`app.js:663-694`, rewritten for RS-1009's
  generic multi-select/group-drag) performs `hitTest()`-based dragging with no per-type branching, and
  the on-canvas hint ("Drag to move...") is shown regardless of selected layer type. A live drag
  attempt via synthetic `PointerEvent`s in this audit was **inconclusive** (the synthetic event did
  not reliably reproduce real mouse-input fidelity — see Part 2), so this is flagged as **needs a
  real-mouse re-check**, not asserted as fixed or broken. Recorded here specifically so it isn't
  re-assumed true from stale docs next time (task instruction: "do not assume an issue still exists").

## 1.2 Oversized modules

Per-file verdict (full detail delegated to a subagent and spot-checked): `app.js` (1,259 lines, very
dense — single-statement style, up to 2,106 characters on one line) and `index.html` (893 lines,
markup-only) are both large but each is a single cohesive concern by construction (one orchestration
script for one page). `GeometryEngine.js` (814 lines) fans out five parallel per-layer-type pipelines
by design — cohesive. `VectorPath.js` (408 lines) is the one plausible split candidate: it bundles
geometry primitives (`Point2D`, `Contour`, `VectorPath`) with font-provider result value objects
(`GlyphMetrics`, `FontProviderResult`) that are a somewhat distinct concern sharing one file.
`ProductionSheetExporter.js` (401 lines) does layout + SVG + PDF serialization in one file — a
reasonable "one exporter, three formats" grouping, but the widest "does three things" file. None of
these rise to "defect" — see RS-2009 for the one genuinely large, low-cohesion file (`app.js`).

## 1.3 Duplicated / dead code

No dead code beyond what RS-2000 already removed. Duplication is limited to the items above — none
of it is copy-paste business logic that has drifted incorrectly; all instances are either
intentional (documented) or small/low-risk (numeric assertions, wall-taper math).

## 1.4 TODO/FIXME/terminology

Zero `TODO`/`FIXME`/`HACK`/`XXX` comments anywhere in `src/`, `app.js`, or `tools/` — confirmed by
direct grep, consistent with the project's stated "regression tests, not comments" discipline.
Terminology is materially consistent: "stone" is the pervasive internal/API term, "rhinestone" is
reserved for product/marketing copy, "crystal" only appears inside the color-catalog's own naming —
this three-way split holds up under inspection rather than being accidental drift. Two internal,
cosmetic exceptions exist: `svg` layers' `mode` vs. every other layer type's `fillMode` (already
documented), and `src/renderer/StoneColors.js` being a one-line, self-documented compatibility shim
re-exporting `CrystalColors.js`. "Design Library" (UI copy) vs. "project" (schema/internal) for the
same save/reuse concept is a soft, low-severity naming split worth a mention in copy but not urgent.

## 1.5 Tests

`npm test` wires 60 suites covering every `src/**` module, every milestone's structural guards
(import allowlists, forbidden-file lists), and a real-fixture regression suite
(`tools/test-examples-regression.mjs`, 24 `examples/*.rhs` fixtures against committed baselines). The
only concrete coverage gap found is `ImagePreviewRender.maskFieldToRgba()` (Part 1.1). Everything
else that looked like a gap on a first pass (`Layer.js`, `Blur.js`, `Invert.js`, etc.) turned out to
be tested through its module's barrel import, matching this project's stated convention.

## 1.6 Documentation

`docs/architecture/architecture.md` and `docs/adr/ADR-0001-*.md` are explicitly marked
non-authoritative, superseded by `docs/ARCHITECTURE.md` — no action needed, already self-documented.
`docs/PRODUCT_ROADMAP.md`/`docs/BACKLOG.md` are stale (still list "Version 1.0"/"Version 1.1" items
that map onto milestones completed long ago, e.g. Curved Text/SVG Import/Undo-Redo are marked
"Planned" despite being done since RS-1002/1003). Recommend these two files get a pass as part of
whichever milestone follows this audit — cheap, high-value hygiene (a new contributor reading
`BACKLOG.md` today would be actively misled about what's already built).

---

# Part 2 — Product Review (real usage pass)

Performed as a real user would: default project (Mug, "Vitalina Serbin" text layer) → edit → add
shapes → switch object templates → rotate/inspect 3D preview → open every top-menu dialog → attempt
multi-layer selection for Boolean Ops → attempt a canvas drag. Zero console errors or exceptions were
observed in any pass.

**Friction found, in the order encountered:**

1. **Enabling "Curved text" defaults to a full 360° circle, not a gentle arc.** Turning on Curved Text
   for the first time (`index.html:426-436`, `curveEnabled` → `curveRadiusMm=40`, `curveSweepAngleDeg
   =360`) instantly turns straight text into a small closed wreath/circle shape. Confirmed live: the
   default "Vitalina Serbin" text layer, once curved with defaults, renders as a tight closed loop on
   both the 2D canvas and the mug's 3D preview — not the "banner arcing across a logo" look that is
   the far more common real-world rhinestone use case. A first-time user exploring the feature gets a
   surprising result before touching any other field. **Low implementation cost, real first-impression
   cost.**
2. **Boolean Ops requires an operation order the dialog itself doesn't support.** The Shapes dialog's
   own hint text says "Select two or more layers (Shift-click on the canvas, or in the Layers list) to
   combine them" (`index.html:474`). But every lightbox, including this one, is a
   `position:fixed;inset:0;z-index:100` overlay that captures all pointer events across the full
   viewport while open — confirmed live via `elementFromPoint()` returning the overlay, not the
   underlying Layers-list row, while the Shapes dialog was open. So a user cannot follow the dialog's
   own instructions from inside the dialog: they must already have 2+ layers selected *before* opening
   Shapes, or close it, select, and reopen it. This is a real "extra clicks/wrong order" finding, not
   a hypothetical one — the fix is a UI mechanics change (e.g., a non-blocking side panel or
   click-through on the backdrop for the Layers list), not new functionality.
3. **Object template switching is discoverable and correct.** Switching Mug → Straight Tumbler →
   Bottle correctly resets canvas dimensions and wrap default, redraws a materially different 3D
   silhouette for each, and full-wrap text renders once, cleanly, at every rotation angle checked
   (Front/Left/Right/Back for the tumbler; -180°→180° in 60° steps for the bottle) — no ghosting or
   duplicate-artwork was observed at any angle (see Part 6, S-004).
3. **Undo/Redo, Save/dirty-indicator, and Dual Workspace↔Object Preview↔2D Canvas tab switching all
   worked exactly as expected** with no lag or state loss across the sequence tested (text edit → curve
   toggle → undo → redo → tab switch → rotate).
4. **Design Library, Export, and Production Sheet dialogs are clear and well-labeled** — Export groups
   its six outputs into three legible categories (Project data / Production geometry / Visual
   previews); Production Sheet's "Included on the sheet" hint tells the user exactly what they'll get
   before they generate it, which is good practice not commonly seen even in mature tools.
5. **Layer names truncate aggressively in the left sidebar** ("Vitalina..." at ~9 characters) with no
   hover tooltip observed showing the full name — minor, but a repeat-friction item for anyone naming
   layers descriptively.
6. **Settings dialog is honest about its own limits** — "Show grid by default" is shown disabled with
   the label "(always on — not yet configurable)" rather than silently doing nothing. Good pattern,
   worth keeping as house style.

No workflow produced a console error, a stuck dialog, or a state where Undo/Redo, Save, or Export
stopped responding.

---

# Part 3 — UX Review

Consolidating Part 2 into judgeable friction categories:

| Friction | Where | Severity | Fix shape |
|---|---|---|---|
| Curved text defaults to a full circle | Text lightbox, `curveEnabled` defaults | Medium (first-impression) | Change default `curveSweepAngleDeg` for newly-enabled curve to something arc-like (e.g. 180°), leave the field freely editable |
| Boolean Ops dialog's own instructions are unfollowable from inside the dialog | Shapes lightbox / any lightbox over the Layers list | Medium-High (blocks a documented workflow) | Make the Layers list reachable while a lightbox is open (non-modal side panel, or a "select layers" affordance inside the dialog itself) |
| Layer names truncate with no way to see the full name | Left sidebar layer rows | Low | Add a `title` attribute (native tooltip) — near-zero cost |
| `PRODUCT_ROADMAP.md`/`BACKLOG.md` are stale | Docs, not app | Low (misleads contributors, not customers) | One-time content pass |

No missing-validation, silent-failure, or data-loss UX issue was found in this pass — every import/
export/save path either succeeds visibly or surfaces a `validation-message`/status-bar error.

---

# Part 4 — Architecture Review

Summarized from Part 1.1. The repository's architecture is sound and its principles (one Geometry
Engine, millimeters internally, renderer/exporter independence) hold in practice, not just on paper —
verified directly in code, not assumed from the docs. The two most consequential open items are:

1. **The two-schema split** (`src/core/**` unused vs. `app.js`'s live ad hoc schema) — the single
   biggest piece of technical debt, unchanged since it was first flagged, carrying real cost:
   `src/core/Project.js.validate()`'s duplicate-id/bounds/units checks provide zero protection to
   anything a user actually edits today.
2. **No Validation Engine against the live project** — a direct consequence of (1). A user can
   currently create duplicate layer ids or place stones with no engine-level check catching it before
   export (though nothing in this audit's testing produced that state through the UI itself — the gap
   is an engine-level absence, not an observed live defect).

Both are pre-existing, well-understood, and already correctly triaged by RS-2000 as "a dedicated
migration milestone's scope, not a stabilization bug fix" — this audit concurs and formalizes them as
RS-2002/RS-2003 below.

---

# Part 5 — S-Project Status Table

| ID | Title | Status | Evidence |
|---|---|---|---|
| M2.2 | Vector Text Engine | Completed | `src/text/`, `src/fonts/` live; merged `0e6e6b9`/`390f71e` |
| RS-0003.4 | OpenType Provider | Completed | `src/text/OpenTypeProvider.js`; commit `4ffa2ca` |
| RS-0003.5A/5A1 | Vector Text Geometry Engine | Completed | `src/geometry/GeometryEngine.js`; commits `e5242c0`, `746aa32` |
| RS-0003.5B/5B1/5B2/5B3 | Browser integration/migration/dependency loading/live geometry | Completed | `src/browser/**`; commits `0c9f861`, `617bb88`, `e39b2bd`, `188539a` |
| RS-0003.5C1 | Permanent Shape Geometry Integration | Completed | commit `6e8c54f` |
| RS-0003.5C2 | Unified Rendering Pipeline | Completed | commit `151865d` |
| RS-0003.5D1 | Production Export Validation | Completed | commit `93bbb0f` |
| RS-0003.5D2 | UX Visual Polish | Completed | commit `241b320` |
| RS-0003.5E1 | Real Production Validation | Completed | commit `84346bf` |
| **S-001** | Cup Rendering Stabilization (handle, rotation, view-button sync) | Completed | `docs/specifications/S-001-CupRenderingStabilization.md`; commits `5cb8fe4`, `798a031`, `4364c4d`, `dd81753`, `b56bfe8`, `1eeb845` |
| RS-1001 | SVG Import | Completed | `src/svg/**`; commit `e7babb0`, audit fix `0c00913` |
| RS-1002 | Undo/Redo | Completed | `src/history/HistoryManager.js`; commit `1215299` |
| RS-1003 | Curved Text | Completed | commit `cc59fb0`; discoverability follow-up `b6705a5` |
| RS-1004 | Multi-Object Templates | Completed | `src/products/ObjectTemplate.js`; commit `ada7054` |
| **S-003** | Silent last-layer-deletion (distinct issue reusing the ID) | Completed | commit `cd7906c`, `tools/test-default-text-layer-editing.mjs` |
| RS-1005 | Production Sheet Generator | Completed | `src/export/ProductionSheetExporter.js`; commit `2ddec56` |
| RS-1006 | Real 3D Preview | Completed | `src/preview3d/**`; commit `c6fe6bd` |
| RS-1006A | Preview Corrections (mug/handle/tumbler-duplicate/bottle) | Completed | `src/preview3d/ObjectGeometryBuilder.js:75` (`THREE.FrontSide`); regression test in `tools/test-object-geometry-builder.mjs`; commit `27020b4` |
| RS-1007 | Crystal Color Library | Completed | `src/renderer/CrystalColors.js`; commit `8827202` |
| RS-1008/RS-1008A | Image Trace / architecture correction | Completed | `src/image/**`; commits `69e6177`, `6ae42f2` |
| RS-1009 | Alignment & Snapping | Completed | `src/editing/**`; commit `5c67edd` |
| RS-1010/RS-1010A | Alignment & Snapping Upgrade / wording | Completed | commits `e9db7ce`, `c5efe1d` |
| RS-1011 | Fill Algorithms | Completed | `src/geometry/ContourRingSampler.js`; commit `7c9e2bf` |
| RS-1012/RS-1012A | Vector Boolean Operations / precision correction | Completed | `src/geometry/PathBoolean.js`; commits `a60f3c3`, `c34a4b0` |
| RS-1013 | Variable Stone Sizes | Completed | `src/renderer/StoneSizes.js`; commit `ab543a2` |
| RS-1014 | — | N/A | No spec, no commit, no reference anywhere — a skipped number, not a lost deliverable |
| RS-1015 | Design Library | Completed | `src/library/**`; commit `b5c8ad1`; full suite passing |
| UI-001 (+A/B) | Complete Redesign | Completed | commits `232fff4`, `cbba6f0` |
| RS-2000 | MVP Stabilization & Validation | Completed | `TASK_RESULT.md`: "READY FOR MVP RELEASE"; merge `44e6d97` |
| **S-004** | "Duplicated text in some 3D preview cases" | **Closed — fixed by RS-1006A, never formally relabeled** | See below |

## S-004 — dedicated investigation

S-004 was **never chartered as its own milestone** — no `S-004-*.md` spec file exists anywhere in
the repository's history. It first appears as a bare label in `RS-1007-CrystalColorLibrary.md`
(written immediately after RS-1006A merged), describing it as "a geometry/material defect, unrelated
to color data" — the same category of defect RS-1006A's own spec had just described and fixed one
commit earlier ("Tumbler/mug duplicated artwork": `side: THREE.DoubleSide` on an open hollow
single-wall mesh let the interior backface render the same design texture a second time, read as
duplicated/mirrored artwork; fixed by switching to `THREE.FrontSide` plus closing the mesh's base).

Three independent lines of evidence converge on the same conclusion:

1. **Static**: `grep -rn "DoubleSide" src/` returns zero results anywhere in the current tree;
   `THREE.FrontSide` appears exactly once, at `src/preview3d/ObjectGeometryBuilder.js:75`, with an
   explicit comment crediting RS-1006A. A regression test in `tools/test-object-geometry-builder.mjs`
   explicitly guards "body material is FrontSide (not DoubleSide) ... regression guard for the
   tumbler/mug duplicated-artwork defect," and it passes.
2. **Architectural**: `src/preview3d/StoneLayoutTexture.js` draws one shared canvas texture purely
   from `StoneLayout` — a flat list of positioned/colored stones with **no awareness of originating
   layer type**. Text, shapes, SVG, and Image Trace layers all become identical stone records before
   reaching the 3D texture step, so there is no separate code path where a "text-only" duplication bug
   could live independent of the general "artwork duplication" bug RS-1006A already fixed.
3. **Live reproduction attempt (this audit)**: a text-bearing project, switched through Mug → Straight
   Tumbler (full wrap) → Bottle (full wrap), viewed from Front/Left/Right/Back and at 60°
   rotation increments, produced **no duplicated, mirrored, or ghosted text** at any angle — including
   the exact "Tumbler [...] the angle that previously showed duplicated artwork" view called out by
   name in RS-1006A's own spec.

**Conclusion: S-004 is CLOSED.** It was almost certainly the same `DoubleSide` backface-duplication
defect RS-1006A fixed, first observed and reported using a text-containing test design (hence the
"duplicated text" wording), assigned a tracking label after the fact by whoever wrote RS-1007, and
then copy-pasted forward as unexamined boilerplate through RS-1008/1008A/1009/1010 without anyone
re-checking whether the already-shipped fix had resolved it. Tellingly, RS-2000 — the most recent,
most thorough stabilization pass — drops the "S-004" line entirely from its Known Limitations,
consistent with (though not itself proof of) the item having become moot. **Action: delete the
"S-004 (duplicated text...)" line from any doc that still repeats it** (it currently appears in nowhere
still-active; the last live spec to mention it is RS-1010) and close the label formally. Folded into
RS-2005 below rather than given its own milestone, since it is a one-line doc edit, not engineering
work.

## Anomalies found in the S-project ledger

- **"S-003" was reused for two unrelated defects** (a view-button rotation-sync fix inside the S-001
  spec, and the unrelated "silent last-layer-deletion" fix in commit `cd7906c`) — both are correctly
  fixed, but the shared ID makes historical tracking ambiguous.
- **"S-002" was never an independent milestone** — it's a sub-item inside the S-001 spec/commit, not
  a separate charter, unlike S-004 which was treated as if it were a tracked item despite never
  getting a spec file. Recommend that any future "S-" prefixed defect always get a one-paragraph
  `S-00N-*.md` file at the moment it's first reported, even if the fix lands same-day — this ledger's
  ambiguity is entirely a product of skipping that step for S-002/S-003/S-004.

---

# Part 6 — Claude's Improvement Proposals

Every proposal below is grounded in a specific file/line/behavior found during this audit — none are
speculative feature additions.

### Proposal A — Reconcile the two project/layer schemas

- **Problem**: `src/core/Project.js`/`Layer.js` implement the documented Project Model (validated,
  serializable, mm-only) but are never imported by the live app; `app.js` maintains its own parallel
  ad hoc schema. This has been true and documented since RS-0003.5B3.
- **Evidence**: `tools/test-app-module-migration.mjs`'s import allowlist explicitly excludes
  `src/core/**`; `app.js`'s `defaultProject()` and every layer-mutation function build/edit a plain
  object independently of `src/core/**`'s validation.
- **User benefit**: none directly visible to a user today (the app works), but every future milestone
  that touches "the project" pays a tax reasoning about which of two models applies, and validation
  improvements (Proposal B) are blocked on this.
- **Architecture impact**: large — touches every layer-mutation call site in `app.js`. Must preserve
  byte-identical save/load behavior for existing Project JSON files.
- **Compatibility risk**: high if rushed, low if done incrementally with the existing `validateProject
  ()` round-trip tests as the safety net (already exercised by `tools/test-production-export
  -validation.mjs`).
- **Implementation complexity**: high — this is why RS-2000 correctly scoped it out as "a dedicated
  migration milestone," not a stabilization fix.

### Proposal B — A real Validation Engine against the live project

- **Problem**: the only implemented validation (`src/core/Project.js.validate()`) protects an object
  no user edits. There is no duplicate-layer-id check, no missing-font check, no overlap check against
  what actually ships to Export/Production Sheet.
- **Evidence**: `docs/ARCHITECTURE.md`'s own "Validation Engine" section: "not implemented as a
  dedicated module... this validation does not currently run against anything the live app edits."
- **User benefit**: a manufacturing tool (per `docs/PRODUCT_VISION.md`: "reduce the time and mistakes
  required to create production-ready rhinestone layouts") that cannot currently catch a duplicate
  layer id or a missing font before a customer generates a Production Sheet.
- **Architecture impact**: medium — a new validation pass reading the live project object, ideally
  gated behind Proposal A's schema so it validates one canonical shape rather than two.
- **Compatibility risk**: low — additive checks, surfaced the same way existing `validation-message`
  elements already work.
- **Implementation complexity**: medium, once Proposal A lands; higher (and duplicative) if attempted
  against the ad hoc schema first and then re-done after Proposal A.

### Proposal C — Fix the Boolean-Ops-selection dialog-ordering problem

- **Problem**: the Shapes dialog's own hint text tells the user to select layers via the canvas or
  Layers list, but the dialog itself, being a full-viewport modal, blocks pointer access to both.
- **Evidence**: live `elementFromPoint()` check (Part 1.1/2) confirmed the modal intercepts clicks
  over the Layers list; `index.html:188` (`.lightbox-overlay { position:fixed; inset:0; ... z-index:
  100 }`) confirms this is structural to every lightbox, not specific to Shapes.
- **User benefit**: removes a real "select first, then remember to reopen the dialog" round-trip for
  the exact workflow (combining layers) the dialog exists to serve.
- **Architecture impact**: small and localized to `src/ui/Lightbox.js`/`index.html` styling — e.g., a
  variant that doesn't block the sidebar, or an in-dialog layer-picker that doesn't require the canvas
  at all.
- **Compatibility risk**: low — UI-only, no schema/export impact.
- **Implementation complexity**: low-medium.

### Proposal D — Curved text should default to an arc, not a circle

- **Problem**: enabling Curved Text defaults to `curveSweepAngleDeg=360`, producing a closed circle on
  first toggle rather than the far more common "text arcing across a design" look.
- **Evidence**: live reproduction (Part 2, finding 1); defaults visible in `index.html:434`
  (`value="360"`).
- **User benefit**: better first impression of a marquee feature (RS-1003); avoids "this looks
  broken" reactions to a working feature.
- **Architecture impact**: none — a single default-value change plus, optionally, a smarter default
  (e.g., scale sweep to the text's natural arc length at the given radius).
- **Compatibility risk**: none — only affects the value pre-filled for a newly-toggled-on curve, not
  saved projects (which already store their own explicit sweep angle).
- **Implementation complexity**: trivial.

### Proposal E — Retire the last few small internal inconsistencies in one pass

- **Problem**: several small, already-identified inconsistencies have accumulated (svg `mode` vs.
  `fillMode`; `StoneColors.js` shim; font manifest `enabled` flag not gating `getFont()`; RobotoMono
  placeholder stub; wall-taper math duplicated between `CupRenderer`/`ObjectGeometryBuilder`; no test
  for `ImagePreviewRender.maskFieldToRgba()`; stale `S-004` doc line; stale `PRODUCT_ROADMAP.md`/
  `BACKLOG.md`).
- **Evidence**: each cited individually in Part 1.
- **User benefit**: indirect (maintainability), except the `BACKLOG.md`/`PRODUCT_ROADMAP.md` staleness
  which directly misleads anyone (including future AI engineers) planning from those files.
- **Architecture impact**: none of these touch the schema or the Geometry Engine; all are internal or
  additive (one new shared assertion helper, one new test, one doc pass).
- **Compatibility risk**: near-zero if the `mode`→`fillMode` rename keeps a load-time alias for
  existing saved SVG layers (the same pattern RS-2000 already used for `fillMode`/`mode` round-trip
  safety).
- **Implementation complexity**: low, individually; bundled because none is worth its own milestone.

---

# Part 7 — Roadmap (Version 1.x)

Grouped into coherent, user-facing (or foundation-for-user-facing) milestones — not one per finding.
**RS-2001 is reserved for the Gallery & Acceptance Suite**, per instruction, and is placed first in
the sequence since it converts the existing ad hoc `examples/*.rhs` fixture set into a formal,
browsable acceptance surface that subsequent milestones (especially RS-2002) should be validated
against.

### RS-2001 — Gallery & Acceptance Suite *(reserved)*

- **Purpose**: convert the existing 24 `examples/*.rhs` fixtures and their committed baselines into a
  formal, browsable acceptance gallery, raising the bar for what "regression-safe" means going into
  further schema/validation work.
- **Problems solved**: today, fixture verification is a `npm test` pass/fail with no visual gallery a
  human (or a future milestone's reviewer) can browse; no single place shows "here is every supported
  layer type/product/wrap combination, rendered."
- **Included work**: reserved — full scope out of this audit's charter.
- **Dependencies**: none (builds on existing `examples/**`/`tools/test-examples-regression.mjs`).
- **Estimated complexity**: not scoped here.
- **Acceptance criteria**: not scoped here.

### RS-2002 — Project/Layer Schema Reconciliation

- **Purpose**: converge `app.js`'s live ad hoc project schema and `src/core/Project.js`/`Layer.js`
  into one real, validated model.
- **Problems solved**: Proposal A; unblocks RS-2003 (Validation Engine) from having to choose which
  of two schemas to validate.
- **Included work**: migrate `app.js`'s layer-mutation call sites onto `src/core/**` (or formally
  retire `src/core/**` in favor of a hardened version of `app.js`'s schema — a decision this audit
  does not make, since it requires a design call outside audit scope); full backward-compatible
  Project JSON load/save.
- **Architecture impact**: large, central.
- **Dependencies**: none blocking; should run before RS-2003.
- **Estimated complexity**: High.
- **Acceptance criteria**: every pre-existing `examples/*.rhs` and hand-saved Project JSON loads
  byte-identical to today; exactly one project/layer model remains referenced from `app.js`;
  `tools/test-app-module-migration.mjs`'s allowlist updated to reflect the new single import path.

### RS-2003 — Live Validation Engine

- **Purpose**: implement Proposal B against the (post-RS-2002) single canonical project model.
- **Problems solved**: duplicate layer ids, missing-font, and overlap conditions currently have no
  engine-level check before export/production-sheet generation.
- **Included work**: duplicate-id detection, canvas-bounds checks, missing/disabled-font detection
  (also closes the `enabled`-flag inconsistency from Proposal E), surfaced via the existing
  `validation-message` UI pattern.
- **Architecture impact**: medium; new validation pass, no renderer/exporter changes.
- **Dependencies**: RS-2002 (schema reconciliation) — doing this first against the ad hoc schema
  would mean redoing it after RS-2002.
- **Estimated complexity**: Medium.
- **Acceptance criteria**: a project with a duplicate layer id or a disabled/missing font surfaces a
  clear validation message before export; no false positives against any of the 24 `examples/*.rhs`
  fixtures.

### RS-2004 — Multi-Select & Shape-Combination Workflow Fix

- **Purpose**: fix Proposal C (Boolean Ops dialog-ordering) and Proposal D (curved-text default) as
  one coherent "editing workflow polish" milestone — both are corrections to how existing features are
  reached, not new features.
- **Problems solved**: the unfollowable-from-inside-the-dialog Boolean Ops instructions; the
  surprising full-circle curved-text default.
- **Included work**: make the Layers list reachable while a lightbox is open (or redesign the Boolean
  Ops entry point so selection happens inside the dialog); change curved-text's default sweep angle to
  an arc-like value.
- **Architecture impact**: small, contained to `src/ui/Lightbox.js`/`index.html`/`app.js` UI wiring.
- **Dependencies**: none.
- **Estimated complexity**: Low-Medium.
- **Acceptance criteria**: a user can select 2+ layers and reach a working Union/Subtract/Intersect/
  Exclude control without closing and reopening a dialog; a newly-curved text layer's default renders
  as a legible arc, not a closed circle.

### RS-2005 — Internal Consistency & Hygiene Pass

- **Purpose**: bundle every small, already-fully-diagnosed internal inconsistency (Proposal E) into
  one pass, plus formally close the S-004 label.
- **Problems solved**: svg `mode`/`fillMode` naming split; `StoneColors.js` shim; font `enabled` flag
  semantics tightened (or explicitly documented as intentionally permissive) alongside the
  RoboloMono placeholder stub's disposition; `CupRenderer`/`ObjectGeometryBuilder` wall-taper math
  unified behind one shared helper; a test added for `ImagePreviewRender.maskFieldToRgba()`; the
  stale S-004 doc line removed; `PRODUCT_ROADMAP.md`/`BACKLOG.md` refreshed to reflect what's actually
  shipped.
- **Included work**: see above — all independently small, none individually worth a milestone.
- **Architecture impact**: none structural; a shared numeric-assertion helper is the only new shared
  module this introduces.
- **Dependencies**: none.
- **Estimated complexity**: Low.
- **Acceptance criteria**: `npm test` still green; `mode`/`fillMode` rename preserves old saved SVG
  layers via a load-time alias; `BACKLOG.md` accurately lists completed vs. open items.

### RS-2006 — Contour Fill Performance Optimization

- **Purpose**: address RS-2000's own flagged finding that Contour Fill on text layers (~750ms) is
  5-7x slower than every other fill mode.
- **Problems solved**: the one measured operation RS-2000 itself flagged as "could read as laggy
  during live editing."
- **Included work**: profile and optimize `ContourRingSampler.js`'s text-layer path specifically;
  correctness is not in question, only speed.
- **Architecture impact**: contained to one file; no schema/API change expected.
- **Dependencies**: none.
- **Estimated complexity**: Medium (perf work with an unknown root cause until profiled).
- **Acceptance criteria**: Contour Fill on a representative text layer completes within roughly the
  same order of magnitude as the other fill modes, with `tools/measure-performance.mjs` re-run to
  confirm.

### RS-2007 — Manufacturing Export Expansion

- **Purpose**: deliver the remaining `docs/PRODUCT_ROADMAP.md` "Version 1.1" items that are still
  genuinely open (batch export, print layout / manufacturing reports) plus DXF export, which
  `docs/ARCHITECTURE.md`'s own "Future Direction" section has listed as "not started" since the
  document's earliest revisions.
- **Problems solved**: closes out the one category of planned-but-never-built feature this audit found
  clear, repeated, pre-existing product intent for (not a new invention — DXF/manufacturing reports
  are named in `docs/ARCHITECTURE.md` itself, multiple specs' "candidates for next milestone" sections,
  and `docs/PRODUCT_ROADMAP.md`).
- **Included work**: a `src/export/**` DXF exporter (parallel to the existing SVG/PDF exporters, same
  "no business logic in exporters" rule); a batch/multi-project export flow; a print-layout mode for
  Production Sheet (multiple designs per page).
- **Architecture impact**: medium — one new exporter module, extends the existing Export/Production
  Sheet dialogs; no Geometry Engine changes expected (exporters consume `StoneLayout`, same as today).
- **Dependencies**: none blocking, though should follow RS-2002 if DXF export needs to read
  project-level metadata that's currently split across two schemas.
- **Estimated complexity**: Medium-High (three distinct deliverables bundled because they're the same
  "get more out the door" user job).
- **Acceptance criteria**: a DXF file opens correctly in at least one common CAD/vector tool; batch
  export produces N export sets from N saved projects/Design Library items in one action; a
  Production Sheet can lay out more than one design per physical page.

### RS-2008 — Additional Product Templates

- **Purpose**: `docs/ARCHITECTURE.md`'s own "Product Plugins" section lists Wine Glass alongside
  Mug/Tumbler/Bottle as an intended example product — only the latter three are implemented
  (`src/products/ObjectTemplate.js`'s registry has exactly three entries).
- **Problems solved**: closes the gap between the architecture doc's own stated product-plugin
  examples and what's actually registered.
- **Included work**: one new `ObjectTemplate` entry (Wine Glass) plus matching `CupRenderer`/
  `ObjectGeometryBuilder` silhouette support, following the exact pattern RS-1004 already established
  for Tumbler/Bottle (shared frustum + stone-wrap-placement math, no new rendering architecture).
- **Architecture impact**: low — additive, follows an established plugin pattern exactly.
- **Dependencies**: none.
- **Estimated complexity**: Low-Medium.
- **Acceptance criteria**: Wine Glass appears in Object Type selection, produces a distinct
  recognizable silhouette in both 2D safe-area guide and 3D preview, and passes the same
  bounding-box/UV regression pattern RS-1006A established for the other three templates.

### RS-2009 — `app.js` Orchestration Decomposition

- **Purpose**: address the one legitimate long-term maintainability concern `TASK_RESULT.md` itself
  names — `app.js`/`index.html`'s monolithic structure — without changing any behavior.
- **Problems solved**: `app.js` is 1,259 dense lines mixing ad hoc project state, a local
  `GeometryEngine` bridge, editor-overlay drawing, canvas lifecycle, export wiring, and UI event
  wiring in one file/scope, as this audit's own module-size review confirms.
- **Included work**: split `app.js` into cohesive internal sub-modules (state, bridge/generation,
  overlay drawing, export wiring, UI wiring) that `app.js` itself composes — a pure refactor, gated
  entirely on `npm test` passing unmodified and byte-identical behavior in the browser-verification
  pass.
- **Architecture impact**: contained entirely within the orchestration layer; `src/**`'s permanent
  modules are untouched by definition (this is explicitly not the RS-2002 schema work).
- **Dependencies**: best done after RS-2002 (no benefit to splitting the file around a schema that's
  about to be replaced).
- **Estimated complexity**: Medium (mechanical but large in surface area).
- **Acceptance criteria**: `npm test` passes unmodified; every existing structural-guard test
  (`tools/test-app-module-migration.mjs` and friends) still passes or is updated to match the new
  (still-compliant) import shape; no user-visible behavior change in the full browser-verification
  pass.

*(Ten milestones total: RS-2001 through RS-2009, with RS-2001 reserved per instruction. "AI-assisted
design" — the one remaining item in `docs/ARCHITECTURE.md`'s "Future Direction" list — is deliberately
**not** given a milestone here; see Part 8, Rejected.)*

---

# Part 8 — Prioritization

| Item | Classification | Reasoning |
|---|---|---|
| RS-2002 Schema Reconciliation | **P1** | Not a release blocker (app works today), but it blocks real validation and is the most-repeated piece of debt across every milestone since RS-0003.5B3. |
| RS-2003 Validation Engine | **P1** | Directly serves the stated product vision ("reduce mistakes"); currently zero live validation exists. |
| RS-2004 Boolean-ops/curve-default fix | **P1** | Small effort, fixes a workflow the product explicitly built (Boolean Ops) but currently undercuts via dialog mechanics; high value-to-effort ratio. |
| RS-2005 Hygiene pass | **P2** | Real but low-severity items; no user ever hits most of these directly. |
| RS-2006 Contour Fill performance | **P2** | Confirmed correct output, only a speed concern, and only in one specific fill+layer-type combination. |
| RS-2007 Manufacturing export expansion | **P2** | Clear, repeatedly-stated product intent (DXF/manufacturing reports/batch export all pre-exist as named "candidates"/roadmap items), but no user-facing defect blocks it from waiting. |
| RS-2008 Wine Glass template | **P3** | Nice-to-have completeness against the architecture doc's own example list; no evidence of customer demand found in this audit beyond the doc mentioning it. |
| RS-2009 app.js decomposition | **P3** | Pure maintainability; explicitly called "not a functional defect" in RS-2000's own TASK_RESULT.md. |
| RS-2001 Gallery & Acceptance Suite | **Not classified here** | Reserved per instruction; scope not defined by this audit. |
| Stale `S-004` doc line / `BACKLOG.md`/`PRODUCT_ROADMAP.md` | **P2**, bundled into RS-2005 | Costs nothing to fix, actively misleads future contributors if left. |
| "AI-assisted design" | **Reject (for now)** | See below. |

### Rejected

- **"AI-assisted design"** (listed as "not started" in `docs/ARCHITECTURE.md`'s "Future Direction").
  Rejected from this roadmap not because it's a bad idea, but because there is no repository evidence
  of what it would even mean in this product (no spec, no user story, no prior discussion beyond a
  four-word bullet) — building a milestone plan for it here would be exactly the "speculative design
  without repository evidence" this audit was explicitly told not to produce. Recommend it stay
  unscheduled until a concrete product brief exists.
- **A dedicated DXF-only or reports-only milestone, split out from RS-2007**: considered and rejected
  in favor of bundling — DXF export, batch export, and print-layout all serve the same "get more
  production output out the door" user job and share the Export/Production Sheet dialog surface;
  splitting them would violate the "one milestone, one complete user-facing improvement" instruction.
- **A standalone "rename `mode` to `fillMode`" milestone**: rejected as its own item — real but too
  small to be "one complete user-facing improvement" on its own; bundled into RS-2005.
- **Re-litigating S-001/S-002/S-003**: all three are verified fixed with passing regression tests;
  no repository evidence supports reopening any of them.

---

# Part 9 — Browser Findings

- Zero console errors or thrown exceptions across every live pass performed (initial load, text
  editing, curve toggling, undo/redo, tab switching, object-template switching across all three
  templates and all wrap modes, 3D rotation sweeps, Design Library/Export/Production Sheet/Settings
  dialog opens).
- The RS-1006A duplicate-artwork fix holds under live re-verification at every angle tested,
  including the specific "previously duplicated" tumbler angle named in that milestone's own spec.
- The lightbox-blocks-full-viewport behavior (Part 1.1/2/6-C) was confirmed programmatically via
  `document.elementFromPoint()`, not just visually — a reliable, reproducible finding.
- One live check (a synthetic `PointerEvent`-based canvas drag test on the text layer, attempting to
  verify whether `docs/ARCHITECTURE.md`'s "text layers... not draggable" claim is still accurate) was
  **inconclusive** — the synthetic event sequence did not reproduce with enough fidelity to trust
  either a positive or negative result. This is reported honestly rather than asserted either way;
  it should be re-checked with real mouse input (or Input-domain CDP mouse events with correct
  `button`/`buttons` fields) before anyone treats that ARCHITECTURE.md line as current fact.

---

# Part 10 — Performance Observations

No new performance measurement was run in this audit (no source changed, so RS-2000's own
`tools/measure-performance.mjs` table stands unchanged). The one finding worth carrying forward:
**Contour Fill on text layers (~750ms) is 5-7x slower than every other fill-mode/layer-type
combination measured**, correct in output but the only operation RS-2000 itself flagged as
potentially perceptible during live editing. See RS-2006.

---

# Part 11 — Remaining Technical Debt (summary)

1. Two unreconciled project/layer schemas (RS-2002).
2. No live Validation Engine (RS-2003).
3. Lightbox-blocks-full-viewport UI mechanics (RS-2004).
4. Curved-text default sweep angle (RS-2004).
5. Font manifest `enabled` flag not enforced; RobotoMono placeholder stub (RS-2005).
6. `mode`/`fillMode` naming split; `StoneColors.js` shim (RS-2005).
7. Wall-taper math duplicated between 2D/3D renderers (RS-2005).
8. `ImagePreviewRender.maskFieldToRgba()` untested (RS-2005).
9. Stale `S-004` doc references; stale `BACKLOG.md`/`PRODUCT_ROADMAP.md` (RS-2005).
10. Contour Fill performance on text layers (RS-2006).
11. `app.js` monolithic structure (RS-2009) — explicitly not a functional defect, tracked for
    long-term maintainability only.

None of the above is a release blocker; see Part 12.

---

# Part 12 — Recommended Milestone Sequence (next ~10)

1. **RS-2001** — Gallery & Acceptance Suite *(reserved)*
2. **RS-2002** — Project/Layer Schema Reconciliation
3. **RS-2003** — Live Validation Engine
4. **RS-2004** — Multi-Select & Shape-Combination Workflow Fix
5. **RS-2005** — Internal Consistency & Hygiene Pass
6. **RS-2006** — Contour Fill Performance Optimization
7. **RS-2007** — Manufacturing Export Expansion (DXF / batch / print layout)
8. **RS-2008** — Additional Product Templates (Wine Glass)
9. **RS-2009** — `app.js` Orchestration Decomposition

(Nine substantive milestones plus the reserved RS-2001 — "approximately 10" as requested. RS-2004/
RS-2005 could run before or interleaved with RS-2002/RS-2003 with no dependency conflict, since they
touch UI mechanics and hygiene items respectively, not the schema; the ordering above optimizes for
"unblock the highest-value structural work first.")

---

# Part 13 — Items Explicitly Rejected

See Part 8 "Rejected" for full reasoning. Summary: **"AI-assisted design"** (no repository evidence of
scope — would be speculative), a **standalone DXF-only milestone** (bundled into RS-2007 instead), a
**standalone `mode`/`fillMode` rename milestone** (bundled into RS-2005 instead), and **reopening
S-001/S-002/S-003** (all verified fixed, no evidence to reopen).

---

# Part 14 — Release Readiness Recommendation

**Is MVP truly complete?** Yes, for what MVP was scoped to mean. RS-2000's own validation (60 test
suites/756 assertions, 9/9 deep-workflow browser checks, 10/10 fixture smoke checks, zero console
errors) stands unchallenged by this audit — nothing found here contradicts "READY FOR MVP RELEASE."
This audit's own live re-verification (S-004 reproduction attempt, full product-workflow pass) found
zero console errors and zero functional regressions.

**Is RS-2001 the correct next milestone?** As the reserved next ID, yes for sequencing — but this
audit recommends it run **alongside, not instead of**, addressing RS-2004 (the Boolean-Ops
dialog-ordering bug and curved-text default) first or in parallel, since both are small, high-value,
already-diagnosed fixes that a Gallery & Acceptance Suite would otherwise end up cataloging as "known
issues" in its own gallery on day one.

**Recommendation: Proceed to RS-2001, with RS-2004 run in parallel or immediately before it.**
Do not perform additional MVP stabilization for its own sake — RS-2000 already did that work
thoroughly and this audit's independent re-verification (including the specific, previously-uncertain
S-004 question) did not surface a defect serious enough to justify delaying forward progress. The
two-schema architectural debt (RS-2002) is real but has been correctly triaged as post-MVP scope
since RS-0003.5B3 and does not block a v1.x roadmap from starting — it should be the **first**
substantive engineering milestone after RS-2001, not a precondition for it.

---

# Part 15 — Product Owner Review (separate perspective, mandatory second pass)

Everything above this section was written as an engineer/auditor: is the code correct, is the
architecture sound, is a defect really fixed. This section deliberately sets that lens aside and asks
a different question: **if I owned this as a commercial product and had been living in it for a
week filling real customer orders, what would bug me, what would I ask for, and what would make me
tell a friend about it?** Every item below is still grounded in something actually observed in this
repository or this audit's live browser pass — not invented — but the judgment is commercial, not
architectural.

## What would I improve next?

### 1. The font library is too small to sell — and the app's own data admits it isn't finished

- **Problem**: exactly two usable fonts exist (Courier Prime — monospace, Great Vibes — script). The
  third registered font (RobotoMono) is a 14-byte stub. More tellingly, `assets/fonts/manifest.json`
  labels **all three** entries, including the two that work, as `"Placeholder registry entry. Add the
  font file before enabling OpenType rendering."` — the font library was never actually finished, just
  left in a state good enough to demo.
- **Why users would care**: text (names, monograms, initials) is the primary product this app exists
  to make. A rhinestone personalization business's very first question from a customer is "what
  fonts/styles do you offer?" Two fonts — one monospace, one script — is a portfolio a real shop
  would be embarrassed to show.
- **Expected user value**: high — directly expands what customers can sell, not just how it feels to
  use.
- **Engineering effort**: Low-Medium — the font *infrastructure* is already generic and provider-based
  (`docs/ARCHITECTURE.md`: "Fonts are providers"); this is materially "add real, licensed font files
  and manifest entries," not new architecture.
- **Implementation risk**: Low — additive, no schema change.
- **Recommended priority**: **P1**.

### 2. Every product template is a cylinder — there's no flat-good template

- **Problem**: `src/products/ObjectTemplate.js`'s registry has exactly three entries — Mug, Straight
  Tumbler, Bottle — all wrap/cylindrical products. There is no flat template (t-shirt/hoodie transfer,
  tote bag, car decal, phone case) at all.
- **Why users would care**: `docs/PRODUCT_VISION.md` names "custom gift businesses" and "professional
  rhinestone businesses" as the target customer — in the real rhinestone/bling industry, flat garment
  transfers (shirts especially) are at least as large a product category as drinkware, arguably
  larger. A shop that does both drinkware and shirts today has to use a different tool (or fake a
  shirt with "Front only" wrap mode and the wrong safe-area shape) for half their business.
- **Expected user value**: very high — this is plausibly the single biggest addressable-market gap in
  the current product, not a polish item.
- **Engineering effort**: Medium — reuses the exact plugin pattern RS-1004 already established
  (template record → safe area → preview silhouette → `CupRenderer`/`ObjectGeometryBuilder` support),
  but a flat/non-wrap preview is a new geometry case, not just new registry data.
- **Implementation risk**: Medium — first non-cylindrical preview; needs its own visual QA pass.
- **Recommended priority**: **P1**.

### 3. The Design Library lives only in one browser's `localStorage` — with no export/backup

- **Problem**: confirmed in code (`src/library/LibraryStorageAdapter.js`) — the live app wires
  `createLocalStorageAdapter()`, storing the entire design catalog as one JSON blob in that browser
  profile's `localStorage`. There is no "export whole library" / "import whole library" action
  anywhere in the Design Library dialog — only per-item "New Project From This."
- **Why users would care**: a shop that has spent months building a catalog of saved designs loses
  all of it the moment they clear browser data, switch computers, reinstall the OS, or their browser
  profile corrupts — with no warning and no built-in recovery path. That is an existential risk for a
  repeat-production business, and it will be discovered at the worst possible time (not on day one).
- **Expected user value**: high — this is a trust/reliability issue, and those generate the loudest
  complaints and the most churn of any category.
- **Engineering effort**: Low for the practical stopgap (a "Backup Library" button that downloads the
  same JSON blob `LibraryStorageAdapter` already produces, and a matching "Restore from backup" file
  import — both are trivial once the existing `save()`/`load()` shape is exposed to a download/upload
  button, mirroring the Project JSON export/import pattern already built). High only if the ask is
  full multi-device cloud sync with accounts — not required to solve the actual risk.
- **Implementation risk**: Low for the backup/restore stopgap.
- **Recommended priority**: **P1** for backup/restore; **P3** for true cloud sync/accounts (a much
  bigger, optional, later bet).

### 4. No autosave, no crash recovery

- **Problem**: "Save Project" is an explicit, manual action that downloads a file; the dirty
  indicator (`index.html:269`) shows "Unsaved changes" but nothing protects the user if the tab
  closes, crashes, or the laptop dies before they click Save.
- **Why users would care**: losing real, uncompensated work time (stone placement, careful alignment)
  to an accidental tab close is a classic "this app burned me once" moment that a customer remembers
  far longer than any feature they liked.
- **Expected user value**: high, and cheap to earn — this is the kind of thing that turns into a
  five-star review ("it even saved my work when Chrome crashed") instead of a support ticket.
- **Engineering effort**: Low-Medium — periodic silent snapshot to `localStorage`/IndexedDB plus a
  "Restore unsaved session?" prompt on next load; the app already has an in-memory `project` object
  and a dirty-state flag to key off of.
- **Implementation risk**: Low.
- **Recommended priority**: **P1**.

### 5. Curved text's first impression is a surprise, not a delight *(cross-references the engineering audit's Part 2/6)*

- **Problem**: toggling Curved Text on defaults to a full 360° circle, confirmed live.
- **Why users would care**: this is one of the app's headline differentiators (RS-1003 shipped it as
  its own milestone) — a customer's very first try of it produces something that looks broken, not
  impressive.
- **Expected user value**: medium-high relative to effort — first impressions of a marquee feature
  are disproportionately memorable.
- **Engineering effort**: Trivial (a default-value change).
- **Implementation risk**: None.
- **Recommended priority**: **P1**.

### 6. Combining shapes (Boolean Ops) doesn't work the way its own dialog tells you to *(cross-references engineering audit's Part 2/6-C)*

- **Problem**: confirmed live via `elementFromPoint()` — the Shapes dialog blocks the exact Layers
  list its own hint text tells you to use.
- **Why users would care**: this reads as "the app is telling me to do something the app won't let me
  do," which is a specific, memorable kind of frustration — worse than a missing feature, because it
  looks like a bug in a feature that clearly exists and was clearly designed.
- **Expected user value**: medium-high — removes a specific, repeatable "wait, why isn't this
  working" moment for anyone who tries to combine two shapes (a common ask — cookie-cutter
  monogram-in-a-shape designs are a staple of this craft).
- **Engineering effort**: Low-Medium.
- **Implementation risk**: Low.
- **Recommended priority**: **P1**.

### 7. No built-in heart, star, or other common craft-shape presets

- **Problem**: the only built-in shapes are Circle and Rectangle (`index.html:467-468`); anything
  else (hearts, stars, ovals) requires an SVG import workaround.
- **Why users would care**: hearts and stars are extremely common secondary motifs in this exact
  craft niche (monogram-plus-heart, holiday stars) — needing to source or draw an SVG for something
  this common is friction a competitor without that gap would win customers on.
- **Expected user value**: medium — speeds up very common designs, doesn't unlock anything
  impossible today (SVG import already covers it).
- **Engineering effort**: Low — same generation pattern circle/rectangle already use.
- **Implementation risk**: Low.
- **Recommended priority**: **P2**.

### 8. Production Sheet reports total stone count and a list of color *names*, but not a per-color/size quantity breakdown

- **Problem**: confirmed in `src/export/ProductionSheetExporter.js` — it computes `stoneCount` and
  `distinctColors` (names only), never a count-per-color-per-size. A shop ordering stones from a
  supplier for a job needs to know "how many of each," not just "which colors are used."
- **Why users would care**: this is the single most natural "week one, doing real production" ask —
  procurement, not inventory management (so it doesn't cross into the product's own declared
  `WONT_BUILD.md` exclusion of ERP/inventory systems — it's a reporting addition to a document the
  app already generates).
- **Expected user value**: medium-high for anyone actually running production, not just designing.
- **Engineering effort**: Low — the data (`stone.color`, `stone.sizeMm`) already exists in the
  `StoneLayout` the Production Sheet already reads; this is a grouping/tally, not new geometry.
- **Implementation risk**: Low.
- **Recommended priority**: **P2**.

### 9. No onboarding beyond a static Help reference and a pre-filled example project

- **Problem**: `index.html`'s Help dialog (line 790+) is a good static reference (keyboard shortcuts,
  a "Getting started" paragraph) but there is no interactive first-run tour, no "start from a
  template/gallery" chooser, and no empty-state guidance — a new user's first launch is simply the
  same "Vitalina Serbin" mug project every time.
- **Why users would care**: a decent default project is a reasonable "look what's possible" choice,
  but it doesn't teach discoverability (e.g., that Shift-click multi-selects, that dragging duplicates
  with Alt, that curve/boolean/fill-mode features exist at all) — those all currently require opening
  Help and reading, which most users won't do unprompted.
- **Expected user value**: medium — mostly affects time-to-first-success for brand-new users, not
  ongoing users.
- **Engineering effort**: Medium (a real tour/coach-mark system) or Low (a single "Tips" dismissible
  banner pointing at 2-3 high-value hidden features) depending on ambition.
- **Implementation risk**: Low for the cheap version.
- **Recommended priority**: **P2**.

### 10. Top-menu icons are raw emoji characters, not a real icon set

- **Problem**: confirmed in `index.html:253-261` — every top-menu button's icon is a literal emoji
  glyph (🅣 ◇ 📚 ⇪ 🖼 ⬇ 🖨 📦 ⚙ ?) rendered via the OS's system emoji font, not an SVG/icon-font set.
- **Why users would care**: emoji rendering varies visibly across Windows/macOS/Linux/browser
  versions (different weight, style, sometimes different glyphs entirely for the same codepoint) — a
  "professional" manufacturing tool (the product's own self-description) having a top menu that looks
  different, and on some platforms slightly cartoonish, per operating system undercuts the polish the
  rest of the app earns (the Export/Production Sheet dialogs are genuinely well-designed).
- **Expected user value**: medium — pure perceived-quality/brand-consistency, no functional change.
- **Engineering effort**: Low-Medium — swap emoji spans for a small inline SVG icon set matching the
  existing minimalist visual language.
- **Implementation risk**: Low.
- **Recommended priority**: **P2**.

### 11. "Design Library" vs. "Project" is two names for adjacent concepts *(cross-references engineering audit's Part 1.4/1.6)*

- **Problem**: the save/reuse feature is branded "Design Library" throughout the UI, but a saved
  library item of kind `'project'` (`src/library/LibraryItem.js:13`) is literally a saved project, and
  the always-visible top-bar action is separately labeled "Save Project."
- **Why users would care**: a new user has to learn that "Design," "Project," and "Layer" are three
  different nouns for closely related things before the mental model clicks — small, but it's exactly
  the kind of soft confusion that shows up in support questions ("what's the difference between saving
  a project and saving to the library?").
- **Expected user value**: low-medium — a copy/terminology fix, not a functional one.
- **Engineering effort**: Low.
- **Implementation risk**: Low.
- **Recommended priority**: **P2**.

### 12. Layer names truncate in the sidebar with no way to see the full name

- **Problem**: confirmed live — "Vitalina Serbin" renders as "Vitalina..." in the Layers list with no
  hover tooltip observed.
- **Why users would care**: a shop naming layers descriptively ("Front text," "Back logo," "Left
  sleeve monogram") loses the ability to tell them apart at a glance — a small but repeated annoyance
  every single session.
- **Expected user value**: low, but very cheap.
- **Engineering effort**: Trivial (a native `title` attribute).
- **Implementation risk**: None.
- **Recommended priority**: **P3** (bundle into whatever hygiene pass happens next — not worth its
  own attention, but essentially free once someone's editing that file for another reason).

## Rejected (product lens)

- **Full inventory/costing/ERP features** (e.g., "how much did this design cost in stones," supplier
  reorder tracking): the product's own `docs/WONT_BUILD.md` explicitly excludes this, and this review
  agrees — it would pull the product away from "manufacturing/design tool" into a different, harder
  category of software. The per-color stone-count breakdown above (item 8) is deliberately kept on the
  right side of that line — it's a report the tool already has the data for, not a new system of
  record.
- **Multi-user/team collaboration** (shared libraries, roles/permissions): no evidence in this audit
  that current customers are a multi-seat studio blocked by its absence; premature ahead of the
  data-safety fixes (items 3-4) that should come first regardless of team size.
- **A visual redesign of the whole UI**: the existing Export/Production Sheet/Settings dialogs are
  already well-designed (clear grouping, honest disabled-state labeling); a full redesign would be
  solving a problem this review didn't find evidence of. The icon-consistency fix (item 10) is a
  targeted swap, not a redesign, and should stay scoped that way.

## Roadmap comparison: engineering vs. product

**They differ, and they differ for a specific, defensible reason.** The engineering audit (Parts 1-14)
was explicitly scoped to correctness, architecture, and debt — "audit-first," grounded strictly in
what already exists, and it was told not to propose speculative features. Under that mandate, it
correctly surfaced the two-schema split and the missing Validation Engine as the highest-priority
items, because those are the largest sources of *risk* in the codebase. Neither of those is something
a customer using the app for a week would ever notice or ask for directly — they're prerequisites for
building things safely, not things that make a shop happier this month.

The product lens asks a different question — not "what's structurally risky" but "what would make a
paying customer's week better, and what would they complain about or ask for next" — and under that
question, four items the engineering roadmap doesn't mention at all rise to the top: font breadth
(item 1), product-template breadth (item 2), design-catalog data safety (item 3), and crash/autosave
protection (item 4). None of these are architecture problems; all four are directly revenue- or
trust-affecting.

Two items appear on **both** roadmaps independently — the curved-text default (item 5 / engineering
Proposal D) and the Boolean Ops dialog-ordering bug (item 6 / engineering Proposal C / RS-2004). That
overlap, reached from two different starting questions, is a good signal these two are genuinely
worth doing first regardless of which lens you trust more.

### The roadmap I would run, if this were my own commercial product

I would not choose one roadmap over the other — I'd interleave them, sequenced by what actually
blocks what:

1. **Ship the two cross-validated quick wins immediately** — curved-text default (item 5) and the
   Boolean Ops dialog fix (item 6/RS-2004). Both are cheap, both are agreed-upon by independent
   analysis, and there's no reason to wait for anything else to land them.
2. **Close the two trust/data-safety gaps next** — Design Library backup/restore (item 3) and
   autosave/crash recovery (item 4). These are the kind of thing that costs a customer relationship
   the one time they're hit, and both are low-medium effort relative to that risk.
3. **Expand the font library** (item 1) in parallel with step 2 — it's independent, low-risk, and
   directly expands what every existing customer can sell starting immediately.
4. **Do the schema reconciliation (engineering RS-2002) before, not after, the flat/apparel template
   (item 2).** This is the one place I'd override a pure "customer value first" instinct: building a
   whole new non-cylindrical product template on top of two competing, unreconciled project schemas
   means doing template work twice. RS-2002 stops being "architecture for its own sake" the moment a
   second major product category is on the roadmap — it becomes the thing that makes item 2 buildable
   once instead of twice.
5. **Validation Engine (RS-2003) rides along with step 4** for the same reason — a new template
   category is exactly when catching duplicate-id/missing-font/bounds problems starts to matter more,
   since there's more surface area for a new user to get wrong.
6. **Then the flat/apparel template (item 2)** — now buildable on one schema with real validation
   underneath it.
7. **Manufacturing export expansion (engineering RS-2007) and the per-color stone breakdown (item 8)**
   together — both serve the same "customers scaling up production" moment, and naturally follow once
   there's a second product category driving more volume.
8. **Everything else** (icon consistency, terminology cleanup, onboarding tour, heart/star shapes,
   Wine Glass template, `app.js` decomposition, remaining hygiene) — genuine backlog, done as
   capacity allows, roughly in the P2/P3 order given above.

The one deliberate change from the engineering-only roadmap: **font breadth and data-safety ship
before the schema migration even starts**, because neither depends on it and both protect or grow
revenue immediately, while the schema migration's value is realized *through* the features built on
top of it (the flat template, real validation) rather than on its own.
