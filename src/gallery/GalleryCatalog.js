/**
 * GalleryCatalog — RS-2001.
 *
 * Pure, DOM-free logic for the read-only built-in Gallery. Cross-validates and merges three
 * already-existing, already-committed sources of truth for the `examples/*.rhs` fixture set --
 * `examples/manifest.json` (description/purpose), `examples/baselines.json` (committed geometry
 * facts: layerCount/visibleLayerCount/stoneCount/bounds/fontIds/colors), and the new
 * `examples/gallery.json` (curatorial title/category/description/difficulty/tags/featured) --
 * plus each fixture's own parsed `.rhs` JSON (for `product`/`wrap`, i.e. "object type"). None of
 * these five inputs is invented or duplicated by this module: `stoneCount` always comes from
 * `baselines.json`, `objectType`/`wrap` always come from the fixture's own content, so a curated
 * entry can never silently drift out of sync with what the fixture actually renders.
 *
 * This module performs no I/O itself (no `fetch`, no `fs`) -- callers (the browser Gallery
 * orchestration in `app.js`, or a Node tool/test) are responsible for reading
 * `manifest.json`/`baselines.json`/`gallery.json`/each `.rhs` file and passing the parsed JSON in.
 * Mirrors `src/library/DesignLibrary.js`'s "pure logic, caller supplies I/O" shape.
 */

const PRODUCT_CATEGORY_LABELS = { mug: 'Mugs', tumbler: 'Tumblers', bottle: 'Bottles' };
const KNOWN_DIFFICULTIES = new Set(['beginner', 'intermediate', 'advanced']);

/**
 * @param {object} params
 * @param {object} params.manifest Parsed examples/manifest.json.
 * @param {object} params.baselines Parsed examples/baselines.json.
 * @param {object} params.galleryMeta Parsed examples/gallery.json.
 * @param {Record<string, object>} params.fixtures Map of fixture filename -> parsed `.rhs` JSON,
 *   covering at least every file referenced by `galleryMeta.items`.
 * @returns {Array<object>} One read-only catalog entry per `galleryMeta.items` entry, sorted by
 *   `title`. Throws a descriptive Error if any cross-reference is missing or inconsistent.
 */
export function parseCatalog({ manifest, baselines, galleryMeta, fixtures }) {
  const manifestByFile = new Map((manifest?.examples ?? []).map((e) => [e.file, e]));
  const baselineByFile = new Map((baselines?.baselines ?? []).map((b) => [b.file, b]));
  const items = galleryMeta?.items ?? [];

  if (items.length === 0) {
    throw new Error('GalleryCatalog: examples/gallery.json has no items.');
  }

  const seen = new Set();
  const entries = items.map((meta) => {
    const { file } = meta;
    if (!file || typeof file !== 'string') {
      throw new Error('GalleryCatalog: every gallery.json item requires a string "file".');
    }
    if (seen.has(file)) {
      throw new Error(`GalleryCatalog: duplicate gallery.json entry for "${file}".`);
    }
    seen.add(file);

    const manifestEntry = manifestByFile.get(file);
    if (!manifestEntry) {
      throw new Error(`GalleryCatalog: "${file}" is in gallery.json but has no examples/manifest.json entry.`);
    }
    const baseline = baselineByFile.get(file);
    if (!baseline) {
      throw new Error(`GalleryCatalog: "${file}" is in gallery.json but has no examples/baselines.json entry.`);
    }
    const fixture = fixtures?.[file];
    if (!fixture) {
      throw new Error(`GalleryCatalog: "${file}" is in gallery.json but its .rhs content was not supplied.`);
    }

    if (!KNOWN_DIFFICULTIES.has(meta.difficulty)) {
      throw new Error(`GalleryCatalog: "${file}" has an unrecognized difficulty "${meta.difficulty}".`);
    }
    if (typeof meta.title !== 'string' || meta.title.trim().length === 0) {
      throw new Error(`GalleryCatalog: "${file}" is missing a non-empty title.`);
    }
    if (typeof meta.category !== 'string' || meta.category.trim().length === 0) {
      throw new Error(`GalleryCatalog: "${file}" is missing a non-empty category.`);
    }

    const objectType = String(fixture.product || 'mug');

    return {
      file,
      title: meta.title,
      category: meta.category,
      description: meta.description ?? manifestEntry.description ?? '',
      difficulty: meta.difficulty,
      tags: Array.isArray(meta.tags) ? [...meta.tags] : [],
      featured: Boolean(meta.featured),
      objectType,
      wrap: fixture.wrap ?? 'front',
      stoneCount: baseline.stoneCount,
      layerCount: baseline.layerCount,
      visibleLayerCount: baseline.visibleLayerCount
    };
  });

  return entries.sort((a, b) => a.title.localeCompare(b.title));
}

/**
 * Case-insensitive substring search over title/description/tags/category. An empty/whitespace
 * query returns every entry, matching `DesignLibrary.search()`'s existing convention.
 * @param {Array<object>} entries
 * @param {string} query
 * @returns {Array<object>}
 */
export function search(entries, query) {
  const q = String(query ?? '').trim().toLowerCase();
  if (!q) return [...entries];
  return entries.filter((entry) =>
    entry.title.toLowerCase().includes(q) ||
    entry.description.toLowerCase().includes(q) ||
    entry.category.toLowerCase().includes(q) ||
    entry.tags.some((tag) => tag.toLowerCase().includes(q))
  );
}

/**
 * @param {Array<object>} entries
 * @param {string} category `'All'` (or falsy) returns `entries` unchanged. Also accepts the
 *   product-derived pseudo-categories ('Mugs'/'Tumblers'/'Bottles'), matched against `objectType`,
 *   alongside every curated `entries[].category` value -- see `categories()`.
 * @returns {Array<object>}
 */
export function filterByCategory(entries, category) {
  if (!category || category === 'All') return [...entries];
  const productType = Object.entries(PRODUCT_CATEGORY_LABELS).find(([, label]) => label === category)?.[0];
  if (productType) return entries.filter((entry) => entry.objectType === productType);
  return entries.filter((entry) => entry.category === category);
}

/**
 * @param {Array<object>} entries
 * @returns {Array<string>} every distinct curated category plus every non-empty product-derived
 *   pseudo-category ('Mugs'/'Tumblers'/'Bottles'), alphabetically sorted.
 */
export function categories(entries) {
  const curated = new Set(entries.map((entry) => entry.category));
  const products = new Set(entries.map((entry) => entry.objectType));
  for (const [type, label] of Object.entries(PRODUCT_CATEGORY_LABELS)) {
    if (products.has(type)) curated.add(label);
  }
  return [...curated].sort((a, b) => a.localeCompare(b));
}

/** @returns {Array<object>} entries flagged `featured`, in catalog order. */
export function featuredEntries(entries) {
  return entries.filter((entry) => entry.featured);
}

/** @returns {object|null} */
export function getEntry(entries, file) {
  return entries.find((entry) => entry.file === file) ?? null;
}
