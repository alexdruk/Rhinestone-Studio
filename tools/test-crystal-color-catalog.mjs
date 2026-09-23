import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// RS-1007 — Crystal Color Library. Verifies the new permanent catalog module
// (src/renderer/CrystalColors.js) directly: required names present, unique/well-formed ids, valid
// hex fields, backward compatibility (the 7 pre-existing ids keep byte-identical render-channel
// values), the STONE_COLORS re-export shim (src/renderer/StoneColors.js) matches the catalog
// exactly, and the catalog's own validator function accepts the shipped catalog and rejects
// deliberately broken fixtures.

const repoRoot = fileURLToPath(new URL('..', import.meta.url));

const {
  CRYSTAL_COLORS,
  STONE_COLORS,
  DEFAULT_CRYSTAL_COLOR_ID,
  getCrystalColor,
  isValidCrystalColorId,
  isValidHexColor,
  listCrystalColorGroups,
  validateCrystalColorCatalog
} = await import('../src/renderer/CrystalColors.js');

const { STONE_COLORS: SHIM_STONE_COLORS } = await import('../src/renderer/StoneColors.js');

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

const REQUIRED_NAMES = [
  'Crystal', 'Crystal AB', 'Jet', 'Siam', 'Light Siam', 'Rose', 'Fuchsia', 'Amethyst',
  'Sapphire', 'Light Sapphire', 'Aquamarine', 'Emerald', 'Peridot', 'Topaz', 'Citrine',
  'Gold', 'Silver',
  'Hematite', 'Black Diamond', 'Grey', 'Smoked Topaz', 'Light Colorado Topaz', 'Light Peach'
];

// IMG-016 decision 2: all 17 pre-IMG-016 entries, in catalogue order, pinned byte-for-byte.
const PRE_IMG016_ENTRIES = [
  ['crystal-clear', 'Clear & Neutral', '#f5f5f5', '#8a8a8a', '#ffffff', '#cfcfcf'],
  ['crystal', 'Clear & Neutral', '#e9f7ff', '#5e7080', '#ffffff', '#92d5ff'],
  ['jet', 'Clear & Neutral', '#141414', '#d9d9d9', '#555', '#000'],
  ['siam', 'Red & Pink', '#9b1c1c', '#4a0d0d', '#ffd9d9', '#6e1313'],
  ['light-siam', 'Red & Pink', '#d9534f', '#8a2f2c', '#ffe0dd', '#b5423e'],
  ['rose', 'Red & Pink', '#ef8fb0', '#8a2c4d', '#ffe2ed', '#d75384'],
  ['fuchsia', 'Red & Pink', '#c2185b', '#6e0d33', '#ffd6ea', '#9c1249'],
  ['amethyst', 'Purple & Blue', '#7e3f98', '#4a2260', '#eaddf7', '#5c2d72'],
  ['sapphire', 'Purple & Blue', '#2269d3', '#0f356f', '#b8d8ff', '#174ca2'],
  ['light-sapphire', 'Purple & Blue', '#6fa8dc', '#2e5c8a', '#dbeeff', '#4a80b5'],
  ['aquamarine', 'Green & Aqua', '#3fc1b0', '#1f6e64', '#d4fff9', '#2a9d8f'],
  ['emerald', 'Green & Aqua', '#2aa66a', '#0b5633', '#c7ffdf', '#16814e'],
  ['peridot', 'Green & Aqua', '#b5cc18', '#6c7d0e', '#f2ffcf', '#8a9c14'],
  ['topaz', 'Yellow & Amber', '#e08e26', '#8a5210', '#ffe3b0', '#b56d1c'],
  ['citrine', 'Yellow & Amber', '#f2c94c', '#9c7a10', '#fff6d1', '#d1a828'],
  ['gold', 'Metallic', '#f3bd32', '#926400', '#fff1a6', '#d18a00'],
  ['silver', 'Metallic', '#d8dde4', '#737b86', '#ffffff', '#a7b0bf']
];

// IMG-016 decision 1: the six appended entries, in order, with their pinned values.
const IMG016_ENTRIES = [
  ['hematite', 'Hematite', 'Metallic', '#3e3f44', '#232326', '#dededf', '#303134'],
  ['black-diamond', 'Black Diamond', 'Clear & Neutral', '#6b6b72', '#3c3c40', '#e6e6e7', '#525258'],
  ['grey', 'Grey', 'Clear & Neutral', '#9a9ca2', '#56575b', '#eeeeef', '#77787d'],
  ['smoked-topaz', 'Smoked Topaz', 'Brown & Peach', '#6e4a2e', '#3e291a', '#e6e0db', '#553923'],
  ['light-colorado', 'Light Colorado Topaz', 'Brown & Peach', '#b98a5c', '#684d34', '#f3ebe3', '#8e6a47'],
  ['light-peach', 'Light Peach', 'Brown & Peach', '#eec6a4', '#856f5c', '#fcf5f0', '#b7987e']
];

// The exact pre-RS-1007 palette (src/renderer/StoneColors.js, 7 entries) — every one of these ids
// must resolve to byte-identical fill/stroke/shine/accent values after this milestone, so a
// project saved before RS-1007 renders unchanged.
const LEGACY_COLORS = {
  crystal: { name: 'Crystal AB', fill: '#e9f7ff', stroke: '#5e7080', shine: '#ffffff', accent: '#92d5ff' },
  gold: { fill: '#f3bd32', stroke: '#926400', shine: '#fff1a6', accent: '#d18a00' },
  silver: { fill: '#d8dde4', stroke: '#737b86', shine: '#ffffff', accent: '#a7b0bf' },
  jet: { fill: '#141414', stroke: '#d9d9d9', shine: '#555', accent: '#000' },
  rose: { fill: '#ef8fb0', stroke: '#8a2c4d', shine: '#ffe2ed', accent: '#d75384' },
  sapphire: { fill: '#2269d3', stroke: '#0f356f', shine: '#b8d8ff', accent: '#174ca2' },
  emerald: { fill: '#2aa66a', stroke: '#0b5633', shine: '#c7ffdf', accent: '#16814e' }
};

await test('1. every required display name is present in the catalog (23 colors since IMG-016)', () => {
  assert.equal(CRYSTAL_COLORS.length, 23, `expected 23 catalog colors, found ${CRYSTAL_COLORS.length}`);
  const names = CRYSTAL_COLORS.map((c) => c.name);
  for (const required of REQUIRED_NAMES) {
    assert.ok(names.includes(required), `expected catalog to include a color named "${required}"`);
  }
});

await test('2. every id is a non-empty, unique, lowercase-kebab string', () => {
  const seen = new Set();
  for (const c of CRYSTAL_COLORS) {
    assert.equal(typeof c.id, 'string');
    assert.ok(c.id.length > 0, 'id must be non-empty');
    assert.match(c.id, /^[a-z][a-z0-9-]*$/, `id "${c.id}" must be lowercase-kebab`);
    assert.ok(!seen.has(c.id), `duplicate id: ${c.id}`);
    seen.add(c.id);
  }
});

await test('3. every entry has a valid name, previewColor, and optional highlight/shadow hex values', () => {
  for (const c of CRYSTAL_COLORS) {
    assert.equal(typeof c.name, 'string');
    assert.ok(c.name.length > 0);
    assert.ok(isValidHexColor(c.previewColor), `${c.id}: previewColor "${c.previewColor}" must be valid hex`);
    if (c.highlight !== undefined && c.highlight !== null) {
      assert.ok(isValidHexColor(c.highlight), `${c.id}: highlight must be valid hex when present`);
    }
    if (c.shadow !== undefined && c.shadow !== null) {
      assert.ok(isValidHexColor(c.shadow), `${c.id}: shadow must be valid hex when present`);
    }
    assert.equal(typeof c.group, 'string');
    assert.ok(c.group.length > 0, 'group must be a non-empty string (used only for UI organization)');
  }
});

await test('4. every entry also exposes the render-channel fields (fill/stroke/shine/accent) every existing consumer reads', () => {
  for (const c of CRYSTAL_COLORS) {
    for (const field of ['fill', 'stroke', 'shine', 'accent']) {
      assert.equal(typeof c[field], 'string', `${c.id}.${field} must be a string`);
      assert.ok(c[field].length > 0, `${c.id}.${field} must be non-empty`);
    }
    // previewColor/highlight/shadow are the literal spec-required aliases of fill/shine/accent.
    assert.equal(c.previewColor, c.fill);
    assert.equal(c.highlight, c.shine);
    assert.equal(c.shadow, c.accent);
  }
});

await test('5. the 7 pre-existing ids keep byte-identical fill/stroke/shine/accent values (backward compatibility)', () => {
  for (const [id, legacy] of Object.entries(LEGACY_COLORS)) {
    const color = getCrystalColor(id);
    assert.ok(color, `expected legacy id "${id}" to still resolve to a catalog entry`);
    assert.equal(color.fill, legacy.fill, `${id}.fill changed`);
    assert.equal(color.stroke, legacy.stroke, `${id}.stroke changed`);
    assert.equal(color.shine, legacy.shine, `${id}.shine changed`);
    assert.equal(color.accent, legacy.accent, `${id}.accent changed`);
    if (legacy.name) assert.equal(color.name, legacy.name, `${id}.name changed`);
  }
  // 'jet' is the one documented label-only change (Jet Black -> Jet); id/values are unchanged above.
  assert.equal(getCrystalColor('jet').name, 'Jet');
});

await test('5a. IMG-016: the 17 pre-IMG-016 entries keep their catalogue position, group and four render channels byte-for-byte', () => {
  const actual = CRYSTAL_COLORS.slice(0, 17).map((c) => [c.id, c.group, c.fill, c.stroke, c.shine, c.accent]);
  assert.deepEqual(actual, PRE_IMG016_ENTRIES);
});

await test('5b. IMG-016: the six new entries are appended last, in order, with their pinned name, group and values', () => {
  const actual = CRYSTAL_COLORS.slice(17).map((c) => [c.id, c.name, c.group, c.fill, c.stroke, c.shine, c.accent]);
  assert.deepEqual(actual, IMG016_ENTRIES);
  assert.deepEqual(CRYSTAL_COLORS.map((c) => c.id), [...PRE_IMG016_ENTRIES.map((e) => e[0]), ...IMG016_ENTRIES.map((e) => e[0])]);
});

await test('6. STONE_COLORS (id-keyed map) matches the catalog array exactly, and the StoneColors.js shim re-exports the identical map', () => {
  assert.equal(Object.keys(STONE_COLORS).length, CRYSTAL_COLORS.length);
  for (const c of CRYSTAL_COLORS) {
    assert.equal(STONE_COLORS[c.id], c);
  }
  assert.equal(SHIM_STONE_COLORS, STONE_COLORS, 'StoneColors.js must re-export the exact same STONE_COLORS object, not a copy');
});

await test('7. getCrystalColor()/isValidCrystalColorId() behave correctly for known and unknown ids', () => {
  assert.equal(getCrystalColor('gold').name, 'Gold');
  assert.equal(getCrystalColor('not-a-real-color'), null);
  assert.ok(isValidCrystalColorId('topaz'));
  assert.ok(!isValidCrystalColorId('not-a-real-color'));
  assert.ok(!isValidCrystalColorId(''));
  assert.ok(!isValidCrystalColorId(undefined));
});

await test('8. DEFAULT_CRYSTAL_COLOR_ID resolves to a real catalog entry (matches app.js defaultProject() default)', () => {
  assert.equal(DEFAULT_CRYSTAL_COLOR_ID, 'gold');
  assert.ok(getCrystalColor(DEFAULT_CRYSTAL_COLOR_ID));
});

await test('9. listCrystalColorGroups() covers every color exactly once, grouped by the `group` field', () => {
  const groups = listCrystalColorGroups();
  const flattened = groups.flatMap((g) => g.colors);
  assert.equal(flattened.length, CRYSTAL_COLORS.length);
  const idsInGroups = new Set(flattened.map((c) => c.id));
  for (const c of CRYSTAL_COLORS) assert.ok(idsInGroups.has(c.id));
  for (const g of groups) {
    for (const c of g.colors) assert.equal(c.group, g.group);
  }
});

await test('10. validateCrystalColorCatalog() accepts the shipped catalog and rejects broken fixtures', () => {
  assert.equal(validateCrystalColorCatalog(), true);
  assert.equal(validateCrystalColorCatalog(CRYSTAL_COLORS), true);

  const base = { id: 'test-color', name: 'Test Color', group: 'Test', previewColor: '#123456' };
  assert.throws(() => validateCrystalColorCatalog([]), TypeError, 'empty catalog must be rejected');
  assert.throws(() => validateCrystalColorCatalog([{ ...base }, { ...base }]), /Duplicate/, 'duplicate id must be rejected');
  assert.throws(() => validateCrystalColorCatalog([{ ...base, id: '' }]), TypeError, 'empty id must be rejected');
  assert.throws(() => validateCrystalColorCatalog([{ ...base, id: 'Not-Kebab' }]), TypeError, 'non-lowercase-kebab id must be rejected');
  assert.throws(() => validateCrystalColorCatalog([{ ...base, name: '' }]), TypeError, 'empty name must be rejected');
  assert.throws(() => validateCrystalColorCatalog([{ ...base, previewColor: 'blue' }]), TypeError, 'non-hex previewColor must be rejected');
  assert.throws(() => validateCrystalColorCatalog([{ ...base, highlight: 'not-hex' }]), TypeError, 'invalid optional highlight must be rejected');
  assert.throws(() => validateCrystalColorCatalog([{ ...base, shadow: 'not-hex' }]), TypeError, 'invalid optional shadow must be rejected');
  // Optional fields really are optional: omitting them entirely must not throw.
  assert.equal(validateCrystalColorCatalog([{ ...base }]), true);
});

await test('11. no manufacturer trademark reference in the catalog module (generic gemstone/color names only)', () => {
  // Not exhaustive brand-name detection -- just a guard against the most obvious mistake (naming
  // a specific manufacturer), per this milestone's explicit "no trademarks" requirement.
  const source = CRYSTAL_COLORS.map((c) => c.name).join(' ').toLowerCase();
  for (const brand of ['swarovski', 'preciosa']) {
    assert.ok(!source.includes(brand), `catalog must not reference manufacturer name "${brand}"`);
  }
});
console.log('Crystal color catalog tests passed.');
