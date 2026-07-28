import assert from 'node:assert/strict';
import { readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { certify, DEFAULT_CANDIDATE_RELATIVE_PATH } from './font-certification/certify.mjs';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const TEST_OUTPUT_RELATIVE = 'tmp/font-certification-test-output';
const testOutputAbsolute = path.join(repoRoot, TEST_OUTPUT_RELATIVE);

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

// --- Report generation (JSON + HTML artifacts, screenshots skipped for test speed) -----------------

await test('certify() writes every required JSON/HTML artifact for the real candidate', async () => {
  const { classification } = await certify({ candidateRelativePath: DEFAULT_CANDIDATE_RELATIVE_PATH, outputRelativePath: TEST_OUTPUT_RELATIVE, skipScreenshots: true });

  const certification = await readJson('certification.json');
  const fontMetrics = await readJson('font-metrics.json');
  const glyphFindings = await readJson('glyph-findings.json');
  const reportHtml = await readFile(path.join(testOutputAbsolute, 'report.html'), 'utf8');

  assert.equal(certification.overall, classification.overall);
  assert.ok(['PASS', 'CONDITIONAL_PASS', 'FAIL'].includes(certification.overall));
  assert.ok(Array.isArray(certification.ttfChecks) && certification.ttfChecks.length > 0);
  assert.ok(Array.isArray(certification.claudeDesignFeedback) && certification.claudeDesignFeedback.length > 0);

  assert.equal(fontMetrics.family, 'Elegant Cursive');
  assert.ok(fontMetrics.glyphCount > 0);

  assert.ok(glyphFindings.glyphs && Object.keys(glyphFindings.glyphs).length > 0);
  assert.ok(glyphFindings.words && Object.keys(glyphFindings.words).length > 0);
  assert.ok(Array.isArray(glyphFindings.similarityFindings) && glyphFindings.similarityFindings.length > 0);

  assert.ok(reportHtml.includes('<title>FONT-CERT-001'));
  assert.ok(reportHtml.includes('Feedback for Claude Design'));
  for (const sectionTitle of [
    '1. Executive certification result', '2. TTF validation table', '3. Typography specimen',
    '4. Rhinestone specimen by supported stone size', '5. Glyph-by-glyph findings',
    '6. Word-level findings', '7. Production metrics', '8. Exact blocking issues',
    '9. Recommended Claude Design revision feedback'
  ]) {
    assert.ok(reportHtml.includes(sectionTitle), `report.html missing section "${sectionTitle}"`);
  }
});

// --- Deterministic output --------------------------------------------------------------------------

await test('certify() produces byte-identical certification.json/glyph-findings.json across repeated runs (excluding timestamps)', async () => {
  await certify({ candidateRelativePath: DEFAULT_CANDIDATE_RELATIVE_PATH, outputRelativePath: `${TEST_OUTPUT_RELATIVE}-run1`, skipScreenshots: true });
  await certify({ candidateRelativePath: DEFAULT_CANDIDATE_RELATIVE_PATH, outputRelativePath: `${TEST_OUTPUT_RELATIVE}-run2`, skipScreenshots: true });

  const stripTimestamp = (obj) => { const { generatedAt, ...rest } = obj; return rest; };

  const cert1 = stripTimestamp(JSON.parse(await readFile(path.join(repoRoot, `${TEST_OUTPUT_RELATIVE}-run1`, 'certification.json'), 'utf8')));
  const cert2 = stripTimestamp(JSON.parse(await readFile(path.join(repoRoot, `${TEST_OUTPUT_RELATIVE}-run2`, 'certification.json'), 'utf8')));
  assert.deepEqual(cert1, cert2);

  const glyph1 = stripTimestamp(JSON.parse(await readFile(path.join(repoRoot, `${TEST_OUTPUT_RELATIVE}-run1`, 'glyph-findings.json'), 'utf8')));
  const glyph2 = stripTimestamp(JSON.parse(await readFile(path.join(repoRoot, `${TEST_OUTPUT_RELATIVE}-run2`, 'glyph-findings.json'), 'utf8')));
  assert.deepEqual(glyph1, glyph2);

  await rm(path.join(repoRoot, `${TEST_OUTPUT_RELATIVE}-run1`), { recursive: true, force: true });
  await rm(path.join(repoRoot, `${TEST_OUTPUT_RELATIVE}-run2`), { recursive: true, force: true });
});

// --- Missing-file failure --------------------------------------------------------------------------

await test('certify() rejects with a clear, specific error when the candidate file is missing', async () => {
  await assert.rejects(
    () => certify({ candidateRelativePath: 'fonts/candidates/Does-Not-Exist/ttf/v001/Nope.ttf', outputRelativePath: `${TEST_OUTPUT_RELATIVE}-missing`, skipScreenshots: true }),
    /candidate font not found at expected path/
  );
});

// --- Overall PASS/WARNING/FAIL classification reaches the JSON artifact ----------------------------

await test('certify() surfaces the real candidate\'s known FAIL verdict (CFF outlines, missing glyf/loca) in certification.json', async () => {
  const certification = await readJson('certification.json');
  assert.equal(certification.overall, 'FAIL');
  assert.ok(certification.blockingIssues.some((i) => i.includes('glyf')));
});

await rm(testOutputAbsolute, { recursive: true, force: true });
await rm(path.join(repoRoot, `${TEST_OUTPUT_RELATIVE}-missing`), { recursive: true, force: true });

console.log('FONT-CERT-001 report generation tests passed.');
console.log(`(Verified candidate: ${DEFAULT_CANDIDATE_RELATIVE_PATH})`);
