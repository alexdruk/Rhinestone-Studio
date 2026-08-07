/**
 * DrawingBoxGeometry — pure drag-box math shared by the rectangle/ellipse presets
 * (DrawingCanvasTool.js). Reimplemented from drawleather's `dragSnap.ts`/`ShapeTool.ts` (read for
 * technique per RS-3001 §5's resolved reuse policy, not copied) and trimmed to what this step
 * needs -- no from-center drag, no preset-specific corner logic. Kept separate from
 * DrawingBoard.js so a later slot preset (RS-3010 Step 2b) can add a matching `resolveDragAxis`
 * helper here without growing the data-model file.
 */

/**
 * @param {{x:number,y:number}} start The drag's starting point (mm).
 * @param {{x:number,y:number}} current The drag's current point (mm).
 * @returns {{left:number,top:number,width:number,height:number}} The bounding box spanning the
 *   two corner points.
 */
export function resolveDragBox(start, current) {
  return {
    left: Math.min(start.x, current.x),
    top: Math.min(start.y, current.y),
    width: Math.abs(current.x - start.x),
    height: Math.abs(current.y - start.y)
  };
}

/**
 * Constrains `current` so both axes have equal magnitude of displacement from `start`, using the
 * larger of |dx|/|dy| (same approach as drawleather's dragSnap.ts) -- the point resolveDragBox()
 * should be called with instead of the raw cursor point when Shift constrains a rect to a square
 * or an ellipse to a circle.
 * @param {{x:number,y:number}} start
 * @param {{x:number,y:number}} current
 * @returns {{x:number,y:number}}
 */
export function constrainSquare(start, current) {
  const dx = current.x - start.x;
  const dy = current.y - start.y;
  const magnitude = Math.max(Math.abs(dx), Math.abs(dy));
  return {
    x: start.x + Math.sign(dx || 1) * magnitude,
    y: start.y + Math.sign(dy || 1) * magnitude
  };
}

/**
 * Resolves the slot preset's drag axis (RS-3010 Step 2b): `a` is always the press point, `b` is
 * always the current/release point -- the pill's straight axis runs from `a` to `b` at any angle.
 * Trimmed from drawleather's dragSnap.ts the same way resolveDragBox/constrainSquare above were --
 * no from-center mode, not requested for this step.
 * @param {{x:number,y:number}} start The drag's starting point (mm).
 * @param {{x:number,y:number}} current The drag's current point (mm).
 * @returns {{a:{x:number,y:number}, b:{x:number,y:number}}} The pill's axis endpoints.
 */
export function resolveDragAxis(start, current) {
  return { a: { x: start.x, y: start.y }, b: { x: current.x, y: current.y } };
}

/**
 * Design Step C: full-containment test for marquee-select -- true if `inner` (e.g. a shape's
 * bounds) lies entirely within `outer` (the marquee box). Not intersection -- a shape only
 * partially covered by the marquee is excluded, per this step's simpler containment-only rule.
 * @param {{left:number,top:number,width:number,height:number}} outer
 * @param {{left:number,top:number,width:number,height:number}} inner
 * @returns {boolean}
 */
export function boxContainsBox(outer, inner) {
  return (
    inner.left >= outer.left &&
    inner.top >= outer.top &&
    inner.left + inner.width <= outer.left + outer.width &&
    inner.top + inner.height <= outer.top + outer.height
  );
}
