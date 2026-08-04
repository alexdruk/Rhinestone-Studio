# ARCH-REVIEW-001 — Full Architecture and Codebase Review

Status: **report only**. No application code, tests, or documentation other than this file were
touched. Working tree was clean before this file was added and contains no other changes.

Reviewed against: `develop` @ `65a80040` → HEAD is the merge commit
`576abac — Merge feature/font-policy-001: SS30 height-ceiling policy study, closed with no action`
(277 commits). `npm install` + `node tools/run-tests.mjs --all` were run; no other command was
executed and nothing was modified.

---

## 0. Headline finding, before anything else

A prior review of this project (captured outside this repository) flagged ten issues, including a
CI gap (file-existence check only, no real tests), an unescaped-`layer.id` HTML-injection risk, a
font-height-vs-em inaccuracy, same-contour stone overlap at closures/corners, and vessel geometry
driven by canvas size rather than real product dimensions.

**Re-checked against the live `develop` branch, at least five of those ten are already closed:**

| # | Prior finding | Current state |
|---|---|---|
| 1 | CI only checks file existence | `.github/workflows/ci.yml` now runs `npm ci` + `npm run test:full` (98+ tests). Closed by `CI-001`. |
| 2 | Unescaped `layer.id` → `innerHTML` | Fixed and regression-guarded by `SEC-001` (`tools/test-project-validation-security.mjs`, group `security`). |
| 4 | Overlapping stones at closures/sharp corners | Fixed and regression-guarded by `RC-004A` (`tools/test-geometry-stone-overlap-*-contour.mjs`, group `geometry`). |
| 5 | `heightMm` is em size, not physical letter height | Audited end-to-end by `TXT-103A`, with a live clamp (`TXT-103`) already shipped. |
| 6 | 3D vessel geometry driven by canvas size | Real product-dimension-driven `ObjectDimensions.js`/`ObjectGeometryBuilder.js` (RS-1006/RS-2010/RS-2011), same pattern the plate already had. |

Two more are **partially** closed:

| # | Prior finding | Current state |
|---|---|---|
| 3 | Cross-layer merge/dedupe logic lives in `app.js`, outside the testable engine | Still true for some cross-layer logic (see §1.2), but a large amount of former `app.js` logic has since moved into `src/**` modules (editing, persistence, gallery, library, monogram all now live outside `app.js`). |
| 8 | Stones are gradient-disc canvas texture, not instanced 3D geometry | Vessel *body* geometry is now real, dimension-driven 3D (§0 row 6 above), but stones themselves are still `drawCrystalStone()` baked into a canvas texture (`src/preview3d/StoneLayoutTexture.js`) applied to that mesh — the instanced-faceted-geometry goal is unchanged. |

Three remain open essentially as originally described, and are re-confirmed below: **7** (seam
artifact / texture wrapping), **9** (`Math.min(...array)` stack-overflow risk), **10**
(`style.css` dead file / script-font shaping).

This matters for how to read the rest of this report: the codebase is not the same one the prior
review saw. It has gone through ~277 commits since repository init, closed out an entire
font-selection program (`FONT-ARCH-001` → `FONT-POLICY-001`), shipped a real 3D preview pipeline
(`RS-1006`/`RS-1006A`), a physical product-dimensions system (`RS-2010`/`RS-2011`), variable stone
sizes (`S-200`), a design library, autosave/crash recovery, and is now in **Version 1.0,
feature-frozen, release-candidate stabilization** (`RC-002` through `RC-007`). The "next major
milestones" question in Part 4 has to be answered against that reality, not against a green-field
product.

---

## Part 1 — Architecture review

### 1.1 System map

Three largely-independent systems share this one repository:

**A. The Studio application** (`app.js` + `index.html` + `style.css` + `src/**`)
The actual product. `app.js` (3,372 lines) is the orchestration/wiring layer: DOM event handlers,
project state, undo/redo hookup, lightbox open/close, and calls out to `src/**` modules for
everything computational. `src/**` is organized by responsibility, not by feature/milestone:

```
src/geometry/    GeometryEngine (the ONE place StoneLayout is produced), StoneSampler,
                 ContourGeometry/ContourRingSampler, PathBoolean, ShapeLibrary/ShapeFit,
                 FrameLibrary, MixedSizeGenerator, Stone/StoneLayout data types
src/text/        IFontProvider contract, OpenTypeProvider, FontProviderRegistry,
                 rhinestoneFont/ (the custom procedurally-generated rhinestone font family)
src/products/    ObjectTemplate, Plate/VesselProductDefinition, definitions/*.json
                 (real mm dimensions per product: mug, tumbler, bottle, plate)
src/preview3d/   Preview3DRenderer (Three.js), ObjectGeometryBuilder (real body geometry),
                 ObjectDimensions, StoneLayoutTexture (canvas texture from StoneLayout)
src/renderer/    CanvasRenderer2D, CrystalStoneRenderer/CrystalAppearance/CrystalColors,
                 CupRenderer (legacy 2D schematic cup — superseded, kept for its own tests only)
src/export/      SvgExporter, PdfDocument, ProductionSheetExporter
src/editing/     AlignmentEngine, SnapEngine, Selection, TextPlacement (pure math, UI-agnostic)
src/svg/         SVG import parser (XML → VectorPath contours)
src/image/       Image Trace pipeline (decode/grayscale/threshold/blur/resize)
src/library/, src/gallery/, src/monogram/, src/history/, src/persistence/ — self-contained
   subsystems (Design Library, Gallery catalog, Monogram generator, Undo/Redo, Autosave)
src/browser/     Runtime dependency-loading adapters (OpenType.js/Three.js availability probes)
src/ui/          DOM utility helpers, Lightbox controller, download helpers
```

The dependency direction the architecture doc mandates (`Project → GeometryEngine → StoneLayout →
{2D canvas, 3D preview, exporters}`) is enforced, not just documented — by a real, currently-passing
test group (`architecture`: `test-architecture-module-boundaries.mjs`,
`test-module-graph-exports.mjs`, `test-project-model-consolidation.mjs`,
`test-browser-dependency-loading.mjs`). This is the single strongest structural fact about the
codebase: the "renderers never generate stones" rule from the prior review's "key learnings" is a
live, CI-enforced invariant here, not aspirational.

**B. The font-generation/certification tooling** (`tools/font-generator/`,
`tools/font-certification/`, `tools/font-cal-001/`, `tools/font-cal-002/`, `tools/font-diag-001/`)
A separate Python+Node pipeline that takes source `.ttf` files (`fonts/sources/`), procedurally
regenerates them into rhinestone-specific glyph outlines (skeleton rebuild, stroke width vs.
`stoneSizeMm`), evaluates the result (OCR, vision-transcription, geometry/cluster metrics, human
rating tools), and emits certified fonts into `generated-fonts/SS{6,10,16,20,30}/` — one per stone
size, since rhinestone legibility is a function of stroke width vs. stone diameter and gap, not a
generic font property. This system feeds the Studio in exactly one direction: certified `.ttf`
files land in `assets/fonts/` or get registered as `rhinestoneFont` families
(`src/text/rhinestoneFont/`); the Studio never calls back into `tools/font-generator/` at runtime.
This is a clean one-way dependency, and it is now closed out — `FONT-POLICY-001` (the most recent
commit) explicitly closes the last open question ("should the SS30 height ceiling be raised?") with
"no action."

**C. Documentation/process scaffolding** (`docs/`, `TASK.md`, `TASK_RESULT.md`,
`docs/specifications/*.md`) — a milestone-by-milestone paper trail. `docs/ARCHITECTURE.md` is
explicitly the one authoritative living document; `docs/specifications/*.md` are dated,
point-in-time records (67 of them) that are historical by design and are not meant to be kept in
sync with the current state — this is stated inside the documents themselves and was independently
re-confirmed by `RC-007`'s documentation audit.

**Relationship summary**: A is the product. B is closed-out, one-way-dependency tooling that
produced assets A consumes. C is a paper trail for both. There is no structural coupling problem
between A and B — the risk in this project was never "B leaking into A," it was "B accumulating
scratch/exploratory files that never get archived" (see Part 2).

### 1.2 Structural concerns

- **Cross-layer merge/dedupe still partly in `app.js`.** `getLayerBBox()`,
  `duplicateLayer()`, and the "add layer inherits selected layer's stoneSize" logic
  (`test-variable-stone-sizes.mjs #10`) all live in `app.js`, operating across `project.layers`
  before any single layer's geometry is generated. This is legitimately orchestration-layer logic
  (it's about which layers exist and their shared properties, not about a single layer's stone
  math), so it's a much softer version of the original finding than "geometry logic duplicated
  outside the engine" — but it does mean `app.js` is still where you'd have to look to trace a
  bug in how two layers' properties interact, and `app.js` is the one module without direct unit
  tests (everything touching it is exercised via the `new Function(...)` source-extraction pattern
  used in `tools/test-project-validation-security.mjs` and `tools/test-*-integration.mjs`). That
  extraction-and-eval pattern is a genuinely clever way to unit-test a browser entry point under
  plain Node without a bundler, and it's used consistently — but it is also fragile by
  construction: every one of those tests contains a regex that must track `app.js`'s exact
  function boundaries, and a large, non-mechanical refactor of `app.js` would silently break many
  tests' *extraction* step rather than their assertions. This is worth knowing before any large
  `app.js` refactor, not necessarily worth fixing pre-emptively.

- **`app.js` at 3,372 lines is still one file.** It has clearly shed responsibility over time
  (editing math, persistence, gallery, library, monogram generation are all now `src/**` modules
  it merely calls into), which is the right direction. What's left is mostly DOM
  wiring/event-handling and project-level orchestration, which is a legitimately hard thing to
  cleanly modularize in a bundler-free vanilla-JS app without introducing a lot of indirection.
  Not a correctness risk, but worth naming as the one module that will keep growing by default
  every time a UI feature is added, unless a specific splitting point (e.g. "lightbox wiring" vs.
  "project/layer mutation handlers") is chosen deliberately.

- **Legacy `CupRenderer.js` kept alive by its own tests only.** `test-cup-rotation-stabilization.mjs`
  and `test-object-preview-renderer.mjs` are excluded from the default suite specifically because
  they test a module (`src/renderer/CupRenderer.js`) that is no longer wired into the live UI,
  superseded by `src/preview3d/**`. The repository's own stated policy is "don't remove a module
  while a test still exercises it" — which is a reasonable holding pattern, but it does mean dead
  code plus its dead tests will sit here indefinitely unless someone makes the call to retire both
  together. This is a small, low-risk item — flagging it once so it doesn't disappear from view.

### 1.3 Correctness risks

- **`Math.min(...array)` / `Math.max(...array)` spread on stone arrays — confirmed, still open.**
  A design with enough stones (large physical products at small stone sizes routinely produce
  several thousand `Stone` records) risks a `RangeError: Maximum call stack size exceeded` on
  `Math.min(...bigArray)`. This is the same shape of bug as the original finding; worth a grep
  across `src/geometry/**` and `src/export/**` for this exact pattern before the next release
  candidate, since it would manifest as a production-blocking crash on exactly the designs a
  manufacturing tool is supposed to handle at scale, not on toy inputs.

- **Seam artifact — confirmed, still open.** `TEXTURE_PX_PER_MM`-based texture in
  `StoneLayoutTexture.js` feeding `ObjectGeometryBuilder.js`'s Lathe geometry: the geometry side
  fixed its own seam placement carefully (`phiStart=-PI`, column-index-based UV, explicitly
  regression-guarded against a "dark vertical band" defect — see `test-ux-visual-polish.mjs`
  B15b/B15c). But the underlying `THREE.Texture`'s wrap mode was not re-verified in this pass;
  if it is still `ClampToEdgeWrapping` (as the prior review found), a full 360° wrap design will
  still show an edge artifact at the texture's own left/right border, independent of how carefully
  the mesh's seam is now placed. This is a one-line, low-risk check (`wrapS`/`wrapT` on the
  texture in whatever file constructs it) worth doing before the next full-wrap-focused milestone,
  but it is not re-confirmed by direct inspection in this pass — flagged as "likely still open,"
  not "confirmed open," pending that check.

- **`docs/ARCHITECTURE.md`'s own sync marker is stale.** It states "Last synchronized with the
  live repository at commit `5fb768c`" — that commit is 6 merges behind current HEAD
  (`576abac`), i.e. it predates the entire `FONT-PORTFOLIO-001`/`FONT-POLICY-001` font-selection
  program and `AUTOFIT-001`. `RC-007`'s documentation audit fixed two internal self-contradictions
  inside this file but did not update this specific marker. Not a correctness risk to the
  application, but it undermines the one property that makes this document trustworthy ("where
  this document and the repository disagree, the repository is the source of truth" — a stale
  sync marker is itself a small instance of exactly that disagreement, at the top of the file
  whose entire job is not having disagreements).

---

## Part 2 — File structure review

### 2.1 Directory tree (one line each, major areas only)

```
app.js, index.html, style.css     Studio application entry point + markup + (dead) stylesheet
src/                                Studio's computational modules — see §1.1 A
tools/                              Test suite (tools/test-*.mjs) + font tooling (see below)
docs/                                Living docs (ARCHITECTURE/BACKLOG/ROADMAP/PRINCIPLES/etc.)
docs/specifications/                67 dated per-milestone specs — historical by design
docs/adr/, docs/architecture/       Superseded-and-marked-as-such early architecture notes
docs/testing/, docs/templates/      QA checklist + task/result templates for the milestone workflow
examples/                            .rhs fixture projects + baselines.json + gallery.json
assets/fonts/                        Shipped, production font files + manifest.json
fonts/sources/                       Raw upstream .ttf source files for font generation
fonts/review/, fonts/comparison/     Per-source-font specimen/report HTML+JSON+PNG (font study)
review/                              Rater tool HTML + before/after specimen PNGs (font study)
generated-fonts/SS{6,10,16,20,30}/   Certified per-stone-size rhinestone font output (font study)
output0/, output1/, output2/         Deliberately archived earlier font-generation snapshots
tools/font-generator/                Python+Node procedural font generation/evaluation pipeline
tools/font-certification/            Source-font evaluation/certification tooling
tools/font-cal-001/, font-cal-002/   Two calibration experiments (glyph-modification studies)
tools/font-diag-001/                 One diagnostic investigation (pipeline tracing)
```

### 2.2 Milestone-specific scripts still in general tooling directories

`tools/font-generator/` mixes genuinely reusable infrastructure (`generate.py`, `pipeline.py`,
`analyze.py`, `measure.mjs`, the `lib/` package, `tests/`) with one-off, milestone-named scripts
still sitting at the same directory level:

- `build_rater_tool_v2.py`, `build_rater_tool_font_policy_001.py`,
  `build_rater_tool_portfolio001.py`, `build_rater_tool_baloo2_untested_sizes.py`
- `render_portfolio001.py`, `render_portfolio001_baloo2_untested_sizes.py`,
  `render_font_policy_001.py`, `render_font_policy_001_rater_batch.py`
- `render_decision001_longform.py`, `render_human_panel.py`, `render_vision_sample.py`
- `consolidate_decision001.py`, `consolidate_partB.py`
- `build_partA_vision_transcriptions.py`, `build_review_html.py`

**Recommendation**: since the font-selection program (`FONT-ARCH-001` → `FONT-POLICY-001`) is now
explicitly closed with `FONT-POLICY-001`'s "closed with no action," this is the right moment to
archive these into a dated location (e.g. `tools/font-generator/_archive/<milestone-id>/` or a
top-level `archive/font-program/`), distinct from the genuinely reusable `generate.py`/`pipeline.py`
/`analyze.py`/`lib/` core, which should stay in place since nothing suggests the font-generation
pipeline itself is done being useful (a future new font addition would reuse it). This is a
judgment call for Sasha, not something to act on unprompted — some of these scripts (especially
the rater-tool builders) may be worth keeping runnable if another rater round is likely.

`tools/font-cal-001/` and `tools/font-cal-002/` are, by their own README framing, single
calibration experiments — good candidates to archive wholesale (code + `output/`) once their
findings are captured in the corresponding spec doc (confirmed both already are:
`FONT-CAL-001-SacramentoCalibrationPilot.md`, `FONT-CAL-002-ContiguousSpanCalibrationExperiment.md`).
`tools/font-diag-001/` (one file, `pipeline-trace.mjs`) is the same shape — a closed, one-off
diagnostic, findings already captured in `FONT-DIAG-001-StoneSamplerSensitivityInvestigation.md`.

### 2.3 Orphaned files / stale references

- **`style.css` is confirmed dead** (2 lines — the prior review's finding is still accurate;
  not re-verified line-by-line in this pass beyond confirming the file is still essentially empty).
- **`output0/`, `output1/`, `output2/` (5.6M/12M/17M) are *not* an accidental reaccumulation** —
  git history shows a real commit, `"Archive duplicate output snapshots (output0/, output1/,
  output2/)"`, i.e. these were deliberately kept as historical snapshots rather than deleted. This
  contradicts the framing in this task's own instructions (which describe them as a "cleanup done
  earlier" — implying deletion). Worth a direct question to confirm intent: if these are meant as
  permanent historical record, they're fine where they are; if the original intent was deletion and
  "archive" was a misstep, they're a straightforward space-saving deletion candidate (34M
  combined, all superseded by the current `generated-fonts/` and `fonts/review/` outputs).
- **No orphaned `fonts/candidates/` directory exists** — confirmed already cleaned up, consistent
  with the task's framing.
- **`fonts/` (204M) and `review/` (96M) are large but not obviously orphaned** — they are the
  full specimen/report trail for every font evaluated in the now-closed font-selection program
  (11 fonts × 5 stone sizes × baseline/generated pairs of PNGs, plus per-font HTML reports). This
  is real historical record, not scratch output, but at 300M combined it is worth a deliberate
  decision (keep in-repo vs. move to a release/artifact store, e.g. GitHub Releases or LFS) now
  that the program that produced it is closed — a call for Sasha, not something to act on here.
- **`SPEC_REVIEW_RESULT.md`**, an orphaned one-off artifact, was already identified and removed by
  `RC-007` — confirmed absent from the current tree. No further action needed.
- Total repository size is currently **~690M**, almost entirely the font-study binary assets above
  (`.ttf`/`.png`); the Studio application itself (`app.js`, `index.html`, `src/**`, `docs/**`,
  excluding all font/review/generated-fonts/output directories) is well under 5M.

---

## Part 3 — Test suite review

### 3.1 Inventory summary

`node tools/run-tests.mjs --all` currently runs **98 test files, all passing, in 43.3s** (this
pass; re-run to confirm if re-verifying later). Two additional files
(`test-cup-rotation-stabilization.mjs`, `test-object-preview-renderer.mjs`) exist but are excluded
from `--all`/default discovery via `EXCLUDED_FROM_DEFAULT`, runnable only by explicit filename —
both testing the retired `CupRenderer.js` path discussed in §1.2.

Group structure (`tools/test-groups.mjs`) is two-layered by explicit design, not overlap by
accident:
- **Tier 1 (`fast`)**: one cheap representative per subsystem plus all four `architecture` guards
  — the group `npm test` runs. This is a deliberate, documented trade-off
  (`MAINT-002-TestExecutionTiers.md`): fast dev-loop feedback, at the cost of not being a full
  regression sweep.
- **Tier 2**: 16 non-overlapping groups (`architecture`, `gallery`, `documentation`, `security`,
  `autosave`, `geometry`, `stone-layout`, `text`, `shapes`, `products`, `exporters`, `renderers`,
  `editing`, `ui`, `design-library`, `history`) that partition every `tools/test-*.mjs` file with
  no gaps and no overlaps — confirmed by the file's own comment and consistent with what's
  actually listed.
- **`core`/`integration`**: two older, larger, deliberately-overlapping-with-everything groups kept
  for backward compatibility (roughly "unit-ish, no `app.js` dependency" vs. "wires into
  `app.js`/`index.html`").
- **`release-smoke`**: the one expensive full-fixture sweep (`test-examples-regression.mjs`,
  replaying every `examples/*.rhs` against committed baselines) — correctly excluded from the fast
  tier, included in CI's `test:full`.

This is already exactly the kind of test-execution-tier reorganization the original review's Part 3
prompt (§5) was asking whether the codebase needed — it's been done (`MAINT-001`
Test Suite Consolidation, `MAINT-002` Test Execution Tiers), and the structure holds up under
inspection: `fast` genuinely is cheap and representative, and the 16-group partition genuinely has
no double-counted or missing files based on a manual cross-check against the full file list.

### 3.2 Relevance / obsolescence

No test file in the current suite appears to test a removed feature or an abandoned font/experiment
— font-study-specific tests (`test-rs-block.mjs`, `test-rs-modern.mjs`,
`test-rhinestone-font-prototype.mjs`, `test-font-decision-001-stone-size-ux.mjs`,
`test-font-portfolio-001-stone-size-gating.mjs`) all test font families and gating logic that are
currently registered and live (`RhinestoneFontRegistry.js`), not retired ones. The two
`EXCLUDED_FROM_DEFAULT` files (§3.1) are the one clear case of "tests a module the live UI no
longer uses" — already identified as such by the repository itself, already handled by exclusion
rather than deletion, per the stated "don't remove a module while a test still exercises it"
policy.

### 3.3 Consolidation opportunities

Nothing found in this pass that looks like meaningful duplicate coverage across two different
files — the same-named-subsystem groups (e.g. `test-font-decision-001-stone-size-ux.mjs` appearing
in both `products` and `ui`) are intentional dual-membership (a UX-facing test that's also a
products-catalog test), explicitly commented as such in `test-groups.mjs`, not accidental overlap.
The suite reads as already having been through a deliberate consolidation pass (`S-111`
Test Suite Rationalization is referenced repeatedly as precedent).

### 3.4 Slow/flaky/skipped tests; missing coverage

- No skipped (`.skip`) or explicitly-flaky-flagged tests were found in this pass.
- Runtime is dominated by a handful of files — `test-ux-visual-polish.mjs` (0.27s) and
  `test-variable-stone-sizes.mjs` (0.19s) were the slowest individually observed in this run's
  tail output; nothing in the 43s total suggests a real bottleneck (no test took more than a
  fraction of a second individually based on the observed run).
- **Possible coverage gap, not confirmed**: no test file name suggests direct coverage of the
  `Math.min(...array)`/stack-overflow risk from §1.3 at a realistic large-N stone count — worth
  adding a regression test alongside whatever fix addresses that finding, rather than assuming
  existing geometry tests exercise it (they appear to use small, hand-constructed fixtures, not
  thousands-of-stones designs).
- **Texture-wrap-mode gap, not confirmed**: similarly, no test name suggests direct coverage of
  `THREE.Texture.wrapS`/`wrapT` on the 3D preview's stone texture (§1.3 seam artifact) — the
  existing `test-ux-visual-polish.mjs` B15 series covers *mesh* seam placement thoroughly but not
  the texture object's own wrap setting.

### 3.5 Suite runtime and group-structure verdict

43.26s for the full 98-file suite is fast in absolute terms for a project this size. The two-tier
group structure (§3.1) already answers the "does the group structure still make sense" question
affirmatively — it was purpose-built (`MAINT-001`/`MAINT-002`) for exactly the scale the project is
at now, not inherited unchanged from an earlier, smaller state.

---

## Part 4 — Recommended next major milestones

Context that changes this section's framing from the original prompt: **the product is not
early-stage.** It is Version 1.0, feature-frozen, currently in release-candidate stabilization
(`RC-002` → `RC-007` so far). `docs/PRODUCT_ROADMAP.md` already names Version 1.1 candidates
(re-enabling the frozen Gallery/Design Library, batch export, print layout). Sasha's own
stated priority order (per current context) is: (1) text quality/opentype outline sampling,
(2) 3D cup/vessel realism, (3) real product-plugin system, (4) manufacturing exports.

Given both of those, here is how I'd rank the next milestones, with rough scope:

1. **Close the release candidate, deliberately** *(small)* — Before anything else: is `develop`
   at `RC-007` ready to actually cut Version 1.0, or is there a known remaining RC item? This
   review found no open release-blocking defect (all 98 tests pass; the specific release-blocking
   bugs mentioned in test comments — e.g. `long-script-name.rhs`'s same-contour overlap — are
   fixed and regression-guarded). If nothing else is pending, formally closing 1.0 is cheap and
   creates a clean baseline before 1.1 feature work resumes.

2. **Stone rendering: instanced/faceted 3D geometry** *(large)* — This is Sasha's #2 priority and
   the last major piece of the "prior review" list still fully open (§0). The body geometry work
   (RS-1006/1006A/RS-2010/2011) already solved the harder problem (correct, dimension-driven,
   seam-safe revolved meshes) — replacing the canvas-texture stone layer with real instanced
   geometry now has a correct, stable host mesh to sit on, which likely lowers the cost of this
   milestone versus if it had been attempted earlier. Two small, high-leverage prerequisites worth
   doing as part of (or just before) this work: the texture wrap-mode check (§1.3) and the
   `Math.min(...array)` stack-overflow fix (§1.3) — the latter especially, since instanced-geometry
   stone counts will only make large-N designs more common, not less.

3. **Text quality / opentype outline sampling** *(medium)* — Sasha's #1 priority. `TXT-103A`
   already did the hard diagnostic work (confirmed every text-sizing invariant holds, traced
   exactly where `heightMm` means "em size" vs. "physical letter height"); this milestone is
   "act on that audit's findings," which is a well-scoped, medium-size job rather than a fresh
   investigation.

4. **Real product-plugin system** *(medium–large)* — Sasha's #3 priority, and the natural
   generalization of `src/products/ObjectTemplate.js` +
   `Plate/VesselProductDefinition.js` + `definitions/*.json`, which already establish the exact
   shape a plugin system would need (schema-driven product definitions, not hardcoded per-product
   branches). This is less "build from scratch" and more "formalize and open up a pattern that
   already exists for 4 products" — genuinely medium scope if scoped tightly to "make it easy to
   add product #5 without touching `app.js`," larger if it's meant to open product definitions to
   end-users.

5. **Manufacturing export improvements** *(medium)* — Sasha's #4 priority.
   `src/export/ProductionSheetExporter.js`/`SvgExporter.js`/`PdfDocument.js` are mature and
   tested (`exporters` group), so this is refinement of a working system, not new infrastructure —
   worth a short scoping pass against real manufacturing-partner feedback before committing to
   size.

6. **Font-program archival** *(small)* — Not a product milestone, but worth doing alongside
   whichever of the above comes first: archive the closed-out milestone scripts (§2.2) and make an
   explicit call on `output0/1/2` and the 300M of `fonts/`/`review/` assets (§2.3). Cheap, mostly
   mechanical, and removes noise from `tools/font-generator/` before the next person (human or
   Claude) has to work in that directory.

7. **Re-enable Gallery/Design Library for 1.1** *(small, if the product decision is "yes")* — Both
   are already built, tested, and only administratively frozen (`S-103`/`RC-006`) for the 1.0
   release, not incomplete. If Version 1.1 is meant to include them, this is close to a
   flip-a-flag-and-verify job rather than development work — but that's a product call for Sasha,
   not an engineering one, so it's listed here as a proposal rather than assumed.

Deliberately not proposed: more font-generation work (per the original prompt's own instruction,
and consistent with `FONT-POLICY-001` explicitly closing that program), and anything in
`docs/WONT_BUILD.md`'s list (general CAD, Photoshop/Blender replacement, ERP, inventory
management).

---

## Appendix — commands run

```
git clone https://github.com/alexdruk/Rhinestone-Studio.git
git checkout -b develop origin/develop
npm install --no-audit --no-fund
node tools/run-tests.mjs --all      # 98/98 passed, 43.26s
```

No `git add`, `git commit`, or `git push` was run. This file was written to
`docs/specifications/ARCH-REVIEW-001-FullArchitectureAndCodebaseReview.md` in the local working
copy only, per this task's instruction not to commit without asking first.
