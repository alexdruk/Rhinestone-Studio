import assert from 'node:assert/strict';
import {
  GeometryEngine,
  findOverlappingStonePairs,
  hasAnyOverlappingStonePair
} from '../src/geometry/index.js';

// Boolean early-exit overlap check (companion to findOverlappingStonePairs()).
//
// The Stone Size picker's overlap guard (app.js updateStoneSizeOverlapCapabilityUI()) only consumes
// a bare "does any pair overlap?" boolean per candidate size, but previously paid the full O(n^2)
// pair-collection cost of findOverlappingStonePairs(...).length > 0. hasAnyOverlappingStonePair()
// returns true the instant one overlapping pair is found, scanning with the same grid-bucket
// technique measureStoneCrowding() uses. This suite pins its correctness-equivalence with
// findOverlappingStonePairs() -- which stays the shared overlap definition -- so the two can never
// silently disagree.

function test(name, fn) {
  try {
    fn();
    console.log(`✓ ${name}`);
  } catch (error) {
    console.error(`✗ ${name}`);
    console.error(error);
    process.exitCode = 1;
  }
}

// --- 1. Basic boolean behaviour -----------------------------------------------------------------

test('1. returns false for a clearly non-overlapping stone set', () => {
  const stones = [
    { xMm: 0, yMm: 0, sizeMm: 2 },
    { xMm: 10, yMm: 0, sizeMm: 2 },
    { xMm: 0, yMm: 10, sizeMm: 2 },
    { xMm: 10, yMm: 10, sizeMm: 2 }
  ];
  assert.equal(hasAnyOverlappingStonePair(stones), false);
  assert.equal(findOverlappingStonePairs(stones).length, 0);
});

test('2. returns true when at least one pair physically overlaps', () => {
  const stones = [
    { xMm: 0, yMm: 0, sizeMm: 2 },
    { xMm: 10, yMm: 0, sizeMm: 2 },
    { xMm: 10.5, yMm: 0, sizeMm: 2 } // 0.5mm apart, well under the 2mm touching distance
  ];
  assert.equal(hasAnyOverlappingStonePair(stones), true);
  assert.ok(findOverlappingStonePairs(stones).length > 0);
});

test('3. fewer than two stones can never overlap', () => {
  assert.equal(hasAnyOverlappingStonePair([]), false);
  assert.equal(hasAnyOverlappingStonePair([{ xMm: 3, yMm: 4, sizeMm: 2 }]), false);
});

test('4. exact-touching (distanceMm === sum of radii) is not an overlap, matching the 1e-9 slack', () => {
  const stones = [
    { xMm: 0, yMm: 0, sizeMm: 2 },
    { xMm: 2, yMm: 0, sizeMm: 2 } // centre distance 2mm === (2+2)/2
  ];
  assert.equal(hasAnyOverlappingStonePair(stones), false);
  assert.equal(findOverlappingStonePairs(stones).length, 0);
});

test('5. mixed stone sizes: the per-pair threshold is (a.sizeMm + b.sizeMm) / 2', () => {
  const stones = [
    { xMm: 0, yMm: 0, sizeMm: 1 },
    { xMm: 2.4, yMm: 0, sizeMm: 4 } // touching distance is (1+4)/2 = 2.5mm; 2.4 < 2.5 -> overlap
  ];
  assert.equal(hasAnyOverlappingStonePair(stones), true);
  assert.equal(hasAnyOverlappingStonePair([stones[0], { ...stones[1], xMm: 2.6 }]), false);
});

// --- 2. Equivalence with findOverlappingStonePairs() across representative real layouts -----------
//
// Mirrors the non-font fixtures used by tools/test-geometry-stone-overlap-same-contour.mjs (hairpin
// SVG, closing-seam SVG, sharp-notched star, mixed stoneSizeMm on the star, comfortable circle +
// rectangle). Reusing that file's own engine buildEngine() would drag in the font stack; these
// fixtures reproduce its representative geometry directly.

const hairpinSvg = '<svg xmlns="http://www.w3.org/2000/svg" width="7" height="22">'
  + '<polygon points="0,0 0,22 3,22 3,2 4,2 4,22 7,22 7,0"/>'
  + '</svg>';
const hairpinOpenSvg = '<svg xmlns="http://www.w3.org/2000/svg" width="7" height="22">'
  + '<polyline points="0,0 0,22 3,22 3,2 4,2 4,22 7,22 7,0"/>'
  + '</svg>';
const seamSvg = '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="15">'
  + '<polygon points="0,0 10,0 10,15 0,15"/>'
  + '</svg>';

function layoutCases() {
  const engine = new GeometryEngine();
  const cases = [];

  cases.push(['hairpin (closed, sub-pitch channel)', engine.generateSvgLayout({
    svgSource: hairpinSvg, layerId: 'hairpin', widthMm: 7, heightMm: 22,
    stoneSizeMm: 1.2, gapMm: 0.2, mode: 'outline'
  })]);
  cases.push(['hairpin (open polyline)', engine.generateSvgLayout({
    svgSource: hairpinOpenSvg, layerId: 'hairpin-open', widthMm: 7, heightMm: 22,
    stoneSizeMm: 1.2, gapMm: 0.2, mode: 'outline'
  })]);
  cases.push(['tight closing seam', engine.generateSvgLayout({
    svgSource: seamSvg, layerId: 'seam-tight', widthMm: 10, heightMm: 15,
    stoneSizeMm: 2, gapMm: 5, mode: 'outline'
  })]);
  cases.push(['comfortable closing seam', engine.generateSvgLayout({
    svgSource: seamSvg, layerId: 'seam-ok', widthMm: 10, heightMm: 15,
    stoneSizeMm: 1.5, gapMm: 4.5, mode: 'outline'
  })]);
  cases.push(['comfortable circle outline', engine.generateShapeLayout({
    shape: 'circle', layerId: 'c', cxMm: 25, cyMm: 25, radiusMm: 20,
    stoneSizeMm: 1, gapMm: 1, mode: 'outline'
  })]);
  cases.push(['comfortable rectangle outline', engine.generateShapeLayout({
    shape: 'rectangle', layerId: 'r', xMm: 0, yMm: 0, widthMm: 60, heightMm: 40,
    stoneSizeMm: 1, gapMm: 1, mode: 'outline'
  })]);
  for (const stoneSizeMm of [0.5, 1, 1.5, 2, 3]) {
    cases.push([`sharp-notched star, stoneSizeMm=${stoneSizeMm}`, engine.generateShapeLayout({
      shape: 'star', layerId: `star-${stoneSizeMm}`, xMm: 0, yMm: 0, widthMm: 40, heightMm: 40,
      points: 5, innerRadiusRatio: 0.4, stoneSizeMm, gapMm: 0.2, mode: 'outline'
    })]);
  }

  return cases;
}

test('6. hasAnyOverlappingStonePair(stones) === (findOverlappingStonePairs(stones).length > 0) for every representative layout', () => {
  for (const [name, layout] of layoutCases()) {
    const stones = layout.stones;
    assert.equal(
      hasAnyOverlappingStonePair(stones),
      findOverlappingStonePairs(stones).length > 0,
      `${name}: the two overlap checks must agree`
    );
  }
});

test('7. equivalence still holds on synthetic sets deliberately seeded with overlap', () => {
  // The picker maps real stones to {xMm,yMm,sizeMm}; feed the same shape here, forcing an overlap by
  // collapsing two stones onto each other.
  const base = layoutCases().find(([name]) => name === 'comfortable circle outline')[1].stones
    .map((s) => ({ xMm: s.xMm, yMm: s.yMm, sizeMm: s.sizeMm }));
  assert.equal(hasAnyOverlappingStonePair(base), findOverlappingStonePairs(base).length > 0);

  const seeded = base.map((s, i) => (i === 5 ? { ...base[4] } : s));
  assert.equal(hasAnyOverlappingStonePair(seeded), true);
  assert.equal(hasAnyOverlappingStonePair(seeded), findOverlappingStonePairs(seeded).length > 0);
});

console.log('stone-overlap early-exit (hasAnyOverlappingStonePair) tests passed.');
