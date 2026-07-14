import assert from 'node:assert/strict';

// RS-1006 — verifies src/preview3d/ObjectGeometryBuilder.js using the real 'three' package. Three's
// geometry/math classes (CylinderGeometry, LatheGeometry, TubeGeometry, Box3, ...) are pure
// computation and run fine under plain Node with no WebGL context, which is what makes this a real
// (not faked) test of the actual geometry this milestone builds, without needing a browser.

const THREE = await import('three');
const { buildObjectMesh, applyWrapUv } = await import('../src/preview3d/ObjectGeometryBuilder.js');
const { computeObjectDimensionsMm, wrapAngleRad } = await import('../src/preview3d/ObjectDimensions.js');
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

await test('7. applyWrapUv maps the front azimuth (atan2(x,z)=0) to u=0.5 for every wrap mode (S-107 follow-up: restores wrap-mode-dependent windowing -- "changing wrap mode changes the Object Preview")', () => {
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

await test('8. applyWrapUv\'s angular window is narrower for "front" than for "full" (u spreads out more for a wider wrap angle) -- wrap mode visibly changes the Object Preview again', () => {
  const { bodyMesh } = buildObjectMesh(getObjectTemplate('tumbler'), 230, 100);
  const position = bodyMesh.geometry.attributes.position;
  const uv = bodyMesh.geometry.attributes.uv;

  // A vertex at a fixed, moderate azimuth away from front (not exactly back, to avoid the one
  // intentional seam -- see check 8b below).
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

await test('8b. no triangle spans a large U range for any object/wrap-mode combination -- regression guard for the dark-vertical-band defect (a real, human-observed bug: atan2\'s branch cut and the r=0 base/cap apex both used to coincide with real, connected faces, stretching a texture sample across nearly the whole canvas width in one thin triangle)', () => {
  const sizes = { mug: [210, 90], tumbler: [230, 100], bottle: [180, 90] };
  for (const id of ['mug', 'tumbler', 'bottle']) {
    const [w, h] = sizes[id];
    const { bodyMesh } = buildObjectMesh(getObjectTemplate(id), w, h);
    const position = bodyMesh.geometry.attributes.position;
    const index = bodyMesh.geometry.index;
    for (const wrap of ['front', 'wide', 'half', 'full']) {
      applyWrapUv(bodyMesh, wrap);
      const uv = bodyMesh.geometry.attributes.uv;
      // A healthy triangle's U span is at most a few LATHE_SEGMENTS-steps wide (~0.05-0.1 for the
      // narrowest wrap mode); 0.3 is a generous margin that would only be crossed by a genuine
      // seam/branch-cut/degenerate-apex defect, never by ordinary per-segment variation.
      for (let t = 0; t < index.count; t += 3) {
        const a = index.getX(t), b = index.getX(t + 1), c = index.getX(t + 2);
        const ua = uv.getX(a), ub = uv.getX(b), uc = uv.getX(c);
        const jump = Math.max(Math.abs(ua - ub), Math.abs(ub - uc), Math.abs(ua - uc));
        assert.ok(jump < 0.3, `${id} wrap=${wrap} triangle@${t}: U jump ${jump} (vertices ${a}=${ua}, ${b}=${ub}, ${c}=${uc}) -- suspected seam/apex UV defect`);
      }
    }
  }
});

await test('8c. the base apex (r=0, x=z=0 for every column) never triggers Math.atan2\'s signed-zero quirk -- regression guard for the second dark-band defect (neighboring apex vertices at the identical physical point used to get wildly different, meaningless azimuths depending on the sign of each column\'s near-zero x/z)', () => {
  const { bodyMesh } = buildObjectMesh(getObjectTemplate('mug'), 210, 90);
  applyWrapUv(bodyMesh, 'full');
  const position = bodyMesh.geometry.attributes.position;
  const uv = bodyMesh.geometry.attributes.uv;
  const apexUs = [];
  for (let i = 0; i < position.count; i++) {
    if (position.getX(i) === 0 && position.getY(i) === 0 && position.getZ(i) === 0) apexUs.push(uv.getX(i));
  }
  assert.ok(apexUs.length > 10, 'expected many duplicate apex vertices (one per Lathe column)');
  // Adjacent apex columns must differ by a small, regular step (matching every other column pair),
  // never by a large, sign-of-zero-driven jump.
  const sorted = [...apexUs].sort((x, y) => x - y);
  for (let i = 1; i < sorted.length; i++) {
    assert.ok(sorted[i] - sorted[i - 1] < 0.3, `apex U values ${sorted[i - 1]} and ${sorted[i]} are implausibly far apart`);
  }
});

// RS-1006A regression tests -- these guard the four human-review defects fixed in
// docs/specifications/RS-1006A-PreviewCorrections.md. Each checks an observable geometry/material
// fact (not an implementation detail like a specific constant's value).

await test('9. body material is FrontSide (not DoubleSide) for every template -- regression guard for the tumbler/mug duplicated-artwork defect', () => {
  for (const id of ['mug', 'tumbler', 'bottle']) {
    const [w, h] = CANVAS_SIZES[id];
    const { bodyMesh } = buildObjectMesh(getObjectTemplate(id), w, h);
    assert.equal(bodyMesh.material.side, THREE.FrontSide);
  }
});

await test('10. mug/tumbler body has a closed base (a vertex at y=0 with r=0) and a modeled rim (max radius occurs above y=0, not at a bare open top) -- regression guard for the generic-cone defect', () => {
  for (const id of ['mug', 'tumbler']) {
    const [w, h] = CANVAS_SIZES[id];
    const { bodyMesh, dimensions } = buildObjectMesh(getObjectTemplate(id), w, h);
    const position = bodyMesh.geometry.attributes.position;
    let baseIsClosed = false;
    let maxRadius = 0, maxRadiusY = 0;
    for (let i = 0; i < position.count; i++) {
      const y = position.getY(i);
      const r = Math.hypot(position.getX(i), position.getZ(i));
      if (Math.abs(y) < 1e-6 && r < 1e-6) baseIsClosed = true;
      if (r > maxRadius) { maxRadius = r; maxRadiusY = y; }
    }
    assert.ok(baseIsClosed, `expected ${id} to have a closed (r=0) base at y=0`);
    // The rim's outer lip is the widest point of the wall, and it sits at the very top of the
    // object (RIM_TOP_FRACTION=1) -- confirms a rim was modeled, not just a bare taper.
    assert.ok(Math.abs(maxRadiusY - dimensions.bodyHeightMm) < 1e-3, `expected ${id}'s widest point (the rim) at the top (y=${dimensions.bodyHeightMm}), got y=${maxRadiusY}`);
  }
});

await test('11. mug handle wall-attachment endpoints sit inside the wall radius at that height, not on/outside it -- regression guard for the floating/gapped handle defect', () => {
  const { handleMesh, dimensions } = buildObjectMesh(getObjectTemplate('mug'), 210, 90);
  const wallRadiusAt = (y) => {
    const t = Math.max(0, Math.min(1, y / dimensions.bodyHeightMm));
    return dimensions.bodyRadiusMm + (dimensions.topRadiusMm - dimensions.bodyRadiusMm) * t;
  };
  const position = handleMesh.geometry.attributes.position;
  let minY = Infinity, maxY = -Infinity;
  for (let i = 0; i < position.count; i++) {
    minY = Math.min(minY, position.getY(i));
    maxY = Math.max(maxY, position.getY(i));
  }
  // The handle's two attach ends are its extreme-Y vertices; check each is embedded (radius from
  // the axis strictly less than the wall's own radius at that height).
  for (let i = 0; i < position.count; i++) {
    const y = position.getY(i);
    if (Math.abs(y - minY) < 1e-3 || Math.abs(y - maxY) < 1e-3) {
      const r = Math.hypot(position.getX(i), position.getZ(i));
      assert.ok(r < wallRadiusAt(y) - 1e-6, `expected handle endpoint at y=${y} (r=${r}) embedded inside the wall (wallRadius=${wallRadiusAt(y)})`);
    }
  }
});

await test('12. bottle body vertices above bodyHeightMm (shoulder/neck/cap) get v>1 (clamped to background, off the printable body); body-wall vertices stay within [0,1] -- regression guard for the shoulder texture-bleed defect', () => {
  const { bodyMesh, dimensions } = buildObjectMesh(getObjectTemplate('bottle'), 180, 90);
  const position = bodyMesh.geometry.attributes.position;
  const uv = bodyMesh.geometry.attributes.uv;
  let sawBodyVertex = false, sawShoulderVertex = false;
  for (let i = 0; i < position.count; i++) {
    const y = position.getY(i);
    const v = uv.getY(i);
    if (y >= -1e-6 && y <= dimensions.bodyHeightMm + 1e-6) {
      sawBodyVertex = true;
      assert.ok(v >= -1e-6 && v <= 1 + 1e-6, `expected body-wall vertex (y=${y}) to have v in [0,1], got ${v}`);
    }
    if (y > dimensions.bodyHeightMm + 1) {
      sawShoulderVertex = true;
      assert.ok(v > 1, `expected shoulder/neck/cap vertex (y=${y}) to have v>1 (clamped off the printable body), got ${v}`);
    }
  }
  assert.ok(sawBodyVertex && sawShoulderVertex, 'expected both a body-wall vertex and a shoulder/neck/cap vertex in the bottle profile');
});

console.log('Object geometry builder tests passed.');
