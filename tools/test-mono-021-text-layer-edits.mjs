import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FontManager } from '../src/fonts/index.js';
import { createDefaultFontProviderRegistry } from '../src/text/index.js';
import {
  GeometryEngine,
  StoneLayout,
  computeFrozenBoxTransform,
  applyNaturalContourTransform,
  absolutePointsToFrozenBoxSpace
} from '../src/geometry/index.js';
import { computeTextPlacementOffsetMm } from '../src/editing/index.js';

// MONO-021 commit 2 -- Design-tool edits (Stamp / Trace / Eraser) on a text layer, applied inside
// GeometryEngine.generateTextLayout() through the frozen-box transform. Calls the real, unmodified
// engine + real shipped fonts, mirroring tools/test-geometry-engine.mjs's own harness. Paint
// regions (colour-only, _applyTextRegions) are MONO-021 commit 3; mark/paint target resolution and
// the app.js hooks are commits 4/5.
//
// Every negative control below prints BOTH sides' numbers -- three milestones in this project
// shipped a check that could not fail.

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const manifest = JSON.parse(await readFile(path.join(repoRoot, 'assets/fonts/manifest.json'), 'utf8'));
const fontManager = new FontManager(manifest);

function createEngine() {
  return new GeometryEngine({
    fontProviderRegistry: createDefaultFontProviderRegistry(fontManager, {
      loadFontBuffer: async (rel) => {
        const b = await readFile(path.join(repoRoot, rel));
        return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
      }
    })
  });
}

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

const GREAT_VIBES = { text: 'Q', fontId: 'great-vibes-regular', providerId: 'opentype', layerId: 'L', heightMm: 20, stoneSizeMm: 2.0, gapMm: 0.2, mode: 'outline' };
const RS_BLOCK = { text: 'AB', fontId: 'rs-block', providerId: 'rhinestone', layerId: 'L', heightMm: 30, stoneSizeMm: 2.0, gapMm: 0.2, mode: 'outline' };

function frozenBoxOf(layout) {
  const b = layout.baseBoundingBoxMm;
  return { minXmm: b.minXmm, minYmm: b.minYmm, maxXmm: b.maxXmm, maxYmm: b.maxYmm };
}
function storedRelative(pointAbs, box) {
  return { xMm: pointAbs.xMm - box.minXmm, yMm: pointAbs.yMm - box.minYmm };
}
// A (0,0)-rooted rectangular region contour covering the left `fracX` of a frozen box of the given
// span, tall enough to clear it -- i.e. the region absolutely covers every base stone whose x is in
// the left `fracX` of the letter.
function leftHalfRegionContour(box, fracX = 0.5, color = 'red') {
  const w = (box.maxXmm - box.minXmm) * fracX;
  const h = (box.maxYmm - box.minYmm) + 20;
  return { contour: [{ xMm: -5, yMm: -10 }, { xMm: w, yMm: -10 }, { xMm: w, yMm: h }, { xMm: -5, yMm: h }], stoneSizeMm: 3.2, gapMm: 0.3, color, fillMode: 'fill' };
}
function stoneKey(s) { return `${s.xMm.toFixed(6)},${s.yMm.toFixed(6)},${s.sizeMm}`; }

// ---------------------------------------------------------------------------------------------
// computeFrozenBoxTransform / absolutePointsToFrozenBoxSpace -- pure geometry
// ---------------------------------------------------------------------------------------------

await test('1. computeFrozenBoxTransform returns null for a missing or degenerate box, never throws', () => {
  assert.equal(computeFrozenBoxTransform(null, { minXmm: 0, minYmm: 0, maxXmm: 1, maxYmm: 1 }), null);
  assert.equal(computeFrozenBoxTransform({ minXmm: 0, minYmm: 0, maxXmm: 1, maxYmm: 1 }, null), null);
  assert.equal(computeFrozenBoxTransform({ minXmm: 5, minYmm: 5, maxXmm: 5, maxYmm: 9 }, { minXmm: 0, minYmm: 0, maxXmm: 1, maxYmm: 1 }), null, 'zero-width frozen box');
});

await test('2. computeFrozenBoxTransform is identity (scale 1, translate to box min) when frozen === current', () => {
  const box = { minXmm: 3, minYmm: -7, maxXmm: 13, maxYmm: 3 };
  const t = computeFrozenBoxTransform(box, box);
  assert.deepEqual(t, { xMm: 3, yMm: -7, scaleX: 1, scaleY: 1 });
  // a (0,0)-rooted stored point maps back to box.min + stored
  const [p] = applyNaturalContourTransform([{ xMm: 2, yMm: 4 }], t);
  assert.deepEqual([p.xMm, p.yMm], [5, -3]);
});

await test('3. computeFrozenBoxTransform scales a stored edit onto the current bounds; absolutePointsToFrozenBoxSpace inverts it exactly', () => {
  const frozen = { minXmm: 0, minYmm: 0, maxXmm: 10, maxYmm: 10 };
  const current = { minXmm: 100, minYmm: 50, maxXmm: 130, maxYmm: 70 }; // 3x wide, 2x tall, translated
  const t = computeFrozenBoxTransform(frozen, current);
  assert.deepEqual(t, { xMm: 100, yMm: 50, scaleX: 3, scaleY: 2 });
  const absHit = { xMm: 115, yMm: 60 }; // centre of current box
  const [stored] = absolutePointsToFrozenBoxSpace([[absHit]], frozen, current)[0].map((p) => ({ xMm: p.xMm, yMm: p.yMm }));
  assert.ok(Math.abs(stored.xMm - 5) < 1e-9 && Math.abs(stored.yMm - 5) < 1e-9, `centre stores as (5,5), got (${stored.xMm},${stored.yMm})`);
  const [roundTrip] = applyNaturalContourTransform([stored], t);
  assert.ok(Math.abs(roundTrip.xMm - absHit.xMm) < 1e-9 && Math.abs(roundTrip.yMm - absHit.yMm) < 1e-9, 'forward(inverse(x)) === x');
});

await test('4. absolutePointsToFrozenBoxSpace returns [] for a degenerate box (no base stones)', () => {
  assert.deepEqual(absolutePointsToFrozenBoxSpace([[{ xMm: 1, yMm: 1 }]], null, null), []);
});

// ---------------------------------------------------------------------------------------------
// generateTextLayout -- edit application
// ---------------------------------------------------------------------------------------------

await test('5. NEGATIVE CONTROL: edit fields absent vs present-but-empty produce byte-identical stones; one stamp changes the count', async () => {
  const engine = createEngine();
  const bare = await engine.generateTextLayout(GREAT_VIBES);
  const emptyFields = await engine.generateTextLayout({ ...GREAT_VIBES, regions: [], stampedStones: [], erasedGridPositions: [] });
  console.log(`   passing: bare count = ${bare.count}, empty-fields count = ${emptyFields.count}`);
  assert.equal(emptyFields.count, bare.count);
  assert.deepEqual(emptyFields.toJSON().stones, bare.toJSON().stones, 'empty edit fields must be byte-identical to no fields at all');

  const box = frozenBoxOf(bare);
  const withStamp = await engine.generateTextLayout({
    ...GREAT_VIBES,
    naturalBoundingBoxMm: box,
    stampedStones: [{ id: 's1', xMm: 5, yMm: 5, sizeMm: 2.0, color: 'gold' }]
  });
  console.log(`   control: one stamped stone -> count = ${withStamp.count} (base ${bare.count})`);
  assert.equal(withStamp.count, bare.count + 1, 'a stamped stone must change the count -- proves the assertion above can fail');
});

await test('6. a stamped stone lands at frozen-box-min + its stored (0,0)-rooted offset, with its own size/colour', async () => {
  const engine = createEngine();
  const bare = await engine.generateTextLayout(GREAT_VIBES);
  const box = frozenBoxOf(bare);
  const layout = await engine.generateTextLayout({
    ...GREAT_VIBES,
    naturalBoundingBoxMm: box,
    stampedStones: [{ id: 's1', xMm: 5, yMm: 5, sizeMm: 3.0, color: 'jet' }]
  });
  const stamp = layout.stones[layout.count - 1];
  assert.ok(Math.abs(stamp.xMm - (box.minXmm + 5)) < 1e-9 && Math.abs(stamp.yMm - (box.minYmm + 5)) < 1e-9, `stamp at (${stamp.xMm},${stamp.yMm})`);
  assert.equal(stamp.sizeMm, 3.0);
  assert.equal(stamp.color, 'jet');
  assert.equal(stamp.layerId, 'L');
});

await test('7. NEGATIVE CONTROL: an erased grid position removes exactly the base stone it snapshots; an off-target position removes nothing', async () => {
  const engine = createEngine();
  const bare = await engine.generateTextLayout(GREAT_VIBES);
  const box = frozenBoxOf(bare);
  const targetStone = bare.stones[10];
  const stored = storedRelative({ xMm: targetStone.xMm, yMm: targetStone.yMm }, box);

  const erased = await engine.generateTextLayout({ ...GREAT_VIBES, naturalBoundingBoxMm: box, erasedGridPositions: [stored] });
  const offTarget = await engine.generateTextLayout({ ...GREAT_VIBES, naturalBoundingBoxMm: box, erasedGridPositions: [{ xMm: 9999, yMm: 9999 }] });
  console.log(`   passing: on-target erase -> ${erased.count} (base ${bare.count}, -1); control off-target erase -> ${offTarget.count} (base ${bare.count}, -0)`);
  assert.equal(erased.count, bare.count - 1);
  assert.equal(offTarget.count, bare.count);
  assert.ok(!erased.stones.some((s) => Math.hypot(s.xMm - targetStone.xMm, s.yMm - targetStone.yMm) < 1e-6), 'the snapshotted stone is gone');
});

await test('8. erased positions never remove a stamped stone -- erase runs strictly before stamps are appended', async () => {
  const engine = createEngine();
  const bare = await engine.generateTextLayout(GREAT_VIBES);
  const box = frozenBoxOf(bare);
  const stampStored = { xMm: 5, yMm: 5 };
  const layout = await engine.generateTextLayout({
    ...GREAT_VIBES,
    naturalBoundingBoxMm: box,
    stampedStones: [{ id: 's1', xMm: 5, yMm: 5, sizeMm: 2.0, color: 'gold' }],
    erasedGridPositions: [stampStored] // same natural position as the stamp
  });
  const stampAbs = { xMm: box.minXmm + 5, yMm: box.minYmm + 5 };
  assert.ok(layout.stones.some((s) => Math.hypot(s.xMm - stampAbs.xMm, s.yMm - stampAbs.yMm) < 1e-6), 'the stamp survives an erased position at the same spot');
});

await test('9. NEGATIVE CONTROL: edits track a resize -- a stamp stored in a 20 mm frozen box scales with the letter at 40 mm; the un-resized case does not move it', async () => {
  const engine = createEngine();
  const bare = await engine.generateTextLayout(GREAT_VIBES);
  const box = frozenBoxOf(bare);
  const stamp = { id: 's1', xMm: 8, yMm: 6, sizeMm: 2.0, color: 'gold' };

  const sameSize = await engine.generateTextLayout({ ...GREAT_VIBES, naturalBoundingBoxMm: box, stampedStones: [stamp] });
  const resized = await engine.generateTextLayout({ ...GREAT_VIBES, heightMm: 40, naturalBoundingBoxMm: box, stampedStones: [stamp] });

  const sameStamp = sameSize.stones[sameSize.count - 1];
  const resizedStamp = resized.stones[resized.count - 1];
  const rb = resized.baseBoundingBoxMm;
  const expectedX = rb.minXmm + 8 * (rb.widthMm / (box.maxXmm - box.minXmm));
  const expectedY = rb.minYmm + 6 * (rb.heightMm / (box.maxYmm - box.minYmm));
  console.log(`   passing: resized stamp at (${resizedStamp.xMm.toFixed(3)}, ${resizedStamp.yMm.toFixed(3)}), expected (${expectedX.toFixed(3)}, ${expectedY.toFixed(3)})`);
  console.log(`   control: same-size stamp at (${sameStamp.xMm.toFixed(3)}, ${sameStamp.yMm.toFixed(3)}) == box.min + (8,6) = (${(box.minXmm + 8).toFixed(3)}, ${(box.minYmm + 6).toFixed(3)})`);
  assert.ok(Math.abs(resizedStamp.xMm - expectedX) < 1e-6 && Math.abs(resizedStamp.yMm - expectedY) < 1e-6, 'resized stamp scaled by the box->box map');
  assert.ok(Math.abs(sameStamp.xMm - (box.minXmm + 8)) < 1e-6 && Math.abs(sameStamp.yMm - (box.minYmm + 6)) < 1e-6, 'un-resized stamp did not move');
  assert.ok(Math.abs(resizedStamp.xMm - sameStamp.xMm) > 1 || Math.abs(resizedStamp.yMm - sameStamp.yMm) > 1, 'the two cases genuinely differ');
});

await test('10. NEGATIVE CONTROL: baseBoundingBoxMm is the PRE-edit box -- a stamp outside the letter grows getBoundingBox() but never baseBoundingBoxMm', async () => {
  const engine = createEngine();
  const bare = await engine.generateTextLayout(GREAT_VIBES);
  const box = frozenBoxOf(bare);
  const farStored = { xMm: (box.maxXmm - box.minXmm) + 40, yMm: 0 }; // 40 mm past the letter's right edge

  const layout = await engine.generateTextLayout({
    ...GREAT_VIBES,
    naturalBoundingBoxMm: box,
    stampedStones: [{ id: 's1', xMm: farStored.xMm, yMm: farStored.yMm, sizeMm: 2.0, color: 'gold' }]
  });
  const grew = layout.getBoundingBox().maxXmm - bare.getBoundingBox().maxXmm;
  console.log(`   passing: baseBoundingBoxMm.maxXmm ${layout.baseBoundingBoxMm.maxXmm.toFixed(3)} == bare ${bare.baseBoundingBoxMm.maxXmm.toFixed(3)}`);
  console.log(`   control: getBoundingBox().maxXmm grew by ${grew.toFixed(3)} mm because of the far stamp`);
  assert.deepEqual(layout.baseBoundingBoxMm, bare.baseBoundingBoxMm, 'baseBoundingBoxMm must not include the stamp');
  assert.ok(grew > 30, 'the physical bounding box did grow -- proves the assertion can fail');
});

await test('11. determinism -- identical params + identical edits produce deepEqual toJSON', async () => {
  const engine = createEngine();
  const bare = await engine.generateTextLayout(GREAT_VIBES);
  const box = frozenBoxOf(bare);
  const params = { ...GREAT_VIBES, naturalBoundingBoxMm: box, stampedStones: [{ id: 's1', xMm: 4, yMm: 4, sizeMm: 2.0, color: 'gold' }], erasedGridPositions: [storedRelative(bare.stones[3], box)] };
  const a = await engine.generateTextLayout(params);
  const b = await engine.generateTextLayout(params);
  assert.deepEqual(a.toJSON(), b.toJSON());
});

await test('12. StoneLayout.toJSON()/fromJSON() round-trips baseBoundingBoxMm and edited stones', async () => {
  const engine = createEngine();
  const bare = await engine.generateTextLayout(GREAT_VIBES);
  const box = frozenBoxOf(bare);
  const layout = await engine.generateTextLayout({ ...GREAT_VIBES, naturalBoundingBoxMm: box, stampedStones: [{ id: 's1', xMm: 4, yMm: 4, sizeMm: 2.0, color: 'gold' }] });
  const round = StoneLayout.fromJSON(JSON.parse(JSON.stringify(layout.toJSON())));
  assert.deepEqual(round.toJSON().stones, layout.toJSON().stones);
  assert.deepEqual(round.toJSON().baseBoundingBoxMm, layout.toJSON().baseBoundingBoxMm);
});

// ---------------------------------------------------------------------------------------------
// Authored-stone-centre font (rs-block) -- resolveTextPolygons() throws for it; every tool must
// behave identically with NO outline dependency.
// ---------------------------------------------------------------------------------------------

await test('13. rs-block (authored font, no vector outline) -- stamp + erase apply identically, no throw', async () => {
  const engine = createEngine();
  await assert.rejects(() => engine.resolveTextPolygons({ ...RS_BLOCK, heightMm: 30 }), /authored stone centers/, 'precondition: rs-block has no outline');

  const bare = await engine.generateTextLayout(RS_BLOCK);
  assert.ok(bare.count > 0 && bare.sourceMode === 'authored', `rs-block "AB" -> ${bare.count} authored stones`);
  const box = frozenBoxOf(bare);

  const stamped = await engine.generateTextLayout({ ...RS_BLOCK, naturalBoundingBoxMm: box, stampedStones: [{ id: 's1', xMm: 3, yMm: 3, sizeMm: 2.0, color: 'gold' }] });
  assert.equal(stamped.count, bare.count + 1);

  const erased = await engine.generateTextLayout({ ...RS_BLOCK, naturalBoundingBoxMm: box, erasedGridPositions: [storedRelative(bare.stones[2], box)] });
  assert.equal(erased.count, bare.count - 1);
});

await test('14. degenerate -- a text layout with zero base stones plus edits does not throw; edits are skipped', async () => {
  const engine = createEngine();
  const blank = await engine.generateTextLayout({ ...GREAT_VIBES, text: ' ' });
  console.log(`   " " (space) -> ${blank.count} base stones, baseBoundingBoxMm = ${JSON.stringify(blank.baseBoundingBoxMm)}`);
  if (blank.count === 0) {
    const withEdits = await engine.generateTextLayout({ ...GREAT_VIBES, text: ' ', stampedStones: [{ id: 's1', xMm: 1, yMm: 1, sizeMm: 2.0, color: 'gold' }] });
    assert.equal(withEdits.count, 0, 'no base bounds -> null transform -> edits silently skipped');
  } else {
    console.log('   (space produced stones on this font; degenerate path not exercised here)');
  }
});

// ---------------------------------------------------------------------------------------------
// The canvas-placement fix (correction commit) -- generateTextStonesLive() centres a text layer
// from result.baseBoundingBoxMm, not result.getBoundingBox(). Reproduced here at module level via
// computeTextPlacementOffsetMm() (the exact function app.js's computeTextPlacementOffset() wraps),
// since the bug sits DOWNSTREAM of the engine and test 5's byte-identical engine assertion cannot
// see it.
// ---------------------------------------------------------------------------------------------

await test('15. NEGATIVE CONTROL: canvas placement uses the pre-edit box -- a far stamp moves no base stone; the old getBoundingBox()-based placement moved every one', async () => {
  const engine = createEngine();
  const canvas = { canvasWidthMm: 220, canvasHeightMm: 220 };
  const bare = await engine.generateTextLayout(GREAT_VIBES);
  const box = frozenBoxOf(bare);
  const farStamp = { id: 's1', xMm: (box.maxXmm - box.minXmm) + 40, yMm: 0, sizeMm: 2.0, color: 'gold' };
  const edited = await engine.generateTextLayout({ ...GREAT_VIBES, naturalBoundingBoxMm: box, stampedStones: [farStamp] });

  // Reproduces generateTextStonesLive()'s centring: offset from computeTextPlacementOffsetMm(bbox),
  // then stone.xMm + offset. Compared over the BASE stones only (indices 0..bare.count-1).
  const place = (layout, bbox) => {
    const { offsetXMm, offsetYMm } = computeTextPlacementOffsetMm({ boundingBoxMm: bbox, xMm: 0, yMm: 0, ...canvas });
    return layout.stones.slice(0, bare.count).map((s) => ({ x: s.xMm + offsetXMm, y: s.yMm + offsetYMm }));
  };
  const maxMove = (a, b) => a.reduce((m, p, i) => Math.max(m, Math.hypot(p.x - b[i].x, p.y - b[i].y)), 0);

  const barePlaced = place(bare, bare.baseBoundingBoxMm);
  const newMove = maxMove(barePlaced, place(edited, edited.baseBoundingBoxMm));
  const oldMove = maxMove(barePlaced, place(edited, edited.getBoundingBox()));

  console.log(`   passing: base stones move ${newMove.toExponential(2)} mm under the pre-edit-box (baseBoundingBoxMm) placement`);
  console.log(`   control: base stones move ${oldMove.toFixed(3)} mm under the old getBoundingBox() placement`);
  assert.ok(newMove < 1e-9, 'no base stone moves when placement uses the pre-edit box');
  assert.ok(oldMove > 5, 'the old placement moved every base stone -- proves the assertion can fail');
});

// ---------------------------------------------------------------------------------------------
// MONO-021 commit 3 -- Paint regions on a text layer (colour-only, _applyTextRegions).
// ---------------------------------------------------------------------------------------------

await test('16. NEGATIVE CONTROL: a region-only edit (stamped/erased empty) applies; an empty regions array is a no-op', async () => {
  const engine = createEngine();
  const bare = await engine.generateTextLayout(GREAT_VIBES);
  const box = frozenBoxOf(bare);

  const regionOnly = await engine.generateTextLayout({ ...GREAT_VIBES, naturalBoundingBoxMm: box, stampedStones: [], erasedGridPositions: [], regions: [leftHalfRegionContour(box, 0.5, 'ruby')] });
  const emptyRegions = await engine.generateTextLayout({ ...GREAT_VIBES, naturalBoundingBoxMm: box, regions: [] });

  const recoloured = regionOnly.stones.filter((s) => s.color === 'ruby').length;
  console.log(`   passing: region-only edit -> ${recoloured} of ${regionOnly.count} stones recoloured to 'ruby'`);
  console.log(`   control: empty regions array -> ${emptyRegions.stones.filter((s) => s.color === 'ruby').length} recoloured, count ${emptyRegions.count} == bare ${bare.count}`);
  assert.ok(recoloured > 0, 'a region-only edit must apply -- proves hasTextEdits includes regions');
  assert.equal(emptyRegions.count, bare.count);
  assert.deepEqual(emptyRegions.toJSON().stones, bare.toJSON().stones, 'empty regions array is byte-identical to no regions field');
});

await test('17. NEGATIVE CONTROL: _applyTextRegions changes color and nothing else -- count, every position, every size unchanged; the same assertion on a PATH layer shows positions changing', async () => {
  const engine = createEngine();
  const bare = await engine.generateTextLayout(GREAT_VIBES);
  const box = frozenBoxOf(bare);
  const region = leftHalfRegionContour(box, 0.5, 'ruby');
  const painted = await engine.generateTextLayout({ ...GREAT_VIBES, naturalBoundingBoxMm: box, regions: [region] });

  assert.equal(painted.count, bare.count, 'count unchanged');
  const beforeKeys = bare.stones.map(stoneKey);
  const afterKeys = painted.stones.map(stoneKey);
  assert.deepEqual(afterKeys, beforeKeys, 'every position and size byte-identical before/after the region');
  const recoloured = painted.stones.filter((s, i) => s.color !== bare.stones[i].color);
  assert.ok(recoloured.length > 0 && recoloured.every((s) => s.color === 'ruby'), `only color changed, only to 'ruby' (${recoloured.length} stones)`);
  console.log(`   passing (text): count ${bare.count} -> ${painted.count}, positions/sizes identical, ${recoloured.length} stones recoloured, 0 moved`);

  // CONTROL: the same assertion form on a PATH layer -- _applyPathRegions() re-grids, so positions DO change.
  const square = [{ xMm: 0, yMm: 0 }, { xMm: 30, yMm: 0 }, { xMm: 30, yMm: 30 }, { xMm: 0, yMm: 30 }];
  const pathBare = engine.generatePathLayout({ contours: [square], layerId: 'P', xMm: 0, yMm: 0, widthMm: 30, heightMm: 30, stoneSizeMm: 2, gapMm: 0.3, mode: 'fill', color: 'gold' });
  const pathPainted = engine.generatePathLayout({ contours: [square], layerId: 'P', xMm: 0, yMm: 0, widthMm: 30, heightMm: 30, stoneSizeMm: 2, gapMm: 0.3, mode: 'fill', color: 'gold', regions: [{ contour: [{ xMm: 0, yMm: 0 }, { xMm: 15, yMm: 0 }, { xMm: 15, yMm: 30 }, { xMm: 0, yMm: 30 }], stoneSizeMm: 3.5, gapMm: 0.3, color: 'ruby', fillMode: 'fill' }] });
  const pathMoved = JSON.stringify(pathBare.stones.map(stoneKey)) !== JSON.stringify(pathPainted.stones.map(stoneKey));
  console.log(`   control (path): count ${pathBare.count} -> ${pathPainted.count}, positions changed: ${pathMoved}`);
  assert.ok(pathMoved, 'a path region re-grids -- proves the "positions unchanged" assertion can fail');
});

await test('18. NEGATIVE CONTROL: a region never affects baseBoundingBoxMm -- byte-identical to the bare layout; control: a far stamp moves getBoundingBox()', async () => {
  const engine = createEngine();
  const bare = await engine.generateTextLayout(GREAT_VIBES);
  const box = frozenBoxOf(bare);

  const painted = await engine.generateTextLayout({ ...GREAT_VIBES, naturalBoundingBoxMm: box, regions: [leftHalfRegionContour(box, 0.6, 'ruby')] });
  const farStamp = await engine.generateTextLayout({ ...GREAT_VIBES, naturalBoundingBoxMm: box, stampedStones: [{ id: 's1', xMm: (box.maxXmm - box.minXmm) + 40, yMm: 0, sizeMm: 2.0, color: 'gold' }] });

  console.log(`   passing: painted.baseBoundingBoxMm == bare.baseBoundingBoxMm : ${JSON.stringify(painted.baseBoundingBoxMm) === JSON.stringify(bare.baseBoundingBoxMm)}`);
  console.log(`   control: far stamp grows getBoundingBox().maxXmm by ${(farStamp.getBoundingBox().maxXmm - bare.getBoundingBox().maxXmm).toFixed(3)} mm`);
  assert.deepEqual(painted.baseBoundingBoxMm, bare.baseBoundingBoxMm);
  assert.ok(farStamp.getBoundingBox().maxXmm - bare.getBoundingBox().maxXmm > 30);
});

await test('19. region priority -- a later region in the array wins over an earlier one for a stone they both cover', async () => {
  const engine = createEngine();
  const bare = await engine.generateTextLayout(GREAT_VIBES);
  const box = frozenBoxOf(bare);
  // Two overlapping full-width regions: first 'ruby', then 'emerald'. Every covered stone ends 'emerald'.
  const r1 = leftHalfRegionContour(box, 1.2, 'ruby');
  const r2 = leftHalfRegionContour(box, 1.2, 'emerald');
  const painted = await engine.generateTextLayout({ ...GREAT_VIBES, naturalBoundingBoxMm: box, regions: [r1, r2] });
  const emerald = painted.stones.filter((s) => s.color === 'emerald').length;
  const ruby = painted.stones.filter((s) => s.color === 'ruby').length;
  console.log(`   later region wins: emerald ${emerald}, ruby ${ruby} (expect ruby 0)`);
  assert.ok(emerald > 0 && ruby === 0);
});

await test('20. a region with a null color recolours nothing', async () => {
  const engine = createEngine();
  const bare = await engine.generateTextLayout(GREAT_VIBES);
  const box = frozenBoxOf(bare);
  const r = leftHalfRegionContour(box, 0.6);
  r.color = null;
  const painted = await engine.generateTextLayout({ ...GREAT_VIBES, naturalBoundingBoxMm: box, regions: [r] });
  assert.deepEqual(painted.toJSON().stones, bare.toJSON().stones, 'null-color region is a no-op on stone data');
});

await test('21. order regions -> erased -> stamped: a recoloured base stone can still be erased; a stamp is never recoloured', async () => {
  const engine = createEngine();
  const bare = await engine.generateTextLayout(GREAT_VIBES);
  const box = frozenBoxOf(bare);
  const leftStone = [...bare.stones].sort((a, b) => a.xMm - b.xMm)[0]; // leftmost -- inside the left-half region

  const painted = await engine.generateTextLayout({
    ...GREAT_VIBES,
    naturalBoundingBoxMm: box,
    regions: [leftHalfRegionContour(box, 0.5, 'ruby')],
    erasedGridPositions: [storedRelative(leftStone, box)],
    stampedStones: [{ id: 's1', xMm: 2, yMm: 2, sizeMm: 2.0, color: 'gold' }] // inside the region area
  });

  // the recoloured leftmost base stone is erased
  assert.ok(!painted.stones.some((s) => Math.hypot(s.xMm - leftStone.xMm, s.yMm - leftStone.yMm) < 1e-6), 'a recoloured base stone is still erasable');
  // the stamp keeps its own colour even though it sits inside the region footprint
  const stampAbs = { xMm: box.minXmm + 2, yMm: box.minYmm + 2 };
  const stamp = painted.stones.find((s) => Math.hypot(s.xMm - stampAbs.xMm, s.yMm - stampAbs.yMm) < 1e-6);
  assert.ok(stamp && stamp.color === 'gold', `stamp inside the region keeps its own colour (got ${stamp && stamp.color})`);
});

await test('22. rs-block (authored font) -- a region recolours base stones in place, no throw, positions unchanged', async () => {
  const engine = createEngine();
  const bare = await engine.generateTextLayout(RS_BLOCK);
  const box = frozenBoxOf(bare);
  const painted = await engine.generateTextLayout({ ...RS_BLOCK, naturalBoundingBoxMm: box, regions: [leftHalfRegionContour(box, 0.5, 'ruby')] });
  assert.equal(painted.count, bare.count);
  assert.deepEqual(painted.stones.map(stoneKey), bare.stones.map(stoneKey), 'positions/sizes unchanged for an authored font too');
  assert.ok(painted.stones.some((s) => s.color === 'ruby'), 'some authored stones recoloured');
});

if (process.exitCode === 1) {
  console.error('\nMONO-021 text-layer edit tests FAILED.');
} else {
  console.log('\nMONO-021 text-layer edit tests passed.');
}
