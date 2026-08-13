import assert from 'node:assert/strict';
import { GeometryEngine } from '../src/geometry/index.js';
import { loadPaperForNode } from './lib/paper-node-env.mjs';

// RS-3011 Step 8 Phase A — real, numeric proof that flattenPathToContours() correctly generalizes
// flattenPathToContour() to paper.CompoundPath (holes) and paper.Group (disjoint pieces), the two
// shapes paper.project.importSVG(...,{expandShapes:true}) can hand back for real-world SVGs that a
// single-contour flattenPathToContour() cannot walk. No DrawingCanvasTool/app.js wiring is exercised
// here -- pure geometry/import-pipeline, per this milestone's own scope.
//
// 'paper' (and src/drawing/DrawingBoard.js, which itself imports 'paper') must be loaded via
// dynamic import() only after loadPaperForNode()'s Node/jsdom shim is in place -- see
// tools/lib/paper-node-env.mjs for why a static top-level `import ... from 'paper'` here would
// hoist ahead of that setup and hit the browser-only APIs paper.project.importSVG() needs.
const paper = await loadPaperForNode();
const {
  flattenPathToContour,
  flattenPathToContours,
  createPathLayerFromContours,
  importSvgIntoItem
} = await import('../src/drawing/DrawingBoard.js');

paper.setup(new paper.Size(1000, 1000));

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`✓ ${name}`);
    passed++;
  } catch (error) {
    console.error(`✗ ${name}`);
    console.error(error);
    failed++;
  }
}

function bboxOf(points) {
  const minX = Math.min(...points.map((p) => p.x));
  const minY = Math.min(...points.map((p) => p.y));
  const maxX = Math.max(...points.map((p) => p.x));
  const maxY = Math.max(...points.map((p) => p.y));
  return { minX, minY, maxX, maxY };
}

// -------------------------------------------------------------------------------------------
// (a) Simple single-path SVG: exactly 1 contour, matching flattenPathToContour()'s own output.
// -------------------------------------------------------------------------------------------
test('(a) simple rect SVG produces exactly 1 contour, matching flattenPathToContour() directly', () => {
  const directPath = new paper.Path.Rectangle(new paper.Point(10, 10), new paper.Size(50, 30));
  const directFlattened = flattenPathToContour(directPath, 0.5);
  directPath.remove();

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect x="10" y="10" width="50" height="30"/></svg>`;
  const item = paper.project.importSVG(svg, { expandShapes: true, insert: false });
  const multi = flattenPathToContours(item, 0.5);

  console.log('  direct:', JSON.stringify(directFlattened));
  console.log('  multi: ', JSON.stringify(multi));

  assert.equal(multi.contours.length, 1, 'exactly 1 contour');
  assert.equal(multi.skippedCount, 0, 'no sub-paths skipped');
  assert.equal(multi.xMm, directFlattened.xMm);
  assert.equal(multi.yMm, directFlattened.yMm);
  assert.equal(multi.widthMm, directFlattened.widthMm);
  assert.equal(multi.heightMm, directFlattened.heightMm);
  assert.equal(multi.contours[0].closed, directFlattened.closed);
  assert.deepEqual(multi.contours[0].contour, directFlattened.contour);
});

// -------------------------------------------------------------------------------------------
// (b) SVG with a genuine hole: 2 contours (outer + inner), shared coordinate space verified
//     numerically against the source SVG's own real offsets.
// -------------------------------------------------------------------------------------------
let holeResult;
test('(b) donut SVG (outer square, inner square hole) produces 2 contours in one shared coordinate space', () => {
  // Outer square (0,0)-(80,80), inner hole (20,20)-(60,60) -- straight edges only, so flattening is
  // exact and bounding boxes are exact integers, not curve-approximations.
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 100 100">
    <path fill-rule="evenodd" d="M0,0 L80,0 L80,80 L0,80 Z M20,20 L60,20 L60,60 L20,60 Z"/>
  </svg>`;
  const item = paper.project.importSVG(svg, { expandShapes: true, insert: false });
  const multi = flattenPathToContours(item, 0.5);
  holeResult = multi;

  console.log('  xMm,yMm,widthMm,heightMm:', multi.xMm, multi.yMm, multi.widthMm, multi.heightMm, 'skippedCount:', multi.skippedCount);
  multi.contours.forEach((c, i) => console.log(`  contour[${i}] closed=${c.closed} bbox=`, JSON.stringify(bboxOf(c.contour))));

  assert.equal(multi.contours.length, 2, 'outer + inner hole = 2 contours');
  // clipMask viewport rect must have been skipped, not counted as a real sub-path or a skip either
  // way it must not appear as a 3rd contour.
  assert.equal(multi.xMm, 0);
  assert.equal(multi.yMm, 0);
  assert.equal(multi.widthMm, 80);
  assert.equal(multi.heightMm, 80);

  const outer = multi.contours.find((c) => bboxOf(c.contour).maxX - bboxOf(c.contour).minX === 80);
  const inner = multi.contours.find((c) => bboxOf(c.contour).maxX - bboxOf(c.contour).minX === 40);
  assert.ok(outer, 'outer contour (80x80) found');
  assert.ok(inner, 'inner contour (40x40) found');

  const outerBox = bboxOf(outer.contour);
  const innerBox = bboxOf(inner.contour);
  // Source SVG: outer spans (0,0)-(80,80), inner spans (20,20)-(60,60) -- inner sits inset by
  // exactly (20,20) on every side within the SAME shared (0,0)-rooted space (not independently
  // re-zeroed, which would put innerBox.minX/minY at 0 instead of 20).
  assert.equal(outerBox.minX, 0);
  assert.equal(outerBox.minY, 0);
  assert.equal(innerBox.minX, 20, 'inner hole keeps its real 20mm inset from the outer edge, in shared space');
  assert.equal(innerBox.minY, 20);
  assert.equal(innerBox.maxX, 60);
  assert.equal(innerBox.maxY, 60);
});

// -------------------------------------------------------------------------------------------
// (c) Multi-piece grouped SVG: 2 disjoint contours, correctly positioned relative to each other.
// -------------------------------------------------------------------------------------------
test('(c) grouped SVG with two disjoint rects produces 2 contours, correctly relatively positioned', () => {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100">
    <g><rect x="0" y="0" width="20" height="20"/><rect x="60" y="60" width="20" height="20"/></g>
  </svg>`;
  const item = paper.project.importSVG(svg, { expandShapes: true, insert: false });
  const multi = flattenPathToContours(item, 0.5);

  console.log('  xMm,yMm,widthMm,heightMm:', multi.xMm, multi.yMm, multi.widthMm, multi.heightMm);
  multi.contours.forEach((c, i) => console.log(`  contour[${i}] bbox=`, JSON.stringify(bboxOf(c.contour))));

  assert.equal(multi.contours.length, 2);
  assert.equal(multi.xMm, 0);
  assert.equal(multi.yMm, 0);
  assert.equal(multi.widthMm, 80);
  assert.equal(multi.heightMm, 80);

  const boxes = multi.contours.map((c) => bboxOf(c.contour)).sort((a, b) => a.minX - b.minX);
  assert.deepEqual(boxes[0], { minX: 0, minY: 0, maxX: 20, maxY: 20 });
  assert.deepEqual(boxes[1], { minX: 60, minY: 60, maxX: 80, maxY: 80 });
});

// -------------------------------------------------------------------------------------------
// (d) SVG with one degenerate sub-path alongside valid ones: dropped, valid ones survive, skip
//     count reported.
// -------------------------------------------------------------------------------------------
test('(d) a degenerate sub-path is skipped, valid ones still come through, skip count reported', () => {
  // A moveto immediately closed (M5,5 Z) flattens to a single point -- degenerate (<3 points).
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100">
    <g>
      <path d="M5,5 Z"/>
      <rect x="10" y="10" width="20" height="20"/>
    </g>
  </svg>`;
  const item = paper.project.importSVG(svg, { expandShapes: true, insert: false });
  const multi = flattenPathToContours(item, 0.5);

  console.log('  contours.length:', multi.contours.length, 'skippedCount:', multi.skippedCount);
  multi.contours.forEach((c, i) => console.log(`  contour[${i}] bbox=`, JSON.stringify(bboxOf(c.contour))));

  assert.equal(multi.contours.length, 1, 'only the valid rect survives');
  assert.equal(multi.skippedCount, 1, 'the degenerate sub-path is counted as skipped');
  const box = bboxOf(multi.contours[0].contour);
  assert.equal(box.maxX - box.minX, 20);
  assert.equal(box.maxY - box.minY, 20);
});

// -------------------------------------------------------------------------------------------
// (e) Round-trip: build a 'path' layer from case (b)'s multi-contour output, run it through
//     GeometryEngine.generatePathLayout(), confirm stones fill the ring and avoid the hole.
// -------------------------------------------------------------------------------------------
test('(e) round-trip through createPathLayerFromContours()+generatePathLayout() places stones in the ring, excludes the hole', () => {
  const { layer, warning } = createPathLayerFromContours(holeResult, {
    stoneSize: 2,
    gap: 0.3,
    color: 'gold',
    pathName: 'Donut Import'
  });

  console.log('  layer.contours.length:', layer.contours.length, 'layer.closed:', layer.closed, 'warning:', warning);
  console.log('  layer.x/y/w/h:', layer.x, layer.y, layer.w, layer.h);

  assert.equal(layer.type, 'path');
  assert.equal(layer.contours.length, 2, 'both contours (outer+inner) carried into the layer');
  assert.equal(layer.closed, true);
  assert.equal(warning, null, 'both sub-paths are closed here, so no mismatch warning expected');

  const engine = new GeometryEngine();
  const params = {
    contours: layer.contours.map((c) => c.map((p) => ({ xMm: p.x, yMm: p.y }))),
    layerId: layer.id,
    xMm: layer.x,
    yMm: layer.y,
    widthMm: layer.w,
    heightMm: layer.h,
    stoneSizeMm: layer.stoneSize,
    gapMm: layer.gap,
    mode: 'fill',
    color: layer.color,
    closed: layer.closed
  };
  const result = engine.generatePathLayout(params);

  console.log('  total stones:', result.stones.length);
  console.log('  first 5 stones:', JSON.stringify(result.stones.slice(0, 5).map((s) => ({ x: s.xMm, y: s.yMm, d: s.sizeMm }))));

  assert.ok(result.stones.length > 0, 'stones were generated');

  // Known point INSIDE the hole (center of the 20..60 inner square, e.g. (40,40)) -- no stone
  // should land within one stone radius of it.
  const holeCenter = { xMm: 40, yMm: 40 };
  const nearestToHole = Math.min(...result.stones.map((s) => Math.hypot(s.xMm - holeCenter.xMm, s.yMm - holeCenter.yMm)));
  console.log('  nearest stone to hole center (40,40):', nearestToHole.toFixed(3), 'mm');
  assert.ok(nearestToHole >= 20 - layer.stoneSize / 2 - 0.01, 'no stone lands inside the hole (nearest stone is at least the hole half-width away)');

  // Known point INSIDE the solid ring (e.g. (10,40), between outer edge x=0 and inner hole edge
  // x=20) -- a stone should land within roughly one stone spacing of it.
  const ringPoint = { xMm: 10, yMm: 40 };
  const nearestToRing = Math.min(...result.stones.map((s) => Math.hypot(s.xMm - ringPoint.xMm, s.yMm - ringPoint.yMm)));
  console.log('  nearest stone to ring point (10,40):', nearestToRing.toFixed(3), 'mm');
  assert.ok(nearestToRing < layer.stoneSize + layer.gap + 0.5, 'a stone lands near the known solid-ring point');

  // Every stone must be either outside the inner 20..60 square, or inside the outer 0..80 square,
  // i.e. no stone strictly inside the hole.
  const strictlyInsideHole = result.stones.filter((s) => s.xMm > 20 && s.xMm < 60 && s.yMm > 20 && s.yMm < 60);
  console.log('  stones strictly inside hole bounds:', strictlyInsideHole.length);
  assert.equal(strictlyInsideHole.length, 0, 'zero stones strictly inside the hole square');
});

// -------------------------------------------------------------------------------------------
// (f) NEW: mismatched open/closed sub-paths produce a warning, and still fall back to all-closed.
// -------------------------------------------------------------------------------------------
test('(f) mismatched open/closed sub-paths produce a warning string, fall back to closed=true', () => {
  const flattened = {
    contours: [
      { contour: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }], closed: true },
      { contour: [{ x: 20, y: 20 }, { x: 30, y: 20 }, { x: 30, y: 30 }], closed: false }
    ],
    xMm: 0,
    yMm: 0,
    widthMm: 30,
    heightMm: 30
  };
  const { layer, warning } = createPathLayerFromContours(flattened, {
    stoneSize: 2,
    gap: 0.3,
    color: 'gold',
    pathName: 'Mixed Import'
  });

  console.log('  warning:', warning);
  assert.equal(layer.closed, true, 'still falls back to all-closed');
  assert.ok(warning, 'a warning string is returned when sub-paths disagree');
  assert.match(warning, /open.*closed|closed.*open/i);
});

// -------------------------------------------------------------------------------------------
// Bonus: importSvgIntoItem() fit/center check against a real SVG bigger than its target canvas.
// -------------------------------------------------------------------------------------------
test('(bonus) importSvgIntoItem() fits+centers an oversized SVG into a target canvas, matching app.js\'s own math', () => {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100"><rect x="0" y="0" width="200" height="100"/></svg>`;
  const canvasWidthMm = 100;
  const canvasHeightMm = 100;
  const item = importSvgIntoItem(svg, canvasWidthMm, canvasHeightMm, 20);

  console.log('  fitted bounds:', JSON.stringify(item.bounds));

  const maxW = canvasWidthMm - 20;
  const maxH = canvasHeightMm - 20;
  const s = Math.min(maxW / 200, maxH / 100);
  const expectedW = 200 * s;
  const expectedH = 100 * s;
  const expectedX = (canvasWidthMm - expectedW) / 2;
  const expectedY = (canvasHeightMm - expectedH) / 2;

  assert.ok(Math.abs(item.bounds.width - expectedW) < 1e-6);
  assert.ok(Math.abs(item.bounds.height - expectedH) < 1e-6);
  assert.ok(Math.abs(item.bounds.x - expectedX) < 1e-6);
  assert.ok(Math.abs(item.bounds.y - expectedY) < 1e-6);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exitCode = 1;
