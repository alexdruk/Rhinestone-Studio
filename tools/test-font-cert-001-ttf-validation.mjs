import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateTtf } from './font-certification/lib/ttfValidation.mjs';
import { loadCandidateFont } from './font-certification/lib/ttfParser.mjs';
import { REQUIRED_CHARACTERS, REQUIRED_SFNT_TABLES } from './font-certification/lib/requiredCharacters.mjs';
import { DEFAULT_CANDIDATE_RELATIVE_PATH } from './font-certification/certify.mjs';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const candidateAbsolutePath = path.join(repoRoot, DEFAULT_CANDIDATE_RELATIVE_PATH);

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

// --- Candidate discovery -------------------------------------------------------------------------

await test('FONT-CERT-001 candidate font exists at the exact spec-required path', async () => {
  await assert.doesNotReject(() => readFile(candidateAbsolutePath));
});

// --- TTF validation --------------------------------------------------------------------------------

await test('validateTtf() parses the real candidate and returns a check for every REQUIRED_SFNT_TABLES-relevant category', async () => {
  const { checks, font } = await validateTtf(candidateAbsolutePath);
  assert.ok(font, 'expected opentype.js to parse the candidate font');
  const ids = checks.map((c) => c.id);
  for (const expectedId of ['ttf-parse', 'outline-format', 'quadratic-outlines', 'units-per-em', 'glyph-count', 'notdef-glyph', 'cmap-coverage', 'required-characters', 'required-tables', 'font-naming', 'vertical-metrics', 'empty-glyphs', 'open-contours', 'self-intersections', 'zero-length-duplicate-segments', 'coordinate-range', 'advance-width-consistency']) {
    assert.ok(ids.includes(expectedId), `expected a "${expectedId}" check`);
  }
  for (const check of checks) {
    assert.ok(['PASS', 'WARNING', 'FAIL', 'NOT_VERIFIED'].includes(check.status), `check "${check.id}" has an invalid status "${check.status}"`);
    assert.ok(typeof check.detail === 'string' && check.detail.length > 0, `check "${check.id}" must have a non-empty detail string`);
  }
});

await test('validateTtf() correctly identifies the candidate as CFF-flavored OpenType, not TrueType', async () => {
  // This candidate is a real, known fixture: sfnt "OTTO", CFF outlines, missing glyf/loca. Pinning
  // this here catches any regression in the sfnt-table-directory / outline-format detection logic.
  const { checks, fontMetrics } = await validateTtf(candidateAbsolutePath);
  assert.equal(fontMetrics.sfntVersionTag, 'OTTO');
  assert.equal(fontMetrics.outlinesFormat, 'cff');
  const requiredTables = checks.find((c) => c.id === 'required-tables');
  assert.equal(requiredTables.status, 'FAIL');
  assert.ok(requiredTables.evidence.missing.includes('glyf'));
  assert.ok(requiredTables.evidence.missing.includes('loca'));
});

// --- Required glyph coverage -------------------------------------------------------------------------

await test('validateTtf() finds every required character mapped for this candidate (known-good fixture)', async () => {
  const { checks } = await validateTtf(candidateAbsolutePath);
  const requiredCharacters = checks.find((c) => c.id === 'required-characters');
  assert.equal(requiredCharacters.status, 'PASS');
  assert.equal(requiredCharacters.evidence.requiredCount, REQUIRED_CHARACTERS.length);
  assert.deepEqual(requiredCharacters.evidence.missing, []);
});

await test('validateTtf() reports missing required characters against a font that lacks them', async () => {
  // The repo's own placeholder desktop-font fixture (Roboto Mono stub) is a real file on disk but
  // not a valid font -- opentype.js will fail to parse it, exercising the "font failed to parse"
  // branch (every remaining check reported, none silently skipped).
  const brokenFixturePath = path.join(repoRoot, 'assets/fonts/RobotoMono-Regular.ttf');
  const { checks, font } = await validateTtf(brokenFixturePath);
  assert.equal(font, null);
  const parseCheck = checks.find((c) => c.id === 'ttf-parse');
  assert.equal(parseCheck.status, 'FAIL');
  const requiredCharacters = checks.find((c) => c.id === 'required-characters');
  assert.equal(requiredCharacters.status, 'FAIL');
});

// --- Deterministic output --------------------------------------------------------------------------

await test('validateTtf() produces byte-identical checks and fontMetrics across repeated runs', async () => {
  const first = await validateTtf(candidateAbsolutePath);
  const second = await validateTtf(candidateAbsolutePath);
  assert.deepEqual(JSON.parse(JSON.stringify(first.checks)), JSON.parse(JSON.stringify(second.checks)));
  assert.deepEqual(first.fontMetrics, second.fontMetrics);
});

// --- Missing-file failure --------------------------------------------------------------------------

await test('loadCandidateFont() rejects clearly when the candidate file does not exist', async () => {
  await assert.rejects(
    () => loadCandidateFont(path.join(repoRoot, 'fonts/candidates/does-not-exist/v999/Nope.ttf')),
    /ENOENT/
  );
});

console.log('FONT-CERT-001 TTF validation tests passed.');
