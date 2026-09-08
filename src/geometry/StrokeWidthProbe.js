/**
 * MONO-015 -- local stroke-width probe.
 *
 * Pure geometry: given flattened millimeter polygons (the same `Point2D[][]` shape every
 * StoneSampler.js function already consumes -- already positioned, already in mm) and a point on
 * one of those contours, measure how wide the stroke is at that point by casting a ray straight
 * into the shape's interior and returning the distance to the first contour edge it crosses.
 *
 * No GeometryEngine, font, renderer, export, or stone-size-catalog dependency. The size-mapping
 * step that turns a measured width into a catalog stone diameter lives separately in
 * src/geometry/WeightSizing.js.
 */

import { Point2D } from '../text/VectorPath.js';

const ON_EDGE_EPS_MM = 1e-6;

/** Signed area of a closed polygon (shoelace / 2). Sign encodes winding; used only for orientation. */
function signedAreaMm2(polygon) {
  let sum = 0;
  for (let i = 0, n = polygon.length; i < n; i++) {
    const a = polygon[i];
    const b = polygon[(i + 1) % n];
    sum += a.xMm * b.yMm - b.xMm * a.yMm;
  }
  return sum / 2;
}

function cross(ax, ay, bx, by) {
  return ax * by - ay * bx;
}

/** Even-odd point-in-polygons test (self-contained; matches StoneSampler.isPointInsidePolygons()). */
function pointInsidePolygons(xMm, yMm, polygons) {
  let inside = false;
  for (const polygon of polygons) {
    const n = polygon.length;
    for (let i = 0, j = n - 1; i < n; j = i++) {
      const vi = polygon[i];
      const vj = polygon[j];
      if (
        (vi.yMm > yMm) !== (vj.yMm > yMm) &&
        xMm < ((vj.xMm - vi.xMm) * (yMm - vi.yMm)) / (vj.yMm - vi.yMm) + vi.xMm
      ) {
        inside = !inside;
      }
    }
  }
  return inside;
}

/**
 * Distance from `point` along the unit vector `inwardNormal` to the first crossing of any edge of
 * any polygon in `polygons`, excluding the edge (or vertex) the point itself lies on, capped at
 * `maxMm`. `polygons` are closed contours. Returns `maxMm` when nothing is crossed within `maxMm`.
 *
 * @param {{xMm:number,yMm:number}} point
 * @param {{xMm:number,yMm:number}} inwardNormal Unit vector pointing into the shape interior.
 * @param {{xMm:number,yMm:number}[][]} polygons
 * @param {number} maxMm
 * @returns {number}
 */
export function localStrokeWidthMm(point, inwardNormal, polygons, maxMm) {
  if (!(maxMm > 0)) return 0;
  const rx = inwardNormal.xMm;
  const ry = inwardNormal.yMm;
  let nearestMm = maxMm;

  for (const polygon of polygons) {
    const n = polygon.length;
    if (n < 2) continue;
    for (let i = 0; i < n; i++) {
      const a = polygon[i];
      const b = polygon[(i + 1) % n];
      const sx = b.xMm - a.xMm;
      const sy = b.yMm - a.yMm;
      const denom = cross(rx, ry, sx, sy);
      if (Math.abs(denom) < 1e-12) continue; // ray parallel to this edge
      const qpx = a.xMm - point.xMm;
      const qpy = a.yMm - point.yMm;
      const t = cross(qpx, qpy, sx, sy) / denom;   // mm along the ray (inwardNormal is unit)
      const u = cross(qpx, qpy, rx, ry) / denom;   // position along the edge, [0,1]
      if (t <= ON_EDGE_EPS_MM) continue;           // behind the origin, or the edge the point lies on
      if (u < -1e-9 || u > 1 + 1e-9) continue;     // crossing falls outside the edge segment
      if (t < nearestMm) nearestMm = t;
    }
  }

  return nearestMm;
}

/**
 * Per-sample local stroke width for a set of points that were sampled from `polygons`' own
 * contours (StoneSampler.sampleMultiContourOutlinePoints() survivors). For each sample: find the
 * nearest contour edge, take that edge's tangent, rotate it 90 degrees toward the interior (the
 * sign chosen from the containing contour's signed area so glyph holes -- which wind opposite to
 * their outer contour -- probe toward the stroke body, not into the counter), and probe with
 * localStrokeWidthMm().
 *
 * @param {{xMm:number,yMm:number}[]} samples
 * @param {{xMm:number,yMm:number}[][]} polygons
 * @param {number} maxMm
 * @returns {number[]} Parallel to `samples`; each entry in (0, maxMm].
 */
export function strokeWidthsForSamples(samples, polygons, maxMm) {
  const contourOrientation = polygons.map((polygon) => (signedAreaMm2(polygon) >= 0 ? 1 : -1));

  // Flatten every edge once, with the edge's own tangent and its contour's winding sign.
  const edges = [];
  for (let c = 0; c < polygons.length; c++) {
    const polygon = polygons[c];
    const n = polygon.length;
    if (n < 2) continue;
    for (let i = 0; i < n; i++) {
      const a = polygon[i];
      const b = polygon[(i + 1) % n];
      const sx = b.xMm - a.xMm;
      const sy = b.yMm - a.yMm;
      const lenSq = sx * sx + sy * sy;
      if (lenSq < 1e-18) continue;
      const invLen = 1 / Math.sqrt(lenSq);
      edges.push({ ax: a.xMm, ay: a.yMm, sx, sy, lenSq, tx: sx * invLen, ty: sy * invLen, orient: contourOrientation[c] });
    }
  }

  const NEAREST_EDGE_COUNT = 4;
  const nudgeMm = Math.min(maxMm, 0.05);

  return samples.map((sample) => {
    // The few boundary edges closest to this sample. A single "nearest edge" over-reads at a stroke
    // terminal (the end cap's inward normal runs down the stroke's length, not across it); trying
    // each of the nearest few edges and keeping the tightest crossing reads the true cross-width at
    // terminals, corners and hairlines alike, and never over-reads through a junction.
    const scored = edges.map((edge) => {
      let tParam = ((sample.xMm - edge.ax) * edge.sx + (sample.yMm - edge.ay) * edge.sy) / edge.lenSq;
      if (tParam < 0) tParam = 0; else if (tParam > 1) tParam = 1;
      const projX = edge.ax + edge.sx * tParam;
      const projY = edge.ay + edge.sy * tParam;
      return { edge, dSq: (sample.xMm - projX) ** 2 + (sample.yMm - projY) ** 2 };
    });
    scored.sort((p, q) => p.dSq - q.dSq);

    let widthMm = maxMm;
    for (let k = 0; k < Math.min(NEAREST_EDGE_COUNT, scored.length); k++) {
      const edge = scored[k].edge;
      // Left-hand normal of the edge tangent, oriented by its contour's signed-area winding (glyph
      // holes wind opposite their outer contour, so this points toward the stroke body for both).
      let nx = -edge.ty * edge.orient;
      let ny = edge.tx * edge.orient;
      if (!pointInsidePolygons(sample.xMm + nx * nudgeMm, sample.yMm + ny * nudgeMm, polygons) &&
          pointInsidePolygons(sample.xMm - nx * nudgeMm, sample.yMm - ny * nudgeMm, polygons)) {
        nx = -nx;
        ny = -ny;
      } else if (!pointInsidePolygons(sample.xMm + nx * nudgeMm, sample.yMm + ny * nudgeMm, polygons)) {
        continue; // neither side is interior at this edge -- not a usable probe direction
      }
      const w = localStrokeWidthMm(sample, { xMm: nx, yMm: ny }, polygons, maxMm);
      if (w > 0 && w < widthMm) widthMm = w;
    }

    // Every directed probe shot along the stroke (a terminal, a sharp cusp) and found no opposite
    // wall. Fall back to the straight-line distance to the nearest edge the sample is not already
    // on -- a safe upper bound on the local cross-width, never the maximum stone size.
    if (widthMm >= maxMm) {
      for (const s of scored) {
        if (s.dSq > 1e-8) { widthMm = Math.min(maxMm, 2 * Math.sqrt(s.dSq)); break; }
      }
    }
    return widthMm;
  });
}

export { Point2D };
