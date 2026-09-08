// MONO-014: Frame hierarchy and "no frame".
//
// Covers:
//  - defaultFrameStoneSizeMm() -- imported directly (a shared module function; READ-009 situation,
//    not the MONO-011 slice-out-of-app.js one).
//  - frameId: 'none' through the real MonogramGenerator + real GeometryEngine.
//  - generateMonogramWithFrameAutoShrink() (sliced verbatim from app.js, test-mono-011's factory
//    pattern) never retrying into an equal-weight frame stone size, with a negative control that
//    shows an unfiltered candidate list *does* produce the equal-weight retry.
//  - the request builder's frameOptions block (sliced) deriving the automatic-hierarchy frame stone
//    size when the MONO-010 toggle is unchecked, and passing the field value through when checked.

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { GeometryEngine } from '../src/geometry/index.js';
import { MonogramGenerator, MONOGRAM_LAYOUTS, MONOGRAM_GENERATOR_FAILURE_REASONS, defaultFrameStoneSizeMm, singleChainHeightMm } from '../src/monogram/index.js';
import { FontManager } from '../src/fonts/index.js';
import { createDefaultFontProviderRegistry } from '../src/text/index.js';
import { listStoneSizes } from '../src/renderer/StoneSizes.js';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
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

// ============================================================================================
// 1. defaultFrameStoneSizeMm() -- every rung, plus a negative control
// ============================================================================================

await test('defaultFrameStoneSizeMm(): every catalog rung steps up to the next larger diameter', () => {
  assert.equal(defaultFrameStoneSizeMm(2.0), 2.8);
  assert.equal(defaultFrameStoneSizeMm(2.8), 4.0);
  assert.equal(defaultFrameStoneSizeMm(4.0), 4.7);
  assert.equal(defaultFrameStoneSizeMm(4.7), 6.4);
  assert.equal(defaultFrameStoneSizeMm(6.4), 6.4); // already at the top -> the largest
});

await test('defaultFrameStoneSizeMm(): negative control -- the rung assertion discriminates (2.0 does NOT map to 2.0)', () => {
  assert.notEqual(defaultFrameStoneSizeMm(2.0), 2.0);
  // Prove the assertion FORM used in the test above would actually fail for a wrong expectation,
  // so a future regression that made this a no-op could not pass silently.
  assert.throws(() => assert.equal(defaultFrameStoneSizeMm(2.0), 2.0));
});

// ============================================================================================
// Real MonogramGenerator + real GeometryEngine (test-mono-011 lines 74-86 recipe)
// ============================================================================================

const manifest = JSON.parse(await readFile(path.join(repoRoot, 'assets/fonts/manifest.json'), 'utf8'));
const fontManager = new FontManager(manifest);
async function loadFontBufferFromRepoRoot(relativePath) {
  const buffer = await readFile(path.join(repoRoot, relativePath));
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
}
const fontProviderRegistry = createDefaultFontProviderRegistry(fontManager, { loadFontBuffer: loadFontBufferFromRepoRoot });
const realEngine = new GeometryEngine({ fontProviderRegistry });
const realGenerator = new MonogramGenerator({ geometryEngine: realEngine });

const REAL_CANVAS_MM = { widthMm: 220, heightMm: 220 };
const LETTER_STONE_SIZE_MM = 2.0; // SS6

// Read straight from the shipped manifest -- never hardcode the ratio (test-mono-012 does hardcode
// it inline, but here the point is that the value the generator sees is the value the app ships).
const GREAT_VIBES_STEM_WIDTH_RATIO = manifest.fonts.find((f) => f.id === 'great-vibes-regular').stemWidthRatio;

function baseRequest(overrides = {}) {
  return {
    frameId: 'circle', layoutId: MONOGRAM_LAYOUTS.SINGLE, letters: ['A'],
    fontId: 'rs-block', providerId: 'rhinestone',
    stoneSizeMm: LETTER_STONE_SIZE_MM, color: 'gold',
    frameRect: { xMm: 70, yMm: 70, widthMm: 80, heightMm: 80 },
    canvasMm: REAL_CANVAS_MM,
    frameOptions: {},
    ...overrides
  };
}

// ============================================================================================
// 2. frameId: 'none'
// ============================================================================================

await test("frameId 'none': emits no frame layer, a larger letter fitting region than circle, frame/frameHierarchy null", async () => {
  const withNone = await realGenerator.generate(baseRequest({ frameId: 'none' }));
  const withCircle = await realGenerator.generate(baseRequest({ frameId: 'circle' }));

  assert.equal(withNone.ok, true, withNone.message);
  assert.equal(withCircle.ok, true, withCircle.message);

  // No frame-role layer at all.
  assert.equal(withNone.layers.filter((l) => l.type === 'path').length, 0, 'no path/frame layer');
  assert.ok(!withNone.layers.some((l) => /-frame$/.test(l.id)), 'no frame-role layer id');
  assert.equal(withNone.measurements.frameStoneCount, 0);

  const noneText = withNone.layers.filter((l) => l.type === 'text');
  const circleText = withCircle.layers.filter((l) => l.type === 'text');
  assert.equal(noneText.length, circleText.length, 'same letter (text) layer count');
  assert.equal(noneText.length, 1);

  // The quantity that genuinely responds to the fitting region: 'none' fits the letter into the
  // full 80mm frameRect, circle into the clearance-eroded inscribed region, so 'none' fits the
  // authored letter at a strictly larger authoredScale. (Authored-font stone COUNT is
  // scale-invariant -- scaleAuthoredTextLayout() moves positions only -- so a stoneCount equality
  // here would pass no matter what this branch did; requestedScale is what can actually differ.)
  assert.ok(
    withNone.measurements.letters[0].requestedScale > withCircle.measurements.letters[0].requestedScale,
    `expected 'none' to fit the letter larger than circle (none ${withNone.measurements.letters[0].requestedScale} vs circle ${withCircle.measurements.letters[0].requestedScale})`
  );

  assert.equal(withNone.measurements.frame, null, 'measurements.frame === null with no frame');
  assert.equal(withNone.measurements.frameHierarchy, null, 'measurements.frameHierarchy === null with no frame');
});

await test("frameId 'none': the interior is the frameRect itself (letters still collision-checked against each other)", async () => {
  const res = await realGenerator.generate(baseRequest({ frameId: 'none', layoutId: MONOGRAM_LAYOUTS.TWO_LETTER, letters: ['A', 'B'] }));
  assert.equal(res.ok, true, res.message);
  assert.deepEqual(res.measurements.frameInteriorRect, {
    xMm: 70, yMm: 70, widthMm: 80, heightMm: 80
  });
  assert.equal(res.measurements.frameHierarchy, null);
});

await test("frameId 'none': the OpenType single-chain path -- a larger fitting region turns CHAIN_TOO_THIN into a success", async () => {
  // Authored fonts are the one case where "No frame" cannot change the output (stone positions/count
  // are scale-invariant), so the tests above run on the path least able to detect a defect. The
  // OpenType single-chain path is where a larger fitting region actually changes the result -- the
  // letter is regenerated at a larger heightMm, so its stem carries more stones. This is also the
  // path MONO-013 builds on.
  const openTypeRequest = {
    fontId: 'great-vibes-regular', providerId: 'opentype',
    stemWidthRatio: GREAT_VIBES_STEM_WIDTH_RATIO,
    layoutId: MONOGRAM_LAYOUTS.SINGLE, letters: ['A'],
    stoneSizeMm: 2.8,
    frameRect: { xMm: 60, yMm: 60, widthMm: 80, heightMm: 80 },
    canvasMm: { widthMm: 200, heightMm: 200 },
    frameOptions: { stoneSizeMm: 4.0 }
  };

  const withCircle = await realGenerator.generate({ ...openTypeRequest, frameId: 'circle' });
  assert.equal(withCircle.ok, false, 'circle: expected the single chain to be too thin for the eroded interior');
  assert.equal(withCircle.reason, MONOGRAM_GENERATOR_FAILURE_REASONS.CHAIN_TOO_THIN);

  const withNone = await realGenerator.generate({ ...openTypeRequest, frameId: 'none' });
  assert.equal(withNone.ok, true, withNone.message);
  assert.equal(withNone.measurements.frame, null);
  assert.equal(withNone.measurements.frameHierarchy, null);

  // In the full 80mm "none" region the chain does not need to shrink: it fits at its ideal
  // single-chain height. Asserted against the formula (not a pasted literal) because the observed
  // value is singleChainHeightMm()'s exact double and a 16-digit equality would be fragile to a
  // 1-ULP difference. (The MONO-014 follow-up reviewer stated 66.66666666666667 for this; the
  // generator here produces 66.66666666666666 == SINGLE_CHAIN_STEM_RATIO*2.8/ratio exactly, one ULP
  // below 200/3 -- a decimal-transcription-level difference, not a reconstruction difference; the
  // stoneCount below matches the reviewer exactly.)
  const idealHeightMm = singleChainHeightMm({ stoneSizeMm: 2.8, stemWidthRatio: GREAT_VIBES_STEM_WIDTH_RATIO });
  assert.ok(
    Math.abs(withNone.measurements.letters[0].fittedHeightMm - idealHeightMm) < 1e-9,
    `fittedHeightMm ${withNone.measurements.letters[0].fittedHeightMm} should be the un-shrunk ideal single-chain height ${idealHeightMm}`
  );
  assert.equal(withNone.measurements.letters[0].stoneCount, 109);
});

// ============================================================================================
// 3. measurements.frameHierarchy classification (with a frame)
// ============================================================================================

await test('measurements.frameHierarchy: dominant / subordinate / equal reflect the applied frame stone size vs the letters', async () => {
  const dominant = await realGenerator.generate(baseRequest({ frameId: 'circle', frameOptions: { stoneSizeMm: 2.8 } }));
  const subordinate = await realGenerator.generate(baseRequest({ frameId: 'circle', stoneSizeMm: 2.8, frameRect: { xMm: 60, yMm: 60, widthMm: 100, heightMm: 100 }, frameOptions: { stoneSizeMm: 2.0 } }));
  const equal = await realGenerator.generate(baseRequest({ frameId: 'circle', frameOptions: { stoneSizeMm: 2.0 } }));

  assert.equal(dominant.ok, true, dominant.message);
  assert.equal(dominant.measurements.frameHierarchy, 'dominant');
  assert.equal(subordinate.ok, true, subordinate.message);
  assert.equal(subordinate.measurements.frameHierarchy, 'subordinate');
  assert.equal(equal.ok, true, equal.message);
  assert.equal(equal.measurements.frameHierarchy, 'equal', 'a deliberately-matched size is the only way to reach equal');
});

// ============================================================================================
// 4. Auto-shrink never yields equal weight -- with a negative control that proves the teeth
// ============================================================================================

function sliceBetween(source, startMarker, endMarker, label) {
  const start = source.indexOf(startMarker);
  assert.ok(start !== -1, `expected "${startMarker}" (${label}) in app.js`);
  const end = source.indexOf(endMarker, start);
  assert.ok(end !== -1, `expected the end of ${label} in app.js`);
  return source.slice(start, end);
}

const wrapperSrc = sliceBetween(
  appJs,
  'async function generateMonogramWithFrameAutoShrink(request){',
  '\nasync function generateMonogram(){',
  'generateMonogramWithFrameAutoShrink()'
);
function buildWrapper(monogramGenerator) {
  const factory = new Function(
    'monogramGenerator', 'listStoneSizes', 'MONOGRAM_GENERATOR_FAILURE_REASONS',
    `${wrapperSrc}\nreturn generateMonogramWithFrameAutoShrink;`
  );
  return factory(monogramGenerator, listStoneSizes, MONOGRAM_GENERATOR_FAILURE_REASONS);
}
function makeCountingGenerator(real) {
  const calls = [];
  return {
    calls,
    async generate(request) {
      calls.push(request);
      return real.generate(request);
    }
  };
}

// A locally reconstructed auto-shrink whose candidate list is NOT filtered against the letters'
// own diameter -- the pre-MONO-014 behaviour. If the shipped filter had no effect, this and the
// real wrapper would agree; the point of the control is that they must NOT.
async function unfilteredAutoShrink(real, request) {
  const R = MONOGRAM_GENERATOR_FAILURE_REASONS;
  const first = await real.generate(request);
  if (first.ok || (first.reason !== R.FRAME_COLLISION && first.reason !== R.STONE_WIDTH_UNAVAILABLE)) {
    return { result: first, appliedFrameStoneSizeMm: null };
  }
  const requested = request.frameOptions.stoneSizeMm;
  const candidates = listStoneSizes().map((s) => s.diameterMm).filter((d) => d < requested).sort((a, b) => b - a);
  for (const candidate of candidates) {
    const retry = await real.generate({ ...request, frameOptions: { ...request.frameOptions, stoneSizeMm: candidate } });
    if (retry.ok) return { result: retry, appliedFrameStoneSizeMm: candidate };
    if (retry.reason !== R.FRAME_COLLISION && retry.reason !== R.STONE_WIDTH_UNAVAILABLE) {
      return { result: first, appliedFrameStoneSizeMm: null };
    }
  }
  return { result: first, appliedFrameStoneSizeMm: null };
}

// Probed against the real generator (tools/test-mono-014 exploration): a 72x72mm square frame,
// SINGLE 'M', SS6 letters -- a 2.8mm frame stone (the automatic-hierarchy default) collides with
// the letter (FRAME_COLLISION), while a 2.0mm frame stone (equal to the letters') does not. This is
// exactly the SS6 dead-end MONO-014 documents: the only frame stone size that would "fit" is the
// letters' own, i.e. equal weight.
function ss6DeadEndRequest() {
  const w = 72;
  return {
    frameId: 'square', layoutId: MONOGRAM_LAYOUTS.SINGLE, letters: ['M'],
    fontId: 'rs-block', providerId: 'rhinestone',
    stoneSizeMm: LETTER_STONE_SIZE_MM, color: 'gold',
    frameRect: { xMm: (REAL_CANVAS_MM.widthMm - w) / 2, yMm: (REAL_CANVAS_MM.heightMm - w) / 2, widthMm: w, heightMm: w },
    canvasMm: REAL_CANVAS_MM,
    frameOptions: { stoneSizeMm: 2.8, color: 'silver' }
  };
}

await test('auto-shrink: negative control -- an UNFILTERED candidate list retries the SS6 dead-end into equal weight', async () => {
  const request = ss6DeadEndRequest();

  // Sanity: 2.8mm collides, 2.0mm (equal weight) does not.
  const at28 = await realGenerator.generate(request);
  assert.equal(at28.ok, false);
  assert.equal(at28.reason, MONOGRAM_GENERATOR_FAILURE_REASONS.FRAME_COLLISION);
  const at20 = await realGenerator.generate({ ...request, frameOptions: { ...request.frameOptions, stoneSizeMm: 2.0 } });
  assert.equal(at20.ok, true, at20.message);

  const unfiltered = await unfilteredAutoShrink(realGenerator, request);
  assert.equal(unfiltered.result.ok, true, 'the pre-MONO-014 behaviour succeeds here');
  assert.equal(unfiltered.appliedFrameStoneSizeMm, LETTER_STONE_SIZE_MM, 'and it lands on the letters\' own size -- equal weight');
  assert.equal(unfiltered.result.measurements.frameHierarchy, 'equal', 'which measurements.frameHierarchy correctly reports as equal');
});

await test('auto-shrink: the shipped wrapper filters the letters\' diameter out, so the SS6 dead-end fails instead of landing on equal weight', async () => {
  const request = ss6DeadEndRequest();
  const counting = makeCountingGenerator(realGenerator);
  const wrapper = buildWrapper(counting);

  const { result, appliedFrameStoneSizeMm } = await wrapper(request);

  assert.equal(result.ok, false, 'the SS6 dead-end now fails rather than retrying into equal weight');
  assert.equal(result.reason, MONOGRAM_GENERATOR_FAILURE_REASONS.FRAME_COLLISION);
  assert.equal(appliedFrameStoneSizeMm, null);

  // Every frame stone size the generator was actually asked for differs from the letters' own.
  assert.ok(counting.calls.length >= 1);
  for (const call of counting.calls) {
    assert.ok(
      Math.abs(call.frameOptions.stoneSizeMm - request.stoneSizeMm) > 1e-6,
      `every observed frame stone size must differ from the letters' ${request.stoneSizeMm} (got ${call.frameOptions.stoneSizeMm})`
    );
  }
});

await test('auto-shrink: an ordinary FRAME_COLLISION with catalog headroom still retries down to a non-equal size and succeeds', async () => {
  // test-mono-011's own scenario: square 60x60, SS6 letters, requested frame stone 6.4mm -> retries
  // to 4.7mm. 2.0mm (the letters' size) would be filtered out, but the retry lands well above it.
  const counting = makeCountingGenerator(realGenerator);
  const wrapper = buildWrapper(counting);
  const request = {
    frameId: 'square', layoutId: MONOGRAM_LAYOUTS.SINGLE, letters: ['A'],
    fontId: 'rs-block', providerId: 'rhinestone',
    stoneSizeMm: LETTER_STONE_SIZE_MM, color: 'gold',
    frameRect: { xMm: 80, yMm: 80, widthMm: 60, heightMm: 60 },
    canvasMm: REAL_CANVAS_MM,
    frameOptions: { stoneSizeMm: 6.4, color: 'silver' }
  };
  const { result, appliedFrameStoneSizeMm } = await wrapper(request);
  assert.equal(result.ok, true, result.message);
  assert.equal(appliedFrameStoneSizeMm, 4.7);
  assert.ok(Math.abs(appliedFrameStoneSizeMm - request.stoneSizeMm) > 1e-6, 'never equal weight');
  assert.equal(result.measurements.frameHierarchy, 'dominant');
});

// ============================================================================================
// 5. Request builder frameOptions block (sliced) -- toggle branch
// ============================================================================================

const frameOptionsBlockSrc = sliceBetween(
  appJs,
  "const frameStyle=el('monogramFrameStyle').value;",
  "\n  // MONO-012: the generator needs the font's measured stroke-width",
  'buildMonogramRequest() frameOptions block'
);
function runFrameOptionsBlock({ toggleChecked, frameStoneFieldValue = '4.0', stoneSizeMm, frameStyle = 'fill', frameColor = 'silver' }) {
  const elById = {
    monogramFrameStyle: { value: frameStyle },
    monogramFrameStoneToggle: { checked: toggleChecked },
    monogramFrameStoneSize: { value: String(frameStoneFieldValue) },
    monogramFrameColor: { value: frameColor }
  };
  const el = (id) => elById[id];
  const factory = new Function(
    'el', 'defaultFrameStoneSizeMm', 'stoneSizeMm',
    `${frameOptionsBlockSrc}\nreturn frameOptions;`
  );
  return factory(el, defaultFrameStoneSizeMm, stoneSizeMm);
}

await test('request builder: toggle UNCHECKED derives the frame stone size one rung above the letters (SS6 -> 2.8, SS30 -> 6.4)', () => {
  assert.equal(runFrameOptionsBlock({ toggleChecked: false, stoneSizeMm: 2.0 }).stoneSizeMm, 2.8);
  assert.equal(runFrameOptionsBlock({ toggleChecked: false, stoneSizeMm: 6.4 }).stoneSizeMm, 6.4);
  // No color key when unchecked -- the generator's own fallback applies.
  assert.equal('color' in runFrameOptionsBlock({ toggleChecked: false, stoneSizeMm: 2.0 }), false);
});

await test('request builder: toggle CHECKED passes the visible field value through unchanged', () => {
  const fo = runFrameOptionsBlock({ toggleChecked: true, frameStoneFieldValue: '4.7', stoneSizeMm: 2.0, frameColor: 'aurora' });
  assert.equal(fo.stoneSizeMm, 4.7);
  assert.equal(fo.color, 'aurora');
});

console.log('MONO-014 (Frame hierarchy and "no frame") tests passed.');
