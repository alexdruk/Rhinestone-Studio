// MONO-005A: collision-classification audit -- StoneSampler.findCrossGroupCollisions().
//
// Focused tests for the pure collision-query helper added to replace MonogramGenerator's earlier,
// audit-flagged reuse of dedupeStonesByRadius() (a *deduplication* API) for pure classification (see
// findCrossGroupCollisions()'s own doc comment in src/geometry/StoneSampler.js for the full
// reasoning). Proves: collisions are never hidden by a retained stone, input ordering never changes
// the reported result, and cross-group classification is exact (same-group pairs are never flagged).

import assert from 'node:assert/strict';
import { findCrossGroupCollisions, dedupeStonesByRadius } from '../src/geometry/index.js';

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

function shuffled(array, seed) {
  // Deterministic shuffle (no Math.random -- repeated test runs must be reproducible), a simple
  // seeded LCG-driven Fisher-Yates.
  let state = seed;
  const next = () => {
    state = (state * 1103515245 + 12345) & 0x7fffffff;
    return state / 0x7fffffff;
  };
  const result = array.slice();
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(next() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

await test('no collisions among well-separated groups', () => {
  const stones = [
    { x: 0, y: 0, d: 3, layerId: 'a' },
    { x: 100, y: 0, d: 3, layerId: 'b' },
    { x: 0, y: 100, d: 3, layerId: 'c' }
  ];
  assert.deepEqual(findCrossGroupCollisions(stones), []);
});

await test('same-group (same layerId) proximity is never flagged, however close', () => {
  const stones = [
    { x: 0, y: 0, d: 3, layerId: 'a' },
    { x: 0.01, y: 0, d: 3, layerId: 'a' }
  ];
  assert.deepEqual(findCrossGroupCollisions(stones), []);
});

await test('a genuine cross-group collision is reported with both group ids', () => {
  const stones = [
    { x: 0, y: 0, d: 3, layerId: 'letter-a' },
    { x: 1, y: 0, d: 3, layerId: 'letter-b' }
  ];
  const collisions = findCrossGroupCollisions(stones);
  assert.equal(collisions.length, 1);
  assert.deepEqual([collisions[0].layerIdA, collisions[0].layerIdB].sort(), ['letter-a', 'letter-b']);
});

await test('a distinct group-pair is reported only once, regardless of how many stones from each group collide', () => {
  const stones = [
    { x: 0, y: 0, d: 3, layerId: 'letter-a' },
    { x: 0.5, y: 0, d: 3, layerId: 'letter-a' },
    { x: 1, y: 0, d: 3, layerId: 'letter-b' },
    { x: 1.5, y: 0, d: 3, layerId: 'letter-b' }
  ];
  const collisions = findCrossGroupCollisions(stones);
  assert.equal(collisions.length, 1, 'expected exactly one distinct letter-a/letter-b pair, not one per colliding stone pair');
});

await test('a collision is never hidden merely because one of the colliding stones happens to also be retained by dedupeStonesByRadius()', () => {
  // dedupeStonesByRadius() greedily drops the later of any colliding pair -- with a chain of three
  // mutually-close, different-group stones, it can report as few as one drop even though every
  // adjacent pair collides. findCrossGroupCollisions() must not inherit that "hidden" behavior: it
  // is a pure query, so it reports every distinct colliding group-pair, not just enough to explain a
  // single drop count.
  // d=2 (threshold 2): a-b distance 1.5 collides, b-c distance 1.5 collides, a-c distance 3 does not
  // -- a real chain where adjacent pairs collide but the endpoints don't.
  const stones = [
    { x: 0, y: 0, d: 2, layerId: 'a' },
    { x: 1.5, y: 0, d: 2, layerId: 'b' },
    { x: 3, y: 0, d: 2, layerId: 'c' }
  ];
  const collisions = findCrossGroupCollisions(stones);
  const pairKeys = collisions.map((c) => [c.layerIdA, c.layerIdB].sort().join('|')).sort();
  assert.deepEqual(pairKeys, ['a|b', 'b|c']);

  // dedupeStonesByRadius() alone, by contrast, can under-report: it only proves *something* was
  // dropped, not which/how many distinct group-pairs were involved -- exactly the ambiguity
  // findCrossGroupCollisions() replaces.
  const kept = dedupeStonesByRadius(stones);
  assert.ok(kept.length < stones.length, 'sanity: this fixture does trigger at least one dedupe drop');
});

await test('the set of reported colliding group-pairs is independent of input (array) order', () => {
  const stones = [
    { x: 0, y: 0, d: 3, layerId: 'letter-a' },
    { x: 1, y: 0, d: 3, layerId: 'letter-b' },
    { x: 50, y: 50, d: 3, layerId: 'letter-c' },
    { x: 0.5, y: 1.5, d: 3, layerId: 'frame' },
    { x: 100, y: 0, d: 3, layerId: 'letter-d' }
  ];
  const baseline = findCrossGroupCollisions(stones)
    .map((c) => [c.layerIdA, c.layerIdB].sort().join('|'))
    .sort();

  for (let seed = 1; seed <= 8; seed++) {
    const permuted = shuffled(stones, seed * 7919);
    const result = findCrossGroupCollisions(permuted)
      .map((c) => [c.layerIdA, c.layerIdB].sort().join('|'))
      .sort();
    assert.deepEqual(result, baseline, `seed ${seed}: collision set changed with input order`);
  }
});

await test('empty and single-stone inputs report no collisions', () => {
  assert.deepEqual(findCrossGroupCollisions([]), []);
  assert.deepEqual(findCrossGroupCollisions([{ x: 0, y: 0, d: 3, layerId: 'a' }]), []);
});

await test('exact production spacing: a pair exactly at the required distance is not a collision, one hair closer is', () => {
  const requiredSpacingMm = 3.1;
  const exact = [
    { x: 0, y: 0, d: requiredSpacingMm, layerId: 'a' },
    { x: requiredSpacingMm, y: 0, d: requiredSpacingMm, layerId: 'b' }
  ];
  assert.deepEqual(findCrossGroupCollisions(exact), []);

  const closer = [
    { x: 0, y: 0, d: requiredSpacingMm, layerId: 'a' },
    { x: requiredSpacingMm - 0.001, y: 0, d: requiredSpacingMm, layerId: 'b' }
  ];
  assert.equal(findCrossGroupCollisions(closer).length, 1);
});

if (process.exitCode === 1) {
  console.error('\nSome MONO-005A collision-query tests failed.');
} else {
  console.log('\nAll MONO-005A collision-query tests passed.');
}
