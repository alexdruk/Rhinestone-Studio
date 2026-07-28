/**
 * Per-glyph outline analysis for FONT-CERT-001.
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
 */

const CURVE_FLATTEN_SEGMENTS = 16;
const CLOSURE_EPSILON_UNITS = 1; // font units; sub-pixel at any realistic unitsPerEm
const ZERO_LENGTH_EPSILON_UNITS = 0.5;
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
 * Flatten one subpath's commands (raw opentype.js {type,x,y,x1,y1,x2,y2}) into an ordered
 * polygon of {x,y} vertices in font units, plus closure metadata.
 */
function analyzeSubpath(commands) {
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

function orientation(a, b, c) {
  const value = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
  if (Math.abs(value) < 1e-9) return 0;
  return value > 0 ? 1 : -1;
}

function onSegment(a, b, p) {
  return (
    Math.min(a.x, b.x) - 1e-6 <= p.x && p.x <= Math.max(a.x, b.x) + 1e-6 &&
    Math.min(a.y, b.y) - 1e-6 <= p.y && p.y <= Math.max(a.y, b.y) + 1e-6
  );
}

/** True proper/point-on-segment intersection test between segments (a1,a2) and (b1,b2). */
function segmentsIntersect(a1, a2, b1, b2) {
  const o1 = orientation(a1, a2, b1);
  const o2 = orientation(a1, a2, b2);
  const o3 = orientation(b1, b2, a1);
  const o4 = orientation(b1, b2, a2);

  if (o1 !== o2 && o3 !== o4) return true;
  if (o1 === 0 && onSegment(a1, a2, b1)) return true;
  if (o2 === 0 && onSegment(a1, a2, b2)) return true;
  if (o3 === 0 && onSegment(b1, b2, a1)) return true;
  if (o4 === 0 && onSegment(b1, b2, a2)) return true;
  return false;
}

const pointKey = (p) => `${p.x.toFixed(2)},${p.y.toFixed(2)}`;

/**
 * Detect self-intersections within a closed polygon (adjacent segments sharing an endpoint are
 * excluded, since that is normal for any closed polyline).
 */
function findSelfIntersections(points) {
  const n = points.length;
  if (n < 4) return 0;
  let count = 0;
  for (let i = 0; i < n; i++) {
    const a1 = points[i];
    const a2 = points[(i + 1) % n];
    for (let j = i + 1; j < n; j++) {
      const isAdjacent = j === i || j === (i + 1) % n || (j + 1) % n === i;
      if (isAdjacent) continue;
      const b1 = points[j];
      const b2 = points[(j + 1) % n];
      if (segmentsIntersect(a1, a2, b1, b2)) count++;
    }
  }
  return count;
}

function findZeroLengthSegments(points) {
  let count = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    if (Math.hypot(a.x - b.x, a.y - b.y) <= ZERO_LENGTH_EPSILON_UNITS) count++;
  }
  return count;
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
 * Full geometry analysis for one character's glyph outline.
 *
 * @param {import('opentype.js').Font} font
 * @param {string} character
 * @returns {object}
 */
export function analyzeGlyphOutline(font, character) {
  const glyphIndex = font.charToGlyphIndex(character);
  const glyph = font.charToGlyph(character);
  const path = glyph.getPath(0, 0, font.unitsPerEm);
  const subpathCommands = splitIntoSubpaths(path.commands);
  const subpaths = subpathCommands.map(analyzeSubpath);

  const openSubpaths = subpaths.filter((s) => s.points.length >= 2 && !s.isClosed);
  const openSubpathCount = openSubpaths.length;
  const maxOpenGapUnits = openSubpaths.length > 0 ? Math.max(...openSubpaths.map((s) => s.gapUnits)) : 0;
  let selfIntersectionCount = 0;
  let zeroLengthSegmentCount = 0;
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
    selfIntersectionCount += findSelfIntersections(subpath.points);
    zeroLengthSegmentCount += findZeroLengthSegments(subpath.points);
    duplicateSegmentCount += findDuplicateSegments(subpath.points);
    outOfRangeCoordinateCount += countOutOfRangeCoordinates(subpath.points);
    signedAreaSum += Math.abs(polygonSignedArea(subpath.points));
    const box = polygonBoundingBox(subpath.points);
    boundingBox = boundingBox
      ? {
          minX: Math.min(boundingBox.minX, box.minX),
          minY: Math.min(boundingBox.minY, box.minY),
          maxX: Math.max(boundingBox.maxX, box.maxX),
          maxY: Math.max(boundingBox.maxY, box.maxY)
        }
      : box;
  }

  // Cross-contour (inter-subpath) intersections: real anomalies for a well-formed glyph, since
  // separate contours in a glyph are meant to nest (holes) or stand apart, never cross.
  let crossContourIntersectionCount = 0;
  for (let i = 0; i < subpaths.length; i++) {
    if (subpaths[i].points.length < 2) continue;
    for (let j = i + 1; j < subpaths.length; j++) {
      if (subpaths[j].points.length < 2) continue;
      crossContourIntersectionCount += countCrossPolygonIntersections(subpaths[i].points, subpaths[j].points);
    }
  }

  return {
    character,
    glyphIndex,
    isMissing: glyphIndex === 0 && character !== ' ',
    advanceWidthUnits: glyph.advanceWidth ?? 0,
    leftSideBearingUnits: glyph.leftSideBearing ?? null,
    contourCount: subpaths.filter((s) => s.points.length >= 2).length,
    isEmpty: subpaths.every((s) => s.points.length < 2),
    openContourCount: openSubpathCount,
    maxOpenGapUnits,
    // Percent of the font's own em square (a fixed, font-wide reference), not the individual
    // glyph's own bounding-box height -- a small glyph like "." or "-" has a tiny bbox, so the same
    // absolute gap would otherwise read as a much larger (and misleading) percentage than the
    // identical gap on a full-height letter.
    maxOpenGapPercentOfEm: (maxOpenGapUnits / font.unitsPerEm) * 100,
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

function countCrossPolygonIntersections(pointsA, pointsB) {
  let count = 0;
  for (let i = 0; i < pointsA.length; i++) {
    const a1 = pointsA[i];
    const a2 = pointsA[(i + 1) % pointsA.length];
    for (let j = 0; j < pointsB.length; j++) {
      const b1 = pointsB[j];
      const b2 = pointsB[(j + 1) % pointsB.length];
      if (segmentsIntersect(a1, a2, b1, b2)) count++;
    }
  }
  return count;
}

/**
 * Normalized (translated to bbox center, scaled to unit height) point set for a glyph outline --
 * used by shape-similarity comparisons between confusable character pairs (Part 2 typography
 * findings). Combines every subpath's flattened points into one set.
 */
export function normalizedOutlinePoints(glyphAnalysis) {
  const box = glyphAnalysis.boundingBoxUnits;
  if (!box || box.maxY <= box.minY) return [];
  const scale = 1 / (box.maxY - box.minY);
  const cx = (box.minX + box.maxX) / 2;
  const cy = (box.minY + box.maxY) / 2;
  const points = [];
  for (const subpath of glyphAnalysis.subpaths) {
    for (const p of subpath.points) {
      points.push({ x: (p.x - cx) * scale, y: (p.y - cy) * scale });
    }
  }
  return points;
}
