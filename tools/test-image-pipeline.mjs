import assert from 'node:assert/strict';
import {
  createImageBuffer,
  createField,
  toGrayscale,
  applyThreshold,
  invertMask,
  blurMask,
  resizeField,
  sampleImageFillPoints,
  isSupportedImageFile
} from '../src/image/index.js';

// RS-1008 — unit tests for each pure stage of the Image Trace pipeline, using synthetic pixel
// buffers (no real image decode, no browser). Mirrors tools/test-svg-parser.mjs's convention of
// unit-testing each stage independently before the integration suite exercises the full pipeline.

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

await test('1. createImageBuffer validates dimensions and data length', () => {
  const buf = createImageBuffer({ widthPx: 2, heightPx: 1, data: rgba([[0, 0, 0, 255], [255, 255, 255, 255]]) });
  assert.equal(buf.widthPx, 2);
  assert.equal(buf.heightPx, 1);
  assert.throws(() => createImageBuffer({ widthPx: 2, heightPx: 1, data: rgba([[0, 0, 0, 255]]) }), RangeError);
  assert.throws(() => createImageBuffer({ widthPx: 0, heightPx: 1, data: new Uint8ClampedArray(4) }), TypeError);
  assert.throws(() => createField({ widthPx: 2, heightPx: 2, data: new Uint8ClampedArray(3) }), RangeError);
});

await test('2. toGrayscale: black/white/red/transparent pixels resolve as expected, transparent -> white', () => {
  const buffer = createImageBuffer({
    widthPx: 2,
    heightPx: 2,
    data: rgba([
      [0, 0, 0, 255],     // pure black -> 0
      [255, 255, 255, 255], // pure white -> 255
      [255, 0, 0, 255],   // pure red -> 76 (0.299*255)
      [0, 0, 0, 0]        // fully transparent black -> composited onto white -> 255
    ])
  });
  const gray = toGrayscale(buffer);
  assert.equal(gray.data[0], 0);
  assert.equal(gray.data[1], 255);
  assert.equal(gray.data[2], Math.round(0.299 * 255));
  assert.equal(gray.data[3], 255);
});

await test('3. applyThreshold classifies darker-than-threshold as foreground; boundary is background', () => {
  const gray = createField({ widthPx: 4, heightPx: 1, data: Uint8ClampedArray.from([50, 127, 128, 200]) });
  const mask = applyThreshold(gray, 128);
  assert.deepEqual(Array.from(mask.data), [1, 1, 0, 0]);
});

await test('4. invertMask flips every value; double-invert is identity', () => {
  const mask = createField({ widthPx: 3, heightPx: 1, data: Uint8ClampedArray.from([0, 1, 0]) });
  const inverted = invertMask(mask);
  assert.deepEqual(Array.from(inverted.data), [1, 0, 1]);
  const doubleInverted = invertMask(inverted);
  assert.deepEqual(Array.from(doubleInverted.data), Array.from(mask.data));
});

await test('5. blurMask: radius 0 rescales 0/1->0/255; radius>0 smooths an isolated pixel; uniform fields stay uniform', () => {
  const mask = createField({ widthPx: 3, heightPx: 3, data: Uint8ClampedArray.from([0, 0, 0, 0, 1, 0, 0, 0, 0]) });
  const noBlur = blurMask(mask, 0);
  assert.deepEqual(Array.from(noBlur.data), [0, 0, 0, 0, 255, 0, 0, 0, 0]);

  const blurred = blurMask(mask, 1);
  // Center stays highest but neighbors pick up a nonzero smoothed value, not a hard 0/255 edge.
  assert.ok(blurred.data[4] > 0 && blurred.data[4] < 255, 'center should be smoothed, not full 255');
  assert.ok(blurred.data[1] > 0, 'neighbor above center should pick up some density');

  // A larger field with an off-center impulse shows a clear falloff away from the impulse (the
  // tiny 3x3-with-radius-1 case above has a window exactly as wide as the field, so clamp-to-edge
  // symmetry coincidentally makes every pixel equal -- correct, but not a useful falloff check).
  const size = 5;
  const bigData = new Uint8ClampedArray(size * size);
  bigData[2 * size + 2] = 1; // impulse at (2,2), the field's center
  const bigMask = createField({ widthPx: size, heightPx: size, data: bigData });
  const bigBlurred = blurMask(bigMask, 1);
  const at = (x, y) => bigBlurred.data[y * size + x];
  // A box blur's response to an impulse is its box kernel itself: a flat plateau within the
  // radius (not a gaussian-style gradual falloff) and a hard cutoff to 0 outside it.
  assert.ok(at(2, 2) > 0, 'impulse location should be nonzero after blurring');
  assert.equal(at(2, 2), at(1, 2), 'value should be flat (plateau) within the box radius');
  assert.equal(at(0, 0), 0, 'a pixel outside the box radius should remain untouched');

  const allOn = createField({ widthPx: 3, heightPx: 3, data: Uint8ClampedArray.from(new Array(9).fill(1)) });
  const blurredOn = blurMask(allOn, 1);
  assert.ok(Array.from(blurredOn.data).every((v) => v === 255), 'uniform foreground stays uniform after blur');

  const allOff = createField({ widthPx: 3, heightPx: 3, data: Uint8ClampedArray.from(new Array(9).fill(0)) });
  const blurredOff = blurMask(allOff, 1);
  assert.ok(Array.from(blurredOff.data).every((v) => v === 0), 'uniform background stays uniform after blur');

  assert.throws(() => blurMask(mask, -1), RangeError);
});

await test('6. resizeField never upscales; downsizes preserving aspect ratio with the larger dimension at its max', () => {
  const field = createField({ widthPx: 4, heightPx: 2, data: Uint8ClampedArray.from(new Array(8).fill(255)) });
  const unchanged = resizeField(field, 10, 10);
  assert.equal(unchanged.widthPx, 4);
  assert.equal(unchanged.heightPx, 2);

  const downsized = resizeField(field, 2, 2);
  assert.equal(downsized.widthPx, 2);
  assert.ok(downsized.heightPx <= 2);
  assert.ok(Array.from(downsized.data).every((v) => v === 255));
});

await test('7. sampleImageFillPoints: full-foreground yields a regular grid, full-background yields none, half/half only samples the foreground half', () => {
  const on = createField({ widthPx: 2, heightPx: 2, data: Uint8ClampedArray.from([255, 255, 255, 255]) });
  const onPoints = sampleImageFillPoints(on, { xMm: 0, yMm: 0, widthMm: 10, heightMm: 10, spacingMm: 2 });
  assert.ok(onPoints.length > 0);

  const off = createField({ widthPx: 2, heightPx: 2, data: Uint8ClampedArray.from([0, 0, 0, 0]) });
  const offPoints = sampleImageFillPoints(off, { xMm: 0, yMm: 0, widthMm: 10, heightMm: 10, spacingMm: 2 });
  assert.equal(offPoints.length, 0);

  // Left half on, right half off (2px wide field, column 0 = left half, column 1 = right half).
  const split = createField({ widthPx: 2, heightPx: 1, data: Uint8ClampedArray.from([255, 0]) });
  const splitPoints = sampleImageFillPoints(split, { xMm: 0, yMm: 0, widthMm: 10, heightMm: 1, spacingMm: 1 });
  assert.ok(splitPoints.length > 0);
  assert.ok(splitPoints.every((p) => p.xMm < 5), 'only the left (foreground) half should produce points');

  assert.throws(() => sampleImageFillPoints(on, { xMm: 0, yMm: 0, widthMm: 10, heightMm: 10, spacingMm: 0 }), RangeError);
  assert.deepEqual(sampleImageFillPoints(on, { xMm: 0, yMm: 0, widthMm: 0, heightMm: 10, spacingMm: 1 }), []);
});

await test('8. isSupportedImageFile accepts PNG/JPEG/WebP by MIME, rejects others, falls back to extension', () => {
  assert.equal(isSupportedImageFile({ type: 'image/png', name: 'a.png' }), true);
  assert.equal(isSupportedImageFile({ type: 'image/jpeg', name: 'a.jpg' }), true);
  assert.equal(isSupportedImageFile({ type: 'image/webp', name: 'a.webp' }), true);
  assert.equal(isSupportedImageFile({ type: 'image/gif', name: 'a.gif' }), false);
  assert.equal(isSupportedImageFile({ type: 'image/svg+xml', name: 'a.svg' }), false);
  assert.equal(isSupportedImageFile({ type: '', name: 'a.PNG' }), true, 'extension fallback should be case-insensitive');
  assert.equal(isSupportedImageFile({ type: '', name: 'a.bmp' }), false);
  assert.equal(isSupportedImageFile(null), false);
});

await test('9. determinism: grayscale->threshold->blur->resize is deepEqual across repeated runs', () => {
  const buffer = createImageBuffer({
    widthPx: 4,
    heightPx: 4,
    data: rgba(Array.from({ length: 16 }, (_, i) => [i * 16, i * 8, 255 - i * 16, 255]))
  });

  function run() {
    const gray = toGrayscale(buffer);
    const mask = applyThreshold(gray, 128);
    const blurred = blurMask(mask, 1);
    return resizeField(blurred, 2, 2);
  }

  const a = run();
  const b = run();
  assert.deepEqual(Array.from(a.data), Array.from(b.data));
  assert.equal(a.widthPx, b.widthPx);
  assert.equal(a.heightPx, b.heightPx);
});

console.log('Image pipeline unit tests passed.');
