# Rhinestone Studio — Task Result

This document is completed by the implementation engineer after finishing the current task.

---

# Task ID

RS-2001 — Gallery & Acceptance Suite

---

# Status

IMPLEMENTED

---

# Branch

feature/rs-2001-gallery-acceptance-suite

---

# Commit

Do not write the current commit hash into this file — this file is part of the same commit it
describes. Obtain it from Git history with:

```bash
git log -1 --oneline
```

---

# Audit Findings

Full detail in `docs/specifications/RS-2001-GalleryAcceptanceSuite.md`. Summary:

* **Three parallel project schemas already exist**: the live `app.js` ad hoc schema (authoritative),
  the unused `src/core/Project.js`/`Layer.js`, and the flat mm-suffixed `.rhs` fixture schema
  (`examples/*.rhs`), bridged to the live schema only by `tools/lib/rhsProject.mjs`'s
  `toAppProjectShape()`. Gallery reuses this bridge — no fourth schema.
* **Design Library (RS-1015) already solved "save/browse/thumbnail/insert."** Gallery mirrors its
  architecture (pure DOM-free module + barrel, one Lightbox + top-menu button, thumbnails via the
  existing `engine.generate()` → `renderProductionLayout()` pipeline) rather than reinventing any of
  it.
* **GeometryEngine/StoneLayout/every renderer and exporter are single-implementation, test-enforced.**
  Gallery adds zero geometry, rendering, or export code.
* **The 24 pre-existing fixtures are engineering regression fixtures, not customer-scenario
  designs** — confirmed via `examples/manifest.json` (`circle-only`, `monogram-fill`,
  `boolean-union-badge`, etc.). Wedding/Sports/Business had zero real members. Per product decision,
  3 new customer-scenario fixtures were hand-authored using only already-supported layer
  types/products, with baselines regenerated via the existing `node tools/generate-example-
  baselines.mjs` tool.
* **A real bug was found and fixed during browser verification**: the two preserved legacy fixtures
  (`vitalina.rhs`/`vitalina-serbin.rhs`) store `color` as the display name `"Crystal AB"`, not the
  catalog id `"crystal"`. Gallery is the first feature ever to open a `.rhs` fixture into the live
  editor's own `#stoneColor <select>`, whose options are catalog ids only — the mismatch silently
  reset the control to `""`, which then corrupted the layer's color on the next tracked-field edit
  (a real, reproducible `GeometryEngine.generateTextLayout` crash, confirmed live, not assumed).
  Fixed via a new `resolveStoneColorId()` in the shared schema bridge, applied only in the
  live-editor translation path, mirroring the pre-existing `resolveFontId()` legacy-name pattern.
  Neither the byte-locked fixture files nor the Node-side geometry-generation path were touched.
* **`style.css` is dead, unlinked legacy CSS** — not referenced anywhere in `index.html`; the app's
  real stylesheet is `index.html`'s own inline `<style>` block (already an allowed file since
  RS-1015/UI-001). No change to `style.css` was needed or made.

---

# Architecture

See `docs/specifications/RS-2001-GalleryAcceptanceSuite.md` "Architecture" for the full diagram.
Short version: `examples/*.rhs` (27 total) + `manifest.json`/`baselines.json` (existing) +
`gallery.json` (new, additive curatorial metadata) are merged at load time by the new
`src/gallery/GalleryCatalog.js` into one read-only catalog entry per fixture — `stoneCount`/
`objectType`/`wrap` are always derived from the committed baseline/fixture content, never hand-typed
in `gallery.json`. `src/gallery/RhsFixtureBridge.js` (relocated from `tools/lib/rhsProject.mjs`, now
a thin re-export shim there) is the one, shared `.rhs`→live-schema bridge used by both the Node
regression/benchmark suite and the browser Gallery's "Open Copy"/"Save to Design Library" actions.
`app.js`/`index.html` add one Gallery Lightbox (grid) + one Preview Lightbox (detail), reusing
`.library-grid`/`.library-card`/`.library-badge` verbatim plus a handful of new additive-only CSS
classes for the read-only visual identity (deep-blue `--color-primary` accent, a "READ-ONLY" ribbon,
category pills).

---

# Metadata Schema

See `docs/specifications/RS-2001-GalleryAcceptanceSuite.md` "Metadata Schema". `examples/
gallery.json`: `{file, title, category, description, difficulty, tags, featured}` per fixture —
`stoneCount`/`layerCount`/`objectType`/`wrap` deliberately omitted (derived, not duplicated).

---

# UI Summary

* New top-menu button "Gallery" (✨), opening a Lightbox with: a read-only hint banner, search box,
  category dropdown (curated categories + `Mugs`/`Tumblers`/`Bottles` product pseudo-categories +
  `Featured`), and a responsive card grid. Each card: thumbnail, "READ-ONLY" ribbon, title, category
  pill + difficulty + stone-count badges, "Preview" and "Open Copy" buttons.
* Preview dialog: larger thumbnail, title, full metadata badges, description, tags, "Save to Design
  Library" and "Open Copy" actions.
* Design language: white background, deep-blue (`--color-primary`, the same token every other
  primary action in the app already uses) header/accents/pills, minimal — matches the existing
  UI-001 design system rather than introducing a second one. See screenshots below.

---

# Example Inventory (27 fixtures)

| Category | Fixtures | Count |
|---|---|---|
| Names | vitalina, vitalina-serbin, short-name-block, long-name-autofit, script-name-great-vibes, front-wrap-light-cup, wide-wrap-dark-cup, long-script-name | 8 |
| Monograms | monogram-outline, monogram-fill | 2 |
| Shapes | circle-only, rectangle-only, mixed-text-circle, mixed-text-rectangle, mixed-all-layers | 5 |
| Mixed Stone Sizes | small-stones-tight-gap, large-stones-wide-gap | 2 |
| SVG | svg-logo-import | 1 |
| Image Trace | image-trace-monogram | 1 |
| Boolean Operations | boolean-union-badge | 1 |
| Multi-color | multi-color-mixed-layers | 1 |
| Tumblers | tumbler-wrap-design | 1 |
| Bottles | bottle-front-design | 1 |
| Large Projects | mixed-fill-styles-and-sizes (1280 stones, flagship benchmark) | 1 |
| **Wedding (new)** | wedding-bride-tribe-tumbler | 1 |
| **Sports (new)** | team-jersey-name-number | 1 |
| **Business (new)** | business-logo-monogram-bottle | 1 |

Featured (cross-cutting): Classic Name, Imported SVG Logo, Five-Layer Multi-Color Design, Every
Fill Style Every Stone Size, Bride Tribe Tumbler, Team Name Mug, Corporate Branded Bottle.

---

# Test Results

```
npm test
```

All 64 test suites pass, **801 individual `✓` assertions, exit code 0** (up from 61 suites / 768
assertions at the prior milestone tip — 3 new suites: `tools/test-gallery.mjs` (17 assertions),
`tools/test-gallery-integration.mjs` (13 assertions), `tools/test-gallery-benchmark.mjs` (2
assertions covering all 27 fixtures); 20 pre-existing suites updated in place — `tools/lib/
rhsProject.mjs` relocation shim, 2 import-allowlist extensions, 1 thumbnail-rename assertion update,
and 18 forbidden-file guards updated to no longer forbid `examples/`, exactly mirroring the
established precedent for unforbidding a previously-off-limits path once a milestone legitimately
needs it).

```bash
git diff --check   # clean
git status          # 25 modified, 8 new files, no unexpected changes
```

---

# Benchmark Results (this machine, Node)

From `tools/test-gallery-benchmark.mjs`'s permanent, reusable benchmark run (representative sample;
full 27-row table prints on every `npm test`):

| Fixture | Stones | Geometry gen | SVG export | Prod. Sheet SVG | Prod. Sheet PDF |
|---|---:|---:|---:|---:|---:|
| mixed-fill-styles-and-sizes.rhs (Large Projects flagship) | 1280 | ~84–91ms | ~1.5ms | ~1.8–2.0ms | ~10.6–11.3ms |
| multi-color-mixed-layers.rhs | 1079 | ~2.4–2.7ms | ~1.2–1.3ms | ~1.5–1.6ms | ~7.6–7.7ms |
| svg-logo-import.rhs | 927 | ~6.0–6.3ms | ~1.0ms | ~1.2–1.4ms | ~5.9–6.2ms |
| bottle-front-design.rhs | 629 | ~32.6–33.2ms | ~1.1ms | ~2.1–2.2ms | ~4.6ms |
| business-logo-monogram-bottle.rhs | 619 | ~4.4–5.4ms | ~1.0–1.2ms | ~1.3–1.4ms | ~4.7–4.9ms |
| long-script-name.rhs | 595 | ~11.8–12.1ms | ~0.6ms | ~0.8ms | ~3.3ms |
| circle-only.rhs (smallest) | 82 | ~0.3–0.4ms | ~0.1ms | ~0.3ms | ~0.6ms |

All 26 non-image fixtures complete geometry generation, SVG export, and Production Sheet SVG+PDF
generation well under the suite's 5-second sanity ceiling — the flagship 1280-stone fixture's worst
observed step (geometry generation) is ~90ms, roughly 55x margin. `image-trace-monogram.rhs` is
excluded from the Node benchmark (requires a real browser image decoder — see the specification),
measured instead in the browser pass below.

**Browser-measured (headless Chrome, this machine, screenshot/timing-observed, not machine-
normalized)**: Gallery catalog load (manifest + baselines + gallery.json + 27 `.rhs` fetches) and
initial thumbnail generation for all 27 cards completed within the verification script's 1.5s
settle window; individual thumbnail generation (`generateProjectThumbnail`, reused from Design
Library) and PNG export both completed well within their respective settle windows with no
timeouts.

---

# Browser Verification

Isolated headless Chrome via raw CDP (temp `--user-data-dir`, private debugging port; no
Playwright/Puppeteer dependency, matching this repo's established `tools/lib/browserImageBuffer.mjs`
pattern). Never touched any pre-existing Chrome window/profile/window named "main"/"airbnb"; only
the process this session started was ever closed.

* **Gallery opens**: 27 cards render, thumbnails populate asynchronously.
* **Categories**: dropdown includes All, Featured, every curated category (Names, Wedding, Sports,
  Business, SVG, Boolean Operations, Image Trace, Multi-color, Monograms, Shapes, Mixed Stone Sizes,
  Large Projects) and every product pseudo-category (Mugs, Tumblers, Bottles).
* **Search**: "wedding" → exactly 1 result (Bride Tribe Tumbler).
* **Category filter**: "Sports" → exactly 1 result (Team Name Mug).
* **Preview**: opens with correct title/thumbnail/badges/description/tags for the selected item.
* **Save to Design Library**: "Saved "Bride Tribe Tumbler" to the Design Library." confirmed; the
  Design Library grid subsequently listed it.
* **Open Copy**: project replaced (`projectName` field updated to "Classic Name"), Gallery closed,
  status message confirmed, history reset (mirrors `#importProjectFile`/`createProjectFromLibraryItem`
  exactly).
* **Editing + dirty indicator**: after the color-id fix, editing the reopened project's name field
  correctly flips the dirty indicator from "Saved" to "Unsaved changes" with no console error (this
  was the exact repro path for the bug found and fixed below).
* **Dual Workspace / 2D Canvas / Object Preview (3D)**: all three view-tab switches work; 2D canvas
  and 3D Object Preview canvases both report non-zero pixel dimensions; screenshots confirm correct
  rendering in every mode.
* **Production Sheet**: opens; SVG and PDF export buttons both triggered real, non-empty downloads
  (23.5KB SVG, 47KB PDF).
* **Export**: Project JSON (712 bytes), 2D SVG (20.1KB), 2D PNG (44.5KB) all downloaded and verified
  non-empty.
* **Every one of the 27 Gallery fixtures individually opened as an editable copy with no failures**
  (looped through the real UI — click Gallery, click Open Copy, verify the status message — for
  every catalog entry, not just a sample).
* **Console**: zero errors other than the known `favicon.ico` 404, after the color-id fix (see
  below). Four `[.WebGL] GL_INVALID_VALUE: glCopySubTextureCHROMIUM` **warnings** (not errors) were
  observed and investigated — see Known Limitations.

## Bug found and fixed mid-verification

First verification pass surfaced a real crash: after "Open Copy" of `vitalina.rhs` and any
subsequent tracked-control edit (including switching view tabs), `GeometryEngine.generateTextLayout`
threw `"color must be a non-empty string when provided"`. Root-caused to the legacy fixture's
`color: "Crystal AB"` (a display name) not matching any `<option value>` in the live editor's
`#stoneColor` `<select>` (real catalog ids only), which silently reset the control to `""`, later
written back as the layer's color. Fixed with `resolveStoneColorId()` in `src/gallery/
RhsFixtureBridge.js` (applied only in `toAppProjectShape()`, the live-editor path), added a
dedicated regression test, reran `npm test` (801/801) and the full browser pass — confirmed clean
(dirty indicator now correctly transitions "Saved" → "Unsaved changes" instead of crashing).

Screenshots (11 total, `scratchpad/screenshots/`): Gallery grid, search, category filter, Preview
panel, Design Library with the saved Gallery item, Open Copy in the live editor, Dual Workspace, 2D
Canvas only, Object Preview (3D), Production Sheet, Export dialog.

---

# Known Limitations / Remaining Issues

* **WebGL warning on cross-product canvas resize while 3D view is active** — `GL_INVALID_VALUE:
  glCopySubTextureCHROMIUM: Offset overflows texture dimensions`, four occurrences, reproduced when
  opening a Gallery item with a different canvas/product size (mug → tumbler) while the Object
  Preview (3D) tab is already active. **Confirmed to also reproduce with a plain, non-Gallery
  product-template switch** (isolated repro script, independent of Gallery) — this is a pre-existing
  `src/preview3d/**` behavior (forbidden for this milestone to touch) surfaced by, not caused by,
  Gallery's rapid cycling through differently-sized fixtures. It is a warning, not an error: the 3D
  view continues to render correctly afterward (screenshot-confirmed). Recommend a dedicated
  fast-follow investigation in `src/preview3d/StoneLayoutTexture.js`/`ObjectGeometryBuilder.js`'s
  canvas-resize handling.
* Everything already tracked in `docs/specifications/RS-2000A-PostMVPAudit.md` Part 11 (schema
  reconciliation, validation engine, Design Library backup/export, autosave) remains open, out of
  scope by design.

---

# Product Owner Review

**Does the Gallery make Rhinestone Studio feel like a polished commercial product?** Yes — the
read-only visual language (deep-blue header, "READ-ONLY" ribbon, category pills) reads clearly and
consistently with the app's existing design system rather than as a bolted-on feature, and the
Preview → Open Copy → (optional) Save to Library flow is exactly the low-friction "try before you
commit" pattern users expect from a template gallery. The `mixed-fill-styles-and-sizes.rhs`/
`svg-logo-import.rhs`/`multi-color-mixed-layers.rhs` fixtures already demonstrate real technical
range (every fill style, SVG import, multi-color) in a way a first-time user can browse without
reading documentation.

**Are the example projects representative of what customers actually want to create?** Partially,
and this is the most important finding of this milestone: the 24 pre-existing fixtures were built
as *engineering* regression coverage (`circle-only`, `monogram-fill`, `mixed-text-rectangle`) — real,
useful acceptance surface, but not inspiring to a browsing customer. The 3 new fixtures
(Bride Tribe Tumbler, Team Name Mug, Corporate Branded Bottle) close the most obvious gap and,
based on the rendered thumbnails, are genuinely attractive, sellable designs in their own right —
not placeholders. But three is a minimum viable seed, not a full customer-facing catalog.

**Which additional examples should be added in future releases?** A holiday/seasonal design (e.g., a
"Merry & Bright" ornament or stocking mug), a baby-shower/new-parent design, a monogram-plus-icon
combo (heart, paw print, star) using the existing SVG-import path, and at least one design per
supported product that showcases a wrap style other than front (the current new fixtures use
half/front/front — half/wide/full are underrepresented among the customer-scenario set
specifically).

---

# Business Review

**Which Gallery examples would most help convert trial users into paying customers?** The three new
customer-scenario fixtures directly, since they show a finished, giftable product rather than a
geometry test case — Bride Tribe Tumbler and Team Name Mug in particular map to the two highest-
volume personalization occasions (weddings/bachelorette parties, team/sports gifting). The
Multi-color and SVG-import fixtures are the best "this tool can do more than text" conversion
signal for a technically-curious trial user.

**Which industries are still underrepresented?** Exactly the three the Featured/category audit
above identifies as new-this-milestone (Wedding, Sports, Business) were *zero-represented* before
RS-2001 — now minimally seeded (one each). Still entirely unrepresented: holiday/seasonal retail,
hospitality/restaurant branding, real-estate/realtor gifting, and pet/animal-lover designs — all
common rhinestone-customization verticals with no fixture today.

**Which examples would best demonstrate the strengths of Rhinestone Studio?** `mixed-fill-styles-
and-sizes.rhs` (every fill algorithm and stone size range in one design — a strong "we support real
production variety" signal for a print-shop buyer) and `boolean-union-badge.rhs` (a real vector
boolean operation, not just template shapes — a strength most competing hobbyist tools lack).

---

# Remaining Future Gallery Ideas

* Seasonal/holiday, hospitality, real-estate, and pet-themed customer-scenario fixtures (see Business
  Review).
* A "Gallery item → Export the whole Gallery as a shareable showcase page" feature for print shops
  marketing their own capabilities.
* Difficulty-based guided onboarding: surface a single "start here" beginner fixture on first launch.
* Investigate/fix the `src/preview3d/**` WebGL warning found during this milestone's verification.
* RS-2002 Project/Layer Schema Reconciliation (already reserved in RS-2000A) remains the largest
  architectural item on the roadmap independent of Gallery.

---

# Recommendation

**APPROVED FOR REVIEW**

Do not merge per task instructions — `feature/rs-2001-gallery-acceptance-suite` is pushed for
review.

---

# Next Recommended Step

A dedicated fast-follow for the `src/preview3d/**` WebGL warning, then additional customer-scenario
Gallery fixtures (seasonal/hospitality/real-estate/pet) as identified in the Business Review, then
proceed with RS-2002 as already sequenced in `docs/specifications/RS-2000A-PostMVPAudit.md`.
