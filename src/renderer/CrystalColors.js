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
 * specific manufacturer's commercial color line, except the IMG-026F aiOnly entries and the
 * entries IMG-026G re-measured (those with a legacyFill), whose fills were sampled from a
 * supplier's catalogue photos; stroke, shine and accent of a re-measured entry follow the IMG-016
 * shading rule.
 *
 * Each entry:
 *   id          stable, unique, lowercase-kebab string — the value stored on Stone.color/layer.color
 *   name        display name
 *   group       UI grouping label only (never read by geometry/render code)
 *   legacyFill  IMG-026G: the fill before the re-measure (equal to fill for an entry that was not
 *               re-measured). app.js's imageColorPalette() quantises against it, so legacy image
 *               fill modes give the same stones as before.
 *   aiOnly      IMG-026F: true for the twelve colours only Image -> Strass (AI layout) uses. They
 *               render, count and print like any other colour, but the standard colour selectors
 *               (listCrystalColorGroups() and app.js's populateStoneColorOptions()) leave them out.
 *   previewColor  primary swatch hex — aliases `fill` below
 *   highlight   optional lighter hex accent — aliases `shine` below
 *   shadow      optional darker hex accent — aliases `accent` below
 *   fill/stroke/shine/accent  the four render-channel fields every existing consumer
 *               (CanvasRenderer2D.js, CupRenderer.js via drawStone, SvgExporter.js,
 *               ProductionSheetExporter.js) already reads by these exact names.
 *
 * `previewColor`/`highlight`/`shadow` are provided for the color-selector UI and for any future
 * consumer that wants the plainer names; `fill`/`stroke`/`shine`/`accent` remain the load-bearing
 * fields for every current renderer/exporter and are never renamed, so this milestone requires no
 * change to any of them.
 */

function defineColor({ id, name, group, aiOnly = false, fill, stroke, shine, accent, legacyFill = null }) {
  return {
    id,
    name,
    group,
    aiOnly,
    legacyFill: legacyFill || fill,
    previewColor: fill,
    highlight: shine,
    shadow: accent,
    fill,
    stroke,
    shine,
    accent
  };
}

// Order is deliberate: it is the order the color selector UI groups/lists colors in. Groups are
// ordered by first appearance, so an appended entry joins the end of its group (IMG-016).
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
    fill: '#7a1b2c', stroke: '#440f19', shine: '#e8d8db', accent: '#5e1522', legacyFill: '#9b1c1c'
  }),
  defineColor({
    id: 'light-siam', name: 'Light Siam', group: 'Red & Pink',
    fill: '#9f112a', stroke: '#590a18', shine: '#efd7db', accent: '#7a0d20', legacyFill: '#d9534f'
  }),
  defineColor({
    // Pre-existing id (RS-0003.5C2); IMG-026G re-measured its colour values.
    id: 'rose', name: 'Rose', group: 'Red & Pink',
    fill: '#d65d9b', stroke: '#783457', shine: '#f8e3ee', accent: '#a54877', legacyFill: '#ef8fb0'
  }),
  defineColor({
    id: 'fuchsia', name: 'Fuchsia', group: 'Red & Pink',
    fill: '#902b74', stroke: '#511841', shine: '#ecdbe7', accent: '#6f2159', legacyFill: '#c2185b'
  }),
  // -- Purple & Blue --------------------------------------------------------------------------
  defineColor({
    id: 'amethyst', name: 'Amethyst', group: 'Purple & Blue',
    fill: '#903f8a', stroke: '#51234d', shine: '#ecdeeb', accent: '#6f316a', legacyFill: '#7e3f98'
  }),
  defineColor({
    // Pre-existing id (RS-0003.5C2); IMG-026G re-measured its colour values.
    id: 'sapphire', name: 'Sapphire', group: 'Purple & Blue',
    fill: '#2f83c3', stroke: '#1a496d', shine: '#dceaf5', accent: '#246596', legacyFill: '#2269d3'
  }),
  defineColor({
    id: 'light-sapphire', name: 'Light Sapphire', group: 'Purple & Blue',
    fill: '#94b5dd', stroke: '#53657c', shine: '#edf2f9', accent: '#728baa', legacyFill: '#6fa8dc'
  }),
  // -- Green & Aqua ---------------------------------------------------------------------------
  defineColor({
    id: 'aquamarine', name: 'Aquamarine', group: 'Green & Aqua',
    fill: '#65bcc2', stroke: '#39696d', shine: '#e5f4f5', accent: '#4e9195', legacyFill: '#3fc1b0'
  }),
  defineColor({
    // Pre-existing id (RS-0003.5C2); IMG-026G re-measured its colour values.
    id: 'emerald', name: 'Emerald', group: 'Green & Aqua',
    fill: '#217456', stroke: '#124130', shine: '#d9e7e2', accent: '#195942', legacyFill: '#2aa66a'
  }),
  defineColor({
    id: 'peridot', name: 'Peridot', group: 'Green & Aqua',
    fill: '#6bb760', stroke: '#3c6636', shine: '#e6f3e4', accent: '#528d4a', legacyFill: '#b5cc18'
  }),
  // -- Yellow & Amber -------------------------------------------------------------------------
  defineColor({
    id: 'topaz', name: 'Topaz', group: 'Yellow & Amber',
    fill: '#b6741e', stroke: '#664111', shine: '#f3e7d9', accent: '#8c5917', legacyFill: '#e08e26'
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
  }),
  // -- IMG-016: appended after every pre-existing entry, so no existing palette index moves ------
  // stroke/shine/accent follow one rule per sRGB channel v of fill: round(0.56*v), round(v +
  // 0.83*(255-v)), round(0.77*v). See docs/specifications/IMG-016-NeutralBrownStones.md decision 1.
  defineColor({
    id: 'hematite', name: 'Hematite', group: 'Metallic',
    fill: '#3e3f44', stroke: '#232326', shine: '#dededf', accent: '#303134'
  }),
  defineColor({
    id: 'black-diamond', name: 'Black Diamond', group: 'Clear & Neutral',
    fill: '#60726d', stroke: '#36403d', shine: '#e4e7e6', accent: '#4a5854', legacyFill: '#6b6b72'
  }),
  defineColor({
    id: 'grey', name: 'Grey', group: 'Clear & Neutral',
    fill: '#9a9ca2', stroke: '#56575b', shine: '#eeeeef', accent: '#77787d'
  }),
  defineColor({
    id: 'smoked-topaz', name: 'Smoked Topaz', group: 'Brown & Peach',
    fill: '#583f2d', stroke: '#312319', shine: '#e3dedb', accent: '#443123', legacyFill: '#6e4a2e'
  }),
  defineColor({
    id: 'light-colorado', name: 'Light Colorado Topaz', group: 'Brown & Peach',
    fill: '#c38e43', stroke: '#6d5026', shine: '#f5ecdf', accent: '#966d34', legacyFill: '#b98a5c'
  }),
  defineColor({
    id: 'light-peach', name: 'Light Peach', group: 'Brown & Peach',
    fill: '#e2a791', stroke: '#7f5e51', shine: '#faf0ec', accent: '#ae8170', legacyFill: '#eec6a4'
  }),
  // -- IMG-026 (D2): appended after light-peach, same shading rule as the IMG-016 entries. The
  // layout service's strass_layout/catalogue.json must match these (S4). -----------------------
  defineColor({
    id: 'colorado-topaz', name: 'Colorado Topaz', group: 'Brown & Peach',
    fill: '#a0602c', stroke: '#5a3619', shine: '#efe4db', accent: '#7b4a22'
  }),
  defineColor({
    id: 'light-smoked-topaz', name: 'Light Smoked Topaz', group: 'Brown & Peach',
    fill: '#826244', stroke: '#493726', shine: '#eae4df', accent: '#644b34', legacyFill: '#8a6a4a'
  }),
  defineColor({
    id: 'scarlet', name: 'Scarlet', group: 'Red & Pink',
    fill: '#bb1a33', stroke: '#690f1d', shine: '#f3d8dc', accent: '#901427', legacyFill: '#d0101e'
  }),
  defineColor({
    id: 'hyacinth', name: 'Hyacinth', group: 'Yellow & Amber',
    fill: '#e0581c', stroke: '#7d3110', shine: '#fae3d8', accent: '#ac4416'
  }),
  // -- IMG-026F: AI-layout-only colours (aiOnly), appended after hyacinth. Fills are the mean colour
  // of the stone photos in a supplier's flat-back catalogue, except Copper, Olivine and Khaki, which
  // come from the owner's supplier list; stroke, shine and accent follow the IMG-016 shading rule.
  // The layout service's catalogue.json must match (S4). ------------------------------------------
  defineColor({
    id: 'golden-shadow', name: 'Golden Shadow', group: 'Brown & Peach', aiOnly: true,
    fill: '#c99a6c', stroke: '#71563c', shine: '#f6eee6', accent: '#9b7753'
  }),
  defineColor({
    id: 'copper', name: 'Copper', group: 'Brown & Peach', aiOnly: true,
    fill: '#b87333', stroke: '#67401d', shine: '#f3e7dc', accent: '#8e5927'
  }),
  defineColor({
    id: 'rose-gold', name: 'Rose Gold', group: 'Brown & Peach', aiOnly: true,
    fill: '#d38f75', stroke: '#765042', shine: '#f8ece8', accent: '#a26e5a'
  }),
  defineColor({
    id: 'vintage-rose', name: 'Vintage Rose', group: 'Red & Pink', aiOnly: true,
    fill: '#d1958e', stroke: '#755350', shine: '#f7edec', accent: '#a1736d'
  }),
  defineColor({
    id: 'padparadscha', name: 'Padparadscha', group: 'Red & Pink', aiOnly: true,
    fill: '#de4c52', stroke: '#7c2b2e', shine: '#f9e1e2', accent: '#ab3b3f'
  }),
  defineColor({
    id: 'chrysolite', name: 'Chrysolite', group: 'Green & Aqua', aiOnly: true,
    fill: '#97d38f', stroke: '#557650', shine: '#edf8ec', accent: '#74a26e'
  }),
  defineColor({
    id: 'fern-green', name: 'Fern Green', group: 'Green & Aqua', aiOnly: true,
    fill: '#3e8e41', stroke: '#235024', shine: '#deecdf', accent: '#306d32'
  }),
  defineColor({
    id: 'erinite', name: 'Erinite', group: 'Green & Aqua', aiOnly: true,
    fill: '#4d8355', stroke: '#2b4930', shine: '#e1eae2', accent: '#3b6541'
  }),
  defineColor({
    id: 'olivine', name: 'Olivine', group: 'Green & Aqua', aiOnly: true,
    fill: '#737033', stroke: '#403f1d', shine: '#e7e7dc', accent: '#595627'
  }),
  defineColor({
    id: 'khaki', name: 'Khaki', group: 'Green & Aqua', aiOnly: true,
    fill: '#5b593c', stroke: '#333222', shine: '#e3e3de', accent: '#46452e'
  }),
  defineColor({
    id: 'metallic-sunshine', name: 'Metallic Sunshine', group: 'Yellow & Amber', aiOnly: true,
    fill: '#dfb758', stroke: '#7d6631', shine: '#faf3e3', accent: '#ac8d44'
  }),
  defineColor({
    id: 'jet-hematite', name: 'Jet Hematite', group: 'Metallic', aiOnly: true,
    fill: '#4a5353', stroke: '#292e2e', shine: '#e0e2e2', accent: '#394040'
  })
];

export const CRYSTAL_COLORS = CRYSTAL_COLOR_LIST;

// IMG-026 (S13): the 23 pre-v2 ids, in catalogue order, that legacy image fill modes quantise
// against. app.js's imageColorPalette() restates them as a literal (its region is new Function()-
// evaluated by test harnesses); tools/test-img-026-catalogue.mjs keeps the two equal.
export const LEGACY_IMAGE_COLOR_IDS = Object.freeze([
  'crystal-clear', 'crystal', 'jet', 'siam', 'light-siam', 'rose', 'fuchsia', 'amethyst',
  'sapphire', 'light-sapphire', 'aquamarine', 'emerald', 'peridot', 'topaz', 'citrine', 'gold',
  'silver', 'hematite', 'black-diamond', 'grey', 'smoked-topaz', 'light-colorado', 'light-peach'
]);

// IMG-026F: the ids of the aiOnly entries, in catalogue order.
export const AI_ONLY_COLOR_IDS = Object.freeze(CRYSTAL_COLOR_LIST.filter((c) => c.aiOnly).map((c) => c.id));

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

/**
 * Catalog entries grouped by `group`, in catalog order — what the UI selector iterates. The
 * aiOnly colours are left out unless includeAiOnly is true (IMG-026F).
 */
export function listCrystalColorGroups({ includeAiOnly = false } = {}) {
  const groups = [];
  const byGroup = new Map();
  for (const color of CRYSTAL_COLOR_LIST) {
    if (color.aiOnly && !includeAiOnly) continue;
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
