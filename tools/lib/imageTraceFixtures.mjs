/**
 * Shared synthetic-buffer fixtures for the RS-1008A Image Trace regression baseline.
 *
 * Used by both generate-image-trace-baselines.mjs (captures the committed baseline JSON from a
 * known-good implementation) and test-image-trace-regression.mjs (replays the exact same inputs
 * against the current implementation and asserts deepEqual output), so the two can never drift
 * apart by accident.
 */

export function solidColorBuffer(createImageBuffer, widthPx, heightPx, [r, g, b, a]) {
  const data = new Uint8ClampedArray(widthPx * heightPx * 4);
  for (let i = 0; i < widthPx * heightPx; i++) {
    data[i * 4] = r; data[i * 4 + 1] = g; data[i * 4 + 2] = b; data[i * 4 + 3] = a;
  }
  return createImageBuffer({ widthPx, heightPx, data });
}

// Left half black (foreground at default threshold), right half white (background).
export function halfBlackHalfWhiteBuffer(createImageBuffer, widthPx, heightPx) {
  const data = new Uint8ClampedArray(widthPx * heightPx * 4);
  for (let y = 0; y < heightPx; y++) {
    for (let x = 0; x < widthPx; x++) {
      const i = (y * widthPx + x) * 4;
      const v = x < widthPx / 2 ? 0 : 255;
      data[i] = v; data[i + 1] = v; data[i + 2] = v; data[i + 3] = 255;
    }
  }
  return createImageBuffer({ widthPx, heightPx, data });
}

// A horizontal grayscale gradient, dark on the left (0) to light on the right (255).
export function gradientBuffer(createImageBuffer, widthPx, heightPx) {
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

export const BASE_PARAMS = {
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

/**
 * @param {typeof import('../../src/image/index.js').createImageBuffer} createImageBuffer
 * @returns {{name: string, buffer: object, params: object}[]}
 */
export function buildRegressionCases(createImageBuffer) {
  return [
    { name: 'halfSplit_default', buffer: halfBlackHalfWhiteBuffer(createImageBuffer, 20, 20), params: BASE_PARAMS },
    { name: 'halfSplit_invert', buffer: halfBlackHalfWhiteBuffer(createImageBuffer, 20, 20), params: { ...BASE_PARAMS, invert: true } },
    { name: 'halfSplit_blur3', buffer: halfBlackHalfWhiteBuffer(createImageBuffer, 20, 20), params: { ...BASE_PARAMS, blurRadiusPx: 3 } },
    { name: 'gradient_threshold60', buffer: gradientBuffer(createImageBuffer, 40, 10), params: { ...BASE_PARAMS, threshold: 60 } },
    { name: 'gradient_threshold200', buffer: gradientBuffer(createImageBuffer, 40, 10), params: { ...BASE_PARAMS, threshold: 200 } },
    { name: 'solidBlack_placed', buffer: solidColorBuffer(createImageBuffer, 10, 10, [0, 0, 0, 255]), params: { ...BASE_PARAMS, xMm: 50, yMm: 30, widthMm: 10, heightMm: 5 } },
    { name: 'largeWorkingRes_capped', buffer: halfBlackHalfWhiteBuffer(createImageBuffer, 200, 200), params: { ...BASE_PARAMS, maxWidthPx: 8, maxHeightPx: 8 } },
    { name: 'largeWorkingRes_uncapped', buffer: halfBlackHalfWhiteBuffer(createImageBuffer, 200, 200), params: { ...BASE_PARAMS, maxWidthPx: 200, maxHeightPx: 200 } }
  ];
}
