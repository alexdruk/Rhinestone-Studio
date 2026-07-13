# Rhinestone Studio — Task Result

This document is completed by the implementation engineer after finishing the current task.

---

# Task ID

RS-2000 — MVP Stabilization & Production Validation

---

# Status

IMPLEMENTED

---

# Branch

feature/rs-2000-mvp-stabilization

---

# Commit

Do not write the current commit hash into this file — this file is part of the same commit it
describes. Obtain it from Git history with:

```bash
git log -1 --oneline
```

---

# Audit Findings

Full detail in `docs/specifications/RS-2000-MVPStabilizationValidation.md`. Summary:

* **The codebase was unusually disciplined going in.** `docs/ARCHITECTURE.md` already tracked most
  of its own known debt in detail (a "Current Architectural Limitations" section and a "Remaining
  Legacy / Dead Code" section). No other dead/unreachable code, orphaned modules, or terminology
  inconsistencies were found beyond what was already documented.
* **Three divergent project/layer schemas exist**: `src/core/Project.js`/`Layer.js` (fully built,
  unused by the live app — pre-existing, documented), `app.js`'s ad hoc live-editor schema (the one
  real schema), and `examples/*.rhs`'s flat mm-suffixed fixture schema (extended this milestone to
  also cover svg/image/path layers). Not reconciled — that is a dedicated migration milestone's
  scope, not a stabilization bug fix.
* **A high-severity, previously-undetected defect was found**: `src/svg/SvgDocumentParser.js`
  computed `naturalWidthMm`/`naturalHeightMm` correctly but positioned actual shape coordinates using
  the raw declared-unit number, never multiplying by the unit-to-mm conversion factor. Every
  real-world SVG using `px`/unitless/viewBox-only sizing (i.e. nearly all hand-authored or exported
  SVGs) imported ~3.78x too large per axis. Every pre-existing coordinate-correctness test defaulted
  to `width="50mm"` (a no-op conversion factor), completely masking the bug. Found while building a
  representative SVG-import fixture with realistic (non-"mm") content — exactly the value of testing
  with production-representative data instead of only synthetic mm-unit fixtures.
* **Two dead "Apply" buttons** (Text and Shapes lightboxes) had no click handler despite both dialogs
  already applying every field live — a misleading affordance, not a functional bug.
* **Legacy dead code** (bitmap text engine, legacy shape generators) had been flagged in
  `docs/ARCHITECTURE.md` as safe to delete "once a human confirms the permanent-engine/renderer
  output is production-acceptable" since RS-0003.5C1 — this milestone's own end-to-end validation was
  that confirmation (user-approved), so it was deleted.

---

# Defects Fixed

1. **SVG unit-conversion bug** (`src/svg/SvgDocumentParser.js`) — shape coordinates now scale by
   `widthMmPerUnit`/`heightMmPerUnit`, matching `naturalWidthMm`/`naturalHeightMm`'s own unit space.
   No-op for the `mm` case; 3 new regression tests.
2. **Dead Apply buttons removed** (Text, Shapes lightboxes) — standardized to a single "Close",
   matching every other fully-live dialog. Shipping/Settings keep their real Cancel+Apply pairing
   (genuine batched state). 5 new regression tests.
3. **`toAppProjectShape()` round-trip bug** — `fillMode`/`mode` is now only emitted when actually
   present, fixing a JSON round-trip data-loss bug the fixture schema extension surfaced.
4. **Legacy dead code deleted** (`FONT5`, `generateText()`, `sampleGlyphFill()`,
   `sampleGlyphStroke()`, `line()`, `generateCircle()`, `generateRect()`) from `app.js`, gated on this
   milestone's validation passing. `dedupe()` kept (still the live cross-layer merge). Two existing
   tests updated from asserting presence to asserting absence.

---

# Example Fixtures Added

7 new `examples/*.rhs` fixtures close the gap between what the milestone's E2E validation requires
(SVG import, Image Trace, boolean operations, multi-color designs, tumbler/bottle products) and what
the 17 pre-existing fixtures (all mug + text/circle/rectangle) covered:

`svg-logo-import.rhs`, `image-trace-monogram.rhs`, `boolean-union-badge.rhs`,
`multi-color-mixed-layers.rhs`, `tumbler-wrap-design.rhs`, `bottle-front-design.rhs`,
`mixed-fill-styles-and-sizes.rhs` — all built and verified through the real permanent
`GeometryEngine`, not hand-computed geometry (the image layer's real pixels via a genuine browser
decode). `tools/lib/rhsProject.mjs` extended (previously text/circle/rectangle only) to support all
six layer types; new `tools/lib/browserImageBuffer.mjs` helper for the one unavoidable browser-only
step (Node has no image decoder). `examples/manifest.json`/`baselines.json` and
`tools/test-examples-regression.mjs` updated accordingly (24 fixtures total now).

---

# Test Results

```
npm test
```

All 60 test suites pass, 756 individual `✓` assertions, exit code 0.

---

# Browser Verification

Raw Chrome DevTools Protocol (Node built-ins only, no new dependency), isolated headless Chrome
instance (temp `--user-data-dir`, dedicated debugging port), against the app served locally. Never
touched any pre-existing Chrome window/process.

* **Deep workflow pass** (5-layer multi-color project): Import → Undo/Redo → Alignment → Dual
  Workspace ⇄ Object Preview → Save → reload → re-import (deterministic) → all 6 export formats
  (Project JSON, Layout JSON, SVG, PNG, Production Sheet SVG + PDF) → Design Library (save, real
  thumbnail, search) — 9/9 checks passed, zero console errors.
* **Smoke pass** across 10 fixtures (all 7 new + 3 varied existing): exact expected stone count,
  Object Preview render, zero console errors — 10/10 passed.

No console errors were observed at all (the milestone's own bar — "no console errors except the
known favicon 404" — was cleared with a strict subset: zero).

---

# Performance Measurements

See `docs/specifications/RS-2000-MVPStabilizationValidation.md` for the full table
(`tools/measure-performance.mjs`, a new manual/non-`npm test` tool matching the existing
`measure-boolean-precision.mjs` convention). Headline finding: Contour Fill on text layers (~750ms)
is 5–7x slower than every other text fill mode and the only measured operation that could read as
laggy during live editing — correct output, not a defect, but worth a future targeted optimization
pass if that combination sees real production use. Everything else is comfortably sub-100ms at
production scale.

---

# Known Limitations / Remaining Issues

* The two unreconciled project/layer schemas (`src/core/**` vs. `app.js`'s live schema) remain
  unreconciled — pre-existing, well-documented, out of scope for a stabilization milestone.
* `svg` layers use `mode` where every other vector layer type uses `fillMode` for the same concept —
  cosmetic, internal-only, not worth a schema-touching rename here.
* PNG export remains a render-capture with no `src/export/**` counterpart — pre-existing, documented,
  intentional.
* Contour Fill on text layers is markedly slower than every other operation measured (see above).
* `app.js`/`index.html`'s monolithic structure is a legitimate long-term maintainability concern, not
  a functional defect.

---

# Recommendation

**READY FOR MVP RELEASE**

Do not merge per task instructions — `feature/rs-2000-mvp-stabilization` is pushed for review.

---

# Next Recommended Step

A dedicated migration milestone to reconcile the project/layer schema split is the single largest
remaining architectural item. A targeted performance pass on Contour Fill for text, if that
combination sees real production traffic, is the other non-blocking follow-up worth scheduling.
