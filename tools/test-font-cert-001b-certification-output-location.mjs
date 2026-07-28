import assert from 'node:assert/strict';
import { readFile, mkdir, copyFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { deriveOutputRelativePath } from './font-certification/lib/candidatePath.mjs';
import { certify, DEFAULT_CANDIDATE_RELATIVE_PATH } from './font-certification/certify.mjs';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const V001_CANDIDATE = 'fonts/candidates/Elegant-Cursive/ttf/v001/Elegant-Cursive.ttf';
const V002_CANDIDATE = 'fonts/candidates/Elegant-Cursive/ttf/v002/Elegant-Cursive.ttf';
// v003 does not need to exist on disk for these tests: path derivation is a pure function of the
// candidate path string, independent of whether the file is actually present yet.
const V003_CANDIDATE = 'fonts/candidates/Elegant-Cursive/ttf/v003/Elegant-Cursive.ttf';

// FONT-CERT-002: the two tests below that call certify() with no outputRelativePath override are
// specifically testing *default derived-path* behavior, which necessarily writes wherever
// deriveOutputRelativePath() says the given candidate belongs. Run against a scratch candidate
// family (copied from the real, committed v001/v002 fixtures -- still genuine, parseable fonts) so
// that write lands in a disposable scratch folder, not the real, committed
// fonts/candidates/Elegant-Cursive/certification/ output -- otherwise every test run would leave
// that folder's generatedAt timestamp (and now, post-FONT-CERT-002, its content) modified with
// nothing about the certification logic actually having changed.
const SCRATCH_FAMILY = '__FontCertTest001B__';
const SCRATCH_ROOT_RELATIVE = `fonts/candidates/${SCRATCH_FAMILY}`;
const SCRATCH_ROOT_ABS = path.join(repoRoot, SCRATCH_ROOT_RELATIVE);
const SCRATCH_V001_CANDIDATE = `${SCRATCH_ROOT_RELATIVE}/ttf/v001/Test.ttf`;
const SCRATCH_V002_CANDIDATE = `${SCRATCH_ROOT_RELATIVE}/ttf/v002/Test.ttf`;

async function setupScratchCandidates() {
  await rm(SCRATCH_ROOT_ABS, { recursive: true, force: true });
  await mkdir(path.join(SCRATCH_ROOT_ABS, 'ttf/v001'), { recursive: true });
  await mkdir(path.join(SCRATCH_ROOT_ABS, 'ttf/v002'), { recursive: true });
  await copyFile(path.join(repoRoot, DEFAULT_CANDIDATE_RELATIVE_PATH), path.join(SCRATCH_ROOT_ABS, 'ttf/v001/Test.ttf'));
  await copyFile(path.join(repoRoot, 'fonts/candidates/Elegant-Cursive/ttf/v002/Elegant-Cursive.ttf'), path.join(SCRATCH_ROOT_ABS, 'ttf/v002/Test.ttf'));
}

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

// --- v001 / v002 / v003 output paths (pure function, no disk I/O -- real candidate paths are fine) ---

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

// --- Real certify() runs against a scratch candidate (default-derived path, disk I/O) -----------------

await setupScratchCandidates();

await test('a real certify() run resolves to an absolute outputDir with no "/tmp/" path segment', async () => {
  const { outputDir } = await certify({ candidateRelativePath: SCRATCH_V001_CANDIDATE, skipScreenshots: true });
  assert.ok(!outputDir.includes(`${path.sep}tmp${path.sep}`), `outputDir "${outputDir}" must not contain a /tmp/ path segment`);
  assert.equal(outputDir, path.join(SCRATCH_ROOT_ABS, 'certification/v001'));
});

// --- Separate versions cannot overwrite each other ----------------------------------------------------

await test('certifying v002 does not alter v001\'s already-written certification.json', async () => {
  const v001OutputDir = path.join(SCRATCH_ROOT_ABS, 'certification/v001');
  const v002OutputDir = path.join(SCRATCH_ROOT_ABS, 'certification/v002');

  // Establish v001's output first, then read back its exact bytes as a baseline.
  await certify({ candidateRelativePath: SCRATCH_V001_CANDIDATE, skipScreenshots: true });
  const v001Before = await readFile(path.join(v001OutputDir, 'certification.json'), 'utf8');

  // Certifying a different version must land in its own folder, not v001's.
  const { outputDir: v002ResolvedOutputDir } = await certify({ candidateRelativePath: SCRATCH_V002_CANDIDATE, skipScreenshots: true });
  assert.equal(v002ResolvedOutputDir, v002OutputDir);

  const v001After = await readFile(path.join(v001OutputDir, 'certification.json'), 'utf8');
  assert.equal(v001Before, v001After, 'v001\'s certification.json must be byte-identical after certifying v002 -- v002 must never write into or overwrite v001\'s folder');

  const v001Json = JSON.parse(v001After);
  const v002Json = JSON.parse(await readFile(path.join(v002OutputDir, 'certification.json'), 'utf8'));
  assert.equal(v001Json.candidate, SCRATCH_V001_CANDIDATE);
  assert.equal(v002Json.candidate, SCRATCH_V002_CANDIDATE);
  assert.notEqual(v001Json.candidate, v002Json.candidate);
});

await rm(SCRATCH_ROOT_ABS, { recursive: true, force: true });

console.log('FONT-CERT-001B certification output location tests passed.');
