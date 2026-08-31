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
    notes: record.notes === undefined ? '' : String(record.notes),
    // TXT-101A: which FontProviderRegistry provider resolves this font id's glyph geometry.
    // Defaults to 'opentype' so every font record from before this field existed (all 9 bundled
    // desktop fonts) keeps resolving exactly as before with zero manifest changes required.
    providerId: String(record.providerId ?? 'opentype'),
    // FONT-DECISION-001: an OpenType-provider font that has separately cleared this project's
    // human-and-metric rhinestone legibility bar (vision-transcription + rated dot-render review),
    // and should therefore be offered in the production font picker alongside the authored
    // providerId:'rhinestone' fonts. Defaults to false so every pre-existing OpenType record (the
    // 9 legacy desktop fonts, never validated for stone-dot legibility) stays hidden from the
    // picker exactly as FONT-002 decided.
    rhinestoneValidated: Boolean(record.rhinestoneValidated ?? false),
    // FONT-PORTFOLIO-001: stone-size ids (StoneSizes.js's lowercase "ss30"-style ids) this font's
    // own human rating pass found unreadable at, independent of any shape's printable-area limit --
    // e.g. Anton/Sacramento/Dancing Script all collapsed at SS30. Defaults to [] so every existing
    // record (including a font with no rating data at all) stays fully enabled across all sizes,
    // exactly like before this field existed. Purely data: app.js's
    // updateStoneSizePrintableCapabilityUI() reads this list to gray out a stone size, so
    // re-enabling one later is a manifest edit, never a code change.
    unsupportedStoneSizes: Object.freeze(Array.isArray(record.unsupportedStoneSizes) ? record.unsupportedStoneSizes.map(String) : []),
    // TXT-104: ratio of a rendered capital letter's (resp. lowercase 'x''s) real bounding-box height
    // to the em-square heightMm the engine is actually given -- see assets/fonts/manifest.json's own
    // values and tools/measure-font-height-ratios.mjs for how these are derived. Defaults to
    // undefined for every record that doesn't carry it (the two authored rhinestone fonts, which have
    // no OpenType em-box concept at all, and every non-validated legacy OpenType font), so nothing
    // existing changes behavior.
    capHeightRatio: typeof record.capHeightRatio === 'number' ? record.capHeightRatio : undefined,
    xHeightRatio: typeof record.xHeightRatio === 'number' ? record.xHeightRatio : undefined,
    // READ-003: ratio of this font's dominant stem width (p75 of the interior local-stroke-width
    // distribution over PRODUCTION_REVIEW_GLYPHS) to the em-square heightMm the engine is given --
    // see tools/measure-font-stem-width.mjs. app.js's textStrokeNarrowerThanOneStone() multiplies it
    // by the layer's height to get the stroke width in mm and compares that to the stone diameter:
    // for an interior-filling text mode, a stroke narrower than one stone can never be rendered
    // legibly (the stone overhangs it on both sides). This backs Layer 1 of the readability program
    // in docs/specifications/READ-000-readability-architecture.md. Defaults to undefined for records
    // without it (the two authored rhinestone fonts, which have no vector outline, and any
    // older/legacy manifest), so nothing existing changes behavior.
    stemWidthRatio: typeof record.stemWidthRatio === 'number' ? record.stemWidthRatio : undefined
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
