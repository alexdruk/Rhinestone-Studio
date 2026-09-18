import assert from 'node:assert/strict';
import {
  createGeometryEngine,
  dropOverlappingSizedStones
} from '../src/geometry/index.js';
import {
  sampleFieldByMode,
  fieldLabelAt,
  fieldLuminanceAt,
  ink,
  NO_LABEL
} from '../src/geometry/StoneSampler.js';
import { createImageBuffer, prepareImageField } from '../src/image/index.js';
import fs from 'node:fs';

// IMG-006 -- unit tests for brightness-following stone size (MixedSizeGenerator.js's 'brightness'
// sizeMode, StoneSampler.js's fieldLuminanceAt()/ink()/brightnessThinning wiring into
// sampleOrganicFieldFillPoints()/sampleEdgeFieldFillPoints(), and
// GeometryEngine.generateImageLayout()'s isBrightness branch). See
// docs/specifications/IMG-006-BrightnessSizes.md, "Test Plan".

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

// Fixture, verbatim from docs/specifications/IMG-006-BrightnessSizes.md, Test Plan -- a
// left-to-right x-gradient (lum = x), threshold 200 (every pixel on), so "band" is simply an x-third:
// dark [0,20), mid [20,40), bright [40,60) mm.
const N = 200, W = 60, H = 60, GAP = 0.3, SIZES = [2.0, 2.8, 4.0], THRESH = 200;
const d = new Uint8ClampedArray(N * N * 4);
for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) { const i = (y * N + x) * 4; d[i] = d[i + 1] = d[i + 2] = x; d[i + 3] = 255; }
const field = prepareImageField(createImageBuffer({ widthPx: N, heightPx: N, data: d }), { threshold: THRESH, maxWidthPx: N, maxHeightPx: N, edgeBandFraction: 6 / W });
const placement = { xMm: 0, yMm: 0, widthMm: W, heightMm: H };
// sampler options for organic/edge/radial/contour: { seed: 1, spread: 1, edgeThinning: 1, gapMm: GAP }
const SAMPLER_OPTIONS = { seed: 1, spread: 1, edgeThinning: 1, gapMm: GAP };

const maxSizeMm = SIZES[SIZES.length - 1];
const maxPitchMm = maxSizeMm + GAP;

function coverage(stones) {
  const bands = [0, 0, 0];
  const bandAreaMm2 = 20 * 60;
  for (const s of stones) {
    const band = Math.min(2, Math.floor(s.xMm / 20));
    bands[band] += (Math.PI * s.sizeMm * s.sizeMm) / 4;
  }
  return bands.map((areaMm2) => Math.round((areaMm2 / bandAreaMm2) * 1000) / 1000);
}

// Reproduces decision 1's assign step directly against the real exported primitives (fieldLuminanceAt()/
// ink()), independent of GeometryEngine.generateImageLayout() -- used to cross-check the engine's own
// isBrightness branch below.
function assignedPoints(mode, pitchMm, sizesMm, samplerOptions) {
  const points = sampleFieldByMode(mode, field, placement, pitchMm, sizesMm[sizesMm.length - 1], samplerOptions);
  const n = sizesMm.length;
  return points.map((p) => {
    const lum = fieldLuminanceAt(field, placement, p.xMm, p.yMm);
    const inkValue = ink(lum, THRESH, false);
    const rung = Math.min(n - 1, Math.floor(inkValue * n));
    return { xMm: p.xMm, yMm: p.yMm, sizeMm: sizesMm[rung] };
  });
}

function buildBrightnessLayout(engine, mode, overrides = {}) {
  return engine.generateImageLayout({
    imageBuffer: createImageBuffer({ widthPx: N, heightPx: N, data: d }),
    layerId: 'img1',
    xMm: 0, yMm: 0, widthMm: W, heightMm: H,
    stoneSizeMm: SIZES[0], gapMm: GAP,
    mode,
    threshold: THRESH,
    maxWidthPx: N, maxHeightPx: N,
    edgeWidthMm: 6,
    seed: 1, spread: 1, edgeThinning: 1,
    sizeMode: 'brightness',
    brightnessSizesMm: SIZES,
    ...overrides
  });
}

// Measured baselines (docs/specifications/IMG-006-BrightnessSizes.md, Test Plan) -- sampling every
// mode at maxPitch = 4.3mm (SIZES[-1] + GAP).
const MEASURED = {
  fill: { assigned: 196, coverage: [0.733, 0.287, 0.183] },
  staggered: { assigned: 216, coverage: [0.754, 0.369, 0.188] },
  radial: { assigned: 181, coverage: [0.618, 0.328, 0.152] },
  contour: { assigned: 141, coverage: [0.545, 0.210, 0.126] },
  organic: { assigned: 137, coverage: [0.503, 0.216, 0.128] },
  edge: { assigned: 40, coverage: [0.136, 0.062, 0.039] }
};

await test('1. Ink rule, both invert settings, including both divisor-guard cases', () => {
  // invert off: (threshold - lum) / threshold, clamped [0,1]; 0 when threshold === 0.
  assert.equal(ink(0, 200, false), 1);
  assert.equal(ink(200, 200, false), 0);
  assert.equal(ink(100, 200, false), (200 - 100) / 200);
  assert.equal(ink(255, 200, false), 0, 'lum above threshold clamps to 0, not negative');
  assert.equal(ink(50, 0, false), 0, 'divisor guard: threshold === 0');

  // invert on: (lum - threshold) / (255 - threshold), clamped [0,1]; 0 when threshold === 255.
  assert.equal(ink(255, 200, true), 1);
  assert.equal(ink(200, 200, true), 0);
  assert.equal(ink(227, 200, true), (227 - 200) / (255 - 200));
  assert.equal(ink(0, 200, true), 0, 'lum below threshold clamps to 0, not negative');
  assert.equal(ink(50, 255, true), 0, 'divisor guard: threshold === 255');
});

await test('2. fieldLuminanceAt() pixel parity with fieldLabelAt(), on a field a mis-indexed read could not satisfy vacuously', () => {
  const w = 10, h = 10;
  const labels = new Uint8ClampedArray(w * h);
  const luminance = new Uint8ClampedArray(w * h);
  for (let i = 0; i < w * h; i++) { labels[i] = i; luminance[i] = 100 + i; }
  const parityField = { widthPx: w, heightPx: h, labels, luminance };
  const parityPlacement = { xMm: 0, yMm: 0, widthMm: w, heightMm: h };

  const onField = [
    [0, 0], [9.9, 9.9], [5, 5], [3, 7], [0, 9.9], [9.9, 0], [2.5, 2.5], [7.1, 3.3]
  ];
  for (const [x, y] of onField) {
    assert.equal(
      fieldLuminanceAt(parityField, parityPlacement, x, y),
      fieldLabelAt(parityField, parityPlacement, x, y) + 100,
      `on-field (${x},${y})`
    );
  }

  const offField = [
    [-1, 5],  // left
    [11, 5],  // right
    [5, -1],  // above
    [5, 11]   // below
  ];
  for (const [x, y] of offField) {
    assert.equal(fieldLabelAt(parityField, parityPlacement, x, y), NO_LABEL, `off-field label (${x},${y})`);
    assert.equal(fieldLuminanceAt(parityField, parityPlacement, x, y), 0, `off-field luminance sentinel (${x},${y})`);
  }
});

await test('3. Zero drops in all six modes on the fixture, at maxPitch', () => {
  const engine = createGeometryEngine();
  for (const mode of Object.keys(MEASURED)) {
    const assigned = assignedPoints(mode, maxPitchMm, SIZES, SAMPLER_OPTIONS);
    const survivors = dropOverlappingSizedStones(assigned);
    assert.equal(survivors.length, assigned.length, `${mode}: expected 0 drops (${assigned.length} assigned)`);

    const layout = buildBrightnessLayout(engine, mode);
    assert.equal(layout.stones.length, assigned.length, `${mode}: engine output should match the independently-reproduced assign step`);
  }
});

await test('4. Per-mode assigned counts and coverage, exact-equality counts and inline literal coverage', () => {
  const engine = createGeometryEngine();
  for (const [mode, expected] of Object.entries(MEASURED)) {
    const layout = buildBrightnessLayout(engine, mode);
    assert.equal(layout.stones.length, expected.assigned, `${mode} assigned count`);
    assert.deepEqual(coverage(layout.stones), expected.coverage, `${mode} coverage`);
  }
});

await test('5. Control-row measurement (rejected "sample small, assign, drop" shape, fill only)', () => {
  const minPitchMm = SIZES[0] + GAP;
  const assigned = assignedPoints('fill', minPitchMm, SIZES, SAMPLER_OPTIONS);
  const survivors = dropOverlappingSizedStones(assigned);
  assert.equal(assigned.length, 676, 'control row assigned count');
  assert.equal(assigned.length - survivors.length, 299, 'control row dropped count');
  assert.deepEqual(coverage(survivors), [0.681, 0.467, 0.579], 'control row coverage');
});

await test('6. Byte-identity guard against literal counts already pinned elsewhere in the repo', () => {
  // Local copies of the referenced fixtures, verbatim per this repo's "pin the fixture, not just the
  // numbers" convention (docs/specifications/IMG-003-OrganicPlacement.md decision 2, commit 8c82dea).
  function disc(n) {
    const dd = new Uint8ClampedArray(n * n);
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      const dx = x - n / 2 + 0.5, dy = y - n / 2 + 0.5;
      dd[y * n + x] = dx * dx + dy * dy < (n * 0.45) ** 2 ? 255 : 0;
    }
    return { widthPx: n, heightPx: n, data: dd };
  }
  function frame(n) {
    const dd = new Uint8ClampedArray(n * n);
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      const m = Math.max(Math.abs(x - n / 2 + 0.5), Math.abs(y - n / 2 + 0.5));
      dd[y * n + x] = m >= n * 0.15 && m < n * 0.45 ? 255 : 0;
    }
    return { widthPx: n, heightPx: n, data: dd };
  }
  const DISC_FIELD = disc(200);
  const FRAME_FIELD = frame(200);
  const DISC_PLACEMENT = { xMm: 10, yMm: 7, widthMm: 60, heightMm: 60 };

  // For every case: assert with brightnessThinning omitted, AND with brightnessThinning: 0 explicit
  // and threshold/invert present -- both must reproduce the pinned literal exactly.
  const withBrightnessOff = (mode, pitchMm, stoneSizeMm, extraOptions) => {
    const omitted = sampleFieldByMode(mode, DISC_FIELD, DISC_PLACEMENT, pitchMm, stoneSizeMm, extraOptions);
    const explicit = sampleFieldByMode(mode, DISC_FIELD, DISC_PLACEMENT, pitchMm, stoneSizeMm, { ...extraOptions, brightnessThinning: 0, threshold: 128, invert: false });
    assert.deepEqual(omitted, explicit, `${mode}: brightnessThinning omitted vs explicit 0 must be point-for-point identical`);
    return omitted;
  };

  // tools/test-img-003-organic-placement.mjs:100 -- disc, pitch 3.0mm / stoneSizeMm 2.7.
  assert.equal(withBrightnessOff('fill', 3.0, 2.7).length, 256, 'test-img-003 disc pitch3.0 grid(fill)');
  assert.equal(withBrightnessOff('staggered', 3.0, 2.7).length, 298, 'test-img-003 disc pitch3.0 staggered');
  assert.equal(withBrightnessOff('organic', 3.0, 2.7, { seed: 1, spread: 1 }).length, 182, 'test-img-003 disc pitch3.0 organic');
  assert.equal(withBrightnessOff('contour', 3.0, 2.7).length, 256, 'test-img-003 disc pitch3.0 contour');
  // tools/test-img-003-organic-placement.mjs:102 -- disc, pitch 2.2mm / stoneSizeMm 1.9.
  assert.equal(withBrightnessOff('contour', 2.2, 1.9).length, 480, 'test-img-003 disc pitch2.2 contour');

  // tools/test-img-004-edge-awareness.mjs:172 -- frame fixture, pitch 3.0mm / stoneSizeMm 2.7.
  {
    const omitted = sampleFieldByMode('contour', FRAME_FIELD, DISC_PLACEMENT, 3.0, 2.7);
    const explicit = sampleFieldByMode('contour', FRAME_FIELD, DISC_PLACEMENT, 3.0, 2.7, { brightnessThinning: 0, threshold: 128, invert: false });
    assert.deepEqual(omitted, explicit);
    assert.equal(omitted.length, 274, 'test-img-004 frame contour baseline');
  }

  // tools/test-img-005-check-and-fix.mjs:78 (NO_VIOLATION_BASELINE.disc) -- disc, pitch 3.0/2.7,
  // seed 1, spread 1, edgeThinning 1.
  assert.equal(withBrightnessOff('edge', 3.0, 2.7, { seed: 1, spread: 1, edgeThinning: 1 }).length, 48, 'test-img-005 disc edge baseline');

  // tools/test-img-005-check-and-fix.mjs:74 (PRE_FIX_BASELINE.disc.radial.count) -- disc, pitch
  // 3.0/2.7, gapMm 0.3.
  {
    const stats = { violationsFound: 0, repaired: 0, dropped: 0 };
    const omitted = sampleFieldByMode('radial', DISC_FIELD, DISC_PLACEMENT, 3.0, 2.7, { gapMm: 0.3, checkFixStats: stats });
    assert.equal(omitted.length, 245, 'test-img-005 disc radial baseline');
  }
});

await test("7. sizeMode 'brightness' throws from every non-image generate*Layout()", async () => {
  // A minimal stub satisfying the constructor's own fontProviderRegistry.getTextPath() shape check --
  // never actually called, since normalizeTextParams()'s brightness guard throws synchronously before
  // any font resolution happens.
  const engine = createGeometryEngine({ fontProviderRegistry: { getTextPath() { throw new Error('not implemented'); } } });
  const expectedMessage = /sizeMode 'brightness' \(brightness-driven stone size\) is only supported for an image layer\./;

  await assert.rejects(
    engine.generateTextLayout({ text: 'A', fontId: 'rs-block', layerId: 't1', heightMm: 45, stoneSizeMm: 2.8, sizeMode: 'brightness', brightnessSizesMm: SIZES }),
    expectedMessage
  );
  assert.throws(
    () => engine.generateShapeLayout({ shape: 'circle', layerId: 'c1', cxMm: 10, cyMm: 10, radiusMm: 20, stoneSizeMm: 2.8, sizeMode: 'brightness', brightnessSizesMm: SIZES }),
    expectedMessage
  );
  assert.throws(
    () => engine.generateSvgLayout({ svgSource: '<svg></svg>', layerId: 's1', stoneSizeMm: 2.8, sizeMode: 'brightness', brightnessSizesMm: SIZES }),
    expectedMessage
  );
  assert.throws(
    () => engine.generatePathLayout({
      contours: [[{ xMm: 0, yMm: 0 }, { xMm: 10, yMm: 0 }, { xMm: 5, yMm: 10 }]],
      layerId: 'p1', stoneSizeMm: 2.8, sizeMode: 'brightness', brightnessSizesMm: SIZES
    }),
    expectedMessage
  );
});

await test('8. brightnessSizesMm reduction to uniform (0 or 1 entries), representative mode fill', () => {
  const engine = createGeometryEngine();
  for (const brightnessSizesMm of [[], [SIZES[0]]]) {
    const brightnessLayout = buildBrightnessLayout(engine, 'fill', { brightnessSizesMm });
    const uniformLayout = engine.generateImageLayout({
      imageBuffer: createImageBuffer({ widthPx: N, heightPx: N, data: d }),
      layerId: 'img1',
      xMm: 0, yMm: 0, widthMm: W, heightMm: H,
      stoneSizeMm: SIZES[0], gapMm: GAP,
      mode: 'fill',
      threshold: THRESH,
      maxWidthPx: N, maxHeightPx: N,
      sizeMode: 'uniform'
    });
    assert.deepEqual(brightnessLayout.stones, uniformLayout.stones, `brightnessSizesMm=${JSON.stringify(brightnessSizesMm)}`);
  }
});

// Brace-balanced extraction of one function's body, the same convention
// tools/test-img-004-edge-awareness.mjs's own extractFunctionBody() uses for its own app.js
// source-text guards -- robust to the function being reformatted across lines, unlike a fixed
// end-marker slice. `signatureMarker` must include the function's own parameter list through its
// body-opening "{".
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

await test("9. App-path source-text guards: generateImageStonesLive()'s params forward brightnessSizesMm/brightnessThinning, HISTORY_TRACKED_CONTROL_IDS includes the two new control ids", () => {
  const appSrc = fs.readFileSync(new URL('../app.js', import.meta.url), 'utf8');

  const mixedSizeParamsForBody = extractFunctionBody(appSrc, 'function mixedSizeParamsFor(layer){', 'mixedSizeParamsFor()');
  assert.ok(mixedSizeParamsForBody.includes('brightnessSizesMm:'), 'mixedSizeParamsFor() is missing brightnessSizesMm');

  const generateImageStonesLiveBody = extractFunctionBody(appSrc, 'async generateImageStonesLive(layer,{includeStats=false}={}){', 'generateImageStonesLive()');
  assert.ok(generateImageStonesLiveBody.includes('...mixedSizeParamsFor(layer)'), 'generateImageStonesLive() no longer spreads mixedSizeParamsFor(layer) (brightnessSizesMm would not reach the engine)');
  assert.ok(generateImageStonesLiveBody.includes('brightnessThinning:'), 'generateImageStonesLive() is missing brightnessThinning');

  const historyTrackedMarker = 'const HISTORY_TRACKED_CONTROL_IDS=[';
  const historyTrackedStart = appSrc.indexOf(historyTrackedMarker);
  assert.ok(historyTrackedStart !== -1, 'expected to find HISTORY_TRACKED_CONTROL_IDS in app.js');
  const historyTrackedEnd = appSrc.indexOf('];', historyTrackedStart);
  assert.ok(historyTrackedEnd !== -1, 'expected to find the closing "];" of HISTORY_TRACKED_CONTROL_IDS in app.js');
  const historyTrackedSrc = appSrc.slice(historyTrackedStart, historyTrackedEnd);
  assert.ok(historyTrackedSrc.includes("'imgBrightnessSteps'"), 'HISTORY_TRACKED_CONTROL_IDS is missing imgBrightnessSteps');
  assert.ok(historyTrackedSrc.includes("'imgBrightnessThinning'"), 'HISTORY_TRACKED_CONTROL_IDS is missing imgBrightnessThinning');
});

function thirdCounts(points) {
  let dark = 0, bright = 0;
  for (const p of points) {
    if (p.xMm < 20) dark++;
    else if (p.xMm >= 40) bright++;
  }
  return { dark, bright, total: points.length };
}

await test('10. brightnessThinning thins Organic and Edge density in bright regions', () => {
  // Measured directly against this fixture at maxPitch, sampleFieldByMode() called with
  // brightnessThinning alone varying (seed 1, spread 1, edgeThinning 1, threshold THRESH,
  // invert false held fixed) -- pinned as inline literals so a later regression cannot merely
  // re-agree with whatever the code then produces.
  const BT_DENSITY = {
    organic: {
      0: { total: 137, dark: 48, bright: 48 },
      1: { total: 69, dark: 33, bright: 15 },
      3: { total: 34, dark: 24, bright: 3 }
    },
    edge: {
      0: { total: 40, dark: 13, bright: 15 },
      1: { total: 20, dark: 11, bright: 5 },
      3: { total: 9, dark: 7, bright: 0 }
    }
  };
  for (const mode of ['organic', 'edge']) {
    const measured = {};
    for (const bt of [0, 1, 3]) {
      const points = sampleFieldByMode(mode, field, placement, maxPitchMm, maxSizeMm, { seed: 1, spread: 1, edgeThinning: 1, threshold: THRESH, invert: false, brightnessThinning: bt });
      const counts = thirdCounts(points);
      const expected = BT_DENSITY[mode][bt];
      assert.equal(counts.total, expected.total, `${mode} brightnessThinning ${bt} total`);
      assert.equal(counts.dark, expected.dark, `${mode} brightnessThinning ${bt} dark third [0,20)`);
      assert.equal(counts.bright, expected.bright, `${mode} brightnessThinning ${bt} bright third [40,60)`);
      measured[bt] = counts;
    }
    assert.ok(measured[1].total < measured[0].total, `${mode}: total point count should strictly decrease from brightnessThinning 0 to 1`);
    assert.ok(measured[3].total < measured[1].total, `${mode}: total point count should strictly decrease from brightnessThinning 1 to 3`);
    const darkFractionLost = (measured[0].dark - measured[3].dark) / measured[0].dark;
    const brightFractionLost = (measured[0].bright - measured[3].bright) / measured[0].bright;
    assert.ok(
      brightFractionLost > darkFractionLost,
      `${mode}: bright third should lose a strictly larger fraction of its points than dark third at brightnessThinning 3 vs 0 (bright lost ${brightFractionLost}, dark lost ${darkFractionLost})`
    );
  }
});

await test("11. Invert path end to end (fill): brightness assigns the largest rung in the bright third, inverting item 4's coverage ordering", () => {
  const engine = createGeometryEngine();
  // threshold: 200 (item 4's own value) is unusable here -- Threshold.js's mask is "on" for
  // lum < threshold, so this fixture's "every pixel on" state at threshold 200 inverts to "every
  // pixel off" under invert: true (nothing left to sample: lum is never >= 200 on this
  // 0..199-valued gradient). threshold: 0 instead gives an "all on" mask under invert: true
  // (lum < 0 is never true pre-invert, so NOT false = on everywhere post-invert) while still
  // exercising ink()'s real invert-on branch with no divisor-guard degeneracy
  // (lum / (255 - 0), not the threshold === 255 guard case).
  const layout = engine.generateImageLayout({
    imageBuffer: createImageBuffer({ widthPx: N, heightPx: N, data: d }),
    layerId: 'img1',
    xMm: 0, yMm: 0, widthMm: W, heightMm: H,
    stoneSizeMm: SIZES[0], gapMm: GAP,
    mode: 'fill',
    threshold: 0, invert: true,
    maxWidthPx: N, maxHeightPx: N,
    sizeMode: 'brightness',
    brightnessSizesMm: SIZES
  });
  assert.equal(layout.stones.length, 196, 'invert fill assigned count');
  const invertCoverage = coverage(layout.stones);
  assert.deepEqual(invertCoverage, [0.183, 0.252, 0.509], 'invert fill coverage');
  const [darkCov, midCov, brightCov] = invertCoverage;
  assert.ok(
    darkCov < midCov && midCov < brightCov,
    `coverage should strictly increase dark -> mid -> bright under invert (got ${JSON.stringify(invertCoverage)}), the mirror of item 4's non-invert fill row (dark 0.733 > mid 0.287 > bright 0.183)`
  );
  const maxRungMm = SIZES[SIZES.length - 1];
  const darkStones = layout.stones.filter((s) => s.xMm < 20);
  const brightStones = layout.stones.filter((s) => s.xMm >= 40);
  assert.equal(darkStones.some((s) => s.sizeMm === maxRungMm), false, 'the largest rung should not appear in the dark third under invert');
  assert.equal(brightStones.some((s) => s.sizeMm === maxRungMm), true, 'the largest rung should appear in the bright third under invert');
});
