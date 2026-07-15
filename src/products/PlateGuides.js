/**
 * Plate-specific 2D printable-boundary guide geometry (S-112).
 *
 * A round plate's printable boundary is circular/annular, not the rectangular safe-area inset
 * every revolved-vessel template uses (src/products/ObjectTemplate.js's getSafeAreaRectMm()) or
 * the cylindrical Front View Frame (app.js's frontViewFrameGeometry()) -- neither applies to a flat
 * top-down disc. Per the milestone brief ("If a new circular or annular guide is required, keep it
 * plate-specific at the product-projection level, not inside GeometryEngine"), this module is pure
 * geometry math only: no DOM/Canvas dependency, no StoneLayout, no rendering. app.js is the only
 * caller, turning this into a drawn overlay exactly like it already does for
 * getSafeAreaRectMm()/drawSafeAreaGuide().
 */
import { getPlateDesignTargetMeta, isValidPlateDesignTarget, DEFAULT_PLATE_DESIGN_TARGET } from './PlateProductDefinition.js';

/**
 * @param {string} designTarget 'centerWell'|'rimBand'|'fullTopSurface'
 * @param {{outerDiameterMm:number, innerWellDiameterMm:number}} plateParams
 * @param {number} canvasWidthMm
 * @param {number} canvasHeightMm
 * @returns {
 *   {kind:'circle', label:string, cxMm:number, cyMm:number, radiusMm:number, transitionRadiusMm:number|null} |
 *   {kind:'annulus', label:string, cxMm:number, cyMm:number, outerRadiusMm:number, innerRadiusMm:number}
 * } A plain description of the selected design target's printable boundary, centered on the live
 *   canvas (which app.js keeps sized to plateParams.outerDiameterMm on both axes). Center Well and
 *   Full Top Surface are both a single circle (Full Top Surface additionally carries
 *   transitionRadiusMm, a dashed inner guide marking the well/rim transition); Rim Band is a true
 *   annulus (two concentric circles).
 */
export function getPlateDesignTargetGuide(designTarget, plateParams, canvasWidthMm, canvasHeightMm) {
  const target = isValidPlateDesignTarget(designTarget) ? designTarget : DEFAULT_PLATE_DESIGN_TARGET;
  const label = getPlateDesignTargetMeta(target).name;
  const cxMm = canvasWidthMm / 2;
  const cyMm = canvasHeightMm / 2;
  const outerRadiusMm = plateParams.outerDiameterMm / 2;
  const innerRadiusMm = plateParams.innerWellDiameterMm / 2;

  if (target === 'rimBand') {
    return { kind: 'annulus', label, cxMm, cyMm, outerRadiusMm, innerRadiusMm };
  }
  if (target === 'fullTopSurface') {
    return { kind: 'circle', label, cxMm, cyMm, radiusMm: outerRadiusMm, transitionRadiusMm: innerRadiusMm };
  }
  // centerWell
  return { kind: 'circle', label, cxMm, cyMm, radiusMm: innerRadiusMm, transitionRadiusMm: null };
}
