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

import { getFrameDefinition, computeFrameInterior, computeFrameFitRect, resolveFrameForStoneWidth } from '../geometry/FrameLibrary.js';
import { computeMonogramLayout, MONOGRAM_LAYOUTS, MONOGRAM_LAYOUT_FAILURE_REASONS } from './MonogramLayouts.js';
import {
  Stone,
  DEFAULT_STONE_COLOR,
  TEXT_SCALE_FAILURE_REASONS,
  AUTHORED_FONT_FITTING_GAP_MM,
  MIN_HEIGHT_TO_STONE_RATIO,
  findCrossGroupCollisions,
  weightSizeMm,
  TRACKING_XPITCH_LADDER
} from '../geometry/index.js';
import { computeTextLayerPositionForTargetCenterMm } from '../editing/index.js';
// MONO-012: single-chain sizing arithmetic for OpenType script fonts. Pure arithmetic, no geometry
// or sampling -- see SingleChain.js's own doc comment.
import {
  SINGLE_CHAIN_MIN_RATIO,
  MONOGRAM_MAX_STEM_WIDTH_RATIO,
  singleChainHeightMm,
  minChainStones,
  isMonogramEligibleStemWidthRatio
} from './SingleChain.js';

// Reason codes generate() returns on failure -- a caller branches on these, never on message text
// (same convention as MONOGRAM_LAYOUT_FAILURE_REASONS/TEXT_SCALE_FAILURE_REASONS this module itself
// consumes). See generate()'s own doc comment for which pipeline step produces each one.
export const MONOGRAM_GENERATOR_FAILURE_REASONS = Object.freeze({
  INVALID_INPUT: 'invalid-input',
  FRAME_NOT_FOUND: 'frame-not-found',
  LAYOUT_NOT_FOUND: 'layout-not-found',
  UNSUPPORTED_LETTER_COUNT: 'unsupported-letter-count',
  INVALID_FONT: 'invalid-font',
  // MONO-012: an eligible OpenType script font whose single-chain letter, once shrunk to fit its
  // slot, no longer has enough stones across its stem to read as a continuous chain -- see
  // SingleChain.js's minChainStones() for the two bounds this checks against. The message names
  // which bound bound.
  CHAIN_TOO_THIN: 'chain-too-thin',
  FITTING_FAILED: 'fitting-failed',
  BELOW_MINIMUM_SCALE: 'below-minimum-scale',
  LETTER_COLLISION: 'letter-collision',
  FRAME_COLLISION: 'frame-collision',
  // MONO-008: frameOptions.stoneWidth (1 or 2) could not be honored at this frame size/stone
  // spacing -- see FrameLibrary.resolveFrameForStoneWidth()'s own 'frame-too-small' reason.
  STONE_WIDTH_UNAVAILABLE: 'stone-width-unavailable',
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

// MONO-014: the frame id that carries no border at all (a real FrameLibrary catalog entry with null
// contours -- see FrameLibrary.js). generate() branches on this before every FrameLibrary geometry
// call.
const NO_FRAME_ID = 'none';

// MONO-014: classify the frame's applied stone size against the letters' own. 'equal' is the state
// the hierarchy rule forbids for the automatic path -- it is only reachable when a caller
// deliberately passes frameOptions.stoneSizeMm equal to request.stoneSizeMm (the MONO-010 toggle
// checked and matched by hand). app.js's automatic hierarchy always picks one catalog rung larger,
// and generateMonogramWithFrameAutoShrink() filters the letters' own diameter out of its retry
// candidates, so neither of those paths can produce 'equal'. Compared with an epsilon, not ===,
// because both values are catalog floats (user-typed history, imported projects, catalog rounding)
// and exact equality would be fragile against that drift.
const FRAME_HIERARCHY_EPSILON_MM = 1e-6;
function classifyFrameHierarchy(frameStoneSizeMm, letterStoneSizeMm) {
  const deltaMm = frameStoneSizeMm - letterStoneSizeMm;
  if (Math.abs(deltaMm) <= FRAME_HIERARCHY_EPSILON_MM) return 'equal';
  return deltaMm > 0 ? 'dominant' : 'subordinate';
}

// MONO-012: OpenType letters are resized by regenerating at a smaller heightMm, not by a linear
// position scale -- the outline sampler's fixed per-edge stone halo (stoneSizeMm/2) does not shrink
// with heightMm, so one division does not land the bounding box exactly inside the slot. A few
// regenerate-and-remeasure passes converge; 6 is well beyond what any real letter/slot pair needs.
const MAX_OPENTYPE_FIT_ITERATIONS = 6;
// MONO-012: the emitted heightMode for OpenType monogram letters. app.js's buildTextLayoutBaseParams()
// passes layer.height straight through as the engine's em-square heightMm regardless of heightMode
// (heightMode is a TXT-104 UI-display concept, not a geometry input), and singleChainHeightMm()
// returns exactly that em-square height -- so 'raw' is the value that describes layer.height
// correctly. 'capHeight' would additionally break the Letter Height affordance for the eligible
// fonts that carry no capHeightRatio (all but Sacramento and Dancing Script).
const OPENTYPE_LETTER_HEIGHT_MODE = 'raw';

// MONO-006E: bounds on the group aspect ratio derived from the letters themselves (see
// computeGroupAspectRatio() below) before it is handed to FrameLibrary's computeFrameFitRect().
// Purely a numerical safety clamp against a pathological natural bounding box (e.g. a
// near-zero-width letter) driving the search toward an unusable, degenerate rectangle -- not a
// design choice about how wide or tall a real monogram may be.
const MIN_GROUP_ASPECT_RATIO = 0.15;
const MAX_GROUP_ASPECT_RATIO = 6;

// MONO-006E: a fixed square probe box used only to learn a layout's own slot *proportions*
// (MonogramLayouts' ratios are always expressed as fractions of frameInteriorRect's own
// width/height -- see that module's own doc comment) independent of any real frame size. Its
// absolute value never matters -- only the resulting slots' own width/height ratios do.
const PROBE_BOX_MM = { xMm: 0, yMm: 0, widthMm: 1000, heightMm: 1000 };

/**
 * MONO-006E: derives the aspect ratio (width/height) the frame's own fitting rectangle should be
 * requested at, from the letters actually being placed -- implementing this milestone's "the frame
 * should fit the letters, not the opposite" objective, rather than the frame's own raw interior
 * bounding box aspect (always ~1:1 for a symmetric frame like Circle/Diamond/Oval, which wastes
 * most of a wide multi-letter group's real footprint -- see this module's own audit notes).
 *
 * For slot i, the box aspect ratio that would make that slot's own shape exactly match letter i's
 * natural aspect ratio is `(naturalWidth_i / naturalHeight_i) * (slot_i.heightRatio /
 * slot_i.widthRatio)` (probeSlots' targetRect, measured against the square PROBE_BOX_MM, *is* that
 * ratio pair directly). Different letters rarely share one exact natural aspect ratio, so the
 * geometric mean across every slot is used as the single best-compromise box aspect ratio -- a
 * plain arithmetic mean would let one unusually wide or narrow letter dominate the result
 * disproportionately; the geometric mean treats "wants the box twice as wide" and "wants it half
 * as wide" symmetrically.
 *
 * @param {Array<{naturalBoundingBox: import('../text/VectorPath.js').BoundingBox}>} letterEntries
 *   indexed identically to probeSlots[i].index.
 * @param {Array<{index:number, targetRect:{widthMm:number,heightMm:number}}>} probeSlots
 * @returns {number} A positive finite aspect ratio, clamped to
 *   [MIN_GROUP_ASPECT_RATIO, MAX_GROUP_ASPECT_RATIO].
 */
function computeGroupAspectRatio(letterEntries, probeSlots) {
  let logSum = 0;
  let count = 0;
  for (const slot of probeSlots) {
    const entry = letterEntries[slot.index];
    if (!entry) continue;
    const { naturalBoundingBox } = entry;
    if (!(naturalBoundingBox.widthMm > 0) || !(naturalBoundingBox.heightMm > 0)) continue;
    if (!(slot.targetRect.widthMm > 0) || !(slot.targetRect.heightMm > 0)) continue;
    const naturalAspect = naturalBoundingBox.widthMm / naturalBoundingBox.heightMm;
    const slotRatioAspect = slot.targetRect.widthMm / slot.targetRect.heightMm; // fraction-of-box aspect (PROBE_BOX_MM is square)
    const impliedBoxAspect = naturalAspect / slotRatioAspect;
    if (!(impliedBoxAspect > 0) || !Number.isFinite(impliedBoxAspect)) continue;
    logSum += Math.log(impliedBoxAspect);
    count += 1;
  }
  if (count === 0) return 1;
  const aspect = Math.exp(logSum / count);
  return Math.min(MAX_GROUP_ASPECT_RATIO, Math.max(MIN_GROUP_ASPECT_RATIO, aspect));
}

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

// MONO-016: validate the shared "Letter spacing" request param. One value, an asymmetric range by
// layout:
//   - script:       [-pitchMm, topRung x pitchMm]
//   - slot layouts: [0,        topRung x pitchMm]
// pitchMm is the monogram's own stone pitch (stoneSizeMm + gapMm == requiredSpacingMm). topRung is
// TRACKING_XPITCH_LADDER's last entry (4) -- the same ceiling app.js's letterSpacingBoundsMm() gives
// an ordinary text layer's #letterSpacing and the same one the monogram slider is clamped to; only
// that multiplier is borrowed from the ladder.
//
// The floor differs, and for a hard reason on each side, not aesthetics:
//   - script: -pitchMm is EXACT because the emitted layer persists the value as `layer.letterSpacing`
//     and app.js's writeSelectedControlsToLayer() re-clamps that to letterSpacingBoundsMm().minMm
//     (= -pitchMm) on every text-control write with NO undo entry (READ-006's documented silent
//     clamp, MONO-013 §4). A wider negative range would silently un-interlock the mark the first
//     time the user touched any text control.
//   - slot layouts: 0 because minGapMm is the real production stone-to-stone clearance (MONO-006E) --
//     below it, stones from adjacent letters physically collide. A negative request is REJECTED here
//     (INVALID_INPUT, naming the clearance), never silently clamped to 0; silent clamp-back is
//     exactly what letterSpacingBoundsMm()'s own comment exists to prevent.
// Returns { ok: true, value } or { ok: false, failure } (a structured generate() failure result).
function resolveLetterSpacingRequest(rawValue, pitchMm, isScript, R) {
  const value = (rawValue === undefined || rawValue === null) ? 0 : rawValue;
  const maxMm = TRACKING_XPITCH_LADDER[TRACKING_XPITCH_LADDER.length - 1] * pitchMm;
  const minMm = isScript ? -pitchMm : 0;
  if (typeof value !== 'number' || !Number.isFinite(value) || value > maxMm || value < minMm) {
    const floorClause = isScript
      ? `${minMm} = one stone pitch of overlap`
      : `0 -- a slot layout cannot go below its ${pitchMm.toFixed(2)} mm production stone-to-stone clearance without adjacent letters' stones colliding`;
    return {
      ok: false,
      failure: failure(R.INVALID_INPUT, `letterSpacingMm must be a number in [${minMm}, ${maxMm}] (0 = letters at their natural spacing; ${floorClause}); got ${JSON.stringify(rawValue)}.`)
    };
  }
  return { ok: true, value };
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
   * does not fit is a structured failure, not a silently adjusted result. (MONO-011: a caller's UI
   * layer may itself retry generate() with an adjusted request.frameOptions.stoneSizeMm after a
   * FRAME_COLLISION/STONE_WIDTH_UNAVAILABLE failure -- this generator still never adjusts anything
   * on its own; each retry is an ordinary, independent call.)
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
   * @param {string} request.fontId An authored (stoneCenters-based) font, or -- MONO-012 -- an
   *   enabled OpenType font whose `stemWidthRatio` is thin enough for a single-chain letter to
   *   clear the readability floor (see SingleChain.js's isMonogramEligibleStemWidthRatio()). An
   *   OpenType font failing that gate, or one with a missing/non-numeric `request.stemWidthRatio`,
   *   is rejected with INVALID_FONT.
   * @param {number} [request.stemWidthRatio] MONO-012: the font's measured stroke-width fraction
   *   (manifest `stemWidthRatio`). Required for a non-authored font; ignored for authored fonts.
   * @param {string} [request.providerId]
   * @param {number[]} [request.weightSizesMm] MONO-015: opt in to weight-following stone size for
   *   the letters (OpenType fonts only). The graduated weight step's ascending mm diameters --
   *   `[base, one rung up]` for step 1, `[base, one rung up, two rungs up]` for step 2, derived by
   *   the caller from `src/renderer/StoneSizes.js`'s `stoneSizesFromBaseMm()`. Absent or empty is
   *   the pre-MONO-015 uniform path, unchanged.
   * @param {number} [request.letterSpacingMm] MONO-016: the shared "Letter spacing" control. Default
   *   0 (letters at their natural spacing). One value, two implementations: for the 'script' layout
   *   it is glyph tracking inside the interlocked string, range `[-pitchMm, 4 x pitchMm]`; for the
   *   four slot layouts it is an additive term on the inter-slot gap, range `[0, 4 x pitchMm]` (a
   *   slot layout cannot go negative -- below the production stone-to-stone clearance adjacent
   *   letters' stones collide). `pitchMm = stoneSizeMm + gapMm`; an out-of-range value is
   *   INVALID_INPUT. MONO-013 shipped this as `interlockMm` (script-only, negative-only); renamed.
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
   * @param {{mode?:string,color?:string,stoneWidth?:number,stoneSizeMm?:number}} [request.frameOptions]
   *   Frame-specific overrides; mode defaults to 'fill' (a solid stone band), color falls back to
   *   request.color. MONO-010: stoneSizeMm falls back to the shared request.stoneSizeMm when
   *   omitted -- when supplied, it drives only the frame's own stone pitch and its collision
   *   threshold against the letters; it never affects the letters' own required interior clearance
   *   (see this method's own comment at requiredSpacingMm/frameRequiredSpacingMm for why).
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
      frameRect, canvasMm, frameOptions = {},
      // MONO-012: the font's measured stroke-width fraction (assets/fonts/manifest.json's
      // stemWidthRatio, surfaced onto the FontManager record). Required only for a non-authored
      // (OpenType) font -- authored stone-center fonts have no vector stem and never read it.
      stemWidthRatio,
      // MONO-016: the shared "Letter spacing" control, in mm. Optional, default 0. One value, two
      // implementations by layout: for 'script' it is glyph tracking inside the single interlocked
      // string (emitted as the layer's `letterSpacing`), range [-pitchMm, 4 x pitchMm]; for the four
      // slot layouts it is an additive term on the inter-slot gap (fed to computeMonogramLayout as
      // `extraGapMm`), range [0, 4 x pitchMm] -- a slot layout cannot go negative because below the
      // production stone-to-stone clearance adjacent letters' stones collide. pitchMm = stoneSizeMm +
      // gapMm (== requiredSpacingMm). Validated per-branch below. (MONO-013 shipped this as
      // `interlockMm`, script-only and negative-only; renamed outright, nothing shipped outside this
      // repo.)
      letterSpacingMm,
      // MONO-015: opt-in weight-following stone size for the letters (OpenType fonts only). Absent
      // or empty and every path below is the exact pre-MONO-015 uniform path, unchanged. When set,
      // the letter generateTextLayout() calls request sizeMode 'weight' with this flat step array
      // and the emitted text layer persists it.
      weightSizesMm
    } = request || {};
    // MONO-015: a compact bundle threaded through ctx and every letter generateTextLayout() call.
    const weightParams = (Array.isArray(weightSizesMm) && weightSizesMm.length > 0)
      ? { sizeMode: 'weight', weightSizesMm }
      : null;
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
    // MONO-010: validated the same way the top-level stoneSizeMm is above -- if a caller supplies
    // frameOptions.stoneSizeMm at all, it must be a positive finite number. Omitted entirely is fine
    // (falls back to the shared stoneSizeMm below); only an explicitly-supplied bad value is rejected.
    if (frameOptions.stoneSizeMm !== undefined
      && (typeof frameOptions.stoneSizeMm !== 'number' || !Number.isFinite(frameOptions.stoneSizeMm) || frameOptions.stoneSizeMm <= 0)) {
      return failure(R.INVALID_INPUT, 'frameOptions.stoneSizeMm must be a positive finite number when provided.');
    }

    // 1. Resolve FrameLibrary.
    let frame;
    try {
      frame = getFrameDefinition(frameId);
    } catch {
      return failure(R.FRAME_NOT_FOUND, `Unknown frame id ${JSON.stringify(frameId)}.`);
    }
    // MONO-014: "No frame" -- the letterform is the whole ornament. Every FrameLibrary geometry
    // call below (resolveFrameForStoneWidth / computeFrameInterior / computeFrameFitRect /
    // generatePathLayout) is guarded on this, because the 'none' definition has null contours; the
    // requested frameRect is used as the letter-layout region directly, no frame-role layer is
    // emitted, and the letter-vs-frame collision check is skipped (there are no frame stones).
    // Letter fitting, the MONO-012 single-chain branch, and letter-vs-letter collision are all
    // unchanged.
    const isNoFrame = frameId === NO_FRAME_ID;

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

    // MONO-010: independent frame stone size. stoneSizeMm drives three things in this module: the
    // frame's interior erosion (computeFrameInterior/computeFrameFitRect below, via
    // requiredSpacingMm -- how much room is cleared inside the frame for letters), the letter<->frame
    // collision threshold, and the frame's own stone pitch. Once frame and letters can differ in
    // size, only the latter two switch to the frame's own size -- interior erosion deliberately stays
    // keyed to requiredSpacingMm (the letters' own stoneSizeMm+gapMm, computed above and left
    // untouched), because that value determines how much room the *letters* physically need to be
    // placed and fitted legally -- the frame's own stone size has no bearing on that. Collision
    // safety is still fully guaranteed independent of this choice: findCrossGroupCollisions() (used
    // below) computes each colliding pair's own touching threshold as (stoneA.d + stoneB.d) / 2, so a
    // large-stone frame around small-stone letters (or vice versa) is still correctly flagged if they
    // would actually touch, even though the erosion step above never considered the frame's size.
    //
    // Computed here, before resolveFrameForStoneWidth() below, because that call's own row-offset
    // spacing must match the frame's own pitch (frameRequiredSpacingMm), not the letters' -- a larger
    // frame stone size than requiredSpacingMm would otherwise offset the outline's two rows too
    // closely, and cross-contour stone dedup would silently delete the entire second row.
    const frameStoneSizeMm = (typeof frameOptions.stoneSizeMm === 'number' && Number.isFinite(frameOptions.stoneSizeMm) && frameOptions.stoneSizeMm > 0)
      ? frameOptions.stoneSizeMm
      : stoneSizeMm;
    const frameRequiredSpacingMm = frameStoneSizeMm + gapMm;

    // MONO-008: when the caller requests a specific outline stone-width for the frame's own border
    // (1 or 2 rows at real production spacing, instead of the fixed DEFAULT_INNER_RATIO band),
    // resolve that geometry now, before any frame-interior/fitting computation below, so every
    // remaining use of the frame's geometry -- the interior erosion just below, the fit-rect
    // inscribing in step 4, and the final frame generation at the bottom of this method -- is
    // consistent with the border actually traced. `frame` itself is left untouched (its label/
    // category/etc. are still the catalog entry); `effectiveFrame` is what every geometry call below
    // uses instead.
    let effectiveFrame = frame;
    if (!isNoFrame && (frameOptions.stoneWidth === 1 || frameOptions.stoneWidth === 2)) {
      // The row offset must match the frame's own pitch, not the letters' -- a larger frame stone
      // size dedupes the second row away if offset by the (smaller) letters' requiredSpacingMm.
      const stoneWidthResult = resolveFrameForStoneWidth(frame, frameOptions.stoneWidth, frameRequiredSpacingMm, normalizedFrameRect.widthMm, normalizedFrameRect.heightMm);
      if (!stoneWidthResult.ok) {
        return failure(R.STONE_WIDTH_UNAVAILABLE, stoneWidthResult.message);
      }
      effectiveFrame = stoneWidthResult.frame;
    }

    // 2. Cheap up-front checks, before generating any letters: does this frame have any usable
    // interior at all at this stone size (independent of layout), and is layoutId/letterCount
    // structurally valid? Both failures are reported without needing a real font/letters, matching
    // this generator's own established failure-priority order (frame -> layout -> font/fitting).
    if (!isNoFrame) {
      const { boundingBox: interiorBoundingBox } = computeFrameInterior(effectiveFrame, normalizedFrameRect, requiredSpacingMm);
      if (!interiorBoundingBox) {
        return failure(R.FITTING_FAILED, `Frame ${JSON.stringify(frameId)}'s interior is empty for the given frameRect and stoneSizeMm ${stoneSizeMm}/gapMm ${gapMm} (frame too small for its required production clearance).`);
      }
    }
    const probeLayoutResult = computeMonogramLayout({ layoutId, frameInteriorRect: PROBE_BOX_MM, letterCount: letters.length });
    if (!probeLayoutResult.ok) {
      const reason = probeLayoutResult.reason === MONOGRAM_LAYOUT_FAILURE_REASONS.UNKNOWN_LAYOUT ? R.LAYOUT_NOT_FOUND
        : probeLayoutResult.reason === MONOGRAM_LAYOUT_FAILURE_REASONS.UNSUPPORTED_LETTER_COUNT ? R.UNSUPPORTED_LETTER_COUNT
        : R.INVALID_INPUT;
      return failure(reason, probeLayoutResult.message);
    }

    // MONO-016: validate the shared "Letter spacing" control now that the layout is known to be
    // structurally valid (frame -> layout -> spacing -> font, this module's failure-priority order).
    // The resolved value feeds one of two sinks below: the script branch's emitted `letterSpacing`,
    // or the slot path's computeMonogramLayout `extraGapMm`. requiredSpacingMm is the monogram's own
    // stone pitch (stoneSizeMm + gapMm).
    const isScriptLayout = layoutId === MONOGRAM_LAYOUTS.SCRIPT;
    const letterSpacingResolution = resolveLetterSpacingRequest(letterSpacingMm, requiredSpacingMm, isScriptLayout, R);
    if (!letterSpacingResolution.ok) return letterSpacingResolution.failure;
    const resolvedLetterSpacingMm = letterSpacingResolution.value;

    // MONO-012: detect authored (stone-center) vs OpenType (sampled) once -- every letter shares one
    // font. Authored fonts ignore heightMm and are resized only by scaleAuthoredTextLayout()
    // (MONO-002); OpenType fonts are outline-sampled and are resized by regenerating at a smaller
    // heightMm (see step 6). A cheap single-character probe distinguishes them via sourceMode.
    let detectLayout;
    try {
      detectLayout = await this._engine.generateTextLayout({
        text: letters[0], fontId, providerId, layerId: `monogram-${frameId}-${layoutId}-detect`,
        heightMm: PLACEHOLDER_HEIGHT_MM, stoneSizeMm, gapMm: 0, mode: 'outline',
        color: resolvedColor, curveEnabled: false
      });
    } catch (error) {
      return failure(R.INVALID_FONT, `Failed to generate letter ${JSON.stringify(letters[0])} with font ${JSON.stringify(fontId)}: ${error.message}`);
    }
    const fontIsAuthored = detectLayout.sourceMode === 'authored';

    // MONO-012: the picker (app.js monogramEligibleFonts()) already restricts the offered set, but
    // this is the generator's own authoritative gate -- a below-floor monogram must be structurally
    // unreachable, not merely un-offered. A single-chain letter's height-to-stone ratio is
    // SINGLE_CHAIN_STEM_RATIO / stemWidthRatio, independent of stone size, so this is one check, not
    // one per size. Missing/non-numeric stemWidthRatio names the field; a too-thick ratio names the
    // measured value and the threshold. Both take the INVALID_FONT path, like the other font
    // rejections here.
    if (!fontIsAuthored) {
      if (typeof stemWidthRatio !== 'number' || !Number.isFinite(stemWidthRatio) || stemWidthRatio <= 0) {
        return failure(R.INVALID_FONT, `Font ${JSON.stringify(fontId)} is an OpenType font, so request.stemWidthRatio is required to size a single-chain monogram letter, but it is missing or not a positive number (got ${JSON.stringify(stemWidthRatio)}).`);
      }
      if (!isMonogramEligibleStemWidthRatio(stemWidthRatio)) {
        return failure(R.INVALID_FONT, `Font ${JSON.stringify(fontId)} has a measured stemWidthRatio of ${stemWidthRatio}, above the ${MONOGRAM_MAX_STEM_WIDTH_RATIO} maximum for a single-chain monogram letter that still clears the readability floor. Choose a thinner-stemmed font.`);
      }
    }

    // MONO-013: the 'script' layout is a completely separate branch -- one interlocked string, not
    // per-letter slots. It reuses everything computed above (frame resolution, effectiveFrame,
    // interior sanity check, the authored/OpenType detect probe, the eligibility gate) but replaces
    // steps 3-8. The four pre-existing layouts never reach it, so their output is byte-identical to
    // before this milestone.
    if (isScriptLayout) {
      return this._generateScriptMonogram({
        R, frame, frameId, isNoFrame, effectiveFrame,
        normalizedFrameRect, normalizedCanvasMm, resolvedColor,
        stoneSizeMm, gapMm, requiredSpacingMm,
        frameStoneSizeMm, frameRequiredSpacingMm, frameOptions,
        fontId, providerId, letters, layoutId, fontIsAuthored, stemWidthRatio,
        letterSpacingMm: resolvedLetterSpacingMm, weightParams
      });
    }

    // 3. Generate every letter's natural (unscaled) layout up front -- MONO-006E: "the frame should
    // fit the letters, not the opposite". Each letter's own natural width/height is needed *before*
    // the frame's fitting rectangle is sized, so that rectangle's own aspect ratio can be shaped
    // around what these specific letters actually need (see computeGroupAspectRatio() below), rather
    // than an arbitrary shape independent of them. For an authored font "natural" is the font's own
    // authored size (heightMm a no-op); for an OpenType font it is the ideal single-chain height
    // (singleChainHeightMm()) sampled with the request's real gap.
    const naturalHeightMm = fontIsAuthored
      ? PLACEHOLDER_HEIGHT_MM
      : singleChainHeightMm({ stoneSizeMm, stemWidthRatio });
    const naturalGapMm = fontIsAuthored ? 0 : gapMm;
    const letterEntries = [];
    for (let i = 0; i < letters.length; i++) {
      const letter = letters[i];
      const letterLayerId = `monogram-${frameId}-${layoutId}-letter-${i}`;

      let baseLayout;
      try {
        baseLayout = await this._engine.generateTextLayout({
          text: letter,
          fontId,
          providerId,
          layerId: letterLayerId,
          heightMm: naturalHeightMm,
          stoneSizeMm,
          gapMm: naturalGapMm,
          mode: 'outline',
          color: resolvedColor,
          curveEnabled: false
        });
      } catch (error) {
        return failure(R.INVALID_FONT, `Failed to generate letter ${JSON.stringify(letter)} with font ${JSON.stringify(fontId)}: ${error.message}`);
      }

      if (fontIsAuthored && baseLayout.sourceMode !== 'authored') {
        // Should be unreachable (fontIsAuthored came from the same font), but a font whose glyphs
        // disagree on authoredness is a real defect, not a fitting failure.
        return failure(R.INVALID_FONT, `Font ${JSON.stringify(fontId)} produced a non-authored layout for letter ${JSON.stringify(letter)} (got sourceMode ${JSON.stringify(baseLayout.sourceMode)}).`);
      }

      const naturalBoundingBox = baseLayout.getBoundingBox();
      if (!naturalBoundingBox) {
        return failure(R.FITTING_FAILED, `Letter ${JSON.stringify(letter)} produced no stones for font ${JSON.stringify(fontId)}.`);
      }

      letterEntries.push({ letter, letterLayerId, baseLayout, naturalBoundingBox });
    }

    // 4. Compute the frame's real fitting rectangle -- clearance-eroded (never the stone band
    // itself; FrameLibrary's own MONO-001A doc comment) and inscribed inside the frame's true
    // (possibly curved) interior boundary (MONO-003's computeFrameFitRect(), so a round/diamond
    // frame's corners can never be poked past -- MONO-006C's fix, still in force). Its aspect ratio
    // is now driven by the letters themselves (MONO-006E) instead of the frame's own raw interior
    // bounding box (always ~1:1 for a symmetric frame), so a wide multi-letter layout genuinely
    // unlocks more of a round/diamond frame's real footprint than a forced-square region would.
    let frameInteriorRect;
    if (isNoFrame) {
      // MONO-014: no border to inscribe a fitting rectangle inside -- the requested frameRect is the
      // letter-layout region directly. The per-slot minGapMm floor (step 5) and the letter-vs-letter
      // collision check (step 7) still guarantee production-legal spacing between letters.
      frameInteriorRect = {
        xMm: normalizedFrameRect.xMm,
        yMm: normalizedFrameRect.yMm,
        widthMm: normalizedFrameRect.widthMm,
        heightMm: normalizedFrameRect.heightMm
      };
    } else {
      const groupAspectRatio = computeGroupAspectRatio(letterEntries, probeLayoutResult.slots);
      const inscribedInteriorRect = computeFrameFitRect(effectiveFrame, normalizedFrameRect, groupAspectRatio, requiredSpacingMm);
      if (!inscribedInteriorRect) {
        return failure(R.FITTING_FAILED, `Frame ${JSON.stringify(frameId)} has no usable rectangular interior region for the given frameRect and stoneSizeMm ${stoneSizeMm}/gapMm ${gapMm}.`);
      }
      frameInteriorRect = {
        xMm: inscribedInteriorRect.xMm,
        yMm: inscribedInteriorRect.yMm,
        widthMm: inscribedInteriorRect.widthMm,
        heightMm: inscribedInteriorRect.heightMm
      };
    }

    // 5. Compute the real, absolute layout slots inside that letter-shaped fitting rectangle.
    // MONO-006E: minGapMm enforces the real production clearance as an absolute mm floor on the
    // gap between adjacent slots (never merely a fraction of the interior's own width, which could
    // fall well short of requiredSpacingMm for a small frame) -- this is a geometry-level guarantee
    // that adjacent letters (now fit to fill their own slot, see step 6 below) have production-legal
    // room between them, not merely a hope that collision detection (still fully active, step 8)
    // happens to pass.
    // MONO-016: extraGapMm is the shared "Letter spacing" control's slot-layout sink -- an additive
    // term ON TOP of the minGapMm floor (validated >= 0 above). At 0 this call is byte-identical to
    // pre-MONO-016.
    const layoutResult = computeMonogramLayout({ layoutId, frameInteriorRect, letterCount: letters.length, minGapMm: requiredSpacingMm, extraGapMm: resolvedLetterSpacingMm });
    if (!layoutResult.ok) {
      const reason = layoutResult.reason === MONOGRAM_LAYOUT_FAILURE_REASONS.UNKNOWN_LAYOUT ? R.LAYOUT_NOT_FOUND
        : layoutResult.reason === MONOGRAM_LAYOUT_FAILURE_REASONS.UNSUPPORTED_LETTER_COUNT ? R.UNSUPPORTED_LETTER_COUNT
        : layoutResult.reason === MONOGRAM_LAYOUT_FAILURE_REASONS.INSUFFICIENT_SPACE ? R.FITTING_FAILED
        : R.INVALID_INPUT;
      return failure(reason, layoutResult.message);
    }
    const slotByIndex = new Map(layoutResult.slots.map((slot) => [slot.index, slot]));

    const frameLayerId = `monogram-${frameId}-${layoutId}-frame`;
    // MONO-008: stoneWidth only has meaning for outline-mode row tracing (resolveFrameForStoneWidth()
    // already produced exactly-one/exactly-two contours built for that mode), so requesting it forces
    // the frame's own generation mode to 'outline' regardless of frameOptions.mode -- not a new
    // validation error path, just an override.
    const frameMode = (frameOptions.stoneWidth === 1 || frameOptions.stoneWidth === 2)
      ? 'outline'
      : (VECTOR_FILL_MODES.has(frameOptions.mode) ? frameOptions.mode : DEFAULT_FRAME_MODE);
    const frameColor = (typeof frameOptions.color === 'string' && frameOptions.color.length > 0)
      ? frameOptions.color
      : resolvedColor;

    // 6. + 7. Fit every letter into its assigned slot, then verify it round-trips.
    const letterResults = [];
    for (let i = 0; i < letters.length; i++) {
      const { letter, letterLayerId, baseLayout, naturalBoundingBox } = letterEntries[i];
      const slot = slotByIndex.get(i);

      if (!fontIsAuthored) {
        // MONO-012: OpenType single-chain letter. It is resized by regenerating at a smaller
        // heightMm -- never a position scale -- starting from the ideal single-chain height
        // (singleChainHeightMm()) and shrinking only when the outline-sampled bounding box overflows
        // the slot. It never grows past the ideal height.
        //
        // The shrink ratio subtracts the fixed per-edge stone halo (stoneSizeMm, once for each of
        // the two edges) from both the current box and the target before dividing -- the same
        // halo-aware reasoning the authored branch documents below, because the outline sampler's
        // halo does not scale with heightMm and a naive slot/box ratio would systematically
        // under-shrink. `fittedLayout`/`fittedBox` always correspond to the current fitHeightMm at
        // the moment the loop exits (the last iteration accepts its own measurement rather than
        // shrinking once more with no follow-up regenerate), so the round-trip check below compares
        // like with like.
        const haloMm = stoneSizeMm;
        let fitHeightMm = singleChainHeightMm({ stoneSizeMm, stemWidthRatio });
        let fittedLayout = null;
        let fittedBox = null;
        for (let iter = 0; iter < MAX_OPENTYPE_FIT_ITERATIONS; iter++) {
          try {
            fittedLayout = await this._engine.generateTextLayout({
              text: letter, fontId, providerId, layerId: letterLayerId,
              heightMm: fitHeightMm, stoneSizeMm, gapMm, mode: 'outline',
              color: resolvedColor, curveEnabled: false,
              // MONO-015: weightParams is null unless the request opted in -- then this is the exact
              // sizeMode 'weight' call a live text layer would make with the persisted step array.
              ...(weightParams || {})
            });
          } catch (error) {
            return failure(R.INVALID_FONT, `Letter ${JSON.stringify(letter)} (slot ${i}) could not be generated with font ${JSON.stringify(fontId)} at heightMm ${fitHeightMm}: ${error.message}`);
          }
          fittedBox = fittedLayout.getBoundingBox();
          if (!fittedBox) {
            return failure(R.FITTING_FAILED, `Letter ${JSON.stringify(letter)} produced no stones for font ${JSON.stringify(fontId)}.`);
          }
          if (iter === MAX_OPENTYPE_FIT_ITERATIONS - 1) break;
          const shrinkCandidates = [];
          if (fittedBox.widthMm - haloMm > 0) shrinkCandidates.push((slot.targetRect.widthMm - haloMm) / (fittedBox.widthMm - haloMm));
          if (fittedBox.heightMm - haloMm > 0) shrinkCandidates.push((slot.targetRect.heightMm - haloMm) / (fittedBox.heightMm - haloMm));
          if (shrinkCandidates.length === 0) {
            shrinkCandidates.push(slot.targetRect.widthMm / fittedBox.widthMm, slot.targetRect.heightMm / fittedBox.heightMm);
          }
          const shrink = Math.min(...shrinkCandidates);
          if (shrink >= 1) break;   // fits its slot -- never grow
          fitHeightMm *= Math.max(shrink, 1e-3);   // shrink only, then remeasure
        }

        // MONO-012: shrinking to fit dragged R (heightMm / stoneSizeMm), and with it the stem-stone
        // count, downward. If the fitted letter no longer has enough stones across its stem to read
        // as a continuous chain, fail -- naming whichever of the two bounds bound (see
        // SingleChain.minChainStones()). Expect this shrink-then-check path to be the normal path,
        // not an edge case: ideal single-chain heights are large relative to typical slots.
        // MONO-015: `achievedStemStones = stemWidthMm / (stone assigned at that width)`. Uniform:
        // the stone is stoneSizeMm everywhere, so this is stemStones()'s R*stemWidthRatio identity
        // unchanged. Weight sizing: the stem gets whatever weightSizeMm() assigns at its own width,
        // so divide by that -- NOT by the smallest step diameter (would make the gate silently
        // permissive) or the largest (arbitrarily strict). Enabling weight sizing may legitimately
        // push a thin-stemmed letter into CHAIN_TOO_THIN; that is correct, not a regression.
        const stemWidthMm = stemWidthRatio * fitHeightMm;
        const stemStoneMm = weightParams
          ? weightSizeMm(stemWidthMm, weightParams.weightSizesMm)
          : stoneSizeMm;
        const achievedStemStones = stemWidthMm / stemStoneMm;
        const minStones = minChainStones({ stemWidthRatio });
        // MONO-018: the single-chain minimum gate is HOISTED OUT of this loop. A sub-floor letter is
        // recorded (belowFloor) and fitting continues, so on failure the BINDING (thinnest) letter
        // is reported rather than the first sub-floor letter in slot order -- whose identity, and
        // therefore the quoted stem figure, shifts with frame size and reads as non-monotone (the
        // MONO-017 diagnosis; docs/specifications/MONO-018-BindingLetter.md). The gate itself runs
        // after the loop. Every OTHER failure here -- INVALID_FONT (~L754), FITTING_FAILED (~L759)
        // -- still fails fast; only CHAIN_TOO_THIN defers. CHAIN_TOO_THIN emits no geometry either
        // way, so no successful layout moves.
        const belowFloor = achievedStemStones < minStones;

        // No internal round-trip regeneration here (unlike the authored branch): the fitted layout
        // above IS a plain GeometryEngine.generateTextLayout() call with the request's real gap and
        // mode, and every persisted field (heightMm=fitHeightMm, stoneSize, gap, textMode 'stroke'
        // -> outline) is exactly what a live render feeds back into the same deterministic call, so a
        // second call would only ever re-derive the same stones. The authored branch's round-trip
        // earns its extra sample because it checks that scaleAuthoredTextLayout()'s transform applied
        // via authoredScale reproduces the transform applied directly -- two genuinely different
        // paths. tools/test-mono-012-single-chain.mjs owns the persisted-field round-trip check for
        // OpenType letters, including a negative control.
        const targetCenterXMm = slot.targetRect.xMm + slot.targetRect.widthMm / 2;
        const targetCenterYMm = slot.targetRect.yMm + slot.targetRect.heightMm / 2;
        const { xMm: layerXMm, yMm: layerYMm } = computeTextLayerPositionForTargetCenterMm({
          targetCenterXMm, targetCenterYMm,
          canvasWidthMm: normalizedCanvasMm.widthMm, canvasHeightMm: normalizedCanvasMm.heightMm
        });
        const deltaXMm = targetCenterXMm - fittedBox.center.xMm;
        const deltaYMm = targetCenterYMm - fittedBox.center.yMm;
        const finalStones = fittedLayout.stones.map((stone) => new Stone({
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
          requestedScale: null, layerXMm, layerYMm,
          minimumLegalScale: null, naturalMinimumSpacingMm: null, requiredSpacingMm: null,
          naturalBoundingBox, scaledBoundingBox: fittedBox,
          isAuthored: false, fittedHeightMm: fitHeightMm, stemStoneCount: achievedStemStones,
          // MONO-018: consumed by the hoisted single-chain minimum gate after the loop.
          belowFloor
        });
        continue;
      }

      // MONO-006E: letters are the primary design element -- fit each one to *fill* its own slot
      // (the largest scale that still stays within the slot's own width/height), bounded only below
      // by scaleAuthoredTextLayout()'s production-legal floor (checked next), never defaulted to
      // that floor the way MONO-006C's "densest legal size" default did. That old default made a
      // letter's rendered *size* completely independent of its slot's size -- every letter of a
      // given font/stoneSizeMm rendered at the same fixed mm size regardless of the frame, which is
      // both why letters looked tiny inside large frames and why Traditional Three's larger-center/
      // smaller-side slot ratios had no visible effect (see MonogramLayouts.js's own doc comment).
      //
      // naturalBoundingBox (StoneLayout.getBoundingBox()) pads every stone's *center* position by
      // its own radius (stoneSizeMm/2), so it is `pointSpread + stoneSizeMm`, not pointSpread alone
      // -- and scaleAuthoredTextLayout() only scales stone *positions*, never sizeMm (see that
      // method's own doc comment), so that radius padding does not grow with the scale. Naively
      // requesting `slot / naturalBoundingBox` would therefore always under-fill the slot by a
      // little (the unscaled radius padding eats into the ratio). Solving `pointSpread*scale +
      // stoneSizeMm = slotSize` for scale instead -- i.e. subtracting the fixed radius padding from
      // both the natural and target sizes before dividing -- fits the slot exactly.
      const haloMm = stoneSizeMm;
      const naturalPointWidthMm = naturalBoundingBox.widthMm - haloMm;
      const naturalPointHeightMm = naturalBoundingBox.heightMm - haloMm;
      const fillScaleCandidates = [];
      if (naturalPointWidthMm > 0) {
        const candidate = (slot.targetRect.widthMm - haloMm) / naturalPointWidthMm;
        if (candidate > 0) fillScaleCandidates.push(candidate);
      }
      if (naturalPointHeightMm > 0) {
        const candidate = (slot.targetRect.heightMm - haloMm) / naturalPointHeightMm;
        if (candidate > 0) fillScaleCandidates.push(candidate);
      }
      // Degenerate fallback (only reachable via a synthetic/single-stone fixture, never a real
      // multi-stone authored letter): no halo-aware candidate was computable, so fall back to the
      // simpler whole-bounding-box ratio rather than leaving requestedScale undefined.
      if (fillScaleCandidates.length === 0) {
        if (naturalBoundingBox.widthMm > 0) fillScaleCandidates.push(slot.targetRect.widthMm / naturalBoundingBox.widthMm);
        if (naturalBoundingBox.heightMm > 0) fillScaleCandidates.push(slot.targetRect.heightMm / naturalBoundingBox.heightMm);
      }
      const requestedScale = fillScaleCandidates.length > 0 ? Math.min(...fillScaleCandidates) : 1;

      const scaleResult = this._engine.scaleAuthoredTextLayout(baseLayout, requestedScale);
      if (!scaleResult.ok) {
        const reason = scaleResult.reason === TEXT_SCALE_FAILURE_REASONS.BELOW_MINIMUM_SCALE
          ? R.BELOW_MINIMUM_SCALE
          : R.FITTING_FAILED;
        return failure(reason, `Letter ${JSON.stringify(letter)} (slot ${i}) cannot be produced legally inside its slot: at the largest scale that fits (${requestedScale.toFixed(4)}), ${scaleResult.message}`, {
          diagnostics: {
            letter, slotIndex: i, requestedScale,
            slotWidthMm: slot.targetRect.widthMm, slotHeightMm: slot.targetRect.heightMm,
            naturalWidthMm: naturalBoundingBox.widthMm, naturalHeightMm: naturalBoundingBox.heightMm,
            frameId, layoutId, frameWidthMm: normalizedFrameRect.widthMm, frameHeightMm: normalizedFrameRect.heightMm,
            stoneSizeMm, gapMm, scaleAuthoredTextLayoutResult: scaleResult
          }
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
        naturalBoundingBox, scaledBoundingBox,
        // MONO-012: authored letters carry no single-chain fitting axis.
        isAuthored: true, fittedHeightMm: null, stemStoneCount: null
      });
    }

    // MONO-018: the single-chain minimum gate, hoisted out of the per-letter loop above. Every
    // letter has now been fitted to its own slot; on failure report the BINDING letter -- the one
    // whose fitted stem is thinnest -- not the first letter below the floor in slot order. Because
    // letters shrink by different amounts to fill an identical slot, the first sub-floor letter's
    // identity (and the stem figure quoted with it) changes with frame size, so a user shrinking
    // the frame could see the number rise (the MONO-017 diagnosis). Ties break on the lower slot
    // index. This branch is unreachable for authored fonts (no single-chain axis) and never runs
    // on the success path -- CHAIN_TOO_THIN emits no geometry, so no committed baseline moves.
    if (!fontIsAuthored) {
      const subFloorLetters = letterResults.filter((r) => r.belowFloor);
      if (subFloorLetters.length > 0) {
        const minStones = minChainStones({ stemWidthRatio });
        const floorStones = MIN_HEIGHT_TO_STONE_RATIO * stemWidthRatio;
        const bindingLetter = subFloorLetters.reduce((worst, r) => {
          if (r.stemStoneCount < worst.stemStoneCount) return r;
          if (r.stemStoneCount === worst.stemStoneCount && r.slotIndex < worst.slotIndex) return r;
          return worst;
        });
        const isReadabilityFloor = floorStones >= SINGLE_CHAIN_MIN_RATIO;
        const boundName = isReadabilityFloor
          ? `the readability floor (${minStones.toFixed(3)} stones across the stem)`
          : `the single-chain minimum (${SINGLE_CHAIN_MIN_RATIO.toFixed(2)} stones across the stem)`;
        // MONO-018: name the sub-floor count so the reported letter reads as the worst of several,
        // not the only one. Omitted for a single-letter monogram, where it is always "1 of 1".
        const countClause = letterResults.length > 1
          ? ` ${subFloorLetters.length} of ${letterResults.length} letters fall below.`
          : '';
        return failure(R.CHAIN_TOO_THIN, `Letter ${JSON.stringify(bindingLetter.letter)} (slot ${bindingLetter.slotIndex}): font ${JSON.stringify(fontId)} with ${stoneSizeMm} mm stones fits this slot only at ${bindingLetter.stemStoneCount.toFixed(3)} stones across the stem, below ${boundName}.${countClause} Use a smaller stone size, a larger frame, less letter spacing, or a layout with fewer letters.`, {
          diagnostics: {
            letter: bindingLetter.letter, slotIndex: bindingLetter.slotIndex,
            achievedStemStones: bindingLetter.stemStoneCount, minChainStones: minStones,
            fittedHeightMm: bindingLetter.fittedHeightMm, stoneSizeMm, stemWidthRatio,
            boundThatBound: isReadabilityFloor ? 'readability-floor' : 'single-chain-minimum',
            // MONO-018: every letter's fitted stem, in slot order, so the full picture is available
            // without re-running. Its minimum is the reported achievedStemStones.
            allLetterStemStones: letterResults.map((r) => ({
              letter: r.letter, slotIndex: r.slotIndex,
              achievedStemStones: r.stemStoneCount, belowFloor: r.belowFloor
            }))
          }
        });
      }
    }

    // 6. Generate the frame layer -- reuses the frame's own generationNaturalContours (outer+inner
    // band) through GeometryEngine.generatePathLayout(), the same "place natural contours into an
    // x/y/w/h box, then outline/fill-sample" pipeline every other placed shape/path layer already
    // uses. No new geometry code: this is the one point of contact between FrameLibrary's data and
    // the Geometry Engine. MONO-014: skipped entirely for "No frame" -- an empty stone set so the
    // collision check and measurements below need no further branching.
    const frameLayout = isNoFrame
      ? { stones: [] }
      : this._engine.generatePathLayout({
        contours: effectiveFrame.generationNaturalContours,
        layerId: frameLayerId,
        xMm: normalizedFrameRect.xMm,
        yMm: normalizedFrameRect.yMm,
        widthMm: normalizedFrameRect.widthMm,
        heightMm: normalizedFrameRect.heightMm,
        stoneSizeMm: frameStoneSizeMm,
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
    // MONO-010: letters and frame now each get their own `d` (requiredSpacingMm vs
    // frameRequiredSpacingMm) rather than one shared value across the concatenated array --
    // findCrossGroupCollisions() already computes each pair's own threshold as (a.d+b.d)/2, so this
    // is the one place that threshold needs to reflect two possibly-different stone sizes.
    const collisionRecords = allLetterStones
      .map((s) => ({ x: s.xMm, y: s.yMm, d: requiredSpacingMm, layerId: s.layerId }))
      .concat(frameLayout.stones.map((s) => ({ x: s.xMm, y: s.yMm, d: frameRequiredSpacingMm, layerId: s.layerId })));
    const collisions = findCrossGroupCollisions(collisionRecords);

    if (collisions.some((c) => letterLayerIds.has(c.layerIdA) && letterLayerIds.has(c.layerIdB))) {
      return failure(R.LETTER_COLLISION, 'Two or more letters collide at the requested stone size/spacing.', {
        diagnostics: { requiredSpacingMm, collisions }
      });
    }
    if (!isNoFrame && collisions.some((c) => c.layerIdA === frameLayerId || c.layerIdB === frameLayerId)) {
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
    // MONO-014: null for "No frame" -- no frame-role layer is emitted; `layers` below is the letter
    // layers alone.
    const frameLayerObj = isNoFrame ? null : {
      id: frameLayerId,
      type: 'path',
      visible: true,
      pathName: `${frame.label} Frame`,
      contours: effectiveFrame.generationNaturalContours.map((polygon) => polygon.map((p) => ({ x: p.xMm, y: p.yMm }))),
      x: normalizedFrameRect.xMm,
      y: normalizedFrameRect.yMm,
      w: normalizedFrameRect.widthMm,
      h: normalizedFrameRect.heightMm,
      stoneSize: frameStoneSizeMm,
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
        // MONO-012: for an authored letter, heightMm has no effect on geometry (see
        // PLACEHOLDER_HEIGHT_MM) -- height is the fitted bounding-box height, informational only, and
        // the real size lives in authoredScale below. For an OpenType single-chain letter, height IS
        // the geometry input (the em-square value singleChainHeightMm() produced) and there is no
        // authoredScale axis; heightMode 'raw' declares that height is the raw engine value (see
        // OPENTYPE_LETTER_HEIGHT_MODE). The two branches legitimately differ here.
        height: r.isAuthored ? r.scaledBoundingBox.heightMm : r.fittedHeightMm,
        ...(r.isAuthored ? {} : { heightMode: OPENTYPE_LETTER_HEIGHT_MODE }),
        textMode: DEFAULT_TEXT_MODE,
        stoneSize: stoneSizeMm,
        gap: gapMm,
        color: resolvedColor,
        // MONO-005A: the persisted, position-only authored-font scale (see GeometryEngine.
        // generateTextLayout()'s own authoredScale doc comment) -- this is what makes the letter's
        // fitted size reproducible through the normal generation path, verified above via this
        // exact letter's own round-trip check. Omitted entirely for OpenType letters (MONO-012):
        // they have no authored branch for it to apply to.
        ...(r.isAuthored ? { authoredScale: r.requestedScale } : {}),
        // MONO-015: persist the flat weight-following field for an OpenType letter generated with
        // weight sizing on, so a live re-render reproduces the same varying-size chain. Authored
        // letters never carry it (weight sizing is outline-only).
        ...(!r.isAuthored && weightParams
          ? { sizeMode: 'weight', weightSizesMm: weightParams.weightSizesMm }
          : {}),
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

    const layers = isNoFrame ? [...letterLayerObjs] : [frameLayerObj, ...letterLayerObjs];

    const measurements = {
      frameId,
      layoutId,
      frameRect: normalizedFrameRect,
      frameInteriorRect,
      canvasMm: normalizedCanvasMm,
      // MONO-014: the frame's own applied spec, or null for "No frame". `frameHierarchy` records
      // whether the frame's applied stone size is 'subordinate' | 'dominant' | 'equal' to the
      // letters' (null with no frame). 'equal' is unreachable from app.js's automatic path (toggle
      // unchecked) -- see classifyFrameHierarchy()'s own comment.
      frame: isNoFrame ? null : {
        id: frameId,
        label: frame.label,
        stoneSizeMm: frameStoneSizeMm,
        stoneCount: frameLayout.stones.length,
        mode: frameMode
      },
      frameHierarchy: isNoFrame ? null : classifyFrameHierarchy(frameStoneSizeMm, stoneSizeMm),
      slots: layoutResult.slots,
      // MONO-016: the applied shared "Letter spacing" value. For a slot layout it was added to the
      // inter-slot gap (computeMonogramLayout extraGapMm); 0 is the pre-MONO-016 default.
      letterSpacingMm: resolvedLetterSpacingMm,
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
        // MONO-012: OpenType single-chain fitting outputs; null for authored letters.
        fittedHeightMm: r.fittedHeightMm,
        stemStones: r.stemStoneCount,
        xMm: r.layerXMm,
        yMm: r.layerYMm
      })),
      frameStoneCount: frameLayout.stones.length,
      letterStoneCount: allLetterStones.length,
      totalStoneCount: frameLayout.stones.length + allLetterStones.length
    };

    const diagnostics = {
      productionSpacingMm: requiredSpacingMm,
      frameStoneSizeMm,
      collisions: { letterCollision: false, frameCollision: false },
      roundTripVerified: true
    };

    return { ok: true, layers, measurements, diagnostics };
  }

  /**
   * MONO-013: generate a connected-script monogram as ONE interlocked mark. Separate branch from
   * generate()'s per-letter path (which is left byte-identical for the four other layouts).
   *
   * Instead of placing each letter in a disjoint slot with a mandatory production gap, the letters
   * are set as one string via the font's own advances/kerning plus the shared `letterSpacingMm`
   * control (MONO-016: negative tightens/interlocks, positive spreads; MONO-013 shipped this
   * script-only and negative-only as `interlockMm`). GeometryEngine._buildLineContours() applies it
   * at the pen advance (line 591); _textPolygons() (line ~470) flattens every character's contours into one
   * flat array; generateTextLayout() then makes ONE sampleShapeFillPoints() call over the whole set
   * (line ~206), dispatching to StoneSampler.sampleMultiContourOutlinePoints() (line ~1492) whose
   * RC-002 cross-contour dedup already resolves swashes that cross. There is no cross-layer
   * dedupeStonesByRadius() step because there is only one layer.
   *
   * Clearance (MONO-013 production decision): a single sampling call enforces only
   * `minSeparationMm = stoneSizeMm` between any two stones, not the `stoneSizeMm + gapMm` the
   * per-letter path gets from feeding findCrossGroupCollisions() a synthetic
   * `d = stoneSizeMm + gapMm` for cross-*layer* pairs (that check skips same-layer pairs outright,
   * StoneSampler.js:481). So a fitted script mark can legally have a closest pair between
   * `stoneSizeMm` and `stoneSizeMm + gapMm` apart. That is accepted and expected for an interlocked
   * mark — letters are meant to touch — and is measured into `measurements.minStoneDistanceMm`, not
   * gated. Only a physical *overlap* is a hard failure: per pair, distance below
   * `(d1 + d2) / 2 - 1e-6`. For a uniform mark every `d` is `stoneSizeMm`, so that is
   * `stoneSizeMm - 1e-6` exactly as before. MONO-015: for a weight-sized mark the per-pair
   * threshold varies (assigned stones range over the graduated step's diameters); a scalar
   * `stoneSizeMm` check would pass vacuously since every assigned stone is `>= sizesMm[0]`.
   * The binding pair's two diameters are recorded in `measurements.minStoneDistancePairDiametersMm`.
   *
   * No internal round-trip regeneration (see the comment at the fit loop's end and the MONO-012
   * precedent it cites); tools/test-mono-013-interlock.mjs owns the persisted-field round trip.
   *
   * @param {object} ctx pre-resolved context from generate() — see the call site.
   * @returns {Promise<{ok:boolean, reason?:string, message?:string, layers:object[]|null, measurements:object|null, diagnostics:object|null}>}
   */
  async _generateScriptMonogram(ctx) {
    const {
      R, frame, frameId, isNoFrame, effectiveFrame,
      normalizedFrameRect, normalizedCanvasMm, resolvedColor,
      stoneSizeMm, gapMm, requiredSpacingMm,
      frameStoneSizeMm, frameRequiredSpacingMm, frameOptions,
      fontId, providerId, letters, layoutId, fontIsAuthored, stemWidthRatio, weightParams,
      // MONO-016: the shared "Letter spacing" value, already resolved and validated in generate()
      // (resolveLetterSpacingRequest, script range [-pitchMm, 4 x pitchMm]). Feeds the emitted
      // layer's `letterSpacing` and every generateTextLayout() call below. The floor is exactly
      // -pitchMm because writeSelectedControlsToLayer() re-clamps layer.letterSpacing to
      // letterSpacingBoundsMm().minMm on every text-control write with no undo entry -- a wider
      // negative range would silently un-interlock the mark (READ-006 silent clamp; MONO-013 §4).
      letterSpacingMm
    } = ctx;

    // Authored (stone-center) fonts have no vector stem to form a chain and no outline for swashes
    // to cross — the script layout is outline-only. INVALID_FONT, like MONO-012's other font
    // rejections, naming the font id.
    if (fontIsAuthored) {
      return failure(R.INVALID_FONT, `Font ${JSON.stringify(fontId)} supplies authored stone centers; the ${JSON.stringify(layoutId)} monogram layout requires an outline (OpenType) font.`);
    }

    const joinedText = letters.join('');
    const letterLayerId = `monogram-${frameId}-${layoutId}-letter-0`;
    const idealHeightMm = singleChainHeightMm({ stoneSizeMm, stemWidthRatio });

    // Natural (un-shrunk) mark, at the ideal single-chain height, with the overlap already applied.
    // Used for the frame-fit aspect ratio and recorded as measurements.letters[0].naturalBoundingBox.
    let naturalLayout;
    try {
      naturalLayout = await this._engine.generateTextLayout({
        text: joinedText, fontId, providerId, layerId: letterLayerId,
        heightMm: idealHeightMm, stoneSizeMm, gapMm, mode: 'outline',
        color: resolvedColor, curveEnabled: false, letterSpacingMm
      });
    } catch (error) {
      return failure(R.INVALID_FONT, `Failed to generate the string ${JSON.stringify(joinedText)} with font ${JSON.stringify(fontId)}: ${error.message}`);
    }
    const naturalBoundingBox = naturalLayout.getBoundingBox();
    if (!naturalBoundingBox) {
      return failure(R.FITTING_FAILED, `The string ${JSON.stringify(joinedText)} produced no stones for font ${JSON.stringify(fontId)}.`);
    }

    // Frame interior region: the requested rect directly for "No frame", otherwise the clearance-
    // eroded rectangle inscribed in the frame's true interior (same computeFrameFitRect() call the
    // per-letter path uses at step 4), shaped to the mark's own natural aspect ratio.
    let frameInteriorRect;
    if (isNoFrame) {
      frameInteriorRect = {
        xMm: normalizedFrameRect.xMm, yMm: normalizedFrameRect.yMm,
        widthMm: normalizedFrameRect.widthMm, heightMm: normalizedFrameRect.heightMm
      };
    } else {
      const rawAspect = (naturalBoundingBox.widthMm > 0 && naturalBoundingBox.heightMm > 0)
        ? naturalBoundingBox.widthMm / naturalBoundingBox.heightMm
        : 1;
      const aspect = Math.min(MAX_GROUP_ASPECT_RATIO, Math.max(MIN_GROUP_ASPECT_RATIO, rawAspect));
      const inscribed = computeFrameFitRect(effectiveFrame, normalizedFrameRect, aspect, requiredSpacingMm);
      if (!inscribed) {
        return failure(R.FITTING_FAILED, `Frame ${JSON.stringify(frameId)} has no usable rectangular interior region for the given frameRect and stoneSizeMm ${stoneSizeMm}/gapMm ${gapMm}.`);
      }
      frameInteriorRect = { xMm: inscribed.xMm, yMm: inscribed.yMm, widthMm: inscribed.widthMm, heightMm: inscribed.heightMm };
    }

    const layoutResult = computeMonogramLayout({ layoutId, frameInteriorRect, letterCount: letters.length, minGapMm: requiredSpacingMm });
    if (!layoutResult.ok) {
      const reason = layoutResult.reason === MONOGRAM_LAYOUT_FAILURE_REASONS.UNKNOWN_LAYOUT ? R.LAYOUT_NOT_FOUND
        : layoutResult.reason === MONOGRAM_LAYOUT_FAILURE_REASONS.UNSUPPORTED_LETTER_COUNT ? R.UNSUPPORTED_LETTER_COUNT
        : layoutResult.reason === MONOGRAM_LAYOUT_FAILURE_REASONS.INSUFFICIENT_SPACE ? R.FITTING_FAILED
        : R.INVALID_INPUT;
      return failure(reason, layoutResult.message);
    }
    const slot = layoutResult.slots[0];

    // Shrink-only fit of the whole interlocked string into the single slot — identical iteration
    // shape to MONO-012's per-letter OpenType loop (regenerate at a smaller heightMm, halo-aware
    // shrink ratio, never grow past the ideal single-chain height). fittedLayout/fittedBox always
    // correspond to the current fitHeightMm at loop exit.
    const haloMm = stoneSizeMm;
    let fitHeightMm = idealHeightMm;
    let fittedLayout = null;
    let fittedBox = null;
    for (let iter = 0; iter < MAX_OPENTYPE_FIT_ITERATIONS; iter++) {
      try {
        fittedLayout = await this._engine.generateTextLayout({
          text: joinedText, fontId, providerId, layerId: letterLayerId,
          heightMm: fitHeightMm, stoneSizeMm, gapMm, mode: 'outline',
          color: resolvedColor, curveEnabled: false, letterSpacingMm,
          ...(weightParams || {}) // MONO-015: opt-in weight-following stone size
        });
      } catch (error) {
        return failure(R.INVALID_FONT, `The string ${JSON.stringify(joinedText)} could not be generated with font ${JSON.stringify(fontId)} at heightMm ${fitHeightMm}: ${error.message}`);
      }
      fittedBox = fittedLayout.getBoundingBox();
      if (!fittedBox) {
        return failure(R.FITTING_FAILED, `The string ${JSON.stringify(joinedText)} produced no stones for font ${JSON.stringify(fontId)}.`);
      }
      if (iter === MAX_OPENTYPE_FIT_ITERATIONS - 1) break;
      const shrinkCandidates = [];
      if (fittedBox.widthMm - haloMm > 0) shrinkCandidates.push((slot.targetRect.widthMm - haloMm) / (fittedBox.widthMm - haloMm));
      if (fittedBox.heightMm - haloMm > 0) shrinkCandidates.push((slot.targetRect.heightMm - haloMm) / (fittedBox.heightMm - haloMm));
      if (shrinkCandidates.length === 0) {
        shrinkCandidates.push(slot.targetRect.widthMm / fittedBox.widthMm, slot.targetRect.heightMm / fittedBox.heightMm);
      }
      const shrink = Math.min(...shrinkCandidates);
      if (shrink >= 1) break;
      fitHeightMm *= Math.max(shrink, 1e-3);
    }

    // Shrinking to fit drags R (heightMm / stoneSizeMm) and the stem-stone count down. If the
    // fitted mark no longer reads as a continuous chain, fail — naming whichever bound bound (same
    // logic as MONO-012's per-letter CHAIN_TOO_THIN), and naming the string, not a letter/slot.
    // MONO-015: divide the stem width by the stone actually assigned there (weightSizeMm at the
    // stem width for a weight-sized mark, stoneSizeMm otherwise) -- same generalisation as the
    // per-letter path above.
    const stemWidthMm = stemWidthRatio * fitHeightMm;
    const stemStoneMm = weightParams
      ? weightSizeMm(stemWidthMm, weightParams.weightSizesMm)
      : stoneSizeMm;
    const achievedStemStones = stemWidthMm / stemStoneMm;
    const minStones = minChainStones({ stemWidthRatio });
    const floorStones = MIN_HEIGHT_TO_STONE_RATIO * stemWidthRatio;
    if (achievedStemStones < minStones) {
      const boundName = floorStones >= SINGLE_CHAIN_MIN_RATIO
        ? `the readability floor (${minStones.toFixed(3)} stones across the stem)`
        : `the single-chain minimum (${SINGLE_CHAIN_MIN_RATIO.toFixed(2)} stones across the stem)`;
      return failure(R.CHAIN_TOO_THIN, `The interlocked string ${JSON.stringify(joinedText)}: font ${JSON.stringify(fontId)} with ${stoneSizeMm} mm stones fits this frame only at ${achievedStemStones.toFixed(3)} stones across the stem, below ${boundName}. Use a smaller stone size, a larger frame, less letter spacing, or fewer letters.`, {
        diagnostics: {
          string: joinedText, achievedStemStones, minChainStones: minStones,
          fittedHeightMm: fitHeightMm, stoneSizeMm, stemWidthRatio,
          boundThatBound: floorStones >= SINGLE_CHAIN_MIN_RATIO ? 'readability-floor' : 'single-chain-minimum'
        }
      });
    }

    // No internal round-trip regeneration here -- same decision, and same reasoning, as MONO-012's
    // OpenType per-letter branch (MonogramGenerator.js:696-702): `fittedLayout` above IS already a
    // plain deterministic generateTextLayout() call whose every persisted field (heightMm,
    // stoneSize, gap, textMode 'stroke' -> outline, and MONO-016's letterSpacing = letterSpacingMm) is
    // exactly what a live render feeds back in, so a second call would only re-derive the same
    // stones -- a check comparing a deterministic function's output with itself. The one persisted
    // field the OpenType path did not carry before MONO-013 is `letterSpacing`;
    // tools/test-mono-013-interlock.mjs owns the persisted-field round trip that actually exercises
    // it, with a named negative control that perturbs `layer.letterSpacing`.

    // Place the mark: translate the fitted stones onto the slot's own centre (the real absolute
    // positions a live renderer produces), and compute the persistable layer x/y under the real
    // text-layer placement contract (canvas-centered + this offset).
    const targetCenterXMm = slot.targetRect.xMm + slot.targetRect.widthMm / 2;
    const targetCenterYMm = slot.targetRect.yMm + slot.targetRect.heightMm / 2;
    const { xMm: layerXMm, yMm: layerYMm } = computeTextLayerPositionForTargetCenterMm({
      targetCenterXMm, targetCenterYMm,
      canvasWidthMm: normalizedCanvasMm.widthMm, canvasHeightMm: normalizedCanvasMm.heightMm
    });
    const deltaXMm = targetCenterXMm - fittedBox.center.xMm;
    const deltaYMm = targetCenterYMm - fittedBox.center.yMm;
    const finalStones = fittedLayout.stones.map((stone) => new Stone({
      xMm: stone.xMm + deltaXMm,
      yMm: stone.yMm + deltaYMm,
      sizeMm: stone.sizeMm,
      color: stone.color,
      layerId: stone.layerId,
      index: stone.index,
      metadata: stone.metadata
    }));

    // Frame layer (skipped for "No frame") + frame-vs-mark collision. There is one letter group, so
    // there is no letter-vs-letter check.
    const frameLayerId = `monogram-${frameId}-${layoutId}-frame`;
    const frameMode = (frameOptions.stoneWidth === 1 || frameOptions.stoneWidth === 2)
      ? 'outline'
      : (VECTOR_FILL_MODES.has(frameOptions.mode) ? frameOptions.mode : DEFAULT_FRAME_MODE);
    const frameColor = (typeof frameOptions.color === 'string' && frameOptions.color.length > 0)
      ? frameOptions.color
      : resolvedColor;
    const frameLayout = isNoFrame
      ? { stones: [] }
      : this._engine.generatePathLayout({
        contours: effectiveFrame.generationNaturalContours,
        layerId: frameLayerId,
        xMm: normalizedFrameRect.xMm,
        yMm: normalizedFrameRect.yMm,
        widthMm: normalizedFrameRect.widthMm,
        heightMm: normalizedFrameRect.heightMm,
        stoneSizeMm: frameStoneSizeMm,
        gapMm,
        mode: frameMode,
        color: frameColor
      });

    if (!isNoFrame) {
      const collisionRecords = finalStones
        .map((s) => ({ x: s.xMm, y: s.yMm, d: requiredSpacingMm, layerId: s.layerId }))
        .concat(frameLayout.stones.map((s) => ({ x: s.xMm, y: s.yMm, d: frameRequiredSpacingMm, layerId: s.layerId })));
      const collisions = findCrossGroupCollisions(collisionRecords);
      if (collisions.some((c) => c.layerIdA === frameLayerId || c.layerIdB === frameLayerId)) {
        return failure(R.FRAME_COLLISION, `The interlocked string collides with the frame at the requested stone size/spacing.`, {
          diagnostics: { requiredSpacingMm, collisions }
        });
      }
    }

    // Clearance measurement — measure, do not gate the "letters may touch" range. See this
    // method's own doc comment. minStoneDistanceMm is the raw closest-pair distance (reported);
    // the hard failure below is per-pair against that pair's own physical touching threshold
    // (d1 + d2) / 2 -- for a uniform mark every d is stoneSizeMm so this is stoneSizeMm - 1e-6
    // exactly as before; for a MONO-015 weight-sized mark the threshold varies per pair, and a
    // scalar stoneSizeMm check would pass vacuously since every assigned stone is >= sizesMm[0].
    let minStoneDistanceMm = Infinity;
    let closestPair = null;
    let worstOverlapMm = 0;          // max( (d1+d2)/2 - dist ) over all pairs; > 0 means a real overlap
    let worstOverlapPair = null;
    let worstOverlapDiametersMm = null;
    for (let a = 0; a < finalStones.length; a++) {
      for (let b = a + 1; b < finalStones.length; b++) {
        const dx = finalStones[a].xMm - finalStones[b].xMm;
        const dy = finalStones[a].yMm - finalStones[b].yMm;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < minStoneDistanceMm) { minStoneDistanceMm = dist; closestPair = [a, b]; }
        const overlapMm = (finalStones[a].sizeMm + finalStones[b].sizeMm) / 2 - dist;
        if (overlapMm > worstOverlapMm) {
          worstOverlapMm = overlapMm;
          worstOverlapPair = [a, b];
          worstOverlapDiametersMm = [finalStones[a].sizeMm, finalStones[b].sizeMm];
        }
      }
    }
    if (finalStones.length >= 2 && worstOverlapMm > 1e-6) {
      const [a, b] = worstOverlapPair;
      return failure(R.INTERNAL_CONTRACT_MISMATCH, `The interlocked string ${JSON.stringify(joinedText)}: two stones (${worstOverlapDiametersMm[0]} mm and ${worstOverlapDiametersMm[1]} mm) are ${Math.sqrt((finalStones[a].xMm - finalStones[b].xMm) ** 2 + (finalStones[a].yMm - finalStones[b].yMm) ** 2).toFixed(6)} mm apart, below their ${((worstOverlapDiametersMm[0] + worstOverlapDiametersMm[1]) / 2).toFixed(6)} mm touching distance. Closest such pair: (${finalStones[a].xMm}, ${finalStones[a].yMm}) and (${finalStones[b].xMm}, ${finalStones[b].yMm}).`, {
        diagnostics: { string: joinedText, minStoneDistanceMm, closestPair, worstOverlapMm, worstOverlapPair, worstOverlapDiametersMm }
      });
    }
    // The two diameters of the pair that binds the clearance (the raw closest pair). Reported
    // alongside minStoneDistanceMm so a weight-sized mark's clearance can be read against the right
    // per-pair threshold.
    const minStoneDistancePairDiametersMm = closestPair
      ? [finalStones[closestPair[0]].sizeMm, finalStones[closestPair[1]].sizeMm]
      : null;
    if (!Number.isFinite(minStoneDistanceMm)) minStoneDistanceMm = null; // < 2 stones

    // --- Build ordinary project layers -------------------------------------------------------
    const frameLayerObj = isNoFrame ? null : {
      id: frameLayerId,
      type: 'path',
      visible: true,
      pathName: `${frame.label} Frame`,
      contours: effectiveFrame.generationNaturalContours.map((polygon) => polygon.map((p) => ({ x: p.xMm, y: p.yMm }))),
      x: normalizedFrameRect.xMm,
      y: normalizedFrameRect.yMm,
      w: normalizedFrameRect.widthMm,
      h: normalizedFrameRect.heightMm,
      stoneSize: frameStoneSizeMm,
      gap: gapMm,
      color: frameColor,
      fillMode: frameMode
    };

    // One text layer. This is the OpenType side of generate()'s own layer builder (heightMode 'raw',
    // no authoredScale) plus one field the per-letter OpenType path never needs: letterSpacing,
    // which persists letterSpacingMm so a live render reproduces the spacing.
    const letterLayerObj = {
      id: letterLayerId,
      type: 'text',
      visible: true,
      text: joinedText,
      font: fontId,
      height: fitHeightMm,
      heightMode: OPENTYPE_LETTER_HEIGHT_MODE,
      textMode: DEFAULT_TEXT_MODE,
      stoneSize: stoneSizeMm,
      gap: gapMm,
      color: resolvedColor,
      letterSpacing: letterSpacingMm,
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
      x: layerXMm,
      y: layerYMm,
      // MONO-015: persist the flat weight-following field so a live re-render of this interlocked
      // mark reproduces the same varying-size chain. Absent (uniform) unless the request opted in.
      ...(weightParams
        ? { sizeMode: 'weight', weightSizesMm: weightParams.weightSizesMm }
        : {})
    };

    const layers = isNoFrame ? [letterLayerObj] : [frameLayerObj, letterLayerObj];

    const measurements = {
      frameId,
      layoutId,
      frameRect: normalizedFrameRect,
      frameInteriorRect,
      canvasMm: normalizedCanvasMm,
      frame: isNoFrame ? null : {
        id: frameId,
        label: frame.label,
        stoneSizeMm: frameStoneSizeMm,
        stoneCount: frameLayout.stones.length,
        mode: frameMode
      },
      frameHierarchy: isNoFrame ? null : classifyFrameHierarchy(frameStoneSizeMm, stoneSizeMm),
      slots: layoutResult.slots,
      // MONO-016: the applied shared "Letter spacing" value (emitted as the layer's letterSpacing),
      // and the measured (not gated) closest-pair distance in the emitted mark. For a uniform mark,
      // minStoneDistanceMm between stoneSizeMm and stoneSizeMm + gapMm is expected (letters are meant
      // to touch). MONO-015: for a weight-sized mark read minStoneDistanceMm against
      // minStoneDistancePairDiametersMm's own (d1 + d2) / 2, not against stoneSizeMm -- the binding
      // pair's stones may each be larger than the step's floor.
      letterSpacingMm,
      minStoneDistanceMm,
      minStoneDistancePairDiametersMm,
      letters: [{
        letter: joinedText,
        slotIndex: 0,
        layerId: letterLayerId,
        requestedScale: null,
        minimumLegalScale: null,
        naturalMinimumSpacingMm: null,
        requiredSpacingMm: null,
        naturalBoundingBox: naturalBoundingBox.toJSON(),
        scaledBoundingBox: fittedBox.toJSON(),
        stoneCount: finalStones.length,
        fittedHeightMm: fitHeightMm,
        stemStones: achievedStemStones,
        xMm: layerXMm,
        yMm: layerYMm
      }],
      frameStoneCount: frameLayout.stones.length,
      letterStoneCount: finalStones.length,
      totalStoneCount: frameLayout.stones.length + finalStones.length
    };

    const diagnostics = {
      productionSpacingMm: requiredSpacingMm,
      frameStoneSizeMm,
      letterSpacingMm,
      minStoneDistanceMm
    };

    return { ok: true, layers, measurements, diagnostics };
  }
}
