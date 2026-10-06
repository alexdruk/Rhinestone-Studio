// IMG-026 build B -- the colour catalogue: the four D2 entries and their pinned values, the S4
// cross-check against the layout service's strass_layout/catalogue.json, and the S13 legacy pin
// (app.js's imageColorPalette() quantises against the 23 pre-v2 ids only). See
// docs/specifications/IMG-026-StrassLayoutService.md, "Tests the builds must add" (B).
//
// Reads app.js and catalogue.json as text; never runs the layout service or touches the network.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { CRYSTAL_COLORS, STONE_COLORS, LEGACY_IMAGE_COLOR_IDS, listCrystalColorGroups } from '../src/renderer/CrystalColors.js';
import { assertTestRegistered } from './lib/test-registration-assertions.mjs';

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

const appJs = await readFile(fileURLToPath(new URL('../app.js', import.meta.url)), 'utf8');
const serviceCatalogue = JSON.parse(await readFile(fileURLToPath(new URL('../services/strass-layout/strass_layout/catalogue.json', import.meta.url)), 'utf8'));

// D2, exactly as the spec's table.
const D2_ENTRIES = [
  ['colorado-topaz', 'Colorado Topaz', 'Brown & Peach', '#a0602c', '#5a3619', '#efe4db', '#7b4a22'],
  ['light-smoked-topaz', 'Light Smoked Topaz', 'Brown & Peach', '#8a6a4a', '#4d3b29', '#ebe6e0', '#6a5239'],
  ['scarlet', 'Scarlet', 'Red & Pink', '#d0101e', '#740911', '#f7d6d9', '#a00c17'],
  ['hyacinth', 'Hyacinth', 'Yellow & Amber', '#e0581c', '#7d3110', '#fae3d8', '#ac4416']
];

const PRE_V2_IDS = [
  'crystal-clear', 'crystal', 'jet', 'siam', 'light-siam', 'rose', 'fuchsia', 'amethyst', 'sapphire',
  'light-sapphire', 'aquamarine', 'emerald', 'peridot', 'topaz', 'citrine', 'gold', 'silver',
  'hematite', 'black-diamond', 'grey', 'smoked-topaz', 'light-colorado', 'light-peach'
];

const hex2 = (n) => n.toString(16).padStart(2, '0');
function applyShadingRule(fill) {
  const rgb = [1, 3, 5].map((i) => parseInt(fill.slice(i, i + 2), 16));
  const channel = (f) => `#${rgb.map((v) => hex2(f(v))).join('')}`;
  return {
    stroke: channel((v) => Math.round(0.56 * v)),
    shine: channel((v) => Math.round(v + 0.83 * (255 - v))),
    accent: channel((v) => Math.round(0.77 * v))
  };
}

// The same brace-matching extraction tools/test-img-010-line-design.mjs uses for
// generateImageStonesLive().
function extractFunctionSource(source, startMarker) {
  const start = source.indexOf(startMarker);
  assert.ok(start !== -1, `expected to find ${startMarker} in app.js`);
  const braceStart = start + startMarker.length - 1;
  let depth = 0;
  for (let i = braceStart; i < source.length; i++) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}') { depth--; if (depth === 0) return source.slice(start, i + 1); }
  }
  throw new Error(`expected to find the matching closing "}" of ${startMarker} in app.js`);
}

const paletteSource = extractFunctionSource(appJs, 'function imageColorPalette(){');

function appJsLegacyLiteral() {
  const match = paletteSource.match(/const legacyIds=(\[[^\]]*\]);/);
  assert.ok(match, 'expected a literal `const legacyIds=[...]` inside imageColorPalette()');
  return JSON.parse(match[1].replace(/'/g, '"'));
}

await test('1. D2: the four entries are appended after light-peach, in order, with the pinned name, group and values, which follow the IMG-016 shading rule', () => {
  assert.equal(CRYSTAL_COLORS.length, 27);
  assert.equal(CRYSTAL_COLORS[22].id, 'light-peach');
  assert.deepEqual(CRYSTAL_COLORS.slice(23, 27).map((c) => [c.id, c.name, c.group, c.fill, c.stroke, c.shine, c.accent]), D2_ENTRIES);
  for (const [id, , , fill, stroke, shine, accent] of D2_ENTRIES) {
    assert.deepEqual(applyShadingRule(fill), { stroke, shine, accent }, `${id} follows the rule`);
    assert.equal(STONE_COLORS[id].previewColor, fill);
    assert.equal(STONE_COLORS[id].highlight, shine);
    assert.equal(STONE_COLORS[id].shadow, accent);
  }
  const groups = Object.fromEntries(listCrystalColorGroups().map((g) => [g.group, g.colors.map((c) => c.id)]));
  assert.deepEqual(groups['Brown & Peach'].slice(-2), ['colorado-topaz', 'light-smoked-topaz']);
  assert.equal(groups['Red & Pink'].at(-1), 'scarlet');
  assert.equal(groups['Yellow & Amber'].at(-1), 'hyacinth');
});

await test('2. S4: catalogue.json has the 27 app ids in catalogue order, and each entry equals the CrystalColors.js entry on name, fill, stroke, shine and accent', () => {
  assert.deepEqual(Object.keys(serviceCatalogue), CRYSTAL_COLORS.map((c) => c.id));
  for (const [id, entry] of Object.entries(serviceCatalogue)) {
    const color = STONE_COLORS[id];
    assert.ok(color, `catalogue.json id ${id} is not in CrystalColors.js`);
    for (const field of ['name', 'fill', 'stroke', 'shine', 'accent']) {
      assert.equal(entry[field], color[field], `${id}.${field}`);
    }
  }
});

await test('3. S13: LEGACY_IMAGE_COLOR_IDS is the frozen list of the 23 pre-v2 ids, which are the first 23 catalogue entries', () => {
  assert.ok(Object.isFrozen(LEGACY_IMAGE_COLOR_IDS));
  assert.deepEqual([...LEGACY_IMAGE_COLOR_IDS], PRE_V2_IDS);
  assert.deepEqual(CRYSTAL_COLORS.slice(0, 23).map((c) => c.id), PRE_V2_IDS);
});

await test('4. S13: the literal array inside app.js\'s imageColorPalette() equals LEGACY_IMAGE_COLOR_IDS', () => {
  assert.deepEqual(appJsLegacyLiteral(), [...LEGACY_IMAGE_COLOR_IDS]);
});

await test('5. S13: the extracted imageColorPalette(), with STONE_COLORS injected, returns exactly the 23 legacy {id, hex} entries in catalogue order, and caches them', () => {
  // eslint-disable-next-line no-new-func
  const imageColorPalette = new Function('STONE_COLORS', `let imageColorPaletteCache=null;\n${paletteSource}\nreturn imageColorPalette;`)(STONE_COLORS);
  const palette = imageColorPalette();
  assert.deepEqual(palette, LEGACY_IMAGE_COLOR_IDS.map((id) => ({ id, hex: STONE_COLORS[id].previewColor })));
  assert.equal(palette.length, 23);
  assert.ok(palette.every((p) => !['colorado-topaz', 'light-smoked-topaz', 'scarlet', 'hyacinth'].includes(p.id)));
  assert.equal(imageColorPalette(), palette, 'the second call returns the cached array');
});

await test('6. registration: test-img-026-catalogue.mjs is in the core group and the default suite', () => {
  assertTestRegistered({ filename: 'test-img-026-catalogue.mjs', group: 'core', includedInDefault: true });
});
