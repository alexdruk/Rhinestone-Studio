import assert from 'node:assert/strict';
import { GeometryEngine, dedupeStonesByRadius } from '../src/geometry/index.js';

// RC-004 — regression coverage for the cross-layer stone overlap deduplication Release Candidate
// blocker.
//
// Root cause: app.js's project-level merge step (GeometryEngine.generate(), and its faithful port
// in src/gallery/RhsFixtureBridge.js's generateProjectStoneLayout()) filtered the stones of every
// visible layer, once concatenated, through a single global proximity threshold
// (`Math.min(...raw.map(s=>s.d||2),2)*0.58`) -- pre-dating RC-002, unrelated to real stone geometry,
// and always strictly less than the physically-correct "touching" distance (one stone diameter for
// same-size stones, the sum of two stones' radii in general). Two stones from *different* layers
// placed closer together than that -- but farther apart than the weak threshold -- survived the
// merge even though they physically overlap.
//
// Fix: StoneSampler.js's new dedupeStonesByRadius() replaces that single global threshold with a
// per-pair physically-correct one, `(a.d + b.d) / 2`, computed from each stone's own size (required
// because RS-1013 Variable Stone Sizes allows different layers to use different stoneSizeMm). It
// only ever compares a candidate against an already-kept stone from a *different* layerId -- mirror-
// ing RC-002's own "different contour" rule -- so it never re-checks (or changes) a layer's own
// internal spacing, which is already the sole responsibility of the per-layer GeometryEngine call
// (including RC-002's own cross-contour guard inside it).

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

/** Every pair of stone records whose center-to-center distance is less than the sum of their radii. */
function findOverlappingPairs(stones) {
  const pairs = [];
  for (let i = 0; i < stones.length; i++) {
    for (let j = i + 1; j < stones.length; j++) {
      const a = stones[i], b = stones[j];
      const distanceMm = Math.hypot(a.x - b.x, a.y - b.y);
      const minSeparationMm = (a.d + b.d) / 2;
      if (distanceMm < minSeparationMm - 1e-9) {
        pairs.push([a, b]);
      }
    }
  }
  return pairs;
}

function toFlatRecords(layout) {
  return layout.stones.map((s) => ({ x: s.xMm, y: s.yMm, d: s.sizeMm, color: s.color, layerId: s.layerId }));
}

// --- 1. Two overlapping layers, identical stone sizes -------------------------------------------

await test('1. two overlapping circle layers with identical stone sizes: overlapping stones are removed, no physical overlap remains', () => {
  const engine = new GeometryEngine();
  // Two 20mm circles, centers 5mm apart -- their outlines run directly through each other.
  const layerA = engine.generateShapeLayout({ shape: 'circle', layerId: 'circle-a', cxMm: 20, cyMm: 20, radiusMm: 10, stoneSizeMm: 1.5, gapMm: 0.3, mode: 'outline' });
  const layerB = engine.generateShapeLayout({ shape: 'circle', layerId: 'circle-b', cxMm: 25, cyMm: 20, radiusMm: 10, stoneSizeMm: 1.5, gapMm: 0.3, mode: 'outline' });

  const raw = [...toFlatRecords(layerA), ...toFlatRecords(layerB)];
  assert.ok(findOverlappingPairs(raw).length > 0, 'expected the two raw, un-deduped layers to actually overlap (test setup sanity check)');

  const deduped = dedupeStonesByRadius(raw);
  assert.ok(deduped.length < raw.length, 'expected at least one overlapping stone to be removed');
  assert.deepEqual(findOverlappingPairs(deduped), [], 'no two stones should physically overlap after dedupeStonesByRadius()');
});

// --- 2. Mixed stone sizes across layers ----------------------------------------------------------

await test('2. mixed stone sizes across layers: collision threshold is computed per pair from each stone\'s own size', () => {
  // A large stone (d=4) at the origin and a small stone (d=1) from a different layer.
  // Physically-correct touching distance for this pair is (4+1)/2 = 2.5mm.
  const justInside = { x: 2.4, y: 0, d: 1, layerId: 'small' };  // 2.4mm away: overlaps
  const justOutside = { x: 2.6, y: 0, d: 1, layerId: 'small' }; // 2.6mm away: does not overlap
  const big = { x: 0, y: 0, d: 4, layerId: 'big' };

  const keptOverlapping = dedupeStonesByRadius([big, justInside]);
  assert.deepEqual(keptOverlapping, [big], 'the smaller stone 2.4mm away (inside the sum-of-radii threshold) must be dropped');

  const keptNonOverlapping = dedupeStonesByRadius([big, justOutside]);
  assert.deepEqual(keptNonOverlapping, [big, justOutside], 'the smaller stone 2.6mm away (outside the sum-of-radii threshold) must be kept');

  // Confirm a same-size-pair global threshold would have gotten this wrong: a uniform threshold
  // derived only from the smaller stone's size (the pre-RC-004 app.js behaviour) would use
  // 0.58 * min(4,1,2) = 0.58mm, far below the true 2.5mm physical touching distance -- both
  // 2.4mm and 2.6mm are well outside 0.58mm and would have survived either way. Physically correct
  // per-pair dedupe is required to catch the 2.4mm overlap at all.
  const weakLegacyThreshold = Math.min(big.d, justInside.d, 2) * 0.58;
  assert.ok(2.4 > weakLegacyThreshold, 'sanity check: the legacy weak threshold would have missed this real overlap');
});

// --- 3. Non-overlapping neighbouring layers: legitimate stones preserved -------------------------

await test('3. non-overlapping neighbouring layers: every legitimate stone from both layers survives untouched', () => {
  const engine = new GeometryEngine();
  const layerA = engine.generateShapeLayout({ shape: 'rectangle', layerId: 'rect-a', xMm: 0, yMm: 0, widthMm: 20, heightMm: 20, stoneSizeMm: 1.5, gapMm: 0.3, mode: 'outline' });
  // Placed 30mm to the right -- far outside any stone's reach, comfortably non-overlapping.
  const layerB = engine.generateShapeLayout({ shape: 'rectangle', layerId: 'rect-b', xMm: 50, yMm: 0, widthMm: 20, heightMm: 20, stoneSizeMm: 1.5, gapMm: 0.3, mode: 'outline' });

  const raw = [...toFlatRecords(layerA), ...toFlatRecords(layerB)];
  const deduped = dedupeStonesByRadius(raw);
  assert.equal(deduped.length, raw.length, 'no stone should be dropped when layers do not physically overlap');
  assert.deepEqual(deduped, raw, 'the surviving stones must be byte-identical to the raw input, in the same order');
});

// --- 4. Existing RC-002 within-layer behaviour is untouched --------------------------------------

await test('4. dedupeStonesByRadius() never compares two stones from the same layerId, so RC-002\'s within-call cross-contour guard (and any close-but-intentional same-layer spacing) is unaffected', () => {
  // Simulate a single layer (e.g. RC-002's own Ring case) whose *own* stones happen to be closer
  // than their physically-correct touching distance -- something RC-002 deliberately leaves alone
  // for same-contour points (see StoneSampler.js's sampleMultiContourOutlinePoints() doc comment).
  // The cross-layer merge must be a strict no-op here regardless of how tightly packed one layer's
  // own stones are.
  const tightlyPackedSingleLayer = [
    { x: 0, y: 0, d: 2, layerId: 'ring-1' },
    { x: 0.5, y: 0, d: 2, layerId: 'ring-1' }, // 0.5mm apart, well under the 2mm physical threshold
    { x: 1.0, y: 0, d: 2, layerId: 'ring-1' }
  ];
  const deduped = dedupeStonesByRadius(tightlyPackedSingleLayer);
  assert.deepEqual(deduped, tightlyPackedSingleLayer, 'same-layerId stones must never be dropped by the cross-layer dedupe, no matter how close together');

  // The actual RC-002 regression matrix (tools/test-geometry-stone-overlap-cross-contour.mjs) exercises
  // GeometryEngine.generateShapeLayout() directly -- entirely upstream of, and untouched by, this
  // cross-layer merge step -- so it is unaffected by this milestone; it is not re-run here to avoid
  // duplicating that file's own coverage.
});

console.log('RC-004 (cross-layer stone overlap deduplication) tests passed.');
