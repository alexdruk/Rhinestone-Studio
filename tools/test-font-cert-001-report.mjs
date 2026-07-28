import assert from 'node:assert/strict';
import { readFile, rm, mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { certify, DEFAULT_CANDIDATE_RELATIVE_PATH } from './font-certification/certify.mjs';

// FONT-CERT-002/FONT-CERT-001B: certification output must never be written under the repo's tmp/ --
// test-isolated output goes under the OS temp directory instead (an absolute path, used as-is by
// certify(), never joined against the repo root -- see certify.mjs's outputRelativePath handling).
const scratchRoot = await mkdtemp(path.join(os.tmpdir(), 'font-cert-001-report-test-'));
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

// --- Report generation (JSON + HTML artifacts, screenshots skipped for test speed) -----------------

await test('certify() writes every required JSON/HTML artifact for the real candidate', async () => {
  const { classification } = await certify({ candidateRelativePath: DEFAULT_CANDIDATE_RELATIVE_PATH, outputRelativePath: testOutputAbsolute, skipScreenshots: true });

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
  const run1Dir = path.join(scratchRoot, 'run1');
  const run2Dir = path.join(scratchRoot, 'run2');
  await certify({ candidateRelativePath: DEFAULT_CANDIDATE_RELATIVE_PATH, outputRelativePath: run1Dir, skipScreenshots: true });
  await certify({ candidateRelativePath: DEFAULT_CANDIDATE_RELATIVE_PATH, outputRelativePath: run2Dir, skipScreenshots: true });

  const stripTimestamp = (obj) => { const { generatedAt, ...rest } = obj; return rest; };

  const cert1 = stripTimestamp(JSON.parse(await readFile(path.join(run1Dir, 'certification.json'), 'utf8')));
  const cert2 = stripTimestamp(JSON.parse(await readFile(path.join(run2Dir, 'certification.json'), 'utf8')));
  assert.deepEqual(cert1, cert2);

  const glyph1 = stripTimestamp(JSON.parse(await readFile(path.join(run1Dir, 'glyph-findings.json'), 'utf8')));
  const glyph2 = stripTimestamp(JSON.parse(await readFile(path.join(run2Dir, 'glyph-findings.json'), 'utf8')));
  assert.deepEqual(glyph1, glyph2);
});

// --- Missing-file failure --------------------------------------------------------------------------

await test('certify() rejects with a clear, specific error when the candidate file is missing', async () => {
  await assert.rejects(
    () => certify({ candidateRelativePath: 'fonts/candidates/Does-Not-Exist/ttf/v001/Nope.ttf', outputRelativePath: path.join(scratchRoot, 'missing'), skipScreenshots: true }),
    /candidate font not found at expected path/
  );
});

// --- Overall PASS/WARNING/FAIL classification reaches the JSON artifact ----------------------------

await test('certify() surfaces the real candidate\'s known FAIL verdict (CFF outlines, missing glyf/loca) in certification.json', async () => {
  const certification = await readJson('certification.json');
  assert.equal(certification.overall, 'FAIL');
  assert.ok(certification.blockingIssues.some((i) => i.includes('glyf')));
});

await rm(scratchRoot, { recursive: true, force: true });

console.log('FONT-CERT-001 report generation tests passed.');
console.log(`(Verified candidate: ${DEFAULT_CANDIDATE_RELATIVE_PATH})`);
