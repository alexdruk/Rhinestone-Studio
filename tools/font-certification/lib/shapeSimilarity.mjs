/**
 * Symmetric chamfer-distance shape similarity for FONT-CERT-001's confusable-character checks
 * (Part 2 typography, Part 3 rhinestone production). Operates on plain {x,y} point arrays that
 * are already normalized (translated to a shared reference frame, scaled to unit height) by the
 * caller -- this module has no font or geometry-engine knowledge of its own.
 *
 * Chamfer distance = average nearest-neighbor distance, computed in both directions and averaged.
 * Small values mean "these two point clouds occupy nearly the same shape"; used here as objective
 * evidence for glyph-anatomy ambiguity findings rather than a subjective visual call.
 */

function meanNearestNeighborDistance(fromPoints, toPoints) {
  if (fromPoints.length === 0 || toPoints.length === 0) return null;
  let sum = 0;
  for (const p of fromPoints) {
    let best = Infinity;
    for (const q of toPoints) {
      const d = Math.hypot(p.x - q.x, p.y - q.y);
      if (d < best) best = d;
    }
    sum += best;
  }
  return sum / fromPoints.length;
}

/**
 * @param {{x:number,y:number}[]} pointsA
 * @param {{x:number,y:number}[]} pointsB
 * @returns {number|null} Symmetric chamfer distance in the same normalized units as the input, or
 *   null if either point set is empty (nothing to compare).
 */
export function chamferDistance(pointsA, pointsB) {
  const ab = meanNearestNeighborDistance(pointsA, pointsB);
  const ba = meanNearestNeighborDistance(pointsB, pointsA);
  if (ab === null || ba === null) return null;
  return (ab + ba) / 2;
}
