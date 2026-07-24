import assert from 'node:assert/strict';

// RS-2011 — verifies Preview3DRenderer.js's invalidation-based render scheduling
// (_requestRender()/_renderFrame()/getRenderCount()) in isolation. Preview3DRenderer.js has no prior
// Node test (see its own header comment -- WebGLRenderer needs a real browser canvas/GL context to
// fully construct), but the scheduling logic itself only touches this._mounted/this._frameScheduled/
// controls.update()/renderer.render(), so it can be exercised directly against a real
// Preview3DRenderer instance with `controls`/`renderer` swapped for minimal fakes and a queued fake
// requestAnimationFrame -- the same dependency-free-fake convention
// tools/test-object-preview-renderer.mjs already uses for CanvasRenderingContext2D, applied here to
// requestAnimationFrame instead of a canvas 2D context.

const rafQueue = [];
globalThis.requestAnimationFrame = (cb) => {
  rafQueue.push(cb);
  return rafQueue.length;
};
function flushRaf() {
  const queued = rafQueue.splice(0, rafQueue.length);
  for (const cb of queued) cb();
}

const { Preview3DRenderer } = await import('../src/preview3d/Preview3DRenderer.js');

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

// Builds a Preview3DRenderer with init()'s real WebGL/DOM/Three.js setup skipped entirely --
// _requestRender()/_renderFrame() never touch this.scene/this.camera/this.canvas, only the
// controls/renderer fakes installed here, so no real mount is needed to test them directly.
function makeRenderer() {
  const instance = new Preview3DRenderer({ getBoundingClientRect: () => ({ width: 100, height: 100 }) });
  instance._mounted = true;
  const calls = { controlsUpdate: 0, render: 0 };
  instance.controls = { update: () => { calls.controlsUpdate++; return false; } };
  instance.renderer = { render: () => { calls.render++; } };
  return { instance, calls };
}

await test('1. _requestRender() schedules exactly one requestAnimationFrame callback even if called repeatedly before it fires', () => {
  const { instance } = makeRenderer();
  rafQueue.length = 0;
  instance._requestRender();
  instance._requestRender();
  instance._requestRender();
  assert.equal(rafQueue.length, 1, 'expected only one queued requestAnimationFrame callback');
});

await test('2. the scheduled frame calls controls.update() once and renders exactly once, then schedules nothing further (no continuous loop)', () => {
  const { instance, calls } = makeRenderer();
  rafQueue.length = 0;
  instance._requestRender();
  flushRaf();
  assert.equal(calls.controlsUpdate, 1);
  assert.equal(calls.render, 1);
  assert.equal(rafQueue.length, 0, 'expected the scene to sit idle with no further frame scheduled');
});

await test('3. a fresh _requestRender() after a frame already fired schedules exactly one new frame (idle, then invalidated again)', () => {
  const { instance, calls } = makeRenderer();
  rafQueue.length = 0;
  instance._requestRender();
  flushRaf();
  instance._requestRender();
  assert.equal(rafQueue.length, 1, 'expected exactly one new frame scheduled after re-invalidating');
  flushRaf();
  assert.equal(calls.render, 2);
});

await test('4. a disposed renderer (_mounted=false) renders nothing even if a frame was already queued', () => {
  const { instance, calls } = makeRenderer();
  rafQueue.length = 0;
  instance._requestRender();
  instance._mounted = false;
  flushRaf();
  assert.equal(calls.render, 0, 'expected no render() call once unmounted');
  assert.equal(calls.controlsUpdate, 0, 'expected no controls.update() call once unmounted');
});

await test('5. once unmounted, _requestRender() no longer schedules any frame', () => {
  const { instance } = makeRenderer();
  rafQueue.length = 0;
  instance._mounted = false;
  instance._requestRender();
  assert.equal(rafQueue.length, 0);
});

await test('6. getRenderCount() reflects the number of actual renderer.render() calls, not the number of invalidations', () => {
  const { instance } = makeRenderer();
  rafQueue.length = 0;
  assert.equal(instance.getRenderCount(), 0);
  instance._requestRender();
  instance._requestRender();
  instance._requestRender();
  flushRaf();
  assert.equal(instance.getRenderCount(), 1, 'three invalidations before the frame fired must still produce exactly one render');
});

console.log('Preview3D render scheduling tests passed.');
