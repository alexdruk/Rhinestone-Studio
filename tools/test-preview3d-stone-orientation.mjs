import assert from 'node:assert/strict';

// RS-3D stone orientation -- verifies Preview3DRenderer.js's _updateInstancedStones() non-plate
// branch: an explicit tangent-frame basis (forward = outward normal, up = world +Y, right =
// up x forward) replacing the old setFromUnitVectors(zAxis, normal) + random-spin construction,
// plus the small deterministic facetAngleDeg-derived jitter and the STONE_DEPTH_RATIO flat-back
// scale. Same "mounted without a real init()" convention as
// tools/test-preview3d-instanced-stones.mjs -- real 'three' + real ObjectGeometryBuilder.js, no
// WebGL/DOM. The plate branch is untouched by this milestone and already covered by that file's
// own test 4; nothing here re-tests it.

globalThis.requestAnimationFrame = () => 0;

const THREE = await import('three');
const { buildObjectMesh, wallRadiusAt } = await import('../src/preview3d/ObjectGeometryBuilder.js');
const { azimuthRadForCanvasXMm } = await import('../src/preview3d/ObjectDimensions.js');
const { getCrystalAppearance } = await import('../src/renderer/CrystalAppearance.js');
const { getObjectTemplate } = await import('../src/products/index.js');
const { Stone } = await import('../src/geometry/Stone.js');
const { StoneLayout } = await import('../src/geometry/StoneLayout.js');
const { Preview3DRenderer, STONE_DEPTH_RATIO } = await import('../src/preview3d/Preview3DRenderer.js');

async function test(name, fn) {
  try {
    await fn();
    console.log(`✓ ${name}`);
  } catch (error) {
    console.error(`✗ ${name}`);
    console.error(error);
    process.exitCode = 1;
  }
}

function makeLayout(stoneParams, layerId = 'layer-1') {
  const stones = stoneParams.map((p, index) => new Stone({ layerId, index, ...p }));
  return new StoneLayout({ layerId, stones });
}

// Same as tools/test-preview3d-instanced-stones.mjs's own makeMountedRenderer() -- see that
// file's comment for why each field is set directly instead of going through the real init().
function makeMountedRenderer() {
  const instance = new Preview3DRenderer({ getBoundingClientRect: () => ({ width: 400, height: 300 }) });
  instance._mounted = true;
  instance._THREE = THREE;
  instance._buildObjectMesh = buildObjectMesh;
  instance._wallRadiusAt = wallRadiusAt;
  instance.scene = new THREE.Scene();
  instance.camera = new THREE.PerspectiveCamera(35, 4 / 3, 1, 5000);
  instance.controls = {
    target: new THREE.Vector3(),
    update() {},
    saveState() {}
  };
  instance.renderer = { capabilities: { getMaxAnisotropy: () => 4 } };
  instance._ambientLight = new THREE.AmbientLight(0xffffff, 0.75);
  instance.scene.add(instance._ambientLight);
  return instance;
}

const MUG_CANVAS = { widthMm: 210, heightMm: 90 };
const MUG_OPTIONS = {
  cupColor: '#1f3556',
  objectTemplate: getObjectTemplate('mug'),
  canvasWidthMm: MUG_CANVAS.widthMm,
  canvasHeightMm: MUG_CANVAS.heightMm
};

// jitterRad's own formula, straight from _updateInstancedStones()'s non-plate branch -- maps the
// already-seeded [0,180) facetAngleDeg into a +-8deg band around the tangent-frame basis instead
// of using it as a full [0,180) spin.
function jitterRadForStone(stone) {
  const appearance = getCrystalAppearance(stone);
  return ((appearance.facetAngleDeg / 180) - 0.5) * ((16 * Math.PI) / 180);
}

await test('two same-azimuth, different-height stones: orientation quaternions differ only by each stone\'s own jitter about the normal', async () => {
  const instance = makeMountedRenderer();
  const stoneA = { xMm: 170, yMm: 15, sizeMm: 2.0, color: 'crystal' };
  const stoneB = { xMm: 170, yMm: 55, sizeMm: 2.0, color: 'crystal' };
  const layout = makeLayout([stoneA, stoneB]);
  instance.update(layout, MUG_OPTIONS);

  const zAxis = new THREE.Vector3(0, 0, 1);
  const basisQuaternions = [stoneA, stoneB].map((stone, i) => {
    const matrix = new THREE.Matrix4();
    instance._stoneMesh.getMatrixAt(i, matrix);
    const position = new THREE.Vector3();
    const quaternion = new THREE.Quaternion();
    const scale = new THREE.Vector3();
    matrix.decompose(position, quaternion, scale);

    const jitterRad = jitterRadForStone(new Stone({ layerId: 'layer-1', index: i, ...stone }));
    const qJitterInverse = new THREE.Quaternion().setFromAxisAngle(zAxis, jitterRad).invert();
    // quaternion === qAlign * qJitter (see _updateInstancedStones()), so right-multiplying by
    // qJitter's inverse recovers qAlign alone: qAlign * qJitter * qJitter^-1 = qAlign.
    return quaternion.multiply(qJitterInverse);
  });

  // Same azimuth (same xMm) means the same outward normal regardless of height/radius, so once
  // each stone's own jitter is divided out the two basis quaternions must be identical -- the
  // instanced mesh's float32 backing buffer (InstancedMesh.instanceMatrix) is the only source of
  // any residual difference.
  const angleBetween = basisQuaternions[0].angleTo(basisQuaternions[1]);
  assert.ok(angleBetween < 1e-4, `expected same-azimuth basis quaternions to match after removing jitter, got ${angleBetween} rad apart`);
});

await test('known azimuth: the tangent-frame basis maps local +Z to the outward radial normal and local +Y to world +Y', async () => {
  // Pure numeric check of the basis formula itself (forward = normal, up = world +Y, right =
  // up x forward -- see _updateInstancedStones()'s own comment), independent of any per-stone
  // jitter or of InstancedMesh's float32 backing buffer, so 1e-9 precision is meaningful here
  // (going through getMatrixAt() would only support float32-level precision, as
  // tools/test-preview3d-instanced-stones.mjs's own position/normal checks already reflect).
  const azimuth = azimuthRadForCanvasXMm(170, MUG_CANVAS.widthMm);
  const sinAz = Math.sin(azimuth);
  const cosAz = Math.cos(azimuth);
  const normal = new THREE.Vector3(sinAz, 0, cosAz);
  const worldUp = new THREE.Vector3(0, 1, 0);

  const rightV = new THREE.Vector3().crossVectors(worldUp, normal).normalize();
  const basisMatrix = new THREE.Matrix4().makeBasis(rightV, worldUp, normal);
  const qAlign = new THREE.Quaternion().setFromRotationMatrix(basisMatrix);

  const rotatedZ = new THREE.Vector3(0, 0, 1).applyQuaternion(qAlign);
  const rotatedY = new THREE.Vector3(0, 1, 0).applyQuaternion(qAlign);
  assert.ok(rotatedZ.distanceTo(normal) < 1e-9, `expected local +Z to map to the outward normal ${normal.toArray()}, got ${rotatedZ.toArray()}`);
  assert.ok(rotatedY.distanceTo(worldUp) < 1e-9, `expected local +Y to map to world +Y, got ${rotatedY.toArray()}`);
});

await test('a non-plate stone\'s local-Z (normal-axis) scale is flattened to radiusMm * STONE_DEPTH_RATIO; local X/Y stay at the full stone radius', async () => {
  const instance = makeMountedRenderer();
  const stone = { xMm: 170, yMm: 40, sizeMm: 3.2, color: 'gold' };
  const layout = makeLayout([stone]);
  instance.update(layout, MUG_OPTIONS);

  const matrix = new THREE.Matrix4();
  instance._stoneMesh.getMatrixAt(0, matrix);
  const position = new THREE.Vector3();
  const quaternion = new THREE.Quaternion();
  const scale = new THREE.Vector3();
  matrix.decompose(position, quaternion, scale);

  const radiusMm = stone.sizeMm / 2;
  assert.ok(Math.abs(scale.x - radiusMm) < 1e-4, `expected local X scale = stone radius, got ${scale.x}`);
  assert.ok(Math.abs(scale.y - radiusMm) < 1e-4, `expected local Y scale = stone radius, got ${scale.y}`);
  assert.ok(
    Math.abs(scale.z - radiusMm * STONE_DEPTH_RATIO) < 1e-4,
    `expected local Z scale = radiusMm * STONE_DEPTH_RATIO (${radiusMm * STONE_DEPTH_RATIO}), got ${scale.z}`
  );
});

console.log('Preview3D stone-orientation tests passed.');
