/**
 * Stroke-to-outline construction for original rhinestone-native letterforms (TXT-101A).
 *
 * A rhinestone font family (RS Block, RS Modern, RS Script) defines each glyph as one or more
 * skeleton *strokes* -- polylines through the letterform's centerline, each with a width -- rather
 * than a hand-digitized outline. This module turns each stroke directly into a single closed ribbon
 * polygon (round joins at every interior vertex, round caps on open strokes, an outer+inner contour
 * pair -- an annulus -- for a closed/looped stroke), then reuses the Geometry Engine's own Boolean
 * Operations union (src/geometry/PathBoolean.js, RS-1012) only to merge *separate* strokes within
 * one glyph (a stem plus a bowl, two diagonals plus a crossbar) into one outline.
 *
 * Why union only across strokes, never within one: an earlier version of this module built a
 * capsule polygon per individual *segment* and unioned all of them together, including every tiny
 * segment a flattened arc was broken into (~20 per curved stroke). Boolean Operations' union runs a
 * full grid rasterization + marching-squares trace per call, so chaining ~20 of them sequentially
 * per curved glyph measured 5-9 seconds for a 10-character preview string and ~30 seconds to
 * pre-warm one family's full 70-character set -- unusable for live typing. Computing each stroke's
 * ribbon directly (this module) needs no rasterization at all (it's a direct offset-and-join
 * computation over a handful of points), and a glyph typically has only 1-4 *strokes* (not
 * segments) to union -- e.g. "O" is one closed stroke (zero unions needed), "A" is two strokes (one
 * union), "B" is three (two unions). Measured after this rewrite: cold (fully uncached) generation
 * of one family's entire 70-character set is well under a second; a single new glyph resolves in
 * low single-digit milliseconds -- see tools/test-rhinestone-font-performance.mjs.
 *
 * Round joins/caps are what makes a join "production-safe": whatever angle two segments of the same
 * stroke meet at, the offset points on each side of the shared vertex are, by construction, both
 * exactly strokeWidth/2 from that vertex -- so sweeping the shorter arc between them is always a
 * smooth, gap-free, self-intersection-free join, with no possible sharp spike (see buildSideChain()
 * below). A closed stroke's inner/outer offset chains fall out of the same math and are returned as
 * one source's two contours (even-odd hole), exactly like an OpenType glyph's outer+inner contour
 * pair for a letter with a counter (see combineManyShapeSources()'s own doc comment on how holes and
 * multiple contours compose through a union).
 */

import { combineManyShapeSources } from '../../geometry/PathBoolean.js';

function offsetPoint(p, angle, radius) {
  return { xMm: p.x + radius * Math.cos(angle), yMm: p.y + radius * Math.sin(angle) };
}

function radiusAt(point, defaultWidthUnits) {
  return (typeof point.w === 'number' ? point.w : defaultWidthUnits) / 2;
}

// Shortest signed angular distance from `a` to `b`, in (-PI, PI].
function angleDiff(a, b) {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}

function circlePolygon(cx, cy, radius, segments) {
  const points = [];
  const count = Math.max(8, segments);
  for (let i = 0; i < count; i++) {
    const t = (i / count) * Math.PI * 2;
    points.push({ xMm: cx + radius * Math.cos(t), yMm: cy + radius * Math.sin(t) });
  }
  return points;
}

function segmentDirectionAngle(points, i, n) {
  const a = points[i];
  const b = points[(i + 1) % n];
  return Math.atan2(b.y - a.y, b.x - a.x);
}

/**
 * One side (`side`: +1 = left of travel direction, -1 = right) of a stroke's offset boundary,
 * walking every segment in order and inserting a short round-join arc at each interior vertex (see
 * module doc: both chains meet a shared vertex at exactly the same radius, so the shorter arc
 * between them is always valid). For a closed stroke this wraps all the way around and back to the
 * start (an outer or inner ring boundary); for an open stroke it stops after the last segment,
 * leaving the caller to add end caps.
 */
function buildSideChain(points, side, closed, defaultWidthUnits, joinSegments) {
  const n = points.length;
  const segCount = closed ? n : n - 1;
  const chain = [];

  for (let i = 0; i < segCount; i++) {
    const a = points[i];
    const b = points[(i + 1) % n];
    const dirAngle = segmentDirectionAngle(points, i, n);
    const offsetAngle = dirAngle + side * (Math.PI / 2);

    chain.push(offsetPoint(a, offsetAngle, radiusAt(a, defaultWidthUnits)));
    chain.push(offsetPoint(b, offsetAngle, radiusAt(b, defaultWidthUnits)));

    const hasNextSegment = closed ? true : i < segCount - 1;
    if (hasNextSegment) {
      const nextDirAngle = segmentDirectionAngle(points, (i + 1) % n, n);
      const nextOffsetAngle = nextDirAngle + side * (Math.PI / 2);
      const sweep = angleDiff(offsetAngle, nextOffsetAngle);
      if (Math.abs(sweep) > 1e-6) {
        const radius = radiusAt(b, defaultWidthUnits);
        for (let s = 1; s < joinSegments; s++) {
          const t = offsetAngle + sweep * (s / joinSegments);
          chain.push(offsetPoint(b, t, radius));
        }
      }
    }
  }

  return chain;
}

// 180-degree round cap centered on `point`, sweeping from `dirAngle + startOffset` down through
// `dirAngle + startOffset - PI` -- i.e. always through the segment's own forward/backward direction,
// never the short way across the stroke's width. Excludes both endpoints (the adjoining side chains
// already end exactly there).
function capArc(point, dirAngle, startOffset, radius, segments) {
  const points = [];
  for (let i = 1; i < segments; i++) {
    const a = dirAngle + startOffset - Math.PI * (i / segments);
    points.push(offsetPoint(point, a, radius));
  }
  return points;
}

/**
 * Build one stroke's ribbon outline(s).
 *
 * @returns {Array<Array<{xMm:number,yMm:number}>>} One polygon for an open stroke or a degenerate
 *   (single-point) stroke; an [outer, inner] contour pair for a closed stroke.
 */
function strokeToPolygons(stroke, defaultWidthUnits, { joinSegments = 6, capSegments = 10 } = {}) {
  const { points, closed } = stroke;
  const n = points.length;

  if (n === 1 || (n === 2 && points[0].x === points[1].x && points[0].y === points[1].y)) {
    const p = points[0];
    return [circlePolygon(p.x, p.y, radiusAt(p, defaultWidthUnits), Math.max(12, capSegments * 2))];
  }

  if (closed) {
    // For a counter-clockwise skeleton loop (every ellipse/arc helper in skeletonGlyphs.js
    // parametrizes with increasing angle, i.e. CCW), the right-hand offset (side -1) is outward and
    // the left-hand offset (side +1) is inward -- see module doc's worked example.
    const outer = buildSideChain(points, -1, true, defaultWidthUnits, joinSegments);
    const inner = buildSideChain(points, +1, true, defaultWidthUnits, joinSegments);
    return [outer, inner];
  }

  const leftChain = buildSideChain(points, +1, false, defaultWidthUnits, joinSegments);
  const rightChain = buildSideChain(points, -1, false, defaultWidthUnits, joinSegments);

  const last = points[n - 1];
  const lastDirAngle = segmentDirectionAngle(points, n - 2, n);
  const endCap = capArc(last, lastDirAngle, Math.PI / 2, radiusAt(last, defaultWidthUnits), capSegments);

  const first = points[0];
  const firstDirAngle = segmentDirectionAngle(points, 0, n);
  const startCap = capArc(first, firstDirAngle, -Math.PI / 2, radiusAt(first, defaultWidthUnits), capSegments);

  return [[...leftChain, ...endCap, ...rightChain.reverse(), ...startCap]];
}

/**
 * Build one glyph's outline contours from its skeleton strokes.
 *
 * @param {Array<{points: Array<{x:number,y:number,w?:number}>, closed?: boolean, width?: number}>} strokes
 * @param {number} defaultWidthUnits Fallback stroke width for strokes/points that don't set their own.
 * @param {{capsuleSegments?: number, targetSpacingMm?: number}} [options] `capsuleSegments` sets both
 *   the join and cap arc sampling density (kept as one dial for callers, matching the previous API).
 * @returns {Array<Array<{xMm:number, yMm:number}>>} Closed polygon contours in the same unit space as the input.
 */
export function buildGlyphOutline(strokes, defaultWidthUnits, { capsuleSegments = 10, targetSpacingMm } = {}) {
  const joinOptions = { joinSegments: Math.max(3, Math.round(capsuleSegments / 2)), capSegments: capsuleSegments };
  const sources = strokes
    .map((stroke) => strokeToPolygons(stroke, stroke.width ?? defaultWidthUnits, joinOptions))
    .filter((polygons) => polygons.length > 0)
    .map((polygons) => ({ kind: 'polygons', polygons }));

  if (sources.length === 0) return [];
  if (sources.length === 1) return sources[0].polygons;

  const { contours } = combineManyShapeSources(sources, 'union', targetSpacingMm ? { targetSpacingMm } : {});
  return contours;
}
