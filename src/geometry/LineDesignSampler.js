/**
 * IMG-010 -- Line Design image fill mode.
 *
 * A private-to-GeometryEngine.js module (the same relationship GapFill.js/MixedSizeGenerator.js/
 * ContourRingSampler.js already have) housing the pieces docs/specifications/IMG-010-LineDesign.md's
 * reuse audit found genuinely missing from the rest of the codebase: enclosed-pocket hole-fill +
 * nearest-opaque inpaint (decision a), direct per-pixel CIE76 catalog labelling with a 1.2%-share
 * floor (decision b, since IMG-015 src/image/ColorQuantize.js's labelCatalogColors(), shared with
 * every other image fill mode), disk-based morphological close/dilate over a raw pixel grid (decision d, via
 * ContourRingSampler.js's rawGridDistanceTransform()), Zhang-Suen skeletonization + connected-
 * component length filtering + traced-path length filtering (decision d), and chord-distance stone
 * placement (decisions c/d). Decisions (c)/(e) reuse ContourRingSampler.js's ring-tracing machinery
 * unchanged (computeSingleDistanceRing() for the single outline ring, computeInwardRingPolygons()
 * for the repeated fill rings); decision (e)'s "walked one pixel at a time, placed wherever it fits"
 * accept/reject reuses MixedSizeGenerator.js's selectNonOverlappingSizedStones() unchanged, fed a
 * densified candidate list; decision (f) reuses GapFill.js's generateGapFillStones() unchanged.
 *
 * This module never constructs a StoneLayout and is never imported outside GeometryEngine.js --
 * see docs/ARCHITECTURE.md and this repo's forbidden-changes list (no second GeometryEngine, no
 * second StoneLayout producer).
 *
 * Units are millimeters throughout; pixel-space helpers are named accordingly.
 */

import { computeSubjectMask } from '../image/SubjectMask.js';
import { rgbToLab } from '../image/ColorSpace.js';
import { labelCatalogColors, MIN_CATALOG_COLOR_SHARE } from '../image/ColorQuantize.js';
import { rawGridDistanceTransform, computeSingleDistanceRing, computeInwardRingPolygons } from './ContourRingSampler.js';
import { generateGapFillStones, GAP_FILL_STONE_SIZE_MM } from './GapFill.js';
import { selectNonOverlappingSizedStones } from './MixedSizeGenerator.js';

// Matches catalog ids 'ss6'/'ss10' (src/renderer/StoneSizes.js:38-39) -- decision 2's fixed sizes,
// regardless of the layer's own stoneSizeMm (the same GAP_FILL_STONE_SIZE_MM precedent GapFill.js
// already established).
export const LINE_DESIGN_CHAIN_STONE_SIZE_MM = 2.0;
export const LINE_DESIGN_FILL_STONE_SIZE_MM = 2.8;

// D1 (spec correction): the closing disk's RADIUS is 0.6 stone DIAMETERS (the prototype's own
// `disk(0.6*2*rl)`, where `rl` is the chain radius) -- 0.6 * 2.0mm = 1.2mm. The spec's original
// "0.6 stone diameters" wording was ambiguous between radius and diameter and has been corrected in
// the spec doc itself alongside this implementation.
export const LINE_DESIGN_CLOSING_DISK_RADIUS_RATIO_OF_DIAMETER = 0.6;
// Decision (d): half-width gate and minimum component size, both stated as ratios of the chain
// stone's own DIAMETER.
export const LINE_DESIGN_HALF_WIDTH_GATE_RATIO_OF_DIAMETER = 0.85;
export const LINE_DESIGN_MIN_COMPONENT_DIAMETER_RATIO = 1.2;
// D2 (measured refinement, adopted): a traced skeleton path shorter than one chain pitch
// (LINE_DESIGN_CHAIN_STONE_SIZE_MM + the layer's own gapMm) is dropped whole, independent of and
// applied after the component-level LINE_DESIGN_MIN_COMPONENT_DIAMETER_RATIO filter above -- see
// docs/specifications/IMG-010-LineDesign.md's "Defect found: skeleton junction fragmentation".
// Decision (b): colours under this share of the silhouette's own pixel count are dropped and
// relabelled to their nearest surviving catalog colour. IMG-015 moved the constant, with the
// labeller, into src/image/ColorQuantize.js; this name stays exported as an alias of it.
export const LINE_DESIGN_MIN_COLOR_SHARE = MIN_CATALOG_COLOR_SHARE;
// Decision (g): modal colour vote over every silhouette pixel within this fraction of a stone's own
// radius of its centre.
export const LINE_DESIGN_MODAL_COLOR_RADIUS_RATIO = 0.8;
// Ink structure (decision d) is exactly the per-pixel-labelled 'jet' region -- see
// resolveJetCatalogIndex() below.
const JET_COLOR_ID = 'jet';
// IMG-016 decision 3: the ink structure stays the region labelled 'jet' against these 17 pre-IMG-016
// catalogue ids, in catalogue order, so appended dark neutrals never move line geometry. Stone colours
// still label against the whole passed palette. The coloured-chains milestone removes this constant.
export const LINE_DESIGN_INK_REFERENCE_COLOR_IDS = Object.freeze([
  'crystal-clear', 'crystal', 'jet', 'siam', 'light-siam', 'rose', 'fuchsia', 'amethyst', 'sapphire',
  'light-sapphire', 'aquamarine', 'emerald', 'peridot', 'topaz', 'citrine', 'gold', 'silver'
]);

function hexToRgb(hex) {
  const h = hex.replace('#', '');
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

// src/geometry/** must never import src/renderer/** (tools/test-architecture-module-boundaries.mjs
// enforces this) -- every other image mode already resolves its catalog through the `palette`
// GeometryEngine.generateImageLayout() forwards from options.palette (app.js's imageColorPalette(),
// the same {id,hex} shape normalizeImageParams() already documents), and this mode now does too,
// instead of importing CrystalColors.js directly. Computed fresh per call (a few dozen Lab
// conversions, negligible next to this mode's own ~0.6-0.8s budget) since `palette` is a per-call
// argument, not a module-level constant.
function catalogLabsFor(palette) {
  return palette.map((c) => rgbToLab(...hexToRgb(c.hex)));
}

function resolveJetCatalogIndex(palette) {
  const index = palette.findIndex((c) => c.id === JET_COLOR_ID);
  if (index === -1) {
    throw new Error('LineDesignSampler expected a "jet" entry in the passed palette.');
  }
  return index;
}

// ---- Stage (a): subject mask, enclosed-pocket hole-fill, nearest-opaque inpaint -----------------

// BFS flood fill from every border pixel through 0-valued mask cells -- anything reached is genuine
// background; anything left over is an enclosed pocket (fully surrounded by the subject).
function findEnclosedHoles(maskData, widthPx, heightPx) {
  const pixelCount = widthPx * heightPx;
  const reached = new Uint8Array(pixelCount);
  const queue = new Int32Array(pixelCount);
  let head = 0, tail = 0;
  const tryEnqueue = (idx) => {
    if (maskData[idx] === 0 && !reached[idx]) { reached[idx] = 1; queue[tail++] = idx; }
  };
  for (let x = 0; x < widthPx; x++) { tryEnqueue(x); tryEnqueue((heightPx - 1) * widthPx + x); }
  for (let y = 0; y < heightPx; y++) { tryEnqueue(y * widthPx); tryEnqueue(y * widthPx + widthPx - 1); }
  while (head < tail) {
    const idx = queue[head++];
    const x = idx % widthPx, y = (idx - x) / widthPx;
    if (x > 0) tryEnqueue(idx - 1);
    if (x < widthPx - 1) tryEnqueue(idx + 1);
    if (y > 0) tryEnqueue(idx - widthPx);
    if (y < heightPx - 1) tryEnqueue(idx + widthPx);
  }
  const isHole = new Uint8Array(pixelCount);
  let holeCount = 0;
  for (let i = 0; i < pixelCount; i++) {
    if (maskData[i] === 0 && !reached[i]) { isHole[i] = 1; holeCount++; }
  }
  return { isHole, holeCount };
}

// Multi-source BFS from every real (non-hole) subject pixel into the holes, so each hole pixel is
// assigned the RGB of the nearest (BFS/graph-distance-nearest, a close approximation of Euclidean-
// nearest on a regular grid) opaque pixel -- decision (a)'s "colour inpainted from the nearest
// opaque pixel".
function inpaintHoleColors(imageBuffer, filledMask, isHole) {
  const { widthPx, heightPx, data } = imageBuffer;
  const pixelCount = widthPx * heightPx;
  const r = new Uint8ClampedArray(pixelCount);
  const g = new Uint8ClampedArray(pixelCount);
  const b = new Uint8ClampedArray(pixelCount);
  const assigned = new Uint8Array(pixelCount);
  const queue = new Int32Array(pixelCount);
  let head = 0, tail = 0;
  for (let i = 0; i < pixelCount; i++) {
    if (filledMask[i] === 1 && !isHole[i]) {
      const o = i * 4;
      r[i] = data[o]; g[i] = data[o + 1]; b[i] = data[o + 2];
      assigned[i] = 1;
      queue[tail++] = i;
    }
  }
  while (head < tail) {
    const idx = queue[head++];
    const x = idx % widthPx, y = (idx - x) / widthPx;
    const neighbours = [];
    if (x > 0) neighbours.push(idx - 1);
    if (x < widthPx - 1) neighbours.push(idx + 1);
    if (y > 0) neighbours.push(idx - widthPx);
    if (y < heightPx - 1) neighbours.push(idx + widthPx);
    for (const n of neighbours) {
      if (isHole[n] && !assigned[n]) {
        assigned[n] = 1;
        r[n] = r[idx]; g[n] = g[idx]; b[n] = b[idx];
        queue[tail++] = n;
      }
    }
  }
  return { r, g, b };
}

function computeFilledMaskAndInpaint(imageBuffer) {
  const { mask } = computeSubjectMask(imageBuffer, {});
  const { widthPx, heightPx, data } = mask;
  const pixelCount = widthPx * heightPx;
  const { isHole, holeCount } = findEnclosedHoles(data, widthPx, heightPx);
  const filledMask = new Uint8Array(pixelCount);
  for (let i = 0; i < pixelCount; i++) {
    filledMask[i] = (data[i] === 1 || isHole[i]) ? 1 : 0;
  }
  const { r, g, b } = inpaintHoleColors(imageBuffer, filledMask, isHole);
  return { filledMask, widthPx, heightPx, holeCount, inpaintedR: r, inpaintedG: g, inpaintedB: b };
}

// ---- Stage (b): direct per-pixel CIE76 catalog labelling, 1.2% share floor + relabel ------------

function buildLabelField({ filledMask, inpaintedR, inpaintedG, inpaintedB, palette, catalogLabs }) {
  const { labels, keptIds } = labelCatalogColors({
    r: inpaintedR, g: inpaintedG, b: inpaintedB, eligible: filledMask, palette, catalogLabs, minShare: LINE_DESIGN_MIN_COLOR_SHARE
  });
  return { finalLabel: labels, survivingIds: keptIds };
}

// ---- Raster morphology: disk dilation/erosion via rawGridDistanceTransform() --------------------

function dilateMask(mask, cols, rows, cellSizeMm, radiusMm) {
  if (!(radiusMm > 0)) return Uint8Array.from(mask);
  const complement = new Uint8Array(mask.length);
  for (let i = 0; i < mask.length; i++) complement[i] = mask[i] ? 0 : 1;
  const distToMask = rawGridDistanceTransform(complement, cols, rows, cellSizeMm);
  const out = new Uint8Array(mask.length);
  for (let i = 0; i < mask.length; i++) out[i] = distToMask[i] <= radiusMm ? 1 : 0;
  return out;
}

function erodeMask(mask, cols, rows, cellSizeMm, radiusMm) {
  if (!(radiusMm > 0)) return Uint8Array.from(mask);
  const distToBackground = rawGridDistanceTransform(mask, cols, rows, cellSizeMm);
  const out = new Uint8Array(mask.length);
  for (let i = 0; i < mask.length; i++) out[i] = (mask[i] && distToBackground[i] >= radiusMm) ? 1 : 0;
  return out;
}

// ---- Zhang-Suen thinning ---------------------------------------------------------------------

// Standard 2-subiteration Zhang-Suen skeletonization over a binary raster. p2..p9 are the 8
// neighbours in clockwise order starting north, matching the algorithm's own canonical numbering.
function zhangSuenThin(mask, cols, rows) {
  const img = Uint8Array.from(mask);
  const at = (x, y) => (x < 0 || y < 0 || x >= cols || y >= rows) ? 0 : img[y * cols + x];

  const collectRemovals = (subiter) => {
    const removals = [];
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        if (!at(x, y)) continue;
        const p2 = at(x, y - 1), p3 = at(x + 1, y - 1), p4 = at(x + 1, y), p5 = at(x + 1, y + 1);
        const p6 = at(x, y + 1), p7 = at(x - 1, y + 1), p8 = at(x - 1, y), p9 = at(x - 1, y - 1);
        const B = p2 + p3 + p4 + p5 + p6 + p7 + p8 + p9;
        if (B < 2 || B > 6) continue;
        const seq = [p2, p3, p4, p5, p6, p7, p8, p9, p2];
        let A = 0;
        for (let k = 0; k < 8; k++) if (seq[k] === 0 && seq[k + 1] === 1) A++;
        if (A !== 1) continue;
        if (subiter === 1) {
          if (p2 * p4 * p6 !== 0) continue;
          if (p4 * p6 * p8 !== 0) continue;
        } else {
          if (p2 * p4 * p8 !== 0) continue;
          if (p2 * p6 * p8 !== 0) continue;
        }
        removals.push(y * cols + x);
      }
    }
    return removals;
  };

  let changed = true;
  while (changed) {
    changed = false;
    const removals1 = collectRemovals(1);
    if (removals1.length) { for (const idx of removals1) img[idx] = 0; changed = true; }
    const removals2 = collectRemovals(2);
    if (removals2.length) { for (const idx of removals2) img[idx] = 0; changed = true; }
  }

  // Standard Zhang-Suen follow-up: the algorithm can converge with an un-thinned 2x2 block left on
  // some diagonal runs (a well-known limitation of the algorithm, not specific to this fixture --
  // measured here on the antenna chains' own diagonal segments, each block a spurious degree-3/4
  // junction that fragments an otherwise-clean run into pieces under D2's minimum traced-path
  // length). Repeatedly drops the bottom-right corner of every remaining all-foreground 2x2 block
  // until none remain -- removing one corner of a 2x2 block can never disconnect it (the other three
  // pixels stay mutually 8-adjacent), so this cannot change which pixels are reachable from which.
  let blockChanged = true;
  while (blockChanged) {
    blockChanged = false;
    const removals = [];
    for (let y = 0; y < rows - 1; y++) {
      for (let x = 0; x < cols - 1; x++) {
        if (at(x, y) && at(x + 1, y) && at(x, y + 1) && at(x + 1, y + 1)) {
          removals.push((y + 1) * cols + (x + 1));
        }
      }
    }
    if (removals.length) { for (const idx of removals) img[idx] = 0; blockChanged = true; }
  }

  return img;
}

// ---- Connected-component labelling (8-connected) + bounding-box-diagonal length measure ---------

function labelComponents8(mask, cols, rows) {
  const pixelCount = cols * rows;
  const visited = new Uint8Array(pixelCount);
  const queue = new Int32Array(pixelCount);
  const components = [];
  for (let start = 0; start < pixelCount; start++) {
    if (!mask[start] || visited[start]) continue;
    let head = 0, tail = 0;
    queue[tail++] = start; visited[start] = 1;
    const comp = [];
    while (head < tail) {
      const idx = queue[head++];
      comp.push(idx);
      const x = idx % cols, y = (idx - x) / cols;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue;
          const nx = x + dx, ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
          const nIdx = ny * cols + nx;
          if (mask[nIdx] && !visited[nIdx]) { visited[nIdx] = 1; queue[tail++] = nIdx; }
        }
      }
    }
    components.push(comp);
  }
  return components;
}

function bboxDiagonalMm(comp, cols, mmPerPx) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const idx of comp) {
    const x = idx % cols, y = (idx - x) / cols;
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  return Math.hypot((maxX - minX) * mmPerPx, (maxY - minY) * mmPerPx);
}

// ---- Skeleton -> polylines: trace edges out of every non-degree-2 node, plus any leftover cycles -

// A junction-clustering tracer. Zhang-Suen thinning can leave a persistent, several-pixel-long
// double-strand ("staircase") on some diagonal runs -- not just an isolated 2x2 block (already
// cleaned up in zhangSuenThin() above), a genuinely thicker artifact of adjacent degree-3/4 pixels
// running alongside an otherwise-clean 1px path. Tracing each of those pixels as its own separate
// branch point (the naive reading of "trace edges out of every non-degree-2 node") fragments what
// should be one long run into dozens of sub-pitch pieces -- several of which independently clear
// D2's minimum traced-path length and race each other for the same physical space via the shared
// chainHash in generateLineDesignStonePoints(), starving the genuine long run of every candidate
// position. Every mutually-8-adjacent group of non-degree-2 pixels is instead clustered into one
// logical node (position = the cluster's own pixel centroid) before tracing; a clean single-pixel
// junction is simply a cluster of one, so this is a superset of the naive behaviour, not a
// different one. The remaining, expected fragmentation (see the spec's own "Defect found: skeleton
// junction fragmentation") still happens at genuine branch points and is still filtered afterward by
// the minimum traced-path length, not fixed at the tracer.
//
// Returns {points:[{xPx,yPx},...], closed}[] -- fractional pixel coordinates, since a cluster's own
// point is its member pixels' centroid, not one pixel's centre.
function traceSkeletonPaths(pixelIndices, cols, rows) {
  const pixelSet = new Set(pixelIndices);
  const NEI8 = [[-1, -1], [0, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [0, 1], [1, 1]];
  const neighboursOf = (idx) => {
    const x = idx % cols, y = (idx - x) / cols;
    const out = [];
    for (const [dx, dy] of NEI8) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
      const nIdx = ny * cols + nx;
      if (pixelSet.has(nIdx)) out.push(nIdx);
    }
    return out;
  };
  const degree = new Map();
  for (const idx of pixelIndices) degree.set(idx, neighboursOf(idx).length);
  const pixelPoint = (idx) => {
    const x = idx % cols;
    return { xPx: x, yPx: (idx - x) / cols };
  };

  // Union-find clustering of every mutually-8-adjacent non-degree-2 pixel.
  const parent = new Map();
  const find = (x) => {
    let r = x;
    while (parent.get(r) !== r) r = parent.get(r);
    while (parent.get(x) !== r) { const next = parent.get(x); parent.set(x, r); x = next; }
    return r;
  };
  for (const idx of pixelIndices) if (degree.get(idx) !== 2) parent.set(idx, idx);
  for (const idx of pixelIndices) {
    if (degree.get(idx) === 2) continue;
    for (const n of neighboursOf(idx)) {
      if (degree.get(n) === 2) continue;
      const ra = find(idx), rb = find(n);
      if (ra !== rb) parent.set(ra, rb);
    }
  }
  const clusterMembers = new Map();
  for (const idx of pixelIndices) {
    if (degree.get(idx) === 2) continue;
    const root = find(idx);
    if (!clusterMembers.has(root)) clusterMembers.set(root, []);
    clusterMembers.get(root).push(idx);
  }
  const clusterCentroid = new Map();
  for (const [root, members] of clusterMembers) {
    let sx = 0, sy = 0;
    for (const idx of members) { const p = pixelPoint(idx); sx += p.xPx; sy += p.yPx; }
    clusterCentroid.set(root, { xPx: sx / members.length, yPx: sy / members.length });
  }
  const nodeRootOf = (idx) => (degree.get(idx) === 2 ? null : find(idx));

  const edgeKey = (a, b) => (a < b ? `${a}_${b}` : `${b}_${a}`);
  const visitedEdge = new Set();
  const visitedChainPixel = new Set();
  const paths = [];

  // Walks a run of degree-2 pixels starting at `n` (an immediate neighbour of some cluster member
  // `prev`), consuming edges until it reaches another node (cluster) or a dead end.
  const walkChain = (prev, n) => {
    const points = [];
    let cur = n;
    while (degree.get(cur) === 2) {
      points.push(pixelPoint(cur));
      visitedChainPixel.add(cur);
      const options = neighboursOf(cur).filter((m) => m !== prev);
      let next = null;
      for (const m of options) {
        if (!visitedEdge.has(edgeKey(cur, m))) { next = m; break; }
      }
      if (next === null) return { points, endRoot: null };
      visitedEdge.add(edgeKey(cur, next));
      prev = cur; cur = next;
    }
    points.push(pixelPoint(cur));
    return { points, endRoot: nodeRootOf(cur) };
  };

  for (const [root, members] of clusterMembers) {
    for (const m of members) {
      for (const n of neighboursOf(m)) {
        if (nodeRootOf(n) === root) continue; // internal cluster edge, not a real branch
        const key0 = edgeKey(m, n);
        if (visitedEdge.has(key0)) continue;
        visitedEdge.add(key0);
        const walked = degree.get(n) === 2 ? walkChain(m, n) : { points: [], endRoot: nodeRootOf(n) };
        const points = [clusterCentroid.get(root), ...walked.points];
        if (walked.endRoot !== null) points.push(clusterCentroid.get(walked.endRoot));
        paths.push({ points, closed: false });
      }
    }
  }

  // Leftover pure cycles: loops with no cluster (no junction/dead-end) touching them at all -- every
  // pixel on them is degree-2 and untouched by any cluster walk above.
  for (const startIdx of pixelIndices) {
    if (visitedChainPixel.has(startIdx) || degree.get(startIdx) !== 2) continue;
    const points = [pixelPoint(startIdx)];
    visitedChainPixel.add(startIdx);
    let prev = startIdx;
    let cur = neighboursOf(startIdx)[0];
    visitedEdge.add(edgeKey(prev, cur));
    points.push(pixelPoint(cur));
    visitedChainPixel.add(cur);
    while (cur !== startIdx) {
      const options = neighboursOf(cur).filter((m) => m !== prev);
      let next = null;
      for (const m of options) {
        if (m === startIdx) { next = m; break; }
        if (!visitedEdge.has(edgeKey(cur, m))) { next = m; break; }
      }
      if (next === null) break;
      visitedEdge.add(edgeKey(cur, next));
      prev = cur; cur = next;
      if (cur !== startIdx) { points.push(pixelPoint(cur)); visitedChainPixel.add(cur); }
    }
    paths.push({ points, closed: true });
  }

  return paths;
}

// ---- Path smoothing (boxcar, edge-padded/circular) + chord-distance placement --------------------

const SMOOTH_WINDOW = 5;

function smoothPolyline(points, windowSize, closed) {
  const n = points.length;
  if (n < 3 || windowSize <= 1) return points;
  const half = Math.floor(windowSize / 2);
  const get = closed
    ? (i) => points[((i % n) + n) % n]
    : (i) => points[Math.min(n - 1, Math.max(0, i))];
  const out = [];
  for (let i = 0; i < n; i++) {
    let sx = 0, sy = 0, count = 0;
    for (let k = -half; k <= half; k++) {
      const p = get(i + k);
      sx += p.xMm; sy += p.yMm; count++;
    }
    out.push({ xMm: sx / count, yMm: sy / count });
  }
  return out;
}

function polylineLengthMm(points) {
  let sum = 0;
  for (let i = 0; i + 1 < points.length; i++) {
    sum += Math.hypot(points[i + 1].xMm - points[i].xMm, points[i + 1].yMm - points[i].yMm);
  }
  return sum;
}

// New: walks forward from the last PLACED point until straight-line (chord) distance reaches
// `pitchMm`, not arc length -- see docs/specifications/IMG-010-LineDesign.md Task A item 5 (every
// existing path-placement primitive in this codebase walks by arc length, the documented failure
// mode this mode must avoid on bends). Densifies the path to a fine step first and scans forward,
// so a candidate `isAcceptable()` rejects cleanly falls through to the next, slightly-further
// candidate rather than solving one crossing per source segment and getting stuck once that single
// candidate is rejected (outline and line chains are placed independently of each other -- see
// generateLineDesignStonePoints()'s own shared chainHash -- so a rim's line-chain candidate landing
// on top of an already-placed outline stone is expected, not exceptional, and must be skippable).
function resampleByChordDistance(points, pitchMm, closed, isAcceptable = () => true) {
  if (points.length === 0) return [];
  const path = closed ? [...points, points[0]] : points;
  const stepMm = pitchMm / 20;
  const dense = [];
  for (let i = 0; i < path.length - 1; i++) {
    const a = path[i], b = path[i + 1];
    dense.push(a);
    const segLenMm = Math.hypot(b.xMm - a.xMm, b.yMm - a.yMm);
    const steps = Math.floor(segLenMm / stepMm);
    for (let s = 1; s <= steps; s++) {
      const t = s / (steps + 1);
      dense.push({ xMm: a.xMm + (b.xMm - a.xMm) * t, yMm: a.yMm + (b.yMm - a.yMm) * t });
    }
  }
  dense.push(path[path.length - 1]);

  let startIdx = 0;
  while (startIdx < dense.length && !isAcceptable(dense[startIdx])) startIdx++;
  if (startIdx >= dense.length) return [];

  // A source polygon that folds back near itself (a concave-corner pinch in an eroded/offset
  // contour, e.g. where two silhouette lobes meet) can bring a LATER point within pitchMm of an
  // EARLIER placed point that isn't the immediately-preceding one -- the plain "distance from the
  // last placed point" check above can't see that. Guarding against every already-placed point on
  // this same path (not just the walk's own chainHash, which only covers OTHER paths) closes that
  // gap; a normal, non-self-intersecting run never has two placed points within pitchMm of each
  // other anyway, so this is a no-op there.
  const tooCloseToAnyPlaced = (p) => placed.some((q) => Math.hypot(p.xMm - q.xMm, p.yMm - q.yMm) < pitchMm);

  const placed = [dense[startIdx]];
  let last = dense[startIdx];
  for (let i = startIdx + 1; i < dense.length; i++) {
    const p = dense[i];
    if (Math.hypot(p.xMm - last.xMm, p.yMm - last.yMm) < pitchMm) continue;
    if (!isAcceptable(p)) continue;
    if (tooCloseToAnyPlaced(p)) continue;
    placed.push(p);
    last = p;
  }

  if (closed && placed.length > 1) {
    const first = placed[0], lastPlaced = placed[placed.length - 1];
    if (Math.hypot(first.xMm - lastPlaced.xMm, first.yMm - lastPlaced.yMm) < pitchMm) {
      // The ring's true perimeter is rarely an exact multiple of the pitch -- rather than overlap
      // the seam, drop the extra stone (a slightly wider closing gap there, never an overlap).
      placed.pop();
    }
  }
  return placed;
}

// ---- Incremental spatial hash: outline+line share ONE growing accept/reject index ---------------

// Outline (decision c) and line chains (decision d) are traced independently of each other (and
// line chains from different components/paths are traced independently of one another), so nothing
// otherwise stops two of them from placing a stone in the same spot -- most visibly the rim band's
// own would-be line chain landing on top of the outline chain that already occupies that same
// one-radius-in band (see the spec's own "the outline chain runs first and already occupies that
// band" note). This is a real accept/reject index (not the fill stage's read-only
// buildSpatialHash()/hashHasWithin() below): `.add()` grows it as each chain is placed, in decision
// order (outline first, then line chains), so a later chain's candidates are rejected against every
// earlier chain's already-accepted stones.
function createIncrementalHash(cellSizeMm) {
  const buckets = new Map();
  const keyOf = (xMm, yMm) => `${Math.floor(xMm / cellSizeMm)},${Math.floor(yMm / cellSizeMm)}`;
  return {
    add(stone) {
      const key = keyOf(stone.xMm, stone.yMm);
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key).push(stone);
    },
    overlaps(xMm, yMm, sizeMm, gapMm) {
      const gx = Math.floor(xMm / cellSizeMm), gy = Math.floor(yMm / cellSizeMm);
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const bucket = buckets.get(`${gx + dx},${gy + dy}`);
          if (!bucket) continue;
          for (const s of bucket) {
            const ddx = xMm - s.xMm, ddy = yMm - s.yMm;
            const minSepMm = (sizeMm + s.sizeMm) / 2 + gapMm;
            if (ddx * ddx + ddy * ddy < minSepMm * minSepMm) return true;
          }
        }
      }
      return false;
    }
  };
}

// ---- Spatial hash (grid-bucket) for the fill-ring free-space test --------------------------------

function buildSpatialHash(stones, cellSizeMm) {
  const buckets = new Map();
  const keyOf = (xMm, yMm) => `${Math.floor(xMm / cellSizeMm)},${Math.floor(yMm / cellSizeMm)}`;
  for (const s of stones) {
    const key = keyOf(s.xMm, s.yMm);
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(s);
  }
  return { buckets, cellSizeMm };
}

function hashHasWithin(hash, xMm, yMm, reachMm) {
  const gx = Math.floor(xMm / hash.cellSizeMm), gy = Math.floor(yMm / hash.cellSizeMm);
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const bucket = hash.buckets.get(`${gx + dx},${gy + dy}`);
      if (!bucket) continue;
      for (const s of bucket) {
        const ddx = xMm - s.xMm, ddy = yMm - s.yMm;
        if (ddx * ddx + ddy * ddy < reachMm * reachMm) return true;
      }
    }
  }
  return false;
}

function densifyRingForWalk(loop, stepMm) {
  const out = [];
  const n = loop.length;
  if (n === 0) return out;
  for (let i = 0; i < n; i++) {
    const a = loop[i], b = loop[(i + 1) % n];
    out.push(a);
    const segLenMm = Math.hypot(b.xMm - a.xMm, b.yMm - a.yMm);
    const steps = Math.floor(segLenMm / stepMm);
    for (let s = 1; s <= steps; s++) {
      const t = s / (steps + 1);
      out.push({ xMm: a.xMm + (b.xMm - a.xMm) * t, yMm: a.yMm + (b.yMm - a.yMm) * t });
    }
  }
  return out;
}

/**
 * Runs the full IMG-010 Line Design pipeline and returns final, already-coloured stone points --
 * outline chain (decision c), line chains (decision d), fill rings (decision e), and the pocket
 * pass (decision f) -- ready to be mapped straight to Stone instances by GeometryEngine.js, the same
 * one-call shape isBrightness's own points->Stone mapping already uses.
 *
 * @param {object} args
 * @param {{widthPx:number,heightPx:number,data:Uint8ClampedArray}} args.imageBuffer
 * @param {{xMm:number,yMm:number,widthMm:number,heightMm:number}} args.placement
 * @param {number} args.gapMm
 * @param {string} args.layerId
 * @param {object} [args.colorMap] `catalogId -> overrideId`, default {} -- same override rule
 *   imageRegionColorId() applies for every other mode, resolved against the catalog id each stone
 *   would otherwise get (its own direct per-pixel label, not a quantized cluster -- this mode never
 *   quantizes/clusters at all, so colour COUNT stays entirely unaffected by this map).
 * @param {{id:string,hex:string}[]} args.palette The full colour catalog (app.js's own
 *   imageColorPalette(), forwarded via options.palette exactly like every other mode) -- this mode
 *   labels every silhouette pixel against the WHOLE catalog directly (never a quantized subset), so
 *   unlike other modes' `palette` (only required when colorCount > 1), this one is always required.
 *   Must include a 'jet' entry (decision d's ink structure).
 * @param {(stage:string, elapsedMs:number)=>void} [args.onStageTiming] Optional per-stage timing hook (D4).
 * @returns {{xMm:number,yMm:number,sizeMm:number,color:string,kind:('outline'|'line'|'fill'|'pocket')}[]}
 */
export function generateLineDesignStonePoints({ imageBuffer, placement, gapMm, layerId, colorMap = {}, palette, onStageTiming }) {
  if (!Array.isArray(palette) || palette.length === 0) {
    throw new TypeError('generateLineDesignStonePoints requires a non-empty palette.');
  }
  const catalogLabs = catalogLabsFor(palette);
  const time = (stage, fn) => {
    const t0 = performance.now();
    const result = fn();
    if (onStageTiming) onStageTiming(stage, performance.now() - t0);
    return result;
  };

  const chainSizeMm = LINE_DESIGN_CHAIN_STONE_SIZE_MM;
  const chainRadiusMm = chainSizeMm / 2;
  const fillSizeMm = LINE_DESIGN_FILL_STONE_SIZE_MM;
  const fillRadiusMm = fillSizeMm / 2;
  const chainPitchMm = chainSizeMm + gapMm;
  const fillPitchMm = fillSizeMm + gapMm;
  const minTracedPathLengthMm = chainPitchMm; // D2: "one chain pitch"

  // Image layers preserve aspect ratio at import/edit time (app.js), so widthMm/widthPx and
  // heightMm/heightPx agree in every real and test case -- this module's raster morphology (which
  // needs one isotropic mm-per-pixel scale) uses widthMm/widthPx as that single canonical scale.
  const { widthPx, heightPx } = imageBuffer;
  const mmPerPx = placement.widthMm / widthPx;
  const pxToXMm = (px) => placement.xMm + (px + 0.5) * mmPerPx;
  const pxToYMm = (py) => placement.yMm + (py + 0.5) * mmPerPx;
  const xMmToPx = (xMm) => Math.min(widthPx - 1, Math.max(0, Math.floor((xMm - placement.xMm) / mmPerPx)));
  const yMmToPx = (yMm) => Math.min(heightPx - 1, Math.max(0, Math.floor((yMm - placement.yMm) / mmPerPx)));
  const pixelIndexAt = (xMm, yMm) => yMmToPx(yMm) * widthPx + xMmToPx(xMm);

  const { filledMask, inpaintedR, inpaintedG, inpaintedB, holeCount } = time('mask', () => computeFilledMaskAndInpaint(imageBuffer));
  time('inpaint', () => holeCount); // inpainting already ran inside computeFilledMaskAndInpaint(); measured jointly with mask above -- see report.

  const { finalLabel, survivingIds } = time('label', () => buildLabelField({ filledMask, inpaintedR, inpaintedG, inpaintedB, palette, catalogLabs }));

  // IMG-016 decision 3: the ink mask labels against the LINE_DESIGN_INK_REFERENCE_COLOR_IDS subset
  // of the passed palette (in palette order, with its own floor and relabel), not the full palette.
  const pixelCount = widthPx * heightPx;
  const inkReferenceIndices = [];
  palette.forEach((c, i) => { if (LINE_DESIGN_INK_REFERENCE_COLOR_IDS.includes(c.id)) inkReferenceIndices.push(i); });
  const inkReferencePalette = inkReferenceIndices.map((i) => palette[i]);
  const { finalLabel: inkReferenceLabel } = buildLabelField({
    filledMask, inpaintedR, inpaintedG, inpaintedB,
    palette: inkReferencePalette, catalogLabs: inkReferenceIndices.map((i) => catalogLabs[i])
  });
  const jetIndex = resolveJetCatalogIndex(inkReferencePalette);
  const inkMask = new Uint8Array(pixelCount);
  for (let i = 0; i < pixelCount; i++) inkMask[i] = (filledMask[i] && inkReferenceLabel[i] === jetIndex) ? 1 : 0;

  const insideAtSilhouette = (xMm, yMm) => filledMask[pixelIndexAt(xMm, yMm)] === 1;

  // Decision (g) follow-up (colour overrides): the same override rule imageRegionColorId() applies
  // for every other mode -- colorMap[catalogId] ?? catalogId -- resolved here, at the one point each
  // catalog id is actually produced, so every caller (outline/line/fill's own colour pass below, and
  // the pocket pass's colorAt) picks it up automatically.
  const pointColorAt = (xMm, yMm) => {
    const idx = pixelIndexAt(xMm, yMm);
    const catalogId = filledMask[idx] ? palette[finalLabel[idx]].id : palette[survivingIds[0]].id;
    return colorMap[catalogId] ?? catalogId;
  };
  // IMG-016 decision 3: `inkOnly` (line stones only) votes among ink pixels, falling back to the
  // all-pixel vote when the disk holds no ink pixel.
  const modalColorAt = (xMm, yMm, radiusMm, inkOnly = false) => {
    const rPx = Math.max(1, Math.round(radiusMm / mmPerPx));
    const cx = xMmToPx(xMm), cy = yMmToPx(yMm);
    const counts = new Map();
    for (let dy = -rPx; dy <= rPx; dy++) {
      for (let dx = -rPx; dx <= rPx; dx++) {
        if (dx * dx + dy * dy > rPx * rPx) continue;
        const px = cx + dx, py = cy + dy;
        if (px < 0 || py < 0 || px >= widthPx || py >= heightPx) continue;
        const idx = py * widthPx + px;
        if (!filledMask[idx]) continue;
        if (inkOnly && !inkMask[idx]) continue;
        const label = finalLabel[idx];
        counts.set(label, (counts.get(label) || 0) + 1);
      }
    }
    if (counts.size === 0) return inkOnly ? modalColorAt(xMm, yMm, radiusMm) : pointColorAt(xMm, yMm);
    let best = -1, bestCount = -1;
    for (const label of survivingIds) {
      const count = counts.get(label) || 0;
      if (count > bestCount) { bestCount = count; best = label; }
    }
    const catalogId = palette[best].id;
    return colorMap[catalogId] ?? catalogId;
  };

  const boundingBox = {
    minXmm: placement.xMm, minYmm: placement.yMm,
    maxXmm: placement.xMm + placement.widthMm, maxYmm: placement.yMm + placement.heightMm
  };

  // ---- Decision (c): outline chain ---------------------------------------------------------------
  // `pathId` (also set on decision (d)'s line chains below) is test/introspection-only metadata --
  // never read by any renderer/exporter -- identifying which single traced chain a stone belongs to,
  // so a test can walk one specific chain in placement order without re-deriving chain membership
  // from spatial proximity alone (unrelated chains can pass close to each other, e.g. near a
  // junction or where two veins' chains happen to run near one another).
  let nextPathId = 0;
  // Shared by both decision (c) and decision (d) below -- see createIncrementalHash()'s own doc
  // comment for why they cannot be placed independently of each other.
  const chainHash = createIncrementalHash(Math.max(2 * chainPitchMm, 1e-6));
  const acceptChainCandidate = (p) => !chainHash.overlaps(p.xMm, p.yMm, chainSizeMm, gapMm);

  const outlinePoints = time('outline', () => {
    const loops = computeSingleDistanceRing({
      insideAt: insideAtSilhouette, boundingBox, spacingMm: chainPitchMm, thresholdMm: chainRadiusMm
    });
    const points = [];
    for (const loop of loops) {
      const pathId = nextPathId++;
      const smoothed = smoothPolyline(loop, SMOOTH_WINDOW, true);
      for (const p of resampleByChordDistance(smoothed, chainPitchMm, true, acceptChainCandidate)) {
        chainHash.add({ xMm: p.xMm, yMm: p.yMm, sizeMm: chainSizeMm });
        points.push({ xMm: p.xMm, yMm: p.yMm, sizeMm: chainSizeMm, kind: 'outline', pathId });
      }
    }
    return points;
  });

  // ---- Decision (d): line chains -----------------------------------------------------------------
  const linePoints = time('lines', () => {
    const closingDiskRadiusMm = LINE_DESIGN_CLOSING_DISK_RADIUS_RATIO_OF_DIAMETER * chainSizeMm;
    const dilatedInk = dilateMask(inkMask, widthPx, heightPx, mmPerPx, closingDiskRadiusMm);
    const closedInk = erodeMask(dilatedInk, widthPx, heightPx, mmPerPx, closingDiskRadiusMm);

    const silhouetteDilated = dilateMask(filledMask, widthPx, heightPx, mmPerPx, chainRadiusMm / 2);
    const clippedInk = new Uint8Array(pixelCount);
    for (let i = 0; i < pixelCount; i++) clippedInk[i] = (closedInk[i] && silhouetteDilated[i]) ? 1 : 0;

    const skeleton = zhangSuenThin(clippedInk, widthPx, heightPx);

    const halfWidthGateMm = LINE_DESIGN_HALF_WIDTH_GATE_RATIO_OF_DIAMETER * chainSizeMm;
    const halfWidthField = rawGridDistanceTransform(clippedInk, widthPx, heightPx, mmPerPx);
    const gated = new Uint8Array(pixelCount);
    for (let i = 0; i < pixelCount; i++) gated[i] = (skeleton[i] && halfWidthField[i] <= halfWidthGateMm) ? 1 : 0;

    const minComponentDiagMm = LINE_DESIGN_MIN_COMPONENT_DIAMETER_RATIO * chainSizeMm;
    const components = labelComponents8(gated, widthPx, heightPx);
    const keptComponents = components.filter((comp) => bboxDiagonalMm(comp, widthPx, mmPerPx) >= minComponentDiagMm);

    const points = [];
    for (const comp of keptComponents) {
      for (const { points: pixelPath, closed } of traceSkeletonPaths(comp, widthPx, heightPx)) {
        const mmPoints = pixelPath.map((p) => ({ xMm: pxToXMm(p.xPx), yMm: pxToYMm(p.yPx) }));
        const pathLengthMm = polylineLengthMm(closed ? [...mmPoints, mmPoints[0]] : mmPoints);
        if (pathLengthMm < minTracedPathLengthMm) continue; // D2
        const pathId = nextPathId++;
        const smoothed = smoothPolyline(mmPoints, SMOOTH_WINDOW, closed);
        for (const p of resampleByChordDistance(smoothed, chainPitchMm, closed, acceptChainCandidate)) {
          chainHash.add({ xMm: p.xMm, yMm: p.yMm, sizeMm: chainSizeMm });
          points.push({ xMm: p.xMm, yMm: p.yMm, sizeMm: chainSizeMm, kind: 'line', pathId });
        }
      }
    }
    return points;
  });

  // ---- Decision (e): fill rings ------------------------------------------------------------------
  const fillPoints = time('fill', () => {
    const chainStones = [...outlinePoints, ...linePoints];
    const freeSpaceReachMm = chainRadiusMm + fillRadiusMm + gapMm;
    const chainHash = buildSpatialHash(chainStones, Math.max(2 * freeSpaceReachMm, 1e-6));
    const insideAtFreeSpace = (xMm, yMm) => insideAtSilhouette(xMm, yMm) && !hashHasWithin(chainHash, xMm, yMm, freeSpaceReachMm);

    const rings = computeInwardRingPolygons({ insideAt: insideAtFreeSpace, boundingBox, spacingMm: fillPitchMm, startOffsetMm: fillRadiusMm });
    const candidates = [];
    for (const ring of rings) candidates.push(...densifyRingForWalk(ring, mmPerPx));

    const accepted = selectNonOverlappingSizedStones(
      candidates,
      chainStones.map((s) => ({ xMm: s.xMm, yMm: s.yMm, sizeMm: s.sizeMm })),
      [fillSizeMm],
      gapMm
    );
    return accepted.map((p) => ({ xMm: p.xMm, yMm: p.yMm, sizeMm: fillSizeMm, kind: 'fill' }));
  });

  // ---- Decision (g): modal colour for outline/line/fill stones ----------------------------------
  const colored = time('colour', () => [...outlinePoints, ...linePoints, ...fillPoints].map((p) => ({
    xMm: p.xMm, yMm: p.yMm, sizeMm: p.sizeMm, kind: p.kind, pathId: p.pathId ?? null,
    color: modalColorAt(p.xMm, p.yMm, (p.sizeMm / 2) * LINE_DESIGN_MODAL_COLOR_RADIUS_RATIO, p.kind === 'line')
  })));

  // ---- Decision (f): pocket pass (GapFill.js, unmodified) -- modal colour rule, like every other
  // stone here (colorAt is only ever called with a stone's own xMm/yMm, so the pocket stone's own
  // radius -- GapFill.js's GAP_FILL_STONE_SIZE_MM, since generateGapFillStones() is called below
  // without a fillerSizeMm override -- is closed over rather than threaded through colorAt's signature.
  const pocketRadiusMm = GAP_FILL_STONE_SIZE_MM / 2;
  const pocketPoints = time('pocket', () => {
    const baseStones = colored.map((p) => ({ xMm: p.xMm, yMm: p.yMm, sizeMm: p.sizeMm }));
    const gapFillStones = generateGapFillStones({
      baseStones,
      gapMm,
      isInside: insideAtSilhouette,
      placement,
      colorAt: (xMm, yMm) => modalColorAt(xMm, yMm, pocketRadiusMm * LINE_DESIGN_MODAL_COLOR_RADIUS_RATIO),
      layerId,
      startIndex: baseStones.length
    });
    return gapFillStones.map((s) => ({ xMm: s.xMm, yMm: s.yMm, sizeMm: s.sizeMm, color: s.color, kind: 'pocket' }));
  });

  return [...colored, ...pocketPoints];
}
