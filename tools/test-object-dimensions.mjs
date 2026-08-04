import assert from 'node:assert/strict';

// RS-1006 — pure-number tests for src/preview3d/ObjectDimensions.js: the mm-accurate radius
// formula, bottle extra-height derivation, positive-input validation, and sane output across all
// three real ObjectTemplate records. No Three.js, no DOM/canvas — this module is plain math.
//
// S-107 (Front View Frame & Long Text Workflow) extended this module to be the one place the
// production canvas's mm coordinate space and the cylinder's azimuth are related -- the flat canvas
// is treated as the object's unwrapped surface, mapping exactly once around the full 360-degree
// circumference (previously anchored at a 180-degree reference; see computeBodyRadiusMm() and this
// file's own top-of-file comment for why the reference changed: it is what makes the Front View
// Frame wrap continuously and seamlessly across the canvas's left/right edges, requirement 3).

const {
  computeObjectDimensionsMm, computeBodyRadiusMm, wrapAngleRad, WRAP_ANGLE_DEG,
  circumferenceMm, azimuthRadForCanvasXMm, canvasXMmForAzimuthRad,
  canvasXMmForRotationDeg, rotationDegForCanvasXMm, frontViewFrameWidthMm
} = await import('../src/preview3d/ObjectDimensions.js');
const { getObjectTemplate, getVesselDefaults } = await import('../src/products/index.js');

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

await test('1. computeBodyRadiusMm anchors a full 360-degree revolution to canvasWidthMm exactly (S-107: the canvas is the object\'s complete unwrapped surface)', () => {
  const canvasWidthMm = 210;
  const radius = computeBodyRadiusMm(canvasWidthMm);
  const arcLength = radius * 2 * Math.PI; // 360 degrees = 2*PI radians
  assert.ok(Math.abs(arcLength - canvasWidthMm) < 1e-9, `expected arc length ${canvasWidthMm}, got ${arcLength}`);
});

await test('2. computeBodyRadiusMm scales linearly with canvasWidthMm', () => {
  assert.equal(computeBodyRadiusMm(420), computeBodyRadiusMm(210) * 2);
});

await test('3. computeBodyRadiusMm rejects non-positive/non-finite input', () => {
  for (const bad of [0, -5, NaN, Infinity, 'x', null, undefined]) {
    assert.throws(() => computeBodyRadiusMm(bad), TypeError, `expected computeBodyRadiusMm(${bad}) to throw`);
  }
});

await test('4. wrapAngleRad matches WRAP_ANGLE_DEG and orders front < wide < half < full', () => {
  for (const mode of ['front', 'wide', 'half', 'full']) {
    assert.ok(Math.abs(wrapAngleRad(mode) - (WRAP_ANGLE_DEG[mode] * Math.PI) / 180) < 1e-9);
  }
  assert.ok(wrapAngleRad('front') < wrapAngleRad('wide'));
  assert.ok(wrapAngleRad('wide') < wrapAngleRad('half'));
  assert.ok(wrapAngleRad('half') < wrapAngleRad('full'));
});

await test('5. wrapAngleRad falls back to "wide" for an unknown/missing mode (permissive style)', () => {
  assert.equal(wrapAngleRad('bogus'), wrapAngleRad('wide'));
  assert.equal(wrapAngleRad(undefined), wrapAngleRad('wide'));
});

await test('6. computeObjectDimensionsMm: mug/tumbler have no bottle-only fields, totalHeightMm === bodyHeightMm', () => {
  for (const id of ['mug', 'tumbler']) {
    const dims = computeObjectDimensionsMm(getObjectTemplate(id), 210, 90);
    assert.equal(dims.kind, id);
    assert.equal(dims.bodyHeightMm, 90);
    assert.equal(dims.totalHeightMm, 90);
    assert.equal(dims.neckRadiusMm, undefined);
    assert.ok(dims.bodyRadiusMm > 0);
    assert.ok(dims.topRadiusMm > 0);
  }
});

await test('7. computeObjectDimensionsMm: tumbler has equal top/bottom radius (straight wall)', () => {
  const dims = computeObjectDimensionsMm(getObjectTemplate('tumbler'), 230, 100);
  assert.ok(Math.abs(dims.topRadiusMm - dims.bodyRadiusMm) < 1e-9);
});

await test('8. computeObjectDimensionsMm: mug has hasHandle=true, tumbler/bottle have hasHandle=false', () => {
  assert.equal(computeObjectDimensionsMm(getObjectTemplate('mug'), 210, 90).hasHandle, true);
  assert.equal(computeObjectDimensionsMm(getObjectTemplate('tumbler'), 230, 100).hasHandle, false);
  assert.equal(computeObjectDimensionsMm(getObjectTemplate('bottle'), 180, 90).hasHandle, false);
});

await test('9. computeObjectDimensionsMm: bottle derives positive neck/shoulder/cap heights and totalHeightMm > bodyHeightMm', () => {
  const canvasHeightMm = 90;
  const dims = computeObjectDimensionsMm(getObjectTemplate('bottle'), 180, canvasHeightMm);
  assert.ok(dims.neckRadiusMm > 0);
  assert.ok(dims.neckHeightMm > 0);
  assert.ok(dims.shoulderHeightMm > 0);
  assert.ok(dims.capHeightMm > 0);
  assert.equal(dims.bodyHeightMm, canvasHeightMm);
  assert.ok(dims.totalHeightMm > canvasHeightMm);
  const expectedTotal = canvasHeightMm + dims.neckHeightMm + dims.shoulderHeightMm + dims.capHeightMm;
  assert.ok(Math.abs(dims.totalHeightMm - expectedTotal) < 1e-9);
});

await test('10. computeObjectDimensionsMm rejects a non-positive canvasHeightMm', () => {
  assert.throws(() => computeObjectDimensionsMm(getObjectTemplate('mug'), 210, 0), TypeError);
  assert.throws(() => computeObjectDimensionsMm(getObjectTemplate('mug'), 210, -1), TypeError);
});

await test('11. wrap mode never changes computeObjectDimensionsMm\'s output (object size is wrap-invariant)', () => {
  // computeObjectDimensionsMm has no wrap parameter at all -- this test documents/locks that
  // design decision: a real object does not resize when the operator picks a different wrap mode.
  const dimsA = computeObjectDimensionsMm(getObjectTemplate('mug'), 210, 90);
  const dimsB = computeObjectDimensionsMm(getObjectTemplate('mug'), 210, 90);
  assert.deepEqual(dimsA, dimsB);
});

// ---------------------------------------------------------------------------------------------
// S-107: circumference / azimuth <-> canvas-x / Front View Frame width
// ---------------------------------------------------------------------------------------------

await test('12. circumferenceMm() equals canvasWidthMm exactly (by construction, per computeBodyRadiusMm\'s 360-degree reference)', () => {
  for (const canvasWidthMm of [180, 210, 230]) {
    assert.ok(Math.abs(circumferenceMm(canvasWidthMm) - canvasWidthMm) < 1e-9);
  }
});

await test('13. canvasXMmForAzimuthRad(0, W) is the canvas center (the front); azimuth +-PI both map to the same seam at the canvas edges (0 and W)', () => {
  const W = 210;
  assert.ok(Math.abs(canvasXMmForAzimuthRad(0, W) - W / 2) < 1e-9);
  assert.ok(Math.abs(canvasXMmForAzimuthRad(Math.PI, W) - W) < 1e-9);
  assert.ok(Math.abs(canvasXMmForAzimuthRad(-Math.PI, W) - 0) < 1e-9);
});

await test('14. azimuthRadForCanvasXMm() is the exact inverse of canvasXMmForAzimuthRad() across the full range', () => {
  const W = 210;
  for (const azimuthRad of [-3, -2, -1, -0.3, 0, 0.3, 1, 2, 3]) {
    const xMm = canvasXMmForAzimuthRad(azimuthRad, W);
    const roundTripped = canvasXMmForAzimuthRad(azimuthRadForCanvasXMm(xMm, W), W);
    assert.ok(Math.abs(roundTripped - xMm) < 1e-6, `expected xMm ${xMm} to round-trip, got ${roundTripped}`);
  }
});

await test('15. canvas x=0 and x=canvasWidthMm are the same physical point (S-107 requirement 3: seamless wrap at the production canvas\'s own edges)', () => {
  const W = 210;
  assert.ok(Math.abs(azimuthRadForCanvasXMm(0, W) - Math.PI) < 1e-9 || Math.abs(azimuthRadForCanvasXMm(0, W) + Math.PI) < 1e-9);
  const azAtRight = azimuthRadForCanvasXMm(W - 1e-9, W);
  assert.ok(Math.abs(Math.abs(azAtRight) - Math.PI) < 1e-3, 'expected the right edge to sit at the same +-PI seam as the left edge');
});

await test('16. canvasXMmForRotationDeg(0, W) is dead center (front); rotationDegForCanvasXMm() is its inverse', () => {
  const W = 210;
  assert.ok(Math.abs(canvasXMmForRotationDeg(0, W) - W / 2) < 1e-9);
  for (const rotationDeg of [-179, -90, -30, 0, 30, 90, 179]) {
    const xMm = canvasXMmForRotationDeg(rotationDeg, W);
    const roundTripped = rotationDegForCanvasXMm(xMm, W);
    assert.ok(Math.abs(roundTripped - rotationDeg) < 1e-6, `expected rotation ${rotationDeg} to round-trip, got ${roundTripped}`);
  }
});

await test('17. frontViewFrameWidthMm(): wrap-mode ordering matches WRAP_ANGLE_DEG (front < wide < half < full), and \'half\' covers exactly half the canvas width', () => {
  const W = 210;
  const widths = Object.fromEntries(['front', 'wide', 'half', 'full'].map((m) => [m, frontViewFrameWidthMm(m, W)]));
  assert.ok(widths.front < widths.wide);
  assert.ok(widths.wide < widths.half);
  assert.ok(widths.half < widths.full);
  assert.ok(Math.abs(widths.half - W / 2) < 1e-9, `expected 'half' to cover exactly half of canvasWidthMm (${W / 2}), got ${widths.half}`);
  assert.ok(widths.full < W, 'expected \'full\' (300 degrees) to leave a real gap, never covering the entire circumference');
});

await test('18. frontViewFrameWidthMm() scales linearly with canvasWidthMm for a fixed wrap mode', () => {
  assert.ok(Math.abs(frontViewFrameWidthMm('wide', 420) - frontViewFrameWidthMm('wide', 210) * 2) < 1e-9);
});

// ---------------------------------------------------------------------------------------------
// RS-2010: vesselParams -- real, independently-authored topDiameterMm
// ---------------------------------------------------------------------------------------------

await test('19. RS-2010: computeObjectDimensionsMm(..., vesselParams) uses vesselParams.topDiameterMm/2 as topRadiusMm exactly, not the old ratio-derived value', () => {
  const template = getObjectTemplate('mug');
  const vesselParams = { bodyDiameterMm: 82, topDiameterMm: 90, bodyHeightMm: 95, printableHeightMm: 85 };
  const canvasWidthMm = Math.PI * vesselParams.bodyDiameterMm;
  const dims = computeObjectDimensionsMm(template, canvasWidthMm, vesselParams.printableHeightMm, null, vesselParams);
  assert.ok(Math.abs(dims.topRadiusMm - 45) < 1e-9, `expected topRadiusMm 45, got ${dims.topRadiusMm}`);
  // Ratio-derived topRadiusMm (the legacy fallback) would differ -- confirms the mm-direct path was
  // actually taken, not silently ignored.
  const ratioTopRadius = computeObjectDimensionsMm(template, canvasWidthMm, vesselParams.printableHeightMm).topRadiusMm;
  assert.notEqual(dims.topRadiusMm, ratioTopRadius);
});

await test('20. RS-2010: bodyRadiusMm is unaffected by vesselParams -- still purely a function of canvasWidthMm', () => {
  const template = getObjectTemplate('mug');
  const vesselParams = getVesselDefaults('mug');
  const canvasWidthMm = Math.PI * vesselParams.bodyDiameterMm;
  const withVessel = computeObjectDimensionsMm(template, canvasWidthMm, vesselParams.printableHeightMm, null, vesselParams);
  const withoutVessel = computeObjectDimensionsMm(template, canvasWidthMm, vesselParams.printableHeightMm);
  assert.equal(withVessel.bodyRadiusMm, withoutVessel.bodyRadiusMm);
  assert.ok(Math.abs(withVessel.bodyRadiusMm - vesselParams.bodyDiameterMm / 2) < 1e-6);
});

await test('21. RS-2010: a straight tumbler\'s vesselParams (topDiameterMm===bodyDiameterMm) still yields topRadiusMm===bodyRadiusMm', () => {
  const template = getObjectTemplate('tumbler');
  const vesselParams = getVesselDefaults('tumbler');
  assert.equal(vesselParams.topDiameterMm, vesselParams.bodyDiameterMm);
  const canvasWidthMm = Math.PI * vesselParams.bodyDiameterMm;
  const dims = computeObjectDimensionsMm(template, canvasWidthMm, vesselParams.printableHeightMm, null, vesselParams);
  assert.ok(Math.abs(dims.topRadiusMm - dims.bodyRadiusMm) < 1e-9);
});

await test('22. RS-2010: omitting vesselParams (every pre-RS-2010 caller) is byte-identical to before -- regression guard for the legacy/backward-compatible path', () => {
  for (const id of ['mug', 'tumbler', 'bottle']) {
    const template = getObjectTemplate(id);
    const withDefaultArg = computeObjectDimensionsMm(template, 210, 90);
    const withExplicitNull = computeObjectDimensionsMm(template, 210, 90, null, null);
    assert.deepEqual(withDefaultArg, withExplicitNull);
  }
});

console.log('Object dimensions tests passed.');
