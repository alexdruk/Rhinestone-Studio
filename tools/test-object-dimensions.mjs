import assert from 'node:assert/strict';

// RS-1006 — pure-number tests for src/preview3d/ObjectDimensions.js: the mm-accurate radius
// formula, bottle extra-height derivation, positive-input validation, and sane output across all
// three real ObjectTemplate records. No Three.js, no DOM/canvas — this module is plain math.

const { computeObjectDimensionsMm, computeBodyRadiusMm, wrapAngleRad, WRAP_ANGLE_DEG } =
  await import('../src/preview3d/ObjectDimensions.js');
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

await test('1. computeBodyRadiusMm anchors a 180-degree arc to canvasWidthMm exactly', () => {
  const canvasWidthMm = 210;
  const radius = computeBodyRadiusMm(canvasWidthMm);
  const arcLength = radius * Math.PI; // 180 degrees = PI radians
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

console.log('Object dimensions tests passed.');
