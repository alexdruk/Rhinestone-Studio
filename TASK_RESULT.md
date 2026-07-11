# Rhinestone Studio — Task Result

This document is completed by the implementation engineer after finishing the current task.

---

# Task ID

RS-0003.5E1

---

# Status

IMPLEMENTED

---

# Branch

feature/rs-0003.5e1-real-production-validation

---

# Commit

Do not write the current commit hash into this file — this file is part of the same commit it
describes. Obtain it from Git history with:

```bash
git log -1 --oneline
```

---

# Files Changed

```
examples/short-name-block.rhs          (new — short name, block font, outline mode, light cup)
examples/long-name-autofit.rhs         (new — long name, block font, auto-fit, dark cup, wide wrap)
examples/script-name-great-vibes.rhs   (new — Great Vibes script font, light cup)
examples/monogram-outline.rhs          (new — 3-letter monogram, outline sampling, dark cup)
examples/monogram-fill.rhs             (new — 2-letter monogram, fill sampling, light cup)
examples/front-wrap-light-cup.rhs      (new — dedicated front-wrap + white cup case)
examples/wide-wrap-dark-cup.rhs        (new — dedicated wide-wrap + black cup case)
examples/circle-only.rhs               (new — single circle layer, full wrap)
examples/rectangle-only.rhs            (new — single rectangle layer, half wrap)
examples/mixed-text-circle.rhs         (new — text + circle layers)
examples/mixed-text-rectangle.rhs      (new — text + rectangle layers)
examples/mixed-all-layers.rhs          (new — text + circle + a hidden (visible:false) rectangle;
                                         the suite's dedicated layerCount vs visibleLayerCount case)
examples/small-stones-tight-gap.rhs    (new — 0.8mm stones, 0.1mm gap)
examples/large-stones-wide-gap.rhs     (new — 3.0mm stones, 1.5mm gap)
examples/long-script-name.rhs          (new — long 3-word Great Vibes name, auto-fit, wide wrap)
examples/vitalina.rhs                  (unchanged — preserved, checksum-verified byte-identical)
examples/vitalina-serbin.rhs           (unchanged — preserved, checksum-verified byte-identical)
examples/manifest.json                 (new — machine-readable manifest, 17 entries)
examples/baselines.json                (new — committed baseline geometry, 17 entries)
tools/lib/rhsProject.mjs               (new — .rhs loader/validator/generator/app-shape translator)
tools/generate-example-baselines.mjs   (new — manual, human-run baseline generator; not run by
                                         `npm test`)
tools/test-examples-regression.mjs     (new — 17-assertion regression suite, wired into `npm test`)
package.json                           (modified — test script now runs the new suite)
tools/test-app-module-migration.mjs           (modified — removed `examples/` from forbidden list)
tools/test-live-text-integration.mjs          (modified — removed `examples/` from forbidden list)
tools/test-shape-geometry-integration.mjs     (modified — removed `examples/` from forbidden list)
tools/test-render-export-pipeline.mjs         (modified — removed `examples/` from forbidden list)
tools/test-browser-dependency-loading.mjs     (modified — removed `examples/` from forbidden list)
tools/test-production-export-validation.mjs   (modified — removed `examples/` from forbidden list)
tools/test-ux-visual-polish.mjs               (modified — removed `examples/` from forbidden list)
docs/specifications/RS-0003.5E1-RealProductionValidation.md   (new — milestone specification)
docs/ARCHITECTURE.md                   (modified — Testing Philosophy implementation-status
                                         paragraph updated to mention the new suite and fixed a
                                         pre-existing stale suite count, "twelve" -> "sixteen")
TASK.md                                (replaced — RS-0003.5E1 task)
TASK_RESULT.md                         (this file)
```

No file under `app.js`, `index.html`, `style.css`, `src/**`, or `assets/**` was changed.

---

# Resolved Discrepancy (read before reviewing the diff)

The two preserved `.rhs` fixtures use a flat, mm-suffixed schema
(`heightMm`/`stoneSizeMm`/`gapMm`, `mode: "centerline"|"fill"`, `font` as a family name) that is
**not** the same schema `app.js`'s own `validateProject()` accepts (confirmed by running the real
`validateProject()` against `vitalina.rhs` before writing any code — it throws:
`Layer "text-vitalina" is missing a positive numeric stoneSize`). Three project schemas already
coexist in this repository (`app.js`'s ad hoc schema, `src/core/Project.js`/`Layer.js`, and this
`.rhs` schema); this is pre-existing, not introduced here. Since the milestone brief requires both
preserving the two `.rhs` files unmodified and using "the existing `.rhs` format," the mm-suffixed
schema they already use is treated as the permanent `.rhs` interchange format. A pure,
side-effect-free translator (`toAppProjectShape()`) bridges it to `app.js`'s schema only for
verification (cross-checking the real `validateProject()`, and driving browser-import
verification) — `app.js`/`index.html` are unmodified. Full reasoning is in
`docs/specifications/RS-0003.5E1-RealProductionValidation.md`'s "Resolved discrepancy" section.
This was judged a documentable discrepancy, not a blocking architectural contradiction, per
`docs/AI_ENGINEER.md`.

---

# Commands Executed

```bash
npm test
git diff --check
git status
node tools/generate-example-baselines.mjs      # one deliberate run to produce the committed baseline
npm run dev                                     # python3 -m http.server 5173
# headless Google Chrome (OS-installed binary at
# "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"), isolated ephemeral
# --user-data-dir, no browser-automation dependency added, driven over raw CDP via Node 22's
# built-in fetch + WebSocket (matching the RS-0003.5B2-5D2 precedent) — a from-scratch driver
# script in the session scratchpad that imports each example's app-shape translation through the
# live #importProjectFile control, reads #layoutStats/#status, clicks the Export Layout JSON/SVG
# buttons, listens for Runtime.exceptionThrown/consoleAPICalled, and captures screenshots
```

---

# Test Results

## Automated Tests

PASS (all 16 suites, 171 assertions total, including the new suite and the seven updated
forbidden-file guards):

```
node tools/test-core-model.mjs && node tools/test-font-manager.mjs && node tools/test-vector-path.mjs
  && node tools/test-font-provider-registry.mjs && node tools/test-opentype-provider.mjs
  && node tools/test-default-font-provider-registry.mjs && node tools/test-geometry-engine.mjs
  && node tools/test-stone-color.mjs && node tools/test-app-module-migration.mjs
  && node tools/test-browser-dependency-loading.mjs && node tools/test-live-text-integration.mjs
  && node tools/test-shape-geometry-integration.mjs && node tools/test-render-export-pipeline.mjs
  && node tools/test-production-export-validation.mjs && node tools/test-ux-visual-polish.mjs
  && node tools/test-examples-regression.mjs
```

New `tools/test-examples-regression.mjs` (17 assertions):

1. Bidirectional coverage between `examples/manifest.json` and the `.rhs` files on disk (>= 17
   files).
2. The two preserved legacy fixtures exist and are byte-for-byte unmodified (SHA-256 + length
   checked against the values recorded before this milestone made any change).
3. `examples/baselines.json` has exactly one entry per example, no orphans.
4. Every example parses as valid JSON and passes `validateRhsProject()` structural validation.
5. Every example, translated to `app.js`'s ad hoc schema, is accepted by the **real**
   `validateProject()` function, extracted verbatim from `app.js`'s literal source and executed
   (not reimplemented) — proves the translation genuinely satisfies the live import path's own
   validation, not a re-derived approximation of it.
6. Every example round-trips through `JSON.parse(JSON.stringify(...))` with no data loss, in both
   its native `.rhs` shape and its translated app-shape.
7. Every visible layer of every example generates a non-throwing merged `StoneLayout` via the
   permanent `GeometryEngine`.
8. Every example produces a deterministic `StoneLayout` (two independent generation runs match
   exactly).
9. Actual stone count and bounding box match `examples/baselines.json` (exact count equality,
   0.001mm bounds tolerance).
10. Every stone has finite `xMm`/`yMm` and a positive finite `sizeMm`; no `NaN`/`Infinity` anywhere.
11. Observed stone colors match the committed baseline color set for every example.
12. `StoneLayout.toJSON()`/`fromJSON()` round-trips every example within floating-point tolerance
    (see "Defects Discovered" below for why exact `deepEqual` was replaced with a `1e-5` tolerance
    on derived width/height fields).
13. `stoneLayoutToSvg()` output is well-formed: `<circle>` count equals `StoneLayout.count`, and
    every circle's `cx`/`cy`/`r` matches its source stone exactly.
14. No stone lies wildly outside the project canvas (50mm generous manufacturing tolerance).
15. `validateRhsProject()` rejects obviously invalid projects (negative stone size, empty layers,
    unsupported layer type, invalid wrap, non-finite canvas dimensions).
16. Examples were only ever read during the suite — SHA-256 checksums taken before and after the
    run prove no example file was silently modified.
17. No forbidden file changed (this milestone's own forbidden list: `app.js`, `index.html`,
    `style.css`, `src/**`, `assets/**`).

`git diff --check` reported no whitespace errors. No `build` script exists in `package.json`, so
`npm run build` was not run (unchanged from prior milestones).

## Browser Verification

Ran `npm run dev` and drove `http://localhost:5173/` with a from-scratch, dependency-free CDP
driver (headless Chrome, Node 22's built-in `fetch`/`WebSocket`). `Runtime.exceptionThrown` and
`Runtime.consoleAPICalled` listeners were attached before navigation. 9 examples were imported
(exceeding the required minimum of 8), covering every category the milestone brief names: short
block text, long auto-fit text, Great Vibes script text, outline mode, fill mode, circle-only,
mixed text+shapes, dark cup with wider wrap, plus a long auto-fit script name for extra coverage.

For each example, the app-shape translation (see "Resolved Discrepancy") was written to a temp
file and loaded through the real `#importProjectFile` control via `DOM.setFileInputFiles` + a
dispatched `change` event — the same code path a human user's file picker triggers.

| Example | Import | Live stone count | Baseline stone count | Match | Export (Layout JSON + SVG) | Console errors |
|---|---|---|---|---|---|---|
| short-name-block.rhs | OK | 124 | 124 | yes | OK | 0 |
| long-name-autofit.rhs | OK | 393 | 393 | yes | OK | 0 |
| script-name-great-vibes.rhs | OK | 234 | 234 | yes | OK | 0 |
| monogram-outline.rhs | OK | 134 | 134 | yes | OK | 0 |
| monogram-fill.rhs | OK | 216 | 216 | yes | OK | 0 |
| circle-only.rhs | OK | 82 | 82 | yes | OK | 0 |
| mixed-all-layers.rhs | OK | 327 | 327 | yes | OK | 0 |
| wide-wrap-dark-cup.rhs | OK | 229 | 229 | yes | OK | 0 |
| long-script-name.rhs | OK | 595 | 595 | yes | OK | 0 |

**Every live browser-driven stone count matched the Node-computed committed baseline exactly.**
This is a meaningful cross-check, not a tautology: the browser path runs entirely inside `app.js`'s
own unmodified `GeometryEngine.generate()`/`generateTextStonesLive()`/`generateShapeStonesLive()`/
`dedupe()` (real DOM, real event handlers, real `updateAll()`), while the Node path runs
`tools/lib/rhsProject.mjs`'s independent port of the same algorithm against the permanent engine
directly. Their agreement across all 9 imported examples confirms the port is faithful and that
the app-shape translation preserves every parameter that affects geometry.

Total console errors across all 9 imports + exports: **0**. Total uncaught exceptions: **0**.
`document.getElementById('layoutStats')` and `#cupStats` updated correctly after every import;
`#status` read `Imported <file>: N layer(s)` on success and `Downloaded rhinestone-layout.json` /
`Downloaded rhinestone-layout.svg` after each export click — no `Import failed:` or
`Export failed:` message was ever observed.

Screenshots captured (in the session scratchpad, reviewed visually) for all 9 examples:
`short-name-block.png`, `long-name-autofit.png`, `script-name-great-vibes.png`,
`monogram-outline.png`, `monogram-fill.png`, `circle-only.png`, `mixed-all-layers.png`,
`wide-wrap-dark-cup.png`, `long-script-name.png`.

---

# Readability Review (human-review, screenshots inspected visually)

Automated tests cannot prove readability. This table covers only the 9 examples actually
visually inspected above; no readability claim is made for the other 6 new examples or the 2
preserved fixtures, which were verified only for correct generation/geometry, not visual
readability.

| Example | Readable in 2D | Readable on cup | Clipping | Obvious overlaps | Visual note |
|---|---|---|---|---|---|
| short-name-block.rhs | PASS | PASS | No | No | Clean gold block letters, high contrast. |
| long-name-autofit.rhs | PASS | PASS | No | No | Auto-fit compresses text to 11.2mm tall (200.8mm wide); legible but visibly dense — expected for a 24-character name auto-fit to a 210mm mug wrap. |
| script-name-great-vibes.rhs | PASS | PASS | No | No | Great Vibes cursive is crisp and fully connected at this size/stone density. |
| monogram-outline.rhs | PASS | PASS | No | No | Bold 3-letter monogram, strong contrast (Crystal AB on black). |
| monogram-fill.rhs | PASS | PASS | No | No | Dense fill sampling reads as solid letterforms, not a sparse dot pattern. |
| circle-only.rhs | PASS | **PARTIAL** | No | No | `wrap:"full"` spreads the 30mm-radius circle's stones around the entire cup circumference; only a thin front-facing arc is visible from a single view angle. This is `wrap:"full"`'s intended behavior (matches the existing per-wrap-mode geometry, unchanged by this milestone), not a defect — but it is a genuinely low cup-readability case worth flagging for anyone authoring a full-wrap circular design. |
| mixed-all-layers.rhs | PASS | PASS (circle subtle) | No | No | Hidden rectangle layer correctly excluded from generation and shown unchecked in the Layers list, confirming visible:false round-trips correctly end-to-end. The visible accent circle renders faintly against the red cup. |
| wide-wrap-dark-cup.rhs | PASS | PASS | No | No | Silver-on-black is high contrast, fully legible. |
| long-script-name.rhs | PASS | **MARGINAL** | No | No | Auto-fit compresses a 34-character 3-word script name to 21.2mm tall over 200.3mm; readable in the zoomed 2D layout, but individual letters visually blur together at the cup preview's actual on-screen scale. A real product characteristic of long script names under auto-fit, not a code defect — no fix was made (see "Defects Discovered"). |

---

# Visible Changes

None to the live application (`app.js`/`index.html`/`style.css`/`src/**` are unmodified). This
milestone is additive test/fixture infrastructure: `examples/` now contains 17 `.rhs` fixtures, a
manifest, and a committed baseline, plus a new `npm test` suite and a manual baseline-regeneration
script.

---

# Defects Discovered

1. **`StoneLayout.toJSON()`/`fromJSON()` round-trip is not bit-exact for `widthMm`/`heightMm`/
   `boundingBox` on some real inputs** (found via `large-stones-wide-gap.rhs`:
   `widthMm: 40.527652` vs `40.527651` — a 1-nanometer discrepancy). Root cause: `toJSON()` rounds
   `widthMm`/`heightMm` (derived from un-rounded stone coordinates) to 6 decimals, but `fromJSON()`
   rebuilds stones from those *already-rounded* coordinates, so re-deriving width/height from the
   *reconstructed* layout can differ from the original by up to 1 unit in the 6th decimal. This is
   an inherent property of rounding twice, not a bug introduced by this milestone, and it is
   manufacturing-irrelevant (sub-nanometer at this scale). **Not fixed** — `src/geometry/**` is
   forbidden for this milestone, the discrepancy is real but harmless, and a real fix (e.g.
   deriving bounds strictly from already-rounded stones in both directions) is a `src/geometry`
   design decision outside this milestone's scope. Test 12 was written with a `1e-5mm` tolerance
   on the affected derived fields instead, documented inline with the root cause. Recorded here as
   a candidate for a future `src/geometry` precision-hygiene milestone.
2. **The `#cupColor`/`#wrap` `<select>` elements do not resync after a Project JSON import**
   (found via browser screenshot review, not the automated suite). `app.js`'s
   `syncSelectedControlsFromLayer()` only syncs layer-level fields (text/font/height/stoneSize/
   gap/color) from the imported project; it never sets `el('cupColor').value`/`el('wrap').value`
   from `project.cupColor`/`project.wrap`. The underlying render is correct — `drawCup()` reads
   `project.cupColor`/`project.wrap` directly and every screenshot shows the *correct* cup color —
   only the sidebar dropdown's displayed label can be stale immediately after import (e.g.
   `short-name-block.rhs` sets `cupColor:"#f1d7a9"` and the cup renders cream/tan correctly, but
   the `#cupColor` dropdown still reads "Navy" until the user touches it). **Not fixed** — `app.js`
   is a forbidden file for this milestone, and the defect is cosmetic (a stale dropdown label), not
   a geometry/manufacturing/export defect. Documented here as a genuine, small, pre-existing gap
   for a future UI milestone to pick up (one-line fix:
   `syncSelectedControlsFromLayer()` should also set `el('cupColor').value=project.cupColor` and
   `el('wrap').value=project.wrap`).

Neither defect affects `StoneLayout`, exported files, or manufacturing accuracy. Both are recorded
per the milestone brief's "document the defect" instruction for issues outside this milestone's
small-and-necessary-fix threshold.

---

# Warnings

* The `.rhs` schema and `app.js`'s ad hoc schema are genuinely different pre-existing formats (see
  "Resolved Discrepancy"). Anyone hand-authoring a new `.rhs` example must use the mm-suffixed
  field names (`heightMm`/`stoneSizeMm`/`gapMm`, `cxMm`/`cyMm`/`radiusMm`,
  `xMm`/`yMm`/`widthMm`/`heightMm`), not `app.js`'s field names — `tools/lib/rhsProject.mjs`'s
  `validateRhsProject()` will reject the wrong shape with a specific error either way.
* `examples/baselines.json` is a committed, human-reviewed artifact. It was generated once this
  milestone via `node tools/generate-example-baselines.mjs` and reviewed before committing. Anyone
  intentionally changing example geometry in the future must re-run that script deliberately and
  review the diff — `npm test` will never regenerate it silently.
* Circle/rectangle shape layers are always sampled in `'outline'` mode in both the `.rhs` loader
  and the live app (`generateShapeStonesLive()` hardcodes `mode:'outline'`) — a per-layer `mode`
  field on a shape layer would be silently ignored by both paths. No example relies on shape fill
  mode; this mirrors existing, unchanged `app.js` behavior.

---

# Known Limitations

* `app.js`'s ad hoc project/layer object shape remains unmigrated to `src/core/Project.js`/
  `Layer.js`, and now a *third* schema (`.rhs`) is formally documented as a permanent fixture
  format — out of scope to reconcile this milestone (see "Next Recommended Task").
  `docs/specifications/RS-0003.5E1-RealProductionValidation.md` records the full reasoning.
* The cross-layer `dedupe()` merge step still lives only in `app.js`'s local orchestration class
  (and, for this milestone's test purposes, is faithfully ported into
  `tools/lib/rhsProject.mjs`) — not in the permanent `src/geometry/GeometryEngine.js`. Unchanged,
  pre-existing architectural gap.
* The two `StoneLayout`/UI defects above are documented, not fixed (out of scope / cosmetic).
* Readability was visually verified only for the 9 examples actually imported into the browser;
  the other 6 new examples and both preserved fixtures are verified only for correct, deterministic
  geometry generation (automated suite), not visual readability.
* No DXF export, manufacturing reports, product-plugin system, or 3D/WebGL renderer exist yet —
  unchanged from all prior milestones.

---

# Next Recommended Task

Reconcile the now-three project schemas (`app.js`'s ad hoc live-editor schema, `src/core/Project.js`/
`Layer.js`, and this milestone's formally-documented `.rhs` interchange schema) into one, so the
live app, its import/export, and the permanent regression fixtures all speak the same project
format. A smaller, faster follow-up: fix the two cosmetic/precision defects recorded above
(`#cupColor`/`#wrap` dropdown resync on import; `StoneLayout` round-trip rounding-composition
tolerance) in a dedicated small UI/precision-hygiene milestone.
