# Rhinestone Studio — Task Result

This document is completed by the implementation engineer after finishing the current task.

---

# Task ID

RS-1004 — Multi-Object Templates

---

# Status

IMPLEMENTED

---

# Branch

feature/rs-1004-multi-object-templates

---

# Commit

Do not write the current commit hash into this file — this file is part of the same commit it
describes. Obtain it from Git history with:

```bash
git log -1 --oneline
```

---

# Summary

One rhinestone design can now be previewed and produced against three physical object templates —
Mug, Straight Tumbler, and Bottle — switchable from a new, always-visible "Object type" control at
the top of the sidebar. This activates the previously-inert `src/products/**` module and
`project.product` field (both existed since earlier milestones but nothing read them) instead of
creating a second product abstraction, per the milestone's implementation rule.

`src/products/ObjectTemplate.js` defines a small, validated registry of three templates, each a
plain data record: display name, `productionWidthMm`/`productionHeightMm`, a `safeAreaInsetMm`, a
supported/default wrap mode, and schematic preview-silhouette parameters. Switching the control is
one discrete, undoable action (matching the existing `addCircle`/`addRect`/`deleteLayer` pattern):
it sets `project.product` and resets `project.canvas`/`project.wrap` to the new template's
defaults, then regenerates/redraws exactly like any other discrete edit.

`src/renderer/CupRenderer.js`'s `renderCup()` was generalized — not duplicated — into three
silhouette variants (mug: tapered body + handle; straight tumbler: equal top/bottom width, no
handle; bottle: narrower body + shoulder/neck/cap, no handle) sharing one frustum + stone-wrap-
placement math that was already object-agnostic. Omitting the new `objectTemplate` option falls
back to `DEFAULT_PREVIEW`, whose values are byte-identical to the pre-milestone hardcoded mug
constants — proven by a test that asserts an omitted-option call and an explicit-mug-template call
produce identical draw-call sequences.

A safe-area guide (a dashed rectangle derived from the active template's `safeAreaInsetMm` at the
current canvas size) is drawn on the 2D Production Layout canvas as a new `app.js` editor overlay
(`drawSafeAreaGuide()`), alongside the pre-existing selection-outline/HUD-text overlays — not inside
`CanvasRenderer2D.js`, which (like `StoneLayout.js` and `GeometryEngine.js`) is untouched by this
milestone.

`src/geometry/**` was not touched. `StoneLayout` was not touched. A dedicated test proves the merged
`StoneLayout` for the default text layer is byte-identical across all three object templates —
object type only ever changes what is drawn, never what is generated.

---

# Files Changed

```
src/products/ObjectTemplate.js        (new — template registry: createObjectTemplate() validation,
                                       getObjectTemplate()/isValidObjectTemplateId() with permissive
                                       mug fallback, getSafeAreaRectMm(), the mug/tumbler/bottle
                                       definitions)
src/products/index.js                 (new — barrel export)
src/products/README.md                (documents the new object-template registry)
src/renderer/CupRenderer.js           (renderCup(): generalized to three preview.kind variants from
                                       one shared frustum/wrap-math core; new DEFAULT_PREVIEW
                                       fallback = exact pre-milestone mug constants; new
                                       drawBottleTop()/roundRectPath() helpers)
app.js                                (imports getObjectTemplate/getSafeAreaRectMm;
                                       currentObjectTemplate() helper; validateProject() normalizes
                                       project.product via getObjectTemplate() [permissive mug
                                       fallback]; syncSelectedControlsFromLayer() resyncs
                                       #objectType; drawCup() forwards objectTemplate;
                                       drawSafeAreaGuide() new editor-overlay helper, called from
                                       drawLayout(); updateStats() shows the active template's
                                       display name; #objectType change handler: discrete
                                       commitHistory()-then-mutate action resetting
                                       canvas/wrap to the new template's defaults)
index.html                            (new #objectType <select> at the very top of the sidebar,
                                       before #selectedLayer; "Cup Preview"/"Cup background"
                                       relabeled to "Object Preview"/"Preview background" — #cup
                                       canvas id, #cupColor control id, and the exported PNG
                                       filename are all unchanged)
docs/ARCHITECTURE.md                  ("Product Plugins" implementation-status section updated from
                                       "not implemented" to describe the live implementation; Layer
                                       map table and Orchestration Layer section note the new
                                       src/products/** module)
docs/specifications/RS-1004-MultiObjectTemplates.md (new specification)
TASK.md                               (replaced with this task)
TASK_RESULT.md                        (this file)
package.json                          (registers the three new test files in the `test` script)
tools/test-object-template.mjs               (new — 17 tests, template registry validation)
tools/test-object-preview-renderer.mjs       (new — 8 tests, renderCup() silhouette/wrap-math tests
                                              against a fake CanvasRenderingContext2D)
tools/test-object-template-integration.mjs   (new — 21 tests, app.js/index.html wiring, backward
                                              compatibility, save/load round-trip, undo/redo,
                                              deterministic StoneLayout across templates, export
                                              compatibility, discoverability)
tools/test-app-module-migration.mjs          (narrow: added ./src/products/index.js to app.js's
                                              allowed-import list)
tools/test-shape-geometry-integration.mjs    (narrow: same allowed-import addition, this test has
                                              its own independent copy of that check)
tools/test-undo-redo-integration.mjs         (narrow: removed 'src/products/' from its
                                              forbidden-file-prefix list, with a comment explaining
                                              why — it was correctly forbidden at RS-1002 time when
                                              src/products/ had no code)
tools/test-curved-text-integration.mjs       (narrow: removed the src/renderer/ half of its
                                              "byte-for-byte untouched" check [kept the src/export/
                                              half, since this milestone does not touch
                                              src/export/**], with a comment explaining why)
tools/test-svg-integration.mjs               (its own extracted-validateProject() eval now injects
                                              the real getObjectTemplate as a function parameter,
                                              since validateProject() gained a new import dependency)
tools/test-examples-regression.mjs           (same extractValidateProject() fix as above)
```

No other file was changed. `src/geometry/**`, `src/text/**`, `src/fonts/**`, `src/core/**`,
`src/browser/**`, `src/svg/**`, `src/history/**`, `src/export/**`,
`src/renderer/CanvasRenderer2D.js`, `src/renderer/StoneColors.js`, `assets/**`, and `examples/**`
were not touched — verified by `tools/test-object-template-integration.mjs` test 21 and
`tools/test-object-preview-renderer.mjs` test 8.

---

# Commands Executed

```bash
npm test                # 27 suites, all pass (0 failures)
git diff --check         # clean
git status                 # only the files listed above
npm run dev                 # static file server on :5173, used for browser verification
```

---

# Automated Test Results

`npm test` passes in full — 27 suites, zero failures (24 pre-existing suites unchanged and green,
plus 3 new suites totaling 46 new tests):

```
Core model / Font manager / Vector path / FontProviderRegistry / OpenTypeProvider /
Default font provider registry / SVG parser / Arc projection / GeometryEngine /
Stone color / History manager tests passed.
Object template tests passed.                    (new, 17/17)
App module migration / Browser dependency loading / Live text integration /
Shape geometry integration / SVG integration / Undo/redo integration /
Curved text integration / UI discoverability tests passed.
Render/export pipeline / Production export validation / UX visual polish /
Cup rotation stabilization tests passed.
Object preview renderer tests passed.             (new, 8/8)
Object template integration tests passed.         (new, 21/21)
Examples regression suite passed.
```

Regression-proof highlights:

* `tools/test-object-preview-renderer.mjs` test 2 proves an omitted `objectTemplate` option
  produces the exact same draw-call sequence as explicitly passing the mug template — the
  strongest available proof that this milestone introduced zero behavior change for any caller
  that doesn't know about object templates.
* `tools/test-object-template-integration.mjs` test 15 generates the default project's `StoneLayout`
  under all three templates and asserts the stone arrays are byte-identical — proving object type
  never perturbs geometry.
* `tools/test-object-template-integration.mjs` tests 9-12 prove a pre-RS-1004 Project JSON (no
  `product` field) and an unrecognized `product` value both resolve to `'mug'` without throwing.
* All four pre-existing cup/renderer-related suites (`test-cup-rotation-stabilization.mjs`,
  `test-ux-visual-polish.mjs`, `test-production-export-validation.mjs`,
  `test-render-export-pipeline.mjs`) pass unmodified against the generalized `renderCup()`.

---

# Browser / Manual Verification

Performed via a from-scratch headless-Chrome/CDP driver (raw DevTools Protocol over Node's native
`WebSocket`, no new dependency — matching this repository's established precedent), against
`npm run dev` (static file server on `:5173`), Chrome launched headless with
`--window-size=1440,960`.

Verified, in one continuous session (screenshots captured, session-local, not committed):

* [x] Default project loads as Mug (`#objectType` = `mug`, `#wrap` = `front`, preview stats say
      "Mug") — unchanged from before this milestone (375 stones, 199.4×17.0mm).
* [x] Switch Mug → Straight Tumbler: `#objectType`/preview stats update, `#wrap` resets to the
      tumbler's default (`half`), the preview silhouette becomes a true straight-walled cylinder
      with no handle (416 stones after re-centering at the new 230×100mm canvas).
* [x] Switch Straight Tumbler → Bottle: `#wrap` resets to the bottle's default (`wide`), the preview
      silhouette becomes a neck+shoulder+cap bottle with no handle (323 stones at the new 180×90mm
      canvas).
* [x] Design remains visible (non-zero stone count, rendered in both the 2D layout and the object
      preview) for all three object types.
* [x] Swept all four wrap modes (`front`/`wide`/`half`/`full`) for all three object types — no
      thrown errors, cup canvas updates each time.
* [x] Safe-area guide: confirmed visually via full-resolution `#layout` canvas captures — a light
      dashed rectangle distinct from the (darker, tighter) selection outline, present and
      differently sized for mug vs. bottle (matching each template's own `safeAreaInsetMm` at its
      own canvas size).
* [x] Save/load round-trip: exported Project JSON while on Bottle (intercepted the real
      `URL.createObjectURL` Blob, not a re-implementation) — confirmed `product:"bottle"`,
      `canvas:{width:180,height:90}`, `wrap:"wide"` in the exported file; switched to Mug; imported
      the exported file back through the real `#importProjectFile` change handler via a genuine
      `File`+`DataTransfer` — `#objectType`/`#wrap` correctly restored to `bottle`/`wide`.
* [x] Undo/redo across an object-type switch: switched Bottle → Tumbler, clicked `#undoBtn` —
      `#objectType` correctly reverted to `bottle`; clicked `#redoBtn` — correctly reapplied
      `tumbler`.
* [x] All five exports (Project JSON, Generated Layout JSON, SVG, 2D PNG, Object Preview PNG)
      succeeded for Bottle — captured filenames are byte-identical to the pre-milestone names:
      `rhinestone-project.json`, `rhinestone-generated-layout.json`, `rhinestone-layout.svg`,
      `rhinestone-layout.png`, `rhinestone-cup-preview.png`.
* [x] Zero console errors/exceptions across the entire session (0 of 0 captured console messages
      were errors).
* [x] Screenshots captured for all three objects: `01-mug-default.png`, `02-tumbler.png`,
      `03-bottle.png` (full-panel), plus `layout-only-{mug,tumbler,bottle}.png` (zoomed 2D
      production canvas, showing the safe-area guide clearly) and `04`–`06` covering wrap sweep/
      import/undo-redo states.

---

# Warnings

* **Bottle/tumbler production canvas sizes are new defaults, not tuned to any specific commercial
  SKU.** `tumbler` (230×100mm) and `bottle` (180×90mm) were chosen to keep the same
  landscape-wrap-band aspect ratio the existing mug (210×90mm) already uses, so the default design
  stays visible and reasonably proportioned across all three without per-template layer
  repositioning (out of scope). A future milestone calibrating these against real product
  dimensions is a reasonable follow-up, not a defect — the milestone brief scoped preview/switching
  behavior, not manufacturing-calibrated dimensions for specific SKUs.
* **The bottle's schematic preview has no "mouth" ellipse** (unlike mug/tumbler) — its neck/cap
  drawing covers the top of the silhouette instead. This is an intentional, documented difference
  (see `CupRenderer.js`'s inline comments and `tools/test-object-preview-renderer.mjs` test 5), not
  an oversight.
* **Switching object type always resets `project.canvas`/`project.wrap` to the new template's
  defaults**, even if the user had customized `wrap` for the previous object type. There is no UI to
  edit `project.canvas` independently of object type today (true before this milestone too), so this
  is the only sane behavior; `wrap` reset is called out explicitly in the milestone brief ("wrap
  defaults where appropriate"). A future milestone could remember per-template wrap preferences if
  that proves desirable in practice.
* **Two pre-existing guard tests' forbidden-file lists were narrowed** (`tools/test-undo-redo-
  integration.mjs`, `tools/test-curved-text-integration.mjs`) and **two pre-existing tests' source-
  extraction eval calls were updated** (`tools/test-svg-integration.mjs`,
  `tools/test-examples-regression.mjs`) to inject the real `getObjectTemplate` as a function
  parameter, since `validateProject()` gained a new import dependency those tests extract and
  `eval()` in isolation. All four changes are narrow, commented, and necessitated by this
  milestone's legitimate scope — see `docs/specifications/RS-1004-MultiObjectTemplates.md`
  "Implementation Notes / Known Discrepancies" for the two forbidden-list changes specifically.

---

# Known Limitations

* No custom template editor (out of scope per the milestone brief) — templates are code-defined in
  `src/products/ObjectTemplate.js`.
* No arbitrary 3D meshes/WebGL — the object preview remains a schematic 2D Canvas rendering, exactly
  like the pre-existing mug preview.
* No per-object-type production-safe layer-placement warnings (a layer can still be positioned
  outside the active template's safe area; the safe-area guide is visual guidance only, not a
  validation gate) — flagged as a candidate next milestone below.
* Shirts/hats/bags, manufacturing nesting, and any `StoneLayout`/`GeometryEngine` schema change
  remain explicitly out of scope, unchanged from the milestone brief.

---

# Recommended Next Milestone

Per-object-type production-safe layer-placement guardrails (warn, don't block, when a layer's
stones fall outside the active template's safe area) — the safe-area guide added this milestone is
purely visual; turning it into an active (non-blocking) validation signal is a natural, contained
follow-up. Calibrating `tumbler`/`bottle` production dimensions against real commercial SKUs (see
"Warnings") is a second, independent candidate.
