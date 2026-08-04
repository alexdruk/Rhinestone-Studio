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
import { RhinestoneFontProvider } from './rhinestoneFont/RhinestoneFontProvider.js';
import { createDefaultRhinestoneFontRegistry } from './rhinestoneFont/index.js';

/**
 * Build a FontProviderRegistry with the OpenType provider registered as the default provider
 * (unchanged since RS-0003.4, so every existing project's untagged font id keeps resolving exactly
 * as before), plus the TXT-101A RhinestoneFontProvider registered alongside it under id
 * 'rhinestone'. Two providers can coexist in one registry by design (FontProviderRegistry.js) --
 * GeometryEngine/renderers/exporters need no changes to support a second one.
 *
 * @param {import('../fonts/FontManager.js').FontManager} fontManager
 * @param {object} [options]
 * @param {(path: string) => Promise<ArrayBuffer>} [options.loadFontBuffer]
 * @param {import('./rhinestoneFont/RhinestoneFontRegistry.js').RhinestoneFontRegistry} [options.rhinestoneFontRegistry]
 * @returns {FontProviderRegistry}
 */
export function createDefaultFontProviderRegistry(fontManager, { loadFontBuffer, rhinestoneFontRegistry } = {}) {
  const registry = new FontProviderRegistry();

  registry.register(
    new OpenTypeProvider({
      fontManager,
      ...(loadFontBuffer ? { loadFontBuffer } : {})
    })
  );

  registry.register(
    new RhinestoneFontProvider({
      registry: rhinestoneFontRegistry ?? createDefaultRhinestoneFontRegistry()
    })
  );

  return registry;
}
