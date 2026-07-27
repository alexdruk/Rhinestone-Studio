import assert from 'node:assert/strict';

// RS-1006 — fake-ctx tests (no real canvas/DOM/Three.js) for
// src/preview3d/StoneLayoutTexture.js, using the same dependency-free fake CanvasRenderingContext2D
// convention tools/test-object-preview-renderer.mjs / tools/test-cup-rotation-stabilization.mjs
// already use.

const { drawStoneLayoutTexture, textureSizeForMm, TEXTURE_PX_PER_MM } =
  await import('../src/preview3d/StoneLayoutTexture.js');
const { Stone } = await import('../src/geometry/Stone.js');
const { StoneLayout } = await import('../src/geometry/StoneLayout.js');

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

function makeLayout(stoneParams, layerId = 'layer-1') {
  const stones = stoneParams.map((p, index) => new Stone({ layerId, index, ...p }));
  return new StoneLayout({ layerId, stones });
}

function createFakeCtx() {
  const calls = { fillRect: [], arc: [], clearRect: [] };
  // The gradient object itself (and its addColorStop function reference) is never asserted on --
  // only whether a stone's fillStyle was set to *a* gradient (isGradient), so two separate fake
  // ctx instances stay deep-equal-comparable for the determinism test below.
  const target = {
    createRadialGradient() { return { addColorStop() {} }; },
    clearRect(...args) { calls.clearRect.push(args); },
    fillRect(...args) { calls.fillRect.push({ args, fillStyle: target.fillStyle }); },
    arc(...args) { calls.arc.push({ args, isGradientFillStyle: typeof target.fillStyle === 'object' }); },
    beginPath() {},
    fill() {}
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

await test('1. textureSizeForMm scales linearly with TEXTURE_PX_PER_MM', () => {
  const { widthPx, heightPx } = textureSizeForMm(210, 90);
  assert.equal(widthPx, Math.round(210 * TEXTURE_PX_PER_MM));
  assert.equal(heightPx, Math.round(90 * TEXTURE_PX_PER_MM));
});

await test('2. textureSizeForMm never returns less than 2px in either dimension', () => {
  const { widthPx, heightPx } = textureSizeForMm(0.001, 0.001);
  assert.ok(widthPx >= 2);
  assert.ok(heightPx >= 2);
});

await test('3. draws exactly one background fillRect sized to textureSizeForMm, using backgroundColor', () => {
  const { ctx, calls } = createFakeCtx();
  const layout = makeLayout([]);
  const { widthPx, heightPx } = drawStoneLayoutTexture(ctx, layout, { widthMm: 100, heightMm: 50, backgroundColor: '#1f3556' });
  assert.equal(calls.fillRect.length, 1);
  assert.deepEqual(calls.fillRect[0].args, [0, 0, widthPx, heightPx]);
  assert.equal(calls.fillRect[0].fillStyle, '#1f3556');
});

await test('4. draws the faceted-crystal treatment (4 arc() calls: shadow, body, lower-edge-shade, edge) per stone', () => {
  // PREVIEW-001: drawStoneLayoutTexture() now reuses CrystalStoneRenderer.js's drawCrystalStone()
  // (see tools/test-crystal-stone-renderer.mjs for full per-primitive coverage) instead of a
  // single flat-shaded arc, so the 3D preview's baked texture matches the 2D canvas's look.
  const { ctx, calls } = createFakeCtx();
  const layout = makeLayout([
    { xMm: 0, yMm: 0, sizeMm: 2, color: 'gold' },
    { xMm: 10, yMm: 5, sizeMm: 2, color: 'silver' },
    { xMm: -3, yMm: 8, sizeMm: 3, color: 'jet' }
  ]);
  drawStoneLayoutTexture(ctx, layout, { widthMm: 100, heightMm: 50, backgroundColor: '#ffffff' });
  assert.equal(calls.arc.length, 4 * 3);
});

await test('5. each stone\'s body-fill/crisp-edge arcs are drawn at its true mm position scaled by TEXTURE_PX_PER_MM', () => {
  const { ctx, calls } = createFakeCtx();
  const layout = makeLayout([{ xMm: 12, yMm: -4, sizeMm: 2, color: 'gold' }]);
  drawStoneLayoutTexture(ctx, layout, { widthMm: 100, heightMm: 50, backgroundColor: '#ffffff' });
  const expectedX = 12 * TEXTURE_PX_PER_MM;
  const expectedY = -4 * TEXTURE_PX_PER_MM;
  const expectedR = (2 / 2) * TEXTURE_PX_PER_MM;
  const exactMatches = calls.arc.filter(({ args: [x, y, r] }) =>
    Math.abs(x - expectedX) < 1e-9 && Math.abs(y - expectedY) < 1e-9 && Math.abs(r - expectedR) < 1e-9);
  assert.equal(exactMatches.length, 2, 'expected exactly the body-fill and crisp-edge arcs at the true center/radius');
});

await test('6. an unknown stone color falls back to the gold palette rather than throwing', () => {
  const { ctx } = createFakeCtx();
  const layout = makeLayout([{ xMm: 0, yMm: 0, sizeMm: 2, color: 'not-a-real-color' }]);
  assert.doesNotThrow(() => drawStoneLayoutTexture(ctx, layout, { widthMm: 50, heightMm: 50, backgroundColor: '#ffffff' }));
});

await test('7. drawing is deterministic for the same inputs', () => {
  const layout = makeLayout([
    { xMm: 1, yMm: 2, sizeMm: 2, color: 'gold' },
    { xMm: 3, yMm: -1, sizeMm: 1.5, color: 'silver' }
  ]);
  const { ctx: ctxA, calls: callsA } = createFakeCtx();
  const { ctx: ctxB, calls: callsB } = createFakeCtx();
  drawStoneLayoutTexture(ctxA, layout, { widthMm: 80, heightMm: 40, backgroundColor: '#1f3556' });
  drawStoneLayoutTexture(ctxB, layout, { widthMm: 80, heightMm: 40, backgroundColor: '#1f3556' });
  assert.deepEqual(callsA.arc, callsB.arc);
  assert.deepEqual(callsA.fillRect, callsB.fillRect);
});

console.log('Stone layout texture tests passed.');
