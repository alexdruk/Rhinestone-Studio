/**
 * Pure millimeter-scale geometry math for the 3D preview (RS-1006), extended by S-107 (Front View
 * Frame & Long Text Workflow) to be the one place the production canvas's mm coordinate space and
 * the cylinder's azimuth (rotation) are related to each other.
 *
 * No Three.js import, no DOM/canvas dependency — this module only turns an ObjectTemplate record
 * (see src/products/ObjectTemplate.js) plus the live project canvas size into plain numbers. That
 * keeps it unit-testable the same way any other pure geometry module in this repository is, and
 * keeps the "what size is this object" decision independent of how it gets drawn.
 *
 * S-107: the production canvas is treated as the object's unwrapped surface -- the entire
 * canvasWidthMm maps exactly once around the full 360-degree circumference, seamlessly (canvas
 * x=0 and x=canvasWidthMm are the same physical point on the object, directly opposite the front).
 * This is what makes the Front View Frame (app.js) wrap continuously across the canvas's left/right
 * edges with no discontinuity, and it replaces the previous per-wrap-mode texture compression
 * ObjectGeometryBuilder.js's applyAzimuthUv() used to do (see that file's own history) -- the design
 * always wraps fully and continuously around the object now; wrap mode only controls how wide a
 * slice of that circumference the Front View Frame currently highlights (frontViewFrameWidthMm()
 * below), never what the object mesh's texture shows.
 *
 * A real object's size does not change when the operator picks a different wrap mode, so the body
 * radius is anchored once, at the fixed full-circumference reference, and reused for every wrap
 * mode.
 */

// Preview-only angular width (degrees) each wrap mode's Front View Frame covers, expressed as a
// fraction of the full 360-degree circumference (see frontViewFrameWidthMm()). 'front' is the
// narrowest ("label" style, mostly-flat), 'full' leaves a small uncovered gap opposite the seam
// (never a full 360, matching how a real full-wrap product design still needs a seam).
export const WRAP_ANGLE_DEG = Object.freeze({ front: 70, wide: 115, half: 180, full: 300 });

// The one mm-accurate reference this whole module is built on: a full 360-degree revolution
// around the cylinder has exactly canvasWidthMm of arc length -- the flat production canvas *is*
// the object's unwrapped surface, wrapping exactly once around it.
const REFERENCE_WRAP_ANGLE_DEG = 360;

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
 * @returns {number} Body radius in mm, anchored so a full 360-degree revolution equals
 *   canvasWidthMm of arc length exactly (see REFERENCE_WRAP_ANGLE_DEG above).
 */
export function computeBodyRadiusMm(canvasWidthMm) {
  assertPositiveFiniteNumber(canvasWidthMm, 'canvasWidthMm');
  const referenceRad = (REFERENCE_WRAP_ANGLE_DEG * Math.PI) / 180;
  return canvasWidthMm / referenceRad;
}

/**
 * The object's printable circumference in mm -- by construction (see computeBodyRadiusMm()) this
 * is exactly canvasWidthMm, but is exposed as its own named function so every caller states its
 * intent ("the object's circumference") rather than reaching for project.canvas.width directly.
 * Wrap-mode independent: a real object's circumference does not change with the previewed wrap.
 *
 * @param {number} canvasWidthMm
 * @returns {number} Circumference in mm.
 */
export function circumferenceMm(canvasWidthMm) {
  return 2 * Math.PI * computeBodyRadiusMm(canvasWidthMm);
}

// Wraps an angle (radians) into (-PI, PI] -- the canonical range for "how far around the object,
// signed, from dead-center front" used by every azimuth below.
function normalizeAzimuthRad(azimuthRad) {
  const twoPi = Math.PI * 2;
  const wrapped = ((azimuthRad % twoPi) + twoPi) % twoPi; // [0, 2*PI)
  return wrapped > Math.PI ? wrapped - twoPi : wrapped;
}

/**
 * Converts a production-canvas x position (mm, may fall outside [0, canvasWidthMm] for
 * off-canvas content) to the azimuth (radians, front = 0) it sits at once wrapped around the
 * object. Inverse of canvasXMmForAzimuthRad().
 *
 * @param {number} xMm
 * @param {number} canvasWidthMm
 * @returns {number} Azimuth in radians, normalized to (-PI, PI].
 */
export function azimuthRadForCanvasXMm(xMm, canvasWidthMm) {
  assertPositiveFiniteNumber(canvasWidthMm, 'canvasWidthMm');
  return normalizeAzimuthRad(((xMm / canvasWidthMm) - 0.5) * 2 * Math.PI);
}

/**
 * Converts an azimuth (radians, front = 0) to the production-canvas x position (mm) it corresponds
 * to. Inverse of azimuthRadForCanvasXMm(). Used both for the Front View Frame's on-canvas position
 * (app.js) and for the object mesh's own texture UV (ObjectGeometryBuilder.js's applyAzimuthUv()) --
 * the one shared formula that keeps the 2D canvas and the Object Preview mm-accurate and in sync.
 *
 * @param {number} azimuthRad
 * @param {number} canvasWidthMm
 * @returns {number} Canvas x position in mm (0.5*canvasWidthMm at azimuth 0, the front).
 */
export function canvasXMmForAzimuthRad(azimuthRad, canvasWidthMm) {
  assertPositiveFiniteNumber(canvasWidthMm, 'canvasWidthMm');
  return canvasWidthMm * (0.5 + azimuthRad / (2 * Math.PI));
}

/**
 * @param {number} rotationDeg The Object Preview's camera azimuth (app.js `rotation`, -180..180,
 *   0 = front) -- see Preview3DRenderer.js's _repositionCamera()/_currentAzimuthDeg(), which use
 *   the exact same atan2(x,z)-based convention this function assumes.
 * @param {number} canvasWidthMm
 * @returns {number} The production-canvas x (mm) of the point currently facing the viewer.
 */
export function canvasXMmForRotationDeg(rotationDeg, canvasWidthMm) {
  return canvasXMmForAzimuthRad(normalizeAzimuthRad((rotationDeg * Math.PI) / 180), canvasWidthMm);
}

/**
 * Inverse of canvasXMmForRotationDeg() -- given a canvas x (mm) the operator dragged the Front View
 * Frame to, returns the Object Preview rotation (degrees, -180..180) that faces that point at the
 * viewer.
 *
 * @param {number} xMm
 * @param {number} canvasWidthMm
 * @returns {number} Rotation in degrees, normalized to (-180, 180].
 */
export function rotationDegForCanvasXMm(xMm, canvasWidthMm) {
  return (azimuthRadForCanvasXMm(xMm, canvasWidthMm) * 180) / Math.PI;
}

/**
 * The Front View Frame's width in mm for a given wrap mode -- the arc length (in canvas-x mm,
 * per the reused canvasXMmForAzimuthRad() mapping) of the angular slice WRAP_ANGLE_DEG[wrapMode]
 * covers, centered on the front. Purely a viewing/highlight width: it never clips or resizes the
 * object mesh's texture (see this module's own top-of-file comment) or the generated StoneLayout.
 *
 * @param {'front'|'wide'|'half'|'full'} wrapMode
 * @param {number} canvasWidthMm
 * @returns {number} Frame width in mm.
 */
export function frontViewFrameWidthMm(wrapMode, canvasWidthMm) {
  return canvasXMmForAzimuthRad(wrapAngleRad(wrapMode) / 2, canvasWidthMm) - canvasXMmForAzimuthRad(-wrapAngleRad(wrapMode) / 2, canvasWidthMm);
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
