import assert from 'node:assert/strict';

// rs-design-crystal-dots — src/drawing/StoneSpriteCache.js (offscreen sprite baking for the Design
// view's stone-dot preview). Stubs `document.createElement('canvas')` (StoneSpriteCache.js's only
// DOM dependency, same convention as src/image/ImageDecoder.js) with a fake canvas whose
// getContext('2d') returns the same dependency-free fake CanvasRenderingContext2D convention
// tools/test-crystal-stone-renderer.mjs already uses, extended to count how many real canvases get
// created so cache-hit-vs-miss behavior can be asserted directly.

function createFakeCtx() {
  const calls = { arc: [], ellipse: [], lineTo: [], moveTo: [] };
  const target = {
    arc(x, y, r, ...rest) { calls.arc.push({ x, y, r, rest }); },
    ellipse(...args) { calls.ellipse.push(args); },
    lineTo(...args) { calls.lineTo.push(args); },
    moveTo(...args) { calls.moveTo.push(args); },
    createRadialGradient() { return { addColorStop() {} }; },
    createLinearGradient() { return { addColorStop() {} }; }
  };
  const ctx = new Proxy(target, {
    get(obj, prop) {
      if (prop in obj) return obj[prop];
      return () => {};
    },
    set(obj, prop, value) {
      obj[prop] = value;
      return true;
    }
  });
  return { ctx, calls };
}

let canvasesCreated = 0;
const createdCanvases = [];
globalThis.document = {
  createElement(tag) {
    assert.equal(tag, 'canvas', 'StoneSpriteCache should only ever create a canvas element');
    canvasesCreated++;
    const { ctx, calls } = createFakeCtx();
    const canvas = { width: 0, height: 0, getContext: () => ctx, __calls: calls };
    createdCanvases.push(canvas);
    return canvas;
  }
};

const {
  buildStoneSpriteCanvas,
  getStoneSprite,
  clearStoneSpriteCache,
  quantizeRadiusPx,
  VARIANT_COUNT,
  RADIUS_BUCKET_PX,
  _spriteCacheSizeForTesting
} = await import('../src/drawing/StoneSpriteCache.js');

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

await test('1. VARIANT_COUNT is 4', () => {
  assert.equal(VARIANT_COUNT, 4);
});

await test('2. quantizeRadiusPx rounds to RADIUS_BUCKET_PX steps', () => {
  assert.equal(RADIUS_BUCKET_PX, 0.5);
  assert.equal(quantizeRadiusPx(10.1), 10);
  assert.equal(quantizeRadiusPx(10.3), 10.5);
  assert.equal(quantizeRadiusPx(10.26), 10.5);
});

await test('3. buildStoneSpriteCanvas sizes the canvas to cover drawCrystalStone\'s max overdraw (PADDING=1.4)', () => {
  clearStoneSpriteCache();
  canvasesCreated = 0;
  const canvas = buildStoneSpriteCanvas('gold', 10, 0);
  assert.equal(canvasesCreated, 1);
  assert.equal(canvas.width, Math.ceil(2 * 10 * 1.4));
  assert.equal(canvas.height, canvas.width);
  assert.ok(canvas.__calls.arc.length > 0, 'drawCrystalStone should have issued arc() calls into the sprite canvas');
});

await test('4. buildStoneSpriteCanvas is deterministic: identical (colorKey, radiusPx, variantIndex) bakes identical draw calls', () => {
  const a = buildStoneSpriteCanvas('sapphire', 8, 2);
  const b = buildStoneSpriteCanvas('sapphire', 8, 2);
  assert.notEqual(a, b, 'two independent builds should be two independent canvas objects');
  assert.deepEqual(a.__calls, b.__calls, 'the same key should bake pixel-identical draw call sequences');
});

await test('5. buildStoneSpriteCanvas never uses Math.random: two variants at the same color/radius differ deterministically', () => {
  const v0 = buildStoneSpriteCanvas('gold', 8, 0);
  const v1 = buildStoneSpriteCanvas('gold', 8, 1);
  assert.notDeepEqual(v0.__calls, v1.__calls, 'different variantIndex should bake visibly different appearance');
  // Re-running variant 0 again must reproduce the exact same calls as the first v0 build.
  const v0Again = buildStoneSpriteCanvas('gold', 8, 0);
  assert.deepEqual(v0.__calls, v0Again.__calls);
});

await test('6. getStoneSprite caches by (colorKey, radiusBucket, variantIndex): repeat calls hit the cache, no new canvas', () => {
  clearStoneSpriteCache();
  canvasesCreated = 0;
  const first = getStoneSprite('crystal', 12, 3);
  assert.equal(canvasesCreated, 1);
  const second = getStoneSprite('crystal', 12, 3);
  assert.equal(canvasesCreated, 1, 'a repeat lookup with the same key must not build a new canvas');
  assert.equal(first, second, 'a repeat lookup with the same key must return the exact same canvas instance');
});

await test('7. getStoneSprite quantizes radiusPx into the cache key: nearby radii within the same bucket share one entry', () => {
  clearStoneSpriteCache();
  canvasesCreated = 0;
  const a = getStoneSprite('crystal', 12.05, 0);
  const b = getStoneSprite('crystal', 12.24, 0);
  assert.equal(canvasesCreated, 1, 'both radii round to the same 0.5px bucket and should share one bake');
  assert.equal(a, b);
});

await test('8. getStoneSprite treats a different colorKey/variantIndex/radius bucket as a cache miss', () => {
  clearStoneSpriteCache();
  canvasesCreated = 0;
  getStoneSprite('crystal', 12, 0);
  getStoneSprite('gold', 12, 0);
  getStoneSprite('crystal', 12, 1);
  getStoneSprite('crystal', 13, 0);
  assert.equal(canvasesCreated, 4, 'each distinct (colorKey, radiusBucket, variantIndex) key should bake its own sprite');
});

await test('9. clearStoneSpriteCache forces every subsequent lookup to re-bake', () => {
  clearStoneSpriteCache();
  canvasesCreated = 0;
  const before = getStoneSprite('jet', 6, 0);
  assert.equal(canvasesCreated, 1);
  clearStoneSpriteCache();
  const after = getStoneSprite('jet', 6, 0);
  assert.equal(canvasesCreated, 2, 'a lookup after clearStoneSpriteCache() should re-bake even for a previously-cached key');
  assert.notEqual(before, after, 'the re-baked sprite should be a new canvas instance');
  assert.deepEqual(before.__calls, after.__calls, 'the re-bake should still be deterministic (same draw calls)');
});

await test('10. _spriteCacheSizeForTesting reflects cache-key reuse: grows once per distinct key, not per call', () => {
  clearStoneSpriteCache();
  assert.equal(_spriteCacheSizeForTesting(), 0);
  getStoneSprite('gold', 10, 0);
  assert.equal(_spriteCacheSizeForTesting(), 1);
  getStoneSprite('gold', 10, 0);
  assert.equal(_spriteCacheSizeForTesting(), 1, 'repeat call with the same key must not grow the cache');
  getStoneSprite('gold', 10, 1);
  assert.equal(_spriteCacheSizeForTesting(), 2);
});

console.log('Stone sprite cache tests passed.');
