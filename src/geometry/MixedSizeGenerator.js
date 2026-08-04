/**
 * Mixed Stone Size infill (S-200).
 *
 * A narrowly-scoped, private implementation detail of GeometryEngine.js (imported only there, the
 * same relationship ContourRingSampler.js has to StoneSampler.js/GeometryEngine.js) -- not a second
 * engine and not a second StoneLayout producer. Per docs/specifications/S-200-MixedStoneSizeLayouts.md,
 * "Design" / "Why infill, not literal stone replacement": Mixed mode never removes, resizes, or
 * moves a layer's primary (Uniform-mode-equivalent) stones. It only ever adds *additional*, smaller
 * stones into gaps the primary pitch left uncovered, using the exact same StoneSampler.js interior
 * tests (isPointInsidePolygons() / density-field threshold) the primary pass already used.
 *
 * Units are millimeters throughout, matching every other module in src/geometry/**.
 */

import { Stone } from './Stone.js';
import { sampleShapeFillPoints, sampleFieldByMode } from './StoneSampler.js';

const SIZE_MODES = new Set(['uniform', 'mixed']);

// Deliberately biased toward the sparse end -- "intentionally conservative... do not aggressively
// maximize stone count" (S-200 brief). See infillPitchMm() below for how this scales candidate
// density; the overlap/spacing guarantees never depend on this value.
export const DEFAULT_CONSERVATIVE_DETAIL = 0.3;

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

/**
 * Validates and normalizes S-200's five Mixed Stone Size params. Returns `{ sizeMode: 'uniform',
 * mixedOptions: null }` for the default/Uniform case (including every layer with no sizeMode at
 * all) -- the common case, zero extra work, byte-identical to before this milestone.
 *
 * @param {object} params
 * @param {'uniform'|'mixed'} [params.sizeMode]
 * @param {number[]} [params.allowedSizesMm]
 * @param {number} [params.minSizeMm]
 * @param {number} [params.maxSizeMm]
 * @param {number} [params.conservativeDetail] 0..1, default DEFAULT_CONSERVATIVE_DETAIL.
 * @param {number} stoneSizeMm The layer's own primary stone size (already validated by the caller).
 * @returns {{sizeMode: 'uniform'|'mixed', mixedOptions: null | {allowedSizesMm: number[], minSizeMm: number, maxSizeMm: number, conservativeDetail: number, eligibleSizesMm: number[]}}}
 */
export function normalizeMixedSizeParams(params, stoneSizeMm) {
  const sizeMode = params.sizeMode ?? 'uniform';
  if (!SIZE_MODES.has(sizeMode)) {
    throw new TypeError(`Unsupported sizeMode: ${sizeMode}. Expected one of: ${[...SIZE_MODES].join(', ')}`);
  }
  if (sizeMode === 'uniform') {
    return { sizeMode, mixedOptions: null };
  }

  const allowedSizesMmRaw = Array.isArray(params.allowedSizesMm) ? params.allowedSizesMm : [];
  for (const value of allowedSizesMmRaw) {
    assertPositiveNumber(value, 'allowedSizesMm entry');
  }

  const minSizeMm = params.minSizeMm !== undefined && params.minSizeMm !== null
    ? assertPositiveNumber(params.minSizeMm, 'minSizeMm')
    : (allowedSizesMmRaw.length ? Math.min(...allowedSizesMmRaw) : stoneSizeMm);
  const maxSizeMm = params.maxSizeMm !== undefined && params.maxSizeMm !== null
    ? assertPositiveNumber(params.maxSizeMm, 'maxSizeMm')
    : (allowedSizesMmRaw.length ? Math.max(...allowedSizesMmRaw) : stoneSizeMm);
  if (minSizeMm > maxSizeMm) {
    throw new RangeError('minSizeMm must not exceed maxSizeMm.');
  }

  const conservativeDetail = params.conservativeDetail === undefined || params.conservativeDetail === null
    ? DEFAULT_CONSERVATIVE_DETAIL
    : assertFiniteNumber(params.conservativeDetail, 'conservativeDetail');
  if (conservativeDetail < 0 || conservativeDetail > 1) {
    throw new RangeError('conservativeDetail must be between 0 and 1.');
  }

  // Only sizes strictly smaller than the primary size are ever eligible for infill -- Mixed mode
  // never places a stone larger than the layer's own primary size (see "Why infill, not literal
  // stone replacement" in the spec). Sorted descending: at each candidate point, the size closest
  // to primary is tried first -- the smallest possible deviation from Uniform-mode output, the most
  // conservative choice available at that point.
  const eligibleSizesMm = [...new Set(allowedSizesMmRaw)]
    .filter((value) => value < stoneSizeMm && value >= minSizeMm && value <= maxSizeMm)
    .sort((a, b) => b - a);

  return {
    sizeMode,
    mixedOptions: { allowedSizesMm: allowedSizesMmRaw, minSizeMm, maxSizeMm, conservativeDetail, eligibleSizesMm }
  };
}

// S-200 "Conservative Detail": scales the infill candidate pitch between the finest geometrically
// valid pitch (conservativeDetail=1) and twice that (conservativeDetail=0, sparsest). See the
// spec's "Conservative Detail" section for the full derivation -- this is the one place that
// formula lives.
function infillPitchMm(smallestEligibleMm, gapMm, conservativeDetail) {
  const basePitchMm = smallestEligibleMm + gapMm;
  return basePitchMm * (2 - conservativeDetail);
}

/**
 * The spatial-index accept/reject core (S-200 spec, Design step 4): walks `candidatePoints` in
 * their given (already-deterministic) order, and for each tries `eligibleSizesMm` (already sorted
 * descending by the caller) largest-first, accepting the first size that does not overlap any
 * already-placed stone -- primary (`baseStones`) or infill accepted so far -- at the true
 * manufacturing threshold `(a.sizeMm+b.sizeMm)/2 + gapMm`. A candidate point that fits no eligible
 * size is skipped entirely; infill never forces a placement that would violate spacing.
 *
 * Same grid-hash bucket technique as StoneSampler.js's dedupeStonesByRadius() (bucket size = the
 * largest diameter in play, 3x3 neighbor-cell scan) generalized to same-layer, multi-size, gap-
 * inclusive spacing -- O(candidates + baseStones), not O(n^2).
 *
 * @param {{xMm:number,yMm:number}[]} candidatePoints
 * @param {{xMm:number,yMm:number,sizeMm:number}[]} baseStones
 * @param {number[]} eligibleSizesMm Sorted descending.
 * @param {number} gapMm
 * @returns {{xMm:number,yMm:number,sizeMm:number}[]}
 */
export function selectNonOverlappingSizedStones(candidatePoints, baseStones, eligibleSizesMm, gapMm) {
  if (candidatePoints.length === 0 || eligibleSizesMm.length === 0) {
    return [];
  }

  const maxDiameterMm = Math.max(eligibleSizesMm[0], ...baseStones.map((s) => s.sizeMm), 0);
  // Generous bucket size: any pair whose separation threshold ((a+b)/2 + gap) could possibly be
  // breached is guaranteed to be found within the 3x3 neighborhood, since that threshold can never
  // exceed maxDiameterMm + gapMm.
  const cellSizeMm = maxDiameterMm + gapMm;
  const buckets = new Map();

  const addToIndex = (stone) => {
    const gx = Math.floor(stone.xMm / cellSizeMm);
    const gy = Math.floor(stone.yMm / cellSizeMm);
    const key = `${gx},${gy}`;
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(stone);
  };
  const overlapsExisting = (xMm, yMm, sizeMm) => {
    const gx = Math.floor(xMm / cellSizeMm);
    const gy = Math.floor(yMm / cellSizeMm);
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const bucket = buckets.get(`${gx + dx},${gy + dy}`);
        if (!bucket) continue;
        for (const other of bucket) {
          const ddx = xMm - other.xMm;
          const ddy = yMm - other.yMm;
          const minSeparationMm = (sizeMm + other.sizeMm) / 2 + gapMm;
          if (ddx * ddx + ddy * ddy < minSeparationMm * minSeparationMm) {
            return true;
          }
        }
      }
    }
    return false;
  };

  for (const stone of baseStones) addToIndex(stone);

  const accepted = [];
  for (const point of candidatePoints) {
    for (const sizeMm of eligibleSizesMm) {
      if (!overlapsExisting(point.xMm, point.yMm, sizeMm)) {
        const stone = { xMm: point.xMm, yMm: point.yMm, sizeMm };
        accepted.push(stone);
        addToIndex(stone);
        break;
      }
    }
  }

  return accepted;
}

/**
 * Runs the full S-200 infill pass (Design steps 3-4) and returns raw `{xMm,yMm,sizeMm}` points --
 * no Stone wrapping, so callers that must apply a further transform to the combined primary+infill
 * point set before constructing Stones (generateTextLayout()'s rotation) can do so in one pass
 * through a single shared pivot. Returns `[]` immediately (no sampling work at all) when
 * `mixedOptions` is null or has no eligible sizes -- the safe, documented Uniform-equivalent no-op.
 *
 * @param {object} args
 * @param {'outline'|'fill'|'staggered'|'radial'|'contour'} args.mode
 * @param {{kind:'vector', polygons: import('../text/VectorPath.js').Point2D[][], boundingBox: import('../text/VectorPath.js').BoundingBox|null} | {kind:'field', field: {widthPx:number,heightPx:number,data:Uint8ClampedArray}, placement: {xMm:number,yMm:number,widthMm:number,heightMm:number}}} args.source
 * @param {ReturnType<typeof normalizeMixedSizeParams>['mixedOptions']} args.mixedOptions
 * @param {number} args.gapMm
 * @param {{xMm:number,yMm:number,sizeMm:number}[]} args.baseStones
 * @returns {{xMm:number,yMm:number,sizeMm:number}[]}
 */
export function generateMixedSizeInfillPoints({ mode, source, mixedOptions, gapMm, baseStones }) {
  if (!mixedOptions || mixedOptions.eligibleSizesMm.length === 0) {
    return [];
  }

  const smallestEligibleMm = mixedOptions.eligibleSizesMm[mixedOptions.eligibleSizesMm.length - 1];
  const pitchMm = infillPitchMm(smallestEligibleMm, gapMm, mixedOptions.conservativeDetail);

  const candidatePoints = source.kind === 'field'
    ? sampleFieldByMode(mode, source.field, source.placement, pitchMm)
    : sampleShapeFillPoints(mode, source.polygons, source.boundingBox, pitchMm, smallestEligibleMm);

  return selectNonOverlappingSizedStones(candidatePoints, baseStones, mixedOptions.eligibleSizesMm, gapMm);
}

/**
 * Thin Stone-wrapping convenience over generateMixedSizeInfillPoints(), for the four layer types
 * (shape/svg/image/path) that need no further transform of the infill points before they become
 * real Stones -- generateTextLayout() calls generateMixedSizeInfillPoints() directly instead (see
 * its own doc comment for why).
 *
 * @param {object} args Same as generateMixedSizeInfillPoints(), plus:
 * @param {string} args.layerId
 * @param {string|null} args.color
 * @param {number} args.startIndex
 * @returns {Stone[]}
 */
export function generateMixedSizeInfillStones({ mode, source, mixedOptions, gapMm, baseStones, layerId, color, startIndex }) {
  const points = generateMixedSizeInfillPoints({ mode, source, mixedOptions, gapMm, baseStones });
  return points.map((point, i) => new Stone({
    xMm: point.xMm,
    yMm: point.yMm,
    sizeMm: point.sizeMm,
    color,
    layerId,
    index: startIndex + i
  }));
}
