/**
 * Font provider for original rhinestone-native families (TXT-101A) -- RS Block, RS Modern, RS
 * Script. Implements the same IFontProvider contract as OpenTypeProvider.js and is registered
 * alongside it in the same FontProviderRegistry (see defaultFontProviders.js), so GeometryEngine
 * and every downstream consumer (2D canvas, 3D preview, SVG/PNG/JSON export, production sheet) need
 * no changes at all -- they already only ever see FontProviderResult/VectorPath.
 *
 * Per-glyph outlines are expensive to build (RhinestoneStrokeGeometry.js's buildGlyphOutline() runs
 * a Boolean Operations union per glyph) but are entirely determined by (familyId, character) --
 * independent of heightMm or position -- so they're computed once in abstract unit space and cached
 * for the life of this provider instance, then cheaply scaled/translated per request. This mirrors
 * OpenTypeProvider._parsedFontsById's existing "cache the one expensive step, never evict" pattern.
 */

import { IFontProvider } from '../IFontProvider.js';
import { Contour, VectorPath, GlyphMetrics, FontProviderResult } from '../VectorPath.js';
import { buildGlyphOutline } from './RhinestoneStrokeGeometry.js';
import { UNITS_PER_EM, ASCENDER, DESCENDER } from './skeletonGlyphs.js';

// Advance width used for a character no registered family has skeleton data for, so one
// unsupported character never breaks an entire text layer -- matches how OpenType's .notdef
// silently advances the pen instead of throwing. See TXT-101A's final report for exactly which
// characters are deferred.
const FALLBACK_ADVANCE_UNITS = UNITS_PER_EM * 0.5;

export class RhinestoneFontProvider extends IFontProvider {
  /**
   * @param {object} options
   * @param {import('./RhinestoneFontRegistry.js').RhinestoneFontRegistry} options.registry
   * @param {string} [options.id]
   * @param {string} [options.displayName]
   */
  constructor({ registry, id = 'rhinestone', displayName = 'Rhinestone Native' } = {}) {
    super();

    if (!registry || typeof registry.get !== 'function') {
      throw new TypeError('RhinestoneFontProvider requires a RhinestoneFontRegistry.');
    }

    this._registry = registry;
    this._id = id;
    this._displayName = displayName;
    this._glyphOutlineCache = new Map();
  }

  get id() {
    return this._id;
  }

  get displayName() {
    return this._displayName;
  }

  async isAvailable() {
    return true;
  }

  async load() {}

  _glyphOutlineUnits(familyId, character) {
    const key = `${familyId}:${character}`;
    const cached = this._glyphOutlineCache.get(key);
    if (cached) return cached;

    const family = this._registry.get(familyId);
    const glyph = family.getGlyphStrokes(character);

    const result = glyph
      ? {
          contours: buildGlyphOutline(glyph.strokes, family.renderOptions.defaultWidthUnits, {
            capsuleSegments: family.renderOptions.capsuleSegments
          }),
          widthUnits: glyph.width
        }
      : { contours: [], widthUnits: FALLBACK_ADVANCE_UNITS };

    this._glyphOutlineCache.set(key, result);
    return result;
  }

  /**
   * @param {object} options
   * @param {string} options.fontId Rhinestone font family id (e.g. 'rs-block-regular').
   * @param {string} options.text
   * @param {number} options.heightMm
   * @returns {Promise<FontProviderResult>}
   */
  async getTextPath({ fontId, text, heightMm } = {}) {
    if (typeof fontId !== 'string' || fontId.length === 0) {
      throw new TypeError('RhinestoneFontProvider.getTextPath requires a non-empty fontId.');
    }
    if (typeof text !== 'string' || text.length === 0) {
      throw new TypeError('RhinestoneFontProvider.getTextPath requires non-empty text.');
    }
    if (typeof heightMm !== 'number' || !Number.isFinite(heightMm) || heightMm <= 0) {
      throw new TypeError('RhinestoneFontProvider.getTextPath requires a positive heightMm.');
    }

    // Ensures an unknown fontId throws the same way OpenTypeProvider/FontManager throw for one,
    // even for text made only of unsupported characters (which would otherwise produce an empty
    // path and never touch the registry).
    this._registry.get(fontId);

    const unitsToMm = heightMm / UNITS_PER_EM;
    const path = new VectorPath({ id: `${fontId}:${text}`, source: 'font:rhinestone' });
    let advanceWidthMm = 0;

    for (const character of Array.from(text)) {
      const { contours, widthUnits } = this._glyphOutlineUnits(fontId, character);

      for (const polygon of contours) {
        const contour = new Contour();
        polygon.forEach((point, index) => {
          const xMm = point.xMm * unitsToMm + advanceWidthMm;
          const yMm = point.yMm * unitsToMm;
          if (index === 0) contour.moveTo(xMm, yMm);
          else contour.lineTo(xMm, yMm);
        });
        contour.closePath();
        path.addContour(contour);
      }

      advanceWidthMm += widthUnits * unitsToMm;
    }

    const metrics = new GlyphMetrics({
      advanceWidthMm,
      boundingBox: path.getBoundingBox(),
      ascenderMm: ASCENDER * unitsToMm,
      descenderMm: DESCENDER * unitsToMm
    });

    return new FontProviderResult({ path, metrics, fontId, text, heightMm });
  }
}

export function createRhinestoneFontProvider(options) {
  return new RhinestoneFontProvider(options);
}
