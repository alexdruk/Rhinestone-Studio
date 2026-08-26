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
 * same empty-canvas branch point. RS-3011 Step 10b adds 'paint' -- a single click-drag-release
 * lasso gesture (unlike polygon/pen's multi-click ownership, `interactionKind` is only ever
 * 'paint' for the duration of one onMouseDown/onMouseDrag/onMouseUp cycle), opting out of the
 * hit-test-move-first dispatch below the same way Pen does (see 'pen-skip-move-hittest'): a lasso
 * must always start fresh on mousedown, even when that point lands on an existing shape, since
 * painting over a shape is the entire point of the tool. The finished lasso polygon is handed to
 * app.js via a new `onPaintStroke` hook -- this file never computes the target shape or a region
 * itself, per this milestone's own architecture split (see PaintRegionSelection.js). Selection state (the set of
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
  flattenPathToContours,
  createPathLayerFromContour,
  createPathLayerFromContours,
  importSvgIntoItem
} from './DrawingBoard.js';
import {
  resolveDragBox,
  constrainSquare,
  resolveDragAxis,
  boxContainsBox,
  snapToGrid,
  snapAngle
} from './DrawingBoxGeometry.js';
import { selectOnly, toggleSelection, clearSelection, selectMany } from '../editing/Selection.js';
import { placeStonesAlongPath } from '../geometry/lineStampSpacing.js';
import { getCrystalAppearance } from '../renderer/CrystalAppearance.js';
import { getStoneSprite, clearStoneSpriteCache, quantizeRadiusPx, VARIANT_COUNT as STONE_SPRITE_VARIANT_COUNT } from './StoneSpriteCache.js';

const STROKE_COLOR = '#1a56d6';
const SELECTED_STROKE_COLOR = '#5b9dff';
const STROKE_WIDTH_PX = 2;
// Design Step C: marquee's own visual, deliberately distinct from STROKE_COLOR/
// SELECTED_STROKE_COLOR -- semi-transparent fill + border reads unambiguously as "a selection
// box" rather than "a shape being drawn" (the standard Photoshop/Figma/Illustrator convention).
const MARQUEE_FILL_COLOR = 'rgba(91, 157, 255, 0.15)';
const MARQUEE_STROKE_COLOR = '#5b9dff';
const MARQUEE_STROKE_WIDTH_PX = 1;
// RS-3011 Step 13: Eraser's own outline-only styling -- distinct from STROKE_COLOR/
// SELECTED_STROKE_COLOR/MARQUEE_STROKE_COLOR (all blue, "drawing/selecting" hues) so both the
// idle-hover ghost circle (updateEraserGhostItem) and the live drag-sweep preview read
// unambiguously as a destructive/removal action, not another shape being drawn. No fillColor on
// either item -- outline-only, per this milestone's own decision doc.
const ERASER_STROKE_COLOR = '#d92b2b';
const SIMPLIFY_TOLERANCE_MM = 0.35;
// RS-3011 Step 8 Phase B: exported so app.js's own Design-native Import SVG handler (a one-shot
// action outside this file's Paper.js-only boundary, not a draw tool -- see this milestone's own
// architecture note) can flatten its imported item at the SAME tolerance every draw tool already
// uses here, rather than hardcoding a second value.
export const FLATTEN_TOLERANCE_MM = 0.25;
// rs-design-crystal-dots: stone sprites are baked at this many px per project-mm, clamped so a
// sprite never bakes absurdly small (illegible facets) or absurdly large (wasted canvas/memory) at
// extreme zoom -- see rebuildStoneGroupForShape()'s own use of these below.
const STONE_SPRITE_PX_PER_MM_MIN = 4;
const STONE_SPRITE_PX_PER_MM_MAX = 64;
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
// RS-3011 Step 6: draw-tool mode -> layer name, read by commitFinalizedShape() so a drawn layer's
// name reflects what it actually is instead of the old blanket 'Drawn Shape'. Freehand has no single
// entry here -- an open stroke ('Line') and a closed blob ('Freehand') are different enough shapes
// that one name for both would be less useful than this step's own goal, so commitFinalizedShape()
// resolves freehand separately based on flattened.closed.
const SHAPE_MODE_LAYER_NAMES = {
  rect: 'Rect',
  ellipse: 'Ellipse',
  slot: 'Slot',
  polygon: 'Polygon',
  pen: 'Pen'
};
// RS-3011 Step 10b: Paint's own lasso constants. PAINT_MIN_LASSO_POINTS mirrors
// MIN_POLYGON_POINTS' own "need at least a triangle" reasoning -- a 2-point lasso has no interior
// to intersect against a candidate shape. PAINT_MIN_SAMPLE_DISTANCE_PX is onMouseDrag's
// point-sampling throttle (only push a new lasso point once the pointer has moved past this
// distance since the last one, avoiding a point per pointermove sample): the same idea FillTool.ts
// applies via its own onMove throttle, but that reference's literal "1.5" constant was
// drawleather's own pointer-sample unit, not a screen-px value -- this instead follows
// hitTestShapeId's own screen-px-to-project-mm conversion pattern (divided by paper.view.zoom at
// the call site) for a comparable small threshold. PAINT_LASSO_DASH_PX sizes the live preview's
// dash pattern, same "constant apparent size on screen regardless of zoom" convention as
// RESIZE_HANDLE_SIZE_PX below (divided by zoom at build time).
const PAINT_MIN_LASSO_POINTS = 3;
const PAINT_MIN_SAMPLE_DISTANCE_PX = 3;
const PAINT_LASSO_DASH_PX = 5;
// RS-3013 Step 1: Select/Lasso's own click-to-select-an-existing-region hit-test tolerance --
// mirrors hitTestShapeId's own `4 / paper.view.zoom` screen-px-to-project-mm stroke-tolerance
// convention exactly (same forgiving-click-near-an-edge reasoning), rather than a second tuned
// value, since a region lives inside a shape and should feel exactly as forgiving to click as the
// shape's own edge already does.
const REGION_HIT_MARGIN_PX = 4;
// RS-3011 Step 11: Trace's own point-sampling throttle, the same "only push a new point once the
// pointer has moved far enough" idea as PAINT_MIN_SAMPLE_DISTANCE_PX above, but taken directly from
// drawleather's LineStampTool.ts as a plain project-mm distance, NOT converted to a screen-px value
// the way PAINT_MIN_SAMPLE_DISTANCE_PX deliberately was (see that constant's own doc comment) -- the
// Step 11 prompt cites this threshold as LineStampTool.ts's own value verbatim, not as a value that
// needed the same px-to-mm adaptation Paint's own FillTool.ts precedent did.
const TRACE_MIN_SAMPLE_DISTANCE_MM = 1.0;
// RS-3011 Step 11: click-to-place tools that stay active after each placement (no revert-to-Select
// on commit, unlike every other draw preset) -- Escape's own idle-revert-to-Select (cancelPath()
// below) keys off this shared set instead of forking per-tool logic. RS-3011 Step 13: Eraser joins
// it here, the one-line change this doc comment already anticipated. RS-3013 Step 1: Lasso joins it
// too -- same "never auto-reverts to Select on its own" rule (it's a repeated tool, not a one-shot
// creation preset), same resulting Escape gap this set exists to close.
const CLICK_TO_PLACE_MODES = new Set(['stamp', 'trace', 'eraser', 'lasso']);
// RS-3011 Step 13: Eraser's own brush-radius floor (decision 4b: '[' / ']' nudge by 0.5mm, clamped
// at this floor, no ceiling) -- also the floor setEraserRadiusMm() clamps any programmatic value
// to, so the ghost preview/actual daubs can never collapse to a zero-or-negative radius.
const ERASER_RADIUS_FLOOR_MM = 0.5;
// RS-3011 Step 13: setEraserRadiusMm()'s own fallback before app.js's first real call (mirrors
// SLOT_DEFAULT_WIDTH_MM's own role for slotWidthMm above) -- app.js seeds the real value from the
// selected layer's stoneSize the first time Eraser mode is entered in a session, so this is only
// ever visible for the eye-blink before that happens.
const ERASER_DEFAULT_RADIUS_MM = 1;
// RS-3014 Step 1: Stamp/Trace's own style fallbacks before app.js's first real setStampStyle()/
// setTraceStyle() call -- same "only ever visible for the eye-blink before seeding happens" role as
// ERASER_DEFAULT_RADIUS_MM above, matching app.js's own stampSettings/traceSettings defaults.
const STAMP_DEFAULT_SIZE_MM = 2;
const STAMP_DEFAULT_COLOR = 'gold';
const TRACE_DEFAULT_SIZE_MM = 2;
const TRACE_DEFAULT_GAP_MM = 0.3;
const TRACE_DEFAULT_COLOR = 'gold';
// RS-3011 Step 9: Pen's own constants -- same values as Polygon's above for the same underlying
// reasons (need at least a triangle to close; hit tolerance mirrors hitTestShapeId's screen-px-to-
// project-mm pattern), kept as independent named constants since Pen and Polygon are separate
// features. PEN_DRAG_DEAD_ZONE_MM is the click-vs-drag threshold: a mousedown+mouseup with less
// than this much movement places a plain corner anchor (no handles); crossing it while the button
// is still down pulls a curve handle instead. 0.5mm mirrors the mouse-precision threshold cited in
// this milestone's drawleather technique review (not ported code, just the same tuned value).
const PEN_MIN_CLOSE_ANCHORS = 3;
const PEN_ANCHOR_HIT_TOLERANCE_PX = 6;
const PEN_DRAG_DEAD_ZONE_MM = 0.5;
// RS-3011 Step 9 follow-up (finishOpenPenPath): a genuine double-click's two click events land at
// the same screen coordinate (no pointer movement between them), so the two anchors they place are
// exactly coincident, not merely within click-proximity of each other -- an intentionally much
// tighter check than PEN_ANCHOR_HIT_TOLERANCE_PX's 6px hit-test above, which exists to forgive
// imprecise aim, not to dedup a double-click. Mirrors this file's own existing "exact coincidence"
// convention for degenerate-input checks (buildSlotPreview's a-vs-b check, the resize-bounds-
// unchanged checks below), not a proximity/intent heuristic like the others in this cluster.
const PEN_COINCIDENT_ANCHOR_TOLERANCE_MM = 1e-6;
// RS-3011 Step 9 follow-up (anchor/handle chrome): sizes/colors for the always-on anchor dots and
// the tangent-line-plus-tip-dot shown while a handle is being shaped, following the drawleather
// Scene.ts three-phase handle render (appendBezierTangentLine/appendBezierTipDot) but simplified --
// no lock-mode coloring and no attached-line square/circle distinction, since Pen has neither
// concept. Reuses STROKE_COLOR (the same blue as the in-progress path itself) rather than
// introducing a new hue, and sizes them off PEN_ANCHOR_HIT_TOLERANCE_PX's 6px so the dot roughly
// matches its own click target. All *_PX constants are divided by paper.view.zoom at build time,
// same convention as RESIZE_HANDLE_SIZE_PX below, so the chrome stays a constant apparent size on
// screen regardless of zoom.
const PEN_ANCHOR_DOT_RADIUS_PX = 3.5;
const PEN_HANDLE_TIP_RADIUS_PX = 2.5;
const PEN_HANDLE_LINE_WIDTH_PX = 1;
// Trim distances so the tangent line visually starts at the anchor dot's edge and ends at the tip
// dot's edge rather than passing through either center (mirrors ANCHOR_TRIM_MM/TIP_TRIM_MM).
const PEN_ANCHOR_TRIM_PX = 5;
const PEN_TIP_TRIM_PX = 3.5;
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
// RS-3033: rotate handle's own constants, mirroring app.js's own ROTATE_HANDLE_GAP_MM/
// ROTATE_HANDLE_RADIUS_PX/drawRotateHandle() styling exactly, for visual consistency between
// Design's own rotate handle and the main app.js system's -- ROTATE_HANDLE_GAP_MM is a genuine mm
// quantity (like app.js's own), used as-is; the dot's radius and hit-test tolerance follow this
// file's own RESIZE_HANDLE_SIZE_PX/hitTestResizeHandle() convention instead (a *_PX value divided
// by paper.view.zoom at use, so the chrome/hit target stay a constant apparent size on screen
// regardless of zoom) -- app.js's own ROTATE_HANDLE_HIT_TOLERANCE_MM is a flat, non-zoom-adjusted
// mm tolerance, "tuned for a different zoom range" per hitTestResizeHandle()'s own doc comment, so
// it is deliberately not reused verbatim here, only its numeric value (4).
const ROTATE_HANDLE_GAP_MM = 10;
const ROTATE_HANDLE_RADIUS_PX = 7;
const ROTATE_HANDLE_HIT_TOLERANCE_PX = 4;
const ROTATE_HANDLE_LINE_COLOR = 'rgba(20,120,255,.55)';
const ROTATE_HANDLE_LINE_WIDTH_PX = 1.25;
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
// RS-3010 Step 2f: same increment and Shift-gated convention as app.js's own rotate-handle
// (`ROTATION_SNAP_STEP_DEG`, `if(e.shiftKey)rotationDeg=Math.round(...)`) -- defined locally here
// rather than imported, since app.js has no exports and already imports createDrawingTool from
// this file (an app.js -> this file import would be circular).
const ROTATION_SNAP_STEP_DEG = 15;

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
 * RS-3033: the rotate handle's own VISUAL position for a bounds Rectangle -- a fixed mm gap
 * (ROTATE_HANDLE_GAP_MM) directly above its top-center, mirroring app.js's own
 * rotateHandlePositionMm() exactly (RS-3029's own accepted simplification: the handle does NOT
 * orbit with the shape's current rotation, it always sits above the shape's CURRENT axis-aligned
 * bounds' top edge -- unaffected by Step C's own deferred "resize handles becoming rotation-aware"
 * scope, since this handle was never rotation-tracking to begin with). `anchor` is the connecting
 * line's other end (the bounds' own top-center). Position only -- NOT the rotation pivot: that is
 * the shape's own STAMPED item.data.pivotXMm/pivotYMm (see materializeShapeFromLayer()'s own
 * comment for why `bounds.center` cannot substitute for it once a shape is actually rotated).
 * @param {paper.Rectangle} bounds
 * @returns {{point:paper.Point,anchor:paper.Point}}
 */
function rotateHandlePositionFor(bounds) {
  const anchor = bounds.topCenter;
  const point = new paper.Point(anchor.x, anchor.y - ROTATE_HANDLE_GAP_MM);
  return { point, anchor };
}

/**
 * RS-3034: each handle's unit offset from the box's own center (nw=(-1,-1), n=(0,-1), etc.),
 * implicit in handlePositionsFor() above -- mirrors app.js's own HANDLE_UNIT_OFFSET verbatim, used
 * by the resize-drag algorithm to find a handle's ANCHOR (the opposite corner/edge, i.e. this
 * offset negated) without per-handle-name branching.
 */
const HANDLE_UNIT_OFFSET = {
  nw: { x: -1, y: -1 }, ne: { x: 1, y: -1 }, se: { x: 1, y: 1 }, sw: { x: -1, y: 1 },
  n: { x: 0, y: -1 }, e: { x: 1, y: 0 }, s: { x: 0, y: 1 }, w: { x: -1, y: 0 }
};

/**
 * RS-3034: rotates point (x,y) about (cx,cy) by rotationDeg -- mirrors app.js's own rotatePointDeg()
 * (itself a verbatim copy of GeometryEngine.js's rotatePointsAroundCenter() formula: clockwise,
 * this app's Y-down mm-space convention) verbatim. A local copy rather than an import for the same
 * reason app.js's own comment gives for not importing GeometryEngine's module-private version --
 * this file owns all direct Paper.js/point-math construction, per its own header comment. Distinct
 * from `item.rotate(angle, center)` (which rotates a whole Paper.js Item): the resize-drag algorithm
 * below needs to rotate individual points/vectors, not whole Items.
 * @param {number} x
 * @param {number} y
 * @param {number} cx
 * @param {number} cy
 * @param {number} rotationDeg
 * @returns {{x:number,y:number}}
 */
function rotatePointDeg(x, y, cx, cy, rotationDeg) {
  const radians = rotationDeg * (Math.PI / 180);
  const cos = Math.cos(radians), sin = Math.sin(radians);
  const dx = x - cx, dy = y - cy;
  return { x: cx + dx * cos - dy * sin, y: cy + dx * sin + dy * cos };
}

/**
 * RS-3034: `item`'s own LOCAL (pre-rotation) axis-aligned bounds. For an unrotated item (the
 * overwhelming majority case) this is simply a clone of its current `.bounds` -- byte-identical to
 * what every pre-existing call site already read directly, and cloned (not returned live) to match
 * the existing `shape.item.bounds.clone()` snapshot convention resize-drag-start already used.
 *
 * For a rotated item, `.bounds` is the enclosing AABB of the TILTED shape -- generally larger than,
 * and offset from, the true local box (layer.x/y/w/h) -- not usable directly, the same reason
 * app.js's own rotatedHandlesFor() rotates handlesFor(b)'s positions FORWARD from the known local
 * box rather than trying to derive them from an already-rotated box. This file has no stored local
 * box to start from (materializeShapeFromLayer()/materializeShapeLibraryItemFromLayer() build the
 * item and immediately bake the rotation in, keeping only rotationDeg/pivotXMm/pivotYMm as
 * bookkeeping -- see those functions' own comments), so the local box is instead recovered exactly
 * via a detached clone (`insert:false`, never added to the board/project) inverse-rotated by
 * -rotationDeg around the item's own stamped pivot -- exact, since item.rotate() is a rigid
 * transform and this is its precise inverse, unlike assuming the local box always touches all 4 of
 * the natural contour's own edges.
 * @param {paper.Item} item
 * @returns {paper.Rectangle}
 */
function unrotatedLocalBoundsFor(item) {
  const rotationDeg = item.data.rotationDeg || 0;
  if (!rotationDeg) return item.bounds.clone();
  const pivot = new paper.Point(item.data.pivotXMm, item.data.pivotYMm);
  const clone = item.clone({ insert: false });
  clone.rotate(-rotationDeg, pivot);
  const bounds = clone.bounds.clone();
  clone.remove();
  return bounds;
}

/**
 * RS-3034: handlePositionsFor(bounds)'s 8 positions, but for the shape's own TRUE rotated corners
 * instead of its plain axis-aligned local box -- mirrors app.js's own rotatedHandlesFor(b,
 * rotationDeg) exactly: rotate the local box's handle positions around the shape's own TRUE pivot
 * (item.data.pivotXMm/pivotYMm, NOT localBounds.center -- see materializeShapeFromLayer()'s own
 * comment for why the two drift apart once a shape has actually been resized/rotated) by the
 * shape's current rotationDeg. At rotationDeg === 0, unrotatedLocalBoundsFor()'s own fast path
 * makes this produce byte-identical output to handlePositionsFor(item.bounds) directly -- a true
 * no-op for every unrotated shape, matching this milestone's own most important invariant.
 * @param {paper.Item} item
 * @returns {{name:string,point:paper.Point}[]}
 */
function rotatedHandlePositionsFor(item) {
  const rotationDeg = item.data.rotationDeg || 0;
  const localBounds = unrotatedLocalBoundsFor(item);
  const handles = handlePositionsFor(localBounds);
  if (!rotationDeg) return handles;
  const pivot = { x: item.data.pivotXMm, y: item.data.pivotYMm };
  return handles.map(({ name, point }) => {
    const rotated = rotatePointDeg(point.x, point.y, pivot.x, pivot.y, rotationDeg);
    return { name, point: new paper.Point(rotated.x, rotated.y) };
  });
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

/**
 * RS-3014 Step 3: builds the actual swept-area polygon(s) for an Eraser gesture -- the drag
 * preview (`eraseItem`) is a STROKED path, visual only, so it can't be handed to
 * src/geometry/PathBoolean.js's combineShapeSources() directly for Outline-mode cutting. One
 * capsule per consecutive point pair, built via buildSlotPreview() itself (widthMm =
 * eraserRadiusMm*2 makes it exactly a radius-eraserRadiusMm capsule around that segment,
 * including buildSlotPreview()'s own length<1e-6 circle fallback -- reused unchanged rather than
 * duplicated, so a single-point gesture degenerates to a circle the same way a zero-length slot
 * drag already does), unioned together with Paper.js's own PathItem#unite() (an analytic boolean
 * local to this module, distinct from and NOT a substitute for PathBoolean.js's raster subtract
 * engine, which does the actual shape-cutting math once app.js hands this polygon off to it) so a
 * multi-segment drag produces one clean input polygon instead of several overlapping ones.
 *
 * Point extraction reuses flattenPathToContours() (DrawingBoard.js) rather than a second
 * flatten-and-read-segments implementation -- that function roots its output against its own
 * computed (xMm, yMm) box, so those are added back to every point to recover this module's usual
 * absolute-mm convention. Every intermediate Paper.js item this function creates is removed from
 * the project before returning -- this is a pure point-list computation, not something meant to
 * leave any trace on the canvas.
 *
 * @param {{x:number,y:number}[]} points buffered drag points, absolute project-mm (same
 *   convention as erasePoints/daubsAbsoluteMm) -- one point is a valid, expected input (a plain
 *   click), matching Eraser's own "click = one daub" precedent.
 * @param {number} eraserRadiusMm
 * @returns {{xMm:number,yMm:number}[][]} one or more closed rings, absolute project-mm. Empty
 *   when `points` is empty.
 */
function buildEraserCorridorPolygons(points, eraserRadiusMm) {
  if (points.length === 0) return [];

  const widthMm = eraserRadiusMm * 2;
  let unioned = null;
  const segmentCount = Math.max(1, points.length - 1);
  for (let i = 0; i < segmentCount; i++) {
    const a = points[i];
    const b = points.length === 1 ? points[0] : points[i + 1];
    const segment = buildSlotPreview(a, b, widthMm);
    if (!unioned) {
      unioned = segment;
    } else {
      const next = unioned.unite(segment);
      unioned.remove();
      segment.remove();
      unioned = next;
    }
  }

  const flattened = flattenPathToContours(unioned, FLATTEN_TOLERANCE_MM);
  unioned.remove();
  return flattened.contours.map(({ contour }) => contour.map((p) => ({
    xMm: p.x + flattened.xMm,
    yMm: p.y + flattened.yMm
  })));
}

/**
 * RS-3014 Step 3: the natural-space-box-selection half of materializeShapeFromLayer()'s own
 * placement formula, split out so expectedShapeBoundsMm() below (syncFromProjectLayers()'s bounds-
 * reconciliation check) can compute the SAME scale/offset without also building any Paper.js
 * segments -- same "compute the cheap half without paying for the expensive half" split
 * rebuildStoneGroupForShape() already relies on for styleParams vs. live-flattened geometry.
 * @param {object} layer
 * @param {{x:number,y:number}[]} allPoints layer.contours.flat() -- passed in so callers that
 *   already have it (materializeShapeFromLayer()) don't flatten `contours` twice.
 */
function computeLayerNaturalPlacement(layer, allPoints) {
  const frozenBox = layer.naturalBoundingBoxMm;
  const minX = frozenBox ? frozenBox.minXmm : Math.min(...allPoints.map((p) => p.x));
  const minY = frozenBox ? frozenBox.minYmm : Math.min(...allPoints.map((p) => p.y));
  const maxX = frozenBox ? frozenBox.maxXmm : Math.max(...allPoints.map((p) => p.x));
  const maxY = frozenBox ? frozenBox.maxYmm : Math.max(...allPoints.map((p) => p.y));
  const naturalWidth = maxX - minX;
  const naturalHeight = maxY - minY;
  return {
    minX,
    minY,
    scaleX: naturalWidth > 0 ? layer.w / naturalWidth : 1,
    scaleY: naturalHeight > 0 ? layer.h / naturalHeight : 1
  };
}

/**
 * RS-3014 Step 3: the bounds a materializeShapeFromLayer() item WOULD have for `layer`, computed
 * analytically (no Paper.js items built) -- syncFromProjectLayers()'s own bounds-reconciliation
 * check (see its own doc comment) needs this instead of the raw `(layer.x, layer.y, layer.w,
 * layer.h)` box it used before this step: for every layer predating naturalBoundingBoxMm, this
 * always returns exactly that same box (materializeShapeFromLayer() by construction scales the
 * live natural contour to exactly fill it), so the comparison is byte-identical to before. For a
 * layer an Outline-mode Eraser cut has shrunk, the frozen box is now LARGER than the current
 * contour's own extent, so the placed shape's real bounds are legitimately smaller than
 * `layer.w`/`layer.h` -- comparing against the raw box would treat "this cut shape correctly
 * reflects its own contours" as "still needs reconciling" on EVERY tick forever, re-triggering an
 * unnecessary re-materialize each time (the exact per-tick cost syncFromProjectLayers()'s own
 * forceStoneRebuild doc comment already flags as worth avoiding).
 * @param {object} layer
 * @returns {{left:number,top:number,width:number,height:number}|null} null for a layer with no
 *   usable contour (mirrors materializeShapeFromLayer()'s own early-return).
 */
function expectedShapeBoundsMm(layer) {
  const contours = layer.contours;
  if (!Array.isArray(contours) || contours.length === 0) return null;
  const allPoints = contours.flat();
  if (allPoints.length === 0) return null;
  const { minX, minY, scaleX, scaleY } = computeLayerNaturalPlacement(layer, allPoints);
  let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity;
  for (const p of allPoints) {
    const x = layer.x + (p.x - minX) * scaleX;
    const y = layer.y + (p.y - minY) * scaleY;
    if (x < left) left = x;
    if (x > right) right = x;
    if (y < top) top = y;
    if (y > bottom) bottom = y;
  }
  return { left, top, width: right - left, height: bottom - top };
}

/**
 * Canvas-desync fix: builds a Paper.js Path for a 'path'-type project.layers entry driven
 * entirely from its own stored data (`contours`/x/y/w/h) -- the reconciliation counterpart of
 * commitFinalizedShape(), which builds the same shape at draw-time from a freshly-drawn item
 * instead of a stored layer. Places the natural, (0,0)-rooted contour into the layer's x/y/w/h box
 * via the same independent-axis scale-then-translate GeometryEngine.js's own
 * `_placeNaturalContours()` uses for identical "natural contour into a box" placement -- not
 * imported from there (this file owns all direct Paper.js construction, per its own header
 * comment, and the placement math itself is a few lines), just the same formula. Returns null for
 * a layer with no usable contour (defensive -- every real 'path' layer has one).
 *
 * Only closes the reconstructed item when `layer.closed` isn't explicitly `false` (RS-3011 open-
 * contour fix): an open freehand stroke reconciled here -- undo/redo, or the Layers-list trash-icon
 * delete path this function guards against -- must stay open, or it would silently gain a closing
 * edge it never had.
 *
 * RS-3011 Step 8 Phase B: a layer with more than one contour (a multi-contour SVG import -- a
 * donut/ring with a hole, or a disjoint multi-piece shape -- see flattenPathToContours()) builds a
 * paper.CompoundPath whose children are one paper.Path per contour, each built by the identical
 * moveTo/lineTo/closePath loop below, instead of a single paper.Path -- a CompoundPath is what makes
 * a hole actually render as a hole (a plain Path has no notion of "this loop cuts a hole in that
 * one"). The single-contour branch is completely unchanged from before this Phase -- every existing
 * hand-drawn shape (always exactly one contour) still takes it byte-for-byte as before.
 *
 * RS-3014 Step 3: honors `layer.naturalBoundingBoxMm` when present, in place of a fresh min/max
 * recomputed from `contours` -- the SAME override GeometryEngine's own computeNaturalContourTransform()
 * accepts (see that function's own doc comment for why: recomputing fresh from `contours` on every
 * call is exactly what makes an Outline-mode Eraser cut rescale/reposition everything relative to
 * the shape once `contours` itself shrinks). Without this, this function's own independent copy of
 * the same placement formula would silently stretch a cut shape's now-smaller contour back up to
 * fill `layer.w`/`layer.h` unchanged, visually erasing the cut on Design's own canvas even though
 * GeometryEngine's stone generation (which does honor the freeze) renders it correctly -- a real
 * defect caught during this step's own browser verification, not a hypothetical.
 *
 * RS-3033: applies `layer.rotationDeg` (default 0) as a final whole-item rotation, via Paper.js's
 * own `item.rotate(angle, center)` -- verified (see this milestone's own doc) to share this app's
 * established clockwise/Y-down convention (GeometryEngine.js's rotatePointsAroundCenter(), app.js's
 * rotatePointDeg()) with no sign flip needed. Pivots around the layer's own PLACED bounding-box
 * center (layer.x + layer.w/2, layer.y + layer.h/2) -- by construction, exactly where
 * GeometryEngine._pathPolygons()'s own new rotation step pivots too (computeLayerNaturalPlacement()
 * above scales the natural/frozen box to exactly fill layer.x/y/w/h, the identical guarantee
 * _placeNaturalContours() makes engine-side), so this outline chrome and the real generated stones
 * always rotate around the same point. Always stamps `item.data.rotationDeg` with the rotation
 * actually applied (0 for an unrotated item) -- syncFromProjectLayers()'s own reconciliation reads
 * this back to detect a rotation-only change a plain AABB comparison could miss.
 * @param {object} layer a project.layers entry with type==='path'
 * @returns {paper.Path|paper.CompoundPath|null}
 */
function materializeShapeFromLayer(layer) {
  const contours = layer.contours;
  if (!Array.isArray(contours) || contours.length === 0) return null;
  for (const contour of contours) {
    if (!contour || contour.length < 3) return null;
  }

  const allPoints = contours.flat();
  const { minX, minY, scaleX, scaleY } = computeLayerNaturalPlacement(layer, allPoints);

  function buildContourPath(contour) {
    const path = new paper.Path();
    contour.forEach((p, index) => {
      const point = new paper.Point(layer.x + (p.x - minX) * scaleX, layer.y + (p.y - minY) * scaleY);
      if (index === 0) path.moveTo(point);
      else path.lineTo(point);
    });
    if (layer.closed !== false) path.closePath();
    return path;
  }

  let item;
  if (contours.length === 1) {
    item = buildContourPath(contours[0]);
    item.strokeColor = STROKE_COLOR;
    item.strokeWidth = STROKE_WIDTH_PX / paper.view.zoom;
  } else {
    const compound = new paper.CompoundPath({
      strokeColor: STROKE_COLOR,
      strokeWidth: STROKE_WIDTH_PX / paper.view.zoom
    });
    for (const contour of contours) compound.addChild(buildContourPath(contour));
    item = compound;
  }

  const rotationDeg = layer.rotationDeg || 0;
  const pivot = new paper.Point(layer.x + layer.w / 2, layer.y + layer.h / 2);
  if (rotationDeg) {
    item.rotate(rotationDeg, pivot);
  }
  item.data.rotationDeg = rotationDeg;
  // RS-3033: the TRUE rotation pivot (this layer's own placement-box center), stamped separately
  // from rotationDeg -- Select's own rotate-drag (onMouseDown) needs this to correctly pivot a
  // SECOND rotate-drag on an already-rotated, non-symmetric shape. shape.item.bounds' own center
  // cannot substitute for this once a shape is rotated: an axis-aligned bounding box's center
  // generally drifts away from the true rotation pivot for any non-point-symmetric contour (a
  // circle/square is point-symmetric and would happen to still agree, but an arrow, an L-shape, or
  // any off-center natural contour would not) -- only a MOVE or RESIZE (which re-materializes
  // through here again) ever changes this value; rotation itself never does.
  item.data.pivotXMm = pivot.x;
  item.data.pivotYMm = pivot.y;
  return item;
}

/**
 * RS-3032 Step A: builds a Paper.js item for a SHAPE_LIBRARY_KINDS project.layers entry (Star/
 * Ring/Heart/Arrow/Cross/Crescent/Pentagon/Hexagon/Octagon/Shield/Ellipse/Capsule/Regular Polygon
 * -- exactly what the "More Shapes" popover and the Shapes panel's non-circle buttons create) --
 * the counterpart of materializeShapeFromLayer() above for a layer with no STORED `contours` to
 * read. A shape-library layer's true outline only exists as a formula inside GeometryEngine (plus
 * RS-3028's rotationDeg step), so `resolvePolygons(layer)` -- app.js's own
 * resolveShapeLibraryPolygons hook -- resolves it via the SAME permanentEngine.resolveShapePolygons()
 * call every other consumer (Boolean Operations, Fit Text to Shape) already uses, rather than this
 * file growing a second contour-generation implementation. The returned polygons are already
 * absolute project-mm (the same coordinate space layer.x/y/materializeShapeFromLayer()'s own placed
 * points use, and already correctly rotated per the layer's own rotationDeg -- see
 * GeometryEngine.resolveShapePolygons()'s own doc comment), so unlike materializeShapeFromLayer()
 * above, no natural-space min/max/scale placement math is needed here at all -- points are used
 * as-is. Follows materializeShapeFromLayer()'s own single-contour-Path vs. multi-contour-
 * CompoundPath construction/styling exactly, so a shape-library shape reads identically on Design's
 * own canvas. Every SHAPE_LIBRARY_KINDS shape is a closed outline (never an open freehand stroke
 * like a 'path' layer can be), so this always closes each contour -- no `layer.closed` check.
 *
 * Deliberately does NOT handle 'circle' (a different data model -- cx/cy/r, not x/y/w/h --
 * shapeLayerResolveParams() branches on it, and this step's own onShapeResized write-back does not)
 * or 'svg'/'image' (their real raster/vector content, not just an outline, would need rendering) --
 * both stay out of Design's own canvas for now, unchanged from before this step.
 * @param {object} layer a project.layers entry with type in SHAPE_LIBRARY_KINDS
 * @param {(layer:object)=>({polygons:{xMm:number,yMm:number}[][],boundingBox:*}|null)} resolvePolygons
 * @returns {paper.Path|paper.CompoundPath|null}
 */
function materializeShapeLibraryItemFromLayer(layer, resolvePolygons) {
  const resolved = resolvePolygons(layer);
  const polygons = resolved && resolved.polygons;
  if (!Array.isArray(polygons) || polygons.length === 0) return null;
  for (const polygon of polygons) {
    if (!polygon || polygon.length < 3) return null;
  }

  function buildContourPath(polygon) {
    const path = new paper.Path();
    polygon.forEach((p, index) => {
      const point = new paper.Point(p.xMm, p.yMm);
      if (index === 0) path.moveTo(point);
      else path.lineTo(point);
    });
    path.closePath();
    return path;
  }

  let item;
  if (polygons.length === 1) {
    item = buildContourPath(polygons[0]);
    item.strokeColor = STROKE_COLOR;
    item.strokeWidth = STROKE_WIDTH_PX / paper.view.zoom;
  } else {
    const compound = new paper.CompoundPath({
      strokeColor: STROKE_COLOR,
      strokeWidth: STROKE_WIDTH_PX / paper.view.zoom
    });
    for (const polygon of polygons) compound.addChild(buildContourPath(polygon));
    item = compound;
  }
  // RS-3033: unlike materializeShapeFromLayer()'s own rotation step, this shape's rotation is
  // already baked directly into `polygons`' own point positions (resolvePolygons() -- app.js's
  // resolveShapeLibraryPolygons hook -- calls GeometryEngine.resolveShapePolygons(), whose own
  // RS-3028 rotation step runs before this function ever sees the points), so no separate
  // item.rotate() call is needed here. Still stamps item.data.rotationDeg/pivotXMm/pivotYMm, the
  // same bookkeeping materializeShapeFromLayer() now does (see that function's own comment for why
  // the pivot -- this layer's own placement-box center, distinct from the item's own live,
  // rotation-drifted AABB center -- must be tracked explicitly), so Select's own rotate-drag
  // (onMouseDown) can read a SHAPE_LIBRARY_KINDS shape's starting rotation/pivot the identical way
  // it does for a 'path' shape, rather than wrongly assuming every drag starts from 0/the wrong point.
  item.data.rotationDeg = layer.rotationDeg || 0;
  item.data.pivotXMm = layer.x + layer.w / 2;
  item.data.pivotYMm = layer.y + layer.h / 2;
  return item;
}

/**
 * RS-3012 Step 2: builds a Paper.js proxy item for an 'svg' or 'image' project.layers entry --
 * closes the gap left by materializeShapeFromLayer()/materializeShapeLibraryItemFromLayer() above,
 * which deliberately never handled these two types (see the latter's own doc comment). Both types
 * already use the same x/y/w/h/rotationDeg box model as every other XYWH_SHAPE_TYPES layer
 * (app.js), so click-to-select/drag/resize/rotate all reuse the identical hitTestShapeId()/
 * rotatedHandlePositionsFor()/onShapeMoved/onShapeResized/onShapeRotated machinery those other
 * layer types already go through -- this function's only job is producing an item for that
 * machinery to operate on.
 *
 * 'svg': resolves the SVG's own real vector outline via `resolveSvgPolygons(layer)` -- app.js's own
 * hook onto permanentEngine.resolveSvgPolygons(), the SAME "get this SVG's fillable outline" call
 * Boolean Operations already uses (see app.js's resolveLayerShapeSource()) -- rather than a second,
 * from-scratch SVG-markup parser living in this file. Builds a Path/CompoundPath from the returned
 * polygons using the identical single-vs-multi-contour construction/styling
 * materializeShapeLibraryItemFromLayer() above already uses, so an imported SVG reads identically to
 * every other outline on Design's own canvas. Unlike that function's own polygons (already rotated
 * by GeometryEngine's own RS-3028 step), resolveSvgPolygons() has no rotationDeg parameter at all --
 * SVG layers never got that production-pipeline wiring (generateSvgStonesLive() doesn't forward
 * rotationDeg either, a pre-existing gap outside this milestone's scope) -- so this function rotates
 * the built item itself, the same explicit item.rotate() step materializeShapeFromLayer() above
 * takes for a 'path' layer's own unrotated contours.
 *
 * 'image' has no vector outline at all (its stones come from a raster threshold trace, not a
 * fillable contour), and the main canvas itself never draws the source bitmap on layoutCanvas
 * outside Design either -- only the layer's own selection box and its generated stone dots ever
 * appear there. A plain rectangle (same outline styling as every other shape here) is therefore
 * already a faithful proxy, not a compromise: it reads exactly as this layer already reads
 * everywhere else in the app. Deliberately no on-canvas text label: an early version of this
 * function wrapped the rectangle and a PointText in a paper.Group so a user could tell what it was
 * without opening the Inspector, but a Group's own bounds are the union of ALL its children's, so
 * any label wide enough to overflow a narrow/short box (near-guaranteed for a real file name at
 * this app's typical Design zoom) silently inflated the shape's hit-test/resize-handle bounds past
 * its true x/y/w/h -- a real bug caught by this milestone's own browser verification, not a
 * hypothetical. The Layers list/Inspector already label this shape (layerLabel()'s own
 * imageName/svgName fallback), so no on-canvas label was ever required by this milestone's brief.
 *
 * The same rectangle fallback also covers an 'svg' layer whose outline can't be resolved (missing/
 * unparseable svgSource) -- same "always give this layer SOME on-canvas presence" goal as the
 * real-outline case above, so a broken SVG import doesn't just silently vanish from Design.
 * @param {object} layer a project.layers entry with type 'svg' or 'image'
 * @param {(layer:object)=>({polygons:{xMm:number,yMm:number}[][],boundingBox:*}|null)} resolveSvgPolygons
 * @returns {paper.Path|paper.CompoundPath}
 */
function materializeSvgImageItemFromLayer(layer, resolveSvgPolygons) {
  let item = null;

  if (layer.type === 'svg') {
    const resolved = resolveSvgPolygons(layer);
    const polygons = resolved && resolved.polygons;
    if (Array.isArray(polygons) && polygons.length > 0 && polygons.every((p) => p && p.length >= 3)) {
      function buildContourPath(polygon) {
        const path = new paper.Path();
        polygon.forEach((p, index) => {
          const point = new paper.Point(p.xMm, p.yMm);
          if (index === 0) path.moveTo(point);
          else path.lineTo(point);
        });
        path.closePath();
        return path;
      }
      if (polygons.length === 1) {
        item = buildContourPath(polygons[0]);
        item.strokeColor = STROKE_COLOR;
        item.strokeWidth = STROKE_WIDTH_PX / paper.view.zoom;
      } else {
        const compound = new paper.CompoundPath({
          strokeColor: STROKE_COLOR,
          strokeWidth: STROKE_WIDTH_PX / paper.view.zoom
        });
        for (const polygon of polygons) compound.addChild(buildContourPath(polygon));
        item = compound;
      }
    }
  }

  if (!item) {
    const w = Math.max(RESIZE_MIN_DIM_MM, layer.w);
    const h = Math.max(RESIZE_MIN_DIM_MM, layer.h);
    item = new paper.Path.Rectangle(new paper.Rectangle(layer.x, layer.y, w, h));
    item.strokeColor = STROKE_COLOR;
    item.strokeWidth = STROKE_WIDTH_PX / paper.view.zoom;
  }

  const rotationDeg = layer.rotationDeg || 0;
  const pivot = new paper.Point(layer.x + layer.w / 2, layer.y + layer.h / 2);
  if (rotationDeg) item.rotate(rotationDeg, pivot);
  item.data.rotationDeg = rotationDeg;
  item.data.pivotXMm = pivot.x;
  item.data.pivotYMm = pivot.y;
  return item;
}

/**
 * RS-3011 Step 1: `hooks` lets app.js own project state while this module stays the "all direct
 * Paper.js usage" facade its own header comment describes -- `getStoneDefaults()`/
 * `onShapeCommitted(layer)` mirror the old commit()'s `{stoneSize,gap,color}` argument and
 * project.layers.push() call site respectively, just invoked per-shape instead of per-batch.
 * `openHistorySession`/`closeHistorySession` are passed straight through to freehand's own
 * drag-start/drag-end (see onMouseDown/onMouseUp's 'freehand' branches) -- every other shape type
 * still gets a single commitHistory()-before-push via onShapeCommitted() alone.
 *
 * RS-3011 Step 1 write-through fix: a committed shape stays live in `board.shapes` for Design's own
 * select/move/resize/delete (unchanged from before this milestone), but those interactions used to
 * only ever mutate the local Paper.js item -- never the project.layers entry commitFinalizedShape()
 * already pushed at creation time, silently letting the two drift apart. `onShapeMoved`/
 * `onShapeResized`/`onShapeDeleted` close that gap: called once each, when a move/resize/delete
 * interaction on an already-committed shape finishes (see onMouseUp's 'move'/'resize' branches and
 * deleteSelected() below), keyed by the same `layer.id` commitFinalizedShape() now also stamps onto
 * `item.data.layerId` (alongside DrawingBoard's own pre-existing `item.data.shapeId`, a different,
 * board-local id -- see its own doc comment).
 * RS-3011 Step 2: `onSelectionChanged(layerIds)` fires whenever this file's own `selectedIds` set
 * is reassigned by a user gesture (plain click, shift-click, marquee release, empty-canvas clear)
 * -- never on programmatic resets (enter()/exit()/deleteSelected()), which are lifecycle, not a
 * selection the user made, and must not clobber whatever the app-level selection already is (e.g.
 * a Text layer selected before Design mode was entered). `layerIds` is every currently-selected
 * board.shapes item's `item.data.layerId` (the id commitFinalizedShape() stamped on, Step 1), in
 * `selectedIds`' own iteration order (last id = most recently interacted-with, matching every other
 * multi-select call site's own `ids[ids.length-1]` convention) -- any selected item without one
 * (shouldn't happen post-Step-1, but mirrors this file's existing null-layerId guards) is skipped,
 * never passed through as undefined.
 * @param {HTMLCanvasElement} canvasEl
 * @param {{getStoneDefaults?:()=>{stoneSize?:number,gap?:number,color?:string}, onShapeCommitted?:(layer:object)=>void, openHistorySession?:()=>void, closeHistorySession?:()=>void, onShapeMoved?:(layerId:string,dxMm:number,dyMm:number)=>void, onShapeResized?:(layerId:string,boundsMm:{left:number,top:number,width:number,height:number})=>void, onShapeRotated?:(layerId:string,rotationDeg:number)=>void, onShapeDeleted?:(layerId:string)=>(boolean|void), onSelectionChanged?:(layerIds:string[])=>void, onViewportChanged?:()=>void, onPaintStroke?:(lassoPolygons:{xMm:number,yMm:number}[][])=>void, onStampPlace?:(placement:{xMm:number,yMm:number,layerId:string|null})=>void, onTracePlace?:(placements:{xMm:number,yMm:number}[],layerId:string,droppedCount?:number)=>void, onEraseSweep?:(daubsAbsoluteMm:{xMm:number,yMm:number}[],layerId:string,corridorPolygonsAbsoluteMm:{xMm:number,yMm:number}[][],mode:('stones'|'outline'))=>void, resolveSelectionTarget?:(polygonAbsoluteMm:{xMm:number,yMm:number}[][])=>({layerId:string,contours:{xMm:number,yMm:number}[][]}|{precisionError:true}|null), hitTestRegion?:(pointAbsoluteMm:{xMm:number,yMm:number},marginMm:number)=>({layerId:string,regionId:string,polygon:{xMm:number,yMm:number}[]}|null), onActiveSelectionChanged?:()=>void, isPointInActiveSelection?:(pointAbsoluteMm:{xMm:number,yMm:number},selection:*)=>boolean, onStampRejected?:()=>void, onTraceRejected?:()=>void, onSelectionTargetPrecisionError?:()=>void}} [hooks] onShapeDeleted returning exactly `false` means the deletion was blocked (e.g. a last-layer guard) -- the shape stays in `board.shapes` too, everything else treats a non-`false` return as success. RS-3011 Step 10b: onPaintStroke(lassoPolygons) fires once a Paint lasso release produces a usable stroke (>= PAINT_MIN_LASSO_POINTS) -- lassoPolygons is exactly one closed ring, absolute project-mm, this module's own coordinate space (Paper.js project units already equal this app's millimeters, per this file's own header comment). Target selection, region creation, and every project.layers mutation happen entirely in app.js -- this hook is this module's only involvement in Paint beyond the pointer interaction and live preview. RS-3011 Step 12: onStampPlace(placement) fires once per Stamp click -- xMm/yMm is the click point, absolute project-mm, this module's own coordinate space; layerId is the project.layers id resolved via resolveStampTargetLayerId() (the SAME hitTestShapeId() Select's own click-to-pick-a-shape branch uses), or null if the click hit no shape. Passing the already-resolved layerId (rather than a bare point, unlike onPaintStroke) avoids a second, duplicate hit-test implementation living in app.js -- app.js still owns the absolute-to-natural-space coordinate conversion and every project.layers mutation, discarding silently when layerId is null, mirroring Paint's own "no target -> discard" precedent. RS-3011 Step 11: onTracePlace(placements, layerId) fires once per committed Trace drag that resolved a real target AND produced at least one spaced point -- placements is the full list of stones to place, absolute project-mm, this module's own coordinate space, already spaced by src/geometry/lineStampSpacing.js's placeStonesAlongPath(); layerId is always a real project.layers id here (never null -- a null/no-target resolution discards the whole drag silently before this hook is ever called, unlike onStampPlace's own "always call, layerId may be null" contract, since there is no per-point ghost-preview equivalent for Trace that would need the null case). app.js still owns the absolute-to-natural-space conversion and every project.layers mutation, mirroring onStampPlace's own architecture split, just plural. RS-3011 Step 13: onEraseSweep(daubsAbsoluteMm, layerId) fires once per committed Eraser click/drag sweep that resolved a real target -- daubsAbsoluteMm is every buffered point from the gesture (one for a plain click, one per TRACE_MIN_SAMPLE_DISTANCE_MM-thinned sample along a drag, same thinning as Trace's own placements), absolute project-mm, this module's own coordinate space, NOT yet spaced/filtered in any way (a daub is a raw brush touch, not a stone placement); layerId is always a real project.layers id here, same "never null" contract as onTracePlace's own (resolved via resolveEraserTargetLayerId() -- RS-3014 Step 5: per-point resolution against every buffered point in drag order, first real match wins, NOT Trace's own single-aggregate-bounding-box-center approach, since an edge-hugging Eraser drag's own aggregate center too easily sits outside the target shape even when the sweep itself clearly touches it; degenerates correctly to the click point itself for a single-point click). This module deliberately has no opinion on daub radius -- that's app.js's own eraserSettings.radiusMm (a tool setting, not read from any layer field), attached per point only once app.js owns the coordinate conversion, mirroring onTracePlace/onStampPlace's own architecture split. RS-3014 Step 3 (Dual-mode Eraser): corridorPolygonsAbsoluteMm is the SAME sweep's buffered points already turned into one or more closed, filled rings via buildEraserCorridorPolygons() (capsule-per-segment, unioned with Paper.js's own PathItem#unite()) -- absolute project-mm, this module's own coordinate space, same convention as daubsAbsoluteMm itself; only meaningful to Outline mode (app.js's own combineShapeSources() cut), a 'stones' gesture ignores it and keeps using daubsAbsoluteMm exactly as before. `mode` is this module's own eraserMode value (see setEraserMode()) captured at the START of this gesture (onMouseDown), NOT read live from app.js's eraserSettings.mode at the moment this hook fires -- a mode switch mid-drag must not retroactively change what an already-in-flight sweep does, so app.js must branch on the mode this parameter reports, never its own live eraserSettings.mode, when deciding how to apply a given sweep. RS-3013 Step 1: resolveSelectionTarget(polygonAbsoluteMm) is Select's rectangle-drag/Lasso's own drag calling app.js's shared resolvePaintTargetTwoPass() (the same selectPaintTarget() choreography onPaintStroke's own architecture already runs) to find which 'path' layer, if any, the drawn rectangle/lasso overlaps most -- returns {layerId, contours} or null, mirroring onPaintStroke's own "no target -> discard" contract; this module stores the result as an in-memory activeSelection draft, never a real region (that stays Paint's job alone). Bugfix: a third possible return shape, {precisionError:true} (app.js's own PAINT_TARGET_PRECISION_ERROR sentinel), fires when the stroke/rectangle DID overlap a candidate but selectPaintTarget()'s own boolean intersection couldn't be computed at a safe precision -- this module's own onMouseUp 'selectRect'/'lasso' branches duck-type on `.precisionError` and call the new onSelectionTargetPrecisionError() hook instead of treating it as either a real target or a genuine no-overlap null. hitTestRegion(pointAbsoluteMm, marginMm) is Select/Lasso's own click-to-select-an-existing-region hit-test -- app.js delegates to hitTestPathLayerRegion() (src/geometry/PaintRegionSelection.js) since a region lives in project.layers[].regions, data this module never touches directly; marginMm is already converted from screen-px by this module's own REGION_HIT_MARGIN_PX / paper.view.zoom. RS-3013 Step 2: onRegionMoved(layerId, regionId, dxMm, dyMm) fires once, at mouseup only, when a real (non-zero-offset) drag on a selected region's own footprint commits -- dxMm/dyMm is the drag's total offset, absolute project-mm; app.js translates the region's current polygon by that offset and writes it back through the SAME absolutePolygonsToNaturalSpace() (src/geometry/PaintRegionSelection.js) onPaintStroke's own region creation already uses. Returns the region's updated absolute-mm polygon on success (this module rebuilds activeSelectionItem's outline from that returned polygon, never from wherever the live per-frame preview translation left it, so the two can't drift), or null if the region/layer no longer exists. RS-3013 Step 5: onActiveSelectionChanged() fires with no arguments every time setActiveSelection() (the one place `activeSelection` is ever reassigned) settles on a new value -- a region click, a region losing selection, a draft rect/lasso selection, or a clear. Not fired during a live region-move drag's own per-frame preview (that path mutates activeSelectionItem directly via Paper.js translate(), bypassing setActiveSelection() entirely, per that function's own doc comment) -- app.js's Inspector-resync handler can treat every firing as a discrete, settled change worth reacting to. RS-3012 Step 1: isPointInActiveSelection(pointAbsoluteMm, selection) is Stamp/Trace's own selection-boundary test, called with the click/drag point (absolute project-mm, this module's own coordinate space) and this module's own live `activeSelection` value (passed through explicitly rather than re-read by app.js, since the caller -- this module -- already has it in scope); returns true (no constraint) for a null selection, and for a real one resolves EITHER a 'region' selection's current absolute polygon (project.layers[].regions data, resolved app.js-side the same way hitTestRegion/onRegionMoved above already do) OR a 'draft' selection's own boundsOrContour directly (already absolute-mm, no project.layers lookup needed) -- a hard interior test, no margin/tolerance, unlike hitTestRegion's own forgiving click-tolerance. onStampRejected() fires in place of onStampPlace when a Stamp click resolves outside the active selection's own boundary -- no history entry, no stone placed; app.js turns this into a status message. onTraceRejected() fires in place of onTracePlace when EVERY point of a committed Trace drag's own spaced placements list falls outside the active selection's own boundary (this module filters placements itself before calling onTracePlace, so a PARTIAL rejection instead reaches onTracePlace as a shorter placements list plus the new droppedCount 3rd argument above) -- no history entry, no stones placed; app.js turns this into a status message distinct from today's pre-existing, message-less "fewer than 2 buffered points" discard. Bugfix: onSelectionTargetPrecisionError() fires in place of resolveSelectionTarget()'s own normal result-handling in the 'selectRect'/'lasso' onMouseUp branches when that call returns the {precisionError:true} sentinel described above -- no draft selection created, no history entry; app.js turns this into a status message distinct from both onStampRejected/onTraceRejected's own and the existing "no target -> discard" case.
 */
export function createDrawingTool(canvasEl, hooks = {}) {
  const {
    getStoneDefaults = () => ({}),
    onShapeCommitted = () => {},
    openHistorySession = () => {},
    closeHistorySession = () => {},
    onShapeMoved = () => {},
    onShapeResized = () => {},
    // RS-3033: fires once, at mouseup only, when a rotate-handle drag on Design's own Select tool
    // completes with a non-zero net rotation -- see this function's own hooks-param doc comment
    // above for the exact contract. Mirrors onShapeMoved/onShapeResized's own one-hook-call-per-
    // completed-drag convention exactly.
    onShapeRotated = () => {},
    onShapeDeleted = () => {},
    onSelectionChanged = () => {},
    // RS-3026: fires every time applyViewport() runs (zoom change, pan, initial entry, resize) --
    // callers needing to react only to genuine zoom changes should compare pxPerMm themselves; this
    // hook does not distinguish pan-only calls from zoom changes.
    onViewportChanged = () => {},
    // RS-3011 Step 10b: fires once per finalized Paint lasso -- see this function's own hooks-param
    // doc comment above for the exact contract.
    onPaintStroke = () => {},
    // RS-3011 Step 12: fires once per Stamp click -- see this function's own hooks-param doc comment
    // above for the exact contract.
    onStampPlace = () => {},
    // RS-3011 Step 11: fires once per committed Trace drag with a resolved target -- see this
    // function's own hooks-param doc comment above for the exact contract.
    onTracePlace = () => {},
    // RS-3011 Step 13: fires once per committed Eraser click/drag sweep with a resolved target --
    // see this function's own hooks-param doc comment above for the exact contract.
    onEraseSweep = () => {},
    // RS-3013 Step 1: Select's rectangle-drag and Lasso's own drag both call this once per release,
    // with a single closed polygon ring (absolute project-mm, this module's own coordinate space --
    // the drawn rectangle's 4 corners, or the accumulated lasso points) -- returns
    // {layerId, contours} (contours: the same absolute-mm intersection shape onPaintStroke's own
    // `result.contours` already is) or null when nothing overlaps, mirroring onPaintStroke's own
    // "no target -> discard" contract exactly (this hook IS Paint's own selectPaintTarget()
    // resolution, reused, not a second implementation -- see app.js's own resolvePaintTargetTwoPass()).
    resolveSelectionTarget = () => null,
    // RS-3013 Step 1: Select/Lasso's own click-to-select-an-existing-region hit-test -- called with
    // an absolute-mm point and a tolerance already converted from screen-px by this module
    // (REGION_HIT_MARGIN_PX / paper.view.zoom), returns {layerId, regionId, polygon} (polygon:
    // absolute-mm, used to draw the selection outline) or null. project.layers regions are app.js's
    // own data, never touched directly here -- same architecture split as resolveSelectionTarget
    // above.
    hitTestRegion = () => null,
    // RS-3013 Step 2: fires once, at mouseup only, when a region-move drag commits -- see this
    // function's own hooks-param doc comment above for the exact contract.
    onRegionMoved = () => null,
    // RS-3012 Step 1: Stamp/Trace's own selection-boundary test -- called with an absolute-mm point
    // and this module's own live `activeSelection` value, returns true when unconstrained (default,
    // matches "no constraint" for a null selection). project.layers regions are app.js's own data,
    // never touched directly here -- same architecture split as hitTestRegion/resolveSelectionTarget
    // above.
    isPointInActiveSelection = () => true,
    // RS-3012 Step 1: fires in place of onStampPlace when a click resolves outside the active
    // selection's own boundary -- see this function's own hooks-param doc comment above for the
    // exact contract.
    onStampRejected = () => {},
    // RS-3012 Step 1: fires in place of onTracePlace when a committed Trace drag's every point falls
    // outside the active selection's own boundary -- see this function's own hooks-param doc comment
    // above for the exact contract.
    onTraceRejected = () => {},
    // Bugfix (BooleanPrecisionError at the gesture boundary): fires in place of the normal
    // resolveSelectionTarget()-result handling in the 'selectRect'/'lasso' onMouseUp branches below,
    // when that call's return value is the PAINT_TARGET_PRECISION_ERROR sentinel (a plain
    // `{precisionError:true}` object, app.js's own resolvePaintTargetTwoPass() -- recognized here by
    // duck-typing on `.precisionError`, not an import, since app.js owns that contract) instead of a
    // real `{layerId,contours}` target or null. No draft selection created, no history entry -- same
    // "no mutation happened" behavior as a genuine no-overlap result; app.js turns this into its own
    // status message, distinct from both that case and onStampRejected/onTraceRejected's own.
    onSelectionTargetPrecisionError = () => {},
    // RS-3013 Step 5: fires with no arguments every time setActiveSelection() reassigns
    // `activeSelection` (a region click, a region losing selection, a draft rect/lasso selection, or
    // a clear) -- app.js reads the new value back off this.activeSelection itself (the same read
    // syncSelectedControlsFromLayer()/writeSelectedControlsToLayer() use for their own region
    // branches) rather than receiving it as a parameter, so there is exactly one source of truth for
    // "what is currently selected" and this hook never risks going stale relative to it. NOT fired
    // during a live region-move drag's own per-frame preview (see setActiveSelection()'s own doc
    // comment: that path mutates activeSelectionItem directly via Paper.js translate(), bypassing
    // this function entirely, so this hook only ever fires on discrete, settled selection changes --
    // safe for app.js to treat as "resync the Inspector now" without any per-frame cost).
    onActiveSelectionChanged = () => {},
    // RS-3011 Step 3b: the two hooks the live stone preview needs -- getLayerStoneParams(layerId)
    // returns a 'path' layer's non-geometric stone settings (stoneSizeMm/gapMm/mode/color/mixed-size),
    // or null if no matching layer exists (every non-Design layer type, or Design not active); this
    // module still supplies the geometric half (contours/xMm/yMm/widthMm/heightMm) itself, re-
    // flattened from its own live Paper.js item, the same way commitFinalizedShape() already does.
    // generatePathLayout(params) runs those combined params through app.js's own permanentEngine --
    // the SAME single GeometryEngine instance every other stone-generation path in this app uses,
    // never a second one -- and returns plain {x,y,d,color} stones ready to paint.
    getLayerStoneParams = () => null,
    generatePathLayout = () => [],
    // RS-3032 Step A: app.js's own permanentEngine.resolveShapePolygons() call, for materializing a
    // SHAPE_LIBRARY_KINDS layer (Star/Ring/Heart/... -- see materializeShapeLibraryItemFromLayer()'s
    // own doc comment) as a real Paper.js item -- these layers have no stored `contours` of their
    // own, unlike 'path' layers, so this file needs a way to ask the permanent engine for their true
    // outline instead. Returns {polygons, boundingBox} (same shape resolveLayerShapeSource() already
    // gets back from the same engine call) or null.
    resolveShapeLibraryPolygons = () => null,
    // RS-3012 Step 2: the 'svg'-layer counterpart of resolveShapeLibraryPolygons above -- app.js's
    // own permanentEngine.resolveSvgPolygons() call, the SAME "get this SVG's fillable outline" hook
    // Boolean Operations already uses (see app.js's resolveLayerShapeSource()), for materializing an
    // 'svg' layer's real vector outline as a Paper.js item (see
    // materializeSvgImageItemFromLayer()'s own doc comment). Returns {polygons, boundingBox} or null.
    resolveSvgPolygons = () => null
  } = hooks;
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
  // RS-3011 Step 10b: Paint's own state -- mirrors polygonPoints' own shape (accumulated project-mm
  // paper.Points), but for a single click-drag-release gesture rather than polygon's multi-click
  // one: paintLassoPoints only ever holds the CURRENT stroke's points, reset to empty at every
  // mousedown and again once onMouseUp hands the finished stroke off to onPaintStroke().
  // paintLassoItem is the live dashed preview, built directly (never routed through
  // board.beginPath()/clearPath()/finalizeShape() -- same "never becomes a committable shape" rule
  // marqueeItem's own doc comment establishes), null whenever interactionKind !== 'paint'.
  let paintLassoPoints = [];
  let paintLassoItem = null;
  // RS-3011 Step 11: Trace's own state -- same shape/lifecycle as paintLassoPoints/paintLassoItem
  // just above (a single click-drag-release gesture, reset at mousedown and again once onMouseUp
  // hands the finished path off to onTracePlace()), and the same dashed-preview styling (see
  // onMouseDown's 'trace' branch, which reuses PAINT_LASSO_DASH_PX rather than a second constant).
  let tracePoints = [];
  let traceItem = null;
  // RS-3011 Step 13: Eraser's own state -- same shape/lifecycle as tracePoints/traceItem just
  // above (a single click-drag-release gesture, reset at mousedown and again once onMouseUp hands
  // the finished sweep off to onEraseSweep()). eraserRadiusMm is NOT reset per-gesture -- it's the
  // tool's current brush size, set from outside via setEraserRadiusMm() (app.js's own
  // eraserSettings.radiusMm), read live by both the ghost preview and the drag-sweep preview so
  // adjusting the brush (radius control / '[' / ']') is reflected immediately.
  let erasePoints = [];
  let eraseItem = null;
  let eraserRadiusMm = ERASER_DEFAULT_RADIUS_MM;
  // RS-3014 Step 3: Eraser's own mode ('stones' | 'outline'), same "set from outside, read live"
  // role as eraserRadiusMm just above -- app.js calls setEraserMode() whenever eraserSettings.mode
  // changes (session-first-entry seeding, the panel toggle). UNLIKE eraserRadiusMm though,
  // activeEraserMode below snapshots this at gesture-start (onMouseDown) rather than letting it
  // stay live through the gesture -- see onEraseSweep's own hooks-param doc comment for why a mode
  // switch mid-drag must not retroactively change an already-in-flight sweep.
  let eraserMode = 'stones';
  let activeEraserMode = 'stones';
  // RS-3014 Step 1: Stamp/Trace's own independent tool-level style, mirroring eraserRadiusMm's own
  // "set from outside, read live by the ghost/placement code" role -- app.js's stampSettings/
  // traceSettings, pushed in via setStampStyle()/setTraceStyle() below (session-first-entry seeding,
  // then the panel fields). Unlike eraserRadiusMm, getLayerStoneParams(layerId) is still called at
  // both the ghost-preview and placement sites -- not for its stoneSizeMm/color anymore, but as the
  // existence gate that a real stone-bearing target was hit (see updateStampGhostItem/onMouseUp's
  // own 'trace' branch below).
  let stampSizeMm = STAMP_DEFAULT_SIZE_MM;
  let stampColor = STAMP_DEFAULT_COLOR;
  let traceSizeMm = TRACE_DEFAULT_SIZE_MM;
  let traceGapMm = TRACE_DEFAULT_GAP_MM;
  let traceColor = TRACE_DEFAULT_COLOR;
  // RS-3011 Step 9: Pen's own state. Unlike polygonPoints above, Pen's anchors are NOT duplicated
  // into a parallel array -- board.path IS the real in-progress shape from the very first click
  // onward (Paper.js Segments already carry point/handleIn/handleOut natively), so these only track
  // the CURRENT drag's bookkeeping. penDraggingSegment is the paper.Segment being handle-shaped
  // this drag (null once mouse is up or while idle between clicks); penDragOrigin is that segment's
  // anchor point captured at mousedown (drag delta is measured from here, not from the previous
  // frame, so the handle always reflects total distance from the anchor); penDragForceCorner is
  // true when Alt/Option was held at the moment this anchor was placed (suppresses handle-pulling
  // for this drag regardless of distance -- an alternate one-step way to force a corner, alongside
  // clicking back on an already-placed anchor); penDragCrossedDeadZone latches true once this
  // drag's distance from penDragOrigin first exceeds PEN_DRAG_DEAD_ZONE_MM, so dragging back toward
  // the anchor mid-drag shrinks the handle back down instead of freezing it at its last-set value.
  // penPreviewItem is the throwaway "next segment" preview shown between clicks (mirrors
  // marqueeItem/resizeHandleItems' own "never routed through board.beginPath/clearPath/
  // finalizeShape" convention -- it previews a segment that doesn't exist yet).
  let penDraggingSegment = null;
  let penDragOrigin = null;
  let penDragForceCorner = false;
  let penDragCrossedDeadZone = false;
  // RS-3011 Step 9 revision: true when the current drag is closing the path onto the first anchor
  // -- shapes that anchor's handleIn only (the incoming curve for the closing segment), never its
  // handleOut (the outgoing curve for the ORIGINAL first segment, anchor 1->2, already set back
  // when it was first placed and must survive a later closing drag untouched).
  let penClosingDrag = false;
  let penPreviewItem = null;
  // RS-3011 Step 9 follow-up (anchor/handle chrome): a single throwaway Paper.js Group covering the
  // WHOLE in-progress path's anchor dots and, for every anchor whose handleIn/handleOut is already
  // set (not just the one currently being dragged), its tangent line(s) + tip dot(s). Same "never
  // routed through board.beginPath/clearPath/finalizeShape" rule as penPreviewItem/marqueeItem --
  // this is pure UI chrome layered on top of board.path's real segments, never mutated itself.
  // Rebuilt from scratch (rebuildPenHandleChromeItem) after every anchor placement/reset (onMouseDown)
  // and every drag frame that shapes a handle (onMouseDrag); removed in resetInProgressDrawing().
  let penHandleChromeItem = null;
  // RS-3011 Step 12: Stamp's own preview -- a single throwaway paper.Path.Circle at the current
  // stone size/color following the cursor at 50% opacity, mirroring penPreviewItem/marqueeItem's own
  // "never routed through board.beginPath/clearPath/finalizeShape" rule. Rebuilt from scratch every
  // onMouseMove frame while `mode === 'stamp'` (removeStampGhostItem() first); removed in
  // resetInProgressDrawing() so a mode switch/Escape/exit never leaves it stranded.
  let stampGhostItem = null;
  // RS-3011 Step 13: Eraser's own hover preview -- an outline-only circle at eraserRadiusMm
  // following the cursor, mirroring stampGhostItem's own lifecycle exactly (rebuilt from scratch
  // every onMouseMove frame while `mode === 'eraser'`, removed in resetInProgressDrawing()).
  let eraserGhostItem = null;
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
  // RS-3013 Step 1: Select's own twin of marqueeItem above -- the live rectangle preview for a
  // plain (no-Shift) empty-canvas drag, dashed rather than filled (STROKE_COLOR/PAINT_LASSO_DASH_PX,
  // matching Lasso's own dashed preview below) so it never reads as the marquee's own solid
  // multi-select box. Same "never routed through board.beginPath()/clearPath()/finalizeShape()"
  // rule; non-null only while interactionKind === 'selectRect'.
  let selectRectItem = null;
  // RS-3013 Step 1: Lasso's own twin of paintLassoPoints/paintLassoItem above -- identical shape and
  // lifecycle (a single click-drag-release gesture, reset at mousedown and again once onMouseUp
  // resolves it), but the finished stroke becomes a SELECTION (activeSelection below), never a real
  // region -- region creation stays Paint's own job alone.
  let lassoPoints = [];
  let lassoItem = null;
  // RS-3013 Step 1: the one selection state distinct from selectedIds above -- a region (resolved by
  // a click, via hitTestRegion) or an in-progress rect/lasso draft (resolved by a drag, via
  // resolveSelectionTarget), never both a shape multi-selection AND this at once (see
  // performClickDispatch()/setActiveSelection() below for how the two stay mutually exclusive).
  // null | {kind:'region', layerId, regionId} | {kind:'draft', layerId, shapeKind:('rect'|'lasso'),
  // boundsOrContour}. No operations read/act on this yet in this step -- later RS-3013 steps only.
  // activeSelectionItem is its own persistent outline overlay (SELECTED_STROKE_COLOR, solid, never
  // routed through board.beginPath()/clearPath()/finalizeShape()), rebuilt by setActiveSelection()
  // whenever activeSelection itself changes; null whenever activeSelection is null.
  let activeSelection = null;
  let activeSelectionItem = null;
  // RS-3010 Design Step D: the live resize handles for the current single-shape selection, a
  // small array of throwaway Paper.js Items (same "never routed through board.beginPath()/
  // clearPath()/finalizeShape()" rule marqueeItem already established, since these are UI chrome,
  // not shapes). Rebuilt from scratch by updateResizeHandles() below whenever selection or the
  // selected shape's geometry can change; empty whenever mode !== 'select' or more/fewer than one
  // shape is selected. resizeHandle/resizeShapeId/resizeStartBounds mirror app.js's own
  // `drag={kind:'resize',handle,layerId,b0,...}` shape, adapted to this file's discrete closure
  // variables -- non-null only while interactionKind === 'resize'. RS-3034: resizeStartBounds is
  // now the shape's LOCAL unrotated box (unrotatedLocalBoundsFor()), not necessarily its live
  // item.bounds -- byte-identical to before for an unrotated shape (unrotatedLocalBoundsFor()'s own
  // fast path). resizeRotationDeg0/resizeAnchorAbs/resizeHandleOffset mirror app.js's own
  // rotationDeg0/anchorAbs/handleOffset, snapshotted once at drag-start the same way; resizePivot is
  // this file's own addition, tracking the live item's current rotation pivot frame-to-frame during
  // an active rotated resize-drag (see onMouseDrag's 'resize' branch for why).
  let resizeHandleItems = [];
  let resizeHandle = null;
  let resizeShapeId = null;
  let resizeStartBounds = null;
  let resizeRotationDeg0 = 0;
  let resizeAnchorAbs = null;
  let resizeHandleOffset = null;
  let resizePivot = null;
  // RS-3033: the live rotate handle chrome (a dashed connecting line + a dot, mirroring app.js's own
  // drawRotateHandle() pair) -- rebuilt by updateRotateHandleItem() under the exact same
  // mode==='select'/single-selection gate resizeHandleItems above uses, called from inside
  // updateResizeHandles() itself (see that function's own comment) so the two chrome sets can never
  // drift out of sync. rotateShapeId/rotateCenter/rotateStartPointerAngleDeg/rotateStartRotationDeg/
  // rotateAppliedDeg mirror resizeHandle/resizeShapeId/resizeStartBounds's own role -- non-null only
  // while interactionKind === 'rotate'. rotateAppliedDeg tracks the TOTAL angle already applied to
  // the live Paper.js item via item.rotate() so far this drag (that method takes an INCREMENTAL
  // angle, not an absolute one -- see onMouseDrag's own 'rotate' branch for why this is needed).
  let rotateHandleItems = [];
  let rotateShapeId = null;
  let rotateCenter = null;
  let rotateStartPointerAngleDeg = 0;
  let rotateStartRotationDeg = 0;
  let rotateAppliedDeg = 0;
  // RS-3010 Step 2e: move's own grid-snap state -- event.delta (used by the translate() loop below)
  // is incremental per-frame, too small to snap against a 5mm grid directly. Instead this tracks an
  // absolute anchor (the specific shape clicked, moveAnchorShapeId) from its pre-drag bounds
  // (moveAnchorStartBounds) and total raw offset since move-start (moveStartPoint), so each frame
  // can snap the anchor's total offset and derive just the incremental delta still owed
  // (moveAppliedOffset) -- see onMouseDrag's 'move' branch below.
  let moveStartPoint = null;
  let moveAnchorShapeId = null;
  let moveAnchorStartBounds = null;
  let moveAppliedOffset = null;
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
    // rs-design-crystal-dots: a zoom that crossed into a new sqrt(2) bucket means every existing
    // stone sprite/symbol definition was baked at a resolution far enough from the new on-screen
    // size to be worth re-baking -- clear both caches and rebuild every shape's stone Group so the
    // next per-stone sprite lookup rebuilds at the new resolution instead of reusing a stale one.
    const zoomBucket = stoneSpriteZoomBucketFor(paper.view.zoom);
    if (zoomBucket !== stoneSpriteZoomBucket) {
      stoneSpriteZoomBucket = zoomBucket;
      clearStoneSpriteCache();
      stoneSymbolDefs.clear();
      rebuildAllStoneGroups();
    }
    onViewportChanged();
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

  /**
   * @returns {string|null} The shapeId of the finalized shape under `point`, or null.
   *
   * RS-3011 hotfix: real geometric containment against each shape's own item, topmost-first
   * (board.listShapes() is push-ordered oldest-first -- see DrawingBoard's own `this.shapes.push()`
   * -- and every shape's own outline item is inserted directly into the active layer at creation
   * time with no z-reordering among shapes afterward, other than rebuildStoneGroupForShape()'s
   * `group.insertBelow(shape.item)`, which only ever repositions a shape's OWN stone group relative
   * to that SAME shape's item, never one shape's item relative to another's -- so push order IS
   * paint order bottom-to-top, and iterating in reverse visits the topmost shape first). This
   * replaces the old paper.project.hitTest({fill:true,stroke:true,...}) approach, which could only
   * ever match a shape's OWN outline stroke: this app's drawn shapes carry strokeColor but never
   * fillColor (see STROKE_COLOR/materializeShapeFromLayer), so the fill-test never matched, leaving
   * only a ~4px-of-the-actual-edge stroke-test window -- a click anywhere in a shape's true
   * interior, including directly on one of its own rendered stone dots (real rendered items --
   * originally paper.Path.Circle with genuine fillColor, now paper.SymbolItem sprites per
   * rs-design-crystal-dots -- but siblings of the shape's own item tagged data.isStoneDot/
   * data.isStoneGroup, never data.shapeId, so the old parent-walk could never resolve one back to a
   * shape id), resolved no target at all.
   *
   * `shape.item.contains(point)` is a true point-in-fill-area test (Paper.js's own Path/
   * CompoundPath#_contains is pure winding-number geometry -- confirmed directly against
   * paper-full.js -- independent of whether fillColor is actually set), so it works unchanged for
   * both a single hand-drawn paper.Path and a multi-contour paper.CompoundPath (Step 8 SVG import,
   * `evenodd`/winding-rule holes included) with no special-casing. The stroke-proximity fallback
   * (paper.project.hitTest, stroke-only, same `4 / paper.view.zoom` tolerance as before) covers a
   * click exactly on an edge that .contains() alone could miss/mis-hit around a hairline-thin
   * shape, and still walks up to `.data.shapeId` for the same CompoundPath-child reason the old
   * code did (see that hit's own Step 8 Phase B precedent, preserved here unchanged).
   */
  function hitTestShapeId(point) {
    const shapes = board.listShapes();
    for (let i = shapes.length - 1; i >= 0; i--) {
      if (shapes[i].item.contains(point)) return shapes[i].id;
    }
    const hit = paper.project.hitTest(point, {
      stroke: true,
      tolerance: 4 / paper.view.zoom,
      class: paper.Path
    });
    if (!hit) return null;
    let item = hit.item;
    while (item && !item.data.shapeId) item = item.parent;
    return (item && item.data.shapeId) || null;
  }

  /**
   * RS-3011 Part B: the project.layers id of whichever finalized shape's BOUNDING BOX (not fill
   * containment) `point` falls inside, topmost-first, or null -- the target-resolution hit-test for
   * Stamp/Trace/Eraser (resolveStampTargetLayerId/resolveTraceTargetLayerId below), deliberately
   * SEPARATE from hitTestShapeId() above. hitTestShapeId()'s strict fill-containment is the right
   * test for Select's own click-to-pick (a click in genuinely empty space between two shapes must
   * select neither) -- but Stamp/Trace/Eraser's job is different: deciding which existing layer a
   * manually-placed mark should belong to, for move/resize/export tracking. A shape can have a
   * genuinely hollow/empty interior (e.g. an imported SVG with an open center) where a user still
   * reasonably wants to place a stamp that tracks that shape -- strict fill-containment would block
   * that outright. `shape.item.bounds.contains(point)` is Paper.js's own axis-aligned
   * Rectangle#contains, a plain bounding-box test. Same topmost-first iteration order/reasoning as
   * hitTestShapeId()'s own hotfix (board.listShapes() is push-ordered oldest-first; reverse-
   * iterating visits the topmost shape first -- see that function's own doc comment).
   * @param {paper.Point} point
   * @returns {string|null}
   */
  function resolveTargetLayerIdByBounds(point) {
    const shapes = board.listShapes();
    for (let i = shapes.length - 1; i >= 0; i--) {
      if (shapes[i].item.bounds.contains(point)) return shapes[i].item.data.layerId || null;
    }
    return null;
  }

  /**
   * RS-3011 Step 12: the project.layers id of whichever finalized shape `point` resolves against,
   * or null -- shared by the Stamp ghost preview (updateStampGhostItem), the Eraser ghost preview
   * (updateEraserGhostItem), and the actual placement (onMouseDown's own 'stamp' branch) so all
   * three agree on exactly the same target for the exact same point. RS-3011 Part B: delegates to
   * resolveTargetLayerIdByBounds() above (bounding-box containment) rather than hitTestShapeId()
   * (strict fill containment) -- see that function's own doc comment for why target resolution
   * needs the looser test.
   * @param {paper.Point} point
   * @returns {string|null}
   */
  function resolveStampTargetLayerId(point) {
    return resolveTargetLayerIdByBounds(point);
  }

  /**
   * RS-3011 Step 11: the project.layers id of whichever finalized shape a just-drawn Trace path's
   * own bounding-box CENTER resolves against, or null -- resolved at release (not drag-start),
   * mirroring drawleather's own LineStampTool.ts approach (build a temp path from the buffered
   * points, hit-test its bounds.center, discard the temp path). Reuses resolveStampTargetLayerId()
   * above (itself built on resolveTargetLayerIdByBounds() -- RS-3011 Part B) rather than a second
   * hit-test implementation, same precedent Step 12's own resolveStampTargetLayerId() established.
   * @param {paper.Point[]} points buffered project-mm points from the current Trace drag.
   * @returns {string|null}
   */
  function resolveTraceTargetLayerId(points) {
    const tempPath = new paper.Path({ segments: points });
    const layerId = resolveStampTargetLayerId(tempPath.bounds.center);
    tempPath.remove();
    return layerId;
  }

  /**
   * RS-3014 Step 5: the project.layers id of whichever finalized shape ANY point of the just-swept
   * Eraser drag resolves against (first match wins, in drag order), or null -- deliberately NOT
   * resolveTraceTargetLayerId() above. Trace's aggregate-bounding-box-center approach is correct for
   * its own use case (a line usually drawn well inside its target shape), but Eraser's primary use
   * case is erasing ALONG an edge -- a drag that hugs a boundary very often has its own aggregate
   * bounds.center sitting right on, or just outside, that boundary, even though the sweep clearly
   * touches the shape. When that single center point misses, onMouseUp's own `if (!layerId ...)
   * return;` guard silently discards the WHOLE gesture -- no cut, no stone removal, no error. Do NOT
   * "simplify" this back to reusing resolveTraceTargetLayerId() -- per-point resolution is the fix,
   * not an equivalent shortcut. Reuses resolveTargetLayerIdByBounds() (already shared by
   * Stamp/Trace) rather than a new hit-test implementation, just called per-point instead of once on
   * an aggregate center; same topmost-first, first-real-match-wins precedent as hitTestShapeId().
   * @param {paper.Point[]} points buffered project-mm points from the current Eraser drag.
   * @returns {string|null}
   */
  function resolveEraserTargetLayerId(points) {
    for (const point of points) {
      const layerId = resolveTargetLayerIdByBounds(point);
      if (layerId) return layerId;
    }
    return null;
  }

  /**
   * Whether `point` lands on the rotate handle for the single currently-selected shape -- same
   * single-selection-only gate/radial-distance pattern as hitTestResizeHandle() just below, checked
   * FIRST in onMouseDown (before both hitTestResizeHandle() and the plain shape hit-test), mirroring
   * app.js's own rotateHandleHitTest()-checked-first ordering in its hitTest(), so a rotate-drag is
   * never misinterpreted as a resize or move.
   * @param {paper.Point} point
   * @returns {boolean}
   */
  function hitTestRotateHandle(point) {
    if (mode !== 'select' || selectedIds.size !== 1) return false;
    const shape = board.getShape([...selectedIds][0]);
    if (!shape) return false;
    const tolerance = ROTATE_HANDLE_HIT_TOLERANCE_PX / paper.view.zoom;
    const { point: handlePoint } = rotateHandlePositionFor(shape.item.bounds);
    return point.getDistance(handlePoint) <= tolerance;
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
    const hit = rotatedHandlePositionsFor(shape.item).find((h) => point.getDistance(h.point) <= tolerance);
    return hit ? hit.name : null;
  }

  /**
   * RS-3010 Step 2f: the closest segment point, among every OTHER finalized shape in
   * `board.listShapes()`, within tolerance of `point` -- or null if none qualifies. `excludeShapeId`
   * lets move/resize skip the shape actually being dragged (it should never snap to its own
   * points); pass null when there's no such shape (drawing a brand-new rect/ellipse/slot, placing
   * a polygon vertex). Tolerance matches hitTestShapeId/hitTestResizeHandle's own
   * `4 / paper.view.zoom` screen-px-to-project-mm convention. Accepts anything shaped `{x,y}`, not
   * just a paper.Point -- move's rawAnchorPos is a plain object, not a live Paper.js point.
   * @param {{x:number,y:number}} point
   * @param {string|null} excludeShapeId
   * @returns {{x:number,y:number}|null}
   */
  function findNearestVertexSnap(point, excludeShapeId) {
    const tolerance = 4 / paper.view.zoom;
    let nearest = null;
    let nearestDistance = tolerance;
    for (const shape of board.listShapes()) {
      if (shape.id === excludeShapeId || !shape.item.segments) continue;
      for (const segment of shape.item.segments) {
        const distance = Math.hypot(segment.point.x - point.x, segment.point.y - point.y);
        if (distance <= nearestDistance) {
          nearestDistance = distance;
          nearest = { x: segment.point.x, y: segment.point.y };
        }
      }
    }
    return nearest;
  }

  /**
   * RS-3010 Step 2f: the single composed point-snap every one of Step 2e's bare `snapToGrid(...)`
   * call sites now goes through -- vertex-snap (other shapes' points) takes priority over grid-snap
   * whenever a candidate is within tolerance, falling back to Step 2e's existing grid-snap
   * unchanged otherwise. See findNearestVertexSnap's own doc comment for `excludeShapeId`.
   * @param {{x:number,y:number}} point
   * @param {string|null} excludeShapeId
   * @returns {{x:number,y:number}}
   */
  function resolveSnappedPoint(point, excludeShapeId) {
    return findNearestVertexSnap(point, excludeShapeId) || snapToGrid(point, GRID_MINOR_INTERVAL_MM);
  }

  /**
   * RS-3010 Step 2f correction: resolves an already angle-snapped point WITHOUT falling back to
   * grid-snap. Grid-snap rounds x and y independently to the nearest GRID_MINOR_INTERVAL_MM, which
   * does not preserve an arbitrary angle -- confirmed via live instrumentation: a point angle-
   * snapped to exactly 15deg measured 17.1deg after the original (buggy) constrain-then-
   * resolveSnappedPoint order ran grid-snap on top of it. Vertex-snap still applies here (its
   * targets are sparse/specific, not a dense always-on rounding grid, so it only perturbs the angle
   * when a real nearby vertex justifies it -- an accepted trade-off); when no vertex candidate is
   * within tolerance, `angleSnappedPoint` is returned exactly as-is, preserving the exact
   * constrained angle.
   * @param {{x:number,y:number}} angleSnappedPoint
   * @param {string|null} excludeShapeId
   * @returns {{x:number,y:number}}
   */
  function resolveAngleSnappedPoint(angleSnappedPoint, excludeShapeId) {
    return findNearestVertexSnap(angleSnappedPoint, excludeShapeId) || angleSnappedPoint;
  }

  /**
   * RS-3010 Step 2f: resolves a candidate polygon vertex position from the last-placed vertex
   * (`polygonPoints[polygonPoints.length - 1]`) -- shared by the vertex-placement branch
   * (onMouseDown) and the hover-preview branch (onMouseMove) so the two can never disagree for the
   * same cursor position and Shift state. Only ever called once polygonPoints has at least one
   * point (the pending edge's anchor). Step 2f correction: when Shift is held, angle-snap runs
   * first and the result resolves through vertex-snap-or-as-is (resolveAngleSnappedPoint), NOT
   * vertex-else-grid -- grid-snap would corrupt the constrained angle (see that function's own
   * doc comment). Without Shift, behavior is unchanged: plain vertex-else-grid.
   * @param {paper.Point} rawPoint
   * @param {boolean} shiftHeld
   * @returns {{x:number,y:number}}
   */
  function resolvePolygonVertexPoint(rawPoint, shiftHeld) {
    const from = polygonPoints[polygonPoints.length - 1];
    if (shiftHeld) {
      return resolveAngleSnappedPoint(snapAngle(from, rawPoint, ROTATION_SNAP_STEP_DEG), null);
    }
    return resolveSnappedPoint(rawPoint, null);
  }

  /** Repaints every finalized shape's strokeColor to reflect the current selection. */
  function applySelectionVisuals() {
    for (const shape of board.listShapes()) {
      shape.item.strokeColor = selectedIds.has(shape.id) ? SELECTED_STROKE_COLOR : STROKE_COLOR;
    }
  }

  /**
   * RS-3011 Step 2: notifies `onSelectionChanged` with every currently-selected shape's
   * `item.data.layerId` (skipping any without one). Called at every user-gesture site that
   * reassigns `selectedIds` -- see this function's own hooks-param doc comment above for which
   * sites those are and which are deliberately excluded.
   */
  function notifySelectionChanged() {
    const layerIds = [];
    for (const id of selectedIds) {
      const shape = board.getShape(id);
      const layerId = shape && shape.item.data.layerId;
      if (layerId) layerIds.push(layerId);
    }
    onSelectionChanged(layerIds);
  }

  /**
   * RS-3013 Step 1: builds activeSelectionItem's own Paper.js outline from a set of absolute-mm
   * polygon rings -- a paper.CompoundPath so a multi-contour Lasso draft (a stroke that clipped into
   * several disjoint pieces, same possibility onPaintStroke's own region creation already handles)
   * renders as one item, same "solid SELECTED_STROKE_COLOR outline" visual a selected shape's own
   * strokeColor already uses (applySelectionVisuals()), so a region/draft selection reads as
   * unambiguously "selected" using this file's existing color language rather than inventing a new
   * one. Outline-only (no fillColor) -- this is UI chrome, never a shape a hit-test could match.
   * @param {{xMm:number,yMm:number}[][]} polygons
   * @returns {paper.CompoundPath}
   */
  function buildActiveSelectionOutlineItem(polygons) {
    const compound = new paper.CompoundPath({
      children: polygons.map(
        (ring) => new paper.Path({ segments: ring.map((p) => new paper.Point(p.xMm, p.yMm)), closed: true })
      )
    });
    compound.strokeColor = SELECTED_STROKE_COLOR;
    compound.strokeWidth = STROKE_WIDTH_PX / paper.view.zoom;
    compound.fillColor = null;
    return compound;
  }

  /**
   * RS-3013 Step 1: the one place `activeSelection` is ever reassigned -- always rebuilds
   * activeSelectionItem to match (removing the old one first), so the two can never drift apart.
   * `polygons` is only read when `selection` is non-null (the outline to draw); pass null/omit to
   * clear. Never touches selectedIds/onSelectionChanged itself -- callers that need the two selection
   * modes kept mutually exclusive (see performClickDispatch() below) clear the other one alongside
   * this, at the call site, same as this file's existing applySelectionVisuals()/notifySelectionChanged()
   * pairing never being fused into one function either.
   * @param {null|{kind:'region',layerId:string,regionId:string}|{kind:'draft',layerId:string,shapeKind:('rect'|'lasso'),boundsOrContour:*}} selection
   * @param {{xMm:number,yMm:number}[][]} [polygons]
   */
  function setActiveSelection(selection, polygons) {
    if (activeSelectionItem) {
      activeSelectionItem.remove();
      activeSelectionItem = null;
    }
    activeSelection = selection;
    if (selection && polygons && polygons.length) {
      activeSelectionItem = buildActiveSelectionOutlineItem(polygons);
    }
    onActiveSelectionChanged();
  }

  /**
   * RS-3013 Step 1: the ONE click-decision function both Select and Lasso resolve a plain click
   * (not a drag) through, so the two tools are guaranteed to agree on exactly what a click selects
   * (per this step's own decision: "Lasso and Select must have IDENTICAL click behavior"). Tries, in
   * order: (1) an existing region under `point` (hitTestRegion, forgiving margin) -- selects it as
   * activeSelection and clears any shape multi-selection; (2) an existing shape under `point`
   * (hitTestShapeId, same test Select's own pre-existing click-to-pick-a-shape branch already used)
   * -- shiftHeld toggles it into/out of the multi-selection, otherwise selects it alone unless it's
   * already part of the current multi-selection (preserving the group, same precedent the old inline
   * code documented), and clears any region/draft selection; (3) neither -- empty canvas, clears
   * both. Never touches interactionKind -- purely a selection-state decision, called both from a
   * context where no drag will follow (Lasso's own too-short-to-be-a-stroke release, Select's own
   * Shift-click) and from one where mousedown already speculatively selected a shape for a possible
   * group-drag that turned out to be a zero-offset click instead (Select's own onMouseUp 'move'
   * branch) -- see that branch's own comment for why re-running this there is safe (idempotent for
   * the shape it already picked, and is what lets a region under that same click override it).
   * @param {paper.Point} point
   * @param {boolean} shiftHeld
   */
  function performClickDispatch(point, shiftHeld) {
    const regionHit = hitTestRegion({ xMm: point.x, yMm: point.y }, REGION_HIT_MARGIN_PX / paper.view.zoom);
    if (regionHit) {
      if (selectedIds.size) {
        selectedIds = clearSelection();
        applySelectionVisuals();
        updateResizeHandles();
        notifySelectionChanged();
      }
      setActiveSelection({ kind: 'region', layerId: regionHit.layerId, regionId: regionHit.regionId }, [regionHit.polygon]);
      return;
    }
    const hitId = hitTestShapeId(point);
    if (hitId) {
      if (activeSelection) setActiveSelection(null);
      if (shiftHeld) {
        selectedIds = toggleSelection(selectedIds, hitId);
      } else if (!selectedIds.has(hitId)) {
        selectedIds = selectOnly(hitId);
      }
      applySelectionVisuals();
      updateResizeHandles();
      notifySelectionChanged();
      return;
    }
    if (selectedIds.size) {
      selectedIds = clearSelection();
      applySelectionVisuals();
      updateResizeHandles();
    }
    if (activeSelection) setActiveSelection(null);
    notifySelectionChanged();
  }

  /**
   * Rebuilds `rotateHandleItems` from scratch: removes whatever chrome currently exists, then --
   * only if `mode === 'select'` and exactly one shape is selected -- adds a dashed connecting line
   * plus a dot at the shape's current rotateHandlePositionFor() position, mirroring app.js's own
   * drawRotateHandle() pair exactly. Self-contained (clears, gates, and rebuilds independently) so
   * it is safe to call unconditionally from updateResizeHandles() below regardless of that
   * function's own early returns -- see that function's own comment for why the two are linked.
   */
  function updateRotateHandleItem() {
    for (const item of rotateHandleItems) item.remove();
    rotateHandleItems = [];
    if (mode !== 'select' || selectedIds.size !== 1) return;
    const shape = board.getShape([...selectedIds][0]);
    if (!shape) return;
    const { point, anchor } = rotateHandlePositionFor(shape.item.bounds);
    const line = new paper.Path.Line(anchor, point);
    line.strokeColor = ROTATE_HANDLE_LINE_COLOR;
    line.strokeWidth = ROTATE_HANDLE_LINE_WIDTH_PX / paper.view.zoom;
    line.dashArray = [3 / paper.view.zoom, 3 / paper.view.zoom];
    const dot = new paper.Path.Circle(point, ROTATE_HANDLE_RADIUS_PX / paper.view.zoom);
    dot.fillColor = RESIZE_HANDLE_FILL_COLOR;
    dot.strokeColor = RESIZE_HANDLE_STROKE_COLOR;
    dot.strokeWidth = RESIZE_HANDLE_STROKE_WIDTH_PX / paper.view.zoom;
    rotateHandleItems = [line, dot];
  }

  /**
   * Rebuilds `resizeHandleItems` from scratch: removes whatever handle Items currently exist,
   * then -- only if `mode === 'select'` and exactly one shape is selected -- adds 8 small square
   * Path.Rectangle Items at that shape's current TRUE rotated corners/edge-midpoints
   * (rotatedHandlePositionsFor(), RS-3034 -- byte-identical to the plain handlePositionsFor(bounds)
   * this used before that milestone for every unrotated shape). Called wherever selection or the
   * selected shape's geometry can change.
   *
   * RS-3033: also rebuilds the rotate handle (updateRotateHandleItem()) on every call, rather than
   * duplicating a second call at each of this function's own ~20 call sites -- the two chrome sets
   * (resize handles, rotate handle) must always be shown/hidden/repositioned together (identical
   * mode==='select'/single-selection gate, identical "selection or the selected shape's geometry
   * changed" trigger), so folding the rotate rebuild in here is the only way to guarantee they can
   * never drift out of sync one call site at a time.
   */
  function updateResizeHandles() {
    updateRotateHandleItem();
    for (const item of resizeHandleItems) item.remove();
    resizeHandleItems = [];
    if (mode !== 'select' || selectedIds.size !== 1) return;
    const shape = board.getShape([...selectedIds][0]);
    if (!shape) return;
    const sizeMm = RESIZE_HANDLE_SIZE_PX / paper.view.zoom;
    for (const { point } of rotatedHandlePositionsFor(shape.item)) {
      const rect = new paper.Rectangle(point.x - sizeMm / 2, point.y - sizeMm / 2, sizeMm, sizeMm);
      const handleItem = new paper.Path.Rectangle(rect);
      handleItem.fillColor = RESIZE_HANDLE_FILL_COLOR;
      handleItem.strokeColor = RESIZE_HANDLE_STROKE_COLOR;
      handleItem.strokeWidth = RESIZE_HANDLE_STROKE_WIDTH_PX / paper.view.zoom;
      resizeHandleItems.push(handleItem);
    }
  }

  /** RS-3011 Step 12: removes/nulls the throwaway Stamp ghost preview circle, if any. */
  function removeStampGhostItem() {
    if (stampGhostItem) {
      stampGhostItem.remove();
      stampGhostItem = null;
    }
  }

  /**
   * RS-3011 Step 12: rebuilds the Stamp ghost preview at `point` -- resolves `point` against every
   * finalized shape (resolveStampTargetLayerId() -- RS-3011 Part B: bounding-box containment, same
   * resolution an actual Stamp click would use), and, only when it lands on a 'path' layer's shape,
   * shows a 50%-opacity circle. RS-3014 Step 1: the circle's radius/fillColor now come from Stamp's
   * OWN independent stampSizeMm/stampColor (set via setStampStyle()) rather than the target layer's
   * current stoneSize/color -- getLayerStoneParams(layerId) is kept purely as the existence gate (a
   * real stone-bearing 'path' layer was hit), matching what an actual Stamp click would place. No
   * target (empty canvas, or a non-'path' layer, or getLayerStoneParams returns null) means no ghost
   * at all -- mirrors this tool's own "no target -> discard" precedent for the actual placement.
   * @param {paper.Point} point
   */
  function updateStampGhostItem(point) {
    removeStampGhostItem();
    const layerId = resolveStampTargetLayerId(point);
    const styleParams = layerId ? getLayerStoneParams(layerId) : null;
    if (!styleParams) return;
    stampGhostItem = new paper.Path.Circle({
      center: point,
      radius: stampSizeMm / 2,
      fillColor: stampColor
    });
    stampGhostItem.opacity = 0.5;
    stampGhostItem.data.isStampGhost = true;
  }

  /** RS-3011 Step 13: removes/nulls the throwaway Eraser ghost preview circle, if any. */
  function removeEraserGhostItem() {
    if (eraserGhostItem) {
      eraserGhostItem.remove();
      eraserGhostItem = null;
    }
  }

  /**
   * RS-3011 Step 13: rebuilds the Eraser ghost preview at `point` -- resolves `point` against
   * every finalized shape (resolveStampTargetLayerId(), same bounding-box resolution -- RS-3011
   * Part B -- Stamp's own ghost above uses), showing an outline-only circle at the CURRENT
   * eraserRadiusMm only when it lands on a real shape. Unlike Stamp's own ghost, the circle's
   * radius/style never depend on the target
   * layer's fields (decision 4: brush radius is a tool setting, not a stone property) -- only
   * whether a target exists at all decides visibility, mirroring Stamp's own "no target -> no
   * ghost" precedent.
   * @param {paper.Point} point
   */
  function updateEraserGhostItem(point) {
    removeEraserGhostItem();
    const layerId = resolveStampTargetLayerId(point);
    if (!layerId) return;
    eraserGhostItem = new paper.Path.Circle({
      center: point,
      radius: eraserRadiusMm,
      strokeColor: ERASER_STROKE_COLOR,
      strokeWidth: STROKE_WIDTH_PX / paper.view.zoom
    });
    eraserGhostItem.data.isEraserGhost = true;
  }

  /** RS-3011 Step 9: removes/nulls the throwaway "next segment" pen preview, if any. */
  function removePenPreviewItem() {
    if (penPreviewItem) {
      penPreviewItem.remove();
      penPreviewItem = null;
    }
  }

  /** RS-3011 Step 9 follow-up: removes/nulls the anchor/handle chrome Group, if any. */
  function removePenHandleChromeItem() {
    if (penHandleChromeItem) {
      penHandleChromeItem.remove();
      penHandleChromeItem = null;
    }
  }

  /**
   * RS-3011 Step 9 follow-up: rebuilds the anchor/handle chrome Group from board.path's current
   * segments -- a small filled dot at every placed anchor, plus (for any anchor whose handleIn/
   * handleOut is non-zero) a trimmed tangent line and a hollow tip dot for that handle. Discard-and-
   * recreate, same pattern rect/ellipse/slot/marquee's own drag previews already use.
   *
   * Three-phase render (mirrors drawleather Scene.ts's buildConstructionHandlesFromPath): tangent
   * lines first, then anchor dots, then tip dots last -- tips on top so a short tangent's endpoint
   * stays visible even when it lands inside the anchor's own dot. Simplified from that precedent:
   * no lock-mode coloring, no attached-line square/circle distinction -- Pen has neither concept,
   * so every anchor is the same filled circle and every tip is the same hollow circle.
   *
   * No-op (chrome cleared) if there's no in-progress Pen path -- callers don't need to guard.
   */
  function rebuildPenHandleChromeItem() {
    removePenHandleChromeItem();
    if (!board.path) return;
    const segments = board.path.segments;
    const anchorRadiusMm = PEN_ANCHOR_DOT_RADIUS_PX / paper.view.zoom;
    const tipRadiusMm = PEN_HANDLE_TIP_RADIUS_PX / paper.view.zoom;
    const anchorTrimMm = PEN_ANCHOR_TRIM_PX / paper.view.zoom;
    const tipTrimMm = PEN_TIP_TRIM_PX / paper.view.zoom;
    const lineWidthMm = PEN_HANDLE_LINE_WIDTH_PX / paper.view.zoom;
    const group = new paper.Group();
    group.data.isPenHandleChrome = true;

    function appendTangentLine(anchorPoint, handlePoint) {
      // Trim so the visible stroke starts at the anchor dot's edge and ends at the tip dot's edge
      // rather than passing through either center -- falls back to the untrimmed segment when the
      // handle is shorter than the combined trim, where trimming would otherwise reverse the line.
      const direction = handlePoint.subtract(anchorPoint);
      const distance = direction.length;
      let lineStart = anchorPoint;
      let lineEnd = handlePoint;
      if (distance > anchorTrimMm + tipTrimMm) {
        const unit = direction.divide(distance);
        lineStart = anchorPoint.add(unit.multiply(anchorTrimMm));
        lineEnd = handlePoint.subtract(unit.multiply(tipTrimMm));
      }
      const line = new paper.Path({ segments: [lineStart, lineEnd] });
      line.strokeColor = new paper.Color(STROKE_COLOR);
      line.strokeColor.alpha = 0.6;
      line.strokeWidth = lineWidthMm;
      group.addChild(line);
    }

    function appendTipDot(point) {
      const dot = new paper.Path.Circle(point, tipRadiusMm);
      dot.fillColor = null;
      dot.strokeColor = STROKE_COLOR;
      dot.strokeWidth = lineWidthMm;
      group.addChild(dot);
    }

    // Phase 1: tangent lines (bottom).
    for (const seg of segments) {
      if (!seg.handleIn.isZero()) appendTangentLine(seg.point, seg.point.add(seg.handleIn));
      if (!seg.handleOut.isZero()) appendTangentLine(seg.point, seg.point.add(seg.handleOut));
    }
    // Phase 2: anchor dots (middle) -- visible immediately on placement, including the very first
    // anchor with no second point yet, since this Group renders independently of board.path itself.
    for (const seg of segments) {
      const dot = new paper.Path.Circle(seg.point, anchorRadiusMm);
      dot.fillColor = STROKE_COLOR;
      dot.strokeColor = null;
      group.addChild(dot);
    }
    // Phase 3: tip dots (top) -- see appendTipDot's hollow styling, drawn last so a short tangent's
    // endpoint stays visible even inside the anchor dot's own radius.
    for (const seg of segments) {
      if (!seg.handleIn.isZero()) appendTipDot(seg.point.add(seg.handleIn));
      if (!seg.handleOut.isZero()) appendTipDot(seg.point.add(seg.handleOut));
    }
    penHandleChromeItem = group;
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
    // RS-3013 Step 1: mirrors marqueeItem's own reset just above -- a Select rectangle-drag
    // interrupted mid-drag (Escape/mode-switch/exit) must not leave a stale dashed preview behind.
    if (selectRectItem) {
      selectRectItem.remove();
      selectRectItem = null;
    }
    // RS-3011 Step 10b: mirrors marqueeItem's own reset just above -- a Paint lasso interrupted
    // mid-drag (Escape/mode-switch/exit) must not leave a stale dashed preview or stale points
    // behind for the next stroke.
    if (paintLassoItem) {
      paintLassoItem.remove();
      paintLassoItem = null;
    }
    paintLassoPoints = [];
    // RS-3013 Step 1: mirrors paintLassoItem/paintLassoPoints' own reset just above -- a Lasso drag
    // interrupted mid-drag (Escape/mode-switch/exit) must not leave a stale dashed preview or stale
    // points behind for the next stroke. Deliberately does NOT touch activeSelection/
    // activeSelectionItem -- an already-committed region/draft selection must survive an unrelated
    // gesture interruption (e.g. Escape while idle), the same way selectedIds survives it too.
    if (lassoItem) {
      lassoItem.remove();
      lassoItem = null;
    }
    lassoPoints = [];
    // RS-3011 Step 11: mirrors paintLassoItem/paintLassoPoints' own reset just above -- a Trace drag
    // interrupted mid-drag (Escape/mode-switch/exit) must not leave a stale dashed preview or stale
    // points behind for the next line.
    if (traceItem) {
      traceItem.remove();
      traceItem = null;
    }
    tracePoints = [];
    // RS-3011 Step 13: mirrors traceItem/tracePoints' own reset just above -- an Eraser drag
    // interrupted mid-drag (Escape/mode-switch/exit) must not leave a stale preview or stale
    // points behind for the next sweep.
    if (eraseItem) {
      eraseItem.remove();
      eraseItem = null;
    }
    erasePoints = [];
    for (const item of resizeHandleItems) item.remove();
    resizeHandleItems = [];
    for (const item of rotateHandleItems) item.remove();
    rotateHandleItems = [];
    // RS-3011 resize-perf fix: a resize can be interrupted here (Escape/mode-switch/exit) before
    // onMouseUp's own restore ever runs -- without this, the Group hidden at resize-start (or by a
    // rebuild while resizing) would stay permanently invisible. Mirrors onMouseUp's own restore,
    // just with no final rebuild (nothing else about the shape's geometry changed on this path).
    if (interactionKind === 'resize' && resizeShapeId) {
      const stoneGroup = stoneGroups.get(resizeShapeId);
      if (stoneGroup) stoneGroup.visible = true;
    }
    // RS-3033: mirrors the resize restore just above -- a rotate can be interrupted here too, before
    // onMouseUp's own restore ever runs. Deliberately does NOT try to revert shape.item's own
    // partial live rotation back to rotateStartRotationDeg (the resize precedent above doesn't
    // revert its own in-progress bounds change either) -- the item is left wherever the interrupted
    // drag last rotated it, visually out of sync with the still-unchanged project.layers value,
    // until the next external syncFromProjectLayers() reconciliation tick corrects it (same accepted
    // "next tick fixes any drift" pattern the resize case already relies on -- see that branch's own
    // comment two lines up).
    if (interactionKind === 'rotate' && rotateShapeId) {
      const stoneGroup = stoneGroups.get(rotateShapeId);
      if (stoneGroup) stoneGroup.visible = true;
    }
    resizeHandle = null;
    resizeShapeId = null;
    resizeStartBounds = null;
    resizeRotationDeg0 = 0;
    resizeAnchorAbs = null;
    resizeHandleOffset = null;
    resizePivot = null;
    rotateShapeId = null;
    rotateCenter = null;
    rotateStartPointerAngleDeg = 0;
    rotateStartRotationDeg = 0;
    rotateAppliedDeg = 0;
    moveStartPoint = null;
    moveAnchorShapeId = null;
    moveAnchorStartBounds = null;
    moveAppliedOffset = null;
    interactionKind = null;
    dragging = false;
    polygonPoints = [];
    // RS-3011 Step 9: mirrors polygonPoints' own reset above -- board.clearPath() already discarded
    // board.path (every anchor placed so far, since Pen's in-progress path IS the real item, not a
    // parallel array), this just clears the preview chrome and per-drag bookkeeping.
    removePenPreviewItem();
    removePenHandleChromeItem();
    penDraggingSegment = null;
    penDragOrigin = null;
    penDragForceCorner = false;
    penDragCrossedDeadZone = false;
    penClosingDrag = false;
    // RS-3011 Step 12: mirrors penPreviewItem's own reset just above -- a Stamp ghost interrupted by
    // Escape/mode-switch/exit must not linger on the canvas.
    removeStampGhostItem();
    // RS-3011 Step 13: mirrors removeStampGhostItem() just above -- an Eraser ghost interrupted by
    // Escape/mode-switch/exit must not linger on the canvas either.
    removeEraserGhostItem();
  }

  /**
   * RS-3011 Step 1: called right after board.finalizeShape() at every finalize site (freehand
   * stroke end, each preset's drag-end, polygon close) with the same Paper.js Item that was just
   * finalized -- flattens it into a contour and hands the resulting 'path' layer to
   * onShapeCommitted(), the same shape/data the old batch commit() built per shape, just invoked
   * immediately instead of on a later explicit action. `item` stays alive in `board.shapes`
   * regardless (finalizeShape() already added it there for select/move/resize) -- this only reads
   * it, never removes it.
   *
   * Write-through fix: stamps the new layer's own id onto `item.data.layerId`, alongside
   * DrawingBoard.finalizeShape()'s own `item.data.shapeId` (a separate, board-local id) -- this is
   * what lets a later move/resize/delete on this same item look up which project.layers entry to
   * keep in sync (onShapeMoved/onShapeResized/onShapeDeleted below).
   * @param {paper.Item} item
   */
  function commitFinalizedShape(item) {
    const flattened = flattenPathToContour(item, FLATTEN_TOLERANCE_MM);
    if (!flattened) return;
    const { stoneSize, gap, color } = getStoneDefaults();
    // RS-3011 Step 6: `mode` still holds the draw tool that created this shape here -- it's only
    // reset to 'select' a few lines below, so the name must be resolved before that reassignment.
    const pathName =
      mode === 'freehand' ? (flattened.closed === false ? 'Line' : 'Freehand') : SHAPE_MODE_LAYER_NAMES[mode] || 'Drawn Shape';
    const layer = createPathLayerFromContour(flattened, {
      stoneSize,
      gap,
      color,
      pathName
    });
    // RS-3011 Step 7: a freshly drawn shape shows its outline immediately (finalize above already
    // did that) but defers stone generation until the operator presses "Generate Stones" -- every
    // read site of this field treats it as missing/true for backward compatibility (Boolean Ops
    // results, pre-Step-7 projects, anything not created via Design's draw tools).
    layer.stonesGenerated = false;
    item.data.layerId = layer.id;
    // RS-3011 issue #4a fix: a finalized shape stops being "still drawing" -- revert to select
    // mode and select the shape just drawn, the same selectedIds/applySelectionVisuals/
    // updateResizeHandles sequence a plain click-select already uses (see onMouseDown's hit-test
    // branch above), so the canvas immediately shows it selected with resize handles instead of
    // staying primed to place another shape on the next click. Landing this before
    // onShapeCommitted() below means the `mode` getter already reports 'select' by the time that
    // hook (app.js) reacts and syncs the rail buttons' aria-pressed state.
    mode = 'select';
    selectedIds = selectOnly(item.data.shapeId);
    applySelectionVisuals();
    updateResizeHandles();
    updateCursor();
    onShapeCommitted(layer);
    // RS-3011 Step 3b: build the new shape's live stone Group immediately -- item.data.shapeId was
    // already stamped by board.finalizeShape(), called by every one of this function's own call
    // sites before commitFinalizedShape() itself runs.
    rebuildStoneGroupForShape(item.data.shapeId);
  }

  /**
   * RS-3011 Step 2 fix: the reverse lookup of board.getShape's own board-local id -- callers outside
   * this file (Align/Distribute/Duplicate in app.js) only ever know a layer's project.layers id,
   * never this file's own shapeId, so repositionShapeForLayer/duplicateShapeForLayer both key off
   * `item.data.layerId` (the id commitFinalizedShape() stamped on) instead. Returns null if no
   * board.shapes item matches -- every non-Design layer type, since only Design-drawn shapes ever
   * get a layerId stamped on their item.
   * @param {string} layerId
   * @returns {{id:string,item:paper.Item}|null}
   */
  function findShapeByLayerId(layerId) {
    return board.listShapes().find((shape) => shape.item.data.layerId === layerId) || null;
  }

  // RS-3011 Step 3b: shapeId -> paper.Group, one live stone-dot preview per finalized Design shape,
  // keyed the same way board.shapes itself is (not layerId -- a shape can exist with no
  // item.data.layerId only transiently, never once committed, so shapeId is the stable key
  // throughout this file). Every shape's group renders simultaneously, independent of selection --
  // see rebuildStoneGroupForShape()'s own doc comment for the render-order guarantee.
  const stoneGroups = new Map();

  // rs-design-crystal-dots: shapeId -> paper.Group Map above holds finished dot previews; these two
  // hold the sprite-rendering assets that build them. stoneSymbolDefs is keyed identically to
  // StoneSpriteCache's own cache (`${colorKey}|${radiusBucket}|${variantIndex}`, radiusBucket via
  // quantizeRadiusPx()) so a symbol definition and its underlying sprite always invalidate together.
  const stoneSymbolDefs = new Map();
  let stoneSpriteZoomBucket = null;

  /**
   * Quantizes `zoom` into a sqrt(2)-ratio bucket id -- two zoom levels within a factor of sqrt(2)
   * of each other land in the same bucket. Used by applyViewport() below to decide when the sprite
   * cache is stale enough (an actual visible-resolution mismatch, not just float noise from a pan/
   * sub-pixel zoom tick) to justify the cost of re-baking every stone sprite + symbol definition and
   * rebuilding every shape's stone Group.
   * @param {number} zoom
   * @returns {number}
   */
  function stoneSpriteZoomBucketFor(zoom) {
    return Math.round(2 * Math.log2(zoom));
  }

  /** Removes shapeId's stone Group (if any) from both the scene and `stoneGroups`. */
  function removeStoneGroupForShape(shapeId) {
    const group = stoneGroups.get(shapeId);
    if (group) group.remove();
    stoneGroups.delete(shapeId);
  }

  /**
   * Re-runs rebuildStoneGroupForShape() for every currently-finalized shape -- the "rebuild all
   * stone groups" side of a zoom-bucket change (applyViewport() below), reusing this file's one
   * existing rebuild entry point rather than a second mechanism.
   */
  function rebuildAllStoneGroups() {
    for (const shape of board.listShapes()) rebuildStoneGroupForShape(shape.id);
  }

  /**
   * Full rebuild of a single shape's stone Group: re-flattens the shape's OWN current Paper.js item
   * (never the stored layer's `contours` -- see this function's callers for why: a resize/param
   * change/creation must always reflect the shape's live-drawn geometry, and re-flattening the item
   * directly is the same "place a natural-size shape into a box" transform GeometryEngine's own
   * _placeNaturalContours() would apply to layer.contours, just read straight off the item instead)
   * plus the layer's own stoneSize/gap/color/fillMode (getLayerStoneParams hook), runs both through
   * app.js's generatePathLayout hook (the same permanentEngine.generatePathLayout() call
   * generatePathStonesLive() makes), and builds a fresh paper.Group of paper.SymbolItem sprites
   * (rs-design-crystal-dots) -- each one a cached offscreen bake of CrystalStoneRenderer.js's
   * faceted-crystal drawCrystalStone(), via StoneSpriteCache.js, so Design's own preview matches the
   * 2D Canvas view's look. drawCrystalStone() itself is still Canvas2D-only (its own header
   * comment); only its baked *output* reaches Paper.js, as a paper.Raster wrapped in a
   * paper.SymbolDefinition. The new Group is inserted directly below the shape's own outline item (`group.insertBelow`,
   * same layer, no second canvas/paper.Layer) before the old one (if any) is removed, so every other
   * shape's own group/outline is untouched and z-order never has a frame without a group present.
   * A no-op (existing group, if any, is torn down) if the shape no longer exists, has no layerId, or
   * getLayerStoneParams returns null (not a 'path' layer, or the layer no longer exists) -- the same
   * "no-op otherwise" write-through convention as this file's other project.layers-sync hooks.
   * @param {string} shapeId
   */
  function rebuildStoneGroupForShape(shapeId) {
    const shape = board.getShape(shapeId);
    if (!shape) {
      removeStoneGroupForShape(shapeId);
      return;
    }
    const layerId = shape.item.data.layerId;
    const styleParams = layerId ? getLayerStoneParams(layerId) : null;
    if (!styleParams) {
      removeStoneGroupForShape(shapeId);
      return;
    }
    // RS-3011 Step 8 Phase B: flattenPathToContours() (plural) rather than flattenPathToContour()
    // -- shape.item can now be a paper.CompoundPath (a multi-contour SVG import), which has no
    // `.segments` of its own (only its per-contour children do); flattenPathToContours() already
    // walks a Group/CompoundPath/Path uniformly, and is a strict generalization of the singular
    // function for the single-Path case every hand-drawn shape still produces (see its own doc
    // comment), so this is a safe swap for every existing shape too, not just imports.
    const flattened = flattenPathToContours(shape.item, FLATTEN_TOLERANCE_MM);
    if (flattened.contours.length === 0) return;
    // RS-3011 resize-repositioning fix: xMm/yMm/widthMm/heightMm must track the shape's LIVE,
    // currently-dragged Paper.js geometry (flattened, from shape.item) -- that's what makes a
    // resize-in-progress preview live. `contours`/`closed` must NOT come from that same live
    // re-flatten though: they need to stay the layer's own FIXED, author-time natural-space contour
    // (styleParams.contours/closed, from getLayerStoneParams() -- ultimately project.layers[].contours,
    // never touched by a resize, see onShapeResized's own doc comment), the SAME natural reference
    // generatePathStonesLive() (the production pipeline) and absolutePolygonsToNaturalSpace()
    // (Stamp/Trace/Eraser/Paint's own click-to-natural-space conversion) both already use. Feeding
    // generatePathLayout() the LIVE re-flattened contour here (as this used to) made
    // computeNaturalContourTransform() derive its scale from that SAME live geometry's own bounding
    // box, which by construction always exactly equals the target xMm/widthMm -- forcing scale to
    // ALWAYS be 1 regardless of any actual resize, silently breaking stampedStones/regions/
    // eraseDaubs' own placement (which store points against the fixed natural contour) for any shape
    // ever resized away from its original box. Confirmed via live instrumentation: this exact
    // mismatch reproduced the reported "stamp appears near the OLD pre-resize position" bug.
    // RS-3014 Step 3: a layer with a frozen naturalBoundingBoxMm (an Outline-mode Eraser cut has
    // run on it) is the one exception to "always use the live re-flattened geometry" above -- it
    // uses the layer's own STATIC x/y/w/h (styleParams.staticXMm etc.) instead, the same values
    // generatePathStonesLive() (the production pipeline) already uses for such a layer. Reusing
    // `flattened.xMm/widthMm` here instead would combine the frozen (pre-cut) box with the LIVE
    // item's own ALREADY-shrunk width -- shrinking the base fill a second time -- and, separately,
    // marching-squares re-traces the WHOLE boundary (not just the cut edge) at finite grid
    // resolution, so even the live item's untouched edges carry a little sub-mm quantization noise
    // relative to the layer's exact static box; feeding that noisy live geometry back through the
    // (already frozen-box-anchored) region/stampedStones/eraseDaubs transform very slightly
    // repositions them on THIS canvas even though the frozen box's whole purpose is to prevent
    // exactly that. Matching the production pipeline's own static-box math avoids both.
    // Trade-off, deliberate: using the STATIC box means a previously-cut shape's own stone-dot
    // preview no longer tracks a live in-progress resize drag frame-by-frame (it lags until the
    // drag commits and layer.w/h actually update) -- accepted rather than "fixed" back to live
    // tracking, since that's exactly what reintroduces the double-shrink/repositioning bug above.
    // RS-3033: a rotated layer (styleParams.rotationDeg truthy) is the second reason to prefer the
    // static box -- `flattened.xMm/widthMm` etc. is the LIVE item's own AXIS-ALIGNED bounding box,
    // which for a rotated item is generally NOT the same box GeometryEngine's own rotation step
    // pivots around (it rotates the UNROTATED placed contours around THEIR OWN center -- see
    // GeometryEngine._pathPolygons()'s own rotation-step comment); feeding it the rotated AABB
    // instead would scale the unrotated natural contour to fill that larger/differently-shaped box,
    // shearing it into the wrong shape, the identical failure mode RS-3032 Step A already
    // identified for a naive `.bounds =` stretch of an already-rotated SHAPE_LIBRARY_KINDS item.
    // This module never live-rotates the stone Group frame-by-frame during an in-progress rotate
    // drag (it stays hidden instead -- see onMouseDown's own 'rotate' branch comment for why), so
    // there is no live-tracking benefit being traded away here, unlike the resize case above: by
    // the time this function is ever called for a rotated shape, `shape.item` is always either
    // freshly re-materialized (already correctly rotated) or about to be, never mid-rotate-drag.
    const useStaticBox = Boolean(styleParams.naturalBoundingBoxMm) || Boolean(styleParams.rotationDeg);
    const params = {
      contours: styleParams.contours,
      layerId,
      xMm: useStaticBox ? styleParams.staticXMm : flattened.xMm,
      yMm: useStaticBox ? styleParams.staticYMm : flattened.yMm,
      widthMm: useStaticBox ? styleParams.staticWidthMm : flattened.widthMm,
      heightMm: useStaticBox ? styleParams.staticHeightMm : flattened.heightMm,
      closed: styleParams.closed,
      ...styleParams
    };
    const stones = generatePathLayout(params);
    const group = new paper.Group();
    group.data.isStoneGroup = true;
    // rs-design-crystal-dots: px-per-project-mm the sprites below bake at, clamped so a sprite never
    // bakes illegibly small (deep zoom-out) or wastefully large (deep zoom-in) -- see this file's
    // header comment for the paper project-unit-equals-mm convention `paper.view.zoom` reads here.
    const spritePxPerMm = Math.min(STONE_SPRITE_PX_PER_MM_MAX, Math.max(STONE_SPRITE_PX_PER_MM_MIN, paper.view.zoom));
    for (let i = 0; i < stones.length; i++) {
      const stone = stones[i];
      const radiusPxBucket = quantizeRadiusPx((stone.d / 2) * spritePxPerMm);
      const variantIndex = getCrystalAppearance({
        xMm: stone.x,
        yMm: stone.y,
        sizeMm: stone.d,
        color: stone.color,
        layerId,
        index: i
      }).seed % STONE_SPRITE_VARIANT_COUNT;
      const symbolDefKey = `${stone.color}|${radiusPxBucket}|${variantIndex}`;
      let symbolDef = stoneSymbolDefs.get(symbolDefKey);
      if (!symbolDef) {
        const spriteCanvas = getStoneSprite(stone.color, radiusPxBucket, variantIndex);
        symbolDef = new paper.SymbolDefinition(new paper.Raster(spriteCanvas));
        stoneSymbolDefs.set(symbolDefKey, symbolDef);
      }
      const symbolItem = new paper.SymbolItem(symbolDef, new paper.Point(stone.x, stone.y));
      symbolItem.scale(1 / spritePxPerMm);
      symbolItem.data.isStoneDot = true;
      group.addChild(symbolItem);
    }
    // RS-3011 resize-perf fix: this shape's resize is still in progress (mouse still down) -- keep
    // the freshly rebuilt Group hidden too, since every rAF-throttled rebuild during a resize
    // creates a brand-new Group (default visible=true) that would otherwise undo the hide applied
    // at drag-start on the very next frame. Scoped to this specific shapeId so an unrelated
    // rebuild (a different shape, or this same shape via syncFromProjectLayers) is never affected.
    if (interactionKind === 'resize' && shapeId === resizeShapeId) group.visible = false;
    group.insertBelow(shape.item);
    const old = stoneGroups.get(shapeId);
    if (old) old.remove();
    stoneGroups.set(shapeId, group);
  }

  // RS-3011 Step 3b: resize's own one-rebuild-per-animation-frame throttle, the same
  // requestAnimationFrame + dedup-flag pattern as Preview3DRenderer.js's _requestRender()/
  // _frameScheduled (see tools/test-preview3d-render-scheduling.mjs) -- not a second throttle
  // mechanism, the identical shape applied here since a resize's contour genuinely changes every
  // frame (unlike move, which only ever needs a cheap translate()). shapeId is captured as this
  // function's own argument (not read from resizeShapeId at fire time), so a pending rebuild still
  // targets the right shape even if onMouseUp has already cleared resizeShapeId by the time the
  // frame fires.
  let stoneRebuildFrameScheduled = false;
  function scheduleStoneRebuildForShape(shapeId) {
    if (stoneRebuildFrameScheduled) return;
    stoneRebuildFrameScheduled = true;
    requestAnimationFrame(() => {
      stoneRebuildFrameScheduled = false;
      rebuildStoneGroupForShape(shapeId);
    });
  }

  /**
   * RS-3013 Step 2 fix: the shared region-first drag-start check, called from Select's own
   * onMouseDown branch (AFTER its resize-handle check -- see that call site's own comment for why)
   * and from Lasso's own branch (which has no resize-handle concept, so this runs unconditionally
   * there). Factored out rather than duplicated inline at both call sites. On a hit: clears any
   * shape multi-selection, sets activeSelection to the region, starts a 'moveRegion' drag, and
   * returns true so the caller can return immediately without falling through to its own next
   * hit-test. Returns false (no state touched) when `point` hits no region.
   * @param {paper.Point} point
   * @returns {boolean}
   */
  function tryStartRegionMove(point) {
    const regionHit = hitTestRegion({ xMm: point.x, yMm: point.y }, REGION_HIT_MARGIN_PX / paper.view.zoom);
    if (!regionHit) return false;
    if (selectedIds.size) {
      selectedIds = clearSelection();
      applySelectionVisuals();
      updateResizeHandles();
      notifySelectionChanged();
    }
    setActiveSelection({ kind: 'region', layerId: regionHit.layerId, regionId: regionHit.regionId }, [
      regionHit.polygon
    ]);
    interactionKind = 'moveRegion';
    dragStart = point;
    return true;
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
          // RS-3011 Step 1: commit before resetInProgressDrawing() below clears interactionKind/
          // polygonPoints -- commitFinalizedShape() only reads `closedPath` itself, unaffected
          // either order, but keeping this next to finalizeShape() matches every other site.
          commitFinalizedShape(closedPath);
          resetInProgressDrawing();
        } else {
          // RS-3010 Step 2e: the vertex itself snaps (Step 2f: vertex-else-grid, optionally
          // angle-constrained first); the closing-distance check above deliberately used the raw
          // event.point instead, since that's a proximity/intent heuristic, not a geometry
          // placement.
          polygonPoints.push(resolvePolygonVertexPoint(event.point, event.modifiers.shift));
        }
        return;
      }
      // RS-3011 Step 9: an in-progress Pen path takes over the pointer entirely, same "owns every
      // click until closed or cancelled" rule as polygon above. Unlike polygon, board.path here IS
      // the real shape already (see penDraggingSegment's own doc comment), so closing/resetting act
      // on its live segments directly instead of rebuilding from a parallel point array.
      if (interactionKind === 'pen') {
        const anchors = board.path.segments;
        const closing =
          anchors.length >= PEN_MIN_CLOSE_ANCHORS &&
          event.point.getDistance(anchors[0].point) <= PEN_ANCHOR_HIT_TOLERANCE_PX / paper.view.zoom;
        if (closing) {
          // RS-3011 Step 9 revision: closing is now a drag-shapeable gesture too, matching every
          // other anchor -- finalize in onMouseDrag's/onMouseUp's pen branches once the drag (if
          // any) ends, not immediately here. penDraggingSegment is set to the FIRST anchor (not a
          // new segment): a closing drag shapes the incoming curve for the closing segment itself.
          removePenPreviewItem();
          penDraggingSegment = anchors[0];
          penDragOrigin = event.point.clone();
          penDragForceCorner = event.modifiers.alt;
          penDragCrossedDeadZone = false;
          penClosingDrag = true;
          return;
        }
        const last = anchors[anchors.length - 1];
        const resetting =
          event.point.getDistance(last.point) <= PEN_ANCHOR_HIT_TOLERANCE_PX / paper.view.zoom;
        if (resetting) {
          // Corner/Reset: only the outgoing handle is cleared -- the curve already rendered INTO
          // this anchor (handleIn, from the previous segment) is left untouched, so this only
          // affects segments drawn from here forward, never retroactively straightens what's
          // already there.
          last.handleOut = new paper.Point(0, 0);
          rebuildPenHandleChromeItem();
          return;
        }
        removePenPreviewItem();
        const snapped = resolveSnappedPoint(event.point, null);
        const seg = board.path.add(new paper.Point(snapped.x, snapped.y));
        penDraggingSegment = seg;
        penDragOrigin = seg.point.clone();
        // Alt/Option held while PLACING this anchor forces it to stay a corner regardless of drag
        // distance -- an alternate, one-step way to reach "sharp corner" without a separate
        // return-click on this same anchor afterward.
        penDragForceCorner = event.modifiers.alt;
        penDragCrossedDeadZone = false;
        // An ordinary anchor placement must never be mistaken for a closing drag.
        penClosingDrag = false;
        rebuildPenHandleChromeItem();
        return;
      }
      // RS-3011 Step 12: Stamp owns every click outright, exactly like Pen/Paint above -- a click
      // always places a stone (or discards silently with no target), never resizes/moves/selects
      // whatever it lands on. Skips the move/resize hit-test block below entirely (rather than
      // joining its `mode !== 'pen' && mode !== 'paint'` exception), since unlike Paint, Stamp has
      // nothing further to do with this event once it returns -- no in-progress gesture, no drag.
      // Target selection + coordinate conversion + project.layers mutation all live in app.js's own
      // onStampPlace hook, matching onPaintStroke's own architecture split (this file's own hooks-
      // param doc comment).
      if (mode === 'stamp') {
        // The ghost preview circle built by the last onMouseMove (updateStampGhostItem) sits
        // exactly at this same point and carries a real fillColor -- left in place, it would win
        // hitTestShapeId's own fill hit-test against itself (it has no data.shapeId, so that hit
        // would resolve to a null layerId, masking the actual shape underneath). Must be removed
        // BEFORE resolving the target, not after.
        removeStampGhostItem();
        // RS-3012 Step 1: a click landing outside the current activeSelection's own boundary is
        // rejected outright -- no onStampPlace call at all (no history entry, no stone), just
        // onStampRejected() so app.js can surface a status message. No constraint at all when
        // activeSelection is null, byte-identical to before this step.
        const stampPointMm = { xMm: event.point.x, yMm: event.point.y };
        if (activeSelection && !isPointInActiveSelection(stampPointMm, activeSelection)) {
          onStampRejected();
          return;
        }
        onStampPlace({
          xMm: event.point.x,
          yMm: event.point.y,
          layerId: resolveStampTargetLayerId(event.point)
        });
        return;
      }
      // RS-3014 Step 4: click-to-move/resize-by-clicking-inside-a-shape is fundamentally Select's
      // own behavior, not a default every other tool opts out of. Every other tool -- Pen, Paint,
      // Trace, Eraser, Stamp (already handled/returned above), and now Rect/Ellipse/Slot/Freehand/
      // Polygon (below) -- deliberately starts ON TOP of its intended target (that's the whole point
      // of painting a sub-region, tracing a line along a shape's edge, or drawing a new shape inside
      // an existing one), so it must never be hijacked into moving/resizing whatever it lands on
      // instead. Gating on `mode === 'select'` (positive check) rather than an exclusion list means
      // a future new tool can't reintroduce this bug by omission -- it's opted out by default and
      // must explicitly opt in.
      // RS-3013 Step 2: Lasso's own region-first drag-start check -- a drag starting on an existing
      // region's own footprint must move the region, not start a fresh lasso stroke over it (mirrors
      // performClickDispatch()'s own region-first precedent). Lasso has no resize-handle concept at
      // all, so this runs unconditionally, before any of Lasso's own gesture-start logic further
      // below. Select's own version of this same check lives INSIDE the mode === 'select' branch
      // just below, AFTER its resize-handle check -- see that call site's own comment for why the
      // ordering there differs (RS-3013 Step 2 fix: Design Step D's "handle must win" invariant).
      if (mode === 'lasso' && tryStartRegionMove(event.point)) {
        return;
      }
      if (mode === 'select') {
        // RS-3033: the rotate handle must win over BOTH the resize-handle check just below AND the
        // plain shape hit-test further down, mirroring app.js's own rotateHandleHitTest()-checked-
        // first ordering in its hitTest() -- so a rotate-drag is never misinterpreted as a resize or
        // move. rotateStartRotationDeg reads shape.item.data.rotationDeg (stamped by
        // materializeShapeFromLayer() and kept in sync by syncFromProjectLayers()' own reconciliation
        // -- see those functions' own comments) rather than reading project.layers directly, since
        // this file never touches project state itself (this module's own architecture, per its
        // header comment) -- app.js is the one place rotationDeg is ever written.
        if (hitTestRotateHandle(event.point)) {
          const shape = board.getShape([...selectedIds][0]);
          interactionKind = 'rotate';
          rotateShapeId = shape.id;
          // RS-3033: pivots around the shape's own STAMPED placement-box center (item.data.pivotXMm/
          // pivotYMm -- see materializeShapeFromLayer()/materializeShapeLibraryItemFromLayer()'s own
          // comments for why), NOT rotateHandlePositionFor(shape.item.bounds)'s own `center` -- that
          // is the shape's CURRENT (possibly already-rotated) axis-aligned bounding box's center,
          // correct only for a shape's FIRST rotate-drag. Rotating a second time from an already-
          // rotated, non-symmetric shape would otherwise pivot around the wrong point (the rotated
          // AABB's center generally drifts away from the true placement-box center), producing a
          // live preview that visibly snaps to a different position the instant onShapeRotated()'s
          // own re-materialize commits the CORRECT pivot. Falls back to the current bounds' center
          // for an item never materialized through either of those two functions (a shape drawn via
          // Rect/Ellipse/Slot/Polygon that has never yet been rotated, moved, or resized -- always
          // still axis-aligned/unrotated at that point, so its current bounds' center IS correct).
          const shapeBounds = shape.item.bounds;
          rotateCenter = (shape.item.data.pivotXMm !== undefined && shape.item.data.pivotYMm !== undefined)
            ? new paper.Point(shape.item.data.pivotXMm, shape.item.data.pivotYMm)
            : shapeBounds.center;
          // Same clockwise-from-up atan2(dx,-dy) convention app.js's own rotate-drag-start uses --
          // pointermove/onMouseDrag below only ever needs the *change* in pointer angle from this
          // reference, added to the shape's own starting rotationDeg, so the handle tracks the
          // pointer exactly with no jump at drag-start.
          const startVector = event.point.subtract(rotateCenter);
          rotateStartPointerAngleDeg = Math.atan2(startVector.x, -startVector.y) * 180 / Math.PI;
          rotateStartRotationDeg = shape.item.data.rotationDeg || 0;
          rotateAppliedDeg = 0;
          // Same resize-perf precedent as the 'resize' branch just below: hide the stone Group for
          // the duration of the drag rather than attempting a live, per-frame-accurate rebuild --
          // unlike a resize, a live rotate cannot cheaply approximate the real GeometryEngine output
          // via a rigid transform of the EXISTING stone dots either (fill-mode sampling is grid-based,
          // not rotation-equivariant -- rotating the already-sampled dots would not match what
          // GeometryEngine actually produces for the rotated contour), so a hidden Group for the
          // drag's duration, restored + fully rebuilt once at mouseup, is the only cheap AND correct
          // option, exactly like resize's own choice below (just for a different reason).
          const stoneGroup = stoneGroups.get(shape.id);
          if (stoneGroup) stoneGroup.visible = false;
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
          // RS-3034: local unrotated box b0 (not shape.item.bounds directly -- see
          // unrotatedLocalBoundsFor()'s own comment), rotationDeg0 (fixed for the whole drag), and
          // the dragged handle's ANCHOR (opposite corner/edge) at its true absolute rotated
          // position -- snapshotted once here exactly like app.js's own RS-3030 resize-drag-start
          // (rotationDeg0/cx0/cy0/anchorLocal/anchorAbs), so the anchor stays visually fixed for the
          // whole drag regardless of how the live item gets mutated frame to frame.
          resizeStartBounds = unrotatedLocalBoundsFor(shape.item);
          resizeRotationDeg0 = shape.item.data.rotationDeg || 0;
          resizeHandleOffset = HANDLE_UNIT_OFFSET[resizeHandle];
          const cx0 = resizeStartBounds.left + resizeStartBounds.width / 2;
          const cy0 = resizeStartBounds.top + resizeStartBounds.height / 2;
          const anchorLocal = {
            x: cx0 - resizeHandleOffset.x * (resizeStartBounds.width / 2),
            y: cy0 - resizeHandleOffset.y * (resizeStartBounds.height / 2)
          };
          const anchorAbs = resizeRotationDeg0
            ? rotatePointDeg(anchorLocal.x, anchorLocal.y, cx0, cy0, resizeRotationDeg0)
            : anchorLocal;
          resizeAnchorAbs = new paper.Point(anchorAbs.x, anchorAbs.y);
          resizePivot = new paper.Point(cx0, cy0);
          // RS-3011 resize-perf fix: hide the stone Group for the duration of the drag. CDP tracing
          // (tools/scratch/rs-3011-resize-perf-spike/) found the dominant per-frame cost during a
          // resize drag is Paper.js's own canvas redraw (handleCallbacks -> View.update(), ~7.2ms
          // median/frame), not rebuildStoneGroupForShape() itself (~5.4ms median/frame) -- an
          // invisible Group is skipped by that redraw pass. rebuildStoneGroupForShape() re-applies
          // this on every rAF-throttled rebuild below for as long as this resize stays in progress.
          const stoneGroup = stoneGroups.get(shape.id);
          if (stoneGroup) stoneGroup.visible = false;
          return;
        }
        // RS-3013 Step 2 fix: region-first check runs HERE, after the resize-handle check above --
        // both hit-tests use the numerically identical 4/paper.view.zoom tolerance
        // (REGION_HIT_MARGIN_PX above; hitTestResizeHandle()'s own `tolerance` constant), and a
        // region painted flush against its parent shape's own edge (a documented, ordinary case --
        // see PaintRegionSelection.js's own "thin sliver clipped hard against the shape's edge" doc
        // comment) can sit within that tolerance of a handle position, at a corner/edge-midpoint
        // where a flush-clipped region is most likely to land a contour point. Checking the handle
        // first restores Design Step D's own "handle must win" invariant, which this step's original
        // region-first-of-everything ordering broke. Still runs BEFORE hitTestShapeId()/'move' below,
        // so a region still wins over dragging the shape body underneath it -- that ordering is
        // unchanged and correct, this step's own actual goal.
        if (tryStartRegionMove(event.point)) {
          return;
        }
        const hitId = hitTestShapeId(event.point);
        if (hitId) {
          // RS-3013 Step 1: a shift-click's own click-vs-drag question is never ambiguous (it never
          // starts a drag on its own, see below) -- resolved right here via performClickDispatch(),
          // the SAME click-decision function Lasso's own click path uses, rather than the hand-rolled
          // toggle this branch used to do inline, so a region under this exact point (checked FIRST
          // by that function) can win over the shape-toggle below, same as an unshifted click can
          // (see this branch's own 'move' mouseup counterpart for that case).
          if (event.modifiers.shift) {
            performClickDispatch(event.point, true);
            interactionKind = null;
            return;
          }
          // Same click/drag-preserves-group convention as the existing project.layers pointerdown
          // handler in app.js: a plain click on a shape already part of the current multi-selection
          // preserves the whole group (so a follow-up drag moves it together) instead of collapsing
          // to just that one shape. Selected here (not deferred to performClickDispatch()) because a
          // group-drag needs selectedIds to already reflect this shape the instant onMouseDrag's own
          // 'move' branch can start reading it -- see that branch's own comment for why the possible
          // "this was actually a region click" override has to happen at mouseup instead.
          if (!selectedIds.has(hitId)) {
            selectedIds = selectOnly(hitId);
            applySelectionVisuals();
            updateResizeHandles();
            notifySelectionChanged();
          }
          // RS-3013 Step 1: mutual exclusivity -- picking a shape (even just speculatively, pending
          // the click-vs-drag decision below) means any existing region/draft selection no longer
          // applies.
          if (activeSelection) setActiveSelection(null);
          interactionKind = 'move';
          // RS-3010 Step 2e: hitId (the specific shape actually clicked, even within a
          // multi-selection) is the natural anchor for a group drag -- see the moveStartPoint
          // cluster's own doc comment above for why this tracks an absolute anchor instead of
          // snapping event.delta directly.
          moveStartPoint = event.point;
          moveAnchorShapeId = hitId;
          moveAnchorStartBounds = board.getShape(hitId).item.bounds.clone();
          moveAppliedOffset = { x: 0, y: 0 };
          return;
        }
      }
      // Empty canvas (or any other mode reaching this point, e.g. Lasso/Paint/Trace/Eraser's own
      // mousedown below): clear any existing shape multi-selection AND any existing region/draft
      // selection (RS-3013 Step 1: the two selection modes are mutually exclusive, so starting fresh
      // clears both), then start a new shape/gesture per the active mode.
      if (selectedIds.size) {
        selectedIds = clearSelection();
        applySelectionVisuals();
        updateResizeHandles();
        notifySelectionChanged();
      }
      // RS-3012 Step 1: Trace is the one mode reaching this point that must NOT clear activeSelection
      // -- unlike Lasso/Paint's own "always start fresh, even directly over an existing selection"
      // gesture (a brand-new lasso/paint stroke IS a new selection/region, so replacing the old one is
      // correct), Trace's whole point this milestone is reading the EXISTING selection to decide where
      // its placements land (see onMouseUp's own 'trace' branch below, which calls
      // isPointInActiveSelection() per point) -- it has to survive all the way there untouched. Stamp
      // never reaches this line at all (its own mode==='stamp' branch above always returns first), so
      // it needs no equivalent exemption here.
      if (activeSelection && mode !== 'trace') setActiveSelection(null);
      // Design Step C: Select's empty-canvas drag starts a marquee -- RS-3013 Step 1: now gated
      // behind Shift (previously unconditional); an unshifted drag instead starts 'selectRect', the
      // twin gesture that resolves a target shape the same way Lasso's own drag does but stores the
      // drawn rectangle unclipped (see that branch's own onMouseUp handling). Both preview items are
      // built lazily in onMouseDrag (mirrors rect/ellipse/slot's own "nothing meaningful to show at a
      // zero-size box" reasoning above).
      if (mode === 'select') {
        interactionKind = event.modifiers.shift ? 'marquee' : 'selectRect';
        dragStart = event.point;
        return;
      }
      if (mode === 'polygon') {
        interactionKind = 'polygon';
        // Step 2f: the first vertex of a brand-new polygon has no prior point to constrain a
        // direction against, so it's vertex-else-grid only -- no angle-snap (see
        // resolvePolygonVertexPoint's own doc comment for the shared logic used from here on).
        polygonPoints = [resolveSnappedPoint(event.point, null)];
        return;
      }
      if (mode === 'pen') {
        // RS-3011 Step 9: the first anchor of a brand-new Pen path -- board.path becomes the real
        // shape from this point on (see penDraggingSegment's own doc comment above), not a preview
        // rebuilt from a parallel array the way polygon's first vertex is.
        interactionKind = 'pen';
        const snapped = resolveSnappedPoint(event.point, null);
        board.beginPath(
          new paper.Path({ strokeColor: STROKE_COLOR, strokeWidth: STROKE_WIDTH_PX / paper.view.zoom })
        );
        const seg = board.path.add(new paper.Point(snapped.x, snapped.y));
        penDraggingSegment = seg;
        penDragOrigin = seg.point.clone();
        penDragForceCorner = event.modifiers.alt;
        penDragCrossedDeadZone = false;
        // An ordinary anchor placement must never be mistaken for a closing drag.
        penClosingDrag = false;
        // RS-3011 Step 9 follow-up: renders the anchor dot for this very first anchor immediately --
        // Paper.js needs 2+ points to show any stroke, so without this the starting point is
        // otherwise invisible until a second anchor is placed.
        rebuildPenHandleChromeItem();
        return;
      }
      if (mode === 'paint') {
        // RS-3011 Step 10b: the first point of a brand-new lasso stroke -- a single click-drag-
        // release gesture, not a multi-click one like polygon/pen above, so there's no "resume an
        // in-progress paintLassoPoints" branch at the top of this handler the way interactionKind
        // === 'polygon'/'pen' have; paintLassoPoints only ever accumulates within one
        // mousedown-to-mouseup cycle. Not routed through board.beginPath() -- see paintLassoItem's
        // own doc comment for why (mirrors marqueeItem, never a committable shape).
        interactionKind = 'paint';
        paintLassoPoints = [event.point];
        paintLassoItem = new paper.Path({
          strokeColor: STROKE_COLOR,
          strokeWidth: STROKE_WIDTH_PX / paper.view.zoom,
          dashArray: [PAINT_LASSO_DASH_PX / paper.view.zoom, PAINT_LASSO_DASH_PX / paper.view.zoom]
        });
        paintLassoItem.add(event.point);
        return;
      }
      if (mode === 'lasso') {
        // RS-3013 Step 1: Select's twin selection tool -- same single click-drag-release gesture
        // shape as Paint's own branch just above (lassoPoints only ever accumulates within one
        // mousedown-to-mouseup cycle), same dashed-preview styling. Deliberately skips the
        // hit-test-move-first dispatch above (mode !== 'select', so that block never runs) --
        // exactly like Paint, a lasso must always start fresh on mousedown, even directly on top of
        // an existing shape, since selecting PART of a shape is the entire point of the tool. The
        // click-vs-drag decision (was this basically a click, or a real stroke?) is deferred to
        // onMouseUp -- see that branch's own comment.
        interactionKind = 'lasso';
        lassoPoints = [event.point];
        lassoItem = new paper.Path({
          strokeColor: STROKE_COLOR,
          strokeWidth: STROKE_WIDTH_PX / paper.view.zoom,
          dashArray: [PAINT_LASSO_DASH_PX / paper.view.zoom, PAINT_LASSO_DASH_PX / paper.view.zoom]
        });
        lassoItem.add(event.point);
        return;
      }
      if (mode === 'trace') {
        // RS-3011 Step 11: the first point of a brand-new Trace drag -- same single click-drag-
        // release shape as Paint's own branch just above (tracePoints only ever accumulates within
        // one mousedown-to-mouseup cycle), and the same dashed-preview styling, reusing
        // PAINT_LASSO_DASH_PX rather than a second dash-size constant.
        interactionKind = 'trace';
        tracePoints = [event.point];
        traceItem = new paper.Path({
          strokeColor: STROKE_COLOR,
          strokeWidth: STROKE_WIDTH_PX / paper.view.zoom,
          dashArray: [PAINT_LASSO_DASH_PX / paper.view.zoom, PAINT_LASSO_DASH_PX / paper.view.zoom]
        });
        traceItem.add(event.point);
        return;
      }
      if (mode === 'eraser') {
        // RS-3011 Step 13: the first point of a brand-new Eraser sweep -- same single click-drag-
        // release shape as Trace's own branch just above (erasePoints only ever accumulates within
        // one mousedown-to-mouseup cycle), same dashed-preview styling. The idle hover ghost sits
        // exactly at this same point -- removed before the drag preview takes over, same
        // "stale ghost must not linger" precedent Stamp's own onMouseDown branch established
        // (harmless here either way, since the ghost is outline-only/no fillColor and this tool's
        // own hit-test never depends on it, but kept for consistency).
        removeEraserGhostItem();
        interactionKind = 'eraser';
        // RS-3014 Step 3: snapshot the mode for THIS gesture -- see eraserMode's own state-block
        // doc comment above for why this must not track a live mid-drag toggle change.
        activeEraserMode = eraserMode;
        erasePoints = [event.point];
        eraseItem = new paper.Path({
          strokeColor: ERASER_STROKE_COLOR,
          strokeWidth: eraserRadiusMm * 2,
          strokeCap: 'round',
          strokeJoin: 'round',
          opacity: 0.35
        });
        eraseItem.add(event.point);
        return;
      }
      interactionKind = 'draw';
      dragStart = event.point;
      dragging = true;
      if (mode === 'freehand') {
        // RS-3011 Step 1: freehand is a continuous interaction (many pointermove samples before
        // the stroke ends) -- opened here, at drag-start, and closed in onMouseUp's 'freehand'
        // branch below (whether the stroke finalizes or gets discarded), so a single stroke is
        // one undo step, not one per commitFinalizedShape() call some other site relies on.
        openHistorySession();
        const path = new paper.Path({
          strokeColor: STROKE_COLOR,
          strokeWidth: STROKE_WIDTH_PX / paper.view.zoom
        });
        path.add(event.point);
        board.beginPath(path);
      } else if (mode === 'rect' || mode === 'ellipse' || mode === 'slot') {
        // RS-3010 Step 2e: snap the drag's start corner/axis-endpoint -- freehand deliberately
        // excluded (snapping every point of a hand-drawn stroke would produce a jagged line).
        // Step 2f: vertex-else-grid (excludeShapeId null -- a brand-new shape has no "own" points
        // to exclude).
        dragStart = resolveSnappedPoint(dragStart, null);
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
        // RS-3010 Step 2e: snap the anchor shape's total offset since move-start to the grid, then
        // apply only the incremental delta still owed this frame -- every selected shape moves by
        // that same delta, preserving their relative positions, while the anchor's own bounds land
        // exactly on a grid multiple.
        const totalOffset = {
          x: event.point.x - moveStartPoint.x,
          y: event.point.y - moveStartPoint.y
        };
        const rawAnchorPos = {
          x: moveAnchorStartBounds.left + totalOffset.x,
          y: moveAnchorStartBounds.top + totalOffset.y
        };
        // Step 2f: vertex-else-grid, excluding the anchor shape's own points (it must not snap to
        // itself).
        const snappedAnchorPos = resolveSnappedPoint(rawAnchorPos, moveAnchorShapeId);
        const snappedTotalOffset = {
          x: snappedAnchorPos.x - moveAnchorStartBounds.left,
          y: snappedAnchorPos.y - moveAnchorStartBounds.top
        };
        const incrementalDelta = new paper.Point(
          snappedTotalOffset.x - moveAppliedOffset.x,
          snappedTotalOffset.y - moveAppliedOffset.y
        );
        for (const id of selectedIds) {
          const shape = board.getShape(id);
          if (shape) shape.item.translate(incrementalDelta);
          // RS-3011 Step 3b: a move never changes the shape's own contour, so its stone Group only
          // ever needs the same cheap incremental translate() the shape's own item just got -- never
          // a full rebuild (see rebuildStoneGroupForShape's own >10x cost difference, confirmed by
          // the RS-3011 Step 3b spike). Applied live, every drag frame, not just at drag-end.
          const stoneGroup = stoneGroups.get(id);
          if (stoneGroup) stoneGroup.translate(incrementalDelta);
        }
        moveAppliedOffset = snappedTotalOffset;
        updateResizeHandles();
        return;
      }
      if (interactionKind === 'moveRegion') {
        // RS-3013 Step 2: live preview only -- translates the persistent selection-outline overlay
        // directly by this frame's own incremental delta, same "translate the live Paper.js item,
        // don't rebuild geometry every frame" pattern the 'move' branch above uses for a shape drag.
        // No hit-test, no snapping, no project.layers read -- those only happen once, at mouseup.
        if (activeSelectionItem) activeSelectionItem.translate(event.delta);
        return;
      }
      if (interactionKind === 'resize') {
        const shape = board.getShape(resizeShapeId);
        if (!shape) return;
        // RS-3010 Step 2e: resize already uses absolute event.point (not a delta), so snapping it
        // once up front is enough -- the assignments below just consume the snapped version.
        // Step 2f: vertex-else-grid, excluding the resized shape's own points.
        const snappedPoint = resolveSnappedPoint(event.point, resizeShapeId);
        if (!resizeRotationDeg0) {
          // Byte-identical to before RS-3034 for every unrotated shape -- the overwhelming majority
          // case (see this milestone's own most important invariant).
          let x0 = resizeStartBounds.left;
          let y0 = resizeStartBounds.top;
          let x1 = resizeStartBounds.right;
          let y1 = resizeStartBounds.bottom;
          if (resizeHandle.includes('w')) x0 = snappedPoint.x;
          if (resizeHandle.includes('e')) x1 = snappedPoint.x;
          if (resizeHandle.includes('n')) y0 = snappedPoint.y;
          if (resizeHandle.includes('s')) y1 = snappedPoint.y;
          const width = Math.max(RESIZE_MIN_DIM_MM, Math.abs(x1 - x0));
          const height = Math.max(RESIZE_MIN_DIM_MM, Math.abs(y1 - y0));
          shape.item.bounds = new paper.Rectangle(Math.min(x0, x1), Math.min(y0, y1), width, height);
        } else {
          // RS-3034: rotated resize -- local-axis math ported from app.js's own RS-3030 algorithm
          // (see this milestone's own doc for the full derivation). Inverse-rotates the snapped
          // pointer's offset from the fixed anchor (resizeAnchorAbs) into the shape's local,
          // unrotated axes; a corner handle resizes both dimensions from that local delta, an edge
          // handle only its one relevant dimension (resizeHandleOffset); the new center sits the new
          // local half-extent (signed by the dragged handle's own unit offset) away from the anchor,
          // rotated forward back into absolute space.
          const local = rotatePointDeg(
            snappedPoint.x - resizeAnchorAbs.x, snappedPoint.y - resizeAnchorAbs.y,
            0, 0, -resizeRotationDeg0
          );
          let newW = resizeStartBounds.width;
          let newH = resizeStartBounds.height;
          if (resizeHandleOffset.x !== 0) newW = Math.max(RESIZE_MIN_DIM_MM, Math.abs(local.x));
          if (resizeHandleOffset.y !== 0) newH = Math.max(RESIZE_MIN_DIM_MM, Math.abs(local.y));
          const centerOffset = rotatePointDeg(
            resizeHandleOffset.x * newW / 2, resizeHandleOffset.y * newH / 2,
            0, 0, resizeRotationDeg0
          );
          const newCx = resizeAnchorAbs.x + centerOffset.x;
          const newCy = resizeAnchorAbs.y + centerOffset.y;
          // Un-rotate the live item back to its current local box -- the exact inverse of the
          // rotate it was last placed with, around the SAME pivot (resizePivot, tracked frame to
          // frame below) -- then rescale in local axes via the ordinary axis-aligned bounds=
          // assignment (safe now that the item is momentarily unrotated), then rotate back into
          // place around the new pivot. This is what makes the shape visibly grow along its own
          // tilted axes every frame, unlike the naive axis-aligned stretch the branch above uses.
          shape.item.rotate(-resizeRotationDeg0, resizePivot);
          shape.item.bounds = new paper.Rectangle(newCx - newW / 2, newCy - newH / 2, newW, newH);
          resizePivot = new paper.Point(newCx, newCy);
          shape.item.rotate(resizeRotationDeg0, resizePivot);
          shape.item.data.pivotXMm = newCx;
          shape.item.data.pivotYMm = newCy;
        }
        updateResizeHandles();
        // RS-3011 Step 3b: a resize genuinely changes the contour, so (unlike move) this needs a
        // full rebuild -- throttled to one per animation frame rather than once per mousemove event,
        // via the same requestAnimationFrame + dedup-flag pattern as Preview3DRenderer.js's
        // _requestRender() (see scheduleStoneRebuildForShape's own doc comment).
        scheduleStoneRebuildForShape(resizeShapeId);
        return;
      }
      if (interactionKind === 'rotate') {
        const shape = board.getShape(rotateShapeId);
        if (!shape) return;
        // Same clockwise-from-up atan2(dx,-dy) convention/formula as app.js's own rotate-drag,
        // applied to THIS pointer position relative to the same rotateCenter captured at drag-start.
        const vector = event.point.subtract(rotateCenter);
        const pointerAngleDeg = Math.atan2(vector.x, -vector.y) * 180 / Math.PI;
        let rotationDeg = rotateStartRotationDeg + (pointerAngleDeg - rotateStartPointerAngleDeg);
        // Shift snaps to 15deg steps, same ROTATION_SNAP_STEP_DEG/Math.round convention app.js's own
        // rotate-drag uses.
        if (event.modifiers.shift) rotationDeg = Math.round(rotationDeg / ROTATION_SNAP_STEP_DEG) * ROTATION_SNAP_STEP_DEG;
        // item.rotate() takes an INCREMENTAL angle (verified: repeated small calls around the SAME
        // fixed center sum exactly to one equivalent large call, see this milestone's own doc) --
        // rotateAppliedDeg tracks the total already applied to the live item so far this drag, so
        // only the DIFFERENCE still owed this frame is applied, never the full absolute angle twice.
        const desiredAppliedDeg = rotationDeg - rotateStartRotationDeg;
        const incrementDeg = desiredAppliedDeg - rotateAppliedDeg;
        shape.item.rotate(incrementDeg, rotateCenter);
        rotateAppliedDeg = desiredAppliedDeg;
        updateResizeHandles();
        return;
      }
      if (interactionKind === 'pen') {
        // RS-3011 Step 9: pulls a symmetric curve handle on the anchor just placed at this drag's
        // mousedown, by directly mutating that real Segment's handleOut/handleIn -- Paper.js
        // redraws the live curve automatically (confirmed against paper-core.js: these are normal
        // property setters that trigger the same change/redraw pipeline this file already relies on
        // elsewhere, e.g. item.strokeColor =). No discard-and-recreate needed here, unlike rect/
        // ellipse/slot/marquee below: those rebuild every frame because their entire shape changes
        // frame to frame, not because mutating a live segment is unsafe.
        if (penDraggingSegment && !penDragForceCorner) {
          const delta = event.point.subtract(penDragOrigin);
          // Latches once crossed rather than re-checking every frame: dragging back toward the
          // anchor mid-drag (without releasing) must shrink the handle back down, not freeze it at
          // whatever it last reached while still above the threshold.
          if (!penDragCrossedDeadZone && delta.length >= PEN_DRAG_DEAD_ZONE_MM) {
            penDragCrossedDeadZone = true;
          }
          if (penDragCrossedDeadZone) {
            // RS-3011 Step 9 revision: a closing drag shapes only the closing segment's incoming
            // curve (handleIn on the FIRST anchor) -- it must never touch that anchor's own
            // handleOut, which already shapes the ORIGINAL first segment (anchor 1->2) and was set
            // back when anchor 1 was first placed.
            if (penClosingDrag) {
              penDraggingSegment.handleIn = delta.negate();
            } else {
              penDraggingSegment.handleOut = delta;
              penDraggingSegment.handleIn = delta.negate();
            }
            // RS-3011 Step 9 follow-up: rebuilt every frame while a handle is actively being pulled,
            // same discard-and-recreate cost tradeoff rect/ellipse/slot/marquee's own drag previews
            // below already accept.
            rebuildPenHandleChromeItem();
          }
        }
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
      if (interactionKind === 'selectRect') {
        // RS-3013 Step 1: marqueeItem's own twin, same discard-and-recreate-per-frame pattern, but
        // dashed/unfilled (STROKE_COLOR/PAINT_LASSO_DASH_PX, matching Lasso's own dashed preview
        // below) rather than marquee's solid semi-transparent fill -- this gesture resolves to a
        // region-style selection, not a multi-select box, and must not read as one.
        if (selectRectItem) selectRectItem.remove();
        const box = resolveDragBox(dragStart, event.point);
        const rect = new paper.Rectangle(box.left, box.top, box.width, box.height);
        selectRectItem = new paper.Path.Rectangle(rect);
        selectRectItem.strokeColor = STROKE_COLOR;
        selectRectItem.strokeWidth = STROKE_WIDTH_PX / paper.view.zoom;
        selectRectItem.dashArray = [PAINT_LASSO_DASH_PX / paper.view.zoom, PAINT_LASSO_DASH_PX / paper.view.zoom];
        return;
      }
      if (interactionKind === 'paint') {
        // RS-3011 Step 10b: only samples a new point once the pointer has moved past
        // PAINT_MIN_SAMPLE_DISTANCE_PX since the last one, avoiding a point per pointermove event
        // (see that constant's own doc comment). Rebuilds paintLassoItem's segments from the full
        // accumulated point list every time a point is actually added -- adapted from
        // marqueeItem's own discard-and-recreate-per-frame convention just above, but on the
        // accumulated polyline rather than a fresh 2-point rectangle each frame.
        const lastPoint = paintLassoPoints[paintLassoPoints.length - 1];
        if (event.point.getDistance(lastPoint) >= PAINT_MIN_SAMPLE_DISTANCE_PX / paper.view.zoom) {
          paintLassoPoints.push(event.point);
          paintLassoItem.removeSegments();
          paintLassoItem.addSegments(paintLassoPoints.map((p) => new paper.Segment(p)));
        }
        return;
      }
      if (interactionKind === 'lasso') {
        // RS-3013 Step 1: same point-sampling/rebuild pattern as Paint's own branch just above,
        // reusing the identical PAINT_MIN_SAMPLE_DISTANCE_PX throttle (not a second constant).
        const lastPoint = lassoPoints[lassoPoints.length - 1];
        if (event.point.getDistance(lastPoint) >= PAINT_MIN_SAMPLE_DISTANCE_PX / paper.view.zoom) {
          lassoPoints.push(event.point);
          lassoItem.removeSegments();
          lassoItem.addSegments(lassoPoints.map((p) => new paper.Segment(p)));
        }
        return;
      }
      if (interactionKind === 'trace') {
        // RS-3011 Step 11: same discard-and-recreate-from-accumulated-points pattern as Paint's own
        // branch just above, but thinned against TRACE_MIN_SAMPLE_DISTANCE_MM -- a plain project-mm
        // distance, not divided by zoom (see that constant's own doc comment for why this
        // deliberately doesn't follow PAINT_MIN_SAMPLE_DISTANCE_PX's own px-to-mm conversion).
        const lastPoint = tracePoints[tracePoints.length - 1];
        if (event.point.getDistance(lastPoint) >= TRACE_MIN_SAMPLE_DISTANCE_MM) {
          tracePoints.push(event.point);
          traceItem.removeSegments();
          traceItem.addSegments(tracePoints.map((p) => new paper.Segment(p)));
        }
        return;
      }
      if (interactionKind === 'eraser') {
        // RS-3011 Step 13: same discard-and-recreate-from-accumulated-points pattern as Trace's own
        // branch just above, thinned against the SAME TRACE_MIN_SAMPLE_DISTANCE_MM constant
        // (decision 5: reuse verbatim, no second thinning constant).
        const lastPoint = erasePoints[erasePoints.length - 1];
        if (event.point.getDistance(lastPoint) >= TRACE_MIN_SAMPLE_DISTANCE_MM) {
          erasePoints.push(event.point);
          eraseItem.removeSegments();
          eraseItem.addSegments(erasePoints.map((p) => new paper.Segment(p)));
          eraseItem.strokeWidth = eraserRadiusMm * 2;
        }
        return;
      }
      if (interactionKind !== 'draw') return;
      if (mode === 'freehand') {
        if (!dragging || !board.path) return;
        board.path.add(event.point);
        return;
      }
      if (mode === 'slot') {
        // Step 2f: Shift constrains the axis direction to a 15-degree multiple first (keeping
        // distance from dragStart). Step 2f correction: the constrained result then resolves
        // through vertex-snap-or-as-is (resolveAngleSnappedPoint), NOT vertex-else-grid --
        // grid-snap rounds x/y independently and does not preserve an arbitrary angle (see that
        // function's own doc comment). Without Shift, behavior is unchanged: plain vertex-else-grid.
        const snappedPoint = event.modifiers.shift
          ? resolveAngleSnappedPoint(snapAngle(dragStart, event.point, ROTATION_SNAP_STEP_DEG), null)
          : resolveSnappedPoint(event.point, null);
        const { a, b } = resolveDragAxis(dragStart, snappedPoint);
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
      // RS-3010 Step 2e: snap AFTER Shift-constrain, not before -- constrainSquare must operate on
      // the raw drag point to produce a mathematically exact square/circle; snapping first would
      // let the two axes round to slightly different magnitudes before constraining.
      const current = event.modifiers.shift ? constrainSquare(dragStart, event.point) : event.point;
      // Step 2f: vertex-else-grid -- rect/ellipse have no "direction" concept, so no angle-snap
      // here (Shift already means square/circle-constrain for this mode, per Context).
      const snappedCurrent = resolveSnappedPoint(current, null);
      const box = resolveDragBox(dragStart, snappedCurrent);
      board.clearPath();
      const rect = new paper.Rectangle(box.left, box.top, box.width, box.height);
      const previewItem = mode === 'rect' ? new paper.Path.Rectangle(rect) : new paper.Path.Ellipse(rect);
      previewItem.strokeColor = STROKE_COLOR;
      previewItem.strokeWidth = STROKE_WIDTH_PX / paper.view.zoom;
      board.beginPath(previewItem);
    };

    // RS-3011 Step 11: gains an `event` parameter (Paper.js's Tool.onMouseUp always receives a
    // ToolEvent; earlier steps just never declared it) so Trace's own branch below can read
    // `event.modifiers.shift` at release, the same modifier-reading convention onMouseDown already
    // uses throughout this file. Every other branch below still ignores it.
    tool.onMouseUp = (event) => {
      if (panning) {
        panning = false;
        updateCursor();
        return;
      }
      if (interactionKind === 'move') {
        // RS-3011 Step 1 write-through fix: moveAppliedOffset is the total snapped delta every
        // selected shape received this drag (onMouseDrag's 'move' branch applies the identical
        // incrementalDelta to each id in `selectedIds` every frame, preserving relative positions)
        // -- so the same (dx,dy) is correct for each already-committed shape in the group. Skipped
        // entirely for a zero-offset mousedown+mouseup (a plain click with no drag), which must not
        // manufacture an empty undo step.
        if (moveAppliedOffset && (moveAppliedOffset.x !== 0 || moveAppliedOffset.y !== 0)) {
          for (const id of selectedIds) {
            const shape = board.getShape(id);
            const layerId = shape && shape.item.data.layerId;
            if (layerId) onShapeMoved(layerId, moveAppliedOffset.x, moveAppliedOffset.y);
          }
        } else {
          // RS-3013 Step 1: a genuine zero-offset click on a shape -- re-resolve it through the SAME
          // click-decision function Lasso's own click path uses (performClickDispatch), so a region
          // under this exact point (checked FIRST by that function) can override the shape-selection
          // mousedown already applied speculatively above. Idempotent for the shape case itself
          // (mousedown already selected/preserved-the-group; `!selectedIds.has(hitId)` is now false,
          // so this just re-notifies) -- the only NEW outcome here is the region override.
          performClickDispatch(event.point, false);
        }
        interactionKind = null;
        moveStartPoint = null;
        moveAnchorShapeId = null;
        moveAnchorStartBounds = null;
        moveAppliedOffset = null;
        return;
      }
      if (interactionKind === 'moveRegion') {
        // RS-3013 Step 2: total offset since mousedown -- exact-zero check (not a MIN_BOX_DIM_MM-style
        // tolerance) mirrors the 'move' branch's own moveAppliedOffset.x/y !== 0 check above: Paper.js
        // never fires onMouseDrag at all for a true click (zero net pointer movement), so event.point
        // still equals dragStart exactly in that case.
        const dxMm = event.point.x - dragStart.x;
        const dyMm = event.point.y - dragStart.y;
        const layerId = activeSelection && activeSelection.layerId;
        const regionId = activeSelection && activeSelection.regionId;
        interactionKind = null;
        if (dxMm === 0 && dyMm === 0) {
          // A genuine zero-offset click -- re-resolve through the SAME click-decision function
          // Select/Lasso's own plain clicks use, mirroring the 'move' branch's own zero-offset
          // handling just above.
          performClickDispatch(event.point, false);
          return;
        }
        openHistorySession();
        const updatedPolygon = onRegionMoved(layerId, regionId, dxMm, dyMm);
        closeHistorySession();
        if (updatedPolygon) {
          // Authoritative rebuild from the freshly-committed natural-space contour -- never from
          // wherever onMouseDrag's own live per-frame translate left activeSelectionItem, so the two
          // can never drift apart, even by float error (this function's own hooks-param doc comment).
          setActiveSelection({ kind: 'region', layerId, regionId }, [updatedPolygon]);
        } else {
          setActiveSelection(null);
        }
        return;
      }
      if (interactionKind === 'resize') {
        // RS-3011 Step 1 write-through fix: read the resized item's final bounds before clearing
        // resizeShapeId/resizeStartBounds below -- onMouseDrag's 'resize' branch already applied
        // every intermediate bounds change directly to the Paper.js item, so this is simply its
        // current state. Skipped if unchanged from resizeStartBounds (a handle click with no drag).
        const shape = board.getShape(resizeShapeId);
        const layerId = shape && shape.item.data.layerId;
        if (layerId && shape) {
          // RS-3034: the LOCAL unrotated box (not shape.item.bounds directly, which for a rotated
          // shape is the enclosing AABB of the tilted outline, not the box onShapeResized's own
          // contract expects) -- app.js writes this straight into l.x/y/w/h, the SAME unrotated
          // local box materializeShapeFromLayer()/GeometryEngine's own rotation step both pivot
          // around. resizeStartBounds is the same kind of box (see its own snapshot comment above),
          // so this stays an apples-to-apples comparison, byte-identical to before for an unrotated
          // shape (unrotatedLocalBoundsFor()'s own fast path).
          const b = unrotatedLocalBoundsFor(shape.item);
          const changed =
            !resizeStartBounds ||
            Math.abs(b.left - resizeStartBounds.left) > 1e-6 ||
            Math.abs(b.top - resizeStartBounds.top) > 1e-6 ||
            Math.abs(b.width - resizeStartBounds.width) > 1e-6 ||
            Math.abs(b.height - resizeStartBounds.height) > 1e-6;
          if (changed) onShapeResized(layerId, { left: b.left, top: b.top, width: b.width, height: b.height });
        }
        // RS-3011 resize-perf fix: clear interactionKind/resizeShapeId BEFORE the final rebuild
        // below, so rebuildStoneGroupForShape()'s own hide-check (which re-hides the Group while
        // this shape's resize is in progress) sees the drag as already over and leaves the final
        // Group's default visible=true alone.
        const finishedShapeId = resizeShapeId;
        interactionKind = null;
        resizeHandle = null;
        resizeShapeId = null;
        resizeStartBounds = null;
        resizeRotationDeg0 = 0;
        resizeAnchorAbs = null;
        resizeHandleOffset = null;
        resizePivot = null;
        // RS-3011 Step 3b: an explicit, unthrottled final rebuild -- the last onMouseDrag frame's
        // scheduleStoneRebuildForShape() call may still be a pending requestAnimationFrame callback
        // at this point (still correctly targeted at this shapeId either way, see that function's
        // own doc comment), but this guarantees the stone Group reflects the shape's exact final
        // bounds immediately, rather than waiting for that frame to fire.
        if (shape) rebuildStoneGroupForShape(finishedShapeId);
        // RS-3011 resize-perf fix: belt-and-suspenders restore in case `shape` was falsy above (the
        // shape vanished mid-drag) and no rebuild ran -- a stale hidden Group from drag-start must
        // never stay invisible.
        const finalGroup = stoneGroups.get(finishedShapeId);
        if (finalGroup) finalGroup.visible = true;
        return;
      }
      if (interactionKind === 'rotate') {
        // RS-3033: mirrors the 'resize' branch's own write-through convention exactly -- read the
        // final applied rotation before clearing rotate state, fire the ONE onShapeRotated() hook
        // call for this completed drag (skipped for a zero-delta click, mirroring onShapeMoved's own
        // "don't manufacture an empty undo step" guard), then restore the stone Group's visibility
        // and force one final, authoritative rebuild.
        const shape = board.getShape(rotateShapeId);
        const layerId = shape && shape.item.data.layerId;
        if (layerId && shape && Math.abs(rotateAppliedDeg) > 1e-6) {
          const finalRotationDeg = ((rotateStartRotationDeg + rotateAppliedDeg) % 360 + 360) % 360;
          onShapeRotated(layerId, finalRotationDeg);
        }
        // Same ordering rationale as the 'resize' branch above: clear interactionKind/rotateShapeId
        // BEFORE the final rebuild, so rebuildStoneGroupForShape() sees the drag as already over.
        const finishedShapeId = rotateShapeId;
        interactionKind = null;
        rotateShapeId = null;
        rotateCenter = null;
        rotateStartPointerAngleDeg = 0;
        rotateStartRotationDeg = 0;
        rotateAppliedDeg = 0;
        // RS-3033: safe to call unconditionally, even for a rotated shape -- rebuildStoneGroupForShape()
        // now uses the layer's own STATIC box (not this possibly-still-mid-rotation live item's own
        // AABB) whenever rotationDeg is nonzero (see that function's own comment), so this always
        // produces the correct, fully-rotated stone Group regardless of exactly when it runs relative
        // to onShapeRotated()'s own async updateAll()/syncFromProjectLayers() reconciliation.
        if (shape) rebuildStoneGroupForShape(finishedShapeId);
        // Belt-and-suspenders restore, same as the 'resize' branch above.
        const finalGroup = stoneGroups.get(finishedShapeId);
        if (finalGroup) finalGroup.visible = true;
        return;
      }
      if (interactionKind === 'pen') {
        // RS-3011 Step 9 revision: a closing drag finalizes HERE (once its handle-shaping drag
        // ends), not in onMouseDown -- closing is now itself a drag-shapeable gesture like any
        // other anchor. An ordinary (non-closing) drag still just ends this anchor's handle-drag;
        // the path stays in progress until a qualifying closing click/drag in onMouseDown (or
        // Escape, via resetInProgressDrawing()).
        if (penClosingDrag) {
          board.path.closed = true;
          const item = board.path;
          board.finalizeShape();
          commitFinalizedShape(item);
          resetInProgressDrawing();
          return;
        }
        penDraggingSegment = null;
        penDragOrigin = null;
        penDragForceCorner = false;
        penDragCrossedDeadZone = false;
        penClosingDrag = false;
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
            notifySelectionChanged();
          }
        }
        if (marqueeItem) {
          marqueeItem.remove();
          marqueeItem = null;
        }
        interactionKind = null;
        return;
      }
      if (interactionKind === 'selectRect') {
        // RS-3013 Step 1: marqueeItem's own twin mouseup, same "below MIN_BOX_DIM_MM is just a
        // click, already handled by onMouseDown's own empty-canvas clear" precedent. A real
        // rectangle resolves its target shape via resolveSelectionTarget() -- the SAME
        // selectPaintTarget() two-pass resolution Lasso's own drag uses (app.js's shared
        // resolvePaintTargetTwoPass()) -- but, unlike Lasso, stores the RECTANGLE exactly as drawn
        // (this milestone's own decided asymmetry: Lasso always clips at creation, Select's
        // rectangle never does; GeometryEngine's own _applyPathRegions() shapePolygons filter
        // already keeps any future stone generation from a stored region inside its shape's current
        // outline regardless, so this is safe without new clipping code here). No target -> discard
        // silently, matching Paint/Lasso's own "no target -> discard" precedent.
        if (
          selectRectItem &&
          selectRectItem.bounds.width > MIN_BOX_DIM_MM &&
          selectRectItem.bounds.height > MIN_BOX_DIM_MM
        ) {
          const b = selectRectItem.bounds;
          const rectPolygon = [
            { xMm: b.left, yMm: b.top },
            { xMm: b.right, yMm: b.top },
            { xMm: b.right, yMm: b.bottom },
            { xMm: b.left, yMm: b.bottom }
          ];
          const resolved = resolveSelectionTarget([rectPolygon]);
          // Bugfix: the {precisionError:true} sentinel (see this function's own hooks-param doc
          // comment) DID overlap a candidate but couldn't resolve at a safe precision -- distinct
          // from both a real target and a genuine no-overlap null, so it gets its own hook rather
          // than falling through to the silent-discard branch below.
          if (resolved && resolved.precisionError) {
            onSelectionTargetPrecisionError();
          } else if (resolved) {
            if (selectedIds.size) {
              selectedIds = clearSelection();
              applySelectionVisuals();
              updateResizeHandles();
              notifySelectionChanged();
            }
            setActiveSelection(
              {
                kind: 'draft',
                layerId: resolved.layerId,
                shapeKind: 'rect',
                boundsOrContour: { left: b.left, top: b.top, width: b.width, height: b.height }
              },
              [rectPolygon]
            );
          }
        }
        if (selectRectItem) {
          selectRectItem.remove();
          selectRectItem = null;
        }
        interactionKind = null;
        return;
      }
      if (interactionKind === 'paint') {
        if (paintLassoItem) {
          paintLassoItem.remove();
          paintLassoItem = null;
        }
        // A lasso below PAINT_MIN_LASSO_POINTS never produced a usable stroke (mirrors freehand's
        // own < 2 segment discard just below) -- discarded with no hook call and no history entry,
        // matching this file's existing "no usable stroke" precedent (see PAINT_MIN_LASSO_POINTS'
        // own doc comment / src/drawing/DrawingCanvasTool.js:67's original citation of the same
        // rule). `mode` is deliberately left as 'paint' here, same as freehand's own discard leaves
        // `mode` at 'freehand' -- a degenerate gesture never counts as "a shape finalized."
        if (paintLassoPoints.length < PAINT_MIN_LASSO_POINTS) {
          paintLassoPoints = [];
          interactionKind = null;
          return;
        }
        const lassoPolygons = [paintLassoPoints.map((p) => ({ xMm: p.x, yMm: p.y }))];
        paintLassoPoints = [];
        // RS-3011 issue #4a precedent (commitFinalizedShape()), applied to Paint: a finalized lasso
        // is no longer "still drawing" even though Paint never creates a board.shapes item of its
        // own -- revert to select mode BEFORE calling the hook, so the mode getter already reports
        // 'select' by the time app.js reacts and syncs the rail buttons' aria-pressed state (same
        // ordering commitFinalizedShape() uses for every other tool).
        mode = 'select';
        interactionKind = null;
        updateResizeHandles();
        updateCursor();
        onPaintStroke(lassoPolygons);
        return;
      }
      if (interactionKind === 'lasso') {
        // Bugfix (click-vs-drag distance): captured BEFORE lassoItem.remove() below, since
        // paper.Path#bounds stops being readable once the item is removed. lassoItem's segments are
        // kept in sync with lassoPoints on every sampled onMouseDrag point (see that handler above),
        // so its own bounds is already the buffered points' bounding box with no separate pairwise-
        // distance computation needed -- same source datapoints, just read via the Path that already
        // tracks them, rather than reimplementing a second bbox walk over lassoPoints by hand.
        const lassoBounds = lassoItem ? lassoItem.bounds : null;
        if (lassoItem) {
          lassoItem.remove();
          lassoItem = null;
        }
        // RS-3013 Step 1 / Bugfix: a lasso whose buffered points' bounding box is at or below
        // MIN_BOX_DIM_MM in either dimension is NOT "no usable stroke" the way Paint's own
        // PAINT_MIN_LASSO_POINTS point-count check discards it -- it's basically a click, so it
        // resolves through the SAME click-decision function Select's own click path uses
        // (performClickDispatch), on the release point (mousedown never hit-tested anything for
        // Lasso, unlike Select -- see this file's own onMouseDown 'lasso' branch comment). `mode` is
        // deliberately left at 'lasso' either way (both the click case and the real-stroke case
        // below) -- it's a repeated tool, same "stays active" precedent as Stamp/Trace/Eraser
        // (CLICK_TO_PLACE_MODES), not a one-shot preset that reverts to Select on commit.
        //
        // Bugfix: this used to be `lassoPoints.length < PAINT_MIN_LASSO_POINTS`, the same point-count
        // check Paint's own branch still uses. Point count is the wrong signal here: onMouseDrag only
        // pushes a new point once the pointer has moved PAINT_MIN_SAMPLE_DISTANCE_PX since the last
        // one, so a fast/short drag can legitimately cover real screen distance while buffering fewer
        // than PAINT_MIN_LASSO_POINTS points (silently falling through to performClickDispatch()
        // instead of ever creating a draft selection), while a slow tiny wobble can rack up 3+ points
        // while barely moving at all. A bounding-box distance check on the buffered points themselves
        // (reusing MIN_BOX_DIM_MM, the same threshold/comparison style Select's own selectRectItem
        // check above already uses) reflects actual gesture distance instead. Scoped to Lasso only --
        // Paint's own identical-looking check just above is deliberately left untouched.
        if (!lassoBounds || lassoBounds.width <= MIN_BOX_DIM_MM || lassoBounds.height <= MIN_BOX_DIM_MM) {
          lassoPoints = [];
          interactionKind = null;
          performClickDispatch(event.point, false);
          return;
        }
        const lassoPolygons = [lassoPoints.map((p) => ({ xMm: p.x, yMm: p.y }))];
        lassoPoints = [];
        interactionKind = null;
        // RS-3013 Step 1: the EXACT SAME selectPaintTarget() two-pass resolution Paint's own
        // onPaintStroke uses (app.js's shared resolvePaintTargetTwoPass()) -- but unlike Paint, the
        // result becomes a transient activeSelection draft, never a real region (see this
        // milestone's own architecture note: region creation stays Paint's job alone). No target ->
        // discard silently, matching Paint's own "no target -> discard" precedent -- any shape
        // multi-selection cleared at mousedown stays cleared either way.
        const resolved = resolveSelectionTarget(lassoPolygons);
        // Bugfix: the {precisionError:true} sentinel (see this function's own hooks-param doc
        // comment) DID overlap a candidate but couldn't resolve at a safe precision -- distinct
        // from both a real target and a genuine no-overlap null, so it gets its own hook rather
        // than falling through to the silent-discard branch below.
        if (resolved && resolved.precisionError) {
          onSelectionTargetPrecisionError();
        } else if (resolved) {
          if (selectedIds.size) {
            selectedIds = clearSelection();
            applySelectionVisuals();
            updateResizeHandles();
            notifySelectionChanged();
          }
          setActiveSelection(
            { kind: 'draft', layerId: resolved.layerId, shapeKind: 'lasso', boundsOrContour: resolved.contours },
            resolved.contours
          );
        }
        return;
      }
      if (interactionKind === 'trace') {
        // RS-3011 Step 11: mirrors Paint's own branch just above -- remove the dashed preview,
        // discard a degenerate drag (fewer than 2 buffered points can't build a usable path), else
        // resolve the target and hand the spaced points to onTracePlace(). Unlike Paint/every other
        // draw preset, `mode` is deliberately left at 'trace' (decision 7: Trace stays active after
        // each committed line), so there's no mode='select'/updateDrawToolButtons() dance here --
        // matches Stamp's own onMouseDown 'stamp' branch precedent.
        if (traceItem) {
          traceItem.remove();
          traceItem = null;
        }
        const points = tracePoints;
        tracePoints = [];
        interactionKind = null;
        if (points.length < 2) return;
        const closed = !!(event && event.modifiers && event.modifiers.shift);
        const layerId = resolveTraceTargetLayerId(points);
        const styleParams = layerId ? getLayerStoneParams(layerId) : null;
        // No target, or the resolved layer isn't a stone-bearing 'path' layer (getLayerStoneParams's
        // own null return already covers both "not type==='path'" and "stonesGenerated===false") --
        // discard silently, matching Stamp/Paint's own "no target -> discard" precedent. RS-3014
        // Step 1: styleParams itself is now ONLY that existence gate -- the actual spacing comes
        // from Trace's own independent traceSizeMm/traceGapMm (set via setTraceStyle()), not the
        // target layer's current stoneSize/gap.
        if (!layerId || !styleParams) return;
        const stepMm = traceSizeMm + traceGapMm;
        const spacingPath = new paper.Path({ segments: points });
        if (closed) spacingPath.closed = true;
        const placements = placeStonesAlongPath(spacingPath, { stepMm, closed });
        spacingPath.remove();
        if (placements.length === 0) return;
        // RS-3012 Step 1: per-point filter against the active selection's own boundary, mirroring
        // this codebase's existing self-clip philosophy (a region move/boundary-cross doesn't reject
        // a whole gesture either) -- points inside stay, points outside are dropped, never an
        // all-or-nothing rejection UNLESS every point was dropped (nothing left to place at all). No
        // constraint at all when activeSelection is null, byte-identical to before this step.
        if (activeSelection) {
          const filteredPlacements = placements.filter((p) => isPointInActiveSelection(p, activeSelection));
          if (filteredPlacements.length === 0) {
            onTraceRejected();
            return;
          }
          onTracePlace(filteredPlacements, layerId, placements.length - filteredPlacements.length);
          return;
        }
        onTracePlace(placements, layerId);
        return;
      }
      if (interactionKind === 'eraser') {
        // RS-3011 Step 13: mirrors Trace's own branch just above, but a plain click IS a usable
        // gesture here (decision 5: "click = one daub at the click point") -- unlike Trace, there's
        // no placeStonesAlongPath() spacing pass; every buffered point becomes one daub verbatim,
        // handed to app.js's onEraseSweep() as-is (this module has no opinion on daub radius, see
        // the onEraseSweep hook's own doc comment). RS-3014 Step 5: target resolution uses
        // resolveEraserTargetLayerId() (per-point, first-match-wins), NOT resolveTraceTargetLayerId()
        // -- see that function's own doc comment for why Eraser's edge-hugging-drag use case needs
        // per-point resolution instead of Trace's single-aggregate-center approach. Unlike
        // Paint/every other draw preset, `mode` is deliberately left at 'eraser' (decision 7:
        // Eraser stays active after each committed sweep), so there's no
        // mode='select'/updateDrawToolButtons() dance here -- matches Stamp/Trace's own precedent.
        if (eraseItem) {
          eraseItem.remove();
          eraseItem = null;
        }
        const points = erasePoints;
        erasePoints = [];
        interactionKind = null;
        if (points.length === 0) return;
        const layerId = resolveEraserTargetLayerId(points);
        // No target -> discard the WHOLE gesture silently (decision 6), matching Stamp/Paint/
        // Trace's own "no target -> discard" precedent.
        if (!layerId) return;
        const daubsAbsoluteMm = points.map((p) => ({ xMm: p.x, yMm: p.y }));
        // RS-3014 Step 3: corridor polygon(s) for Outline mode -- see buildEraserCorridorPolygons()'s
        // own doc comment. Built unconditionally (cheap, and 'stones' gestures simply ignore it) so
        // app.js never needs a second code path to request it after the fact.
        const corridorPolygonsAbsoluteMm = buildEraserCorridorPolygons(points, eraserRadiusMm);
        const gestureMode = activeEraserMode;
        onEraseSweep(daubsAbsoluteMm, layerId, corridorPolygonsAbsoluteMm, gestureMode);
        return;
      }
      if (interactionKind !== 'draw') return;
      dragging = false;
      if (mode === 'freehand') {
        // A pointerdown+up with no drag between them never produced a usable stroke (a single
        // segment) -- discard it rather than leaving a degenerate path commitFinalizedShape()
        // would reject anyway (flattenPathToContour()'s own <3-point guard).
        if (board.path && board.path.segments.length >= 2) {
          const item = board.path;
          // RS-3011 freehand-close: ending the drag back near its own start point closes the
          // shape, the same "click near the first anchor closes" gesture Pen/Polygon already
          // have (see the CLOSE_POLYGON_TOLERANCE_PX / paper.view.zoom check above) -- reused
          // verbatim rather than introducing a second tolerance constant. onMouseUp's own `event`
          // parameter (added for Trace's Shift-at-release check, RS-3011 Step 11) is deliberately
          // unused here -- the drag's ending point is read off the path's own last segment -- the
          // exact point the final onMouseDrag frame added -- instead of `event.point`.
          const lastPoint = item.segments[item.segments.length - 1].point;
          if (lastPoint.getDistance(item.segments[0].point) <= CLOSE_POLYGON_TOLERANCE_PX / paper.view.zoom) {
            item.closed = true;
          }
          item.simplify(SIMPLIFY_TOLERANCE_MM);
          board.finalizeShape();
          commitFinalizedShape(item);
        } else {
          board.clearPath();
        }
        // RS-3011 Step 1: closes the session openHistorySession() opened at drag-start (onMouseDown
        // above) -- runs whether the stroke finalized or was discarded, so a degenerate stroke never
        // leaves a stale open session for the next interaction to accidentally merge into.
        closeHistorySession();
      } else if (mode === 'slot') {
        // A drag preview already exists (built in onMouseDrag) -- finalize it as-is. A plain
        // click (no drag) is a deliberate default-pill placement, not a discard: build a
        // default-length horizontal pill centered on the click point.
        if (board.path) {
          const item = board.path;
          board.finalizeShape();
          commitFinalizedShape(item);
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
          commitFinalizedShape(previewItem);
        }
      } else if (
        board.path &&
        board.path.bounds.width > MIN_BOX_DIM_MM &&
        board.path.bounds.height > MIN_BOX_DIM_MM
      ) {
        const item = board.path;
        board.finalizeShape();
        commitFinalizedShape(item);
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
      // RS-3011 Step 12: Stamp's own ghost preview, between clicks -- unlike Pen/Polygon above,
      // Stamp has no in-progress gesture to gate this on (interactionKind is always null in this
      // mode), so it's gated on `mode` directly instead. See updateStampGhostItem()'s own doc
      // comment for the hit-test-and-hide-if-no-target behavior.
      if (mode === 'stamp') {
        updateStampGhostItem(event.point);
        return;
      }
      // RS-3011 Step 13: Eraser's own ghost preview, between clicks -- mirrors Stamp's own branch
      // just above exactly (interactionKind is always null in this mode too between gestures).
      if (mode === 'eraser') {
        updateEraserGhostItem(event.point);
        return;
      }
      // RS-3011 Step 9: hover preview of the tentative NEXT Pen segment, between clicks (Paper.js
      // only fires onMouseMove on button-up motion, so penDraggingSegment is always null here --
      // this can never race the drag-handle branch in onMouseDrag above). Unlike polygon below,
      // board.path already holds real committed anchors, so the preview is a separate throwaway
      // item (removePenPreviewItem()) rather than something rebuilt from board.path itself. Must
      // start from the last anchor's OWN handleOut (not a plain line) -- if the user just pulled a
      // curve handle on that anchor, the tentative next segment is already curved, and a straight
      // rubber-band here would visibly snap into a curve the instant they click.
      if (interactionKind === 'pen') {
        removePenPreviewItem();
        const last = board.path.lastSegment;
        const snapped = resolveSnappedPoint(event.point, null);
        penPreviewItem = new paper.Path({
          strokeColor: STROKE_COLOR,
          strokeWidth: STROKE_WIDTH_PX / paper.view.zoom
        });
        penPreviewItem.add(new paper.Segment(last.point, null, last.handleOut));
        penPreviewItem.add(new paper.Segment(new paper.Point(snapped.x, snapped.y)));
        penPreviewItem.data.isPenPreview = true;
        return;
      }
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
      // Step 2f: same resolvePolygonVertexPoint the eventual click uses (below, in onMouseDown) --
      // the preview and the placed vertex must never disagree for the same cursor/Shift state.
      previewItem.lineTo(resolvePolygonVertexPoint(event.point, event.modifiers.shift));
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
    /** True while a polygon is mid-placement (at least one vertex clicked, not yet closed). */
    get hasInProgressPolygon() {
      return interactionKind === 'polygon';
    },
    /** True while a Pen path is mid-placement (at least one anchor placed, not yet closed). */
    get hasInProgressPen() {
      return interactionKind === 'pen';
    },
    /**
     * RS-3013 Step 1: read-only surface of the current region/draft selection (see this module's
     * own `activeSelection` state-block doc comment for its exact shape) -- QA/automated
     * verification only, same "never used to drive any application logic" role as this file's
     * existing debugGrid/debugHitTestShapeId surface (see app.js's own window.__drawingTool
     * comment). No app.js hook exists for this yet -- nothing outside this module needs to react to
     * it in this step (no operations act on a selection yet); a later RS-3013 step adds one once
     * something does.
     */
    get activeSelection() {
      return activeSelection;
    },
    get zoom() {
      return board.zoom;
    },
    get pxPerMm() {
      return paper.view.zoom;
    },

    /**
     * @param {{width:number,height:number}} projectCanvasMm project.canvas at the moment drawing
     *   mode was entered -- fixes the base fit scale for this drawing session (matches every other
     *   viewport transform in this app in treating project.canvas as the mm reference frame).
     * @param {number} paddingPx same padding convention drawLayout() already uses (38*dpr).
     * @param {'select'|'lasso'|'freehand'|'rect'|'ellipse'|'slot'|'polygon'|'pen'|'paint'|'stamp'|'trace'|'eraser'} [initialMode]
     */
    enter(projectCanvasMm, paddingPx, initialMode = 'select') {
      canvasMm = projectCanvasMm;
      board.reset();
      // RS-3011 Step 3b: mirrors exit()'s own stoneGroups.clear() -- board.reset() above already
      // discards every board.shapes entry a stale stoneGroups key could reference, same redundant
      // belt-and-suspenders reset selectedIds/resetInProgressDrawing() below already get on both
      // enter() and exit().
      stoneGroups.clear();
      board.active = true;
      mode = initialMode;
      selectedIds = clearSelection();
      // RS-3013 Step 1: mirrors selectedIds' own reset just above -- the same belt-and-suspenders
      // reset (a stale activeSelection from a prior session must never survive into a new one).
      // Assigned directly rather than through setActiveSelection(): activeLayer.removeChildren()
      // above (re-entry) / paper.setup() (first entry) already discard any stale
      // activeSelectionItem, so there is nothing for that function's own `.remove()` to double-remove.
      activeSelection = null;
      activeSelectionItem = null;
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
     *
     * RS-3013 Step 1: also clears activeSelection, but ONLY when leaving every selection-AWARE tool
     * for a tool with no use for one -- switching among selection-aware tools (originally just Select
     * and Lasso, the "twin selection tools" per this step's own decision) leaves a region/draft
     * selection alone, matching how selectedIds already survives a Select<->Lasso switch untouched.
     * RS-3012 Step 1: Stamp and Trace joined the selection-aware set -- both now read activeSelection
     * (via isPointInActiveSelection()) to constrain where a click/drag may place a stone, so a
     * Select/Lasso selection must survive switching INTO either of them or the realistic workflow
     * ("select an area, then switch tools to place stones inside it") could never reach a non-null
     * selection at click time. Still cleared switching to any shape-creation tool (Freehand/Rect/
     * Ellipse/Slot/Polygon/Pen), Paint, or Eraser -- none of those read it.
     * @param {'select'|'lasso'|'freehand'|'rect'|'ellipse'|'slot'|'polygon'|'pen'|'paint'|'stamp'|'trace'|'eraser'} newMode
     */
    setMode(newMode) {
      const isSelectionAwareMode = (m) => m === 'select' || m === 'lasso' || m === 'stamp' || m === 'trace';
      const wasSelectionAware = isSelectionAwareMode(mode);
      const isSelectionAware = isSelectionAwareMode(newMode);
      mode = newMode;
      resetInProgressDrawing();
      if (wasSelectionAware && !isSelectionAware && activeSelection) {
        setActiveSelection(null);
      }
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
     * RS-3011 Step 13: sets Eraser's own brush radius (mm), read live by both the idle ghost
     * preview and the drag-sweep preview -- app.js calls this whenever eraserSettings.radiusMm
     * changes (session-first-entry seeding, the #eraserRadiusMm control, the '[' / ']' shortcuts).
     * Clamped at ERASER_RADIUS_FLOOR_MM, no ceiling (decision 4b); invalid input (non-numeric) is
     * ignored, keeping the last valid value -- same guard convention as setSlotWidthMm() above.
     * @param {number|string} value
     */
    setEraserRadiusMm(value) {
      const parsed = parseFloat(value);
      if (Number.isFinite(parsed)) eraserRadiusMm = Math.max(ERASER_RADIUS_FLOOR_MM, parsed);
    },

    /**
     * RS-3014 Step 3: sets Eraser's own mode ('stones' | 'outline') -- app.js calls this whenever
     * eraserSettings.mode changes (session-first-entry seeding, the panel toggle). Session-scoped
     * tool state, same category as eraserRadiusMm just above, not project data. Any value other
     * than the two literal strings is ignored, keeping the last valid value -- same guard
     * convention as setSlotWidthMm()/setEraserRadiusMm() above. See eraserMode's own state-block
     * doc comment for why a live gesture snapshots this at mousedown instead of tracking it live.
     * @param {'stones'|'outline'} value
     */
    setEraserMode(value) {
      if (value === 'stones' || value === 'outline') eraserMode = value;
    },

    /**
     * RS-3014 Step 1: sets Stamp's own independent size/color (mm/STONE_COLORS id), read live by
     * updateStampGhostItem()'s preview circle -- app.js calls this whenever stampSettings changes
     * (session-first-entry seeding, the #stampSizeMm/#stampColor panel fields). Each field is
     * updated independently and only when valid -- no floor/ceiling (decision: "ignore non-finite/
     * falsy values" per this milestone's own prompt), same partial-update shape as setTraceStyle()
     * below.
     * @param {{sizeMm?:number|string, color?:string}} style
     */
    setStampStyle({ sizeMm, color } = {}) {
      const parsedSize = parseFloat(sizeMm);
      if (Number.isFinite(parsedSize) && parsedSize > 0) stampSizeMm = parsedSize;
      if (color) stampColor = color;
    },

    /**
     * RS-3014 Step 1: sets Trace's own independent size/gap/color, read live by onMouseUp's 'trace'
     * branch (stepMm = traceSizeMm + traceGapMm) -- app.js calls this whenever traceSettings changes
     * (session-first-entry seeding, the #traceSizeMm/#traceGapMm/#traceColor panel fields). Mirrors
     * setStampStyle()'s own per-field partial-update shape.
     * @param {{sizeMm?:number|string, gapMm?:number|string, color?:string}} style
     */
    setTraceStyle({ sizeMm, gapMm, color } = {}) {
      const parsedSize = parseFloat(sizeMm);
      if (Number.isFinite(parsedSize) && parsedSize > 0) traceSizeMm = parsedSize;
      const parsedGap = parseFloat(gapMm);
      if (Number.isFinite(parsedGap) && parsedGap >= 0) traceGapMm = parsedGap;
      if (color) traceColor = color;
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
      // RS-3011 Step 3b: board.clearAll()/the removeChildren() call below already destroy every
      // stone Group's own Paper.js items (children of the same content layer) -- this just drops
      // the now-dangling references so they don't leak across repeated enter()/exit() cycles in the
      // same page session (board's own shapeId counter never resets, see DrawingBoard.js, so stale
      // keys here would otherwise just accumulate forever rather than colliding).
      stoneGroups.clear();
      selectedIds = clearSelection();
      // RS-3013 Step 1: mirrors selectedIds' own reset just above -- resetInProgressDrawing() below
      // deliberately leaves activeSelection/activeSelectionItem alone (see its own doc comment), so
      // exiting Design must clear them explicitly, same as it already does for selectedIds.
      if (activeSelection) setActiveSelection(null);
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
     *
     * RS-3011 Step 11: also closes a real gap for the click-to-place tools (CLICK_TO_PLACE_MODES,
     * currently Stamp and Trace) -- unlike every other draw preset, committing a placement never
     * reverts `mode` back to 'select' (decision 7: they stay active so the next click/drag places
     * another one), so Escape previously had no way to leave one of these tools at all short of
     * clicking a different rail button. `wasIdle` is captured BEFORE resetInProgressDrawing() below
     * (which unconditionally clears interactionKind back to null) -- while a gesture IS in progress
     * (Trace mid-drag; Stamp has no in-progress gesture of its own, so this is always true for it),
     * Escape only cancels that gesture, same as every other tool. Only when idle does Escape ALSO
     * revert to Select, the same mode/updateResizeHandles/updateCursor tail setMode() itself uses.
     */
    cancelPath() {
      const wasIdle = interactionKind === null;
      resetInProgressDrawing();
      if (wasIdle && CLICK_TO_PLACE_MODES.has(mode)) {
        mode = 'select';
        updateResizeHandles();
        updateCursor();
      }
    },

    /**
     * RS-3011 Step 9 follow-up: finish the in-progress Pen path as an OPEN shape via double-click,
     * an alternative to clicking back on the first anchor (which closes it). A no-op below 2
     * anchors (a single point has no segment to render/sample) -- the in-progress path stays alive
     * untouched, exactly as today, since this is a way to END a path, not a discard path (see
     * cancelPath() for that).
     * `board.path.closed` is deliberately left untouched (Paper.js's own default, false) -- this
     * never seals the path, unlike every closing-drag finalize site.
     */
    finishOpenPenPath() {
      if (!board.path || board.path.segments.length < 2) return;
      // A native double-click's two clicks land at the same point, so the anchor the second click
      // of the dblclick placed is (near-)exactly coincident with the one placed just before it --
      // dedup that trailing duplicate BEFORE finalizing. flattenPathToContour() has no dedup of its
      // own (only a points.length < 3 guard), so an un-deduped trailing vertex would otherwise pass
      // straight into the contour.
      const segments = board.path.segments;
      const last = segments[segments.length - 1];
      const prev = segments[segments.length - 2];
      if (last.point.getDistance(prev.point) <= PEN_COINCIDENT_ANCHOR_TOLERANCE_MM) {
        board.path.removeSegment(segments.length - 1);
      }
      const item = board.path;
      board.finalizeShape();
      commitFinalizedShape(item);
      resetInProgressDrawing();
    },

    /**
     * Remove every currently-selected finalized shape and clear the selection. A no-op if nothing
     * is selected.
     *
     * RS-3011 Step 1 write-through fix: onShapeDeleted(layerId) fires once per already-committed
     * shape being removed, read from item.data.layerId BEFORE board.removeShape() below (which
     * discards the item, and its data, along with it) -- so the matching project.layers entry
     * doesn't outlive the shape it belongs to on the Design canvas. An explicit `false` return means
     * app.js's own last-layer guard (deleteLayer()) blocked it -- that shape must stay on the Design
     * canvas too (board.removeShape() skipped, selection kept), or it would silently vanish from
     * Design while its project.layers entry correctly survives. The default no-op hook returns
     * undefined, which is not `=== false`, so callers with no `hooks` wired in keep today's
     * unconditional local-only removal.
     */
    deleteSelected() {
      const stillSelected = [];
      for (const id of selectedIds) {
        const shape = board.getShape(id);
        const layerId = shape && shape.item.data.layerId;
        if (layerId && onShapeDeleted(layerId) === false) {
          stillSelected.push(id);
          continue;
        }
        board.removeShape(id);
        // RS-3011 Step 3b: the shape's own stone Group has no independent lifecycle -- it never
        // outlives the shape it belongs to on the Design canvas.
        removeStoneGroupForShape(id);
      }
      selectedIds = selectMany(stillSelected);
      updateResizeHandles();
    },

    /**
     * RS-3011 Step 2 fix: repositions an already-committed Design shape's Paper.js item so its
     * bounds' top-left lands at (xMm,yMm) -- the same left/top a 'path' layer's own l.x/l.y always
     * is (XYWH_SHAPE_TYPES convention). Keeps board.shapes in sync when app.js moves a layer through
     * a path that doesn't go through this file's own onMouseUp move/resize write-through (Align/
     * Distribute, which write project.layers x/y directly via applyPositionDeltas() -- see
     * findShapeByLayerId's own doc comment). A no-op if no board.shapes item matches `layerId`
     * (every non-Design layer type -- Align/Distribute call this for every layer they moved,
     * Design-drawn or not). Refreshes resize handles afterward in case the repositioned shape is
     * the one currently selected (its bounds just changed).
     * @param {string} layerId
     * @param {number} xMm
     * @param {number} yMm
     */
    repositionShapeForLayer(layerId, xMm, yMm) {
      const shape = findShapeByLayerId(layerId);
      if (!shape) return;
      const b = shape.item.bounds;
      shape.item.translate(new paper.Point(xMm - b.left, yMm - b.top));
      updateResizeHandles();
    },

    /**
     * RS-3011 Step 8 Phase B: selects an already-committed Design shape by its project.layers id --
     * the on-canvas counterpart of app.js setting selectedLayerId/selectedLayerIds after pushing a
     * new layer directly into project.layers from outside this file's own draw-tool flow (Import
     * SVG; Boolean Operations' own newLayer push follows the identical project.layers-push
     * convention but is never reachable while Design is active, so it never needed this). A layer
     * created via commitFinalizedShape() becomes selected in `selectedIds` automatically as part of
     * finalizing the draw -- a layer pushed in from outside never goes through that path, so without
     * this call the Inspector would show it selected while the Design canvas itself shows no
     * selection outline/handles. A no-op if no board.shapes item matches `layerId` yet -- callers
     * must invoke this AFTER whatever triggered syncFromProjectLayers()'s reconciliation (e.g.
     * app.js's own updateAll()) has actually run, or the shape won't exist in board.shapes to find.
     * @param {string} layerId
     */
    selectShapeForLayer(layerId) {
      const shape = findShapeByLayerId(layerId);
      if (!shape) return;
      selectedIds = selectOnly(shape.id);
      applySelectionVisuals();
      updateResizeHandles();
    },

    /**
     * RS-3011 Step 2 fix: clones an already-committed Design shape's Paper.js item, offsets the
     * clone by (dxMm,dyMm) -- the SAME offset app.js's duplicateLayer() already applied to the new
     * layer's own x/y, passed through rather than re-derived here, so there is only ever one +8mm/
     * +8mm convention -- and adds it to board.shapes with `newLayerId` stamped onto
     * item.data.layerId, mirroring commitFinalizedShape()'s own stamp. A no-op if no board.shapes
     * item matches `sourceLayerId` (every non-Design layer type). Also selects the clone in this
     * file's own `selectedIds` (selectOnly(), the same helper the click-handler sites use) and
     * rebuilds resize handles -- app.js's duplicateLayer() already points selectedLayerId/
     * selectedLayerIds (and therefore the Inspector) at the new copy right after calling this, so
     * the Design canvas's own selection outline/handles must land on the same shape or the two
     * would visibly disagree about what's selected. Deliberately does NOT call onSelectionChanged/
     * notifySelectionChanged() itself -- duplicateLayer() already sets the app-level selection
     * directly, so firing the hook here would be redundant and could race that assignment.
     * applySelectionVisuals() repaints every shape's stroke color from the new `selectedIds`
     * (needed regardless of order: Paper.js's clone() copies the source item's current strokeColor
     * verbatim, which would otherwise leave the clone wrongly painted to match whatever the source
     * was).
     * @param {string} sourceLayerId
     * @param {string} newLayerId
     * @param {number} dxMm
     * @param {number} dyMm
     */
    duplicateShapeForLayer(sourceLayerId, newLayerId, dxMm, dyMm) {
      const source = findShapeByLayerId(sourceLayerId);
      if (!source) return;
      const clone = source.item.clone({ insert: true });
      clone.translate(new paper.Point(dxMm, dyMm));
      clone.data.layerId = newLayerId;
      const cloneId = board.addShape(clone);
      // RS-3011 Step 3b: the clone needs its own regenerated stone Group, not a reference to
      // source's -- rebuildStoneGroupForShape() re-flattens the CLONE's own (already-translated)
      // item and asks app.js for newLayerId's own params, so this is never a shared/aliased group.
      // Requires app.js's duplicateLayer() to have already pushed the new layer into project.layers
      // before calling this (see that function's own comment on why the push was reordered).
      rebuildStoneGroupForShape(cloneId);
      selectedIds = selectOnly(cloneId);
      applySelectionVisuals();
      updateResizeHandles();
    },

    /**
     * RS-3011 Step 3b: the write-through target for a 'path' layer's stoneSize/gap/color/fillMode
     * edits (Step 3a's mirrored panel or the Inspector -- see app.js's writeSelectedControlsToLayer(),
     * the single place both write to, since relocateFieldGroups() only ever moves the same DOM
     * elements between panels, never clones them). A no-op if no board.shapes item matches `layerId`
     * (every non-Design layer type, or Design not currently active) -- same "no-op otherwise"
     * write-through convention as onShapeMoved/onShapeResized/onShapeDeleted's own hooks.
     * @param {string} layerId
     */
    refreshStoneGroupForLayer(layerId) {
      const shape = findShapeByLayerId(layerId);
      if (!shape) return;
      rebuildStoneGroupForShape(shape.id);
    },

    /**
     * RS-3013 Step 3: the write-through target for app.js's own duplicateRegionInPathLayer() --
     * region duplication is a direct app.js-initiated action (a button click), not a canvas
     * gesture, so unlike onRegionMoved() (a hook this module calls INTO app.js from a drag) this is
     * a plain method app.js calls directly, since app.js already owns project.layers/regions and
     * needs no hit-test help to know which region it just created. Reassigns activeSelection to the
     * new copy and rebuilds activeSelectionItem's outline from the ALREADY-KNOWN polygon
     * duplicateRegionInPathLayer() returned -- same "trust the caller's own return value over a
     * fresh hit-test" precedent onRegionMoved()'s own onMouseUp caller already established -- so the
     * new copy reads as selected immediately, with the source region's own selection state
     * untouched (setActiveSelection() below fully replaces it, it never merges).
     * @param {string} layerId
     * @param {string} regionId
     * @param {{xMm:number,yMm:number}[]} polygon absolute-mm outline of the new region.
     */
    setActiveSelectionToRegion(layerId, regionId, polygon) {
      setActiveSelection({ kind: 'region', layerId, regionId }, [polygon]);
    },

    /**
     * RS-3013 Step 4: the write-through target for app.js's own deleteCurrentSelection() -- a public
     * wrapper around setActiveSelection(null), mirroring setActiveSelectionToRegion() immediately
     * above in spirit (a small public surface for an app.js-initiated action to reach in and update
     * selection state directly), just for the "clear" case (a deleted region leaves nothing selected)
     * instead of the "select the new copy" case.
     */
    clearActiveSelection() {
      setActiveSelection(null);
    },

    /**
     * RS-3014 Step 3: the write-through target for an Outline-mode Eraser cut -- the first thing to
     * ever mutate a LIVE 'path' layer's own `contours` after commit (see app.js's onEraseSweep()).
     * Every other project.layers write that reaches this file (stoneSize/gap/color/fillMode via
     * refreshStoneGroupForLayer() above, a resize via onShapeResized) either changes non-geometric
     * style or the x/y/w/h placement box alone -- syncFromProjectLayers()'s own step 3 already
     * reconciles a bounds change by re-stretching the EXISTING Paper.js item (`shape.item.bounds =`),
     * which is correct there because the item's own segment geometry doesn't need to change, only
     * its placement. A contour cut is different: the segments themselves must change, which
     * `.bounds =` cannot do -- so this re-materializes a fresh Item from `layer`'s own updated
     * contours/x/y/w/h/closed (materializeShapeFromLayer(), the same reconciliation builder
     * syncFromProjectLayers() itself uses for a brand-new/undone-back shape) and swaps it in via
     * DrawingBoard's own replaceShapeItem() (same shape id, same z-order slot). Re-applies selection
     * styling/resize handles (the fresh item starts out with default, unselected styling) and
     * rebuilds the stone Group against the NEW item's geometry -- same three steps
     * syncFromProjectLayers() itself runs after a bounds change, just via this one shape's own
     * update path instead of the whole-board reconciliation pass (an Outline-mode cut is a single,
     * explicit, already-know-which-shape action, not a "something changed somewhere" pass over every
     * layer -- so this stays out of syncFromProjectLayers()'s own per-tick loop rather than adding a
     * contour-diff check there, matching that method's own doc comment on why forceStoneRebuild is
     * opt-in rather than unconditional: unnecessary per-tick cost for every OTHER path layer that
     * never gets cut). A no-op if no board.shapes item matches `layer.id`, or if `layer` has no
     * usable contour (materializeShapeFromLayer() returns null) -- same "no-op otherwise" write-
     * through convention as refreshStoneGroupForLayer() above.
     * @param {object} layer A raw project.layers 'path' layer (same shape materializeShapeFromLayer()
     *   already expects: contours/x/y/w/h/closed), with its `contours` already updated.
     */
    refreshShapeGeometryForLayer(layer) {
      const shape = findShapeByLayerId(layer.id);
      if (!shape) return;
      const newItem = materializeShapeFromLayer(layer);
      if (!newItem) return;
      if (!board.replaceShapeItem(shape.id, newItem)) return;
      newItem.data.layerId = layer.id;
      applySelectionVisuals();
      updateResizeHandles();
      rebuildStoneGroupForShape(shape.id);
    },

    /**
     * Canvas-desync fix: full reconciliation pass between `layers` (every current project.layers
     * entry with type==='path', plus, since RS-3032 Step A, every SHAPE_LIBRARY_KINDS entry --
     * Star/Ring/Heart/... -- see this method's own RS-3032 note below) and this file's own
     * board.shapes, covering every way the two can drift when project.layers changes from OUTSIDE
     * Design's own drag handlers -- undo, redo, the Layers-list trash-icon delete (deleteLayer()
     * there is called directly, bypassing deleteSelected()/onShapeDeleted entirely), and by the same
     * mechanism any other external project.layers mutation while Design is active. Runs in three
     * passes, in this order so an id can never be both stale-removed and freshly-materialized in the
     * same call:
     *
     * 1. A board.shapes item whose `item.data.layerId` no longer matches any entry in `layers` is
     *    removed (undo-of-draw, redo-of-delete) -- run first so step 2's "no matching item" check
     *    never counts an item that's about to be removed anyway.
     * 2. A `layers` entry with no matching board.shapes item is materialized fresh -- via
     *    materializeShapeFromLayer() for a 'path' layer, or materializeShapeLibraryItemFromLayer()
     *    for a SHAPE_LIBRARY_KINDS one (see materializeForLayer() just below) -- covering both
     *    undo-of-delete/redo-of-draw AND, since RS-3032 Step A, a SHAPE_LIBRARY_KINDS layer that
     *    simply never had a Design-canvas item at all yet (freshly created while Design is active).
     * 3. Every board.shapes item with a matching layer has its geometry reconciled to the layer's
     *    current x/y/w/h -- see the loop's own per-category comments below for exactly how (a
     *    'path' layer's bounds are stretched in place; a SHAPE_LIBRARY_KINDS layer is re-
     *    materialized). Its stone Group is rebuilt whenever that reconciliation happened, OR
     *    whenever the caller passes `forceStoneRebuild` (see below for why).
     *
     * Steps 1-2 also rebuild/remove the shape's stone Group so the live preview never lags the
     * outline. Local `selectedIds` drops any id removed in step 1 silently (no
     * notifySelectionChanged() -- this runs synchronously inside app.js's own updateAll(), which
     * onSelectionChanged's own hook calls right back into, so notifying here would re-enter
     * updateAll() from within itself; deleteSelected() already leaves the same call out for the
     * same reason).
     *
     * Step 3's rebuild can't rely on bounds-changed alone (RS-3011 Step 10b bug fix): bounds-changed
     * only detects geometry (move/resize). A path layer also carries non-geometric fields --
     * regions, stoneSize, gap, color, fillMode -- that undo, redo, or the trash-icon delete can just
     * as easily swap in a different value for, with no x/y/w/h change at all. Gating step 3's
     * rebuild on bounds-changed alone missed exactly that: painting a Paint region (or any other
     * non-geometric edit), then undoing it, left the pre-undo stones on screen indefinitely, because
     * nothing ever called rebuildStoneGroupForShape() for that layer again. Enumerating every
     * non-geometric field individually here would be fragile and incomplete -- this bug is exactly
     * that failure mode -- so callers that know project.layers may have changed from outside
     * Design's own drag handlers (applyHistorySnapshot()'s undo/redo, deleteLayer()'s trash-icon
     * path) pass `forceStoneRebuild=true` to unconditionally rebuild every matched layer's stone
     * Group, rather than trying to enumerate which non-geometric field changed.
     * This method runs on every updateAll() call while Design is active (see this method's own call
     * site in app.js), including every ordinary edit tick (a continuous slider drag, a window
     * resize) -- those calls leave `forceStoneRebuild` at its default `false`, so step 3's rebuild
     * stays gated on boundsChanged exactly as it was before this fix, and this method remains a
     * no-op on an ordinary tick where nothing moved. Measured cost of making the rebuild
     * unconditional on every tick: ~8ms/tick with 25 path layers during a continuous field-edit
     * drag, vs ~0.2-0.4ms baseline -- the reason this flag is opt-in rather than the default.
     *
     * RS-3032 Step A: `layers` widened from 'path'-only to also carry every SHAPE_LIBRARY_KINDS
     * layer (see app.js's own call site). The two categories are handled by clearly separate code
     * paths throughout this method (never intermixed) since their bounds-comparison logic
     * genuinely differs: a 'path' layer can carry a frozen `naturalBoundingBoxMm` from an Outline-
     * mode Eraser cut (see expectedShapeBoundsMm()'s own doc comment) -- a concept that does not
     * exist for a SHAPE_LIBRARY_KINDS layer at all, which always uses the plain x/y/w/h comparison
     * every un-cut 'path' layer already used. RS-3012 Step 2: `layers` widened again to also carry
     * every 'svg'/'image' layer -- these have no `naturalBoundingBoxMm` concept either (same as
     * SHAPE_LIBRARY_KINDS), so they share that same plain x/y/w/h comparison branch, just
     * materializing via materializeSvgImageItemFromLayer() instead (see its own doc comment). Circle
     * stays out of scope entirely (see materializeShapeLibraryItemFromLayer()'s own doc comment for
     * why) -- app.js's own filter never passes it into `layers` here, so this method has no branch
     * for it.
     * @param {object[]} layers Every current 'path', SHAPE_LIBRARY_KINDS, 'svg' or 'image'
     *   project.layers entry.
     * @param {boolean} [forceStoneRebuild=false] Rebuild every matched layer's stone Group even when
     *   its bounds haven't changed -- for callers where project.layers may have changed a
     *   non-geometric field from outside Design's own drag handlers (undo/redo, trash-icon delete).
     */
    syncFromProjectLayers(layers, forceStoneRebuild = false) {
      // RS-3032 Step A: the one place this method decides which materialization builder a layer
      // uses -- 'path' layers keep using the existing contours-based builder unchanged. RS-3012
      // Step 2: 'svg'/'image' layers use their own builder (no stored contours, no GeometryEngine
      // shape formula either). Everything else reaching this method is a SHAPE_LIBRARY_KINDS layer
      // (app.js's own call-site filter guarantees no other type ever arrives here), which has no
      // stored contours at all and must ask GeometryEngine for its outline via the injected
      // resolveShapeLibraryPolygons hook.
      function materializeForLayer(layer) {
        if (layer.type === 'path') return materializeShapeFromLayer(layer);
        if (layer.type === 'svg' || layer.type === 'image') {
          return materializeSvgImageItemFromLayer(layer, resolveSvgPolygons);
        }
        return materializeShapeLibraryItemFromLayer(layer, resolveShapeLibraryPolygons);
      }

      const layerById = new Map(layers.map((l) => [l.id, l]));

      for (const shape of board.listShapes()) {
        const layerId = shape.item.data.layerId;
        if (!layerId || layerById.has(layerId)) continue;
        board.removeShape(shape.id);
        removeStoneGroupForShape(shape.id);
        if (selectedIds.has(shape.id)) {
          const next = new Set(selectedIds);
          next.delete(shape.id);
          selectedIds = next;
        }
      }

      const matchedLayerIds = new Set(
        board.listShapes().map((shape) => shape.item.data.layerId).filter(Boolean)
      );
      for (const layer of layers) {
        if (matchedLayerIds.has(layer.id)) continue;
        const item = materializeForLayer(layer);
        if (!item) continue;
        const shapeId = board.addShape(item);
        item.data.layerId = layer.id;
        rebuildStoneGroupForShape(shapeId);
      }

      for (const shape of board.listShapes()) {
        const layerId = shape.item.data.layerId;
        const layer = layerId && layerById.get(layerId);
        if (!layer) continue;
        const b = shape.item.bounds;
        // RS-3033: whether `layer`'s own rotationDeg differs from what `shape.item` currently
        // reflects (item.data.rotationDeg, stamped by materializeShapeFromLayer() every time it
        // builds/rebuilds an item -- see that function's own rotation-step comment; 0 for any item
        // built before this milestone, or never rotated). A plain AABB comparison alone (boundsChanged
        // below) cannot be trusted to catch every rotation change on its own -- a rotated item's own
        // AABB can, for specific width/height/angle combinations, coincidentally still match its
        // pre-rotation box (most simply: a perfectly square layer rotated a multiple of 90deg) -- so
        // this is tracked explicitly rather than inferred from bounds.
        const currentRotationDeg = shape.item.data.rotationDeg || 0;
        const targetRotationDeg = layer.rotationDeg || 0;
        const rotationChanged = Math.abs(currentRotationDeg - targetRotationDeg) > 1e-6;
        // RS-3014 Step 3: a 'path' layer with a frozen naturalBoundingBoxMm (an Outline-mode Eraser
        // cut has run on it at least once) takes a separate, more expensive path -- see
        // expectedShapeBoundsMm()'s own doc comment for why its bounds can legitimately be smaller
        // than layer.x/y/w/h, and why comparing straight against layer.x/y/w/h (the cheap check
        // every OTHER layer keeps, unchanged, below) would treat that as "always changed" forever.
        // Deliberately gated on this rare, 'path'-only case, not applied unconditionally to every
        // layer here -- this loop runs on every updateAll() tick (see this method's own doc comment
        // on forceStoneRebuild's opt-in cost), and expectedShapeBoundsMm() is an O(points) scan the
        // vast majority of (never-cut) layers have no reason to pay every tick. A SHAPE_LIBRARY_KINDS
        // layer never has this field at all (RS-3032 Step A) and always falls through to the plain
        // comparison below.
        if (layer.type === 'path' && layer.naturalBoundingBoxMm) {
          const expected = expectedShapeBoundsMm(layer);
          const boundsChanged = !expected ||
            Math.abs(b.left - expected.left) > 1e-6 ||
            Math.abs(b.top - expected.top) > 1e-6 ||
            Math.abs(b.width - expected.width) > 1e-6 ||
            Math.abs(b.height - expected.height) > 1e-6;
          if (boundsChanged || rotationChanged) {
            // A cut shape's bounds don't simply stretch to fill layer.x/y/w/h -- re-materialize
            // from the layer's own contours/frozen box instead of a raw bounds transform, the same
            // reconciliation refreshShapeGeometryForLayer() itself uses. Also covers a rotation-only
            // change (bounds unaffected -- expectedShapeBoundsMm() is deliberately unrotated, see
            // materializeShapeFromLayer()'s own rotation-step comment), same rotationChanged OR as
            // the plain (non-frozen) branch below.
            const newItem = materializeShapeFromLayer(layer);
            if (newItem) {
              board.replaceShapeItem(shape.id, newItem);
              newItem.data.layerId = layerId;
            }
          }
          if (boundsChanged || rotationChanged || forceStoneRebuild) rebuildStoneGroupForShape(shape.id);
          continue;
        }
        const boundsChanged =
          Math.abs(b.left - layer.x) > 1e-6 ||
          Math.abs(b.top - layer.y) > 1e-6 ||
          Math.abs(b.width - layer.w) > 1e-6 ||
          Math.abs(b.height - layer.h) > 1e-6;
        if (boundsChanged || rotationChanged) {
          if (layer.type === 'path') {
            // RS-3033: a rotated (or rotation-changing) 'path' layer must go through the same
            // rotation-aware re-materialize path a SHAPE_LIBRARY_KINDS layer already does below --
            // the fast bounds-stretch this branch otherwise uses is only mathematically valid for an
            // UNROTATED item (see materializeShapeFromLayer()'s own rotation-step comment for why
            // stretching an already-rotated item's bounds is wrong, the identical reasoning
            // RS-3032 Step A already established for SHAPE_LIBRARY_KINDS just below).
            if (targetRotationDeg !== 0 || rotationChanged) {
              const newItem = materializeShapeFromLayer(layer);
              if (newItem) {
                board.replaceShapeItem(shape.id, newItem);
                newItem.data.layerId = layerId;
              }
            } else {
              // A plain (never-cut, never-rotated) 'path' layer's own contours are, by construction,
              // always the natural shape scaled to exactly fill layer.x/y/w/h -- stretching the
              // existing item's bounds in place is mathematically identical to re-materializing, at
              // a fraction of the cost, so this keeps doing that unchanged from before RS-3032 Step A.
              shape.item.bounds = new paper.Rectangle(
                layer.x,
                layer.y,
                Math.max(RESIZE_MIN_DIM_MM, layer.w),
                Math.max(RESIZE_MIN_DIM_MM, layer.h)
              );
            }
          } else if (layer.type === 'svg' || layer.type === 'image') {
            // RS-3012 Step 2: neither type can take the 'path' branch's cheap bounds-stretch
            // shortcut above -- 'svg''s outline must be re-resolved at the new width/height (like a
            // SHAPE_LIBRARY_KINDS layer just below), and 'image''s placeholder rectangle is cheap
            // enough to just rebuild outright rather than special-casing a stretch for it alone. Both
            // just re-materialize, the same "geometry itself must change, not just placement"
            // reasoning as the SHAPE_LIBRARY_KINDS branch below.
            const newItem = materializeSvgImageItemFromLayer(layer, resolveSvgPolygons);
            if (newItem) {
              board.replaceShapeItem(shape.id, newItem);
              newItem.data.layerId = layerId;
            }
          } else {
            // RS-3032 Step A: a SHAPE_LIBRARY_KINDS layer's geometry is NOT simply its natural shape
            // stretched into the box -- GeometryEngine resolves it at the new width/height and THEN
            // rotates the result around the new center (RS-3028's rotationDeg step). A naive
            // `.bounds =` stretch of an already-rotated item would shear it into the wrong shape the
            // instant the box's aspect ratio changes, so this re-materializes from the engine
            // instead, the same "geometry itself must change, not just placement" reasoning
            // materializeShapeFromLayer()'s own frozen-box branch above already uses for a cut
            // 'path' layer, just via the shape-library builder.
            const newItem = materializeShapeLibraryItemFromLayer(layer, resolveShapeLibraryPolygons);
            if (newItem) {
              board.replaceShapeItem(shape.id, newItem);
              newItem.data.layerId = layerId;
            }
          }
        }
        if (boundsChanged || rotationChanged || forceStoneRebuild) rebuildStoneGroupForShape(shape.id);
      }

      applySelectionVisuals();
      updateResizeHandles();
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
    },

    /**
     * QA/verification-only, read-only -- same precedent as debugGrid/debugHitTestShapeId above.
     * RS-3010 Step 2e: exposes every finalized shape's exact project-mm bounds and path segment
     * points, so grid-snap verification can assert exact numeric coordinates instead of only
     * inferring alignment from a screenshot. RS-3033: also exposes rotationDeg/pivotXMm/pivotYMm
     * (item.data, stamped by materializeShapeFromLayer()/materializeShapeLibraryItemFromLayer() --
     * see those functions' own comments) so rotate-drag verification can assert the exact numeric
     * rotation/pivot a drag produced, the same "assert numbers, not just a screenshot" precedent.
     */
    get debugShapes() {
      return board.listShapes().map((shape) => ({
        id: shape.id,
        layerId: shape.item.data.layerId || null,
        rotationDeg: shape.item.data.rotationDeg || 0,
        pivotXMm: shape.item.data.pivotXMm,
        pivotYMm: shape.item.data.pivotYMm,
        bounds: {
          left: shape.item.bounds.left,
          top: shape.item.bounds.top,
          width: shape.item.bounds.width,
          height: shape.item.bounds.height
        },
        points: shape.item.segments
          ? shape.item.segments.map((segment) => ({ x: segment.point.x, y: segment.point.y }))
          : null
      }));
    },

    /**
     * RS-3013 Step 2: QA/verification-only, read-only -- same precedent as debugGrid/
     * debugHitTestShapeId/debugShapes above. Reads activeSelectionItem's own live outline
     * (absolute project-mm), one ring per array entry -- lets a region-move drag's verification read
     * back the SELECTION OUTLINE'S current position directly, distinct from `activeSelection` itself
     * (which only ever carries {kind,layerId,regionId}, never geometry). Null when there is no active
     * selection.
     * @returns {{xMm:number,yMm:number}[][]|null}
     */
    get debugActiveSelectionOutline() {
      if (!activeSelectionItem) return null;
      const paths = activeSelectionItem.children && activeSelectionItem.children.length
        ? activeSelectionItem.children
        : [activeSelectionItem];
      return paths.map((path) => path.segments.map((segment) => ({ xMm: segment.point.x, yMm: segment.point.y })));
    },

    /**
     * RS-3013 Step 2 fix: QA/verification-only, read-only -- same precedent as debugGrid/
     * debugHitTestShapeId/debugShapes/debugActiveSelectionOutline above. Reads the module-private
     * `interactionKind` directly (raw string, e.g. 'move'/'resize'/'moveRegion', or null when idle) --
     * lets a mousedown-ordering verification (resize-handle vs. region-first) confirm exactly which
     * drag was actually started, not just infer it from side effects.
     * @returns {string|null}
     */
    get debugInteractionKind() {
      return interactionKind;
    },

    /**
     * QA/verification-only, read-only -- same precedent as debugGrid/debugHitTestShapeId/
     * debugShapes above. RS-3010 Step 2e: exposes Paper.js's own project-mm-to-view-px transform so
     * grid-snap verification can dispatch real mouse events at precise, deliberately off-grid mm
     * targets instead of guessing pixel coordinates.
     * @param {number} xMm
     * @param {number} yMm
     * @returns {{x:number,y:number}} CSS-pixel coordinates within canvasEl.
     */
    debugProjectToViewPx(xMm, yMm) {
      const viewPoint = paper.view.projectToView(new paper.Point(xMm, yMm));
      return { x: viewPoint.x, y: viewPoint.y };
    }
  };
}
