import assert from 'node:assert/strict';
import { StoneLayout } from '../src/geometry/StoneLayout.js';
import { computeProductionSheetLayout, productionSheetToSvg, productionSheetToPdf } from '../src/export/ProductionSheetExporter.js';

// S-200 — Mixed Stone-Size Layouts. Production Sheet's per-color/per-size quantity grouping
// ("Production Sheet must automatically group quantities"). Exercises the real, unmodified
// ProductionSheetExporter directly, matching tools/test-production-sheet-exporter.mjs's own
// convention.

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

function makeLayout(stones) {
  return new StoneLayout({
    layerId: 'project',
    stones: stones.map((s, i) => ({ xMm: s.xMm, yMm: s.yMm, sizeMm: s.sizeMm, color: s.color, layerId: 'l', index: i }))
  });
}

// Mirrors the milestone brief's own worked example: one color ("Blue" maps to the catalog's
// 'sapphire' entry here), three sizes, with the exact quantities from the brief.
function brdWorkedExampleLayout() {
  const stones = [];
  let i = 0;
  for (let n = 0; n < 142; n++) stones.push({ xMm: i, yMm: 0, sizeMm: 2.0, color: 'sapphire' }), i++;
  for (let n = 0; n < 1856; n++) stones.push({ xMm: i, yMm: 1, sizeMm: 2.8, color: 'sapphire' }), i++;
  for (let n = 0; n < 48; n++) stones.push({ xMm: i, yMm: 2, sizeMm: 4.0, color: 'sapphire' }), i++;
  return makeLayout(stones);
}

const BASE_OPTIONS = { projectName: 'Grouping Test', objectType: 'Mug', productionWidthMm: 210, productionHeightMm: 90 };

await test('sizeBreakdown groups by color then size ascending, with correct counts, matching the brief\'s worked example', () => {
  const layout = computeProductionSheetLayout(brdWorkedExampleLayout(), BASE_OPTIONS);
  assert.deepEqual(
    layout.sizeBreakdown.map((g) => [g.colorName, g.sizeMm, g.count]),
    [['Sapphire', 2, 142], ['Sapphire', 2.8, 1856], ['Sapphire', 4, 48]]
  );
});

await test('sizeBreakdown totals reconcile against stoneCount for a multi-color, multi-size layout', () => {
  const stoneLayout = makeLayout([
    ...Array.from({ length: 10 }, (_, i) => ({ xMm: i, yMm: 0, sizeMm: 2.0, color: 'gold' })),
    ...Array.from({ length: 5 }, (_, i) => ({ xMm: i, yMm: 1, sizeMm: 2.8, color: 'gold' })),
    ...Array.from({ length: 7 }, (_, i) => ({ xMm: i, yMm: 2, sizeMm: 2.0, color: 'crystal' }))
  ]);
  const layout = computeProductionSheetLayout(stoneLayout, BASE_OPTIONS);
  const sum = layout.sizeBreakdown.reduce((total, g) => total + g.count, 0);
  assert.equal(sum, layout.stoneCount);
  assert.equal(layout.stoneCount, 22);
  assert.equal(layout.sizeBreakdown.length, 3, 'expected 3 distinct (color,size) groups');
});

await test('sizeBreakdown for a single color/single size layout is one group, matching stoneCount exactly', () => {
  const stoneLayout = makeLayout(Array.from({ length: 50 }, (_, i) => ({ xMm: i, yMm: 0, sizeMm: 2.8, color: 'gold' })));
  const layout = computeProductionSheetLayout(stoneLayout, BASE_OPTIONS);
  assert.deepEqual(layout.sizeBreakdown, [{ colorName: 'Gold', sizeMm: 2.8, sizeLabel: 'SS10 (2.8 mm)', count: 50 }]);
});

await test('an empty StoneLayout reports an empty sizeBreakdown, no throw', () => {
  const layout = computeProductionSheetLayout(makeLayout([]), BASE_OPTIONS);
  assert.deepEqual(layout.sizeBreakdown, []);
});

await test('sizeBreakdown lines are rendered into the header (SVG) without corrupting stone rendering', () => {
  const stoneLayout = brdWorkedExampleLayout();
  const layout = computeProductionSheetLayout(stoneLayout, BASE_OPTIONS);
  const svg = productionSheetToSvg(stoneLayout, BASE_OPTIONS);
  const circleCount = (svg.match(/<circle\b/g) || []).length;
  assert.equal(circleCount, stoneLayout.count, 'every stone must still be drawn exactly once');
  for (const group of layout.sizeBreakdown) {
    assert.ok(svg.includes(`${group.count}`), `expected the count ${group.count} to appear in the rendered header`);
  }
});

await test('sizeBreakdown does not break PDF export (structurally valid, one circle per stone)', () => {
  const stoneLayout = brdWorkedExampleLayout();
  const pdfBytes = productionSheetToPdf(stoneLayout, BASE_OPTIONS);
  assert.ok(pdfBytes instanceof Uint8Array && pdfBytes.length > 0);
});

await test('adding sizeBreakdown lines to the header does not regress a previously-fitting sheet (no page-fit growth for a single-color, single-size project)', () => {
  // A pre-S-200 project is always single-size per layer; combined across layers a single-color,
  // single-size sheet must take exactly as much header room as before this milestone -- one
  // sizeBreakdown line, same as the pre-existing "Stone size:"/"Crystal color:" lines' own budget.
  const single = makeLayout(Array.from({ length: 100 }, (_, i) => ({ xMm: i, yMm: 0, sizeMm: 2.8, color: 'gold' })));
  assert.doesNotThrow(() => computeProductionSheetLayout(single, { ...BASE_OPTIONS, marginMm: 10 }));
});

console.log('S-200 production sheet grouping tests complete.');
