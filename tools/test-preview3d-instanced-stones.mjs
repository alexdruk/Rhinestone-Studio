import assert from 'node:assert/strict';

// RS-2013 §4 step 4 — verifies Preview3DRenderer.js's flag-gated `instancedStones` option in
// update(): (a) regression safety, `false`/omitted must be byte-identical to pre-step-4 behavior
// (the texture-baking path untouched), and (b) `true` must build a real THREE.InstancedMesh with
// the right instance count/positions/orientation for a known StoneLayout, reusing the same
// placement math tools/rs2013-instanced-stone-harness.html's step 2/3 already validated.
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

// A fake CanvasRenderingContext2D, same dependency-free convention tools/test-stone-layout-texture.mjs
// already uses -- only needed for the instancedStones:false path, which still runs the real
// _updateTexture()/drawStoneLayoutTexture() code.
function fakeCtx2D() {
  const target = {
    createRadialGradient() { return { addColorStop() {} }; },
    createLinearGradient() { return { addColorStop() {} }; },
    clearRect() {},
    fillRect() {},
    beginPath() {},
    fill() {}
  };
  return new Proxy(target, {
    get(obj, prop) { return prop in obj ? obj[prop] : () => {}; },
    set(obj, prop, value) { obj[prop] = value; return true; }
  });
}

// Node has no global `document` -- _updateTexture() calls document.createElement('canvas'). Only
// installed for the duration of a single test (restored after) so it never leaks into other
// tools/test-*.mjs files sharing this process... though run-tests.mjs already runs every file in
// its own child process, so this is redundant belt-and-suspenders, not load-bearing.
function installFakeDocument() {
  const previous = globalThis.document;
  globalThis.document = {
    createElement(tag) {
      assert.equal(tag, 'canvas', `unexpected document.createElement(${tag})`);
      return { width: 0, height: 0, getContext: (type) => (type === '2d' ? fakeCtx2D() : null) };
    }
  };
  return () => { globalThis.document = previous; };
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

// --- Regression safety: instancedStones false/omitted -------------------------------------------

await test('1. instancedStones omitted takes the exact pre-step-4 texture path: bodyMesh gets the CanvasTexture, no stone mesh exists', async () => {
  const restoreDocument = installFakeDocument();
  try {
    const instance = makeMountedRenderer();
    const layout = makeMugLayout();
    instance.update(layout, MUG_OPTIONS);

    assert.ok(instance._bodyMesh.material.map instanceof THREE.CanvasTexture, 'expected the baked stone texture assigned to bodyMesh.material.map');
    assert.equal(instance._stoneMesh, null, 'expected no instanced-stone mesh to have been created');
    assert.equal(instance._group.children.includes(instance._bodyMesh), true);
    // mug: bodyMesh + handleMesh only, no third (stone) mesh added to the group.
    assert.equal(instance._group.children.length, 2, 'expected only bodyMesh+handleMesh in the group, no instanced-stone mesh');
  } finally {
    restoreDocument();
  }
});

await test('2. instancedStones:false is identical to instancedStones omitted', async () => {
  const restoreDocument = installFakeDocument();
  try {
    const a = makeMountedRenderer();
    const b = makeMountedRenderer();
    const layout = makeMugLayout();
    a.update(layout, MUG_OPTIONS);
    b.update(layout, { ...MUG_OPTIONS, instancedStones: false });

    assert.ok(a._bodyMesh.material.map instanceof THREE.CanvasTexture);
    assert.ok(b._bodyMesh.material.map instanceof THREE.CanvasTexture);
    assert.equal(a._stoneMesh, null);
    assert.equal(b._stoneMesh, null);
    assert.equal(a._group.children.length, b._group.children.length);
  } finally {
    restoreDocument();
  }
});

await test('3. instancedStones false/omitted never touches the lighting rig: ambient stays at the original 0.75 intensity, no extra lights added to the scene', async () => {
  const restoreDocument = installFakeDocument();
  try {
    const instance = makeMountedRenderer();
    const layout = makeMugLayout();
    const sceneChildrenBefore = instance.scene.children.length;
    instance.update(layout, MUG_OPTIONS);
    instance.update(layout, MUG_OPTIONS);

    assert.equal(instance._ambientLight.intensity, 0.75, 'expected the default ambient intensity, untouched');
    assert.equal(instance.scene.children.length, sceneChildrenBefore + 1, 'expected only the group to have been added to the scene, no extra lights');
    assert.equal(instance._extraLights.length, 0);
  } finally {
    restoreDocument();
  }
});

// --- instancedStones:true --------------------------------------------------------------------

await test('4. instancedStones:true builds a real THREE.InstancedMesh with one instance per stone, added alongside bodyMesh/handleMesh', async () => {
  const instance = makeMountedRenderer();
  const layout = makeMugLayout();
  instance.update(layout, { ...MUG_OPTIONS, instancedStones: true });

  assert.ok(instance._stoneMesh instanceof THREE.InstancedMesh);
  assert.equal(instance._stoneMesh.count, layout.stones.length);
  assert.equal(instance._group.children.includes(instance._stoneMesh), true);
  assert.equal(instance._group.children.length, 3, 'expected bodyMesh + handleMesh + the new instanced-stone mesh');
});

await test('5. instancedStones:true skips the baked texture entirely: bodyMesh.material.map stays null, body tinted to cupColor', async () => {
  const instance = makeMountedRenderer();
  const layout = makeMugLayout();
  instance.update(layout, { ...MUG_OPTIONS, instancedStones: true });

  assert.equal(instance._bodyMesh.material.map, null);
  assert.equal(instance._bodyMesh.material.color.getHexString(), new THREE.Color(MUG_OPTIONS.cupColor).getHexString());
  assert.equal(instance._textureCanvas, null, '_updateTexture() must never have run -- no texture canvas lazily created');
});

await test('6. instancedStones:true lowers ambient and adds the two extended-rig directional lights exactly once', async () => {
  const instance = makeMountedRenderer();
  const layout = makeMugLayout();
  instance.update(layout, { ...MUG_OPTIONS, instancedStones: true });
  instance.update(layout, { ...MUG_OPTIONS, instancedStones: true });

  assert.equal(instance._ambientLight.intensity, 0.4);
  assert.equal(instance._extraLights.length, 2, 'expected exactly 2 extra lights, not re-added on the second update() call');
  for (const light of instance._extraLights) {
    assert.ok(light instanceof THREE.DirectionalLight);
    assert.equal(instance.scene.children.includes(light), true);
  }
});

await test('7. a mug stone\'s instance matrix places it at the correct azimuth/radius/height and orients its local +Z along the outward radial normal', async () => {
  const instance = makeMountedRenderer();
  const stone = { xMm: 170, yMm: 60, sizeMm: 1.8, color: 'crystal' };
  const layout = makeLayout([stone]);
  instance.update(layout, { ...MUG_OPTIONS, instancedStones: true });

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

await test('8. a plate stone sits at the rim/well transition height with a straight-up (+Y) normal, no per-stone spin', async () => {
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
    plateParams,
    instancedStones: true
  });

  const matrix = new THREE.Matrix4();
  instance._stoneMesh.getMatrixAt(0, matrix);
  const position = new THREE.Vector3();
  const quaternion = new THREE.Quaternion();
  const scale = new THREE.Vector3();
  matrix.decompose(position, quaternion, scale);

  assert.ok(Math.abs(position.x - (stone.xMm - canvasWidthMm / 2)) < 1e-9);
  assert.ok(Math.abs(position.z - (-(stone.yMm - canvasHeightMm / 2))) < 1e-9);
  assert.ok(Math.abs(position.y - instance._plateTopY) < 1e-9, 'expected the stone\'s world Y to equal the cached plate rim/well transition height');

  const rotatedZ = new THREE.Vector3(0, 0, 1).applyQuaternion(quaternion);
  assert.ok(rotatedZ.distanceTo(new THREE.Vector3(0, 1, 0)) < 1e-6, 'expected local +Z aligned straight up (+Y) for the flat plate surface');
});

await test('9. toggling instancedStones back to false tears the instanced mesh down and restores the default lighting rig, texture path resumes', async () => {
  const restoreDocument = installFakeDocument();
  try {
    const instance = makeMountedRenderer();
    const layout = makeMugLayout();
    instance.update(layout, { ...MUG_OPTIONS, instancedStones: true });
    assert.ok(instance._stoneMesh instanceof THREE.InstancedMesh);
    assert.equal(instance._ambientLight.intensity, 0.4);

    instance.update(layout, { ...MUG_OPTIONS, instancedStones: false });

    assert.equal(instance._stoneMesh, null, 'expected the instanced-stone mesh to be torn down');
    assert.equal(instance._group.children.length, 2, 'expected the group back to bodyMesh+handleMesh only');
    assert.equal(instance._ambientLight.intensity, 0.75, 'expected the default ambient intensity restored');
    assert.equal(instance._extraLights.length, 0, 'expected the extended rig\'s extra lights removed');
    assert.ok(instance._bodyMesh.material.map instanceof THREE.CanvasTexture, 'expected the texture path to resume');
  } finally {
    restoreDocument();
  }
});

await test('10. a stone-count change (no geometry-key change) rebuilds the instanced mesh at the new count instead of leaving stale instances', async () => {
  const instance = makeMountedRenderer();
  const small = makeLayout([{ xMm: 40, yMm: 20, sizeMm: 2, color: 'gold' }]);
  const large = makeLayout([
    { xMm: 40, yMm: 20, sizeMm: 2, color: 'gold' },
    { xMm: 60, yMm: 30, sizeMm: 2, color: 'gold' },
    { xMm: 80, yMm: 40, sizeMm: 2, color: 'gold' }
  ]);

  instance.update(small, { ...MUG_OPTIONS, instancedStones: true });
  assert.equal(instance._stoneMesh.count, 1);

  instance.update(large, { ...MUG_OPTIONS, instancedStones: true });
  assert.equal(instance._stoneMesh.count, 3);
  assert.equal(instance._group.children.filter((c) => c instanceof THREE.InstancedMesh).length, 1, 'expected exactly one instanced-stone mesh, not a leaked stale one');
});

// --- RS-2013 §4 step 5b: throttled rebuild during a rapid same-count burst ---------------------

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

await test('11. a rapid same-count update() burst does not rebuild on every call: the second call within the throttle window leaves the mesh at the first call\'s position, but schedules a trailing rebuild that lands on the latest position once the window elapses', async () => {
  const instance = makeMountedRenderer();
  const first = makeLayout([{ xMm: 40, yMm: 20, sizeMm: 2, color: 'gold' }]);
  const second = makeLayout([{ xMm: 90, yMm: 70, sizeMm: 2, color: 'gold' }]);

  instance.update(first, { ...MUG_OPTIONS, instancedStones: true });
  const matrixAfterFirst = new THREE.Matrix4();
  instance._stoneMesh.getMatrixAt(0, matrixAfterFirst);
  const posAfterFirst = new THREE.Vector3().setFromMatrixPosition(matrixAfterFirst);

  // Fires immediately after the first call (same synchronous tick) -- well inside the throttle
  // window, so this must NOT rebuild yet.
  instance.update(second, { ...MUG_OPTIONS, instancedStones: true });
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

await test('12. update() calls spaced further apart than the throttle window each rebuild immediately (no lag for ordinary, non-burst edits)', async () => {
  const instance = makeMountedRenderer();
  const first = makeLayout([{ xMm: 40, yMm: 20, sizeMm: 2, color: 'gold' }]);
  const second = makeLayout([{ xMm: 90, yMm: 70, sizeMm: 2, color: 'gold' }]);

  instance.update(first, { ...MUG_OPTIONS, instancedStones: true });
  await sleep(150); // longer than the throttle window
  instance.update(second, { ...MUG_OPTIONS, instancedStones: true });

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

await test('13. a stone-count change during a throttled burst still rebuilds immediately (capacity changes are never throttled)', async () => {
  const instance = makeMountedRenderer();
  const one = makeLayout([{ xMm: 40, yMm: 20, sizeMm: 2, color: 'gold' }]);
  const two = makeLayout([
    { xMm: 40, yMm: 20, sizeMm: 2, color: 'gold' },
    { xMm: 60, yMm: 30, sizeMm: 2, color: 'gold' }
  ]);

  instance.update(one, { ...MUG_OPTIONS, instancedStones: true });
  instance.update(two, { ...MUG_OPTIONS, instancedStones: true }); // same tick, but capacity changed 1 -> 2

  assert.equal(instance._stoneMesh.count, 2, 'expected the capacity-changing call to rebuild immediately despite arriving inside the throttle window');
  assert.equal(instance._instancedRebuildTimer, null, 'expected no leftover pending rebuild from the immediate capacity-change path');
});

await test('14. switching instancedStones off while a trailing rebuild is pending cancels it (no stale mesh resurrection)', async () => {
  const restoreDocument = installFakeDocument();
  try {
    const instance = makeMountedRenderer();
    const first = makeLayout([{ xMm: 40, yMm: 20, sizeMm: 2, color: 'gold' }]);
    const second = makeLayout([{ xMm: 90, yMm: 70, sizeMm: 2, color: 'gold' }]);

    instance.update(first, { ...MUG_OPTIONS, instancedStones: true });
    instance.update(second, { ...MUG_OPTIONS, instancedStones: true }); // throttled, schedules a trailing rebuild
    assert.ok(instance._instancedRebuildTimer !== null);

    instance.update(first, { ...MUG_OPTIONS, instancedStones: false }); // tears down before the trailing timer fires
    assert.equal(instance._instancedRebuildTimer, null, 'expected the pending trailing rebuild to have been cancelled by teardown');
    assert.equal(instance._stoneMesh, null);

    await sleep(150); // if the old timer had survived, it would throw/misbehave here
    assert.equal(instance._stoneMesh, null, 'expected no instanced mesh to have been resurrected by a stale timer');
  } finally {
    restoreDocument();
  }
});

console.log('Preview3D instanced-stones tests passed.');
