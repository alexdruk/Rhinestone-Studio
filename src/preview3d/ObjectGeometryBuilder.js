/**
 * Builds real Three.js geometry for the 3D preview (RS-1006) -- a real revolved mesh per object
 * template, not the schematic 2D silhouette src/renderer/CupRenderer.js draws.
 *
 * Geometry only: no material, texture, lighting, or camera decisions are made here. This module
 * never generates a StoneLayout, never reads a Project/Layer, and never invents a stone position --
 * it only turns already-computed mm dimensions (ObjectDimensions.js) plus an ObjectTemplate record
 * (src/products/ObjectTemplate.js) into THREE.BufferGeometry/Mesh objects. Consistent with
 * docs/ARCHITECTURE.md's "the renderer never computes geometry" contract, "geometry" there means
 * stone positions -- this module computes object-body shape, which is exactly what
 * CupRenderer.js's silhouette drawing already does for the 2D preview.
 *
 * Imports 'three' at the top of the file; nothing eagerly loads this module (see
 * Preview3DRenderer.js's dynamic import), so Three.js itself stays lazy-loaded in the browser.
 * Pure Three.js math/geometry classes (no WebGL context needed) also run fine under plain Node,
 * which is what lets tools/test-object-geometry-builder.mjs exercise this module directly.
 */
import * as THREE from 'three';
import { computeObjectDimensionsMm } from './ObjectDimensions.js';

const LATHE_SEGMENTS = 48;
const HANDLE_TUBE_SEGMENTS = 32;
const HANDLE_RADIAL_SEGMENTS = 8;

// RS-1006A: mug/tumbler rim modeling (see buildTaperedBodyGeometry()). A bare frustum with an open
// top read as a generic truncated cone -- these constants model a real rim's wall thickness: the
// wall flares slightly proud of itself right at the true top of the object (RIM_TOP_FRACTION = 1,
// so the object's overall bounding-box height is unchanged -- no camera-framing or bounding-box
// test needed updating), then folds back inward, which is what reads as the mouth's wall thickness.
const RIM_FLARE_START_FRACTION = 0.955; // where the wall begins flaring into the rim, fraction of bodyHeightMm
const RIM_TOP_FRACTION = 1.0; // the rim's outer top edge -- exactly the object's full height
const RIM_INNER_FRACTION = 0.915; // where the rim folds back inward, fraction of bodyHeightMm
const RIM_OUTER_RADIUS_FACTOR = 1.015; // the rim's outer lip flares slightly proud of the wall radius there
const RIM_INNER_RADIUS_FACTOR = 0.88; // the inner rim wall, relative to the wall radius at the rim -- reads as wall thickness

// Handle geometry proportions (mug only), expressed relative to the body's own mm
// dimensions -- mirrors CupRenderer.js's HANDLE_ATTACH_TOP_FRACTION/HANDLE_ATTACH_BOTTOM_FRACTION
// convention, but as an independent set of constants: this is a different rendering paradigm (a
// real 3D tube, not a stroked 2D bezier), so the two are not shared code, only a shared idea.
const HANDLE_ATTACH_TOP_FRACTION = 0.16;
const HANDLE_ATTACH_BOTTOM_FRACTION = 0.83;
const HANDLE_BULGE_FRACTION = 0.55; // outward from the wall, relative to bodyRadiusMm
const HANDLE_TUBE_RADIUS_FRACTION = 0.11; // relative to bodyRadiusMm
// RS-1006A: how many tube-radii past the wall surface each attachment end is buried, so the tube's
// own open end sits inside solid body geometry (occluded by the wall's own front face from any
// outside camera angle) instead of floating at/just touching the surface -- see
// "Handle attachment" in docs/specifications/RS-1006A-PreviewCorrections.md.
const HANDLE_EMBED_FACTOR = 1.6;

/**
 * Builds a Group for one ObjectTemplate at the given live production-canvas mm size.
 *
 * @param {object} template A record from src/products/ObjectTemplate.js.
 * @param {number} canvasWidthMm
 * @param {number} canvasHeightMm
 * @returns {{group: THREE.Group, bodyMesh: THREE.Mesh, handleMesh: THREE.Mesh|null, dimensions: object}}
 *   `bodyMesh` is the one surface the caller applies the StoneLayout canvas texture to.
 *   `dimensions` is computeObjectDimensionsMm()'s own result, so the caller can frame its camera
 *   without recomputing radius/height itself.
 */
export function buildObjectMesh(template, canvasWidthMm, canvasHeightMm) {
  const dimensions = computeObjectDimensionsMm(template, canvasWidthMm, canvasHeightMm);
  const group = new THREE.Group();

  const bodyGeometry = dimensions.kind === 'bottle'
    ? buildBottleGeometry(dimensions)
    : buildTaperedBodyGeometry(dimensions);
  applyBodyHeightUv(bodyGeometry, dimensions.bodyHeightMm);
  applyAzimuthUv(bodyGeometry);

  // RS-1006A: FrontSide, not DoubleSide -- a solid opaque vessel never needs its interior faces
  // rendered from an outside camera. Rendering them (the RS-1006 default) is what caused the
  // tumbler/mug duplicated-artwork defect: looking across the open mouth made the far interior
  // wall's backface visible, carrying the same design texture as the near exterior wall. See
  // "Duplicate artwork" in docs/specifications/RS-1006A-PreviewCorrections.md.
  const bodyMaterial = new THREE.MeshStandardMaterial({ roughness: 0.55, metalness: 0.05, side: THREE.FrontSide });
  const bodyMesh = new THREE.Mesh(bodyGeometry, bodyMaterial);
  group.add(bodyMesh);

  let handleMesh = null;
  if (dimensions.hasHandle) {
    handleMesh = buildHandleMesh(dimensions);
    group.add(handleMesh);
  }

  return { group, bodyMesh, handleMesh, dimensions };
}

// Mug/tumbler body (RS-1006A): a revolved profile (THREE.LatheGeometry, the same primitive the
// bottle already used) instead of a bare open-ended frustum. A plain frustum read as a generic
// truncated cone/lampshade, not a mug -- a real vessel has a solid, visible base and a mouth with
// wall thickness. This profile: a closed flat base (degenerate r=0 point, exactly like the bottle's
// own base below), the existing linear wall taper up to RIM_FLARE_START_FRACTION of bodyHeightMm,
// then a modeled rim -- the wall flares slightly proud of itself up to the object's true top
// (RIM_TOP_FRACTION = 1, so the overall bounding-box height is unchanged), then folds back inward
// (RIM_INNER_FRACTION/RIM_INNER_RADIUS_FACTOR), which is what reads as the mouth's wall thickness.
// The mouth itself stays open below that fold (no cap) -- a mug/tumbler is genuinely open on top.
// See "Mug/tumbler body" in docs/specifications/RS-1006A-PreviewCorrections.md.
function buildTaperedBodyGeometry(dimensions) {
  const { bodyRadiusMm, bodyHeightMm } = dimensions;
  const rimFlareY = bodyHeightMm * RIM_FLARE_START_FRACTION;
  const rimTopY = bodyHeightMm * RIM_TOP_FRACTION;
  const rimInnerY = bodyHeightMm * RIM_INNER_FRACTION;
  const rimTopRadius = wallRadiusAt(rimTopY, dimensions);

  const points = [
    new THREE.Vector2(0, 0),
    new THREE.Vector2(bodyRadiusMm, 0),
    new THREE.Vector2(wallRadiusAt(rimFlareY, dimensions), rimFlareY),
    new THREE.Vector2(rimTopRadius * RIM_OUTER_RADIUS_FACTOR, rimTopY),
    new THREE.Vector2(rimTopRadius * RIM_INNER_RADIUS_FACTOR, rimInnerY)
  ];
  // S-107 follow-up: phiStart=-PI (not the THREE.js default 0) puts LatheGeometry's own seam --
  // the one column pair (first/last) it never actually joins with a face -- directly opposite the
  // +Z "front" azimuth applyAzimuthUv() below centers the texture on, instead of directly at front.
  // See applyAzimuthUv()'s own comment for why this placement matters.
  return new THREE.LatheGeometry(points, LATHE_SEGMENTS, -Math.PI, Math.PI * 2);
}

// Bottle body+shoulder+neck+cap: one revolved profile (a THREE.LatheGeometry), closed at both ends
// by degenerate (r=0) points rather than separate cap geometry -- this keeps the whole silhouette
// one continuous surface with one UV space. RS-1006A: added one intermediate shoulder control point
// (a curved, not straight-diagonal, taper into the neck) and a short flared section before the cap
// closes (reads as a flat-topped cap, not a cone tapering to a point) -- both closer to a
// recognizable bottle silhouette. min/max Y (0 and totalHeightMm) are unchanged by these added
// points, so the bounding-box height contract existing tests check is unaffected.
function buildBottleGeometry(dimensions) {
  const { bodyRadiusMm, neckRadiusMm, neckHeightMm, shoulderHeightMm, capHeightMm, bodyHeightMm } = dimensions;
  const shoulderTopY = bodyHeightMm + shoulderHeightMm;
  const neckTopY = shoulderTopY + neckHeightMm;
  const capTopY = neckTopY + capHeightMm;
  const shoulderMidY = bodyHeightMm + shoulderHeightMm * 0.55;
  const shoulderMidRadius = neckRadiusMm + (bodyRadiusMm - neckRadiusMm) * 0.42;
  const capRadius = neckRadiusMm * 1.18;

  const points = [
    new THREE.Vector2(0, 0),
    new THREE.Vector2(bodyRadiusMm, 0),
    new THREE.Vector2(bodyRadiusMm, bodyHeightMm),
    new THREE.Vector2(shoulderMidRadius, shoulderMidY),
    new THREE.Vector2(neckRadiusMm, shoulderTopY),
    new THREE.Vector2(neckRadiusMm, neckTopY),
    new THREE.Vector2(capRadius, neckTopY + capHeightMm * 0.18),
    new THREE.Vector2(capRadius, capTopY - capHeightMm * 0.25),
    new THREE.Vector2(0, capTopY)
  ];
  // S-107 follow-up: see the matching comment in buildTaperedBodyGeometry() above -- phiStart=-PI
  // moves LatheGeometry's own unconnected seam to the back, opposite front.
  return new THREE.LatheGeometry(points, LATHE_SEGMENTS, -Math.PI, Math.PI * 2);
}

// RS-1006A: writes a custom V coordinate per vertex -- the vertex's real millimeter Y position
// divided by the body's own printable height, independent of arc length along the profile. Without
// this, THREE.LatheGeometry's default V (proportional to cumulative arc length along the *whole*
// profile) stretched the body-sized design texture across the bottle's shoulder/neck/cap too (the
// "printable area extends onto the shoulder" defect). With it, v=0 at the base and v=1 at the top of
// the printable body for every object kind (matching what THREE.CylinderGeometry's own default V
// already did for the old mug/tumbler frustum -- no regression there); points above bodyHeightMm
// (bottle shoulder/neck/cap, and the new mug/tumbler rim fold) get v>1, which ClampToEdgeWrapping
// (set on the texture in Preview3DRenderer.js) clamps to the texture's own top-edge texel -- plain
// background color, not stretched design. See "Bottle texture containment" in
// docs/specifications/RS-1006A-PreviewCorrections.md.
function applyBodyHeightUv(geometry, bodyHeightMm) {
  const position = geometry.attributes.position;
  const uv = geometry.attributes.uv;
  for (let i = 0; i < position.count; i++) {
    uv.setY(i, position.getY(i) / bodyHeightMm);
  }
  uv.needsUpdate = true;
}

function wallRadiusAt(y, dimensions) {
  const { bodyRadiusMm, topRadiusMm, bodyHeightMm } = dimensions;
  const t = Math.max(0, Math.min(1, y / bodyHeightMm));
  return bodyRadiusMm + (topRadiusMm - bodyRadiusMm) * t;
}

// Mug handle: a single tube revolved along a Catmull-Rom curve anchored to the wall at two
// points and bulging outward at the back (-Z, opposite the +Z front azimuth applyAzimuthUv() maps
// the texture's center onto) -- schematic, but a real 3D tube rather than a 2D stroked path.
//
// RS-1006A: the curve's two wall-attachment endpoints are pulled HANDLE_EMBED_FACTOR tube-radii
// past the wall surface, toward the body's own axis (`embedTopZ`/`embedBotZ`), instead of sitting
// exactly on it (`surfaceTopZ`/`surfaceBotZ` -- the RS-1006 endpoints). TubeGeometry's ends are
// open/uncapped; placed exactly on the wall, that open end sat right at the visible surface and
// read as a floating loop with a gap. Buried past the surface, the body wall's own front face sits
// between any outside camera and the tube's open end, so ordinary depth occlusion hides the seam --
// the handle now reads as welded into the wall. See "Handle attachment" in
// docs/specifications/RS-1006A-PreviewCorrections.md.
function buildHandleMesh(dimensions) {
  const { bodyRadiusMm, bodyHeightMm } = dimensions;
  const attachTopY = bodyHeightMm * HANDLE_ATTACH_TOP_FRACTION;
  const attachBotY = bodyHeightMm * HANDLE_ATTACH_BOTTOM_FRACTION;
  const bulge = bodyRadiusMm * HANDLE_BULGE_FRACTION;
  const tubeRadius = Math.max(0.6, bodyRadiusMm * HANDLE_TUBE_RADIUS_FRACTION);
  const embed = tubeRadius * HANDLE_EMBED_FACTOR;

  const surfaceTopZ = -wallRadiusAt(attachTopY, dimensions);
  const surfaceBotZ = -wallRadiusAt(attachBotY, dimensions);
  const embedTopZ = surfaceTopZ + embed;
  const embedBotZ = surfaceBotZ + embed;
  const midY1 = attachTopY + (attachBotY - attachTopY) * 0.3;
  const midY2 = attachTopY + (attachBotY - attachTopY) * 0.7;

  const curve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0, attachTopY, embedTopZ),
    new THREE.Vector3(0, midY1, surfaceTopZ - bulge),
    new THREE.Vector3(0, midY2, surfaceBotZ - bulge),
    new THREE.Vector3(0, attachBotY, embedBotZ)
  ]);

  const handleGeometry = new THREE.TubeGeometry(curve, HANDLE_TUBE_SEGMENTS, tubeRadius, HANDLE_RADIAL_SEGMENTS, false);
  const handleMaterial = new THREE.MeshStandardMaterial({ roughness: 0.55, metalness: 0.05 });
  return new THREE.Mesh(handleGeometry, handleMaterial);
}

// S-109: writes a custom U coordinate per vertex at the object's true, wrap-mode-independent
// circumference scale -- U = 0.5 + azimuth/(2*PI), the exact same mm-accurate mapping
// ObjectDimensions.js's canvasXMmForAzimuthRad()/canvasWidthMm relation already defines for the
// Front View Frame (U is that function's canvasXMm/canvasWidthMm, dimensionless, so it needs no
// canvasWidthMm parameter here). This keeps the Object Preview's texture at the same position/
// scale/proportions as the 2D Canvas for every wrap mode, matching the requirement that the two
// views agree subject only to normal cylindrical perspective. Wrap mode keeps its own meaning --
// it still sizes the Front View Frame's highlighted width (frontViewFrameWidthMm(),
// unchanged) and still drives any printable-circumference validation -- it just no longer rescales
// the object mesh's own texture, which was never true 1:1 mm scale (see the milestone's own
// audit in docs/specifications/S-109-SvgObjectPreviewProjectionConsistency.md for the prior,
// wrap-compressed behavior and why it was replaced). Because this mapping no longer depends on
// wrap mode, it is computed once at mesh-build time (buildObjectMesh(), alongside
// applyBodyHeightUv()) instead of being re-invoked on every wrap-mode change.
//
// Deliberately does NOT derive each vertex's azimuth from its own position via Math.atan2(x,z) --
// two independent, real bugs came from that (both root-caused with
// tools/test-object-geometry-builder.mjs's UV-continuity check and confirmed visually as dark
// vertical bands on the object):
//  1. atan2 only ever returns a value in (-PI, PI]. LatheGeometry connects every column to its
//     neighbor with a real face all the way around (48 faces from 49 columns) -- one of those
//     columns necessarily sits right at that +-PI branch cut, so its face's three vertices would
//     get azimuths like +PI and -PI+epsilon: a ~2*PI swing in a single, real, adjacent-column
//     triangle, stretching that triangle's texture sample across nearly the whole canvas width.
//  2. At r=0 (the base/cap apex, x=z=0 for every column), Math.atan2(x,z)'s result depends on the
//     *sign* of each zero (IEEE 754 distinguishes +0/-0, and atan2(+-0,+-0) is defined per-quadrant
//     by that sign) -- which flips essentially arbitrarily column to column, giving neighboring
//     apex vertices wildly different, meaningless azimuths despite sitting at the identical point.
// Both are avoided by computing azimuth from the column's own known construction angle (column
// index / LATHE_SEGMENTS, matching buildTaperedBodyGeometry()/buildBottleGeometry()'s
// phiStart=-PI, phiLength=2*PI) instead of reverse-engineering it from position: this is exactly
// the angle LatheGeometry itself used to place that column, so it is defined (and continuous with
// every real neighboring face) even at r=0, and its one unavoidable wrap (column 0 to column
// LATHE_SEGMENTS, both at the back, azimuth +-PI) falls exactly on the one column pair
// LatheGeometry never actually joins with a face -- the only place a UV discontinuity is safe.
//
// V is left untouched here -- it is set once at build time by applyBodyHeightUv() above.
function applyAzimuthUv(geometry) {
  const position = geometry.attributes.position;
  const uv = geometry.attributes.uv;
  const columnCount = LATHE_SEGMENTS + 1;
  const rowCount = position.count / columnCount;
  for (let i = 0; i < position.count; i++) {
    const column = Math.floor(i / rowCount);
    const azimuth = -Math.PI + (column / LATHE_SEGMENTS) * 2 * Math.PI;
    uv.setX(i, 0.5 + azimuth / (2 * Math.PI));
  }
  uv.needsUpdate = true;
}
