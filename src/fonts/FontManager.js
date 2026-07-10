const DEFAULT_FONT_ID = 'courier-prime-regular';

function assertObject(value, name) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${name} must be an object`);
  }
}

function normalizeFontRecord(record) {
  assertObject(record, 'Font record');

  const id = String(record.id ?? '').trim();
  const family = String(record.family ?? '').trim();
  const style = String(record.style ?? 'Regular').trim();
  const path = String(record.path ?? '').trim();

  if (!id) throw new Error('Font record requires a non-empty id.');
  if (!family) throw new Error(`Font ${id} requires a non-empty family.`);
  if (!path) throw new Error(`Font ${id} requires a non-empty path.`);

  return Object.freeze({
    id,
    family,
    style,
    weight: Number(record.weight ?? 400),
    path,
    role: String(record.role ?? 'display'),
    enabled: Boolean(record.enabled ?? true),
    notes: record.notes === undefined ? '' : String(record.notes)
  });
}

function normalizeManifest(manifest) {
  assertObject(manifest, 'Font manifest');
  const fonts = Array.isArray(manifest.fonts) ? manifest.fonts.map(normalizeFontRecord) : [];

  const seen = new Set();
  for (const font of fonts) {
    if (seen.has(font.id)) throw new Error(`Duplicate font id in manifest: ${font.id}`);
    seen.add(font.id);
  }

  return Object.freeze({
    version: Number(manifest.version ?? 1),
    fonts: Object.freeze(fonts)
  });
}

export class FontManager {
  constructor(manifest = { version: 1, fonts: [] }) {
    this.manifest = normalizeManifest(manifest);
    this.fontsById = new Map(this.manifest.fonts.map((font) => [font.id, font]));
  }

  static async fromUrl(url, fetchImpl = globalThis.fetch) {
    if (typeof fetchImpl !== 'function') {
      throw new Error('FontManager.fromUrl requires a fetch implementation.');
    }

    const response = await fetchImpl(url);
    if (!response.ok) {
      throw new Error(`Unable to load font manifest ${url}: ${response.status} ${response.statusText}`);
    }

    return new FontManager(await response.json());
  }

  listFonts(options = {}) {
    const includeDisabled = Boolean(options.includeDisabled ?? false);
    return this.manifest.fonts.filter((font) => includeDisabled || font.enabled);
  }

  listFamilies(options = {}) {
    const families = new Set(this.listFonts(options).map((font) => font.family));
    return [...families].sort((a, b) => a.localeCompare(b));
  }

  hasFont(fontId) {
    return this.fontsById.has(String(fontId));
  }

  getFont(fontId) {
    const id = String(fontId ?? '').trim();
    const font = this.fontsById.get(id);
    if (!font) throw new Error(`Unknown font id: ${id}`);
    return font;
  }

  getDefaultFont() {
    if (this.hasFont(DEFAULT_FONT_ID)) return this.getFont(DEFAULT_FONT_ID);
    const enabled = this.listFonts();
    if (enabled.length > 0) return enabled[0];
    if (this.manifest.fonts.length > 0) return this.manifest.fonts[0];
    throw new Error('Font registry is empty.');
  }

  findByFamily(family, options = {}) {
    const requestedFamily = String(family ?? '').trim().toLowerCase();
    if (!requestedFamily) return [];
    return this.listFonts(options).filter((font) => font.family.toLowerCase() === requestedFamily);
  }

  toJSON() {
    return {
      version: this.manifest.version,
      fonts: this.manifest.fonts.map((font) => ({ ...font }))
    };
  }
}

export { DEFAULT_FONT_ID };
