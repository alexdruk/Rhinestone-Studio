/**
 * Text layer placement contract — RS-1009 (introduced), RS-1012 (extracted to app.js's own
 * standalone `computeTextPlacementOffset()`), MONO-005A (extracted again, here, into a shared pure
 * module).
 *
 * A text layer has no stored absolute position of its own, unlike every other layer type (circle/
 * rectangle/svg/path/image, which all store xMm/yMm as a direct absolute millimetre anchor — see
 * `shapeLayerResolveParams()`/`generateSvgStonesLive()`/`generatePathStonesLive()` in app.js). A
 * text layer's stones are instead always auto-centered on the production canvas first, and only
 * then offset by the layer's own x/y on top of that. Concretely, for a text layer's own (local,
 * pre-placement) stone bounding box `boundingBoxMm`:
 *
 *   offsetXMm = (canvasWidthMm  - boundingBoxMm.widthMm)  / 2 - boundingBoxMm.minXmm + (xMm || 0)
 *   offsetYMm = (canvasHeightMm - boundingBoxMm.heightMm) / 2 - boundingBoxMm.minYmm + (yMm || 0)
 *
 * every stone's final position is `(localXMm + offsetXMm, localYMm + offsetYMm)`.
 *
 * This module is the one source of truth for that formula (both directions), extracted verbatim
 * from app.js's pre-existing `computeTextPlacementOffset()` (forward: bounding box + x/y + canvas
 * -> offset) and `fitTextToShape()`'s inline inverse (desired absolute center + canvas -> x/y) —
 * behavior-preserving only, not a redesign. Pure geometry, no DOM/Project/Layer type, no dependency
 * on `src/geometry/**`/`src/renderer/**`, matching `src/editing/AlignmentEngine.js`'s own module
 * shape. Any caller that needs to place a text layer at a specific absolute canvas position (the
 * live app's `fitTextToShape()`, and `MonogramGenerator`) should use
 * `computeTextLayerPositionForTargetCenterMm()` below instead of re-deriving this algebra.
 */

/**
 * Forward direction: given a text layer's local (pre-placement) stone bounding box and its stored
 * x/y offset, returns the translation to apply to every stone to get final absolute positions.
 *
 * @param {object} params
 * @param {{minXmm:number,minYmm:number,widthMm:number,heightMm:number}|null} params.boundingBoxMm
 *   The text layer's own local stone bounding box, or null for an empty layout (offset then
 *   reduces to the raw x/y with no bounding-box-relative centering term).
 * @param {number} [params.xMm] The layer's stored x (default 0).
 * @param {number} [params.yMm] The layer's stored y (default 0).
 * @param {number} params.canvasWidthMm
 * @param {number} params.canvasHeightMm
 * @returns {{offsetXMm:number, offsetYMm:number}}
 */
export function computeTextPlacementOffsetMm({ boundingBoxMm, xMm = 0, yMm = 0, canvasWidthMm, canvasHeightMm }) {
  const offsetXMm = (boundingBoxMm ? (canvasWidthMm - boundingBoxMm.widthMm) / 2 - boundingBoxMm.minXmm : 0) + (xMm || 0);
  const offsetYMm = (boundingBoxMm ? (canvasHeightMm - boundingBoxMm.heightMm) / 2 - boundingBoxMm.minYmm : 0) + (yMm || 0);
  return { offsetXMm, offsetYMm };
}

/**
 * Inverse direction: the x/y a text layer must store so its stones' final bounding-box *center*
 * lands exactly on `(targetCenterXMm, targetCenterYMm)`, regardless of the text's own (local,
 * pre-placement) bounding box. This works because the bounding-box-relative terms in the forward
 * formula above always cancel out at the box's own center: substituting boundingBoxMm's center into
 * the forward formula shows the final center is always exactly
 * `(canvasWidthMm/2 + xMm, canvasHeightMm/2 + yMm)` — independent of the box's width/height/minX/
 * minY. app.js's own `fitTextToShape()` already relies on this identity (see its own doc comment);
 * this is that same algebra, generalized into a named, reusable function instead of an inline
 * expression, so a second caller (MonogramGenerator) never needs to re-derive or duplicate it.
 *
 * @param {object} params
 * @param {number} params.targetCenterXMm
 * @param {number} params.targetCenterYMm
 * @param {number} params.canvasWidthMm
 * @param {number} params.canvasHeightMm
 * @returns {{xMm:number, yMm:number}}
 */
export function computeTextLayerPositionForTargetCenterMm({ targetCenterXMm, targetCenterYMm, canvasWidthMm, canvasHeightMm }) {
  return {
    xMm: targetCenterXMm - canvasWidthMm / 2,
    yMm: targetCenterYMm - canvasHeightMm / 2
  };
}
