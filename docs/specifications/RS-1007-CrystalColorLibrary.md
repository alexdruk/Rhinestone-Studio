# RS-1007 — Crystal Color Library

## Objective

Replace the small, 7-entry hard-coded stone-color list (`src/renderer/StoneColors.js`) with a
permanent, reusable crystal-color catalog of at least 17 named colors, and give the UI a visible,
organized selector to choose among them. Every existing consumer (2D canvas, cup/mug preview,
3D preview, SVG export, Production Sheet export) must resolve colors from the same catalog, so
"2D and 3D previews use the same color definition" keeps holding after the catalog grows.

This is a data/UI milestone. It does not touch geometry, sampling, or the `StoneLayout` product.

---

## Current Repository State

* `src/renderer/StoneColors.js` exports `STONE_COLORS`, a plain object keyed by 7 lowercase ids
  (`crystal`, `gold`, `silver`, `jet`, `rose`, `sapphire`, `emerald`), each a
  `{ name, fill, stroke, shine, accent }` record. This is display-only metadata — `Stone.color` is
  a free string (see `src/geometry/Stone.js`'s `DEFAULT_STONE_COLOR = 'Crystal AB'`); nothing in
  `src/geometry/**` validates it against this list.
* Five modules resolve a stone's color the same way — `STONE_COLORS[stone.color] || STONE_COLORS.<fallback>`
  — and are the *only* consumers: `src/renderer/CanvasRenderer2D.js` (2D production canvas + cup
  preview via `drawStone()`), `src/preview3d/StoneLayoutTexture.js` (3D preview's canvas texture),
  `src/export/SvgExporter.js` (2D SVG export, already emits `data-color="<id>"` per `<circle>` as
  of RS-0003.5D1), and `src/export/ProductionSheetExporter.js` (stone circles + a "Crystal color:
  ..." header line built from `STONE_COLORS[stone.color]?.name`). `src/renderer/CupRenderer.js` is
  legacy/unused-in-the-live-app but still tested; it never imports `STONE_COLORS` directly (it
  reuses `CanvasRenderer2D.drawStone()`).
* `app.js` imports `{ STONE_COLORS }` from `./src/renderer/StoneColors.js` (this exact import line
  is asserted verbatim by `tools/test-app-module-migration.mjs` and
  `tools/test-render-export-pipeline.mjs`) and uses it only to read `.name` for the Object Preview
  stats line. `index.html`'s `<select id="stoneColor">` hardcodes 7 flat `<option>`s, one per
  existing key, with no visual swatch and no grouping.
* Because every consumer keys off `STONE_COLORS[stone.color]`, growing the catalog's *content*
  requires no change to any of the five renderer/exporter files — they are already
  catalog-generic. The only code that needs new logic is the catalog itself and `app.js`'s color
  picker UI.
* Two pre-existing structural guard tests (`tools/test-object-template-integration.mjs`,
  `tools/test-cup-rotation-stabilization.mjs`) hard-code `'src/renderer/StoneColors.js'` in a
  `forbiddenExactWithinPrefix` set, left over from milestones (RS-1004, S-001) where that file was
  legitimately out of scope. Per this repository's own established precedent (e.g. RS-1005's
  `src/export/` carve-out comment in several of these same guards), this milestone updates both
  sets with a comment, since this milestone is the legitimate reason `StoneColors.js` now changes.

---

## Expected Visible Change

* The "Stone color" control in the left panel shows all 17 catalog colors, grouped into labeled
  `<optgroup>`s (Clear & Neutral / Red & Pink / Purple & Blue / Green & Aqua / Yellow & Amber /
  Metallic) instead of one flat list of 7.
* A small color swatch next to the selector shows the selected color's actual preview color and
  updates live when the selection changes, when a different layer is selected, and after
  undo/redo/import restores a different color.
* Every layer type (text, curved text, shape, SVG) can be assigned any of the 17 colors and it
  renders identically in the 2D Production Layout and the 3D Object Preview.
* Every export (Project JSON, Generated Layout JSON, 2D SVG, 2D PNG, Object Preview PNG,
  Production Sheet SVG/PNG/PDF) reflects the chosen color exactly as it already does for the
  original 7 — no export format changes shape.
* Existing saved `.rhs`/Project JSON files that reference `crystal`, `gold`, `silver`, `jet`,
  `rose`, `sapphire`, or `emerald` open and render pixel-identical to before this milestone.

---

## Required Outcome

1. **Permanent catalog module** — a single source-of-truth module defining at least the 17
   required colors (Crystal, Crystal AB, Jet, Siam, Light Siam, Rose, Fuchsia, Amethyst, Sapphire,
   Light Sapphire, Aquamarine, Emerald, Peridot, Topaz, Citrine, Gold, Silver), each with:
   * a stable, unique, lowercase-kebab `id` (the same string stored on `Stone.color` /
     `layer.color`),
   * a display `name`,
   * a `previewColor` (hex),
   * optional `highlight`/`shadow` hex fields,
   * the existing `fill`/`stroke`/`shine`/`accent` render-channel fields every current consumer
     already reads (kept so no renderer/exporter needs to change), aliased 1:1 to
     `previewColor`/`shine`/`accent` respectively so both naming schemes always agree,
   * a `group` label used only for organizing the UI selector.
2. **Backward compatibility** — the 7 pre-existing ids keep their exact `fill`/`stroke`/`shine`/
   `accent` hex values (byte-identical), so any project saved before this milestone renders
   unchanged. `jet`'s display name changes from "Jet Black" to "Jet" (still the same id, same
   colors) to match the required name list; this is a label-only change with no id/value change.
3. **Compatibility shim** — `src/renderer/StoneColors.js` keeps exporting `STONE_COLORS` (same
   shape: an id-keyed object) from the same file path, so its five existing consumers and app.js's
   import line need zero changes.
4. **UI selector** — `app.js` populates `<select id="stoneColor">` from the catalog at startup
   (grouped `<optgroup>`s, catalog order), and a color swatch element shows/updates the live
   preview color. No native `<select>` replacement framework/library is introduced.
5. **Metadata preservation** — verified (not re-implemented, since the existing generic
   `STONE_COLORS[stone.color]` lookups already extend to new ids with no code change):
   Project JSON / Generated Layout JSON preserve the raw color id string; SVG keeps its
   `data-color` attribute plus `fill`/`stroke`; Production Sheet keeps its "Crystal color: ..."
   header line and per-stone `fill`/`stroke`; 2D PNG / 3D preview PNG are canvas captures of
   renderers already reading the shared catalog.
6. **No geometry change** — `src/geometry/**` (including `GeometryEngine.js`, `StoneLayout.js`,
   `Stone.js`) is untouched. `Stone.color` remains a free string; this milestone does not add
   catalog-id validation to `Stone`/`GeometryEngine`.
7. **No trademarks / no exact-match claim** — color names are generic gemstone/color words already
   in common use for rhinestone color families; no manufacturer name or logo is referenced, and the
   catalog module's header comment states these are decorative approximations, not calibrated to
   any specific manufacturer's product line.

---

## Architecture Requirements

* Keep the "one source of truth" rule: the new catalog lives in `src/renderer/**` (rendering-only
  display metadata, exactly like the file it replaces — never imported by `src/geometry/**`).
* `src/geometry/GeometryEngine.js`, `src/geometry/StoneLayout.js`, `src/geometry/Stone.js` are not
  modified.
* `src/renderer/CanvasRenderer2D.js`, `src/renderer/CupRenderer.js`, `src/preview3d/StoneLayoutTexture.js`,
  `src/export/SvgExporter.js`, `src/export/ProductionSheetExporter.js` are not modified — they
  already generalize to any `STONE_COLORS` entry.
* `app.js` continues to import only permanent-module barrel/leaf entry points already on its
  approved-import list (`tools/test-app-module-migration.mjs`); no new import line is needed since
  the catalog is reached through the existing `StoneColors.js` import.

---

## Allowed Files

* New: `src/renderer/CrystalColors.js` (catalog).
* Modified: `src/renderer/StoneColors.js` (becomes a re-export shim), `app.js` (selector
  population + swatch wiring), `index.html` (swatch element + inline `<style>` additions —
  `style.css` itself stays untouched), `src/renderer/README.md`, `docs/ARCHITECTURE.md`
  (implementation-status note only), `package.json` (register new test files),
  `tools/test-object-template-integration.mjs`, `tools/test-cup-rotation-stabilization.mjs` (drop
  the now-stale `StoneColors.js` entry from their own forbidden-file guards, per precedent).
* New tests: `tools/test-crystal-color-catalog.mjs`, `tools/test-crystal-color-integration.mjs`.
* `TASK.md`, `TASK_RESULT.md`, this specification.

## Forbidden Files

* `src/geometry/**`, `src/text/**`, `src/fonts/**`, `src/core/**`, `src/browser/**`, `src/svg/**`,
  `src/history/**`, `src/products/**`, `src/preview3d/ObjectGeometryBuilder.js`,
  `src/preview3d/Preview3DRenderer.js`, `src/preview3d/ObjectDimensions.js`, `src/preview3d/index.js`,
  `assets/**`, `examples/**`, `style.css`, `README.md`, `LICENSE`, `CONTRIBUTING.md`.
* `src/renderer/CanvasRenderer2D.js`, `src/renderer/CupRenderer.js`,
  `src/preview3d/StoneLayoutTexture.js`, `src/export/SvgExporter.js`,
  `src/export/ProductionSheetExporter.js` — the catalog change must not require touching these.

## Out of Scope

* Fixing S-004 (duplicated text visible in some 3D preview cases) — deferred, unless the crystal
  color work directly exposes its root cause (it does not: S-004 is a geometry/material defect,
  unrelated to color data).
* DXF export, manufacturing reports, PBR/lighting changes.
* Adding catalog-id validation inside `Stone`/`GeometryEngine` (color stays a free string, matching
  current architecture).
* A custom swatch-grid picker widget replacing the native `<select>` — an organized, grouped
  native select plus a live swatch satisfies "visible, organized" without a new UI framework.

---

## Automated Tests

`tools/test-crystal-color-catalog.mjs`:
* exactly the 17 required display names are present in the catalog;
* every `id` is a non-empty, unique, lowercase-kebab string;
* every entry has a valid-hex `previewColor` and `name`; `highlight`/`shadow`, when present, are
  valid hex;
* the 7 pre-existing ids (`crystal`, `gold`, `silver`, `jet`, `rose`, `sapphire`, `emerald`) keep
  their exact original `fill`/`stroke`/`shine`/`accent` hex values;
* `STONE_COLORS` (re-exported from `StoneColors.js`) is reference-identical / value-identical to
  the catalog's id-keyed map;
* the catalog's own validator function throws for a deliberately malformed fixture (duplicate id,
  missing name, invalid hex) and does not throw for the shipped catalog.

`tools/test-crystal-color-integration.mjs`:
* `index.html`'s `#stoneColor` select has no hardcoded `<option>` (populated by `app.js`) and a
  swatch element exists;
* `app.js` builds `<optgroup>`s from the catalog's `group` field and updates the swatch;
* `stoneColor` remains in `HISTORY_TRACKED_CONTROL_IDS` (undo/redo keeps working);
* `defaultProject()`'s default layer color (`'gold'`) still resolves to a valid catalog entry;
* Project JSON import round-trips an arbitrary new-catalog color id (e.g. `'topaz'`) without loss,
  and `validateProject()` does not reject/alter it;
* SVG export emits the correct `fill`/`stroke`/`data-color` for a new-catalog color, proving the
  existing generic lookup extends to it with no exporter change;
* Production Sheet export's header lists the correct color name for a new-catalog color;
* 2D canvas renderer (`drawStone`) and 3D texture (`StoneLayoutTexture`) resolve a new-catalog
  color to the exact same `fill`/`stroke`/`shine` triple (renderer consistency);
* none of the five forbidden renderer/exporter files, and no `src/geometry/**` file, appear in
  `git status --porcelain` (this milestone's own forbidden-file guard).

All 32 pre-existing suites must remain green, unmodified in assertions (only the two documented
`forbiddenExactWithinPrefix` guard updates).

---

## Browser/Manual Verification

Via a static file server and a real (or CDP-driven headless) browser session:
* load the app, confirm the Stone color selector shows grouped optgroups with all 17 names and a
  swatch that updates on selection;
* assign several different new colors (e.g. Siam, Topaz, Aquamarine) to different layer types
  (text, curved text, circle/rectangle, SVG) and confirm the 2D layout and 3D Object Preview show
  the correct, matching color for each;
* test against both a light and a dark Preview background;
* save (export) Project JSON, reload the page, import it back, confirm colors are unchanged;
* undo/redo a color change and confirm the swatch/selector track the restored value;
* run every export (Project JSON, Generated Layout JSON, 2D SVG, 2D PNG, Object Preview PNG,
  Production Sheet SVG/PNG/PDF) and spot-check the new colors appear correctly;
* confirm zero unexpected console errors (only the pre-existing, already-documented `/favicon.ico`
  404 is expected).

---

## Acceptance Criteria

* `npm test` passes in full (0 failures).
* The 17 required colors exist in the catalog with the required fields; the 7 legacy ids are
  byte-identical to before.
* The color selector is visibly organized and shows a live swatch.
* All five renderer/exporter consumer files are untouched (verified by the new guard test).
* Browser verification performed and documented with real observations, not assumptions.
* `TASK_RESULT.md` completed honestly, including any warnings/limitations.

---

## Implementation Constraints

* No new dependency. No bundler. Keep vanilla JS/ES modules.
* Keep the smallest coherent change — do not touch `GeometryEngine`/`StoneLayout`/renderer/exporter
  internals.
* Preserve every existing export button id, filename, and DOM id.

---

## Required Commands

```bash
npm test
git diff --check
git status
```

Browser verification via `python3 -m http.server` (or equivalent) plus a real/headless browser
session, per `docs/AI_ENGINEER.md`.

---

## Commit Message

```
feat(colors): add 17-color crystal color library and organized selector (RS-1007)
```

## Deliverables

* `src/renderer/CrystalColors.js`, updated `src/renderer/StoneColors.js`, `app.js`, `index.html`.
* `tools/test-crystal-color-catalog.mjs`, `tools/test-crystal-color-integration.mjs`, and the two
  updated forbidden-file guards.
* This specification, `TASK.md`, `TASK_RESULT.md`.
* One commit on `feature/rs-1007-crystal-color-library`.

## Next Milestone

Candidates: DXF export; investigating S-004 (duplicated text in some 3D preview cases); converging
the two unreconciled project/layer models (`src/core/**` vs. `app.js`'s ad hoc project object).
