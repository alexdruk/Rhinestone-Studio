import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FontManager } from '../src/fonts/index.js';
import { createDefaultFontProviderRegistry } from '../src/text/index.js';
import { GeometryEngine } from '../src/geometry/index.js';
import { chooseTracking, pitchMmFor } from './font-certification/lib/trackingSolver.mjs';
import { assertTestRegistered } from './lib/test-registration-assertions.mjs';

// READ-011C follow-up -- pin tools/font-certification/lib/trackingSolver.mjs against the 75 frozen
// entries in docs/data/read-005/tracking-key.json.
//
// That key is the output of the READ-005 tracking experiment, whose McNemar result is the SOLE
// justification for tracking being a blocked factor in the READ-011 design. If the solver's answer
// for those 75 specs moves, that justification is no longer reproducible. This test re-runs the
// solver on every one of the 75 specs and compares letterSpacingMm, letterSpacingXPitch and
// separationRatioAfter to the frozen values.
//
// Each frozen entry maps to one rung of chooseTracking()'s ladder sweep:
//   - paired-tracked  -> sweep.chosen           (the sweep's own selection; also pins the >=0.95 rule)
//   - paired-control  -> rung at xPitch 0       (== sweep.before, by construction in tracking-renders.mjs)
//   - specificity/harm-> rung at xPitch 2.0     (tracking-renders.mjs' fixed CONTROL_XPITCH)
//   - repeats         -> the block of the entry its repeatOf points at
//
// On mismatch it prints every differing entry, the frozen vs recomputed value, and the delta, and
// splits them into "solver selection" mismatches (a different rung is chosen -- the extraction was
// not verbatim) and "measurement" mismatches (same rung, different ratio -- GlyphSeparation.js has
// drifted since READ-005 was frozen). Those two causes need telling apart.
//
// Needs src/ and npm deps (playwright is not required, but the font pipeline is), so it is in
// tools/test-groups.mjs' EXCLUDED_FROM_DEFAULT beside test-read-003-stem-width.mjs and runs via
// `npm run test:full`, an explicit filter, or `--group geometry`.

const repoRoot = fileURLToPath(new URL('..', import.meta.url));

const round = (v, d) => (Number.isFinite(v) ? Number(v.toFixed(d)) : null);

const trackingKey = JSON.parse(
  await readFile(path.join(repoRoot, 'docs/data/read-005/tracking-key.json'), 'utf8')
);
const entries = Object.entries(trackingKey).map(([slug, v]) => ({ slug, ...v }));
const bySlug = new Map(entries.map((e) => [e.slug, e]));

const manifest = JSON.parse(await readFile(path.join(repoRoot, 'assets/fonts/manifest.json'), 'utf8'));
const fontManager = new FontManager(manifest);
const providerById = new Map(fontManager.manifest.fonts.map((f) => [f.id, f.providerId ?? null]));
const engine = new GeometryEngine({
  fontProviderRegistry: createDefaultFontProviderRegistry(fontManager, {
    loadFontBuffer: async (rel) => {
      const b = await readFile(path.join(repoRoot, rel));
      return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
    }
  })
});

const specOf = (e) => ({
  fontId: e.fontId, text: e.text, stoneSizeId: e.stoneSizeId, heightMm: e.heightMm, mode: e.mode
});
const specSig = (e) => [e.fontId, e.text, e.stoneSizeId, e.heightMm, e.mode].join('|');

const sweepCache = new Map();
async function sweepFor(e) {
  const sig = specSig(e);
  if (!sweepCache.has(sig)) {
    sweepCache.set(sig, await chooseTracking(engine, providerById.get(e.fontId), specOf(e)));
  }
  return sweepCache.get(sig);
}

// The block whose logic produced this entry's frozen values (repeats inherit their source's).
function sourceBlock(e) {
  if (e.block !== 'repeats') return e.block;
  const src = bySlug.get(e.repeatOf);
  return src ? src.block : e.block;
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

await test('trackingSolver.mjs reproduces all 75 frozen READ-005 tracking-key entries', async () => {
  assert.equal(entries.length, 75, 'tracking-key.json holds exactly 75 entries');

  const selectionMismatches = []; // a different rung is chosen -> extraction not verbatim
  const measurementMismatches = []; // same rung, different ratio -> GlyphSeparation.js drift
  const structuralMismatches = []; // letterSpacingMm not derivable from the recorded xPitch

  for (const e of entries) {
    const sweep = await sweepFor(e);
    const pitchMm = pitchMmFor(e.stoneSizeId);
    const block = sourceBlock(e);

    // (a) letterSpacingMm must be xPitch * pitch (rounded 6dp), 0 when xPitch is 0.
    const expectedLsMm = e.letterSpacingXPitch === 0
      ? 0
      : Number((e.letterSpacingXPitch * pitchMm).toFixed(6));
    if (round(expectedLsMm, 6) !== round(e.letterSpacingMm, 6)) {
      structuralMismatches.push(
        `${e.slug} ${e.fontId}/${e.mode}: letterSpacingMm frozen ${e.letterSpacingMm}, ` +
        `xPitch ${e.letterSpacingXPitch} * pitch ${pitchMm.toFixed(4)} = ${expectedLsMm}`
      );
    }

    // (b) separationRatioAfter == the ratio the sweep measured at the frozen xPitch rung.
    const rung = sweep.rungs.find((r) => round(r.xPitch, 4) === e.letterSpacingXPitch);
    assert.ok(rung, `${e.slug}: frozen xPitch ${e.letterSpacingXPitch} is not a ladder rung`);
    const gotAfter = round(rung.separationRatio, 4);
    if (gotAfter !== e.separationRatioAfter) {
      measurementMismatches.push(
        `${e.slug} ${e.fontId}/${e.mode} r=${e.ratio} xPitch=${e.letterSpacingXPitch}: ` +
        `separationRatioAfter frozen ${e.separationRatioAfter}, recomputed ${gotAfter} ` +
        `(delta ${round(Math.abs((gotAfter ?? 0) - (e.separationRatioAfter ?? 0)), 4)})`
      );
    }

    // (c) paired-tracked: the sweep must SELECT the same rung and reach the same verdict.
    if (block === 'paired-tracked') {
      const gotXPitch = sweep.separationAchieved ? round(sweep.chosen.xPitch, 4) : 4;
      const gotChosenLsMm = round(sweep.chosen.letterSpacingMm, 6);
      if (gotXPitch !== e.letterSpacingXPitch) {
        selectionMismatches.push(
          `${e.slug} ${e.fontId}/${e.mode} r=${e.ratio}: chosen xPitch frozen ${e.letterSpacingXPitch}, ` +
          `recomputed ${gotXPitch} (achieved frozen ${e.separationAchieved}, recomputed ${sweep.separationAchieved})`
        );
      } else if (gotChosenLsMm !== round(e.letterSpacingMm, 6)) {
        selectionMismatches.push(
          `${e.slug} ${e.fontId}/${e.mode}: chosen letterSpacingMm frozen ${e.letterSpacingMm}, recomputed ${gotChosenLsMm}`
        );
      }
      if (sweep.separationAchieved !== e.separationAchieved) {
        selectionMismatches.push(
          `${e.slug} ${e.fontId}/${e.mode}: separationAchieved frozen ${e.separationAchieved}, recomputed ${sweep.separationAchieved}`
        );
      }
    }
  }

  const report = [];
  if (structuralMismatches.length) {
    report.push(`\n${structuralMismatches.length} STRUCTURAL mismatch(es) — letterSpacingMm not xPitch*pitch:`);
    report.push(...structuralMismatches.map((m) => `  ${m}`));
  }
  if (selectionMismatches.length) {
    report.push(`\n${selectionMismatches.length} SOLVER-SELECTION mismatch(es) — a different rung is chosen, so the extraction is NOT verbatim:`);
    report.push(...selectionMismatches.map((m) => `  ${m}`));
  }
  if (measurementMismatches.length) {
    report.push(`\n${measurementMismatches.length} MEASUREMENT mismatch(es) — same rung, different ratio, so GlyphSeparation.js has DRIFTED since READ-005 froze:`);
    report.push(...measurementMismatches.map((m) => `  ${m}`));
  }

  assert.ok(
    !structuralMismatches.length && !selectionMismatches.length && !measurementMismatches.length,
    report.join('\n')
  );
});

await test('this file is registered in the geometry group and excluded from the default suite', () => {
  assertTestRegistered({
    filename: 'test-read-011c-tracking-solver-regression.mjs',
    group: 'geometry',
    includedInDefault: false
  });
});

console.log('READ-011C tracking-solver regression tests passed.');
