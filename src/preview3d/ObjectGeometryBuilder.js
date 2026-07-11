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
import { computeObjectDimensionsMm, wrapAngleRad } from './ObjectDimensions.js';

const BODY_RADIAL_SEGMENTS = 48;
const LATHE_SEGMENTS = 48;
const HANDLE_TUBE_SEGMENTS = 32;
const HANDLE_RADIAL_SEGMENTS = 8;

// Handle geometry proportions (mug only), expressed relative to the body's own mm
// dimensions -- mirrors CupRenderer.js's HANDLE_ATTACH_TOP_FRACTION/HANDLE_ATTACH_BOTTOM_FRACTION
// convention, but as an independent set of constants: this is a different rendering paradigm (a
// real 3D tube, not a stroked 2D bezier), so the two are not shared code, only a shared idea.
const HANDLE_ATTACH_TOP_FRACTION = 0.16;
const HANDLE_ATTACH_BOTTOM_FRACTION = 0.83;
const HANDLE_BULGE_FRACTION = 0.55; // outward from the wall, relative to bodyRadiusMm
const HANDLE_TUBE_RADIUS_FRACTION = 0.11; // relative to bodyRadiusMm

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
    : buildCylinderBodyGeometry(dimensions);

  const bodyMaterial = new THREE.MeshStandardMaterial({ roughness: 0.55, metalness: 0.05, side: THREE.DoubleSide });
  const bodyMesh = new THREE.Mesh(bodyGeometry, bodyMaterial);
  group.add(bodyMesh);

  let handleMesh = null;
  if (dimensions.hasHandle) {
    handleMesh = buildHandleMesh(dimensions);
    group.add(handleMesh);
  }

  return { group, bodyMesh, handleMesh, dimensions };
}

// Mug/tumbler body: a plain tapered cylinder, open at both ends (a mug's mouth is genuinely open;
// its base is not rendered from below at any reachable camera angle worth the extra cap-UV
// complexity -- see applyAzimuthUv()'s note on why caps are avoided entirely). Centered on the
// origin by default (Three.js convention); translated so y=0 is the base, matching the bottle
// lathe profile's own coordinate convention below.
function buildCylinderBodyGeometry(dimensions) {
  const { topRadiusMm, bodyRadiusMm, bodyHeightMm } = dimensions;
  const geometry = new THREE.CylinderGeometry(topRadiusMm, bodyRadiusMm, bodyHeightMm, BODY_RADIAL_SEGMENTS, 1, true);
  geometry.translate(0, bodyHeightMm / 2, 0);
  return geometry;
}

// Bottle body+shoulder+neck+cap: one revolved profile (a THREE.LatheGeometry), closed at both ends
// by degenerate (r=0) points rather than separate cap geometry -- this keeps the whole silhouette
// one continuous surface with one UV space, so applyAzimuthUv() below needs no cap-vs-side
// special-casing the way a capped CylinderGeometry would.
function buildBottleGeometry(dimensions) {
  const { bodyRadiusMm, neckRadiusMm, neckHeightMm, shoulderHeightMm, capHeightMm, bodyHeightMm } = dimensions;
  const shoulderTopY = bodyHeightMm + shoulderHeightMm;
  const neckTopY = shoulderTopY + neckHeightMm;
  const capTopY = neckTopY + capHeightMm;

  const points = [
    new THREE.Vector2(0, 0),
    new THREE.Vector2(bodyRadiusMm, 0),
    new THREE.Vector2(bodyRadiusMm, bodyHeightMm),
    new THREE.Vector2(neckRadiusMm, shoulderTopY),
    new THREE.Vector2(neckRadiusMm, neckTopY),
    new THREE.Vector2(neckRadiusMm * 0.55, capTopY),
    new THREE.Vector2(0, capTopY)
  ];
  return new THREE.LatheGeometry(points, LATHE_SEGMENTS);
}

function wallRadiusAt(y, dimensions) {
  const { bodyRadiusMm, topRadiusMm, bodyHeightMm } = dimensions;
  const t = Math.max(0, Math.min(1, y / bodyHeightMm));
  return bodyRadiusMm + (topRadiusMm - bodyRadiusMm) * t;
}

// Mug handle: a single tube revolved along a Catmull-Rom curve anchored to the wall at two
// points and bulging outward at the back (-Z, opposite the +Z front azimuth applyAzimuthUv() maps
// the texture's center onto) -- schematic, but a real 3D tube rather than a 2D stroked path.
function buildHandleMesh(dimensions) {
  const { bodyRadiusMm, bodyHeightMm } = dimensions;
  const attachTopY = bodyHeightMm * HANDLE_ATTACH_TOP_FRACTION;
  const attachBotY = bodyHeightMm * HANDLE_ATTACH_BOTTOM_FRACTION;
  const bulge = bodyRadiusMm * HANDLE_BULGE_FRACTION;
  const tubeRadius = Math.max(0.6, bodyRadiusMm * HANDLE_TUBE_RADIUS_FRACTION);

  const zTop = -wallRadiusAt(attachTopY, dimensions);
  const zBot = -wallRadiusAt(attachBotY, dimensions);
  const midY1 = attachTopY + (attachBotY - attachTopY) * 0.3;
  const midY2 = attachTopY + (attachBotY - attachTopY) * 0.7;

  const curve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0, attachTopY, zTop),
    new THREE.Vector3(0, midY1, zTop - bulge),
    new THREE.Vector3(0, midY2, zBot - bulge),
    new THREE.Vector3(0, attachBotY, zBot)
  ]);

  const handleGeometry = new THREE.TubeGeometry(curve, HANDLE_TUBE_SEGMENTS, tubeRadius, HANDLE_RADIAL_SEGMENTS, false);
  const handleMaterial = new THREE.MeshStandardMaterial({ roughness: 0.55, metalness: 0.05 });
  return new THREE.Mesh(handleGeometry, handleMaterial);
}

// Writes a custom U coordinate per vertex: azimuth (atan2(x,z), 0 at +Z -- the default camera's
// front-facing direction) mapped onto [0,1] across `angleRad`'s window, centered on the front. V is
// left untouched (CylinderGeometry/LatheGeometry already compute a correct vertical V). Combined
// with ClampToEdgeWrapping (set by Preview3DRenderer.js on the texture itself), vertices outside
// the wrap window clamp to the texture's own edge texels -- which are always plain background
// color (StoneLayoutTexture.js's fill), so the rest of the body reads as a seamless plain surface.
function applyAzimuthUv(geometry, angleRad) {
  const position = geometry.attributes.position;
  const uv = geometry.attributes.uv;
  for (let i = 0; i < position.count; i++) {
    const azimuth = Math.atan2(position.getX(i), position.getZ(i));
    uv.setX(i, 0.5 + azimuth / angleRad);
  }
  uv.needsUpdate = true;
}

/**
 * Re-maps `bodyMesh`'s UV so the shared texture covers exactly `wrapMode`'s angular window,
 * centered on the front. Cheap (tens to low hundreds of vertices) -- safe to call every time the
 * operator changes wrap mode, not only when the mesh is rebuilt.
 *
 * @param {THREE.Mesh} bodyMesh
 * @param {'front'|'wide'|'half'|'full'} wrapMode
 */
export function applyWrapUv(bodyMesh, wrapMode) {
  applyAzimuthUv(bodyMesh.geometry, wrapAngleRad(wrapMode));
}
