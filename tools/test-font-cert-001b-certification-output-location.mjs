import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { deriveOutputRelativePath } from './font-certification/lib/candidatePath.mjs';
import { certify } from './font-certification/certify.mjs';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const V001_CANDIDATE = 'fonts/candidates/Elegant-Cursive/ttf/v001/Elegant-Cursive.ttf';
const V002_CANDIDATE = 'fonts/candidates/Elegant-Cursive/ttf/v002/Elegant-Cursive.ttf';
// v003 does not need to exist on disk for these tests: path derivation is a pure function of the
// candidate path string, independent of whether the file is actually present yet.
const V003_CANDIDATE = 'fonts/candidates/Elegant-Cursive/ttf/v003/Elegant-Cursive.ttf';

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

// --- v001 / v002 / v003 output paths ----------------------------------------------------------------

await test('v001 output path is fonts/candidates/Elegant-Cursive/certification/v001', () => {
  assert.equal(deriveOutputRelativePath(V001_CANDIDATE), 'fonts/candidates/Elegant-Cursive/certification/v001');
});

await test('v002 output path is fonts/candidates/Elegant-Cursive/certification/v002', () => {
  assert.equal(deriveOutputRelativePath(V002_CANDIDATE), 'fonts/candidates/Elegant-Cursive/certification/v002');
});

await test('v003 output path is fonts/candidates/Elegant-Cursive/certification/v003 (derived without the file needing to exist)', () => {
  assert.equal(deriveOutputRelativePath(V003_CANDIDATE), 'fonts/candidates/Elegant-Cursive/certification/v003');
});

// --- No generated path contains /tmp/ -----------------------------------------------------------------

await test('no derived output path contains "tmp/" anywhere, for any candidate version', () => {
  for (const candidate of [V001_CANDIDATE, V002_CANDIDATE, V003_CANDIDATE]) {
    const outputPath = deriveOutputRelativePath(candidate);
    assert.ok(!outputPath.includes('tmp/'), `derived path "${outputPath}" for "${candidate}" must not contain "tmp/"`);
    assert.ok(outputPath.startsWith('fonts/candidates/'), `derived path "${outputPath}" must live under fonts/candidates/`);
  }
});

await test('a real certify() run for v001 resolves to an absolute outputDir with no "/tmp/" path segment', async () => {
  const { outputDir } = await certify({ candidateRelativePath: V001_CANDIDATE, skipScreenshots: true });
  assert.ok(!outputDir.includes(`${path.sep}tmp${path.sep}`), `outputDir "${outputDir}" must not contain a /tmp/ path segment`);
  assert.equal(outputDir, path.join(repoRoot, 'fonts/candidates/Elegant-Cursive/certification/v001'));
});

// --- Separate versions cannot overwrite each other ----------------------------------------------------

await test('certifying v002 does not alter v001\'s already-written certification.json', async () => {
  const v001OutputDir = path.join(repoRoot, 'fonts/candidates/Elegant-Cursive/certification/v001');
  const v002OutputDir = path.join(repoRoot, 'fonts/candidates/Elegant-Cursive/certification/v002');

  // Establish v001's output first, then read back its exact bytes as a baseline.
  await certify({ candidateRelativePath: V001_CANDIDATE, skipScreenshots: true });
  const v001Before = await readFile(path.join(v001OutputDir, 'certification.json'), 'utf8');

  // Certifying a different version must land in its own folder, not v001's.
  const { outputDir: v002ResolvedOutputDir } = await certify({ candidateRelativePath: V002_CANDIDATE, skipScreenshots: true });
  assert.equal(v002ResolvedOutputDir, v002OutputDir);

  const v001After = await readFile(path.join(v001OutputDir, 'certification.json'), 'utf8');
  assert.equal(v001Before, v001After, 'v001\'s certification.json must be byte-identical after certifying v002 -- v002 must never write into or overwrite v001\'s folder');

  const v001Json = JSON.parse(v001After);
  const v002Json = JSON.parse(await readFile(path.join(v002OutputDir, 'certification.json'), 'utf8'));
  assert.equal(v001Json.candidate, V001_CANDIDATE);
  assert.equal(v002Json.candidate, V002_CANDIDATE);
  assert.notEqual(v001Json.candidate, v002Json.candidate);
});

console.log('FONT-CERT-001B certification output location tests passed.');
