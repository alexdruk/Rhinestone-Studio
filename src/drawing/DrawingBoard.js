/**
 * DrawingBoard — RS-3010 Step 2a's path data model: viewport pan/zoom state, a reference to
 * whatever Paper.js Item is currently mid-drag (`path`, freehand mid-stroke or a preset's live
 * drag-preview), and a collection of already-finalized shapes (`shapes`, each a stable string id
 * paired with its committed Paper.js Item). Mirrors StoneLayout.js's "state a shape, don't own its
 * editing history" compactness -- this holds plain data, not a scene graph, and knows nothing
 * about DOM events or Paper.js's Tool/View classes (that glue lives in DrawingCanvasTool.js).
 * commitHistory()/undo/redo are untouched by this module; a drawn shape only enters that system
 * once DrawingCanvasTool.js's commit() turns it into a real 'path' layer.
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
    this.shapes = [];
    this._counter = 0;
  }

  reset() {
    this.zoom = 1;
    this.panXmm = 0;
    this.panYmm = 0;
    this.path = null;
    this.shapes = [];
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

  /**
   * Move the in-progress item (`this.path`) into the finalized `shapes` collection, assigning it
   * a stable id via an internal counter (not Date.now() -- multiple shapes, e.g. two quick preset
   * drags, can finalize within the same millisecond). Stores the id on the Paper.js item itself
   * (`item.data.shapeId`) so hit-testing can read it back. Returns the new id, or null if there is
   * no in-progress item to finalize.
   */
  finalizeShape() {
    if (!this.path) return null;
    const id = 'shape' + (++this._counter);
    this.path.data.shapeId = id;
    this.shapes.push({ id, item: this.path });
    this.path = null;
    return id;
  }

  /**
   * RS-3011 Step 2 fix: adds an already-built Paper.js Item directly to the finalized `shapes`
   * collection, assigning it a stable id the same way finalizeShape() does (an internal counter,
   * not derived from the item itself) -- used when a shape is produced programmatically (Duplicate)
   * rather than drawn through the normal path->finalizeShape() flow. Stamps `item.data.shapeId` the
   * same way finalizeShape() does, for the same hit-testing reason.
   * @param {paper.Item} item
   * @returns {string} the new shape's id
   */
  addShape(item) {
    const id = 'shape' + (++this._counter);
    item.data.shapeId = id;
    this.shapes.push({ id, item });
    return id;
  }

  /** Removes the finalized shape with the given id from both the Paper.js scene and `shapes`. */
  removeShape(id) {
    const index = this.shapes.findIndex((s) => s.id === id);
    if (index === -1) return;
    this.shapes[index].item.remove();
    this.shapes.splice(index, 1);
  }

  /** @returns {{id:string,item:paper.Item}|null} The finalized shape entry for `id`, or null. */
  getShape(id) {
    return this.shapes.find((s) => s.id === id) || null;
  }

  /** @returns {{id:string,item:paper.Item}[]} A shallow copy of the finalized shapes collection. */
  listShapes() {
    return this.shapes.slice();
  }

  /**
   * Discards every in-progress and finalized item -- what exit() without committing should call,
   * the same discard-on-exit behavior Step 1 had for its single path, now extended to every shape.
   */
  clearAll() {
    this.clearPath();
    for (const shape of this.shapes) shape.item.remove();
    this.shapes = [];
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
 *
 * `closed` mirrors the source item's own `path.closed` (a freehand stroke that never looped back to
 * its start is open; every other shape kind -- Rect/Ellipse/Slot/Polygon, and a freehand stroke the
 * user did close -- is closed) -- see StoneSampler.js's outline sampler, which otherwise defaults to
 * treating every contour as closed and would synthesize a spurious closing edge across an open one.
 */
export function flattenPathToContour(path, flattenToleranceMm) {
  const flat = path.clone({ insert: false });
  flat.flatten(flattenToleranceMm);
  const points = flat.segments.map((seg) => ({ x: seg.point.x, y: seg.point.y }));
  const closed = flat.closed;
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
    heightMm: Math.max(2, maxY - minY),
    closed
  };
}

/**
 * Build a 'path' layer object from a flattened contour -- the exact shape app.js's Boolean
 * Operations code already constructs for its own results (`newLayer`), so it can be pushed into
 * project.layers and run through GeometryEngine.generatePathLayout()/updateAll() completely
 * unchanged. `index` disambiguates ids when several layers are built in the same synchronous loop
 * (multiple shapes committed at once) and would otherwise collide on the same Date.now()
 * millisecond -- the same `${type}${Date.now()}${i}` convention app.js's own Alt-drag-duplicate
 * already uses for the identical reason.
 */
export function createPathLayerFromContour(flattened, { stoneSize, gap, color, pathName, index = 0 }) {
  return {
    id: 'path' + Date.now() + index,
    type: 'path',
    visible: true,
    pathName,
    contours: [flattened.contour],
    closed: flattened.closed !== false,
    x: flattened.xMm,
    y: flattened.yMm,
    w: flattened.widthMm,
    h: flattened.heightMm,
    stoneSize,
    gap,
    color
  };
}
