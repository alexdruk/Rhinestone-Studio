/**
 * READ-006 — glyph-separation primitives, shared by the font-certification tooling and the product.
 *
 * Everything in this module was moved verbatim from `tools/font-certification/lib/` (READ-005a) so
 * that `app.js`'s "Separate letters" control and the certification ladders run the *same* code:
 *
 *   - `countClusters()` / `CLUSTER_GAP_MULTIPLIER` — from `lib/productionAnalysis.mjs`
 *   - `overlapComponentCount()` / `expectedComponentCount()` and their helpers — the whole of
 *     `lib/glyphSeparation.mjs`
 *   - `separationBand()` with its `0.65` / `1.35` boundaries — de-duplicated from `f-ladder.mjs`
 *     and `calibration-renders.mjs`
 *   - `SEPARATION_TARGET` (was `FULL_SEPARATION`), `TRACKING_XPITCH_LADDER` — from
 *     `tracking-renders.mjs`
 *
 * The move is behaviour-preserving: `tools/test-read-005-derived-tables.mjs` and
 * `node tools/font-certification/analyze-ratings.mjs` are the guards.
 *
 * The design and evidence for the one product intervention built on top of these primitives
 * (`solveLetterSpacingMm()`) is `docs/specifications/READ-006-LetterSpacing.md`.
 */
import { isPointInsidePolygons } from './StoneSampler.js';

// --- shared constants ----------------------------------------------------------------------------

// stones within (pitch * this) of each other are one connected cluster
export const CLUSTER_GAP_MULTIPLIER = 1.6;

// READ-005 tracking experiment / READ-006 solve: the separation ratio at or above which the letters
// are considered pulled apart (spec §1.2, §2). Was `FULL_SEPARATION` in tracking-renders.mjs.
export const SEPARATION_TARGET = 0.95;

// Per-case tracking sweep: letterSpacingMm over these multiples of pitchMm, take the LOWEST reaching
// SEPARATION_TARGET. `separationRatio` is not monotone in letterSpacingMm (spec §2.2), so this is a
// linear scan of all eleven rungs — never bisected.
export const TRACKING_XPITCH_LADDER = [0, 0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 2.5, 3, 4];

// READ-005a-2 Fix 2 — `separationRatio` conflates two different defects: below 0.65 is merging (what
// signal F gates on), above ~1.35 is fragmentation (spec §3.3 records it, deliberately does not
// gate). Recorded per rung per text so the held-out calibration block can be stratified.
export function separationBand(r) {
  if (!Number.isFinite(r)) return null;
  if (r < 0.65) return 'merge';
  if (r < 1.35) return 'aligned';
  return 'fragmented';
}

// --- cluster count -----------------------------------------------------------------------------

/**
 * Number of connected stone clusters: a union-find over `stones`, unioning any two within
 * `thresholdMm` of each other (Euclidean, mm). Moved verbatim from `lib/productionAnalysis.mjs`.
 *
 * @param {Array<{ xMm: number, yMm: number }>} stones
 * @param {number} thresholdMm
 * @returns {number}
 */
export function countClusters(stones, thresholdMm) {
  const n = stones.length;
  if (n === 0) return 0;
  const parent = Array.from({ length: n }, (_, i) => i);
  const find = (x) => (parent[x] === x ? x : (parent[x] = find(parent[x])));
  const union = (a, b) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[ra] = rb;
  };
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const d = Math.hypot(stones[i].xMm - stones[j].xMm, stones[i].yMm - stones[j].yMm);
      if (d <= thresholdMm) union(i, j);
    }
  }
  return new Set(Array.from({ length: n }, (_, i) => find(i))).size;
}

// --- the signal-F denominator: expected component count ----------------------------------------
//
// Moved verbatim from `tools/font-certification/lib/glyphSeparation.mjs`.
//
// ## Why this is a separate module and not groupPolygonsIntoComponents()
//
// `groupPolygonsIntoComponents()` (src/geometry/StoneSampler.js) groups contours by EVEN-ODD
// NESTING — an `a`'s counter is a hole of its outer, an island in a hole is a fresh component. That
// is exactly right for its callers (radial anchoring, contour fill). It is the wrong quantity here:
// many faces ship a single glyph as several unmerged, mutually-overlapping contours, so nesting
// over-counts badly (`cinzel-regular` reports 45 for "Vitalina" where the answer is 8). Signal F
// needs the count of geometrically-connected blobs — contours that touch or overlap are one blob —
// which is a different grouping, so it gets its own module. `groupPolygonsIntoComponents()` and
// everything else in src/geometry/ is left untouched.
//
// The count is measured PER CHARACTER, rendered alone, and summed. Both simpler denominators were
// measured across 29 fonts × 2 texts and are systematically wrong (spec §3.1): whole-word nesting
// over-counts on multi-contour faces; whole-word overlap-grouping under-counts because it merges
// letters that touch — precisely what signal F exists to detect. Isolating each character removes
// neighbour merging while still merging a single glyph's own overlapping contours, and is
// automatically case-aware (an all-caps face renders `i` as `I` with no dot).

// A fixed internal height for the denominator's resolveTextPolygons() calls. The overlap-component
// count is a topological property of the outline and does not vary with heightMm (every vertex
// scales linearly about the origin), so any positive height gives the same count — this one is
// arbitrary and only needs to be large enough to keep flattening tolerances well away from the
// vertex spacing.
const SEPARATION_PROBE_HEIGHT_MM = 30;

// --- geometric overlap test ------------------------------------------------------------------
// Polygon points are { xMm, yMm } — NOT { x, y }. Reading `.x` / `.y` here yields `undefined`,
// which makes every bound NaN and every comparison false: a confident wrong answer, not an error.

function polygonBounds(polygon) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of polygon) {
    if (p.xMm < minX) minX = p.xMm;
    if (p.xMm > maxX) maxX = p.xMm;
    if (p.yMm < minY) minY = p.yMm;
    if (p.yMm > maxY) maxY = p.yMm;
  }
  return { minX, minY, maxX, maxY };
}

function boundingBoxesOverlap(a, b) {
  return a.minX <= b.maxX && a.maxX >= b.minX && a.minY <= b.maxY && a.maxY >= b.minY;
}

function orient(ax, ay, bx, by, cx, cy) {
  return (by - ay) * (cx - bx) - (bx - ax) * (cy - by);
}

function onSegment(ax, ay, bx, by, cx, cy) {
  return Math.min(ax, bx) <= cx && cx <= Math.max(ax, bx) &&
         Math.min(ay, by) <= cy && cy <= Math.max(ay, by);
}

// Proper segment intersection between p1->p2 and p3->p4, in mm coordinates. Collinear-overlap and
// endpoint-touch both count as a crossing (a shared vertex between two contours of the same blob is
// still contact).
function segmentsIntersect(p1, p2, p3, p4) {
  const d1 = orient(p3.xMm, p3.yMm, p4.xMm, p4.yMm, p1.xMm, p1.yMm);
  const d2 = orient(p3.xMm, p3.yMm, p4.xMm, p4.yMm, p2.xMm, p2.yMm);
  const d3 = orient(p1.xMm, p1.yMm, p2.xMm, p2.yMm, p3.xMm, p3.yMm);
  const d4 = orient(p1.xMm, p1.yMm, p2.xMm, p2.yMm, p4.xMm, p4.yMm);
  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) &&
      ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) return true;
  if (d1 === 0 && onSegment(p3.xMm, p3.yMm, p4.xMm, p4.yMm, p1.xMm, p1.yMm)) return true;
  if (d2 === 0 && onSegment(p3.xMm, p3.yMm, p4.xMm, p4.yMm, p2.xMm, p2.yMm)) return true;
  if (d3 === 0 && onSegment(p1.xMm, p1.yMm, p2.xMm, p2.yMm, p3.xMm, p3.yMm)) return true;
  if (d4 === 0 && onSegment(p1.xMm, p1.yMm, p2.xMm, p2.yMm, p4.xMm, p4.yMm)) return true;
  return false;
}

function anyVertexInside(vertices, polygon) {
  for (const v of vertices) {
    if (isPointInsidePolygons(v, [polygon])) return true;
  }
  return false;
}

function anyEdgeCrosses(polyA, polyB) {
  for (let i = 0; i < polyA.length; i++) {
    const a1 = polyA[i];
    const a2 = polyA[(i + 1) % polyA.length];
    for (let j = 0; j < polyB.length; j++) {
      const b1 = polyB[j];
      const b2 = polyB[(j + 1) % polyB.length];
      if (segmentsIntersect(a1, a2, b1, b2)) return true;
    }
  }
  return false;
}

// Overlap test, in the order spec Part A fixes: bbox reject; then any vertex of one inside the
// other (either direction — one contour fully contained in another shares no edge crossing); then
// any edge crossing. Bounding-box overlap alone is NOT sufficient (two glyphs' boxes routinely
// overlap without the ink touching).
function polygonsOverlap(polyA, polyB, boundsA, boundsB) {
  if (!boundingBoxesOverlap(boundsA, boundsB)) return false;
  if (anyVertexInside(polyA, polyB)) return true;
  if (anyVertexInside(polyB, polyA)) return true;
  if (anyEdgeCrosses(polyA, polyB)) return true;
  return false;
}

/**
 * Count geometrically-connected blobs in a flat contour list: a union-find over `polygons`,
 * unioning `i` and `j` whenever they geometrically overlap (touching counts). Polygon counts run
 * 9–61 in practice, so the exact O(n²) pairwise test is affordable and is not approximated.
 *
 * @param {Array<Array<{ xMm: number, yMm: number }>>} polygons flat contour list (as returned by
 *   GeometryEngine.resolveTextPolygons().polygons)
 * @returns {number}
 */
export function overlapComponentCount(polygons) {
  const n = polygons.length;
  if (n === 0) return 0;

  const parent = Array.from({ length: n }, (_, i) => i);
  const find = (x) => (parent[x] === x ? x : (parent[x] = find(parent[x])));
  const union = (a, b) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[ra] = rb;
  };

  const bounds = polygons.map(polygonBounds);
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (polygonsOverlap(polygons[i], polygons[j], bounds[i], bounds[j])) union(i, j);
    }
  }
  return new Set(Array.from({ length: n }, (_, i) => find(i))).size;
}

// --- the denominator ------------------------------------------------------------------------

// Memoized per (fontId, providerId, character). The count is a topological property, invariant to
// heightMm, so one measurement per (font, provider, char) is cached for the whole process. A `null`
// entry marks a font with no resolvable vector outline (authored rhinestone fonts) — cached so we
// do not re-attempt resolveTextPolygons() once per character, once per probe.
const componentCountCache = new Map();

function cacheKey(fontId, providerId, character) {
  return JSON.stringify([fontId, providerId ?? null, character]);
}

/**
 * The signal-F denominator for `text` in `fontId`: for each non-whitespace character, render that
 * character ALONE (curveEnabled false, a fixed internal height), take overlapComponentCount() of
 * its contours, and sum. Whitespace contributes 0.
 *
 * Per-character, not whole-word, deliberately (spec §3.1): whole-word overlap-grouping merges
 * touching letters, which is the defect signal F exists to detect, and whole-word nesting
 * over-counts multi-contour faces. Neither alternative may be substituted.
 *
 * Returns `null` — never throws — when the font supplies authored stone centers rather than a
 * vector outline (GeometryEngine.resolveTextPolygons() rejects it by design). Signal F's
 * denominator is undefined for such a font, and the caller records `signalF: null`. Only the
 * resolveTextPolygons() call is guarded; a bug in overlapComponentCount() still surfaces as an
 * error.
 *
 * @param {import('./GeometryEngine.js').GeometryEngine} engine
 * @param {string} fontId
 * @param {string} text
 * @param {string} [providerId] the font's manifest providerId, threaded into resolveTextPolygons()
 *   exactly as analyzeOne() threads it — authored fonts resolve to their own provider, ordinary
 *   fonts fall through to the registry default (undefined folds to null, byte-identical to omitting).
 * @returns {Promise<number|null>}
 */
export async function expectedComponentCount(engine, fontId, text, providerId = undefined) {
  let total = 0;
  for (const character of [...text]) {
    if (/\s/.test(character)) continue;
    const key = cacheKey(fontId, providerId, character);
    let count = componentCountCache.get(key);
    if (count === undefined) {
      let polygons;
      try {
        ({ polygons } = await engine.resolveTextPolygons({
          text: character,
          fontId,
          providerId,
          layerId: 'read-005a-glyph-separation',
          heightMm: SEPARATION_PROBE_HEIGHT_MM,
          curveEnabled: false
        }));
      } catch {
        // No vector outline for this font (authored stone centers) — denominator undefined.
        componentCountCache.set(key, null);
        return null;
      }
      count = overlapComponentCount(polygons);
      componentCountCache.set(key, count);
    }
    if (count === null) return null;
    total += count;
  }
  return total;
}

// --- READ-006: the product solve --------------------------------------------------------------

/**
 * Walk `TRACKING_XPITCH_LADDER` in ascending order, generating the text layout at
 * `letterSpacingMm = xPitch * pitchMm` (rounded to 6dp, matching tracking-renders.mjs), and return
 * the LOWEST rung whose `countClusters(...) / expectedComponentCount(...)` reaches
 * `SEPARATION_TARGET`.
 *
 * The scan is linear over the ladder and never bisected — `separationRatio` is not monotone in
 * `letterSpacingMm` (spec §2.2), so a binary search would return a wrong answer. But it returns the
 * moment it hits a satisfying rung: the ladder is ascending, so the first hit is the lowest, and
 * non-monotonicity above it is irrelevant. Contour costs ~84 ms per rung, so a case solving at
 * 0.5× stops after ~0.25 s instead of walking all eleven (~1.9 s). Only a genuine failure evaluates
 * every rung.
 *
 * When no rung reaches the target this returns `{ separationAchieved: false }` and the caller
 * decides — there is no fallback to the top rung (the product must not present 4× pitch as a fix;
 * spec §2.3, §4.4).
 *
 * @param {object} args
 * @param {import('./GeometryEngine.js').GeometryEngine} args.engine
 * @param {object} args.layerParams params for `engine.generateTextLayout()` — everything except
 *   `letterSpacingMm` (text, fontId, providerId, heightMm, stoneSizeMm, gapMm, mode, curve fields…).
 * @param {number} args.pitchMm stone diameter + gap, in mm.
 * @returns {Promise<{ letterSpacingMm: number, xPitch: number, separationRatio: number,
 *   separationAchieved: true, widthMm: number|null, untrackedWidthMm: number|null }
 *   | { separationAchieved: false, untrackedWidthMm: number|null }>}
 *   `widthMm` is the layout width at the chosen spacing; `untrackedWidthMm` is the width at zero
 *   spacing (ladder rung 0), for the caller's growth-percentage report.
 */
export async function solveLetterSpacingMm({ engine, layerParams, pitchMm }) {
  const { fontId, text, providerId } = layerParams;
  // expectedComponentCount() is invariant to heightMm and to the rest of the text; its own module
  // cache keys on (providerId, fontId, character), so this call is ~free after the first rung.
  const expectedComponents = await expectedComponentCount(engine, fontId, text, providerId);
  const clusterThresholdMm = pitchMm * CLUSTER_GAP_MULTIPLIER;

  let untrackedWidthMm = null;
  for (const xPitch of TRACKING_XPITCH_LADDER) {
    const letterSpacingMm = Number((xPitch * pitchMm).toFixed(6));
    let ratio = null;
    let widthMm = null;
    try {
      const layout = await engine.generateTextLayout({ ...layerParams, letterSpacingMm });
      const stones = layout.stones.map((s) => ({ xMm: s.xMm, yMm: s.yMm }));
      const clusterCount = countClusters(stones, clusterThresholdMm);
      const box = layout.getBoundingBox();
      widthMm = box ? box.widthMm : null;
      ratio = (expectedComponents > 0 && Number.isFinite(clusterCount))
        ? clusterCount / expectedComponents
        : null;
    } catch {
      // This rung failed to generate — treat it as non-satisfying and keep scanning.
    }
    if (xPitch === 0) untrackedWidthMm = widthMm;
    if (Number.isFinite(ratio) && ratio >= SEPARATION_TARGET) {
      return { letterSpacingMm, xPitch, separationRatio: ratio, separationAchieved: true, widthMm, untrackedWidthMm };
    }
  }
  return { separationAchieved: false, untrackedWidthMm };
}
