import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createImageBuffer, prepareImageField } from '../src/image/index.js';
import { prepareAutoColorField, chooseAutoColorCount } from '../src/image/AutoColourCount.js';
import { labelCatalogColors } from '../src/image/ColorQuantize.js';
import { generateLineDesignStonePoints, LINE_DESIGN_INK_REFERENCE_COLOR_IDS } from '../src/geometry/LineDesignSampler.js';
import { CRYSTAL_COLORS, STONE_COLORS, listCrystalColorGroups, isValidCrystalColorId, validateCrystalColorCatalog } from '../src/renderer/CrystalColors.js';

// IMG-016 -- neutral and brown stones. Six entries appended to the crystal-colour catalogue, one
// derivation rule for their render channels (decision 1), every stone-colour <select> fed from that
// one catalogue (decision 6), IMG-015's floor and cap unchanged with 23 colours (decision 4), and
// Line Design's ink structure pinned to the 17 pre-IMG-016 ids with line stones voting among ink
// pixels only (decision 3). See docs/specifications/IMG-016-NeutralBrownStones.md.
//
// Items 1-5 are the selector guard (decision 6's five rules). Items 6-7 pin decision 1. Item 8 is the
// 23-colour floor and cap on a synthetic fixture. Items 9-10 are Line Design's two obligations.
// Mutation-tested: entries inserted before an existing colour (items 6, 7, 8), a hand-written option
// list for one selector (items 1, 4), ink labelled against the live catalogue (item 10), line stones
// voting over all pixels (item 10), the ink-only vote applied to fill stones (item 10), one new shine
// value changed (item 6), light-peach removed (items 6, 7, 8).

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

const PALETTE = Object.values(STONE_COLORS).map((c) => ({ id: c.id, hex: c.previewColor }));
const hexToRgb = (hex) => {
  const h = hex.replace('#', '');
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
};
const rgbToHex = (rgb) => `#${rgb.map((v) => v.toString(16).padStart(2, '0')).join('')}`;

const appJs = await readFile(fileURLToPath(new URL('../app.js', import.meta.url)), 'utf8');
const indexHtml = await readFile(fileURLToPath(new URL('../index.html', import.meta.url)), 'utf8');

// ---- Decision 6: the selector guard ---------------------------------------------------------------
const STONE_COLOR_SELECT_IDS = [
  'stoneColor', 'stampColor', 'traceColor', 'paintColor', 'monogramColor', 'monogramFrameColor',
  'imgColorPick0', 'imgColorPick1', 'imgColorPick2', 'imgColorPick3',
  'imgColorPick4', 'imgColorPick5', 'imgColorPick6', 'imgColorPick7'
];
const PRODUCT_COLOR_SELECT_IDS = ['cupColor', 'plateColor'];
// Not a colour select at all: the image Studio's "Number of colours" count (IMG-012), whose id
// happens to match rule 3's /colou?r/i.
const NON_COLOR_SELECT_IDS = ['imgColorCount'];

const POPULATE_DEF = 'function populateStoneColorOptions(';

function sliceBraceBalanced(source, startIndex) {
  const open = source.indexOf('{', startIndex);
  assert.ok(open !== -1, 'expected an opening brace');
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}') { depth--; if (depth === 0) return source.slice(startIndex, i + 1); }
  }
  throw new Error('unbalanced braces');
}

const populateStart = appJs.indexOf(POPULATE_DEF);
const populateSource = populateStart === -1 ? '' : sliceBraceBalanced(appJs, populateStart);
const populateBody = populateSource.slice(populateSource.indexOf('{') + 1, -1);
const appJsWithoutPopulate = populateStart === -1 ? appJs : appJs.slice(0, populateStart) + appJs.slice(populateStart + populateSource.length);
const codeLines = (source) => source.split('\n').filter((line) => !line.trimStart().startsWith('//')).join('\n');

function selectIdsInIndexHtml() {
  return [...indexHtml.matchAll(/<select\b[^>]*\bid="([^"]+)"/g)].map((m) => m[1]);
}
function selectInnerHtml(id) {
  const m = new RegExp(`<select\\b[^>]*\\bid="${id}"[^>]*>([\\s\\S]*?)</select>`).exec(indexHtml);
  return m ? m[1] : null;
}
function populatedSelectIds() {
  const ids = [];
  const code = codeLines(appJsWithoutPopulate);
  for (const m of code.matchAll(/(for\(let (\w+)=0;\2<(\d+);\2\+\+\))?populateStoneColorOptions\(([^)]*)\)/g)) {
    const arg = m[4].trim();
    if (arg === '') { ids.push('stoneColor'); continue; }
    const literal = /^'(\w+)'$/.exec(arg);
    if (literal) { ids.push(literal[1]); continue; }
    const template = /^`(\w+)\$\{(\w+)\}`$/.exec(arg);
    if (template && m[1] && template[2] === m[2]) {
      for (let i = 0; i < Number(m[3]); i++) ids.push(`${template[1]}${i}`);
      continue;
    }
    throw new Error(`unrecognised populateStoneColorOptions() call argument: ${arg}`);
  }
  return ids;
}

await test('1. rule 1: populateStoneColorOptions() populates exactly the 14 pinned stone-colour <select>s, each once, each present in index.html', () => {
  const populated = populatedSelectIds();
  assert.deepEqual([...populated].sort(), [...STONE_COLOR_SELECT_IDS].sort());
  const inHtml = selectIdsInIndexHtml();
  for (const id of STONE_COLOR_SELECT_IDS) assert.ok(inHtml.includes(id), `expected <select id="${id}"> in index.html`);
});

await test('2. rule 2: no pinned stone-colour <select> has an <option> or <optgroup> in index.html', () => {
  for (const id of STONE_COLOR_SELECT_IDS) {
    const inner = selectInnerHtml(id);
    assert.notEqual(inner, null, `expected <select id="${id}"> in index.html`);
    assert.doesNotMatch(inner, /<option|<optgroup/i, `${id} has a hand-written option list`);
  }
});

await test('3. rule 3: every <select> whose id matches /colou?r/i is a pinned stone-colour, product-colour or non-colour select', () => {
  const known = new Set([...STONE_COLOR_SELECT_IDS, ...PRODUCT_COLOR_SELECT_IDS, ...NON_COLOR_SELECT_IDS]);
  const unknown = selectIdsInIndexHtml().filter((id) => /colou?r/i.test(id) && !known.has(id));
  assert.deepEqual(unknown, []);
  for (const id of PRODUCT_COLOR_SELECT_IDS) assert.match(selectInnerHtml(id), /<option/, `${id} keeps its hand-written product-colour list`);
});

await test('4. rule 4: populateStoneColorOptions() reads only Object.values(STONE_COLORS), and nothing else in app.js writes options into a pinned select', () => {
  assert.notEqual(populateStart, -1, 'expected populateStoneColorOptions() in app.js');
  assert.equal(populateBody.split('Object.values(STONE_COLORS)').length - 1, 1, 'expected exactly one Object.values(STONE_COLORS) read');
  const otherData = [...populateBody.replace('Object.values(STONE_COLORS)', '').matchAll(/\b[A-Z][A-Z0-9_]{2,}\b/g)].map((m) => m[0]);
  assert.deepEqual(otherData, [], 'expected no other constant read in the body');
  assert.doesNotMatch(populateBody, /value="(?!\$\{c\.id\})/, 'expected every option value to come from the catalogue entry');

  const code = codeLines(appJsWithoutPopulate);
  const pinnedRef = `(?:el|document\\.getElementById)\\(\\s*(?:'(?:${STONE_COLOR_SELECT_IDS.join('|')})'|"(?:${STONE_COLOR_SELECT_IDS.join('|')})"|\`imgColorPick\\$\\{\\w+\\}\`)\\s*\\)`;
  const write = '\\s*\\.\\s*(?:innerHTML|outerHTML|insertAdjacentHTML|add\\s*\\(|appendChild|append\\s*\\(|replaceChildren)';
  assert.deepEqual([...code.matchAll(new RegExp(pinnedRef + write, 'g'))].map((m) => m[0]), [], 'direct write into a pinned select');
  const boundNames = [...code.matchAll(new RegExp(`(?:const|let|var)\\s+(\\w+)\\s*=\\s*${pinnedRef}`, 'g'))].map((m) => m[1]);
  for (const name of new Set(boundNames)) {
    assert.deepEqual([...code.matchAll(new RegExp(`\\b${name}${write}`, 'g'))].map((m) => m[0]), [], `write into a pinned select through ${name}`);
  }
});

await test('5. rule 5: executed for real, populateStoneColorOptions() emits exactly CRYSTAL_COLORS.length options, grouped as listCrystalColorGroups() groups them', () => {
  const elements = new Map();
  const el = (id) => { if (!elements.has(id)) elements.set(id, { innerHTML: '' }); return elements.get(id); };
  const escapeHtml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  // eslint-disable-next-line no-new-func
  const populate = new Function('STONE_COLORS', 'el', 'escapeHtml', `${populateSource}\nreturn populateStoneColorOptions;`)(STONE_COLORS, el, escapeHtml);
  const expected = listCrystalColorGroups().map((g) => [g.group, g.colors.map((c) => [c.id, c.name])]);
  populate();
  for (const id of STONE_COLOR_SELECT_IDS.slice(1)) populate(id);
  assert.deepEqual([...elements.keys()].sort(), [...STONE_COLOR_SELECT_IDS].sort());
  for (const [id, { innerHTML }] of elements) {
    assert.equal((innerHTML.match(/<option\b/g) || []).length, CRYSTAL_COLORS.length, `${id}: option count`);
    const unescape = (s) => s.replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
    const groups = [...innerHTML.matchAll(/<optgroup label="([^"]*)">([\s\S]*?)<\/optgroup>/g)].map((m) => [
      unescape(m[1]), [...m[2].matchAll(/<option value="([^"]*)">([^<]*)<\/option>/g)].map((o) => [o[1], unescape(o[2])])
    ]);
    assert.deepEqual(groups, expected, `${id}: grouping`);
  }
});

// ---- Decision 1: appended entries, derivation rule, pinned values ---------------------------------
const PINNED_NEW_ENTRIES = [
  { id: 'hematite', name: 'Hematite', group: 'Metallic', fill: '#3e3f44', stroke: '#232326', shine: '#dededf', accent: '#303134' },
  { id: 'black-diamond', name: 'Black Diamond', group: 'Clear & Neutral', fill: '#6b6b72', stroke: '#3c3c40', shine: '#e6e6e7', accent: '#525258' },
  { id: 'grey', name: 'Grey', group: 'Clear & Neutral', fill: '#9a9ca2', stroke: '#56575b', shine: '#eeeeef', accent: '#77787d' },
  { id: 'smoked-topaz', name: 'Smoked Topaz', group: 'Brown & Peach', fill: '#6e4a2e', stroke: '#3e291a', shine: '#e6e0db', accent: '#553923' },
  { id: 'light-colorado', name: 'Light Colorado Topaz', group: 'Brown & Peach', fill: '#b98a5c', stroke: '#684d34', shine: '#f3ebe3', accent: '#8e6a47' },
  { id: 'light-peach', name: 'Light Peach', group: 'Brown & Peach', fill: '#eec6a4', stroke: '#856f5c', shine: '#fcf5f0', accent: '#b7987e' }
];
const RULE = { stroke: 0.56, accent: 0.77, shine: 0.83 };
const applyRule = (fill) => {
  const v = hexToRgb(fill);
  return {
    stroke: rgbToHex(v.map((c) => Math.round(RULE.stroke * c))),
    shine: rgbToHex(v.map((c) => Math.round(c + RULE.shine * (255 - c)))),
    accent: rgbToHex(v.map((c) => Math.round(RULE.accent * c)))
  };
};
const median = (values) => {
  const s = [...values].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};

await test('6. decision 1: the six entries are appended after silver with their pinned values, which are the derivation rule applied to fill; the rule\'s constants are the medians over the 15 rule entries', () => {
  assert.equal(CRYSTAL_COLORS.length, 23);
  assert.equal(CRYSTAL_COLORS[16].id, 'silver');
  const appended = CRYSTAL_COLORS.slice(17).map(({ id, name, group, fill, stroke, shine, accent }) => ({ id, name, group, fill, stroke, shine, accent }));
  assert.deepEqual(appended, PINNED_NEW_ENTRIES);
  for (const entry of PINNED_NEW_ENTRIES) {
    assert.deepEqual(applyRule(entry.fill), { stroke: entry.stroke, shine: entry.shine, accent: entry.accent }, `${entry.id} follows the rule`);
    const color = STONE_COLORS[entry.id];
    assert.equal(color.previewColor, entry.fill);
    assert.equal(color.highlight, entry.shine);
    assert.equal(color.shadow, entry.accent);
  }
  const lum = (hex) => hexToRgb(hex).reduce((a, b) => a + b, 0);
  assert.ok(lum(STONE_COLORS.hematite.stroke) < lum(STONE_COLORS.hematite.fill), 'hematite\'s stroke is darker than its fill');
  assert.doesNotThrow(() => validateCrystalColorCatalog());

  const ruleEntries = CRYSTAL_COLORS.slice(0, 17).filter((c) => c.id !== 'jet' && c.id !== 'crystal');
  assert.equal(ruleEntries.length, 15);
  const ratios = { stroke: [], accent: [], shine: [] };
  for (const c of ruleEntries) {
    const f = hexToRgb(c.fill), st = hexToRgb(c.stroke), ac = hexToRgb(c.accent), sh = hexToRgb(c.shine);
    for (let i = 0; i < 3; i++) {
      ratios.stroke.push(st[i] / f[i]);
      ratios.accent.push(ac[i] / f[i]);
      ratios.shine.push((sh[i] - f[i]) / (255 - f[i]));
    }
  }
  const medians = Object.fromEntries(Object.entries(ratios).map(([k, v]) => [k, median(v)]));
  assert.deepEqual(Object.values(ratios).map((v) => v.length), [45, 45, 45]);
  assert.deepEqual(Object.fromEntries(Object.entries(medians).map(([k, v]) => [k, v.toFixed(3)])), { stroke: '0.557', accent: '0.768', shine: '0.833' });
  assert.deepEqual(Object.fromEntries(Object.entries(medians).map(([k, v]) => [k, Number(v.toFixed(2))])), RULE);
});

await test('7. decision 1: flat catalogue order and selector group order', () => {
  assert.deepEqual(CRYSTAL_COLORS.map((c) => c.id), [
    'crystal-clear', 'crystal', 'jet', 'siam', 'light-siam', 'rose', 'fuchsia', 'amethyst', 'sapphire',
    'light-sapphire', 'aquamarine', 'emerald', 'peridot', 'topaz', 'citrine', 'gold', 'silver',
    'hematite', 'black-diamond', 'grey', 'smoked-topaz', 'light-colorado', 'light-peach'
  ]);
  assert.deepEqual(listCrystalColorGroups().map((g) => [g.group, g.colors.map((c) => c.id)]), [
    ['Clear & Neutral', ['crystal-clear', 'crystal', 'jet', 'black-diamond', 'grey']],
    ['Red & Pink', ['siam', 'light-siam', 'rose', 'fuchsia']],
    ['Purple & Blue', ['amethyst', 'sapphire', 'light-sapphire']],
    ['Green & Aqua', ['aquamarine', 'emerald', 'peridot']],
    ['Yellow & Amber', ['topaz', 'citrine']],
    ['Metallic', ['gold', 'silver', 'hematite']],
    ['Brown & Peach', ['smoked-topaz', 'light-colorado', 'light-peach']]
  ]);
});

// ---- Decision 4: floor and cap with 23 colours ----------------------------------------------------
// Ten vertical bands of catalogue fills (widths 9..3 columns, all clear the 1.2% floor) plus a 3x10
// gold block (0.83%, under the floor) in the right-hand siam band's top rows. The cap keeps the eight
// largest raw shares and drops topaz and siam; gold, topaz and siam relabel to their nearest kept
// colours.
const FIELD_PARAMS = { threshold: 255, invert: false, blurRadiusPx: 0, maxWidthPx: 60, maxHeightPx: 60, transparent: 'white', maskMode: 'threshold' };
const CAP_BANDS = [['hematite', 9], ['black-diamond', 8], ['grey', 7], ['smoked-topaz', 7], ['light-colorado', 6], ['light-peach', 6], ['jet', 5], ['silver', 5], ['topaz', 4], ['siam', 3]];
function buildCapBuffer(n = 60) {
  const rgbOf = (id) => hexToRgb(PALETTE.find((entry) => entry.id === id).hex);
  const data = new Uint8ClampedArray(n * n * 4);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    let c = [255, 255, 255];
    let edge = 0;
    for (const [id, width] of CAP_BANDS) { edge += width; if (x < edge) { c = rgbOf(id); break; } }
    if (x >= 57 && y < 10) c = rgbOf('gold');
    const i = (y * n + x) * 4;
    data[i] = c[0]; data[i + 1] = c[1]; data[i + 2] = c[2]; data[i + 3] = 255;
  }
  return { widthPx: n, heightPx: n, data };
}

await test('8. decision 4: with 23 colours, ten colours clear the floor, gold does not, Auto caps at 8 dropping topaz and siam, and the kept groups are pinned', () => {
  const buffer = createImageBuffer(buildCapBuffer());
  const autoField = prepareAutoColorField(buffer, FIELD_PARAMS);
  const uncapped = labelCatalogColors({ ...autoField, eligible: autoField.data.map((v) => (v >= 128 ? 1 : 0)), palette: PALETTE });
  assert.deepEqual(uncapped.keptIds.map((c) => PALETTE[c].id), ['jet', 'siam', 'topaz', 'silver', 'hematite', 'black-diamond', 'grey', 'smoked-topaz', 'light-colorado', 'light-peach']);
  assert.equal(uncapped.rawCounts[PALETTE.findIndex((p) => p.id === 'gold')], 30);
  const auto = chooseAutoColorCount(autoField, PALETTE).resolvedCount;
  assert.equal(auto, 8);
  const field = prepareImageField(buffer, { ...FIELD_PARAMS, colorCount: auto, palette: PALETTE });
  assert.deepEqual(field.colorGroups.map((g) => ({ id: g.nearestId, rgb: g.rgb, share: (g.pixelShare * 100).toFixed(2) })), [
    { id: 'jet', rgb: [20, 20, 20], share: '8.33' },
    { id: 'silver', rgb: [216, 221, 228], share: '8.33' },
    { id: 'hematite', rgb: [62, 63, 68], share: '15.00' },
    { id: 'black-diamond', rgb: [107, 107, 114], share: '13.33' },
    { id: 'grey', rgb: [154, 156, 162], share: '11.67' },
    { id: 'smoked-topaz', rgb: [122, 62, 41], share: '15.83' },
    { id: 'light-colorado', rgb: [203, 142, 69], share: '17.50' },
    { id: 'light-peach', rgb: [238, 198, 164], share: '10.00' }
  ]);
});

// ---- Decision 3: Line Design ------------------------------------------------------------------------
await test('9. decision 3: LINE_DESIGN_INK_REFERENCE_COLOR_IDS is the literal 17 pre-IMG-016 ids, in catalogue order, each a valid catalogue id', () => {
  assert.deepEqual([...LINE_DESIGN_INK_REFERENCE_COLOR_IDS], [
    'crystal-clear', 'crystal', 'jet', 'siam', 'light-siam', 'rose', 'fuchsia', 'amethyst', 'sapphire',
    'light-sapphire', 'aquamarine', 'emerald', 'peridot', 'topaz', 'citrine', 'gold', 'silver'
  ]);
  for (const id of LINE_DESIGN_INK_REFERENCE_COLOR_IDS) assert.ok(isValidCrystalColorId(id), `${id} is a catalogue id`);
});

// A 400x300 px image (100 mm wide, 0.25 mm/px): a grey (150,152,158) panel on white, crossed by five
// 2 px dark lines, with a grid of 2x2 px dots too small to become line chains. The dark ink
// (58,59,64) is nearest jet among the 17 reference ids and nearest hematite among all 23.
const LD_W = 400, LD_H = 300;
function buildLineDesignBuffer() {
  const GREY = [150, 152, 158], INK = [58, 59, 64];
  const data = new Uint8ClampedArray(LD_W * LD_H * 4);
  for (let y = 0; y < LD_H; y++) for (let x = 0; x < LD_W; x++) {
    let c = [255, 255, 255];
    if (x >= 20 && x < 380 && y >= 20 && y < 280) {
      c = GREY;
      const line = (y >= 80 && y < 82 && x >= 40 && x < 360) || (y >= 200 && y < 202 && x >= 40 && x < 360)
        || (x >= 100 && x < 102 && y >= 40 && y < 260) || (x >= 280 && x < 282 && y >= 40 && y < 260)
        || (Math.abs((x - 40) - (y - 40) * 1.2) < 1.2 && x >= 120 && x < 260);
      const dot = x >= 140 && x < 260 && y >= 100 && y < 190 && (x % 16) < 2 && (y % 16) < 2;
      if (line || dot) c = INK;
    }
    const i = (y * LD_W + x) * 4;
    data[i] = c[0]; data[i + 1] = c[1]; data[i + 2] = c[2]; data[i + 3] = 255;
  }
  return { widthPx: LD_W, heightPx: LD_H, data };
}

await test('10. decision 3: Line Design positions are byte-identical between the full catalogue and the 17-colour subset, line stones take their ink\'s colour, and other kinds keep the all-pixel vote', () => {
  const imageBuffer = createImageBuffer(buildLineDesignBuffer());
  const run = (palette) => generateLineDesignStonePoints({ imageBuffer, placement: { xMm: 0, yMm: 0, widthMm: 100, heightMm: 75 }, gapMm: 0.3, layerId: 'img016', palette });
  const subset = PALETTE.filter((p) => LINE_DESIGN_INK_REFERENCE_COLOR_IDS.includes(p.id));
  assert.equal(subset.length, 17);
  const full = run(PALETTE);
  const reference = run(subset);
  const positions = (stones) => crypto.createHash('sha256').update(JSON.stringify(stones.map((s) => [s.xMm, s.yMm, s.sizeMm, s.kind]))).digest('hex');
  assert.equal(full.length, reference.length);
  assert.equal(positions(full), positions(reference));
  const lineColours = (stones) => stones.filter((s) => s.kind === 'line').map((s) => s.color);
  assert.ok(lineColours(full).some((c, i) => c !== lineColours(reference)[i]), 'expected at least one line stone to change colour');
  const kindColours = (stones) => {
    const counts = {};
    for (const s of stones) counts[`${s.kind}:${s.color}`] = (counts[`${s.kind}:${s.color}`] || 0) + 1;
    return counts;
  };
  assert.deepEqual(kindColours(full), { 'outline:grey': 126, 'line:hematite': 124, 'fill:grey': 286, 'pocket:grey': 132 });
  assert.deepEqual(kindColours(reference), { 'outline:silver': 126, 'line:jet': 124, 'fill:silver': 286, 'pocket:silver': 132 });
});

console.log('IMG-016 neutral and brown stones tests passed.');
