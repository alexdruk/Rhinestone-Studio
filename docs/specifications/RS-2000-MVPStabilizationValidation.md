# RS-2000 — MVP Stabilization & Production Validation

Not a feature milestone: an audit, end-to-end validation, and defect-fix pass across the whole
application, treating it as a production system. Nothing here adds user-facing functionality except
where a defect required it.

---

# Scope

Audited: UI consistency, GeometryEngine, StoneLayout pipeline, Import/Export, Production Sheet, 2D
Canvas, Dual Workspace, 3D Preview, Image Trace, SVG Import, Boolean Operations, Fill Algorithms,
Variable Stone Sizes, Design Library, Undo/Redo, Alignment & Snapping, Crystal Color Library.

Baseline before any change: `npm test` — 63 suites, all green, exit code 0.

---

# Audit Findings

## Architectural debt (documented, largely pre-existing)

1. **Three divergent project/layer schemas exist.** (a) `src/core/Project.js`/`Layer.js` — a
   fully-built, validated, typed model, **unused by the live app** (already documented in
   `docs/ARCHITECTURE.md` "Current Architectural Limitations" #1, enforced by
   `tools/test-app-module-migration.mjs`). (b) `app.js`'s ad hoc live-editor schema — the one real
   schema the running app actually reads/writes (`validateProject()`, `#exportProject`). (c) The
   `examples/*.rhs` fixture schema (`tools/lib/rhsProject.mjs`) — a flat, mm-suffixed format
   deliberately mirroring the two original preserved fixtures, used only by the Node regression
   suite, previously supporting only text/circle/rectangle. This milestone **extended (c)** to also
   cover svg/image/path layers (needed to build the fixtures below) but did not attempt to reconcile
   (a)/(b)/(c) with each other — that is a dedicated migration milestone's work, not a stabilization
   bug fix.
2. **`docs/ARCHITECTURE.md` is the sole authoritative architecture doc.** `docs/adr/ADR-0001-*.md`
   and `docs/architecture/architecture.md` are shorter, pre-existing, and already explicitly marked
   historical/non-authoritative by `docs/ARCHITECTURE.md` itself — not a defect, already handled.
3. **`app.js`/`index.html` are monolithic** (1.2k/850+ lines) — all UI wiring and markup for every
   dialog lives there; `src/ui/` only holds a generic `Lightbox.js` controller. Noted as a structural
   observation; splitting it is a larger refactor than a stabilization milestone should attempt
   without a specific defect motivating it.
4. **PNG export bypasses `src/export/**`** (a render-capture via `canvas.toDataURL`, not a
   standalone exporter module) — pre-existing, documented (`docs/ARCHITECTURE.md` limitation #5),
   intentional per its own inline comment. Not changed.
5. **Per-product `if` branching inside otherwise-generic renderers** (`CupRenderer.js`,
   `ObjectGeometryBuilder.js` both branch on `preview.kind==='bottle'`) — reads plugin-supplied data,
   doesn't own state, so not an architecture violation, but a maintenance smell as more product types
   are added. Noted, not refactored.
6. **`svg` layers use `mode` where every other vector layer type (circle/rectangle/path) uses
   `fillMode`** for the identical "Fill Style" concept — found while extending the fixture schema
   (had to preserve this exact quirk to match the real `validateProject()`). Cosmetic/internal only
   (the UI label is uniformly "Fill Style"); renaming would touch the live project schema for no
   user-visible benefit, so left as a documented note (`docs/ARCHITECTURE.md` limitation #7).
7. **Intentional near-duplication**: `ContourRingSampler.js` and `PathBoolean.js` both implement a
   marching-squares tracer, with an inline comment explaining why (different saddle-case resolution
   needs). Flagged for awareness, not a defect.

## Dead code

- `docs/ARCHITECTURE.md`'s "Remaining Legacy / Dead Code" section (bitmap text engine, legacy shape
  generators) was accurate and is now **resolved** — see "Defects Fixed" below.
- No other dead/unreachable code was found in `src/**` (confirmed via import-graph checks across
  geometry/core/editing/history and UI/renderer/export/svg/image/library/products).
- `style.css` (repo root) has zero live references from `index.html`/`app.js`, but is **deliberately
  protected**: it appears in the `forbiddenExact` list of ~18 existing regression tests as a
  canary file. Confirmed still correct; left untouched.

## UX / terminology

- "Fill Style" terminology is used consistently across Text/Shapes/Import/Image Trace dialogs.
- Close/Cancel button wording is correct everywhere it was checked: dialogs with a real batched
  Apply-then-commit action (Shipping, Settings) correctly pair Cancel+Apply; the Design Library
  delete-confirmation correctly pairs Cancel+Delete; every fully-live dialog uses a single Close —
  see "Defects Fixed" for the two dialogs that were the exception.

---

# Defects Found and Fixed

## 1. SVG shape coordinates ~3.78x too large for any non-"mm" unit (high severity)

`parseSvgDocument()` (`src/svg/SvgDocumentParser.js`) correctly converted `naturalWidthMm`/
`naturalHeightMm` from the SVG's declared width/height unit, but the transform matrix that positions
actual shape coordinates only scaled by the **raw declared-unit number**, never multiplying by that
unit's mm-per-unit factor. `naturalWidthMm` and the placed shape coordinates ended up in two
different unit spaces, off by exactly `1 / widthMmPerUnit`.

Impact: any SVG using `px`, unitless, `in`, `cm`, or viewBox-only sizing — i.e. nearly every
real-world hand-authored or exported SVG (icon libraries, Illustrator/Figma/Inkscape exports) —
imported roughly **3.78x too large per axis (~14x area)** for the common `px`/unitless case, and
proportionally worse for `in`/`cm`. Only SVGs explicitly declared in literal millimeters were
unaffected — which is exactly why every pre-existing coordinate-correctness test in
`tools/test-svg-parser.mjs` (whose `svg()` helper defaults to `width="50mm"`) missed it entirely: a
"mm" unit gives a conversion factor of 1, masking the bug completely.

Found while building a representative SVG-import fixture for this milestone: a simple badge logo
(circle + star + ribbon, `viewBox="0 0 100 100" width="100" height="100"`) generated stones spanning
290×283mm on a 210×90mm canvas instead of fitting its 76×76mm placement box.

**Fix**: `src/svg/SvgDocumentParser.js` — the viewBox and no-viewBox transform matrices now multiply
by `widthMmPerUnit`/`heightMmPerUnit`, so shape coordinates land in the same millimeter space as
`naturalWidthMm`/`naturalHeightMm`. No-op for the `mm` case (byte-identical to before), so every
pre-existing test is unaffected. Added 3 regression tests (`tools/test-svg-parser.mjs`) covering
viewBox + non-mm unit, no-viewBox + non-mm unit, and confirming the mm case is unchanged.

## 2. Dead "Apply" buttons in Text and Shapes lightboxes

Both dialogs already apply every field live via `updateAll()` (the Text dialog's own footer note
says "Changes preview live and undo/redo normally"), but each had an `Apply` button with
`data-lightbox-close` and **no click handler** in `app.js` — clicking it did nothing but close the
dialog, identical to Close/Cancel. `#textApply` had zero wiring anywhere in `app.js`; the Shapes
dialog's Apply button didn't even have an `id`. Misleading affordance in both cases.

**Fix**: removed both dead buttons; standardized the Text dialog's dismiss button from "Cancel" to
"Close" (nothing to cancel — it was already live), matching every other fully-live dialog
(Import/Export/Production Sheet/Help/Library). Shipping and Settings keep their real Cancel+Apply
pairing since those two dialogs genuinely batch session-local state and only commit it on Apply.
Added 5 regression tests (`tools/test-rs2000-ui-fixes.mjs`).

## 3. `toAppProjectShape()` round-trip data loss for layers with no `fillMode`

While extending the example-fixture schema to cover svg/image/path layers, the translator always
wrote a `fillMode`/`mode` key — even as `undefined` — for layers that never set one.
`JSON.stringify()` silently drops `undefined`-valued keys, so a fixture with no `fillMode` (every
pre-existing circle/rectangle fixture) failed the round-trip regression test: the pre-stringify
object still had the key, the post-parse object didn't.

**Fix**: the key is now only emitted when actually present (conditional spread), matching how
`app.js`'s own live layers are shaped before a user ever touches the control.

## 4. Legacy dead code removed (gated on this milestone's validation)

`docs/ARCHITECTURE.md` had flagged the legacy bitmap text engine (`FONT5`, `generateText()`,
`sampleGlyphFill()`, `sampleGlyphStroke()`, `line()`) and legacy shape generators (`generateCircle()`,
`generateRect()`) in `app.js` as safe to delete "once a human confirms the permanent-engine/renderer
output is production-acceptable" — recommended in every `TASK_RESULT.md` since RS-0003.5C1, never
acted on. Confirmed zero live call sites (grepped for every method name outside its own definition).
This milestone's full end-to-end + browser validation (below) is that confirmation, per explicit
user sign-off. Deleted; kept `dedupe()` (still the live cross-layer proximity merge). Updated the two
tests that previously asserted this code's presence to assert its absence, and updated
`docs/ARCHITECTURE.md` accordingly.

---

# Example Fixture Gaps Closed

All 17 pre-existing `examples/*.rhs` fixtures were `mug` + text/circle/rectangle only — no committed
fixture exercised SVG import, Image Trace, Boolean Operations, multi-color designs, or tumbler/bottle
products, despite these being exactly the scenarios this milestone's end-to-end validation requires.

Added 7 new fixtures (built and verified through the real permanent `GeometryEngine`, not
hand-computed geometry):

| Fixture | Scenario | Stones |
|---|---|---|
| `svg-logo-import.rhs` | SVG-imported badge logo + text tagline | 927 |
| `image-trace-monogram.rhs` | Image Trace from a real traced PNG (browser-decoded) | 196 |
| `boolean-union-badge.rhs` | Real Union Boolean Operation result (`PathBoolean.js`) | 227 |
| `multi-color-mixed-layers.rhs` | 5 layers, 5 distinct crystal colors | 1079 |
| `tumbler-wrap-design.rhs` | Tumbler product, half wrap | 426 |
| `bottle-front-design.rhs` | Bottle product, front wrap | 629 |
| `mixed-fill-styles-and-sizes.rhs` | All 5 fill/text modes, stone sizes 1.0–2.5mm | 1280 |

To support these, `tools/lib/rhsProject.mjs` (previously text/circle/rectangle only) was extended to
validate/translate/generate svg, image, and path layers, mirroring `app.js`'s real behavior per type.
A new `tools/lib/browserImageBuffer.mjs` helper (raw CDP, no new dependency) provides real decoded
pixels for the image layer's baseline computation, since Node has no bundled image decoder.

`tools/test-examples-regression.mjs` validates schema/translation/round-trip for all 24 fixtures, but
deliberately does **not** launch a browser to re-decode the image layer on every routine `npm test`
run (would add a new dependency/latency to the whole suite, breaking from this repo's existing
"browser-dependent tooling stays manual" pattern) — documented explicitly as its own test, not a
silent gap. Image-layer generation correctness is verified when baselines are regenerated (which does
use a real browser) and by this milestone's own browser E2E pass below.

---

# Performance Measurements

Node-side (`tools/measure-performance.mjs`, real production code paths, 210×90mm canvas scale):

| Operation | Time | Stones |
|---|---|---|
| Text generation — outline | 27 ms | 319 |
| Text generation — fill | 14 ms | 58 |
| Text generation — staggered | 17 ms | 99 |
| Text generation — radial | 116 ms | 79 |
| **Text generation — contour** | **747 ms** | 111 |
| Rectangle — outline | 0.4 ms | 183 |
| Rectangle — fill | 1.0 ms | 1690 |
| Rectangle — staggered | 1.3 ms | 1950 |
| Rectangle — radial | 7.2 ms | 1664 |
| Rectangle — contour | 79 ms | 1016 |
| Boolean union | 24 ms | 1 contour |
| Boolean subtract | 11 ms | 1 contour |
| Boolean intersect | 6 ms | 1 contour |
| Boolean xor | 14 ms | 2 contours |
| SVG export | 5 ms | 3045 |
| Production Sheet PDF export | 29 ms | 3045 |
| Design Library: add 500 items | 373 ms | — |
| Design Library: search+filter+sort/500 | 13 ms | — |

Browser-measured (CDP, cold headless Chrome against the local static server):

| Operation | Time |
|---|---|
| Cold startup (navigate → first stones rendered) | 282 ms |
| Project import (file input → stats updated) | 147 ms |
| Full page reload + re-import | 251 ms |
| Design Library save + thumbnail render | 122 ms |

**Slowest operation: Contour Fill mode on text (747ms)** — 5–7x slower than every other text fill
mode, and markedly slower than Contour Fill on a single-contour shape (79ms) at a comparable stone
count. Text has many small per-character contours vs. one large contour for a shape; the
`ContourRingSampler`/marching-squares approach likely scales per-contour overhead poorly for many
small contours. Not a defect (produces correct output, confirmed by the existing Fill Algorithms test
suite) but the one operation worth a future targeted optimization pass if Contour Fill text becomes a
common real workflow — it's the only measured operation that could read as "laggy" during live
editing (a user dragging a slider on a Contour-mode text layer would feel a ~0.75s stall per
keystroke-driven regeneration).

Everything else is comfortably sub-100ms at production scale.

---

# UX Recommendations

- Dead Apply buttons — fixed (see Defects above).
- No other UI inconsistencies found: terminology, Close/Cancel pairing, and dialog structure are
  otherwise already consistent across all eleven lightboxes.
- Minor, not actioned: `svg`'s internal `mode` vs. every other layer's `fillMode` field name (no
  user-visible impact, would touch the live schema to fix).

# Architecture Recommendations

- Schedule a dedicated migration milestone to reconcile the two live-relevant project/layer schemas
  ((a) and (b) above) — this is the single largest piece of remaining architectural debt, pre-dates
  this milestone, and is out of scope for a stabilization pass.
- Consider a targeted performance pass on Contour Fill for text layers if that combination sees real
  production use.
- `app.js`/`index.html`'s monolithic structure is a legitimate long-term concern but not a defect;
  revisit only alongside a milestone that already needs to touch large parts of the UI wiring.

---

# Test Results

`npm test`: **60 suites, 756 assertions, exit code 0.** (Includes 4 new/extended suites from this
milestone: `tools/test-rs2000-ui-fixes.mjs`, 3 new tests in `tools/test-svg-parser.mjs`, 2 new tests
in `tools/test-examples-regression.mjs`, updated assertions in `tools/test-live-text-integration.mjs`
and `tools/test-shape-geometry-integration.mjs`.)

---

# Browser Verification

Raw Chrome DevTools Protocol (fetch + WebSocket, Node built-ins only — no new dependency), headless
Chrome launched with an isolated temporary `--user-data-dir` and a dedicated debugging port, against
the app served locally via `python3 -m http.server`. Never touched any pre-existing Chrome window or
process; the test instance was closed at the end of each run.

**Deep workflow pass** (multi-color 5-layer project, representative of a real production job): 9/9
checks passed —
Create/Import → Undo/Redo (color change reverts and reapplies correctly) → Alignment (2-layer
selection, Align Left, status message correct) → Dual Workspace ⇄ Object Preview switch → Save
Project → full page reload → re-import (stone count identical, confirming deterministic
regeneration) → Export (Project JSON, Generated Layout JSON, SVG, PNG, Production Sheet SVG, PDF —
all 6 downloads produced) → Design Library (save, thumbnail renders as a real preview image, search
filters correctly). Zero console errors throughout.

**Smoke pass** across the 7 new fixtures + 4 existing ones (10 total: SVG import, Image Trace,
Boolean Operations, multi-color, tumbler, bottle, mixed fill styles, plus 4 varied existing text/shape
fixtures): 10/10 imported with the exact stone count independently computed via the Node-side engine,
Object Preview (3D) rendered for every one, zero console errors for every one.

No console errors were observed at all during this milestone's browser verification (the known
favicon 404 is the only error this milestone's acceptance criteria allows — none occurred, a strict
subset of that bar).

---

# Recommendation

**READY FOR MVP RELEASE.**

Justification: the audit found a well-architected, disciplined codebase with one high-severity,
previously-undetected defect (SVG unit conversion) that would have affected the majority of
real-world SVG imports — found specifically because this milestone insisted on testing with
realistic content rather than only the `mm`-unit synthetic fixtures the existing suite relied on.
That defect, plus two smaller UI/data-fidelity defects, are fixed with regression coverage. The
permanent geometry/rendering pipeline was validated end-to-end across every required production
scenario (names, logos via SVG import, Image Trace artwork, mixed stone sizes, every fill style,
boolean operations, multi-color designs, mugs/tumblers/bottles) through the real browser UI with zero
console errors, which was also the gate for finally retiring long-flagged dead code. Remaining known
issues are pre-existing, documented architectural debt (the unreconciled project/schema models) that
do not block real-world use of the application as it exists today, and a single non-blocking
performance characteristic (Contour Fill on text) that produces correct output.

Do not merge — per task instructions, push `feature/rs-2000-mvp-stabilization` for review.
