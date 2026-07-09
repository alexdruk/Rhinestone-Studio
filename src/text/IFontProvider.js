/**
 * Font provider interface for Rhinestone Studio.
 *
 * JavaScript has no native interface keyword, so this base class documents and
 * enforces the expected API. Concrete providers may parse OpenType, SVG fonts,
 * Google Fonts responses, or any future vector source, but all must return the
 * same neutral FontProviderResult shape.
 */

export class IFontProvider {
  get id() {
    throw new Error('IFontProvider subclasses must implement id.');
  }

  get displayName() {
    throw new Error('IFontProvider subclasses must implement displayName.');
  }

  async isAvailable() {
    return true;
  }

  /**
   * Load provider resources if needed.
   *
   * @returns {Promise<void>}
   */
  async load() {
    throw new Error('IFontProvider subclasses must implement load().');
  }

  /**
   * Convert text into a VectorPath plus metrics.
   *
   * @param {object} options
   * @param {string} options.fontId Stable font identifier from FontManager.
   * @param {string} options.text Text to convert.
   * @param {number} options.heightMm Requested text height in millimeters.
   * @returns {Promise<FontProviderResult>}
   */
  async getTextPath(_options) {
    throw new Error('IFontProvider subclasses must implement getTextPath(options).');
  }
}

export function assertFontProvider(provider) {
  const requiredMethods = ['load', 'getTextPath', 'isAvailable'];

  if (!provider || typeof provider !== 'object') {
    throw new TypeError('Font provider must be an object.');
  }

  for (const method of requiredMethods) {
    if (typeof provider[method] !== 'function') {
      throw new TypeError(`Font provider is missing method: ${method}`);
    }
  }

  if (typeof provider.id !== 'string' || provider.id.length === 0) {
    throw new TypeError('Font provider must expose a non-empty string id.');
  }

  return true;
}
