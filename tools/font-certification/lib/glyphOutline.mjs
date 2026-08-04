/**
 * Per-glyph outline analysis for FONT-CERT-001/002.
 *
 * Operates directly on opentype.js's raw Path commands (queried at
 * fontSize === font.unitsPerEm, i.e. 1:1 scale, so coordinates are plain
 * font units) rather than converting through src/text/VectorPath first --
 * that conversion (see OpenTypeProvider.js's convertGlyphCommandsToVectorPath)
 * deliberately force-closes every contour, which would erase the exact
 * "was this contour actually closed in the source file" signal Part 1 of
 * the certification needs. This module is read-only inspection; it never
 * feeds into GeometryEngine (productionAnalysis.mjs does that, through the
 * real OpenTypeProvider, unmodified).
 *
 * FONT-CERT-002: the zero-length-segment/self-intersection detectors below were audited against a
 * real quadratic-TrueType candidate (v003) that reported absurd counts (e.g. 697 "zero-length
 * segments" and 3681 "self-intersections" for a single glyph, 86000+ across the alphabet). Two
 * independent root causes were confirmed empirically (see the audit notes in FONT-CERT-002's final
 * report for the full before/after numbers):
 *
 *   1. Every raw "Q" (quadratic curve) command in that file's glyf table is immediately followed by
 *      a redundant "L" command whose target exactly duplicates the curve's own endpoint -- a benign,
 *      no-op source-file quirk (draws nothing, moves nowhere), not a manufacturing defect. Testing
 *      zero-length-segments against the *flattened* polygon counted every one of these as one more
 *      degenerate edge, wildly inflating the count.
 *   2. The self-intersection test's textbook "collinear/touching endpoint" special case (a segment
 *      whose orientation relative to another is ~0 *and* lies within its bounding box) fires
 *      constantly along any finely-tessellated smooth curve -- "nearly collinear and nearby" is the
 *      normal condition between consecutive samples of a curve, not evidence of a crossing. Dropping
 *      that branch and keeping only the strict transversal (sign-change-on-both-sides) crossing test
 *      took one real candidate from 86000+ reported "crossings" down to 26, all individually plausible.
 *
 * The fix has three parts, all load-bearing:
 *   - Zero-length/duplicate *raw* draw commands are now detected directly on the unflattened command
 *     stream (see findRawZeroLengthCommands()) -- this is the only place a redundant no-op command in
 *     the source file is meaningfully "a real thing to report", and it is reported at low severity,
 *     separately from geometric defects.
 *   - Self-intersection / duplicate-*segment* / coordinate-range analysis now run against a
 *     *deduplicated* flattened polygon (see dedupePolygonPoints()): consecutive points closer than an
 *     explicit, documented tolerance collapse into one vertex before any geometric test runs, and the
 *     closing edge (last point back to the first) is recognized as ordinary contour closure, never a
 *     zero-length or duplicate defect.
 *   - segmentsIntersect() tests only for a strict proper (transversal) crossing -- see its own doc
 *     comment for why the textbook collinear/touching special case was removed rather than tuned.
 */

const CURVE_FLATTEN_SEGMENTS = 16;
const CLOSURE_EPSILON_UNITS = 1; // font units; sub-pixel at any realistic unitsPerEm

// FONT-CERT-002: explicit numerical tolerances, expressed as a fraction of the font's own unitsPerEm
// so they scale correctly across fonts with different em sizes (500 / 1000 / 2048 are all common),
// rather than a fixed absolute unit count tuned to one specific font.
//
// DEDUP_TOLERANCE_EM_FRACTION: two consecutive points in a flattened polygon closer than this are
// the same vertex, not two real, distinct points -- collapses both curve-tessellation artifacts
// (adjacent samples on a very short curve) and redundant duplicate source commands into one point
// before any geometric test runs against them.
const DEDUP_TOLERANCE_EM_FRACTION = 0.0005; // 0.05% of em (0.5 units at 1000 upm)
// RAW_ZERO_LENGTH_EM_FRACTION: how close a raw L/Q/C command's endpoint must be to the current pen
// position to count as a genuine no-op draw command in the *source* file (checked on the unflattened
// command stream -- see findRawZeroLengthCommands()).
const RAW_ZERO_LENGTH_EM_FRACTION = 0.0005; // 0.05% of em
// ORIENTATION_EM_FRACTION: collinearity tolerance for the strict proper-crossing test, applied to a
// cross-product (area-like, squared-length units) so it is scaled by unitsPerEm^2 below, not
// unitsPerEm. Empirically validated against the v003 candidate (see the module doc comment above):
// this value reproduces the same crossing count at 8 and 16 curve-flattening segments per curve
// (a genuine crossing is stable under finer tessellation; a numerical artifact is not).
const ORIENTATION_EM_FRACTION = 1e-6;

const INT16_MIN = -32768;
const INT16_MAX = 32767;

function quadraticPointAt(p0, c, p1, t) {
  const mt = 1 - t;
  return {
    x: mt * mt * p0.x + 2 * mt * t * c.x + t * t * p1.x,
    y: mt * mt * p0.y + 2 * mt * t * c.y + t * t * p1.y
  };
}

function cubicPointAt(p0, c1, c2, p1, t) {
  const mt = 1 - t;
  return {
    x: mt * mt * mt * p0.x + 3 * mt * mt * t * c1.x + 3 * mt * t * t * c2.x + t * t * t * p1.x,
    y: mt * mt * mt * p0.y + 3 * mt * mt * t * c1.y + 3 * mt * t * t * c2.y + t * t * t * p1.y
  };
}

/**
 * Split a flat opentype.js Path.commands array into per-subpath command groups (one per 'M').
 */
function splitIntoSubpaths(commands) {
  const subpaths = [];
  let current = null;
  for (const command of commands) {
    if (command.type === 'M') {
      current = [];
      subpaths.push(current);
    }
    if (!current) continue; // malformed: command before any moveTo, ignored defensively
    current.push(command);
  }
  return subpaths;
}

/**
 * Detects genuine no-op zero-length draw commands directly on the raw (unflattened) command stream:
 * an L/Q/C command whose endpoint is within `toleranceUnits` of the current pen position draws
 * nothing and moves nowhere. This is a real (if harmless) source-file redundancy -- e.g. FONT-CERT-002
 * found every "Q" in one candidate immediately followed by a duplicate "L" to the same point -- and is
 * deliberately *not* computed from the flattened polygon, which would also count ordinary
 * curve-tessellation samples that merely happen to land close together on a short curve.
 */
function findRawZeroLengthCommands(commands, toleranceUnits) {
  let count = 0;
  let current = null;
  for (const command of commands) {
    switch (command.type) {
      case 'M':
        current = { x: command.x, y: command.y };
        break;
      case 'L':
      case 'Q':
      case 'C': {
        const end = { x: command.x, y: command.y };
        if (current && Math.hypot(end.x - current.x, end.y - current.y) <= toleranceUnits) count++;
        current = end;
        break;
      }
      default:
        break;
    }
  }
  return count;
}

/**
 * Flatten one subpath's raw commands (opentype.js {type,x,y,x1,y1,x2,y2}) into an ordered polygon of
 * {x,y} vertices in font units, plus closure metadata. This is intentionally *not* deduplicated --
 * callers that need geometric tests (self-intersection, duplicate segments) must call
 * dedupePolygonPoints() on the result first; callers that need the raw closure gap (open-contour
 * detection) want the un-deduplicated points.
 */
function flattenSubpath(commands) {
  const points = [];
  let current = null;
  let start = null;
  let hasExplicitClose = false;
  let curveCommandCount = 0;
  let lineCommandCount = 0;

  for (const command of commands) {
    switch (command.type) {
      case 'M':
        current = { x: command.x, y: command.y };
        start = current;
        points.push(current);
        break;
      case 'L':
        current = { x: command.x, y: command.y };
        points.push(current);
        lineCommandCount++;
        break;
      case 'Q': {
        const control = { x: command.x1, y: command.y1 };
        const end = { x: command.x, y: command.y };
        for (let step = 1; step <= CURVE_FLATTEN_SEGMENTS; step++) {
          points.push(quadraticPointAt(current, control, end, step / CURVE_FLATTEN_SEGMENTS));
        }
        current = end;
        curveCommandCount++;
        break;
      }
      case 'C': {
        const control1 = { x: command.x1, y: command.y1 };
        const control2 = { x: command.x2, y: command.y2 };
        const end = { x: command.x, y: command.y };
        for (let step = 1; step <= CURVE_FLATTEN_SEGMENTS; step++) {
          points.push(cubicPointAt(current, control1, control2, end, step / CURVE_FLATTEN_SEGMENTS));
        }
        current = end;
        curveCommandCount++;
        break;
      }
      case 'Z':
        hasExplicitClose = true;
        break;
      default:
        break;
    }
  }

  const last = points[points.length - 1] ?? null;
  const gapUnits = last && start ? Math.hypot(last.x - start.x, last.y - start.y) : 0;
  const implicitlyClosed = gapUnits <= CLOSURE_EPSILON_UNITS;

  return {
    points,
    isClosed: hasExplicitClose || implicitlyClosed,
    hasExplicitClose,
    gapUnits,
    curveCommandCount,
    lineCommandCount
  };
}

/**
 * Collapses consecutive points closer than `toleranceUnits` into one vertex, then merges the closing
 * edge (drops the final point if it duplicates the first) so a properly-closed contour's wraparound
 * edge is never mistaken for a zero-length or duplicate segment. This is the polygon every geometric
 * test (self-intersection, duplicate segments, coordinate range, area) should run against.
 */
function dedupePolygonPoints(points, toleranceUnits) {
  const deduped = [];
  for (const p of points) {
    const last = deduped[deduped.length - 1];
    if (!last || Math.hypot(p.x - last.x, p.y - last.y) > toleranceUnits) {
      deduped.push(p);
    }
  }
  if (deduped.length > 1) {
    const first = deduped[0];
    const last = deduped[deduped.length - 1];
    if (Math.hypot(first.x - last.x, first.y - last.y) <= toleranceUnits) {
      deduped.pop();
    }
  }
  return deduped;
}

function polygonSignedArea(points) {
  let sum = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    sum += a.x * b.y - b.x * a.y;
  }
  return sum / 2;
}

function polygonBoundingBox(points) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return { minX, minY, maxX, maxY };
}

function orientation(a, b, c, epsilon) {
  const value = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
  if (Math.abs(value) < epsilon) return 0;
  return value > 0 ? 1 : -1;
}

/**
 * FONT-CERT-002: strict *proper* (transversal) crossing test only -- deliberately does not special-
 * case the collinear/touching-endpoint configuration a textbook segment-intersection test usually
 * adds (o1===0 && the point lies within the other segment's bounding box, etc.). That branch was
 * audited against a real quadratic-TrueType candidate and found to be the actual root cause of a
 * reported "3681 self-intersections in one glyph" false positive: along a finely-tessellated smooth
 * curve (hundreds of nearly-but-not-exactly-collinear points), that branch fires constantly, because
 * "nearly collinear and nearby" is the normal, expected condition between consecutive samples of any
 * smooth curve, not a sign of a real crossing. A genuine self-intersecting outline (two contour
 * strands crossing transversally) is still caught correctly by the four-orientation sign-change test
 * alone; see tools/test-font-cert-002-outline-detector-fixtures.mjs for a synthetic known-bad fixture
 * proving that.
 */
function segmentsIntersect(a1, a2, b1, b2, epsilon) {
  const o1 = orientation(a1, a2, b1, epsilon);
  const o2 = orientation(a1, a2, b2, epsilon);
  const o3 = orientation(b1, b2, a1, epsilon);
  const o4 = orientation(b1, b2, a2, epsilon);
  return o1 !== 0 && o2 !== 0 && o3 !== 0 && o4 !== 0 && o1 !== o2 && o3 !== o4;
}

const pointKey = (p) => `${p.x.toFixed(2)},${p.y.toFixed(2)}`;

/**
 * Detect self-intersections within a closed, already-deduplicated polygon (adjacent segments sharing
 * an endpoint are excluded, since that is normal for any closed polyline). Distinct crossing pairs
 * are deduplicated by their approximate location so one true crossing is never counted more than once
 * even if several nearly-coincident segment pairs all register it.
 */
function findSelfIntersections(points, orientationEpsilon) {
  const n = points.length;
  if (n < 4) return 0;
  const foundAt = new Set();
  for (let i = 0; i < n; i++) {
    const a1 = points[i];
    const a2 = points[(i + 1) % n];
    for (let j = i + 1; j < n; j++) {
      const isAdjacent = j === i || j === (i + 1) % n || (j + 1) % n === i;
      if (isAdjacent) continue;
      const b1 = points[j];
      const b2 = points[(j + 1) % n];
      if (segmentsIntersect(a1, a2, b1, b2, orientationEpsilon)) {
        // Approximate crossing location (segment midpoint average) rounded to a coarse grid, so
        // multiple segment pairs that all detect essentially the same crossing collapse to one entry.
        const key = `${((a1.x + a2.x + b1.x + b2.x) / 4).toFixed(0)},${((a1.y + a2.y + b1.y + b2.y) / 4).toFixed(0)}`;
        foundAt.add(key);
      }
    }
  }
  return foundAt.size;
}

function findDuplicateSegments(points) {
  const seen = new Set();
  let duplicates = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    const key = [pointKey(a), pointKey(b)].sort().join('|');
    if (seen.has(key)) duplicates++;
    else seen.add(key);
  }
  return duplicates;
}

function countOutOfRangeCoordinates(points) {
  let count = 0;
  for (const p of points) {
    if (p.x < INT16_MIN || p.x > INT16_MAX || p.y < INT16_MIN || p.y > INT16_MAX) count++;
  }
  return count;
}

/**
 * Pure geometry analysis of a raw opentype.js-shaped commands array (no Font/Glyph object required)
 * -- the part of analyzeGlyphOutline() that has no dependency on a real parsed font, factored out
 * specifically so FONT-CERT-002's synthetic known-good/known-bad fixtures
 * (tools/test-font-cert-002-outline-detector-fixtures.mjs) can validate the detector's geometry logic
 * directly, without constructing a fake Font/Glyph object.
 *
 * @param {Array<{type:string,x?:number,y?:number,x1?:number,y1?:number,x2?:number,y2?:number}>} commands
 * @param {number} unitsPerEm
 * @returns {object} Every field analyzeGlyphOutline() returns except character/glyphIndex/isMissing/advanceWidthUnits/leftSideBearingUnits.
 */
export function analyzeOutlineCommands(commands, unitsPerEm) {
  const subpathCommands = splitIntoSubpaths(commands);

  const dedupToleranceUnits = unitsPerEm * DEDUP_TOLERANCE_EM_FRACTION;
  const rawZeroLengthToleranceUnits = unitsPerEm * RAW_ZERO_LENGTH_EM_FRACTION;
  const orientationEpsilon = unitsPerEm * unitsPerEm * ORIENTATION_EM_FRACTION;

  const subpaths = subpathCommands.map((commands) => {
    const flattened = flattenSubpath(commands);
    const dedupedPoints = dedupePolygonPoints(flattened.points, dedupToleranceUnits);
    const rawZeroLengthCommandCount = findRawZeroLengthCommands(commands, rawZeroLengthToleranceUnits);
    return { ...flattened, dedupedPoints, rawZeroLengthCommandCount };
  });

  const openSubpaths = subpaths.filter((s) => s.points.length >= 2 && !s.isClosed);
  const openSubpathCount = openSubpaths.length;
  const maxOpenGapUnits = openSubpaths.length > 0 ? Math.max(...openSubpaths.map((s) => s.gapUnits)) : 0;

  let selfIntersectionCount = 0;
  let zeroLengthSegmentCount = 0; // raw-command-level, see findRawZeroLengthCommands()
  let duplicateSegmentCount = 0;
  let outOfRangeCoordinateCount = 0;
  let curveCommandCount = 0;
  let lineCommandCount = 0;
  let signedAreaSum = 0;
  let boundingBox = null;

  for (const subpath of subpaths) {
    if (subpath.points.length < 2) continue;
    curveCommandCount += subpath.curveCommandCount;
    lineCommandCount += subpath.lineCommandCount;
    zeroLengthSegmentCount += subpath.rawZeroLengthCommandCount;
    const geometryPoints = subpath.dedupedPoints;
    if (geometryPoints.length >= 2) {
      selfIntersectionCount += findSelfIntersections(geometryPoints, orientationEpsilon);
      duplicateSegmentCount += findDuplicateSegments(geometryPoints);
      outOfRangeCoordinateCount += countOutOfRangeCoordinates(geometryPoints);
      signedAreaSum += Math.abs(polygonSignedArea(geometryPoints));
      const box = polygonBoundingBox(geometryPoints);
      boundingBox = boundingBox
        ? {
            minX: Math.min(boundingBox.minX, box.minX),
            minY: Math.min(boundingBox.minY, box.minY),
            maxX: Math.max(boundingBox.maxX, box.maxX),
            maxY: Math.max(boundingBox.maxY, box.maxY)
          }
        : box;
    }
  }

  // Cross-contour (inter-subpath) intersections: real anomalies for a well-formed glyph, since
  // separate contours in a glyph are meant to nest (holes) or stand apart, never cross. Also computed
  // against deduplicated points, and deduplicated by approximate location, for the same reasons as
  // findSelfIntersections() above.
  let crossContourIntersectionCount = 0;
  const crossContourFoundAt = new Set();
  for (let i = 0; i < subpaths.length; i++) {
    const pointsA = subpaths[i].dedupedPoints;
    if (pointsA.length < 2) continue;
    for (let j = i + 1; j < subpaths.length; j++) {
      const pointsB = subpaths[j].dedupedPoints;
      if (pointsB.length < 2) continue;
      countCrossPolygonIntersections(pointsA, pointsB, orientationEpsilon, crossContourFoundAt);
    }
  }
  crossContourIntersectionCount = crossContourFoundAt.size;

  return {
    contourCount: subpaths.filter((s) => s.points.length >= 2).length,
    isEmpty: subpaths.every((s) => s.points.length < 2),
    openContourCount: openSubpathCount,
    maxOpenGapUnits,
    // Percent of the font's own em square (a fixed, font-wide reference), not the individual
    // glyph's own bounding-box height -- a small glyph like "." or "-" has a tiny bbox, so the same
    // absolute gap would otherwise read as a much larger (and misleading) percentage than the
    // identical gap on a full-height letter.
    maxOpenGapPercentOfEm: (maxOpenGapUnits / unitsPerEm) * 100,
    selfIntersectionCount,
    crossContourIntersectionCount,
    zeroLengthSegmentCount,
    duplicateSegmentCount,
    outOfRangeCoordinateCount,
    curveCommandCount,
    lineCommandCount,
    isPolylineOnly: curveCommandCount === 0 && lineCommandCount > 0,
    filledAreaUnits: signedAreaSum,
    boundingBoxUnits: boundingBox,
    subpaths
  };
}

/**
 * Full geometry analysis for one character's glyph outline, plus glyph metadata (index, advance
 * width, side bearing) that only a real parsed Font/Glyph object can provide.
 *
 * @param {import('opentype.js').Font} font
 * @param {string} character
 * @returns {object}
 */
export function analyzeGlyphOutline(font, character) {
  const glyphIndex = font.charToGlyphIndex(character);
  const glyph = font.charToGlyph(character);
  const path = glyph.getPath(0, 0, font.unitsPerEm);

  return {
    character,
    glyphIndex,
    isMissing: glyphIndex === 0 && character !== ' ',
    advanceWidthUnits: glyph.advanceWidth ?? 0,
    leftSideBearingUnits: glyph.leftSideBearing ?? null,
    ...analyzeOutlineCommands(path.commands, font.unitsPerEm)
  };
}

function countCrossPolygonIntersections(pointsA, pointsB, orientationEpsilon, foundAt) {
  for (let i = 0; i < pointsA.length; i++) {
    const a1 = pointsA[i];
    const a2 = pointsA[(i + 1) % pointsA.length];
    for (let j = 0; j < pointsB.length; j++) {
      const b1 = pointsB[j];
      const b2 = pointsB[(j + 1) % pointsB.length];
      if (segmentsIntersect(a1, a2, b1, b2, orientationEpsilon)) {
        const key = `${((a1.x + a2.x + b1.x + b2.x) / 4).toFixed(0)},${((a1.y + a2.y + b1.y + b2.y) / 4).toFixed(0)}`;
        foundAt.add(key);
      }
    }
  }
}

/**
 * Normalized (translated to bbox center, scaled to unit height) point set for a glyph outline --
 * used by shape-similarity comparisons between confusable character pairs (Part 2 typography
 * findings). Combines every subpath's deduplicated flattened points into one set.
 */
export function normalizedOutlinePoints(glyphAnalysis) {
  const box = glyphAnalysis.boundingBoxUnits;
  if (!box || box.maxY <= box.minY) return [];
  const scale = 1 / (box.maxY - box.minY);
  const cx = (box.minX + box.maxX) / 2;
  const cy = (box.minY + box.maxY) / 2;
  const points = [];
  for (const subpath of glyphAnalysis.subpaths) {
    for (const p of subpath.dedupedPoints) {
      points.push({ x: (p.x - cx) * scale, y: (p.y - cy) * scale });
    }
  }
  return points;
}
