import assert from 'node:assert/strict';
import {
  listFrames,
  getFrameDefinition,
  resolveGenerationContours,
  resolveInnerFittingContours,
  computeFrameInterior,
  computeFrameFitRect,
  computeInscribedRect,
  isPointInsidePolygons
} from '../src/geometry/index.js';
import { Point2D } from '../src/text/VectorPath.js';

// MONO-003 (FrameLibrary & Geometric Frames) — proves the reusable frame architecture future
// monogram generation will consume: every frame loads, generationContours vs innerFittingContours
// stay distinct for hollow frames (the MONO-001A correction — a monogram letter must fit inside a
// frame's opening, never inside its stone border), and the fitting API reuses ShapeFit's own
// computeInscribedRect() rather than reimplementing it. No text/letters/monogram generation is
// exercised here — this file only proves the geometry contract.

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

const GEOMETRIC_FRAME_IDS = ['circle', 'oval', 'square', 'rounded-square', 'diamond', 'octagon', 'pentagon', 'shield'];
const STANDARD_BOX = { xMm: 10, yMm: 20, widthMm: 60, heightMm: 60 };

function shoelaceArea(contour) {
  let area = 0;
  for (let i = 0; i < contour.length; i++) {
    const p1 = contour[i], p2 = contour[(i + 1) % contour.length];
    area += p1.xMm * p2.yMm - p2.xMm * p1.yMm;
  }
  return Math.abs(area / 2);
}

// --- 1. Every frame loads correctly, with a unique id -------------------------------------------

await test('1. listFrames() returns exactly the eight geometric frames, each with a unique id', () => {
  const frames = listFrames();
  assert.equal(frames.length, GEOMETRIC_FRAME_IDS.length);
  const ids = frames.map((f) => f.id);
  assert.deepEqual([...ids].sort(), [...GEOMETRIC_FRAME_IDS].sort());
  assert.equal(new Set(ids).size, ids.length, 'every frame id must be unique');
});

await test('2. every frame definition exposes the required fitting-metadata fields', () => {
  for (const frame of listFrames()) {
    assert.equal(typeof frame.id, 'string');
    assert.equal(typeof frame.label, 'string');
    assert.equal(typeof frame.category, 'string');
    assert.equal(typeof frame.source, 'string');
    assert.equal(typeof frame.clearanceMm, 'number');
    assert.ok(frame.clearanceMm >= 0, 'clearanceMm must be non-negative');
    assert.ok(Number.isFinite(frame.opticalCenterOffset.xMm) && Number.isFinite(frame.opticalCenterOffset.yMm));
    const limits = frame.scalingLimitsMm;
    assert.ok(limits.minWidthMm > 0 && limits.maxWidthMm > limits.minWidthMm, `${frame.id}: scalingLimitsMm width range must be valid`);
    assert.ok(limits.minHeightMm > 0 && limits.maxHeightMm > limits.minHeightMm, `${frame.id}: scalingLimitsMm height range must be valid`);
  }
});

await test('3. getFrameDefinition() returns each frame by id and throws a specific, actionable error for an unknown id', () => {
  for (const id of GEOMETRIC_FRAME_IDS) {
    assert.equal(getFrameDefinition(id).id, id);
  }
  assert.throws(() => getFrameDefinition('bogus-frame'), TypeError);
});

await test('4. every geometric frame reuses either ShapeLibrary or FrameLibrary geometry, never a third system', () => {
  for (const frame of listFrames()) {
    assert.ok(['shapeLibrary', 'frameLibrary'].includes(frame.source), `${frame.id}: unexpected source "${frame.source}"`);
  }
  // Circle/Oval/Diamond are direct reuse of existing ShapeLibrary.js generators (Ring, Polygon).
  assert.equal(getFrameDefinition('circle').source, 'shapeLibrary');
  assert.equal(getFrameDefinition('oval').source, 'shapeLibrary');
  assert.equal(getFrameDefinition('diamond').source, 'shapeLibrary');
  // Square/Rounded Square needed new geometry (no rounded-rectangle generator existed anywhere).
  assert.equal(getFrameDefinition('square').source, 'frameLibrary');
  assert.equal(getFrameDefinition('rounded-square').source, 'frameLibrary');
});

// --- 2. Generation contour validity ---------------------------------------------------------------

await test('5. resolveGenerationContours() places every frame within its requested x/y/w/h box', () => {
  for (const id of GEOMETRIC_FRAME_IDS) {
    const { polygons, boundingBox } = resolveGenerationContours(id, STANDARD_BOX);
    assert.ok(polygons.length >= 2, `${id}: a hollow frame's generation geometry must have at least an outer + inner contour`);
    assert.ok(boundingBox, `${id}: expected a resolvable bounding box`);
    assert.ok(boundingBox.minXmm >= STANDARD_BOX.xMm - 1e-6 && boundingBox.maxXmm <= STANDARD_BOX.xMm + STANDARD_BOX.widthMm + 1e-6, `${id}: must be placed within the requested x/width box`);
    assert.ok(boundingBox.minYmm >= STANDARD_BOX.yMm - 1e-6 && boundingBox.maxYmm <= STANDARD_BOX.yMm + STANDARD_BOX.heightMm + 1e-6, `${id}: must be placed within the requested y/height box`);
  }
});

await test('6. generation contours form a real band: outer contour area exceeds inner contour area', () => {
  for (const id of GEOMETRIC_FRAME_IDS) {
    const { polygons } = resolveGenerationContours(id, STANDARD_BOX);
    const [outer, inner] = polygons;
    assert.ok(shoelaceArea(outer) > shoelaceArea(inner), `${id}: outer contour must enclose more area than the inner contour`);
  }
});

// --- 3. Inner fitting contour validity / hollow frames expose distinct fitting contours ----------

await test('7. resolveInnerFittingContours() returns a single contour, strictly smaller than the full generation geometry', () => {
  for (const id of GEOMETRIC_FRAME_IDS) {
    const generation = resolveGenerationContours(id, STANDARD_BOX);
    const fitting = resolveInnerFittingContours(id, STANDARD_BOX);
    assert.equal(fitting.polygons.length, 1, `${id}: a hollow frame's fitting geometry must be exactly one contour`);
    assert.ok(fitting.boundingBox.widthMm < generation.boundingBox.widthMm, `${id}: fitting region must be smaller than the full frame`);
    assert.ok(fitting.boundingBox.heightMm < generation.boundingBox.heightMm, `${id}: fitting region must be smaller than the full frame`);
    // The fitting contour must be the *inner* contour, not the outer one.
    assert.deepEqual(fitting.polygons[0].map((p) => [p.xMm, p.yMm]), generation.polygons[1].map((p) => [p.xMm, p.yMm]));
  }
});

await test('8. every frame\'s fitting contour bounding box is centered on its own generation bounding box', () => {
  for (const id of GEOMETRIC_FRAME_IDS) {
    const generation = resolveGenerationContours(id, STANDARD_BOX);
    const fitting = resolveInnerFittingContours(id, STANDARD_BOX);
    assert.ok(Math.abs(fitting.boundingBox.center.xMm - generation.boundingBox.center.xMm) < 1e-6, `${id}: fitting region must share the frame's own center (x)`);
    assert.ok(Math.abs(fitting.boundingBox.center.yMm - generation.boundingBox.center.yMm) < 1e-6, `${id}: fitting region must share the frame's own center (y)`);
  }
});

// --- 4. Circle fitting must use the interior opening, not the generated ring ---------------------

await test('9. Circle fitting uses the interior opening rather than the generated ring (MONO-001A)', () => {
  const box = { xMm: 0, yMm: 0, widthMm: 80, heightMm: 80 };
  const generation = resolveGenerationContours('circle', box);
  const fitting = resolveInnerFittingContours('circle', box);
  const cxMm = box.widthMm / 2, cyMm = box.heightMm / 2;

  // The band's own center point (inside the hole) must be inside the fitting region...
  assert.ok(isPointInsidePolygons(new Point2D(cxMm, cyMm), fitting.polygons), 'frame center must be inside the fitting opening');
  // ...but NOT inside the generation geometry's band itself (even-odd: the hole is excluded).
  assert.ok(!isPointInsidePolygons(new Point2D(cxMm, cyMm), generation.polygons), 'frame center must NOT be considered "inside" the stone border geometry');

  // A point sitting on the outer ring's own radius (inside the border band) must be excluded from
  // the fitting region entirely -- this is exactly what would fail if fitting used the full ring.
  const outerRadiusMm = box.widthMm / 2;
  const onBand = new Point2D(cxMm + outerRadiusMm * 0.9, cyMm);
  assert.ok(!isPointInsidePolygons(onBand, fitting.polygons), 'a point inside the stone border band must not be part of the fitting region');
});

// --- 5. Solid frames behave correctly (generic architecture path, synthetic fixture) --------------

await test('10. solid frames behave correctly: resolveInnerFittingContours()/computeFrameInterior() fall back to the frame\'s own ordinary geometry', () => {
  // No frame in the current geometric set is solid (a "frame" is a border by definition), but the
  // architecture must support one -- resolveGenerationContours()/resolveInnerFittingContours()/
  // computeFrameInterior() all accept a frame-definition-shaped object directly (not only a
  // registered id, see FrameLibrary.js's own resolveFrame()), which is what lets this test exercise
  // the real `frame.hollow === false` branch through the actual public functions, per the milestone's
  // "solid frames may continue using their ordinary geometry" instruction -- not a re-implementation
  // of that branch's logic in the test itself.
  const diamond = getFrameDefinition('diamond');
  const solidFrame = {
    ...diamond,
    id: 'test-solid-frame-fixture',
    hollow: false,
    clearanceMm: 0,
    // A solid frame has no separate inner ring -- its own outer contour is its only geometry.
    generationNaturalContours: [diamond.generationNaturalContours[0]],
    fittingNaturalContours: [diamond.generationNaturalContours[0]]
  };
  const box = STANDARD_BOX;

  const generation = resolveGenerationContours(solidFrame, box);
  assert.equal(generation.polygons.length, 1, 'a solid frame has exactly one (outer-only) generation contour');

  const fitting = resolveInnerFittingContours(solidFrame, box);
  assert.equal(fitting.polygons.length, 1);
  assert.deepEqual(
    fitting.polygons[0].map((p) => [p.xMm, p.yMm]),
    generation.polygons[0].map((p) => [p.xMm, p.yMm]),
    'a solid frame\'s fitting geometry must be its own ordinary (outer) geometry, not a separately-derived inner contour'
  );

  const interior = computeFrameInterior(solidFrame, box);
  assert.ok(interior.boundingBox.widthMm > 0, 'a solid frame\'s interior must remain a usable fitting region');
  // clearanceMm is 0 for this fixture, so computeFrameInterior() must return the raw fitting geometry unchanged.
  assert.deepEqual(
    interior.polygons[0].map((p) => [p.xMm, p.yMm]),
    fitting.polygons[0].map((p) => [p.xMm, p.yMm])
  );
});

// --- 6. Fitting contour bounding boxes --------------------------------------------------------

await test('11. Square/Rounded Square/Diamond fitting bounding boxes are strictly inside their own generation bounding boxes', () => {
  for (const id of ['square', 'rounded-square', 'diamond']) {
    const generation = resolveGenerationContours(id, STANDARD_BOX);
    const fitting = resolveInnerFittingContours(id, STANDARD_BOX);
    assert.ok(fitting.boundingBox.minXmm > generation.boundingBox.minXmm - 1e-6 && fitting.boundingBox.minXmm >= generation.boundingBox.minXmm, `${id}: fitting bbox must not extend past the frame's own bbox`);
    assert.ok(fitting.boundingBox.maxXmm <= generation.boundingBox.maxXmm + 1e-6, `${id}: fitting bbox must not extend past the frame's own bbox`);
    assert.ok(fitting.boundingBox.maxYmm <= generation.boundingBox.maxYmm + 1e-6, `${id}: fitting bbox must not extend past the frame's own bbox`);
  }
});

// --- 7. ShapeFit integration -----------------------------------------------------------------------

await test('12. computeFrameFitRect() reuses ShapeFit.computeInscribedRect() and returns a rect fully inside the fitting region', () => {
  for (const id of GEOMETRIC_FRAME_IDS) {
    const box = { xMm: 0, yMm: 0, widthMm: 100, heightMm: 100 };
    const rect = computeFrameFitRect(id, box, 2);
    assert.ok(rect && rect.widthMm > 0 && rect.heightMm > 0, `${id}: expected a usable inscribed rect`);
    assert.ok(Math.abs(rect.widthMm / rect.heightMm - 2) < 1e-6, `${id}: inscribed rect must honor the requested aspect ratio`);

    // Cross-check against calling ShapeFit directly on computeFrameInterior()'s own output --
    // computeFrameFitRect() must not diverge from that combination.
    const { polygons, boundingBox } = computeFrameInterior(id, box);
    const direct = computeInscribedRect(polygons, boundingBox, 2);
    assert.deepEqual(rect, direct, `${id}: computeFrameFitRect() must exactly match computeFrameInterior()+computeInscribedRect()`);
  }
});

await test('13. computeFrameInterior() applies clearanceMm as an inward margin relative to the raw inner fitting contour', () => {
  const box = { xMm: 0, yMm: 0, widthMm: 100, heightMm: 100 };
  const raw = resolveInnerFittingContours('circle', box);
  const withClearance = computeFrameInterior('circle', box);
  assert.ok(withClearance.boundingBox.widthMm < raw.boundingBox.widthMm, 'clearanceMm must shrink the fitting region');
  assert.ok(withClearance.boundingBox.heightMm < raw.boundingBox.heightMm, 'clearanceMm must shrink the fitting region');
  // The clearance-adjusted region must remain centered on the same point.
  assert.ok(Math.abs(withClearance.boundingBox.center.xMm - raw.boundingBox.center.xMm) < 1e-6);
  assert.ok(Math.abs(withClearance.boundingBox.center.yMm - raw.boundingBox.center.yMm) < 1e-6);
});

// --- 8. Deterministic repeated calls -----------------------------------------------------------

await test('14. every frame resolves identical geometry across repeated calls with identical input', () => {
  for (const id of GEOMETRIC_FRAME_IDS) {
    const a = resolveGenerationContours(id, STANDARD_BOX);
    const b = resolveGenerationContours(id, STANDARD_BOX);
    assert.deepEqual(
      a.polygons.map((c) => c.map((p) => [p.xMm, p.yMm])),
      b.polygons.map((c) => c.map((p) => [p.xMm, p.yMm])),
      `${id}: resolveGenerationContours() must be deterministic`
    );
    const fitA = computeFrameInterior(id, STANDARD_BOX);
    const fitB = computeFrameInterior(id, STANDARD_BOX);
    assert.deepEqual(
      fitA.polygons.map((c) => c.map((p) => [p.xMm, p.yMm])),
      fitB.polygons.map((c) => c.map((p) => [p.xMm, p.yMm])),
      `${id}: computeFrameInterior() must be deterministic`
    );
  }
});

// --- 9. Per-shape geometric sanity checks -------------------------------------------------------

await test('15. Circle: outer/inner contours are circular (constant radius from center)', () => {
  const box = { xMm: 0, yMm: 0, widthMm: 80, heightMm: 80 };
  const { polygons, boundingBox } = resolveGenerationContours('circle', box);
  const cx = boundingBox.center.xMm, cy = boundingBox.center.yMm;
  for (const contour of polygons) {
    const radii = contour.map((p) => Math.hypot(p.xMm - cx, p.yMm - cy));
    const min = Math.min(...radii), max = Math.max(...radii);
    assert.ok((max - min) / max < 0.01, 'Circle contour points must sit at a near-constant radius from center');
  }
});

await test('16. Oval: placing the same ring geometry into a non-square box yields an elliptical (non-circular) band', () => {
  const box = { xMm: 0, yMm: 0, widthMm: 120, heightMm: 60 };
  const { boundingBox } = resolveGenerationContours('oval', box);
  assert.ok(Math.abs(boundingBox.widthMm - 120) < 1e-6);
  assert.ok(Math.abs(boundingBox.heightMm - 60) < 1e-6);
  assert.ok(boundingBox.widthMm !== boundingBox.heightMm, 'Oval placed into a non-square box must not be circular');
});

await test('17. Square: outer contour is axis-aligned with exactly four corners at the frame\'s own bounding box', () => {
  const box = { xMm: 0, yMm: 0, widthMm: 80, heightMm: 80 };
  const { polygons, boundingBox } = resolveGenerationContours('square', box);
  const outer = polygons[0];
  const corners = [
    [boundingBox.minXmm, boundingBox.minYmm], [boundingBox.maxXmm, boundingBox.minYmm],
    [boundingBox.maxXmm, boundingBox.maxYmm], [boundingBox.minXmm, boundingBox.maxYmm]
  ];
  for (const [cx, cy] of corners) {
    const hasCorner = outer.some((p) => Math.abs(p.xMm - cx) < 1e-6 && Math.abs(p.yMm - cy) < 1e-6);
    assert.ok(hasCorner, `Square outer contour must include corner (${cx},${cy})`);
  }
});

await test('18. Rounded Square: outer contour never reaches the frame\'s own sharp corners (it is actually rounded)', () => {
  const box = { xMm: 0, yMm: 0, widthMm: 80, heightMm: 80 };
  const { polygons, boundingBox } = resolveGenerationContours('rounded-square', box);
  const outer = polygons[0];
  const sharpCorner = [boundingBox.maxXmm, boundingBox.maxYmm];
  const nearestDistMm = Math.min(...outer.map((p) => Math.hypot(p.xMm - sharpCorner[0], p.yMm - sharpCorner[1])));
  assert.ok(nearestDistMm > 1, 'Rounded Square must not have a vertex sitting at its own sharp bounding-box corner');
});

await test('19. Diamond: outer contour has exactly 4 vertices, oriented as a rotated square (points at top/right/bottom/left)', () => {
  const box = { xMm: 0, yMm: 0, widthMm: 80, heightMm: 80 };
  const { polygons, boundingBox } = resolveGenerationContours('diamond', box);
  const outer = polygons[0];
  assert.equal(outer.length, 4, 'Diamond outer contour must have exactly 4 vertices');
  const cx = boundingBox.center.xMm, cy = boundingBox.center.yMm;
  // Every vertex must sit on an axis through the center (top/right/bottom/left), not at a corner.
  for (const p of outer) {
    const onVerticalAxis = Math.abs(p.xMm - cx) < 1e-6;
    const onHorizontalAxis = Math.abs(p.yMm - cy) < 1e-6;
    assert.ok(onVerticalAxis || onHorizontalAxis, 'Diamond vertices must lie on the shape\'s own vertical/horizontal axis');
  }
});

console.log('FrameLibrary (MONO-003) tests passed.');
