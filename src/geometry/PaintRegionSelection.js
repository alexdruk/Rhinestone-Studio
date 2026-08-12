/**
 * RS-3011 Step 10b — Paint tool target selection (Phase A: pure geometry, no UI/interaction).
 *
 * When a Paint lasso is released it must decide which existing 'path' layer the resulting region
 * belongs to. Sasha's decision (confirmed during this step's scoping): the target is whichever
 * candidate 'path' layer the lasso overlaps MOST, by intersection area -- not whichever shape
 * contains the lasso's centroid. A lasso drawn mostly outside its intended target (e.g. a rough
 * hand-drawn stroke that only clips the near edge of a small shape) can easily have its centroid
 * land outside every candidate, or inside the wrong one, while still overlapping its intended target
 * more than any other -- best-overlap is the more robust reading of "which shape did the user mean
 * to paint" for exactly that case. If a lasso overlaps no candidate at all, selectPaintTarget()
 * returns null and the caller must discard the stroke silently (no region, no history entry) --
 * matching this codebase's existing "no usable stroke" discard precedent, see the comment at
 * src/drawing/DrawingCanvasTool.js:67.
 *
 * This is a deliberate departure from the `drawleather` reference this step's own `drawleather`
 * check (RS-3011-design-primary-view-scope.md, Step 10) points to, not an oversight:
 * `src/tools/FillTool.ts` there picks its target with a single cheap hit-test at the lasso's own
 * bounding-box center, falling back to the current selection and then to the project's first piece
 * -- it never gives up, and it stores the raw, unclipped lasso path as the decoration's region data
 * (nothing downstream constrains a decoration to its piece's own boundary). Neither transfers here:
 * Sasha explicitly chose best-overlap over centroid, and unlike FillTool.ts, this app's own
 * `GeometryEngine._applyPathRegions()` (Step 10a) samples `region.contour` directly with no
 * containment check against the parent shape's own outline -- an unclipped region here would place
 * stones outside the visible shape. So: best-overlap selection (not centroid), clip-before-store (a
 * region here is the CLIPPED intersection contour, not the raw lasso), and discard on zero overlap
 * (not "always land somewhere") are all intentional.
 */

import { combineShapeSources, contourAreaAbs, MIN_CELL_SIZE_MM } from './PathBoolean.js';
import { computeNaturalContourTransform, applyNaturalContourTransform } from './GeometryEngine.js';

// combineShapeSources()'s own marching-squares tracer already discards any contour whose area
// doesn't clear (actualCellSizeMm**2)/4 as tracing noise (see PathBoolean.js's traceCombinedMask()),
// and actualCellSizeMm is always >= MIN_CELL_SIZE_MM (its own hard floor -- see
// computeAdaptiveCellSizeMm()). So any contour that survives that filter already clears this same
// floor computed at the FINEST possible resolution; a total overlap area at or below it is
// indistinguishable from "no real overlap," not a bare `=== 0` check against floating-point noise.
const OVERLAP_AREA_EPSILON_MM2 = (MIN_CELL_SIZE_MM * MIN_CELL_SIZE_MM) / 4;

function totalContourAreaMm2(contours) {
  return contours.reduce((sum, contour) => sum + contourAreaAbs(contour), 0);
}

/**
 * Picks the 'path' layer a just-released Paint lasso targets, by largest intersection area -- see
 * this module's own header comment for why largest-overlap wins over a centroid test.
 *
 * @param {{xMm:number,yMm:number}[][]} lassoPolygons The closed lasso stroke, absolute mm.
 * @param {{layerId:string, polygons:{xMm:number,yMm:number}[][]}[]} candidates Every 'path' layer
 *   currently on the canvas, polygons from GeometryEngine.resolvePathPolygons(), absolute mm.
 * @param {object} [options]
 * @param {number} [options.targetSpacingMm] The target shape's own stoneSizeMm+gapMm (or
 *   getStoneDefaults()'s values when no target is picked yet), forwarded to combineShapeSources()
 *   to tighten the intersection's grid resolution -- see combineShapeSources()'s own doc comment.
 * @returns {{layerId:string, contours:{xMm:number,yMm:number}[][], area:number}|null} null when
 *   every candidate's overlap area is ~0 (the lasso touches nothing).
 */
export function selectPaintTarget(lassoPolygons, candidates, options = {}) {
  const lassoSource = { kind: 'polygons', polygons: lassoPolygons };
  let best = null;

  for (const candidate of candidates) {
    const candidateSource = { kind: 'polygons', polygons: candidate.polygons };
    const { contours } = combineShapeSources(lassoSource, candidateSource, 'intersect', {
      targetSpacingMm: options.targetSpacingMm
    });
    const area = totalContourAreaMm2(contours);
    if (area <= OVERLAP_AREA_EPSILON_MM2) {
      continue;
    }
    if (!best || area > best.area) {
      best = { layerId: candidate.layerId, contours, area };
    }
  }

  return best;
}

/**
 * Converts absolute-mm polygons (e.g. selectPaintTarget()'s own intersection contours) into the
 * SAME 0,0-rooted natural-space convention `pathLayer.contours` already uses, by inverting the
 * exact transform GeometryEngine's computeNaturalContourTransform()/_placeNaturalContours() derive
 * from that layer's own natural contours -- never an independently-recomputed scale/translate (see
 * that function's own doc comment for why reusing it matters: a region's natural bounding box is
 * almost always smaller than the parent shape's, so re-deriving scale from the region's own points
 * would distort it relative to the shape it must track). This is exactly Step 10a's own
 * `_applyPathRegions()` concern in reverse: that function places a stored natural-space
 * `region.contour` onto the canvas; this converts a canvas-space (absolute mm) selection back into
 * that same stored form before it is ever saved.
 *
 * @param {{xMm:number,yMm:number}[][]} polygonsAbsoluteMm
 * @param {object} pathLayer A raw project.layers 'path' layer: `contours` ({x,y}[][], the project's
 *   own on-disk point-field convention -- see app.js's generatePathStonesLive() for the same
 *   {x,y}->{xMm,yMm} remap this function performs), plus `x`/`y`/`w`/`h` placement fields.
 * @returns {{xMm:number,yMm:number}[][]} Empty when the layer's own `contours` has no points.
 */
export function absolutePolygonsToNaturalSpace(polygonsAbsoluteMm, pathLayer) {
  const naturalContours = pathLayer.contours.map((contour) => contour.map((p) => ({ xMm: p.x, yMm: p.y })));
  const transform = computeNaturalContourTransform(naturalContours, pathLayer.x, pathLayer.y, pathLayer.w, pathLayer.h);
  if (!transform) {
    return [];
  }

  // Inverts transform.xMm + p * scaleX (the forward map) by solving for p: an absolute point maps
  // back to natural space via (abs - transform.xMm) / scaleX, which is itself exactly the shape
  // applyNaturalContourTransform() expects -- so the SAME function runs the inverse, just fed an
  // inverted transform, rather than a second hand-written point-mapping loop.
  const inverseTransform = {
    xMm: -transform.xMm / transform.scaleX,
    yMm: -transform.yMm / transform.scaleY,
    scaleX: 1 / transform.scaleX,
    scaleY: 1 / transform.scaleY
  };

  return polygonsAbsoluteMm.map((polygon) => applyNaturalContourTransform(polygon, inverseTransform));
}
