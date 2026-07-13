import assert from 'node:assert/strict';

// RS-1015 — unit tests for the Design Library's pure, DOM-free src/library/** module. No DOM, no
// app.js, no localStorage, no GeometryEngine/StoneLayout/Project/Layer: DesignLibrary only ever
// sees plain JSON-serializable item records, and every test here uses createMemoryStorageAdapter().

const {
  DesignLibrary,
  createLibraryItem,
  cloneLibraryItem,
  deriveCategory,
  createMemoryStorageAdapter,
  prepareLayersForInsert,
  getInsertableLayers,
  buildSelectionItemData,
  buildProjectItemData,
  buildProjectFromItem
} = await import('../src/library/index.js');

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

function sampleTextLayer(overrides = {}) {
  return { id: 'text-1', type: 'text', visible: true, text: 'Hello', x: 0, y: 0, stoneSize: 2, gap: 0.3, color: 'gold', ...overrides };
}

function sampleCircleLayer(overrides = {}) {
  return { id: 'circle-1', type: 'circle', visible: true, cx: 105, cy: 45, r: 18, stoneSize: 2, gap: 0.3, color: 'gold', ...overrides };
}

function sampleProject(overrides = {}) {
  return {
    version: 2, units: 'mm', name: 'Sample Project', product: 'mug',
    canvas: { width: 210, height: 90 }, cupColor: '#1f3556', wrap: 'front',
    layers: [sampleTextLayer(), sampleCircleLayer()],
    ...overrides
  };
}

// ---- LibraryItem ----

await test('createLibraryItem requires a supported kind', () => {
  assert.throws(() => createLibraryItem({ kind: 'bogus', name: 'X', data: {} }), /kind must be one of/);
});

await test('createLibraryItem requires a non-empty name', () => {
  assert.throws(() => createLibraryItem({ kind: 'project', name: '', data: { project: sampleProject() } }), /name must be a non-empty string/);
  assert.throws(() => createLibraryItem({ kind: 'project', data: { project: sampleProject() } }), /name must be a non-empty string/);
});

await test("createLibraryItem requires data.project for kind 'project'", () => {
  assert.throws(() => createLibraryItem({ kind: 'project', name: 'X', data: {} }), /requires data\.project/);
});

await test("createLibraryItem requires a non-empty data.layers array for kind 'selection'", () => {
  assert.throws(() => createLibraryItem({ kind: 'selection', name: 'X', data: {} }), /requires data\.layers/);
  assert.throws(() => createLibraryItem({ kind: 'selection', name: 'X', data: { layers: [] } }), /at least one layer/);
});

await test('createLibraryItem assigns a fresh id, timestamps, and default category per kind', () => {
  const projectItem = createLibraryItem({ kind: 'project', name: 'My Project', data: { project: sampleProject() } });
  assert.equal(projectItem.category, 'Full Project');
  assert.ok(projectItem.id.startsWith('project-'));
  assert.equal(projectItem.created, projectItem.modified);
  assert.equal(projectItem.thumbnail, null);
  assert.deepEqual(projectItem.tags, []);

  const selectionItem = createLibraryItem({ kind: 'selection', name: 'Text Only', data: { canvas: { width: 210, height: 90 }, layers: [sampleTextLayer()] } });
  assert.equal(selectionItem.category, 'Text');
});

await test('createLibraryItem deep-clones its data (no shared references)', () => {
  const layers = [sampleTextLayer()];
  const item = createLibraryItem({ kind: 'selection', name: 'X', data: { canvas: { width: 210, height: 90 }, layers } });
  layers[0].text = 'Mutated after save';
  assert.equal(item.data.layers[0].text, 'Hello', 'the stored item must not observe later mutation of the caller\'s array');
});

await test('deriveCategory: single layer type maps to its label; mixed types map to Mixed', () => {
  assert.equal(deriveCategory([sampleTextLayer()]), 'Text');
  assert.equal(deriveCategory([sampleCircleLayer()]), 'Shapes');
  assert.equal(deriveCategory([{ ...sampleCircleLayer(), type: 'rectangle' }]), 'Shapes');
  assert.equal(deriveCategory([sampleTextLayer(), sampleCircleLayer()]), 'Mixed');
  assert.equal(deriveCategory([{ id: 'svg-1', type: 'svg' }]), 'SVG');
  assert.equal(deriveCategory([{ id: 'img-1', type: 'image' }]), 'Image Trace');
  assert.equal(deriveCategory([{ id: 'path-1', type: 'path' }]), 'Boolean / Path');
  assert.equal(deriveCategory([]), 'Mixed');
});

await test('cloneLibraryItem produces a distinct, re-validated record', () => {
  const original = createLibraryItem({ kind: 'selection', name: 'Original', data: { canvas: { width: 210, height: 90 }, layers: [sampleTextLayer()] } });
  const copy = cloneLibraryItem(original, { name: `${original.name} Copy` });
  assert.notEqual(copy.id, original.id);
  assert.equal(copy.name, 'Original Copy');
  assert.deepEqual(copy.data, original.data);
});

// ---- DesignLibrary CRUD ----

await test('DesignLibrary.add validates and stores an item, list() returns a copy', () => {
  const lib = new DesignLibrary();
  const item = lib.add({ kind: 'project', name: 'A', data: { project: sampleProject() } });
  assert.equal(lib.list().length, 1);
  assert.equal(lib.get(item.id).name, 'A');
  lib.list().push({ id: 'sneaky' });
  assert.equal(lib.list().length, 1, 'list() must return a defensive copy, not the live array');
});

await test('DesignLibrary.rename updates name and modified, throws for a missing id or blank name', () => {
  const lib = new DesignLibrary();
  const item = lib.add({ kind: 'project', name: 'A', data: { project: sampleProject() }, now: '2026-01-01T00:00:00.000Z' });
  const renamed = lib.rename(item.id, 'B', );
  assert.equal(renamed.name, 'B');
  assert.equal(lib.get(item.id).name, 'B');
  assert.throws(() => lib.rename('missing-id', 'X'), /item not found/);
  assert.throws(() => lib.rename(item.id, '   '), /non-empty string/);
});

await test('DesignLibrary.duplicate creates an independent copy with a distinct id', () => {
  const lib = new DesignLibrary();
  const item = lib.add({ kind: 'selection', name: 'Src', data: { canvas: { width: 210, height: 90 }, layers: [sampleTextLayer()] } });
  const dup = lib.duplicate(item.id);
  assert.notEqual(dup.id, item.id);
  assert.equal(dup.name, 'Src Copy');
  assert.equal(lib.list().length, 2);
  lib.rename(item.id, 'Changed');
  assert.equal(lib.get(dup.id).name, 'Src Copy', 'duplicate must not be affected by edits to the source item');
});

await test('DesignLibrary.remove deletes an item and returns whether one was found', () => {
  const lib = new DesignLibrary();
  const item = lib.add({ kind: 'project', name: 'A', data: { project: sampleProject() } });
  assert.equal(lib.remove('missing-id'), false);
  assert.equal(lib.remove(item.id), true);
  assert.equal(lib.list().length, 0);
});

// ---- Search / filter / sort ----

await test('DesignLibrary.search is a case-insensitive substring match over names; empty query returns all', () => {
  const lib = new DesignLibrary();
  lib.add({ kind: 'project', name: 'Birthday Mug', data: { project: sampleProject() } });
  lib.add({ kind: 'project', name: 'Wedding Tumbler', data: { project: sampleProject() } });
  assert.equal(lib.search('birthday').length, 1);
  assert.equal(lib.search('MUG').length, 1);
  assert.equal(lib.search('').length, 2);
  assert.equal(lib.search('   ').length, 2);
  assert.equal(lib.search('zzz').length, 0);
});

await test('DesignLibrary.filterByCategory filters an item list; "All"/falsy passes through unchanged', () => {
  const lib = new DesignLibrary();
  lib.add({ kind: 'selection', name: 'A', data: { canvas: { width: 210, height: 90 }, layers: [sampleTextLayer()] } });
  lib.add({ kind: 'selection', name: 'B', data: { canvas: { width: 210, height: 90 }, layers: [sampleCircleLayer()] } });
  const all = lib.list();
  assert.equal(lib.filterByCategory(all, 'Text').length, 1);
  assert.equal(lib.filterByCategory(all, 'Shapes').length, 1);
  assert.equal(lib.filterByCategory(all, 'All').length, 2);
  assert.equal(lib.filterByCategory(all, null).length, 2);
});

await test('DesignLibrary.categories returns the distinct, alphabetically sorted categories present', () => {
  const lib = new DesignLibrary();
  lib.add({ kind: 'selection', name: 'A', data: { canvas: { width: 210, height: 90 }, layers: [sampleCircleLayer()] } });
  lib.add({ kind: 'selection', name: 'B', data: { canvas: { width: 210, height: 90 }, layers: [sampleTextLayer()] } });
  lib.add({ kind: 'project', name: 'C', data: { project: sampleProject() } });
  assert.deepEqual(lib.categories(), ['Full Project', 'Shapes', 'Text']);
});

await test('DesignLibrary.sortByName sorts case-insensitively, ascending or descending, without mutating the input', () => {
  const lib = new DesignLibrary();
  const items = [{ name: 'banana' }, { name: 'Apple' }, { name: 'cherry' }];
  const asc = lib.sortByName(items, 'asc');
  assert.deepEqual(asc.map((i) => i.name), ['Apple', 'banana', 'cherry']);
  const desc = lib.sortByName(items, 'desc');
  assert.deepEqual(desc.map((i) => i.name), ['cherry', 'banana', 'Apple']);
  assert.deepEqual(items.map((i) => i.name), ['banana', 'Apple', 'cherry'], 'sortByName must not mutate its input array');
});

// ---- Storage adapter round-trip ----

await test('a shared storage adapter persists items across independent DesignLibrary instances ("restart")', () => {
  const adapter = createMemoryStorageAdapter();
  const first = new DesignLibrary({ storageAdapter: adapter });
  first.add({ kind: 'project', name: 'Persisted', data: { project: sampleProject() } });

  const second = new DesignLibrary({ storageAdapter: adapter });
  assert.equal(second.list().length, 1);
  assert.equal(second.list()[0].name, 'Persisted');

  second.rename(second.list()[0].id, 'Renamed After Reload');
  const third = new DesignLibrary({ storageAdapter: adapter });
  assert.equal(third.list()[0].name, 'Renamed After Reload');
});

// ---- LibraryTransform ----

await test('prepareLayersForInsert assigns fresh ids, offsets position, and deep-clones (no shared references)', () => {
  const layers = [sampleTextLayer(), sampleCircleLayer()];
  const prepared = prepareLayersForInsert(layers);
  assert.equal(prepared.length, 2);
  assert.notEqual(prepared[0].id, layers[0].id);
  assert.notEqual(prepared[1].id, layers[1].id);
  assert.equal(prepared[0].x, layers[0].x + 8);
  assert.equal(prepared[0].y, layers[0].y + 8);
  assert.equal(prepared[1].cx, layers[1].cx + 8);
  assert.equal(prepared[1].cy, layers[1].cy + 8);
  assert.equal(prepared[0].text, 'Hello', 'non-position fields must pass through unchanged');
  layers[0].text = 'Mutated';
  assert.equal(prepared[0].text, 'Hello', 'prepareLayersForInsert must not share references with its input');
});

await test('prepareLayersForInsert never produces duplicate ids across repeated calls', () => {
  const layers = [sampleTextLayer()];
  const first = prepareLayersForInsert(layers);
  const second = prepareLayersForInsert(layers);
  assert.notEqual(first[0].id, second[0].id);
});

await test('getInsertableLayers resolves the right layer array per item kind', () => {
  const projectItem = createLibraryItem({ kind: 'project', name: 'P', data: { project: sampleProject() } });
  assert.deepEqual(getInsertableLayers(projectItem), sampleProject().layers);

  const selectionItem = createLibraryItem({ kind: 'selection', name: 'S', data: { canvas: { width: 210, height: 90 }, layers: [sampleTextLayer()] } });
  assert.deepEqual(getInsertableLayers(selectionItem), [sampleTextLayer()]);
});

await test('buildSelectionItemData requires at least one layer and a numeric canvas', () => {
  assert.throws(() => buildSelectionItemData([], { width: 210, height: 90 }), /non-empty array/);
  assert.throws(() => buildSelectionItemData([sampleTextLayer()], {}), /numeric width\/height/);
  const data = buildSelectionItemData([sampleTextLayer()], { width: 210, height: 90 });
  assert.deepEqual(data.canvas, { width: 210, height: 90 });
  assert.equal(data.layers.length, 1);
});

await test('buildProjectItemData deep-clones the whole project verbatim', () => {
  const project = sampleProject();
  const data = buildProjectItemData(project);
  assert.deepEqual(data.project, project);
  project.layers[0].text = 'Mutated after save';
  assert.equal(data.project.layers[0].text, 'Hello', 'buildProjectItemData must not share references with its input');
});

await test("buildProjectFromItem: kind 'project' reproduces the stored project exactly (no offset, no re-id)", () => {
  const project = sampleProject();
  const item = createLibraryItem({ kind: 'project', name: 'P', data: { project } });
  const built = buildProjectFromItem(item, { defaultProduct: 'mug', defaultCupColor: '#000', defaultWrap: 'front', projectVersion: 2 });
  assert.deepEqual(built, project, 'a new project from a saved whole project must be geometry/transform-identical, never nudged');
});

await test("buildProjectFromItem: kind 'selection' wraps the stored layers in a fresh default-shaped project", () => {
  const item = createLibraryItem({ kind: 'selection', name: 'My Selection', data: { canvas: { width: 150, height: 60 }, layers: [sampleTextLayer()] } });
  const built = buildProjectFromItem(item, { defaultProduct: 'mug', defaultCupColor: '#1f3556', defaultWrap: 'front', projectVersion: 2 });
  assert.equal(built.name, 'My Selection');
  assert.equal(built.product, 'mug');
  assert.deepEqual(built.canvas, { width: 150, height: 60 });
  assert.equal(built.layers.length, 1);
  assert.equal(built.layers[0].text, 'Hello');
  assert.equal(built.layers[0].x, 0, 'kind selection must also reproduce geometry exactly, unlike prepareLayersForInsert');
});

await test('buildProjectFromItem rejects an unsupported item kind', () => {
  assert.throws(() => buildProjectFromItem({ kind: 'bogus', data: {} }, {}), /unsupported item kind/);
});

// ---- Performance sanity (several hundred items) ----

await test('DesignLibrary stays responsive with ~500 items: add, search, filter, and sort all complete quickly', () => {
  const lib = new DesignLibrary();
  const kinds = ['text', 'circle', 'rectangle', 'svg', 'image', 'path'];
  for (let i = 0; i < 500; i++) {
    const type = kinds[i % kinds.length];
    lib.add({ kind: 'selection', name: `Design ${i}`, data: { canvas: { width: 210, height: 90 }, layers: [{ id: `l${i}`, type, x: 0, y: 0 }] } });
  }
  const start = Date.now();
  const filtered = lib.filterByCategory(lib.search('Design 4'), 'All');
  const sorted = lib.sortByName(filtered, 'asc');
  const elapsedMs = Date.now() - start;
  assert.ok(sorted.length > 0);
  assert.ok(elapsedMs < 500, `expected search+filter+sort over 500 items to complete quickly, took ${elapsedMs}ms`);
  assert.equal(lib.list().length, 500);
});

console.log('Design Library unit tests passed.');
