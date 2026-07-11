import assert from 'node:assert/strict';

// RS-1004 — verifies CupRenderer.js's generalized renderCup() draws three distinct silhouettes
// (mug/tumbler/bottle) from one shared frustum + stone-wrap-placement math, that an omitted
// objectTemplate option falls back to the exact pre-milestone mug silhouette (no regression for
// any existing/future caller that never passes one), and that every wrap mode still places stones
// for every object type. Uses the same dependency-free fake CanvasRenderingContext2D convention as
// tools/test-cup-rotation-stabilization.mjs / tools/test-ux-visual-polish.mjs.

const { renderCup } = await import('../src/renderer/CupRenderer.js');
const { getObjectTemplate } = await import('../src/products/index.js');
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

// A "text-like" spread of stones (not a single point) so wrap-mode theta/foreshortening math has
// real width/height to work with, matching how a real design's bounding box is never zero-sized.
function makeDesignLayout() {
  const stones = [];
  for (let x = -30; x <= 30; x += 6) {
    stones.push({ xMm: x, yMm: 0, sizeMm: 2, color: 'gold' });
    stones.push({ xMm: x, yMm: 6, sizeMm: 2, color: 'gold' });
  }
  return makeLayout(stones);
}

function createFakeCtx() {
  const calls = { fillRect: [], strokeRect: [], ellipse: [], bezierCurveTo: [], arc: [], quadraticCurveTo: [] };
  const gradientStub = { addColorStop() {} };
  const target = {
    createLinearGradient() { return gradientStub; },
    createRadialGradient() { return gradientStub; },
    fillRect(...args) { calls.fillRect.push(args); },
    strokeRect(...args) { calls.strokeRect.push(args); },
    ellipse(...args) { calls.ellipse.push(args); },
    bezierCurveTo(...args) { calls.bezierCurveTo.push(args); },
    arc(...args) { calls.arc.push(args); },
    quadraticCurveTo(...args) { calls.quadraticCurveTo.push(args); }
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

const designLayout = makeDesignLayout();
const emptyLayout = makeLayout([]);
const VIEWPORT = { widthPx: 480, heightPx: 380, dpr: 1, cupColor: '#1f3556', wrap: 'front', rotationDeg: 0, zoom: 1 };

await test('1. renderCup never throws for any of the three templates, across every wrap mode and a rotation sweep', () => {
  for (const id of ['mug', 'tumbler', 'bottle']) {
    const objectTemplate = getObjectTemplate(id);
    for (const wrap of ['front', 'wide', 'half', 'full']) {
      for (let deg = -180; deg <= 180; deg += 30) {
        const { ctx } = createFakeCtx();
        assert.doesNotThrow(
          () => renderCup(ctx, designLayout, { ...VIEWPORT, wrap, rotationDeg: deg, objectTemplate }),
          `renderCup threw for ${id} at wrap=${wrap} rotationDeg=${deg}`
        );
      }
    }
  }
});

await test('2. omitting objectTemplate draws the exact pre-milestone mug silhouette (same handle draw call as passing the real mug template)', () => {
  const { ctx: ctxOmitted, calls: callsOmitted } = createFakeCtx();
  renderCup(ctxOmitted, designLayout, { ...VIEWPORT });

  const { ctx: ctxMug, calls: callsMug } = createFakeCtx();
  renderCup(ctxMug, designLayout, { ...VIEWPORT, objectTemplate: getObjectTemplate('mug') });

  assert.ok(callsOmitted.bezierCurveTo.length > 0, 'expected a handle (bezierCurveTo calls) when objectTemplate is omitted');
  assert.deepEqual(callsOmitted.bezierCurveTo, callsMug.bezierCurveTo, 'omitted objectTemplate must match the explicit mug template exactly');
  assert.deepEqual(callsOmitted.ellipse, callsMug.ellipse, 'omitted objectTemplate must match the explicit mug template exactly');
});

// Tests 3-5 use an empty StoneLayout so ellipse/rect/bezier call counts reflect only the
// silhouette itself — drawStone()'s 'cup' style also calls ctx.ellipse() (a per-stone contrast
// ring) and would otherwise contaminate these counts.

await test('3. mug preview draws a handle (bezierCurveTo) and a mouth rim (ellipse)', () => {
  const { ctx, calls } = createFakeCtx();
  renderCup(ctx, emptyLayout, { ...VIEWPORT, objectTemplate: getObjectTemplate('mug') });
  assert.ok(calls.bezierCurveTo.length > 0, 'expected the mug handle to draw bezier curves');
  assert.ok(calls.ellipse.length > 0, 'expected the mug mouth rim to draw ellipses');
});

await test('4. tumbler preview draws no handle (no bezierCurveTo calls) but does draw a mouth rim', () => {
  const { ctx, calls } = createFakeCtx();
  renderCup(ctx, emptyLayout, { ...VIEWPORT, objectTemplate: getObjectTemplate('tumbler') });
  assert.equal(calls.bezierCurveTo.length, 0, 'tumbler has no handle, so no bezierCurveTo calls are expected');
  assert.ok(calls.ellipse.length > 0, 'expected the tumbler mouth rim to draw ellipses');
});

await test('5. bottle preview draws no handle and no mouth-rim ellipse, but does draw a neck (fillRect/strokeRect) and a rounded cap', () => {
  const { ctx, calls } = createFakeCtx();
  renderCup(ctx, emptyLayout, { ...VIEWPORT, objectTemplate: getObjectTemplate('bottle') });
  assert.equal(calls.bezierCurveTo.length, 0, 'bottle has no handle, so no bezierCurveTo calls are expected');
  assert.equal(calls.ellipse.length, 0, 'bottle has no mouth rim (the cap covers the top), so no ellipse calls are expected');
  assert.ok(calls.fillRect.length > 0, 'expected the bottle neck to be drawn as a filled rect');
  assert.ok(calls.quadraticCurveTo.length > 0, 'expected the bottle shoulder/cap corners to use quadraticCurveTo');
});

await test('6. every wrap mode places at least one stone (drawStone -> ctx.arc) for every template', () => {
  for (const id of ['mug', 'tumbler', 'bottle']) {
    for (const wrap of ['front', 'wide', 'half', 'full']) {
      const { ctx, calls } = createFakeCtx();
      renderCup(ctx, designLayout, { ...VIEWPORT, wrap, objectTemplate: getObjectTemplate(id) });
      assert.ok(calls.arc.length > 0, `expected at least one stone drawn for ${id} at wrap=${wrap}`);
    }
  }
});

await test('7. an empty StoneLayout never throws for any template', () => {
  const empty = makeLayout([]);
  for (const id of ['mug', 'tumbler', 'bottle']) {
    const { ctx } = createFakeCtx();
    assert.doesNotThrow(() => renderCup(ctx, empty, { ...VIEWPORT, objectTemplate: getObjectTemplate(id) }));
  }
});

await test('8. CupRenderer remains StoneLayout-only (no project.layers/layer-type/GeometryEngine/src/products import reference in actual code, matching the tools/test-cup-rotation-stabilization.mjs precedent)', async () => {
  const { readFile } = await import('node:fs/promises');
  const path = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const repoRoot = fileURLToPath(new URL('..', import.meta.url));
  const source = await readFile(path.join(repoRoot, 'src/renderer/CupRenderer.js'), 'utf8');
  assert.ok(!/project\.layers/.test(source), 'CupRenderer.js must not reference project.layers');
  assert.ok(!/layer\.type|l\.type/.test(source), 'CupRenderer.js must not reference a layer\'s type');
  assert.ok(!/GeometryEngine/.test(source), 'CupRenderer.js must not reference GeometryEngine');
  const importLines = (source.match(/^\s*import\b.*$/gm) || []).map((line) => line.trim());
  assert.deepEqual(importLines, ["import { drawStone } from './CanvasRenderer2D.js';"], 'CupRenderer.js should still only import CanvasRenderer2D.js (RS-1004 keeps objectTemplate a plain passed-in option, not a src/products import)');
});

console.log('Object preview renderer tests passed.');
