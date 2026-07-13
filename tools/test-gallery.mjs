import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// RS-2001 — unit tests for src/gallery/** (the read-only built-in Gallery's pure catalog logic).
// See docs/specifications/RS-2001-GalleryAcceptanceSuite.md for the full rationale.

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const examplesDir = path.join(repoRoot, 'examples');

const {
  parseCatalog,
  search,
  filterByCategory,
  categories,
  featuredEntries,
  getEntry,
  validateRhsProject,
  toAppProjectShape,
  resolveStoneColorId
} = await import('../src/gallery/index.js');

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

async function loadRealSources() {
  const manifest = JSON.parse(await readFile(path.join(examplesDir, 'manifest.json'), 'utf8'));
  const baselines = JSON.parse(await readFile(path.join(examplesDir, 'baselines.json'), 'utf8'));
  const galleryMeta = JSON.parse(await readFile(path.join(examplesDir, 'gallery.json'), 'utf8'));
  const fixtures = {};
  for (const item of galleryMeta.items) {
    fixtures[item.file] = JSON.parse(await readFile(path.join(examplesDir, item.file), 'utf8'));
  }
  return { manifest, baselines, galleryMeta, fixtures };
}

const real = await loadRealSources();

await test('parseCatalog() builds one entry per examples/gallery.json item from the real repo data', async () => {
  const entries = parseCatalog(real);
  assert.equal(entries.length, real.galleryMeta.items.length);
  assert.ok(entries.length >= 27, 'expected at least the 24 original + 3 new customer-scenario fixtures');
});

await test('every gallery.json item is fully covered by manifest.json and baselines.json (bidirectional)', async () => {
  const manifestFiles = new Set(real.manifest.examples.map((e) => e.file));
  const baselineFiles = new Set(real.baselines.baselines.map((b) => b.file));
  const galleryFiles = new Set(real.galleryMeta.items.map((i) => i.file));
  for (const file of galleryFiles) {
    assert.ok(manifestFiles.has(file), `${file} is in gallery.json but missing from manifest.json`);
    assert.ok(baselineFiles.has(file), `${file} is in gallery.json but missing from baselines.json`);
  }
  // Every example in the regression suite is also a browsable Gallery entry -- the Gallery is a
  // complete acceptance surface over the fixture set, not a subset of it.
  for (const file of manifestFiles) {
    assert.ok(galleryFiles.has(file), `${file} is in manifest.json but missing from gallery.json`);
  }
});

await test('stoneCount/layerCount always come from baselines.json, never re-typed by hand', async () => {
  const entries = parseCatalog(real);
  const baselineByFile = new Map(real.baselines.baselines.map((b) => [b.file, b]));
  for (const entry of entries) {
    const baseline = baselineByFile.get(entry.file);
    assert.equal(entry.stoneCount, baseline.stoneCount, `${entry.file}: stoneCount must match baselines.json`);
    assert.equal(entry.layerCount, baseline.layerCount, `${entry.file}: layerCount must match baselines.json`);
    assert.equal(entry.visibleLayerCount, baseline.visibleLayerCount, `${entry.file}: visibleLayerCount must match baselines.json`);
  }
});

await test('objectType always comes from the fixture\'s own product field, never re-typed by hand', async () => {
  const entries = parseCatalog(real);
  for (const entry of entries) {
    const fixture = real.fixtures[entry.file];
    assert.equal(entry.objectType, String(fixture.product || 'mug'), `${entry.file}: objectType must match the fixture's own product field`);
  }
});

await test('parseCatalog() never mutates its inputs', async () => {
  const before = JSON.stringify(real);
  parseCatalog(real);
  assert.equal(JSON.stringify(real), before, 'parseCatalog() must not mutate manifest/baselines/galleryMeta/fixtures');
});

await test('parseCatalog() throws on a gallery.json item missing a manifest.json entry', async () => {
  const broken = {
    ...real,
    galleryMeta: { items: [{ file: 'does-not-exist.rhs', title: 'X', category: 'Names', difficulty: 'beginner' }] }
  };
  assert.throws(() => parseCatalog(broken), /manifest\.json entry/);
});

await test('parseCatalog() throws on a gallery.json item missing a baselines.json entry', async () => {
  const fakeFile = 'circle-only.rhs';
  const brokenBaselines = { baselines: real.baselines.baselines.filter((b) => b.file !== fakeFile) };
  const broken = {
    ...real,
    baselines: brokenBaselines,
    galleryMeta: { items: real.galleryMeta.items.filter((i) => i.file === fakeFile) }
  };
  assert.throws(() => parseCatalog(broken), /baselines\.json entry/);
});

await test('parseCatalog() throws on a duplicate gallery.json entry', async () => {
  const one = real.galleryMeta.items[0];
  const broken = { ...real, galleryMeta: { items: [one, one] } };
  assert.throws(() => parseCatalog(broken), /duplicate/i);
});

await test('parseCatalog() throws on an unrecognized difficulty', async () => {
  const one = { ...real.galleryMeta.items[0], difficulty: 'expert' };
  const broken = { ...real, galleryMeta: { items: [one] } };
  assert.throws(() => parseCatalog(broken), /difficulty/i);
});

await test('search() matches by title, description, category, and tags (case-insensitive)', async () => {
  const entries = parseCatalog(real);
  assert.ok(search(entries, 'wedding').some((e) => e.file === 'wedding-bride-tribe-tumbler.rhs'));
  assert.ok(search(entries, 'MONOGRAM').length >= 2);
  assert.ok(search(entries, '   ').length === entries.length, 'blank query returns every entry');
  assert.ok(search(entries, 'no-such-design-xyz').length === 0);
});

await test('filterByCategory() supports "All", a curated category, and a product pseudo-category', async () => {
  const entries = parseCatalog(real);
  assert.equal(filterByCategory(entries, 'All').length, entries.length);
  assert.equal(filterByCategory(entries, null).length, entries.length);
  const names = filterByCategory(entries, 'Names');
  assert.ok(names.length > 0 && names.every((e) => e.category === 'Names'));
  const bottles = filterByCategory(entries, 'Bottles');
  assert.ok(bottles.length > 0 && bottles.every((e) => e.objectType === 'bottle'));
});

await test('categories() includes curated categories and non-empty product pseudo-categories, sorted, deduped', async () => {
  const entries = parseCatalog(real);
  const cats = categories(entries);
  assert.ok(cats.includes('Names'));
  assert.ok(cats.includes('Wedding'));
  assert.ok(cats.includes('Sports'));
  assert.ok(cats.includes('Business'));
  assert.ok(cats.includes('Bottles'));
  assert.ok(cats.includes('Tumblers'));
  assert.equal(new Set(cats).size, cats.length, 'no duplicate categories');
  assert.deepEqual(cats, [...cats].sort((a, b) => a.localeCompare(b)));
});

await test('featuredEntries() returns only entries flagged featured, and at least one exists', async () => {
  const entries = parseCatalog(real);
  const featured = featuredEntries(entries);
  assert.ok(featured.length > 0);
  assert.ok(featured.every((e) => e.featured === true));
});

await test('getEntry() looks up by file, returns null when absent', async () => {
  const entries = parseCatalog(real);
  assert.equal(getEntry(entries, 'vitalina.rhs').title, 'Classic Name');
  assert.equal(getEntry(entries, 'nope.rhs'), null);
});

await test('opening a Gallery item never mutates the source fixture object (read-only guarantee)', async () => {
  const fixture = real.fixtures['vitalina.rhs'];
  const before = JSON.stringify(fixture);
  const rhsProject = validateRhsProject(fixture, 'vitalina.rhs');
  const appProject = toAppProjectShape(rhsProject);
  appProject.layers[0].text = 'MUTATED';
  appProject.canvas.width = 999;
  assert.equal(JSON.stringify(fixture), before, 'translating a fixture to an editable copy must not mutate the source fixture');
});

await test('src/gallery/index.js re-exports the same RhsFixtureBridge used by the Node regression suite (reuse, not duplication)', async () => {
  const shimSource = await readFile(path.join(repoRoot, 'tools/lib/rhsProject.mjs'), 'utf8');
  assert.match(shimSource, /export \* from ['"]\.\.\/\.\.\/src\/gallery\/RhsFixtureBridge\.js['"]/);
});

await test('every gallery.json fixture passes validateRhsProject() (the one, existing fixture validator)', async () => {
  for (const [file, fixture] of Object.entries(real.fixtures)) {
    assert.doesNotThrow(() => validateRhsProject(fixture, file), `${file} must pass validateRhsProject()`);
  }
});

await test('toAppProjectShape() normalizes legacy stone-color display names to real catalog ids (found via browser verification: vitalina.rhs/vitalina-serbin.rhs store "Crystal AB", the display name, not the id "crystal" -- unmatched by the live app\'s #stoneColor <select>, which corrupted the layer on the next edit)', async () => {
  assert.equal(resolveStoneColorId('Crystal AB'), 'crystal');
  assert.equal(resolveStoneColorId('crystal'), 'crystal', 'an already-valid id must pass through unchanged');
  assert.equal(resolveStoneColorId('gold'), 'gold', 'an already-valid id for a different color must pass through unchanged');
  assert.equal(resolveStoneColorId('Some Unknown Color'), 'Some Unknown Color', 'an unrecognized value passes through unchanged rather than throwing (color is decorative, not a hard requirement)');

  for (const file of ['vitalina.rhs', 'vitalina-serbin.rhs']) {
    const rhsProject = validateRhsProject(real.fixtures[file], file);
    const appProject = toAppProjectShape(rhsProject);
    for (const layer of appProject.layers) {
      assert.notEqual(layer.color, 'Crystal AB', `${file}: app-shape color must be the catalog id, not the display name`);
      assert.equal(layer.color, 'crystal');
    }
  }
});

console.log('Gallery unit test suite passed.');
