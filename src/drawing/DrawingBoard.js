/**
 * DrawingBoard — RS-3010 Step 1's path data model: viewport pan/zoom state plus a reference to
 * whatever Paper.js Path is currently mid-stroke. Mirrors StoneLayout.js's "state a shape, don't
 * own its editing history" compactness -- this holds plain data, not a scene graph, and knows
 * nothing about DOM events or Paper.js's Tool/View classes (that glue lives in
 * DrawingCanvasTool.js). commitHistory()/undo/redo are untouched by this module; a drawn shape
 * only enters that system once DrawingCanvasTool.js's commit() turns it into a real 'path' layer.
 *
 * Units: zoom is a unitless multiplier applied on top of a caller-supplied base px-per-mm scale
 * (see drawingBaseScale()); panXmm/panYmm are offsets, in the same Y-down millimeter space as the
 * rest of this app (project.canvas), from the drawing surface's own center.
 */

export const DRAWING_ZOOM_MIN = 0.2;
export const DRAWING_ZOOM_MAX = 8;

export class DrawingBoard {
  constructor() {
    this.active = false;
    this.zoom = 1;
    this.panXmm = 0;
    this.panYmm = 0;
    this.path = null;
  }

  reset() {
    this.zoom = 1;
    this.panXmm = 0;
    this.panYmm = 0;
    this.path = null;
  }

  zoomBy(factor) {
    this.zoom = Math.max(DRAWING_ZOOM_MIN, Math.min(DRAWING_ZOOM_MAX, this.zoom * factor));
  }

  panBy(dxMm, dyMm) {
    this.panXmm += dxMm;
    this.panYmm += dyMm;
  }

  beginPath(path) {
    this.path = path;
  }

  clearPath() {
    if (this.path) this.path.remove();
    this.path = null;
  }
}

/**
 * Base fit-to-canvas px-per-mm scale for the drawing viewport, before DrawingBoard's own `zoom`
 * multiplier is applied -- the same "fit an mm rectangle into a pixel viewport with padding" idea
 * as CanvasRenderer2D.js's fitTransform(), computed independently of it: this viewport keeps its
 * own persistent pan/zoom on top (DrawingBoard.zoom/panXmm/panYmm), unlike the main 2D canvas's
 * fixed transform, which is recomputed fresh every render.
 */
export function drawingBaseScale(canvasMm, viewportWidthPx, viewportHeightPx, paddingPx) {
  return Math.min(
    (viewportWidthPx - paddingPx * 2) / Math.max(1, canvasMm.width),
    (viewportHeightPx - paddingPx * 2) / Math.max(1, canvasMm.height)
  );
}

/**
 * Flatten a (simplified) Paper.js Path into a plain (0,0)-rooted point-array contour plus its
 * natural placement box -- the shape GeometryEngine.generatePathLayout() requires (see
 * docs/specifications/RS-3010-drawing-board-build.md's "Correction to this phase's brief": no SVG
 * round-trip, contours go straight in). `path` is expected in millimeter project-space already
 * (DrawingCanvasTool.js keeps Paper.js's own project units == mm); flattenToleranceMm controls how
 * closely the emitted straight segments approximate the drawn curve. Returns null for a
 * degenerate path (fewer than 3 resulting points).
 */
export function flattenPathToContour(path, flattenToleranceMm) {
  const flat = path.clone({ insert: false });
  flat.flatten(flattenToleranceMm);
  const points = flat.segments.map((seg) => ({ x: seg.point.x, y: seg.point.y }));
  flat.remove();
  if (points.length < 3) return null;

  const minX = Math.min(...points.map((p) => p.x));
  const minY = Math.min(...points.map((p) => p.y));
  const maxX = Math.max(...points.map((p) => p.x));
  const maxY = Math.max(...points.map((p) => p.y));

  return {
    contour: points.map((p) => ({ x: p.x - minX, y: p.y - minY })),
    xMm: minX,
    yMm: minY,
    widthMm: Math.max(2, maxX - minX),
    heightMm: Math.max(2, maxY - minY)
  };
}

/**
 * Build a 'path' layer object from a flattened contour -- the exact shape app.js's Boolean
 * Operations code already constructs for its own results (`newLayer`), so it can be pushed into
 * project.layers and run through GeometryEngine.generatePathLayout()/updateAll() completely
 * unchanged.
 */
export function createPathLayerFromContour(flattened, { stoneSize, gap, color, pathName }) {
  return {
    id: 'path' + Date.now(),
    type: 'path',
    visible: true,
    pathName,
    contours: [flattened.contour],
    x: flattened.xMm,
    y: flattened.yMm,
    w: flattened.widthMm,
    h: flattened.heightMm,
    stoneSize,
    gap,
    color
  };
}
