import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { deriveOutputRelativePath } from './font-certification/lib/candidatePath.mjs';
import { certify } from './font-certification/certify.mjs';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const CERTIFY_SCRIPT = path.join(repoRoot, 'tools/font-certification/certify.mjs');
const V001_CANDIDATE = 'fonts/candidates/Elegant-Cursive/ttf/v001/Elegant-Cursive.ttf';
const V002_CANDIDATE = 'fonts/candidates/Elegant-Cursive/ttf/v002/Elegant-Cursive.ttf';
const V001_OUTPUT_ABS = path.join(repoRoot, 'fonts/candidates/Elegant-Cursive/certification/v001');
const V002_OUTPUT_ABS = path.join(repoRoot, 'fonts/candidates/Elegant-Cursive/certification/v002');

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

// --- deriveOutputRelativePath() (pure function) -----------------------------------------------------

await test('deriveOutputRelativePath() derives the version-specific folder for v001 and v002', () => {
  assert.equal(deriveOutputRelativePath(V001_CANDIDATE), 'fonts/candidates/Elegant-Cursive/certification/v001');
  assert.equal(deriveOutputRelativePath(V002_CANDIDATE), 'fonts/candidates/Elegant-Cursive/certification/v002');
});

await test('deriveOutputRelativePath() throws a clear error for a path that does not match the fonts/candidates/<Family>/ttf/<Version>/ structure', () => {
  assert.throws(() => deriveOutputRelativePath('not/a/candidate/path.ttf'), /does not match the expected/);
});

// --- Explicit v001 input (real end-to-end run) -------------------------------------------------------

await test('CLI with an explicit v001 path certifies v001 and writes to fonts/candidates/Elegant-Cursive/certification/v001/', async () => {
  // FONT-CERT-001B: this output folder is a retained, committed deliverable now, not disposable
  // tmp/ build output -- deliberately no rm() here (a stale prior run's typography-specimen.png/
  // rhinestone-specimen.png, only ever written when --no-screenshots is absent, must survive a
  // --no-screenshots test run untouched, not get wiped as test hygiene).
  const result = runCli([V001_CANDIDATE, '--no-screenshots']);

  assert.equal(result.status, 0, `expected exit code 0, got ${result.status}. stderr: ${result.stderr}`);
  assert.ok(result.stdout.includes(`FONT-CERT-001 candidate: ${V001_CANDIDATE}`), 'expected the exact input path to be printed before certification starts');

  const certification = JSON.parse(await readFile(path.join(V001_OUTPUT_ABS, 'certification.json'), 'utf8'));
  assert.equal(certification.candidate, V001_CANDIDATE);
});

// --- Explicit v002 input (real end-to-end run, never falling back to v001) --------------------------

await test('CLI with an explicit v002 path certifies v002 and writes to fonts/candidates/Elegant-Cursive/certification/v002/, not v001\'s folder', async () => {
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
  const missingPath = 'fonts/candidates/Elegant-Cursive/ttf/v999/Elegant-Cursive.ttf';
  const result = runCli([missingPath, '--no-screenshots']);
  assert.notEqual(result.status, 0, 'expected a non-zero exit code');
  assert.ok(result.stdout.includes(`FONT-CERT-001 candidate: ${missingPath}`), 'expected the exact (nonexistent) input path to still be printed before the existence check fails');
  assert.ok(result.stderr.includes('candidate font not found at expected path'), `stderr was: ${result.stderr}`);
});

await test('certify() (programmatic) rejects a nonexistent candidate without touching any output folder', async () => {
  await assert.rejects(
    () => certify({ candidateRelativePath: 'fonts/candidates/Elegant-Cursive/ttf/v999/Elegant-Cursive.ttf', skipScreenshots: true }),
    /candidate font not found at expected path/
  );
});

// --- Correct version-specific output path (both versions coexist, independently) --------------------

await test('v001 and v002 output folders coexist independently after both have been certified', async () => {
  const v001Files = await readFile(path.join(V001_OUTPUT_ABS, 'certification.json'), 'utf8');
  const v002Files = await readFile(path.join(V002_OUTPUT_ABS, 'certification.json'), 'utf8');
  assert.notEqual(JSON.parse(v001Files).candidate, JSON.parse(v002Files).candidate);
});

console.log('FONT-CERT-001A candidate-version CLI tests passed.');
