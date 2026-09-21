/**
 * Flat Sheet product definition (RS-3037).
 *
 * Flat Sheet has exactly two physical parameters -- width and height -- and per the product
 * decision they *are* the production canvas dimensions, independently editable, with no
 * derived-vs-authored split of the kind Plate/Vessel need. There is nothing left over that a
 * project-level `project.sheet` object would hold; `project.canvas` is the sole source of truth
 * (see docs/specifications/RS-3037-FlatSheet.md, "Schema decision"). This module is therefore a
 * pure stateless helper -- one shared [min,max] range instead of Plate's six per-field ranges --
 * matching src/products/PlateProductDefinition.js's own "pure data + validation" contract.
 */

export const SHEET_MIN_MM = 20;
export const SHEET_MAX_MM = 500;

/**
 * @returns {{widthMm:number, heightMm:number}} A fresh copy of the default Flat Sheet canvas size
 *   -- safe to mutate.
 */
export function getSheetDefaults() {
  return { widthMm: 150, heightMm: 150 };
}

/**
 * Clamps a candidate mm value into [SHEET_MIN_MM, SHEET_MAX_MM]. A non-finite input falls back to
 * the default width (150mm) -- mirrors clampPlateDimensionMm()/clampVesselDimensionMm()'s own
 * contract.
 *
 * @param {number} value
 * @returns {number}
 */
export function clampSheetDimensionMm(value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return getSheetDefaults().widthMm;
  return Math.max(SHEET_MIN_MM, Math.min(SHEET_MAX_MM, value));
}
