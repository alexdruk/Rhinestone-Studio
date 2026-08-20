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
import { flattenContourToPolygon, flattenContourToPolygonWithCornerFlags, translateContour, detectPolygonCornerFlags } from './ContourGeometry.js';
import { sampleOutlinePoints, sampleMultiContourOutlinePoints, sampleShapeFillPoints, sampleFieldByMode, isPointInsidePolygons } from './StoneSampler.js';
import { Stone } from './Stone.js';
import { StoneLayout } from './StoneLayout.js';
import { parseSvgDocument } from '../svg/index.js';
import { prepareImageField } from '../image/index.js';
import { CURVE_ALIGNMENTS, CURVE_DIRECTIONS, projectPolygonToArc } from './ArcProjection.js';
// S-110: Expanded Shape Library. createShapeNaturalContours() (src/geometry/ShapeLibrary.js) is the
// only place that knows the *math* for Ellipse/Capsule/Regular Polygon/Star/Heart/Arrow/Cross/
// Crescent/Ring -- it returns plain natural, (0,0)-rooted contours, never stones. This module is
// the only caller that turns those contours into stones, via the exact same "place natural
// contours into an xMm/yMm/widthMm/heightMm box" mechanism generatePathLayout()/_pathPolygons()
// already uses for Boolean Operation results (see _placeNaturalContours() below) -- so the new
// shapes are not a second shape system, just nine more natural-contour sources feeding the one
// existing placement + sampling pipeline circle/rectangle/path already share.
import { SHAPE_LIBRARY_KINDS, createShapeNaturalContours } from './ShapeLibrary.js';
// S-200 (Mixed Stone-Size Layouts): normalizeMixedSizeParams()/generateMixedSizeInfillPoints()/
// generateMixedSizeInfillStones() are the only S-200 entry points this module calls -- see
// MixedSizeGenerator.js's own doc comment for why the algorithm itself lives there, not here.
import { normalizeMixedSizeParams, generateMixedSizeInfillPoints, generateMixedSizeInfillStones } from './MixedSizeGenerator.js';

// RS-1011: 'fill' is unchanged in meaning/output from before this milestone (a regular grid --
// "Grid Fill" is only a clearer UI label for the same stored value); staggered/radial/contour are
// new. See docs/specifications/RS-1011-FillAlgorithms.md.
const SAMPLE_MODES = new Set(['outline', 'fill', 'staggered', 'radial', 'contour']);
// RS-1011: Image Trace has no vector perimeter to walk, so 'outline' is never valid for it -- see
// normalizeImageParams() below and generateImageLayout()'s doc comment.
const IMAGE_SAMPLE_MODES = new Set(['fill', 'staggered', 'radial', 'contour']);
const DEFAULT_MODE = 'outline';
// S-110: SHAPE_LIBRARY_KINDS (Ellipse/Capsule/Regular Polygon/Star/Heart/Arrow/Cross/Crescent/Ring)
// join Circle/Rectangle here -- every one of them is a generateShapeLayout()/resolveShapePolygons()
// shape, not a new engine method.
const SHAPE_TYPES = new Set(['circle', 'rectangle', ...SHAPE_LIBRARY_KINDS]);
// Corner-anchored per-side Outline spacing (StoneSampler.js's sampleCornerAnchoredOutlinePoints()):
// safe only for shape kinds where every contour vertex is confirmed to be a genuine corner with no
// smooth-curve tessellation in between -- Rect (flattenContourToPolygonWithCornerFlags() recovers
// real moveTo/lineTo corner data) and these four ShapeLibrary kinds (every point is trivially a
// real vertex by construction, per a prior diagnosis). Circle/Ellipse/Ring/Heart/Capsule/Slot have
// no usable corners and Crescent/Pen-drawn polygons are separate, deferred future work -- none of
// those kinds appear here, so they keep the existing whole-loop uniform walk unchanged.
const CORNER_ANCHORED_SHAPE_LIBRARY_KINDS = new Set(['polygon', 'star', 'arrow', 'cross']);

// TXT-102: paragraph-style alignment of each line within its own multi-line text block. 'left'
// (default) reproduces every pre-TXT-102 layout exactly (each line already starts its own pen walk
// at local x=0, so no offset is ever applied for it -- see textAlignOffsetMm() below).
const TEXT_ALIGNMENTS = new Set(['left', 'center', 'right']);
// TXT-102: default single-line-spacing baseline pitch, as a multiple of the layer's own heightMm --
// chosen so adjacent lines clear ascenders/descenders for ordinary text without the operator having
// to touch the Line Spacing control. Not derived from font-specific ascender/descender metrics
// because GeometryEngine only ever resolves one character's metrics at a time (see
// _buildLineContours() below) and a line's own characters may have no ascender/descender at all --
// a single fixed ratio is simpler, deterministic, and font-agnostic. Line Spacing (options.lineSpacing,
// default 1) scales this multiplicatively.
const TEXT_LINE_HEIGHT_RATIO = 1.4;

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
   * @param {'left'|'center'|'right'} [params.align] TXT-102: per-line paragraph alignment within a
   *   multi-line text block, default 'left'. No effect on single-line text (see
   *   textAlignOffsetMm()).
   * @param {number} [params.lineSpacing] TXT-102: multiplier applied to the default single-spacing
   *   line pitch (TEXT_LINE_HEIGHT_RATIO * heightMm), default 1. No effect on single-line text.
   * @param {number} [params.rotationDeg] TXT-102: whole-block rotation in degrees, clockwise,
   *   applied last, around the text block's own (pre-rotation) bounding-box center. Default 0 (no
   *   rotation, byte-identical to before this milestone). Normalized into [0, 360).
   * @param {number} [params.authoredScale] MONO-005A: persistent, project-schema counterpart of
   *   scaleAuthoredTextLayout() (MONO-002) -- a position-only scale applied to authored (stone-
   *   center) fonts only, via that exact method (see below). Default 1 (byte-identical to before
   *   this milestone). Has no effect on sampled/OpenType text -- those fonts have no authored
   *   branch for it to apply to. Throws (does not silently clamp) if illegal for this layout, e.g.
   *   below scaleAuthoredTextLayout()'s own minimum legal scale.
   * @returns {Promise<StoneLayout>}
   */
  async generateTextLayout(params = {}) {
    if (!this._fontProviderRegistry) {
      throw new TypeError('GeometryEngine.generateTextLayout requires a fontProviderRegistry (none was supplied to the constructor).');
    }
    const options = normalizeTextParams(params);
    const { polygons, boundingBox, authoredStones } = await this._textPolygons(options);

    let stones;
    let sourceMode;

    if (authoredStones.length > 0) {
      // A font supplied explicit stone centers for at least one character (see
      // FontProviderResult.stoneCenters) instead of ordinary glyph contours. These are already
      // final millimeter positions -- converted straight into Stone objects, the same product
      // every other layer type produces, with no contour flattening or StoneSampler involved.
      // 'outline'/'fill' has no meaning for authored positions, so options.mode is intentionally
      // never read here; sourceMode is recorded as 'authored' so downstream consumers (and this
      // family's descriptor.fillModeIndependent metadata) can tell the stored fill-mode setting was
      // not applied.
      if (options.curveEnabled) {
        throw new Error('GeometryEngine.generateTextLayout: curved text is not supported for fonts that supply authored stone centers.');
      }
      let authoredResultStones = authoredStones.map((point, index) => new Stone({
        xMm: point.xMm,
        yMm: point.yMm,
        sizeMm: options.stoneSizeMm,
        color: options.color,
        layerId: options.layerId,
        index
      }));

      // MONO-005A: authoredScale is the persistent, project-schema counterpart of
      // scaleAuthoredTextLayout() (MONO-002) -- applied here, in the one place every caller (live
      // text-layer rendering via app.js, and any programmatic caller such as MonogramGenerator)
      // shares, rather than as a second, external scaling step a caller could forget to apply.
      // Reuses that exact method, not a re-derived transform, so the pivot/legality math is
      // identical regardless of caller. Applied before rotation below: scaling and rotation around
      // the same shared bounding-box-center pivot commute exactly (see rotateTextPoints()'s own doc
      // comment for that pivot convention), so the order is not observable, but is fixed here as
      // the one canonical order. Skipped entirely for the default authoredScale === 1 (the common
      // case, and every pre-MONO-005A caller), so output is byte-identical to before this milestone
      // whenever authoredScale is absent or 1.
      if (options.authoredScale !== 1) {
        const rawLayout = new StoneLayout({ layerId: options.layerId, sourceMode: 'authored', stones: authoredResultStones });
        const scaleResult = this.scaleAuthoredTextLayout(rawLayout, options.authoredScale);
        if (!scaleResult.ok) {
          // Never silently accepted or clamped -- an illegal persisted authoredScale (e.g. below
          // scaleAuthoredTextLayout()'s own minimum legal scale) is a hard, descriptive error,
          // exactly like this method's other combination-based failures (e.g. curveEnabled above).
          throw new Error(`GeometryEngine.generateTextLayout: authoredScale ${options.authoredScale} is invalid for this text (${scaleResult.reason}): ${scaleResult.message}`);
        }
        authoredResultStones = scaleResult.layout.stones;
      }

      const rotatedAuthoredStones = rotateTextPoints(authoredResultStones, options.rotationDeg);
      stones = rotatedAuthoredStones.map((point) => new Stone({
        xMm: point.xMm,
        yMm: point.yMm,
        sizeMm: point.sizeMm,
        color: point.color,
        layerId: point.layerId,
        index: point.index,
        metadata: point.metadata
      }));
      sourceMode = 'authored';
    } else {
      const spacingMm = options.stoneSizeMm + options.gapMm;
      const sampledPoints = sampleShapeFillPoints(options.mode, polygons, boundingBox, spacingMm, options.stoneSizeMm)
        .map((point) => ({ xMm: point.xMm, yMm: point.yMm, sizeMm: options.stoneSizeMm }));

      // S-200 (Mixed Stone-Size Layouts): infill candidates are sampled from the same pre-rotation
      // polygons/boundingBox as the primary points. The pivot for rotation is deliberately computed
      // from `sampledPoints` (primary only), not the combined primary+infill set: infill legitimately
      // reaches closer to the shape's true boundary than the primary pitch does, which can shift a
      // combined-set bounding-box center slightly -- pivoting on primary alone guarantees primary
      // stones rotate to the exact same positions Uniform mode alone would produce, regardless of
      // whether/how much infill is added, while infill points still rotate around that identical
      // pivot (rotatePointsAroundCenter() is given one explicit center for the whole combined list),
      // so they never misalign from their primary counterparts either. Falls back to the combined
      // set's own center only in the edge case where the primary pass produced zero stones but a
      // smaller eligible size still fits (nothing to preserve a "primary invariant" for in that case).
      const infillPoints = options.mixedOptions
        ? generateMixedSizeInfillPoints({
            mode: options.mode,
            source: { kind: 'vector', polygons, boundingBox },
            mixedOptions: options.mixedOptions,
            gapMm: options.gapMm,
            baseStones: sampledPoints
          })
        : [];

      const combinedPoints = sampledPoints.concat(infillPoints);
      const pivot = boundingBoxCenterOfPoints(sampledPoints) ?? boundingBoxCenterOfPoints(combinedPoints);
      const points = rotatePointsAroundCenter(combinedPoints, options.rotationDeg, pivot);
      stones = points.map((point, index) => new Stone({
        xMm: point.xMm,
        yMm: point.yMm,
        sizeMm: point.sizeMm,
        color: options.color,
        layerId: options.layerId,
        index
      }));
      sourceMode = options.mode;
    }

    return new StoneLayout({ layerId: options.layerId, sourceMode, stones });
  }

  /**
   * MONO-002: scale an already-generated authored-font StoneLayout's stone *positions* by
   * `requestedScale`, around the layout's own bounding-box center -- the same pivot convention
   * rotateTextPoints() already established for text rotation (see above). This is foundational
   * engine work for a future Monogram Generator: it never manufactures a non-catalog stone
   * diameter, never generates text, and adds no UI/monogram concepts of its own.
   *
   * Every stone's sizeMm, color, layerId, and metadata are carried through unchanged; only xMm/yMm
   * move. Requires a StoneLayout with sourceMode === 'authored' -- the exact, reliable marker
   * generateTextLayout() stamps only on its authored-stone-center branch (see above; every other
   * producer sets sourceMode to a rendering-mode string such as 'outline'/'fill'/'staggered'/
   * 'radial'/'contour', never 'authored'). A layout with any other sourceMode is rejected with a
   * structured NOT_AUTHORED_SOURCE failure rather than silently scaled -- this transform's legality
   * math (AUTHORED_FONT_FITTING_GAP_MM, minimumLegalScale) is specifically calibrated to authored
   * fonts' fixed PITCH_MM pitch and is not meant as a generic position-scaling utility for sampled
   * layouts.
   *
   * @param {StoneLayout} layout
   * @param {number} requestedScale Must be finite and positive. 1 reproduces the input unchanged.
   *   Values above 1 enlarge; values below 1 shrink and are rejected once they would bring stone
   *   centers closer together than production allows (see minimumLegalScale below).
   * @returns {{
   *   ok: boolean,
   *   reason?: string,
   *   message?: string,
   *   layout?: StoneLayout,
   *   requestedScale: number|null,
   *   minimumLegalScale: number|null,
   *   naturalMinimumSpacingMm: number|null,
   *   requiredSpacingMm: number|null,
   *   originalBoundingBox: object|null,
   *   scaledBoundingBox: object|null
   * }}
   */
  scaleAuthoredTextLayout(layout, requestedScale) {
    const requestedScaleForResult = typeof requestedScale === 'number' ? requestedScale : null;

    if (!(layout instanceof StoneLayout) || layout.stones.length === 0) {
      return {
        ok: false,
        reason: TEXT_SCALE_FAILURE_REASONS.INVALID_LAYOUT,
        message: 'scaleAuthoredTextLayout requires a non-empty StoneLayout.',
        requestedScale: requestedScaleForResult,
        minimumLegalScale: null,
        naturalMinimumSpacingMm: null,
        requiredSpacingMm: null,
        originalBoundingBox: null,
        scaledBoundingBox: null
      };
    }

    const originalBoundingBox = layout.getBoundingBox();

    // generateTextLayout() stamps sourceMode 'authored' only on its authored-stone-center branch
    // (see above) -- every other producer uses a rendering-mode string ('outline'/'fill'/'staggered'/
    // 'radial'/'contour'), never 'authored'. That makes sourceMode a reliable, existing provenance
    // marker: no need to guess from font id, spacing, or stone count.
    if (layout.sourceMode !== 'authored') {
      return {
        ok: false,
        reason: TEXT_SCALE_FAILURE_REASONS.NOT_AUTHORED_SOURCE,
        message: `scaleAuthoredTextLayout requires a StoneLayout with sourceMode 'authored' (got ${JSON.stringify(layout.sourceMode)}).`,
        requestedScale: requestedScaleForResult,
        minimumLegalScale: null,
        naturalMinimumSpacingMm: null,
        requiredSpacingMm: null,
        originalBoundingBox: originalBoundingBox?.toJSON() ?? null,
        scaledBoundingBox: null
      };
    }

    if (typeof requestedScale !== 'number' || !Number.isFinite(requestedScale) || requestedScale <= 0) {
      return {
        ok: false,
        reason: TEXT_SCALE_FAILURE_REASONS.INVALID_SCALE,
        message: 'requestedScale must be a finite, positive number.',
        requestedScale: requestedScaleForResult,
        minimumLegalScale: null,
        naturalMinimumSpacingMm: null,
        requiredSpacingMm: null,
        originalBoundingBox: originalBoundingBox?.toJSON() ?? null,
        scaledBoundingBox: null
      };
    }

    // Every authored-font Stone is stamped with the layer's one stoneSizeMm (see the authored
    // branch of generateTextLayout() above) -- this transform never resizes stones, so that one
    // shared value is both "current stone size" and the basis for requiredSpacingMm below.
    const stoneSizeMm = layout.stones[0].sizeMm;
    const requiredSpacingMm = stoneSizeMm + AUTHORED_FONT_FITTING_GAP_MM;
    const naturalMinimumSpacingMm = measureNaturalMinimumCenterDistanceMm(layout.stones);

    // Fewer than two stones (or, degenerately, every stone at one position) means there is no
    // pairwise spacing constraint to violate -- any positive finite scale is legal.
    if (naturalMinimumSpacingMm === null) {
      return this._buildScaledTextLayoutResult(layout, requestedScale, {
        minimumLegalScale: 0,
        naturalMinimumSpacingMm: null,
        requiredSpacingMm,
        originalBoundingBox
      });
    }

    if (naturalMinimumSpacingMm <= 0) {
      // Two or more stones sit at the exact same position already -- scaling positions around a
      // pivot can never separate two coincident points (their distance stays 0 at every scale), so
      // no requested scale can ever legalize this layout. Distinct from BELOW_MINIMUM_SCALE below,
      // which always has a finite legal answer; this one does not.
      return {
        ok: false,
        reason: TEXT_SCALE_FAILURE_REASONS.NATURAL_SPACING_VIOLATED,
        message: 'The source layout has coincident stone centers; no scale can produce legal spacing.',
        requestedScale: requestedScaleForResult,
        minimumLegalScale: null,
        naturalMinimumSpacingMm,
        requiredSpacingMm,
        originalBoundingBox: originalBoundingBox?.toJSON() ?? null,
        scaledBoundingBox: null
      };
    }

    // The natural (unscaled) layout's tightest center-to-center spacing scales linearly with
    // requestedScale, so the scale at which it exactly equals requiredSpacingMm is this ratio --
    // requesting less than it is guaranteed to bring some pair of stone centers closer together
    // than requiredSpacingMm allows.
    const minimumLegalScale = requiredSpacingMm / naturalMinimumSpacingMm;

    // requiredSpacingMm and naturalMinimumSpacingMm are independently accumulated floating-point
    // sums/sqrt results (see measureNaturalMinimumCenterDistanceMm above), so a layout that is
    // mathematically exactly at its floor -- e.g. an authored font at its native catalog stone size,
    // where requiredSpacingMm and the authored PITCH_MM coincide by construction (MONO-001A) -- can
    // land a hair on either side of 1.0 (observed: 1.0000000000000018). Without tolerance, that noise
    // would spuriously reject the identity scale on exactly the fonts/sizes this milestone must keep
    // working. RELATIVE_SCALE_EPSILON is many orders of magnitude tighter than any real fitting
    // decision (0.1 scale steps at minimum), so it only absorbs float noise, never a genuine shortfall.
    if (requestedScale < minimumLegalScale - RELATIVE_SCALE_EPSILON) {
      // Reject outright rather than silently clamping up to minimumLegalScale -- a caller that asked
      // for a specific fit must be told it does not fit, not be handed a different, larger result
      // that quietly ignores what was requested.
      return {
        ok: false,
        reason: TEXT_SCALE_FAILURE_REASONS.BELOW_MINIMUM_SCALE,
        message: `Requested scale ${requestedScale} is below the minimum legal scale ${minimumLegalScale} required to keep ${requiredSpacingMm}mm of center-to-center clearance.`,
        requestedScale: requestedScaleForResult,
        minimumLegalScale,
        naturalMinimumSpacingMm,
        requiredSpacingMm,
        originalBoundingBox: originalBoundingBox?.toJSON() ?? null,
        scaledBoundingBox: null
      };
    }

    return this._buildScaledTextLayoutResult(layout, requestedScale, {
      minimumLegalScale,
      naturalMinimumSpacingMm,
      requiredSpacingMm,
      originalBoundingBox
    });
  }

  // Applies requestedScale to every stone center around the layout's own bounding-box center (via
  // the exact same boundingBoxCenterOfPoints()/pivot math rotateTextPoints() uses for rotation), and
  // packages the successful, structured scaleAuthoredTextLayout() result. sizeMm/color/layerId/
  // metadata are copied through unchanged on every Stone; only xMm/yMm are recomputed.
  _buildScaledTextLayoutResult(layout, requestedScale, measurements) {
    const pivot = boundingBoxCenterOfPoints(layout.stones);
    const scaledStones = layout.stones.map((stone) => new Stone({
      xMm: pivot.cxMm + (stone.xMm - pivot.cxMm) * requestedScale,
      yMm: pivot.cyMm + (stone.yMm - pivot.cyMm) * requestedScale,
      sizeMm: stone.sizeMm,
      color: stone.color,
      layerId: stone.layerId,
      index: stone.index,
      metadata: stone.metadata
    }));
    const scaledLayout = new StoneLayout({ layerId: layout.layerId, sourceMode: layout.sourceMode, stones: scaledStones });

    return {
      ok: true,
      layout: scaledLayout,
      requestedScale,
      minimumLegalScale: measurements.minimumLegalScale,
      naturalMinimumSpacingMm: measurements.naturalMinimumSpacingMm,
      requiredSpacingMm: measurements.requiredSpacingMm,
      originalBoundingBox: measurements.originalBoundingBox?.toJSON() ?? null,
      scaledBoundingBox: scaledLayout.getBoundingBox()?.toJSON() ?? null
    };
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
   * TXT-102: multi-line layout and per-line alignment ARE reflected here (both resolved inside the
   * shared _textPolygons()/_buildPositionedContours() this method calls). params.rotationDeg is NOT
   * applied here -- rotation is a final Stone-position transform generateTextLayout() applies after
   * sampling (see rotateTextPoints()), so a Boolean Operation built from a rotated text layer's
   * outline reflects that layer's un-rotated shape. Out of scope for this milestone; revisit if
   * Boolean Operations need to compose with rotated text.
   *
   * @param {object} params Same shape as generateTextLayout()'s params, minus stoneSizeMm/gapMm/mode/color.
   * @returns {Promise<{polygons: import('../text/VectorPath.js').Point2D[][], boundingBox: BoundingBox|null}>}
   */
  async resolveTextPolygons(params = {}) {
    if (!this._fontProviderRegistry) {
      throw new TypeError('GeometryEngine.resolveTextPolygons requires a fontProviderRegistry (none was supplied to the constructor).');
    }
    const options = normalizeTextParams({ ...params, stoneSizeMm: 1, mode: DEFAULT_MODE });
    const { polygons, boundingBox, authoredStones } = await this._textPolygons(options);
    if (authoredStones.length > 0) {
      // A font that supplies authored stone centers has no vector outline for a Boolean Operation
      // (see src/geometry/PathBoolean.js) to consume -- fail explicitly rather than silently
      // returning an empty/wrong result.
      throw new Error('GeometryEngine.resolveTextPolygons: this font supplies authored stone centers, not a vector outline, and cannot be used as a Boolean Operation input.');
    }
    return { polygons, boundingBox };
  }

  async _textPolygons(options) {
    const { contours, authoredStones, totalAdvanceWidthMm } = await this._buildPositionedContours(options);
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

    return { polygons, boundingBox: BoundingBox.fromPoints(polygons.flat()), authoredStones };
  }

  /**
   * TXT-102: splits options.text on '\n' (preserving empty lines -- an empty line still occupies a
   * line-height slot, it just contributes no contours/stones) and lays each line out independently
   * via _buildLineContours(), then stacks the lines vertically (line index 0 first, at the original
   * y=0 baseline -- unchanged from before this milestone) and applies per-line horizontal alignment
   * so each line's own width is measured against the widest line. Single-line text (the overwhelming
   * common case, and every project saved before this milestone) has exactly one line, whose own
   * width always equals maxWidthMm, so textAlignOffsetMm() always returns 0 for it regardless of
   * options.align, and the single line's y-offset is always 0 -- byte-identical output to before.
   *
   * @param {ReturnType<typeof normalizeTextParams>} options
   * @returns {Promise<{contours: import('../text/VectorPath.js').Contour[], authoredStones: {xMm:number,yMm:number}[], totalAdvanceWidthMm: number}>}
   */
  async _buildPositionedContours(options) {
    const lines = options.text.split('\n');
    const lineHeightMm = options.heightMm * TEXT_LINE_HEIGHT_RATIO * options.lineSpacing;

    const lineResults = [];
    for (const lineText of lines) {
      lineResults.push(await this._buildLineContours(lineText, options));
    }

    const maxWidthMm = lineResults.reduce((max, line) => Math.max(max, line.widthMm), 0);

    const contours = [];
    const authoredStones = [];
    for (let lineIndex = 0; lineIndex < lineResults.length; lineIndex++) {
      const { contours: lineContours, authoredStones: lineStones, widthMm } = lineResults[lineIndex];
      const xOffsetMm = textAlignOffsetMm(options.align, maxWidthMm, widthMm);
      const yOffsetMm = lineIndex * lineHeightMm;

      for (const contour of lineContours) {
        contours.push(translateContour(contour, xOffsetMm, yOffsetMm));
      }
      for (const stone of lineStones) {
        authoredStones.push({ xMm: stone.xMm + xOffsetMm, yMm: stone.yMm + yOffsetMm });
      }
    }

    return { contours, authoredStones, totalAdvanceWidthMm: maxWidthMm };
  }

  /**
   * Resolve one line's worth of characters to glyph VectorPaths through the FontProviderRegistry and
   * translate their contours to the correct pen position, honoring letter spacing/kerning between
   * characters. Pre-TXT-102 single-line behavior, extracted unchanged so _buildPositionedContours()
   * above can call it once per line -- a line's own pen position always starts at local x=0,
   * matching this method's pre-extraction behavior exactly.
   *
   * @param {string} lineText
   * @param {ReturnType<typeof normalizeTextParams>} options
   * @returns {Promise<{contours: import('../text/VectorPath.js').Contour[], authoredStones: {xMm:number,yMm:number}[], widthMm: number}>}
   */
  async _buildLineContours(lineText, options) {
    const characters = Array.from(lineText);
    const contours = [];
    const authoredStones = [];
    let penXMm = 0;

    for (let i = 0; i < characters.length; i++) {
      // Optional per-provider kerning hook (TXT-101B) -- applied here, between two separate
      // single-character getTextPath() calls, because this loop is the only place in the whole
      // engine that ever walks a text run's pen position character by character (see
      // FontProviderRegistry.getKerningAdjustmentMm()'s module doc). A registry without this method
      // (most test fakes across the codebase construct a minimal {getTextPath} object) is treated
      // exactly like a provider with no kerning: 0 adjustment, byte-identical to before this existed.
      if (i > 0 && typeof this._fontProviderRegistry.getKerningAdjustmentMm === 'function') {
        penXMm += this._fontProviderRegistry.getKerningAdjustmentMm({
          providerId: options.providerId ?? undefined,
          fontId: options.fontId,
          prevChar: characters[i - 1],
          nextChar: characters[i]
        });
      }

      const result = await this._fontProviderRegistry.getTextPath({
        providerId: options.providerId ?? undefined,
        fontId: options.fontId,
        text: characters[i],
        heightMm: options.heightMm
      });

      for (const contour of result.path.contours) {
        contours.push(translateContour(contour, penXMm, 0));
      }

      // A font may return explicit stone centers instead of contours for a character (see
      // FontProviderResult.stoneCenters) -- translated by the running pen position exactly like
      // contours are above (X only, matching translateContour(contour, penXMm, 0)).
      if (Array.isArray(result.stoneCenters)) {
        for (const center of result.stoneCenters) {
          authoredStones.push({ xMm: center.xMm + penXMm, yMm: center.yMm });
        }
      }

      penXMm += result.metrics.advanceWidthMm;
      if (i < characters.length - 1) {
        penXMm += options.letterSpacingMm;
      }
    }

    return { contours, authoredStones, widthMm: penXMm };
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
    const { polygons, cornerFlagsByContour } = this._shapePolygons(options);
    const boundingBox = BoundingBox.fromPoints(polygons.flat());
    const spacingMm = options.stoneSizeMm + options.gapMm;

    // Layout-quality metrics (Prompt 3): outline-mode sample attrition, see StoneLayout's own
    // outlineStats doc comment. null for every other mode, so this is a no-op there.
    const outlineStats = options.mode === 'outline' ? { rawSampleCount: 0, keptCount: 0 } : null;
    const points = sampleShapeFillPoints(options.mode, polygons, boundingBox, spacingMm, options.stoneSizeMm, true, cornerFlagsByContour, outlineStats);

    let stones = points.map((point, index) => new Stone({
      xMm: point.xMm,
      yMm: point.yMm,
      sizeMm: options.stoneSizeMm,
      color: options.color,
      layerId: options.layerId,
      index
    }));

    // S-200 (Mixed Stone-Size Layouts): additive infill pass, see MixedSizeGenerator.js. No-op
    // (stones unchanged) when options.mixedOptions is null -- the default/Uniform case.
    if (options.mixedOptions) {
      const infillStones = generateMixedSizeInfillStones({
        mode: options.mode,
        source: { kind: 'vector', polygons, boundingBox },
        mixedOptions: options.mixedOptions,
        gapMm: options.gapMm,
        baseStones: stones,
        layerId: options.layerId,
        color: options.color,
        startIndex: stones.length
      });
      stones = stones.concat(infillStones);
    }

    return new StoneLayout({ layerId: options.layerId, sourceMode: options.mode, stones, outlineStats });
  }

  /**
   * Resolve a circle/rectangle shape's flattened polygon contours in absolute millimeters, without
   * sampling stones. RS-1012: the shared "get this shape's vector outline" entry point Vector
   * Boolean Operations use to build a boolean input source (see src/geometry/PathBoolean.js) --
   * calls the exact same `_shapePolygons()` helper generateShapeLayout() uses, so a shape's boolean
   * outline and its stone-sampled outline are always the same geometry.
   *
   * @param {object} params Same shape as generateShapeLayout()'s params, minus stoneSizeMm/gapMm/mode/color.
   * @returns {{polygons: import('../text/VectorPath.js').Point2D[][], boundingBox: BoundingBox|null, cornerFlagsByContour: (boolean[]|null)[]|null}}
   */
  resolveShapePolygons(params = {}) {
    const options = normalizeShapeParams({ ...params, stoneSizeMm: 1, mode: DEFAULT_MODE });
    return this._shapePolygons(options);
  }

  _shapePolygons(options) {
    if (options.shape === 'circle' || options.shape === 'rectangle') {
      const path = options.shape === 'circle'
        ? createCircleVectorPath({ cxMm: options.cxMm, cyMm: options.cyMm, radiusMm: options.radiusMm, id: options.layerId })
        : createRectangleVectorPath({ xMm: options.xMm, yMm: options.yMm, widthMm: options.widthMm, heightMm: options.heightMm, id: options.layerId });

      // Rect's own contour is built from moveTo/lineTo only (see createRectangleVectorPath()) --
      // every flattened point is a genuine corner -- so it's the one circle/rectangle case that
      // feeds corner-anchored Outline spacing (see CORNER_ANCHORED_SHAPE_LIBRARY_KINDS above).
      // Circle has no usable corners and keeps flattenContourToPolygon()'s plain, unaffected path.
      if (options.shape === 'rectangle') {
        const flattened = path.contours.map((contour) => flattenContourToPolygonWithCornerFlags(contour));
        const polygons = flattened.map((f) => f.points);
        const cornerFlagsByContour = flattened.map((f) => f.cornerFlags);
        return { polygons, boundingBox: BoundingBox.fromPoints(polygons.flat()), cornerFlagsByContour };
      }

      const polygons = path.contours.map((contour) => flattenContourToPolygon(contour));
      return { polygons, boundingBox: BoundingBox.fromPoints(polygons.flat()), cornerFlagsByContour: null };
    }

    // S-110: every other shape kind (Ellipse/Capsule/Regular Polygon/Star/Heart/Arrow/Cross/
    // Crescent/Ring) is a natural, (0,0)-rooted contour set from ShapeLibrary.js, placed into this
    // layer's x/y/w/h box via the exact same mechanism _pathPolygons() uses for Boolean Operation
    // results -- see _placeNaturalContours() below.
    const naturalContours = createShapeNaturalContours(options.shape, options);
    const placed = this._placeNaturalContours(naturalContours, options.xMm, options.yMm, options.widthMm, options.heightMm);

    // ShapeLibrary.js stays a pure natural-coordinate generator with no downstream-concern coupling
    // -- corner tagging for its four known-safe kinds (every point is trivially a real vertex by
    // construction) is built here instead, never inside ShapeLibrary.js itself.
    if (!placed.boundingBox || !CORNER_ANCHORED_SHAPE_LIBRARY_KINDS.has(options.shape)) {
      return { ...placed, cornerFlagsByContour: null };
    }
    const cornerFlagsByContour = placed.polygons.map((polygon) => Array(polygon.length).fill(true));
    return { ...placed, cornerFlagsByContour };
  }

  /**
   * Scales a set of natural, (0,0)-rooted contours independently in X and Y so their own bounding
   * box lands exactly on the given widthMm/heightMm (defaulting to the natural box's own size when
   * omitted), then translates the result so that box's top-left corner sits at (xMm, yMm). This is
   * the one placement primitive every "place a natural-size shape into a box" layer kind shares --
   * originally generatePathLayout()'s (Boolean Operation results), now reused by _shapePolygons()
   * for every S-110 shape kind too, so this math is written exactly once.
   *
   * @param {{xMm:number,yMm:number}[][]} contours
   * @param {number} xMm
   * @param {number} yMm
   * @param {number|null} widthMm
   * @param {number|null} heightMm
   * @param {{minXmm:number,minYmm:number,maxXmm:number,maxYmm:number}} [naturalBoundingBoxMm]
   *   RS-3014 Step 3: forwarded straight through to computeNaturalContourTransform() -- see that
   *   function's own doc comment. undefined for every caller but _pathPolygons() (the only 'path'-
   *   layer-specific caller of this shared helper), a safe no-op there exactly like every other
   *   omitted-optional-param call site.
   * @returns {{polygons: import('../text/VectorPath.js').Point2D[][], boundingBox: BoundingBox|null}}
   */
  _placeNaturalContours(contours, xMm, yMm, widthMm, heightMm, naturalBoundingBoxMm) {
    const transform = computeNaturalContourTransform(contours, xMm, yMm, widthMm, heightMm, naturalBoundingBoxMm);
    if (!transform) {
      return { polygons: [], boundingBox: null };
    }

    const polygons = contours.map((contour) => applyNaturalContourTransform(contour, transform));
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

    // Layout-quality metrics (Prompt 3): outline-mode sample attrition, see StoneLayout's own
    // outlineStats doc comment. Accumulated across the closed-contour pass below AND every open
    // contour's own pass (an SVG document can mix both) -- null, and never touched, for every other
    // mode, so this is a no-op there.
    const outlineStats = options.mode === 'outline' ? { rawSampleCount: 0, keptCount: 0 } : null;

    // Appended one-by-one (not `points.push(...bigArray)`): spreading a very large sample array
    // as call arguments overflows the JS call stack, which is reachable here (unlike
    // generateShapeLayout()/generateTextLayout()'s flatMap-based accumulation) because an SVG
    // layer's placement box can scale a document to an arbitrarily large physical size.
    if (options.mode === 'outline') {
      // RC-002: sampleMultiContourOutlinePoints() (not a plain per-polygon loop) so an SVG document
      // with nested closed paths (e.g. a donut shape) never produces overlapping stones where two
      // different contours pass closer together than one stone pitch -- see that function's doc
      // comment. Still appended one-by-one, not spread, for the same large-point-set stack-safety
      // reason as before.
      const closedStats = { rawSampleCount: 0, keptCount: 0 };
      for (const point of sampleMultiContourOutlinePoints(closedPolygons, spacingMm, { closed: true, minSeparationMm: options.stoneSizeMm }, closedStats)) points.push(point);
      outlineStats.rawSampleCount += closedStats.rawSampleCount;
      outlineStats.keptCount += closedStats.keptCount;
    } else {
      for (const point of sampleShapeFillPoints(options.mode, closedPolygons, BoundingBox.fromPoints(closedPolygons.flat()), spacingMm)) {
        points.push(point);
      }
    }
    // RC-004A: each open polygon (an SVG <line>/<polyline> or an unclosed <path> subpath) is run
    // through sampleMultiContourOutlinePoints() -- as its own single-contour array -- so a tight
    // loop or doubled-back stroke within that one open contour gets the same same-contour
    // self-overlap guard closed contours get above. A lone contour never triggers that function's
    // cross-contour branch, so this is a pure self-check; open polygons are still never compared
    // against each other, matching this function's pre-existing (out of RC-004A's scope) behavior.
    for (const polygon of openPolygons) {
      const openStats = outlineStats ? { rawSampleCount: 0, keptCount: 0 } : null;
      for (const point of sampleMultiContourOutlinePoints([polygon], spacingMm, { closed: false, minSeparationMm: options.stoneSizeMm }, openStats)) points.push(point);
      if (outlineStats) {
        outlineStats.rawSampleCount += openStats.rawSampleCount;
        outlineStats.keptCount += openStats.keptCount;
      }
    }

    let stones = points.map((point, index) => new Stone({
      xMm: point.xMm,
      yMm: point.yMm,
      sizeMm: options.stoneSizeMm,
      color: options.color,
      layerId: options.layerId,
      index
    }));

    // S-200 (Mixed Stone-Size Layouts): infill samples closed contours only -- an open contour (an
    // SVG <line>/<polyline> or an unclosed <path> subpath) has no interior to gap-fill and its
    // outline is already at full primary density (see docs/specifications/
    // S-200-MixedStoneSizeLayouts.md, "SVG layers specifically").
    if (options.mixedOptions) {
      const infillStones = generateMixedSizeInfillStones({
        mode: options.mode,
        source: { kind: 'vector', polygons: closedPolygons, boundingBox: BoundingBox.fromPoints(closedPolygons.flat()) },
        mixedOptions: options.mixedOptions,
        gapMm: options.gapMm,
        baseStones: stones,
        layerId: options.layerId,
        color: options.color,
        startIndex: stones.length
      });
      stones = stones.concat(infillStones);
    }

    return new StoneLayout({ layerId: options.layerId, sourceMode: options.mode, stones, outlineStats });
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
   * @param {'fill'|'staggered'|'radial'|'contour'} [params.mode] Default 'fill' -- a raster density
   *   field has no vector perimeter, so 'outline' is not supported (see RS-1011).
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

    const placement = { xMm: options.xMm, yMm: options.yMm, widthMm: options.widthMm, heightMm: options.heightMm };
    const spacingMm = options.stoneSizeMm + options.gapMm;
    const points = sampleFieldByMode(options.mode, field, placement, spacingMm);

    let stones = points.map((point, index) => new Stone({
      xMm: point.xMm,
      yMm: point.yMm,
      sizeMm: options.stoneSizeMm,
      color: options.color,
      layerId: options.layerId,
      index
    }));

    // S-200 (Mixed Stone-Size Layouts): additive infill pass over the same density field, see
    // MixedSizeGenerator.js.
    if (options.mixedOptions) {
      const infillStones = generateMixedSizeInfillStones({
        mode: options.mode,
        source: { kind: 'field', field, placement },
        mixedOptions: options.mixedOptions,
        gapMm: options.gapMm,
        baseStones: stones,
        layerId: options.layerId,
        color: options.color,
        startIndex: stones.length
      });
      stones = stones.concat(infillStones);
    }

    return new StoneLayout({ layerId: options.layerId, sourceMode: options.mode, stones });
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
   * @param {boolean} [params.closed] Whether `contours` form a closed loop (default true). Only
   *   `mode: 'outline'` reads this; a freehand-drawn shape that never looped back to its start
   *   passes `false` so it's outline-sampled as an open polyline instead of gaining a synthetic
   *   closing edge across its two real endpoints (RS-3011).
   * @returns {StoneLayout}
   */
  generatePathLayout(params = {}) {
    const options = normalizePathParams(params);
    const { polygons, boundingBox } = this._pathPolygons(options);

    if (!boundingBox) {
      return new StoneLayout({ layerId: options.layerId, sourceMode: options.mode, stones: [] });
    }

    const placedBoundingBox = BoundingBox.fromPoints(polygons.flat());
    const spacingMm = options.stoneSizeMm + options.gapMm;
    // Corner-anchored per-side Outline spacing for drawn 'path' layers (Rect/Polygon/Pen/Freehand
    // tools, Boolean-op results) -- the CORNER_ANCHORED_SHAPE_LIBRARY_KINDS mechanism above only
    // covers ShapeLibrary-generated kinds with known-safe-by-construction corners; drawn contours
    // reach here as plain flattened points with no such provenance, so detection happens on the
    // placed polygons instead (must be parallel to the exact vertex arrays being sampled below).
    // Scoped to closed Outline mode only -- fill/staggered/radial/contour ignore corner flags
    // entirely (see sampleShapeFillPoints()'s own doc comment) and an open path has no sides to
    // anchor between (RS-3011 endpoint anchoring is separate, deferred, future work).
    const cornerFlagsByContour = options.mode === 'outline' && options.closed
      ? polygons.map((polygon) => detectPolygonCornerFlags(polygon, { closed: true }))
      : null;
    // Layout-quality metrics (Prompt 3): outline-mode sample attrition, see StoneLayout's own
    // outlineStats doc comment. null for every other mode, so this is a no-op there.
    const outlineStats = options.mode === 'outline' ? { rawSampleCount: 0, keptCount: 0 } : null;
    const points = sampleShapeFillPoints(options.mode, polygons, placedBoundingBox, spacingMm, options.stoneSizeMm, options.closed, cornerFlagsByContour, outlineStats);

    let stones = points.map((point, index) => new Stone({
      xMm: point.xMm,
      yMm: point.yMm,
      sizeMm: options.stoneSizeMm,
      color: options.color,
      layerId: options.layerId,
      index
    }));

    // S-200 (Mixed Stone-Size Layouts): additive infill pass, see MixedSizeGenerator.js.
    if (options.mixedOptions) {
      const infillStones = generateMixedSizeInfillStones({
        mode: options.mode,
        source: { kind: 'vector', polygons, boundingBox: placedBoundingBox },
        mixedOptions: options.mixedOptions,
        gapMm: options.gapMm,
        baseStones: stones,
        layerId: options.layerId,
        color: options.color,
        startIndex: stones.length
      });
      stones = stones.concat(infillStones);
    }

    // RS-3011 Step 10a (Paint regions) / Step 12 (Stamp) / Step 13 (Eraser): all three need the
    // same natural-space -> absolute-space transform options.contours was itself placed through
    // (not a fresh one derived from each region's/stamp's/daub's own, usually-smaller, extent) --
    // see computeNaturalContourTransform's own doc comment for why that distinction matters.
    // Computed once, shared by every branch below.
    if (options.regions.length > 0 || options.stampedStones.length > 0 || options.eraseDaubs.length > 0 || options.erasedGridPositions.length > 0) {
      const transform = computeNaturalContourTransform(options.contours, options.xMm, options.yMm, options.widthMm, options.heightMm, options.naturalBoundingBoxMm);
      // RS-3011 Step 10a: additive, priority-ordered sub-areas that carve their own patch out of the
      // fill computed above. No-op when `regions` is empty/absent -- every layer predating this step
      // -- so this branch never changes existing output. See _applyPathRegions()'s own doc comment.
      if (options.regions.length > 0) {
        stones = this._applyPathRegions(stones, options, transform, polygons);
      }
      // Bugfix (permanent dead zone): `erasedGridPositions` is the persistent-snapshot replacement
      // for eraseDaubs' own live radius test (see that field's own doc comment below for why the two
      // now coexist) -- applied here, strictly BEFORE stampedStones are appended, so it only ever
      // suppresses base-fill/region-patch stones, never a Stamp/Trace placement (those have their own
      // independent identity and are removed, if erased, directly from stampedStones itself by the
      // caller instead). Each entry is a snapshotted stone position, not a brush touch -- point-radius
      // matching against ERASED_POSITION_EPSILON_MM (a tolerance for transform round-trip float noise
      // only, several orders of magnitude below any real stone pitch) rather than eraseDaubs' own
      // brush-sized radiusMm. A daub's/entry's xMm/yMm is natural-space, same convention as
      // stampedStones/eraseDaubs above, so it needs the same applyNaturalContourTransform() conversion
      // before comparing against `stones`' own absolute coordinates. A null transform (empty contours)
      // leaves erasedGridPositions unable to suppress anything, same as regions/stampedStones above.
      // Re-indexes survivors afterward, the same convention eraseDaubs' own final `.map()` below uses.
      if (options.erasedGridPositions.length > 0 && transform) {
        const placedErasedPositions = options.erasedGridPositions.map((pos) => {
          const [placed] = applyNaturalContourTransform([{ xMm: pos.xMm, yMm: pos.yMm }], transform);
          return placed;
        });
        const survivors = stones.filter((stone) => !placedErasedPositions.some((pos) => {
          const dx = stone.xMm - pos.xMm;
          const dy = stone.yMm - pos.yMm;
          return dx * dx + dy * dy <= ERASED_POSITION_EPSILON_MM * ERASED_POSITION_EPSILON_MM;
        }));
        stones = survivors.map((stone, index) => new Stone({
          xMm: stone.xMm,
          yMm: stone.yMm,
          sizeMm: stone.sizeMm,
          color: stone.color,
          layerId: stone.layerId,
          index
        }));
      }
      // RS-3011 Step 12 (Stamp): one manually-placed Stone per stampedStones entry, appended
      // directly on top of everything computed above -- no interior-point test, no masking of nearby
      // stones, unlike regions above (a stamp is a decoration, not a fill patch; drawleather's own
      // StampTool.ts doesn't suppress/dedupe against underlying decorations either). `transform` is
      // the same placement transform every other Stone on this layer went through, so a stamp tracks
      // its parent shape's move/resize for free, exactly like a region's own contour does. A null
      // transform (empty contours) leaves stampedStones un-placeable, same as regions above.
      if (options.stampedStones.length > 0 && transform) {
        const stampedStoneObjects = options.stampedStones.map((stamp, index) => {
          const [placed] = applyNaturalContourTransform([{ xMm: stamp.xMm, yMm: stamp.yMm }], transform);
          return new Stone({
            xMm: placed.xMm,
            yMm: placed.yMm,
            sizeMm: stamp.sizeMm,
            color: stamp.color,
            layerId: options.layerId,
            index: stones.length + index
          });
        });
        stones = stones.concat(stampedStoneObjects);
      }
      // RS-3011 Step 13 (Eraser): brush-style removal, applied LAST -- strictly after base fill +
      // regions + stampedStones (+ erasedGridPositions above) are all combined into one list, so a
      // daub drops a Stone regardless of which source produced it, stampedStones included. A daub is
      // a point + radius, not a contour (no polygon/boolean geometry involved) -- drops any Stone
      // whose center falls within radiusMm of ANY daub. Like a stamp's own xMm/yMm above, a daub's
      // xMm/yMm is stored in the SAME (0,0)-rooted natural-space convention, so it needs the identical
      // applyNaturalContourTransform() conversion before comparing against `stones`' own absolute
      // coordinates -- radiusMm itself is deliberately left untransformed (a fixed physical brush
      // size, exactly like a stamp's own sizeMm doesn't scale with the parent shape either). A null
      // transform (empty contours) leaves eraseDaubs unable to erase anything, same as
      // stampedStones above. No-op when eraseDaubs is empty, matching regions/stampedStones' own
      // "absent field -> unchanged output" convention. Re-indexes survivors afterward, the same
      // convention _applyPathRegions()'s own final `.map((stone,index)=>...)` already uses.
      // Bugfix (permanent dead zone): this is now a LEGACY path only -- kept running, unmodified, so
      // a project saved before this fix keeps behaving byte-for-byte the same (a live radius test that
      // also masks future Stamp/Trace placements, exactly as it always has). A NEW Stones-mode erase
      // never appends to eraseDaubs anymore (see onEraseSweep()'s own doc comment in app.js); it only
      // grows erasedGridPositions/splices stampedStones above. The two mechanisms are independent and
      // additive -- either dropping a given Stone is enough -- so an old project with existing
      // eraseDaubs and a brand-new erasedGridPositions-based erase on the same layer coexist correctly
      // with no special-case code.
      if (options.eraseDaubs.length > 0 && transform) {
        const placedDaubs = options.eraseDaubs.map((daub) => {
          const [placed] = applyNaturalContourTransform([{ xMm: daub.xMm, yMm: daub.yMm }], transform);
          return { xMm: placed.xMm, yMm: placed.yMm, radiusMm: daub.radiusMm };
        });
        const survivors = stones.filter((stone) => !placedDaubs.some((daub) => {
          const dx = stone.xMm - daub.xMm;
          const dy = stone.yMm - daub.yMm;
          return dx * dx + dy * dy <= daub.radiusMm * daub.radiusMm;
        }));
        stones = survivors.map((stone, index) => new Stone({
          xMm: stone.xMm,
          yMm: stone.yMm,
          sizeMm: stone.sizeMm,
          color: stone.color,
          layerId: stone.layerId,
          index
        }));
      }
    }

    return new StoneLayout({ layerId: options.layerId, sourceMode: options.mode, stones, outlineStats });
  }

  /**
   * RS-3011 Step 10a: applies a 'path' layer's `regions` (Paint) on top of its already-generated
   * `baseStones`. Each region, in array order, wins over everything computed before it -- the base
   * fill AND every earlier region -- for its own footprint: any already-computed point that falls
   * inside the region's own contour is dropped, then the region generates its own fill within that
   * same contour using its own stoneSizeMm/gapMm/color/fillMode. `contour` is placed through the
   * exact same (0,0)-rooted natural-space transform (`_placeNaturalContours()`) the layer's own
   * `contours` field already uses, so a region tracks its parent shape's move/resize for free.
   * Interior testing reuses `isPointInsidePolygons()` -- the same StoneSampler.js primitive
   * MixedSizeGenerator.js's own infill pass relies on (via sampleShapeFillPoints()) -- rather than
   * reimplementing point-in-polygon logic here. A region's own candidate points are then rejected
   * if they land physically too close to anything already placed (survivors or an earlier region),
   * so a region's independently-pitched grid never overlaps a stone just outside its own contour
   * boundary.
   *
   * A region's own contour is fixed at paint-time and never re-validated afterward -- normally safe,
   * since a region's polygon is always a subset of the shape's interior by construction. Outline-mode
   * Eraser (RS-3014 Step 3) is the first thing that can shrink the shape's own placed base-contour
   * AFTER a region already exists, with nothing else re-checking the region against it -- without
   * `shapePolygons`, a region would keep filling a footprint that's since been cut away. Candidate
   * points are additionally rejected if they fall outside `shapePolygons`, so a region's fill always
   * tracks its parent shape's CURRENT contour, not just the contour at paint-time.
   *
   * @param {Stone[]} baseStones
   * @param {ReturnType<typeof normalizePathParams>} options
   * @param {{xMm:number,yMm:number,scaleX:number,scaleY:number}|null} transform The SAME transform
   *   the layer's own `contours` were placed through (see computeNaturalContourTransform()) --
   *   never an independently-derived one, or a region smaller than the shape's own natural box
   *   would be scaled wrong relative to it.
   * @param {import('../text/VectorPath.js').Point2D[][]} shapePolygons The shape's own current
   *   placed base-contour polygons (generatePathLayout()'s own `polygons`, computed before the
   *   regions/stamps/daubs branch runs) -- used to drop any region candidate point that no longer
   *   falls inside the shape, e.g. after an Outline-mode Eraser cut.
   * @returns {Stone[]}
   */
  _applyPathRegions(baseStones, options, transform, shapePolygons) {
    if (!transform) {
      return baseStones;
    }

    let survivors = baseStones;
    const regionStoneGroups = [];

    for (const region of options.regions) {
      const regionPolygons = [applyNaturalContourTransform(region.contour, transform)];
      const regionBoundingBox = BoundingBox.fromPoints(regionPolygons.flat());

      if (!regionBoundingBox) {
        continue;
      }

      const insideRegion = (stone) => isPointInsidePolygons(new Point2D(stone.xMm, stone.yMm), regionPolygons);
      survivors = survivors.filter((stone) => !insideRegion(stone));
      for (const group of regionStoneGroups) {
        group.stones = group.stones.filter((stone) => !insideRegion(stone));
      }

      const regionSpacingMm = region.stoneSizeMm + region.gapMm;
      const regionCandidatePoints = sampleShapeFillPoints(
        region.fillMode, regionPolygons, regionBoundingBox, regionSpacingMm, region.stoneSizeMm, options.closed
      ).filter((point) => isPointInsidePolygons(new Point2D(point.xMm, point.yMm), shapePolygons));
      // Contour exclusion above only guarantees a region's own candidates aren't *inside* whatever
      // it just claimed -- it says nothing about a candidate landing physically too close to a
      // surviving base/earlier-region stone just outside the boundary (independent grids, no shared
      // pitch). Rejects each candidate against the FIXED already-placed set only -- never against
      // other candidates from this same region, which are already guaranteed non-overlapping by
      // their own regular-grid construction (the same guarantee the base fill's own grid already
      // relies on); letting them block each other too would re-check pairs whose separation is
      // *exactly* their own threshold by construction ((s+s)/2+gapMm == s+gapMm == their own grid
      // pitch), a floating-point boundary that makes acceptance order/position-dependent for no
      // benefit.
      const alreadyPlaced = survivors.concat(...regionStoneGroups.map((group) => group.stones));
      const acceptedPoints = regionCandidatePoints.filter((point) => !alreadyPlaced.some((other) => {
        const dx = point.xMm - other.xMm;
        const dy = point.yMm - other.yMm;
        const minSeparationMm = (region.stoneSizeMm + other.sizeMm) / 2 + region.gapMm;
        return dx * dx + dy * dy < minSeparationMm * minSeparationMm;
      }));
      const regionStones = acceptedPoints.map((point) => new Stone({
        xMm: point.xMm,
        yMm: point.yMm,
        sizeMm: region.stoneSizeMm,
        color: region.color,
        layerId: options.layerId,
        index: 0 // reassigned below, once the final combined order is known
      }));

      regionStoneGroups.push({ stones: regionStones });
    }

    const combined = survivors.concat(...regionStoneGroups.map((group) => group.stones));
    return combined.map((stone, index) => new Stone({
      xMm: stone.xMm,
      yMm: stone.yMm,
      sizeMm: stone.sizeMm,
      color: stone.color,
      layerId: stone.layerId,
      index
    }));
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
    // S-110: delegates to the shared _placeNaturalContours() helper -- see its doc comment. Behavior
    // is unchanged; this is a pure extraction so Boolean Operation results and every S-110 shape
    // kind share one placement implementation instead of two copies of the same math.
    // RS-3014 Step 3: options.naturalBoundingBoxMm (a 'path'-layer-only field -- see
    // normalizePathParams()'s own doc comment -- undefined for every other shape kind's own
    // _shapePolygons() call to this same shared helper) keeps the BASE FILL sampled below anchored
    // to the shape's pre-cut extent too, not just regions/stampedStones/eraseDaubs (see the
    // generatePathLayout() call below): without this, an Outline-mode cut would leave the visible
    // outline correctly shrunk while the actual sampled fill stones stayed stretched to the
    // layer's unchanged widthMm/heightMm box -- stones rendering past the shape's own visible
    // boundary, a production-correctness defect (base fill IS the product), caught during this
    // step's own browser verification.
    return this._placeNaturalContours(options.contours, options.xMm, options.yMm, options.widthMm, options.heightMm, options.naturalBoundingBoxMm);
  }
}

/**
 * The scale-then-translate transform GeometryEngine._placeNaturalContours() derives from a shape's
 * own natural contours. A module-level export (not a private class method) since RS-3011 Step 10b
 * (Paint target selection) needs to invert this exact transform to convert an absolute-mm lasso
 * intersection back into a 'path' layer's own natural-space contour convention, from outside
 * GeometryEngine's own generation pipeline -- see PaintRegionSelection.js's
 * absolutePolygonsToNaturalSpace(). A region's bounding box is almost always smaller than the parent
 * shape's own natural box (that's the point of a sub-region), so recomputing scaleX/scaleY from the
 * region's own points instead of reusing this one would silently distort it relative to the shape it
 * is supposed to track -- the same reasoning applies to Step 10b's inverse use.
 *
 * RS-3014 Step 3 (Eraser outline-cut mode): a live 'path' layer's own `contours` can now be
 * mutated in place after commit (a boolean subtraction shrinking the shape). Recomputing the
 * natural box fresh from `contours` on every call is exactly what makes that safe UNTIL a cut
 * changes `contours`' own extent -- at that point every region/stamp/daub on the layer, even ones
 * nowhere near the cut, would silently rescale/reposition relative to the shape. The optional
 * `naturalBoundingBoxMm` param lets a caller freeze that box at the moment a layer first becomes
 * cuttable (see app.js's outline-cut handling) so later cuts no longer move it.
 *
 * @param {{minXmm:number,minYmm:number,maxXmm:number,maxYmm:number}|null} [naturalBoundingBoxMm]
 *   When present and valid, used in place of the live-recomputed box below. Absent/null/undefined
 *   (every existing call site, every layer predating this step) reproduces prior behavior exactly.
 * @returns {{xMm:number,yMm:number,scaleX:number,scaleY:number}|null} null when `contours` has no points.
 */
export function computeNaturalContourTransform(contours, xMm, yMm, widthMm, heightMm, naturalBoundingBoxMm) {
  let naturalBox;
  if (naturalBoundingBoxMm && Number.isFinite(naturalBoundingBoxMm.minXmm) &&
    Number.isFinite(naturalBoundingBoxMm.minYmm) && Number.isFinite(naturalBoundingBoxMm.maxXmm) &&
    Number.isFinite(naturalBoundingBoxMm.maxYmm)) {
    naturalBox = new BoundingBox(
      naturalBoundingBoxMm.minXmm, naturalBoundingBoxMm.minYmm,
      naturalBoundingBoxMm.maxXmm, naturalBoundingBoxMm.maxYmm
    );
  } else {
    const naturalPoints = contours.flat();
    naturalBox = BoundingBox.fromPoints(naturalPoints.map((p) => new Point2D(p.xMm, p.yMm)));
  }
  if (!naturalBox) {
    return null;
  }

  const targetWidthMm = widthMm ?? naturalBox.widthMm;
  const targetHeightMm = heightMm ?? naturalBox.heightMm;
  const scaleX = naturalBox.widthMm > 0 ? targetWidthMm / naturalBox.widthMm : 1;
  const scaleY = naturalBox.heightMm > 0 ? targetHeightMm / naturalBox.heightMm : 1;

  return { xMm, yMm, scaleX, scaleY };
}

export function applyNaturalContourTransform(contour, transform) {
  return contour.map((p) => new Point2D(
    transform.xMm + p.xMm * transform.scaleX,
    transform.yMm + p.yMm * transform.scaleY
  ));
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
  // TXT-102: curved text assumes a single baseline mapped onto one arc (see ArcProjection.js) --
  // mixing multiple lines onto one arc is a distinct feature this milestone does not implement, so
  // the combination fails explicitly here rather than silently curving only one line or producing
  // overlapping arcs, mirroring this file's existing "unsupported combination" pattern (see the
  // authored-stone-centers + curve rejection just above in generateTextLayout()).
  if (curveEnabled && params.text.includes('\n')) {
    throw new Error('GeometryEngine.generateTextLayout: curved text does not support multiple lines (curveEnabled requires single-line text).');
  }
  const curve = curveEnabled ? normalizeCurveParams(params) : {
    curveRadiusMm: null,
    curveDirection: null,
    curveStartAngleDeg: null,
    curveSweepAngleDeg: null,
    curveAlignment: null
  };

  const align = params.align ?? 'left';
  if (!TEXT_ALIGNMENTS.has(align)) {
    throw new TypeError(`align must be one of: ${[...TEXT_ALIGNMENTS].join(', ')}`);
  }

  const lineSpacing = assertPositiveNumber(params.lineSpacing ?? 1, 'lineSpacing');

  const rotationDeg = normalizeRotationDeg(assertFiniteNumber(params.rotationDeg ?? 0, 'rotationDeg'));

  // MONO-005A: validated unconditionally here (like every other param), regardless of whether this
  // call's font eventually turns out authored or sampled -- font resolution happens later, per
  // character, inside _buildLineContours() (async, provider-dependent), so it cannot gate validation
  // at this synchronous normalization step. Has no effect on the sampled branch of
  // generateTextLayout(), which never reads options.authoredScale.
  const authoredScale = assertPositiveNumber(params.authoredScale ?? 1, 'authoredScale');

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
    align,
    lineSpacing,
    rotationDeg,
    authoredScale,
    ...curve,
    // S-200: sizeMode/mixedOptions -- see normalizeMixedSizeParams()'s own doc comment.
    ...normalizeMixedSizeParams(params, stoneSizeMm)
  };
}

// TXT-102: normalizes any finite rotationDeg (including negative values or values >= 360, both
// reachable from a continuous rotation-handle drag or a freely-typed numeric input) into [0, 360).
function normalizeRotationDeg(value) {
  const normalized = value % 360;
  return normalized < 0 ? normalized + 360 : normalized;
}

// TXT-102: horizontal offset (mm) applied to one line of a multi-line text block so it reads as
// left/center/right-aligned relative to the block's widest line. Always 0 for a single-line block
// (maxWidthMm === widthMm regardless of align), which is what keeps single-line text byte-identical
// to before this milestone.
function textAlignOffsetMm(align, maxWidthMm, widthMm) {
  if (align === 'center') return (maxWidthMm - widthMm) / 2;
  if (align === 'right') return maxWidthMm - widthMm;
  return 0;
}

// S-200: extracted out of rotateTextPoints() below so a caller that needs one fixed pivot shared
// across two different point sets (generateTextLayout()'s primary + Mixed Stone-Size infill points,
// see its own comment) can compute that pivot once, from whichever point set it chooses, instead of
// always re-deriving it from the exact array being rotated. Returns null for an empty input -- there
// is no bounding box to speak of.
function boundingBoxCenterOfPoints(points) {
  if (points.length === 0) {
    return null;
  }
  let minXmm = Infinity, minYmm = Infinity, maxXmm = -Infinity, maxYmm = -Infinity;
  for (const point of points) {
    if (point.xMm < minXmm) minXmm = point.xMm;
    if (point.xMm > maxXmm) maxXmm = point.xMm;
    if (point.yMm < minYmm) minYmm = point.yMm;
    if (point.yMm > maxYmm) maxYmm = point.yMm;
  }
  return { cxMm: (minXmm + maxXmm) / 2, cyMm: (minYmm + maxYmm) / 2 };
}

// TXT-102: rigidly rotates a flat list of {xMm,yMm} points (final stone positions, sampled or
// authored) around an explicit pivot by rotationDeg (clockwise, since this engine's mm space is
// Y-down -- see CanvasRenderer2D.js/SvgExporter.js, which map yMm to pixel/page Y with no flip).
// Applied once, as the very last step before Stone construction in generateTextLayout() -- after
// outline/fill sampling or after authored stone centers are resolved -- so both a vector font's
// sampled points and a stone-map font's (RS Block) authored centers get identical rotation behavior
// without duplicating this math for each source. A 0 rotation, an empty point list, or a null center
// all return the input unchanged.
function rotatePointsAroundCenter(points, rotationDeg, center) {
  if (rotationDeg === 0 || points.length === 0 || !center) {
    return points;
  }

  const { cxMm, cyMm } = center;
  const radians = rotationDeg * (Math.PI / 180);
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);

  // S-200: spreads the input point first (`...point`) so any extra field it carries -- notably
  // Mixed Stone-Size infill points' own `sizeMm` -- survives rotation unchanged; only xMm/yMm are
  // ever recomputed here. Every pre-S-200 caller's points carry no extra fields, so this is a
  // behavior-preserving widening: output is identical to before for them.
  return points.map((point) => {
    const dxMm = point.xMm - cxMm;
    const dyMm = point.yMm - cyMm;
    return {
      ...point,
      xMm: cxMm + dxMm * cos - dyMm * sin,
      yMm: cyMm + dxMm * sin + dyMm * cos
    };
  });
}

// Pivoting on the point set's own center (rather than the pre-placement origin) keeps the text
// block rotating in place, matching a typical rotation-handle UX. A 0 rotation (the default)
// returns the input unchanged, so every project saved before this milestone renders byte-identical.
// generateTextLayout()'s non-authored branch does NOT use this directly for its combined
// primary+infill point list -- see its own comment for why it computes an explicit, primary-derived
// pivot via boundingBoxCenterOfPoints() + rotatePointsAroundCenter() instead.
function rotateTextPoints(points, rotationDeg) {
  return rotatePointsAroundCenter(points, rotationDeg, boundingBoxCenterOfPoints(points));
}

// MONO-002 (Authored Font Positional Scaling): reason codes scaleAuthoredTextLayout() returns on
// failure -- a future monogram-fitting caller (or UI) branches on these, not on message text.
export const TEXT_SCALE_FAILURE_REASONS = Object.freeze({
  INVALID_LAYOUT: 'invalid-layout',
  NOT_AUTHORED_SOURCE: 'not-authored-source',
  INVALID_SCALE: 'invalid-scale',
  BELOW_MINIMUM_SCALE: 'below-minimum-scale',
  NATURAL_SPACING_VIOLATED: 'natural-spacing-violated'
});

// MONO-002: authored-stone fonts (RS Block, RS Modern, the SS10 prototype -- any family behind
// FontProviderResult.stoneCenters) have no configurable per-layer Gap: RS-2012 disables/hides the
// Gap UI control for these layers, and generateTextLayout()'s authored branch above never reads
// options.gapMm at all. That leaves no existing "how much edge-to-edge clearance should adjacent
// stones keep" value to reuse when *repositioning* stones by an arbitrary scale -- the font
// author's fixed PITCH_MM already bakes in a clearance for the natural, unscaled layout, but scaling
// changes that pitch, so a legality check needs its own explicit constant, independent of any
// per-layer field that may be stale, absent, or simply inapplicable to this layer.
//
// 0.3mm, not an invented value: families/rsBlockPrototypeSS10.js and families/rsBlock.js both
// document their authored PITCH_MM=3.1 as "SS10's 2.8mm stone + 0.3mm gap" -- the repository's own
// production-fitting-gap rule for this exact stone/pitch pairing (MONO-001A). Reusing it here means
// SS10 at its authored pitch legitimately has ~zero legal shrink headroom (minimumLegalScale ~= 1.0),
// which is the correct, conservative answer: SS10's dot-matrix glyphs were hand-placed at the tightest
// clearance already judged production-safe, so this transform must not treat them as having slack
// that was never actually there.
export const AUTHORED_FONT_FITTING_GAP_MM = 0.3;

// Tolerance for the minimumLegalScale comparison below, not a fitting-legality relaxation: absorbs
// floating-point noise (~1e-15) in requiredSpacingMm/naturalMinimumSpacingMm, several orders of
// magnitude below any real requested-scale difference this milestone cares about.
const RELATIVE_SCALE_EPSILON = 1e-9;

// Bugfix (permanent dead zone): match tolerance for erasedGridPositions against a freshly-generated
// stone's own position (see the erasedGridPositions exclusion block above). A stored natural-space
// position, re-transformed through the SAME forward transform that produced the original stone,
// reproduces it up to double-precision round-trip noise only (~1e-9mm at this coordinate scale) --
// 0.001mm is generous headroom above that noise floor while staying far below any real stone pitch
// (stoneSizeMm + gapMm is never anywhere close to this small), so it can never accidentally match a
// neighboring, un-erased stone.
const ERASED_POSITION_EPSILON_MM = 0.001;

// MONO-002: the true nearest-neighbor center-to-center distance across every stone in `stones`, or
// null if fewer than two stones exist (no pairwise constraint to measure). Reuses the exact
// grid-hash bucket shape StoneSampler.dedupeStonesByRadius()/MixedSizeGenerator.
// selectNonOverlappingSizedStones() already use above -- for a bucket cell size C, any pair closer
// than C is guaranteed to land in the same or an adjacent (3x3) bucket, so scanning every point's
// own 3x3 neighborhood can never miss a pair closer than C. The difference here is those two
// existing helpers only ever test a fixed known threshold; this needs the actual minimum distance,
// which is not known in advance. Starting the cell size at the layout's own stone size (the natural
// order of magnitude for an authored font's pitch) and doubling until the closest pair found is
// strictly inside the current cell size is what makes the result exact rather than approximate: any
// pair closer than the current cell size would have been found (see the 3x3 guarantee above), so a
// found distance strictly less than the cell size cannot be beaten by some pair the scan missed.
// Doubling is capped at the point set's own bounding-box diagonal, which collapses every stone into
// one bucket (an exhaustive, exact scan) and guarantees termination. Realistic text/monogram stone
// counts keep this well clear of an O(n^2) all-pairs cost.
function measureNaturalMinimumCenterDistanceMm(stones) {
  if (stones.length < 2) {
    return null;
  }

  let minXmm = Infinity, minYmm = Infinity, maxXmm = -Infinity, maxYmm = -Infinity;
  for (const stone of stones) {
    if (stone.xMm < minXmm) minXmm = stone.xMm;
    if (stone.xMm > maxXmm) maxXmm = stone.xMm;
    if (stone.yMm < minYmm) minYmm = stone.yMm;
    if (stone.yMm > maxYmm) maxYmm = stone.yMm;
  }
  const diagonalMm = Math.hypot(maxXmm - minXmm, maxYmm - minYmm);

  let cellSizeMm = stones[0].sizeMm;
  const maxCellSizeMm = Math.max(diagonalMm, cellSizeMm) + 1;

  for (;;) {
    const minDistMm = nearestNeighborDistanceForCellSize(stones, cellSizeMm);
    if (minDistMm !== null && minDistMm < cellSizeMm) {
      return minDistMm;
    }
    if (cellSizeMm >= maxCellSizeMm) {
      // A single bucket now covers every stone, so this scan was an exact all-pairs pass: return
      // whatever it found (null only if every stone is truly alone, which cannot happen once
      // stones.length >= 2, since every stone shares that one bucket with at least one other).
      return minDistMm;
    }
    cellSizeMm *= 2;
  }
}

function nearestNeighborDistanceForCellSize(stones, cellSizeMm) {
  const buckets = new Map();
  for (const stone of stones) {
    const gx = Math.floor(stone.xMm / cellSizeMm);
    const gy = Math.floor(stone.yMm / cellSizeMm);
    const key = `${gx},${gy}`;
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(stone);
  }

  let minDistSqMm = Infinity;
  for (const stone of stones) {
    const gx = Math.floor(stone.xMm / cellSizeMm);
    const gy = Math.floor(stone.yMm / cellSizeMm);
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const bucket = buckets.get(`${gx + dx},${gy + dy}`);
        if (!bucket) continue;
        for (const other of bucket) {
          if (other === stone) continue;
          const ddx = stone.xMm - other.xMm;
          const ddy = stone.yMm - other.yMm;
          const distSqMm = ddx * ddx + ddy * ddy;
          if (distSqMm < minDistSqMm) minDistSqMm = distSqMm;
        }
      }
    }
  }

  return minDistSqMm === Infinity ? null : Math.sqrt(minDistSqMm);
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
    color: params.color ?? null,
    // S-200: sizeMode/mixedOptions -- see normalizeMixedSizeParams()'s own doc comment.
    ...normalizeMixedSizeParams(params, stoneSizeMm)
  };

  if (params.shape === 'circle') {
    return {
      ...base,
      cxMm: assertFiniteNumber(params.cxMm, 'cxMm'),
      cyMm: assertFiniteNumber(params.cyMm, 'cyMm'),
      radiusMm: assertPositiveNumber(params.radiusMm, 'radiusMm')
    };
  }

  // S-110: Rectangle and every ShapeLibrary kind (Ellipse/Capsule/Regular Polygon/Star/Heart/Arrow/
  // Cross/Crescent/Ring) all place a natural shape into one x/y/w/h box -- the exact same fields
  // Rectangle already required, extended here with each configurable shape's own extra parameters.
  const placed = {
    ...base,
    xMm: assertFiniteNumber(params.xMm, 'xMm'),
    yMm: assertFiniteNumber(params.yMm, 'yMm'),
    widthMm: assertPositiveNumber(params.widthMm, 'widthMm'),
    heightMm: assertPositiveNumber(params.heightMm, 'heightMm')
  };

  if (params.shape === 'polygon') {
    return { ...placed, sides: assertIntegerInRange(params.sides, 'sides', 3, 12) };
  }
  if (params.shape === 'star') {
    return {
      ...placed,
      points: assertIntegerInRange(params.points, 'points', 3, 12),
      innerRadiusRatio: assertNumberInRange(params.innerRadiusRatio, 'innerRadiusRatio', 0.1, 0.9)
    };
  }
  if (params.shape === 'ring') {
    return { ...placed, innerRatio: assertNumberInRange(params.innerRatio, 'innerRatio', 0.1, 0.9) };
  }

  return placed;
}

function assertIntegerInRange(value, name, min, max) {
  assertFiniteNumber(value, name);
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new RangeError(`${name} must be an integer from ${min} to ${max}.`);
  }
  return value;
}

function assertNumberInRange(value, name, min, max) {
  assertFiniteNumber(value, name);
  if (value < min || value > max) {
    throw new RangeError(`${name} must be a number from ${min} to ${max}.`);
  }
  return value;
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
    color: params.color ?? null,
    // S-200: sizeMode/mixedOptions -- see normalizeMixedSizeParams()'s own doc comment.
    ...normalizeMixedSizeParams(params, stoneSizeMm)
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

  // RS-1011: default 'fill' matches this method's previous, only, always-fill behavior exactly, so
  // every pre-existing call site (and every image layer saved before this milestone, which has no
  // stored mode) generates byte-identical geometry. 'outline' is intentionally not in
  // IMAGE_SAMPLE_MODES -- a raster density field has no vector perimeter to walk.
  const mode = params.mode ?? 'fill';
  if (!IMAGE_SAMPLE_MODES.has(mode)) {
    throw new TypeError(`Unsupported image fill mode: ${mode}. Expected one of: ${[...IMAGE_SAMPLE_MODES].join(', ')}`);
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
    mode,
    color: params.color ?? null,
    threshold: params.threshold,
    invert: params.invert,
    blurRadiusPx: params.blurRadiusPx,
    maxWidthPx: params.maxWidthPx,
    maxHeightPx: params.maxHeightPx,
    // S-200: sizeMode/mixedOptions -- see normalizeMixedSizeParams()'s own doc comment.
    ...normalizeMixedSizeParams(params, stoneSizeMm)
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
    color: params.color ?? null,
    // RS-3011: defaults to closed (true) unless explicitly told otherwise -- every 'path' layer
    // before freehand strokes existed was closed by construction (Boolean Operation results always
    // are), so an absent/undefined `closed` must keep sampling as a closed contour, matching this
    // layer type's pre-existing behavior exactly. Only an explicit `false` (a freehand stroke that
    // never looped back to its start) opts into open-contour outline sampling.
    closed: params.closed !== false,
    // RS-3014 Step 3: optional frozen natural-space reference box -- see
    // computeNaturalContourTransform()'s own doc comment for why this exists. Absent/null/undefined
    // (every layer predating this step, and every 'path' layer that has never had its contours cut)
    // is a safe no-op: the transform recomputes the box from `contours` exactly as it always has.
    naturalBoundingBoxMm: normalizeNaturalBoundingBoxMm(params.naturalBoundingBoxMm),
    // S-200: sizeMode/mixedOptions -- see normalizeMixedSizeParams()'s own doc comment.
    ...normalizeMixedSizeParams(params, stoneSizeMm),
    // RS-3011 Step 10a: Paint regions -- see normalizePathRegions()'s own doc comment. Defaults to
    // [] for every layer with no `regions` field at all (every layer predating this step), matching
    // this file's existing "absent optional field -> safe no-op default" convention.
    regions: normalizePathRegions(params.regions),
    // RS-3011 Step 12: Stamp's manually-placed stones -- see normalizePathStampedStones()'s own doc
    // comment. Same "absent optional field -> safe no-op default" convention as `regions` above.
    stampedStones: normalizePathStampedStones(params.stampedStones),
    // RS-3011 Step 13: Eraser's brush daubs -- see normalizePathEraseDaubs()'s own doc comment.
    // Same "absent optional field -> safe no-op default" convention as `regions`/`stampedStones`.
    eraseDaubs: normalizePathEraseDaubs(params.eraseDaubs),
    // Bugfix (permanent dead zone): Eraser's persistent stone-position snapshots -- see
    // normalizePathErasedGridPositions()'s own doc comment. Same "absent optional field -> safe
    // no-op default" convention as `regions`/`stampedStones`/`eraseDaubs` above.
    erasedGridPositions: normalizePathErasedGridPositions(params.erasedGridPositions)
  };
}

/**
 * Normalizes a 'path' layer's optional `naturalBoundingBoxMm` field (RS-3014 Step 3, Eraser
 * outline-cut). See computeNaturalContourTransform()'s own doc comment for what this freezes and
 * why. Absent/null -- every layer predating this step -- returns undefined so the field is
 * omitted from the normalized options entirely, matching this file's existing convention.
 *
 * @param {{minXmm:number,minYmm:number,maxXmm:number,maxYmm:number}} [input]
 * @returns {{minXmm:number,minYmm:number,maxXmm:number,maxYmm:number}|undefined}
 */
function normalizeNaturalBoundingBoxMm(input) {
  if (input === undefined || input === null) {
    return undefined;
  }
  if (typeof input !== 'object') {
    throw new TypeError('GeometryEngine.generatePathLayout naturalBoundingBoxMm must be an object when provided.');
  }

  const minXmm = assertFiniteNumber(input.minXmm, 'naturalBoundingBoxMm.minXmm');
  const minYmm = assertFiniteNumber(input.minYmm, 'naturalBoundingBoxMm.minYmm');
  const maxXmm = assertFiniteNumber(input.maxXmm, 'naturalBoundingBoxMm.maxXmm');
  const maxYmm = assertFiniteNumber(input.maxYmm, 'naturalBoundingBoxMm.maxYmm');
  if (maxXmm < minXmm || maxYmm < minYmm) {
    throw new RangeError('naturalBoundingBoxMm max values must be greater than or equal to min values.');
  }

  return { minXmm, minYmm, maxXmm, maxYmm };
}

/**
 * Normalizes a 'path' layer's optional `regions` field (RS-3011 Step 10a, Paint). Each region's
 * `contour` uses the exact same (0,0)-rooted natural-space convention as the layer's own
 * `contours` -- validated only as loosely as that field already is (a 3+-point array), per this
 * file's existing permissive style. `fillMode` defaults to `'fill'` (not DEFAULT_MODE/'outline')
 * because a region is inherently "these stones go in this patch," not an outline concept.
 *
 * @param {object[]} [regionsInput]
 * @returns {{id: string|null, contour: {xMm:number,yMm:number}[], stoneSizeMm: number, gapMm: number, color: string|null, fillMode: string}[]}
 */
function normalizePathRegions(regionsInput) {
  if (regionsInput === undefined || regionsInput === null) {
    return [];
  }
  if (!Array.isArray(regionsInput)) {
    throw new TypeError('GeometryEngine.generatePathLayout regions must be an array when provided.');
  }
  return regionsInput.map((region, index) => normalizePathRegion(region, index));
}

function normalizePathRegion(region, index) {
  if (!region || typeof region !== 'object') {
    throw new TypeError(`regions[${index}] must be an object.`);
  }
  if (!Array.isArray(region.contour) || region.contour.length < 3) {
    throw new TypeError(`regions[${index}] requires a contour array with at least 3 points.`);
  }

  const stoneSizeMm = assertPositiveNumber(region.stoneSizeMm, `regions[${index}].stoneSizeMm`);

  const gapMm = assertFiniteNumber(region.gapMm ?? 0, `regions[${index}].gapMm`);
  if (gapMm < 0) {
    throw new RangeError(`regions[${index}].gapMm must be zero or positive.`);
  }

  const fillMode = region.fillMode ?? 'fill';
  if (!SAMPLE_MODES.has(fillMode)) {
    throw new TypeError(`Unsupported regions[${index}].fillMode: ${fillMode}. Expected one of: ${[...SAMPLE_MODES].join(', ')}`);
  }

  if (region.color !== undefined && region.color !== null &&
    (typeof region.color !== 'string' || region.color.length === 0)) {
    throw new TypeError(`regions[${index}].color must be a non-empty string when provided.`);
  }

  return {
    id: typeof region.id === 'string' && region.id.length > 0 ? region.id : null,
    contour: region.contour,
    stoneSizeMm,
    gapMm,
    color: region.color ?? null,
    fillMode
  };
}

/**
 * Normalizes a 'path' layer's optional `stampedStones` field (RS-3011 Step 12, Stamp). Each entry's
 * xMm/yMm uses the exact same (0,0)-rooted natural-space convention as the layer's own `contours` and
 * a region's own `contour` field -- validated only as loosely as those fields already are, per this
 * file's existing permissive style.
 *
 * @param {object[]} [stampedStonesInput]
 * @returns {{id: string|null, xMm: number, yMm: number, sizeMm: number, color: string|null}[]}
 */
function normalizePathStampedStones(stampedStonesInput) {
  if (stampedStonesInput === undefined || stampedStonesInput === null) {
    return [];
  }
  if (!Array.isArray(stampedStonesInput)) {
    throw new TypeError('GeometryEngine.generatePathLayout stampedStones must be an array when provided.');
  }
  return stampedStonesInput.map((stamp, index) => normalizePathStampedStone(stamp, index));
}

function normalizePathStampedStone(stamp, index) {
  if (!stamp || typeof stamp !== 'object') {
    throw new TypeError(`stampedStones[${index}] must be an object.`);
  }

  const xMm = assertFiniteNumber(stamp.xMm, `stampedStones[${index}].xMm`);
  const yMm = assertFiniteNumber(stamp.yMm, `stampedStones[${index}].yMm`);
  const sizeMm = assertPositiveNumber(stamp.sizeMm, `stampedStones[${index}].sizeMm`);

  if (stamp.color !== undefined && stamp.color !== null &&
    (typeof stamp.color !== 'string' || stamp.color.length === 0)) {
    throw new TypeError(`stampedStones[${index}].color must be a non-empty string when provided.`);
  }

  return {
    id: typeof stamp.id === 'string' && stamp.id.length > 0 ? stamp.id : null,
    xMm,
    yMm,
    sizeMm,
    color: stamp.color ?? null
  };
}

/**
 * Normalizes a 'path' layer's optional `eraseDaubs` field (RS-3011 Step 13, Eraser). Each entry's
 * xMm/yMm uses the exact same (0,0)-rooted natural-space convention as `stampedStones`/a region's
 * own `contour` field -- validated only as loosely as those fields already are, mirroring
 * normalizePathStampedStones()'s own structure exactly (a daub is a point + radiusMm, not a
 * contour, so there's no polygon/array-of-points field to validate here).
 *
 * @param {object[]} [eraseDaubsInput]
 * @returns {{id: string|null, xMm: number, yMm: number, radiusMm: number}[]}
 */
function normalizePathEraseDaubs(eraseDaubsInput) {
  if (eraseDaubsInput === undefined || eraseDaubsInput === null) {
    return [];
  }
  if (!Array.isArray(eraseDaubsInput)) {
    throw new TypeError('GeometryEngine.generatePathLayout eraseDaubs must be an array when provided.');
  }
  return eraseDaubsInput.map((daub, index) => normalizePathEraseDaub(daub, index));
}

function normalizePathEraseDaub(daub, index) {
  if (!daub || typeof daub !== 'object') {
    throw new TypeError(`eraseDaubs[${index}] must be an object.`);
  }

  const xMm = assertFiniteNumber(daub.xMm, `eraseDaubs[${index}].xMm`);
  const yMm = assertFiniteNumber(daub.yMm, `eraseDaubs[${index}].yMm`);
  const radiusMm = assertPositiveNumber(daub.radiusMm, `eraseDaubs[${index}].radiusMm`);

  return {
    id: typeof daub.id === 'string' && daub.id.length > 0 ? daub.id : null,
    xMm,
    yMm,
    radiusMm
  };
}

/**
 * Normalizes a 'path' layer's optional `erasedGridPositions` field (bugfix: permanent dead zone).
 * Each entry is a snapshotted base-fill/region-patch stone position -- NOT a brush touch like
 * eraseDaubs (no radiusMm), just a point -- using the exact same (0,0)-rooted natural-space
 * convention as `stampedStones`/`eraseDaubs` above, validated only as loosely as those fields
 * already are, mirroring normalizePathEraseDaubs()'s own structure minus radiusMm.
 *
 * @param {object[]} [erasedGridPositionsInput]
 * @returns {{xMm: number, yMm: number}[]}
 */
function normalizePathErasedGridPositions(erasedGridPositionsInput) {
  if (erasedGridPositionsInput === undefined || erasedGridPositionsInput === null) {
    return [];
  }
  if (!Array.isArray(erasedGridPositionsInput)) {
    throw new TypeError('GeometryEngine.generatePathLayout erasedGridPositions must be an array when provided.');
  }
  return erasedGridPositionsInput.map((pos, index) => normalizePathErasedGridPosition(pos, index));
}

function normalizePathErasedGridPosition(pos, index) {
  if (!pos || typeof pos !== 'object') {
    throw new TypeError(`erasedGridPositions[${index}] must be an object.`);
  }

  const xMm = assertFiniteNumber(pos.xMm, `erasedGridPositions[${index}].xMm`);
  const yMm = assertFiniteNumber(pos.yMm, `erasedGridPositions[${index}].yMm`);

  return { xMm, yMm };
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
