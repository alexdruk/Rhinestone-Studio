/**
 * Vector Text Geometry Engine.
 *
 * Per docs/ARCHITECTURE.md, the Geometry Engine is the only component
 * allowed to generate stone positions. This module converts text
 * parameters into a deterministic StoneLayout via:
 *
 *   Text Parameters -> FontProviderRegistry -> VectorPath -> GeometryEngine -> StoneLayout
 *
 * This module has no dependency on the DOM, Canvas, WebGL, the renderer, or
 * any exporter. It only consumes the neutral FontProviderRegistry / VectorPath
 * shapes from src/text.
 *
 * Units are millimeters throughout.
 */

import { BoundingBox } from '../text/VectorPath.js';
import { flattenContourToPolygon, translateContour } from './ContourGeometry.js';
import { sampleFillPoints, sampleOutlinePoints } from './StoneSampler.js';
import { Stone } from './Stone.js';
import { StoneLayout } from './StoneLayout.js';

const TEXT_MODES = new Set(['outline', 'fill']);
const DEFAULT_MODE = 'outline';

export class GeometryEngine {
  /**
   * @param {object} options
   * @param {import('../text/FontProviderRegistry.js').FontProviderRegistry} options.fontProviderRegistry
   */
  constructor({ fontProviderRegistry } = {}) {
    if (!fontProviderRegistry || typeof fontProviderRegistry.getTextPath !== 'function') {
      throw new TypeError('GeometryEngine requires a fontProviderRegistry with getTextPath().');
    }
    this._fontProviderRegistry = fontProviderRegistry;
  }

  /**
   * Generate a StoneLayout for a text layer.
   *
   * @param {object} params
   * @param {string} params.text
   * @param {string} params.fontId
   * @param {string} params.layerId
   * @param {number} params.heightMm Requested text height in millimeters.
   * @param {number} params.stoneSizeMm
   * @param {number} [params.gapMm]
   * @param {number} [params.letterSpacingMm]
   * @param {'outline'|'fill'} [params.mode]
   * @param {string} [params.providerId] Font provider id, defaults to the registry default.
   * @returns {Promise<StoneLayout>}
   */
  async generateTextLayout(params = {}) {
    const options = normalizeTextParams(params);

    const contours = await this._buildPositionedContours(options);
    const polygons = contours.map((contour) => flattenContourToPolygon(contour));
    const spacingMm = options.stoneSizeMm + options.gapMm;

    const points = options.mode === 'fill'
      ? sampleFillPoints(polygons, BoundingBox.fromPoints(polygons.flat()), spacingMm)
      : polygons.flatMap((polygon) => sampleOutlinePoints(polygon, spacingMm));

    const stones = points.map((point, index) => new Stone({
      xMm: point.xMm,
      yMm: point.yMm,
      sizeMm: options.stoneSizeMm,
      color: options.color,
      layerId: options.layerId,
      index
    }));

    return new StoneLayout({ layerId: options.layerId, sourceMode: options.mode, stones });
  }

  /**
   * Resolve each character to a glyph VectorPath through the
   * FontProviderRegistry and translate its contours to the correct pen
   * position, honoring letter spacing between characters.
   *
   * @param {ReturnType<typeof normalizeTextParams>} options
   * @returns {Promise<import('../text/VectorPath.js').Contour[]>}
   */
  async _buildPositionedContours(options) {
    const characters = Array.from(options.text);
    const contours = [];
    let penXMm = 0;

    for (let i = 0; i < characters.length; i++) {
      const result = await this._fontProviderRegistry.getTextPath({
        providerId: options.providerId ?? undefined,
        fontId: options.fontId,
        text: characters[i],
        heightMm: options.heightMm
      });

      for (const contour of result.path.contours) {
        contours.push(translateContour(contour, penXMm, 0));
      }

      penXMm += result.metrics.advanceWidthMm;
      if (i < characters.length - 1) {
        penXMm += options.letterSpacingMm;
      }
    }

    return contours;
  }
}

function normalizeTextParams(params) {
  if (typeof params.text !== 'string' || params.text.length === 0) {
    throw new TypeError('GeometryEngine.generateTextLayout requires non-empty text.');
  }
  if (typeof params.fontId !== 'string' || params.fontId.length === 0) {
    throw new TypeError('GeometryEngine.generateTextLayout requires a non-empty fontId.');
  }
  if (typeof params.layerId !== 'string' || params.layerId.length === 0) {
    throw new TypeError('GeometryEngine.generateTextLayout requires a non-empty layerId.');
  }

  const heightMm = assertPositiveNumber(params.heightMm, 'heightMm');
  const stoneSizeMm = assertPositiveNumber(params.stoneSizeMm, 'stoneSizeMm');

  const gapMm = assertFiniteNumber(params.gapMm ?? 0, 'gapMm');
  if (gapMm < 0) {
    throw new RangeError('gapMm must be zero or positive.');
  }

  const letterSpacingMm = assertFiniteNumber(params.letterSpacingMm ?? 0, 'letterSpacingMm');

  const mode = params.mode ?? DEFAULT_MODE;
  if (!TEXT_MODES.has(mode)) {
    throw new TypeError(`Unsupported geometry mode: ${mode}. Expected one of: ${[...TEXT_MODES].join(', ')}`);
  }

  if (params.color !== undefined && params.color !== null &&
    (typeof params.color !== 'string' || params.color.length === 0)) {
    throw new TypeError('GeometryEngine.generateTextLayout color must be a non-empty string when provided.');
  }

  return {
    text: params.text,
    fontId: params.fontId,
    layerId: params.layerId,
    heightMm,
    stoneSizeMm,
    gapMm,
    letterSpacingMm,
    mode,
    color: params.color ?? null,
    providerId: params.providerId ?? null
  };
}

function assertFiniteNumber(value, name) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new TypeError(`${name} must be a finite number.`);
  }
  return value;
}

function assertPositiveNumber(value, name) {
  assertFiniteNumber(value, name);
  if (value <= 0) {
    throw new RangeError(`${name} must be positive.`);
  }
  return value;
}

export function createGeometryEngine(options) {
  return new GeometryEngine(options);
}
