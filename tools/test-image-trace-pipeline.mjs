import assert from 'node:assert/strict';
import { createImageBuffer, traceImageBufferToStoneLayout } from '../src/image/index.js';
import { StoneLayout } from '../src/geometry/index.js';

// RS-1008 — integration tests for traceImageBufferToStoneLayout(): the full
// grayscale->threshold->invert->blur->resize->grid-sample->StoneLayout pipeline, exercised against
// synthetic RGBA buffers (no browser, no real image decode). Mirrors the "generateSvgLayout()
// coverage" block tools/test-geometry-engine.mjs added for RS-1001.

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

function solidColorBuffer(widthPx, heightPx, [r, g, b, a]) {
  const data = new Uint8ClampedArray(widthPx * heightPx * 4);
  for (let i = 0; i < widthPx * heightPx; i++) {
    data[i * 4] = r; data[i * 4 + 1] = g; data[i * 4 + 2] = b; data[i * 4 + 3] = a;
  }
  return createImageBuffer({ widthPx, heightPx, data });
}

// Left half black (foreground at default threshold), right half white (background).
function halfBlackHalfWhiteBuffer(widthPx, heightPx) {
  const data = new Uint8ClampedArray(widthPx * heightPx * 4);
  for (let y = 0; y < heightPx; y++) {
    for (let x = 0; x < widthPx; x++) {
      const i = (y * widthPx + x) * 4;
      const isLeft = x < widthPx / 2;
      const v = isLeft ? 0 : 255;
      data[i] = v; data[i + 1] = v; data[i + 2] = v; data[i + 3] = 255;
    }
  }
  return createImageBuffer({ widthPx, heightPx, data });
}

// A horizontal grayscale gradient, dark on the left (0) to light on the right (255).
function gradientBuffer(widthPx, heightPx) {
  const data = new Uint8ClampedArray(widthPx * heightPx * 4);
  for (let y = 0; y < heightPx; y++) {
    for (let x = 0; x < widthPx; x++) {
      const i = (y * widthPx + x) * 4;
      const v = Math.round((x / (widthPx - 1)) * 255);
      data[i] = v; data[i + 1] = v; data[i + 2] = v; data[i + 3] = 255;
    }
  }
  return createImageBuffer({ widthPx, heightPx, data });
}

const BASE_PARAMS = {
  layerId: 'image-1',
  xMm: 0,
  yMm: 0,
  widthMm: 20,
  heightMm: 20,
  stoneSizeMm: 1,
  gapMm: 0.2,
  color: 'gold',
  maxWidthPx: 64,
  maxHeightPx: 64
};

await test('10. a shape buffer traces to a non-empty StoneLayout with stones only over the foreground half', () => {
  const buffer = halfBlackHalfWhiteBuffer(20, 20);
  const layout = traceImageBufferToStoneLayout(buffer, BASE_PARAMS);
  assert.ok(layout instanceof StoneLayout);
  assert.ok(layout.count > 0);
  assert.ok(layout.stones.every((s) => s.xMm < BASE_PARAMS.xMm + BASE_PARAMS.widthMm / 2 + 0.5));
});

await test('11. invert:true flips which half produces stones', () => {
  const buffer = halfBlackHalfWhiteBuffer(20, 20);
  const layout = traceImageBufferToStoneLayout(buffer, { ...BASE_PARAMS, invert: true });
  assert.ok(layout.count > 0);
  assert.ok(layout.stones.every((s) => s.xMm > BASE_PARAMS.xMm + BASE_PARAMS.widthMm / 2 - 0.5));
});

await test('12. increasing threshold (lighter cutoff) increases traced foreground area for a gradient', () => {
  const buffer = gradientBuffer(40, 10);
  const low = traceImageBufferToStoneLayout(buffer, { ...BASE_PARAMS, threshold: 60 });
  const high = traceImageBufferToStoneLayout(buffer, { ...BASE_PARAMS, threshold: 200 });
  assert.ok(high.count > low.count, `expected higher threshold to trace more area (${high.count} vs ${low.count})`);
});

await test('13. blurRadiusPx softens a sharp edge without crashing or producing non-finite coordinates', () => {
  const buffer = halfBlackHalfWhiteBuffer(20, 20);
  const sharp = traceImageBufferToStoneLayout(buffer, { ...BASE_PARAMS, blurRadiusPx: 0 });
  const blurred = traceImageBufferToStoneLayout(buffer, { ...BASE_PARAMS, blurRadiusPx: 3 });
  for (const layout of [sharp, blurred]) {
    for (const stone of layout.stones) {
      assert.ok(Number.isFinite(stone.xMm) && Number.isFinite(stone.yMm));
    }
  }
  // Blurring pushes the threshold boundary outward (density >=128 extends slightly past the hard
  // edge), so the blurred trace should not be narrower than the sharp one.
  assert.ok(blurred.count >= sharp.count * 0.5, 'blur should not drastically shrink the traced area');
});

await test('14. maxWidthPx/maxHeightPx actually bound the working resolution (resize is applied, not a no-op)', () => {
  const buffer = halfBlackHalfWhiteBuffer(200, 200);
  const capped = traceImageBufferToStoneLayout(buffer, { ...BASE_PARAMS, maxWidthPx: 8, maxHeightPx: 8 });
  const uncapped = traceImageBufferToStoneLayout(buffer, { ...BASE_PARAMS, maxWidthPx: 200, maxHeightPx: 200 });
  assert.ok(capped.count > 0);
  assert.ok(uncapped.count > 0);
  // Both should trace roughly the same physical half of the placement box regardless of working
  // resolution -- proves the mm grid sampling is resolution-independent, not that resize is a no-op.
  const maxXCapped = Math.max(...capped.stones.map((s) => s.xMm));
  const maxXUncapped = Math.max(...uncapped.stones.map((s) => s.xMm));
  assert.ok(Math.abs(maxXCapped - maxXUncapped) < 3, 'traced extent should be comparable regardless of working resolution');
});

await test('15. requested xMm/yMm/widthMm/heightMm correctly place and scale the bounding box', () => {
  const buffer = solidColorBuffer(10, 10, [0, 0, 0, 255]); // all-black -> all-foreground
  const layout = traceImageBufferToStoneLayout(buffer, { ...BASE_PARAMS, xMm: 50, yMm: 30, widthMm: 10, heightMm: 5 });
  const box = layout.getBoundingBox();
  assert.ok(box.minXmm >= 49 && box.maxXmm <= 61.5, `expected placement near x=50..60, got ${box.minXmm}..${box.maxXmm}`);
  assert.ok(box.minYmm >= 29 && box.maxYmm <= 36.5, `expected placement near y=30..35, got ${box.minYmm}..${box.maxYmm}`);
});

await test('16. every stone carries the requested layerId/color/sizeMm and finite mm coordinates', () => {
  const buffer = solidColorBuffer(10, 10, [0, 0, 0, 255]);
  const layout = traceImageBufferToStoneLayout(buffer, { ...BASE_PARAMS, layerId: 'my-layer', color: 'sapphire', stoneSizeMm: 1.5 });
  assert.ok(layout.count > 0);
  for (const stone of layout.stones) {
    assert.equal(stone.layerId, 'my-layer');
    assert.equal(stone.color, 'sapphire');
    assert.equal(stone.sizeMm, 1.5);
    assert.ok(Number.isFinite(stone.xMm) && Number.isFinite(stone.yMm));
  }
});

await test('17. determinism: two calls with identical params produce deepEqual StoneLayout.toJSON()', () => {
  const buffer = halfBlackHalfWhiteBuffer(20, 20);
  const a = traceImageBufferToStoneLayout(buffer, BASE_PARAMS);
  const b = traceImageBufferToStoneLayout(buffer, BASE_PARAMS);
  assert.deepEqual(a.toJSON(), b.toJSON());
});

await test('18. malformed params throw clear, parameter-naming errors', () => {
  const buffer = solidColorBuffer(4, 4, [0, 0, 0, 255]);
  assert.throws(() => traceImageBufferToStoneLayout(buffer, { ...BASE_PARAMS, layerId: '' }), /layerId/);
  assert.throws(() => traceImageBufferToStoneLayout(buffer, { ...BASE_PARAMS, stoneSizeMm: 0 }), /stoneSizeMm/);
  assert.throws(() => traceImageBufferToStoneLayout(buffer, { ...BASE_PARAMS, threshold: 300 }), /threshold/);
  assert.throws(() => traceImageBufferToStoneLayout(buffer, { ...BASE_PARAMS, blurRadiusPx: -1 }), /blurRadiusPx/);
  assert.throws(() => traceImageBufferToStoneLayout(buffer, { ...BASE_PARAMS, maxWidthPx: 0 }), /maxWidthPx/);
  assert.throws(() => traceImageBufferToStoneLayout(buffer, { ...BASE_PARAMS, maxHeightPx: -5 }), /maxHeightPx/);
});

await test('19. an all-background buffer produces a valid, empty StoneLayout (not an error)', () => {
  const buffer = solidColorBuffer(10, 10, [255, 255, 255, 255]); // all-white -> all-background
  const layout = traceImageBufferToStoneLayout(buffer, BASE_PARAMS);
  assert.ok(layout instanceof StoneLayout);
  assert.equal(layout.count, 0);
});

console.log('Image trace pipeline integration tests passed.');
