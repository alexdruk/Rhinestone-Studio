/**
 * IMG-013 -- Fill Empty Slots: a same-layer, additive gap-fill pass for image layers.
 *
 * A narrowly-scoped, private implementation detail of GeometryEngine.js (imported only there, the
 * same relationship MixedSizeGenerator.js/ContourRingSampler.js already have to
 * GeometryEngine.js/StoneSampler.js) -- not a second engine and not a second StoneLayout producer.
 * Per docs/specifications/IMG-013-FillEmptySlots.md decision 2: candidate positions are points that
 * touch two existing stones of the layer exactly (the circle-circle intersection at distance
 * `r_a+r+gap` and `r_b+r+gap`, where `r` is the filler's own radius); a stone is placed wherever it
 * fits against every stone already placed (primary, S-200 infill, or gap-fill) with the layer's gap.
 * The accept/reject core is MixedSizeGenerator.js's own selectNonOverlappingSizedStones(), reused
 * unchanged with a single-entry `eligibleSizesMm` list (Task A's reuse-audit conclusion).
 *
 * Units are millimeters throughout, matching every other module in src/geometry/**.
 */

import { Stone } from './Stone.js';
import { selectNonOverlappingSizedStones } from './MixedSizeGenerator.js';

// Matches catalog id 'ss6' (src/renderer/StoneSizes.js:38) -- decision 3's fixed filler size,
// regardless of the layer's own stone size.
export const GAP_FILL_STONE_SIZE_MM = 2.0;

// Two arbitrary circles (centers (ax,ay)/(bx,by), radii ra/rb, distance d apart) intersect in 0, 1,
// or 2 points. Standard construction: `a` is the signed distance from A to the chord's midpoint
// along AB; `h` is the chord's own half-length. No counterpart in this codebase generalizes this to
// two independent radii (ShapeLibrary.js:189's createCrescentNaturalContours() is a fixed, equal-
// radius, single-shape use of the same geometry -- see Task A's reuse audit).
function circleCircleIntersections(ax, ay, ra, bx, by, rb) {
  const dx = bx - ax;
  const dy = by - ay;
  const d = Math.sqrt(dx * dx + dy * dy);
  if (d === 0 || d > ra + rb || d < Math.abs(ra - rb)) {
    return [];
  }
  const a = (ra * ra - rb * rb + d * d) / (2 * d);
  const hSq = ra * ra - a * a;
  const h = hSq > 0 ? Math.sqrt(hSq) : 0;
  const midXMm = ax + (a * dx) / d;
  const midYMm = ay + (a * dy) / d;
  const uxMm = -dy / d;
  const uyMm = dx / d;
  if (h === 0) {
    return [{ xMm: midXMm, yMm: midYMm }];
  }
  // Deterministic order: the "+h" point (rotated +90 deg from A->B) first, then "-h".
  return [
    { xMm: midXMm + h * uxMm, yMm: midYMm + h * uyMm },
    { xMm: midXMm - h * uxMm, yMm: midYMm - h * uyMm }
  ];
}

// A candidate is, by construction, exactly `ra` from `a` and `rb` from `b` -- precisely the
// manufacturing minimum separation selectNonOverlappingSizedStones() will re-check it against a
// moment later, via an entirely independent (coordinate-subtraction) distance computation. Two
// independent floating-point paths to the "same" exact value are not guaranteed to agree to the
// last bit, so an un-nudged candidate can be spuriously rejected against its own generating pair
// roughly half the time. EPSILON_MM (1 nanometer, far below any real manufacturing tolerance) grows
// both radii before solving the intersection, pushing the candidate a hair further from `a` and `b`
// than the nominal minimum -- comfortably clearing the re-check with margin, never introducing a
// real overlap.
const EPSILON_MM = 1e-6;

function candidatesForPair(a, b, fillerRadiusMm, gapMm) {
  const ra = a.sizeMm / 2 + fillerRadiusMm + gapMm + EPSILON_MM;
  const rb = b.sizeMm / 2 + fillerRadiusMm + gapMm + EPSILON_MM;
  return circleCircleIntersections(a.xMm, a.yMm, ra, b.xMm, b.yMm, rb);
}

// Same grid-hash-bucket idiom as selectNonOverlappingSizedStones() (MixedSizeGenerator.js:179), used
// here only to bound which pairs are even worth an exact circle-circle test -- cell size is twice
// the largest possible per-pair reach, so a 3x3 neighborhood scan is guaranteed to find every pair
// within reach, exactly like that function's own overlap check. Only pairs where the higher-indexed
// stone was placed in the immediately preceding round (index >= minIdx) are considered, per decision
// 2's "existing and newly placed stones" iteration rule -- stones are appended to `stones` in
// ascending, stable round order, so "index >= minIdx" and "placed in the previous round or later"
// are the same test. Pair order is sorted by (loIndex, hiIndex) so the result never depends on
// Map/bucket iteration order.
function findCandidatePairsWithinReach(stones, fillerRadiusMm, gapMm, minIdx) {
  const maxStoneSizeMm = stones.reduce((max, s) => Math.max(max, s.sizeMm), 0);
  const maxReachMm = maxStoneSizeMm / 2 + fillerRadiusMm + gapMm;
  const cellSizeMm = Math.max(2 * maxReachMm, 1e-6);

  const buckets = new Map();
  const bucketKeyFor = (xMm, yMm) => `${Math.floor(xMm / cellSizeMm)},${Math.floor(yMm / cellSizeMm)}`;
  for (const stone of stones) {
    const key = bucketKeyFor(stone.xMm, stone.yMm);
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(stone);
  }

  const seenPairs = new Set();
  const pairs = [];
  for (const stone of stones) {
    if (stone.idx < minIdx) continue;
    const gx = Math.floor(stone.xMm / cellSizeMm);
    const gy = Math.floor(stone.yMm / cellSizeMm);
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const bucket = buckets.get(`${gx + dx},${gy + dy}`);
        if (!bucket) continue;
        for (const other of bucket) {
          if (other === stone) continue;
          const loIdx = Math.min(stone.idx, other.idx);
          const hiIdx = Math.max(stone.idx, other.idx);
          const pairKey = `${loIdx},${hiIdx}`;
          if (seenPairs.has(pairKey)) continue;
          seenPairs.add(pairKey);
          pairs.push([loIdx, hiIdx]);
        }
      }
    }
  }
  pairs.sort((p, q) => (p[0] - q[0]) || (p[1] - q[1]));
  return pairs;
}

// Decision 4: a filler stone's centre must lie inside the layer's subject area (the same mask the
// layer's own layout used), and the whole stone (not just its centre) must lie inside the layer's
// placement rectangle.
function isCandidateValid(point, isInside, placement, fillerRadiusMm) {
  const { xMm, yMm, widthMm, heightMm } = placement;
  if (point.xMm - fillerRadiusMm < xMm || point.xMm + fillerRadiusMm > xMm + widthMm) return false;
  if (point.yMm - fillerRadiusMm < yMm || point.yMm + fillerRadiusMm > yMm + heightMm) return false;
  return isInside(point.xMm, point.yMm);
}

/**
 * Runs the full IMG-013 gap-fill pass and returns real Stone instances -- the "existing and newly
 * placed stones" iteration (decision 2) is round-based: round 1 considers every pair of `baseStones`
 * within reach; each subsequent round considers only pairs touching at least one stone accepted in
 * the immediately preceding round, until a round accepts nothing. Within a round, candidate points
 * are generated in deterministic (loIndex, hiIndex) pair order and handed to
 * MixedSizeGenerator.js's selectNonOverlappingSizedStones() (single-entry `eligibleSizesMm`), so
 * acceptance order -- and therefore the whole pass's output -- is fully deterministic.
 *
 * @param {object} args
 * @param {{xMm:number,yMm:number,sizeMm:number}[]} args.baseStones Primary + S-200 infill stones for
 *   this layer (already placed; never modified).
 * @param {number} args.gapMm The layer's own gap.
 * @param {number} [args.fillerSizeMm] Defaults to GAP_FILL_STONE_SIZE_MM (decision 3: always SS6/2.0mm).
 * @param {(xMm:number, yMm:number) => boolean} args.isInside Same on-field mask test generateImageLayout()
 *   already uses (StoneSampler.js's fieldPixelOn(), in absolute coordinates).
 * @param {{xMm:number,yMm:number,widthMm:number,heightMm:number}} args.placement
 * @param {(xMm:number, yMm:number) => (string|null)} args.colorAt Same colorAt() closure
 *   generateImageLayout() already builds for its own primary stones (decision 5).
 * @param {string} args.layerId
 * @param {number} args.startIndex
 * @returns {Stone[]}
 */
export function generateGapFillStones({ baseStones, gapMm, fillerSizeMm = GAP_FILL_STONE_SIZE_MM, isInside, placement, colorAt, layerId, startIndex }) {
  const fillerRadiusMm = fillerSizeMm / 2;
  const stones = baseStones.map((s, idx) => ({ xMm: s.xMm, yMm: s.yMm, sizeMm: s.sizeMm, idx }));

  const acceptedPoints = [];
  let minIdx = 0; // Round 1: every base stone counts as "the previous round's" for pairing purposes.

  while (true) {
    const pairs = findCandidatePairsWithinReach(stones, fillerRadiusMm, gapMm, minIdx);
    if (pairs.length === 0) break;

    const candidatePoints = [];
    for (const [loIdx, hiIdx] of pairs) {
      candidatePoints.push(...candidatesForPair(stones[loIdx], stones[hiIdx], fillerRadiusMm, gapMm));
    }

    const validCandidates = candidatePoints.filter((point) => isCandidateValid(point, isInside, placement, fillerRadiusMm));
    const roundAccepted = selectNonOverlappingSizedStones(validCandidates, stones, [fillerSizeMm], gapMm);
    if (roundAccepted.length === 0) break;

    minIdx = stones.length;
    for (const point of roundAccepted) {
      stones.push({ xMm: point.xMm, yMm: point.yMm, sizeMm: point.sizeMm, idx: stones.length });
    }
    // Appended one-by-one, not spread: a round can accept more fillers than a call can take as
    // arguments (RS-3039).
    for (const point of roundAccepted) acceptedPoints.push(point);
  }

  return acceptedPoints.map((point, i) => new Stone({
    xMm: point.xMm,
    yMm: point.yMm,
    sizeMm: point.sizeMm,
    color: colorAt(point.xMm, point.yMm),
    layerId,
    index: startIndex + i
  }));
}
