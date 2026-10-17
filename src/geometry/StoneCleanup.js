/**
 * IMG-025 -- Stone clean-up for image layers: fills small enclosed holes, recolours single odd
 * stones, removes tiny detached groups, and optionally turns the outer edge into Jet.
 *
 * A private implementation detail of GeometryEngine.js (imported only there, the same relationship
 * GapFill.js has), run by generateImageLayout() on the finished Staggered / AI stones lattice. A
 * line-for-line port of fill_holes()/despeckle()/remove_crumbs()/outline() in
 * docs/prototypes/stone_cleanup_reference.py; where the two ever disagree, the script wins. See
 * docs/specifications/IMG-025-StoneCleanup.md.
 *
 * Pure: no DOM, never mutates its input. Units are millimeters.
 */

import { Stone } from './Stone.js';

export const CLEANUP_HOLE_MAX = 10;
export const CLEANUP_CRUMB_MIN = 4;
export const CLEANUP_SPECKLE_ROUNDS = 2;
export const CLEANUP_FRAME_PITCHES = 1.1;

const JET_ID = 'jet';
const LATTICE_TOLERANCE = 0.25;

// (row, col) packed into one number. Numeric order equals row-major (row, col) order, which the
// reference's range scans and sorted() rely on.
const OFFSET = 2 ** 20;
const STRIDE = 2 ** 21;
const keyOf = (r, c) => (r + OFFSET) * STRIDE + (c + OFFSET);
const rowOf = (k) => Math.floor(k / STRIDE) - OFFSET;
const colOf = (k) => (k % STRIDE) - OFFSET;

// D3: parity is relative to stones[0]'s row; odd rows sit +pitch/2 to the right.
function neighbourKeys(k) {
  const r = rowOf(k), c = colOf(k);
  if (((r % 2) + 2) % 2 === 0) {
    return [keyOf(r, c - 1), keyOf(r, c + 1), keyOf(r - 1, c - 1), keyOf(r - 1, c), keyOf(r + 1, c - 1), keyOf(r + 1, c)];
  }
  return [keyOf(r, c - 1), keyOf(r, c + 1), keyOf(r - 1, c), keyOf(r - 1, c + 1), keyOf(r + 1, c), keyOf(r + 1, c + 1)];
}

// Highest count; ties to the earlier palette colour. A colour outside the palette ranks after
// every palette colour, and two such colours rank by string order (audit note A5).
function topColour(colours, order) {
  const counts = new Map();
  for (const colour of colours) counts.set(colour, (counts.get(colour) ?? 0) + 1);
  let best = null, bestN = -1;
  for (const [colour, n] of counts) {
    if (n > bestN || (n === bestN && ranksBefore(colour, best, order))) {
      best = colour;
      bestN = n;
    }
  }
  return { top: best, topN: bestN, counts };
}

function ranksBefore(a, b, order) {
  const ia = order.get(a), ib = order.get(b);
  if (ia !== undefined && ib !== undefined) return ia < ib;
  if (ia !== undefined) return true;
  if (ib !== undefined) return false;
  return a < b;
}

function fillHoles(g, order) {
  let R0 = Infinity, R1 = -Infinity, C0 = Infinity, C1 = -Infinity;
  for (const k of g.keys()) {
    const r = rowOf(k), c = colOf(k);
    if (r < R0) R0 = r;
    if (r > R1) R1 = r;
    if (c < C0) C0 = c;
    if (c > C1) C1 = c;
  }
  R0 -= 1; R1 += 1; C0 -= 1; C1 += 1;
  const inBox = (k) => { const r = rowOf(k), c = colOf(k); return r >= R0 && r <= R1 && c >= C0 && c <= C1; };

  const outside = new Set([keyOf(R0, C0)]);
  const queue = [keyOf(R0, C0)];
  for (let head = 0; head < queue.length; head++) {
    for (const n of neighbourKeys(queue[head])) {
      if (inBox(n) && !g.has(n) && !outside.has(n)) { outside.add(n); queue.push(n); }
    }
  }

  const seen = new Set();
  const filled = [];
  for (let r = R0; r <= R1; r++) {
    for (let c = C0; c <= C1; c++) {
      const k = keyOf(r, c);
      if (g.has(k) || outside.has(k) || seen.has(k)) continue;
      const comp = [k];
      seen.add(k);
      // inBox() is not in the reference, and changes nothing there: the grown box's whole ring is
      // outside, so no component reaches it. It keeps the flood finite if that ever stops holding.
      for (let head = 0; head < comp.length; head++) {
        for (const n of neighbourKeys(comp[head])) {
          if (inBox(n) && !g.has(n) && !outside.has(n) && !seen.has(n)) { seen.add(n); comp.push(n); }
        }
      }
      if (comp.length > CLEANUP_HOLE_MAX) continue;
      const todo = new Set(comp);
      while (todo.size > 0) {
        // Most occupied neighbours first; ties to the smaller row, then the smaller column, which
        // is the smaller packed key.
        let best = null, bestN = -1;
        for (const p of todo) {
          let n = 0;
          for (const m of neighbourKeys(p)) if (g.has(m)) n++;
          if (n > bestN || (n === bestN && p < best)) { best = p; bestN = n; }
        }
        const colours = [];
        for (const m of neighbourKeys(best)) if (g.has(m)) colours.push(g.get(m));
        g.set(best, topColour(colours, order).top);
        todo.delete(best);
        filled.push(best);
      }
    }
  }
  return filled;
}

function despeckle(g, order, original) {
  for (let round = 0; round < CLEANUP_SPECKLE_ROUNDS; round++) {
    const changes = new Map();
    for (const [k, ownColour] of g) {
      const nb = [];
      for (const m of neighbourKeys(k)) if (g.has(m)) nb.push(g.get(m));
      if (nb.length < 4) continue;
      const { top, topN, counts } = topColour(nb, order);
      const own = counts.get(ownColour) ?? 0;
      if ((own === 0 && topN >= 3) || (own === 1 && topN >= 4)) changes.set(k, top);
    }
    if (changes.size === 0) break;
    for (const [k, colour] of changes) g.set(k, colour);
  }
  let recoloured = 0;
  for (const [k, colour] of original) if (g.has(k) && g.get(k) !== colour) recoloured++;
  return recoloured;
}

function removeCrumbs(g) {
  const seen = new Set();
  const drop = [];
  for (const k of [...g.keys()].sort((a, b) => a - b)) {
    if (seen.has(k)) continue;
    const comp = [k];
    seen.add(k);
    for (let head = 0; head < comp.length; head++) {
      for (const n of neighbourKeys(comp[head])) {
        if (g.has(n) && !seen.has(n)) { seen.add(n); comp.push(n); }
      }
    }
    if (comp.length < CLEANUP_CRUMB_MIN) drop.push(...comp);
  }
  for (const k of drop) g.delete(k);
  return drop.length;
}

// Frame test on each stone's own position (audit note A3), never one recomputed from its indices.
function outlineEdge(g, position, pitchMm, placement) {
  const frameMm = CLEANUP_FRAME_PITCHES * pitchMm;
  const { xMm, yMm, widthMm, heightMm } = placement;
  const edge = [];
  for (const k of g.keys()) {
    let n = 0;
    for (const m of neighbourKeys(k)) if (g.has(m)) n++;
    if (n <= 4) edge.push(k);
  }
  let outlined = 0;
  for (const k of edge) {
    if (g.get(k) === JET_ID) continue;
    const { x, y } = position.get(k);
    if (x - xMm < frameMm || y - yMm < frameMm || xMm + widthMm - x < frameMm || yMm + heightMm - y < frameMm) continue;
    g.set(k, JET_ID);
    outlined++;
  }
  return outlined;
}

/**
 * @param {object} args
 * @param {Stone[]} args.stones all the same size, on one staggered lattice
 * @param {number} args.pitchMm stoneSizeMm + gapMm
 * @param {{id:string, hex:string}[]|null} [args.palette] catalogue order; only `id` and order are read
 * @param {{xMm:number, yMm:number, widthMm:number, heightMm:number}} args.placement unrotated box
 * @param {string} args.layerId
 * @param {number} args.stoneSizeMm size of filled stones
 * @param {boolean} [args.outline] exactly true turns the Jet outline on
 * @returns {{stones: Stone[], stats: {filled:number, recoloured:number, removed:number, outlined:number}|{skipped:'not-lattice'}}}
 */
export function cleanupLatticeStones({ stones, pitchMm, palette, placement, layerId, stoneSizeMm, outline }) {
  if (stones.length === 0) {
    return { stones: [], stats: { filled: 0, recoloured: 0, removed: 0, outlined: 0 } };
  }
  const rowH = pitchMm * (Math.sqrt(3) / 2);
  const x0 = stones[0].xMm, y0 = stones[0].yMm;
  const tolerance = LATTICE_TOLERANCE * pitchMm;

  // D3: map each stone to its lattice point; skip the whole pass if any is off-lattice or shared.
  const keys = new Array(stones.length);
  const g = new Map();
  const position = new Map();
  for (let i = 0; i < stones.length; i++) {
    const { xMm, yMm } = stones[i];
    const row = Math.round((yMm - y0) / rowH);
    const parity = ((row % 2) + 2) % 2;
    const col = Math.round((xMm - x0 - parity * pitchMm / 2) / pitchMm);
    const dx = xMm - (x0 + col * pitchMm + parity * pitchMm / 2);
    const dy = yMm - (y0 + row * rowH);
    const k = keyOf(row, col);
    if (Math.hypot(dx, dy) > tolerance || g.has(k)) {
      return { stones, stats: { skipped: 'not-lattice' } };
    }
    keys[i] = k;
    g.set(k, stones[i].color);
    position.set(k, { x: xMm, y: yMm });
  }

  const order = new Map((palette ?? []).map((entry, i) => [entry.id, i]));
  const original = new Map(g);
  const filled = fillHoles(g, order);
  for (const k of filled) {
    const row = rowOf(k), parity = ((row % 2) + 2) % 2;
    position.set(k, { x: x0 + colOf(k) * pitchMm + parity * pitchMm / 2, y: y0 + row * rowH });
  }
  const recoloured = despeckle(g, order, original);
  const removed = removeCrumbs(g);
  const outlined = outline === true ? outlineEdge(g, position, pitchMm, placement) : 0;

  const out = [];
  for (let i = 0; i < stones.length; i++) {
    const k = keys[i];
    if (!g.has(k)) continue;
    const stone = stones[i];
    const colour = g.get(k);
    out.push(colour === stone.color ? stone : new Stone({
      xMm: stone.xMm, yMm: stone.yMm, sizeMm: stone.sizeMm, color: colour, layerId: stone.layerId, index: stone.index, metadata: stone.metadata
    }));
  }
  const n = stones.length;
  filled.forEach((k, j) => {
    if (!g.has(k)) return;
    const { x, y } = position.get(k);
    out.push(new Stone({ xMm: x, yMm: y, sizeMm: stoneSizeMm, color: g.get(k), layerId, index: n + j }));
  });

  return { stones: out, stats: { filled: filled.length, recoloured, removed, outlined } };
}
