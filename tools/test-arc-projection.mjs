import assert from 'node:assert/strict';
import { Point2D } from '../src/text/VectorPath.js';
import { projectPointToArc, projectPolygonToArc, CURVE_DIRECTIONS, CURVE_ALIGNMENTS } from '../src/geometry/ArcProjection.js';

// RS-1003 — direct unit tests of the pure arc-projection math (src/geometry/ArcProjection.js), the
// "Arc projection" stage of the pipeline in docs/specifications/RS-1003-CurvedText.md. These are
// deliberately independent of fonts/GeometryEngine so the geometry itself is pinned to known
// values, separate from tools/test-geometry-engine.mjs's end-to-end text tests.

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

const BASE = {
  totalAdvanceWidthMm: 100,
  radiusMm: 50,
  direction: 'outside',
  startAngleDeg: 0,
  sweepAngleDeg: 180,
  alignment: 'start'
};

await test('1. a point exactly at angle 0 (start, alignment start, t=0) sits at the top of the circle', () => {
  const point = projectPointToArc(new Point2D(0, 0), BASE);
  assert.ok(Math.abs(point.xMm - 0) < 1e-9);
  assert.ok(Math.abs(point.yMm - -50) < 1e-9, `expected yMm ~= -50 (top of circle), got ${point.yMm}`);
});

await test('2. a point at t=0.5 (quarter through a 180deg sweep) sits at 90deg, i.e. directly to the right', () => {
  const point = projectPointToArc(new Point2D(50, 0), BASE);
  assert.ok(Math.abs(point.xMm - 50) < 1e-9, `expected xMm ~= 50, got ${point.xMm}`);
  assert.ok(Math.abs(point.yMm - 0) < 1e-9, `expected yMm ~= 0, got ${point.yMm}`);
});

await test('3. a point at t=1 (end of a 180deg sweep) sits at the bottom of the circle', () => {
  const point = projectPointToArc(new Point2D(100, 0), BASE);
  assert.ok(Math.abs(point.xMm - 0) < 1e-9);
  assert.ok(Math.abs(point.yMm - 50) < 1e-9, `expected yMm ~= 50 (bottom of circle), got ${point.yMm}`);
});

await test('4. outside direction pushes ascenders (negative yMm) to a larger effective radius', () => {
  const baseline = projectPointToArc(new Point2D(0, 0), { ...BASE, direction: 'outside' });
  const ascender = projectPointToArc(new Point2D(0, -10), { ...BASE, direction: 'outside' });
  const baselineRadius = Math.hypot(baseline.xMm, baseline.yMm);
  const ascenderRadius = Math.hypot(ascender.xMm, ascender.yMm);
  assert.ok(ascenderRadius > baselineRadius, 'expected an ascender to sit farther from center than the baseline in outside mode');
});

await test('5. inside direction pushes ascenders (negative yMm) to a smaller effective radius', () => {
  const baseline = projectPointToArc(new Point2D(0, 0), { ...BASE, direction: 'inside' });
  const ascender = projectPointToArc(new Point2D(0, -10), { ...BASE, direction: 'inside' });
  const baselineRadius = Math.hypot(baseline.xMm, baseline.yMm);
  const ascenderRadius = Math.hypot(ascender.xMm, ascender.yMm);
  assert.ok(ascenderRadius < baselineRadius, 'expected an ascender to sit closer to center than the baseline in inside mode');
});

await test('6. outside and inside produce different positions for the same non-baseline point', () => {
  const outside = projectPointToArc(new Point2D(20, -5), { ...BASE, direction: 'outside' });
  const inside = projectPointToArc(new Point2D(20, -5), { ...BASE, direction: 'inside' });
  assert.notDeepEqual(outside, inside);
});

await test('7. alignment "start" begins the text exactly at startAngleDeg', () => {
  const point = projectPointToArc(new Point2D(0, 0), { ...BASE, alignment: 'start', startAngleDeg: 30, sweepAngleDeg: 60 });
  const expectedAngleRad = 30 * Math.PI / 180;
  assert.ok(Math.abs(point.xMm - BASE.radiusMm * Math.sin(expectedAngleRad)) < 1e-9);
  assert.ok(Math.abs(point.yMm - -BASE.radiusMm * Math.cos(expectedAngleRad)) < 1e-9);
});

await test('8. alignment "end" ends the text exactly at startAngleDeg', () => {
  const point = projectPointToArc(new Point2D(100, 0), { ...BASE, alignment: 'end', startAngleDeg: 30, sweepAngleDeg: 60, totalAdvanceWidthMm: 100 });
  const expectedAngleRad = 30 * Math.PI / 180;
  assert.ok(Math.abs(point.xMm - BASE.radiusMm * Math.sin(expectedAngleRad)) < 1e-9);
  assert.ok(Math.abs(point.yMm - -BASE.radiusMm * Math.cos(expectedAngleRad)) < 1e-9);
});

await test('9. alignment "center" centers the text on startAngleDeg', () => {
  const midpoint = projectPointToArc(new Point2D(50, 0), { ...BASE, alignment: 'center', startAngleDeg: 30, sweepAngleDeg: 60, totalAdvanceWidthMm: 100 });
  const expectedAngleRad = 30 * Math.PI / 180;
  assert.ok(Math.abs(midpoint.xMm - BASE.radiusMm * Math.sin(expectedAngleRad)) < 1e-9);
  assert.ok(Math.abs(midpoint.yMm - -BASE.radiusMm * Math.cos(expectedAngleRad)) < 1e-9);
});

await test('10. start/center/end alignment produce three different positions for the same non-midpoint point', () => {
  const opts = { ...BASE, startAngleDeg: 0, sweepAngleDeg: 90, totalAdvanceWidthMm: 100 };
  const start = projectPointToArc(new Point2D(20, 0), { ...opts, alignment: 'start' });
  const center = projectPointToArc(new Point2D(20, 0), { ...opts, alignment: 'center' });
  const end = projectPointToArc(new Point2D(20, 0), { ...opts, alignment: 'end' });
  assert.notDeepEqual(start, center);
  assert.notDeepEqual(center, end);
  assert.notDeepEqual(start, end);
});

await test('11. positive vs negative sweepAngleDeg (clockwise/counter-clockwise) mirror the layout', () => {
  const opts = { ...BASE, startAngleDeg: 0, totalAdvanceWidthMm: 100, alignment: 'start' };
  const clockwise = projectPointToArc(new Point2D(50, 0), { ...opts, sweepAngleDeg: 90 });
  const counterClockwise = projectPointToArc(new Point2D(50, 0), { ...opts, sweepAngleDeg: -90 });
  assert.ok(Math.abs(clockwise.xMm - -counterClockwise.xMm) < 1e-9, 'expected mirrored x for opposite sweep sign');
  assert.ok(Math.abs(clockwise.yMm - counterClockwise.yMm) < 1e-9, 'expected identical y for opposite sweep sign at a symmetric start angle');
});

await test('12. totalAdvanceWidthMm=0 (degenerate empty-text case) does not throw or produce NaN', () => {
  const point = projectPointToArc(new Point2D(0, 0), { ...BASE, totalAdvanceWidthMm: 0 });
  assert.ok(Number.isFinite(point.xMm));
  assert.ok(Number.isFinite(point.yMm));
});

await test('13. projectPolygonToArc() maps every vertex, preserving array length and order', () => {
  const polygon = [new Point2D(0, 0), new Point2D(25, -5), new Point2D(50, 0), new Point2D(75, 5), new Point2D(100, 0)];
  const projected = projectPolygonToArc(polygon, BASE);
  assert.equal(projected.length, polygon.length);
  assert.deepEqual(projected[0], projectPointToArc(polygon[0], BASE));
  assert.deepEqual(projected[4], projectPointToArc(polygon[4], BASE));
});

await test('14. projection is deterministic for identical inputs', () => {
  const point = new Point2D(37, -4);
  const first = projectPointToArc(point, BASE);
  const second = projectPointToArc(point, BASE);
  assert.deepEqual(first, second);
});

await test('15. CURVE_DIRECTIONS and CURVE_ALIGNMENTS export the expected enum values', () => {
  assert.deepEqual([...CURVE_DIRECTIONS].sort(), ['inside', 'outside']);
  assert.deepEqual([...CURVE_ALIGNMENTS].sort(), ['center', 'end', 'start']);
});

console.log('Arc projection tests passed.');
