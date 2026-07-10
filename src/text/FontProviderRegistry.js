import { assertFontProvider } from './IFontProvider.js';

/**
 * Registry for text/vector font providers.
 *
 * Rhinestone Studio must not couple the Geometry Engine to OpenType, SVG fonts,
 * Google Fonts, or any future provider. This registry is the small orchestration
 * layer that lets application code select a provider while the rest of the
 * engine consumes only FontProviderResult and VectorPath objects.
 */
export class FontProviderRegistry {
  constructor({ defaultProviderId = null } = {}) {
    this._providers = new Map();
    this._defaultProviderId = defaultProviderId;
  }

  /**
   * Register a provider implementation.
   *
   * @param {IFontProvider} provider
   * @returns {FontProviderRegistry}
   */
  register(provider) {
    assertFontProvider(provider);

    if (this._providers.has(provider.id)) {
      throw new Error(`Font provider already registered: ${provider.id}`);
    }

    this._providers.set(provider.id, provider);

    if (!this._defaultProviderId) {
      this._defaultProviderId = provider.id;
    }

    return this;
  }

  has(providerId) {
    return this._providers.has(providerId);
  }

  get(providerId = this._defaultProviderId) {
    if (!providerId) {
      throw new Error('No font provider has been registered.');
    }

    const provider = this._providers.get(providerId);
    if (!provider) {
      throw new Error(`Unknown font provider: ${providerId}`);
    }

    return provider;
  }

  setDefault(providerId) {
    if (!this._providers.has(providerId)) {
      throw new Error(`Cannot set unknown provider as default: ${providerId}`);
    }

    this._defaultProviderId = providerId;
    return this;
  }

  get defaultProviderId() {
    return this._defaultProviderId;
  }

  list() {
    return Array.from(this._providers.values()).map((provider) => ({
      id: provider.id,
      displayName: provider.displayName
    }));
  }

  async load(providerId = this._defaultProviderId) {
    const provider = this.get(providerId);
    await provider.load();
    return provider;
  }

  /**
   * Create a vector text path through a selected provider.
   *
   * This method is intentionally thin. It does not inspect glyphs, sample stones,
   * render text, or apply manufacturing rules. It only guarantees that callers
   * use a registered provider and receive that provider's neutral result.
   */
  async getTextPath(options) {
    const providerId = options?.providerId ?? this._defaultProviderId;
    const provider = this.get(providerId);

    if (typeof provider.isAvailable === 'function') {
      const available = await provider.isAvailable();
      if (!available) {
        throw new Error(`Font provider is not available: ${provider.id}`);
      }
    }

    await provider.load();
    return provider.getTextPath(options);
  }
}

export function createFontProviderRegistry(providers = [], options = {}) {
  const registry = new FontProviderRegistry(options);
  for (const provider of providers) {
    registry.register(provider);
  }
  return registry;
}
