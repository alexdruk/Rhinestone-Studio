/**
 * Default font provider wiring for Rhinestone Studio.
 *
 * The registry and the OpenType provider are generic building blocks; this
 * module is the one place that actually registers the OpenType provider so
 * callers can obtain a ready-to-use FontProviderRegistry instead of wiring
 * providers by hand at every call site.
 */

import { FontProviderRegistry } from './FontProviderRegistry.js';
import { OpenTypeProvider } from './OpenTypeProvider.js';

/**
 * Build a FontProviderRegistry with the OpenType provider registered as the
 * default provider.
 *
 * @param {import('../fonts/FontManager.js').FontManager} fontManager
 * @param {object} [options]
 * @param {(path: string) => Promise<ArrayBuffer>} [options.loadFontBuffer]
 * @returns {FontProviderRegistry}
 */
export function createDefaultFontProviderRegistry(fontManager, { loadFontBuffer } = {}) {
  const registry = new FontProviderRegistry();

  registry.register(
    new OpenTypeProvider({
      fontManager,
      ...(loadFontBuffer ? { loadFontBuffer } : {})
    })
  );

  return registry;
}
