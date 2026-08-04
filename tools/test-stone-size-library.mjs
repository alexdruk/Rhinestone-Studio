import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

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
  validateStoneSizeCatalog,
  stoneSizeHeightMidpointMm,
  isHeightWithinStoneSizeRange,
  stoneSizeEntirelyExceedsPrintableHeight
} = await import('../src/renderer/StoneSizes.js');

const repoRoot = fileURLToPath(new URL('..', import.meta.url));

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

// Every fixture below carries a valid supportedHeightRangeMm so the assertion under test (id/name/
// diameterMm shape) is isolated from FONT-DECISION-001's own supportedHeightRangeMm checks (test 11).
const RANGE = { supportedHeightRangeMm: [10, 20] };

await test('9. validateStoneSizeCatalog() accepts the shipped catalog and rejects broken fixtures', () => {
  assert.equal(validateStoneSizeCatalog(), true);
  assert.equal(validateStoneSizeCatalog(STONE_SIZES), true);

  assert.throws(() => validateStoneSizeCatalog([]), TypeError, 'empty catalog must be rejected');
  assert.throws(
    () => validateStoneSizeCatalog([{ id: 'a', name: 'A', diameterMm: 1, ...RANGE }, { id: 'a', name: 'B', diameterMm: 2, ...RANGE }]),
    /Duplicate/,
    'duplicate id must be rejected'
  );
  assert.throws(
    () => validateStoneSizeCatalog([{ id: 'a', name: 'A', diameterMm: 1, ...RANGE }, { id: 'b', name: 'A', diameterMm: 2, ...RANGE }]),
    /Duplicate/,
    'duplicate name must be rejected'
  );
  assert.throws(() => validateStoneSizeCatalog([{ id: '', name: 'A', diameterMm: 1, ...RANGE }]), TypeError, 'empty id must be rejected');
  assert.throws(() => validateStoneSizeCatalog([{ id: 'Not-Kebab', name: 'A', diameterMm: 1, ...RANGE }]), TypeError, 'non-lowercase-kebab id must be rejected');
  assert.throws(() => validateStoneSizeCatalog([{ id: 'a', name: '', diameterMm: 1, ...RANGE }]), TypeError, 'empty name must be rejected');
  assert.throws(() => validateStoneSizeCatalog([{ id: 'a', name: 'A', diameterMm: 0, ...RANGE }]), TypeError, 'zero diameterMm must be rejected');
  assert.throws(() => validateStoneSizeCatalog([{ id: 'a', name: 'A', diameterMm: -1, ...RANGE }]), TypeError, 'negative diameterMm must be rejected');
  assert.throws(
    () => validateStoneSizeCatalog([{ id: 'a', name: 'A', diameterMm: 3, ...RANGE }, { id: 'b', name: 'B', diameterMm: 2, ...RANGE }]),
    /ascending/,
    'non-ascending diameterMm order must be rejected'
  );
});

await test('11. validateStoneSizeCatalog() validates supportedHeightRangeMm shape', () => {
  assert.throws(
    () => validateStoneSizeCatalog([{ id: 'a', name: 'A', diameterMm: 1 }]),
    /supportedHeightRangeMm/,
    'missing supportedHeightRangeMm must be rejected'
  );
  assert.throws(
    () => validateStoneSizeCatalog([{ id: 'a', name: 'A', diameterMm: 1, supportedHeightRangeMm: [10] }]),
    /supportedHeightRangeMm/,
    'a single-element range must be rejected'
  );
  assert.throws(
    () => validateStoneSizeCatalog([{ id: 'a', name: 'A', diameterMm: 1, supportedHeightRangeMm: [10, -5] }]),
    /supportedHeightRangeMm/,
    'a non-positive range bound must be rejected'
  );
  assert.throws(
    () => validateStoneSizeCatalog([{ id: 'a', name: 'A', diameterMm: 1, supportedHeightRangeMm: [20, 10] }]),
    /min < max/,
    'a min >= max range must be rejected'
  );
  assert.equal(validateStoneSizeCatalog([{ id: 'a', name: 'A', diameterMm: 1, supportedHeightRangeMm: [10, 20] }]), true);
});

// FONT-DECISION-001: tools/font-generator/config/SS*.json's own supportedHeightRangeMm is the
// calibration source these catalog values are mirrored from (see StoneSizes.js's doc comment) --
// this proves they can never silently drift apart, since that JSON isn't imported at runtime (it's
// offline Python-tooling config, not shipped to the browser app; see FONT-DECISION-001 milestone
// notes on why a live fetch of tools/ config isn't used here).
await test('12. every catalog supportedHeightRangeMm exactly matches its tools/font-generator/config/SS*.json source', async () => {
  for (const s of STONE_SIZES) {
    const configPath = path.join(repoRoot, 'tools/font-generator/config', `${s.name}.json`);
    const config = JSON.parse(await readFile(configPath, 'utf8'));
    assert.deepEqual(
      s.supportedHeightRangeMm,
      config.supportedHeightRangeMm,
      `${s.name} catalog supportedHeightRangeMm must match ${configPath}`
    );
  }
});

await test('13. stoneSizeHeightMidpointMm() returns each catalog size\'s validated midpoint', () => {
  assert.equal(stoneSizeHeightMidpointMm(getStoneSize('ss6')), 42.5);
  assert.equal(stoneSizeHeightMidpointMm(getStoneSize('ss10')), 52.5);
  assert.equal(stoneSizeHeightMidpointMm(getStoneSize('ss16')), 77.5);
  assert.equal(stoneSizeHeightMidpointMm(getStoneSize('ss20')), 95);
  assert.equal(stoneSizeHeightMidpointMm(getStoneSize('ss30')), 108.5);
});

await test('14. isHeightWithinStoneSizeRange() is inclusive of both range bounds', () => {
  const ss16 = getStoneSize('ss16'); // [65,90]
  assert.ok(isHeightWithinStoneSizeRange(ss16, 65));
  assert.ok(isHeightWithinStoneSizeRange(ss16, 90));
  assert.ok(isHeightWithinStoneSizeRange(ss16, 77.5));
  assert.ok(!isHeightWithinStoneSizeRange(ss16, 64.9));
  assert.ok(!isHeightWithinStoneSizeRange(ss16, 90.1));
});

await test('15. stoneSizeEntirelyExceedsPrintableHeight() is true only when the whole range is too tall', () => {
  const ss20 = getStoneSize('ss20'); // [80,110]
  assert.ok(stoneSizeEntirelyExceedsPrintableHeight(ss20, 65), 'a 65mm printable height fits none of SS20\'s [80,110] range');
  assert.ok(!stoneSizeEntirelyExceedsPrintableHeight(ss20, 90), 'a 90mm printable height fits part of SS20\'s [80,110] range (80-90)');
  assert.ok(!stoneSizeEntirelyExceedsPrintableHeight(ss20, 129), 'a 129mm printable height fits all of SS20\'s [80,110] range');
});

await test('16. no manufacturer trademark reference in the catalog module (generic industry size names only)', () => {
  const source = STONE_SIZES.map((s) => s.name).join(' ').toLowerCase();
  for (const brand of ['swarovski', 'preciosa']) {
    assert.ok(!source.includes(brand), `catalog must not reference manufacturer name "${brand}"`);
  }
});

console.log('Stone size library tests passed.');
