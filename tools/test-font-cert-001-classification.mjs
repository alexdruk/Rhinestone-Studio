import assert from 'node:assert/strict';
import { classifyCertification } from './font-certification/lib/classification.mjs';

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

function mapOf(entries) {
  return new Map(entries.map(([key, bySize]) => [key, new Map(Object.entries(bySize))]));
}

function makeStoneResult(overrides = {}) {
  return {
    error: null,
    stoneCount: 5,
    collisionCount: 0,
    stones: [],
    minSpacingMm: 3,
    clusterCount: 1,
    isolatedCount: 0,
    ...overrides
  };
}

const passingProductionAnalysis = {
  glyphResults: mapOf([['A', { ss16: makeStoneResult() }]]),
  wordResults: mapOf([['Ashley', { ss16: makeStoneResult({ stoneCount: 30 }) }]]),
  similarityFindings: [],
  similarityThreshold: 0.09,
  heightMm: 25,
  gapMm: 0.3
};

const passingTypographyFindings = { weightOutliers: [], baselineAnomalies: [], inadequateWordSpaces: [] };

function allPassChecks() {
  return [
    { id: 'ttf-parse', category: 'parsing', label: 'Successful TTF parsing', status: 'PASS', detail: 'ok' },
    { id: 'required-tables', category: 'structure', label: 'Required sfnt tables', status: 'PASS', detail: 'ok' },
    { id: 'required-characters', category: 'coverage', label: 'Required character coverage', status: 'PASS', detail: 'ok' }
  ];
}

// --- PASS ------------------------------------------------------------------------------------------

await test('classifyCertification() returns PASS when every check passes and production is clean', () => {
  const result = classifyCertification({
    ttfChecks: allPassChecks(),
    productionAnalysis: passingProductionAnalysis,
    typographyFindings: passingTypographyFindings
  });
  assert.equal(result.overall, 'PASS');
  assert.deepEqual(result.blockingIssues, []);
  assert.deepEqual(result.refinementNotes, []);
});

// --- CONDITIONAL PASS --------------------------------------------------------------------------------

await test('classifyCertification() returns CONDITIONAL_PASS when only WARNING-level checks are present', () => {
  const checks = [...allPassChecks(), { id: 'self-intersections', category: 'geometry', label: 'Self-intersections', status: 'WARNING', detail: 'minor' }];
  const result = classifyCertification({
    ttfChecks: checks,
    productionAnalysis: passingProductionAnalysis,
    typographyFindings: passingTypographyFindings
  });
  assert.equal(result.overall, 'CONDITIONAL_PASS');
  assert.deepEqual(result.blockingIssues, []);
  assert.equal(result.refinementNotes.length, 1);
});

// --- FAIL: structural ----------------------------------------------------------------------------

await test('classifyCertification() returns FAIL when a structure/coverage check FAILs', () => {
  const checks = allPassChecks().map((c) => (c.id === 'required-tables' ? { ...c, status: 'FAIL', detail: 'missing glyf' } : c));
  const result = classifyCertification({
    ttfChecks: checks,
    productionAnalysis: passingProductionAnalysis,
    typographyFindings: passingTypographyFindings
  });
  assert.equal(result.overall, 'FAIL');
  assert.ok(result.blockingIssues.some((i) => i.includes('Required sfnt tables')));
});

// --- FAIL: production collisions ------------------------------------------------------------------

await test('classifyCertification() returns FAIL when a production layout has stone collisions', () => {
  const productionAnalysis = {
    ...passingProductionAnalysis,
    wordResults: mapOf([['Ashley', { ss16: makeStoneResult({ collisionCount: 3 }) }]])
  };
  const result = classifyCertification({
    ttfChecks: allPassChecks(),
    productionAnalysis,
    typographyFindings: passingTypographyFindings
  });
  assert.equal(result.overall, 'FAIL');
  assert.ok(result.blockingIssues.some((i) => i.includes('collisions')));
  assert.equal(result.totalCollisions, 3);
});

// --- FAIL: unusable layout -------------------------------------------------------------------------

await test('classifyCertification() returns FAIL when a layout errors out', () => {
  const productionAnalysis = {
    ...passingProductionAnalysis,
    wordResults: mapOf([['Ashley', { ss16: makeStoneResult({ error: 'boom', stoneCount: 0 }) }]])
  };
  const result = classifyCertification({
    ttfChecks: allPassChecks(),
    productionAnalysis,
    typographyFindings: passingTypographyFindings
  });
  assert.equal(result.overall, 'FAIL');
  assert.ok(result.blockingIssues.some((i) => i.includes('failed to generate a usable layout')));
});

// --- FAIL: material misread (confusable pair degenerate on one side) -------------------------------

await test('classifyCertification() returns FAIL when a confusable pair is materially misread (one side degenerate)', () => {
  const productionAnalysis = {
    ...passingProductionAnalysis,
    glyphResults: mapOf([
      ['O', { ss16: makeStoneResult({ stoneCount: 9 }) }],
      ['0', { ss16: makeStoneResult({ stoneCount: 0 }) }]
    ]),
    similarityFindings: [{ pair: ['O', '0'], stoneSizeId: 'ss16', stoneCountA: 9, stoneCountB: 0, chamferDistance: 0.02, flagged: true }]
  };
  const result = classifyCertification({
    ttfChecks: allPassChecks(),
    productionAnalysis,
    typographyFindings: passingTypographyFindings
  });
  assert.equal(result.overall, 'FAIL');
  assert.ok(result.blockingIssues.some((i) => i.includes('[Anatomy]')));
});

await test('classifyCertification() does NOT fail for ordinary shape similarity (both sides non-degenerate)', () => {
  const productionAnalysis = {
    ...passingProductionAnalysis,
    glyphResults: mapOf([
      ['O', { ss16: makeStoneResult({ stoneCount: 9 }) }],
      ['0', { ss16: makeStoneResult({ stoneCount: 9 }) }]
    ]),
    similarityFindings: [{ pair: ['O', '0'], stoneSizeId: 'ss16', stoneCountA: 9, stoneCountB: 9, chamferDistance: 0.02, flagged: true }]
  };
  const result = classifyCertification({
    ttfChecks: allPassChecks(),
    productionAnalysis,
    typographyFindings: passingTypographyFindings
  });
  assert.equal(result.overall, 'CONDITIONAL_PASS');
  assert.equal(result.blockingIssues.length, 0);
  assert.ok(result.refinementNotes.some((n) => n.includes('similarity')));
});

console.log('FONT-CERT-001 classification tests passed.');
