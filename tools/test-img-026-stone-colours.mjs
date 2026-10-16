// IMG-026 build G -- the 17 catalogue colours re-measured from the supplier catalogue: their new
// fills, the legacyFill that keeps legacy image fill modes unchanged, the layout service's
// prototypeFill, the prompt palette line and the exporters. See
// docs/specifications/IMG-026-StrassLayoutService.md, "Pupils and stone colours (build G)", the
// Build G acceptance figures and "Tests the builds must add" (G).
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { CRYSTAL_COLORS, STONE_COLORS, LEGACY_IMAGE_COLOR_IDS } from '../src/renderer/CrystalColors.js';
import { stoneCircleSvg } from '../src/export/SvgExporter.js';
import { buildPaletteLine } from '../server/redraw/prompt.mjs';
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

const read = (rel) => readFile(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
const appJs = await read('../app.js');
const serviceCatalogue = JSON.parse(await read('../services/strass-layout/strass_layout/catalogue.json'));

// [id, legacy fill, re-measured fill]
const REMEASURED = [
  ['siam', '#9b1c1c', '#7a1b2c'],
  ['light-siam', '#d9534f', '#9f112a'],
  ['rose', '#ef8fb0', '#d65d9b'],
  ['fuchsia', '#c2185b', '#902b74'],
  ['amethyst', '#7e3f98', '#903f8a'],
  ['sapphire', '#2269d3', '#2f83c3'],
  ['light-sapphire', '#6fa8dc', '#94b5dd'],
  ['aquamarine', '#3fc1b0', '#65bcc2'],
  ['emerald', '#2aa66a', '#217456'],
  ['peridot', '#b5cc18', '#6bb760'],
  ['topaz', '#e08e26', '#b6741e'],
  ['black-diamond', '#6b6b72', '#60726d'],
  ['smoked-topaz', '#6e4a2e', '#583f2d'],
  ['light-colorado', '#b98a5c', '#c38e43'],
  ['light-peach', '#eec6a4', '#e2a791'],
  ['light-smoked-topaz', '#8a6a4a', '#826244'],
  ['scarlet', '#d0101e', '#bb1a33']
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

function extractFunctionSource(source, startMarker) {
  const start = source.indexOf(startMarker);
  assert.ok(start !== -1, `expected to find ${startMarker} in app.js`);
  const braceStart = start + startMarker.length - 1;
  let depth = 0;
  for (let i = braceStart; i < source.length; i++) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}') { depth--; if (depth === 0) return source.slice(start, i + 1); }
  }
  throw new Error(`expected the closing brace of ${startMarker}`);
}

await test('1. catalogue: the 17 re-measured entries carry the pinned new fill and their old fill as legacyFill; stroke, shine and accent follow the shading rule; every other entry has legacyFill === fill', () => {
  const ids = REMEASURED.map((r) => r[0]);
  for (const [id, legacyFill, fill] of REMEASURED) {
    const c = STONE_COLORS[id];
    assert.equal(c.fill, fill, `${id}.fill`);
    assert.equal(c.previewColor, fill, `${id}.previewColor`);
    assert.equal(c.legacyFill, legacyFill, `${id}.legacyFill`);
    assert.deepEqual({ stroke: c.stroke, shine: c.shine, accent: c.accent }, applyShadingRule(fill), `${id} follows the rule`);
  }
  for (const c of CRYSTAL_COLORS.filter((x) => !ids.includes(x.id))) assert.equal(c.legacyFill, c.fill, `${c.id} keeps its colour`);
  for (const id of ['crystal-clear', 'crystal', 'jet', 'citrine', 'gold', 'silver', 'hematite', 'grey', 'colorado-topaz', 'hyacinth']) {
    assert.ok(!ids.includes(id), `${id} has no catalogue photo and is not re-measured`);
  }
});

await test('2. S4: catalogue.json matches on every field, and carries prototypeFill (the legacyFill) exactly on the re-measured entries', () => {
  for (const c of CRYSTAL_COLORS) {
    const entry = serviceCatalogue[c.id];
    for (const field of ['name', 'fill', 'stroke', 'shine', 'accent']) assert.equal(entry[field], c[field], `${c.id}.${field}`);
    if (c.legacyFill !== c.fill) assert.equal(entry.prototypeFill, c.legacyFill, `${c.id}.prototypeFill`);
    else assert.ok(!('prototypeFill' in entry), `${c.id} has no prototypeFill`);
  }
});

await test('3. S13: imageColorPalette() quantises against legacyFill, so legacy image layers keep their stones', () => {
  const source = extractFunctionSource(appJs, 'function imageColorPalette(){');
  // eslint-disable-next-line no-new-func
  const imageColorPalette = new Function('STONE_COLORS', `let imageColorPaletteCache=null;\n${source}\nreturn imageColorPalette;`)(STONE_COLORS);
  const palette = Object.fromEntries(imageColorPalette().map((p) => [p.id, p.hex]));
  assert.deepEqual(Object.keys(palette), [...LEGACY_IMAGE_COLOR_IDS]);
  for (const [id, legacyFill] of REMEASURED) if (LEGACY_IMAGE_COLOR_IDS.includes(id)) assert.equal(palette[id], legacyFill, id);
});

await test('4. prompt and exporters use the re-measured colour', () => {
  const pairs = buildPaletteLine(undefined, true).split(', ');
  for (const [id, , fill] of REMEASURED) assert.ok(pairs.includes(`${STONE_COLORS[id].name} ${fill}`), `${id} in the palette line`);
  const svg = stoneCircleSvg({ xMm: 1, yMm: 1, sizeMm: 2, color: 'topaz' });
  assert.ok(svg.includes('fill="#b6741e"') && svg.includes(`stroke="${STONE_COLORS.topaz.stroke}"`));
});

await test('5. registration: test-img-026-stone-colours.mjs is in the core group and the default suite', () => {
  assertTestRegistered({ filename: 'test-img-026-stone-colours.mjs', group: 'core', includedInDefault: true });
});
