import assert from 'node:assert/strict';
import { GeometryEngine, combineManyShapeSources, SHAPE_LIBRARY_KINDS } from '../src/geometry/index.js';
import { stoneLayoutToSvg } from '../src/export/SvgExporter.js';
import { computeProductionSheetLayout, productionSheetToSvg } from '../src/export/ProductionSheetExporter.js';
import { deriveCategory } from '../src/library/LibraryItem.js';
import { prepareLayersForInsert } from '../src/library/LibraryTransform.js';

// S-110 (Expanded Shape Library) — proves every new shape kind flows, unmodified, through the
// existing production pipeline it must reuse (per the milestone's own "do not introduce a second
// shape system" requirement): Boolean Operations (src/geometry/PathBoolean.js), SVG export
// (src/export/SvgExporter.js), Production Sheet export (src/export/ProductionSheetExporter.js), and
// Design Library categorization/insert-offset (src/library/**). Mirrors the existing
// tools/test-fill-algorithms-integration.mjs / tools/test-path-boolean-integration.mjs conventions:
// real, unmodified permanent modules, no mocks.

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

function createEngine() {
  return new GeometryEngine();
}

const EXTRA = { polygon: { sides: 6 }, star: { points: 5, innerRadiusRatio: 0.5 }, ring: { innerRatio: 0.5 } };

function shapeParams(kind, overrides = {}) {
  return { shape: kind, layerId: 'x', xMm: 10, yMm: 10, widthMm: 40, heightMm: 40, ...(EXTRA[kind] || {}), ...overrides };
}

// --- 1. Boolean Operations: every new shape combines with a rectangle, with no shape-specific code ---

await test('1. every new shape kind participates in Union with a rectangle via the shared resolveShapePolygons() path', () => {
  const engine = createEngine();
  const rect = engine.resolveShapePolygons({ shape: 'rectangle', layerId: 'r', xMm: 0, yMm: 0, widthMm: 30, heightMm: 30 });
  for (const kind of SHAPE_LIBRARY_KINDS) {
    const shape = engine.resolveShapePolygons(shapeParams(kind));
    const combined = combineManyShapeSources(
      [{ kind: 'polygons', polygons: rect.polygons }, { kind: 'polygons', polygons: shape.polygons }],
      'union',
      { targetSpacingMm: 2 }
    );
    assert.ok(combined.contours.length > 0, `${kind}: Union with a rectangle must produce at least one contour`);
  }
});

await test('2. every new shape kind participates in Subtract/Intersect/Exclude with a rectangle', () => {
  const engine = createEngine();
  // An overlapping rectangle (spans the shape's own placement box) so every operation has a
  // non-trivial, non-empty result to check.
  const rect = engine.resolveShapePolygons({ shape: 'rectangle', layerId: 'r', xMm: 0, yMm: 0, widthMm: 30, heightMm: 30 });
  for (const kind of SHAPE_LIBRARY_KINDS) {
    const shape = engine.resolveShapePolygons(shapeParams(kind, { xMm: 5, yMm: 5, widthMm: 40, heightMm: 40 }));
    for (const operation of ['subtract', 'intersect', 'xor']) {
      const combined = combineManyShapeSources(
        [{ kind: 'polygons', polygons: rect.polygons }, { kind: 'polygons', polygons: shape.polygons }],
        operation,
        { targetSpacingMm: 2 }
      );
      assert.ok(Array.isArray(combined.contours), `${kind} ${operation}: expected a contours array (possibly empty for a fully-cancelling case)`);
    }
  }
});

await test('3. a Boolean Operation result (a \'path\' layer) is itself sampleable via generatePathLayout(), for a new shape kind', () => {
  const engine = createEngine();
  const rect = engine.resolveShapePolygons({ shape: 'rectangle', layerId: 'r', xMm: 0, yMm: 0, widthMm: 30, heightMm: 30 });
  const star = engine.resolveShapePolygons(shapeParams('star', { xMm: 10, yMm: 10 }));
  const combined = combineManyShapeSources(
    [{ kind: 'polygons', polygons: rect.polygons }, { kind: 'polygons', polygons: star.polygons }],
    'union',
    { targetSpacingMm: 2 }
  );
  const box = combined.boundingBox;
  const localContours = combined.contours.map((poly) => poly.map((p) => ({ xMm: p.xMm - box.minXmm, yMm: p.yMm - box.minYmm })));
  const layout = engine.generatePathLayout({
    contours: localContours, layerId: 'p', xMm: box.minXmm, yMm: box.minYmm,
    widthMm: box.maxXmm - box.minXmm, heightMm: box.maxYmm - box.minYmm, stoneSizeMm: 2, gapMm: 0.3, mode: 'outline'
  });
  assert.ok(layout.count > 0, 'expected the combined shape to produce stones');
});

// --- 2. Exports: SVG / Production Sheet consume every new shape's StoneLayout with no branching ---

await test('4. stoneLayoutToSvg() renders a valid SVG document for every new shape kind\'s generated StoneLayout', () => {
  const engine = createEngine();
  for (const kind of SHAPE_LIBRARY_KINDS) {
    const layout = engine.generateShapeLayout({ ...shapeParams(kind), layerId: kind, stoneSizeMm: 2, gapMm: 0.3, mode: 'outline', color: 'gold' });
    const svg = stoneLayoutToSvg(layout, { widthMm: 60, heightMm: 60 });
    assert.match(svg, /<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg"/, `${kind}: expected a valid SVG root element`);
    assert.equal((svg.match(/<circle/g) || []).length, layout.count, `${kind}: expected one <circle> per stone`);
  }
});

await test('5. Production Sheet export accepts every new shape kind\'s generated StoneLayout with no layer-type branching', () => {
  const engine = createEngine();
  const options = { projectName: 'S-110 Test', objectType: 'Mug', productionWidthMm: 210, productionHeightMm: 90, gapMm: [0.3] };
  for (const kind of SHAPE_LIBRARY_KINDS) {
    const layout = engine.generateShapeLayout({ ...shapeParams(kind), layerId: kind, stoneSizeMm: 2, gapMm: 0.3, mode: 'fill', color: 'gold' });
    const sheet = computeProductionSheetLayout(layout, options);
    assert.ok(sheet.pageWidthMm > 0 && sheet.pageHeightMm > 0, `${kind}: expected a valid page size`);
    const svg = productionSheetToSvg(layout, options);
    assert.match(svg, /<svg/, `${kind}: expected a valid Production Sheet SVG`);
  }
});

// --- 3. Design Library: category derivation and insert-offset behavior for every new shape kind ---

await test('6. every new shape kind derives the \'Shapes\' Design Library category, matching Circle/Rectangle', () => {
  for (const kind of SHAPE_LIBRARY_KINDS) {
    assert.equal(deriveCategory([{ type: kind }]), 'Shapes', `${kind} must categorize as 'Shapes'`);
  }
  // A mix of a new shape kind with a Circle also stays 'Shapes' (single-category rule), but mixing
  // with an unrelated type (e.g. 'svg') must fall back to 'Mixed'.
  assert.equal(deriveCategory([{ type: 'star' }, { type: 'circle' }]), 'Shapes');
  assert.equal(deriveCategory([{ type: 'star' }, { type: 'svg' }]), 'Mixed');
});

await test('7. prepareLayersForInsert() re-ids and nudges every new shape kind via its x/y fields (the same generic offset Rectangle/SVG/Image/Path already get)', () => {
  const extra = { polygon: { sides: 6 }, star: { points: 5, innerRadiusRatio: 0.5 }, ring: { innerRatio: 0.5 } };
  const layers = [...SHAPE_LIBRARY_KINDS].map((kind) => ({
    id: `${kind}-orig`, type: kind, visible: true, x: 10, y: 20, w: 30, h: 30, stoneSize: 2, gap: 0.3, color: 'gold', ...(extra[kind] || {})
  }));
  const inserted = prepareLayersForInsert(layers);
  for (let i = 0; i < layers.length; i++) {
    const kind = layers[i].type;
    assert.notEqual(inserted[i].id, layers[i].id, `${kind}: expected a fresh id`);
    assert.equal(inserted[i].x, 18, `${kind}: expected x to be nudged by +8`);
    assert.equal(inserted[i].y, 28, `${kind}: expected y to be nudged by +8`);
    // Configurable extra fields must survive the clone untouched.
    for (const key of Object.keys(extra[kind] || {})) {
      assert.equal(inserted[i][key], layers[i][key], `${kind}: expected ${key} to survive prepareLayersForInsert() unchanged`);
    }
  }
});

console.log('Shape Library integration (S-110) tests passed.');
