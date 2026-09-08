// MONO-015 -- Weight-following stone size (opt-in).
//
// Covers src/geometry/StrokeWidthProbe.js, src/geometry/WeightSizing.js, StoneSampler
// dropOverlappingSizedStones() (phase C), GeometryEngine.generateTextLayout()'s sizeMode 'weight'
// branch, and MonogramGenerator's opt-in wiring. Real repository fonts, same bootstrap as
// tools/test-mono-013-interlock.mjs.
//
// Run `npm ci` first (opentype.js is needed for src/text/**).

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FontManager } from '../src/fonts/index.js';
import { createDefaultFontProviderRegistry } from '../src/text/index.js';
import { GeometryEngine } from '../src/geometry/index.js';
import {
  strokeWidthsForSamples,
  localStrokeWidthMm,
  weightSizeMm,
  defaultWeightMaxSizeMm,
  WEIGHT_SIZING_CATALOG_DIAMETERS_MM,
  dropOverlappingSizedStones,
  sampleShapeFillPoints
} from '../src/geometry/index.js';
import { listStoneSizes } from '../src/renderer/StoneSizes.js';
import { Point2D } from '../src/text/VectorPath.js';
import { MonogramGenerator } from '../src/monogram/index.js';
import { validateRhsProject, generateProjectStoneLayout } from './lib/rhsProject.mjs';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const manifest = JSON.parse(await readFile(path.join(repoRoot, 'assets/fonts/manifest.json'), 'utf8'));
const fontManager = new FontManager(manifest);
async function loadFontBuffer(relativePath) {
  const buffer = await readFile(path.join(repoRoot, relativePath));
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
}
const fontProviderRegistry = createDefaultFontProviderRegistry(fontManager, { loadFontBuffer });
const engine = new GeometryEngine({ fontProviderRegistry });

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

const CATALOG = WEIGHT_SIZING_CATALOG_DIAMETERS_MM;

/** A tapered stroke polygon: `lengthMm` long, width `w0Mm` -> `w1Mm` linearly, centred on y = 0. */
function taperedStrokePolygon(lengthMm, w0Mm, w1Mm, segments = 80) {
  const top = [];
  const bottom = [];
  for (let k = 0; k <= segments; k++) {
    const x = (k / segments) * lengthMm;
    const w = w0Mm + (w1Mm - w0Mm) * (k / segments);
    top.push(new Point2D(x, -w / 2));
    bottom.push(new Point2D(x, w / 2));
  }
  return [...top, ...bottom.reverse()];
}

/**
 * Split a stone list (in engine output order == per-contour walk order) into runs of consecutive
 * same-diameter stones, further splitting where the jump to the next stone exceeds 1.5x that run's
 * own `d + gapMm` ideal pitch -- a contour boundary or a genuine (phase-C-dropped) gap, not a
 * continuation of the same chain. Returns `{sizeMm, stones, pitches}` per run.
 */
function sameSizeRuns(stones, gapMm) {
  const runs = [];
  let current = null;
  for (const s of stones) {
    if (current && s.sizeMm === current.sizeMm) {
      const prev = current.stones[current.stones.length - 1];
      const step = Math.hypot(s.xMm - prev.xMm, s.yMm - prev.yMm);
      if (step <= 1.5 * (s.sizeMm + gapMm)) {
        current.stones.push(s);
        current.pitches.push(step);
        continue;
      }
    }
    current = { sizeMm: s.sizeMm, stones: [s], pitches: [] };
    runs.push(current);
  }
  return runs;
}

function median(values) {
  const a = [...values].sort((x, y) => x - y);
  const m = Math.floor(a.length / 2);
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}

/**
 * Per-diameter table of every >=3-stone run's median centre-to-centre pitch, its diameter's own
 * `d + gapMm` ideal, and the percentage over/under. Printed by the spacing tests.
 */
function pitchTable(stones, gapMm) {
  const runs = sameSizeRuns(stones, gapMm).filter((r) => r.stones.length >= 3);
  const present = [...new Set(stones.map((s) => s.sizeMm))].sort((a, b) => a - b);
  return present.map((d) => {
    const idealMm = d + gapMm;
    const rows = runs.filter((r) => r.sizeMm === d).map((r) => {
      const medianPitchMm = median(r.pitches);
      return { length: r.stones.length, medianPitchMm, offPct: ((medianPitchMm - idealMm) / idealMm) * 100 };
    });
    return { d, idealMm, rows };
  });
}

function noPairViolatesHalfSum(stones) {
  for (let i = 0; i < stones.length; i++) {
    for (let j = i + 1; j < stones.length; j++) {
      const dist = Math.hypot(stones[i].xMm - stones[j].xMm, stones[i].yMm - stones[j].yMm);
      const floor = (stones[i].sizeMm + stones[j].sizeMm) / 2;
      if (dist < floor - 1e-6) {
        return { i, j, dist, floor };
      }
    }
  }
  return null;
}

// ---------------------------------------------------------------------------

await test('catalog cross-check: WEIGHT_SIZING_CATALOG_DIAMETERS_MM is derived from src/renderer/StoneSizes.js (imported, not hand-copied)', () => {
  const fromLibrary = listStoneSizes().map((s) => s.diameterMm);
  // WeightSizing.js now imports listStoneSizes() directly, so this is a tautology by construction --
  // kept as a cheap guard that the derivation (and the ascending order it relies on) still holds.
  assert.deepEqual(CATALOG, fromLibrary, `catalog ${JSON.stringify(CATALOG)} != listStoneSizes() ${JSON.stringify(fromLibrary)}`);
  for (let i = 1; i < CATALOG.length; i++) assert.ok(CATALOG[i] > CATALOG[i - 1], 'catalog must be strictly ascending');
});

await test('weightSizeMm: smallest catalog diameter >= width, then clamped into [min,max]; SS16 is 4.0 mm (not 3.8)', () => {
  assert.equal(CATALOG[2], 4.0, 'SS16 must be 4.0 mm');
  assert.equal(weightSizeMm(1.6, 2.0, 4.0), 2.0);
  assert.equal(weightSizeMm(2.0, 2.0, 4.0), 2.0);
  assert.equal(weightSizeMm(2.01, 2.0, 4.0), 2.8);
  assert.equal(weightSizeMm(3.5, 2.0, 4.0), 4.0);
  assert.equal(weightSizeMm(99, 2.0, 4.0), 4.0, 'width beyond every catalog entry -> largest, then clamp');
  assert.equal(weightSizeMm(3.5, 2.0, 2.8), 2.8, 'clamped down to max');
  assert.equal(weightSizeMm(0.1, 2.8, 4.0), 2.8, 'clamped up to min');
  assert.equal(weightSizeMm(3.5, 2.0, 2.0), 2.0, 'min == max collapses to that size');
});

await test('defaultWeightMaxSizeMm: two catalog steps up, clamped to the largest entry (SS20 has one step, SS30 none)', () => {
  assert.equal(defaultWeightMaxSizeMm(2.0), 4.0, 'SS6 -> SS16');
  assert.equal(defaultWeightMaxSizeMm(2.8), 4.7, 'SS10 -> SS20');
  assert.equal(defaultWeightMaxSizeMm(4.0), 6.4, 'SS16 -> SS30');
  assert.equal(defaultWeightMaxSizeMm(4.7), 6.4, 'SS20 -> SS30 (clamped, only one step up)');
  assert.equal(defaultWeightMaxSizeMm(6.4), 6.4, 'SS30 -> SS30 (clamped, no step up)');
});

// ---------------------------------------------------------------------------
// Test 1 -- probe monotonicity + assignment sanity.
// ---------------------------------------------------------------------------

await test('1. probe monotonicity on a synthetic tapered stroke: monotone widths, non-decreasing catalog assignments, no surviving pair violates (d1+d2)/2', () => {
  const polygon = taperedStrokePolygon(40, 0.8, 4.0);
  // Probe points sit ON the top edge of the stroke (this is how phase A feeds the probe -- outline
  // samples lie on the contour), so the inward ray crosses the whole stroke and reads its full
  // width. `w(x) = 0.8 + (4.0 - 0.8) * x / 40`, top edge at y = -w/2.
  const widthAt = (x) => 0.8 + (4.0 - 0.8) * (x / 40);
  const samples = [];
  for (let x = 1; x <= 39; x += 2) samples.push(new Point2D(x, -widthAt(x) / 2));
  const widths = strokeWidthsForSamples(samples, [polygon], 6.0);

  for (let i = 1; i < widths.length; i++) {
    assert.ok(widths[i] >= widths[i - 1] - 0.05, `probe width not monotone at station ${i}: ${widths[i - 1].toFixed(4)} -> ${widths[i].toFixed(4)}`);
  }
  for (let i = 0; i < samples.length; i++) {
    const expected = widthAt(1 + i * 2);
    assert.ok(Math.abs(widths[i] - expected) < 0.05, `probe width ${widths[i].toFixed(4)} vs expected ${expected.toFixed(4)} at x=${1 + i * 2}`);
  }

  const assigned = samples.map((p, i) => ({ xMm: p.xMm, yMm: p.yMm, sizeMm: weightSizeMm(widths[i], 2.0, 4.0) }));
  for (let i = 1; i < assigned.length; i++) {
    assert.ok(assigned[i].sizeMm >= assigned[i - 1].sizeMm, `assigned size not non-decreasing at station ${i}`);
  }
  for (const s of assigned) {
    assert.ok(CATALOG.includes(s.sizeMm), `assigned size ${s.sizeMm} is not a catalog diameter`);
  }

  const survivors = dropOverlappingSizedStones(assigned);
  const violation = noPairViolatesHalfSum(survivors);
  assert.equal(violation, null, `a surviving pair violates (d1+d2)/2: ${JSON.stringify(violation)}`);
});

// ---------------------------------------------------------------------------
// Test 2 -- the vacuity control. Print entering/leaving counts, no verdict.
// ---------------------------------------------------------------------------

await test('2. vacuity control (run by name): phase C entering vs leaving count on the tapered stroke, at the real 2x-oversampled phase-A pitch -- both printed', () => {
  const gapMm = 0.3;
  const minMm = 2.0;
  const maxMm = 4.0;
  const factor = 2; // maxMm > minMm
  const polygon = taperedStrokePolygon(40, 0.8, 4.0);
  const phaseA = sampleShapeFillPoints('outline', [polygon], { minXmm: 0, minYmm: -2.5, maxXmm: 40, maxYmm: 2.5 }, (minMm + gapMm) / factor, minMm / factor);
  const widths = strokeWidthsForSamples(phaseA, [polygon], maxMm);
  const assigned = phaseA.map((p, i) => ({ xMm: p.xMm, yMm: p.yMm, sizeMm: weightSizeMm(widths[i], minMm, maxMm) }));
  const survivors = dropOverlappingSizedStones(assigned);
  console.log(`    phase C: entering ${assigned.length} stones, leaving ${survivors.length} stones (dropped ${assigned.length - survivors.length})`);
  if (assigned.length - survivors.length === 0) {
    assert.fail('phase C dropped zero stones -- test 1\'s "no pair violates" assertion would be vacuous. This is a test-design failure, not a pass.');
  }
});

// ---------------------------------------------------------------------------
// Test 3 -- reduction to uniform. Byte-identical when weightMinSizeMm === weightMaxSizeMm === 2.0.
// ---------------------------------------------------------------------------

await test('3. reduction to uniform: weight {2.0, 2.0} text layout is byte-identical to uniform SS6 -- counts + first three stone records printed for both', async () => {
  const base = {
    text: 'Rhinestone', fontId: 'dancing-script-regular', providerId: 'opentype', layerId: 'weight-reduce',
    heightMm: 30, stoneSizeMm: 2.0, gapMm: 0.3, mode: 'outline', color: 'gold'
  };
  const uniform = await engine.generateTextLayout(base);
  const weight = await engine.generateTextLayout({ ...base, sizeMode: 'weight', weightMinSizeMm: 2.0, weightMaxSizeMm: 2.0 });
  const first3 = (layout) => layout.stones.slice(0, 3).map((s) => ({ xMm: Number(s.xMm.toFixed(6)), yMm: Number(s.yMm.toFixed(6)), sizeMm: s.sizeMm }));
  console.log(`    uniform SS6 count ${uniform.count}, first three ${JSON.stringify(first3(uniform))}`);
  console.log(`    weight {2,2}  count ${weight.count}, first three ${JSON.stringify(first3(weight))}`);
  assert.equal(weight.count, uniform.count, 'stone count differs');
  assert.deepEqual(weight.toJSON().stones, uniform.toJSON().stones, 'stone records differ -- not byte-identical to uniform');
});

// ---------------------------------------------------------------------------
// Test 4 -- real glyph spacing, in place of a stone-count band.
//
// A total stone count cannot guard weight mode: a layout mixing 2.0/2.8/4.0 mm stones must land
// somewhere between uniform-2.0 and uniform-4.0, and on develop uniform-2.8 alone is already -34%
// (uniform "A" 45 mm: 2.0 -> 94, 2.8 -> 62, 4.0 -> 36). No band anchored to the uniform-SS6 count
// can be both tight and correct. What CAN be guarded is the pitch inside a run of same-size stones:
// phase C only drops, so survivors sit at integer multiples of the phase-A pitch, and at the plain
// min pitch a 2.8 mm run comes out 48% over-spaced against its own d+gap ideal -- the
// SINGLE_CHAIN_MIN_RATIO gap-failure mode. GeometryEngine's weight branch oversamples phase A by 2x
// when the layer mixes sizes; these tests assert that fixes the pitch.
// ---------------------------------------------------------------------------

const OVERSAMPLE_TOLERANCE = 0.15; // median run pitch must be within 15% of d + gapMm

// The oversample factor GeometryEngine.js's weight branch applies. Kept here so the synthetic-stroke
// test drives the primitives with the exact same arithmetic the engine uses.
const oversampleFactor = (minMm, maxMm) => (maxMm > minMm ? 2 : 1);

await test('4a. synthetic tapered stroke: at the plain min pitch a 2.8 mm run is ~48% over-spaced (the defect); with 2x oversampling every present diameter\'s median run pitch is within 15% of d + gapMm', () => {
  const gapMm = 0.3;
  const minMm = 2.0;
  const maxMm = 4.0;
  // 80 mm long, 0.8 -> 4.6 mm wide: sustained runs of 2.0, 2.8 and 4.0 mm all occur.
  const polygon = taperedStrokePolygon(80, 0.8, 4.6, 120);
  const boundingBox = { minXmm: 0, minYmm: -2.5, maxXmm: 80, maxYmm: 2.5 };

  const runAt = (factor) => {
    const spacingMm = (minMm + gapMm) / factor;
    const separationMm = minMm / factor;
    const samples = sampleShapeFillPoints('outline', [polygon], boundingBox, spacingMm, separationMm);
    const widths = strokeWidthsForSamples(samples, [polygon], maxMm);
    const assigned = samples.map((p, i) => ({ xMm: p.xMm, yMm: p.yMm, sizeMm: weightSizeMm(widths[i], minMm, maxMm) }));
    return dropOverlappingSizedStones(assigned);
  };

  // Factor 1 -- the defect. At least one >=3-stone run must exceed the tolerance.
  const factor1 = runAt(1);
  const table1 = pitchTable(factor1, gapMm);
  console.log('    factor 1 (plain min pitch):');
  for (const t of table1) {
    for (const r of t.rows) console.log(`      d=${t.d} len=${r.length} medianPitch=${r.medianPitchMm.toFixed(3)} ideal=${t.idealMm.toFixed(2)} off=${r.offPct.toFixed(1)}%`);
  }
  const worstFactor1 = Math.max(...table1.flatMap((t) => t.rows.map((r) => Math.abs(r.offPct))), 0);
  assert.ok(worstFactor1 / 100 > OVERSAMPLE_TOLERANCE,
    `factor 1 should over-space some run past ${OVERSAMPLE_TOLERANCE * 100}% -- worst was ${worstFactor1.toFixed(1)}%. If this fails, the run grouping is wrong, not the sampler.`);

  // Factor 2 -- the fix. EVERY present diameter has at least one >=3-stone run, and every such run's
  // median pitch is within tolerance.
  const factor2 = runAt(oversampleFactor(minMm, maxMm));
  const table2 = pitchTable(factor2, gapMm);
  console.log(`    factor ${oversampleFactor(minMm, maxMm)} (oversampled): ${factor2.length} stones`);
  for (const t of table2) {
    assert.ok(t.rows.length >= 1, `no >=3-stone run of ${t.d} mm stones to measure pitch on`);
    for (const r of t.rows) {
      console.log(`      d=${t.d} len=${r.length} medianPitch=${r.medianPitchMm.toFixed(3)} ideal=${t.idealMm.toFixed(2)} off=${r.offPct.toFixed(1)}%`);
      assert.ok(Math.abs(r.offPct) / 100 <= OVERSAMPLE_TOLERANCE,
        `a ${t.d} mm run's median pitch ${r.medianPitchMm.toFixed(3)} mm is ${r.offPct.toFixed(1)}% off its ${t.idealMm.toFixed(2)} mm ideal (> ${OVERSAMPLE_TOLERANCE * 100}%)`);
    }
  }
});

await test('4b. real engine path: Great Vibes "A" 45 mm weight {2.0, 4.0} -- every >=3-stone run\'s median pitch is within 15% of d + gapMm; the min and max diameters each form such a run', async () => {
  const base = {
    text: 'A', fontId: 'great-vibes-regular', providerId: 'opentype', layerId: 'weight-glyph',
    heightMm: 45, stoneSizeMm: 2.0, gapMm: 0.3, mode: 'outline', color: 'gold'
  };
  const weight = await engine.generateTextLayout({ ...base, sizeMode: 'weight', weightMinSizeMm: 2.0, weightMaxSizeMm: 4.0 });
  const distinct = [...new Set(weight.stones.map((s) => s.sizeMm))].sort((a, b) => a - b);

  assert.ok(distinct.length >= 2, `expected at least two distinct sizes, got ${JSON.stringify(distinct)}`);
  assert.equal(noPairViolatesHalfSum(weight.stones), null, 'a stone pair physically overlaps');

  const table = pitchTable(weight.stones, 0.3);
  console.log('    Great Vibes "A" weight {2.0, 4.0} run pitches (>= 3 stones):');
  for (const t of table) {
    if (t.rows.length === 0) {
      console.log(`      d=${t.d}: no sustained run -- this glyph has no >=3-stone chain of ${t.d} mm stones (short transition regions only)`);
      continue;
    }
    for (const r of t.rows) {
      console.log(`      d=${t.d} len=${r.length} medianPitch=${r.medianPitchMm.toFixed(3)} ideal=${t.idealMm.toFixed(2)} off=${r.offPct.toFixed(1)}%`);
      assert.ok(Math.abs(r.offPct) / 100 <= OVERSAMPLE_TOLERANCE,
        `a ${t.d} mm run's median pitch ${r.medianPitchMm.toFixed(3)} mm is ${r.offPct.toFixed(1)}% off its ${t.idealMm.toFixed(2)} mm ideal`);
    }
  }
  // The range endpoints (2.0 and 4.0) are the diameters guaranteed a sustained region by
  // construction -- the hairline and the thickest stroke. 2.8 mm is a transition width on this
  // particular glyph and legitimately has no >=3 chain (printed above, not asserted).
  for (const d of [2.0, 4.0]) {
    const t = table.find((row) => row.d === d);
    assert.ok(t && t.rows.length >= 1, `expected at least one >=3-stone run of ${d} mm stones on Great Vibes "A"`);
  }

  // Stem sanity anchor (spec): 0.0357 * 45 = 1.6065 mm -> weightSizeMm assigns 2.0 -> 0.803 stones
  // across the stem, above SINGLE_CHAIN_MIN_RATIO (0.70).
  const stemWidthMm = 0.0357 * 45;
  const stemStones = stemWidthMm / weightSizeMm(stemWidthMm, 2.0, 4.0);
  console.log(`    stem: width ${stemWidthMm.toFixed(4)} mm -> stone ${weightSizeMm(stemWidthMm, 2.0, 4.0)} mm -> ${stemStones.toFixed(4)} stones across (must exceed 0.70)`);
  assert.ok(stemStones > 0.70, `stem stones ${stemStones.toFixed(4)} <= 0.70`);
});

await test('4c. golden stone count: Great Vibes "A" 45 mm weight {2.0, 4.0} == 68, exact (develop uniform anchors: 2.0 -> 94, 2.8 -> 62, 4.0 -> 36; a correct weight mix lands between 94 and 36)', async () => {
  const base = {
    text: 'A', fontId: 'great-vibes-regular', providerId: 'opentype', layerId: 'weight-golden',
    heightMm: 45, stoneSizeMm: 2.0, gapMm: 0.3, mode: 'outline', color: 'gold'
  };
  const weight = await engine.generateTextLayout({ ...base, sizeMode: 'weight', weightMinSizeMm: 2.0, weightMaxSizeMm: 4.0 });
  console.log(`    Great Vibes "A" weight {2.0, 4.0} stone count: ${weight.count}`);
  assert.equal(weight.count, 68, 'golden stone count changed');
});

// ---------------------------------------------------------------------------
// Test 5 -- mode guard.
// ---------------------------------------------------------------------------

await test('5. mode guard: sizeMode "weight" throws for mode "fill", and for an authored (non-outline) font', async () => {
  await assert.rejects(
    engine.generateTextLayout({
      text: 'A', fontId: 'great-vibes-regular', providerId: 'opentype', layerId: 'g',
      heightMm: 30, stoneSizeMm: 2.0, gapMm: 0.3, mode: 'fill',
      sizeMode: 'weight', weightMinSizeMm: 2.0, weightMaxSizeMm: 4.0
    }),
    /weight-following stone size .* requires outline mode/,
    'fill + weight did not throw'
  );
  await assert.rejects(
    engine.generateTextLayout({
      text: 'A', fontId: 'rs-block', providerId: 'rhinestone', layerId: 'g',
      heightMm: 40, stoneSizeMm: 2.0, gapMm: 0.3, mode: 'outline',
      sizeMode: 'weight', weightMinSizeMm: 2.0, weightMaxSizeMm: 4.0
    }),
    /authored stone centers/,
    'authored font + weight did not throw'
  );
});

await test('5b. non-text callers throw on a stray sizeMode "weight" (caller bug, not silently absorbed)', () => {
  assert.throws(
    () => engine.generateShapeLayout({
      shape: 'rectangle', layerId: 's', xMm: 0, yMm: 0, widthMm: 40, heightMm: 20,
      stoneSizeMm: 2.0, gapMm: 0.3, mode: 'outline', sizeMode: 'weight', weightMinSizeMm: 2.0, weightMaxSizeMm: 4.0
    }),
    /only supported for a text layer sampled in outline mode/,
    'a shape layer with sizeMode "weight" must throw'
  );
  assert.throws(
    () => engine.generateSvgLayout({
      svgSource: '<svg xmlns="http://www.w3.org/2000/svg" width="20mm" height="20mm"><rect width="20" height="20"/></svg>',
      layerId: 's', xMm: 0, yMm: 0, widthMm: 20, heightMm: 20,
      stoneSizeMm: 2.0, gapMm: 0.3, mode: 'outline', sizeMode: 'weight', weightMinSizeMm: 2.0, weightMaxSizeMm: 4.0
    }),
    /only supported for a text layer sampled in outline mode/,
    'an SVG layer with sizeMode "weight" must throw'
  );
});

await test('5c. an *unknown* sizeMode string is still the old-project compatibility path (resolveSizeMode falls back to uniform; the engine never sees it)', () => {
  // resolveSizeMode() (app.js) maps anything not in SIZE_MODES to 'uniform' before mixedSizeParamsFor()
  // forwards it, so the engine only ever receives 'uniform' | 'mixed' | 'weight'. Passing a literal
  // unknown mode straight to the engine is a TypeError -- distinct from the 'weight'-on-a-shape case.
  assert.throws(
    () => engine.generateShapeLayout({
      shape: 'rectangle', layerId: 's', xMm: 0, yMm: 0, widthMm: 40, heightMm: 20,
      stoneSizeMm: 2.0, gapMm: 0.3, mode: 'outline', sizeMode: 'lopsided'
    }),
    /Unsupported sizeMode/,
    'an unknown sizeMode string must be a TypeError from the engine'
  );
});

// ---------------------------------------------------------------------------
// Test 6 -- default-off regression. Baselines captured on develop @ 87e20a5
// (tools/scratch/mono-015-baseline.mjs, run before branching).
// ---------------------------------------------------------------------------

const DEVELOP_BASELINES = [
  { file: 'script-name-great-vibes.rhs', stoneCount: 147, bboxWidthMm: 66.715091 },
  { file: 'short-name-block.rhs', stoneCount: 66, bboxWidthMm: 47.934049 },
  { file: 'long-name-autofit.rhs', stoneCount: 441, bboxWidthMm: 200.063239 }
];

await test('6. default-off regression: three examples/ text fixtures regenerate byte-identical to develop (counts + bbox widths printed for both sides)', async () => {
  for (const baseline of DEVELOP_BASELINES) {
    const raw = JSON.parse(await readFile(path.join(repoRoot, 'examples', baseline.file), 'utf8'));
    const project = validateRhsProject(raw, baseline.file);
    const layout = await generateProjectStoneLayout(project, engine);
    const bb = layout.getBoundingBox();
    const width = Number(bb.widthMm.toFixed(6));
    console.log(`    ${baseline.file}: develop ${baseline.stoneCount} stones / bbox ${baseline.bboxWidthMm} mm  ->  now ${layout.count} stones / bbox ${width} mm`);
    assert.equal(layout.count, baseline.stoneCount, `${baseline.file}: stone count drifted from develop`);
    assert.ok(Math.abs(width - baseline.bboxWidthMm) < 0.001, `${baseline.file}: bbox width drifted from develop`);
  }
});

// ---------------------------------------------------------------------------
// Extra: MonogramGenerator opt-in wiring (round-trip + default-off).
// ---------------------------------------------------------------------------

await test('7a. MonogramGenerator: #monogramWeightSizing off is unchanged; on persists flat fields and a live re-render reproduces the count', async () => {
  const generator = new MonogramGenerator({ geometryEngine: engine });
  const baseReq = {
    frameId: 'none', layoutId: 'single', letters: ['A'],
    fontId: 'great-vibes-regular', providerId: 'opentype', stemWidthRatio: 0.0357,
    stoneSizeMm: 2.0, gapMm: 0.3, color: 'gold',
    frameRect: { xMm: 30, yMm: 20, widthMm: 90, heightMm: 90 },
    canvasMm: { widthMm: 150, heightMm: 130 }, frameOptions: {}
  };

  const off = await generator.generate(baseReq);
  assert.ok(off.ok, `uniform monogram failed: ${off.message}`);
  const offLayer = off.layers.find((l) => l.type === 'text');
  assert.equal(offLayer.sizeMode, undefined, 'uniform monogram must not persist sizeMode');

  const on = await generator.generate({ ...baseReq, weightSizing: true, weightMinSizeMm: 2.0, weightMaxSizeMm: defaultWeightMaxSizeMm(2.0) });
  assert.ok(on.ok, `weight monogram failed: ${on.message}`);
  const onLayer = on.layers.find((l) => l.type === 'text');
  assert.equal(onLayer.sizeMode, 'weight');
  assert.equal(onLayer.weightMinSizeMm, 2.0);
  assert.equal(onLayer.weightMaxSizeMm, 4.0);

  const rerender = await engine.generateTextLayout({
    text: onLayer.text, fontId: onLayer.font, providerId: 'opentype', layerId: onLayer.id,
    heightMm: onLayer.height, stoneSizeMm: onLayer.stoneSize, gapMm: onLayer.gap, mode: 'outline',
    sizeMode: 'weight', weightMinSizeMm: onLayer.weightMinSizeMm, weightMaxSizeMm: onLayer.weightMaxSizeMm
  });
  const distinct = [...new Set(rerender.stones.map((s) => s.sizeMm))].sort((a, b) => a - b);
  console.log(`    monogram "A": uniform ${off.measurements.letters[0].stoneCount} stones -> weight ${on.measurements.letters[0].stoneCount} stones; live re-render ${rerender.count}, sizes ${JSON.stringify(distinct)}`);
  assert.equal(rerender.count, on.measurements.letters[0].stoneCount, 'live re-render does not reproduce the generator stone count');
  assert.ok(distinct.length >= 2, 'expected the re-rendered weight monogram to carry >= 2 distinct sizes');
});

await test('7b. MonogramGenerator: MONO-013 script golden numbers are unchanged with weight sizing off (372 stones / 136.501458 mm)', async () => {
  const generator = new MonogramGenerator({ geometryEngine: engine });
  const res = await generator.generate({
    frameId: 'none', layoutId: 'script', letters: ['A', 'K', 'L'],
    fontId: 'great-vibes-regular', providerId: 'opentype', stemWidthRatio: 0.0357,
    stoneSizeMm: 2.0, gapMm: 0.3, color: 'gold', canvasMm: { widthMm: 200, heightMm: 200 },
    frameRect: { xMm: 0, yMm: 0, widthMm: 150, heightMm: 150 }, interlockMm: 0
  });
  assert.ok(res.ok, `script monogram failed: ${res.message}`);
  console.log(`    "AKL" script, interlock 0: ${res.measurements.letterStoneCount} stones, bbox ${res.measurements.letters[0].scaledBoundingBox.widthMm.toFixed(6)} mm`);
  assert.equal(res.measurements.letterStoneCount, 372, 'MONO-013 golden stone count changed');
  assert.ok(Math.abs(res.measurements.letters[0].scaledBoundingBox.widthMm - 136.50145836140092) < 1e-6, 'MONO-013 golden bbox width changed');
});

if (process.exitCode === 1) {
  console.error('MONO-015 weight-sizing suite FAILED.');
} else {
  console.log('MONO-015 weight-sizing suite passed.');
}
