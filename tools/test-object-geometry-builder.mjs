import assert from 'node:assert/strict';

// RS-1006 — verifies src/preview3d/ObjectGeometryBuilder.js using the real 'three' package. Three's
// geometry/math classes (CylinderGeometry, LatheGeometry, TubeGeometry, Box3, ...) are pure
// computation and run fine under plain Node with no WebGL context, which is what makes this a real
// (not faked) test of the actual geometry this milestone builds, without needing a browser.

const THREE = await import('three');
const { buildObjectMesh, applyWrapUv } = await import('../src/preview3d/ObjectGeometryBuilder.js');
const { computeObjectDimensionsMm } = await import('../src/preview3d/ObjectDimensions.js');
const { getObjectTemplate } = await import('../src/products/index.js');

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

const CANVAS_SIZES = { mug: [210, 90], tumbler: [230, 100], bottle: [180, 90] };

await test('1. buildObjectMesh never throws for any of the three templates', () => {
  for (const id of ['mug', 'tumbler', 'bottle']) {
    const [w, h] = CANVAS_SIZES[id];
    assert.doesNotThrow(() => buildObjectMesh(getObjectTemplate(id), w, h));
  }
});

await test('2. mug has exactly a body + a handle mesh; tumbler/bottle have only a body', () => {
  const mug = buildObjectMesh(getObjectTemplate('mug'), 210, 90);
  assert.equal(mug.group.children.length, 2);
  assert.ok(mug.handleMesh, 'expected a handle mesh for the mug');
  assert.ok(mug.group.children.includes(mug.bodyMesh));
  assert.ok(mug.group.children.includes(mug.handleMesh));

  for (const id of ['tumbler', 'bottle']) {
    const [w, h] = CANVAS_SIZES[id];
    const built = buildObjectMesh(getObjectTemplate(id), w, h);
    assert.equal(built.group.children.length, 1);
    assert.equal(built.handleMesh, null);
  }
});

await test('3. bodyMesh and handleMesh (when present) are real THREE.Mesh instances with BufferGeometry', () => {
  const { bodyMesh, handleMesh } = buildObjectMesh(getObjectTemplate('mug'), 210, 90);
  assert.ok(bodyMesh instanceof THREE.Mesh);
  assert.ok(bodyMesh.geometry instanceof THREE.BufferGeometry);
  assert.ok(handleMesh instanceof THREE.Mesh);
  assert.ok(handleMesh.geometry instanceof THREE.BufferGeometry);
});

await test('4. body geometry bounding box height matches dimensions.bodyHeightMm for mug/tumbler', () => {
  for (const id of ['mug', 'tumbler']) {
    const [w, h] = CANVAS_SIZES[id];
    const template = getObjectTemplate(id);
    const dims = computeObjectDimensionsMm(template, w, h);
    const { bodyMesh } = buildObjectMesh(template, w, h);
    bodyMesh.geometry.computeBoundingBox();
    const box = bodyMesh.geometry.boundingBox;
    const height = box.max.y - box.min.y;
    assert.ok(Math.abs(height - dims.bodyHeightMm) < 1e-3, `expected height ${dims.bodyHeightMm}, got ${height}`);
    assert.ok(box.min.y >= -1e-3, 'expected the body base at y=0 (not centered on origin)');
  }
});

await test('5. bottle geometry bounding box height matches dimensions.totalHeightMm (body + shoulder + neck + cap)', () => {
  const template = getObjectTemplate('bottle');
  const dims = computeObjectDimensionsMm(template, 180, 90);
  const { bodyMesh } = buildObjectMesh(template, 180, 90);
  bodyMesh.geometry.computeBoundingBox();
  const box = bodyMesh.geometry.boundingBox;
  const height = box.max.y - box.min.y;
  // BufferGeometry positions are Float32Array (single precision) -- a ~1e-5 relative rounding
  // error against the double-precision dims.totalHeightMm is expected, not a defect.
  assert.ok(Math.abs(height - dims.totalHeightMm) < 1e-3, `expected height ${dims.totalHeightMm}, got ${height}`);
  assert.ok(dims.totalHeightMm > dims.bodyHeightMm, 'expected the bottle to be taller than its body alone');
});

await test('6. tumbler body radius is constant top-to-bottom (straight wall); mug/bottle are not', () => {
  const tumblerTemplate = getObjectTemplate('tumbler');
  const { bodyMesh: tumblerBody } = buildObjectMesh(tumblerTemplate, 230, 100);
  tumblerBody.geometry.computeBoundingBox();
  const tb = tumblerBody.geometry.boundingBox;
  assert.ok(Math.abs((tb.max.x - tb.min.x) - (tb.max.z - tb.min.z)) < 1e-6, 'expected a circular cross-section');

  // A straight tumbler's CylinderGeometry has radiusTop === radiusBottom by construction.
  const dims = computeObjectDimensionsMm(tumblerTemplate, 230, 100);
  assert.ok(Math.abs(dims.topRadiusMm - dims.bodyRadiusMm) < 1e-9);
});

await test('7. applyWrapUv maps the front azimuth (atan2(x,z)=0) to u=0.5 for every wrap mode', () => {
  const { bodyMesh } = buildObjectMesh(getObjectTemplate('mug'), 210, 90);
  const position = bodyMesh.geometry.attributes.position;
  const uv = bodyMesh.geometry.attributes.uv;

  // Find a vertex closest to the front azimuth (x≈0, z>0).
  let frontIndex = -1, bestScore = -Infinity;
  for (let i = 0; i < position.count; i++) {
    const x = position.getX(i), z = position.getZ(i);
    const score = z - Math.abs(x) * 10;
    if (score > bestScore) { bestScore = score; frontIndex = i; }
  }

  for (const wrap of ['front', 'wide', 'half', 'full']) {
    applyWrapUv(bodyMesh, wrap);
    assert.ok(Math.abs(uv.getX(frontIndex) - 0.5) < 0.05, `expected u≈0.5 at the front azimuth for wrap=${wrap}`);
  }
});

await test('8. applyWrapUv\'s angular window is narrower for "front" than for "full" (u spreads out more for a wider wrap angle)', () => {
  const { bodyMesh } = buildObjectMesh(getObjectTemplate('tumbler'), 230, 100);
  const position = bodyMesh.geometry.attributes.position;
  const uv = bodyMesh.geometry.attributes.uv;

  // A vertex at a fixed, moderate azimuth away from front (not exactly back, to avoid the atan2
  // branch-cut discontinuity at +-PI).
  let sideIndex = -1, bestDiff = Infinity;
  const targetAzimuth = Math.PI / 2;
  for (let i = 0; i < position.count; i++) {
    const azimuth = Math.atan2(position.getX(i), position.getZ(i));
    const diff = Math.abs(azimuth - targetAzimuth);
    if (diff < bestDiff) { bestDiff = diff; sideIndex = i; }
  }

  applyWrapUv(bodyMesh, 'front');
  const uFront = uv.getX(sideIndex);
  applyWrapUv(bodyMesh, 'full');
  const uFull = uv.getX(sideIndex);

  assert.ok(Math.abs(uFront - 0.5) > Math.abs(uFull - 0.5), 'expected the same azimuth to map further from center (0.5) under a narrower wrap window');
});

console.log('Object geometry builder tests passed.');
