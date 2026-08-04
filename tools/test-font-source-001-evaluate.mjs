import assert from 'node:assert/strict';
import { readFile, rm, mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { evaluateSource } from './font-certification/evaluate-source.mjs';

// Mirrors test-font-cert-001-report.mjs's isolation pattern: test output under os.tmpdir() (never the
// real fonts/review/), screenshots skipped for speed. Reuses the repo's already-committed
// assets/fonts/Anton-Regular.ttf (via candidateRelativePathOverride) as the source TTF so this test has
// no network dependency -- fonts/candidates/Elegant-Cursive's fixture no longer exists in the repo.
const FIXTURE_TTF_RELATIVE_PATH = 'assets/fonts/Anton-Regular.ttf';
const scratchRoot = await mkdtemp(path.join(os.tmpdir(), 'font-source-001-evaluate-test-'));
const testOutputAbsolute = path.join(scratchRoot, 'output');

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

async function readJson(relativeFile) {
  return JSON.parse(await readFile(path.join(testOutputAbsolute, relativeFile), 'utf8'));
}

await rm(testOutputAbsolute, { recursive: true, force: true });

await test('evaluateSource() writes report.json and report.html with the expected FONT-SOURCE-001 shape', async () => {
  const { evaluation } = await evaluateSource({
    fontName: 'GreatVibes', // any catalog entry -- identity only, TTF bytes come from the override below
    candidateRelativePathOverride: FIXTURE_TTF_RELATIVE_PATH,
    outputRelativePath: testOutputAbsolute,
    skipScreenshots: true
  });

  const reportJson = await readJson('report.json');
  const reportHtml = await readFile(path.join(testOutputAbsolute, 'report.html'), 'utf8');

  assert.equal(reportJson.catalogEntry.name, 'GreatVibes');
  assert.equal(evaluation.catalogEntry.name, 'GreatVibes');
  assert.ok(['PASS', 'CONDITIONAL_PASS', 'FAIL'].includes(reportJson.classification.overall));
  assert.ok(['Low', 'Medium', 'High'].includes(reportJson.modificationEffort.level));
  assert.ok(typeof reportJson.modificationEffort.rationale === 'string' && reportJson.modificationEffort.rationale.length > 0);
  assert.equal(reportJson.representativeHeightVariant, 'mid');

  for (const sizeId of ['ss6', 'ss10', 'ss16', 'ss20', 'ss30']) {
    const range = reportJson.heightRangeMmBySize[sizeId];
    assert.ok(range.min < range.max, `expected ${sizeId} min < max`);
  }

  for (const variantId of ['min', 'mid', 'max']) {
    const variant = reportJson.heightVariants[variantId];
    assert.ok(variant, `expected heightVariants.${variantId}`);
    assert.ok(Object.keys(variant.glyphs).length > 0, `expected glyph results for ${variantId}`);
    assert.ok(Object.keys(variant.words).length > 0, `expected word results for ${variantId}`);
    assert.ok(Array.isArray(variant.readability.lowStoneCountFindings), `expected readability findings for ${variantId}`);
  }
  // min/mid/max heights must actually differ per stone size (not all collapsed to one value).
  assert.notEqual(reportJson.heightVariants.min.heightMmBySize.ss6, reportJson.heightVariants.max.heightMmBySize.ss6);

  assert.ok(!('_productionAnalysisByVariantForSpecimen' in reportJson), 'report.json must not include the internal specimen-only field');

  assert.ok(reportHtml.includes('GreatVibes'.replace(/([a-z])([A-Z])/, '$1 $2')) || reportHtml.includes('Great Vibes'));
  assert.ok(reportHtml.includes('Modification effort estimate'));
  assert.ok(reportHtml.includes('Minimum height'));
  assert.ok(reportHtml.includes('Mid-range height'));
  assert.ok(reportHtml.includes('Maximum height'));
});

await test('evaluateSource() rejects an unknown font name', async () => {
  await assert.rejects(
    () => evaluateSource({ fontName: 'NotInCatalog', outputRelativePath: testOutputAbsolute, skipScreenshots: true }),
    /unknown font name/
  );
});

await rm(scratchRoot, { recursive: true, force: true });

if (process.exitCode !== 1) {
  console.log('\nAll FONT-SOURCE-001 evaluate-source tests passed.');
}
