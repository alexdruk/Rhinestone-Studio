import assert from 'node:assert/strict';

// RS-1009 — unit tests for the pure alignment/distribution math in
// src/editing/AlignmentEngine.js. No DOM, no app.js, no Project/Layer/StoneLayout.

const { alignLayers, distributeLayers, ALIGN_DIRECTIONS, DISTRIBUTE_AXES } = await import('../src/editing/index.js');

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

function bbox(xMm, yMm, widthMm, heightMm) {
  return { xMm, yMm, widthMm, heightMm };
}

await test('1. ALIGN_DIRECTIONS/DISTRIBUTE_AXES expose the six/two supported values', () => {
  assert.deepEqual([...ALIGN_DIRECTIONS], ['left', 'centerH', 'right', 'top', 'centerV', 'bottom']);
  assert.deepEqual([...DISTRIBUTE_AXES], ['horizontal', 'vertical']);
});

await test('2. alignLayers requires at least 2 items', () => {
  assert.throws(() => alignLayers([{ id: 'a', bbox: bbox(0, 0, 10, 10) }], 'left'), TypeError);
  assert.throws(() => alignLayers([], 'left'), TypeError);
});

await test('3. alignLayers rejects an unknown direction', () => {
  const items = [{ id: 'a', bbox: bbox(0, 0, 10, 10) }, { id: 'b', bbox: bbox(20, 20, 10, 10) }];
  assert.throws(() => alignLayers(items, 'diagonal'), TypeError);
});

await test('4. align left moves every item to the union bbox\'s left edge', () => {
  const items = [
    { id: 'a', bbox: bbox(0, 0, 10, 10) },
    { id: 'b', bbox: bbox(30, 5, 10, 10) },
    { id: 'c', bbox: bbox(15, -5, 10, 10) }
  ];
  const deltas = alignLayers(items, 'left');
  // union left = min(0,30,15) = 0
  assert.deepEqual(deltas.get('a'), { dxMm: 0, dyMm: 0 });
  assert.deepEqual(deltas.get('b'), { dxMm: -30, dyMm: 0 });
  assert.deepEqual(deltas.get('c'), { dxMm: -15, dyMm: 0 });
});

await test('5. align right moves every item to the union bbox\'s right edge', () => {
  const items = [
    { id: 'a', bbox: bbox(0, 0, 10, 10) },   // right edge 10
    { id: 'b', bbox: bbox(30, 0, 20, 10) }   // right edge 50 (union right)
  ];
  const deltas = alignLayers(items, 'right');
  assert.equal(deltas.get('a').dxMm, 40); // 10 -> 50
  assert.equal(deltas.get('b').dxMm, 0);
});

await test('6. align centerH moves every item to the union bbox\'s horizontal center', () => {
  const items = [
    { id: 'a', bbox: bbox(0, 0, 10, 10) },   // center x = 5
    { id: 'b', bbox: bbox(40, 0, 10, 10) }   // center x = 45
  ];
  // union: x=0..50, center = 25
  const deltas = alignLayers(items, 'centerH');
  assert.equal(deltas.get('a').dxMm, 20); // 5 -> 25
  assert.equal(deltas.get('b').dxMm, -20); // 45 -> 25
});

await test('7. align top/bottom/centerV mirror left/right/centerH on the y axis', () => {
  const items = [
    { id: 'a', bbox: bbox(0, 0, 10, 10) },
    { id: 'b', bbox: bbox(0, 40, 10, 20) }
  ];
  const top = alignLayers(items, 'top');
  assert.equal(top.get('a').dyMm, 0);
  assert.equal(top.get('b').dyMm, -40);

  const bottom = alignLayers(items, 'bottom');
  // union bottom = max(10, 60) = 60
  assert.equal(bottom.get('a').dyMm, 50); // 10 -> 60
  assert.equal(bottom.get('b').dyMm, 0);

  const centerV = alignLayers(items, 'centerV');
  // union y=0..60, center=30
  assert.equal(centerV.get('a').dyMm, 25); // center 5 -> 30
  assert.equal(centerV.get('b').dyMm, -20); // center 50 -> 30
});

await test('8. align only ever moves along the requested axis (the other delta is 0)', () => {
  const items = [{ id: 'a', bbox: bbox(0, 0, 10, 10) }, { id: 'b', bbox: bbox(30, 30, 10, 10) }];
  for (const direction of ['left', 'centerH', 'right']) {
    for (const [, d] of alignLayers(items, direction)) assert.equal(d.dyMm, 0);
  }
  for (const direction of ['top', 'centerV', 'bottom']) {
    for (const [, d] of alignLayers(items, direction)) assert.equal(d.dxMm, 0);
  }
});

await test('9. distributeLayers requires at least 3 items', () => {
  const items = [{ id: 'a', bbox: bbox(0, 0, 10, 10) }, { id: 'b', bbox: bbox(20, 0, 10, 10) }];
  assert.throws(() => distributeLayers(items, 'horizontal'), TypeError);
});

await test('10. distributeLayers rejects an unknown axis', () => {
  const items = [
    { id: 'a', bbox: bbox(0, 0, 10, 10) },
    { id: 'b', bbox: bbox(20, 0, 10, 10) },
    { id: 'c', bbox: bbox(40, 0, 10, 10) }
  ];
  assert.throws(() => distributeLayers(items, 'diagonal'), TypeError);
});

await test('11. distributeLayers horizontal equalizes center-to-center spacing, holding the extremes fixed', () => {
  const items = [
    { id: 'a', bbox: bbox(0, 0, 10, 10) },    // center 5
    { id: 'b', bbox: bbox(12, 0, 4, 10) },    // center 14 (bunched near a)
    { id: 'c', bbox: bbox(90, 0, 10, 10) }    // center 95
  ];
  const deltas = distributeLayers(items, 'horizontal');
  assert.equal(deltas.get('a').dxMm, 0, 'first item (by center) stays fixed');
  assert.equal(deltas.get('c').dxMm, 0, 'last item (by center) stays fixed');
  // step = (95-5)/2 = 45; b's target center = 5+45 = 50; b's current center = 14; delta = 36
  assert.equal(deltas.get('b').dxMm, 36);
  for (const [, d] of deltas) assert.equal(d.dyMm, 0);
});

await test('12. distributeLayers vertical is the horizontal case rotated 90 degrees', () => {
  const items = [
    { id: 'a', bbox: bbox(0, 0, 10, 10) },    // center y = 5
    { id: 'b', bbox: bbox(0, 12, 10, 4) },    // center y = 14
    { id: 'c', bbox: bbox(0, 90, 10, 10) }    // center y = 95
  ];
  const deltas = distributeLayers(items, 'vertical');
  assert.equal(deltas.get('a').dyMm, 0);
  assert.equal(deltas.get('c').dyMm, 0);
  assert.equal(deltas.get('b').dyMm, 36);
  for (const [, d] of deltas) assert.equal(d.dxMm, 0);
});

await test('13. distributeLayers is order-independent in the input array (sorts by center internally)', () => {
  const inOrder = [
    { id: 'a', bbox: bbox(0, 0, 10, 10) },
    { id: 'b', bbox: bbox(12, 0, 4, 10) },
    { id: 'c', bbox: bbox(90, 0, 10, 10) }
  ];
  const shuffled = [inOrder[2], inOrder[0], inOrder[1]];
  const d1 = distributeLayers(inOrder, 'horizontal');
  const d2 = distributeLayers(shuffled, 'horizontal');
  for (const id of ['a', 'b', 'c']) assert.deepEqual(d1.get(id), d2.get(id));
});

await test('14. alignLayers/distributeLayers reject items with a non-numeric bbox', () => {
  assert.throws(() => alignLayers([{ id: 'a', bbox: { xMm: 'nope', yMm: 0, widthMm: 1, heightMm: 1 } }, { id: 'b', bbox: bbox(0, 0, 1, 1) }], 'left'), TypeError);
});

console.log('Alignment engine tests passed.');
