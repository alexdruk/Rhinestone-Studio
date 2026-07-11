/**
 * Public entry point for the 3D preview (RS-1006). This is the only module app.js statically
 * imports -- it has no static import of Three.js (or of Preview3DRenderer.js, which does), so
 * Three.js is never fetched/parsed just because app.js loaded. createPreview3D() returns a
 * synchronous facade immediately (app.js's own startup is never blocked waiting on a dynamic
 * import + WebGL context creation); the facade queues the most recent update()/syncView() call and
 * replays it once the real Preview3DRenderer finishes mounting.
 */

/**
 * @param {HTMLCanvasElement} canvas
 * @returns {{update: Function, syncView: Function, resetView: Function}}
 */
export function createPreview3D(canvas) {
  let real = null;
  let pendingUpdate = null;
  let pendingView = null;

  (async () => {
    const { Preview3DRenderer } = await import('./Preview3DRenderer.js');
    real = new Preview3DRenderer(canvas);
    await real.init();
    if (pendingUpdate) real.update(pendingUpdate.stoneLayout, pendingUpdate.options);
    if (pendingView) real.syncView(pendingView.azimuthDeg, pendingView.zoom);
  })().catch((error) => {
    console.error('3D preview failed to initialize', error);
  });

  return {
    update(stoneLayout, options) {
      pendingUpdate = { stoneLayout, options };
      if (real) real.update(stoneLayout, options);
    },
    syncView(azimuthDeg, zoom) {
      pendingView = { azimuthDeg, zoom };
      if (real) real.syncView(azimuthDeg, zoom);
    },
    resetView() {
      if (real) real.resetView();
    }
  };
}
