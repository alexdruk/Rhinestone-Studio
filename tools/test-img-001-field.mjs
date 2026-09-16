import assert from 'node:assert/strict';
import {
  createImageBuffer,
  prepareImageField
} from '../src/image/index.js';

// IMG-001 — unit tests for prepareImageField()'s multi-channel field return shape
// ({widthPx, heightPx, data, luminance, alpha, labels}) and its new `transparent` policy
// ('white'|'ignore'). Mirrors tools/test-image-pipeline.mjs's own convention (synthetic pixel
// buffers, no real image decode, no browser) -- see docs/specifications/IMG-001-ImageToStrass.md.

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

function rgba(pixels) {
  // pixels: array of [r,g,b,a]
  const data = new Uint8ClampedArray(pixels.length * 4);
  pixels.forEach(([r, g, b, a], i) => {
    data[i * 4] = r; data[i * 4 + 1] = g; data[i * 4 + 2] = b; data[i * 4 + 3] = a;
  });
  return data;
}

// The exact fixture tools/test-image-pipeline.mjs's own prepareImageField() test (test 7) already
// uses: a 4x4 buffer, top two rows opaque black (foreground at default threshold), bottom two rows
// opaque white (background). No alpha channel in play.
function halfBlackHalfWhiteOpaqueBuffer() {
  return createImageBuffer({
    widthPx: 4,
    heightPx: 4,
    data: rgba(Array.from({ length: 16 }, (_, i) => (i < 8 ? [0, 0, 0, 255] : [255, 255, 255, 255])))
  });
}

// A 4x4 buffer with a transparent quadrant: top-left 2x2 block is fully transparent (alpha 0,
// underlying RGB black -- irrelevant at alpha 0), the remaining 12 pixels are fully opaque white
// (alpha 255). Small enough (4x4) that maxWidthPx/maxHeightPx: 4 never triggers a resize, so every
// channel stays at exact, unaveraged 0/255 values -- no box-average ambiguity to reason about.
function transparentQuadrantBuffer() {
  const pixels = [];
  for (let y = 0; y < 4; y++) {
    for (let x = 0; x < 4; x++) {
      const inQuadrant = x < 2 && y < 2;
      pixels.push(inQuadrant ? [0, 0, 0, 0] : [255, 255, 255, 255]);
    }
  }
  return createImageBuffer({ widthPx: 4, heightPx: 4, data: rgba(pixels) });
}

const QUADRANT_INDICES = [0, 1, 4, 5]; // (x,y): (0,0) (1,0) (0,1) (1,1) in row-major order over a 4-wide field

await test('1. data stays byte-identical to the pre-IMG-001 pipeline on test-image-pipeline.mjs\'s own fixture', () => {
  const buffer = halfBlackHalfWhiteOpaqueBuffer();

  const field = prepareImageField(buffer, { threshold: 128, invert: false, blurRadiusPx: 0, maxWidthPx: 4, maxHeightPx: 4 });
  assert.equal(field.widthPx, 4);
  assert.equal(field.heightPx, 4);
  assert.deepEqual(Array.from(field.data), [255, 255, 255, 255, 255, 255, 255, 255, 0, 0, 0, 0, 0, 0, 0, 0]);

  const inverted = prepareImageField(buffer, { threshold: 128, invert: true, blurRadiusPx: 0, maxWidthPx: 4, maxHeightPx: 4 });
  assert.deepEqual(Array.from(inverted.data), Array.from(field.data).map((v) => (v ? 0 : 255)));

  const capped = prepareImageField(buffer, { threshold: 128, maxWidthPx: 2, maxHeightPx: 2 });
  assert.equal(capped.widthPx, 2);
  assert.equal(capped.heightPx, 2);
});

await test('2. return shape is {widthPx, heightPx, data, luminance, alpha, labels}, all channels sharing one resolution', () => {
  const buffer = halfBlackHalfWhiteOpaqueBuffer();
  const field = prepareImageField(buffer, { threshold: 128, maxWidthPx: 4, maxHeightPx: 4 });

  assert.deepEqual(new Set(Object.keys(field)), new Set(['widthPx', 'heightPx', 'data', 'luminance', 'alpha', 'labels']));
  assert.equal(field.labels, null);
  for (const channel of [field.data, field.luminance, field.alpha]) {
    assert.ok(channel instanceof Uint8ClampedArray);
    assert.equal(channel.length, field.widthPx * field.heightPx);
  }
  // luminance is the pre-threshold grayscale: top half (black) -> 0, bottom half (white) -> 255.
  assert.deepEqual(Array.from(field.luminance), [0, 0, 0, 0, 0, 0, 0, 0, 255, 255, 255, 255, 255, 255, 255, 255]);
  // fully opaque buffer -> alpha coverage mask is all 255.
  assert.ok(Array.from(field.alpha).every((v) => v === 255));
});

await test('3. alpha mask correctness on a synthetic RGBA buffer with a transparent quadrant', () => {
  const buffer = transparentQuadrantBuffer();
  const field = prepareImageField(buffer, { threshold: 128, maxWidthPx: 4, maxHeightPx: 4 });

  const expectedAlpha = Array.from({ length: 16 }, (_, i) => (QUADRANT_INDICES.includes(i) ? 0 : 255));
  assert.deepEqual(Array.from(field.alpha), expectedAlpha);
});

await test('4. \'ignore\' vs \'white\' produce different data on the transparent-quadrant buffer', () => {
  const buffer = transparentQuadrantBuffer();
  // invert:true so the transparent quadrant's 'white'-composited background classification flips to
  // foreground -- the only way to observe 'ignore' overriding what 'white' would have produced,
  // since 'ignore' only ever forces a pixel OFF, never on (see IMG-001-ImageToStrass.md).
  const params = { threshold: 128, invert: true, blurRadiusPx: 0, maxWidthPx: 4, maxHeightPx: 4 };

  const white = prepareImageField(buffer, { ...params, transparent: 'white' });
  const ignore = prepareImageField(buffer, { ...params, transparent: 'ignore' });

  assert.ok(Array.from(white.data).every((v) => v === 255), 'white policy: every pixel becomes foreground after invert');
  const expectedIgnoreData = Array.from({ length: 16 }, (_, i) => (QUADRANT_INDICES.includes(i) ? 0 : 255));
  assert.deepEqual(Array.from(ignore.data), expectedIgnoreData);
  assert.notDeepEqual(Array.from(white.data), Array.from(ignore.data));
});

await test('5. \'ignore\' and \'white\' produce identical data on a fully opaque buffer', () => {
  const buffer = halfBlackHalfWhiteOpaqueBuffer();
  const params = { threshold: 128, invert: false, blurRadiusPx: 2, maxWidthPx: 4, maxHeightPx: 4 };

  const white = prepareImageField(buffer, { ...params, transparent: 'white' });
  const ignore = prepareImageField(buffer, { ...params, transparent: 'ignore' });

  assert.deepEqual(Array.from(white.data), Array.from(ignore.data));
  assert.deepEqual(Array.from(white.luminance), Array.from(ignore.luminance));
  assert.deepEqual(Array.from(white.alpha), Array.from(ignore.alpha));
});

await test('6. migration default: omitting `transparent` resolves to \'white\'-equivalent output', () => {
  const buffer = transparentQuadrantBuffer();
  const params = { threshold: 128, invert: true, blurRadiusPx: 0, maxWidthPx: 4, maxHeightPx: 4 };

  const omitted = prepareImageField(buffer, params);
  const explicitWhite = prepareImageField(buffer, { ...params, transparent: 'white' });
  const explicitIgnore = prepareImageField(buffer, { ...params, transparent: 'ignore' });

  assert.deepEqual(Array.from(omitted.data), Array.from(explicitWhite.data));
  assert.notDeepEqual(Array.from(omitted.data), Array.from(explicitIgnore.data));
});

await test('7. transparent rejects an unrecognized value', () => {
  const buffer = halfBlackHalfWhiteOpaqueBuffer();
  assert.throws(() => prepareImageField(buffer, { maxWidthPx: 4, maxHeightPx: 4, transparent: 'bogus' }), /transparent/);
});

console.log('IMG-001 field/transparency tests passed.');
