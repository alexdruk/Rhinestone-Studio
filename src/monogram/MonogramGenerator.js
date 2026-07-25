/**
 * MONO-005 / MONO-005A: Headless Monogram Generator — the first complete monogram generation
 * pipeline, now producing project layers that reproduce their validated geometry through the
 * *normal* application pipeline (project layer -> GeometryEngine.generateTextLayout() ->
 * StoneLayout -> renderer/exporter), not just an ephemeral StoneLayout held inside this class.
 *
 * Pure orchestration: this module owns no geometry math of its own. It sequences already-built
 * pieces (per their own milestones' scope boundaries, see each module's doc comment):
 *   - FrameLibrary.js (MONO-003) for the frame's own stone-generation contours and its clearance-
 *     eroded interior region.
 *   - MonogramLayouts.js (MONO-004) for slot geometry inside that interior.
 *   - GeometryEngine (injected; MONO-002's scaleAuthoredTextLayout(), and MONO-005A's
 *     authoredScale param on generateTextLayout()) for turning a letter + font into an authored
 *     StoneLayout and legally, persistently resizing it to fit its slot.
 *   - src/editing/TextPlacement.js (MONO-005A) for the real text-layer x/y placement contract --
 *     see MONOGRAM-005A's audit, summarized in generate()'s own doc comment.
 *
 * No UI, no Lightbox, no menu integration, no `project.monograms`. This module only ever returns
 * plain data: ordinary project layer objects (the same shape a human creates via the existing
 * text/path layer tools) plus a structured success/failure result. It never throws for a normal
 * fitting/validation failure — see generate()'s own doc comment for the full list of structured
 * failure reasons.
 *
 * No DOM, no app.js dependency. The GeometryEngine instance (and the fontProviderRegistry it was
 * built with) is supplied by the caller via the constructor, the same "collaborator injected, not
 * constructed" convention src/history/HistoryManager.js and src/library/DesignLibrary.js already
 * use for their own storage adapters.
 */

import { getFrameDefinition, computeFrameInterior, computeFrameFitRect } from '../geometry/FrameLibrary.js';
import { computeMonogramLayout, MONOGRAM_LAYOUT_FAILURE_REASONS } from './MonogramLayouts.js';
import {
  Stone,
  DEFAULT_STONE_COLOR,
  TEXT_SCALE_FAILURE_REASONS,
  AUTHORED_FONT_FITTING_GAP_MM,
  findCrossGroupCollisions
} from '../geometry/index.js';
import { computeTextLayerPositionForTargetCenterMm } from '../editing/index.js';

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
  FRAME_COLLISION: 'frame-collision',
  // MONO-005A: the generated layer's own data, regenerated through the real, unmodified
  // GeometryEngine.generateTextLayout() path, did not reproduce the fitted geometry used for
  // validation. Should never happen in practice (see generate()'s round-trip check below) -- this
  // is a defense against future drift between this module and GeometryEngine, not a normal,
  // expected user-facing failure like the others above.
  INTERNAL_CONTRACT_MISMATCH: 'internal-contract-mismatch'
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
// entirely by authoredScale (MONO-005A; see GeometryEngine.generateTextLayout()'s own doc comment).
const PLACEHOLDER_HEIGHT_MM = 25;

// MONO-005A: tolerance for the round-trip position/bounding-box comparison below. Both the fitted
// layout and the round-trip layout apply the identical scaleAuthoredTextLayout() transform to the
// identical raw authored stones (see generate()'s own comment at the round-trip check), so any real
// divergence is either a whole stone missing/extra or a gross positional error -- this is many
// orders of magnitude tighter than any real fitting decision, purely to absorb float noise (e.g.
// scaleAuthoredTextLayout() being applied via two independently-constructed StoneLayout instances).
const ROUND_TRIP_POSITION_EPSILON_MM = 1e-6;

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

function isPlainSize(size) {
  return !!size && typeof size === 'object'
    && Number.isFinite(size.widthMm) && Number.isFinite(size.heightMm)
    && size.widthMm > 0 && size.heightMm > 0;
}

function isSingleCharacterString(value) {
  return typeof value === 'string' && Array.from(value).length === 1;
}

function failure(reason, message, extra = {}) {
  return { ok: false, reason, message, layers: null, measurements: null, diagnostics: null, ...extra };
}

// MONO-005A: compares the StoneLayout used for fitting/collision validation against a fresh
// regeneration through the real GeometryEngine.generateTextLayout() path (with the persisted
// authoredScale applied internally) -- see generate()'s round-trip check for why these are expected
// to be identical, not merely similar. Returns a short mismatch description, or null if they match.
function describeRoundTripMismatch(fittedLayout, roundTripLayout) {
  if (fittedLayout.stones.length !== roundTripLayout.stones.length) {
    return `stone count ${fittedLayout.stones.length} vs ${roundTripLayout.stones.length}`;
  }
  for (let i = 0; i < fittedLayout.stones.length; i++) {
    const expected = fittedLayout.stones[i];
    const actual = roundTripLayout.stones[i];
    if (Math.abs(expected.xMm - actual.xMm) > ROUND_TRIP_POSITION_EPSILON_MM
      || Math.abs(expected.yMm - actual.yMm) > ROUND_TRIP_POSITION_EPSILON_MM) {
      return `stone ${i} position (${expected.xMm}, ${expected.yMm}) vs (${actual.xMm}, ${actual.yMm})`;
    }
    if (expected.sizeMm !== actual.sizeMm) {
      return `stone ${i} sizeMm ${expected.sizeMm} vs ${actual.sizeMm}`;
    }
    if (expected.color !== actual.color) {
      return `stone ${i} color ${JSON.stringify(expected.color)} vs ${JSON.stringify(actual.color)}`;
    }
  }

  const fittedBox = fittedLayout.getBoundingBox();
  const roundTripBox = roundTripLayout.getBoundingBox();
  if (!fittedBox !== !roundTripBox) {
    return 'one bounding box is null and the other is not';
  }
  if (fittedBox && roundTripBox) {
    const fields = ['minXmm', 'minYmm', 'widthMm', 'heightMm'];
    for (const field of fields) {
      if (Math.abs(fittedBox[field] - roundTripBox[field]) > ROUND_TRIP_POSITION_EPSILON_MM) {
        return `bounding box ${field} ${fittedBox[field]} vs ${roundTripBox[field]}`;
      }
    }
  }

  return null;
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
   * Pipeline (per MONO-005/MONO-005A): resolve the frame -> compute its clearance-eroded fitting
   * rectangle -> compute layout slots inside it -> generate + fit every letter independently
   * (authored-font scaling via GeometryEngine.scaleAuthoredTextLayout()), persist that scale as the
   * letter layer's own authoredScale field, compute its x/y under the real text-layer placement
   * contract, and verify both round-trip through the normal GeometryEngine.generateTextLayout()
   * path -> generate the frame layer -> validate collisions (letter vs letter, letter vs frame)
   * using real production spacing (stoneSizeMm + gapMm). Never auto-corrects: a letter/frame that
   * does not fit is a structured failure, not a silently adjusted result.
   *
   * MONO-005A text x/y contract (see src/editing/TextPlacement.js for the full derivation and
   * source-of-truth): a text layer has no stored absolute position of its own -- it is always
   * auto-centered on the production canvas (project.canvas.width/height) first, then offset by its
   * own x/y on top of that (app.js's RS-1009/RS-1012 `computeTextPlacementOffset()`). Solving that
   * identity shows the final stone bounding-box *center* always lands at exactly
   * `(canvasWidthMm/2 + xMm, canvasHeightMm/2 + yMm)`, independent of the text's own measured
   * extents -- the same identity app.js's own `fitTextToShape()` already relies on. This generator
   * is therefore given the target canvas size (`request.canvasMm`) and computes each letter's x/y
   * from it via that shared helper, rather than storing an absolute frameRect-space coordinate a
   * canvas-centered live renderer could never reproduce.
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
   *   layer type -- circle/rectangle/svg/path/image -- already uses for its own x/y/w/h). Also the
   *   coordinate space letter slots (and therefore each letter's target absolute stone position)
   *   are computed in.
   * @param {{widthMm:number,heightMm:number}} request.canvasMm The target project's canvas size
   *   (project.canvas.width/height) -- required to compute a legal letter layer x/y under the real
   *   text-layer placement contract (see this method's own doc comment above). The caller (a future
   *   UI/integration milestone) always has this, since it already has the whole project.
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
      frameRect, canvasMm, frameOptions = {}
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
    if (!isPlainSize(canvasMm)) {
      return failure(R.INVALID_INPUT, 'canvasMm must be a {widthMm,heightMm} object with positive finite values (the target project\'s canvas size).');
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
    const normalizedCanvasMm = { widthMm: canvasMm.widthMm, heightMm: canvasMm.heightMm };
    const resolvedColor = color ?? DEFAULT_STONE_COLOR;

    // MONO-006C: the real production center-to-center spacing every letter and the frame must
    // respect -- computed once, up front, so it can drive both the fitting-region erosion below and
    // the collision check further down (previously only the latter; see this constant's own use at
    // the collision check for why the formula is exactly stoneSizeMm+gapMm).
    const requiredSpacingMm = stoneSizeMm + gapMm;

    // 2. Compute frame fitting rectangle -- the clearance-eroded interior region a letter may
    // occupy (never the stone band itself; see FrameLibrary's own MONO-001A doc comment).
    //
    // MONO-006C: a frame's own clearanceMm (a small, fixed, per-frame constant) is not always enough
    // geometric buffer for the *real* production spacing (requiredSpacingMm, which can reach ~6.7mm
    // for the largest catalog stone) -- passing requiredSpacingMm as computeFrameInterior()'s
    // minClearanceMm guarantees the fitting region always reserves at least that much room, so a
    // letter sized to fit inside it does not go on to collide with the frame's own stones below.
    //
    // MONO-006C also replaces the interior's raw axis-aligned bounding box with
    // computeFrameFitRect()'s inscribed rectangle at that same bounding box's own aspect ratio --
    // for a round/diamond frame the bounding box is a strict superset of the true (curved) interior,
    // so a slot sized to it could poke past the real boundary near the corners even though it fits
    // the box; computeFrameFitRect() (already built for exactly this, MONO-003) guarantees the
    // result is fully inside the true fitting polygon. For Square/Rounded-Square -- already
    // (near-)rectangular -- this returns essentially the same rect as the raw bounding box, so no
    // regression there.
    const { boundingBox: interiorBoundingBox } = computeFrameInterior(frame, normalizedFrameRect, requiredSpacingMm);
    if (!interiorBoundingBox) {
      return failure(R.FITTING_FAILED, `Frame ${JSON.stringify(frameId)}'s interior is empty for the given frameRect and stoneSizeMm ${stoneSizeMm}/gapMm ${gapMm} (frame too small for its required production clearance).`);
    }
    const inscribedInteriorRect = computeFrameFitRect(
      frame, normalizedFrameRect, interiorBoundingBox.widthMm / interiorBoundingBox.heightMm, requiredSpacingMm
    );
    if (!inscribedInteriorRect) {
      return failure(R.FITTING_FAILED, `Frame ${JSON.stringify(frameId)} has no usable rectangular interior region for the given frameRect and stoneSizeMm ${stoneSizeMm}/gapMm ${gapMm}.`);
    }
    const frameInteriorRect = {
      xMm: inscribedInteriorRect.xMm,
      yMm: inscribedInteriorRect.yMm,
      widthMm: inscribedInteriorRect.widthMm,
      heightMm: inscribedInteriorRect.heightMm
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

      // scaleAuthoredTextLayout() (MONO-002)/authoredScale (MONO-005A) is the only supported resize
      // path for these fonts -- heightMm above has no effect on them (see PLACEHOLDER_HEIGHT_MM's
      // doc comment) -- so a non-authored font (e.g. an OpenType family) can never be fit by this
      // generator.
      if (baseLayout.sourceMode !== 'authored') {
        return failure(R.INVALID_FONT, `Font ${JSON.stringify(fontId)} does not supply authored stone centers; MonogramGenerator only supports authored fonts (got sourceMode ${JSON.stringify(baseLayout.sourceMode)}).`);
      }

      const naturalBoundingBox = baseLayout.getBoundingBox();
      if (!naturalBoundingBox) {
        return failure(R.FITTING_FAILED, `Letter ${JSON.stringify(letter)} produced no stones for font ${JSON.stringify(fontId)}.`);
      }

      // MONO-006C: letters default to the *smallest legal* scale (maximum legal stone density)
      // rather than being stretched to fill their slot. An authored font's stoneCenters are a fixed,
      // low-resolution dot-matrix grid (PITCH_MM, per family) -- scaling that fixed dot count up to
      // fill a generous slot only spreads the same dots further apart (physical pitch = PITCH_MM *
      // scale), which is what reads as "sparse" next to the frame's own tightly-packed fill stones.
      // Requesting the minimum legal scale instead keeps every letter's stone-to-stone pitch at the
      // production floor (requiredSpacingMm) -- the densest a legal authored letter can ever be.
      //
      // scaleAuthoredTextLayout()'s minimumLegalScale is independent of the scale value passed in
      // (it's derived from the raw layout's own naturalMinimumSpacingMm and requiredSpacingMm --
      // see GeometryEngine.js), so a throwaway probe call at scale 1 is enough to read it back
      // (present in the result whether or not scale 1 itself happens to be legal).
      const probeResult = this._engine.scaleAuthoredTextLayout(baseLayout, 1);
      const minimumLegalScale = probeResult.minimumLegalScale;
      if (!(minimumLegalScale > 0)) {
        return failure(R.FITTING_FAILED, `Letter ${JSON.stringify(letter)} (slot ${i}): could not determine a minimum legal scale for font ${JSON.stringify(fontId)}.`);
      }
      const requestedScale = minimumLegalScale;

      if (requestedScale * naturalBoundingBox.widthMm > slot.targetRect.widthMm
        || requestedScale * naturalBoundingBox.heightMm > slot.targetRect.heightMm) {
        return failure(R.FITTING_FAILED, `Letter ${JSON.stringify(letter)} (slot ${i}) does not fit its slot even at the smallest legal scale for stone size ${stoneSizeMm}mm/gap ${gapMm}mm -- the frame is too small for this letter at this stone size.`, {
          diagnostics: {
            letter, slotIndex: i, requiredSpacingMm, minimumLegalScale,
            slotWidthMm: slot.targetRect.widthMm, slotHeightMm: slot.targetRect.heightMm,
            minimumWidthMm: requestedScale * naturalBoundingBox.widthMm,
            minimumHeightMm: requestedScale * naturalBoundingBox.heightMm
          }
        });
      }

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

      // MONO-005A round-trip verification: regenerate this exact letter through the real,
      // unmodified GeometryEngine.generateTextLayout() path, with authoredScale=requestedScale
      // baked in the normal way (the same code path live text-layer rendering will use once this
      // layer is loaded into a project), and confirm it reproduces scaledLayout exactly. Both calls
      // resolve the same raw authored stones from the font (generateTextLayout() is deterministic --
      // see MONO-002/RS Block/RS Modern's own test suites) and apply the identical
      // scaleAuthoredTextLayout() transform to them, so any divergence here is a real implementation
      // bug, not an expected edge case -- reported as a structured INTERNAL_CONTRACT_MISMATCH
      // failure rather than returned as a silently-wrong layer.
      let roundTripLayout;
      try {
        roundTripLayout = await this._engine.generateTextLayout({
          text: letter,
          fontId,
          providerId,
          layerId: letterLayerId,
          heightMm: PLACEHOLDER_HEIGHT_MM,
          stoneSizeMm,
          gapMm: 0,
          mode: 'outline',
          color: resolvedColor,
          curveEnabled: false,
          authoredScale: requestedScale
        });
      } catch (error) {
        return failure(R.INTERNAL_CONTRACT_MISMATCH, `Letter ${JSON.stringify(letter)} (slot ${i}): regenerating through the normal GeometryEngine.generateTextLayout() path with authoredScale=${requestedScale} failed: ${error.message}`);
      }
      const mismatch = describeRoundTripMismatch(scaledLayout, roundTripLayout);
      if (mismatch) {
        return failure(R.INTERNAL_CONTRACT_MISMATCH, `Letter ${JSON.stringify(letter)} (slot ${i}): regenerating through the normal GeometryEngine.generateTextLayout() path did not reproduce the fitted geometry (${mismatch}).`, {
          diagnostics: { letter, slotIndex: i }
        });
      }

      const targetCenterXMm = slot.targetRect.xMm + slot.targetRect.widthMm / 2;
      const targetCenterYMm = slot.targetRect.yMm + slot.targetRect.heightMm / 2;

      // The letter layer's actual, persistable x/y -- computed under the real text-layer placement
      // contract (see this method's own doc comment / src/editing/TextPlacement.js), so a live
      // renderer that auto-centers this layer's regenerated (authoredScale-scaled) bounding box on
      // canvasMm and then applies this x/y on top lands its center exactly on the slot's own center,
      // independent of the letter's own measured extents.
      const { xMm: layerXMm, yMm: layerYMm } = computeTextLayerPositionForTargetCenterMm({
        targetCenterXMm, targetCenterYMm,
        canvasWidthMm: normalizedCanvasMm.widthMm, canvasHeightMm: normalizedCanvasMm.heightMm
      });

      // Pure translation onto the slot's own center -- used for collision validation below (the
      // real absolute stone positions a live renderer will produce, per the placement contract
      // above; sizeMm/color/layerId/index/metadata carried through unchanged, mirroring
      // scaleAuthoredTextLayout()'s own _buildScaledTextLayoutResult()).
      const deltaXMm = targetCenterXMm - scaledBoundingBox.center.xMm;
      const deltaYMm = targetCenterYMm - scaledBoundingBox.center.yMm;
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
        requestedScale, layerXMm, layerYMm,
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

    // 7. Validate collisions -- reuses StoneSampler's findCrossGroupCollisions() (MONO-005A), a
    // pure collision *query* built from the same grid-hash bucket technique as
    // dedupeStonesByRadius() but purpose-built for classification: it never drops a stone, so a
    // colliding pair can never be hidden by an earlier, unrelated drop, and the set of reported
    // colliding group-pairs is provably independent of input order (see that function's own doc
    // comment). One pass classifies both categories: passing d = stoneSizeMm + gapMm for every
    // stone (instead of each stone's own real sizeMm) makes the shared (a.d + b.d) / 2 touching
    // threshold equal exactly stoneSizeMm + gapMm -- the real production center-to-center spacing
    // requirement. Same-layerId pairs (a letter's own internal spacing, or the frame's own internal
    // spacing) are never compared, and are already independently guaranteed legal by
    // scaleAuthoredTextLayout()'s minimumLegalScale check / the frame's own stone sampler
    // respectively, so this only ever flags genuine cross-object collisions. Letter-vs-letter is
    // reported ahead of letter-vs-frame when both occur, matching this milestone's own listed
    // failure-reason order. requiredSpacingMm was already computed above (step 2, reused there for
    // the fitting-region erosion) -- one shared value for both purposes, never redefined.
    const letterLayerIds = new Set(letterResults.map((r) => r.layerId));
    const allLetterStones = letterResults.flatMap((r) => r.stones);
    const collisionRecords = allLetterStones.concat(frameLayout.stones)
      .map((s) => ({ x: s.xMm, y: s.yMm, d: requiredSpacingMm, layerId: s.layerId }));
    const collisions = findCrossGroupCollisions(collisionRecords);

    if (collisions.some((c) => letterLayerIds.has(c.layerIdA) && letterLayerIds.has(c.layerIdB))) {
      return failure(R.LETTER_COLLISION, 'Two or more letters collide at the requested stone size/spacing.', {
        diagnostics: { requiredSpacingMm, collisions }
      });
    }
    if (collisions.some((c) => c.layerIdA === frameLayerId || c.layerIdB === frameLayerId)) {
      return failure(R.FRAME_COLLISION, 'A letter collides with the frame at the requested stone size/spacing.', {
        diagnostics: { requiredSpacingMm, collisions }
      });
    }

    // --- Build ordinary project layers -------------------------------------------------------
    // Same field shapes app.js's own newTextLayer()/Boolean-Operation path-layer creation use (see
    // this module's own doc comment) -- these layers are indistinguishable, field-for-field, from
    // ones a human created through the existing UI, plus one new additive field (authoredScale,
    // MONO-005A) every pre-existing text layer already defaults to 1 for. Letters are ordered by
    // slot drawOrder (not slotIndex) so a caller that simply appends this array to project.layers
    // gets the conventional "center letter drawn on top" paint order MONOGRAM_LAYOUTS already
    // establishes.
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
        // Informational only: heightMm has no effect on authored-font geometry (see
        // PLACEHOLDER_HEIGHT_MM's doc comment) -- the letter's real fitted size is authoredScale
        // below. Set to the fitted height anyway so it reads sensibly in any UI that displays it.
        height: r.scaledBoundingBox.heightMm,
        textMode: DEFAULT_TEXT_MODE,
        stoneSize: stoneSizeMm,
        gap: gapMm,
        color: resolvedColor,
        // MONO-005A: the persisted, position-only authored-font scale (see GeometryEngine.
        // generateTextLayout()'s own authoredScale doc comment) -- this is what makes the letter's
        // fitted size reproducible through the normal generation path, verified above via this
        // exact letter's own round-trip check.
        authoredScale: r.requestedScale,
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
        // MONO-005A: computed under the real text-layer placement contract (canvas-centered + this
        // offset -- see this method's own doc comment), not a raw frameRect-space coordinate.
        x: r.layerXMm,
        y: r.layerYMm
      }));

    const layers = [frameLayerObj, ...letterLayerObjs];

    const measurements = {
      frameId,
      layoutId,
      frameRect: normalizedFrameRect,
      frameInteriorRect,
      canvasMm: normalizedCanvasMm,
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
        stoneCount: r.stones.length,
        xMm: r.layerXMm,
        yMm: r.layerYMm
      })),
      frameStoneCount: frameLayout.stones.length,
      letterStoneCount: allLetterStones.length,
      totalStoneCount: frameLayout.stones.length + allLetterStones.length
    };

    const diagnostics = {
      productionSpacingMm: requiredSpacingMm,
      collisions: { letterCollision: false, frameCollision: false },
      roundTripVerified: true
    };

    return { ok: true, layers, measurements, diagnostics };
  }
}
