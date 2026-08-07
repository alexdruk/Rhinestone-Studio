/**
 * DrawingCanvasTool — the Paper.js-specific half of RS-3010. All direct use of the `paper`
 * package is confined to this file (mirrors src/preview3d/** confining Three.js): app.js only ever
 * calls the facade createDrawingTool() returns, never `paper` itself.
 *
 * Architectural decision this implements (see the RS-3010 Step 1 prompt): drawing mode reuses the
 * existing production `layoutCanvas` rather than a second canvas. Paper.js's own Project/View is
 * set up on that canvas lazily, on first entry, and then only paused/resumed on exit/re-entry
 * (`view.autoUpdate`) rather than torn down -- calling `paper.setup()` again on every entry would
 * stack a second Project onto the same element. While paused, Paper never touches the canvas, so
 * the normal renderProductionLayout()/drawLayout() 2D rendering owns it exclusively -- "canvas
 * interaction owned by exactly one thing at a time," the same rule the Monogram Lightbox gate
 * already enforces for pointer events.
 *
 * Paper.js's own project units are kept equal to this app's millimeters (not canvas pixels): on
 * entry, `view.zoom` is seeded to a base px-per-mm fit scale and DrawingBoard's own `zoom`
 * multiplies on top of it, so Tool event points (`event.point`) already arrive in mm, and
 * Path.simplify()/flatten() tolerances are plain mm values -- no manual px<->mm conversion
 * anywhere in this file.
 *
 * RS-3010 Step 2a adds a `mode` concept ('freehand' | 'rect' | 'ellipse') alongside the existing
 * `isActive`, plus selection/move/delete of already-finalized shapes. Step 2b extends `mode` with
 * 'slot' (a drag-defined stadium/pill shape) using the same hit-test-first/drag-to-preview/
 * finalize interaction shape rect/ellipse already use. Step 2c adds 'polygon' (click-to-add-vertex,
 * closed by clicking back near the first vertex) -- a genuinely different, multi-click interaction
 * that takes over the pointer entirely once started, see the 'polygon' interactionKind value below.
 * Design Step A adds 'select' -- a real but inert mode (an empty-canvas drag does nothing; the
 * existing hit-test-an-existing-shape click/shift-click/drag-to-move behavior below is unaffected
 * either way, since it never checks `mode`). Design Step C will add marquee-select on top of the
 * same empty-canvas branch point. Selection state (the set of
 * selected shape ids) lives here, not in DrawingBoard.js -- per that module's own doc comment, it
 * stays a plain data model with no interaction/event concerns. This file's one Paper.js Tool
 * routes every pointer gesture through a single decision: hit an existing shape first (selection/
 * move take priority over starting a new draw, regardless of which toolbar mode is active), else
 * draw per the current mode.
 */
import paper from 'paper';
import {
  DrawingBoard,
  drawingBaseScale,
  flattenPathToContour,
  createPathLayerFromContour
} from './DrawingBoard.js';
import { resolveDragBox, constrainSquare, resolveDragAxis, boxContainsBox } from './DrawingBoxGeometry.js';
import { selectOnly, toggleSelection, clearSelection, selectMany } from '../editing/Selection.js';

const STROKE_COLOR = '#1a56d6';
const SELECTED_STROKE_COLOR = '#5b9dff';
const STROKE_WIDTH_PX = 2;
// Design Step C: marquee's own visual, deliberately distinct from STROKE_COLOR/
// SELECTED_STROKE_COLOR -- semi-transparent fill + border reads unambiguously as "a selection
// box" rather than "a shape being drawn" (the standard Photoshop/Figma/Illustrator convention).
const MARQUEE_FILL_COLOR = 'rgba(91, 157, 255, 0.15)';
const MARQUEE_STROKE_COLOR = '#5b9dff';
const MARQUEE_STROKE_WIDTH_PX = 1;
const SIMPLIFY_TOLERANCE_MM = 0.35;
const FLATTEN_TOLERANCE_MM = 0.25;
const PAN_WHEEL_TO_MM = 1;
// A completed rect/ellipse drag whose bounding box is at or below this size in either dimension
// never produced a usable shape -- discarded, matching freehand's existing "no usable stroke"
// degenerate-path rule (see onMouseUp's < 2 segments check).
const MIN_BOX_DIM_MM = 1;
// RS-3010 Step 2b: slot's own defaults, sized for this app's canvas/stone scale (not drawleather's
// leather-craft constants) -- see the pill drawn with a plain click, width * length ratio = 18mm.
const SLOT_DEFAULT_WIDTH_MM = 6;
const SLOT_DEFAULT_LENGTH_RATIO = 3;
// RS-3010 Step 2c: polygon's own click-to-add-vertex constants -- a polygon needs at least a
// triangle before "close" is a meaningful action, and CLOSE_POLYGON_TOLERANCE_PX mirrors
// hitTestShapeId's own screen-px-to-project-mm tolerance conversion pattern.
const MIN_POLYGON_POINTS = 3;
const CLOSE_POLYGON_TOLERANCE_PX = 6;
// RS-3010 Design Step D: resize handles' own constants. RESIZE_HANDLE_SIZE_PX/
// RESIZE_HANDLE_STROKE_WIDTH_PX/colors match app.js's own SELECTION_HANDLE_SIZE_PX (11) and
// drawSelectionBox()'s handle styling (white fill, #1478ff stroke, 1.75px width), for visual
// consistency between Design's own shapes and the main app.js system's resize handles.
// RESIZE_MIN_DIM_MM matches drag.kind==='resize''s own Math.max(2, ...) floor exactly -- deliberately
// NOT reusing MIN_BOX_DIM_MM (1) above, which is a different concept (a create-vs-discard threshold
// for a brand-new shape, not a resize-floor for an existing one).
const RESIZE_HANDLE_SIZE_PX = 11;
const RESIZE_HANDLE_STROKE_WIDTH_PX = 1.75;
const RESIZE_HANDLE_FILL_COLOR = '#ffffff';
const RESIZE_HANDLE_STROKE_COLOR = '#1478ff';
const RESIZE_MIN_DIM_MM = 2;
// RS-3010 Step 2d: Design's own background grid, reproducing CanvasRenderer2D.js's drawGrid()
// colors/intervals exactly (same minor/major distinction, same #e9eef5/#bcd6ff palette) so the
// grid looks identical whether or not Design is active. Built once, into a dedicated paper.Layer
// kept behind the content layer -- see buildGrid() below for the layering/activeLayer discipline.
const GRID_MINOR_INTERVAL_MM = 5;
const GRID_MAJOR_INTERVAL_MM = 20;
const GRID_MINOR_COLOR = '#e9eef5';
const GRID_MAJOR_COLOR = '#bcd6ff';
const GRID_MINOR_STROKE_WIDTH_PX = 1;
const GRID_MAJOR_STROKE_WIDTH_PX = 1.5;
// Fixed extent margin (project-mm) added around the first project.canvas the grid is built for.
// Generous relative to every product's canvas (largest is the plate's ~270mm-diameter footprint,
// the mug wrap referenced in this step's own prompt is 257x85mm) so ordinary panning never runs
// off the edge, while staying a one-time, bounded number of Path items (not rebuilt per pan/zoom
// tick -- see this file's header comment on Paper.js project units and drawing-mode performance).
const GRID_EXTENT_MARGIN_MM = 2000;

/**
 * The 8 handle positions (4 corners + 4 edge midpoints) for a bounds Rectangle, in the same
 * nw/ne/se/sw/n/e/s/w naming app.js's own handlesFor() uses. Paper.js Rectangle's own named
 * corner/center points are used directly rather than reimplementing that point math by hand.
 * @param {paper.Rectangle} bounds
 * @returns {{name:string,point:paper.Point}[]}
 */
function handlePositionsFor(bounds) {
  return [
    { name: 'nw', point: bounds.topLeft },
    { name: 'ne', point: bounds.topRight },
    { name: 'se', point: bounds.bottomRight },
    { name: 'sw', point: bounds.bottomLeft },
    { name: 'n', point: bounds.topCenter },
    { name: 'e', point: bounds.rightCenter },
    { name: 's', point: bounds.bottomCenter },
    { name: 'w', point: bounds.leftCenter }
  ];
}

/**
 * Builds a stadium/pill Path: two straight sides parallel to the a-to-b axis, offset by
 * +/-widthMm/2 perpendicular to it, capped by semicircles of radius widthMm/2 at `a` and `b`.
 * Module-private, mirrors rect/ellipse's own construction not being exported. Degenerate case (`a`
 * and `b` coincident) falls back to a plain circle rather than a zero-length/malformed path.
 * @param {{x:number,y:number}} a
 * @param {{x:number,y:number}} b
 * @param {number} widthMm
 * @returns {paper.Path}
 */
function buildSlotPreview(a, b, widthMm) {
  const r = widthMm / 2;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const length = Math.hypot(dx, dy);
  if (length < 1e-6) {
    return new paper.Path.Circle(new paper.Point(a.x, a.y), r);
  }
  const ux = dx / length;
  const uy = dy / length;
  const px = -uy;
  const py = ux;
  const p1 = new paper.Point(a.x + px * r, a.y + py * r);
  const p2 = new paper.Point(b.x + px * r, b.y + py * r);
  const p3 = new paper.Point(b.x - px * r, b.y - py * r);
  const p4 = new paper.Point(a.x - px * r, a.y - py * r);
  const bThrough = new paper.Point(b.x + ux * r, b.y + uy * r);
  const aThrough = new paper.Point(a.x - ux * r, a.y - uy * r);
  const path = new paper.Path();
  path.moveTo(p1);
  path.lineTo(p2);
  path.arcTo(bThrough, p3);
  path.lineTo(p4);
  path.arcTo(aThrough, p1);
  path.closePath();
  return path;
}

export function createDrawingTool(canvasEl) {
  const board = new DrawingBoard();
  let isSetUp = false;
  // RS-3010 Step 2d: contentLayer is the original default paper.Layer paper.setup() itself
  // creates -- captured once, right after setup, so every activeLayer-restoring call below
  // references it directly rather than re-deriving "the content layer" from current state.
  // gridLayer is the dedicated background-grid layer built once by buildGrid(); null until then.
  let contentLayer = null;
  let gridLayer = null;
  let tool = null;
  let canvasMm = { width: 100, height: 100 };
  let baseScale = 1;
  let dragging = false;
  let mode = 'freehand';
  let slotWidthMm = SLOT_DEFAULT_WIDTH_MM;
  // RS-3010 Step 2c: vertices clicked so far for an in-progress polygon, project-mm paper.Points.
  // Empty whenever interactionKind !== 'polygon'.
  let polygonPoints = [];
  let selectedIds = clearSelection();
  // 'draw' while a new freehand/rect/ellipse/slot shape is mid-drag; 'move' while dragging the
  // current selection; 'polygon' while a click-to-add-vertex polygon is accumulating points
  // (RS-3010 Step 2c -- owns the pointer outright until closed or cancelled, unlike 'draw'/'move'
  // which are re-decided fresh at every pointerdown); null when idle. Set at pointerdown, read by
  // pointerdrag/pointerup/pointermove to decide which gesture is in progress -- hit-testing at
  // pointerdown (not the current toolbar mode) is what decides among these, per this file's header
  // comment.
  let interactionKind = null;
  let dragStart = null;
  // Design Step C: the live marquee-select rectangle, a throwaway Paper.js Item added directly to
  // paper.project.activeLayer -- NEVER routed through board.beginPath()/clearPath()/
  // finalizeShape(), since a selection rectangle must never become a committable shape. Rebuilt
  // from scratch every drag frame (onMouseDrag), removed on mouseup/Escape/mode-switch. Non-null
  // only while interactionKind === 'marquee'.
  let marqueeItem = null;
  // RS-3010 Design Step D: the live resize handles for the current single-shape selection, a
  // small array of throwaway Paper.js Items (same "never routed through board.beginPath()/
  // clearPath()/finalizeShape()" rule marqueeItem already established, since these are UI chrome,
  // not shapes). Rebuilt from scratch by updateResizeHandles() below whenever selection or the
  // selected shape's geometry can change; empty whenever mode !== 'select' or more/fewer than one
  // shape is selected. resizeHandle/resizeShapeId/resizeStartBounds mirror app.js's own
  // `drag={kind:'resize',handle,layerId,b0,...}` shape, adapted to this file's discrete closure
  // variables -- non-null only while interactionKind === 'resize'.
  let resizeHandleItems = [];
  let resizeHandle = null;
  let resizeShapeId = null;
  let resizeStartBounds = null;
  // RS-3010 Design Step B: spacebar-held temporary pan, independent of `mode` -- `panning` is only
  // true while space is held AND the mouse is also down (an actual pan drag in progress).
  let spaceHeld = false;
  let panning = false;
  // Design Step E fix: the *raw, untransformed* client pixel position (event.event.clientX/Y, not
  // Paper.js's own project-space event.point/event.delta) the pan was last computed from -- see
  // the onMouseDrag panning branch below for why this has to bypass Paper.js's own point/delta.
  let panLastClientPoint = null;

  /**
   * Reflects the current interaction state onto layoutCanvas's CSS cursor: 'grabbing' while
   * actively panning, 'grab' while space is held (takes priority over the per-tool cursor below),
   * else crosshair for every drawing mode or the default pointer for 'select'. Called wherever
   * `mode`/`spaceHeld`/`panning` change; exit() clears the inline style entirely so the canvas
   * falls back to whatever cursor it had outside drawing mode.
   */
  function updateCursor() {
    if (panning) {
      canvasEl.style.cursor = 'grabbing';
    } else if (spaceHeld) {
      canvasEl.style.cursor = 'grab';
    } else {
      canvasEl.style.cursor = mode === 'select' ? 'default' : 'crosshair';
    }
  }

  function applyViewport() {
    paper.view.zoom = baseScale * board.zoom;
    paper.view.center = new paper.Point(
      canvasMm.width / 2 + board.panXmm,
      canvasMm.height / 2 + board.panYmm
    );
  }

  /**
   * Resync Paper's own View to canvasEl's *current* box size. Paper never learns about a resize
   * on its own here: the `resize` attribute (which would make it listen to the window resize
   * event itself) was never set on the canvas, and app.js can change canvasEl's CSS box for
   * reasons Paper has no visibility into at all -- a browser window resize, or a workspace-tab
   * switch (Dual Workspace/2D Canvas/Object Preview) reflowing the panel. Left stale, Paper keeps
   * mapping Tool event points (and its own rendering) through the *old* box size, so the drawn
   * stroke visibly drifts from the cursor and the canvas looks squished/stretched the instant the
   * box actually changes -- a real, separate bug from the stomping fixed by drawLayout()'s own
   * `drawingTool.isActive` guard below.
   *
   * Feeds `view.viewSize` the canvas's CSS-logical size (getBoundingClientRect), not
   * canvasEl.width/height -- those are already devicePixelRatio-multiplied (this app's own
   * resizeCanvas() convention), and CanvasView applies *its own* devicePixelRatio multiplication
   * inside `_setElementSize()`; feeding it the already-scaled figure would double-scale the
   * backing store. This also means drawingTool owns canvasEl's width/height attributes outright
   * while active -- callers must not also call app.js's own resizeCanvas() in this window.
   */
  function resyncViewSize() {
    const rect = canvasEl.getBoundingClientRect();
    // Paper.js's own `view.viewSize` setter (paper-core.js `setViewSize`) no-ops whenever the new
    // size's delta from its OWN cached _viewSize is zero -- it never actually looks at
    // canvasEl.width/height. Between drawing-mode sessions, app.js's normal drawLayout() calls
    // resizeCanvas() on this SAME shared canvas element while Paper is inactive, resizing it
    // directly and bypassing Paper.js entirely; Paper's cache has no way to learn about that
    // external change. If the box on a later enter() happens to numerically match whatever Paper
    // still remembers from an earlier session, the setter's no-op guard skips
    // `_setElementSize()`, leaving the actual backing store at drawLayout()'s (wrong) size for
    // the rest of that session. Assigning a sentinel size first guarantees a nonzero delta, so
    // the real assignment right after it always actually applies.
    paper.view.viewSize = new paper.Size(1, 1);
    paper.view.viewSize = new paper.Size(rect.width, rect.height);
  }

  /**
   * Builds Design's own background grid once, into `gridLayer` -- a dedicated paper.Layer created
   * fresh here (never reused across sessions, since this only ever runs once per page load, guarded
   * by `!gridLayer` at the call site). `new paper.Layer()` both inserts on top AND activates itself
   * (Paper.js's Project#_insertItem calls the new layer's own activate() when `_created` is true --
   * confirmed by reading paper-full.js directly, not assumed), so every line built below lands in
   * gridLayer purely because it's the active layer at the time, then `sendToBack()` moves the whole
   * layer behind `contentLayer` in the project's layer stack, and `contentLayer.activate()`
   * explicitly restores it as the active layer -- the exact discipline this step's prompt calls
   * out as the risk to get right, verified directly (not just visually) in Verification item 2.
   *
   * Stroke widths are converted from screen-px via `/ paper.view.zoom` at build time (this file's
   * established screen-px-to-mm pattern -- see hitTestShapeId/updateResizeHandles/marquee above),
   * so this must run only after applyViewport() has set the real initial zoom for this project;
   * building it earlier (e.g. immediately after paper.setup(), while zoom is still Paper's default
   * of 1) would bake in a wildly wrong line width for every project whose fit scale differs from 1.
   *
   * Extent is a fixed area in project-mm, generously larger than canvasMm (GRID_EXTENT_MARGIN_MM),
   * built once and never rebuilt on pan/zoom -- grid lines drawn in project-mm coordinates already
   * render correctly through Paper.js's own view transform on every pan/zoom tick for free, the
   * same reason panBy()/applyViewport() never touch individual shape items.
   */
  function buildGrid() {
    gridLayer = new paper.Layer();
    const gx0 = Math.floor(-GRID_EXTENT_MARGIN_MM / GRID_MINOR_INTERVAL_MM) * GRID_MINOR_INTERVAL_MM;
    const gx1 = Math.ceil((canvasMm.width + GRID_EXTENT_MARGIN_MM) / GRID_MINOR_INTERVAL_MM) * GRID_MINOR_INTERVAL_MM;
    const gy0 = Math.floor(-GRID_EXTENT_MARGIN_MM / GRID_MINOR_INTERVAL_MM) * GRID_MINOR_INTERVAL_MM;
    const gy1 = Math.ceil((canvasMm.height + GRID_EXTENT_MARGIN_MM) / GRID_MINOR_INTERVAL_MM) * GRID_MINOR_INTERVAL_MM;
    const minorWidthMm = GRID_MINOR_STROKE_WIDTH_PX / paper.view.zoom;
    const majorWidthMm = GRID_MAJOR_STROKE_WIDTH_PX / paper.view.zoom;

    const addLine = (from, to, color, widthMm) => {
      const line = new paper.Path.Line(from, to);
      line.strokeColor = color;
      line.strokeWidth = widthMm;
    };
    for (let x = gx0; x <= gx1; x += GRID_MINOR_INTERVAL_MM) {
      addLine(new paper.Point(x, gy0), new paper.Point(x, gy1), GRID_MINOR_COLOR, minorWidthMm);
    }
    for (let y = gy0; y <= gy1; y += GRID_MINOR_INTERVAL_MM) {
      addLine(new paper.Point(gx0, y), new paper.Point(gx1, y), GRID_MINOR_COLOR, minorWidthMm);
    }
    const mx0 = Math.floor(gx0 / GRID_MAJOR_INTERVAL_MM) * GRID_MAJOR_INTERVAL_MM;
    const my0 = Math.floor(gy0 / GRID_MAJOR_INTERVAL_MM) * GRID_MAJOR_INTERVAL_MM;
    for (let x = mx0; x <= gx1; x += GRID_MAJOR_INTERVAL_MM) {
      addLine(new paper.Point(x, gy0), new paper.Point(x, gy1), GRID_MAJOR_COLOR, majorWidthMm);
    }
    for (let y = my0; y <= gy1; y += GRID_MAJOR_INTERVAL_MM) {
      addLine(new paper.Point(gx0, y), new paper.Point(gx1, y), GRID_MAJOR_COLOR, majorWidthMm);
    }

    gridLayer.sendToBack();
    contentLayer.activate();
  }

  /** @returns {string|null} The shapeId of the finalized shape under `point`, or null. */
  function hitTestShapeId(point) {
    const hit = paper.project.hitTest(point, {
      fill: true,
      stroke: true,
      tolerance: 4 / paper.view.zoom,
      class: paper.Path
    });
    return (hit && hit.item.data.shapeId) || null;
  }

  /**
   * The handle name (e.g. 'nw', 'e') under `point` for the single currently-selected shape, or
   * null -- only ever relevant in 'select' mode with exactly one shape selected (mirrors
   * drawSelectionBox()'s own single-selection-only showHandles rule). Tolerance matches
   * hitTestShapeId's own `4 / paper.view.zoom` screen-px-to-project-mm convention above, applied
   * as a radial point-to-point distance -- the natural analog for point-vs-handle, unlike app.js's
   * hitTest()'s own flat 3mm axis-aligned box check, which was tuned for a different zoom range.
   * @param {paper.Point} point
   * @returns {string|null}
   */
  function hitTestResizeHandle(point) {
    if (mode !== 'select' || selectedIds.size !== 1) return null;
    const shape = board.getShape([...selectedIds][0]);
    if (!shape) return null;
    const tolerance = 4 / paper.view.zoom;
    const hit = handlePositionsFor(shape.item.bounds).find((h) => point.getDistance(h.point) <= tolerance);
    return hit ? hit.name : null;
  }

  /** Repaints every finalized shape's strokeColor to reflect the current selection. */
  function applySelectionVisuals() {
    for (const shape of board.listShapes()) {
      shape.item.strokeColor = selectedIds.has(shape.id) ? SELECTED_STROKE_COLOR : STROKE_COLOR;
    }
  }

  /**
   * Rebuilds `resizeHandleItems` from scratch: removes whatever handle Items currently exist,
   * then -- only if `mode === 'select'` and exactly one shape is selected -- adds 8 small square
   * Path.Rectangle Items at that shape's current bounds' handle positions (handlePositionsFor).
   * Called wherever selection or the selected shape's geometry can change.
   */
  function updateResizeHandles() {
    for (const item of resizeHandleItems) item.remove();
    resizeHandleItems = [];
    if (mode !== 'select' || selectedIds.size !== 1) return;
    const shape = board.getShape([...selectedIds][0]);
    if (!shape) return;
    const sizeMm = RESIZE_HANDLE_SIZE_PX / paper.view.zoom;
    for (const { point } of handlePositionsFor(shape.item.bounds)) {
      const rect = new paper.Rectangle(point.x - sizeMm / 2, point.y - sizeMm / 2, sizeMm, sizeMm);
      const handleItem = new paper.Path.Rectangle(rect);
      handleItem.fillColor = RESIZE_HANDLE_FILL_COLOR;
      handleItem.strokeColor = RESIZE_HANDLE_STROKE_COLOR;
      handleItem.strokeWidth = RESIZE_HANDLE_STROKE_WIDTH_PX / paper.view.zoom;
      resizeHandleItems.push(handleItem);
    }
  }

  /**
   * Discards whatever drawing gesture is currently in flight -- a rect/ellipse/slot/freehand drag
   * preview (`board.path`) and/or an in-progress polygon's accumulated vertices. Every call site
   * that used to just discard a drag (cancelPath(), setMode(), enter(), exit()) now routes through
   * this so a mode switch, re-entry, or exit mid-polygon can't leave stale vertices behind.
   */
  function resetInProgressDrawing() {
    board.clearPath();
    if (marqueeItem) {
      marqueeItem.remove();
      marqueeItem = null;
    }
    for (const item of resizeHandleItems) item.remove();
    resizeHandleItems = [];
    resizeHandle = null;
    resizeShapeId = null;
    resizeStartBounds = null;
    interactionKind = null;
    dragging = false;
    polygonPoints = [];
  }

  function attachTool() {
    if (tool) tool.remove();
    tool = new paper.Tool();

    tool.onMouseDown = (event) => {
      // RS-3010 Design Step B: space-held pan takes priority over everything else -- checked
      // before the polygon special case below so an in-progress polygon survives a pan
      // interruption untouched (see resetInProgressDrawing()'s doc comment: this branch never
      // calls it, so polygonPoints/board.path are left exactly as they were).
      if (spaceHeld) {
        panning = true;
        panLastClientPoint = { x: event.event.clientX, y: event.event.clientY };
        updateCursor();
        return;
      }
      // RS-3010 Step 2c: an in-progress polygon takes over the pointer entirely -- every click
      // either adds a vertex or closes the shape, never falls through to hit-test/selection. Only
      // the FIRST click of a new polygon goes through the normal dispatch below.
      if (interactionKind === 'polygon') {
        const closing =
          polygonPoints.length >= MIN_POLYGON_POINTS &&
          event.point.getDistance(polygonPoints[0]) <= CLOSE_POLYGON_TOLERANCE_PX / paper.view.zoom;
        if (closing) {
          board.clearPath();
          const closedPath = new paper.Path({
            strokeColor: STROKE_COLOR,
            strokeWidth: STROKE_WIDTH_PX / paper.view.zoom
          });
          polygonPoints.forEach((point, index) => {
            if (index === 0) closedPath.moveTo(point);
            else closedPath.lineTo(point);
          });
          closedPath.closePath();
          board.beginPath(closedPath);
          board.finalizeShape();
          resetInProgressDrawing();
        } else {
          polygonPoints.push(event.point);
        }
        return;
      }
      // Design Step D: a resize handle can sit right at a shape's edge, where both it and the
      // shape's own hit-test could otherwise match -- the handle must win, so this is checked
      // first (mirrors app.js's own hitTest(), which checks handlesFor() before the move branch).
      const resizeHandleHit = hitTestResizeHandle(event.point);
      if (resizeHandleHit) {
        const shape = board.getShape([...selectedIds][0]);
        interactionKind = 'resize';
        resizeHandle = resizeHandleHit;
        resizeShapeId = shape.id;
        resizeStartBounds = shape.item.bounds.clone();
        return;
      }
      const hitId = hitTestShapeId(event.point);
      if (hitId) {
        // Same click/shift-click/drag-preserves-group convention as the existing project.layers
        // pointerdown handler in app.js: a shift-click toggles membership and never starts a
        // drag on its own (matches that handler's shift branch returning immediately); a plain
        // click on a shape already part of the current multi-selection preserves the whole group
        // (so a follow-up drag moves it together) instead of collapsing to just that one shape.
        if (event.modifiers.shift) {
          selectedIds = toggleSelection(selectedIds, hitId);
          applySelectionVisuals();
          updateResizeHandles();
          interactionKind = null;
          return;
        }
        if (!selectedIds.has(hitId)) {
          selectedIds = selectOnly(hitId);
          applySelectionVisuals();
          updateResizeHandles();
        }
        interactionKind = 'move';
        return;
      }
      // Empty canvas: clear any existing selection and start a new shape per the active mode.
      if (selectedIds.size) {
        selectedIds = clearSelection();
        applySelectionVisuals();
        updateResizeHandles();
      }
      // Design Step C: Select's empty-canvas drag starts a marquee. The marquee visual itself is
      // built lazily in onMouseDrag (mirrors rect/ellipse/slot's own "nothing meaningful to show
      // at a zero-size box" reasoning above). No Shift-to-add here -- the unconditional
      // clear-selection above already covers every marquee drag, same as a plain click.
      if (mode === 'select') {
        interactionKind = 'marquee';
        dragStart = event.point;
        return;
      }
      if (mode === 'polygon') {
        interactionKind = 'polygon';
        polygonPoints = [event.point];
        return;
      }
      interactionKind = 'draw';
      dragStart = event.point;
      dragging = true;
      if (mode === 'freehand') {
        const path = new paper.Path({
          strokeColor: STROKE_COLOR,
          strokeWidth: STROKE_WIDTH_PX / paper.view.zoom
        });
        path.add(event.point);
        board.beginPath(path);
      }
      // rect/ellipse/slot: the live preview item is created lazily in onMouseDrag below -- a
      // zero-size box (or zero-length axis, for slot) at mousedown has nothing meaningful to show
      // yet.
    };

    tool.onMouseDrag = (event) => {
      if (panning) {
        // Grab-and-slide semantics: dragging right/down must move the visible content right/down,
        // the opposite sign from onWheel()'s scroll-to-pan convention (scrolling right moves the
        // viewport right / content left).
        //
        // Design Step E fix: computes its own delta from the *raw client pixel* position
        // (event.event.clientX/Y) instead of Paper.js's project-space event.point/event.delta.
        // End-to-end verification found that a real multi-tick drag (many native mousemove events
        // between mousedown and mouseup -- the normal case for an actual mouse/trackpad pan, not
        // just a synthetic one) loses roughly half its total distance. Root cause: Paper.js's
        // event.point is computed each tick by inverse-transforming the raw client position
        // through the view's *current* matrix (View.getEventPoint() -> viewToProject()) -- but
        // this same handler just mutated that matrix on the *previous* tick via panBy()+
        // applyViewport(). That makes each tick's event.point/event.delta partly reflect the pan
        // this code itself already applied a moment ago, which cancels out roughly every other
        // tick's contribution (confirmed by hooking view._handleMouseEvent directly: raw
        // clientX/clientY genuinely advance by the full step on every single tick, but the
        // resulting view.center shift alternates real/zero). Reading the untransformed native
        // event's clientX/clientY instead -- always real screen pixels, never affected by our own
        // mid-drag matrix mutation -- breaks that feedback loop. paper.view.zoom is safe to read
        // here (unlike view.center, panning never changes it mid-drag).
        const clientX = event.event.clientX;
        const clientY = event.event.clientY;
        const zoom = paper.view.zoom;
        const dxMm = (clientX - panLastClientPoint.x) / zoom;
        const dyMm = (clientY - panLastClientPoint.y) / zoom;
        panLastClientPoint = { x: clientX, y: clientY };
        board.panBy(-dxMm, -dyMm);
        applyViewport();
        return;
      }
      if (interactionKind === 'move') {
        for (const id of selectedIds) {
          const shape = board.getShape(id);
          if (shape) shape.item.translate(event.delta);
        }
        updateResizeHandles();
        return;
      }
      if (interactionKind === 'resize') {
        const shape = board.getShape(resizeShapeId);
        if (!shape) return;
        let x0 = resizeStartBounds.left;
        let y0 = resizeStartBounds.top;
        let x1 = resizeStartBounds.right;
        let y1 = resizeStartBounds.bottom;
        if (resizeHandle.includes('w')) x0 = event.point.x;
        if (resizeHandle.includes('e')) x1 = event.point.x;
        if (resizeHandle.includes('n')) y0 = event.point.y;
        if (resizeHandle.includes('s')) y1 = event.point.y;
        const width = Math.max(RESIZE_MIN_DIM_MM, Math.abs(x1 - x0));
        const height = Math.max(RESIZE_MIN_DIM_MM, Math.abs(y1 - y0));
        shape.item.bounds = new paper.Rectangle(Math.min(x0, x1), Math.min(y0, y1), width, height);
        updateResizeHandles();
        return;
      }
      if (interactionKind === 'marquee') {
        // Same discard-and-recreate pattern rect/ellipse/slot's preview already uses -- cheap
        // enough to just rebuild every frame. Never touches board.path/board.shapes.
        if (marqueeItem) marqueeItem.remove();
        const box = resolveDragBox(dragStart, event.point);
        const rect = new paper.Rectangle(box.left, box.top, box.width, box.height);
        marqueeItem = new paper.Path.Rectangle(rect);
        marqueeItem.fillColor = MARQUEE_FILL_COLOR;
        marqueeItem.strokeColor = MARQUEE_STROKE_COLOR;
        marqueeItem.strokeWidth = MARQUEE_STROKE_WIDTH_PX / paper.view.zoom;
        return;
      }
      if (interactionKind !== 'draw') return;
      if (mode === 'freehand') {
        if (!dragging || !board.path) return;
        board.path.add(event.point);
        return;
      }
      if (mode === 'slot') {
        const { a, b } = resolveDragAxis(dragStart, event.point);
        board.clearPath();
        const previewItem = buildSlotPreview(a, b, slotWidthMm);
        previewItem.strokeColor = STROKE_COLOR;
        previewItem.strokeWidth = STROKE_WIDTH_PX / paper.view.zoom;
        board.beginPath(previewItem);
        return;
      }
      // rect/ellipse live preview: rebuilt from scratch every drag event from resolveDragBox(),
      // optionally Shift-constrained to a square/circle. Cheap enough (a handful of segments) to
      // just discard-and-recreate rather than resize the existing item in place.
      const current = event.modifiers.shift ? constrainSquare(dragStart, event.point) : event.point;
      const box = resolveDragBox(dragStart, current);
      board.clearPath();
      const rect = new paper.Rectangle(box.left, box.top, box.width, box.height);
      const previewItem = mode === 'rect' ? new paper.Path.Rectangle(rect) : new paper.Path.Ellipse(rect);
      previewItem.strokeColor = STROKE_COLOR;
      previewItem.strokeWidth = STROKE_WIDTH_PX / paper.view.zoom;
      board.beginPath(previewItem);
    };

    tool.onMouseUp = () => {
      if (panning) {
        panning = false;
        updateCursor();
        return;
      }
      if (interactionKind === 'move') {
        interactionKind = null;
        return;
      }
      if (interactionKind === 'resize') {
        interactionKind = null;
        resizeHandle = null;
        resizeShapeId = null;
        resizeStartBounds = null;
        return;
      }
      if (interactionKind === 'marquee') {
        // A marquee below MIN_BOX_DIM_MM is just a click -- the existing clear-selection-on-
        // empty-click behavior in onMouseDown already handled that, nothing further to apply here.
        if (
          marqueeItem &&
          marqueeItem.bounds.width > MIN_BOX_DIM_MM &&
          marqueeItem.bounds.height > MIN_BOX_DIM_MM
        ) {
          const marqueeBox = {
            left: marqueeItem.bounds.left,
            top: marqueeItem.bounds.top,
            width: marqueeItem.bounds.width,
            height: marqueeItem.bounds.height
          };
          const containedIds = board
            .listShapes()
            .filter((shape) => boxContainsBox(marqueeBox, shape.item.bounds))
            .map((shape) => shape.id);
          if (containedIds.length) {
            selectedIds = selectMany(containedIds);
            applySelectionVisuals();
            updateResizeHandles();
          }
        }
        if (marqueeItem) {
          marqueeItem.remove();
          marqueeItem = null;
        }
        interactionKind = null;
        return;
      }
      if (interactionKind !== 'draw') return;
      dragging = false;
      if (mode === 'freehand') {
        // A pointerdown+up with no drag between them never produced a usable stroke (a single
        // segment) -- discard it rather than leaving a degenerate path a later commit would reject.
        if (board.path && board.path.segments.length >= 2) {
          board.path.simplify(SIMPLIFY_TOLERANCE_MM);
          board.finalizeShape();
        } else {
          board.clearPath();
        }
      } else if (mode === 'slot') {
        // A drag preview already exists (built in onMouseDrag) -- finalize it as-is. A plain
        // click (no drag) is a deliberate default-pill placement, not a discard: build a
        // default-length horizontal pill centered on the click point.
        if (board.path) {
          board.finalizeShape();
        } else {
          const halfLengthMm = (slotWidthMm * SLOT_DEFAULT_LENGTH_RATIO) / 2;
          const previewItem = buildSlotPreview(
            { x: dragStart.x - halfLengthMm, y: dragStart.y },
            { x: dragStart.x + halfLengthMm, y: dragStart.y },
            slotWidthMm
          );
          previewItem.strokeColor = STROKE_COLOR;
          previewItem.strokeWidth = STROKE_WIDTH_PX / paper.view.zoom;
          board.beginPath(previewItem);
          board.finalizeShape();
        }
      } else if (
        board.path &&
        board.path.bounds.width > MIN_BOX_DIM_MM &&
        board.path.bounds.height > MIN_BOX_DIM_MM
      ) {
        board.finalizeShape();
      } else {
        board.clearPath();
      }
      interactionKind = null;
    };

    // RS-3010 Step 2c: hover feedback between polygon clicks. Paper.js fires onMouseMove on
    // button-up motion, separately from onMouseDrag (button down) -- rebuilt from scratch every
    // move, same discard-and-recreate pattern rect/ellipse/slot's onMouseDrag preview already
    // uses. No-op outside an in-progress polygon so it never interferes with a drag-based preset's
    // own onMouseDrag-driven preview.
    tool.onMouseMove = (event) => {
      if (interactionKind !== 'polygon' || polygonPoints.length === 0) return;
      board.clearPath();
      const previewItem = new paper.Path({
        strokeColor: STROKE_COLOR,
        strokeWidth: STROKE_WIDTH_PX / paper.view.zoom
      });
      polygonPoints.forEach((point, index) => {
        if (index === 0) previewItem.moveTo(point);
        else previewItem.lineTo(point);
      });
      previewItem.lineTo(event.point);
      board.beginPath(previewItem);
    };
  }

  return {
    get isActive() {
      return board.active;
    },
    get mode() {
      return mode;
    },
    get hasCommittableShapes() {
      return Boolean(board.shapes.length || (board.path && board.path.segments.length >= 2));
    },
    /** True while a polygon is mid-placement (at least one vertex clicked, not yet closed). */
    get hasInProgressPolygon() {
      return interactionKind === 'polygon';
    },
    get zoom() {
      return board.zoom;
    },

    /**
     * @param {{width:number,height:number}} projectCanvasMm project.canvas at the moment drawing
     *   mode was entered -- fixes the base fit scale for this drawing session (matches every other
     *   viewport transform in this app in treating project.canvas as the mm reference frame).
     * @param {number} paddingPx same padding convention drawLayout() already uses (38*dpr).
     * @param {'select'|'freehand'|'rect'|'ellipse'|'slot'|'polygon'} [initialMode]
     */
    enter(projectCanvasMm, paddingPx, initialMode = 'select') {
      canvasMm = projectCanvasMm;
      board.reset();
      board.active = true;
      mode = initialMode;
      selectedIds = clearSelection();
      resetInProgressDrawing();
      if (!isSetUp) {
        paper.setup(canvasEl);
        // Capture the original default layer paper.setup() creates -- this IS the content layer
        // for the lifetime of the page; buildGrid() below (and re-entry/exit's own
        // activeLayer.removeChildren() calls) rely on it staying activeLayer except transiently
        // while buildGrid() constructs the grid layer.
        contentLayer = paper.project.activeLayer;
        isSetUp = true;
      } else {
        paper.project.activeLayer.removeChildren();
        paper.view.autoUpdate = true;
      }
      // Always resync, even on first setup: paper.setup() sizes itself from canvasEl's box at
      // that instant, but this app's own resizeCanvas() may have run against a *different* box
      // moments earlier (or the canvas may simply not have been laid out yet) -- one explicit
      // resync here means enter() never depends on setup()'s own guess being right.
      resyncViewSize();
      baseScale = drawingBaseScale(canvasMm, canvasEl.width, canvasEl.height, paddingPx);
      applyViewport();
      // RS-3010 Step 2d: built once, after applyViewport() has set the real initial zoom (see
      // buildGrid()'s own doc comment for why -- its stroke widths are baked in screen-px-to-mm
      // terms at build time). Guarded on gridLayer rather than isSetUp so it can only ever run on
      // the same first-setup pass, staying entirely absent from every re-entry.
      if (!gridLayer) buildGrid();
      attachTool();
      updateCursor();
    },

    /**
     * Switch input mode without leaving drawing mode -- already-finalized shapes in board.shapes
     * are untouched; only a drag-in-flight (if any) is discarded, since the box preview belongs
     * to whichever mode was active when the drag started.
     * @param {'select'|'freehand'|'rect'|'ellipse'|'slot'|'polygon'} newMode
     */
    setMode(newMode) {
      mode = newMode;
      resetInProgressDrawing();
      // Design Step D: resetInProgressDrawing() above unconditionally clears resizeHandleItems --
      // rebuild them here so switching back to 'select' with a shape still selected brings the
      // handles back rather than leaving them cleared until the next selection change.
      updateResizeHandles();
      updateCursor();
    },

    /**
     * RS-3010 Design Step B: called from app.js's spacebar keydown/keyup listeners (gated on
     * `isActive`, same input-focus guard as the tool shortcuts). While held, a drag pans the view
     * instead of whatever the active mode would otherwise do -- see onMouseDown/onMouseDrag/
     * onMouseUp's `panning` checks above everything else. Releasing space mid-drag cleanly ends
     * the pan (`panning` reset here) rather than leaving the next onMouseUp to act on it.
     * @param {boolean} held
     */
    setSpaceHeld(held) {
      if (spaceHeld === held) return;
      spaceHeld = held;
      if (!held) panning = false;
      updateCursor();
    },

    /**
     * Sets the slot preset's width (mm), read at the moment a slot preview/default-pill is built
     * (not baked in earlier). Invalid input (non-numeric or <= 0) is ignored, keeping the last
     * valid value -- same guard convention as this app's other numeric inputs (e.g. the Gap (mm)
     * field's handler).
     * @param {number|string} value
     */
    setSlotWidthMm(value) {
      const parsed = parseFloat(value);
      if (Number.isFinite(parsed) && parsed > 0) slotWidthMm = parsed;
    },

    /**
     * Resync to canvasEl's current box size while staying in drawing mode -- call this (instead
     * of the normal drawLayout() path, which is a no-op while active) whenever something resizes
     * layoutCanvas: a window resize, or a workspace-tab switch. Preserves the user's current
     * pan/zoom (DrawingBoard.panXmm/panYmm/zoom untouched) rather than re-fitting from scratch,
     * so an in-progress drawing session isn't visually reset by an incidental resize.
     */
    resize(paddingPx) {
      if (!board.active) return;
      resyncViewSize();
      baseScale = drawingBaseScale(canvasMm, canvasEl.width, canvasEl.height, paddingPx);
      applyViewport();
    },

    exit() {
      board.clearAll();
      selectedIds = clearSelection();
      resetInProgressDrawing();
      spaceHeld = false;
      panning = false;
      canvasEl.style.cursor = '';
      if (tool) {
        tool.remove();
        tool = null;
      }
      if (isSetUp) {
        paper.project.activeLayer.removeChildren();
        paper.view.autoUpdate = false;
      }
      board.active = false;
      // Paper.js's CanvasView applies its own devicePixelRatio ctx.scale() to the shared 2D
      // context and only undoes it in view.remove() (never called here -- the project is kept
      // alive, paused, for reuse on the next entry). Without this reset, the next normal
      // drawLayout() call after leaving draw mode would be rendered through that leftover
      // transform on top of drawLayout()'s own manual dpr math, double-scaling everything.
      canvasEl.getContext('2d').setTransform(1, 0, 0, 1, 0, 0);
    },

    onWheel(event) {
      event.preventDefault();
      if (event.ctrlKey || event.metaKey) {
        const factor = Math.exp(-event.deltaY * 0.0015);
        board.zoomBy(factor);
      } else {
        board.panBy((event.deltaX * PAN_WHEEL_TO_MM) / (baseScale * board.zoom), (event.deltaY * PAN_WHEEL_TO_MM) / (baseScale * board.zoom));
      }
      applyViewport();
    },

    /**
     * Discard the in-progress stroke (if any) without leaving drawing mode.
     */
    cancelPath() {
      resetInProgressDrawing();
    },

    /**
     * Remove every currently-selected finalized shape and clear the selection. A no-op if nothing
     * is selected.
     */
    deleteSelected() {
      for (const id of selectedIds) board.removeShape(id);
      selectedIds = clearSelection();
      updateResizeHandles();
    },

    /**
     * Flatten every finalized shape (board.shapes -- not just the current selection) into a
     * 'path' layer object each (app.js pushes them into project.layers and runs updateAll() --
     * this module never touches project state) and clear the board. Returns an empty array if
     * there is nothing to commit. `pathName` is used as-is for a single shape, or suffixed
     * " 1", " 2", ... when multiple shapes commit at once.
     */
    commit({ stoneSize, gap, color, pathName }) {
      const shapes = board.listShapes();
      const layers = [];
      shapes.forEach((shape, index) => {
        const flattened = flattenPathToContour(shape.item, FLATTEN_TOLERANCE_MM);
        if (!flattened) return;
        layers.push(
          createPathLayerFromContour(flattened, {
            stoneSize,
            gap,
            color,
            pathName: shapes.length > 1 ? `${pathName} ${index + 1}` : pathName,
            index
          })
        );
      });
      board.clearAll();
      selectedIds = clearSelection();
      return layers;
    },

    /**
     * QA/verification-only, read-only -- mirrors window.__preview3D's own established precedent
     * (app.js) of exposing internal state for automated verification without driving any
     * application logic. RS-3010 Step 2d: proves the grid layer's activeLayer discipline directly
     * (which layer is active, that it's distinct from the grid layer, and the grid layer's own
     * item count) instead of only inferring it from a screenshot.
     */
    get debugGrid() {
      return {
        activeLayerId: paper.project.activeLayer.id,
        contentLayerId: contentLayer ? contentLayer.id : null,
        gridLayerId: gridLayer ? gridLayer.id : null,
        activeLayerIsContentLayer: paper.project.activeLayer === contentLayer,
        gridItemCount: gridLayer ? gridLayer.children.length : 0,
        shapeCount: board.listShapes().length
      };
    },

    /**
     * QA/verification-only, read-only -- calls the module-private hitTestShapeId() directly by
     * project-mm point, same precedent as debugGrid above. Used to prove a click near a grid line
     * (where no shape exists) does not register as a shape hit.
     * @param {number} xMm
     * @param {number} yMm
     * @returns {string|null}
     */
    debugHitTestShapeId(xMm, yMm) {
      return hitTestShapeId(new paper.Point(xMm, yMm));
    }
  };
}
