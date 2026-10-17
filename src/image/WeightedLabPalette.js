/**
 * IMG-024 (F1): the greedy weighted-Lab palette, moved unchanged out of src/geometry/AiStoneSampler.js
 * (which re-exports it under the same names) so the image colour pipeline can reuse it --
 * src/image/** never imports src/geometry/** (docs/ARCHITECTURE.md). Pure; imports nothing. See
 * docs/specifications/IMG-024-FlatArtworkStyle.md.
 */

export const AI_STONE_PALETTE_CAP = 8;
export const AI_STONE_LAB_WEIGHTS = Object.freeze([0.5, 1, 1]);
const INITIAL_ERROR = 1e9;

// Weighted Lab distance: L* x 0.5, a*, b* x 1.
export function weightedLabDistance(a, b) {
  const [wl, wa, wb] = AI_STONE_LAB_WEIGHTS;
  return Math.hypot((a[0] - b[0]) * wl, (a[1] - b[1]) * wa, (a[2] - b[2]) * wb);
}

/**
 * Greedy palette: up to `cap` catalogue colours minimising the summed weighted-Lab error over all
 * AI stones (not by frequency). Returns catalogue indices sorted ascending.
 */
export function chooseAiStonePalette(labs, catalogLabs, cap = AI_STONE_PALETTE_CAP) {
  const n = labs.length;
  const D = catalogLabs.map((c) => Float64Array.from(labs, (l) => weightedLabDistance(l, c)));
  const cur = new Float64Array(n).fill(INITIAL_ERROR);
  const keep = [];
  for (let round = 0; round < cap; round++) {
    let best = -1, bestGain = -Infinity;
    for (let k = 0; k < catalogLabs.length; k++) {
      let gain = -1;
      if (!keep.includes(k)) {
        gain = 0;
        const d = D[k];
        for (let i = 0; i < n; i++) gain += cur[i] - Math.min(cur[i], d[i]);
      }
      if (gain > bestGain) { bestGain = gain; best = k; }
    }
    if (!(bestGain > 0)) break;
    keep.push(best);
    const d = D[best];
    for (let i = 0; i < n; i++) if (d[i] < cur[i]) cur[i] = d[i];
  }
  return keep.sort((a, b) => a - b);
}
