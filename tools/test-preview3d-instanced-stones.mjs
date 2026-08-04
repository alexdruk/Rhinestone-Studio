import assert from 'node:assert/strict';

// RS-2013 §4 step 4/7 — verifies Preview3DRenderer.js's instanced-stone mesh construction/placement/
// lighting/throttling. Step 4 introduced this behind a flag-gated `instancedStones` option; step 6c
// flipped its default to `true`; step 7 removed the flag (and the old texture-baking path) entirely,
// once the instanced path became the sole renderer -- update() now always builds/updates the
// instanced mesh, so every test below simply omits the option.
//
// Real 'three' + real ObjectGeometryBuilder.js (both pure computation, no WebGL context needed --
// same convention tools/test-object-geometry-builder.mjs already uses) so this exercises the
// actual geometry/placement code, not a re-description of it. init()'s own WebGLRenderer/
// OrbitControls/ResizeObserver (real browser/DOM dependencies) are bypassed entirely -- update()
// and the methods it calls never touch canvas/renderer.render()/OrbitControls beyond the plain
// fakes installed below (the same "mounted without a real init()" convention
// tools/test-preview3d-render-scheduling.mjs already uses for the scheduling tests).

globalThis.requestAnimationFrame = () => 0;

const THREE = await import('three');
const { buildObjectMesh, wallRadiusAt } = await import('../src/preview3d/ObjectGeometryBuilder.js');
const { azimuthRadForCanvasXMm } = await import('../src/preview3d/ObjectDimensions.js');
const { getCrystalAppearance } = await import('../src/renderer/CrystalAppearance.js');
const { getCrystalColor } = await import('../src/renderer/CrystalColors.js');
const { getObjectTemplate, normalizePlateParams } = await import('../src/products/index.js');
const { Stone } = await import('../src/geometry/Stone.js');
const { StoneLayout } = await import('../src/geometry/StoneLayout.js');
const { Preview3DRenderer } = await import('../src/preview3d/Preview3DRenderer.js');

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

// Builds a Preview3DRenderer "mounted" the way init() would leave it, but without any of init()'s
// real browser/DOM dependencies (WebGLRenderer needs a real canvas/GL context; OrbitControls needs
// a real DOM element to attach pointer listeners to). update() and everything it calls only ever
// touches this._THREE/this._buildObjectMesh/this._wallRadiusAt/this.scene/this.camera/
// this.controls/this.renderer -- all set here directly, mirroring exactly what init() itself
// assigns to those same fields.
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

function makeMugLayout() {
  return makeLayout([
    { xMm: 40, yMm: 20, sizeMm: 2.4, color: 'gold' },
    { xMm: 170, yMm: 60, sizeMm: 1.8, color: 'crystal' },
    { xMm: 105, yMm: 45, sizeMm: 3.0, color: 'topaz' }
  ]);
}

await test('1. update() builds a real THREE.InstancedMesh with one instance per stone, added alongside bodyMesh/handleMesh', async () => {
  const instance = makeMountedRenderer();
  const layout = makeMugLayout();
  instance.update(layout, MUG_OPTIONS);

  assert.ok(instance._stoneMesh instanceof THREE.InstancedMesh);
  assert.equal(instance._stoneMesh.count, layout.stones.length);
  assert.equal(instance._group.children.includes(instance._stoneMesh), true);
  assert.equal(instance._group.children.length, 3, 'expected bodyMesh + handleMesh + the instanced-stone mesh');
});

await test('2. the body never carries a design texture: bodyMesh.material.map stays null, body tinted to cupColor', async () => {
  const instance = makeMountedRenderer();
  const layout = makeMugLayout();
  instance.update(layout, MUG_OPTIONS);

  assert.equal(instance._bodyMesh.material.map, null);
  assert.equal(instance._bodyMesh.material.color.getHexString(), new THREE.Color(MUG_OPTIONS.cupColor).getHexString());
});

await test('3. a mug stone\'s instance matrix places it at the correct azimuth/radius/height and orients its local +Z along the outward radial normal', async () => {
  const instance = makeMountedRenderer();
  const stone = { xMm: 170, yMm: 60, sizeMm: 1.8, color: 'crystal' };
  const layout = makeLayout([stone]);
  instance.update(layout, MUG_OPTIONS);

  const dims = instance._dimensions;
  const azimuth = azimuthRadForCanvasXMm(stone.xMm, MUG_CANVAS.widthMm);
  const y = dims.bodyHeightMm - stone.yMm;
  const radius = wallRadiusAt(y, dims);
  const expectedPosition = new THREE.Vector3(radius * Math.sin(azimuth), y, radius * Math.cos(azimuth));

  const matrix = new THREE.Matrix4();
  instance._stoneMesh.getMatrixAt(0, matrix);
  const position = new THREE.Vector3();
  const quaternion = new THREE.Quaternion();
  const scale = new THREE.Vector3();
  matrix.decompose(position, quaternion, scale);

  // Matrix4/Vector3 store components as Float32Array internally (THREE.Matrix4.elements), so a
  // round-trip through setMatrixAt()/getMatrixAt() loses float64 precision -- tolerance reflects
  // float32 rounding, not placement-math error.
  assert.ok(position.distanceTo(expectedPosition) < 1e-4, `expected position ${expectedPosition.toArray()}, got ${position.toArray()}`);
  assert.ok(Math.abs(scale.x - stone.sizeMm / 2) < 1e-4, 'expected uniform scale = stone radius (sizeMm/2)');

  // The instance's local +Z axis (the octahedron's own apex-to-apex axis) rotated by `quaternion`
  // must land on the outward radial normal, before the per-instance facetAngleDeg spin (which
  // rotates *around* that same axis, so it never moves the axis itself away from the normal).
  const rotatedZ = new THREE.Vector3(0, 0, 1).applyQuaternion(quaternion);
  const expectedNormal = new THREE.Vector3(Math.sin(azimuth), 0, Math.cos(azimuth));
  assert.ok(rotatedZ.distanceTo(expectedNormal) < 1e-6, `expected local +Z aligned to outward normal ${expectedNormal.toArray()}, got ${rotatedZ.toArray()}`);

  const appearance = getCrystalAppearance(new Stone({ layerId: 'layer-1', index: 0, ...stone }));
  const expectedColor = new THREE.Color(getCrystalColor(stone.color).fill);
  const actualColor = new THREE.Color();
  instance._stoneMesh.getColorAt(0, actualColor);
  assert.equal(actualColor.getHexString(), expectedColor.getHexString());
  assert.ok(appearance.facetAngleDeg !== undefined, 'sanity check: getCrystalAppearance() returns a facetAngleDeg for this stone');
});

await test('4. a plate stone sits at the rim/well transition height with a straight-up (+Y) normal, no per-stone spin', async () => {
  const instance = makeMountedRenderer();
  const plateParams = normalizePlateParams(null);
  const canvasWidthMm = plateParams.outerDiameterMm;
  const canvasHeightMm = plateParams.outerDiameterMm;
  const stone = { xMm: canvasWidthMm / 2 + 30, yMm: canvasHeightMm / 2 - 10, sizeMm: 2.2, color: 'gold' };
  const layout = makeLayout([stone]);

  instance.update(layout, {
    cupColor: '#ffffff',
    objectTemplate: getObjectTemplate('plate'),
    canvasWidthMm,
    canvasHeightMm,
    plateParams
  });

  const matrix = new THREE.Matrix4();
  instance._stoneMesh.getMatrixAt(0, matrix);
  const position = new THREE.Vector3();
  const quaternion = new THREE.Quaternion();
  const scale = new THREE.Vector3();
  matrix.decompose(position, quaternion, scale);

  assert.ok(Math.abs(position.x - (stone.xMm - canvasWidthMm / 2)) < 1e-9);
  assert.ok(Math.abs(position.z - (stone.yMm - canvasHeightMm / 2)) < 1e-9);
  assert.ok(Math.abs(position.y - instance._plateTopY) < 1e-9, 'expected the stone\'s world Y to equal the cached plate rim/well transition height');

  const rotatedZ = new THREE.Vector3(0, 0, 1).applyQuaternion(quaternion);
  assert.ok(rotatedZ.distanceTo(new THREE.Vector3(0, 1, 0)) < 1e-6, 'expected local +Z aligned straight up (+Y) for the flat plate surface');
});

await test('5. a stone-count change (no geometry-key change) rebuilds the instanced mesh at the new count instead of leaving stale instances', async () => {
  const instance = makeMountedRenderer();
  const small = makeLayout([{ xMm: 40, yMm: 20, sizeMm: 2, color: 'gold' }]);
  const large = makeLayout([
    { xMm: 40, yMm: 20, sizeMm: 2, color: 'gold' },
    { xMm: 60, yMm: 30, sizeMm: 2, color: 'gold' },
    { xMm: 80, yMm: 40, sizeMm: 2, color: 'gold' }
  ]);

  instance.update(small, MUG_OPTIONS);
  assert.equal(instance._stoneMesh.count, 1);

  instance.update(large, MUG_OPTIONS);
  assert.equal(instance._stoneMesh.count, 3);
  assert.equal(instance._group.children.filter((c) => c instanceof THREE.InstancedMesh).length, 1, 'expected exactly one instanced-stone mesh, not a leaked stale one');
});

// --- RS-2013 §4 step 5b: throttled rebuild during a rapid same-count burst ---------------------

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

await test('6. a rapid same-count update() burst does not rebuild on every call: the second call within the throttle window leaves the mesh at the first call\'s position, but schedules a trailing rebuild that lands on the latest position once the window elapses', async () => {
  const instance = makeMountedRenderer();
  const first = makeLayout([{ xMm: 40, yMm: 20, sizeMm: 2, color: 'gold' }]);
  const second = makeLayout([{ xMm: 90, yMm: 70, sizeMm: 2, color: 'gold' }]);

  instance.update(first, MUG_OPTIONS);
  const matrixAfterFirst = new THREE.Matrix4();
  instance._stoneMesh.getMatrixAt(0, matrixAfterFirst);
  const posAfterFirst = new THREE.Vector3().setFromMatrixPosition(matrixAfterFirst);

  // Fires immediately after the first call (same synchronous tick) -- well inside the throttle
  // window, so this must NOT rebuild yet.
  instance.update(second, MUG_OPTIONS);
  const matrixRightAfterSecond = new THREE.Matrix4();
  instance._stoneMesh.getMatrixAt(0, matrixRightAfterSecond);
  const posRightAfterSecond = new THREE.Vector3().setFromMatrixPosition(matrixRightAfterSecond);
  assert.ok(posRightAfterSecond.distanceTo(posAfterFirst) < 1e-6, 'expected the throttled second call to leave the mesh at the first call\'s position (no immediate rebuild)');
  assert.ok(instance._instancedRebuildTimer !== null, 'expected a trailing rebuild to have been scheduled');

  // Wait past the throttle window: the trailing rebuild must have fired on its own, with the
  // *latest* (second) call's data, even though update() was never called a third time.
  await sleep(150);
  assert.equal(instance._instancedRebuildTimer, null, 'expected the trailing timer to have fired and cleared itself');
  const matrixAfterSettle = new THREE.Matrix4();
  instance._stoneMesh.getMatrixAt(0, matrixAfterSettle);
  const posAfterSettle = new THREE.Vector3().setFromMatrixPosition(matrixAfterSettle);
  assert.ok(posAfterSettle.distanceTo(posAfterFirst) > 1, 'expected the trailing rebuild to have moved the stone to the second call\'s (different) position');
});

await test('7. update() calls spaced further apart than the throttle window each rebuild immediately (no lag for ordinary, non-burst edits)', async () => {
  const instance = makeMountedRenderer();
  const first = makeLayout([{ xMm: 40, yMm: 20, sizeMm: 2, color: 'gold' }]);
  const second = makeLayout([{ xMm: 90, yMm: 70, sizeMm: 2, color: 'gold' }]);

  instance.update(first, MUG_OPTIONS);
  await sleep(150); // longer than the throttle window
  instance.update(second, MUG_OPTIONS);

  // No trailing rebuild should have been scheduled -- the second call rebuilt synchronously.
  assert.equal(instance._instancedRebuildTimer, null, 'expected no pending trailing rebuild -- the spaced-out call should rebuild immediately');
  const matrix = new THREE.Matrix4();
  instance._stoneMesh.getMatrixAt(0, matrix);
  const position = new THREE.Vector3().setFromMatrixPosition(matrix);
  const azimuth = azimuthRadForCanvasXMm(second.stones[0].xMm, MUG_CANVAS.widthMm);
  const dims = instance._dimensions;
  const y = dims.bodyHeightMm - second.stones[0].yMm;
  const radius = wallRadiusAt(y, dims);
  const expected = new THREE.Vector3(radius * Math.sin(azimuth), y, radius * Math.cos(azimuth));
  assert.ok(position.distanceTo(expected) < 1e-4, 'expected the immediately-rebuilt mesh to already reflect the second call\'s position');
});

await test('8. a stone-count change during a throttled burst still rebuilds immediately (capacity changes are never throttled)', async () => {
  const instance = makeMountedRenderer();
  const one = makeLayout([{ xMm: 40, yMm: 20, sizeMm: 2, color: 'gold' }]);
  const two = makeLayout([
    { xMm: 40, yMm: 20, sizeMm: 2, color: 'gold' },
    { xMm: 60, yMm: 30, sizeMm: 2, color: 'gold' }
  ]);

  instance.update(one, MUG_OPTIONS);
  instance.update(two, MUG_OPTIONS); // same tick, but capacity changed 1 -> 2

  assert.equal(instance._stoneMesh.count, 2, 'expected the capacity-changing call to rebuild immediately despite arriving inside the throttle window');
  assert.equal(instance._instancedRebuildTimer, null, 'expected no leftover pending rebuild from the immediate capacity-change path');
});

console.log('Preview3D instanced-stones tests passed.');
