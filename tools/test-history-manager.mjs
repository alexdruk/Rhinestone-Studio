import assert from 'node:assert/strict';

// RS-1002 — unit tests for the generic, dependency-free undo/redo stack in
// src/history/HistoryManager.js. No DOM, no app.js, no Project/Layer/StoneLayout: HistoryManager
// only ever sees plain JSON-serializable state its caller passes in.

const { HistoryManager } = await import('../src/history/index.js');

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

await test('1. sequential undo/redo replays states in the correct order', () => {
  const h = new HistoryManager();
  const s0 = { text: 'a' };
  h.commit(s0);
  const s1 = { text: 'b' };
  h.commit(s1);
  const s2 = { text: 'c' };
  h.commit(s2);
  const current = { text: 'd' };

  const back1 = h.undo(current);
  assert.deepEqual(back1, s2, 'first undo should restore the most recent committed state');
  const back2 = h.undo(back1);
  assert.deepEqual(back2, s1);
  const back3 = h.undo(back2);
  assert.deepEqual(back3, s0);
  assert.equal(h.canUndo, false, 'no more steps to undo');
  assert.equal(h.undo(back3), null, 'undo on an empty past stack returns null');

  // Redo must replay forward through the exact same states, in forward order: the state we
  // undid *from* at each step (s1, then s2, then the original `current`).
  const fwd1 = h.redo(back3);
  assert.deepEqual(fwd1, s1);
  const fwd2 = h.redo(fwd1);
  assert.deepEqual(fwd2, s2);
  const fwd3 = h.redo(fwd2);
  assert.deepEqual(fwd3, current);
  assert.equal(h.canRedo, false);
  assert.equal(h.redo(fwd3), null, 'redo on an empty future stack returns null');
});

await test('2. branch after undo discards the redo stack', () => {
  const h = new HistoryManager();
  h.commit({ v: 1 });
  h.commit({ v: 2 });
  const current = { v: 3 };

  const restored = h.undo(current);
  assert.deepEqual(restored, { v: 2 });
  assert.equal(h.canRedo, true, 'redo should be available right after undo');

  // A brand-new edit (a new commit) must discard the old future.
  h.commit(restored);
  assert.equal(h.canRedo, false, 'redo must be cleared once a new edit branches off');
  assert.equal(h.redo(restored), null, 'the discarded future must actually be gone, not just hidden');
});

await test('3. history limit evicts the oldest entries', () => {
  const h = new HistoryManager({ maxSize: 3 });
  h.commit({ v: 1 });
  h.commit({ v: 2 });
  h.commit({ v: 3 });
  h.commit({ v: 4 });
  h.commit({ v: 5 });
  assert.equal(h.pastSize, 3, 'past stack must be capped at maxSize');

  let current = { v: 6 };
  current = h.undo(current);
  assert.deepEqual(current, { v: 5 }, 'undo should restore the most recently committed state');
  current = h.undo(current);
  assert.deepEqual(current, { v: 4 });
  current = h.undo(current);
  assert.deepEqual(current, { v: 3 }, 'the oldest retained entry (v:1 and v:2 were evicted)');
  assert.equal(h.canUndo, false, 'only 3 undo steps should ever have been retained');
  assert.equal(h.undo(current), null);
});

await test('4. beginSession()/endSession() coalesce rapid calls into one step', () => {
  const h = new HistoryManager();
  const beforeSession1 = { text: '' };

  const opened1 = h.beginSession(beforeSession1);
  assert.equal(opened1, true, 'first beginSession() in a session opens it and commits');
  // Every subsequent beginSession() call within the same session (one per keystroke) is a no-op:
  // its argument is discarded, so only the state at the *start* of the session was ever recorded.
  const opened2 = h.beginSession({ text: 'a' });
  assert.equal(opened2, false, 'a second beginSession() while open is a no-op');
  const opened3 = h.beginSession({ text: 'ab' });
  assert.equal(opened3, false);
  assert.equal(h.pastSize, 1, 'multiple beginSession() calls in one session push only one entry');

  h.endSession();
  const beforeSession2 = { text: 'abc' };
  const opened4 = h.beginSession(beforeSession2);
  assert.equal(opened4, true, 'beginSession() after endSession() opens a fresh session');
  assert.equal(h.pastSize, 2, 'a new session after endSession() pushes a second, separate entry');

  const current = { text: 'abcd' };
  const restored1 = h.undo(current);
  assert.deepEqual(restored1, beforeSession2, 'second session should restore the state recorded when it began');
  const restored2 = h.undo(restored1);
  assert.deepEqual(restored2, beforeSession1, 'first session should restore the original pre-edit state');
});

await test('5. clear() empties both stacks and closes an open session', () => {
  const h = new HistoryManager();
  h.commit({ v: 1 });
  h.beginSession({ v: 2 });
  h.undo({ v: 3 });
  assert.equal(h.canRedo, true);

  h.clear();
  assert.equal(h.canUndo, false);
  assert.equal(h.canRedo, false);
  assert.equal(h.sessionOpen, false);
  assert.equal(h.undo({ v: 99 }), null);
  assert.equal(h.redo({ v: 99 }), null);

  // A commit right after clear() must not resurrect anything from before.
  h.commit({ v: 100 });
  assert.equal(h.pastSize, 1);
});

await test('6. snapshots are isolated from later mutation of the caller\'s object', () => {
  const h = new HistoryManager();
  const state = { layers: [{ id: 'a', color: 'gold' }] };
  h.commit(state);

  // Mutate the object *after* committing it — history must be unaffected.
  state.layers[0].color = 'jet';
  state.layers.push({ id: 'b', color: 'silver' });

  const restored = h.undo({ layers: [] });
  assert.deepEqual(restored, { layers: [{ id: 'a', color: 'gold' }] }, 'commit() must snapshot state at call time, not by reference');

  // Mutating a returned snapshot must not corrupt HistoryManager's internal state.
  restored.layers[0].color = 'mutated';
  restored.layers.push({ id: 'c' });
  const redone = h.redo(restored);
  assert.deepEqual(redone, { layers: [] }, 'redo() result must be independent of a previously-returned, since-mutated object');
});

await test('7. undo()/redo() on a brand-new instance return null without throwing', () => {
  const h = new HistoryManager();
  assert.equal(h.undo({ any: 'thing' }), null);
  assert.equal(h.redo({ any: 'thing' }), null);
  assert.equal(h.canUndo, false);
  assert.equal(h.canRedo, false);
});

await test('8. constructor validates maxSize', () => {
  assert.throws(() => new HistoryManager({ maxSize: 0 }), RangeError);
  assert.throws(() => new HistoryManager({ maxSize: -5 }), RangeError);
  assert.throws(() => new HistoryManager({ maxSize: 1.5 }), RangeError);
  assert.throws(() => new HistoryManager({ maxSize: 'ten' }), RangeError);
  assert.doesNotThrow(() => new HistoryManager());
  assert.doesNotThrow(() => new HistoryManager({ maxSize: 1 }));
});

console.log('History manager tests passed.');
