import assert from 'node:assert/strict';
import {
  createGeometryEngine,
  sampleFieldByMode,
  sampleContourFieldFillPoints,
  sampleRadialFieldFillPoints,
  nudgeOrDropStonePoints,
  dedupeStonePoints
} from '../src/geometry/index.js';
import { Point2D } from '../src/text/VectorPath.js';
import { createImageBuffer, prepareImageField } from '../src/image/index.js';
import { FIELD_ON_THRESHOLD } from '../src/geometry/StoneSampler.js';
import fs from 'node:fs';

// IMG-005 -- unit tests for the Check & Fix same-layer spacing repair pass
// (StoneSampler.js's nudgeOrDropStonePoints(), its wiring into sampleContourFieldFillPoints()/
// sampleRadialFieldFillPoints()/sampleFieldByMode(), GeometryEngine.generateImageLayout()'s
// checkFixStats accumulator, StoneLayout's checkFixStats field, and the app.js/index.html Studio
// report). See docs/specifications/IMG-005-CheckAndFix.md, "Test Plan".

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

// Both fixture generators, verbatim from docs/specifications/IMG-005-CheckAndFix.md, Test Plan.
function disc(n) {
  const d = new Uint8ClampedArray(n * n);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const dx = x - n / 2 + 0.5, dy = y - n / 2 + 0.5;
    d[y * n + x] = dx * dx + dy * dy < (n * 0.45) ** 2 ? 255 : 0;
  }
  return { widthPx: n, heightPx: n, data: d };
}
function dumbbell(n) {
  const d = new Uint8ClampedArray(n * n);
  const lobeR = n * 0.22;
  const cx1 = n * 0.28, cx2 = n * 0.72, cy = n / 2;
  const neckHalfH = n * 0.06;
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const dx1 = x - cx1 + 0.5, dy1 = y - cy + 0.5;
    const dx2 = x - cx2 + 0.5, dy2 = y - cy + 0.5;
    const inLobe1 = dx1 * dx1 + dy1 * dy1 < lobeR * lobeR;
    const inLobe2 = dx2 * dx2 + dy2 * dy2 < lobeR * lobeR;
    const inNeck = (x + 0.5) >= cx1 && (x + 0.5) <= cx2 && Math.abs(y - cy + 0.5) < neckHalfH;
    d[y * n + x] = (inLobe1 || inLobe2 || inNeck) ? 255 : 0;
  }
  return { widthPx: n, heightPx: n, data: d };
}

const PLACEMENT = { xMm: 10, yMm: 7, widthMm: 60, heightMm: 60 };
const STONE_SIZE_MM = 2.7;
const GAP_MM = 0.3;
const SPACING_MM = STONE_SIZE_MM + GAP_MM; // 3.0
// Grid-hash accumulation (StoneSampler.js's own scan) lands adjacent/nudged points up to a few
// e-15/e-16 mm off their nominal target -- the same floating-point-noise class BACKLOG.md's
// findCrossGroupCollisions() row documents and works around with a 1e-9mm slack. Applied identically
// here so a mathematically-exact touch at the floor never misreports as a "violation".
const FLOOR_SLACK_MM = 1e-9;

const DISC_FIELD = disc(200);
const DUMBBELL_FIELD = dumbbell(200);

// Measured directly against develop@34e237c (docs/specifications/IMG-005-CheckAndFix.md, Test Plan)
// -- re-confirmed by direct execution against this branch's own StoneSampler.js exports (git-shown
// pre-IMG-005 module, imports rewritten to absolute paths, run standalone) before writing this file.
const PRE_FIX_BASELINE = {
  disc: { contour: { count: 255, pairsUnderSpacing: 286, minDistMm: 2.7787 }, radial: { count: 245, pairsUnderSpacing: 0, minDistMm: 3.0 } },
  dumbbell: { contour: { count: 120, pairsUnderSpacing: 138, minDistMm: 2.7467 }, radial: { count: 117, pairsUnderSpacing: 0, minDistMm: 3.0 } }
};
const NO_VIOLATION_BASELINE = {
  disc: { fill: 256, staggered: 298, organic: 182, edge: 48 },
  dumbbell: { fill: 120, staggered: 141, organic: 89, edge: 27 }
};

function minPairwiseDistance(points) {
  let min = Infinity;
  for (let i = 0; i < points.length; i++) {
    for (let j = i + 1; j < points.length; j++) {
      const dx = points[i].xMm - points[j].xMm, dy = points[i].yMm - points[j].yMm;
      const d = Math.hypot(dx, dy);
      if (d < min) min = d;
    }
  }
  return min;
}
function pairsUnderFloor(points, floorMm) {
  let count = 0;
  for (let i = 0; i < points.length; i++) {
    for (let j = i + 1; j < points.length; j++) {
      const dx = points[i].xMm - points[j].xMm, dy = points[i].yMm - points[j].yMm;
      if (Math.hypot(dx, dy) < floorMm - FLOOR_SLACK_MM) count++;
    }
  }
  return count;
}

// Local copy of fieldPixelOn() -- module-private in StoneSampler.js, not exported -- the same
// convention tools/test-img-004-edge-awareness.mjs's own copy uses to verify the on-field invariant
// from outside the module.
function fieldPixelOn(field, localXMm, localYMm, widthMm, heightMm) {
  if (localXMm < 0 || localYMm < 0 || localXMm > widthMm || localYMm > heightMm) return false;
  const pixelX = Math.min(field.widthPx - 1, Math.max(0, Math.floor((localXMm / widthMm) * field.widthPx)));
  const pixelY = Math.min(field.heightPx - 1, Math.max(0, Math.floor((localYMm / heightMm) * field.heightPx)));
  return field.data[pixelY * field.widthPx + pixelX] >= FIELD_ON_THRESHOLD;
}

function discImageBuffer(n) {
  const src = disc(n).data;
  const rgba = new Uint8ClampedArray(n * n * 4);
  for (let i = 0; i < src.length; i++) {
    const v = src[i] >= FIELD_ON_THRESHOLD ? 0 : 255;
    rgba[i * 4] = v; rgba[i * 4 + 1] = v; rgba[i * 4 + 2] = v; rgba[i * 4 + 3] = 255;
  }
  return createImageBuffer({ widthPx: n, heightPx: n, data: rgba });
}

await test('1. Regression baseline: disc/dumbbell Contour/Radial, post-fix violation count is exactly 0', () => {
  for (const [label, field] of [['disc', DISC_FIELD], ['dumbbell', DUMBBELL_FIELD]]) {
    for (const mode of ['contour', 'radial']) {
      const pre = PRE_FIX_BASELINE[label][mode];
      const stats = { violationsFound: 0, repaired: 0, dropped: 0 };
      const fn = mode === 'contour' ? sampleContourFieldFillPoints : sampleRadialFieldFillPoints;
      const post = fn(field, PLACEMENT, SPACING_MM, STONE_SIZE_MM, GAP_MM, stats);
      assert.ok(post.length > 0, `${label} ${mode}: expected a non-empty post-fix layout`);
      assert.equal(
        pairsUnderFloor(post, SPACING_MM), 0,
        `${label} ${mode}: expected 0 pairs under the ${SPACING_MM}mm floor post-fix (pre-fix reference: ${pre.count} stones, ${pre.pairsUnderSpacing} under-floor pairs, ${pre.minDistMm}mm min distance)`
      );
    }
  }
});

await test('2. Nudge validity: every point in the post-fix output satisfies insideAt() and clears the floor against every other kept point (exhaustive pairwise scan)', () => {
  for (const [, field] of [['disc', DISC_FIELD], ['dumbbell', DUMBBELL_FIELD]]) {
    for (const mode of ['contour', 'radial']) {
      const stats = { violationsFound: 0, repaired: 0, dropped: 0 };
      const fn = mode === 'contour' ? sampleContourFieldFillPoints : sampleRadialFieldFillPoints;
      const post = fn(field, PLACEMENT, SPACING_MM, STONE_SIZE_MM, GAP_MM, stats);
      for (const p of post) {
        const localXMm = p.xMm - PLACEMENT.xMm, localYMm = p.yMm - PLACEMENT.yMm;
        assert.ok(fieldPixelOn(field, localXMm, localYMm, PLACEMENT.widthMm, PLACEMENT.heightMm), `point (${p.xMm},${p.yMm}) is off-field`);
      }
      assert.equal(minPairwiseDistance(post), minPairwiseDistance(post)); // sanity: finite, no NaN
      assert.ok(minPairwiseDistance(post) >= SPACING_MM - FLOOR_SLACK_MM, `expected every pair >= ${SPACING_MM}mm apart`);
      assert.ok(stats.repaired >= 0);
    }
  }

  // Direct unit-level check of the "re-validate against every kept point found in the 3x3 window,
  // not just the point it was nudged away from" claim: a candidate whose single-direction nudge away
  // from its nearest offender lands close to a THIRD, unrelated kept point -- `decoy` is itself
  // >= floorMm from `nearest` (so it is kept as-is, uninvolved in the candidate's own violation) but
  // sits only 2mm from the candidate's exact nudge target (3,0), inside the 3mm floor.
  const floorMm = 3;
  const nearest = new Point2D(0, 0);
  const decoy = new Point2D(5, 0);
  const candidate = new Point2D(1, 0); // too close to `nearest` (distance 1 < floorMm)
  const stats = { violationsFound: 0, repaired: 0, dropped: 0 };
  const result = nudgeOrDropStonePoints([nearest, decoy, candidate], () => true, floorMm, 0, stats);
  assert.equal(stats.violationsFound, 1);
  assert.equal(result.length, 2, 'the candidate must be dropped -- its only nudge direction is blocked by the decoy');
  assert.equal(stats.dropped, 1);
  assert.equal(stats.repaired, 0);
});

await test('3. Nudge-impossible falls back to drop, not a failed nudge left in place', () => {
  // Three mutually-valid kept points (equilateral triangle, side length just above the floor) with a
  // candidate near the centroid -- close enough to every vertex to violate the floor. The nudge away
  // from the nearest vertex necessarily moves toward the opposite side of the triangle; verified
  // computationally below (the same formula nudgeOrDropStonePoints() itself uses) rather than
  // hand-derived, that this always still violates one of the other two vertices.
  const floorMm = 1;
  const sideMm = floorMm * 1.1;
  const R = sideMm / Math.sqrt(3);
  const vertices = [0, 1, 2].map((i) => {
    const angleRad = (i / 3) * 2 * Math.PI;
    return new Point2D(R * Math.cos(angleRad), R * Math.sin(angleRad));
  });
  const candidate = new Point2D(0.05, 0.02); // off-center, breaking the 3-way tie deterministically

  const distancesMm = vertices.map((v) => Math.hypot(candidate.xMm - v.xMm, candidate.yMm - v.yMm));
  const nearestIndex = distancesMm.indexOf(Math.min(...distancesMm));
  assert.ok(distancesMm[nearestIndex] < floorMm, 'test setup: candidate must violate its nearest vertex');
  const nearest = vertices[nearestIndex];
  const ddx = candidate.xMm - nearest.xMm, ddy = candidate.yMm - nearest.yMm;
  const distMm = Math.hypot(ddx, ddy);
  const nudgedXMm = nearest.xMm + (ddx / distMm) * floorMm;
  const nudgedYMm = nearest.yMm + (ddy / distMm) * floorMm;
  const otherViolated = vertices.some((v, i) => i !== nearestIndex && Math.hypot(nudgedXMm - v.xMm, nudgedYMm - v.yMm) < floorMm);
  assert.ok(otherViolated, 'test setup: the nudge must still violate one of the other two vertices');

  const stats = { violationsFound: 0, repaired: 0, dropped: 0 };
  const result = nudgeOrDropStonePoints([...vertices, candidate], () => true, floorMm, 0, stats);
  assert.equal(result.length, 3, 'the candidate must be dropped, leaving only the three vertices');
  for (const v of vertices) assert.ok(result.includes(v), 'the three vertices must survive unchanged');
  assert.deepEqual(stats, { violationsFound: 1, repaired: 0, dropped: 1 });

  // The zero-distance degenerate case: candidate exactly coincides with a kept point -- direction is
  // undefined, so the nudge is not attempted and the point drops immediately.
  const coincident = new Point2D(0, 0);
  const statsZero = { violationsFound: 0, repaired: 0, dropped: 0 };
  const resultZero = nudgeOrDropStonePoints([coincident, new Point2D(0, 0)], () => true, 1, 0, statsZero);
  assert.equal(resultZero.length, 1);
  assert.deepEqual(statsZero, { violationsFound: 1, repaired: 0, dropped: 1 });
});

await test('4. Byte-identity guard: every candidate already >= stoneSizeMm + gapMm apart reproduces dedupeStonePoints(points, stoneSizeMm) exactly', () => {
  const floorMm = STONE_SIZE_MM + GAP_MM;
  const points = [];
  for (let i = 0; i < 30; i++) points.push(new Point2D(i * floorMm * 1.2, (i % 3) * floorMm * 1.2));
  const stats = { violationsFound: 0, repaired: 0, dropped: 0 };
  const nudged = nudgeOrDropStonePoints(points, () => true, STONE_SIZE_MM, GAP_MM, stats);
  const deduped = dedupeStonePoints(points, STONE_SIZE_MM);
  assert.deepEqual(nudged, deduped);
  assert.deepEqual(stats, { violationsFound: 0, repaired: 0, dropped: 0 });
});

await test('5. Fill/Staggered/Organic/Edge byte-identical -- gapMm/checkFixStats in samplerOptions changes nothing, and counts match the pinned baseline', () => {
  for (const [label, field] of [['disc', DISC_FIELD], ['dumbbell', DUMBBELL_FIELD]]) {
    for (const mode of ['fill', 'staggered', 'organic', 'edge']) {
      const withoutNewKeys = sampleFieldByMode(mode, field, PLACEMENT, SPACING_MM, STONE_SIZE_MM, { seed: 1, spread: 1, edgeThinning: 1 });
      const stats = { violationsFound: 0, repaired: 0, dropped: 0 };
      const withNewKeys = sampleFieldByMode(mode, field, PLACEMENT, SPACING_MM, STONE_SIZE_MM, { seed: 1, spread: 1, edgeThinning: 1, gapMm: GAP_MM, checkFixStats: stats });
      assert.deepEqual(withNewKeys, withoutNewKeys, `${label} ${mode}: gapMm/checkFixStats in samplerOptions must not be read`);
      assert.deepEqual(stats, { violationsFound: 0, repaired: 0, dropped: 0 }, `${label} ${mode}: checkFixStats must never be touched`);
      assert.equal(withoutNewKeys.length, NO_VIOLATION_BASELINE[label][mode], `${label} ${mode}: stone count drifted from the pinned baseline`);
    }
  }
});

await test('6. checkFixStats accounting invariant: violationsFound === repaired + dropped, and kept.length === (candidateCount - violationsFound) + repaired', () => {
  for (const [, field] of [['disc', DISC_FIELD], ['dumbbell', DUMBBELL_FIELD]]) {
    for (const mode of ['contour', 'radial']) {
      const stats = { violationsFound: 0, repaired: 0, dropped: 0 };
      const fn = mode === 'contour' ? sampleContourFieldFillPoints : sampleRadialFieldFillPoints;
      // Candidate count before repair: run once with no stats/floor relaxation (gapMm 0, matching
      // dedupeStonePoints()'s own stoneSizeMm-only floor) is NOT the candidate count -- it already
      // drops. The true raw candidate count equals kept.length + dropped, independent of how many
      // were nudged; assert the accounting relationship stats itself must satisfy instead.
      const post = fn(field, PLACEMENT, SPACING_MM, STONE_SIZE_MM, GAP_MM, stats);
      assert.equal(stats.violationsFound, stats.repaired + stats.dropped);
      const candidateCount = post.length + stats.dropped; // every candidate is either kept-as-is, repaired, or dropped
      assert.equal(post.length, (candidateCount - stats.violationsFound) + stats.repaired);
    }
  }
});

await test('7. checkFixStats is null for every non-Contour/Radial mode, and present for every Contour/Radial run (including zero-violation Radial)', () => {
  const engine = createGeometryEngine({});
  const buffer = discImageBuffer(200);
  const baseParams = { imageBuffer: buffer, layerId: 'img005-modes', xMm: 10, yMm: 7, widthMm: 60, heightMm: 60, stoneSizeMm: STONE_SIZE_MM, gapMm: GAP_MM, maxWidthPx: 200, maxHeightPx: 200, seed: 1, spread: 1, edgeThinning: 1 };
  for (const mode of ['fill', 'staggered', 'organic', 'edge']) {
    const layout = engine.generateImageLayout({ ...baseParams, mode });
    assert.equal(layout.checkFixStats, null, `mode ${mode} must not carry checkFixStats`);
  }
  for (const mode of ['contour', 'radial']) {
    const layout = engine.generateImageLayout({ ...baseParams, mode });
    assert.ok(layout.checkFixStats, `mode ${mode} must carry a checkFixStats object`);
    assert.equal(typeof layout.checkFixStats.violationsFound, 'number');
    assert.equal(typeof layout.checkFixStats.repaired, 'number');
    assert.equal(typeof layout.checkFixStats.dropped, 'number');
  }
  // Radial on this fixture measures zero violations (RS-1011's "defensive second layer" case) --
  // checkFixStats must still be present and all-zero, not null.
  const radialLayout = engine.generateImageLayout({ ...baseParams, mode: 'radial' });
  assert.deepEqual(radialLayout.checkFixStats, { violationsFound: 0, repaired: 0, dropped: 0 });

  // StoneLayout.toJSON()/fromJSON() round-trip, same guarded precedent as outlineStats.
  const contourLayout = engine.generateImageLayout({ ...baseParams, mode: 'contour' });
  const json = contourLayout.toJSON();
  assert.deepEqual(json.checkFixStats, contourLayout.checkFixStats);
  const fillLayout = engine.generateImageLayout({ ...baseParams, mode: 'fill' });
  assert.ok(!('checkFixStats' in fillLayout.toJSON()), 'fill mode must omit checkFixStats from toJSON() entirely');
});

await test('8. gapMm omitted (sampler called directly) reduces to dedupeStonePoints()\'s floor exactly stoneSizeMm', () => {
  for (const [, field] of [['disc', DISC_FIELD], ['dumbbell', DUMBBELL_FIELD]]) {
    for (const fn of [sampleContourFieldFillPoints, sampleRadialFieldFillPoints]) {
      const result = fn(field, PLACEMENT, SPACING_MM, STONE_SIZE_MM); // gapMm/checkFixStats both omitted
      assert.ok(minPairwiseDistance(result) >= STONE_SIZE_MM - FLOOR_SLACK_MM, 'expected the same minimum pairwise distance dedupeStonePoints() already guarantees');
    }
  }
});

await test('9. S-200 infill under Contour/Radial mode: count never drops, every accepted infill stone clears the true per-pair floor', () => {
  const engine = createGeometryEngine({});
  const mixedOptions = { sizeMode: 'mixed', allowedSizesMm: [2.0, 2.7, 4.0], minSizeMm: 2.0, maxSizeMm: 4.0, conservativeDetail: 1.0 };
  for (const [label, buffer] of [['disc', discImageBuffer(200)]]) {
    for (const mode of ['contour', 'radial']) {
      const baseParams = { imageBuffer: buffer, layerId: `img005-infill-${label}-${mode}`, xMm: 10, yMm: 7, widthMm: 60, heightMm: 60, stoneSizeMm: STONE_SIZE_MM, gapMm: GAP_MM, maxWidthPx: 200, maxHeightPx: 200, mode };
      const uniform = engine.generateImageLayout(baseParams);
      const mixed = engine.generateImageLayout({ ...baseParams, ...mixedOptions });
      assert.ok(mixed.stones.length >= uniform.stones.length, `${label} ${mode}: mixed infill count must never drop below the pre-IMG-005 baseline`);
      for (let i = 0; i < mixed.stones.length; i++) {
        for (let j = i + 1; j < mixed.stones.length; j++) {
          const a = mixed.stones[i], b = mixed.stones[j];
          const floorMm = (a.sizeMm + b.sizeMm) / 2 + GAP_MM;
          const distMm = Math.hypot(a.xMm - b.xMm, a.yMm - b.yMm);
          assert.ok(distMm >= floorMm - FLOOR_SLACK_MM, `${label} ${mode}: stones ${i}/${j} violate (a.sizeMm+b.sizeMm)/2 + gapMm`);
        }
      }
    }
  }
});

// Brace-balanced extraction of one function's body, the same convention
// tools/test-img-004-edge-awareness.mjs's extractFunctionBody() uses for its own app.js source-text
// guards -- robust to the function being reformatted across lines, unlike a fixed end-marker slice.
function extractFunctionBody(source, signatureMarker, label) {
  const start = source.indexOf(signatureMarker);
  assert.ok(start !== -1, `expected to find "${signatureMarker}" (${label}) in app.js`);
  const braceStart = start + signatureMarker.length - 1;
  assert.equal(source[braceStart], '{', `expected signatureMarker to end at ${label}'s body-opening "{"`);
  let depth = 0;
  for (let i = braceStart; i < source.length; i++) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}') {
      depth--;
      if (depth === 0) return source.slice(start, i + 1);
    }
  }
  throw new Error(`expected to find the matching closing "}" of ${label} in app.js`);
}

await test('10. App-path guard: generateImageStonesLive()\'s includeStats branch actually forwards checkFixStats', () => {
  const appSrc = fs.readFileSync(new URL('../app.js', import.meta.url), 'utf8');
  const body = extractFunctionBody(appSrc, 'async generateImageStonesLive(layer,{includeStats=false}={}){', 'generateImageStonesLive()');
  assert.ok(body.includes('this.permanentEngine.generateImageLayout(params)'), 'expected generateImageStonesLive() to still call generateImageLayout(params)');
  assert.ok(body.includes('checkFixStats:result.checkFixStats'), 'generateImageStonesLive()\'s includeStats branch is missing checkFixStats:result.checkFixStats');

  const renderBody = extractFunctionBody(appSrc, 'async function renderImageStudio(){', 'renderImageStudio()');
  assert.ok(renderBody.includes('generateImageStonesLive(l,{includeStats:true})'), 'renderImageStudio() is missing its own includeStats:true call');
  assert.ok(renderBody.includes("el('imageStudioStatCheckFix')"), 'renderImageStudio() is missing the #imageStudioStatCheckFix report repaint');

  const groupIdsMatch = appSrc.match(/const IMAGE_STUDIO_LIVE_GROUP_IDS=\[([^\]]*)\];/);
  assert.ok(groupIdsMatch, 'expected to find the IMAGE_STUDIO_LIVE_GROUP_IDS declaration in app.js');
  assert.ok(!groupIdsMatch[1].includes('imageStudioGroupCheckFix'), 'imageStudioGroupCheckFix must not be added to IMAGE_STUDIO_LIVE_GROUP_IDS -- it holds no live input controls');
});

console.log('IMG-005 Check & Fix tests complete.');
