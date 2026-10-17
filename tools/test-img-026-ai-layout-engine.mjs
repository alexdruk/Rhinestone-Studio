// IMG-026 build C1 -- the ai-layout engine branch and SS4. The N2_cat figures come from
// services/strass-layout/prototype/expected/N2_cat_final_rs.json, cropped here with the S1 rule;
// nothing about the cat is pasted in. See docs/specifications/IMG-026-StrassLayoutService.md,
// "Acceptance figures" (Build C1) and "Tests the builds must add" (C1).

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { GeometryEngine, StoneLayout } from '../src/geometry/index.js';
import {
  STONE_SIZES, STONE_SIZE_BY_ID, listStoneSizes, listAllStoneSizes, getStoneSize, isValidStoneSizeId,
  findStoneSizeByDiameterMm, formatStoneSizeLabel, validateStoneSizeCatalog, stoneSizeRungsAvailable
} from '../src/renderer/StoneSizes.js';
import { assertTestRegistered } from './lib/test-registration-assertions.mjs';

let failures = 0;
async function test(name, fn) {
  try {
    await fn();
    console.log(`✓ ${name}`);
  } catch (error) {
    failures++;
    console.error(`✗ ${name}`);
    console.error(error);
  }
}

const engineSource = await readFile(fileURLToPath(new URL('../src/geometry/GeometryEngine.js', import.meta.url)), 'utf8');
const cat = JSON.parse(await readFile(fileURLToPath(new URL('../services/strass-layout/prototype/expected/N2_cat_final_rs.json', import.meta.url)), 'utf8'));
const engine = new GeometryEngine();

// ---- S1 crop of the reference, computed here ----------------------------------------------------

const round3 = (v) => Math.round(v * 1000) / 1000;
function cropS1(stones) {
  let offX = Infinity, offY = Infinity;
  for (const s of stones) { offX = Math.min(offX, s.x - s.d / 2); offY = Math.min(offY, s.y - s.d / 2); }
  offX = round3(offX); offY = round3(offY);
  const cropped = stones.map((s) => [round3(s.x - offX), round3(s.y - offY), s.size, s.color]);
  let w = 0, h = 0;
  cropped.forEach(([x, y], i) => { w = Math.max(w, x + stones[i].d / 2); h = Math.max(h, y + stones[i].d / 2); });
  return { version: 1, widthMm: round3(w), heightMm: round3(h), stones: cropped, report: {}, editCount: 0 };
}
const CAT = cropS1(cat.stones);
const CAT_D = cat.stones.map((s) => s.d);

function layer(aiLayout, overrides = {}) {
  return { mode: 'ai-layout', layerId: 'L', xMm: 12.5, yMm: 7.25, widthMm: aiLayout.widthMm, rotationDeg: 0, aiLayout, colorSwaps: {}, ...overrides };
}

// Every pair's gap, the slow way, for checking the engine's grid.
function bruteGaps(stones) {
  let min = Infinity;
  const flagged = new Set();
  let pairs = 0;
  for (let i = 0; i < stones.length; i++) {
    const a = stones[i];
    for (let j = i + 1; j < stones.length; j++) {
      const b = stones[j];
      const g = Math.hypot(a.xMm - b.xMm, a.yMm - b.yMm) - (a.sizeMm + b.sizeMm) / 2;
      if (g < min) min = g;
      if (g < 0.1 - 1e-6) { flagged.add(i); flagged.add(j); pairs++; }
    }
  }
  return { min, flagged, pairs };
}
const flaggedIndexes = (layout) => new Set(layout.stones.flatMap((s, i) => (s.metadata.gapViolation ? [i] : [])));

// ---- S12 ----------------------------------------------------------------------------------------

await test('1. S12: SS4 is image-only -- STONE_SIZES, STONE_SIZE_BY_ID and listStoneSizes() keep the five sizes; listAllStoneSizes() has six, SS4 first; the lookups cover all six', () => {
  assert.deepEqual(STONE_SIZES.map((s) => s.id), ['ss6', 'ss10', 'ss16', 'ss20', 'ss30']);
  assert.deepEqual(listStoneSizes().map((s) => s.id), ['ss6', 'ss10', 'ss16', 'ss20', 'ss30']);
  assert.ok(!('ss4' in STONE_SIZE_BY_ID));
  const all = listAllStoneSizes();
  assert.deepEqual(all.map((s) => s.id), ['ss4', 'ss6', 'ss10', 'ss16', 'ss20', 'ss30']);
  assert.ok(all.every((s, i) => i === 0 || s.diameterMm > all[i - 1].diameterMm), 'ascending diameter');
  assert.deepEqual(all[0], { id: 'ss4', name: 'SS4', diameterMm: 1.5, supportedHeightRangeMm: null, imageOnly: true });
  all.push({ id: 'x' });
  assert.equal(listAllStoneSizes().length, 6, 'a defensive copy');
  for (const s of listAllStoneSizes()) {
    assert.equal(getStoneSize(s.id), s);
    assert.ok(isValidStoneSizeId(s.id));
    assert.equal(findStoneSizeByDiameterMm(s.diameterMm), s);
  }
  assert.equal(formatStoneSizeLabel(1.5), 'SS4 (1.5 mm)');
  assert.ok(!isValidStoneSizeId('ss5'));
  assert.equal(validateStoneSizeCatalog(listAllStoneSizes()), true);
  assert.equal(stoneSizeRungsAvailable(2.0), 4, 'MONO-015 rungs still count the five sizes');
  assert.ok(!existsSync(fileURLToPath(new URL('./font-generator/config/SS4.json', import.meta.url))), 'no font config for SS4');
});

await test('2. the engine\'s size ids and diameters equal StoneSizes.js for all six sizes', () => {
  for (const size of listAllStoneSizes()) {
    const out = engine.generateImageLayout(layer({ version: 1, widthMm: 10, heightMm: 10, stones: [[5, 5, size.id, 'jet']] }));
    assert.equal(out.stones[0].sizeMm, size.diameterMm, size.id);
  }
  const ids = /const AI_LAYOUT_SIZE_MM = Object\.freeze\(\{([^}]*)\}\)/.exec(engineSource);
  assert.ok(ids, 'the size table is present');
  assert.deepEqual(ids[1].split(',').map((p) => p.split(':')[0].trim()), listAllStoneSizes().map((s) => s.id));
  cat.stones.forEach((s, i) => assert.equal(getStoneSize(s.size).diameterMm, s.d, `reference stone ${i}`));
});

// ---- N2_cat at k = 1 ----------------------------------------------------------------------------

await test('3. N2_cat (S1 crop) at k = 1: every reference stone, 0 gapViolation flags, each at xMm + x, yMm + y within 1e-9 mm, in list order with aiIndex', () => {
  const p = layer(CAT);
  const out = engine.generateImageLayout(p);
  assert.ok(out instanceof StoneLayout);
  assert.equal(out.sourceMode, 'ai-layout');
  assert.equal(out.stones.length, cat.stones.length);
  assert.equal(flaggedIndexes(out).size, 0);
  out.stones.forEach((s, i) => {
    assert.ok(Math.abs(s.xMm - (p.xMm + CAT.stones[i][0])) <= 1e-9, `x ${i}`);
    assert.ok(Math.abs(s.yMm - (p.yMm + CAT.stones[i][1])) <= 1e-9, `y ${i}`);
    assert.equal(s.sizeMm, CAT_D[i]);
    assert.equal(s.color, cat.stones[i].color);
    assert.equal(s.layerId, 'L');
    assert.equal(s.metadata.aiIndex, i);
    assert.ok(!('gapViolation' in s.metadata));
  });
  const brute = bruteGaps(out.stones);
  assert.deepEqual(out.aiLayoutStats, { stones: cat.stones.length, violations: 0, minGapMm: out.aiLayoutStats.minGapMm, k: 1 });
  assert.ok(Math.abs(out.aiLayoutStats.minGapMm - brute.min) <= 1e-9, 'minGapMm equals the brute-force minimum');
  assert.equal(brute.pairs, 0);
});

await test('4. N2_cat minimum gap >= 0.100 mm at k = 1, 1.5 and 2, and under rotation 0, 30 and 90 degrees; k scales positions only', () => {
  const base = engine.generateImageLayout(layer(CAT));
  for (const k of [1, 1.5, 2]) {
    for (const rotationDeg of [0, 30, 90]) {
      const p = layer(CAT, { widthMm: CAT.widthMm * k, rotationDeg });
      const out = engine.generateImageLayout(p);
      assert.equal(out.aiLayoutStats.k, k);
      assert.equal(out.aiLayoutStats.violations, 0);
      assert.equal(flaggedIndexes(out).size, 0);
      const { min } = bruteGaps(out.stones);
      assert.ok(min >= 0.1, `k ${k}, ${rotationDeg} deg: min gap ${min}`);
      out.stones.forEach((s, i) => { assert.equal(s.sizeMm, base.stones[i].sizeMm); assert.equal(s.metadata.aiIndex, i); });
      if (rotationDeg === 0) {
        out.stones.forEach((s, i) => assert.ok(Math.abs(s.xMm - (p.xMm + k * CAT.stones[i][0])) <= 1e-9 && Math.abs(s.yMm - (p.yMm + k * CAT.stones[i][1])) <= 1e-9, `k ${k} stone ${i}`));
      } else {
        const cx = p.xMm + k * CAT.widthMm / 2, cy = p.yMm + k * CAT.heightMm / 2;
        out.stones.forEach((s, i) => {
          const x0 = p.xMm + k * CAT.stones[i][0] - cx, y0 = p.yMm + k * CAT.stones[i][1] - cy;
          const r = rotationDeg * Math.PI / 180;
          assert.ok(Math.abs(s.xMm - (cx + x0 * Math.cos(r) - y0 * Math.sin(r))) <= 1e-9 && Math.abs(s.yMm - (cy + x0 * Math.sin(r) + y0 * Math.cos(r))) <= 1e-9, `rotated stone ${i} about the box centre`);
        });
      }
    }
  }
});

await test('5. k < 1 is clamped to 1: a box narrower than the layout gives exactly the k = 1 stones', () => {
  const one = engine.generateImageLayout(layer(CAT));
  for (const w of [CAT.widthMm * 0.5, CAT.widthMm * 0.999, 1]) {
    const out = engine.generateImageLayout(layer(CAT, { widthMm: w }));
    assert.equal(out.aiLayoutStats.k, 1);
    assert.deepEqual(out.toJSON(), one.toJSON());
  }
});

// ---- gap flag -----------------------------------------------------------------------------------

function moveIntoGap(aiLayout, d, gapMm) {
  for (let i = 0; i < aiLayout.stones.length; i++) {
    const [xi, yi] = aiLayout.stones[i];
    let j = -1, best = Infinity;
    aiLayout.stones.forEach(([x, y], n) => {
      if (n === i) return;
      const g = Math.hypot(x - xi, y - yi) - (d[i] + d[n]) / 2;
      if (g < best) { best = g; j = n; }
    });
    const [xj, yj] = aiLayout.stones[j];
    const len = Math.hypot(xi - xj, yi - yj);
    const want = (d[i] + d[j]) / 2 + gapMm;
    const nx = xj + (xi - xj) / len * want, ny = yj + (yi - yj) / len * want;
    const others = aiLayout.stones.every(([x, y], n) => n === i || n === j || Math.hypot(x - nx, y - ny) - (d[i] + d[n]) / 2 >= 0.1);
    if (!others) continue;
    const stones = aiLayout.stones.map((t) => [...t]);
    stones[i][0] = nx; stones[i][1] = ny;
    return { moved: { ...aiLayout, stones }, i, j };
  }
  throw new Error('no stone could be moved next to only its nearest neighbour');
}

await test('6. moving one stone to 0.05 mm from a neighbour flags exactly those two stones, and the flags survive rotation', () => {
  const { moved, i, j } = moveIntoGap(CAT, CAT_D, 0.05);
  for (const rotationDeg of [0, 30]) {
    const out = engine.generateImageLayout(layer(moved, { rotationDeg }));
    assert.deepEqual([...flaggedIndexes(out)].sort((a, b) => a - b), [i, j].sort((a, b) => a - b));
    assert.equal(out.aiLayoutStats.violations, 1);
    assert.ok(Math.abs(out.aiLayoutStats.minGapMm - 0.05) <= 1e-9);
    assert.equal(out.stones[i].metadata.aiIndex, i);
  }
  const atTenth = moveIntoGap(CAT, CAT_D, 0.1).moved;
  assert.equal(flaggedIndexes(engine.generateImageLayout(layer(atTenth))).size, 0, 'a gap of exactly 0.1 mm is not a violation');
});

await test('7. the grid flags equal a brute-force check on a dense random layout with many violations', () => {
  let seed = 7;
  const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
  const ids = ['ss4', 'ss6', 'ss10', 'ss16', 'ss20', 'ss30'];
  const stones = Array.from({ length: 1500 }, () => [rnd() * 80 - 5, rnd() * 60 - 5, ids[Math.floor(rnd() * ids.length)], 'jet']);
  const out = engine.generateImageLayout(layer({ version: 1, widthMm: 80, heightMm: 60, stones }));
  const brute = bruteGaps(out.stones);
  assert.ok(brute.pairs > 100, 'the fixture has many violations');
  assert.deepEqual(flaggedIndexes(out), brute.flagged);
  assert.equal(out.aiLayoutStats.violations, brute.pairs);
  assert.ok(Math.abs(out.aiLayoutStats.minGapMm - brute.min) <= 1e-9);
  const fn = engineSource.slice(engineSource.indexOf('function flagAiLayoutGapViolations('));
  assert.ok(/const buckets = new Map\(\)/.test(fn.slice(0, fn.indexOf('\n}\n'))), 'the check uses a spatial grid');
});

// ---- colour swaps, determinism, parameters -------------------------------------------------------

await test('8. a colour swap changes exactly the stones of that colour, nothing else', () => {
  const counts = new Map();
  for (const t of CAT.stones) counts.set(t[3], (counts.get(t[3]) || 0) + 1);
  const from = [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
  const to = 'hyacinth' === from ? 'scarlet' : 'hyacinth';
  const plain = engine.generateImageLayout(layer(CAT));
  const swapped = engine.generateImageLayout(layer(CAT, { colorSwaps: { [from]: to } }));
  let changed = 0;
  swapped.stones.forEach((s, i) => {
    const before = plain.stones[i];
    assert.equal(s.xMm, before.xMm); assert.equal(s.yMm, before.yMm); assert.equal(s.sizeMm, before.sizeMm);
    if (before.color === from) { assert.equal(s.color, to); changed++; } else assert.equal(s.color, before.color);
  });
  assert.equal(changed, counts.get(from));
  assert.equal(engine.generateImageLayout(layer(CAT, { colorSwaps: { 'not-used-here': 'jet' } })).toJSON().stones.length, cat.stones.length);
});

await test('9. deterministic: the same layer gives the same stones in the same order; aiLayoutStats round-trips through StoneLayout JSON', () => {
  const a = engine.generateImageLayout(layer(CAT, { rotationDeg: 30, widthMm: CAT.widthMm * 1.5 }));
  const b = new GeometryEngine().generateImageLayout(layer(CAT, { rotationDeg: 30, widthMm: CAT.widthMm * 1.5 }));
  assert.deepEqual(a.toJSON(), b.toJSON());
  assert.deepEqual(a.toJSON().aiLayoutStats, a.aiLayoutStats);
  assert.deepEqual(StoneLayout.fromJSON(a.toJSON()).aiLayoutStats, a.aiLayoutStats);
  assert.ok(!('aiLayoutStats' in engine.generateShapeLayout({ shape: 'circle', layerId: 'c', cxMm: 10, cyMm: 10, radiusMm: 5, stoneSizeMm: 2, gapMm: 0.3 }).toJSON()), 'other layouts carry no aiLayoutStats');
});

await test('10. the branch runs before normalizeImageParams(): no imageBuffer, no field params; its own parameters are validated', () => {
  const ok = engine.generateImageLayout({ mode: 'ai-layout', layerId: 'L', widthMm: 5, aiLayout: { version: 1, widthMm: 5, heightMm: 5, stones: [] } });
  assert.equal(ok.stones.length, 0);
  assert.deepEqual(ok.aiLayoutStats, { stones: 0, violations: 0, minGapMm: null, k: 1 });
  const good = { version: 1, widthMm: 10, heightMm: 10, stones: [[1, 1, 'ss6', 'jet']] };
  const bad = [
    { layerId: '' },
    { widthMm: 0 },
    { widthMm: Infinity },
    { xMm: NaN },
    { rotationDeg: 'x' },
    { aiLayout: undefined },
    { aiLayout: [] },
    { aiLayout: { ...good, version: 2 } },
    { aiLayout: { ...good, widthMm: 0 } },
    { aiLayout: { ...good, heightMm: -1 } },
    { aiLayout: { ...good, stones: 'no' } },
    { aiLayout: { ...good, stones: [[1, 1, 'ss5', 'jet']] } },
    { aiLayout: { ...good, stones: [[1, '1', 'ss6', 'jet']] } },
    { aiLayout: { ...good, stones: [[1, 1, 'ss6', '']] } },
    { aiLayout: { ...good, stones: [[1, 1, 'ss6']] } },
    { colorSwaps: [] },
    { colorSwaps: { jet: 3 } }
  ];
  for (const override of bad) {
    assert.throws(() => engine.generateImageLayout(layer(good, override)), (e) => e instanceof TypeError || e instanceof RangeError, JSON.stringify(override));
  }
  assert.throws(() => engine.generateImageLayout({ mode: 'fill', layerId: 'L', widthMm: 5, heightMm: 5, stoneSizeMm: 2 }), /imageBuffer/, 'other modes still require an image');
  assert.ok(/const IMAGE_SAMPLE_MODES = new Set\(\[[^\]]*'ai-layout'\]\);/.test(engineSource));
  assert.ok(/generateImageLayout\(params = \{\}\) \{\n    if \(params && params\.mode === 'ai-layout'\) return this\._generateAiLayoutStones\(params\);\n    const options = normalizeImageParams\(params\);/.test(engineSource), 'the branch is the first step');
});

await test('Registered in tools/test-groups.mjs (core)', () => {
  assertTestRegistered({ filename: 'test-img-026-ai-layout-engine.mjs', group: 'core', includedInDefault: true });
});

if (failures) process.exitCode = 1;
