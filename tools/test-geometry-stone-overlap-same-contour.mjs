import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FontManager } from '../src/fonts/index.js';
import { createDefaultFontProviderRegistry } from '../src/text/index.js';
import { GeometryEngine, sampleOutlinePoints, findOverlappingStonePairs } from '../src/geometry/index.js';
import { validateRhsProject, generateProjectStoneLayout } from './lib/rhsProject.mjs';

// RC-004A — regression coverage for the same-contour stone self-overlap Release Candidate blocker.
//
// Root cause: outline mode samples stone centers along one contour's own arc-length walk
// (StoneSampler.js's sampleOutlinePoints()). RC-002 already guarantees consecutive samples never
// physically overlap *across* two different contours, but deliberately left every same-contour pair
// unchecked (see sampleMultiContourOutlinePoints()'s pre-RC-004A doc comment, and this suite's own
// tools/test-geometry-stone-overlap-cross-contour.mjs test 6, which explicitly called that a "separate, pre-existing,
// single-contour artifact"). A single contour's arc-length walk only guarantees consecutive samples
// are spacingMm apart *along the perimeter* -- their straight-line (chord) distance is always <=
// that, and sharp curvature (a cursive stroke's tight loop or cusp, a letter's serif detail, a
// sharp corner, a star's inner notch) or a short closing-seam remainder can pull that chord below
// the physically-correct touching distance, producing literal same-contour stone overlap -- even
// between immediately arc-length-adjacent samples, confirmed directly against `long-script-name.rhs`.
//
// Fix: StoneSampler.js's sampleMultiContourOutlinePoints() now runs one physically-correct
// proximity filter (dedupeStonePoints(), scanned in a fixed contour-by-contour order, first of any
// close pair always wins) over every contour's points concatenated together, with no adjacency
// exemption -- so both RC-002's original cross-contour case and this milestone's same-contour case
// are the exact same check. Nothing is ever pruned merely for being *close*: only a literal physical
// overlap (center-to-center distance less than the sum of two stones' radii) removes a stone.
// generateSvgLayout()'s open-contour branch (an SVG `<line>`/`<polyline>`/unclosed `<path>`) gets
// the identical self-check by calling the same function per open polygon.

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

// findOverlappingPairs() now lives in src/geometry/StoneLayout.js as findOverlappingStonePairs()
// -- promoted out of this file so the Stone Size picker's overlap guard (app.js) can share the
// exact same "genuine overlap" definition instead of re-deriving it.
const findOverlappingPairs = findOverlappingStonePairs;

const repoRoot = fileURLToPath(new URL('..', import.meta.url));

async function buildEngine() {
  const manifest = JSON.parse(await readFile(path.join(repoRoot, 'assets/fonts/manifest.json'), 'utf8'));
  const fontManager = new FontManager(manifest);
  async function loadFontBufferFromRepoRoot(relativePath) {
    const buffer = await readFile(path.join(repoRoot, relativePath));
    return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
  }
  const fontProviderRegistry = createDefaultFontProviderRegistry(fontManager, { loadFontBuffer: loadFontBufferFromRepoRoot });
  return new GeometryEngine({ fontProviderRegistry });
}

// --- 1. The confirmed release-blocking repro case: long-script-name.rhs -------------------------

await test('1. long-script-name.rhs (the confirmed release-blocking script-font repro) has zero same-contour overlap and a recognizable stone count', async () => {
  const engine = await buildEngine();
  const raw = await readFile(path.join(repoRoot, 'examples/long-script-name.rhs'), 'utf8');
  const project = validateRhsProject(JSON.parse(raw), 'long-script-name.rhs');
  const layout = await generateProjectStoneLayout(project, engine);

  assert.deepEqual(findOverlappingPairs(layout.stones), [], 'no two stones should physically overlap');
  // Before this fix: 690 stones, 556 overlapping pairs (min clearance 0.0119mm -- stones nearly
  // stacked). After RC-004A: 364 stones, 0 overlapping pairs -- more than half the design's intended
  // coverage survives untouched; only samples that were literally colliding were ever removed.
  // RS-3011 corner-gap backfill: 364 -> 366 (verified directly: sampleMultiContourOutlinePoints()
  // finds exactly 2 of this fixture's many dropped corners/cusps have genuine room for a legal
  // replacement point; the rest are left exactly as RC-004A produced them).
  // outline-uniform-perimeter-spacing: 366 -> 363. Each contour's raw arc-length walk now steps by
  // perimeterMm/round(perimeterMm/spacingMm) instead of the raw spacingMm, so every contour's exact
  // raw sample positions shift slightly -- which corner/cusp-adjacent chords fall under the physical
  // dedupe threshold, and which dropped points have legal RS-3011 backfill room, both shift with
  // them across this fixture's many contours.
  // READ-009: 363 -> 665. This fixture's Auto Fit was previously shrinking its heightMm well below
  // READ-008's MIN_HEIGHT_TO_STONE_RATIO floor because the Gallery fixture bridge
  // (generateProjectStoneLayout(), which this test calls, is generateTextStonesForLayer() under
  // RS-2001's single-implementation rename) had its own floor-less fit-to-width auto-fit, never
  // wired to the floor app.js already enforced. Now that it shares the same floor
  // (src/geometry/TextAutoFit.js), this fixture's text renders larger (matching what the live app
  // has always produced for the same layer), so its outline has room for more, not fewer, stones.
  // Re-verified at current committed geometry: still 0 overlapping pairs and still comfortably
  // above the "not a collapsed skeleton" floor below.
  assert.equal(layout.stones.length, 665, 'deterministic stone count for this fixture at its committed geometry');
  assert.ok(layout.stones.length > 300, 'the fix must not collapse a script font down to a sparse skeleton');
});

// --- 2. Tight loop / doubled-back contour: a hairpin (a "U" with a sub-stone-pitch channel) ------

const hairpinSvg = '<svg xmlns="http://www.w3.org/2000/svg" width="7" height="22">'
  + '<polygon points="0,0 0,22 3,22 3,2 4,2 4,22 7,22 7,0"/>'
  + '</svg>';
// The polygon's two inner prongs run parallel, 1mm apart (channel width) -- narrower than the
// 1.2mm stoneSizeMm used below, so they are guaranteed to physically overlap: a direct,
// deterministic reproducer of "the cursive outline doubles back tightly ... narrow strokes can
// place [samples] too close together in physical space" (this milestone's own root-cause framing),
// without depending on font rendering.

await test('2. a tight loop / doubled-back closed contour (a hairpin whose channel is narrower than one stone pitch): non-adjacent same-contour samples that become spatially close are resolved', () => {
  const engine = new GeometryEngine();
  const layout = engine.generateSvgLayout({
    svgSource: hairpinSvg, layerId: 'hairpin', widthMm: 7, heightMm: 22,
    stoneSizeMm: 1.2, gapMm: 0.2, mode: 'outline'
  });
  assert.deepEqual(findOverlappingPairs(layout.stones), [], 'no two stones should physically overlap across the hairpin\'s channel');
  // Before this fix: 70 stones, 17 same-contour overlapping pairs (the two prongs collide along
  // their whole facing length). After RC-004A: 53 -- the outer legs and bottom bar (comfortably
  // spaced) are untouched; only the colliding prong pairs are thinned.
  // RS-3011 corner-gap backfill: 53 -> 54. Of the 17 drops, 15 are one long run along the inner
  // prong's own straight edge (raw samples 33-47, all dropped because they sit 1mm from the *other*
  // prong, i.e. same-contour walk order but a cross-channel physical conflict) -- backfilling any of
  // them would recreate exactly the channel overlap this fix exists to prevent, and the shared
  // proximity index (checked against every kept point, not just each drop's own two walk-order
  // neighbors) correctly rejects all 15 (verified directly: the shared candidate position for that
  // run sits 1.005mm from a kept point on the other prong, under stoneSizeMm=1.2mm). One further drop
  // (raw16) has no room on its own two-neighbor check either. Only one drop (raw50, near the open top
  // of the hairpin) has genuine room and is legally backfilled.
  assert.equal(layout.stones.length, 54, 'deterministic stone count for this reproducer');
  assert.ok(layout.stones.length > 35, 'the outer legs and bottom bar must survive -- only the colliding channel should be thinned');
});

await test('2b. the same tight loop as an open contour (an SVG polyline, not a closed polygon) gets the identical self-overlap guard', () => {
  const engine = new GeometryEngine();
  const hairpinOpenSvg = '<svg xmlns="http://www.w3.org/2000/svg" width="7" height="22">'
    + '<polyline points="0,0 0,22 3,22 3,2 4,2 4,22 7,22 7,0"/>'
    + '</svg>';
  const layout = engine.generateSvgLayout({
    svgSource: hairpinOpenSvg, layerId: 'hairpin-open', widthMm: 7, heightMm: 22,
    stoneSizeMm: 1.2, gapMm: 0.2, mode: 'outline'
  });
  assert.deepEqual(findOverlappingPairs(layout.stones), [], 'no two stones should physically overlap across the open hairpin\'s channel');
  // RS-3011 corner-gap backfill: 48 -> 49, the open-contour counterpart of test 2's 53 -> 54 (same
  // channel-collision run correctly rejected by the full proximity-index check; one legitimate
  // backfill elsewhere).
  assert.equal(layout.stones.length, 49, 'deterministic stone count for the open-contour reproducer');
});

// --- 3. Ordinary broad contour: completely unaffected --------------------------------------------

await test('3. an ordinary, comfortably-spaced contour (ordinary Circle and Rectangle outlines) is untouched by the same-contour check', () => {
  const engine = new GeometryEngine();
  // gapMm chosen generously relative to stoneSizeMm (gapMm > ~0.41*stoneSizeMm) so that even a
  // rectangle's sharpest features -- its 90-degree corners, whose worst-case adjacent-sample chord
  // is ~0.707*spacingMm -- stay comfortably clear of the physical stoneSizeMm threshold. This is
  // the genuinely "nothing to fix here" case a smaller gap would not guarantee (confirmed directly:
  // a tighter gapMm on this same rectangle *does* legitimately trip a same-contour corner overlap,
  // which is real and correctly handled -- see test 5/6 and examples/baselines.json's own
  // rectangle-only.rhs, which shifts by a few stones for exactly that reason).
  const stoneSizeMm = 1, gapMm = 1;
  const circleParams = { shape: 'circle', layerId: 'c', cxMm: 25, cyMm: 25, radiusMm: 20, stoneSizeMm, gapMm, mode: 'outline' };
  const rectParams = { shape: 'rectangle', layerId: 'r', xMm: 0, yMm: 0, widthMm: 60, heightMm: 40, stoneSizeMm, gapMm, mode: 'outline' };
  const circle = engine.generateShapeLayout(circleParams);
  const rect = engine.generateShapeLayout(rectParams);

  assert.deepEqual(findOverlappingPairs(circle.stones), [], 'a broad circle should never have same-contour overlap');
  assert.deepEqual(findOverlappingPairs(rect.stones), [], 'a broad rectangle should never have same-contour overlap');

  // Ground truth: the exact same per-contour arc-length walk, with no dedupe applied at all. If the
  // fix is a true no-op here, the deduped stone count must equal this raw count exactly.
  const spacingMm = stoneSizeMm + gapMm;
  const { polygons: circlePolygons } = engine.resolveShapePolygons(circleParams);
  const { polygons: rectPolygons } = engine.resolveShapePolygons(rectParams);
  const rawCircleCount = circlePolygons.reduce((n, p) => n + sampleOutlinePoints(p, spacingMm, { closed: true }).length, 0);
  const rawRectCount = rectPolygons.reduce((n, p) => n + sampleOutlinePoints(p, spacingMm, { closed: true }).length, 0);

  assert.equal(circle.stones.length, rawCircleCount, 'a comfortable circle outline must sample exactly as many stones as the unmodified arc-length walk');
  assert.equal(rect.stones.length, rawRectCount, 'a comfortable rectangle outline must sample exactly as many stones as the unmodified arc-length walk');
});

// --- 4. Closing seam: tight (must be fixed) and comfortable (must be preserved) ------------------

const seamSvg = '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="15">'
  + '<polygon points="0,0 10,0 10,15 0,15"/>'
  + '</svg>';
// 10x15mm rectangle, perimeter 50mm.

await test('4a. a tight closing seam (perimeter remainder smaller than one stone diameter against the OLD fixed-pitch walk): the first and last samples no longer overlap', () => {
  const engine = new GeometryEngine();
  // Historical premise (pre outline-uniform-perimeter-spacing): spacingMm=7 -> perimeter 50mm left a
  // 1mm remainder between the last fixed-pitch sample and the seam back to the first -- well under
  // stoneSizeMm=2mm, and (verified directly) the *only* overlapping pair in this shape's raw sampling
  // was that literal seam pair; its four 90-degree corners were not implicated (corner-adjacent chord
  // at that pitch was ~4.9mm, comfortably clear of 2mm). outline-uniform-perimeter-spacing removes
  // this remainder entirely (see below) -- the test name/shape/params are kept unchanged so this
  // stays the same regression fixture, just re-verified under the new walk.
  const layout = engine.generateSvgLayout({ svgSource: seamSvg, layerId: 'seam', widthMm: 10, heightMm: 15, stoneSizeMm: 2, gapMm: 5, mode: 'outline' });
  assert.deepEqual(findOverlappingPairs(layout.stones), [], 'the closing seam must no longer physically overlap');
  // RS-3011 corner-gap backfill (pre outline-uniform-perimeter-spacing): 7 -> 8. This rectangle's
  // closing seam had real backfill room once RC-004A's drop was accounted for: the dropped raw[7]
  // (0,1) left flanking survivors raw[6] (0,8) and raw[0] (0,0), an 8mm gap on a straight edge --
  // well past the old fixed spacingMm=7mm. Hand-derived: parametrizing the straight segment as
  // y=50-s for s in [42,50], distance-to-prev=|s-42| and distance-to-next=50-s crossed at s=46 ->
  // point (0,4), 4mm from each survivor, comfortably >= stoneSizeMm=2mm.
  //
  // outline-uniform-perimeter-spacing: 8 -> 7. This test's whole premise -- "perimeter 50mm leaves a
  // 1mm remainder against the fixed 7mm pitch" -- is exactly the leftover-seam defect this fix
  // removes. n = round(50/7) = 7, effectiveSpacingMm = 50/7 ≈ 7.142857mm: the walk now takes exactly
  // 7 raw samples with a uniform ~7.14mm gap *every* step, including the former seam -- comfortably
  // clear of stoneSizeMm=2mm, so RC-004A's dedupe never drops anything and RS-3011's backfill never
  // fires. Verified directly (see tools/scratch/feature-outline-uniform-perimeter-spacing-verify/):
  // all 7 raw samples survive unmodified, at (0,0), (7.142857,0), (10,4.285714), (10,11.428571),
  // (6.428571,15), (0,14.285714), (0,7.142857).
  assert.equal(layout.stones.length, 7, 'the leftover-seam defect this fix removes means no drop/backfill is needed at all -- all 7 uniformly-spaced raw samples survive');
});

await test('4b. a comfortably-spaced closing seam is not pruned unnecessarily', () => {
  const engine = new GeometryEngine();
  // Historical premise (pre outline-uniform-perimeter-spacing): spacingMm=6 -> perimeter 50mm left a
  // 2mm remainder -- comfortably >= stoneSizeMm=1.5mm, so the seam was never a dedupe/backfill defect
  // here; the old fixed-pitch walk produced 9 raw samples (0,6,...,48; 48<50 still true) and kept
  // all 9 untouched.
  //
  // outline-uniform-perimeter-spacing: 9 -> 8. n = round(50/6) = round(8.333) = 8 (rounds down),
  // effectiveSpacingMm = 50/8 = 6.25mm -- one fewer raw sample than the old fixed-pitch walk's 9,
  // because that walk's own leftover-remainder behavior always keeps a final partial-pitch sample
  // whenever any remainder exists (biasing the raw count up by one relative to the nearest whole
  // number of true pitches), which round() does not. All 8 uniform-step samples still comfortably
  // clear stoneSizeMm=1.5mm at every gap including the seam (~6.25mm each) -- verified directly: no
  // dedupe drop, no backfill, just 8 raw samples at (0,0), (6.25,0), (10,2.5), (10,8.75), (10,15),
  // (3.75,15), (0,12.5), (0,6.25).
  const layout = engine.generateSvgLayout({ svgSource: seamSvg, layerId: 'seam', widthMm: 10, heightMm: 15, stoneSizeMm: 1.5, gapMm: 4.5, mode: 'outline' });
  assert.deepEqual(findOverlappingPairs(layout.stones), [], 'a comfortable seam should never have overlapped in the first place');
  assert.equal(layout.stones.length, 8, 'a correctly-spaced seam must not lose a valid stone beyond the uniform-spacing walk\'s own nearest-integer step count');
});

// --- 5. Sharp notch / star-like contour: real overlaps fixed, RC-002's own leave-alone case protected -

await test('5. a sharp-notched Star: genuine inner-notch overlap is resolved, but the star remains recognizable (most stones untouched)', () => {
  const engine = new GeometryEngine();
  const layout = engine.generateShapeLayout({
    shape: 'star', layerId: 'star-1', xMm: 0, yMm: 0, widthMm: 40, heightMm: 40,
    points: 5, innerRadiusRatio: 0.4, stoneSizeMm: 1.5, gapMm: 0.2, mode: 'outline'
  });
  assert.deepEqual(findOverlappingPairs(layout.stones), [], 'no two stones on the star should physically overlap');
  // Before this fix: 91 stones, 12 same-contour overlapping pairs at the star's five inner notches.
  // After RC-004A: 81 -- an 11% reduction, not a collapse; the five outer points and ten edges are
  // untouched.
  // RS-3011 corner-gap backfill: 81 -> 86. Of the 10 drops, all 10 have a flanking gap worse than
  // spacingMm, but only 5 have a legal replacement once checked against every kept point (not just
  // each drop's own two walk-order neighbors): 2 candidates (raw[19], raw[90]) pass their own
  // two-neighbor equidistant check but actually land within stoneSizeMm of an unrelated kept point
  // elsewhere on the star and are correctly rejected; raw[73] and raw[74] are adjacent drops whose
  // independently-computed candidates coincide at the same point, so the shared proximity index
  // correctly inserts only one of them, not two. Verified directly: the production output's 5 new
  // points match a from-scratch reimplementation's predictions at raw[10], raw[46], raw[64],
  // raw[73]-or-raw[74] (once, not twice), and raw[82].
  //
  // outline-uniform-perimeter-spacing: 86 -> 85. The star's single closed contour now walks at
  // perimeterMm/round(perimeterMm/spacingMm) instead of the raw spacingMm, shifting every raw
  // sample's exact position by a small, uniform amount -- which in turn shifts which inner-notch
  // chords land under the stoneSizeMm=1.5mm dedupe threshold and which dropped points still find
  // legal RS-3011 backfill room. Re-verified at current committed geometry: still 0 overlapping
  // pairs and still comfortably above the "not erased" floor below.
  assert.equal(layout.stones.length, 85, 'deterministic stone count for this Star configuration');
  assert.ok(layout.stones.length > 70, 'the fix must not erase legitimate stones merely because the star\'s edges converge toward each notch');
});

// --- 6. Mixed stone sizes: the physical threshold is derived from stoneSizeMm at every scale ------

await test('6. per-call stoneSizeMm correctly scales the same-contour physical threshold (larger stones require more clearance, smaller stones less)', () => {
  const engine = new GeometryEngine();
  const starParams = { shape: 'star', layerId: 'star-1', xMm: 0, yMm: 0, widthMm: 40, heightMm: 40, points: 5, innerRadiusRatio: 0.4, gapMm: 0.2, mode: 'outline' };
  const counts = [0.5, 1, 1.5, 2, 3].map((stoneSizeMm) => {
    const layout = engine.generateShapeLayout({ ...starParams, stoneSizeMm });
    assert.deepEqual(findOverlappingPairs(layout.stones), [], `stoneSizeMm=${stoneSizeMm}: no two stones should physically overlap`);
    return layout.stones.length;
  });
  // A larger stoneSizeMm imposes a stricter (larger) same-contour clearance requirement, so it must
  // never produce *more* surviving stones than a smaller one at the same underlying geometry.
  for (let i = 1; i < counts.length; i++) {
    assert.ok(counts[i] <= counts[i - 1], `larger stoneSizeMm must not increase stone count: ${counts}`);
  }
});

// --- 7. RC-002 regression: run unchanged -----------------------------------------------------------
//
// tools/test-geometry-stone-overlap-cross-contour.mjs exercises GeometryEngine.generateShapeLayout()/generateSvgLayout()
// directly for cross-contour overlap. This RC-004A fix reuses the exact same
// sampleMultiContourOutlinePoints() entry point (see that file's own test 6, updated alongside this
// milestone to account for RC-004A's own-circle closing-seam fix); it is not re-run here to avoid
// duplicating that file's coverage.

// --- 8. RC-004 regression: run unchanged -----------------------------------------------------------
//
// tools/test-geometry-stone-overlap-cross-layer.mjs exercises dedupeStonesByRadius() (the cross-*layer*
// merge), which this milestone does not touch at all -- same-contour overlap is resolved entirely
// upstream, inside each layer's own GeometryEngine call, before cross-layer merging ever runs. Not
// re-run here to avoid duplicating that file's coverage.

console.log('RC-004A (same-contour stone self-overlap) tests passed.');
