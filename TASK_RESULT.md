# Rhinestone Studio — Task Result

This document is completed by the implementation engineer after finishing the current task.

---

# Task ID

RS-1013 — Variable Stone Sizes (Stone Library)

Task brief was labeled "RS-1010," but that id is already used (merged into `develop`) for the
Alignment & Snapping Upgrade. Filed as RS-1013, the next free id after RS-1012A — see
`docs/specifications/RS-1013-VariableStoneSizes.md`'s "Numbering note."

---

# Status

IMPLEMENTED

---

# Branch

feature/rs-1013-variable-stone-sizes

---

# Commit

Do not write the current commit hash into this file — this file is part of the same commit it
describes. Obtain it from Git history with:

```bash
git log -1 --oneline
```

---

# Summary

This was an audit-first milestone: before writing any code, `GeometryEngine`, `Stone`,
`StoneLayout`, every renderer/exporter, and `app.js`'s undo/redo/duplicate/save-load code were
read against the "allow per-layer stone size" feature list. The audit found per-layer variable
stone size **already fully implemented**:

* `GeometryEngine`'s six `generate*Layout()` methods (text — including curved text as a text-mode
  option, not a separate layer type — shape, svg, image, path) each already take their own
  independent `stoneSizeMm`/`gapMm`.
* `Stone` already carries an individual `sizeMm`; nothing assumes a uniform stone size across a
  `StoneLayout`.
* Every renderer/exporter (`CanvasRenderer2D.js`, `CupRenderer.js`, `StoneLayoutTexture.js` 3D
  preview, `SvgExporter.js`, `ProductionSheetExporter.js`) already draws each stone at its own
  `sizeMm` — mixing sizes across layers in one project already rendered/exported correctly with
  zero renderer-side special casing.
* `app.js`'s undo/redo (`HISTORY_TRACKED_CONTROL_IDS`), duplicate (`duplicateLayer()`'s whole-layer
  deep clone), and save/load (`JSON.stringify(project)`) were already fully generic over every
  layer field, `stoneSize` included.

**What was actually missing and added:** a named, extensible "Stone Library" catalog
(`src/renderer/StoneSizes.js`) mapping commercial rhinestone sizes to nominal millimeter diameters
— SS6 (2.0mm), SS10 (2.8mm), SS16 (4.0mm), SS20 (4.7mm), SS30 (6.4mm) — in the exact shape and
location as the pre-existing `CrystalColors.js` catalog (RS-1007), so adding a size later is one
list entry, never a switch statement. The one shared `#stoneSize` picker (relocated between the
inspector and whichever Lightbox is open, exactly like `#stoneColor`/`#gap` already are) is now
populated from this catalog at startup, showing "SS16 — 4.0 mm" instead of the previous
unnamed-mm-only list. Backward compatibility for a project saved before this milestone (whose
`stoneSize` may not match any catalog entry) is handled by a new `ensureStoneSizeOption()`, which
injects a truthful synthetic "Custom — X mm" option for the exact stored value rather than
silently snapping the displayed selection to the nearest *different* catalog size.
`ProductionSheetExporter.js`'s header gained the one required exporter change (per the "display
both commercial name and actual diameter" acceptance criterion): its "Stone size: ..." line now
reads e.g. "SS10 (2.8 mm), SS16 (4 mm), SS30 (6.4 mm)" for a mixed-size project, verified by
actually exporting a real Production Sheet SVG in the browser (see Browser Verification below), not
just a unit test.

**Architecture preserved exactly:** `GeometryEngine` remains the single authority for stone
placement; `StoneLayout` remains the single production representation; no renderer/exporter beyond
the one required Production Sheet header line changed; no parallel geometry generation was
introduced; `src/core/Layer.js`/`Project.js` remain unused by the live app (same documented,
pre-existing gap every prior `app.js`-only milestone has left alone).

---

# Files Changed

**New:**
* `src/renderer/StoneSizes.js` — the Stone Library catalog (SS6/SS10/SS16/SS20/SS30), lookup/
  validation helpers, mirroring `CrystalColors.js`.
* `docs/specifications/RS-1013-VariableStoneSizes.md` — full specification, audit findings,
  architecture, numbering note.
* `tools/test-stone-size-library.mjs` (10 assertions) — catalog correctness.
* `tools/test-variable-stone-sizes.mjs` (11 assertions) — end-to-end: every catalog size's geometry,
  mixed per-layer sizes across all seven layer/mode combinations in one combined layout, Production
  Sheet formatting, SVG export, `#stoneSize` picker wiring, `ensureStoneSizeOption()` custom
  fallback, undo/redo/duplicate/save-load genericity, new-layer inheritance, forbidden-file guard.
* `TASK_RESULT.md` (this file).

**Modified:**
* `app.js` — imports the catalog; `populateStoneSizeOptions()` (mirrors
  `populateStoneColorOptions()`); `ensureStoneSizeOption()` (legacy/custom-value fallback);
  `#stoneSize` sync call site updated.
* `index.html` — `#stoneSize` `<select>` now starts empty (populated by JS, like `#stoneColor`),
  gained a descriptive `title`.
* `src/export/ProductionSheetExporter.js` — new `formatStoneSizeList()` using the catalog's
  `formatStoneSizeLabel()`; the "Stone size: ..." header line now uses it. `distinctSizesMm` (the
  raw numeric array) is unchanged.
* `docs/ARCHITECTURE.md` — RS-1013 implementation-status addendum (audit summary + design) and a
  new Layer map row for `src/renderer/StoneSizes.js`.
* `package.json` — `test` script registers the two new test files.
* `TASK.md` — replaced with this milestone's brief (previous content was RS-1010's, already merged
  into `develop`).
* Eleven pre-existing milestone-scoped test files' own forbidden-file guards
  (`tools/test-app-module-migration.mjs`, `tools/test-shape-geometry-integration.mjs`,
  `tools/test-crystal-color-catalog.mjs`, `tools/test-crystal-color-integration.mjs`,
  `tools/test-preview3d-integration.mjs`, `tools/test-alignment-snapping-upgrade.mjs`,
  `tools/test-alignment-snapping-integration.mjs`, `tools/test-ui001b-fixes.mjs`,
  `tools/test-image-integration.mjs`, `tools/test-image-trace-regression.mjs`,
  `tools/test-path-boolean-integration.mjs`) — each extended with the same `allowedDespitePrefix`/
  `forbiddenExactWithinPrefix` exception for `src/renderer/StoneSizes.js` and/or
  `src/export/ProductionSheetExporter.js`, following this codebase's established convention (the
  RS-1008A/RS-1012 precedents already documented in those same files) of amending an older
  milestone's own guard when a later, legitimate milestone touches a previously-forbidden file. Two
  of these (`test-app-module-migration.mjs`, `test-shape-geometry-integration.mjs`) also needed
  their app.js-import allow-list regex extended for the new `StoneSizes.js` import.
* `tools/test-ux-visual-polish.mjs` — test 4 rewritten for the now dynamically-populated
  `#stoneSize` dropdown (previously asserted a static `<option>` list that no longer exists).

**Untouched (verified, not modified):** `src/geometry/**` (`GeometryEngine.js`, `Stone.js`,
`StoneLayout.js`, `StoneSampler.js`, `ContourGeometry.js`, `ArcProjection.js`, `PathBoolean.js`),
`src/renderer/CanvasRenderer2D.js`, `src/renderer/CupRenderer.js`, `src/renderer/CrystalColors.js`,
`src/renderer/StoneColors.js`, `src/export/SvgExporter.js`, `src/preview3d/**`, `src/text/**`,
`src/fonts/**`, `src/core/**`, `src/browser/**`, `src/svg/**`, `src/image/**`, `src/history/**`,
`src/products/**`, `src/editing/**`, `assets/**`, `examples/**`, `style.css`.

---

# Test Results

```
npm test
```

All 52 test suites pass, including the two new ones (`test-stone-size-library.mjs`,
`test-variable-stone-sizes.mjs`) and every pre-existing suite with an updated forbidden-file guard.

---

# Browser Verification

Performed with real headless Chrome via raw CDP (Node's built-in `WebSocket`/`fetch`, no
puppeteer dependency added), an isolated `--user-data-dir` temp profile, and a local
`python3 -m http.server` instance serving the repo — no existing Chrome window or profile was
touched; only the isolated instance and the local server this session started were closed at the
end.

Verified, with screenshots:
* `#stoneSize` picker populated from the Stone Library at load: `SS6 — 2.0 mm`, `SS10 — 2.8 mm`,
  `SS16 — 4.0 mm`, `SS20 — 4.7 mm`, `SS30 — 6.4 mm`.
* Changing stone size on every supported layer type: the default Text layer (SS30), a new Circle
  layer (SS16), a new Rectangle layer (SS10), a real SVG-file import via `DOM.setFileInputFiles`
  (SS6), a real PNG-file Image Trace import through its preview/commit flow (SS20), and Curved Text
  (toggled `curveEnabled` on the text layer with a distinct size) — each change regenerated the
  layout live with no console errors.
* A mixed-size project (5 layers, 5 different sizes) rendering correctly together on the 2D canvas,
  in Dual Workspace, and in the real WebGL 3D Object Preview (mug) — screenshots show visibly
  different stone footprints per layer.
* Production Sheet: opened the lightbox, and actually triggered the real "Export SVG" button
  (intercepting `URL.createObjectURL` to capture the generated blob rather than just calling the
  exporter function directly) — the exported SVG's header literally contains
  `Stone size: SS10 (2.8 mm), SS16 (4 mm), SS30 (6.4 mm)`, i.e. the real browser-triggered export
  path produces the commercial-name formatting, not just the unit-tested exporter function in
  isolation.
* Console/page-error listeners attached for the entire session: zero console errors and zero
  uncaught page exceptions across both verification passes (one pass without WebGL — headless
  Chrome's default GPU-disabled mode — confirmed the app still degrades to a clear
  `THREE.WebGLRenderer` initialization error with no crash; a second pass with SwiftShader software
  WebGL enabled confirmed the 3D preview renders correctly and that error disappears entirely). No
  favicon 404 was observed either way.

---

# Known Limitations

* Stone-size diameters in the catalog are nominal industry values (documented as such in
  `StoneSizes.js`'s header), not calibrated to any specific manufacturer's tolerance spec — the
  same posture `CrystalColors.js` already takes for its color values.
* The Stone Library is developer-editable (add an entry to `src/renderer/StoneSizes.js`), not
  end-user-editable through a UI — matches the ticket's "avoid hard-coded switch statements,
  configurable list" requirement at the code level; a runtime "add custom size to library" UI was
  out of scope.
* `src/core/Layer.js`/`Project.js` remain unused by the live application — a pre-existing,
  documented gap (see RS-1009/RS-1010/RS-1012's own specs) this milestone did not need to close.

---

# Next Recommended Step

None required for this milestone. Optional future follow-up: if the product wants end users to
define their own custom named stone sizes at runtime (not just developer-added catalog entries),
that would be a separate, explicitly-scoped milestone.
