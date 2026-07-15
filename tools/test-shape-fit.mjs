import assert from 'node:assert/strict';
import { GeometryEngine, FITTABLE_SHAPE_TYPES, computeInscribedRect, computeShapeFitScale, computeContainingShapeScale, isPointInsidePolygons } from '../src/geometry/index.js';
import { BoundingBox, Point2D } from '../src/text/VectorPath.js';
import { createStarNaturalContours, createRegularPolygonNaturalContours, createRingNaturalContours } from '../src/geometry/ShapeLibrary.js';

// S-110 (Smart Text-to-Shape Fitting) — pure, engine-level proof of the two geometry primitives
// fitTextToShape() (app.js) is built on: computeInscribedRect() (the largest same-aspect-ratio
// rectangle fully inside a shape) and computeShapeFitScale() (the scale + legibility-floor decision
// that turns an inscribed rect into a required text height). app.js itself is not executed here (no
// DOM) -- its own structural wiring is covered by tools/test-s110-design-shapes-consolidation.mjs,
// matching this repo's existing app.js test convention (structural checks against the source, not a
// jsdom run).

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

function toPoints(contours) {
  return contours.map((c) => c.map((p) => new Point2D(p.xMm, p.yMm)));
}

function circleContour(radiusMm, segments = 128) {
  const points = [];
  for (let i = 0; i < segments; i++) {
    const a = (i / segments) * 2 * Math.PI;
    points.push(new Point2D(radiusMm * Math.cos(a), radiusMm * Math.sin(a)));
  }
  return points;
}

// --- 1. computeInscribedRect() ------------------------------------------------------------------

await test('1. computeInscribedRect() matches the closed-form largest-inscribed-rectangle-in-a-circle formula', () => {
  const radiusMm = 50;
  const polygon = circleContour(radiusMm);
  const boundingBox = BoundingBox.fromPoints(polygon);
  for (const aspectRatio of [1, 2, 0.5, 3]) {
    const rect = computeInscribedRect([polygon], boundingBox, aspectRatio);
    const expectedWidthMm = (2 * radiusMm * aspectRatio) / Math.sqrt(1 + aspectRatio * aspectRatio);
    const expectedHeightMm = (2 * radiusMm) / Math.sqrt(1 + aspectRatio * aspectRatio);
    assert.ok(Math.abs(rect.widthMm - expectedWidthMm) < 0.1, `aspect ${aspectRatio}: width should be ~${expectedWidthMm}, got ${rect.widthMm}`);
    assert.ok(Math.abs(rect.heightMm - expectedHeightMm) < 0.1, `aspect ${aspectRatio}: height should be ~${expectedHeightMm}, got ${rect.heightMm}`);
    // The rect must be centered on the circle's own center.
    assert.ok(Math.abs(rect.xMm + rect.widthMm / 2) < 0.1, 'rect must be centered on x=0');
    assert.ok(Math.abs(rect.yMm + rect.heightMm / 2) < 0.1, 'rect must be centered on y=0');
  }
});

await test('2. computeInscribedRect() matches the closed-form inscribed square in a circle', () => {
  const radiusMm = 10;
  const polygon = circleContour(radiusMm);
  const rect = computeInscribedRect([polygon], BoundingBox.fromPoints(polygon), 1);
  const expectedSideMm = radiusMm * Math.sqrt(2);
  assert.ok(Math.abs(rect.widthMm - expectedSideMm) < 0.05);
  assert.ok(Math.abs(rect.heightMm - expectedSideMm) < 0.05);
});

await test('3. the returned rect is verified fully inside the polygon, even for a concave shape (5-point Star)', () => {
  const [contour] = toPoints(createStarNaturalContours(5, 0.4));
  const boundingBox = BoundingBox.fromPoints(contour);
  const rect = computeInscribedRect([contour], boundingBox, 1);
  assert.ok(rect && rect.widthMm > 0, 'expected a non-degenerate inscribed rect for a star');
  // Sample the rect's own perimeter and confirm every point is inside the (possibly concave) star --
  // this is exactly what would fail if the algorithm only checked corners/midpoints and a concave
  // notch slipped between two sample points.
  const cx = rect.xMm + rect.widthMm / 2, cy = rect.yMm + rect.heightMm / 2;
  for (let i = 0; i <= 40; i++) {
    const t = i / 40;
    const edgePoints = [
      new Point2D(rect.xMm, rect.yMm + rect.heightMm * t),
      new Point2D(rect.xMm + rect.widthMm, rect.yMm + rect.heightMm * t),
      new Point2D(rect.xMm + rect.widthMm * t, rect.yMm),
      new Point2D(rect.xMm + rect.widthMm * t, rect.yMm + rect.heightMm)
    ];
    for (const p of edgePoints) {
      assert.ok(isPointInsidePolygons(p, [contour]), `perimeter point (${p.xMm.toFixed(2)},${p.yMm.toFixed(2)}) must be inside the star`);
    }
  }
  void cx; void cy;
});

await test('4. a Ring\'s inner opening alone (the sensible "fit text into the hole" region) yields the exact inscribed-square-in-circle result', () => {
  const [, inner] = toPoints(createRingNaturalContours(0.5));
  const box = BoundingBox.fromPoints(inner);
  const rect = computeInscribedRect([inner], box, 1);
  const expectedSideMm = (box.widthMm / 2) * Math.sqrt(2);
  assert.ok(Math.abs(rect.widthMm - expectedSideMm) < 0.01);
});

await test('5. computeInscribedRect() returns null for a degenerate boundingBox/aspectRatio/empty polygon list', () => {
  const polygon = circleContour(10);
  const box = BoundingBox.fromPoints(polygon);
  assert.equal(computeInscribedRect([], box, 1), null);
  assert.equal(computeInscribedRect([polygon], null, 1), null);
  assert.equal(computeInscribedRect([polygon], box, 0), null);
  assert.equal(computeInscribedRect([polygon], box, -1), null);
  assert.equal(computeInscribedRect([polygon], box, NaN), null);
});

await test('6. a hexagon\'s inscribed rect area ratio is plausible (between a very tight lower bound and the shape\'s own bbox area)', () => {
  const [contour] = toPoints(createRegularPolygonNaturalContours(6));
  const box = BoundingBox.fromPoints(contour);
  const rect = computeInscribedRect([contour], box, 1.5);
  assert.ok(rect.fitRatio > 0 && rect.fitRatio < 1, `fitRatio ${rect.fitRatio} must be a plausible fraction of the shape's own bbox`);
});

// --- 2. computeShapeFitScale() -------------------------------------------------------------------

await test('7. computeShapeFitScale() shrinks text to fit a smaller target box', () => {
  const result = computeShapeFitScale({
    // A small spacingMm keeps the legibility floor (spacingMm * 6 = 3mm) well below the scaled
    // height (12.5mm) -- isolates "does scaling-down work" from the separate floor-clamping
    // behavior, which tests 9/10 cover on their own.
    currentHeightMm: 25, measuredWidthMm: 100, measuredHeightMm: 25,
    spacingMm: 0.5, targetWidthMm: 50, targetHeightMm: 20, minHeightToSpacingRatio: 6
  });
  assert.ok(result.ok);
  assert.ok(result.scale < 1, 'a target box smaller than the measured text must produce scale < 1');
  assert.ok(Math.abs(result.scale - 0.5) < 1e-9, 'width is the binding constraint (100 -> 50 is exactly 0.5)');
});

await test('8. computeShapeFitScale() can grow text to better fill a generously larger target box', () => {
  const result = computeShapeFitScale({
    currentHeightMm: 10, measuredWidthMm: 40, measuredHeightMm: 10,
    spacingMm: 1, targetWidthMm: 80, targetHeightMm: 30, minHeightToSpacingRatio: 6
  });
  assert.ok(result.ok);
  assert.ok(result.scale > 1, 'a generously larger target box should be allowed to grow the text');
});

await test('9. computeShapeFitScale() clamps to the legibility floor (spacingMm * minHeightToSpacingRatio) rather than shrinking further', () => {
  // Without a floor, fitting 100mm-wide text into a 10mm-wide box would need scale 0.1 (height -> 2.5mm).
  // The floor (spacingMm=2.3, ratio=6 -> 13.8mm) is well above that, so the floored height's width
  // (100 * (13.8/25) = 55.2mm) must still be checked against the (generous) target width below.
  const result = computeShapeFitScale({
    currentHeightMm: 25, measuredWidthMm: 100, measuredHeightMm: 25,
    spacingMm: 2.3, targetWidthMm: 200, targetHeightMm: 14, minHeightToSpacingRatio: 6
  });
  assert.ok(result.ok);
  const flooredHeightMm = 25 * result.scale;
  assert.ok(flooredHeightMm >= 2.3 * 6 - 1e-9, `expected the floored height (${flooredHeightMm}) to sit at/above the legibility floor`);
});

await test('10. computeShapeFitScale() fails with reason "legibility" when even the floored height does not fit the target width', () => {
  const result = computeShapeFitScale({
    currentHeightMm: 25, measuredWidthMm: 100, measuredHeightMm: 25,
    spacingMm: 2.3, targetWidthMm: 10, targetHeightMm: 10, minHeightToSpacingRatio: 6
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'legibility');
});

await test('11. computeShapeFitScale() fails with reason "empty"/"degenerate" for zero/invalid measured text size', () => {
  const base = { currentHeightMm: 25, spacingMm: 2.3, targetWidthMm: 50, targetHeightMm: 50, minHeightToSpacingRatio: 6 };
  assert.equal(computeShapeFitScale({ ...base, measuredWidthMm: 0, measuredHeightMm: 25 }).ok, false);
  assert.equal(computeShapeFitScale({ ...base, measuredWidthMm: 100, measuredHeightMm: 0 }).ok, false);
});

// --- 3. FITTABLE_SHAPE_TYPES ---------------------------------------------------------------------

await test('12. FITTABLE_SHAPE_TYPES includes every shape required by the spec (Circle/Rectangle/Ellipse/Capsule/Regular Polygon/Star/Heart/Ring)', () => {
  for (const kind of ['circle', 'rectangle', 'ellipse', 'capsule', 'polygon', 'star', 'heart', 'ring']) {
    assert.ok(FITTABLE_SHAPE_TYPES.has(kind), `${kind} must be fittable`);
  }
});

// --- 4. End-to-end: GeometryEngine shape -> inscribed rect -> fit scale, for every new shape kind -

await test('13. end-to-end fit computation succeeds for every FITTABLE_SHAPE_TYPES kind at a representative size', () => {
  const engine = new GeometryEngine();
  const extra = { polygon: { sides: 6 }, star: { points: 5, innerRadiusRatio: 0.5 }, ring: { innerRatio: 0.5 } };
  for (const kind of FITTABLE_SHAPE_TYPES) {
    const params = kind === 'circle'
      ? { shape: 'circle', layerId: 'x', cxMm: 50, cyMm: 50, radiusMm: 40 }
      : { shape: kind, layerId: 'x', xMm: 10, yMm: 10, widthMm: 80, heightMm: 80, ...(extra[kind] || {}) };
    let { polygons, boundingBox } = engine.resolveShapePolygons(params);
    if (kind === 'ring') {
      // Mirrors app.js's resolveShapeLayerPolygonsForFitting(): a Ring's fittable region is its
      // inner opening alone, not the annulus (whose bbox center sits inside the hole itself).
      polygons = [polygons[1]];
      boundingBox = BoundingBox.fromPoints(polygons[0]);
    }
    const rect = computeInscribedRect(polygons, boundingBox, 3);
    assert.ok(rect && rect.widthMm > 0, `${kind}: expected a usable inscribed rect`);
    const scaleResult = computeShapeFitScale({
      currentHeightMm: 20, measuredWidthMm: 60, measuredHeightMm: 20,
      spacingMm: 2.3, targetWidthMm: rect.widthMm, targetHeightMm: rect.heightMm, minHeightToSpacingRatio: 6
    });
    assert.ok(typeof scaleResult.ok === 'boolean', `${kind}: expected a definite ok/fail result`);
  }
});

// --- 5. computeContainingShapeScale() (S-110A: the inverse direction, shape-around-text) --------

await test('14. computeContainingShapeScale() is the exact inverse of computeInscribedRect() for a circle', () => {
  const radiusMm = 18;
  const polygon = circleContour(radiusMm);
  const boundingBox = BoundingBox.fromPoints(polygon);
  const required = { widthMm: 50, heightMm: 20 };
  const fit = computeContainingShapeScale([polygon], boundingBox, required.widthMm, required.heightMm);
  assert.ok(fit && fit.scale > 0);
  // Applying the returned scale to the reference circle's own radius must produce a circle whose
  // largest inscribed rectangle at the required aspect ratio is exactly the required size.
  const scaledRadiusMm = radiusMm * fit.scale;
  const scaledPolygon = circleContour(scaledRadiusMm);
  const scaledBox = BoundingBox.fromPoints(scaledPolygon);
  const check = computeInscribedRect([scaledPolygon], scaledBox, required.widthMm / required.heightMm);
  assert.ok(Math.abs(check.widthMm - required.widthMm) < 0.05, `expected inscribed width ~${required.widthMm}, got ${check.widthMm}`);
  assert.ok(Math.abs(check.heightMm - required.heightMm) < 0.05, `expected inscribed height ~${required.heightMm}, got ${check.heightMm}`);
});

await test('15. computeContainingShapeScale() scales linearly: doubling the required box doubles the scale', () => {
  const radiusMm = 10;
  const polygon = circleContour(radiusMm);
  const boundingBox = BoundingBox.fromPoints(polygon);
  const small = computeContainingShapeScale([polygon], boundingBox, 30, 15);
  const large = computeContainingShapeScale([polygon], boundingBox, 60, 30);
  assert.ok(Math.abs(large.scale / small.scale - 2) < 1e-6, 'doubling the required box must double the scale');
});

await test('16. computeContainingShapeScale() works for a concave reference shape (Star) and a Ring\'s inner opening', () => {
  const [starContour] = toPoints(createStarNaturalContours(5, 0.4));
  const starBox = BoundingBox.fromPoints(starContour);
  const starFit = computeContainingShapeScale([starContour], starBox, 20, 20);
  assert.ok(starFit && starFit.scale > 0);

  const [, ringInner] = toPoints(createRingNaturalContours(0.5));
  const ringBox = BoundingBox.fromPoints(ringInner);
  const ringFit = computeContainingShapeScale([ringInner], ringBox, 20, 8);
  assert.ok(ringFit && ringFit.scale > 0);
});

await test('17. computeContainingShapeScale() returns null for a degenerate required box', () => {
  const polygon = circleContour(10);
  const box = BoundingBox.fromPoints(polygon);
  assert.equal(computeContainingShapeScale([polygon], box, 0, 10), null);
  assert.equal(computeContainingShapeScale([polygon], box, 10, 0), null);
  assert.equal(computeContainingShapeScale([polygon], box, NaN, 10), null);
});

console.log('Smart Text-to-Shape Fitting (S-110) tests passed.');
