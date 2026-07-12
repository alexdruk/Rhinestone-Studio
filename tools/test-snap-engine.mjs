import assert from 'node:assert/strict';

// RS-1009 — unit tests for the pure snap-target math in src/editing/SnapEngine.js. No DOM, no
// app.js, no Project/Layer/StoneLayout.

const { buildSnapTargets, computeSnapOffset, SNAP_TOLERANCE_MM } = await import('../src/editing/index.js');

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

function approxEqual(actual, expected, message) {
  assert.ok(Math.abs(actual - expected) < 1e-6, message || `expected ${actual} to be approximately ${expected}`);
}

const CANVAS = { canvasWidthMm: 200, canvasHeightMm: 100 };

await test('1. buildSnapTargets validates canvas dimensions', () => {
  assert.throws(() => buildSnapTargets({ canvasWidthMm: 0, canvasHeightMm: 100 }), TypeError);
  assert.throws(() => buildSnapTargets({ canvasWidthMm: 100, canvasHeightMm: -1 }), TypeError);
});

await test('2. buildSnapTargets includes canvas edges and center on both axes', () => {
  const targets = buildSnapTargets(CANVAS);
  const verticalValues = targets.vertical.map((t) => t.valueMm);
  const horizontalValues = targets.horizontal.map((t) => t.valueMm);
  assert.ok(verticalValues.includes(0));
  assert.ok(verticalValues.includes(200));
  assert.ok(verticalValues.includes(100), 'horizontal canvas center');
  assert.ok(horizontalValues.includes(0));
  assert.ok(horizontalValues.includes(100));
  assert.ok(horizontalValues.includes(50), 'vertical canvas center');
  assert.ok(targets.vertical.every((t) => t.type.startsWith('canvas')));
});

await test('3. buildSnapTargets adds safe-area edges/center when a safe area rect is given', () => {
  const targets = buildSnapTargets({ ...CANVAS, safeAreaRectMm: { xMm: 10, yMm: 5, widthMm: 180, heightMm: 90 } });
  const vTypes = targets.vertical.filter((t) => t.type.startsWith('safe-area'));
  const hTypes = targets.horizontal.filter((t) => t.type.startsWith('safe-area'));
  assert.deepEqual(vTypes.map((t) => t.valueMm).sort((a, b) => a - b), [10, 100, 190]);
  assert.deepEqual(hTypes.map((t) => t.valueMm).sort((a, b) => a - b), [5, 50, 95]);
});

await test('4. buildSnapTargets adds edges/center for each given layer bbox, tagged with layerId', () => {
  const targets = buildSnapTargets({
    ...CANVAS,
    layerBBoxes: [{ layerId: 'x', xMm: 20, yMm: 30, widthMm: 10, heightMm: 4 }]
  });
  const layerVertical = targets.vertical.filter((t) => t.type.startsWith('layer'));
  assert.deepEqual(layerVertical.map((t) => t.valueMm).sort((a, b) => a - b), [20, 25, 30]);
  assert.ok(layerVertical.every((t) => t.layerId === 'x'));
});

await test('5. computeSnapOffset snaps the left edge to canvas center within tolerance', () => {
  const targets = buildSnapTargets(CANVAS);
  // dragged box left edge at 99.5 (canvas center is 100) -> within SNAP_TOLERANCE_MM (1.5)
  const result = computeSnapOffset({ xMm: 99.5, yMm: 40, widthMm: 20, heightMm: 10 }, targets);
  assert.equal(result.dxMm, 0.5);
  assert.ok(result.guides.some((g) => g.axis === 'vertical' && g.valueMm === 100 && g.type === 'canvas-center'));
});

await test('6. computeSnapOffset snaps to canvas edges (both x=0 and x=width)', () => {
  const targets = buildSnapTargets(CANVAS);
  const leftEdge = computeSnapOffset({ xMm: 1, yMm: 0, widthMm: 10, heightMm: 10 }, targets);
  assert.equal(leftEdge.dxMm, -1); // left feature at x=1 -> snaps to 0
  const rightEdge = computeSnapOffset({ xMm: 189, yMm: 0, widthMm: 10, heightMm: 10 }, targets);
  // right feature at 189+10=199 -> snaps to canvas edge 200, offset +1
  assert.equal(rightEdge.dxMm, 1);
});

await test('7. computeSnapOffset snaps to the safe-area rect\'s edges and center', () => {
  const targets = buildSnapTargets({ ...CANVAS, safeAreaRectMm: { xMm: 10, yMm: 5, widthMm: 180, heightMm: 90 } });
  const result = computeSnapOffset({ xMm: 10.8, yMm: 5.9, widthMm: 20, heightMm: 10 }, targets);
  approxEqual(result.dxMm, -0.8); // left edge 10.8 -> safe-area left 10
  approxEqual(result.dyMm, -0.9); // top edge 5.9 -> safe-area top 5
  assert.ok(result.guides.some((g) => g.type === 'safe-area-edge' && g.axis === 'vertical'));
  assert.ok(result.guides.some((g) => g.type === 'safe-area-edge' && g.axis === 'horizontal'));
});

await test('8. computeSnapOffset snaps to another layer\'s edges/center', () => {
  const targets = buildSnapTargets({ ...CANVAS, layerBBoxes: [{ layerId: 'other', xMm: 50, yMm: 20, widthMm: 30, heightMm: 10 }] });
  // dragged center x should land on other layer's center x = 65
  const result = computeSnapOffset({ xMm: 55, yMm: 0, widthMm: 20, heightMm: 5 }, targets);
  // dragged center = 55+10 = 65 already equals other's center -> dxMm 0, but let's offset it
  assert.equal(result.dxMm, 0);
  const offBy1 = computeSnapOffset({ xMm: 56, yMm: 0, widthMm: 20, heightMm: 5 }, targets);
  approxEqual(offBy1.dxMm, -1);
  assert.ok(offBy1.guides.some((g) => g.type === 'layer-center' && g.layerId === 'other'));
  assert.ok(result.guides.some((g) => g.type === 'layer-center' && g.layerId === 'other'), 'the zero-offset case above must still report which target it matched');
});

await test('9. tolerance boundary: exactly at the tolerance snaps, just beyond it does not', () => {
  const targets = buildSnapTargets(CANVAS);
  const atTolerance = computeSnapOffset({ xMm: 100 - SNAP_TOLERANCE_MM, yMm: 0, widthMm: 0, heightMm: 0 }, targets, SNAP_TOLERANCE_MM);
  assert.equal(atTolerance.dxMm, SNAP_TOLERANCE_MM);
  const beyondTolerance = computeSnapOffset({ xMm: 100 - SNAP_TOLERANCE_MM - 0.01, yMm: 0, widthMm: 0, heightMm: 0 }, targets, SNAP_TOLERANCE_MM);
  assert.equal(beyondTolerance.dxMm, 0);
  assert.equal(beyondTolerance.guides.filter((g) => g.axis === 'vertical').length, 0);
});

await test('10. no matching target within tolerance returns a zero offset and no guides on that axis', () => {
  const targets = buildSnapTargets(CANVAS);
  const result = computeSnapOffset({ xMm: 47, yMm: 0, widthMm: 3, heightMm: 0 }, targets);
  // left=47, center=48.5, right=50 -- none within 1.5mm of 0/100/200 on x; y=0/height=0 -> top matches y=0 exactly
  assert.equal(result.dxMm, 0);
  assert.equal(result.guides.filter((g) => g.axis === 'vertical').length, 0);
});

await test('11. computeSnapOffset picks the closest target when several are within tolerance', () => {
  const targets = { vertical: [{ valueMm: 10, type: 'a' }, { valueMm: 10.4, type: 'b' }], horizontal: [] };
  const result = computeSnapOffset({ xMm: 10.5, yMm: 0, widthMm: 0, heightMm: 0 }, targets, 2);
  approxEqual(result.dxMm, -0.1); // closer to 10.4 than 10
});

await test('12. axes are independent: an x snap does not require a y snap and vice versa', () => {
  const targets = buildSnapTargets(CANVAS);
  // left edge 99.2 is within tolerance of canvas center (100); y=47 has no nearby target (0/50/100).
  const result = computeSnapOffset({ xMm: 99.2, yMm: 47, widthMm: 6, heightMm: 3 }, targets);
  approxEqual(result.dxMm, 0.8);
  assert.equal(result.dyMm, 0);
});

console.log('Snap engine tests passed.');
