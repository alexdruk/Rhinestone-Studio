// IMG-026 build F -- the twelve aiOnly colours (catalogue, selectors, prompt v5, layout-service
// catalogue) and the Production Sheet that lists every colour. See
// docs/specifications/IMG-026-StrassLayoutService.md, "Colour and eyes (build F)", the Build F
// acceptance figures and "Tests the builds must add" (F).
//
// Reads app.js, index.html and catalogue.json as text; never runs the layout service or touches the
// network.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { CRYSTAL_COLORS, STONE_COLORS, AI_ONLY_COLOR_IDS, listCrystalColorGroups } from '../src/renderer/CrystalColors.js';
import { computeProductionSheetDocument, computeProductionSheetLayout, productionSheetToPdf, PAGE_SIZES } from '../src/export/ProductionSheetExporter.js';
import { PdfDocument } from '../src/export/PdfDocument.js';
import { buildPaletteLine, buildRedrawPrompt, PROMPT_VERSION } from '../server/redraw/prompt.mjs';
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

const F_ENTRIES = [
  ['golden-shadow', 'Golden Shadow', 'Brown & Peach', '#c99a6c'],
  ['copper', 'Copper', 'Brown & Peach', '#b87333'],
  ['rose-gold', 'Rose Gold', 'Brown & Peach', '#d38f75'],
  ['vintage-rose', 'Vintage Rose', 'Red & Pink', '#d1958e'],
  ['padparadscha', 'Padparadscha', 'Red & Pink', '#de4c52'],
  ['chrysolite', 'Chrysolite', 'Green & Aqua', '#97d38f'],
  ['fern-green', 'Fern Green', 'Green & Aqua', '#3e8e41'],
  ['erinite', 'Erinite', 'Green & Aqua', '#4d8355'],
  ['olivine', 'Olivine', 'Green & Aqua', '#737033'],
  ['khaki', 'Khaki', 'Green & Aqua', '#5b593c'],
  ['metallic-sunshine', 'Metallic Sunshine', 'Yellow & Amber', '#dfb758'],
  ['jet-hematite', 'Jet Hematite', 'Metallic', '#4a5353']
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

// Helvetica advance widths (per 1000 em) for ASCII 32-126, from the Adobe Helvetica AFM; any other
// character counts as one em. An independent copy of the exporter's table, so a wrong table there
// fails here.
const AFM = [
  278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278,
  556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556,
  1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778,
  667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556,
  333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556,
  556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584
];
function textWidthMm(text, sizeMm) {
  let units = 0;
  for (const ch of text) {
    const c = ch.codePointAt(0);
    units += c >= 32 && c <= 126 ? AFM[c - 32] : 1000;
  }
  return (units / 1000) * sizeMm;
}

function extractFunctionSource(source, startMarker) {
  const start = source.indexOf(startMarker);
  assert.ok(start !== -1, `expected to find ${startMarker} in app.js`);
  const braceStart = source.indexOf('{', start + startMarker.length - 1);
  let depth = 0;
  for (let i = braceStart; i < source.length; i++) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}') { depth--; if (depth === 0) return source.slice(start, i + 1); }
  }
  throw new Error(`expected the closing brace of ${startMarker}`);
}

// Every catalogue colour in three sizes, plus a jet and crystal block, on a mug-sized band.
function allColourLayout(widthMm, heightMm) {
  const stones = [];
  let i = 0;
  for (const color of CRYSTAL_COLORS) {
    for (const sizeMm of [1.5, 2, 2.8]) {
      stones.push({ xMm: 4 + (i % 40) * 3.2, yMm: 4 + Math.floor(i / 40) * 3.2, sizeMm, color: color.id });
      i += 1;
    }
  }
  for (let k = 0; k < 400; k += 1) stones.push({ xMm: 4 + (k % 50) * 2.3, yMm: 30 + Math.floor(k / 50) * 2.3, sizeMm: 2, color: k % 2 ? 'jet' : 'crystal' });
  return { stones: stones.filter((s) => s.xMm < widthMm - 2 && s.yMm < heightMm - 2) };
}

function namesIn(texts) {
  return texts.join(' ');
}

await test('1. catalogue: the twelve aiOnly entries follow hyacinth in order, with the pinned name, group and fill, and the IMG-016 shading rule', () => {
  assert.equal(CRYSTAL_COLORS.length, 39);
  assert.equal(CRYSTAL_COLORS[26].id, 'hyacinth');
  const appended = CRYSTAL_COLORS.slice(27).map((c) => [c.id, c.name, c.group, c.fill]);
  assert.deepEqual(appended, F_ENTRIES);
  for (const c of CRYSTAL_COLORS.slice(27)) {
    assert.equal(c.aiOnly, true, `${c.id} is aiOnly`);
    assert.deepEqual({ stroke: c.stroke, shine: c.shine, accent: c.accent }, applyShadingRule(c.fill), `${c.id} follows the rule`);
    assert.equal(c.previewColor, c.fill);
  }
  for (const c of CRYSTAL_COLORS.slice(0, 27)) assert.equal(c.aiOnly, false, `${c.id} is a standard colour`);
  assert.ok(Object.isFrozen(AI_ONLY_COLOR_IDS));
  assert.deepEqual([...AI_ONLY_COLOR_IDS], F_ENTRIES.map((e) => e[0]));
});

await test('2. S4: catalogue.json has all 39 ids in catalogue order; each equals CrystalColors.js on name, fill, stroke, shine and accent, and carries aiOnly exactly for the twelve', () => {
  assert.deepEqual(Object.keys(serviceCatalogue), CRYSTAL_COLORS.map((c) => c.id));
  for (const [id, entry] of Object.entries(serviceCatalogue)) {
    for (const field of ['name', 'fill', 'stroke', 'shine', 'accent']) assert.equal(entry[field], STONE_COLORS[id][field], `${id}.${field}`);
    assert.equal(Boolean(entry.aiOnly), STONE_COLORS[id].aiOnly, `${id}.aiOnly`);
  }
});

await test('3. selectors: listCrystalColorGroups() leaves the aiOnly colours out unless asked; populateStoneColorOptions() lists them only for #aiStoneColor and the colour-swap selects', () => {
  const standard = listCrystalColorGroups().flatMap((g) => g.colors.map((c) => c.id));
  assert.deepEqual(new Set(standard), new Set(CRYSTAL_COLORS.filter((c) => !c.aiOnly).map((c) => c.id)));
  assert.equal(standard.length, 27);
  assert.ok(standard.every((id) => !AI_ONLY_COLOR_IDS.includes(id)));
  const all = listCrystalColorGroups({ includeAiOnly: true }).flatMap((g) => g.colors.map((c) => c.id));
  assert.equal(all.length, 39);
  assert.deepEqual(new Set(all), new Set(CRYSTAL_COLORS.map((c) => c.id)));

  const source = extractFunctionSource(appJs, 'function populateStoneColorOptions(');
  const elements = new Map();
  const el = (id) => { if (!elements.has(id)) elements.set(id, { innerHTML: '' }); return elements.get(id); };
  const escapeHtml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  // eslint-disable-next-line no-new-func
  const populate = new Function('STONE_COLORS', 'el', 'escapeHtml', `${source}\nreturn populateStoneColorOptions;`)(STONE_COLORS, el, escapeHtml);
  populate('stoneColor');
  populate('aiStoneColor', true);
  const optionIds = (id) => [...el(id).innerHTML.matchAll(/<option value="([^"]*)">/g)].map((m) => m[1]);
  assert.deepEqual(optionIds('stoneColor'), standard);
  assert.deepEqual(optionIds('aiStoneColor'), all);

  const calls = [...appJs.matchAll(/populateStoneColorOptions\(([^)]*)\)/g)].map((m) => m[1]).filter((a) => !a.startsWith("targetId="));
  const withAi = calls.filter((a) => /,\s*true$/.test(a)).map((a) => a.replace(/,\s*true$/, ''));
  assert.deepEqual(withAi.sort(), ["'aiStoneColor'", 'pick.id']);
});

await test('4. prompt v5: the stones palette line lists all 39 colours, the flat one the 27 standard ones; the ramps name the new colours', () => {
  assert.equal(PROMPT_VERSION, 5);
  assert.deepEqual(buildPaletteLine().split(', '), CRYSTAL_COLORS.filter((c) => !c.aiOnly).map((c) => `${c.name} ${c.fill}`));
  assert.deepEqual(buildPaletteLine(undefined, true).split(', '), CRYSTAL_COLORS.map((c) => `${c.name} ${c.fill}`));
  const stones = buildRedrawPrompt().split('\n');
  assert.ok(stones.includes(buildPaletteLine(undefined, true)));
  const flat = buildRedrawPrompt(undefined, 'flat').split('\n');
  assert.equal(flat.at(-1), buildPaletteLine());
  const ramps = stones.filter((l) => /^ {2}(skin|tan or brown|white, grey|greens)/.test(l)).join('\n');
  for (const [, name] of F_ENTRIES) assert.ok(ramps.includes(name), `the ramps name ${name}`);
});

await test('5. Production Sheet: with all 39 colours a mug band exports on A4 and Letter; the cover turns to portrait, lists every colour and every count, and no header line leaves the page or reaches the page map', () => {
  for (const pageSize of ['A4', 'Letter']) {
    const layout = allColourLayout(257.6, 85);
    const doc = computeProductionSheetDocument(layout, { productionWidthMm: 257.6, productionHeightMm: 85, pageSize, marginMm: 10 });
    assert.equal(doc.multiPage, true, `${pageSize} is multi-page`);
    const cover = doc.pages[0];
    assert.equal(cover.pageWidthMm, Math.min(PAGE_SIZES[pageSize].widthMm, PAGE_SIZES[pageSize].heightMm), `${pageSize}: portrait cover`);
    const texts = cover.headerLines.map((l) => l.text);
    const colourBlock = [];
    for (const text of texts.slice(texts.findIndex((t) => t.startsWith('Crystal color: ')))) {
      if (text.startsWith('Page: ')) break;
      colourBlock.push(text);
    }
    const listed = colourBlock.join(' ').replace('Crystal color: ', '').split(/,\s*/).map((s) => s.trim());
    assert.deepEqual(listed, CRYSTAL_COLORS.map((c) => c.name).sort(), `${pageSize}: the Crystal color lines list every colour once, sorted`);
    for (const c of CRYSTAL_COLORS) assert.ok(texts.some((t) => t.startsWith(`${c.name}: `)), `${pageSize}: a count line for ${c.name}`);
    const counts = [...namesIn(texts).matchAll(/\): (\d+)/g)].map((m) => Number(m[1]));
    assert.equal(counts.reduce((a, b) => a + b, 0), layout.stones.length, `${pageSize}: the counts add up to the stone count`);
    for (const line of cover.headerLines) {
      const x = cover.marginMm + 2 + (line.xOffsetMm || 0);
      assert.ok(x + textWidthMm(line.text, line.sizeMm) <= cover.pageWidthMm - cover.marginMm + 1e-9, `${pageSize}: "${line.text}" fits the page`);
      assert.ok(line.yMm < cover.pageMap.yMm, `${pageSize}: "${line.text}" is above the page map`);
    }
    const slots = new Set(cover.headerLines.map((l) => `${l.xOffsetMm || 0}|${l.yMm.toFixed(3)}`));
    assert.equal(slots.size, cover.headerLines.length, `${pageSize}: no two header lines share a position`);
  }
});

await test('6. Production Sheet: a long colour list on one page wraps between colours, never inside a name, and the header grows by the extra lines', () => {
  const stones = CRYSTAL_COLORS.slice(0, 30).map((c, i) => ({ xMm: 5 + (i % 10) * 4, yMm: 5 + Math.floor(i / 10) * 4, sizeMm: 2, color: c.id }));
  const sheet = computeProductionSheetLayout({ stones }, { productionWidthMm: 60, productionHeightMm: 40, pageSize: 'A4', marginMm: 10 });
  const texts = sheet.headerLines.map((l) => l.text);
  const first = texts.findIndex((t) => t.startsWith('Crystal color: '));
  const pageLine = texts.findIndex((t) => t.startsWith('Page: '));
  assert.ok(pageLine - first >= 2, 'the colour list takes more than one line');
  for (let i = first; i < pageLine - 1; i += 1) assert.ok(texts[i].endsWith(','), 'a wrapped line ends after a comma');
  const names = texts.slice(first, pageLine).join(' ').replace('Crystal color: ', '').split(/,\s*/);
  assert.deepEqual(names, [...new Set(stones.map((s) => STONE_COLORS[s.color].name))].sort());
  for (const line of sheet.headerLines) assert.ok(12 + textWidthMm(line.text, line.sizeMm) <= 200, `"${line.text}" fits A4 portrait`);
  const step = sheet.headerLines[2].yMm - sheet.headerLines[1].yMm;
  assert.ok(sheet.productionRect.yMm - sheet.headerLines.at(-1).yMm >= step, 'the production rect starts below the last header line');
});

await test('7. PDF text: the em dash and the other WinAnsi punctuation keep their glyph; text outside WinAnsi still becomes "?"', () => {
  const doc = new PdfDocument({ widthPt: 100, heightPt: 100 });
  doc.drawText(0, 0, 'Gap: — – • … “q”', { sizePt: 9 });
  doc.drawText(0, 10, 'CJK: 中', { sizePt: 9 });
  const text = Buffer.from(doc.toBytes()).toString('latin1');
  assert.ok(text.includes('(Gap: \x97 \x96 \x95 \x85 \x93q\x94) Tj'));
  assert.ok(text.includes('(CJK: ?) Tj'));
  const sheet = Buffer.from(productionSheetToPdf({ stones: [{ xMm: 5, yMm: 5, sizeMm: 2, color: 'fern-green' }] }, { productionWidthMm: 20, productionHeightMm: 20 })).toString('latin1');
  assert.ok(sheet.includes('(Object: \x97) Tj'));
  assert.ok(sheet.includes('(Crystal color: Fern Green) Tj'));
});

await test('8. registration: test-img-026-ai-colours-sheet.mjs is in the exporters group and the default suite', () => {
  assertTestRegistered({ filename: 'test-img-026-ai-colours-sheet.mjs', group: 'exporters', includedInDefault: true });
});
