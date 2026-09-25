// RS-3041 -- multi-page Production Sheets. A sheet that does not fit one page is tiled by
// computeProductionSheetDocument() into a cover page plus true-size tile pages and exported as one
// multi-page PDF; SVG (and PNG, through SVG) stays one page and asks for a PDF instead. See
// docs/specifications/RS-3041-MultiPageSheets.md -- the test numbers below are its §5 items. Items 4,
// 5 and 9 are review-time audit checks, not test code: the pinned owned/ghost counts in item 1 are
// what fail a tiling-before-mirroring or ghosts-off implementation.
//
// The fixture is the spec's §4 generator, verbatim. updateProdSheetReadabilityValidation() (item 10)
// is sliced from app.js and run against stub el()/project, the convention
// tools/test-rs-3038-prod-sheet-messages.mjs already uses.

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertTestRegistered } from './lib/test-registration-assertions.mjs';
import { formatLengthDisplay, unitSuffix } from '../src/units/index.js';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const appJs = await readFile(path.join(repoRoot, 'app.js'), 'utf8');

const {
  computeProductionSheetLayout, computeProductionSheetDocument, productionSheetToSvg, productionSheetToPdf,
  countStonesOutsideProductionArea
} = await import('../src/export/ProductionSheetExporter.js');
const { PT_PER_MM } = await import('../src/export/PdfDocument.js');
const { Stone } = await import('../src/geometry/Stone.js');
const { StoneLayout } = await import('../src/geometry/StoneLayout.js');

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

function fixture(W,H){const s=[];const p=2.3,rh=p*Math.sqrt(3)/2;let r=0;for(let y=1;y<=H-1+1e-9;y+=rh,r++){for(let x=1+(r%2?p/2:0);x<=W-1+1e-9;x+=p)if(x<=0.7*W)s.push({xMm:x,yMm:y,sizeMm:2,color:x<W/2?'jet':'crystal'})}return s}

function fixtureOptions(size, extra = {}) {
  return {
    productionWidthMm: size, productionHeightMm: size, pageSize: 'A4', marginMm: 10,
    registrationMarks: true, gapMm: [0.3], units: 'mm', mirror: false, ...extra
  };
}

// tools/test-rs-3037-flat-sheet.mjs test 12's layout and options, reproduced exactly.
function makeEightColorThreeSizeLayout() {
  const colors = ['jet', 'siam', 'light-siam', 'rose', 'fuchsia', 'amethyst', 'sapphire', 'light-sapphire'];
  const sizes = [2, 2.8, 3.4];
  const stones = [];
  let index = 0;
  for (const color of colors) {
    for (const sizeMm of sizes) {
      stones.push(new Stone({ layerId: 'layer-1', index: index++, xMm: 5 + index, yMm: 5 + index, sizeMm, color }));
    }
  }
  return new StoneLayout({ layerId: 'layer-1', stones });
}
const TEST_12_OPTIONS = {
  projectName: 'RS-3037 Flat Sheet', objectType: 'Flat Sheet',
  productionWidthMm: 158, productionHeightMm: 158,
  pageSize: 'Letter', marginMm: 10, mirror: true, registrationMarks: true, gapMm: [0.1]
};

const sha256 = (value) => createHash('sha256').update(value).digest('hex');

// §4, owned/ghost per page in page order.
const PINNED = [
  {
    label: '220x220 A4', size: 220, extra: {}, orientation: 'portrait', cols: 2, rows: 1, tile: [110, 220], total: 7370,
    owned: { A1: 5225, A2: 2145 }, ghost: { A1: 385, A2: 385 }
  },
  {
    label: '220x220 A4 mirror on', size: 220, extra: { mirror: true }, orientation: 'portrait', cols: 2, rows: 1, tile: [110, 220], total: 7370,
    owned: { A1: 2145, A2: 5225 }, ghost: { A1: 385, A2: 385 }
  },
  {
    label: '300x300 A4', size: 300, extra: {}, orientation: 'portrait', cols: 2, rows: 2, tile: [150, 150], total: 13650,
    owned: { A1: 4875, A2: 1950, B1: 4875, B2: 1950 }, ghost: { A1: 537, A2: 380, B1: 536, B2: 381 }
  },
  {
    label: '500x500 A4', size: 500, extra: {}, orientation: 'landscape', cols: 2, rows: 4, tile: [250, 125], total: 38152,
    owned: { A1: 6836, A2: 2740, B1: 6835, B2: 2741, C1: 6727, C2: 2697, D1: 6836, D2: 2740 },
    ghost: { A1: 668, A2: 409, B1: 1117, B2: 596, C1: 1225, C2: 640, D1: 668, D2: 409 }
  }
];

const documents = new Map();
function pinnedDocument(row) {
  if (!documents.has(row.label)) {
    documents.set(row.label, computeProductionSheetDocument({ stones: fixture(row.size, row.size) }, fixtureOptions(row.size, row.extra)));
  }
  return documents.get(row.label);
}

// --- 1. pinned figures ---------------------------------------------------------------------------

await test('1. every §4 pinned figure: grid, orientation, tile size, total, owned and ghost per page in page order', () => {
  for (const row of PINNED) {
    const d = pinnedDocument(row);
    assert.equal(d.multiPage, true, row.label);
    assert.equal(d.orientation, row.orientation, row.label);
    assert.equal(d.cols, row.cols, row.label);
    assert.equal(d.rows, row.rows, row.label);
    assert.equal(d.tileWidthMm, row.tile[0], row.label);
    assert.equal(d.tileHeightMm, row.tile[1], row.label);
    assert.equal(d.stoneCount, row.total, row.label);
    assert.equal(d.pages.length, row.cols * row.rows + 1, `${row.label}: cover + N`);
    assert.equal(d.pages[0].kind, 'cover', `${row.label}: the cover comes first`);
    const tiles = d.pages.slice(1);
    assert.deepEqual(tiles.map((t) => t.name), Object.keys(row.owned), `${row.label}: page order`);
    assert.deepEqual(Object.fromEntries(tiles.map((t) => [t.name, t.ownedCount])), row.owned, `${row.label}: owned`);
    assert.deepEqual(Object.fromEntries(tiles.map((t) => [t.name, t.ghostStones.length])), row.ghost, `${row.label}: ghost`);
  }

  const single = computeProductionSheetDocument({ stones: fixture(150, 150) }, fixtureOptions(150));
  assert.equal(single.multiPage, false);
  assert.equal(single.pages.length, 1);
  assert.deepEqual(single.pages[0], computeProductionSheetLayout({ stones: fixture(150, 150) }, fixtureOptions(150)));

  const test12Layout = makeEightColorThreeSizeLayout();
  assert.throws(() => computeProductionSheetLayout(test12Layout, TEST_12_OPTIONS), RangeError);
  const test12 = computeProductionSheetDocument(test12Layout, TEST_12_OPTIONS);
  assert.equal(test12.multiPage, true);
  assert.equal(test12.orientation, 'portrait');
  assert.equal(test12.cols, 1);
  assert.equal(test12.rows, 1);
  assert.equal(test12.pages.length, 2, 'cover + 1 page');
  assert.equal(test12.pages[1].ownedCount, 24);
  assert.equal(test12.pages[1].ghostStones.length, 0);
});

// --- 2. owned counts sum to the total ------------------------------------------------------------

await test('2. owned counts sum to the total for every multi-page case', () => {
  for (const row of PINNED) {
    const tiles = pinnedDocument(row).pages.slice(1);
    assert.equal(tiles.reduce((sum, t) => sum + t.ownedCount, 0), row.total, row.label);
  }
});

// --- 3. no stone owned twice ---------------------------------------------------------------------

await test('3. no stone is owned twice: every input stone index is in exactly one tile\'s owned set', () => {
  for (const row of PINNED) {
    const tiles = pinnedDocument(row).pages.slice(1);
    const owners = new Array(row.total).fill(0);
    for (const tile of tiles) {
      assert.equal(tile.ownedStoneIndices.length, tile.ownedCount, `${row.label} ${tile.name}`);
      assert.equal(tile.ownedStones.length, tile.ownedCount, `${row.label} ${tile.name}`);
      for (const index of tile.ownedStoneIndices) owners[index] += 1;
      for (const index of tile.ghostStoneIndices) {
        assert.equal(tile.ownedStoneIndices.includes(index), false, `${row.label} ${tile.name}: a ghost is never owned by its own tile`);
      }
    }
    assert.ok(owners.every((count) => count === 1), `${row.label}: every stone owned exactly once`);
  }
});

// --- 6. D11 message ------------------------------------------------------------------------------

await test('6. D11: productionSheetToSvg() throws the exact "Export it as PDF" RangeError, "pages" for 4 and "page" for 1', () => {
  assert.throws(
    () => productionSheetToSvg({ stones: fixture(300, 300) }, fixtureOptions(300)),
    (error) => error instanceof RangeError &&
      error.message === 'This Production Sheet needs 4 pages on A4 plus a cover page. Export it as PDF.'
  );
  assert.throws(
    () => productionSheetToSvg(makeEightColorThreeSizeLayout(), TEST_12_OPTIONS),
    (error) => error instanceof RangeError &&
      error.message === 'This Production Sheet needs 1 page on Letter plus a cover page. Export it as PDF.'
  );
});

// --- 7. single page byte-identical ---------------------------------------------------------------

await test('7. single page is byte-identical to c546685: 150x150 A4 SVG and PDF match the §4 length and SHA-256', () => {
  const svg = productionSheetToSvg({ stones: fixture(150, 150) }, fixtureOptions(150));
  assert.equal(svg.length, 397684);
  assert.equal(sha256(svg), '3414abee87a8bd597dc916a43e78a760cace4d71f9575db1eb1b556747853bd2');
  const pdf = productionSheetToPdf({ stones: fixture(150, 150) }, fixtureOptions(150));
  assert.equal(pdf.length, 911434);
  assert.equal(sha256(pdf), '723020417f9cb8befdddf28ac73dce5218d50d9cc653ce9537f4f98e8e7e4928');
});

// --- 8. multi-page PDF structure -----------------------------------------------------------------

function xrefOffsets(text) {
  const startxref = Number(text.match(/startxref\n(\d+)\n%%EOF/)[1]);
  const xref = text.slice(startxref);
  const count = Number(xref.match(/^xref\n0 (\d+)\n/)[1]);
  const entries = xref.split('\n').slice(2, 2 + count);
  return entries.map((entry) => Number(entry.slice(0, 10)));
}

await test('8. the multi-page PDF has N+1 pages, each with the right /MediaBox, and every xref offset points at its own object', () => {
  const portrait = `/MediaBox [0 0 595.276 841.89]`;
  const landscape = `/MediaBox [0 0 841.89 595.276]`;
  assert.equal(Math.round(210 * PT_PER_MM * 1000) / 1000, 595.276);
  assert.equal(Math.round(297 * PT_PER_MM * 1000) / 1000, 841.89);
  for (const [size, pages, mediaBox] of [[220, 3, portrait], [300, 5, portrait], [500, 9, landscape]]) {
    const text = Buffer.from(productionSheetToPdf({ stones: fixture(size, size) }, fixtureOptions(size))).toString('latin1');
    assert.ok(text.startsWith('%PDF-1.4'), `${size}`);
    assert.ok(text.endsWith('%%EOF'), `${size}`);
    assert.match(text, new RegExp(`/Type /Pages /Kids \\[[^\\]]*\\] /Count ${pages} >>`), `${size}: /Count`);
    const pageObjects = text.match(/<< \/Type \/Page \/Parent[^\n]*/g) || [];
    assert.equal(pageObjects.length, pages, `${size}: /Type /Page objects`);
    for (const pageObject of pageObjects) assert.ok(pageObject.includes(mediaBox), `${size}: ${pageObject}`);
    const offsets = xrefOffsets(text);
    assert.equal(offsets.length, 2 * pages + 4, `${size}: catalog, pages, page+content per page, font, free head`);
    for (let objectNumber = 1; objectNumber < offsets.length; objectNumber += 1) {
      assert.equal(text.slice(offsets[objectNumber], offsets[objectNumber] + `${objectNumber} 0 obj`.length), `${objectNumber} 0 obj`, `${size}: object ${objectNumber}`);
    }
  }
});

// --- 10. D12 panel note --------------------------------------------------------------------------

function sliceBalanced(source, startMarker, label) {
  const start = source.indexOf(startMarker);
  assert.ok(start !== -1, `expected to find "${startMarker}" (${label}) in app.js`);
  const braceStart = source.indexOf('{', start);
  let depth = 0;
  for (let i = braceStart; i < source.length; i += 1) {
    if (source[i] === '{') depth += 1;
    else if (source[i] === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(start, i + 1);
    }
  }
  throw new Error(`unbalanced braces slicing "${startMarker}" (${label})`);
}

function makeClassList() {
  const set = new Set();
  return {
    contains: (c) => set.has(c),
    add: (c) => set.add(c),
    remove: (c) => set.delete(c),
    toggle: (c, force) => {
      const on = force === undefined ? !set.has(c) : Boolean(force);
      if (on) set.add(c); else set.delete(c);
      return on;
    }
  };
}

function runProdSheetValidation({ stones, size }) {
  const validation = { textContent: '', classList: makeClassList() };
  const el = (id) => (id === 'prodSheetValidation' ? validation : { textContent: '', classList: makeClassList() });
  const project = { layers: [], units: 'mm', canvas: { width: size, height: size } };
  const layout = { stones };
  const projectPredicateSrc = sliceBalanced(appJs, 'function textLayersBelowReadableMinimum(){', 'textLayersBelowReadableMinimum()');
  const prodSheetValidationSrc = sliceBalanced(appJs, 'function updateProdSheetReadabilityValidation(){', 'updateProdSheetReadabilityValidation()');
  const factory = new Function(
    'el', 'project', 'layout', 'countStonesOutsideProductionArea', 'formatLengthDisplay', 'unitSuffix', 'computeProductionSheetDocument', 'currentProductionSheetOptions',
    `${projectPredicateSrc}\n${prodSheetValidationSrc}\nreturn updateProdSheetReadabilityValidation;`
  );
  const updateProdSheetReadabilityValidation = factory(
    el, project, layout, countStonesOutsideProductionArea, formatLengthDisplay, unitSuffix, computeProductionSheetDocument,
    () => fixtureOptions(size)
  );
  updateProdSheetReadabilityValidation();
  return validation;
}

const MULTI_PAGE_NOTE_300 = 'Spans 4 pages on A4 (2 × 2) plus a cover page; export as PDF.';

await test('10. D12: the multi-page note appears only when multi-page applies, and alongside the RS-3038 outside-area warning', () => {
  const multi = runProdSheetValidation({ stones: fixture(300, 300), size: 300 });
  assert.equal(multi.textContent, MULTI_PAGE_NOTE_300);
  assert.ok(multi.classList.contains('visible'));

  const single = runProdSheetValidation({ stones: fixture(150, 150), size: 150 });
  assert.equal(single.textContent, '');
  assert.equal(single.classList.contains('visible'), false);

  const withOutside = runProdSheetValidation({ stones: [...fixture(300, 300), { xMm: 305, yMm: 150, sizeMm: 2, color: 'jet' }], size: 300 });
  assert.match(withOutside.textContent, /^1 stone lies partly or fully outside the 300 × 300 mm production area/);
  assert.ok(withOutside.textContent.endsWith(` ${MULTI_PAGE_NOTE_300}`), 'the note follows the outside-area warning, never replacing it');
});

// --- 11. D8 map floor ----------------------------------------------------------------------------

await test('11. D8: 300x300 A4 at margin 54 throws the exact cover-map RangeError; margin 53 is portrait 4 x 2, 8 tile pages', () => {
  assert.throws(
    () => computeProductionSheetDocument({ stones: fixture(300, 300) }, fixtureOptions(300, { marginMm: 54 })),
    (error) => error instanceof RangeError &&
      error.message === 'Production sheet cover page has no room for the page map on A4 at margin 54mm. Reduce the margin or choose a larger page size.'
  );
  const d = computeProductionSheetDocument({ stones: fixture(300, 300) }, fixtureOptions(300, { marginMm: 53 }));
  assert.equal(d.multiPage, true);
  assert.equal(d.orientation, 'portrait');
  assert.equal(d.cols, 4);
  assert.equal(d.rows, 2);
  assert.equal(d.pages.length, 9, 'cover + 8');
});

await test('11b. D3: no orientation leaves a positive cell, so the exact "even split across pages" RangeError is thrown', () => {
  assert.throws(
    () => computeProductionSheetDocument({ stones: fixture(300, 300) }, fixtureOptions(300, { marginMm: 100 })),
    (error) => error instanceof RangeError &&
      error.message === 'Production sheet does not fit A4 at margin 100mm, even split across pages. Reduce the margin or choose a larger page size.'
  );
});

await test('registered in tools/test-groups.mjs (exporters, default suite)', () => {
  assertTestRegistered({ filename: 'test-rs-3041-multi-page.mjs', group: 'exporters', includedInDefault: true });
});

console.log('RS-3041 multi-page Production Sheet tests done.');
