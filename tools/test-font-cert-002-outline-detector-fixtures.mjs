import assert from 'node:assert/strict';
import { analyzeOutlineCommands } from './font-certification/lib/glyphOutline.mjs';

const UNITS_PER_EM = 1000;

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

// A convex rounded-rectangle contour built from real quadratic ("Q") curves at each corner plus
// straight edges -- a simple, closed, non-self-intersecting shape with no redundant commands. This is
// the "known-good quadratic contour" fixture the FONT-CERT-002 spec calls for.
function roundedRectCommands({ x, y, w, h, r }) {
  return [
    { type: 'M', x: x + r, y },
    { type: 'L', x: x + w - r, y },
    { type: 'Q', x1: x + w, y1: y, x: x + w, y: y + r },
    { type: 'L', x: x + w, y: y + h - r },
    { type: 'Q', x1: x + w, y1: y + h, x: x + w - r, y: y + h },
    { type: 'L', x: x + r, y: y + h },
    { type: 'Q', x1: x, y1: y + h, x, y: y + h - r },
    { type: 'L', x, y: y + r },
    { type: 'Q', x1: x, y1: y, x: x + r, y },
    { type: 'Z' }
  ];
}

// --- Known-good quadratic contour --------------------------------------------------------------------

await test('known-good: a closed, convex, quadratic-curve rounded-rect contour reports zero of every defect count', () => {
  const commands = roundedRectCommands({ x: 100, y: 100, w: 400, h: 300, r: 60 });
  const analysis = analyzeOutlineCommands(commands, UNITS_PER_EM);

  assert.equal(analysis.openContourCount, 0, 'expected no open contours');
  assert.equal(analysis.selfIntersectionCount, 0, 'expected no self-intersections');
  assert.equal(analysis.crossContourIntersectionCount, 0, 'expected no cross-contour intersections');
  assert.equal(analysis.zeroLengthSegmentCount, 0, 'expected no zero-length raw commands');
  assert.equal(analysis.duplicateSegmentCount, 0, 'expected no duplicate segments');
  assert.equal(analysis.outOfRangeCoordinateCount, 0, 'expected no out-of-range coordinates');
  assert.ok(analysis.curveCommandCount > 0, 'expected this fixture to actually contain curve commands');
  assert.ok(analysis.filledAreaUnits > 0, 'expected a positive enclosed area');
});

await test('known-good: the same rounded-rect contour with an explicit Z omitted still reports zero defects (implicit closure)', () => {
  const commands = roundedRectCommands({ x: 100, y: 100, w: 400, h: 300, r: 60 }).slice(0, -1); // drop the trailing Z
  const analysis = analyzeOutlineCommands(commands, UNITS_PER_EM);
  assert.equal(analysis.openContourCount, 0, 'a contour whose final point returns to its start should count as closed even without an explicit Z');
  assert.equal(analysis.selfIntersectionCount, 0);
});

// --- Known-bad: genuinely self-intersecting outline (bowtie) ------------------------------------------

await test('known-bad: a bowtie/hourglass contour (two diagonals of a square) is detected as self-intersecting', () => {
  const commands = [
    { type: 'M', x: 0, y: 0 },
    { type: 'L', x: 500, y: 500 },
    { type: 'L', x: 500, y: 0 },
    { type: 'L', x: 0, y: 500 },
    { type: 'Z' }
  ];
  const analysis = analyzeOutlineCommands(commands, UNITS_PER_EM);
  assert.ok(analysis.selfIntersectionCount >= 1, `expected at least one detected self-intersection, got ${analysis.selfIntersectionCount}`);
});

// --- Known-bad: open contour ---------------------------------------------------------------------------

await test('known-bad: a contour with no closepath and a large gap between start/end is detected as open', () => {
  const commands = [
    { type: 'M', x: 0, y: 0 },
    { type: 'L', x: 500, y: 0 },
    { type: 'L', x: 500, y: 500 }
    // no Z, and (500,500) is far from the (0,0) start point
  ];
  const analysis = analyzeOutlineCommands(commands, UNITS_PER_EM);
  assert.equal(analysis.openContourCount, 1);
  assert.ok(analysis.maxOpenGapUnits > 400, `expected a large open gap, got ${analysis.maxOpenGapUnits}`);
});

await test('known-good: a contour whose end point lands within the closure tolerance of its start is NOT flagged open', () => {
  const commands = [
    { type: 'M', x: 0, y: 0 },
    { type: 'L', x: 500, y: 0 },
    { type: 'L', x: 500, y: 500 },
    { type: 'L', x: 0.3, y: 0.2 } // within the 1-unit closure epsilon of the (0,0) start point
  ];
  const analysis = analyzeOutlineCommands(commands, UNITS_PER_EM);
  assert.equal(analysis.openContourCount, 0);
});

// --- Known-bad: raw zero-length draw command (the real v003 root cause) -------------------------------

await test('known-bad: an L command whose target exactly duplicates the current pen position is counted as a raw zero-length command', () => {
  const commands = [
    { type: 'M', x: 0, y: 0 },
    { type: 'L', x: 50, y: 0 },
    { type: 'L', x: 50, y: 0 }, // duplicates the previous point exactly -- draws nothing
    { type: 'L', x: 100, y: 0 },
    { type: 'L', x: 100, y: 100 },
    { type: 'L', x: 0, y: 100 },
    { type: 'Z' }
  ];
  const analysis = analyzeOutlineCommands(commands, UNITS_PER_EM);
  assert.equal(analysis.zeroLengthSegmentCount, 1);
  // The critical regression this fixture guards: a single harmless no-op command must not also
  // register as a self-intersection or duplicate segment once deduplicated.
  assert.equal(analysis.selfIntersectionCount, 0);
  assert.equal(analysis.duplicateSegmentCount, 0);
});

await test('known-bad (FONT-CERT-002 root cause): a "Q" immediately followed by a redundant "L" duplicating its own endpoint is counted once as zero-length, not as a self-intersection or an inflated count', () => {
  // Reproduces the exact pattern found in the real v003 candidate: every quadratic curve command
  // followed by a redundant line-to command targeting the curve's own endpoint.
  const commands = [
    { type: 'M', x: 0, y: 0 },
    { type: 'Q', x1: 25, y1: 50, x: 50, y: 0 },
    { type: 'L', x: 50, y: 0 }, // redundant duplicate of the Q's endpoint
    { type: 'Q', x1: 75, y1: -50, x: 100, y: 0 },
    { type: 'L', x: 100, y: 0 }, // redundant duplicate of the Q's endpoint
    { type: 'L', x: 100, y: 100 },
    { type: 'L', x: 0, y: 100 },
    { type: 'Z' }
  ];
  const analysis = analyzeOutlineCommands(commands, UNITS_PER_EM);
  assert.equal(analysis.zeroLengthSegmentCount, 2, 'expected exactly the 2 redundant L commands to be counted, not one per flattened curve sample');
  assert.equal(analysis.selfIntersectionCount, 0, 'a redundant duplicate endpoint must not be misread as a self-intersection');
});

// --- Known-bad: duplicate segment (a retraced edge) ----------------------------------------------------

await test('known-bad: a contour that retraces the same edge twice is detected as a duplicate segment', () => {
  // Out to (200,0), back to (0,0) along the same line, then a real triangle -- the (0,0)-(200,0) edge
  // is traced twice, which is a genuine geometric duplicate, not a curve-tessellation artifact.
  const commands = [
    { type: 'M', x: 0, y: 0 },
    { type: 'L', x: 200, y: 0 },
    { type: 'L', x: 0, y: 0 },
    { type: 'L', x: 100, y: 200 },
    { type: 'Z' }
  ];
  const analysis = analyzeOutlineCommands(commands, UNITS_PER_EM);
  assert.ok(analysis.duplicateSegmentCount >= 1, `expected at least one duplicate segment, got ${analysis.duplicateSegmentCount}`);
});

// --- Numerical-tolerance stability: consistent results across tessellation resolution -----------------

await test('a genuinely smooth, non-self-intersecting quadratic curve reports zero self-intersections regardless of curve length/tightness', () => {
  // A tight, short-radius quadratic arc -- exactly the kind of short curve whose over-tessellation
  // caused false positives before FONT-CERT-002's fix (adjacent flattened samples closer together
  // than the old fixed thresholds).
  const commands = [
    { type: 'M', x: 0, y: 0 },
    { type: 'Q', x1: 5, y1: 10, x: 10, y: 0 },
    { type: 'Q', x1: 15, y1: -10, x: 20, y: 0 },
    { type: 'L', x: 20, y: 100 },
    { type: 'L', x: 0, y: 100 },
    { type: 'Z' }
  ];
  const analysis = analyzeOutlineCommands(commands, UNITS_PER_EM);
  assert.equal(analysis.selfIntersectionCount, 0, `a short, smooth curve must not report spurious self-intersections from over-tessellation, got ${analysis.selfIntersectionCount}`);
  assert.equal(analysis.zeroLengthSegmentCount, 0);
});

console.log('FONT-CERT-002 outline-detector fixture tests passed.');
