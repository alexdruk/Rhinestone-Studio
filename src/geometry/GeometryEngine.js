/**
 * Vector Text and Shape Geometry Engine.
 *
 * Per docs/ARCHITECTURE.md, the Geometry Engine is the only component
 * allowed to generate stone positions. This module converts text and shape
 * (circle/rectangle) parameters into a deterministic StoneLayout via:
 *
 *   Text Parameters -> FontProviderRegistry -> VectorPath -> GeometryEngine -> StoneLayout
 *   Shape Parameters -> VectorPath -> GeometryEngine -> StoneLayout
 *
 * Both paths share the same contour-flattening (ContourGeometry.js) and
 * outline/fill sampling (StoneSampler.js) primitives, and produce the same
 * Stone/StoneLayout product, so callers never need to distinguish text-
 * generated stones from shape-generated stones.
 *
 * This module has no dependency on the DOM, Canvas, WebGL, the renderer, or
 * any exporter. It only consumes the neutral FontProviderRegistry / VectorPath
 * shapes from src/text.
 *
 * Units are millimeters throughout.
 */

import { BoundingBox, Point2D, createCircleVectorPath, createRectangleVectorPath } from '../text/VectorPath.js';
import { flattenContourToPolygon, translateContour } from './ContourGeometry.js';
import { sampleFillPoints, sampleOutlinePoints, sampleFieldFillPoints } from './StoneSampler.js';
import { Stone } from './Stone.js';
import { StoneLayout } from './StoneLayout.js';
import { parseSvgDocument } from '../svg/index.js';
import { prepareImageField } from '../image/index.js';
import { CURVE_ALIGNMENTS, CURVE_DIRECTIONS, projectPolygonToArc } from './ArcProjection.js';

const SAMPLE_MODES = new Set(['outline', 'fill']);
const DEFAULT_MODE = 'outline';
const SHAPE_TYPES = new Set(['circle', 'rectangle']);

export class GeometryEngine {
  /**
   * @param {object} [options]
   * @param {import('../text/FontProviderRegistry.js').FontProviderRegistry} [options.fontProviderRegistry]
   *   Required by generateTextLayout(); optional here so shape-only generation does not depend
   *   on font infrastructure being available.
   */
  constructor({ fontProviderRegistry = null } = {}) {
    if (fontProviderRegistry !== null && typeof fontProviderRegistry.getTextPath !== 'function') {
      throw new TypeError('GeometryEngine fontProviderRegistry must implement getTextPath().');
    }
    this._fontProviderRegistry = fontProviderRegistry;
  }

  /**
   * Whether this engine was constructed with a fontProviderRegistry, i.e. whether
   * generateTextLayout() can be called without throwing. Callers that want to degrade text
   * generation gracefully (rather than catching a thrown error) can check this first; shape
   * generation via generateShapeLayout() never depends on it.
   *
   * @returns {boolean}
   */
  get canGenerateText() {
    return this._fontProviderRegistry !== null;
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
    if (!this._fontProviderRegistry) {
      throw new TypeError('GeometryEngine.generateTextLayout requires a fontProviderRegistry (none was supplied to the constructor).');
    }
    const options = normalizeTextParams(params);
    const { polygons } = await this._textPolygons(options);
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
   * Resolve a text run's flattened (and, if curved, arc-projected) polygon contours in absolute
   * millimeters, without sampling stones. RS-1012: the shared "get this text's vector outline"
   * entry point Vector Boolean Operations use to build a boolean input source (see
   * src/geometry/PathBoolean.js) -- calls the exact same `_textPolygons()` helper
   * generateTextLayout() uses (including curved-text arc projection), so a text layer's boolean
   * outline and its stone-sampled outline are always the same geometry. Requires a
   * fontProviderRegistry, exactly like generateTextLayout().
   *
   * @param {object} params Same shape as generateTextLayout()'s params, minus stoneSizeMm/gapMm/mode/color.
   * @returns {Promise<{polygons: import('../text/VectorPath.js').Point2D[][], boundingBox: BoundingBox|null}>}
   */
  async resolveTextPolygons(params = {}) {
    if (!this._fontProviderRegistry) {
      throw new TypeError('GeometryEngine.resolveTextPolygons requires a fontProviderRegistry (none was supplied to the constructor).');
    }
    const options = normalizeTextParams({ ...params, stoneSizeMm: 1, mode: DEFAULT_MODE });
    return this._textPolygons(options);
  }

  async _textPolygons(options) {
    const { contours, totalAdvanceWidthMm } = await this._buildPositionedContours(options);
    let polygons = contours.map((contour) => flattenContourToPolygon(contour));

    // RS-1003: Arc projection stage. Runs after flattening (so it warps dense polygon vertices,
    // not bezier control points — see src/geometry/ArcProjection.js) and before sampling (so
    // outline/fill sampling walks the already-curved polygons exactly like it walks straight ones,
    // with no changes to ContourGeometry.js/StoneSampler.js). curveEnabled defaults to false, so
    // straight text takes none of this path and is byte-identical to before this milestone.
    if (options.curveEnabled) {
      const arcOptions = {
        totalAdvanceWidthMm,
        radiusMm: options.curveRadiusMm,
        direction: options.curveDirection,
        startAngleDeg: options.curveStartAngleDeg,
        sweepAngleDeg: options.curveSweepAngleDeg,
        alignment: options.curveAlignment
      };
      polygons = polygons.map((polygon) => projectPolygonToArc(polygon, arcOptions));
    }

    return { polygons, boundingBox: BoundingBox.fromPoints(polygons.flat()) };
  }

  /**
   * Resolve each character to a glyph VectorPath through the
   * FontProviderRegistry and translate its contours to the correct pen
   * position, honoring letter spacing between characters.
   *
   * @param {ReturnType<typeof normalizeTextParams>} options
   * @returns {Promise<{contours: import('../text/VectorPath.js').Contour[], totalAdvanceWidthMm: number}>}
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

    return { contours, totalAdvanceWidthMm: penXMm };
  }

  /**
   * Generate a StoneLayout for a circle or rectangle shape layer.
   *
   * Reuses the same contour-flattening and outline/fill sampling primitives as
   * generateTextLayout(), via the neutral shape helpers in src/text/VectorPath.js, so text and
   * shapes share one Geometry Engine and one StoneLayout/Stone product (see
   * docs/ARCHITECTURE.md's single-source-of-truth principle).
   *
   * @param {object} params
   * @param {'circle'|'rectangle'} params.shape
   * @param {string} params.layerId
   * @param {number} params.stoneSizeMm
   * @param {number} [params.gapMm]
   * @param {'outline'|'fill'} [params.mode]
   * @param {string} [params.color]
   * @param {number} [params.cxMm] Circle center X, required when shape is 'circle'.
   * @param {number} [params.cyMm] Circle center Y, required when shape is 'circle'.
   * @param {number} [params.radiusMm] Circle radius, required when shape is 'circle'.
   * @param {number} [params.xMm] Rectangle top-left X, required when shape is 'rectangle'.
   * @param {number} [params.yMm] Rectangle top-left Y, required when shape is 'rectangle'.
   * @param {number} [params.widthMm] Rectangle width, required when shape is 'rectangle'.
   * @param {number} [params.heightMm] Rectangle height, required when shape is 'rectangle'.
   * @returns {StoneLayout}
   */
  generateShapeLayout(params = {}) {
    const options = normalizeShapeParams(params);
    const { polygons } = this._shapePolygons(options);
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
   * Resolve a circle/rectangle shape's flattened polygon contours in absolute millimeters, without
   * sampling stones. RS-1012: the shared "get this shape's vector outline" entry point Vector
   * Boolean Operations use to build a boolean input source (see src/geometry/PathBoolean.js) --
   * calls the exact same `_shapePolygons()` helper generateShapeLayout() uses, so a shape's boolean
   * outline and its stone-sampled outline are always the same geometry.
   *
   * @param {object} params Same shape as generateShapeLayout()'s params, minus stoneSizeMm/gapMm/mode/color.
   * @returns {{polygons: import('../text/VectorPath.js').Point2D[][], boundingBox: BoundingBox|null}}
   */
  resolveShapePolygons(params = {}) {
    const options = normalizeShapeParams({ ...params, stoneSizeMm: 1, mode: DEFAULT_MODE });
    return this._shapePolygons(options);
  }

  _shapePolygons(options) {
    const path = options.shape === 'circle'
      ? createCircleVectorPath({ cxMm: options.cxMm, cyMm: options.cyMm, radiusMm: options.radiusMm, id: options.layerId })
      : createRectangleVectorPath({ xMm: options.xMm, yMm: options.yMm, widthMm: options.widthMm, heightMm: options.heightMm, id: options.layerId });

    const polygons = path.contours.map((contour) => flattenContourToPolygon(contour));
    return { polygons, boundingBox: BoundingBox.fromPoints(polygons.flat()) };
  }

  /**
   * Generate a StoneLayout for an SVG layer, parsing `svgSource` via src/svg (the vector path
   * extraction module for SVG, the counterpart to src/text's font glyph extraction) and reusing
   * the same contour-flattening and outline/fill sampling primitives as
   * generateTextLayout()/generateShapeLayout().
   *
   * The SVG's own natural bounding box (top-left corner at its own origin, per src/svg's viewBox
   * normalization) is mapped independently in X and Y onto the requested
   * {xMm,yMm,widthMm,heightMm} placement box — the same "place at x,y with an explicit width/
   * height" model generateShapeLayout()'s rectangle already uses. Closed contours participate in
   * `fill`-mode even-odd sampling (combined across the whole document, matching how
   * generateTextLayout() combines all of one text run's character contours for fill mode) and in
   * per-contour closed-outline sampling; open contours (an SVG <line>/<polyline> or an unclosed
   * <path> subpath) are always outline-sampled as an open polyline, regardless of `mode` — an open
   * path has no interior to fill.
   *
   * @param {object} params
   * @param {string} params.svgSource Raw SVG document text.
   * @param {string} params.layerId
   * @param {number} [params.xMm] Placement top-left X, default 0.
   * @param {number} [params.yMm] Placement top-left Y, default 0.
   * @param {number} [params.widthMm] Target placed width; defaults to the SVG's natural width.
   * @param {number} [params.heightMm] Target placed height; defaults to the SVG's natural height.
   * @param {number} params.stoneSizeMm
   * @param {number} [params.gapMm]
   * @param {'outline'|'fill'} [params.mode]
   * @param {string} [params.color]
   * @returns {StoneLayout}
   */
  generateSvgLayout(params = {}) {
    const options = normalizeSvgParams(params);
    const { closedPolygons, openPolygons } = this._svgPolygons(options);

    const spacingMm = options.stoneSizeMm + options.gapMm;
    const points = [];

    // Appended one-by-one (not `points.push(...bigArray)`): spreading a very large sample array
    // as call arguments overflows the JS call stack, which is reachable here (unlike
    // generateShapeLayout()/generateTextLayout()'s flatMap-based accumulation) because an SVG
    // layer's placement box can scale a document to an arbitrarily large physical size.
    if (options.mode === 'fill') {
      for (const point of sampleFillPoints(closedPolygons, BoundingBox.fromPoints(closedPolygons.flat()), spacingMm)) {
        points.push(point);
      }
    } else {
      for (const polygon of closedPolygons) {
        for (const point of sampleOutlinePoints(polygon, spacingMm, { closed: true })) points.push(point);
      }
    }
    for (const polygon of openPolygons) {
      for (const point of sampleOutlinePoints(polygon, spacingMm, { closed: false })) points.push(point);
    }

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
   * Resolve an SVG document's closed-contour polygons (flattened and placed, in absolute
   * millimeters), without sampling stones. RS-1012: the shared "get this SVG's fillable vector
   * outline" entry point Vector Boolean Operations use to build a boolean input source (see
   * src/geometry/PathBoolean.js) — calls the exact same `_svgPolygons()` helper generateSvgLayout()
   * uses. Only closed contours are returned: an open contour (an SVG `<line>`/`<polyline>` or an
   * unclosed `<path>` subpath) has no interior and cannot participate in a boolean operation.
   *
   * @param {object} params Same shape as generateSvgLayout()'s params, minus stoneSizeMm/gapMm/mode/color.
   * @returns {{polygons: import('../text/VectorPath.js').Point2D[][], boundingBox: BoundingBox|null}}
   */
  resolveSvgPolygons(params = {}) {
    const options = normalizeSvgParams({ ...params, stoneSizeMm: 1, mode: DEFAULT_MODE });
    const { closedPolygons } = this._svgPolygons(options);
    return { polygons: closedPolygons, boundingBox: BoundingBox.fromPoints(closedPolygons.flat()) };
  }

  _svgPolygons(options) {
    const parsed = parseSvgDocument(options.svgSource);

    const targetWidthMm = options.widthMm ?? parsed.naturalWidthMm;
    const targetHeightMm = options.heightMm ?? parsed.naturalHeightMm;
    const scaleX = targetWidthMm / parsed.naturalWidthMm;
    const scaleY = targetHeightMm / parsed.naturalHeightMm;

    const closedPolygons = [];
    const openPolygons = [];
    for (const { contour, closed } of parsed.shapes) {
      const placed = flattenContourToPolygon(contour).map((point) => new Point2D(
        options.xMm + point.xMm * scaleX,
        options.yMm + point.yMm * scaleY
      ));
      (closed ? closedPolygons : openPolygons).push(placed);
    }

    return { closedPolygons, openPolygons };
  }

  /**
   * Generate a StoneLayout for an image (bitmap trace) layer, processing `imageBuffer` via
   * src/image (the raster path-extraction module for bitmap art, the counterpart to src/svg's
   * vector path extraction) and reusing the same "normalize params -> sample points -> Stone[] ->
   * StoneLayout" shape generateSvgLayout()/generateShapeLayout() use.
   *
   * RS-1008A: this method (and sampleFieldFillPoints() in StoneSampler.js) replace the earlier
   * RS-1008 design, which had src/image/** construct Stone/StoneLayout directly — a second,
   * independent stone-generating implementation the architecture correction in
   * docs/specifications/RS-1008A-ImageTraceArchitectureCorrection.md removed. src/image/**'s
   * prepareImageField() runs the bitmap-processing pipeline (grayscale -> threshold -> optional
   * invert -> optional blur -> optional resize) and returns a neutral density field; this method is
   * the only caller that turns that field into stones, exactly as it is the only caller of
   * parseSvgDocument() for SVG layers.
   *
   * @param {object} params
   * @param {{widthPx: number, heightPx: number, data: Uint8ClampedArray}} params.imageBuffer RGBA source pixels.
   * @param {string} params.layerId
   * @param {number} [params.xMm] Placement top-left X, default 0.
   * @param {number} [params.yMm] Placement top-left Y, default 0.
   * @param {number} params.widthMm Placement width.
   * @param {number} params.heightMm Placement height.
   * @param {number} params.stoneSizeMm
   * @param {number} [params.gapMm]
   * @param {string} [params.color]
   * @param {number} [params.threshold] 0-255, default 128.
   * @param {boolean} [params.invert]
   * @param {number} [params.blurRadiusPx]
   * @param {number} params.maxWidthPx
   * @param {number} params.maxHeightPx
   * @returns {StoneLayout}
   */
  generateImageLayout(params = {}) {
    const options = normalizeImageParams(params);

    const field = prepareImageField(options.imageBuffer, {
      threshold: options.threshold,
      invert: options.invert,
      blurRadiusPx: options.blurRadiusPx,
      maxWidthPx: options.maxWidthPx,
      maxHeightPx: options.maxHeightPx
    });

    const spacingMm = options.stoneSizeMm + options.gapMm;
    const points = sampleFieldFillPoints(
      field,
      { xMm: options.xMm, yMm: options.yMm, widthMm: options.widthMm, heightMm: options.heightMm },
      spacingMm
    );

    const stones = points.map((point, index) => new Stone({
      xMm: point.xMm,
      yMm: point.yMm,
      sizeMm: options.stoneSizeMm,
      color: options.color,
      layerId: options.layerId,
      index
    }));

    return new StoneLayout({ layerId: options.layerId, sourceMode: 'fill', stones });
  }

  /**
   * Generate a StoneLayout for a 'path' layer — a generic compound vector shape defined directly by
   * millimeter contours (RS-1012: the layer type a Union/Subtract/Intersect/Exclude Boolean
   * Operation produces — see src/geometry/PathBoolean.js — but usable for any pre-flattened contour
   * list). Reuses the exact "place a natural-size shape into an xMm/yMm/widthMm/heightMm box, then
   * outline/fill-sample it" shape generateSvgLayout() already uses: `contours` must already be
   * normalized so its own bounding box's top-left corner sits at (0,0) (RS-1012's boolean-op
   * layer-creation code in app.js normalizes its result this way before storing it, exactly like
   * src/svg's viewBox normalization already guarantees for generateSvgLayout()'s input); the
   * caller's widthMm/heightMm (default: that natural bounding box's own size, i.e. no scaling) is
   * then mapped onto it independently in X and Y, identically to every other placed shape in this
   * engine.
   *
   * @param {object} params
   * @param {{xMm:number,yMm:number}[][]} params.contours Pre-flattened, (0,0)-rooted contours (2+ points each).
   * @param {string} params.layerId
   * @param {number} [params.xMm] Placement top-left X, default 0.
   * @param {number} [params.yMm] Placement top-left Y, default 0.
   * @param {number} [params.widthMm] Target placed width; defaults to the contours' own natural width.
   * @param {number} [params.heightMm] Target placed height; defaults to the contours' own natural height.
   * @param {number} params.stoneSizeMm
   * @param {number} [params.gapMm]
   * @param {'outline'|'fill'} [params.mode]
   * @param {string} [params.color]
   * @returns {StoneLayout}
   */
  generatePathLayout(params = {}) {
    const options = normalizePathParams(params);
    const { polygons, boundingBox } = this._pathPolygons(options);

    if (!boundingBox) {
      return new StoneLayout({ layerId: options.layerId, sourceMode: options.mode, stones: [] });
    }

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
   * Resolve a 'path' layer's flattened polygon contours in absolute millimeters, without sampling
   * stones — RS-1012's boolean-input entry point for chaining a *previous* boolean result into
   * another Boolean Operation, mirroring resolveShapePolygons()/resolveSvgPolygons()/resolveTextPolygons().
   *
   * @param {object} params Same shape as generatePathLayout()'s params, minus stoneSizeMm/gapMm/mode/color.
   * @returns {{polygons: import('../text/VectorPath.js').Point2D[][], boundingBox: BoundingBox|null}}
   */
  resolvePathPolygons(params = {}) {
    const options = normalizePathParams({ ...params, stoneSizeMm: 1, mode: DEFAULT_MODE });
    return this._pathPolygons(options);
  }

  _pathPolygons(options) {
    const naturalPoints = options.contours.flat();
    const naturalBox = BoundingBox.fromPoints(naturalPoints.map((point) => new Point2D(point.xMm, point.yMm)));
    if (!naturalBox) {
      return { polygons: [], boundingBox: null };
    }

    const targetWidthMm = options.widthMm ?? naturalBox.widthMm;
    const targetHeightMm = options.heightMm ?? naturalBox.heightMm;
    const scaleX = naturalBox.widthMm > 0 ? targetWidthMm / naturalBox.widthMm : 1;
    const scaleY = naturalBox.heightMm > 0 ? targetHeightMm / naturalBox.heightMm : 1;

    const polygons = options.contours.map((contour) => contour.map((point) => new Point2D(
      options.xMm + point.xMm * scaleX,
      options.yMm + point.yMm * scaleY
    )));

    return { polygons, boundingBox: BoundingBox.fromPoints(polygons.flat()) };
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
  if (!SAMPLE_MODES.has(mode)) {
    throw new TypeError(`Unsupported geometry mode: ${mode}. Expected one of: ${[...SAMPLE_MODES].join(', ')}`);
  }

  if (params.color !== undefined && params.color !== null &&
    (typeof params.color !== 'string' || params.color.length === 0)) {
    throw new TypeError('GeometryEngine.generateTextLayout color must be a non-empty string when provided.');
  }

  const curveEnabled = Boolean(params.curveEnabled);
  const curve = curveEnabled ? normalizeCurveParams(params) : {
    curveRadiusMm: null,
    curveDirection: null,
    curveStartAngleDeg: null,
    curveSweepAngleDeg: null,
    curveAlignment: null
  };

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
    providerId: params.providerId ?? null,
    curveEnabled,
    ...curve
  };
}

// RS-1003: validated only when curveEnabled is truthy, so straight text (the default) never reads
// or validates these fields — a hard requirement for "straight text unchanged".
function normalizeCurveParams(params) {
  const curveRadiusMm = assertPositiveNumber(params.curveRadiusMm, 'curveRadiusMm');

  const curveSweepAngleDeg = assertFiniteNumber(params.curveSweepAngleDeg, 'curveSweepAngleDeg');
  if (curveSweepAngleDeg === 0) {
    throw new RangeError('curveSweepAngleDeg must not be zero.');
  }

  const curveStartAngleDeg = assertFiniteNumber(params.curveStartAngleDeg ?? 0, 'curveStartAngleDeg');

  const curveDirection = params.curveDirection ?? 'outside';
  if (!CURVE_DIRECTIONS.has(curveDirection)) {
    throw new TypeError(`curveDirection must be one of: ${[...CURVE_DIRECTIONS].join(', ')}`);
  }

  const curveAlignment = params.curveAlignment ?? 'center';
  if (!CURVE_ALIGNMENTS.has(curveAlignment)) {
    throw new TypeError(`curveAlignment must be one of: ${[...CURVE_ALIGNMENTS].join(', ')}`);
  }

  return { curveRadiusMm, curveDirection, curveStartAngleDeg, curveSweepAngleDeg, curveAlignment };
}

function normalizeShapeParams(params) {
  if (typeof params.shape !== 'string' || !SHAPE_TYPES.has(params.shape)) {
    throw new TypeError(`GeometryEngine.generateShapeLayout requires shape to be one of: ${[...SHAPE_TYPES].join(', ')}.`);
  }
  if (typeof params.layerId !== 'string' || params.layerId.length === 0) {
    throw new TypeError('GeometryEngine.generateShapeLayout requires a non-empty layerId.');
  }

  const stoneSizeMm = assertPositiveNumber(params.stoneSizeMm, 'stoneSizeMm');

  const gapMm = assertFiniteNumber(params.gapMm ?? 0, 'gapMm');
  if (gapMm < 0) {
    throw new RangeError('gapMm must be zero or positive.');
  }

  const mode = params.mode ?? DEFAULT_MODE;
  if (!SAMPLE_MODES.has(mode)) {
    throw new TypeError(`Unsupported geometry mode: ${mode}. Expected one of: ${[...SAMPLE_MODES].join(', ')}`);
  }

  if (params.color !== undefined && params.color !== null &&
    (typeof params.color !== 'string' || params.color.length === 0)) {
    throw new TypeError('GeometryEngine.generateShapeLayout color must be a non-empty string when provided.');
  }

  const base = {
    shape: params.shape,
    layerId: params.layerId,
    stoneSizeMm,
    gapMm,
    mode,
    color: params.color ?? null
  };

  if (params.shape === 'circle') {
    return {
      ...base,
      cxMm: assertFiniteNumber(params.cxMm, 'cxMm'),
      cyMm: assertFiniteNumber(params.cyMm, 'cyMm'),
      radiusMm: assertPositiveNumber(params.radiusMm, 'radiusMm')
    };
  }

  return {
    ...base,
    xMm: assertFiniteNumber(params.xMm, 'xMm'),
    yMm: assertFiniteNumber(params.yMm, 'yMm'),
    widthMm: assertPositiveNumber(params.widthMm, 'widthMm'),
    heightMm: assertPositiveNumber(params.heightMm, 'heightMm')
  };
}

function normalizeSvgParams(params) {
  if (typeof params.svgSource !== 'string' || params.svgSource.trim().length === 0) {
    throw new TypeError('GeometryEngine.generateSvgLayout requires a non-empty svgSource string.');
  }
  if (typeof params.layerId !== 'string' || params.layerId.length === 0) {
    throw new TypeError('GeometryEngine.generateSvgLayout requires a non-empty layerId.');
  }

  const stoneSizeMm = assertPositiveNumber(params.stoneSizeMm, 'stoneSizeMm');

  const gapMm = assertFiniteNumber(params.gapMm ?? 0, 'gapMm');
  if (gapMm < 0) {
    throw new RangeError('gapMm must be zero or positive.');
  }

  const mode = params.mode ?? DEFAULT_MODE;
  if (!SAMPLE_MODES.has(mode)) {
    throw new TypeError(`Unsupported geometry mode: ${mode}. Expected one of: ${[...SAMPLE_MODES].join(', ')}`);
  }

  if (params.color !== undefined && params.color !== null &&
    (typeof params.color !== 'string' || params.color.length === 0)) {
    throw new TypeError('GeometryEngine.generateSvgLayout color must be a non-empty string when provided.');
  }

  const xMm = assertFiniteNumber(params.xMm ?? 0, 'xMm');
  const yMm = assertFiniteNumber(params.yMm ?? 0, 'yMm');

  const widthMm = params.widthMm === undefined || params.widthMm === null
    ? null
    : assertPositiveNumber(params.widthMm, 'widthMm');
  const heightMm = params.heightMm === undefined || params.heightMm === null
    ? null
    : assertPositiveNumber(params.heightMm, 'heightMm');

  return {
    svgSource: params.svgSource,
    layerId: params.layerId,
    xMm,
    yMm,
    widthMm,
    heightMm,
    stoneSizeMm,
    gapMm,
    mode,
    color: params.color ?? null
  };
}

// RS-1008A: threshold/invert/blurRadiusPx/maxWidthPx/maxHeightPx are validated once, inside
// prepareImageField() (src/image/ImageFieldPipeline.js) -- not duplicated here. This function only
// validates the geometry-side params (placement, stone size/gap/color, layerId, the imageBuffer
// shape), mirroring how normalizeSvgParams() above validates only its own geometry-side params and
// leaves svgSource's own validation to parseSvgDocument().
function normalizeImageParams(params) {
  if (!params.imageBuffer || typeof params.imageBuffer.widthPx !== 'number' || typeof params.imageBuffer.heightPx !== 'number') {
    throw new TypeError('GeometryEngine.generateImageLayout requires an imageBuffer with numeric widthPx/heightPx.');
  }
  if (typeof params.layerId !== 'string' || params.layerId.length === 0) {
    throw new TypeError('GeometryEngine.generateImageLayout requires a non-empty layerId.');
  }

  const stoneSizeMm = assertPositiveNumber(params.stoneSizeMm, 'stoneSizeMm');

  const gapMm = assertFiniteNumber(params.gapMm ?? 0, 'gapMm');
  if (gapMm < 0) {
    throw new RangeError('gapMm must be zero or positive.');
  }

  if (params.color !== undefined && params.color !== null &&
    (typeof params.color !== 'string' || params.color.length === 0)) {
    throw new TypeError('GeometryEngine.generateImageLayout color must be a non-empty string when provided.');
  }

  const xMm = assertFiniteNumber(params.xMm ?? 0, 'xMm');
  const yMm = assertFiniteNumber(params.yMm ?? 0, 'yMm');
  const widthMm = assertPositiveNumber(params.widthMm, 'widthMm');
  const heightMm = assertPositiveNumber(params.heightMm, 'heightMm');

  return {
    imageBuffer: params.imageBuffer,
    layerId: params.layerId,
    xMm,
    yMm,
    widthMm,
    heightMm,
    stoneSizeMm,
    gapMm,
    color: params.color ?? null,
    threshold: params.threshold,
    invert: params.invert,
    blurRadiusPx: params.blurRadiusPx,
    maxWidthPx: params.maxWidthPx,
    maxHeightPx: params.maxHeightPx
  };
}

// RS-1012: contours/xMm/yMm/widthMm/heightMm are this method's own geometry-side params;
// stoneSizeMm/gapMm/mode/color validation below mirrors normalizeSvgParams()'s exactly (same
// "placed shape" param shape), following this file's existing per-type-normalizer convention.
function normalizePathParams(params) {
  if (!Array.isArray(params.contours) || params.contours.length === 0) {
    throw new TypeError('GeometryEngine.generatePathLayout requires a non-empty contours array.');
  }
  for (const contour of params.contours) {
    if (!Array.isArray(contour) || contour.length < 3) {
      throw new TypeError('GeometryEngine.generatePathLayout requires every contour to have at least 3 points.');
    }
  }
  if (typeof params.layerId !== 'string' || params.layerId.length === 0) {
    throw new TypeError('GeometryEngine.generatePathLayout requires a non-empty layerId.');
  }

  const stoneSizeMm = assertPositiveNumber(params.stoneSizeMm, 'stoneSizeMm');

  const gapMm = assertFiniteNumber(params.gapMm ?? 0, 'gapMm');
  if (gapMm < 0) {
    throw new RangeError('gapMm must be zero or positive.');
  }

  const mode = params.mode ?? DEFAULT_MODE;
  if (!SAMPLE_MODES.has(mode)) {
    throw new TypeError(`Unsupported geometry mode: ${mode}. Expected one of: ${[...SAMPLE_MODES].join(', ')}`);
  }

  if (params.color !== undefined && params.color !== null &&
    (typeof params.color !== 'string' || params.color.length === 0)) {
    throw new TypeError('GeometryEngine.generatePathLayout color must be a non-empty string when provided.');
  }

  const xMm = assertFiniteNumber(params.xMm ?? 0, 'xMm');
  const yMm = assertFiniteNumber(params.yMm ?? 0, 'yMm');
  const widthMm = params.widthMm === undefined || params.widthMm === null
    ? null
    : assertPositiveNumber(params.widthMm, 'widthMm');
  const heightMm = params.heightMm === undefined || params.heightMm === null
    ? null
    : assertPositiveNumber(params.heightMm, 'heightMm');

  return {
    contours: params.contours,
    layerId: params.layerId,
    xMm,
    yMm,
    widthMm,
    heightMm,
    stoneSizeMm,
    gapMm,
    mode,
    color: params.color ?? null
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
