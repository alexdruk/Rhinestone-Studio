/**
 * Stone size library (RS-1013 — Variable Stone Sizes).
 *
 * Rendering/UI display metadata only, mirroring `CrystalColors.js`'s catalog pattern exactly: a
 * `Stone`/layer only ever carries a plain millimeter number (`Stone.sizeMm`, a layer's
 * `stoneSize`) — see `src/geometry/Stone.js` and `src/geometry/GeometryEngine.js`'s
 * `stoneSizeMm` params. Nothing in `src/geometry/**` reads this file or knows what an "SS16" is;
 * geometry generation, fill sampling, and stone spacing already work in raw millimeters for any
 * positive value, mixed freely across layers. This catalog exists purely so the stone-size picker
 * (and the Production Sheet header) can show a commercial size name next to that millimeter value,
 * instead of forcing users to already know rhinestone industry sizing.
 *
 * Diameters below are nominal, commonly-cited industry values (not calibrated to any specific
 * manufacturer's tolerance spec) — the same "decorative approximation, not manufacturer-exact"
 * posture `CrystalColors.js` already takes for its hex values.
 *
 * Each entry:
 *   id                    stable, unique, lowercase-kebab string (e.g. "ss16")
 *   name                  commercial display name (e.g. "SS16")
 *   diameterMm            nominal stone diameter in millimeters — the value stored as a layer's
 *                         stoneSize / a Stone's sizeMm when this catalog entry is selected
 *   supportedHeightRangeMm  [min,max] text-height range (mm) FONT-DECISION-001 validated for this
 *                         size, mirrored from tools/font-generator/config/SS*.json's own
 *                         `supportedHeightRangeMm` field (that JSON is the offline font-calibration
 *                         source of truth; tools/test-stone-size-library.mjs cross-checks these
 *                         values against it on every run so the two can never silently drift apart)
 *
 * Adding a new standard size later is exactly one more `defineStoneSize()` entry below — no
 * switch statement anywhere in this codebase branches on stone size.
 */

function defineStoneSize({ id, name, diameterMm, supportedHeightRangeMm }) {
  return { id, name, diameterMm, supportedHeightRangeMm };
}

// Order is deliberate: it is the order the stone-size selector lists sizes in (ascending diameter).
const STONE_SIZE_LIST = [
  defineStoneSize({ id: 'ss6', name: 'SS6', diameterMm: 2.0, supportedHeightRangeMm: [35, 50] }),
  defineStoneSize({ id: 'ss10', name: 'SS10', diameterMm: 2.8, supportedHeightRangeMm: [45, 60] }),
  defineStoneSize({ id: 'ss16', name: 'SS16', diameterMm: 4.0, supportedHeightRangeMm: [65, 90] }),
  defineStoneSize({ id: 'ss20', name: 'SS20', diameterMm: 4.7, supportedHeightRangeMm: [80, 110] }),
  defineStoneSize({ id: 'ss30', name: 'SS30', diameterMm: 6.4, supportedHeightRangeMm: [106, 111] })
];

export const STONE_SIZES = STONE_SIZE_LIST;

/** Id-keyed lookup map, same shape convention as `STONE_COLORS`. */
export const STONE_SIZE_BY_ID = Object.fromEntries(STONE_SIZE_LIST.map((s) => [s.id, s]));

/** The id a brand-new layer's stoneSize (2mm, matching SS6 exactly) resolves to in the picker. */
export const DEFAULT_STONE_SIZE_ID = 'ss6';

export function getStoneSize(id) {
  return STONE_SIZE_BY_ID[id] || null;
}

export function isValidStoneSizeId(id) {
  return typeof id === 'string' && Object.prototype.hasOwnProperty.call(STONE_SIZE_BY_ID, id);
}

/** Catalog entries in display order — what the UI selector iterates to build its options. */
export function listStoneSizes() {
  return [...STONE_SIZE_LIST];
}

// A stored stoneSize is a raw float (user-typed history, imported projects, or a value this
// catalog produced) and floating-point/rounding drift is expected, so matching is by tolerance,
// not exact equality.
const DEFAULT_MATCH_TOLERANCE_MM = 0.005;

/**
 * Finds the catalog entry whose diameterMm matches `diameterMm` within `toleranceMm`, or null if
 * `diameterMm` does not correspond to any standard size (a legacy/custom millimeter value).
 * Never throws — callers (the UI picker, Production Sheet formatting) treat "no match" as the
 * normal, expected case for a custom value, not an error.
 */
export function findStoneSizeByDiameterMm(diameterMm, toleranceMm = DEFAULT_MATCH_TOLERANCE_MM) {
  if (typeof diameterMm !== 'number' || !Number.isFinite(diameterMm)) return null;
  let best = null;
  let bestDiff = Infinity;
  for (const size of STONE_SIZE_LIST) {
    const diff = Math.abs(size.diameterMm - diameterMm);
    if (diff < bestDiff) {
      bestDiff = diff;
      best = size;
    }
  }
  return best && bestDiff <= toleranceMm ? best : null;
}

/**
 * Formats a millimeter diameter for display, e.g. "SS16 (4.0 mm)" when it matches a catalog
 * entry, or "4.2 mm" (no commercial name) for a custom value. Used by the stone-size picker and
 * the Production Sheet header — the one place this "name + mm" formatting rule lives, per this
 * milestone's "Display both commercial name and actual diameter" requirement.
 */
export function formatStoneSizeLabel(diameterMm, toleranceMm = DEFAULT_MATCH_TOLERANCE_MM) {
  const rounded = Math.round(diameterMm * 100) / 100;
  const match = findStoneSizeByDiameterMm(diameterMm, toleranceMm);
  return match ? `${match.name} (${rounded} mm)` : `${rounded} mm`;
}

/**
 * The midpoint (mm) of a catalog entry's FONT-DECISION-001-validated text-height range — e.g. SS16's
 * [65,90] range midpoints at 77.5mm. Used by the app's stone-size picker to auto-set Text Height to
 * a known-good value the moment a size is chosen, rather than leaving whatever height was set for a
 * previous (possibly incompatible) size.
 */
export function stoneSizeHeightMidpointMm(size) {
  const [min, max] = size.supportedHeightRangeMm;
  return (min + max) / 2;
}

/** Whether `heightMm` falls inside `size`'s own validated supportedHeightRangeMm (inclusive). */
export function isHeightWithinStoneSizeRange(size, heightMm) {
  const [min, max] = size.supportedHeightRangeMm;
  return heightMm >= min && heightMm <= max;
}

/**
 * True when `size`'s entire validated height range is taller than `printableHeightMm` — i.e. no
 * height in its supportedHeightRangeMm could ever fit, so the size should be disabled outright
 * rather than merely warned about. A size whose range only *partially* exceeds printableHeightMm
 * returns false here (it stays selectable — the existing "outside printable area" warning covers
 * that case once actual text is placed and sized).
 */
export function stoneSizeEntirelyExceedsPrintableHeight(size, printableHeightMm) {
  const [min] = size.supportedHeightRangeMm;
  return min > printableHeightMm;
}

/**
 * Validates a stone-size catalog array (defaults to the shipped catalog). Throws a descriptive
 * Error on the first problem found; returns true otherwise — mirrors
 * `validateCrystalColorCatalog()`'s contract exactly, exercised by
 * tools/test-stone-size-library.mjs against both the shipped catalog and deliberately broken
 * fixtures.
 */
export function validateStoneSizeCatalog(list = STONE_SIZE_LIST) {
  if (!Array.isArray(list) || list.length === 0) {
    throw new TypeError('Stone size catalog must be a non-empty array.');
  }
  const seenIds = new Set();
  const seenNames = new Set();
  let previousDiameterMm = -Infinity;
  for (const size of list) {
    if (!size || typeof size !== 'object') {
      throw new TypeError('Every stone size entry must be an object.');
    }
    if (typeof size.id !== 'string' || size.id.length === 0) {
      throw new TypeError('Every stone size entry must have a non-empty string id.');
    }
    if (!/^[a-z][a-z0-9-]*$/.test(size.id)) {
      throw new TypeError(`Stone size id "${size.id}" must be lowercase-kebab (e.g. "ss16").`);
    }
    if (seenIds.has(size.id)) {
      throw new TypeError(`Duplicate stone size id: "${size.id}"`);
    }
    seenIds.add(size.id);
    if (typeof size.name !== 'string' || size.name.length === 0) {
      throw new TypeError(`Stone size "${size.id}" must have a non-empty display name.`);
    }
    if (seenNames.has(size.name)) {
      throw new TypeError(`Duplicate stone size name: "${size.name}"`);
    }
    seenNames.add(size.name);
    if (typeof size.diameterMm !== 'number' || !Number.isFinite(size.diameterMm) || size.diameterMm <= 0) {
      throw new TypeError(`Stone size "${size.id}" must have a positive finite diameterMm.`);
    }
    if (size.diameterMm <= previousDiameterMm) {
      throw new TypeError(`Stone size catalog must be sorted by strictly ascending diameterMm (offending entry: "${size.id}").`);
    }
    previousDiameterMm = size.diameterMm;
    const range = size.supportedHeightRangeMm;
    if (
      !Array.isArray(range) ||
      range.length !== 2 ||
      !range.every((n) => typeof n === 'number' && Number.isFinite(n) && n > 0)
    ) {
      throw new TypeError(`Stone size "${size.id}" must have a supportedHeightRangeMm [min,max] of two positive numbers.`);
    }
    if (range[0] >= range[1]) {
      throw new TypeError(`Stone size "${size.id}" supportedHeightRangeMm must have min < max.`);
    }
  }
  return true;
}
