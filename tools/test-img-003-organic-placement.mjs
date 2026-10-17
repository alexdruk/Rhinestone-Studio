import assert from 'node:assert/strict';
import {
  createGeometryEngine,
  findCrossGroupCollisions,
  samplePoissonDiskPoints
} from '../src/geometry/index.js';
import { createImageBuffer } from '../src/image/index.js';
import {
  FIELD_ON_THRESHOLD,
  sampleFieldByMode,
  sampleOrganicFieldFillPoints
} from '../src/geometry/StoneSampler.js';
import { generateMixedSizeInfillPoints } from '../src/geometry/MixedSizeGenerator.js';
import fs from 'node:fs';

// IMG-003 -- unit tests for the Bridson Poisson-disk 'organic' image fill mode
// (src/geometry/OrganicSampler.js, StoneSampler.js's sampleOrganicFieldFillPoints()/
// sampleFieldByMode() dispatch, GeometryEngine.generateImageLayout() wiring, and the app.js/
// index.html Studio controls). See docs/specifications/IMG-003-OrganicPlacement.md, "Test Plan".

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

// IMG-003 reference fixture -- decision 2's own disc() generator, verbatim (see
// docs/specifications/IMG-003-OrganicPlacement.md, "Measured figures"). A hard-edged disc built
// directly as a {widthPx, heightPx, data} density field -- no prepareImageField()/RGBA/blur -- so
// every sampler under comparison reads the identical pixel grid. Radius 0.45*n with pixel-centre
// offsets; deliberately NOT tools/test-s200-mixed-stone-sizes.mjs's own n/2-2 disc-fixture
// convention, which shifts every count (see decision 2 for the exact numbers that convention gives
// instead).
function disc(n) {
  const d = new Uint8ClampedArray(n * n);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const dx = x - n / 2 + 0.5, dy = y - n / 2 + 0.5;
    d[y * n + x] = dx * dx + dy * dy < (n * 0.45) ** 2 ? 255 : 0;
  }
  return { widthPx: n, heightPx: n, data: d };
}

const DISC_FIELD = disc(200);
const DISC_PLACEMENT = { xMm: 10, yMm: 7, widthMm: 60, heightMm: 60 };

// Same disc, expanded into an RGBA imageBuffer (on-field -> dark, matching the "dark pixels trace
// under the default threshold" convention every other image fixture in this suite uses) -- for the
// tests below that must exercise the full generateImageLayout()/prepareImageField() pipeline rather
// than calling the field sampler directly.
function discImageBuffer(n) {
  const src = disc(n).data;
  const rgba = new Uint8ClampedArray(n * n * 4);
  for (let i = 0; i < src.length; i++) {
    const v = src[i] >= FIELD_ON_THRESHOLD ? 0 : 255;
    rgba[i * 4] = v; rgba[i * 4 + 1] = v; rgba[i * 4 + 2] = v; rgba[i * 4 + 3] = 255;
  }
  return createImageBuffer({ widthPx: n, heightPx: n, data: rgba });
}

// Local copy of fieldPixelOn() -- module-private in StoneSampler.js, not exported -- used only to
// verify the on-field invariant from outside that module, the same nearest-pixel lookup
// sampleOrganicFieldFillPoints()'s own insideAt() closure uses internally.
function fieldPixelOn(field, localXMm, localYMm, widthMm, heightMm) {
  if (localXMm < 0 || localYMm < 0 || localXMm > widthMm || localYMm > heightMm) return false;
  const pixelX = Math.min(field.widthPx - 1, Math.max(0, Math.floor((localXMm / widthMm) * field.widthPx)));
  const pixelY = Math.min(field.heightPx - 1, Math.max(0, Math.floor((localYMm / heightMm) * field.heightPx)));
  return field.data[pixelY * field.widthPx + pixelX] >= FIELD_ON_THRESHOLD;
}

function minPairwiseDistance(points) {
  let min = Infinity;
  for (let i = 0; i < points.length; i++) {
    for (let j = i + 1; j < points.length; j++) {
      const dx = points[i].xMm - points[j].xMm, dy = points[i].yMm - points[j].yMm;
      const d = Math.hypot(dx, dy);
      if (d < min) min = d;
    }
  }
  return min;
}

await test('1. determinism: sampleOrganicFieldFillPoints() run twice with identical args produces deepEqual point lists', () => {
  const a = sampleOrganicFieldFillPoints(DISC_FIELD, DISC_PLACEMENT, 3.0, 2.7, { seed: 5, spread: 1 });
  const b = sampleOrganicFieldFillPoints(DISC_FIELD, DISC_PLACEMENT, 3.0, 2.7, { seed: 5, spread: 1 });
  assert.deepEqual(a, b);
});

await test('2. decision 2 pitch table: organic/grid/staggered/contour counts on the reference fixture', () => {
  // IMG-005's nudgeOrDropStonePoints() replaced dedupeStonePoints() inside sampleContourFieldFillPoints(),
  // so a Contour count can differ from a pre-IMG-005 pin at the same floor even with gapMm omitted --
  // it may now keep a nudged point the old drop-only dedupe would have removed. The pitch-3.0 and
  // pitch-2.2 rows below are that (255->256, 479->480), not a regression; the pitch-4.3 row is
  // unchanged because it had no violations to repair either way.
  const rows = [
    { pitch: 3.0, stoneSizeMm: 2.7, organic: 182, grid: 256, staggered: 298, contour: 256 },
    { pitch: 4.3, stoneSizeMm: 4.0, organic: 90, grid: 120, staggered: 142, contour: 121 },
    { pitch: 2.2, stoneSizeMm: 1.9, organic: 317, grid: 477, staggered: 548, contour: 480 }
  ];
  for (const row of rows) {
    const organic = sampleFieldByMode('organic', DISC_FIELD, DISC_PLACEMENT, row.pitch);
    const grid = sampleFieldByMode('fill', DISC_FIELD, DISC_PLACEMENT, row.pitch);
    const staggered = sampleFieldByMode('staggered', DISC_FIELD, DISC_PLACEMENT, row.pitch);
    const contour = sampleFieldByMode('contour', DISC_FIELD, DISC_PLACEMENT, row.pitch, row.stoneSizeMm);
    assert.equal(organic.length, row.organic, `pitch ${row.pitch} organic count`);
    assert.equal(grid.length, row.grid, `pitch ${row.pitch} grid count`);
    assert.equal(staggered.length, row.staggered, `pitch ${row.pitch} staggered count`);
    assert.equal(contour.length, row.contour, `pitch ${row.pitch} contour count`);
  }
});

await test('3. different seeds (1..20) on the reference fixture/pitch each produce a count in 174-186 and pairwise-distinct point lists', () => {
  const runs = [];
  for (let seed = 1; seed <= 20; seed++) {
    const points = sampleFieldByMode('organic', DISC_FIELD, DISC_PLACEMENT, 3.0, 2.7, { seed, spread: 1 });
    assert.ok(points.length >= 174 && points.length <= 186, `seed ${seed}: count ${points.length} out of range`);
    runs.push(points);
  }
  for (let i = 0; i < runs.length; i++) {
    for (let j = i + 1; j < runs.length; j++) {
      assert.notDeepEqual(runs[i], runs[j], `seed ${i + 1} and ${j + 1} produced identical point lists`);
    }
  }
});

await test('4. minimum-distance invariant: every accepted point is >= r from every other accepted point (exhaustive pairwise)', () => {
  for (const [pitch, stoneSizeMm] of [[3.0, 2.7], [4.3, 4.0], [2.2, 1.9]]) {
    const points = sampleFieldByMode('organic', DISC_FIELD, DISC_PLACEMENT, pitch, stoneSizeMm);
    assert.ok(points.length > 1);
    assert.ok(minPairwiseDistance(points) >= pitch, `pitch ${pitch}: min pairwise distance below r`);
  }
});

await test('5. on-field invariant: every accepted point is at/above FIELD_ON_THRESHOLD, zero exceptions', () => {
  const points = sampleFieldByMode('organic', DISC_FIELD, DISC_PLACEMENT, 2.2, 1.9);
  assert.ok(points.length > 0);
  for (const p of points) {
    const localXMm = p.xMm - DISC_PLACEMENT.xMm, localYMm = p.yMm - DISC_PLACEMENT.yMm;
    assert.ok(fieldPixelOn(DISC_FIELD, localXMm, localYMm, DISC_PLACEMENT.widthMm, DISC_PLACEMENT.heightMm), `point (${p.xMm},${p.yMm}) is off-field`);
  }
});

// Two on-regions separated by an off band wider than the sampling pitch, with no on-pixel path
// between them -- proves the never-rewinding island re-seed scan (decision 2) actually reaches a
// second island rather than stopping at the first one Bridson happens to start in.
function twoIslandField(n) {
  const d = new Uint8ClampedArray(n * n);
  const islandRadius = n * 0.12;
  const centers = [[n * 0.2, n * 0.2], [n * 0.8, n * 0.8]];
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const on = centers.some(([cx, cy]) => {
      const dx = x - cx + 0.5, dy = y - cy + 0.5;
      return dx * dx + dy * dy < islandRadius * islandRadius;
    });
    d[y * n + x] = on ? 255 : 0;
  }
  return { widthPx: n, heightPx: n, data: d };
}

await test('6. disconnected islands: points appear in every disconnected on-field region, not only the one the scan starts in', () => {
  const field = twoIslandField(200);
  const placement = { xMm: 0, yMm: 0, widthMm: 40, heightMm: 40 };
  const points = sampleFieldByMode('organic', field, placement, 1.5);
  assert.ok(points.length > 0);
  const nearFirstIsland = points.filter((p) => Math.hypot(p.xMm - 8, p.yMm - 8) < 6);
  const nearSecondIsland = points.filter((p) => Math.hypot(p.xMm - 32, p.yMm - 32) < 6);
  assert.ok(nearFirstIsland.length > 0, 'expected points in the first island');
  assert.ok(nearSecondIsland.length > 0, 'expected points in the second island');
  assert.equal(nearFirstIsland.length + nearSecondIsland.length, points.length, 'expected every point to fall in one of the two islands');
  for (const p of points) {
    const localXMm = p.xMm - placement.xMm, localYMm = p.yMm - placement.yMm;
    assert.ok(fieldPixelOn(field, localXMm, localYMm, placement.widthMm, placement.heightMm), `point (${p.xMm},${p.yMm}) is off-field`);
  }
});

await test('7. spread scaling: spread 1/1.25/1.5/2/3 on the reference fixture/pitch/seed reproduces the 182/111/78/45/22 counts, each with min pairwise distance >= r', () => {
  const expected = { 1: 182, 1.25: 111, 1.5: 78, 2: 45, 3: 22 };
  for (const spread of [1, 1.25, 1.5, 2, 3]) {
    const points = sampleFieldByMode('organic', DISC_FIELD, DISC_PLACEMENT, 3.0, 2.7, { seed: 1, spread });
    assert.equal(points.length, expected[spread], `spread ${spread} count`);
    const r = 3.0 * spread;
    assert.ok(minPairwiseDistance(points) >= r - 1e-9, `spread ${spread}: min pairwise distance below r`);
  }
});

await test('8. sampleFieldByMode("organic", ...) dispatches to sampleOrganicFieldFillPoints() with samplerOptions forwarded', () => {
  const viaDispatch = sampleFieldByMode('organic', DISC_FIELD, DISC_PLACEMENT, 3.0, 2.7, { seed: 7, spread: 1.5 });
  const direct = sampleOrganicFieldFillPoints(DISC_FIELD, DISC_PLACEMENT, 3.0, 2.7, { seed: 7, spread: 1.5 });
  assert.deepEqual(viaDispatch, direct);
  // A different seed/spread in samplerOptions must actually change the output -- proving the
  // dispatcher forwards it rather than silently defaulting.
  const differentSeed = sampleFieldByMode('organic', DISC_FIELD, DISC_PLACEMENT, 3.0, 2.7, { seed: 8, spread: 1.5 });
  assert.notDeepEqual(differentSeed, viaDispatch);
});

await test('9. samplerOptions omitted (null/default) resolves to seed:1, spread:1, matching an explicit {seed:1, spread:1}', () => {
  const omitted = sampleFieldByMode('organic', DISC_FIELD, DISC_PLACEMENT, 3.0, 2.7);
  const explicit = sampleFieldByMode('organic', DISC_FIELD, DISC_PLACEMENT, 3.0, 2.7, { seed: 1, spread: 1 });
  assert.deepEqual(omitted, explicit);
});

await test('10. byte-identity vs. develop: Fill/Staggered/Radial/Contour generateImageLayout() output is unchanged by the organic addition', () => {
  // Reference values are IMG-002's own frozen case 4 capture (tools/test-img-002-color-layers.mjs),
  // itself captured from develop at f1e5dee (the merge-base of that branch and develop) and confirmed
  // byte-identical to this branch's own base: `git diff ef190d0 3878f65 -- src/image/ src/geometry/`
  // produces no output (ef190d0 is the IMG-002 merge commit; 3878f65 is develop's tip this branch was
  // cut from, per this branch's own git log) -- so every intervening src/image/**/src/geometry/**
  // file is unchanged between the original IMG-002 capture and this branch's starting point, and
  // IMG-003 itself touches sampleFieldByMode()'s new 'organic' case and sixth samplerOptions
  // parameter only, both unreachable from a mode:'fill' call. This is the same capture, not a second,
  // independently-diverging one.
  const buffer = createImageBuffer({
    widthPx: 4,
    heightPx: 4,
    data: (() => {
      const data = new Uint8ClampedArray(16 * 4);
      for (let i = 0; i < 16; i++) {
        const [r, g, b, a] = i < 8 ? [0, 0, 0, 255] : [255, 255, 255, 255];
        data[i * 4] = r; data[i * 4 + 1] = g; data[i * 4 + 2] = b; data[i * 4 + 3] = a;
      }
      return data;
    })()
  });
  const engine = createGeometryEngine({});
  const result = engine.generateImageLayout({
    imageBuffer: buffer, layerId: 'img002-ref', xMm: 3, yMm: 5, widthMm: 10, heightMm: 10,
    stoneSizeMm: 2, gapMm: 0.3, mode: 'fill', color: 'gold', threshold: 128, invert: false,
    blurRadiusPx: 0, maxWidthPx: 4, maxHeightPx: 4, transparent: 'white'
  });
  const expected = [
    { xMm: 4.15, yMm: 6.15, sizeMm: 2, color: 'gold', index: 0 },
    { xMm: 6.449999999999999, yMm: 6.15, sizeMm: 2, color: 'gold', index: 1 },
    { xMm: 8.75, yMm: 6.15, sizeMm: 2, color: 'gold', index: 2 },
    { xMm: 11.05, yMm: 6.15, sizeMm: 2, color: 'gold', index: 3 },
    { xMm: 4.15, yMm: 8.45, sizeMm: 2, color: 'gold', index: 4 },
    { xMm: 6.449999999999999, yMm: 8.45, sizeMm: 2, color: 'gold', index: 5 },
    { xMm: 8.75, yMm: 8.45, sizeMm: 2, color: 'gold', index: 6 },
    { xMm: 11.05, yMm: 8.45, sizeMm: 2, color: 'gold', index: 7 }
  ];
  assert.deepEqual(result.stones.map((s) => ({ xMm: s.xMm, yMm: s.yMm, sizeMm: s.sizeMm, color: s.color, index: s.index })), expected);
});

await test('11. generateImageLayout({mode:"organic", seed, spread}): normalizeImageParams() defaults seed/spread to 1/1 when omitted or invalid, and forwards resolved values', () => {
  const engine = createGeometryEngine({});
  const buffer = discImageBuffer(200);

  const withDefaults = engine.generateImageLayout({
    imageBuffer: buffer, layerId: 'img003-defaults', xMm: 10, yMm: 7, widthMm: 60, heightMm: 60,
    stoneSizeMm: 2.7, gapMm: 0.3, mode: 'organic', maxWidthPx: 200, maxHeightPx: 200
  });
  const withExplicit = engine.generateImageLayout({
    imageBuffer: buffer, layerId: 'img003-explicit', xMm: 10, yMm: 7, widthMm: 60, heightMm: 60,
    stoneSizeMm: 2.7, gapMm: 0.3, mode: 'organic', maxWidthPx: 200, maxHeightPx: 200, seed: 1, spread: 1
  });
  assert.equal(withDefaults.stones.length, withExplicit.stones.length);
  for (let i = 0; i < withDefaults.stones.length; i++) {
    assert.equal(withDefaults.stones[i].xMm, withExplicit.stones[i].xMm);
    assert.equal(withDefaults.stones[i].yMm, withExplicit.stones[i].yMm);
  }

  const withInvalid = engine.generateImageLayout({
    imageBuffer: buffer, layerId: 'img003-invalid', xMm: 10, yMm: 7, widthMm: 60, heightMm: 60,
    stoneSizeMm: 2.7, gapMm: 0.3, mode: 'organic', maxWidthPx: 200, maxHeightPx: 200, seed: -5, spread: 0.5
  });
  assert.equal(withInvalid.stones.length, withExplicit.stones.length, 'invalid seed/spread should fall back to 1/1, matching the explicit-1/1 run');

  const withDifferentSeed = engine.generateImageLayout({
    imageBuffer: buffer, layerId: 'img003-seed2', xMm: 10, yMm: 7, widthMm: 60, heightMm: 60,
    stoneSizeMm: 2.7, gapMm: 0.3, mode: 'organic', maxWidthPx: 200, maxHeightPx: 200, seed: 2
  });
  const changed = withDifferentSeed.stones.length !== withExplicit.stones.length ||
    withDifferentSeed.stones.some((s, i) => s.xMm !== withExplicit.stones[i]?.xMm || s.yMm !== withExplicit.stones[i]?.yMm);
  assert.ok(changed, 'a different seed should change the generated layout');
});

await test('12. S-200 infill under organic: additive, no cross-group overlap (per-pair (a.sizeMm+b.sizeMm)/2+gapMm threshold), deterministic for a fixed seed', () => {
  const buffer = discImageBuffer(200);
  const mixedOptions = { sizeMode: 'mixed', allowedSizesMm: [2.0, 2.8, 4.0], minSizeMm: 2.0, maxSizeMm: 4.0, conservativeDetail: 1.0 };

  const engine = createGeometryEngine({});
  const params = {
    imageBuffer: buffer, layerId: 'img003-mixed', xMm: 10, yMm: 7, widthMm: 60, heightMm: 60,
    stoneSizeMm: 4.0, gapMm: 0.3, mode: 'organic', maxWidthPx: 200, maxHeightPx: 200, seed: 1, spread: 1
  };
  const uniform = engine.generateImageLayout(params);
  const mixed = engine.generateImageLayout({ ...params, ...mixedOptions });
  assert.ok(mixed.stones.length > uniform.stones.length, 'expected additive infill stones');

  const collisionSlackMm = -1e-9; // see IMG-002's own findCrossGroupCollisions() float-noise workaround (docs/BACKLOG.md)
  const flatStones = mixed.stones.map((s, i) => ({
    x: s.xMm, y: s.yMm, d: s.sizeMm + params.gapMm + collisionSlackMm,
    layerId: i < uniform.stones.length ? 'base' : 'infill'
  }));
  assert.deepEqual(findCrossGroupCollisions(flatStones), []);

  const mixedAgain = engine.generateImageLayout({ ...params, ...mixedOptions });
  assert.equal(mixedAgain.stones.length, mixed.stones.length);
  for (let i = 0; i < mixed.stones.length; i++) {
    assert.equal(mixedAgain.stones[i].xMm, mixed.stones[i].xMm);
    assert.equal(mixedAgain.stones[i].yMm, mixed.stones[i].yMm);
  }
});

await test('13. generateMixedSizeInfillPoints() forwards samplerOptions to sampleFieldByMode() for a field source', () => {
  const points1 = generateMixedSizeInfillPoints({
    mode: 'organic',
    source: { kind: 'field', field: DISC_FIELD, placement: DISC_PLACEMENT },
    mixedOptions: { eligibleSizesMm: [2.8, 2.0], conservativeDetail: 1.0 },
    gapMm: 0.3,
    baseStones: [],
    samplerOptions: { seed: 1, spread: 1 }
  });
  const points2 = generateMixedSizeInfillPoints({
    mode: 'organic',
    source: { kind: 'field', field: DISC_FIELD, placement: DISC_PLACEMENT },
    mixedOptions: { eligibleSizesMm: [2.8, 2.0], conservativeDetail: 1.0 },
    gapMm: 0.3,
    baseStones: [],
    samplerOptions: { seed: 2, spread: 1 }
  });
  assert.ok(points1.length > 0);
  assert.notDeepEqual(points1, points2);
});

// mulberry32 pinning -- CrystalAppearance.js:29's mulberry32 is module-private (grep-confirmed: its
// only exports are crystalSeedForStone/SPARKLE_VARIANT_COUNT/getCrystalAppearance), so it cannot be
// imported here. Pinned two ways instead: (a) below, a frozen literal of the algorithm's own first 8
// outputs at seed 1, captured at implementation time directly from this recurrence; (b) further
// below, a source-text assertion that CrystalAppearance.js's and OrganicSampler.js's copies are
// character-identical apart from indentation -- together these prove OrganicSampler.js's real
// private copy produces exactly this sequence too.
function referenceMulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

await test('14a. mulberry32(1) pinned first-8-outputs literal', () => {
  const rand = referenceMulberry32(1);
  const outputs = Array.from({ length: 8 }, () => rand());
  // Captured at implementation time -- see comment above.
  const expected = [
    0.6270739405881613, 0.002735721180215478, 0.5274470399599522, 0.9810509674716741,
    0.9683778982143849, 0.281103502959013, 0.6128388606011868, 0.7207431411370635
  ];
  assert.deepEqual(outputs, expected);
});

await test('14b. OrganicSampler.js keeps a character-identical (apart from indentation) private copy of CrystalAppearance.js:29\'s mulberry32', () => {
  const crystalSrc = fs.readFileSync(new URL('../src/renderer/CrystalAppearance.js', import.meta.url), 'utf8');
  const organicSrc = fs.readFileSync(new URL('../src/geometry/OrganicSampler.js', import.meta.url), 'utf8');
  const extractBody = (src) => {
    const match = src.match(/function mulberry32\(seed\) \{[\s\S]*?\n\}/);
    assert.ok(match, 'expected a mulberry32(seed) function in the source');
    return match[0].replace(/^\s+/gm, '');
  };
  assert.equal(extractBody(organicSrc), extractBody(crystalSrc));
});

await test('15. IMAGE_SAMPLE_MODES contains "organic"; SAMPLE_MODES (vector) does not', () => {
  const engine = createGeometryEngine({});
  const buffer = createImageBuffer({ widthPx: 2, heightPx: 2, data: new Uint8ClampedArray([0, 0, 0, 255, 0, 0, 0, 255, 0, 0, 0, 255, 0, 0, 0, 255]) });
  assert.doesNotThrow(() => engine.generateImageLayout({
    imageBuffer: buffer, layerId: 'img003-mode-check', widthMm: 10, heightMm: 10, stoneSizeMm: 2, gapMm: 0.3,
    mode: 'organic', maxWidthPx: 2, maxHeightPx: 2
  }));
  assert.throws(
    () => engine.generatePathLayout({
      contours: [[{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 5, y: 10 }]],
      layerId: 'img003-vector-mode-check', stoneSizeMm: 2, gapMm: 0.3, mode: 'organic'
    }),
    /Unsupported geometry mode: organic\. Expected one of: outline, fill, staggered, radial, contour/
  );
});

console.log('IMG-003 organic placement tests complete.');
