/**
 * Stone display palette — compatibility shim (RS-1007).
 *
 * The full crystal-color catalog now lives in `src/renderer/CrystalColors.js`. This file re-
 * exports `STONE_COLORS` (same shape: an id-keyed object of `{ name, fill, stroke, shine, accent }`
 * records, now with 17 entries instead of 7) from that module unchanged, so every pre-existing
 * consumer — `CanvasRenderer2D.js`, `CupRenderer.js` (via `drawStone`), `SvgExporter.js`,
 * `ProductionSheetExporter.js`, and app.js's own top-level STONE_COLORS import from this exact
 * file path — keeps working with zero code changes.
 */

export { STONE_COLORS } from './CrystalColors.js';
