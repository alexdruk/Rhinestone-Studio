import assert from 'node:assert/strict';

// RC-005 — unit tests for the generic, dependency-free autosave/crash-recovery module in
// src/persistence/**. No DOM, no app.js, no real localStorage: AutosaveManager only ever sees
// plain JSON-serializable {project,selectedLayerId} state its caller passes in, mirroring
// src/history/HistoryManager.js's and src/library/DesignLibrary.js's existing "pure logic,
// storage/clock injected" shape (test-history-manager.mjs, test-design-library.mjs).

const { AutosaveManager, createLocalStorageAdapter, createMemoryStorageAdapter } = await import('../src/persistence/index.js');

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

function sampleProject(overrides = {}) {
  return {
    version: 2, units: 'mm', name: 'Sample Project', product: 'mug',
    canvas: { width: 210, height: 90 }, cupColor: '#1f3556', wrap: 'front',
    layers: [{ id: 'text', type: 'text', visible: true, text: 'Hi', x: 0, y: 0, stoneSize: 2, gap: 0.3, color: 'gold' }],
    ...overrides
  };
}

// A minimal fake Storage (Map-backed) with the same getItem/setItem/removeItem surface
// createLocalStorageAdapter() expects, so these tests exercise the real localStorage-shaped
// adapter without touching Node's absent global localStorage.
function fakeStorage(initial = new Map()) {
  return {
    _map: initial,
    getItem(key) { return this._map.has(key) ? this._map.get(key) : null; },
    setItem(key, value) { this._map.set(key, String(value)); },
    removeItem(key) { this._map.delete(key); }
  };
}

// ---- AutosaveManager (memory adapter, controlled clock) ----

await test('save() then load() round-trips project and selectedLayerId', () => {
  const mgr = new AutosaveManager({ storageAdapter: createMemoryStorageAdapter(), now: () => 1000 });
  const project = sampleProject();
  mgr.save({ project, selectedLayerId: 'text' });
  const recovered = mgr.load();
  assert.deepEqual(recovered.project, project);
  assert.equal(recovered.selectedLayerId, 'text');
  assert.equal(recovered.savedAt, 1000);
});

await test('save() deep-clones project (no shared reference with the caller\'s live object)', () => {
  const mgr = new AutosaveManager({ storageAdapter: createMemoryStorageAdapter(), now: () => 1000 });
  const project = sampleProject();
  mgr.save({ project, selectedLayerId: 'text' });
  project.name = 'Mutated after save';
  const recovered = mgr.load();
  assert.equal(recovered.project.name, 'Sample Project', 'stored copy must be unaffected by later mutation of the caller\'s object');
});

await test('load() returns null with nothing ever saved', () => {
  const mgr = new AutosaveManager({ storageAdapter: createMemoryStorageAdapter() });
  assert.equal(mgr.load(), null);
});

await test('load() defaults a missing selectedLayerId to null rather than throwing', () => {
  const mgr = new AutosaveManager({ storageAdapter: createMemoryStorageAdapter(), now: () => 1000 });
  mgr.save({ project: sampleProject() });
  assert.equal(mgr.load().selectedLayerId, null);
});

await test('save() overwrites the single slot -- there is never more than one recovery record', () => {
  const mgr = new AutosaveManager({ storageAdapter: createMemoryStorageAdapter(), now: () => 1000 });
  mgr.save({ project: sampleProject({ name: 'First' }), selectedLayerId: 'text' });
  mgr.save({ project: sampleProject({ name: 'Second' }), selectedLayerId: 'text' });
  assert.equal(mgr.load().project.name, 'Second');
});

await test('clear() removes the record; load() then returns null', () => {
  const mgr = new AutosaveManager({ storageAdapter: createMemoryStorageAdapter(), now: () => 1000 });
  mgr.save({ project: sampleProject(), selectedLayerId: 'text' });
  mgr.clear();
  assert.equal(mgr.load(), null);
});

await test('load() rejects a record older than maxAgeMs (stale recovery data) and clears it', () => {
  const storageAdapter = createMemoryStorageAdapter();
  let clock = 0;
  const mgr = new AutosaveManager({ storageAdapter, maxAgeMs: 1000, now: () => clock });
  mgr.save({ project: sampleProject(), selectedLayerId: 'text' });
  clock = 500;
  assert.ok(mgr.load(), 'still within maxAgeMs: recoverable');
  clock = 1001;
  assert.equal(mgr.load(), null, 'older than maxAgeMs: no longer offered for recovery');
  assert.equal(storageAdapter.load(), null, 'the stale record itself was cleared, not just hidden from load()');
});

await test('load() rejects and clears a record from an unrecognized schema version', () => {
  const storageAdapter = createMemoryStorageAdapter();
  storageAdapter.save({ schemaVersion: 999, savedAt: 1000, project: sampleProject(), selectedLayerId: 'text' });
  const mgr = new AutosaveManager({ storageAdapter, now: () => 1000 });
  assert.equal(mgr.load(), null);
  assert.equal(storageAdapter.load(), null, 'an unrecognized-schema record is cleared, not left to reappear on a later boot');
});

await test('load() degrades a corrupt/malformed stored value to null instead of throwing', () => {
  for (const bad of [{}, { schemaVersion: 1 }, { schemaVersion: 1, savedAt: 'not-a-number', project: sampleProject() }, { schemaVersion: 1, savedAt: 1000, project: 'not-an-object' }, null, 'a bare string', 42]) {
    const storageAdapter = createMemoryStorageAdapter();
    storageAdapter.save(bad);
    const mgr = new AutosaveManager({ storageAdapter, now: () => 1000 });
    assert.doesNotThrow(() => mgr.load());
    assert.equal(mgr.load(), null, `expected null for ${JSON.stringify(bad)}`);
  }
});

await test('an old-shape (pre-milestone) Project JSON round-trips through save/load untouched -- backward compatibility', () => {
  // AutosaveManager treats `project` as opaque JSON -- it never reads/validates its fields (that's
  // app.js's validateProject() job, at restore time, exactly like Import already does). A project
  // missing every field added by later milestones (name/plate/wrap/etc.) must still save and load
  // back out byte-for-byte.
  const legacyProject = { canvas: { width: 210, height: 90 }, layers: [{ id: 'text', type: 'text', text: 'Old', visible: true }] };
  const mgr = new AutosaveManager({ storageAdapter: createMemoryStorageAdapter(), now: () => 1000 });
  mgr.save({ project: legacyProject, selectedLayerId: 'text' });
  assert.deepEqual(mgr.load().project, legacyProject);
});

// ---- createMemoryStorageAdapter() ----

await test('createMemoryStorageAdapter: load()/save()/clear() work and load() deep-clones on the way out', () => {
  const adapter = createMemoryStorageAdapter();
  assert.equal(adapter.load(), null);
  const value = { a: 1 };
  adapter.save(value);
  const loaded = adapter.load();
  assert.deepEqual(loaded, value);
  loaded.a = 2;
  assert.equal(adapter.load().a, 1, 'load() must return an independent copy, not the live stored object');
  adapter.clear();
  assert.equal(adapter.load(), null);
});

// ---- createLocalStorageAdapter() ----

await test('createLocalStorageAdapter: throws when no Storage is available', () => {
  assert.throws(() => createLocalStorageAdapter('k', null), /localStorage is not available/);
});

await test('createLocalStorageAdapter: save()/load()/clear() round-trip through the given Storage', () => {
  const storage = fakeStorage();
  const adapter = createLocalStorageAdapter('rhinestone-studio:autosave', storage);
  assert.equal(adapter.load(), null);
  adapter.save({ schemaVersion: 1, savedAt: 1, project: sampleProject(), selectedLayerId: 'text' });
  assert.equal(storage._map.size, 1, 'exactly one key used -- one recovery slot');
  const loaded = adapter.load();
  assert.equal(loaded.selectedLayerId, 'text');
  adapter.clear();
  assert.equal(adapter.load(), null);
  assert.equal(storage._map.size, 0);
});

await test('createLocalStorageAdapter: a corrupt (non-JSON) stored value degrades to null instead of throwing', () => {
  const storage = fakeStorage(new Map([['rhinestone-studio:autosave', '{not valid json']]));
  const adapter = createLocalStorageAdapter('rhinestone-studio:autosave', storage);
  assert.doesNotThrow(() => adapter.load());
  assert.equal(adapter.load(), null);
});

await test('createLocalStorageAdapter: a stored JSON array (wrong shape) degrades to null instead of throwing', () => {
  const storage = fakeStorage(new Map([['rhinestone-studio:autosave', '[1,2,3]']]));
  const adapter = createLocalStorageAdapter('rhinestone-studio:autosave', storage);
  assert.equal(adapter.load(), null);
});

await test('AutosaveManager wired to the real localStorage-shaped adapter: full recover-then-clear crash-recovery flow', () => {
  const storage = fakeStorage();
  const mgr = new AutosaveManager({ storageAdapter: createLocalStorageAdapter('rhinestone-studio:autosave', storage), now: () => 5000 });
  // Simulate meaningful edits autosaving.
  mgr.save({ project: sampleProject({ name: 'Work in progress' }), selectedLayerId: 'text' });
  // Simulate a refresh/crash: a brand-new AutosaveManager reading the same underlying Storage.
  const mgrAfterRefresh = new AutosaveManager({ storageAdapter: createLocalStorageAdapter('rhinestone-studio:autosave', storage), now: () => 5100 });
  const recovered = mgrAfterRefresh.load();
  assert.equal(recovered.project.name, 'Work in progress');
  // Simulate a manual Save: app.js clears the slot so a *later* refresh has nothing stale to offer.
  mgrAfterRefresh.clear();
  const mgrAfterSaveThenRefresh = new AutosaveManager({ storageAdapter: createLocalStorageAdapter('rhinestone-studio:autosave', storage), now: () => 5200 });
  assert.equal(mgrAfterSaveThenRefresh.load(), null, 'nothing left to recover once the work was manually saved');
});
