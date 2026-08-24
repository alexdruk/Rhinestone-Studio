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
 *
 * RS-3011 Step 8: importSvgIntoItem() below is the one function in this module that does reach for
 * live Paper.js API (`paper.project.importSVG`) rather than only operating on an already-built item
 * passed in by a caller -- still pure Paper.js API usage, not DOM/Tool/View event glue, so it stays
 * within this module's existing boundary.
 */
import paper from 'paper';

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

  /**
   * RS-3014 Step 3: swaps an already-finalized shape's Paper.js Item for a freshly-built one,
   * keeping the SAME shape id (so selectedIds/stoneGroups, both keyed by this id elsewhere in
   * DrawingCanvasTool.js, stay valid) and the same z-order slot among its layer's other children
   * (`newItem.insertAbove(oldItem)` before removing `oldItem` leaves newItem exactly where oldItem
   * was, relative to whatever sat above/below it). Needed the first time anything re-materializes a
   * LIVE shape's own outline geometry from its stored layer data after commit (see
   * DrawingCanvasTool.js's refreshShapeGeometryForLayer()) -- every prior caller either builds a
   * shape once at draw-time (finalizeShape/addShape) or discards it outright (removeShape), never
   * swaps its geometry in place.
   * @param {string} id
   * @param {paper.Item} newItem
   * @returns {boolean} false if no shape matches `id` (newItem is left untouched, not inserted).
   */
  replaceShapeItem(id, newItem) {
    const index = this.shapes.findIndex((s) => s.id === id);
    if (index === -1) return false;
    const oldItem = this.shapes[index].item;
    newItem.data.shapeId = id;
    newItem.insertAbove(oldItem);
    oldItem.remove();
    this.shapes[index] = { id, item: newItem };
    return true;
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
 * Shared per-path core of flattenPathToContour()/flattenPathToContours(): clone `path` (so the
 * source item is left untouched), flatten it to straight segments, and read back its points +
 * closed flag. Split out so flattenPathToContours() (RS-3011 Step 8) can apply this identical
 * per-path logic to every sub-path of a Paper.js CompoundPath/Group without duplicating it.
 */
function _flattenPathSegments(path, flattenToleranceMm) {
  const flat = path.clone({ insert: false });
  flat.flatten(flattenToleranceMm);
  const points = flat.segments.map((seg) => ({ x: seg.point.x, y: seg.point.y }));
  const closed = flat.closed;
  flat.remove();
  return { points, closed };
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
  const { points, closed } = _flattenPathSegments(path, flattenToleranceMm);
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
 * Multi-contour generalization of flattenPathToContour() (RS-3011 Step 8): walks `item`, which may
 * be a plain paper.Path, a paper.CompoundPath (a shape with a hole -- e.g. a ring, or a letter like
 * "O"), or a paper.Group (multiple disjoint pieces -- e.g. a multi-part imported SVG), recursively
 * through nested Groups/CompoundPaths, and flattens every genuine sub-path found via the SAME
 * _flattenPathSegments() core flattenPathToContour() uses.
 *
 * Skips two kinds of non-geometry a real-world Paper.js item can contain rather than failing the
 * whole import over one bad piece: (a) any sub-path whose flattened point count is < 3 (the same
 * degenerate guard flattenPathToContour() applies), and (b) any item flagged `clipMask === true` --
 * empirically confirmed (RS-3011 Step 8 Phase A probe) that `paper.project.importSVG(...,
 * {expandShapes:true})` on an SVG with a `viewBox` attribute inserts a non-geometry `Shape`
 * rectangle sibling, marked `clipMask: true`, representing the SVG viewport clip -- NOT a drawn
 * shape, and not itself convertible to a Path by expandShapes since it isn't real content. Skipping
 * by `clipMask` (rather than by item type) is deliberate: it targets exactly this artifact without
 * assuming every non-Path/CompoundPath/Group item is always safe to drop.
 *
 * Every kept sub-path's points are rooted against ONE shared bounding box computed across ALL kept
 * sub-paths together (never per-sub-path independently) -- the same "one shared box, not
 * independently-derived ones per piece" principle Step 10a's region-vs-parent-shape transform
 * sharing already established -- so multiple contours stay correctly positioned relative to each
 * other (a hole stays over its outer ring; disjoint pieces keep their real relative offsets).
 *
 * @param {paper.Item} item
 * @param {number} flattenToleranceMm
 * @returns {{contours:{contour:{x:number,y:number}[],closed:boolean}[], xMm:number, yMm:number,
 *   widthMm:number, heightMm:number, skippedCount:number}}
 */
export function flattenPathToContours(item, flattenToleranceMm) {
  const rawContours = [];
  let skippedCount = 0;

  function walk(node) {
    if (!node || node.clipMask) return;
    const className = node.className;
    if (className === 'Group' || className === 'Layer' || className === 'CompoundPath') {
      for (const child of node.children || []) walk(child);
      return;
    }
    if (className === 'Path') {
      const { points, closed } = _flattenPathSegments(node, flattenToleranceMm);
      if (points.length < 3) {
        skippedCount++;
        return;
      }
      rawContours.push({ points, closed });
      return;
    }
    skippedCount++;
  }

  walk(item);

  if (rawContours.length === 0) {
    return { contours: [], xMm: 0, yMm: 0, widthMm: 0, heightMm: 0, skippedCount };
  }

  const allPoints = rawContours.flatMap((c) => c.points);
  const minX = Math.min(...allPoints.map((p) => p.x));
  const minY = Math.min(...allPoints.map((p) => p.y));
  const maxX = Math.max(...allPoints.map((p) => p.x));
  const maxY = Math.max(...allPoints.map((p) => p.y));

  return {
    contours: rawContours.map((c) => ({
      contour: c.points.map((p) => ({ x: p.x - minX, y: p.y - minY })),
      closed: c.closed
    })),
    xMm: minX,
    yMm: minY,
    widthMm: Math.max(2, maxX - minX),
    heightMm: Math.max(2, maxY - minY),
    skippedCount
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

/**
 * Multi-contour sibling of createPathLayerFromContour(), for flattenPathToContours()'s output
 * (RS-3011 Step 8). Known, deliberate limitation, not silently decided: the project schema's 'path'
 * layer has exactly ONE `closed` flag for the whole layer (GeometryEngine.js's normalizePathParams()
 * reads `options.closed` once and applies it uniformly to every contour in
 * _pathPolygons()/generatePathLayout() -- there is no per-contour closed flag today), but
 * flattenPathToContours() tracks `closed` per sub-path, since Paper.js reports it per-Path. This
 * function collapses that per-contour information into a single layer-level flag. A genuinely
 * all-open import (every sub-path open) stays open -- that's a legitimate, meaningful state (mirrors
 * an open freehand stroke; see flattenPathToContour()'s own doc comment on why an open contour must
 * not get a spurious synthesized closing edge). Only the MISMATCHED case (some open, some closed
 * within the same import) falls back to closed=true -- picked over false since a mixed import is far
 * more likely to be intended as filled/outlined regions than as open strokes, and false would risk
 * StoneSampler.js synthesizing a closing edge across unrelated points for whichever sub-paths were
 * actually meant to be closed. Real per-contour closed support would mean extending the layer schema
 * itself (GeometryEngine and every other layer.closed consumer), a scope expansion not justified for
 * how rare a genuinely mixed open/closed SVG import is in practice -- but rather than lose that
 * distinction silently when it DOES happen, this returns a warning string a caller can surface.
 *
 * @returns {{layer:object, warning:string|null}}
 */
export function createPathLayerFromContours(flattened, { stoneSize, gap, color, pathName, index = 0 }) {
  const closedValues = flattened.contours.map((c) => c.closed !== false);
  const allClosed = closedValues.every(Boolean);
  const allOpen = closedValues.every((v) => !v);
  const mismatched = flattened.contours.length > 1 && !allClosed && !allOpen;
  const layerClosed = mismatched ? true : allClosed;

  const layer = {
    id: 'path' + Date.now() + index,
    type: 'path',
    visible: true,
    pathName,
    contours: flattened.contours.map((c) => c.contour),
    closed: layerClosed,
    x: flattened.xMm,
    y: flattened.yMm,
    w: flattened.widthMm,
    h: flattened.heightMm,
    stoneSize,
    gap,
    color,
    rotationDeg: 0
  };

  const warning = mismatched
    ? `${pathName || 'Imported shape'}: some sub-paths were open and some closed -- treated as all closed, since this shape type only supports one closed setting for the whole import.`
    : null;

  return { layer, warning };
}

/**
 * Import raw SVG source into a real, live Paper.js item and fit it to a target canvas -- the
 * drawleather precedent (github.com/sergeychernyshev/drawleather's StampSymbols.ts) this Design-native
 * import path follows: `paper.project.importSVG(svgSource, {expandShapes:true, insert:false})` to get
 * a real Item (not this app's own headless src/svg/** parser -- see this milestone's own scope note),
 * then `item.bounds`/`item.scale()`/`item.translate()` to fit+center it, mirroring app.js's EXISTING
 * top-nav Import Lightbox handler's own fit-and-center math (`importSvgFile` change handler:
 * clamp to canvas minus a margin, preserve aspect ratio via `Math.min(maxW/w,maxH/h)`, center via
 * `(canvasWidth-w)/2`) rather than re-deriving new fit logic.
 *
 * Empirically confirmed (RS-3011 Step 8 Phase A probe): `expandShapes:true` DOES convert every SVG
 * primitive (rect/circle/ellipse/polygon) into real Path geometry, as its name promises -- but an
 * SVG carrying a `viewBox` attribute additionally makes importSVG() insert a non-geometry `Shape`
 * rectangle sibling flagged `clipMask:true` for the SVG viewport clip; flattenPathToContours() skips
 * it (see that function's own doc comment) so it never reaches the returned item's own callers as a
 * spurious 100th contour.
 *
 * Only ever scales DOWN (never up) to fit, matching app.js's own `if(w>maxW||h>maxH)` guard.
 *
 * @param {string} svgSource
 * @param {number} canvasWidthMm
 * @param {number} canvasHeightMm
 * @param {number} [marginMm] Total margin subtracted from the fit box; 20 matches app.js's own
 *   top-nav Import handler exactly (`project.canvas.width-20`).
 * @returns {paper.Item} A live item, not yet inserted into the active project (`insert:false`).
 */
export function importSvgIntoItem(svgSource, canvasWidthMm, canvasHeightMm, marginMm = 20) {
  const item = paper.project.importSVG(svgSource, { expandShapes: true, insert: false });
  const maxW = canvasWidthMm - marginMm;
  const maxH = canvasHeightMm - marginMm;
  let w = item.bounds.width;
  let h = item.bounds.height;
  if (w > maxW || h > maxH) {
    const s = Math.min(maxW / w, maxH / h);
    item.scale(s);
    w *= s;
    h *= s;
  }
  const targetX = (canvasWidthMm - w) / 2;
  const targetY = (canvasHeightMm - h) / 2;
  item.translate(targetX - item.bounds.x, targetY - item.bounds.y);
  return item;
}
