import assert from 'node:assert/strict';

// PREVIEW-001 — src/renderer/CrystalAppearance.js is a pure, DOM-free deterministic-variation
// module: same stone fields in -> same visual params out, no Math.random(), no mutation of the
// Stone/StoneLayout it reads. These tests need no canvas/DOM, matching the fake-ctx-free
// convention already used for other pure geometry/model modules under tools/.

const { getCrystalAppearance, crystalSeedForStone } = await import('../src/renderer/CrystalAppearance.js');
const { Stone } = await import('../src/geometry/Stone.js');

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

function stone(overrides = {}) {
  return new Stone({ xMm: 10, yMm: 5, sizeMm: 3, color: 'gold', layerId: 'layer-1', index: 0, ...overrides });
}

await test('1. getCrystalAppearance is deterministic for identical stone fields', () => {
  const a = getCrystalAppearance(stone());
  const b = getCrystalAppearance(stone());
  assert.deepEqual(a, b);
});

await test('2. getCrystalAppearance is deterministic across repeated calls on the same instance', () => {
  const s = stone();
  const a = getCrystalAppearance(s);
  const b = getCrystalAppearance(s);
  assert.deepEqual(a, b);
});

await test('3. different stone positions produce different (useful) variation', () => {
  const a = getCrystalAppearance(stone({ xMm: 10, yMm: 5 }));
  const b = getCrystalAppearance(stone({ xMm: 11, yMm: 5 }));
  assert.notDeepEqual(a, b, 'two stones a single mm apart should not share identical appearance');
});

await test('4. different stone size/color/layerId/index each independently shift the seed', () => {
  const base = crystalSeedForStone(stone());
  assert.notEqual(crystalSeedForStone(stone({ sizeMm: 3.5 })), base);
  assert.notEqual(crystalSeedForStone(stone({ color: 'jet' })), base);
  assert.notEqual(crystalSeedForStone(stone({ layerId: 'layer-2' })), base);
  assert.notEqual(crystalSeedForStone(stone({ index: 1 })), base);
});

await test('5. all numeric fields stay within their declared bounds across a wide sweep', () => {
  let sparkleCount = 0;
  let total = 0;
  for (let x = -50; x <= 50; x += 3.7) {
    for (let y = -50; y <= 50; y += 5.3) {
      for (const sizeMm of [1.5, 2.5, 4, 6]) {
        const appearance = getCrystalAppearance(stone({ xMm: x, yMm: y, sizeMm }));
        assert.ok(appearance.facetAngleDeg >= 0 && appearance.facetAngleDeg < 180, 'facetAngleDeg in [0,180)');
        assert.ok(appearance.highlightIntensity >= 0.7 && appearance.highlightIntensity <= 1.0, 'highlightIntensity in [0.7,1.0]');
        assert.ok(appearance.secondaryAngleDeg >= 0 && appearance.secondaryAngleDeg < 360, 'secondaryAngleDeg in [0,360)');
        assert.ok(appearance.secondaryIntensity >= 0.25 && appearance.secondaryIntensity <= 0.55, 'secondaryIntensity in [0.25,0.55]');
        assert.ok(appearance.shadowStrength >= 0.3 && appearance.shadowStrength <= 0.55, 'shadowStrength in [0.3,0.55]');
        assert.ok(appearance.brightness >= 0.92 && appearance.brightness <= 1.08, 'brightness in [0.92,1.08]');
        assert.equal(typeof appearance.sparkle, 'boolean');
        total++;
        if (appearance.sparkle) sparkleCount++;
      }
    }
  }
  const rate = sparkleCount / total;
  assert.ok(rate > 0.03 && rate < 0.25, `sparkle should be a restrained subset, got rate=${rate}`);
});

await test('6. getCrystalAppearance never mutates the Stone it reads', () => {
  const s = stone();
  const before = s.toJSON();
  getCrystalAppearance(s);
  assert.deepEqual(s.toJSON(), before);
});

await test('7. no Math.random is used (repeatable across process-independent calls with the same seed)', () => {
  // If the implementation used Math.random(), two independent stone instances with identical
  // fields would almost certainly diverge across many trials; assert exact equality every time.
  for (let i = 0; i < 20; i++) {
    assert.deepEqual(getCrystalAppearance(stone()), getCrystalAppearance(stone()));
  }
});

console.log('Crystal appearance tests passed.');
