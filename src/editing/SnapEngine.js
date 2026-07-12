/**
 * Snapping — RS-1009.
 *
 * Pure geometry over millimeter values. No DOM, no `Project`/`Layer`/`StoneLayout` type, no
 * dependency on `src/geometry/**`/`src/renderer/**`/`src/products/**` — the caller (`app.js`)
 * resolves the safe-area rectangle (via the existing `src/products/**` `getSafeAreaRectMm()`)
 * and every layer's bounding box (via its existing `getLayerBBox()`) and passes plain mm numbers
 * in here.
 */

import { SNAP_TOLERANCE_MM } from './EditingConstants.js';

/**
 * @param {object} params
 * @param {number} params.canvasWidthMm
 * @param {number} params.canvasHeightMm
 * @param {{xMm:number,yMm:number,widthMm:number,heightMm:number}|null} [params.safeAreaRectMm]
 * @param {{layerId:string,xMm:number,yMm:number,widthMm:number,heightMm:number}[]} [params.layerBBoxes]
 *   Bounding boxes of every OTHER (non-dragged) visible layer to snap against.
 * @returns {{vertical:object[], horizontal:object[]}} Candidate snap target lines, each
 *   `{valueMm, type, layerId?}`. `vertical` lines are x-positions; `horizontal` lines are
 *   y-positions.
 */
export function buildSnapTargets({ canvasWidthMm, canvasHeightMm, safeAreaRectMm = null, layerBBoxes = [] }) {
  if (typeof canvasWidthMm !== 'number' || !Number.isFinite(canvasWidthMm) || canvasWidthMm <= 0) {
    throw new TypeError('buildSnapTargets: canvasWidthMm must be a positive number.');
  }
  if (typeof canvasHeightMm !== 'number' || !Number.isFinite(canvasHeightMm) || canvasHeightMm <= 0) {
    throw new TypeError('buildSnapTargets: canvasHeightMm must be a positive number.');
  }

  const vertical = [
    { valueMm: 0, type: 'canvas-edge' },
    { valueMm: canvasWidthMm, type: 'canvas-edge' },
    { valueMm: canvasWidthMm / 2, type: 'canvas-center' }
  ];
  const horizontal = [
    { valueMm: 0, type: 'canvas-edge' },
    { valueMm: canvasHeightMm, type: 'canvas-edge' },
    { valueMm: canvasHeightMm / 2, type: 'canvas-center' }
  ];

  if (safeAreaRectMm) {
    vertical.push(
      { valueMm: safeAreaRectMm.xMm, type: 'safe-area-edge' },
      { valueMm: safeAreaRectMm.xMm + safeAreaRectMm.widthMm, type: 'safe-area-edge' },
      { valueMm: safeAreaRectMm.xMm + safeAreaRectMm.widthMm / 2, type: 'safe-area-center' }
    );
    horizontal.push(
      { valueMm: safeAreaRectMm.yMm, type: 'safe-area-edge' },
      { valueMm: safeAreaRectMm.yMm + safeAreaRectMm.heightMm, type: 'safe-area-edge' },
      { valueMm: safeAreaRectMm.yMm + safeAreaRectMm.heightMm / 2, type: 'safe-area-center' }
    );
  }

  for (const b of layerBBoxes) {
    vertical.push(
      { valueMm: b.xMm, type: 'layer-edge', layerId: b.layerId },
      { valueMm: b.xMm + b.widthMm, type: 'layer-edge', layerId: b.layerId },
      { valueMm: b.xMm + b.widthMm / 2, type: 'layer-center', layerId: b.layerId }
    );
    horizontal.push(
      { valueMm: b.yMm, type: 'layer-edge', layerId: b.layerId },
      { valueMm: b.yMm + b.heightMm, type: 'layer-edge', layerId: b.layerId },
      { valueMm: b.yMm + b.heightMm / 2, type: 'layer-center', layerId: b.layerId }
    );
  }

  return { vertical, horizontal };
}

function bestMatch(features, targets, toleranceMm) {
  let best = null;
  for (const feature of features) {
    for (const target of targets) {
      const diff = target.valueMm - feature.valueMm;
      if (Math.abs(diff) <= toleranceMm && (!best || Math.abs(diff) < Math.abs(best.diff))) {
        best = { diff, target, feature: feature.name };
      }
    }
  }
  return best;
}

/**
 * Finds the closest snap on each axis (independently) for a dragged bounding box, within
 * tolerance, and returns the offset needed to snap it plus the matched guide line(s).
 *
 * @param {{xMm:number,yMm:number,widthMm:number,heightMm:number}} dragBBoxMm The dragged
 *   selection's bounding box at its current (unsnapped) candidate position.
 * @param {{vertical:object[], horizontal:object[]}} targets From `buildSnapTargets()`.
 * @param {number} [toleranceMm]
 * @returns {{dxMm:number, dyMm:number, guides:{axis:'vertical'|'horizontal',valueMm:number,type:string}[]}}
 */
export function computeSnapOffset(dragBBoxMm, targets, toleranceMm = SNAP_TOLERANCE_MM) {
  const featuresX = [
    { valueMm: dragBBoxMm.xMm, name: 'left' },
    { valueMm: dragBBoxMm.xMm + dragBBoxMm.widthMm / 2, name: 'centerH' },
    { valueMm: dragBBoxMm.xMm + dragBBoxMm.widthMm, name: 'right' }
  ];
  const featuresY = [
    { valueMm: dragBBoxMm.yMm, name: 'top' },
    { valueMm: dragBBoxMm.yMm + dragBBoxMm.heightMm / 2, name: 'centerV' },
    { valueMm: dragBBoxMm.yMm + dragBBoxMm.heightMm, name: 'bottom' }
  ];

  const bestX = bestMatch(featuresX, targets.vertical, toleranceMm);
  const bestY = bestMatch(featuresY, targets.horizontal, toleranceMm);

  const guides = [];
  if (bestX) {
    const guide = { axis: 'vertical', valueMm: bestX.target.valueMm, type: bestX.target.type };
    if (bestX.target.layerId) guide.layerId = bestX.target.layerId;
    guides.push(guide);
  }
  if (bestY) {
    const guide = { axis: 'horizontal', valueMm: bestY.target.valueMm, type: bestY.target.type };
    if (bestY.target.layerId) guide.layerId = bestY.target.layerId;
    guides.push(guide);
  }

  return { dxMm: bestX ? bestX.diff : 0, dyMm: bestY ? bestY.diff : 0, guides };
}
