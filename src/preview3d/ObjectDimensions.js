/**
 * Pure millimeter-scale geometry math for the 3D preview (RS-1006).
 *
 * No Three.js import, no DOM/canvas dependency — this module only turns an ObjectTemplate record
 * (see src/products/ObjectTemplate.js) plus the live project canvas size into plain numbers. That
 * keeps it unit-testable the same way any other pure geometry module in this repository is, and
 * keeps the "what size is this object" decision independent of how it gets drawn.
 *
 * A real object's size does not change when the operator picks a different wrap mode, so the body
 * radius is anchored once, at a fixed reference wrap angle, and reused for every wrap mode -- only
 * the texture's angular coverage (see ObjectGeometryBuilder.js's applyWrapUv()) changes with wrap.
 */

// Preview-only angular width (degrees) each wrap mode's design covers on the mesh surface. These
// mirror src/renderer/CupRenderer.js's own wrapDeg approximation ('wide'/'half'/'full' use the
// same three values); 'front' is given a narrow window here (a flat "label" look) since the 2D
// renderer's 'front' mode is a fixed, non-wrapped decal rather than a wrap angle at all.
export const WRAP_ANGLE_DEG = Object.freeze({ front: 70, wide: 115, half: 180, full: 300 });

// 'half' (180 degrees) is treated as the one mm-accurate reference: the body radius is chosen so
// that a 180-degree arc around the cylinder has exactly canvasWidthMm of arc length.
const REFERENCE_WRAP_ANGLE_DEG = 180;

function assertPositiveFiniteNumber(value, label) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    throw new TypeError(`${label} must be a positive finite number.`);
  }
}

/**
 * @param {'front'|'wide'|'half'|'full'} wrapMode
 * @returns {number} The wrap angle in radians. Unknown/missing modes fall back to 'wide', matching
 *   this codebase's existing permissive-fallback style (see CupRenderer.js's own `|| 115`).
 */
export function wrapAngleRad(wrapMode) {
  const deg = WRAP_ANGLE_DEG[wrapMode] ?? WRAP_ANGLE_DEG.wide;
  return (deg * Math.PI) / 180;
}

/**
 * @param {number} canvasWidthMm The live project.canvas.width (mm).
 * @returns {number} Body radius in mm, anchored so a 180-degree arc equals canvasWidthMm exactly.
 */
export function computeBodyRadiusMm(canvasWidthMm) {
  assertPositiveFiniteNumber(canvasWidthMm, 'canvasWidthMm');
  const referenceRad = (REFERENCE_WRAP_ANGLE_DEG * Math.PI) / 180;
  return canvasWidthMm / referenceRad;
}

/**
 * Derives the 3D preview's physical (mm) body dimensions from the live project canvas size and the
 * active ObjectTemplate's schematic preview ratios (preview.topWidthFactor/bottomWidthFactor/
 * neckWidthFactor/neckHeightFactor/shoulderHeightFactor/capHeightFactor -- the same fields
 * src/renderer/CupRenderer.js already reads, reused here as real mm ratios instead of viewport-px
 * ratios). Never touches ObjectTemplate.js itself.
 *
 * @param {object} template A record from src/products/ObjectTemplate.js (getObjectTemplate()).
 * @param {number} canvasWidthMm
 * @param {number} canvasHeightMm
 * @returns {object} Plain mm dimensions consumed by ObjectGeometryBuilder.js.
 */
export function computeObjectDimensionsMm(template, canvasWidthMm, canvasHeightMm) {
  assertPositiveFiniteNumber(canvasHeightMm, 'canvasHeightMm');
  const preview = template.preview;
  const bodyRadiusMm = computeBodyRadiusMm(canvasWidthMm);
  const topRadiusMm = bodyRadiusMm * (preview.topWidthFactor / preview.bottomWidthFactor);
  const bodyHeightMm = canvasHeightMm;

  const dims = {
    kind: preview.kind,
    bodyRadiusMm,
    topRadiusMm,
    bodyHeightMm,
    hasHandle: Boolean(preview.hasHandle)
  };

  if (preview.kind === 'bottle') {
    dims.neckRadiusMm = bodyRadiusMm * (preview.neckWidthFactor / preview.bottomWidthFactor);
    dims.neckHeightMm = bodyHeightMm * preview.neckHeightFactor;
    dims.shoulderHeightMm = bodyHeightMm * preview.shoulderHeightFactor;
    dims.capHeightMm = bodyHeightMm * preview.capHeightFactor;
    dims.totalHeightMm = bodyHeightMm + dims.neckHeightMm + dims.shoulderHeightMm + dims.capHeightMm;
  } else {
    dims.totalHeightMm = bodyHeightMm;
  }

  return dims;
}
