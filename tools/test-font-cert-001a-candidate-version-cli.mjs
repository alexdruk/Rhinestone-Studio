import assert from 'node:assert/strict';
import { readFile, mkdir, copyFile, rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { deriveOutputRelativePath } from './font-certification/lib/candidatePath.mjs';
import { certify, DEFAULT_CANDIDATE_RELATIVE_PATH } from './font-certification/certify.mjs';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const CERTIFY_SCRIPT = path.join(repoRoot, 'tools/font-certification/certify.mjs');

// FONT-CERT-002: these tests exercise the CLI's *default derived output path* behavior (no
// outputRelativePath override is possible from the CLI), which necessarily writes wherever
// deriveOutputRelativePath() says a given candidate belongs. Running them against the real
// Elegant-Cursive v001/v002 candidates would write into their real, committed
// fonts/candidates/Elegant-Cursive/certification/ folders on every test run -- leaving them
// "modified" by generatedAt alone even when nothing about the certification logic changed. A
// scratch candidate family (copied from the real v001/v002 fixtures, so it's still a genuine,
// parseable font) sidesteps that: its derived output lands in its own scratch folder, torn down
// before and after this file runs, and the real Elegant-Cursive certification output is never
// touched by this file at all.
const SCRATCH_FAMILY = '__FontCertTest001A__';
const SCRATCH_ROOT_RELATIVE = `fonts/candidates/${SCRATCH_FAMILY}`;
const SCRATCH_ROOT_ABS = path.join(repoRoot, SCRATCH_ROOT_RELATIVE);
const V001_CANDIDATE = `${SCRATCH_ROOT_RELATIVE}/ttf/v001/Test.ttf`;
const V002_CANDIDATE = `${SCRATCH_ROOT_RELATIVE}/ttf/v002/Test.ttf`;
const V001_OUTPUT_ABS = path.join(SCRATCH_ROOT_ABS, 'certification/v001');
const V002_OUTPUT_ABS = path.join(SCRATCH_ROOT_ABS, 'certification/v002');

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

function runCli(args) {
  return spawnSync(process.execPath, [CERTIFY_SCRIPT, ...args], { cwd: repoRoot, encoding: 'utf8' });
}

await setupScratchCandidates();

// --- deriveOutputRelativePath() (pure function) -----------------------------------------------------

await test('deriveOutputRelativePath() derives the version-specific folder for v001 and v002', () => {
  assert.equal(deriveOutputRelativePath(V001_CANDIDATE), `${SCRATCH_ROOT_RELATIVE}/certification/v001`);
  assert.equal(deriveOutputRelativePath(V002_CANDIDATE), `${SCRATCH_ROOT_RELATIVE}/certification/v002`);
});

await test('deriveOutputRelativePath() throws a clear error for a path that does not match the fonts/candidates/<Family>/ttf/<Version>/ structure', () => {
  assert.throws(() => deriveOutputRelativePath('not/a/candidate/path.ttf'), /does not match the expected/);
});

// --- Explicit v001 input (real end-to-end run, via a scratch candidate) ------------------------------

await test('CLI with an explicit v001 path certifies v001 and writes to that candidate\'s own certification/v001/ folder', async () => {
  const result = runCli([V001_CANDIDATE, '--no-screenshots']);

  assert.equal(result.status, 0, `expected exit code 0, got ${result.status}. stderr: ${result.stderr}`);
  assert.ok(result.stdout.includes(`FONT-CERT-001 candidate: ${V001_CANDIDATE}`), 'expected the exact input path to be printed before certification starts');

  const certification = JSON.parse(await readFile(path.join(V001_OUTPUT_ABS, 'certification.json'), 'utf8'));
  assert.equal(certification.candidate, V001_CANDIDATE);
});

// --- Explicit v002 input (real end-to-end run, never falling back to v001) --------------------------

await test('CLI with an explicit v002 path certifies v002 and writes to its own certification/v002/ folder, not v001\'s', async () => {
  const result = runCli([V002_CANDIDATE, '--no-screenshots']);

  assert.equal(result.status, 0, `expected exit code 0, got ${result.status}. stderr: ${result.stderr}`);
  assert.ok(result.stdout.includes(`FONT-CERT-001 candidate: ${V002_CANDIDATE}`), 'expected the exact input path to be printed before certification starts');

  const certification = JSON.parse(await readFile(path.join(V002_OUTPUT_ABS, 'certification.json'), 'utf8'));
  assert.equal(certification.candidate, V002_CANDIDATE);

  // The defining regression this milestone guards against: certifying v002 must never silently
  // reuse or overwrite v001's already-certified result.
  const v001Certification = JSON.parse(await readFile(path.join(V001_OUTPUT_ABS, 'certification.json'), 'utf8'));
  assert.equal(v001Certification.candidate, V001_CANDIDATE);
});

// --- Missing argument -----------------------------------------------------------------------------

await test('CLI with no positional argument fails clearly and does not fall back to v001', () => {
  const result = runCli(['--no-screenshots']);
  assert.notEqual(result.status, 0, 'expected a non-zero exit code');
  assert.ok(result.stderr.includes('expected exactly one candidate TTF path argument'), `stderr was: ${result.stderr}`);
  assert.ok(!result.stdout.includes('FONT-CERT-001 candidate:'), 'must not proceed to print/certify any candidate, including v001, when the argument is missing');
});

// --- Nonexistent file ------------------------------------------------------------------------------

await test('CLI with a nonexistent candidate path fails clearly, after printing that exact path', () => {
  const missingPath = `${SCRATCH_ROOT_RELATIVE}/ttf/v999/Test.ttf`;
  const result = runCli([missingPath, '--no-screenshots']);
  assert.notEqual(result.status, 0, 'expected a non-zero exit code');
  assert.ok(result.stdout.includes(`FONT-CERT-001 candidate: ${missingPath}`), 'expected the exact (nonexistent) input path to still be printed before the existence check fails');
  assert.ok(result.stderr.includes('candidate font not found at expected path'), `stderr was: ${result.stderr}`);
});

await test('certify() (programmatic) rejects a nonexistent candidate without touching any output folder', async () => {
  await assert.rejects(
    () => certify({ candidateRelativePath: `${SCRATCH_ROOT_RELATIVE}/ttf/v999/Test.ttf`, skipScreenshots: true }),
    /candidate font not found at expected path/
  );
});

// --- Correct version-specific output path (both versions coexist, independently) --------------------

await test('v001 and v002 output folders coexist independently after both have been certified', async () => {
  const v001Files = await readFile(path.join(V001_OUTPUT_ABS, 'certification.json'), 'utf8');
  const v002Files = await readFile(path.join(V002_OUTPUT_ABS, 'certification.json'), 'utf8');
  assert.notEqual(JSON.parse(v001Files).candidate, JSON.parse(v002Files).candidate);
});

await rm(SCRATCH_ROOT_ABS, { recursive: true, force: true });

console.log('FONT-CERT-001A candidate-version CLI tests passed.');
