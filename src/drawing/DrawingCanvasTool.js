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
 * `isActive`, plus selection/move/delete of already-finalized shapes. Selection state (the set of
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
import { resolveDragBox, constrainSquare } from './DrawingBoxGeometry.js';
import { selectOnly, toggleSelection, clearSelection } from '../editing/Selection.js';

const STROKE_COLOR = '#1a56d6';
const SELECTED_STROKE_COLOR = '#5b9dff';
const STROKE_WIDTH_PX = 2;
const SIMPLIFY_TOLERANCE_MM = 0.35;
const FLATTEN_TOLERANCE_MM = 0.25;
const PAN_WHEEL_TO_MM = 1;
// A completed rect/ellipse drag whose bounding box is at or below this size in either dimension
// never produced a usable shape -- discarded, matching freehand's existing "no usable stroke"
// degenerate-path rule (see onMouseUp's < 2 segments check).
const MIN_BOX_DIM_MM = 1;

export function createDrawingTool(canvasEl) {
  const board = new DrawingBoard();
  let isSetUp = false;
  let tool = null;
  let canvasMm = { width: 100, height: 100 };
  let baseScale = 1;
  let dragging = false;
  let mode = 'freehand';
  let selectedIds = clearSelection();
  // 'draw' while a new freehand/rect/ellipse shape is mid-drag; 'move' while dragging the current
  // selection; null when idle. Set at pointerdown, read by pointerdrag/pointerup to decide which
  // gesture is in progress -- hit-testing at pointerdown (not the current toolbar mode) is what
  // decides between the two, per this file's header comment.
  let interactionKind = null;
  let dragStart = null;

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

  /** Repaints every finalized shape's strokeColor to reflect the current selection. */
  function applySelectionVisuals() {
    for (const shape of board.listShapes()) {
      shape.item.strokeColor = selectedIds.has(shape.id) ? SELECTED_STROKE_COLOR : STROKE_COLOR;
    }
  }

  function attachTool() {
    if (tool) tool.remove();
    tool = new paper.Tool();

    tool.onMouseDown = (event) => {
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
          interactionKind = null;
          return;
        }
        if (!selectedIds.has(hitId)) {
          selectedIds = selectOnly(hitId);
          applySelectionVisuals();
        }
        interactionKind = 'move';
        return;
      }
      // Empty canvas: clear any existing selection and start a new shape per the active mode.
      if (selectedIds.size) {
        selectedIds = clearSelection();
        applySelectionVisuals();
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
      // rect/ellipse: the live preview item is created lazily in onMouseDrag below -- a zero-size
      // box at mousedown has nothing meaningful to show yet.
    };

    tool.onMouseDrag = (event) => {
      if (interactionKind === 'move') {
        for (const id of selectedIds) {
          const shape = board.getShape(id);
          if (shape) shape.item.translate(event.delta);
        }
        return;
      }
      if (interactionKind !== 'draw') return;
      if (mode === 'freehand') {
        if (!dragging || !board.path) return;
        board.path.add(event.point);
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
      if (interactionKind === 'move') {
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
    get zoom() {
      return board.zoom;
    },

    /**
     * @param {{width:number,height:number}} projectCanvasMm project.canvas at the moment drawing
     *   mode was entered -- fixes the base fit scale for this drawing session (matches every other
     *   viewport transform in this app in treating project.canvas as the mm reference frame).
     * @param {number} paddingPx same padding convention drawLayout() already uses (38*dpr).
     * @param {'freehand'|'rect'|'ellipse'} [initialMode]
     */
    enter(projectCanvasMm, paddingPx, initialMode = 'freehand') {
      canvasMm = projectCanvasMm;
      board.reset();
      board.active = true;
      mode = initialMode;
      selectedIds = clearSelection();
      interactionKind = null;
      dragging = false;
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
     * Switch input mode without leaving drawing mode -- already-finalized shapes in board.shapes
     * are untouched; only a drag-in-flight (if any) is discarded, since the box preview belongs
     * to whichever mode was active when the drag started.
     * @param {'freehand'|'rect'|'ellipse'} newMode
     */
    setMode(newMode) {
      mode = newMode;
      interactionKind = null;
      dragging = false;
      board.clearPath();
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
      interactionKind = null;
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
      interactionKind = null;
      dragging = false;
    },

    /**
     * Remove every currently-selected finalized shape and clear the selection. A no-op if nothing
     * is selected.
     */
    deleteSelected() {
      for (const id of selectedIds) board.removeShape(id);
      selectedIds = clearSelection();
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
    }
  };
}
