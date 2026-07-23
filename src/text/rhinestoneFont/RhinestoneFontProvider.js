/**
 * Font provider for original rhinestone-native families (TXT-101A restart) -- currently one
 * diagnostic-only prototype, RS Block Prototype (SS10). Two earlier full-coverage approaches
 * (a shared centerline skeleton expanded into stroke ribbons; a from-scratch vector-outline rebuild
 * combining primitive shapes via boolean union/subtract) both failed manual readability QA -- see
 * families/rsBlockPrototypeSS10.js's module doc and this restart's final report. This provider now
 * implements a fundamentally different, much simpler contract: a family returns *exact stone center
 * positions* (already in millimeters, already at the family's one fixed pitch) rather than any
 * vector shape a stroker or sampler would need to interpret.
 *
 * Still implements the same IFontProvider contract as OpenTypeProvider.js and is registered
 * alongside it in the same FontProviderRegistry (see defaultFontProviders.js), so GeometryEngine and
 * every downstream consumer (2D canvas, 3D preview, SVG/PNG/JSON export, production sheet) need no
 * changes at all -- they only ever see FontProviderResult/VectorPath, same as before.
 *
 * The mechanism: each authored stone becomes a tiny (sub-visible, ~0.02mm) triangle contour whose
 * *first* vertex is the exact authored millimeter position. GeometryEngine's existing outline-mode
 * sampler (sampleOutlinePoints in StoneSampler.js) always takes its first sample at a contour's
 * first vertex (arc-length target 0 resolves to t=0 on the first segment, i.e. exactly that point,
 * see sampleOutlinePoints' own math) and the triangle's tiny perimeter guarantees exactly one sample
 * is ever taken from it (the walk's next step, spacingMm further along, always exceeds a ~0.06mm
 * perimeter). So the authored position reproduces exactly through the unmodified production
 * pipeline -- no new sampling code, no duplicate rendering/export logic, and the same guarantee any
 * other font's glyph outline gets. This only makes geometric sense in Outline fill mode ("stones
 * follow the letters"); Fill/Staggered/Radial/Contour modes sample by interior area, which these
 * near-zero-area triangles don't meaningfully have -- a documented prototype limitation, not a bug.
 *
 * Deliberately NOT scaled by `heightMm`: each family here is authored at one fixed stone pitch for
 * one fixed stone size (see the family's own descriptor.recommendedStoneSizeMm/recommendedGapMm),
 * and rescaling stone positions would change the pitch between them, defeating the point of a
 * fixed-stone diagnostic. `heightMm` is still validated (required by the IFontProvider contract) but
 * otherwise unused. See the family module for exactly which stone size/gap this is valid at.
 */

import { IFontProvider } from '../IFontProvider.js';
import { Contour, VectorPath, GlyphMetrics, FontProviderResult } from '../VectorPath.js';

// Sub-visible triangle size for one stone's placeholder contour -- large enough to give the
// contour a well-defined (non-zero) perimeter and bounding box, far too small to be visible at any
// production stone size (2mm+). See this module's doc for why the *first* vertex, not the
// triangle's centroid, is what actually reproduces the authored position.
const DOT_EPSILON_MM = 0.02;

// Advance width used for a character the registered family has no stone map for, so one
// unsupported character never breaks an entire text layer -- matches how OpenType's .notdef
// silently advances the pen instead of throwing. The QA sheet generator (see
// tools/generate-rs-block-prototype-qa-sheet.mjs) is the place unsupported characters are surfaced
// visibly; this fallback exists only so a stray unsupported character never corrupts the rest of a
// layer's geometry.
const FALLBACK_ADVANCE_MM = 3.1 * 6;

function dotContour(xMm, yMm) {
  const contour = new Contour();
  contour.moveTo(xMm, yMm);
  contour.lineTo(xMm + DOT_EPSILON_MM, yMm);
  contour.lineTo(xMm + DOT_EPSILON_MM / 2, yMm + DOT_EPSILON_MM);
  contour.closePath();
  return contour;
}

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
    const path = new VectorPath({ id: `${fontId}:${text}`, source: 'font:rhinestone' });
    let advanceWidthMm = 0;

    for (const character of Array.from(text)) {
      const glyph = family.getGlyphStoneMap(character);

      if (glyph) {
        for (const stone of glyph.stones) {
          path.addContour(dotContour(stone.xMm + advanceWidthMm, stone.yMm));
        }
        advanceWidthMm += glyph.advanceWidthMm;
      } else {
        advanceWidthMm += FALLBACK_ADVANCE_MM;
      }
    }

    const boundingBox = path.getBoundingBox();
    const metrics = new GlyphMetrics({
      advanceWidthMm,
      boundingBox,
      ascenderMm: boundingBox ? boundingBox.maxYmm : 0,
      descenderMm: boundingBox ? boundingBox.minYmm : 0
    });

    return new FontProviderResult({ path, metrics, fontId, text, heightMm });
  }
}

export function createRhinestoneFontProvider(options) {
  return new RhinestoneFontProvider(options);
}
