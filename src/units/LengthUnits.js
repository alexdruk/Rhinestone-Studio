/**
 * RS-3018 — pure length-unit conversion utility. No DOM/app dependencies, mirrors the module
 * style of the rest of src/**. Storage is always mm; these helpers only convert at the
 * display/input boundary. 'in' converts mm<->inches, anything else (including 'mm') passes
 * through unchanged.
 */
export const MM_PER_INCH = 25.4;

/** mm (canonical storage) -> a plain number in the display unit, for setting an <input>'s value. */
export function mmToDisplayValue(mm, units) {
  if (!Number.isFinite(mm)) return mm;
  return units === 'in' ? mm / MM_PER_INCH : mm;
}

/** A typed/displayed value in the display unit -> mm, for writing back to storage. Accepts the
 *  raw string an <input> gives you; returns NaN if unparseable (caller already has its own
 *  parseFloat(...)||fallback convention -- match that, don't invent a new one). */
export function displayValueToMm(rawValue, units) {
  const n = parseFloat(rawValue);
  if (!Number.isFinite(n)) return NaN;
  return units === 'in' ? n * MM_PER_INCH : n;
}

/** 'mm' or 'in' -> the short unit suffix shown in labels. */
export function unitSuffix(units) {
  return units === 'in' ? 'in' : 'mm';
}

/** mm -> a rounded display number in the display unit, for setting <input>.value (rounds for
 *  readability; storage itself is never rounded by this function). */
export function formatLengthDisplay(mm, units, decimals = 2) {
  const v = mmToDisplayValue(mm, units);
  if (!Number.isFinite(v)) return v;
  return Number(v.toFixed(decimals));
}
