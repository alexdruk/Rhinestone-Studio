// RS-3038 — Production Sheet messages are shown where the operator can actually see them.
//
// Two defects, both surfaced by browser testing of RS-3037 (Flat Sheet):
//   A. Production Sheet export errors (e.g. the RangeError "does not fit A4") were written only to
//      #status, the sidebar status line the Production Sheet Lightbox covers -- the SVG/PNG/PDF
//      buttons looked unresponsive. Each of the three export handlers' catch blocks now also writes
//      `Export failed: ${error.message}` into #prodSheetValidation, the panel inside the lightbox.
//   B. Stones outside the production area (project.canvas) were drawn on the Production Sheet with
//      no warning (repro: import an image on a 200x200 Flat Sheet, then resize the sheet to
//      150x150). updateProdSheetReadabilityValidation() now also appends an itemized count via the
//      new pure countStonesOutsideProductionArea() (src/export/ProductionSheetExporter.js).
//
// Both warnings are non-blocking -- neither ever prevents an export. See
// docs/specifications/RS-3038-ProdSheetMessages.md.
//
// Real app.js source (updateProdSheetReadabilityValidation() and the three export handlers) is
// sliced verbatim and executed against stub el()/project/layout, the same source-extraction
// convention tools/test-read-010-warn-only-floor.mjs already uses.

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { formatLengthDisplay, unitSuffix } from '../src/units/index.js';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const appJs = await readFile(path.join(repoRoot, 'app.js'), 'utf8');

const { countStonesOutsideProductionArea } = await import('../src/export/ProductionSheetExporter.js');
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
    toggle: (c, force) => {
      const on = force === undefined ? !set.has(c) : Boolean(force);
      if (on) set.add(c); else set.delete(c);
      return on;
    }
  };
}

function makeLayout(stoneParams, layerId = 'layer-1') {
  const stones = stoneParams.map((p, index) => new Stone({ layerId, index, ...p }));
  return new StoneLayout({ layerId, stones });
}

// --- 1. countStonesOutsideProductionArea() -----------------------------------------------------

await test('1. countStonesOutsideProductionArea() counts stones not wholly inside a 150x150 area, edge-touching counted inside', () => {
  const layout = makeLayout([
    { xMm: 75, yMm: 75, sizeMm: 2 },   // fully inside
    { xMm: 1, yMm: 1, sizeMm: 2 },     // extent [0,2]x[0,2] -- exactly touches two edges, inside
    { xMm: 0.5, yMm: 75, sizeMm: 2 },  // extent starts at x=-0.5 -- partly outside
    { xMm: 160, yMm: 75, sizeMm: 2 },  // extent [159,161] -- fully outside
    { xMm: -5, yMm: -5, sizeMm: 2 }    // fully outside
  ]);
  assert.equal(countStonesOutsideProductionArea(layout, 150, 150), 3);
});

// --- 2. updateProdSheetReadabilityValidation() outside-area message -----------------------------

// project.layers is deliberately empty: textLayersBelowReadableMinimum() (unmodified by RS-3038)
// then returns [] without ever calling textHeightBelowReadableMinimum(), so this harness needs no
// font/stone-size machinery to isolate the outside-area addition this milestone actually changed.
function runProdSheetValidation({ layout, canvas }) {
  const validation = { textContent: '', classList: makeClassList() };
  const el = (id) => (id === 'prodSheetValidation' ? validation : { textContent: '', classList: makeClassList() });
  const project = { layers: [], units: 'mm', canvas };
  const projectPredicateSrc = sliceBalanced(appJs, 'function textLayersBelowReadableMinimum(){', 'textLayersBelowReadableMinimum()');
  const prodSheetValidationSrc = sliceBalanced(appJs, 'function updateProdSheetReadabilityValidation(){', 'updateProdSheetReadabilityValidation()');
  const factory = new Function(
    'el', 'project', 'layout', 'countStonesOutsideProductionArea', 'formatLengthDisplay', 'unitSuffix',
    `${projectPredicateSrc}\n${prodSheetValidationSrc}\nreturn updateProdSheetReadabilityValidation;`
  );
  const updateProdSheetReadabilityValidation = factory(el, project, layout, countStonesOutsideProductionArea, formatLengthDisplay, unitSuffix);
  updateProdSheetReadabilityValidation();
  return validation;
}

await test('2. appends the outside-area warning, naming the count and the WxH production area, when stones lie outside project.canvas', () => {
  const layout = makeLayout([
    { xMm: 75, yMm: 75, sizeMm: 2 },
    { xMm: 0.5, yMm: 75, sizeMm: 2 },
    { xMm: 160, yMm: 75, sizeMm: 2 },
    { xMm: -5, yMm: -5, sizeMm: 2 }
  ]);
  const validation = runProdSheetValidation({ layout, canvas: { width: 150, height: 150 } });
  assert.match(validation.textContent, /3 stones lie/);
  assert.match(validation.textContent, /150/);
  assert.ok(validation.classList.contains('visible'));
});

await test('3. adds no outside-area text when every stone is inside project.canvas', () => {
  const layout = makeLayout([
    { xMm: 75, yMm: 75, sizeMm: 2 },
    { xMm: 10, yMm: 10, sizeMm: 2 }
  ]);
  const validation = runProdSheetValidation({ layout, canvas: { width: 150, height: 150 } });
  assert.doesNotMatch(validation.textContent, /outside/);
  assert.equal(validation.textContent, '', 'no readability hits and no outside-area hits should leave the message empty');
});

// --- 4-6. export handler catch blocks write into #prodSheetValidation ---------------------------

// Extracts and executes the real onclick handler body (not a regex pin on its text), so the catch
// block's actual write is what's under test. `layout` is truthy (the !layout guard is not what this
// test covers) and the underlying exporter call is stubbed to throw -- the same RangeError shape
// ProductionSheetExporter.js's own "does not fit A4" page-fit check raises.
function runExportHandlerCatch(buttonId, overrides) {
  const validation = { textContent: '', classList: makeClassList() };
  const status = { textContent: '' };
  const el = (id) => {
    if (id === 'prodSheetValidation') return validation;
    if (id === 'status') return status;
    return { textContent: '', classList: makeClassList() };
  };
  const marker = `el('${buttonId}').onclick=`;
  const extracted = sliceBalanced(appJs, marker, `${buttonId} handler`);
  const handlerExpr = extracted.slice(marker.length);
  const paramNames = ['el', 'layout', 'updateProdSheetReadabilityValidation', 'currentProductionSheetOptions', 'download', 'productionSheetToSvg', 'productionSheetToPdf'];
  const factory = new Function(...paramNames, `return (${handlerExpr});`);
  const args = {
    el,
    layout: { stones: [] },
    updateProdSheetReadabilityValidation: () => {},
    currentProductionSheetOptions: () => ({}),
    download: () => {},
    productionSheetToSvg: () => { throw new RangeError("does not fit A4"); },
    productionSheetToPdf: () => { throw new RangeError("does not fit A4"); },
    ...overrides
  };
  const handler = factory(...paramNames.map((name) => args[name]));
  return { handler, validation, status };
}

await test('4. #exportProdSheetSVG catch block writes "Export failed: ..." into #prodSheetValidation', async () => {
  const { handler, validation } = runExportHandlerCatch('exportProdSheetSVG');
  await handler();
  assert.match(validation.textContent, /Export failed: does not fit A4/);
});

await test('5. #exportProdSheetPNG catch block writes "Export failed: ..." into #prodSheetValidation', async () => {
  const { handler, validation } = runExportHandlerCatch('exportProdSheetPNG');
  await handler();
  assert.match(validation.textContent, /Export failed: does not fit A4/);
});

await test('6. #exportProdSheetPDF catch block writes "Export failed: ..." into #prodSheetValidation', async () => {
  const { handler, validation } = runExportHandlerCatch('exportProdSheetPDF');
  await handler();
  assert.match(validation.textContent, /Export failed: does not fit A4/);
});

console.log('RS-3038 Production Sheet messages tests passed.');
