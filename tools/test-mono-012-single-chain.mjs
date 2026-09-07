// MONO-012 -- Single Chain: OpenType script fonts in the Monogram tool.
//
// Covers src/monogram/SingleChain.js (pure sizing arithmetic) and the OpenType branch of
// src/monogram/MonogramGenerator.generate(). Real repository fonts + frames are used for the
// pipeline cases (same precedent as test-mono-005-headless-monogram-generator.mjs).
//
// Manifest stemWidthRatio values cited inline: great-vibes-regular 0.0357, alex-brush-regular
// 0.0309, cookie-regular 0.0456, caveat-regular 0.0443 (assets/fonts/manifest.json).

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FontManager } from '../src/fonts/index.js';
import { createDefaultFontProviderRegistry } from '../src/text/index.js';
import { GeometryEngine } from '../src/geometry/index.js';
import {
  MonogramGenerator,
  MONOGRAM_GENERATOR_FAILURE_REASONS,
  MONOGRAM_MAX_STEM_WIDTH_RATIO,
  SINGLE_CHAIN_MIN_RATIO,
  SINGLE_CHAIN_MAX_RATIO,
  singleChainHeightMm,
  stemStones,
  minChainStones,
  isMonogramEligibleStemWidthRatio
} from '../src/monogram/index.js';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const manifest = JSON.parse(await readFile(path.join(repoRoot, 'assets/fonts/manifest.json'), 'utf8'));
const fontManager = new FontManager(manifest);

async function loadFontBufferFromRepoRoot(relativePath) {
  const buffer = await readFile(path.join(repoRoot, relativePath));
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
}

function createRealGenerator() {
  const fontProviderRegistry = createDefaultFontProviderRegistry(fontManager, { loadFontBuffer: loadFontBufferFromRepoRoot });
  const geometryEngine = new GeometryEngine({ fontProviderRegistry });
  return { geometryEngine, generator: new MonogramGenerator({ geometryEngine }) };
}

const CANVAS_MM = { widthMm: 200, heightMm: 200 };
const EPS = 1e-9;

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

// ---------------------------------------------------------------------------
// 1. Arithmetic against hand-computed values.
// ---------------------------------------------------------------------------

await test('singleChainHeightMm: Great Vibes (0.0357) at SS6 (2.0 mm) = 47.619047619047619 mm', () => {
  assert.ok(Math.abs(singleChainHeightMm({ stoneSizeMm: 2.0, stemWidthRatio: 0.0357 }) - 47.619047619047619) < EPS);
});

await test('singleChainHeightMm: Alex Brush (0.0309) at SS10 (2.8 mm) = 77.022653721682848 mm', () => {
  assert.ok(Math.abs(singleChainHeightMm({ stoneSizeMm: 2.8, stemWidthRatio: 0.0309 }) - 77.022653721682848) < EPS);
});

await test('stemStones: Cookie (0.0456) at 40 mm / 2.0 mm stones = 0.912', () => {
  assert.ok(Math.abs(stemStones({ heightMm: 40, stoneSizeMm: 2.0, stemWidthRatio: 0.0456 }) - 0.912) < EPS);
});

await test('minChainStones: Cookie (0.0456) -> 0.7296 (readability floor binds)', () => {
  assert.ok(Math.abs(minChainStones({ stemWidthRatio: 0.0456 }) - 0.7296) < EPS);
});

await test('minChainStones: Great Vibes (0.0357) -> 0.70 (chain minimum binds; floor would be 0.5712)', () => {
  assert.ok(Math.abs(minChainStones({ stemWidthRatio: 0.0357 }) - 0.70) < EPS);
  assert.ok(Math.abs(16 * 0.0357 - 0.5712) < EPS);
});

// ---------------------------------------------------------------------------
// 2. Eligibility.
// ---------------------------------------------------------------------------

await test('MONOGRAM_MAX_STEM_WIDTH_RATIO === 0.053125 (0.85 / 16)', () => {
  assert.equal(MONOGRAM_MAX_STEM_WIDTH_RATIO, 0.053125);
});

await test('runtime-derived eligible OpenType set is exactly the 9 fonts in the MONO-012 table', () => {
  const eligible = fontManager.listFonts()
    .filter((f) => f.providerId !== 'rhinestone' && isMonogramEligibleStemWidthRatio(f.stemWidthRatio))
    .map((f) => f.id)
    .sort();
  assert.deepEqual(eligible, [
    'alex-brush-regular',
    'allura-regular',
    'caveat-regular',
    'cinzel-regular',
    'cookie-regular',
    'dancing-script-regular',
    'great-vibes-regular',
    'parisienne-regular',
    'sacramento-regular'
  ]);
});

await test('the five near-threshold script fonts are rejected (Pacifico, Kaushan Script, Mr Dafoe, Yellowtail, Satisfy)', () => {
  for (const id of ['pacifico-regular', 'kaushan-script-regular', 'mr-dafoe-regular', 'yellowtail-regular', 'satisfy-regular']) {
    const font = fontManager.getFont(id);
    assert.equal(isMonogramEligibleStemWidthRatio(font.stemWidthRatio), false, `${id} (${font.stemWidthRatio}) must be ineligible`);
  }
});

await test('a font with stemWidthRatio null / non-numeric / zero / negative is ineligible', () => {
  for (const bad of [null, undefined, NaN, Infinity, 0, -0.01, '0.03']) {
    assert.equal(isMonogramEligibleStemWidthRatio(bad), false);
  }
});

// ---------------------------------------------------------------------------
// 3. Happy path.
// ---------------------------------------------------------------------------

await test('Great Vibes / single / circle / 80 mm / SS6 -> ok, single-chain stem, persisted height == fittedHeightMm', async () => {
  const { generator } = createRealGenerator();
  const result = await generator.generate({
    frameId: 'circle', layoutId: 'single', letters: ['A'],
    fontId: 'great-vibes-regular', providerId: 'opentype', stemWidthRatio: 0.0357,
    stoneSizeMm: 2.0, color: 'gold', canvasMm: CANVAS_MM,
    frameRect: { xMm: 0, yMm: 0, widthMm: 80, heightMm: 80 }
  });
  assert.equal(result.ok, true, result.message);
  const m = result.measurements.letters[0];
  assert.ok(m.stemStones >= SINGLE_CHAIN_MIN_RATIO && m.stemStones <= SINGLE_CHAIN_MAX_RATIO,
    `stemStones ${m.stemStones} should be within [${SINGLE_CHAIN_MIN_RATIO}, ${SINGLE_CHAIN_MAX_RATIO}]`);
  const letterLayer = result.layers.find((l) => l.type === 'text');
  assert.equal(letterLayer.height, m.fittedHeightMm);
  assert.equal(letterLayer.heightMode, 'raw');
  assert.equal(letterLayer.authoredScale, undefined);
  assert.equal(letterLayer.textMode, 'stroke');
});

// ---------------------------------------------------------------------------
// 4. Round-trip: a live render of the emitted layer reproduces the generator's fitted geometry.
//
// The params are rebuilt from the emitted layer object the way app.js's buildTextLayoutBaseParams()
// does -- in particular `mode` is derived from letterLayer.textMode (not hard-coded), so the check
// exercises the exact same field->param mapping the live pipeline uses. It compares against the
// generator's own recorded fitted bounding box (BoundingBox.toJSON() rounds to 6 dp, hence the
// 1e-6 tolerance) and stone count. The NEGATIVE CONTROL regenerates at
// height = scaledBoundingBox.heightMm -- the wrong value the emitted layer must NOT hold -- and
// asserts the geometry diverges; without it this test would pass even if the OpenType branch
// (re)introduced the authored branch's `height: r.scaledBoundingBox.heightMm` substitution, which
// is precisely the regression MONO-012 exists to prevent.
// ---------------------------------------------------------------------------

// app.js:658 TEXT_MODE_TO_ENGINE_MODE / resolveTextFillMode() -- mirrored, not imported (app.js is
// not importable from a Node test).
const TEXT_MODE_TO_ENGINE_MODE = { stroke: 'outline', fill: 'fill', staggered: 'staggered', radial: 'radial', contour: 'contour' };
function engineParamsFromEmittedLayer(letterLayer) {
  return {
    text: letterLayer.text,
    fontId: letterLayer.font,
    providerId: 'opentype',
    layerId: letterLayer.id,
    heightMm: letterLayer.height,
    stoneSizeMm: letterLayer.stoneSize,
    gapMm: letterLayer.gap,
    mode: TEXT_MODE_TO_ENGINE_MODE[letterLayer.textMode] || 'outline',
    color: letterLayer.color,
    curveEnabled: false
  };
}

await test('a live render of each emitted OpenType letter reproduces the generator\'s fitted geometry (with a negative control)', async () => {
  const { geometryEngine, generator } = createRealGenerator();
  const result = await generator.generate({
    frameId: 'circle', layoutId: 'single', letters: ['A'],
    fontId: 'great-vibes-regular', providerId: 'opentype', stemWidthRatio: 0.0357,
    stoneSizeMm: 2.0, color: 'gold', canvasMm: CANVAS_MM,
    frameRect: { xMm: 0, yMm: 0, widthMm: 80, heightMm: 80 }
  });
  assert.equal(result.ok, true, result.message);

  const JSON_EPS = 1e-6;
  for (const letterLayer of result.layers.filter((l) => l.type === 'text')) {
    const m = result.measurements.letters.find((x) => x.layerId === letterLayer.id);
    const params = engineParamsFromEmittedLayer(letterLayer);
    assert.equal(params.mode, 'outline', 'stroke textMode maps to outline (mapping, not literal)');

    const regen = await geometryEngine.generateTextLayout(params);
    const box = regen.getBoundingBox();
    assert.equal(regen.stones.length, m.stoneCount, 'stone count matches the generator\'s fitted layout');
    assert.ok(Math.abs(box.widthMm - m.scaledBoundingBox.widthMm) < JSON_EPS, 'bbox width matches measurements');
    assert.ok(Math.abs(box.heightMm - m.scaledBoundingBox.heightMm) < JSON_EPS, 'bbox height matches measurements');
    assert.ok(Math.abs(box.minXmm - m.scaledBoundingBox.minXmm) < JSON_EPS, 'bbox minX (=> centre) matches measurements');
    assert.ok(Math.abs(box.minYmm - m.scaledBoundingBox.minYmm) < JSON_EPS, 'bbox minY (=> centre) matches measurements');

    // Negative control: the emitted height must be the fitted em-square heightMm, NOT the stone
    // bounding-box height. Regenerating at the latter must produce visibly different geometry, or
    // this test cannot detect that substitution.
    assert.notEqual(letterLayer.height, m.scaledBoundingBox.heightMm,
      'sanity: the two candidate height values must actually differ for the control to be meaningful');
    const wrong = await geometryEngine.generateTextLayout({ ...params, heightMm: m.scaledBoundingBox.heightMm });
    const wrongBox = wrong.getBoundingBox();
    assert.ok(
      wrong.stones.length !== regen.stones.length
      || Math.abs(wrongBox.heightMm - box.heightMm) > JSON_EPS
      || Math.abs(wrongBox.widthMm - box.widthMm) > JSON_EPS,
      'regenerating at scaledBoundingBox.heightMm must NOT reproduce the fitted geometry'
    );
  }
});

// ---------------------------------------------------------------------------
// 5. Failure path: chain minimum binds.
// ---------------------------------------------------------------------------

await test('Great Vibes / traditional-three / 60 mm / SS10 -> CHAIN_TOO_THIN (single-chain minimum binds)', async () => {
  // Verified with a scratch sweep: a Great Vibes capital A shrunk into Traditional Three's side slot
  // at this frame size falls well under 0.70 stones across the stem (its readability floor would be
  // only 0.5712, so the 0.70 chain minimum is the binding bound).
  const { generator } = createRealGenerator();
  const result = await generator.generate({
    frameId: 'rounded-square', layoutId: 'traditional-three', letters: ['A', 'B', 'C'],
    fontId: 'great-vibes-regular', providerId: 'opentype', stemWidthRatio: 0.0357,
    stoneSizeMm: 2.8, color: 'gold', canvasMm: CANVAS_MM,
    frameRect: { xMm: 0, yMm: 0, widthMm: 60, heightMm: 60 }
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, MONOGRAM_GENERATOR_FAILURE_REASONS.CHAIN_TOO_THIN);
  assert.match(result.message, /single-chain minimum/);
  assert.equal(result.diagnostics.boundThatBound, 'single-chain-minimum');
});

// ---------------------------------------------------------------------------
// 6. Failure path: the readability floor binds (Cookie, ratio above 0.04375).
// ---------------------------------------------------------------------------

await test('Cookie / single / square / 38 mm / SS10 -> CHAIN_TOO_THIN naming the readability floor as the binding bound', async () => {
  // Verified with a scratch sweep (tools/scratch/mono-012-sweep.mjs): at this frame size the fitted
  // "A" lands at ~0.707 stones across the stem -- above the 0.70 chain minimum but below Cookie's
  // readability floor of 16 * 0.0456 = 0.7296, so the floor is the binding bound.
  const { generator } = createRealGenerator();
  const result = await generator.generate({
    frameId: 'square', layoutId: 'single', letters: ['A'],
    fontId: 'cookie-regular', providerId: 'opentype', stemWidthRatio: 0.0456,
    stoneSizeMm: 2.8, color: 'gold', canvasMm: CANVAS_MM,
    frameRect: { xMm: 0, yMm: 0, widthMm: 38, heightMm: 38 }
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, MONOGRAM_GENERATOR_FAILURE_REASONS.CHAIN_TOO_THIN);
  assert.match(result.message, /readability floor/);
  assert.equal(result.diagnostics.boundThatBound, 'readability-floor');
  assert.ok(result.diagnostics.achievedStemStones > SINGLE_CHAIN_MIN_RATIO,
    'this case must sit above the flat 0.70 minimum, so it proves the floor (not 0.70) is what bound');
});

// ---------------------------------------------------------------------------
// 7. Missing stemWidthRatio for an OpenType font.
// ---------------------------------------------------------------------------

await test('an OpenType font with no request.stemWidthRatio is rejected INVALID_FONT naming the field', async () => {
  const { generator } = createRealGenerator();
  const result = await generator.generate({
    frameId: 'circle', layoutId: 'single', letters: ['A'],
    fontId: 'great-vibes-regular', providerId: 'opentype', stemWidthRatio: null,
    stoneSizeMm: 2.0, color: 'gold', canvasMm: CANVAS_MM,
    frameRect: { xMm: 0, yMm: 0, widthMm: 80, heightMm: 80 }
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, MONOGRAM_GENERATOR_FAILURE_REASONS.INVALID_FONT);
  assert.match(result.message, /stemWidthRatio/);
});

// ---------------------------------------------------------------------------
// 8. Authored regression: RS Block traditional-three is byte-identical to the pre-milestone
//    baseline captured from develop (tools/scratch/mono-012-baseline.mjs) before branching.
// ---------------------------------------------------------------------------

await test('RS Block / traditional-three is byte-identical to the pre-MONO-012 baseline', async () => {
  const { generator } = createRealGenerator();
  const result = await generator.generate({
    frameId: 'rounded-square', layoutId: 'traditional-three', letters: ['A', 'B', 'C'],
    fontId: 'rs-block', providerId: 'rhinestone',
    stoneSizeMm: 2.8, color: 'gold', canvasMm: CANVAS_MM,
    frameRect: { xMm: 0, yMm: 0, widthMm: 100, heightMm: 100 }
  });
  assert.equal(result.ok, true);
  assert.equal(result.measurements.totalStoneCount, 300);
  assert.equal(result.measurements.frameStoneCount, 249);

  // measurements.letters is in slot-index order: A, B, C.
  assert.deepEqual(result.measurements.letters.map((m) => [m.letter, m.stoneCount]), [['A', 18], ['B', 20], ['C', 13]]);
  assert.deepEqual(result.measurements.letters.map((m) => m.requestedScale),
    [1.3181659330428201, 2.218339087287241, 1.3181659330428201]);
  assert.deepEqual(result.measurements.letters.map((m) => [m.xMm, m.yMm]), [
    [-78.68991434128239, -50],
    [-50, -50],
    [-21.310085658717625, -50]
  ]);
  // Authored letters carry no single-chain axis.
  assert.deepEqual(result.measurements.letters.map((m) => [m.fittedHeightMm, m.stemStones]),
    [[null, null], [null, null], [null, null]]);

  // Emitted layers: frame + letters ordered by drawOrder (A, C, B).
  const letters = result.layers.filter((l) => l.type === 'text');
  assert.deepEqual(letters.map((l) => l.text), ['A', 'C', 'B']);
  for (const l of letters) {
    assert.equal(l.authoredScale !== undefined, true, 'authored letters keep authoredScale');
    assert.equal(l.heightMode, undefined, 'authored letters do not emit heightMode');
  }
  const byText = Object.fromEntries(letters.map((l) => [l.text, l]));
  assert.equal(byText.A.authoredScale, 1.3181659330428201);
  assert.equal(byText.B.authoredScale, 2.218339087287241);
  assert.equal(byText.A.height, 27.317886354596453);
  assert.equal(byText.B.height, 44.06110702354268);
  assert.equal(byText.A.x, -78.68991434128239);
  assert.equal(byText.B.x, -50);
});

if (process.exitCode) {
  console.error('\nMONO-012 single-chain tests FAILED.');
} else {
  console.log('\nAll MONO-012 single-chain tests passed.');
}
