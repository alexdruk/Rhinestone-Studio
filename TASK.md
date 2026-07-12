# Task

**Task ID:** RS-1007
**Task Type:** Feature — Crystal Color Library
**Specification:** `docs/specifications/RS-1007-CrystalColorLibrary.md`
**Status:** IN PROGRESS
**Branch:** feature/rs-1007-crystal-color-library

## Goal

Replace the small hard-coded 7-entry stone-color list (`src/renderer/StoneColors.js`) with a
permanent, reusable crystal-color catalog of at least 17 named colors, and give the UI a visible,
organized color selector. Every existing 2D/3D renderer and exporter must keep resolving colors
from the same single catalog.

## Required Outcome

See `docs/specifications/RS-1007-CrystalColorLibrary.md` in full. Summary:

* New `src/renderer/CrystalColors.js` catalog module: at least Crystal, Crystal AB, Jet, Siam,
  Light Siam, Rose, Fuchsia, Amethyst, Sapphire, Light Sapphire, Aquamarine, Emerald, Peridot,
  Topaz, Citrine, Gold, Silver. Each entry has a stable `id`, `name`, `previewColor`, optional
  `highlight`/`shadow`, a `group` (for UI organization), and the existing `fill`/`stroke`/`shine`/
  `accent` render-channel fields every current consumer already reads.
* `src/renderer/StoneColors.js` becomes a thin re-export shim (`STONE_COLORS`, same shape, same
  file path) so its five existing consumers (`CanvasRenderer2D.js`, `CupRenderer.js`,
  `StoneLayoutTexture.js`, `SvgExporter.js`, `ProductionSheetExporter.js`) and `app.js`'s import
  line need zero changes.
* The 7 pre-existing ids (`crystal`, `gold`, `silver`, `jet`, `rose`, `sapphire`, `emerald`) keep
  byte-identical `fill`/`stroke`/`shine`/`accent` values — existing projects render unchanged.
* `app.js`/`index.html`: `<select id="stoneColor">` is populated from the catalog with grouped
  `<optgroup>`s, plus a live color swatch. No hardcoded `<option>` list remains in `index.html`.
* `src/geometry/**` (GeometryEngine, StoneLayout, Stone) is untouched — `Stone.color` stays a free
  string, no catalog-id validation is added there.

## Rules

* Follow `docs/AI_ENGINEER.md`, `docs/CLAUDE_GUIDE.md`, `docs/ARCHITECTURE.md`.
* Smallest coherent change; no unrelated refactoring.
* Do not change `StoneLayout` geometry or `GeometryEngine` sampling.
* Do not modify `src/renderer/CanvasRenderer2D.js`, `src/renderer/CupRenderer.js`,
  `src/preview3d/StoneLayoutTexture.js`, `src/export/SvgExporter.js`,
  `src/export/ProductionSheetExporter.js` — the catalog's generic `STONE_COLORS[stone.color]`
  lookup already extends to every new color with no change to these files.
* Forbidden files: `src/geometry/**`, `src/text/**`, `src/fonts/**`, `src/core/**`,
  `src/browser/**`, `src/svg/**`, `src/history/**`, `src/products/**`, `src/preview3d/**`,
  `assets/**`, `examples/**`, `style.css`, `README.md`, `LICENSE`, `CONTRIBUTING.md`.
* Update the two pre-existing guard tests (`tools/test-object-template-integration.mjs`,
  `tools/test-cup-rotation-stabilization.mjs`) that hard-code `src/renderer/StoneColors.js` as
  forbidden — this milestone is the documented, legitimate reason it now changes, following this
  repo's established precedent for evolving forbidden-file lists.
* Do not add manufacturer trademarks or claim exact commercial color matching.
* Do not commit failing tests.

## Deliverables

* Implementation: `src/renderer/CrystalColors.js` (new), `src/renderer/StoneColors.js`, `app.js`,
  `index.html`.
* Tests: `tools/test-crystal-color-catalog.mjs`, `tools/test-crystal-color-integration.mjs` (new),
  registered in `package.json`.
* Docs: `src/renderer/README.md`, `docs/ARCHITECTURE.md` (implementation-status note).
* `npm test` passing in full.
* Browser verification via a real headless-Chrome session.
* `TASK_RESULT.md` completed.
* One commit on `feature/rs-1007-crystal-color-library`.
