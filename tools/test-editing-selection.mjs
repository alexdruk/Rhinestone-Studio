import assert from 'node:assert/strict';

// RS-1009 — unit tests for the pure Set<string> selection helpers in src/editing/Selection.js.
// No DOM, no app.js.

const { selectOnly, toggleSelection, clearSelection, selectMany } = await import('../src/editing/index.js');

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

await test('1. selectOnly returns a Set containing exactly the given id', () => {
  const s = selectOnly('a');
  assert.ok(s instanceof Set);
  assert.deepEqual([...s], ['a']);
});

await test('2. toggleSelection adds an absent id', () => {
  const s = toggleSelection(new Set(['a']), 'b');
  assert.deepEqual([...s].sort(), ['a', 'b']);
});

await test('3. toggleSelection removes a present id', () => {
  const s = toggleSelection(new Set(['a', 'b']), 'a');
  assert.deepEqual([...s], ['b']);
});

await test('4. toggling the same id twice is a no-op relative to the start', () => {
  const start = new Set(['a', 'b']);
  const once = toggleSelection(start, 'c');
  const twice = toggleSelection(once, 'c');
  assert.deepEqual([...twice].sort(), [...start].sort());
});

await test('5. toggleSelection never mutates its input Set', () => {
  const start = new Set(['a']);
  const result = toggleSelection(start, 'b');
  assert.deepEqual([...start], ['a'], 'input Set must be untouched');
  assert.notEqual(result, start, 'must return a new Set instance');
});

await test('6. clearSelection returns an empty Set', () => {
  const s = clearSelection();
  assert.equal(s.size, 0);
});

await test('7. removing the last id via toggleSelection empties the selection', () => {
  const s = toggleSelection(new Set(['only']), 'only');
  assert.equal(s.size, 0);
});

await test('8. selectMany (RS-1010) returns a Set containing exactly the given ids', () => {
  const s = selectMany(['a', 'b', 'c']);
  assert.ok(s instanceof Set);
  assert.deepEqual([...s].sort(), ['a', 'b', 'c']);
});

await test('9. selectMany([]) returns an empty Set (never throws on an empty duplicate batch)', () => {
  assert.equal(selectMany([]).size, 0);
});

console.log('Editing selection tests passed.');
