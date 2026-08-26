// MONO-011: Monogram frame stone auto-shrink.
//
// UI-layer-only retry loop (app.js's generateMonogramWithFrameAutoShrink(), called from
// generateMonogram()) that retries MonogramGenerator.generate() with progressively smaller
// frameOptions.stoneSizeMm candidates after a FRAME_COLLISION/STONE_WIDTH_UNAVAILABLE failure.
// MonogramGenerator itself keeps its "never auto-corrects" doctrine (see its own doc comment) --
// this test slices generateMonogramWithFrameAutoShrink() verbatim out of the real app.js source
// (same "real execution, not reimplementation" convention tools/test-mono-006-monogram-ui.mjs
// already established for this file) and drives it against a real MonogramGenerator + real
// GeometryEngine, so a pass here really does prove the shipped retry logic works end to end.

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { GeometryEngine } from '../src/geometry/index.js';
import { MonogramGenerator, MONOGRAM_LAYOUTS, MONOGRAM_GENERATOR_FAILURE_REASONS } from '../src/monogram/index.js';
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

// ---------- Slice the real generateMonogramWithFrameAutoShrink() out of app.js ----------

function sliceBetween(source, startMarker, endMarker, label) {
  const start = source.indexOf(startMarker);
  assert.ok(start !== -1, `expected to find "${startMarker}" (${label}) in app.js`);
  const end = source.indexOf(endMarker, start);
  assert.ok(end !== -1, `expected to find the end of ${label} in app.js`);
  return source.slice(start, end);
}

const wrapperSrc = sliceBetween(
  appJs,
  'async function generateMonogramWithFrameAutoShrink(request){',
  '\nasync function generateMonogram(){',
  'generateMonogramWithFrameAutoShrink()'
);

// `monogramGenerator` and `listStoneSizes` are module-scope references inside the sliced source
// (app.js never passes them as params to this function) -- supplying them as the enclosing
// `new Function(...)` factory's own parameter names lets the hoisted function declaration close
// over them lexically, the same technique test-mono-006-monogram-ui.mjs's sandboxFactory uses.
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

// ---------- Real MonogramGenerator + real GeometryEngine (same recipe as test-mono-006's PART B / test-mono-005) ----------

const manifest = JSON.parse(await readFile(path.join(repoRoot, 'assets/fonts/manifest.json'), 'utf8'));
const fontManager = new FontManager(manifest);
async function loadFontBufferFromRepoRoot(relativePath) {
  const buffer = await readFile(path.join(repoRoot, relativePath));
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
}
const fontProviderRegistry = createDefaultFontProviderRegistry(fontManager, { loadFontBuffer: loadFontBufferFromRepoRoot });
const realEngine = new GeometryEngine({ fontProviderRegistry });
const realGenerator = new MonogramGenerator({ geometryEngine: realEngine });

const REAL_CANVAS_MM = { widthMm: 200, heightMm: 200 };
const LETTER_STONE_SIZE_MM = 2.0; // SS6

// Probed directly against the real generator: a 60x60mm square frame with a single letter 'A'
// collides with the frame (FRAME_COLLISION) when frameOptions.stoneSizeMm is SS30 (6.4mm), but
// fits cleanly at every smaller catalog size (SS20 4.7mm and below) -- the frame's own required
// collision clearance (frameStoneSizeMm + gapMm) shrinks with the frame stone, while the letters'
// own interior carve-out (keyed to the letters' stoneSizeMm, not the frame's) never changes. This
// is exactly the scenario MONO-011 exists to auto-correct.
function buildCollidingRequest() {
  return {
    frameId: 'square', layoutId: MONOGRAM_LAYOUTS.SINGLE, letters: ['A'], fontId: 'rs-block', providerId: 'rhinestone',
    stoneSizeMm: LETTER_STONE_SIZE_MM, color: 'gold',
    frameRect: { xMm: 70, yMm: 70, widthMm: 60, heightMm: 60 },
    canvasMm: REAL_CANVAS_MM,
    frameOptions: { stoneSizeMm: 6.4, color: 'silver' }
  };
}

await test('generateMonogramWithFrameAutoShrink() retries a FRAME_COLLISION down to the next smaller catalog frame stone size and succeeds', async () => {
  const counting = makeCountingGenerator(realGenerator);
  const wrapper = buildWrapper(counting);
  const request = buildCollidingRequest();

  // Sanity: confirm the unwrapped generator really does fail at the requested frame stone size,
  // so this test is proving a real correction, not a no-op.
  const direct = await realGenerator.generate(request);
  assert.equal(direct.ok, false);
  assert.equal(direct.reason, MONOGRAM_GENERATOR_FAILURE_REASONS.FRAME_COLLISION);

  const { result, appliedFrameStoneSizeMm } = await wrapper(request);

  assert.equal(result.ok, true, result.message);
  assert.equal(appliedFrameStoneSizeMm, 4.7, 'should land on SS20 (4.7mm), the next catalog size below the requested 6.4mm');
  assert.ok(appliedFrameStoneSizeMm < request.frameOptions.stoneSizeMm, 'applied frame stone size must be strictly smaller than requested');
  assert.ok(listStoneSizes().some((s) => s.diameterMm === appliedFrameStoneSizeMm), 'applied frame stone size must be a real catalog size');
  assert.equal(counting.calls.length, 2, 'expected exactly one retry: the original 6.4mm call, then the successful 4.7mm candidate');

  const textLayers = result.layers.filter((l) => l.type === 'text');
  assert.ok(textLayers.length > 0, 'expected at least one letter (text) layer');
  for (const layer of textLayers) {
    assert.equal(layer.stoneSize, LETTER_STONE_SIZE_MM, 'the letters\' own stone size must never be touched by the frame auto-shrink');
  }
});

await test('generateMonogramWithFrameAutoShrink() leaves a non-frame failure (toggle off / no frameOptions.stoneSizeMm) untouched, with zero retries', async () => {
  const counting = makeCountingGenerator(realGenerator);
  const wrapper = buildWrapper(counting);
  // Same frame/layout/font/letters as the colliding case, but a frame too small even for the
  // letter alone to legally scale into -- probed to fail BELOW_MINIMUM_SCALE regardless of frame
  // stone size, and frameOptions is empty (toggle-off equivalent: no frameOptions.stoneSizeMm at
  // all, exactly what buildMonogramRequest() produces when #monogramFrameStoneToggle is unchecked).
  const request = {
    frameId: 'square', layoutId: MONOGRAM_LAYOUTS.SINGLE, letters: ['A'], fontId: 'rs-block', providerId: 'rhinestone',
    stoneSizeMm: LETTER_STONE_SIZE_MM, color: 'gold',
    frameRect: { xMm: 90, yMm: 90, widthMm: 20, heightMm: 20 },
    canvasMm: REAL_CANVAS_MM,
    frameOptions: {}
  };

  const direct = await realGenerator.generate(request);
  assert.equal(direct.ok, false);
  assert.equal(direct.reason, MONOGRAM_GENERATOR_FAILURE_REASONS.BELOW_MINIMUM_SCALE);

  const { result, appliedFrameStoneSizeMm } = await wrapper(request);

  assert.equal(counting.calls.length, 1, 'a non-frame-stone failure reason must never trigger a retry');
  assert.equal(result.ok, false);
  assert.equal(result.reason, MONOGRAM_GENERATOR_FAILURE_REASONS.BELOW_MINIMUM_SCALE);
  assert.equal(appliedFrameStoneSizeMm, null);
});

console.log('MONO-011 (Monogram frame stone auto-shrink) tests passed.');
