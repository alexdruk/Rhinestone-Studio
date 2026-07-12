/**
 * Crystal color catalog (RS-1007).
 *
 * Rendering-only display metadata, exactly like the small palette this module replaces — a
 * `Stone`/layer only ever carries a color `id` string (see `src/geometry/Stone.js`); nothing in
 * `src/geometry/**` reads this file. Every 2D/3D consumer resolves a stone's color through this
 * one catalog, so growing the color list never requires a renderer/exporter change.
 *
 * These are decorative, hand-picked approximations for on-screen preview and production-sheet
 * labeling. Names are generic gemstone/color words in common rhinestone-industry use — this
 * catalog does not reference any manufacturer, and its hex values are not calibrated to match any
 * specific manufacturer's commercial color line.
 *
 * Each entry:
 *   id          stable, unique, lowercase-kebab string — the value stored on Stone.color/layer.color
 *   name        display name
 *   group       UI grouping label only (never read by geometry/render code)
 *   previewColor  primary swatch hex — aliases `fill` below
 *   highlight   optional lighter hex accent — aliases `shine` below
 *   shadow      optional darker hex accent — aliases `accent` below
 *   fill/stroke/shine/accent  the four render-channel fields every existing consumer
 *               (CanvasRenderer2D.js, CupRenderer.js via drawStone, StoneLayoutTexture.js,
 *               SvgExporter.js, ProductionSheetExporter.js) already reads by these exact names.
 *
 * `previewColor`/`highlight`/`shadow` are provided for the color-selector UI and for any future
 * consumer that wants the plainer names; `fill`/`stroke`/`shine`/`accent` remain the load-bearing
 * fields for every current renderer/exporter and are never renamed, so this milestone requires no
 * change to any of them.
 */

function defineColor({ id, name, group, fill, stroke, shine, accent }) {
  return {
    id,
    name,
    group,
    previewColor: fill,
    highlight: shine,
    shadow: accent,
    fill,
    stroke,
    shine,
    accent
  };
}

// Order is deliberate: it is the order the color selector UI groups/lists colors in.
const CRYSTAL_COLOR_LIST = [
  // -- Clear & Neutral -----------------------------------------------------------------------
  defineColor({
    id: 'crystal-clear', name: 'Crystal', group: 'Clear & Neutral',
    fill: '#f5f5f5', stroke: '#8a8a8a', shine: '#ffffff', accent: '#cfcfcf'
  }),
  defineColor({
    // Pre-existing id/values (RS-0003.5C2) — kept byte-identical for backward compatibility.
    id: 'crystal', name: 'Crystal AB', group: 'Clear & Neutral',
    fill: '#e9f7ff', stroke: '#5e7080', shine: '#ffffff', accent: '#92d5ff'
  }),
  defineColor({
    // Pre-existing id/values (RS-0003.5C2) kept byte-identical; display name shortened from
    // "Jet Black" to "Jet" to match the required catalog name — no id or color value changed.
    id: 'jet', name: 'Jet', group: 'Clear & Neutral',
    fill: '#141414', stroke: '#d9d9d9', shine: '#555', accent: '#000'
  }),
  // -- Red & Pink -----------------------------------------------------------------------------
  defineColor({
    id: 'siam', name: 'Siam', group: 'Red & Pink',
    fill: '#9b1c1c', stroke: '#4a0d0d', shine: '#ffd9d9', accent: '#6e1313'
  }),
  defineColor({
    id: 'light-siam', name: 'Light Siam', group: 'Red & Pink',
    fill: '#d9534f', stroke: '#8a2f2c', shine: '#ffe0dd', accent: '#b5423e'
  }),
  defineColor({
    // Pre-existing id/values (RS-0003.5C2) — kept byte-identical.
    id: 'rose', name: 'Rose', group: 'Red & Pink',
    fill: '#ef8fb0', stroke: '#8a2c4d', shine: '#ffe2ed', accent: '#d75384'
  }),
  defineColor({
    id: 'fuchsia', name: 'Fuchsia', group: 'Red & Pink',
    fill: '#c2185b', stroke: '#6e0d33', shine: '#ffd6ea', accent: '#9c1249'
  }),
  // -- Purple & Blue --------------------------------------------------------------------------
  defineColor({
    id: 'amethyst', name: 'Amethyst', group: 'Purple & Blue',
    fill: '#7e3f98', stroke: '#4a2260', shine: '#eaddf7', accent: '#5c2d72'
  }),
  defineColor({
    // Pre-existing id/values (RS-0003.5C2) — kept byte-identical.
    id: 'sapphire', name: 'Sapphire', group: 'Purple & Blue',
    fill: '#2269d3', stroke: '#0f356f', shine: '#b8d8ff', accent: '#174ca2'
  }),
  defineColor({
    id: 'light-sapphire', name: 'Light Sapphire', group: 'Purple & Blue',
    fill: '#6fa8dc', stroke: '#2e5c8a', shine: '#dbeeff', accent: '#4a80b5'
  }),
  // -- Green & Aqua ---------------------------------------------------------------------------
  defineColor({
    id: 'aquamarine', name: 'Aquamarine', group: 'Green & Aqua',
    fill: '#3fc1b0', stroke: '#1f6e64', shine: '#d4fff9', accent: '#2a9d8f'
  }),
  defineColor({
    // Pre-existing id/values (RS-0003.5C2) — kept byte-identical.
    id: 'emerald', name: 'Emerald', group: 'Green & Aqua',
    fill: '#2aa66a', stroke: '#0b5633', shine: '#c7ffdf', accent: '#16814e'
  }),
  defineColor({
    id: 'peridot', name: 'Peridot', group: 'Green & Aqua',
    fill: '#b5cc18', stroke: '#6c7d0e', shine: '#f2ffcf', accent: '#8a9c14'
  }),
  // -- Yellow & Amber -------------------------------------------------------------------------
  defineColor({
    id: 'topaz', name: 'Topaz', group: 'Yellow & Amber',
    fill: '#e08e26', stroke: '#8a5210', shine: '#ffe3b0', accent: '#b56d1c'
  }),
  defineColor({
    id: 'citrine', name: 'Citrine', group: 'Yellow & Amber',
    fill: '#f2c94c', stroke: '#9c7a10', shine: '#fff6d1', accent: '#d1a828'
  }),
  // -- Metallic -------------------------------------------------------------------------------
  defineColor({
    // Pre-existing id/values (RS-0003.5C2) — kept byte-identical.
    id: 'gold', name: 'Gold', group: 'Metallic',
    fill: '#f3bd32', stroke: '#926400', shine: '#fff1a6', accent: '#d18a00'
  }),
  defineColor({
    // Pre-existing id/values (RS-0003.5C2) — kept byte-identical.
    id: 'silver', name: 'Silver', group: 'Metallic',
    fill: '#d8dde4', stroke: '#737b86', shine: '#ffffff', accent: '#a7b0bf'
  })
];

export const CRYSTAL_COLORS = CRYSTAL_COLOR_LIST;

/** Id-keyed lookup map — the same shape the pre-RS-1007 `STONE_COLORS` object already had. */
export const STONE_COLORS = Object.fromEntries(CRYSTAL_COLOR_LIST.map((c) => [c.id, c]));

/** The id `defaultProject()` in app.js assigns to a brand-new project's first layer. */
export const DEFAULT_CRYSTAL_COLOR_ID = 'gold';

export function getCrystalColor(id) {
  return STONE_COLORS[id] || null;
}

export function isValidCrystalColorId(id) {
  return typeof id === 'string' && Object.prototype.hasOwnProperty.call(STONE_COLORS, id);
}

/** Catalog entries grouped by `group`, in catalog order — what the UI selector iterates. */
export function listCrystalColorGroups() {
  const groups = [];
  const byGroup = new Map();
  for (const color of CRYSTAL_COLOR_LIST) {
    if (!byGroup.has(color.group)) {
      const entry = { group: color.group, colors: [] };
      byGroup.set(color.group, entry);
      groups.push(entry);
    }
    byGroup.get(color.group).colors.push(color);
  }
  return groups;
}

const HEX_COLOR_PATTERN = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

export function isValidHexColor(value) {
  return typeof value === 'string' && HEX_COLOR_PATTERN.test(value);
}

/**
 * Validates a crystal-color catalog array (defaults to the shipped catalog). Throws a descriptive
 * Error on the first problem found; returns true otherwise. Exercised directly by
 * tools/test-crystal-color-catalog.mjs against both the shipped catalog and deliberately broken
 * fixtures.
 */
export function validateCrystalColorCatalog(list = CRYSTAL_COLOR_LIST) {
  if (!Array.isArray(list) || list.length === 0) {
    throw new TypeError('Crystal color catalog must be a non-empty array.');
  }
  const seenIds = new Set();
  for (const color of list) {
    if (!color || typeof color !== 'object') {
      throw new TypeError('Every crystal color entry must be an object.');
    }
    if (typeof color.id !== 'string' || color.id.length === 0) {
      throw new TypeError('Every crystal color entry must have a non-empty string id.');
    }
    if (!/^[a-z][a-z0-9-]*$/.test(color.id)) {
      throw new TypeError(`Crystal color id "${color.id}" must be lowercase-kebab (e.g. "light-siam").`);
    }
    if (seenIds.has(color.id)) {
      throw new TypeError(`Duplicate crystal color id: "${color.id}"`);
    }
    seenIds.add(color.id);
    if (typeof color.name !== 'string' || color.name.length === 0) {
      throw new TypeError(`Crystal color "${color.id}" must have a non-empty display name.`);
    }
    if (!isValidHexColor(color.previewColor)) {
      throw new TypeError(`Crystal color "${color.id}" must have a valid hex previewColor.`);
    }
    if (color.highlight !== undefined && color.highlight !== null && !isValidHexColor(color.highlight)) {
      throw new TypeError(`Crystal color "${color.id}" has an invalid optional highlight hex value.`);
    }
    if (color.shadow !== undefined && color.shadow !== null && !isValidHexColor(color.shadow)) {
      throw new TypeError(`Crystal color "${color.id}" has an invalid optional shadow hex value.`);
    }
  }
  return true;
}
