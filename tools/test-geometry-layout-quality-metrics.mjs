import assert from 'node:assert/strict';
import { GeometryEngine, StoneLayout, measureStoneCrowding } from '../src/geometry/index.js';

// Layout-quality metrics (Prompt 3): findOverlappingStonePairs() can structurally never fire for
// single-layer generated output -- dedupeStonePoints() already guarantees a stoneSizeMm center-
// distance floor -- so a layout that merely "looks crowded/broken" is legal by that check. This
// suite covers the two new pure measurements: measureStoneCrowding() (StoneLayout.js) and
// StoneLayout.outlineStats attrition plumbing (StoneSampler.js + GeometryEngine.js). No UI/warning
// thresholds are exercised here -- those are calibrated separately (see
// tools/scratch/layout-quality-calibration/sweep.mjs) and wired in a later milestone.

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

// --- 1. Two stones just barely too close together -----------------------------------------------

await test('1. two 2mm stones 2.05mm apart flag both as below-half-gap', () => {
  const result = measureStoneCrowding(
    [
      { xMm: 0, yMm: 0, sizeMm: 2 },
      { xMm: 2.05, yMm: 0, sizeMm: 2 }
    ],
    { gapMm: 0.3 }
  );

  assert.equal(result.count, 2);
  assert.equal(result.fractionBelowHalfGap, 1);
  assert.ok(Math.abs(result.minRimGapMm - 0.05) < 1e-6, `expected minRimGapMm ~0.05, got ${result.minRimGapMm}`);
});

// --- 2. A healthy 3x3 grid at the intended pitch -------------------------------------------------

await test('2. 3x3 grid at pitch 2.3mm (stoneSize 2mm, gap 0.3mm) is not flagged as crowded', () => {
  const stones = [];
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) {
      stones.push({ xMm: i * 2.3, yMm: j * 2.3, sizeMm: 2 });
    }
  }

  const result = measureStoneCrowding(stones, { gapMm: 0.3 });

  assert.equal(result.fractionBelowHalfGap, 0);
  assert.ok(Math.abs(result.medianRimGapMm - 0.3) < 1e-6, `expected medianRimGapMm ~0.3, got ${result.medianRimGapMm}`);
});

// --- 3. Deliberate pave (gapMm 0) is never flagged -----------------------------------------------

await test('3. gapMm: 0 with touching stones is never flagged as crowded', () => {
  const result = measureStoneCrowding(
    [
      { xMm: 0, yMm: 0, sizeMm: 2 },
      { xMm: 2, yMm: 0, sizeMm: 2 }
    ],
    { gapMm: 0 }
  );

  assert.equal(result.fractionBelowHalfGap, 0);
});

// --- 4. Mixed stone sizes use per-pair radii ------------------------------------------------------

await test('4. mixed 2mm/3mm stones at 2.6mm compute rim gap from per-pair radii', () => {
  const result = measureStoneCrowding(
    [
      { xMm: 0, yMm: 0, sizeMm: 2 },
      { xMm: 2.6, yMm: 0, sizeMm: 3 }
    ],
    { gapMm: 0.3 }
  );

  assert.ok(Math.abs(result.minRimGapMm - 0.1) < 1e-6, `expected rim gap ~0.1, got ${result.minRimGapMm}`);
});

// --- 5. Real pipeline: outline attrition on thin vs. healthy rectangles --------------------------

await test('5. generatePathLayout outline attrition: thin sliver loses far more than a healthy rectangle', () => {
  const engine = new GeometryEngine();

  const thin = engine.generatePathLayout({
    layerId: 'thin-rect',
    mode: 'outline',
    closed: true,
    stoneSizeMm: 2,
    gapMm: 0.3,
    contours: [[{ xMm: 0, yMm: 0 }, { xMm: 8, yMm: 0 }, { xMm: 8, yMm: 1 }, { xMm: 0, yMm: 1 }]],
    xMm: 0,
    yMm: 0,
    widthMm: 8,
    heightMm: 1
  });

  assert.ok(thin.outlineStats, 'thin rectangle layout should carry outlineStats');
  const thinRatio = thin.outlineStats.keptCount / thin.outlineStats.rawSampleCount;
  assert.ok(thinRatio < 0.7, `expected thin-sliver attrition ratio < 0.7, got ${thinRatio}`);

  const healthy = engine.generatePathLayout({
    layerId: 'healthy-rect',
    mode: 'outline',
    closed: true,
    stoneSizeMm: 2,
    gapMm: 0.3,
    contours: [[{ xMm: 0, yMm: 0 }, { xMm: 30, yMm: 0 }, { xMm: 30, yMm: 10 }, { xMm: 0, yMm: 10 }]],
    xMm: 0,
    yMm: 0,
    widthMm: 30,
    heightMm: 10
  });

  assert.ok(healthy.outlineStats, 'healthy rectangle layout should carry outlineStats');
  const healthyRatio = healthy.outlineStats.keptCount / healthy.outlineStats.rawSampleCount;
  assert.ok(healthyRatio >= 0.9, `expected healthy-rectangle attrition ratio >= 0.9, got ${healthyRatio}`);
});

// --- 6. outlineStats is absent for fill mode, and toJSON/fromJSON round-trip both ways -----------

await test('6. outlineStats absent for fill mode; toJSON/fromJSON round-trip with and without it', () => {
  const engine = new GeometryEngine();

  const fillLayout = engine.generatePathLayout({
    layerId: 'fill-rect',
    mode: 'fill',
    closed: true,
    stoneSizeMm: 2,
    gapMm: 0.3,
    contours: [[{ xMm: 0, yMm: 0 }, { xMm: 20, yMm: 0 }, { xMm: 20, yMm: 20 }, { xMm: 0, yMm: 20 }]],
    xMm: 0,
    yMm: 0,
    widthMm: 20,
    heightMm: 20
  });

  assert.equal(fillLayout.outlineStats, null);
  const fillJson = fillLayout.toJSON();
  assert.ok(!('outlineStats' in fillJson), 'toJSON should omit outlineStats when absent');
  const fillRoundTrip = StoneLayout.fromJSON(fillJson);
  assert.equal(fillRoundTrip.outlineStats, null);

  const outlineLayout = engine.generatePathLayout({
    layerId: 'outline-rect',
    mode: 'outline',
    closed: true,
    stoneSizeMm: 2,
    gapMm: 0.3,
    contours: [[{ xMm: 0, yMm: 0 }, { xMm: 20, yMm: 0 }, { xMm: 20, yMm: 20 }, { xMm: 0, yMm: 20 }]],
    xMm: 0,
    yMm: 0,
    widthMm: 20,
    heightMm: 20
  });

  assert.ok(outlineLayout.outlineStats);
  const outlineJson = outlineLayout.toJSON();
  assert.deepEqual(outlineJson.outlineStats, outlineLayout.outlineStats);
  const outlineRoundTrip = StoneLayout.fromJSON(outlineJson);
  assert.deepEqual(outlineRoundTrip.outlineStats, outlineLayout.outlineStats);

  // A legacy/pre-existing saved layout JSON with no outlineStats field at all must still round-trip.
  const legacyJson = { ...outlineJson };
  delete legacyJson.outlineStats;
  const legacyRoundTrip = StoneLayout.fromJSON(legacyJson);
  assert.equal(legacyRoundTrip.outlineStats, null);
});

if (process.exitCode) {
  console.error('\nSome tests failed.');
} else {
  console.log('\nAll tests passed.');
}
