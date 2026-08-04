/**
 * LibraryItem — RS-1015.
 *
 * A library item never invents a new project/layer schema: `data.project` (kind 'project') and
 * `data.layers` (kind 'selection') are verbatim copies of the exact ad hoc project/layer JSON
 * `app.js` already produces (the same shape `#exportProject`/`duplicateLayer()` already read and
 * write) -- this module only adds the minimal organizing metadata around that payload. Records are
 * plain, JSON-round-trippable objects (not a mutable class), mirroring `Stone`/`StoneLayout`'s
 * existing `toJSON()`/`fromJSON()` style rather than `Layer`'s mutable-class style, since a library
 * item is always read/written as a whole record, never incrementally mutated in place.
 */

const KINDS = new Set(['project', 'selection']);

// S-110: the nine new Design Shapes kinds (Ellipse/Capsule/Regular Polygon/Star/Heart/Arrow/Cross/
// Crescent/Ring) all categorize as 'Shapes', exactly like Circle/Rectangle already do -- they are
// hardcoded here (not imported from src/geometry/ShapeLibrary.js) to preserve this module's own
// "no dependency on src/geometry" architecture (see the top-of-file doc comment).
const CATEGORY_BY_LAYER_TYPE = {
  text: 'Text',
  circle: 'Shapes',
  rectangle: 'Shapes',
  ellipse: 'Shapes',
  capsule: 'Shapes',
  polygon: 'Shapes',
  star: 'Shapes',
  heart: 'Shapes',
  arrow: 'Shapes',
  cross: 'Shapes',
  crescent: 'Shapes',
  ring: 'Shapes',
  svg: 'SVG',
  image: 'Image Trace',
  path: 'Boolean / Path'
};

function makeId(prefix = 'item') {
  const random = Math.random().toString(36).slice(2, 10);
  return `${prefix}-${Date.now().toString(36)}-${random}`;
}

function assertNonEmptyString(value, label) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new TypeError(`LibraryItem: ${label} must be a non-empty string.`);
  }
}

/**
 * Derives a default category label from the layer types an item contains. A single-type item gets
 * that type's label; a multi-type (or unrecognized-type) item is 'Mixed'. Never called for a
 * whole-project item, which always defaults to 'Full Project'.
 * @param {Array<{type:string}>} layers
 * @returns {string}
 */
export function deriveCategory(layers) {
  if (!Array.isArray(layers) || layers.length === 0) return 'Mixed';
  const labels = new Set(layers.map((layer) => CATEGORY_BY_LAYER_TYPE[layer?.type] || 'Mixed'));
  return labels.size === 1 ? [...labels][0] : 'Mixed';
}

/**
 * Validates and normalizes a plain library item input into a frozen-shape record. Throws a
 * specific TypeError describing the first problem found. Never mutates its input.
 * @param {object} input
 * @returns {object}
 */
export function createLibraryItem(input = {}) {
  if (!input || typeof input !== 'object') {
    throw new TypeError('LibraryItem: input must be an object.');
  }
  if (!KINDS.has(input.kind)) {
    throw new TypeError(`LibraryItem: kind must be one of ${[...KINDS].join(', ')}.`);
  }
  assertNonEmptyString(input.name, 'name');
  if (!input.data || typeof input.data !== 'object') {
    throw new TypeError('LibraryItem: data must be an object.');
  }
  if (input.kind === 'project' && (!input.data.project || typeof input.data.project !== 'object')) {
    throw new TypeError("LibraryItem: kind 'project' requires data.project to be an object.");
  }
  if (input.kind === 'selection' && !Array.isArray(input.data.layers)) {
    throw new TypeError("LibraryItem: kind 'selection' requires data.layers to be an array.");
  }
  if (input.kind === 'selection' && input.data.layers.length === 0) {
    throw new TypeError("LibraryItem: kind 'selection' requires at least one layer.");
  }

  const now = input.now ?? new Date().toISOString();
  const category = typeof input.category === 'string' && input.category.trim().length > 0
    ? input.category
    : (input.kind === 'project' ? 'Full Project' : deriveCategory(input.data.layers));

  return {
    id: typeof input.id === 'string' && input.id.length > 0 ? input.id : makeId(input.kind),
    kind: input.kind,
    name: input.name,
    category,
    tags: Array.isArray(input.tags) ? [...input.tags] : [],
    created: input.created ?? now,
    modified: input.modified ?? now,
    thumbnail: input.thumbnail ?? null,
    data: JSON.parse(JSON.stringify(input.data))
  };
}

/**
 * Returns a new item record with `patch` applied and `modified` refreshed. Never mutates `item`.
 * @param {object} item
 * @param {object} [patch]
 * @param {string} [nowIso]
 * @returns {object}
 */
export function touchLibraryItem(item, patch = {}, nowIso = new Date().toISOString()) {
  return {
    ...item,
    ...patch,
    modified: nowIso
  };
}

/**
 * Deep-clones a library item record as a brand-new item (fresh id, fresh created/modified) --
 * used by `DesignLibrary.duplicate()`. Re-validates through `createLibraryItem()` so a duplicate
 * can never silently diverge from the item shape.
 * @param {object} item
 * @param {object} [overrides] e.g. `{ name }`
 * @returns {object}
 */
export function cloneLibraryItem(item, overrides = {}) {
  const now = overrides.now ?? new Date().toISOString();
  return createLibraryItem({
    ...JSON.parse(JSON.stringify(item)),
    id: undefined,
    created: now,
    modified: now,
    ...overrides
  });
}
