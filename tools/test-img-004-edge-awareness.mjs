import assert from 'node:assert/strict';
import {
  createGeometryEngine,
  sampleFieldByMode,
  sampleOrganicFieldFillPoints,
  samplePoissonDiskPoints
} from '../src/geometry/index.js';
import { createImageBuffer, edgeChannel, prepareImageField } from '../src/image/index.js';
import { FIELD_ON_THRESHOLD } from '../src/geometry/StoneSampler.js';
import fs from 'node:fs';

// IMG-004 -- unit tests for the 'edge' image fill mode (src/image/Edge.js's edgeChannel(),
// OrganicSampler.js's variable-radius generalization, StoneSampler.js's
// sampleEdgeFieldFillPoints()/sampleFieldByMode() dispatch, GeometryEngine.generateImageLayout()
// wiring, and the app.js/index.html Studio controls). See
// docs/specifications/IMG-004-EdgeAwareness.md, "Test Plan".

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

// Both fixture generators, verbatim from docs/specifications/IMG-004-EdgeAwareness.md, decision 8.
function disc(n) {
  const d = new Uint8ClampedArray(n * n);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const dx = x - n / 2 + 0.5, dy = y - n / 2 + 0.5;
    d[y * n + x] = dx * dx + dy * dy < (n * 0.45) ** 2 ? 255 : 0;
  }
  return { widthPx: n, heightPx: n, data: d };
}
function frame(n) {
  const d = new Uint8ClampedArray(n * n);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const m = Math.max(Math.abs(x - n / 2 + 0.5), Math.abs(y - n / 2 + 0.5));
    d[y * n + x] = m >= n * 0.15 && m < n * 0.45 ? 255 : 0;
  }
  return { widthPx: n, heightPx: n, data: d };
}

const DISC_FIELD = disc(200);
const FRAME_FIELD = frame(200);
const DISC_PLACEMENT = { xMm: 10, yMm: 7, widthMm: 60, heightMm: 60 };
const PITCH_MM = 3.0;

// Same disc, expanded into an RGBA imageBuffer (on-field -> dark, the same convention
// tools/test-img-003-organic-placement.mjs's own discImageBuffer() uses) -- for the tests below that
// must exercise the full generateImageLayout()/prepareImageField() pipeline rather than calling the
// field sampler directly.
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
// sampleEdgeFieldFillPoints()'s own insideAt() closure uses internally.
function fieldPixelOn(field, localXMm, localYMm, widthMm, heightMm) {
  if (localXMm < 0 || localYMm < 0 || localXMm > widthMm || localYMm > heightMm) return false;
  const pixelX = Math.min(field.widthPx - 1, Math.max(0, Math.floor((localXMm / widthMm) * field.widthPx)));
  const pixelY = Math.min(field.heightPx - 1, Math.max(0, Math.floor((localYMm / heightMm) * field.heightPx)));
  return field.data[pixelY * field.widthPx + pixelX] >= FIELD_ON_THRESHOLD;
}

// Local copy of the same clamped-floor pixel lookup, against field.edge instead of field.data -- the
// test's own independent read of the value sampleEdgeFieldFillPoints()'s edgeAt() closure computes
// internally, used to recompute each accepted point's own intended radius from outside the module.
function fieldEdgeAt(field, localXMm, localYMm, widthMm, heightMm) {
  const pixelX = Math.min(field.widthPx - 1, Math.max(0, Math.floor((localXMm / widthMm) * field.widthPx)));
  const pixelY = Math.min(field.heightPx - 1, Math.max(0, Math.floor((localYMm / heightMm) * field.heightPx)));
  return field.edge[pixelY * field.widthPx + pixelX];
}

function edgeFieldFor(baseField, edgeWidthMm) {
  const bandRadiusPx = Math.round(edgeWidthMm * 200 / 60);
  const edge = edgeChannel(baseField, bandRadiusPx);
  return { widthPx: baseField.widthPx, heightPx: baseField.heightPx, data: baseField.data, edge: edge.data };
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

await test('1. samplePoissonDiskPoints() without radiusAt reproduces the IMG-003 baseline counts and spread sweep -- the byte-identity guard for decision 2\'s generalization', () => {
  const insideAt = (x, y) => fieldPixelOn(DISC_FIELD, x, y, DISC_PLACEMENT.widthMm, DISC_PLACEMENT.heightMm);
  const rows = [
    { spacingMm: 3.0, expected: 182 },
    { spacingMm: 4.3, expected: 90 },
    { spacingMm: 2.2, expected: 317 }
  ];
  for (const row of rows) {
    const points = samplePoissonDiskPoints({ insideAt, widthMm: DISC_PLACEMENT.widthMm, heightMm: DISC_PLACEMENT.heightMm, spacingMm: row.spacingMm, seed: 1, spread: 1 });
    assert.equal(points.length, row.expected, `spacingMm ${row.spacingMm} count`);
  }
  const expectedSpread = { 1: 182, 1.25: 111, 1.5: 78, 2: 45, 3: 22 };
  for (const spread of [1, 1.25, 1.5, 2, 3]) {
    const points = samplePoissonDiskPoints({ insideAt, widthMm: DISC_PLACEMENT.widthMm, heightMm: DISC_PLACEMENT.heightMm, spacingMm: 3.0, seed: 1, spread });
    assert.equal(points.length, expectedSpread[spread], `spread ${spread} count`);
  }
});

await test('2. edgeThinning: 0 on the disc fixture deepEquals plain Organic\'s own output at the same seed/pitch/spread', () => {
  const field = edgeFieldFor(DISC_FIELD, 6);
  const edgePoints = sampleFieldByMode('edge', field, DISC_PLACEMENT, PITCH_MM, PITCH_MM, { seed: 1, spread: 1, edgeThinning: 0 });
  const organicPoints = sampleOrganicFieldFillPoints(field, DISC_PLACEMENT, PITCH_MM, PITCH_MM, { seed: 1, spread: 1 });
  assert.deepEqual(edgePoints, organicPoints);
  assert.equal(edgePoints.length, 182);
});

await test('3. disc table: exact count and exact "stones with edge===255 at their pixel" count, all nine (edgeWidthMm, edgeThinning) pairs', () => {
  const rows = [
    { edgeWidthMm: 3, edgeThinning: 0.5, count: 111, edge255: 59 },
    { edgeWidthMm: 3, edgeThinning: 1, count: 92, edge255: 69 },
    { edgeWidthMm: 3, edgeThinning: 2, count: 74, edge255: 65 },
    { edgeWidthMm: 6, edgeThinning: 0.5, count: 126, edge255: 87 },
    { edgeWidthMm: 6, edgeThinning: 1, count: 113, edge255: 93 },
    { edgeWidthMm: 6, edgeThinning: 2, count: 107, edge255: 102 },
    { edgeWidthMm: 9, edgeThinning: 0.5, count: 153, edge255: 132 },
    { edgeWidthMm: 9, edgeThinning: 1, count: 137, edge255: 127 },
    { edgeWidthMm: 9, edgeThinning: 2, count: 129, edge255: 127 }
  ];
  for (const row of rows) {
    const field = edgeFieldFor(DISC_FIELD, row.edgeWidthMm);
    const points = sampleFieldByMode('edge', field, DISC_PLACEMENT, PITCH_MM, PITCH_MM, { seed: 1, spread: 1, edgeThinning: row.edgeThinning });
    assert.equal(points.length, row.count, `edgeWidthMm ${row.edgeWidthMm} edgeThinning ${row.edgeThinning} count`);
    let edge255 = 0;
    for (const p of points) {
      const localXMm = p.xMm - DISC_PLACEMENT.xMm, localYMm = p.yMm - DISC_PLACEMENT.yMm;
      if (fieldEdgeAt(field, localXMm, localYMm, DISC_PLACEMENT.widthMm, DISC_PLACEMENT.heightMm) === 255) edge255++;
    }
    assert.equal(edge255, row.edge255, `edgeWidthMm ${row.edgeWidthMm} edgeThinning ${row.edgeThinning} edge===255 count`);
  }
});

await test('4. seed band: disc, 6mm, thinning 1, seeds 1-8 reproduce 113/115/117/117/117/119/111/113 exactly', () => {
  const field = edgeFieldFor(DISC_FIELD, 6);
  const expected = [113, 115, 117, 117, 117, 119, 111, 113];
  for (let seed = 1; seed <= 8; seed++) {
    const points = sampleFieldByMode('edge', field, DISC_PLACEMENT, PITCH_MM, PITCH_MM, { seed, spread: 1, edgeThinning: 1 });
    assert.equal(points.length, expected[seed - 1], `seed ${seed} count`);
  }
});

await test('5. frame table: organic/grid/contour baselines plus all four edge cells, including the 171/171 convergence at 6mm thinning 1 vs. thinning 2', () => {
  const organic = sampleFieldByMode('organic', FRAME_FIELD, DISC_PLACEMENT, PITCH_MM);
  const grid = sampleFieldByMode('fill', FRAME_FIELD, DISC_PLACEMENT, PITCH_MM);
  const contour = sampleFieldByMode('contour', FRAME_FIELD, DISC_PLACEMENT, PITCH_MM, 2.7);
  assert.equal(organic.length, 202, 'frame organic baseline');
  assert.equal(grid.length, 288, 'frame grid baseline');
  // IMG-005's nudgeOrDropStonePoints() replaced dedupeStonePoints() inside sampleContourFieldFillPoints(),
  // so this Contour count can differ from a pre-IMG-005 pin at the same floor even with gapMm omitted --
  // it may now keep a nudged point the old drop-only dedupe would have removed. 272->274 is that, not a regression.
  assert.equal(contour.length, 274, 'frame contour baseline');

  const rows = [
    { edgeWidthMm: 3, edgeThinning: 1, count: 115, edge255: 97 },
    { edgeWidthMm: 3, edgeThinning: 2, count: 91, edge255: 86 },
    { edgeWidthMm: 6, edgeThinning: 1, count: 171, edge255: 171 },
    { edgeWidthMm: 6, edgeThinning: 2, count: 171, edge255: 171 }
  ];
  for (const row of rows) {
    const field = edgeFieldFor(FRAME_FIELD, row.edgeWidthMm);
    const points = sampleFieldByMode('edge', field, DISC_PLACEMENT, PITCH_MM, PITCH_MM, { seed: 1, spread: 1, edgeThinning: row.edgeThinning });
    assert.equal(points.length, row.count, `frame edgeWidthMm ${row.edgeWidthMm} edgeThinning ${row.edgeThinning} count`);
    let edge255 = 0;
    for (const p of points) {
      const localXMm = p.xMm - DISC_PLACEMENT.xMm, localYMm = p.yMm - DISC_PLACEMENT.yMm;
      if (fieldEdgeAt(field, localXMm, localYMm, DISC_PLACEMENT.widthMm, DISC_PLACEMENT.heightMm) === 255) edge255++;
    }
    assert.equal(edge255, row.edge255, `frame edgeWidthMm ${row.edgeWidthMm} edgeThinning ${row.edgeThinning} edge===255 count`);
  }
  // decision 8's convergence: identical counts once the ring no longer fits a second thinned row.
  assert.equal(rows[2].count, rows[3].count);
});

await test('6. minimum-pairwise-distance invariant: rc recomputed from field.edge matches max(rc_i, rc_j) pairwise, and every disc cell\'s min distance is >= pitch', () => {
  const edgeThinning = 1;
  for (const edgeWidthMm of [3, 6, 9]) {
    const field = edgeFieldFor(DISC_FIELD, edgeWidthMm);
    const base = PITCH_MM * Math.max(1, 1);
    const points = sampleFieldByMode('edge', field, DISC_PLACEMENT, PITCH_MM, PITCH_MM, { seed: 1, spread: 1, edgeThinning });
    assert.ok(points.length > 1);
    const rc = points.map((p) => {
      const localXMm = p.xMm - DISC_PLACEMENT.xMm, localYMm = p.yMm - DISC_PLACEMENT.yMm;
      const edgeAt = fieldEdgeAt(field, localXMm, localYMm, DISC_PLACEMENT.widthMm, DISC_PLACEMENT.heightMm);
      return base * (1 + edgeThinning * (1 - edgeAt / 255));
    });
    for (let i = 0; i < points.length; i++) {
      for (let j = i + 1; j < points.length; j++) {
        const dx = points[i].xMm - points[j].xMm, dy = points[i].yMm - points[j].yMm;
        const d = Math.hypot(dx, dy);
        const rr = Math.max(rc[i], rc[j]);
        assert.ok(d >= rr - 1e-9, `points ${i}/${j}: distance ${d} below max(rc) ${rr}`);
      }
    }
    assert.ok(minPairwiseDistance(points) >= PITCH_MM - 1e-9, `edgeWidthMm ${edgeWidthMm}: min pairwise distance below pitch`);
  }
});

await test('7. zero off-field stones: every accepted point\'s own pixel is at/above FIELD_ON_THRESHOLD, across the disc and frame fixtures', () => {
  for (const baseField of [DISC_FIELD, FRAME_FIELD]) {
    const field = edgeFieldFor(baseField, 6);
    const points = sampleFieldByMode('edge', field, DISC_PLACEMENT, PITCH_MM, PITCH_MM, { seed: 1, spread: 1, edgeThinning: 1 });
    assert.ok(points.length > 0);
    for (const p of points) {
      const localXMm = p.xMm - DISC_PLACEMENT.xMm, localYMm = p.yMm - DISC_PLACEMENT.yMm;
      assert.ok(fieldPixelOn(field, localXMm, localYMm, DISC_PLACEMENT.widthMm, DISC_PLACEMENT.heightMm), `point (${p.xMm},${p.yMm}) is off-field`);
    }
  }
});

await test('8. edgeChannel()\'s monotonic-deque max filter equals a naive O(width*height*radius^2) max filter at five spot pixels on a 64x64 random field, radius 5', () => {
  function rand32(seed) {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const n = 64;
  const rand = rand32(99);
  const data = new Uint8ClampedArray(n * n);
  for (let i = 0; i < data.length; i++) data[i] = Math.floor(rand() * 256);
  const field = { widthPx: n, heightPx: n, data };

  const radius = 5;
  const sobel = edgeChannel(field, 0).data;
  const fast = edgeChannel(field, radius).data;

  function naiveMaxAt(i) {
    const x = i % n, y = Math.floor(i / n);
    let m = 0;
    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        const cx = Math.min(n - 1, Math.max(0, x + dx));
        const cy = Math.min(n - 1, Math.max(0, y + dy));
        m = Math.max(m, sobel[cy * n + cx]);
      }
    }
    return m;
  }

  const spots = [0, 137, 2050, 3200, 4090];
  for (const i of spots) {
    assert.equal(fast[i], naiveMaxAt(i), `spot pixel ${i}`);
  }
});

await test('9. prepareImageField() returns an edge key of the working (post-resize) size; edgeBandFraction: 0 yields the raw Sobel magnitude (all-zero on a uniform field)', () => {
  const n = 32;
  const rgba = new Uint8ClampedArray(n * n * 4);
  for (let i = 0; i < n * n; i++) { rgba[i * 4] = 128; rgba[i * 4 + 1] = 128; rgba[i * 4 + 2] = 128; rgba[i * 4 + 3] = 255; }
  const buffer = createImageBuffer({ widthPx: n, heightPx: n, data: rgba });

  const field = prepareImageField(buffer, { maxWidthPx: 16, maxHeightPx: 16, edgeBandFraction: 0 });
  assert.equal(field.edge.length, 16 * 16, 'edge key should be the working (post-resize) size');
  assert.ok(field.edge.every((v) => v === 0), 'a uniform field has zero gradient everywhere');
});

await test('10. round-trip: edgeWidthMm/edgeThinning persist through normalizeImageParams(); invalid values (non-positive edgeWidthMm, negative edgeThinning) fall back to 6/1', () => {
  const engine = createGeometryEngine({});
  const buffer = discImageBuffer(200);
  const baseParams = {
    imageBuffer: buffer, layerId: 'img004-roundtrip', xMm: 10, yMm: 7, widthMm: 60, heightMm: 60,
    stoneSizeMm: 2.7, gapMm: 0.3, mode: 'edge', maxWidthPx: 200, maxHeightPx: 200, seed: 1, spread: 1
  };

  const withDefaults = engine.generateImageLayout(baseParams);
  const withExplicit6And1 = engine.generateImageLayout({ ...baseParams, edgeWidthMm: 6, edgeThinning: 1 });
  assert.equal(withDefaults.stones.length, withExplicit6And1.stones.length);
  for (let i = 0; i < withDefaults.stones.length; i++) {
    assert.equal(withDefaults.stones[i].xMm, withExplicit6And1.stones[i].xMm);
    assert.equal(withDefaults.stones[i].yMm, withExplicit6And1.stones[i].yMm);
  }

  const withInvalid = engine.generateImageLayout({ ...baseParams, edgeWidthMm: -3, edgeThinning: -1 });
  assert.equal(withInvalid.stones.length, withExplicit6And1.stones.length, 'invalid edgeWidthMm/edgeThinning should fall back to 6/1');
  for (let i = 0; i < withInvalid.stones.length; i++) {
    assert.equal(withInvalid.stones[i].xMm, withExplicit6And1.stones[i].xMm);
    assert.equal(withInvalid.stones[i].yMm, withExplicit6And1.stones[i].yMm);
  }

  const withDifferentWidth = engine.generateImageLayout({ ...baseParams, edgeWidthMm: 3, edgeThinning: 1 });
  const changed = withDifferentWidth.stones.length !== withExplicit6And1.stones.length ||
    withDifferentWidth.stones.some((s, i) => s.xMm !== withExplicit6And1.stones[i]?.xMm || s.yMm !== withExplicit6And1.stones[i]?.yMm);
  assert.ok(changed, 'a different edgeWidthMm should change the generated layout');
});

await test('11. S-200 mixed infill in \'edge\' mode: every infill point is on-field', () => {
  const engine = createGeometryEngine({});
  const buffer = discImageBuffer(200);
  const mixedOptions = { sizeMode: 'mixed', allowedSizesMm: [2.0, 2.8, 4.0], minSizeMm: 2.0, maxSizeMm: 4.0, conservativeDetail: 1.0 };
  const params = {
    imageBuffer: buffer, layerId: 'img004-mixed', xMm: 10, yMm: 7, widthMm: 60, heightMm: 60,
    stoneSizeMm: 4.0, gapMm: 0.3, mode: 'edge', maxWidthPx: 200, maxHeightPx: 200, seed: 1, spread: 1,
    edgeWidthMm: 6, edgeThinning: 1
  };
  const uniform = engine.generateImageLayout(params);
  const mixed = engine.generateImageLayout({ ...params, ...mixedOptions });
  assert.ok(mixed.stones.length > uniform.stones.length, 'expected additive infill stones');

  const field = prepareImageField(buffer, { maxWidthPx: 200, maxHeightPx: 200, edgeBandFraction: params.edgeWidthMm / 60 });
  const placement = { xMm: 10, yMm: 7, widthMm: 60, heightMm: 60 };
  for (const s of mixed.stones) {
    const localXMm = s.xMm - placement.xMm, localYMm = s.yMm - placement.yMm;
    assert.ok(fieldPixelOn(field, localXMm, localYMm, placement.widthMm, placement.heightMm), `stone (${s.xMm},${s.yMm}) is off-field`);
  }
});

await test('12. the four lattice modes and plain Organic produce identical output whether or not field.edge is present on the field passed to sampleFieldByMode()', () => {
  const withoutEdge = DISC_FIELD;
  const withEdge = edgeFieldFor(DISC_FIELD, 6);
  for (const mode of ['fill', 'staggered', 'radial', 'contour', 'organic']) {
    const a = sampleFieldByMode(mode, withoutEdge, DISC_PLACEMENT, PITCH_MM, 2.7, { seed: 1, spread: 1 });
    const b = sampleFieldByMode(mode, withEdge, DISC_PLACEMENT, PITCH_MM, 2.7, { seed: 1, spread: 1 });
    assert.deepEqual(a, b, `mode ${mode} disturbed by the presence of field.edge`);
  }
});

// 200x100 (non-square) fixture for item 13 -- a filled rectangle interior, so there is a real edge
// to detect, on a source whose native pixel width (200) sits below both maxWidthPx values under
// test (400 and 200), so resizeField() never actually downscales it in either case (widthPx stays
// 200 both times) -- exactly the "requested cap changes but the real working width does not" case
// the pre-fix `edgeBandPx = edgeWidthMm * maxWidthPx / widthMm` formula got wrong.
function rectField(w, h) {
  const d = new Uint8ClampedArray(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const inside = x > w * 0.2 && x < w * 0.8 && y > h * 0.2 && y < h * 0.8;
    d[y * w + x] = inside ? 255 : 0;
  }
  return { widthPx: w, heightPx: h, data: d };
}
function imageBufferFromField(field) {
  const { widthPx, heightPx, data } = field;
  const rgba = new Uint8ClampedArray(widthPx * heightPx * 4);
  for (let i = 0; i < data.length; i++) {
    const v = data[i] >= FIELD_ON_THRESHOLD ? 0 : 255;
    rgba[i * 4] = v; rgba[i * 4 + 1] = v; rgba[i * 4 + 2] = v; rgba[i * 4 + 3] = 255;
  }
  return createImageBuffer({ widthPx, heightPx, data: rgba });
}

await test('13. band-width fix: a 200x100 source at maxWidthPx 400 vs. maxWidthPx 200 (same edgeWidthMm, same real working width) produces byte-identical stone output', () => {
  // Both requested caps (400, 200) are >= the native width (200), so resizeField() never downscales
  // in either case -- the working field is 200px wide both times. Under the pre-fix formula
  // (edgeWidthMm * maxWidthPx / widthMm), that would still have produced a 2x-different band radius
  // (and therefore a different stone layout) purely because maxWidthPx differed, despite the real
  // field width being identical -- exactly the bug this fix targets. deepEqual stone positions is the
  // check that actually responds to it (a coarser check, like just comparing stone counts, could
  // coincidentally match even with a shifted band).
  const buffer = imageBufferFromField(rectField(200, 100));
  const baseParams = {
    imageBuffer: buffer, layerId: 'img004-bandwidth', xMm: 10, yMm: 7, widthMm: 60, heightMm: 30,
    stoneSizeMm: 2.7, gapMm: 0.3, mode: 'edge', edgeWidthMm: 6, edgeThinning: 1, seed: 1, spread: 1,
    maxHeightPx: 300
  };
  const engine = createGeometryEngine({});
  const atMax400 = engine.generateImageLayout({ ...baseParams, maxWidthPx: 400 });
  const atMax200 = engine.generateImageLayout({ ...baseParams, maxWidthPx: 200 });
  assert.ok(atMax400.stones.length > 0, 'expected a non-empty layout');
  assert.equal(atMax400.stones.length, atMax200.stones.length, 'maxWidthPx should not change stone count when it does not change the real working width');
  assert.deepEqual(
    atMax400.stones.map((s) => ({ xMm: s.xMm, yMm: s.yMm })),
    atMax200.stones.map((s) => ({ xMm: s.xMm, yMm: s.yMm })),
    'maxWidthPx 400 vs. 200 produced different stone positions despite an unchanged real working width'
  );
});

// Brace-balanced extraction of one function's body, the same convention
// tools/test-autosave-recovery-wiring.mjs's extractFunctionBody() uses for its own app.js source-text
// guards -- robust to the function being reformatted across lines, unlike a fixed end-marker slice.
// `signatureMarker` must include the function's own parameter list through its body-opening "{" --
// generateImageStonesLive()'s destructured default param (`{includeStats=false}={}`) has its own
// braces before the real body starts, so searching for "the next {" after just the function name
// would stop at the wrong one.
function extractFunctionBody(source, signatureMarker, label) {
  const start = source.indexOf(signatureMarker);
  assert.ok(start !== -1, `expected to find "${signatureMarker}" (${label}) in app.js`);
  const braceStart = start + signatureMarker.length - 1;
  assert.equal(source[braceStart], '{', `expected signatureMarker to end at ${label}'s body-opening "{"`);
  let depth = 0;
  for (let i = braceStart; i < source.length; i++) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}') {
      depth--;
      if (depth === 0) return source.slice(start, i + 1);
    }
  }
  throw new Error(`expected to find the matching closing "}" of ${label} in app.js`);
}

await test('14. app-path guard: generateImageStonesLive()\'s params object actually forwards seed/spread/edgeWidthMm/edgeThinning to generateImageLayout()', () => {
  // Engine-level tests (1-13 above) cannot catch a defect where app.js simply never reads a layer
  // field into the params object it hands the engine -- see docs/BACKLOG.md's new row on exactly this
  // class of defect (layer.seed/layer.spread never reached the engine between the IMG-003 merge and
  // this fix). Guards on app.js's own source text instead, the same convention
  // tools/test-autosave-recovery-wiring.mjs's updateAll() tail guards use.
  const appSrc = fs.readFileSync(new URL('../app.js', import.meta.url), 'utf8');
  const body = extractFunctionBody(appSrc, 'async generateImageStonesLive(layer,{includeStats=false}={}){', 'generateImageStonesLive()');
  assert.ok(body.includes('this.permanentEngine.generateImageLayout(params)'), 'expected generateImageStonesLive() to still call generateImageLayout(params)');
  for (const key of ['seed:', 'spread:', 'edgeWidthMm:', 'edgeThinning:']) {
    assert.ok(body.includes(key), `generateImageStonesLive()'s params object is missing "${key}"`);
  }
});

console.log('IMG-004 edge awareness tests complete.');
