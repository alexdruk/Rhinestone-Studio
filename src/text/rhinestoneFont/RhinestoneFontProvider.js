/**
 * Font provider for original rhinestone-native families (TXT-101A restart) -- currently one
 * diagnostic-only prototype, RS Block Prototype (SS10). Two earlier full-coverage approaches
 * (a shared centerline skeleton expanded into stroke ribbons; a from-scratch vector-outline rebuild
 * combining primitive shapes via boolean union/subtract) both failed manual readability QA -- see
 * families/rsBlockPrototypeSS10.js's module doc and this restart's final report. A family returns
 * *exact stone center positions* (already in millimeters, already at the family's one fixed pitch)
 * rather than any vector shape a stroker or sampler would need to interpret.
 *
 * This provider hands those positions to GeometryEngine via FontProviderResult.stoneCenters -- the
 * IFontProvider contract's dedicated field for "explicit authored stone centers instead of glyph
 * contours" (see src/text/VectorPath.js). GeometryEngine converts stoneCenters directly into
 * ordinary Stone objects (see GeometryEngine._buildPositionedContours()/generateTextLayout()), with
 * no contour flattening, no StoneSampler involvement, and no dependency on the requested fill mode.
 * This replaces an earlier version of this file that encoded each stone as a placeholder triangle
 * contour and relied on StoneSampler's outline-mode sampler always taking its first sample at a
 * contour's first vertex -- a real-geometry-pipeline workaround, not a legitimate contract. There is
 * no such workaround here: `path` below is always empty (no contours at all) for this provider.
 *
 * Still implements the same IFontProvider contract as OpenTypeProvider.js and is registered
 * alongside it in the same FontProviderRegistry (see defaultFontProviders.js), so GeometryEngine and
 * every downstream consumer (2D canvas, 3D preview, SVG/PNG/JSON export, production sheet) need no
 * changes beyond GeometryEngine's own stoneCenters handling -- they only ever see the resulting
 * StoneLayout/Stone objects, same as any other layer.
 *
 * Deliberately NOT scaled by `heightMm`: each family here is authored at one fixed stone pitch for
 * one fixed stone size (see the family's own descriptor.recommendedStoneSizeMm/recommendedGapMm),
 * and rescaling stone positions would change the pitch between them, defeating the point of a
 * fixed-stone diagnostic. `heightMm` is still validated (required by the IFontProvider contract) but
 * otherwise unused. See the family module for exactly which stone size/gap this is valid at, and its
 * descriptor.fillModeIndependent flag for why the requested fill mode is never applied.
 */

import { IFontProvider } from '../IFontProvider.js';
import { VectorPath, GlyphMetrics, FontProviderResult, BoundingBox, Point2D } from '../VectorPath.js';

// Advance width used for a character the registered family has no stone map for, so one
// unsupported character never breaks an entire text layer -- matches how OpenType's .notdef
// silently advances the pen instead of throwing. The QA sheet generator (see
// tools/generate-rs-block-prototype-qa-sheet.mjs) is the place unsupported characters are surfaced
// visibly; this fallback exists only so a stray unsupported character never corrupts the rest of a
// layer's geometry.
const FALLBACK_ADVANCE_MM = 3.1 * 6;

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

  /**
   * @param {object} options
   * @param {string} options.fontId Rhinestone font family id (e.g. 'rs-block-prototype-ss10').
   * @param {string} options.text
   * @param {number} options.heightMm Validated but not applied -- see module doc.
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

    const family = this._registry.get(fontId);
    // Always empty: this provider never produces glyph contours, only authored stone centers (see
    // stoneCenters below) -- an empty VectorPath, not a placeholder shape standing in for stones.
    const path = new VectorPath({ id: `${fontId}:${text}`, source: 'font:rhinestone' });
    const stoneCenters = [];
    let advanceWidthMm = 0;
    let previousCharacter = null;

    for (const character of Array.from(text)) {
      // Optional, additive per-family hook (see families/rsBlock.js's module doc) -- a family
      // without getKerningAdjustmentMm() behaves exactly as before this field existed.
      if (previousCharacter !== null && typeof family.getKerningAdjustmentMm === 'function') {
        advanceWidthMm += family.getKerningAdjustmentMm(previousCharacter, character);
      }

      const glyph = family.getGlyphStoneMap(character);

      if (glyph) {
        for (const stone of glyph.stones) {
          stoneCenters.push({ xMm: stone.xMm + advanceWidthMm, yMm: stone.yMm });
        }
        advanceWidthMm += glyph.advanceWidthMm;
      } else {
        advanceWidthMm += FALLBACK_ADVANCE_MM;
      }
      previousCharacter = character;
    }

    const boundingBox = BoundingBox.fromPoints(stoneCenters.map((c) => new Point2D(c.xMm, c.yMm)));
    const metrics = new GlyphMetrics({
      advanceWidthMm,
      boundingBox,
      ascenderMm: boundingBox ? boundingBox.maxYmm : 0,
      descenderMm: boundingBox ? boundingBox.minYmm : 0
    });

    return new FontProviderResult({ path, metrics, fontId, text, heightMm, stoneCenters });
  }
}

export function createRhinestoneFontProvider(options) {
  return new RhinestoneFontProvider(options);
}
