/**
 * Centralized registry of rhinestone-native font families (TXT-101A).
 *
 * This is distinct from src/fonts/FontManager.js (the general desktop-font manifest, used for the
 * 9 bundled OpenType fonts): FontManager only knows id/family/style/weight/path/role/enabled, the
 * minimum a *desktop* font needs. A rhinestone-native family instead needs metadata that only makes
 * sense for a font designed for stone placement -- category, exactly which characters it supports,
 * a recommended/minimum stone size, a recommended gap, and recommended production uses -- so it gets
 * its own registry rather than overloading FontManager's record shape.
 *
 * A family is registered as `{ descriptor, getGlyphStrokes, renderOptions }`:
 *   - descriptor: plain, JSON-serializable metadata (id, displayName, category, recommended sizes,
 *     recommended uses, notes). `supportedCharacters` is derived, not authored -- see getMetadata().
 *   - getGlyphStrokes(character): returns that family's skeleton-stroke definition for one
 *     character (or null if unsupported), consumed by RhinestoneFontProvider.js.
 *   - renderOptions: stroke-construction parameters (capsuleSegments, defaultWidthUnits) consumed
 *     the same way.
 *
 * Future families register the same way (see families/rsBlock.js for the shape to follow) -- no
 * change to this file, RhinestoneFontProvider.js, GeometryEngine, renderers, or exporters is needed
 * to add one, matching every other font already going through FontManager/FontProviderRegistry.
 */

import { SKELETON_SUPPORTED_CHARACTERS } from './skeletonGlyphs.js';

export class RhinestoneFontRegistry {
  constructor() {
    this._families = new Map();
    this._supportedCharactersCache = new Map();
  }

  register(family) {
    if (!family || !family.descriptor || typeof family.descriptor.id !== 'string' || !family.descriptor.id) {
      throw new TypeError('Rhinestone font family requires a descriptor with a non-empty id.');
    }
    if (typeof family.getGlyphStrokes !== 'function') {
      throw new TypeError(`Rhinestone font family "${family.descriptor.id}" requires getGlyphStrokes().`);
    }
    if (!family.renderOptions || typeof family.renderOptions.defaultWidthUnits !== 'number') {
      throw new TypeError(`Rhinestone font family "${family.descriptor.id}" requires renderOptions.defaultWidthUnits.`);
    }
    if (this._families.has(family.descriptor.id)) {
      throw new Error(`Rhinestone font family already registered: ${family.descriptor.id}`);
    }

    this._families.set(family.descriptor.id, family);
    return this;
  }

  has(id) {
    return this._families.has(String(id));
  }

  /** Returns the full family record (functions included) -- used by RhinestoneFontProvider. */
  get(id) {
    const record = this._families.get(String(id));
    if (!record) throw new Error(`Unknown rhinestone font family: ${id}`);
    return record;
  }

  _supportedCharacters(id) {
    const cached = this._supportedCharactersCache.get(id);
    if (cached) return cached;

    const family = this.get(id);
    const characters = SKELETON_SUPPORTED_CHARACTERS.filter((character) => family.getGlyphStrokes(character) !== null);
    this._supportedCharactersCache.set(id, characters);
    return characters;
  }

  /** Returns plain, JSON-serializable metadata for one family -- used by the font browser UI. */
  getMetadata(id) {
    const family = this.get(id);
    return {
      ...family.descriptor,
      supportedCharacters: this._supportedCharacters(id)
    };
  }

  /** Returns metadata for every registered family, in registration order. */
  list() {
    return Array.from(this._families.keys()).map((id) => this.getMetadata(id));
  }

  listCategories() {
    return [...new Set(this.list().map((entry) => entry.category))];
  }
}

export function createRhinestoneFontRegistry(families) {
  const registry = new RhinestoneFontRegistry();
  for (const family of families) registry.register(family);
  return registry;
}
