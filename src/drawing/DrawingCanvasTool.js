/**
 * DrawingCanvasTool — the Paper.js-specific half of RS-3010 Step 1. All direct use of the `paper`
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
 */
import paper from 'paper';
import {
  DrawingBoard,
  drawingBaseScale,
  flattenPathToContour,
  createPathLayerFromContour
} from './DrawingBoard.js';

const STROKE_COLOR = '#1a56d6';
const STROKE_WIDTH_PX = 2;
const SIMPLIFY_TOLERANCE_MM = 0.35;
const FLATTEN_TOLERANCE_MM = 0.25;
const PAN_WHEEL_TO_MM = 1;

export function createDrawingTool(canvasEl) {
  const board = new DrawingBoard();
  let isSetUp = false;
  let tool = null;
  let canvasMm = { width: 100, height: 100 };
  let baseScale = 1;
  let dragging = false;

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
    paper.view.viewSize = new paper.Size(rect.width, rect.height);
  }

  function attachTool() {
    if (tool) tool.remove();
    tool = new paper.Tool();
    tool.onMouseDown = (event) => {
      const path = new paper.Path({
        strokeColor: STROKE_COLOR,
        strokeWidth: STROKE_WIDTH_PX / paper.view.zoom
      });
      path.add(event.point);
      board.beginPath(path);
      dragging = true;
    };
    tool.onMouseDrag = (event) => {
      if (!dragging || !board.path) return;
      board.path.add(event.point);
    };
    tool.onMouseUp = () => {
      if (!dragging) return;
      dragging = false;
      // A pointerdown+up with no drag between them never produced a usable stroke (a single
      // segment) -- discard it rather than leaving a degenerate path a later commit would reject.
      if (board.path && board.path.segments.length >= 2) board.path.simplify(SIMPLIFY_TOLERANCE_MM);
      else board.clearPath();
    };
  }

  return {
    get isActive() {
      return board.active;
    },
    get hasPath() {
      return Boolean(board.path && board.path.segments.length >= 2);
    },
    get zoom() {
      return board.zoom;
    },

    /**
     * @param {{width:number,height:number}} projectCanvasMm project.canvas at the moment drawing
     *   mode was entered -- fixes the base fit scale for this drawing session (matches every other
     *   viewport transform in this app in treating project.canvas as the mm reference frame).
     * @param {number} paddingPx same padding convention drawLayout() already uses (38*dpr).
     */
    enter(projectCanvasMm, paddingPx) {
      canvasMm = projectCanvasMm;
      board.reset();
      board.active = true;
      if (!isSetUp) {
        paper.setup(canvasEl);
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
      attachTool();
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
      board.clearPath();
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
      board.clearPath();
    },

    /**
     * Flatten the in-progress path into a 'path' layer object (app.js pushes it into
     * project.layers and runs updateAll() -- this module never touches project state) and clear
     * it. Returns null if there is no committable path.
     */
    commit({ stoneSize, gap, color, pathName }) {
      if (!board.path || board.path.segments.length < 2) return null;
      const flattened = flattenPathToContour(board.path, FLATTEN_TOLERANCE_MM);
      board.clearPath();
      if (!flattened) return null;
      return createPathLayerFromContour(flattened, { stoneSize, gap, color, pathName });
    }
  };
}
