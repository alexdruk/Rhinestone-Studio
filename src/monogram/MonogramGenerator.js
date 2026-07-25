/**
 * MONO-005: Headless Monogram Generator — the first complete monogram generation pipeline.
 *
 * Pure orchestration: this module owns no geometry math of its own. It sequences three already-
 * built pieces (per their own milestones' scope boundaries, see each module's doc comment):
 *   - FrameLibrary.js (MONO-003) for the frame's own stone-generation contours and its clearance-
 *     eroded interior region.
 *   - MonogramLayouts.js (MONO-004) for slot geometry inside that interior.
 *   - GeometryEngine (injected; MONO-002's scaleAuthoredTextLayout() in particular) for turning a
 *     letter + font into an authored StoneLayout and legally resizing it to fit its slot.
 *
 * No UI, no Lightbox, no menu integration, no renderer changes, no `project.monograms`. This
 * module only ever returns plain data: ordinary project layer objects (the same shape a human
 * creates via the existing text/path layer tools) plus a structured success/failure result. It
 * never throws for a normal fitting/validation failure — see generate()'s own doc comment for the
 * full list of structured failure reasons.
 *
 * No DOM, no app.js dependency. The GeometryEngine instance (and the fontProviderRegistry it was
 * built with) is supplied by the caller via the constructor, the same "collaborator injected, not
 * constructed" convention src/history/HistoryManager.js and src/library/DesignLibrary.js already
 * use for their own storage adapters.
 */

import { getFrameDefinition, computeFrameInterior } from '../geometry/FrameLibrary.js';
import { computeMonogramLayout, MONOGRAM_LAYOUT_FAILURE_REASONS } from './MonogramLayouts.js';
import {
  Stone,
  DEFAULT_STONE_COLOR,
  TEXT_SCALE_FAILURE_REASONS,
  AUTHORED_FONT_FITTING_GAP_MM,
  dedupeStonesByRadius
} from '../geometry/index.js';

// Reason codes generate() returns on failure -- a caller branches on these, never on message text
// (same convention as MONOGRAM_LAYOUT_FAILURE_REASONS/TEXT_SCALE_FAILURE_REASONS this module itself
// consumes). See generate()'s own doc comment for which pipeline step produces each one.
export const MONOGRAM_GENERATOR_FAILURE_REASONS = Object.freeze({
  INVALID_INPUT: 'invalid-input',
  FRAME_NOT_FOUND: 'frame-not-found',
  LAYOUT_NOT_FOUND: 'layout-not-found',
  UNSUPPORTED_LETTER_COUNT: 'unsupported-letter-count',
  INVALID_FONT: 'invalid-font',
  FITTING_FAILED: 'fitting-failed',
  BELOW_MINIMUM_SCALE: 'below-minimum-scale',
  LETTER_COLLISION: 'letter-collision',
  FRAME_COLLISION: 'frame-collision'
});

// Production gap default, reused rather than reinvented -- the same 0.3mm constant MONO-002
// documents as the repository's own authored-font stone-to-stone gap (families/rsBlock.js's/
// rsBlockPrototypeSS10.js's PITCH_MM = stone + 0.3mm gap). Also used, uniformly, as the required
// cross-letter/letter-vs-frame clearance in the collision check below -- this milestone's one
// "stone size" input applies to both the frame and every letter, so one shared spacing constant is
// correct for both.
const DEFAULT_GAP_MM = AUTHORED_FONT_FITTING_GAP_MM;

// generateTextLayout() requires a positive heightMm, but it has zero effect on an authored font's
// actual geometry (see RhinestoneFontProvider.js's own doc comment: "Deliberately NOT scaled by
// heightMm"). Any positive placeholder works identically; the letter's true size is controlled
// entirely by requestedScale via scaleAuthoredTextLayout() below.
const PLACEHOLDER_HEIGHT_MM = 25;

const DEFAULT_FRAME_MODE = 'fill';
const VECTOR_FILL_MODES = new Set(['outline', 'fill', 'staggered', 'radial', 'contour']);

// Ordinary text-layer field defaults, matching app.js's own newTextLayer()/defaultProject() shape
// exactly (see app.js:1995/609) so a generated letter layer is field-for-field indistinguishable
// from one a human created through the existing UI.
const DEFAULT_TEXT_MODE = 'stroke';
const DEFAULT_CURVE_RADIUS_MM = 40;
const DEFAULT_CURVE_DIRECTION = 'outside';
const DEFAULT_CURVE_START_ANGLE_DEG = 0;
const DEFAULT_CURVE_SWEEP_ANGLE_DEG = 180;
const DEFAULT_CURVE_ALIGNMENT = 'center';

function isPlainRect(rect) {
  return !!rect && typeof rect === 'object'
    && Number.isFinite(rect.xMm) && Number.isFinite(rect.yMm)
    && Number.isFinite(rect.widthMm) && Number.isFinite(rect.heightMm)
    && rect.widthMm > 0 && rect.heightMm > 0;
}

function isSingleCharacterString(value) {
  return typeof value === 'string' && Array.from(value).length === 1;
}

function failure(reason, message, extra = {}) {
  return { ok: false, reason, message, layers: null, measurements: null, diagnostics: null, ...extra };
}

export class MonogramGenerator {
  /**
   * @param {{geometryEngine: import('../geometry/GeometryEngine.js').GeometryEngine}} options
   */
  constructor({ geometryEngine } = {}) {
    if (!geometryEngine
      || typeof geometryEngine.generateTextLayout !== 'function'
      || typeof geometryEngine.scaleAuthoredTextLayout !== 'function'
      || typeof geometryEngine.generatePathLayout !== 'function') {
      throw new TypeError('MonogramGenerator requires a geometryEngine with generateTextLayout()/scaleAuthoredTextLayout()/generatePathLayout().');
    }
    this._engine = geometryEngine;
  }

  /**
   * Generate a complete monogram as ordinary project layers.
   *
   * Pipeline (per MONO-005): resolve the frame -> compute its clearance-eroded fitting rectangle ->
   * compute layout slots inside it -> generate + fit every letter independently (authored-font
   * scaling via GeometryEngine.scaleAuthoredTextLayout()) -> generate the frame layer -> validate
   * collisions (letter vs letter, letter vs frame) using real production spacing (stoneSizeMm +
   * gapMm). Never auto-corrects: a letter/frame that does not fit is a structured failure, not a
   * silently adjusted result.
   *
   * @param {object} request
   * @param {string} request.frameId A FrameLibrary frame id (see listFrames()).
   * @param {string} request.layoutId A MonogramLayouts layout id (see MONOGRAM_LAYOUTS).
   * @param {string[]} request.letters One single-character string per layout slot, in reading
   *   order (letters[i] fills the slot whose `index === i` -- slot `drawOrder`, not `index`,
   *   controls the returned layers' paint order, per MONOGRAM_LAYOUTS' own convention).
   * @param {string} request.fontId Must resolve to an authored (stoneCenters-based) font --
   *   ordinary OpenType fonts are rejected with INVALID_FONT (this generator has no path/outline
   *   layer representation for glyph-contour fonts, only for authored stone centers).
   * @param {string} [request.providerId]
   * @param {number} request.stoneSizeMm Applies uniformly to the frame and every letter.
   * @param {number} [request.gapMm] Production spacing gap, default AUTHORED_FONT_FITTING_GAP_MM.
   * @param {string} [request.color] Default DEFAULT_STONE_COLOR.
   * @param {{xMm:number,yMm:number,widthMm:number,heightMm:number}} request.frameRect The box the
   *   frame's own stone-generation geometry is placed into (same convention every other placed
   *   layer type -- circle/rectangle/svg/path/image -- already uses for its own x/y/w/h).
   * @param {{mode?:string,color?:string}} [request.frameOptions] Frame-specific overrides; mode
   *   defaults to 'fill' (a solid stone band), color falls back to request.color.
   * @returns {Promise<{
   *   ok: boolean,
   *   reason?: string,
   *   message?: string,
   *   layers: object[]|null,
   *   measurements: object|null,
   *   diagnostics: object|null
   * }>}
   */
  async generate(request) {
    const {
      frameId, layoutId, letters, fontId, providerId,
      stoneSizeMm, gapMm = DEFAULT_GAP_MM, color,
      frameRect, frameOptions = {}
    } = request || {};
    const R = MONOGRAM_GENERATOR_FAILURE_REASONS;

    if (typeof frameId !== 'string' || frameId.length === 0) {
      return failure(R.INVALID_INPUT, 'frameId must be a non-empty string.');
    }
    if (typeof layoutId !== 'string' || layoutId.length === 0) {
      return failure(R.INVALID_INPUT, 'layoutId must be a non-empty string.');
    }
    if (!Array.isArray(letters) || letters.length === 0 || !letters.every(isSingleCharacterString)) {
      return failure(R.INVALID_INPUT, 'letters must be a non-empty array of single-character strings.');
    }
    if (typeof fontId !== 'string' || fontId.length === 0) {
      return failure(R.INVALID_INPUT, 'fontId must be a non-empty string.');
    }
    if (typeof stoneSizeMm !== 'number' || !Number.isFinite(stoneSizeMm) || stoneSizeMm <= 0) {
      return failure(R.INVALID_INPUT, 'stoneSizeMm must be a positive finite number.');
    }
    if (typeof gapMm !== 'number' || !Number.isFinite(gapMm) || gapMm < 0) {
      return failure(R.INVALID_INPUT, 'gapMm must be a non-negative finite number.');
    }
    if (!isPlainRect(frameRect)) {
      return failure(R.INVALID_INPUT, 'frameRect must be a {xMm,yMm,widthMm,heightMm} rectangle with finite coordinates and positive width/height.');
    }
    if (color !== undefined && color !== null && (typeof color !== 'string' || color.length === 0)) {
      return failure(R.INVALID_INPUT, 'color must be a non-empty string when provided.');
    }

    // 1. Resolve FrameLibrary.
    let frame;
    try {
      frame = getFrameDefinition(frameId);
    } catch {
      return failure(R.FRAME_NOT_FOUND, `Unknown frame id ${JSON.stringify(frameId)}.`);
    }

    const normalizedFrameRect = {
      xMm: frameRect.xMm, yMm: frameRect.yMm, widthMm: frameRect.widthMm, heightMm: frameRect.heightMm
    };
    const resolvedColor = color ?? DEFAULT_STONE_COLOR;

    // 2. Compute frame fitting rectangle -- the clearance-eroded interior region a letter may
    // occupy (never the stone band itself; see FrameLibrary's own MONO-001A doc comment).
    const { boundingBox: interiorBoundingBox } = computeFrameInterior(frame, normalizedFrameRect);
    if (!interiorBoundingBox) {
      return failure(R.FITTING_FAILED, `Frame ${JSON.stringify(frameId)}'s interior is empty for the given frameRect (frame too small for its own clearance).`);
    }
    const frameInteriorRect = {
      xMm: interiorBoundingBox.minXmm,
      yMm: interiorBoundingBox.minYmm,
      widthMm: interiorBoundingBox.widthMm,
      heightMm: interiorBoundingBox.heightMm
    };

    // 3. Compute layout slots.
    const layoutResult = computeMonogramLayout({ layoutId, frameInteriorRect, letterCount: letters.length });
    if (!layoutResult.ok) {
      const reason = layoutResult.reason === MONOGRAM_LAYOUT_FAILURE_REASONS.UNKNOWN_LAYOUT ? R.LAYOUT_NOT_FOUND
        : layoutResult.reason === MONOGRAM_LAYOUT_FAILURE_REASONS.UNSUPPORTED_LETTER_COUNT ? R.UNSUPPORTED_LETTER_COUNT
        : R.INVALID_INPUT;
      return failure(reason, layoutResult.message);
    }
    const slotByIndex = new Map(layoutResult.slots.map((slot) => [slot.index, slot]));

    const frameLayerId = `monogram-${frameId}-${layoutId}-frame`;
    const frameMode = VECTOR_FILL_MODES.has(frameOptions.mode) ? frameOptions.mode : DEFAULT_FRAME_MODE;
    const frameColor = (typeof frameOptions.color === 'string' && frameOptions.color.length > 0)
      ? frameOptions.color
      : resolvedColor;

    // 4. + 5. Generate every letter independently, then fit it into its assigned slot.
    const letterResults = [];
    for (let i = 0; i < letters.length; i++) {
      const letter = letters[i];
      const slot = slotByIndex.get(i);
      const letterLayerId = `monogram-${frameId}-${layoutId}-letter-${i}`;

      let baseLayout;
      try {
        baseLayout = await this._engine.generateTextLayout({
          text: letter,
          fontId,
          providerId,
          layerId: letterLayerId,
          heightMm: PLACEHOLDER_HEIGHT_MM,
          stoneSizeMm,
          gapMm: 0,
          mode: 'outline',
          color: resolvedColor,
          curveEnabled: false
        });
      } catch (error) {
        return failure(R.INVALID_FONT, `Failed to generate letter ${JSON.stringify(letter)} with font ${JSON.stringify(fontId)}: ${error.message}`);
      }

      // scaleAuthoredTextLayout() (MONO-002) is the only supported resize path for these fonts --
      // heightMm above has no effect on them (see PLACEHOLDER_HEIGHT_MM's doc comment) -- so a
      // non-authored font (e.g. an OpenType family) can never be fit by this generator.
      if (baseLayout.sourceMode !== 'authored') {
        return failure(R.INVALID_FONT, `Font ${JSON.stringify(fontId)} does not supply authored stone centers; MonogramGenerator only supports authored fonts (got sourceMode ${JSON.stringify(baseLayout.sourceMode)}).`);
      }

      const naturalBoundingBox = baseLayout.getBoundingBox();
      if (!naturalBoundingBox) {
        return failure(R.FITTING_FAILED, `Letter ${JSON.stringify(letter)} produced no stones for font ${JSON.stringify(fontId)}.`);
      }

      // The scale that makes the letter's natural bounding box fit snugly inside its slot's
      // targetRect, preserving aspect ratio (the smaller of the two axis ratios governs).
      const requestedScale = Math.min(
        slot.targetRect.widthMm / naturalBoundingBox.widthMm,
        slot.targetRect.heightMm / naturalBoundingBox.heightMm
      );

      const scaleResult = this._engine.scaleAuthoredTextLayout(baseLayout, requestedScale);
      if (!scaleResult.ok) {
        const reason = scaleResult.reason === TEXT_SCALE_FAILURE_REASONS.BELOW_MINIMUM_SCALE
          ? R.BELOW_MINIMUM_SCALE
          : R.FITTING_FAILED;
        return failure(reason, `Letter ${JSON.stringify(letter)} (slot ${i}): ${scaleResult.message}`, {
          diagnostics: { letter, slotIndex: i, scaleAuthoredTextLayoutResult: scaleResult }
        });
      }

      const scaledLayout = scaleResult.layout;
      const scaledBoundingBox = scaledLayout.getBoundingBox();
      const targetCenterXMm = slot.targetRect.xMm + slot.targetRect.widthMm / 2;
      const targetCenterYMm = slot.targetRect.yMm + slot.targetRect.heightMm / 2;
      const deltaXMm = targetCenterXMm - scaledBoundingBox.center.xMm;
      const deltaYMm = targetCenterYMm - scaledBoundingBox.center.yMm;

      // Pure translation onto the slot's own center -- sizeMm/color/layerId/index/metadata carried
      // through unchanged, mirroring scaleAuthoredTextLayout()'s own _buildScaledTextLayoutResult().
      const finalStones = scaledLayout.stones.map((stone) => new Stone({
        xMm: stone.xMm + deltaXMm,
        yMm: stone.yMm + deltaYMm,
        sizeMm: stone.sizeMm,
        color: stone.color,
        layerId: stone.layerId,
        index: stone.index,
        metadata: stone.metadata
      }));

      letterResults.push({
        letter, slotIndex: i, slot, layerId: letterLayerId, stones: finalStones,
        requestedScale,
        minimumLegalScale: scaleResult.minimumLegalScale,
        naturalMinimumSpacingMm: scaleResult.naturalMinimumSpacingMm,
        requiredSpacingMm: scaleResult.requiredSpacingMm,
        naturalBoundingBox, scaledBoundingBox
      });
    }

    // 6. Generate the frame layer -- reuses the frame's own generationNaturalContours (outer+inner
    // band) through GeometryEngine.generatePathLayout(), the same "place natural contours into an
    // x/y/w/h box, then outline/fill-sample" pipeline every other placed shape/path layer already
    // uses. No new geometry code: this is the one point of contact between FrameLibrary's data and
    // the Geometry Engine.
    const frameLayout = this._engine.generatePathLayout({
      contours: frame.generationNaturalContours,
      layerId: frameLayerId,
      xMm: normalizedFrameRect.xMm,
      yMm: normalizedFrameRect.yMm,
      widthMm: normalizedFrameRect.widthMm,
      heightMm: normalizedFrameRect.heightMm,
      stoneSizeMm,
      gapMm,
      mode: frameMode,
      color: frameColor
    });

    // 7. Validate collisions -- reuses StoneSampler's existing dedupeStonesByRadius() grid-hash
    // (3x3-neighborhood bucket scan, cross-layerId only) rather than a new O(n^2)/custom spatial
    // structure. Passing d = stoneSizeMm + gapMm for every stone (instead of each stone's own real
    // sizeMm) makes that function's own (a.d + b.d) / 2 touching threshold equal exactly
    // stoneSizeMm + gapMm -- the real production center-to-center spacing requirement -- for every
    // pair. Same-layerId pairs (a letter's own internal spacing, or the frame's own internal
    // spacing) are already skipped by that function, and already independently guaranteed legal by
    // scaleAuthoredTextLayout()'s minimumLegalScale check / the frame's own stone sampler
    // respectively, so this only ever flags genuine cross-object collisions.
    const requiredSpacingMm = stoneSizeMm + gapMm;
    const toDedupeRecords = (stones) => stones.map((s) => ({ x: s.xMm, y: s.yMm, d: requiredSpacingMm, layerId: s.layerId }));
    const allLetterStones = letterResults.flatMap((r) => r.stones);

    const letterOnlyRecords = toDedupeRecords(allLetterStones);
    if (dedupeStonesByRadius(letterOnlyRecords).length < letterOnlyRecords.length) {
      return failure(R.LETTER_COLLISION, 'Two or more letters collide at the requested stone size/spacing.', {
        diagnostics: { requiredSpacingMm }
      });
    }

    const withFrameRecords = toDedupeRecords(allLetterStones.concat(frameLayout.stones));
    if (dedupeStonesByRadius(withFrameRecords).length < withFrameRecords.length) {
      return failure(R.FRAME_COLLISION, 'A letter collides with the frame at the requested stone size/spacing.', {
        diagnostics: { requiredSpacingMm }
      });
    }

    // --- Build ordinary project layers -------------------------------------------------------
    // Same field shapes app.js's own newTextLayer()/Boolean-Operation path-layer creation use (see
    // this module's own doc comment) -- these layers are indistinguishable, field-for-field, from
    // ones a human created through the existing UI. Letters are ordered by slot drawOrder (not
    // slotIndex) so a caller that simply appends this array to project.layers gets the conventional
    // "center letter drawn on top" paint order MONOGRAM_LAYOUTS already establishes.
    const frameLayerObj = {
      id: frameLayerId,
      type: 'path',
      visible: true,
      pathName: `${frame.label} Frame`,
      contours: frame.generationNaturalContours.map((polygon) => polygon.map((p) => ({ x: p.xMm, y: p.yMm }))),
      x: normalizedFrameRect.xMm,
      y: normalizedFrameRect.yMm,
      w: normalizedFrameRect.widthMm,
      h: normalizedFrameRect.heightMm,
      stoneSize: stoneSizeMm,
      gap: gapMm,
      color: frameColor,
      fillMode: frameMode
    };

    const letterLayerObjs = letterResults
      .slice()
      .sort((a, b) => a.slot.drawOrder - b.slot.drawOrder)
      .map((r) => ({
        id: r.layerId,
        type: 'text',
        visible: true,
        text: r.letter,
        font: fontId,
        // Informational: the letter's true fitted height (see scaledBoundingBox), forward-facing
        // for a future milestone that wires authored-font scaling into live text-layer rendering --
        // the current, unmodified renderer ignores heightMm for authored fonts entirely (see
        // PLACEHOLDER_HEIGHT_MM's doc comment), so this field has no visual effect today.
        height: r.scaledBoundingBox.heightMm,
        textMode: DEFAULT_TEXT_MODE,
        stoneSize: stoneSizeMm,
        gap: gapMm,
        color: resolvedColor,
        // The generator has already performed fitting; autoFit is additionally a no-op for
        // authored fonts today (TXT-103A), so it is left off rather than implying it does anything.
        autoFit: false,
        curveEnabled: false,
        curveRadiusMm: DEFAULT_CURVE_RADIUS_MM,
        curveDirection: DEFAULT_CURVE_DIRECTION,
        curveStartAngleDeg: DEFAULT_CURVE_START_ANGLE_DEG,
        curveSweepAngleDeg: DEFAULT_CURVE_SWEEP_ANGLE_DEG,
        curveAlignment: DEFAULT_CURVE_ALIGNMENT,
        align: 'left',
        lineSpacing: 1,
        rotationDeg: 0,
        // Absolute mm anchor, in the same frameRect coordinate space every other placed layer type
        // (circle/rectangle/svg/path/image) already uses for its own x/y -- see this module's own
        // doc comment for why this differs from the live text-rendering pipeline's canvas-centered
        // x/y offset convention (a known, documented limitation, not a bug).
        x: r.slot.targetRect.xMm,
        y: r.slot.targetRect.yMm
      }));

    const layers = [frameLayerObj, ...letterLayerObjs];

    const measurements = {
      frameId,
      layoutId,
      frameRect: normalizedFrameRect,
      frameInteriorRect,
      slots: layoutResult.slots,
      letters: letterResults.map((r) => ({
        letter: r.letter,
        slotIndex: r.slotIndex,
        layerId: r.layerId,
        requestedScale: r.requestedScale,
        minimumLegalScale: r.minimumLegalScale,
        naturalMinimumSpacingMm: r.naturalMinimumSpacingMm,
        requiredSpacingMm: r.requiredSpacingMm,
        naturalBoundingBox: r.naturalBoundingBox.toJSON(),
        scaledBoundingBox: r.scaledBoundingBox.toJSON(),
        stoneCount: r.stones.length
      })),
      frameStoneCount: frameLayout.stones.length,
      letterStoneCount: allLetterStones.length,
      totalStoneCount: frameLayout.stones.length + allLetterStones.length
    };

    const diagnostics = {
      productionSpacingMm: requiredSpacingMm,
      collisions: { letterCollision: false, frameCollision: false }
    };

    return { ok: true, layers, measurements, diagnostics };
  }
}
