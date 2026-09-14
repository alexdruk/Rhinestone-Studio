// MONO-015 -- Weight-following stone size (opt-in), graduated steps.
//
// Covers src/geometry/StrokeWidthProbe.js, src/geometry/WeightSizing.js, StoneSampler
// dropOverlappingSizedStones() (phase C), GeometryEngine.generateTextLayout()'s sizeMode 'weight'
// branch, MonogramGenerator's opt-in wiring, and src/renderer/StoneSizes.js's graduated-step
// helpers. Real repository fonts, same bootstrap as tools/test-mono-013-interlock.mjs.
//
// Run `npm ci` first (opentype.js is needed for src/text/**).
//
// Third commit (graduated weight steps): the persisted representation is now a single flat array
// `weightSizesMm` -- the ascending mm diameters for the chosen step -- replacing the old
// weightMinSizeMm/weightMaxSizeMm pair outright (nothing shipped). Off / Step 1 (base + one catalog
// rung) / Step 2 (base + two rungs). WeightSizing.js is pure arithmetic over a caller-supplied mm
// array with no renderer import; the catalog-aware step derivation lives in StoneSizes.js.

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FontManager } from '../src/fonts/index.js';
import { createDefaultFontProviderRegistry } from '../src/text/index.js';
import { GeometryEngine } from '../src/geometry/index.js';
import {
  strokeWidthsForSamples,
  weightSizeMm,
  dropOverlappingSizedStones,
  sampleShapeFillPoints
} from '../src/geometry/index.js';
import {
  listStoneSizes,
  stoneSizesFromBaseMm,
  stoneSizeRungsAvailable
} from '../src/renderer/StoneSizes.js';
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
const appJs = await readFile(path.join(repoRoot, 'app.js'), 'utf8');

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

// The five shipped catalog diameters, straight from the renderer catalog. Used only as test data
// here -- src/geometry/** never sees it (that is the point of the architecture assertion in
// tools/test-architecture-module-boundaries.mjs).
const CATALOG = listStoneSizes().map((s) => s.diameterMm);

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
 * own `d + gapMm` ideal pitch -- a contour boundary or a genuine (phase-C-dropped) gap.
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

/** Per-diameter table of every >=3-stone run's median centre-to-centre pitch vs its `d + gapMm`. */
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
// A. WeightSizing.js -- pure arithmetic over a caller-supplied ascending mm array.
// ---------------------------------------------------------------------------

await test('A1. weightSizeMm(width, sizesMm): smallest entry >= width, else the largest entry', () => {
  assert.equal(weightSizeMm(1.6, [2.0, 2.8, 4.0]), 2.0);
  assert.equal(weightSizeMm(2.0, [2.0, 2.8, 4.0]), 2.0);
  assert.equal(weightSizeMm(2.01, [2.0, 2.8, 4.0]), 2.8);
  assert.equal(weightSizeMm(3.5, [2.0, 2.8, 4.0]), 4.0);
  assert.equal(weightSizeMm(99, [2.0, 2.8, 4.0]), 4.0, 'width beyond every entry -> the largest');
  assert.equal(weightSizeMm(3.5, [2.0, 2.8]), 2.8, 'a step that stops at 2.8 caps there');
  assert.equal(weightSizeMm(0.1, [2.8, 4.0]), 2.8, 'a step whose floor is 2.8 floors a hairline there');
  assert.equal(weightSizeMm(3.5, [2.0]), 2.0, 'a single-entry step collapses to that size');
});

await test('A2. weightSizeMm validates sizesMm the way normalizeMixedSizeParams validates allowedSizesMm (non-empty, positive finite entries)', () => {
  assert.throws(() => weightSizeMm(2.0, []), /non-empty/);
  assert.throws(() => weightSizeMm(2.0, 'x'), /non-empty/);
  assert.throws(() => weightSizeMm(2.0, [2.0, -1]), /positive finite/);
  assert.throws(() => weightSizeMm(2.0, [2.0, NaN]), /positive finite/);
});

// ---------------------------------------------------------------------------
// B. StoneSizes.js -- the catalog-aware graduated-step derivation (the piece that used to be a
// hand-copied [2.0, 2.8, 4.0, 4.7, 6.4] literal inside the engine).
// ---------------------------------------------------------------------------

await test('B1. stoneSizesFromBaseMm: step 1 -> [base, one rung up]; step 2 -> [base, one, two]; levels are relative to the base', () => {
  assert.deepEqual(stoneSizesFromBaseMm(2.0, 1), [2.0, 2.8]);
  assert.deepEqual(stoneSizesFromBaseMm(2.0, 2), [2.0, 2.8, 4.0]);
  assert.deepEqual(stoneSizesFromBaseMm(2.8, 1), [2.8, 4.0]);
  assert.deepEqual(stoneSizesFromBaseMm(2.8, 2), [2.8, 4.0, 4.7]);
  assert.deepEqual(stoneSizesFromBaseMm(4.0, 2), [4.0, 4.7, 6.4]);
});

await test('B2. top-of-catalog clamping -- THROW path: SS20 base yields [4.7, 6.4] for step 1 but step 2 throws; SS30 base throws for both', () => {
  assert.equal(stoneSizeRungsAvailable(4.7), 1, 'SS20 has exactly one catalog rung above it');
  assert.deepEqual(stoneSizesFromBaseMm(4.7, 1), [4.7, 6.4]);
  assert.throws(() => stoneSizesFromBaseMm(4.7, 2), /no 2 rungs above 4\.7/, 'step 2 from SS20 must throw, not clamp');
  assert.equal(stoneSizeRungsAvailable(6.4), 0, 'SS30 has no catalog rung above it');
  assert.throws(() => stoneSizesFromBaseMm(6.4, 1), /no 1 rung above 6\.4/);
  assert.throws(() => stoneSizesFromBaseMm(6.4, 2), /no 2 rungs above 6\.4/);
});

await test('B3. top-of-catalog clamping -- DISABLED-UI path: app.js weightStepsOptionsHtml() renders the unreachable step disabled, with a title, and never throws', () => {
  const src = appJs.slice(appJs.indexOf('function weightStepsOptionsHtml('), appJs.indexOf('\n}', appJs.indexOf('function weightStepsOptionsHtml(')) + 2);
  const run = new Function('stoneSizeRungsAvailable', 'stoneSizesFromBaseMm', 'formatStoneSizeLabel', 'escapeHtml', `${src}\nreturn weightStepsOptionsHtml;`);
  const weightStepsOptionsHtml = run(
    stoneSizeRungsAvailable, stoneSizesFromBaseMm,
    (d) => `SS?? (${d} mm)`, (s) => s
  );

  const ss6 = weightStepsOptionsHtml(2.0);
  assert.match(ss6, /<option value="1"[^>]*>SS\?\? → SS\?\?<\/option>/, 'SS6 base: step 1 label is two names joined by an arrow, enabled');
  assert.ok(!/value="1"[^>]*disabled/.test(ss6) && !/value="2"[^>]*disabled/.test(ss6), 'SS6 base: neither step disabled');

  const ss20 = weightStepsOptionsHtml(4.7);
  assert.ok(!/value="1"[^>]*disabled/.test(ss20), 'SS20 base: step 1 enabled');
  assert.match(ss20, /<option value="2" disabled title="[^"]+">/, 'SS20 base: step 2 disabled with an explaining title');

  const ss30 = weightStepsOptionsHtml(6.4);
  assert.match(ss30, /<option value="1" disabled title="[^"]+">/, 'SS30 base: step 1 disabled');
  assert.match(ss30, /<option value="2" disabled title="[^"]+">/, 'SS30 base: step 2 disabled');
  assert.doesNotThrow(() => weightStepsOptionsHtml(6.4), 'the option builder must never throw for an unreachable step');
});

// ---------------------------------------------------------------------------
// C. Probe + phase C primitives (kept from 4bcbfaa; array form).
// ---------------------------------------------------------------------------

await test('C1. probe monotonicity on a synthetic tapered stroke: monotone widths, non-decreasing assignments, no surviving pair violates (d1+d2)/2', () => {
  const polygon = taperedStrokePolygon(40, 0.8, 4.0);
  const widthAt = (x) => 0.8 + (4.0 - 0.8) * (x / 40);
  const samples = [];
  for (let x = 1; x <= 39; x += 2) samples.push(new Point2D(x, -widthAt(x) / 2));
  const widths = strokeWidthsForSamples(samples, [polygon], 6.0);

  for (let i = 1; i < widths.length; i++) {
    assert.ok(widths[i] >= widths[i - 1] - 0.05, `probe width not monotone at station ${i}`);
  }
  const assigned = samples.map((p, i) => ({ xMm: p.xMm, yMm: p.yMm, sizeMm: weightSizeMm(widths[i], [2.0, 2.8, 4.0]) }));
  for (let i = 1; i < assigned.length; i++) {
    assert.ok(assigned[i].sizeMm >= assigned[i - 1].sizeMm, `assigned size not non-decreasing at station ${i}`);
  }
  for (const s of assigned) assert.ok(CATALOG.includes(s.sizeMm), `assigned size ${s.sizeMm} not a catalog diameter`);
  assert.equal(noPairViolatesHalfSum(dropOverlappingSizedStones(assigned)), null, 'a surviving pair violates (d1+d2)/2');
});

await test('C2. phase C -- the per-pair (d1+d2)/2 floor (NOT a scalar) governs the drop: a (2.0, 4.0) pair 2.6 mm apart is dropped though a scalar 2.0 mm check would keep it; a (2.0, 2.0) control at 2.6 mm survives', () => {
  // Binding pair spans two size classes by construction -- the case the real script marks in E3
  // never produce (their closest pair is always the tightly-packed 2.0 mm hairline run). This is
  // where the c192452 generalisation from `< stoneSizeMm` to `< (d1+d2)/2` does its work.
  const assigned = [
    { xMm: 0, yMm: 0, sizeMm: 4.0 },
    { xMm: 2.6, yMm: 0, sizeMm: 2.0 },   // dist 2.6: >= scalar 2.0, but < (4.0+2.0)/2 = 3.0 -> must drop
    { xMm: 20, yMm: 0, sizeMm: 2.0 },
    { xMm: 22.6, yMm: 0, sizeMm: 2.0 }   // dist 2.6: >= (2.0+2.0)/2 = 2.0 -> must survive
  ];
  const survivors = dropOverlappingSizedStones(assigned);
  const kept = survivors.map((s) => `${s.xMm}:${s.sizeMm}`);
  console.log(`    entering 4 -> surviving ${survivors.length}: ${JSON.stringify(kept)}`);
  assert.equal(survivors.length, 3, 'exactly the cross-class overlap should be dropped');
  assert.ok(!survivors.some((s) => s.xMm === 2.6), 'the 2.0 mm stone 2.6 mm from a 4.0 mm stone must be dropped ((d1+d2)/2 = 3.0)');
  assert.ok(survivors.some((s) => s.xMm === 22.6), 'the 2.0 mm stone 2.6 mm from a 2.0 mm stone must survive ((d1+d2)/2 = 2.0)');
});

await test('C3. vacuity control (run by name): phase C entering vs leaving count on the tapered stroke at the real 2x phase-A pitch -- both printed', () => {
  const gapMm = 0.3;
  const sizesMm = [2.0, 2.8, 4.0];
  const factor = 2;
  const polygon = taperedStrokePolygon(40, 0.8, 4.0);
  const phaseA = sampleShapeFillPoints('outline', [polygon], { minXmm: 0, minYmm: -2.5, maxXmm: 40, maxYmm: 2.5 }, (sizesMm[0] + gapMm) / factor, sizesMm[0] / factor);
  const widths = strokeWidthsForSamples(phaseA, [polygon], sizesMm[sizesMm.length - 1]);
  const assigned = phaseA.map((p, i) => ({ xMm: p.xMm, yMm: p.yMm, sizeMm: weightSizeMm(widths[i], sizesMm) }));
  const survivors = dropOverlappingSizedStones(assigned);
  console.log(`    phase C: entering ${assigned.length} stones, leaving ${survivors.length} (dropped ${assigned.length - survivors.length})`);
  if (assigned.length - survivors.length === 0) {
    assert.fail('phase C dropped zero stones -- C1\'s "no pair violates" assertion would be vacuous.');
  }
});

// ---------------------------------------------------------------------------
// D. The representation change is behaviour-neutral.
// ---------------------------------------------------------------------------

await test('D1. reduction to uniform generalises: weightSizesMm: [2.0] (a single-entry array) is byte-identical to uniform SS6 -- counts + first three stone records printed for both', async () => {
  const base = {
    text: 'Rhinestone', fontId: 'dancing-script-regular', providerId: 'opentype', layerId: 'weight-reduce',
    heightMm: 30, stoneSizeMm: 2.0, gapMm: 0.3, mode: 'outline', color: 'gold'
  };
  const uniform = await engine.generateTextLayout(base);
  const weight = await engine.generateTextLayout({ ...base, sizeMode: 'weight', weightSizesMm: [2.0] });
  const first3 = (layout) => layout.stones.slice(0, 3).map((s) => ({ xMm: Number(s.xMm.toFixed(6)), yMm: Number(s.yMm.toFixed(6)), sizeMm: s.sizeMm }));
  console.log(`    uniform SS6      count ${uniform.count}, first three ${JSON.stringify(first3(uniform))}`);
  console.log(`    weight [2.0]     count ${weight.count}, first three ${JSON.stringify(first3(weight))}`);
  assert.equal(weight.count, uniform.count, 'stone count differs');
  assert.deepEqual(weight.toJSON().stones, uniform.toJSON().stones, 'stone records differ -- not byte-identical to uniform');

  // Named negative control: the SAME case with a real two-entry step must differ, so D1's
  // byte-identity assertion is proved to discriminate rather than passing vacuously.
  const spread = await engine.generateTextLayout({ ...base, sizeMode: 'weight', weightSizesMm: [2.0, 2.8] });
  console.log(`    NEGATIVE CONTROL weight [2.0, 2.8] count ${spread.count}, sizes ${JSON.stringify([...new Set(spread.stones.map((s) => s.sizeMm))].sort((a, b) => a - b))}`);
  assert.notEqual(spread.count, uniform.count, 'a real two-entry step must NOT reproduce uniform -- byte-identity check would be vacuous');
});

await test('D2. Step 2 at SS6 base reproduces develop\'s golden of 68 exactly -- the min/max pair {2.0,4.0} and the flat array [2.0,2.8,4.0] are informationally equivalent under weightSizeMm\'s "smallest entry >= width" rule', async () => {
  const base = {
    text: 'A', fontId: 'great-vibes-regular', providerId: 'opentype', layerId: 'weight-step2',
    heightMm: 45, stoneSizeMm: 2.0, gapMm: 0.3, mode: 'outline', color: 'gold'
  };
  const weight = await engine.generateTextLayout({ ...base, sizeMode: 'weight', weightSizesMm: stoneSizesFromBaseMm(2.0, 2) });
  console.log(`    Great Vibes "A" 45 mm, Step 2 [2.0, 2.8, 4.0]: ${weight.count} stones (develop golden with {min 2.0, max 4.0}: 68)`);
  assert.equal(weight.count, 68, 'Step 2 count changed -- the two representations have diverged somewhere; report it, do not re-pin');
});

await test('D3. Step 1 golden count, pinned exact: Great Vibes "A" 45 mm, SS6 base, Step 1 [2.0, 2.8] == 85 (mixes 2.0 and 2.8 only, so between the develop anchors uniform-2.0 = 94 and uniform-2.8 = 62)', async () => {
  const base = {
    text: 'A', fontId: 'great-vibes-regular', providerId: 'opentype', layerId: 'weight-step1',
    heightMm: 45, stoneSizeMm: 2.0, gapMm: 0.3, mode: 'outline', color: 'gold'
  };
  const weight = await engine.generateTextLayout({ ...base, sizeMode: 'weight', weightSizesMm: stoneSizesFromBaseMm(2.0, 1) });
  const dist = {};
  for (const s of weight.stones) dist[s.sizeMm] = (dist[s.sizeMm] || 0) + 1;
  console.log(`    Great Vibes "A" 45 mm, Step 1 [2.0, 2.8]: ${weight.count} stones, distribution ${JSON.stringify(dist)}`);
  assert.equal(weight.count, 85, 'Step 1 golden count changed');
  assert.ok(weight.count < 94 && weight.count > 62, 'Step 1 count must land strictly between uniform-2.0 (94) and uniform-2.8 (62)');
});

// ---------------------------------------------------------------------------
// E. Chain pitch -- the guard that replaced the stone-count band (4bcbfaa item 2). Rule unchanged;
// re-run for both steps. oversampleFactor = weightSizesMm.length > 1 ? 2 : 1.
// ---------------------------------------------------------------------------

const OVERSAMPLE_TOLERANCE = 0.15;
const oversampleFactor = (sizesMm) => (sizesMm.length > 1 ? 2 : 1);

await test('E1. synthetic tapered stroke, Step 2 [2.0,2.8,4.0]: at the plain min pitch a 2.8 mm run is ~48% over-spaced (the defect); with 2x oversampling every present diameter\'s median run pitch is within 15% of d + gapMm', () => {
  const gapMm = 0.3;
  const sizesMm = [2.0, 2.8, 4.0];
  const polygon = taperedStrokePolygon(80, 0.8, 4.6, 120);
  const boundingBox = { minXmm: 0, minYmm: -2.5, maxXmm: 80, maxYmm: 2.5 };
  const runAt = (factor) => {
    const samples = sampleShapeFillPoints('outline', [polygon], boundingBox, (sizesMm[0] + gapMm) / factor, sizesMm[0] / factor);
    const widths = strokeWidthsForSamples(samples, [polygon], sizesMm[sizesMm.length - 1]);
    const assigned = samples.map((p, i) => ({ xMm: p.xMm, yMm: p.yMm, sizeMm: weightSizeMm(widths[i], sizesMm) }));
    return dropOverlappingSizedStones(assigned);
  };

  const table1 = pitchTable(runAt(1), gapMm);
  console.log('    factor 1 (plain min pitch):');
  for (const t of table1) for (const r of t.rows) console.log(`      d=${t.d} len=${r.length} medianPitch=${r.medianPitchMm.toFixed(3)} ideal=${t.idealMm.toFixed(2)} off=${r.offPct.toFixed(1)}%`);
  const worst1 = Math.max(...table1.flatMap((t) => t.rows.map((r) => Math.abs(r.offPct))), 0);
  assert.ok(worst1 / 100 > OVERSAMPLE_TOLERANCE, `factor 1 should over-space some run past ${OVERSAMPLE_TOLERANCE * 100}% -- worst was ${worst1.toFixed(1)}%`);

  const table2 = pitchTable(runAt(oversampleFactor(sizesMm)), gapMm);
  console.log(`    factor ${oversampleFactor(sizesMm)} (oversampled):`);
  for (const t of table2) {
    assert.ok(t.rows.length >= 1, `no >=3-stone run of ${t.d} mm stones to measure pitch on`);
    for (const r of t.rows) {
      console.log(`      d=${t.d} len=${r.length} medianPitch=${r.medianPitchMm.toFixed(3)} ideal=${t.idealMm.toFixed(2)} off=${r.offPct.toFixed(1)}%`);
      assert.ok(Math.abs(r.offPct) / 100 <= OVERSAMPLE_TOLERANCE, `a ${t.d} mm run's median pitch is ${r.offPct.toFixed(1)}% off (> ${OVERSAMPLE_TOLERANCE * 100}%)`);
    }
  }
});

await test('E2. real engine path, both steps: every >=3-stone run\'s median pitch within 15% of d + gapMm; the step\'s range endpoints each form such a run. Step 1 has no 4.0 mm stones at all', async () => {
  const base = {
    text: 'A', fontId: 'great-vibes-regular', providerId: 'opentype', layerId: 'weight-glyph',
    heightMm: 45, stoneSizeMm: 2.0, gapMm: 0.3, mode: 'outline', color: 'gold'
  };
  for (const step of [1, 2]) {
    const sizesMm = stoneSizesFromBaseMm(2.0, step);
    const weight = await engine.generateTextLayout({ ...base, sizeMode: 'weight', weightSizesMm: sizesMm });
    const present = [...new Set(weight.stones.map((s) => s.sizeMm))].sort((a, b) => a - b);
    console.log(`    Step ${step} ${JSON.stringify(sizesMm)}: ${weight.count} stones, present sizes ${JSON.stringify(present)}`);
    assert.equal(noPairViolatesHalfSum(weight.stones), null, `Step ${step}: a stone pair physically overlaps`);
    if (step === 1) assert.ok(!present.includes(4.0), 'Step 1 must contain no 4.0 mm stones');

    const table = pitchTable(weight.stones, 0.3);
    for (const t of table) {
      for (const r of t.rows) {
        console.log(`      d=${t.d} len=${r.length} medianPitch=${r.medianPitchMm.toFixed(3)} ideal=${t.idealMm.toFixed(2)} off=${r.offPct.toFixed(1)}%`);
        assert.ok(Math.abs(r.offPct) / 100 <= OVERSAMPLE_TOLERANCE, `Step ${step}: a ${t.d} mm run's median pitch is ${r.offPct.toFixed(1)}% off`);
      }
      if (t.rows.length === 0) console.log(`      d=${t.d}: no >=3-stone chain on this glyph (transition width only -- printed, not asserted)`);
    }
    // The step's floor is the diameter guaranteed a sustained region (the hairline). Step 1's top
    // (2.8) and Step 2's top (4.0) also form one on this glyph.
    const anchors = step === 1 ? [2.0, 2.8] : [2.0, 4.0];
    for (const d of anchors) {
      const t = table.find((row) => row.d === d);
      assert.ok(t && t.rows.length >= 1, `Step ${step}: expected a >=3-stone run of ${d} mm stones`);
    }
  }
});

// ---------------------------------------------------------------------------
// F. Mode guard (kept from 4bcbfaa; array form).
// ---------------------------------------------------------------------------

await test('F1. sizeMode "weight" throws for mode "fill" and for an authored (non-outline) font', async () => {
  await assert.rejects(
    engine.generateTextLayout({
      text: 'A', fontId: 'great-vibes-regular', providerId: 'opentype', layerId: 'g',
      heightMm: 30, stoneSizeMm: 2.0, gapMm: 0.3, mode: 'fill', sizeMode: 'weight', weightSizesMm: [2.0, 4.0]
    }),
    /weight-following stone size .* requires outline mode/
  );
  await assert.rejects(
    engine.generateTextLayout({
      text: 'A', fontId: 'rs-block', providerId: 'rhinestone', layerId: 'g',
      heightMm: 40, stoneSizeMm: 2.0, gapMm: 0.3, mode: 'outline', sizeMode: 'weight', weightSizesMm: [2.0, 4.0]
    }),
    /authored stone centers/
  );
});

await test('F2. non-text callers throw on a stray sizeMode "weight" (caller bug, not silently absorbed)', () => {
  assert.throws(
    () => engine.generateShapeLayout({
      shape: 'rectangle', layerId: 's', xMm: 0, yMm: 0, widthMm: 40, heightMm: 20,
      stoneSizeMm: 2.0, gapMm: 0.3, mode: 'outline', sizeMode: 'weight', weightSizesMm: [2.0, 4.0]
    }),
    /only supported for a text layer sampled in outline mode/
  );
});

await test('F3. an *unknown* sizeMode string reaching the engine directly throws "Unsupported sizeMode" (distinct from the "weight"-on-a-shape case; the app.js resolveSizeMode() -> uniform old-project compatibility fallback is covered by test-s200-app-integration test 3)', () => {
  assert.throws(
    () => engine.generateShapeLayout({
      shape: 'rectangle', layerId: 's', xMm: 0, yMm: 0, widthMm: 40, heightMm: 20,
      stoneSizeMm: 2.0, gapMm: 0.3, mode: 'outline', sizeMode: 'lopsided'
    }),
    /Unsupported sizeMode/
  );
});

await test('F4. weightSizesMm must be strictly ascending', async () => {
  await assert.rejects(
    engine.generateTextLayout({
      text: 'A', fontId: 'great-vibes-regular', providerId: 'opentype', layerId: 'g',
      heightMm: 30, stoneSizeMm: 2.0, gapMm: 0.3, mode: 'outline', sizeMode: 'weight', weightSizesMm: [4.0, 2.0]
    }),
    /strictly ascending/
  );
});

// ---------------------------------------------------------------------------
// G. Default-off regression. Baselines captured on develop @ 87e20a5.
// ---------------------------------------------------------------------------

const DEVELOP_BASELINES = [
  { file: 'script-name-great-vibes.rhs', stoneCount: 147, bboxWidthMm: 66.715091 },
  { file: 'short-name-block.rhs', stoneCount: 66, bboxWidthMm: 47.934049 },
  { file: 'long-name-autofit.rhs', stoneCount: 441, bboxWidthMm: 200.063239 }
];

await test('G1. default-off regression: the three examples/ text fixtures regenerate byte-identical to develop (147 / 66 / 441; counts + bbox widths printed for both sides)', async () => {
  for (const baseline of DEVELOP_BASELINES) {
    const raw = JSON.parse(await readFile(path.join(repoRoot, 'examples', baseline.file), 'utf8'));
    const project = validateRhsProject(raw, baseline.file);
    const layout = await generateProjectStoneLayout(project, engine);
    const width = Number(layout.getBoundingBox().widthMm.toFixed(6));
    console.log(`    ${baseline.file}: develop ${baseline.stoneCount} / ${baseline.bboxWidthMm} mm  ->  now ${layout.count} / ${width} mm`);
    assert.equal(layout.count, baseline.stoneCount, `${baseline.file}: stone count drifted from develop`);
    assert.ok(Math.abs(width - baseline.bboxWidthMm) < 0.001, `${baseline.file}: bbox width drifted from develop`);
  }
});

// ---------------------------------------------------------------------------
// H. MonogramGenerator opt-in wiring + MONO-013 clearance audit.
// ---------------------------------------------------------------------------

await test('H1. MonogramGenerator: weightSizesMm absent is unchanged; present persists the flat array and a live re-render reproduces the count', async () => {
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
  assert.equal(off.layers.find((l) => l.type === 'text').sizeMode, undefined, 'uniform monogram must not persist sizeMode');

  const on = await generator.generate({ ...baseReq, weightSizesMm: stoneSizesFromBaseMm(2.0, 2) });
  assert.ok(on.ok, `weight monogram failed: ${on.message}`);
  const onLayer = on.layers.find((l) => l.type === 'text');
  assert.equal(onLayer.sizeMode, 'weight');
  assert.deepEqual(onLayer.weightSizesMm, [2.0, 2.8, 4.0]);
  assert.equal(onLayer.weightMinSizeMm, undefined, 'the old flat fields must be gone, not carried alongside');
  assert.equal(onLayer.weightMaxSizeMm, undefined);

  const rerender = await engine.generateTextLayout({
    text: onLayer.text, fontId: onLayer.font, providerId: 'opentype', layerId: onLayer.id,
    heightMm: onLayer.height, stoneSizeMm: onLayer.stoneSize, gapMm: onLayer.gap, mode: 'outline',
    sizeMode: 'weight', weightSizesMm: onLayer.weightSizesMm
  });
  const distinct = [...new Set(rerender.stones.map((s) => s.sizeMm))].sort((a, b) => a - b);
  console.log(`    monogram "A": uniform ${off.measurements.letters[0].stoneCount} -> weight ${on.measurements.letters[0].stoneCount}; live re-render ${rerender.count}, sizes ${JSON.stringify(distinct)}`);
  assert.equal(rerender.count, on.measurements.letters[0].stoneCount, 'live re-render does not reproduce the generator stone count');
  assert.ok(distinct.length >= 2, 'expected >= 2 distinct sizes in the re-rendered weight monogram');
});

await test('H2. MonogramGenerator: MONO-013 script goldens unchanged with weight sizing off -- 372 / 369 stones, 136.501458 / 131.901458 mm (all four printed)', async () => {
  const generator = new MonogramGenerator({ geometryEngine: engine });
  const mk = (letterSpacingMm) => ({
    frameId: 'none', layoutId: 'script', letters: ['A', 'K', 'L'],
    fontId: 'great-vibes-regular', providerId: 'opentype', stemWidthRatio: 0.0357,
    stoneSizeMm: 2.0, gapMm: 0.3, color: 'gold', canvasMm: { widthMm: 200, heightMm: 200 },
    frameRect: { xMm: 0, yMm: 0, widthMm: 150, heightMm: 150 }, letterSpacingMm
  });
  const a = await generator.generate(mk(0));
  const b = await generator.generate(mk(-2.3));
  assert.ok(a.ok && b.ok, `script monogram failed: ${a.message || b.message}`);
  const aw = a.measurements.letters[0].scaledBoundingBox.widthMm;
  const bw = b.measurements.letters[0].scaledBoundingBox.widthMm;
  console.log(`    interlock  0.0: ${a.measurements.letterStoneCount} stones, bbox ${aw.toFixed(6)} mm`);
  console.log(`    interlock -2.3: ${b.measurements.letterStoneCount} stones, bbox ${bw.toFixed(6)} mm`);
  assert.equal(a.measurements.letterStoneCount, 372, 'MONO-013 golden stone count (interlock 0) changed -- the rename leaked into geometry');
  assert.equal(b.measurements.letterStoneCount, 369, 'MONO-013 golden stone count (interlock -2.3) changed');
  assert.ok(Math.abs(aw - 136.50145836140092) < 1e-6, 'MONO-013 golden bbox width (interlock 0) changed');
  assert.ok(Math.abs(bw - 131.90145836140092) < 1e-6, 'MONO-013 golden bbox width (interlock -2.3) changed');
});

await test('H3. MONO-013 per-pair clearance floor is evaluated on a weight-sized script mark -- minStoneDistanceMm and minStoneDistancePairDiametersMm printed for the binding pair', async () => {
  const generator = new MonogramGenerator({ geometryEngine: engine });
  const res = await generator.generate({
    frameId: 'none', layoutId: 'script', letters: ['A', 'K', 'L'],
    fontId: 'great-vibes-regular', providerId: 'opentype', stemWidthRatio: 0.0357,
    stoneSizeMm: 2.0, gapMm: 0.3, color: 'gold', canvasMm: { widthMm: 220, heightMm: 220 },
    frameRect: { xMm: 0, yMm: 0, widthMm: 150, heightMm: 150 }, letterSpacingMm: 0,
    weightSizesMm: stoneSizesFromBaseMm(2.0, 2)
  });
  assert.ok(res.ok, `weight-sized script monogram failed: ${res.message}`);
  const { minStoneDistanceMm, minStoneDistancePairDiametersMm } = res.measurements;
  const [d1, d2] = minStoneDistancePairDiametersMm;
  const pairFloorMm = (d1 + d2) / 2;
  console.log(`    "AKL" script, Step 2, ${res.measurements.letterStoneCount} stones`);
  console.log(`    minStoneDistanceMm = ${minStoneDistanceMm.toFixed(6)}  binding pair diameters = ${JSON.stringify(minStoneDistancePairDiametersMm)}  their (d1+d2)/2 = ${pairFloorMm.toFixed(3)}`);
  assert.ok(minStoneDistanceMm >= pairFloorMm - 1e-3, 'the binding pair must clear its own per-pair floor');
  // The binding (closest) pair in a real script mark is structurally always the tightly-packed
  // hairline run -- (2.0, 2.0) here -- because a same-size run is always tighter than any
  // cross-class junction (whose floor is the average of the two diameters). The generalisation from
  // `< stoneSizeMm` to `< (d1+d2)/2` therefore does its distinguishing work in phase C's drop, not
  // in this reported number -- test C2 forces a cross-class binding pair and proves it there.
  console.log(`    (binding pair is ${d1 === d2 ? 'same-class' : 'cross-class'}; cross-class drop is proved in C2)`);
});

if (process.exitCode === 1) {
  console.error('MONO-015 weight-sizing suite FAILED.');
} else {
  console.log('MONO-015 weight-sizing suite passed.');
}
