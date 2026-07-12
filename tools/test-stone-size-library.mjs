import assert from 'node:assert/strict';

// RS-1013 — Variable Stone Sizes. Verifies the new Stone Library catalog module
// (src/renderer/StoneSizes.js) directly: required commercial sizes present with correct
// diameters, unique/well-formed ids and names, ascending-diameter ordering, the tolerant
// diameter-matching lookup used by both the #stoneSize picker (app.js) and the Production Sheet
// header (src/export/ProductionSheetExporter.js), the "name + mm" label formatter, and the
// catalog's own validator accepting the shipped catalog and rejecting deliberately broken
// fixtures — mirroring tools/test-crystal-color-catalog.mjs's approach for the same purpose.

const {
  STONE_SIZES,
  STONE_SIZE_BY_ID,
  DEFAULT_STONE_SIZE_ID,
  getStoneSize,
  isValidStoneSizeId,
  listStoneSizes,
  findStoneSizeByDiameterMm,
  formatStoneSizeLabel,
  validateStoneSizeCatalog
} = await import('../src/renderer/StoneSizes.js');

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

// The five sizes this milestone's spec explicitly names as "Examples" -- required to exist, with
// their commonly-cited nominal diameters.
const REQUIRED_SIZES = {
  SS6: 2.0,
  SS10: 2.8,
  SS16: 4.0,
  SS20: 4.7,
  SS30: 6.4
};

await test('1. every required commercial size is present with its documented nominal diameter', () => {
  for (const [name, diameterMm] of Object.entries(REQUIRED_SIZES)) {
    const entry = STONE_SIZES.find((s) => s.name === name);
    assert.ok(entry, `expected catalog to include a size named "${name}"`);
    assert.equal(entry.diameterMm, diameterMm, `${name} diameterMm mismatch`);
  }
  assert.equal(STONE_SIZES.length, Object.keys(REQUIRED_SIZES).length, 'expected exactly the 5 spec-required sizes (extensible later, not pre-padded)');
});

await test('2. every id is a non-empty, unique, lowercase-kebab string; every name is unique', () => {
  const seenIds = new Set();
  const seenNames = new Set();
  for (const s of STONE_SIZES) {
    assert.equal(typeof s.id, 'string');
    assert.match(s.id, /^[a-z][a-z0-9-]*$/, `id "${s.id}" must be lowercase-kebab`);
    assert.ok(!seenIds.has(s.id), `duplicate id: ${s.id}`);
    seenIds.add(s.id);
    assert.ok(!seenNames.has(s.name), `duplicate name: ${s.name}`);
    seenNames.add(s.name);
  }
});

await test('3. diameterMm is a positive finite number for every entry, strictly ascending catalog order', () => {
  let previous = -Infinity;
  for (const s of STONE_SIZES) {
    assert.equal(typeof s.diameterMm, 'number');
    assert.ok(Number.isFinite(s.diameterMm) && s.diameterMm > 0);
    assert.ok(s.diameterMm > previous, `catalog must be sorted ascending by diameterMm (broke at ${s.id})`);
    previous = s.diameterMm;
  }
});

await test('4. STONE_SIZE_BY_ID matches the catalog array exactly; getStoneSize()/isValidStoneSizeId() behave correctly', () => {
  assert.equal(Object.keys(STONE_SIZE_BY_ID).length, STONE_SIZES.length);
  for (const s of STONE_SIZES) assert.equal(STONE_SIZE_BY_ID[s.id], s);

  assert.equal(getStoneSize('ss16').name, 'SS16');
  assert.equal(getStoneSize('not-a-real-size'), null);
  assert.ok(isValidStoneSizeId('ss6'));
  assert.ok(!isValidStoneSizeId('not-a-real-size'));
  assert.ok(!isValidStoneSizeId(''));
  assert.ok(!isValidStoneSizeId(undefined));
});

await test('5. DEFAULT_STONE_SIZE_ID resolves to a real entry matching app.js\'s 2mm default layer stoneSize', () => {
  const entry = getStoneSize(DEFAULT_STONE_SIZE_ID);
  assert.ok(entry);
  assert.equal(entry.diameterMm, 2.0, 'default catalog size must match the 2mm default a new layer\'s stoneSize already uses');
});

await test('6. listStoneSizes() returns every entry, in catalog order, as a defensive copy', () => {
  const list = listStoneSizes();
  assert.deepEqual(list, STONE_SIZES);
  list.push({ id: 'fake', name: 'Fake', diameterMm: 99 });
  assert.equal(STONE_SIZES.length, list.length - 1, 'mutating the returned list must not mutate the catalog');
});

await test('7. findStoneSizeByDiameterMm() matches within tolerance, returns null for custom/legacy values', () => {
  assert.equal(findStoneSizeByDiameterMm(4.0).name, 'SS16');
  assert.equal(findStoneSizeByDiameterMm(4.003).name, 'SS16', 'small float drift must still match');
  assert.equal(findStoneSizeByDiameterMm(1.5), null, 'a legacy/custom mm value with no catalog match must return null, not the nearest size');
  assert.equal(findStoneSizeByDiameterMm(2.5), null);
  assert.equal(findStoneSizeByDiameterMm(NaN), null);
  assert.equal(findStoneSizeByDiameterMm(undefined), null);
});

await test('8. formatStoneSizeLabel() shows commercial name + mm for a catalog match, plain mm otherwise', () => {
  assert.equal(formatStoneSizeLabel(4.0), 'SS16 (4 mm)');
  assert.equal(formatStoneSizeLabel(2.0), 'SS6 (2 mm)');
  assert.equal(formatStoneSizeLabel(1.5), '1.5 mm');
  assert.equal(formatStoneSizeLabel(1.234), '1.23 mm');
});

await test('9. validateStoneSizeCatalog() accepts the shipped catalog and rejects broken fixtures', () => {
  assert.equal(validateStoneSizeCatalog(), true);
  assert.equal(validateStoneSizeCatalog(STONE_SIZES), true);

  assert.throws(() => validateStoneSizeCatalog([]), TypeError, 'empty catalog must be rejected');
  assert.throws(
    () => validateStoneSizeCatalog([{ id: 'a', name: 'A', diameterMm: 1 }, { id: 'a', name: 'B', diameterMm: 2 }]),
    /Duplicate/,
    'duplicate id must be rejected'
  );
  assert.throws(
    () => validateStoneSizeCatalog([{ id: 'a', name: 'A', diameterMm: 1 }, { id: 'b', name: 'A', diameterMm: 2 }]),
    /Duplicate/,
    'duplicate name must be rejected'
  );
  assert.throws(() => validateStoneSizeCatalog([{ id: '', name: 'A', diameterMm: 1 }]), TypeError, 'empty id must be rejected');
  assert.throws(() => validateStoneSizeCatalog([{ id: 'Not-Kebab', name: 'A', diameterMm: 1 }]), TypeError, 'non-lowercase-kebab id must be rejected');
  assert.throws(() => validateStoneSizeCatalog([{ id: 'a', name: '', diameterMm: 1 }]), TypeError, 'empty name must be rejected');
  assert.throws(() => validateStoneSizeCatalog([{ id: 'a', name: 'A', diameterMm: 0 }]), TypeError, 'zero diameterMm must be rejected');
  assert.throws(() => validateStoneSizeCatalog([{ id: 'a', name: 'A', diameterMm: -1 }]), TypeError, 'negative diameterMm must be rejected');
  assert.throws(
    () => validateStoneSizeCatalog([{ id: 'a', name: 'A', diameterMm: 3 }, { id: 'b', name: 'B', diameterMm: 2 }]),
    /ascending/,
    'non-ascending diameterMm order must be rejected'
  );
});

await test('10. no manufacturer trademark reference in the catalog module (generic industry size names only)', () => {
  const source = STONE_SIZES.map((s) => s.name).join(' ').toLowerCase();
  for (const brand of ['swarovski', 'preciosa']) {
    assert.ok(!source.includes(brand), `catalog must not reference manufacturer name "${brand}"`);
  }
});

console.log('Stone size library tests passed.');
