# Rhinestone Studio — Task Result

This document is completed by the implementation engineer after finishing the current task.

---

# Task ID

RS-0003.5B3

---

# Status

IMPLEMENTED

---

# Branch

feature/m2-vector-text

## Process Note

The `feature/m2-vector-text` branch referenced by the previous `TASK.md` had already been
merged into `develop` and deleted (per `docs/MILESTONE_WORKFLOW.md`'s standard merge step —
see `develop`'s history: `0e6e6b9 Merge branch 'feature/m2-vector-text' into develop`). This
session recreated a branch with the same name from the current `develop` HEAD (`b761b38`) to
continue the same "vector text" milestone line for RS-0003.5B3, consistent with `TASK.md`'s
branch instruction. No push to `main` or `develop` was performed.

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
app.js                                              (modified — live text-layer generation via
                                                      the permanent GeometryEngine/OpenType
                                                      provider/FontManager chain; see below)
index.html                                          (modified — #font control now selects a
                                                      real bundled font instead of being
                                                      decorative)
package.json                                        (modified — added the new test file to the
                                                      "test" script)
tools/test-live-text-integration.mjs                (added — RS-0003.5B3 structural tests)
tools/test-app-module-migration.mjs                 (modified — three RS-0003.5B2-era guard
                                                      assertions that explicitly forbade this
                                                      milestone's required outcome were replaced
                                                      with assertions matching the new, still-
                                                      bounded import allow-list; one new false-
                                                      positive-prone CDN check was also narrowed
                                                      to real CDN hostnames instead of any
                                                      http(s):// substring, since app.js's own
                                                      SVG exporter legitimately contains
                                                      `xmlns="http://www.w3.org/2000/svg"`)
tools/test-browser-dependency-loading.mjs           (modified — the RS-0003.5B2 "FontManager is
                                                      not used for live font loading" assertion
                                                      against app.js was updated to assert the
                                                      opposite for app.js specifically, since
                                                      RS-0003.5B3 implements exactly that by
                                                      design; the probe-only assertions are
                                                      unchanged)
docs/specifications/RS-0003.5B3-LiveGeometryEngineIntegration.md   (added)
TASK.md                                             (rewritten for RS-0003.5B3)
TASK_RESULT.md                                      (this file)
```

No file under `src/geometry/**`, `src/text/**`, `src/fonts/**`, `src/core/**`,
`src/renderer/**`, `src/export/**`, `assets/**`, `examples/**`, `style.css`, `README.md`,
`LICENSE`, or `CONTRIBUTING.md` was changed — verified by `git status --porcelain` and by the
"no forbidden file changed" assertions in three separate test files.

## What changed in `app.js`

* Added imports: the permanent `GeometryEngine` (aliased `PermanentGeometryEngine`) from
  `./src/geometry/index.js`, `FontManager` from `./src/fonts/index.js`, and
  `createDefaultFontProviderRegistry` from `./src/text/index.js`, alongside the existing
  RS-0003.5B2 probe import.
* At startup, `FontManager.fromUrl('./assets/fonts/manifest.json')` loads the bundled font
  manifest, feeds `createDefaultFontProviderRegistry` (which registers `OpenTypeProvider`
  internally — app.js never references `OpenTypeProvider` by name, preserving the font-format
  boundary from `docs/ARCHITECTURE.md`'s "Text Engine" section), and constructs
  `new PermanentGeometryEngine({ fontProviderRegistry })`. Failure is caught; the app still
  boots (shapes still work) and surfaces the error via the `#status` line instead of crashing.
* The app-level (legacy) `GeometryEngine` class now takes this permanent engine in its
  constructor. Its `generate()` is `async`; for `type === 'text'` layers it now calls a new
  `generateTextStonesLive()` method that calls `permanentTextEngine.generateTextLayout({ text,
  fontId, layerId, heightMm: layer.height, stoneSizeMm: layer.stoneSize, gapMm: layer.gap,
  mode, color: layer.color })`, where `fontId` comes from the `#font` control (one of the two
  working bundled fonts) and `mode` maps the existing `#textMode` control's `stroke`/`fill`
  values onto the permanent engine's `outline`/`fill` sampling modes. `layer.color` (the app's
  color key, e.g. `'gold'`) is passed straight through, so it lands on every generated
  `Stone.color` unchanged — verified by the new tests and by browser export inspection.
* Auto-fit (`layer.autoFit`) is preserved: if the natural-height layout is wider than the
  canvas, the layer's `heightMm` is proportionally reduced and `generateTextLayout` is called a
  second time at the smaller size — this keeps `stoneSizeMm` fixed and shrinks the glyph size to
  fit, matching the old bitmap engine's auto-fit behavior (which also shrank glyph size, not
  final stone size).
* The resulting `StoneLayout`'s bounding box is centered in the project canvas by translating
  stone coordinates by a fixed offset — a display-position transform, not new geometry
  generation; stone size/spacing from the engine is untouched.
* Circle/rectangle generation (`generateCircle`, `generateRect`), `dedupe`, `bbox`, and the
  shared `line()` helper are unchanged and still run synchronously on the legacy path.
* The legacy bitmap text path (`FONT5`, `generateText`, `sampleGlyphFill`,
  `sampleGlyphStroke`) is **still present**, now unused for text generation, per the milestone's
  "do not remove the legacy engine until all remaining dependencies are identified" — `line()`
  is still shared with `generateRect`, so the class isn't yet cleanly separable.
* `updateAll()` is now `async` with a monotonic `generationToken` guard: if a newer generation
  starts before an older one resolves (e.g. rapid typing), the older result is discarded instead
  of overwriting the newer layout. Generation errors (e.g. an invalid gap value) are caught and
  surfaced via `#status` instead of crashing the app — verified in browser testing (see below).
* **Pre-existing defect fixed** (documented in the specification's "Current Repository State"):
  `el(id).addEventListener('input', updateAll)` passed the DOM `Event` object as `updateAll`'s
  `skipWrite` parameter, which is always truthy, so `writeSelectedControlsToLayer()` was
  **always skipped** on typed/selected input — verified against the unmodified baseline with a
  headless-Chrome round trip (dispatching an `input` event with new text left `#layoutStats`
  unchanged). This silently broke live editing for text, height, stone size, gap, colors,
  rotation/wrap/zoom text inputs, and shape X/Y/W/H, predating this milestone. Fixed with a
  one-line change (`el(id).addEventListener('input', () => updateAll())`) because it directly
  blocked demonstrating this milestone's core outcome (live regeneration on edit) and the fix
  is a minimal, obviously-correct wiring correction, not a redesign.
* `defaultProject()`'s default text layer now sets `font: DEFAULT_TEXT_FONT_ID`
  (`'courier-prime-regular'`) instead of the old decorative `'stroke'` value.

## What changed in `index.html`

* `#font`'s two options changed from decorative bitmap-engine labels (`Rhinestone Mono Stroke` /
  `Rhinestone Mono Fill`, values `stroke`/`block`, never actually read by the generator) to the
  two real, working bundled fonts: `courier-prime-regular` ("Courier Prime (monospace)",
  selected by default) and `great-vibes-regular` ("Great Vibes (script)"). The control's id,
  position, and role ("the font control") are unchanged. `RobotoMono-Regular.ttf` is
  deliberately **not** offered — it is a 14-byte placeholder file ("404: Not Found" text, not a
  real font) that `OpenTypeProvider` cannot parse; this is confirmed by the pre-existing
  `tools/test-opentype-provider.mjs` test ("throws a clear error for a corrupt or unparsable
  font file").

---

# Commands Executed

```bash
npm test
git diff --check
git status
npm run dev            # python3 -m http.server 5173
# curl-based static asset / MIME-type checks against http://localhost:5173/
# headless Google Chrome (OS-installed binary, isolated ephemeral --user-data-dir, no
# browser-automation dependency added), driven over raw CDP via Node's built-in fetch +
# WebSocket (no new package), for interactive verification and screenshots
```

---

# Test Results

## Automated Tests

PASS (all 11 suites, including the new one and the two updated ones):

```
node tools/test-core-model.mjs && node tools/test-font-manager.mjs && node tools/test-vector-path.mjs
  && node tools/test-font-provider-registry.mjs && node tools/test-opentype-provider.mjs
  && node tools/test-default-font-provider-registry.mjs && node tools/test-geometry-engine.mjs
  && node tools/test-stone-color.mjs && node tools/test-app-module-migration.mjs
  && node tools/test-browser-dependency-loading.mjs && node tools/test-live-text-integration.mjs
```

All pre-existing suites pass unchanged in behavior (67 pre-existing assertions across
`test-core-model`, `test-font-manager`, `test-vector-path`, `test-font-provider-registry`,
`test-opentype-provider`, `test-default-font-provider-registry`, `test-geometry-engine`,
`test-stone-color`). `test-app-module-migration.mjs` and `test-browser-dependency-loading.mjs`
pass with the specific, narrowly-scoped assertion updates described above. The new
`test-live-text-integration.mjs` (14 assertions) passes, covering: the three required imports,
live `FontManager.fromUrl` / `generateTextLayout` usage (not just import-only resolution),
async structure of `generate`/`generateTextStonesLive`/`updateAll`, preservation of the legacy
bitmap path, the legacy path no longer being called for text, shapes still using the legacy
path, no `src/core/**` import, the `#font` control offering only the two working fonts, the
`input`-listener fix, and the forbidden-file check.

`git diff --check` reported no whitespace errors. No `build` script exists in `package.json`, so
`npm run build` was not run (unchanged from prior milestones).

## Browser Verification

Ran `npm run dev` and drove `http://localhost:5173/` with curl and a from-scratch, dependency-free
CDP driver (Node 22's built-in `fetch`/`WebSocket` talking to headless Chrome's DevTools
Protocol — no Puppeteer/Playwright added, consistent with the RS-0003.5B2 precedent).

**Static asset / MIME checks** (all 200, correct content types): `/`, `/app.js`, `/index.html`,
`/src/browser/BrowserDependencyProbe.js`, `/src/geometry/index.js`,
`/src/geometry/GeometryEngine.js`, `/src/fonts/index.js`, `/src/fonts/FontManager.js`,
`/src/text/index.js`, `/src/text/OpenTypeProvider.js`, `/assets/fonts/manifest.json`,
`/assets/fonts/CourierPrime-Regular.ttf`, `/assets/fonts/GreatVibes-Regular.ttf`,
`/node_modules/opentype.js/dist/opentype.mjs`.

**Interactive checks** (all performed against the live app, not just read from source):

* [x] Page loads, `app.js` executes, no console errors during the load/interaction sequence
      below (verified with `window.onerror`/`unhandledrejection` listeners attached before any
      interaction — both arrays stayed empty across the whole happy-path sequence).
* [x] Default project renders text stones generated by the permanent engine: **375 stones,
      199.4×17.0 mm**, font Courier Prime, mode outline, auto-fit engaged (natural width at
      25 mm is 225.7 mm, wider than the 200 mm usable canvas, so the engine's `heightMm` is
      reduced and re-generated — confirmed this code path actually runs on the default
      project). Screenshot confirms real glyph outlines (not the 5×7 bitmap grid) in both the
      2D layout and the cup preview.
* [x] Typing in `#text` regenerates the layout live (exercises the `input`-listener fix):
      typing `"Hi"` produced **69 stones, 29.2×18.6 mm**, `selected: Hi` — confirmed against the
      unmodified baseline, which left the stats completely unchanged under the same input.
* [x] Switching `#font` from Courier Prime to Great Vibes changes the rendered stones: **98
      stones, 42.6×26.3 mm** for the same text (`"Hi"`, outline mode) — different glyph source,
      different geometry. Screenshot with `"Vitalina Serbin"` in Great Vibes + fill mode
      confirmed visually (script letterforms, sparse fill).
* [x] Switching `#textMode` between stroke (outline) and fill changes stone density/count:
      outline **98** stones vs. fill **29** stones for the same text/font.
* [x] Reverting text/font/mode to the defaults reproduced the exact original **375 stones,
      199.4×17.0 mm** — confirms determinism.
* [x] Shape layers still generate via the legacy path: `Add circle` → **419 stones** (text +
      circle), `Add rectangle` → **498 stones** (text + circle + rectangle); layer list grew to
      3 entries.
* [x] Cup preview renders the same stones as the 2D layout (confirmed visually via screenshot,
      and via non-uniform pixel sampling of the cup canvas).
* [x] Exports produce well-formed output referencing the live-generated stones: `Export Project
      JSON` → valid JSON, 1 layer, `text: "Vitalina Serbin"`; `Export Generated Layout JSON` →
      valid JSON, `count: 375`, bbox matching the on-screen stats; `Export 2D SVG` → starts with
      `<svg`, ends with `</svg>`, contains exactly 375 `<circle>` elements (matching the stone
      count).
* [x] Race-condition guard: simulated rapid keystroke-by-keystroke typing (25 sequential
      `input` events) followed immediately by resetting the text back to `"Vitalina Serbin"`
      produced the correct final state (375 stones, matching the deterministic baseline) with
      no stale/out-of-order overwrite and no console errors.
* [x] Error handling: setting gap to `-1` (a value the number input's `min="0"` does not hard-
      block from being typed) correctly threw inside the permanent engine
      (`RangeError: gapMm must be zero or positive.`), was caught by `updateAll()`, logged via
      `console.error`, and surfaced as `Text generation failed: gapMm must be zero or positive.`
      in `#status` — the app did not crash, and no unhandled promise rejection or uncaught
      `window` error occurred. Restoring gap to `0.3` and the text recovered the app to the
      normal 375-stone state.
* [x] No uncaught exception or unhandled rejection during any of the above interactions
      (explicitly instrumented and checked, not inferred).

**Not separately interactively verified in this session** (code paths not touched by this
milestone, so risk is low, but not click-tested): mouse drag-to-move/resize of shapes on the 2D
canvas, cup rotation drag, zoom slider, wrap-mode switching, PNG export byte-for-byte rendering
(SVG/JSON exports were verified; PNG export triggers the same unmodified `canvas.toBlob` code
path). A human should click through these before merge, consistent with `AI_ENGINEER.md`'s
"a passing test suite does not guarantee a successful implementation."

---

# Actual Default Stone Count and Bounds

**375 stones, 199.4 × 17.0 mm** (Courier Prime, outline/stroke mode, auto-fit engaged). This
differs from the RS-0003.5B1/B2 bitmap baseline (169 stones, 199.9 × 14.4 mm) — expected and
explicitly permitted by the milestone ("exact stone count does not need to match the bitmap
baseline"), since the geometry now comes from real vector glyph outlines instead of a 5×7 pixel
grid.

---

# Visible Changes

* Text layers render using real vector font outlines (Courier Prime by default, or Great Vibes)
  instead of the fixed 5×7 bitmap grid — different, more legible letterforms in both the 2D
  layout and the cup preview.
* The `#font` control (previously decorative, labeled "Font engine") is now labeled "Font" and
  actually selects between the two working bundled fonts.
* Typing/editing controls now visibly update the layout live, which they did not reliably do
  before this task (pre-existing defect, fixed as described above).
* Shape layers, cup preview projection/wrap, exports, and the project JSON format are visually
  and structurally unchanged.

---

# Warnings

* The pre-existing `input`-listener defect (see above) means that, before this task, typed edits
  across most controls silently never reached the project model in the deployed app — this was
  masked in prior milestones because interactive click-through of text editing was explicitly
  marked "unverified" in both the RS-0003.5B1 and RS-0003.5B2 `TASK_RESULT.md` reports. A human
  should be aware this bug existed in the merged `develop` branch prior to this task.
* Auto-fit now shrinks `heightMm` and regenerates via the permanent engine (an extra async
  `generateTextLayout` call) rather than shrinking a fixed bitmap grid; for the default project
  this means every regeneration involves two font-parse-cached engine calls instead of one. The
  parsed font is cached per `fontId` inside `OpenTypeProvider`, so this is not expected to be a
  meaningful performance concern, but was not benchmarked.
* Mouse-based shape drag/resize, cup rotation drag, zoom, and wrap-mode switching were not
  interactively re-verified in this session (unmodified code paths — see "Not separately
  interactively verified" above). A human should click through these before merge.
* `RobotoMono-Regular.ttf` remains a non-functional placeholder in `assets/fonts/manifest.json`;
  it is intentionally not exposed in the `#font` control.
* A pre-existing, unrelated cosmetic issue was observed during screenshot verification: the
  `#stoneSize` `<select>` shows blank instead of "2.0 mm" on load, because
  `syncSelectedControlsFromLayer()` sets `select.value = String(layer.stoneSize)` (`"2"`) but
  the matching `<option>`'s value is `"2.0"`, so no option matches. This predates this task
  (neither the default layer's `stoneSize` value nor that sync line were touched here) and does
  not affect generated geometry (the corresponding read path falls back to the correct default
  via `parseFloat(...)||2`). Left unfixed as out of scope.

---

# Known Limitations

* The legacy bitmap text engine (`FONT5`, `generateText`, `sampleGlyphFill`,
  `sampleGlyphStroke`) is still present in `app.js`, unused for text generation. It was kept per
  this milestone's explicit instruction not to remove the legacy engine until all remaining
  dependencies are identified — `line()`, `dedupe()`, and `bbox()` are still shared with shape
  generation. A follow-up milestone should confirm nothing else depends on the bitmap path and
  then delete it.
* Shape (circle/rectangle) generation still uses the legacy engine, per the milestone's explicit
  scope — not migrated to the permanent `GeometryEngine`/`ContourGeometry` pipeline.
  `app.js`'s ad hoc project/layer object shape was not migrated to `src/core/Project.js` /
  `Layer.js` — out of scope for this milestone.
* PNG export (`canvas.toBlob`) was not byte-inspected in this session (SVG/JSON exports were);
  it uses the same unmodified export code path already covered by prior milestones.

---

# Next Recommended Task

Either: (a) delete the now-fully-dead legacy bitmap text path once a human confirms the
permanent-engine text output is production-acceptable, or (b) migrate shape generation
(circle/rectangle) to the permanent `GeometryEngine`/`ContourGeometry` pipeline so `app.js`'s
legacy `GeometryEngine` class can eventually be retired entirely.
