import assert from 'node:assert/strict';
import {
  computeReadabilityFindings,
  computeScaleCompliance,
  MIN_MEANINGFUL_STONE_COUNT,
  MIN_STONE_COUNT_FOR_COUNTER_BEARING,
  NEAR_IDENTICAL_CHAMFER_THRESHOLD,
  COUNTER_BEARING_CHARACTERS
} from './font-certification/lib/readabilityMetrics.mjs';

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

// A diagonal, not a horizontal line: normalizedStonePoints() normalizes by bounding-box *height*, so
// a fixture with yMm always 0 (zero height) would degenerate to an empty point set -- this needs
// nonzero height, like any real glyph's stones do.
function stonesAlongLine(count, spacingMm = 1) {
  return Array.from({ length: count }, (_, i) => ({ xMm: i * spacingMm, yMm: i * spacingMm, sizeMm: 2 }));
}

function mapOf(entries) {
  return new Map(entries.map(([key, bySize]) => [key, new Map(Object.entries(bySize))]));
}

function makeResult(stoneCount, overrides = {}) {
  return { error: null, stoneCount, stones: stonesAlongLine(stoneCount), clusterCount: 1, ...overrides };
}

// --- Thresholds are documented, sane constants -------------------------------------------------------

await test('documented thresholds are positive integers/floats in a sane range', () => {
  assert.ok(Number.isInteger(MIN_MEANINGFUL_STONE_COUNT) && MIN_MEANINGFUL_STONE_COUNT > 0);
  assert.ok(Number.isInteger(MIN_STONE_COUNT_FOR_COUNTER_BEARING) && MIN_STONE_COUNT_FOR_COUNTER_BEARING > MIN_MEANINGFUL_STONE_COUNT);
  assert.ok(NEAR_IDENTICAL_CHAMFER_THRESHOLD > 0 && NEAR_IDENTICAL_CHAMFER_THRESHOLD < 1);
  assert.ok(COUNTER_BEARING_CHARACTERS.has('o') && COUNTER_BEARING_CHARACTERS.has('O') && !COUNTER_BEARING_CHARACTERS.has('l'));
});

// --- Low stone count ------------------------------------------------------------------------------

await test('computeReadabilityFindings() flags a glyph below MIN_MEANINGFUL_STONE_COUNT', () => {
  const productionAnalysis = {
    glyphResults: mapOf([['x', { ss30: makeResult(2), ss6: makeResult(20) }]]), // ss30 below threshold (6), ss6 fine
    similarityFindings: []
  };
  const findings = computeReadabilityFindings(productionAnalysis);
  assert.equal(findings.lowStoneCountFindings.length, 1);
  assert.equal(findings.lowStoneCountFindings[0].char, 'x');
  assert.equal(findings.lowStoneCountFindings[0].sizeId, 'ss30');
  assert.equal(findings.lowStoneCountFindings[0].threshold, MIN_MEANINGFUL_STONE_COUNT);
});

await test('computeReadabilityFindings() does NOT flag a glyph at or above MIN_MEANINGFUL_STONE_COUNT', () => {
  const productionAnalysis = { glyphResults: mapOf([['x', { ss30: makeResult(MIN_MEANINGFUL_STONE_COUNT) }]]), similarityFindings: [] };
  const findings = computeReadabilityFindings(productionAnalysis);
  assert.equal(findings.lowStoneCountFindings.length, 0);
});

await test('a space character is never flagged for low stone count (zero stones is correct, not a defect)', () => {
  const productionAnalysis = { glyphResults: mapOf([[' ', { ss30: makeResult(0) }]]), similarityFindings: [] };
  const findings = computeReadabilityFindings(productionAnalysis);
  assert.equal(findings.lowStoneCountFindings.length, 0);
});

// --- Counter-bearing floor -------------------------------------------------------------------------

await test('computeReadabilityFindings() flags a counter-bearing character below MIN_STONE_COUNT_FOR_COUNTER_BEARING even if above the general floor', () => {
  const stoneCount = MIN_MEANINGFUL_STONE_COUNT + 1; // passes the general floor, fails the counter-bearing floor
  assert.ok(stoneCount < MIN_STONE_COUNT_FOR_COUNTER_BEARING, 'test fixture assumption');
  const productionAnalysis = { glyphResults: mapOf([['o', { ss30: makeResult(stoneCount) }]]), similarityFindings: [] };
  const findings = computeReadabilityFindings(productionAnalysis);
  assert.equal(findings.lowStoneCountFindings.length, 0, 'should clear the general floor');
  assert.equal(findings.counterCollapseFindings.length, 1, 'should still fail the stricter counter-bearing floor');
  assert.equal(findings.counterCollapseFindings[0].char, 'o');
});

await test('computeReadabilityFindings() does NOT apply the counter-bearing floor to a non-counter-bearing character', () => {
  const stoneCount = MIN_MEANINGFUL_STONE_COUNT + 1;
  const productionAnalysis = { glyphResults: mapOf([['l', { ss30: makeResult(stoneCount) }]]), similarityFindings: [] };
  const findings = computeReadabilityFindings(productionAnalysis);
  assert.equal(findings.counterCollapseFindings.length, 0, '"l" has no counter and must not be held to the stricter floor');
});

// --- Regression: connected-component clustering must NOT be used for counter detection ----------------

await test('regression: a hollow-ring stone layout (clusterCount=1 by nearest-neighbor clustering) with a healthy stone count is not flagged, proving clusterCount is not used as the signal', () => {
  // A real ring is one connected point-cloud under nearest-neighbor clustering even though it has a
  // visible hole -- this was the actual bug FONT-CERT-002 found and removed. Guard against
  // regressing back to that approach: clusterCount=1 alone must never drive a finding.
  const productionAnalysis = { glyphResults: mapOf([['O', { ss16: makeResult(33, { clusterCount: 1 }) }]]), similarityFindings: [] };
  const findings = computeReadabilityFindings(productionAnalysis);
  assert.equal(findings.counterCollapseFindings.length, 0);
});

// --- Near-identical layouts across all 5 sizes -------------------------------------------------------

await test('computeReadabilityFindings() flags a confusable pair whose stone layouts are near-identical', () => {
  const identicalStones = stonesAlongLine(20);
  const productionAnalysis = {
    glyphResults: mapOf([
      ['O', { ss16: makeResult(20, { stones: identicalStones }) }],
      ['0', { ss16: makeResult(20, { stones: identicalStones }) }]
    ]),
    similarityFindings: []
  };
  const findings = computeReadabilityFindings(productionAnalysis);
  assert.ok(findings.nearIdenticalFindings.some((f) => f.pair[0] === 'O' && f.pair[1] === '0' && f.sizeId === 'ss16'));
});

await test('computeReadabilityFindings() does not flag a confusable pair with clearly different layouts', () => {
  // An L-shape (all stones on two perpendicular edges) vs. a straight diagonal -- clearly different
  // silhouettes, not just a rotation of the same shape.
  const lShape = [
    ...Array.from({ length: 10 }, (_, i) => ({ xMm: 0, yMm: i, sizeMm: 2 })),
    ...Array.from({ length: 10 }, (_, i) => ({ xMm: i, yMm: 9, sizeMm: 2 }))
  ];
  const productionAnalysis = {
    glyphResults: mapOf([
      ['O', { ss16: makeResult(20, { stones: stonesAlongLine(20, 1) }) }],
      ['0', { ss16: makeResult(20, { stones: lShape }) }]
    ]),
    similarityFindings: []
  };
  const findings = computeReadabilityFindings(productionAnalysis);
  assert.equal(findings.nearIdenticalFindings.filter((f) => f.pair[0] === 'O' && f.pair[1] === '0').length, 0);
});

// --- Scale compliance ------------------------------------------------------------------------------

await test('computeScaleCompliance() confirms every documented stone size renders at or above MIN_STONE_PX', () => {
  const compliance = computeScaleCompliance();
  assert.equal(compliance.bySize.length, 5);
  for (const s of compliance.bySize) {
    assert.ok(s.renderedStonePx >= compliance.minStonePx, `${s.sizeId} renders at ${s.renderedStonePx}px, below the ${compliance.minStonePx}px minimum`);
    assert.equal(s.compliant, true);
  }
  assert.equal(compliance.allCompliant, true);
});

console.log('FONT-CERT-002 readability metrics tests passed.');
